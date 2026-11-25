// npm run inspect -- <Suno song link | clip ID | YouTube link | audio file> [--no-audio] [--json]
// Works out how a song is made so a new one can be prompted in the same style.
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { analyseAudio, sparkline } from './style-analysis.mjs';
import { parseSunoInput, resolveShortLink, sunoRecipe, sameStyleRequest, isSunoAudioUrl } from './suno-style.mjs';

const USAGE = `Usage: npm run inspect -- <song> [--no-audio] [--json]

<song> is one of:
  a Suno link          https://suno.com/song/<id>  or a suno.com/s/... share link
  a Suno clip ID       0d7fdabe-c2ca-4e13-9456-d32a21cd571a
  a YouTube link       https://youtu.be/<id> (needs yt-dlp: brew install yt-dlp)
  an audio file        ~/Music/track.mp3 (anything ffmpeg can read)

For a Suno song it prints the exact style, exclusions, model and lyrics behind it
(needs the local API running: npm run dev). For any audio it measures tempo, key,
loudness, tone and arrangement, and drafts the measurable half of a style prompt.
--no-audio  skip measuring a Suno song's audio (metadata only)
--json      print the raw profile as JSON instead of the readable report
The report and profile are also saved under output/inspect/.`;

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Readable Markdown report for a profile made of an optional Suno recipe and optional measurements. */
export function renderReport({ source, recipe, video, audio, audioError }) {
  const out = [];
  const title = recipe?.title || video?.track || video?.title || path.parse(source).name;
  out.push(`# How "${title}" is made`, '');

  if (video) {
    out.push('## From YouTube', '');
    const facts = [video.artist && video.track ? `${video.artist}, "${video.track}"` : null, video.channel && `Channel: ${video.channel}`,
      video.album && `Album: ${video.album}`, video.year && `Released: ${video.year}`, video.genre && `Genre (YouTube): ${video.genre}`].filter(Boolean);
    out.push(`${source}`, '', facts.join(' · '), '');
    if (video.tags.length) out.push(`Tags: ${video.tags.join(', ')}`, '');
    out.push('YouTube has no style prompt, so the style has to be described: the measurements below plus the listening notes at the end.', '');
  }

  if (recipe) {
    if (recipe.uploaded_audio) {
      out.push('This is audio uploaded to Suno, so there is no Suno style prompt behind it. The measurements below are the starting point.', '');
    } else {
      out.push('## The Suno recipe', '');
      out.push('This is exactly what was typed into Suno. Reusing it is the most faithful way to get the same style.', '');
      if (recipe.style) out.push('Style of music:', '', '```', recipe.style, '```', '');
      if (recipe.exclude) out.push('Exclude styles:', '', '```', recipe.exclude, '```', '');
      if (!recipe.style && recipe.description_prompt) {
        out.push('It was made in simple mode from this description (Suno chose the style itself):', '', '```', recipe.description_prompt, '```', '');
      }
      const facts = [];
      if (recipe.model) facts.push(`Model: ${recipe.model}${recipe.model_version ? ` (${recipe.model_version})` : ''}`);
      if (recipe.duration_seconds) facts.push(`Length: ${fmtTime(recipe.duration_seconds)}`);
      facts.push(recipe.instrumental ? 'Instrumental' : 'With vocals');
      if (recipe.persona_id) facts.push(`Persona: ${recipe.persona_name || recipe.persona_id}`);
      if (recipe.creator) facts.push(`By: ${recipe.creator}`);
      out.push(facts.join(' · '), '');
      if (recipe.sliders) out.push(`Advanced sliders: ${Object.entries(recipe.sliders).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');
      if (recipe.history.length) out.push(`This clip extends or edits earlier clips (${recipe.history.join(', ')}); their style may matter too.`, '');
    }
  }

  if (audio) {
    out.push('## What the audio measures', '');
    out.push(`Tempo: ${Math.round(audio.tempo.bpm)} BPM`);
    out.push(`Key: ${audio.key.key}${audio.key.margin < 0.1 ? ` (uncertain; could be ${audio.key.alternative})` : ''}`);
    out.push(`Length: ${fmtTime(audio.duration_seconds)}`);
    if (audio.loudness.integrated_lufs !== null) out.push(`Loudness: ${audio.loudness.integrated_lufs} LUFS, range ${audio.loudness.loudness_range_lu} LU`);
    out.push(`Tone: centre of brightness ${audio.tone.spectral_centroid_hz} Hz, ${Math.round(audio.tone.bass_share * 100)}% of energy below 150 Hz, stereo width ${audio.tone.stereo_width}`);
    out.push('', `Energy across the song: ${sparkline(audio.energy)}`, '');
    out.push('In words a prompt can use:', '', '```', audio.description.words.join(', '), '```', '');
    for (const note of audio.description.notes) out.push(`- ${note}`);
    if (audio.description.notes.length) out.push('');
  } else if (audioError) {
    out.push(`The audio could not be measured: ${audioError}`, '');
  }

  out.push('## Making a new song in this style', '');
  if (recipe && !recipe.uploaded_audio && (recipe.style || recipe.description_prompt)) {
    out.push('1. Keep the style above and write new lyrics. Through this API that is one `/api/custom_generate` request:', '');
    out.push('```json', JSON.stringify(sameStyleRequest(recipe), null, 2), '```', '');
    if (!recipe.style) out.push('   There is no style text to copy, so start from the measured words above plus what you hear.', '');
    out.push('2. For a closer match, use the song itself in the Suno app: make a Persona from it (keeps the voice and vibe), or use Cover or Extend. This API can already read Personas (`/api/persona`) and extend clips (`/api/extend_audio`).');
    out.push('3. Change one thing at a time (style words, then lyrics), and generate two or three takes before judging.', '');
  } else {
    out.push('The measurements cover tempo, key, energy and mix. The rest has to come from listening. Add, in this order:', '');
    out.push('1. Genre and subgenre, with era if it matters (e.g. "2010s Afro-pop", "90s boom bap").');
    out.push('2. The lead vocal: gender, range, texture and delivery (e.g. "breathy female alto, laid-back phrasing").');
    out.push('3. Two to four signature instruments or sounds (e.g. "log drum, shakers, airy synth pads").');
    out.push('4. Groove and mood (e.g. "swung, hypnotic, late-night").', '');
    out.push('Then add the measured words above. Do not name the artist or song: Suno rejects real artist names in the style box. Describe what makes them sound that way instead.', '');
    out.push('A Claude or Codex session in this project can do this for you: ask it to "match the style of" the song and it will follow `.agents/skills/match-style/SKILL.md`.', '');
  }
  return out.join('\n');
}

async function fetchSunoAudio(url, directory) {
  if (!isSunoAudioUrl(url)) throw new Error('The audio is not on a Suno address, so it was not fetched.');
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`Suno's audio returned HTTP ${response.status}.`);
  const file = path.join(directory, 'song-audio');
  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > 100 * 1024 * 1024 ? new Error('The audio is larger than 100 MB.') : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(file, { mode: 0o600 }));
  return file;
}

export async function inspect(input, { measureSunoAudio = true, api, outputRoot = fileURLToPath(new URL('../output/', import.meta.url)) } = {}) {
  const expanded = input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
  const asFile = await stat(expanded).then((s) => s.isFile(), () => false);
  if (asFile) return { source: path.resolve(expanded), audio: await analyseAudio(expanded) };

  const youtube = parseYouTube(input);
  if (youtube) return inspectYouTube(youtube);

  const parsed = parseSunoInput(input);
  if (!parsed) {
    throw new Error('That is not an audio file, a YouTube or Suno link, or a Suno clip ID. For Spotify or Apple Music, use the song\'s YouTube link or an audio file.');
  }
  const id = parsed.id || await resolveShortLink(parsed.shortLink);
  if (!api) ({ api } = await import('./local-client.mjs'));
  const recipe = sunoRecipe(await api(`/api/clip?id=${encodeURIComponent(id)}`));
  const profile = { source: `https://suno.com/song/${recipe.id}`, recipe };
  if (!measureSunoAudio) return profile;
  const local = await findDownloaded(recipe.id, outputRoot);
  if (local) {
    profile.audio_file = local;
    profile.audio = await analyseAudio(local);
  } else if (isSunoAudioUrl(recipe.audio_url) && !/\/forbidden\b/.test(recipe.audio_url)) {
    // The streamed copy the Suno player uses; this is not a download unlock.
    const directory = await mkdtemp(path.join(os.tmpdir(), 'suno-inspect-'));
    try {
      profile.audio = await analyseAudio(await fetchSunoAudio(recipe.audio_url, directory));
    } catch (error) {
      profile.audioError = error.message;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else {
    profile.audioError = 'Suno does not stream this song publicly, and no downloaded copy was found under output/. Run inspect on the MP3 if you have it.';
  }
  return profile;
}

/** Canonical watch URL for a YouTube or YouTube Music link, or null. */
export function parseYouTube(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    id = url.searchParams.get('v') || (url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/) || [])[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.YT_DLP_BIN || 'yt-dlp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(error.code === 'ENOENT' ? new Error('YouTube links need yt-dlp: brew install yt-dlp') : error));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`yt-dlp could not fetch the video: ${stderr.trim().split('\n').pop()}`))));
  });
}

/** The YouTube details that help describe a song: who made it, and how it is tagged. */
export function videoFacts(info) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    title: text(info.title),
    channel: text(info.channel) || text(info.uploader),
    artist: text(info.artist) || text(info.creator),
    track: text(info.track),
    album: text(info.album),
    genre: text(info.genre),
    year: info.release_year || null,
    duration_seconds: Number.isFinite(info.duration) ? Math.round(info.duration) : null,
    tags: Array.isArray(info.tags) ? info.tags.filter((t) => typeof t === 'string').slice(0, 15) : [],
    description: text(info.description)?.slice(0, 600) || null,
  };
}

