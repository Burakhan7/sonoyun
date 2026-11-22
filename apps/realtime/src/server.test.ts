import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';

describe('buildServer', () => {
  const { app } = buildServer({ webOrigin: 'http://localhost:3100' });

  afterEach(async () => {
    await app.close();
  });

  it('responds on /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('loadEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('applies defaults', () => {
    expect(loadEnv(valid)).toMatchObject({ PORT: 4000, WEB_ORIGIN: 'http://localhost:3100' });
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'] as const)('requires %s', (key) => {
    expect(() => loadEnv({ ...valid, [key]: undefined })).toThrow();
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'short' })).toThrow();
  });
});
