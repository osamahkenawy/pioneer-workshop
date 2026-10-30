/**
 * MODULE E.2 — External API (v1) Routes
 *
 * API-key-authenticated endpoints for external integrations.
 * Prefix: /api/v1/
 *
 * Mirrors a subset of internal routes but uses API key auth
 * instead of JWT + role-based access.
 */

import express from 'express';
import { query, execute } from '../lib/database.js';
import { requireApiPermission } from '../middleware/api-key-auth.js';
import { serviceStatusToken } from '../lib/tokens.js';
import { syncJobCardBilling } from '../lib/job-card-billing.js';
import { openJobCardIfReady } from '../lib/physical-inspection.js';
import { fulfilReminders } from '../lib/workflow.js';
import { onEnquiryCreated, openEnquiryWorkOrder, snapshotIntakeClass } from '../lib/crm-cycle.js';
import { stripMarkup, clampText } from '../lib/sanitize.js';

const router = express.Router();

// ── Helper: pick workshop-scoped rows ──────────────────────────
const workshopQ = (sql, params, req) => query(sql, [...params, req.workshopId]);

// ════════════════════════════════════════════════════════════════
//  WORK ORDERS
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  ENQUIRY INTAKE — website / landing-page leads (journey stage 01-02)
// ════════════════════════════════════════════════════════════════

/**
 * Map the free-text `source` a website sends onto one of the four sourcing
 * groups from the CX journey map. Anything web-originated is search &
 * discovery; the raw string is preserved in source_detail either way so the
 * exact campaign stays reportable.
 */
function mapSourceChannel(source) {
  const s = String(source || '').toLowerCase();
  if (/referr|friend|word/.test(s))                      return 'owned_repeat';
  if (/insur|partner|fleet|corporate|dealer|recovery/.test(s)) return 'partner_referred';
  if (/walk|passing|signage|drive/.test(s))              return 'passing_local';
  return 'search_discovery'; // website, landing page, google, campaign, social
}

