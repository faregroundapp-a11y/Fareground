# Fareground — the complete handoff

> Everything about this project in one file: what it is, how it works, every
> decision and why, what is built, what is tested, and what is left.
> **Read this whole file before touching anything.** True as of 2026-09-22.
> Verify file and function names still exist before relying on them.

---

## 0. The person you are working with

- Building **Fareground**, a mobile walking game like **Atlas Earth**.
  Inexperienced developer. Wants you to **do things, not hand over to-do
  lists** — when given a list of steps they said "can you not do all this for
  me". Prefer acting over asking.
- Writes short, typo-heavy messages ("revert the map back", "make it still
  sharp"). Read for intent.
- Tests on a **real Android phone** over Wi-Fi, and in **BlueStacks** on the
  PC. No Mac, no Android Studio.
- Taste: likes Atlas-Earth-style gameplay, a real colourful map (OpenFreeMap
  **liberty**), a character on the map, effects and animation, clean UI.
  Rejected: the pale *positron* map, street names on land, a floating
  grid-reference popup, **banner ads**.
- Windows 11, PowerShell primary. User email: haaroon0603@gmail.com (identity
  only).

---

## 1. What Fareground is

Walk in real life → steps become **Walk Points (WP)** → spend WP to claim a
real-world ~9 m square of ground (a **parcel**) near you → each parcel turns
out to be a **mineral** that earns **coins per hour, forever** → coins are
*intended* to become redeemable for real money (**not implemented; see §11**).

Around that core sit the things that bring people back: a daily chest with a
streak, daily quests, visits, treasure boxes, weekly leaderboards with prizes,
profiles with avatars and badges, invites — and rewarded ads threaded through
all of it.

---

## 2. The economy (all of it in `backend/src/game/rules.ts`)

| Rule | Value |
|---|---|
| Steps per WP | **100** |
| Parcel price | **20 WP + 5 per parcel owned** (1st 20, 10th 65, 50th 265) |
| Signup bonus | 20 WP — exactly one parcel, so a new player claims immediately |
| Claim reach | server 40 m, app shows 35 m (75/65 while scouting) |
| GPS accuracy to claim | ≤ 25 m |
| Coin value | **1,000,000 coins = $1.00** ($0.000001 each) |
| Payout threshold | 1,000,000 coins ($1) |

| Mineral | Odds | Coins/hr | $/year | Map block |
|---|---|---|---|---|
| ROCKY | 60% | 1 | $0.009 | 0.6 m |
| COAL | 25% | 2 | $0.018 | 1.0 m |
| AMETHYST | 10% | 5 | $0.044 | 1.8 m |
| SAPPHIRE | 4% | 12 | $0.105 | 2.8 m |
| RUBY | 1% | 40 | $0.350 | 4.0 m |

**Other ways to earn WP:** daily chest 3/4/5/6/8/10/20 on a 7-day streak;
quests 6+12+5+3; a visit 4 (+6 somewhere new); bonus-WP ads 5 × 6/day;
treasure boxes 6–14; ad-streak chest 10; invites 100/200. Almost all can be
**doubled by watching an ad**.

**Parcel upgrades** are a WP *sink*: 4 levels, costing 25/50/75/100 WP **plus
one ad each**, adding +1 coin/hour per level. Those WP would otherwise buy
parcels that cost us more, so upgrading is cheaper for us *and* pays four ads.

### Why these numbers (do not "simplify" this away)

- A parcel pays **forever**, so every one is an annuity. A flat price makes
  what we owe grow linearly with time walked, which goes broke. The rising
  price makes land held grow like √(steps), so the cost levels off.
- Modelled in `rules.test.ts` ("EVERY way to earn together still funds
  itself"): a player squeezing every source (~200 WP/day) holds ~165 parcels
  after a year (~$3.6/yr) and ~290 by year three (~$6.3/yr), against roughly
  $9/yr from just three rewarded ads a day.
- The coin rate was halved (from 500k/$1) when chests, quests, visits, ad WP
  and referrals were added. **Existing balances halved in $ terms.**
- Money is **never** a float: integer coins, micro-coins for fractions, USD
  only as a display string at the edge.

---

## 3. Where everything is

```
C:\Users\zpolo\maze-bot\                 (also holds an UNRELATED Python maze bot — leave it alone)
├── FAREGROUND_HANDOFF.md                  ← this file
├── fareground-backend\                    Node + TypeScript + Express + PostgreSQL (raw SQL via pg)
└── fareground-app\                        Expo SDK 57 + React Native 0.86 + Expo Router + MapLibre
```

### Machine setup (already installed)

- Node 24 LTS, npm 11. PostgreSQL 17, service `postgresql-x64-17`, user
  `postgres` / password `postgres`, database `walkscape`,
  psql at `C:\Program Files\PostgreSQL\17\bin\psql.exe`.
- **Git Bash cannot see `node`/`npm`.** Run Node commands in PowerShell with:
  `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`
- The PC's LAN IP **changes between networks** (was 192.168.1.209, now
  **192.168.0.220**). It lives in `fareground-app/.env.local` and in
  `eas.json` (preview profile). When it changes, update both.

### Expo / EAS

- Expo account `zpolo`, org **zpolos-team**, slug **fareground**, projectId
  `0bae1a40-5660-4956-9f0d-3b4a3b495780`.
- **The app cannot run in Expo Go** (MapLibre and other native modules).
- **JS changes reach the phone instantly** through Metro. Anything native
  needs a new EAS build (~20 min):
  `npx eas-cli@latest build --profile development --platform android`
- Latest builds (2026-09-22, with the logo + native modules):
  development `8de41d62-52a2-47ad-a5fb-4f3581319c05`,
  preview/release `fc1e2b51-d7be-470e-b323-2fc01b286d06`.
  **Everything built after those is JS-only and needs no rebuild.**

### Running it

```powershell
# backend (fareground-backend)
npm run dev

# app dev server (fareground-app)
$env:REACT_NATIVE_PACKAGER_HOSTNAME='192.168.0.220'
npx expo start --dev-client --lan --port 8081     # add --clear after dependency changes
```

On the phone: open the Fareground dev build → `http://192.168.0.220:8081`.
Same Wi-Fi as the PC; Windows Firewall must allow Node on private networks
(Claude is not allowed to change firewall settings). Health checks:
`/health` on :3000 and `/status` on :8081.

---

## 4. Backend

Express 4 (pinned), zod 3, pg with **BIGINT parsed to number**, bcryptjs, JWT,
helmet, cors, express-rate-limit. Services hold logic and SQL; routes stay thin.

### Modules

| File | What it owns |
|---|---|
| `game/rules.ts` | **The whole economy.** Every number, with its reasoning. |
| `game/grid.ts` | The world grid. **Byte-identical copy in the app** (§7). |
| `game/badges.ts` | 21 badges + levels, pure functions. |
| `game/avatar.ts` | ~38 avatar parts and their unlock rules. |
| `services/auth.service.ts` | Register, login, Google sign-in, signup bonus. |
| `services/steps.service.ts` | Step sync: idempotency, plausibility, WP. |
| `services/parcels.service.ts` | Claiming, nearby, upgrades. |
| `services/user.service.ts` | Lazy coin income (micro-coins), balance. |
| `services/rewards.service.ts` | Every rewarded-ad kind, tickets, granting. |
| `services/daily.service.ts` | Chest, streaks + saves, quests, ad-streak chest. |
| `services/checkin.service.ts` | Visits (the DB still says "checkin"). |
| `services/treasure.service.ts` | Treasure boxes. |
| `services/leaderboard.service.ts` | Weekly boards by area, prize settlement. |
| `services/profile.service.ts` | Profiles, badges, avatars, names, titles. |
| `services/referral.service.ts` | Invite codes. |
| `services/push.service.ts` | Devices, and sending through Expo's push service. |
| `services/notify.service.ts` | **What** to notify and **when**; the timer loop. |
| `services/neighbours.service.ts` | Who else owns land nearby, aggregated so nobody is located. |
| `security/admobSsv.ts` | Verifies Google's signed rewarded-ad callback. |
| `security/googleIdToken.ts` | Verifies Google ID tokens (no extra dependency). |
| `security/attestation.ts` | App Attest / Play Integrity — **deliberate stubs**. |

### Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register`, `/auth/login`, `/auth/google` | `{user, token}` |
| POST | `/steps/sync` | `Idempotency-Key` header; plausibility limits |
| POST | `/parcels/claim` | `{lat,lng,accuracyM,cellX?,cellY?}` |
| GET | `/parcels`, `/parcels/nearby?lat&lng&radius` | nearby never reveals owners |
| GET | `/user/balance` | settles income; returns price, boosts, avatar, badges dot |
| POST | `/user/timezone`, `/user/area` | so "today" and leaderboards are local |
| POST | `/rewards/start`, `/rewards/complete` | ad tickets (10 kinds) |
| GET | `/rewards/ssv` | Google's signed callback (public, signature-checked) |
| GET | `/daily` | chest + quests + visit + streak save + ad streak |
| POST | `/daily/claim`, `/daily/quests/:key`, `/daily/adstreak` | collect rewards |
| POST | `/checkin` | a visit (extras need `adNonce`) |
| GET | `/treasure?lat&lng`, POST `/treasure/:id/open` | boxes |
| GET | `/leaderboard?scope=CITY\|REGION\|COUNTRY\|WORLD` | weekly steps |
| GET | `/profile`, `/profile/:username`, PATCH `/profile`, POST `/profile/badges/seen` | |
| GET | `/referral`, POST `/referral/redeem` | invites |
| POST | `/user/push`, `/user/push/remove`, `/user/push/enabled` | device tokens + the kill switch |
| GET | `/parcels/neighbours?lat&lng` | who else owns land here - **no radius, fixed ~1 km box** |

### Migrations (never edit an applied one — add the next number)

1. `001_initial` users, step_logs, parcels
2. `002_anti_cheat` idempotency, devices, attestation challenges
3. `003_mineral_parcels` rarity enum + rate CHECK
4. `004_coin_ledger` immutable ledger; `users.coin_balance` is a cached projection
5. `005_geographic_parcels` cells + **one owner per square, ever**
6. `006_boosts_ads_google` micro-coin remainder, boosts, ad_rewards, Google
7. `007_daily_quests` reward_claims, time zone, DOUBLE ads
8. `008_leaderboard_checkins` areas, prize boosts, leaderboard weeks, visits
9. `009_profiles_badges` jersey colour, user_badges
10. `010_referrals` codes + referrals
11. `011_avatars_more_ads` avatar JSON, titles, usernames, scout, cosmetics
12. `012_upgrades_treasure_streaks` upgrade levels, treasure, streak saves
13. `013_ad_consumed` `ad_rewards.consumed_at` (ads spent later)
14. `014_treasure_claims` box rewards become claims, so ads can double them
15. `015_push_notifications` push_tokens, notification_sends, push_enabled, last_active_at
16. `016_finer_places` visits: a `place_scale` column; places went from ~1 km to ~250 m

### Decisions that must not be undone

- **WP from the lifetime step total**, not per batch: 600 + 600 steps must
  equal the same WP as 1,200 at once. A regression test pins this.
- **Plausibility is a sliding window** (250 steps/min, 60 min stretching to a
  24 h catch-up, 60,000/day). Excess is **truncated, not rejected**, and
  recorded in `rejected_steps`.
- **Lazy coin income in micro-coins.** `coin_remainder_micro` carries the
  fraction; the clock always moves to NOW. Checking often is neither a reward
  nor a punishment. `settleCoinIncome` uses
  `GREATEST(last_coin_claim_at, NOW())` — **instant collect pushes that clock
  into the future, and dragging it back would pay those hours twice.**
- **Double spend is impossible**: one conditional `UPDATE … WHERE balance >=
  price`; same-square races are settled by the unique index and the loser's
  whole transaction rolls back.
- **Coins are a ledger.** Every credit writes a row; the e2e suite checks
  `SUM(ledger) = coin_balance` across all accounts.
- **Claim reach 40 m** because at home you stand on land you already own and
  GPS drifts about one square.
- **Boost multipliers add up** (`activeMultiplier`), ad boosts and leaderboard
  prize boosts are separate (`boosts.source`), and the ad bank (4 h) only
  counts AD boosts.
- **Leaderboard prizes need no cron**: the first request after a week ends
  settles it, under an advisory lock plus a `leaderboard_weeks` row.
- **Invites pay the inviter only after the friend walks 3,000 steps**, and two
  accounts on the same phone pay nothing.
- **Never call `syncBadges` (pool-based) inside a transaction that locks
  `users`** — the badge insert needs a shared lock on that row and the request
  waits for itself. That deadlock happened; the API suite caught it.
- **Notifications are claimed before they are sent.** The dispatcher INSERTs
  into `notification_sends` and only messages the rows the unique index let
  through, so two servers racing still produce one notification. Quiet hours
  (09:00-21:00) and "one kind per person per LOCAL day" are both enforced there.
- **`/parcels/nearby` still reveals no owners, ever.** A map labelled with
  names is a record of where someone walks daily. `/parcels/neighbours`
  exists instead: a FIXED ~1 km box (so nobody can shrink the radius to pin a
  person down), names never attached to a square, and silence entirely when
  fewer than 2 other owners are present - one name in an empty area IS a
  located person.
- **A visit's `place_scale` is stored with every row.** Places were ~1 km and
  are now ~250 m; a coarse square contains 16 fine ones and the row never
  recorded which, so old rows are compared only against their own scale
  rather than rewritten into data we never had.
- **Attestation verifiers are failing stubs on purpose.** Untested crypto that
  accepts everything is worse than none. There is no such thing as a signed
  HealthKit/Health Connect step count.

---

## 5. Ads (the revenue model)

**Every ad is opt-in.** Banners were removed first; then on 2026-09-23 the
**interstitial and app-open ads were removed too**, along with their config,
call sites and ad units. There is now no ad a player has not asked for. Do not
reintroduce any of the three without asking.

**Rewarded (the player chooses, all capped):** boost 2× coins (30 min/ad, 4 h
bank, 12/day) · bonus WP (+5, 6/day) · **double** any chest, quest, visit,
bonus chest or treasure reward · instant collect (2 h of income, 3/day) ·
scout (reach 75 m for 10 min, 6/day) · cosmetics (an avatar part, forever) ·
parcel upgrades (one per level) · extra visits (unlimited, one ad each) ·
streak save (2/week) · extra treasure boxes (up to 10/day).

**Full-screen and app-open: gone.** The interstitial fired after every 2nd
claim, which interrupted the claim reveal — the best moment in the game — and
is the pattern Google'''s disruptive-ads policy scrutinises hardest. The
app-open ad fired every 2 hours. Both are deleted from `src/native/ads.tsx`,
`src/config.ts`, `src/state/game.tsx` and `(tabs)/index.tsx`.

Cosmetics and scouting cost the game **nothing**, which makes them the best
ads in the app. Instant collect is income brought *forward*, not created.

**Ad integrity:** the phone asks for a ticket *before* the ad (so nobody
watches one that cannot pay), Google's signed SSV callback grants it in
production (`AD_REWARD_VERIFICATION=ssv`), and every ticket is single-use.
`client` mode trusts the phone and is for local development only.

---

## 6. App (`fareground-app`)

**Read `fareground-app/AGENTS.md` first** — versioned Expo docs, Expo Router,
`npx expo install`, lint + typecheck before saying anything is done.

- **Tabs:** Map · Walk · Ranks · Land, plus hidden routes `profile` and
  `player/[username]` (`href: null`).
- **Map** (`(tabs)/index.tsx`): MapLibre with **all gestures ours** (a
  `CameraController` class; one finger spins the world around you, two fingers
  pinch/twist, pitch follows zoom). Tap a lit square to pick it; claim; the
  block erupts, gems fly, the phone thumps harder for rarer finds. HUD: profile
  portrait, coins, WP, boost chip with countdown, chest button with a badge,
  compass. Treasure boxes are markers you walk to.
- **Walk:** step ring, WP, next-parcel progress, Health Connect card, "Free
  rewards", Today card, profile avatar with a new-badge dot.
- **Ranks:** weekly leaderboard, four area scopes, prize strip, last week's win.
- **Land:** your parcels, collection, boost row, **upgrade buttons**.
- **Profile:** character portrait, level, stats, 21 badges, avatar editor,
  username, title, invite card.
- **Steps:** iOS motion history; Android **Health Connect** plus the live
  sensor, today's total being the **larger** of the two (never the sum), with
  midnight carry-over and a one-off upgrade baseline.
- **Native modules** (need a build): `expo-haptics`,
  `react-native-google-mobile-ads`, `react-native-health-connect`,
  `@react-native-google-signin/google-signin`, `expo-splash-screen`. All
  loaded through `src/native/optional.ts`, which checks the native module
  exists first — an older build simply has those features off.
- **Performance:** React Compiler on (~92 components memoised); three separate
  contexts so a step tick never re-renders the map; `freezeOnBlur`; lit squares
  and reach circle only recompute after 2 m of movement; the runner glide is
  capped at 30 fps and pauses in the background.
- **Style:** Nunito, **never `fontWeight`** with a custom font (it fakes bold
  and looks blurry) — always `fontFamily: fonts.*`. Tokens in `src/theme.ts`.
- **Logo:** amber map pin with a ruby, on a glowing parcel of isometric grid.
  Source of truth is `scripts/logo.py` (`python scripts/logo.py` regenerates
  every icon); the same shapes are in `src/components/Logo.tsx`.

---

## 7. The shared grid (contract)

`fareground-backend/src/game/grid.ts` and `fareground-app/src/game/grid.ts` must
be **byte-identical**; a backend test fails if they differ. Change the backend
copy, then copy it over. Square grid in Web Mercator metres,
`CELL_SIZE_MERCATOR = 14` (14 m at the equator, 8.7 m in London).
Micrometre snapping before flooring fixes a real bug at latitude 0.

---

## 8. Testing

| Where | Command | Last result |
|---|---|---|
| backend | `npx tsc --noEmit` | clean |
| backend | `npm test` (rules, grid, badges, avatar) | **56/56** |
| backend | `npm run test:api` (server must be running) | **299/299** |
| backend | `npm run test:db` (leaderboard settlement) | PASS |
| app | `npx tsc --noEmit`, `npx expo lint`, `npx expo-doctor` | clean, 21/21 |
| app | `npx expo export --platform android` | builds |

The e2e suite uses **one pooled `System.Net.Http.HttpClient`** — with
`Invoke-WebRequest` per call it ran the machine out of sockets after ~330
requests and failed with "Unable to connect" while the server was fine.
In that suite, never name a variable `$base` (it is the API URL) or `$pid`
(reserved by PowerShell).

---

## 9. Testing switches

- `DEV_LUCKY_EMAILS` in the backend `.env` makes **every claim a RUBY** for the
  listed accounts. Ignored entirely when `NODE_ENV=production`. Currently set
  for haroonbolbol@gmail.com and zpolo2349@gmail.com.
- `AD_REWARD_VERIFICATION=client` trusts the phone about ads (dev only).
- WP can be granted directly:
  `UPDATE users SET walk_points_balance = walk_points_balance + 4000 WHERE email='…';`

---

## 10. Gotchas already hit (do not repeat)

- **Long bash heredocs fail here.** Write a `.py` patch script with the Write
  tool and run it; assert each replacement matches exactly once.
- **PowerShell `Get-Content`/`Set-Content` corrupts UTF-8.** Edit with Python
  or the Write tool.
- **npm peer conflict**: installing anything may pull `react-dom@19.3.0`
  against Expo's pinned 19.2.3 — fix with `npx expo install react-dom`. Never
  `--force` or `--legacy-peer-deps`.
- **Do not add `babel.config.js`** — Expo applies `babel-preset-expo` itself.
- **MapLibre v11**: `Map` (not MapView), `Layer … paint={}` (not `style`),
  `Camera` ref with `jumpTo`/`easeTo`, `MapRef.unproject`.
- **React Compiler lint rules**: no writing a ref during render, no reading a
  variable before its declaration inside a hook callback, no `Date.now()` in
  render.
- **Google Sign-In must use non-Firebase mode** (an `iosUrlScheme` option) —
  Firebase mode breaks the Android build without `google-services.json`.
- `ALTER TYPE … ADD VALUE` must run **outside** the migration's BEGIN block,
  and the new value cannot be used in that same transaction.
- A `CHECK` constraint added to an existing table needs its old rows
  backfilled first (migration 012 hit this).

---

## 11. What is left

**Needs the user's accounts / card:**
1. **AdMob account** + 3 ad units (rewarded, interstitial, app-open). Send the
   IDs; the real app ID goes in `app.json` and needs one rebuild.
2. **Set the SSV callback URL** on the rewarded unit once the server is public,
   and switch `AD_REWARD_VERIFICATION=ssv`.
3. **Google Play developer account** ($25) — data safety form, ads
   declaration, content rating.
4. **Privacy policy** at a public URL (required by AdMob and Play).
5. **A real server with HTTPS** (~$10–25/month). Everything currently runs on
   the PC and stops when it sleeps.
6. **Google sign-in**: Web + Android OAuth clients in Google Cloud (the
   Android one needs the EAS keystore's SHA-1). The button stays hidden until
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `GOOGLE_CLIENT_IDS` are set.
7. **Health Connect** needs a step source (Samsung Health, Fit, the phone)
   connected on the device.

**Engineering left:**
8. Production secrets: real `JWT_SECRET`, a real database password, remove the
   dev rate-limit overrides, turn off `usesCleartextTraffic`.
9. **Payouts**: the ledger has a `PAYOUT` type nothing writes. Needs a state
   machine, KYC, multi-account detection — and legal advice first. Real-money
   redemption plus random rewards touches money transmission, tax and
   loot-box/gambling law. **Consider not paying cash at all** (cosmetics,
   boosts and a season pass instead); it removes the liability entirely.
10. **Real attestation verifiers** (needs Apple/Google credentials and a
    device) and GPS-spoofing checks (the `mocked` flag is already read).
11. **Not built, discussed:** clans/friends, seasons or a battle pass, quest
    rerolls, a spin wheel (keep prizes cosmetic — cash-value prizes are
    gambling-adjacent), push notifications, refresh tokens, a shared
    rate-limit store (Redis) before running more than one server instance.

**Sustainability, briefly:** per engaged player, ads bring roughly $11–55/year
against $3.60–6.30/year of land. **That range now rests on rewarded ads alone**,
since the forced ones were removed — the economy model in `rules.test.ts`
already assumed only ~3 rewarded ads a day (~$9/yr), which still covers the
land, so the game funds itself without them. It is profitable per player; the business
question is retention and scale. ~30–60 daily players covers hosting; ~1,000
daily players is £4k–15k/year. Cosmetic purchases and a "remove ads"
subscription would likely beat the ads themselves.

---

## 12. Round-by-round history

1. **Foundations** (earlier sessions): backend, economy, claiming, the map,
   the runner, claim animation, Nunito, OpenFreeMap liberty.
2. **Steps, ads, Google, UI, performance**: Health Connect, haptics, AdMob,
   Google sign-in, 100 steps/WP with a rising parcel price, the design-token
   pass, React Compiler and the re-render fixes.
3. **Logo + daily loop**: the pin-and-ruby logo and every icon, daily chest,
   quests, the first "double it" ads, contextual ad placements.
4. **Leaderboards, visits, profiles**: weekly boards by area with prize
   boosts, location visits, profiles with 21 badges.
5. **Rebalance + invites**: the coin rate halved and the price slope raised,
   invite codes with anti-farming, profile button on the map.
6. **Real profiles + more ads**: avatars (no photo uploads), usernames,
   titles, cosmetics/scout/instant-collect ads. Fixed a self-deadlock and an
   instant-collect double-payment.
7. **Upgrades, treasure, streaks**: parcel upgrades, unlimited visits by ad,
   streak insurance, the ad-streak chest, treasure boxes. Fixed the e2e
   suite's socket exhaustion.
9. **Renamed to Fareground; forced ads removed; push, neighbours, finer
   visits, new sign-up** (2026-09-23). See §13.
8. **"Visits" + ads turned up**: renamed check-ins, more frequent full-screen
   ads, doubleable treasure — then **banners removed entirely**.

---

## 26. Render hosting, the economy rework, and the reset fixes (2026-09-26)

Work from a CLOUD session (Claude Code on the web), on branch
`claude/file-visibility-9ia9fr`, merged with the PC session's branch
`pc-work`. **Read the plan before the history: it says what is in flight.**

### THE PLAN - in order, and what is done

| # | Item | State |
|---|---|---|
| 1 | Second and later treasure boxes 500 (`reward_claims_once_per_day` covered TREASURE/PITSTOP) | **Done** - migration 026 (PC session), merged |
| 2 | Profile photos + doorbell skips 500 (enum missing PIT_STOP/PHOTO) | **Done** - migration 025 (PC session), merged |
| 3 | Daily resets follow each player's OWN local midnight: chest, quests, every daily ad cap. Server clock only; the zone itself can move once a week (migration 027) | **Done** - `db/localTime.ts`; the 4-hour claim gaps are gone |
| 4 | A collected quest still shows **Collect** (then errors) | **Done** - it was the 4-hour gap disagreeing with the status |
| 5 | Instant collect says "0 left today" when the real cause is owning no land | **Done** - `needsLand` |
| 5a | Bonus-WP ads "infinite": the cap was only checked when a ticket was ISSUED, so open tickets all paid | **Done** - re-checked at payout; 25 tickets now pay exactly 20 |
| 5b | Profile pictures vanish: Render wipes its disk on every deploy | **Done** - pictures live in Postgres (migration 028); also fixed the old-picture cleanup, which never ran |
| 5c | Treasure boxes indoors (placed beside parcels, which are mostly homes) | **Done** - placed ON footpaths/park paths/quiet streets from OpenStreetMap (Overpass), falling back to the old heuristics |
| 5d | Street-name toggle, today's area name + maps button + claim-inside-then-2x, tappable boxes, no "(you)" brackets | **Verified present** (PC session's work, merged) |
| 6 | Economy rebuild (spec below) | **Next** |
| 7 | Tester APK rebuilt against Render, then shared by `.apk` link | After 6 |

### Economy - what the product owner decided (supersedes everything above)

Researched against Atlas Earth and TerraMine (TerraMine copies Atlas's
rates exactly; both only let players cash out from $5):

* **1,000 coins = $1.** Balances read in the thousands, never the millions.
* **Rates per parcel, per MONTH** (TerraMine-level; ruby stays the jackpot):
  Rocky 3, Coal 4, Amethyst 5, Sapphire 8, Ruby 25 (odds 60/25/10/4/1).
  Average $0.0039/month against TerraMine's $0.0035.
* **Parcels FLAT at 50 WP, for ever.** "I don't want prices to increase."
* **Boost 20x, 30 min per ad, 8 h bank, up to 48 ads a day** (stay boosted
  all day, as TerraMine allows). 400 parcels fully boosted is ~$1/day - the
  TerraMine figure testers quoted.
* **Bonus-WP ads: 20 a day** (was cut to 10 by the PC session; the owner
  wants 20). The button keeps showing how many are left.
* **Safety valves (how TerraMine survives the same maths):** boost tapers
  above 400 parcels (15x to 700, 10x to 1,000, then 5x); coins can be traded
  back into Walk Points (~10 coins = 1 WP, so a parcel is ~$0.50); cash-out
  minimum $5; optionally lower rates outside US/UK/CA/AU as Atlas does.
* **Existing balances are converted, never lost:** 2,000 old coins = 1 new.
* Honest cost: at 200+ parcels a fully boosted player is paid about what
  their ads earn (0.4-1.2x at 400). It works only with the valves, and cash
  redemption stays OFF until real ad rates are known.

### Style rules for this work

Match what is there: comments explain WHY in full sentences; money is
integer coins and micro-coins, never floats; every number lives in
`rules.ts`; Nunito via `fontFamily: fonts.*` (never `fontWeight`); colours
and spacing from `src/theme.ts`; lint + typecheck + unit tests before any
push.

### Done in this session (history)

* **Render hosting.** `render.yaml` at the repo root (web + Postgres,
  migrations on every start), live at `https://fareground-api.onrender.com`.
  `TRUST_PROXY=1`, or every player behind Render's proxy shares ONE
  rate-limit bucket (20 sign-ins per 15 min for everyone).
  `AD_REWARD_VERIFICATION=client` because test ad units never send SSV.
  Free plan: sleeps after 15 min idle; the free database is deleted after
  30 days - upgrade before real testers depend on it.
* **The EAS `tester` profile points at Render.** The PC session had pointed
  it back at a quick tunnel during the merge; reverted. The tunnel/serve
  scripts stay for local development only.
* Build it INSIDE `fareground-app`:
  `npx eas-cli@latest build --profile tester --platform android`. Share the
  `.apk` download link, NOT the expo.dev build page (private to the account -
  testers saw "Account not found"). The Expo project is **walkscape** under
  **ninefold** (renamed from zpolos-team).
* **Economy, as it stands in `rules.ts` until item 6:** parcel 50 WP + 1 per
  parcel owned (a rising price the owner has since rejected), boost 20x
  30 min/ad 12 h bank, 2,000,000 coins = $1, ROCKY 1 / COAL 2 / AMETHYST 5 /
  SAPPHIRE 12 / RUBY 100 coins per HOUR. It replaced the flat price + 2 h/ad
  boost that paid a regular walker ~10x what their ads earned.
* Website (`fareground-site/index.html`) figures were corrected to the
  current rates; they change again with item 6.

---

## 25. The tester round (2026-09-25 / 26)

The game went out to real people for the first time. This section is what
that changed, what it broke, and what was still open when it was written.

### How testers are served, and why it keeps falling over

The backend runs on the product owner's PC. Testers reach it through a
**cloudflared quick tunnel**, and the app has the tunnel URL baked in at
build time.

Three things follow from that, and all three bit during the round:

* **A quick tunnel's hostname is random and it drops without warning.** The
  first one died a few hours in and took every tester offline. A new tunnel
  means a new URL, which means a 15-minute rebuild.
* **The backend itself went down twice**, unsupervised, mid-round.
* localtunnel was tried for its FIXED subdomain, which would have removed the
  rebuild problem entirely. Its public service returned 503 for every
  request. Not worth a second attempt.

`fareground-backend/scripts/tunnel.ps1` now supervises the tunnel, restarts
it, and writes the live URL to `tunnel-url.txt`. **THE REAL FIX IS A HOST.**
GBP 10-20 a month removes all of this and is required for Play anyway.

### What the testers found

Ranked by how badly it mattered:

1. **NOBODY COULD SET A PROFILE PICTURE, EVER.** `PIT_STOP` and `PHOTO` were
   in the TypeScript `AdRewardKind` union and **not in the Postgres enum**,
   so `/rewards/start` returned 500 for both. Uploading a photo needs an ad
   ticket, so the whole feature was dead on arrival - as was paying an ad to
   skip the doorbell cooldown. Migration **025** fixes it with the enum-swap
   pattern.

   **WHY THE TESTS MISSED IT, which is the more useful lesson:** the photo
   test only asserted that an upload WITHOUT an ad is refused. It passed -
   collecting a 400 for the missing nonce and never reaching the enum. A test
   that only walks the unhappy path proves nothing about the happy one.
   Section 45 of the e2e suite now walks it and checks all twelve ad kinds.

2. **The throttle only covered three of eight faucets.** An account the
   anti-spoofing had throttled still farmed the daily chest, quests,
   treasure, the ad-streak chest, referrals and bonus-WP ads at full rate.
   It looked like it worked because the three paths that were tested were the
   three that were wired. There is now ONE chokepoint - `throttledAmount` in
   `integrity.service.ts` - and every new faucet must go through it.

3. **A player who travelled was stranded.** Today's area was rolled near
   wherever they were and never moved, so opening the app in another city
   left the target hundreds of km away, every check-in refused, and the only
   escape a rewarded ad. Compounded by **yesterday's unclaimed target
   blocking today's free roll** - travel on Monday and the account could
   never check in again without paying. Migration **024** adds
   `abandoned_at`; a target that is stale or more than 5 km away is now
   re-rolled free.

4. **"The ads are infinite."** They were not - the cap held at 20 every time.
   But twenty identical taps reads as a slot machine, and a button that never
   changes state feels endless whatever the number behind it. The 6 -> 20
   change was made in this same round at the product owner's request and was
   walked back to **10**, with the remaining count now ON the button. Half of
   that complaint was never about the number.

5. **The HUD did not fit on ANY phone.** Measured: it needed 438pt of chrome
   on a 430pt phone's 406 usable. Before, it ran off the edge; after a
   `flexShrink` "fix" it squashed instead. Both wrong. The community button
   moved to the right-hand stack, the boost clock lost its seconds
   (`23:59:04` -> `23h59`), and there is a real compact variant under 400pt.

6. Smaller: treasure boxes spawned at a **random bearing** and landed in
   lakes and motorways (now placed beside an existing parcel - land somebody
   demonstrably walked to); boxes were **not tappable** at all; `(you)` after
   your own name on the leaderboard read as a glitch; cell references were
   showing on the Land list and the reveal sheet.

### Still open at the end of the round

* **Second and subsequent treasure boxes fail to open** with a 500.
* **Daily resets do not follow the player's timezone properly** - chests,
  coins and quests. Fixing it must NOT let somebody harvest a day's rewards
  by winding their phone clock forward.
* A quest that has already been collected still shows a **Collect** button,
  which then errors.
* Instant collect says **"Back tomorrow - 0 left today"** when the real
  reason is that the player owns no land. Wrong message, wrong cause.
* The backend needs the same supervision the tunnel now has.

### Things worth not re-learning

* **`$pid` and `$home` are reserved in PowerShell.** Both silently broke test
  scripts and produced fake "bugs" that cost real time.
* **The e2e suite measures its own history.** It shared one fixture device id
  across runs, accumulated 54 "owners" of `pixel-xyz`, and started flagging
  its own honest-walker fixture on the device-sharing check. Fixtures now get
  a per-run id.
* **A flag that fires on every request is not a signal.** `UNATTESTED` was
  set on 100% of syncs while attestation is stubbed, which made
  `integrity_flags <> 0` meaningless and turned a partial index into a full
  one. It is deliberately not set until attestation is real; there is a test
  pinning its weight at zero.
* **EAS: the org was renamed `zpolos-team` -> `ninefold`** and `app.json`
  still carried the old `owner`, which fails the build with a project-owner
  mismatch. The projectId is unchanged.
* **The builder is Node 22 / npm 10; the dev machine is Node 24 / npm 11**,
  and they resolve peers differently. `npm ci --include=dev` passes locally
  while the build fails. Reproduce with
  `npx --yes npm@10.9.4 ci --include=dev` - one minute against fourteen.

---

## 24. Doorbells, areas, step integrity, AdMob wiring (2026-09-24)

### Pit stops became DOORBELLS, and moved onto the map

They were a list of parcel ids on the daily sheet, which you had to
cross-reference against the map yourself. A pit stop is inherently about a
PLACE, so it now lives on the place.

**Tap a square somebody else owns -> "Ring the doorbell?"** New
`components/DoorbellSheet.tsx`; `components/PitStopCard.tsx` is **deleted**
and the row is gone from `DailySheet`. The backend did not change at all -
`POST /pitstops { parcelId }` already did exactly this.

**`/parcels/nearby` now returns the parcel `id`.** That is the whole reason a
tap can ring a bell without a second lookup. It identifies the PLOT, never the
person; the owner is still only ever exposed as the boolean `mine`, and an
e2e test asserts no owner id leaks.

**`onTap` reads owners through a ref, not a dependency.** Depending on
`ownerOf` would rebuild the tap handler - and with it the whole
`CameraController` - on every nearby refresh. The ref is written in an effect,
never in render (React Compiler forbids that).

### Visits became AREAS you have to stand in

`GET /checkin/areas?lat&lng` returns a 5x5 board of ~250 m squares: the one
you are in (`here: true`), and the rest as destinations with a distance.
`components/AreasCard.tsx` draws it; an ad still doubles the reward.

**The gate is on the SERVER.** `POST /checkin` now takes `placeX`/`placeY` and
**422s unless they match the square your own coordinates fall in**. The
greying-out in the app is a courtesy, never the rule - otherwise the board
would be a list of places claimable from the sofa.

### Steps: the pace ceiling now falls off with duration

**This was the real accuracy hole.** A flat 250 steps/min is right for one
minute and absurd for a day - it would wave through 360,000 steps in 24 hours,
about three back-to-back ultramarathons. And that flat shape is *exactly* what
a shaker or a pendulum produces: a pace a human can hit briefly, held for
hours.

`PACE_CURVE` in `rules.ts` interpolates on a log scale: 250/min at a minute,
200 at an hour, 150 at six hours, 100 at a day. **An hour's window is now
12,000 steps, not 15,000.** Every honest player sits far under it.

### Step integrity flags - evidence, never enforcement

Migration **021** adds `step_logs.source`, `.integrity_flags`,
`.mocked_location` and `users.step_flag_count`. `STEP_FLAG` in `rules.ts`:
`IDENTICAL_BATCHES`, `ROBOTIC_CADENCE`, `MOCKED_LOCATION`, `NO_MOVEMENT`,
`OVER_LIMIT`, `WRITABLE_SOURCE`.

**NOTHING IS REFUSED ON A FLAG, on purpose.** Every one has an innocent
explanation - a treadmill really is metronomic, a developer really does mock
their location. They are recorded so a pattern is visible in the data BEFORE
any policy is built on it. Silently confiscating a real walker's Walk Points
on a heuristic would be far worse than a farmer getting away with it.

Thresholds chosen so honest walking never fires: identical batches need
**three** in a row (two happens on a steady walk with a regular timer),
robotic cadence needs a coefficient of variation **under 3%** across four
syncs (a human varies 15-40%), and nothing under 200 steps is examined at all.
Only the behavioural flags increment `step_flag_count` - `WRITABLE_SOURCE`
fires on almost every honest Android sync, so counting it would be noise.

The app now sends `source` (`MOTION_HISTORY` / `HEALTH_STORE` /
`DEVICE_SENSOR`) and `mockedLocation`. **A lying client can put anything
there** - which is exactly why it only ever sets a flag and never changes the
payout.

### AdMob

`app.config.js` is new. The AdMob **app id is native** (baked into
AndroidManifest at build time), so it could not come from `EXPO_PUBLIC_*` like
the unit ids do. It now reads `ADMOB_ANDROID_APP_ID` / `ADMOB_IOS_APP_ID`,
**defaulting to Google's test ids** - a build with no configuration shows
"Test Ad" and earns nothing, which is the safe failure. A malformed id throws
at config time rather than shipping a build whose ads silently never load.

`node scripts/admob-check.js` prints what is real, what is still a test id,
and the six remaining steps in order. Everything before step 5 is the user's
account work; step 6 is one EAS build.

### Notifications: the pipeline is fine, the BUILD is the blocker

`npx tsx src/scripts/push-check.ts [email]` walks the five things that must be
true and says which one failed. Run today it showed **zero push tokens have
ever been registered** - `expo-notifications` is a native module and the phone
is on a build that predates it. Nothing is wrong with the code; it needs the
rebuild. With an email it also sends a real test push through `sendToUsers`,
the same path the dispatcher uses.

### Profile picture and the runner swapped

The photo is now the 92px hero and the character is a 38px badge on it; it was
the other way round. The EDIT pill moved bottom-left so the badge does not
clip it.

### The e2e suite was a whole rebalance out of date

Thirteen failures, all one stale figure repeated: parcel step 5 (now 8), boost
2x/30min/4h (now 20x/15min/3h), RUBY 40 (now 100). Fixed by putting **one
`$RULES` block at the top** of `tests/e2e.ps1` - **when a rate changes, edit
that block, not the assertions.** Three new sections (40-42) cover the area
gate, the doorbell and the integrity flags. **329/329.**

One assertion had to be loosened honestly: with 12 ads filling the bank
exactly, the daily cap (429) and the full bank (409) bite on the very same ad,
so the test asserts the ad is refused rather than which rule answered.

### Also fixed in passing

- `StoreSheet` was mounted with no `position`, so **buying a treasure box
  would always have 400ed**. The sheet now asks for a one-off fix itself.
- The economy report's rival table carried **hard-coded** boost figures that
  went stale the moment the boost was retuned; every Fareground column now
  reads from `rules.ts`. It also printed the key comparison as "$0.01" against
  rivals' "$0.0496" - now four decimals.
- `rules.ts` comments still said "A MILLION COINS IS ONE DOLLAR", RUBY 40 and
  a 40x spread. Corrected.
- Eight Expo packages were a patch behind; `expo install --fix` brought them
  current. **21/21 doctor checks pass.**

---

## 23. The boost retune, and a correction about which lever matters

**SECONDS PER AD IS THE LEVER, NOT THE BANK.** This was got wrong in
conversation and is worth spelling out, because it is counter-intuitive: the
bank only binds on a player watching NINE OR MORE ads, so shrinking it does
nothing at all for a low-engagement player. What each ad BUYS is what decides
the cost of someone watching three a day.

Boost went **20 min/ad with a 4h bank -> 15 min/ad with a 3h bank**. Twelve
ads still fill it exactly. Player ceiling 4.17x -> **3.38x**.

| ads/day | revenue/yr | land cost/yr | margin |
|---|---|---|---|
| 3 (pessimistic, $0.008) | $8.76 | $5.01 | **1.7x** |
| 6 (middling, $0.015) | $32.85 | $6.88 | **4.8x** |
| 10 (good, $0.025) | $91.25 | $9.36 | **9.7x** |

**The three-ads-a-day row stays at 1.7x and that is accepted.** Pushing it to
2.0x needs 10-minute pieces with a 2-hour bank, which costs EVERY engaged
player 38% of their boost to protect a player worth $8.76 a year. Bad trade.
**If real ad rates come in worse than assumed, 10 min / 2h is the fallback**,
and there is now a test asserting three ads cannot buy more than 2x.

**The land cost in the report now scales with ads watched.** It used to charge
every column the unboosted rate, which flattered the middle and right badly -
boost ads are most of what a player watches, so the heavy player costs far
more than the base figure.

**Player earnings, boosted, cumulative:** Regular $3.78 / $15.80 / $32.05 over
1, 3 and 5 years; **$0.18 per hour of ad-watching** against a published Atlas
Earth figure of ~$0.003.

**At scale, after land and hosting:** 1,000 daily players is $3.4k
(pessimistic) / $25.7k (middling) / $81.6k (good) a year. Without cash
redemption every land cost is zero and those become $8.5k / $32.6k / $91k.

---

## 22. Coins buy Walk Points - the TerraMine mechanic

**TerraMine is free-to-play and ad-funded, exactly like this game.** So the
question "how do they afford those rates?" has a real answer, and it is this:
they let players **trade earned USD back into TerraBucks at 200 TB per $1**,
and a mine costs 100 TB. Two mines per dollar, against a mine yielding about
$0.034/year - a payback of roughly **14 years**.

The trade is deliberately poor value. Players take it constantly anyway,
because land is the part they enjoy and it compounds. **Every dollar traded
is a dollar that never gets cashed out.** The sink converts cash liability
into engagement. That - not a higher rate - is how the model works.

Ours: **`COINS_PER_WALK_POINT = 1500`**, store item `WALK_POINTS`, bought by
quantity up to 5,000 at a time.

**PRICE IT AGAINST THE BOOSTED YIELD, NOT THE BASE ONE.** The first attempt
used 350 coins, costed against a parcel's base $0.0135/yr, which looked like
a 15-year payback and was actually **3.7 years** - because a boosted parcel
earns 4.17x the base. It would have paid for itself in under four years and
profited forever after: exactly the perpetuity trap that keeps upgrades off
the store. At 1,500 the payback is 15.8 years. A test now pins it between 10
and 25 years, so **any future change to BOOST_MULTIPLIER will fail the build
until this number is moved too.**

Effect: a Regular player reinvesting for 5 years holds **220 parcels instead
of 189**, and has spent the cash that would otherwise have been $35 banked.
More land, less liability, worse pure ROI - which is the whole point.

---

## 21. TerraMine is the real peer - and a correction

**A mistake worth recording: TerraMine mines are NOT bought with real money.**
They are claimed for **100 TerraBucks earned by walking**, exactly like our
parcels. An earlier note here said otherwise and used it to excuse paying
less. That excuse was wrong. TerraMine is a true peer; Atlas Earth is the
distant one, because Atlas parcels ARE bought with cash.

| | TerraMine | Fareground |
|---|---|---|
| claim cost | **100 TB, FLAT** | 20 WP + 8 per owned, **RISING** |
| boost | up to **20x**, 30 min a go, 8h bank = **7.3x/day** | **20x**, 20 min an ad, 4h bank = **4.17x/day** |
| rare tier | Diamond ~1%, **4x** a rock | Ruby 1%, **100x** a rocky |
| visits | check in on other players' mines | pit stops on other players' land |
| cash out | PayPal, fees 0-38% | not implemented |

**The boost was reshaped because of this.** Ours had been 2x - first spread
over 6 hours, then over 24. Both were the wrong SHAPE: the genre uses a big
multiplier in short bursts, and a burst is something a player plans a walk
around where a flat 2x is wallpaper.

Now **20x for 20 minutes an ad, banking to 4 hours** - twelve ads fill it
exactly, giving 4.17x over a day. Deliberately short of TerraMine's 7.3x: at
30-minute pieces it costs $18/player/year and the pessimistic margin drops to
1.9x. This shape holds **2.7x**.

**Result:** a Regular player boosted goes $4.67 / $19.50 / $39.57 over 1, 3
and 5 years, and returns **$0.22 per hour of ad-watching** against a published
Atlas figure of ~$0.003. First payout in 6 months.

**THE TWO STRUCTURAL DIFFERENCES that remain, pulling opposite ways:**
1. **Their claim price is FLAT, ours rises.** Flat means land grows linearly
   with walking; ours grows like a square root, so they reach 1,400 mines
   where we reach a few hundred. That is the main reason their totals look
   bigger. Our rising price is what keeps us solvent without purchase
   revenue, so it stays - but it IS the trade.
2. **Our rare tier is far rarer-feeling.** Their Diamond pays 4x a Rock; our
   Ruby pays 100x a Rocky. Finding one changes your account. Keep that.

**Watch for stale wording when the multiplier changes.** "Double" was
hard-coded in `BoostSheet.tsx` and in the economy report; both now read the
multiplier from the server / from `rules.ts`.

---

## 20. The player-side rebalance (2026-09-24)

The first rebalance fixed solvency and left the player earning almost nothing.
Researched what the two comparable games actually pay:

| per parcel, per year | |
|---|---|
| Atlas Earth base | **$0.0496** |
| TerraMine average | **$0.0415** |
| TerraMine rock | $0.0342 |
| Fareground (before) | $0.0108 |
| Fareground (now) | **$0.0135**, $0.0270 boosted |

**The finding that mattered was not the base rate - it was the SHAPE.** In
both games the base rate is close to worthless and the headline earnings come
from boosts. TerraMine advertises "142 mines with **full-time boost** =
$10/month"; Atlas's active earners are described as using "badges and regular
ad watching" for $18-20/month.

Ours was 30 minutes per ad with a 4-hour bank: twelve ads bought six boosted
hours, **+25% on the day**. Feeble, and badly ALIGNED - a player could pile up
land without watching a single ad, so the people costing most paid least.

**Now 2 hours per ad with a 24-hour bank.** Twelve ads cover a full day at 2x,
so watching ads DOUBLES earnings and every one of those hours was paid for.
The 12/day cap means a boost can never do better than double.

Coin value also went 2.5M -> **2M per $1**, and the payout threshold to
**500,000 coins (still $0.25)**.

**Result:** a Regular player goes from $3.74 to **$4.68 base / $9.36 boosted**
over three years, and reaches their first payout in **6 months**. Business
margin is 2.8x at the pessimistic end - and a player who boosts all day must
watch 12 ads to do it, which is $35/yr against $6.29 of land, 5.6x.

`rules.test.ts` now holds the rival figures and two new guards: we must stay
UNDER both games per parcel (their parcels are bought with money; ours are
walked for, and ads are our only revenue) but not below a fifth of TerraMine's,
and a full day of boost ads must roughly double earnings.

**`src/game/minerals.ts` in the app carries COIN_USD by hand - it was synced.
Nothing tests that. Change both together.**

---

## 19. Settings, account deletion, community (2026-09-24)

**`app/settings.tsx`** exists mostly because two things on it are required to
ship: the **privacy policy link** (Play AND AdMob both want one reachable from
inside the app, not just the store listing) and **in-app account deletion**.
It also houses the push toggle and sign-out, which had nowhere to live.
Reached from the profile screen.

**Deletion is real, not a flag.** Every table referencing `users` cascades, so
`DELETE FROM users` removes steps, parcels, ledger, boosts, claims, reports and
push tokens in one statement. Two things to understand:

* **It frees the land.** The parcels rows go, so those squares become
  claimable by other players. That is correct - land nobody owns should not
  stay locked - but it makes deletion irreversible in a way the confirmation
  now states outright.
* `GET /user/delete` returns a SUMMARY first, so the confirmation can say
  "47 parcels, 320,000 coins" rather than something vague. A password-backed
  account must type its password; a Google-only account cannot, and the code
  says plainly why that is a weaker gate rather than pretending otherwise.

**`PRIVACY_URL` defaults to `https://play.fareground.app/privacy`, which DOES
NOT EXIST YET.** It must be live before the first Play submission. Override it
with `EXPO_PUBLIC_PRIVACY_URL`.

**`components/CommunitySheet.tsx`** - a button on the map HUD opens links to
Discord/Reddit/TikTok/Instagram. **Every URL is `null` on purpose**: a null
renders a greyed "Soon" row instead of opening a dead page. Fill them in as
the communities exist; nothing else changes.

**Expo Router trap:** adding `app/settings.tsx` made `router.push('/settings')`
a TYPE ERROR until the dev server regenerated `.expo/types/router.d.ts`. Typed
routes come from the running Metro server, so a brand-new route fails
`tsc --noEmit` until `npx expo start` has been run once.

---

## 18. Invite code at sign-up

`signUp()` in `state/session.tsx` now **returns the new token**. It has to:
redeeming an invite needs a token, and React state has not updated by the time
`await signUp(...)` returns, so the caller cannot read it from the context.

The code is redeemed AFTER the account exists, and a failure is **swallowed on
purpose** (console.warn only). The account is already made and signed in;
failing the whole sign-up over a mistyped code would be absurd, and the code
stays valid for a week so the profile screen can still take it.

Google sign-in already appeared on both tabs of the segmented control - it
creates an account on first use and signs in after, so it needs no mode.

---

## 17. The icon and the loading screen (2026-09-24)

**The mark changed.** It was an amber map pin with a ruby in it. A pin is the
most generic shape in app design - maps, delivery, dating and parking all use
one - and at 48px in a list of installed apps it was indistinguishable from
any of them. Rendering it at 48/72/96px showed the rest: the footsteps and
grid turned to mush and the sparkles read as dirt.

**It is now a cut ruby standing in a lit square of the grid.** One failed
attempt in between raised the parcel into a tall block with the gem perched on
top - at icon size that read as a **gift box with a bow**, so the gem became
the hero and the parcel went back to flat. Sized so the amber square still
glows around the gem's base: the amber is half the brand and a stone with no
ground under it is just a diamond app.

`scripts/logo.py` has a `small=True` variant for icon sizes (fewer grid lines
at double weight, no bevel, no glint) and the full mark for the splash.
**`src/components/Logo.tsx` is a hand-copy of those shapes - change both
together, nothing tests that they match.**

**NO TEXT IN THE ICON, on purpose.** The launcher prints "Fareground"
underneath already, and a word at 48px is a grey smear. The wordmark lives on
the loading screen at 40px instead.

**The wordmark IS on the icon**, at the product owner's request after being
told the trade-off. Know what it costs: at 48px "FAREGROUND" is a grey bar,
not a readable word, and making room for it took about a third off the mark.

Sizes were MEASURED, not guessed - `wordmark()` renders 776px wide at
font-size 104 on the 1024 canvas and a full 1024 at 140, which clipped both
ends. The square icon uses **122** (~910px, 57px margin each side). The
Android adaptive foreground uses **76** and sits higher up, because the safe
circle narrows the further you go from centre: at the bottom of the icon
there is only ~426px of usable width, which is why a wordmark along the
bottom of an adaptive icon gets sliced off. Not on the monochrome icon, and
not on the splash image.

The palette is the app's own `theme.ts` greens (#43806A / #2F5D50 / #143328).
An earlier pass drifted to near-black, which looked good on its own and read
as a different product next to the actual game.

**`components/LoadingScreen.tsx`** replaced two blank/spinner states (fonts
loading in `app/_layout.tsx`, session restoring in `app/(tabs)/_layout.tsx`).
Its background is `#0E2119` and **app.json's splash backgroundColor was
changed to match**, so launching goes native splash -> loading screen -> app
with no white flash.

Two React Compiler traps it hit:
 * `useReducedMotion` is a **react-native-reanimated** hook, not a React
   Native one. The platform API is `AccessibilityInfo`, and it needs a read
   AND a subscription.
 * `useRef(new Animated.Value(0)).current` then `.interpolate()` in render is
   a lint ERROR ("cannot access refs during render"). Hold the Animated.Value
   in `useState(() => ...)` instead.

`wordmark={false}` exists for the font-loading moment: Nunito is exactly what
has not arrived, so the name would render in the system font and jump.

---

## 16. Profile photos (backend done, app UI pending)

The product owner asked for real uploaded photos, overriding the original
"no photos anywhere - nothing to host, nothing to moderate" decision. Built
WITH the machinery that makes that defensible.

* `POST /profile/photo { image, adNonce }` - base64 JPEG/PNG. **Changing your
  picture costs one rewarded ad** (`PHOTO` kind). The ad is spent only AFTER
  the image validates and is stored, so a rejected file leaves the ticket.
* `DELETE /profile/photo` - going back to your initial. Free.
* `POST /profile/report { username, reason, note? }` - one OPEN report per
  reporter per subject, enforced by a partial unique index.
* `GET /photos/<random>.jpg` - served by express.static from `uploads/avatars`.
* `photoUrl` now rides along in **balance, leaderboard rows and profiles**.

**The phone resizes to ~256x256 JPEG before uploading**, so the server needs
no image library. It verifies the MAGIC BYTES, not the declared type, and
rejects everything that is not a plain JPEG/PNG - SVG included, because an SVG
is a document that can carry script. Filenames are random hex: another
player's photo URL must not be guessable.

**App side done too.**
* `components/PlayerPicture.tsx` - photo, else the **first letter of the name
  on a colour derived from the name itself** (so a player is the same colour
  on every device, which is what makes a leaderboard scannable). A photo that
  404s falls back to the initial rather than leaving a hole.
* It replaced `AvatarPortrait` in the **map HUD, walk tab and leaderboard**.
  The character avatar stays where there is room for it: the profile, the
  editor, and the runner on the map - so runner and portrait still match.
* `native/photo.ts` picks and prepares. **SDK 57 API traps:**
  `manipulateAsync` is DEPRECATED, `MediaTypeOptions` is gone (use
  `mediaTypes: ['images']`), and `manipulate()` hangs off
  `ImageManipulator.manipulate`, NOT the module namespace.
* The editor picks the image FIRST and asks for the ad second - watching an ad
  and then cancelling out of the photo library would waste it.
* "Report this picture" sits on other players' profiles, with fixed reasons.

**Needs a rebuild:** `expo-image-picker` and `expo-image-manipulator` are
native. `PlayerPicture` deliberately uses React Native's own `Image` rather
than `expo-image`, so the initial-and-photo display works on the OLD build -
only uploading needs the new one.

**WHAT IS NOT DONE, and matters:** there is no automated scanning and no admin
UI. Every report lands in `photo_reports` for a human to look at, and
`removePhotoAsModerator()` is the takedown. Google Play requires report +
remove + block for user images; report and remove exist, block does not.
Budget for an image-moderation API before this has more than a handful of
players.

---

## 15. Pit stops (replacing place visits)

Backend done, app UI still to build. `POST /pitstops`, `GET /pitstops?lat&lng`,
`services/pitstop.service.ts`, migration 018, constants in `rules.ts`.

A visit rewarded "I was in this ~250 m square". A **pit stop** rewards "I stood
on THIS parcel", which puts other players' land on your route.

| rule | value | why |
|---|---|---|
| neighbour's land | 5 WP | the behaviour worth paying for |
| your own land | 2 WP | so a player with no neighbours is not locked out |
| first time on a parcel | +4 WP | exploring beats a fixed circuit |
| same parcel again | 24 h | stops two players farming each other forever |
| between any two stops | 5 min | **an ad skips it**; this is the revenue |

**The global cooldown is checked under the `FOR UPDATE` lock on the user row**,
not with a plain SELECT - otherwise two phones on one account both read
"expired" and both collect. The ad ticket is spent only once the stop is
certain, so a refusal (parcel already paid today) rolls back with the ticket
intact for the next parcel along.

The old `checkins` table is untouched: it holds real history and the streak
query reads it. Pit stops are a new table beside it.

**App UI done too.** `components/PitStopCard.tsx` replaced the visit row in
`DailySheet`. Two clocks show at once - the shared 5-minute one and each
parcel's own 24 hours - and the button speaks to whichever is blocking.

Two traps hit while building it, both worth remembering:
 * **`Date.now()` in a render body is a lint ERROR** (React Compiler purity).
   The cooldown deadline is resolved when the status arrives and kept in
   state. A countdown computed in render restarts on every re-render anyway.
 * **`src/game/minerals.ts` is a hand-copy of the backend's rates** and had
   silently drifted after the rebalance (RUBY still 40, coin still 1e-6).
   Nothing catches this - unlike `grid.ts`, there is no test comparing them.
   **Change both together.**

The place-visit endpoints still exist server-side; they just have no button.

**A tool worth knowing about:** `npx tsx src/scripts/economy-report.ts` in the
backend prints every rate, what WP buys, and the cost-per-player projections
at four play intensities. Run it after ANY rate change.

---

## 14. The 2026-09-23 rebalance

The player said earning potential money looked too easy. It was: a maxed-out
player (202 WP/day) cost **$3.65/yr of land in year one and $6.37 by year
three**, against roughly $9-11/yr of ad revenue. Under 2x margin is no margin.

Three changes, chosen so the cut lands where it is least felt:

| | before | after |
|---|---|---|
| coin value | 1,000,000 = $1 | **2,500,000 = $1** |
| parcel price step | +5 WP per parcel owned | **+8 WP** |
| RUBY rate | 40 coins/hr | **100 coins/hr** |
| payout threshold | 1,000,000 coins | **2,500,000** (still $1) |
| USD display decimals | 6 | **7** (a coin must stay visible) |

Result: year one **$3.65 -> $1.44**, year three **$6.37 -> $2.51**. Parcels
held in year one 168 -> 133.

**Why RUBY went UP.** Recutting the coin alone would have taken 60% off every
tier including the one-in-a-hundred find, which is the whole reason to keep
claiming. So the cut lands on the four common tiers and RUBY is raised to come
out at exactly the $0.3504/yr it was worth before. The ladder widens from 40x
to 100x - the existing test "our top tier is generous next to Atlas, our
bottom tier is not" encodes that principle and it still passes.

**Coin counts were not touched.** The balance climbs at the same speed and the
counter ticks the same; only the dollar figure at the edge moved. Trimming the
chest or the quests instead would have been felt on every screen.

Needs migration 017 (a CHECK constraint pins each rarity's rate).

---

## 13. Round 9 (2026-09-23), in detail

**Renamed Walkscape -> Fareground.** The old name is Not a Cult Oy's registered
trademark in the same classes. Everything renamed except the Postgres database,
which is still `walkscape` on purpose. Android package is now
`com.fareground.app`, so the next build is a new app identity.

**The Expo `slug` is deliberately still `walkscape`.** Expo's own docs are
explicit: "A project ID is associated with a single slug, which cannot be
changed." Renaming it locally breaks every build with a slug-mismatch error,
so it was put back. The slug is EAS's internal identifier only - it is NOT the
app's name on the phone (`name: "Fareground"`), its package
(`com.fareground.app`), or its deep-link scheme (`fareground`). **Do not
"fix" it.** The only way to get a `fareground` slug is `eas project:init` on a
new project, which mints a new projectId AND a new Android keystore - worth
doing before the Google OAuth client is set up (it needs the keystore's
SHA-1), and pointless after.
Domain plan: `fareground.app`, site at `play.fareground.app`.

**Forced ads removed.** Interstitial and app-open are gone - code, config, call
sites and ad units. Every ad in the game is now opt-in. `ads.tsx` went 178 -> 93
lines. Rewarded ads are untouched, and `rules.test.ts` already showed ~3
rewarded ads a day funds the land, so the economy still stands up.

**Push notifications.** Three messages, all in the player's local time, at most
one kind per person per local day, nothing outside 09:00-21:00:
`STREAK_RISK` (evening, their streak dies at midnight), `CHEST_READY`
(morning), `COMEBACK` (away 3+ days, with an estimate of the coins piled up -
read-only, it never settles, because settling would move the income clock).
Runs on a 5-minute in-process timer under `pg_try_advisory_lock`, started in
`index.ts` and stopped on shutdown. `expo-notifications` is loaded through
`optional.ts` like every other native module, so an older build just has it off.

**Neighbours.** New Land-tab card: how many other players own land around here
and, when there are enough of them to stay anonymous, who. See the privacy
constraints in §4.

**Visits: finer places.** ~1 km squares became ~250 m (`PLACE_SCALE = 400` in
`rules.ts`). This fixes the real complaint: the park and the station were the
same "place", so a genuine second visit was refused.

**Sign-up screen rebuilt.** A segmented Sign in / Create account control, the
signup bonus promoted to a real card, per-field validation mirroring the
server's `registerSchema` (so nobody waits for a round trip to learn a username
cannot have spaces), a show/hide password toggle, keyboard flow between fields,
and the permissions explained before they are asked for.
**It also fixed a live bug:** the brand was written `Walk<Text>scape</Text>`,
split across two JSX nodes, so the rename pass missed it and the screen still
said the old name. Worth remembering if anything else was ever split that way.
