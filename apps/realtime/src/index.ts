import { captureError, flushErrors } from './instrument.js';
import prismaClient from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { createWordFilter, parseWordList } from 'shared/filter';
import { createTokenService } from './auth.js';
import { loadEnv } from './env.js';
import { loadBlocks } from './matchmaking.js';
import { createPrismaModerationStore } from './moderation.js';
import { Presence } from './presence.js';
import { createPrismaMatchStore } from './rooms.js';
import { buildServer } from './server.js';
import { createPrismaUserStore } from './users.js';

const { PrismaClient } = prismaClient;

const env = loadEnv();
const prisma = new PrismaClient();
const redis = new Redis(env.REDIS_URL);
const redisSubscriber = redis.duplicate();
// Resolves to apps/realtime from both src/ and dist/. The list never reaches the client.
const wordList = parseWordList(
  await readFile(new URL('../badwords.tr.txt', import.meta.url), 'utf8'),
);
const { app, io } = buildServer({
  webOrigin: env.WEB_ORIGIN,
  tokens: createTokenService(env.JWT_SECRET),
  users: createPrismaUserStore(prisma),
  matches: createPrismaMatchStore(prisma),
  moderationStore: createPrismaModerationStore(prisma),
  prisma,
  wordFilter: createWordFilter(wordList),
  internalSecret: env.INTERNAL_API_SECRET,
  guestLimitPerHour: env.GUEST_LIMIT_PER_HOUR,
  presence: new Presence(redis),
  redis,
  allowSameIp: env.MATCH_ALLOW_SAME_IP,
  avoidRecent: env.MATCH_AVOID_RECENT,
  trustProxy: env.TRUST_PROXY,
  logger: true,
  reportError: captureError,
});

// A Redis outage must not take the service down: ioredis reconnects once Redis is back.
for (const client of [redis, redisSubscriber]) {
  client.on('error', (error: Error) => app.log.warn({ message: error.message }, 'Redis error'));
}
io.adapter(createAdapter(redis, redisSubscriber));
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'Unhandled rejection');
  captureError(reason);
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  await prisma.$disconnect();
  await flushErrors();
  redisSubscriber.disconnect();
  redis.disconnect();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error(error);
        process.exit(1);
      });
  });
}

try {
  await Promise.all([prisma.$connect(), redis.ping()]);
  await loadBlocks(
    redis,
    await prisma.block.findMany({ select: { blockerId: true, blockedId: true } }),
  );
  await app.listen({ host: '0.0.0.0', port: env.PORT });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exit(1);
}
