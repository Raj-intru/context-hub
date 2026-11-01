import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBank } from './helpers.mjs';

/** Raise an instruction that needs two approvals from the institutional agent. */
async function pendingInstruction() {
  const { bank, ids } = await makeBank();
  const outcome = await bank.kernel.submit({
    entityId: ids.institutional.treasuryEntityId,
    capabilityId: 'payments.crossborder.initiate',
    args: {
      fromAccountId: ids.institutional.treasuryEurId,
      counterpartyId: ids.institutional.supplierId,
      amount: '750000.00',
      currency: 'EUR',
      reference: 'Hanseatic Q4',
    },
    initiator: { type: 'agent', id: ids.institutional.agentId },
    idempotencyKey: 'xb-1',
  });
  assert.equal(outcome.status, 'pending_approval');
  assert.equal(outcome.approval.required, 2);
  return { bank, ids, outcome };
}

test('two distinct approvers release an instruction', async () => {
  const { bank, ids, outcome } = await pendingInstruction();
  const first = await bank.approvals.decide({
    approvalId: outcome.approval.id, userId: ids.institutional.treasurerId, decision: 'approve',
  });
  assert.equal(first.status, 'pending');

  const second = await bank.approvals.decide({
    approvalId: outcome.approval.id, userId: ids.institutional.headOfTreasuryId, decision: 'approve',
  });
  assert.equal(second.status, 'approved');

  const executed = await bank.kernel.executeApproved({
    proposalId: outcome.proposal.id,
    actor: { type: 'user', id: ids.institutional.headOfTreasuryId },
  });
  assert.equal(executed.status, 'executed');
  assert.equal(executed.result.amount, 'EUR 750,000.00');
});

test('the same person cannot approve twice', async () => {
  const { bank, ids, outcome } = await pendingInstruction();
  await bank.approvals.decide({
    approvalId: outcome.approval.id, userId: ids.institutional.treasurerId, decision: 'approve',
  });
  await assert.rejects(
    bank.approvals.decide({
      approvalId: outcome.approval.id, userId: ids.institutional.treasurerId, decision: 'approve',
    }),
    (e) => e.code === 'APPROVAL_DUPLICATE',
  );
});

test('someone outside the approver list cannot approve', async () => {
  const { bank, ids, outcome } = await pendingInstruction();
  await assert.rejects(
    bank.approvals.decide({
      approvalId: outcome.approval.id, userId: ids.consumer.userId, decision: 'approve',
    }),
    (e) => e.code === 'APPROVAL_NOT_AUTHORISED',
  );
});

test('the person who raised an instruction cannot approve it', async () => {
  const { bank, ids } = await makeBank();
  // Priya instructs directly under her propose_only mandate ...
  const outcome = await bank.kernel.submit({
    entityId: ids.institutional.treasuryEntityId,
    capabilityId: 'transfers.internal',
    args: {
      fromAccountId: ids.institutional.treasuryAudId,
      toAccountId: ids.institutional.subsidiaryAudId,
      amount: '100.00',
      currency: 'AUD',
    },
    initiator: { type: 'user', id: ids.institutional.treasurerId },
    idempotencyKey: 'sod-1',
  });
  assert.equal(outcome.status, 'denied'); // her mandate does not grant transfers

  // Raise one that does park for approval, initiated by a person.
  const readable = await bank.kernel.submit({
    entityId: ids.institutional.treasuryEntityId,
    capabilityId: 'liquidity.position',
    args: {},
    initiator: { type: 'user', id: ids.institutional.treasurerId },
  });
  assert.equal(readable.status, 'executed'); // reads need no approval

  // Now the real check, via the agent's pending instruction with Priya added
  // as initiator by hand is not possible — so assert the rule directly.
  const { bank: b2, ids: i2, outcome: pending } = await pendingInstruction();
  const approval = await b2.approvals.get(pending.approval.id);
  await b2.store.withTransaction((tx) =>
    tx.update('approvals', approval.id, {
      initiator: { type: 'user', id: i2.institutional.treasurerId },
    }));
  await assert.rejects(
    b2.approvals.decide({
      approvalId: approval.id, userId: i2.institutional.treasurerId, decision: 'approve',
    }),
    (e) => e.code === 'APPROVAL_SELF',
  );
});

