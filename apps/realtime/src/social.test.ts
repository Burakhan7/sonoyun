import prismaClient from '@prisma/client';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { SOCKET_ERROR_CODES, guestResponseSchema, transferCodeResponseSchema } from 'shared';
import { createWordFilter } from 'shared/filter';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTokenService } from './auth.js';
import { ChatService } from './chat.js';
import { DM_PAGE_SIZE, DM_TTL_MS, DmService } from './dm.js';
import { FriendService, OUTGOING_REQUEST_LIMIT, type FriendResult } from './friends.js';
import { INVITE_TTL_MS, InviteService } from './invites.js';
import { activeKey, blockKey, type Candidate } from './matchmaking.js';
import { ModerationService, createPrismaModerationStore, encounterKey } from './moderation.js';
import { Presence } from './presence.js';
import { RateLimiter } from './ratelimit.js';
import { registerApiRoutes } from './routes.js';
import { MemoryUserStore } from './test/memory-store.js';
import {
  TRANSFER_CODE_TTL_MS,
  TransferService,
  generateTransferCode,
  normalizeTransferCode,
} from './transfer.js';
import { createPrismaUserStore } from './users.js';

const { PrismaClient } = prismaClient;

// Requires Postgres and Redis (docker compose up -d). Uses a dedicated database and logical DB.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl?.includes('_test')) throw new Error('A *_test database is required');
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379', {
  db: 11,
  maxRetriesPerRequest: 1,
});

const limiter = new RateLimiter(redis);
const presence = new Presence(redis);
const chat = new ChatService(redis, limiter, createWordFilter(['aptal']));
const friends = new FriendService(prisma, redis, limiter, presence);
const dm = new DmService(prisma, chat, friends, presence);
const transfers = new TransferService(prisma);

const createUser = (nickname = 'Sakin Tilki') =>
  prisma.user.create({ data: { nickname, avatarId: 'tilki' } });

const meet = async (a: string, b: string, matchId = 'match-1') => {
  await redis.set(encounterKey(a, b), matchId);
  await redis.set(encounterKey(b, a), matchId);
};

const accepted = (result: FriendResult) => {
  if (result.status !== 'accepted') throw new Error(`Expected accepted: ${result.status}`);
  return result;
};

async function makeFriends() {
  const [a, b] = [await createUser('Sakin Tilki'), await createUser('Cesur Kartal')];
  await meet(a.id, b.id);
  await friends.request(a.id, b.id);
  const { conversationId } = accepted(await friends.request(b.id, a.id));
  return { a, b, conversationId };
}

let clock = Date.now();
const nextTime = () => {
  clock += 2_000;
  return new Date(clock);
};

beforeEach(async () => {
  await redis.flushdb();
  clock = Date.now();
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Message","ConversationMember","Conversation","Friendship","FriendRequest","Block","Report","Match","TransferCode","User" CASCADE',
  );
});

afterAll(async () => {
  await redis.flushdb();
  redis.disconnect();
  await prisma.$disconnect();
});

