# Fareground — mobile app

Expo SDK 57 · React Native 0.86 · TypeScript · Expo Router · MapLibre.

Walk to earn Walk Points, then claim the real-world square you are standing on.
Talks to the backend in `../fareground-backend`.

## What is here

| Screen | What it does | Backend |
| --- | --- | --- |
| Sign in | Create an account or sign in. Token kept in the Keychain / Keystore. | `/auth/*` |
| **Map** | Real street map, tilted 55°, with the parcel grid drawn on it. Claimed squares rise out of the map as blocks, taller for rarer minerals. Your explorer stands on your GPS position. **Claim Land** takes the square under you. | `/parcels/claim`, `/parcels/nearby`, `/user/balance` |
| Walk | Today's steps, sync status, progress to the next parcel. | `/steps/sync` |
| Land | Everything you own. | `/parcels` |

Drag to pan, two fingers to **rotate and tilt** — the map SDK does that natively.

## Running it

**This app cannot run in Expo Go.** MapLibre is a native module, so you need a
*development build* — your own copy of the app with the native code compiled in.
Do this once; after that, code changes reload instantly as normal.

### 1. Point the app at the backend

```bash
cp .env.example .env.local
```

Edit `.env.local` and set `EXPO_PUBLIC_API_URL` to your computer's LAN address
(`ipconfig` → IPv4 Address), e.g. `http://192.168.1.20:3000`. The phone must be
on the same Wi-Fi, and Windows Firewall must allow Node on port 3000 — it will
usually ask the first time.

### 2. Make a development build

Either in the cloud, with no Android Studio or Mac needed:

```bash
npx eas-cli@latest build --profile development --platform android
```

…then install the build on your phone from the link it gives you. (First run
asks you to log in to a free Expo account and creates `eas.json`.)

Or locally, if you have Android Studio installed:

```bash
npm run android
```

iOS builds need either EAS or a Mac with Xcode.

### 3. Start it

```bash
npm start
```

Open the Fareground dev build on your phone; it finds the dev server.

## Checks

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run doctor
```

All three pass, and a full Android bundle (`npx expo export --platform android`)
builds. The API client and grid code have also been driven end-to-end against
the live backend. **The UI itself has not been run on a device yet** — that is
the first thing to do with a dev build.

## Things to know

**The grid is shared code.** `src/game/grid.ts` is a byte-for-byte copy of the
backend's. The phone uses it to draw the grid and to highlight the square you
are on; the server uses it to decide which square you claimed. If they ever
disagreed you would be shown one square and given another — so the backend's
test suite fails if the two files differ. Change it there, copy it here.

**Step counting differs by platform.**
- **iOS** reads the phone's motion history, so steps walked with the app
  closed count.
- **Android** only counts while the app is open (`getStepCountAsync` is
  iOS-only in Expo SDK 57). Background steps on Android need Health Connect —
  the next piece of work.

**Syncing survives a dead network.** Each batch of steps is written to storage
with its idempotency key *before* it is sent, and only forgotten once the server
answers. Kill the app mid-request and the same batch is retried with the same
key on next launch, so it is never paid twice and never lost.

**Map tiles** come from [OpenFreeMap](https://openfreemap.org) — free, no key,
built on OpenStreetMap. The attribution control must stay on.

**Development only:** `usesCleartextTraffic` is on in `app.json` so the app can
reach a plain-`http` backend on your LAN. Turn it off and use HTTPS before any
release build.

## Not done yet

- **3D character model.** The explorer is an SVG stand-in pinned to your
  position. The 3D version wants a real rigged `.glb` asset and `expo-gl`.
- **Android background steps** via Health Connect.
- **The claim reveal** is a slide-up sheet, not yet the full moment from the
  design mockups.
- **Custom fonts.** System fonts for now.
- **GPS-spoofing checks.** The app already reads Android's mock-location flag
  (`useLocation` returns `mocked`) but does not send it yet, and the server has
  no travel-versus-steps check. Both are needed before coins are redeemable.
