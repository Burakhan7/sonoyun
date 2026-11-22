import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  ENGINES,
  SOCKET_ERROR_CODES,
  opponentSchema,
  serverEventSchemas,
  type CategoryId,
  type EngineId,
  type MatchFound,
  type ServerEventPayload,
} from 'shared';
import { content } from 'shared/content';
import type { AnswerInput } from './games/engine.js';
import { GAME_ENGINES } from './games/index.js';
import { GameSession, type GameResult, type OpenRound } from './games/session.js';
import { ACTIVE_TTL_SECONDS, activeKey, type Candidate } from './matchmaking.js';
import { gamesTodayKey } from './presence.js';
import { pickCategory, pickEngine } from './selection.js';
import type { UserRecord, UserStore } from './users.js';

export const ACTIVE_ROOMS_KEY = 'rooms:active';
export const SPIN_MS = 3_000;
export const ROUND_GAP_MS = 2_000;
export const RECONNECT_MS = 15_000;
export const SEEN_LIMIT = 200;

const RECENT_CATEGORY_LIMIT = 3;
const STATS_TTL_SECONDS = 3 * 24 * 60 * 60;

const roomKey = (roomId: string) => `room:${roomId}`;
export const recentCategoriesKey = (userId: string) => `mm:cats:${userId}`;
export const seenKey = (userId: string) => `seen:${userId}`;

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

export interface MatchOutcome {
  winnerId: string | null;
  scoreA: number;
  scoreB: number;
  harmony?: number;
}

export interface MatchStore {
  create(match: {
    id: string;
    userAId: string;
    userBId: string;
    category: CategoryId;
    engine: EngineId;
  }): Promise<void>;
  end(id: string, endedAt: Date, outcome?: MatchOutcome): Promise<void>;
}

export function createPrismaMatchStore(prisma: PrismaClient): MatchStore {
  return {
    async create(match) {
      await prisma.match.create({ data: { ...match, scoreA: 0, scoreB: 0 } });
    },
    async end(id, endedAt, outcome) {
      await prisma.match.updateMany({ where: { id }, data: { endedAt, ...outcome } });
    },
  };
}

export interface LiveRoom {
  id: string;
  players: [string, string];
  state: RoomState;
  category: CategoryId;
  engine: EngineId;
  sockets: Map<string, string>;
  found: Map<string, MatchFound>;
  forfeitTimers: Map<string, NodeJS.Timeout>;
  session?: GameSession;
  finished: boolean;
  timer?: NodeJS.Timeout;
}

export interface RoomTimings {
  spinMs?: number;
  gapMs?: number;
  reconnectMs?: number;
  /** Test override for every round's duration. */
  roundMs?: number;
}

export interface RoomServiceOptions {
  redis: Redis;
  users: UserStore;
  matches: MatchStore;
  send: (socketId: string, event: keyof typeof serverEventSchemas, payload: unknown) => void;
  onError: (error: unknown) => void;
  timings?: RoomTimings;
}

export class RoomService {
  readonly rooms = new Map<string, LiveRoom>();
  private readonly byUser = new Map<string, LiveRoom>();
  private readonly redis: Redis;
  private readonly users: UserStore;
  private readonly matches: MatchStore;
  private readonly sendRaw: RoomServiceOptions['send'];
  private readonly onError: RoomServiceOptions['onError'];
  private readonly spinMs: number;
  private readonly gapMs: number;
  private readonly reconnectMs: number;
  private readonly roundMs?: number;

  constructor(options: RoomServiceOptions) {
    this.redis = options.redis;
    this.users = options.users;
    this.matches = options.matches;
    this.sendRaw = options.send;
    this.onError = options.onError;
    this.spinMs = options.timings?.spinMs ?? SPIN_MS;
    this.gapMs = options.timings?.gapMs ?? ROUND_GAP_MS;
    this.reconnectMs = options.timings?.reconnectMs ?? RECONNECT_MS;
    this.roundMs = options.timings?.roundMs;
  }

