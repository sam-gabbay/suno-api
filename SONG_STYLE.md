# Making a song in the style of another

```sh
npm run inspect -- <song>
```

`<song>` can be a Suno link (`https://suno.com/song/...` or a `suno.com/s/...`
share link), a Suno clip ID, or any audio file on this Mac. The report prints in
the terminal and is saved with a `style.json` under `output/inspect/`.

## A song made on Suno

Suno keeps the exact prompt behind every song, and this reads it: the style of
music, the excluded styles, the model, the advanced sliders and the lyrics. That
works for your own songs and for anyone's public song. Reusing that style with
new lyrics is the most faithful way to get the same sound, and the report
includes the ready `/api/custom_generate` request.

It needs the local API running (`npm run dev`) and spends nothing: no generation,
no download unlock. Suno no longer streams song audio to outside tools, so the
tempo and key measurements only appear when the MP3 is already in `output/`
(which happens for songs downloaded by `npm run smoke` or the album workflow).
Use `--no-audio` to skip looking.

For the closest match, use the song inside the Suno app as well: make a Persona
from it to keep the voice, or use Cover or Extend.

## Any other song

Give it an audio file you have (an MP3, WAV, M4A and so on). It measures:

- tempo, with the other readings to try if it feels half or double speed;
- key, left out of the prompt when the reading is uncertain;
- loudness, dynamics, brightness, bass weight and stereo width, which only earn
  a word in the prompt when they are clearly unusual;
- the energy across the song, to spot quiet intros and breakdowns.

That is the measurable half of a style. The genre, the voice and the instruments
need ears, so add them yourself, or ask a Claude or Codex session here to "match
the style of" the song (it uses `.agents/skills/match-style/SKILL.md` and its own
knowledge of the song if you name it). Do not put artist or song names in the
style: Suno rejects them. Describe what makes them sound that way.

## How accurate it is

Checked against Apple's GarageBand loops, which are labelled with their real
tempo and key: tempo was right on 77% of drum loops, and most of the misses
were at half or double speed; key was right on 57% of three-loop mixes (66%
when the report is confident enough to keep the key). On Suno's own songs the
tempo came within 5 BPM of the requested one in 17 of 20. Treat key as a
hint, and Suno does not reliably follow a requested key anyway.
