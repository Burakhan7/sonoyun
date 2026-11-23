import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { guestResponseSchema } from 'shared';

const COOKIE_NAME = 'guest_token';
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function realtimeUrl() {
  return (
    process.env.REALTIME_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_REALTIME_URL ??
    'http://localhost:4000'
  );
}

/** Lets the realtime service rate-limit by the visitor's IP instead of this server's. */
function internalHeaders(request: NextRequest): Record<string, string> {
  const secret = process.env.INTERNAL_API_SECRET;
  const clientIp = request.headers.get('x-real-ip');
  return secret && clientIp ? { 'x-internal-secret': secret, 'x-client-ip': clientIp } : {};
}

export async function proxyToRealtime(request: NextRequest, path: string) {
  const cookieStore = await cookies();
  const authorization =
    request.headers.get('authorization') ??
    (cookieStore.has(COOKIE_NAME) ? `Bearer ${cookieStore.get(COOKIE_NAME)?.value}` : null);

  let upstream: Response;
  try {
    upstream = await fetch(`${realtimeUrl()}${path}`, {
      method: 'POST',
      headers: { ...(authorization ? { authorization } : {}), ...internalHeaders(request) },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ code: 'unavailable' }, { status: 503 });
  }

  const body = await upstream.text();
  const response = new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

  if (upstream.status === 401) response.cookies.delete(COOKIE_NAME);

  if (upstream.ok) {
    const guest = guestResponseSchema.safeParse(safeJson(body));
    if (guest.success) {
      response.cookies.set(COOKIE_NAME, guest.data.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: COOKIE_MAX_AGE_SECONDS,
      });
    }
  }
  return response;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
