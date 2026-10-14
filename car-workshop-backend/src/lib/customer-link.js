/**
 * customer-link.js — the one link a customer gets to follow their car:
 *
 *   {frontend}/service-status/{token}
 *
 * Every SMS, email, WhatsApp text, job sheet QR and "copy customer link"
 * builds it here, so it is the same everywhere. The token is
 * work_orders.service_status_token (lib/tokens.js serviceStatusToken()).
 *
 * The old /track/{token} path stays working on the front end as an alias for
 * job sheets already printed, but nothing new should link to it.
 *
 * The front-end twin is car-workshop-frontend/src/lib/customerLink.js.
 */
import { config } from '../config.js';

/**
 * Where customer links point in production when FRONTEND_URL is missing or
 * still a development address. Never the old delivery.* host.
 */
export const PRODUCTION_FRONTEND_URL = 'https://app.pioneercarservice.com';

/** A FRONTEND_URL that must never reach a customer from a production server. */
function isUnusableBase(url) {
  if (!url || url === '*') return true;
  try {
    const { hostname } = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'].includes(hostname) || hostname.endsWith('.localhost');
  } catch {
    return true;  // not an absolute URL
  }
}

/**
 * The front-end origin customer links start with, without a trailing slash.
 *
 * config.frontendUrl (FRONTEND_URL) as configured; in production an empty,
 * '*', malformed or localhost value falls back to PRODUCTION_FRONTEND_URL.
 * In development the local value is used as it is.
 *
 * @returns {string} e.g. 'https://app.pioneercarservice.com'
 */
export function customerAppBase() {
  const configured = String(config.frontendUrl || '').trim().replace(/\/+$/, '');
  if (config.env === 'production' && isUnusableBase(configured)) return PRODUCTION_FRONTEND_URL;
  return configured && configured !== '*' ? configured : 'http://localhost:5173';
}

/**
 * The customer's status page for a work order.
 *
 * @param {string|{service_status_token?: string}} tokenOrRow
 *   work_orders.service_status_token, or the work order row itself.
 * @returns {string|null} absolute URL, or null when the job has no token —
 *   leave the link out of the message rather than sending a broken one.
 *
 * @example customerStatusUrl(wo.service_status_token)
 *   // 'https://app.pioneercarservice.com/service-status/3f9c…'
 */
export function customerStatusUrl(tokenOrRow) {
  const token = tokenOrRow && typeof tokenOrRow === 'object' ? tokenOrRow.service_status_token : tokenOrRow;
  const clean = String(token ?? '').trim();
  if (!clean) return null;
  return `${customerAppBase()}/service-status/${encodeURIComponent(clean)}`;
}

/**
 * The status token inside whatever was scanned or typed: a
 * /service-status/{token} or /track/{token} URL (absolute or relative, with
 * or without a query string), or else the trimmed text itself — a plate, a
 * WO or job card number, a VIN or a bare token.
 *
 * Case and inner spaces are left alone; callers normalise for their own
 * lookup (the technician lookup upper-cases and strips spaces for plates).
 *
 * @param {*} text
 * @returns {string} '' for empty input.
 *
 * @example extractStatusToken('https://app.pioneercarservice.com/track/ab12?x=1')  // 'ab12'
 * @example extractStatusToken(' WO-20261013-4876 ')                                // 'WO-20261013-4876'
 */
export function extractStatusToken(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const m = /(?:^|\/)(?:service-status|track)\/([^/?#\s]+)/i.exec(s);
  if (!m) return s;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export default customerStatusUrl;
