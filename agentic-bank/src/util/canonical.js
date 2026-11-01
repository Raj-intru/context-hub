import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted at every depth, so the same logical
 * value always produces the same bytes and therefore the same hash. The audit
 * chain depends on this — a stringify that preserved insertion order would make
 * the chain unverifiable after a round-trip through a store that reorders keys.
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Cannot canonicalise a non-finite number');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalise);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    out[key] = canonicalise(value[key]);
  }
  return out;
}

export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function hashRecord(value) {
  return sha256(canonicalJson(value));
}
