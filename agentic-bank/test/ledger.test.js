import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store/memory.js';
import { createLedger } from '../src/ledger/ledger.js';
import { fixedClock } from '../src/util/time.js';
import { parseDecimal as D, format, zero } from '../src/ledger/money.js';

async function setup() {
  const store = createMemoryStore();
  const ledger = createLedger({ store, clock: fixedClock('2026-11-04T23:00:00Z') });
  const customer = await ledger.openAccount({
    entityId: 'ent_c', name: 'Everyday', type: 'liability', currency: 'AUD',
    overdraftLimit: D('500.00', 'AUD'),
  });
  const bank = await ledger.openAccount({
    entityId: 'ent_bank', name: 'Clearing', type: 'asset', currency: 'AUD',
    purpose: 'clearing', enforceFunds: false,
  });
  await ledger.post({
    idempotencyKey: 'open', reference: 'Opening', type: 'deposit',
    entries: [
      { accountId: bank.id, direction: 'debit', amount: D('1000.00', 'AUD') },
      { accountId: customer.id, direction: 'credit', amount: D('1000.00', 'AUD') },
    ],
  });
  return { store, ledger, customer, bank };
}

test('a credit raises a liability account and a debit lowers it', async () => {
  const { ledger, customer } = await setup();
  assert.equal(format((await ledger.getBalance(customer.id)).cleared), '1,000.00');
});

test('rejects an unbalanced transaction', async () => {
  const { ledger, customer, bank } = await setup();
  await assert.rejects(
    ledger.post({
      idempotencyKey: 'u1',
      entries: [
        { accountId: customer.id, direction: 'debit', amount: D('10.00', 'AUD') },
        { accountId: bank.id, direction: 'credit', amount: D('11.00', 'AUD') },
      ],
    }),
    (e) => e.code === 'LEDGER_UNBALANCED',
  );
  // And leaves nothing behind.
  assert.equal(format((await ledger.getBalance(customer.id)).cleared), '1,000.00');
});

test('rejects a negative or zero entry amount', async () => {
  const { ledger, customer, bank } = await setup();
  for (const amount of ['-5.00', '0.00']) {
    await assert.rejects(
      ledger.post({
        idempotencyKey: `neg${amount}`,
        entries: [
          { accountId: customer.id, direction: 'debit', amount: D(amount, 'AUD') },
          { accountId: bank.id, direction: 'credit', amount: D(amount, 'AUD') },
        ],
      }),
      (e) => e.code === 'LEDGER_NON_POSITIVE_ENTRY',
    );
  }
});

test('an idempotency key replays rather than double-posting', async () => {
  const { ledger, customer, bank } = await setup();
  const entries = [
    { accountId: customer.id, direction: 'debit', amount: D('100.00', 'AUD') },
    { accountId: bank.id, direction: 'credit', amount: D('100.00', 'AUD') },
  ];
  const first = await ledger.post({ idempotencyKey: 'pay1', entries });
  const second = await ledger.post({ idempotencyKey: 'pay1', entries });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.transaction.id, first.transaction.id);
  assert.equal(format((await ledger.getBalance(customer.id)).cleared), '900.00');
});

test('holds reduce available balance without moving money', async () => {
  const { ledger, customer } = await setup();
  await ledger.placeHold({ accountId: customer.id, amount: D('200.00', 'AUD'), reference: 'card auth' });
  const balance = await ledger.getBalance(customer.id);
  assert.equal(format(balance.cleared), '1,000.00');
  assert.equal(format(balance.holds), '200.00');
  // 1000 cleared + 500 overdraft - 200 held
  assert.equal(format(balance.available), '1,300.00');
});

test('releasing a hold restores available balance', async () => {
  const { ledger, customer } = await setup();
  const hold = await ledger.placeHold({ accountId: customer.id, amount: D('200.00', 'AUD'), reference: 'auth' });
  await ledger.releaseHold(hold.id);
  assert.equal(format((await ledger.getBalance(customer.id)).available), '1,500.00');
});

test('enforces available funds including the overdraft limit', async () => {
  const { ledger, customer, bank } = await setup();
  const spend = (amount, key) => ledger.post({
    idempotencyKey: key,
    entries: [
      { accountId: customer.id, direction: 'debit', amount: D(amount, 'AUD') },
      { accountId: bank.id, direction: 'credit', amount: D(amount, 'AUD') },
    ],
  });

  // 1000 + 500 overdraft = 1500 available.
  await spend('1500.00', 'ok');
  assert.equal(format((await ledger.getBalance(customer.id)).cleared), '-500.00');
  await assert.rejects(spend('0.01', 'over'), (e) => e.code === 'LEDGER_INSUFFICIENT_FUNDS');
});

test('a hold cannot be placed beyond available funds', async () => {
  const { ledger, customer } = await setup();
  await assert.rejects(
    ledger.placeHold({ accountId: customer.id, amount: D('1600.00', 'AUD'), reference: 'too big' }),
    (e) => e.code === 'LEDGER_INSUFFICIENT_FUNDS',
  );
});

