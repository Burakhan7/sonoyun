import { NextResponse, type NextRequest } from 'next/server';

export const config = { matcher: ['/admin', '/admin/:path*', '/api/admin/:path*'] };

const notFound = () => new NextResponse('Not found', { status: 404 });

function normalizeIp(ip: string) {
  const trimmed = ip.trim();
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

/** On Vercel, x-real-ip is set by the platform and cannot be supplied by the visitor. */
function visitorIp(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const realIp = request.headers.get('x-real-ip');
    return realIp ? normalizeIp(realIp) : null;
  }
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0];
  return normalizeIp(forwarded ?? '127.0.0.1');
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function safeEqual(a: string, b: string) {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i]! ^ right[i]!;
  return difference === 0;
}

async function hasValidCredentials(request: NextRequest, user: string, password: string) {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    const bytes = Uint8Array.from(atob(header.slice(6)), (char) => char.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return false;
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  const [userOk, passwordOk] = await Promise.all([
    safeEqual(decoded.slice(0, separator), user),
    safeEqual(decoded.slice(separator + 1), password),
  ]);
  return userOk && passwordOk;
}

/** Browsers resend Basic Auth automatically, so writes must come from this same site. */
function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  const allowlist = (process.env.ADMIN_IP_ALLOWLIST ?? '')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean);

  // The panel does not exist unless it is fully configured, and is invisible to other IPs.
  if (!user || !password || allowlist.length === 0) return notFound();
  const ip = visitorIp(request);
  if (!ip || !allowlist.includes(ip)) return notFound();

  if (!(await hasValidCredentials(request, user, password))) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Admin", charset="UTF-8"' },
    });
  }
  if (request.method !== 'GET' && !isSameOrigin(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const response = NextResponse.next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
