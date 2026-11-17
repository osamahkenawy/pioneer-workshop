/**
 * /api/job-tasks — technicians per job and the scan station (client
 * meeting, 3 Nov 2026, points 14, 16, 17; lib/job-tasks.js).
 *
 *   GET   /?work_order_id=[&team_leader_id=]
 *                                   the work order's jobs (synced with the approved work), the
 *                                   technicians to offer — each with their state now, open jobs,
 *                                   today's booked time, team and skills (lib/technician-availability.js
 *                                   technicianRoster) — what is still missing before anyone can be
 *                                   assigned (customer approval, the parts request) and what the viewer may do
 *   PATCH /:id/technician           { mechanic_id, override?, reason? } — job.assign. Only a technician
 *                                   qualified for the job's service type; a manager may override
 *                                   with a reason (recorded on the job and in the audit log)
 *   POST  /assign                   { work_order_id, assignments: [{ task_id, mechanic_id, override?, reason?,
 *                                   expected_mechanic_id? }], reason?, scheduled_start_at?, scheduled_end_at? }
 *                                   — job.assign. Several jobs in one go (the Team Board's Assign
 *                                   dialog, client feedback 16 Nov 2026 point 4), the same rules as
 *                                   PATCH /:id/technician for each; all or nothing
 *   GET   /parts-request?work_order_id=
 *                                   what the Request parts dialog starts from: the approved parts lines
 *                                   (with part numbers), the main job card and the requisitions already
 *                                   raised (lib/parts-request.js; client feedback point 5) — the MRN itself
 *                                   is POST /api/job-cards/:id/requisitions
 *   PATCH /:id/service-type         { service_type } for a job the technical report does not name — job.assign
 *   POST  /:id/reopen               a finished job back to paused (scanned END by mistake) — job.assign
 *   POST  /scan                     { code, badge? } — the station: a job code starts / ends the job
 *                                   for its technician; a badge code says who is at the station
 *   GET   /station                  the station's settings and today's last scans
 *   PUT   /station                  { badge_required } — managers
 *   GET   /work-orders/:id/sheet    the printed job card with each job's barcode (lib/service-job-sheet.js)
 *
 * The station is a PC with a USB barcode scanner, signed in as floor staff
 * (time.book or job.assign — Team Leader, Supervisor, Foreman, managers).
 * Technicians' own logins do not reach this API (lib/access.js): they work
 * from printed job cards.
 *
 * The whole-job assignment (POST /team-leader/assign for work with no jobs,
 * Job Assignment, PATCH /work-orders/:id/assign-mechanic) is unchanged; a
 * job's first technician on an unassigned work order also becomes the work
 * order's (with the booked window, when one is given), so the boards that
 * read work_orders.mechanic_id keep working.
 */
import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { can, isManagerRole, requireCapability } from '../lib/roles.js';
import { JOB_TYPES } from '../lib/intake-rules.js';
import { notifyMechanic } from '../lib/workflow.js';
import { partsRequestMissing, approvedPartsLines } from '../lib/parts-request.js';
import { customerApprovalMissing, CUSTOMER_APPROVAL_REQUIRED } from '../lib/job-card-approval.js';
import { technicianAvailability, technicianRoster } from '../lib/technician-availability.js';
import { createInvoiceFromWorkOrder } from './invoices.js';
import {
  syncJobTasks, listJobTasks, getJobTask, tasksForSheet, technicianOpenTasks, scanTask,
  normalizeCode, isTaskCode, isBadgeCode, skillsOf, qualifiedFor,
} from '../lib/job-tasks.js';

const router = express.Router();
router.use(authMiddleware);

const anyCapability = caps => (req, res, next) => (caps.some(c => can(req.user, c)) ? next()
  : res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'The scan station is for the floor: Team Leader, Supervisor, Workshop Foreman or a manager.' }));
const STATION = anyCapability(['time.book', 'job.assign']);

/** Work order statuses still waiting for a technician (as the Team Board). */
const WAITING_STATUSES = ['estimate_approved', 'pending', 'confirmed', 'assigned', 'accepted', 'auto_assign'];
const BADGE_SETTING = 'scan_station_badge_required';
/** Jobs per POST /assign. */
const MAX_BATCH = 60;