/** Map the website's service label onto the enquiry_type enum. */
function mapEnquiryType(service) {
  const s = String(service || '').toLowerCase();
  if (/diagnos/.test(s))                       return 'diagnostic';
  if (/body|paint|dent/.test(s))               return 'bodywork';
  if (/accident|collision|crash/.test(s))      return 'accident';
  if (/repair|mechanic|engine|brake|transmis/.test(s)) return 'repair';
  if (/service|oil|maintenance|tyre|tire|ac\b/.test(s)) return 'service';
  return 'other';
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * POST /api/v1/enquiries
 *
 * Accepts an enquiry pushed from a website landing page and files it as a
 * stage 01-02 enquiry with its source attributed.
 *
 * Idempotent on `reference`: pushing the same reference again returns the
 * enquiry that already exists (200) rather than creating a duplicate, so a
 * landing page that retries on timeout is safe.
 *
 * The enquiry's work order (the visit) is opened with it, Received via API
 * (lib/crm-cycle.js openEnquiryWorkOrder): data.workOrder { id, number }, or
 * null if it could not be opened (the enquiry is kept).
 *
 * Requires: enquiries:write
 */
router.post('/enquiries', requireApiPermission('enquiries:write'), async (req, res) => {
  try {
    const body = req.body || {};
    const { reference, branch, service, customer = {}, vehicle = {}, preferredDate, notes, source } = body;

    // ── Validation ────────────────────────────────────────────
    const errors = [];
    if (isBlank(customer.name)) errors.push({ field: 'customer.name', message: 'Customer name is required' });

    // A contact route is required, but either one will do. Phone used to be
    // mandatory, which the website's own "Send Message" form cannot satisfy —
    // it collects name, email, service and message, with no phone field. An
    // enquiry with an email and no phone is still a lead worth capturing.
    if (isBlank(customer.phone) && isBlank(customer.email)) {
      errors.push({
        field: 'customer.phone',
        message: 'Provide customer.phone or customer.email so the enquiry can be followed up',
      });
    }

    if (!isBlank(customer.phone) && !/^\+?[\d\s\-()]{7,20}$/.test(String(customer.phone).trim())) {
      errors.push({ field: 'customer.phone', message: 'Phone number format is invalid' });
    }
    if (!isBlank(customer.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(customer.email).trim())) {
      errors.push({ field: 'customer.email', message: 'Email format is invalid' });
    }
    if (!isBlank(preferredDate) && !/^\d{4}-\d{2}-\d{2}$/.test(String(preferredDate).trim())) {
      errors.push({ field: 'preferredDate', message: 'preferredDate must be YYYY-MM-DD' });
    }
    if (!isBlank(vehicle.year) && !/^\d{4}$/.test(String(vehicle.year).trim())) {
      errors.push({ field: 'vehicle.year', message: 'vehicle.year must be a 4-digit year' });
    }
    if (errors.length) {
      return res.status(422).json({ success: false, message: 'Validation failed', errors });
    }

    const extRef = isBlank(reference) ? null : String(reference).trim();

    // ── Idempotency: same reference -> return what already exists ──
    if (extRef) {
      const [existing] = await query(
        'SELECT id, enquiry_number, external_reference, status, created_at FROM enquiries WHERE workshop_id = ? AND external_reference = ?',
        [req.workshopId, extRef]
      );
      if (existing) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          message: 'This reference has already been received; returning the existing enquiry.',
          data: {
            id: existing.id,
            enquiryNumber: existing.enquiry_number,
            reference: existing.external_reference,
            status: existing.status,
            receivedAt: existing.created_at,
          },
        });
      }
    }

    // ── Build the enquiry ─────────────────────────────────────
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const enquiryNumber = `ENQ-${stamp}-${Math.floor(Math.random() * 9000) + 1000}`;

    const vehicleDescription = [vehicle.make, vehicle.model, vehicle.year]
      .filter(v => !isBlank(v)).map(v => String(v).trim()).join(' ') || null;

    // Reuse an existing customer when we can recognise them, so repeat website
    // leads attach to the record they belong to. Phone is the stronger match;
    // fall back to email for form submissions that carry no phone.
    // `phone` must stay null rather than the string "undefined" when absent.
    const phone = isBlank(customer.phone) ? null : String(customer.phone).trim();
    const email = isBlank(customer.email) ? null : String(customer.email).trim();

    let known = null;
    if (phone) {
      [known] = await query(
        'SELECT id FROM customers WHERE workshop_id = ? AND phone = ? LIMIT 1',
        [req.workshopId, phone]
      );
    }
    if (!known && email) {
      [known] = await query(
        'SELECT id FROM customers WHERE workshop_id = ? AND email = ? LIMIT 1',
        [req.workshopId, email]
      );
    }

    // SR-01/SR-16 — this endpoint is public (API-key only) and the payload
    // comes from a website form, so identity fields have markup stripped before
    // storage. The note keeps its text verbatim.
    const result = await execute(
      `INSERT INTO enquiries
         (workshop_id, enquiry_number, external_reference, customer_id,
          contact_name, contact_phone, contact_email,
          vehicle_description, vehicle_plate,
          enquiry_type, description,
          source_channel, source_detail, contact_method,
          branch, service_requested, preferred_date,
          intake_origin, raw_payload, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'api', ?, 'new', NULL)`,
      [
        req.workshopId, enquiryNumber, extRef, known ? known.id : null,
        stripMarkup(String(customer.name).trim()),
        phone ? stripMarkup(phone, 32) : null,
        email ? stripMarkup(email, 190) : null,
        stripMarkup(vehicleDescription, 255),
        isBlank(vehicle.plateNumber) ? null : stripMarkup(String(vehicle.plateNumber).trim(), 64),
        mapEnquiryType(service),
        isBlank(notes) ? null : clampText(String(notes).trim()),
        mapSourceChannel(source),
        isBlank(source) ? null : String(source).trim(),
        'website_form',
        isBlank(branch) ? null : stripMarkup(String(branch).trim(), 120),
        isBlank(service) ? null : String(service).trim(),
        isBlank(preferredDate) ? null : String(preferredDate).trim(),
        JSON.stringify(body),
      ]
    );

    const [row] = await query(
      'SELECT id, enquiry_number, external_reference, status, source_channel, source_detail, enquiry_type, created_at FROM enquiries WHERE id = ?',
      [result.insertId]
    );
    // Follow up: the lead lands as a call-back task, and as its work order.
    const [full] = await query('SELECT * FROM enquiries WHERE id = ?', [result.insertId]);
    await onEnquiryCreated(full);
    const wo = await openEnquiryWorkOrder({ enquiryId: result.insertId, workshopId: req.workshopId, channel: 'api' });

    return res.status(201).json({
      success: true,
      duplicate: false,
      message: 'Enquiry received',
      data: {
        id: row.id,
        enquiryNumber: row.enquiry_number,
        reference: row.external_reference,
        status: row.status,
        sourceChannel: row.source_channel,
        source: row.source_detail,
        enquiryType: row.enquiry_type,
        linkedCustomerId: known ? known.id : null,
        workOrder: wo ? { id: wo.workOrderId, number: wo.workOrderNumber } : null,
        receivedAt: row.created_at,
      },
    });
  } catch (err) {
    // Two simultaneous pushes of one reference: the unique index wins the race,
    // so resolve to the row that landed rather than failing the caller.
    if (err && err.code === 'ER_DUP_ENTRY') {
      const [existing] = await query(
        'SELECT id, enquiry_number, external_reference, status, created_at FROM enquiries WHERE workshop_id = ? AND external_reference = ?',
        [req.workshopId, String(req.body?.reference || '').trim()]
      );
      if (existing) {
        return res.status(200).json({
          success: true, duplicate: true,
          message: 'This reference has already been received; returning the existing enquiry.',
          data: {
            id: existing.id, enquiryNumber: existing.enquiry_number,
            reference: existing.external_reference, status: existing.status,
            receivedAt: existing.created_at,
          },
        });
      }
    }
    console.error('[api/v1/enquiries POST]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to record enquiry' });
  }
});

