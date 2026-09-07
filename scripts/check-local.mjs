import assert from 'node:assert/strict';
import { api } from './local-client.mjs';

const base = process.env.SUNO_LOCAL_URL || 'http://127.0.0.1:3210';
for (const [path, options] of [
  ['/api/health', {}],
  ['/api/generate', { method: 'POST' }],
  ['/api/download', { method: 'POST' }],
  ['/v1/chat/completions', { method: 'POST' }],
  ['/api/health', { headers: { authorization: 'Bearer incorrect' } }],
  ['/api/health', { headers: { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' } }],
]) {
  const response = await fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 401, `${path} must reject unauthorized requests`);
}
const health = await api('/api/health');
assert.equal(health.status, 'ok');
assert.equal(typeof health.suno_cookie_configured, 'boolean');
assert.equal(typeof health.captcha_key_configured, 'boolean');
await assert.rejects(api('/api/download', { clip_id: 'invalid' }), /HTTP 400/);
console.log('Passed: unauthorized generation, download, chat, and health requests rejected; authenticated health responds; invalid download rejected.');
console.log(JSON.stringify(health, null, 2));
