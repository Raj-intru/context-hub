// Consumer capabilities.
//
// The consumer bet of an agentic bank is not "a chatbot in front of the app".
// It is that a customer states an outcome — "stop anything I'm paying twice
// for", "keep $2,000 in my everyday account and the rest earning interest" —
// and the bank's agent configures the mechanics. Every one of these still runs
// through the policy engine, so an agent that misreads an instruction hits a
// limit rather than a customer's savings.

import { parseDecimal, formatWithCurrency, compare, zero, add } from '../ledger/money.js';
import { newId } from '../util/ids.js';

export function registerConsumerCapabilities(registry) {
  registry.register({
    id: 'cards.freeze',
    title: 'Freeze or unfreeze a card',
    description: 'Immediately block or unblock a card. Reversible, so it is low risk and fast.',
    segments: ['consumer', 'business'],
    riskClass: 'low',
    mutating: true,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['cardId', 'frozen'],
      properties: {
        cardId: { type: 'string', format: 'identifier' },
        frozen: { type: 'boolean' },
        reason: { type: 'string', maxLength: 140 },
      },
    },
    async plan(args, { store, entity }) {
      const card = await store.get('instruments', args.cardId);
      if (!card || card.entityId !== entity.id || card.type !== 'card') {
        const err = new Error(`No card ${args.cardId} on this customer`);
        err.code = 'CARD_NOT_FOUND';
        throw err;
      }
      return {
        summary: `${args.frozen ? 'Freeze' : 'Unfreeze'} card ${card.maskedNumber}`,
        accountIds: [card.accountId],
        details: { cardId: card.id, reason: args.reason ?? null },
      };
    },
    async execute(proposal, { store, clock }) {
      const updated = await store.withTransaction((tx) =>
        tx.update('instruments', proposal.args.cardId, {
          frozen: proposal.args.frozen,
          frozenReason: proposal.args.reason ?? null,
          updatedAt: clock.now().toISOString(),
        }));
      return { cardId: updated.id, maskedNumber: updated.maskedNumber, frozen: updated.frozen };
    },
  });

  registry.register({
    id: 'cards.limit.set',
    title: 'Set a card spending limit',
    description: 'Set the per-transaction or daily limit on a card.',
    segments: ['consumer', 'business'],
    riskClass: 'medium',
    mutating: true,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['cardId', 'scope', 'amount', 'currency'],
      properties: {
        cardId: { type: 'string', format: 'identifier' },
        scope: { type: 'string', enum: ['per_transaction', 'daily'] },
        amount: { type: 'string', format: 'amount' },
        currency: { type: 'string', format: 'currency' },
      },
    },
    async plan(args, { store, entity }) {
      const card = await store.get('instruments', args.cardId);
      if (!card || card.entityId !== entity.id) {
        const err = new Error(`No card ${args.cardId} on this customer`);
        err.code = 'CARD_NOT_FOUND';
        throw err;
      }
      const amount = parseDecimal(args.amount, args.currency);
      return {
        summary: `Set ${args.scope.replace('_', ' ')} limit on ${card.maskedNumber} to ${formatWithCurrency(amount)}`,
        accountIds: [card.accountId],
        // The limit itself is not money leaving the bank, so it is not the
        // proposal's risk amount — raising a limit is governed by the mandate's
        // capability grant, not by its payment limits.
        details: { cardId: card.id, scope: args.scope, limit: amount },
      };
    },
    async execute(proposal, { store, clock }) {
      const amount = parseDecimal(proposal.args.amount, proposal.args.currency);
      const card = await store.get('instruments', proposal.args.cardId);
      const limits = { ...(card.limits ?? {}), [proposal.args.scope]: amount };
      await store.withTransaction((tx) =>
        tx.update('instruments', card.id, { limits, updatedAt: clock.now().toISOString() }));
      return {
        cardId: card.id,
        scope: proposal.args.scope,
        limit: formatWithCurrency(amount),
      };
    },
  });

  registry.register({
    id: 'savings.sweep.configure',
    title: 'Configure an automatic sweep',
    description:
      'Keep a target balance in one account and move the surplus to another automatically. '
      + 'Creates a standing rule; it does not move money now.',
    segments: ['consumer', 'business'],
    riskClass: 'medium',
    mutating: true,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['fromAccountId', 'toAccountId', 'targetBalance', 'currency'],
      properties: {
        fromAccountId: { type: 'string', format: 'identifier' },
        toAccountId: { type: 'string', format: 'identifier' },
        targetBalance: { type: 'string', format: 'amount', description: 'Balance to leave behind in the source account.' },
        currency: { type: 'string', format: 'currency' },
        minimumSweep: { type: 'string', format: 'amount', default: '50.00' },
        enabled: { type: 'boolean', default: true },
      },
    },
    async plan(args, { entity }) {
      const target = parseDecimal(args.targetBalance, args.currency);
      return {
        summary: `Sweep surplus above ${formatWithCurrency(target)} from ${args.fromAccountId} to ${args.toAccountId}`,
        accountIds: [args.fromAccountId, args.toAccountId],
        details: { target, entityId: entity.id },
      };
    },
    async execute(proposal, { store, clock, entity }) {
      const { args } = proposal;
      const rule = {
        id: newId('instrument'),
        entityId: entity.id,
        type: 'sweep_rule',
        fromAccountId: args.fromAccountId,
        toAccountId: args.toAccountId,
        targetBalance: parseDecimal(args.targetBalance, args.currency),
        minimumSweep: parseDecimal(args.minimumSweep, args.currency),
        enabled: args.enabled,
        createdAt: clock.now().toISOString(),
        createdBy: proposal.initiator,
      };
      await store.withTransaction((tx) => tx.insert('instruments', rule));
      return {
        ruleId: rule.id,
        summary: proposal.summary,
        note: 'The sweep runs on the bank\'s schedule; each execution is itself policy-checked.',
      };
    },
  });

  registry.register({
    id: 'subscriptions.review',
    title: 'Review recurring payments',
    description:
      'Find recurring debits by grouping the statement on narrative and amount. '
      + 'Read-only: it reports what it found and does not cancel anything.',
    segments: ['consumer', 'business'],
    riskClass: 'read',
    mutating: false,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['accountId'],
      properties: {
        accountId: { type: 'string', format: 'identifier' },
        minimumOccurrences: { type: 'integer', minimum: 2, maximum: 12, default: 2 },
      },
    },
    async plan(args) {
      return { summary: `Review recurring debits on ${args.accountId}`, accountIds: [args.accountId] };
    },
    async execute(proposal, { ledger }) {
      const postings = await ledger.getStatement(proposal.args.accountId, { limit: 200 });
      const groups = new Map();
      for (const p of postings) {
        if (p.direction !== 'debit') continue;
        const key = `${normaliseNarrative(p.narrative)}|${p.amount.currency}|${p.amount.amount}`;
        const group = groups.get(key) ?? {
          narrative: p.narrative,
          amount: p.amount,
          occurrences: 0,
          dates: [],
        };
        group.occurrences += 1;
        group.dates.push(p.valueDate);
        groups.set(key, group);
      }
      const recurring = [...groups.values()]
        .filter((g) => g.occurrences >= proposal.args.minimumOccurrences)
        .sort((a, b) => compare(b.amount, a.amount));

      let monthlyTotal = null;
      for (const g of recurring) {
        monthlyTotal = monthlyTotal
          ? add(monthlyTotal, g.amount)
          : add(zero(g.amount.currency), g.amount);
      }

      return {
        found: recurring.length,
        estimatedPerCycle: monthlyTotal ? formatWithCurrency(monthlyTotal) : null,
        items: recurring.map((g) => ({
          narrative: g.narrative,
          amount: formatWithCurrency(g.amount),
          occurrences: g.occurrences,
          lastSeen: g.dates[0],
        })),
        note: 'Cancelling a recurring debit is a separate instruction and needs its own approval.',
      };
    },
  });

  registry.register({
    id: 'disputes.raise',
    title: 'Raise a dispute',
    description: 'Open a dispute against a posted transaction and record the reason.',
    segments: ['consumer', 'business'],
    riskClass: 'medium',
    mutating: true,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['transactionId', 'reason'],
      properties: {
        transactionId: { type: 'string', format: 'identifier' },
        reason: {
          type: 'string',
          enum: ['not_authorised', 'duplicate', 'goods_not_received', 'wrong_amount', 'cancelled_subscription'],
        },
        note: { type: 'string', maxLength: 500 },
      },
    },
    async plan(args, { ledger, entity }) {
      const transaction = await ledger.getTransaction(args.transactionId);
      if (!transaction) {
        const err = new Error(`No transaction ${args.transactionId}`);
        err.code = 'TRANSACTION_NOT_FOUND';
        throw err;
      }
      const accounts = await ledger.listAccounts(entity.id);
      const owned = new Set(accounts.map((a) => a.id));
      const leg = transaction.postings.find((p) => owned.has(p.accountId));
      if (!leg) {
        const err = new Error(`Transaction ${args.transactionId} does not touch this customer`);
        err.code = 'TRANSACTION_NOT_OWNED';
        throw err;
      }
      return {
        summary: `Dispute ${formatWithCurrency(leg.amount)} on ${args.transactionId} (${args.reason})`,
        accountIds: [leg.accountId],
        details: { transactionId: args.transactionId, disputedAmount: leg.amount },
      };
    },
    async execute(proposal, { store, clock, entity }) {
      const dispute = {
        id: newId('instrument'),
        entityId: entity.id,
        type: 'dispute',
        transactionId: proposal.args.transactionId,
        reason: proposal.args.reason,
        note: proposal.args.note ?? null,
        amount: proposal.details.disputedAmount,
        status: 'open',
        raisedAt: clock.now().toISOString(),
        raisedBy: proposal.initiator,
      };
      await store.withTransaction((tx) => tx.insert('instruments', dispute));
      return {
        disputeId: dispute.id,
        status: dispute.status,
        amount: formatWithCurrency(dispute.amount),
        note: 'A provisional credit, if any, is a separate decision made by the disputes team.',
      };
    },
  });
}

function normaliseNarrative(narrative) {
  return String(narrative ?? '')
    .toLowerCase()
    .replace(/\d{2,}/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
