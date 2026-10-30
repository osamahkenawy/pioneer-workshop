/**
 * /api/vehicle-board — the Vehicle Status Board (it replaces Service
 * Tracking): every car in the workshop, by process step (Steps 1–7), and
 * who it is waiting on. Read-only; every action happens on the job card.
 *
 *   GET /   ?phase=&q=&class=&sub=&department=&team_leader_id=&late=1&include_legacy=1
 *
 * Which jobs: every open work order in the Steps 1–7 process, plus those
 * closed today — an external customer's job without its job card yet (it
 * waits for the physical inspection) in Reception. An open work order with
 * no job card at all, opened before the workshop's first job card (imported
 * from the old system, never worked here — lib/job-phase.js isLegacyJob), is
 * hidden unless include_legacy=1; counts.legacy_hidden says how many,
 * data.process_live_since from when.
 *
 * One SQL statement loads every row with its job cards, clock, estimate,
 * parts, invoice, pickup call, gate pass and booking (grouped joins over the
 * board's work orders); lib/job-phase.js then places each car. No
 * buildWorkflow() per row — the board's side panel loads that for one job
 * (GET /api/workflow/work-orders/:id).
 *
 * Times: DATETIMEs are naive strings on the database clock (lib/database.js).
 * The query sends each as "seconds before the database's NOW()", and this
 * file turns that into an instant against its own clock, so the board is
 * right whatever time zone the database runs in.
 *
 * Technicians and customers get 403, and so does a role row without the
 * 'service-status' module (the Store roles). Managers and accounts with no
 * role row may call it; the front end shows the page on the same module.
 */
import express from 'express';
import { gzipSync } from 'zlib';
import { query } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { effectiveRole, isManagerRole } from '../lib/roles.js';
import { jobClassification, departmentFor, paymentSettled, UNPRICED_PART_SQL } from '../lib/workflow.js';
import { pauseReasonLabel } from '../lib/status-labels.js';
import { extractStatusToken } from '../lib/customer-link.js';
import {
  PHASES, PHASE_LABELS, PHASE_STEPS, WHO, LATE_MINUTES, boardPhase, isLate, isLegacyJob, JC_WORK_DONE, JC_QC_PASSED,
} from '../lib/job-phase.js';

const router = express.Router();
router.use(authMiddleware);

const DEPARTMENTS = ['mechanical', 'body_paint', 'electrical', 'tyres', 'other'];
const CLASSES = ['internal', 'external'];
const SUBCATEGORIES = ['fleet', 'insurance', 'asset', 'walkin'];

// The board is for the people who run the floor and the front desk.
router.use((req, res, next) => {
  const role = effectiveRole(req.user);
  if (req.user?.role === 'customer' || role === 'customer' || (role === 'technician' && !isManagerRole(req.user))) {
    return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'The Vehicle Status Board is for workshop staff.' });
  }
  // A role row without the board's module (the Store roles) is refused too:
  // the items carry customer names, phones and status links. Accounts with no
  // role row, and managers, keep it.
  if (Array.isArray(req.user?.role_modules) && !req.user.role_modules.includes('service-status') && !isManagerRole(req.user)) {
    return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'The Vehicle Status Board is not part of your role.' });
  }
  next();
});

/** Managers and Supervisors may narrow the board to one Team Leader's team. */
const canFilterTeam = user => isManagerRole(user) || effectiveRole(user) === 'supervisor';

// technician_time_logs.pause_reason arrives with the technician app's
// migration; until it has run the board shows "Paused" without a reason.
let pauseReasonColumn = null;
async function hasPauseReason() {
  if (pauseReasonColumn === null) {
    const [row] = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technician_time_logs' AND COLUMN_NAME = 'pause_reason'`);
    // Only a found column is remembered: the migration may still run while the server is up.
    if (Number(row.n)) pauseReasonColumn = true;
    return Number(row.n) > 0;
  }
  return pauseReasonColumn;
}

