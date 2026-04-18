const AUTH_KEY = 'torch_auth';

export function saveAuth(sessionToken, accountId, isAdmin = false) {
  const auth = { 
    token: sessionToken, 
    sub: accountId, 
    is_admin: isAdmin,
    expires_at: Date.now() + (24 * 60 * 60 * 1000) 
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  return auth;
}

export function loadAuthWithoutExpiry() {
  const stored = localStorage.getItem(AUTH_KEY);
  if (!stored) return null;
  try { 
    const auth = JSON.parse(stored);
    if (auth.expires_at && Date.now() >= auth.expires_at) {
      console.warn('[Session] Token expired, clearing auth');
      clearAuth();
      return null;
    }
    return auth;
  } catch (err) {
    console.error('[Session] Failed to parse stored auth:', err);
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}
