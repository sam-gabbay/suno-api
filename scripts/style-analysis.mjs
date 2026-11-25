// Measures the parts of a song's style that can be heard in the signal itself:
// tempo, key, loudness, tone and arrangement energy. Genre, instruments and vocal
// character still need a listener; see SONG_STYLE.md.
import { spawn } from 'node:child_process';

export const SAMPLE_RATE = 22050;
const PITCHES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Albrecht & Shanahan key profiles, derived from popular and classical repertoire.
// On mixed Apple Loops with labelled keys they beat Krumhansl-Kessler (58% vs 47%).
const MAJOR = [0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.08, 0.008, 0.081];
const MINOR = [0.22, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052];

function run(command, args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (error) => reject(error.code === 'ENOENT' ? new Error(`${command} is not installed.`) : error));
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) return reject(new Error(`${command} failed: ${stderr.trim().split('\n').slice(-3).join(' ')}`));
      resolve({ stdout: binary ? Buffer.concat(out) : Buffer.concat(out).toString('utf8'), stderr });
    });
  });
}

/** Decodes any ffmpeg-readable file to interleaved stereo float samples at SAMPLE_RATE. */
export async function decodeStereo(file) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '2', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'], { binary: true });
  const usable = stdout.byteLength - (stdout.byteLength % 8);
  const copy = new Float32Array(usable / 4);
  for (let i = 0; i < copy.length; i++) copy[i] = stdout.readFloatLE(i * 4);
  if (copy.length < SAMPLE_RATE * 2 * 5) throw new Error('The audio is shorter than five seconds; nothing reliable to measure.');
  return copy;
}

/** Integrated loudness (LUFS) and loudness range (LU) from ffmpeg's EBU R128 meter. */
export async function measureLoudness(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const value = (label) => {
    const match = summary.match(new RegExp(`${label}:\\s+(-?[\\d.]+|-inf)`));
    return match && match[1] !== '-inf' ? Number(match[1]) : null;
  };
  return { integrated_lufs: value('I'), loudness_range_lu: value('LRA'), true_peak_dbfs: value('Peak') };
}

/** In-place iterative radix-2 FFT. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Calls onFrame(magnitudes, frameIndex) for each Hann-windowed frame of a mono signal. */
function spectra(mono, size, hop, onFrame) {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const mags = new Float64Array(size / 2);
  let index = 0;
  for (let start = 0; start + size <= mono.length; start += hop, index++) {
    for (let i = 0; i < size; i++) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) mags[k] = Math.hypot(re[k], im[k]);
    onFrame(mags, index);
  }
  return index;
}

/**
 * Estimates tempo from the autocorrelation of a spectral-flux onset envelope,
 * weighted towards ~115 BPM so that a half- or double-time reading is only chosen
 * when the evidence for it is clearly stronger.
 */
export function estimateTempo(mono, sampleRate = SAMPLE_RATE) {
  const size = 1024;
  const hop = 256;
  const fps = sampleRate / hop;
  let previous = null;
  const flux = [];
  spectra(mono, size, hop, (mags) => {
    const logMag = Float64Array.from(mags, (m) => Math.log1p(100 * m));
    let sum = 0;
    if (previous) for (let k = 1; k < logMag.length; k++) sum += Math.max(0, logMag[k] - previous[k]);
    flux.push(sum);
    previous = logMag;
  });
  // Remove the slowly varying level so only onsets remain.
  const radius = Math.round(fps * 0.25);
  const onset = new Float64Array(flux.length);
  let running = 0;
  for (let i = 0; i < flux.length + radius; i++) {
    if (i < flux.length) running += flux[i];
    if (i - 2 * radius - 1 >= 0) running -= flux[i - 2 * radius - 1];
    const centre = i - radius;
    if (centre >= 0 && centre < flux.length) {
      const count = Math.min(flux.length - 1, centre + radius) - Math.max(0, centre - radius) + 1;
      onset[centre] = Math.max(0, flux[centre] - running / count);
    }
  }
  const minLag = Math.floor((60 * fps) / 200);
  const maxLag = Math.ceil((60 * fps) / 55);
  const ac = new Float64Array(maxLag * 2 + 2);
  for (let lag = 1; lag < ac.length; lag++) {
    let sum = 0;
    for (let i = lag; i < onset.length; i++) sum += onset[i] * onset[i - lag];
    ac[lag] = sum / (onset.length - lag);
  }
  const scoreAt = (lag) => ac[lag] + 0.5 * (ac[2 * lag] || 0);
  const prior = (bpm) => Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.9) ** 2);
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = scoreAt(lag) * prior((60 * fps) / lag);
    if (score > bestScore) [best, bestScore] = [lag, score];
  }
  // Parabolic interpolation for a fractional lag.
  const [a, b, c] = [ac[best - 1], ac[best], ac[best + 1]];
  const shift = a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
  const bpm = (60 * fps) / (best + Math.max(-0.5, Math.min(0.5, shift)));
  const mean = ac.slice(minLag, maxLag + 1).reduce((s, v) => s + v, 0) / (maxLag - minLag + 1);
  return {
    bpm: Math.round(bpm * 10) / 10,
    // How far the winning periodicity stands above the average one (1 = not at all).
    pulse_strength: mean > 0 ? Math.round((b / mean) * 100) / 100 : 0,
  };
}

