-- ===========================================================================
--  002 - Anti-cheat groundwork for iOS + Android.
--
--  Adds three things:
--    1. Idempotency keys on step_logs, so a retried sync cannot pay twice.
--    2. A record of WHICH device sent each sync, and how many steps we refused.
--    3. Tables for device attestation (Apple App Attest / Play Integrity).
--
--  Re-runnable, like 001.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Which phone platform a request came from.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_platform') THEN
        CREATE TYPE device_platform AS ENUM ('IOS', 'ANDROID');
    END IF;
END
$$;


-- ---------------------------------------------------------------------------
-- DEVICES - one row per phone an account syncs from.
--
-- `attest_key_id` and `attest_public_key` are what Apple's App Attest needs:
-- the phone generates a hardware-backed key pair, we store the public half the
-- first time it attests, and every later sync is signed with the private half
-- (which never leaves the Secure Enclave).
--
-- `attest_counter` must only ever go UP. Apple increments it on every
-- assertion, so a replayed assertion shows a counter we have already seen and
-- gets rejected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform          device_platform NOT NULL,

    -- Client-generated stable id for the install (App Attest keyId on iOS).
    device_id         VARCHAR(255)    NOT NULL,

    attest_key_id     VARCHAR(255),
    attest_public_key BYTEA,
    attest_counter    BIGINT          NOT NULL DEFAULT 0 CHECK (attest_counter >= 0),
    attested_at       TIMESTAMPTZ,

    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    last_seen_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- One row per (account, device). Lets us upsert on every sync.
    CONSTRAINT devices_user_device_unique UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices (user_id);


-- ---------------------------------------------------------------------------
-- ATTESTATION_CHALLENGES - single-use nonces.
--
-- Both Apple and Google need the SERVER to pick a random challenge that the
-- phone folds into its attestation. Without that, an attacker could capture
-- one valid attestation and replay it forever.
--
-- The flow is: client asks for a challenge -> client attests with it ->
-- server verifies and marks the challenge consumed. A nonce works exactly once.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attestation_challenges (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nonce       VARCHAR(64) NOT NULL UNIQUE,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_attestation_challenges_user
    ON attestation_challenges (user_id, expires_at DESC);


-- ---------------------------------------------------------------------------
-- STEP_LOGS additions.
-- ---------------------------------------------------------------------------

-- The client's unique id for this sync. If the phone retries because the
-- network dropped, we recognise the key and replay the original answer
-- instead of paying out a second time.
ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

-- How many steps we refused as physically implausible. We store rather than
-- reject them outright so that an honest phone that was offline all day still
-- gets credited what it plausibly walked, while we keep the evidence.
ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS rejected_steps INTEGER NOT NULL DEFAULT 0;

ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS platform device_platform;
ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);

-- Whether this sync carried a verified attestation.
ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS attested BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'step_logs_rejected_steps_check'
    ) THEN
        ALTER TABLE step_logs
            ADD CONSTRAINT step_logs_rejected_steps_check CHECK (rejected_steps >= 0);
    END IF;
END
$$;

-- 001 required raw_steps > 0. A sync can now be legitimately truncated to
-- zero accepted steps (every step was implausible), so relax it to >= 0.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'step_logs_raw_steps_check') THEN
        ALTER TABLE step_logs DROP CONSTRAINT step_logs_raw_steps_check;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'step_logs_raw_steps_nonneg') THEN
        ALTER TABLE step_logs ADD CONSTRAINT step_logs_raw_steps_nonneg CHECK (raw_steps >= 0);
    END IF;
END
$$;

-- THE important one: the same key can never be used twice by the same user.
-- A partial index (WHERE ... IS NOT NULL) so that rows without a key - every
-- row written before this migration - do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_step_logs_idempotency
    ON step_logs (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMIT;
