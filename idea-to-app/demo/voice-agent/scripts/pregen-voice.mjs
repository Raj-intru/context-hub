// Run once, with your key in .env: turns every fixed line into an MP3 so the
// demo plays from disk. Costs a fraction of a cent for the whole set.
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixedLines } from '../src/lines.js';
import { synthesize, configuredProvider, providerNames } from '../src/tts.js';
import { voiceFile } from '../server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VOICE = join(ROOT, 'public', 'voice');

// Minimal .env reader — no dependency, and it never prints a value.
try {
  for (const line of (await readFile(join(ROOT, '.env'), 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no .env, that is fine */ }

const provider = configuredProvider();
if (!provider) {
  console.log('No voice provider key found, so there is nothing to generate.');
  console.log(`The app will use the browser\'s own voice, which is fine for a rehearsal.`);
  console.log(`To use a real voice: copy .env.example to .env and fill in one of: ${providerNames.join(', ')}.`);
  process.exit(0);
}

await mkdir(VOICE, { recursive: true });
const manifest = {};
let chars = 0, made = 0;

for (const text of fixedLines) {
  const name = voiceFile(text);
  manifest[text] = `voice/${name}`;
  try {
    await readFile(join(VOICE, name));
    console.log(`have  ${name}  ${text.slice(0, 48)}…`);
  } catch {
    const mp3 = await synthesize(text);
    await writeFile(join(VOICE, name), mp3);
    chars += text.length; made += 1;
    console.log(`made  ${name}  ${text.slice(0, 48)}…`);
  }
}

await writeFile(join(VOICE, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${provider}: ${made} new file(s), ${chars} characters.`);
console.log('At $40 per million characters that is about $' + (chars * 40 / 1e6).toFixed(5) + '.');
