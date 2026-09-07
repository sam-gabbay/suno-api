# Verification — September 7, 2026

Environment: macOS, Node 25.1.0, Next.js 14.2.35.

## Passed

- Production build, including TypeScript validation and all route compilation.
- ESLint without warnings or errors.
- Twelve tests covering credential redaction, Cookie-header normalization,
  Turnstile render preservation, download validation/authorization/polling failures,
  and album export/validation/launcher behavior.
- Running server listens only on `127.0.0.1:3210`.
- Unauthenticated health, generation, download, and chat requests return HTTP 401.
- An incorrect bearer key and a middleware-subrequest bypass attempt return 401.
- Authenticated health returns HTTP 200 with configuration flags only.
- `.env.local` is ignored by Git and has owner-only `0600` permissions.
- Suno cookie authentication and live credit lookup.
- Chromium installation and hCaptcha solving through the configured 2Captcha account.
- One accepted `chirp-v3-5` generation produced two complete clips. The browser's
  CAPTCHA-triggering generation request was intercepted and aborted; only the
  intended API submission generated music.
- Both clips were unlocked using the account's existing download allowance.
- `POST /api/download` returned working MP3 download URLs for both clips. Repeating
  authorization for the already unlocked songs returned `credit_deducted: false`.
- Both downloaded MP3s passed ffprobe and a full `ffmpeg -xerror` decode:
  240.0135 seconds each, 4,775,546 and 5,272,751 bytes.
- Generation credits changed from 2350 to 2340. Two download unlocks were used;
  no additional downloads were purchased.
- Resume verification submitted no generation request and preserved the original
  report. Successful local evidence is in ignored
  `output/2026-09-07T13-46-29-381Z/report.json` with both MP3s beside it.

## Limits

- Compatibility with newer Suno models; the retained upstream default is chirp-v3-5.
- Turnstile fallback has a local render-preservation test but has not completed a
  live generation test. The successful generation used hCaptcha.
- This verifies a local prototype at the time above. Expiring session cookies and
  future changes to Suno's web interface can require maintenance.

Earlier failed attempts stopped at CAPTCHA or download handling. Saved clip IDs
were reused to complete download verification without another music submission.

## Album creative workflow

- `gpt-6-astra` created **Room for the Morning**: ten complete English lyric sets,
  ten unique titles and Suno styles, five female leads and five male leads, and
  a shared album concept and art direction.
- The built-in image tool rendered and saved the square 1254 × 1254 PNG cover.
  Its exact title and composition were visually inspected.
- The exporter validated every track and saved the lyric book, metadata, cover,
  and ten individual `/api/custom_generate` request bodies under
  `output/albums/room-for-the-morning/`. Style prompts are below 200 characters;
  complete lyric sets are below 3,000 characters with repeated choruses written out.
- The repo-local `$create-album` skill passes its skill validator. The CLI launcher
  resolves the installed Codex executable and pins `gpt-6-astra`, which is present
  in the local model catalog. Its dry-run invocation was checked.
- Export tests verify lyrics/style field mapping, vocal assignment, explicit
  music mode, invalid-input rejection, and preservation of an existing package.
- No music-generation or download-unlock requests were sent for this album.
  Album vocals and musical quality remain unverified until audio is generated.
