# Local Suno API prototype

Fork: https://github.com/sam-gabbay/suno-api

Upstream: https://github.com/gcui-art/suno-api, starting commit `a2e6a82`.

This is an unofficial wrapper around Suno's web service. On September 7, 2026,
the local setup generated two v3.5 songs and downloaded both as valid four-minute
MP3s. See `VERIFICATION.md` for evidence and limits. The complete live check is
`npm run smoke`; it consumes account allowance.

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
installation above is needed for the CAPTCHA path. The current Song Description /
Create song flow and hCaptcha solver completed the live test. A Turnstile fallback
is implemented but has not completed a live generation test.

## Generate and verify audio

```sh
npm run smoke
# Or provide an original instrumental prompt:
npm run smoke -- A gentle jazz piano instrumental with upright bass
```

This submits **one generation request**, which may produce two clips and consume
Suno credits, waits for `complete` status, unlocks and downloads every returned clip, and
requires `ffprobe` metadata plus a full `ffmpeg` decode before declaring success.
Both commands must be installed before the test can submit anything.
The first download unlock also uses Suno's separate download allowance. The
helper does not purchase additional downloads.

Results and a report go to ignored `output/<timestamp>/`. Clip IDs are saved as
soon as generation is accepted. A failed or timed-out request is never
automatically resubmitted. Check the saved IDs and your Suno workspace before
manually running another paid generation. Resume saved jobs without generating
again:

```sh
npm run smoke -- --resume output/<timestamp>/report.json
```

Resume writes a new output folder and preserves the original report. Already
unlocked songs can be downloaded again without another unlock charge.

## Download API

After `/api/get?ids=<clip_id>` reports `complete`, call authenticated
`POST /api/download` with:

```json
{"clip_id":"<clip UUID>","format":"mp3"}
```

Supported formats are `mp3` (default) and `m4a`. The API authorizes the download,
waits for conversion, and returns `download_url`, `already_unlocked`, and
`credit_deducted`. Fetch that temporary HTTPS URL promptly without sending the
local bearer key to it. The feed's `audio_url` can return 403 and is not proof of
a downloadable file. If conversion times out, retry the same clip ID.

Upstream's default model is `chirp-v3-5`. `SUNO_MODEL` in `.env.local` can override
it after confirming a supported model ID with your account. Do not assume a
newer model works just because the wrapper starts.

The upstream docs UI has not been modified to supply the local API bearer key;
use the CLI helpers or an authenticated HTTP client for this prototype.

## Create an album with Codex

From this repository in Terminal:

```sh
npm run album
# Or describe a different album:
npm run album -- "10 upbeat Afrobeats songs in English, mixed female and male singers"
```

This opens your installed Codex CLI with **gpt-6-astra** explicitly selected and
the repository's `$create-album` skill. It uses your Codex login. Astra writes the
album concept, name, song titles, complete lyrics, individual Suno prompts, and
cover art direction. The built-in image tool renders the actual cover. The
default is ten English Afrobeats songs with five female and five male leads.

In Codex already open on this repository, you can also say:

```text
$create-album Create a 10-song upbeat Afrobeats album with Astra 6,
mixed female and male singers, full lyrics, Suno prompts, and cover artwork.
```

The skill is in `.agents/skills/create-album`, a repository discovery location
described in the [official Codex skills documentation](https://developers.openai.com/codex/skills).
If a running session does not show it yet, reopen the session. `CODEX_BIN` can
override the CLI executable path; the launcher does not substitute another model
if Astra is unavailable.

The default creates a creative package, without sending music-generation requests.
To request music as well, explicitly add `--music`:

```sh
npm run album -- --music "10 upbeat Afrobeats songs, mixed female and male singers"
```

This asks Codex to carry the album through the local Suno API, saving clip IDs and
resuming existing jobs after interruptions. It is an agent workflow, not a
background scheduler. Music generation and first download unlocks consume Suno
allowance. No additional credit/download packs are purchased. The ten-song music
workflow has not yet been run; the underlying single-request generation and
download flow was verified earlier.

Each album goes to ignored `output/albums/<album-slug>/` with:

- `ALBUM.md`: track list, vocal directions, and the complete lyric book.
- `album.json` and `suno-prompts.json`: creative metadata and ready-to-submit
  `/api/custom_generate` request bodies.
- `tracks/`: individual lyric sheets and Suno request JSONs.
- `cover.png` and `artwork-prompt.txt`: cover and its exact creative brief.
- `package-status.json`: separates creative, artwork, and music completion.

The first package is `output/albums/room-for-the-morning/`. Its ten original songs
and cover are finished; album audio has not been generated.

`npm run album -- --dry-run` prints the launch arguments without starting Codex.
`npm run album:prepare -- <draft.json> --artwork <cover.png>` validates and exports
an existing creative draft without calling any model or Suno API. It preserves
existing packages; use `--out <new-directory>` for another version.

## Local changes

- Bind startup to loopback port 3210 and require a local bearer token.
- Add private clipboard credential import, authenticated health, and credit checks.
- Limit upstream HTTP requests to 30 seconds and fail clearly when a CAPTCHA
  requires an unconfigured solver.
- Remove full Axios request objects and CAPTCHA tokens from error/payload logs.
- Update Next.js and its lint package to 14.2.35.
- Add one-submission generation/download verification with no false success on
  HTML, encrypted data, incomplete jobs, or undecodable audio.
- Normalize browser-copied Cookie headers, update CAPTCHA selectors/interception,
  and discard cached clients from an earlier development hot reload.
- Add authorized download conversion and resume verification of existing clips.
- Add the Astra album command, Codex skill, and validated creative-package exporter.

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
