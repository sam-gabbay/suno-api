import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDownloadInput, prepareDownload } from '../src/lib/download.ts';

const clipId = '12345678-1234-1234-1234-123456789abc';
test('download validates IDs and formats before upstream authorization', async () => {
  for (const body of [null, {}, { clip_id: '../anything' }, { clip_id: clipId, format: 'wav' }]) {
    assert.throws(() => parseDownloadInput(body), { status: 400 });
  }
  assert.deepEqual(parseDownloadInput({ clip_id: clipId }), { clip_id: clipId, format: 'mp3' });
  await assert.rejects(prepareDownload({}, 'invalid'), { status: 400 });
});

test('one unlock is followed by conversion polling without another charge request', async () => {
  let authorizations = 0;
  let polls = 0;
  const client = {
    async post(url, body) {
      authorizations++;
      assert.equal(url, 'https://studio-api-prod.suno.com/api/download/authorize');
      assert.deepEqual(body, { item_id: clipId, item_type: 'clip' });
      return { data: { ok: true, already_unlocked: true, credit_deducted: false } };
    },
    async get(url, options) {
      assert.ok(url.endsWith(`/clip/${clipId}`));
      assert.deepEqual(options.params, { format: 'mp3' });
      return { data: ++polls === 1 ? { ok: true, status: 'processing' } : { ok: true, status: 'ready', download_url: 'https://example.com/song.mp3' } };
    },
  };
  const result = await prepareDownload(client, clipId, 'mp3', { attempts: 2, intervalMs: 1 });
  assert.equal(authorizations, 1);
  assert.equal(polls, 2);
  assert.equal(result.credit_deducted, false);
});

test('denied authorization stops without polling or purchasing', async () => {
  const client = {
    async post() { return { data: { ok: false } }; },
    async get() { assert.fail('must not poll a denied clip'); },
  };
  await assert.rejects(prepareDownload(client, clipId), { status: 403 });
});

test('processing is bounded and malformed ready URLs are rejected', async () => {
  const client = {
    async post() { return { data: { ok: true } }; },
    async get() { return { data: { ok: true, status: 'processing' } }; },
  };
  await assert.rejects(prepareDownload(client, clipId, 'mp3', { attempts: 1, intervalMs: 1 }), { status: 504 });
  client.get = async () => ({ data: { ok: true, status: 'ready', download_url: 'http://example.com/song.mp3' } });
  await assert.rejects(prepareDownload(client, clipId), { status: 502 });
});
