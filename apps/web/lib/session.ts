import {
  guestResponseSchema,
  identityLimitResponseSchema,
  userResponseSchema,
  type GuestResponse,
  type PublicUser,
} from 'shared';

const TOKEN_KEY = 'guest_token';

let memoryToken: string | null = null;
let pendingSession: Promise<GuestResponse> | null = null;

function readToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

function writeToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable in private windows; the in-memory token still works.
  }
}

function authHeaders(): HeadersInit {
  const token = readToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function requestGuest() {
  const response = await fetch('/api/guest', { method: 'POST', headers: authHeaders() });
  if (!response.ok) throw new Error(`Guest request failed: ${response.status}`);
  const session = guestResponseSchema.parse(await response.json());
  writeToken(session.token);
  return session;
}

/** Serializes first-visit requests across tabs so they share one guest account. */
function withGuestLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('guest-session', task) as Promise<T>;
  }
  return task();
}

export function loadSession(): Promise<GuestResponse> {
  pendingSession ??= withGuestLock(requestGuest).catch((error: unknown) => {
    pendingSession = null;
    throw error;
  });
  return pendingSession;
}

export function resetSession() {
  pendingSession = null;
  writeToken(null);
}

export class SessionExpiredError extends Error {}

export async function acceptTerms(): Promise<PublicUser> {
  const response = await fetch('/api/me/accept-terms', {
    method: 'POST',
    headers: authHeaders(),
  });
  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) throw new Error(`Accept terms failed: ${response.status}`);
  return userResponseSchema.parse(await response.json()).user;
}

export type IdentityRefreshResult =
  { status: 'updated'; user: PublicUser } | { status: 'limited'; nextRefreshAt: string };

export async function refreshIdentity(): Promise<IdentityRefreshResult> {
  const response = await fetch('/api/me/identity', { method: 'POST', headers: authHeaders() });
  if (response.status === 401) throw new SessionExpiredError();
  if (response.status === 429) {
    const limit = identityLimitResponseSchema.parse(await response.json());
    return { status: 'limited', nextRefreshAt: limit.nextIdentityRefreshAt };
  }
  if (!response.ok) throw new Error(`Identity refresh failed: ${response.status}`);
  return { status: 'updated', user: userResponseSchema.parse(await response.json()).user };
}
