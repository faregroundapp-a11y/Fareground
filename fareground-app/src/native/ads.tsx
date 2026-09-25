import { ADMOB_UNITS } from '@/config';
import { optional } from './optional';

/**
 * Everything to do with ads, in one place.
 *
 *   rewarded      the player CHOOSES to watch, for a boost, bonus WP, a
 *                 cosmetic, an upgrade and so on
 *
 * EVERY ad in Fareground is opt-in. There are no banners, no interstitials
 * after a claim, and no ad when you open the app - all three were removed on
 * purpose. An ad is never the price of playing; it is only ever something the
 * player trades half a minute for, knowing exactly what they get back.
 *
 * Consent comes first: Google's UMP form is shown where the law requires it
 * (EU/UK), and no ad is requested until it has been answered.
 */
type Ads = typeof import('react-native-google-mobile-ads');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: an import would crash builds without the native module (see optional.ts)
const A = optional<Ads>(() => require('react-native-google-mobile-ads'), 'RNGoogleMobileAdsModule');

const rewardedUnit = () => ADMOB_UNITS.rewarded ?? (A ? A.TestIds.REWARDED : '');

/**
 * Are we on Google's test ad units?
 *
 * True whenever no real unit id has been configured, which is every
 * development and tester build. Test units always return a filled test ad,
 * so nothing about consent or fill rate applies to them.
 */
const usingTestAds = () => !ADMOB_UNITS.rewarded;

let ready: Promise<boolean> | null = null;

/**
 * Ask for consent where needed, then start the SDK. Safe to call repeatedly.
 *
 * ON TEST UNITS, CONSENT IS SKIPPED ENTIRELY. This matters for testers: the
 * UMP form appears in the EU and UK, and anyone who declines it lands with
 * `canRequestAds === false`, which turned EVERY ad in the game into "No ad is
 * available right now" for ever, with nothing on screen explaining why. On a
 * build serving Google's test ads there is nothing to consent to - no real
 * ad is requested and no data goes anywhere - so the form is pure
 * obstruction. The real consent flow still runs the moment a real unit id is
 * configured, which is the only time it is legally required.
 */
export function initAds(): Promise<boolean> {
  if (!A) return Promise.resolve(false);
  ready ??= (async () => {
    try {
      if (usingTestAds()) {
        await A.default().initialize();
        return true;
      }
      const consent = await A.AdsConsent.gatherConsent();
      if (!consent.canRequestAds) return false;
      await A.default().initialize();
      return true;
    } catch {
      // No consent form available (offline, or not configured) - the SDK
      // still works where consent is not legally required.
      try {
        await A.default().initialize();
        return true;
      } catch {
        return false;
      }
    }
  })();
  return ready;
}

export const adsAvailable = () => A !== null;

export type RewardedOutcome = 'earned' | 'closed' | 'unavailable';

/**
 * Load and show a rewarded ad. Resolves once it is closed.
 *
 * `ssv` goes to Google, which passes it back to our server in the signed
 * verification callback - that is how the server knows WHICH reward ticket
 * this ad was for, and that it really was watched to the end.
 */
export async function showRewarded(ssv: { userId: string; customData: string }): Promise<RewardedOutcome> {
  if (!A || !(await initAds())) return 'unavailable';
  const ad = A.RewardedAd.createForAdRequest(rewardedUnit(), {
    serverSideVerificationOptions: ssv,
  });

  return new Promise<RewardedOutcome>((resolve) => {
    let earned = false;
    let settled = false;
    const subs: (() => void)[] = [];
    const done = (outcome: RewardedOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subs.forEach((off) => off());
      resolve(outcome);
    };
    // No fill within 15 s - give up rather than leave a spinner forever.
    const timeout = setTimeout(() => done('unavailable'), 15_000);

    subs.push(
      ad.addAdEventListener(A.RewardedAdEventType.LOADED, () => {
        clearTimeout(timeout);
        ad.show().catch(() => done('unavailable'));
      }),
      ad.addAdEventListener(A.RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
      ad.addAdEventListener(A.AdEventType.CLOSED, () => done(earned ? 'earned' : 'closed')),
      ad.addAdEventListener(A.AdEventType.ERROR, () => done('unavailable')),
    );
    ad.load();
  });
}
