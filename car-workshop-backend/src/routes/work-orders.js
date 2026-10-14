/**
 * ═══════════════════════════════════════════════════════════════════
 *  Work Orders Routes — Master CRUD for car-workshop work orders
 * ═══════════════════════════════════════════════════════════════════
 *
 * Rebranded/ported from the delivery-service `orders.js`. Renames applied:
 *   orders -> work_orders, order_items -> work_order_items,
 *   order_status_logs -> work_order_status_logs,
 *   order_assignments -> work_order_assignments,
 *   order_scan_logs -> work_order_scan_logs,
 *   drivers -> mechanics, clients -> customers, zones -> service_bays,
 *   tracking_token -> service_status_token, driver_rating -> mechanic_rating,
 *   cod_amount/delivery_fee -> cash_amount/service_fee.
 *
 * JUDGMENT CALLS:
 *  - Status enum kept per car_workshop.sql:
 *      pending -> confirmed -> assigned -> accepted -> in_progress ->
 *      inspection -> ready_for_pickup -> completed / cancelled
 *    (delivery-only statuses 'picked_up'/'in_transit'/'returned' dropped;
 *    'returned' work now maps to the separate warranty-claims flow. No
 *    separate 'failed' outcome — a job that doesn't complete is cancelled,
 *    failure_reason still records why.)
 *  - sender_ and recipient_ order fields collapsed into customer_id + vehicle_id
 *    + a redundant customer_name/phone/email snapshot on the work order
 *    (matches car_workshop.sql work_orders columns exactly).
 *  - Packages/AWB/shipping-label/pre-generated-barcode machinery from the
 *    source file is NOT ported here — that belongs to parts.js (inventory
 *    parts) and service-job-sheet.js (PDF generator) respectively. This file
 *    keeps the pre-generated SERVICE STATUS TOKEN flow (pregenerated_tokens
 *    table) since that maps 1:1 onto work orders (service_status_token),
 *    not onto packages.
 *  - weight_kg/dimensions/category(parcel,food,...) dropped; replaced with
 *    service_category enum from the schema.
 *  - vehicle_id is included in create/update and vehicles are JOINed for
 *    make/model/plate_number in list/detail responses.
 *  - Multi-stop / route-matrix auto-assign logic from the original dispatch
 *    flow does NOT live here — see job-assignment.js. This file only owns
 *    work order CRUD, status transitions, items, and mechanic rating.
 * ═══════════════════════════════════════════════════════════════════
 */
import express from 'express';
import pool, { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireManager, isTechnician } from '../lib/access.js';
import { notifyWorkOrderStatus, notifyMechanicAssigned } from '../lib/notify.js';
import { dispatchWebhook, workOrderStatusToEvent } from '../lib/webhook-dispatcher.js';
import { createInvoiceFromWorkOrder } from './invoices.js';
import { getFinancialConfig, computeWorkOrderFinancials, recordMechanicEarning } from '../lib/financial.js';
import { syncJobCardBilling, getInvoiceForWorkOrder, isInvoiceLocked, computeJobCardTotals, resolveVatRate } from '../lib/job-card-billing.js';
import { ensureMainJobCard, announceMainJobCard, departmentFor, JC_QC_PASSED, onTechnicianAssigned, onWorkApproved } from '../lib/workflow.js';
import { requireCapability, can, isManagerRole } from '../lib/roles.js';
import { woLabel, woDisplayKey, WO_DISPLAY_KEYS } from '../lib/status-labels.js';
import {
  customerApprovalMissing, recordCustomerApproval, nothingToApprove, jobClassification,
  CUSTOMER_APPROVAL_CHANNELS, CUSTOMER_APPROVAL_REQUIRED, NOTHING_TO_APPROVE,
} from '../lib/job-card-approval.js';
import { logAudit } from '../lib/audit.js';
import { checkLimit as checkLimitFn, getUsageStats } from '../middleware/plan-gate.js';
import { serviceStatusToken } from '../lib/tokens.js';
import { stripMarkupFields, clampTextFields } from '../lib/sanitize.js';
import { issueSurveyOnClosure } from '../lib/survey-trigger.js';
import { createTask } from '../lib/crm-cycle.js';
import { scheduleNextReminder } from './crm-reminders.js';

// SR-01/SR-16 — sanitise at the write boundary. Identity fields can never
// legitimately contain markup, so it is stripped; free text is stored verbatim
// because HTML-stripping a note destroys legitimate content such as
// "worn < 2mm". Only keys actually present in the body are touched, so the
// update routes' "default to the existing row" destructuring still works.
const WORK_ORDERS_IDENTITY = ['customer_name', 'customer_phone', 'customer_email', 'dropoff_address', 'pickup_address', 'service_category', 'recipient_name', 'recipient_phone', 'recipient_address', 'recipient_area', 'recipient_emirate'];
const WORK_ORDERS_FREE_TEXT = ['notes', 'special_instructions', 'description'];
function _clean(body) {
  return clampTextFields(stripMarkupFields(body || {}, WORK_ORDERS_IDENTITY), WORK_ORDERS_FREE_TEXT);
}


// ── Intake rules shared by create and edit ───────────────────────────────
// (New Job Card, document Steps 1–3.) Validation failures are thrown as
// InputError and answered with their own status and code.

const VALID_WORK_ORDER_TYPES = ['standard', 'express', 'same_day', 'scheduled', 'warranty'];
const VALID_SERVICE_CATEGORIES = ['oil_change', 'brake_repair', 'diagnostic', 'bodywork', 'tire_service', 'engine_repair', 'transmission', 'electrical', 'general_maintenance', 'other'];
const VALID_PAY_METHODS = ['cash', 'prepaid', 'credit', 'wallet'];
// How the request reached the Service Advisor (document Step 2: manual /
// walk-in or phone, WhatsApp, website, social media). 'fleet_link' and 'api'
// are written only by the fleet-coordinator link and the API.
const STAFF_INTAKE_CHANNELS = ['advisor', 'whatsapp', 'website', 'social'];
const PAYER_TYPES = ['self_pay', 'insurance', 'corporate', 'fleet'];
const ITEM_TYPES = ['labour', 'parts', 'sublet', 'consumable'];
const CLOSED_STATUSES = ['completed', 'cancelled'];
const MAX_MONEY = 99999999.99;   // DECIMAL(10,2)
const MAX_QTY = 9999999.999;     // DECIMAL(10,3)
const MAX_ODOMETER = 9999999;    // a stray digit on 732,759 km, not a reading
const TEXT_MAX = 5000;           // the free-text clamp in lib/sanitize.js

class InputError extends Error {
  constructor(message, code = 'INVALID_INPUT', http = 400, extra = null) {
    super(message); this.code = code; this.http = http; this.extra = extra;
  }
}
const sendError = (res, e) => res.status(e.http).json({ success: false, code: e.code, message: e.message, ...(e.extra || {}) });

// The complaint and the technician's notes are refused when too long rather
// than cut short without a word (the free-text clamp in _clean is the limit).
function refuseOverlongText(raw) {
  for (const [k, label] of [['description', 'The complaint'], ['special_instructions', 'The notes for the technician']]) {
    if (typeof raw?.[k] === 'string' && raw[k].trim().length > TEXT_MAX) {
      throw new InputError(`${label} is too long (${TEXT_MAX.toLocaleString('en-US')} characters at most).`, 'TEXT_TOO_LONG');
    }
  }
}

// A number as typed: 12, '12', '12.50'. '1,200', '1e3', '' and the like are
// not numbers (NaN) — they are refused rather than read as something else.
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v ?? '').trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
const decimals = n => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
const isBlank = v => v === undefined || v === null || String(v).trim() === '';

/** A money field: blank is 0; negatives, non-numbers and over-long values are refused. */
function parseMoney(v, label) {
  if (isBlank(v)) return 0;
  const n = toNumber(v);
  if (Number.isNaN(n)) throw new InputError(`${label} must be a number.`);
  if (n < 0) throw new InputError(`${label} cannot be negative.`);
  if (n > MAX_MONEY || decimals(n) > 2) throw new InputError(`${label} looks wrong — check the amount (at most 2 decimals).`);
  return n;
}

/**
 * The odometer as typed. Thousands separators ('45,320') and Arabic-Indic
 * digits are a reading; '12.5', '1e5' and '-500' are not, and are refused
 * instead of being stored as 12, 1 or 500. Returns null when blank.
 */
export function parseOdometer(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new InputError('Mileage must be a whole number of kilometres.', 'INVALID_ODOMETER');
    if (v < 0) throw new InputError('Mileage cannot be negative.', 'INVALID_ODOMETER');
    if (v > MAX_ODOMETER) throw new InputError('Mileage looks wrong — check the reading.', 'INVALID_ODOMETER');
    return v;
  }
  let s = String(v).trim()
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0));
  if (!s) return null;
  if (/^\d{1,3}([,٬ ]\d{3})+$/.test(s)) s = s.replace(/[,٬ ]/g, '');
  if (/^-\s*\d/.test(s)) throw new InputError('Mileage cannot be negative.', 'INVALID_ODOMETER');
  if (!/^\d+$/.test(s)) throw new InputError('Mileage must be a whole number of kilometres.', 'INVALID_ODOMETER');
  const n = Number(s);
  if (n > MAX_ODOMETER) throw new InputError('Mileage looks wrong — check the reading.', 'INVALID_ODOMETER');
  return n;
}

/** A record id from the body: blank is null; anything but a positive integer is refused. */
function parseId(v, what) {
  if (isBlank(v)) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new InputError(`${what} not found.`, `${what.toUpperCase().replace(/ /g, '_')}_NOT_FOUND`);
  return n;
}

/**
 * Job card lines as sent. A completely empty row is dropped; a priced row
 * needs a description; quantity must be above 0 (absent = 1) and the price 0
 * or more. Nothing is quietly turned into another value — what is saved is
 * what the screen showed.
 */
function parseLines(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new InputError('items must be a list of lines.');
  const out = [];
  raw.forEach((it, i) => {
    if (!it || typeof it !== 'object') throw new InputError(`Line ${i + 1} is not valid.`, 'INVALID_LINE');
    const name = String(it.name ?? '').trim();
    const label = name ? `Line ${i + 1} (${name.slice(0, 40)})` : `Line ${i + 1}`;
    const price = isBlank(it.unit_price) ? 0 : toNumber(it.unit_price);
    if (!name) {
      if (Number.isNaN(price) || price !== 0) throw new InputError(`${label}: give the line a description, or remove it.`, 'INVALID_LINE');
      return;
    }
    if (name.length > 255) throw new InputError(`${label}: the description is too long (255 characters at most).`, 'INVALID_LINE');
    const qty = it.quantity === undefined || it.quantity === null ? 1 : toNumber(it.quantity);
    if (!(qty > 0)) throw new InputError(`${label}: the quantity must be more than 0.`, 'INVALID_LINE');
    if (qty > MAX_QTY || decimals(qty) > 3) throw new InputError(`${label}: the quantity looks wrong.`, 'INVALID_LINE');
    if (Number.isNaN(price)) throw new InputError(`${label}: the price must be a number.`, 'INVALID_LINE');
    if (price < 0) throw new InputError(`${label}: the price cannot be negative.`, 'INVALID_LINE');
    if (price > MAX_MONEY || decimals(price) > 2) throw new InputError(`${label}: the price looks wrong (at most 2 decimals).`, 'INVALID_LINE');
    if (qty * price > MAX_MONEY) throw new InputError(`${label}: the line total is too large.`, 'INVALID_LINE');
    const id = isBlank(it.id) ? null : Number(it.id);
    if (id !== null && !(Number.isInteger(id) && id > 0)) throw new InputError(`${label} is not valid.`, 'INVALID_LINE');
    out.push({
      id, name, quantity: qty, unit_price: price,
      notes: isBlank(it.notes) ? null : String(it.notes).slice(0, 5000),
      item_type: ITEM_TYPES.includes(it.item_type) ? it.item_type : null,
    });
  });
  return out;
}

const linesTotal = lines => lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0);

/** Who pays, from the Step 1 classification: fleets and insurers on account, walk-ins themselves. */
function payerFor(cls, sub) {
  if (cls === 'internal') return sub === 'insurance' ? 'insurance' : 'fleet';
  if (sub === 'fleet') return 'fleet';
  if (sub === 'insurance') return 'insurance';
  return 'self_pay';
}

/** A customer of this workshop that may have a job card raised against it. */
async function loadCustomer(id, workshopId, { requireActive = true } = {}) {
  const [c] = await query(
    'SELECT id, full_name, phone, email, is_active, customer_class, customer_subcategory FROM customers WHERE id = ? AND workshop_id = ?',
    [id, workshopId]
  );
  if (!c) throw new InputError('Customer not found.', 'CUSTOMER_NOT_FOUND');
  if (requireActive && c.is_active === 0) {
    throw new InputError('This customer account is deactivated. Reactivate it under Customers before raising a job card.', 'CUSTOMER_INACTIVE');
  }
  return c;
}

/** Real accounts on file can carry '-' as their phone; the snapshot then keeps what was given. */
const phoneOf = (customer, given) => (/\d/.test(String(customer.phone || '')) ? customer.phone : (String(given || '').trim() || customer.phone || ''));

/** A vehicle of this workshop, owned by the customer when one is given. */
async function loadVehicle(id, workshopId, customerId) {
  const [v] = await query(
    'SELECT id, customer_id, vin, plate_number, mileage FROM vehicles WHERE id = ? AND workshop_id = ?',
    [id, workshopId]
  );
  if (!v) throw new InputError('Vehicle not found.', 'VEHICLE_NOT_FOUND');
  if (customerId && Number(v.customer_id) !== Number(customerId)) {
    throw new InputError('This vehicle is not on file for this customer. Choose one of their vehicles, or add it to them first.', 'VEHICLE_NOT_CUSTOMERS');
  }
  return v;
}

