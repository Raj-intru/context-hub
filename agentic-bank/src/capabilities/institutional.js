// Institutional capabilities.
//
// This is the segment where "agentic" stops being a convenience and starts
// being the product. A group treasurer's day is: where is my cash, across how
// many entities and currencies; what is drawn against which facility; what
// settles today and what has missed its cut-off; what do I need to fund, hedge
// or sweep before the window closes. Every one of those is a query across
// systems that do not talk to each other, followed by an instruction that needs
// two signatures.
//
// The agent can do the reasoning. It must not be able to do the signing — so
// cross-border payments, FX bookings and file submissions are all high risk,
// and all of them carry a rail with a real cut-off, because an instruction that
// silently lands tomorrow is worse than one that is refused today.

import {
  parseDecimal, formatWithCurrency, add, subtract, zero, sum, multiply, compare,
} from '../ledger/money.js';
import { newId } from '../util/ids.js';
import { resolveBankAccount, BANK_ENTITY_ID } from '../services/bank.js';

export function registerInstitutionalCapabilities(registry) {
  registry.register({
    id: 'liquidity.position',
    title: 'Group liquidity position',
    description:
      'Cash position across the group, by currency and entity: cleared, on hold, available, '
      + 'and headroom on facilities. For a group treasury entity this spans the whole group; '
      + 'otherwise it covers the calling entity only.',
    segments: ['institutional'],
    riskClass: 'read',
    mutating: false,
    input: {
      type: 'object',
      additionalProperties: false,
      properties: {
        currency: { type: 'string', format: 'currency', description: 'Restrict to one currency.' },
      },
    },
    async plan(args, { entity }) {
      return {
        summary: `Liquidity position for ${entity.groupTreasury ? `group ${entity.groupId}` : entity.name}`,
        details: { currency: args.currency ?? null },
      };
    },
    async execute(proposal, { ledger, store, entity }) {
      // Group-wide visibility is a property of the entity's standing as group
      // treasury, recorded on the customer record — not something the caller
      // can ask for. An agent cannot widen its own view by changing arguments.
      const entities = entity.groupTreasury && entity.groupId
        ? (await store.find('entities', { groupId: entity.groupId })).filter((e) => e.id !== BANK_ENTITY_ID)
        : [entity];

      const filter = proposal.args.currency ?? null;
      const byCurrency = {};
      const byEntity = [];

      for (const member of entities) {
        const accounts = await ledger.listAccounts(member.id);
        const memberRows = [];
        for (const account of accounts) {
          if (account.status === 'closed') continue;
          if (filter && account.currency !== filter) continue;
          const balance = await ledger.getBalance(account.id);
          const bucket = byCurrency[account.currency] ?? {
            cleared: zero(account.currency),
            holds: zero(account.currency),
            available: zero(account.currency),
          };
          bucket.cleared = add(bucket.cleared, balance.cleared);
          bucket.holds = add(bucket.holds, balance.holds);
          bucket.available = add(bucket.available, balance.available);
          byCurrency[account.currency] = bucket;
          memberRows.push({
            accountId: account.id,
            name: account.name,
            currency: account.currency,
            cleared: formatWithCurrency(balance.cleared),
            available: formatWithCurrency(balance.available),
          });
        }
        if (memberRows.length) {
          byEntity.push({ entityId: member.id, name: member.name, accounts: memberRows });
        }
      }

      const facilities = [];
      for (const member of entities) {
        const rows = (await store.find('instruments', { entityId: member.id })).filter(
          (i) => i.type === 'facility' && i.status === 'active',
        );
        for (const f of rows) {
          facilities.push({
            facilityId: f.id,
            entityId: member.id,
            kind: f.kind,
            currency: f.limit.currency,
            limit: formatWithCurrency(f.limit),
            drawn: formatWithCurrency(f.drawn),
            headroom: formatWithCurrency(subtract(f.limit, f.drawn)),
            utilisationPct: utilisationPercent(f.drawn, f.limit),
          });
        }
      }

      return {
        scope: entity.groupTreasury ? 'group' : 'entity',
        entities: entities.length,
        byCurrency: Object.fromEntries(
          Object.entries(byCurrency).map(([currency, b]) => [
            currency,
            {
              cleared: formatWithCurrency(b.cleared),
              onHold: formatWithCurrency(b.holds),
              available: formatWithCurrency(b.available),
            },
          ]),
        ),
        byEntity,
        facilities,
      };
    },
  });

  registry.register({
    id: 'limits.utilisation',
    title: 'Facility and limit utilisation',
    description: 'Drawn amount, limit and headroom for each credit facility and intraday limit.',
    segments: ['institutional', 'business'],
    riskClass: 'read',
    mutating: false,
    input: { type: 'object', additionalProperties: false, properties: {} },
    async plan(_args, { entity }) {
      return { summary: `Limit utilisation for ${entity.name}` };
    },
    async execute(_proposal, { store, entity }) {
      const rows = (await store.find('instruments', { entityId: entity.id })).filter(
        (i) => i.type === 'facility',
      );
      return rows.map((f) => ({
        facilityId: f.id,
        kind: f.kind,
        status: f.status,
        limit: formatWithCurrency(f.limit),
        drawn: formatWithCurrency(f.drawn),
        headroom: formatWithCurrency(subtract(f.limit, f.drawn)),
        utilisationPct: utilisationPercent(f.drawn, f.limit),
        maturity: f.maturity ?? null,
      }));
    },
  });

  registry.register({
    id: 'fx.quote',
    title: 'Request an FX rate',
    description:
      'Get a firm, time-limited rate. The quote is stored and must be referenced by id when '
      + 'booking — a booking cannot name its own rate. Quotes expire in seconds, so quote and '
      + 'book in the same conversation.',
    segments: ['institutional', 'business'],
    riskClass: 'low',
    // Storing a firm quote is a write: the bank is now on risk for that rate
    // until it expires, so this is mutating even though no money moves.
    mutating: true,
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['sellCurrency', 'buyCurrency', 'sellAmount'],
      properties: {
        sellCurrency: { type: 'string', format: 'currency' },
        buyCurrency: { type: 'string', format: 'currency' },
        sellAmount: { type: 'string', format: 'amount' },
        tenor: { type: 'string', enum: ['spot', 'forward'], default: 'spot' },
        valueDate: { type: 'string', format: 'date', description: 'Required for a forward.' },
      },
    },
    async plan(args, { entity }) {
      if (args.tenor === 'forward' && !args.valueDate) {
        const err = new Error('A forward needs a value date');
        err.code = 'FX_FORWARD_NEEDS_VALUE_DATE';
        throw err;
      }
      const amount = parseDecimal(args.sellAmount, args.sellCurrency);
      return {
        summary: `Quote ${formatWithCurrency(amount)} into ${args.buyCurrency} (${args.tenor ?? 'spot'})`,
        // A quote is not a transfer, so it consumes no payment limit. The
        // booking that follows does.
        details: { sellAmount: amount, tenor: args.tenor ?? 'spot' },
      };
    },
    async execute(proposal, { fx, entity }) {
      const { args } = proposal;
      const quote = await fx.quote({
        entityId: entity.id,
        segment: entity.segment,
        sell: args.sellCurrency,
        buy: args.buyCurrency,
        amount: parseDecimal(args.sellAmount, args.sellCurrency),
        tenor: args.tenor ?? 'spot',
        valueDate: args.valueDate ?? null,
      });
      return {
        quoteId: quote.id,
        sell: formatWithCurrency(quote.sellAmount),
        buy: formatWithCurrency(quote.buyAmount),
        rate: quote.rate,
        tenor: quote.tenor,
        expiresAt: quote.expiresAt,
        note: 'Book with fx.book using this quoteId before it expires.',
      };
    },
  });

  registry.register({
    id: 'fx.book',
    title: 'Book an FX deal',
    description:
      'Execute a previously quoted FX deal, debiting the sell account and crediting the buy '
      + 'account. The quote must be open, yours, and unexpired.',
    segments: ['institutional', 'business'],
    riskClass: 'high',
    mutating: true,
    debitsFunds: true,
    rail: { name: 'FX', cutOff: '17:00', lagDays: 0 },
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['quoteId', 'sellAccountId', 'buyAccountId'],
      properties: {
        quoteId: { type: 'string', format: 'identifier' },
        sellAccountId: { type: 'string', format: 'identifier' },
        buyAccountId: { type: 'string', format: 'identifier' },
      },
    },
    async plan(args, { fx, entity }) {
      const quote = await fx.getQuote(args.quoteId);
      if (!quote) {
        const err = new Error(`No quote ${args.quoteId}`);
        err.code = 'FX_QUOTE_NOT_FOUND';
        throw err;
      }
      if (quote.entityId !== entity.id) {
        const err = new Error('That quote belongs to another customer');
        err.code = 'FX_QUOTE_NOT_YOURS';
        throw err;
      }
      return {
        summary: `Book ${formatWithCurrency(quote.sellAmount)} -> ${formatWithCurrency(quote.buyAmount)} at ${quote.rate}`,
        // The risk amount is what leaves the account.
        amount: quote.sellAmount,
        accountIds: [args.sellAccountId, args.buyAccountId],
        sourceAccountId: args.sellAccountId,
        details: {
          quoteId: quote.id,
          rate: quote.rate,
          buyAmount: quote.buyAmount,
          tenor: quote.tenor,
        },
      };
    },
    async execute(proposal, { ledger, store, fx, entity, decision }) {
      return store.withTransaction(async (tx) => {
        const quote = await fx.consumeQuote(tx, {
          quoteId: proposal.args.quoteId,
          entityId: entity.id,
        });

        const sellPosition = await resolveBankAccount(store, {
          purpose: 'fx_position',
          currency: quote.sell,
        });
        const buyPosition = await resolveBankAccount(store, {
          purpose: 'fx_position',
          currency: quote.buy,
        });

        // Two balanced legs, one per currency. A single multi-currency
        // "transaction" that nets across currencies would not balance and the
        // ledger would reject it — correctly.
        const { transaction } = await ledger.post({
          idempotencyKey: `${proposal.id}:fx`,
          reference: `FX ${quote.sell}/${quote.buy} @ ${quote.rate}`,
          type: 'fx_deal',
          valueDate: decision?.valueDate ?? null,
          metadata: {
            proposalId: proposal.id,
            mandateId: proposal.mandateId,
            quoteId: quote.id,
            rate: quote.rate,
            tenor: quote.tenor,
          },
          entries: [
            { accountId: proposal.args.sellAccountId, direction: 'debit', amount: quote.sellAmount, narrative: `FX sell ${quote.sell}` },
            { accountId: sellPosition.id, direction: 'credit', amount: quote.sellAmount, narrative: `FX position ${quote.sell}` },
            { accountId: buyPosition.id, direction: 'debit', amount: quote.buyAmount, narrative: `FX position ${quote.buy}` },
            { accountId: proposal.args.buyAccountId, direction: 'credit', amount: quote.buyAmount, narrative: `FX buy ${quote.buy}` },
          ],
        });

        return {
          transactionId: transaction.id,
          quoteId: quote.id,
          sold: formatWithCurrency(quote.sellAmount),
          bought: formatWithCurrency(quote.buyAmount),
          rate: quote.rate,
          valueDate: transaction.valueDate,
        };
      });
    },
  });

  registry.register({
    id: 'payments.crossborder.initiate',
    title: 'Cross-border payment',
    description:
      'Pay a registered overseas payee through a correspondent. Cut-off is 16:00 and value date '
      + 'is T+1, so an instruction given late today settles the business day after next — the '
      + 'bank states the value date it will actually apply.',
    segments: ['institutional', 'business'],
    riskClass: 'high',
    mutating: true,
    requiresCounterparty: true,
    debitsFunds: true,
    rail: { name: 'SWIFT', cutOff: '16:00', lagDays: 1 },
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['fromAccountId', 'counterpartyId', 'amount', 'currency'],
      properties: {
        fromAccountId: { type: 'string', format: 'identifier' },
        counterpartyId: { type: 'string', format: 'identifier' },
        amount: { type: 'string', format: 'amount' },
        currency: { type: 'string', format: 'currency' },
        reference: { type: 'string', maxLength: 140, default: 'Cross-border payment' },
        chargeBearer: { type: 'string', enum: ['debtor', 'creditor', 'shared'], default: 'shared' },
        purposeCode: { type: 'string', pattern: '^[A-Z]{4}$', description: 'ISO 20022 purpose code, e.g. GDDS.' },
      },
    },
    async plan(args, { store, ledger, entity }) {
      const amount = parseDecimal(args.amount, args.currency);
      const counterparty = await store.get('counterparties', args.counterpartyId);
      const account = await ledger.getAccount(args.fromAccountId);
      if (account && account.currency !== args.currency) {
        const err = new Error(
          `Account ${account.id} is ${account.currency}; book an FX deal first or pay from a ${args.currency} account`,
        );
        err.code = 'CROSSBORDER_CURRENCY_MISMATCH';
        throw err;
      }
      // Correspondent fee, quoted up front rather than discovered on the
      // statement. 15bps, floor 25.00 in the payment currency.
      const feeFloor = parseDecimal('25.00', args.currency);
      const bps = multiply(amount, '0.0015');
      const fee = compare(bps, feeFloor) > 0 ? bps : feeFloor;

      return {
        summary: `Pay ${formatWithCurrency(amount)} to ${counterparty?.name ?? args.counterpartyId} via SWIFT`,
        amount,
        accountIds: [args.fromAccountId],
        sourceAccountId: args.fromAccountId,
        counterpartyId: args.counterpartyId,
        details: {
          reference: args.reference,
          chargeBearer: args.chargeBearer,
          purposeCode: args.purposeCode ?? null,
          estimatedFee: fee,
          entityId: entity.id,
        },
      };
    },
    async execute(proposal, { ledger, store, decision }) {
      const amount = parseDecimal(proposal.args.amount, proposal.args.currency);
      const counterparty = await store.get('counterparties', proposal.args.counterpartyId);
      const nostro = await resolveBankAccount(store, {
        purpose: 'nostro',
        currency: proposal.args.currency,
      });
      const feeIncome = await resolveBankAccount(store, {
        purpose: 'fee_income',
        currency: proposal.args.currency,
      });
      const fee = proposal.details.estimatedFee;

      const entries = [
        {
          accountId: proposal.args.fromAccountId,
          direction: 'debit',
          amount,
          narrative: `${proposal.args.reference} - ${counterparty.name}`,
        },
        { accountId: nostro.id, direction: 'credit', amount, narrative: `Nostro ${counterparty.name}` },
      ];
      if (proposal.details.chargeBearer !== 'creditor') {
        entries.push(
          { accountId: proposal.args.fromAccountId, direction: 'debit', amount: fee, narrative: 'Correspondent fee' },
          { accountId: feeIncome.id, direction: 'credit', amount: fee, narrative: 'Correspondent fee' },
        );
      }

      const { transaction } = await ledger.post({
        idempotencyKey: `${proposal.id}:xborder`,
        reference: proposal.args.reference,
        type: 'crossborder_payment',
        valueDate: decision?.valueDate ?? null,
        metadata: {
          proposalId: proposal.id,
          mandateId: proposal.mandateId,
          counterpartyId: counterparty.id,
          rail: 'SWIFT',
          purposeCode: proposal.details.purposeCode,
          chargeBearer: proposal.details.chargeBearer,
        },
        entries,
      });

      return {
        transactionId: transaction.id,
        paidTo: counterparty.name,
        amount: formatWithCurrency(amount),
        fee: proposal.details.chargeBearer === 'creditor' ? null : formatWithCurrency(fee),
        valueDate: transaction.valueDate,
        rail: 'SWIFT',
        correspondent: counterparty.bic ?? 'routed by the bank',
      };
    },
  });

  registry.register({
    id: 'payments.file.submit',
    title: 'Submit a payment file',
    description:
      'Host-to-host bulk submission. The file is parsed and every line is validated and screened '
      + 'before anything posts; the whole file is accepted or rejected as a unit, and the total '
      + 'is what the policy engine decides on.',
    segments: ['institutional'],
    riskClass: 'high',
    mutating: true,
    debitsFunds: true,
    rail: { name: 'DE', cutOff: '16:00', lagDays: 1 },
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['fromAccountId', 'fileReference', 'lines'],
      properties: {
        fromAccountId: { type: 'string', format: 'identifier' },
        fileReference: { type: 'string', minLength: 3, maxLength: 64 },
        lines: {
          type: 'array',
          minItems: 1,
          maxItems: 1000,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['counterpartyId', 'amount', 'currency'],
            properties: {
              counterpartyId: { type: 'string', format: 'identifier' },
              amount: { type: 'string', format: 'amount' },
              currency: { type: 'string', format: 'currency' },
              reference: { type: 'string', maxLength: 140 },
            },
          },
        },
      },
    },
    async plan(args, { store, ledger, entity }) {
      const account = await ledger.getAccount(args.fromAccountId);
      if (!account) {
        const err = new Error(`No account ${args.fromAccountId}`);
        err.code = 'ACCOUNT_NOT_FOUND';
        throw err;
      }

      const duplicate = await store.findOne('instruments', {
        entityId: entity.id,
        type: 'payment_file',
        fileReference: args.fileReference,
      });
      if (duplicate) {
        const err = new Error(
          `File reference ${args.fileReference} was already submitted on ${duplicate.submittedAt}`,
        );
        err.code = 'FILE_ALREADY_SUBMITTED';
        throw err;
      }

      const lines = [];
      for (const [index, line] of args.lines.entries()) {
        if (line.currency !== account.currency) {
          const err = new Error(
            `Line ${index + 1} is ${line.currency} but the funding account is ${account.currency}`,
          );
          err.code = 'FILE_CURRENCY_MISMATCH';
          throw err;
        }
        const counterparty = await store.get('counterparties', line.counterpartyId);
        if (!counterparty || counterparty.entityId !== entity.id) {
          const err = new Error(`Line ${index + 1} names an unregistered payee`);
          err.code = 'FILE_UNKNOWN_COUNTERPARTY';
          throw err;
        }
        lines.push({
          counterpartyId: counterparty.id,
          counterpartyName: counterparty.name,
          amount: parseDecimal(line.amount, line.currency),
          reference: line.reference ?? args.fileReference,
        });
      }

      const total = sum(lines.map((l) => l.amount), account.currency);
      return {
        summary: `Submit file ${args.fileReference}: ${lines.length} payment(s), ${formatWithCurrency(total)}`,
        amount: total,
        accountIds: [args.fromAccountId],
        sourceAccountId: args.fromAccountId,
        details: { fileReference: args.fileReference, lines, total },
      };
    },
    async execute(proposal, { ledger, store, screening, clock, entity, decision }) {
      const { lines, total, fileReference } = proposal.details;

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
          `File ${fileReference} rejected: ${blocked.map((b) => `${b.counterparty} (${b.status})`).join(', ')}`,
        );
        err.code = 'FILE_SCREENING_BLOCKED';
        err.details = { blocked };
        throw err;
      }

      const clearing = await resolveBankAccount(store, { purpose: 'clearing', currency: total.currency });
      const { transaction } = await ledger.post({
        idempotencyKey: `${proposal.id}:file`,
        reference: fileReference,
        type: 'payment_file',
        valueDate: decision?.valueDate ?? null,
        metadata: { proposalId: proposal.id, mandateId: proposal.mandateId, fileReference, lines: lines.length },
        entries: [
          { accountId: proposal.sourceAccountId, direction: 'debit', amount: total, narrative: `File ${fileReference}` },
          ...lines.map((l) => ({
            accountId: clearing.id,
            direction: 'credit',
            amount: l.amount,
            narrative: `${l.counterpartyName} - ${l.reference}`,
          })),
        ],
      });

      await store.withTransaction((tx) =>
        tx.insert('instruments', {
          id: newId('instrument'),
          entityId: entity.id,
          type: 'payment_file',
          fileReference,
          lines: lines.length,
          total,
          transactionId: transaction.id,
          proposalId: proposal.id,
          status: 'accepted',
          submittedAt: clock.now().toISOString(),
        }));

      return {
        transactionId: transaction.id,
        fileReference,
        accepted: lines.length,
        total: formatWithCurrency(total),
        valueDate: transaction.valueDate,
      };
    },
  });

  registry.register({
    id: 'tradefinance.lc.status',
    title: 'Letter of credit status',
    description:
      'Status of documentary credits: issued amount, utilised, expiry, latest shipment date, '
      + 'and any outstanding discrepancies.',
    segments: ['institutional'],
    riskClass: 'read',
    mutating: false,
    input: {
      type: 'object',
      additionalProperties: false,
      properties: {
        instrumentId: { type: 'string', format: 'identifier', description: 'One specific LC; omit for all.' },
      },
    },
    async plan(args, { entity }) {
      return {
        summary: args.instrumentId
          ? `Status of LC ${args.instrumentId}`
          : `All documentary credits for ${entity.name}`,
      };
    },
    async execute(proposal, { store, entity }) {
      let rows = (await store.find('instruments', { entityId: entity.id })).filter(
        (i) => i.type === 'letter_of_credit',
      );
      if (proposal.args.instrumentId) {
        rows = rows.filter((i) => i.id === proposal.args.instrumentId);
      }
      return rows.map((lc) => ({
        instrumentId: lc.id,
        reference: lc.reference,
        beneficiary: lc.beneficiary,
        issued: formatWithCurrency(lc.issued),
        utilised: formatWithCurrency(lc.utilised),
        available: formatWithCurrency(subtract(lc.issued, lc.utilised)),
        expiry: lc.expiry,
        latestShipment: lc.latestShipment,
        status: lc.status,
        discrepancies: lc.discrepancies ?? [],
      }));
    },
  });
}

function utilisationPercent(drawn, limit) {
  const l = BigInt(limit.amount);
  if (l === 0n) return 0;
  return Number((BigInt(drawn.amount) * 10000n) / l) / 100;
}

export function makeFacility({ entityId, kind, limit, drawn, maturity }) {
  return {
    id: newId('instrument'),
    entityId,
    type: 'facility',
    kind,
    limit,
    drawn: drawn ?? zero(limit.currency),
    maturity: maturity ?? null,
    status: 'active',
  };
}

export function makeLetterOfCredit({ entityId, reference, beneficiary, issued, utilised, expiry, latestShipment, discrepancies = [] }) {
  return {
    id: newId('instrument'),
    entityId,
    type: 'letter_of_credit',
    reference,
    beneficiary,
    issued,
    utilised: utilised ?? zero(issued.currency),
    expiry,
    latestShipment,
    discrepancies,
    status: 'issued',
  };
}
