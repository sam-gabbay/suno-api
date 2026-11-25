import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SAMPLE_RATE, estimateTempo, chroma, estimateKey, describe, analyseAudio } from '../scripts/style-analysis.mjs';
import { parseSunoInput, resolveShortLink, sunoRecipe, sameStyleRequest, isSunoAudioUrl } from '../scripts/suno-style.mjs';
import { inspect, renderReport, findDownloaded, parseYouTube, videoFacts } from '../scripts/inspect-song.mjs';

const ID = '0d7fdabe-c2ca-4e13-9456-d32a21cd571a';

function clicks(bpm, seconds = 30) {
  const mono = new Float32Array(SAMPLE_RATE * seconds);
  const period = (60 / bpm) * SAMPLE_RATE;
  for (let beat = 0; beat * period < mono.length; beat++) {
    const start = Math.round(beat * period);
    for (let i = 0; i < 400 && start + i < mono.length; i++) mono[start + i] = Math.sin(i * 0.3) * Math.exp(-i / 60);
  }
  return mono;
}

// A I-IV-V-I progression with a few harmonics per note.
function progression(chords, seconds = 24) {
  const mono = new Float32Array(SAMPLE_RATE * seconds);
  const length = mono.length / chords.length;
  chords.forEach((notes, c) => {
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      let v = 0;
      for (const midi of notes) {
        const f = 440 * 2 ** ((midi - 69) / 12);
        v += Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) + 0.2 * Math.sin(6 * Math.PI * f * t);
      }
      mono[c * length + i] = v / 6;
    }
  });
  return mono;
}

test('tempo of a steady click track', () => {
  for (const bpm of [90, 112, 128]) {
    const found = estimateTempo(clicks(bpm)).bpm;
    assert.ok(Math.abs(found - bpm) / bpm < 0.03, `${bpm} BPM read as ${found}`);
  }
});

test('key of simple major and minor progressions', () => {
  // G major: G B D / C E G / D F# A / G B D
  assert.equal(estimateKey(chroma(progression([[55, 59, 62, 67], [60, 64, 67, 72], [62, 66, 69, 74], [55, 59, 62, 67]]))).key, 'G major');
  // A minor: A C E / D F A / E G# B / A C E
  assert.equal(estimateKey(chroma(progression([[57, 60, 64, 69], [62, 65, 69, 74], [64, 68, 71, 76], [57, 60, 64, 69]]))).key, 'A minor');
});

test('description leaves out an uncertain key and offers other tempo readings', () => {
  const base = {
    tempo: { bpm: 118.4, pulse_strength: 4 },
    key: { key: 'F minor', alternative: 'Ab major', margin: 0.03 },
    tone: { spectral_centroid_hz: 3600, bass_share: 0.8, stereo_width: 0.3 },
    loudness: { integrated_lufs: -8, loudness_range_lu: 3 },
    energy: [0.1, 0.1, 0.1, ...Array(26).fill(0.9), 0.9, 0.9, 0.9],
  };
  const { words, notes } = describe(base);
  assert.deepEqual(words, ['118 BPM', 'bright, airy top end', 'heavy sub bass', 'wide stereo', 'loud, punchy master', 'steady, consistent energy', 'soft intro that builds']);
  assert.ok(notes.some((n) => n.includes('79 or 178')));
  assert.ok(notes.some((n) => n.includes('F minor or Ab major')));
  assert.ok(describe({ ...base, key: { ...base.key, margin: 0.2 } }).words.includes('F minor'));
});

test('analyses a real audio file end to end', async (t) => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { return t.skip('ffmpeg is not installed'); }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'song-style-test-'));
  try {
    const raw = path.join(dir, 'clicks.raw');
    await writeFile(raw, Buffer.from(clicks(100, 20).buffer));
    const file = path.join(dir, 'clicks.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', raw, file]);
    const profile = await inspect(file);
    assert.equal(profile.source, file);
    assert.ok(Math.abs(profile.audio.tempo.bpm - 100) < 3);
    assert.equal(profile.audio.duration_seconds, 20);
    assert.match(renderReport(profile), /Tempo: 10\d BPM[\s\S]*Genre and subgenre/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parses Suno links and IDs, and nothing else', () => {
  assert.deepEqual(parseSunoInput(ID), { id: ID });
  assert.deepEqual(parseSunoInput(`https://suno.com/song/${ID.toUpperCase()}?sh=abc`), { id: ID });
  assert.deepEqual(parseSunoInput(`https://app.suno.ai/song/${ID}`), { id: ID });
  assert.deepEqual(parseSunoInput('https://suno.com/s/AbC123xyz'), { shortLink: 'https://suno.com/s/AbC123xyz' });
  assert.equal(parseSunoInput(`https://evil.example/song/${ID}`), null);
  assert.equal(parseSunoInput(`http://suno.com/song/${ID}`), null);
  assert.equal(parseSunoInput('https://open.spotify.com/track/123'), null);
  assert.ok(isSunoAudioUrl('https://cdn1.suno.ai/x.mp3'));
  assert.ok(!isSunoAudioUrl('https://suno.ai.evil.example/x.mp3'));
});