const VIN_REQUIRED = {
  code: 'VIN_REQUIRED',
  message: 'This vehicle has no VIN / chassis number on file. Add it before raising the job card.',
};

/** TIMESTAMPs come back as 'YYYY-MM-DD HH:MM:SS'; compare them as such. */
const stamp = v => (v == null ? '' : String(v).replace('T', ' ').slice(0, 19));

/**
 * Why the job's customer and vehicle can no longer change, or null while it
 * is still at intake: no estimate raised, nothing agreed or paid, no work
 * started (D9). After that the estimate, approval and job cards are about a
 * particular customer and car.
 */
async function intakeLockReason(wo, workshopId) {
  if (!['pending', 'confirmed', 'estimate_approved'].includes(wo.status)) return `the job is already at "${woLabel(wo)}"`;
  if (wo.customer_approved_at) return 'the customer has already approved it';
  const [est] = await query(
    `SELECT estimate_number FROM service_estimates
      WHERE workshop_id = ? AND (intake_work_order_id = ? OR work_order_id = ?) AND status NOT IN ('rejected','expired') LIMIT 1`,
    [workshopId, wo.id, wo.id]
  );
  if (est) return `estimate ${est.estimate_number} has been raised for it`;
  const [paid] = await query(
    `SELECT invoice_number FROM invoices WHERE work_order_id = ? AND workshop_id = ? AND status NOT IN ('void','cancelled')
        AND (amount_paid > 0 OR status IN ('paid','partially_paid')) LIMIT 1`,
    [wo.id, workshopId]
  );
  if (paid) return `invoice ${paid.invoice_number} has taken payment`;
  const [booked] = await query(
    'SELECT t.id FROM technician_time_logs t JOIN job_cards jc ON jc.id = t.job_card_id WHERE jc.work_order_id = ? AND jc.workshop_id = ? LIMIT 1',
    [wo.id, workshopId]
  );
  if (booked) return 'time has been booked on it';
  return null;
}

const router = express.Router();
router.use(authMiddleware);

// A technician (mechanic login) reads only the job cards assigned to them —
// on the work order or on any of its job cards — not the whole book with
// every customer's phone and e-mail. Workshop totals and the token tools are
// not theirs at all.
//
// ASSIGNED_TO_MECHANIC is that test as SQL on a work order aliased `wo`; it
// takes the technician's mechanics.id twice. routes/uploads.js uses it too.
export const ASSIGNED_TO_MECHANIC = `(wo.mechanic_id = ? OR EXISTS (SELECT 1 FROM job_cards jcm WHERE jcm.work_order_id = wo.id AND jcm.mechanic_id = ?))`;
router.use(async (req, res, next) => {
  if (!isTechnician(req.user)) return next();
  try {
    const [m] = await query('SELECT id FROM mechanics WHERE user_id = ? AND workshop_id = ?', [req.user.id, req.workshopId]);
    req.ownMechanicId = m?.id || 0;
    if (req.method === 'GET' && req.path === '/') return next();
    const hit = req.method === 'GET' && req.path.match(/^\/(\d+)(?:\/(?:items|photos|label))?\/?$/);
    if (!hit) return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Your account does not have access to this.' });
    const [own] = await query(
      `SELECT wo.id FROM work_orders wo WHERE wo.id = ? AND wo.workshop_id = ? AND ${ASSIGNED_TO_MECHANIC}`,
      [hit[1], req.workshopId, req.ownMechanicId, req.ownMechanicId]
    );
    if (!own) return res.status(404).json({ success: false, message: 'Work order not found' });
    return next();
  } catch (err) {
    console.error('[WorkOrders] technician scope:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load work orders' });
  }
});

export function genWorkOrderNumber() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `WO-${stamp}-${rand}`;
}

// Helper — generate unique service status token (customer-facing tracking token).
// The customer's status page opens with it and no login, so it is 128 bits from
// the CSPRNG like every other token (lib/tokens.js) — pre-printed ones were
// 'WO-' + 32 bits, few enough to guess.
function genServiceStatusToken() {
  return serviceStatusToken();
}