/** A team leader assigns from their own team (as POST /team-leader/assign). */
const teamLeaderId = req => (req.user?.role_slug === 'team_leader' ? Number(req.user.id) : null);

async function badgeRequired(workshopId) {
  const [row] = await query('SELECT `value` FROM settings WHERE workshop_id = ? AND `key` = ?', [workshopId, BADGE_SETTING]);
  return row?.value === 'true';
}

/* ── The assignment rules, shared by PATCH /:id/technician and POST /assign ── */

/** A refusal in the shape the screens read. */
const refusal = (status, code, message, extra = {}) => ({ status, body: { success: false, ...(code ? { code } : {}), message, ...extra } });

/**
 * May any job of this work order be given a technician now? The job is live,
 * the customer approved the work, the parts were requested (MRN).
 * { wo } or { status, body }.
 */
async function workOrderGate(workOrderId, workshopId) {
  const [wo] = await query(
    'SELECT id, work_order_number, status, mechanic_id FROM work_orders WHERE id = ? AND workshop_id = ?', [workOrderId, workshopId]);
  if (!wo) return refusal(404, null, 'Work order not found');
  if (['completed', 'cancelled'].includes(wo.status)) return refusal(409, 'JOB_CLOSED', `${wo.work_order_number} is ${wo.status}.`);
  if (await customerApprovalMissing(wo.id, workshopId)) return refusal(409, CUSTOMER_APPROVAL_REQUIRED.code, CUSTOMER_APPROVAL_REQUIRED.message);
  // The parts are requested (MRN) before anyone is assigned (lib/parts-request.js).
  const mrn = await partsRequestMissing({ workOrderId: wo.id, workshopId });
  if (mrn) return refusal(409, mrn.code, mrn.message);
  return { wo };
}

/** Can this job take a (new) technician at all? null or a refusal. */
function taskGate(task) {
  if (task.status === 'cancelled') return refusal(409, 'TASK_CANCELLED', `${task.job_name} is no longer part of the approved work.`);
  if (task.status === 'done') return refusal(409, 'TASK_DONE', `${task.job_name} is finished. Reopen it first to give it to someone else.`);
  if (task.running) {
    return refusal(409, 'TASK_RUNNING', `${task.mechanic_name}'s clock is running on ${task.job_name}. It ends with a scan at the station (or start another job) before it is reassigned.`);
  }
  return null;
}

/**
 * May this technician take this job? Available (HR), on the leader's team,
 * qualified for the job's service type — point 16: a manager may assign
 * someone else deliberately, with a reason (override).
 * { overrideReason } or a refusal.
 */
function technicianGate({ req, task, m, avail, override, reason }) {
  if (!avail?.available) return refusal(409, 'TECHNICIAN_UNAVAILABLE', `${m.full_name} is not available (${avail?.reason || 'unknown'}).`);
  const leader = teamLeaderId(req);
  if (leader && Number(m.team_leader_id) !== leader) return refusal(403, 'NOT_YOUR_TEAM', `${m.full_name} is not on your team.`);
  if (qualifiedFor(skillsOf(m), task.service_type)) return { overrideReason: null };
  const typeLabel = JOB_TYPES[task.service_type] || task.service_type;
  const why = skillsOf(m) === null ? `${m.full_name} has no skills recorded yet (Technicians page)` : `${m.full_name} is not qualified for ${typeLabel}`;
  const manager = isManagerRole(req.user);
  const text = String(reason || '').trim().slice(0, 255);
  if (!manager || override !== true || text.length < 3) {
    return refusal(409, 'NOT_QUALIFIED', manager
      ? `${why}. To assign anyway, confirm the override and give the reason.`
      : `${why}. Choose a technician qualified for ${typeLabel}, or ask a manager.`, { can_override: manager });
  }
  return { overrideReason: text };
}

/** Give the job its technician (the job card shows one too, when it had none). */
async function writeTaskTechnician({ req, task, m, overrideReason }) {
  await execute(
    'UPDATE job_card_tasks SET mechanic_id = ?, assigned_by = ?, assigned_at = NOW(), override_reason = ? WHERE id = ? AND workshop_id = ?',
    [m.id, req.user.id, overrideReason, task.id, req.workshopId]);
  await execute('UPDATE job_cards SET mechanic_id = ? WHERE id = ? AND mechanic_id IS NULL', [m.id, task.job_card_id]);
  await logAudit({ workshopId: req.workshopId, userId: req.user.id, action: 'ASSIGN', entityType: 'job_card_tasks', entityId: task.id,
    oldValue: { mechanic_id: task.mechanic_id }, newValue: { mechanic_id: m.id, override_reason: overrideReason } });
}

