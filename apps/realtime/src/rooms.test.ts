import { Redis } from 'ioredis';
import { CATEGORY_IDS, ENGINE_IDS, publicQuestionSchema, type MatchFound } from 'shared';
import { createWordFilter } from 'shared/filter';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from './chat.js';
import { activeKey, type Candidate } from './matchmaking.js';
import { RateLimiter } from './ratelimit.js';
import { gamesTodayKey } from './presence.js';
import {
  ACTIVE_ROOMS_KEY,
  RoomService,
  canTransition,
  recentCategoriesKey,
  seenKey,
  type RoomState,
  type RoomTimings,
} from './rooms.js';
import { eligibleEngines, pickCategory, pickEngine } from './selection.js';
import { MemoryMatchStore, MemoryUserStore } from './test/memory-store.js';

// Requires Redis (docker compose up -d). Uses a dedicated logical database that is flushed.
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379', {
  db: 13,
  maxRetriesPerRequest: 1,
});

describe('room state machine', () => {
  const order: RoomState[] = ['MATCHED', 'SPIN', 'PLAYING', 'PICKING', 'CHATTING', 'ENDED'];

  it('follows the order in SPEC §14', () => {
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(canTransition(order[i]!, order[i + 1]!)).toBe(true);
    }
  });

  it('rejects skipped and backward steps', () => {
    expect(canTransition('MATCHED', 'PLAYING')).toBe(false);
    expect(canTransition('PLAYING', 'SPIN')).toBe(false);
    expect(canTransition('SPIN', 'CHATTING')).toBe(false);
  });

  it('can end from any live state but never leaves ENDED', () => {
    for (const state of order.slice(0, -1)) expect(canTransition(state, 'ENDED')).toBe(true);
    for (const state of order) expect(canTransition('ENDED', state)).toBe(false);
  });
});

describe('category and engine selection', () => {
  it('excludes recent categories', () => {
    const excluded = CATEGORY_IDS.slice(0, 6);
    for (let i = 0; i < 200; i += 1) expect(excluded).not.toContain(pickCategory(excluded));
  });

  it('can select every remaining category', () => {
    const excluded = CATEGORY_IDS.slice(0, 6);
    const available = CATEGORY_IDS.slice(6);
    available.forEach((category, index) => {
      expect(pickCategory(excluded, () => index)).toBe(category);
    });
  });

  it('uses only ayna for yasaydi', () => {
    expect(eligibleEngines('yasaydi')).toEqual(['ayna']);
    for (let i = 0; i < 50; i += 1) expect(pickEngine('yasaydi')).toBe('ayna');
  });

  it('enables all engines in other categories at launch', () => {
    for (const category of CATEGORY_IDS.filter((id) => id !== 'yasaydi')) {
      expect(eligibleEngines(category)).toEqual([...ENGINE_IDS]);
    }
  });
});

