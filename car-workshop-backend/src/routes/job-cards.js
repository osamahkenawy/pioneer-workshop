/**
 * ═══════════════════════════════════════════════════════════════
 *  Job Cards — SOW Section B5
 *  Covers: req 78 (job card from estimate, parts requisition split),
 *          req 79 (digital technician time capture clock-in/clock-out),
 *          req 80 (quality-control gate before billing),
 *          req 81 (technician productivity & first-time-fix tracking),
 *          req 83 (courtesy/loaner vehicle management)
 * ═══════════════════════════════════════════════════════════════
 */
import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { customerApprovalMissing, CUSTOMER_APPROVAL_REQUIRED } from '../lib/job-card-approval.js';
import { notifyGroups, notifyMechanic, QC_CHECKLIST } from '../lib/workflow.js';
import { can, isManagerRole } from '../lib/roles.js';
import { syncWorkOrderFromJobCards } from '../lib/workflow-sync.js';
import { parsePauseInput, timeStateFromLogs } from '../lib/status-labels.js';
import { extractStatusToken } from '../lib/customer-link.js';

const router = express.Router();
router.use(authMiddleware);

/** A technician's login (users.role 'mechanic'). Technicians see and act on
 *  their own job cards only, through GET /mine and the time booking. */
const isTechnician = req => req.user?.role === 'mechanic';

/** The logged-in user's technician (mechanics.id), or null. */
async function myMechanicId(req) {
  const [m] = await query('SELECT id FROM mechanics WHERE user_id = ? AND workshop_id = ?', [req.user.id, req.workshopId]);
  return m?.id || null;
}

/** Staff routes: every job card, prices and customer phones, loaners, KPIs. */
function staffOnly(req, res, next) {
  if (!isTechnician(req)) return next();
  return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Technicians see their own job cards in My Jobs.' });
}

function genJobCardNumber() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return `JC-${stamp}-${Math.floor(Math.random()*9000)+1000}`;
}

function genReqNumber() {
  return `MR-${Date.now()}`;
}

