/**
 * ===========================================================================
 *  DEVICE ATTESTATION - iOS (App Attest) and Android (Play Integrity)
 * ===========================================================================
 *
 *  FIRST, THE THING THAT TRIPS EVERYONE UP:
 *
 *  Neither HealthKit (iOS) nor Health Connect (Android) gives you step data
 *  your server can verify. There is no signature on a step count. The data
 *  sits on the phone and a modified build of your app can hand you any number
 *  it likes. Any tutorial promising a "signed HealthKit reading" is wrong.
 *  (Google Fit's APIs are retired - on Android it is Health Connect now.)
 *
 *  What you CAN prove is that the request came from a genuine, unmodified
 *  build of YOUR app, running on real hardware that is not jailbroken or
 *  rooted. That is device attestation, and both platforms provide it:
 *
 *    iOS      Apple App Attest (DCAppAttestService, iOS 14+)
 *    Android  Google Play Integrity API
 *
 *  Attestation does not prove a human walked - a phone taped to a ceiling fan
 *  still passes. That is what the plausibility limits in game/rules.ts are
 *  for. The two layers together are the defence; neither is enough alone.
 *
 *  ---------------------------------------------------------------------
 *  THE FLOW (identical shape on both platforms)
 *
 *    1. Client: POST /attest/challenge      -> server returns a random nonce
 *    2. Client: asks the OS to attest, folding that nonce in
 *         iOS      DCAppAttestService.generateAssertion(clientDataHash:)
 *         Android  IntegrityManager, with the nonce as requestHash
 *    3. Client: POST /steps/sync with the attestation token + the nonce
 *    4. Server: verifies the token, marks the nonce consumed (single use)
 *
 *  The server-issued nonce is what stops replay: capture a valid attestation
 *  and it is already spent by the time you try to reuse it.
 *  ---------------------------------------------------------------------
 */
import { HttpError } from '../utils/httpError';
import { config } from '../config/env';
import type { DevicePlatform } from '../services/steps.service';

export interface AttestationRequest {
  platform: DevicePlatform;
  /** The platform's attestation blob (base64). */
  token: string;
  /** The nonce we issued at /attest/challenge. */
  nonce: string;
  /** App Attest keyId on iOS; the install id on Android. */
  deviceId: string;
}

export interface AttestationResult {
  verified: boolean;
  /** Why it failed, for logging. Never returned to the client verbatim. */
  detail?: string;
}

/**
 * Verify an attestation. Which verifier runs is controlled by
 * ATTESTATION_MODE in .env:
 *
 *   off       Skip entirely. The default, and what local development uses.
 *   optional  Verify when a token is supplied, but do not require one.
 *             Use this while rolling out - you get real data on how many
 *             clients pass before you start turning people away.
 *   required  No valid attestation, no step sync.
 *
 * Switch to `required` only once you can see in the logs that real users are
 * passing. Turning it on blind will lock out a slice of your players (older
 * devices, some Android OEMs, anyone offline at the wrong moment).
 */
export async function verifyAttestation(request: AttestationRequest): Promise<AttestationResult> {
  switch (request.platform) {
    case 'IOS':
      return verifyAppleAppAttest(request);
    case 'ANDROID':
      return verifyPlayIntegrity(request);
    default:
      return { verified: false, detail: `Unknown platform: ${request.platform}` };
  }
}

/**
 * NOT IMPLEMENTED - deliberately.
 *
 * Verifying an App Attest assertion means: decode CBOR, walk the X.509 chain
 * up to Apple's App Attest root CA, check the nonce matches the one we issued,
 * confirm the rpId hash equals SHA256 of "<TeamID>.<BundleID>", and check the
 * signature counter is strictly higher than the last one we stored for this
 * key. Getting any of those subtly wrong produces a verifier that accepts
 * everything - which is worse than no verifier at all, because you would
 * believe you were protected.
 *
 * So this is left as a clearly-failing stub rather than untested crypto.
 * To implement it you need:
 *   - your Apple Team ID and bundle ID (in .env)
 *   - Apple's App Attest root certificate
 *   - a real physical device to test against (the simulator cannot attest)
 *   - the devices.attest_public_key / attest_counter columns, already in 002
 *
 * Apple's spec: "Validating Apps That Connect to Your Server".
 */
async function verifyAppleAppAttest(_request: AttestationRequest): Promise<AttestationResult> {
  return {
    verified: false,
    detail:
      'Apple App Attest verification is not implemented yet. ' +
      'Set ATTESTATION_MODE=off or optional until it is.',
  };
}

/**
 * NOT IMPLEMENTED - deliberately, same reasoning as above.
 *
 * Play Integrity is the simpler of the two: POST the token to
 * playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken using a
 * Google Cloud service account, then check the decoded verdict:
 *
 *   appIntegrity.appRecognitionVerdict    must be PLAY_RECOGNIZED
 *   deviceIntegrity.deviceRecognitionVerdict must contain MEETS_DEVICE_INTEGRITY
 *   requestDetails.requestHash            must equal our nonce
 *   requestDetails.requestPackageName     must be our package
 *
 * To implement it you need a Google Cloud service account with the Play
 * Integrity API enabled, and your app's package name (both in .env).
 */
async function verifyPlayIntegrity(_request: AttestationRequest): Promise<AttestationResult> {
  return {
    verified: false,
    detail:
      'Google Play Integrity verification is not implemented yet. ' +
      'Set ATTESTATION_MODE=off or optional until it is.',
  };
}

/**
 * Applies the ATTESTATION_MODE policy to a sync request.
 * Returns whether the request should be treated as attested.
 */
export async function enforceAttestationPolicy(
  request: AttestationRequest | null,
): Promise<boolean> {
  const mode = config.attestationMode;

  if (mode === 'off') {
    return false;
  }

  if (!request) {
    if (mode === 'required') {
      throw new HttpError(401, 'This app version must supply a device attestation.');
    }
    return false;
  }

  const result = await verifyAttestation(request);

  if (!result.verified) {
    // Log the real reason for us; tell the client nothing that helps them
    // work out how to forge one.
    console.warn(`[attest] rejected ${request.platform} device ${request.deviceId}:`, result.detail);

    if (mode === 'required') {
      throw new HttpError(401, 'Device attestation failed.');
    }
    return false;
  }

  return true;
}