/** Pearson correlation. */
function correlate(x, y) {
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/**
 * Average 12-bin pitch-class profile from spectral peaks between 60 Hz and 4 kHz.
 * Only local maxima count (interpolated to their true frequency), which keeps
 * drum noise from smearing across every pitch class; each frame is normalised so
 * quiet passages count as much as loud ones.
 */
export function chroma(mono, sampleRate = SAMPLE_RATE) {
  const size = 8192;
  const totals = new Float64Array(12);
  const pitchClass = (freq) => ((Math.round(12 * Math.log2(freq / 440)) % 12) + 12 + 9) % 12;
  const lo = Math.ceil((60 * size) / sampleRate);
  const hi = Math.min(size / 2 - 2, Math.floor((4000 * size) / sampleRate));
  spectra(mono, size, size / 2, (mags) => {
    const frame = new Float64Array(12);
    for (let k = lo; k <= hi; k++) {
      const [a, b, c] = [mags[k - 1], mags[k], mags[k + 1]];
      if (!(b > a && b >= c)) continue;
      const curve = a - 2 * b + c;
      const offset = curve ? (0.5 * (a - c)) / curve : 0;
      frame[pitchClass(((k + offset) * sampleRate) / size)] += b;
    }
    const peak = Math.max(...frame);
    if (peak > 1e-9) for (let i = 0; i < 12; i++) totals[i] += frame[i] / peak;
  });
  const peak = Math.max(...totals) || 1;
  return Array.from(totals, (v) => v / peak);
}

/** Best-matching major or minor key for a chroma profile, with the runner-up. */
export function estimateKey(profile) {
  const candidates = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = profile.map((_, i) => profile[(i + tonic) % 12]);
    candidates.push({ key: `${PITCHES[tonic]} major`, score: correlate(rotated, MAJOR) });
    candidates.push({ key: `${PITCHES[tonic]} minor`, score: correlate(rotated, MINOR) });
  }
  candidates.sort((x, y) => y.score - x.score);
  const [first, second] = candidates;
  return {
    key: first.key,
    alternative: second.key,
    correlation: Math.round(first.score * 100) / 100,
    margin: Math.round((first.score - second.score) * 100) / 100,
  };
}

/** Spectral centroid, bass share and stereo width over the whole track. */
export function measureTone(stereo, sampleRate = SAMPLE_RATE) {
  const frames = stereo.length / 2;
  const mono = new Float32Array(frames);
  let mid = 0;
  let side = 0;
  for (let i = 0; i < frames; i++) {
    const l = stereo[2 * i];
    const r = stereo[2 * i + 1];
    mono[i] = (l + r) / 2;
    mid += ((l + r) / 2) ** 2;
    side += ((l - r) / 2) ** 2;
  }
  const size = 2048;
  const binHz = sampleRate / size;
  let centroidSum = 0;
  let weight = 0;
  let bass = 0;
  let total = 0;
  spectra(mono, size, 4096, (mags) => {
    let num = 0;
    let den = 0;
    for (let k = 1; k < mags.length; k++) {
      const power = mags[k] ** 2;
      num += k * binHz * mags[k];
      den += mags[k];
      total += power;
      if (k * binHz < 150) bass += power;
    }
    if (den > 1e-9) {
      centroidSum += num;
      weight += den;
    }
  });
  return {
    mono,
    spectral_centroid_hz: weight ? Math.round(centroidSum / weight) : 0,
    bass_share: total ? Math.round((bass / total) * 100) / 100 : 0,
    stereo_width: mid ? Math.round((side / mid) * 100) / 100 : 0,
  };
}

