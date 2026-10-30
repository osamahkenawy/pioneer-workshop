/**
 * statusLabels.js — the workshop's words for work order and job card states
 * (Steps 1–7). Every screen, chip, filter and message reads its status text
 * from here instead of keeping its own map.
 *
 * Labels only: the stored values do not change (`ready_for_pickup` is still
 * what the API sends and expects). The back end has the same tables in
 * English in car-workshop-backend/src/lib/status-labels.js — change a word in
 * both places.
 *
 * i18n: every label is `t('<key>', '<English default>')` in the namespaces
 * woStatus.* and jobStatus.*, so the English shows until a locale has the key.
 * Do not point these at the old keys (statuses.*, orders.status.*,
 * workflow.jc_status.*, mechanicDashboard.jc_status_*): their "Ready for
 * Pickup" values would win over the default.
 *
 * Every function that takes `t` also works with t = null (plain English), for
 * code outside React.
 *
 * A work order is labelled in two steps:
 *   1. woDisplayKey(wo) turns the stored status (plus customer_approved_at)
 *      into a display key — one of WO_DISPLAY_KEYS;
 *   2. woLabel(t, wo, audience) / woTone(wo) look the key up.
 *
 *   stored status                              display key     staff label            tone
 *   pending                                    checked_in      Checked in             slate
 *   confirmed                                  inspected       Inspected              sky
 *   pending/confirmed + customer_approved_at,
 *     estimate_approved, auto_assign           approved        Approved — to assign   indigo
 *   assigned, accepted                         assigned        Technician assigned    violet
 *   in_progress                                in_work         Work in progress       cyan
 *   inspection                                 quality_check   Quality check          purple
 *   ready_for_pickup                           ready           Ready for collection   orange
 *   completed                                  closed          Closed                 green
 *   cancelled                                  cancelled       Cancelled              grey
 *
 * An "approved" job that still waits for the physical inspection (an
 * external customer who agreed a quote before the car was walked round: no
 * job card yet, nothing for the Team Leader to assign) reads "Approved —
 * physical inspection first" (sky) for staff when the work order carries
 * awaiting_physical_inspection (GET /work-orders and /work-orders/:id send it).
 *
 * Technicians never see the work order status; their job card says
 * "QC passed" (jcLabel(t, 'qc_passed')).
 *
 * @example
 *   const tone = woTone(wo);
 *   const Icon = tone.icon;
 *   <span style={{ background: tone.bg, color: tone.color }}><Icon width={12} height={12} /> {woLabel(t, wo)}</span>
 */
import {
  PasteClipboard, Search, CheckCircle, User, Wrench, ShieldCheck, Car, Check, Prohibition,
  Clock, Package, BoxIso, Hourglass, Repeat, Page, Play, Pause, Square,
} from 'iconoir-react';

// ─── Shared bits ──────────────────────────────────────────────

/** Fills {{name}} placeholders, as i18next does. */
function fill(text, vars) {
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name) => (vars && vars[name] != null ? String(vars[name]) : ''));
}

/**
 * `t` when it is a function, otherwise a stand-in with the same
 * `(key, englishDefault, vars)` call shape that returns the English default
 * with {{vars}} filled in. For helpers called with t = null.
 *
 * @param {Function|null|undefined} t  react-i18next's t
 * @returns {(key: string, def?: string, vars?: object) => string}
 */
export function safeT(t) {
  return typeof t === 'function' ? t : (key, def, vars) => fill(typeof def === 'string' ? def : key, vars);
}

