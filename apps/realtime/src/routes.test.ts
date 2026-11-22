import Fastify from 'fastify';
import { SignJWT, decodeProtectedHeader, decodeJwt } from 'jose';
import { guestResponseSchema, userResponseSchema, identityLimitResponseSchema } from 'shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTokenService } from './auth.js';
import { registerApiRoutes } from './routes.js';
import { MemoryUserStore } from './test/memory-store.js';
import { IDENTITY_REFRESH_MS, randomIdentity } from './users.js';

const secret = 'test-secret-'.repeat(4);

describe('guest API', () => {
  const tokens = createTokenService(secret);
  let users: MemoryUserStore;
  let app: ReturnType<typeof Fastify>;

  const post = (url: string, token?: string) =>
    app.inject({
      method: 'POST',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  const createGuest = async () => guestResponseSchema.parse((await post('/api/guest')).json());

  beforeEach(() => {
    users = new MemoryUserStore();
    app = Fastify();
    registerApiRoutes(app, { tokens, users });
  });

  it('creates a guest with a matching avatar and a 365-day HS256 token', async () => {
    const response = await post('/api/guest');
    const { token, user } = guestResponseSchema.parse(response.json());
    const claims = decodeJwt(token);

    expect(response.statusCode).toBe(201);
    expect(user.termsAccepted).toBe(false);
    expect(user.nickname.split(' ').length).toBeGreaterThanOrEqual(2);
    expect(decodeProtectedHeader(token).alg).toBe('HS256');
    expect(claims.sub).toBe(user.id);
    expect(claims.exp! - claims.iat!).toBe(365 * 24 * 60 * 60);
  });

  it('returns the same user for a valid token', async () => {
    const guest = await createGuest();
    const again = guestResponseSchema.parse((await post('/api/guest', guest.token)).json());

    expect(again.user.id).toBe(guest.user.id);
    expect(users.records.size).toBe(1);
  });

  it('creates a new user when the token is signed with another key', async () => {
    const guest = await createGuest();
    const forged = await createTokenService('other-secret-'.repeat(4)).sign(guest.user.id);
    const response = await post('/api/guest', forged);

    expect(response.statusCode).toBe(201);
    expect(guestResponseSchema.parse(response.json()).user.id).not.toBe(guest.user.id);
  });

  it('rejects tokens using another algorithm', async () => {
    const guest = await createGuest();
    const key = new TextEncoder().encode(secret);
    const wrongAlg = await new SignJWT()
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(guest.user.id)
      .setExpirationTime('1h')
      .sign(key);

    expect(await tokens.verify(wrongAlg)).toBeNull();
  });

  it('records terms acceptance once', async () => {
    const guest = await createGuest();
    const first = userResponseSchema.parse(
      (await post('/api/me/accept-terms', guest.token)).json(),
    );
    const acceptedAt = users.records.get(guest.user.id)!.acceptedTermsAt;
    await post('/api/me/accept-terms', guest.token);

    expect(first.user.termsAccepted).toBe(true);
    expect(users.records.get(guest.user.id)!.acceptedTermsAt).toBe(acceptedAt);
  });

  it('requires a token for account routes', async () => {
    expect((await post('/api/me/accept-terms')).statusCode).toBe(401);
    expect((await post('/api/me/identity', 'invalid')).statusCode).toBe(401);
  });

  it('allows one identity refresh per day', async () => {
    const guest = await createGuest();
    const first = await post('/api/me/identity', guest.token);
    const refreshed = userResponseSchema.parse(first.json()).user;
    const second = await post('/api/me/identity', guest.token);

    expect(first.statusCode).toBe(200);
    expect(refreshed.nickname).not.toBe(guest.user.nickname);
    expect(refreshed.nextIdentityRefreshAt).not.toBeNull();
    expect(second.statusCode).toBe(429);
    expect(identityLimitResponseSchema.parse(second.json()).nextIdentityRefreshAt).toBe(
      refreshed.nextIdentityRefreshAt,
    );
    expect(users.records.get(guest.user.id)!.nickname).toBe(refreshed.nickname);
  });

  it('allows another identity refresh after 24 hours', async () => {
    const guest = await createGuest();
    users.records.get(guest.user.id)!.nicknameChangedAt = new Date(
      Date.now() - IDENTITY_REFRESH_MS - 1000,
    );

    expect((await post('/api/me/identity', guest.token)).statusCode).toBe(200);
  });
});

describe('randomIdentity', () => {
  it('uses the avatar animal in the nickname and avoids the current one', () => {
    for (let i = 0; i < 200; i += 1) {
      const current = randomIdentity();
      const next = randomIdentity(current.nickname);
      expect(next.nickname).not.toBe(current.nickname);
    }
  });
});
