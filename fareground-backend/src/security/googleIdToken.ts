/**
 * Verify a Google Sign-In ID token.
 *
 * The phone signs in with Google and hands us the ID token Google gave it: a
 * JWT signed with one of Google's rotating RSA keys. Checking it here, on the
 * server, is the whole point - an app that just sends "I am bob@gmail.com"
 * could be lying. We check:
 *
 *   - the signature, against Google's published certificates
 *   - `aud` is one of OUR OAuth client ids (a token minted for some other app
 *     must not log anyone in here)
 *   - `iss` is Google, and the token has not expired
 *   - the email is verified
 *
 * Done with `jsonwebtoken`, which is already a dependency, rather than
 * pulling in google-auth-library for one function.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { HttpError } from '../utils/httpError';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs';

let certs: { until: number; byKid: Record<string, string> } | null = null;

async function loadCerts(force = false): Promise<Record<string, string>> {
  if (!force && certs && Date.now() < certs.until) return certs.byKid;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new HttpError(503, 'Google sign-in is unavailable right now. Try again shortly.');
  // Google says how long to cache in Cache-Control: max-age.
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  const byKid = (await res.json()) as Record<string, string>;
  certs = { until: Date.now() + maxAge * 1000, byKid };
  return byKid;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (config.googleClientIds.length === 0) {
    throw new HttpError(503, "Google sign-in isn't set up on this server yet.");
  }

  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded && typeof decoded === 'object' ? decoded.header.kid : undefined;
  if (!kid) throw new HttpError(401, 'That Google sign-in could not be verified.');

  let byKid = await loadCerts();
  if (!byKid[kid]) byKid = await loadCerts(true);
  const cert = byKid[kid];
  if (!cert) throw new HttpError(401, 'That Google sign-in could not be verified.');

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(idToken, cert, {
      algorithms: ['RS256'],
      audience: config.googleClientIds as [string, ...string[]],
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
    }) as jwt.JwtPayload;
  } catch {
    throw new HttpError(401, 'That Google sign-in could not be verified.');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!payload.sub || !email) throw new HttpError(401, 'Google did not share an email address.');
  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw new HttpError(401, 'Your Google email address is not verified.');
  }

  return { sub: payload.sub, email, name: typeof payload.name === 'string' ? payload.name : null };
}
