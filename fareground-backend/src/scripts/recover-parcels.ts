/**
 * Put back parcels that were claimed on the OLD database after it was copied.
 *
 *   OLD_DATABASE_URL=<render url> NEW_DATABASE_URL=<neon url> npx tsx src/scripts/recover-parcels.ts
 *   ...same, with --apply at the end, to actually write
 *
 * WHY THIS EXISTS (2026-09-27). The database moved from Render to Neon by
 * dump and restore. The server kept writing to Render between the dump and
 * the moment it restarted on Neon, so every parcel claimed in that gap lives
 * only in the old database - and those players saw their land vanish.
 *
 * What it does, all in one transaction on the NEW database:
 *
 *   1. Players who signed up in the gap exist only in the old database. Each
 *      is matched to the new database by id, then email, then username (they
 *      may have signed up again). Anyone with no match is copied across.
 *   2. Every parcel in the old database that the new one lacks is copied,
 *      owner mapped as above, upgrades and all.
 *   3. A parcel whose map cell has since been claimed by someone else on the
 *      new database cannot go back: its owner is refunded the parcel's price
 *      in Walk Points instead.
 *
 * Nothing is ever deleted or overwritten, and WP spent on the recovered
 * parcels is NOT taken back: players already lost them once. Running it twice
 * is safe - the second run finds nothing missing, and each refund is recorded
 * in parcel_recovery_refunds so it is never paid twice.
 *
 * Without --apply it only reports what it would do, and changes nothing.
 */
import { Pool, type PoolClient } from 'pg';
import { PARCEL_BASE_PRICE_WP } from '../game/rules';

const APPLY = process.argv.includes('--apply');

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`\n  Set ${name} first. See the comment at the top of this file.\n`);
    process.exit(1);
  }
  return v;
}

type Row = Record<string, unknown>;

/** Columns that exist in BOTH databases, so an older or newer schema never breaks the copy. */
async function sharedColumns(oldDb: Pool, client: PoolClient, table: string): Promise<string[]> {
  const sql = `SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1`;
  const a = new Set((await oldDb.query(sql, [table])).rows.map((r) => r.column_name as string));
  const b = (await client.query(sql, [table])).rows.map((r) => r.column_name as string);
  return b.filter((c) => a.has(c));
}

/** Insert one row, inside a savepoint so a single bad row cannot sink the rest. */
async function insertRow(client: PoolClient, table: string, cols: string[], row: Row): Promise<string | null> {
  const list = cols.map((c) => `"${c}"`).join(', ');
  const params = cols.map((_, i) => `$${i + 1}`).join(', ');
  await client.query('SAVEPOINT row');
  try {
    await client.query(`INSERT INTO ${table} (${list}) VALUES (${params})`, cols.map((c) => row[c]));
    await client.query('RELEASE SAVEPOINT row');
    return null;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT row');
    return e instanceof Error ? e.message : String(e);
  }
}

