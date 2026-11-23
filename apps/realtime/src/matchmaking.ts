import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export const QUEUE_KEY = 'mm:queue';
export const LOCK_KEY = 'mm:lock';
export const RECENT_LIMIT = 20;
export const ACTIVE_TTL_SECONDS = 45;

const LOCK_TTL_MS = 500;
const TICKET_TTL_SECONDS = 30;
const CHUNK_SIZE = 200;

export const recentKey = (userId: string) => `mm:recent:${userId}`;
export const blockKey = (userId: string) => `block:${userId}`;
export const activeKey = (userId: string) => `mm:active:${userId}`;
const ticketKey = (userId: string) => `mm:ticket:${userId}`;

const JOIN_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 then return 'in_room' end
local owner = redis.call('HGET', KEYS[2], 'socketId')
if redis.call('ZSCORE', KEYS[1], ARGV[1]) and owner then
  if owner ~= ARGV[3] then return 'already_queued' end
  redis.call('EXPIRE', KEYS[2], ARGV[6])
  return 'queued'
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('DEL', KEYS[2])
redis.call('HSET', KEYS[2], 'socketId', ARGV[3], 'ip', ARGV[4], 'deviceHash', ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[6])
return 'queued'`;

const LEAVE_SCRIPT = `
if redis.call('HGET', KEYS[2], 'socketId') == ARGV[2] then
  redis.call('ZREM', KEYS[1], ARGV[1])
  redis.call('DEL', KEYS[2])
  return 1
end
return 0`;

const PRUNE_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 0 then
  return redis.call('ZREM', KEYS[1], ARGV[1])
end
return 0`;

// Atomic so that a user can never land in two rooms, even if two workers overlap.
const CLAIM_SCRIPT = `
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) or not redis.call('ZSCORE', KEYS[1], ARGV[2]) then
  return 0
end
if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1], ARGV[2])
redis.call('DEL', KEYS[4], KEYS[5])
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
return 1`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

export interface QueueTicket {
  socketId: string;
  ip: string;
  deviceHash: string | null;
}

export interface Candidate extends QueueTicket {
  userId: string;
  score: number;
  recent: Set<string>;
  blocked: Set<string>;
}

export interface MatchRules {
  allowSameIp: boolean;
}

export type JoinResult = 'queued' | 'already_queued' | 'in_room';

export type CreateRoom = (roomId: string, a: Candidate, b: Candidate) => Promise<void>;

export function canMatch(a: Candidate, b: Candidate, { allowSameIp }: MatchRules): boolean {
  if (a.userId === b.userId) return false;
  if (a.recent.has(b.userId) || b.recent.has(a.userId)) return false;
  if (a.blocked.has(b.userId) || b.blocked.has(a.userId)) return false;
  if (a.deviceHash && a.deviceHash === b.deviceHash) return false;
  return allowSameIp || a.ip !== b.ip;
}

/** Pairs candidates, longest-waiting first. Each candidate appears in at most one pair. */
export function findPairs(candidates: Candidate[], rules: MatchRules): [Candidate, Candidate][] {
  const used = new Set<string>();
  const pairs: [Candidate, Candidate][] = [];

  for (const a of candidates) {
    if (used.has(a.userId)) continue;
    const b = candidates.find(
      (candidate) => !used.has(candidate.userId) && canMatch(a, candidate, rules),
    );
    if (!b) continue;
    used.add(a.userId);
    used.add(b.userId);
    pairs.push([a, b]);
  }
  return pairs;
}

export async function pushRecent(redis: Redis, userId: string, other: string) {
  const key = recentKey(userId);
  await redis
    .multi()
    .lrem(key, 0, other)
    .lpush(key, other)
    .ltrim(key, 0, RECENT_LIMIT - 1)
    .exec();
}

export class Matchmaker {
  private readonly localTickets = new Map<string, string>();
  private ticking = false;

  constructor(
    private readonly redis: Redis,
    private readonly createRoom: CreateRoom,
    private readonly rules: MatchRules,
  ) {}

  async join(userId: string, ticket: QueueTicket, now = Date.now()): Promise<JoinResult> {
    const result = (await this.redis.eval(
      JOIN_SCRIPT,
      3,
      QUEUE_KEY,
      ticketKey(userId),
      activeKey(userId),
      userId,
      now,
      ticket.socketId,
      ticket.ip,
      ticket.deviceHash ?? '',
      TICKET_TTL_SECONDS,
    )) as JoinResult;
    if (result === 'queued') this.localTickets.set(userId, ticket.socketId);
    return result;
  }

  async leave(userId: string, socketId: string): Promise<void> {
    if (this.localTickets.get(userId) === socketId) this.localTickets.delete(userId);
    await this.redis.eval(LEAVE_SCRIPT, 2, QUEUE_KEY, ticketKey(userId), userId, socketId);
  }

  /** Removes a user from the queue regardless of which socket holds the ticket. */
  async remove(userId: string): Promise<void> {
    this.localTickets.delete(userId);
    await this.redis.multi().zrem(QUEUE_KEY, userId).del(ticketKey(userId)).exec();
  }

