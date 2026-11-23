import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import {
  SOCKET_AUTH_ERRORS,
  SOCKET_ERROR_CODES,
  clientEventSchemas,
  handshakeAuthSchema,
  opponentSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketErrorCode,
} from 'shared';
import { createWordFilter, type WordFilter } from 'shared/filter';
import { Server } from 'socket.io';
import { AccountService } from './account.js';
import { AdminService, registerAdminRoutes } from './admin.js';
import type { TokenService } from './auth.js';
import { ChatService } from './chat.js';
import { clientIp } from './client-ip.js';
import { DmService } from './dm.js';
import { FriendService, type FriendResult } from './friends.js';
import { INVITE_TTL_MS, InviteService } from './invites.js';
import { AccessLogger, type AccessEvent } from './logging5651.js';
import { Matchmaker } from './matchmaking.js';
import { ModerationService, type ModerationStore } from './moderation.js';
import type { Presence } from './presence.js';
import { RATE_RULES, RateLimiter } from './ratelimit.js';
import { RoomService, type MatchStore, type RoomTimings } from './rooms.js';
import { registerApiRoutes } from './routes.js';
import { TransferService } from './transfer.js';
import { isBanned, type UserStore } from './users.js';

const BROADCAST_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const SWEEP_INTERVAL_MS = 15_000;
const MATCH_TICK_MS = 500;
const QUEUE_STATUS_INTERVAL_MS = 1_000;
const TYPING_INTERVAL_MS = 1_000;
const DM_PURGE_INTERVAL_MS = 5 * 60 * 1000;
const ACCESS_LOG_FLUSH_MS = 2_000;
const userRoom = (userId: string) => `user:${userId}`;

const ERROR_MESSAGES: Record<SocketErrorCode, string> = {
  [SOCKET_ERROR_CODES.invalidPayload]: 'Geçersiz istek.',
  [SOCKET_ERROR_CODES.unauthorized]: 'Oturumun geçersiz.',
  [SOCKET_ERROR_CODES.banned]: 'Hesabın geçici olarak kısıtlandı.',
  [SOCKET_ERROR_CODES.termsRequired]: 'Devam etmek için kuralları onaylamalısın.',
  [SOCKET_ERROR_CODES.alreadyQueued]: 'Başka bir sekmede zaten rakip arıyorsun.',
  [SOCKET_ERROR_CODES.inRoom]: 'Zaten bir oyundasın.',
  [SOCKET_ERROR_CODES.noActiveGame]: 'Devam eden bir oyunun yok.',
  [SOCKET_ERROR_CODES.gameFailed]: 'Oyun başlatılamadı. Lütfen yeni bir oyun dene.',
  [SOCKET_ERROR_CODES.rateLimited]: 'Çok hızlı gidiyorsun, biraz bekle.',
  [SOCKET_ERROR_CODES.contactBlocked]: 'Link ve iletişim bilgisi paylaşılamaz.',
  [SOCKET_ERROR_CODES.muted]: 'Dil kuralları nedeniyle 10 dakika mesaj gönderemezsin.',
  [SOCKET_ERROR_CODES.matchSuspended]: 'Hesabın inceleme nedeniyle 24 saat eşleşmeye kapalı.',
  [SOCKET_ERROR_CODES.chatClosed]: 'Sohbet sona erdi.',
  [SOCKET_ERROR_CODES.cardsRejected]: 'Kart seçimi geçersiz.',
  [SOCKET_ERROR_CODES.notAllowed]: 'Bu işlem yapılamıyor.',
  [SOCKET_ERROR_CODES.alreadyFriends]: 'Zaten arkadaşsınız.',
  [SOCKET_ERROR_CODES.friendLimit]: 'Arkadaş veya istek sınırına ulaşıldı.',
  [SOCKET_ERROR_CODES.inviteUnavailable]: 'Bu davet artık geçerli değil.',
  [SOCKET_ERROR_CODES.internal]: 'Bir sorun oluştu, lütfen tekrar dene.',
};

export interface ServerOptions {
  webOrigin: string;
  tokens: TokenService;
  users: UserStore;
  presence: Presence;
  redis: Redis;
  matches: MatchStore;
  moderationStore: ModerationStore;
  /** Enables friends, DMs, invites and account transfer. */
  prisma?: PrismaClient;
  wordFilter?: WordFilter;
  internalSecret?: string;
  guestLimitPerHour?: number;
  allowSameIp?: boolean;
  trustProxy?: boolean;
  logger?: boolean;
  /** Receives unexpected errors, e.g. to forward them to Sentry. */
  reportError?: (error: unknown) => void;
  broadcastIntervalMs?: number;
  matchTickMs?: number;
  timings?: RoomTimings;
}

