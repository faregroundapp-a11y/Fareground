# Why `overrides` exists in package.json

## react-native-worklets: 0.13.0

**Added 2026-09-24, after two EAS builds failed in the Install dependencies
phase with:**

```
npm ci can only install packages when your package.json and
package-lock.json are in sync.
Missing: react-native-worklets@0.10.4 from lock file
```

### The conflict

Two packages in SDK 57 disagree, and the ranges do not overlap at all:

| package | comes from | needs `react-native-worklets` |
|---|---|---|
| `expo-modules-core@57.0.19` | `expo@57.0.25` | `^0.7.4 \|\| ^0.8.0 \|\| ^0.9.0 \|\| ^0.10.0` |
| `react-native-reanimated@4.7.0` | `expo-router@57.0.23` | `0.13.x` |

`expo@57.0.25` is the newest 57.x, and there is no `expo-modules-core`
newer than 57.0.19 - so this cannot be resolved by updating. It is stale
peer metadata upstream: Expo ship reanimated 4.7 / worklets 0.13 in SDK 57
themselves, and `expo-modules-core`'s range simply was not refreshed.

### Why it only failed on the builder

**npm 11 locally and the builder's npm resolve it differently.** Locally npm
prints `ERESOLVE overriding peer dependency`, keeps the single hoisted
0.13.0, and writes a lockfile with one worklets entry. The builder's npm
instead decides it needs a SECOND, nested copy at 0.10.4 to satisfy
`expo-modules-core` - and that entry is not in the lockfile, so `npm ci`
refuses.

So the lockfile was never wrong in a way any local command could show. This
is why `npm ci` passed here and failed there.

### Why 0.13.0 and not 0.10.x

0.13.0 is the version `react-native-reanimated@4.7.0` actually wants, and
reanimated is the package that USES worklets heavily. Forcing 0.10.x to
satisfy `expo-modules-core` instead would pair reanimated 4.7 with a worklets
it declares incompatible - trading a build error for a runtime one.

### When to remove this

Delete the `overrides` block and run `npm install` once `expo-modules-core`
widens its peer range to include `0.13.x` (i.e. on the next SDK bump). Check
with:

```bash
npm view expo-modules-core peerDependencies.react-native-worklets
```

### The check that catches this class of bug

EAS runs `npm ci --include=dev`. Plain `npm ci` is NOT the same test and
passes when the build will fail. After any dependency change:

```bash
npm ci --include=dev
```

---

# Why `react-native-google-mobile-ads` is pinned EXACTLY

`"react-native-google-mobile-ads": "17.0.0"` - no caret.

**17.1.0 breaks the Android build:**

```
Build file 'node_modules/react-native-google-mobile-ads/android/build.gradle' line: 115
> Cannot get property 'googleMobileAdsJson' on extra properties extension as it does not exist
> project ':react-native-google-mobile-ads' does not specify `compileSdk`
```

This surfaced because a lockfile was deleted and regenerated, which let the
caret float 17.0.0 -> 17.1.0. Nothing about the app changed; the dependency
moved underneath it.

**Before un-pinning, check the library's own Expo config-plugin docs** - 17.1
appears to expect its configuration somewhere this project does not currently
put it. Bump it deliberately, with a build to prove it, not as a side effect
of a lockfile regeneration.

---

# The lesson, for whoever hits the next one of these

**DO NOT delete `package-lock.json` to fix a dependency problem.** It floats
every caret range at once: that one act moved 32 packages, including
`react-native-google-mobile-ads` (which broke Gradle), `zod` 3 -> 4,
`resolve` 1 -> 2 and `hermes-parser` 0.35 -> 0.25. Chasing one failure
created a different one.

**The builder is Node 22 / npm 10; this machine is Node 24 / npm 11, and they
resolve peers differently.** That is why local checks passed while builds
failed. The check that actually reproduces the builder:

```bash
npx --yes npm@10.9.4 ci --include=dev
```

Run that in a scratch copy of `package.json` + `package-lock.json` after any
dependency change. It takes about a minute; an EAS build takes fourteen.