const inList = list => list.map(s => `'${s}'`).join(',');
/** Seconds between a DATETIME column and the database's NOW() (null stays null). */
const ago = col => `TIMESTAMPDIFF(SECOND, ${col}, NOW())`;

// Part lines the Storekeeper has still to price in the customer's
// categories — the same rule as "Your tasks" (lib/workflow.js UNPRICED_PART_SQL:
// `l` the line, `e` its estimate).
const UNPRICED_PART = UNPRICED_PART_SQL;

function boardSql(withPauseReason) {
  return `
  WITH board AS (
    SELECT wo.id FROM work_orders wo
     WHERE wo.workshop_id = ?
       AND (wo.status NOT IN ('completed','cancelled') OR (wo.status = 'completed' AND wo.completed_at >= CURDATE()))
  ),
  cards AS (
    SELECT jc.work_order_id,
           COUNT(*) AS n,
           SUM(jc.parent_job_card_id IS NOT NULL) AS subs,
           SUM(jc.status IN (${inList(JC_WORK_DONE)})) AS done,
           SUM(jc.status IN (${inList(JC_QC_PASSED)})) AS passed,
           SUM(jc.status = 'qc_pending') AS qc_pending,
           SUM(jc.status = 'qc_failed') AS qc_failed,
           MIN(CASE WHEN jc.parent_job_card_id IS NULL THEN jc.id END) AS main_id,
           GROUP_CONCAT(jc.job_card_number ORDER BY jc.parent_job_card_id IS NOT NULL, jc.id SEPARATOR ',') AS numbers,
           GROUP_CONCAT(DISTINCT jc.department) AS departments,
           GROUP_CONCAT(DISTINCT jc.mechanic_id) AS mechanic_ids,
           ${ago('MAX(jc.completed_at)')} AS last_done_ago,
           ${ago('MAX(jc.qc_passed_at)')} AS last_passed_ago,
           ${ago("MAX(CASE WHEN jc.status = 'qc_failed' THEN jc.updated_at END)")} AS failed_ago
      FROM job_cards jc JOIN board b ON b.id = jc.work_order_id
     WHERE jc.status <> 'cancelled'
     GROUP BY jc.work_order_id
  ),
  clock AS (
    SELECT jc.work_order_id, COUNT(*) AS sessions, SUM(t.clock_out IS NULL) AS running,
           ${ago('MIN(CASE WHEN t.clock_out IS NULL THEN t.clock_in END)')} AS running_ago,
           MAX(t.id) AS last_id
      FROM technician_time_logs t
      JOIN job_cards jc ON jc.id = t.job_card_id AND jc.status <> 'cancelled'
      JOIN board b ON b.id = jc.work_order_id
     GROUP BY jc.work_order_id
  ),
  est_ids AS (
    SELECT e.id, e.intake_work_order_id AS wo_id FROM service_estimates e JOIN board b ON b.id = e.intake_work_order_id
     WHERE e.workshop_id = ?
    UNION
    SELECT e.id, e.work_order_id AS wo_id FROM service_estimates e JOIN board b ON b.id = e.work_order_id
     WHERE e.workshop_id = ?
  ),
  est AS (
    SELECT x.wo_id, e.id, e.status, e.customer_type, e.internal_approved_at, e.customer_approved_at,
           ${ago('e.created_at')} AS created_ago, ${ago('e.updated_at')} AS updated_ago,
           ${ago('e.sent_to_customer_at')} AS sent_ago, ${ago('e.customer_approved_at')} AS approved_ago,
           ROW_NUMBER() OVER (PARTITION BY x.wo_id ORDER BY x.id DESC) AS rn
      FROM est_ids x JOIN service_estimates e ON e.id = x.id
  ),
  est_lines AS (
    SELECT l.estimate_id, SUM(l.line_type <> 'discount') AS line_count,
           SUM(${UNPRICED_PART}) AS unpriced_parts,
           SUM(l.line_type = 'labour' AND (l.unit_price IS NULL OR l.unit_price <= 0)) AS unpriced_labour
      FROM estimate_lines l JOIN est ON est.id = l.estimate_id AND est.rn = 1
      JOIN service_estimates e ON e.id = l.estimate_id
     GROUP BY l.estimate_id
  ),
  items AS (
    SELECT i.work_order_id, COUNT(*) AS n FROM work_order_items i JOIN board b ON b.id = i.work_order_id GROUP BY i.work_order_id
  ),
  insp AS (
    SELECT vi.work_order_id, MAX(vi.status = 'completed') AS completed,
           MAX(vi.status = 'completed' AND (vi.signed_at IS NOT NULL OR vi.entry_mode = 'document')) AS acknowledged
      FROM vehicle_inspections vi JOIN board b ON b.id = vi.work_order_id
     WHERE vi.inspection_type = 'intake'
     GROUP BY vi.work_order_id
  ),
  parts AS (
    SELECT jc.work_order_id, COUNT(*) AS waiting,
           DATE_FORMAT(MIN(CASE WHEN i.availability = 'not_available' THEN i.expected_date END), '%Y-%m-%d') AS eta
      FROM material_requisition_items i
      JOIN material_requisitions r ON r.id = i.requisition_id AND r.status <> 'cancelled'
      JOIN job_cards jc ON jc.id = r.job_card_id AND jc.status <> 'cancelled'
      JOIN board b ON b.id = jc.work_order_id
     WHERE i.availability <> 'available' AND i.status NOT IN ('cancelled','returned')
       AND COALESCE(i.quantity_issued, 0) < i.quantity_requested
     GROUP BY jc.work_order_id
  ),
  inv AS (
    SELECT i.work_order_id, i.invoice_number, i.status, i.total_amount, i.amount_paid,
           ROW_NUMBER() OVER (PARTITION BY i.work_order_id ORDER BY i.id DESC) AS rn
      FROM invoices i JOIN board b ON b.id = i.work_order_id
     WHERE i.workshop_id = ? AND i.status NOT IN ('void','cancelled')
  ),
  logs AS (
    SELECT sl.work_order_id, ${ago('MAX(sl.created_at)')} AS last_ago,
           ${ago("MAX(CASE WHEN sl.status = 'ready_for_pickup' THEN sl.created_at END)")} AS ready_ago
      FROM work_order_status_logs sl JOIN board b ON b.id = sl.work_order_id
     GROUP BY sl.work_order_id
  )
  SELECT wo.id, wo.work_order_number, wo.status, wo.customer_id, wo.customer_name, wo.customer_phone, wo.description,
         wo.vehicle_id, wo.mechanic_id, wo.billing_basis, wo.payer_type, wo.service_fee, wo.service_category,
         wo.service_status_token, wo.intake_customer_class, wo.intake_customer_subcategory,
         wo.customer_approved_at IS NOT NULL AS wo_approved, wo.intake_inspection_at IS NOT NULL AS wo_inspected,
         ${ago('wo.created_at')} AS created_ago, ${ago('wo.completed_at')} AS completed_ago,
         ${ago('wo.customer_approved_at')} AS approved_ago, ${ago('wo.intake_inspection_at')} AS inspected_ago,
         c.full_name AS customer_full_name, c.phone AS customer_phone_ref, c.customer_class, c.customer_subcategory,
         v.plate_number, v.make, v.model, v.year, v.color, v.vin,
         cards.n AS card_count, cards.subs, cards.done, cards.passed, cards.qc_pending, cards.qc_failed,
         cards.numbers, cards.departments, cards.mechanic_ids, cards.last_done_ago, cards.last_passed_ago, cards.failed_ago,
         mjc.department AS main_department, mjc.mechanic_id AS main_mechanic_id,
         clock.sessions, clock.running, clock.running_ago,
         lt.end_reason AS last_end_reason, ${ago('lt.clock_out')} AS last_out_ago,
         ${withPauseReason ? 'lt.pause_reason' : 'NULL'} AS last_pause_reason,
         est.id AS est_id, est.status AS est_status, est.customer_type AS est_customer_type,
         est.internal_approved_at IS NOT NULL AS est_internal_approved, est.customer_approved_at IS NOT NULL AS est_customer_approved,
         est.created_ago AS est_created_ago, est.updated_ago AS est_updated_ago, est.sent_ago AS est_sent_ago,
         est.approved_ago AS est_approved_ago,
         est_lines.line_count AS est_line_count, est_lines.unpriced_parts, est_lines.unpriced_labour,
         items.n AS item_count, insp.completed AS insp_completed, insp.work_order_id IS NOT NULL AS insp_exists,
         insp.acknowledged AS insp_acknowledged, wo.inspection_override_at IS NOT NULL AS ack_override,
         parts.waiting AS parts_waiting, parts.eta AS parts_eta,
         inv.invoice_number, inv.status AS invoice_status, inv.total_amount AS invoice_total, inv.amount_paid AS invoice_paid,
         EXISTS (SELECT 1 FROM job_cards jx WHERE jx.work_order_id = wo.id) AS any_card,
         EXISTS (SELECT 1 FROM work_order_contacts wc WHERE wc.work_order_id = wo.id AND wc.purpose = 'pickup') AS pickup_contacted,
         EXISTS (SELECT 1 FROM gate_passes gp WHERE gp.work_order_id = wo.id AND gp.status = 'released') AS gate_released,
         (SELECT ${ago('a.scheduled_end_at')} FROM work_order_assignments a
           WHERE a.work_order_id = wo.id AND a.is_current = 1 ORDER BY a.id DESC LIMIT 1) AS scheduled_end_ago,
         ${ago('wo.estimated_completion_at')} AS estimated_completion_ago,
         logs.last_ago AS last_log_ago, logs.ready_ago AS ready_log_ago
    FROM board
    JOIN work_orders wo ON wo.id = board.id
    LEFT JOIN customers c ON c.id = wo.customer_id
    LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    LEFT JOIN cards ON cards.work_order_id = wo.id
    LEFT JOIN job_cards mjc ON mjc.id = cards.main_id
    LEFT JOIN clock ON clock.work_order_id = wo.id
    LEFT JOIN technician_time_logs lt ON lt.id = clock.last_id
    LEFT JOIN est ON est.wo_id = wo.id AND est.rn = 1
    LEFT JOIN est_lines ON est_lines.estimate_id = est.id
    LEFT JOIN items ON items.work_order_id = wo.id
    LEFT JOIN insp ON insp.work_order_id = wo.id
    LEFT JOIN parts ON parts.work_order_id = wo.id
    LEFT JOIN inv ON inv.work_order_id = wo.id AND inv.rn = 1
    LEFT JOIN logs ON logs.work_order_id = wo.id`;
}

