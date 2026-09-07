import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { normalizeCookieHeader } from '../src/lib/cookie-header.mjs';

const file = fileURLToPath(new URL('../.env.local', import.meta.url));
const values = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
const option = process.argv[2];
if (option && !['--cookie-from-clipboard', '--captcha-from-clipboard'].includes(option)) {
  console.error('Use npm run setup, or add -- --cookie-from-clipboard / --captcha-from-clipboard.');
  process.exit(1);
}
if (option) {
  const secret = execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' }).trim();
  if (!secret || /[\r\n']/.test(secret)) {
    console.error('Clipboard must contain one header value or API key, without newlines or single quotes. Nothing saved.');
    process.exit(1);
  }
  if (option === '--cookie-from-clipboard') {
    try {
      values.SUNO_COOKIE = normalizeCookieHeader(secret);
    } catch (error) {
      console.error(`${error.message} Nothing saved.`);
      process.exit(1);
    }
  } else {
    if (!/^[a-fA-F0-9]{32}$/.test(secret)) {
      console.error('Clipboard does not look like a 2Captcha API key. Nothing saved.');
      process.exit(1);
    }
    values.TWOCAPTCHA_KEY = secret;
  }
}
if (values.SUNO_COOKIE) {
  try {
    values.SUNO_COOKIE = normalizeCookieHeader(values.SUNO_COOKIE);
  } catch (error) {
    console.error(`${error.message} Nothing saved.`);
    process.exit(1);
  }
}
values.SUNO_API_KEY ||= randomBytes(32).toString('hex');
values.SUNO_COOKIE ||= '';
values.TWOCAPTCHA_KEY ||= '';
values.BROWSER ||= 'chromium';
values.BROWSER_GHOST_CURSOR ||= 'false';
values.BROWSER_LOCALE ||= 'en';
values.BROWSER_HEADLESS ||= 'true';
values.NEXT_TELEMETRY_DISABLED = '1';
writeFileSync(file, '# Private local configuration. Do not commit or paste into chat.\n' +
  Object.entries(values).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n', { mode: 0o600 });
chmodSync(file, 0o600);
console.log('Saved private .env.local (mode 0600). No credentials printed.');
console.log(`Suno cookie: ${values.SUNO_COOKIE ? 'configured' : 'missing'}`);
console.log(`2Captcha key: ${values.TWOCAPTCHA_KEY ? 'configured' : 'missing; only needed if challenged'}`);
if (option) console.log('Restart the API server to load the updated credentials.');
