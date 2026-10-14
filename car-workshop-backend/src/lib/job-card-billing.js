/**
 * job-card-billing.js — what an itemised job card is worth, and keeping its
 * invoice equal to it.
 *
 * Applies only to work_orders.billing_basis = 'itemised' (every job card
 * created since 20261006_job_card_billing.sql). Legacy 'service_fee' rows
 * are never touched here — their items are a breakdown of a gross
 * service_fee, and summing them would double-bill.
 *
 *   subtotal = service_fee + Σ(item quantity × unit price)
 *   taxable  = subtotal − discount
 *   VAT      = taxable × rate          (parts are taxable supplies too)
 *   total    = taxable + VAT
 *
 * cash_amount is kept equal to the items total so the screens that already
 * read it as "Parts & services" stay right; nothing bills from it.
 */
import { query, execute } from './database.js';
import { config } from '../config.js';
import { getFinancialConfig } from './financial.js';

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** VAT rate for a job card: the workshop's own setting if it has one, else
 *  the platform default from VAT_ENABLED / VAT_RATE; 0 for a tax-exempt customer. */
export async function resolveVatRate(workshopId, customerId) {
  const fin = await getFinancialConfig(workshopId);
  const enabled = fin.vatEnabledSetting ?? config.vatEnabled;
  if (!enabled) return 0;
  if (customerId) {
    const [c] = await query('SELECT tax_exempt FROM customers WHERE id = ? AND workshop_id = ?', [customerId, workshopId]);
    if (c?.tax_exempt === 1) return 0;
  }
  return Number(fin.vatRateSetting ?? config.vatRate) || 0;
}

export function computeJobCardTotals({ serviceFee = 0, discount = 0, items = [], vatRate = 0 }) {
  const itemsTotal = round2(items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0));
  const fee = Math.max(0, Number(serviceFee) || 0);
  const subtotal = round2(fee + itemsTotal);
  const disc = Math.min(subtotal, Math.max(0, Number(discount) || 0));
  const taxable = round2(subtotal - disc);
  const vatAmount = round2(taxable * (Number(vatRate) || 0) / 100);
  return { itemsTotal, fee, subtotal, discount: disc, taxable, vatRate: Number(vatRate) || 0, vatAmount, total: round2(taxable + vatAmount) };
}

const INVOICE_ITEM_TYPE = { labour: 'service', sublet: 'service', parts: 'parts', consumable: 'parts' };

/** Invoice lines for an itemised job card: labour/service fee, every item, discount. */
function invoiceLines(totals, items) {
  const lines = [];
  if (totals.fee > 0) lines.push({ item_type: 'service', description: 'Labour / service fee', quantity: 1, unit_price: totals.fee, total: totals.fee });
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    lines.push({
      item_type: INVOICE_ITEM_TYPE[it.item_type] || 'parts',
      description: it.name, quantity: qty, unit_price: Number(it.unit_price) || 0,
      total: round2(qty * (Number(it.unit_price) || 0)),
    });
  }
  if (totals.discount > 0) lines.push({ item_type: 'discount', description: 'Discount', quantity: 1, unit_price: 0, total: -totals.discount, discount: totals.discount });
  return lines;
}

async function writeInvoiceLines(invoiceId, lines) {
  for (const l of lines) {
    await execute(
      `INSERT INTO invoice_items (invoice_id, item_type, description, quantity, unit_price, total, discount)
       VALUES (?,?,?,?,?,?,?)`,
      [invoiceId, l.item_type, l.description, l.quantity, l.unit_price, l.total, l.discount || 0]
    );
  }
}

/**
 * Recompute an itemised job card from its items and persist the totals.
 * Returns { workOrder, items, totals }, or null for a legacy 'service_fee'
 * job card (or a database the migration has not reached yet).
 */
