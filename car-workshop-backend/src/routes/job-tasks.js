/**
 * /api/job-tasks — technicians per job and the scan station (client
 * meeting, 3 Nov 2026, points 14, 16, 17; lib/job-tasks.js).
 *
 *   GET   /?work_order_id=          the work order's jobs (synced with the approved work), the
 *                                   technicians to offer (with their skills) and what the viewer may do
 *   PATCH /:id/technician           { mechanic_id, override?, reason? } — job.assign. Only a technician
 *                                   qualified for the job's service type; a manager may override
 *                                   with a reason (recorded on the job and in the audit log)
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
 * The whole-job assignment (Team Board, PATCH /work-orders/:id/assign-mechanic)
 * is unchanged; a job's first technician on an unassigned work order also
 * becomes the work order's, so the boards that read work_orders.mechanic_id
 * keep working.
 */
import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { can, isManagerRole, requireCapability } from '../lib/roles.js';
import { JOB_TYPES } from '../lib/intake-rules.js';
import { notifyMechanic } from '../lib/workflow.js';
import { partsRequestMissing } from '../lib/parts-request.js';
import { customerApprovalMissing, CUSTOMER_APPROVAL_REQUIRED } from '../lib/job-card-approval.js';
import { technicianAvailability } from '../lib/technician-availability.js';
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

/** A team leader assigns from their own team (as POST /team-leader/assign). */
const teamLeaderId = req => (req.user?.role_slug === 'team_leader' ? Number(req.user.id) : null);

async function badgeRequired(workshopId) {
  const [row] = await query('SELECT `value` FROM settings WHERE workshop_id = ? AND `key` = ?', [workshopId, BADGE_SETTING]);
  return row?.value === 'true';
}

// GET /api/job-tasks?work_order_id=
router.get('/', async (req, res) => {
  try {
    const woId = Number(req.query.work_order_id);
    if (!Number.isInteger(woId) || woId <= 0) return res.status(400).json({ success: false, message: 'work_order_id is required' });
    const [wo] = await query('SELECT id, status FROM work_orders WHERE id = ? AND workshop_id = ?', [woId, req.workshopId]);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    await syncJobTasks({ workOrderId: wo.id, workshopId: req.workshopId, userId: req.user.id });
    const tasks = await listJobTasks({ workOrderId: wo.id, workshopId: req.workshopId });

    const canAssign = can(req.user, 'job.assign');
    let technicians = [];
    if (canAssign) {
      const leader = teamLeaderId(req);
      const rows = await query(
        `SELECT id, full_name, skills FROM mechanics
          WHERE workshop_id = ? AND is_active = 1 ${leader ? 'AND team_leader_id = ?' : ''} ORDER BY full_name`,
        leader ? [req.workshopId, leader] : [req.workshopId]);
      const avail = await technicianAvailability(rows.map(r => r.id), req.workshopId);
      technicians = rows.map(r => ({ id: r.id, full_name: r.full_name, skills: skillsOf(r), available: avail.get(r.id)?.available !== false }))
        .filter(r => r.available);
    }
    res.json({
      success: true,
      data: {
        tasks, technicians, service_types: JOB_TYPES,
        can_assign: canAssign, can_override: canAssign && isManagerRole(req.user),
        team_only: !!teamLeaderId(req), closed: ['completed', 'cancelled'].includes(wo.status),
      },
    });
  } catch (err) {
    console.error('GET /job-tasks error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the jobs' });
  }
});

