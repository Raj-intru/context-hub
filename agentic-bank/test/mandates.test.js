import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityMatches, accountMatches, withinWindow, withinLimit, AUTONOMY } from '../src/kernel/mandates.js';
import { parseDecimal as D } from '../src/ledger/money.js';
import { makeBank } from './helpers.mjs';

test('capability patterns match exactly, by prefix, or by wildcard', () => {
  assert.equal(capabilityMatches(['payments.domestic.initiate'], 'payments.domestic.initiate'), true);
  assert.equal(capabilityMatches(['payments.*'], 'payments.domestic.initiate'), true);
  assert.equal(capabilityMatches(['payments.*'], 'fx.book'), false);
  assert.equal(capabilityMatches(['*'], 'anything.at.all'), true);
  // A prefix must not match a sibling with a shared stem.
  assert.equal(capabilityMatches(['payments.domestic.*'], 'payments.crossborder.initiate'), false);
});

test('account grants must cover every account touched', () => {
  assert.equal(accountMatches(['*'], ['acc_1', 'acc_2']), true);
  assert.equal(accountMatches(['acc_1'], ['acc_1']), true);
  assert.equal(accountMatches(['acc_1'], ['acc_1', 'acc_2']), false);
});

test('a window restricts by date, weekday and hour in its own timezone', () => {
  const mandate = {
    window: {
      timeZone: 'Australia/Sydney',
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      hours: { from: '09:00', to: '17:00' },
    },
  };
  // Thu 5 Nov 2026, 10:00 Sydney
  assert.equal(withinWindow(mandate, new Date('2026-11-04T23:00:00Z')).ok, true);
  // Thu 5 Nov, 07:00 Sydney — before the window
  assert.equal(withinWindow(mandate, new Date('2026-11-04T20:00:00Z')).code, 'MANDATE_OUTSIDE_HOURS');
  // Sat 7 Nov, 10:00 Sydney
  assert.equal(withinWindow(mandate, new Date('2026-11-06T23:00:00Z')).code, 'MANDATE_OUTSIDE_DAYS');
  // Exactly 17:00 is outside — the window is half-open.
  assert.equal(withinWindow(mandate, new Date('2026-11-05T06:00:00Z')).code, 'MANDATE_OUTSIDE_HOURS');
});

test('notBefore and notAfter bound a mandate\'s life', () => {
  const mandate = { window: { notBefore: '2026-12-01T00:00:00.000Z', notAfter: '2027-01-01T00:00:00.000Z' } };
  assert.equal(withinWindow(mandate, new Date('2026-11-05T00:00:00Z')).code, 'MANDATE_NOT_YET_EFFECTIVE');
  assert.equal(withinWindow(mandate, new Date('2026-12-15T00:00:00Z')).ok, true);
  assert.equal(withinWindow(mandate, new Date('2027-02-01T00:00:00Z')).code, 'MANDATE_EXPIRED');
});

test('a limit in another currency does not authorise this one', () => {
  const check = withinLimit(D('100.00', 'USD'), D('5000.00', 'AUD'));
  assert.equal(check.ok, false);
  assert.equal(check.code, 'LIMIT_CURRENCY_NOT_AUTHORISED');
});

test('resolution prefers the most restrictive applicable mandate', async () => {
  const { bank, ids } = await makeBank();
  // The consumer agent already holds an execute_within_limits mandate. Add a
  // narrower propose_only one covering the same capability.
  await bank.mandates.create({
    entityId: ids.consumer.entityId,
    grantee: { type: 'agent', id: ids.consumer.agentId },
    grantedBy: ids.consumer.userId,
    autonomy: AUTONOMY.PROPOSE_ONLY,
    capabilities: ['payments.domestic.initiate'],
    accounts: ['*'],
  });

  const resolved = await bank.mandates.resolve({
    entityId: ids.consumer.entityId,
    grantee: { type: 'agent', id: ids.consumer.agentId },
    capabilityId: 'payments.domestic.initiate',
    accountIds: [ids.consumer.everydayId],
  });
  // Adding a mandate must never widen what the agent may do unattended.
  assert.equal(resolved.mandate.autonomy, AUTONOMY.PROPOSE_ONLY);
  assert.equal(resolved.eligible.length, 2);
});

test('a revoked mandate stops resolving and says why', async () => {
  const { bank, ids } = await makeBank();
  await bank.mandates.revoke(ids.consumer.mandateId, ids.consumer.userId, 'lost device');
  const resolved = await bank.mandates.resolve({
    entityId: ids.consumer.entityId,
    grantee: { type: 'agent', id: ids.consumer.agentId },
    capabilityId: 'payments.domestic.initiate',
    accountIds: [ids.consumer.everydayId],
  });
  assert.equal(resolved.mandate, null);
  assert.equal(resolved.rejected[0].code, 'MANDATE_INACTIVE');
});

test('usage counts executed proposals, not attempts', async () => {
  const { bank, ids } = await makeBank();
  const pay = (amount, key) => bank.kernel.submit({
    entityId: ids.consumer.entityId,
    capabilityId: 'payments.domestic.initiate',
    args: {
      fromAccountId: ids.consumer.everydayId,
      counterpartyId: ids.consumer.landlordId,
      amount, currency: 'AUD',
    },
    initiator: { type: 'agent', id: ids.consumer.agentId },
    idempotencyKey: key,
  });

  await pay('1000.00', 'u1');
  const denied = await pay('9000.00', 'u2');
  assert.equal(denied.status, 'denied');

  const usage = await bank.mandates.usage(ids.consumer.mandateId);
  // Only the executed 1000 consumed authority; the refusal consumed none.
  assert.equal(usage.daily.AUD.amount, '100000');
});

test('rejects a dual-control block with fewer approvers than approvals', async () => {
  const { bank, ids } = await makeBank();
  await assert.rejects(
    bank.mandates.create({
      entityId: ids.consumer.entityId,
      grantee: { type: 'agent', id: ids.consumer.agentId },
      grantedBy: ids.consumer.userId,
      autonomy: AUTONOMY.EXECUTE_WITHIN_LIMITS,
      capabilities: ['payments.*'],
      dualControl: { requiredApprovals: 3, approvers: ['usr_a', 'usr_b'] },
    }),
    (e) => e.code === 'MANDATE_BAD_DUAL_CONTROL',
  );
});

test('granting and revoking a mandate are both audited', async () => {
  const { bank, ids } = await makeBank();
  await bank.mandates.revoke(ids.consumer.mandateId, ids.consumer.userId, 'rotated');
  const records = await bank.audit.list({ subjectId: ids.consumer.mandateId });
  assert.deepEqual(records.map((r) => r.type), ['mandate.granted', 'mandate.revoked']);
  assert.equal((await bank.audit.verify()).ok, true);
});
