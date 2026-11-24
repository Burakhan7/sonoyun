import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  AVATAR_IDS,
  adminChatDetailSchema,
  adminChatsResponseSchema,
  serverEventSchemas,
  type AdminChatDetail,
  type AdminChatKind,
  type AdminChatsResponse,
  type AdminChatSummary,
  type ChatMessage,
} from 'shared';
import { CHAT_TTL_SECONDS, messagesKey } from './chat.js';
import type { LiveRoom } from './rooms.js';

/** How far back finished game rooms are looked up; their messages expire 24 h after the last one. */
const ROOM_LOOKBACK_MS = 2 * CHAT_TTL_SECONDS * 1000;
/** A DM counts as an active conversation while its last message is this recent. */
const ACTIVE_DM_MS = 5 * 60 * 1000;
const LIST_LIMIT = 200;
const MESSAGE_LIMIT = 1_000;

export type LiveChat = Pick<LiveRoom, 'id' | 'players' | 'state' | 'friendly' | 'chatEndsAt'>;

type Party = AdminChatSummary['participants'][number];

interface RoomRef {
  id: string;
  players: string[];
  startedAt: Date | null;
  live?: LiveChat;
}

const avatarIds = new Set<string>(AVATAR_IDS);

function parseMessage(raw: string | null): ChatMessage | null {
  if (!raw) return null;
  try {
    const parsed = serverEventSchemas['chat:message'].safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Read-only moderator view of conversations still held by the service: live game chats from
 * memory, finished game chats from Redis (24 h) and DMs from Postgres (24 h, SPEC §10).
 */
export class AdminChatService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly liveRooms: () => Iterable<LiveChat>,
  ) {}

  async list(now = new Date()): Promise<AdminChatsResponse> {
    const [rooms, dms] = await Promise.all([this.roomSummaries(now), this.dmSummaries(now)]);
    const all = [...rooms, ...dms];
    const recency = (chat: AdminChatSummary) => chat.lastMessageAt ?? chat.startedAt ?? '';
    all.sort((a, b) => recency(b).localeCompare(recency(a)));
    return adminChatsResponseSchema.parse({
      active: all.filter((chat) => chat.live),
      stored: all.filter((chat) => !chat.live),
    });
  }

  async detail(kind: AdminChatKind, id: string, now = new Date()): Promise<AdminChatDetail | null> {
    return kind === 'room' ? this.roomDetail(id, now) : this.dmDetail(id, now);
  }

  private liveChats(): Map<string, LiveChat> {
    const live = new Map<string, LiveChat>();
    for (const room of this.liveRooms()) {
      if (room.state === 'CHATTING') live.set(room.id, room);
    }
    return live;
  }

  private async parties(ids: Iterable<string>, now: Date): Promise<Map<string, Party>> {
    const unique = [...new Set(ids)];
    const users = unique.length
      ? await this.prisma.user.findMany({ where: { id: { in: unique } } })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    return new Map(
      unique.map((id) => {
        const user = byId.get(id);
        return [
          id,
          {
            id,
            nickname: user?.nickname ?? null,
            avatarId:
              user && avatarIds.has(user.avatarId) ? (user.avatarId as Party['avatarId']) : null,
            bannedUntil:
              user?.bannedUntil && user.bannedUntil > now ? user.bannedUntil.toISOString() : null,
          },
        ];
      }),
    );
  }

  private async reportedRooms(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.report.findMany({
      where: { matchId: { in: ids }, status: 'open' },
      select: { matchId: true },
    });
    return new Set(rows.flatMap((row) => (row.matchId ? [row.matchId] : [])));
  }

  private async roomRefs(now: Date): Promise<RoomRef[]> {
    const live = this.liveChats();
    const matches = await this.prisma.match.findMany({
      where: {
        OR: [
          { startedAt: { gte: new Date(now.getTime() - ROOM_LOOKBACK_MS) } },
          { id: { in: [...live.keys()] } },
        ],
      },
      orderBy: { startedAt: 'desc' },
      take: LIST_LIMIT,
    });
    const refs = new Map<string, RoomRef>(
      matches.map((match) => [
        match.id,
        { id: match.id, players: [match.userAId, match.userBId], startedAt: match.startedAt },
      ]),
    );
    for (const room of live.values()) {
      const ref = refs.get(room.id) ?? { id: room.id, players: [...room.players], startedAt: null };
      refs.set(room.id, { ...ref, live: room });
    }
    return [...refs.values()];
  }

  private async roomSummaries(now: Date): Promise<AdminChatSummary[]> {
    const refs = await this.roomRefs(now);
    if (refs.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const ref of refs) {
      pipeline.llen(messagesKey(ref.id));
      pipeline.lindex(messagesKey(ref.id), -1);
    }
    const replies = (await pipeline.exec()) ?? [];
    const withMessages = refs.flatMap((ref, index) => {
      const count = Number(replies[index * 2]?.[1] ?? 0);
      const last = parseMessage(replies[index * 2 + 1]?.[1] as string | null);
      // A finished room without messages has nothing to review.
      return count > 0 || ref.live ? [{ ref, count, last }] : [];
    });

    const [parties, reported] = await Promise.all([
      this.parties(
        withMessages.flatMap(({ ref }) => ref.players),
        now,
      ),
      this.reportedRooms(withMessages.map(({ ref }) => ref.id)),
    ]);
    return withMessages.map(({ ref, count, last }) =>
      this.roomSummary(ref, count, last, parties, reported.has(ref.id)),
    );
  }

  private roomSummary(
    ref: RoomRef,
    count: number,
    last: ChatMessage | null,
    parties: Map<string, Party>,
    reported: boolean,
  ): AdminChatSummary {
    const endsAt = ref.live && Number.isFinite(ref.live.chatEndsAt) ? ref.live.chatEndsAt : null;
    return {
      kind: 'room',
      id: ref.id,
      live: Boolean(ref.live),
      friendly: ref.live?.friendly ?? false,
      participants: ref.players.map((id) => parties.get(id)!),
      startedAt: ref.startedAt?.toISOString() ?? null,
      lastMessageAt: last?.at ?? null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      messageCount: count,
      preview: last,
      reported,
    };
  }

  private async roomDetail(id: string, now: Date): Promise<AdminChatDetail | null> {
    const live = this.liveChats().get(id);
    const match = await this.prisma.match.findUnique({ where: { id } });
    if (!match && !live) return null;

    const raw = await this.redis.lrange(messagesKey(id), -MESSAGE_LIMIT, -1);
    const messages = raw.flatMap((entry) => parseMessage(entry) ?? []);
    const ref: RoomRef = {
      id,
      players: live ? [...live.players] : [match!.userAId, match!.userBId],
      startedAt: match?.startedAt ?? null,
      live,
    };
    const [parties, reported] = await Promise.all([
      this.parties(ref.players, now),
      this.reportedRooms([id]),
    ]);
    const chat = this.roomSummary(
      ref,
      messages.length,
      messages.at(-1) ?? null,
      parties,
      reported.has(id),
    );
    return adminChatDetailSchema.parse({ chat, messages });
  }

  private async dmSummaries(now: Date): Promise<AdminChatSummary[]> {
    const groups = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: { expiresAt: { gt: now } },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: LIST_LIMIT,
    });
    if (groups.length === 0) return [];
    const ids = groups.map((group) => group.conversationId);

    const [lastMessages, members] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId: { in: ids }, expiresAt: { gt: now } },
        distinct: ['conversationId'],
        orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.conversationMember.findMany({ where: { conversationId: { in: ids } } }),
    ]);
    const parties = await this.parties(
      members.map((member) => member.userId),
      now,
    );
    const lastById = new Map(lastMessages.map((message) => [message.conversationId, message]));
    const membersById = new Map<string, string[]>();
    for (const member of members) {
      membersById.set(member.conversationId, [
        ...(membersById.get(member.conversationId) ?? []),
        member.userId,
      ]);
    }
    const conversations = await this.prisma.conversation.findMany({ where: { id: { in: ids } } });
    const createdById = new Map(conversations.map((row) => [row.id, row.createdAt]));

    return groups.map((group) =>
      this.dmSummary(
        group.conversationId,
        membersById.get(group.conversationId) ?? [],
        group._count._all,
        lastById.get(group.conversationId) ?? null,
        createdById.get(group.conversationId) ?? null,
        parties,
        now,
      ),
    );
  }

  private dmSummary(
    id: string,
    memberIds: string[],
    count: number,
    last: { id: string; senderId: string; body: string; createdAt: Date } | null,
    startedAt: Date | null,
    parties: Map<string, Party>,
    now: Date,
  ): AdminChatSummary {
    return {
      kind: 'dm',
      id,
      live: last !== null && now.getTime() - last.createdAt.getTime() < ACTIVE_DM_MS,
      friendly: true,
      participants: [...memberIds].sort().map((userId) => parties.get(userId)!),
      startedAt: startedAt?.toISOString() ?? null,
      lastMessageAt: last?.createdAt.toISOString() ?? null,
      endsAt: null,
      messageCount: count,
      preview: last
        ? {
            id: last.id,
            senderId: last.senderId,
            body: last.body,
            at: last.createdAt.toISOString(),
          }
        : null,
      reported: false,
    };
  }

  private async dmDetail(id: string, now: Date): Promise<AdminChatDetail | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: { members: true },
    });
    if (!conversation) return null;
    const rows = await this.prisma.message.findMany({
      where: { conversationId: id, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: MESSAGE_LIMIT,
    });
    rows.reverse();
    const memberIds = conversation.members.map((member) => member.userId);
    const parties = await this.parties(memberIds, now);
    const messages = rows.map((row) => ({
      id: row.id,
      senderId: row.senderId,
      body: row.body,
      at: row.createdAt.toISOString(),
    }));
    const chat = this.dmSummary(
      id,
      memberIds,
      rows.length,
      rows.at(-1) ?? null,
      conversation.createdAt,
      parties,
      now,
    );
    return adminChatDetailSchema.parse({ chat, messages });
  }
}
