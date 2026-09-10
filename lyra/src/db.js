// Postgres access layer.
//
// Two ways to talk to the DB:
//   query(text, params)        -> pool query for non-sensitive / auth lookups
//   withUser(user, fn)         -> runs fn inside a transaction that binds the
//                                 RLS context (app.user_id / tenant_id / role)
//                                 via set_config(), so Row-Level Security in
//                                 db/init.sql actually enforces per-user access.
//
// The app authenticates as the non-owner `lyra_app` role, so RLS is not
// bypassed. set_config() is used (not string-interpolated SET) to stay
// injection-safe.

import pg from 'pg';
import config from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Background client errors shouldn't crash the process.
  console.error('[db] idle client error:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `fn(client)` inside a transaction with the RLS context bound to `user`.
 * `user` must have { id, tenant_id, role }. Commits on success, rolls back on
 * throw. All queries executed on the provided client are RLS-scoped.
 */
export async function withUser(user, fn) {
  if (!user || !user.id || !user.tenant_id) {
    throw new Error('withUser requires a user with id and tenant_id');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', user.id]);
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', user.tenant_id]);
    await client.query('SELECT set_config($1, $2, true)', ['app.role', user.role || '']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function healthcheck() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}

export async function close() {
  await pool.end();
}
