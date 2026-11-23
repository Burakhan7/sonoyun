import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { onlineCountSchema, type OnlineCount } from 'shared';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenService } from './auth.js';
import { Presence, gamesTodayKey } from './presence.js';
import { buildServer } from './server.js';
import { MemoryMatchStore, MemoryModerationStore, MemoryUserStore } from './test/memory-store.js';

// Requires Redis (docker compose up -d). Uses a dedicated logical database that is flushed.
const TEST_DB = 15;
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379', {
  db: TEST_DB,
  maxRetriesPerRequest: 1,
});

describe('presence over Socket.IO', () => {
  const tokens = createTokenService('presence-test-secret-'.repeat(2));
  const clients: Socket[] = [];
  let users: MemoryUserStore;
  let presence: Presence;
  let server: ReturnType<typeof buildServer>;
  let url: string;

  const connect = (token: unknown) =>
    new Promise<Socket>((resolve, reject) => {
      const client = connectClient(url, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      clients.push(client);
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });

  const createUser = async () => {
    const user = await users.create({ nickname: 'Sakin Tilki', avatarId: 'tilki' });
    return { user, token: await tokens.sign(user.id) };
  };

  const expectOnline = (count: number) =>
    vi.waitFor(async () => expect((await presence.stats()).online).toBe(count), {
      timeout: 2000,
      interval: 20,
    });

  beforeEach(async () => {
    await redis.flushdb();
    users = new MemoryUserStore();
    presence = new Presence(redis);
    server = buildServer({
      webOrigin: 'http://localhost:3100',
      tokens,
      users,
      presence,
      redis,
      matches: new MemoryMatchStore(),
      moderationStore: new MemoryModerationStore(),
      broadcastIntervalMs: 50,
    });
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    url = `http://127.0.0.1:${(server.app.server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.close());
    await server.app.close();
  });

  afterAll(async () => {
    await redis.flushdb();
    redis.disconnect();
  });

  it('responds on /health', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('counts the same user in two tabs once', async () => {
    const { token } = await createUser();
    await connect(token);
    await connect(token);

    await vi.waitFor(async () => expect(await redis.get(connKey(users))).toBe('2'));
    await expectOnline(1);
  });

  it('keeps the user online until the last tab closes', async () => {
    const { token } = await createUser();
    const first = await connect(token);
    const second = await connect(token);
    await vi.waitFor(async () => expect(await redis.get(connKey(users))).toBe('2'));

    first.close();
    await vi.waitFor(async () => expect(await redis.get(connKey(users))).toBe('1'));
    await expectOnline(1);

    second.close();
    await expectOnline(0);
    expect(await redis.exists(connKey(users))).toBe(0);
  });

  it('counts different users separately', async () => {
    await connect((await createUser()).token);
    await connect((await createUser()).token);
    await expectOnline(2);
  });

  it('broadcasts real counts', async () => {
    await redis.sadd('rooms:active', 'room-1');
    await redis.set(gamesTodayKey(new Date()), '7');
    const { token } = await createUser();
    const client = await connect(token);

    const payload = await new Promise<OnlineCount>((resolve) => {
      client.on('online:count', (value: unknown) => {
        const parsed = onlineCountSchema.parse(value);
        if (parsed.online === 1) resolve(parsed);
      });
    });
    expect(payload).toEqual({ online: 1, activeGames: 1, gamesToday: 7 });
  });

  it('reports zero with no connections', async () => {
    expect(await presence.stats()).toEqual({ online: 0, activeGames: 0, gamesToday: 0 });
  });

  it('removes users left behind by a crashed instance', async () => {
    await redis.sadd('presence:online', 'ghost');
    const { user, token } = await createUser();
    await connect(token);
    await expectOnline(2);

    await presence.sweep();

    expect(await redis.smembers('presence:online')).toEqual([user.id]);
  });

  it('restores a live connection whose counter expired', async () => {
    const { user, token } = await createUser();
    await connect(token);
    await expectOnline(1);
    await redis.del(`presence:conn:${user.id}`);

    await presence.heartbeat();
    await presence.sweep();

    await expectOnline(1);
    expect(await redis.get(`presence:conn:${user.id}`)).toBe('1');
  });

  it.each([undefined, '', 'not-a-token'])('rejects handshake token %s', async (token) => {
    await expect(connect(token)).rejects.toThrow('unauthorized');
    await expectOnline(0);
  });

  it('rejects a valid token for a deleted user', async () => {
    const { user, token } = await createUser();
    users.records.delete(user.id);
    await expect(connect(token)).rejects.toThrow('unauthorized');
  });

  it('rejects banned users and admits them after the ban ends', async () => {
    const { user, token } = await createUser();
    const record = users.records.get(user.id)!;

    record.bannedUntil = new Date(Date.now() + 60_000);
    await expect(connect(token)).rejects.toThrow('banned');
    await expectOnline(0);

    record.bannedUntil = new Date(Date.now() - 1000);
    await connect(token);
    await expectOnline(1);
  });
});

function connKey(users: MemoryUserStore) {
  const [id] = users.records.keys();
  return `presence:conn:${id}`;
}
