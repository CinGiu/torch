const AUTH_KEY = 'torch_auth';

// Stores the local session token returned by POST /api/session.
export function saveAuth(sessionToken, accountId) {
  const auth = { token: sessionToken, sub: accountId };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  return auth;
}

export function loadAuthWithoutExpiry() {
  const stored = localStorage.getItem(AUTH_KEY);
  if (!stored) return null;
  try { return JSON.parse(stored); } catch { return null; }
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}