// GET /api/work-orders/stats — aggregate KPIs for the workshop
router.get('/stats', async (req, res) => {
  try {
    const [counts] = await query(
      `SELECT
         COUNT(*) as total,
         SUM(status = 'pending')          as pending,
         SUM(status = 'confirmed')        as confirmed,
         SUM(status = 'estimate_approved') as estimate_approved,
         SUM(status = 'auto_assign')      as auto_assign,
         SUM(status IN ('pending','confirmed') AND customer_approved_at IS NOT NULL) as approved_waiting,
         SUM(status = 'assigned')         as assigned,
         SUM(status = 'accepted')         as accepted,
         SUM(status = 'in_progress')      as in_progress,
         SUM(status = 'inspection')       as inspection,
         SUM(status = 'ready_for_pickup') as ready_for_pickup,
         SUM(status = 'completed')        as completed,
         SUM(status = 'cancelled')        as cancelled,
         COALESCE(SUM(service_fee), 0)    as total_revenue,
         COALESCE(SUM(cash_amount), 0)    as total_cash,
         COALESCE(SUM(total_amount), 0)   as total_amount,
         COALESCE(SUM(commission_amount), 0) as total_commission,
         COALESCE(SUM(vat_amount), 0)     as total_vat,
         COALESCE(SUM(net_payable), 0)    as total_net_payable,
         SUM(DATE(created_at) = CURDATE()) as today,
         SUM(YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)) as this_week,
         SUM(YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())) as this_month
       FROM work_orders WHERE workshop_id = ?`,
      [req.workshopId]
    );
    const byType = await query(
      `SELECT work_order_type, COUNT(*) as count FROM work_orders WHERE workshop_id = ? GROUP BY work_order_type`,
      [req.workshopId]
    );
    const byPayment = await query(
      `SELECT payment_method, COUNT(*) as count FROM work_orders WHERE workshop_id = ? GROUP BY payment_method`,
      [req.workshopId]
    );
    const topCustomers = await query(
      `SELECT c.id, c.full_name, c.company_name, c.type,
              COUNT(wo.id) as total_work_orders,
              SUM(CASE WHEN wo.status='completed' THEN 1 ELSE 0 END) as completed_work_orders,
              COALESCE(SUM(wo.service_fee), 0) as revenue
       FROM work_orders wo
       INNER JOIN customers c ON wo.customer_id = c.id
       WHERE wo.workshop_id = ?
       GROUP BY c.id ORDER BY total_work_orders DESC LIMIT 5`,
      [req.workshopId]
    );
    return res.json({ success: true, data: { ...counts, by_type: byType, by_payment: byPayment, top_customers: topCustomers } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Failed to fetch work order stats' });
  }
});

// GET /api/work-orders
router.get('/', async (req, res) => {
  try {
    const { status, mechanic_id, customer_id, service_bay_id, date_from, date_to,
            work_order_type, payment_method, search, page = 1, limit = 50,
            sort_by, sort_dir } = req.query;
    const pg = parseInt(page, 10) || 1;
    const lim = parseInt(limit, 10) || 50;
    const offset = (pg - 1) * lim;

    let where = 'WHERE wo.workshop_id = ?';
    const params = [req.workshopId];

    // A technician sees only their own jobs (see the scope guard above).
    if (req.ownMechanicId !== undefined) { where += ` AND ${ASSIGNED_TO_MECHANIC}`; params.push(req.ownMechanicId, req.ownMechanicId); }
    // One status or a comma-separated list ('pending,confirmed,estimate_approved,auto_assign'
    // is the Waiting chip, 'assigned,accepted' Technician assigned).
    if (status) {
      const list = [...new Set(String(status).split(',').map(s => s.trim()).filter(Boolean))];
      if (list.length) { where += ` AND wo.status IN (${list.map(() => '?').join(',')})`; params.push(...list); }
    }
    if (mechanic_id) { where += ' AND wo.mechanic_id = ?'; params.push(mechanic_id); }
    if (customer_id) { where += ' AND wo.customer_id = ?'; params.push(customer_id); }
    if (service_bay_id) { where += ' AND wo.service_bay_id = ?'; params.push(service_bay_id); }
    if (work_order_type) { where += ' AND wo.work_order_type = ?'; params.push(work_order_type); }
    if (payment_method) { where += ' AND wo.payment_method = ?'; params.push(payment_method); }
    if (date_from) { where += ' AND DATE(wo.created_at) >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND DATE(wo.created_at) <= ?'; params.push(date_to); }
    if (search) {
      // Plate and VIN live on vehicles; a subquery keeps the COUNT(*) below
      // (which has no join) and the row query agreeing.
      where += ` AND (wo.work_order_number LIKE ? OR wo.customer_name LIKE ? OR wo.customer_phone LIKE ? OR wo.service_status_token LIKE ?
                 OR wo.vehicle_id IN (SELECT vs.id FROM vehicles vs WHERE vs.workshop_id = wo.workshop_id AND (vs.plate_number LIKE ? OR vs.vin LIKE ?)))`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [{ total }] = await query(`SELECT COUNT(*) as total FROM work_orders wo ${where}`, params);
    // Timestamps go out as stored, like every other route: the database keeps
    // workshop wall-clock time. created_at and assigned_at used to get +4 h on
    // top (a delivery-app leftover), so 'Created' read later than 'Started'.
    const workOrders = await query(
      `SELECT wo.*, m.full_name as mechanic_name, m.phone as mechanic_phone,
              m.specialty as mechanic_specialty, m.status as mechanic_status,
              c.full_name as customer_name_ref, b.name as service_bay_name,
              v.make as vehicle_make, v.model as vehicle_model, v.plate_number as vehicle_plate_number,
              (SELECT jc.job_card_number FROM job_cards jc
                WHERE jc.work_order_id = wo.id AND jc.parent_job_card_id IS NULL AND jc.status <> 'cancelled'
                ORDER BY jc.id LIMIT 1) AS main_job_card_number,
              wo.scheduled_at,
              COALESCE(wa.assigned_at, wsl_assign.created_at, wo.created_at) AS assigned_at
       FROM work_orders wo
       LEFT JOIN mechanics m ON wo.mechanic_id = m.id
       LEFT JOIN customers c ON wo.customer_id = c.id
       LEFT JOIN service_bays b ON wo.service_bay_id = b.id
       LEFT JOIN vehicles v ON wo.vehicle_id = v.id
       LEFT JOIN work_order_assignments wa ON wa.work_order_id = wo.id AND wa.mechanic_id = wo.mechanic_id AND wa.is_current = TRUE
       LEFT JOIN (SELECT work_order_id, MIN(created_at) AS created_at FROM work_order_status_logs WHERE status = 'assigned' GROUP BY work_order_id) wsl_assign ON wsl_assign.work_order_id = wo.id
       ${where} ORDER BY ${(() => {
         const validCols = { date:'wo.created_at', cash:'wo.cash_amount', bay:'b.name', status:'wo.status', customer:'wo.customer_name', work_order_number:'wo.work_order_number', completed_at:'wo.completed_at', total_amount:'wo.total_amount' };
         const col = validCols[sort_by];
         if (col) { const d = sort_dir === 'asc' ? 'ASC' : 'DESC'; return `${col} ${d}`; }
         return 'GREATEST(COALESCE(wo.completed_at, wo.created_at), COALESCE(wo.failed_at, wo.created_at), wo.created_at) DESC';
       })()}
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );
    return res.json({ success: true, data: workOrders, pagination: { total, page: pg, limit: lim } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Failed to fetch work orders' });
  }
});

/* ══════════════════════════════════════════════════════════════
   Pre-generated service status tokens (ported from MODULE A —
   pre-order barcode pre-printing). Kept because service_status_token
   is a work-order-level concept in the new schema, not a package one.
   ══════════════════════════════════════════════════════════════ */

// POST /api/work-orders/pre-generate — create N blank service status tokens without a work order
router.post('/pre-generate', async (req, res) => {
  try {
    const count = Math.min(Math.max(parseInt(req.body.count) || 1, 1), 200);
    const batch_name = req.body.batch_name || null;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // tokens expire in 30 days
    const expiresStr = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

    const tokens = [];
    for (let i = 0; i < count; i++) {
      // Generate unique token — retry on collision
      let token, attempts = 0;
      while (attempts < 5) {
        token = genServiceStatusToken();
        const [exists] = await query(
          'SELECT id FROM pregenerated_tokens WHERE service_status_token = ? UNION SELECT id FROM work_orders WHERE service_status_token = ?',
          [token, token]
        );
        if (!exists) break;
        attempts++;
      }
      if (attempts >= 5) {
        return res.status(500).json({ success: false, message: 'Failed to generate unique tokens. Please try again.' });
      }

      const result = await execute(
        `INSERT INTO pregenerated_tokens (workshop_id, service_status_token, barcode_value, batch_name, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [req.workshopId, token, token, batch_name, expiresStr]
      );

      tokens.push({
        id: result.insertId,
        service_status_token: token,
        barcode_value: token,
        batch_name,
        expires_at: expiresStr,
      });
    }

    return res.status(201).json({
      success: true,
      message: `Generated ${tokens.length} pre-printed service status tokens`,
      data: tokens,
    });
  } catch (err) {
    console.error('[WorkOrders] Pre-generate error:', err);
    return res.status(500).json({ success: false, message: 'Failed to pre-generate tokens' });
  }
});

// GET /api/work-orders/pre-generated — list pre-generated tokens for this workshop
router.get('/pre-generated', async (req, res) => {
  try {
    const { used, batch_name, page = 1, limit = 100 } = req.query;
    const pg  = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(Math.max(1, parseInt(limit) || 100), 500);
    const offset = (pg - 1) * lim;

    let where = 'WHERE pt.workshop_id = ?';
    const params = [req.workshopId];

    if (used === 'false' || used === '0') {
      where += ' AND pt.is_used = 0 AND (pt.expires_at IS NULL OR pt.expires_at > NOW())';
    } else if (used === 'true' || used === '1') {
      where += ' AND pt.is_used = 1';
    }
    if (batch_name) {
      where += ' AND pt.batch_name = ?';
      params.push(batch_name);
    }

    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM pregenerated_tokens pt ${where}`,
      params
    );
    const tokens = await query(
      `SELECT pt.*,
              wo.work_order_number, wo.customer_name, wo.status as work_order_status,
              DATEDIFF(pt.expires_at, NOW()) as days_remaining
       FROM pregenerated_tokens pt
       LEFT JOIN work_orders wo ON pt.work_order_id = wo.id
       ${where} ORDER BY pt.created_at DESC LIMIT ${lim} OFFSET ${offset}`,
      params
    );

    return res.json({ success: true, data: tokens, pagination: { total, page: pg, limit: lim } });
  } catch (err) {
    console.error('[WorkOrders] Pre-generated list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch pre-generated tokens' });
  }
});

// GET /api/work-orders/pre-generated/stats — summary counts for pre-generated tokens
router.get('/pre-generated/stats', async (req, res) => {
  try {
    const [counts] = await query(
      `SELECT
         COUNT(*) as total,
         CAST(COALESCE(SUM(is_used = 0 AND (expires_at IS NULL OR expires_at > NOW())), 0) AS UNSIGNED) as available,
         CAST(COALESCE(SUM(is_used = 1), 0) AS UNSIGNED) as used,
         CAST(COALESCE(SUM(is_used = 0 AND expires_at IS NOT NULL AND expires_at <= NOW()), 0) AS UNSIGNED) as expired
       FROM pregenerated_tokens WHERE workshop_id = ?`,
      [req.workshopId]
    );
    return res.json({ success: true, data: { total: Number(counts.total), available: Number(counts.available), used: Number(counts.used), expired: Number(counts.expired) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// DELETE /api/work-orders/pre-generated/:id — delete a single unused pre-generated token
router.delete('/pre-generated/:id', async (req, res) => {
  try {
    const [token] = await query(
      'SELECT id, is_used FROM pregenerated_tokens WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!token) return res.status(404).json({ success: false, message: 'Token not found' });
    if (token.is_used) return res.status(400).json({ success: false, message: 'Cannot delete a token that has been linked to a work order' });

    await execute('DELETE FROM pregenerated_tokens WHERE id = ?', [req.params.id]);
    return res.json({ success: true, message: 'Token deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to delete token' });
  }
});

// POST /api/work-orders/pre-generated/:id/link — link an available token to an existing work order
router.post('/pre-generated/:id/link', async (req, res) => {
  try {
    const { work_order_id } = req.body;
    if (!work_order_id) return res.status(400).json({ success: false, message: 'work_order_id is required' });

    const [token] = await query(
      'SELECT id, service_status_token, is_used, expires_at FROM pregenerated_tokens WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!token) return res.status(404).json({ success: false, message: 'Token not found' });
    if (token.is_used) return res.status(400).json({ success: false, message: 'Token is already linked to a work order' });
    if (token.expires_at && new Date(token.expires_at) <= new Date()) {
      return res.status(400).json({ success: false, message: 'Token has expired' });
    }

    const [workOrder] = await query(
      'SELECT id, work_order_number, service_status_token FROM work_orders WHERE id = ? AND workshop_id = ?',
      [work_order_id, req.workshopId]
    );
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });

    // Update the work order's service_status_token to the pre-generated token
    await execute(
      'UPDATE work_orders SET service_status_token = ?, pregenerated_token_id = ? WHERE id = ?',
      [token.service_status_token, token.id, workOrder.id]
    );

    // Mark token as used
    await execute(
      'UPDATE pregenerated_tokens SET is_used = 1, work_order_id = ?, used_at = NOW() WHERE id = ?',
      [workOrder.id, token.id]
    );

    return res.json({
      success: true,
      message: `Token ${token.service_status_token} linked to work order ${workOrder.work_order_number}`,
      data: { token_id: token.id, work_order_id: workOrder.id, work_order_number: workOrder.work_order_number, service_status_token: token.service_status_token }
    });
  } catch (err) {
    console.error('[WorkOrders] Link token error:', err);
    return res.status(500).json({ success: false, message: 'Failed to link token to work order' });
  }
});

// POST /api/work-orders/pre-generated/:id/unlink — unlink a token from its linked work order
router.post('/pre-generated/:id/unlink', async (req, res) => {
  try {
    const [token] = await query(
      'SELECT id, service_status_token, is_used, work_order_id FROM pregenerated_tokens WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!token) return res.status(404).json({ success: false, message: 'Token not found' });
    if (!token.is_used || !token.work_order_id) {
      return res.status(400).json({ success: false, message: 'Token is not linked to any work order' });
    }

    // Generate a new random service status token for the work order so it's not left empty
    const newToken = genServiceStatusToken();
    await execute(
      'UPDATE work_orders SET service_status_token = ?, pregenerated_token_id = NULL WHERE id = ? AND workshop_id = ?',
      [newToken, token.work_order_id, req.workshopId]
    );

    // Mark token as available again
    await execute(
      'UPDATE pregenerated_tokens SET is_used = 0, work_order_id = NULL, used_at = NULL WHERE id = ?',
      [token.id]
    );

    return res.json({
      success: true,
      message: `Token ${token.service_status_token} unlinked`,
      data: { token_id: token.id, service_status_token: token.service_status_token }
    });
  } catch (err) {
    console.error('[WorkOrders] Unlink token error:', err);
    return res.status(500).json({ success: false, message: 'Failed to unlink token' });
  }
});

// GET /api/work-orders/linkable — search work orders that can be linked (for barcode link modal)
router.get('/linkable', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const search = q.trim();
    let where = 'WHERE wo.workshop_id = ?';
    const params = [req.workshopId];

    if (search) {
      where += ' AND (wo.work_order_number LIKE ? OR wo.customer_name LIKE ? OR wo.service_status_token LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const workOrders = await query(
      `SELECT wo.id, wo.work_order_number, wo.customer_name, wo.status, wo.service_status_token, wo.created_at
       FROM work_orders wo ${where}
       ORDER BY wo.created_at DESC LIMIT 20`,
      params
    );
    return res.json({ success: true, data: workOrders });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch work orders' });
  }
});

// POST /api/work-orders/validate-pregenerated — check if a token is valid and available
router.post('/validate-pregenerated', async (req, res) => {
  try {
    const { service_status_token } = req.body;
    if (!service_status_token) return res.status(400).json({ success: false, message: 'service_status_token required' });

    const [token] = await query(
      `SELECT pt.*, wo.work_order_number
       FROM pregenerated_tokens pt
       LEFT JOIN work_orders wo ON pt.work_order_id = wo.id
       WHERE pt.service_status_token = ? AND pt.workshop_id = ?`,
      [service_status_token.trim().toUpperCase(), req.workshopId]
    );

    if (!token) {
      return res.json({ success: true, data: { valid: false, reason: 'not_found' } });
    }
    if (token.is_used) {
      return res.json({ success: true, data: { valid: false, reason: 'already_used', work_order_number: token.work_order_number } });
    }
    if (token.expires_at && new Date(token.expires_at) <= new Date()) {
      return res.json({ success: true, data: { valid: false, reason: 'expired' } });
    }
    return res.json({ success: true, data: { valid: true, token_id: token.id, service_status_token: token.service_status_token } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Validation failed' });
  }
});

// GET /api/work-orders/:id
router.get('/:id', async (req, res) => {
  try {
    const [workOrder] = await query(
      `SELECT wo.*, m.full_name as mechanic_name, m.phone as mechanic_phone,
              m.specialty as mechanic_specialty, m.status as mechanic_status,
              c.full_name as customer_name_ref, c.phone as customer_phone_ref, c.company_name,
              b.name as service_bay_name,
              v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year,
              v.plate_number as vehicle_plate_number, v.vin as vehicle_vin, v.color as vehicle_color,
              ua.full_name AS customer_approved_by_name,
              wo.scheduled_at,
              COALESCE(wa.assigned_at, wsl_assign.created_at, wo.created_at) AS assigned_at
       FROM work_orders wo
       LEFT JOIN mechanics m ON wo.mechanic_id = m.id
       LEFT JOIN customers c ON wo.customer_id = c.id
       LEFT JOIN service_bays b ON wo.service_bay_id = b.id
       LEFT JOIN vehicles v ON wo.vehicle_id = v.id
       LEFT JOIN users ua ON ua.id = wo.customer_approved_by
       LEFT JOIN work_order_assignments wa ON wa.work_order_id = wo.id AND wa.mechanic_id = wo.mechanic_id AND wa.is_current = TRUE
       LEFT JOIN (SELECT work_order_id, MIN(created_at) AS created_at FROM work_order_status_logs WHERE status = 'assigned' GROUP BY work_order_id) wsl_assign ON wsl_assign.work_order_id = wo.id
       WHERE wo.id = ? AND wo.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });

    const items = await query('SELECT * FROM work_order_items WHERE work_order_id = ?', [req.params.id]);
    const statusLogs = await query(
      `SELECT sl.*, u.full_name as changed_by_name
       FROM work_order_status_logs sl
       LEFT JOIN users u ON sl.changed_by = u.id
       WHERE sl.work_order_id = ? ORDER BY sl.created_at ASC, sl.id ASC`,
      [req.params.id]
    );

    // Include parts used on this work order, if any
    let parts = [];
    try {
      parts = await query(
        'SELECT * FROM parts WHERE work_order_id = ? AND workshop_id = ? ORDER BY created_at ASC',
        [req.params.id, req.workshopId]
      );
    } catch (_) { /* parts table may not exist yet */ }

    // Include completion photos
    let photos = [];
    try {
      photos = await query(
        'SELECT id, photo_url, photo_type, caption, mechanic_id, lat, lng, uploaded_at FROM completion_photos WHERE work_order_id = ? ORDER BY uploaded_at ASC',
        [req.params.id]
      );
    } catch (_) { /* completion_photos table may not exist yet */ }

    return res.json({ success: true, data: { ...workOrder, items, parts, photos, status_logs: statusLogs } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch work order' });
  }
});

// GET /api/work-orders/:id/photos — get all completion photos for a work order (admin)
router.get('/:id/photos', async (req, res) => {
  try {
    const [workOrder] = await query(
      'SELECT id FROM work_orders WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });

    const photos = await query(
      `SELECT cp.*, m.full_name as mechanic_name
       FROM completion_photos cp
       LEFT JOIN mechanics m ON cp.mechanic_id = m.id
       WHERE cp.work_order_id = ? AND cp.workshop_id = ?
       ORDER BY cp.uploaded_at ASC`,
      [workOrder.id, req.workshopId]
    );

    return res.json({ success: true, data: photos });
  } catch (err) {
    console.error('[WorkOrders] get photos error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load photos' });
  }
});

// GET /api/work-orders/:id/label — staff-facing job-sheet/label PDF for one work order
router.get('/:id/label', async (req, res) => {
  try {
    const [order] = await query(
      `SELECT o.*, b.name as service_bay_name, c.company_name, c.full_name as customer_full_name
       FROM work_orders o
       LEFT JOIN service_bays b ON o.service_bay_id = b.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = ? AND o.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'Work order not found' });

    const [itemCount] = await query('SELECT COUNT(*) as cnt FROM work_order_items WHERE work_order_id = ?', [order.id]);
    order.item_count = itemCount?.cnt || 0;

    // Latest completed inspection (intake preferred) — attached so the PDF
    // generator can append the walk-around damage sheet.
    order._inspection = await fetchLatestInspection(order.id, req.workshopId);

    const [workshop] = await query('SELECT * FROM workshops WHERE id = ?', [req.workshopId]);

    let template = null;
    try {
      const [row] = await query("SELECT `value` FROM settings WHERE workshop_id = ? AND `key` = 'label_template'", [req.workshopId]);
      if (row?.value) template = JSON.parse(row.value);
    } catch (_) {}

    const { generateServiceJobSheetPDF } = await import('../lib/service-job-sheet.js');
    await generateServiceJobSheetPDF(res, { orders: [order], tenant: workshop, template });
  } catch (err) {
    console.error('[WorkOrders] label error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate label' });
  }
});

// Helper: pull the most recent completed inspection for a work order and
// parse its JSON marks payload once. Returns null if none exists.
async function fetchLatestInspection(workOrderId, workshopId) {
  try {
    const [row] = await query(
      `SELECT id, inspection_type, marks, notes, completed_at, plate_number, odometer,
              customer_name, vehicle_make, vehicle_model, vehicle_year
         FROM vehicle_inspections
        WHERE work_order_id = ? AND workshop_id = ? AND status = 'completed'
        ORDER BY inspection_type = 'intake' DESC, completed_at DESC LIMIT 1`,
      [workOrderId, workshopId]
    );
    if (!row) return null;
    let marks = [];
    if (row.marks) {
      try { marks = typeof row.marks === 'string' ? JSON.parse(row.marks) : row.marks; } catch (_) { marks = []; }
    }
    return { ...row, marks: Array.isArray(marks) ? marks : [] };
  } catch (e) {
    console.error('[WorkOrders] inspection fetch failed:', e.message);
    return null;
  }
}

// POST /api/work-orders/labels — batch job-sheet/label PDF for multiple work orders
router.post('/labels', async (req, res) => {
  try {
    const { work_order_ids } = req.body;
    if (!Array.isArray(work_order_ids) || !work_order_ids.length) {
      return res.status(400).json({ success: false, message: 'work_order_ids required' });
    }

    const orders = await query(
      `SELECT o.*, b.name as service_bay_name, c.company_name, c.full_name as customer_full_name
       FROM work_orders o
       LEFT JOIN service_bays b ON o.service_bay_id = b.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id IN (?) AND o.workshop_id = ?`,
      [work_order_ids, req.workshopId]
    );
    if (!orders.length) return res.status(404).json({ success: false, message: 'No matching work orders found' });

    for (const order of orders) {
      const [itemCount] = await query('SELECT COUNT(*) as cnt FROM work_order_items WHERE work_order_id = ?', [order.id]);
      order.item_count = itemCount?.cnt || 0;
      order._inspection = await fetchLatestInspection(order.id, req.workshopId);
    }

    const [workshop] = await query('SELECT * FROM workshops WHERE id = ?', [req.workshopId]);

    let template = null;
    try {
      const [row] = await query("SELECT `value` FROM settings WHERE workshop_id = ? AND `key` = 'label_template'", [req.workshopId]);
      if (row?.value) template = JSON.parse(row.value);
    } catch (_) {}

    const { generateServiceJobSheetPDF } = await import('../lib/service-job-sheet.js');
    await generateServiceJobSheetPDF(res, { orders, tenant: workshop, template });
  } catch (err) {
    console.error('[WorkOrders] batch labels error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate labels' });
  }
});

// DELETE /api/work-orders/:id/photos/:photoId — delete a photo (admin)
router.delete('/:id/photos/:photoId', async (req, res) => {
  try {
    const [photo] = await query(
      'SELECT id, photo_url FROM completion_photos WHERE id = ? AND work_order_id = ? AND workshop_id = ?',
      [req.params.photoId, req.params.id, req.workshopId]
    );
    if (!photo) return res.status(404).json({ success: false, message: 'Photo not found' });

    await execute('DELETE FROM completion_photos WHERE id = ?', [photo.id]);

    // Clean up file from disk
    const path = await import('path');
    const filePath = path.resolve('uploads', '..', photo.photo_url);
    const fs = await import('fs');
    fs.default.unlink(filePath, () => {});

    return res.json({ success: true, message: 'Photo deleted' });
  } catch (err) {
    console.error('[WorkOrders] delete photo error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete photo' });
  }
});

// POST /api/work-orders — the New Job Card (document Steps 1–3).
//
// The work order, its lines, the customer's approval (when given), the
// status log and the main job card are written in one transaction: either
// the job card exists with everything on it, or nothing was saved. The floor
// and the customer are told only once it has committed.
router.post('/', requireCapability('job.open'), async (req, res) => {
  let conn;
  try {
    // D.2 — Check monthly work order limit before creating
    if (req.subscription && !req.subscription.bypass) {
      const workshopId = req.workshopId || req.user?.workshop_id;
      const usage = await getUsageStats(workshopId);
      const maxWorkOrders = req.subscription.limits?.max_work_orders_per_month || 1000;
      if (usage.work_orders_this_month >= maxWorkOrders) {
        return res.status(403).json({
          success: false,
          upgrade_required: true,
          limit_type: 'max_work_orders_per_month',
          current_usage: usage.work_orders_this_month,
          limit: maxWorkOrders,
          current_plan: req.subscription.plan,
          message: `Work order limit reached (${usage.work_orders_this_month}/${maxWorkOrders}). Upgrade your plan for more work orders.`,
        });
      }
    }

    refuseOverlongText(req.body);
    const body = _clean(req.body);
    const {
      work_order_type = 'standard', service_category = 'general_maintenance',
      customer_name, customer_phone, customer_email,
      dropoff_address, dropoff_lat, dropoff_lng,
      description, special_instructions, scheduled_at,
      payment_method = 'cash', notes,
      pregenerated_token, // optional pre-printed service status token
    } = body;
    // Not taken from this route: mechanic_id (the Team Leader assigns in
    // Step 6), fleet_intake_id (only the fleet-coordinator link converts a
    // fleet request) and bypass_intake_required (below).
    const manager = isManagerRole(req.user);
    const customerId = parseId(body.customer_id, 'Customer');
    const vehicleId = parseId(body.vehicle_id, 'Vehicle');
    const serviceBayId = parseId(body.service_bay_id, 'Service bay');

    // ── Step 1: the customer, and the classification the job keeps ──
    // The name / phone snapshot is the customer record's, not whatever the
    // client sent alongside the id, so the list, the invoice and the
    // messages show the customer the job is actually for.
    const customer = customerId ? await loadCustomer(customerId, req.workshopId) : null;
    const resolvedName = customer ? customer.full_name : String(customer_name || '').trim();
    const resolvedPhone = customer ? phoneOf(customer, customer_phone) : String(customer_phone || '').trim();
    const resolvedEmail = (customer?.email || String(customer_email || '').trim()) || null;
    if (!resolvedName || !resolvedPhone) {
      return res.status(400).json({ success: false, message: 'Customer name and phone required' });
    }
    const intakeClass = customer?.customer_class || null;
    const intakeSub = customer?.customer_subcategory || null;

    // ── Mandatory intake data (process change, 15 Sep 2026) ──
    // VIN, mileage and the vehicle complaint are required on every new job
    // card. Enforced here rather than by a NOT NULL column because 96% of
    // vehicles and 99% of work orders on file predate the rule — the
    // constraint belongs on new intake, not retroactively on twenty
    // thousand rows of history.
    //
    // This is the staff route: bypass_intake_required is ignored here. The
    // importer writes SQL and the API integration has /api/v1/work_orders;
    // honouring the flag let any advisor skip the complaint and mileage.
    const complaint = String(description || '').trim();
    if (!complaint) {
      return res.status(400).json({ success: false, code: 'COMPLAINT_REQUIRED', message: 'The vehicle complaint is required.' });
    }
    // The odometer reading is optional (the process asks for the vehicle
    // information and the issue, not a mandatory reading); when typed it must
    // be a sensible whole number.
    const odometer = parseOdometer(body.odometer_in);
    // The VIN lives on the vehicle, not the work order, so it is checked
    // against the vehicle being booked in — which must be this customer's.
    // No vehicle at all is still allowed: a job card can legitimately be
    // raised before the car arrives.
    const vehicle = vehicleId ? await loadVehicle(vehicleId, req.workshopId, customerId) : null;
    if (vehicle && !String(vehicle.vin || '').trim()) {
      return res.status(400).json({ success: false, ...VIN_REQUIRED });
    }
    if (serviceBayId) {
      const [bay] = await query('SELECT id FROM service_bays WHERE id = ? AND workshop_id = ?', [serviceBayId, req.workshopId]);
      if (!bay) throw new InputError('Service bay not found.', 'SERVICE_BAY_NOT_FOUND');
    }

    const intakeChannel = isBlank(body.intake_channel) ? 'advisor' : String(body.intake_channel);
    if (!STAFF_INTAKE_CHANNELS.includes(intakeChannel)) {
      throw new InputError('Received via must be Walk-in / phone (advisor), WhatsApp, Website or Social media.', 'INVALID_INTAKE_CHANNEL');
    }

    // Coerce empty-string ENUM fields to their defaults (CSV/bulk-import often sends "")
    const _work_order_type = (!work_order_type || !VALID_WORK_ORDER_TYPES.includes(work_order_type)) ? 'standard' : work_order_type;
    const _service_category = (!service_category || !VALID_SERVICE_CATEGORIES.includes(service_category)) ? 'general_maintenance' : service_category;
    const _payment_method = (!payment_method || !VALID_PAY_METHODS.includes(payment_method)) ? 'cash' : payment_method;

    // ── Counter pricing (wizard page 4) ──
    // An EXTERNAL customer's job is priced on the estimate after the
    // inspection: the Storekeeper prices parts, the Service Advisor labour,
    // and the Supervisor / Workshop Manager approves it (Steps 4–5). Lines,
    // a fee or a discount at intake skip all of that, so on a new external
    // job they are a manager's call. Internal (routine fleet) jobs may be
    // priced at the counter.
    const lines = parseLines(body.items);
    const serviceFee = parseMoney(body.service_fee, 'Service fee');
    const discount = parseMoney(body.discount, 'Discount');
    const subtotal = serviceFee + linesTotal(lines);
    if (discount > subtotal + 0.001) throw new InputError('The discount is more than the job card\'s subtotal.', 'DISCOUNT_TOO_LARGE');
    if (subtotal > MAX_MONEY) throw new InputError('The job card total is too large.', 'AMOUNT_TOO_LARGE');
    const priced = lines.length > 0 || serviceFee > 0;
    if ((priced || discount > 0) && intakeClass !== 'internal' && !manager) {
      return res.status(400).json({
        success: false, code: 'PRICE_ON_ESTIMATE',
        message: 'An external customer\'s job is priced on the estimate after the inspection, not at the counter. Open the job card without lines, fee or discount.',
      });
    }

    // ── The customer's agreement at the counter (Step 6) ──
    // Only for a job priced right here, and only by someone who records
    // customer decisions (customer.approval).
    const approvalChannel = isBlank(req.body.customer_approval_channel) ? null : String(req.body.customer_approval_channel);
    if (approvalChannel) {
      if (!CUSTOMER_APPROVAL_CHANNELS.includes(approvalChannel)) {
        throw new InputError('customer_approval_channel must be in_person, phone or written', 'INVALID_APPROVAL_CHANNEL');
      }
      if (!can(req.user, 'customer.approval')) {
        return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Your role can\'t record the customer\'s approval. Open the job card without it; the Service Advisor records it.' });
      }
      if (!priced) return res.status(400).json({ success: false, ...NOTHING_TO_APPROVE });
    }

    // Fleets and insurers are billed on account, walk-ins pay themselves.
    const payerType = manager && PAYER_TYPES.includes(body.payer_type) ? body.payer_type : payerFor(intakeClass, intakeSub);

    // Priced exactly as syncJobCardBilling prices an itemised job card, so
    // the total the customer may approve here is the job card's total.
    const vatRate = await resolveVatRate(req.workshopId, customerId);
    const totals = computeJobCardTotals({ serviceFee, discount, items: lines, vatRate });
    let finConfig;
    try { finConfig = await getFinancialConfig(req.workshopId); } catch { finConfig = { commissionPercent: 0, vatEnabled: false, vatRate: 0, vatNumber: '', applyVatOnServiceFee: true, applyVatOnCash: false }; }
    const fin = computeWorkOrderFinancials({ serviceFee, discount, cashAmount: totals.itemsTotal, config: finConfig });

    // ── Use pre-generated token if provided, else generate new one ──
    let pregenerated = null;
    if (pregenerated_token) {
      const tokenVal = String(pregenerated_token).trim().toUpperCase();
      const [pt] = await query(
        'SELECT id, service_status_token, is_used, expires_at FROM pregenerated_tokens WHERE service_status_token = ? AND workshop_id = ?',
        [tokenVal, req.workshopId]
      );
      if (!pt) {
        return res.status(400).json({ success: false, message: 'Pre-generated token not found' });
      }
      if (pt.is_used) {
        return res.status(400).json({ success: false, message: 'This service status token is already linked to a work order' });
      }
      if (pt.expires_at && new Date(pt.expires_at) <= new Date()) {
        return res.status(400).json({ success: false, message: 'This service status token has expired' });
      }
      pregenerated = pt;
    }

    // Told, not refused: the car already has a job card open (a second
    // visit can be legitimate), or the reading is below the last one on file.
    const warnings = [];
    if (vehicle) {
      const open = await query(
        `SELECT id, work_order_number, status FROM work_orders
          WHERE vehicle_id = ? AND workshop_id = ? AND status NOT IN ('completed','cancelled') ORDER BY id DESC LIMIT 3`,
        [vehicle.id, req.workshopId]
      );
      for (const o of open) {
        warnings.push({ code: 'OPEN_JOB_CARD', work_order_id: o.id, work_order_number: o.work_order_number, status: o.status,
          message: `${vehicle.plate_number || 'This vehicle'} already has job card ${o.work_order_number} open (${woLabel(o.status)}).` });
      }
      if (odometer != null && vehicle.mileage != null && odometer < Number(vehicle.mileage)) {
        warnings.push({ code: 'ODOMETER_BELOW_LAST', last_mileage: Number(vehicle.mileage),
          message: `The reading (${odometer.toLocaleString('en-US')} km) is below the last one on file (${Number(vehicle.mileage).toLocaleString('en-US')} km); the vehicle keeps the higher figure.` });
      }
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Lock the vehicle first. The work order and job card inserts below take
    // a shared lock on it (their foreign key), and the mileage update then
    // needs an exclusive one: two job cards opened at once for the same car
    // each held the shared lock and waited on the other (ER_LOCK_DEADLOCK,
    // a 500 for the advisor). Taking the row lock up front queues them.
    if (vehicle) await conn.query('SELECT id FROM vehicles WHERE id = ? AND workshop_id = ? FOR UPDATE', [vehicle.id, req.workshopId]);

    // The number is a random 4-digit draw per day; a collision is drawn
    // again rather than failing the advisor's "Create job card".
    let workOrderId, serviceToken;
    for (let attempt = 0; ; attempt++) {
      const work_order_number = genWorkOrderNumber();
      serviceToken = pregenerated ? pregenerated.service_status_token : serviceStatusToken(); // SR-08 — was 48-bit
      try {
        const [result] = await conn.query(
          `INSERT INTO work_orders (workshop_id, work_order_number, customer_id, vehicle_id, service_bay_id, work_order_type, service_category,
            customer_name, customer_phone, customer_email,
            dropoff_address, dropoff_lat, dropoff_lng, description, special_instructions,
            scheduled_at, payment_method, payer_type, cash_amount, service_fee, discount, total_amount,
            commission_rate, commission_amount, vat_rate, vat_amount, platform_fee, net_payable,
            odometer_in, intake_channel, intake_customer_class, intake_customer_subcategory,
            status, service_status_token, pregenerated_token_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          [req.workshopId, work_order_number, customerId, vehicleId, serviceBayId, _work_order_type, _service_category,
           resolvedName, resolvedPhone, resolvedEmail,
           dropoff_address || null, dropoff_lat || null, dropoff_lng || null,
           complaint, special_instructions || null, scheduled_at || null,
           _payment_method, payerType, totals.itemsTotal, serviceFee, totals.discount, totals.total,
           fin.commissionRate, fin.commissionAmount, totals.vatRate, totals.vatAmount, fin.platformFee, fin.netPayable,
           odometer, intakeChannel, intakeClass, intakeSub,
           serviceToken, pregenerated?.id || null, notes || null]
        );
        workOrderId = result.insertId;
        break;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        if (pregenerated && /service_status_token/.test(err.message)) {
          throw new InputError('This service status token is already linked to a work order', 'TOKEN_USED');
        }
        if (attempt >= 9) throw err;
      }
    }

    // Keep the vehicle's own odometer current. Guarded with a comparison so
    // a job card keyed in late — or a typo that reads lower than the last
    // known reading — cannot wind the vehicle's mileage backwards, which
    // would make its next service interval fire early and its history
    // non-monotonic.
    if (vehicle && odometer != null) {
      await conn.query(
        'UPDATE vehicles SET mileage = ? WHERE id = ? AND workshop_id = ? AND (mileage IS NULL OR mileage < ?)',
        [odometer, vehicle.id, req.workshopId, odometer]
      );
    }

    // Mark pre-generated token as used
    if (pregenerated) {
      await conn.query(
        'UPDATE pregenerated_tokens SET is_used = 1, work_order_id = ?, used_at = NOW() WHERE id = ?',
        [workOrderId, pregenerated.id]
      );
    }

    for (const line of lines) {
      await conn.query(
        'INSERT INTO work_order_items (work_order_id, name, item_type, quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?)',
        [workOrderId, line.name, line.item_type, line.quantity, line.unit_price, line.notes]
      );
    }

    await conn.query(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
      [workOrderId, 'pending', req.user.id, 'Work order created']
    );

    // The customer's agreement recorded at the counter — after the "created"
    // log, so the history reads in order, and against the priced total.
    if (approvalChannel) {
      await recordCustomerApproval({
        workOrderId, workshopId: req.workshopId, channel: approvalChannel,
        note: req.body.customer_approval_note, userId: req.user.id, db: conn,
      });
    }

    // Step 3: open the main job card, in the same transaction.
    await ensureMainJobCard({ workOrderId, workshopId: req.workshopId, userId: req.user.id, db: conn });

    await conn.commit();
    conn.release(); conn = null;

    // Opening the job card tells the Supervisor, Foreman and Team Leader a
    // request has been raised (Step 4) — or, when the customer already
    // agreed at the counter, that the work is approved and ready to assign.
    await announceMainJobCard({ workOrderId, workshopId: req.workshopId, userId: req.user.id, notify: !approvalChannel });
    if (approvalChannel) {
      await onWorkApproved({ workOrderId, workshopId: req.workshopId, userId: req.user.id, how: `${approvalChannel.replace('_', ' ')}, at the counter` });
      await logAudit({
        workshopId: req.workshopId, userId: req.user.id, action: 'CUSTOMER_APPROVAL', entityType: 'work_orders',
        entityId: workOrderId, oldValue: null,
        newValue: { channel: approvalChannel, total: totals.total, note: req.body.customer_approval_note || null, at: 'intake' },
      }).catch(e => console.error('[WorkOrders] approval audit:', e.message));
    }

    const [workOrder] = await query('SELECT * FROM work_orders WHERE id = ?', [workOrderId]);

    // Send notification for new work order (non-blocking)
    notifyWorkOrderStatus({
      order: workOrder, status: 'pending', workshopId: req.workshopId, changedBy: req.user.id,
    }).catch(e => console.error('[Notify] New work order error:', e.message));

    return res.status(201).json({ success: true, data: workOrder, warnings });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err instanceof InputError) return sendError(res, err);
    console.error('[WorkOrders] Create error:', err);
    const [http, payload] = dbErrorStatus(err, 'Failed to create work order');
    return res.status(http).json(payload);
  } finally {
    if (conn) conn.release();
  }
});

/** A database error as an HTTP status and body: bad input is a 400, not a 500. */
function dbErrorStatus(err, fallback) {
  const bad = (code, message) => [400, { success: false, code, message }];
  if (err.code === 'ER_WARN_DATA_OUT_OF_RANGE') return bad('OUT_OF_RANGE', 'One or more numeric values are out of range. Please check amounts.');
  if (err.code === 'WARN_DATA_TRUNCATED' || err.code === 'ER_TRUNCATED_WRONG_VALUE' || err.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD') {
    return bad('INVALID_VALUE', 'Invalid value for one or more fields. Please check work order type, category, and payment method.');
  }
  if (err.code === 'ER_DATA_TOO_LONG') return bad('TOO_LONG', 'One of the fields is too long.');
  if (err.code === 'ER_NO_REFERENCED_ROW' || err.code === 'ER_NO_REFERENCED_ROW_2') {
    return bad('INVALID_REFERENCE', 'Invalid reference: customer, vehicle, service bay, or mechanic does not exist.');
  }
  return [500, { success: false, message: fallback }];
}

/* ── Status transition map (per car_workshop.sql status enum) ─────────
   pending -> confirmed -> assigned -> accepted -> in_progress ->
   inspection -> ready_for_pickup -> completed / cancelled
   There is no separate 'failed' outcome — a job that doesn't complete is
   cancelled (failure_reason still records why).
   ─────────────────────────────────────────────────────────────────── */
const VALID_TRANSITIONS = {
  // Additive only — part of the work_orders.status rename (2026-09-14
  // meeting notes): 'estimate_approved' is the new first state for a job
  // card born from an approved estimate (routes/estimates.js
  // convertEstimateToWorkOrder), preceding the existing 'confirmed' step.
  // Every OTHER entry below is untouched: the full rename of pending/
  // confirmed/assigned/accepted is a separate, deliberately-deferred
  // migration — see 20260914_work_order_status_rename_widen.sql for why.
  estimate_approved: ['confirmed', 'cancelled'],
  pending:          ['confirmed', 'cancelled'],
  confirmed:        ['assigned', 'in_progress', 'cancelled'],
  assigned:         ['accepted', 'in_progress', 'cancelled', 'confirmed'],
  accepted:         ['in_progress', 'cancelled', 'assigned'],
  in_progress:      ['inspection', 'ready_for_pickup', 'cancelled'],
  inspection:       ['ready_for_pickup', 'in_progress', 'cancelled'],
  ready_for_pickup: ['completed', 'cancelled'],
  completed:        [],
  cancelled:        ['pending'],
};

/**
 * Why a work order cannot move to `status`, in the workshop's words, e.g.
 * 'This job is at "Quality check", so it can't go to "Closed". It can move to
 * "Ready for collection", back to "Work in progress" or to "Cancelled".'
 */
function transitionRefusal(workOrder, status, allowed) {
  const here = woLabel(workOrder);
  const step = rowOrStatus => WO_DISPLAY_KEYS.indexOf(woDisplayKey(rowOrStatus));
  // 'accepted' and 'assigned' both read "Technician assigned": a move between
  // them changes nothing the user sees, and each label is listed once.
  const moves = [...new Set(allowed.filter(s => woLabel(s) !== here)
    .map(s => `${s !== 'cancelled' && step(s) < step(workOrder) ? 'back ' : ''}to "${woLabel(s)}"`))];
  const next = !moves.length ? 'It cannot move on from here.'
    : `It can move ${moves.length > 1 ? `${moves.slice(0, -1).join(', ')} or ${moves[moves.length - 1]}` : moves[0]}.`;
  return `This job is at "${here}", so it can't go to "${woLabel(status)}". ${next}`;
}

/* ── Customer-journey checkpoint columns (layered on top of `status`,
   see the comment above the status enum in car_workshop.sql) ────────── */
const JOURNEY_STAGE_COLUMNS = {
  intake_inspection: 'intake_inspection_at',
  job_card_signed:   'job_card_signed_at',
  diagnosed:          'diagnosed_at',
  estimate_approved: 'estimate_approved_at',
  joint_inspection:  'joint_inspection_at',
  invoiced:           'invoiced_at',
};

// PATCH /api/work-orders/:id/journey — log a customer-journey checkpoint
router.patch('/:id/journey', async (req, res) => {
  try {
    const { stage } = req.body;
    const column = JOURNEY_STAGE_COLUMNS[stage];
    if (!column) {
      return res.status(400).json({ success: false, message: `Invalid journey stage. Allowed: ${Object.keys(JOURNEY_STAGE_COLUMNS).join(', ')}` });
    }
    const [workOrder] = await query(
      'SELECT id FROM work_orders WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });

    await execute(`UPDATE work_orders SET ${column} = NOW() WHERE id = ? AND workshop_id = ?`, [req.params.id, req.workshopId]);
    const [updated] = await query('SELECT * FROM work_orders WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[WorkOrders] Journey checkpoint error:', err);
    return res.status(500).json({ success: false, message: 'Failed to log journey checkpoint' });
  }
});

// Who may move a job card to each status by hand: the role responsible for
// that step (lib/roles.js; managers hold every capability). Opening,
// confirming, cancelling and reopening is intake (job.open); assigning is the
// Team Leader's; starting work is time booking; the quality-check statuses
// keep their own gates below; closing is the handover.
// Shared with PATCH /api/service-status/:token/status through canSetStatus().
export const STATUS_CAPABILITIES = Object.freeze({
  pending: ['job.open'], confirmed: ['job.open'], cancelled: ['job.open'],
  assigned: ['job.assign'], accepted: ['job.assign'],
  in_progress: ['time.book', 'job.assign'],
  inspection: ['qc.perform', 'job.assign'], ready_for_pickup: ['qc.perform', 'job.assign'],
  completed: ['delivery.handover'],
});

/**
 * Whether this user's role may move a work order to `status` by hand. A
 * status with no entry is not refused here — applyStatusChange() answers it
 * (an unknown status is a 400). Technicians are refused by each route before
 * this: they hold time.book, but they start work from My Jobs.
 */
export function canSetStatus(user, status) {
  const caps = STATUS_CAPABILITIES[status];
  return !caps || caps.some(c => can(user, c));
}

/** The 403 body when canSetStatus() says no. */
export function statusNotAllowed(status) {
  return { success: false, code: 'ROLE_NOT_ALLOWED', message: `Your role can't set a job card to "${woLabel(status)}".` };
}

// PATCH /api/work-orders/:id/status — update work order status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, note, lat, lng } = req.body;
    if (!canSetStatus(req.user, status)) return res.status(403).json(statusNotAllowed(status));
    const r = await applyStatusChange({
      workOrderId: req.params.id, workshopId: req.workshopId, userId: req.user.id, status, note, lat, lng,
    });
    if (!r.ok) return res.status(r.http).json({ success: false, ...(r.code ? { code: r.code } : {}), message: r.message, ...(r.extra || {}) });
    return res.json({ success: true, message: `Status updated: ${woLabel(status)}` });
  } catch (err) {
    console.error('[WorkOrders] status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

/**
 * Change a work order's status with every side effect of doing it by hand
 * (status log, auto-invoice, technician release, customer SMS/email/push,
 * webhooks). Shared by PATCH /:id/status and the workflow (lib/workflow.js
 * routes), so a status reached through a job card event behaves the same.
 * Returns { ok: true } or { ok: false, http, code?, message }.
 *
 * Workflow gates (Pioneer_Complete_Workshop_Workflow_Steps_1_to_7.pdf):
 * for a work order that has job cards, "ready for pickup" needs every job
 * card through the quality check (Step 7.1), and "completed" — closing the
 * job — needs the final gate pass (Step 7.2). Imported legacy work orders
 * have no job cards and are not held to either.
 */
export async function applyStatusChange({ workOrderId, workshopId, userId, status, note = null, lat = null, lng = null, skipGates = false }) {
    const validStatuses = ['pending','confirmed','assigned','accepted','in_progress','inspection','ready_for_pickup','completed','cancelled'];
    if (!validStatuses.includes(status)) {
      return { ok: false, http: 400, message: 'Invalid status' };
    }
    const [workOrder] = await query(
      `SELECT wo.*, c.email AS customer_email_ref
       FROM work_orders wo
       LEFT JOIN customers c ON wo.customer_id = c.id
       WHERE wo.id = ? AND wo.workshop_id = ?`,
      [workOrderId, workshopId]
    );
    if (!workOrder) return { ok: false, http: 404, message: 'Work order not found' };

    // Validate status transition
    const allowed = VALID_TRANSITIONS[workOrder.status] || [];
    if (workOrder.status !== status && !allowed.includes(status)) {
      return { ok: false, http: 400, code: 'INVALID_TRANSITION', message: transitionRefusal(workOrder, status, allowed) };
    }

    // Validate: cannot transition to "assigned" without a mechanic
    if (status === 'assigned' && !workOrder.mechanic_id) {
      return { ok: false, http: 400, message: 'Cannot assign work order without a mechanic. Please assign a mechanic first.' };
    }

    // No work begins without the customer's agreement (lib/job-card-approval.js)
    if (status === 'in_progress' && workOrder.status !== 'in_progress'
        && await customerApprovalMissing(workOrder.id, workshopId)) {
      return { ok: false, http: 409, ...CUSTOMER_APPROVAL_REQUIRED };
    }

    if (!skipGates && workOrder.status !== status && ['ready_for_pickup', 'completed'].includes(status)) {
      const cards = await query(
        "SELECT status FROM job_cards WHERE work_order_id = ? AND workshop_id = ? AND status <> 'cancelled'",
        [workOrder.id, workshopId]
      );
      if (cards.length && !cards.every(c => JC_QC_PASSED.includes(c.status))) {
        return { ok: false, http: 409, code: 'QC_REQUIRED',
          message: 'The quality check (with test drive) has not passed on every job card yet. Record it on the job card first.' };
      }
      if (cards.length && status === 'completed') {
        const [gp] = await query(
          "SELECT id FROM gate_passes WHERE work_order_id = ? AND workshop_id = ? AND status = 'released' LIMIT 1",
          [workOrder.id, workshopId]
        );
        if (!gp) {
          return { ok: false, http: 409, code: 'GATE_PASS_REQUIRED',
            message: 'Issue the final gate pass before closing the job.' };
        }
      }
    }

    const timestamps = {};
    if (status === 'in_progress' && !workOrder.started_at) timestamps.started_at = new Date();
    if (status === 'completed')   timestamps.completed_at = new Date();
    if (status === 'cancelled')   timestamps.cancelled_at = new Date();

    const setClause = ['status = ?', ...Object.keys(timestamps).map(k => `${k} = ?`)].join(', ');
    const setValues = [status, ...Object.values(timestamps), workOrderId, workshopId];

    await execute(`UPDATE work_orders SET ${setClause} WHERE id = ? AND workshop_id = ?`, setValues);
    await execute(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note, lat, lng) VALUES (?, ?, ?, ?, ?, ?)',
      [workOrderId, status, userId || null, note || null, lat || null, lng || null]
    );
    // ── AUTO-GENERATE INVOICE WHEN WORK ORDER IS CONFIRMED ──
    if (status === 'confirmed') {
      try {
        const invoice = await createInvoiceFromWorkOrder(workOrderId, workshopId, userId);
        if (invoice) {
          console.log(`Invoice ${invoice.invoice_number} auto-created for work order ${workOrder.work_order_number}`);
        }
      } catch (invoiceErr) {
        console.error('Failed to auto-create invoice:', invoiceErr.message);
        // Don't fail the work order status update if invoice creation fails
      }
    }

    // ── SAFETY NET: Also generate invoice when completed if none exists yet ──
    if (status === 'completed') {
      try {
        const invoice = await createInvoiceFromWorkOrder(workOrderId, workshopId, userId);
        if (invoice) {
          console.log(`Invoice ${invoice.invoice_number} auto-created on completion for work order ${workOrder.work_order_number}`);
        }
        // The invoice may have been raised at 'confirmed', before the job
        // grew; close-out is the last point it can still be brought level.
        await syncJobCardBilling(workOrderId, workshopId);
      } catch (invoiceErr) {
        console.error('Failed to auto-create invoice on completion:', invoiceErr.message);
      }
    }

    // If completed, increment mechanic total and auto-mark cash as collected
    if (status === 'completed' && workOrder.mechanic_id) {
      await execute('UPDATE mechanics SET total_jobs_completed = total_jobs_completed + 1 WHERE id = ?', [workOrder.mechanic_id]);

      // Auto-record mechanic earning
      recordMechanicEarning({
        workshopId: workshopId, mechanicId: workOrder.mechanic_id, workOrderId: workOrder.id,
        serviceFee: parseFloat(workOrder.service_fee) || 0,
        cashAmount: parseFloat(workOrder.cash_amount) || 0,
      }).catch(e => console.error('[WorkOrders] earning record error:', e.message));
    }
    if (status === 'completed' && workOrder.payment_method === 'cash') {
      await execute('UPDATE work_orders SET cash_collected = cash_amount WHERE id = ? AND workshop_id = ?', [workOrder.id, workshopId]);
    }

    // Schedule the journey's step-12 follow-up call (48h out) if one isn't already scheduled
    if (status === 'completed') {
      try {
        const [existing] = await query(
          'SELECT id FROM customer_feedback WHERE work_order_id = ? AND workshop_id = ?',
          [workOrder.id, workshopId]
        );
        if (!existing) {
          await execute(
            `INSERT INTO customer_feedback (workshop_id, work_order_id, customer_id, scheduled_at, status)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 48 HOUR), 'scheduled')`,
            [workshopId, workOrder.id, workOrder.customer_id || null]
          );
        }
      } catch (feedbackErr) {
        console.error('Failed to schedule follow-up call:', feedbackErr.message);
      }
    }

    // Auto-issue the satisfaction survey. No-op unless the branch has the
    // trigger switched on in Settings > Surveys; never throws.
    if (status === 'completed') {
      issueSurveyOnClosure({ workOrderId: workOrder.id, workshopId: workshopId })
        .catch(e => console.error('[SurveyTrigger] Error:', e.message));
      // After the visit (CRM cycle): the 48-hour satisfaction call lands in
      // Tasks & Follow-ups, and the car's next service is put on the
      // reminder list.
      await createTask({
        workshopId, title: `48-hour follow-up call — ${workOrder.work_order_number}${workOrder.customer_name ? ` · ${workOrder.customer_name}` : ''}`,
        details: 'Check the customer is happy with the work, note any issue, and ask for a review or a referral.',
        taskType: 'follow_up', customerId: workOrder.customer_id || null, vehicleId: workOrder.vehicle_id || null,
        relatedType: 'work_order', relatedId: workOrder.id, assignedTo: userId || null,
        dueAt: new Date(Date.now() + 48 * 3600 * 1000), createdBy: userId || null,
      });
      scheduleNextReminder({ workshopId, workOrderId: workOrder.id })
        .catch(e => console.error('[Reminders] next service:', e.message));
    }

    // A cancelled job takes its open job cards with it (and any time still
    // running), so they don't linger on the technician's phone or the floor.
    if (status === 'cancelled') {
      await execute(
        `UPDATE technician_time_logs t JOIN job_cards jc ON jc.id = t.job_card_id
            SET t.clock_out = NOW(), t.end_reason = 'stop'
          WHERE jc.work_order_id = ? AND jc.workshop_id = ? AND t.clock_out IS NULL`, [workOrder.id, workshopId]
      ).catch(e => console.error('[cancel] time logs:', e.message));
      await execute(
        `UPDATE job_cards SET status = 'cancelled'
          WHERE work_order_id = ? AND workshop_id = ? AND status NOT IN ('billed','cancelled')`, [workOrder.id, workshopId]
      ).catch(e => console.error('[cancel] job cards:', e.message));
    }

    // Release mechanic back to available when work order reaches a terminal status
    if (['completed','cancelled'].includes(status) && workOrder.mechanic_id) {
      const stillActive = await query(
        "SELECT id FROM work_orders WHERE mechanic_id = ? AND id != ? AND status IN ('assigned','accepted','in_progress') LIMIT 1",
        [workOrder.mechanic_id, workOrder.id]
      );
      if (!stillActive.length) {
        await execute("UPDATE mechanics SET status = 'available' WHERE id = ?", [workOrder.mechanic_id]);
      }
    }

    // ── Unified notifications: SMS + Email + Push + Socket.io ──
    // Enrich work order with mechanic info for notification templates
    let enrichedOrder = { ...workOrder };
    if (workOrder.mechanic_id) {
      const [mechanicInfo] = await query('SELECT full_name, phone FROM mechanics WHERE id = ?', [workOrder.mechanic_id]).catch(() => []);
      if (mechanicInfo) {
        enrichedOrder.mechanic_name = mechanicInfo.full_name;
        enrichedOrder.mechanic_phone = mechanicInfo.phone;
      }
    }
    // Fire all notification channels (non-blocking)
    notifyWorkOrderStatus({
      order: enrichedOrder, status, workshopId: workshopId, changedBy: userId,
    }).catch(e => console.error('[Notify] Error:', e.message));

    // Fire outbound webhooks (non-blocking)
    const webhookEvent = workOrderStatusToEvent(status);
    if (webhookEvent) {
      dispatchWebhook({ tenantId: workshopId, event: webhookEvent, data: enrichedOrder });
    }

    return { ok: true };
}

// PATCH /api/work-orders/:id/assign-mechanic — assign a mechanic to a work order
router.patch('/:id/assign-mechanic', requireCapability('job.assign'), async (req, res) => {
  try {
    const { mechanic_id } = req.body;
    if (!mechanic_id) return res.status(400).json({ success: false, message: 'mechanic_id required' });

    // work_order_number and the rest feed the "assigned" notifications; the
    // customer's phone / e-mail are left out on purpose (no customer SMS here).
    const [workOrder] = await query(
      `SELECT id, status, work_order_number, customer_name, dropoff_address, cash_amount, service_status_token
         FROM work_orders WHERE id = ? AND workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });

    const [mechanic] = await query(
      'SELECT id, full_name FROM mechanics WHERE id = ? AND workshop_id = ?',
      [mechanic_id, req.workshopId]
    );
    if (!mechanic) return res.status(404).json({ success: false, message: 'Mechanic not found' });

    await execute(
      "UPDATE work_orders SET mechanic_id = ?, status = CASE WHEN status IN ('pending','confirmed') THEN 'assigned' ELSE status END WHERE id = ? AND workshop_id = ?",
      [mechanic_id, req.params.id, req.workshopId]
    );

    // NOTE: Mechanic stays in current status until they explicitly accept.
    // Status changes to 'busy' in POST /api/mechanic-app/work-orders/:id/accept

    // Track assignment in work_order_assignments table (for assigned_at timestamp)
    await execute('UPDATE work_order_assignments SET is_current = FALSE WHERE work_order_id = ?', [req.params.id]);
    await execute(
      'INSERT INTO work_order_assignments (work_order_id, mechanic_id, assigned_by, assigned_at, is_current) VALUES (?, ?, ?, NOW(), TRUE)',
      [req.params.id, mechanic_id, req.user.id]
    );

    await execute(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
      [req.params.id, 'assigned', req.user.id, `Assigned to mechanic: ${mechanic.full_name}`]
    );

    // AUTO-GENERATE INVOICE WHEN WORK ORDER BECOMES CONFIRMED
    if (workOrder.status === 'pending') {
      try {
        const invoice = await createInvoiceFromWorkOrder(req.params.id, req.workshopId, req.user.id);
        if (invoice) {
          console.log(`Invoice ${invoice.invoice_number} auto-created for work order ${workOrder.id}`);
        }
      } catch (invoiceErr) {
        console.error('Failed to auto-create invoice:', invoiceErr.message);
        // Don't fail the assignment if invoice creation fails
      }
    }

    await onTechnicianAssigned({ workOrderId: Number(req.params.id), workshopId: req.workshopId, mechanicId: Number(mechanic_id) });

    // Notify mechanic via push notification (FCM + Web Push) + email + SMS to customer
    notifyMechanicAssigned({ order: workOrder, driver: mechanic, tenantId: req.workshopId })
      .catch(e => console.error('[assign-mechanic] notify error:', e.message));

    return res.json({ success: true, message: `Work order assigned to ${mechanic.full_name}`, mechanic_id });
  } catch (err) {
    console.error('[assign-mechanic]', err.message, err.stack?.split('\n')[1]);
    return res.status(500).json({ success: false, message: 'Failed to assign mechanic' });
  }
});

// ── Job card lines: one diff, used by both edit routes ───────────────────

const sameLine = (s, l) => s.name === l.name && Number(s.quantity) === l.quantity && Number(s.unit_price) === l.unit_price
  && (s.notes || null) === (l.notes || null) && (!l.item_type || l.item_type === s.item_type);

/**
 * How the stored lines become `lines`. A line sent back with its id is that
 * line (updated in place, so it keeps its sub-job card and estimate-line
 * link); an unchanged line sent without an id is recognised as the same
 * line; anything else is added, and stored lines not sent are removed.
 */
function diffLines(stored, lines) {
  const byId = new Map(stored.map(s => [s.id, s]));
  const keep = new Map();
  for (const l of lines.filter(x => x.id)) {
    if (!byId.has(l.id) || keep.has(l.id)) {
      throw new InputError('A line in this save is no longer on the job card. Reload the job card and try again.', 'LINE_NOT_FOUND', 409);
    }
    keep.set(l.id, l);
  }
  const add = [];
  for (const l of lines.filter(x => !x.id)) {
    const same = stored.find(s => !keep.has(s.id) && sameLine(s, l));
    if (same) keep.set(same.id, { ...l, id: same.id }); else add.push(l);
  }
  const update = [...keep].filter(([id, l]) => !sameLine(byId.get(id), l)).map(([, l]) => l);
  const remove = stored.filter(s => !keep.has(s.id));
  return { add, update, remove, changed: add.length + update.length + remove.length > 0 };
}

async function writeLines(conn, workOrderId, diff) {
  for (const l of diff.update) {
    await conn.query(
      'UPDATE work_order_items SET name = ?, quantity = ?, unit_price = ?, notes = ?, item_type = COALESCE(?, item_type) WHERE id = ? AND work_order_id = ?',
      [l.name, l.quantity, l.unit_price, l.notes, l.item_type, l.id, workOrderId]
    );
  }
  if (diff.remove.length) {
    await conn.query('DELETE FROM work_order_items WHERE work_order_id = ? AND id IN (?)', [workOrderId, diff.remove.map(r => r.id)]);
  }
  for (const l of diff.add) {
    await conn.query(
      'INSERT INTO work_order_items (work_order_id, name, item_type, quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [workOrderId, l.name, l.item_type, l.quantity, l.unit_price, l.notes]
    );
  }
}

/** The job's Step 1 class (intake snapshot, else the customer's). */
async function jobClassOf(wo, workshopId) {
  if (wo.intake_customer_class && wo.intake_customer_subcategory) return wo.intake_customer_class;
  const [c] = wo.customer_id
    ? await query('SELECT customer_class, customer_subcategory FROM customers WHERE id = ? AND workshop_id = ?', [wo.customer_id, workshopId])
    : [null];
  return jobClassification({ ...wo, customer_class: c?.customer_class, customer_subcategory: c?.customer_subcategory }).cls;
}

/**
 * Counter pricing on an external job that had none (page 4 of a job opened
 * without lines) is the same skip of Steps 4–5 the New Job Card refuses —
 * a manager's call. A job that was already priced at the counter (legacy)
 * keeps its page 4.
 */
async function refuseNewCounterPricing({ user, wo, workshopId, storedLines, becomesPriced }) {
  if (!becomesPriced || isManagerRole(user)) return;
  const wasPriced = storedLines > 0 || Number(wo.service_fee) > 0 || Number(wo.discount) > 0;
  if (wasPriced) return;
  if (await jobClassOf(wo, workshopId) === 'internal') return;
  throw new InputError('An external customer\'s job is priced on the estimate after the inspection, not at the counter.', 'PRICE_ON_ESTIMATE');
}

const staleEdit = current => new InputError(
  'This job card was changed by someone else since you opened it. Reload it and make your changes again.',
  'STALE_EDIT', 409, { updated_at: current.updated_at });

// PUT /api/work-orders/:id — edit a job card (the Edit wizard).
//
// Only the fields sent change; everything else stays as it is (notes,
// drop-off, the fleet-link details, the vehicle…). The New Job Card's rules
// hold: the complaint and the odometer stay on record, and a vehicle is the
// customer's own with a VIN. The customer and the vehicle can change only
// while the job is still at intake (D9); the job cards follow. A closed job
// is not edited, and a save made from an out-of-date copy
// (expected_updated_at) is refused instead of overwriting someone else's
// changes. `items`, when sent, are saved in the same transaction.
router.put('/:id', requireCapability('job.open'), async (req, res) => {
  let conn;
  try {
    const raw = req.body || {};
    const has = k => Object.prototype.hasOwnProperty.call(raw, k);
    refuseOverlongText(raw);
    const body = _clean(raw);
    const lines = has('items') ? parseLines(raw.items) : null;

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[current]] = await conn.query('SELECT * FROM work_orders WHERE id = ? AND workshop_id = ? FOR UPDATE', [req.params.id, req.workshopId]);
    if (!current) throw new InputError('Work order not found', 'NOT_FOUND', 404);
    if (CLOSED_STATUSES.includes(current.status)) {
      throw new InputError(`This job card is ${current.status} and can no longer be edited.`, 'JOB_CLOSED', 409);
    }
    if (!isBlank(raw.expected_updated_at) && stamp(raw.expected_updated_at) !== stamp(current.updated_at)) throw staleEdit(current);

    // ── Customer and vehicle (D9) ──
    const customerId = has('customer_id') ? parseId(raw.customer_id, 'Customer') : current.customer_id;
    const vehicleId = has('vehicle_id') ? parseId(raw.vehicle_id, 'Vehicle') : current.vehicle_id;
    const customerChanged = Number(customerId || 0) !== Number(current.customer_id || 0);
    const vehicleChanged = Number(vehicleId || 0) !== Number(current.vehicle_id || 0);
    if (customerChanged && !customerId) throw new InputError('A job card needs its customer.', 'CUSTOMER_REQUIRED');
    if (vehicleChanged && !vehicleId) throw new InputError('A job card needs its vehicle (Step 2).', 'VEHICLE_REQUIRED');
    if (customerChanged || vehicleChanged) {
      const why = await intakeLockReason(current, req.workshopId);
      if (why) {
        throw new InputError(`The ${customerChanged ? 'customer' : 'vehicle'} can't be changed any more: ${why}. Raise a new job card for the other ${customerChanged ? 'customer' : 'vehicle'} instead.`,
          'LOCKED_AFTER_ESTIMATE', 409);
      }
    }
    const customer = customerChanged ? await loadCustomer(customerId, req.workshopId) : null;
    // Ownership is checked when the pairing changes — not on every save, as
    // thousands of imported jobs have their car on file under another account.
    const vehicle = vehicleId && (customerChanged || vehicleChanged) ? await loadVehicle(vehicleId, req.workshopId, customerId) : null;
    if (vehicle && !String(vehicle.vin || '').trim()) return res.status(400).json({ success: false, ...VIN_REQUIRED });

    // ── Step 2: the complaint and the odometer stay on record ──
    let complaint = current.description;
    if (has('description')) {
      complaint = String(body.description || '').trim();
      if (!complaint) throw new InputError('The vehicle complaint is required.', 'COMPLAINT_REQUIRED');
    }
    // Optional: blank clears it, a typed reading must be valid.
    let odometer = current.odometer_in;
    if (has('odometer_in')) odometer = parseOdometer(raw.odometer_in);
    else if (vehicleChanged) odometer = null; // the old car's reading does not belong to the new one

    // ── The rest: what was sent, else what is stored ──
    const pick = (k, valid) => (has(k) && valid.includes(raw[k]) ? raw[k] : current[k]);
    const keep = (k, v = body[k]) => (has(k) ? (isBlank(v) ? null : v) : current[k]);
    let bayId = current.service_bay_id;
    if (has('service_bay_id')) {
      bayId = parseId(raw.service_bay_id, 'Service bay');
      if (bayId) {
        const [bay] = await query('SELECT id FROM service_bays WHERE id = ? AND workshop_id = ?', [bayId, req.workshopId]);
        if (!bay) throw new InputError('Service bay not found.', 'SERVICE_BAY_NOT_FOUND');
      }
    }
    let intakeChannel = current.intake_channel;
    if (has('intake_channel') && !isBlank(raw.intake_channel) && !['fleet_link', 'api'].includes(current.intake_channel)) {
      if (!STAFF_INTAKE_CHANNELS.includes(raw.intake_channel)) {
        throw new InputError('Received via must be Walk-in / phone (advisor), WhatsApp, Website or Social media.', 'INVALID_INTAKE_CHANNEL');
      }
      intakeChannel = raw.intake_channel;
    }
    // The snapshot follows the customer: a customer change takes the new
    // record's name, phone and classification; a job with no customer
    // record keeps what is typed.
    let name = current.customer_name, phone = current.customer_phone, email = current.customer_email;
    let intakeClass = current.intake_customer_class, intakeSub = current.intake_customer_subcategory, payerType = current.payer_type;
    if (customer) {
      name = customer.full_name; phone = phoneOf(customer, body.customer_phone); email = customer.email || null;
      intakeClass = customer.customer_class || null; intakeSub = customer.customer_subcategory || null;
      payerType = payerFor(intakeClass, intakeSub);
    } else if (!current.customer_id) {
      if (has('customer_name') && String(body.customer_name || '').trim()) name = String(body.customer_name).trim();
      if (has('customer_phone') && String(body.customer_phone || '').trim()) phone = String(body.customer_phone).trim();
      if (has('customer_email')) email = String(body.customer_email || '').trim() || null;
    }

    // ── Money ──
    const fee = has('service_fee') ? parseMoney(raw.service_fee, 'Service fee') : Number(current.service_fee) || 0;
    const disc = has('discount') ? parseMoney(raw.discount, 'Discount') : Number(current.discount) || 0;
    const cash = has('cash_amount') ? parseMoney(raw.cash_amount, 'Cash amount') : Number(current.cash_amount) || 0;
    const [stored] = await conn.query('SELECT id, name, quantity, unit_price, notes, item_type FROM work_order_items WHERE work_order_id = ? ORDER BY id', [current.id]);
    const diff = lines ? diffLines(stored, lines) : null;
    const subtotal = current.billing_basis === 'itemised' ? fee + linesTotal(lines || stored) : fee;
    if (disc > subtotal + 0.001) throw new InputError('The discount is more than the job card\'s subtotal.', 'DISCOUNT_TOO_LARGE');
    await refuseNewCounterPricing({ user: req.user, wo: current, workshopId: req.workshopId, storedLines: stored.length,
      becomesPriced: (diff?.add.length || 0) > 0 || fee > 0 || disc > 0 });
    const moneyChanged = Number(current.service_fee) !== fee || Number(current.discount) !== disc || !!diff?.changed;
    if (moneyChanged && await lockedInvoiceFor(current, req.workshopId)) {
      throw new InputError(INVOICE_LOCKED_MESSAGE, 'INVOICE_LOCKED', 409);
    }

    // ── Financial Engine: commission, VAT, net payout ──
    let finConfig;
    try { finConfig = await getFinancialConfig(req.workshopId); } catch { finConfig = { commissionPercent: 0, vatEnabled: false, vatRate: 0, vatNumber: '', applyVatOnServiceFee: true, applyVatOnCash: false }; }
    const fin = computeWorkOrderFinancials({ serviceFee: fee, discount: disc, cashAmount: cash, config: finConfig });
    const serviceCategory = pick('service_category', VALID_SERVICE_CATEGORIES);

    await conn.query(
      `UPDATE work_orders SET
        customer_id=?, vehicle_id=?, service_bay_id=?, work_order_type=?, service_category=?,
        customer_name=?, customer_phone=?, customer_email=?,
        intake_customer_class=?, intake_customer_subcategory=?, payer_type=?,
        dropoff_address=?, dropoff_lat=?, dropoff_lng=?,
        description=?, special_instructions=?, payment_method=?, odometer_in=?, intake_channel=?,
        cash_amount=?, service_fee=?, discount=?, total_amount=?,
        commission_rate=?, commission_amount=?, vat_rate=?, vat_amount=?, platform_fee=?, net_payable=?,
        scheduled_at=?, notes=?
       WHERE id = ? AND workshop_id = ?`,
      [customerId, vehicleId, bayId, pick('work_order_type', VALID_WORK_ORDER_TYPES), serviceCategory,
       name, phone, email,
       intakeClass, intakeSub, payerType,
       keep('dropoff_address'), keep('dropoff_lat', raw.dropoff_lat), keep('dropoff_lng', raw.dropoff_lng),
       complaint, keep('special_instructions'), pick('payment_method', VALID_PAY_METHODS), odometer, intakeChannel,
       cash, fee, disc, fin.totalAmount,
       fin.commissionRate, fin.commissionAmount, fin.vatRate, fin.vatAmount, fin.platformFee, fin.netPayable,
       keep('scheduled_at', raw.scheduled_at), keep('notes'), current.id, req.workshopId]
    );
    if (diff?.changed) await writeLines(conn, current.id, diff);

    // The job cards follow the work order: customer, car and plate, bay —
    // main and sub cards alike, unless already billed or cancelled.
    const jcSet = [], jcVals = [];
    if (customerChanged) { jcSet.push('customer_id = ?'); jcVals.push(customerId); }
    if (vehicleChanged) { jcSet.push('vehicle_id = ?', 'vehicle_plate = ?'); jcVals.push(vehicleId, vehicle?.plate_number || null); }
    if (Number(bayId || 0) !== Number(current.service_bay_id || 0)) { jcSet.push('service_bay_id = ?'); jcVals.push(bayId); }
    if (jcSet.length) {
      await conn.query(`UPDATE job_cards SET ${jcSet.join(', ')} WHERE work_order_id = ? AND workshop_id = ? AND status NOT IN ('billed','cancelled')`,
        [...jcVals, current.id, req.workshopId]);
    }
    if (serviceCategory !== current.service_category) {
      await conn.query(
        "UPDATE job_cards SET department = ? WHERE work_order_id = ? AND workshop_id = ? AND parent_job_card_id IS NULL AND status = 'open'",
        [departmentFor(serviceCategory), current.id, req.workshopId]);
    }
    if (customerChanged) {
      // An invoice raised at 'confirmed' (unpaid — a paid one locks the change above).
      await conn.query(
        "UPDATE invoices SET customer_id = ? WHERE work_order_id = ? AND workshop_id = ? AND status NOT IN ('void','cancelled','paid','partially_paid') AND COALESCE(amount_paid, 0) = 0",
        [customerId, current.id, req.workshopId]);
    }

    // The vehicle's odometer: raised to the reading, never wound back — except
    // to undo this job's own typo (the vehicle still holds the old reading).
    if (vehicleId && odometer != null && (vehicleChanged || odometer !== current.odometer_in)) {
      await conn.query('UPDATE vehicles SET mileage = ? WHERE id = ? AND workshop_id = ? AND (mileage IS NULL OR mileage < ?)',
        [odometer, vehicleId, req.workshopId, odometer]);
      if (!vehicleChanged && current.odometer_in != null && odometer < current.odometer_in) {
        await conn.query('UPDATE vehicles SET mileage = ? WHERE id = ? AND workshop_id = ? AND mileage = ?',
          [odometer, vehicleId, req.workshopId, current.odometer_in]);
      }
    }

    // History: intake corrections are part of the job's story.
    const changes = [];
    if (customerChanged) changes.push(`customer changed from ${current.customer_name || '—'} to ${name}`);
    if (vehicleChanged) changes.push(`vehicle changed to ${vehicle?.plate_number || `#${vehicleId}`}`);
    if (odometer !== current.odometer_in && !vehicleChanged) changes.push(`odometer corrected from ${current.odometer_in ?? '—'} to ${odometer} km`);
    if (changes.length) {
      await conn.query('INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
        [current.id, current.status, req.user.id, `Job card edited: ${changes.join('; ')}`]);
    }

    await conn.commit();
    conn.release(); conn = null;

    if (changes.length) {
      logAudit({
        workshopId: req.workshopId, userId: req.user.id, action: 'WORK_ORDER_INTAKE_EDIT', entityType: 'work_orders', entityId: current.id,
        oldValue: { customer_id: current.customer_id, vehicle_id: current.vehicle_id, odometer_in: current.odometer_in },
        newValue: { customer_id: customerId, vehicle_id: vehicleId, odometer_in: odometer },
      }).catch(e => console.error('[WorkOrders] edit audit:', e.message));
    }
    const billing = await syncJobCardBilling(current.id, req.workshopId);
    const [workOrder] = await query('SELECT * FROM work_orders WHERE id = ?', [current.id]);
    return res.json({ success: true, data: workOrder, billing, ...(diff ? { lines_changed: diff.changed } : {}) });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err instanceof InputError) return sendError(res, err);
    console.error('[WorkOrders] Update error:', err);
    const [http, payload] = dbErrorStatus(err, 'Failed to update work order');
    return res.status(http).json(payload);
  } finally {
    if (conn) conn.release();
  }
});

