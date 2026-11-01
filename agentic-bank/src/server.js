import { loadConfig, productionReadiness } from './config.js';
import { createBank } from './bank.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const config = loadConfig();
const bank = await createBank({ config });

if (config.store === 'memory' && config.seedDemoData) {
  const ids = await seed(bank);
  console.log('[agentic-bank] seeded demo customers:');
  console.log(`  consumer      entity=${ids.consumer.entityId} agent=${ids.consumer.agentId}`);
  console.log(`  business      entity=${ids.business.entityId} agent=${ids.business.agentId}`);
  console.log(`  institutional entity=${ids.institutional.treasuryEntityId} agent=${ids.institutional.agentId}`);
}

const readiness = productionReadiness(config);
if (!readiness.ready) {
  console.warn('[agentic-bank] NOT production ready:');
  for (const blocker of readiness.blockers) console.warn(`  - ${blocker}`);
}

const app = createApp({ bank });
const server = app.listen(config.port, () => {
  console.log(`[agentic-bank] listening on :${config.port} (store=${config.store}, agent=${bank.llm.name})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await bank.close();
      process.exit(0);
    });
  });
}
