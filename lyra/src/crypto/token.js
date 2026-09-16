// Minimal, dependency-free JWT (HS256) for session tokens.
// Payload carries the user id, tenant id, role, and token_version. Revocation
// works by bumping users.token_version (any token with a stale version fails).

import crypto from 'node:crypto';
import config from '../config.js';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function fromB64url(str) {
  return Buffer.from(str, 'base64url');
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/** Create a signed session token. `claims` should include sub, tenant, role, ver. */
export function issueToken(claims, ttlSeconds = config.sessionTtlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...claims, iat: now, exp: now + ttlSeconds };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payload));
  const signature = sign(`${encHeader}.${encPayload}`, config.jwtSecret);
  return `${encHeader}.${encPayload}.${signature}`;
}

/** Verify and decode a session token. Throws on any failure. */
export function verifyToken(token) {
  if (typeof token !== 'string') throw new Error('no token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [encHeader, encPayload, signature] = parts;
  const expected = sign(`${encHeader}.${encPayload}`, config.jwtSecret);
  const a = fromB64url(signature);
  const b = fromB64url(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('bad signature');
  }
  const payload = JSON.parse(fromB64url(encPayload).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new Error('token expired');
  }
  return payload;
}