// PATCH /api/work-orders/:id/customer-approval — record how the customer agreed
// Body: { channel: 'in_person' | 'phone' | 'written', note }
// Allowed again only when the job card has grown past the total the customer
// last agreed to — that is re-approval of the extra work, not a duplicate.
router.patch('/:id/customer-approval', requireCapability('customer.approval'), async (req, res) => {
  try {
    const { channel, note } = req.body || {};
    if (!CUSTOMER_APPROVAL_CHANNELS.includes(channel)) {
      return res.status(400).json({ success: false, message: 'channel must be in_person, phone or written' });
    }
    const [wo] = await query(
      'SELECT id, status, customer_approved_at, customer_approved_total FROM work_orders WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (['completed', 'cancelled'].includes(wo.status)) {
      return res.status(400).json({ success: false, message: `This job card is ${wo.status}.` });
    }
    // An approval of nothing (no lines, no fee) would open the "no work
    // without approval" gate before any inspection or estimate.
    if (await nothingToApprove(wo.id, req.workshopId)) return res.status(409).json({ success: false, ...NOTHING_TO_APPROVE });
    await syncJobCardBilling(wo.id, req.workshopId);
    const [fresh] = await query('SELECT total_amount FROM work_orders WHERE id = ?', [wo.id]);
    if (wo.customer_approved_at && Number(fresh.total_amount) <= Number(wo.customer_approved_total)) {
      return res.status(409).json({ success: false, message: 'The customer has already approved this job card at its current total.' });
    }
    await recordCustomerApproval({ workOrderId: wo.id, workshopId: req.workshopId, channel, note, userId: req.user.id });
    await onWorkApproved({ workOrderId: wo.id, workshopId: req.workshopId, userId: req.user.id, how: channel.replace('_', ' ') });
    await logAudit({
      workshopId: req.workshopId, userId: req.user.id, action: 'CUSTOMER_APPROVAL', entityType: 'work_orders',
      entityId: wo.id, oldValue: wo.customer_approved_total, newValue: { channel, total: fresh.total_amount, note: note || null },
    });
    const [workOrder] = await query('SELECT * FROM work_orders WHERE id = ?', [wo.id]);
    return res.json({ success: true, message: 'Customer approval recorded', data: workOrder });
  } catch (err) {
    console.error('[WorkOrders] Customer approval error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record customer approval' });
  }
});

