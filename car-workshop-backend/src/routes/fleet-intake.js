/**
 * Fleet coordinator intake — the vehicle information section, on its own page.
 *
 * Step 2 of the approved process (whiteboard, 15 Sep 2026) lists five ways the
 * vehicle details and the vehicle issue can reach us: a service advisor typing
 * them, a link for fleet coordinators, the website, WhatsApp and social media.
 * This file is the second of those, and it is the one that replaces real paper
 * — an Aman Taxi "Work Order Generation" sheet, filled in by their fleet
 * supervisor, handed over, and then re-keyed by our advisor. The re-keying is
 * where the chassis numbers get lost.
 *
 * Two deliberate decisions:
 *
 *   1. A coordinator is not a system user. They work for the fleet, not for
 *      Pioneer, and giving each of them a login to maintain (and to revoke
 *      when they change jobs) is a cost with no return. So the page is
 *      tokenised per account, the same pattern as the estimate approval link.
 *      The token says which fleet is submitting, which is why the form never
 *      asks them to pick a customer — they could only get it wrong.
 *
 *   2. A submission is a request, not a work order. Some are duplicates of a
 *      car already in the bay, some are rejected. Writing them straight into
 *      work_orders would put rejected rows into every count, every dashboard
 *      and every month-end figure, so they live in their own table until a
 *      human converts them.
 */

import express from 'express';
import crypto from 'crypto';
import pool, { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { stripMarkupFields, clampTextFields } from '../lib/sanitize.js';
import { logAudit } from '../lib/audit.js';
import { notifyWorkOrderStatus, sendCustomNotification } from '../lib/notify.js';
import { ensureMainJobCard, notifyGroups } from '../lib/workflow.js';
import { requireCapability } from '../lib/roles.js';
import { serviceStatusToken } from '../lib/tokens.js';
import { payerTypeForClass, snapshotIntakeClass } from '../lib/crm-cycle.js';

const IDENTITY = [
  'plate_number', 'plate_code', 'plate_emirate', 'make', 'model', 'color',
  'vin', 'engine_no', 'fleet_code', 'work_type', 'external_ref',
  'driver_name', 'driver_phone', 'permit_id', 'submitted_by', 'label',
  'contact_name', 'contact_phone',
];
const FREE_TEXT = ['complaint', 'review_note'];
const _clean = (body) => clampTextFields(stripMarkupFields(body || {}, IDENTITY), FREE_TEXT);

/* Shared field normalisation, used by both the public submit and the staff
 * create path so the two cannot drift apart. */
function normaliseSubmission(body) {
  const b = _clean(body);
  const int = (v, max) => {
    if (v === '' || v == null) return null;
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n < 0 || n > max) return null;
    return n;
  };
  return {
    plate_number:  b.plate_number  ? String(b.plate_number).trim().slice(0, 50) : null,
    plate_code:    b.plate_code    ? String(b.plate_code).trim().slice(0, 10) : null,
    plate_emirate: b.plate_emirate ? String(b.plate_emirate).trim().slice(0, 50) : null,
    make:          b.make          ? String(b.make).trim().slice(0, 100) : null,
    model:         b.model         ? String(b.model).trim().slice(0, 100) : null,
    // A year outside this range is a typo, not a car. Stored as NULL rather
    // than rejected, because a coordinator mistyping the year should not stop
    // a broken taxi being booked in.
    year:          (() => { const y = int(b.year, 2100); return y && y >= 1900 ? y : null; })(),
    color:         b.color         ? String(b.color).trim().slice(0, 50) : null,
    vin:           b.vin           ? String(b.vin).trim().toUpperCase().slice(0, 50) : null,
    engine_no:     b.engine_no     ? String(b.engine_no).trim().slice(0, 50) : null,
    fleet_code:    b.fleet_code    ? String(b.fleet_code).trim().slice(0, 50) : null,
    odometer:      int(b.odometer, 9999999),
    complaint:     b.complaint ? String(b.complaint).trim().slice(0, 2000) : '',
    work_type:     b.work_type     ? String(b.work_type).trim().slice(0, 60) : null,
    external_ref:  b.external_ref  ? String(b.external_ref).trim().slice(0, 60) : null,
    driver_name:   b.driver_name   ? String(b.driver_name).trim().slice(0, 150) : null,
    driver_phone:  b.driver_phone  ? String(b.driver_phone).trim().slice(0, 50) : null,
    permit_id:     b.permit_id     ? String(b.permit_id).trim().slice(0, 60) : null,
    submitted_by:  b.submitted_by  ? String(b.submitted_by).trim().slice(0, 150) : null,
    preferred_date: /^\d{4}-\d{2}-\d{2}$/.test(b.preferred_date || '') ? b.preferred_date : null,
  };
}

/* The three things the process makes mandatory, checked in one place so the
 * public form and the staff form give the same answer. */
function validateSubmission(f) {
  if (!f.complaint) return 'Describe the problem with the vehicle.';
  if (!f.vin) return 'VIN / chassis number is required.';
  if (f.odometer == null) return 'Mileage (odometer reading) is required.';
  if (!f.plate_number && !f.fleet_code) {
    return 'Give either the plate number or your own unit code so we can identify the vehicle.';
  }
  return '';
}

/* Best-effort vehicle match, in confidence order. Never auto-assigns on a
 * weak match: an intake attached to the wrong car writes service history
 * onto a vehicle that was never here, and that is far more expensive to
 * unpick than asking an advisor to confirm.
 *
 * Every lookup — the VIN included — is limited to the link's own account.
 * A VIN match across the whole workshop bound fleet requests to another
 * customer's car (which then could never be converted) and told an
 * anonymous link holder that car's plate, make and model. */