/**
 * GET /api/v1/enquiries/:reference
 * Let the sending site confirm what we did with a lead it pushed.
 * Requires: enquiries:read
 */
router.get('/enquiries/:reference', requireApiPermission('enquiries:read'), async (req, res) => {
  try {
    const [row] = await query(
      `SELECT e.id, e.enquiry_number, e.external_reference, e.status, e.enquiry_type,
              e.source_channel, e.source_detail, e.branch, e.service_requested,
              e.preferred_date, e.contact_name, e.contact_phone, e.created_at,
              COALESCE(e.converted_work_order_id, e.work_order_id) AS work_order_id, wo.work_order_number, wo.status AS work_order_status
       FROM enquiries e
       LEFT JOIN work_orders wo ON wo.id = COALESCE(e.converted_work_order_id, e.work_order_id)
       WHERE e.workshop_id = ? AND e.external_reference = ?`,
      [req.workshopId, req.params.reference]
    );
    if (!row) return res.status(404).json({ success: false, message: 'No enquiry found for that reference' });

    return res.json({
      success: true,
      data: {
        id: row.id,
        enquiryNumber: row.enquiry_number,
        reference: row.external_reference,
        status: row.status,
        enquiryType: row.enquiry_type,
        sourceChannel: row.source_channel,
        source: row.source_detail,
        branch: row.branch,
        service: row.service_requested,
        preferredDate: row.preferred_date,
        customer: { name: row.contact_name, phone: row.contact_phone },
        workOrder: row.work_order_id
          ? { id: row.work_order_id, number: row.work_order_number, status: row.work_order_status }
          : null,
        receivedAt: row.created_at,
      },
    });
  } catch (err) {
    console.error('[api/v1/enquiries/:reference GET]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch enquiry' });
  }
});

// These endpoints were written for the delivery product and read/wrote
// columns this database does not have (sender_*, customer_address, weight_kg,
// picked_up_at, delivered_at, barcode, …), so every call failed with a 500.
// They now use the workshop job card schema.
const WO_FIELDS = `o.id, o.work_order_number, o.service_status_token, o.status, o.work_order_type, o.service_category,
              o.customer_id, o.customer_name, o.customer_phone, o.customer_email,
              o.vehicle_id, v.plate_number AS vehicle_plate, v.make AS vehicle_make, v.model AS vehicle_model, v.vin AS vehicle_vin,
              o.odometer_in, o.description, o.special_instructions, o.payment_method, o.payment_status,
              o.service_fee, o.discount, o.vat_amount, o.total_amount, o.billing_basis,
              o.scheduled_at, o.started_at, o.completed_at, o.cancelled_at, o.created_at, o.updated_at`;

/**
 * GET /api/v1/work_orders
 * List work orders. Filters: status, from, to, service_status_token; page/limit.
 * Requires: work_orders:read
 */
