import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecimal, format, formatWithCurrency, add, subtract, compare, convert,
  multiply, allocate, money, minorUnits, MoneyError, sum, zero,
} from '../src/ledger/money.js';

test('parses decimal strings at the currency\'s precision', () => {
  assert.equal(parseDecimal('1,234.56', 'AUD').amount, '123456');
  assert.equal(parseDecimal('1000', 'JPY').amount, '1000');
  assert.equal(parseDecimal('1.234', 'KWD').amount, '1234');
  assert.equal(parseDecimal('-12.50', 'USD').amount, '-1250');
  assert.equal(parseDecimal('0.5', 'AUD').amount, '50');
});

test('refuses excess precision instead of rounding it away', () => {
  // Silently rounding an instruction is how you pay the wrong amount.
  assert.throws(() => parseDecimal('1.005', 'AUD'), (e) => e.code === 'AMOUNT_PRECISION');
  assert.throws(() => parseDecimal('1.5', 'JPY'), (e) => e.code === 'AMOUNT_PRECISION');
});

test('refuses a float amount', () => {
  assert.throws(() => parseDecimal(1.5, 'AUD'), (e) => e.code === 'AMOUNT_FLOAT');
  // An integer is unambiguous and is read as major units.
  assert.equal(parseDecimal(100, 'AUD').amount, '10000');
});

test('refuses an unsupported currency and a malformed amount', () => {
  assert.throws(() => parseDecimal('1.00', 'XYZ'), (e) => e.code === 'CURRENCY_UNSUPPORTED');
  assert.throws(() => parseDecimal('ten dollars', 'AUD'), (e) => e.code === 'AMOUNT_MALFORMED');
});

test('arithmetic stays exact past the float boundary', () => {
  // 0.1 + 0.2 in floats is famously not 0.3.
  const total = add(parseDecimal('0.10', 'AUD'), parseDecimal('0.20', 'AUD'));
  assert.equal(format(total), '0.30');

  // Beyond Number.MAX_SAFE_INTEGER minor units.
  const huge = money('9007199254740993', 'AUD');
  assert.equal(add(huge, money('1', 'AUD')).amount, '9007199254740994');
});

test('refuses to mix currencies', () => {
  assert.throws(
    () => add(parseDecimal('1.00', 'AUD'), parseDecimal('1.00', 'USD')),
    (e) => e.code === 'CURRENCY_MISMATCH',
  );
});

test('converts across differing minor-unit exponents', () => {
  // AUD(2dp) -> JPY(0dp): 100.00 * 98.7654 = 9876.54 -> 9877 half-up.
  assert.equal(convert(parseDecimal('100', 'AUD'), 'JPY', '98.7654').amount, '9877');
  // JPY(0dp) -> AUD(2dp).
  assert.equal(convert(parseDecimal('10000', 'JPY'), 'AUD', '0.0101').amount, '10100');
  assert.equal(formatWithCurrency(convert(parseDecimal('100', 'AUD'), 'USD', '0.654321')), 'USD 65.43');
});

test('rounds half away from zero, symmetrically', () => {
  assert.equal(multiply(money('5', 'AUD'), '0.5').amount, '3');   // 2.5 -> 3
  assert.equal(multiply(money('-5', 'AUD'), '0.5').amount, '-3'); // -2.5 -> -3
});

test('allocate never loses or invents a minor unit', () => {
  for (const [amount, parts] of [['1.00', 3], ['0.05', 4], ['100.00', 7], ['-1.00', 3]]) {
    const original = parseDecimal(amount, 'AUD');
    const pieces = allocate(original, parts);
    assert.equal(pieces.length, parts);
    assert.equal(compare(sum(pieces, 'AUD'), original), 0, `${amount} / ${parts}`);
  }
});

test('formats with grouping and the right number of decimals', () => {
  assert.equal(format(parseDecimal('1234567.89', 'AUD')), '1,234,567.89');
  assert.equal(format(parseDecimal('1234567', 'JPY')), '1,234,567');
  assert.equal(format(parseDecimal('-0.05', 'AUD')), '-0.05');
  assert.equal(minorUnits('JPY'), 0);
});

test('subtract and compare behave at zero', () => {
  const a = parseDecimal('10.00', 'AUD');
  assert.equal(compare(subtract(a, a), zero('AUD')), 0);
  assert.equal(compare(a, parseDecimal('10.01', 'AUD')), -1);
});
