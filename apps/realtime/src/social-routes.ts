import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { transferRedeemSchema, unreadResponseSchema } from 'shared';
import type { TokenService } from './auth.js';
import type { DmService } from './dm.js';
import type { FriendService } from './friends.js';
import { RATE_RULES, type RateLimiter } from './ratelimit.js';
import type { TransferService } from './transfer.js';
import { toPublicUser, type UserRecord, type UserStore } from './users.js';

export interface SocialRouteDeps {
  friends: FriendService;
  dm: DmService;
  transfers: TransferService;
  tokens: TokenService;
  users: UserStore;
  limiter?: RateLimiter;
  requestIp: (request: FastifyRequest) => string;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<UserRecord | null>;
  /** Tells the other side's open pages that the friendship ended. */
  onFriendRemoved?: (userId: string, friendId: string) => void;
}

const param = (request: FastifyRequest, name: string) =>
  (request.params as Record<string, string>)[name] ?? '';

export function registerSocialRoutes(app: FastifyInstance, deps: SocialRouteDeps) {
  const { friends, dm, transfers, tokens, users, limiter, requestIp, requireUser } = deps;

  app.get('/api/friends', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    return friends.list(user.id);
  });

  app.post('/api/friends/:userId/remove', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const friendId = param(request, 'userId');
    if (!(await friends.remove(user.id, friendId))) {
      return reply.code(404).send({ code: 'not_found' });
    }
    deps.onFriendRemoved?.(user.id, friendId);
    return { ok: true };
  });

  app.post('/api/friends/requests/:requestId/cancel', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await friends.cancel(user.id, param(request, 'requestId')))) {
      return reply.code(404).send({ code: 'not_found' });
    }
    return { ok: true };
  });

  app.get('/api/conversations', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    return { conversations: await dm.list(user.id) };
  });

  app.get('/api/conversations/:id/messages', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const { before } = request.query as { before?: string };
    const page = await dm.page(user.id, param(request, 'id'), before);
    if (!page) return reply.code(404).send({ code: 'not_found' });
    return page;
  });

  app.get('/api/me/unread', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    return unreadResponseSchema.parse({ unread: await dm.unreadTotal(user.id) });
  });

  app.post('/api/me/transfer-code', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const { code, expiresAt } = await transfers.create(user.id);
    return { code, expiresAt: expiresAt.toISOString() };
  });

  app.post('/api/transfer/redeem', async (request, reply) => {
    if (limiter && !(await limiter.hit(RATE_RULES.transferRedeem, requestIp(request)))) {
      return reply.code(429).send({ code: 'rate_limited' });
    }
    const body = transferRedeemSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'invalid_code' });

    const userId = await transfers.redeem(body.data.code);
    const user = userId ? await users.findById(userId) : null;
    if (!user) return reply.code(400).send({ code: 'invalid_code' });
    return { token: await tokens.sign(user.id), user: toPublicUser(user, new Date()) };
  });
}
