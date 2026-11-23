import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  ENGINES,
  SOCKET_ERROR_CODES,
  opponentSchema,
  serverEventSchemas,
  type CategoryId,
  type ChatStart,
  type EngineId,
  type MatchFound,
  type ServerEventPayload,
  type SocketErrorCode,
} from 'shared';
import { content } from 'shared/content';
import { drawCards, isValidPick, randomPicks, type CardOffer } from './cards.js';
import type { ChatService } from './chat.js';
import type { AnswerInput } from './games/engine.js';
import { GAME_ENGINES } from './games/index.js';
import { GameSession, type GameResult, type OpenRound } from './games/session.js';
import { ACTIVE_TTL_SECONDS, activeKey, type Candidate } from './matchmaking.js';
import { ENCOUNTER_TTL_SECONDS, encounterKey } from './moderation.js';
import { gamesTodayKey } from './presence.js';
import { pickCategory, pickEngine } from './selection.js';
import type { UserRecord, UserStore } from './users.js';

export const ACTIVE_ROOMS_KEY = 'rooms:active';
export const SPIN_MS = 3_000;
export const ROUND_GAP_MS = 2_000;
export const RECONNECT_MS = 15_000;
export const PICK_MS = 20_000;
export const CHAT_MS = 7 * 60 * 1000;
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
  /** Merges one player's 👍/👎 into the match. Ignored for users outside the match. */
  rate(id: string, userId: string, value: 1 | -1): Promise<void>;
}

