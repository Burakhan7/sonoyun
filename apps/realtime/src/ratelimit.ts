import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface RateRule {
  name: string;
  limit: number;
  windowMs: number;
}

// SPEC §5.6 and §15.
export const RATE_RULES = {
  queueJoin: { name: 'queue', limit: 10, windowMs: 60_000 },
  chatPerSecond: { name: 'chat1', limit: 1, windowMs: 1_000 },
  chatBurst: { name: 'chat10', limit: 6, windowMs: 10_000 },
  report: { name: 'report', limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  account: { name: 'account', limit: 120, windowMs: 60_000 },
  friendRequest: { name: 'friend', limit: 20, windowMs: 60 * 60 * 1000 },
  transferRedeem: { name: 'transfer', limit: 10, windowMs: 15 * 60 * 1000 },
  invite: { name: 'invite', limit: 20, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateRule>;

const SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return 1`;

export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  /** Records an attempt and returns false when the rule's limit is already reached. */
  async hit(rule: RateRule, subject: string, now = Date.now()): Promise<boolean> {
    const allowed = await this.redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      `rl:${rule.name}:${subject}`,
      now,
      rule.windowMs,
      rule.limit,
      randomUUID(),
    );
    return allowed === 1;
  }
}
