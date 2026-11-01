// Money. Integer minor units, BigInt arithmetic, no floats anywhere.
//
// A float is fine for a chart and wrong for a balance. Every amount in this
// system is an integer count of minor units (cents, yen, fils) paired with an
// ISO-4217 code. The only place a decimal string appears is at the edges:
// parsing customer/agent input, and formatting output.

/** ISO-4217 minor-unit exponents for the currencies this build supports. */
const MINOR_UNITS = Object.freeze({
  AUD: 2, USD: 2, EUR: 2, GBP: 2, NZD: 2, CAD: 2, CHF: 2, SGD: 2,
  HKD: 2, CNY: 2, INR: 2, THB: 2, MYR: 2, PHP: 2, IDR: 2, ZAR: 2,
  JPY: 0, KRW: 0, VND: 0, CLP: 0,
  BHD: 3, KWD: 3, JOD: 3, OMR: 3, TND: 3,
});

export class MoneyError extends Error {
  constructor(message, code = 'MONEY_INVALID') {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

export function isSupportedCurrency(code) {
  return typeof code === 'string' && Object.hasOwn(MINOR_UNITS, code);
}

export function minorUnits(currency) {
  if (!isSupportedCurrency(currency)) {
    throw new MoneyError(`Unsupported currency: ${currency}`, 'CURRENCY_UNSUPPORTED');
  }
  return MINOR_UNITS[currency];
}

export function supportedCurrencies() {
  return Object.keys(MINOR_UNITS);
}

/**
 * A Money value is a plain frozen object so it serialises straight to JSON and
 * survives a trip through the store or an audit record unchanged.
 * `amount` is a string holding an integer count of minor units — a string
 * because JSON has no integer type that is safe past 2^53, and an institutional
 * ledger will exceed that (10^15 minor units is only AUD 10 trillion).
 */
export function money(amountMinor, currency) {
  const units = minorUnits(currency);
  const amount = toBigInt(amountMinor);
  return Object.freeze({ amount: amount.toString(), currency, scale: units });
}

export function isMoney(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.amount === 'string' &&
    isSupportedCurrency(value.currency)
  );
}

function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new MoneyError(`Minor-unit amount must be an integer, got ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(`Minor-unit amount ${value} exceeds safe integer range; pass a string`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value)) {
      throw new MoneyError(`Minor-unit amount must be an integer string, got "${value}"`);
    }
    return BigInt(value);
  }
  throw new MoneyError(`Cannot read a minor-unit amount from ${typeof value}`);
}

/** The integer minor-unit value of a Money, as a BigInt. */
export function minor(m) {
  assertMoney(m);
  return BigInt(m.amount);
}

export function assertMoney(m) {
  if (!isMoney(m)) throw new MoneyError(`Not a Money value: ${JSON.stringify(m)}`);
  return m;
}

export function assertSameCurrency(a, b) {
  assertMoney(a);
  assertMoney(b);
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Currency mismatch: ${a.currency} vs ${b.currency}`,
      'CURRENCY_MISMATCH',
    );
  }
}

/**
 * Parse a decimal amount written by a human or produced by a model.
 * Accepts "1234.56", "1,234.56", "-12", " 0.50 ". Rejects anything with more
 * decimal places than the currency has — "1.005" in AUD is an error, not a
 * rounding opportunity, because silently rounding someone's instruction is how
 * you end up paying the wrong amount.
 */
export function parseDecimal(input, currency) {
  const units = minorUnits(currency);
  if (typeof input === 'bigint') return money(input, currency);
  if (typeof input === 'number') {
    // A float arriving here is already suspect; only accept exact integers and
    // treat them as major units, which is what a model writing `100` means.
    if (!Number.isInteger(input)) {
      throw new MoneyError(
        `Refusing to read ${input} as ${currency}: pass amounts as decimal strings, not floats`,
        'AMOUNT_FLOAT',
      );
    }
    return money(BigInt(input) * 10n ** BigInt(units), currency);
  }
  if (typeof input !== 'string') {
    throw new MoneyError(`Cannot parse an amount from ${typeof input}`);
  }

  const raw = input.trim().replace(/,/g, '');
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!match) throw new MoneyError(`Malformed amount: "${input}"`, 'AMOUNT_MALFORMED');

  const [, sign, whole, fractionRaw = ''] = match;
  if (fractionRaw.length > units) {
    throw new MoneyError(
      `${currency} has ${units} decimal place(s); "${input}" has ${fractionRaw.length}`,
      'AMOUNT_PRECISION',
    );
  }
  const fraction = fractionRaw.padEnd(units, '0');
  const magnitude = BigInt(whole + fraction);
  return money(sign === '-' ? -magnitude : magnitude, currency);
}