async function findVehicleMatch(workshopId, customerId, f) {
  if (f.vin) {
    const [byVin] = await query(
      `SELECT * FROM vehicles WHERE workshop_id = ? AND customer_id = ?
         AND UPPER(REPLACE(vin, ' ', '')) = ? AND is_active = 1 LIMIT 1`,
      [workshopId, customerId, String(f.vin).replace(/\s/g, '').toUpperCase()]
    );
    if (byVin) return { vehicle: byVin, matched_on: 'vin' };
  }
  if (f.plate_number) {
    const [byPlate] = await query(
      `SELECT * FROM vehicles WHERE workshop_id = ? AND customer_id = ?
         AND plate_number = ? AND is_active = 1 LIMIT 1`,
      [workshopId, customerId, f.plate_number]
    );
    if (byPlate) return { vehicle: byPlate, matched_on: 'plate' };
  }
  if (f.fleet_code) {
    const [byCode] = await query(
      `SELECT * FROM vehicles WHERE workshop_id = ? AND customer_id = ?
         AND fleet_code = ? AND is_active = 1 LIMIT 1`,
      [workshopId, customerId, f.fleet_code]
    );
    if (byCode) return { vehicle: byCode, matched_on: 'fleet_code' };
  }
  return { vehicle: null, matched_on: null };
}

/* Staff only, never on the public side: the VIN is on file for a car of a
 * DIFFERENT customer. Shown to the advisor as something to settle (the car
 * changed hands, or one VIN was mistyped) — never stored as the match. */
async function findVinConflict(workshopId, customerId, vin) {
  if (!vin) return null;
  const [other] = await query(
    `SELECT v.id, v.plate_number, v.make, v.model, v.customer_id, c.full_name AS owner_name
       FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id
      WHERE v.workshop_id = ? AND v.customer_id <> ? AND v.is_active = 1
        AND UPPER(REPLACE(v.vin, ' ', '')) = ? LIMIT 1`,
    [workshopId, customerId, String(vin).replace(/\s/g, '').toUpperCase()]
  );
  return other || null;
}

/* Open job cards on a car — a fleet sending in a car that is already with us. */
async function openWorkOrdersFor(workshopId, vehicleId, { days = null } = {}) {
  if (!vehicleId) return [];
  return query(
    `SELECT id, work_order_number, status, created_at FROM work_orders
      WHERE workshop_id = ? AND vehicle_id = ? AND status NOT IN ('completed', 'cancelled')
        ${days ? 'AND created_at > DATE_SUB(NOW(), INTERVAL ? DAY)' : ''}
      ORDER BY id DESC LIMIT 5`,
    [workshopId, vehicleId, ...(days ? [days] : [])]
  );
}

/* Coordinator links are for fleet accounts — the Fleet subcategory, internal
 * or external (process Step 1). A walk-in, an insurer or a Pioneer asset
 * account has no coordinator sending cars in. */
const isFleetAccount = c => !!c && c.customer_subcategory === 'fleet';

/* A link works while it is enabled, not expired, and its account is an
 * active fleet account. A deactivated account's links stop with it. */
function linkUsable(link) {
  return !!link && !!link.is_active && !!link.customer_active && isFleetAccount(link)
    && !(link.expires_at && new Date(link.expires_at) < new Date());
}

/* An expiry date entered as a day means the whole of that day: '2026-10-12'
 * is stored as 2026-10-12 23:59:59, not midnight at its start. Returns
 * { value } or { error } — an impossible date is a 400, not a 500. */
function parseExpiry(raw) {
  if (raw == null || String(raw).trim() === '') return { value: null };
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return { error: 'Enter the expiry as a date (YYYY-MM-DD).' };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) {
    return { error: 'That expiry date does not exist.' };
  }
  const time = m[4] ? `${m[4]}:${m[5]}:${m[6] || '00'}` : '23:59:59';
  if (m[4] && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] || 0) > 59)) return { error: 'That expiry time does not exist.' };
  const value = `${m[1]}-${m[2]}-${m[3]} ${time}`;
  if (new Date(value.replace(' ', 'T')) < new Date()) return { error: 'The expiry date is in the past.' };
  return { value };
}

/* ═══════════════════════════════════════════════════════════════════════
   PUBLIC ROUTER — no login. Mounted at /api/public/fleet-intake
   ═══════════════════════════════════════════════════════════════════════ */
const publicRouter = express.Router();

async function loadLink(token) {
  if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) return null;
  const [link] = await query(
    `SELECT l.*, c.full_name AS customer_name, c.code AS customer_code,
            c.customer_class, c.customer_subcategory, c.is_active AS customer_active,
            w.name AS workshop_name
       FROM fleet_intake_links l
       JOIN customers c ON c.id = l.customer_id
       JOIN workshops w ON w.id = l.workshop_id
      WHERE l.token = ?`,
    [token]
  );
  return link || null;
}