/**
 * The work order's first technician: written where the existing boards read
 * it (as the Team Board's assign does) with the booked window, if any; the
 * invoice raised when the job goes to the floor. Nothing when the work order
 * already has one. Returns true when it was written here.
 */
async function firstTechnician({ req, wo, m, note, window = null }) {
  if (wo.mechanic_id) return false;
  const next = WAITING_STATUSES.includes(wo.status) ? 'assigned' : wo.status;
  const r = await execute(
    'UPDATE work_orders SET mechanic_id = ?, status = ?, updated_at = NOW() WHERE id = ? AND workshop_id = ? AND mechanic_id IS NULL',
    [m.id, next, wo.id, req.workshopId]);
  if (!r.affectedRows) return false; // someone else's assignment got there first
  await execute('UPDATE work_order_assignments SET is_current = 0 WHERE work_order_id = ? AND is_current = 1', [wo.id]);
  await execute(
    `INSERT INTO work_order_assignments (work_order_id, mechanic_id, assigned_by, assigned_at, scheduled_start_at, scheduled_end_at, is_current)
     VALUES (?, ?, ?, NOW(), ?, ?, 1)`,
    [wo.id, m.id, req.user.id, window?.start || null, window?.end || null]);
  await execute('INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
    [wo.id, 'assigned', req.user.id, note.slice(0, 500)]);
  if (['estimate_approved', 'pending', 'confirmed'].includes(wo.status)) {
    try { await createInvoiceFromWorkOrder(wo.id, req.workshopId, req.user.id); }
    catch (invoiceErr) { console.error('[JobTasks] invoice on assign failed:', invoiceErr.message); }
  }
  return true;
}

/** "YYYY-MM-DD HH:MM[:SS]" (or with a T) → "YYYY-MM-DD HH:MM:SS", else null. */
function sqlDateTime(v) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(String(v || '').trim());
  return m ? `${m[1]} ${m[2]}${m[3] || ':00'}` : null;
}

// GET /api/job-tasks?work_order_id=[&team_leader_id=]
router.get('/', async (req, res) => {
  try {
    const woId = Number(req.query.work_order_id);
    if (!Number.isInteger(woId) || woId <= 0) return res.status(400).json({ success: false, message: 'work_order_id is required' });
    const [wo] = await query(
      'SELECT id, work_order_number, status, mechanic_id FROM work_orders WHERE id = ? AND workshop_id = ?', [woId, req.workshopId]);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    await syncJobTasks({ workOrderId: wo.id, workshopId: req.workshopId, userId: req.user.id });
    const tasks = await listJobTasks({ workOrderId: wo.id, workshopId: req.workshopId });

    const canAssign = can(req.user, 'job.assign');
    const leader = teamLeaderId(req);
    const closed = ['completed', 'cancelled'].includes(wo.status);
    // The technicians to offer — a team leader's own team — with what each is
    // doing now. Who comes first for each job (qualified, available, the
    // team on the board) is the picker's: it differs per job.
    const technicians = canAssign ? await technicianRoster({ workshopId: req.workshopId, leaderId: leader }) : [];
    const [approvalMissing, mrn] = canAssign && !closed
      ? await Promise.all([customerApprovalMissing(wo.id, req.workshopId), partsRequestMissing({ workOrderId: wo.id, workshopId: req.workshopId })])
      : [false, null];
    const preferTeam = leader || Number(req.query.team_leader_id) || null;
    res.json({
      success: true,
      data: {
        tasks, technicians, service_types: JOB_TYPES,
        can_assign: canAssign, can_override: canAssign && isManagerRole(req.user),
        can_request_parts: can(req.user, 'parts.request'),
        team_only: !!leader, prefer_team_leader_id: preferTeam, closed,
        work_order: { id: wo.id, work_order_number: wo.work_order_number, status: wo.status, mechanic_id: wo.mechanic_id || null },
        // Why nobody can be assigned yet (the same refusals PATCH / POST give).
        blocked: approvalMissing ? { ...CUSTOMER_APPROVAL_REQUIRED } : mrn ? { ...mrn } : null,
      },
    });
  } catch (err) {
    console.error('GET /job-tasks error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the jobs' });
  }
});

