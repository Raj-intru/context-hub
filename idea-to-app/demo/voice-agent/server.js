// Zero-dependency server. Serves the page, keeps the bookings, and synthesises
// a line of speech on a cache miss.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize as normPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesize, configuredProvider } from './src/tts.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const VOICE_DIR = join(PUBLIC, 'voice');
const DATA = join(ROOT, 'data', 'bookings.json');
const PORT = Number(process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export const voiceFile = (text) => `${createHash('sha1').update(text).digest('hex').slice(0, 16)}.mp3`;

async function bookings() {
  try { return JSON.parse(await readFile(DATA, 'utf8')); } catch { return []; }
}

const body = (req) => new Promise((res, rej) => {
  let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => res(b)); req.on('error', rej);
});

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/bookings' && req.method === 'GET') {
      return json(res, 200, await bookings());
    }

    if (url.pathname === '/api/bookings' && req.method === 'POST') {
      const b = JSON.parse(await body(req) || '{}');
      if (!b.name || !b.phone || !b.day) return json(res, 400, { error: 'name, phone and day are all required' });
      const list = await bookings();
      // Only what spec.md says we may keep, and nothing else.
      const row = { name: String(b.name).slice(0, 80), phone: String(b.phone).replace(/[^0-9]/g, '').slice(0, 15), day: String(b.day).slice(0, 20), takenAt: new Date().toISOString() };
      list.push(row);
      await mkdir(join(ROOT, 'data'), { recursive: true });
      await writeFile(DATA, JSON.stringify(list, null, 2));
      return json(res, 201, row);
    }

    if (url.pathname === '/api/speak' && req.method === 'POST') {
      const { text } = JSON.parse(await body(req) || '{}');
      if (!text) return json(res, 400, { error: 'text required' });
      if (!configuredProvider()) return json(res, 204, {});   // no key: the page uses the browser voice
      const name = voiceFile(text);
      const path = join(VOICE_DIR, name);
      let mp3;
      try { mp3 = await readFile(path); } catch {
        mp3 = await synthesize(text);
        if (!mp3) return json(res, 204, {});
        await mkdir(VOICE_DIR, { recursive: true });
        await writeFile(path, mp3);           // warm the cache for next time
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000' });
      return res.end(mp3);
    }

    // The page imports the brain straight from src/, so it is the same file the
    // tests run against — no copy to drift out of date.
    let base = PUBLIC;
    let rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.js')) {
      base = join(ROOT, 'src');
      rel = url.pathname.slice('/src/'.length);
    }
    const path = normPath(join(base, rel));
    if (!path.startsWith(base)) { res.writeHead(403); return res.end('no'); }
    const file = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    return res.end(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') { res.writeHead(404); return res.end('not found'); }
    console.error(err);
    res.writeHead(500); return res.end('server error');
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    const p = configuredProvider();
    console.log(`Dave's Plumbing assistant on http://localhost:${PORT}`);
    console.log(p ? `Voice: ${p} (cached files in public/voice)` : 'Voice: the browser\'s own (no provider key set)');
  });
}
