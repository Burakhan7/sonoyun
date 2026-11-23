import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readBearerToken, type TokenService } from './auth.js';
import { clientIp } from './client-ip.js';
import { RATE_RULES, type RateLimiter } from './ratelimit.js';
import { registerSocialRoutes, type SocialRouteDeps } from './social-routes.js';
import {
  IDENTITY_REFRESH_MS,
  nextIdentityRefreshAt,
  randomIdentity,
  toPublicUser,
  type UserRecord,
  type UserStore,
} from './users.js';

export interface ApiDeps {
  tokens: TokenService;
  users: UserStore;
  limiter?: RateLimiter;
  guestLimitPerHour?: number;
  trustProxy?: boolean;
  /** Proves a request came from the web app, whose forwarded client IP can then be trusted. */
  internalSecret?: string;
  social?: Pick<SocialRouteDeps, 'friends' | 'dm' | 'transfers' | 'onFriendRemoved'>;
}

const DEFAULT_GUEST_LIMIT_PER_HOUR = 30;
const sha256 = (value: string) => createHash('sha256').update(value).digest();

export function registerApiRoutes(
  app: FastifyInstance,
  {
    tokens,
    users,
    limiter,
    guestLimitPerHour = DEFAULT_GUEST_LIMIT_PER_HOUR,
    trustProxy = false,
    internalSecret,
    social,
  }: ApiDeps,
) {
  function requestIp(request: FastifyRequest) {
    const secret = request.headers['x-internal-secret'];
    const forwarded = request.headers['x-client-ip'];
    if (
      internalSecret &&
      typeof secret === 'string' &&
      timingSafeEqual(sha256(secret), sha256(internalSecret)) &&
      typeof forwarded === 'string' &&
      isIP(forwarded)
    ) {
      return forwarded;
    }
    return clientIp(
      { address: request.socket.remoteAddress ?? request.ip, headers: request.headers },
      trustProxy,
    );
  }

  async function findRequestUser(request: FastifyRequest) {
    const token = readBearerToken(request.headers.authorization);
    if (!token) return null;
    const userId = await tokens.verify(token);
    if (!userId) return null;
    const user = await users.findById(userId);
    return user ? { token, user } : null;
  }

  async function requireUser(request: FastifyRequest, reply: FastifyReply) {
    const session = await findRequestUser(request);
    if (!session) {
      await reply.code(401).send({ code: 'unauthorized' });
      return null;
    }
    if (limiter && !(await limiter.hit(RATE_RULES.account, session.user.id))) {
      await reply.code(429).send({ code: 'rate_limited' });
      return null;
    }
    return session.user;
  }

  async function reload(user: UserRecord) {
    const updated = await users.findById(user.id);
    if (!updated) throw new Error(`User disappeared: ${user.id}`);
    return updated;
  }

  // Returns the existing guest when the caller holds a valid token, so reloads never add users.
  app.post('/api/guest', async (request, reply) => {
    const now = new Date();
    const session = await findRequestUser(request);
    if (session) return { token: session.token, user: toPublicUser(session.user, now) };

    if (limiter) {
      const rule = { name: 'guest', limit: guestLimitPerHour, windowMs: 60 * 60 * 1000 };
      if (!(await limiter.hit(rule, requestIp(request)))) {
        return reply.code(429).send({ code: 'rate_limited' });
      }
    }

    const user = await users.create(randomIdentity());
    const token = await tokens.sign(user.id);
    return reply.code(201).send({ token, user: toPublicUser(user, now) });
  });

  app.post('/api/me/accept-terms', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;

    const now = new Date();
    await users.acceptTerms(user.id, now);
    return { user: toPublicUser(await reload(user), now) };
  });

  app.post('/api/me/identity', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;

    const now = new Date();
    const cutoff = new Date(now.getTime() - IDENTITY_REFRESH_MS);
    const applied = await users.refreshIdentity(
      user.id,
      randomIdentity(user.nickname),
      cutoff,
      now,
    );
    const updated = await reload(user);

    if (!applied) {
      const next = nextIdentityRefreshAt(updated, now) ?? new Date(now.getTime() + 1000);
      return reply
        .code(429)
        .send({ code: 'identity_refresh_limit', nextIdentityRefreshAt: next.toISOString() });
    }
    return { user: toPublicUser(updated, now) };
  });

  if (social) {
    registerSocialRoutes(app, { ...social, tokens, users, limiter, requestIp, requireUser });
  }
}