async function main(): Promise<void> {
  const oldDb = new Pool({ connectionString: need('OLD_DATABASE_URL') });
  const newDb = new Pool({ connectionString: need('NEW_DATABASE_URL') });
  const client = await newDb.connect();

  try {
    await client.query('BEGIN');

    // ---- 1. Players ------------------------------------------------------
    const userCols = await sharedColumns(oldDb, client, 'users');
    const oldUsers = (await oldDb.query(`SELECT * FROM users`)).rows as Row[];
    const newUsers = (await client.query(`SELECT id, lower(email) AS email, lower(username) AS username FROM users`)).rows;
    const byId = new Set(newUsers.map((u) => u.id as string));
    const byEmail = new Map(newUsers.map((u) => [u.email as string, u.id as string]));
    const byName = new Map(newUsers.map((u) => [u.username as string, u.id as string]));

    /** old user id -> the id that player has in the new database */
    const owner = new Map<string, string>();
    const copiedUsers: string[] = [];
    const failedUsers: string[] = [];

    for (const u of oldUsers) {
      const id = u.id as string;
      const matched =
        (byId.has(id) && id) ||
        byEmail.get(String(u.email).toLowerCase()) ||
        byName.get(String(u.username).toLowerCase());
      if (matched) {
        owner.set(id, matched);
        continue;
      }
      const err = await insertRow(client, 'users', userCols, u);
      if (err) failedUsers.push(`${u.username}: ${err}`);
      else {
        owner.set(id, id);
        copiedUsers.push(String(u.username));
      }
    }

    // ---- 2 + 3. Parcels ----------------------------------------------------
    const parcelCols = await sharedColumns(oldDb, client, 'parcels');
    const have = new Set((await client.query(`SELECT id FROM parcels`)).rows.map((r) => r.id as string));
    const taken = new Set(
      (await client.query(`SELECT cell_x, cell_y FROM parcels WHERE cell_x IS NOT NULL`)).rows.map(
        (r) => `${r.cell_x}:${r.cell_y}`,
      ),
    );
    const names = new Map(oldUsers.map((u) => [u.id as string, String(u.username)]));
    // Refunds already paid by an earlier run.
    await client.query(
      `CREATE TABLE IF NOT EXISTS parcel_recovery_refunds (
         parcel_id   UUID PRIMARY KEY,
         user_id     UUID NOT NULL,
         walk_points INTEGER NOT NULL,
         refunded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    const paid = new Set(
      (await client.query(`SELECT parcel_id FROM parcel_recovery_refunds`)).rows.map((r) => r.parcel_id as string),
    );

    const restored = new Map<string, number>(); // username -> parcels
    const refunded = new Map<string, number>(); // username -> parcels refunded
    const problems: string[] = [];

    for (const p of (await oldDb.query(`SELECT * FROM parcels ORDER BY purchased_at`)).rows as Row[]) {
      if (have.has(p.id as string)) continue;
      const name = names.get(p.owner_id as string) ?? String(p.owner_id);
      const to = owner.get(p.owner_id as string);
      if (!to) {
        problems.push(`${name}: parcel ${p.id} has no owner in the new database`);
        continue;
      }
      const cell = p.cell_x == null ? null : `${p.cell_x}:${p.cell_y}`;

      if (cell && taken.has(cell)) {
        if (paid.has(p.id as string)) continue;
        await client.query(
          `INSERT INTO parcel_recovery_refunds (parcel_id, user_id, walk_points) VALUES ($1, $2, $3)`,
          [p.id, to, PARCEL_BASE_PRICE_WP],
        );
        await client.query(
          `UPDATE users SET walk_points_balance = walk_points_balance + $2 WHERE id = $1`,
          [to, PARCEL_BASE_PRICE_WP],
        );
        refunded.set(name, (refunded.get(name) ?? 0) + 1);
        continue;
      }

      const err = await insertRow(client, 'parcels', parcelCols, { ...p, owner_id: to });
      if (err) problems.push(`${name}: parcel ${p.id}: ${err}`);
      else {
        if (cell) taken.add(cell);
        restored.set(name, (restored.get(name) ?? 0) + 1);
      }
    }

    // ---- Report ------------------------------------------------------------
    const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    console.log(`\n  ${APPLY ? 'APPLIED' : 'DRY RUN - nothing written. Add --apply to do it.'}\n`);
    console.log(`  Players copied across:   ${copiedUsers.length}${copiedUsers.length ? `  (${copiedUsers.join(', ')})` : ''}`);
    console.log(`  Parcels restored:        ${total(restored)}`);
    for (const [n, c] of restored) console.log(`      ${n.padEnd(24)} ${c}`);
    console.log(`  Parcels refunded (${PARCEL_BASE_PRICE_WP} WP each, cell taken since): ${total(refunded)}`);
    for (const [n, c] of refunded) console.log(`      ${n.padEnd(24)} ${c}  (+${c * PARCEL_BASE_PRICE_WP} WP)`);
    if (failedUsers.length || problems.length) {
      console.log(`\n  Could not recover (${failedUsers.length + problems.length}):`);
      for (const f of [...failedUsers, ...problems]) console.log(`      ${f}`);
    }
    console.log('');

    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await oldDb.end();
    await newDb.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