// GET /api/public/fleet-intake/:token — what the coordinator sees on open
publicRouter.get('/:token', async (req, res) => {
  try {
    const link = await loadLink(req.params.token);
    // One message for "no such link", "deactivated", "expired" and "the
    // account was closed". Telling an anonymous caller which it is turns
    // the endpoint into an oracle for probing valid tokens.
    if (!linkUsable(link)) {
      return res.status(404).json({ success: false, message: 'This link is no longer valid. Please ask your service contact for a new one.' });
    }

    // Their own vehicles, so the form can offer them rather than making
    // someone retype a chassis number they have given us twenty times.
    const vehicles = await query(
      `SELECT id, plate_number, plate_code, plate_emirate, make, model, year,
              color, vin, engine_no, fleet_code, mileage
         FROM vehicles
        WHERE workshop_id = ? AND customer_id = ? AND is_active = 1
        ORDER BY plate_number LIMIT 500`,
      [link.workshop_id, link.customer_id]
    );

    return res.json({
      success: true,
      data: {
        workshop_name: link.workshop_name,
        customer_name: link.customer_name,
        customer_code: link.customer_code,
        contact_name: link.contact_name,
        label: link.label,
        vehicles,
      },
    });
  } catch (err) {
    console.error('[FleetIntake] Public load error:', err);
    return res.status(500).json({ success: false, message: 'Could not open this form' });
  }
});

