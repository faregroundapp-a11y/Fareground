-- 035 - The post-claim bonus ad gets its own kind (2026-09-28), so it no
-- longer counts against the day's bonus-WP ads. One per parcel, checked in
-- rewards.service.ts through ad_rewards.target_parcel_id.
ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'CLAIM_BONUS';
