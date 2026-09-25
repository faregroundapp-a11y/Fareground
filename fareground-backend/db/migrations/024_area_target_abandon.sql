-- 024: a destination you can no longer reach must not trap you
--
-- Two bugs, found by playing rather than by testing, and both the same
-- underlying mistake: a target was assumed to stay valid forever.
--
--   1. A PLAYER WHO TRAVELS IS STRANDED. The target is rolled near wherever
--      they were and never moves. Open the app in another city - a train, a
--      holiday, moving house - and today's area is hundreds of kilometres
--      away, check-in refuses with "keep walking", and the only escape is a
--      rewarded ad. The one thing a player cannot do is give up on it.
--
--   2. YESTERDAY'S UNCLAIMED TARGET IS STILL TODAY'S. Miss a day and the
--      stale one stays open, so the free daily roll never fires again. Miss
--      a day WHILE travelling and the two compound into an account that can
--      never check in again without paying.
--
-- The fix is one rule: a target that is no longer a reasonable destination is
-- ABANDONED and re-rolled for free. Abandoning is recorded rather than
-- deleted, so "how often does this happen" stays answerable - if it turns out
-- to fire constantly, the roll radius is wrong and the data will say so.

ALTER TABLE area_targets ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ;

-- Why: 'STALE_DAY' or 'TOO_FAR'. Kept so the two causes stay separable.
ALTER TABLE area_targets ADD COLUMN IF NOT EXISTS abandoned_reason VARCHAR(16);

-- The one-open-target rule now has to ignore abandoned rows as well as
-- claimed ones. Rebuilt rather than added to: a partial unique index cannot
-- be altered in place.
DROP INDEX IF EXISTS uniq_area_target_open;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_area_target_open
    ON area_targets (user_id)
    WHERE claimed_at IS NULL AND abandoned_at IS NULL;
