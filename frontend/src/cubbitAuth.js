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
  const seed = sha256(new TextEncoder().encode(password + salt));
  const challengeBytes = new TextEncoder().encode(challenge);
  const signature = ed25519.sign(challengeBytes, seed);
  return btoa(String.fromCharCode(...signature));
}

async function signIn(body) {
  const response = await fetch(`${API_BASE}/v1/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (response.status === 401) {
    const err = await response.json().catch(() => ({}));
    if (err.message === 'missing two factor code') {
      throw Object.assign(new Error('needs_tfa'), { needsTFA: true });
    }
    throw new Error(humanizeAuthError(err.message));
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(humanizeAuthError(err.message));
  }

  return response.json();
}

function humanizeAuthError(msg) {
  switch (msg) {
    case 'unauthorized':              return 'Incorrect email or password.';
    case 'invalid two factor code':
    case 'invalid tfa code':          return 'Invalid verification code. Please try again.';
    case 'account not found':         return 'No account found with this email.';
    case 'account banned':            return 'This account has been suspended.';
    default:                          return msg || 'Login failed. Please try again.';
  }
}

// Full sign-in flow. Pass tfaCode on the second attempt (after needsTFA).
// Gets a fresh challenge every time — the previous challenge expires after the first 401.
export async function login(email, password, tfaCode = null) {
  const { challenge, salt } = await getChallenge(email);
  const signedChallenge = signChallenge(challenge, password, salt);

  try {
    const result = await signIn({
      email,
      signed_challenge: signedChallenge,
      tenant_id: DEFAULT_TENANT_ID,
      ...(tfaCode ? { tfa_code: tfaCode } : {}),
    });
    return { token: result };
  } catch (err) {
    if (err.needsTFA) return { needsTFA: true };
    throw err;
  }
}
