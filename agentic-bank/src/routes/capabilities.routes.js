import { Router } from 'express';
import { handler } from '../middleware/errors.js';
import { requireEntityMatch } from '../middleware/auth.js';

export function capabilityRoutes({ bank }) {
  const router = Router();

  router.get('/', handler(async (req, res) => {
    const entity = await bank.store.get('entities', req.identity.entityId);
    res.json({ capabilities: bank.registry.catalogue({ segment: entity?.segment ?? null }) });
  }));

  /** What would happen, without anything happening. */
  router.post('/:capabilityId/preview', requireEntityMatch, handler(async (req, res) => {
    const outcome = await bank.kernel.preview({
      entityId: req.entityId,
      capabilityId: req.params.capabilityId,
      args: req.body?.args ?? {},
      initiator: req.identity.actor,
    });
    res.json(renderOutcome(outcome));
  }));

  /** The direct API path. Same kernel, same controls, no shortcuts. */
  router.post('/:capabilityId/execute', requireEntityMatch, handler(async (req, res) => {
    const outcome = await bank.kernel.submit({
      entityId: req.entityId,
      capabilityId: req.params.capabilityId,
      args: req.body?.args ?? {},
      initiator: req.identity.actor,
      idempotencyKey: req.get('idempotency-key') ?? null,
    });
    res.status(outcome.status === 'denied' ? 403 : 200).json(renderOutcome(outcome));
  }));

  return router;
}

export function renderOutcome(outcome) {
  return {
    status: outcome.status,
    explanation: outcome.explanation,
    proposalId: outcome.proposal?.id ?? null,
    summary: outcome.proposal?.summary ?? null,
    result: outcome.result ?? null,
    valueDate: outcome.decision?.valueDate ?? null,
    decision: outcome.decision
      ? {
        outcome: outcome.decision.outcome,
        policyVersion: outcome.decision.policyVersion,
        reasons: outcome.decision.reasons.map((r) => ({
          code: r.code,
          severity: r.severity,
          message: r.message,
        })),
      }
      : null,
    approval: outcome.approval
      ? {
        id: outcome.approval.id,
        required: outcome.approval.required,
        approvers: outcome.approval.approvers,
        expiresAt: outcome.approval.expiresAt,
      }
      : null,
    replayed: outcome.replayed ?? false,
  };
}
