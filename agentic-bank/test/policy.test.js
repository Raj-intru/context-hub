import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, OUTCOME, explain } from '../src/kernel/policy.js';
import { AUTONOMY } from '../src/kernel/mandates.js';
import { SCREENING_STATUS } from '../src/kernel/screening.js';
import { parseDecimal as D } from '../src/ledger/money.js';
import { blockCodes, approvalCodes } from './helpers.mjs';

// `evaluate` does no IO, so every control in the bank is testable as a pure
// function over a materialised context. These are the tests a second line of
// defence would want to read.

const NOW = new Date('2026-11-04T23:00:00Z'); // Thu 5 Nov 2026, 10:00 Sydney

function ctx(overrides = {}) {
  return {
    now: NOW,
    bankTimeZone: 'Australia/Sydney',
    capability: {
      id: 'payments.domestic.initiate',
      enabled: true,
      segments: ['consumer', 'business', 'institutional'],
      riskClass: 'high',
      mutating: true,
      requiresCounterparty: true,
      debitsFunds: true,
      requiresKyc: true,
      rail: { name: 'NPP', cutOff: '22:00', lagDays: 0 },
    },
    entity: { id: 'ent_1', name: 'Test', segment: 'consumer', status: 'active', kycStatus: 'verified' },
    mandate: {
      id: 'mdt_1',
      autonomy: AUTONOMY.EXECUTE_WITHIN_LIMITS,
      capabilities: ['payments.*'],
      accounts: ['*'],
      limits: { perTransaction: { AUD: D('2500.00', 'AUD') }, daily: { AUD: D('5000.00', 'AUD') } },
      counterparties: { mode: 'any', ids: [] },
      dualControl: null,
    },
    mandateRejections: [],
    accounts: [
      { id: 'acc_1', entityId: 'ent_1', status: 'active', currency: 'AUD', available: D('10000.00', 'AUD') },
    ],
    counterparty: { id: 'cpt_1', name: 'Landlord', coolingOff: false },
    screening: { status: SCREENING_STATUS.CLEAR, matches: [] },
    screeningStale: false,
    usage: { daily: {}, monthly: {} },
    recentSimilar: [],
    holidays: [],
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    id: 'prp_1',
    entityId: 'ent_1',
    capabilityId: 'payments.domestic.initiate',
    initiator: { type: 'agent', id: 'agt_1' },
    amount: D('1000.00', 'AUD'),
    accountIds: ['acc_1'],
    sourceAccountId: 'acc_1',
    counterpartyId: 'cpt_1',
    ...overrides,
  };
}

test('allows a payment inside every limit', () => {
  const decision = evaluate(proposal(), ctx());
  assert.equal(decision.outcome, OUTCOME.ALLOW);
  assert.deepEqual(blockCodes(decision), []);
  assert.equal(decision.requirements, null);
});

test('a decision is deterministic and carries its policy version', () => {
  const a = evaluate(proposal(), ctx());
  const b = evaluate(proposal(), ctx());
  assert.deepEqual(a, b);
  assert.equal(typeof a.policyVersion, 'string');
  assert.equal(a.contextDigest.mandateId, 'mdt_1');
});

test('denies with no mandate, and reports what was considered', () => {
  const decision = evaluate(
    proposal(),
    ctx({ mandate: null, mandateRejections: [{ mandateId: 'mdt_x', code: 'MANDATE_INACTIVE' }] }),
  );
  assert.equal(decision.outcome, OUTCOME.DENY);
  assert.ok(blockCodes(decision).includes('NO_MANDATE'));
  const reason = decision.reasons.find((r) => r.code === 'NO_MANDATE');
  assert.equal(reason.detail.considered[0].mandateId, 'mdt_x');
});

test('denies past the per-instruction limit', () => {
  const decision = evaluate(proposal({ amount: D('2500.01', 'AUD') }), ctx());
  assert.equal(decision.outcome, OUTCOME.DENY);
  assert.ok(blockCodes(decision).includes('PER_TRANSACTION_LIMIT_EXCEEDED'));
});

test('allows exactly at the per-instruction limit', () => {
  assert.equal(evaluate(proposal({ amount: D('2500.00', 'AUD') }), ctx()).outcome, OUTCOME.ALLOW);
});

test('denies when the day\'s authority is already consumed', () => {
  const decision = evaluate(
    proposal({ amount: D('1000.00', 'AUD') }),
    ctx({ usage: { daily: { AUD: D('4500.00', 'AUD') }, monthly: {} } }),
  );
  assert.equal(decision.outcome, OUTCOME.DENY);
  assert.ok(blockCodes(decision).includes('DAILY_LIMIT_EXCEEDED'));
});

