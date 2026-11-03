// What a turn costs. Rates are a local table, so every figure on the dashboard
// is an ESTIMATE — the real number is the provider's invoice. The dashboard says
// so, and so should you.
//
// Rates are per million characters (text-to-speech) or per million tokens
// (model), in US dollars, and they move. Check each provider's own pricing page
// before you quote a client. Last checked: November 2026.

export const RATES = {
  tts: {
    cartesia: 30,      // credit-based; this is a mid-plan effective rate
    elevenlabs: 80,    // pay-as-you-go, the dearest of the four
    openai: 15,        // tts-1
    polly: 4,          // standard voices, the floor
    browser: 0,        // the browser's own voice
  },
  // Not used by this demo — the brain is a pure function with no model in it.
  // Here so an SME can see what adding one would cost.
  model: { perMillionInputTokens: 0, perMillionOutputTokens: 0 },
};

export const DEFAULTS = {
  provider: 'browser',
  // When the browser's free voice is doing the talking, everything costs $0,
  // which tells an SME nothing. So we also price it as if a paid voice were
  // speaking every line — that is the number they are actually deciding on.
  referenceProvider: 'cartesia',
  monthlyCapUsd: 20,     // a cap an SME would actually set
  jobValueUsd: 90,       // one call-out, from business.js — the thing to compare against
};

/** @returns {number} dollars, estimated. */
export function ttsCost(characters, provider = DEFAULTS.provider) {
  const rate = RATES.tts[provider] ?? 0;
  return (characters * rate) / 1e6;
}

export function summariseCost(totals, opts = {}) {
  const provider = opts.provider || DEFAULTS.provider;
  const capUsd = opts.monthlyCapUsd ?? DEFAULTS.monthlyCapUsd;
  const jobValueUsd = opts.jobValueUsd ?? DEFAULTS.jobValueUsd;

  // Cached audio is already paid for, so it costs nothing to play again.
  const billableChars = totals.spokenCharacters - totals.cachedCharacters;
  const spentUsd = ttsCost(billableChars, provider);

  const referenceProvider = opts.referenceProvider || DEFAULTS.referenceProvider;
  const referenceSpentUsd = ttsCost(totals.spokenCharacters, referenceProvider);

  return {
    provider,
    free: provider === 'browser',
    referenceProvider,
    referenceSpentUsd,
    referenceCostPerBookingUsd: totals.bookings ? referenceSpentUsd / totals.bookings : null,
    billableCharacters: billableChars,
    spentUsd,
    capUsd,
    capUsedPercent: capUsd > 0 ? (spentUsd / capUsd) * 100 : 0,
    costPerTurnUsd: totals.turns ? spentUsd / totals.turns : 0,
    // The number that decides whether an SME keeps it running.
    costPerBookingUsd: totals.bookings ? spentUsd / totals.bookings : null,
    jobValueUsd,
    returnPerBooking: totals.bookings ? jobValueUsd - spentUsd / totals.bookings : null,
  };
}
