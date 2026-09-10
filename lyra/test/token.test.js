import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueToken, verifyToken } from '../src/crypto/token.js';

test('issued token verifies and carries claims', () => {
  const token = issueToken({ sub: 'u1', tenant: 't1', role: 'child', ver: 0 });
  const claims = verifyToken(token);
  assert.equal(claims.sub, 'u1');
  assert.equal(claims.tenant, 't1');
  assert.equal(claims.role, 'child');
});

test('tampered token is rejected', () => {
  const token = issueToken({ sub: 'u1', tenant: 't1', role: 'child', ver: 0 });
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ sub: 'attacker', tenant: 't1', role: 'parent_admin', exp: 9999999999 })).toString('base64url');
  await_reject(() => verifyToken(parts.join('.')));
});

test('expired token is rejected', () => {
  const token = issueToken({ sub: 'u1', tenant: 't1', role: 'child', ver: 0 }, -10);
  await_reject(() => verifyToken(token));
});

function await_reject(fn) {
  assert.throws(fn);
}
