// Counterparty and payment screening.
//
// Fails closed. If the screening provider cannot answer, the result is
// `unavailable` and the policy engine denies — there is no configuration that
// turns screening off, because "the screening service was down" is not a
// defence a bank gets to make.
//
// The stub provider below is a local list for the demo and the tests. A real
// deployment replaces it with the bank's own sanctions, PEP and adverse-media
// screening; the interface is deliberately narrow so that swap is a one-file
// change.

export const SCREENING_STATUS = Object.freeze({
  CLEAR: 'clear',
  REVIEW: 'review',
  BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable',
});

/** Illustrative only — not a sanctions list. */
const DEMO_DENY_NAMES = [
  'volkov industrial holdings',
  'crimson dawn trading',
  'northgate shell ltd',
];
const DEMO_REVIEW_NAMES = ['pelican offshore services'];
const DEMO_BLOCKED_JURISDICTIONS = ['KP', 'IR', 'SY', 'CU'];
const DEMO_REVIEW_JURISDICTIONS = ['RU', 'BY', 'MM'];

function normalise(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function stubScreeningProvider() {
  return {
    name: 'stub',
    async screen({ name, country = null }) {
      const needle = normalise(name);
      const matches = [];

      if (DEMO_DENY_NAMES.includes(needle)) {
        matches.push({ type: 'name', list: 'demo-deny', score: 100 });
      } else if (DEMO_REVIEW_NAMES.includes(needle)) {
        matches.push({ type: 'name', list: 'demo-review', score: 72 });
      }
      if (country && DEMO_BLOCKED_JURISDICTIONS.includes(country)) {
        matches.push({ type: 'jurisdiction', list: 'demo-blocked-jurisdiction', score: 100 });
      } else if (country && DEMO_REVIEW_JURISDICTIONS.includes(country)) {
        matches.push({ type: 'jurisdiction', list: 'demo-review-jurisdiction', score: 60 });
      }

      const top = matches.reduce((max, m) => Math.max(max, m.score), 0);
      const status =
        top >= 90 ? SCREENING_STATUS.BLOCKED
          : top >= 50 ? SCREENING_STATUS.REVIEW
            : SCREENING_STATUS.CLEAR;
      return { status, matches };
    },
  };
}

export function createScreening({ provider = stubScreeningProvider(), clock }) {
  return {
    providerName: provider.name,

    async screen(subject) {
      try {
        const result = await provider.screen(subject);
        if (!Object.values(SCREENING_STATUS).includes(result?.status)) {
          throw new Error(`Screening provider returned an unknown status: ${result?.status}`);
        }
        return {
          status: result.status,
          matches: result.matches ?? [],
          provider: provider.name,
          screenedAt: clock.now().toISOString(),
        };
      } catch (err) {
        // Fail closed, and say why.
        return {
          status: SCREENING_STATUS.UNAVAILABLE,
          matches: [],
          provider: provider.name,
          screenedAt: clock.now().toISOString(),
          error: err.message,
        };
      }
    },

    /** Screening older than `maxAgeHours` is not a current answer. */
    isStale(screening, maxAgeHours = 24 * 30) {
      if (!screening?.screenedAt) return true;
      const age = clock.now().getTime() - new Date(screening.screenedAt).getTime();
      return age > maxAgeHours * 3600 * 1000;
    },
  };
}