// GET /api/job-tasks/parts-request?work_order_id= — what the Request parts dialog starts from
router.get('/parts-request', async (req, res) => {
  try {
    if (!can(req.user, 'parts.request') && !can(req.user, 'job.assign')) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Parts are requested by the floor or the Service Advisor.' });
    }
    const woId = Number(req.query.work_order_id);
    if (!Number.isInteger(woId) || woId <= 0) return res.status(400).json({ success: false, message: 'work_order_id is required' });
    const data = await approvedPartsLines(woId, req.workshopId);
    if (!data) return res.status(404).json({ success: false, message: 'Work order not found' });
    const mrn = await partsRequestMissing({ workOrderId: woId, workshopId: req.workshopId });
    res.json({ success: true, data: { ...data, needed: !!mrn, message: mrn?.message || null, can_request: can(req.user, 'parts.request') } });
  } catch (err) {
    console.error('GET /job-tasks/parts-request error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the parts' });
  }
});

// PATCH /api/job-tasks/:id/technician — { mechanic_id, override?, reason? }
router.patch('/:id/technician', requireCapability('job.assign'), async (req, res) => {
  try {
    const task = await getJobTask(Number(req.params.id), req.workshopId);
    if (!task) return res.status(404).json({ success: false, message: 'Job not found' });
    const gate = await workOrderGate(task.work_order_id, req.workshopId);
    if (gate.status) return res.status(gate.status).json(gate.body);
    const { wo } = gate;
    const blocked = taskGate(task);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    const [m] = await query(
      'SELECT id, full_name, skills, team_leader_id FROM mechanics WHERE id = ? AND workshop_id = ?', [Number(req.body?.mechanic_id) || 0, req.workshopId]);
    if (!m) return res.status(404).json({ success: false, message: 'Technician not found' });
    const avail = (await technicianAvailability([m.id], req.workshopId)).get(m.id);
    const ok = technicianGate({ req, task, m, avail, override: req.body?.override, reason: req.body?.reason });
    if (ok.status) return res.status(ok.status).json(ok.body);
    const { overrideReason } = ok;

    if (Number(task.mechanic_id) === Number(m.id) && !task.inherited && !overrideReason) {
      return res.json({ success: true, message: `Already assigned to ${m.full_name}`, data: task });
    }
    await writeTaskTechnician({ req, task, m, overrideReason });
    await firstTechnician({ req, wo, m, note: `${task.job_name} assigned to ${m.full_name}` });

    const typeLabel = task.service_type ? JOB_TYPES[task.service_type] || task.service_type : null;
    await notifyMechanic(req.workshopId, m.id, {
      title: `Job assigned: ${wo.work_order_number} · ${task.job_name}`,
      body: `${task.job_name}${typeLabel ? ` (${typeLabel})` : ''} on job card ${task.job_card_number}. Scan the job's barcode at the station when you start and when you finish.`,
      jobCardId: task.job_card_id, orderId: wo.id, type: `workflow_task_${task.id}_assigned`,
      push: { title: `New job: ${task.job_name}` },
    });
    res.json({ success: true, message: `${task.job_name} assigned to ${m.full_name}`, data: await getJobTask(task.id, req.workshopId) });
  } catch (err) {
    console.error('PATCH /job-tasks/:id/technician error:', err);
    res.status(500).json({ success: false, message: 'Failed to assign the technician' });
  }
});

