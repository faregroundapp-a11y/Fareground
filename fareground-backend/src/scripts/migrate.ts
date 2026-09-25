/**
 * Applies every .sql file in db/migrations, in filename order.
 *
 *     npm run db:migrate
 *
 * Already-applied files are skipped (we record them in a `schema_migrations`
 * table), so running this is always safe. Each file runs inside its own
 * transaction: if one fails, that file is rolled back entirely and the ones
 * before it stay applied.
 *
 * We do this through Node rather than the `psql` command so that you do not
 * need the PostgreSQL command-line tools installed (handy on Windows).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pool, withTransaction } from '../db/pool';

async function migrate(): Promise<void> {
  // __dirname is src/scripts (or dist/scripts once compiled), so go up two
  // levels to reach the project root where db/migrations lives.
  const migrationsDir = path.resolve(__dirname, '..', '..', 'db', 'migrations');

  // Remember which files we have already run.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (row) => row.filename,
    ),
  );

  // .sort() gives us 001, 002, 003... in order, which is why the numeric
  // prefix on the filenames matters.
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log(`[migrate] No .sql files found in ${migrationsDir}`);
    return;
  }

  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skip    ${file} (already applied)`);
      continue;
    }

    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    });

    console.log(`[migrate] applied ${file}`);
    ran++;
  }

  console.log(`[migrate] Done. ${ran} migration(s) applied, ${files.length - ran} already current.`);
}

migrate()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error('[migrate] Failed:', error);
    await pool.end();
    process.exit(1);
  });