test('denies a currency the mandate does not authorise', () => {
  const decision = evaluate(
    proposal({ amount: D('100.00', 'USD') }),
    ctx({
      accounts: [{ id: 'acc_1', entityId: 'ent_1', status: 'active', currency: 'USD', available: D('5000.00', 'USD') }],
    }),
  );
  assert.equal(decision.outcome, OUTCOME.DENY);
  assert.ok(blockCodes(decision).includes('CURRENCY_NOT_AUTHORISED'));
});

test('reports every blocking reason at once, not just the first', () => {
  const decision = evaluate(
    proposal({ amount: D('9000.00', 'AUD') }),
    ctx({
      accounts: [{ id: 'acc_1', entityId: 'ent_1', status: 'active', currency: 'AUD', available: D('100.00', 'AUD') }],
    }),
  );
  const codes = blockCodes(decision);
  assert.ok(codes.includes('PER_TRANSACTION_LIMIT_EXCEEDED'));
  assert.ok(codes.includes('DAILY_LIMIT_EXCEEDED'));
  assert.ok(codes.includes('INSUFFICIENT_FUNDS'));
});

test('denies a frozen or unowned account', () => {
  const frozen = evaluate(
    proposal(),
    ctx({ accounts: [{ id: 'acc_1', entityId: 'ent_1', status: 'frozen', currency: 'AUD', available: D('1.00', 'AUD') }] }),
  );
  assert.ok(blockCodes(frozen).includes('ACCOUNT_FROZEN'));

  const foreign = evaluate(
    proposal(),
    ctx({ accounts: [{ id: 'acc_1', entityId: 'ent_other', status: 'active', currency: 'AUD', available: D('9999.00', 'AUD') }] }),
  );
  assert.ok(blockCodes(foreign).includes('ACCOUNT_NOT_OWNED'));
});

test('screening fails closed when it cannot answer', () => {
  const decision = evaluate(
    proposal(),
    ctx({ screening: { status: SCREENING_STATUS.UNAVAILABLE, error: 'timeout' } }),
  );
  assert.equal(decision.outcome, OUTCOME.DENY);
  assert.ok(blockCodes(decision).includes('SCREENING_UNAVAILABLE'));
});

test('a blocked payee is a denial; a review hit is an approval', () => {
  const blocked = evaluate(proposal(), ctx({ screening: { status: SCREENING_STATUS.BLOCKED, matches: [] } }));
  assert.equal(blocked.outcome, OUTCOME.DENY);

  const review = evaluate(proposal(), ctx({ screening: { status: SCREENING_STATUS.REVIEW, matches: [] } }));
  assert.equal(review.outcome, OUTCOME.REQUIRE_APPROVAL);
  assert.ok(approvalCodes(review).includes('SCREENING_REVIEW'));
});

test('an allowlist mandate refuses a payee not on it', () => {
  const decision = evaluate(
    proposal(),
    ctx({ mandate: { ...ctx().mandate, counterparties: { mode: 'allowlist', ids: ['cpt_other'] } } }),
  );
  assert.equal(decision.outcome, OUTCOME.DENY);
  assert.ok(blockCodes(decision).includes('COUNTERPARTY_NOT_ALLOWLISTED'));
});

test('a payee in cooling-off needs a human', () => {
  const decision = evaluate(
    proposal(),
    ctx({ counterparty: { id: 'cpt_1', name: 'New payee', coolingOff: true, addedAt: NOW.toISOString() } }),
  );
  assert.equal(decision.outcome, OUTCOME.REQUIRE_APPROVAL);
  assert.ok(approvalCodes(decision).includes('COUNTERPARTY_IN_COOLING_OFF'));
});

test('a likely duplicate needs a human', () => {
  const decision = evaluate(
    proposal(),
    ctx({ recentSimilar: [{ proposalId: 'prp_0', at: NOW.toISOString() }] }),
  );
  assert.equal(decision.outcome, OUTCOME.REQUIRE_APPROVAL);
  assert.ok(approvalCodes(decision).includes('POSSIBLE_DUPLICATE'));
});

test('propose_only autonomy never executes a mutating action', () => {
  const decision = evaluate(
    proposal(),
    ctx({ mandate: { ...ctx().mandate, autonomy: AUTONOMY.PROPOSE_ONLY } }),
  );
  assert.equal(decision.outcome, OUTCOME.REQUIRE_APPROVAL);
  assert.ok(approvalCodes(decision).includes('AUTONOMY_PROPOSE_ONLY'));
});

