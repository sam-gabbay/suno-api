---
name: create-album
description: Create an original album with song titles, complete lyrics, individual Suno prompts, an album name and cover artwork. Use for create an album requests in this Suno API project, with optional music generation through its connected local API.
---

# Create an album

Work in the Suno API repository containing `scripts/prepare-album.mjs`. Produce
the creative package and artwork, then render music when the user has requested
it. Respect explicit choices about genre, language, track count, vocals, and
whether music generation is included.

## Creative direction

The preferred creative model for this workflow is `gpt-6-astra`, explicitly chosen
by the user. `npm run album` opens a Codex session pinned to that model. In an
Astra session, write the material directly. In a different-model session, use an
available Astra agent when the user has requested Astra/delegation; give it the
creative subtask while doing useful independent packaging work locally. If that
model cannot be selected, report that limitation rather than claiming its authorship.
Keep pixels and writing distinct: Astra supplies art direction; the available
image-generation tool renders the cover.

For an unspecified brief in this project, use ten original upbeat Afrobeats songs,
English, alternating five female and five male leads, and clean lyrics. These are
defaults, not restrictions on a different user brief. Choose one cohesive album
concept and a sequence with distinct themes, hooks, groove, instrumentation, and
vocal personalities. Express style through musical characteristics rather than
requiring imitation of a named performer. Do not invent an artist identity unless
requested. Make a complete song for each track with verses, a memorable chorus,
and development; write repeated choruses out in full for Suno.

## Saved creative artifact

Write a draft JSON under `output/albums/` with this shape:

```json
{
  "schema_version": 1,
  "name": "Album name",
  "slug": "album-name",
  "concept": "The album's narrative and sound",
  "genre": "Requested genre",
  "language": "Requested lyric language",
  "creative_model": "Actual model used for the creative writing",
  "artwork_prompt": "Complete square cover brief with the exact album title",
  "tracks": [
    {
      "number": 1,
      "title": "Song title",
      "vocal": "female",
      "vocal_direction": "Timbre, phrasing, delivery, and backing vocals",
      "bpm": 112,
      "key": "A minor",
      "theme": "Distinct lyrical idea",
      "suno_style_prompt": "Genre, tempo, vocal direction, instruments, groove, production",
      "negative_tags": "Unwanted musical characteristics",
      "lyrics": "Complete original lyrics with section labels"
    }
  ]
}
```

Use consecutive track numbers and unique titles. `vocal` is `female`, `male`,
`duet`, or `ensemble`. The exporter enforces style prompts and negative tags at
most 200 characters, titles at most 80, and lyrics at most 3,000. Aim for about
1,500–2,800 lyric characters rather than cramming the maximum. Count characters;
do not silently truncate the lyrics to fit. See `scripts/album-format.mjs` for
the maintained validation and payload mapping.

Create the actual square artwork with the built-in image-generation tool using
Astra's brief. Inspect the result for correct title, legibility, and composition.
Keep the original generated file and copy it into the album package. Do not call
an art prompt or a placeholder image a finished cover. If rendering is unavailable,
save the prompt and clearly mark the artwork pending.

Export the package with:

```sh
npm run album:prepare -- output/albums/draft.json --artwork /absolute/path/to/generated-cover.png
```

The PNG must be square and at least 1,000 pixels wide. The command creates
`output/albums/<slug>/` containing `ALBUM.md`, `album.json`, individual song/lyric
files, individual request JSONs, `suno-prompts.json`, `artwork-prompt.txt`, and
`cover.png`. It rejects an existing destination; use a new `--out` folder for
revisions. Generated material stays ignored by Git.

## Music generation when requested

A creative-package request does not require music generation. If the user asks
to generate the music or runs `npm run album -- --music`, carry it through using
the prepared package and the connected local API. Do not ask again merely because
generation consumes the already authorized account allowance. Do not purchase
credit or download packs.

Read `LOCAL_SETUP.md` and use `scripts/local-client.mjs`; it loads the bearer key
privately and only sends it to loopback. Run doctor and ensure ffprobe/ffmpeg are
available before submission. Use the current configured Suno model, disclosing
that the tested default is `chirp-v3-5`; do not invent support for newer models.

Each entry in `suno-prompts.json` contains the actual `/api/custom_generate` body:
`prompt` is lyrics, `tags` is style, `make_instrumental` is false. Send one request
per song, sequentially: the CAPTCHA browser session is shared. Suno may return
two candidate clips per request. Save all returned IDs immediately.

Maintain an album-local `generation.json` checkpoint. Record a song as submitting
before its paid POST and record the accepted clip IDs immediately afterward. On
resume, poll saved IDs instead of resubmitting. If a previous submission has no
saved IDs, stop that song and inspect the account before any retry; a timeout is
not proof that no credits were spent. Do not automatically replace failed songs
with new paid submissions.

Poll `/api/get?ids=...` until complete. Unless the user requested all alternatives,
download one complete candidate per album song using `POST /api/download`; retain
the alternate IDs for later selection. State the selection rule and do not call
an unlistened candidate the best take. An initial unlock uses separate download
allowance. The existing `npm run smoke -- --resume <report.json>` accepts saved
`clip_ids` and can download/fully decode selected clips without generating again.
Use `ffprobe` plus a full `ffmpeg -xerror` decode before reporting audio complete.
Update package status to reflect what actually finished.

## Handoff

Provide the album name, track list with lead vocals, the saved album/cover paths,
and the repeatable invocation. Distinguish a completed creative package from
completed music. Lyrics and voice prompts do not prove the rendered voice, tempo,
pronunciation, or musical quality; validate actual audio when music is requested.
