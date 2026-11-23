import { Redis } from 'ioredis';
import { CATEGORY_IDS, SOCKET_ERROR_CODES, serverEventSchemas } from 'shared';
import { createWordFilter } from 'shared/filter';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawCards, isValidPick } from './cards.js';
import { ChatService, chatEndsAtKey, messagesKey, muteKey } from './chat.js';
import { activeKey, blockKey, type Candidate } from './matchmaking.js';
import { ModerationService, encounterKey, suspendedKey } from './moderation.js';
import { RATE_RULES, RateLimiter } from './ratelimit.js';
import { RoomService, type RoomTimings } from './rooms.js';
import { MemoryMatchStore, MemoryModerationStore, MemoryUserStore } from './test/memory-store.js';

// Requires Redis (docker compose up -d). Uses a dedicated logical database that is flushed.
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379', {
  db: 12,
  maxRetriesPerRequest: 1,
});

afterAll(async () => {
  await redis.flushdb();
  redis.disconnect();
});

describe('drawCards', () => {
  const players = ['w', 'l'] as const;

  it('offers the winner 2 of each level and the loser 1 of each', () => {
    const { offers, systemCard } = drawCards('mutfak', players, 'w');
    const levels = (id: string) => offers.get(id)!.cards.map((card) => card.level);

    expect(levels('w')).toEqual(['light', 'light', 'personal', 'personal', 'bold', 'bold']);
    expect(levels('l')).toEqual(['light', 'personal', 'bold']);
    expect(offers.get('w')!.pickCount).toBe(2);
    expect(offers.get('l')!.pickCount).toBe(1);
    expect(systemCard).toBeNull();
  });

  it('gives both players one pick plus a system card on a tie', () => {
    const { offers, systemCard } = drawCards('mutfak', players, null);
    expect(offers.get('w')!.pickCount).toBe(1);
    expect(offers.get('l')!.pickCount).toBe(1);
    expect(systemCard).not.toBeNull();
  });

  it.each(CATEGORY_IDS)('never repeats a card in %s', (category) => {
    const { offers, systemCard } = drawCards(category, players, null);
    const ids = [...offers.values()].flatMap(({ cards }) => cards.map((card) => card.id));
    ids.push(systemCard!.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith(`${category}-`))).toBe(true);
  });

  it('validates picks against the offer', () => {
    const offer = drawCards('mutfak', players, 'w').offers.get('w')!;
    const [first, second] = offer.cards.map((card) => card.id);
    expect(isValidPick(offer, [first!, second!])).toBe(true);
    expect(isValidPick(offer, [first!])).toBe(false);
    expect(isValidPick(offer, [first!, first!])).toBe(false);
    expect(isValidPick(offer, [first!, 'other'])).toBe(false);
  });
});

describe('RateLimiter', () => {
  beforeEach(() => redis.flushdb());

  it('allows up to the limit inside the window, then recovers', async () => {
    const limiter = new RateLimiter(redis);
    const rule = RATE_RULES.chatBurst;
    for (let i = 0; i < 6; i += 1) expect(await limiter.hit(rule, 'u', 1000 + i)).toBe(true);
    expect(await limiter.hit(rule, 'u', 1010)).toBe(false);
    expect(await limiter.hit(rule, 'other', 1010)).toBe(true);
    expect(await limiter.hit(rule, 'u', 1000 + rule.windowMs + 1)).toBe(true);
  });
});