test('resolves a share link from its redirect or page', async () => {
  const redirect = async () => new Response(null, { status: 307, headers: { location: `https://suno.com/song/${ID}` } });
  assert.equal(await resolveShortLink('https://suno.com/s/abc', redirect), ID);
  const page = async () => new Response(`<a href="/song/${ID}">`, { status: 200 });
  assert.equal(await resolveShortLink('https://suno.com/s/abc', page), ID);
  const offsite = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } });
  await assert.rejects(resolveShortLink('https://suno.com/s/abc', offsite), /Could not find/);
});

const clip = {
  id: ID, title: 'Pocket by Pocket', display_name: 'sam', model_name: 'chirp-fenix', major_model_version: 'v5.5',
  audio_url: 'https://studio-api.prod.suno.com/api/forbidden', is_public: false,
  metadata: { tags: 'Modern Ghanaian Afrobeats, 108 BPM, warm male tenor', negative_tags: 'trumpet', prompt: '[Verse]\nla la', type: 'gen', duration: 166.4,
    control_sliders: { style_weight: 0.7 } },
};

test('reads the recipe behind a Suno clip and reuses it with new lyrics', () => {
  const recipe = sunoRecipe(clip);
  assert.equal(recipe.style, 'Modern Ghanaian Afrobeats, 108 BPM, warm male tenor');
  assert.equal(recipe.exclude, 'trumpet');
  assert.equal(recipe.duration_seconds, 166);
  assert.equal(recipe.uploaded_audio, false);
  assert.deepEqual(sameStyleRequest(recipe, 'new words'), {
    prompt: 'new words', tags: recipe.style, title: '<new title>', make_instrumental: false, wait_audio: false, negative_tags: 'trumpet',
  });
  const report = renderReport({ source: `https://suno.com/song/${ID}`, recipe });
  assert.match(report, /Style of music:\n\n```\nModern Ghanaian Afrobeats/);
  assert.match(report, /style_weight 0.7/);
  assert.equal(sunoRecipe({ id: ID, metadata: { type: 'upload' } }).uploaded_audio, true);
  assert.throws(() => sunoRecipe({}), /did not return a song/);
});

test('Suno inspection uses a downloaded copy when Suno will not stream it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'song-style-out-'));
  try {
    const calls = [];
    const api = async (p) => { calls.push(p); return clip; };
    const none = await inspect(`https://suno.com/song/${ID}`, { api, outputRoot: dir });
    assert.deepEqual(calls, [`/api/clip?id=${ID}`]);
    assert.match(none.audioError, /no downloaded copy/);
    await mkdir(path.join(dir, 'run', 'nested'), { recursive: true });
    await writeFile(path.join(dir, 'run', 'nested', `${ID}.mp3`), 'x');
    assert.equal(await findDownloaded(ID, dir), path.join(dir, 'run', 'nested', `${ID}.mp3`));
    const metadataOnly = await inspect(ID, { api, outputRoot: dir, measureSunoAudio: false });
    assert.equal(metadataOnly.audio, undefined);
    assert.equal(metadataOnly.audioError, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recognises YouTube links and keeps the details that describe a song', () => {
  const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  for (const link of ['https://youtu.be/dQw4w9WgXcQ?si=x', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD', 'https://www.youtube.com/shorts/dQw4w9WgXcQ']) {
    assert.equal(parseYouTube(link), watch, link);
  }
  assert.equal(parseYouTube('https://www.youtube.com/watch?v=short'), null);
  assert.equal(parseYouTube('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTube('dQw4w9WgXcQ'), null);
  const facts = videoFacts({ title: 'Song (Official Video)', uploader: 'Band', artist: 'Band', track: 'Song', tags: ['pop', 3], duration: 212.6 });
  assert.equal(facts.channel, 'Band');
  assert.deepEqual(facts.tags, ['pop']);
  assert.equal(facts.duration_seconds, 213);
  const report = renderReport({ source: watch, video: facts });
  assert.match(report, /# How "Song" is made[\s\S]*Band, "Song"[\s\S]*Genre and subgenre/);
});

test('rejects inputs it cannot inspect', async () => {
  await assert.rejects(inspect('https://open.spotify.com/track/abc'), /not an audio file, a YouTube or Suno link/);
});
