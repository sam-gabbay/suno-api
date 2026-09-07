import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCookieHeader } from '../src/lib/cookie-header.mjs';

test('accepts a browser-copied header label and preserves cookie contents', () => {
  assert.equal(normalizeCookieHeader('Cookie: other=value; __client=test-token'), 'other=value; __client=test-token');
  assert.equal(normalizeCookieHeader('  cookie: __client=test-token  '), '__client=test-token');
  assert.equal(normalizeCookieHeader('__client=test-token'), '__client=test-token');
});

test('rejects malformed names without exposing a cookie value', () => {
  assert.throws(() => normalizeCookieHeader('invalid name=private-value; __client=test-token'),
    (error) => /malformed/.test(error.message) && !error.message.includes('private-value'));
  assert.throws(() => normalizeCookieHeader('other=value'), /must contain __client/);
  assert.throws(() => normalizeCookieHeader('__client=test-token\r\ninjected=value'), /single Cookie/);
});
