// In-process store. Serialised transactions, snapshot rollback.
//
// This is the default backend so `npm start`, `npm test` and the demo run with
// no database. It is NOT a backend for real balances — it has no durability and
// no cross-process visibility. See src/store/postgres.js and db/schema.sql.

import { AsyncLocalStorage } from 'node:async_hooks';

/** Carries the active transaction handle so nested calls can join it. */
const transactionContext = new AsyncLocalStorage();

const TABLES = [
  'entities',        // legal entities / customers (consumer, business, institutional)
  'users',           // human principals
  'agents',          // AI agents acting for an entity
  'accounts',        // ledger accounts
  'balances',        // cached cleared/held balance per account (derived from postings)
  'transactions',    // balanced groups of postings
  'postings',        // append-only double-entry lines
  'holds',           // authorisations reducing available balance
  'counterparties',  // payees, with screening state
  'mandates',        // delegated authority grants
  'proposals',       // what an agent wants to do, before it is allowed to
  'approvals',       // human decisions on proposals
  'audit',           // hash-chained decision log
  'idempotency',     // request key -> stored response
  'rates',           // FX rate book
  'instruments',     // trade finance / facilities
];

class Mutex {
  #queue = Promise.resolve();
  run(fn) {
    const result = this.#queue.then(fn, fn);
    // Keep the chain alive regardless of outcome, but don't swallow the error.
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function clone(value) {
  return structuredClone(value);
}

export function createMemoryStore() {
  const tables = new Map(TABLES.map((name) => [name, new Map()]));
  const mutex = new Mutex();

  function table(name) {
    const t = tables.get(name);
    if (!t) throw new Error(`Unknown table: ${name}`);
    return t;
  }

  const reader = {
    async get(name, id) {
      const row = table(name).get(id);
      return row ? clone(row) : null;
    },
    async all(name) {
      return [...table(name).values()].map(clone);
    },
    async find(name, match = {}) {
      const entries = Object.entries(match);
      const out = [];
      for (const row of table(name).values()) {
        if (entries.every(([k, v]) => row[k] === v)) out.push(clone(row));
      }
      return out;
    },
    async findOne(name, match = {}) {
      const rows = await reader.find(name, match);
      return rows[0] ?? null;
    },
    async count(name, match = {}) {
      return (await reader.find(name, match)).length;
    },
    /** Highest-seq audit record, or null. See src/kernel/audit.js. */
    async auditHead() {
      let head = null;
      for (const row of table('audit').values()) {
        if (!head || row.seq > head.seq) head = row;
      }
      return head ? clone(head) : null;
    },
  };

  const writer = {
    ...reader,
    async insert(name, row) {
      if (!row?.id) throw new Error(`insert(${name}) requires an id`);
      const t = table(name);
      if (t.has(row.id)) {
        const err = new Error(`Duplicate id in ${name}: ${row.id}`);
        err.code = 'STORE_DUPLICATE';
        throw err;
      }
      t.set(row.id, clone(row));
      return clone(row);
    },
    async put(name, row) {
      if (!row?.id) throw new Error(`put(${name}) requires an id`);
      table(name).set(row.id, clone(row));
      return clone(row);
    },
    async update(name, id, patch) {
      const t = table(name);
      const existing = t.get(id);
      if (!existing) throw new Error(`No ${name} row with id ${id}`);
      const next = { ...existing, ...clone(patch), id };
      t.set(id, next);
      return clone(next);
    },
    async remove(name, id) {
      return table(name).delete(id);
    },
  };

  return {
    kind: 'memory',

    /** Read outside a transaction. */
    ...reader,

    /**
     * Run `fn` as an atomic unit. Transactions are fully serialised, so there
     * is no isolation level to reason about and no lost update. On throw, every
     * table is restored to its pre-transaction contents.
     *
     * Re-entrant: a `withTransaction` called from inside one joins the
     * enclosing transaction instead of deadlocking on the mutex. That is what
     * lets the kernel wrap "record the decision, post the entries, write the
     * audit record" in a single atomic unit even though the ledger opens a
     * transaction of its own — so there is no window in which money has moved
     * but the audit log does not say so.
     */
    async withTransaction(fn) {
      const enclosing = transactionContext.getStore();
      if (enclosing) return fn(enclosing);

      return mutex.run(async () => {
        const snapshot = new Map([...tables].map(([name, t]) => [name, new Map(t)]));
        try {
          return await transactionContext.run(writer, () => fn(writer));
        } catch (err) {
          for (const [name, t] of snapshot) tables.set(name, t);
          throw err;
        }
      });
    },

    async healthcheck() {
      return { ok: true, backend: 'memory' };
    },

    async close() {},

    /** Test/demo helper: wipe everything. */
    async reset() {
      for (const name of TABLES) tables.set(name, new Map());
    },
  };
}

export { TABLES };
