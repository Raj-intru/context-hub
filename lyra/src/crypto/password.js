// Password hashing with Node's built-in scrypt (no external dependency).
// Format: scrypt$N$r$p$saltHex$hashHex  — self-describing so parameters can
// evolve without breaking existing hashes.

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

const N = 16384; // CPU/memory cost
const r = 8;
const p = 1;
const KEYLEN = 32;

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(password, salt, expected.length, {
    N: Number(nStr), r: Number(rStr), p: Number(pStr), maxmem: 64 * 1024 * 1024,
  });
  // Constant-time comparison.
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}
