// Local development only. On Vercel the same logic runs from api/, so this file
// is a thin wrapper and nothing important lives here.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize as normPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bookings, speak, usage } from './src/handlers.js';
import { configuredProvider } from './src/tts.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const readBody = (req) => new Promise((resolve, reject) => {
  let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  req.on('error', reject);
});

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    const api = { '/api/bookings': bookings, '/api/speak': speak, '/api/usage': usage };
    if (api[url.pathname]) {
      const body = req.method === 'POST' ? await readBody(req) : null;
      const out = await api[url.pathname](req.method, body);
      if (out.mp3) {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000' });
        return res.end(out.mp3);
      }
      res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(out.json));
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const path = normPath(join(PUBLIC, rel));
    if (!path.startsWith(PUBLIC)) { res.writeHead(403); return res.end('no'); }
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
    console.log(p ? `Voice: ${p}` : "Voice: the browser's own (no provider key set)");
  });
}