// POST /api/job-tasks/assign — several jobs of one work order in one go
router.post('/assign', requireCapability('job.assign'), async (req, res) => {
  try {
    const woId = Number(req.body?.work_order_id);
    const list = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
    if (!Number.isInteger(woId) || woId <= 0 || !list?.length) {
      return res.status(400).json({ success: false, message: 'work_order_id and at least one assignment ({ task_id, mechanic_id }) are required.' });
    }
    if (list.length > MAX_BATCH) return res.status(400).json({ success: false, message: `At most ${MAX_BATCH} jobs at a time.` });
    const wanted = list.map(a => ({
      taskId: Number(a?.task_id), mechanicId: Number(a?.mechanic_id), override: a?.override === true,
      reason: a?.reason ?? req.body?.reason ?? null,
      expected: Object.prototype.hasOwnProperty.call(a || {}, 'expected_mechanic_id') ? (Number(a.expected_mechanic_id) || null) : undefined,
    }));
    if (wanted.some(a => !Number.isInteger(a.taskId) || a.taskId <= 0 || !Number.isInteger(a.mechanicId) || a.mechanicId <= 0)) {
      return res.status(400).json({ success: false, message: 'Each assignment needs a task_id and a mechanic_id.' });
    }
    if (new Set(wanted.map(a => a.taskId)).size !== wanted.length) {
      return res.status(400).json({ success: false, message: 'A job is listed twice.' });
    }

    // A booked window (Team Board) goes with the work order's first
    // technician, as the whole-job assign books it: one technician only.
    let window = null;
    if (req.body?.scheduled_start_at || req.body?.scheduled_end_at) {
      const start = sqlDateTime(req.body.scheduled_start_at), end = sqlDateTime(req.body.scheduled_end_at);
      if (!start || !end) return res.status(400).json({ success: false, code: 'WINDOW_INVALID', message: 'Give the window as a start and an end date and time.' });
      if (end <= start) return res.status(400).json({ success: false, code: 'WINDOW_INVALID', message: 'The end of the window must be after its start.' });
      if (new Set(wanted.map(a => a.mechanicId)).size > 1) {
        return res.status(400).json({ success: false, code: 'WINDOW_ONE_TECHNICIAN', message: 'A time window is booked when one technician takes the jobs. Assign without a window, or give every job to the same technician.' });
      }
      window = { start, end };
    }

    await syncJobTasks({ workOrderId: woId, workshopId: req.workshopId, userId: req.user.id });
    const gate = await workOrderGate(woId, req.workshopId);
    if (gate.status) return res.status(gate.status).json(gate.body);
    const { wo } = gate;

    const tasks = new Map((await listJobTasks({ workOrderId: wo.id, workshopId: req.workshopId })).map(t => [t.id, t]));
    const mechIds = [...new Set(wanted.map(a => a.mechanicId))];
    const [mechRows, avail] = await Promise.all([
      query('SELECT id, full_name, skills, team_leader_id FROM mechanics WHERE workshop_id = ? AND id IN (?)', [req.workshopId, mechIds]),
      technicianAvailability(mechIds, req.workshopId),
    ]);
    const mechs = new Map(mechRows.map(m => [m.id, m]));

    // Every job is checked first: one that cannot take its technician stops
    // them all, and the answer lists each (as the estimate's bulk decisions).
    const errors = [], changes = [];
    for (const a of wanted) {
      const task = tasks.get(a.taskId);
      const fail = (r, extra = {}) => errors.push({ task_id: a.taskId, job_name: task?.job_name || null, code: r.body.code || null, message: r.body.message, ...extra });
      if (!task) { fail(refusal(404, 'TASK_NOT_FOUND', 'This job is not on this work order (the approved work changed). Refresh.')); continue; }
      const m = mechs.get(a.mechanicId);
      if (!m) { fail(refusal(404, 'TECHNICIAN_NOT_FOUND', 'Technician not found')); continue; }
      // The dialog says who it saw on the job: someone else assigning it meanwhile is not silently replaced.
      if (a.expected !== undefined && (Number(task.mechanic_id) || null) !== a.expected && Number(task.mechanic_id) !== m.id) {
        fail(refusal(409, 'ALREADY_ASSIGNED', `${task.job_name} was just assigned to ${task.mechanic_name || 'another technician'}. Refresh.`));
        continue;
      }
      const blocked = taskGate(task);
      if (blocked) { fail(blocked); continue; }
      const ok = technicianGate({ req, task, m, avail: avail.get(m.id), override: a.override, reason: a.reason });
      if (ok.status) { fail(ok, ok.body.can_override !== undefined ? { can_override: ok.body.can_override } : {}); continue; }
      if (Number(task.mechanic_id) === m.id && !task.inherited && !ok.overrideReason) continue; // unchanged
      changes.push({ task, m, overrideReason: ok.overrideReason });
    }
    if (errors.length) {
      return res.status(errors.some(e => e.code === 'NOT_YOUR_TEAM') && errors.length === 1 ? 403 : 409).json({
        success: false, code: errors.length === 1 ? errors[0].code : 'ASSIGN_REFUSED',
        message: errors.length === 1 ? `${errors[0].job_name ? `${errors[0].job_name}: ` : ''}${errors[0].message}`
          : `${errors.length} jobs cannot be assigned as chosen — nothing was saved. ${errors.map(e => `${e.job_name || `#${e.task_id}`}: ${e.message}`).join(' ')}`.slice(0, 1200),
        can_override: errors.some(e => e.can_override),
        errors,
      });
    }
    if (!changes.length) {
      return res.json({ success: true, assigned: 0, message: 'Nothing changed — every job already has that technician.', data: [...tasks.values()] });
    }

    // Booked window: the conflict is reported, not refused (as the Team Board).
    let conflict = null;
    const firstWrite = !wo.mechanic_id;
    if (window && firstWrite) {
      const [clash] = await query(
        `SELECT wa.work_order_id, wo.work_order_number, wa.scheduled_start_at, wa.scheduled_end_at
           FROM work_order_assignments wa JOIN work_orders wo ON wo.id = wa.work_order_id
          WHERE wa.mechanic_id = ? AND wa.is_current = 1 AND wa.work_order_id <> ?
            AND wo.status NOT IN ('completed','cancelled') AND wa.scheduled_start_at IS NOT NULL
            AND wa.scheduled_start_at < ? AND wa.scheduled_end_at > ?
          LIMIT 1`, [changes[0].m.id, wo.id, window.end, window.start]);
      conflict = clash || null;
    }

    for (const c of changes) await writeTaskTechnician({ req, ...c });
    const byTech = new Map();
    for (const c of changes) {
      if (!byTech.has(c.m.id)) byTech.set(c.m.id, { m: c.m, tasks: [] });
      byTech.get(c.m.id).tasks.push(c.task);
    }
    const first = changes[0];
    const wrote = await firstTechnician({
      req, wo, m: first.m, window,
      note: `${byTech.get(first.m.id).tasks.map(t => t.job_name).join(', ')} assigned to ${first.m.full_name}${byTech.size > 1 ? ` (+${byTech.size - 1} more technician${byTech.size > 2 ? 's' : ''})` : ''}`,
    });

    // One notice per technician, naming their jobs.
    for (const { m, tasks: mine } of byTech.values()) {
      const names = mine.map(t => t.job_name);
      const cards = [...new Set(mine.map(t => t.job_card_number))].join(', ');
      await notifyMechanic(req.workshopId, m.id, {
        title: mine.length === 1 ? `Job assigned: ${wo.work_order_number} · ${names[0]}` : `${mine.length} jobs assigned: ${wo.work_order_number}`,
        body: `${names.join(', ').slice(0, 200)} on job card ${cards}. Scan each job's barcode at the station when you start and when you finish.`,
        jobCardId: mine[0].job_card_id, orderId: wo.id, type: `workflow_task_${mine[0].id}_assigned`,
        push: { title: mine.length === 1 ? `New job: ${names[0]}` : `${mine.length} new jobs: ${wo.work_order_number}` },
      });
    }

    const summary = [...byTech.values()].map(({ m, tasks: mine }) => `${mine.map(t => t.job_name).join(', ')} → ${m.full_name}`).join('; ');
    res.json({
      success: true, assigned: changes.length,
      message: `${changes.length === 1 ? '1 job' : `${changes.length} jobs`} assigned: ${summary}`.slice(0, 500),
      conflict, window_booked: !!(window && wrote),
      data: await listJobTasks({ workOrderId: wo.id, workshopId: req.workshopId }),
    });
  } catch (err) {
    console.error('POST /job-tasks/assign error:', err);
    res.status(500).json({ success: false, message: 'Failed to assign the technicians' });
  }
});

