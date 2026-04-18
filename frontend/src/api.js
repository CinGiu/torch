const IS_DEV = import.meta.env.DEV;
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

function authHeaders() {
  try {
    const stored = localStorage.getItem("torch_auth");
    if (!stored) return {};
    const { token } = JSON.parse(stored);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

async function apiFetch(url, options = {}, timeout = 30000, retries = 2) {
  const headers = { ...authHeaders(), ...(options.headers || {}) };
  const fullUrl = IS_DEV ? url : `${API_BASE}${url}`;
  
  let lastError = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const res = await fetch(fullUrl, { ...options, headers, signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (res.status === 401) {
        const err = new Error("unauthorized");
        err.status = 401;
        throw err;
      }
      
      if (!res.ok && attempt < retries && res.status >= 500) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      return res;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      
      if (error.name === 'AbortError') {
        const timeoutErr = new Error(`Request timeout after ${timeout}ms`);
        timeoutErr.status = 408;
        throw timeoutErr;
      }
      
      if (error.status === 401) {
        throw error;
      }
      
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

export const api = {
  getConfig:    () => apiFetch("/api/config").then(r => r.json()),
  saveConfig:   (cfg) => apiFetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) }).then(r => r.json()),
  getStatus:    () => apiFetch("/api/status").then(r => r.json()),
  start:        () => apiFetch("/api/pipeline/start",  { method: "POST" }).then(r => r.json()),
  stop:         () => apiFetch("/api/pipeline/stop",   { method: "POST" }).then(r => r.json()),
  listIssues:   (repo) => apiFetch(`/api/issues?repo=${encodeURIComponent(repo)}`).then(r => { if (!r.ok) return r.json().then(e => Promise.reject(e.error)); return r.json(); }),
  triggerIssue: (body) => apiFetch("/api/pipeline/trigger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  getLiveLog:   (issue) => apiFetch(`/api/live-log?issue=${issue}`).then(r => r.json()),
  listRepos:    () => apiFetch("/api/repos").then(r => r.json()),
  adminStats:   () => apiFetch("/api/admin/stats").then(r => r.json()),
  adminUsers:   () => apiFetch("/api/admin/users").then(r => r.json()),
  adminRuns:    () => apiFetch("/api/admin/runs").then(r => r.json()),
  sdks:         () => apiFetch("/api/sdks").then(r => r.json()),
};