/** Loudness of the track in equal slices, scaled 0-1, to show the arrangement's shape. */
export function energyCurve(mono, slices = 32) {
  const length = Math.floor(mono.length / slices);
  const rms = [];
  for (let s = 0; s < slices; s++) {
    let sum = 0;
    for (let i = s * length; i < (s + 1) * length; i++) sum += mono[i] ** 2;
    rms.push(Math.sqrt(sum / length));
  }
  const db = rms.map((v) => 20 * Math.log10(v + 1e-9));
  const top = Math.max(...db);
  // Show the top 18 dB; anything quieter reads as silence.
  return db.map((v) => Math.max(0, Math.min(1, (v - (top - 18)) / 18)));
}

export function sparkline(values) {
  const bars = '▁▂▃▄▅▆▇█';
  return values.map((v) => bars[Math.min(bars.length - 1, Math.floor(v * bars.length))]).join('');
}

/** Turns measurements into plain words a Suno style prompt can use. */
export function describe(m) {
  const words = [];
  const notes = [];
  const bpm = Math.round(m.tempo.bpm);
  words.push(`${bpm} BPM`);
  // Tempo detectors most often land on a half, double or 2:3 multiple of the felt beat.
  const others = [0.5, 2 / 3, 1.5, 2].map((x) => Math.round(m.tempo.bpm * x)).filter((v) => v >= 60 && v <= 190);
  const tryOthers = others.length ? ` Tap along: if it feels different, try ${others.join(' or ')} BPM.` : '';
  if (m.tempo.pulse_strength < 1.6) notes.push(`The beat is loose or rubato, so ${bpm} BPM is a rough reading.${tryOthers}`);
  else if (tryOthers) notes.push(tryOthers.trim());
  // Below this margin the key reading was right barely half the time in testing.
  if (m.key.margin >= 0.1) words.push(m.key.key);
  else notes.push(`The key is uncertain (${m.key.key} or ${m.key.alternative}), so it was left out of the prompt.`);

  // Thresholds are deliberately wide: only clearly unusual tone earns a word.
  const c = m.tone.spectral_centroid_hz;
  if (c < 1800) words.push('dark, mellow tone');
  else if (c > 3400) words.push('bright, airy top end');
  if (m.tone.bass_share >= 0.72) words.push('heavy sub bass');
  else if (m.tone.bass_share < 0.25) words.push('light low end');
  if (m.tone.stereo_width >= 0.25) words.push('wide stereo');
  else if (m.tone.stereo_width < 0.03) words.push('narrow, centred mix');

  const lufs = m.loudness.integrated_lufs;
  const lra = m.loudness.loudness_range_lu;
  if (lufs !== null) {
    if (lufs > -9) words.push('loud, punchy master');
    else if (lufs < -16) words.push('soft, dynamic master');
  }
  if (lra !== null) {
    if (lra >= 10) words.push('dramatic dynamics');
    else if (lra < 4) words.push('steady, consistent energy');
  }
  const curve = m.energy;
  const opening = curve.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
  const body = curve.slice(3, -3).reduce((s, v) => s + v, 0) / Math.max(1, curve.length - 6);
  if (opening < body - 0.3) words.push('soft intro that builds');
  const dips = curve.slice(4, -4).filter((v) => v < body - 0.35).length;
  if (dips >= 1) notes.push('There is a clear breakdown mid-song; a [Break] or [Bridge] section tag can recreate it.');
  return { words, notes };
}

/** Full measurement of an audio file. */
export async function analyseAudio(file) {
  const stereo = await decodeStereo(file);
  const loudness = await measureLoudness(file);
  const { mono, ...tone } = measureTone(stereo);
  const measured = {
    duration_seconds: Math.round(mono.length / SAMPLE_RATE),
    tempo: estimateTempo(mono),
    key: estimateKey(chroma(mono)),
    loudness,
    tone,
    energy: energyCurve(mono),
  };
  return { ...measured, description: describe(measured) };
}
