/**
 * The jobs / services the technical report offers (TechnicalInspection.jsx,
 * the "Job / service" field of each service line).
 *
 * PROVISIONAL — the client has not settled the list yet (client meeting,
 * 3 Nov 2026). This is the one place to change it: add, rename or remove
 * names here and nothing else needs to change. A job that is not on the list
 * is still written under "Other — type it", and reports already saved keep
 * their job names as they are. The server takes any name (no list there).
 *
 * The first names come from the workshop's most frequent labour lines on its
 * past invoices. The service type of each line is a separate, required
 * choice: JOB_TYPES in lib/intakeOptions.js (the backend's twin is
 * lib/intake-rules.js) — also provisional.
 */
export const SERVICE_JOBS = [
  'Periodic maintenance service',
  'Lube service (engine oil and filter)',
  'Check and report (diagnosis)',
  'Front brake pads replacement',
  'Rear brake pads replacement',
  'Brake disc skimming',
  'Transmission fluid (ATF) replacement',
  'Spark plugs replacement',
  'Battery replacement',
  'Drive belt replacement',
  'Throttle body cleaning',
  'AC gas recharge',
  'AC filter replacement',
  'AC condenser cleaning / replacement',
  'AC compressor replacement',
  'Radiator replacement',
  'Wheel alignment',
  'Wheel bearing replacement',
  'Shock absorber replacement',
  'Bumper repair / replacement',
  'Accident repair',
  'Body paint',
];

/** True when `name` is one of the listed jobs (as written there). */
export const isListedJob = name => SERVICE_JOBS.includes(String(name || '').trim());