router.get('/work_orders', requireApiPermission('work_orders:read'), async (req, res) => {
  try {
    const { page = 1, status, from, to, service_status_token } = req.query;
    const lim = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const offset = (pg - 1) * lim;

    let where = 'o.workshop_id = ?';
    const params = [req.workshopId];
    if (status) { where += ' AND o.status = ?'; params.push(String(status)); }
    if (from)   { where += ' AND o.created_at >= ?'; params.push(String(from)); }
    if (to)     { where += ' AND o.created_at <= ?'; params.push(String(to)); }
    if (service_status_token) { where += ' AND o.service_status_token = ?'; params.push(String(service_status_token)); }

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM work_orders o WHERE ${where}`, params);
    const rows = await query(
      `SELECT ${WO_FIELDS}
       FROM work_orders o
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       WHERE ${where}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, lim, offset]
    );

    return res.json({
      success: true,
      data: rows,
      pagination: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) },
    });
  } catch (err) {
    console.error('[api/v1/work_orders GET]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch work orders' });
  }
});

async function loadWorkOrder(workshopId, identifier) {
  const isNumeric = /^\d+$/.test(identifier);
  const [workOrder] = await query(
    `SELECT ${WO_FIELDS}
     FROM work_orders o
     LEFT JOIN vehicles v ON v.id = o.vehicle_id
     WHERE o.workshop_id = ? AND ${isNumeric ? 'o.id = ?' : 'o.service_status_token = ?'}`,
    [workshopId, String(identifier)]
  );
  if (!workOrder) return null;
  const [items, history] = await Promise.all([
    query('SELECT name, item_type, quantity, unit_price, notes FROM work_order_items WHERE work_order_id = ? ORDER BY id', [workOrder.id]),
    query('SELECT status, note, created_at FROM work_order_status_logs WHERE work_order_id = ? ORDER BY created_at ASC, id ASC', [workOrder.id]),
  ]);
  return { ...workOrder, items, status_history: history };
}

/**
 * GET /api/v1/work_orders/:id
 * Single work order by numeric ID or service_status_token, with its lines and status history.
 * Requires: work_orders:read
 */
router.get('/work_orders/:id', requireApiPermission('work_orders:read'), async (req, res) => {
  try {
    const data = await loadWorkOrder(req.workshopId, req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Work order not found' });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[api/v1/work_orders/:id GET]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch work order' });
  }
});

/**
 * POST /api/v1/work_orders
 * Create a job card. Required: customer_name, customer_phone, description.
 * Optional: customer_id, vehicle_id (must belong to this workshop), customer_email,
 * odometer_in, scheduled_at, special_instructions, payment_method, service_fee,
 * items [{ name, quantity, unit_price, notes }]. Totals and VAT are computed
 * by the server from service_fee + items.
 * Requires: work_orders:write
 */
