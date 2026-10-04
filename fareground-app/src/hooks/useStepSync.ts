import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ApiError, api } from '@/api/client';
import type { StepSyncResult } from '@/api/types';
import { haptics } from '@/native/haptics';
import {
  healthStatus,
  installHealthConnect,
  readStepsBetween,
  readStepsToday,
  requestHealthPermission,
  stepSources,
  type HealthStatus,
  type StepSources,
} from '@/native/healthSteps';
import { registerBackgroundStepSync } from '@/native/backgroundSteps';
import { appleStepsBetween } from '@/native/appleHealth';
import { onStepSetupChanged } from '@/native/stepEvents';
import { useSession } from '@/state/session';
import { startWalkTrace, takeTraceQuality, takeWalkDistance } from '@/native/walkTrace';

/**
 * Turning steps on the phone into Walk Points on the server.
 *
 * THE PROBLEM THIS SOLVES
 * The server only accepts DELTAS ("I walked 340 more steps"), and phones lose
 * network constantly. A client that retries a failed sync as a fresh request
 * pays the player twice; one that gives up loses their steps. So:
 *
 *   1. Before sending, write the pending batch - its steps AND a new
 *      idempotency key - to storage.
 *   2. Send it. On a network failure keep it, and retry later with the SAME
 *      key. The server recognises the key and replays the first answer.
 *   3. Only once the server has answered do we forget the batch.
 *
 * WHERE STEPS COME FROM
 * - iOS: Pedometer.getStepCountAsync(midnight, now) reads the motion
 *   coprocessor's history, so steps walked with the app CLOSED count.
 * - Android: Health Connect, the phone's shared health store, which fitness
 *   apps and the phone itself fill all day. Also closed-app steps.
 *   Alongside it, the live step sensor counts while the app is open, so a
 *   phone with no Health Connect data source still earns.
 *
 * Both Android sources measure the SAME walking, so they are never added
 * together: today's total is the LARGER of the two. That can never
 * double-count, and picks whichever source saw more.
 *
 * MIDNIGHT. The phone's counters restart at midnight. Whatever was walked
 * after the last sync of the day is picked up on the next sync ("carry"), by
 * reading yesterday's final total.
 */

const SYNC_EVERY_MS = 60_000;
const DEVICE_KEY = 'fareground.deviceId';
const LEDGER_KEY = 'fareground.stepLedger';

interface StepLedger {
  /** Local calendar day these counters belong to, e.g. "2026-09-21". */
  day: string;
  /** Today's total already handed to a batch. */
  syncedToday: number;
  /** Android: steps the live sensor counted in-app today. */
  appToday: number;
  /** Steps owed from an earlier day, sent with the next batch. */
  carry: number;
  /** A batch in flight. Survives app restarts so its key is reused. */
  pending: { key: string; steps: number; days?: DayTotal[] } | null;
  /**
   * Finished days' totals not yet sent, so the server can check them against
   * its own record (it pays only what is above what it has already seen).
   */
  closedDays?: DayTotal[];
  /** Older app versions kept an "unsent" counter; folded into carry once. */
  unsent?: number;
  /** Ledger format. Version 1 counted Android steps differently. */
  v?: number;
  /**
   * Set when upgrading from version 1 on Android: today's steps up to now
   * were already paid by the old in-app counter, so the first Health Connect
   * reading is a baseline, not new steps. Stops a one-off double payment.
   */
  needsBaseline?: boolean;
}

/** The phone's own step total for one local day. */
interface DayTotal {
  day: string;
  total: number;
}

function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const today = () => dayOf(new Date());

function startOfDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

async function loadLedger(): Promise<StepLedger> {
  const raw = await AsyncStorage.getItem(LEDGER_KEY);
  const fresh: StepLedger = { day: today(), syncedToday: 0, appToday: 0, carry: 0, pending: null, v: 2 };
  if (!raw) return fresh;
  const saved = { ...fresh, ...(JSON.parse(raw) as Partial<StepLedger>) };
  if (saved.v !== 2) {
    saved.v = 2;
    saved.needsBaseline = Platform.OS === 'android';
  }
  if (saved.unsent) {
    saved.carry += saved.unsent;
    delete saved.unsent;
  }
  return saved;
}

/**
 * Close out a finished day: anything walked but never synced becomes carry.
 * `finalTotal` is that day's full count from the phone, when known.
 */
function rollOver(ledger: StepLedger, finalTotal: number | null) {
  const total = Math.max(finalTotal ?? 0, ledger.appToday);
  ledger.carry += Math.max(0, total - ledger.syncedToday);
  ledger.closedDays = [...(ledger.closedDays ?? []), { day: ledger.day, total }].slice(-7);
  ledger.day = today();
  ledger.syncedToday = 0;
  ledger.appToday = 0;
}