/**
 * With include_legacy=1 the board is around a thousand cars while imported
 * jobs are still open, and it refreshes every minute, often on a wall TV or a
 * phone: gzip it (the server has no compression middleware).
 */
function sendJson(req, res, body) {
  const json = JSON.stringify(body);
  res.set('Vary', 'Accept-Encoding');
  if (json.length > 8192 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip' });
    return res.send(gzipSync(json));
  }
  return res.type('application/json').send(json);
}

const num = v => (v == null ? 0 : Number(v));
const minutes = secs => (secs == null ? null : Number(secs) / 60);
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
const upperAlnum = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const digits = s => String(s || '').replace(/\D/g, '');

/** One database row → the board's item (before filtering). */
function toItem(row, ctx) {
  const at = secs => (secs == null ? null : new Date(ctx.now - Number(secs) * 1000).toISOString());
  const cardCount = num(row.card_count);
  const cls = jobClassification(row);
  const numbers = row.numbers ? String(row.numbers).split(',') : [];
  const departments = row.departments ? String(row.departments).split(',')
    : [departmentFor(row.service_category)];
  const mechanicIds = [...new Set([row.mechanic_id, row.main_mechanic_id,
    ...(row.mechanic_ids ? String(row.mechanic_ids).split(',') : [])].filter(Boolean).map(Number))];
  const techId = Number(row.mechanic_id || row.main_mechanic_id) || null;
  const tech = techId ? ctx.mechanics.get(techId) : null;

  // Clock across the job's cards: running if any log is open, else how the last one ended.
  const clock = num(row.running) > 0 ? 'running'
    : row.last_end_reason === 'pause' ? 'paused' : row.last_end_reason === 'stop' ? 'stopped' : null;

  // The latest estimate, read the way buildWorkflow() reads it.
  const estimate = row.est_id ? {
    status: row.est_status,
    sentMinutesAgo: minutes(row.est_sent_ago),
    lines: num(row.est_line_count),
    unpricedParts: num(row.unpriced_parts),
    unpricedLabour: num(row.unpriced_labour),
    needsApproval: !(cls.cls === 'internal' || (!cls.cls && row.est_customer_type === 'internal_fleet')) && !num(row.est_internal_approved),
  } : null;
  const approved = !!num(row.wo_approved)
    || (!!estimate && ['approved', 'partially_approved', 'converted'].includes(estimate.status) && !!num(row.est_customer_approved));

  const invoice = row.invoice_number ? { status: row.invoice_status, total_amount: row.invoice_total, amount_paid: row.invoice_paid } : null;
  const legacy = isLegacyJob({ anyCard: !!num(row.any_card), createdAgoSecs: row.created_ago, liveAgoSecs: ctx.liveAgo });
  const onAccount = cls.cls === 'internal' || ['fleet', 'insurance', 'corporate'].includes(row.payer_type);
  const paid = paymentSettled(invoice, { customerClass: cls.cls, payerType: row.payer_type });

  const flags = {
    status: row.status,
    cards: cardCount,
    cardsDone: num(row.done), cardsPassed: num(row.passed), cardsQcPending: num(row.qc_pending), cardsQcFailed: num(row.qc_failed),
    approved,
    hasTechnician: !!techId,
    partsWaiting: num(row.parts_waiting), partsEta: row.parts_eta || null,
    clock, pauseReason: clock === 'paused' ? row.last_pause_reason || null : null,
    pauseReasonLabel: clock === 'paused' ? pauseReasonLabel(row.last_pause_reason) : null,
    timeBooked: num(row.sessions) > 0,
    estimate,
    counterPriced: !estimate && (num(row.item_count) > 0 || Number(row.service_fee) > 0),
    itemised: row.billing_basis === 'itemised',
    classified: !!cls.cls && !!cls.sub,
    vehicleAndIssue: !!row.vehicle_id && !!String(row.description || '').trim(),
    inspection: num(row.insp_completed) || num(row.wo_inspected) ? 'completed' : num(row.insp_exists) ? 'draft' : 'none',
    // Step 3: an external job's card waits for the physical inspection (lib/physical-inspection.js).
    inProcess: !legacy,
    anyCard: !!num(row.any_card),
    physicalNeeded: cls.cls !== 'internal',
    acknowledged: !!num(row.insp_acknowledged) || !!num(row.ack_override),
    pickupContacted: !!num(row.pickup_contacted),
    paid,
    gateReleased: !!num(row.gate_released),
  };
  const placed = boardPhase(flags);

  // When the car came into its column.
  const first = (...xs) => xs.find(x => x != null) ?? null;
  const sinceSecs = !cardCount && placed.phase !== 'closed' ? first(row.last_log_ago, row.created_ago)
    : {
      closed: first(row.completed_ago, row.last_log_ago),
      ready: first(row.ready_log_ago, row.last_passed_ago, row.last_log_ago),
      qc: first(row.last_done_ago, row.last_log_ago),
      work: num(row.qc_failed) ? first(row.failed_ago, row.last_log_ago)
        : first(row.approved_ago, row.est_approved_ago, row.last_log_ago),
      customer: estimate?.status === 'rejected' ? first(row.est_updated_ago) : first(row.est_sent_ago, row.est_created_ago),
      pricing: first(row.est_created_ago, row.inspected_ago),
      intake: null,
    }[placed.phase];
  const since = first(sinceSecs, row.created_ago, 0);
  const ageMinutes = Math.max(0, Math.round(Number(since) / 60));
  const scheduledEnd = row.scheduled_end_ago ?? row.estimated_completion_ago;
  const minutesPastEnd = scheduledEnd == null ? null : Number(scheduledEnd) / 60;

  const total = invoice ? r2(invoice.total_amount) : 0;
  const paidAmount = invoice ? r2(invoice.amount_paid) : 0;

  return {
    id: row.id,
    work_order_number: row.work_order_number,
    status: row.status,
    main_job_card_number: numbers[0] || null,
    sub_cards: num(row.subs),
    job_card_numbers: numbers,
    plate: row.plate_number || null,
    make: row.make || null,
    model: row.model || null,
    year: row.year || null,
    colour: row.color || null,
    vin: row.vin || null,
    customer_name: row.customer_full_name || row.customer_name || null,
    customer_phone: row.customer_phone || row.customer_phone_ref || null,
    customer_class: cls.cls,
    customer_subcategory: cls.sub,
    department: row.main_department || departments[0] || null,
    departments,
    customer_approved: approved,
    phase: placed.phase,
    step: placed.step,
    sub_status: placed.sub_status,
    badges: placed.badges,
    waiting_on: placed.waiting_on,
    technician: techId ? { id: techId, name: tech?.name || null } : null,
    clock: clock === 'running' ? { state: 'running', since: at(row.running_ago) }
      : clock === 'paused' ? { state: 'paused', since: at(row.last_out_ago), reason: flags.pauseReason } : null,
    phase_since: at(since),
    age_minutes: ageMinutes,
    late: isLate(placed.phase, ageMinutes, placed.phase === 'work' ? minutesPastEnd : null),
    expected_ready_at: at(scheduledEnd),
    invoice: invoice ? {
      number: row.invoice_number, status: row.invoice_status, total, paid: paidAmount,
      balance: r2(Math.max(0, total - paidAmount)), on_account: onAccount, settled: paid,
    } : null,
    service_status_token: row.service_status_token || null,
    legacy,
    // for the filters below; not sent
    _mechanicIds: mechanicIds,
  };
}

