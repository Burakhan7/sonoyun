import { Prisma, type PrismaClient } from '@prisma/client';
import {
  CATEGORY_IDS,
  SOCKET_ERROR_CODES,
  conversationsResponseSchema,
  messagesPageSchema,
  type CategoryId,
  type ChatMessage,
  type ConversationSummary,
  type DirectMessage,
  type MessagesPage,
  type SocketErrorCode,
} from 'shared';
import type { ChatService } from './chat.js';
import type { FriendService } from './friends.js';
import type { Presence } from './presence.js';

export const DM_TTL_MS = 24 * 60 * 60 * 1000;
export const DM_PAGE_SIZE = 30;
export const PURGE_BATCH_SIZE = 5_000;

interface MessageRow {
  id: string;
  senderId: string;
  body: string;
  createdAt: Date;
  expiresAt: Date;
}

const toDirectMessage = (row: MessageRow): DirectMessage => ({
  id: row.id,
  senderId: row.senderId,
  body: row.body,
  at: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});

const encodeCursor = (row: MessageRow) => `${row.createdAt.toISOString()}_${row.id}`;

function decodeCursor(cursor: string) {
  const separator = cursor.indexOf('_');
  const createdAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  return separator > 0 && id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

export type DmSendResult =
  { ok: true; message: DirectMessage; recipientId: string } | { ok: false; code: SocketErrorCode };

export class DmService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chat: ChatService,
    private readonly friends: FriendService,
    private readonly presence: Presence,
  ) {}

  /** Returns the other member when the user may use this conversation. */
  private async otherMember(userId: string, conversationId: string) {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true, hidden: true },
    });
    const mine = members.find((member) => member.userId === userId);
    const other = members.find((member) => member.userId !== userId);
    if (!mine || mine.hidden || !other) return null;
    return (await this.friends.areFriends(userId, other.userId)) ? other.userId : null;
  }

  async send(
    userId: string,
    conversationId: string,
    body: string,
    now = new Date(),
  ): Promise<DmSendResult> {
    const recipientId = await this.otherMember(userId, conversationId);
    if (!recipientId) return { ok: false, code: SOCKET_ERROR_CODES.notAllowed };

    const prepared = await this.chat.prepare(userId, body, now.getTime(), { allowContact: true });
    if (!prepared.ok) return prepared;

    const row = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        body: prepared.body,
        createdAt: now,
        expiresAt: new Date(now.getTime() + DM_TTL_MS),
      },
    });
    await this.prisma.conversationMember.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: now },
    });
    return { ok: true, message: toDirectMessage(row), recipientId };
  }

  async markRead(userId: string, conversationId: string, now = new Date()) {
    await this.prisma.conversationMember.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: now },
    });
  }

  /** Newest-first paging of unexpired messages, returned oldest-first for display. */
  async page(
    userId: string,
    conversationId: string,
    cursor?: string,
    now = new Date(),
  ): Promise<MessagesPage | null> {
    const friendId = await this.otherMember(userId, conversationId);
    if (!friendId) return null;

    const before = cursor ? decodeCursor(cursor) : null;
    if (cursor && !before) return null;

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        expiresAt: { gt: now },
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: DM_PAGE_SIZE + 1,
    });
    const hasMore = rows.length > DM_PAGE_SIZE;
    const visible = rows.slice(0, DM_PAGE_SIZE);

    const [friend, online, metInCategory] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: friendId } }),
      this.presence.onlineAmong([friendId]),
      this.metInCategory(userId, friendId),
    ]);
    return messagesPageSchema.parse({
      friend: {
        id: friend.id,
        nickname: friend.nickname,
        avatarId: friend.avatarId,
        online: online.has(friend.id),
      },
      metInCategory,
      messages: visible.map(toDirectMessage).reverse(),
      nextCursor: hasMore ? encodeCursor(visible.at(-1)!) : null,
    });
  }

  private async metInCategory(a: string, b: string): Promise<CategoryId | null> {
    const request = await this.prisma.friendRequest.findFirst({
      where: {
        status: 'accepted',
        matchId: { not: null },
        OR: [
          { fromId: a, toId: b },
          { fromId: b, toId: a },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { matchId: true },
    });
    if (!request?.matchId) return null;
    const match = await this.prisma.match.findUnique({
      where: { id: request.matchId },
      select: { category: true },
    });
    const category = match?.category as CategoryId | undefined;
    return category && CATEGORY_IDS.includes(category) ? category : null;
  }

  private async unreadByConversation(userId: string, now: Date) {
    const rows = await this.prisma.$queryRaw<{ conversationId: string; unread: bigint }[]>`
      SELECT m."conversationId", COUNT(*) AS unread
      FROM "Message" m
      JOIN "ConversationMember" cm
        ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}
      WHERE cm."hidden" = false
        AND m."senderId" <> ${userId}
        AND m."createdAt" > cm."lastReadAt"
        AND m."expiresAt" > ${now}
      GROUP BY m."conversationId"`;
    return new Map(rows.map((row) => [row.conversationId, Number(row.unread)]));
  }

  async unreadTotal(userId: string, now = new Date()) {
    const unread = await this.unreadByConversation(userId, now);
    return [...unread.values()].reduce((sum, count) => sum + count, 0);
  }

  async list(userId: string, now = new Date()): Promise<ConversationSummary[]> {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId, hidden: false },
      select: {
        conversationId: true,
        conversation: { select: { members: { select: { userId: true } } } },
      },
    });
    const entries = memberships.flatMap(({ conversationId, conversation }) => {
      const friendId = conversation.members.find((member) => member.userId !== userId)?.userId;
      return friendId ? [{ conversationId, friendId }] : [];
    });
    if (entries.length === 0) return [];

    const conversationIds = entries.map((entry) => entry.conversationId);
    const friendIds = entries.map((entry) => entry.friendId);
    const [users, online, unread, latest] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: friendIds } } }),
      this.presence.onlineAmong(friendIds),
      this.unreadByConversation(userId, now),
      this.prisma.$queryRaw<(MessageRow & { conversationId: string })[]>`
        SELECT DISTINCT ON ("conversationId")
          "id", "conversationId", "senderId", "body", "createdAt", "expiresAt"
        FROM "Message"
        WHERE "conversationId" IN (${Prisma.join(conversationIds)}) AND "expiresAt" > ${now}
        ORDER BY "conversationId", "createdAt" DESC, "id" DESC`,
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const latestById = new Map(latest.map((row) => [row.conversationId, row]));

    const summaries = entries.flatMap(({ conversationId, friendId }) => {
      const friend = userById.get(friendId);
      if (!friend) return [];
      const last = latestById.get(conversationId);
      return [
        {
          id: conversationId,
          friend: {
            id: friend.id,
            nickname: friend.nickname,
            avatarId: friend.avatarId,
            online: online.has(friend.id),
          },
          lastMessage: last ? toDirectMessage(last) : null,
          unread: unread.get(conversationId) ?? 0,
        },
      ];
    });
    summaries.sort((a, b) => (b.lastMessage?.at ?? '').localeCompare(a.lastMessage?.at ?? ''));
    return conversationsResponseSchema.parse({ conversations: summaries }).conversations;
  }

  /** Last messages between two users, kept for a report before they expire (SPEC §10). */
  async snapshotBetween(a: string, b: string, limit: number, now = new Date()) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }] },
      select: { id: true },
    });
    if (!conversation) return [];
    const rows = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.reverse().map((row): ChatMessage => ({
      id: row.id,
      senderId: row.senderId,
      body: row.body,
      at: row.createdAt.toISOString(),
    }));
  }

  /** Permanently deletes expired messages in batches. Returns how many were removed. */
  async purgeExpired(now = new Date(), batchSize = PURGE_BATCH_SIZE) {
    let total = 0;
    for (;;) {
      const removed = await this.prisma.$executeRaw`
        DELETE FROM "Message"
        WHERE "id" IN (
          SELECT "id" FROM "Message" WHERE "expiresAt" <= ${now} LIMIT ${batchSize}
        )`;
      total += removed;
      if (removed < batchSize) return total;
    }
  }
}
