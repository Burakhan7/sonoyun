import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clientIp, proxiedPort } from './client-ip.js';
import { loadEnv } from './env.js';
import {
  ACTIVE_TTL_SECONDS,
  Matchmaker,
  QUEUE_KEY,
  activeKey,
  blockKey,
  canMatch,
  loadBlocks,
  pushRecent,
  recentKey,
  type Candidate,
  type MatchRules,
} from './matchmaking.js';

// Requires Redis (docker compose up -d). Uses a dedicated logical database that is flushed.
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379', {
  db: 14,
  maxRetriesPerRequest: 1,
});

type Pair = { roomId: string; users: [string, string] };

function createMatchmaker(pairs: Pair[], rules: Partial<MatchRules> = {}) {
  return new Matchmaker(
    redis,
    async (roomId, a, b) => {
      pairs.push({ roomId, users: [a.userId, b.userId] });
    },
    { allowSameIp: false, avoidRecent: false, ...rules },
  );
}

const ticket = (id: string | number) => ({
  socketId: `socket-${id}`,
  ip: `10.0.0.${id}`,
  deviceHash: null,
});

describe('matchmaking', () => {
  let pairs: Pair[];
  let matchmaker: Matchmaker;

  /** Plays a full match between two users, then frees them to queue again. */
  const playMatch = async (a: number, b: number) => {
    await matchmaker.join(`u${a}`, ticket(a));
    await matchmaker.join(`u${b}`, ticket(b));
    await matchmaker.tick();
    await redis.del(activeKey(`u${a}`), activeKey(`u${b}`));
  };

  beforeEach(async () => {
    await redis.flushdb();
    pairs = [];
    matchmaker = createMatchmaker(pairs);
  });

  afterAll(async () => {
    await redis.flushdb();
    redis.disconnect();
  });

  it('always serves the longest-waiting user first', async () => {
    for (const roll of [0, 0.99]) {
      await redis.flushdb();
      const found: Pair[] = [];
      const worker = createMatchmaker(found, { random: () => roll });
      await worker.join('new', ticket(3), 3000);
      await worker.join('oldest', ticket(1), 1000);
      await worker.join('older', ticket(2), 2000);
      await worker.tick();

      expect(found).toHaveLength(1);
      expect(found[0]!.users[0]).toBe('oldest');
      expect(await redis.zcard(QUEUE_KEY)).toBe(1);
    }
  });

  it('lets a user rematch their last opponent by default', async () => {
    await playMatch(1, 2);
    await playMatch(1, 2);
    expect(pairs.map(({ users }) => users)).toEqual([
      ['u1', 'u2'],
      ['u1', 'u2'],
    ]);
  });

  it('picks a partner at random, the last opponent as likely as anyone', async () => {
    const picked: [string, string][] = [];
    for (const roll of [0, 0.5, 0.99]) {
      await redis.flushdb();
      await pushRecent(redis, 'a', 'b');
      const found: Pair[] = [];
      const worker = createMatchmaker(found, { random: () => roll });
      await worker.join('a', ticket(1), 1);
      await worker.join('b', ticket(2), 2);
      await worker.join('c', ticket(3), 3);
      await worker.join('d', ticket(4), 4);
      await worker.tick();
      picked.push(found[0]!.users);
    }
    // The longest-waiting user is served first; each roll lands on a different partner.
    expect(picked).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['a', 'd'],
    ]);
  });

  describe('with MATCH_AVOID_RECENT', () => {
    beforeEach(() => {
      matchmaker = createMatchmaker(pairs, { avoidRecent: true });
    });

    it('does not match a user with an opponent from their last 20', async () => {
      await pushRecent(redis, 'a', 'b');
      await matchmaker.join('a', ticket(1));
      await matchmaker.join('b', ticket(2));
      await matchmaker.tick();

      expect(pairs).toHaveLength(0);
    });

    it('applies the recent list in both directions', async () => {
      await pushRecent(redis, 'b', 'a');
      await matchmaker.join('a', ticket(1));
      await matchmaker.join('b', ticket(2));
      await matchmaker.tick();

      expect(pairs).toHaveLength(0);
    });

    it('can rematch only after 20 other opponents', async () => {
      const rematches = () =>
        pairs.filter(({ users }) => users.includes('u1') && users.includes('u2')).length;

      await playMatch(1, 2);
      expect(rematches()).toBe(1);

      for (let i = 0; i < 19; i += 1) {
        await playMatch(1, 100 + i);
        await playMatch(2, 200 + i);
      }
      await matchmaker.join('u1', ticket(1));
      await matchmaker.join('u2', ticket(2));
      await matchmaker.tick();
      expect(rematches()).toBe(1);
      await matchmaker.leave('u1', 'socket-1');
      await matchmaker.leave('u2', 'socket-2');

      await playMatch(1, 119);
      await playMatch(2, 219);
      expect(await redis.llen(recentKey('u1'))).toBe(20);
      expect(await redis.lpos(recentKey('u1'), 'u2')).toBeNull();

      await matchmaker.join('u1', ticket(1));
      await matchmaker.join('u2', ticket(2));
      await matchmaker.tick();
      expect(rematches()).toBe(2);
    });
  });

  it('never matches a blocked pair, in either direction', async () => {
    await loadBlocks(redis, [{ blockerId: 'a', blockedId: 'b' }]);
    expect(await redis.smembers(blockKey('b'))).toEqual(['a']);
    await matchmaker.join('a', ticket(1));
    await matchmaker.join('b', ticket(2));
    await matchmaker.tick();

    expect(pairs).toHaveLength(0);
  });

  it('honors a one-way block entry', async () => {
    await redis.sadd(blockKey('b'), 'a');
    await matchmaker.join('a', ticket(1));
    await matchmaker.join('b', ticket(2));
    await matchmaker.tick();

    expect(pairs).toHaveLength(0);
  });

  it('skips a blocked candidate and matches the next one', async () => {
    await redis.sadd(blockKey('a'), 'b');
    await matchmaker.join('a', ticket(1), 1);
    await matchmaker.join('b', ticket(2), 2);
    await matchmaker.join('c', ticket(3), 3);
    await matchmaker.tick();

    expect(pairs.map(({ users }) => users)).toEqual([['a', 'c']]);
  });

  it('does not match the same IP without device summaries unless allowed for development', async () => {
    const sameIp = { socketId: 's1', ip: '1.1.1.1', deviceHash: null };
    await matchmaker.join('a', sameIp);
    await matchmaker.join('b', { ...sameIp, socketId: 's2' });
    await matchmaker.tick();
    expect(pairs).toHaveLength(0);

    await createMatchmaker(pairs, { allowSameIp: true }).tick();
    expect(pairs).toHaveLength(1);
  });

  it('matches different devices behind a shared carrier IP', async () => {
    await matchmaker.join('a', { socketId: 's1', ip: '1.1.1.1', deviceHash: 'a'.repeat(32) });
    await matchmaker.join('b', { socketId: 's2', ip: '1.1.1.1', deviceHash: 'b'.repeat(32) });
    await matchmaker.tick();
    expect(pairs.map(({ users }) => users)).toEqual([['a', 'b']]);
  });

  it('tells devices apart only when they share an IP', () => {
    const rules = { allowSameIp: false, avoidRecent: false };
    const base: Candidate = {
      userId: 'x',
      socketId: 's',
      ip: '1.1.1.1',
      deviceHash: 'a'.repeat(32),
      score: 0,
      recent: new Set(),
      blocked: new Set(),
    };
    const sameDevice = { ...base, userId: 'y' };
    const unknownDevice = { ...base, userId: 'y', deviceHash: null };

    expect(canMatch(base, sameDevice, rules)).toBe(false);
    expect(canMatch(base, unknownDevice, rules)).toBe(false);
    expect(canMatch(base, { ...unknownDevice, ip: '2.2.2.2' }, rules)).toBe(true);
    // Identical phone models produce the same summary, so it never blocks across networks.
    expect(canMatch(base, { ...sameDevice, ip: '2.2.2.2' }, rules)).toBe(true);
    expect(canMatch(base, sameDevice, { allowSameIp: true, avoidRecent: false })).toBe(true);
  });

  it('puts 100 simultaneous users in at most one room each', async () => {
    const workers = [createMatchmaker(pairs), createMatchmaker(pairs), createMatchmaker(pairs)];
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        workers[i % workers.length]!.join(`user-${i}`, {
          socketId: `socket-${i}`,
          ip: `10.0.${Math.floor(i / 250)}.${i}`,
          deviceHash: null,
        }),
      ),
    );

    for (let round = 0; round < 20 && (await redis.zcard(QUEUE_KEY)) > 0; round += 1) {
      await Promise.all(workers.map((worker) => worker.tick()));
    }

    const matched = pairs.flatMap(({ users }) => users);
    expect(matched).toHaveLength(100);
    expect(new Set(matched).size).toBe(100);
    expect(await redis.zcard(QUEUE_KEY)).toBe(0);
  });

  it('cannot claim the same users twice when two workers overlap', async () => {
    const other = createMatchmaker(pairs);
    await matchmaker.join('a', ticket(1));
    await matchmaker.join('b', ticket(2));

    await Promise.all([
      matchmaker.tick(),
      redis.del('mm:lock').then(() => other.tick()),
      other.tick(),
    ]);

    expect(pairs).toHaveLength(1);
  });

  it('refuses a user already in a room', async () => {
    await redis.set(activeKey('a'), 'room', 'EX', ACTIVE_TTL_SECONDS);
    expect(await matchmaker.join('a', ticket(1))).toBe('in_room');
    expect(await redis.zcard(QUEUE_KEY)).toBe(0);
  });

  it('lets only one tab of a user wait in the queue', async () => {
    expect(await matchmaker.join('a', { ...ticket(1), socketId: 'tab-1' })).toBe('queued');
    expect(await matchmaker.join('a', { ...ticket(1), socketId: 'tab-2' })).toBe('already_queued');
    expect(await matchmaker.join('a', { ...ticket(1), socketId: 'tab-1' })).toBe('queued');
    expect(await redis.zcard(QUEUE_KEY)).toBe(1);
  });

  it('ignores a leave from a tab that does not hold the ticket', async () => {
    await matchmaker.join('a', { ...ticket(1), socketId: 'tab-1' });
    await matchmaker.leave('a', 'tab-2');
    expect(await redis.zcard(QUEUE_KEY)).toBe(1);

    await matchmaker.leave('a', 'tab-1');
    expect(await redis.zcard(QUEUE_KEY)).toBe(0);
  });

  it('never matches a queue entry whose ticket expired', async () => {
    await redis.zadd(QUEUE_KEY, 1, 'ghost');
    await matchmaker.join('a', ticket(1));
    await matchmaker.tick();

    expect(pairs).toHaveLength(0);
    expect(await redis.zrange(QUEUE_KEY, 0, -1)).toEqual(['a']);
  });

  it('returns both players to the queue when room creation fails', async () => {
    const failing = new Matchmaker(
      redis,
      async () => {
        throw new Error('room failed');
      },
      { allowSameIp: false, avoidRecent: false },
    );
    await failing.join('a', ticket(1), 1000);
    await failing.join('b', ticket(2), 2000);

    await expect(failing.tick()).rejects.toThrow('room failed');

    expect(await redis.zrange(QUEUE_KEY, 0, -1, 'WITHSCORES')).toEqual(['a', '1000', 'b', '2000']);
    expect(await redis.exists(activeKey('a'), activeKey('b'))).toBe(0);
    expect(await redis.llen(recentKey('a'))).toBe(0);
  });

  it('reports waiting time', async () => {
    await matchmaker.join('a', ticket(1), 10_000);
    expect(await matchmaker.waitingTimes(25_500)).toEqual([
      { socketId: 'socket-1', waitingSec: 15 },
    ]);
  });
});

describe('clientIp', () => {
  const headers = { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' };

  it('ignores forwarded headers unless the proxy is trusted', () => {
    expect(clientIp({ address: '::ffff:1.2.3.4', headers }, false)).toBe('1.2.3.4');
  });

  it('uses the entry added by the trusted proxy, not a client-supplied one', () => {
    expect(clientIp({ address: '10.0.0.1', headers }, true)).toBe('9.9.9.9');
  });
});

describe('proxiedPort', () => {
  it('reads the port set by the proxy', () => {
    expect(proxiedPort('51234')).toBe(51234);
    expect(proxiedPort(['1', '443'])).toBe(443);
  });

  it.each([undefined, '', 'abc', '0', '70000', '12.5'])('ignores %s', (value) => {
    expect(proxiedPort(value)).toBeNull();
  });
});

describe('MATCH_ALLOW_SAME_IP', () => {
  const env = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'x'.repeat(32),
    MATCH_ALLOW_SAME_IP: 'true',
  };

  it('is rejected in production', () => {
    expect(() => loadEnv({ ...env, NODE_ENV: 'production' })).toThrow();
    expect(loadEnv({ ...env, NODE_ENV: 'development' }).MATCH_ALLOW_SAME_IP).toBe(true);
  });
});