// POST /api/public/fleet-intake/:token — submit one vehicle
publicRouter.post('/:token', async (req, res) => {
  let conn;
  try {
    const link = await loadLink(req.params.token);
    if (!linkUsable(link)) {
      return res.status(404).json({ success: false, message: 'This link is no longer valid. Please ask your service contact for a new one.' });
    }

    const f = normaliseSubmission(req.body);
    const msg = validateSubmission(f);
    if (msg) return res.status(400).json({ success: false, message: msg });

    const { vehicle } = await findVehicleMatch(link.workshop_id, link.customer_id, f);
    // A car we do not hold for this fleet is added as a new vehicle when the
    // request is booked in, and a vehicle record needs its make and model —
    // asked for here, where the coordinator knows them, rather than leaving
    // the advisor with a request that cannot be booked in.
    if (!vehicle && (!f.make || !f.model)) {
      return res.status(400).json({ success: false, code: 'MAKE_MODEL_REQUIRED',
        message: 'This vehicle is not on your fleet list yet — give its make and model too.' });
    }

    // Already with us: a car with an open job card from the last 30 days is
    // in the workshop (older open cards are stale records, flagged to staff
    // on the request instead of blocking the fleet).
    const open = vehicle ? await openWorkOrdersFor(link.workshop_id, vehicle.id, { days: 30 }) : [];
    if (open.length) {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_BOOKED_IN',
        message: `This vehicle is already booked in with us (job card ${open[0].work_order_number}). Call your service contact if this is a new problem.`,
      });
    }

    // The duplicate check and the insert run under a lock on the link, so a
    // double click — or two people in the same office sending the same
    // breakdown at the same moment — gives one request, not two.
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('SELECT id FROM fleet_intake_links WHERE id = ? FOR UPDATE', [link.id]);

    // Guard against the same car being submitted twice — a coordinator
    // refreshing the page, or two people in the same office sending the same
    // breakdown. Matched on plate/VIN within the last 24 hours and still
    // unconverted, so a car that legitimately comes back next week is not
    // blocked.
    const [[recentDup]] = await conn.query(
      `SELECT id, created_at FROM fleet_intake_requests
        WHERE workshop_id = ? AND customer_id = ?
          AND status IN ('submitted', 'accepted')
          AND (   (vin IS NOT NULL AND vin = ?)
               OR (plate_number IS NOT NULL AND plate_number = ?) )
          AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        LIMIT 1`,
      [link.workshop_id, link.customer_id, f.vin, f.plate_number]
    );
    if (recentDup) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: 'This vehicle was already sent to us in the last 24 hours and is waiting to be booked in. Call us if it is urgent.',
      });
    }

    const [result] = await conn.query(
      `INSERT INTO fleet_intake_requests
         (workshop_id, link_id, customer_id, vehicle_id,
          plate_number, plate_code, plate_emirate, make, model, year, color,
          vin, engine_no, fleet_code, odometer,
          complaint, work_type, external_ref, driver_name, driver_phone,
          permit_id, submitted_by, preferred_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [link.workshop_id, link.id, link.customer_id, vehicle ? vehicle.id : null,
       f.plate_number, f.plate_code, f.plate_emirate, f.make, f.model, f.year, f.color,
       f.vin, f.engine_no, f.fleet_code, f.odometer,
       f.complaint, f.work_type, f.external_ref, f.driver_name, f.driver_phone,
       f.permit_id, f.submitted_by || link.contact_name, f.preferred_date]
    );

    await conn.query(
      'UPDATE fleet_intake_links SET last_used_at = NOW(), submission_count = submission_count + 1 WHERE id = ?',
      [link.id]
    );
    await conn.commit();

    const reference = `FI-${String(result.insertId).padStart(6, '0')}`;
    // Step 2 → 3: the desk that books requests in is told one is waiting,
    // instead of it sitting unseen until someone opens the Fleet Intake page.
    // Fire and forget — a notification failure must not fail the fleet's submit.
    notifyGroups(link.workshop_id, ['service_advisor', 'manager'], {
      title: `Fleet request ${reference} · ${f.plate_number || f.fleet_code}`,
      body: `${link.customer_name}: ${String(f.complaint).slice(0, 120)}`,
      link: '/fleet-intake', icon: '🚚', type: 'fleet_intake_submitted',
    }).catch(e => console.error('[FleetIntake] notify error:', e.message));

    // The reference is what the coordinator writes on their own paperwork,
    // so it has to come back on the response — not just a success tick.
    // The match is always one of this fleet's own vehicles.
    return res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        reference,
        matched_vehicle: vehicle && vehicle.customer_id === link.customer_id
          ? { plate_number: vehicle.plate_number, make: vehicle.make, model: vehicle.model } : null,
      },
      message: 'Received. Our service team will confirm shortly.',
    });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch { /* connection gone */ } }
    console.error('[FleetIntake] Public submit error:', err);
    return res.status(500).json({ success: false, message: 'Could not send this form. Please try again.' });
  } finally {
    if (conn) conn.release();
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   STAFF ROUTER — mounted at /api/fleet-intake
   ═══════════════════════════════════════════════════════════════════════ */
const router = express.Router();
router.use(authMiddleware);
// Fleet intake is Step 2 desk work: issuing and disabling coordinator links,
// reading their tokens, accepting, rejecting and booking requests in belong
// to whoever opens job cards (Service Advisor, Supervisor, managers). A
// Storekeeper or Team Leader switching off a fleet's channel, or copying a
// coordinator's token, is not part of their job.
router.use(requireCapability('job.open', 'Fleet intake is handled by the Service Advisor desk (or a manager).'));

/* ── The queue ──────────────────────────────────────────────────────── */
// GET /api/fleet-intake
router.get('/', async (req, res) => {
  try {
    const { status, customer_id, search, page = 1, limit = 50 } = req.query;
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const offset = (pg - 1) * lim;

    let where = 'WHERE r.workshop_id = ?';
    const params = [req.workshopId];

    if (status) {
      const wanted = String(status).split(',').map(s => s.trim())
        .filter(s => ['submitted', 'accepted', 'rejected', 'converted'].includes(s));
      if (wanted.length) {
        where += ` AND r.status IN (${wanted.map(() => '?').join(',')})`;
        params.push(...wanted);
      }
    }
    if (customer_id) { where += ' AND r.customer_id = ?'; params.push(customer_id); }
    if (search) {
      where += ` AND (r.plate_number LIKE ? OR r.vin LIKE ? OR r.fleet_code LIKE ?
                      OR r.external_ref LIKE ? OR c.full_name LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM fleet_intake_requests r
         JOIN customers c ON c.id = r.customer_id ${where}`,
      params
    );

    const rows = await query(
      `SELECT r.*,
              c.full_name AS customer_name, c.code AS customer_code,
              c.customer_subcategory,
              v.plate_number AS matched_plate, v.make AS matched_make, v.model AS matched_model,
              l.label AS link_label,
              o.work_order_number
         FROM fleet_intake_requests r
         JOIN customers c ON c.id = r.customer_id
         LEFT JOIN vehicles v ON v.id = r.vehicle_id
         LEFT JOIN fleet_intake_links l ON l.id = r.link_id
         LEFT JOIN work_orders o ON o.id = r.work_order_id
         ${where}
         ORDER BY FIELD(r.status, 'submitted', 'accepted', 'rejected', 'converted'), r.created_at DESC
         LIMIT ${lim} OFFSET ${offset}`,
      params
    );

    // Counts come from their own query rather than from the rows above: the
    // rows are one page, so counting them would make the "waiting" badge read
    // 50 whatever the real backlog is.
    const countRows = await query(
      `SELECT status, COUNT(*) AS n FROM fleet_intake_requests
        WHERE workshop_id = ? GROUP BY status`,
      [req.workshopId]
    );
    const counts = { submitted: 0, accepted: 0, rejected: 0, converted: 0 };
    for (const r of countRows) counts[r.status] = Number(r.n);

    return res.json({
      success: true,
      data: rows,
      counts,
      pagination: { total: Number(total), page: pg, limit: lim },
    });
  } catch (err) {
    console.error('[FleetIntake] Queue error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load the intake queue' });
  }
});

/* ── Coordinator links ──────────────────────────────────────────────────
 * Defined above GET /:id, because Express matches in definition order and
 * /links would otherwise be swallowed as an id. */
// GET /api/fleet-intake/links
router.get('/links', async (req, res) => {
  try {
    const rows = await query(
      `SELECT l.*, c.full_name AS customer_name, c.code AS customer_code,
              c.customer_class, c.customer_subcategory, c.is_active AS customer_active
         FROM fleet_intake_links l
         JOIN customers c ON c.id = l.customer_id
        WHERE l.workshop_id = ?
        ORDER BY c.full_name, l.created_at DESC`,
      [req.workshopId]
    );
    const base = process.env.FRONTEND_URL || '';
    // status says whether the coordinator can actually use it: an expired
    // link, or one whose account was deactivated or is no longer a fleet
    // account, no longer opens even though is_active is still 1.
    const statusOf = r => (!r.is_active ? 'disabled'
      : r.expires_at && new Date(r.expires_at) < new Date() ? 'expired'
        : !r.customer_active ? 'account_inactive'
          : !isFleetAccount(r) ? 'not_fleet' : 'active');
    return res.json({
      success: true,
      data: rows.map(r => ({
        ...r, url: `${base}/fleet-intake/${r.token}`,
        status: statusOf(r), is_expired: !!(r.expires_at && new Date(r.expires_at) < new Date()),
      })),
    });
  } catch (err) {
    console.error('[FleetIntake] Links error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load links' });
  }
});

// POST /api/fleet-intake/links — issue a link to a coordinator
router.post('/links', async (req, res) => {
  try {
    const { customer_id, label, contact_name, contact_phone, expires_at } = _clean(req.body);
    if (!customer_id) {
      return res.status(400).json({ success: false, message: 'Choose the fleet account this link is for' });
    }
    const [customer] = await query(
      'SELECT id, full_name, customer_class, customer_subcategory, is_active FROM customers WHERE id = ? AND workshop_id = ?',
      [customer_id, req.workshopId]
    );
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    if (!isFleetAccount(customer)) {
      return res.status(400).json({ success: false, code: 'NOT_FLEET_ACCOUNT',
        message: `${customer.full_name} is not a fleet account. Coordinator links are for Fleet customers (internal or external).` });
    }
    if (!customer.is_active) {
      return res.status(400).json({ success: false, code: 'CUSTOMER_INACTIVE', message: `${customer.full_name} is deactivated.` });
    }
    const expiry = parseExpiry(expires_at);
    if (expiry.error) return res.status(400).json({ success: false, code: 'INVALID_EXPIRY', message: expiry.error });

    const token = crypto.randomBytes(24).toString('hex');
    const result = await execute(
      `INSERT INTO fleet_intake_links
         (workshop_id, customer_id, token, label, contact_name, contact_phone, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.workshopId, customer_id, token,
       label ? String(label).slice(0, 150) : null,
       contact_name ? String(contact_name).slice(0, 150) : null,
       contact_phone ? String(contact_phone).slice(0, 50) : null,
       expiry.value,
       req.user.id]
    );

    await logAudit({
      workshopId: req.workshopId, userId: req.user.id,
      action: 'fleet_intake_link.create', entityType: 'fleet_intake_link', entityId: result.insertId,
      newValue: { customer_id, customer_name: customer.full_name, label: label || null },
    });

    const base = process.env.FRONTEND_URL || '';
    return res.status(201).json({
      success: true,
      data: { id: result.insertId, token, url: `${base}/fleet-intake/${token}`, expires_at: expiry.value },
    });
  } catch (err) {
    console.error('[FleetIntake] Link create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create the link' });
  }
});

