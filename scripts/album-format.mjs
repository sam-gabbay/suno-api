import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const ALBUM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validateAlbum(album) {
  const errors = [];
  const requireText = (value, label, max) => {
    if (typeof value !== 'string' || !value.trim()) errors.push(`${label} is required.`);
    else if (max && value.length > max) errors.push(`${label} exceeds ${max} characters.`);
  };
  if (!album || typeof album !== 'object' || Array.isArray(album)) throw new Error('Album must be a JSON object.');
  if (album.schema_version !== 1) errors.push('schema_version must be 1.');
  for (const field of ['name', 'concept', 'genre', 'language', 'creative_model', 'artwork_prompt']) requireText(album[field], field);
  if (typeof album.slug !== 'string' || !ALBUM_SLUG.test(album.slug) || album.slug.length > 80) errors.push('slug must be at most 80 lowercase letters/digits separated by hyphens.');
  if (!Array.isArray(album.tracks) || album.tracks.length < 1 || album.tracks.length > 30) errors.push('Provide between 1 and 30 tracks.');
  const titles = new Set();
  for (const [index, track] of (Array.isArray(album.tracks) ? album.tracks : []).entries()) {
    const label = `Track ${index + 1}`;
    if (!track || typeof track !== 'object') { errors.push(`${label} must be an object.`); continue; }
    if (track.number !== index + 1) errors.push(`${label} must have number ${index + 1}.`);
    requireText(track.title, `${label} title`, 80);
    const title = typeof track.title === 'string' ? track.title.trim().toLowerCase() : '';
    if (title && titles.has(title)) errors.push(`${label} duplicates a song title.`);
    titles.add(title);
    if (!['female', 'male', 'duet', 'ensemble'].includes(track.vocal)) errors.push(`${label} vocal must be female, male, duet, or ensemble.`);
    for (const field of ['vocal_direction', 'key', 'theme']) requireText(track[field], `${label} ${field}`);
    if (!Number.isFinite(track.bpm) || track.bpm < 40 || track.bpm > 240) errors.push(`${label} BPM must be between 40 and 240.`);
    requireText(track.suno_style_prompt, `${label} Suno style prompt`, 200);
    requireText(track.lyrics, `${label} lyrics`, 3000);
    if (typeof track.lyrics === 'string' && track.lyrics.trim().length < 500) errors.push(`${label} needs complete lyrics, not an outline.`);
    if (typeof track.negative_tags !== 'string' || track.negative_tags.length > 200) errors.push(`${label} negative_tags must be a string of at most 200 characters.`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return album;
}

export function sunoPayload(track) {
  return {
    title: track.title,
    prompt: track.lyrics,
    tags: track.suno_style_prompt,
    negative_tags: track.negative_tags,
    make_instrumental: false,
    wait_audio: false,
  };
}

function trackStem(track) {
  const slug = track.title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
  return `${String(track.number).padStart(2, '0')}-${slug}`;
}

export async function writeAlbumPackage(album, destination, artwork) {
  validateAlbum(album);
  // Validate the cover before creating the package. Inspecting PNG headers does
  // not resize or alter image-generation output.
  let artworkInfo;
  if (artwork) {
    const bytes = await readFile(artwork);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('The cover must be a generated PNG.');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== height || width < 1000) throw new Error('The cover must be square and at least 1000 pixels wide.');
    artworkInfo = { file: 'cover.png', width, height, renderer: 'built-in image generation', art_direction_model: album.creative_model };
  }
  await mkdir(path.dirname(destination), { recursive: true });
  // Fail on an existing directory: reruns must preserve earlier creative work.
  await mkdir(destination, { mode: 0o700 });
  const save = (file, text) => writeFile(path.join(destination, file), text, { flag: 'wx', mode: 0o600 });
  await mkdir(path.join(destination, 'tracks'), { mode: 0o700 });
  const payloads = album.tracks.map((track) => ({ number: track.number, vocal: track.vocal, bpm: track.bpm, endpoint: '/api/custom_generate', body: sunoPayload(track) }));
  await save('album.json', JSON.stringify(album, null, 2) + '\n');
  await save('suno-prompts.json', JSON.stringify(payloads, null, 2) + '\n');
  await save('artwork-prompt.txt', album.artwork_prompt + '\n');
  await save('package-status.json', JSON.stringify({ creative_package: 'complete', audio: 'not_generated', artwork: artworkInfo || { status: 'pending' } }, null, 2) + '\n');
  if (artwork) await copyFile(artwork, path.join(destination, 'cover.png'));
  const tableCell = (value) => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const overview = [
    `# ${album.name}`, '', album.concept, '',
    `**Genre:** ${album.genre} · **Language:** ${album.language} · **Creative model:** ${album.creative_model}`, '',
    ...(artwork ? ['![Album cover](cover.png)', ''] : []),
    '| # | Song | Lead | BPM | Key |', '| --- | --- | --- | --- | --- |',
    ...album.tracks.map((track) => `| ${track.number} | [${tableCell(track.title)}](tracks/${trackStem(track)}.md) | ${track.vocal} | ${track.bpm} | ${tableCell(track.key)} |`), '',
    'Lyrics, titles, and art direction are by the creative model above. Cover pixels are rendered by the image-generation tool. Vocal direction, tempo, and key are requests to Suno; the resulting audio must be checked.', '',
    'This package contains no newly generated audio. `suno-prompts.json` contains request bodies for the authenticated local `/api/custom_generate` endpoint. In these bodies, `prompt` is the complete lyric text and `tags` is the music style.', '',
    '## Lyrics', '',
  ];
  for (const track of album.tracks) {
    const text = [
      `# ${String(track.number).padStart(2, '0')} — ${track.title}`, '',
      `**Lead:** ${track.vocal} — ${track.vocal_direction}`, '',
      `**Tempo:** ${track.bpm} BPM · **Key:** ${track.key}`, '',
      `**Theme:** ${track.theme}`, '',
      '## Suno style prompt', '', track.suno_style_prompt, '',
      '## Avoid', '', track.negative_tags || 'No additional exclusions.', '',
      '## Lyrics', '', '```text', track.lyrics, '```', '',
    ].join('\n');
    await save(`tracks/${trackStem(track)}.md`, text);
    await save(`tracks/${trackStem(track)}.suno.json`, JSON.stringify(sunoPayload(track), null, 2) + '\n');
    overview.push(`### ${String(track.number).padStart(2, '0')} — ${track.title}`, '', `*${track.vocal} lead · ${track.bpm} BPM*`, '', '```text', track.lyrics, '```', '');
  }
  await save('ALBUM.md', overview.join('\n'));
  return { directory: destination, tracks: album.tracks.length, artwork: artworkInfo || null };
}