export async function recalcWorkOrder(workOrderId, workshopId) {
  let wo;
  try {
    [wo] = await query(
      'SELECT id, work_order_number, billing_basis, service_fee, discount, customer_id FROM work_orders WHERE id = ? AND workshop_id = ?',
      [workOrderId, workshopId]
    );
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      console.error('[JobCardBilling] billing_basis missing — apply migrations/20261006_job_card_billing.sql');
      return null;
    }
    throw err;
  }
  if (!wo || wo.billing_basis !== 'itemised') return null;

  const items = await query(
    'SELECT id, name, item_type, quantity, unit_price FROM work_order_items WHERE work_order_id = ? ORDER BY id',
    [workOrderId]
  );
  const vatRate = await resolveVatRate(workshopId, wo.customer_id);
  const totals = computeJobCardTotals({ serviceFee: wo.service_fee, discount: wo.discount, items, vatRate });

  await execute(
    `UPDATE work_orders
        SET cash_amount = ?, discount = ?, vat_rate = ?, vat_amount = ?, total_amount = ?
      WHERE id = ? AND workshop_id = ?`,
    [totals.itemsTotal, totals.discount, totals.vatRate, totals.vatAmount, totals.total, workOrderId, workshopId]
  );
  return { workOrder: wo, items, totals };
}

/** An invoice that has taken money (or been voided) is a record, not a draft. */
export function isInvoiceLocked(inv) {
  return !!inv && (['paid', 'partially_paid', 'void', 'cancelled'].includes(inv.status) || Number(inv.amount_paid) > 0);
}

export async function getInvoiceForWorkOrder(workOrderId, workshopId) {
  const [inv] = await query(
    'SELECT id, invoice_number, status, amount_paid FROM invoices WHERE work_order_id = ? AND workshop_id = ? ORDER BY id LIMIT 1',
    [workOrderId, workshopId]
  );
  return inv || null;
}

/**
 * Bring an itemised job card's totals — and its invoice, while that invoice
 * is still unpaid — back in line with what is on the job card.
 * Returns { recalculated, invoice_id, invoice_locked }.
 */
export async function syncJobCardBilling(workOrderId, workshopId) {
  const r = await recalcWorkOrder(workOrderId, workshopId);
  if (!r) return { recalculated: false };
  const inv = await getInvoiceForWorkOrder(workOrderId, workshopId);
  if (!inv) return { recalculated: true, invoice_id: null };
  if (isInvoiceLocked(inv)) return { recalculated: true, invoice_id: inv.id, invoice_locked: true };

  const { totals, items } = r;
  await execute(
    `UPDATE invoices SET subtotal = ?, discount_amount = ?, tax_rate = ?, tax_amount = ?, total_amount = ?
      WHERE id = ?`,
    [totals.subtotal, totals.discount, totals.vatRate, totals.vatAmount, totals.total, inv.id]
  );
  await execute('DELETE FROM invoice_items WHERE invoice_id = ?', [inv.id]);
  await writeInvoiceLines(inv.id, invoiceLines(totals, items));
  return { recalculated: true, invoice_id: inv.id, invoice_locked: false };
}

/**
 * Create the invoice for an itemised job card. Caller has already checked
 * that none exists and allocated the number.
 */
export async function createItemisedInvoice({ order, invoiceNumber, currency, createdBy }) {
  const r = await recalcWorkOrder(order.id, order.workshop_id);
  if (!r) return null;
  const { totals, items } = r;
  const result = await execute(
    `INSERT INTO invoices (workshop_id, work_order_id, invoice_number, customer_id,
      subtotal, discount_amount, tax_rate, tax_amount, total_amount,
      currency, status, payment_method, created_by)
     VALUES (?,?,?,?, ?,?,?,?,?, ?,?,?,?)`,
    [order.workshop_id, order.id, invoiceNumber, order.customer_id,
     totals.subtotal, totals.discount, totals.vatRate, totals.vatAmount, totals.total,
     currency, 'sent', order.payment_method || 'cash', createdBy || null]
  );
  await writeInvoiceLines(result.insertId, invoiceLines(totals, items));
  return { id: result.insertId, invoice_number: invoiceNumber };
}

/**
 * SQL for what a job card was billed, for revenue reporting. Itemised job
 * cards carry labour in service_fee and parts in items, totalled in
 * total_amount; legacy rows carry their whole bill in service_fee.
 * `alias` is the table prefix including the dot ('o.'), or ''.
 */
export function revenueSql(alias = '') {
  const a = alias;
  return `(CASE WHEN ${a}billing_basis = 'itemised' THEN ${a}total_amount ELSE ${a}service_fee - COALESCE(${a}discount, 0) END)`;
}
