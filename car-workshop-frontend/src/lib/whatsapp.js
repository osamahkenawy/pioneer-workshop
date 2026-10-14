/**
 * whatsapp.js — WhatsApp share helpers (wa.me deep links).
 *
 * Status updates to a customer use buildStatusMessage(); its wording comes
 * from lib/statusLabels.js (customer labels) and its link from
 * lib/customerLink.js (/service-status/{token}).
 */
import { safeT, woLabel } from './statusLabels';
import { customerStatusUrl } from './customerLink';

/** Open WhatsApp with a pre-filled message to the given phone number. */
export function shareViaWhatsApp(phone, message) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  const url = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message || '')}`
    : `https://wa.me/?text=${encodeURIComponent(message || '')}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** The first non-empty value among `keys` on `obj`, trimmed. */
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, part) => (o == null ? o : o[part]), obj);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * "AED 1,250.00" from a number or numeric string (a DECIMAL from the API);
 * any other string is used as it is. Nothing for empty, zero or negative.
 */
function formatAmount(amount, currency) {
  if (amount == null || amount === '') return '';
  const numeric = typeof amount === 'number' || /^\s*-?\d+(\.\d+)?\s*$/.test(String(amount));
  if (!numeric) return String(amount).trim();
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${currency} ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A status update for the customer, ready for shareViaWhatsApp():
 *
 *   Hello Ahmed, your Toyota Camry (A 12345) — job card JC-…: Ready for collection.
 *   Amount due: AED 1,250.00.
 *   Follow it here: https://…/service-status/…
 *   Pioneer Car Service
 *
 * The amount line shows only when `amountDue` is above zero; the link line
 * only when there is a link; the last line only with `workshopName`.
 *
 * Reads from `wo` (the field names of the different list and detail
 * endpoints are all accepted): customer_name; vehicle_make / make,
 * vehicle_model / model, plate_number / vehicle_plate_number / vehicle_plate;
 * main_job_card_number / job_card_number, else work_order_number; status and
 * customer_approved_at for the stage; service_status_token for the link.
 *
 * @param {object} opts
 * @param {Function|null} [opts.t]  react-i18next's t (null = English)
 * @param {object} opts.wo  the work order
 * @param {'customer'|'staff'|'short'} [opts.audience='customer']  which woLabel wording the stage uses
 * @param {string|null} [opts.link]  status link; left out → customerStatusUrl(wo)
 *   on this site; null or '' → no link line.
 * @param {number|string|null} [opts.amountDue]  balance to pay at collection
 *   (a number, a DECIMAL string, or a ready-made text such as "Billed to your account").
 * @param {string} [opts.currency='AED']  used when amountDue is a number
 * @param {string} [opts.workshopName]  signs the message
 * @returns {string}
 *
 * i18n keys (woStatus.message.*): status, status_no_name, car, amount_due, follow.
 */
export function buildStatusMessage({ t, wo, audience = 'customer', link, amountDue, currency = 'AED', workshopName } = {}) {
  const tt = safeT(t);
  const order = wo || {};
  const name = pick(order, 'customer_name', 'customer.full_name', 'customer.name');
  const makeModel = [pick(order, 'vehicle_make', 'make', 'vehicle.make'), pick(order, 'vehicle_model', 'model', 'vehicle.model')]
    .filter(Boolean).join(' ');
  const plate = pick(order, 'plate_number', 'vehicle_plate_number', 'vehicle_plate', 'plate', 'vehicle.plate_number');
  const vehicle = makeModel && plate ? `${makeModel} (${plate})`
    : makeModel || plate || tt('woStatus.message.car', 'car');
  const job = pick(order, 'main_job_card_number', 'job_card_number', 'work_order_number') || (order.id ? `#${order.id}` : '');
  const vars = { name, vehicle, job, stage: woLabel(t, order, audience) };

  const lines = [
    name
      ? tt('woStatus.message.status', 'Hello {{name}}, your {{vehicle}} — job card {{job}}: {{stage}}.', vars)
      : tt('woStatus.message.status_no_name', 'Hello, your {{vehicle}} — job card {{job}}: {{stage}}.', vars),
  ];
  const amount = formatAmount(amountDue, currency);
  if (amount) lines.push(tt('woStatus.message.amount_due', 'Amount due: {{amount}}.', { amount }));
  const url = link === undefined ? customerStatusUrl(order) : link;
  if (url) lines.push(tt('woStatus.message.follow', 'Follow it here: {{link}}', { link: url }));
  if (workshopName && String(workshopName).trim()) lines.push(String(workshopName).trim());
  return lines.join('\n');
}

/**
 * Build a customer-facing message summarizing a work order.
 * Kept for existing callers; it is buildStatusMessage() with the customer
 * wording and the /service-status link on `baseUrl` (default: this site).
 */
export function buildOrderMessage(order, t, baseUrl) {
  return buildStatusMessage({ t, wo: order, audience: 'customer', link: customerStatusUrl(order, baseUrl) });
}

/** Build a message inviting a customer to their portal. */
export function buildCustomerMessage(customer, t, portalUrl) {
  const tr = typeof t === 'function' ? t : (k, d) => (typeof d === 'string' ? d : k);
  const lines = [
    `${tr('whatsapp.hello', 'Hello')} ${customer?.full_name || customer?.name || ''}!`.trim(),
    tr('whatsapp.portal_invite', 'Access your customer portal to view your vehicles, work orders and invoices:'),
  ];
  if (portalUrl) lines.push(portalUrl);
  return lines.join('\n');
}

export default { shareViaWhatsApp, buildStatusMessage, buildOrderMessage, buildCustomerMessage };
