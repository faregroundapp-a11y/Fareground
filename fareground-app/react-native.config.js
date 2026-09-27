/**
 * Native libraries that must NOT be linked into the Android app.
 *
 * Apple Health (@kingstinct/react-native-healthkit) and the Nitro runtime it
 * needs are iPhone-only here - Android reads Health Connect instead. Nitro
 * still ships Android native code, so without this it was loaded into every
 * Android launch for nothing, and was the prime suspect when the 2026-09-27
 * build crashed on start ("Fareground keeps stopping"). Excluding it keeps
 * the Android app exactly as native as it was before Apple Health existed.
 */
module.exports = {
  dependencies: {
    'react-native-nitro-modules': { platforms: { android: null } },
    '@kingstinct/react-native-healthkit': { platforms: { android: null } },
    '@react-native-healthkit/core': { platforms: { android: null } },
  },
};
