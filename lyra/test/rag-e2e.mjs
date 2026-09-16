// Live RAG end-to-end against real Postgres + pgvector, providers stubbed.
// Proves: grounded answers cite the tenant's own sources, out-of-scope refuses,
// and retrieval is ISOLATED per tenant (School B never sees School A's chunks).
//   DATABASE_URL=postgres://lyra_app:...@host/db node test/rag-e2e.mjs

import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'development';
process.env.OPENROUTER_API_KEY = 'test-openrouter';
process.env.OPENAI_API_KEY = 'test-openai';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';
process.env.CONTENT_ENCRYPTION_KEY = '33'.repeat(32);

const { embedLexical } = await import('../src/services/embeddings.js');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.openai.com/v1/moderations')) {
    return new Response(JSON.stringify({ results: [{ flagged: false, categories: {} }] }), { status: 200 });
  }
  if (u.includes('api.openai.com/v1/embeddings')) {
    const body = JSON.parse(opts.body || '{}');
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return new Response(JSON.stringify({ data: inputs.map((t) => ({ embedding: embedLexical(t) })) }), { status: 200 });
  }
  if (u.includes('openrouter.ai')) {
    return new Response(JSON.stringify({ model: 'demo', choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 50 } }), { status: 200 });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return realFetch(url, opts);
  throw new Error(`unexpected external fetch: ${u}`);
};

const { createApp } = await import('../src/app.js');
const server = await new Promise((res) => { const s = createApp().listen(0, () => res(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

function call(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`${base}${path}`, { method, headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ status: r.statusCode, json: b ? JSON.parse(b) : {} })); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const signupSchool = async (name) => (await call('POST', '/api/auth/signup', { body: {
  tenantType: 'school', tenantName: name, firstName: 'Admin', email: `a_${Date.now()}_${Math.random().toString(36).slice(2,6)}@ex.com`, password: 'supersecret',
} })).json.token;

let passed = 0; const ok = (m) => { console.log('  ✓', m); passed++; };
try {
  const a = await signupSchool('School A');
  const b = await signupSchool('School B');

  // Each school ingests its OWN, different material.
  await call('POST', '/api/knowledge/sources', { token: a, body: {
    title: 'A — Adding Fractions',
    text: '# Adding fractions with the same denominator\nKeep the denominator and add the numerators.' } });
  await call('POST', '/api/knowledge/sources', { token: b, body: {
    title: 'B — Ancient Rome',
    text: '# The Roman Republic\nRome was governed by elected consuls and a senate.' } });
  ok('each school ingested its own source');

  const ask = (t, prompt) => call('POST', '/api/chat', { token: t, body: { prompt } });

  // A asks an in-scope question → cited from A's own source.
  const a1 = await ask(a, 'how do I add fractions with the same denominator?');
  assert.equal(a1.status, 200);
  assert.ok(a1.json.citations.length >= 1, 'A gets a citation');
  assert.match(a1.json.citations[0].source, /Adding Fractions/);
  ok('School A gets a grounded citation from its own material');

  // A asks out-of-scope → no citation (grounded prompt would refuse).
  const a2 = await ask(a, 'who won the 2049 football world cup?');
  assert.equal(a2.json.citations.length, 0);
  ok('School A out-of-scope question yields no citation (refusal path)');

  // ISOLATION: B asks A's fractions question → must NOT retrieve A's chunk.
  const b1 = await ask(b, 'how do I add fractions with the same denominator?');
  assert.equal(b1.json.citations.length, 0, 'B must not see A\'s fractions chunk');
  ok('School B CANNOT retrieve School A\'s chunks (RLS isolation)');

  // B asks its own in-scope question → cited from B's source only.
  const b2 = await ask(b, 'who governed the Roman Republic?');
  assert.ok(b2.json.citations.length >= 1 && /Ancient Rome/.test(b2.json.citations[0].source), 'B cites its own source');
  ok('School B gets a grounded citation from ITS own material');

  console.log(`\nRAG E2E: ${passed} checks passed ✅`);
} catch (e) {
  console.error('\nRAG E2E FAILED:', e); process.exitCode = 1;
} finally { server.close(); }
