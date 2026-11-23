import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { messagesKey } from './chat.js';
import { blockKey, recentKey } from './matchmaking.js';
import { muteKey } from './chat.js';
import { suspendedKey } from './moderation.js';
import { recentCategoriesKey, seenKey } from './rooms.js';

export const DELETED_USER_ID = 'deleted';

const CHAT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes an account (SPEC §15). AccessLog and moderation reports are kept: the first is a legal
 * record and the second is evidence for complaints. Their retention is a pending legal decision.
 */
export class AccountService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async delete(userId: string, now = new Date()) {
    const recentMatches = await this.prisma.match.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        startedAt: { gte: new Date(now.getTime() - CHAT_RETENTION_MS) },
      },
      select: { id: true },
    });
    const blocks = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    });

    await this.prisma.$transaction(
      async (tx) => {
        const memberships = await tx.conversationMember.findMany({
          where: { userId },
          select: { conversationId: true },
        });
        const conversationIds = memberships.map((row) => row.conversationId);
        await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await tx.conversationMember.deleteMany({
          where: { conversationId: { in: conversationIds } },
        });
        await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } });
        await tx.friendship.deleteMany({
          where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
        });
        await tx.friendRequest.deleteMany({
          where: { OR: [{ fromId: userId }, { toId: userId }] },
        });
        await tx.block.deleteMany({
          where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        });
        await tx.transferCode.deleteMany({ where: { userId } });

        // Game statistics stay, but no longer point to the person.
        await tx.match.updateMany({
          where: { userAId: userId },
          data: { userAId: DELETED_USER_ID },
        });
        await tx.match.updateMany({
          where: { userBId: userId },
          data: { userBId: DELETED_USER_ID },
        });
        await tx.match.updateMany({
          where: { winnerId: userId },
          data: { winnerId: DELETED_USER_ID },
        });
        await tx.$executeRaw`
          UPDATE "Match" SET "chatRating" = "chatRating" - ${userId}
          WHERE jsonb_exists("chatRating", ${userId})`;
        await tx.user.delete({ where: { id: userId } });
      },
      { maxWait: 5_000, timeout: 15_000 },
    );

    await this.clearRedis(
      userId,
      recentMatches.map((match) => match.id),
      blocks.map((block) => (block.blockerId === userId ? block.blockedId : block.blockerId)),
    );
  }

  private async clearRedis(userId: string, matchIds: string[], blockedWith: string[]) {
    const keys = [
      recentKey(userId),
      blockKey(userId),
      seenKey(userId),
      recentCategoriesKey(userId),
      muteKey(userId),
      suspendedKey(userId),
      ...matchIds.map(messagesKey),
      ...(await this.scan(`mm:met:${userId}:*`)),
      ...(await this.scan(`mm:met:*:${userId}`)),
      ...(await this.scan(`rl:*:${userId}`)),
    ];
    const pipeline = this.redis.pipeline();
    pipeline.del(...keys);
    for (const otherId of blockedWith) pipeline.srem(blockKey(otherId), userId);
    await pipeline.exec();
  }

  private async scan(pattern: string) {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      found.push(...keys);
    } while (cursor !== '0');
    return found;
  }
}