// PATCH /api/job-tasks/:id/service-type — { service_type } for a job the
// technical report does not name (e.g. extra work approved later), so it can
// be offered to the right technicians.
router.patch('/:id/service-type', requireCapability('job.assign'), async (req, res) => {
  try {
    const task = await getJobTask(Number(req.params.id), req.workshopId);
    if (!task) return res.status(404).json({ success: false, message: 'Job not found' });
    const type = String(req.body?.service_type || '').trim().toLowerCase();
    if (!JOB_TYPES[type]) return res.status(400).json({ success: false, code: 'SERVICE_TYPE_INVALID', message: `The service type must be one of: ${Object.values(JOB_TYPES).join(', ')}.` });
    if (['done', 'cancelled'].includes(task.status)) return res.status(409).json({ success: false, message: `This job is ${task.status}.` });
    await execute('UPDATE job_card_tasks SET service_type = ? WHERE id = ? AND workshop_id = ?', [type, task.id, req.workshopId]);
    await logAudit({ workshopId: req.workshopId, userId: req.user.id, action: 'SERVICE_TYPE', entityType: 'job_card_tasks', entityId: task.id,
      oldValue: { service_type: task.service_type }, newValue: { service_type: type } });
    res.json({ success: true, data: await getJobTask(task.id, req.workshopId) });
  } catch (err) {
    console.error('PATCH /job-tasks/:id/service-type error:', err);
    res.status(500).json({ success: false, message: 'Failed to save the service type' });
  }
});

