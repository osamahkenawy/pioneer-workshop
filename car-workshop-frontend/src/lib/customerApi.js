/**
 * customerApi.js — fetch-based API client for the customer portal.
 *
 * Mirrors src/lib/api.js but keys off `crm_token` instead of `auth_token`,
 * since a logged-in customer and a logged-in staff member are two entirely
 * separate sessions that can coexist in the same browser.
 */
const API_URL = import.meta.env.VITE_API_URL || '/api';

export function getCustomerToken() {
  try { return localStorage.getItem('crm_token') || ''; } catch { return ''; }
}

export function setCustomerToken(token) {
  try {
    if (token) localStorage.setItem('crm_token', token);
    else localStorage.removeItem('crm_token');
  } catch { /* ignore */ }
}

async function request(method, path, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getCustomerToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const init = { method, headers, credentials: 'include' };
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  const res = await fetch(`${API_URL}${path}`, init);

  if (opts.raw) return res;

  let json;
  try {
    json = await res.json();
  } catch {
    json = { success: res.ok, message: res.statusText };
  }
  if (res.status === 401 && !path.startsWith('/customer-auth')) {
    window.dispatchEvent(new CustomEvent('customer-auth:unauthorized'));
  }
  try {
    Object.defineProperty(json, 'status', { value: res.status, enumerable: false });
  } catch { /* primitives — ignore */ }
  return json;
}

export const customerApi = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  delete: (path, body, opts) => request('DELETE', path, body, opts),
  raw: (path, opts = {}) => request(opts.method || 'GET', path, opts.body, { ...opts, raw: true }),
};

export default customerApi;
