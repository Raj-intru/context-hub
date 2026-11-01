// FX quoting and booking.
//
// Rates come from a rate book rather than being invented at the point of use,
// and a booking must reference a quote that has not expired. An agent that
// could name its own rate would be an agent that could give away the spread.

import { convert, multiply, parseRate, formatWithCurrency } from '../ledger/money.js';
import { newId } from '../util/ids.js';

export class FxError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'FxError';
    this.code = code;
    this.details = details;
  }
}

/** Illustrative mid-rates. A real deployment reads the bank's pricing engine. */
const DEMO_MID = {
  'AUD/USD': '0.6600', 'AUD/EUR': '0.6100', 'AUD/GBP': '0.5200', 'AUD/JPY': '101.50',
  'AUD/NZD': '1.0900', 'AUD/SGD': '0.8800', 'AUD/HKD': '5.1400', 'AUD/CNY': '4.7300',
  'USD/EUR': '0.9240', 'USD/JPY': '153.80', 'USD/SGD': '1.3330', 'USD/CNY': '7.1600',
  'EUR/GBP': '0.8520', 'GBP/USD': '1.2690',
};

/** Spread in basis points by tenor and segment. Wider for small tickets. */
const SPREAD_BPS = {
  consumer: { spot: 90 },
  business: { spot: 35, forward: 55 },
  institutional: { spot: 8, forward: 18 },
};

function midRate(sell, buy) {
  if (sell === buy) return '1';
  const direct = DEMO_MID[`${sell}/${buy}`];
  if (direct) return direct;
  const inverse = DEMO_MID[`${buy}/${sell}`];
  if (inverse) {
    const { numerator, denominator } = parseRate(inverse);
    // 1 / inverse, to 8 decimal places.
    const scaled = (denominator * 10n ** 8n) / numerator;
    const s = scaled.toString().padStart(9, '0');
    return `${s.slice(0, -8)}.${s.slice(-8)}`;
  }
  // Cross through AUD, the demo book's base.
  const sellLeg = sell === 'AUD' ? '1' : DEMO_MID[`AUD/${sell}`];
  const buyLeg = buy === 'AUD' ? '1' : DEMO_MID[`AUD/${buy}`];
  if (!sellLeg || !buyLeg) {
    throw new FxError(`No rate available for ${sell}/${buy}`, 'FX_NO_RATE', { sell, buy });
  }
  const a = parseRate(buyLeg);
  const b = parseRate(sellLeg);
  const scaled = (a.numerator * b.denominator * 10n ** 8n) / (a.denominator * b.numerator);
  const s = scaled.toString().padStart(9, '0');
  return `${s.slice(0, -8)}.${s.slice(-8)}`;
}

/** Apply the customer-adverse spread: the bank buys low and sells high. */
function applySpread(mid, bps) {
  const { numerator, denominator } = parseRate(mid);
  const adjusted = (numerator * BigInt(10_000 - bps)) / 10_000n;
  const s = (adjusted * 10n ** 8n / denominator).toString().padStart(9, '0');
  return `${s.slice(0, -8)}.${s.slice(-8)}`;
}

export function createFx({ store, clock, config = {} }) {
  const quoteTtlSeconds = config.fxQuoteTtlSeconds ?? 90;

  return {
    /** A firm, time-limited quote. Stored so booking can only use a real one. */
    async quote({ entityId, segment, sell, buy, amount, tenor = 'spot', valueDate = null }) {
      if (sell === buy) throw new FxError('Sell and buy currencies are the same', 'FX_SAME_CURRENCY');
      const spreadTable = SPREAD_BPS[segment] ?? SPREAD_BPS.business;
      const bps = spreadTable[tenor];
      if (bps === undefined) {
        throw new FxError(`${segment} customers cannot deal ${tenor}`, 'FX_TENOR_NOT_AVAILABLE', { tenor });
      }

      const mid = midRate(sell, buy);
      const rate = applySpread(mid, bps);
      const proceeds = convert(amount, buy, rate);
      const now = clock.now();
      const quote = {
        id: newId('quote'),
        entityId,
        sell,
        buy,
        tenor,
        sellAmount: amount,
        buyAmount: proceeds,
        mid,
        rate,
        spreadBps: bps,
        valueDate,
        quotedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + quoteTtlSeconds * 1000).toISOString(),
        status: 'open',
      };
      await store.withTransaction((tx) => tx.insert('rates', quote));
      return quote;
    },

    async getQuote(quoteId) {
      return store.get('rates', quoteId);
    },

    /** A quote is usable once, by the entity it was given to, before it expires. */
    async consumeQuote(tx, { quoteId, entityId }) {
      const quote = await tx.get('rates', quoteId);
      if (!quote) throw new FxError(`No quote ${quoteId}`, 'FX_QUOTE_NOT_FOUND');
      if (quote.entityId !== entityId) {
        throw new FxError('That quote was given to another customer', 'FX_QUOTE_NOT_YOURS');
      }
      if (quote.status !== 'open') {
        throw new FxError(`Quote ${quoteId} is ${quote.status}`, 'FX_QUOTE_CONSUMED');
      }
      if (new Date(quote.expiresAt) <= clock.now()) {
        await tx.update('rates', quoteId, { status: 'expired' });
        throw new FxError(
          `Quote ${quoteId} expired at ${quote.expiresAt}; request a new rate`,
          'FX_QUOTE_EXPIRED',
        );
      }
      await tx.update('rates', quoteId, { status: 'consumed', consumedAt: clock.now().toISOString() });
      return quote;
    },

    /** Indicative only — no quote stored, cannot be booked. */
    indicative({ sell, buy, segment = 'business', tenor = 'spot' }) {
      const mid = midRate(sell, buy);
      const bps = (SPREAD_BPS[segment] ?? SPREAD_BPS.business)[tenor];
      return { sell, buy, mid, indicativeRate: applySpread(mid, bps ?? 50), spreadBps: bps ?? 50 };
    },

    describe(quote) {
      return `${formatWithCurrency(quote.sellAmount)} -> ${formatWithCurrency(quote.buyAmount)} at ${quote.rate} (${quote.tenor}, expires ${quote.expiresAt})`;
    },
  };
}