// PATCH /api/fleet-intake/links/:id — activate / deactivate
router.patch('/links/:id', async (req, res) => {
  try {
    const [link] = await query(
      `SELECT l.id, c.full_name, c.customer_subcategory, c.is_active AS customer_active
         FROM fleet_intake_links l JOIN customers c ON c.id = l.customer_id
        WHERE l.id = ? AND l.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!link) return res.status(404).json({ success: false, message: 'Link not found' });

    const isActive = req.body.is_active ? 1 : 0;
    if (isActive && (!isFleetAccount(link) || !link.customer_active)) {
      return res.status(400).json({ success: false, message: `${link.full_name} is ${link.customer_active ? 'not a fleet account' : 'deactivated'} — this link cannot be enabled.` });
    }
    await execute('UPDATE fleet_intake_links SET is_active = ? WHERE id = ?', [isActive, link.id]);
    await logAudit({
      workshopId: req.workshopId, userId: req.user.id,
      action: isActive ? 'fleet_intake_link.enable' : 'fleet_intake_link.disable',
      entityType: 'fleet_intake_link', entityId: link.id,
    });
    return res.json({ success: true, message: isActive ? 'Link enabled' : 'Link disabled' });
  } catch (err) {
    console.error('[FleetIntake] Link patch error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update the link' });
  }
});

/* ── One request ────────────────────────────────────────────────────── */
// GET /api/fleet-intake/:id
router.get('/:id', async (req, res) => {
  try {
    const [row] = await query(
      `SELECT r.*, c.full_name AS customer_name, c.code AS customer_code, c.phone AS customer_phone,
              c.customer_class, c.customer_subcategory,
              l.label AS link_label, l.contact_name AS link_contact,
              o.work_order_number
         FROM fleet_intake_requests r
         JOIN customers c ON c.id = r.customer_id
         LEFT JOIN fleet_intake_links l ON l.id = r.link_id
         LEFT JOIN work_orders o ON o.id = r.work_order_id
        WHERE r.id = ? AND r.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Request not found' });

    // Re-run the match at read time, not just at submit. A car whose VIN was
    // added to our records after the coordinator sent this in would otherwise
    // still show as unmatched, and the advisor would create a second vehicle.
    // A stored match is reported on the basis it was made on (VIN, plate,
    // unit code); 'stored' is left for a vehicle chosen by hand at booking-in.
    // A stored vehicle that is not this account's (requests sent before the
    // VIN match was scoped to the account) is not a match at all.
    const fresh = await findVehicleMatch(req.workshopId, row.customer_id, row);
    let vehicle = fresh.vehicle;
    let matched_on = fresh.matched_on;
    if (row.vehicle_id) {
      const [stored] = await query('SELECT * FROM vehicles WHERE id = ? AND workshop_id = ?', [row.vehicle_id, req.workshopId]);
      if (stored && stored.customer_id === row.customer_id) {
        vehicle = stored;
        matched_on = fresh.vehicle?.id === stored.id ? fresh.matched_on : 'stored';
      }
    }
    // The VIN is on another customer's car: for the advisor to settle.
    const vin_conflict = vehicle ? null : await findVinConflict(req.workshopId, row.customer_id, row.vin);
    // The car is already with us on an open job card.
    const open_work_orders = vehicle && row.status !== 'converted'
      ? await openWorkOrdersFor(req.workshopId, vehicle.id) : [];

    // Where our record and their form disagree. This is the part an advisor
    // actually needs to look at: overwriting silently is how a fleet's own
    // chassis number quietly replaces the one we read off the car.
    const discrepancies = [];
    if (vehicle) {
      const cmp = [
        ['vin', 'VIN'], ['plate_number', 'Plate number'], ['engine_no', 'Engine number'],
        ['make', 'Make'], ['model', 'Model'], ['fleet_code', 'Unit code'],
      ];
      for (const [field, label] of cmp) {
        const ours = (vehicle[field] || '').toString().trim().toUpperCase();
        const theirs = (row[field] || '').toString().trim().toUpperCase();
        if (ours && theirs && ours !== theirs) {
          discrepancies.push({ field, label, ours: vehicle[field], submitted: row[field] });
        }
      }
    }

    return res.json({
      success: true,
      data: { ...row, matched_vehicle: vehicle || null, matched_on: vehicle ? matched_on : null, discrepancies, vin_conflict, open_work_orders },
    });
  } catch (err) {
    console.error('[FleetIntake] Fetch error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load the request' });
  }
});

