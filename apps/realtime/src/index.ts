import prismaClient from '@prisma/client';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { createTokenService } from './auth.js';
import { loadEnv } from './env.js';
import { loadBlocks } from './matchmaking.js';
import { Presence } from './presence.js';
import { createPrismaMatchStore } from './rooms.js';
import { buildServer } from './server.js';
import { createPrismaUserStore } from './users.js';

const { PrismaClient } = prismaClient;

const env = loadEnv();
const prisma = new PrismaClient();
const redis = new Redis(env.REDIS_URL);
const redisSubscriber = redis.duplicate();
const { app, io } = buildServer({
  webOrigin: env.WEB_ORIGIN,
  tokens: createTokenService(env.JWT_SECRET),
  users: createPrismaUserStore(prisma),
  matches: createPrismaMatchStore(prisma),
  presence: new Presence(redis),
  redis,
  allowSameIp: env.MATCH_ALLOW_SAME_IP,
  trustProxy: env.TRUST_PROXY,
  logger: true,
});

io.adapter(createAdapter(redis, redisSubscriber));

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  await prisma.$disconnect();
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
