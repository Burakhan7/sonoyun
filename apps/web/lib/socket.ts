import type { ClientToServerEvents, ServerToClientEvents } from 'shared';
import { io, type Socket } from 'socket.io-client';
import { deviceHash } from './device';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:4000';

let socket: AppSocket | null = null;
let socketToken: string | null = null;

// Called on every (re)connect, so the latest token is always sent.
const auth = (send: (data: object) => void) => {
  void deviceHash().then((device) =>
    send(device ? { token: socketToken, device } : { token: socketToken }),
  );
};

/** Returns the page-wide socket so client navigation does not count as leaving the site. */
export function connectSocket(token: string): AppSocket {
  if (!socket) {
    socketToken = token;
    socket = io(REALTIME_URL, { auth, withCredentials: true });
    return socket;
  }

  if (socketToken !== token) {
    socketToken = token;
    socket.disconnect();
  }
  if (!socket.connected) socket.connect();
  return socket;
}
