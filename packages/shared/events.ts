import { z } from 'zod';

export const handshakeAuthSchema = z.object({ token: z.string().min(1).max(2048) });

export const SOCKET_AUTH_ERRORS = {
  unauthorized: 'unauthorized',
  banned: 'banned',
  internal: 'internal',
} as const;

export const onlineCountSchema = z
  .object({
    online: z.number().int().nonnegative(),
    activeGames: z.number().int().nonnegative(),
    gamesToday: z.number().int().nonnegative(),
  })
  .strict();

export type OnlineCount = z.infer<typeof onlineCountSchema>;

export interface ServerToClientEvents {
  'online:count': (payload: OnlineCount) => void;
}

export type ClientToServerEvents = Record<never, never>;
