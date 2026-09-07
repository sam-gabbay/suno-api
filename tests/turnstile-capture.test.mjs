import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installTurnstileCapture } from '../src/lib/turnstile-capture.mjs';

test('capturing Turnstile parameters preserves normal provider rendering', () => {
  let watcher;
  const window = {};
  vm.runInNewContext(`(${installTurnstileCapture.toString()})()`, {
    window,
    setInterval: (fn) => { watcher = fn; return 1; },
    clearInterval: () => {},
    setTimeout: () => {},
  });
  let calls = 0;
  const options = Object.freeze({ sitekey: 'public-site-key', action: 'generation', callback: () => {} });
  const provider = { render(container, received) {
    calls++;
    assert.equal(this, provider);
    assert.equal(container, '#challenge');
    assert.equal(received, options);
    return 'original-widget-id';
  } };
  window.turnstile = provider;
  watcher();
  watcher();
  assert.equal(provider.render('#challenge', options), 'original-widget-id');
  assert.equal(calls, 1);
  assert.equal(window.__sunoTurnstile.sitekey, options.sitekey);
  assert.equal(window.__sunoTurnstile.callback, options.callback);
});
