import type { AxiosInstance } from 'axios';

const DOWNLOAD_BASE = 'https://studio-api-prod.suno.com/api/download';
const CLIP_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export type DownloadFormat = 'mp3' | 'm4a';

export class DownloadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function parseDownloadInput(body: unknown): { clip_id: string; format: DownloadFormat } {
  const input = body as { clip_id?: unknown; format?: unknown } | null;
  if (!input || typeof input.clip_id !== 'string' || !CLIP_ID.test(input.clip_id)) {
    throw new DownloadError('Provide a valid clip_id UUID.', 400);
  }
  const format = input.format ?? 'mp3';
  if (format !== 'mp3' && format !== 'm4a') {
    throw new DownloadError('Supported download formats are mp3 and m4a.', 400);
  }
  return { clip_id: input.clip_id, format };
}

// Authorization uses an included download the first time a clip is unlocked.
// Never retry this POST automatically, and never purchase additional downloads.
export async function prepareDownload(
  client: Pick<AxiosInstance, 'get' | 'post'>,
  clipId: string,
  format: DownloadFormat = 'mp3',
  polling = { attempts: 30, intervalMs: 2000 },
) {
  parseDownloadInput({ clip_id: clipId, format });
  const signal = AbortSignal.timeout(90000);
  const { data: authorization } = await client.post(`${DOWNLOAD_BASE}/authorize`, {
    item_id: clipId, item_type: 'clip',
  }, { signal });
  if (authorization?.ok !== true) {
    throw new DownloadError('Suno did not authorize this download. Check ownership and download allowance.', 403);
  }
  for (let attempt = 0; attempt < polling.attempts; attempt++) {
    const { data } = await client.get(`${DOWNLOAD_BASE}/clip/${clipId}`, { params: { format }, signal });
    if (data?.ok !== true) throw new DownloadError('Suno could not prepare this download.', 502);
    if (data.status === 'ready') {
      let url;
      try { url = new URL(data.download_url); } catch {}
      if (!url || url.protocol !== 'https:' || url.username || url.password) {
        throw new DownloadError('Suno returned an invalid download URL.', 502);
      }
      return {
        clip_id: clipId, format, status: 'ready', download_url: url.href,
        already_unlocked: authorization.already_unlocked === true,
        credit_deducted: authorization.credit_deducted === true,
      };
    }
    if (data.status !== 'processing') throw new DownloadError('Suno reported an unsuccessful download conversion.', 502);
    if (attempt + 1 < polling.attempts) await new Promise((resolve) => setTimeout(resolve, polling.intervalMs));
  }
  throw new DownloadError('Download is still processing. Retry this clip ID; do not generate another song.', 504);
}
