import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
let config = {};
try { config = parseEnv(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')); }
catch { /* API helper below returns the setup instruction. */ }
const baseUrl = process.env.SUNO_LOCAL_URL || 'http://127.0.0.1:3210';
const parsed = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
  throw new Error('This helper only sends local credentials to a loopback address.');
}

export async function api(path, body) {
  const key = process.env.SUNO_API_KEY || config.SUNO_API_KEY;
  if (!key) throw new Error('Run npm run setup first.');
  let response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(body === undefined ? 60000 : 180000),
    });
  } catch {
    throw new Error('Local API could not respond. Start it with npm run dev. If a generation timed out, inspect Suno before resubmitting.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error || 'API request failed'}`);
  return result;
}
