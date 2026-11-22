import { Redis } from 'ioredis';
import { CATEGORY_IDS, ENGINE_IDS, type MatchFound } from 'shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeKey, type Candidate } from './matchmaking.js';
import { gamesTodayKey } from './presence.js';
import {
  ACTIVE_ROOMS_KEY,
  RoomService,
  canTransition,
  recentCategoriesKey,
  type RoomState,
} from './rooms.js';
import { eligibleEngines, pickCategory, pickEngine } from './selection.js';
import { MemoryMatchStore, MemoryUserStore } from './test/memory-store.js';

// Requires Redis (docker compose up -d). Uses a dedicated logical database that is flushed.
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379', {
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
    rooms = new RoomService({
      redis,
      users,
      matches,
      spinMs: 20,
      onError: (error) => {
        throw error;
      },
      notifyMatch: (socketId, payload) => notified.push({ socketId, payload }),
    });
    const userA = await users.create({ nickname: 'Sakin Tilki', avatarId: 'tilki' });
    const userB = await users.create({ nickname: 'Cesur Kartal', avatarId: 'kartal' });
    a = candidate(userA.id, 'socket-a');
    b = candidate(userB.id, 'socket-b');
    await redis.set(activeKey(a.userId), 'room-1');
    await redis.set(activeKey(b.userId), 'room-1');
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

  it('releases players and the room after the spin', async () => {
    await rooms.create('room-1', a, b);

    await vi.waitFor(() => expect(matches.ended.has('room-1')).toBe(true));
    expect(rooms.rooms.size).toBe(0);
    expect(await redis.scard(ACTIVE_ROOMS_KEY)).toBe(0);
    expect(await redis.exists(activeKey(a.userId), activeKey(b.userId))).toBe(0);
  });

  it('does not release a player who already moved to another room', async () => {
    await rooms.create('room-1', a, b);
    await redis.set(activeKey(a.userId), 'room-2');

    await vi.waitFor(() => expect(matches.ended.has('room-1')).toBe(true));

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
