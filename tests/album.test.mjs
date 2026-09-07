import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateAlbum, writeAlbumPackage, sunoPayload } from '../scripts/album-format.mjs';
import { albumCommand, ALBUM_MODEL } from '../scripts/create-album.mjs';

const fixture = () => ({
  schema_version: 1, name: 'Test Album', slug: 'test-album', concept: 'A test concept',
  genre: 'Afrobeats', language: 'English', creative_model: 'test-fixture', artwork_prompt: 'Square cover brief',
  tracks: [1, 2].map((number) => ({
    number, title: `Song ${number}`, vocal: number === 1 ? 'female' : 'male',
    vocal_direction: 'Warm lead', bpm: 112, key: 'A minor', theme: 'Friendship',
    suno_style_prompt: 'Upbeat Afrobeats, warm vocals, highlife guitar, syncopated bass, shakers.',
    negative_tags: 'distortion', lyrics: '[Verse 1]\n' + 'A complete line for the export validation fixture.\n'.repeat(20),
  })),
});

test('album export maps full lyrics into custom mode and preserves requested vocals', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'suno-album-test-'));
  try {
    const album = fixture();
    const destination = path.join(root, 'album');
    await writeAlbumPackage(album, destination);
    const prompts = JSON.parse(await readFile(path.join(destination, 'suno-prompts.json'), 'utf8'));
    assert.equal(prompts.length, 2);
    assert.deepEqual(prompts.map((track) => track.vocal), ['female', 'male']);
    assert.equal(prompts[0].endpoint, '/api/custom_generate');
    assert.equal(prompts[0].body.prompt, album.tracks[0].lyrics);
    assert.equal(prompts[0].body.tags, album.tracks[0].suno_style_prompt);
    assert.equal(prompts[0].body.make_instrumental, false);
    assert.equal(prompts[0].body.wait_audio, false);
    const status = JSON.parse(await readFile(path.join(destination, 'package-status.json'), 'utf8'));
    assert.equal(status.audio, 'not_generated');
    assert.equal(status.artwork.status, 'pending');
    const before = await readFile(path.join(destination, 'album.json'), 'utf8');
    await assert.rejects(writeAlbumPackage(album, destination), { code: 'EEXIST' });
    assert.equal(await readFile(path.join(destination, 'album.json'), 'utf8'), before);
    assert.deepEqual(JSON.parse(await readFile(path.join(destination, 'tracks', '01-song-1.suno.json'), 'utf8')), sunoPayload(album.tracks[0]));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid album plans fail before payload truncation or unsafe path creation', () => {
  for (const mutate of [
    (album) => { album.slug = '../../escape'; },
    (album) => { album.tracks[1].title = album.tracks[0].title; },
    (album) => { album.tracks[0].number = 0; },
    (album) => { album.tracks[0].lyrics = 'x'.repeat(3001); },
    (album) => { album.tracks[0].suno_style_prompt = 'x'.repeat(201); },
    (album) => { album.tracks[0].lyrics = '[Verse: write later]'; },
  ]) {
    const album = fixture();
    mutate(album);
    assert.throws(() => validateAlbum(album));
  }
});

test('album launcher pins Astra and makes paid music an explicit option', () => {
  const brief = 'Bright music; $(echo literal)';
  const creative = albumCommand([brief], '/tmp/project');
  assert.deepEqual(creative.args.slice(0, 4), ['--model', ALBUM_MODEL, '--cd', '/tmp/project']);
  assert.equal(ALBUM_MODEL, 'gpt-6-astra');
  assert.equal(creative.args.length, 5);
  assert.ok(creative.args[4].includes(brief));
  assert.equal(creative.music, false);
  assert.equal(albumCommand(['--music', brief], '/tmp/project').music, true);
  assert.throws(() => albumCommand(['--model', 'something-else'], '/tmp/project'), /Unknown option/);
});