router.post('/work_orders', requireApiPermission('work_orders:write'), async (req, res) => {
  try {
    const b = req.body || {};
    const customer_name = (stripMarkup(String(b.customer_name || ''), 255) || '').trim();
    const customer_phone = String(b.customer_phone || '').trim().slice(0, 50);
    const description = (clampText(String(b.description || ''), 5000) || '').trim();
    if (!customer_name || !customer_phone || !description) {
      return res.status(400).json({ success: false, message: 'customer_name, customer_phone and description are required' });
    }
    if (b.customer_id) {
      const [c] = await query('SELECT id FROM customers WHERE id = ? AND workshop_id = ?', [b.customer_id, req.workshopId]);
      if (!c) return res.status(400).json({ success: false, message: 'customer_id not found' });
    }
    if (b.vehicle_id) {
      const [v] = await query('SELECT id FROM vehicles WHERE id = ? AND workshop_id = ?', [b.vehicle_id, req.workshopId]);
      if (!v) return res.status(400).json({ success: false, message: 'vehicle_id not found' });
    }
    const PAYMENT_METHODS = ['cash', 'prepaid', 'credit', 'wallet']; // work_orders.payment_method enum
    const payment_method = PAYMENT_METHODS.includes(b.payment_method) ? b.payment_method : 'cash';
    const items = Array.isArray(b.items) ? b.items.filter(it => it && String(it.name || '').trim()) : [];

    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const work_order_number = `WO-${stamp}-${Math.floor(Math.random() * 9000) + 1000}`;
    const service_status_token = serviceStatusToken();

    const result = await execute(
      `INSERT INTO work_orders (
         workshop_id, work_order_number, customer_id, vehicle_id, intake_channel, service_status_token, status,
         customer_name, customer_phone, customer_email, odometer_in, description, special_instructions,
         payment_method, service_fee, billing_basis, scheduled_at, notes
       ) VALUES (?, ?, ?, ?, 'api', ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 'itemised', ?, ?)`,
      [
        req.workshopId, work_order_number, b.customer_id || null, b.vehicle_id || null, service_status_token,
        customer_name, customer_phone, b.customer_email ? String(b.customer_email).slice(0, 255) : null,
        Number.isFinite(+b.odometer_in) && +b.odometer_in > 0 ? Math.round(+b.odometer_in) : null,
        description, b.special_instructions ? clampText(String(b.special_instructions), 2000) : null,
        payment_method, Math.max(0, parseFloat(b.service_fee) || 0), b.scheduled_at || null,
        `Created via API key "${req.apiKeyName || req.apiKeyId}"`,
      ]
    );
    const id = result.insertId;

    for (const it of items) {
      const qty = parseFloat(it.quantity);
      await execute(
        'INSERT INTO work_order_items (work_order_id, name, quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?)',
        [id, stripMarkup(String(it.name).trim(), 255), Number.isFinite(qty) && qty > 0 ? qty : 1,
         Math.max(0, parseFloat(it.unit_price) || 0), it.notes ? clampText(String(it.notes), 500) : null]
      );
    }
    await syncJobCardBilling(id, req.workshopId);
    // Step 1 as the job records it; the main job card opens now for an
    // internal customer, and on the physical inspection for an external one
    // (lib/physical-inspection.js).
    await snapshotIntakeClass(id);
    const jc = await openJobCardIfReady({ workOrderId: id, workshopId: req.workshopId })
      .catch(e => { console.error('[api/v1] main job card:', e.message); return null; });
    if (!jc?.opened) fulfilReminders({ workshopId: req.workshopId, workOrderId: id });
    // changed_by is a user id; API calls have none.
    await execute(
      `INSERT INTO work_order_status_logs (work_order_id, status, note, changed_by) VALUES (?, 'pending', ?, NULL)`,
      [id, `Created via API key "${req.apiKeyName || req.apiKeyId}"`]
    );

    return res.status(201).json({ success: true, data: await loadWorkOrder(req.workshopId, String(id)), message: 'Work order created' });
  } catch (err) {
    console.error('[api/v1/work_orders POST]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create work order' });
  }
});

/**
 * PATCH /api/v1/work_orders/:id/cancel
 * Cancel a work order before work starts. Body: { reason }.
 * Requires: work_orders:write
 */
