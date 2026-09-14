import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePreferences, allowedAccents, KID_ACCENTS, ACCENTS, ACCENT_ON, accentOn } from '../src/domain/theme.js';

// WCAG 2.1 relative-luminance + contrast helpers (for the accent-contrast test).
function luminance(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}

test('adults may pick any accent; kids are limited to the curated set', () => {
  assert.deepEqual(allowedAccents('parent_admin').sort(), Object.keys(ACCENTS).sort());
  assert.deepEqual(allowedAccents('child').sort(), [...KID_ACCENTS].sort());
  assert.ok(!KID_ACCENTS.includes('slate'), 'curated set excludes low-pop accents');
});

test('every accent has a foreground clearing WCAG AA (4.5:1) for text', () => {
  for (const [name, hex] of Object.entries(ACCENTS)) {
    const on = ACCENT_ON[name];
    assert.ok(on, `accent ${name} has no ACCENT_ON foreground`);
    const ratio = contrast(hex, on);
    assert.ok(ratio >= 4.5, `accent ${name} (${hex} on ${on}) contrast ${ratio.toFixed(2)} < 4.5`);
  }
  assert.equal(accentOn('unknown-accent'), '#ffffff'); // safe default
});

test('valid preferences pass and normalize', () => {
  assert.deepEqual(validatePreferences({ theme: 'dark', accent: 'teal' }, 'adult'), { theme: 'dark', accent: 'teal' });
  assert.deepEqual(validatePreferences({ theme: 'system' }, 'child'), { theme: 'system' });
});

test('invalid theme is rejected', () => {
  assert.throws(() => validatePreferences({ theme: 'neon' }, 'adult'));
});

test('a child cannot pick an accent outside the curated set', () => {
  // slate is valid globally but not permitted for a supervised role
  assert.throws(() => validatePreferences({ accent: 'slate' }, 'student'));
  // but a curated accent is fine
  assert.deepEqual(validatePreferences({ accent: 'rose' }, 'student'), { accent: 'rose' });
});

test('unknown accent is rejected for everyone', () => {
  assert.throws(() => validatePreferences({ accent: 'chartreuse' }, 'parent_admin'));
});

test('empty patch is rejected', () => {
  assert.throws(() => validatePreferences({}, 'adult'));
});