/** "some_value" → "Some value", for a status this file does not know. */
function humanize(value) {
  const s = String(value ?? '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * Chip colours: a light background with a dark text colour of the same hue
 * (every pair is at least 4.5:1). `bg`/`color` are plain hex values for
 * inline styles.
 */
export const TONES = Object.freeze({
  slate:  Object.freeze({ bg: '#f1f5f9', color: '#334155' }),
  sky:    Object.freeze({ bg: '#e0f2fe', color: '#0369a1' }),
  indigo: Object.freeze({ bg: '#e0e7ff', color: '#4338ca' }),
  violet: Object.freeze({ bg: '#ede9fe', color: '#6d28d9' }),
  cyan:   Object.freeze({ bg: '#cffafe', color: '#0e7490' }),
  purple: Object.freeze({ bg: '#f3e8ff', color: '#7e22ce' }),
  orange: Object.freeze({ bg: '#ffedd5', color: '#c2410c' }),
  green:  Object.freeze({ bg: '#dcfce7', color: '#15803d' }),
  grey:   Object.freeze({ bg: '#f3f4f6', color: '#4b5563' }),
  amber:  Object.freeze({ bg: '#fef3c7', color: '#b45309' }),
  red:    Object.freeze({ bg: '#fee2e2', color: '#b91c1c' }),
  teal:   Object.freeze({ bg: '#ccfbf1', color: '#0f766e' }),
});

/** { tone, bg, color, icon } for a tone name and an iconoir component. */
function toneOf(tone, icon) {
  return { tone, ...TONES[tone], icon };
}

// ─── Work orders ──────────────────────────────────────────────

/** Every value of work_orders.status, in workflow order. */
export const WO_STATUSES = Object.freeze([
  'pending', 'confirmed', 'estimate_approved', 'auto_assign', 'assigned', 'accepted',
  'in_progress', 'inspection', 'ready_for_pickup', 'completed', 'cancelled',
]);

/** Display keys in workflow order (use it to order chips, stats and charts). */
export const WO_DISPLAY_KEYS = Object.freeze([
  'checked_in', 'inspected', 'approved', 'assigned', 'in_work', 'quality_check', 'ready', 'closed', 'cancelled',
]);

/** Stored status → display key, before the customer-approval rule in woDisplayKey(). */
const STATUS_TO_KEY = Object.freeze({
  pending: 'checked_in',
  confirmed: 'inspected',
  estimate_approved: 'approved',
  auto_assign: 'approved',
  assigned: 'assigned',
  accepted: 'assigned',   // the courier "driver accepted" step; a workshop job is simply assigned
  in_progress: 'in_work',
  inspection: 'quality_check',
  ready_for_pickup: 'ready',
  completed: 'closed',
  cancelled: 'cancelled',
});

/**
 * English defaults by audience; the i18n key is `woStatus.<audience>.<display key>`.
 *   staff    — lists, job card page, dashboard, filters
 *   short    — chips and tight table cells
 *   customer — status page, portal, WhatsApp
 */
export const WO_LABELS = Object.freeze({
  staff: Object.freeze({
    checked_in: 'Checked in',
    inspected: 'Inspected',
    approved: 'Approved — to assign',
    assigned: 'Technician assigned',
    in_work: 'Work in progress',
    quality_check: 'Quality check',
    ready: 'Ready for collection',
    closed: 'Closed',
    cancelled: 'Cancelled',
  }),
  short: Object.freeze({
    checked_in: 'Checked in',
    inspected: 'Inspected',
    approved: 'Approved',
    assigned: 'Assigned',
    in_work: 'In work',
    quality_check: 'QC',
    ready: 'Ready',
    closed: 'Closed',
    cancelled: 'Cancelled',
  }),
  customer: Object.freeze({
    checked_in: 'Vehicle received',
    inspected: 'Inspection & estimate',
    approved: 'Work approved',
    assigned: 'Repair scheduled',
    in_work: 'Repair in progress',
    quality_check: 'Final quality check',
    ready: 'Ready for collection',
    closed: 'Completed',
    cancelled: 'Cancelled — contact us',
  }),
});

/** Staff words for an approved job still waiting for the physical inspection (see the header). */
const WO_APPROVED_INSPECTION_FIRST = Object.freeze({
  staff: 'Approved — physical inspection first',
  short: 'Approved — inspect first',
});
const inspectionFirst = (woOrStatus, key) => key === 'approved' && !!Number(woOrStatus?.awaiting_physical_inspection);

const WO_TONES = Object.freeze({
  checked_in: toneOf('slate', PasteClipboard),
  inspected: toneOf('sky', Search),
  approved: toneOf('indigo', CheckCircle),
  assigned: toneOf('violet', User),
  in_work: toneOf('cyan', Wrench),
  quality_check: toneOf('purple', ShieldCheck),
  ready: toneOf('orange', Car),
  closed: toneOf('green', Check),
  cancelled: toneOf('grey', Prohibition),
});

/**
 * The display key for a work order.
 *
 * @param {string|{status?: string, customer_approved_at?: (string|null)}} woOrStatus
 *   A work order (only `status` and `customer_approved_at` are read) or a
 *   bare status. Pass the work order when you have it: a pending or confirmed
 *   job the customer has approved is "approved", which a bare status cannot
 *   show. Do not pass a job card — its `status` is the job card's.
 * @returns {string|null} one of WO_DISPLAY_KEYS, or null for an unknown status.
 *
 * @example woDisplayKey('ready_for_pickup')                                        // 'ready'
 * @example woDisplayKey({ status: 'confirmed', customer_approved_at: '2026-10-13' }) // 'approved'
 */
export function woDisplayKey(woOrStatus) {
  const wo = woOrStatus && typeof woOrStatus === 'object' ? woOrStatus : null;
  const status = wo ? wo.status : woOrStatus;
  const key = STATUS_TO_KEY[status];
  if (!key) return null;
  if ((status === 'pending' || status === 'confirmed') && wo?.customer_approved_at) return 'approved';
  return key;
}

/**
 * The label for a work order's status.
 *
 * @param {Function|null} t  react-i18next's t (null = English)
 * @param {string|object} woOrStatus  see woDisplayKey().
 * @param {'staff'|'short'|'customer'} [audience='staff']
 * @returns {string} e.g. "Ready for collection". An unknown status comes back
 *   humanized ("some_value" → "Some value"), never as the raw enum.
 *
 * @example woLabel(t, wo)                       // 'Work in progress'
 * @example woLabel(t, 'in_progress', 'short')   // 'In work'
 * @example woLabel(t, wo, 'customer')           // 'Repair in progress'
 */
export function woLabel(t, woOrStatus, audience = 'staff') {
  const key = woDisplayKey(woOrStatus);
  if (!key) return humanize(woOrStatus && typeof woOrStatus === 'object' ? woOrStatus.status : woOrStatus);
  const aud = WO_LABELS[audience] ? audience : 'staff';
  if (inspectionFirst(woOrStatus, key) && WO_APPROVED_INSPECTION_FIRST[aud]) {
    return safeT(t)(`woStatus.${aud}.approved_inspection_first`, WO_APPROVED_INSPECTION_FIRST[aud]);
  }
  return safeT(t)(`woStatus.${aud}.${key}`, WO_LABELS[aud][key]);
}

/**
 * Chip colours and icon for a work order's status.
 *
 * @param {string|object} woOrStatus  see woDisplayKey().
 * @returns {{tone: string, bg: string, color: string, icon: Function}}
 *   `icon` is an iconoir-react component (PasteClipboard, Search,
 *   CheckCircle, User, Wrench, ShieldCheck, Car, Check, Prohibition by
 *   step). An unknown status gets slate with a Clock.
 */
export function woTone(woOrStatus) {
  const key = woDisplayKey(woOrStatus);
  if (inspectionFirst(woOrStatus, key)) return toneOf('sky', Search);
  return WO_TONES[key] || toneOf('slate', Clock);
}

/**
 * Status filters for work order lists, in order: Waiting (checked in,
 * inspected, approved) · Technician assigned · Work in progress · Quality
 * check · Ready for collection · Closed · Cancelled. "Accepted" never shows
 * on its own. Send `statuses` to the API; label with woFilterLabel().
 */
export const WO_FILTERS = Object.freeze([
  { key: 'waiting', statuses: ['pending', 'confirmed', 'estimate_approved', 'auto_assign'] },
  { key: 'assigned', statuses: ['assigned', 'accepted'] },
  { key: 'in_work', statuses: ['in_progress'] },
  { key: 'quality_check', statuses: ['inspection'] },
  { key: 'ready', statuses: ['ready_for_pickup'] },
  { key: 'closed', statuses: ['completed'] },
  { key: 'cancelled', statuses: ['cancelled'] },
].map(f => Object.freeze({ ...f, statuses: Object.freeze(f.statuses) })));

/**
 * The label for a WO_FILTERS key: 'waiting' → "Waiting"
 * (woStatus.filter.waiting); the others use the staff label of the same
 * display key ("Technician assigned", "Ready for collection", …).
 *
 * @param {Function|null} t
 * @param {string} key  a WO_FILTERS key
 * @returns {string}
 */
export function woFilterLabel(t, key) {
  if (key === 'waiting') return safeT(t)('woStatus.filter.waiting', 'Waiting');
  if (!WO_LABELS.staff[key]) return humanize(key);
  return safeT(t)(`woStatus.staff.${key}`, WO_LABELS.staff[key]);
}

/**
 * The WO_FILTERS key a work order falls under ('waiting', 'assigned', …).
 * @param {string|object} woOrStatus  a status or a work order with `status`.
 * @returns {string|null}
 */
export function woFilterKey(woOrStatus) {
  const status = woOrStatus && typeof woOrStatus === 'object' ? woOrStatus.status : woOrStatus;
  return WO_FILTERS.find(f => f.statuses.includes(status))?.key || null;
}

// ─── Job cards ────────────────────────────────────────────────

/**
 * English defaults for job_cards.status; the i18n key is `jobStatus.<status>`.
 * One set for staff and technicians. qc_passed and ready_for_billing read the
 * same: billing is not the technician's business.
 */
export const JC_LABELS = Object.freeze({
  open: 'Not started',
  parts_requested: 'Waiting for parts',
  parts_issued: 'Parts issued — collect from the Store',
  in_progress: 'In progress',
  qc_pending: 'Job done — waiting for quality check',
  qc_failed: 'Rework needed',
  qc_passed: 'QC passed',
  ready_for_billing: 'QC passed',
  billed: 'Invoiced',
  cancelled: 'Cancelled',
});

/** Every value of job_cards.status, in workflow order. */
export const JC_STATUSES = Object.freeze(Object.keys(JC_LABELS));

const JC_TONES = Object.freeze({
  open: toneOf('slate', Clock),
  parts_requested: toneOf('amber', Package),
  parts_issued: toneOf('teal', BoxIso),
  in_progress: toneOf('cyan', Wrench),
  qc_pending: toneOf('purple', Hourglass),
  qc_failed: toneOf('red', Repeat),
  qc_passed: toneOf('green', ShieldCheck),
  ready_for_billing: toneOf('green', ShieldCheck),
  billed: toneOf('indigo', Page),
  cancelled: toneOf('grey', Prohibition),
});

/**
 * The label for a job card status.
 * @param {Function|null} t
 * @param {string} status  job_cards.status
 * @returns {string} e.g. "Rework needed"; an unknown value comes back humanized.
 */
export function jcLabel(t, status) {
  if (!JC_LABELS[status]) return humanize(status);
  return safeT(t)(`jobStatus.${status}`, JC_LABELS[status]);
}

/**
 * Chip colours and icon for a job card status.
 * @param {string} status  job_cards.status
 * @returns {{tone: string, bg: string, color: string, icon: Function}}
 */
export function jcTone(status) {
  return JC_TONES[status] || toneOf('slate', Clock);
}

// ─── Time booked on a job card (Start / Pause / Stop) ─────────

/**
 * Clock states of one job card for one technician, as GET /job-cards/mine
 * sends them in `time_state`:
 *   idle    — no time booked yet          "Not started"
 *   running — the clock is on             "Working"
 *   paused  — last booking ended 'pause'  "Paused" / "Paused · Break"
 *   stopped — last booking ended 'stop'   "Stopped"
 * The i18n key is `jobStatus.time.<state>`.
 */
export const TIME_STATES = Object.freeze(['idle', 'running', 'paused', 'stopped']);

export const TIME_STATE_LABELS = Object.freeze({
  idle: 'Not started',
  running: 'Working',
  paused: 'Paused',
  stopped: 'Stopped',
});

const TIME_STATE_TONES = Object.freeze({
  idle: toneOf('slate', Clock),
  running: toneOf('green', Play),
  paused: toneOf('amber', Pause),
  stopped: toneOf('grey', Square),
});

/**
 * Why a technician paused the clock (POST /job-cards/:id/time/pause
 * `{reason, note}`). 'other' needs a note of up to PAUSE_NOTE_MAX characters.
 * The i18n key is `jobStatus.pause.<reason>`.
 */
export const PAUSE_REASONS = Object.freeze(['break', 'waiting_parts', 'waiting_info', 'other_job', 'other']);

export const PAUSE_REASON_LABELS = Object.freeze({
  break: 'Break',
  waiting_parts: 'Waiting for parts',
  waiting_info: 'Waiting for information or approval',
  other_job: 'Moved to another job',
  other: 'Other',
});

/** Longest pause note the server stores (technician_time_logs.end_note). */
export const PAUSE_NOTE_MAX = 255;

/**
 * The clock state of a job card from the API: `time_state` when the server
 * sent one, otherwise 'running' when `running_since` is set, else 'idle'.
 *
 * @param {{time_state?: string, running_since?: string|null}} card
 * @returns {'idle'|'running'|'paused'|'stopped'}
 */
export function jcTimeState(card) {
  if (TIME_STATES.includes(card?.time_state)) return card.time_state;
  return card?.running_since ? 'running' : 'idle';
}

/**
 * The clock state from one technician's time logs on one card (e.g. the
 * `time_logs[]` of GET /job-cards/mine/:id), oldest first — the server's rule.
 *
 * @param {Array<{clock_in: string, clock_out: (string|null), end_reason?: ('pause'|'stop'|null)}>} logs
 * @returns {'idle'|'running'|'paused'|'stopped'}
 */
export function timeStateFromLogs(logs) {
  const list = Array.isArray(logs) ? logs : [];
  if (list.some(l => !l.clock_out)) return 'running';
  const last = list[list.length - 1];
  if (last?.end_reason === 'pause') return 'paused';
  if (last?.end_reason === 'stop') return 'stopped';
  return 'idle';
}

/**
 * The label for a pause reason.
 * @param {Function|null} t
 * @param {string} reason  one of PAUSE_REASONS
 * @returns {string|null} null when there is no (known) reason.
 */
export function pauseReasonLabel(t, reason) {
  if (!PAUSE_REASON_LABELS[reason]) return null;
  return safeT(t)(`jobStatus.pause.${reason}`, PAUSE_REASON_LABELS[reason]);
}

/**
 * The label for a clock state, with the pause reason when there is one
 * (jobStatus.time.paused_reason = "Paused · {{reason}}").
 *
 * @param {Function|null} t
 * @param {'idle'|'running'|'paused'|'stopped'} state
 * @param {string|null} [pauseReason]  only used when state is 'paused'.
 * @returns {string}
 *
 * @example timeStateLabel(t, 'paused', card.last_pause_reason)  // 'Paused · Waiting for parts'
 * @example timeStateLabel(t, jcTimeState(card))                 // 'Working'
 */
export function timeStateLabel(t, state, pauseReason) {
  const tt = safeT(t);
  const reason = state === 'paused' ? pauseReasonLabel(t, pauseReason) : null;
  if (reason) return tt('jobStatus.time.paused_reason', 'Paused · {{reason}}', { reason });
  if (!TIME_STATE_LABELS[state]) return humanize(state);
  return tt(`jobStatus.time.${state}`, TIME_STATE_LABELS[state]);
}

/**
 * Colours and icon for a clock state: running green (Play), paused amber
 * (Pause), not started slate (Clock), stopped grey (Square).
 * @param {string} state
 * @returns {{tone: string, bg: string, color: string, icon: Function}}
 */
export function timeStateTone(state) {
  return TIME_STATE_TONES[state] || TIME_STATE_TONES.idle;
}
