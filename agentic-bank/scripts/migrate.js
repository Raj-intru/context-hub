// Apply db/schema.sql. Idempotent — every statement is `if not exists` or a
// `create or replace`, so running it twice is safe.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'db', 'schema.sql');

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL (or MIGRATE_DATABASE_URL for a privileged connection).');
  process.exit(1);
}

const schema = await readFile(schemaPath, 'utf8');
const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  await client.query(schema);
  console.log(`[agentic-bank] applied ${path.relative(process.cwd(), schemaPath)}`);
} catch (err) {
  console.error('[agentic-bank] migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
