import { Router } from 'express';
import { handler } from '../middleware/errors.js';
import { productionReadiness } from '../config.js';

/**
 * Supervision endpoints.
 *
 * These are the ones a second line of defence or a regulator asks for: show me
 * the decision log, prove it has not been altered, prove the ledger balances.
 */
export function adminRoutes({ bank }) {
  const router = Router();

  router.get('/audit', handler(async (req, res) => {
    const records = await bank.audit.list({
      subjectId: req.query.subjectId ?? null,
      limit: Math.min(Number(req.query.limit ?? 100), 500),
    });
    // Scoped to the caller's own customer unless it is a bank-side identity.
    const scoped = records.filter(
      (r) => !r.payload?.entityId || r.payload.entityId === req.identity.entityId,
    );
    res.json({ records: scoped });
  }));

  router.get('/audit/verify', handler(async (_req, res) => {
    res.json(await bank.audit.verify());
  }));

  router.get('/integrity', handler(async (_req, res) => {
    const journal = await bank.ledger.verifyJournal();
    const accounts = await bank.store.all('accounts');
    const balances = [];
    for (const account of accounts) {
      const check = await bank.ledger.verifyBalance(account.id);
      if (!check.ok) balances.push(check);
    }
    res.json({
      journal,
      balanceMismatches: balances,
      auditChain: await bank.audit.verify(),
      ok: journal.ok && balances.length === 0,
    });
  }));

  router.get('/readiness', handler(async (_req, res) => {
    res.json(productionReadiness(bank.config));
  }));

  return router;
}
