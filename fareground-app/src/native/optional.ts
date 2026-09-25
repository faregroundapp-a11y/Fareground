import { requireOptionalNativeModule } from 'expo';
import { TurboModuleRegistry } from 'react-native';

/**
 * Load a library that needs native code, without crashing when that native
 * code is missing.
 *
 * JS changes reach the phone instantly, but native modules only arrive with a
 * new build. A library whose native half is not in the installed build throws
 * when it is used - which could take the whole app down. Loading it through
 * here instead returns null, and the feature quietly switches off until the
 * new build is installed.
 *
 * `nativeName` is checked FIRST, so we never even evaluate the library when
 * its native half is absent (rather than relying on it throwing on import).
 */
export function optional<T>(load: () => T, nativeName?: string): T | null {
  if (nativeName && !hasNativeModule(nativeName)) return null;
  try {
    return load();
  } catch {
    return null;
  }
}

/** Is a native module compiled into this build? Works for both module kinds. */
export function hasNativeModule(name: string): boolean {
  try {
    return TurboModuleRegistry.get(name) != null || requireOptionalNativeModule(name) != null;
  } catch {
    return false;
  }
}