// ══════════════════════════════════════════════════════════════
// GET /api/job-cards — list job cards (staff)
// ══════════════════════════════════════════════════════════════
router.get('/', staffOnly, async (req, res) => {
  try {
    const { status, bay_id, department, search, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql = `
      SELECT jc.*, wo.work_order_number, wo.customer_name AS wo_customer_name,
             wo.customer_phone, v.plate_number, v.make, v.model,
             u.full_name AS foreman_name,
             sb.name AS bay_name
      FROM job_cards jc
      LEFT JOIN work_orders wo ON jc.work_order_id = wo.id
      LEFT JOIN vehicles v     ON jc.vehicle_id    = v.id
      LEFT JOIN users u        ON jc.foreman_id    = u.id
      LEFT JOIN service_bays sb ON jc.service_bay_id = sb.id
      WHERE jc.workshop_id = ?
    `;
    const params = [req.workshopId];
    if (status) { sql += ' AND jc.status = ?'; params.push(status); }
    if (bay_id) { sql += ' AND jc.service_bay_id = ?'; params.push(bay_id); }
    if (department) { sql += ' AND jc.department = ?'; params.push(department); }
    if (search) {
      sql += ' AND (jc.job_card_number LIKE ? OR jc.vehicle_plate LIKE ? OR wo.customer_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY jc.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const rows = await query(sql, params);
    res.json({ success: true, jobCards: rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('GET /job-cards error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch job cards' });
  }
});

// ══════════════════════════════════════════════════════════════
// TECHNICIAN APP — My Jobs, one job card, Scan job card, Finished jobs
// (Step 6; the technician never sets a work order status — the work
// order follows the job cards through lib/workflow-sync.js).
//
//   GET /mine            my open job cards + today's summary and bookings
//   GET /mine/history    my finished job cards (?days=7|30|90)
//   GET /mine/lookup     find my job card by QR / VIN barcode / typed code
//   GET /mine/:id        one of my job cards, any status, with its time log
//
// What a technician is shown: the plate and vehicle, the complaint, the
// approved work as "qty × name", parts with the Store's answer, their own
// clock and the quality check result. No prices, no customer name or phone.
// Declared before GET /:id.
// ══════════════════════════════════════════════════════════════

/** Job card statuses a technician still works on (a failed QC is rework). */
const CARD_OPEN = ['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_pending', 'qc_failed'];
/** The technician's part is done: handed to the quality check or past it. */
const CARD_DONE = ['qc_pending', 'qc_passed', 'ready_for_billing', 'billed'];
const CARD_PASSED = ['qc_passed', 'ready_for_billing', 'billed'];

// One row per job card. The booking is the Team Leader's current window for
// this technician on the work order (work_order_assignments); the three
// booking_* flags are worked out by the database clock, like every other time.
const CARD_SELECT = `
  SELECT jc.id, jc.job_card_number, jc.title, jc.parent_job_card_id, (jc.parent_job_card_id IS NULL) AS is_main,
         jc.status, jc.department, jc.work_order_id, jc.started_at, jc.completed_at, jc.qc_passed_at, jc.qc_notes,
         qu.full_name AS qc_inspector_name,
         (SELECT MAX(q.inspected_at) FROM qc_checklists q WHERE q.job_card_id = jc.id) AS qc_at,
         wo.work_order_number, wo.description, wo.special_instructions, wo.status AS wo_status, wo.odometer_in,
         CASE WHEN wo.status = 'completed' THEN wo.completed_at END AS handed_over_at,
         (wo.billing_basis = 'itemised' AND wo.customer_approved_at IS NULL) AS approval_missing,
         COALESCE(v.plate_number, jc.vehicle_plate) AS plate_number, v.make, v.model,
         v.year AS vehicle_year, v.color AS vehicle_colour, v.vin, sb.name AS bay_name,
         a.scheduled_start_at, a.scheduled_end_at,
         (a.scheduled_start_at IS NOT NULL AND a.scheduled_start_at <= NOW()) AS booking_started,
         (a.scheduled_end_at IS NOT NULL AND a.scheduled_end_at < NOW()) AS booking_ended,
         (a.scheduled_start_at IS NOT NULL AND EXISTS (
            SELECT 1 FROM technician_time_logs t
             WHERE t.job_card_id = jc.id AND t.mechanic_id = jc.mechanic_id
               AND COALESCE(t.clock_out, NOW()) > a.scheduled_start_at)) AS booked_since_start
    FROM job_cards jc
    JOIN work_orders wo ON wo.id = jc.work_order_id
    LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    LEFT JOIN service_bays sb ON sb.id = wo.service_bay_id
    LEFT JOIN users qu ON qu.id = jc.qc_inspector_id
    LEFT JOIN work_order_assignments a ON a.id = (
      SELECT MAX(x.id) FROM work_order_assignments x
       WHERE x.work_order_id = jc.work_order_id AND x.mechanic_id = jc.mechanic_id AND x.is_current = 1)`;

/**
 * Where a booked window stands: done (the card is handed to QC or past it) ·
 * late (the start has passed and no time was booked since, or the window
 * is over and the job is neither done nor running) · now · later (future;
 * the first one of the day becomes "next"). null without a booking.
 */
function bookingState(row, running) {
  if (!row.scheduled_start_at) return null;
  if (CARD_DONE.includes(row.status)) return 'done';
  if (!Number(row.booking_started)) return 'later';
  if (!Number(row.booked_since_start)) return 'late';
  if (running || !Number(row.booking_ended)) return 'now';
  return 'late';
}

const minutesOf = seconds => Math.floor(Math.max(0, Number(seconds) || 0) / 60);

/**
 * The technician's job cards in the technician shape. `where` narrows
 * job_cards (alias jc) beyond "assigned to this technician".
 * With `withLogs`, each card also carries time_logs[] (oldest first).
 */
async function technicianCards(mechanicId, workshopId, where, params = [], { order = 'jc.id', withLogs = false } = {}) {
  const cards = await query(
    `${CARD_SELECT} WHERE jc.workshop_id = ? AND jc.mechanic_id = ? AND ${where} ORDER BY ${order}`,
    [workshopId, mechanicId, ...params]);
  if (!cards.length) return [];
  const ids = cards.map(c => c.id);
  const [logs, parts, items] = await Promise.all([
    query(
      `SELECT job_card_id, clock_in, clock_out, end_reason, pause_reason, end_note,
              GREATEST(0, TIMESTAMPDIFF(SECOND, clock_in, COALESCE(clock_out, NOW()))) AS seconds,
              GREATEST(0, TIMESTAMPDIFF(SECOND, GREATEST(clock_in, CURDATE()),
                                        LEAST(COALESCE(clock_out, NOW()), CURDATE() + INTERVAL 1 DAY))) AS today_seconds
         FROM technician_time_logs WHERE job_card_id IN (?) AND mechanic_id = ? ORDER BY clock_in, id`, [ids, mechanicId]),
    query(
      `SELECT i.id, r.job_card_id, r.req_number, r.created_at AS requested_at, i.description,
              i.quantity_requested, i.quantity_issued, i.status, i.availability, i.expected_date
         FROM material_requisition_items i JOIN material_requisitions r ON r.id = i.requisition_id
        WHERE r.job_card_id IN (?) AND r.status <> 'cancelled' ORDER BY i.id`, [ids]),
    query(
      `SELECT i.name, i.quantity, i.item_type, i.job_card_id, i.work_order_id FROM work_order_items i
        WHERE i.work_order_id IN (?) ORDER BY i.id`, [[...new Set(cards.map(c => c.work_order_id))]]),
  ]);
  return cards.map(c => {
    const { booking_started, booking_ended, booked_since_start, ...card } = c;
    const mine = logs.filter(l => l.job_card_id === c.id);
    const running = mine.find(l => !l.clock_out);
    const last = mine.at(-1);
    const paused = !running && last?.end_reason === 'pause' ? last : null;
    const isMain = !c.parent_job_card_id;
    const out = {
      ...card,
      is_main: isMain,
      approval_missing: !!Number(c.approval_missing),
      minutes: minutesOf(mine.reduce((s, l) => s + Number(l.seconds), 0)),
      today_minutes: minutesOf(mine.reduce((s, l) => s + Number(l.today_seconds), 0)),
      time_state: timeStateFromLogs(mine),
      running_since: running?.clock_in || null,
      paused_since: paused?.clock_out || null,
      last_pause_reason: paused?.pause_reason || null,
      last_pause_note: paused?.end_note || null,
      late: bookingState(c, !!running) === 'late',
      parts: parts.filter(p => p.job_card_id === c.id),
      // Lines with no job card belong to the main one.
      items: items.filter(i => i.work_order_id === c.work_order_id && (i.job_card_id ? i.job_card_id === c.id : isMain)),
    };
    if (withLogs) {
      out.time_logs = mine.map(l => ({
        clock_in: l.clock_in, clock_out: l.clock_out, end_reason: l.end_reason,
        pause_reason: l.pause_reason, end_note: l.end_note, minutes: minutesOf(l.seconds),
      }));
    }
    return out;
  });
}

/** The technician's running clock, on any job card but `exceptJobCardId`. */
async function runningClock(mechanicId, exceptJobCardId = 0) {
  const [r] = await query(
    `SELECT t.id AS time_log_id, t.job_card_id, jc.job_card_number, wo.work_order_number,
            COALESCE(v.plate_number, jc.vehicle_plate) AS plate, t.clock_in AS since
       FROM technician_time_logs t
       JOIN job_cards jc ON jc.id = t.job_card_id
       JOIN work_orders wo ON wo.id = jc.work_order_id
       LEFT JOIN vehicles v ON v.id = wo.vehicle_id
      WHERE t.mechanic_id = ? AND t.clock_out IS NULL AND t.job_card_id <> ?
      ORDER BY t.clock_in DESC LIMIT 1`, [mechanicId, exceptJobCardId || 0]);
  return r || null;
}

const serverTime = async () => (await query('SELECT NOW() AS now'))[0].now;

const EMPTY_SUMMARY = Object.freeze({ time_booked_today_min: 0, jobs_done_today: 0, waiting_qc: 0, rework: 0, running: null, paused: null });

// GET /api/job-cards/mine — my open job cards, today's summary and bookings.
// The shape of jobCards[] is the one the technician app has always read,
// with more fields.
router.get('/mine', async (req, res) => {
  try {
    const mechanicId = await myMechanicId(req);
    if (!mechanicId) {
      return res.json({ success: true, mechanic_id: null, server_time: await serverTime(), summary: EMPTY_SUMMARY, bookings_today: [], jobCards: [] });
    }
    const [jobCards, [today], [done], bookings, running, now] = await Promise.all([
      technicianCards(mechanicId, req.workshopId, "jc.status IN (?) AND wo.status NOT IN ('completed','cancelled')", [CARD_OPEN], {
        order: "FIELD(jc.status,'in_progress','qc_failed','open','parts_requested','parts_issued','qc_pending'), jc.id",
        withLogs: true,
      }),
      // Time booked today on any job card: each booking cut to today.
      query(
        `SELECT COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, GREATEST(clock_in, CURDATE()),
                                                     LEAST(COALESCE(clock_out, NOW()), CURDATE() + INTERVAL 1 DAY)))), 0) AS seconds
           FROM technician_time_logs
          WHERE mechanic_id = ? AND clock_in < CURDATE() + INTERVAL 1 DAY AND COALESCE(clock_out, NOW()) > CURDATE()`, [mechanicId]),
      query(
        `SELECT COUNT(*) AS n FROM job_cards
          WHERE workshop_id = ? AND mechanic_id = ? AND status IN (?) AND completed_at >= CURDATE()`, [req.workshopId, mechanicId, CARD_DONE]),
      // Today's windows from the Team Leader, with my job card on each work
      // order (the main one when it is mine).
      query(
        `SELECT a.work_order_id, wo.work_order_number, jc.id AS job_card_id, jc.job_card_number,
                (jc.parent_job_card_id IS NULL) AS is_main, jc.department, jc.status,
                COALESCE(v.plate_number, jc.vehicle_plate) AS plate, v.make, v.model,
                a.scheduled_start_at, a.scheduled_end_at,
                (a.scheduled_start_at <= NOW()) AS booking_started,
                (a.scheduled_end_at IS NOT NULL AND a.scheduled_end_at < NOW()) AS booking_ended,
                EXISTS (SELECT 1 FROM technician_time_logs t WHERE t.job_card_id = jc.id AND t.mechanic_id = a.mechanic_id
                           AND COALESCE(t.clock_out, NOW()) > a.scheduled_start_at) AS booked_since_start,
                EXISTS (SELECT 1 FROM technician_time_logs t WHERE t.job_card_id = jc.id AND t.mechanic_id = a.mechanic_id
                           AND t.clock_out IS NULL) AS running
           FROM work_order_assignments a
           JOIN work_orders wo ON wo.id = a.work_order_id
           JOIN job_cards jc ON jc.id = (
                SELECT j.id FROM job_cards j
                 WHERE j.work_order_id = a.work_order_id AND j.mechanic_id = a.mechanic_id AND j.status <> 'cancelled'
                 ORDER BY (j.parent_job_card_id IS NULL) DESC, j.id LIMIT 1)
           LEFT JOIN vehicles v ON v.id = wo.vehicle_id
          WHERE a.mechanic_id = ? AND a.is_current = 1 AND wo.workshop_id = ? AND wo.status <> 'cancelled'
            AND a.scheduled_start_at IS NOT NULL
            AND a.scheduled_start_at < CURDATE() + INTERVAL 1 DAY
            AND COALESCE(a.scheduled_end_at, a.scheduled_start_at) >= CURDATE()
          ORDER BY a.scheduled_start_at, a.id`, [mechanicId, req.workshopId]),
      runningClock(mechanicId),
      serverTime(),
    ]);

    let nextGiven = false;
    const bookings_today = bookings.map(b => {
      let state = bookingState(b, !!Number(b.running));
      if (state === 'later' && !nextGiven) { state = 'next'; nextGiven = true; }
      return {
        work_order_id: b.work_order_id, work_order_number: b.work_order_number,
        job_card_id: b.job_card_id, job_card_number: b.job_card_number, is_main: !!Number(b.is_main), department: b.department,
        plate: b.plate, make: b.make, model: b.model,
        scheduled_start_at: b.scheduled_start_at, scheduled_end_at: b.scheduled_end_at, state,
      };
    });

    const pausedCard = jobCards.filter(c => c.time_state === 'paused' && c.paused_since)
      .sort((a, b) => String(b.paused_since).localeCompare(String(a.paused_since)))[0];
    const summary = {
      time_booked_today_min: minutesOf(today.seconds),
      jobs_done_today: Number(done.n) || 0,
      waiting_qc: jobCards.filter(c => c.status === 'qc_pending').length,
      rework: jobCards.filter(c => c.status === 'qc_failed').length,
      running: running ? {
        job_card_id: running.job_card_id, job_card_number: running.job_card_number,
        work_order_number: running.work_order_number, plate: running.plate, since: running.since,
      } : null,
      paused: pausedCard ? {
        job_card_id: pausedCard.id, job_card_number: pausedCard.job_card_number, work_order_number: pausedCard.work_order_number,
        plate: pausedCard.plate_number, reason: pausedCard.last_pause_reason, note: pausedCard.last_pause_note, since: pausedCard.paused_since,
      } : null,
    };
    res.json({ success: true, mechanic_id: mechanicId, server_time: now, summary, bookings_today, jobCards });
  } catch (err) {
    console.error('GET /job-cards/mine error:', err);
    res.status(500).json({ success: false, message: 'Failed to load your job cards' });
  }
});

// GET /api/job-cards/mine/history?days=7|30|90 — my finished job cards
router.get('/mine/history', async (req, res) => {
  try {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const mechanicId = await myMechanicId(req);
    if (!mechanicId) {
      return res.json({ success: true, days, totals: { hours_this_week: 0, minutes_this_week: 0, first_time_pass_pct: null, cards: 0 }, items: [] });
    }
    // A failed quality check leaves an audit row (POST /:id/qc); the checklist
    // itself is replaced by the next check, so it only shows the latest.
    const [rows, [week]] = await Promise.all([
      query(
        `SELECT jc.id AS job_card_id, jc.job_card_number, (jc.parent_job_card_id IS NULL) AS is_main, jc.department, jc.title, jc.status,
                COALESCE(jc.completed_at, jc.qc_passed_at) AS completed_at, jc.qc_passed_at,
                wo.work_order_number, wo.status AS wo_status, CASE WHEN wo.status = 'completed' THEN wo.completed_at END AS handed_over_at,
                COALESCE(v.plate_number, jc.vehicle_plate) AS plate, v.make, v.model,
                (SELECT COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, t.clock_in, COALESCE(t.clock_out, NOW())))), 0)
                   FROM technician_time_logs t WHERE t.job_card_id = jc.id AND t.mechanic_id = jc.mechanic_id) AS booked_seconds,
                (EXISTS (SELECT 1 FROM qc_checklists q WHERE q.job_card_id = jc.id AND q.overall_result = 'failed')
                 OR EXISTS (SELECT 1 FROM audit_logs al
                             WHERE al.entity_type = 'job_cards' AND al.entity_id = jc.id AND al.action = 'QC' AND al.workshop_id = jc.workshop_id
                               AND JSON_UNQUOTE(JSON_EXTRACT(al.new_value, '$.overall_result')) = 'failed')) AS failed_before
           FROM job_cards jc
           JOIN work_orders wo ON wo.id = jc.work_order_id
           LEFT JOIN vehicles v ON v.id = wo.vehicle_id
          WHERE jc.workshop_id = ? AND jc.mechanic_id = ? AND jc.status IN ('qc_pending','qc_failed','qc_passed','ready_for_billing','billed')
            AND COALESCE(jc.completed_at, jc.qc_passed_at) >= CURDATE() - INTERVAL ? DAY
          ORDER BY COALESCE(jc.completed_at, jc.qc_passed_at) DESC, jc.id DESC
          LIMIT 500`, [req.workshopId, mechanicId, days - 1]),
      // This week starts on Monday.
      query(
        `SELECT COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, GREATEST(clock_in, CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY),
                                                     COALESCE(clock_out, NOW())))), 0) AS seconds
           FROM technician_time_logs
          WHERE mechanic_id = ? AND COALESCE(clock_out, NOW()) > CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY`, [mechanicId]),
    ]);
    const items = rows.map(r => {
      const qc_result = r.status === 'qc_pending' ? 'waiting'
        : r.status === 'qc_failed' ? 'rework'
        : Number(r.failed_before) ? 'passed_after_rework' : 'passed_first_time';
      return {
        job_card_id: r.job_card_id, job_card_number: r.job_card_number, work_order_number: r.work_order_number,
        plate: r.plate, make: r.make, model: r.model, is_main: !!Number(r.is_main), department: r.department, title: r.title,
        status: r.status, completed_at: r.completed_at, booked_minutes: minutesOf(r.booked_seconds), qc_result,
        handed_over: r.wo_status === 'completed', handed_over_at: r.handed_over_at,
      };
    });
    const checked = items.filter(i => i.qc_result !== 'waiting');
    const weekMinutes = minutesOf(week.seconds);
    res.json({
      success: true, days,
      totals: {
        hours_this_week: Math.round(weekMinutes / 6) / 10,
        minutes_this_week: weekMinutes,
        first_time_pass_pct: checked.length ? Math.round(100 * checked.filter(i => i.qc_result === 'passed_first_time').length / checked.length) : null,
        cards: items.length,
      },
      items,
    });
  } catch (err) {
    console.error('GET /job-cards/mine/history error:', err);
    res.status(500).json({ success: false, message: 'Failed to load your finished jobs' });
  }
});

// GET /api/job-cards/mine/lookup?code= — "Scan job card". The code is the job
// sheet QR (/service-status/:token or /track/:token), the car's VIN barcode,
// or what the technician typed: job card number, WO number, plate, full VIN
// or its last 6 characters. It only finds the job card; it changes nothing.
//   200 { data: [my cards] } · 403 NOT_YOURS (the car's job card is someone
//   else's or not assigned yet) · 404 NOT_FOUND · 400 CODE_TOO_SHORT
router.get('/mine/lookup', async (req, res) => {
  try {
    const raw = extractStatusToken(req.query.code).slice(0, 200);
    const upper = raw.toUpperCase();
    const compact = upper.replace(/[\s-]+/g, '');
    if (compact.length < 3) {
      return res.status(400).json({ success: false, code: 'CODE_TOO_SHORT', message: 'Type at least 3 characters.' });
    }
    const mechanicId = await myMechanicId(req);
    if (!mechanicId) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'This login is not linked to a technician.' });
    // A VIN barcode often adds a leading "I" (imported) to the 17 characters.
    const vin = compact.length === 18 && compact.startsWith('I') ? compact.slice(1) : compact;
    // Live work orders, and those closed in the last 7 days.
    const matches = await query(
      `SELECT wo.id, wo.work_order_number, wo.status, v.plate_number, v.make, v.model,
              (wo.service_status_token = ?) AS by_token,
              (wo.work_order_number = ?) AS by_wo,
              (REPLACE(REPLACE(UPPER(v.plate_number), ' ', ''), '-', '') = ?) AS by_plate,
              (UPPER(v.vin) = ? OR (CHAR_LENGTH(?) = 6 AND RIGHT(UPPER(v.vin), 6) = ?)) AS by_vin,
              EXISTS (SELECT 1 FROM job_cards j WHERE j.work_order_id = wo.id AND j.job_card_number = ?) AS by_jc
         FROM work_orders wo
         LEFT JOIN vehicles v ON v.id = wo.vehicle_id
        WHERE wo.workshop_id = ?
          AND (wo.status NOT IN ('completed','cancelled') OR (wo.status = 'completed' AND wo.completed_at >= NOW() - INTERVAL 7 DAY))
       HAVING by_token OR by_wo OR by_plate OR by_vin OR by_jc
        ORDER BY (wo.status = 'completed'), wo.id DESC
        LIMIT 10`,
      [raw, upper, compact, vin, compact, compact, upper, req.workshopId]);

    const found = matches.length ? await query(
      "SELECT id, mechanic_id, work_order_id FROM job_cards WHERE workshop_id = ? AND work_order_id IN (?) AND status <> 'cancelled'",
      [req.workshopId, matches.map(m => m.id)]) : [];
    // The car's live job comes first; a job closed this week only when the
    // car has no live one (a car back for new work shows the new job).
    const live = new Set(matches.filter(m => m.status !== 'completed').map(m => m.id));
    const liveCards = found.filter(c => live.has(c.work_order_id));
    const cards = liveCards.length ? liveCards : found;
    const mineIds = cards.filter(c => Number(c.mechanic_id) === Number(mechanicId)).map(c => c.id);
    const result = mineIds.length ? 'own' : cards.length ? 'not yours' : 'no job card';

    // Log the lookup against each work order found (never the code itself:
    // it can be the customer's status token).
    try {
      const how = m => ['token', 'wo', 'jc', 'plate', 'vin'].filter(k => Number(m[`by_${k}`])).join('+');
      for (const m of matches.slice(0, 5)) {
        await execute(
          "INSERT INTO work_order_scan_logs (work_order_id, workshop_id, scanned_by, scan_type, note) VALUES (?, ?, ?, 'technician_lookup', ?)",
          [m.id, req.workshopId, req.user.id, `Technician lookup by ${how(m)}: ${result}`]);
      }
    } catch (err) {
      console.error('GET /job-cards/mine/lookup scan log error:', err.message);
    }

    if (mineIds.length) {
      const data = await technicianCards(mechanicId, req.workshopId, 'jc.id IN (?)', [mineIds], {
        order: `(jc.status IN ('qc_passed','ready_for_billing','billed')), (wo.status = 'completed'), jc.parent_job_card_id IS NOT NULL, jc.id`,
      });
      return res.json({ success: true, data });
    }
    if (cards.length) {
      // The car the technician is holding the sheet for — nothing about who has it.
      const m = matches.find(x => cards.some(c => c.work_order_id === x.id)) || matches[0];
      return res.status(403).json({
        success: false, code: 'NOT_YOURS', message: 'This job card is not assigned to you. Ask your Team Leader.',
        match: { work_order_number: m.work_order_number, plate_number: m.plate_number, make: m.make, model: m.model },
      });
    }
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: `No open job card found for "${raw}".` });
  } catch (err) {
    console.error('GET /job-cards/mine/lookup error:', err);
    res.status(500).json({ success: false, message: 'Failed to look up the job card' });
  }
});

