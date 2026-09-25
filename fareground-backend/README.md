# Fareground Backend - Step 1

Node.js + TypeScript + Express + PostgreSQL (raw SQL via `pg`).

Implements: registration/login with JWT, step syncing with anti-cheat, parcel
purchases with a weighted mineral roll, lazily-evaluated passive coin income,
and an auditable coin ledger.

---

## The economy

| Rule | Value |
| --- | --- |
| Steps per Walk Point | 1,000 steps = 1 WP |
| Parcel price | 100 WP |

A claimed parcel turns out to be one of five minerals:

| Mineral | Drop chance | Coins/hour | USD/second | USD/year |
| --- | --- | --- | --- | --- |
| ROCKY | 60% | 1 | $0.00000000056 | $0.018 |
| COAL | 25% | 2 | $0.00000000111 | $0.035 |
| AMETHYST | 10% | 5 | $0.00000000278 | $0.088 |
| SAPPHIRE | 4% | 12 | $0.00000000667 | $0.210 |
| RUBY | 1% | 40 | $0.00000002222 | $0.701 |

**One coin = $0.000002. Half a million coins = $1.00.** All of the above lives
in exactly one file: `src/game/rules.ts`.

Two consequences worth knowing before tuning any of it:

- **The average parcel is worth 2.48 coins/hour**, and the floor is about 1.6
  whatever you choose, because coins are whole numbers and the commonest tier
  cannot pay less than 1. The spread between tiers is therefore a lever on
  *excitement*, not on how fast coins accumulate.
- **At 1%, most players never see a RUBY.** A parcel costs 100,000 steps, so a
  brisk 10,000 steps a day is one parcel every ten days — about 36 a year, and
  a 30% chance of a RUBY in a whole year of that. If RUBY is meant to be the
  thing people chase, the lever is the parcel price, not the drop rate:
  halving it to 50 WP doubles the rolls and takes RUBY to 51%.

---

## Setup walkthrough