  /** Every payload passes its strict schema, so an answer field can never slip out. */
  private send<E extends keyof typeof serverEventSchemas>(
    socketId: string | undefined,
    event: E,
    payload: ServerEventPayload<E>,
  ) {
    if (!socketId) return;
    const schema = serverEventSchemas[event] as unknown as { parse(value: unknown): unknown };
    this.sendRaw(socketId, event, schema.parse(payload));
  }

  private broadcast<E extends keyof typeof serverEventSchemas>(
    room: LiveRoom,
    event: E,
    payload: ServerEventPayload<E>,
  ) {
    for (const player of room.players) this.send(room.sockets.get(player), event, payload);
  }

  private schedule(room: LiveRoom, delayMs: number, task: () => Promise<void> | void) {
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      Promise.resolve()
        .then(task)
        .catch((error: unknown) => this.onError(error));
    }, delayMs);
    room.timer.unref();
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

    const rules = ENGINES[engine].rule;
    const room: LiveRoom = {
      id: roomId,
      players: [a.userId, b.userId],
      state: 'MATCHED',
      category,
      engine,
      sockets: new Map([
        [a.userId, a.socketId],
        [b.userId, b.socketId],
      ]),
      found: new Map([
        [a.userId, { roomId, opponent: toOpponent(userB), category, engine, rules }],
        [b.userId, { roomId, opponent: toOpponent(userA), category, engine, rules }],
      ]),
      forfeitTimers: new Map(),
      finished: false,
    };
    this.rooms.set(roomId, room);
    this.byUser.set(a.userId, room);
    this.byUser.set(b.userId, room);

    for (const player of room.players) {
      this.send(room.sockets.get(player), 'match:found', room.found.get(player)!);
    }

    await this.transition(room, 'SPIN');
    this.schedule(room, this.spinMs, () => this.startGame(room));
  }

  async transition(room: LiveRoom, next: RoomState): Promise<void> {
    if (!canTransition(room.state, next)) {
      throw new Error(`Invalid room transition: ${room.state} -> ${next}`);
    }
    room.state = next;
    if (next !== 'ENDED') await this.redis.hset(roomKey(room.id), 'state', next);
  }

  private async startGame(room: LiveRoom) {
    if (room.finished) return;
    try {
      await this.transition(room, 'PLAYING');
      room.session = await this.createSession(room);
    } catch (error) {
      room.finished = true;
      this.broadcast(room, 'error', {
        code: SOCKET_ERROR_CODES.gameFailed,
        message: 'Oyun başlatılamadı. Lütfen yeni bir oyun dene.',
      });
      await this.end(room);
      throw error;
    }
    if (room.finished) return;
    this.startRound(room);
  }

  private async createSession(room: LiveRoom) {
    const [seenA, seenB] = await Promise.all(
      room.players.map((player) => this.redis.lrange(seenKey(player), 0, SEEN_LIMIT - 1)),
    );
    const engine = GAME_ENGINES[room.engine];
    const rounds = engine.createRounds({
      category: room.category,
      seen: new Set([...(seenA ?? []), ...(seenB ?? [])]),
      random: randomInt,
      data: content,
    });

    const pipeline = this.redis.pipeline();
    for (const player of room.players) {
      for (const { question } of rounds) pipeline.lpush(seenKey(player), question.id);
      pipeline.ltrim(seenKey(player), 0, SEEN_LIMIT - 1);
    }
    await pipeline.exec();
    return new GameSession(engine, rounds, room.players, this.roundMs);
  }

  private roundPayload(
    room: LiveRoom,
    round: OpenRound,
    userId: string,
  ): ServerEventPayload<'round:start'> {
    return {
      roundNo: round.roundNo,
      total: round.total,
      question: round.question,
      endsAt: new Date(round.endsAt).toISOString(),
      remainingMs: Math.max(0, Math.round(round.durationMs)),
      scores: { ...room.session!.scores },
      answered: room.session!.hasAnswered(userId),
    };
  }

  private startRound(room: LiveRoom) {
    const round = room.session!.startRound(Date.now());
    for (const player of room.players) {
      this.send(room.sockets.get(player), 'round:start', this.roundPayload(room, round, player));
    }
    this.schedule(room, round.durationMs, () => this.closeRound(room));
  }

  private closeRound(room: LiveRoom) {
    if (room.finished) return;
    const result = room.session!.closeRound();
    if (!result) return;
    this.broadcast(room, 'round:result', result);
    this.schedule(room, this.gapMs, () =>
      room.session!.hasNextRound ? this.startRound(room) : this.finish(room),
    );
  }

  /** Records a player's answer. Returns false for late, repeated or invalid answers. */
  answer(userId: string, socketId: string, roundNo: number, input: AnswerInput): boolean {
    const room = this.byUser.get(userId);
    if (!room?.session || room.finished || room.sockets.get(userId) !== socketId) return false;

    const accepted = room.session.submit(userId, roundNo, input, Date.now());
    if (accepted && room.session.allAnswered) this.closeRound(room);
    return accepted;
  }

  /** Re-attaches a player to their running game after a reload or reconnect. */
  resume(userId: string, socketId: string): boolean {
    const room = this.byUser.get(userId);
    if (!room || room.finished) return false;

    clearTimeout(room.forfeitTimers.get(userId));
    room.forfeitTimers.delete(userId);
    room.sockets.set(userId, socketId);

    this.send(socketId, 'match:found', room.found.get(userId)!);
    if (room.session?.isOpen) {
      this.send(
        socketId,
        'round:start',
        this.roundPayload(room, room.session.currentRound(), userId),
      );
    }
    return true;
  }

  /** Starts the reconnect window when the socket playing the game drops. */
  handleDisconnect(userId: string, socketId: string) {
    const room = this.byUser.get(userId);
    if (!room || room.finished || room.sockets.get(userId) !== socketId) return;

    room.sockets.delete(userId);
    const timer = setTimeout(() => {
      this.forfeit(room, userId).catch((error: unknown) => this.onError(error));
    }, this.reconnectMs);
    timer.unref();
    room.forfeitTimers.set(userId, timer);
  }

  private async forfeit(room: LiveRoom, userId: string) {
    if (room.finished) return;
    const opponent = room.players.find((player) => player !== userId)!;
    await this.finish(room, room.sockets.has(opponent) ? opponent : null);
  }

  private async finish(room: LiveRoom, forfeitWinner?: string | null) {
    if (room.finished) return;
    room.finished = true;
    clearTimeout(room.timer);

    const [a, b] = room.players;
    const result: GameResult = room.session
      ? room.session.result(forfeitWinner)
      : { winnerId: forfeitWinner ?? null, scores: { [a]: 0, [b]: 0 }, forfeit: true };

    this.broadcast(room, 'game:over', result);
    await this.end(room, {
      winnerId: result.winnerId,
      scoreA: result.scores[a] ?? 0,
      scoreB: result.scores[b] ?? 0,
      ...(result.harmony === undefined ? {} : { harmony: result.harmony }),
    });
  }

  async end(room: LiveRoom, outcome?: MatchOutcome): Promise<void> {
    if (room.state === 'ENDED') return;
    room.finished = true;
    clearTimeout(room.timer);
    room.forfeitTimers.forEach((timer) => clearTimeout(timer));
    room.forfeitTimers.clear();
    await this.transition(room, 'ENDED');
    this.rooms.delete(room.id);
    for (const player of room.players) {
      if (this.byUser.get(player) === room) this.byUser.delete(player);
    }

    const pipeline = this.redis.pipeline();
    pipeline.del(roomKey(room.id));
    pipeline.srem(ACTIVE_ROOMS_KEY, room.id);
    for (const userId of room.players) {
      pipeline.eval(RELEASE_ACTIVE_SCRIPT, 1, activeKey(userId), room.id);
    }
    await pipeline.exec();
    await this.matches.end(room.id, new Date(), outcome);
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