test('propose_only still permits a read', () => {
  const decision = evaluate(
    proposal({ amount: null, counterpartyId: null }),
    ctx({
      mandate: { ...ctx().mandate, autonomy: AUTONOMY.PROPOSE_ONLY, capabilities: ['accounts.*'] },
      capability: {
        id: 'accounts.balance', enabled: true, segments: ['consumer'], riskClass: 'read',
        mutating: false, requiresCounterparty: false, debitsFunds: false, rail: null,
      },
      counterparty: null,
    }),
  );
  assert.equal(decision.outcome, OUTCOME.ALLOW);
});

test('dual control triggers at its threshold and names its approvers', () => {
  const mandate = {
    ...ctx().mandate,
    limits: { perTransaction: { AUD: D('100000.00', 'AUD') } },
    dualControl: {
      thresholdAbove: { AUD: D('50000.00', 'AUD') },
      requiredApprovals: 2,
      approvers: ['usr_a', 'usr_b', 'usr_c'],
    },
  };
  const accounts = [{ id: 'acc_1', entityId: 'ent_1', status: 'active', currency: 'AUD', available: D('500000.00', 'AUD') }];

  const below = evaluate(proposal({ amount: D('49999.99', 'AUD') }), ctx({ mandate, accounts }));
  assert.equal(below.outcome, OUTCOME.ALLOW);

  const at = evaluate(proposal({ amount: D('50000.00', 'AUD') }), ctx({ mandate, accounts }));
  assert.equal(at.outcome, OUTCOME.REQUIRE_APPROVAL);
  assert.equal(at.requirements.approvals, 2);
  assert.deepEqual(at.requirements.approvers, ['usr_a', 'usr_b', 'usr_c']);
  assert.equal(at.requirements.segregationOfDuties, true);
});

test('a high-risk action is never unattended without a limit in that currency', () => {
  // Same autonomy, but no AUD per-instruction ceiling: falls back to a human.
  const decision = evaluate(
    proposal(),
    ctx({ mandate: { ...ctx().mandate, limits: {} } }),
  );
  assert.equal(decision.outcome, OUTCOME.REQUIRE_APPROVAL);
  assert.ok(approvalCodes(decision).includes('HIGH_RISK_UNBOUNDED'));
});

test('incomplete KYC blocks everything that needs it', () => {
  const decision = evaluate(proposal(), ctx({
    entity: { id: 'ent_1', name: 'T', segment: 'consumer', status: 'active', kycStatus: 'pending' },
  }));
  assert.ok(blockCodes(decision).includes('KYC_INCOMPLETE'));
});

test('a capability outside the segment is refused', () => {
  const decision = evaluate(proposal(), ctx({
    capability: { ...ctx().capability, segments: ['institutional'] },
  }));
  assert.ok(blockCodes(decision).includes('CAPABILITY_NOT_AVAILABLE_FOR_SEGMENT'));
});

test('value date rolls past the cut-off and says so', () => {
  const beforeCutOff = evaluate(proposal(), ctx());
  assert.equal(beforeCutOff.valueDate, '2026-11-05');
  assert.equal(beforeCutOff.reasons.some((r) => r.code === 'VALUE_DATE_ROLLED'), false);

  // 23:30 Sydney on the Thursday: past the 22:00 NPP cut-off.
  const afterCutOff = evaluate(proposal(), ctx({ now: new Date('2026-11-05T12:30:00Z') }));
  assert.equal(afterCutOff.valueDate, '2026-11-06');
  assert.ok(afterCutOff.reasons.some((r) => r.code === 'VALUE_DATE_ROLLED'));
});

test('a weekend instruction lands on the next business day', () => {
  // Saturday 7 November 2026, 09:00 Sydney.
  const decision = evaluate(proposal(), ctx({ now: new Date('2026-11-06T22:00:00Z') }));
  assert.equal(decision.valueDate, '2026-11-09'); // Monday
});

test('a bank holiday is skipped too', () => {
  const decision = evaluate(
    proposal(),
    ctx({ now: new Date('2026-11-05T12:30:00Z'), holidays: ['2026-11-06'] }),
  );
  assert.equal(decision.valueDate, '2026-11-09');
});

test('explain() never claims success for an approval or a denial', () => {
  const allowed = explain(evaluate(proposal(), ctx()));
  assert.match(allowed, /^Permitted/);

  const pending = explain(evaluate(proposal(), ctx({ mandate: { ...ctx().mandate, autonomy: AUTONOMY.PROPOSE_ONLY } })));
  assert.match(pending, /Needs 1 approval/);

  const denied = explain(evaluate(proposal({ amount: D('99999.00', 'AUD') }), ctx()));
  assert.match(denied, /^Not permitted/);
});
