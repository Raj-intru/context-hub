// Server entrypoint: boots the HTTP app, optionally schedules the weekly
// digest cron, and handles graceful shutdown.

import cron from 'node-cron';
import { createApp } from './app.js';
import config from './config.js';
import { close as closeDb, healthcheck } from './db.js';
import { runWeeklyDigest } from './services/digest.js';

async function main() {
  // Verify DB connectivity at boot (fail fast in orchestration).
  try {
    await healthcheck();
    console.log('[boot] database reachable');
  } catch (err) {
    console.error('[boot] database not reachable:', err.message);
    if (config.isProd) process.exit(1);
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Lyra listening on :${config.port} (${config.env})`);
  });

  // Weekly digest: Sundays 18:00 server time.
  if (config.enableWeeklyDigest) {
    cron.schedule('0 18 * * 0', () => {
      runWeeklyDigest().catch((e) => console.error('[digest] failed:', e));
    });
    console.log('[boot] weekly digest cron enabled');
  }

  const shutdown = async (signal) => {
    console.log(`[shutdown] received ${signal}`);
    server.close(async () => {
      await closeDb().catch(() => {});
      process.exit(0);
    });
    // Force-exit if graceful close hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
