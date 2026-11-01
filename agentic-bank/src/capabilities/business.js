// Business-bank capabilities.
//
// An SME's problem is not "a nicer app". It is that working capital management
// is a weekly manual chore: who do I owe, who owes me, can I make payroll, do
// I draw on the facility. These capabilities give an agent the primitives to
// answer that and then act — with the payment run as a single policy decision
// over many lines, which is how a treasurer actually thinks about it.

import {
  parseDecimal, formatWithCurrency, add, subtract, zero, compare, sum, isNegative,
} from '../ledger/money.js';
import { newId } from '../util/ids.js';
import { zonedParts } from '../util/time.js';
import { resolveBankAccount } from '../services/bank.js';

/**
 * "Today" in the bank's timezone, not in UTC. A Sydney customer asking for a
 * forecast at 10am must not be told the horizon starts yesterday, and this has
 * to agree with the value dates the policy engine resolves.
 */
function bankToday(clock, config) {
  return zonedParts(clock.now(), config.bankTimeZone ?? 'UTC').date;
}

export function registerBusinessCapabilities(registry) {
  registry.register({
    id: 'cashflow.forecast',
    title: 'Cash-flow forecast',
    description:
      'Project the closing balance over the next N days from the current available balance, '
      + 'scheduled payables and expected receivables. Returns the projected low point, which is '
      + 'the number that decides whether a drawdown is needed.',
    segments: ['business', 'institutional'],
    riskClass: 'read',
    mutating: false,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['accountId'],
      properties: {
        accountId: { type: 'string', format: 'identifier' },
        horizonDays: { type: 'integer', minimum: 1, maximum: 180, default: 30 },
      },
    },
    async plan(args) {
      return {
        summary: `Forecast ${args.horizonDays ?? 30} days on ${args.accountId}`,
        accountIds: [args.accountId],
      };
    },
    async execute(proposal, { ledger, store, clock, entity, config }) {
      const { accountId, horizonDays } = proposal.args;
      const balance = await ledger.getBalance(accountId);
      const today = bankToday(clock, config);
      const horizonEnd = zonedParts(
        new Date(clock.now().getTime() + horizonDays * 86_400_000),
        config.bankTimeZone ?? 'UTC',
      ).date;

      const instruments = await store.find('instruments', { entityId: entity.id });
      const payables = instruments.filter(
        (i) => i.type === 'payable' && i.status === 'open' && i.dueDate <= horizonEnd,
      );
      const receivables = instruments.filter(
        (i) => i.type === 'receivable' && i.status === 'open' && i.expectedDate <= horizonEnd,
      );

      // Walk the horizon day by day so the low point is a real date, not just
      // the net of everything — a business that is cash positive at day 30 can
      // still miss payroll at day 12.
      const events = [
        ...payables.map((p) => ({ date: p.dueDate, delta: p.amount, direction: 'out', label: p.description })),
        ...receivables.map((r) => ({ date: r.expectedDate, delta: r.amount, direction: 'in', label: r.description })),
      ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      let running = balance.available;
      let low = { date: today, balance: running };
      const timeline = [];
      for (const event of events) {
        if (event.delta.currency !== balance.currency) continue;
        running = event.direction === 'out' ? subtract(running, event.delta) : add(running, event.delta);
        timeline.push({
          date: event.date,
          label: event.label,
          direction: event.direction,
          amount: formatWithCurrency(event.delta),
          projectedBalance: formatWithCurrency(running),
        });
        if (compare(running, low.balance) < 0) low = { date: event.date, balance: running };
      }

      return {
        accountId,
        currency: balance.currency,
        asOf: today,
        openingAvailable: formatWithCurrency(balance.available),
        horizonDays,
        horizonEnd,
        closingProjected: formatWithCurrency(running),
        lowPoint: { date: low.date, balance: formatWithCurrency(low.balance) },
        shortfall: isNegative(low.balance) ? formatWithCurrency(low.balance) : null,
        payables: payables.length,
        receivables: receivables.length,
        timeline,
      };
    },
  });

  registry.register({
    id: 'receivables.aging',
    title: 'Receivables ageing',
    description: 'Outstanding receivables bucketed by how overdue they are.',
    segments: ['business', 'institutional'],
    riskClass: 'read',
    mutating: false,
    input: { type: 'object', additionalProperties: false, properties: {} },
    async plan(_args, { entity }) {
      return { summary: `Receivables ageing for ${entity.name}` };
    },
    async execute(_proposal, { store, clock, entity, config }) {
      const today = bankToday(clock, config);
      const rows = (await store.find('instruments', { entityId: entity.id })).filter(
        (i) => i.type === 'receivable' && i.status === 'open',
      );
      const buckets = { current: [], '1_30': [], '31_60': [], '61_90': [], over_90: [] };
      for (const r of rows) {
        const daysOverdue = Math.floor(
          (Date.parse(today) - Date.parse(r.expectedDate)) / 86_400_000,
        );
        const bucket = daysOverdue <= 0 ? 'current'
          : daysOverdue <= 30 ? '1_30'
            : daysOverdue <= 60 ? '31_60'
              : daysOverdue <= 90 ? '61_90' : 'over_90';
        buckets[bucket].push({ ...r, daysOverdue });
      }
      const summarise = (items) => {
        if (!items.length) return { count: 0, total: null };
        const currency = items[0].amount.currency;
        return {
          count: items.length,
          total: formatWithCurrency(sum(items.map((i) => i.amount), currency)),
          items: items.map((i) => ({
            customer: i.counterpartyName,
            description: i.description,
            amount: formatWithCurrency(i.amount),
            due: i.expectedDate,
            daysOverdue: i.daysOverdue,
          })),
        };
      };
      return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, summarise(v)]));
    },
  });

  registry.register({
    id: 'payables.run.prepare',
    title: 'Prepare a payment run',
    description:
      'Pay a set of open payables in one instruction. The whole run is one policy decision: '
      + 'if the total needs approval, the run waits as a unit rather than half-paying suppliers. '
      + 'Every payee must already be registered and screened.',
    segments: ['business', 'institutional'],
    riskClass: 'high',
    mutating: true,
    debitsFunds: true,
    rail: { name: 'DE', cutOff: '16:00', lagDays: 1 },
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['fromAccountId', 'payableIds'],
      properties: {
        fromAccountId: { type: 'string', format: 'identifier' },
        payableIds: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: { type: 'string', format: 'identifier' },
        },
        reference: { type: 'string', maxLength: 140, default: 'Payment run' },
      },
    },
    async plan(args, { store, ledger, entity }) {
      const account = await ledger.getAccount(args.fromAccountId);
      if (!account) {
        const err = new Error(`No account ${args.fromAccountId}`);
        err.code = 'ACCOUNT_NOT_FOUND';
        throw err;
      }

      const lines = [];
      for (const id of args.payableIds) {
        const payable = await store.get('instruments', id);
        if (!payable || payable.entityId !== entity.id || payable.type !== 'payable') {
          const err = new Error(`No open payable ${id} on this customer`);
          err.code = 'PAYABLE_NOT_FOUND';
          throw err;
        }
        if (payable.status !== 'open') {
          const err = new Error(`Payable ${id} is already ${payable.status}`);
          err.code = 'PAYABLE_NOT_OPEN';
          throw err;
        }
        if (payable.amount.currency !== account.currency) {
          const err = new Error(
            `Payable ${id} is ${payable.amount.currency} but the funding account is ${account.currency}`,
          );
          err.code = 'PAYABLE_CURRENCY_MISMATCH';
          throw err;
        }
        if (!payable.counterpartyId) {
          const err = new Error(`Payable ${id} has no registered payee`);
          err.code = 'PAYABLE_NO_COUNTERPARTY';
          throw err;
        }
        lines.push(payable);
      }

      const total = sum(lines.map((l) => l.amount), account.currency);
      return {
        summary: `Pay ${lines.length} payable(s) totalling ${formatWithCurrency(total)} from ${account.id}`,
        amount: total,
        accountIds: [args.fromAccountId],
        sourceAccountId: args.fromAccountId,
        // A run touches many counterparties, so there is no single
        // `counterpartyId`. Each line's payee was screened when it was
        // registered, and `screenRunLines` below re-checks every one.
        details: {
          lines: lines.map((l) => ({
            payableId: l.id,
            counterpartyId: l.counterpartyId,
            counterpartyName: l.counterpartyName,
            amount: l.amount,
            description: l.description,
          })),
          total,
          reference: args.reference,
        },
      };
    },
    async execute(proposal, { ledger, store, screening, decision }) {
      const { lines, total } = proposal.details;

      // Screen every payee in the run at execution time. A run approved an hour
      // ago must not pay a payee that has since been blocked.
      const blocked = [];
      for (const line of lines) {
        const counterparty = await store.get('counterparties', line.counterpartyId);
        const result = await screening.screen({
          name: counterparty.name,
          country: counterparty.country ?? null,
        });
        if (result.status !== 'clear') {
          blocked.push({ counterparty: counterparty.name, status: result.status });
        }
      }
      if (blocked.length) {
        const err = new Error(
          `Payment run halted: ${blocked.map((b) => `${b.counterparty} (${b.status})`).join(', ')}`,
        );
        err.code = 'RUN_SCREENING_BLOCKED';
        err.details = { blocked };
        throw err;
      }

      const clearing = await resolveBankAccount(store, {
        purpose: 'clearing',
        currency: total.currency,
      });

      const entries = [
        {
          accountId: proposal.sourceAccountId,
          direction: 'debit',
          amount: total,
          narrative: `${proposal.details.reference} (${lines.length} items)`,
        },
        ...lines.map((l) => ({
          accountId: clearing.id,
          direction: 'credit',
          amount: l.amount,
          narrative: `${l.counterpartyName} - ${l.description}`,
        })),
      ];

      const { transaction } = await ledger.post({
        idempotencyKey: `${proposal.id}:run`,
        reference: proposal.details.reference,
        type: 'payment_run',
        valueDate: decision?.valueDate ?? null,
        metadata: { proposalId: proposal.id, mandateId: proposal.mandateId, lines: lines.length },
        entries,
      });

      for (const line of lines) {
        await store.withTransaction((tx) =>
          tx.update('instruments', line.payableId, {
            status: 'paid',
            paidTransactionId: transaction.id,
            paidProposalId: proposal.id,
          }));
      }

      return {
        transactionId: transaction.id,
        lines: lines.length,
        total: formatWithCurrency(total),
        valueDate: transaction.valueDate,
        rail: 'DE',
      };
    },
  });

  registry.register({
    id: 'payroll.fund',
    title: 'Fund payroll',
    description:
      'Move the payroll total into the payroll disbursement account. Deliberately separate from '
      + 'a general payment run so it can carry its own limit and its own approvers.',
    segments: ['business', 'institutional'],
    riskClass: 'high',
    mutating: true,
    debitsFunds: true,
    rail: { name: 'DE', cutOff: '16:00', lagDays: 1 },
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['fromAccountId', 'payrollAccountId', 'amount', 'currency', 'payPeriod'],
      properties: {
        fromAccountId: { type: 'string', format: 'identifier' },
        payrollAccountId: { type: 'string', format: 'identifier' },
        amount: { type: 'string', format: 'amount' },
        currency: { type: 'string', format: 'currency' },
        payPeriod: { type: 'string', maxLength: 32, description: 'e.g. "2026-11-FN1"' },
        headcount: { type: 'integer', minimum: 1, maximum: 100000 },
      },
    },
    async plan(args) {
      const amount = parseDecimal(args.amount, args.currency);
      return {
        summary: `Fund payroll ${args.payPeriod}: ${formatWithCurrency(amount)}`,
        amount,
        accountIds: [args.fromAccountId, args.payrollAccountId],
        sourceAccountId: args.fromAccountId,
        details: { payPeriod: args.payPeriod, headcount: args.headcount ?? null },
      };
    },
    async execute(proposal, { ledger, decision }) {
      const amount = parseDecimal(proposal.args.amount, proposal.args.currency);
      const { transaction } = await ledger.post({
        idempotencyKey: `${proposal.id}:payroll`,
        reference: `Payroll ${proposal.args.payPeriod}`,
        type: 'payroll_funding',
        valueDate: decision?.valueDate ?? null,
        metadata: {
          proposalId: proposal.id,
          mandateId: proposal.mandateId,
          payPeriod: proposal.args.payPeriod,
        },
        entries: [
          { accountId: proposal.args.fromAccountId, direction: 'debit', amount, narrative: `Payroll ${proposal.args.payPeriod}` },
          { accountId: proposal.args.payrollAccountId, direction: 'credit', amount, narrative: `Payroll ${proposal.args.payPeriod}` },
        ],
      });
      return {
        transactionId: transaction.id,
        payPeriod: proposal.args.payPeriod,
        amount: formatWithCurrency(amount),
        valueDate: transaction.valueDate,
      };
    },
  });
}

/** Seed helper used by scripts/seed.js and the tests. */
export function makePayable({ entityId, counterpartyId, counterpartyName, description, amount, dueDate }) {
  return {
    id: newId('instrument'),
    entityId,
    type: 'payable',
    counterpartyId,
    counterpartyName,
    description,
    amount,
    dueDate,
    status: 'open',
  };
}

export function makeReceivable({ entityId, counterpartyName, description, amount, expectedDate }) {
  return {
    id: newId('instrument'),
    entityId,
    type: 'receivable',
    counterpartyName,
    description,
    amount,
    expectedDate,
    status: 'open',
  };
}
