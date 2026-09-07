# Local Suno API prototype

Fork: https://github.com/sam-gabbay/suno-api

Upstream: https://github.com/gcui-art/suno-api, starting commit `a2e6a82`.

This is an unofficial wrapper around Suno's web service. Local build success does
not establish that Suno authentication, generation, or downloads currently work.
The complete live check is `npm run smoke`.

## Start

Use Node 22.14 or newer (`nvm use` if available). This checkout was built and
tested with Node 25.1.0; `.nvmrc` selects the Node 22 release line for installation.

```sh
npm ci --ignore-scripts
npm run setup
npm run dev
```

The API listens on `http://127.0.0.1:3210`. Every `/api/*` and `/v1/*` request needs
`Authorization: Bearer <SUNO_API_KEY>`. Setup creates that key in `.env.local`;
the helper commands read it without printing it. Keep this prototype local.

## Connect your Suno account

1. Sign in at https://suno.com/create in your browser.
2. Open Developer Tools / Web Inspector and select Network. Reload the page.
3. Select the `auth.suno.com/v1/client` request (filter for `__clerk_api_version`).
4. Copy only its **Cookie request-header value**, containing `__client=...`.
   Do not copy a response's Set-Cookie header or a whole curl command.
5. With the value on your clipboard, run:

```sh
npm run setup -- --cookie-from-clipboard
```

The helper saves it to ignored `.env.local` with mode `0600` and never displays
the secret. Do not paste cookies or API keys into chat or commit them.

Restart the server, then check authentication without generating music:

```sh
npm run doctor
```

If Suno challenges generation, a funded 2Captcha account is needed. Copy its API
key to the clipboard, then run:

```sh
npm run setup -- --captcha-from-clipboard
node node_modules/rebrowser-playwright-core/cli.js install chromium
```

Restart the server afterward. Installing with `--ignore-scripts` skips the large
Electron download and automatic browser downloads. Only the explicit Chromium
installation above is needed for the CAPTCHA path. CAPTCHA execution has not
been verified against Suno's current interface.

## Generate and verify audio

```sh
npm run smoke
# Or provide an original instrumental prompt:
npm run smoke -- A gentle jazz piano instrumental with upright bass
```

This submits **one generation request**, which may produce two clips and consume
Suno credits, waits for `complete` status, downloads every returned clip, and
requires `ffprobe` metadata plus a full `ffmpeg` decode before declaring success.
Both commands must be installed before the test can submit anything.

Results and a report go to ignored `output/<timestamp>/`. Clip IDs are saved as
soon as generation is accepted. A failed or timed-out request is never
automatically resubmitted. Check the saved IDs and your Suno workspace before
manually running another paid generation.

Upstream's default model is `chirp-v3-5`. `SUNO_MODEL` in `.env.local` can override
it after confirming a supported model ID with your account. Do not assume a
newer model works just because the wrapper starts.

The upstream docs UI has not been modified to supply the local API bearer key;
use the CLI helpers or an authenticated HTTP client for this prototype.

## Local changes

- Bind startup to loopback port 3210 and require a local bearer token.
- Add private clipboard credential import, authenticated health, and credit checks.
- Limit upstream HTTP requests to 30 seconds and fail clearly when a CAPTCHA
  requires an unconfigured solver.
- Remove full Axios request objects and CAPTCHA tokens from error/payload logs.
- Update Next.js and its lint package to 14.2.35.
- Add one-submission generation/download verification with no false success on
  HTML, encrypted data, incomplete jobs, or undecodable audio.

## Checks

```sh
npm test
npm run lint
npm run build
npm run check:local
npm run doctor
npm run smoke
```

The first three run without Suno credentials. `check:local` verifies the running
server's authentication and health without calling Suno. Doctor and smoke need
the private cookie, and smoke can additionally require 2Captcha.
