/**
 * portalShared.js — small pieces several portal pages use: status badges for
 * invoices and estimates, and the invoice PDF download.
 */
import api from '../../lib/customerApi';

/** { cls, text } for an invoice's payment state. */
export function invoiceStatusBadge(t, inv) {
  if (inv.status === 'paid' || (inv.balance <= 0 && inv.total_amount > 0)) return { cls: 'cp-badge-ok', text: t('portal.invoices.status_paid', 'Paid') };
  if (inv.status === 'overdue') return { cls: 'cp-badge-bad', text: t('portal.invoices.status_overdue', 'Overdue') };
  if (inv.status === 'partially_paid' || inv.amount_paid > 0) return { cls: 'cp-badge-warn', text: t('portal.invoices.status_part_paid', 'Part paid') };
  return { cls: 'cp-badge-warn', text: t('portal.invoices.status_due', 'To pay') };
}

/** { cls, text } for an estimate sent to the customer. */
export function estimateStatusBadge(t, e) {
  if (e.awaiting_decision) return { cls: 'cp-badge-warn', text: t('portal.estimate.awaiting', 'Waiting for your decision') };
  switch (e.status) {
    case 'approved': case 'converted': return { cls: 'cp-badge-ok', text: t('portal.estimate.approved', 'Approved') };
    case 'partially_approved': return { cls: 'cp-badge-ok', text: t('portal.estimate.partly_approved', 'Partly approved') };
    case 'rejected': return { cls: 'cp-badge-bad', text: t('portal.estimate.declined', 'Declined') };
    case 'expired': return { cls: '', text: t('portal.estimate.expired', 'Expired') };
    default: return { cls: 'cp-badge-info', text: t('portal.estimate.sent', 'Sent to you') };
  }
}

/** Download an invoice PDF with the customer's login. Rejects on failure. */
export async function downloadInvoicePdf(inv) {
  const res = await api.raw(`/customer-portal/invoices/${inv.id}/pdf`);
  if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${inv.invoice_number || `invoice-${inv.id}`}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
