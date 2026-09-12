import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePreferences, allowedAccents, KID_ACCENTS, ACCENTS } from '../src/domain/theme.js';

test('adults may pick any accent; kids are limited to the curated set', () => {
  assert.deepEqual(allowedAccents('parent_admin').sort(), Object.keys(ACCENTS).sort());
  assert.deepEqual(allowedAccents('child').sort(), [...KID_ACCENTS].sort());
  assert.ok(!KID_ACCENTS.includes('slate'), 'curated set excludes low-pop accents');
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
