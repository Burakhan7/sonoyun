import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  SOCKET_ERROR_CODES,
  type ChatMessage,
  type ReportReason,
  type SocketErrorCode,
} from 'shared';
import type { ChatService } from './chat.js';
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
  matchId: string;
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
}

export class ModerationService {
  private readonly redis: Redis;
  private readonly store: ModerationStore;
  private readonly chat: ChatService;
  private readonly limiter: RateLimiter;
  private readonly removeFromQueue: ModerationOptions['removeFromQueue'];

  constructor(options: ModerationOptions) {
    this.redis = options.redis;
    this.store = options.store;
    this.chat = options.chat;
    this.limiter = options.limiter;
    this.removeFromQueue = options.removeFromQueue;
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
    if (!matchId || reporterId === userId) {
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
      snapshot: await this.chat.snapshot(matchId),
    });

    const since = new Date(now.getTime() - DAY_MS);
    if ((await this.store.countRecentReporters(userId, since)) >= AUTO_SUSPEND_REPORTERS) {
      await this.redis.set(suspendedKey(userId), '1', 'EX', DAY_SECONDS);
      await this.removeFromQueue(userId);
    }
    return { ok: true };
  }

  async block(blockerId: string, blockedId: string): Promise<ModerationResult> {
    const met = await this.redis.exists(encounterKey(blockerId, blockedId));
    if (!met || blockerId === blockedId) {
      return { ok: false, code: SOCKET_ERROR_CODES.notAllowed };
    }
    await this.store.createBlock(blockerId, blockedId);
    await this.redis
      .pipeline()
      .sadd(blockKey(blockerId), blockedId)
      .sadd(blockKey(blockedId), blockerId)
      .exec();
    return { ok: true };
  }
}
