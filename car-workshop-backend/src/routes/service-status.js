import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendSMS, interpolate } from '../lib/sms.js';
import { publicTrackingLimiter } from '../lib/rate-limits.js';
import { isTechnician } from '../lib/access.js';
import { customerStatusUrl } from '../lib/customer-link.js';
import { woLabel } from '../lib/status-labels.js';
import { applyStatusChange, canSetStatus, statusNotAllowed } from './work-orders.js';

const router = express.Router();

/**
 * Ported from delivery-service-backend/src/routes/tracking.js -> service-status.js
 *
 * Customer-facing vehicle SERVICE STATUS tracking (was package/order tracking).
 * `tracking_token` -> `service_status_token`. The customer's status page now
 * reads /api/public/service-status/:token (routes/public-service-status.js);
 * the old public GET /:token here answers 410 MOVED.
 *
 * Status enum kept as the car_workshop.sql work_orders enum:
 *   pending, confirmed, assigned, accepted, in_progress, inspection,
 *   ready_for_pickup, completed, cancelled
 * (delivery-only statuses picked_up/in_transit/delivered/returned dropped —
 * see car_workshop.sql comment above the work_orders table).
 *
 * Who uses what:
 *   - customers: nothing here any more (GET /:token is 410 MOVED);
 *   - staff: the token tools (search, /:token/order, /:token/scan,
 *     /:token/status, /:token/send-sms). A status change here follows the
 *     same role rules and gates as PATCH /api/work-orders/:id/status;
 *   - technicians: GET /my-orders only (deprecated). They book time and finish
 *     jobs from My Jobs (/api/job-cards); every token tool refuses them.
 */

// Technicians work from My Jobs. lib/access.js lets their login into this
// router for /my-orders; everything else here is a staff tool.
function refuseTechnician(req, res, next) {
  if (!isTechnician(req.user)) return next();
  return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Technicians update their work from My Jobs.' });
}