/** Fetches a video's audio to a temporary folder, measures it and deletes it. */
async function inspectYouTube(url) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'youtube-inspect-'));
  try {
    await runYtDlp(['--no-playlist', '--quiet', '--no-warnings', '--no-progress', '-f', 'bestaudio/best',
      '--max-filesize', '100M', '--match-filter', 'duration < 1800', '--write-info-json',
      '-o', path.join(directory, 'audio.%(ext)s'), url]);
    const files = await readdir(directory);
    const info = files.includes('audio.info.json') ? JSON.parse(await readFile(path.join(directory, 'audio.info.json'), 'utf8')) : {};
    const audioFile = files.find((f) => f.startsWith('audio.') && !f.endsWith('.json') && !f.endsWith('.part'));
    if (!audioFile) throw new Error('yt-dlp did not save any audio (the video may be longer than 30 minutes, private or region-locked).');
    return { source: url, video: videoFacts(info), audio: await analyseAudio(path.join(directory, audioFile)) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A copy already downloaded by npm run smoke or the album workflow (saved as <clip id>.mp3). */
export async function findDownloaded(id, directory, depth = 3) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return null; }
  const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === `${id}.mp3`);
  if (hit) return path.join(directory, hit.name);
  if (depth === 0) return null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findDownloaded(id, path.join(directory, entry.name), depth - 1);
    if (found) return found;
  }
  return null;
}

async function save(profile, report) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const name = (profile.recipe?.title || profile.video?.title || path.parse(profile.source).name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'song';
  const directory = path.join(root, 'output', 'inspect', `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'style.md'), report + '\n');
  await writeFile(path.join(directory, 'style.json'), JSON.stringify(profile, null, 2) + '\n');
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flags = new Set(['--no-audio', '--json', '--help']);
  const unknown = args.find((a) => a.startsWith('--') && !flags.has(a));
  const inputs = args.filter((a) => !flags.has(a));
  if (args.includes('--help') || unknown || inputs.length !== 1) {
    if (unknown) console.error(`Unknown option: ${unknown}\n`);
    console.log(USAGE);
    process.exitCode = args.includes('--help') ? 0 : 1;
  } else {
    try {
      const profile = await inspect(inputs[0], { measureSunoAudio: !args.includes('--no-audio') });
      const report = renderReport(profile);
      const directory = await save(profile, report);
      console.log(args.includes('--json') ? JSON.stringify(profile, null, 2) : report);
      console.error(`Saved to ${path.relative(process.cwd(), directory) || directory}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
