import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAlbum, writeAlbumPackage } from './album-format.mjs';

const args = process.argv.slice(2);
const usage = 'Usage: npm run album:prepare -- <draft.json> [--artwork <cover.png>] [--out <new-directory>]';
try {
  if (!args.length || args[0] === '--help') { console.log(usage); process.exit(args.length ? 0 : 1); }
  const draft = args.shift();
  let artwork;
  let output;
  while (args.length) {
    const flag = args.shift();
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(usage);
    if (flag === '--artwork') artwork = path.resolve(value);
    else if (flag === '--out') output = path.resolve(value);
    else throw new Error(usage);
  }
  const album = validateAlbum(JSON.parse(await readFile(path.resolve(draft), 'utf8')));
  const root = fileURLToPath(new URL('../', import.meta.url));
  output ||= path.join(root, 'output', 'albums', album.slug);
  const result = await writeAlbumPackage(album, output, artwork);
  console.log(`Prepared ${result.tracks} songs: ${result.directory}`);
  console.log(result.artwork ? `Cover: ${result.artwork.width} × ${result.artwork.height} PNG` : 'Cover artwork is still pending.');
  console.log('No Suno generation requests were sent.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'That output folder already exists. Choose a new --out directory to preserve it.' : error.message);
  process.exitCode = 1;
}
