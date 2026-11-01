import { randomUUID, randomBytes } from 'node:crypto';

const PREFIXES = {
  entity: 'ent', user: 'usr', agent: 'agt', account: 'acc', transaction: 'txn',
  posting: 'pst', hold: 'hld', counterparty: 'cpt', mandate: 'mdt',
  proposal: 'prp', approval: 'apv', audit: 'aud', turn: 'trn', quote: 'qte',
  instrument: 'ins', session: 'ses',
};

/** Prefixed, sortable-enough identifiers. The prefix makes audit logs readable. */
export function newId(kind) {
  const prefix = PREFIXES[kind];
  if (!prefix) throw new Error(`Unknown id kind: ${kind}`);
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/** A client-supplied idempotency key, when the client did not supply one. */
export function newIdempotencyKey() {
  return `idem_${randomBytes(16).toString('hex')}`;
}
