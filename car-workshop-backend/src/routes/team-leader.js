/**
 * ═══════════════════════════════════════════════════════════════
 *  Team Leader — the board a team leader works from (Steps 6–7).
 *
 *  A job card comes back from the customer's approval and sits waiting for
 *  a technician. The team leader is who puts one on it, and who books the
 *  window that technician is expected to work. The board answers:
 *
 *    1. What is waiting on me? (assign, sub-job cards, QC, rework — the
 *       same queues as "Your tasks", lib/floor-queues.js)
 *    2. Who is on my team, and what is each of them on right now?
 *    3. What is each technician booked for today, and what have they worked?
 *    4. Which job cards are on my team, and what are they waiting for?
 *
 *  Scoping: a team_leader sees their own technicians (mechanics.
 *  team_leader_id = their user id). Anyone above them — GM, workshop
 *  manager, admin — sees "all teams": technicians on a team, holding a live
 *  job card or with time running. They can narrow to one leader with
 *  ?team_leader_id=.
 * ═══════════════════════════════════════════════════════════════
 */
import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { createInvoiceFromWorkOrder } from './invoices.js';
import { onTechnicianAssigned } from '../lib/workflow.js';
import { can, capabilitiesOf, requireCapability } from '../lib/roles.js';
import { customerApprovalMissing } from '../lib/job-card-approval.js';
import {
  ASSIGN_WHERE, AWAITING_CUSTOMER_WHERE, ASSIGN_SUB_WHERE, QC_WHERE, REWORK_WHERE,
} from '../lib/floor-queues.js';

const router = express.Router();

// Job card statuses for POST /assign: waiting ones move to 'assigned';
// closed ones cannot be assigned at all; anything else keeps its status.
const WAITING_STATUSES = ['estimate_approved', 'pending', 'confirmed', 'assigned', 'accepted', 'auto_assign'];
const CLOSED_STATUSES = ['ready_for_pickup', 'completed', 'cancelled'];
router.use(authMiddleware);

/** Job card statuses a technician can book time on. */
const WORKABLE = ['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_failed'];
/** ...plus done-and-waiting-for-QC: still on the team, but nobody is busy with it. */
const LIVE_CARD_STATUSES = [...WORKABLE, 'qc_pending'];

/**
 * Who this request is allowed to see.
 *
 * Returns { scoped: true, leaderId } to restrict to one leader's team, or
 * { scoped: false } for the whole workshop. A team leader is always scoped
 * to themselves and cannot widen it by passing someone else's id — that is
 * the one place this needs to be a rule rather than a filter.
 */
function resolveScope(req) {
  // role_slug, not role: users.role is a fixed enum that has no
  // team_leader value, so the dynamic roles table is the only place this
  // can be read from (see middleware/auth.js).
  const isLeader = req.user?.role_slug === 'team_leader';
  if (isLeader) return { scoped: true, leaderId: req.user.id };

  const requested = req.query.team_leader_id;
  if (requested) return { scoped: true, leaderId: Number(requested) };
  return { scoped: false };
}

// DATETIMEs come back as naive local strings ('YYYY-MM-DD HH:MM:SS', see
// lib/database.js); every one of them is on the database clock, so they are
// compared with each other and with its NOW(), never with Date.now().
const parseDT = s => (s ? new Date(String(s).replace(' ', 'T')) : null);
/** Minutes of [a, b) that fall inside [from, to). */
const overlapMin = (a, b, from, to) => Math.max(0, (Math.min(b, to) - Math.max(a, from)) / 60000);

/**
 * GET /api/team-leader/overview
 * One call, because the board renders as a single screen and several
 * round-trips to paint it would show several different moments in time.
 */
