import prismaClient from '@prisma/client';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import {
  adminChatDetailSchema,
  adminChatsResponseSchema,
  adminReportsResponseSchema,
} from 'shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountService, DELETED_USER_ID } from './account.js';
import { AdminChatService, type LiveChat } from './admin-chats.js';
import { AdminService, registerAdminRoutes } from './admin.js';
import { messagesKey } from './chat.js';
import { blockKey, recentKey } from './matchmaking.js';
import { AccessLogger } from './logging5651.js';
import { encounterKey, suspendedKey } from './moderation.js';
import { recentCategoriesKey, seenKey } from './rooms.js';

const { PrismaClient } = prismaClient;

// Requires Postgres and Redis (docker compose up -d). Uses a dedicated database and logical DB.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl?.includes('_test')) throw new Error('A *_test database is required');
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379', {
  db: 10,
  maxRetriesPerRequest: 1,
});
const SECRET = 'admin-test-secret-'.repeat(3);

const createUser = (nickname = 'Sakin Tilki') =>
  prisma.user.create({ data: { nickname, avatarId: 'tilki' } });
const createReport = (reporterId: string, reportedId: string, reason = 'spam') =>
  prisma.report.create({
    data: {
      reporterId,
      reportedId,
      reason,
      snapshot: [{ id: 'm1', senderId: reportedId, body: 'mesaj', at: new Date().toISOString() }],
    },
  });

beforeEach(async () => {
  await redis.flushdb();
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Message","ConversationMember","Conversation","Friendship","FriendRequest","Block","Report","Match","TransferCode","AccessLog","User" CASCADE',
  );
});

afterAll(async () => {
  await redis.flushdb();
  redis.disconnect();
  await prisma.$disconnect();
});