// GET /api/job-cards/mine/:id — one of my job cards, any status, with my time log
router.get('/mine/:id', async (req, res) => {
  try {
    const mechanicId = await myMechanicId(req);
    const id = Number(req.params.id);
    const [jobCard] = mechanicId && id
      ? await technicianCards(mechanicId, req.workshopId, 'jc.id = ?', [id], { withLogs: true })
      : [];
    if (!jobCard) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'This job card is not assigned to you.' });
    const [running, now] = await Promise.all([runningClock(mechanicId, jobCard.id), serverTime()]);
    res.json({
      success: true, server_time: now, jobCard,
      // My clock on another job card, so Start can offer to pause it.
      running_elsewhere: running ? {
        job_card_id: running.job_card_id, job_card_number: running.job_card_number,
        work_order_number: running.work_order_number, plate: running.plate, since: running.since,
      } : null,
    });
  } catch (err) {
    console.error('GET /job-cards/mine/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the job card' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/job-cards/:id — detail with lines, time logs, QC.
// A technician gets their own job card only (404 otherwise), without the
// costs or the customer's name.
// ══════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const [jc] = await query(
      `SELECT jc.*, wo.work_order_number, wo.customer_name AS wo_customer_name,
              v.plate_number, v.make, v.model, v.year,
              u.full_name AS foreman_name,
              sb.name AS bay_name
       FROM job_cards jc
       LEFT JOIN work_orders wo ON jc.work_order_id = wo.id
       LEFT JOIN vehicles v     ON jc.vehicle_id    = v.id
       LEFT JOIN users u        ON jc.foreman_id    = u.id
       LEFT JOIN service_bays sb ON jc.service_bay_id = sb.id
       WHERE jc.id = ? AND jc.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });
    if (isTechnician(req)) {
      const mechanicId = await myMechanicId(req);
      if (!mechanicId || Number(jc.mechanic_id) !== Number(mechanicId)) {
        return res.status(404).json({ success: false, message: 'Job card not found' });
      }
      for (const k of ['labour_cost', 'parts_cost', 'sublet_cost', 'total_cost', 'wo_customer_name', 'customer_id']) delete jc[k];
    }

    const lines = await query(
      `SELECT jcl.*, m.full_name AS mechanic_name
       FROM job_card_lines jcl
       LEFT JOIN mechanics m ON jcl.assigned_mechanic_id = m.id
       WHERE jcl.job_card_id = ?
       ORDER BY jcl.sort_order, jcl.id`,
      [req.params.id]
    );

    const timeLogs = await query(
      `SELECT ttl.*, m.full_name AS mechanic_full_name
       FROM technician_time_logs ttl
       LEFT JOIN mechanics m ON ttl.mechanic_id = m.id
       WHERE ttl.job_card_id = ?
       ORDER BY ttl.clock_in DESC`,
      [req.params.id]
    );

    const [qc] = await query('SELECT * FROM qc_checklists WHERE job_card_id = ?', [req.params.id]);

    res.json({ success: true, jobCard: jc, lines, timeLogs, qc: qc || null });
  } catch (err) {
    console.error('GET /job-cards/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch job card' });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/job-cards — create from work order / estimate (req 78)
// Body: { work_order_id, estimate_id, service_bay_id, foreman_id,
//         department, lines: [{description, line_type, payer_direction,
//         assigned_mechanic_id, standard_hours, operation_id}] }
// ══════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  try {
    // Job cards are opened at intake (Service Advisor / Supervisor) or by the
    // floor for part of the work (Team Leader); never by a technician.
    if (!can(req.user, 'job.open') && !can(req.user, 'job.assign')) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Job cards are opened by the Service Advisor, Supervisor or Team Leader.' });
    }
    const {
      work_order_id, estimate_id, service_bay_id, foreman_id,
      department = 'mechanical', lines = []
    } = req.body;

    if (!work_order_id) {
      return res.status(400).json({ success: false, message: 'work_order_id is required' });
    }

    const [wo] = await query(
      'SELECT * FROM work_orders WHERE id = ? AND workshop_id = ?',
      [work_order_id, req.workshopId]
    );
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });

    // One main job card per work order (opened at intake, lib/workflow.js);
    // a further card for the same work order is a sub-job card.
    const [mainJc] = await query(
      "SELECT id FROM job_cards WHERE work_order_id = ? AND workshop_id = ? AND parent_job_card_id IS NULL AND status <> 'cancelled' LIMIT 1",
      [work_order_id, req.workshopId]);
    const job_card_number = genJobCardNumber();
    const [veh] = wo.vehicle_id
      ? await query('SELECT plate_number FROM vehicles WHERE id = ? AND workshop_id = ?', [wo.vehicle_id, req.workshopId])
      : [];

    const result = await execute(
      `INSERT INTO job_cards
         (workshop_id, job_card_number, work_order_id, parent_job_card_id, estimate_id, customer_id,
          vehicle_id, vehicle_plate, service_bay_id, foreman_id, department,
          status, wip_opened_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',NOW(),?)`,
      [req.workshopId, job_card_number, work_order_id, mainJc?.id || null, estimate_id || null,
       wo.customer_id, wo.vehicle_id, veh?.plate_number || null,
       service_bay_id || null, foreman_id || null, department, req.user?.id]
    );

    const jobCardId = result.insertId;

    // Insert lines
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await execute(
        `INSERT INTO job_card_lines
           (job_card_id, workshop_id, estimate_line_id, operation_id, description,
            line_type, payer_direction, assigned_mechanic_id, standard_hours, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [jobCardId, req.workshopId, l.estimate_line_id || null, l.operation_id || null,
         l.description, l.line_type || 'labour', l.payer_direction || 'customer',
         l.assigned_mechanic_id || null, l.standard_hours || null, i]
      );
    }

    // Open WIP entry (req 100)
    await execute(
      `INSERT INTO wip_ledger (workshop_id, job_card_id, work_order_id, entry_type, amount, description, posted_by)
       VALUES (?, ?, ?, 'open', 0.00, ?, ?)`,
      [req.workshopId, jobCardId, work_order_id, `WIP opened: ${job_card_number}`, req.user?.id]
    );

    await logAudit(req.workshopId, req.user?.id, 'CREATE', 'job_cards', jobCardId, null, { job_card_number });
    res.status(201).json({ success: true, jobCardId, job_card_number });
  } catch (err) {
    console.error('POST /job-cards error:', err);
    res.status(500).json({ success: false, message: 'Failed to create job card' });
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/job-cards/:id/status — transition status (the floor)
// Valid transitions enforced per SOW lifecycle:
//   open → parts_requested → parts_issued → in_progress →
//   qc_pending → qc_passed → ready_for_billing
// A technician moves a job card only with Start / Pause / Stop / Job done;
// the QC result is recorded with its checklist (POST /:id/qc); billing
// steps are a manager's.
// ══════════════════════════════════════════════════════════════
const JC_TRANSITIONS = {
  open:             ['parts_requested','in_progress','cancelled'],
  parts_requested:  ['parts_issued','cancelled'],
  parts_issued:     ['in_progress','cancelled'],
  in_progress:      ['qc_pending'],
  qc_pending:       ['qc_passed','qc_failed'],
  qc_failed:        ['in_progress'],
  qc_passed:        ['ready_for_billing'],
  ready_for_billing:['billed'],
};

router.patch('/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body || {};
    if (isTechnician(req)) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Use Start, Pause, Stop and Job done on your job card.' });
    }
    if (status === 'qc_passed' || status === 'qc_failed') {
      return res.status(400).json({ success: false, code: 'USE_QC', message: 'Record the quality check (POST /:id/qc).' });
    }
    if (status === 'ready_for_billing' || status === 'billed') {
      if (!isManagerRole(req.user)) {
        return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Only a manager can move a job card to billing.' });
      }
    } else if (!can(req.user, 'job.assign')) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Job card status is changed by the Team Leader, Supervisor or Workshop Foreman.' });
    }
    const [jc] = await query(
      'SELECT * FROM job_cards WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });

    const allowed = JC_TRANSITIONS[jc.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${jc.status} to ${status}. Allowed: ${allowed.join(', ')}`
      });
    }

    // QC gate: prevent billing without QC pass (req 80)
    if (status === 'ready_for_billing' && jc.status !== 'qc_passed') {
      return res.status(400).json({ success: false, message: 'Job must pass quality control before billing' });
    }

    const extra = {};
    if (status === 'in_progress' && !jc.started_at) extra.started_at = new Date();
    if (status === 'qc_pending') extra.completed_at = new Date();
    if (status === 'qc_passed') extra.qc_passed_at = new Date();
    if (status === 'billed') extra.wip_closed_at = new Date();

    const updateFields = Object.keys(extra).map(k => `${k} = ?`).join(', ');
    const updateVals = Object.values(extra);

    await execute(
      `UPDATE job_cards SET status = ? ${updateFields ? ', ' + updateFields : ''} WHERE id = ? AND workshop_id = ?`,
      [status, ...updateVals, req.params.id, req.workshopId]
    );

    // Close WIP when billed (req 100)
    if (status === 'billed') {
      await execute(
        `INSERT INTO wip_ledger (workshop_id, job_card_id, work_order_id, entry_type, amount, description, posted_by)
         VALUES (?, ?, ?, 'close', ?, ?, ?)`,
        [req.workshopId, jc.id, jc.work_order_id, jc.total_cost, `WIP closed: billed`, req.user?.id]
      );
    }

    await logAudit(req.workshopId, req.user?.id, 'STATUS_CHANGE', 'job_cards', req.params.id, jc.status, { new_status: status, notes });
    res.json({ success: true, message: `Job card ${status}` });
  } catch (err) {
    console.error('PATCH /job-cards/:id/status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update job card status' });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/job-cards/:id/clock-in — technician time capture (req 79)
