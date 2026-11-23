import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  SOCKET_ERROR_CODES,
  friendsResponseSchema,
  type FriendsResponse,
  type SocketErrorCode,
} from 'shared';
import { encounterKey } from './moderation.js';
import type { Presence } from './presence.js';
import { RATE_RULES, type RateLimiter } from './ratelimit.js';

export const FRIEND_LIMIT = 200;
export const OUTGOING_REQUEST_LIMIT = 50;

type Tx = Prisma.TransactionClient;

const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 };

export type FriendResult =
  | { status: 'pending'; requestId: string; created: boolean }
  | { status: 'accepted'; friendId: string; conversationId: string }
  | { status: 'declined' }
  | { status: 'error'; code: SocketErrorCode };

const failure = (code: SocketErrorCode): FriendResult => ({ status: 'error', code });

const orderedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** Serializes every change to one pair, so mutual requests cannot create duplicates. */
async function lockPair(tx: Tx, a: string, b: string) {
  const [low, high] = orderedPair(a, b);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${low}:${high}`}, 0))`;
}

async function findConversationId(db: Tx | PrismaClient, a: string, b: string) {
  const conversation = await db.conversation.findFirst({
    where: { AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }] },
    select: { id: true },
  });
  return conversation?.id ?? null;
}

function countFriends(tx: Tx, userId: string) {
  return tx.friendship.count({ where: { OR: [{ userLowId: userId }, { userHighId: userId }] } });
}

async function becomeFriends(tx: Tx, requestId: string, a: string, b: string) {
  const [friendsA, friendsB] = await Promise.all([countFriends(tx, a), countFriends(tx, b)]);
  if (friendsA >= FRIEND_LIMIT || friendsB >= FRIEND_LIMIT) return null;

  const [userLowId, userHighId] = orderedPair(a, b);
  await tx.friendRequest.update({ where: { id: requestId }, data: { status: 'accepted' } });
  await tx.friendship.upsert({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    create: { userLowId, userHighId },
    update: {},
  });

  const existing = await findConversationId(tx, a, b);
  if (existing) {
    await tx.conversationMember.updateMany({
      where: { conversationId: existing },
      data: { hidden: false },
    });
    return existing;
  }
  const created = await tx.conversation.create({
    data: { members: { create: [{ userId: a }, { userId: b }] } },
    select: { id: true },
  });
  return created.id;
}

