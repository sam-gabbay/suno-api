import { api } from './local-client.mjs';

try {
  const health = await api('/api/health');
  console.log(JSON.stringify(health, null, 2));
  if (!health.suno_cookie_configured) {
    throw new Error('Suno login is missing. Import your Cookie header with npm run setup -- --cookie-from-clipboard.');
  }
  console.log('Checking Suno authentication and available credits (no generation)...');
  console.log(JSON.stringify(await api('/api/get_limit'), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
