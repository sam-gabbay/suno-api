import { api, root } from './local-client.mjs';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const output = path.join(root, 'output', new Date().toISOString().replace(/[:.]/g, '-'));
const report = { verified: false, stage: 'preflight', clips: [] };
const args = process.argv.slice(2);
let attemptedGeneration = false;
try {
  await mkdir(output, { recursive: true, mode: 0o700 });
  if (spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status !== 0 ||
      spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('Install ffprobe and ffmpeg before spending credits on this test.');
  }
  const health = await api('/api/health');
  if (!health.suno_cookie_configured) throw new Error('Suno cookie is missing. Run the credential setup first.');
  let ids;
  if (args[0] === '--resume') {
    if (args.length !== 2) throw new Error('Usage: npm run smoke -- --resume output/<timestamp>/report.json');
    const previous = JSON.parse(await readFile(path.resolve(args[1]), 'utf8'));
    ids = previous.clip_ids;
    report.model = previous.model;
    report.resumed_from = path.resolve(args[1]);
    console.log('Resuming existing clip jobs; no new generation will be submitted.');
  } else {
    if (args.some((arg) => arg.startsWith('--'))) throw new Error('Unknown option; use --resume <report.json> or a plain prompt.');
    const credits = await api('/api/get_limit');
    report.credits_before = credits.credits_left;
    if (!(credits.credits_left > 0)) throw new Error('Suno did not report any available credits.');
    const prompt = args.join(' ') || 'A calm instrumental piano piece with gentle acoustic guitar, warm and hopeful, no vocals.';
    report.stage = 'generation';
    report.model = health.model;
    console.log('Submitting exactly one generation request; this can consume Suno credits and produce two clips.');
    attemptedGeneration = true;
    const generated = await api('/api/generate', { prompt, make_instrumental: true, wait_audio: false });
    ids = Array.isArray(generated) ? generated.map((clip) => clip.id) : null;
  }
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))) {
    throw new Error('No valid saved clip IDs. Inspect Suno before submitting a new generation.');
  }
  ids = [...new Set(ids)];
  report.clip_ids = ids;
  // Persist IDs immediately so a timeout never requires another paid submission.
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Tracking ${ids.length} clip jobs; waiting for complete audio.`);
  report.stage = 'polling';
  let clips = [];
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) {
    clips = await api(`/api/get?ids=${ids.join(',')}`);
    if (!Array.isArray(clips)) throw new Error('Unexpected clip-status response.');
    const wanted = clips.filter((clip) => ids.includes(clip.id));
    if (wanted.some((clip) => clip.status === 'error')) throw new Error('Suno reported a failed clip. Inspect the jobs before retrying.');
    console.log(wanted.map((clip) => `${clip.id}: ${clip.status}`).join(', ') || 'Waiting for clips to appear...');
    if (ids.every((id) => wanted.some((clip) => clip.id === id && clip.status === 'complete'))) {
      clips = ids.map((id) => wanted.find((clip) => clip.id === id));
      break;
    }
    await delay(10000);
  }
  if (!ids.every((id) => clips.some((clip) => clip.id === id && clip.status === 'complete'))) {
    throw new Error('Clips did not finish within six minutes. Job IDs are saved; inspect them before resubmitting.');
  }
  report.stage = 'download';
  for (const clip of clips) {
    console.log(`Preparing authorized download for ${clip.id}; a first unlock uses Suno download allowance.`);
    const download = await api('/api/download', { clip_id: clip.id, format: 'mp3' });
    const url = new URL(download.download_url);
    if (url.protocol !== 'https:') throw new Error('Suno returned a non-HTTPS audio URL.');
    if (/\/sil-\d+\.mp3$/i.test(url.pathname)) throw new Error('Suno returned a silent placeholder instead of the generated song.');
    const candidate = path.join(output, `${clip.id}.download`);
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`Audio download returned HTTP ${response.status}.`);
    let bytes = 0;
    const limit = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      callback(bytes > 200 * 1024 * 1024 ? new Error('Audio download exceeds 200 MB.') : null, chunk);
    } });
    try {
      await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(candidate, { mode: 0o600, flags: 'wx' }));
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', candidate], { encoding: 'utf8', timeout: 30000 });
      const metadata = probe.status === 0 ? JSON.parse(probe.stdout) : null;
      const stream = metadata?.streams?.find((item) => item.codec_type === 'audio');
      if (!stream || !(Number(metadata.format?.duration) > 1)) throw new Error('Downloaded response is not a valid song longer than one second.');
      const decoded = spawnSync('ffmpeg', ['-v', 'error', '-xerror', '-i', candidate, '-map', '0:a:0', '-f', 'null', '-'], { encoding: 'utf8', timeout: 120000 });
      if (decoded.status !== 0) throw new Error('Downloaded audio failed a full decode.');
      const format = metadata.format.format_name;
      const extension = format === 'mp3' ? 'mp3' : format.includes('mov') ? 'm4a' : format.includes('ogg') ? 'ogg' : format === 'wav' ? 'wav' : 'audio';
      const file = `${clip.id}.${extension}`;
      await rename(candidate, path.join(output, file));
      report.clips.push({ id: clip.id, title: clip.title, file, bytes, codec: stream.codec_name, duration: Number(metadata.format.duration), decoded: true, download_credit_deducted: download.credit_deducted });
      await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
      console.log(`Verified ${file}: ${metadata.format.duration} seconds, ${stream.codec_name}.`);
    } catch (error) {
      await unlink(candidate).catch(() => {});
      throw error;
    }
  }
  report.credits_after = (await api('/api/get_limit')).credits_left;
  report.stage = 'complete';
  report.verified = true;
} catch (error) {
  report.error = error.message;
  report.generation_attempted = attemptedGeneration;
  console.error(error.message);
  if (attemptedGeneration) console.error('No automatic resubmission was made. Check the saved job IDs and Suno workspace before retrying.');
  process.exitCode = 1;
} finally {
  report.generation_attempted = attemptedGeneration;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Report: ${path.join(output, 'report.json')}`);
}