// GET /api/service-status/my-orders — MECHANIC: my assigned work orders (authenticated)
//
// DEPRECATED — the technician app reads its jobs from /api/job-cards (My
// Jobs). Kept, slimmed, for the old screens and scripts/qa/security-test.mjs:
// no customer contact details, no prices, pay or takings, and "active" is the
// work still on the technician's bench (a job at quality check or ready for
// collection is not theirs to act on).
const MY_ORDERS_ACTIVE = "('assigned','accepted','in_progress')";
router.get('/my-orders', authMiddleware, async (req, res) => {
  try {
    res.set('Deprecation', 'true');
    // Find mechanic record linked to this user
    const [mechanic] = await query(
      'SELECT id, full_name, status FROM mechanics WHERE user_id = ? AND workshop_id = ?',
      [req.user.id, req.workshopId]
    );
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'No mechanic profile linked to your account' });
    }

    const { status: filterStatus } = req.query;
    let statusFilter = MY_ORDERS_ACTIVE; // active by default
    if (filterStatus === 'completed') statusFilter = "('completed')";
    else if (filterStatus === 'cancelled') statusFilter = "('cancelled')";
    else if (filterStatus === 'all')       statusFilter = "('assigned','accepted','in_progress','inspection','ready_for_pickup','completed','cancelled')";

    // No customer name, status link token, signature or proof photo: a
    // technician sees the car and the work, not the customer (plan Q5).
    const orders = await query(
      `SELECT o.id, o.work_order_number, o.status, o.work_order_type,
              o.service_category, o.special_instructions, o.notes,
              o.started_at, o.completed_at, o.failed_at,
              o.created_at, sb.name as service_bay_name,
              o.description, o.odometer_in,
              v.make AS vehicle_make, v.model AS vehicle_model, v.year AS vehicle_year,
              v.plate_number AS vehicle_plate, v.vin AS vehicle_vin
       FROM work_orders o
       LEFT JOIN service_bays sb ON o.service_bay_id = sb.id
       LEFT JOIN vehicles v ON o.vehicle_id = v.id
       WHERE o.mechanic_id = ? AND o.workshop_id = ? AND o.status IN ${statusFilter}
       ORDER BY FIELD(o.status, 'in_progress','inspection','ready_for_pickup','assigned','completed','cancelled'), o.created_at DESC`,
      [mechanic.id, req.workshopId]
    );

    // Attach parts list to each order
    for (const order of orders) {
      try {
        order.parts = await query(
          'SELECT id, part_number, name, quantity, status FROM parts WHERE work_order_id = ? AND workshop_id = ? ORDER BY id ASC',
          [order.id, req.workshopId]
        );
      } catch (_) { order.parts = []; }
      // The job card's lines — for an estimate-born job, exactly what the
      // customer approved. The technician works from these.
      order.items = await query(
        'SELECT id, name, item_type, quantity FROM work_order_items WHERE work_order_id = ? ORDER BY id',
        [order.id]
      ).catch(() => []);
    }

    // Counts only: today (active = on the bench now; completed/cancelled by
    // completed_at/cancelled_at), all time, and per tab.
    const [counts] = await query(
      `SELECT
        SUM(status IN ${MY_ORDERS_ACTIVE}) as active,
        SUM(status = 'completed' AND DATE(completed_at) = CURDATE()) as completed_today,
        SUM(status = 'cancelled' AND DATE(cancelled_at) = CURDATE()) as cancelled_today,
        COUNT(*) as total_orders,
        SUM(status = 'completed') as total_completed,
        SUM(status = 'cancelled') as total_cancelled
       FROM work_orders WHERE mechanic_id = ? AND workshop_id = ?`,
      [mechanic.id, req.workshopId]
    );
    const n = v => parseInt(v || 0, 10);

    return res.json({
      success: true,
      deprecated: true,
      data: {
        mechanic: { id: mechanic.id, name: mechanic.full_name, status: mechanic.status },
        orders,
        stats: {
          active:    n(counts?.active),
          completed: n(counts?.completed_today),
          cancelled: n(counts?.cancelled_today),
        },
        tabCounts: {
          active:    n(counts?.active),
          completed: n(counts?.total_completed),
          cancelled: n(counts?.total_cancelled),
        },
        allTimeStats: {
          total_orders:    n(counts?.total_orders),
          total_completed: n(counts?.total_completed),
          total_cancelled: n(counts?.total_cancelled),
        },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Failed to load mechanic work orders' });
  }
});

// GET /api/service-status/:token — RETIRED. The customer's status page
// (/service-status/:token, /track/:token) reads GET /api/public/service-status/:token
// (routes/public-service-status.js, lib/customer-status.js), whose payload is
// built for customers. This one answers 410 so nothing keeps reading the old
// work order fields through it.
router.get('/:token', publicTrackingLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(410).json({
    success: false, code: 'MOVED',
    message: 'This status link moved. Use /api/public/service-status/:token.',
    url: `/api/public/service-status/${encodeURIComponent(req.params.token)}`,
  });
});

// GET /api/service-status — search by work order number (authenticated, staff)
router.get('/', authMiddleware, refuseTechnician, async (req, res) => {
  try {
    const { work_order_number } = req.query;
    if (!work_order_number) return res.status(400).json({ success: false, message: 'work_order_number required' });
    const [order] = await query(
      'SELECT id, work_order_number, service_status_token, status FROM work_orders WHERE work_order_number = ? AND workshop_id = ?',
      [work_order_number, req.workshopId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'Work order not found' });
    return res.json({ success: true, data: order });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Search failed' });
  }
});

