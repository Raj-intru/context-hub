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
process.env.CRON_SECRET = 'test-cron-secret';

// --- Stub external providers -------------------------------------------------
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.openai.com/v1/moderations')) {
    const body = JSON.parse(opts.body || '{}');
    // input is a string (text) or an array of parts (images). Flag on a marker.
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    const flagged = inputs.some((i) => {
      const s = typeof i === 'string' ? i : (i?.image_url?.url || i?.text || '');
      return /BADWORD|BADIMAGE/i.test(s);
    });
    const results = inputs.map(() => ({ flagged, categories: {} }));
    return new Response(JSON.stringify({ results }), { status: 200 });
  }
  if (u.includes('openrouter.ai')) {
    const body = JSON.parse(opts.body || '{}');
    const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === 'user');
    // content is a string, or multimodal content-parts — extract the text part.
    const raw = lastUser?.content;
    const text = typeof raw === 'string' ? raw
      : (Array.isArray(raw) ? (raw.find((p) => p.type === 'text')?.text || '') : '');
    // Simulate a model that emits unsafe OUTPUT for an otherwise-clean prompt,
    // so output moderation (not just input moderation) can be exercised.
    const content = /UNSAFE_OUTPUT/.test(text) ? 'here is a BADWORD reply' : `Echo(${text.slice(0, 20)})`;
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content } }],
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

  // 4b. An image attachment routes an adult turn to a vision-capable model.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  const vision = await call('POST', '/api/chat', { token: parentToken, body: { prompt: 'what is in this image', attachments: [{ url: png }] } });
  assert.equal(vision.status, 200, JSON.stringify(vision.json));
  assert.match(vision.json.model, /gemini-flash|claude-3\.5-sonnet|gpt-4o/, 'should route to a vision model');
  ok('adult image attachment routes to a vision-capable model');

  // 5a. Inviting a child WITHOUT consent is rejected
  const noConsent = await call('POST', '/api/invites', { token: parentToken, body: { firstName: 'Kid', role: 'child' } });
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.json.error, 'CONSENT_REQUIRED');
  ok('minor invite without consent is rejected (400)');

  // 5b. Invite a child WITH consent, accept it
  const consent = await call('GET', '/api/consent-text', { token: parentToken });
  assert.ok(consent.json.version && consent.json.text, 'consent text is served');
  const invite = await call('POST', '/api/invites', { token: parentToken, body: {
    firstName: 'Kid', role: 'child', consentAcknowledged: true, consentVersion: consent.json.version,
  } });
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

  // 7b. Clean prompt, but the model emits unsafe OUTPUT -> the child gets a safe
  // replacement (not the model text), flagged for the dashboard.
  const badOut = await call('POST', '/api/chat', { token: childToken, body: { prompt: 'tell me about UNSAFE_OUTPUT topic' } });
  assert.equal(badOut.status, 200, JSON.stringify(badOut.json));
  assert.equal(badOut.json.blocked, true);
  assert.doesNotMatch(badOut.json.reply, /BADWORD/, 'unsafe model output must not reach a minor');
  ok('supervised child unsafe OUTPUT is replaced with a safe message');

  // 7c. A supervised account cannot pin a paid model (routing is locked).
  const locked = await call('POST', '/api/chat', { token: childToken, body: { prompt: 'hi', model: 'anthropic/claude-3.5-sonnet' } });
  assert.equal(locked.status, 200, JSON.stringify(locked.json));
  assert.notEqual(locked.json.model, 'anthropic/claude-3.5-sonnet');
  ok('supervised model choice is ignored (locked to routed model)');

  // 7d. A child may attach a (clean) image; it routes to the safe vision model.
  const kidImg = await call('POST', '/api/chat', { token: childToken, body: { prompt: 'help me read this worksheet', attachments: [{ url: png }] } });
  assert.equal(kidImg.status, 200, JSON.stringify(kidImg.json));
  assert.match(kidImg.json.model, /gemini-flash/, 'supervised vision routes to the safe simple vision model');
  ok('supervised child image routes to the safe vision model');

  // 7e. An unsafe image attachment is blocked for a minor (image moderation).
  const kidBadImg = await call('POST', '/api/chat', { token: childToken, body: { prompt: 'look at this', attachments: [{ url: 'https://example.com/BADIMAGE.png' }] } });
  assert.equal(kidBadImg.status, 422);
  assert.equal(kidBadImg.json.error, 'SAFETY_VIOLATION');
  ok('supervised child unsafe IMAGE is blocked (422)');

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

  // ---- Data-subject rights: export + erasure ----
  const exp = await call('GET', '/api/me/export', { token: parentToken });
  assert.equal(exp.status, 200, JSON.stringify(exp.json));
  assert.ok(Array.isArray(exp.json.conversations) && exp.json.conversations.length >= 1);
  assert.ok(exp.json.conversations.some((c) => c.messages.some((m) => m.content === 'Hello Lyra')),
    'export includes decrypted own content');
  ok('a user can export their own data (decrypted)');

  // A supervised minor cannot self-delete (guardian action).
  const kidSelfDel = await call('DELETE', '/api/me/account', { token: childToken });
  assert.equal(kidSelfDel.status, 403);
  ok('a minor cannot self-delete (guardian required)');

  // The last admin cannot self-delete and orphan the tenant.
  const parentSelfDel = await call('DELETE', '/api/me/account', { token: parentToken });
  assert.equal(parentSelfDel.status, 409);
  ok('the last admin cannot self-delete');

  // A guardian/admin can erase a member; the account is then gone (session 401).
  const delKid = await call('DELETE', `/api/members/${accept.json.user.id}`, { token: parentToken });
  assert.equal(delKid.status, 200, JSON.stringify(delKid.json));
  const afterDel = await call('GET', '/api/auth/me', { token: childToken });
  assert.equal(afterDel.status, 401);
  ok('an admin can erase a member (data deleted, session invalidated)');

  // Retention cron is authenticated and a no-op when disabled (RETENTION_DAYS=0).
  const retNoAuth = await call('GET', '/api/cron/retention');
  assert.equal(retNoAuth.status, 401);
  const ret = await call('GET', '/api/cron/retention', { token: 'test-cron-secret' });
  assert.equal(ret.status, 200, JSON.stringify(ret.json));
  assert.equal(ret.json.skipped, 'retention_disabled');
  ok('retention cron requires the secret and no-ops when disabled');

  // ---- School: classroom-scoped teacher authority + dashboard scoping ----
  const sSignup = await call('POST', '/api/auth/signup', { body: {
    tenantType: 'school', tenantName: 'E2E School', firstName: 'Adminn',
    email: `it_${uniq}@example.com`, password: 'supersecret',
  } });
  assert.equal(sSignup.status, 201, JSON.stringify(sSignup.json));
  const itToken = sSignup.json.token;

  // IT admin creates two classrooms.
  const roomA = (await call('POST', '/api/groups', { token: itToken, body: { name: 'Room A' } })).json.group;
  const roomB = (await call('POST', '/api/groups', { token: itToken, body: { name: 'Room B' } })).json.group;

  // Helper: invite + accept, returns the new user's token.
  const sConsent = await call('GET', '/api/consent-text', { token: itToken });
  async function inviteAccept(body) {
    const inv = await call('POST', '/api/invites', { token: itToken, body });
    assert.equal(inv.status, 201, JSON.stringify(inv.json));
    const acc = await call('POST', '/api/auth/accept-invite', { body: { token: inv.json.token, password: 'supersecret' } });
    assert.equal(acc.status, 201, JSON.stringify(acc.json));
    return acc.json.token;
  }
  const teacherToken = await inviteAccept({ email: `t_${uniq}@example.com`, firstName: 'Tia', role: 'teacher', groupId: roomA.id });
  const stuA = await inviteAccept({ firstName: 'Sam', role: 'student', groupId: roomA.id, consentAcknowledged: true, consentVersion: sConsent.json.version });
  await inviteAccept({ firstName: 'Bea', role: 'student', groupId: roomB.id, consentAcknowledged: true, consentVersion: sConsent.json.version });

  // Teacher's roster is limited to their own classroom (Room A: teacher + Sam).
  const tMembers = await call('GET', '/api/members', { token: teacherToken });
  assert.equal(tMembers.status, 200, JSON.stringify(tMembers.json));
  assert.ok(tMembers.json.members.every((m) => m.group_id === roomA.id), 'teacher sees only Room A');
  assert.ok(!tMembers.json.members.some((m) => m.first_name === 'Bea'), 'teacher cannot see Room B student');
  ok('teacher roster is scoped to their classroom');

  // Teacher's dashboard is likewise scoped to Room A.
  const tDash = await call('GET', '/api/dashboard', { token: teacherToken });
  assert.equal(tDash.status, 200, JSON.stringify(tDash.json));
  assert.ok(tDash.json.members.every((m) => m.group_id === roomA.id), 'dashboard scoped to Room A');
  assert.ok(!tDash.json.members.some((m) => m.first_name === 'Bea'));
  ok('teacher dashboard is scoped to their classroom');

  // Teacher cannot manage a student in another classroom.
  const bMembers = await call('GET', '/api/members', { token: itToken });
  const bea = bMembers.json.members.find((m) => m.first_name === 'Bea');
  const crossEdit = await call('PATCH', `/api/members/${bea.id}`, { token: teacherToken, body: { monthlyTokenCap: 1 } });
  assert.equal(crossEdit.status, 403);
  ok('teacher cannot manage a student outside their classroom (403)');

  // Teacher cannot invite staff, and cannot touch billing.
  const badInvite = await call('POST', '/api/invites', { token: teacherToken, body: { email: `x_${uniq}@e.com`, role: 'teacher' } });
  assert.equal(badInvite.status, 403);
  const teacherCheckout = await call('POST', '/api/billing/checkout', { token: teacherToken, body: { priceId: 'price_x' } });
  assert.equal(teacherCheckout.status, 403);
  ok('teacher cannot invite staff or manage billing (403)');

  void stuA;
  console.log(`\nE2E: ${passed} checks passed ✅`);
} catch (err) {
  console.error('\nE2E FAILED:', err);
  process.exitCode = 1;
} finally {
  server.close();
}