// Body: { mechanic_id, job_card_line_id, activity_notes }
// ══════════════════════════════════════════════════════════════
router.post('/:id/clock-in', async (req, res) => {
  try {
    // Legacy endpoints (the app uses /time/start|pause|stop): a technician may
    // not book time for someone else through them.
    if (req.user.role === 'mechanic') return res.status(403).json({ success: false, message: 'Use the job card time booking.' });
    const { mechanic_id, job_card_line_id, activity_notes } = req.body;
    if (!mechanic_id) return res.status(400).json({ success: false, message: 'mechanic_id required' });

    const [jc] = await query(
      'SELECT id FROM job_cards WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });

    // Check mechanic isn't already clocked in on this job
    const [open] = await query(
      `SELECT id FROM technician_time_logs
       WHERE job_card_id = ? AND mechanic_id = ? AND clock_out IS NULL`,
      [req.params.id, mechanic_id]
    );
    if (open) {
      return res.status(409).json({ success: false, message: 'Mechanic already clocked in on this job. Clock out first.' });
    }
    // One clock per technician (see POST /:id/time/start).
    const elsewhere = await runningClock(mechanic_id, jc.id);
    if (elsewhere) {
      return res.status(409).json({ success: false, code: 'CLOCK_RUNNING_ELSEWHERE', message: `Time is running on ${elsewhere.work_order_number} / ${elsewhere.job_card_number}. Clock out there first.` });
    }

    const [mech] = await query('SELECT full_name AS name FROM mechanics WHERE id = ?', [mechanic_id]);

    const result = await execute(
      `INSERT INTO technician_time_logs (workshop_id, job_card_id, job_card_line_id, mechanic_id, mechanic_name, clock_in, activity_notes)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [req.workshopId, req.params.id, job_card_line_id || null, mechanic_id, mech?.name || null, activity_notes || null]
    );

    // Auto-update line status to in_progress
    if (job_card_line_id) {
      await execute(
        `UPDATE job_card_lines SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
         WHERE id = ? AND job_card_id = ?`,
        [job_card_line_id, req.params.id]
      );
    }

    // Auto-update job card to in_progress
    await execute(
      `UPDATE job_cards SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
       WHERE id = ? AND status IN ('open','parts_issued')`,
      [req.params.id]
    );

    res.status(201).json({ success: true, timeLogId: result.insertId, message: 'Clocked in' });
  } catch (err) {
    console.error('POST /job-cards/:id/clock-in error:', err);
    res.status(500).json({ success: false, message: 'Failed to clock in' });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/job-cards/:id/clock-out — end technician session
// Body: { mechanic_id, time_log_id, activity_notes }
// ══════════════════════════════════════════════════════════════
router.post('/:id/clock-out', async (req, res) => {
  try {
    // Legacy endpoints (the app uses /time/start|pause|stop): a technician may
    // not book time for someone else through them.
    if (req.user.role === 'mechanic') return res.status(403).json({ success: false, message: 'Use the job card time booking.' });
    const { mechanic_id, time_log_id } = req.body;
    if (!mechanic_id) return res.status(400).json({ success: false, message: 'mechanic_id required' });

    let logQuery = `UPDATE technician_time_logs SET clock_out = NOW()
                    WHERE job_card_id = ? AND mechanic_id = ? AND clock_out IS NULL`;
    let logParams = [req.params.id, mechanic_id];
    if (time_log_id) {
      logQuery += ' AND id = ?';
      logParams.push(time_log_id);
    }

    const result = await execute(logQuery, logParams);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'No active clock-in found for this mechanic' });
    }

    // Compute total minutes for this mechanic on this job
    const [totals] = await query(
      `SELECT SUM(elapsed_minutes) AS total_minutes
       FROM technician_time_logs
       WHERE job_card_id = ? AND mechanic_id = ? AND clock_out IS NOT NULL`,
      [req.params.id, mechanic_id]
    );

    res.json({ success: true, message: 'Clocked out', total_minutes: totals?.total_minutes || 0 });
  } catch (err) {
    console.error('POST /job-cards/:id/clock-out error:', err);
    res.status(500).json({ success: false, message: 'Failed to clock out' });
  }
});

// ══════════════════════════════════════════════════════════════
// WORKFLOW, Step 6–7 (Pioneer_Complete_Workshop_Workflow_Steps_1_to_7.pdf)
//   time booking Start / Pause / Stop → JOB DONE → quality check with test
//   drive → (lib/workflow-sync.js moves the work order along)
//   material requisition → the Store is notified
// ══════════════════════════════════════════════════════════════

async function loadJobCard(id, workshopId) {
  const [jc] = await query(
    `SELECT jc.*, wo.work_order_number, wo.status AS wo_status
       FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id
      WHERE jc.id = ? AND jc.workshop_id = ?`,
    [id, workshopId]
  );
  return jc || null;
}

/** The technician a time-booking request is for: a technician always books
 *  their own time; staff book for the technician they name, or the one on
 *  the job card. */
async function bookingMechanicId(req, jc) {
  if (req.user.role === 'mechanic') {
    const [m] = await query('SELECT id FROM mechanics WHERE user_id = ? AND workshop_id = ?', [req.user.id, req.workshopId]);
    return m?.id || null;
  }
  const id = Number(req.body?.mechanic_id) || jc.mechanic_id || null;
  if (!id) return null;
  const [m] = await query('SELECT id FROM mechanics WHERE id = ? AND workshop_id = ?', [id, req.workshopId]);
  return m?.id || null;
}

/** A technician acts only on job cards assigned to them; staff need the capability. */
async function technicianMayActOn(req, jc, capability = 'time.book') {
  if (req.user.role !== 'mechanic') return can(req.user, capability);
  const [m] = await query('SELECT id FROM mechanics WHERE user_id = ? AND workshop_id = ?', [req.user.id, req.workshopId]);
  return !!m && Number(jc.mechanic_id) === Number(m.id);
}

const QC_ROLES = ['supervisor', 'foreman', 'team_leader'];

// POST /api/job-cards/:id/time/start  { mechanic_id?, pause_other? }  — Start, or resume after Pause.
// One clock per technician: with time running on another job card it answers
// 409 CLOCK_RUNNING_ELSEWHERE { running }; { pause_other: true } pauses that
// clock ("Moved to another job") and starts here.
router.post('/:id/time/start', async (req, res) => {
  try {
    const jc = await loadJobCard(req.params.id, req.workshopId);
    if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });
    if (['completed', 'cancelled'].includes(jc.wo_status)) return res.status(409).json({ success: false, message: `This job is ${jc.wo_status}.` });
    if (['qc_pending', 'qc_passed', 'ready_for_billing', 'billed'].includes(jc.status)) {
      return res.status(409).json({ success: false, message: 'This job card is marked done. A failed quality check reopens it.' });
    }
    if (await customerApprovalMissing(jc.work_order_id, req.workshopId)) {
      return res.status(409).json({ success: false, ...CUSTOMER_APPROVAL_REQUIRED });
    }
    const mechanicId = await bookingMechanicId(req, jc);
    if (!mechanicId) return res.status(400).json({ success: false, message: 'Assign a technician first (or choose who is booking time).' });
    // Step 6: the Team Leader assigns the job; a technician books time on their
    // own job cards, and the floor (Team Leader / Supervisor / Foreman) for them.
    if (req.user.role === 'mechanic' && Number(jc.mechanic_id) !== Number(mechanicId)) {
      return res.status(403).json({ success: false, message: 'This job card is not assigned to you. Ask the Team Leader.' });
    }
    if (req.user.role !== 'mechanic' && !can(req.user, 'time.book')) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Time is booked by the technician, or the Team Leader / Supervisor / Foreman for them.' });
    }

    const [open] = await query(
      'SELECT id FROM technician_time_logs WHERE job_card_id = ? AND mechanic_id = ? AND clock_out IS NULL', [jc.id, mechanicId]);
    if (open) return res.status(409).json({ success: false, message: 'Time is already running for this technician on this job card.' });

    const elsewhere = await runningClock(mechanicId, jc.id);
    if (elsewhere) {
      const pauseOther = req.body?.pause_other === true || req.body?.pause_other === 'true';
      if (!pauseOther) {
        return res.status(409).json({
          success: false, code: 'CLOCK_RUNNING_ELSEWHERE',
          message: `Time is running on ${elsewhere.work_order_number} / ${elsewhere.job_card_number}. Pause it and start here?`,
          running: { job_card_id: elsewhere.job_card_id, job_card_number: elsewhere.job_card_number, work_order_number: elsewhere.work_order_number },
        });
      }
      const paused = await query(
        'SELECT DISTINCT job_card_id FROM technician_time_logs WHERE mechanic_id = ? AND clock_out IS NULL AND job_card_id <> ?', [mechanicId, jc.id]);
      await execute(
        `UPDATE technician_time_logs SET clock_out = NOW(), end_reason = 'pause', pause_reason = 'other_job'
          WHERE mechanic_id = ? AND clock_out IS NULL AND job_card_id <> ?`, [mechanicId, jc.id]);
      for (const p of paused) {
        await logAudit(req.workshopId, req.user.id, 'TIME_PAUSE', 'job_cards', p.job_card_id, null, { mechanic_id: mechanicId, pause_reason: 'other_job', moved_to: jc.id });
      }
    }

    const [mech] = await query('SELECT full_name FROM mechanics WHERE id = ?', [mechanicId]);
    const r = await execute(
      `INSERT INTO technician_time_logs (workshop_id, job_card_id, mechanic_id, mechanic_name, clock_in, activity_notes)
       VALUES (?, ?, ?, ?, NOW(), ?)`,
      [req.workshopId, jc.id, mechanicId, mech?.full_name || null, req.body?.note ? String(req.body.note).slice(0, 500) : null]
    );
    await execute(
      `UPDATE job_cards SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
        WHERE id = ? AND status IN ('open','parts_requested','parts_issued','qc_failed')`, [jc.id]);
    const sync = await syncWorkOrderFromJobCards({ workOrderId: jc.work_order_id, workshopId: req.workshopId, userId: req.user.id, reason: `Work started on ${jc.job_card_number}` });
    await logAudit(req.workshopId, req.user.id, 'TIME_START', 'job_cards', jc.id, null, { mechanic_id: mechanicId });
    res.status(201).json({ success: true, timeLogId: r.insertId, message: 'Time started', work_order: sync });
  } catch (err) {
    console.error('POST /job-cards/:id/time/start error:', err);
    res.status(500).json({ success: false, message: 'Failed to start time' });
  }
});

// POST /api/job-cards/:id/time/pause  { mechanic_id?, reason?, note? }
// POST /api/job-cards/:id/time/stop   { mechanic_id? }
// The pause reason (lib/status-labels.js PAUSE_REASONS; 'other' needs a note)
// is optional here so the Team Board can pause without one; the technician
// app always sends it. It is written on the booking being closed.
for (const action of ['pause', 'stop']) {
  router.post(`/:id/time/${action}`, async (req, res) => {
    try {
      const jc = await loadJobCard(req.params.id, req.workshopId);
      if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });
      if (req.user.role !== 'mechanic' && !can(req.user, 'time.book')) {
        return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Time is booked by the technician, or the Team Leader / Supervisor / Foreman for them.' });
      }
      const pause = action === 'pause' ? parsePauseInput(req.body) : { reason: null, note: null };
      if (pause.ok === false) return res.status(400).json({ success: false, code: pause.code, message: pause.message });
      const mechanicId = await bookingMechanicId(req, jc);
      if (!mechanicId) return res.status(400).json({ success: false, message: 'Which technician? mechanic_id required.' });
      const r = await execute(
        `UPDATE technician_time_logs SET clock_out = NOW(), end_reason = ?, pause_reason = ?, end_note = ?
          WHERE job_card_id = ? AND mechanic_id = ? AND clock_out IS NULL`,
        [action, pause.reason, pause.note, jc.id, mechanicId]
      );
      if (!r.affectedRows) {
        // Stop while paused: the pause becomes the end of the booking.
        const p = action === 'stop' ? await execute(
          `UPDATE technician_time_logs SET end_reason = 'stop'
            WHERE id = (SELECT id FROM (SELECT id FROM technician_time_logs WHERE job_card_id = ? AND mechanic_id = ? ORDER BY clock_in DESC LIMIT 1) x)
              AND end_reason = 'pause'`, [jc.id, mechanicId]) : { affectedRows: 0 };
        if (!p.affectedRows) return res.status(409).json({ success: false, message: 'No running time for this technician on this job card.' });
      }
      const [t] = await query(
        'SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, clock_in, clock_out)), 0) AS minutes FROM technician_time_logs WHERE job_card_id = ? AND mechanic_id = ?',
        [jc.id, mechanicId]
      );
      await logAudit(req.workshopId, req.user.id, action === 'pause' ? 'TIME_PAUSE' : 'TIME_STOP', 'job_cards', jc.id, null,
        action === 'pause' ? { mechanic_id: mechanicId, pause_reason: pause.reason } : { mechanic_id: mechanicId });
      res.json({ success: true, message: action === 'pause' ? 'Time paused' : 'Time stopped', total_minutes: Number(t.minutes), pause_reason: pause.reason });
    } catch (err) {
      console.error(`POST /job-cards/:id/time/${action} error:`, err);
      res.status(500).json({ success: false, message: `Failed to ${action} time` });
    }
  });
}

// POST /api/job-cards/:id/done — JOB DONE: stop any running time, hand to the quality check
router.post('/:id/done', async (req, res) => {
  try {
    const jc = await loadJobCard(req.params.id, req.workshopId);
    if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });
    if (!await technicianMayActOn(req, jc)) return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Only the assigned technician, or the Team Leader / Supervisor / Foreman, can mark this job card done.' });
    if (!['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_failed'].includes(jc.status)) {
      return res.status(409).json({ success: false, message: `This job card is already ${jc.status.replace('_', ' ')}.` });
    }
    const [logged] = await query('SELECT COUNT(*) AS n FROM technician_time_logs WHERE job_card_id = ?', [jc.id]);
    if (!Number(logged.n)) {
      return res.status(409).json({ success: false, message: 'No time has been booked on this job card. Start and stop the time booking first.' });
    }
    await execute(
      "UPDATE technician_time_logs SET clock_out = NOW(), end_reason = 'stop' WHERE job_card_id = ? AND clock_out IS NULL", [jc.id]);
    await execute("UPDATE job_cards SET status = 'qc_pending', completed_at = NOW() WHERE id = ?", [jc.id]);
    const sync = await syncWorkOrderFromJobCards({ workOrderId: jc.work_order_id, workshopId: req.workshopId, userId: req.user.id, reason: `Job done on ${jc.job_card_number}` });
    await notifyGroups(req.workshopId, QC_ROLES, {
      title: `Ready for quality check: ${jc.work_order_number}`,
      body: `Job card ${jc.job_card_number}${jc.title && jc.parent_job_card_id ? ` (${jc.title})` : ''} is done. Carry out the quality check and test drive.`,
      link: `/work-orders/${jc.work_order_id}`, orderId: jc.work_order_id, icon: '🔍', type: `workflow_job_done_${jc.id}`, exceptUserId: req.user.id,
    });
    await logAudit(req.workshopId, req.user.id, 'JOB_DONE', 'job_cards', jc.id, jc.status, { status: 'qc_pending' });
    res.json({ success: true, message: 'Job done — waiting for the quality check', work_order: sync });
  } catch (err) {
    console.error('POST /job-cards/:id/done error:', err);
    res.status(500).json({ success: false, message: 'Failed to mark the job done' });
  }
});

// POST /api/job-cards/:id/qc — quality check incl. test drive (Step 7.1)
// Body: { checklist_items: [{key, item, passed, notes}], overall_result: passed|failed, inspector_notes }
router.post('/:id/qc', async (req, res) => {
  try {
    if (!can(req.user, 'qc.perform')) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'The quality check is done by the Supervisor, Foreman or Team Leader.' });
    }
    const { checklist_items, overall_result, inspector_notes } = req.body;
    if (!Array.isArray(checklist_items) || !checklist_items.length || !['passed', 'failed'].includes(overall_result)) {
      return res.status(400).json({ success: false, message: 'checklist_items and overall_result (passed or failed) are required' });
    }
    // Both check points must pass (repair correct, test drive); the third
    // point is the inspector's comments.
    const byKey = Object.fromEntries(checklist_items.map(i => [i.key, i]));
    const notOk = QC_CHECKLIST.filter(c => c.type === 'check' && !byKey[c.key]?.passed);
    if (overall_result === 'passed' && notOk.some(c => c.key === 'test_drive')) {
      return res.status(400).json({ success: false, message: 'The quality check cannot pass without the test drive.' });
    }
    if (overall_result === 'passed' && notOk.length) {
      return res.status(400).json({ success: false, message: `Not OK: ${notOk.map(c => c.label).join(', ')} — record the quality check as failed.` });
    }
    const comments = String(byKey.other_issues?.notes || inspector_notes || '').trim();
    if (overall_result === 'failed' && !comments) {
      return res.status(400).json({ success: false, message: 'Say what failed, so the Team Leader knows what to rework.' });
    }

    const jc = await loadJobCard(req.params.id, req.workshopId);
    if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });
    if (jc.status !== 'qc_pending') {
      return res.status(409).json({ success: false, message: 'The job card must be marked done before the quality check.' });
    }

    const items = checklist_items.slice(0, 40).map(i => ({
      key: String(i.key || '').slice(0, 40) || null, item: String(i.item || i.label || '').slice(0, 200),
      passed: !!i.passed, notes: i.notes ? String(i.notes).slice(0, 300) : null,
    }));
    await execute('DELETE FROM qc_checklists WHERE job_card_id = ?', [jc.id]);
    await execute(
      `INSERT INTO qc_checklists (workshop_id, job_card_id, inspector_id, checklist_items, overall_result, inspector_notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.workshopId, jc.id, req.user.id, JSON.stringify(items), overall_result, comments ? comments.slice(0, 2000) : null]
    );
    const newStatus = overall_result === 'passed' ? 'qc_passed' : 'qc_failed';
    await execute(
      `UPDATE job_cards SET status = ?, qc_inspector_id = ?, qc_notes = ?,
              qc_passed_at = CASE WHEN ? = 'passed' THEN NOW() ELSE NULL END
        WHERE id = ? AND workshop_id = ?`,
      [newStatus, req.user.id, comments || null, overall_result, jc.id, req.workshopId]
    );

    if (overall_result === 'failed') {
      await notifyGroups(req.workshopId, ['team_leader', 'supervisor'], {
        title: `Quality check failed: ${jc.work_order_number}`,
        body: `Job card ${jc.job_card_number}: ${comments.slice(0, 160)}`,
        link: `/work-orders/${jc.work_order_id}`, orderId: jc.work_order_id, icon: '⚠️', type: `workflow_qc_failed_${jc.id}`, exceptUserId: req.user.id,
      });
      if (jc.mechanic_id) {
        await notifyMechanic(req.workshopId, jc.mechanic_id, {
          title: `Rework needed: ${jc.work_order_number}`, body: comments.slice(0, 200),
          jobCardId: jc.id, orderId: jc.work_order_id, type: `workflow_qc_failed_${jc.id}`,
        });
      }
    }
    const sync = await syncWorkOrderFromJobCards({
      workOrderId: jc.work_order_id, workshopId: req.workshopId, userId: req.user.id,
      reason: `Quality check ${overall_result} on ${jc.job_card_number}`,
    });
    await logAudit(req.workshopId, req.user.id, 'QC', 'job_cards', jc.id, 'qc_pending', { overall_result });
    res.json({ success: true, message: overall_result === 'passed' ? 'Quality check passed' : 'Quality check failed — sent back for rework', new_status: newStatus, work_order: sync });
  } catch (err) {
    console.error('POST /job-cards/:id/qc error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit QC' });
  }
});

