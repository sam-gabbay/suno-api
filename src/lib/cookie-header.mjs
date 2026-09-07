import { parse, serialize } from 'cookie';

// Browsers may copy the request header together with its "Cookie:" label.
// Validate without exposing parser errors, which can include secret values.
export function normalizeCookieHeader(value) {
  const header = value.trim().replace(/^cookie\s*:\s*/i, '');
  if (!header || /[\r\n]/.test(header)) {
    throw new Error('Copy a single Cookie request-header value from Suno.');
  }
  const parsed = parse(header);
  if (!parsed.__client) {
    throw new Error('The Suno Cookie header must contain __client.');
  }
  try {
    for (const [name, content] of Object.entries(parsed)) serialize(name, content);
  } catch {
    throw new Error('The Cookie header is malformed. Copy its complete request-header value from Suno.');
  }
  return header;
}
