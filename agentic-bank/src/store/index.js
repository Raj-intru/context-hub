// Store selection.
//
// Every other module takes a store as a constructor argument; nothing imports a
// backend directly. That is what makes the kernel testable without a database
// and swappable onto a real core-banking system later: a bank adopting this
// would implement this interface over its existing core rather than migrate to
// the ledger in src/ledger/.

import { createMemoryStore } from './memory.js';

export async function createStore(config) {
  if (config.store === 'postgres') {
    const { createPostgresStore } = await import('./postgres.js');
    return createPostgresStore(config);
  }
  return createMemoryStore();
}
