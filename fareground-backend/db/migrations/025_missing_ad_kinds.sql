-- 025: PIT_STOP and PHOTO were never added to the ad_reward_kind enum
--
-- Both were added to the TypeScript `AdRewardKind` union when the features
-- were built, and nobody added them to the database type. The result:
--
--   POST /rewards/start { kind: 'PHOTO' }     -> 500
--   POST /rewards/start { kind: 'PIT_STOP' }  -> 500
--
-- which means NOBODY HAS EVER BEEN ABLE TO SET A PROFILE PICTURE (the upload
-- requires an ad ticket that could not be issued) and nobody has been able
-- to pay an ad to skip the doorbell cooldown. Reported by testers as
-- "profile pictures aren't working"; the cause was one missing migration.
--
-- WHY THE TESTS DID NOT CATCH IT. The photo test asserted that an upload
-- WITHOUT an ad is refused - which passed, for the wrong reason: it got a
-- 400 for the missing nonce and never reached the enum. A test that only
-- ever walks the unhappy path proves nothing about the happy one. There is
-- now an e2e check that takes a PHOTO ticket and uploads with it.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, and the
-- migration runner wraps every file in one, so this uses the same enum-swap
-- pattern as 020_coin_spending.

ALTER TYPE ad_reward_kind RENAME TO ad_reward_kind_old;

CREATE TYPE ad_reward_kind AS ENUM (
    'BOOST',
    'WALK_POINTS',
    'DOUBLE',
    'INSTANT_COLLECT',
    'SCOUT',
    'COSMETIC',
    'UPGRADE',
    'EXTRA_CHECKIN',
    'STREAK_SAVE',
    'TREASURE',
    'PIT_STOP',
    'PHOTO'
);

ALTER TABLE ad_rewards
    ALTER COLUMN kind TYPE ad_reward_kind
    USING kind::text::ad_reward_kind;

DROP TYPE ad_reward_kind_old;
