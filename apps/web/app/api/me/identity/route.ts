import type { NextRequest } from 'next/server';
import { proxyToRealtime } from '@/lib/server/realtime-proxy';

export function POST(request: NextRequest) {
  return proxyToRealtime(request, '/api/me/identity');
}
