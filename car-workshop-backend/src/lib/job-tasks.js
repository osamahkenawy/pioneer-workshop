/**
 * job-tasks.js — technicians per job, and the scan station (client meeting,
 * 3 Nov 2026, points 14, 16 and 17).
 *
 * A job card can carry several jobs / services, each with its own
 * technician. job_card_tasks has one row per approved job:
 *
 *   - the approved work is the work order's lines (work_order_items — what
 *     the customer approved on the estimate, a supplementary estimate's
 *     lines included), grouped by their estimate line's job name; a labour
 *     line without a job name is a job of its own, a part without one belongs
 *     to no job. The job's service type is the technical report's for the
 *     same job name (lib/intake-rules.js JOB_TYPES).
 *   - syncJobTasks() brings the tasks in line with the approved work: a new
 *     job gets a task, a job whose lines are gone is cancelled (unless time
 *     was booked on it). It runs whenever the tasks are read, printed or
 *     assigned, so work approved later appears without anyone pressing a
 *     button.
 *   - a new task takes its job card's technician while the job is still
 *     assigned as a whole (old jobs, the Team Board); once anyone has
 *     assigned a job on its own, new jobs wait for a technician and the floor
 *     is told.
 *
 * Time per job: the scan station (scanTask) books technician_time_logs rows
 * with the task's id ON its job card, so the job card's clock, totals and
 * KPIs read them as before, and the job card and work order move as with
 * Start / Job done (routes/job-cards.js, lib/workflow-sync.js):
 *
 *   first scan  → START: the job's technician's clock starts (a clock of
 *                 theirs running on another job is paused — "moved to another
 *                 job"); the job card goes in progress, the work order follows.
 *   next scan   → END: the clock stops and the job is done. When every job
 *                 on the job card is done, the job card is marked done and
 *                 goes to the quality check (as Job done does).
 *   a finished job scanned again starts again only when the quality check
 *   failed (rework); a paused one resumes.
 *
 * Codes are digits only ('41' + 8 for a job, '42' + 8 for a badge): a USB
 * scanner types them the same whatever the PC's keyboard layout (letters
 * come out in Arabic on an Arabic layout).
 */
import crypto from 'crypto';
import pool, { query, execute } from './database.js';
import { JOB_TYPES } from './intake-rules.js';
import { logAudit } from './audit.js';
import { notifyGroups, FLOOR } from './workflow.js';
import { syncWorkOrderFromJobCards } from './workflow-sync.js';
import { customerApprovalMissing, CUSTOMER_APPROVAL_REQUIRED } from './job-card-approval.js';
import { technicianAvailability } from './technician-availability.js';

const TASK_PREFIX = '41';
const BADGE_PREFIX = '42';
const digits = n => Array.from(crypto.randomBytes(n), b => String(b % 10)).join('');
export const newTaskCode = () => TASK_PREFIX + digits(8);
export const newBadgeCode = () => BADGE_PREFIX + digits(8);

/** A scanned or typed code: Arabic-Indic digits → 0–9, spaces and dashes dropped. */
export function normalizeCode(raw) {
  return String(raw ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0))
    .replace(/[\s-]+/g, '').toUpperCase().slice(0, 40);
}
export const isTaskCode = c => new RegExp(`^${TASK_PREFIX}\\d{8}$`).test(c);
export const isBadgeCode = c => new RegExp(`^${BADGE_PREFIX}\\d{8}$`).test(c);

/** The key a job is matched on: its name, trimmed, single-spaced, lower case. */
export const jobKey = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 200);

/** mechanics.skills → the service type keys, or null when never recorded. */
export function skillsOf(row) {
  let v = row?.skills ?? null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return Array.isArray(v) ? v.filter(k => JOB_TYPES[k]) : null;
}