// PATCH /api/job-tasks/:id/technician — { mechanic_id, override?, reason? }
router.patch('/:id/technician', requireCapability('job.assign'), async (req, res) => {
  try {
    const task = await getJobTask(Number(req.params.id), req.workshopId);
    if (!task) return res.status(404).json({ success: false, message: 'Job not found' });
    const [wo] = await query(
      'SELECT id, work_order_number, status, mechanic_id FROM work_orders WHERE id = ? AND workshop_id = ?', [task.work_order_id, req.workshopId]);
    if (['completed', 'cancelled'].includes(wo.status)) return res.status(409).json({ success: false, code: 'JOB_CLOSED', message: `${wo.work_order_number} is ${wo.status}.` });
    if (task.status === 'cancelled') return res.status(409).json({ success: false, code: 'TASK_CANCELLED', message: 'This job is no longer part of the approved work.' });
    if (task.status === 'done') return res.status(409).json({ success: false, code: 'TASK_DONE', message: 'This job is finished. Reopen it first to give it to someone else.' });
    if (task.running) {
      return res.status(409).json({ success: false, code: 'TASK_RUNNING', message: `${task.mechanic_name}'s clock is running on this job. It ends with a scan at the station (or start another job) before it is reassigned.` });
    }
    if (await customerApprovalMissing(wo.id, req.workshopId)) return res.status(409).json({ success: false, ...CUSTOMER_APPROVAL_REQUIRED });
    // The parts are requested (MRN) before anyone is assigned (lib/parts-request.js).
    const mrn = await partsRequestMissing({ workOrderId: wo.id, workshopId: req.workshopId });
    if (mrn) return res.status(409).json({ success: false, ...mrn });

    const [m] = await query(
      'SELECT id, full_name, skills, team_leader_id FROM mechanics WHERE id = ? AND workshop_id = ?', [Number(req.body?.mechanic_id) || 0, req.workshopId]);
    if (!m) return res.status(404).json({ success: false, message: 'Technician not found' });
    const avail = (await technicianAvailability([m.id], req.workshopId)).get(m.id);
    if (!avail?.available) return res.status(409).json({ success: false, code: 'TECHNICIAN_UNAVAILABLE', message: `${m.full_name} is not available (${avail?.reason || 'unknown'}).` });
    const leader = teamLeaderId(req);
    if (leader && Number(m.team_leader_id) !== leader) {
      return res.status(403).json({ success: false, code: 'NOT_YOUR_TEAM', message: `${m.full_name} is not on your team.` });
    }

    // Point 16: only a technician qualified for the job's service type. A
    // manager may assign someone else, deliberately (override + reason).
    let overrideReason = null;
    if (!qualifiedFor(skillsOf(m), task.service_type)) {
      const typeLabel = JOB_TYPES[task.service_type] || task.service_type;
      const why = skillsOf(m) === null ? `${m.full_name} has no skills recorded yet (Technicians page)` : `${m.full_name} is not qualified for ${typeLabel}`;
      const manager = isManagerRole(req.user);
      const reason = String(req.body?.reason || '').trim().slice(0, 255);
      if (!manager || req.body?.override !== true || reason.length < 3) {
        return res.status(409).json({
          success: false, code: 'NOT_QUALIFIED', can_override: manager,
          message: manager ? `${why}. To assign anyway, confirm the override and give the reason.` : `${why}. Choose a technician qualified for ${typeLabel}, or ask a manager.`,
        });
      }
      overrideReason = reason;
    }

    if (Number(task.mechanic_id) === Number(m.id) && !task.inherited && !overrideReason) {
      return res.json({ success: true, message: `Already assigned to ${m.full_name}`, data: task });
    }
    await execute(
      'UPDATE job_card_tasks SET mechanic_id = ?, assigned_by = ?, assigned_at = NOW(), override_reason = ? WHERE id = ? AND workshop_id = ?',
      [m.id, req.user.id, overrideReason, task.id, req.workshopId]);
    // The job card shows a technician too, when it had none.
    await execute('UPDATE job_cards SET mechanic_id = ? WHERE id = ? AND mechanic_id IS NULL', [m.id, task.job_card_id]);

    // The work order's first technician: written where the existing boards
    // read it (as the Team Board's assign does), the invoice raised when the
    // job goes to the floor.
    if (!wo.mechanic_id) {
      const next = WAITING_STATUSES.includes(wo.status) ? 'assigned' : wo.status;
      await execute('UPDATE work_orders SET mechanic_id = ?, status = ?, updated_at = NOW() WHERE id = ? AND workshop_id = ? AND mechanic_id IS NULL',
        [m.id, next, wo.id, req.workshopId]);
      await execute('UPDATE work_order_assignments SET is_current = 0 WHERE work_order_id = ? AND is_current = 1', [wo.id]);
      await execute('INSERT INTO work_order_assignments (work_order_id, mechanic_id, assigned_by, assigned_at, is_current) VALUES (?, ?, ?, NOW(), 1)',
        [wo.id, m.id, req.user.id]);
      await execute('INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
        [wo.id, 'assigned', req.user.id, `${task.job_name} assigned to ${m.full_name}`]);
      if (['estimate_approved', 'pending', 'confirmed'].includes(wo.status)) {
        try { await createInvoiceFromWorkOrder(wo.id, req.workshopId, req.user.id); }
        catch (invoiceErr) { console.error('[JobTasks] invoice on assign failed:', invoiceErr.message); }
      }
    }

    const typeLabel = task.service_type ? JOB_TYPES[task.service_type] || task.service_type : null;
    await notifyMechanic(req.workshopId, m.id, {
      title: `Job assigned: ${wo.work_order_number} · ${task.job_name}`,
      body: `${task.job_name}${typeLabel ? ` (${typeLabel})` : ''} on job card ${task.job_card_number}. Scan the job's barcode at the station when you start and when you finish.`,
      jobCardId: task.job_card_id, orderId: wo.id, type: `workflow_task_${task.id}_assigned`,
      push: { title: `New job: ${task.job_name}` },
    });
    await logAudit({ workshopId: req.workshopId, userId: req.user.id, action: 'ASSIGN', entityType: 'job_card_tasks', entityId: task.id,
      oldValue: { mechanic_id: task.mechanic_id }, newValue: { mechanic_id: m.id, override_reason: overrideReason } });
    res.json({ success: true, message: `${task.job_name} assigned to ${m.full_name}`, data: await getJobTask(task.id, req.workshopId) });
  } catch (err) {
    console.error('PATCH /job-tasks/:id/technician error:', err);
    res.status(500).json({ success: false, message: 'Failed to assign the technician' });
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
