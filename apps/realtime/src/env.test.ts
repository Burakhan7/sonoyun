import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

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
