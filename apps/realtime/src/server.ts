import Fastify from 'fastify';
import {
  SOCKET_AUTH_ERRORS,
  handshakeAuthSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from 'shared';
import { Server } from 'socket.io';
import type { TokenService } from './auth.js';
import type { Presence } from './presence.js';
import { registerApiRoutes } from './routes.js';
import { isBanned, type UserStore } from './users.js';

const BROADCAST_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const SWEEP_INTERVAL_MS = 15_000;

export interface ServerOptions {
  webOrigin: string;
  tokens: TokenService;
  users: UserStore;
  presence: Presence;
  logger?: boolean;
  broadcastIntervalMs?: number;
}

interface SocketData {
  userId: string;
}

export function buildServer({
  webOrigin,
  tokens,
  users,
  presence,
  logger = false,
  broadcastIntervalMs = BROADCAST_INTERVAL_MS,
}: ServerOptions) {
  const app = Fastify({ logger });
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
      users.touch(user.id, now).catch(logFailure);
      return next();
    } catch (error) {
      logFailure(error);
      return next(new Error(SOCKET_AUTH_ERRORS.internal));
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data;
    socket.on('disconnect', () => {
      presence.disconnect(userId).catch(logFailure);
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
    every(HEARTBEAT_INTERVAL_MS, () => presence.heartbeat());
    every(SWEEP_INTERVAL_MS, () => presence.sweep());
  });

  app.addHook('preClose', async () => {
    timers.forEach(clearInterval);
    io.local.disconnectSockets(true);
    await presence.flush();
    io.engine.close();
  });

  return { app, io };
}
