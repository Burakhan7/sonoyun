import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { SOCKET_ERROR_CODES, type SocketErrorCode } from 'shared';
import type { FriendService } from './friends.js';
import { ACTIVE_TTL_SECONDS, activeKey, type Candidate } from './matchmaking.js';
import { RATE_RULES, type RateLimiter } from './ratelimit.js';

export const INVITE_TTL_MS = 60_000;

const inviteKey = (inviteId: string) => `invite:${inviteId}`;

const CLAIM_PLAYERS_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
return 1`;

const TAKE_INVITE_SCRIPT = `
local invite = redis.call('HGETALL', KEYS[1])
if #invite == 0 then return nil end
local to, from
for i = 1, #invite, 2 do
  if invite[i] == 'to' then to = invite[i + 1] end
  if invite[i] == 'from' then from = invite[i + 1] end
end
if to ~= ARGV[1] and from ~= ARGV[1] then return nil end
redis.call('DEL', KEYS[1])
return invite`;

export interface StoredInvite {
  from: string;
  to: string;
  fromSocket: string;
}

export interface InviteOptions {
  redis: Redis;
  friends: FriendService;
  limiter: RateLimiter;
  isConnected: (socketId: string) => Promise<boolean>;
  removeFromQueue: (userId: string) => Promise<void>;
  createRoom: (roomId: string, a: Candidate, b: Candidate) => Promise<void>;
}

export type InviteResult<T> = { ok: true; value: T } | { ok: false; code: SocketErrorCode };

const candidate = (userId: string, socketId: string): Candidate => ({
  userId,
  socketId,
  ip: '',
  deviceHash: null,
  score: 0,
  recent: new Set(),
  blocked: new Set(),
});

export class InviteService {
  private readonly redis: Redis;
  private readonly friends: FriendService;
  private readonly limiter: RateLimiter;
  private readonly isConnected: InviteOptions['isConnected'];
  private readonly removeFromQueue: InviteOptions['removeFromQueue'];
  private readonly createRoom: InviteOptions['createRoom'];

  constructor(options: InviteOptions) {
    this.redis = options.redis;
    this.friends = options.friends;
    this.limiter = options.limiter;
    this.isConnected = options.isConnected;
    this.removeFromQueue = options.removeFromQueue;
    this.createRoom = options.createRoom;
  }

  async create(
    fromId: string,
    toId: string,
    fromSocket: string,
  ): Promise<InviteResult<{ inviteId: string }>> {
    if (fromId === toId || !(await this.friends.areFriends(fromId, toId))) {
      return { ok: false, code: SOCKET_ERROR_CODES.notAllowed };
    }
    if (!(await this.limiter.hit(RATE_RULES.invite, fromId))) {
      return { ok: false, code: SOCKET_ERROR_CODES.rateLimited };
    }
    const inviteId = randomUUID();
    await this.redis
      .multi()
      .hset(inviteKey(inviteId), { from: fromId, to: toId, fromSocket })
      .pexpire(inviteKey(inviteId), INVITE_TTL_MS)
      .exec();
    return { ok: true, value: { inviteId } };
  }

  private async take(inviteId: string, userId: string): Promise<StoredInvite | null> {
    const flat = (await this.redis.eval(TAKE_INVITE_SCRIPT, 1, inviteKey(inviteId), userId)) as
      string[] | null;
    if (!flat) return null;
    const fields = new Map<string, string>();
    for (let i = 0; i < flat.length; i += 2) fields.set(flat[i]!, flat[i + 1]!);
    return {
      from: fields.get('from')!,
      to: fields.get('to')!,
      fromSocket: fields.get('fromSocket')!,
    };
  }

  /** Withdraws an invite. Returns it so the other side can be told. */
  async cancel(inviteId: string, userId: string) {
    const invite = await this.take(inviteId, userId);
    return invite?.from === userId ? invite : null;
  }

  async decline(inviteId: string, userId: string) {
    const invite = await this.take(inviteId, userId);
    return invite?.to === userId ? invite : null;
  }

  /** Starts a friends' room for both players. Each invite can be accepted only once. */
  async accept(
    inviteId: string,
    userId: string,
    socketId: string,
  ): Promise<InviteResult<StoredInvite>> {
    const invite = await this.take(inviteId, userId);
    const unavailable = { ok: false, code: SOCKET_ERROR_CODES.inviteUnavailable } as const;
    if (!invite || invite.to !== userId) return unavailable;
    if (!(await this.friends.areFriends(invite.from, invite.to))) return unavailable;
    if (!(await this.isConnected(invite.fromSocket))) return unavailable;

    const roomId = randomUUID();
    const keys = [activeKey(invite.from), activeKey(invite.to)];
    const claimed = await this.redis.eval(
      CLAIM_PLAYERS_SCRIPT,
      2,
      keys[0]!,
      keys[1]!,
      roomId,
      ACTIVE_TTL_SECONDS,
    );
    if (claimed !== 1) return unavailable;

    try {
      await Promise.all([this.removeFromQueue(invite.from), this.removeFromQueue(invite.to)]);
      await this.createRoom(
        roomId,
        candidate(invite.from, invite.fromSocket),
        candidate(invite.to, socketId),
      );
    } catch (error) {
      await this.redis.del(...keys);
      throw error;
    }
    return { ok: true, value: invite };
  }
}
