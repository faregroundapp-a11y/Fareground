/**
 * The single PostgreSQL connection pool for the whole app.
 *
 * A "pool" keeps a handful of connections open and hands them out as requests
 * come in. Opening a fresh connection per request would be far too slow.
 */
import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config/env';

/**
 * IMPORTANT little gotcha:
 * PostgreSQL's BIGINT (a.k.a. int8) can hold numbers larger than JavaScript's
 * Number can represent exactly, so the "pg" driver returns them as STRINGS by
 * default. That would make `coin_balance` come back as "150" instead of 150.
 *
 * Our coin balances (and COUNT(*) / SUM() results) will never come close to
 * JavaScript's safe limit of 9,007,199,254,740,991, so we tell the driver to
 * give us real numbers and keep the rest of the codebase simple.
 */
// 20 is PostgreSQL's internal type id (OID) for int8/BIGINT.
const POSTGRES_INT8_OID = 20;
types.setTypeParser(POSTGRES_INT8_OID, (value: string) => Number.parseInt(value, 10));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10, // maximum simultaneous connections
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// A connection can die while sitting idle (network blip, database restart).
// Without this listener Node would treat that as an unhandled error and exit.
pool.on('error', (error) => {
  console.error('[db] Unexpected error on an idle client:', error);
});

/**
 * Run a one-off query. Always pass values through `params` ($1, $2, ...) and
 * NEVER build SQL by string concatenation - that is how SQL injection happens.
 *
 *   const result = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
 */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/**
 * Run several statements as one all-or-nothing transaction.
 *
 * If the callback throws, everything it did is rolled back as though it never
 * happened. This is what makes "deduct 100 WP AND create a parcel" safe: a
 * player can never lose Walk Points without receiving their parcel.
 *
 *   const parcel = await withTransaction(async (client) => {
 *     await client.query('UPDATE ...');
 *     return client.query('INSERT ...');
 *   });
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Roll back, but never let a failing ROLLBACK hide the real error.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] ROLLBACK failed:', rollbackError);
    }
    throw error;
  } finally {
    // ALWAYS give the connection back to the pool, success or failure.
    client.release();
  }
}

/** Simple startup check so we fail fast if the database is unreachable. */
export async function assertDatabaseConnection(): Promise<void> {
  await pool.query('SELECT 1');
}
