import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptContent, decryptContent } from '../src/crypto/content.js';
import { hashPassword, verifyPassword } from '../src/crypto/password.js';

test('content encryption round-trips and is not plaintext', async () => {
  const secret = 'My child asked: how do photosynthesis reactions work? 🌱';
  const blob = await encryptContent(secret);
  assert.ok(Buffer.isBuffer(blob));
  // Ciphertext must not contain the plaintext bytes.
  assert.ok(!blob.toString('utf8').includes('photosynthesis'));
  const back = await decryptContent(blob);
  assert.equal(back, secret);
});

test('tampered ciphertext fails authentication', async () => {
  const blob = await encryptContent('sensitive');
  blob[blob.length - 1] ^= 0xff; // flip a bit in the ciphertext
  await assert.rejects(() => decryptContent(blob));
});

test('password hashing verifies correct and rejects wrong', async () => {
  const hash = await hashPassword('correcthorse');
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword('correcthorse', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('password hashing rejects too-short passwords', async () => {
  await assert.rejects(() => hashPassword('short'));
});
