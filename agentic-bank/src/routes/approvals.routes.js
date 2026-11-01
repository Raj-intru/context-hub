import { Router } from 'express';
import { handler } from '../middleware/errors.js';
import { renderOutcome } from './capabilities.routes.js';

export function approvalRoutes({ bank }) {
  const router = Router();

  router.get('/approvals', handler(async (req, res) => {
    const pending = await bank.approvals.pending({ entityId: req.identity.entityId });
    const rows = [];
    for (const approval of pending) {
      const proposal = await bank.kernel.getProposal(approval.proposalId);
      rows.push({
        approvalId: approval.id,
        proposalId: approval.proposalId,
        summary: proposal?.summary ?? null,
        amount: proposal?.amount ?? null,
        required: approval.required,
        received: approval.decisions.filter((d) => d.decision === 'approve').length,
        approvers: approval.approvers,
        // Who asked for it — the thing an approver most needs to see.
        requestedBy: approval.initiator,
        reasons: approval.reasons.map((r) => ({ code: r.code, message: r.message })),
        expiresAt: approval.expiresAt,
        youMayApprove:
          approval.approvers.includes(req.identity.actor.id)
          && !(approval.initiator?.type === 'user' && approval.initiator.id === req.identity.actor.id)
          && !approval.decisions.some((d) => d.userId === req.identity.actor.id),
      });
    }
    res.json({ pending: rows });
  }));

  router.post('/approvals/:approvalId/decision', handler(async (req, res) => {
    if (req.identity.actor.type !== 'user') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Only a person can approve an instruction. An agent cannot approve its own work.',
      });
    }
    const { decision, comment = null } = req.body ?? {};
    const approval = await bank.approvals.decide({
      approvalId: req.params.approvalId,
      userId: req.identity.actor.id,
      decision,
      comment,
    });

    // A fully-approved instruction is released immediately, and re-checked
    // against current conditions as it goes.
    let execution = null;
    if (approval.status === 'approved') {
      execution = await bank.kernel.executeApproved({
        proposalId: approval.proposalId,
        actor: req.identity.actor,
      });
    }

    return res.json({
      approvalId: approval.id,
      status: approval.status,
      received: approval.decisions.filter((d) => d.decision === 'approve').length,
      required: approval.required,
      execution: execution
        ? { status: execution.status, result: execution.result, proposalId: approval.proposalId }
        : null,
    });
  }));

  router.get('/proposals', handler(async (req, res) => {
    const proposals = await bank.kernel.listProposals({
      entityId: req.identity.entityId,
      status: req.query.status ?? null,
    });
    res.json({
      proposals: proposals
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((p) => ({
          id: p.id,
          capabilityId: p.capabilityId,
          summary: p.summary,
          amount: p.amount,
          status: p.status,
          createdAt: p.createdAt,
          decisionOutcome: p.decision?.outcome ?? null,
        })),
    });
  }));

  router.get('/proposals/:proposalId', handler(async (req, res) => {
    const proposal = await bank.kernel.getProposal(req.params.proposalId);
    if (!proposal || proposal.entityId !== req.identity.entityId) {
      return res.status(404).json({ error: 'PROPOSAL_NOT_FOUND' });
    }
    return res.json(proposal);
  }));

  return router;
}