describe('friend requests', () => {
  it('only allows requests to someone met in the last 24 hours', async () => {
    const [a, b] = [await createUser(), await createUser()];
    expect(await friends.request(a.id, b.id)).toEqual({
      status: 'error',
      code: SOCKET_ERROR_CODES.notAllowed,
    });
    await meet(a.id, b.id);
    expect((await friends.request(a.id, b.id)).status).toBe('pending');
  });

  it('accepts automatically when both sides send a request', async () => {
    const { a, b, conversationId } = await makeFriends();
    expect(await friends.areFriends(a.id, b.id)).toBe(true);
    expect(await prisma.conversationMember.count({ where: { conversationId } })).toBe(2);
  });

  it('never duplicates friendship or conversation on simultaneous requests', async () => {
    const [a, b] = [await createUser(), await createUser()];
    await meet(a.id, b.id);
    await Promise.all([friends.request(a.id, b.id), friends.request(b.id, a.id)]);

    expect(await prisma.friendship.count()).toBe(1);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('lets only the recipient accept a request', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    await meet(a.id, b.id);
    const sent = await friends.request(a.id, b.id);
    if (sent.status !== 'pending') throw new Error('Expected pending');

    expect((await friends.respond(c.id, sent.requestId, true)).status).toBe('error');
    expect((await friends.respond(a.id, sent.requestId, true)).status).toBe('error');
    expect((await friends.respond(b.id, sent.requestId, true)).status).toBe('accepted');
    expect((await friends.respond(b.id, sent.requestId, true)).status).toBe('error');
  });

  it('lists incoming, outgoing and friends', async () => {
    const { a, b } = await makeFriends();
    const c = await createUser('Neşeli Panda');
    await meet(c.id, a.id);
    await friends.request(c.id, a.id);

    const list = await friends.list(a.id);
    expect(list.friends.map((friend) => friend.id)).toEqual([b.id]);
    expect(list.incoming.map((entry) => entry.user.id)).toEqual([c.id]);
    expect((await friends.list(c.id)).outgoing.map((entry) => entry.user.id)).toEqual([a.id]);
  });

  it('enforces the outgoing request limit', async () => {
    const a = await createUser();
    const others = await prisma.user.createManyAndReturn({
      data: Array.from({ length: OUTGOING_REQUEST_LIMIT }, () => ({
        nickname: 'Hızlı Kedi',
        avatarId: 'kedi',
      })),
    });
    await prisma.friendRequest.createMany({
      data: others.map((other) => ({ fromId: a.id, toId: other.id })),
    });
    const extra = await createUser();
    await meet(a.id, extra.id);

    expect(await friends.request(a.id, extra.id)).toEqual({
      status: 'error',
      code: SOCKET_ERROR_CODES.friendLimit,
    });
  });

  it('removes a friendship and hides the conversation', async () => {
    const { a, b, conversationId } = await makeFriends();
    expect(await friends.remove(a.id, b.id)).toBe(true);

    expect(await friends.areFriends(a.id, b.id)).toBe(false);
    expect(await prisma.friendRequest.count()).toBe(0);
    expect(await dm.list(b.id)).toEqual([]);
    expect((await dm.send(b.id, conversationId, 'selam')).ok).toBe(false);
  });

  it('reuses the conversation when two people become friends again', async () => {
    const { a, b, conversationId } = await makeFriends();
    await friends.remove(a.id, b.id);
    await friends.request(a.id, b.id);
    const again = accepted(await friends.request(b.id, a.id));

    expect(again.conversationId).toBe(conversationId);
    expect((await dm.list(a.id)).map((entry) => entry.id)).toEqual([conversationId]);
  });
});

describe('blocking', () => {
  const moderation = new ModerationService({
    redis,
    store: createPrismaModerationStore(prisma),
    chat,
    limiter,
    removeFromQueue: async () => {},
    social: {
      haveRelationship: (a, b) => friends.areFriends(a, b),
      directSnapshot: (a, b, limit) => dm.snapshotBetween(a, b, limit),
      afterBlock: (a, b) => friends.disconnect(a, b),
    },
  });

  it('deletes friendship and requests, hides the DM and blocks matching', async () => {
    const { a, b, conversationId } = await makeFriends();
    await redis.del(encounterKey(a.id, b.id), encounterKey(b.id, a.id));

    expect(await moderation.block(a.id, b.id)).toEqual({ ok: true });

    expect(await prisma.friendship.count()).toBe(0);
    expect(await prisma.friendRequest.count()).toBe(0);
    expect(await dm.list(a.id)).toEqual([]);
    expect(await dm.list(b.id)).toEqual([]);
    expect((await dm.send(b.id, conversationId, 'selam')).ok).toBe(false);
    expect(await redis.smembers(blockKey(b.id))).toEqual([a.id]);
  });

  it('prevents new friend requests in either direction', async () => {
    const [a, b] = [await createUser(), await createUser()];
    await meet(a.id, b.id);
    await moderation.block(a.id, b.id);

    expect((await friends.request(a.id, b.id)).status).toBe('error');
    expect((await friends.request(b.id, a.id)).status).toBe('error');
  });

  it('copies DMs into a report before they expire', async () => {
    const { a, b, conversationId } = await makeFriends();
    await redis.del(encounterKey(a.id, b.id), encounterKey(b.id, a.id));
    await dm.send(b.id, conversationId, 'rahatsız edici mesaj', nextTime());

    expect(await moderation.report(a.id, { userId: b.id, reason: 'taciz' })).toEqual({ ok: true });

    const report = await prisma.report.findFirstOrThrow();
    expect(report.matchId).toBeNull();
    expect(JSON.stringify(report.snapshot)).toContain('rahatsız edici mesaj');
  });
});

describe('direct messages', () => {
  it('stores messages with a 24-hour expiry', async () => {
    const { a, conversationId } = await makeFriends();
    const now = nextTime();
    const result = await dm.send(a.id, conversationId, 'selam', now);
    if (!result.ok) throw new Error('Expected ok');

    expect(new Date(result.message.expiresAt).getTime()).toBe(now.getTime() + DM_TTL_MS);
  });

  it('does not read a message past 24 hours and removes it with the purge job', async () => {
    const { a, b, conversationId } = await makeFriends();
    const sentAt = nextTime();
    await dm.send(a.id, conversationId, 'eski mesaj', sentAt);
    await dm.send(a.id, conversationId, 'yeni mesaj', new Date(sentAt.getTime() + 60 * 60 * 1000));
    const later = new Date(sentAt.getTime() + DM_TTL_MS + 1);

    const page = await dm.page(b.id, conversationId, undefined, later);
    expect(page!.messages.map((message) => message.body)).toEqual(['yeni mesaj']);
    expect((await dm.list(b.id, later))[0]!.lastMessage!.body).toBe('yeni mesaj');
    expect(await prisma.message.count()).toBe(2);

    expect(await dm.purgeExpired(later)).toBe(1);

    const remaining = await prisma.message.findMany();
    expect(remaining.map((message) => message.body)).toEqual(['yeni mesaj']);
  });

  it('does not count expired messages as unread', async () => {
    const { a, b, conversationId } = await makeFriends();
    const sentAt = nextTime();
    await dm.send(a.id, conversationId, 'selam', sentAt);

    expect(await dm.unreadTotal(b.id, new Date(sentAt.getTime() + 1000))).toBe(1);
    expect(await dm.unreadTotal(b.id, new Date(sentAt.getTime() + DM_TTL_MS + 1))).toBe(0);
  });

  it('purges in batches until nothing expired is left', async () => {
    const { a, conversationId } = await makeFriends();
    const past = new Date(Date.now() - 1000);
    await prisma.message.createMany({
      data: Array.from({ length: 7 }, () => ({
        conversationId,
        senderId: a.id,
        body: 'x',
        expiresAt: past,
      })),
    });

    expect(await dm.purgeExpired(new Date(), 3)).toBe(7);
    expect(await prisma.message.count()).toBe(0);
  });

  it('allows links in DM but still masks bad words', async () => {
    const { a, conversationId } = await makeFriends();
    const result = await dm.send(a.id, conversationId, 'aptal bak https://example.com', nextTime());
    if (!result.ok) throw new Error('Expected ok');

    expect(result.message.body).toBe('*** bak https://example.com');
  });

  it('refuses outsiders', async () => {
    const { conversationId } = await makeFriends();
    const stranger = await createUser();

    expect((await dm.send(stranger.id, conversationId, 'selam')).ok).toBe(false);
    expect(await dm.page(stranger.id, conversationId)).toBeNull();
  });

  it('tracks unread messages until read', async () => {
    const { a, b, conversationId } = await makeFriends();
    await dm.send(a.id, conversationId, 'bir', nextTime());
    await dm.send(a.id, conversationId, 'iki', nextTime());

    expect(await dm.unreadTotal(b.id, nextTime())).toBe(2);
    expect(await dm.unreadTotal(a.id, nextTime())).toBe(0);
    await dm.markRead(b.id, conversationId, nextTime());
    expect(await dm.unreadTotal(b.id, nextTime())).toBe(0);
  });

  it('pages 30 messages at a time without gaps or repeats', async () => {
    const { a, b, conversationId } = await makeFriends();
    const base = Date.now();
    await prisma.message.createMany({
      data: Array.from({ length: 65 }, (_, index) => ({
        conversationId,
        senderId: a.id,
        body: `m${index}`,
        createdAt: new Date(base - (65 - index) * 1000),
        expiresAt: new Date(base + DM_TTL_MS),
      })),
    });

    const bodies: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await dm.page(b.id, conversationId, cursor);
      expect(page!.messages.length).toBeLessThanOrEqual(DM_PAGE_SIZE);
      bodies.unshift(...page!.messages.map((message) => message.body));
      cursor = page!.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(bodies).toEqual(Array.from({ length: 65 }, (_, index) => `m${index}`));
  });

  it('reports the category where the two met', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const match = await prisma.match.create({
      data: { userAId: a.id, userBId: b.id, category: 'muzik', engine: 'mc', scoreA: 0, scoreB: 0 },
    });
    await meet(a.id, b.id, match.id);
    await friends.request(a.id, b.id);
    const { conversationId } = accepted(await friends.request(b.id, a.id));

    expect((await dm.page(a.id, conversationId))!.metInCategory).toBe('muzik');
    expect((await dm.page(a.id, conversationId))!.messages).toEqual([]);
  });
});