test('a bank-internal account may run a position past zero', async () => {
  const { ledger, bank } = await setup();
  const funding = await ledger.openAccount({
    entityId: 'ent_bank', name: 'Funding', type: 'asset', currency: 'AUD',
    purpose: 'funding', enforceFunds: false,
  });
  // Clearing started at +1000 (debit side); push it well past zero the other
  // way. A customer account could not do this — the funds check would stop it.
  await ledger.post({
    idempotencyKey: 'position',
    entries: [
      { accountId: bank.id, direction: 'credit', amount: D('50000.00', 'AUD') },
      { accountId: funding.id, direction: 'debit', amount: D('50000.00', 'AUD') },
    ],
  });
  assert.equal(format((await ledger.getBalance(bank.id)).cleared), '-49,000.00');
});

test('a frozen account refuses postings; a closed one refuses them permanently', async () => {
  const { ledger, customer, bank } = await setup();
  const spend = (key) => ledger.post({
    idempotencyKey: key,
    entries: [
      { accountId: customer.id, direction: 'debit', amount: D('1.00', 'AUD') },
      { accountId: bank.id, direction: 'credit', amount: D('1.00', 'AUD') },
    ],
  });
  await ledger.setAccountStatus(customer.id, 'frozen');
  await assert.rejects(spend('f1'), (e) => e.code === 'LEDGER_ACCOUNT_FROZEN');
  await ledger.setAccountStatus(customer.id, 'closed');
  await assert.rejects(spend('f2'), (e) => e.code === 'LEDGER_ACCOUNT_CLOSED');
});

test('rejects an entry whose currency differs from the account', async () => {
  const { ledger, customer, bank } = await setup();
  await assert.rejects(
    ledger.post({
      idempotencyKey: 'ccy',
      entries: [
        { accountId: customer.id, direction: 'debit', amount: D('10.00', 'USD') },
        { accountId: bank.id, direction: 'credit', amount: D('10.00', 'USD') },
      ],
    }),
    (e) => e.code === 'CURRENCY_MISMATCH',
  );
});

test('a multi-currency transaction must balance in each currency', async () => {
  const store = createMemoryStore();
  const ledger = createLedger({ store, clock: fixedClock('2026-11-04T23:00:00Z') });
  const aud = await ledger.openAccount({ entityId: 'e', name: 'AUD', type: 'liability', currency: 'AUD' });
  const usd = await ledger.openAccount({ entityId: 'e', name: 'USD', type: 'liability', currency: 'USD' });
  const posAud = await ledger.openAccount({ entityId: 'ent_bank', name: 'Pos AUD', type: 'asset', currency: 'AUD', enforceFunds: false });
  const posUsd = await ledger.openAccount({ entityId: 'ent_bank', name: 'Pos USD', type: 'asset', currency: 'USD', enforceFunds: false });

  // Netting across currencies must NOT be treated as balanced.
  await assert.rejects(
    ledger.post({
      idempotencyKey: 'fx-bad',
      entries: [
        { accountId: aud.id, direction: 'debit', amount: D('100.00', 'AUD') },
        { accountId: usd.id, direction: 'credit', amount: D('66.00', 'USD') },
      ],
    }),
    (e) => e.code === 'LEDGER_UNBALANCED',
  );

  // Two balanced legs, one per currency, is correct. Fund the AUD side first:
  // selling AUD means debiting the customer, which needs the funds to be there.
  await ledger.post({
    idempotencyKey: 'fund-aud',
    entries: [
      { accountId: posAud.id, direction: 'debit', amount: D('500.00', 'AUD') },
      { accountId: aud.id, direction: 'credit', amount: D('500.00', 'AUD') },
    ],
  });
  await ledger.post({
    idempotencyKey: 'fx-good',
    entries: [
      // Customer sells AUD 100 ...
      { accountId: aud.id, direction: 'debit', amount: D('100.00', 'AUD') },
      { accountId: posAud.id, direction: 'credit', amount: D('100.00', 'AUD') },
      // ... and receives USD 66.
      { accountId: posUsd.id, direction: 'debit', amount: D('66.00', 'USD') },
      { accountId: usd.id, direction: 'credit', amount: D('66.00', 'USD') },
    ],
  });
  assert.equal(format((await ledger.getBalance(aud.id)).cleared), '400.00');
  assert.equal(format((await ledger.getBalance(usd.id)).cleared), '66.00');
  assert.equal((await ledger.verifyJournal()).ok, true);
});

test('cached balances match the journal, and the journal balances', async () => {
  const { ledger, customer, bank } = await setup();
  for (let i = 0; i < 5; i += 1) {
    await ledger.post({
      idempotencyKey: `m${i}`,
      entries: [
        { accountId: customer.id, direction: 'debit', amount: D('13.37', 'AUD') },
        { accountId: bank.id, direction: 'credit', amount: D('13.37', 'AUD') },
      ],
    });
  }
  for (const id of [customer.id, bank.id]) {
    const check = await ledger.verifyBalance(id);
    assert.equal(check.ok, true, `${id} cached ${check.cached.amount} vs computed ${check.computed.amount}`);
  }
  assert.equal((await ledger.verifyJournal()).ok, true);
});

test('requires an idempotency key', async () => {
  const { ledger, customer, bank } = await setup();
  await assert.rejects(
    ledger.post({
      entries: [
        { accountId: customer.id, direction: 'debit', amount: D('1.00', 'AUD') },
        { accountId: bank.id, direction: 'credit', amount: D('1.00', 'AUD') },
      ],
    }),
    (e) => e.code === 'LEDGER_NO_IDEMPOTENCY',
  );
});
