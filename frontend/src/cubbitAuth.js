import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';

const API_BASE = '/cubbit-proxy/iam';
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

async function getChallenge(email) {
  const response = await fetch(`${API_BASE}/v1/auth/signin/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email, tenant_id: DEFAULT_TENANT_ID }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to get challenge');
  }
  return response.json();
}

function signChallenge(challenge, password, salt) {
  // SHA-256(password + salt) → 32-byte seed via @noble/hashes (pure JS, works without HTTPS)
  const seed = sha256(new TextEncoder().encode(password + salt));

  // ED25519 sign via @noble/curves (pure JS)
  const challengeBytes = new TextEncoder().encode(challenge);
  const signature = ed25519.sign(challengeBytes, seed);

  // Return as base64
  return btoa(String.fromCharCode(...signature));
}

async function signIn(body) {
  const response = await fetch(`${API_BASE}/v1/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Sign in failed' }));
    throw new Error(err.message || 'Sign in failed');
  }
  return response.json();
}

async function verifyTFA(body) {
  const response = await fetch(`${API_BASE}/v1/auth/verify/tfa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'TFA verification failed' }));
    throw new Error(err.message || 'TFA verification failed');
  }
  return response.json();
}

export async function login(email, password) {
  const { challenge, salt } = await getChallenge(email);
  const signedChallenge = signChallenge(challenge, password, salt);

  const result = await signIn({
    email,
    signed_challenge: signedChallenge,
    tfa_code: null,
    tenant_id: DEFAULT_TENANT_ID,
  });

  if ('totp_session_id' in result) {
    return { totpSessionId: result.totp_session_id };
  }
  return { token: result };
}

export async function verifyTFAAndLogin(totpSessionId, tfaCode) {
  return verifyTFA({ totp_session_id: totpSessionId, tfa_code: tfaCode });
}
