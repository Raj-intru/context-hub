import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, hashRecord } from '../src/util/canonical.js';
import { makeBank } from './helpers.mjs';

test('canonical JSON is key-order independent', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
    canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
  );
  assert.equal(hashRecord({ x: 1, y: 2 }), hashRecord({ y: 2, x: 1 }));
});

test('canonical JSON drops undefined but keeps null', () => {
  assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
});

test('the chain verifies over a real sequence of decisions', async () => {
  const { bank, ids } = await makeBank();
  for (const amount of ['100.00', '200.00', '9999.00']) {
    await bank.kernel.submit({
      entityId: ids.consumer.entityId,
      capabilityId: 'payments.domestic.initiate',
      args: {
        fromAccountId: ids.consumer.everydayId,
        counterpartyId: ids.consumer.landlordId,
        amount, currency: 'AUD',
      },
      initiator: { type: 'agent', id: ids.consumer.agentId },
      idempotencyKey: `a-${amount}`,
    });
  }
  const verified = await bank.audit.verify();
  assert.equal(verified.ok, true);
  assert.ok(verified.records > 3);
});

test('altering a record breaks the chain at that record', async () => {
  const { bank, ids } = await makeBank();
  await bank.kernel.submit({
    entityId: ids.consumer.entityId,
    capabilityId: 'payments.domestic.initiate',
    args: {
      fromAccountId: ids.consumer.everydayId,
      counterpartyId: ids.consumer.landlordId,
      amount: '100.00', currency: 'AUD',
    },
    initiator: { type: 'agent', id: ids.consumer.agentId },
    idempotencyKey: 'tamper-1',
  });

  const records = await bank.audit.list({});
  const target = records.find((r) => r.type === 'proposal.evaluated');
  // Rewrite history: pretend the instruction was for a different amount.
  await bank.store.withTransaction((tx) =>
    tx.update('audit', target.id, {
      payload: { ...target.payload, amount: { amount: '1', currency: 'AUD', scale: 2 } },
    }));

  const verified = await bank.audit.verify();
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, 'CONTENT_ALTERED');
  assert.equal(verified.brokenAt, target.seq);
});

test('removing a record breaks the chain', async () => {
  const { bank, ids } = await makeBank();
  await bank.kernel.submit({
    entityId: ids.consumer.entityId, capabilityId: 'accounts.list', args: {},
    initiator: { type: 'agent', id: ids.consumer.agentId },
  });
  const records = await bank.audit.list({});
  const victim = records[Math.floor(records.length / 2)];
  await bank.store.withTransaction((tx) => tx.remove('audit', victim.id));

  const verified = await bank.audit.verify();
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, 'PREV_HASH_MISMATCH');
});

test('a failed execution leaves no audit record claiming it happened', async () => {
  const { bank, ids } = await makeBank();
  const auditBefore = await bank.audit.list({});
  const headBefore = (await bank.audit.verify()).head;

  // Block one payee *after* the payables were registered, so the run passes
  // planning and the policy decision and then fails inside execute(). That is
  // the dangerous window: the proposal row and its `proposal.evaluated` audit
  // record have already been written when the failure happens.
  await bank.store.withTransaction((tx) =>
    tx.update('counterparties', ids.business.counterpartyIds[0], { name: 'Crimson Dawn Trading' }));

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
      idempotencyKey: 'rollback-1',
    }),
    (e) => e.code === 'RUN_SCREENING_BLOCKED',
  );

  // Nothing survives: no audit record, no proposal, no postings, and the chain
  // head is exactly where it was.
  const auditAfter = await bank.audit.list({});
  assert.equal(auditAfter.length, auditBefore.length);
  assert.equal((await bank.audit.verify()).head, headBefore);
  assert.deepEqual(await bank.kernel.listProposals({ entityId: ids.business.entityId }), []);
  assert.equal((await bank.ledger.verifyJournal()).ok, true);
  for (const id of ids.business.payableIds) {
    assert.equal((await bank.store.get('instruments', id)).status, 'open');
  }
});

test('every audit record names an actor and a subject', async () => {
  const { bank, ids } = await makeBank();
  await bank.kernel.submit({
    entityId: ids.consumer.entityId, capabilityId: 'accounts.list', args: {},
    initiator: { type: 'agent', id: ids.consumer.agentId },
  });
  for (const record of await bank.audit.list({})) {
    assert.ok(record.actor?.id, `record ${record.seq} (${record.type}) has no actor`);
    assert.ok(record.subject?.id, `record ${record.seq} (${record.type}) has no subject`);
    assert.ok(record.at);
    assert.equal(record.hash.length, 64);
  }
});
