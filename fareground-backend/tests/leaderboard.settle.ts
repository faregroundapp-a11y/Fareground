/**
 * Leaderboard prize settlement, against the real database.
 *
 *   npm run test:db
 *
 * Builds a finished week far in the future (so no real data is in it), with
 * six walkers in one made-up town, settles it, and checks that exactly the
 * top 3 got the right boosts - then deletes everything it made.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../src/db/pool';
import { resetSettlementCache, settleFinishedWeek } from '../src/services/leaderboard.service';

const WEEK = '2031-03-03'; // a Monday
const AFTER = new Date('2031-03-12T12:00:00Z'); // during the following week

async function main() {
  const town = `SettleTown${randomUUID().slice(0, 8)}`;
  const steps = [9000, 8000, 7000, 6000, 5000, 4000];
  const ids: string[] = [];

  await query('DELETE FROM leaderboard_weeks WHERE week_start = $1::date', [WEEK]);
  try {
    for (let i = 0; i < steps.length; i++) {
      const u = await query<{ id: string }>(
        `INSERT INTO users (username, email, password_hash, area_city, area_region, area_country)
         VALUES ($1, $2, 'x', $3, 'Settleshire', $4) RETURNING id`,
        [`${town}_${i}`, `${town.toLowerCase()}_${i}@example.com`, town, `Settleland${town}`],
      );
      ids.push(u.rows[0].id);
      await query(
        `INSERT INTO step_logs (user_id, raw_steps, wp_earned, logged_at) VALUES ($1, $2, 0, $3::timestamptz)`,
        [u.rows[0].id, steps[i], `${WEEK}T10:00:00Z`],
      );
    }

    resetSettlementCache();
    await settleFinishedWeek(AFTER);
    // A second run must change nothing.
    resetSettlementCache();
    await settleFinishedWeek(AFTER);

    const awards = await query<{ user_id: string; rank: number; multiplier: number; seconds: number; scope: string }>(
      `SELECT user_id, rank, multiplier, seconds, scope FROM leaderboard_awards
        WHERE week_start = $1::date AND user_id = ANY($2) ORDER BY rank`,
      [WEEK, ids],
    );
    assert.equal(awards.rows.length, 3, 'exactly the top 3 are rewarded');
    assert.deepEqual(awards.rows.map((a) => a.user_id), ids.slice(0, 3), 'the three biggest walkers win');
    assert.deepEqual(awards.rows.map((a) => [a.rank, a.multiplier, a.seconds]), [
      [1, 3, 259200],
      [2, 2, 172800],
      [3, 2, 86400],
    ]);

    const boosts = await query<{ user_id: string; multiplier: number; source: string }>(
      `SELECT user_id, multiplier, source FROM boosts WHERE user_id = ANY($1) ORDER BY multiplier DESC`,
      [ids],
    );
    assert.equal(boosts.rows.length, 3, 'one boost per winner, not one per board they won');
    assert.ok(boosts.rows.every((b) => b.source === 'PRIZE'));
    assert.equal(boosts.rows[0].user_id, ids[0]);
    assert.equal(boosts.rows[0].multiplier, 3);

    const settled = await query('SELECT 1 FROM leaderboard_weeks WHERE week_start = $1::date', [WEEK]);
    assert.equal(settled.rowCount, 1, 'the week is marked settled');

    console.log('PASS  leaderboard settlement: top 3 rewarded once, best prize each, idempotent');
  } finally {
    await query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    await query('DELETE FROM leaderboard_weeks WHERE week_start = $1::date', [WEEK]);
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAIL ', e);
  process.exit(1);
});
