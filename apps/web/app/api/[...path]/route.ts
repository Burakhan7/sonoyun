import { NextResponse, type NextRequest } from 'next/server';
import { proxyToRealtime } from '@/lib/server/realtime-proxy';

const ID = '[A-Za-z0-9_-]{1,64}';

// Only these realtime routes are reachable through the web app.
const ALLOWED_ROUTES: Record<string, RegExp[]> = {
  GET: [
    /^\/api\/friends$/,
    /^\/api\/conversations$/,
    new RegExp(`^/api/conversations/${ID}/messages$`),
    /^\/api\/me\/unread$/,
  ],
  POST: [
    new RegExp(`^/api/friends/${ID}/remove$`),
    new RegExp(`^/api/friends/requests/${ID}/cancel$`),
    /^\/api\/me\/transfer-code$/,
    /^\/api\/me\/delete$/,
    /^\/api\/transfer\/redeem$/,
  ],
};

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = `/api/${path.join('/')}`;
  const allowed = ALLOWED_ROUTES[request.method]?.some((route) => route.test(target));
  if (!allowed) return NextResponse.json({ code: 'not_found' }, { status: 404 });
  return proxyToRealtime(request, target);
}

export { handle as GET, handle as POST };
