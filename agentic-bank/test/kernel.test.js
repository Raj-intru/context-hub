import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBank } from './helpers.mjs';
import { format } from '../src/ledger/money.js';

/** Approve an instruction with exactly as many distinct approvers as it needs. */
async function approveFully(bank, ids, approval) {
  const candidates = [ids.institutional.treasurerId, ids.institutional.headOfTreasuryId];
  for (let i = 0; i < approval.required; i += 1) {
    await bank.approvals.decide({ approvalId: approval.id, userId: candidates[i], decision: 'approve' });
  }
}

test('a read executes and is recorded, with no money moving', async () => {
  const { bank, ids } = await makeBank();
  const before = await bank.ledger.getBalance(ids.consumer.everydayId);
  const outcome = await bank.kernel.submit({
    entityId: ids.consumer.entityId,
    capabilityId: 'accounts.balance',
    args: { accountId: ids.consumer.everydayId },
    initiator: { type: 'agent', id: ids.consumer.agentId },
  });
  assert.equal(outcome.status, 'executed');
  // 4,280.55 salary - 342.37 of seeded subscription debits + 500.00 overdraft
  assert.equal(outcome.result.available, 'AUD 4,438.18');
  const after = await bank.ledger.getBalance(ids.consumer.everydayId);
  assert.equal(after.cleared.amount, before.cleared.amount);
});

test('preview decides without creating anything', async () => {
  const { bank, ids } = await makeBank();
  const preview = await bank.kernel.preview({
    entityId: ids.consumer.entityId,
    capabilityId: 'payments.domestic.initiate',
    args: {
      fromAccountId: ids.consumer.everydayId,
      counterpartyId: ids.consumer.landlordId,
      amount: '9000.00', currency: 'AUD',
    },
    initiator: { type: 'agent', id: ids.consumer.agentId },
  });
  assert.equal(preview.status, 'dry_run');
  assert.equal(preview.decision.outcome, 'deny');
  assert.deepEqual(await bank.kernel.listProposals({ entityId: ids.consumer.entityId }), []);
});

test('a mutating instruction without an idempotency key is refused', async () => {
  const { bank, ids } = await makeBank();
  await assert.rejects(
    bank.kernel.submit({
      entityId: ids.consumer.entityId,
      capabilityId: 'transfers.internal',
      args: {
        fromAccountId: ids.consumer.everydayId,
        toAccountId: ids.consumer.savingsId,
        amount: '10.00', currency: 'AUD',
      },
      initiator: { type: 'agent', id: ids.consumer.agentId },
    }),
    (e) => e.code === 'IDEMPOTENCY_KEY_REQUIRED',
  );
});