export function createPrismaMatchStore(prisma: PrismaClient): MatchStore {
  return {
    async create(match) {
      await prisma.match.create({ data: { ...match, scoreA: 0, scoreB: 0 } });
    },
    async end(id, endedAt, outcome) {
      await prisma.match.updateMany({ where: { id }, data: { endedAt, ...outcome } });
    },
    async rate(id, userId, value) {
      const rating = JSON.stringify({ [userId]: value });
      await prisma.$executeRaw`
        UPDATE "Match"
        SET "chatRating" = COALESCE("chatRating", '{}'::jsonb) || ${rating}::jsonb
        WHERE "id" = ${id} AND ${userId} IN ("userAId", "userBId")`;
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
  gameFinished: boolean;
  result?: GameResult;
  outcome?: MatchOutcome;
  offers?: Map<string, CardOffer>;
  systemCard?: ChatStart['pinned'][number]['card'] | null;
  picks: Map<string, string[]>;
  pickEndsAt: number;
  pinned: ChatStart['pinned'];
  chatEndsAt: number;
  timer?: NodeJS.Timeout;
}

export interface RoomTimings {
  spinMs?: number;
  gapMs?: number;
  reconnectMs?: number;
  /** Test override for every round's duration. */
  roundMs?: number;
  pickMs?: number;
  chatMs?: number;
}

export interface RoomServiceOptions {
  redis: Redis;
  users: UserStore;
  matches: MatchStore;
  chat: ChatService;
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
  private readonly chat: ChatService;
  private readonly sendRaw: RoomServiceOptions['send'];
  private readonly onError: RoomServiceOptions['onError'];
  private readonly spinMs: number;
  private readonly gapMs: number;
  private readonly reconnectMs: number;
  private readonly roundMs?: number;
  private readonly pickMs: number;
  private readonly chatMs: number;

  constructor(options: RoomServiceOptions) {
    this.redis = options.redis;
    this.users = options.users;
    this.matches = options.matches;
    this.chat = options.chat;
    this.sendRaw = options.send;
    this.onError = options.onError;
    this.spinMs = options.timings?.spinMs ?? SPIN_MS;
    this.gapMs = options.timings?.gapMs ?? ROUND_GAP_MS;
    this.reconnectMs = options.timings?.reconnectMs ?? RECONNECT_MS;
    this.roundMs = options.timings?.roundMs;
    this.pickMs = options.timings?.pickMs ?? PICK_MS;
    this.chatMs = options.timings?.chatMs ?? CHAT_MS;
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
    pipeline.set(encounterKey(a.userId, b.userId), roomId, 'EX', ENCOUNTER_TTL_SECONDS);
    pipeline.set(encounterKey(b.userId, a.userId), roomId, 'EX', ENCOUNTER_TTL_SECONDS);
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
      gameFinished: false,
      picks: new Map(),
      pickEndsAt: 0,
      pinned: [],
      chatEndsAt: 0,
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
    if (room.state !== 'SPIN') return;
    try {
      await this.transition(room, 'PLAYING');
      room.session = await this.createSession(room);
    } catch (error) {
      this.broadcast(room, 'error', {
        code: SOCKET_ERROR_CODES.gameFailed,
        message: 'Oyun başlatılamadı. Lütfen yeni bir oyun dene.',
      });
      await this.end(room);
      throw error;
    }
    // The room can end while the session is being created.
    if ((room.state as RoomState) !== 'PLAYING' || room.gameFinished) return;
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
    if (room.state !== 'PLAYING' || room.gameFinished) return;
    const result = room.session!.closeRound();
    if (!result) return;
    this.broadcast(room, 'round:result', result);
    this.schedule(room, this.gapMs, () =>
      room.session!.hasNextRound ? this.startRound(room) : this.finishGame(room),
    );
  }

  /** Records a player's answer. Returns false for late, repeated or invalid answers. */
  answer(userId: string, socketId: string, roundNo: number, input: AnswerInput): boolean {
    const room = this.byUser.get(userId);
    if (!room?.session || room.state !== 'PLAYING' || room.gameFinished) return false;
    if (room.sockets.get(userId) !== socketId) return false;

    const accepted = room.session.submit(userId, roundNo, input, Date.now());
    if (accepted && room.session.allAnswered) this.closeRound(room);
    return accepted;
  }

  private async finishGame(room: LiveRoom, forfeitWinner?: string | null) {
    if (room.gameFinished || room.state === 'ENDED') return;
    room.gameFinished = true;
    clearTimeout(room.timer);

    const [a, b] = room.players;
    const result: GameResult = room.session
      ? room.session.result(forfeitWinner)
      : { winnerId: forfeitWinner ?? null, scores: { [a]: 0, [b]: 0 }, forfeit: true };
    room.result = result;
    room.outcome = {
      winnerId: result.winnerId,
      scoreA: result.scores[a] ?? 0,
      scoreB: result.scores[b] ?? 0,
      ...(result.harmony === undefined ? {} : { harmony: result.harmony }),
    };

    this.broadcast(room, 'game:over', result);
    if (result.forfeit) await this.end(room);
    else await this.startPicking(room);
  }

  private async startPicking(room: LiveRoom) {
    await this.transition(room, 'PICKING');
    const { offers, systemCard } = drawCards(
      room.category,
      room.players,
      room.result?.winnerId ?? null,
    );
    room.offers = offers;
    room.systemCard = systemCard;
    room.pickEndsAt = Date.now() + this.pickMs;
    for (const player of room.players) this.sendOffer(room, player);
    this.schedule(room, this.pickMs, () => this.completePicking(room));
  }

  private sendOffer(room: LiveRoom, userId: string) {
    const offer = room.offers?.get(userId);
    if (!offer) return;
    this.send(room.sockets.get(userId), 'cards:offer', {
      cards: offer.cards,
      pickCount: offer.pickCount,
      endsAt: new Date(room.pickEndsAt).toISOString(),
      remainingMs: Math.max(0, room.pickEndsAt - Date.now()),
      picked: room.picks.get(userId) ?? [],
    });
  }

  /** Locks a player's card choice. Returns false for invalid or repeated picks. */
  async pick(userId: string, socketId: string, cardIds: string[]): Promise<boolean> {
    const room = this.byUser.get(userId);
    if (!room || room.state !== 'PICKING' || room.sockets.get(userId) !== socketId) return false;
    const offer = room.offers?.get(userId);
    if (!offer || room.picks.has(userId) || !isValidPick(offer, cardIds)) return false;

    room.picks.set(userId, cardIds);
    if (room.players.every((player) => room.picks.has(player))) await this.completePicking(room);
    return true;
  }

  private async completePicking(room: LiveRoom) {
    if (room.state !== 'PICKING') return;
    clearTimeout(room.timer);

    const winnerId = room.result?.winnerId ?? null;
    const order = [...room.players].sort((a, b) => Number(b === winnerId) - Number(a === winnerId));
    const pinned: ChatStart['pinned'] = [];
    for (const player of order) {
      const offer = room.offers!.get(player)!;
      const ids = room.picks.get(player) ?? randomPicks(offer);
      room.picks.set(player, ids);
      for (const id of ids) {
        pinned.push({ byUserId: player, card: offer.cards.find((card) => card.id === id)! });
      }
    }
    if (room.systemCard) pinned.push({ byUserId: null, card: room.systemCard });
    room.pinned = pinned;

    await this.transition(room, 'CHATTING');
    room.chatEndsAt = Date.now() + this.chatMs;
    await this.chat.markChatEnd(room.id, room.chatEndsAt);
    if ((room.state as RoomState) !== 'CHATTING') return;
    this.broadcast(room, 'chat:start', this.chatStartPayload(room));
    this.schedule(room, this.chatMs, () => this.endChat(room, 'timeout'));
  }

  private chatStartPayload(room: LiveRoom): ChatStart {
    return {
      pinned: room.pinned,
      endsAt: new Date(room.chatEndsAt).toISOString(),
      remainingMs: Math.max(0, room.chatEndsAt - Date.now()),
    };
  }

  /** Validates, filters, stores and delivers a chat message. Returns an error code on refusal. */
  async sendMessage(
    userId: string,
    socketId: string,
    body: string,
  ): Promise<SocketErrorCode | null> {
    const room = this.byUser.get(userId);
    const isOpen = (candidate: LiveRoom | undefined): candidate is LiveRoom =>
      candidate?.state === 'CHATTING' && Date.now() < candidate.chatEndsAt;
    if (!isOpen(room) || room.sockets.get(userId) !== socketId) {
      return SOCKET_ERROR_CODES.chatClosed;
    }

    const prepared = await this.chat.prepare(userId, body);
    if (!prepared.ok) return prepared.code;
    if (!isOpen(room)) return SOCKET_ERROR_CODES.chatClosed;

    const message = await this.chat.store(room.id, userId, prepared.body);
    this.broadcast(room, 'chat:message', message);
    return null;
  }

  /** Tells the other player that this one is typing. */
  typing(userId: string, socketId: string) {
    const room = this.byUser.get(userId);
    if (room?.state !== 'CHATTING' || room.sockets.get(userId) !== socketId) return;
    const opponent = room.players.find((player) => player !== userId)!;
    this.send(room.sockets.get(opponent), 'chat:typing', { userId });
  }

  async leaveChat(userId: string, socketId: string) {
    const room = this.byUser.get(userId);
    if (!room || room.sockets.get(userId) !== socketId) return;
    await this.endChat(room, 'left');
  }

  /** Closes a shared picking or chat stage as soon as one player blocks the other. */
  async closeForBlock(userId: string, blockedId: string) {
    const room = this.byUser.get(userId);
    if (room?.players.includes(blockedId)) await this.endChat(room, 'left');
  }

  private async endChat(room: LiveRoom, reason: 'timeout' | 'left' | 'disconnect') {
    if (room.state !== 'PICKING' && room.state !== 'CHATTING') return;
    this.broadcast(room, 'chat:ended', { reason });
    await this.end(room);
  }

  /** Re-attaches a player to their running room after a reload or reconnect. */
  async resume(userId: string, socketId: string): Promise<boolean> {
    const room = this.byUser.get(userId);
    if (!room || room.state === 'ENDED') return false;

    clearTimeout(room.forfeitTimers.get(userId));
    room.forfeitTimers.delete(userId);
    room.sockets.set(userId, socketId);

    this.send(socketId, 'match:found', { ...room.found.get(userId)!, resumed: true });
    if (room.state === 'PLAYING' && room.session?.isOpen) {
      this.send(
        socketId,
        'round:start',
        this.roundPayload(room, room.session.currentRound(), userId),
      );
    }
    if (room.result && (room.state === 'PICKING' || room.state === 'CHATTING')) {
      this.send(socketId, 'game:over', room.result);
    }
    if (room.state === 'PICKING') this.sendOffer(room, userId);
    if (room.state === 'CHATTING') {
      this.send(socketId, 'chat:start', this.chatStartPayload(room));
      for (const message of await this.chat.history(room.id)) {
        this.send(socketId, 'chat:message', message);
      }
    }
    return true;
  }

  /** Starts the reconnect window when the socket playing the game drops. */
  handleDisconnect(userId: string, socketId: string) {
    const room = this.byUser.get(userId);
    if (!room || room.state === 'ENDED' || room.sockets.get(userId) !== socketId) return;

    room.sockets.delete(userId);
    const timer = setTimeout(() => {
      this.handleAbsence(room, userId).catch((error: unknown) => this.onError(error));
    }, this.reconnectMs);
    timer.unref();
    room.forfeitTimers.set(userId, timer);
  }

  private async handleAbsence(room: LiveRoom, userId: string) {
    if (room.state === 'PICKING' || room.state === 'CHATTING') {
      await this.endChat(room, 'disconnect');
      return;
    }
    if (room.state === 'ENDED') return;
    const opponent = room.players.find((player) => player !== userId)!;
    await this.finishGame(room, room.sockets.has(opponent) ? opponent : null);
  }

  async end(room: LiveRoom, outcome: MatchOutcome | undefined = room.outcome): Promise<void> {
    if (room.state === 'ENDED') return;
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
