/**
 * THE MOD CONSOLE (2026-10-05) - moderation from your own terminal.
 *
 *   npm run mod                     interactive: type commands at "mod>"
 *   npm run mod -- info someone     run one command and exit
 *
 * It talks straight to the database in DATABASE_URL (fareground-backend/.env),
 * so it needs no admin API on the live server - nothing extra for an
 * attacker to find. Whoever has the database password can moderate; nobody
 * else can.
 *
 * Every change is written to mod_actions with who did it and why, and
 * anything that takes something away asks "are you sure?" first.
 * Type `help` for the commands.
 */
import os from 'node:os';
import readline from 'node:readline';
import { pool, withTransaction } from '../db/pool';
import { USERNAME_RE } from '../services/profile.service';
import { requestPasswordReset } from '../services/password.service';
import { removePhotoAsModerator } from '../services/photo.service';

const ACTOR = (process.env.MOD_NAME ?? os.userInfo().username ?? 'console').slice(0, 64);

type Row = Record<string, unknown>;
interface Player { id: string; username: string; email: string; banned_at: Date | null }

// ----------------------------------------------------------------- output
const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};
const say = (s = '') => console.log(s);
const ago = (d: Date | string | null | undefined) => {
  if (!d) return 'never';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};
const num = (n: unknown) => Number(n ?? 0).toLocaleString('en-GB');

/** A simple aligned table. */
function table(rows: Row[], cols: string[]): void {
  if (rows.length === 0) {
    say(C.dim('  (nothing)'));
    return;
  }
  const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : String(v ?? ''));
  const w = cols.map((c) => Math.min(40, Math.max(c.length, ...rows.map((r) => cell(r[c]).length))));
  say('  ' + cols.map((c, i) => C.bold(c.padEnd(w[i]))).join('  '));
  for (const r of rows) say('  ' + cols.map((c, i) => cell(r[c]).slice(0, 40).padEnd(w[i])).join('  '));
}

// ----------------------------------------------------------------- helpers
let rl: readline.Interface | null = null;

/**
 * Lines from the keyboard, queued. readline drops lines that arrive while
 * nobody is waiting for one (a paste of several commands, or piped input),
 * so every line goes into this queue and `ask` takes them in order.
 */
const pending: string[] = [];
const waiting: ((line: string | null) => void)[] = [];
let inputClosed = false;

function startInput(): void {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  rl.on('line', (line) => {
    const w = waiting.shift();
    if (w && !process.stdin.isTTY) process.stdout.write(line + '\n'); // piped input does not echo itself
    if (w) w(line);
    else pending.push(line);
  });
  rl.on('close', () => {
    inputClosed = true;
    while (waiting.length) waiting.shift()!(null);
  });
}

/** Show a prompt and take the next line, or null once the input is closed (Ctrl+D). */
function ask(prompt: string): Promise<string | null> {
  process.stdout.write(prompt);
  const next = pending.shift();
  if (next !== undefined) {
    if (!process.stdin.isTTY) process.stdout.write(next + '\n');
    return Promise.resolve(next);
  }
  if (inputClosed) return Promise.resolve(null);
  return new Promise((res) => waiting.push(res));
}

async function confirm(question: string): Promise<boolean> {
  if (!rl) {
    say(C.yellow('  Changes need a yes - run `npm run mod` and type the command there.'));
    return false;
  }
  const answer = await ask(`${C.yellow('?')} ${question} [y/N] `);
  return /^y(es)?$/i.test((answer ?? '').trim());
}

/** Find a player by username, email or id. */
async function player(ref: string | undefined): Promise<Player> {
  if (!ref) throw new Error('Say which player (username, email or id).');
  const r = await pool.query<Player>(
    `SELECT id, username, email, banned_at FROM users
      WHERE lower(username) = lower($1) OR lower(email) = lower($1) OR id::text = $1
      LIMIT 2`,
    [ref.replace(/^@/, '')],
  );
  if (r.rowCount === 0) throw new Error(`No player "${ref}". Try: find ${ref}`);
  return r.rows[0];
}

async function audit(p: { id: string; username: string } | null, action: string, detail: Row): Promise<void> {
  await pool.query(
    'INSERT INTO mod_actions (user_id, username, action, detail, actor) VALUES ($1, $2, $3, $4, $5)',
    [p?.id ?? null, p?.username ?? null, action, JSON.stringify(detail), ACTOR],
  );
}