interface SocketData {
  userId: string;
  ip: string;
  /** Source port. Unknown behind a reverse proxy, which hides the visitor's port. */
  port: number | null;
}

export function buildServer({
  webOrigin,
  tokens,
  users,
  presence,
  redis,
  matches,
  moderationStore,
  prisma,
  wordFilter = createWordFilter([]),
  internalSecret,
  guestLimitPerHour,
  allowSameIp = false,
  trustProxy = false,
  logger = false,
  reportError,
  broadcastIntervalMs = BROADCAST_INTERVAL_MS,
  matchTickMs = MATCH_TICK_MS,
  timings,
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

  const logFailure = (error: unknown) => {
    app.log.error(error);
    reportError?.(error);
  };
  const accessLog = prisma ? new AccessLogger(prisma, logFailure) : null;
  const logSocketEvent = (socketId: string, event: AccessEvent) => {
    const data = io.sockets.sockets.get(socketId)?.data;
    if (data) accessLog?.record({ userId: data.userId, ip: data.ip, port: data.port, event });
  };

  const limiter = new RateLimiter(redis);
  const chat = new ChatService(redis, limiter, wordFilter);
  const rooms = new RoomService({
    redis,
    users,
    matches,
    chat,
    timings,
    onError: logFailure,
    send: (socketId, event, payload) => {
      (io.to(socketId) as unknown as { emit(name: string, data: unknown): void }).emit(
        event,
        payload,
      );
    },
  });
  const matchmaker = new Matchmaker(
    redis,
    async (roomId, a, b) => {
      await rooms.create(roomId, a, b);
      logSocketEvent(a.socketId, 'match');
      logSocketEvent(b.socketId, 'match');
    },
    { allowSameIp },
  );
  const removeFromQueue = (userId: string) => matchmaker.remove(userId);
  const friends = prisma ? new FriendService(prisma, redis, limiter, presence) : null;
  const dm = prisma && friends ? new DmService(prisma, chat, friends, presence) : null;
  const transfers = prisma ? new TransferService(prisma) : null;
  const invites = friends
    ? new InviteService({
        redis,
        friends,
        limiter,
        removeFromQueue,
        isConnected: async (socketId) => (await io.in(socketId).fetchSockets()).length > 0,
        createRoom: async (roomId, a, b) => {
          await rooms.create(roomId, a, b, { friendly: true });
          logSocketEvent(a.socketId, 'match');
          logSocketEvent(b.socketId, 'match');
        },
      })
    : null;
  const moderation = new ModerationService({
    redis,
    store: moderationStore,
    chat,
    limiter,
    removeFromQueue,
    social:
      friends && dm
        ? {
            haveRelationship: (a, b) => friends.areFriends(a, b),
            directSnapshot: (a, b, limit) => dm.snapshotBetween(a, b, limit),
            afterBlock: (a, b) => friends.disconnect(a, b),
          }
        : undefined,
  });

  const kickUser = async (userId: string) => {
    await matchmaker.remove(userId);
    io.in(userRoom(userId)).disconnectSockets(true);
  };
  const accounts = prisma ? new AccountService(prisma, redis) : null;

  app.get('/health', async () => ({ status: 'ok' }));

  // Unlike /health, this reports whether the service can do useful work right now.
  app.get('/ready', async (_request, reply) => {
    const checks = await Promise.allSettled([
      redis.ping(),
      prisma ? prisma.$queryRaw`SELECT 1` : Promise.resolve(),
    ]);
    const [redisCheck, databaseCheck] = checks;
    const ready = checks.every((check) => check.status === 'fulfilled');
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'unavailable',
      redis: redisCheck.status === 'fulfilled',
      database: databaseCheck.status === 'fulfilled',
    });
  });
  registerApiRoutes(app, {
    tokens,
    users,
    limiter,
    guestLimitPerHour,
    trustProxy,
    internalSecret,
    social:
      friends && dm && transfers
        ? {
            friends,
            dm,
            transfers,
            deleteAccount: async (userId) => {
              await kickUser(userId);
              await accounts?.delete(userId);
            },
          }
        : undefined,
  });
  if (prisma && internalSecret) {
    registerAdminRoutes(app, new AdminService(prisma, redis, kickUser), internalSecret);
  }

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
      socket.data.port = trustProxy ? null : (socket.request.socket.remotePort ?? null);
      users.touch(user.id, now).catch(logFailure);
      return next();
    } catch (error) {
      logFailure(error);
      return next(new Error(SOCKET_AUTH_ERRORS.internal));
    }
  });

  io.on('connection', (socket) => {
    const { userId, ip } = socket.data;
    const sendError = (code: SocketErrorCode) =>
      socket.emit('error', { code, message: ERROR_MESSAGES[code] });

    // Runs a socket's queue actions in arrival order so a quick join + leave cannot reorder.
    let queueActions: Promise<void> = Promise.resolve();
    const enqueue = (action: () => Promise<void>) => {
      queueActions = queueActions.then(action).catch((error: unknown) => {
        logFailure(error);
        sendError(SOCKET_ERROR_CODES.internal);
      });
    };

    void socket.join(userRoom(userId));
    logSocketEvent(socket.id, 'connect');

    const announceFriendship = async (result: FriendResult, actorId: string) => {
      if (result.status !== 'accepted') return;
      io.to(userRoom(actorId)).emit('friend:accepted', {
        userId: result.friendId,
        conversationId: result.conversationId,
      });
      io.to(userRoom(result.friendId)).emit('friend:accepted', {
        userId: actorId,
        conversationId: result.conversationId,
      });
    };

    socket.on('friend:request', (payload) => {
      const parsed = clientEventSchemas['friend:request'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        if (!friends) return void sendError(SOCKET_ERROR_CODES.notAllowed);
        const targetId = parsed.data.userId;
        const result = await friends.request(userId, targetId);
        if (result.status === 'error') return void sendError(result.code);
        if (result.status === 'pending') {
          socket.emit('friend:requested', { userId: targetId, requestId: result.requestId });
          const sender = result.created ? await users.findById(userId) : null;
          if (sender) {
            io.to(userRoom(targetId)).emit('friend:incoming', {
              requestId: result.requestId,
              from: opponentSchema.parse({
                id: sender.id,
                nickname: sender.nickname,
                avatarId: sender.avatarId,
              }),
            });
          }
        }
        await announceFriendship(result, userId);
      });
    });

    socket.on('friend:respond', (payload) => {
      const parsed = clientEventSchemas['friend:respond'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        if (!friends) return void sendError(SOCKET_ERROR_CODES.notAllowed);
        const result = await friends.respond(userId, parsed.data.requestId, parsed.data.accept);
        if (result.status === 'error') return void sendError(result.code);
        await announceFriendship(result, userId);
      });
    });

    socket.on('dm:send', (payload) => {
      const parsed = clientEventSchemas['dm:send'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        if (!dm) return void sendError(SOCKET_ERROR_CODES.notAllowed);
        const { conversationId, body } = parsed.data;
        const result = await dm.send(userId, conversationId, body);
        if (!result.ok) return void sendError(result.code);
        logSocketEvent(socket.id, 'message');
        io.to(userRoom(userId))
          .to(userRoom(result.recipientId))
          .emit('dm:message', { conversationId, message: result.message });
      });
    });

    socket.on('dm:read', (payload) => {
      const parsed = clientEventSchemas['dm:read'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        await dm?.markRead(userId, parsed.data.conversationId);
      });
    });

    socket.on('invite:create', (payload) => {
      const parsed = clientEventSchemas['invite:create'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        if (!invites) return void sendError(SOCKET_ERROR_CODES.notAllowed);
        const friendId = parsed.data.friendId;
        const result = await invites.create(userId, friendId, socket.id);
        if (!result.ok) return void sendError(result.code);
        const sender = await users.findById(userId);
        if (!sender) return void sendError(SOCKET_ERROR_CODES.unauthorized);
        const { inviteId } = result.value;
        socket.emit('invite:created', { inviteId, expiresInMs: INVITE_TTL_MS });
        io.to(userRoom(friendId)).emit('invite:incoming', {
          inviteId,
          from: opponentSchema.parse({
            id: sender.id,
            nickname: sender.nickname,
            avatarId: sender.avatarId,
          }),
          expiresInMs: INVITE_TTL_MS,
        });
      });
    });

    socket.on('invite:respond', (payload) => {
      const parsed = clientEventSchemas['invite:respond'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        if (!invites) return void sendError(SOCKET_ERROR_CODES.notAllowed);
        const { inviteId, accept } = parsed.data;
        if (!accept) {
          const declined = await invites.decline(inviteId, userId);
          if (declined) {
            io.to(declined.fromSocket).emit('invite:closed', { inviteId, reason: 'declined' });
          }
          return;
        }
        const result = await invites.accept(inviteId, userId, socket.id);
        if (!result.ok) sendError(result.code);
      });
    });

    socket.on('invite:cancel', (payload) => {
      const parsed = clientEventSchemas['invite:cancel'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        const { inviteId } = parsed.data;
        const cancelled = await invites?.cancel(inviteId, userId);
        if (cancelled) {
          io.to(userRoom(cancelled.to)).emit('invite:closed', { inviteId, reason: 'cancelled' });
        }
      });
    });

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
        if (await moderation.isSuspended(userId)) {
          return void sendError(SOCKET_ERROR_CODES.matchSuspended);
        }
        if (!(await limiter.hit(RATE_RULES.queueJoin, userId))) {
          return void sendError(SOCKET_ERROR_CODES.rateLimited);
        }

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

    socket.on('game:answer', (payload) => {
      const parsed = clientEventSchemas['game:answer'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      const { roundNo, answer, prediction } = parsed.data;
      try {
        rooms.answer(userId, socket.id, roundNo, {
          answer,
          ...(prediction ? { prediction } : {}),
        });
      } catch (error) {
        logFailure(error);
        sendError(SOCKET_ERROR_CODES.internal);
      }
    });

    socket.on('game:resume', (payload) => {
      if (!clientEventSchemas['game:resume'].safeParse(payload).success) {
        return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      }
      enqueue(async () => {
        if (!(await rooms.resume(userId, socket.id))) sendError(SOCKET_ERROR_CODES.noActiveGame);
      });
    });

    socket.on('cards:pick', (payload) => {
      const parsed = clientEventSchemas['cards:pick'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        const accepted = await rooms.pick(userId, socket.id, parsed.data.cardIds);
        if (!accepted) sendError(SOCKET_ERROR_CODES.cardsRejected);
      });
    });

    socket.on('chat:send', (payload) => {
      const parsed = clientEventSchemas['chat:send'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        const refused = await rooms.sendMessage(userId, socket.id, parsed.data.body);
        if (refused) sendError(refused);
        else logSocketEvent(socket.id, 'message');
      });
    });

    let lastTypingAt = 0;
    socket.on('chat:typing', (payload) => {
      if (!clientEventSchemas['chat:typing'].safeParse(payload).success) return;
      const now = Date.now();
      if (now - lastTypingAt < TYPING_INTERVAL_MS) return;
      lastTypingAt = now;
      rooms.typing(userId, socket.id);
    });

    socket.on('chat:leave', (payload) => {
      if (!clientEventSchemas['chat:leave'].safeParse(payload).success) {
        return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      }
      enqueue(() => rooms.leaveChat(userId, socket.id));
    });

    socket.on('chat:rate', (payload) => {
      const parsed = clientEventSchemas['chat:rate'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(() => matches.rate(parsed.data.roomId, userId, parsed.data.value));
    });

    socket.on('user:report', (payload) => {
      const parsed = clientEventSchemas['user:report'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        const result = await moderation.report(userId, parsed.data);
        if (result.ok) {
          socket.emit('moderation:result', { action: 'report', userId: parsed.data.userId });
        } else {
          sendError(result.code);
        }
      });
    });

    socket.on('user:block', (payload) => {
      const parsed = clientEventSchemas['user:block'].safeParse(payload);
      if (!parsed.success) return void sendError(SOCKET_ERROR_CODES.invalidPayload);
      enqueue(async () => {
        const result = await moderation.block(userId, parsed.data.userId);
        if (!result.ok) return void sendError(result.code);
        socket.emit('moderation:result', { action: 'block', userId: parsed.data.userId });
        await rooms.closeForBlock(userId, parsed.data.userId);
      });
    });

    socket.on('disconnect', () => {
      accessLog?.record({ userId, ip, port: socket.data.port, event: 'disconnect' });
      rooms.handleDisconnect(userId, socket.id);
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
    if (dm) every(DM_PURGE_INTERVAL_MS, () => dm.purgeExpired());
    if (accessLog) every(ACCESS_LOG_FLUSH_MS, () => accessLog.flush());
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
    await accessLog?.flush();
    io.engine.close();
  });

  return { app, io, matchmaker, rooms };
}
