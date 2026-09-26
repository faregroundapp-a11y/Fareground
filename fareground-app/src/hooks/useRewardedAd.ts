import { useCallback, useState } from 'react';
import { ApiError, api } from '@/api/client';
import type { AdRewardKind } from '@/api/types';
import { showRewarded } from '@/native/ads';
import { haptics } from '@/native/haptics';
import { useSession } from '@/state/session';

export type RewardResult =
  | { ok: true; kind: AdRewardKind; amount: number; nonce: string }
  | { ok: false; message: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Watch a rewarded ad for a boost or bonus WP.
 *
 *   1. Ask the server for a ticket. Caps are checked HERE, so nobody sits
 *      through an ad that cannot pay out.
 *   2. Show the ad, handing Google the ticket for its signed callback.
 *   3. Ask the server whether it paid. In production the grant comes from
 *      Google's callback and can take a moment, so this polls briefly.
 */
/**
 * ONE AD AT A TIME, ACROSS THE WHOLE APP - and a moment's pause after each.
 *
 * Every sheet has its own copy of this hook, so a per-hook `busy` flag let
 * two sheets start ads at once. Worse: when an ad closes, the tap that closed
 * it can land on whatever button is now under the finger - and a sheet that
 * just re-rendered can have slid its big "Double it" button right there.
 * Testers saw exactly that: a bonus-WP ad, then the chest doubled "by
 * itself". So: a lock shared by every caller, and no new ad for a second
 * after the last one closed.
 */
let adInFlight = false;
let lastAdEndedAt = 0;
const AFTER_AD_PAUSE_MS = 1_200;

export function useRewardedAd(onGranted?: () => void) {
  const { token } = useSession();
  const [busy, setBusy] = useState<AdRewardKind | null>(null);

  const watch = useCallback(
    async (
      kind: AdRewardKind,
      extra?: { targetClaimId?: string; cosmeticKey?: string; targetParcelId?: string },
      /** Where the player is - a treasure box needs somewhere to appear. */
      at?: { lat: number; lng: number } | null,
    ): Promise<RewardResult> => {
      if (!token || busy || adInFlight || Date.now() - lastAdEndedAt < AFTER_AD_PAUSE_MS) {
        return { ok: false, message: 'Please wait a moment.' };
      }
      adInFlight = true;
      setBusy(kind);
      haptics.press();
      try {
        const ticket = await api.startReward(token, kind, extra);
        const outcome = await showRewarded({ userId: ticket.userId, customData: ticket.nonce });
        if (outcome === 'unavailable') {
          return { ok: false, message: 'No ad is available right now. Try again in a minute.' };
        }
        if (outcome === 'closed') {
          return { ok: false, message: 'Watch the ad to the end to get the reward.' };
        }
        // The ticket's nonce is returned too, for rewards that are SPENT
        // later (an extra check-in is paid for by its ad).
        for (let i = 0; i < 8; i++) {
          const res = await api.completeReward(token, ticket.nonce, at);
          if (res.granted) {
            haptics.success();
            onGranted?.();
            return { ok: true, kind, amount: res.amount ?? 0, nonce: ticket.nonce };
          }
          await wait(1500);
        }
        onGranted?.(); // it may still land; the next balance poll will show it
        return { ok: false, message: 'Your reward is on its way - it can take a minute to appear.' };
      } catch (e) {
        haptics.warn();
        return { ok: false, message: e instanceof ApiError ? e.message : 'Something went wrong. Please try again.' };
      } finally {
        adInFlight = false;
        lastAdEndedAt = Date.now();
        setBusy(null);
      }
    },
    [token, busy, onGranted],
  );

  return { watch, busy };
}
