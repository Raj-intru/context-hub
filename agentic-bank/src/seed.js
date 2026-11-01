// Demo data.
//
// Three customers, one per segment, each with the mandates, accounts and
// instruments needed to exercise a real journey. Exported as a function so the
// test suite seeds the same world the demo does — a test that passes against
// fixtures the demo never uses is a test that proves nothing about the demo.

import { parseDecimal as D, zero } from './ledger/money.js';
import { BANK_ENTITY_ID } from './services/bank.js';
import { AUTONOMY } from './kernel/mandates.js';
import { makePayable, makeReceivable } from './capabilities/business.js';
import { makeFacility, makeLetterOfCredit } from './capabilities/institutional.js';
import { newId } from './util/ids.js';

const BANK_CURRENCIES = ['AUD', 'USD', 'EUR', 'JPY', 'SGD', 'GBP'];
const BANK_PURPOSES = ['clearing', 'nostro', 'fee_income', 'fx_position', 'funding'];

export async function seed(bank) {
  const { store, ledger, mandates, clock } = bank;
  const ids = {};

  // ---------------------------------------------------------------- the bank
  await store.withTransaction((tx) =>
    tx.insert('entities', {
      id: BANK_ENTITY_ID,
      name: 'The Bank',
      segment: 'institutional',
      status: 'active',
      kycStatus: 'verified',
      groupId: null,
    }));

  for (const currency of BANK_CURRENCIES) {
    for (const purpose of BANK_PURPOSES) {
      await ledger.openAccount({
        entityId: BANK_ENTITY_ID,
        name: `Bank ${purpose} ${currency}`,
        // Clearing, nostro and FX positions are the bank's own asset/liability
        // positions and legitimately run intraday balances in either direction.
        type: purpose === 'fee_income' ? 'income' : 'asset',
        currency,
        purpose,
        enforceFunds: false,
      });
    }
  }

  const funding = async (currency) => {
    const [account] = await store.find('accounts', {
      entityId: BANK_ENTITY_ID, purpose: 'funding', currency,
    });
    return account;
  };

  /** Put money into a customer account from the bank's funding account. */
  async function fund(accountId, amount, narrative = 'Opening balance') {
    const source = await funding(amount.currency);
    await ledger.post({
      idempotencyKey: `seed:${accountId}:${narrative}:${amount.amount}`,
      reference: narrative,
      type: 'seed_deposit',
      entries: [
        { accountId: source.id, direction: 'debit', amount, narrative },
        { accountId, direction: 'credit', amount, narrative },
      ],
    });
  }

  // ------------------------------------------------------------- 1. consumer
  ids.consumer = { entityId: newId('entity'), userId: newId('user'), agentId: newId('agent') };

  await store.withTransaction(async (tx) => {
    await tx.insert('entities', {
      id: ids.consumer.entityId,
      name: 'Ana Ferreira',
      segment: 'consumer',
      status: 'active',
      kycStatus: 'verified',
      groupId: null,
    });
    await tx.insert('users', {
      id: ids.consumer.userId,
      entityId: ids.consumer.entityId,
      name: 'Ana Ferreira',
      email: 'ana@example.test',
      roles: ['owner'],
    });
    await tx.insert('agents', {
      id: ids.consumer.agentId,
      entityId: ids.consumer.entityId,
      name: 'Ana\'s banking agent',
      kind: 'bank_agent',
    });
  });

  const anaEveryday = await ledger.openAccount({
    entityId: ids.consumer.entityId,
    name: 'Everyday',
    type: 'liability',
    currency: 'AUD',
    overdraftLimit: D('500.00', 'AUD'),
  });
  const anaSavings = await ledger.openAccount({
    entityId: ids.consumer.entityId,
    name: 'Savings',
    type: 'liability',
    currency: 'AUD',
  });
  ids.consumer.everydayId = anaEveryday.id;
  ids.consumer.savingsId = anaSavings.id;

  await fund(anaEveryday.id, D('4280.55', 'AUD'), 'Salary');
  await fund(anaSavings.id, D('15750.00', 'AUD'), 'Savings transfer in');

  // A card, and recurring debits for subscriptions.review to find.
  ids.consumer.cardId = newId('instrument');
  await store.withTransaction((tx) =>
    tx.insert('instruments', {
      id: ids.consumer.cardId,
      entityId: ids.consumer.entityId,
      type: 'card',
      accountId: anaEveryday.id,
      maskedNumber: '•••• 4417',
      frozen: false,
      limits: { per_transaction: D('2000.00', 'AUD'), daily: D('3000.00', 'AUD') },
    }));

  const clearingAud = (await store.find('accounts', {
    entityId: BANK_ENTITY_ID, purpose: 'clearing', currency: 'AUD',
  }))[0];

  for (const [narrative, amount, times] of [
    ['STREAMFLIX MONTHLY', '22.99', 3],
    ['CITY GYM MEMBERSHIP', '79.00', 3],
    ['CLOUD BACKUP PRO', '14.95', 2],
    ['COFFEE ROASTERS', '6.50', 1],
  ]) {
    for (let i = 0; i < times; i += 1) {
      await ledger.post({
        idempotencyKey: `seed:sub:${narrative}:${i}`,
        reference: narrative,
        type: 'card_purchase',
        entries: [
          { accountId: anaEveryday.id, direction: 'debit', amount: D(amount, 'AUD'), narrative },
          { accountId: clearingAud.id, direction: 'credit', amount: D(amount, 'AUD'), narrative },
        ],
      });
    }
  }

  // A payee that is past its cooling-off period, so the happy path works.
  ids.consumer.landlordId = newId('counterparty');
  await store.withTransaction((tx) =>
    tx.insert('counterparties', {
      id: ids.consumer.landlordId,
      entityId: ids.consumer.entityId,
      name: 'Harbourview Property Management',
      accountIdentifier: '062-000 12345678',
      country: 'AU',
      screening: { status: 'clear', matches: [], provider: 'stub', screenedAt: clock.now().toISOString() },
      addedAt: new Date(clock.now().getTime() - 90 * 86_400_000).toISOString(),
    }));

  ids.consumer.mandateId = (await mandates.create({
    entityId: ids.consumer.entityId,
    grantee: { type: 'agent', id: ids.consumer.agentId },
    grantedBy: ids.consumer.userId,
    autonomy: AUTONOMY.EXECUTE_WITHIN_LIMITS,
    label: 'Everyday banking agent',
    capabilities: [
      'accounts.*', 'counterparties.*', 'transfers.internal',
      'payments.domestic.initiate', 'cards.*', 'savings.*',
      'subscriptions.review', 'disputes.raise',
    ],
    accounts: ['*'],
    limits: {
      perTransaction: { AUD: D('2500.00', 'AUD') },
      daily: { AUD: D('5000.00', 'AUD') },
    },
    counterparties: { mode: 'any', ids: [] },
  })).id;

  // ------------------------------------------------------------- 2. business
  ids.business = {
    entityId: newId('entity'),
    ownerId: newId('user'),
    bookkeeperId: newId('user'),
    agentId: newId('agent'),
  };

  await store.withTransaction(async (tx) => {
    await tx.insert('entities', {
      id: ids.business.entityId,
      name: 'Brightline Joinery Pty Ltd',
      segment: 'business',
      status: 'active',
      kycStatus: 'verified',
      groupId: null,
    });
    await tx.insert('users', {
      id: ids.business.ownerId, entityId: ids.business.entityId, name: 'Deepa Raman', email: 'deepa@brightline.test', roles: ['owner', 'approver'],
    });
    await tx.insert('users', {
      id: ids.business.bookkeeperId, entityId: ids.business.entityId, name: 'Tom Alvarez', email: 'tom@brightline.test', roles: ['bookkeeper', 'approver'],
    });
    await tx.insert('agents', {
      id: ids.business.agentId, entityId: ids.business.entityId, name: 'Brightline treasury agent', kind: 'bank_agent',
    });
  });

  const bizOperating = await ledger.openAccount({
    entityId: ids.business.entityId, name: 'Operating', type: 'liability', currency: 'AUD',
  });
  const bizPayroll = await ledger.openAccount({
    entityId: ids.business.entityId, name: 'Payroll disbursement', type: 'liability', currency: 'AUD',
  });
  ids.business.operatingId = bizOperating.id;
  ids.business.payrollId = bizPayroll.id;
  await fund(bizOperating.id, D('182400.00', 'AUD'), 'Customer receipts');

  const supplierNames = [
    ['Tasman Timber Supplies', '14820.00', '2026-11-12'],
    ['Apex Hardware Wholesale', '6395.40', '2026-11-09'],
    ['Southbank Freight', '2180.00', '2026-11-20'],
  ];
  ids.business.payableIds = [];
  ids.business.counterpartyIds = [];
  for (const [name, amount, dueDate] of supplierNames) {
    const counterpartyId = newId('counterparty');
    await store.withTransaction((tx) =>
      tx.insert('counterparties', {
        id: counterpartyId,
        entityId: ids.business.entityId,
        name,
        accountIdentifier: `083-${Math.floor(Math.random() * 900 + 100)} ${Math.floor(Math.random() * 9e7 + 1e7)}`,
        country: 'AU',
        screening: { status: 'clear', matches: [], provider: 'stub', screenedAt: clock.now().toISOString() },
        addedAt: new Date(clock.now().getTime() - 120 * 86_400_000).toISOString(),
      }));
    const payable = makePayable({
      entityId: ids.business.entityId,
      counterpartyId,
      counterpartyName: name,
      description: `Invoice from ${name}`,
      amount: D(amount, 'AUD'),
      dueDate,
    });
    await store.withTransaction((tx) => tx.insert('instruments', payable));
    ids.business.payableIds.push(payable.id);
    ids.business.counterpartyIds.push(counterpartyId);
  }

  for (const [customer, amount, expectedDate] of [
    ['Kingsley Developments', '48900.00', '2026-11-08'],
    ['Mornington Fitouts', '22150.00', '2026-10-15'],
    ['Civic Projects Group', '91300.00', '2026-11-28'],
  ]) {
    await store.withTransaction((tx) =>
      tx.insert('instruments', makeReceivable({
        entityId: ids.business.entityId,
        counterpartyName: customer,
        description: `Progress claim - ${customer}`,
        amount: D(amount, 'AUD'),
        expectedDate,
      })));
  }

  await store.withTransaction((tx) =>
    tx.insert('instruments', makeFacility({
      entityId: ids.business.entityId,
      kind: 'overdraft',
      limit: D('150000.00', 'AUD'),
      drawn: zero('AUD'),
      maturity: '2027-06-30',
    })));

  // Two mandates on purpose: the agent may run payables, but anything at or
  // above 50k needs two of the three named humans.
  ids.business.mandateId = (await mandates.create({
    entityId: ids.business.entityId,
    grantee: { type: 'agent', id: ids.business.agentId },
    grantedBy: ids.business.ownerId,
    autonomy: AUTONOMY.EXECUTE_WITHIN_LIMITS,
    label: 'Treasury agent - payables and reporting',
    capabilities: [
      'accounts.*', 'counterparties.list', 'cashflow.forecast', 'receivables.aging',
      'limits.utilisation', 'payables.run.prepare', 'payroll.fund', 'transfers.internal',
      'payments.domestic.initiate', 'fx.quote',
    ],
    accounts: ['*'],
    limits: {
      perTransaction: { AUD: D('75000.00', 'AUD') },
      daily: { AUD: D('200000.00', 'AUD') },
    },
    dualControl: {
      thresholdAbove: { AUD: D('50000.00', 'AUD') },
      requiredApprovals: 2,
      approvers: [ids.business.ownerId, ids.business.bookkeeperId],
    },
  })).id;

  // -------------------------------------------------------- 3. institutional
  ids.institutional = {
    groupId: 'grp_meridian',
    treasuryEntityId: newId('entity'),
    subsidiaryEntityId: newId('entity'),
    treasurerId: newId('user'),
    headOfTreasuryId: newId('user'),
    agentId: newId('agent'),
  };

  await store.withTransaction(async (tx) => {
    await tx.insert('entities', {
      id: ids.institutional.treasuryEntityId,
      name: 'Meridian Group Treasury Pte Ltd',
      segment: 'institutional',
      status: 'active',
      kycStatus: 'verified',
      groupId: ids.institutional.groupId,
      groupTreasury: true,
    });
    await tx.insert('entities', {
      id: ids.institutional.subsidiaryEntityId,
      name: 'Meridian Australia Pty Ltd',
      segment: 'institutional',
      status: 'active',
      kycStatus: 'verified',
      groupId: ids.institutional.groupId,
      groupTreasury: false,
    });
    await tx.insert('users', {
      id: ids.institutional.treasurerId,
      entityId: ids.institutional.treasuryEntityId,
      name: 'Priya Nair',
      email: 'priya@meridian.test',
      roles: ['treasurer', 'approver'],
    });
    await tx.insert('users', {
      id: ids.institutional.headOfTreasuryId,
      entityId: ids.institutional.treasuryEntityId,
      name: 'Marcus Lindqvist',
      email: 'marcus@meridian.test',
      roles: ['head_of_treasury', 'approver'],
    });
    await tx.insert('agents', {
      id: ids.institutional.agentId,
      entityId: ids.institutional.treasuryEntityId,
      name: 'Meridian treasury agent',
      kind: 'bank_agent',
    });
  });

  const treasuryAud = await ledger.openAccount({
    entityId: ids.institutional.treasuryEntityId, name: 'Treasury AUD', type: 'liability', currency: 'AUD',
  });
  const treasuryUsd = await ledger.openAccount({
    entityId: ids.institutional.treasuryEntityId, name: 'Treasury USD', type: 'liability', currency: 'USD',
  });
  const treasuryEur = await ledger.openAccount({
    entityId: ids.institutional.treasuryEntityId, name: 'Treasury EUR', type: 'liability', currency: 'EUR',
  });
  const subAud = await ledger.openAccount({
    entityId: ids.institutional.subsidiaryEntityId, name: 'Operating AUD', type: 'liability', currency: 'AUD',
  });
  Object.assign(ids.institutional, {
    treasuryAudId: treasuryAud.id,
    treasuryUsdId: treasuryUsd.id,
    treasuryEurId: treasuryEur.id,
    subsidiaryAudId: subAud.id,
  });

  await fund(treasuryAud.id, D('24500000.00', 'AUD'), 'Intercompany funding');
  await fund(treasuryUsd.id, D('8200000.00', 'USD'), 'USD receipts');
  await fund(treasuryEur.id, D('1450000.00', 'EUR'), 'EUR receipts');
  await fund(subAud.id, D('3100000.00', 'AUD'), 'Operating float');

  ids.institutional.supplierId = newId('counterparty');
  await store.withTransaction((tx) =>
    tx.insert('counterparties', {
      id: ids.institutional.supplierId,
      entityId: ids.institutional.treasuryEntityId,
      name: 'Hanseatic Components GmbH',
      accountIdentifier: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
      country: 'DE',
      screening: { status: 'clear', matches: [], provider: 'stub', screenedAt: clock.now().toISOString() },
      addedAt: new Date(clock.now().getTime() - 200 * 86_400_000).toISOString(),
    }));

  // A payee that screening blocks, so the refusal path is demonstrable.
  ids.institutional.blockedCounterpartyId = newId('counterparty');
  await store.withTransaction((tx) =>
    tx.insert('counterparties', {
      id: ids.institutional.blockedCounterpartyId,
      entityId: ids.institutional.treasuryEntityId,
      name: 'Volkov Industrial Holdings',
      accountIdentifier: 'LV80BANK0000435195001',
      country: 'LV',
      addedAt: new Date(clock.now().getTime() - 10 * 86_400_000).toISOString(),
    }));

  await store.withTransaction(async (tx) => {
    await tx.insert('instruments', makeFacility({
      entityId: ids.institutional.treasuryEntityId,
      kind: 'revolving_credit',
      limit: D('50000000.00', 'AUD'),
      drawn: D('12000000.00', 'AUD'),
      maturity: '2028-03-31',
    }));
    await tx.insert('instruments', makeFacility({
      entityId: ids.institutional.treasuryEntityId,
      kind: 'intraday_payment_limit',
      limit: D('20000000.00', 'AUD'),
      drawn: D('4250000.00', 'AUD'),
    }));
    await tx.insert('instruments', makeLetterOfCredit({
      entityId: ids.institutional.treasuryEntityId,
      reference: 'LC-2026-00418',
      beneficiary: 'Hanseatic Components GmbH',
      issued: D('2400000.00', 'EUR'),
      utilised: D('900000.00', 'EUR'),
      expiry: '2027-02-28',
      latestShipment: '2027-01-31',
      discrepancies: [],
    }));
    await tx.insert('instruments', makeLetterOfCredit({
      entityId: ids.institutional.treasuryEntityId,
      reference: 'LC-2026-00502',
      beneficiary: 'Pacific Steel Trading Ltd',
      issued: D('1150000.00', 'USD'),
      utilised: zero('USD'),
      expiry: '2026-12-15',
      latestShipment: '2026-11-30',
      discrepancies: ['Bill of lading date later than latest shipment date'],
    }));
  });

  // Two mandates, deliberately split, because this is how a treasury actually
  // delegates: the agent may look at anything and ask for a price unattended,
  // but it may not deal or pay without a human. Note that `fx.quote` sits in
  // the unattended mandate — a rate request that needed two signatures would
  // always expire before it could be used, and a treasury would never adopt it.
  ids.institutional.readMandateId = (await mandates.create({
    entityId: ids.institutional.treasuryEntityId,
    grantee: { type: 'agent', id: ids.institutional.agentId },
    grantedBy: ids.institutional.headOfTreasuryId,
    autonomy: AUTONOMY.EXECUTE_WITHIN_LIMITS,
    label: 'Treasury agent - reporting and pricing',
    capabilities: [
      'accounts.*', 'counterparties.list', 'liquidity.position', 'limits.utilisation',
      'cashflow.forecast', 'tradefinance.lc.status', 'fx.quote',
    ],
    accounts: ['*'],
    window: {
      timeZone: 'Australia/Sydney',
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      hours: { from: '07:00', to: '19:00' },
    },
  })).id;

  // Everything that moves value: approved, every time, with two signatures
  // over the thresholds.
  ids.institutional.mandateId = (await mandates.create({
    entityId: ids.institutional.treasuryEntityId,
    grantee: { type: 'agent', id: ids.institutional.agentId },
    grantedBy: ids.institutional.headOfTreasuryId,
    autonomy: AUTONOMY.EXECUTE_WITH_APPROVAL,
    label: 'Treasury agent - approved execution',
    capabilities: [
      'fx.book', 'payments.crossborder.initiate', 'payments.file.submit', 'transfers.internal',
    ],
    accounts: ['*'],
    limits: {
      perTransaction: { AUD: D('10000000.00', 'AUD'), USD: D('7000000.00', 'USD'), EUR: D('5000000.00', 'EUR') },
      daily: { AUD: D('25000000.00', 'AUD'), USD: D('15000000.00', 'USD'), EUR: D('10000000.00', 'EUR') },
    },
    dualControl: {
      thresholdAbove: { AUD: D('1000000.00', 'AUD'), USD: D('750000.00', 'USD'), EUR: D('500000.00', 'EUR') },
      requiredApprovals: 2,
      approvers: [ids.institutional.treasurerId, ids.institutional.headOfTreasuryId],
    },
    window: {
      timeZone: 'Australia/Sydney',
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      hours: { from: '07:00', to: '19:00' },
    },
  })).id;

  // A read-only mandate for a person, used to show segregation of duties:
  // Priya can approve but is not the one instructing.
  await mandates.create({
    entityId: ids.institutional.treasuryEntityId,
    grantee: { type: 'user', id: ids.institutional.treasurerId },
    grantedBy: ids.institutional.headOfTreasuryId,
    autonomy: AUTONOMY.PROPOSE_ONLY,
    label: 'Treasurer - read and propose',
    capabilities: ['accounts.*', 'liquidity.position', 'limits.utilisation', 'tradefinance.lc.status'],
    accounts: ['*'],
  });

  return ids;
}