> **Already done on this machine.** Node.js 24.19.0 LTS and PostgreSQL 17.11
> are installed, the `walkscape` database exists, the schema is applied, `.env`
> is written with a freshly generated JWT secret, and all tests pass. To just
> run it, skip to [Step 5](#step-5---run-it). The steps below are what was done,
> kept so you can reproduce it on another machine.
>
> The local Postgres superuser password is `postgres` (the winget default).
> Fine for a dev box; change it if this machine is shared.

### Step 0 - Install the tools (one time)

1. **Node.js 20 LTS or newer** - https://nodejs.org (take the "LTS" installer).
2. **PostgreSQL 13 or newer** - https://www.postgresql.org/download/windows/
   During install, remember the password you set for the `postgres` user.

On Windows, winget does both without any clicking:

```bash
winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements
```

```bash
winget install --id PostgreSQL.PostgreSQL.17 --silent --accept-package-agreements
```

Close and reopen your terminal afterwards, then confirm:

```bash
node -v
```

### Step 1 - Create the database

Using the "SQL Shell (psql)" app that ships with PostgreSQL, or pgAdmin:

```sql
CREATE DATABASE walkscape;
```

### Step 2 - Install dependencies

From this folder (`fareground-backend`):

```bash
npm install
```

<details>
<summary>What that installs, and why (the long-hand version)</summary>

If you were starting from an empty folder, these are the commands that would
produce the `package.json` in this project:

```bash
npm init -y
npm install express pg bcryptjs jsonwebtoken dotenv zod cors helmet
npm install --save-dev typescript tsx @types/node @types/express @types/pg @types/bcryptjs @types/jsonwebtoken @types/cors
npx tsc --init
```

| Package | What it does |
| --- | --- |
| `express` | The HTTP web framework. |
| `pg` | PostgreSQL driver - lets us send SQL from Node. |
| `bcryptjs` | Hashes passwords. Pure JavaScript, so it needs no C++ build tools - a common source of install pain on Windows. To use the native `bcrypt` instead, swap the package and the one import line in `src/services/auth.service.ts`; the API is identical. |
| `jsonwebtoken` | Creates and verifies JWT login tokens. |
| `dotenv` | Reads config out of a `.env` file. |
| `zod` | Validates request bodies and gives us types for free. |
| `cors` | Lets the mobile app / browser call this API. |
| `helmet` | Sets sensible security headers. |
| `typescript` | The compiler. |
| `tsx` | Runs TypeScript directly, with auto-restart on save. |
| `@types/*` | Type definitions for the libraries that do not ship their own. |

</details>

### Step 3 - Configure your environment

```bash
cp .env.example .env
```

On Windows PowerShell:

```bash
Copy-Item .env.example .env
```

Now open `.env` and set two things:

- `DATABASE_URL` - your real Postgres password, for example
  `postgresql://postgres:mypassword@localhost:5432/walkscape`
- `JWT_SECRET` - generate a strong one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Step 4 - Create the tables

```bash
npm run db:migrate
```

This applies every file in `db/migrations` in order, recording what it has
already run in a `schema_migrations` table. Safe to run any number of times.
Add schema changes as new numbered files (`003_...sql`); never edit an applied
one.

### Step 5 - Run it

```bash
npm run dev
```

You should see `[api] Fareground backend listening on http://localhost:3000`.
Check it with:

```bash
curl http://localhost:3000/health
```

### Step 6 - Run the tests

Unit tests for the economy rules (pure functions, no database needed). These
use Node's built-in test runner - no Jest, no config:

```bash
npm test
```

End-to-end API tests. **The server must already be running** (`npm run dev` in
another terminal), because these hit the real HTTP API and the real database:

```bash
npm run test:api
```

Current status: **35 unit tests and 112 API checks, all passing.** Between them
they cover every endpoint, the auth guard, input validation, both "remainder"
behaviours, passive income accrual, the plausibility limits, idempotent
retries, single-use attestation nonces, and - via 5 simultaneous requests -
that both the double-spend guard and the idempotency guard hold under real
concurrency.

The API tests reach into PostgreSQL to rewind a player's clock and to grant
Walk Points without walking 100,000 steps. That is test setup, not the thing
under test - it is the only practical way to check ten hours of passive income
without waiting ten hours.

### Other commands

Type-check without emitting files:

```bash
npm run typecheck
```

Compile to `dist/`:

```bash
npm run build
```

Run the compiled build (what you do in production):

```bash
npm start
```

---

## API reference

Every protected route needs the header `Authorization: Bearer <token>`.

### POST /auth/register

```json
{ "username": "ada", "email": "ada@example.com", "password": "walk1000steps" }
```

Returns `201` with `{ user, token }`. Returns `409` if the username or email is taken.

### POST /auth/login

```json
{ "email": "ada@example.com", "password": "walk1000steps" }
```

Returns `200` with `{ user, token }`, or `401` for bad credentials.

### POST /steps/sync  (auth required)

Header (recommended): `Idempotency-Key: <a uuid the client generates>`

Request:

```json
{ "steps": 3500, "platform": "IOS", "deviceId": "..." }
```

Response:

```json
{
  "stepsSubmitted": 3500,
  "stepsAccepted": 3500,
  "stepsRejected": 0,
  "limit": "OK",
  "wpEarned": 3,
  "walkPointsBalance": 3,
  "lifetimeSteps": 3500,
  "stepsUntilNextWalkPoint": 500,
  "replayed": false
}
```

`limit` is `OK`, `RATE_LIMIT` or `DAILY_LIMIT`. When it is not `OK` some steps
were refused as implausible and `stepsRejected` says how many — the client can
show that, and re-offer them later when the window has moved on.

Send the **same** `Idempotency-Key` when retrying a sync that timed out: the
server recognises it, replies `"replayed": true`, and does not pay out twice.
Use a fresh key for a genuinely new batch of steps.

### POST /attest/challenge  (auth required)

Returns a single-use nonce for device attestation. See the anti-cheat section
below.

```json
{ "nonce": "a3f1...64 hex chars", "expiresAt": "2026-09-20T12:05:00.000Z" }
```

### POST /parcels/claim  (auth required)

Claims the square of the world grid you are standing on.

```json
{ "lat": 51.5129, "lng": -0.1471, "accuracyM": 6 }
```

Returns `201`:

```json
{
  "parcel": {
    "id": "0f1c8e2a-...",
    "rarity": "AMETHYST",
    "coinsPerHour": 5,
    "cellX": -1170,
    "cellY": 479466,
    "cellRef": "-1170:479466",
    "purchasedAt": "2026-09-21T12:00:00.000Z"
  },
  "walkPointsSpent": 100,
  "walkPointsBalance": 12
}
```

| Status | When |
| --- | --- |
| `400` | Fewer than 100 WP, or a position off the map (beyond ±85° latitude) |
| `409` | Someone — possibly you — already owns this square |
| `422` | The GPS fix is worse than 25 m, so we cannot tell which square you are on |

The server works out the square from the coordinates; the client never names
the cell it wants. **Each square has one owner, ever**, enforced by a unique
index. When several players claim the same square at the same instant, exactly
one wins, and the others' transactions roll back, Walk Points included.

### GET /parcels/nearby?lat=&lng=&radius=  (auth required)

Every claimed square within `radius` metres (default 300, max 500), for the map:

```json
{ "parcels": [ { "cellX": -1170, "cellY": 479466, "rarity": "COAL", "mine": false } ] }
```

Other players' identities are never included — only that a square is taken and
what it holds. A map of where named people walk every day is a stalking tool.

### GET /parcels  (auth required)

Everything you own, newest first. Parcels from before the world grid existed
have `cellX: null` and do not appear on the map.

### The world grid

`src/game/grid.ts` divides the planet into squares that are 14 m on a side in
Web Mercator, the projection every map SDK draws in. So every cell renders as
an exact square on the player's screen, and a cell is just two integers. The
cost is that real size varies with latitude: 14 m at the equator, 10.7 m in
New York, 8.7 m in London. The mobile app carries a byte-identical copy so it
can draw the grid itself, and the test suite fails if the two copies drift.

### GET /user/balance  (auth required)

```json
{
  "walkPoints": 12,
  "coins": 145,
  "totalParcels": 3,
  "coinsPerHour": 7,
  "coinsJustEarned": 14,
  "lastCoinClaimAt": "2026-09-20T14:00:00.000Z",
  "redeemableUsd": "0.000290",
  "usdPerSecond": 3.888888888888889e-9,
  "minRedemptionCoins": 500000,
  "canRedeem": false
}
```

`coins` is the authoritative integer. `redeemableUsd` is a **string**, for
display only — see "Money is never a float" below.

---

## Coins are money, so coins have a ledger

Coins are intended to be redeemable for real currency. That single fact changes
what the coin balance *is*: not a score, but a financial record.

`users.coin_balance` still exists, but it is now only a **cached projection**.
The truth lives in `coin_ledger`, one immutable row per movement, because a
plain balance cannot answer the only question that matters in a dispute:
*why does this account have 4,812 coins?*

Every accrual records the exact window it paid for, the rate it paid at, and
the balance immediately after. The invariant is checked by the test suite on
every run, across every account:

```sql
SELECT SUM(amount) FROM coin_ledger WHERE user_id = $1;  -- = users.coin_balance
```

Retrofitting this after a payout dispute, an audit, or a tax question is
miserable, because the history you need was never written down.

### The rate, and why it is this small

`COIN_REDEMPTION_USD` is **$0.000002** — calibrated directly against Atlas
Earth, whose published rates annualise to $0.035/year for a Common parcel and
$0.139/year for a *Legendary*. Fourteen cents a year for their top tier.

That is not stinginess, it is the only shape that funds itself. A parcel pays
out forever, so its cost is an annuity, while ad revenue per player is flat:

| | Parcels held | Costs us per year |
| --- | --- | --- |
| End of year 1 | 36 | $1.56 |
| End of year 3 | 108 | $4.69 |
| End of year 5 | 180 | $7.82 |

Against roughly $5–12/year of ad revenue from an engaged player, that stays
solvent to about year five — beyond realistic retention. **Raise the rate
tenfold and you are underwater in the first year.** A unit test pins our
average parcel to the same liability as an average Atlas Earth parcel, so the
calibration cannot drift unnoticed.

Our ladder is deliberately **wider** than Atlas: 40× from ROCKY to RUBY versus
their 4×. Atlas sells parcels for cash, so their rarity roll is flavour on a
purchase. Here the only way to get a parcel is to walk 100,000 steps, so the
roll has to be worth the walk — same average cost to us, far bigger difference
between a good day and a bad one.

**The honest consequence: nobody earns a living here.** A year of hard walking
buys a cup of coffee. The money is a hook, not a wage, and the real reward has
to be the map, the collection and the streak.

### Money is never a float

Integer coins are the unit of account. Dollars are derived at the edge for
display and returned as a **string**, because binary floats cannot represent
most decimal money exactly and the errors accumulate.

Display precision is six decimal places, and that is arithmetic rather than
taste: a coin is worth $0.000002, so fewer places literally cannot render the
smallest unit of the currency. At four, a player with one ROCKY parcel reads
`$0.0000` for fifty hours and concludes the app is broken — a test caught
exactly that during this build. If you retune the rate, the display must still
be able to show a single coin; there is a test enforcing it.

Payouts are gated at `MIN_REDEMPTION_COINS` (500,000 coins = $1.00), which an
active player reaches inside their first year.

### Before any of this ships

Real-money redemption plus a random-outcome reward touches money transmission
rules, tax reporting, and loot-box/gambling law in several jurisdictions, and
it gets materially worse if parcels are ever purchasable with cash. This needs
a lawyer, not a README.

---

## Anti-cheat (iOS + Android)

### The thing that trips everyone up

**There is no such thing as a signed HealthKit or Health Connect step count.**
Step data lives on the phone and a modified build of your app can hand your
server any number it likes. No amount of client code fixes that, and any
tutorial promising a "signed HealthKit reading" is wrong. (Google Fit's APIs
are retired — on Android it is Health Connect now.)

What you *can* prove is that a request came from a genuine, unmodified build of
**your** app on real hardware. That is device attestation:

| Platform | Mechanism |
| --- | --- |
| iOS | Apple App Attest (`DCAppAttestService`, iOS 14+) |
| Android | Google Play Integrity API |

Attestation still does not prove a human walked — a phone taped to a ceiling
fan passes it. So there are three layers, and none of them is sufficient alone:

| Layer | Question it answers | Status |
| --- | --- | --- |
| 1. Attestation | Is this our real app on a real phone? | plumbing done, verifiers need your credentials |
| 2. Idempotency | Has this exact sync already been paid? | **done and tested** |
| 3. Plausibility | Could a human have walked this? | **done and tested** |

Layers 2 and 3 work identically on both platforms and do not depend on layer 1,
so they protect you right now.

### Layer 2: idempotency

Phones on mobile networks retry constantly. Without a guard, every retry is
free money. The client sends an `Idempotency-Key` header; a partial unique
index on `(user_id, idempotency_key)` makes a duplicate structurally
impossible, and the second call replays the original answer instead of paying
again. Tested with five simultaneous identical syncs: one `step_logs` row, paid
once.

### Layer 3: plausibility limits

Configured in `src/game/rules.ts`:

| Limit | Value |
| --- | --- |
| Sustained pace | 250 steps/minute |
| Shortest window | 60 minutes (15,000 steps) |
| Catch-up window | stretches to 24 hours |
| Daily ceiling | 60,000 steps per rolling 24h |

The allowance is measured over a **sliding window**, never over "time since the
last sync". That distinction is not cosmetic — the first version used time
since last sync with a floor, and the e2e suite caught it silently discarding
honest steps: a phone reporting 600 steps and then 600 more a second later got
the second batch clipped, crediting 1,100 instead of 1,200. A window has no
such memory loss, so syncing every ten seconds and syncing once an hour earn
exactly the same. There is a regression test for this.

Excess steps are **truncated, not rejected**, and the refused amount is stored
in `step_logs.rejected_steps`. An honest phone that was offline all morning
still gets credited what it plausibly walked, and repeat offenders show up in
the data.

### Layer 1: what is left to do

The parts that are platform-agnostic are **built and tested**: the single-use
challenge endpoint (`POST /attest/challenge`), nonce consumption, device
recording, and the `ATTESTATION_MODE` policy switch (`off` / `optional` /
`required`). Tests confirm a nonce works exactly once and that one user's nonce
cannot be used by another.

The two platform verifiers in `src/security/attestation.ts` are **deliberately
left as failing stubs**, because each needs credentials and a real device:

- **Apple** — your Team ID and bundle ID, Apple's App Attest root certificate,
  and a physical device (the simulator cannot attest). Verification means CBOR
  decoding, walking the X.509 chain, checking the nonce and the `rpId` hash,
  and enforcing a strictly-increasing signature counter.
- **Google** — a Google Cloud service account with the Play Integrity API
  enabled, plus your package name. Simpler: POST the token to
  `decodeIntegrityToken` and check the verdict fields.

They are stubs rather than untested crypto on purpose. A subtly wrong verifier
accepts everything, which is worse than having none — you would believe you
were protected. The `devices` table already has the `attest_public_key` and
`attest_counter` columns Apple's flow needs.

**Roll out with `ATTESTATION_MODE=optional`** so you can see in the logs how
many real clients pass before you start turning anyone away. Switching straight
to `required` will lock out a slice of your players.

## Three design decisions worth knowing about

### 1. Walk Points are computed from a lifetime step total

`floor(steps / 1000)` per sync would throw away the remainder, so syncing
600 steps twice earns 0 WP instead of 1. Players who synced rarely would earn
noticeably more than players who synced often.

Instead `src/services/steps.service.ts` asks what the player's entire step
history is worth and subtracts what has already been paid. Leftover steps stay
banked. This needs no extra column - `SUM(raw_steps)` over `step_logs` is the
source of truth.

### 2. `last_coin_claim_at` advances by the time actually paid for, not to NOW()

This is the one deliberate deviation from the Step 1 spec, and it is worth the
two minutes to understand.

Coins are whole numbers, so income must be rounded down. If we reset the
timestamp to `NOW()` every time, a player with one COMMON parcel (1 coin/hour)
who checks their balance every five minutes would earn `floor(0.083) = 0`
coins, reset their clock, and never earn anything at all - punished for playing.

So we move the clock forward by exactly `coins_earned / coins_per_hour` hours
and leave the remainder banked. Checking your balance often is then neither a
reward nor a punishment. See the long comment in `src/services/user.service.ts`.

There is a third case that is easy to miss: a player who owns **no** parcels.
They earn 0 coins, so the "don't move the clock" rule would preserve a stale
timestamp — and their first parcel would then be paid for all that idle time.
When the hourly rate is zero there is no part-earned remainder worth keeping,
so the clock jumps to `NOW()` instead. Test 12 in the API suite covers exactly
this: 10 idle hours, then buy, must pay 0 coins.

### 3. Spending Walk Points is a single conditional UPDATE

Read-check-then-write lets two simultaneous taps both pass the "has 100 WP?"
check. So the balance check and the deduction are one statement:

```sql
UPDATE users SET walk_points_balance = walk_points_balance - 100
 WHERE id = $1 AND walk_points_balance >= 100
```

If it matches zero rows, the player could not afford it. PostgreSQL locks the
row for the duration of the statement, so the race is impossible.

---

## Project layout

```
fareground-backend/
  db/schema.sql              the three tables + the rarity ENUM
  src/
    index.ts                 starts the server, graceful shutdown
    app.ts                   Express wiring (middleware + routes)
    config/env.ts            loads and validates .env
    db/pool.ts               connection pool, query(), withTransaction()
    game/rules.ts            THE ECONOMY - every tunable number
    middleware/auth.ts       JWT verification, requireAuth
    middleware/errorHandler.ts
    routes/                  thin: validate input, call a service, respond
    services/                the business logic and all the SQL
    security/                challenges + the attestation seam
    scripts/migrate.ts       npm run db:migrate
    utils/                   HttpError, asyncHandler
```

The rule of thumb: **routes are thin, services hold the logic, `rules.ts` holds
the numbers.**

---

## Known gaps to close before launch

- **The two attestation verifiers are stubs.** Everything around them is built
  and tested; the Apple and Google crypto needs your developer credentials and
  a real device. See the anti-cheat section. Until then run with
  `ATTESTATION_MODE=off` or `optional`.
- **No payouts.** The ledger has a `PAYOUT` entry type and nothing writes one.
  A real payout needs a state machine (requested / approved / sent / reversed),
  idempotency, and KYC — none of which exists yet.
- **Multi-accounting is unaddressed.** One person with fifty accounts is a
  fifty-times payout. The `devices` table makes it detectable; nothing detects
  it yet. This becomes the main fraud vector the day money is redeemable.
- **No refresh tokens.** A 7-day JWT cannot be revoked. Acceptable for Step 1.
- **Rate limits are per-process and in memory.** Fine for one server; the
  moment you run two, each allows the full quota. Use `rate-limit-redis`.
- **No anomaly reporting.** `step_logs.rejected_steps` records every refusal
  but nothing surfaces it. A simple daily query for accounts with large
  rejected totals would find your farmers.
- **Sub-coin income imprecision.** A player who already owns parcels keeps a
  remainder of under one coin's worth of time, and a parcel bought inside that
  window shares in it. Worth seconds, not hours. Fixing it properly means
  per-parcel accrual timestamps or storing fractional coins - both schema
  changes, and not worth it until the numbers get big.
- **`GET /user/balance` writes on a GET.** Deliberate for Step 1 and marked
  `Cache-Control: no-store`, but it means the endpoint is not safely
  retryable by proxies. A `POST /user/claim` would be the cleaner split.