// POST /api/job-tasks/:id/reopen — a finished job back to paused (an END scanned by mistake)
router.post('/:id/reopen', requireCapability('job.assign'), async (req, res) => {
  try {
    const task = await getJobTask(Number(req.params.id), req.workshopId);
    if (!task) return res.status(404).json({ success: false, message: 'Job not found' });
    if (task.status !== 'done') return res.status(409).json({ success: false, message: 'Only a finished job can be reopened.' });
    if (!['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_failed'].includes(task.job_card_status)) {
      return res.status(409).json({ success: false, code: 'CARD_DONE', message: `Job card ${task.job_card_number} is already marked done — a failed quality check sends it back for rework.` });
    }
    await execute("UPDATE job_card_tasks SET status = 'paused', finished_at = NULL WHERE id = ? AND status = 'done'", [task.id]);
    await logAudit({ workshopId: req.workshopId, userId: req.user.id, action: 'REOPEN', entityType: 'job_card_tasks', entityId: task.id, oldValue: { status: 'done' }, newValue: { status: 'paused' } });
    res.json({ success: true, message: `${task.job_name} reopened — the next scan starts it again`, data: await getJobTask(task.id, req.workshopId) });
  } catch (err) {
    console.error('POST /job-tasks/:id/reopen error:', err);
    res.status(500).json({ success: false, message: 'Failed to reopen the job' });
  }
});

// POST /api/job-tasks/scan — { code, badge? }
router.post('/scan', STATION, async (req, res) => {
  try {
    const code = normalizeCode(req.body?.code);
    if (isBadgeCode(code)) {
      const [m] = await query('SELECT id, full_name, is_active FROM mechanics WHERE badge_code = ? AND workshop_id = ?', [code, req.workshopId]);
      if (!m) return res.status(404).json({ success: false, code: 'BADGE_UNKNOWN', message: 'This badge is not recognised. It may have been replaced — ask your Team Leader for a new one.' });
      if (!Number(m.is_active)) return res.status(409).json({ success: false, code: 'TECHNICIAN_UNAVAILABLE', message: `${m.full_name} is not active.` });
      return res.json({ success: true, action: 'badge', badge: code, technician: { id: m.id, full_name: m.full_name }, tasks: await technicianOpenTasks(m.id, req.workshopId) });
    }
    if (!isTaskCode(code)) {
      return res.status(400).json({ success: false, code: 'CODE_UNKNOWN', message: 'Not a job or badge code. Scan the barcode next to the job on the job card.' });
    }
    const badge = req.body?.badge ? normalizeCode(req.body.badge) : null;
    if (badge && !isBadgeCode(badge)) return res.status(400).json({ success: false, code: 'BADGE_UNKNOWN', message: 'The badge scanned before is not valid. Scan your badge again.' });
    const r = await scanTask({ code, badgeCode: badge, requireBadge: await badgeRequired(req.workshopId), workshopId: req.workshopId, userId: req.user.id });
    res.status(r.status).json(r.body);
  } catch (err) {
    console.error('POST /job-tasks/scan error:', err);
    res.status(500).json({ success: false, message: 'The scan was not recorded — scan again.' });
  }
});

