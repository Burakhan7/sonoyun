import type { ClientToServerEvents, ServerToClientEvents } from 'shared';
import { io, type Socket } from 'socket.io-client';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:4000';

let socket: AppSocket | null = null;
let socketToken: string | null = null;

/** Returns the page-wide socket so client navigation does not count as leaving the site. */
export function connectSocket(token: string): AppSocket {
  if (!socket) {
    socket = io(REALTIME_URL, { auth: { token }, withCredentials: true });
    socketToken = token;
    return socket;
  }

  if (socketToken !== token) {
    socketToken = token;
    socket.auth = { token };
    socket.disconnect();
  }
  if (!socket.connected) socket.connect();
  return socket;
}
