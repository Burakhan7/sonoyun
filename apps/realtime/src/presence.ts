import type { Redis } from 'ioredis';
import type { OnlineCount } from 'shared';

const ONLINE_KEY = 'presence:online';
const ACTIVE_ROOMS_KEY = 'rooms:active';
/** Lets counters from a crashed instance expire instead of inflating the real online count. */
const CONNECTION_TTL_SECONDS = 30;

const RELEASE_SCRIPT = `
local remaining = redis.call('DECR', KEYS[1])
if remaining <= 0 then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[1])
end
return remaining`;

const SWEEP_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return redis.call('SREM', KEYS[2], ARGV[1])
end
return 0`;

const connectionKey = (userId: string) => `presence:conn:${userId}`;

export function gamesTodayKey(now: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(now);
  return `stats:games:${day}`;
}

export class Presence {
  private readonly localConnections = new Map<string, number>();

  constructor(private readonly redis: Redis) {}

  async connect(userId: string): Promise<void> {
    this.localConnections.set(userId, (this.localConnections.get(userId) ?? 0) + 1);
    const key = connectionKey(userId);
    await this.redis
      .multi()
      .incr(key)
      .expire(key, CONNECTION_TTL_SECONDS)
      .sadd(ONLINE_KEY, userId)
      .exec();
  }

  async disconnect(userId: string): Promise<void> {
    const remaining = (this.localConnections.get(userId) ?? 1) - 1;
    if (remaining > 0) this.localConnections.set(userId, remaining);
    else this.localConnections.delete(userId);

    await this.redis.eval(RELEASE_SCRIPT, 2, connectionKey(userId), ONLINE_KEY, userId);
  }

  /** Keeps this instance's connections alive in Redis. */
  async heartbeat(): Promise<void> {
    if (this.localConnections.size === 0) return;
    const pipeline = this.redis.pipeline();
    for (const [userId, count] of this.localConnections) {
      const key = connectionKey(userId);
      pipeline.set(key, count, 'EX', CONNECTION_TTL_SECONDS, 'NX');
      pipeline.expire(key, CONNECTION_TTL_SECONDS);
      pipeline.sadd(ONLINE_KEY, userId);
    }
    await pipeline.exec();
  }

  /** Removes users whose connection counter expired, e.g. after an instance crash. */
  async sweep(): Promise<void> {
    const members = await this.redis.smembers(ONLINE_KEY);
    if (members.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const userId of members) {
      pipeline.eval(SWEEP_SCRIPT, 2, connectionKey(userId), ONLINE_KEY, userId);
    }
    await pipeline.exec();
  }

  async stats(now = new Date()): Promise<OnlineCount> {
    const [online, activeGames, gamesToday] = await Promise.all([
      this.redis.scard(ONLINE_KEY),
      this.redis.scard(ACTIVE_ROOMS_KEY),
      this.redis.get(gamesTodayKey(now)),
    ]);
    return { online, activeGames, gamesToday: Number(gamesToday ?? 0) };
  }

  /** Resolves once every previously issued Redis command has completed. */
  async flush(): Promise<void> {
    await this.redis.ping();
  }
}
