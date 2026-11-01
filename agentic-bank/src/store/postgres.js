// Postgres store.
//
// Same interface as the memory store, so nothing above it changes. Two things
// are worth knowing:
//
//   * Equality matching uses the jsonb containment operator (`data @> $1`),
//     which is served by the GIN index on every table. That keeps `find()`
//     generic without giving up indexing.
//   * Transactions are real SQL transactions and re-entrant in the same way:
//     a nested `withTransaction` joins the enclosing one, so the kernel's
//     "record, post, audit" unit stays atomic.
//
// The deferred balance trigger in db/schema.sql means an unbalanced
// transaction fails at COMMIT, not at the failing INSERT — so a caller sees
// the error from `withTransaction`, not from `post()`.

import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { TABLES } from './memory.js';

const transactionContext = new AsyncLocalStorage();

/** Postgres gives back numerics as strings; keep every amount a string. */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => value);

function assertTable(name) {
  if (!TABLES.includes(name)) throw new Error(`Unknown table: ${name}`);
  return name;
}

export function createPostgresStore(config) {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.pgPoolMax ?? 10,
    application_name: 'agentic-bank',
  });

  function readerFor(client) {
    const run = (sql, params) => (client ? client.query(sql, params) : pool.query(sql, params));

    return {
      async get(name, id) {
        const { rows } = await run(`select data from ${assertTable(name)} where id = $1`, [id]);
        return rows[0]?.data ?? null;
      },
      async all(name) {
        const { rows } = await run(`select data from ${assertTable(name)}`);
        return rows.map((r) => r.data);
      },
      async find(name, match = {}) {
        if (Object.keys(match).length === 0) return this.all(name);
        const { rows } = await run(
          `select data from ${assertTable(name)} where data @> $1::jsonb`,
          [JSON.stringify(match)],
        );
        return rows.map((r) => r.data);
      },
      async findOne(name, match = {}) {
        const rows = await this.find(name, match);
        return rows[0] ?? null;
      },
      async count(name, match = {}) {
        return (await this.find(name, match)).length;
      },
      /**
       * Highest-seq audit record, or null.
       *
       * Inside a transaction this takes a row lock on the current head, so two
       * concurrent appends serialise instead of racing to claim the same `seq`
       * with the same `prevHash`. Outside one, it is a plain read.
       */
      async auditHead() {
        const { rows } = await run(
          `select data from audit order by seq desc limit 1${client ? ' for update' : ''}`,
        );
        return rows[0]?.data ?? null;
      },
    };
  }

  function writerFor(client) {
    const reader = readerFor(client);
    return {
      ...reader,
      async insert(name, row) {
        if (!row?.id) throw new Error(`insert(${name}) requires an id`);
        try {
          await client.query(
            `insert into ${assertTable(name)} (id, data) values ($1, $2::jsonb)`,
            [row.id, JSON.stringify(row)],
          );
        } catch (err) {
          if (err.code === '23505') {
            const duplicate = new Error(`Duplicate id in ${name}: ${row.id}`);
            duplicate.code = 'STORE_DUPLICATE';
            throw duplicate;
          }
          throw err;
        }
        return row;
      },
      async put(name, row) {
        if (!row?.id) throw new Error(`put(${name}) requires an id`);
        await client.query(
          `insert into ${assertTable(name)} (id, data) values ($1, $2::jsonb)
           on conflict (id) do update set data = excluded.data`,
          [row.id, JSON.stringify(row)],
        );
        return row;
      },
      async update(name, id, patch) {
        const { rows } = await client.query(
          `update ${assertTable(name)}
             set data = data || $2::jsonb
           where id = $1
           returning data`,
          [id, JSON.stringify({ ...patch, id })],
        );
        if (rows.length === 0) throw new Error(`No ${name} row with id ${id}`);
        return rows[0].data;
      },
      async remove(name, id) {
        const { rowCount } = await client.query(
          `delete from ${assertTable(name)} where id = $1`,
          [id],
        );
        return rowCount > 0;
      },
    };
  }

  return {
    kind: 'postgres',

    ...readerFor(null),

    async withTransaction(fn) {
      const enclosing = transactionContext.getStore();
      if (enclosing) return fn(enclosing);

      const client = await pool.connect();
      const writer = writerFor(client);
      try {
        await client.query('begin');
        const result = await transactionContext.run(writer, () => fn(writer));
        // Deferred constraint triggers fire here: an unbalanced transaction
        // raises from COMMIT, after every posting has been inserted.
        await client.query('commit');
        return result;
      } catch (err) {
        try {
          await client.query('rollback');
        } catch {
          // A rollback can itself fail if the connection is already gone;
          // the original error is the one that matters.
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async healthcheck() {
      const { rows } = await pool.query('select 1 as ok');
      return { ok: rows[0].ok === 1, backend: 'postgres' };
    },

    async close() {
      await pool.end();
    },
  };
}