test('one rejection kills the instruction', async () => {
  const { bank, ids, outcome } = await pendingInstruction();
  const rejected = await bank.approvals.decide({
    approvalId: outcome.approval.id,
    userId: ids.institutional.treasurerId,
    decision: 'reject',
    comment: 'wrong entity',
  });
  assert.equal(rejected.status, 'rejected');
  const proposal = await bank.kernel.getProposal(outcome.proposal.id);
  assert.equal(proposal.status, 'rejected');
  await assert.rejects(
    bank.kernel.executeApproved({ proposalId: outcome.proposal.id, actor: { type: 'user', id: ids.institutional.headOfTreasuryId } }),
    (e) => e.code === 'PROPOSAL_NOT_PENDING',
  );
});

test('an unapproved instruction cannot be executed', async () => {
  const { bank, ids, outcome } = await pendingInstruction();
  await assert.rejects(
    bank.kernel.executeApproved({
      proposalId: outcome.proposal.id,
      actor: { type: 'user', id: ids.institutional.headOfTreasuryId },
    }),
    (e) => e.code === 'APPROVAL_INCOMPLETE',
  );
});

test('an expired approval cannot be used', async () => {
  const { bank, ids, outcome } = await pendingInstruction();
  await bank.store.withTransaction((tx) =>
    tx.update('approvals', outcome.approval.id, { expiresAt: '2020-01-01T00:00:00.000Z' }));
  await assert.rejects(
    bank.approvals.decide({
      approvalId: outcome.approval.id, userId: ids.institutional.treasurerId, decision: 'approve',
    }),
    (e) => e.code === 'APPROVAL_EXPIRED',
  );
  assert.equal((await bank.kernel.getProposal(outcome.proposal.id)).status, 'expired');
});

test('conditions are re-checked when an approval releases an instruction', async () => {
  const { bank, ids, outcome } = await pendingInstruction();

  // Between raising and approving, the payee is blocked by screening.
  await bank.store.withTransaction((tx) =>
    tx.update('counterparties', ids.institutional.supplierId, {
      screening: { status: 'blocked', matches: [{ type: 'name', list: 'late-hit', score: 100 }], provider: 'stub', screenedAt: '2026-11-04T23:00:00.000Z' },
    }));

  await bank.approvals.decide({ approvalId: outcome.approval.id, userId: ids.institutional.treasurerId, decision: 'approve' });
  await bank.approvals.decide({ approvalId: outcome.approval.id, userId: ids.institutional.headOfTreasuryId, decision: 'approve' });

  // Approving a stale decision must not bypass a control that arrived later.
  await assert.rejects(
    bank.kernel.executeApproved({
      proposalId: outcome.proposal.id,
      actor: { type: 'user', id: ids.institutional.headOfTreasuryId },
    }),
    (e) => e.code === 'RECHECK_DENIED',
  );
  assert.equal((await bank.kernel.getProposal(outcome.proposal.id)).status, 'denied');
});

test('an approval with no named approvers falls back to the customer\'s own', async () => {
  const { bank, ids } = await makeBank();
  // The consumer mandate has no dualControl, so a cooling-off payee produces an
  // approval with nobody named by the mandate.
  const added = await bank.kernel.submit({
    entityId: ids.consumer.entityId,
    capabilityId: 'counterparties.add',
    args: { name: 'New Dentist', accountIdentifier: '013-222 99887766', country: 'AU' },
    initiator: { type: 'agent', id: ids.consumer.agentId },
    idempotencyKey: 'add-1',
  });
  assert.equal(added.status, 'executed');

  const outcome = await bank.kernel.submit({
    entityId: ids.consumer.entityId,
    capabilityId: 'payments.domestic.initiate',
    args: {
      fromAccountId: ids.consumer.everydayId,
      counterpartyId: added.result.counterpartyId,
      amount: '250.00',
      currency: 'AUD',
    },
    initiator: { type: 'agent', id: ids.consumer.agentId },
    idempotencyKey: 'cool-1',
  });
  assert.equal(outcome.status, 'pending_approval');
  assert.deepEqual(outcome.approval.approvers, [ids.consumer.userId]);
});
