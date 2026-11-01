// N-of-M approval with segregation of duties.
//
// "Two approvals" means two different people, neither of whom asked for the
// thing. The initiator of a proposal can never approve it, even when they are
// on the approver list — otherwise dual control is one person clicking twice.

import { newId } from '../util/ids.js';

export class ApprovalError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_TTL_HOURS = 24;

export function createApprovals({ store, clock, audit }) {
  function isExpired(approval, now) {
    return approval.expiresAt ? new Date(approval.expiresAt) <= now : false;
  }

  return {
    /** Open an approval request. Runs inside the submitting transaction. */
    async open(tx, { proposal, decision, ttlHours = DEFAULT_TTL_HOURS }) {
      const now = clock.now();

      // A mandate's dual-control block names its approvers. Where the approval
      // came from somewhere else — a screening hit, a suspected duplicate, a
      // high-risk action outside the mandate's unattended scope — nobody is
      // named, and an approval nobody is authorised to action is an instruction
      // that silently expires. Fall back to the customer's own approvers.
      let approvers = decision.requirements.approvers ?? [];
      if (approvers.length === 0) {
        const users = await tx.find('users', { entityId: proposal.entityId });
        approvers = users
          .filter((u) => (u.roles ?? []).some((r) => ['owner', 'approver', 'director'].includes(r)))
          .map((u) => u.id);
      }
      if (approvers.length === 0) {
        throw new ApprovalError(
          `${proposal.entityId} has nobody who can approve this instruction`,
          'APPROVAL_NO_APPROVERS',
          { proposalId: proposal.id },
        );
      }

      const approval = {
        id: newId('approval'),
        proposalId: proposal.id,
        entityId: proposal.entityId,
        required: decision.requirements.approvals,
        approvers,
        segregationOfDuties: decision.requirements.segregationOfDuties !== false,
        initiator: proposal.initiator,
        reasons: decision.reasons.filter((r) => r.severity === 'approval'),
        decisions: [],
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlHours * 3600 * 1000).toISOString(),
      };
      await tx.insert('approvals', approval);
      await audit.append(tx, {
        type: 'approval.opened',
        actor: proposal.initiator,
        subject: { type: 'approval', id: approval.id },
        payload: {
          proposalId: proposal.id,
          required: approval.required,
          approvers,
          reasons: approval.reasons.map((r) => r.code),
        },
      });
      return approval;
    },

    async get(approvalId) {
      return store.get('approvals', approvalId);
    },

    async pending({ entityId = null } = {}) {
      const match = entityId ? { entityId, status: 'pending' } : { status: 'pending' };
      const rows = await store.find('approvals', match);
      const now = clock.now();
      return rows.filter((a) => !isExpired(a, now));
    },

    /**
     * Record one person's decision.
     * Returns the updated approval; `status` becomes `approved` once enough
     * distinct, eligible approvers have said yes, or `rejected` on the first no.
     */
    async decide({ approvalId, userId, decision, comment = null }) {
      if (!['approve', 'reject'].includes(decision)) {
        throw new ApprovalError(`Unknown decision: ${decision}`, 'APPROVAL_BAD_DECISION');
      }

      // Expiry both *records* a state change and *fails* the call. Throwing
      // from inside the transaction would roll back the very transition the
      // error reports, leaving the approval pending forever. So the
      // transaction returns an outcome and the throw happens after it commits.
      const settled = await store.withTransaction(async (tx) => {
        const approval = await tx.get('approvals', approvalId);
        if (!approval) throw new ApprovalError(`No approval ${approvalId}`, 'APPROVAL_NOT_FOUND');

        const now = clock.now();
        if (approval.status !== 'pending') {
          throw new ApprovalError(
            `Approval ${approvalId} is already ${approval.status}`,
            'APPROVAL_NOT_PENDING',
            { status: approval.status },
          );
        }
        if (isExpired(approval, now)) {
          const expired = await tx.update('approvals', approvalId, {
            status: 'expired',
            closedAt: now.toISOString(),
          });
          await tx.update('proposals', approval.proposalId, { status: 'expired' });
          await audit.append(tx, {
            type: 'approval.expired',
            actor: { type: 'system', id: 'kernel' },
            subject: { type: 'approval', id: approvalId },
            payload: { expiresAt: approval.expiresAt },
          });
          return { kind: 'expired', approval: expired };
        }

        if (approval.approvers.length && !approval.approvers.includes(userId)) {
          throw new ApprovalError(
            `${userId} is not an authorised approver for this instruction`,
            'APPROVAL_NOT_AUTHORISED',
            { approvers: approval.approvers },
          );
        }
        if (
          approval.segregationOfDuties &&
          approval.initiator?.type === 'user' &&
          approval.initiator.id === userId
        ) {
          throw new ApprovalError(
            'The person who raised an instruction cannot approve it',
            'APPROVAL_SELF',
            { initiator: approval.initiator },
          );
        }
        if (approval.decisions.some((d) => d.userId === userId)) {
          throw new ApprovalError(
            `${userId} has already decided on this instruction`,
            'APPROVAL_DUPLICATE',
          );
        }

        const decisions = [
          ...approval.decisions,
          { userId, decision, comment, at: now.toISOString() },
        ];
        const approvals = decisions.filter((d) => d.decision === 'approve').length;
        const rejected = decisions.some((d) => d.decision === 'reject');
        const status = rejected
          ? 'rejected'
          : approvals >= approval.required
            ? 'approved'
            : 'pending';

        const updated = await tx.update('approvals', approvalId, {
          decisions,
          status,
          closedAt: status === 'pending' ? null : now.toISOString(),
        });

        if (status === 'rejected') {
          await tx.update('proposals', approval.proposalId, {
            status: 'rejected',
            rejectedAt: now.toISOString(),
          });
        }

        await audit.append(tx, {
          type: `approval.${decision}d`,
          actor: { type: 'user', id: userId },
          subject: { type: 'approval', id: approvalId },
          outcome: status,
          payload: { proposalId: approval.proposalId, comment, approvals, required: approval.required },
        });

        return { kind: 'decided', approval: updated };
      });

      if (settled.kind === 'expired') {
        throw new ApprovalError(
          `Approval ${approvalId} expired at ${settled.approval.expiresAt}`,
          'APPROVAL_EXPIRED',
          { approval: settled.approval },
        );
      }
      return settled.approval;
    },

    /** Sweep expired approvals. A cron would call this; the demo calls it inline. */
    async expireStale() {
      const now = clock.now();
      const rows = await store.find('approvals', { status: 'pending' });
      const expired = [];
      for (const approval of rows) {
        if (!isExpired(approval, now)) continue;
        await store.withTransaction(async (tx) => {
          await tx.update('approvals', approval.id, { status: 'expired', closedAt: now.toISOString() });
          await tx.update('proposals', approval.proposalId, { status: 'expired' });
          await audit.append(tx, {
            type: 'approval.expired',
            actor: { type: 'system', id: 'kernel' },
            subject: { type: 'approval', id: approval.id },
            payload: { expiresAt: approval.expiresAt },
          });
        });
        expired.push(approval.id);
      }
      return { expired };
    },
  };
}