export class FriendService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly limiter: RateLimiter,
    private readonly presence: Presence,
  ) {}

  async areFriends(a: string, b: string) {
    const [userLowId, userHighId] = orderedPair(a, b);
    const row = await this.prisma.friendship.findUnique({
      where: { userLowId_userHighId: { userLowId, userHighId } },
      select: { userLowId: true },
    });
    return row !== null;
  }

  /** Sends a request to someone met in the last 24 hours; a mutual request is auto-accepted. */
  async request(fromId: string, toId: string): Promise<FriendResult> {
    if (fromId === toId) return failure(SOCKET_ERROR_CODES.notAllowed);
    const matchId = await this.redis.get(encounterKey(fromId, toId));
    if (!matchId) return failure(SOCKET_ERROR_CODES.notAllowed);
    if (!(await this.limiter.hit(RATE_RULES.friendRequest, fromId))) {
      return failure(SOCKET_ERROR_CODES.rateLimited);
    }

    return this.prisma.$transaction(async (tx) => {
      await lockPair(tx, fromId, toId);
      const blocked = await tx.block.count({
        where: {
          OR: [
            { blockerId: fromId, blockedId: toId },
            { blockerId: toId, blockedId: fromId },
          ],
        },
      });
      if (blocked > 0) return failure(SOCKET_ERROR_CODES.notAllowed);

      const [userLowId, userHighId] = orderedPair(fromId, toId);
      const friendship = await tx.friendship.findUnique({
        where: { userLowId_userHighId: { userLowId, userHighId } },
      });
      if (friendship) return failure(SOCKET_ERROR_CODES.alreadyFriends);

      const reverse = await tx.friendRequest.findUnique({
        where: { fromId_toId: { fromId: toId, toId: fromId } },
      });
      if (reverse?.status === 'pending') {
        const conversationId = await becomeFriends(tx, reverse.id, fromId, toId);
        if (!conversationId) return failure(SOCKET_ERROR_CODES.friendLimit);
        return { status: 'accepted', friendId: toId, conversationId } as const;
      }

      const existing = await tx.friendRequest.findUnique({
        where: { fromId_toId: { fromId, toId } },
      });
      if (existing?.status === 'pending') {
        return { status: 'pending', requestId: existing.id, created: false } as const;
      }
      const outgoing = await tx.friendRequest.count({ where: { fromId, status: 'pending' } });
      if (outgoing >= OUTGOING_REQUEST_LIMIT) return failure(SOCKET_ERROR_CODES.friendLimit);

      const saved = await tx.friendRequest.upsert({
        where: { fromId_toId: { fromId, toId } },
        create: { fromId, toId, matchId },
        update: { status: 'pending', matchId, createdAt: new Date() },
      });
      return { status: 'pending', requestId: saved.id, created: true } as const;
    }, TRANSACTION_OPTIONS);
  }

  async respond(userId: string, requestId: string, accept: boolean): Promise<FriendResult> {
    const request = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request || request.toId !== userId) return failure(SOCKET_ERROR_CODES.notAllowed);

    return this.prisma.$transaction(async (tx) => {
      await lockPair(tx, request.fromId, request.toId);
      const current = await tx.friendRequest.findUnique({ where: { id: requestId } });
      if (current?.status !== 'pending') return failure(SOCKET_ERROR_CODES.notAllowed);

      if (!accept) {
        await tx.friendRequest.update({ where: { id: requestId }, data: { status: 'declined' } });
        return { status: 'declined' } as const;
      }
      const conversationId = await becomeFriends(tx, requestId, request.fromId, request.toId);
      if (!conversationId) return failure(SOCKET_ERROR_CODES.friendLimit);
      return { status: 'accepted', friendId: request.fromId, conversationId } as const;
    }, TRANSACTION_OPTIONS);
  }

  async cancel(userId: string, requestId: string) {
    const { count } = await this.prisma.friendRequest.updateMany({
      where: { id: requestId, fromId: userId, status: 'pending' },
      data: { status: 'cancelled' },
    });
    return count === 1;
  }

  /** Ends a friendship: requests are cleared and the DM is hidden for both. */
  async remove(userId: string, otherId: string) {
    if (!(await this.areFriends(userId, otherId))) return false;
    await this.disconnect(userId, otherId);
    return true;
  }

  async disconnect(a: string, b: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockPair(tx, a, b);
      const [userLowId, userHighId] = orderedPair(a, b);
      await tx.friendship.deleteMany({ where: { userLowId, userHighId } });
      await tx.friendRequest.deleteMany({
        where: {
          OR: [
            { fromId: a, toId: b },
            { fromId: b, toId: a },
          ],
        },
      });
      const conversationId = await findConversationId(tx, a, b);
      if (conversationId) {
        await tx.conversationMember.updateMany({
          where: { conversationId },
          data: { hidden: true },
        });
      }
    }, TRANSACTION_OPTIONS);
  }

  async list(userId: string): Promise<FriendsResponse> {
    const [friendships, requests] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
      }),
      this.prisma.friendRequest.findMany({
        where: { status: 'pending', OR: [{ fromId: userId }, { toId: userId }] },
        include: { from: true, to: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const friendIds = friendships.map((row) =>
      row.userLowId === userId ? row.userHighId : row.userLowId,
    );
    const [users, online, memberships] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: friendIds } } }),
      this.presence.onlineAmong(friendIds),
      this.prisma.conversationMember.findMany({
        where: {
          userId: { in: friendIds },
          conversation: { members: { some: { userId } } },
        },
        select: { userId: true, conversationId: true },
      }),
    ]);
    const conversationOf = new Map(memberships.map((row) => [row.userId, row.conversationId]));
    const person = (user: { id: string; nickname: string; avatarId: string }) => ({
      id: user.id,
      nickname: user.nickname,
      avatarId: user.avatarId,
    });

    return friendsResponseSchema.parse({
      friends: users
        .map((user) => ({
          ...person(user),
          online: online.has(user.id),
          conversationId: conversationOf.get(user.id) ?? null,
        }))
        .sort(
          (a, b) =>
            Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname, 'tr'),
        ),
      incoming: requests
        .filter((request) => request.toId === userId)
        .map((request) => ({ requestId: request.id, user: person(request.from) })),
      outgoing: requests
        .filter((request) => request.fromId === userId)
        .map((request) => ({ requestId: request.id, user: person(request.to) })),
    });
  }
}