/**
 * Every read-modify-write of the ledger goes through this queue.
 *
 * Without it, two writers (the Android step callback and the sync timer)
 * can both load the ledger, each change it, and the second save silently
 * overwrites the first - and those steps are gone. The network request is
 * deliberately NOT made inside the lock, so a slow connection never stalls
 * step counting.
 */
let ledgerQueue: Promise<unknown> = Promise.resolve();
function withLedger<T>(mutate: (ledger: StepLedger) => T | Promise<T>): Promise<T> {
  const run = ledgerQueue.then(async () => {
    const ledger = await loadLedger();
    const result = await mutate(ledger);
    await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    return result;
  });
  ledgerQueue = run.catch(() => undefined);
  return run;
}

/** A stable id for this install, so the server can tell your phones apart. */
async function deviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await AsyncStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** The phone's own count for a whole past day, or null if unknown. */
async function phoneTotalForDay(day: string): Promise<number | null> {
  const start = startOfDay(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  try {
    if (Platform.OS === 'ios') return await iosStepsBetween(start, end);
    return await readStepsBetween(start, end);
  } catch {
    return null;
  }
}

/**
 * Is the phone reporting a mocked location?
 *
 * Android exposes this on every fix and a spoofed GPS alongside a big step
 * count is the clearest signal there is. Sent purely as EVIDENCE - the server
 * records it and never refuses a sync over it, because a mock location has
 * innocent explanations (a developer, some car mounts, some VPNs).
 *
 * Uses the last known fix only: waking the GPS every minute to answer a
 * question nobody is blocked on would cost real battery.
 */
/**
 * iPhone steps: the HIGHER of Apple Health and the phone's own motion history.
 *
 * Apple Health includes every watch and tracker the player owns, merged by
 * Health itself - the way outside gadgets count on iOS (native/appleHealth.ts).
 * The motion history is only what the phone felt, but it needs no Health
 * permission, and iOS never says whether Health reading was allowed. Taking
 * the higher of the two means connecting a watch can only ever add steps.
 */
async function iosStepsBetween(start: Date, end: Date): Promise<number | null> {
  const [phone, health] = await Promise.all([
    Pedometer.getStepCountAsync(start, end).then((r) => r.steps).catch(() => null),
    appleStepsBetween(start, end),
  ]);
  if (phone === null && health === null) return null;
  lastIosFromHealth = (health ?? 0) > (phone ?? 0);
  return Math.max(phone ?? 0, health ?? 0);
}
/** Whether the last iPhone total came from Apple Health (a watch) rather than the phone. */
let lastIosFromHealth = false;

async function mockedLocation(): Promise<boolean | undefined> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return undefined;
    const fix = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
    return fix ? fix.mocked === true : undefined;
  } catch {
    return undefined;
  }
}

/** The phone's own count since midnight: iOS motion history or Health Connect. */
async function phoneTotalToday(): Promise<number | null> {
  try {
    if (Platform.OS === 'ios') return await iosStepsBetween(startOfDay(today()), new Date());
    return await readStepsToday();
  } catch {
    return null;
  }
}

/**
 * ONE STEP SYNC: read the phone's count, decide the batch, write it down,
 * send it. Shared by the app (useStepSync) and the background task
 * (native/backgroundSteps.ts), so a closed-app sync is exactly the same code
 * as an open-app one - idempotency key and all, which is what makes two of
 * them racing harmless: the server replays the first answer.
 *
 * Throws on failure; a batch the server refused outright is dropped first,
 * since retrying it cannot help.
 */
