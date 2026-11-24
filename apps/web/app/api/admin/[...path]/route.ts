import { NextResponse, type NextRequest } from 'next/server';

const ID = '[A-Za-z0-9_-]{1,64}';

// Access to these routes is enforced by middleware.ts.
const ALLOWED_ROUTES: Record<string, RegExp[]> = {
  GET: [/^reports$/, /^chats$/, new RegExp(`^chats/(room|dm)/${ID}$`)],
  POST: [
    new RegExp(`^reports/${ID}/status$`),
    new RegExp(`^users/${ID}/ban$`),
    new RegExp(`^users/${ID}/unban$`),
  ],
};

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = path.join('/');
  const secret = process.env.INTERNAL_API_SECRET;
  const allowed = ALLOWED_ROUTES[request.method]?.some((route) => route.test(target));
  if (!secret || !allowed) return NextResponse.json({ code: 'not_found' }, { status: 404 });

  const base =
    process.env.REALTIME_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_REALTIME_URL ??
    'http://localhost:4000';
  const body = request.method === 'POST' ? await request.text() : '';

  try {
    const upstream = await fetch(`${base}/internal/admin/${target}${request.nextUrl.search}`, {
      method: request.method,
      headers: {
        'x-internal-secret': secret,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body } : {}),
      cache: 'no-store',
    });
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ code: 'unavailable' }, { status: 503 });
  }
}

export { handle as GET, handle as POST };
