import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { ENGINES, opponentSchema, type CategoryId, type EngineId, type MatchFound } from 'shared';
import { ACTIVE_TTL_SECONDS, activeKey, type Candidate } from './matchmaking.js';
import { gamesTodayKey } from './presence.js';
import { pickCategory, pickEngine } from './selection.js';
import type { UserRecord, UserStore } from './users.js';

export const ACTIVE_ROOMS_KEY = 'rooms:active';
export const SPIN_MS = 3_000;

const RECENT_CATEGORY_LIMIT = 3;
const STATS_TTL_SECONDS = 3 * 24 * 60 * 60;

const roomKey = (roomId: string) => `room:${roomId}`;
export const recentCategoriesKey = (userId: string) => `mm:cats:${userId}`;

const RELEASE_ACTIVE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

const SWEEP_ROOM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return redis.call('SREM', KEYS[2], ARGV[1]) end
return 0`;

export type RoomState = 'MATCHED' | 'SPIN' | 'PLAYING' | 'PICKING' | 'CHATTING' | 'ENDED';

const TRANSITIONS: Record<RoomState, readonly RoomState[]> = {
  MATCHED: ['SPIN', 'ENDED'],
  SPIN: ['PLAYING', 'ENDED'],
  PLAYING: ['PICKING', 'ENDED'],
  PICKING: ['CHATTING', 'ENDED'],
  CHATTING: ['ENDED'],
  ENDED: [],
};

export function canTransition(from: RoomState, to: RoomState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface MatchStore {
  create(match: {
    id: string;
    userAId: string;
    userBId: string;
    category: CategoryId;
    engine: EngineId;
  }): Promise<void>;
  end(id: string, endedAt: Date): Promise<void>;
}

export function createPrismaMatchStore(prisma: PrismaClient): MatchStore {
  return {
    async create(match) {
      await prisma.match.create({ data: { ...match, scoreA: 0, scoreB: 0 } });
    },
    async end(id, endedAt) {
      await prisma.match.updateMany({ where: { id }, data: { endedAt } });
    },
  };
}

export interface LiveRoom {
  id: string;
  players: [string, string];
  state: RoomState;
  category: CategoryId;
  engine: EngineId;
  timer?: NodeJS.Timeout;
}

export interface RoomServiceOptions {
  redis: Redis;
  users: UserStore;
  matches: MatchStore;
  notifyMatch: (socketId: string, payload: MatchFound) => void;
  onError: (error: unknown) => void;
  spinMs?: number;
}

export class RoomService {
  readonly rooms = new Map<string, LiveRoom>();
  private readonly redis: Redis;
  private readonly users: UserStore;
  private readonly matches: MatchStore;
  private readonly notifyMatch: RoomServiceOptions['notifyMatch'];
  private readonly onError: RoomServiceOptions['onError'];
  private readonly spinMs: number;

  constructor(options: RoomServiceOptions) {
    this.redis = options.redis;
    this.users = options.users;
    this.matches = options.matches;
    this.notifyMatch = options.notifyMatch;
    this.onError = options.onError;
    this.spinMs = options.spinMs ?? SPIN_MS;
  }

  async create(roomId: string, a: Candidate, b: Candidate): Promise<void> {
    const [userA, userB, recentA, recentB] = await Promise.all([
      this.users.findById(a.userId),
      this.users.findById(b.userId),
      this.redis.lrange(recentCategoriesKey(a.userId), 0, RECENT_CATEGORY_LIMIT - 1),
      this.redis.lrange(recentCategoriesKey(b.userId), 0, RECENT_CATEGORY_LIMIT - 1),
    ]);
    if (!userA || !userB) throw new Error('Matched user no longer exists');

    const category = pickCategory([...recentA, ...recentB]);
    const engine = pickEngine(category);
    await this.matches.create({
      id: roomId,
      userAId: a.userId,
      userBId: b.userId,
      category,
      engine,
    });

    const statsKey = gamesTodayKey(new Date());
    const pipeline = this.redis.pipeline();
    pipeline.hset(roomKey(roomId), {
      state: 'MATCHED',
      userA: a.userId,
      userB: b.userId,
      category,
      engine,
    });
    pipeline.expire(roomKey(roomId), ACTIVE_TTL_SECONDS);
    pipeline.sadd(ACTIVE_ROOMS_KEY, roomId);
    pipeline.incr(statsKey);
    pipeline.expire(statsKey, STATS_TTL_SECONDS);
    for (const userId of [a.userId, b.userId]) {
      const key = recentCategoriesKey(userId);
      pipeline.lpush(key, category);
      pipeline.ltrim(key, 0, RECENT_CATEGORY_LIMIT - 1);
    }
    await pipeline.exec();

    const room: LiveRoom = {
      id: roomId,
      players: [a.userId, b.userId],
      state: 'MATCHED',
      category,
      engine,
    };
    this.rooms.set(roomId, room);

    const rules = ENGINES[engine].rule;
    this.notifyMatch(a.socketId, { roomId, opponent: toOpponent(userB), category, engine, rules });
    this.notifyMatch(b.socketId, { roomId, opponent: toOpponent(userA), category, engine, rules });

    await this.transition(room, 'SPIN');
    room.timer = setTimeout(() => {
      this.afterSpin(room).catch(this.onError);
    }, this.spinMs);
    room.timer.unref();
  }

  async transition(room: LiveRoom, next: RoomState): Promise<void> {
    if (!canTransition(room.state, next)) {
      throw new Error(`Invalid room transition: ${room.state} -> ${next}`);
    }
    room.state = next;
    if (next !== 'ENDED') await this.redis.hset(roomKey(room.id), 'state', next);
  }

  // Game engines arrive in Sprint 3; until then a room closes right after the spin.
  private async afterSpin(room: LiveRoom) {
    await this.transition(room, 'PLAYING');
    await this.end(room);
  }

  async end(room: LiveRoom): Promise<void> {
    if (room.state === 'ENDED') return;
    clearTimeout(room.timer);
    await this.transition(room, 'ENDED');
    this.rooms.delete(room.id);

    const pipeline = this.redis.pipeline();
    pipeline.del(roomKey(room.id));
    pipeline.srem(ACTIVE_ROOMS_KEY, room.id);
    for (const userId of room.players) {
      pipeline.eval(RELEASE_ACTIVE_SCRIPT, 1, activeKey(userId), room.id);
    }
    await pipeline.exec();
    await this.matches.end(room.id, new Date());
  }

  /** Keeps live rooms and their players' locks from expiring. */
  async heartbeat(): Promise<void> {
    if (this.rooms.size === 0) return;
    const pipeline = this.redis.pipeline();
    for (const room of this.rooms.values()) {
      pipeline.expire(roomKey(room.id), ACTIVE_TTL_SECONDS);
      for (const userId of room.players) pipeline.expire(activeKey(userId), ACTIVE_TTL_SECONDS);
    }
    await pipeline.exec();
  }

  /** Removes rooms left by a crashed instance so the active game count stays real. */
  async sweep(): Promise<void> {
    const roomIds = await this.redis.smembers(ACTIVE_ROOMS_KEY);
    if (roomIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const roomId of roomIds) {
      pipeline.eval(SWEEP_ROOM_SCRIPT, 2, roomKey(roomId), ACTIVE_ROOMS_KEY, roomId);
    }
    await pipeline.exec();
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.rooms.values()].map((room) => this.end(room)));
  }
}

function toOpponent(user: UserRecord) {
  return opponentSchema.parse({ id: user.id, nickname: user.nickname, avatarId: user.avatarId });
}
