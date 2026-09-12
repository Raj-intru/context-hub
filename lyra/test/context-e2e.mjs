// Live E2E: a family selects which shared curriculum packs their child's tutor
// may use. Proves the tutor is grounded in ONLY the selected packs, refuses
// outside them, and that removing a pack removes the context.
// Requires the AU curriculum library to be seeded (scripts/ingest-au-curriculum.js).
//   DATABASE_URL=... node test/context-e2e.mjs

import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'development';
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENAI_API_KEY = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';
process.env.CONTENT_ENCRYPTION_KEY = '44'.repeat(32);

const { embedLexical } = await import('../src/services/embeddings.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/v1/moderations')) return new Response(JSON.stringify({ results: [{ flagged: false, categories: {} }] }), { status: 200 });
  if (u.includes('/v1/embeddings')) {
    const inputs = (() => { const b = JSON.parse(opts.body || '{}'); return Array.isArray(b.input) ? b.input : [b.input]; })();
    return new Response(JSON.stringify({ data: inputs.map((t) => ({ embedding: embedLexical(t) })) }), { status: 200 });
  }
  if (u.includes('openrouter.ai')) return new Response(JSON.stringify({ model: 'demo', choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 40 } }), { status: 200 });
  if (u.includes('127.0.0.1') || u.includes('localhost')) return realFetch(url, opts);
  throw new Error(`unexpected external fetch: ${u}`);
};

// Seed the curriculum library in-process so it's encrypted with THIS run's key.
const { withUser } = await import('../src/db.js');
const { ingestSource } = await import('../src/services/ingest.js');
const { libraryContext, LIBRARY_TENANT_ID } = await import('../src/domain/library.js');
const { AU_PACKS } = await import('../scripts/data/au-curriculum-sample.js');
await withUser(libraryContext(), async (c) => {
  await c.query('DELETE FROM knowledge_sources WHERE scope_key = ANY($1::text[])', [AU_PACKS.map((p) => p.scopeKey)]);
  for (const p of AU_PACKS) {
    await ingestSource(c, { tenantId: LIBRARY_TENANT_ID, createdBy: null, title: p.title,
      subject: p.subject, yearLevel: p.yearLevel, scopeKey: p.scopeKey, kind: 'curriculum',
      license: 'test', text: p.text, preferLexical: true });
  }
});

const { createApp } = await import('../src/app.js');
const server = await new Promise((res) => { const s = createApp().listen(0, () => res(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
function call(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`${base}${path}`, { method, headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ status: r.statusCode, json: b ? JSON.parse(b) : {} })); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

let passed = 0; const ok = (m) => { console.log('  ✓', m); passed++; };
try {
  const uniq = Date.now();
  const parent = (await call('POST', '/api/auth/signup', { body: {
    tenantType: 'family', tenantName: 'Ctx Family', firstName: 'Pat', email: `p_${uniq}@ex.com`, password: 'supersecret' } })).json.token;

  // Shared packs are discoverable
  const scopes = await call('GET', '/api/scopes', { token: parent });
  assert.ok(scopes.json.scopes.some((s) => s.scope_key === 'au:year4:maths'), 'AU maths pack listed');
  ok('shared curriculum packs are listed');

  // Invite + activate a child
  const inv = await call('POST', '/api/invites', { token: parent, body: {
    firstName: 'Kid', role: 'child', consentAcknowledged: true, consentVersion: 'minor-provisioning-v1' } });
  const child = (await call('POST', '/api/auth/accept-invite', { body: {
    token: inv.json.token, firstName: 'Kid', password: 'kidsecret' } })).json.token;
  const childId = (await call('GET', '/api/auth/me', { token: child })).json.user.id;

  // Before any selection: no grounding (family offered no context yet)
  const before = await call('POST', '/api/chat', { token: child, body: { prompt: 'how do I add fractions with the same denominator?' } });
  assert.equal(before.json.citations.length, 0);
  ok('with no context selected, the tutor is ungrounded (no citations)');

  // Parent enables the AU Year 4 Maths pack for the child
  const put = await call('PUT', `/api/children/${childId}/context`, { token: parent, body: { yearLevel: 'Year 4', scopeKeys: ['au:year4:maths'] } });
  assert.equal(put.status, 200);
  ok('parent enables the AU Year 4 Maths pack for the child');

  // In-scope question → grounded citation from the selected pack
  const inScope = await call('POST', '/api/chat', { token: child, body: { prompt: 'how do I add fractions with the same denominator?' } });
  assert.ok(inScope.json.citations.length >= 1 && /Year 4 Mathematics/.test(inScope.json.citations[0].source), 'cited the AU maths pack');
  ok('in-scope question is grounded in the selected curriculum pack');

  // Out-of-selection question → refuses (English/science not enabled)
  const outScope = await call('POST', '/api/chat', { token: child, body: { prompt: 'what makes a persuasive text convincing?' } });
  assert.equal(outScope.json.citations.length, 0, 'unselected subject is out of scope');
  ok('a topic outside the selected packs is refused');

  // Parent removes the pack → context goes away
  await call('PUT', `/api/children/${childId}/context`, { token: parent, body: { scopeKeys: [] } });
  const removed = await call('POST', '/api/chat', { token: child, body: { prompt: 'how do I add fractions with the same denominator?' } });
  assert.equal(removed.json.citations.length, 0);
  ok('removing the pack removes the context (parent stays in control)');

  console.log(`\nContext-selection E2E: ${passed} checks passed ✅`);
} catch (e) { console.error('\nContext E2E FAILED:', e); process.exitCode = 1; } finally { server.close(); }
