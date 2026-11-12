/**
 * technician-availability.js — may this technician be given work now?
 *
 * Client meeting, 3 Nov 2026, point 13: availability (shifts, leave,
 * absence) will come from the HR system. Until it is connected a technician
 * is available when their record is active. Everything that offers or
 * assigns a technician per job (lib/job-tasks.js, routes/job-tasks.js) asks
 * here, so the HR feed plugs in at this one place.
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
