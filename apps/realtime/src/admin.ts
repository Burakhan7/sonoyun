import { createHash, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import {
  ADMIN_CHAT_KINDS,
  adminBanSchema,
  adminReportStatusSchema,
  adminReportsResponseSchema,
  type AdminChatKind,
  type AdminReport,
} from 'shared';
import type { AdminChatService } from './admin-chats.js';
import { suspendedKey } from './moderation.js';

const REPORT_PAGE_SIZE = 200;
const PRIORITY_REASON = 'reşit-olmayan';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export class AdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    /** Disconnects a banned user's live sessions and removes them from the queue. */
    private readonly kickUser: (userId: string) => Promise<void>,
  ) {}

  /** Open reports, with suspected-minor reports first and then oldest first (SPEC §15). */
  async listReports(status: string): Promise<AdminReport[]> {
    const rows = await this.prisma.report.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: REPORT_PAGE_SIZE,
    });
    const userIds = [...new Set(rows.flatMap((row) => [row.reporterId, row.reportedId]))];
    const [users, openCounts] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } } }),
      this.prisma.report.groupBy({
        by: ['reportedId'],
        where: { status: 'open', reportedId: { in: userIds } },
        _count: { _all: true },
      }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const openById = new Map(openCounts.map((row) => [row.reportedId, row._count._all]));
    const reportedIds = [...new Set(rows.map((row) => row.reportedId))];
    const suspendedFlags = await Promise.all(
      reportedIds.map(async (id) => [id, await this.redis.exists(suspendedKey(id))] as const),
    );
    const suspended = new Map(suspendedFlags);
    const now = new Date();

    const reports = rows.map((row) => {
      const reported = userById.get(row.reportedId);
      return {
        id: row.id,
        reason: row.reason,
        note: row.note,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        matchId: row.matchId,
        priority: row.reason === PRIORITY_REASON,
        snapshot: row.snapshot,
        reporter: {
          id: row.reporterId,
          nickname: userById.get(row.reporterId)?.nickname ?? null,
        },
        reported: {
          id: row.reportedId,
          nickname: reported?.nickname ?? null,
          bannedUntil:
            reported?.bannedUntil && reported.bannedUntil > now
              ? reported.bannedUntil.toISOString()
              : null,
          suspended: suspended.get(row.reportedId) === 1,
          openReports: openById.get(row.reportedId) ?? 0,
        },
      };
    });
    reports.sort((a, b) => Number(b.priority) - Number(a.priority));
    return adminReportsResponseSchema.parse({ reports }).reports;
  }

  async setReportStatus(id: string, status: string) {
    const { count } = await this.prisma.report.updateMany({ where: { id }, data: { status } });
    return count === 1;
  }

  async ban(userId: string, hours: number, now = new Date()) {
    const bannedUntil = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { bannedUntil },
    });
    if (count !== 1) return false;
    await this.kickUser(userId);
    return true;
  }

  /** Lifts both a ban and the automatic 24-hour matchmaking suspension. */
  async unban(userId: string) {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { bannedUntil: null },
    });
    await this.redis.del(suspendedKey(userId));
    return count === 1;
  }
}

/** Internal routes, reachable only with the secret shared with the web app. */
export function registerAdminRoutes(
  app: FastifyInstance,
  admin: AdminService,
  internalSecret: string,
  chats?: AdminChatService,
) {
  const expected = sha256(internalSecret);
  const authorized = (request: FastifyRequest) => {
    const provided = request.headers['x-internal-secret'];
    return typeof provided === 'string' && timingSafeEqual(sha256(provided), expected);
  };
  const param = (request: FastifyRequest, name: string) =>
    (request.params as Record<string, string>)[name] ?? '';

  void app.register(
    async (scope) => {
      scope.addHook('onRequest', async (request, reply) => {
        if (!authorized(request)) await reply.code(404).send({ code: 'not_found' });
      });

      scope.get('/reports', async (request) => {
        const { status } = request.query as { status?: string };
        const parsed = adminReportStatusSchema.safeParse({ status: status ?? 'open' });
        return { reports: await admin.listReports(parsed.success ? parsed.data.status : 'open') };
      });

      scope.post('/reports/:id/status', async (request, reply) => {
        const parsed = adminReportStatusSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ code: 'invalid_payload' });
        const updated = await admin.setReportStatus(param(request, 'id'), parsed.data.status);
        return updated ? { ok: true } : reply.code(404).send({ code: 'not_found' });
      });

      scope.post('/users/:id/ban', async (request, reply) => {
        const parsed = adminBanSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ code: 'invalid_payload' });
        const userId = param(request, 'id');
        const banned = await admin.ban(userId, parsed.data.hours);
        if (!banned) return reply.code(404).send({ code: 'not_found' });
        request.log.info({ userId, hours: parsed.data.hours }, 'Admin banned user');
        return { ok: true };
      });

      scope.get('/chats', async (_request, reply) => {
        if (!chats) return reply.code(404).send({ code: 'not_found' });
        return chats.list();
      });

      scope.get('/chats/:kind/:id', async (request, reply) => {
        const kind = param(request, 'kind');
        const id = param(request, 'id');
        if (!chats || !ADMIN_CHAT_KINDS.includes(kind as AdminChatKind)) {
          return reply.code(404).send({ code: 'not_found' });
        }
        const detail = await chats.detail(kind as AdminChatKind, id);
        if (!detail) return reply.code(404).send({ code: 'not_found' });
        // Every opened conversation is recorded, so moderator access can be audited.
        request.log.info({ kind, chatId: id }, 'Admin opened chat');
        return detail;
      });

      scope.post('/users/:id/unban', async (request, reply) => {
        const userId = param(request, 'id');
        if (!(await admin.unban(userId))) return reply.code(404).send({ code: 'not_found' });
        request.log.info({ userId }, 'Admin lifted restrictions');
        return { ok: true };
      });
    },
    { prefix: '/internal/admin' },
  );
}
