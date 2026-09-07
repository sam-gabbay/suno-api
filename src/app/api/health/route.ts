import { NextResponse } from 'next/server';
import { DEFAULT_MODEL } from '@/lib/SunoApi';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    suno_cookie_configured: Boolean(process.env.SUNO_COOKIE?.trim()),
    captcha_key_configured: Boolean(process.env.TWOCAPTCHA_KEY?.trim()),
    model: DEFAULT_MODEL,
  });
}
