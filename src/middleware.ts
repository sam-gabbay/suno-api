import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const key = process.env.SUNO_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'Set SUNO_API_KEY in .env.local.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${key}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = { matcher: ['/api/:path*', '/v1/:path*'] };
