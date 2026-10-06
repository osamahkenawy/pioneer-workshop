/**
 * whatsapp.js — WhatsApp share helpers (wa.me deep links).
 */

/** Open WhatsApp with a pre-filled message to the given phone number. */
export function shareViaWhatsApp(phone, message) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  const url = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message || '')}`
    : `https://wa.me/?text=${encodeURIComponent(message || '')}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Build a customer-facing message summarizing a work order. */
export function buildOrderMessage(order, t, baseUrl) {
  const tr = typeof t === 'function' ? t : (k, d) => (typeof d === 'string' ? d : k);
  const lines = [
    `🔧 ${tr('whatsapp.work_order', 'Work Order')} #${order?.work_order_number || order?.id || ''}`,
  ];
  if (order?.vehicle_make || order?.vehicle_model || order?.plate_number) {
    lines.push(`🚗 ${[order.vehicle_make, order.vehicle_model].filter(Boolean).join(' ')}${order.plate_number ? ` (${order.plate_number})` : ''}`);
  }
  if (order?.status) lines.push(`📋 ${tr('whatsapp.status', 'Status')}: ${String(order.status).replace(/_/g, ' ')}`);
  if (order?.total_amount != null) lines.push(`💰 ${tr('whatsapp.total', 'Total')}: ${order.total_amount}`);
  if (order?.service_status_token && baseUrl) {
    lines.push(`🔎 ${tr('whatsapp.track', 'Track your car service')}: ${baseUrl.replace(/\/$/, '')}/service-status/${order.service_status_token}`);
  } else if (baseUrl) {
    lines.push(baseUrl);
  }
  return lines.join('\n');
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

export default { shareViaWhatsApp, buildOrderMessage, buildCustomerMessage };
