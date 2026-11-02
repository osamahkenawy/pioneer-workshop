/**
 * Intake option lists from the client's review (2026-11-02) — the keys match
 * the backend's lib/intake-rules.js.
 */

export const VEHICLE_TYPES = [
  { value: 'sedan', label: 'Sedan' },
  { value: 'crossover', label: 'Crossover' },
  { value: 'suv', label: 'SUV' },
  { value: 'medium_bus', label: 'Medium Bus' },
  { value: 'large_bus', label: 'Large Bus' },
  { value: 'medium_truck', label: 'Medium Truck' },
  { value: 'large_truck', label: 'Large Truck' },
  { value: 'hydraulic_equipment', label: 'Hydraulic equipment' },
];
export const vehicleTypeLabel = v => VEHICLE_TYPES.find(o => o.value === v)?.label || '';

/** Provisional until the client sends their list. */
export const JOB_TYPES = [
  { value: 'service', label: 'Service' },
  { value: 'repair', label: 'Repair' },
  { value: 'diagnostic', label: 'Diagnostic' },
  { value: 'bodywork', label: 'Bodywork' },
  { value: 'accident', label: 'Accident' },
  { value: 'other', label: 'Other' },
];
export const jobTypeLabel = v => JOB_TYPES.find(o => o.value === v)?.label || v;

/** The parts the customer accepts — any combination, at least one. */
export const PART_CATEGORIES = [
  { value: 'genuine', label: 'Genuine' },
  { value: 'after_market', label: 'After-Market' },
  { value: 'used', label: 'Used' },
];

/** 'genuine,used' / ['genuine','used'] / null → ['genuine','used'] (in the standard order). */
export const prefList = v => {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map(s => s.trim()) : [];
  return PART_CATEGORIES.map(c => c.value).filter(c => list.includes(c));
};
