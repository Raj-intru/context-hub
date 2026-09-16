// Real encryption-at-rest for chat content.
//
// Pipeline:  plaintext --gzip--> compressed --AES-256-GCM--> ciphertext
// Stored as a single BYTEA:  iv(12) || authTag(16) || ciphertext
//
// This is genuine confidentiality: without CONTENT_ENCRYPTION_KEY the database
// bytes are unreadable. (The uploaded blueprint only gzip-compressed content
// and mislabelled it "encryption" — gzip is trivially reversible.)

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import config from '../config.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const IV_LEN = 12;   // GCM standard nonce length
const TAG_LEN = 16;

function key() {
  const k = Buffer.from(config.contentEncryptionKey, 'hex');
  if (k.length !== 32) {
    throw new Error('CONTENT_ENCRYPTION_KEY must decode to 32 bytes (64 hex chars)');
  }
  return k;
}

/** Encrypt a UTF-8 string. Returns a Buffer suitable for a BYTEA column. */
export async function encryptContent(plaintext) {
  const compressed = await gzip(Buffer.from(String(plaintext), 'utf8'));
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/** Decrypt a Buffer produced by encryptContent back to the original string. */
export async function decryptContent(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (data.length < IV_LEN + TAG_LEN) {
    throw new Error('ciphertext too short / corrupt');
  }
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = data.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const plaintext = await gunzip(compressed);
  return plaintext.toString('utf8');
}
