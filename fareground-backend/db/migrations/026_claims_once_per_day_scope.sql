-- 026: "once per day" was being enforced on rewards that are not once per day
--
-- `reward_claims_once_per_day` is a unique index over
--     (user_id, source, COALESCE(quest_key, ''), local_day)
-- across EVERY source. That is right for the ones that really are capped at
-- one a day, and wrong for the ones that are not:
--
--   DAILY     one chest a day                      correct
--   ADSTREAK  one bonus chest a day                correct
--   QUEST     one per quest, and quest_key differs correct
--   CHECKIN   many a day, quest_key is the square  correct
--   TREASURE  UP TO TEN A DAY, quest_key is NULL   >>> BROKEN
--   PITSTOP   many a day, quest_key is NULL        >>> BROKEN
--
-- So the SECOND treasure box of any day failed on a duplicate key and the
-- app showed "Internal server error". Reported by a tester as "on second or
-- more boxes they can't open them".
--
-- PIT STOPS HAD THE SAME BUG and nobody had hit it yet: the five-minute
-- cooldown meant most people never opened two in a session, and paying an ad
-- to skip the wait - the path that reaches it fastest - was itself broken
-- until migration 025 added the PIT_STOP ad kind. Two bugs were hiding each
-- other.
--
-- The fix is to say what was actually meant: this constraint is about the
-- rewards that are once a day, so it should only cover those.

DROP INDEX IF EXISTS reward_claims_once_per_day;

CREATE UNIQUE INDEX reward_claims_once_per_day
    ON reward_claims (user_id, source, COALESCE(quest_key, ''::character varying), local_day)
    WHERE source IN ('DAILY', 'ADSTREAK', 'QUEST', 'CHECKIN');
