-- ===========================================================================
--  030 - Restore coins: re-pay every account's land history at today's rates.
--
--  Migration 029 converted balances at the SAME DOLLAR VALUE (2,000 old coins
--  = 1 new). That was exact, and it left most testers looking at 0 or a
--  handful of coins, because under the old rates their land had earned
--  fractions of a cent. The product owner's call (2026-09-26): recalculate.
--
--  For every account, work out what its land WOULD have earned since each
--  parcel was claimed, at the new monthly rates (coins_per_month + upgrades),
--  plus the extra every boost window paid on the land owned at the time
--  (ad and prize boosts, at the multiplier they were bought at). Subtract
--  anything already spent in the store. If that comes to more than the
--  balance, top the balance up to it. Nobody ever goes down.
--
--  Two details that matter:
--
--   * THE INCOME CLOCK MOVES TO NOW for every account topped up. The re-pay
--     covers every second up to this migration; leaving the clock where it
--     was would pay the same hours twice on the next balance check. GREATEST,
--     so an instant collect that pushed the clock into the future keeps it.
--
--   * UPGRADES count at their CURRENT level for the whole life of the parcel,
--     because when each level was bought was never recorded. That errs in the
--     player's favour by a few coins, which is the right direction for a
--     goodwill restore.
--
--  One ADJUSTMENT ledger row per account topped up, so SUM(ledger) = balance.
-- ===========================================================================

BEGIN;

CREATE TEMP TABLE restore ON COMMIT DROP AS
WITH land AS (
    -- coin-seconds: coins-per-month x seconds owned. / 2,592,000 = coins.
    SELECT p.owner_id AS user_id,
           SUM((p.coins_per_month + p.upgrade_level)::numeric
               * GREATEST(EXTRACT(EPOCH FROM (NOW() - p.purchased_at)), 0)) AS coin_seconds
      FROM parcels p
     GROUP BY p.owner_id
),
boosted AS (
    -- The EXTRA a boost paid: (multiplier - 1) on each parcel owned during
    -- the window, for the part of the window that has already happened.
    SELECT b.user_id,
           SUM((p.coins_per_month + p.upgrade_level)::numeric * (b.multiplier - 1)
               * GREATEST(EXTRACT(EPOCH FROM (LEAST(b.ends_at, NOW()) - GREATEST(b.starts_at, p.purchased_at))), 0)
           ) AS coin_seconds
      FROM boosts b
      JOIN parcels p ON p.owner_id = b.user_id
     WHERE b.starts_at < NOW()
     GROUP BY b.user_id
),
spent AS (
    SELECT user_id, -SUM(amount) AS coins
      FROM coin_ledger
     WHERE entry_type = 'SPEND'
     GROUP BY user_id
)
SELECT u.id,
       u.coin_balance AS old_balance,
       (FLOOR((COALESCE(l.coin_seconds, 0) + COALESCE(bo.coin_seconds, 0)) / 2592000)
        - COALESCE(s.coins, 0))::bigint AS should_have
  FROM users u
  LEFT JOIN land l     ON l.user_id = u.id
  LEFT JOIN boosted bo ON bo.user_id = u.id
  LEFT JOIN spent s    ON s.user_id = u.id;

DELETE FROM restore WHERE should_have <= old_balance;

UPDATE users u
   SET coin_balance         = r.should_have,
       coin_remainder_micro = 0,
       last_coin_claim_at   = GREATEST(u.last_coin_claim_at, NOW())
  FROM restore r
 WHERE u.id = r.id;

INSERT INTO coin_ledger (user_id, entry_type, amount, balance_after, note)
SELECT r.id, 'ADJUSTMENT', r.should_have - r.old_balance, r.should_have,
       'Restored: land history re-paid at the new monthly rates, boosts included (migration 030).'
  FROM restore r;

COMMIT;