/** Skills from a request: an array of JOB_TYPES keys ([] = none). { value } (JSON) or { error }. */
export function parseSkills(input) {
  if (!Array.isArray(input)) return { error: 'skills must be a list of service types.' };
  const clean = [...new Set(input.map(s => String(s).trim().toLowerCase()))];
  const bad = clean.filter(k => !JOB_TYPES[k]);
  if (bad.length) return { error: `Unknown service type: ${bad.join(', ')}. Use: ${Object.keys(JOB_TYPES).join(', ')}.` };
  return { value: JSON.stringify(Object.keys(JOB_TYPES).filter(k => clean.includes(k))) };
}

/** Is a technician with these skills qualified for a job of this service type? A job without a type takes anyone. */
export const qualifiedFor = (skills, serviceType) => !serviceType || (Array.isArray(skills) && skills.includes(serviceType));

/** Job card statuses the technician still works on. */
const CARD_WORKABLE = ['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_failed'];
/** Who is told a job card is ready for the quality check (as POST /job-cards/:id/done). */
const QC_ROLES = ['supervisor', 'foreman', 'team_leader'];

/** The technical report's service type per job (job name key → type). */
async function serviceTypesByJob(workOrderId, workshopId) {
  const [row] = await query(
    'SELECT service_lines FROM technical_inspections WHERE work_order_id = ? AND workshop_id = ?', [workOrderId, workshopId]);
  let lines = row?.service_lines ?? [];
  if (typeof lines === 'string') { try { lines = JSON.parse(lines); } catch { lines = []; } }
  const map = new Map();
  for (const l of Array.isArray(lines) ? lines : []) {
    const key = jobKey(l?.job);
    if (key && JOB_TYPES[l.service_type] && !map.has(key)) map.set(key, l.service_type);
  }
  return map;
}

/**
 * The approved jobs of a work order: [{ key, name, cardId, order }] from its
 * lines. `cardId` is the job card the job's lines were moved to (a sub-job
 * card), preferring its labour; null = the main job card.
 */
async function approvedJobs(workOrderId) {
  const items = await query(
    `SELECT i.id, i.name, i.item_type, i.job_card_id, el.job_name
       FROM work_order_items i LEFT JOIN estimate_lines el ON el.id = i.estimate_line_id
      WHERE i.work_order_id = ? ORDER BY i.id`, [workOrderId]);
  const jobs = new Map();
  for (const i of items) {
    const name = String(i.job_name || '').trim() || (['labour', 'sublet'].includes(i.item_type) ? String(i.name || '').trim() : '');
    const key = jobKey(name);
    if (!key) continue;
    const job = jobs.get(key) || { key, name: name.replace(/\s+/g, ' ').slice(0, 200), cardId: null, cardFromLabour: false, order: i.id };
    if (i.job_card_id && (!job.cardId || (i.item_type === 'labour' && !job.cardFromLabour))) {
      job.cardId = i.job_card_id; job.cardFromLabour = i.item_type === 'labour';
    }
    jobs.set(key, job);
  }
  return [...jobs.values()];
}

/**
 * Bring a work order's tasks in line with its approved work. Closed jobs and
 * jobs without a main job card are left alone. Never throws.
 * @returns {Promise<{ added: number, cancelled: number }>}
 */