/* ── Work order items management ─────────────────────────────────────── */

// GET /api/work-orders/:id/items — list items for a work order
router.get('/:id/items', async (req, res) => {
  try {
    const [workOrder] = await query('SELECT id FROM work_orders WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });
    const items = await query('SELECT * FROM work_order_items WHERE work_order_id = ?', [req.params.id]);
    return res.json({ success: true, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch items' });
  }
});

// Item and price changes on an itemised job card flow straight to its
// invoice — unless that invoice has already taken money. Then the change is
// refused: accepting it would leave the job card and the bill disagreeing,
// which is exactly how extra work used to go unbilled.
const INVOICE_LOCKED_MESSAGE =
  'This job card\'s invoice is already paid, so its lines and prices are locked. Raise the extra work as a new job card.';

async function lockedInvoiceFor(workOrder, workshopId) {
  if (workOrder.billing_basis !== 'itemised') return null;
  const inv = await getInvoiceForWorkOrder(workOrder.id, workshopId);
  return isInvoiceLocked(inv) ? inv : null;
}

// PUT /api/work-orders/:id/items — save the job card's lines in one go.
// Body: { items: [{ id?, name, quantity, unit_price, notes, item_type? }], expected_updated_at? }
// Lines sent back with their id are updated in place (they keep their
// sub-job card and estimate-line link), new lines are added and lines not
// sent are removed — all in one transaction. A save that changes nothing
// changes nothing. The form used to delete each line and re-add them one
// request at a time, swallowing failures; on an itemised job card the lines
// ARE the bill, so a half-finished save silently dropped charges.
router.put('/:id/items', requireCapability('job.open'), async (req, res) => {
  if (!Array.isArray(req.body?.items)) return res.status(400).json({ success: false, message: 'items array required' });
  let conn;
  try {
    const lines = parseLines(req.body.items);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[workOrder]] = await conn.query('SELECT * FROM work_orders WHERE id = ? AND workshop_id = ? FOR UPDATE', [req.params.id, req.workshopId]);
    if (!workOrder) throw new InputError('Work order not found', 'NOT_FOUND', 404);
    if (CLOSED_STATUSES.includes(workOrder.status)) {
      throw new InputError(`This job card is ${workOrder.status} and can no longer be edited.`, 'JOB_CLOSED', 409);
    }
    const [stored] = await conn.query('SELECT id, name, quantity, unit_price, notes, item_type FROM work_order_items WHERE work_order_id = ? ORDER BY id', [workOrder.id]);
    const diff = diffLines(stored, lines);
    if (diff.changed) {
      if (!isBlank(req.body.expected_updated_at) && stamp(req.body.expected_updated_at) !== stamp(workOrder.updated_at)) throw staleEdit(workOrder);
      if (await lockedInvoiceFor(workOrder, req.workshopId)) throw new InputError(INVOICE_LOCKED_MESSAGE, 'INVOICE_LOCKED', 409);
      await refuseNewCounterPricing({ user: req.user, wo: workOrder, workshopId: req.workshopId, storedLines: stored.length, becomesPriced: diff.add.length > 0 });
      await writeLines(conn, workOrder.id, diff);
    }
    await conn.commit();
    conn.release(); conn = null;
    const billing = diff.changed ? await syncJobCardBilling(workOrder.id, req.workshopId) : null;
    const saved = await query('SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY id', [workOrder.id]);
    const [fresh] = await query('SELECT updated_at FROM work_orders WHERE id = ?', [workOrder.id]);
    return res.json({ success: true, data: saved, billing, unchanged: !diff.changed, updated_at: fresh?.updated_at });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err instanceof InputError) return sendError(res, err);
    console.error('[WorkOrders] Replace items error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save the job card lines' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/work-orders/:id/items — add item to a work order
router.post('/:id/items', requireCapability('job.open'), async (req, res) => {
  try {
    const [workOrder] = await query('SELECT * FROM work_orders WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (!String(req.body?.name || '').trim()) return res.status(400).json({ success: false, message: 'Item name required' });
    const [line] = parseLines([req.body]);
    if (await lockedInvoiceFor(workOrder, req.workshopId)) {
      return res.status(409).json({ success: false, code: 'INVOICE_LOCKED', message: INVOICE_LOCKED_MESSAGE });
    }
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM work_order_items WHERE work_order_id = ?', [workOrder.id]);
    await refuseNewCounterPricing({ user: req.user, wo: workOrder, workshopId: req.workshopId, storedLines: Number(n), becomesPriced: true });
    const result = await execute(
      'INSERT INTO work_order_items (work_order_id, name, item_type, quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [workOrder.id, line.name, line.item_type, line.quantity, line.unit_price, line.notes]
    );
    const billing = await syncJobCardBilling(req.params.id, req.workshopId);
    const [item] = await query('SELECT * FROM work_order_items WHERE id = ?', [result.insertId]);
    return res.status(201).json({ success: true, data: item, billing });
  } catch (err) {
    if (err instanceof InputError) return sendError(res, err);
    console.error('[WorkOrders] Add item error:', err);
    return res.status(500).json({ success: false, message: 'Failed to add item' });
  }
});

// PUT /api/work-orders/:id/items/:itemId — update a work order item
router.put('/:id/items/:itemId', requireCapability('job.open'), async (req, res) => {
  try {
    const [workOrder] = await query('SELECT id, billing_basis FROM work_orders WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (await lockedInvoiceFor(workOrder, req.workshopId)) {
      return res.status(409).json({ success: false, code: 'INVOICE_LOCKED', message: INVOICE_LOCKED_MESSAGE });
    }
    if (!String(req.body?.name || '').trim()) return res.status(400).json({ success: false, message: 'Item name required' });
    const [line] = parseLines([req.body]);
    await execute(
      'UPDATE work_order_items SET name=?, quantity=?, unit_price=?, notes=?, item_type = COALESCE(?, item_type) WHERE id = ? AND work_order_id = ?',
      [line.name, line.quantity, line.unit_price, line.notes, line.item_type, req.params.itemId, req.params.id]
    );
    const billing = await syncJobCardBilling(req.params.id, req.workshopId);
    const [item] = await query('SELECT * FROM work_order_items WHERE id = ?', [req.params.itemId]);
    return res.json({ success: true, data: item, billing });
  } catch (err) {
    if (err instanceof InputError) return sendError(res, err);
    console.error('[WorkOrders] Update item error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update item' });
  }
});

// DELETE /api/work-orders/:id/items/:itemId — remove a work order item
router.delete('/:id/items/:itemId', requireCapability('job.open'), async (req, res) => {
  try {
    const [workOrder] = await query('SELECT id, billing_basis FROM work_orders WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (await lockedInvoiceFor(workOrder, req.workshopId)) {
      return res.status(409).json({ success: false, code: 'INVOICE_LOCKED', message: INVOICE_LOCKED_MESSAGE });
    }
    await execute('DELETE FROM work_order_items WHERE id = ? AND work_order_id = ?', [req.params.itemId, req.params.id]);
    const billing = await syncJobCardBilling(req.params.id, req.workshopId);
    return res.json({ success: true, message: 'Item removed', billing });
  } catch (err) {
    console.error('[WorkOrders] Remove item error:', err);
    return res.status(500).json({ success: false, message: 'Failed to remove item' });
  }
});

// DELETE /api/work-orders/:id — soft-delete (archive) a work order
router.delete('/:id', requireManager, async (req, res) => {
  try {
    const [workOrder] = await query(
      "SELECT id, status FROM work_orders WHERE id = ? AND workshop_id = ?",
      [req.params.id, req.workshopId]
    );
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });

    const nonDeletable = ['in_progress'];
    if (nonDeletable.includes(workOrder.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot archive a work order with status '${workOrder.status}'`,
      });
    }

    await execute(
      "UPDATE work_orders SET status = 'cancelled' WHERE id = ? AND workshop_id = ?",
      [req.params.id, req.workshopId]
    );
    return res.json({ success: true, message: 'Work order cancelled/archived' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to archive work order' });
  }
});

// POST /api/work-orders/:id/rate-mechanic — submit 1-5 star rating for the mechanic
router.post('/:id/rate-mechanic', async (req, res) => {
  try {
    const rating = parseInt(req.body.rating);
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    // Validate optional comment (max 500 chars, strip HTML)
    let comment = null;
    if (req.body.comment != null && String(req.body.comment).trim()) {
      comment = String(req.body.comment).trim().replace(/<[^>]*>/g, '').slice(0, 500);
    }

    const [workOrder] = await query(
      'SELECT id, mechanic_id, status, mechanic_rating FROM work_orders WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (workOrder.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Can only rate completed work orders' });
    }
    if (workOrder.mechanic_rating) {
      return res.status(409).json({ success: false, message: 'Work order has already been rated' });
    }
    if (!workOrder.mechanic_id) {
      return res.status(400).json({ success: false, message: 'No mechanic assigned to this work order' });
    }

    // Save rating + optional comment on the work order
    await execute(
      'UPDATE work_orders SET mechanic_rating = ?, review_comment = ?, mechanic_rated_at = NOW() WHERE id = ?',
      [rating, comment, workOrder.id]
    );

    // Recalculate mechanic's average rating
    const [avg] = await query(
      'SELECT AVG(mechanic_rating) as avg_rating, COUNT(*) as total FROM work_orders WHERE mechanic_id = ? AND mechanic_rating IS NOT NULL',
      [workOrder.mechanic_id]
    );
    if (avg?.avg_rating != null) {
      await execute(
        'UPDATE mechanics SET rating = ? WHERE id = ?',
        [parseFloat(avg.avg_rating).toFixed(2), workOrder.mechanic_id]
      );
    }

    return res.json({ success: true, message: 'Rating submitted', rating, mechanic_id: workOrder.mechanic_id });
  } catch (err) {
    console.error('Rate mechanic error:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit rating' });
  }
});

export default router;
