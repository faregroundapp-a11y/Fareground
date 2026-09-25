import { GOOGLE_WEB_CLIENT_ID } from '@/config';
import { optional } from './optional';

/**
 * "Continue with Google".
 *
 * The phone signs in with Google and gets an ID token addressed to our WEB
 * client id. The backend verifies that token itself (POST /auth/google) -
 * the phone never just says who you are.
 */
type GS = typeof import('@react-native-google-signin/google-signin');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: an import would crash builds without the native module (see optional.ts)
const G = optional<GS>(() => require('@react-native-google-signin/google-signin'), 'RNGoogleSignin');

let configured = false;

/** True when the button can work: module in this build AND a client id set. */
export const googleSignInAvailable = () => G !== null && !!GOOGLE_WEB_CLIENT_ID;

export class GoogleSignInCancelled extends Error {}

/** Show Google's account picker. Resolves to an ID token for the backend. */
export async function googleIdToken(): Promise<string> {
  if (!G || !GOOGLE_WEB_CLIENT_ID) throw new Error("Google sign-in isn't set up yet.");
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = G;

  if (!configured) {
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    configured = true;
  }

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Always offer the account picker, rather than silently reusing whoever
    // signed in last - someone may be switching accounts.
    await GoogleSignin.signOut().catch(() => {});
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) throw new GoogleSignInCancelled('Cancelled');
    const token = res.data.idToken;
    if (!token) throw new Error('Google did not return an ID token. Check the web client id.');
    return token;
  } catch (e) {
    if (e instanceof GoogleSignInCancelled) throw e;
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) throw new GoogleSignInCancelled('Cancelled');
      if (e.code === statusCodes.IN_PROGRESS) throw new GoogleSignInCancelled('Already signing in');
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play services is missing or out of date on this phone.');
      }
      // DEVELOPER_ERROR (code 10) almost always means the Android OAuth client
      // does not have this build's SHA-1 fingerprint registered.
      if (String(e.code) === '10' || e.code === 'DEVELOPER_ERROR') {
        throw new Error("Google sign-in isn't configured for this build yet (SHA-1 not registered).");
      }
    }
    throw e instanceof Error ? e : new Error('Google sign-in failed.');
  }
}
