// Hash-chained audit log.
//
// An agentic bank is only supervisable if every decision can be replayed. Each
// record commits to the one before it, so a record cannot be altered or removed
// after the fact without breaking every hash that follows — which `verify()`
// detects. This is tamper *evidence*, not tamper proofing: anyone who can
// rewrite the whole table can rebuild the chain. Pair it with an external
// anchor (append-only object storage, or a periodic digest published
// elsewhere) before claiming anything stronger.

import { hashRecord } from '../util/canonical.js';
import { newId } from '../util/ids.js';

export const GENESIS = '0'.repeat(64);

export function createAudit({ store, clock }) {
  return {
    /**
     * Append a record. Must run inside the same store transaction as the thing
     * it describes, so a failed posting cannot leave an audit record claiming
     * it happened — pass the transaction handle as `tx`.
     */
    async append(tx, { type, actor, subject, payload = {}, outcome = null }) {
      // `auditHead` is a dedicated store method rather than a scan of every
      // record: reading the whole table per append is O(n^2) over the life of
      // the bank, and on Postgres the head row is locked for the rest of the
      // transaction, which serialises concurrent appends so two of them cannot
      // commit the same `seq` with the same `prevHash`. The unique index on
      // `seq` is the backstop if that lock is ever absent.
      const head = await tx.auditHead();
      const seq = (head?.seq ?? 0) + 1;
      const prevHash = head?.hash ?? GENESIS;

      const body = {
        seq,
        at: clock.now().toISOString(),
        type,
        actor,
        subject,
        outcome,
        payload,
        prevHash,
      };
      const record = { id: newId('audit'), ...body, hash: hashRecord(body) };
      await tx.insert('audit', record);
      return record;
    },

    async list({ subjectId = null, limit = 100 } = {}) {
      const all = await store.all('audit');
      all.sort((a, b) => a.seq - b.seq);
      const filtered = subjectId
        ? all.filter((r) => r.subject?.id === subjectId)
        : all;
      return filtered.slice(-limit);
    },

    /** Recompute the chain. Returns the first break, if any. */
    async verify() {
      const all = await store.all('audit');
      all.sort((a, b) => a.seq - b.seq);
      let prevHash = GENESIS;
      for (const record of all) {
        const { id, hash, ...body } = record;
        if (body.prevHash !== prevHash) {
          return { ok: false, brokenAt: body.seq, reason: 'PREV_HASH_MISMATCH', records: all.length };
        }
        if (hashRecord(body) !== hash) {
          return { ok: false, brokenAt: body.seq, reason: 'CONTENT_ALTERED', records: all.length };
        }
        prevHash = hash;
      }
      return { ok: true, records: all.length, head: prevHash };
    },
  };
}
