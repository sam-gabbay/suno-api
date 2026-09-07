# Verification — September 7, 2026

Environment: macOS, Node 25.1.0, Next.js 14.2.35.

## Passed

- Production build, including TypeScript validation and all route compilation.
- ESLint without warnings or errors.
- Nine tests covering credential redaction, Cookie-header normalization, Turnstile
  render preservation, and download validation/authorization/polling failures.
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
