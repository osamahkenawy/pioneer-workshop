/**
 * technician-availability.js — may this technician be given work now, and
 * what is each technician doing?
 *
 * Client meeting, 3 Nov 2026, point 13: availability (shifts, leave,
 * absence) will come from the HR system. Until it is connected a technician
 * is available when their record is active. Everything that offers or
 * assigns a technician per job (lib/job-tasks.js, routes/job-tasks.js) asks
 * here, so the HR feed plugs in at this one place.
 *
 * technicianRoster() is what the technician picker shows (client feedback,
 * 16 Nov 2026, point 4: "it doesn't show me the availability"): each
 * technician's state now, their open jobs, today's booked and worked time,
 * their team and their skills — one call, worked out on the server.
 */
import { query } from './database.js';

/**
 * Map of mechanic id → { available, reason } for the ids given (unknown ids
 * are left out). `reason` says why not, for the screen.
 */
export async function technicianAvailability(mechanicIds, workshopId) {
  const ids = [...new Set((mechanicIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await query('SELECT id, is_active FROM mechanics WHERE workshop_id = ? AND id IN (?)', [workshopId, ids]);
  // HR system: look up today's shift / leave here and fold it into `available`.
  return new Map(rows.map(r => [r.id, Number(r.is_active)
    ? { available: true, reason: null }
    : { available: false, reason: 'inactive' }]));
}

/** Job card statuses a technician works on (as lib/job-tasks.js). */
const WORKABLE = ['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_failed'];

/** mechanics.skills → the service type keys, or null when never recorded. */
function skillsOf(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return Array.isArray(v) ? v.map(String) : null;
}

/**
 * The active technicians to offer when assigning, with what each is doing.
 *
 *   leaderId   only this team leader's technicians (a team leader assigns from their own team)
 *
 * Each: { id, full_name, specialty, skills (service type keys, null = not
 * recorded), team_leader_id, team_leader_name, state, available,
 * unavailable_reason, running, open_jobs, booked_min_today, worked_min_today }
 *
 * state:
 *   working    a clock of theirs is running (`running` says on which job, since when)
 *   on_break   mechanics.status on_break
 *   off        offline, or not available (HR)
 *   busy       has open jobs (not finished, on live work) but no clock running
 *   available  nothing open
 * mechanics.status is self-reported and drifts, so 'busy' there is not
 * trusted (as the Team Board): open jobs decide it.
 *
 * open_jobs: their open jobs (job_card_tasks) plus live job cards of theirs
 * whose jobs nobody has been given yet (work assigned as a whole).
 */
export async function technicianRoster({ workshopId, leaderId = null }) {
  const techs = await query(
    `SELECT m.id, m.full_name, m.specialty, m.status, m.skills, m.team_leader_id, u.full_name AS team_leader_name
       FROM mechanics m LEFT JOIN users u ON u.id = m.team_leader_id
      WHERE m.workshop_id = ? AND m.is_active = 1 ${leaderId ? 'AND m.team_leader_id = ?' : ''}
      ORDER BY m.full_name LIMIT 1000`,
    leaderId ? [workshopId, leaderId] : [workshopId]);
  if (!techs.length) return [];
  const ids = techs.map(t => t.id);

  const [avail, running, openTasks, openCards, booked, worked] = await Promise.all([
    technicianAvailability(ids, workshopId),
    query(
      `SELECT l.mechanic_id, l.clock_in, t.job_name, jc.job_card_number, wo.id AS work_order_id, wo.work_order_number
         FROM technician_time_logs l
         JOIN job_cards jc ON jc.id = l.job_card_id
         JOIN work_orders wo ON wo.id = jc.work_order_id
         LEFT JOIN job_card_tasks t ON t.id = l.task_id
        WHERE l.workshop_id = ? AND l.clock_out IS NULL AND l.mechanic_id IN (?)
        ORDER BY l.clock_in DESC`, [workshopId, ids]),
    query(
      `SELECT t.mechanic_id, COUNT(*) AS n
         FROM job_card_tasks t
         JOIN job_cards jc ON jc.id = t.job_card_id
         JOIN work_orders wo ON wo.id = t.work_order_id
        WHERE t.workshop_id = ? AND t.mechanic_id IN (?) AND t.status IN ('open','in_progress','paused')
          AND jc.status IN (?) AND wo.status NOT IN ('completed','cancelled')
        GROUP BY t.mechanic_id`, [workshopId, ids, WORKABLE]),
    query(
      `SELECT jc.mechanic_id, COUNT(*) AS n
         FROM job_cards jc
         JOIN work_orders wo ON wo.id = jc.work_order_id
        WHERE jc.workshop_id = ? AND jc.mechanic_id IN (?) AND jc.status IN (?) AND wo.status NOT IN ('completed','cancelled')
          AND NOT EXISTS (SELECT 1 FROM job_card_tasks t
                           WHERE t.job_card_id = jc.id AND t.mechanic_id IS NOT NULL AND t.status IN ('open','in_progress','paused'))
        GROUP BY jc.mechanic_id`, [workshopId, ids, WORKABLE]),
    // Booked windows (Team Board) that fall today, minutes within today.
    query(
      `SELECT wa.mechanic_id,
              SUM(GREATEST(0, TIMESTAMPDIFF(MINUTE, GREATEST(wa.scheduled_start_at, CURDATE()),
                                            LEAST(COALESCE(wa.scheduled_end_at, wa.scheduled_start_at), CURDATE() + INTERVAL 1 DAY)))) AS minutes
         FROM work_order_assignments wa
         JOIN work_orders wo ON wo.id = wa.work_order_id
        WHERE wa.is_current = 1 AND wo.workshop_id = ? AND wa.mechanic_id IN (?) AND wo.status NOT IN ('completed','cancelled')
          AND wa.scheduled_start_at IS NOT NULL AND wa.scheduled_start_at < CURDATE() + INTERVAL 1 DAY
          AND COALESCE(wa.scheduled_end_at, wa.scheduled_start_at) > CURDATE()
        GROUP BY wa.mechanic_id`, [workshopId, ids]),
    // Time on the clock today (a clock still running counts up to now).
    query(
      `SELECT mechanic_id,
              SUM(GREATEST(0, TIMESTAMPDIFF(MINUTE, GREATEST(clock_in, CURDATE()), COALESCE(clock_out, NOW())))) AS minutes
         FROM technician_time_logs
        WHERE workshop_id = ? AND mechanic_id IN (?) AND clock_in < CURDATE() + INTERVAL 1 DAY
          AND (clock_out IS NULL OR clock_out >= CURDATE())
        GROUP BY mechanic_id`, [workshopId, ids]),
  ]);

  const count = rows => new Map(rows.map(r => [r.mechanic_id, Number(r.n || r.minutes || 0)]));
  const runningBy = new Map();
  for (const r of running) if (!runningBy.has(r.mechanic_id)) runningBy.set(r.mechanic_id, r);
  const tasksBy = count(openTasks), cardsBy = count(openCards), bookedBy = count(booked), workedBy = count(worked);

  return techs.map(m => {
    const a = avail.get(m.id) || { available: false, reason: 'unknown' };
    const run = runningBy.get(m.id) || null;
    const open = (tasksBy.get(m.id) || 0) + (cardsBy.get(m.id) || 0);
    const state = !a.available ? 'off'
      : run ? 'working'
        : m.status === 'on_break' ? 'on_break'
          : m.status === 'offline' ? 'off'
            : open > 0 ? 'busy' : 'available';
    return {
      id: m.id, full_name: m.full_name, specialty: m.specialty || null, skills: skillsOf(m.skills),
      team_leader_id: m.team_leader_id || null, team_leader_name: m.team_leader_name || null,
      state, available: a.available, unavailable_reason: a.available ? null : a.reason,
      running: run ? {
        since: run.clock_in, job_name: run.job_name || null, job_card_number: run.job_card_number,
        work_order_id: run.work_order_id, work_order_number: run.work_order_number,
      } : null,
      open_jobs: open,
      booked_min_today: bookedBy.get(m.id) || 0,
      worked_min_today: workedBy.get(m.id) || 0,
    };
  });
}