// POST /api/job-cards/:id/requisitions — raise a material requisition; the Store is notified
// Body: { items: [{ description, part_number, quantity }], notes }
router.post('/:id/requisitions', async (req, res) => {
  try {
    const jc = await loadJobCard(req.params.id, req.workshopId);
    if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });
    if (!await technicianMayActOn(req, jc, 'parts.request')) return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Parts are requested by the assigned technician, the floor or the Service Advisor.' });
    if (['completed', 'cancelled'].includes(jc.wo_status)) return res.status(409).json({ success: false, message: `This job is ${jc.wo_status}.` });
    const items = (Array.isArray(req.body?.items) ? req.body.items : [])
      .map(i => ({ description: String(i.description || '').trim().slice(0, 500), part_number: i.part_number ? String(i.part_number).slice(0, 100) : null, quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1 }))
      .filter(i => i.description);
    if (!items.length) return res.status(400).json({ success: false, message: 'Add at least one part.' });

    const reqNumber = `MR-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900) + 100}`;
    const r = await execute(
      `INSERT INTO material_requisitions (workshop_id, req_number, job_card_id, requested_by, status, notes) VALUES (?, ?, ?, ?, 'pending', ?)`,
      [req.workshopId, reqNumber, jc.id, req.user.id, req.body?.notes ? String(req.body.notes).slice(0, 1000) : null]
    );
    for (const i of items) {
      await execute(
        `INSERT INTO material_requisition_items (requisition_id, part_number, description, quantity_requested) VALUES (?, ?, ?, ?)`,
        [r.insertId, i.part_number, i.description, i.quantity]
      );
    }
    await notifyGroups(req.workshopId, ['storekeeper'], {
      title: `Material requisition ${reqNumber}`,
      body: `${jc.work_order_number} / ${jc.job_card_number}: ${items.map(i => `${i.quantity} × ${i.description}`).join(', ').slice(0, 180)}. Check the shelf.`,
      link: '/store', orderId: jc.work_order_id, icon: '📦', type: `workflow_requisition_${r.insertId}`, exceptUserId: req.user.id,
    });
    await logAudit(req.workshopId, req.user.id, 'CREATE', 'material_requisitions', r.insertId, null, { req_number: reqNumber, job_card_id: jc.id });
    res.status(201).json({ success: true, requisitionId: r.insertId, req_number: reqNumber });
  } catch (err) {
    console.error('POST /job-cards/:id/requisitions error:', err);
    res.status(500).json({ success: false, message: 'Failed to raise the requisition' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/job-cards/productivity — technician KPIs (req 81)
// ══════════════════════════════════════════════════════════════
router.get('/stats/productivity', staffOnly, async (req, res) => {
  try {
    const { from, to, mechanic_id } = req.query;
    let sql = `
      SELECT
        ttl.mechanic_id,
        ttl.mechanic_name,
        COUNT(DISTINCT ttl.job_card_id)        AS jobs_worked,
        SUM(ttl.elapsed_minutes)               AS total_minutes,
        ROUND(SUM(ttl.elapsed_minutes)/60,2)   AS total_hours,
        COUNT(CASE WHEN ttl.elapsed_minutes IS NOT NULL THEN 1 END) AS completed_sessions,
        -- First-time-fix rate: QC passed on first attempt
        (SELECT COUNT(*) FROM job_cards jc2
         WHERE jc2.workshop_id = ? AND jc2.status = 'qc_passed'
           AND jc2.id IN (SELECT job_card_id FROM technician_time_logs WHERE mechanic_id = ttl.mechanic_id)
        ) AS qc_passed_count
      FROM technician_time_logs ttl
      WHERE ttl.workshop_id = ? AND ttl.clock_out IS NOT NULL
    `;
    const params = [req.workshopId, req.workshopId];
    if (from) { sql += ' AND DATE(ttl.clock_in) >= ?'; params.push(from); }
    if (to)   { sql += ' AND DATE(ttl.clock_in) <= ?'; params.push(to); }
    if (mechanic_id) { sql += ' AND ttl.mechanic_id = ?'; params.push(mechanic_id); }
    sql += ' GROUP BY ttl.mechanic_id, ttl.mechanic_name ORDER BY total_hours DESC';

    const rows = await query(sql, params);
    res.json({ success: true, productivity: rows });
  } catch (err) {
    console.error('GET /job-cards/stats/productivity error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch productivity stats' });
  }
});

// ══════════════════════════════════════════════════════════════
// LOANER VEHICLE MANAGEMENT (req 83)
// ══════════════════════════════════════════════════════════════

// GET /api/job-cards/loaners — list loaner vehicles
router.get('/loaners/list', staffOnly, async (req, res) => {
  try {
    const rows = await query(
      `SELECT lv.*, la.customer_name AS current_customer, la.issued_at AS current_issued_at
       FROM loaner_vehicles lv
       LEFT JOIN loaner_agreements la ON la.loaner_vehicle_id = lv.id AND la.status = 'active'
       WHERE lv.workshop_id = ?
       ORDER BY lv.status, lv.plate_number`,
      [req.workshopId]
    );
    res.json({ success: true, loaners: rows });
  } catch (err) {
    console.error('GET /loaners error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch loaners' });
  }
});

// POST /api/job-cards/loaners — add loaner vehicle to fleet
router.post('/loaners', staffOnly, async (req, res) => {
  try {
    const { plate_number, make, model, year } = req.body;
    if (!plate_number) return res.status(400).json({ success: false, message: 'plate_number required' });
    const result = await execute(
      'INSERT INTO loaner_vehicles (workshop_id, plate_number, make, model, year) VALUES (?,?,?,?,?)',
      [req.workshopId, plate_number, make || null, model || null, year || null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('POST /loaners error:', err);
    res.status(500).json({ success: false, message: 'Failed to add loaner' });
  }
});

// POST /api/job-cards/:id/issue-loaner — issue a loaner to a job
router.post('/:id/issue-loaner', staffOnly, async (req, res) => {
  try {
    const { loaner_vehicle_id, customer_name, odometer_out, fuel_level_out } = req.body;
    if (!loaner_vehicle_id) return res.status(400).json({ success: false, message: 'loaner_vehicle_id required' });

    const [lv] = await query(
      'SELECT * FROM loaner_vehicles WHERE id = ? AND workshop_id = ? AND status = "available"',
      [loaner_vehicle_id, req.workshopId]
    );
    if (!lv) return res.status(409).json({ success: false, message: 'Loaner not available' });

    const [jc] = await query('SELECT customer_id FROM job_cards WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });

    await execute(
      `INSERT INTO loaner_agreements
         (workshop_id, loaner_vehicle_id, job_card_id, customer_id, customer_name,
          issued_at, odometer_out, fuel_level_out, status, issued_by)
       VALUES (?,?,?,?,?,NOW(),?,?,'active',?)`,
      [req.workshopId, loaner_vehicle_id, req.params.id, jc.customer_id,
       customer_name || null, odometer_out || null, fuel_level_out || null, req.user?.id]
    );

    await execute(
      'UPDATE loaner_vehicles SET status = "on_loan", current_job_card_id = ? WHERE id = ?',
      [req.params.id, loaner_vehicle_id]
    );

    res.json({ success: true, message: 'Loaner issued' });
  } catch (err) {
    console.error('POST /job-cards/:id/issue-loaner error:', err);
    res.status(500).json({ success: false, message: 'Failed to issue loaner' });
  }
});

// POST /api/job-cards/:id/return-loaner — return loaner vehicle
router.post('/:id/return-loaner', staffOnly, async (req, res) => {
  try {
    const { loaner_vehicle_id, odometer_in, fuel_level_in, notes } = req.body;

    await execute(
      `UPDATE loaner_agreements SET status = 'returned', returned_at = NOW(),
       odometer_in = ?, fuel_level_in = ?, notes = ?, returned_to = ?
       WHERE job_card_id = ? AND loaner_vehicle_id = ? AND status = 'active'`,
      [odometer_in || null, fuel_level_in || null, notes || null, req.user?.id,
       req.params.id, loaner_vehicle_id]
    );

    await execute(
      'UPDATE loaner_vehicles SET status = "available", current_job_card_id = NULL WHERE id = ?',
      [loaner_vehicle_id]
    );

    res.json({ success: true, message: 'Loaner returned' });
  } catch (err) {
    console.error('POST /job-cards/:id/return-loaner error:', err);
    res.status(500).json({ success: false, message: 'Failed to return loaner' });
  }
});

export default router;