// POST /api/fleet-intake/:id/review — accept or reject
router.post('/:id/review', async (req, res) => {
  try {
    const { decision, review_note } = _clean(req.body);
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be accepted or rejected' });
    }
    const [row] = await query(
      'SELECT * FROM fleet_intake_requests WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Request not found' });
    if (row.status === 'converted') {
      return res.status(409).json({ success: false, message: 'This request is already a job card and cannot be reviewed again' });
    }
    if (decision === 'rejected' && !String(review_note || '').trim()) {
      // A rejection with no reason is useless to the coordinator who has to
      // act on it, and to whoever reads the queue next week.
      return res.status(400).json({ success: false, message: 'Give a reason when rejecting, so the fleet knows what to fix' });
    }

    await execute(
      `UPDATE fleet_intake_requests
          SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW()
        WHERE id = ?`,
      [decision, review_note ? String(review_note).slice(0, 2000) : null, req.user.id, row.id]
    );
    await logAudit({
      workshopId: req.workshopId, userId: req.user.id,
      action: `fleet_intake.${decision}`, entityType: 'fleet_intake_request', entityId: row.id,
      oldValue: { status: row.status },
      newValue: { status: decision, plate_number: row.plate_number, vin: row.vin },
    });

    // The reason goes back to the coordinator who sent it, quoting their
    // reference — a rejection nobody at the fleet hears about fixes nothing.
    let told = false;
    if (decision === 'rejected' && row.link_id) {
      const [link] = await query('SELECT contact_phone FROM fleet_intake_links WHERE id = ?', [row.link_id]);
      const phone = link?.contact_phone && /\d{7,}/.test(String(link.contact_phone).replace(/\D/g, '')) ? link.contact_phone : null;
      if (phone) {
        const ref = `FI-${String(row.id).padStart(6, '0')}`;
        sendCustomNotification({
          channels: ['sms'], phone, tenantId: req.workshopId,
          message: `Your request ${ref}${row.plate_number ? ` (${row.plate_number})` : ''} was not booked in: ${String(review_note).trim().slice(0, 300)}`,
        }).catch(e => console.error('[FleetIntake] rejection notice:', e.message));
        told = true;
      }
    }

    return res.json({ success: true, message: decision === 'accepted' ? 'Accepted' : `Rejected${told ? ' — the coordinator has been sent the reason' : ''}`, coordinator_notified: told });
  } catch (err) {
    console.error('[FleetIntake] Review error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record the decision' });
  }
});

/**
 * POST /api/fleet-intake/:id/convert — turn a submission into a job card.
 *
 * Body (all optional):
 *   vehicle_id        — confirm the match, or pick a different vehicle of
 *                       this fleet account
 *   create_vehicle    — true to add the submitted vehicle as a new record
 *   make, model, year — for a new vehicle when the request has none (the
 *                       coordinator left them blank); the request's own win
 *   update_vehicle    — true to write the submitted VIN/engine/unit code onto
 *                       the matched vehicle where ours is blank
 *   service_category, work_order_type, scheduled_at
 *
 * Runs as one transaction. Half a conversion — a vehicle created but no job
 * card, or a job card with the request still showing as waiting — is worse
 * than a clean failure, because the queue then lies to whoever looks at it
 * next.
 */
