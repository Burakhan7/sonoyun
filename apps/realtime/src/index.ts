import prismaClient from '@prisma/client';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';

const { PrismaClient } = prismaClient;

const env = loadEnv();
const prisma = new PrismaClient();
const redis = new Redis(env.REDIS_URL);
const redisSubscriber = redis.duplicate();
const { app, io } = buildServer({ webOrigin: env.WEB_ORIGIN, logger: true });

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
  await app.listen({ host: '0.0.0.0', port: env.PORT });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exit(1);
}
