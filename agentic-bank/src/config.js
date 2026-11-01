function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env = process.env) {
  const config = {
    port: int(env.PORT, 5100),
    store: env.STORE === 'postgres' ? 'postgres' : 'memory',
    databaseUrl: env.DATABASE_URL ?? null,
    authSecret: env.AUTH_SECRET ?? null,

    agentProvider: env.AGENT_PROVIDER === 'anthropic' ? 'anthropic' : 'stub',
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
    agentModel: env.AGENT_MODEL ?? 'claude-opus-5-5',
    agentEffort: env.AGENT_EFFORT ?? 'high',
    agentMaxSteps: int(env.AGENT_MAX_STEPS, 8),

    screeningProvider: env.SCREENING_PROVIDER ?? 'stub',
    bankTimeZone: env.BANK_TIMEZONE ?? 'Australia/Sydney',
    holidays: (env.BANK_HOLIDAYS ?? '').split(',').map((s) => s.trim()).filter(Boolean),

    duplicateWindowMinutes: int(env.DUPLICATE_WINDOW_MINUTES, 60),
    screeningMaxAgeHours: int(env.SCREENING_MAX_AGE_HOURS, 24 * 30),
    counterpartyCoolingOffMinutes: int(env.COUNTERPARTY_COOLING_OFF_MINUTES, 60),
    fxQuoteTtlSeconds: int(env.FX_QUOTE_TTL_SECONDS, 90),

    seedDemoData: bool(env.SEED_DEMO_DATA, true),
  };

  if (config.store === 'postgres' && !config.databaseUrl) {
    throw new Error('STORE=postgres requires DATABASE_URL');
  }
  if (config.agentProvider === 'anthropic' && !config.anthropicApiKey && !env.ANTHROPIC_AUTH_TOKEN) {
    // Not fatal: the SDK can also resolve an `ant auth login` profile.
    config.anthropicCredentialWarning = true;
  }
  return config;
}

/** Things that must be set before this is anywhere near real money. */
export function productionReadiness(config) {
  const blockers = [];
  if (config.store !== 'postgres') {
    blockers.push('STORE is "memory": balances are not durable and do not survive a restart.');
  }
  if (!config.authSecret) {
    blockers.push('AUTH_SECRET is unset: the demo auth shim accepts unsigned identity headers.');
  }
  if (config.screeningProvider === 'stub') {
    blockers.push('SCREENING_PROVIDER is "stub": the local demo list is not a sanctions list.');
  }
  return { ready: blockers.length === 0, blockers };
}
