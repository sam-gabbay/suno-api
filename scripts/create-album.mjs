import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ALBUM_MODEL = 'gpt-6-astra';
export const DEFAULT_BRIEF = 'Create an original 10-song upbeat Afrobeats album in English with five female-led and five male-led songs. Name the album and every song, write full lyrics and individual Suno prompts, and create the album cover.';

export function albumCommand(args, root) {
  const options = new Set(['--dry-run', '--music']);
  const invalid = args.find((arg) => arg.startsWith('--') && !options.has(arg));
  if (invalid) throw new Error(`Unknown option: ${invalid}. Use --help.`);
  const music = args.includes('--music');
  const brief = args.filter((arg) => !options.has(arg)).join(' ').trim() || DEFAULT_BRIEF;
  const prompt = [
    'Use $create-album. Read .agents/skills/create-album/SKILL.md in this repository.',
    'The user explicitly selected gpt-6-astra for lyrics, titles, album concept, and art direction. Do the creative writing yourself in this Astra session.',
    brief,
    music ? 'Also generate the music using the connected local Suno API. Save every accepted clip ID before continuing, reuse existing jobs after interruptions, and verify one downloaded audio file per song. Do not purchase additional credits or download packs.' : 'For this run, create the creative package and artwork only. Do not submit any Suno music generation or download-unlock requests.',
  ].join('\n\n');
  return {
    command: process.env.CODEX_BIN || 'codex',
    args: ['--model', ALBUM_MODEL, '--cd', root, prompt],
    music,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run album -- [--music] [--dry-run] "Album brief"\n\nOpens Codex with Astra 6 and the create-album skill. Default: 10 upbeat Afrobeats songs, mixed female/male leads, English, plus cover artwork. Add --music to authorize Suno generation. --dry-run prints the invocation without launching Codex.');
  } else {
    try {
      const invocation = albumCommand(args, fileURLToPath(new URL('../', import.meta.url)));
      if (args.includes('--dry-run')) console.log(JSON.stringify(invocation, null, 2));
      else {
        console.log(`Opening Codex with ${ALBUM_MODEL}. ${invocation.music ? 'Music generation requested.' : 'Creative package and cover artwork.'}`);
        const child = spawn(invocation.command, invocation.args, { stdio: 'inherit', shell: false });
        child.on('error', (error) => { console.error(error.code === 'ENOENT' ? 'Codex CLI was not found. Set CODEX_BIN to its executable path.' : error.message); process.exitCode = 1; });
        child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
      }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
