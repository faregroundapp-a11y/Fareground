/**
 * Who does the anti-spoofing think is cheating, and on what evidence?
 *
 *   npx tsx src/scripts/integrity-report.ts              the queue
 *   npx tsx src/scripts/integrity-report.ts <email>      one account, in full
 *   npx tsx src/scripts/integrity-report.ts <email> clear   vouch for them
 *
 * THIS SCRIPT IS THE POINT OF THE WHOLE DESIGN. Nothing in the system bans
 * anybody: the score throttles quietly and then puts a name in this queue for
 * a person to look at. Every signal feeding it has an innocent explanation -
 * a treadmill, a tunnel, a developer phone, a passenger on a train - so the
 * last step is deliberately a human one.
 *
 * `clear` marks an account exempt: it keeps collecting evidence (so a genuine
 * cheat who talked their way past a review is still visible) but its tier can
 * never move again.
 */
import { pool } from '../db/pool';
import { describeStepFlags, INTEGRITY_SCORE_WINDOW_DAYS } from '../game/rules';
import { reviewQueue } from '../services/integrity.service';

const pct = (n: number, d: number) => (d === 0 ? '  -  ' : `${Math.round((n / d) * 100)}%`.padStart(5));

async function queue(): Promise<void> {
  const rows = await reviewQueue();
  if (rows.length === 0) {
    console.log('\n  Nobody is flagged. Either the game is clean or nobody has played.\n');
    return;
  }
  console.log(`\n  Accounts with integrity signals in the last ${INTEGRITY_SCORE_WINDOW_DAYS} days\n`);
  console.log('  score  tier        events  account');
  console.log('  ' + '-'.repeat(66));
  for (const r of rows) {
    console.log(
      '  ' +
        String(r.integrity_score).padStart(5) +
        '  ' + String(r.integrity_tier).padEnd(11) +
        String(r.events).padStart(6) + '  ' +
        r.username + '  <' + r.email + '>',
    );
  }
  console.log('\n  npx tsx src/scripts/integrity-report.ts <email>  for the evidence\n');
}

async function account(email: string, action?: string): Promise<void> {
  const u = await pool.query<{
    id: string; username: string; integrity_score: number; integrity_tier: string;
    integrity_exempt: boolean; created_at: Date;
  }>(
    `SELECT id, username, integrity_score, integrity_tier, integrity_exempt, created_at
       FROM users WHERE email = $1`,
    [email],
  );
  if (u.rowCount === 0) {
    console.log(`\n  No account with email ${email}.\n`);
    return;
  }
  const user = u.rows[0];

  if (action === 'clear') {
    await pool.query(
      `UPDATE users SET integrity_exempt = TRUE, integrity_tier = 'CLEAR',
              integrity_reviewed_at = NOW() WHERE id = $1`,
      [user.id],
    );
    console.log(`\n  ${user.username} is now exempt. Evidence keeps accruing; the tier will not move again.\n`);
    return;
  }

  console.log(`\n  ${user.username}  <${email}>`);
  console.log(`  score ${user.integrity_score}   tier ${user.integrity_tier}` +
    (user.integrity_exempt ? '   EXEMPT (a human vouched for this account)' : ''));

  // The numbers that decide it: how much of their walking the ground backs up.
  const steps = await pool.query<{
    raw: number; corrob: number; uncorrob: number; traced: number; syncs: number; flagged: number;
  }>(
    `SELECT COALESCE(SUM(raw_steps),0)::int AS raw,
            COALESCE(SUM(corroborated_steps),0)::int AS corrob,
            COALESCE(SUM(uncorroborated_steps),0)::int AS uncorrob,
            COUNT(*) FILTER (WHERE distance_m IS NOT NULL)::int AS traced,
            COUNT(*)::int AS syncs,
            COUNT(*) FILTER (WHERE integrity_flags <> 0)::int AS flagged
       FROM step_logs
      WHERE user_id = $1 AND logged_at > NOW() - ($2 || ' days')::interval`,
    [user.id, INTEGRITY_SCORE_WINDOW_DAYS],
  );
  const s = steps.rows[0];
  console.log(`\n  Steps, last ${INTEGRITY_SCORE_WINDOW_DAYS} days`);
  console.log(`    ${s.raw.toLocaleString()} steps over ${s.syncs} syncs, ${s.flagged} flagged`);
  console.log(`    ${s.traced} of ${s.syncs} syncs had a GPS trace`);
  if (s.corrob + s.uncorrob > 0) {
    console.log(`    ground accounted for ${pct(s.corrob, s.corrob + s.uncorrob)} of traced steps`);
    console.log('      (a treadmill or an indoor job looks exactly like shaking here -');
    console.log('       the trace column above is what tells them apart)');
  }

  const events = await pool.query<{ action: string; flags: number; score: number; detail: unknown; created_at: Date }>(
    `SELECT action, flags, score, detail, created_at FROM integrity_events
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25`,
    [user.id],
  );
  console.log(`\n  Evidence (newest first, ${events.rowCount} of them)`);
  if (events.rowCount === 0) console.log('    nothing recorded');
  for (const e of events.rows) {
    console.log(`    ${e.created_at.toISOString().slice(0, 16).replace('T', ' ')}  ` +
      `${e.action.padEnd(8)} +${String(e.score).padStart(2)}  ${describeStepFlags(e.flags).join(', ')}`);
    if (e.detail) console.log(`        ${JSON.stringify(e.detail)}`);
  }

  console.log('\n  To vouch for this account:');
  console.log(`    npx tsx src/scripts/integrity-report.ts ${email} clear\n`);
}

const [email, action] = process.argv.slice(2);
(email ? account(email, action) : queue())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