// GET /api/service-status/:token/order — STAFF: full work order data (authenticated)
// Supports BOTH service status tokens AND part_number scans. A technician
// opens their own job card from My Jobs instead (any token here is any job).
router.get('/:token/order', authMiddleware, refuseTechnician, async (req, res) => {
  try {
    const token = req.params.token;
    let scannedPartId = null;

    // 1. Try work order service_status_token first
    let [order] = await query(
      `SELECT o.*,
              m.full_name as mechanic_name, m.phone as mechanic_phone,
              sb.name as service_bay_name,
              c.full_name as customer_full_name
       FROM work_orders o
       LEFT JOIN mechanics m ON o.mechanic_id = m.id
       LEFT JOIN service_bays sb ON o.service_bay_id = sb.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.service_status_token = ? AND o.workshop_id = ?`,
      [token, req.workshopId]
    );

    // 2. If not found, try part_number lookup
    if (!order) {
      const [part] = await query(
        `SELECT p.*, o2.service_status_token as order_token
         FROM parts p JOIN work_orders o2 ON p.work_order_id = o2.id
         WHERE p.part_number = ? AND p.workshop_id = ?`,
        [token, req.workshopId]
      );
      if (part) {
        scannedPartId = part.id;
        [order] = await query(
          `SELECT o.*,
                  m.full_name as mechanic_name, m.phone as mechanic_phone,
                  sb.name as service_bay_name,
                  c.full_name as customer_full_name
           FROM work_orders o
           LEFT JOIN mechanics m ON o.mechanic_id = m.id
           LEFT JOIN service_bays sb ON o.service_bay_id = sb.id
           LEFT JOIN customers c ON o.customer_id = c.id
           WHERE o.id = ? AND o.workshop_id = ?`,
          [part.work_order_id, req.workshopId]
        );
      }
    }

    if (!order) return res.status(404).json({ success: false, message: 'Work order not found' });

    const items = await query('SELECT * FROM work_order_items WHERE work_order_id = ?', [order.id]);
    const statusLogs = await query(
      'SELECT sl.*, u.full_name as changed_by_name FROM work_order_status_logs sl LEFT JOIN users u ON sl.changed_by = u.id WHERE sl.work_order_id = ? ORDER BY sl.created_at ASC',
      [order.id]
    );
    const scanLogs = await query(
      'SELECT * FROM work_order_scan_logs WHERE work_order_id = ? ORDER BY scanned_at DESC LIMIT 20',
      [order.id]
    ).catch(() => []);
    const parts = await query(
      'SELECT id, part_number, name, description, quantity, unit_cost, total_cost, status FROM parts WHERE work_order_id = ? AND workshop_id = ? ORDER BY id ASC',
      [order.id, req.workshopId]
    ).catch(() => []);

    return res.json({
      success: true,
      data: { ...order, items, status_logs: statusLogs, scan_logs: scanLogs, parts },
      scanned_part_id: scannedPartId,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Failed to fetch work order' });
  }
});

// POST /api/service-status/:token/scan — log a scan event (staff / service-bay check-in)
// Supports BOTH service status tokens AND part_number scans.
//
// A scan is a record that the car or part was seen, nothing more: it never
// moves the job. Status changes go through PATCH /:token/status (or the job
// card screen), with the role rules, quality check and gate pass that apply.
const SCAN_TYPES = ['checkin_scan', 'bay_in', 'bay_out', 'pickup_scan', 'completion_scan']; // work_order_scan_logs.scan_type
router.post('/:token/scan', authMiddleware, refuseTechnician, async (req, res) => {
  try {
    const { lat, lng, note } = req.body;
    const scan_type = SCAN_TYPES.includes(req.body.scan_type) ? req.body.scan_type : 'checkin_scan';
    const token = req.params.token.trim();

    // 1. Try work order lookup first
    let [order] = await query(
      'SELECT id, work_order_number FROM work_orders WHERE service_status_token = ? AND workshop_id = ?',
      [token, req.workshopId]
    );

    // 2. If not a work order token, try part_number lookup
    let part = null;
    if (!order) {
      [part] = await query(
        `SELECT p.id, p.part_number, o.id as parent_work_order_id, o.work_order_number
         FROM parts p
         JOIN work_orders o ON p.work_order_id = o.id
         WHERE p.part_number = ? AND p.workshop_id = ?`,
        [token.toUpperCase(), req.workshopId]
      );
      if (part) order = { id: part.parent_work_order_id, work_order_number: part.work_order_number };
    }

    if (!order) return res.status(404).json({ success: false, message: 'Work order or part not found for this code' });

    // Log the scan
    await execute(
      `INSERT INTO work_order_scan_logs (work_order_id, workshop_id, scanned_by, scan_type, lat, lng, note, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [order.id, req.workshopId, req.user?.id || null, scan_type, lat || null, lng || null, note || null]
    ).catch(e => console.error('[ServiceStatus] scan log:', e.message));

    return res.json({
      success: true,
      data: {
        work_order_id: order.id,
        work_order_number: order.work_order_number,
        scan_type,
        part: part ? { id: part.id, part_number: part.part_number } : null,
      },
      message: 'Scan logged',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Scan failed' });
  }
});

// PATCH /api/service-status/:token/status — STAFF: change a job's status by its token (authenticated)
//
// The same change as PATCH /api/work-orders/:id/status, reached from a QR or
// token: the role must hold the capability for the new status
// (STATUS_CAPABILITIES), and applyStatusChange() applies the transition map,
// the customer-approval, quality-check and gate-pass gates and every side
// effect (status log, invoice, technician release, customer messages,
// webhooks). Payment is recorded on the invoice, never here.
router.patch('/:token/status', authMiddleware, refuseTechnician, async (req, res) => {
  try {
    const { status, note, lat, lng } = req.body;
    const validStatuses = ['confirmed','assigned','accepted','in_progress','ready_for_pickup','completed','cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    if (!canSetStatus(req.user, status)) return res.status(403).json(statusNotAllowed(status));
    const token = req.params.token.trim();

    const [order] = await query(
      'SELECT id, status FROM work_orders WHERE service_status_token = ? AND workshop_id = ?',
      [token, req.workshopId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'Work order not found' });

    if (order.status === status) {
      return res.json({ success: true, message: `Already at ${woLabel(status)}`, new_status: status });
    }

    const r = await applyStatusChange({ workOrderId: order.id, workshopId: req.workshopId, userId: req.user.id, status, note, lat, lng });
    if (!r.ok) return res.status(r.http || 400).json({ success: false, ...(r.code ? { code: r.code } : {}), message: r.message, ...(r.extra || {}) });
    return res.json({ success: true, message: `Status updated: ${woLabel(status)}`, new_status: status });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Status update failed' });
  }
});

// POST /api/service-status/start-trip — RETIRED. It moved every assigned job
// of the technician to in progress at once, with no time booked, and texted
// every customer. Work starts per job card with Start (time booking).
router.post('/start-trip', authMiddleware, (_req, res) => {
  res.status(410).json({ success: false, code: 'MOVED', message: 'Start work with Start on the job card.' });
});

// POST /api/service-status/:token/send-sms — STAFF: text the customer the link to their status page
router.post('/:token/send-sms', authMiddleware, refuseTechnician, async (req, res) => {
  try {
    const token = req.params.token.trim();
    const [order] = await query(
      `SELECT o.id, o.work_order_number, o.customer_phone, o.service_status_token,
              v.make AS vehicle_make, v.model AS vehicle_model, v.plate_number AS vehicle_plate
       FROM work_orders o
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       WHERE o.service_status_token = ? AND o.workshop_id = ?`,
      [token, req.workshopId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'Work order not found' });
    // Imported accounts can carry '-' as the phone.
    if (!/\d/.test(String(order.customer_phone || ''))) return res.status(400).json({ success: false, message: 'No customer phone on file' });

    const message = interpolate('Pioneer Car Service: follow your {vehicle}{plate} here: {link}', {
      vehicle: [order.vehicle_make, order.vehicle_model].filter(Boolean).join(' ') || 'car',
      plate: order.vehicle_plate ? ` (${order.vehicle_plate})` : '',
      link: customerStatusUrl(order),
    });

    const result = await sendSMS({ to: order.customer_phone, message, workshopId: req.workshopId });
    if (!result?.success) {
      return res.status(502).json({ success: false, message: 'The SMS could not be sent. Try again, or share the link another way.' });
    }
    return res.json({ success: true, message: 'Service status link sent via SMS', data: result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Failed to send SMS' });
  }
});

export default router;
