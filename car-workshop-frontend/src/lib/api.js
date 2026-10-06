/**
 * api.js — fetch-based API client with auth-token handling.
 *
 * All calls return the parsed JSON body (the backend always answers
 * `{ success, data?, message?, ... }`), with the HTTP status attached
 * as a non-enumerable `status` property. Network failures throw.
 */
const API_URL = import.meta.env.VITE_API_URL || '/api';

export function getToken() {
  try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem('auth_token', token);
    else localStorage.removeItem('auth_token');
  } catch { /* ignore */ }
}

async function request(method, path, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const init = { method, headers, credentials: 'include' };
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      init.body = body; // browser sets multipart boundary
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  const res = await fetch(`${API_URL}${path}`, init);

  if (opts.raw) return res; // caller wants the Response (PDF/blob downloads)

  let json;
  try {
    json = await res.json();
  } catch {
    json = { success: res.ok, message: res.statusText };
  }
  if (res.status === 401 && !path.startsWith('/auth')) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
  }
  try {
    Object.defineProperty(json, 'status', { value: res.status, enumerable: false });
  } catch { /* primitives — ignore */ }
  return json;
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  delete: (path, body, opts) => request('DELETE', path, body, opts),
  /** Fetch a binary/PDF endpoint; returns the raw Response. */
  raw: (path, opts = {}) => request(opts.method || 'GET', path, opts.body, { ...opts, raw: true }),
};

export default api;