router.get('/overview', async (req, res) => {
  try {
    const W = req.workshopId;
    const isLeader = req.user?.role_slug === 'team_leader';
    const reqLeader = Number(req.query.team_leader_id);
    const scope = isLeader ? { kind: 'team', leaderId: Number(req.user.id) }
      : Number.isInteger(reqLeader) && reqLeader > 0 ? { kind: 'team', leaderId: reqLeader } : { kind: 'all' };
    const canAssign = can(req.user, 'job.assign'), canQc = can(req.user, 'qc.perform');

    // "All teams" is not every technician in the workshop (most are not on a
    // team and have nothing open) — it is the ones the floor is working with.
    const techScope = scope.kind === 'team'
      ? { sql: 'm.team_leader_id = ?', params: [scope.leaderId] }
      : {
          sql: `(m.team_leader_id IS NOT NULL
                 OR EXISTS (SELECT 1 FROM job_cards j JOIN work_orders w ON w.id = j.work_order_id
                             WHERE j.mechanic_id = m.id
                               AND j.status IN ('open','parts_requested','parts_issued','in_progress','qc_failed','qc_pending')
                               AND w.status NOT IN ('completed','cancelled'))
                 OR EXISTS (SELECT 1 FROM technician_time_logs t WHERE t.mechanic_id = m.id AND t.clock_out IS NULL))`,
          params: [],
        };

    // A queue is { total, rows }: the total is a COUNT over the same WHERE as
    // the rows, because the rows are capped and a capped list is not a count.
    // null when this user does not work that queue.
    const queue = async (allowed, countSql, rowsSql) => {
      if (!allowed) return null;
      const [[{ n }], rows] = await Promise.all([query(countSql, [W]), query(`${rowsSql} LIMIT 100`, [W])]);
      return { total: Number(n), rows };
    };
    const JC_FROM = `FROM job_cards jc
                     JOIN work_orders wo ON wo.id = jc.work_order_id
                     LEFT JOIN vehicles v ON v.id = wo.vehicle_id`;

    const [[clock], teams, technicians, assign, assignSub, qc, rework, awaitingCustomer] = await Promise.all([
      query('SELECT NOW() AS now, CURDATE() AS today'),

      // ── Teams a manager can switch between ──────────────────────────
      // Every team leader, with or without technicians yet, so a manager can
      // build a team from here.
      isLeader ? [] : query(
        `SELECT u.id AS leader_id, u.full_name AS leader_name, COUNT(m.id) AS technicians
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           LEFT JOIN mechanics m ON m.team_leader_id = u.id AND m.workshop_id = ? AND m.is_active = 1
          WHERE u.workshop_id = ? AND u.is_active = 1 AND (r.slug = 'team_leader' OR m.id IS NOT NULL)
          GROUP BY u.id, u.full_name ORDER BY u.full_name`,
        [W, W]
      ),

      // ── The technicians ─────────────────────────────────────────────
      query(
        `SELECT m.id, m.full_name, m.specialty, m.status, (m.user_id IS NOT NULL) AS has_login,
                m.service_bay_id, sb.name AS service_bay_name, m.team_leader_id, u.full_name AS team_leader_name,
                (SELECT MIN(wa.scheduled_start_at) FROM work_order_assignments wa JOIN work_orders w ON w.id = wa.work_order_id
                  WHERE wa.mechanic_id = m.id AND wa.is_current = 1 AND w.status NOT IN ('completed','cancelled')
                    AND wa.scheduled_start_at >= NOW()) AS next_booking_at
           FROM mechanics m
           LEFT JOIN service_bays sb ON sb.id = m.service_bay_id
           LEFT JOIN users u ON u.id = m.team_leader_id
          WHERE m.workshop_id = ? AND m.is_active = 1 AND ${techScope.sql}
          ORDER BY m.full_name LIMIT 300`,
        [W, ...techScope.params]
      ),

      // ── The queues — workshop-wide, like "Your tasks": unassigned work
      //    belongs to no team yet ─────────────────────────────────────────
      queue(canAssign,
        `SELECT COUNT(*) n FROM work_orders wo WHERE ${ASSIGN_WHERE}`,
        `SELECT wo.id, wo.work_order_number, wo.status, wo.customer_name, wo.customer_approved_at, wo.customer_approval_channel,
                TIMESTAMPDIFF(MINUTE, wo.customer_approved_at, NOW()) AS waiting_minutes, wo.customer_approved_at AS since,
                v.make AS vehicle_make, v.model AS vehicle_model, v.year AS vehicle_year, v.plate_number,
                mj.id AS job_card_id, mj.job_card_number, mj.department,
                (SELECT COUNT(*) FROM work_order_items i WHERE i.work_order_id = wo.id) AS line_count,
                (SELECT COALESCE(SUM(i.quantity), 0) FROM work_order_items i WHERE i.work_order_id = wo.id AND i.item_type = 'labour') AS labour_hours,
                (SELECT GROUP_CONCAT(i.name ORDER BY i.id SEPARATOR ' · ') FROM work_order_items i WHERE i.work_order_id = wo.id) AS items_preview,
                (SELECT COUNT(*) FROM job_cards s WHERE s.work_order_id = wo.id AND s.parent_job_card_id IS NOT NULL AND s.status <> 'cancelled') AS sub_count,
                EXISTS (SELECT 1 FROM service_estimates e JOIN estimate_lines l ON l.estimate_id = e.id
                         WHERE e.work_order_id = wo.id AND l.customer_status = 'rejected') AS partial_approval
           FROM work_orders wo
           LEFT JOIN vehicles v ON v.id = wo.vehicle_id
           LEFT JOIN job_cards mj ON mj.main_for_work_order = wo.id
          WHERE ${ASSIGN_WHERE}
          ORDER BY wo.customer_approved_at ASC`),
      queue(canAssign,
        `SELECT COUNT(*) n FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id WHERE ${ASSIGN_SUB_WHERE}`,
        `SELECT jc.id, jc.job_card_number, jc.title, jc.department, jc.status, jc.created_at AS since,
                TIMESTAMPDIFF(MINUTE, jc.created_at, NOW()) AS waiting_minutes,
                wo.id AS work_order_id, wo.work_order_number, wo.customer_name,
                v.make AS vehicle_make, v.model AS vehicle_model, v.plate_number, pm.full_name AS main_mechanic_name
           ${JC_FROM}
           LEFT JOIN mechanics pm ON pm.id = wo.mechanic_id
          WHERE ${ASSIGN_SUB_WHERE}
          ORDER BY jc.created_at`),
      queue(canQc,
        `SELECT COUNT(*) n FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id WHERE ${QC_WHERE}`,
        `SELECT jc.id, jc.job_card_number, jc.title, jc.parent_job_card_id, jc.completed_at AS since,
                TIMESTAMPDIFF(MINUTE, jc.completed_at, NOW()) AS waiting_minutes,
                jc.mechanic_id, m.full_name AS mechanic_name, m.team_leader_id,
                wo.id AS work_order_id, wo.work_order_number, wo.customer_name,
                v.make AS vehicle_make, v.model AS vehicle_model, v.plate_number,
                (SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, t.clock_in, COALESCE(t.clock_out, NOW()))), 0)
                   FROM technician_time_logs t WHERE t.job_card_id = jc.id) AS minutes_booked
           ${JC_FROM}
           LEFT JOIN mechanics m ON m.id = jc.mechanic_id
          WHERE ${QC_WHERE}
          ORDER BY jc.completed_at`),
      queue(canAssign,
        `SELECT COUNT(*) n FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id WHERE ${REWORK_WHERE}`,
        `SELECT jc.id, jc.job_card_number, jc.title, jc.parent_job_card_id,
                COALESCE(q.inspector_notes, jc.qc_notes) AS qc_notes, ui.full_name AS inspector_name,
                COALESCE(q.inspected_at, jc.updated_at) AS since,
                TIMESTAMPDIFF(MINUTE, COALESCE(q.inspected_at, jc.updated_at), NOW()) AS waiting_minutes,
                jc.mechanic_id, m.full_name AS mechanic_name, m.team_leader_id,
                wo.id AS work_order_id, wo.work_order_number, wo.customer_name,
                v.make AS vehicle_make, v.model AS vehicle_model, v.plate_number
           ${JC_FROM}
           LEFT JOIN mechanics m ON m.id = jc.mechanic_id
           LEFT JOIN qc_checklists q ON q.job_card_id = jc.id
           LEFT JOIN users ui ON ui.id = q.inspector_id
          WHERE ${REWORK_WHERE}
          ORDER BY since`),

      // The job cards that will reach the queue once the customer decides —
      // counted so the board can say why something is not there yet.
      canAssign
        ? query(`SELECT COUNT(*) n FROM work_orders wo WHERE ${AWAITING_CUSTOMER_WHERE}`, [W]).then(([r]) => Number(r.n))
        : 0,
    ]);

    // ── What the technicians are on, worked on and booked for ─────────
    const ids = technicians.map(t => t.id);
    const [cardRows, timeToday, bookings] = ids.length ? await Promise.all([
      // Live job cards only: a card left 'open' on a cancelled work order is
      // not on anyone's floor.
      query(
        `SELECT jc.id, jc.job_card_number, jc.title, jc.parent_job_card_id, jc.department, jc.status AS jc_status, jc.mechanic_id,
                jc.created_at, jc.completed_at,
                wo.id AS work_order_id, wo.work_order_number, wo.status AS wo_status, wo.customer_name,
                v.make AS vehicle_make, v.model AS vehicle_model, v.plate_number,
                wa.scheduled_start_at, wa.scheduled_end_at,
                -- the job card's own rule (lib/job-card-approval.js): no time on it yet
                (wo.billing_basis = 'itemised' AND wo.customer_approved_at IS NULL) AS approval_missing,
                (SELECT t.end_reason FROM technician_time_logs t WHERE t.job_card_id = jc.id AND t.mechanic_id = jc.mechanic_id
                  ORDER BY t.clock_in DESC LIMIT 1) AS last_end_reason,
                (SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, t.clock_in, COALESCE(t.clock_out, NOW()))), 0)
                   FROM technician_time_logs t WHERE t.job_card_id = jc.id) AS worked_minutes,
                (SELECT COUNT(*) FROM material_requisition_items i JOIN material_requisitions r ON r.id = i.requisition_id
                  WHERE r.job_card_id = jc.id AND r.status <> 'cancelled' AND i.status NOT IN ('issued','cancelled','returned')) AS parts_waiting,
                (SELECT MIN(i.expected_date) FROM material_requisition_items i JOIN material_requisitions r ON r.id = i.requisition_id
                  WHERE r.job_card_id = jc.id AND r.status <> 'cancelled' AND i.status NOT IN ('issued','cancelled','returned')
                    AND i.availability = 'not_available') AS parts_expected
           FROM job_cards jc
           JOIN work_orders wo ON wo.id = jc.work_order_id
           LEFT JOIN vehicles v ON v.id = wo.vehicle_id
           LEFT JOIN work_order_assignments wa ON wa.work_order_id = wo.id AND wa.mechanic_id = jc.mechanic_id AND wa.is_current = 1
          WHERE jc.workshop_id = ? AND jc.mechanic_id IN (?)
            AND jc.status IN (?)
            AND wo.status NOT IN ('completed','cancelled')
          ORDER BY FIELD(jc.status,'in_progress','qc_failed','parts_issued','parts_requested','open','qc_pending'),
                   wa.scheduled_start_at IS NULL, wa.scheduled_start_at, jc.created_at
          LIMIT 300`,
        [W, ids, LIVE_CARD_STATUSES]
      ),
      // Time booked today, including a log still running from yesterday.
      query(
        `SELECT t.id, t.mechanic_id, t.job_card_id, t.clock_in, t.clock_out, t.end_reason,
                jc.job_card_number, jc.title, jc.parent_job_card_id, wo.id AS work_order_id, wo.work_order_number, v.plate_number
           FROM technician_time_logs t
           JOIN job_cards jc ON jc.id = t.job_card_id
           JOIN work_orders wo ON wo.id = jc.work_order_id
           LEFT JOIN vehicles v ON v.id = wo.vehicle_id
          WHERE t.workshop_id = ? AND t.mechanic_id IN (?)
            AND t.clock_in < CURDATE() + INTERVAL 1 DAY AND (t.clock_out IS NULL OR t.clock_out >= CURDATE())
          ORDER BY t.clock_in`,
        [W, ids]
      ),
      // Booked windows that touch today — including one that started
      // yesterday evening or runs past midnight — on live work orders only.
      query(
        `SELECT wa.work_order_id, wa.mechanic_id, wa.scheduled_start_at, wa.scheduled_end_at,
                wo.work_order_number, wo.status, v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model
           FROM work_order_assignments wa
           JOIN work_orders wo ON wo.id = wa.work_order_id
           LEFT JOIN vehicles v ON v.id = wo.vehicle_id
          WHERE wa.is_current = 1 AND wo.workshop_id = ? AND wa.mechanic_id IN (?)
            AND wo.status NOT IN ('completed','cancelled')
            AND wa.scheduled_start_at IS NOT NULL
            AND wa.scheduled_start_at < CURDATE() + INTERVAL 1 DAY
            AND COALESCE(wa.scheduled_end_at, wa.scheduled_start_at) > CURDATE()
          ORDER BY wa.scheduled_start_at`,
        [W, ids]
      ),
    ]) : [[], [], []];

    // More than one current assignment row for a work order would repeat a card.
    const seen = new Set();
    const openCards = cardRows.filter(c => !seen.has(c.id) && seen.add(c.id));
    for (const c of openCards) {
      c.worked_minutes = Number(c.worked_minutes); c.parts_waiting = Number(c.parts_waiting);
      c.approval_missing = Number(c.approval_missing);
    }

    const names = new Map(technicians.map(t => [t.id, t.full_name]));
    for (const b of bookings) b.mechanic_name = names.get(b.mechanic_id) || null;

    // ── Each technician's state, worked out from job cards and time logs ─
    // mechanics.status is self-reported and drifts (a technician who never
    // flips back to "available" reads busy forever), so it only decides
    // between free and off for someone with nothing open.
    const now = parseDT(clock.now);
    const dayStart = parseDT(`${clock.today} 00:00:00`);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    for (const t of technicians) {
      const cards = openCards.filter(c => c.mechanic_id === t.id);
      const logs = timeToday.filter(l => l.mechanic_id === t.id);
      const mine = bookings.filter(b => b.mechanic_id === t.id);
      const running = logs.filter(l => !l.clock_out).pop() || null;
      // A card still waiting for the customer is on the team but cannot be
      // started (the job card refuses), so it does not make anyone busy.
      const workable = cards.filter(c => WORKABLE.includes(c.jc_status) && !c.approval_missing);
      const paused = !running && workable.find(c => c.last_end_reason === 'pause');

      t.has_login = Number(t.has_login);
      t.state = running ? 'working' : paused ? 'paused' : workable.length ? 'assigned'
        : ['offline', 'on_break'].includes(t.status) ? 'off' : 'free';
      const card = running ? null : paused || workable[0];
      t.current = running ? {
        job_card_id: running.job_card_id, job_card_number: running.job_card_number,
        work_order_id: running.work_order_id, work_order_number: running.work_order_number, plate_number: running.plate_number,
        jc_status: cards.find(c => c.id === running.job_card_id)?.jc_status || 'in_progress', since: running.clock_in,
      } : card ? {
        job_card_id: card.id, job_card_number: card.job_card_number,
        work_order_id: card.work_order_id, work_order_number: card.work_order_number, plate_number: card.plate_number,
        jc_status: card.jc_status, since: null,
      } : null;
      t.open_count = workable.length;
      t.awaiting_qc = cards.filter(c => c.jc_status === 'qc_pending').length;
      t.running_since = running?.clock_in || null;

      let booked = 0, remaining = 0, lastEnd = null;
      for (const b of mine) {
        const a = parseDT(b.scheduled_start_at), e = parseDT(b.scheduled_end_at || b.scheduled_start_at);
        booked += overlapMin(a, e, dayStart, dayEnd);
        remaining += overlapMin(a, e, now, dayEnd);
        if (b.scheduled_end_at && (!lastEnd || b.scheduled_end_at > lastEnd)) lastEnd = b.scheduled_end_at;
      }
      t.booked_min_today = Math.round(booked);
      t.remaining_booked_min = Math.round(remaining);
      t.last_booking_end_today = lastEnd;
      t.worked_min_today = Math.round(logs.reduce(
        (sum, l) => sum + overlapMin(parseDT(l.clock_in), l.clock_out ? parseDT(l.clock_out) : now, dayStart, now), 0));
    }

    // The QC and rework queues are workshop-wide; a leader can narrow them to
    // their own technicians on the board.
    const leaderId = scope.kind === 'team' ? scope.leaderId : null;
    for (const r of [...(qc?.rows || []), ...(rework?.rows || [])]) {
      r.on_my_team = leaderId != null && Number(r.team_leader_id) === leaderId;
    }
    for (const r of qc?.rows || []) r.minutes_booked = Number(r.minutes_booked);
    for (const r of assign?.rows || []) {
      r.items_preview = r.items_preview ? String(r.items_preview).slice(0, 140) : null;
      r.labour_hours = Number(r.labour_hours) || 0;
      r.partial_approval = Number(r.partial_approval);
    }

    const team = scope.kind === 'team' ? teams.find(x => Number(x.leader_id) === scope.leaderId) : null;
    const count = state => technicians.filter(t => t.state === state).length;
    const off = count('off');

    res.json({
      success: true,
      now: clock.now, today: clock.today,
      capabilities: capabilitiesOf(req.user),
      scope: {
        kind: scope.kind,
        team_leader_id: scope.leaderId ?? null,
        team_leader_name: isLeader ? req.user.full_name : team?.leader_name ?? null,
        can_switch: !isLeader,
        all_teams: scope.kind === 'all',
      },
      teams,
      summary: {
        technicians: technicians.length,
        working: count('working'), paused: count('paused'), assigned: count('assigned'), free: count('free'), off,
        booked_today: bookings.length,
        awaiting_assignment: assign?.total ?? 0,
        awaiting_shown: assign?.rows.length ?? 0,
        assign: assign?.total ?? null, assign_sub: assignSub?.total ?? null, qc: qc?.total ?? null, rework: rework?.total ?? null,
        awaiting_customer: awaitingCustomer,
        unavailable: off,
      },
      queues: { assign, assign_sub: assignSub, qc, rework },
      technicians,
      open_cards: openCards,
      time_today: timeToday,
      bookings,
      awaiting: assign?.rows ?? [],
    });
  } catch (err) {
    console.error('GET /team-leader/overview error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the team board' });
  }
});