test('the same key with different arguments is a conflict, not a second payment', async () => {
  const { bank, ids } = await makeBank();
  const args = (amount) => ({
    fromAccountId: ids.consumer.everydayId,
    toAccountId: ids.consumer.savingsId,
    amount, currency: 'AUD',
  });
  await bank.kernel.submit({
    entityId: ids.consumer.entityId, capabilityId: 'transfers.internal',
    args: args('10.00'), initiator: { type: 'agent', id: ids.consumer.agentId }, idempotencyKey: 'k',
  });
  await assert.rejects(
    bank.kernel.submit({
      entityId: ids.consumer.entityId, capabilityId: 'transfers.internal',
      args: args('20.00'), initiator: { type: 'agent', id: ids.consumer.agentId }, idempotencyKey: 'k',
    }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT' && e.status === 409,
  );
});

test('a failed execution leaves no trace: no postings, no proposal, no audit', async () => {
  const { bank, ids } = await makeBank();
  const auditBefore = (await bank.audit.list({})).length;
  const txnsBefore = (await bank.store.all('transactions')).length;

  // A payment file naming an unregistered payee fails in plan().
  await assert.rejects(
    bank.kernel.submit({
      entityId: ids.institutional.treasuryEntityId,
      capabilityId: 'payments.file.submit',
      args: {
        fromAccountId: ids.institutional.treasuryAudId,
        fileReference: 'FILE-1',
        lines: [{ counterpartyId: 'cpt_does_not_exist', amount: '100.00', currency: 'AUD' }],
      },
      initiator: { type: 'agent', id: ids.institutional.agentId },
      idempotencyKey: 'f1',
    }),
    (e) => e.code === 'FILE_UNKNOWN_COUNTERPARTY',
  );

  assert.equal((await bank.audit.list({})).length, auditBefore);
  assert.equal((await bank.store.all('transactions')).length, txnsBefore);
  assert.equal((await bank.audit.verify()).ok, true);
});

test('a duplicate instruction inside the window needs a human', async () => {
  const { bank, ids } = await makeBank();
  const pay = (key) => bank.kernel.submit({
    entityId: ids.consumer.entityId,
    capabilityId: 'payments.domestic.initiate',
    args: {
      fromAccountId: ids.consumer.everydayId,
      counterpartyId: ids.consumer.landlordId,
      amount: '400.00', currency: 'AUD',
    },
    initiator: { type: 'agent', id: ids.consumer.agentId },
    idempotencyKey: key,
  });

  assert.equal((await pay('d1')).status, 'executed');
  // Same payee, same amount, different key — a genuinely new instruction that
  // nonetheless looks like a double payment.
  const second = await pay('d2');
  assert.equal(second.status, 'pending_approval');
  assert.ok(second.decision.reasons.some((r) => r.code === 'POSSIBLE_DUPLICATE'));
});

test('an FX quote must be booked before it expires', async () => {
  const { bank, ids } = await makeBank();
  const quoted = await bank.kernel.submit({
    entityId: ids.institutional.treasuryEntityId,
    capabilityId: 'fx.quote',
    args: { sellCurrency: 'AUD', buyCurrency: 'USD', sellAmount: '1000000.00' },
    initiator: { type: 'agent', id: ids.institutional.agentId },
    idempotencyKey: 'q1',
  });
  // A rate request runs unattended: it sits in the reporting mandate, because a
  // quote that needed two signatures would expire before it could be booked.
  assert.equal(quoted.status, 'executed');
  const quoteId = quoted.result.quoteId;
  assert.equal(quoted.result.rate, '0.65940000');

  // Expire it by hand, then try to book.
  await bank.store.withTransaction((tx) => tx.update('rates', quoteId, { expiresAt: '2020-01-01T00:00:00.000Z' }));

  const booking = await bank.kernel.submit({
    entityId: ids.institutional.treasuryEntityId,
    capabilityId: 'fx.book',
    args: { quoteId, sellAccountId: ids.institutional.treasuryAudId, buyAccountId: ids.institutional.treasuryUsdId },
    initiator: { type: 'agent', id: ids.institutional.agentId },
    idempotencyKey: 'b1',
  });
  assert.equal(booking.status, 'pending_approval');
  await approveFully(bank, ids, booking.approval);

  await assert.rejects(
    bank.kernel.executeApproved({ proposalId: booking.proposal.id, actor: { type: 'user', id: ids.institutional.treasurerId } }),
    (e) => /expired/i.test(e.message),
  );
});

test('a booked FX deal balances in both currencies', async () => {
  const { bank, ids } = await makeBank();
  const quote = await bank.fx.quote({
    entityId: ids.institutional.treasuryEntityId,
    segment: 'institutional',
    sell: 'AUD', buy: 'USD',
    amount: (await import('../src/ledger/money.js')).parseDecimal('1000000.00', 'AUD'),
  });

  const booking = await bank.kernel.submit({
    entityId: ids.institutional.treasuryEntityId,
    capabilityId: 'fx.book',
    args: { quoteId: quote.id, sellAccountId: ids.institutional.treasuryAudId, buyAccountId: ids.institutional.treasuryUsdId },
    initiator: { type: 'agent', id: ids.institutional.agentId },
    idempotencyKey: 'b2',
  });
  await approveFully(bank, ids, booking.approval);
  const done = await bank.kernel.executeApproved({
    proposalId: booking.proposal.id, actor: { type: 'user', id: ids.institutional.headOfTreasuryId },
  });

  assert.equal(done.result.sold, 'AUD 1,000,000.00');
  assert.equal(done.result.bought, 'USD 659,400.00');
  assert.equal(format((await bank.ledger.getBalance(ids.institutional.treasuryAudId)).cleared), '23,500,000.00');
  assert.equal(format((await bank.ledger.getBalance(ids.institutional.treasuryUsdId)).cleared), '8,859,400.00');
  assert.equal((await bank.ledger.verifyJournal()).ok, true);
});

test('a payment run halts entirely if any payee is blocked at execution', async () => {
  const { bank, ids } = await makeBank();
  // Rename one supplier to a name the screening list blocks.
  await bank.store.withTransaction((tx) =>
    tx.update('counterparties', ids.business.counterpartyIds[1], { name: 'Crimson Dawn Trading' }));

  await assert.rejects(
    bank.kernel.submit({
      entityId: ids.business.entityId,
      capabilityId: 'payables.run.prepare',
      args: {
        fromAccountId: ids.business.operatingId,
        payableIds: ids.business.payableIds,
        reference: 'Nov run',
      },
      initiator: { type: 'agent', id: ids.business.agentId },
      idempotencyKey: 'run-blocked',
    }),
    (e) => e.code === 'RUN_SCREENING_BLOCKED',
  );

  // Nothing paid, nothing marked paid.
  for (const id of ids.business.payableIds) {
    assert.equal((await bank.store.get('instruments', id)).status, 'open');
  }
  assert.equal((await bank.ledger.verifyJournal()).ok, true);
});

test('a payment file cannot be submitted twice under the same reference', async () => {
  const { bank, ids } = await makeBank();
  const submit = (key) => bank.kernel.submit({
    entityId: ids.institutional.treasuryEntityId,
    capabilityId: 'payments.file.submit',
    args: {
      fromAccountId: ids.institutional.treasuryAudId,
      fileReference: 'PAYRUN-2026-11-05',
      lines: [{ counterpartyId: ids.institutional.supplierId, amount: '100000.00', currency: 'AUD', reference: 'inv 1' }],
    },
    initiator: { type: 'agent', id: ids.institutional.agentId },
    idempotencyKey: key,
  });

  const first = await submit('file-1');
  await approveFully(bank, ids, first.approval);
  await bank.kernel.executeApproved({ proposalId: first.proposal.id, actor: { type: 'user', id: ids.institutional.treasurerId } });

  // A different idempotency key, so the kernel will not replay — the file
  // reference itself has to be the guard.
  await assert.rejects(submit('file-2'), (e) => e.code === 'FILE_ALREADY_SUBMITTED');
});

test('an agent cannot act for another customer', async () => {
  const { bank, ids } = await makeBank();
  const outcome = await bank.kernel.submit({
    entityId: ids.business.entityId, // not its customer
    capabilityId: 'accounts.list',
    args: {},
    initiator: { type: 'agent', id: ids.consumer.agentId },
  });
  assert.equal(outcome.status, 'denied');
  assert.ok(outcome.decision.reasons.some((r) => r.code === 'NO_MANDATE'));
});

test('a mandate window refuses an instruction outside its hours', async () => {
  // Saturday 7 November 2026, 10:00 Sydney — outside the institutional
  // mandate's Mon-Fri 07:00-19:00 window.
  const { bank, ids } = await makeBank({ now: '2026-11-06T23:00:00Z' });
  const outcome = await bank.kernel.submit({
    entityId: ids.institutional.treasuryEntityId,
    capabilityId: 'liquidity.position',
    args: {},
    initiator: { type: 'agent', id: ids.institutional.agentId },
  });
  assert.equal(outcome.status, 'denied');
  const reason = outcome.decision.reasons.find((r) => r.code === 'NO_MANDATE');
  assert.equal(reason.detail.considered[0].code, 'MANDATE_OUTSIDE_DAYS');
});