/** Format for display: "1,234.56". Never used for arithmetic. */
export function format(m, { grouping = true } = {}) {
  assertMoney(m);
  const units = minorUnits(m.currency);
  const value = BigInt(m.amount);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(units + 1, '0');
  const whole = digits.slice(0, digits.length - units) || '0';
  const fraction = units > 0 ? digits.slice(digits.length - units) : '';
  const grouped = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return `${negative ? '-' : ''}${grouped}${fraction ? '.' + fraction : ''}`;
}

/** "AUD 1,234.56" — the form used in agent-facing text and audit records. */
export function formatWithCurrency(m) {
  return `${m.currency} ${format(m)}`;
}

export function add(a, b) {
  assertSameCurrency(a, b);
  return money(minor(a) + minor(b), a.currency);
}

export function subtract(a, b) {
  assertSameCurrency(a, b);
  return money(minor(a) - minor(b), a.currency);
}

export function negate(a) {
  return money(-minor(a), a.currency);
}

export function abs(a) {
  const v = minor(a);
  return money(v < 0n ? -v : v, a.currency);
}

/** -1, 0 or 1. */
export function compare(a, b) {
  assertSameCurrency(a, b);
  const x = minor(a);
  const y = minor(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export const lt = (a, b) => compare(a, b) < 0;
export const lte = (a, b) => compare(a, b) <= 0;
export const gt = (a, b) => compare(a, b) > 0;
export const gte = (a, b) => compare(a, b) >= 0;
export const isZero = (a) => minor(a) === 0n;
export const isNegative = (a) => minor(a) < 0n;
export const isPositive = (a) => minor(a) > 0n;

export function zero(currency) {
  return money(0n, currency);
}

export function sum(values, currency) {
  let total = zero(currency);
  for (const v of values) total = add(total, v);
  return total;
}

/** Half-up rounding of a BigInt quotient, sign-aware. */
function divideRoundHalfUp(numerator, denominator) {
  if (denominator === 0n) throw new MoneyError('Division by zero', 'MONEY_DIV_ZERO');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  // Round half away from zero: 2.5 -> 3, -2.5 -> -3.
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Convert between currencies at an explicit rate.
 *
 * `rate` is a decimal string (e.g. "0.65432100") meaning: one unit of
 * `from.currency` buys `rate` units of `toCurrency`, expressed in MAJOR units
 * on both sides — which is how a dealer quotes it. The minor-unit exponent
 * difference is applied here, so AUD->JPY works without a special case.
 */
export function convert(from, toCurrency, rate) {
  assertMoney(from);
  const toUnits = minorUnits(toCurrency);
  const fromUnits = minorUnits(from.currency);
  const { numerator: rateNum, denominator: rateDen } = parseRate(rate);

  let numerator = minor(from) * rateNum;
  let denominator = rateDen;
  const exponentDelta = toUnits - fromUnits;
  if (exponentDelta > 0) numerator *= 10n ** BigInt(exponentDelta);
  else if (exponentDelta < 0) denominator *= 10n ** BigInt(-exponentDelta);

  return money(divideRoundHalfUp(numerator, denominator), toCurrency);
}

export function parseRate(rate) {
  const raw = typeof rate === 'number' ? String(rate) : String(rate).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new MoneyError(`Malformed FX rate: "${rate}"`, 'RATE_MALFORMED');
  const [, whole, fraction = ''] = match;
  const numerator = BigInt(whole + fraction);
  if (numerator === 0n) throw new MoneyError('FX rate must be greater than zero', 'RATE_ZERO');
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

/**
 * Multiply by a decimal factor (a fee rate, a haircut, a utilisation ratio).
 * Same rounding rule as `convert`.
 */
export function multiply(m, factor) {
  const { numerator, denominator } = parseRate(factor);
  return money(divideRoundHalfUp(minor(m) * numerator, denominator), m.currency);
}

/**
 * Split an amount into `parts` pieces that sum exactly to the original.
 * The remainder is distributed one minor unit at a time from the front, so
 * splitting 100 three ways gives 34/33/33 and never loses a cent.
 */
export function allocate(m, parts) {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new MoneyError(`allocate() needs a positive integer part count, got ${parts}`);
  }
  const total = minor(m);
  const base = total / BigInt(parts);
  let remainder = total - base * BigInt(parts);
  const step = remainder < 0n ? -1n : 1n;
  if (remainder < 0n) remainder = -remainder;

  const out = [];
  for (let i = 0; i < parts; i += 1) {
    let value = base;
    if (remainder > 0n) {
      value += step;
      remainder -= 1n;
    }
    out.push(money(value, m.currency));
  }
  return out;
}
