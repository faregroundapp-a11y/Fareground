import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { runStepSync } from '@/hooks/useStepSync';
import { optional } from './optional';

/**
 * STEPS THAT ARRIVE WITHOUT OPENING THE APP.
 *
 * How the walking games that do this well work (researched 2026-09-26):
 * Pokemon GO's Adventure Sync, WeWard and Sweatcoin all read the phone's own
 * health store - Health Connect / Google Fit on Android, the motion history
 * behind Apple Health on iOS - and sync it on a background schedule, with a
 * delay of minutes to a few hours that players accept. None of them keep a
 * step sensor running in a background service: since Android 8 the system
 * kills those, and they drain the battery.
 *
 * Fareground already reads the right store. What it lacked was the schedule:
 * steps were read only when the app opened, so a player who walked and never
 * opened it saw nothing - "my steps only count when the app is open".
 *
 * This registers a periodic background task (WorkManager on Android, BGTask
 * on iOS; the OS decides the exact timing, roughly every 30 minutes at best)
 * that runs the SAME sync the app runs, idempotency key and all. It needs a
 * build that includes expo-background-task; on an older build it is a no-op.
 *
 * Android 14+ also needs Health Connect's "read in background" permission,
 * asked for alongside the steps permission (see healthSteps.ts).
 */
type BackgroundTaskModule = typeof import('expo-background-task');
type TaskManagerModule = typeof import('expo-task-manager');

// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: an import would crash builds without the native module (see optional.ts)
const BackgroundTask = optional<BackgroundTaskModule>(() => require('expo-background-task'), 'ExpoBackgroundTask');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as above
const TaskManager = optional<TaskManagerModule>(() => require('expo-task-manager'), 'ExpoTaskManager');

const TASK = 'fareground-step-sync';
/** Must match session.tsx. */
const TOKEN_KEY = 'fareground.token';

// Defined at module load, as TaskManager requires: when the OS wakes the app
// headless for this task, this file must already have been evaluated. It is
// imported from app/_layout.tsx for exactly that reason.
if (BackgroundTask && TaskManager && Platform.OS !== 'web') {
  TaskManager.defineTask(TASK, async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) return BackgroundTask.BackgroundTaskResult.Success; // signed out
      await runStepSync(token, { background: true });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      // Offline, or the server asleep: the batch is written down and will be
      // retried with the same key next time. Nothing is lost.
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Ask the OS to run the step sync periodically. Safe to call on every launch. */
export async function registerBackgroundStepSync(): Promise<void> {
  if (!BackgroundTask || !TaskManager) return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
    // Minutes. Android's floor is 15; the OS stretches it to save battery.
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 30 });
  } catch {
    // Background work switched off by the player or the OS: the app still
    // syncs every time it opens.
  }
}

/** Whether this build can sync in the background at all (for the Walk tab). */
export const backgroundSyncSupported = !!BackgroundTask && !!TaskManager;
