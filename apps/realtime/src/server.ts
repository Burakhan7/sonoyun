import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import {
  SOCKET_AUTH_ERRORS,
  SOCKET_ERROR_CODES,
  clientEventSchemas,
  handshakeAuthSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from 'shared';
import { Server } from 'socket.io';
import type { TokenService } from './auth.js';
import { clientIp } from './client-ip.js';
import { Matchmaker } from './matchmaking.js';
import type { Presence } from './presence.js';
import { RoomService, type MatchStore } from './rooms.js';
import { registerApiRoutes } from './routes.js';
import { isBanned, type UserStore } from './users.js';

const BROADCAST_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const SWEEP_INTERVAL_MS = 15_000;
const MATCH_TICK_MS = 500;
const QUEUE_STATUS_INTERVAL_MS = 1_000;

const ERROR_MESSAGES = {
  [SOCKET_ERROR_CODES.invalidPayload]: 'Geçersiz istek.',
  [SOCKET_ERROR_CODES.unauthorized]: 'Oturumun geçersiz.',
  [SOCKET_ERROR_CODES.banned]: 'Hesabın geçici olarak kısıtlandı.',
  [SOCKET_ERROR_CODES.termsRequired]: 'Devam etmek için kuralları onaylamalısın.',
  [SOCKET_ERROR_CODES.alreadyQueued]: 'Başka bir sekmede zaten rakip arıyorsun.',
  [SOCKET_ERROR_CODES.inRoom]: 'Zaten bir oyundasın.',
  [SOCKET_ERROR_CODES.internal]: 'Bir sorun oluştu, lütfen tekrar dene.',
} as const;

export interface ServerOptions {
  webOrigin: string;
  tokens: TokenService;
  users: UserStore;
  presence: Presence;
  redis: Redis;
  matches: MatchStore;
  allowSameIp?: boolean;
  trustProxy?: boolean;
  logger?: boolean;
  broadcastIntervalMs?: number;
  matchTickMs?: number;
  spinMs?: number;
}

interface SocketData {
  userId: string;
  ip: string;
}

export function buildServer({
  webOrigin,
  tokens,
  users,
  presence,
  redis,
  matches,
  allowSameIp = false,
  trustProxy = false,
  logger = false,
  broadcastIntervalMs = BROADCAST_INTERVAL_MS,
  matchTickMs = MATCH_TICK_MS,
  spinMs,
}: ServerOptions) {
  const app = Fastify({ logger, trustProxy });
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<never, never>,
    SocketData
  >(app.server, {
    cors: { origin: webOrigin, credentials: true },
  });
  const timers: NodeJS.Timeout[] = [];

  const logFailure = (error: unknown) => app.log.error(error);

  const rooms = new RoomService({
    redis,
    users,
    matches,
    spinMs,
    onError: logFailure,
    notifyMatch: (socketId, payload) => io.to(socketId).emit('match:found', payload),
  });
  const matchmaker = new Matchmaker(redis, (roomId, a, b) => rooms.create(roomId, a, b), {
    allowSameIp,
  });

  app.get('/health', async () => ({ status: 'ok' }));
  registerApiRoutes(app, { tokens, users });

  io.use(async (socket, next) => {
    try {
      const auth = handshakeAuthSchema.safeParse(socket.handshake.auth);
      const userId = auth.success ? await tokens.verify(auth.data.token) : null;
      const user = userId ? await users.findById(userId) : null;
      if (!user) return next(new Error(SOCKET_AUTH_ERRORS.unauthorized));

      const now = new Date();
      if (isBanned(user, now)) return next(new Error(SOCKET_AUTH_ERRORS.banned));

      socket.data.userId = user.id;
      socket.data.ip = clientIp(socket.handshake, trustProxy);
      users.touch(user.id, now).catch(logFailure);
      return next();
    } catch (error) {
      logFailure(error);
      return next(new Error(SOCKET_AUTH_ERRORS.internal));
    }
  });

  io.on('connection', (socket) => {
    const { userId, ip } = socket.data;
    const sendError = (code: keyof typeof ERROR_MESSAGES) =>
      socket.emit('error', { code, message: ERROR_MESSAGES[code] });

    // Runs a socket's queue actions in arrival order so a quick join + leave cannot reorder.
    let queueActions: Promise<void> = Promise.resolve();
    const enqueue = (action: () => Promise<void>) => {
      queueActions = queueActions.then(action).catch((error: unknown) => {
        logFailure(error);
        sendError(SOCKET_ERROR_CODES.internal);
      });
    };

    socket.on('queue:join', (payload) => {
      enqueue(async () => {
        if (!clientEventSchemas['queue:join'].safeParse(payload).success) {
          sendError(SOCKET_ERROR_CODES.invalidPayload);
          return;
        }
        const user = await users.findById(userId);
        if (!user) return void sendError(SOCKET_ERROR_CODES.unauthorized);
        if (isBanned(user, new Date())) return void sendError(SOCKET_ERROR_CODES.banned);
        if (!user.acceptedTermsAt) return void sendError(SOCKET_ERROR_CODES.termsRequired);

        const result = await matchmaker.join(userId, {
          socketId: socket.id,
          ip,
          deviceHash: user.deviceHash ?? null,
        });
        if (result === 'queued') socket.emit('queue:status', { waitingSec: 0 });
        else if (result === 'already_queued') sendError(SOCKET_ERROR_CODES.alreadyQueued);
        else sendError(SOCKET_ERROR_CODES.inRoom);
      });
    });

    socket.on('queue:leave', (payload) => {
      enqueue(async () => {
        if (!clientEventSchemas['queue:leave'].safeParse(payload).success) {
          sendError(SOCKET_ERROR_CODES.invalidPayload);
          return;
        }
        await matchmaker.leave(userId, socket.id);
      });
    });

    socket.on('disconnect', () => {
      presence.disconnect(userId).catch(logFailure);
      enqueue(() => matchmaker.leave(userId, socket.id));
    });

    presence
      .connect(userId)
      .then(() => presence.stats())
      .then((stats) => socket.emit('online:count', stats))
      .catch(logFailure);
  });

  // Each instance emits to its own sockets so the Redis adapter does not duplicate broadcasts.
  const every = (intervalMs: number, task: () => Promise<unknown>) => {
    const timer = setInterval(() => {
      task().catch(logFailure);
    }, intervalMs);
    timer.unref();
    timers.push(timer);
  };

  app.addHook('onListen', async () => {
    every(broadcastIntervalMs, async () => io.local.emit('online:count', await presence.stats()));
    every(HEARTBEAT_INTERVAL_MS, () =>
      Promise.all([presence.heartbeat(), matchmaker.heartbeat(), rooms.heartbeat()]),
    );
    every(SWEEP_INTERVAL_MS, () => Promise.all([presence.sweep(), rooms.sweep()]));
    every(matchTickMs, () => matchmaker.tick());
    every(QUEUE_STATUS_INTERVAL_MS, async () => {
      for (const { socketId, waitingSec } of await matchmaker.waitingTimes()) {
        io.local.to(socketId).emit('queue:status', { waitingSec });
      }
    });
  });

  app.addHook('preClose', async () => {
    timers.forEach(clearInterval);
    await rooms.shutdown();
    io.local.disconnectSockets(true);
    await presence.flush();
    io.engine.close();
  });

  return { app, io, matchmaker, rooms };
}
