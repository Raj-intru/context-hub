// Per-user appearance preferences: light/dark/system + an accent colour.
// Supervised accounts (child/student) get a curated, high-contrast subset so a
// kid can't pick an unreadable combo; adults/admins get the full palette.

import { isSupervised } from './roles.js';

export const THEMES = ['light', 'dark', 'system'];

// Accent name -> base hex. Each is legible on both the light and dark grounds.
export const ACCENTS = {
  indigo: '#4f46e5',
  violet: '#7c3aed',
  sky: '#0284c7',
  teal: '#0d9488',
  emerald: '#059669',
  rose: '#e11d48',
  amber: '#d97706',
  slate: '#475569',
};

// Foreground colour to place ON each accent (for the user bubble, primary
// buttons, active tabs). Chosen per-accent so text-on-accent clears the WCAG
// 2.1 AA 4.5:1 contrast ratio: dark ink on the lighter/mid accents, white on
// the darker ones. (Computed from each accent's relative luminance; the mid
// accents — sky/teal/emerald/amber — fail white text, so they take dark ink.)
const DARK_INK = '#0d0d16';
export const ACCENT_ON = {
  indigo: '#ffffff',
  violet: '#ffffff',
  sky: DARK_INK,
  teal: DARK_INK,
  emerald: DARK_INK,
  rose: '#ffffff',
  amber: DARK_INK,
  slate: '#ffffff',
};

export function accentOn(name) {
  return ACCENT_ON[name] || '#ffffff';
}

// Friendly, bright subset offered to children/students.
export const KID_ACCENTS = ['indigo', 'violet', 'sky', 'teal', 'emerald', 'rose'];

export const DEFAULT_THEME = 'system';
export const DEFAULT_ACCENT = 'indigo';

export function allowedAccents(role) {
  return isSupervised(role) ? KID_ACCENTS : Object.keys(ACCENTS);
}

/**
 * Normalize + validate a preferences patch for a given role.
 * Missing fields keep their current/default value. Throws on invalid input.
 */
export function validatePreferences({ theme, accent }, role) {
  const out = {};
  if (theme !== undefined) {
    if (!THEMES.includes(theme)) throw new Error(`Invalid theme: ${theme}`);
    out.theme = theme;
  }
  if (accent !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(ACCENTS, accent)) throw new Error(`Unknown accent: ${accent}`);
    if (!allowedAccents(role).includes(accent)) throw new Error(`Accent not permitted for this role: ${accent}`);
    out.accent = accent;
  }
  if (theme === undefined && accent === undefined) throw new Error('No preferences provided');
  return out;
}
