/**
 * customerLink.js — the one link a customer gets to follow their car:
 *
 *   {origin}/service-status/{token}
 *
 * "Copy customer link", WhatsApp texts and the scan page all go through
 * here. The token is the work order's `service_status_token`. The old
 * /track/{token} path is still routed as an alias for job sheets already
 * printed, but nothing new links to it.
 *
 * The back-end twin (SMS, email, job sheet QR) is
 * car-workshop-backend/src/lib/customer-link.js.
 */

/**
 * The customer's status page for a work order.
 *
 * @param {string|{service_status_token?: string}} tokenOrWo
 *   the work order's service_status_token, or the work order itself.
 * @param {string} [origin=window.location.origin]  the site the link opens on;
 *   the staff app and the public status page are the same site.
 * @returns {string|null} absolute URL, or null when the job has no token —
 *   hide "Copy customer link" / WhatsApp buttons in that case.
 *
 * @example customerStatusUrl(order.service_status_token)
 *   // 'https://app.pioneercarservice.com/service-status/3f9c…'
 */
export function customerStatusUrl(tokenOrWo, origin) {
  const token = tokenOrWo && typeof tokenOrWo === 'object' ? tokenOrWo.service_status_token : tokenOrWo;
  const clean = String(token ?? '').trim();
  if (!clean) return null;
  const base = String(origin || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  return `${base}/service-status/${encodeURIComponent(clean)}`;
}

/**
 * The status token inside whatever was scanned or typed: a
 * /service-status/{token} or /track/{token} URL (absolute or relative, with
 * or without a query string), or else the trimmed text itself — a plate, a
 * WO or job card number, a VIN or a bare token.
 *
 * Case and inner spaces are left alone; the technician lookup normalises
 * them on the server.
 *
 * @param {*} text
 * @returns {string} '' for empty input.
 *
 * @example extractStatusToken('https://app.pioneercarservice.com/track/ab12?x=1')  // 'ab12'
 * @example extractStatusToken(' JC-20261013-0001 ')                                // 'JC-20261013-0001'
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
