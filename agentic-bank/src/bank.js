// Composition root.
//
// Everything is constructed here and injected downwards. No module reaches for
// a global, a singleton or `process.env` on its own, which is what makes the
// whole bank constructible in a test with a fixed clock and an empty store.

import { createStore } from './store/index.js';
import { createLedger } from './ledger/ledger.js';
import { buildRegistry } from './capabilities/index.js';
import { createAudit } from './kernel/audit.js';
import { createMandates } from './kernel/mandates.js';
import { createApprovals } from './kernel/approvals.js';
import { createScreening, stubScreeningProvider } from './kernel/screening.js';
import { createKernel } from './kernel/engine.js';
import { createFx } from './services/fx.js';
import { createLlm } from './agent/llm.js';
import { createAgentRuntime } from './agent/runtime.js';
import { systemClock } from './util/time.js';

export async function createBank({ config, clock = systemClock(), store = null, llm = null }) {
  const resolvedStore = store ?? (await createStore(config));
  const audit = createAudit({ store: resolvedStore, clock });
  const ledger = createLedger({ store: resolvedStore, clock });
  const registry = buildRegistry();
  const mandates = createMandates({ store: resolvedStore, clock, audit });
  const approvals = createApprovals({ store: resolvedStore, clock, audit });
  const screening = createScreening({ provider: stubScreeningProvider(), clock });
  const fx = createFx({ store: resolvedStore, clock, config });

  const kernel = createKernel({
    store: resolvedStore, clock, ledger, registry, mandates, approvals, audit, screening, fx, config,
  });

  const model = llm ?? createLlm(config);
  const agent = createAgentRuntime({
    llm: model, registry, kernel, ledger, mandates, store: resolvedStore, clock, audit, config,
  });

  return {
    config,
    clock,
    store: resolvedStore,
    audit,
    ledger,
    registry,
    mandates,
    approvals,
    screening,
    fx,
    kernel,
    agent,
    llm: model,
    async close() {
      await resolvedStore.close?.();
    },
  };
}
