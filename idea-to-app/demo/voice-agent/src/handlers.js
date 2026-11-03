// The request logic, with no server in it — so both the local server and the
// Vercel function are thin wrappers, and the tests drive the same code.
import * as store from './store.js';
import * as metrics from './metrics.js';
import { synthesize, configuredProvider } from './tts.js';

const spoken = new Map();   // text -> mp3 Buffer, per instance

export function bookings(method, body) {
  if (method === 'GET') return { status: 200, json: store.list() };
  if (method !== 'POST') return { status: 405, json: { error: 'method not allowed' } };

  const b = body || {};
  if (!b.name || !b.phone || !b.day) {
    return { status: 400, json: { error: 'name, phone and day are all required' } };
  }
  // Only what spec.md says we may keep, and nothing else.
  const row = {
    name: String(b.name).slice(0, 80),
    phone: String(b.phone).replace(/[^0-9]/g, '').slice(0, 15),
    day: String(b.day).slice(0, 20),
    takenAt: new Date().toISOString(),
  };
  return { status: 201, json: store.add(row) };
}

// The page reports one content-free line per turn: what happened, how long the
// caller waited, how many characters were spoken. Never what was said.
export function usage(method, body) {
  if (method === 'GET') {
    return { status: 200, json: metrics.summary({ provider: configuredProvider() || 'browser' }) };
  }
  if (method !== 'POST') return { status: 405, json: { error: 'method not allowed' } };
  return { status: 201, json: metrics.record(body || {}) };
}

export async function speak(method, body) {
  if (method !== 'POST') return { status: 405, json: { error: 'method not allowed' } };
  const text = body && body.text;
  if (!text) return { status: 400, json: { error: 'text required' } };
  if (!configuredProvider()) return { status: 204, json: {} };   // no key: the page uses the browser voice

  if (!spoken.has(text)) {
    const mp3 = await synthesize(text);
    if (!mp3) return { status: 204, json: {} };
    spoken.set(text, mp3);
  }
  return { status: 200, mp3: spoken.get(text) };
}