describe('ChatService', () => {
  let chat: ChatService;
  let now: number;
  const send = (body: string) => {
    now += 2_000;
    return chat.prepare('u', body, now);
  };

  beforeEach(async () => {
    await redis.flushdb();
    now = Date.now();
    chat = new ChatService(redis, new RateLimiter(redis), createWordFilter(['aptal']));
  });

  it('masks bad words and still delivers the message', async () => {
    expect(await send('sen aptal mısın')).toEqual({ ok: true, body: 'sen *** mısın' });
  });

  it.each(['ornek.com', 'www.site.org', '0532 123 45 67', 'a@b.com', '@kullanici'])(
    'refuses contact info: %s',
    async (body) => {
      expect(await send(body)).toEqual({ ok: false, code: SOCKET_ERROR_CODES.contactBlocked });
    },
  );

  it('allows one message per second', async () => {
    expect((await chat.prepare('u', 'bir', now)).ok).toBe(true);
    expect(await chat.prepare('u', 'iki', now + 500)).toEqual({
      ok: false,
      code: SOCKET_ERROR_CODES.rateLimited,
    });
    expect((await chat.prepare('u', 'üç', now + 1_001)).ok).toBe(true);
  });

  it('allows six messages per 10 seconds', async () => {
    for (let i = 0; i < 6; i += 1) {
      expect((await chat.prepare('u', 'selam', now + i * 1_100)).ok).toBe(true);
    }
    expect(await chat.prepare('u', 'selam', now + 6 * 1_100)).toEqual({
      ok: false,
      code: SOCKET_ERROR_CODES.rateLimited,
    });
  });

  it('mutes for 10 minutes after the fifth masked message', async () => {
    for (let i = 0; i < 5; i += 1) {
      now += 11_000;
      expect(await chat.prepare('u', 'aptal', now)).toEqual({ ok: true, body: '***' });
    }
    now += 11_000;
    expect(await chat.prepare('u', 'selam', now)).toEqual({
      ok: false,
      code: SOCKET_ERROR_CODES.muted,
    });
    const ttl = await redis.ttl(muteKey('u'));
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('stores messages in Redis with a 24-hour TTL', async () => {
    const message = await chat.store('room', 'u', 'selam');
    expect(serverEventSchemas['chat:message'].safeParse(message).success).toBe(true);
    expect(await chat.history('room')).toEqual([message]);
    const ttl = await redis.ttl(messagesKey('room'));
    expect(ttl).toBeGreaterThan(86_390);
    expect(ttl).toBeLessThanOrEqual(86_400);
  });

  it('snapshots only the last 50 messages', async () => {
    for (let i = 0; i < 55; i += 1) await chat.store('room', 'u', `mesaj ${i}`);
    const snapshot = await chat.snapshot('room');
    expect(snapshot).toHaveLength(50);
    expect(snapshot[0]!.body).toBe('mesaj 5');
    expect(snapshot.at(-1)!.body).toBe('mesaj 54');
  });
});

describe('room card and chat flow', () => {
  let users: MemoryUserStore;
  let matches: MemoryMatchStore;
  let chat: ChatService;
  let rooms: RoomService;
  let events: { socketId: string; event: string; payload: Record<string, unknown> }[];
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
  const service = (timings: RoomTimings) =>
    new RoomService({
      redis,
      users,
      matches,
      chat,
      timings: { spinMs: 1, gapMs: 1, roundMs: 5, reconnectMs: 40, ...timings },
      onError: (error) => {
        throw error;
      },
      send: (socketId, event, payload) => {
        events.push({ socketId, event, payload: payload as Record<string, unknown> });
      },
    });
  const named = (event: string, socketId?: string) =>
    events.filter((entry) => entry.event === event && (!socketId || entry.socketId === socketId));
  const reach = (event: string) =>
    vi.waitFor(() => expect(named(event).length).toBeGreaterThan(0), { timeout: 3000 });
  const offerIds = (socketId: string) =>
    (named('cards:offer', socketId)[0]!.payload.cards as { id: string }[]).map((card) => card.id);

  beforeEach(async () => {
    await redis.flushdb();
    users = new MemoryUserStore();
    matches = new MemoryMatchStore();
    chat = new ChatService(redis, new RateLimiter(redis), createWordFilter(['aptal']));
    events = [];
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

  /** With no answers the game is a tie, so each player picks one card. */
  const toChat = async (timings: RoomTimings = {}) => {
    rooms = service({ pickMs: 60_000, chatMs: 60_000, ...timings });
    await rooms.create('room-1', a, b);
    await reach('cards:offer');
    await rooms.pick(a.userId, 'socket-a', [offerIds('socket-a')[0]!]);
    await rooms.pick(b.userId, 'socket-b', [offerIds('socket-b')[0]!]);
    await reach('chat:start');
  };

  it('pins both picks plus a system card after a tie', async () => {
    await toChat();
    const { pinned } = named('chat:start', 'socket-a')[0]!.payload as {
      pinned: { byUserId: string | null; card: { id: string } }[];
    };

    expect(pinned).toHaveLength(3);
    expect(pinned[0]).toMatchObject({ byUserId: a.userId, card: { id: offerIds('socket-a')[0] } });
    expect(pinned[1]).toMatchObject({ byUserId: b.userId, card: { id: offerIds('socket-b')[0] } });
    expect(pinned[2]!.byUserId).toBeNull();
    expect(await redis.exists(chatEndsAtKey('room-1'))).toBe(1);
  });

  it('picks at random when time runs out', async () => {
    rooms = service({ pickMs: 5, chatMs: 60_000 });
    await rooms.create('room-1', a, b);
    await reach('chat:start');
    const { pinned } = named('chat:start')[0]!.payload as { pinned: unknown[] };
    expect(pinned).toHaveLength(3);
  });

  it('rejects cards that were not offered and repeated picks', async () => {
    rooms = service({ pickMs: 60_000, chatMs: 60_000 });
    await rooms.create('room-1', a, b);
    await reach('cards:offer');

    expect(await rooms.pick(a.userId, 'socket-a', [offerIds('socket-b')[0]!])).toBe(false);
    expect(await rooms.pick(a.userId, 'socket-a', [offerIds('socket-a')[0]!])).toBe(true);
    expect(await rooms.pick(a.userId, 'socket-a', [offerIds('socket-a')[1]!])).toBe(false);
  });

  it('delivers filtered messages to both players', async () => {
    await toChat();
    expect(await rooms.sendMessage(a.userId, 'socket-a', 'sen aptal')).toBeNull();

    for (const socketId of ['socket-a', 'socket-b']) {
      expect(named('chat:message', socketId)[0]!.payload).toMatchObject({
        senderId: a.userId,
        body: 'sen ***',
      });
    }
  });

  it('refuses a message from a stale socket', async () => {
    await toChat();
    expect(await rooms.sendMessage(a.userId, 'old-socket', 'selam')).toBe(
      SOCKET_ERROR_CODES.chatClosed,
    );
  });

  it('rejects messages once the time is up and frees the players', async () => {
    await toChat({ chatMs: 30 });
    await vi.waitFor(() => expect(named('chat:ended').length).toBe(2));

    expect(named('chat:ended')[0]!.payload).toEqual({ reason: 'timeout' });
    expect(await rooms.sendMessage(a.userId, 'socket-a', 'geç kaldım')).toBe(
      SOCKET_ERROR_CODES.chatClosed,
    );
    expect(named('chat:message')).toHaveLength(0);
    expect(await redis.exists(activeKey(a.userId), activeKey(b.userId))).toBe(0);
  });

  it('keeps the transcript in Redis after the chat ends', async () => {
    await toChat();
    await rooms.sendMessage(a.userId, 'socket-a', 'selam');
    await rooms.leaveChat(b.userId, 'socket-b');

    expect(named('chat:ended')[0]!.payload).toEqual({ reason: 'left' });
    expect((await chat.history('room-1')).map(({ body }) => body)).toEqual(['selam']);
  });

  it('forwards typing only to the opponent', async () => {
    await toChat();
    rooms.typing(a.userId, 'socket-a');
    expect(named('chat:typing').map(({ socketId }) => socketId)).toEqual(['socket-b']);
  });

  it('restores pinned cards and messages after a reconnect', async () => {
    await toChat();
    await rooms.sendMessage(b.userId, 'socket-b', 'orada mısın');
    rooms.handleDisconnect(a.userId, 'socket-a');
    await rooms.resume(a.userId, 'socket-a2');
    await new Promise((resolve) => setTimeout(resolve, 70));

    const restored = events
      .filter(({ socketId }) => socketId === 'socket-a2')
      .map(({ event }) => event);
    expect(restored).toEqual(['match:found', 'game:over', 'chat:start', 'chat:message']);
    expect(named('chat:ended')).toHaveLength(0);
  });

  it('ends the chat when a player does not come back', async () => {
    await toChat();
    rooms.handleDisconnect(a.userId, 'socket-a');

    await vi.waitFor(() => expect(named('chat:ended', 'socket-b')).toHaveLength(1));
    expect(named('chat:ended', 'socket-b')[0]!.payload).toEqual({ reason: 'disconnect' });
  });
});

describe('ModerationService', () => {
  let store: MemoryModerationStore;
  let chat: ChatService;
  let moderation: ModerationService;
  let removed: string[];

  const meet = async (one: string, other: string, roomId = 'room-1') => {
    await redis.set(encounterKey(one, other), roomId);
    await redis.set(encounterKey(other, one), roomId);
  };

  beforeEach(async () => {
    await redis.flushdb();
    store = new MemoryModerationStore();
    removed = [];
    const limiter = new RateLimiter(redis);
    chat = new ChatService(redis, limiter, createWordFilter([]));
    moderation = new ModerationService({
      redis,
      store,
      chat,
      limiter,
      removeFromQueue: async (userId) => {
        removed.push(userId);
      },
    });
  });

  it('stores a report with the last 50 messages', async () => {
    await meet('a', 'b');
    for (let i = 0; i < 52; i += 1) await chat.store('room-1', 'b', `m${i}`);

    expect(await moderation.report('a', { userId: 'b', reason: 'taciz', note: ' not ' })).toEqual({
      ok: true,
    });

    const [report] = store.reports;
    expect(report).toMatchObject({ matchId: 'room-1', reportedId: 'b', note: 'not' });
    expect(report!.snapshot).toHaveLength(50);
  });

  it('refuses to report or block someone the user never met', async () => {
    const refused = { ok: false, code: SOCKET_ERROR_CODES.notAllowed };
    expect(await moderation.report('a', { userId: 'b', reason: 'spam' })).toEqual(refused);
    expect(await moderation.block('a', 'b')).toEqual(refused);
    expect(store.reports).toHaveLength(0);
    expect(store.blocks).toHaveLength(0);
  });

  it('limits a user to 10 reports per day', async () => {
    await meet('a', 'b');
    for (let i = 0; i < 10; i += 1) {
      expect((await moderation.report('a', { userId: 'b', reason: 'spam' })).ok).toBe(true);
    }
    expect(await moderation.report('a', { userId: 'b', reason: 'spam' })).toEqual({
      ok: false,
      code: SOCKET_ERROR_CODES.rateLimited,
    });
  });

  it('suspends matching after reports from 3 different people', async () => {
    for (const reporter of ['r1', 'r2']) {
      await meet(reporter, 'target');
      await moderation.report(reporter, { userId: 'target', reason: 'kufur' });
    }
    expect(await moderation.isSuspended('target')).toBe(false);

    await meet('r3', 'target');
    await moderation.report('r3', { userId: 'target', reason: 'kufur' });

    expect(await moderation.isSuspended('target')).toBe(true);
    expect(removed).toEqual(['target']);
    const ttl = await redis.ttl(suspendedKey('target'));
    expect(ttl).toBeGreaterThan(86_390);
  });

  it('does not suspend for repeat reports from the same person', async () => {
    await meet('r1', 'target');
    for (let i = 0; i < 5; i += 1) {
      await moderation.report('r1', { userId: 'target', reason: 'spam' });
    }
    expect(await moderation.isSuspended('target')).toBe(false);
  });

  it('ignores reports older than 24 hours', async () => {
    store.now = () => new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (const reporter of ['r1', 'r2']) {
      await meet(reporter, 'target');
      await moderation.report(reporter, { userId: 'target', reason: 'spam' });
    }
    store.now = () => new Date();
    await meet('r3', 'target');
    await moderation.report('r3', { userId: 'target', reason: 'spam' });

    expect(await moderation.isSuspended('target')).toBe(false);
  });

  it('blocks in both directions for matchmaking', async () => {
    await meet('a', 'b');
    expect(await moderation.block('a', 'b')).toEqual({ ok: true });

    expect(store.blocks).toEqual([['a', 'b']]);
    expect(await redis.smembers(blockKey('a'))).toEqual(['b']);
    expect(await redis.smembers(blockKey('b'))).toEqual(['a']);
  });
});