/**
 * POST /api/team-leader/assign
 * Put a technician on a job card and book their window.
 *
 * Body: { work_order_id, mechanic_id, scheduled_start_at, scheduled_end_at }
 *
 * Writes the same two places the existing assign flow does —
 * work_orders.mechanic_id and a current work_order_assignments row — so a
 * job assigned from this board is indistinguishable downstream from one
 * assigned anywhere else. The booked window is the new part.
 */
router.post('/assign', requireCapability('job.assign'), async (req, res) => {
  try {
    const { work_order_id, mechanic_id, scheduled_start_at, scheduled_end_at } = req.body || {};
    if (!work_order_id || !mechanic_id) {
      return res.status(400).json({ success: false, message: 'work_order_id and mechanic_id are required.' });
    }

    if (scheduled_start_at && scheduled_end_at
        && new Date(scheduled_end_at) <= new Date(scheduled_start_at)) {
      return res.status(400).json({ success: false, message: 'The end of the window must be after its start.' });
    }

    const [workOrder] = await query(
      'SELECT id, work_order_number, status, mechanic_id FROM work_orders WHERE id = ? AND workshop_id = ?',
      [work_order_id, req.workshopId]
    );
    if (!workOrder) return res.status(404).json({ success: false, message: 'Job card not found.' });

    // A finished, released or cancelled job card is not waiting for anyone.
    // Assigning one used to silently re-open it as 'assigned'.
    if (CLOSED_STATUSES.includes(workOrder.status)) {
      return res.status(409).json({
        success: false,
        message: `${workOrder.work_order_number} is ${workOrder.status.replace(/_/g, ' ')} and cannot be assigned.`,
      });
    }

    // Step 6 starts with the customer's decision: an itemised job card they
    // have not approved is not the Team Leader's yet (legacy service_fee work
    // orders were agreed in the old system and pass).
    if (await customerApprovalMissing(work_order_id, req.workshopId)) {
      return res.status(409).json({ success: false, code: 'CUSTOMER_APPROVAL_REQUIRED',
        message: `${workOrder.work_order_number} can't be assigned yet — the customer hasn't approved the work. It comes to the Team Leader after the customer's decision (Step 6).` });
    }

    // The board's queue is shared by every leader and it holds its refreshes
    // while the dialog is open, so it says who it expects to be on the job
    // (nobody). Whoever submits second is told instead of silently replacing
    // the first assignment. Callers that do not send the field are unchanged.
    if (Object.prototype.hasOwnProperty.call(req.body, 'expected_mechanic_id')
        && (Number(workOrder.mechanic_id) || null) !== (Number(req.body.expected_mechanic_id) || null)) {
      const [current] = await query('SELECT full_name FROM mechanics WHERE id = ?', [workOrder.mechanic_id]);
      return res.status(409).json({ success: false, code: 'ALREADY_ASSIGNED',
        message: `${workOrder.work_order_number} was just assigned to ${current?.full_name || 'another technician'}. Refresh the board.` });
    }

    const [mechanic] = await query(
      'SELECT id, full_name, team_leader_id FROM mechanics WHERE id = ? AND workshop_id = ? AND is_active = 1',
      [mechanic_id, req.workshopId]
    );
    if (!mechanic) return res.status(404).json({ success: false, message: 'Technician not found.' });

    // A team leader assigns from their own team. Managers are not limited.
    const scope = resolveScope(req);
    if (scope.scoped && Number(mechanic.team_leader_id) !== Number(scope.leaderId)) {
      return res.status(403).json({
        success: false,
        message: `${mechanic.full_name} is not on your team.`,
      });
    }

    // Overlap check: the point of booking a window is knowing it is free.
    // Reported rather than refused — a leader double-booking deliberately
    // (a quick job inside a long one) is a real thing, and blocking it
    // outright would send them back to assigning with no window at all.
    // Live work orders only: a closed job's leftover booking is no clash.
    let conflict = null;
    if (scheduled_start_at && scheduled_end_at) {
      const [clash] = await query(
        `SELECT wa.work_order_id, wo.work_order_number,
                wa.scheduled_start_at, wa.scheduled_end_at
           FROM work_order_assignments wa
           JOIN work_orders wo ON wo.id = wa.work_order_id
          WHERE wa.mechanic_id = ? AND wa.is_current = 1
            AND wa.work_order_id <> ?
            AND wo.status NOT IN ('completed','cancelled')
            AND wa.scheduled_start_at IS NOT NULL
            AND wa.scheduled_start_at < ?
            AND wa.scheduled_end_at   > ?
          LIMIT 1`,
        [mechanic_id, work_order_id, scheduled_end_at, scheduled_start_at]
      );
      if (clash) conflict = clash;
    }

    // Retire any previous assignment, then write the new one.
    await execute(
      'UPDATE work_order_assignments SET is_current = 0 WHERE work_order_id = ? AND is_current = 1',
      [work_order_id]
    );
    await execute(
      `INSERT INTO work_order_assignments
         (work_order_id, mechanic_id, assigned_by, assigned_at,
          scheduled_start_at, scheduled_end_at, is_current)
       VALUES (?, ?, ?, NOW(), ?, ?, 1)`,
      [work_order_id, mechanic_id, req.user?.id || null,
       scheduled_start_at || null, scheduled_end_at || null]
    );

    // A job card still waiting for someone becomes 'assigned'; one already
    // being worked keeps its status — this is a change of technician, and
    // dropping an in-progress job back to 'assigned' would rewind it.
    const nextStatus = WAITING_STATUSES.includes(workOrder.status) ? 'assigned' : workOrder.status;
    await execute(
      `UPDATE work_orders
          SET mechanic_id = ?, status = ?, updated_at = NOW()
        WHERE id = ? AND workshop_id = ?`,
      [mechanic_id, nextStatus, work_order_id, req.workshopId]
    );
    await execute('UPDATE mechanics SET status = ? WHERE id = ?', ['busy', mechanic_id]);
    await execute(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
      [work_order_id, 'assigned', req.user?.id || null, `Assigned to ${mechanic.full_name} by team leader`]
    );

    // Going straight from estimate_approved/pending to assigned skips the
    // 'confirmed' step, which is where the invoice is raised. Raise it here
    // so a job card can never be worked without one.
    if (['estimate_approved', 'pending', 'confirmed'].includes(workOrder.status)) {
      try {
        await createInvoiceFromWorkOrder(work_order_id, req.workshopId, req.user?.id);
      } catch (invoiceErr) {
        console.error('[TeamLeader] invoice on assign failed:', invoiceErr.message);
      }
    }

    // Step 6: the main job card follows the technician, who is told.
    await onTechnicianAssigned({ workOrderId: Number(work_order_id), workshopId: req.workshopId, mechanicId: Number(mechanic_id) });

    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id,
      action: 'ASSIGN', entityType: 'work_orders', entityId: work_order_id,
      oldValue: workOrder.mechanic_id,
      newValue: { mechanic_id, scheduled_start_at, scheduled_end_at },
    });

    res.json({
      success: true,
      message: `${workOrder.work_order_number} assigned to ${mechanic.full_name}.`,
      conflict,
      technician: { id: mechanic.id, full_name: mechanic.full_name },
      scheduled_start_at: scheduled_start_at || null,
      scheduled_end_at: scheduled_end_at || null,
    });
  } catch (err) {
    console.error('POST /team-leader/assign error:', err);
    res.status(500).json({ success: false, message: 'Failed to assign the job card' });
  }
});

