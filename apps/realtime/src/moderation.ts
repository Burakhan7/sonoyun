import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  SOCKET_ERROR_CODES,
  type ChatMessage,
  type ReportReason,
  type SocketErrorCode,
} from 'shared';
import { SNAPSHOT_LIMIT, type ChatService } from './chat.js';
import { blockKey } from './matchmaking.js';
import { RATE_RULES, type RateLimiter } from './ratelimit.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;
const AUTO_SUSPEND_REPORTERS = 3;

export const suspendedKey = (userId: string) => `mm:suspended:${userId}`;
/** Records that two users met, so only real opponents can report or block each other. */
export const encounterKey = (userId: string, otherId: string) => `mm:met:${userId}:${otherId}`;
export const ENCOUNTER_TTL_SECONDS = DAY_SECONDS;

export interface NewReport {
  reporterId: string;
  reportedId: string;
  matchId: string | null;
  reason: ReportReason;
  note: string | null;
  snapshot: ChatMessage[];
}

export interface ModerationStore {
  createReport(report: NewReport): Promise<void>;
  countRecentReporters(reportedId: string, since: Date): Promise<number>;
  createBlock(blockerId: string, blockedId: string): Promise<void>;
}

export function createPrismaModerationStore(prisma: PrismaClient): ModerationStore {
  return {
    async createReport({ snapshot, ...report }) {
      await prisma.report.create({
        data: { ...report, snapshot: snapshot as unknown as Prisma.InputJsonValue },
      });
    },
    async countRecentReporters(reportedId, since) {
      const rows = await prisma.report.findMany({
        where: { reportedId, createdAt: { gte: since } },
        distinct: ['reporterId'],
        select: { reporterId: true },
      });
      return rows.length;
    },
    async createBlock(blockerId, blockedId) {
      await prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      });
    },
  };
}

export type ModerationResult = { ok: true } | { ok: false; code: SocketErrorCode };

export interface ModerationOptions {
  redis: Redis;
  store: ModerationStore;
  chat: ChatService;
  limiter: RateLimiter;
  /** Takes a suspended user out of the matchmaking queue. */
  removeFromQueue: (userId: string) => Promise<void>;
  social?: ModerationSocial;
}

/** Friendship and DM hooks. Optional so moderation works without the social features. */
export interface ModerationSocial {
  haveRelationship(userId: string, otherId: string): Promise<boolean>;
  directSnapshot(userId: string, otherId: string, limit: number): Promise<ChatMessage[]>;
  /** Removes friendship and pending requests and hides the DM (SPEC §10). */
  afterBlock(blockerId: string, blockedId: string): Promise<void>;
}

export class ModerationService {
  private readonly redis: Redis;
  private readonly store: ModerationStore;
  private readonly chat: ChatService;
  private readonly limiter: RateLimiter;
  private readonly removeFromQueue: ModerationOptions['removeFromQueue'];
  private readonly social?: ModerationSocial;

  constructor(options: ModerationOptions) {
    this.redis = options.redis;
    this.store = options.store;
    this.chat = options.chat;
    this.limiter = options.limiter;
    this.removeFromQueue = options.removeFromQueue;
    this.social = options.social;
  }

  async isSuspended(userId: string) {
    return (await this.redis.exists(suspendedKey(userId))) === 1;
  }

  async report(
    reporterId: string,
    { userId, reason, note }: { userId: string; reason: ReportReason; note?: string },
    now = new Date(),
  ): Promise<ModerationResult> {
    const matchId = await this.redis.get(encounterKey(reporterId, userId));
    const related = Boolean(matchId) || (await this.social?.haveRelationship(reporterId, userId));
    if (!related || reporterId === userId) {
      return { ok: false, code: SOCKET_ERROR_CODES.notAllowed };
    }
    if (!(await this.limiter.hit(RATE_RULES.report, reporterId, now.getTime()))) {
      return { ok: false, code: SOCKET_ERROR_CODES.rateLimited };
    }

    await this.store.createReport({
      reporterId,
      reportedId: userId,
      matchId,
      reason,
      note: note?.trim() || null,
      snapshot: await this.buildSnapshot(reporterId, userId, matchId),
    });

    const since = new Date(now.getTime() - DAY_MS);
    if ((await this.store.countRecentReporters(userId, since)) >= AUTO_SUSPEND_REPORTERS) {
      await this.redis.set(suspendedKey(userId), '1', 'EX', DAY_SECONDS);
      await this.removeFromQueue(userId);
    }
    return { ok: true };
  }

  /** The last 50 messages across the random chat and the DM, which expire on their own. */
  private async buildSnapshot(reporterId: string, userId: string, matchId: string | null) {
    const [random, direct] = await Promise.all([
      matchId ? this.chat.snapshot(matchId) : [],
      this.social?.directSnapshot(reporterId, userId, SNAPSHOT_LIMIT) ?? [],
    ]);
    return [...random, ...direct].sort((a, b) => a.at.localeCompare(b.at)).slice(-SNAPSHOT_LIMIT);
  }

  async block(blockerId: string, blockedId: string): Promise<ModerationResult> {
    const met =
      (await this.redis.exists(encounterKey(blockerId, blockedId))) === 1 ||
      (await this.social?.haveRelationship(blockerId, blockedId));
    if (!met || blockerId === blockedId) {
      return { ok: false, code: SOCKET_ERROR_CODES.notAllowed };
    }
    await this.store.createBlock(blockerId, blockedId);
    await this.redis
      .pipeline()
      .sadd(blockKey(blockerId), blockedId)
      .sadd(blockKey(blockedId), blockerId)
      .exec();
    await this.social?.afterBlock(blockerId, blockedId);
    return { ok: true };
  }
}
