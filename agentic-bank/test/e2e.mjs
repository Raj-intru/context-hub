// End-to-end over HTTP: the three segment journeys, driven the way a client
// would drive them. Run with `npm run test:e2e`.
//
// This is a separate script rather than part of `npm test` because it binds a
// port. It uses the same seed data the demo does.

import assert from 'node:assert/strict';
import { createBank } from '../src/bank.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { seed } from '../src/seed.js';
import { fixedClock } from '../src/util/time.js';

// Runs against the memory store by default. Set STORE=postgres (with
// DATABASE_URL) to run the identical journeys against a real database — the
// point of the store interface is that nothing else in this file changes.
const config = loadConfig({
  STORE: process.env.STORE ?? 'memory',
  DATABASE_URL: process.env.DATABASE_URL,
  AGENT_PROVIDER: 'stub',
  BANK_TIMEZONE: 'Australia/Sydney',
  PORT: '0',
});
console.log(`store: ${config.store}`);
const bank = await createBank({ config, clock: fixedClock('2026-11-04T23:00:00Z') });
const ids = await seed(bank);
const app = createApp({ bank });

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err.message}`);
  }
}

function as(entityId, actor) {
  return async (method, path, { body = null, idempotencyKey = null } = {}) => {
    const headers = {
      'content-type': 'application/json',
      'x-bank-entity': entityId,
      'x-bank-actor-type': actor.type,
      'x-bank-actor-id': actor.id,
    };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
}

console.log('\n== health and discovery ==');
await step('readyz reports the store, the agent provider and honest readiness', async () => {
  const response = await fetch(`${base}/readyz`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.backend, config.store);
  // Readiness is never "ready" in the demo: the auth shim and the stub
  // screening list are both blockers regardless of the store.
  assert.equal(body.readiness.ready, false);
  assert.ok(body.readiness.blockers.length >= 2);
});

await step('an unauthenticated call is refused', async () => {
  const response = await fetch(`${base}/v1/capabilities`);
  assert.equal(response.status, 401);
});

// ------------------------------------------------------------------ consumer
console.log('\n== consumer: Ana ==');
const ana = as(ids.consumer.entityId, { type: 'agent', id: ids.consumer.agentId });
const anaUser = as(ids.consumer.entityId, { type: 'user', id: ids.consumer.userId });

await step('the agent sees only its segment\'s capabilities', async () => {
  const { body } = await ana('GET', '/v1/agent/capabilities');
  assert.equal(body.segment, 'consumer');
  assert.ok(body.inScopeForYou.includes('payments.domestic.initiate'));
  assert.ok(!body.inScopeForYou.includes('payments.file.submit'));
  assert.ok(body.toolDefinitions.every((t) => t.strict === true));
});

await step('available balance accounts for holds and the overdraft', async () => {
  const { body } = await ana('POST', '/v1/capabilities/accounts.balance/execute', {
    body: { args: { accountId: ids.consumer.everydayId } },
  });
  assert.equal(body.status, 'executed');
  assert.equal(body.result.available, 'AUD 4,438.18');
});

await step('recurring debits are found read-only', async () => {
  const { body } = await ana('POST', '/v1/capabilities/subscriptions.review/execute', {
    body: { args: { accountId: ids.consumer.everydayId } },
  });
  assert.equal(body.status, 'executed');
  assert.equal(body.result.found, 3);
  assert.ok(body.result.items.some((i) => /STREAMFLIX/.test(i.narrative)));
});

await step('rent is paid unattended inside the mandate limits', async () => {
  const { body } = await ana('POST', '/v1/capabilities/payments.domestic.initiate/execute', {
    idempotencyKey: 'e2e-rent',
    body: {
      args: {
        fromAccountId: ids.consumer.everydayId,
        counterpartyId: ids.consumer.landlordId,
        amount: '1800.00',
        currency: 'AUD',
        reference: 'Rent November',
      },
    },
  });
  assert.equal(body.status, 'executed');
  assert.equal(body.result.amount, 'AUD 1,800.00');
  assert.equal(body.result.valueDate, '2026-11-05');
});

await step('a replayed Idempotency-Key does not pay twice', async () => {
  const { body } = await ana('POST', '/v1/capabilities/payments.domestic.initiate/execute', {
    idempotencyKey: 'e2e-rent',
    body: {
      args: {
        fromAccountId: ids.consumer.everydayId,
        counterpartyId: ids.consumer.landlordId,
        amount: '1800.00',
        currency: 'AUD',
        reference: 'Rent November',
      },
    },
  });
  assert.equal(body.replayed, true);
  const balance = await ana('POST', '/v1/capabilities/accounts.balance/execute', {
    body: { args: { accountId: ids.consumer.everydayId } },
  });
  assert.equal(balance.body.result.cleared, 'AUD 2,138.18');
});

await step('a payment over the limit is refused with its reasons, and 403', async () => {
  const { status, body } = await ana('POST', '/v1/capabilities/payments.domestic.initiate/execute', {
    idempotencyKey: 'e2e-big',
    body: {
      args: {
        fromAccountId: ids.consumer.everydayId,
        counterpartyId: ids.consumer.landlordId,
        amount: '4000.00',
        currency: 'AUD',
      },
    },
  });
  assert.equal(status, 403);
  assert.equal(body.status, 'denied');
  assert.ok(body.decision.reasons.some((r) => r.code === 'PER_TRANSACTION_LIMIT_EXCEEDED'));
});

await step('a new payee is screened and then needs approval to be paid', async () => {
  const added = await ana('POST', '/v1/capabilities/counterparties.add/execute', {
    idempotencyKey: 'e2e-payee',
    body: { args: { name: 'Northside Dental', accountIdentifier: '013-444 55667788', country: 'AU' } },
  });
  assert.equal(added.body.status, 'executed');

  const payment = await ana('POST', '/v1/capabilities/payments.domestic.initiate/execute', {
    idempotencyKey: 'e2e-dental',
    body: {
      args: {
        fromAccountId: ids.consumer.everydayId,
        counterpartyId: added.body.result.counterpartyId,
        amount: '320.00',
        currency: 'AUD',
      },
    },
  });
  assert.equal(payment.body.status, 'pending_approval');
  assert.ok(payment.body.decision.reasons.some((r) => r.code === 'COUNTERPARTY_IN_COOLING_OFF'));

  // Ana approves it herself, and it settles.
  const queue = await anaUser('GET', '/v1/approvals');
  const item = queue.body.pending.find((p) => p.approvalId === payment.body.approval.id);
  assert.equal(item.youMayApprove, true);
  assert.deepEqual(item.requestedBy, { type: 'agent', id: ids.consumer.agentId });

  const decided = await anaUser('POST', `/v1/approvals/${payment.body.approval.id}/decision`, {
    body: { decision: 'approve', comment: 'yes, that is my dentist' },
  });
  assert.equal(decided.body.status, 'approved');
  assert.equal(decided.body.execution.status, 'executed');
});

await step('an agent cannot approve, and cannot grant itself authority', async () => {
  const queue = await anaUser('GET', '/v1/approvals');
  assert.equal(queue.status, 200);

  const approve = await ana('POST', '/v1/approvals/apv_whatever/decision', { body: { decision: 'approve' } });
  assert.equal(approve.status, 403);

  const grant = await ana('POST', '/v1/mandates', {
    body: { autonomy: 'execute_within_limits', capabilities: ['*'], grantee: { type: 'agent', id: ids.consumer.agentId } },
  });
  assert.equal(grant.status, 403);
});

// ------------------------------------------------------------------ business
console.log('\n== business: Brightline Joinery ==');
const brightline = as(ids.business.entityId, { type: 'agent', id: ids.business.agentId });
const deepa = as(ids.business.entityId, { type: 'user', id: ids.business.ownerId });
const tom = as(ids.business.entityId, { type: 'user', id: ids.business.bookkeeperId });

await step('the forecast names the low point, not just the closing balance', async () => {
  const { body } = await brightline('POST', '/v1/capabilities/cashflow.forecast/execute', {
    body: { args: { accountId: ids.business.operatingId, horizonDays: 45 } },
  });
  assert.equal(body.status, 'executed');
  assert.ok(body.result.lowPoint.date);
  assert.ok(body.result.timeline.length > 0);
  assert.equal(body.result.openingAvailable, 'AUD 182,400.00');
});

await step('receivables are bucketed by how overdue they are', async () => {
  const { body } = await brightline('POST', '/v1/capabilities/receivables.aging/execute', { body: { args: {} } });
  assert.equal(body.status, 'executed');
  // Mornington was due 2026-10-15, so it is 21 days overdue on 5 Nov.
  assert.equal(body.result['1_30'].count, 1);
  assert.equal(body.result.current.count, 2);
});

await step('a payment run goes as one instruction', async () => {
  const { body } = await brightline('POST', '/v1/capabilities/payables.run.prepare/execute', {
    idempotencyKey: 'e2e-run',
    body: { args: { fromAccountId: ids.business.operatingId, payableIds: ids.business.payableIds, reference: 'November suppliers' } },
  });
  assert.equal(body.status, 'executed');
  assert.equal(body.result.lines, 3);
  assert.equal(body.result.total, 'AUD 23,395.40');
  assert.equal(body.result.valueDate, '2026-11-06'); // DE rail, T+1
});

await step('payroll over the dual-control threshold needs two different people', async () => {
  const funded = await brightline('POST', '/v1/capabilities/payroll.fund/execute', {
    idempotencyKey: 'e2e-payroll',
    body: {
      args: {
        fromAccountId: ids.business.operatingId,
        payrollAccountId: ids.business.payrollId,
        amount: '68500.00',
        currency: 'AUD',
        payPeriod: '2026-11-FN1',
        headcount: 34,
      },
    },
  });
  assert.equal(funded.body.status, 'pending_approval');
  assert.equal(funded.body.approval.required, 2);

  const first = await deepa('POST', `/v1/approvals/${funded.body.approval.id}/decision`, { body: { decision: 'approve' } });
  assert.equal(first.body.status, 'pending');
  assert.equal(first.body.execution, null);

  // The same person again is refused.
  const again = await deepa('POST', `/v1/approvals/${funded.body.approval.id}/decision`, { body: { decision: 'approve' } });
  assert.equal(again.status, 409);

  const second = await tom('POST', `/v1/approvals/${funded.body.approval.id}/decision`, { body: { decision: 'approve' } });
  assert.equal(second.body.status, 'approved');
  assert.equal(second.body.execution.status, 'executed');
  assert.equal(second.body.execution.result.amount, 'AUD 68,500.00');
});

// ------------------------------------------------------------- institutional
console.log('\n== institutional: Meridian Group Treasury ==');
const meridian = as(ids.institutional.treasuryEntityId, { type: 'agent', id: ids.institutional.agentId });
const priya = as(ids.institutional.treasuryEntityId, { type: 'user', id: ids.institutional.treasurerId });
const marcus = as(ids.institutional.treasuryEntityId, { type: 'user', id: ids.institutional.headOfTreasuryId });

await step('group liquidity spans the group, by currency and entity', async () => {
  const { body } = await meridian('POST', '/v1/capabilities/liquidity.position/execute', { body: { args: {} } });
  assert.equal(body.status, 'executed');
  assert.equal(body.result.scope, 'group');
  assert.equal(body.result.entities, 2);
  assert.equal(body.result.byCurrency.AUD.available, 'AUD 27,600,000.00');
  assert.equal(body.result.byCurrency.USD.available, 'USD 8,200,000.00');
  assert.equal(body.result.facilities.length, 2);
});

await step('a subsidiary sees only itself, whatever it asks for', async () => {
  const subsidiary = as(ids.institutional.subsidiaryEntityId, { type: 'agent', id: ids.institutional.agentId });
  const { body } = await subsidiary('POST', '/v1/capabilities/liquidity.position/execute', { body: { args: {} } });
  // The agent holds no mandate from the subsidiary at all.
  assert.equal(body.status, 'denied');
  assert.ok(body.decision.reasons.some((r) => r.code === 'NO_MANDATE'));
});

await step('documentary credits report their discrepancies', async () => {
  const { body } = await meridian('POST', '/v1/capabilities/tradefinance.lc.status/execute', { body: { args: {} } });
  assert.equal(body.result.length, 2);
  const flagged = body.result.find((lc) => lc.discrepancies.length > 0);
  assert.equal(flagged.reference, 'LC-2026-00502');
});

await step('a rate is quoted unattended, then booked only with approval', async () => {
  const quote = await meridian('POST', '/v1/capabilities/fx.quote/execute', {
    idempotencyKey: 'e2e-quote',
    body: { args: { sellCurrency: 'AUD', buyCurrency: 'USD', sellAmount: '2000000.00' } },
  });
  assert.equal(quote.body.status, 'executed');
  assert.equal(quote.body.result.rate, '0.65940000');

  const booking = await meridian('POST', '/v1/capabilities/fx.book/execute', {
    idempotencyKey: 'e2e-book',
    body: {
      args: {
        quoteId: quote.body.result.quoteId,
        sellAccountId: ids.institutional.treasuryAudId,
        buyAccountId: ids.institutional.treasuryUsdId,
      },
    },
  });
  assert.equal(booking.body.status, 'pending_approval');
  assert.equal(booking.body.approval.required, 2);

  await priya('POST', `/v1/approvals/${booking.body.approval.id}/decision`, { body: { decision: 'approve' } });
  const released = await marcus('POST', `/v1/approvals/${booking.body.approval.id}/decision`, { body: { decision: 'approve' } });
  assert.equal(released.body.execution.status, 'executed');
  assert.equal(released.body.execution.result.bought, 'USD 1,318,800.00');
});

await step('a blocked payee is refused outright, at any size', async () => {
  const { status, body } = await meridian('POST', '/v1/capabilities/payments.crossborder.initiate/execute', {
    idempotencyKey: 'e2e-blocked',
    body: {
      args: {
        fromAccountId: ids.institutional.treasuryEurId,
        counterpartyId: ids.institutional.blockedCounterpartyId,
        amount: '1000.00',
        currency: 'EUR',
      },
    },
  });
  assert.equal(status, 403);
  assert.ok(body.decision.reasons.some((r) => r.code === 'SCREENING_BLOCKED'));
});

await step('a cross-border payment states its fee and its value date up front', async () => {
  const preview = await meridian('POST', '/v1/capabilities/payments.crossborder.initiate/preview', {
    body: {
      args: {
        fromAccountId: ids.institutional.treasuryEurId,
        counterpartyId: ids.institutional.supplierId,
        amount: '400000.00',
        currency: 'EUR',
        purposeCode: 'GDDS',
      },
    },
  });
  assert.equal(preview.body.status, 'dry_run');
  assert.equal(preview.body.valueDate, '2026-11-06'); // SWIFT T+1
  // A preview creates nothing.
  const proposals = await meridian('GET', '/v1/proposals?status=draft');
  assert.equal(proposals.body.proposals.length, 0);
});

await step('a payment file is all-or-nothing and rejects an unknown payee', async () => {
  const { status, body } = await meridian('POST', '/v1/capabilities/payments.file.submit/execute', {
    idempotencyKey: 'e2e-file-bad',
    body: {
      args: {
        fromAccountId: ids.institutional.treasuryAudId,
        fileReference: 'HOST-2026-11-05-01',
        lines: [
          { counterpartyId: ids.institutional.supplierId, amount: '100000.00', currency: 'AUD' },
          { counterpartyId: 'cpt_nonexistent', amount: '50000.00', currency: 'AUD' },
        ],
      },
    },
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'FILE_UNKNOWN_COUNTERPARTY');
});

// ----------------------------------------------------------------- oversight
console.log('\n== oversight ==');
await step('the audit chain verifies after every journey above', async () => {
  const { body } = await meridian('GET', '/v1/admin/audit/verify');
  assert.equal(body.ok, true);
  assert.ok(body.records > 25);
});

await step('the ledger balances and no cached balance has drifted', async () => {
  const { body } = await meridian('GET', '/v1/admin/integrity');
  assert.equal(body.ok, true, JSON.stringify(body.balanceMismatches));
  assert.equal(body.journal.ok, true);
  assert.deepEqual(body.balanceMismatches, []);
});

await step('an identity cannot read another customer\'s data', async () => {
  const crossed = await fetch(`${base}/v1/capabilities/accounts.list/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bank-entity': ids.business.entityId,
      'x-bank-actor-type': 'agent',
      'x-bank-actor-id': ids.consumer.agentId,
      'idempotency-key': 'e2e-cross',
    },
    body: JSON.stringify({ args: {} }),
  });
  const body = await crossed.json();
  // The identity claims the business entity but holds no mandate there.
  assert.equal(body.status, 'denied');
});

server.close();
await bank.close();

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