export async function syncJobTasks({ workOrderId, workshopId, userId = null }) {
  const out = { added: 0, cancelled: 0 };
  try {
    const [wo] = await query('SELECT id, work_order_number, status FROM work_orders WHERE id = ? AND workshop_id = ?', [workOrderId, workshopId]);
    if (!wo || ['completed', 'cancelled'].includes(wo.status)) return out;
    const cards = await query(
      "SELECT id, parent_job_card_id, mechanic_id FROM job_cards WHERE work_order_id = ? AND workshop_id = ? AND status <> 'cancelled' ORDER BY parent_job_card_id IS NOT NULL, id",
      [wo.id, workshopId]);
    const main = cards.find(c => !c.parent_job_card_id);
    if (!main) return out;
    const cardTech = new Map(cards.map(c => [c.id, c.mechanic_id || null]));

    const [jobs, types, existing] = await Promise.all([
      approvedJobs(wo.id),
      serviceTypesByJob(wo.id, workshopId),
      query(
        `SELECT t.id, t.job_key, t.job_card_id, t.service_type, t.status, t.mechanic_id, t.assigned_by, t.sort_order,
                (SELECT COUNT(*) FROM technician_time_logs l WHERE l.task_id = t.id) AS logs
           FROM job_card_tasks t WHERE t.work_order_id = ? AND t.workshop_id = ?`, [wo.id, workshopId]),
    ]);
    const byKey = new Map(existing.map(t => [t.job_key, t]));
    // Per-job mode once anyone assigned a job on its own.
    const perJob = existing.some(t => t.assigned_by != null);
    const waiting = [];

    for (const job of jobs) {
      const cardId = job.cardId && cardTech.has(job.cardId) ? job.cardId : main.id;
      const type = types.get(job.key) || null;
      const t = byKey.get(job.key);
      if (!t) {
        const mechanicId = perJob ? null : cardTech.get(cardId);
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await execute(
              `INSERT INTO job_card_tasks (workshop_id, work_order_id, job_card_id, job_key, job_name, service_type, mechanic_id, scan_code, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [workshopId, wo.id, cardId, job.key, job.name, type, mechanicId, newTaskCode(), job.order]);
            out.added++;
            if (!mechanicId) waiting.push(job.name);
            break;
          } catch (err) {
            if (err.code !== 'ER_DUP_ENTRY') throw err;
            if (/uq_job_card_task_job/.test(err.message)) break; // another request created it just now
          }
        }
        continue;
      }
      const sets = [], vals = [];
      if (t.status === 'cancelled') { sets.push("status = 'open'"); }
      if (!t.service_type && type) { sets.push('service_type = ?'); vals.push(type); }
      // A job moved to (or back from) a sub-job card follows it while no time is booked on it.
      if (t.job_card_id !== cardId && !Number(t.logs) && ['open', 'cancelled'].includes(t.status)) { sets.push('job_card_id = ?'); vals.push(cardId); }
      if (Number(t.sort_order) !== job.order) { sets.push('sort_order = ?'); vals.push(job.order); }
      if (sets.length) await execute(`UPDATE job_card_tasks SET ${sets.join(', ')} WHERE id = ?`, [...vals, t.id]);
    }

    // A job no longer approved (its lines removed) is cancelled — unless time
    // was booked on it, which stays on record.
    const keys = new Set(jobs.map(j => j.key));
    const gone = existing.filter(t => !keys.has(t.job_key) && t.status === 'open' && !Number(t.logs)).map(t => t.id);
    if (gone.length) {
      const r = await execute("UPDATE job_card_tasks SET status = 'cancelled' WHERE id IN (?) AND status = 'open'", [gone]);
      out.cancelled = r.affectedRows || 0;
    }

    if (perJob && waiting.length) {
      await notifyGroups(workshopId, FLOOR, {
        title: `New work to assign: ${wo.work_order_number}`,
        body: `Approved and waiting for a technician: ${waiting.join(', ').slice(0, 180)}.`,
        link: `/job-cards/${wo.id}`, orderId: wo.id, icon: '🧰', type: 'workflow_tasks_added', exceptUserId: userId,
      });
    }
  } catch (err) {
    console.error('[JobTasks] sync failed:', err.message);
  }
  return out;
}

const TASK_SELECT = `
  SELECT t.*, jc.job_card_number, (jc.parent_job_card_id IS NULL) AS is_main, jc.title AS job_card_title, jc.status AS job_card_status,
         m.full_name AS mechanic_name, m.skills AS mechanic_skills, m.is_active AS mechanic_active, u.full_name AS assigned_by_name,
         (SELECT MIN(l.clock_in) FROM technician_time_logs l WHERE l.task_id = t.id AND l.clock_out IS NULL) AS running_since,
         (SELECT COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, l.clock_in, COALESCE(l.clock_out, NOW())))), 0)
            FROM technician_time_logs l WHERE l.task_id = t.id) AS seconds
    FROM job_card_tasks t
    JOIN job_cards jc ON jc.id = t.job_card_id
    LEFT JOIN mechanics m ON m.id = t.mechanic_id
    LEFT JOIN users u ON u.id = t.assigned_by`;

/** A task row in the shape the screens and the sheet read. */
function taskShape(t) {
  const running = !!t.running_since;
  // 'in_progress' with no clock running: the clock was paused (or stopped on the job card).
  const status = running ? 'in_progress' : t.status === 'in_progress' ? 'paused' : t.status;
  return {
    id: t.id, work_order_id: t.work_order_id, job_card_id: t.job_card_id, job_card_number: t.job_card_number,
    is_main: !!Number(t.is_main), job_card_title: t.job_card_title, job_card_status: t.job_card_status,
    job_name: t.job_name, service_type: t.service_type, service_type_label: t.service_type ? (JOB_TYPES[t.service_type] || t.service_type) : null,
    mechanic_id: t.mechanic_id, mechanic_name: t.mechanic_name || null,
    qualified: t.mechanic_id ? qualifiedFor(skillsOf({ skills: t.mechanic_skills }), t.service_type) : null,
    inherited: !!t.mechanic_id && t.assigned_by == null,
    status, running, running_since: t.running_since || null,
    started_at: t.started_at, finished_at: t.finished_at, minutes: Math.floor(Number(t.seconds || 0) / 60),
    scan_code: t.scan_code, assigned_by_name: t.assigned_by_name || null, assigned_at: t.assigned_at, override_reason: t.override_reason,
  };
}

/** The work order's tasks (cancelled last). */
export async function listJobTasks({ workOrderId, workshopId, includeCancelled = true }) {
  const rows = await query(
    `${TASK_SELECT} WHERE t.work_order_id = ? AND t.workshop_id = ? ${includeCancelled ? '' : "AND t.status <> 'cancelled'"}
      ORDER BY t.status = 'cancelled', jc.parent_job_card_id IS NOT NULL, t.sort_order, t.id`, [workOrderId, workshopId]);
  return rows.map(taskShape);
}

/** One task by id. */
export async function getJobTask(id, workshopId) {
  const [row] = await query(`${TASK_SELECT} WHERE t.id = ? AND t.workshop_id = ?`, [id, workshopId]);
  return row ? taskShape(row) : null;
}

/** For the printed job card: synced, live tasks only. */
export async function tasksForSheet(workOrderId, workshopId) {
  try {
    await syncJobTasks({ workOrderId, workshopId });
    return await listJobTasks({ workOrderId, workshopId, includeCancelled: false });
  } catch (err) {
    console.error('[JobTasks] sheet tasks failed:', err.message);
    return [];
  }
}

/** The technician's jobs not finished yet (badge scan), newest work first. */
export async function technicianOpenTasks(mechanicId, workshopId) {
  const rows = await query(
    `${TASK_SELECT}
      JOIN work_orders wo ON wo.id = t.work_order_id
     WHERE t.mechanic_id = ? AND t.workshop_id = ? AND t.status IN ('open','in_progress','paused')
       AND wo.status NOT IN ('completed','cancelled') AND jc.status IN (?)
     ORDER BY t.work_order_id DESC, t.sort_order LIMIT 8`, [mechanicId, workshopId, CARD_WORKABLE]);
  return rows.map(taskShape);
}

/**
 * Every job on the job card is finished: mark the job card done and hand it
 * to the quality check — what POST /job-cards/:id/done does when the
 * technician presses Job done. Not while someone's clock still runs on the
 * card (time booked on the card as a whole). Returns true when it moved.
 */
async function finishJobCardIfAllDone({ jobCardId, workshopId, userId }) {
  const [jc] = await query(
    `SELECT jc.id, jc.job_card_number, jc.status, jc.title, jc.parent_job_card_id, jc.work_order_id, wo.work_order_number
       FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id WHERE jc.id = ? AND jc.workshop_id = ?`, [jobCardId, workshopId]);
  if (!jc || !CARD_WORKABLE.includes(jc.status)) return false;
  const [[left], [running]] = await Promise.all([
    query("SELECT COUNT(*) AS n FROM job_card_tasks WHERE job_card_id = ? AND status NOT IN ('done','cancelled')", [jc.id]),
    query('SELECT COUNT(*) AS n FROM technician_time_logs WHERE job_card_id = ? AND clock_out IS NULL', [jc.id]),
  ]);
  if (Number(left.n) || Number(running.n)) return false;
  const r = await execute(
    "UPDATE job_cards SET status = 'qc_pending', completed_at = NOW() WHERE id = ? AND status IN (?)", [jc.id, CARD_WORKABLE]);
  if (!r.affectedRows) return false;
  await syncWorkOrderFromJobCards({ workOrderId: jc.work_order_id, workshopId, userId, reason: `Every job finished on ${jc.job_card_number} (scan station)` });
  await notifyGroups(workshopId, QC_ROLES, {
    title: `Ready for quality check: ${jc.work_order_number}`,
    body: `Job card ${jc.job_card_number}${jc.title && jc.parent_job_card_id ? ` (${jc.title})` : ''}: every job is finished (scan station). Carry out the quality check and test drive.`,
    link: `/work-orders/${jc.work_order_id}`, orderId: jc.work_order_id, icon: '🔍', type: `workflow_job_done_${jc.id}`, exceptUserId: userId,
  });
  await logAudit(workshopId, userId, 'JOB_DONE', 'job_cards', jc.id, jc.status, { status: 'qc_pending', via: 'scan_station' });
  return true;
}

/** A refusal: { status, body } with the code the station shows. */
const refuse = (status, code, message, extra = {}) => ({ status, body: { success: false, code, message, ...extra } });

/** Seconds within which a second scan of the same job is taken as a double read. */
const DOUBLE_SCAN_SECONDS = 15;

/**
 * The scan station: START or END a job for its technician.
 *   code       the job's code from the printed job card
 *   badgeCode  the technician's badge, when scanned first (must be the job's technician)
 *   requireBadge  the workshop asks for the badge first
 * Returns { status, body } — body.action is 'started' or 'ended' on success.
 */
export async function scanTask({ code, badgeCode = null, requireBadge = false, workshopId, userId }) {
  const [found] = await query(
    `SELECT t.id, t.status, t.mechanic_id, t.work_order_id, t.job_card_id, t.job_name, t.service_type,
            jc.job_card_number, jc.status AS card_status, wo.work_order_number, wo.status AS wo_status,
            COALESCE(v.plate_number, jc.vehicle_plate) AS plate, v.make, v.model, m.full_name AS mechanic_name
       FROM job_card_tasks t
       JOIN job_cards jc ON jc.id = t.job_card_id
       JOIN work_orders wo ON wo.id = t.work_order_id
       LEFT JOIN vehicles v ON v.id = wo.vehicle_id
       LEFT JOIN mechanics m ON m.id = t.mechanic_id
      WHERE t.scan_code = ? AND t.workshop_id = ?`, [code, workshopId]);
  if (!found) return refuse(404, 'TASK_NOT_FOUND', 'This code is not a job on any job card. Check you scanned the job card, and that it is the latest print.');
  const job = {
    task_id: found.id, job_name: found.job_name, service_type: found.service_type,
    service_type_label: found.service_type ? (JOB_TYPES[found.service_type] || found.service_type) : null,
    job_card_number: found.job_card_number, work_order_id: found.work_order_id, work_order_number: found.work_order_number,
    plate: found.plate, vehicle: [found.make, found.model].filter(Boolean).join(' ') || null,
    mechanic_id: found.mechanic_id, mechanic_name: found.mechanic_name,
  };
  if (found.status === 'cancelled') return refuse(409, 'TASK_CANCELLED', 'This job is no longer on the job card (the approved work changed). Ask your Team Leader for the latest job card.', { job });
  if (['completed', 'cancelled'].includes(found.wo_status) || found.card_status === 'cancelled') {
    return refuse(409, 'JOB_CLOSED', `${found.work_order_number} is ${found.card_status === 'cancelled' ? 'cancelled' : found.wo_status} — no more time can be booked on it.`, { job });
  }
  if (!found.mechanic_id) return refuse(409, 'NO_TECHNICIAN', 'No technician is assigned to this job yet. Ask your Team Leader.', { job });
  const avail = (await technicianAvailability([found.mechanic_id], workshopId)).get(found.mechanic_id);
  if (!avail?.available) return refuse(409, 'TECHNICIAN_UNAVAILABLE', `${found.mechanic_name || 'The technician'} is not available (${avail?.reason || 'unknown'}). Ask your Team Leader to reassign the job.`, { job });

  if (badgeCode) {
    const [badge] = await query('SELECT id, full_name FROM mechanics WHERE badge_code = ? AND workshop_id = ?', [badgeCode, workshopId]);
    if (!badge) return refuse(404, 'BADGE_UNKNOWN', 'This badge is not recognised. It may have been replaced — ask your Team Leader for a new one.', { job });
    if (Number(badge.id) !== Number(found.mechanic_id)) {
      return refuse(403, 'NOT_YOUR_JOB', `This job is assigned to ${found.mechanic_name}, not ${badge.full_name}. Ask your Team Leader.`, { job });
    }
  } else if (requireBadge) {
    return refuse(400, 'BADGE_REQUIRED', 'Scan your badge first, then the job.', { job });
  }

  const conn = await pool.getConnection();
  let result, paused = [];
  try {
    await conn.beginTransaction();
    // One scan at a time per job: the second waits here and sees the first's result.
    const [[task]] = await conn.query('SELECT id, status, mechanic_id FROM job_card_tasks WHERE id = ? FOR UPDATE', [found.id]);
    const [[last]] = await conn.query(
      `SELECT id, clock_out, end_reason,
              (TIMESTAMPDIFF(SECOND, COALESCE(clock_out, clock_in), NOW()) < ?) AS just_now
         FROM technician_time_logs WHERE task_id = ? ORDER BY clock_in DESC, id DESC LIMIT 1`, [DOUBLE_SCAN_SECONDS, task.id]);
    // A second read of the same barcode straight after a start or an end (a
    // paused clock — another job started — does not count).
    if (last && Number(last.just_now) && (!last.clock_out || last.end_reason === 'stop')) {
      await conn.rollback();
      return refuse(409, 'JUST_SCANNED', `Already recorded a moment ago (${last.clock_out ? 'ended' : 'started'}). Nothing changed.`, { job, state: last.clock_out ? 'ended' : 'started' });
    }
    const [running] = await conn.query('SELECT id FROM technician_time_logs WHERE task_id = ? AND clock_out IS NULL', [task.id]);

    if (running.length) {
      // END: the clock stops and the job is done.
      await conn.query("UPDATE technician_time_logs SET clock_out = NOW(), end_reason = 'stop' WHERE task_id = ? AND clock_out IS NULL", [task.id]);
      const [[t]] = await conn.query(
        'SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, clock_in, clock_out)), 0) AS seconds FROM technician_time_logs WHERE task_id = ?', [task.id]);
      const minutes = Math.floor(Number(t.seconds) / 60);
      await conn.query("UPDATE job_card_tasks SET status = 'done', finished_at = NOW(), minutes = ? WHERE id = ?", [minutes, task.id]);
      result = { action: 'ended', minutes };
    } else {
      // START (or resume).
      if (task.status === 'done' && found.card_status !== 'qc_failed') {
        await conn.rollback();
        return refuse(409, 'TASK_DONE', 'This job is already finished. If it needs more work, ask your Team Leader to reopen it.', { job });
      }
      if (!CARD_WORKABLE.includes(found.card_status)) {
        await conn.rollback();
        return refuse(409, 'CARD_DONE', `Job card ${found.job_card_number} is marked done and is waiting for the quality check.`, { job });
      }
      if (await customerApprovalMissing(found.work_order_id, workshopId)) {
        await conn.rollback();
        return refuse(409, CUSTOMER_APPROVAL_REQUIRED.code, CUSTOMER_APPROVAL_REQUIRED.message, { job });
      }
      // One clock per technician: theirs on another job (or job card) is paused.
      const [others] = await conn.query(
        `SELECT l.id, l.task_id, l.job_card_id, jc.job_card_number, wo.work_order_number, t.job_name
           FROM technician_time_logs l
           JOIN job_cards jc ON jc.id = l.job_card_id JOIN work_orders wo ON wo.id = jc.work_order_id
           LEFT JOIN job_card_tasks t ON t.id = l.task_id
          WHERE l.mechanic_id = ? AND l.clock_out IS NULL FOR UPDATE OF l`, [task.mechanic_id]);
      if (others.length) {
        await conn.query(
          "UPDATE technician_time_logs SET clock_out = NOW(), end_reason = 'pause', pause_reason = 'other_job' WHERE id IN (?)", [others.map(o => o.id)]);
        const taskIds = others.map(o => o.task_id).filter(Boolean);
        if (taskIds.length) await conn.query("UPDATE job_card_tasks SET status = 'paused' WHERE id IN (?) AND status = 'in_progress'", [taskIds]);
        paused = others.map(o => ({ job_card_id: o.job_card_id, job_card_number: o.job_card_number, work_order_number: o.work_order_number, job_name: o.job_name || null, task_id: o.task_id || null }));
      }
      await conn.query(
        `INSERT INTO technician_time_logs (workshop_id, job_card_id, task_id, mechanic_id, mechanic_name, clock_in, activity_notes)
         VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
        [workshopId, found.job_card_id, task.id, task.mechanic_id, found.mechanic_name || null, `Scan station: ${found.job_name}`.slice(0, 500)]);
      await conn.query(
        "UPDATE job_card_tasks SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), finished_at = NULL WHERE id = ?", [task.id]);
      await conn.query(
        `UPDATE job_cards SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
          WHERE id = ? AND status IN ('open','parts_requested','parts_issued','qc_failed')`, [found.job_card_id]);
      result = { action: task.status === 'done' ? 'rework' : 'started' };
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  const [now] = await query('SELECT NOW() AS at');
  const body = { success: true, action: result.action === 'rework' ? 'started' : result.action, rework: result.action === 'rework', at: now.at, job, paused };
  if (result.action === 'ended') {
    body.minutes = result.minutes;
    await logAudit(workshopId, userId, 'TIME_STOP', 'job_cards', found.job_card_id, null, { mechanic_id: found.mechanic_id, task_id: found.id, via: 'scan_station' });
    body.job_card_done = await finishJobCardIfAllDone({ jobCardId: found.job_card_id, workshopId, userId });
  } else {
    for (const p of paused) {
      await logAudit(workshopId, userId, 'TIME_PAUSE', 'job_cards', p.job_card_id, null, { mechanic_id: found.mechanic_id, task_id: p.task_id, pause_reason: 'other_job', moved_to: found.job_card_id, via: 'scan_station' });
    }
    await logAudit(workshopId, userId, 'TIME_START', 'job_cards', found.job_card_id, null, { mechanic_id: found.mechanic_id, task_id: found.id, via: 'scan_station' });
    body.work_order = await syncWorkOrderFromJobCards({ workOrderId: found.work_order_id, workshopId, userId, reason: `Work started on ${found.job_card_number} — ${found.job_name}` });
  }
  return { status: result.action === 'ended' ? 200 : 201, body };
}
