// End-to-end smoke test against a real Postgres + the real Express app, with
// external AI providers stubbed via a patched global fetch. Run directly:
//   node test/e2e.mjs
// Requires env: DATABASE_URL (lyra_app role). Sets dev secrets itself.

import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'development';
process.env.OPENROUTER_API_KEY = 'test-openrouter';
process.env.OPENAI_API_KEY = 'test-openai';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';
process.env.CONTENT_ENCRYPTION_KEY = '11'.repeat(32);

// --- Stub external providers -------------------------------------------------
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.openai.com/v1/moderations')) {
    const body = JSON.parse(opts.body || '{}');
    const flagged = /BADWORD/i.test(body.input || '');
    return new Response(JSON.stringify({ results: [{ flagged, categories: {} }] }), { status: 200 });
  }
  if (u.includes('openrouter.ai')) {
    const body = JSON.parse(opts.body || '{}');
    const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === 'user');
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: `Echo(${lastUser?.content?.slice(0, 20) || ''})` } }],
      usage: { total_tokens: 123 },
    }), { status: 200 });
  }
  // Allow loopback (our own server) through the real fetch.
  if (u.includes('127.0.0.1') || u.includes('localhost')) return realFetch(url, opts);
  throw new Error(`unexpected external fetch: ${u}`);
};

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

function call(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : {} }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0;
const ok = (label) => { console.log('  ✓', label); passed++; };

try {
  // 1. Family signup -> parent_admin session
  const uniq = Date.now();
  const signup = await call('POST', '/api/auth/signup', { body: {
    tenantType: 'family', tenantName: 'E2E Family', firstName: 'Pat',
    email: `pat_${uniq}@example.com`, password: 'supersecret',
  } });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  const parentToken = signup.json.token;
  assert.equal(signup.json.user.role, 'parent_admin');
  ok('family signup creates a parent_admin');

  // 2. /me
  const me = await call('GET', '/api/auth/me', { token: parentToken });
  assert.equal(me.json.user.role, 'parent_admin');
  ok('authenticated /me works');

  // 3. Parent chat (direct persona) is stored + returns a reply
  const chat1 = await call('POST', '/api/chat', { token: parentToken, body: { prompt: 'Hello Lyra' } });
  assert.equal(chat1.status, 200, JSON.stringify(chat1.json));
  assert.match(chat1.json.reply, /Echo\(Hello Lyra\)/);
  assert.equal(chat1.json.tokensUsed, 123);
  ok('parent chat proxies + records tokens');

  // 4. History is retrievable and decrypts correctly
  const msgs = await call('GET', `/api/conversations/${chat1.json.conversationId}/messages`, { token: parentToken });
  assert.equal(msgs.json.messages.length, 2);
  assert.equal(msgs.json.messages[0].content, 'Hello Lyra');
  ok('encrypted history round-trips via API');

  // 5. Invite a child, accept it
  const invite = await call('POST', '/api/invites', { token: parentToken, body: { firstName: 'Kid', role: 'child' } });
  assert.equal(invite.status, 201, JSON.stringify(invite.json));
  const accept = await call('POST', '/api/auth/accept-invite', { body: {
    token: invite.json.token, firstName: 'Kid', password: 'kidsecret',
  } });
  assert.equal(accept.status, 201);
  const childToken = accept.json.token;
  assert.equal(accept.json.user.role, 'child');
  ok('parent invites a child and child activates');

  // 6. Child clean prompt -> Socratic path succeeds
  const childChat = await call('POST', '/api/chat', { token: childToken, body: { prompt: 'help me learn fractions' } });
  assert.equal(childChat.status, 200, JSON.stringify(childChat.json));
  ok('supervised child chat passes moderation and replies');

  // 7. Child unsafe prompt -> blocked 422
  const bad = await call('POST', '/api/chat', { token: childToken, body: { prompt: 'this contains BADWORD' } });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, 'SAFETY_VIOLATION');
  ok('supervised child unsafe prompt is blocked (422)');

  // 8. Child cannot read parent's conversation (ownership/RLS)
  const steal = await call('GET', `/api/conversations/${chat1.json.conversationId}/messages`, { token: childToken });
  assert.equal(steal.status, 404);
  ok('child cannot read another member\'s conversation');

  // 9. Child cannot hit admin dashboard
  const forbidden = await call('GET', '/api/dashboard', { token: childToken });
  assert.equal(forbidden.status, 403);
  ok('non-admin is forbidden from the dashboard');

  // 10. Parent dashboard shows aggregates incl. the flagged event, no content
  const dash = await call('GET', '/api/dashboard', { token: parentToken });
  assert.equal(dash.status, 200);
  const kid = dash.json.members.find((m) => m.role === 'child');
  assert.ok(kid && Number(kid.flagged_this_period) >= 1, 'flagged event visible in aggregate');
  assert.ok(!JSON.stringify(dash.json).includes('fractions'), 'dashboard must not contain chat text');
  ok('admin dashboard shows aggregates + flag count, never chat text');

  // 11. Unauthenticated chat rejected
  const noauth = await call('POST', '/api/chat', { body: { prompt: 'hi' } });
  assert.equal(noauth.status, 401);
  ok('unauthenticated requests are rejected');

  console.log(`\nE2E: ${passed} checks passed ✅`);
} catch (err) {
  console.error('\nE2E FAILED:', err);
  process.exitCode = 1;
} finally {
  server.close();
}