/**
 * GET /api/team-leader/unassigned-technicians
 * Active technicians with no team leader yet — what the "build my team"
 * picker offers. Without this the board is correct and empty on day one,
 * which reads as broken. The picker searches only the list it is sent, so
 * the cap sits well above a workshop's whole pool of technicians.
 */
router.get('/unassigned-technicians', requireCapability('job.assign'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, full_name, phone, specialty, status
         FROM mechanics
        WHERE workshop_id = ? AND is_active = 1 AND team_leader_id IS NULL
        ORDER BY full_name ASC
        LIMIT 1000`,
      [req.workshopId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /team-leader/unassigned-technicians error:', err);
    res.status(500).json({ success: false, message: 'Failed to load technicians' });
  }
});

/**
 * POST /api/team-leader/team
 * Add or remove technicians from a leader's team.
 * Body: { mechanic_ids: [...], team_leader_id?, action: 'add' | 'remove' }
 */
router.post('/team', requireCapability('job.assign'), async (req, res) => {
  try {
    const { mechanic_ids, action = 'add' } = req.body || {};
    if (!Array.isArray(mechanic_ids) || !mechanic_ids.length) {
      return res.status(400).json({ success: false, message: 'Pick at least one technician.' });
    }
    if (!['add', 'remove'].includes(action)) {
      return res.status(400).json({ success: false, message: "action must be 'add' or 'remove'." });
    }

    const scope = resolveScope(req);
    const leaderId = scope.scoped ? scope.leaderId : Number(req.body.team_leader_id) || req.user?.id;
    if (!leaderId) {
      return res.status(400).json({ success: false, message: 'No team leader to assign these technicians to.' });
    }
    // A manager names the team. mechanics.team_leader_id has no foreign key,
    // so the name is checked here: any number would otherwise be accepted.
    if (Number(leaderId) !== Number(req.user?.id)) {
      const [leader] = await query(
        'SELECT id FROM users WHERE id = ? AND workshop_id = ? AND is_active = 1',
        [leaderId, req.workshopId]
      );
      if (!leader) return res.status(400).json({ success: false, message: 'That team leader was not found.' });
    }

    // Only this team's own changes: 'add' takes technicians who are on no
    // team (or already on this one), 'remove' only lets go of this team's —
    // never another leader's technicians.
    const placeholders = mechanic_ids.map(() => '?').join(',');
    const result = action === 'add'
      ? await execute(
        `UPDATE mechanics SET team_leader_id = ?
          WHERE workshop_id = ? AND id IN (${placeholders})
            AND (team_leader_id IS NULL OR team_leader_id = ?)`,
        [leaderId, req.workshopId, ...mechanic_ids, leaderId]
      )
      : await execute(
        `UPDATE mechanics SET team_leader_id = NULL
          WHERE workshop_id = ? AND id IN (${placeholders}) AND team_leader_id = ?`,
        [req.workshopId, ...mechanic_ids, leaderId]
      );

    res.json({
      success: true,
      message: action === 'add'
        ? `${result.affectedRows} technician(s) added to the team.`
        : `${result.affectedRows} technician(s) removed from the team.`,
    });
  } catch (err) {
    console.error('POST /team-leader/team error:', err);
    res.status(500).json({ success: false, message: 'Failed to update the team' });
  }
});

export default router;
