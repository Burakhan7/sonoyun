import Fastify from 'fastify';
import { Server } from 'socket.io';

export interface ServerOptions {
  webOrigin: string;
  logger?: boolean;
}

export function buildServer({ webOrigin, logger = false }: ServerOptions) {
  const app = Fastify({ logger });
  const io = new Server(app.server, {
    cors: { origin: webOrigin, credentials: true },
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.addHook('preClose', async () => {
    io.local.disconnectSockets(true);
    io.engine.close();
  });

  return { app, io };
}