  /** Keeps this instance's queue tickets alive; tickets of a crashed instance expire. */
  async heartbeat(): Promise<void> {
    if (this.localTickets.size === 0) return;
    const pipeline = this.redis.pipeline();
    for (const userId of this.localTickets.keys()) {
      pipeline.expire(ticketKey(userId), TICKET_TTL_SECONDS);
    }
    await pipeline.exec();
  }

  /** Returns waiting time for tickets owned by this instance and forgets matched users. */
  async waitingTimes(now = Date.now()): Promise<{ socketId: string; waitingSec: number }[]> {
    const entries = [...this.localTickets];
    if (entries.length === 0) return [];
    const pipeline = this.redis.pipeline();
    for (const [userId] of entries) {
      pipeline.zscore(QUEUE_KEY, userId);
      pipeline.hget(ticketKey(userId), 'socketId');
    }
    const replies = (await pipeline.exec()) ?? [];

    const waiting: { socketId: string; waitingSec: number }[] = [];
    entries.forEach(([userId, socketId], index) => {
      const score = replies[index * 2]?.[1] as string | null;
      const owner = replies[index * 2 + 1]?.[1] as string | null;
      if (score === null || owner !== socketId) {
        this.localTickets.delete(userId);
        return;
      }
      waiting.push({
        socketId,
        waitingSec: Math.max(0, Math.floor((now - Number(score)) / 1000)),
      });
    });
    return waiting;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    const token = randomUUID();
    try {
      if (!(await this.redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX'))) return;
      try {
        const waiting = await this.redis.zrange(QUEUE_KEY, 0, -1, 'WITHSCORES');
        for (let start = 0; start < waiting.length; start += CHUNK_SIZE * 2) {
          await this.matchChunk(waiting.slice(start, start + CHUNK_SIZE * 2));
        }
      } finally {
        await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, LOCK_KEY, token);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async matchChunk(flat: string[]) {
    const candidates = await this.loadCandidates(flat);
    for (const [a, b] of findPairs(candidates, this.rules)) {
      const roomId = randomUUID();
      const claimed = await this.redis.eval(
        CLAIM_SCRIPT,
        5,
        QUEUE_KEY,
        activeKey(a.userId),
        activeKey(b.userId),
        ticketKey(a.userId),
        ticketKey(b.userId),
        a.userId,
        b.userId,
        roomId,
        ACTIVE_TTL_SECONDS,
      );
      if (claimed !== 1) continue;

      this.localTickets.delete(a.userId);
      this.localTickets.delete(b.userId);
      try {
        await this.createRoom(roomId, a, b);
        await pushRecent(this.redis, a.userId, b.userId);
        await pushRecent(this.redis, b.userId, a.userId);
      } catch (error) {
        await this.restore(a, b);
        throw error;
      }
    }
  }

  private async loadCandidates(flat: string[]): Promise<Candidate[]> {
    const entries: { userId: string; score: number }[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      entries.push({ userId: flat[i]!, score: Number(flat[i + 1]) });
    }

    const pipeline = this.redis.pipeline();
    for (const { userId } of entries) {
      pipeline.hgetall(ticketKey(userId));
      pipeline.lrange(recentKey(userId), 0, RECENT_LIMIT - 1);
      pipeline.smembers(blockKey(userId));
    }
    const replies = (await pipeline.exec()) ?? [];

    const candidates: Candidate[] = [];
    const stale: string[] = [];
    entries.forEach(({ userId, score }, index) => {
      const ticket = replies[index * 3]?.[1] as Record<string, string> | undefined;
      if (!ticket?.socketId) {
        stale.push(userId);
        return;
      }
      candidates.push({
        userId,
        score,
        socketId: ticket.socketId,
        ip: ticket.ip ?? '',
        deviceHash: ticket.deviceHash || null,
        recent: new Set(replies[index * 3 + 1]?.[1] as string[]),
        blocked: new Set(replies[index * 3 + 2]?.[1] as string[]),
      });
    });

    await Promise.all(
      stale.map((userId) => this.redis.eval(PRUNE_SCRIPT, 2, QUEUE_KEY, ticketKey(userId), userId)),
    );
    return candidates;
  }

  /** Puts both players back in line with their original wait time if a room cannot be created. */
  private async restore(...players: Candidate[]) {
    const pipeline = this.redis.pipeline();
    for (const player of players) {
      pipeline.del(activeKey(player.userId));
      pipeline.hset(ticketKey(player.userId), {
        socketId: player.socketId,
        ip: player.ip,
        deviceHash: player.deviceHash ?? '',
      });
      pipeline.expire(ticketKey(player.userId), TICKET_TTL_SECONDS);
      pipeline.zadd(QUEUE_KEY, player.score, player.userId);
      this.localTickets.set(player.userId, player.socketId);
    }
    await pipeline.exec();
  }
}

export async function loadBlocks(redis: Redis, blocks: { blockerId: string; blockedId: string }[]) {
  if (blocks.length === 0) return;
  const pipeline = redis.pipeline();
  for (const { blockerId, blockedId } of blocks) {
    pipeline.sadd(blockKey(blockerId), blockedId);
    pipeline.sadd(blockKey(blockedId), blockerId);
  }
  await pipeline.exec();
}
