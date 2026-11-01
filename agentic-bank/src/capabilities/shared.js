// Capabilities every segment gets: see your money, move it between your own
// accounts, manage payees, pay someone domestically.

import { parseDecimal, formatWithCurrency, zero, add } from '../ledger/money.js';
import { newId } from '../util/ids.js';
import { resolveBankAccount } from '../services/bank.js';

const AMOUNT_FIELDS = {
  amount: { type: 'string', format: 'amount', description: 'Decimal amount, e.g. "1250.00". Never a number.' },
  currency: { type: 'string', format: 'currency', description: 'ISO-4217 code, e.g. "AUD".' },
};

export function registerSharedCapabilities(registry) {
  registry.register({
    id: 'accounts.list',
    title: 'List accounts',
    description: "List the customer's accounts with currency and status.",
    riskClass: 'read',
    mutating: false,
    input: { type: 'object', additionalProperties: false, properties: {} },
    async plan(_args, { entity }) {
      return { summary: `List accounts for ${entity.name}`, accountIds: [] };
    },
    async execute(_proposal, { ledger, entity }) {
      const accounts = await ledger.listAccounts(entity.id);
      return accounts.map((a) => ({
        id: a.id, name: a.name, currency: a.currency, status: a.status, purpose: a.purpose,
      }));
    },
  });

  registry.register({
    id: 'accounts.balance',
    title: 'Account balance',
    description:
      'Cleared balance, funds on hold, and available balance for one account. '
      + 'Available balance is what can actually be spent; quote that, not the cleared balance.',
    riskClass: 'read',
    mutating: false,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['accountId'],
      properties: { accountId: { type: 'string', format: 'identifier' } },
    },
    async plan(args, { entity }) {
      return {
        summary: `Read balance of ${args.accountId}`,
        accountIds: [args.accountId],
        details: { entityId: entity.id },
      };
    },
    async execute(proposal, { ledger }) {
      const balance = await ledger.getBalance(proposal.args.accountId);
      return {
        accountId: balance.accountId,
        currency: balance.currency,
        cleared: formatWithCurrency(balance.cleared),
        onHold: formatWithCurrency(balance.holds),
        available: formatWithCurrency(balance.available),
        overdraftLimit: formatWithCurrency(balance.overdraftLimit),
      };
    },
  });

  registry.register({
    id: 'accounts.statement',
    title: 'Account statement',
    description: 'Recent postings on an account, newest first.',
    riskClass: 'read',
    mutating: false,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['accountId'],
      properties: {
        accountId: { type: 'string', format: 'identifier' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 25 },
      },
    },
    async plan(args) {
      return { summary: `Statement for ${args.accountId}`, accountIds: [args.accountId] };
    },
    async execute(proposal, { ledger }) {
      const postings = await ledger.getStatement(proposal.args.accountId, { limit: proposal.args.limit });
      return postings.map((p) => ({
        date: p.valueDate,
        narrative: p.narrative,
        direction: p.direction,
        amount: formatWithCurrency(p.amount),
        transactionId: p.transactionId,
      }));
    },
  });

  registry.register({
    id: 'counterparties.list',
    title: 'List payees',
    description: 'Known payees, with their screening status and whether they are still in cooling-off.',
    riskClass: 'read',
    mutating: false,
    input: { type: 'object', additionalProperties: false, properties: {} },
    async plan(_args, { entity }) {
      return { summary: `List payees for ${entity.name}` };
    },
    async execute(_proposal, { store, entity }) {
      const rows = await store.find('counterparties', { entityId: entity.id });
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        country: c.country,
        accountIdentifier: c.accountIdentifier,
        screening: c.screening?.status ?? 'not_screened',
        addedAt: c.addedAt,
      }));
    },
  });

  registry.register({
    id: 'counterparties.add',
    title: 'Add a payee',
    description:
      'Register a new payee. The payee is screened on creation and enters a cooling-off period, '
      + 'during which payments to it need human approval.',
    riskClass: 'medium',
    mutating: true,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'accountIdentifier'],
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 140 },
        accountIdentifier: { type: 'string', minLength: 4, maxLength: 64, description: 'BSB+account, IBAN or local equivalent.' },
        bic: { type: 'string', format: 'bic' },
        country: { type: 'string', pattern: '^[A-Z]{2}$' },
        reference: { type: 'string', maxLength: 140 },
      },
    },
    async plan(args, { entity }) {
      return {
        summary: `Add payee ${args.name} (${args.accountIdentifier})`,
        details: { name: args.name, country: args.country ?? null, entityId: entity.id },
      };
    },
    async execute(proposal, { store, clock, screening, entity }) {
      const { args } = proposal;
      const result = await screening.screen({ name: args.name, country: args.country ?? null, bic: args.bic ?? null });
      const counterparty = {
        id: newId('counterparty'),
        entityId: entity.id,
        name: args.name,
        accountIdentifier: args.accountIdentifier,
        bic: args.bic ?? null,
        country: args.country ?? null,
        reference: args.reference ?? null,
        screening: result,
        addedAt: clock.now().toISOString(),
        addedBy: proposal.initiator,
      };
      await store.withTransaction((tx) => tx.insert('counterparties', counterparty));
      return {
        counterpartyId: counterparty.id,
        name: counterparty.name,
        screening: result.status,
        note:
          result.status === 'clear'
            ? 'Payee added. Payments to a new payee need approval during the cooling-off period.'
            : `Payee added but screening returned "${result.status}"; payments will be held.`,
      };
    },
  });

  registry.register({
    id: 'transfers.internal',
    title: 'Transfer between own accounts',
    description:
      "Move money between two accounts the customer already holds. No external counterparty, "
      + 'so this does not need a payee and settles immediately.',
    riskClass: 'medium',
    mutating: true,
    debitsFunds: true,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['fromAccountId', 'toAccountId', 'amount', 'currency'],
      properties: {
        fromAccountId: { type: 'string', format: 'identifier' },
        toAccountId: { type: 'string', format: 'identifier' },
        ...AMOUNT_FIELDS,
        reference: { type: 'string', maxLength: 140, default: 'Internal transfer' },
      },
    },
    async plan(args, { entity }) {
      if (args.fromAccountId === args.toAccountId) {
        const err = new Error('Source and destination accounts are the same');
        err.code = 'SAME_ACCOUNT';
        throw err;
      }
      const amount = parseDecimal(args.amount, args.currency);
      return {
        summary: `Transfer ${formatWithCurrency(amount)} from ${args.fromAccountId} to ${args.toAccountId}`,
        amount,
        accountIds: [args.fromAccountId, args.toAccountId],
        sourceAccountId: args.fromAccountId,
        details: { reference: args.reference, entityId: entity.id },
      };
    },
    async execute(proposal, { ledger }) {
      const amount = parseDecimal(proposal.args.amount, proposal.args.currency);
      const { transaction } = await ledger.post({
        idempotencyKey: `${proposal.id}:transfer`,
        reference: proposal.args.reference,
        type: 'internal_transfer',
        metadata: { proposalId: proposal.id, mandateId: proposal.mandateId },
        entries: [
          { accountId: proposal.args.fromAccountId, direction: 'debit', amount, narrative: proposal.args.reference },
          { accountId: proposal.args.toAccountId, direction: 'credit', amount, narrative: proposal.args.reference },
        ],
      });
      return {
        transactionId: transaction.id,
        amount: formatWithCurrency(amount),
        valueDate: transaction.valueDate,
        settled: true,
      };
    },
  });

  registry.register({
    id: 'payments.domestic.initiate',
    title: 'Domestic payment',
    description:
      'Pay a registered payee in the domestic currency. Requires a counterparty that has been '
      + 'added and screened. Value date depends on the rail cut-off; the bank will tell you if it rolls.',
    riskClass: 'high',
    mutating: true,
    requiresCounterparty: true,
    debitsFunds: true,
    rail: { name: 'NPP', cutOff: '22:00', lagDays: 0 },
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['fromAccountId', 'counterpartyId', 'amount', 'currency'],
      properties: {
        fromAccountId: { type: 'string', format: 'identifier' },
        counterpartyId: { type: 'string', format: 'identifier' },
        ...AMOUNT_FIELDS,
        reference: { type: 'string', maxLength: 140, default: 'Payment' },
        priority: { type: 'string', enum: ['normal', 'urgent'], default: 'normal' },
      },
    },
    async plan(args, { store, entity }) {
      const amount = parseDecimal(args.amount, args.currency);
      const counterparty = await store.get('counterparties', args.counterpartyId);
      return {
        summary: `Pay ${formatWithCurrency(amount)} to ${counterparty?.name ?? args.counterpartyId}`,
        amount,
        accountIds: [args.fromAccountId],
        sourceAccountId: args.fromAccountId,
        counterpartyId: args.counterpartyId,
        details: { reference: args.reference, priority: args.priority, entityId: entity.id },
      };
    },
    async execute(proposal, { ledger, store, decision }) {
      const amount = parseDecimal(proposal.args.amount, proposal.args.currency);
      const counterparty = await store.get('counterparties', proposal.args.counterpartyId);
      const clearing = await resolveBankAccount(store, {
        purpose: 'clearing',
        currency: proposal.args.currency,
      });

      const { transaction } = await ledger.post({
        idempotencyKey: `${proposal.id}:payment`,
        reference: proposal.args.reference,
        type: 'domestic_payment',
        valueDate: decision?.valueDate ?? null,
        metadata: {
          proposalId: proposal.id,
          mandateId: proposal.mandateId,
          counterpartyId: counterparty.id,
          rail: 'NPP',
        },
        entries: [
          {
            accountId: proposal.args.fromAccountId,
            direction: 'debit',
            amount,
            narrative: `${proposal.args.reference} - ${counterparty.name}`,
          },
          {
            accountId: clearing.id,
            direction: 'credit',
            amount,
            narrative: `Outbound to ${counterparty.name}`,
          },
        ],
      });

      return {
        transactionId: transaction.id,
        paidTo: counterparty.name,
        amount: formatWithCurrency(amount),
        valueDate: transaction.valueDate,
        rail: 'NPP',
      };
    },
  });
}

/** Shared helper: total available across an entity's accounts, per currency. */
export async function availableByCurrency(ledger, entityId) {
  const accounts = await ledger.listAccounts(entityId);
  const totals = {};
  for (const account of accounts) {
    if (account.status === 'closed') continue;
    const balance = await ledger.getBalance(account.id);
    totals[account.currency] = add(totals[account.currency] ?? zero(account.currency), balance.available);
  }
  return totals;
}
