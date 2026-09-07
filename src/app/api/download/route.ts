import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sunoApi } from '@/lib/SunoApi';
import { DownloadError, parseDownloadInput } from '@/lib/download';
import { corsHeaders } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    let body;
    try { body = await req.json(); }
    catch { throw new DownloadError('Provide a JSON request body.', 400); }
    const { clip_id, format } = parseDownloadInput(body);
    const result = await (await sunoApi(cookies().toString())).download(clip_id, format);
    return NextResponse.json(result, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) {
    const upstream = error as { response?: { status?: number } };
    const status = error instanceof DownloadError ? error.status : upstream.response?.status || 502;
    const message = error instanceof Error ? error.message : 'Unable to prepare the download.';
    return NextResponse.json({ error: message }, { status, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
