import { createBank } from '../src/bank.js';
import { loadConfig } from '../src/config.js';
import { seed } from '../src/seed.js';
import { fixedClock } from '../src/util/time.js';
import { stubProvider } from '../src/agent/llm.js';

/** Thursday 5 November 2026, 10:00 Sydney — a business day, before every cut-off. */
export const DEFAULT_NOW = '2026-11-04T23:00:00Z';

export async function makeBank({ now = DEFAULT_NOW, env = {}, plans = null } = {}) {
  const config = loadConfig({
    STORE: 'memory',
    AGENT_PROVIDER: 'stub',
    BANK_TIMEZONE: 'Australia/Sydney',
    ...env,
  });
  const bank = await createBank({
    config,
    clock: fixedClock(now),
    llm: plans ? stubProvider({ plans }) : undefined,
  });
  const ids = await seed(bank);
  return { bank, ids, config };
}

/** Collect every blocking reason code from a decision. */
export function blockCodes(decision) {
  return decision.reasons.filter((r) => r.severity === 'block').map((r) => r.code);
}

export function approvalCodes(decision) {
  return decision.reasons.filter((r) => r.severity === 'approval').map((r) => r.code);
}