export async function runStepSync(
  token: string,
  opts: { background?: boolean; onTotal?: (total: number) => void } = {},
): Promise<{ total: number; result: StepSyncResult | null }> {
  try {
    // 0. A new day? Read yesterday's final total first (outside the lock).
    const before = await loadLedger();
    const yesterdayTotal = before.day !== today() ? await phoneTotalForDay(before.day) : null;

    // Read the phone's own count, outside the lock.
    const phoneTotal = await phoneTotalToday();

    // 1. Decide the batch and WRITE IT DOWN before anything is sent.
    const { batch, total } = await withLedger((ledger) => {
      if (ledger.day !== today()) rollOver(ledger, yesterdayTotal);
      // A batch left over from an older app version has no day totals, and
      // the server now refuses those (it is the replayable kind) - which
      // would show "Time to update" on the newest build. Drop it: its steps
      // are inside today's total, which the next batch reports, and the
      // server pays whatever it has not seen.
      if (ledger.pending && !ledger.pending.days) ledger.pending = null;
      const dayTotal = Math.max(phoneTotal ?? 0, ledger.appToday);
      if (ledger.needsBaseline) {
        ledger.syncedToday = Math.max(ledger.syncedToday, dayTotal);
        ledger.needsBaseline = false;
      }
      if (!ledger.pending) {
        const fresh = Math.max(0, dayTotal - ledger.syncedToday) + ledger.carry;
        ledger.syncedToday = Math.max(ledger.syncedToday, dayTotal);
        ledger.carry = 0;
        if (fresh > 0) {
          // The server decides what is new from these totals and its own
          // record, so a ledger wiped by clearing the app's data (which
          // makes `fresh` the whole day again) is not paid twice.
          const days = [...(ledger.closedDays ?? []), { day: ledger.day, total: dayTotal }];
          ledger.pending = { key: Crypto.randomUUID(), steps: fresh, days };
          ledger.closedDays = [];
        }
      }
      return { batch: ledger.pending, total: dayTotal };
    });
    opts.onTotal?.(total);
    if (!batch) return { total, result: null };

    // 2. Send it - no lock held.
    //
    // WHERE THE COUNT CAME FROM. iOS history is written only by the OS.
    // On Android, Health Connect is a shared store that ANY app can write
    // into (including a fake-steps app), so a count sourced from it is
    // weaker evidence than the live sensor. `total` is the larger of the
    // two, so whichever one produced it is the one to name.
    // On iPhone a total that came from Apple Health is a store count like
    // Health Connect's: written by a watch, often late.
    const source =
      Platform.OS === 'ios'
        ? lastIosFromHealth
          ? 'HEALTH_STORE'
          : 'MOTION_HISTORY'
        : phoneTotal !== null && phoneTotal >= total
          ? 'HEALTH_STORE'
          : 'DEVICE_SENSOR';

    // HOW FAR THE GROUND ACTUALLY MOVED over the same window. This is
    // what separates walking from a shaken phone: the step signal is
    // identical, the displacement is not. Taken (and reset) only when a
    // batch is actually being sent, so a failed send does not discard it.
    // Order matters: straightness is measured against the path length,
    // which takeWalkDistance clears.
    //
    // In the BACKGROUND there is no trace - the GPS is not being followed -
    // and none is sent. The server treats "no trace" as "cannot tell", not
    // as zero, so an honest closed-app walk is never capped for it.
    const quality = opts.background ? undefined : takeTraceQuality();
    const walked = opts.background ? undefined : takeWalkDistance();

    const result = await api.syncSteps(
      token,
      {
        steps: batch.steps,
        ...(batch.days ? { days: batch.days } : {}),
        platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        deviceId: await deviceId(),
        source,
        mockedLocation: opts.background ? undefined : await mockedLocation(),
        ...(walked === undefined ? {} : { distanceM: walked }),
        ...(quality === undefined ? {} : { trace: quality }),
      },
      batch.key,
    );

    // 3. Delivered (or replayed). Only now forget it - and only if it is
    //    still the same batch.
    await withLedger((ledger) => {
      if (ledger.pending?.key === batch.key) ledger.pending = null;
    });
    return { total, result };
  } catch (e) {
    if (e instanceof ApiError && !e.retryable) {
      // The server refused this batch outright; retrying cannot help.
      await withLedger((ledger) => {
        ledger.pending = null;
      });
    }
    throw e;
  }
}

export interface StepSyncState {
  /** Can this phone count steps at all? null while checking. */
  available: boolean | null;
  /** Android: is Health Connect set up (for steps walked with the app closed)? */
  health: HealthStatus;
  stepsToday: number | null;
  lastResult: StepSyncResult | null;
  lastSyncedAt: Date | null;
  error: string | null;
  /** Android: which apps are feeding Health Connect steps. null = unknown. */
  sources: StepSources | null;
  /** True while a sync the player asked for is running. */
  syncing: boolean;
}