/** Everything after the first `n` words, as the reason. */
const rest = (args: string[], n: number) => args.slice(n).join(' ').trim();

function needReason(reason: string): string {
  if (!reason) throw new Error('Give a reason at the end - it goes in the audit log.');
  return reason;
}

// ----------------------------------------------------------------- commands
type Cmd = { usage: string; help: string; run: (args: string[]) => Promise<void> };

const commands: Record<string, Cmd> = {
  find: {
    usage: 'find <text>',
    help: 'Search players by part of a username or email.',
    async run([text]) {
      if (!text) throw new Error('find what?');
      const r = await pool.query(
        `SELECT username, email, walk_points_balance AS wp, coin_balance AS coins,
                (SELECT COUNT(*) FROM parcels p WHERE p.owner_id = u.id)::int AS parcels,
                last_active_at AS last_seen, CASE WHEN banned_at IS NULL THEN '' ELSE 'BANNED' END AS status
           FROM users u
          WHERE username ILIKE $1 OR email ILIKE $1
          ORDER BY last_active_at DESC NULLS LAST LIMIT 25`,
        [`%${text}%`],
      );
      table(r.rows, ['username', 'email', 'wp', 'coins', 'parcels', 'last_seen', 'status']);
    },
  },

  info: {
    usage: 'info <player>',
    help: 'Everything about one player: balances, steps, devices, referrals, flags, notes.',
    async run([ref]) {
      const p = await player(ref);
      const r = await pool.query(
        `SELECT u.*,
                (SELECT COUNT(*) FROM parcels WHERE owner_id = u.id)::int AS parcels,
                (SELECT COALESCE(SUM(raw_steps), 0) FROM step_logs WHERE user_id = u.id)::bigint AS lifetime_steps,
                (SELECT COALESCE(SUM(raw_steps), 0) FROM step_logs WHERE user_id = u.id AND logged_at > NOW() - INTERVAL '7 days')::bigint AS steps_7d,
                (SELECT COUNT(*) FROM ad_rewards WHERE user_id = u.id AND status = 'GRANTED' AND granted_at > NOW() - INTERVAL '7 days')::int AS ads_7d,
                (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.id)::int AS invited,
                (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.id AND qualified_at IS NOT NULL)::int AS invited_qualified,
                (SELECT r2.username FROM referrals rf JOIN users r2 ON r2.id = rf.referrer_id WHERE rf.referee_id = u.id) AS invited_by,
                (SELECT COUNT(DISTINCT device_id) FROM devices WHERE user_id = u.id)::int AS devices,
                (SELECT COUNT(DISTINCT d2.user_id) - 1 FROM devices d1 JOIN devices d2 ON d2.device_id = d1.device_id
                  WHERE d1.user_id = u.id)::int AS other_accounts_on_devices
           FROM users u WHERE u.id = $1`,
        [p.id],
      );
      const u = r.rows[0];
      say();
      say(`  ${C.bold(u.username)}  <${u.email}>  ${u.banned_at ? C.red(`BANNED ${ago(u.banned_at)}: ${u.ban_reason ?? ''}`) : C.green('active')}`);
      say(C.dim(`  id ${u.id}`));
      say(`  joined ${ago(u.created_at)} · last seen ${ago(u.last_active_at)} · app build ${u.app_build ?? '?'} · ${u.google_sub ? 'Google sign-in' : 'email sign-in'}`);
      say(`  area ${[u.area_city, u.area_region, u.area_country].filter(Boolean).join(', ') || '?'} · time zone ${u.time_zone}`);
      say();
      say(`  WP ${C.bold(num(u.walk_points_balance))}  (+${num(u.locked_wp)} chained) · coins ${C.bold(num(u.coin_balance))} · parcels ${num(u.parcels)}`);
      say(`  steps: ${num(u.lifetime_steps)} lifetime, ${num(u.steps_7d)} this week · ads this week ${num(u.ads_7d)}`);
      say(`  devices ${u.devices}${u.other_accounts_on_devices > 0 ? C.yellow(` · ${u.other_accounts_on_devices} other account(s) use the same phone`) : ''}`);
      say(`  invited ${u.invited} (${u.invited_qualified} qualified)${u.invited_by ? ` · was invited by ${u.invited_by}` : ''}`);
      const flagged = u.integrity_tier && u.integrity_tier !== 'CLEAR';
      say(`  integrity score ${u.integrity_score ?? 0} · tier ${flagged ? C.yellow(u.integrity_tier) : u.integrity_tier ?? '-'} · step flags ${u.step_flag_count ?? 0}${u.integrity_exempt ? ' · exempt' : ''}`);
      const notes = await pool.query(
        `SELECT created_at, action, actor, detail->>'reason' AS reason FROM mod_actions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 8`,
        [p.id],
      );
      if (notes.rowCount) {
        say();
        say(C.bold('  Moderation history'));
        table(notes.rows, ['created_at', 'action', 'actor', 'reason']);
      }
      say();
    },
  },

  steps: {
    usage: 'steps <player> [days]',
    help: 'Steps per day, with how many were refused and flagged.',
    async run([ref, days]) {
      const p = await player(ref);
      const n = Math.min(60, Math.max(1, Number(days) || 14));
      const r = await pool.query(
        `SELECT (logged_at AT TIME ZONE u.time_zone)::date AS day, SUM(raw_steps)::int AS steps,
                SUM(rejected_steps)::int AS refused, SUM(wp_earned)::int AS wp,
                COUNT(*) FILTER (WHERE integrity_flags <> 0)::int AS flagged_syncs, COUNT(*)::int AS syncs
           FROM step_logs s JOIN users u ON u.id = s.user_id
          WHERE s.user_id = $1 AND logged_at > NOW() - ($2 || ' days')::interval
          GROUP BY 1 ORDER BY 1 DESC`,
        [p.id, n],
      );
      table(r.rows.map((x) => ({ ...x, day: String(x.day).slice(0, 15) })), ['day', 'steps', 'refused', 'wp', 'syncs', 'flagged_syncs']);
    },
  },

  ads: {
    usage: 'ads <player> [days]',
    help: 'Rewarded ads by kind.',
    async run([ref, days]) {
      const p = await player(ref);
      const n = Math.min(60, Math.max(1, Number(days) || 7));
      const r = await pool.query(
        `SELECT kind, COUNT(*) FILTER (WHERE status = 'GRANTED')::int AS granted, COUNT(*)::int AS started,
                MAX(granted_at) AS last
           FROM ad_rewards WHERE user_id = $1 AND created_at > NOW() - ($2 || ' days')::interval
          GROUP BY kind ORDER BY granted DESC`,
        [p.id, n],
      );
      table(r.rows, ['kind', 'granted', 'started', 'last']);
    },
  },

  sus: {
    usage: 'sus',
    help: 'Suspicious behaviour: referral farms, shared phones, anti-cheat flags, odd ad and step patterns.',
    async run() {
      say();
      say(C.bold('  Referral abuse') + C.dim(' - inviters whose invitees share their phone, or barely walk'));
      const refs = await pool.query(
        `SELECT u.username, COUNT(*)::int AS invited,
                COUNT(*) FILTER (WHERE rf.qualified_at IS NOT NULL)::int AS qualified,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM devices a JOIN devices b ON a.device_id = b.device_id
                   WHERE a.user_id = rf.referrer_id AND b.user_id = rf.referee_id))::int AS same_phone,
                COUNT(*) FILTER (WHERE r.last_active_at < NOW() - INTERVAL '3 days'
                                    OR r.last_active_at IS NULL)::int AS gone_quiet,
                COALESCE(SUM(rf.referrer_reward), 0)::int AS wp_earned
           FROM referrals rf JOIN users u ON u.id = rf.referrer_id JOIN users r ON r.id = rf.referee_id
          GROUP BY u.username
         HAVING COUNT(*) >= 2 AND (
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM devices a JOIN devices b ON a.device_id = b.device_id
                   WHERE a.user_id = rf.referrer_id AND b.user_id = rf.referee_id)) > 0
             OR COUNT(*) FILTER (WHERE r.last_active_at < NOW() - INTERVAL '3 days' OR r.last_active_at IS NULL) * 2 >= COUNT(*))
          ORDER BY same_phone DESC, invited DESC LIMIT 20`,
      );
      table(refs.rows, ['username', 'invited', 'qualified', 'same_phone', 'gone_quiet', 'wp_earned']);

      say();
      say(C.bold('  Shared phones') + C.dim(' - one phone, three or more accounts in 30 days'));
      const phones = await pool.query(
        `SELECT left(device_id, 12) || '…' AS phone, COUNT(DISTINCT d.user_id)::int AS accounts,
                string_agg(DISTINCT u.username, ', ') AS usernames
           FROM devices d JOIN users u ON u.id = d.user_id
          WHERE d.last_seen_at > NOW() - INTERVAL '30 days'
          GROUP BY d.device_id HAVING COUNT(DISTINCT d.user_id) >= 3
          ORDER BY accounts DESC LIMIT 20`,
      );
      table(phones.rows, ['phone', 'accounts', 'usernames']);

      say();
      say(C.bold('  Anti-cheat') + C.dim(' - integrity tier raised, or many flagged step syncs'));
      const cheats = await pool.query(
        `SELECT username, integrity_score AS score, integrity_tier AS tier, step_flag_count AS step_flags,
                last_active_at AS last_seen
           FROM users
          WHERE banned_at IS NULL AND NOT COALESCE(integrity_exempt, FALSE)
            AND (integrity_tier::text <> 'CLEAR' OR step_flag_count >= 5)
          ORDER BY integrity_score DESC NULLS LAST, step_flag_count DESC LIMIT 20`,
      );
      table(cheats.rows, ['username', 'score', 'tier', 'step_flags', 'last_seen']);

      say();
      say(C.bold('  Heavy ad use') + C.dim(' - 60+ rewarded ads in the last 24 hours'));
      const ads = await pool.query(
        `SELECT u.username, COUNT(*)::int AS ads_24h
           FROM ad_rewards a JOIN users u ON u.id = a.user_id
          WHERE a.status = 'GRANTED' AND a.granted_at > NOW() - INTERVAL '24 hours' AND u.banned_at IS NULL
          GROUP BY u.username HAVING COUNT(*) >= 60 ORDER BY ads_24h DESC LIMIT 20`,
      );
      table(ads.rows, ['username', 'ads_24h']);

      say();
      say(C.bold('  Step cap every day') + C.dim(' - at the daily cap on 6 of the last 7 days'));
      const capped = await pool.query(
        `SELECT u.username, COUNT(*)::int AS capped_days
           FROM step_day_totals t JOIN users u ON u.id = t.user_id
          WHERE t.day > CURRENT_DATE - 7 AND t.reported >= 15000 AND u.banned_at IS NULL
          GROUP BY u.username HAVING COUNT(*) >= 6 ORDER BY capped_days DESC LIMIT 20`,
      );
      table(capped.rows, ['username', 'capped_days']);
      say();
      say(C.dim('  None of these prove cheating - look with `info`, `steps` and `ads` before acting.'));
      say();
    },
  },

  ban: {
    usage: 'ban <player> <reason>',
    help: 'Suspend an account: they cannot sign in or play, and drop off the leaderboards.',
    async run(args) {
      const p = await player(args[0]);
      const reason = needReason(rest(args, 1));
      if (p.banned_at) throw new Error(`${p.username} is already banned.`);
      if (!(await confirm(`Ban ${p.username} <${p.email}> for "${reason}"?`))) return say('  Cancelled.');
      await pool.query('UPDATE users SET banned_at = NOW(), ban_reason = $2 WHERE id = $1', [p.id, reason]);
      await audit(p, 'BAN', { reason });
      say(C.red(`  ${p.username} is banned.`) + C.dim(' Takes effect within a minute.'));
    },
  },

  unban: {
    usage: 'unban <player> <reason>',
    help: 'Lift a ban.',
    async run(args) {
      const p = await player(args[0]);
      const reason = needReason(rest(args, 1));
      if (!p.banned_at) throw new Error(`${p.username} is not banned.`);
      await pool.query('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = $1', [p.id]);
      await audit(p, 'UNBAN', { reason });
      say(C.green(`  ${p.username} is unbanned.`));
    },
  },

  warn: {
    usage: 'warn <player> <note>',
    help: 'Record a warning or note against a player (does not change anything else).',
    async run(args) {
      const p = await player(args[0]);
      const reason = needReason(rest(args, 1));
      await audit(p, 'WARN', { reason });
      say(`  Noted against ${p.username}.`);
    },
  },

  give: {
    usage: 'give <player> <wp|coins> <amount> <reason>',
    help: 'Add Walk Points or coins (e.g. to make up for a bug).',
    async run(args) {
      await adjust(args, +1);
    },
  },

  take: {
    usage: 'take <player> <wp|coins> <amount> <reason>',
    help: 'Remove Walk Points or coins (e.g. from an exploit). Never goes below zero.',
    async run(args) {
      await adjust(args, -1);
    },
  },

  resetpw: {
    usage: 'resetpw <player>',
    help: 'Email the player a password-reset code (you never see or set their password).',
    async run([ref]) {
      const p = await player(ref);
      await requestPasswordReset(p.email);
      await audit(p, 'RESET_PASSWORD', { to: p.email });
      say(`  Reset code sent to ${p.email}.`);
    },
  },

  rename: {
    usage: 'rename <player> <new_name> <reason>',
    help: 'Change a username (3-32 letters, numbers or _).',
    async run(args) {
      const p = await player(args[0]);
      const name = args[1] ?? '';
      const reason = needReason(rest(args, 2));
      if (!USERNAME_RE.test(name)) throw new Error('Usernames are 3-32 letters, numbers or underscores.');
      const taken = await pool.query('SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2', [name, p.id]);
      if (taken.rowCount) throw new Error(`"${name}" is taken.`);
      if (!(await confirm(`Rename ${p.username} to ${name}?`))) return say('  Cancelled.');
      await pool.query('UPDATE users SET username = $2 WHERE id = $1', [p.id, name]);
      await audit(p, 'RENAME', { from: p.username, to: name, reason });
      say(`  ${p.username} is now ${C.bold(name)}.`);
    },
  },

  photo: {
    usage: 'photo <player> <reason>',
    help: 'Remove a profile photo.',
    async run(args) {
      const p = await player(args[0]);
      const reason = needReason(rest(args, 1));
      const removed = await removePhotoAsModerator(p.id, reason);
      if (!removed) throw new Error(`${p.username} has no photo.`);
      await audit(p, 'REMOVE_PHOTO', { reason });
      say(`  Photo removed from ${p.username}.`);
    },
  },

  parcels: {
    usage: 'parcels <player>',
    help: "List a player's parcels (ids for `free`).",
    async run([ref]) {
      const p = await player(ref);
      const r = await pool.query(
        `SELECT id, rarity, upgrade_level AS lvl, purchased_at AS claimed,
                round(claimed_lat::numeric, 5) AS lat, round(claimed_lng::numeric, 5) AS lng
           FROM parcels WHERE owner_id = $1 ORDER BY purchased_at DESC LIMIT 100`,
        [p.id],
      );
      table(r.rows, ['id', 'rarity', 'lvl', 'claimed', 'lat', 'lng']);
    },
  },

  free: {
    usage: 'free <parcel_id|player all> <reason>',
    help: 'Release a parcel (or all of a player\'s parcels) so anyone can claim it.',
    async run(args) {
      if (args[1] === 'all') {
        const p = await player(args[0]);
        const reason = needReason(rest(args, 2));
        const n = await pool.query('SELECT COUNT(*)::int AS n FROM parcels WHERE owner_id = $1', [p.id]);
        if (!n.rows[0].n) throw new Error(`${p.username} has no parcels.`);
        if (!(await confirm(`Free ALL ${n.rows[0].n} parcels of ${p.username}? This cannot be undone.`))) return say('  Cancelled.');
        await pool.query('DELETE FROM parcels WHERE owner_id = $1', [p.id]);
        await audit(p, 'FREE_PARCELS', { count: n.rows[0].n, reason });
        say(`  Freed ${n.rows[0].n} parcels.`);
        return;
      }
      const id = args[0];
      const reason = needReason(rest(args, 1));
      const r = await pool.query<{ owner_id: string; rarity: string; username: string }>(
        `SELECT p.owner_id, p.rarity, u.username FROM parcels p JOIN users u ON u.id = p.owner_id WHERE p.id::text = $1`,
        [id ?? ''],
      );
      if (!r.rowCount) throw new Error(`No parcel ${id}. Use \`parcels <player>\` for ids.`);
      const { owner_id, rarity, username } = r.rows[0];
      if (!(await confirm(`Free ${username}'s ${rarity} parcel? This cannot be undone.`))) return say('  Cancelled.');
      await pool.query('DELETE FROM parcels WHERE id::text = $1', [id]);
      await audit({ id: owner_id, username }, 'FREE_PARCEL', { parcel: id, rarity, reason });
      say('  Parcel freed.');
    },
  },

  log: {
    usage: 'log [player]',
    help: 'The audit log: every mod action, newest first.',
    async run([ref]) {
      const p = ref ? await player(ref) : null;
      const r = await pool.query(
        `SELECT created_at, actor, action, username AS player, COALESCE(detail->>'reason', detail::text) AS detail
           FROM mod_actions ${p ? 'WHERE user_id = $1' : ''} ORDER BY created_at DESC LIMIT 40`,
        p ? [p.id] : [],
      );
      table(r.rows, ['created_at', 'actor', 'action', 'player', 'detail']);
    },
  },

  help: {
    usage: 'help',
    help: 'This list.',
    async run() {
      say();
      for (const c of Object.values(commands)) say(`  ${C.cyan(c.usage.padEnd(44))} ${c.help}`);
      say(`  ${C.cyan('exit'.padEnd(44))} Leave.`);
      say();
      say(C.dim('  <player> is a username, an email or an id. Reasons go in the audit log.'));
      say();
    },
  },
};

