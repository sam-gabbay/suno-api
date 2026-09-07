import test from 'node:test';
import assert from 'node:assert/strict';
import { upstreamError } from '../src/lib/upstream-error.ts';

test('authentication failures preserve status without retaining credentials', () => {
  const secret = 'test-secret-must-not-appear';
  const error = upstreamError({
    message: secret,
    config: { headers: { Cookie: secret, Authorization: secret } },
    request: { token: secret },
    response: { status: 403, data: { detail: secret }, headers: { 'set-cookie': secret } },
  });
  assert.equal(error.response.status, 403);
  assert.match(error.message, /Refresh SUNO_COOKIE/);
  assert.ok(!JSON.stringify(error).includes(secret));
  assert.equal(error.config, undefined);
  assert.equal(error.request, undefined);
});

test('network failures discard request objects while remaining classifiable', () => {
  const error = upstreamError({ code: 'ETIMEDOUT', request: { secret: 'private' } });
  assert.equal(error.request, true);
  assert.equal(error.response, undefined);
  assert.match(error.message, /timed out/);
  assert.ok(!JSON.stringify(error).includes('private'));
});