const API_CANCELLABLE = ['pending', 'confirmed', 'assigned', 'estimate_approved'];
router.patch('/work_orders/:id/cancel', requireApiPermission('work_orders:write'), async (req, res) => {
  try {
    const [workOrder] = await query(
      'SELECT id, status FROM work_orders WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });

    if (!API_CANCELLABLE.includes(workOrder.status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot cancel a work order in '${workOrder.status}' status. Cancellable statuses: ${API_CANCELLABLE.join(', ')}`,
      });
    }
    const reason = clampText(String(req.body?.reason || 'Cancelled via API'), 500);
    await execute(
      "UPDATE work_orders SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = ?, updated_at = NOW() WHERE id = ?",
      [reason, workOrder.id]
    );
    await execute(
      `INSERT INTO work_order_status_logs (work_order_id, status, note, changed_by) VALUES (?, 'cancelled', ?, NULL)`,
      [workOrder.id, reason]
    );
    return res.json({ success: true, message: 'Work order cancelled' });
  } catch (err) {
    console.error('[api/v1/work_orders/:id/cancel]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to cancel work order' });
  }
});

// ════════════════════════════════════════════════════════════════
//  SERVICE STATUS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/service-status/:token
 * Service status by customer-facing token (scoped to the API key's workshop).
 * Requires: service_status:read
 */
router.get('/service-status/:token', requireApiPermission('service_status:read'), async (req, res) => {
  try {
    const data = await loadWorkOrder(req.workshopId, String(req.params.token).replace(/^\d+$/, '_'));
    if (!data) return res.status(404).json({ success: false, message: 'Work order not found' });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[api/v1/service-status/:token]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch service status' });
  }
});

// ════════════════════════════════════════════════════════════════
//  CUSTOMERS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/customers
 * List workshop customers (for API integrations that need to reference customer_id).
 * Requires: customers:read
 */
router.get('/customers', requireApiPermission('customers:read'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, company_name, full_name, email, phone, address_line1, area, city, emirate, is_active, created_at
       FROM customers WHERE workshop_id = ? ORDER BY company_name ASC`,
      [req.workshopId]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[api/v1/customers GET]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch customers' });
  }
});

// ════════════════════════════════════════════════════════════════
//  WEBHOOKS (list only — management still via JWT UI)
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/webhooks
 * List webhook endpoints registered for this workshop.
 * Requires: webhooks:manage
 */
router.get('/webhooks', requireApiPermission('webhooks:manage'), async (req, res) => {
  try {
    const rows = await query(
      'SELECT id, name, url, events, is_active, created_at FROM webhook_endpoints WHERE workshop_id = ? ORDER BY created_at DESC',
      [req.workshopId]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch webhooks' });
  }
});

// ════════════════════════════════════════════════════════════════
//  API DOCUMENTATION ENDPOINT
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/docs
 * Returns machine-readable API documentation (no auth required on this endpoint).
 */
router.get('/docs', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}/api/v1`;
  return res.json({
    success: true,
    version: 'v1',
    base_url: baseUrl,
    authentication: {
      methods: [
        { header: 'X-API-Key', format: 'td_XXXXXXXXXXXX' },
        { header: 'Authorization', format: 'Bearer td_XXXXXXXXXXXX' },
      ],
      note: 'Generate API keys in Dashboard → Integrations',
    },
    permissions: {
      read: ['work_orders:read', 'service_status:read'],
      write: ['work_orders:read', 'work_orders:write', 'service_status:read'],
      full: [
        'work_orders:read', 'work_orders:write', 'service_status:read', 'service_status:write',
        'customers:read', 'customers:write', 'mechanics:read', 'webhooks:manage',
      ],
    },
    endpoints: [
      { method: 'GET',   path: '/work_orders',              description: 'List work orders with pagination',       permissions: ['work_orders:read'],  params: 'page, limit, status, from, to, service_status_token' },
      { method: 'GET',   path: '/work_orders/:id',           description: 'Get work order by ID or service status token', permissions: ['work_orders:read'] },
      { method: 'POST',  path: '/work_orders',              description: 'Create a new work order',                 permissions: ['work_orders:write'], body: 'customer_name*, customer_phone*, customer_address*, customer_id, order_type, category, sender_name, sender_phone, sender_address, payment_method, cash_amount, service_fee, scheduled_at, items[], notes, reference_id' },
      { method: 'PATCH', path: '/work_orders/:id/cancel',   description: 'Cancel a pending work order',             permissions: ['work_orders:write'], body: 'reason' },
      { method: 'GET',   path: '/service-status/:token',    description: 'Get service status by token',             permissions: ['service_status:read'] },
      { method: 'GET',   path: '/customers',                description: 'List workshop customers',                permissions: ['customers:read'] },
      { method: 'GET',   path: '/webhooks',                 description: 'List webhook endpoints',                  permissions: ['webhooks:manage'] },
      { method: 'POST',  path: '/enquiries',                description: 'Push a website / landing-page enquiry. Idempotent on `reference`.', permissions: ['enquiries:write'], body: 'reference, branch, service, customer{name*, phone*, email}, vehicle{make, model, year, plateNumber}, preferredDate, notes, source' },
      { method: 'GET',   path: '/enquiries/:reference',     description: 'Look up a pushed enquiry by its reference', permissions: ['enquiries:read'] },
      { method: 'GET',   path: '/docs',                     description: 'This documentation endpoint',             permissions: [] },
    ],
    rate_limits: { window: '15 minutes', max_requests: 500 },
    errors: {
      401: 'Missing or invalid API key',
      403: 'API key revoked, expired, or lacks required permission',
      404: 'Resource not found',
      409: 'Conflict — reference already used by a different enquiry',
      422: 'Validation failed',
      429: 'Rate limit exceeded',
    },
  });
});

export default router;
