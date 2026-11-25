---
name: match-style
description: Inspect a song (a Suno link or clip ID, a YouTube link, or an audio file) and write a Suno style prompt that recreates its style. Use for requests like "make something that sounds like this", "what prompt made this song", or "match the style of".
---

# Match a song's style

Work in the Suno API repository containing `scripts/inspect-song.mjs`. The owner's
guide is `SONG_STYLE.md`; this is the agent's version.

## 1. Inspect

```sh
npm run inspect -- <suno link | clip ID | YouTube link | path/to/audio>
```

A Suno song needs the local API running (`npm run dev`, see `LOCAL_SETUP.md`); an
audio file or YouTube link does not (YouTube needs `yt-dlp`). For YouTube, the
report's title, channel and tags usually name the song: use that for step 2. Reading a clip is free: it never generates or unlocks a
download. The report and `style.json` are saved under `output/inspect/`.

## 2. Write the prompt

**A Suno song with a style recipe.** The style text and exclusions in the report
are exactly what made it. Reuse them as they are unless the owner wants changes.
If they do, edit the recipe rather than starting over, and keep its order (genre
first, then vocal, instruments, production, mood). Simple-mode songs have only a
description; build a style from it plus the measurements.

**Any other song.** The report measures tempo, key, energy and mix, nothing more.
You cannot hear the song, so the genre, vocal and instruments must come from one
of these, in order of preference:

1. What the owner tells you about it (ask in an interactive session).
2. Your own knowledge of the named song or artist. Say it is from memory, and be
   specific: subgenre and era, vocal range, texture and delivery, signature
   instruments and production traits, groove, mood.
3. Otherwise, write the measured part only and list what still needs a listener.

Never put an artist, band or song name in the style: Suno rejects real names.
Translate them into the musical traits that make them recognisable. Lead with
the genre; the earliest words carry the most weight.

Combine the listening words with the measured words from the report (tempo first;
the key only if the report kept it). Aim for 8 to 15 comma-separated descriptors,
roughly 120 to 200 characters; this project's album exporter caps a style at 200.
Put clearly unwanted sounds in exclusions (also 200 at most), for example a
genre Suno tends to drift into.

## 3. Hand over

Give the style and exclusions each in its own code block, then the
`/api/custom_generate` body if the owner wants to render it. Generation spends
credits: only submit when asked, one request at a time, saving clip IDs at once
(the rules in `.agents/skills/create-album/SKILL.md` apply). Say which parts were
measured, which came from the recipe, and which came from memory, and that
the only real check is listening to two or three takes.
