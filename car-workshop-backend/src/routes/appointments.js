/**
 * ═══════════════════════════════════════════════════════════════
 *  Appointments (bookings) — SOW Section B1
 *  Covers: req 60 (service reception queue + advisor assignment),
 *          req 61 (capacity-aware booking, no overbooking),
 *          req 63 (appointment-to-bay scheduling, capacity planning)
 *
 *  The BOOK stage of the customer cycle:
 *    lead (enquiry) → quote (estimate) → BOOK (appointment) →
 *    visit (job card) → after the visit → service due.
 *  A booking can be made from an enquiry or a quote (enquiry_id /
 *  estimate_id), and POST /:id/check-in turns it into the visit: the
 *  work order and its main job card, exactly like any other intake.
 *
 *  Reads are open to staff; making, changing and checking in bookings
 *  is front-desk work (capability 'job.open': Service Advisor,
 *  Supervisor, managers).
 * ═══════════════════════════════════════════════════════════════
 */
import express from 'express';
import pool, { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { requireCapability } from '../lib/roles.js';
import { ensureMainJobCard } from '../lib/workflow.js';
import { serviceStatusToken } from '../lib/tokens.js';
import {
  customerForEnquiry, vehicleForEnquiry, customerForContact, notePlateConflict,
  intakeChannelFor, payerTypeForClass, snapshotIntakeClass,
} from '../lib/crm-cycle.js';

const router = express.Router();
router.use(authMiddleware);

const canBook = requireCapability('job.open');

const SOURCES = ['call_centre', 'self_service', 'walk_in', 'app'];
const STATUSES = ['pending', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'];
const CLOSED_WO = ['completed', 'cancelled'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const normTime = t => (String(t).length === 5 ? `${t}:00` : String(t));

// work_orders.service_category is an ENUM; appointments.service_category is
// free text (older bookings say things like "Tyre replacement").
const WO_CATEGORIES = ['oil_change', 'brake_repair', 'diagnostic', 'bodywork', 'tire_service', 'engine_repair',
  'transmission', 'electrical', 'general_maintenance', 'other'];
const CATEGORY_LABEL = {
  oil_change: 'Oil change', brake_repair: 'Brake repair', diagnostic: 'Diagnostic', bodywork: 'Bodywork',
  tire_service: 'Tyre service', engine_repair: 'Engine repair', transmission: 'Transmission',
  electrical: 'Electrical', general_maintenance: 'General maintenance', other: 'Other',
};
function woCategory(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'general_maintenance';
  if (WO_CATEGORIES.includes(s)) return s;
  const rules = [
    [/oil|lube/, 'oil_change'], [/brake/, 'brake_repair'], [/diagnos|scan|check.?engine/, 'diagnostic'],
    [/body|paint|dent|scratch/, 'bodywork'], [/tyre|tire|wheel|alignment|balanc/, 'tire_service'],
    [/engine/, 'engine_repair'], [/transmission|gearbox|clutch/, 'transmission'],
    [/electr|battery|wiring|a\/?c\b|air.?con/, 'electrical'], [/service|maintenance/, 'general_maintenance'],
  ];
  for (const [re, cat] of rules) if (re.test(s)) return cat;
  return 'other';
}

// One SELECT for the list and the detail, so the page gets the same shape
// from both: the booking plus the enquiry / quote / job card it is tied to.
const SELECT_APPT = `
  SELECT a.*,
         c.full_name AS customer_full_name, c.phone AS customer_phone_db,
         v.plate_number, v.plate_number AS vehicle_plate_db, v.make, v.model, v.year AS vehicle_year,
         v.mileage AS vehicle_mileage,
         sb.name AS bay_name,
         u.full_name AS advisor_full_name,
         wo.work_order_number, wo.status AS work_order_status,
         se.estimate_number, se.status AS estimate_status,
         enq.enquiry_number, enq.status AS enquiry_status
    FROM appointments a
    LEFT JOIN customers c  ON a.customer_id   = c.id
    LEFT JOIN vehicles  v  ON a.vehicle_id     = v.id
    LEFT JOIN service_bays sb ON a.service_bay_id = sb.id
    LEFT JOIN users     u  ON a.booked_by_user_id = u.id
    LEFT JOIN work_orders wo ON wo.id = a.work_order_id AND wo.workshop_id = a.workshop_id
    LEFT JOIN service_estimates se ON se.id = a.estimate_id AND se.workshop_id = a.workshop_id
    LEFT JOIN enquiries enq ON enq.id = a.enquiry_id AND enq.workshop_id = a.workshop_id`;

async function loadAppointment(id, workshopId) {
  const [row] = await query(`${SELECT_APPT} WHERE a.id = ? AND a.workshop_id = ?`, [id, workshopId]);
  return row || null;
}

/**
 * Would this booking overbook? (req 61) With a bay: that bay's capacity.
 * Without one: the workshop's total active bay capacity, so unassigned
 * bookings cannot pile up past what the floor can take.
 * Returns null when it fits, else { status, message }.
 */
async function capacityProblem({ workshopId, bayId, date, time, duration, excludeId = null }) {
  const overlap = `appointment_time < ADDTIME(?, SEC_TO_TIME(? * 60))
                   AND ADDTIME(appointment_time, SEC_TO_TIME(slot_duration_min * 60)) > ?`;
  const exclude = excludeId ? ' AND id <> ?' : '';
  const tail = excludeId ? [excludeId] : [];

  if (bayId) {
    const [bay] = await query('SELECT id, capacity FROM service_bays WHERE id = ? AND workshop_id = ?', [bayId, workshopId]);
    if (!bay) return { status: 400, message: 'Service bay not found' };
    const bayCapacity = bay.capacity || 1;
    const [{ booked }] = await query(
      `SELECT COUNT(*) AS booked FROM appointments
        WHERE workshop_id = ? AND service_bay_id = ? AND appointment_date = ?
          AND status NOT IN ('cancelled','no_show') AND ${overlap}${exclude}`,
      [workshopId, bayId, date, time, duration, time, ...tail]
    );
    if (Number(booked) >= bayCapacity) {
      return { status: 409, message: `Bay is fully booked for this slot (capacity: ${bayCapacity}). Please choose a different time.` };
    }
    return null;
  }

  const [{ total }] = await query(
    'SELECT COALESCE(SUM(COALESCE(NULLIF(capacity, 0), 1)), 0) AS total FROM service_bays WHERE workshop_id = ? AND is_active = 1',
    [workshopId]
  );
  if (!Number(total)) return null; // no bays set up: nothing to measure against
  const [{ booked }] = await query(
    `SELECT COUNT(*) AS booked FROM appointments
      WHERE workshop_id = ? AND appointment_date = ?
        AND status NOT IN ('cancelled','no_show') AND ${overlap}${exclude}`,
    [workshopId, date, time, duration, time, ...tail]
  );
  if (Number(booked) >= Number(total)) {
    return { status: 409, message: `The workshop is fully booked for this slot (${total} bays). Please choose a different time.` };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// GET /api/appointments/available-slots
// Returns capacity-aware available slots for a given date range
// Params: date (YYYY-MM-DD), service_bay_id?, duration_min?
// (req 61 — prevents overbooking beyond defined capacity)
// ══════════════════════════════════════════════════════════════
router.get('/available-slots', async (req, res) => {
  try {
    const { date, service_bay_id, duration_min = 60 } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'date required (YYYY-MM-DD)' });

    // Get workshop settings for operating hours
    const [settings] = await query(
      `SELECT settings FROM workshops WHERE id = ?`,
      [req.workshopId]
    );
    const ws = settings?.settings ? (typeof settings.settings === 'string' ? JSON.parse(settings.settings) : settings.settings) : {};
    const openHour  = ws.open_hour  || 8;
    const closeHour = ws.close_hour || 18;
    const slotDurationMin = Math.min(Math.max(parseInt(duration_min, 10) || 60, 15), 600);

    // Get bays to check against
    let bayQuery = 'SELECT id, name, capacity FROM service_bays WHERE workshop_id = ? AND is_active = 1';
    const bayParams = [req.workshopId];
    if (service_bay_id) { bayQuery += ' AND id = ?'; bayParams.push(service_bay_id); }
    const bays = await query(bayQuery, bayParams);

    if (!bays.length) {
      return res.json({ success: true, slots: [], message: 'No active service bays found' });
    }

    // Get existing bookings for the date
    const bookedSlots = await query(
      `SELECT appointment_time, slot_duration_min, service_bay_id, status
       FROM appointments
       WHERE workshop_id = ? AND appointment_date = ? AND status NOT IN ('cancelled','no_show')`,
      [req.workshopId, date]
    );

    // Generate time slots
    const slots = [];
    for (let hour = openHour; hour < closeHour; hour++) {
      for (let min = 0; min < 60; min += slotDurationMin) {
        if (hour * 60 + min + slotDurationMin > closeHour * 60) break;
        const timeStr = `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`;

        // Count how many bookings overlap with this slot
        const overlapping = bookedSlots.filter(b => {
          const bStart = b.appointment_time;
          const bEnd = addMinutes(bStart, b.slot_duration_min);
          const sEnd = addMinutes(timeStr, slotDurationMin);
          return bStart < sEnd && bEnd > timeStr;
        });
        // Asked about one bay: only that bay's bookings count against it.
        const relevant = service_bay_id
          ? overlapping.filter(b => String(b.service_bay_id) === String(service_bay_id))
          : overlapping;

        // Total capacity across all relevant bays
        const totalCapacity = bays.reduce((sum, bay) => sum + (bay.capacity || 1), 0);
        const baySlots = [];

        for (const bay of bays) {
          const bayBooked = overlapping.filter(b => b.service_bay_id === bay.id).length;
          const bayCapacity = bay.capacity || 1;
          baySlots.push({
            bay_id:    bay.id,
            bay_name:  bay.name,
            capacity:  bayCapacity,
            booked:    bayBooked,
            available: Math.max(0, bayCapacity - bayBooked),
          });
        }

        // Bookings with no bay still take a place on the floor, so the
        // slot is limited by both the free bays and the total head-count.
        const totalAvailable = Math.max(0, Math.min(
          baySlots.reduce((sum, b) => sum + b.available, 0),
          totalCapacity - relevant.length
        ));
        slots.push({
          time:           timeStr,
          duration_min:   slotDurationMin,
          total_capacity: totalCapacity,
          total_booked:   relevant.length,
          total_available: totalAvailable,
          is_available:   totalAvailable > 0,
          bays:           baySlots,
        });
      }
    }

    res.json({ success: true, date, slots });
  } catch (err) {
    console.error('GET /appointments/available-slots error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch available slots' });
  }
});

function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}:00`;
}

// ══════════════════════════════════════════════════════════════
// GET /api/appointments/stats — the booking funnel
// KPI matrix rows 1-3: bookings received, confirmed, show-up rate.
// Registered ahead of GET /:id, which would otherwise swallow "stats" as an id.
// ══════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = ['a.workshop_id = ?'];
    const params = [req.workshopId];
    if (from) { where.push('a.appointment_date >= ?'); params.push(from); }
    if (to)   { where.push('a.appointment_date <= ?'); params.push(to); }
    const clause = where.join(' AND ');

    // "Confirmed" means the booking moved past pending, whichever way it then
    // resolved — a no-show was still a confirmed booking that did not arrive.
    // Show-up rate is arrived/completed against that confirmed base, not
    // against everything received, so a lot of stale pending requests cannot
    // make the show-up rate look artificially bad.
    const [totals] = await query(
      `SELECT
         COUNT(*) AS received,
         SUM(a.status <> 'pending' AND a.status <> 'cancelled') AS confirmed,
         SUM(a.status IN ('arrived','in_progress','completed')) AS arrived_or_completed,
         SUM(a.status = 'no_show')  AS no_show,
         SUM(a.status = 'cancelled') AS cancelled
       FROM appointments a WHERE ${clause}`,
      params
    );
    const received = Number(totals.received) || 0;
    const confirmed = Number(totals.confirmed) || 0;
    const arrived = Number(totals.arrived_or_completed) || 0;

    const byChannel = await query(
      `SELECT a.source AS channel, COUNT(*) AS received,
              SUM(a.status <> 'pending' AND a.status <> 'cancelled') AS confirmed,
              SUM(a.status IN ('arrived','in_progress','completed')) AS arrived_or_completed
         FROM appointments a WHERE ${clause}
        GROUP BY a.source ORDER BY received DESC`,
      params
    );

    // Fleet bookings tracked separately per the KPI note - a no-show driver
    // is a different problem from a retail customer no-show. LEFT JOIN so a
    // walk-in with no linked customer record still shows up, under Unlinked.
    const byCustomerType = await query(
      `SELECT COALESCE(c.type, 'unlinked') AS customer_type, COUNT(*) AS received,
              SUM(a.status <> 'pending' AND a.status <> 'cancelled') AS confirmed,
              SUM(a.status IN ('arrived','in_progress','completed')) AS arrived_or_completed
         FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id
        WHERE ${clause}
        GROUP BY customer_type ORDER BY received DESC`,
      params
    );

    const pct = (num, den) => (den ? Math.round((num / den) * 100) : null);

    return res.json({
      success: true,
      data: {
        from: from || null, to: to || null,
        totals: {
          received, confirmed, arrived_or_completed: arrived,
          no_show: Number(totals.no_show) || 0,
          cancelled: Number(totals.cancelled) || 0,
          conversion_rate_pct: pct(confirmed, received),
          show_up_rate_pct: pct(arrived, confirmed),
        },
        by_channel: byChannel.map(r => ({
          channel: r.channel,
          received: Number(r.received),
          confirmed: Number(r.confirmed),
          arrived_or_completed: Number(r.arrived_or_completed),
          conversion_rate_pct: pct(Number(r.confirmed), Number(r.received)),
          show_up_rate_pct: pct(Number(r.arrived_or_completed), Number(r.confirmed)),
        })),
        by_customer_type: byCustomerType.map(r => ({
          customer_type: r.customer_type,
          received: Number(r.received),
          confirmed: Number(r.confirmed),
          arrived_or_completed: Number(r.arrived_or_completed),
          conversion_rate_pct: pct(Number(r.confirmed), Number(r.received)),
          show_up_rate_pct: pct(Number(r.arrived_or_completed), Number(r.confirmed)),
        })),
      },
    });
  } catch (err) {
    console.error('[Appointments] stats error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch appointment stats' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/appointments — list appointments
// Supports: date, from, to, status, advisor_id, customer_id, enquiry_id,
//           estimate_id, search
// Each row carries enquiry_number / estimate_number / work_order_number
// and the vehicle's plate, make and model.
// ══════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const { date, from, to, status, advisor_id, customer_id, enquiry_id, estimate_id, search, page = 1, limit = 50 } = req.query;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pg - 1) * lim;

    let sql = `${SELECT_APPT} WHERE a.workshop_id = ?`;
    const params = [req.workshopId];

    if (date)     { sql += ' AND a.appointment_date = ?'; params.push(date); }
    if (from)     { sql += ' AND a.appointment_date >= ?'; params.push(from); }
    if (to)       { sql += ' AND a.appointment_date <= ?'; params.push(to); }
    if (status)   { sql += ' AND a.status = ?'; params.push(status); }
    if (advisor_id) { sql += ' AND a.booked_by_user_id = ?'; params.push(advisor_id); }
    if (customer_id) { sql += ' AND a.customer_id = ?'; params.push(customer_id); }
    if (enquiry_id)  { sql += ' AND a.enquiry_id = ?'; params.push(enquiry_id); }
    if (estimate_id) { sql += ' AND a.estimate_id = ?'; params.push(estimate_id); }
    if (search) {
      sql += ' AND (a.customer_name LIKE ? OR a.customer_phone LIKE ? OR c.full_name LIKE ? OR v.plate_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY a.appointment_date ASC, a.appointment_time ASC, a.id ASC LIMIT ? OFFSET ?';
    params.push(lim, offset);

    const rows = await query(sql, params);
    res.json({ success: true, appointments: rows, page: pg, limit: lim });
  } catch (err) {
    console.error('GET /appointments error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch appointments' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/appointments/:id
// ══════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const appt = await loadAppointment(req.params.id, req.workshopId);
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });
    res.json({ success: true, appointment: appt });
  } catch (err) {
    console.error('GET /appointments/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch appointment' });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/appointments — book an appointment (req 61)
// Body: { customer_id?, customer_name?, customer_phone?, vehicle_id?,
//         enquiry_id?, estimate_id?,
//         service_bay_id?, appointment_date, appointment_time,
//         slot_duration_min, service_category, notes, source,
//         booked_by_user_id? }
// From a quote: customer/vehicle (and the enquiry behind it) are taken
// from the estimate, and if the quote already became a job card the
// booking is tied to it. From an enquiry: customer/vehicle/name/phone.
// Response: { success, appointmentId, appointment }
// ══════════════════════════════════════════════════════════════
router.post('/', canBook, async (req, res) => {
  try {
    const body = req.body || {};
    let { customer_id, vehicle_id, customer_name, customer_phone, enquiry_id, estimate_id } = body;
    const {
      service_bay_id, appointment_date, appointment_time,
      slot_duration_min = 60, service_category, notes,
      source = 'call_centre', booked_by_user_id,
    } = body;

    if (!appointment_date || !appointment_time) {
      return res.status(400).json({ success: false, message: 'appointment_date and appointment_time required' });
    }
    if (!DATE_RE.test(String(appointment_date)) || !TIME_RE.test(String(appointment_time))) {
      return res.status(400).json({ success: false, message: 'Use a date as YYYY-MM-DD and a time as HH:MM' });
    }
    const duration = parseInt(slot_duration_min, 10);
    if (!duration || duration < 15 || duration > 600) {
      return res.status(400).json({ success: false, message: 'slot_duration_min must be between 15 and 600' });
    }
    const time = normTime(appointment_time);
    customer_name = customer_name ? String(customer_name).trim() : '';
    customer_phone = customer_phone ? String(customer_phone).trim() : '';
    let work_order_id = null;

    const openWorkOrder = async id => {
      if (!id) return null;
      const [wo] = await query('SELECT id, status FROM work_orders WHERE id = ? AND workshop_id = ?', [id, req.workshopId]);
      return wo && !CLOSED_WO.includes(wo.status) ? wo.id : null;
    };

    // ── From a quote ──
    if (estimate_id) {
      const [est] = await query('SELECT * FROM service_estimates WHERE id = ? AND workshop_id = ?', [estimate_id, req.workshopId]);
      if (!est) return res.status(404).json({ success: false, message: 'Quote not found' });
      customer_id = customer_id || est.customer_id || null;
      vehicle_id = vehicle_id || est.vehicle_id || null;
      customer_name = customer_name || est.customer_name || '';
      work_order_id = await openWorkOrder(est.work_order_id);
      // The enquiry the quote was raised from, so check-in can close it.
      if (!enquiry_id && est.enquiry_id) {
        const [enq] = await query('SELECT id FROM enquiries WHERE id = ? AND workshop_id = ?', [est.enquiry_id, req.workshopId]);
        if (enq) enquiry_id = enq.id;
      }
    }

    // ── From an enquiry ──
    if (enquiry_id) {
      const [enq] = await query('SELECT * FROM enquiries WHERE id = ? AND workshop_id = ?', [enquiry_id, req.workshopId]);
      if (!enq) return res.status(404).json({ success: false, message: 'Enquiry not found' });
      // The booking needs a real customer and car (the reminder and the
      // after-visit follow-up hang off them): the ones on file with the same
      // phone / plate, else new records from the enquiry — as Quote does.
      customer_id = customer_id || await customerForEnquiry(enq);
      if (!vehicle_id) {
        const info = {};
        vehicle_id = await vehicleForEnquiry(enq, customer_id, { info });
        if (info.conflict) await notePlateConflict({ enq: { ...enq, customer_id }, conflict: info.conflict, userId: req.user?.id });
      }
      customer_name = customer_name || enq.contact_name || '';
      customer_phone = customer_phone || enq.contact_phone || '';
      if (!work_order_id) work_order_id = await openWorkOrder(enq.converted_work_order_id);
    }

    if (customer_id) {
      const [cust] = await query('SELECT id, full_name, phone FROM customers WHERE id = ? AND workshop_id = ?', [customer_id, req.workshopId]);
      if (!cust) return res.status(400).json({ success: false, message: 'Customer not found' });
      customer_name = customer_name || cust.full_name || '';
      customer_phone = customer_phone || (cust.phone && cust.phone !== '-' ? cust.phone : '');
    }
    if (vehicle_id) {
      const [veh] = await query('SELECT id FROM vehicles WHERE id = ? AND workshop_id = ?', [vehicle_id, req.workshopId]);
      if (!veh) return res.status(400).json({ success: false, message: 'Vehicle not found' });
    }
    if (!customer_id && (!customer_name || !customer_phone)) {
      return res.status(400).json({ success: false, message: 'Choose a customer, or give a name and phone number' });
    }

    let bookedBy = req.user?.id || null;
    if (booked_by_user_id && Number(booked_by_user_id) !== Number(bookedBy)) {
      const [adv] = await query('SELECT id FROM users WHERE id = ? AND workshop_id = ?', [booked_by_user_id, req.workshopId]);
      if (!adv) return res.status(400).json({ success: false, message: 'Advisor not found' });
      bookedBy = adv.id;
    }

    // One live booking per quote / enquiry — move the existing one instead.
    if (estimate_id || enquiry_id) {
      const cond = []; const p = [req.workshopId];
      if (estimate_id) { cond.push('estimate_id = ?'); p.push(estimate_id); }
      if (enquiry_id) { cond.push('enquiry_id = ?'); p.push(enquiry_id); }
      const [dup] = await query(
        `SELECT id, appointment_date, appointment_time FROM appointments
          WHERE workshop_id = ? AND status IN ('pending','confirmed') AND (${cond.join(' OR ')}) LIMIT 1`, p);
      if (dup) {
        return res.status(409).json({
          success: false, code: 'ALREADY_BOOKED', appointment_id: dup.id,
          message: `Already booked for ${dup.appointment_date} at ${String(dup.appointment_time).slice(0, 5)} — reschedule or cancel that booking first.`,
        });
      }
    }

    // Capacity check — prevent overbooking (req 61)
    const problem = await capacityProblem({
      workshopId: req.workshopId, bayId: service_bay_id || null, date: appointment_date, time, duration,
    });
    if (problem) return res.status(problem.status).json({ success: false, message: problem.message });

    const result = await execute(
      `INSERT INTO appointments
         (workshop_id, customer_id, vehicle_id, customer_name, customer_phone,
          service_bay_id, appointment_date, appointment_time, slot_duration_min,
          service_category, notes, source, booked_by_user_id, status,
          enquiry_id, estimate_id, work_order_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
      [req.workshopId, customer_id || null, vehicle_id || null,
       customer_name || null, customer_phone || null, service_bay_id || null,
       appointment_date, time, duration,
       service_category ? String(service_category).slice(0, 100) : null, notes || null,
       SOURCES.includes(source) ? source : 'call_centre',
       bookedBy, enquiry_id || null, estimate_id || null, work_order_id]
    );

    await logAudit(req.workshopId, req.user?.id, 'CREATE', 'appointments', result.insertId, null,
      { appointment_date, appointment_time: time, service_bay_id, enquiry_id: enquiry_id || null, estimate_id: estimate_id || null });

    const appointment = await loadAppointment(result.insertId, req.workshopId);
    res.status(201).json({ success: true, appointmentId: result.insertId, appointment, message: 'Booking saved' });
  } catch (err) {
    console.error('POST /appointments error:', err);
    res.status(500).json({ success: false, message: 'Failed to create appointment' });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/appointments/:id/check-in — the car has arrived
// Body: { odometer_in, complaint? }
// Turns the booking into the visit: the work order (job card) and its
// main job card, opened the same way as every other intake. A booking
// already tied to an open job card (an approved quote) arrives on that
// one. Safe to repeat: a second check-in returns the same work order.
//
// The odometer reading is optional (recorded when given). The job
// card carries the reported issue — the booking's notes ("what the customer
// reported"), else the enquiry's description, else the booked service —
// and the channel the request came through (the enquiry's WhatsApp /
// website / social media, an online booking as the website).
// Response: { success, work_order_id, work_order_number, created, message }
// ══════════════════════════════════════════════════════════════
router.post('/:id/check-in', canBook, async (req, res) => {
  const raw = req.body?.odometer_in;
  const blank = raw === undefined || raw === null || String(raw).trim() === '';
  // Digits only (Arabic-Indic digits accepted); '12.5', '1e5' or '-500' are
  // refused rather than silently rewritten into a different reading.
  const typed = blank ? '' : String(raw).trim()
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[,\s]/g, '');
  // work_orders.odometer_in and vehicles.mileage are INT
  if (!blank && !/^\d{1,7}$/.test(typed)) {
    return res.status(400).json({ success: false, message: 'Mileage looks wrong — enter the reading in km, digits only.' });
  }
  const odometer = blank ? null : Number(typed);
  const typedComplaint = req.body?.complaint ? String(req.body.complaint).trim().slice(0, 5000) : '';

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Locked so two people checking the same car in cannot open two job cards.
    const [[appt]] = await conn.query(
      'SELECT * FROM appointments WHERE id = ? AND workshop_id = ? FOR UPDATE',
      [req.params.id, req.workshopId]
    );
    if (!appt) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    if (['cancelled', 'completed'].includes(appt.status)) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: `This booking is ${appt.status} and cannot be checked in.` });
    }

    const lockWo = async id => {
      if (!id) return null;
      const [[wo]] = await conn.query(
        'SELECT id, work_order_number, status, vehicle_id, enquiry_id FROM work_orders WHERE id = ? AND workshop_id = ? FOR UPDATE',
        [id, req.workshopId]
      );
      return wo || null;
    };

    let wo = null;
    if (appt.work_order_id) {
      wo = await lockWo(appt.work_order_id);
      // Already checked in: hand back the same visit, whatever became of it.
      // Otherwise a job card that closed before the car came in is not this visit.
      if (wo && CLOSED_WO.includes(wo.status) && !['arrived', 'in_progress'].includes(appt.status)) wo = null;
    }

    let est = null;
    if (appt.estimate_id) {
      [[est]] = await conn.query(
        'SELECT id, estimate_number, status, work_order_id, intake_work_order_id FROM service_estimates WHERE id = ? AND workshop_id = ? FOR UPDATE',
        [appt.estimate_id, req.workshopId]
      );
      // The quote may have been approved (and become a job card) after it was booked.
      if (!wo && est?.work_order_id) {
        const w = await lockWo(est.work_order_id);
        if (w && !CLOSED_WO.includes(w.status)) wo = w;
      }
    }

    let enq = null;
    if (appt.enquiry_id) {
      [[enq]] = await conn.query(
        'SELECT * FROM enquiries WHERE id = ? AND workshop_id = ? FOR UPDATE',
        [appt.enquiry_id, req.workshopId]
      );
      if (!wo && enq?.converted_work_order_id) {
        const w = await lockWo(enq.converted_work_order_id);
        if (w && !CLOSED_WO.includes(w.status)) wo = w;
      }
    }

    let workOrderId, workOrderNumber, created = false;
    let vehicleId = wo?.vehicle_id || appt.vehicle_id || null;
    let plateConflict = null;

    if (wo) {
      // (a) The visit already exists — record the reading on it.
      workOrderId = wo.id;
      workOrderNumber = wo.work_order_number;
      if (!CLOSED_WO.includes(wo.status) && odometer != null) {
        await conn.query('UPDATE work_orders SET odometer_in = ? WHERE id = ? AND workshop_id = ?', [odometer, wo.id, req.workshopId]);
      }
    } else {
      // (b) Open the work order, as routes/enquiries.js convert does.
      // Step 1 needs a customer record: the booking's, else the enquiry's
      // (found or created as Convert does), else one found or created from
      // the name and phone the booking was made with.
      let customerId = appt.customer_id || null;
      if (!customerId && enq) customerId = await customerForEnquiry(enq, { conn });
      if (!customerId && appt.customer_name && appt.customer_phone) {
        customerId = await customerForContact({ workshopId: req.workshopId, name: appt.customer_name, phone: appt.customer_phone,
          note: `From booking #${appt.id}` }, { conn });
      }
      if (!customerId) {
        await conn.rollback();
        return res.status(400).json({ success: false, code: 'CUSTOMER_REQUIRED', message: 'This booking has no customer. Add the customer to the booking before checking the car in.' });
      }
      const [[cust]] = await conn.query(
        'SELECT full_name, phone, email, customer_class, customer_subcategory, is_active FROM customers WHERE id = ? AND workshop_id = ?',
        [customerId, req.workshopId]);
      if (!cust) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Customer not found' });
      }
      if (!cust.is_active) {
        await conn.rollback();
        return res.status(400).json({ success: false, code: 'CUSTOMER_INACTIVE', message: `${cust.full_name} is deactivated. Reactivate the customer before checking the car in.` });
      }
      if (customerId !== appt.customer_id) {
        await conn.query('UPDATE appointments SET customer_id = ? WHERE id = ?', [customerId, appt.id]);
      }
      // The car must be this customer's; a booking from an enquiry finds it
      // (or adds it) the way Convert does.
      if (vehicleId) {
        const [[own]] = await conn.query('SELECT id FROM vehicles WHERE id = ? AND workshop_id = ? AND customer_id = ?', [vehicleId, req.workshopId, customerId]);
        if (!own) vehicleId = null;
      }
      if (!vehicleId && enq) {
        const info = {};
        vehicleId = await vehicleForEnquiry({ ...enq, customer_id: customerId }, customerId, { conn, info });
        plateConflict = info.conflict || null;
      }
      if (vehicleId && vehicleId !== appt.vehicle_id) {
        await conn.query('UPDATE appointments SET vehicle_id = ? WHERE id = ?', [vehicleId, appt.id]);
      }

      const name = cust.full_name || appt.customer_name || null;
      const realPhone = p => (/\d{5,}/.test(String(p || '').replace(/\D/g, '')) ? p : null);
      const phone = realPhone(cust.phone) || appt.customer_phone || enq?.contact_phone || null;
      const category = woCategory(appt.service_category);
      const what = appt.service_category
        ? (CATEGORY_LABEL[String(appt.service_category).toLowerCase()] || appt.service_category)
        : null;
      // Step 2, the reported issue. Not padded with the booked category, and
      // never a 'Booked visit' placeholder standing in for what is wrong.
      const description = typedComplaint || String(appt.notes || '').trim() || String(enq?.description || '').trim() || what || '';
      if (!description) {
        await conn.rollback();
        return res.status(400).json({ success: false, code: 'COMPLAINT_REQUIRED', message: 'Record what the customer reported (the complaint) before opening the job card.' });
      }
      // Step 2, "Received via": the enquiry's channel; an online booking came
      // through the website; a phone or walk-in booking was keyed by the advisor.
      const channel = enq ? intakeChannelFor(enq.contact_method)
        : (['app', 'self_service'].includes(appt.source) ? 'website' : 'advisor');
      const payer = enq?.payer_type && enq.payer_type !== 'self_pay'
        ? enq.payer_type : payerTypeForClass(cust.customer_class, cust.customer_subcategory);
      const hhmm = String(appt.appointment_time).slice(0, 5);

      for (let attempt = 0; attempt < 6 && !workOrderId; attempt++) {
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const number = `WO-${stamp}-${Math.floor(Math.random() * 9000) + 1000}`;
        try {
          const [ins] = await conn.query(
            `INSERT INTO work_orders
               (workshop_id, work_order_number, customer_id, vehicle_id, service_bay_id,
                customer_name, customer_phone, customer_email, description, service_category,
                service_tier, payer_type, enquiry_id, scheduled_at, odometer_in, intake_channel,
                status, service_status_token, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`,
            [req.workshopId, number, customerId, vehicleId || null, appt.service_bay_id || null,
             name, phone, cust.email || enq?.contact_email || null, description.slice(0, 5000), category,
             enq?.service_tier || null, payer, enq?.id || null,
             `${appt.appointment_date} ${normTime(appt.appointment_time)}`, odometer, channel, serviceStatusToken(),
             `Booked visit #${appt.id} (${appt.appointment_date} ${hhmm})` +
               (plateConflict ? ` | Plate ${plateConflict.plate} is on file for ${plateConflict.owner_name || 'another customer'} — not attached; confirm the owner.` : '')]
          );
          workOrderId = ins.insertId;
          workOrderNumber = number;
        } catch (e) {
          if (e.code !== 'ER_DUP_ENTRY' || !/work_order_number/.test(e.message)) throw e; // a number collision: draw another
        }
      }
      if (!workOrderId) throw new Error('Could not allocate a work order number');
      created = true;
      appt.customer_id = customerId;

      await conn.query(
        'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
        [workOrderId, 'pending', req.user?.id || null, `Checked in from booking #${appt.id}`]
      );
      await snapshotIntakeClass(workOrderId, { conn });

      // A quote not yet approved: this visit becomes its intake, so approving
      // it later puts the work on this job card instead of opening a second.
      if (est && !est.work_order_id && !est.intake_work_order_id && !['rejected', 'expired', 'converted'].includes(est.status)) {
        await conn.query(
          'UPDATE service_estimates SET intake_work_order_id = ? WHERE id = ? AND intake_work_order_id IS NULL AND work_order_id IS NULL',
          [workOrderId, est.id]
        );
      }
    }

    // Same monotonic guard as the counter: never wind a vehicle's mileage back.
    if (vehicleId && odometer != null) {
      await conn.query(
        'UPDATE vehicles SET mileage = ? WHERE id = ? AND workshop_id = ? AND (mileage IS NULL OR mileage < ?)',
        [odometer, vehicleId, req.workshopId, odometer]
      );
    }

    // The lead is won: the enquiry converts to this visit (once).
    if (enq) {
      await conn.query(
        `UPDATE enquiries
            SET status = 'converted', converted_work_order_id = ?, converted_at = NOW(),
                customer_id = COALESCE(customer_id, ?)
          WHERE id = ? AND workshop_id = ? AND converted_work_order_id IS NULL`,
        [workOrderId, appt.customer_id || null, enq.id, req.workshopId]
      );
      await conn.query('UPDATE work_orders SET enquiry_id = ? WHERE id = ? AND enquiry_id IS NULL', [enq.id, workOrderId]);
    }

    await conn.query(
      `UPDATE appointments
          SET work_order_id = ?,
              status = CASE WHEN status IN ('in_progress','completed') THEN status ELSE 'arrived' END
        WHERE id = ? AND workshop_id = ?`,
      [workOrderId, appt.id, req.workshopId]
    );

    await conn.commit();

    // After the commit (as fleet-intake and estimates do): the main job card
    // reads the work order through the pool, and a failure here must not
    // undo a visit the workshop can already see.
    let jobCard = null;
    try {
      jobCard = await ensureMainJobCard({ workOrderId, workshopId: req.workshopId, userId: req.user?.id || null });
    } catch (e) {
      console.error('[Appointments] main job card:', e.message);
    }
    if (plateConflict && enq) {
      await notePlateConflict({ enq: { ...enq, customer_id: appt.customer_id }, conflict: plateConflict, userId: req.user?.id });
    }
    logAudit(req.workshopId, req.user?.id, 'CHECK_IN', 'appointments', appt.id,
      { status: appt.status, work_order_id: appt.work_order_id || null },
      { status: 'arrived', work_order_id: workOrderId, created, odometer_in: odometer })
      .catch(() => {});

    return res.status(created ? 201 : 200).json({
      success: true,
      work_order_id: workOrderId,
      work_order_number: workOrderNumber,
      job_card_number: jobCard?.job_card_number || null,
      created,
      message: created ? `Checked in — job card ${workOrderNumber} opened` : `Checked in to job card ${workOrderNumber}`,
    });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch { /* connection gone */ } }
    console.error('POST /appointments/:id/check-in error:', err);
    return res.status(500).json({ success: false, message: 'Failed to check in' });
  } finally {
    if (conn) conn.release();
  }
});

