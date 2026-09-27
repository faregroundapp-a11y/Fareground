-- ===========================================================================
--  033 - Two new ad kinds: CLAIM (the price of a parcel) and TREASURE_KEY
--  (the key to a treasure box). Added to the enum in the SAME change as the
--  code this time - 025 exists because PHOTO and PIT_STOP were not.
--
--  ADD VALUE IF NOT EXISTS is safe to re-run and needs no table rewrite.
-- ===========================================================================

ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'CLAIM';
ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'TREASURE_KEY';