describe('account transfer', () => {
  it('generates codes without confusable characters', () => {
    for (let i = 0; i < 300; i += 1) {
      expect(generateTransferCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it('normalizes typed codes', () => {
    expect(normalizeTransferCode(' k7q2-m9xa ')).toBe('K7Q2M9XA');
  });

  it('redeems a code only once', async () => {
    const user = await createUser();
    const { code } = await transfers.create(user.id);

    expect(await transfers.redeem(code.toLowerCase())).toBe(user.id);
    expect(await transfers.redeem(code)).toBeNull();
  });

  it('lets only one of two simultaneous redeems win', async () => {
    const user = await createUser();
    const { code } = await transfers.create(user.id);
    const results = await Promise.all([transfers.redeem(code), transfers.redeem(code)]);

    expect(results.filter(Boolean)).toEqual([user.id]);
  });

  it('expires after 10 minutes', async () => {
    const user = await createUser();
    const now = new Date();
    const { code } = await transfers.create(user.id, now);

    expect(await transfers.redeem(code, new Date(now.getTime() + TRANSFER_CODE_TTL_MS))).toBeNull();
  });

  it('invalidates the previous code when a new one is shown', async () => {
    const user = await createUser();
    const first = await transfers.create(user.id);
    const second = await transfers.create(user.id);

    expect(await transfers.redeem(first.code)).toBeNull();
    expect(await transfers.redeem(second.code)).toBe(user.id);
  });

  it('issues a working token for the same user over HTTP', async () => {
    const tokens = createTokenService('transfer-test-secret-'.repeat(2));
    const users = createPrismaUserStore(prisma);
    const app = Fastify();
    registerApiRoutes(app, {
      tokens,
      users,
      limiter,
      social: { friends, dm, transfers },
    });
    const user = await createUser();
    const token = await tokens.sign(user.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/me/transfer-code',
      headers: { authorization: `Bearer ${token}` },
    });
    const { code } = transferCodeResponseSchema.parse(created.json());

    const redeem = () =>
      app.inject({ method: 'POST', url: '/api/transfer/redeem', payload: { code } });
    const first = guestResponseSchema.parse((await redeem()).json());

    expect(first.user.id).toBe(user.id);
    expect(await tokens.verify(first.token)).toBe(user.id);
    expect((await redeem()).statusCode).toBe(400);
    await app.close();
  });

  it('limits redeem attempts', async () => {
    const app = Fastify();
    registerApiRoutes(app, {
      tokens: createTokenService('transfer-test-secret-'.repeat(2)),
      users: new MemoryUserStore(),
      limiter,
      social: { friends, dm, transfers },
    });
    const attempt = () =>
      app.inject({ method: 'POST', url: '/api/transfer/redeem', payload: { code: 'AAAA-AAAA' } });

    for (let i = 0; i < 10; i += 1) expect((await attempt()).statusCode).toBe(400);
    expect((await attempt()).statusCode).toBe(429);
    await app.close();
  });
});

describe('game invites', () => {
  let rooms: [string, Candidate, Candidate][];
  let connected: boolean;
  let invites: InviteService;

  beforeEach(() => {
    rooms = [];
    connected = true;
    invites = new InviteService({
      redis,
      friends,
      limiter,
      isConnected: async () => connected,
      removeFromQueue: async () => {},
      createRoom: async (roomId, a, b) => {
        rooms.push([roomId, a, b]);
      },
    });
  });

  const invite = async (from: string, to: string) => {
    const result = await invites.create(from, to, 'socket-from');
    if (!result.ok) throw new Error('Expected invite');
    return result.value.inviteId;
  };

  it('only allows inviting friends', async () => {
    const [a, b] = [await createUser(), await createUser()];
    expect(await invites.create(a.id, b.id, 'socket')).toEqual({
      ok: false,
      code: SOCKET_ERROR_CODES.notAllowed,
    });
  });

  it('starts one room with both sockets and can be accepted once', async () => {
    const { a, b } = await makeFriends();
    const inviteId = await invite(a.id, b.id);

    expect((await invites.accept(inviteId, b.id, 'socket-to')).ok).toBe(true);
    expect((await invites.accept(inviteId, b.id, 'socket-to')).ok).toBe(false);

    expect(rooms).toHaveLength(1);
    expect(rooms[0]![1]).toMatchObject({ userId: a.id, socketId: 'socket-from' });
    expect(rooms[0]![2]).toMatchObject({ userId: b.id, socketId: 'socket-to' });
    expect(await redis.get(activeKey(a.id))).toBe(rooms[0]![0]);
  });

  it('cannot be accepted by anyone else', async () => {
    const { a, b } = await makeFriends();
    const stranger = await createUser();
    const inviteId = await invite(a.id, b.id);

    expect((await invites.accept(inviteId, stranger.id, 'socket')).ok).toBe(false);
    expect((await invites.accept(inviteId, b.id, 'socket-to')).ok).toBe(true);
  });

  it('is unavailable if the inviter left or a player is already in a game', async () => {
    const { a, b } = await makeFriends();
    connected = false;
    expect((await invites.accept(await invite(a.id, b.id), b.id, 'socket')).ok).toBe(false);

    connected = true;
    await redis.set(activeKey(a.id), 'other-room');
    expect((await invites.accept(await invite(a.id, b.id), b.id, 'socket')).ok).toBe(false);
    expect(rooms).toHaveLength(0);
    expect(await redis.get(activeKey(b.id))).toBeNull();
  });

  it('expires after a minute', async () => {
    const { a, b } = await makeFriends();
    const inviteId = await invite(a.id, b.id);
    const ttl = await redis.pttl(`invite:${inviteId}`);

    expect(ttl).toBeGreaterThan(INVITE_TTL_MS - 2000);
    expect(ttl).toBeLessThanOrEqual(INVITE_TTL_MS);
  });

  it('can be withdrawn only by the inviter', async () => {
    const { a, b } = await makeFriends();
    const inviteId = await invite(a.id, b.id);

    expect(await invites.cancel(inviteId, a.id)).toMatchObject({ to: b.id });
    expect((await invites.accept(inviteId, b.id, 'socket')).ok).toBe(false);
  });
});