// ══════════════════════════════════════════════════════════════
// PUT /api/appointments/:id — reschedule appointment
// ══════════════════════════════════════════════════════════════
router.put('/:id', canBook, async (req, res) => {
  try {
    const { appointment_date, appointment_time, service_bay_id, slot_duration_min, notes, service_category } = req.body;

    const [appt] = await query('SELECT * FROM appointments WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });
    if (['cancelled', 'completed', 'arrived', 'in_progress'].includes(appt.status)) {
      return res.status(400).json({ success: false, message: `Cannot reschedule a ${appt.status} appointment` });
    }
    if (appointment_date && !DATE_RE.test(String(appointment_date))) {
      return res.status(400).json({ success: false, message: 'Use a date as YYYY-MM-DD' });
    }
    if (appointment_time && !TIME_RE.test(String(appointment_time))) {
      return res.status(400).json({ success: false, message: 'Use a time as HH:MM' });
    }

    // Moving it must not overbook the new slot either.
    const date = appointment_date || appt.appointment_date;
    const time = appointment_time ? normTime(appointment_time) : normTime(appt.appointment_time);
    const duration = parseInt(slot_duration_min, 10) || appt.slot_duration_min || 60;
    const bayId = service_bay_id || appt.service_bay_id || null;
    if (appointment_date || appointment_time || service_bay_id || slot_duration_min) {
      const problem = await capacityProblem({ workshopId: req.workshopId, bayId, date, time, duration, excludeId: appt.id });
      if (problem) return res.status(problem.status).json({ success: false, message: problem.message });
    }

    await execute(
      `UPDATE appointments SET
         appointment_date = COALESCE(?, appointment_date),
         appointment_time = COALESCE(?, appointment_time),
         service_bay_id   = COALESCE(?, service_bay_id),
         slot_duration_min = COALESCE(?, slot_duration_min),
         notes            = COALESCE(?, notes),
         service_category = COALESCE(?, service_category)
       WHERE id = ? AND workshop_id = ?`,
      [appointment_date || null, appointment_time ? normTime(appointment_time) : null, service_bay_id || null,
       parseInt(slot_duration_min, 10) || null, notes || null, service_category || null,
       req.params.id, req.workshopId]
    );

    await logAudit(req.workshopId, req.user?.id, 'UPDATE', 'appointments', req.params.id, null, { appointment_date, appointment_time });
    res.json({ success: true, message: 'Appointment updated' });
  } catch (err) {
    console.error('PUT /appointments/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to update appointment' });
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/appointments/:id/status
// Body: { status, cancelled_reason? }
// ══════════════════════════════════════════════════════════════
router.patch('/:id/status', canBook, async (req, res) => {
  try {
    const { status, cancelled_reason } = req.body;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const [appt] = await query(
      `SELECT a.id, a.status, a.work_order_id, wo.status AS work_order_status, wo.work_order_number
         FROM appointments a LEFT JOIN work_orders wo ON wo.id = a.work_order_id AND wo.workshop_id = a.workshop_id
        WHERE a.id = ? AND a.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });

    // Checked in: the visit is the job card now. Undoing the booking while
    // its job card is still open would leave the card with no booking.
    if (['arrived', 'in_progress'].includes(appt.status) && ['pending', 'confirmed', 'cancelled', 'no_show'].includes(status)
        && appt.work_order_id && appt.work_order_status && appt.work_order_status !== 'cancelled') {
      return res.status(409).json({
        success: false,
        message: `This booking is checked in to job card ${appt.work_order_number}. Cancel the job card first.`,
      });
    }

    await execute(
      `UPDATE appointments SET status = ?,
       cancelled_reason = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_reason END
       WHERE id = ? AND workshop_id = ?`,
      [status, status, cancelled_reason || null, req.params.id, req.workshopId]
    );

    await logAudit(req.workshopId, req.user?.id, 'STATUS_CHANGE', 'appointments', req.params.id, { status: appt.status }, { status });
    res.json({ success: true, message: `Appointment ${status}` });
  } catch (err) {
    console.error('PATCH /appointments/:id/status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update appointment status' });
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/appointments/:id/assign-advisor — assign advisor (req 60)
// ══════════════════════════════════════════════════════════════
router.patch('/:id/assign-advisor', canBook, async (req, res) => {
  try {
    const { advisor_id } = req.body;
    if (!advisor_id) return res.status(400).json({ success: false, message: 'advisor_id required' });
    const [adv] = await query('SELECT id FROM users WHERE id = ? AND workshop_id = ?', [advisor_id, req.workshopId]);
    if (!adv) return res.status(400).json({ success: false, message: 'Advisor not found' });

    await execute(
      `UPDATE appointments SET booked_by_user_id = ?, status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
       WHERE id = ? AND workshop_id = ?`,
      [advisor_id, req.params.id, req.workshopId]
    );

    res.json({ success: true, message: 'Advisor assigned and appointment confirmed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to assign advisor' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/appointments/queue/today — service reception queue (req 60)
// ══════════════════════════════════════════════════════════════
router.get('/queue/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rows = await query(
      `SELECT a.*,
              c.full_name AS customer_full_name, c.phone AS customer_phone_db,
              v.plate_number, v.make, v.model,
              sb.name AS bay_name,
              u.full_name AS advisor_name
       FROM appointments a
       LEFT JOIN customers c  ON a.customer_id   = c.id
       LEFT JOIN vehicles  v  ON a.vehicle_id     = v.id
       LEFT JOIN service_bays sb ON a.service_bay_id = sb.id
       LEFT JOIN users u      ON a.booked_by_user_id = u.id
       WHERE a.workshop_id = ? AND a.appointment_date = ?
         AND a.status NOT IN ('cancelled','no_show')
       ORDER BY a.appointment_time ASC, a.status ASC`,
      [req.workshopId, today]
    );
    res.json({ success: true, queue: rows, date: today, total: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch queue' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/appointments/capacity/week — bay capacity view (req 63)
// ══════════════════════════════════════════════════════════════
router.get('/capacity/week', async (req, res) => {
  try {
    const { from } = req.query;
    const startDate = from || new Date().toISOString().split('T')[0];

    const bays = await query(
      'SELECT id, name, capacity FROM service_bays WHERE workshop_id = ? AND is_active = 1',
      [req.workshopId]
    );

    // Build 7-day view
    const result = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().split('T')[0];

      const dayBookings = await query(
        `SELECT service_bay_id, COUNT(*) AS booked
         FROM appointments
         WHERE workshop_id = ? AND appointment_date = ? AND status NOT IN ('cancelled','no_show')
         GROUP BY service_bay_id`,
        [req.workshopId, dateStr]
      );

      const bayUtil = bays.map(bay => {
        const booked = dayBookings.find(b => b.service_bay_id === bay.id)?.booked || 0;
        return {
          bay_id:    bay.id,
          bay_name:  bay.name,
          capacity:  bay.capacity || 1,
          booked,
          available: Math.max(0, (bay.capacity || 1) - booked),
          utilization_pct: bay.capacity ? Math.round((booked / bay.capacity) * 100) : 0,
        };
      });

      result.push({ date: dateStr, bays: bayUtil });
    }

    res.json({ success: true, capacity: result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch capacity' });
  }
});

export default router;
