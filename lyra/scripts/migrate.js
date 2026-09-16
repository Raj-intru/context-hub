// Apply db/init.sql to a database for non-Docker deploys (managed Postgres,
// Supabase, RDS, etc.). Creating the lyra_app role requires a privileged
// connection, so pass one via MIGRATE_DATABASE_URL (falls back to DATABASE_URL).
//
//   MIGRATE_DATABASE_URL=postgres://admin:...@host/db \
//   LYRA_APP_DB_PASSWORD=... \
//   node scripts/migrate.js

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const connectionString = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set MIGRATE_DATABASE_URL or DATABASE_URL');
  const appPassword = process.env.LYRA_APP_DB_PASSWORD;

  const sql = await readFile(path.join(__dirname, '..', 'db', 'init.sql'), 'utf8');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
    if (appPassword) {
      await client.query(`ALTER ROLE lyra_app WITH PASSWORD '${appPassword.replace(/'/g, "''")}'`);
      console.log('lyra_app password set.');
    } else {
      console.warn('LYRA_APP_DB_PASSWORD not set — lyra_app role has no password yet.');
    }
    console.log('Migration applied.');
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