export function useStepSync(onSynced?: () => void) {
  const { token } = useSession();
  const [state, setState] = useState<StepSyncState>({
    available: null,
    health: Platform.OS === 'ios' ? 'ready' : 'unsupported',
    stepsToday: null,
    lastResult: null,
    lastSyncedAt: null,
    error: null,
    sources: null,
    syncing: false,
  });
  const busy = useRef(false);
  const onSyncedRef = useRef(onSynced);
  useEffect(() => {
    onSyncedRef.current = onSynced;
  }, [onSynced]);

  const syncNow = useCallback(async () => {
    if (!token || busy.current) return;
    busy.current = true;
    try {
      const { result } = await runStepSync(token, {
        onTotal: (total) => setState((s) => (s.stepsToday === total ? s : { ...s, stepsToday: total })),
      });
      if (!result) return;
      if (result.wpEarned > 0 && !result.replayed) haptics.success();
      setState((s) => ({ ...s, lastResult: result, lastSyncedAt: new Date(), error: null }));
      onSyncedRef.current?.();
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Step sync failed.' }));
    } finally {
      busy.current = false;
    }
  }, [token]);

  /** Android: ask for Health Connect access (or open it to install/connect). */
  /** Re-read who is feeding Health Connect. Cheap; one aggregate query. */
  const refreshSources = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    const sources = await stepSources();
    setState((s) => ({ ...s, sources }));
  }, []);

  /**
   * The "Sync steps" button: the same sync the timer runs, plus a fresh look
   * at the step sources, with a busy state so a tap visibly does something.
   */
  const syncByHand = useCallback(async () => {
    setState((s) => ({ ...s, syncing: true }));
    try {
      await Promise.all([syncNow(), refreshSources()]);
    } finally {
      setState((s) => ({ ...s, syncing: false }));
    }
  }, [syncNow, refreshSources]);

  const connectHealth = useCallback(async () => {
    const status = await healthStatus();
    if (status === 'not-installed') {
      installHealthConnect();
      return;
    }
    if (status === 'needs-permission') await requestHealthPermission();
    const next = await healthStatus();
    setState((s) => ({ ...s, health: next }));
    if (next === 'ready') {
      syncNow();
      refreshSources();
    }
  }, [syncNow, refreshSources]);

  // Availability, Health Connect, and the Android live counter.
  useEffect(() => {
    let sub: { remove(): void } | null = null;
    let cancelled = false;
    (async () => {
      const available = await Pedometer.isAvailableAsync().catch(() => false);
      const permission = await Pedometer.requestPermissionsAsync().catch(() => ({ granted: false }));
      // No cold permission prompt here any more: the step setup screen asks,
      // with a sentence of why first (app/step-setup.tsx). Testers met a bare
      // Health Connect dialog on first launch and many said no to it.
      const health: HealthStatus = Platform.OS === 'ios' ? 'ready' : await healthStatus();
      const ok = (available && permission.granted) || health === 'ready';
      if (cancelled) return;
      setState((s) => ({ ...s, available: ok, health }));
      if (health === 'ready') {
        syncNow();
        refreshSources();
      }
      // Keep syncing when the app is closed (see native/backgroundSteps.ts).
      if (health === 'ready' || Platform.OS === 'ios') void registerBackgroundStepSync();
      if (Platform.OS === 'ios' || !available || !permission.granted) return;

      // Android live sensor: steps since the watch STARTED, turned into
      // increments of today's in-app count.
      let last = 0;
      sub = Pedometer.watchStepCount(({ steps }) => {
        const delta = steps - last;
        last = steps;
        if (delta <= 0) return;
        withLedger((ledger) => {
          // Midnight passed while the app was open: close yesterday first.
          if (ledger.day !== today()) rollOver(ledger, null);
          ledger.appToday += delta;
          const total = Math.max(ledger.appToday, ledger.syncedToday);
          setState((s) => (s.stepsToday !== null && s.stepsToday >= total ? s : { ...s, stepsToday: total }));
        });
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [syncNow, refreshSources]);

  // Follow the phone's position so there is a distance to send alongside
  // the steps. Cheap: balanced accuracy, one fix every ten seconds.
  useEffect(() => {
    void startWalkTrace();
  }, []);

  // The setup screen changed something: look again and sync now.
  useEffect(
    () =>
      onStepSetupChanged(() => {
        void (async () => {
          const health: HealthStatus = Platform.OS === 'ios' ? 'ready' : await healthStatus();
          setState((s) => ({ ...s, health, available: s.available || health === 'ready' }));
          if (health === 'ready' || Platform.OS === 'ios') void registerBackgroundStepSync();
          void syncNow();
          void refreshSources();
        })();
      }),
    [syncNow, refreshSources],
  );

  // Sync on a timer, and whenever the app returns to the foreground.
  useEffect(() => {
    syncNow();
    const id = setInterval(syncNow, SYNC_EVERY_MS);
    const appState = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      syncNow();
      // They may have just linked Samsung Health in another app.
      refreshSources();
    });
    return () => {
      clearInterval(id);
      appState.remove();
    };
  }, [syncNow, refreshSources]);

  return { ...state, syncNow, syncByHand, connectHealth };
}