// GET /api/job-tasks/station — the station's settings and today's last scans
router.get('/station', STATION, async (req, res) => {
  try {
    const rows = await query(
      `SELECT l.id, l.clock_in, l.clock_out, l.end_reason, t.job_name, t.service_type, m.full_name AS mechanic_name,
              wo.work_order_number, jc.job_card_number, COALESCE(v.plate_number, jc.vehicle_plate) AS plate
         FROM technician_time_logs l
         JOIN job_card_tasks t ON t.id = l.task_id
         JOIN job_cards jc ON jc.id = l.job_card_id
         JOIN work_orders wo ON wo.id = jc.work_order_id
         LEFT JOIN vehicles v ON v.id = wo.vehicle_id
         LEFT JOIN mechanics m ON m.id = l.mechanic_id
        WHERE l.workshop_id = ? AND l.task_id IS NOT NULL AND COALESCE(l.clock_out, l.clock_in) >= CURDATE()
        ORDER BY COALESCE(l.clock_out, l.clock_in) DESC, l.id DESC LIMIT 12`, [req.workshopId]);
    const recent = rows.map(r => ({
      id: r.id, at: r.clock_out || r.clock_in,
      action: !r.clock_out ? 'started' : r.end_reason === 'stop' ? 'ended' : 'paused',
      job_name: r.job_name, service_type: r.service_type, mechanic_name: r.mechanic_name,
      work_order_number: r.work_order_number, job_card_number: r.job_card_number, plate: r.plate,
    }));
    const [now] = await query('SELECT NOW() AS now');
    res.json({ success: true, data: { badge_required: await badgeRequired(req.workshopId), can_configure: isManagerRole(req.user), recent, server_time: now.now } });
  } catch (err) {
    console.error('GET /job-tasks/station error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the scan station' });
  }
});

// PUT /api/job-tasks/station — { badge_required } (managers)
router.put('/station', async (req, res) => {
  try {
    if (!isManagerRole(req.user)) return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'A manager sets up the scan station.' });
    const on = req.body?.badge_required === true;
    await execute(
      "INSERT INTO settings (workshop_id, `key`, `value`, `type`) VALUES (?, ?, ?, 'boolean') ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      [req.workshopId, BADGE_SETTING, on ? 'true' : 'false']);
    await logAudit({ workshopId: req.workshopId, userId: req.user.id, action: 'UPDATE', entityType: 'settings', entityId: req.workshopId, newValue: { [BADGE_SETTING]: on } });
    res.json({ success: true, data: { badge_required: on } });
  } catch (err) {
    console.error('PUT /job-tasks/station error:', err);
    res.status(500).json({ success: false, message: 'Failed to save the scan station setting' });
  }
});

// GET /api/job-tasks/work-orders/:id/sheet — the printed job card with each job's barcode
router.get('/work-orders/:id/sheet', async (req, res) => {
  try {
    const [order] = await query(
      `SELECT o.*, b.name AS service_bay_name, c.company_name, c.full_name AS customer_full_name
         FROM work_orders o
         LEFT JOIN service_bays b ON o.service_bay_id = b.id
         LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.id = ? AND o.workshop_id = ?`, [req.params.id, req.workshopId]);
    if (!order) return res.status(404).json({ success: false, message: 'Work order not found' });
    order._tasks = await tasksForSheet(order.id, req.workshopId);
    const [workshop] = await query('SELECT * FROM workshops WHERE id = ?', [req.workshopId]);
    let template = null;
    try {
      const [row] = await query("SELECT `value` FROM settings WHERE workshop_id = ? AND `key` = 'label_template'", [req.workshopId]);
      if (row?.value) template = JSON.parse(row.value);
    } catch (_) {}
    const { generateServiceJobSheetPDF } = await import('../lib/service-job-sheet.js');
    await generateServiceJobSheetPDF(res, { orders: [order], tenant: workshop, template });
  } catch (err) {
    console.error('GET /job-tasks/work-orders/:id/sheet error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to print the job card' });
  }
});

export default router;