router.post('/:id/convert', requireCapability('job.open'), async (req, res) => {
  // First transaction in the codebase — everything else runs statement by
  // statement through query()/execute(). A conversion writes to four tables
  // and must not be able to land partly, so it takes a connection of its own.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Locked for the duration: two advisors working the queue at the same
    // moment would otherwise both pass the status check and create two job
    // cards for one broken taxi.
    const [[row]] = await conn.query(
      'SELECT * FROM fleet_intake_requests WHERE id = ? AND workshop_id = ? FOR UPDATE',
      [req.params.id, req.workshopId]
    );
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (row.status === 'converted') {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        code: 'ALREADY_CONVERTED',
        message: 'This request has already been turned into a job card.',
        data: { work_order_id: row.work_order_id },
      });
    }
    if (row.status === 'rejected') {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'This request was rejected. Accept it first if you want to book it in.' });
    }

    const {
      vehicle_id, create_vehicle, update_vehicle,
      service_category = 'general_maintenance',
      work_order_type = 'standard',
      scheduled_at,
    } = req.body || {};

    const [[customer]] = await conn.query(
      'SELECT id, full_name, phone, email, customer_class, customer_subcategory, is_active FROM customers WHERE id = ? AND workshop_id = ?',
      [row.customer_id, req.workshopId]
    );
    if (!customer) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'The fleet account on this request no longer exists' });
    }
    if (!customer.is_active) {
      await conn.rollback();
      return res.status(409).json({ success: false, code: 'CUSTOMER_INACTIVE',
        message: `${customer.full_name} is deactivated. Reactivate the account before booking its requests in.` });
    }

    /* ── Resolve the vehicle ──
     * A vehicle stored on the request that is not this account's (requests
     * sent before the VIN match was scoped to the account) is ignored, not
     * a dead end: the advisor matches or adds the car as for any other. */
    let storedVeh = row.vehicle_id || null;
    if (storedVeh && !vehicle_id) {
      const [[own]] = await conn.query('SELECT id FROM vehicles WHERE id = ? AND customer_id = ?', [storedVeh, row.customer_id]);
      if (!own) storedVeh = null;
    }
    let vehId = vehicle_id || storedVeh || null;

    if (vehId) {
      const [[veh]] = await conn.query(
        'SELECT id FROM vehicles WHERE id = ? AND workshop_id = ? AND customer_id = ?',
        [vehId, req.workshopId, row.customer_id]
      );
      if (!veh) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'That vehicle does not belong to this fleet account' });
      }
    } else if (create_vehicle) {
      // The request's make/model, else what the advisor enters at booking-in.
      const clip = (v, n) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
      row.make = row.make || clip(req.body?.make, 100);
      row.model = row.model || clip(req.body?.model, 100);
      if (!row.year && req.body?.year) {
        const y = parseInt(req.body.year, 10);
        if (y >= 1900 && y <= 2100) row.year = y;
      }
      if (!row.make || !row.model) {
        await conn.rollback();
        return res.status(400).json({ success: false, code: 'MAKE_MODEL_REQUIRED',
          message: 'Make and model are needed to add this vehicle. Enter them, or pick one of this fleet\'s vehicles instead.' });
      }
      // The VIN check is not repeated here: findVehicleMatch already looks up
      // by VIN first, so reaching this branch with a VIN we hold would mean
      // the match returned a vehicle and vehId would be set. Belt and braces
      // anyway, because an advisor can pass create_vehicle explicitly.
      if (row.vin) {
        const [[dup]] = await conn.query(
          "SELECT id FROM vehicles WHERE workshop_id = ? AND UPPER(REPLACE(vin, ' ', '')) = ? AND is_active = 1 LIMIT 1",
          [req.workshopId, String(row.vin).replace(/\s/g, '').toUpperCase()]
        );
        if (dup) {
          await conn.rollback();
          // The VIN is on another customer's car (an own-fleet car would have
          // matched). Not something to paper over with a second record: the
          // car changed hands (move it to this account on the Vehicles page),
          // or one of the two VINs is wrong.
          const [[owner]] = await conn.query(
            'SELECT v.plate_number, c.full_name FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id WHERE v.id = ?', [dup.id]);
          return res.status(409).json({
            success: false,
            code: 'VIN_DUPLICATE',
            message: `This VIN is already on file for ${owner?.plate_number || 'a vehicle'} (${owner?.full_name || 'another customer'}). ` +
              'If the car now belongs to this fleet, move it to this account from the Vehicles page; otherwise correct the VIN with the fleet.',
            data: { vehicle_id: dup.id },
          });
        }
      }
      const [ins] = await conn.query(
        `INSERT INTO vehicles (workshop_id, customer_id, make, model, year, plate_number,
           plate_code, plate_emirate, vin, engine_no, fleet_code, color, mileage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.workshopId, row.customer_id, row.make, row.model, row.year, row.plate_number,
         row.plate_code, row.plate_emirate, row.vin, row.engine_no, row.fleet_code,
         row.color, row.odometer]
      );
      vehId = ins.insertId;
    } else {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        code: 'VEHICLE_REQUIRED',
        message: 'Match this request to a vehicle, or tick "add as a new vehicle".',
      });
    }

    /* ── Optionally fill gaps on the matched vehicle ──
     * COALESCE only, never an overwrite. Where our record has a value and
     * theirs differs, the difference is surfaced as a discrepancy on the
     * detail screen and a human decides — a fleet's paperwork is not
     * automatically more correct than the number read off the car. */
    if (update_vehicle && vehId) {
      await conn.query(
        `UPDATE vehicles
            SET vin           = COALESCE(NULLIF(vin, ''), ?),
                engine_no     = COALESCE(NULLIF(engine_no, ''), ?),
                fleet_code    = COALESCE(NULLIF(fleet_code, ''), ?),
                plate_code    = COALESCE(NULLIF(plate_code, ''), ?),
                plate_emirate = COALESCE(NULLIF(plate_emirate, ''), ?)
          WHERE id = ? AND workshop_id = ?`,
        [row.vin, row.engine_no, row.fleet_code, row.plate_code, row.plate_emirate,
         vehId, req.workshopId]
      );
    }

    /* ── The mandatory three, checked against what will actually be stored ──
     * The submission passed validation when it came in, but an advisor can
     * have matched it to a vehicle that has no VIN of its own, and that job
     * card would then breach the rule the counter is held to. */
    const [[finalVeh]] = await conn.query(
      'SELECT id, vin, plate_number FROM vehicles WHERE id = ?', [vehId]
    );
    if (!finalVeh?.vin || !String(finalVeh.vin).trim()) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        code: 'VIN_REQUIRED',
        message: 'The matched vehicle has no VIN on file. Tick "copy missing details onto the vehicle", or add the VIN to the vehicle first.',
      });
    }
    if (row.odometer == null) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'This request has no mileage reading. Add one before booking it in.' });
    }

    /* ── The job card ── */
    const VALID_CATEGORIES = ['oil_change', 'brake_repair', 'diagnostic', 'bodywork', 'tire_service',
      'engine_repair', 'transmission', 'electrical', 'general_maintenance', 'other'];
    const VALID_TYPES = ['standard', 'express', 'same_day', 'scheduled', 'warranty'];
    const _cat = VALID_CATEGORIES.includes(service_category) ? service_category : 'general_maintenance';
    const _type = VALID_TYPES.includes(work_order_type) ? work_order_type : 'standard';

    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

    // Their own reference is kept in the description, not just in a column:
    // it is the first thing the fleet quotes when they call to chase, and an
    // advisor should see it without opening another panel.
    const descParts = [row.complaint];
    if (row.external_ref) descParts.push(`[Fleet ref: ${row.external_ref}]`);
    if (row.work_type) descParts.push(`[Work type: ${row.work_type}]`);

    const notesParts = [];
    if (row.driver_name) notesParts.push(`Driver: ${row.driver_name}${row.driver_phone ? ` (${row.driver_phone})` : ''}`);
    if (row.permit_id) notesParts.push(`Permit ID: ${row.permit_id}`);
    if (row.submitted_by) notesParts.push(`Submitted by: ${row.submitted_by}`);
    notesParts.push(`Fleet intake FI-${String(row.id).padStart(6, '0')}`);

    // Who hears about this job (the "order placed" message, the pickup call):
    // the coordinator the link was issued to, else the account's own number
    // when it has one (fleet accounts are often on file with '-'), else the
    // driver the coordinator named.
    const hasDigits = p => /\d{7,}/.test(String(p || '').replace(/\D/g, ''));
    const [[link]] = row.link_id
      ? await conn.query('SELECT contact_name, contact_phone FROM fleet_intake_links WHERE id = ?', [row.link_id]) : [[null]];
    const contactPhone = [link?.contact_phone, customer.phone, row.driver_phone].find(hasDigits) || customer.phone || null;
    if (link?.contact_name && hasDigits(link.contact_phone)) notesParts.push(`Coordinator: ${link.contact_name} (${link.contact_phone})`);

    // Numbers are a random draw per day; a collision draws again.
    let workOrderId = null; let work_order_number = null;
    for (let attempt = 0; attempt < 6 && !workOrderId; attempt++) {
      const number = `WO-${stamp}-${Math.floor(Math.random() * 9000) + 1000}`;
      try {
        const [woIns] = await conn.query(
          `INSERT INTO work_orders
             (workshop_id, work_order_number, customer_id, vehicle_id, odometer_in,
              intake_channel, fleet_intake_id, work_order_type, service_category,
              customer_name, customer_phone, customer_email, payer_type,
              description, scheduled_at, status, service_status_token, notes)
           VALUES (?, ?, ?, ?, ?, 'fleet_link', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [req.workshopId, number, row.customer_id, vehId, row.odometer,
           row.id, _type, _cat,
           customer.full_name, contactPhone, customer.email || null,
           // A fleet account is billed on account (Step 1 classification).
           payerTypeForClass(customer.customer_class, customer.customer_subcategory),
           descParts.join(' '),
           /^\d{4}-\d{2}-\d{2}/.test(scheduled_at || '') ? scheduled_at : (row.preferred_date || null),
           serviceStatusToken(),
           notesParts.join(' | ')]
        );
        workOrderId = woIns.insertId; work_order_number = number;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY' || !/work_order_number/.test(e.message)) throw e;
      }
    }
    if (!workOrderId) throw new Error('Could not allocate a work order number');
    await snapshotIntakeClass(workOrderId, { conn });

    await conn.query(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
      [workOrderId, 'pending', req.user.id, `Created from fleet intake FI-${String(row.id).padStart(6, '0')}`]
    );

    // Same monotonic guard as the counter path — a fleet submitting a reading
    // lower than the last one we took must not wind the vehicle backwards.
    await conn.query(
      'UPDATE vehicles SET mileage = ? WHERE id = ? AND (mileage IS NULL OR mileage < ?)',
      [row.odometer, vehId, row.odometer]
    );

    await conn.query(
      `UPDATE fleet_intake_requests
          SET status = 'converted', work_order_id = ?, vehicle_id = ?,
              reviewed_by = ?, reviewed_at = NOW()
        WHERE id = ?`,
      [workOrderId, vehId, req.user.id, row.id]
    );

    await conn.commit();

    // Audited and notified after the commit, so a failure in either cannot
    // roll back a job card that the workshop can already see.
    logAudit({
      workshopId: req.workshopId, userId: req.user.id,
      action: 'fleet_intake.convert', entityType: 'work_order', entityId: workOrderId,
      oldValue: { fleet_intake_id: row.id, status: row.status },
      newValue: { work_order_number, vehicle_id: vehId, odometer_in: row.odometer },
    }).catch(e => console.error('[FleetIntake] Audit error:', e.message));

    await ensureMainJobCard({ workOrderId, workshopId: req.workshopId, userId: req.user.id })
      .catch(e => console.error('[FleetIntake] main job card:', e.message));
    const [workOrder] = await query('SELECT * FROM work_orders WHERE id = ?', [workOrderId]);
    notifyWorkOrderStatus({
      order: workOrder, status: 'pending', workshopId: req.workshopId, changedBy: req.user.id,
    }).catch(e => console.error('[FleetIntake] Notify error:', e.message));

    return res.status(201).json({
      success: true,
      data: { work_order_id: workOrderId, work_order_number, vehicle_id: vehId },
      message: `Job card ${work_order_number} created`,
    });
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection already gone */ }
    console.error('[FleetIntake] Convert error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create the job card' });
  } finally {
    conn.release();
  }
});

export { router as default, publicRouter as publicFleetIntakeRouter, normaliseSubmission, findVehicleMatch };
