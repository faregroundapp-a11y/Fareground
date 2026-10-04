import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { optional } from './optional';

/**
 * Push notifications, on the phone's side.
 *
 * All this does is ask permission once, fetch the Expo push token and hand it
 * to the server. WHAT gets sent and WHEN is entirely the backend's decision
 * (`notify.service.ts`) - nothing here schedules anything locally, so the
 * rules can change without a new build.
 *
 * Loaded through `optional` like every other native module: a dev build made
 * before expo-notifications was added simply has notifications switched off
 * rather than crashing on launch.
 */
type Notifications = typeof import('expo-notifications');

// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: an import would crash builds without the native module (see optional.ts)
const N = optional<Notifications>(() => require('expo-notifications'), 'ExpoPushTokenManager');

export const pushAvailable = () => N !== null;

/** Android needs a channel before anything will make a sound. */
async function ensureChannel(): Promise<void> {
  if (!N || Platform.OS !== 'android') return;
  try {
    await N.setNotificationChannelAsync('default', {
      name: 'Reminders',
      importance: N.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#F2A93B',
      sound: 'default',
    });
  } catch {
    // A channel that cannot be created is not worth failing sign-in over.
  }
}

/**
 * The project id EAS builds against. Expo needs it to mint a push token, and
 * it lives in app.json under extra.eas.projectId.
 */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Ask for permission (only if we have not already been answered) and return
 * the Expo push token, or null if this device cannot or will not receive.
 *
 * Never throws. A phone that says no to notifications still plays the game.
 */
export async function getPushToken(): Promise<string | null> {
  if (!N) return null;
  try {
    const existing = await N.getPermissionsAsync();
    let granted = existing.granted;

    // Only prompt when the system has not already decided. Asking again after
    // a "no" does nothing but annoy - the OS will not show the dialog twice.
    if (!granted && existing.canAskAgain) {
      const asked = await N.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return null;

    await ensureChannel();

    const id = projectId();
    const token = await N.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
    return token.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Show notifications that arrive while the app is open, rather than swallowing
 * them. Called once at startup.
 */
export function initPushHandling(): void {
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false, // already looking at the app - a sound is noise
        shouldSetBadge: false,
      }),
    });
  } catch {
    // An older expo-notifications with a different handler shape: ignore.
  }
  // TAPPING A NOTIFICATION opens the screen it is about (2026-10-04): the
  // doorbell goes to Land, the chest and boost to the map.
  try {
    N.addNotificationResponseReceivedListener((response) => {
      const screen = (response.notification.request.content.data as { screen?: string } | undefined)?.screen;
      const path = screen === 'land' ? '/land' : screen === 'walk' ? '/walk' : '/';
      // A beat, so the app has drawn its tabs when opened from cold.
      setTimeout(() => {
        try {
          router.navigate(path);
        } catch {
          // Navigation not ready: the app simply opens where it was.
        }
      }, 400);
    });
  } catch {
    // No response listener on this build: notifications still arrive.
  }
}
