import { optional } from './optional';

/**
 * Picking a profile photo, and getting it small enough to send.
 *
 * The phone does ALL the work: crop to a square, resize to 256x256, re-encode
 * as JPEG at 0.8. That lands at roughly 15-40 KB, which means the server needs
 * no image library at all - it just checks the magic bytes and writes the file.
 *
 * Both libraries are native, so both go through `optional`: a build made
 * before they were added has the picker switched off rather than crashing.
 *
 * API NOTE (SDK 57): `manipulateAsync` is DEPRECATED - the current API is the
 * chainable `manipulate()` context. `MediaTypeOptions` is deprecated too; the
 * current form is `mediaTypes: ['images']`.
 */
type Picker = typeof import('expo-image-picker');
type Manipulator = typeof import('expo-image-manipulator');

// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: an import would crash builds without the native module (see optional.ts)
const P = optional<Picker>(() => require('expo-image-picker'), 'ExponentImagePicker');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: see above
const M = optional<Manipulator>(() => require('expo-image-manipulator'), 'ExpoImageManipulator');

/** The side of the square we upload, in pixels. */
const SIZE = 256;

export const photoPickerAvailable = () => P !== null && M !== null;

export type PickOutcome =
  | { ok: true; base64: string }
  | { ok: false; reason: 'cancelled' | 'denied' | 'unavailable' | 'failed' };

/**
 * Show the photo library, let the player crop a square, and return the
 * prepared image as base64.
 *
 * Never throws - every failure comes back as a reason the caller can put on
 * screen, because "something went wrong" is not worth showing anyone.
 */
export async function pickProfilePhoto(): Promise<PickOutcome> {
  if (!P || !M) return { ok: false, reason: 'unavailable' };

  try {
    const permission = await P.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'denied' };

    const picked = await P.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (picked.canceled || !picked.assets?.length) return { ok: false, reason: 'cancelled' };

    // `manipulate` lives on the ImageManipulator native module, not on the
    // module namespace - an easy one to get wrong from the docs alone.
    const context = M.ImageManipulator.manipulate(picked.assets[0].uri);
    const rendered = await context.resize({ width: SIZE, height: SIZE }).renderAsync();
    const saved = await rendered.saveAsync({
      format: M.SaveFormat.JPEG,
      compress: 0.8,
      base64: true,
    });

    if (!saved.base64) return { ok: false, reason: 'failed' };
    return { ok: true, base64: saved.base64 };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