async function adjust(args: string[], sign: 1 | -1): Promise<void> {
  const p = await player(args[0]);
  const what = (args[1] ?? '').toLowerCase();
  const amount = Math.floor(Number(args[2]));
  const reason = needReason(rest(args, 3));
  if (what !== 'wp' && what !== 'coins') throw new Error('Say wp or coins.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('The amount must be a whole number above 0.');
  if (amount > 1_000_000) throw new Error('That is a lot - more than 1,000,000 at once is refused.');
  const verb = sign > 0 ? 'Give' : 'Take';
  if (!(await confirm(`${verb} ${num(amount)} ${what === 'wp' ? 'WP' : 'coins'} ${sign > 0 ? 'to' : 'from'} ${p.username}?`))) return say('  Cancelled.');

  const after = await withTransaction(async (client) => {
    if (what === 'wp') {
      const r = await client.query<{ before: number; after: number }>(
        `UPDATE users u SET walk_points_balance = GREATEST(0, u.walk_points_balance + $2)
           FROM (SELECT walk_points_balance AS before FROM users WHERE id = $1 FOR UPDATE) b
          WHERE u.id = $1 RETURNING b.before, u.walk_points_balance AS after`,
        [p.id, sign * amount],
      );
      return r.rows[0];
    }
    // Coins go through the ledger, like every other coin movement.
    const cur = await client.query<{ coin_balance: string }>('SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE', [p.id]);
    const before = Number(cur.rows[0].coin_balance);
    const delta = sign > 0 ? amount : -Math.min(amount, before);
    if (delta === 0) throw new Error(`${p.username} has no coins to take.`);
    await client.query('UPDATE users SET coin_balance = coin_balance + $2 WHERE id = $1', [p.id, delta]);
    await client.query(
      `INSERT INTO coin_ledger (user_id, entry_type, amount, balance_after, note) VALUES ($1, 'ADJUSTMENT', $2, $3, $4)`,
      [p.id, delta, before + delta, `mod ${ACTOR}: ${reason}`.slice(0, 500)],
    );
    return { before, after: before + delta };
  });
  await audit(p, sign > 0 ? `GIVE_${what.toUpperCase()}` : `TAKE_${what.toUpperCase()}`, { amount, before: after.before, after: after.after, reason });
  say(`  ${p.username}: ${num(after.before)} → ${C.bold(num(after.after))} ${what === 'wp' ? 'WP' : 'coins'}`);
}

/** Split a line into words, keeping "quoted phrases" together. */
function words(line: string): string[] {
  return (line.match(/"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^"|"$/g, ''));
}

async function runLine(line: string): Promise<void> {
  const [name, ...args] = words(line.trim());
  if (!name) return;
  const cmd = commands[name.toLowerCase()];
  if (!cmd) {
    say(C.red(`  Unknown command "${name}".`) + ' Type `help`.');
    return;
  }
  try {
    await cmd.run(args);
  } catch (e) {
    say(C.red(`  ${e instanceof Error ? e.message : String(e)}`));
    say(C.dim(`  usage: ${cmd.usage}`));
  }
}

async function main(): Promise<void> {
  const oneShot = process.argv.slice(2).join(' ').trim();
  if (oneShot) {
    // Changes need a "yes", which one-shot mode cannot give (confirm says
    // so) - so it is for the read-only commands: info, find, steps, sus...
    await runLine(oneShot);
    await pool.end();
    return;
  }
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').host;
    } catch {
      return '?';
    }
  })();
  say();
  say(`  ${C.bold('Fareground mod console')}  ${C.dim(`as ${ACTOR} · database ${host}`)}`);
  say(C.dim('  Type `help` for commands, `exit` to leave.'));
  say();
  startInput();
  for (;;) {
    const line = await ask(C.cyan('mod> '));
    if (line === null || /^(exit|quit)$/i.test(line.trim())) break;
    await runLine(line);
  }
  rl?.close();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