/** Does the item match the search text? Plate, WO, any job card, customer, phone, VIN, or a pasted status link. */
function matches(item, q) {
  const text = String(q || '').trim();
  if (!text) return true;
  const low = text.toLowerCase();
  const alnum = upperAlnum(text);
  const token = extractStatusToken(text);
  const ph = digits(text);
  if (item.service_status_token && token && item.service_status_token.toLowerCase() === token.toLowerCase()) return true;
  if (alnum && [item.work_order_number, ...item.job_card_numbers, item.plate, item.vin].some(v => v && upperAlnum(v).includes(alnum))) return true;
  if (item.customer_name && item.customer_name.toLowerCase().includes(low)) return true;
  return ph.length >= 4 && !!item.customer_phone && digits(item.customer_phone).includes(ph);
}

// GET /api/vehicle-board
router.get('/', async (req, res) => {
  try {
    const W = req.workshopId;
    const f = req.query;
    const phase = PHASES.includes(f.phase) ? f.phase : null;
    const cls = CLASSES.includes(f.class) ? f.class : null;
    const sub = SUBCATEGORIES.includes(f.sub) ? f.sub : null;
    const department = DEPARTMENTS.includes(f.department) ? f.department : null;
    const teamLeaderId = Number(f.team_leader_id) > 0 ? Number(f.team_leader_id) : null;
    const lateOnly = f.late === '1' || f.late === 'true';
    const includeLegacy = f.include_legacy === '1' || f.include_legacy === 'true';
    const showTeams = canFilterTeam(req.user);

    const withPauseReason = await hasPauseReason();
    const [rows, mechanics, teamLeaders, [live]] = await Promise.all([
      query(boardSql(withPauseReason), [W, W, W, W]),
      query('SELECT id, full_name, team_leader_id FROM mechanics WHERE workshop_id = ?', [W]),
      showTeams ? query(
        `SELECT u.id, u.full_name FROM users u LEFT JOIN roles r ON r.id = u.role_id
          WHERE u.workshop_id = ? AND u.is_active = 1
            AND (r.slug = 'team_leader' OR EXISTS (SELECT 1 FROM mechanics m WHERE m.team_leader_id = u.id AND m.workshop_id = ? AND m.is_active = 1))
          ORDER BY u.full_name`, [W, W]) : [],
      // When the job card process went live here: the workshop's first job card.
      query(`SELECT ${ago('MIN(created_at)')} AS live_ago FROM job_cards WHERE workshop_id = ?`, [W]),
    ]);
    const ctx = {
      now: Date.now(),
      liveAgo: live?.live_ago ?? null,
      mechanics: new Map(mechanics.map(m => [Number(m.id), { name: m.full_name, teamLeaderId: m.team_leader_id ? Number(m.team_leader_id) : null }])),
    };

    let all = rows.map(r => toItem(r, ctx));
    // Every filter except the column and "late only": the tiles count what is left.
    all = all.filter(i => (!cls || i.customer_class === cls)
      && (!sub || i.customer_subcategory === sub)
      && (!department || i.departments.includes(department))
      && (!teamLeaderId || i._mechanicIds.some(id => ctx.mechanics.get(id)?.teamLeaderId === teamLeaderId))
      && matches(i, f.q));
    const legacyHidden = includeLegacy ? 0 : all.filter(i => i.legacy && i.phase !== 'closed').length;
    if (!includeLegacy) all = all.filter(i => !i.legacy || i.phase === 'closed');
    const lateCount = all.filter(i => i.late).length;
    if (lateOnly) all = all.filter(i => i.late);

    const counts = Object.fromEntries(PHASES.map(p => [p === 'closed' ? 'closed_today' : p, 0]));
    for (const i of all) counts[i.phase === 'closed' ? 'closed_today' : i.phase]++;
    counts.in_workshop = all.length - counts.closed_today;
    counts.parts_waiting = all.filter(i => i.phase === 'work' && i.badges.some(b => b.key.startsWith('waiting_parts'))).length;
    counts.late = lateCount;
    counts.legacy_hidden = legacyHidden;

    // Oldest in the column first — jobs worked on job cards ahead of imported
    // ones with none, which would otherwise bury them.
    const noCard = i => (i.main_job_card_number ? 0 : 1);
    const items = (phase ? all.filter(i => i.phase === phase) : all)
      .sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || noCard(a) - noCard(b)
        || b.age_minutes - a.age_minutes || a.id - b.id)
      .map(({ _mechanicIds, ...item }) => item);

    sendJson(req, res, {
      success: true,
      data: {
        generated_at: new Date(ctx.now).toISOString(),
        // Older open jobs with no job card (from before this) are legacy.
        process_live_since: ctx.liveAgo == null ? null : new Date(ctx.now - Number(ctx.liveAgo) * 1000).toISOString(),
        counts,
        items,
        phases: PHASES.map(p => ({ key: p, label: PHASE_LABELS[p], steps: PHASE_STEPS[p], late_minutes: LATE_MINUTES[p] ?? null })),
        who: WHO,
        team_leaders: teamLeaders.map(t => ({ id: t.id, name: t.full_name })),
        you: { can_filter_team: showTeams },
      },
    });
  } catch (err) {
    console.error('GET /vehicle-board error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the Vehicle Status Board' });
  }
});

export default router;