describe('RoomService', () => {
  let users: MemoryUserStore;
  let matches: MemoryMatchStore;
  let notified: { socketId: string; payload: MatchFound }[];
  let events: { socketId: string; event: string; payload: Record<string, unknown> }[];

  const service = (timings: RoomTimings) =>
    new RoomService({
      redis,
      users,
      matches,
      chat: new ChatService(redis, new RateLimiter(redis), createWordFilter([])),
      timings,
      onError: (error) => {
        throw error;
      },
      send: (socketId, event, payload) => {
        events.push({ socketId, event, payload: payload as Record<string, unknown> });
        if (event === 'match:found') notified.push({ socketId, payload: payload as MatchFound });
      },
    });
  let rooms: RoomService;
  let a: Candidate;
  let b: Candidate;

  const candidate = (userId: string, socketId: string): Candidate => ({
    userId,
    socketId,
    ip: socketId,
    deviceHash: null,
    score: 0,
    recent: new Set(),
    blocked: new Set(),
  });

  beforeEach(async () => {
    await redis.flushdb();
    users = new MemoryUserStore();
    matches = new MemoryMatchStore();
    notified = [];
    events = [];
    rooms = service({ spinMs: 10, gapMs: 5, reconnectMs: 60, roundMs: 40, pickMs: 5, chatMs: 10 });
    const userA = await users.create({ nickname: 'Sakin Tilki', avatarId: 'tilki' });
    const userB = await users.create({ nickname: 'Cesur Kartal', avatarId: 'kartal' });
    a = candidate(userA.id, 'socket-a');
    b = candidate(userB.id, 'socket-b');
    await redis.set(activeKey(a.userId), 'room-1');
    await redis.set(activeKey(b.userId), 'room-1');
  });

  afterEach(async () => {
    await rooms.shutdown();
  });

  afterAll(async () => {
    await redis.flushdb();
    redis.disconnect();
  });

  it('notifies each player about the other with the same server-chosen game', async () => {
    await rooms.create('room-1', a, b);

    const toA = notified.find(({ socketId }) => socketId === 'socket-a')!.payload;
    const toB = notified.find(({ socketId }) => socketId === 'socket-b')!.payload;
    expect(toA.opponent).toEqual({ id: b.userId, nickname: 'Cesur Kartal', avatarId: 'kartal' });
    expect(toB.opponent).toEqual({ id: a.userId, nickname: 'Sakin Tilki', avatarId: 'tilki' });
    expect(toA.category).toBe(toB.category);
    expect(toA.engine).toBe(toB.engine);
    expect(matches.created[0]).toMatchObject({ id: 'room-1', category: toA.category });
  });

  it('counts real games and tracks the active room', async () => {
    rooms = service({ spinMs: 60_000 });
    await rooms.create('room-1', a, b);

    expect(await redis.scard(ACTIVE_ROOMS_KEY)).toBe(1);
    expect(await redis.get(gamesTodayKey(new Date()))).toBe('1');
    expect(rooms.rooms.get('room-1')?.state).toBe('SPIN');
  });

  it('never repeats either player’s last 3 categories', async () => {
    const recentA = CATEGORY_IDS.slice(0, 3);
    const recentB = CATEGORY_IDS.slice(3, 6);
    await redis.rpush(recentCategoriesKey(a.userId), ...recentA);
    await redis.rpush(recentCategoriesKey(b.userId), ...recentB);

    await rooms.create('room-1', a, b);

    expect([...recentA, ...recentB]).not.toContain(notified[0]!.payload.category);
    expect(await redis.llen(recentCategoriesKey(a.userId))).toBe(3);
  });

  it('plays every round, then cards and chat, and releases the room', async () => {
    await rooms.create('room-1', a, b);

    await vi.waitFor(() => expect(matches.ended.has('room-1')).toBe(true), { timeout: 3000 });

    const forA = events.filter(({ socketId }) => socketId === 'socket-a');
    const starts = forA.filter(({ event }) => event === 'round:start');
    const results = forA.filter(({ event }) => event === 'round:result');
    expect(starts.length).toBeGreaterThan(0);
    expect(results).toHaveLength(starts.length);
    expect(forA.map(({ event }) => event)).toContain('game:over');
    expect(forA.at(-1)!.event).toBe('chat:ended');
    forA
      .filter(({ event }) => event.startsWith('round:'))
      .forEach(({ event }, index) => {
        expect(event).toBe(index % 2 === 0 ? 'round:start' : 'round:result');
      });
    expect(rooms.rooms.size).toBe(0);
    expect(await redis.scard(ACTIVE_ROOMS_KEY)).toBe(0);
    expect(await redis.exists(activeKey(a.userId), activeKey(b.userId))).toBe(0);
    expect(await redis.llen(seenKey(a.userId))).toBe(starts.length);
  });

  it('sends no answer in any payload before round:result', async () => {
    await rooms.create('room-1', a, b);
    await vi.waitFor(() => expect(matches.ended.has('room-1')).toBe(true), { timeout: 3000 });

    for (const { event, payload } of events) {
      if (event === 'round:start') {
        expect(publicQuestionSchema.safeParse(payload.question).success).toBe(true);
        expect(payload).not.toHaveProperty('correct');
        expect(payload.question).not.toHaveProperty('answer');
        expect(payload.question).not.toHaveProperty('answerIndex');
      }
      if (event === 'match:found') expect(JSON.stringify(payload)).not.toContain('answer');
    }
  });

  it('closes a round as soon as both players answer', async () => {
    rooms = service({ spinMs: 5, gapMs: 5_000, reconnectMs: 60_000, roundMs: 30_000 });
    await rooms.create('room-1', a, b);
    await vi.waitFor(() => expect(events.some(({ event }) => event === 'round:start')).toBe(true));
    const question = events.find(({ event }) => event === 'round:start')!.payload.question as {
      type: string;
    };
    const input =
      question.type === 'ayna'
        ? { answer: 'a', prediction: 'a' as const }
        : { answer: question.type === 'estimate' ? 5 : 1 };

    expect(rooms.answer(a.userId, 'wrong-socket', 1, input)).toBe(false);
    expect(rooms.answer(a.userId, 'socket-a', 1, input)).toBe(true);
    expect(events.some(({ event }) => event === 'round:result')).toBe(false);
    expect(rooms.answer(b.userId, 'socket-b', 1, input)).toBe(true);
    expect(events.filter(({ event }) => event === 'round:result')).toHaveLength(2);
    await rooms.shutdown();
  });

  it('awards a forfeit when a player does not return in time', async () => {
    await rooms.create('room-1', a, b);
    rooms.handleDisconnect(a.userId, 'socket-a');

    await vi.waitFor(() => expect(matches.ended.has('room-1')).toBe(true));

    const over = events.find(
      ({ event, socketId }) => event === 'game:over' && socketId === 'socket-b',
    );
    expect(over!.payload).toMatchObject({ winnerId: b.userId, forfeit: true });
    expect(matches.outcomes.get('room-1')?.winnerId).toBe(b.userId);
    expect(
      events.some(({ event, socketId }) => event === 'game:over' && socketId === 'socket-a'),
    ).toBe(false);
  });

  it('has no winner when both players leave', async () => {
    await rooms.create('room-1', a, b);
    rooms.handleDisconnect(a.userId, 'socket-a');
    rooms.handleDisconnect(b.userId, 'socket-b');

    await vi.waitFor(() => expect(matches.ended.has('room-1')).toBe(true));

    expect(matches.outcomes.get('room-1')?.winnerId).toBeNull();
  });

  it('cancels the forfeit when the player returns', async () => {
    rooms = service({ spinMs: 5, gapMs: 5_000, reconnectMs: 40, roundMs: 30_000 });
    await rooms.create('room-1', a, b);
    await vi.waitFor(() => expect(events.some(({ event }) => event === 'round:start')).toBe(true));
    rooms.handleDisconnect(a.userId, 'socket-a');

    expect(await rooms.resume(a.userId, 'socket-a2')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(matches.ended.has('room-1')).toBe(false);
    const resumed = events
      .filter(({ socketId }) => socketId === 'socket-a2')
      .map(({ event }) => event);
    expect(resumed).toEqual(['match:found', 'round:start']);
    await rooms.shutdown();
  });

  it('reports no game to resume for a player without a room', async () => {
    expect(await rooms.resume('nobody', 'socket')).toBe(false);
  });

  it('does not release a player who already moved to another room', async () => {
    await rooms.create('room-1', a, b);
    await redis.set(activeKey(a.userId), 'room-2');

    await vi.waitFor(() => expect(matches.ended.has('room-1')).toBe(true), { timeout: 3000 });

    expect(await redis.get(activeKey(a.userId))).toBe('room-2');
  });

  it('removes rooms left behind by a crashed instance', async () => {
    await redis.sadd(ACTIVE_ROOMS_KEY, 'crashed');
    await rooms.sweep();
    expect(await redis.scard(ACTIVE_ROOMS_KEY)).toBe(0);
  });

  it('does not count a game when the match cannot be stored', async () => {
    matches.failNextCreate = true;

    await expect(rooms.create('room-1', a, b)).rejects.toThrow();

    expect(await redis.get(gamesTodayKey(new Date()))).toBeNull();
    expect(notified).toHaveLength(0);
  });
});
