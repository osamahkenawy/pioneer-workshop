/**
 * Intake rules from the client's review (2026-11-02):
 *
 *  - the vehicle: VIN, plate number, emirate and model year are required on
 *    the car booked in (the VIN check itself is VIN_REQUIRED in
 *    routes/work-orders.js); the vehicle type is one of VEHICLE_TYPES;
 *  - the odometer: required at intake, and never below the car's previous
 *    reading — for every role, managers included (no override);
 *  - the parts the customer accepts (Genuine / After-Market / Used), asked at
 *    the enquiry / work order and carried to the estimate;
 *  - the job types the Service Advisor ticks at Step 4 (multi-select).
 */
import { query } from './database.js';

// As lib/workflow.js PART_CATEGORIES (kept here so the two modules don't import each other).
const PART_CATEGORIES = ['genuine', 'after_market', 'used'];

export const VEHICLE_TYPES = {
  sedan: 'Sedan', crossover: 'Crossover', suv: 'SUV',
  medium_bus: 'Medium Bus', large_bus: 'Large Bus',
  medium_truck: 'Medium Truck', large_truck: 'Large Truck',
  hydraulic_equipment: 'Hydraulic equipment',
};

/** Provisional until the client sends their list (the old enquiry types). */
export const JOB_TYPES = {
  service: 'Service', repair: 'Repair', diagnostic: 'Diagnostic',
  bodywork: 'Bodywork', accident: 'Accident', other: 'Other',
};

/** A vehicle type key, null for blank; throws-style result { error } for an unknown one. */
export function parseVehicleType(v) {
  if (v === undefined) return { value: undefined };
  if (v === null || String(v).trim() === '') return { value: null };
  const key = String(v).trim().toLowerCase();
  return VEHICLE_TYPES[key] ? { value: key } : { error: `Vehicle type must be one of: ${Object.values(VEHICLE_TYPES).join(', ')}.` };
}

/** What a car booked in still lacks of the required details (VIN is checked separately). */
export function missingVehicleDetails(vehicle) {
  if (!vehicle) return [];
  const missing = [];
  if (!String(vehicle.plate_number || '').trim()) missing.push('plate number');
  if (!String(vehicle.plate_emirate || '').trim()) missing.push('emirate');
  if (!vehicle.year) missing.push('model year');
  return missing;
}
export const vehicleDetailsRequired = missing => ({
  code: 'VEHICLE_DETAILS_REQUIRED', missing,
  message: `The vehicle's ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required. Add ${missing.length > 1 ? 'them' : 'it'} to the vehicle before booking it in.`,
});

export const ODOMETER_REQUIRED = { code: 'ODOMETER_REQUIRED', message: 'The odometer reading is required — read it from the dashboard.' };

/**
 * The car's previous reading: for a new visit the highest of the vehicle
 * record and its visits (not cancelled); for an existing work order the
 * highest on the car's EARLIER visits, so correcting this one's own reading
 * is not refused. { last, work_order_number } or null.
 */
export async function previousOdometer({ vehicleId, workshopId, workOrderId = null, q = query }) {
  if (!vehicleId) return null;
  const [visit] = await q(
    `SELECT odometer_in AS reading, work_order_number FROM work_orders
      WHERE vehicle_id = ? AND workshop_id = ? AND odometer_in IS NOT NULL AND status <> 'cancelled'
        ${workOrderId ? 'AND id < ?' : ''}
      ORDER BY odometer_in DESC LIMIT 1`,
    workOrderId ? [vehicleId, workshopId, workOrderId] : [vehicleId, workshopId]
  );
  let best = visit ? { last: Number(visit.reading), work_order_number: visit.work_order_number } : null;
  if (!workOrderId) {
    const [v] = await q('SELECT mileage FROM vehicles WHERE id = ? AND workshop_id = ?', [vehicleId, workshopId]);
    if (v?.mileage != null && (!best || Number(v.mileage) > best.last)) best = { last: Number(v.mileage), work_order_number: null };
  }
  return best;
}

/**
 * The odometer check: null when the reading may be saved, else
 * { status, body } to send. A lower reading is refused whoever enters it;
 * a missing reading is the caller's to judge.
 */
export async function checkOdometer({ reading, vehicleId, workshopId, workOrderId = null, q = query }) {
  if (reading == null || !vehicleId) return null;
  const prev = await previousOdometer({ vehicleId, workshopId, workOrderId, q });
  if (!prev || reading >= prev.last) return null;
  const fmt = n => Number(n).toLocaleString('en-US');
  const where = prev.work_order_number ? ` on ${prev.work_order_number}` : ' on the vehicle record';
  return { status: 400, body: { success: false, code: 'ODOMETER_BELOW_LAST', last_mileage: prev.last,
    message: `The odometer reading (${fmt(reading)} km) is below the car's previous reading (${fmt(prev.last)} km${where}). Check the dashboard — the new reading must be the same or higher.` } };
}

/** A parts preference from the body: an array or 'genuine,used'; undefined = not sent, null = cleared. */
export function parsePartsPreference(v) {
  if (v === undefined) return { value: undefined };
  if (v === null || v === '' || (Array.isArray(v) && !v.length)) return { value: null };
  const list = Array.isArray(v) ? v : String(v).split(',');
  const clean = list.map(s => String(s).trim().toLowerCase().replace('-', '_').replace('aftermarket', 'after_market'));
  if (clean.some(c => !PART_CATEGORIES.includes(c))) return { error: 'Parts preference must be Genuine, After-Market and/or Used.' };
  return { value: PART_CATEGORIES.filter(c => clean.includes(c)).join(',') };
}

/** Job types from the body: an array of keys; [] / null clears. */
export function parseJobTypes(v) {
  if (v === undefined) return { value: undefined };
  if (v === null || (Array.isArray(v) && !v.length)) return { value: null };
  const list = Array.isArray(v) ? v : String(v).split(',');
  const clean = [...new Set(list.map(s => String(s).trim().toLowerCase()))];
  if (clean.some(c => !JOB_TYPES[c])) return { error: `Job type must be one of: ${Object.values(JOB_TYPES).join(', ')}.` };
  return { value: JSON.stringify(Object.keys(JOB_TYPES).filter(k => clean.includes(k))) };
}

/** work_orders.job_types as an array. */
export const jobTypesOf = row => {
  try { const v = typeof row?.job_types === 'string' ? JSON.parse(row.job_types) : row?.job_types; return Array.isArray(v) ? v : []; }
  catch { return []; }
};
