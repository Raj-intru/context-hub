import { Router } from 'express';
import { handler } from '../middleware/errors.js';
import { parseDecimal } from '../ledger/money.js';
import { AUTONOMY_LEVELS } from '../kernel/mandates.js';

/**
 * Mandate administration.
 *
 * Granting authority is a human act. An agent cannot create or widen a mandate
 * — including its own — so this router refuses any caller whose actor type is
 * not `user`. That refusal is the reason a prompt injection cannot escalate:
 * there is no capability for it and no route for it.
 */
export function mandateRoutes({ bank }) {
  const router = Router();

  function requireHuman(req, res, next) {
    if (req.identity.actor.type !== 'user') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Only a person can grant or revoke authority. An agent cannot change its own mandate.',
      });
    }
    return next();
  }

  router.get('/', handler(async (req, res) => {
    const rows = await bank.mandates.list({ entityId: req.identity.entityId });
    res.json({ mandates: rows });
  }));

  router.post('/', requireHuman, handler(async (req, res) => {
    const body = req.body ?? {};
    if (!AUTONOMY_LEVELS.includes(body.autonomy)) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: `autonomy must be one of: ${AUTONOMY_LEVELS.join(', ')}`,
      });
    }

    // Limits arrive as `{ perTransaction: { AUD: "2500.00" } }` and are parsed
    // into Money here, so a malformed limit is rejected at the boundary rather
    // than becoming a limit that silently never matches.
    const limits = {};
    for (const bucket of ['perTransaction', 'daily', 'monthly']) {
      if (!body.limits?.[bucket]) continue;
      limits[bucket] = Object.fromEntries(
        Object.entries(body.limits[bucket]).map(([currency, value]) => [
          currency,
          parseDecimal(value, currency),
        ]),
      );
    }

    let dualControl = null;
    if (body.dualControl) {
      dualControl = {
        requiredApprovals: body.dualControl.requiredApprovals,
        approvers: body.dualControl.approvers ?? [],
        thresholdAbove: body.dualControl.thresholdAbove
          ? Object.fromEntries(
            Object.entries(body.dualControl.thresholdAbove).map(([currency, value]) => [
              currency,
              parseDecimal(value, currency),
            ]),
          )
          : null,
      };
    }

    const mandate = await bank.mandates.create({
      entityId: req.identity.entityId,
      grantee: body.grantee,
      grantedBy: req.identity.actor.id,
      autonomy: body.autonomy,
      capabilities: body.capabilities,
      accounts: body.accounts ?? ['*'],
      limits,
      counterparties: body.counterparties ?? { mode: 'any', ids: [] },
      dualControl,
      window: body.window ?? null,
      label: body.label ?? null,
    });
    return res.status(201).json(mandate);
  }));

  router.delete('/:mandateId', requireHuman, handler(async (req, res) => {
    const existing = await bank.mandates.get(req.params.mandateId);
    if (!existing || existing.entityId !== req.identity.entityId) {
      return res.status(404).json({ error: 'MANDATE_NOT_FOUND' });
    }
    const mandate = await bank.mandates.revoke(
      req.params.mandateId,
      req.identity.actor.id,
      req.body?.reason ?? null,
    );
    return res.json(mandate);
  }));

  router.get('/:mandateId/usage', handler(async (req, res) => {
    const existing = await bank.mandates.get(req.params.mandateId);
    if (!existing || existing.entityId !== req.identity.entityId) {
      return res.status(404).json({ error: 'MANDATE_NOT_FOUND' });
    }
    return res.json(await bank.mandates.usage(req.params.mandateId));
  }));

  return router;
}