describe('admin', () => {
  const kicked: string[] = [];
  const admin = new AdminService(prisma, redis, async (userId) => {
    kicked.push(userId);
  });

  const buildApp = () => {
    const app = Fastify();
    registerAdminRoutes(app, admin, SECRET);
    return app;
  };
  const headers = { 'x-internal-secret': SECRET };

  beforeEach(() => {
    kicked.length = 0;
  });

  it('hides every route without the internal secret', async () => {
    const app = buildApp();
    const user = await createUser();
    for (const [method, url] of [
      ['GET', '/internal/admin/reports'],
      ['POST', `/internal/admin/users/${user.id}/ban`],
      ['POST', `/internal/admin/users/${user.id}/unban`],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { 'x-internal-secret': 'wrong' },
        ...(method === 'POST' ? { payload: { hours: 1 } } : {}),
      });
      expect(response.statusCode).toBe(404);
    }
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).bannedUntil,
    ).toBeNull();
    await app.close();
  });

  it('lists suspected-minor reports first, with their snapshot', async () => {
    const [a, b, c] = [await createUser('A'), await createUser('B'), await createUser('C')];
    await createReport(a.id, b.id, 'spam');
    await createReport(c.id, b.id, 'reşit-olmayan');
    await redis.set(suspendedKey(b.id), '1');
    const app = buildApp();

    const response = await app.inject({ url: '/internal/admin/reports', headers });
    const { reports } = adminReportsResponseSchema.parse(response.json());

    expect(reports.map((report) => report.reason)).toEqual(['reşit-olmayan', 'spam']);
    expect(reports[0]!.priority).toBe(true);
    expect(reports[0]!.snapshot[0]!.body).toBe('mesaj');
    expect(reports[0]!.reported).toMatchObject({ nickname: 'B', suspended: true, openReports: 2 });
    await app.close();
  });

  it('moves a report out of the open list', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const report = await createReport(a.id, b.id);
    const app = buildApp();

    const updated = await app.inject({
      method: 'POST',
      url: `/internal/admin/reports/${report.id}/status`,
      headers,
      payload: { status: 'resolved' },
    });

    expect(updated.statusCode).toBe(200);
    expect(await admin.listReports('open')).toEqual([]);
    expect(await admin.listReports('resolved')).toHaveLength(1);
    await app.close();
  });

  it('bans for the given hours and disconnects the user', async () => {
    const user = await createUser();
    const app = buildApp();
    const before = Date.now();

    const response = await app.inject({
      method: 'POST',
      url: `/internal/admin/users/${user.id}/ban`,
      headers,
      payload: { hours: 24 },
    });

    expect(response.statusCode).toBe(200);
    expect(kicked).toEqual([user.id]);
    const { bannedUntil } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(bannedUntil!.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
    await app.close();
  });

  it.each([{ hours: 0 }, { hours: 1.5 }, { hours: 99_999 }, {}])('rejects ban %j', async (body) => {
    const user = await createUser();
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/internal/admin/users/${user.id}/ban`,
      headers,
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('lifts a ban and the automatic suspension', async () => {
    const user = await createUser();
    await admin.ban(user.id, 5);
    await redis.set(suspendedKey(user.id), '1');

    expect(await admin.unban(user.id)).toBe(true);

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).bannedUntil,
    ).toBeNull();
    expect(await redis.exists(suspendedKey(user.id))).toBe(0);
  });
});

describe('admin chats', () => {
  const live: LiveChat[] = [];
  const chats = new AdminChatService(prisma, redis, () => live);
  const admin = new AdminService(prisma, redis, async () => {});
  const headers = { 'x-internal-secret': SECRET };
  const buildApp = () => {
    const app = Fastify();
    registerAdminRoutes(app, admin, SECRET, chats);
    return app;
  };

  const roomMessage = async (roomId: string, senderId: string, body: string, at: Date) =>
    redis.rpush(
      messagesKey(roomId),
      JSON.stringify({ id: `${roomId}-${body}`, senderId, body, at: at.toISOString() }),
    );

  const createMatch = (id: string, a: string, b: string, startedAt = new Date()) =>
    prisma.match.create({
      data: {
        id,
        userAId: a,
        userBId: b,
        category: 'genel',
        engine: 'mc',
        scoreA: 0,
        scoreB: 0,
        startedAt,
      },
    });

  const createDm = async (a: string, b: string, messages: { body: string; ageMs: number }[]) => {
    const conversation = await prisma.conversation.create({
      data: { members: { create: [{ userId: a }, { userId: b }] } },
    });
    const now = Date.now();
    for (const { body, ageMs } of messages) {
      const createdAt = new Date(now - ageMs);
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: a,
          body,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
        },
      });
    }
    return conversation;
  };

  beforeEach(() => {
    live.length = 0;
  });

  it('separates live chats from stored ones and skips rooms without messages', async () => {
    const [a, b, c, d] = [
      await createUser('A'),
      await createUser('B'),
      await createUser('C'),
      await createUser('D'),
    ];
    const now = new Date();
    await createMatch('live-room', a.id, b.id);
    await createMatch('old-room', c.id, d.id, new Date(now.getTime() - 60 * 60 * 1000));
    await createMatch('silent-room', c.id, a.id);
    await roomMessage('live-room', a.id, 'selam', now);
    await roomMessage('old-room', c.id, 'nasılsın', new Date(now.getTime() - 50 * 60 * 1000));
    await createReport(d.id, c.id).then((report) =>
      prisma.report.update({ where: { id: report.id }, data: { matchId: 'old-room' } }),
    );
    live.push({
      id: 'live-room',
      players: [a.id, b.id],
      state: 'CHATTING',
      friendly: false,
      chatEndsAt: now.getTime() + 60_000,
    });
    // A room still in its game is not a conversation yet.
    live.push({
      id: 'silent-room',
      players: [c.id, a.id],
      state: 'PLAYING',
      friendly: false,
      chatEndsAt: 0,
    });
    const recentDm = await createDm(a.id, c.id, [{ body: 'dm yeni', ageMs: 60_000 }]);
    const oldDm = await createDm(b.id, d.id, [
      { body: 'süresi doldu', ageMs: 25 * 60 * 60 * 1000 },
      { body: 'dm eski', ageMs: 2 * 60 * 60 * 1000 },
    ]);

    const app = buildApp();
    const response = await app.inject({ url: '/internal/admin/chats', headers });
    const { active, stored } = adminChatsResponseSchema.parse(response.json());

    expect(active.map((chat) => [chat.kind, chat.id])).toEqual([
      ['room', 'live-room'],
      ['dm', recentDm.id],
    ]);
    expect(active[0]).toMatchObject({ live: true, messageCount: 1, reported: false });
    expect(active[0]!.endsAt).not.toBeNull();
    expect(active[0]!.participants.map((party) => party.nickname)).toEqual(['A', 'B']);
    expect(stored.map((chat) => [chat.kind, chat.id])).toEqual([
      ['room', 'old-room'],
      ['dm', oldDm.id],
    ]);
    expect(stored[0]).toMatchObject({ reported: true, preview: { body: 'nasılsın' } });
    // Expired DM messages are never shown.
    expect(stored[1]).toMatchObject({ messageCount: 1, preview: { body: 'dm eski' } });
    await app.close();
  });

  it('opens a game chat and a DM with their messages in order', async () => {
    const [a, b] = [await createUser('A'), await createUser('B')];
    const now = Date.now();
    await createMatch('room-1', a.id, b.id);
    await roomMessage('room-1', a.id, 'bir', new Date(now - 2000));
    await roomMessage('room-1', b.id, 'iki', new Date(now - 1000));
    const dm = await createDm(a.id, b.id, [
      { body: 'eski', ageMs: 25 * 60 * 60 * 1000 },
      { body: 'ilk', ageMs: 3000 },
      { body: 'son', ageMs: 1000 },
    ]);
    const app = buildApp();

    const room = adminChatDetailSchema.parse(
      (await app.inject({ url: '/internal/admin/chats/room/room-1', headers })).json(),
    );
    expect(room.messages.map((message) => message.body)).toEqual(['bir', 'iki']);
    expect(room.chat.live).toBe(false);

    const direct = adminChatDetailSchema.parse(
      (await app.inject({ url: `/internal/admin/chats/dm/${dm.id}`, headers })).json(),
    );
    expect(direct.messages.map((message) => message.body)).toEqual(['ilk', 'son']);
    expect(direct.chat.participants.map((party) => party.id).sort()).toEqual([a.id, b.id].sort());
    await app.close();
  });

  it('returns 404 for unknown chats and hides the routes without the secret', async () => {
    const app = buildApp();
    for (const url of [
      '/internal/admin/chats/room/nope',
      '/internal/admin/chats/dm/nope',
      '/internal/admin/chats/x/1',
    ]) {
      expect((await app.inject({ url, headers })).statusCode).toBe(404);
    }
    for (const url of ['/internal/admin/chats', '/internal/admin/chats/room/nope']) {
      const response = await app.inject({ url, headers: { 'x-internal-secret': 'wrong' } });
      expect(response.statusCode).toBe(404);
    }
    await app.close();
  });
});

describe('AccessLogger', () => {
  it('writes IP, port, event and time, without any message content', async () => {
    const logger = new AccessLogger(prisma, (error) => {
      throw error;
    });
    const at = new Date('2026-11-23T10:00:00.000Z');
    logger.record({ userId: 'u1', ip: '203.0.113.5', port: 51234, event: 'message' }, at);
    await logger.flush();

    const rows = await prisma.accessLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'u1',
      ip: '203.0.113.5',
      port: 51234,
      event: 'message',
      at,
    });
    expect(Object.keys(rows[0]!).sort()).toEqual(['at', 'event', 'id', 'ip', 'port', 'userId']);
  });

  it('flushes on its own at the batch size', async () => {
    const logger = new AccessLogger(prisma, (error) => {
      throw error;
    });
    for (let i = 0; i < 200; i += 1) {
      logger.record({ userId: 'u', ip: '203.0.113.5', port: null, event: 'connect' });
    }
    await vi.waitFor(async () => expect(await prisma.accessLog.count()).toBe(200));
    expect(logger.pending).toBe(0);
  });

  it('keeps records when the database write fails and retries later', async () => {
    const errors: unknown[] = [];
    const createMany = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue({ count: 1 });
    const logger = new AccessLogger({ accessLog: { createMany } } as never, (error) =>
      errors.push(error),
    );
    logger.record({ userId: 'u', ip: '203.0.113.5', port: null, event: 'connect' });

    await logger.flush();
    expect(errors).toHaveLength(1);
    expect(logger.pending).toBe(1);

    await logger.flush();
    expect(logger.pending).toBe(0);
  });
});

describe('account deletion', () => {
  const accounts = new AccountService(prisma, redis);

  it('removes personal data, keeps the legal log and other users intact', async () => {
    const [user, friend, other] = [
      await createUser('Sil'),
      await createUser('F'),
      await createUser('O'),
    ];
    const [userLowId, userHighId] = [user.id, friend.id].sort() as [string, string];
    await prisma.friendship.create({ data: { userLowId, userHighId } });
    await prisma.friendRequest.create({ data: { fromId: user.id, toId: other.id } });
    await prisma.block.create({ data: { blockerId: other.id, blockedId: user.id } });
    await prisma.transferCode.create({
      data: { code: 'ABCDEFGH', userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    const conversation = await prisma.conversation.create({
      data: { members: { create: [{ userId: user.id }, { userId: friend.id }] } },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        body: 'özel mesaj',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const match = await prisma.match.create({
      data: {
        userAId: user.id,
        userBId: friend.id,
        winnerId: user.id,
        category: 'muzik',
        engine: 'mc',
        scoreA: 5,
        scoreB: 3,
        chatRating: { [user.id]: 1, [friend.id]: -1 },
      },
    });
    await prisma.accessLog.create({
      data: { userId: user.id, ip: '203.0.113.5', event: 'connect' },
    });
    await createReport(friend.id, user.id);
    await redis.lpush(recentKey(user.id), friend.id);
    await redis.lpush(seenKey(user.id), 'q1');
    await redis.lpush(recentCategoriesKey(user.id), 'muzik');
    await redis.sadd(blockKey(user.id), other.id);
    await redis.sadd(blockKey(other.id), user.id);
    await redis.set(encounterKey(user.id, friend.id), match.id);
    await redis.set(encounterKey(friend.id, user.id), match.id);
    await redis.rpush(messagesKey(match.id), 'sohbet');

    await accounts.delete(user.id);

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.friendship.count()).toBe(0);
    expect(await prisma.friendRequest.count()).toBe(0);
    expect(await prisma.block.count()).toBe(0);
    expect(await prisma.transferCode.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.user.count()).toBe(2);

    const anonymized = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(anonymized).toMatchObject({
      userAId: DELETED_USER_ID,
      userBId: friend.id,
      winnerId: DELETED_USER_ID,
      scoreA: 5,
    });
    expect(anonymized.chatRating).toEqual({ [friend.id]: -1 });

    expect(await prisma.accessLog.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.report.count({ where: { reportedId: user.id } })).toBe(1);

    expect(
      await redis.exists(
        recentKey(user.id),
        seenKey(user.id),
        recentCategoriesKey(user.id),
        blockKey(user.id),
        encounterKey(user.id, friend.id),
        encounterKey(friend.id, user.id),
        messagesKey(match.id),
      ),
    ).toBe(0);
    expect(await redis.smembers(blockKey(other.id))).toEqual([]);
  });
});
