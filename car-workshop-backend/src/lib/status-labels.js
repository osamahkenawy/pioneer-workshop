/**
 * status-labels.js — the workshop's words for work order and job card states
 * (Steps 1–7), for everything the server writes: API messages, SMS, email,
 * push, PDFs.
 *
 * Labels only. The database values never change: `ready_for_pickup` is still
 * stored, and the internal keys (template_key 'order_ready_for_pickup', the
 * capability 'delivery.handover', work_order_contacts.purpose 'pickup',
 * JC_WORK_DONE / JC_QC_PASSED in lib/workflow.js) stay as they are.
 *
 * English only. The front end has the same tables, translated, in
 * car-workshop-frontend/src/lib/statusLabels.js (i18n namespaces woStatus.*
 * and jobStatus.*). Change a word in both places.
 *
 * A work order is labelled in two steps:
 *   1. woDisplayKey(row) turns the stored status (plus customer_approved_at)
 *      into a display key — one of WO_DISPLAY_KEYS;
 *   2. woLabel(row, audience) looks the key up for the audience.
 *
 *   stored status                              display key     staff label
 *   pending                                    checked_in      Checked in
 *   confirmed                                  inspected       Inspected
 *   pending/confirmed + customer_approved_at,
 *     estimate_approved, auto_assign           approved        Approved — to assign
 *   assigned, accepted                         assigned        Technician assigned
 *   in_progress                                in_work         Work in progress
 *   inspection                                 quality_check   Quality check
 *   ready_for_pickup                           ready           Ready for collection
 *   completed                                  closed          Closed
 *   cancelled                                  cancelled       Cancelled
 *
 * An "approved" job that still waits for the physical inspection (an
 * external customer who agreed a quote before the car was walked round: no
 * job card yet, nothing for the Team Leader to assign) reads "Approved —
 * physical inspection first" for staff, when the row carries
 * awaiting_physical_inspection (lib/physical-inspection.js AWAITING_PHYSICAL_SQL).
 *
 * Technicians never see the work order status; their job card says
 * "QC passed" (jcLabel('qc_passed')).
 */

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
 * Work order labels by audience.
 *   staff    — lists, job card page, dashboard, filters
 *   short    — chips and tight table cells
 *   customer — SMS, email, status page, portal, WhatsApp
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
export const WO_APPROVED_INSPECTION_FIRST = Object.freeze({
  staff: 'Approved — physical inspection first',
  short: 'Approved — inspect first',
});

/**
 * Status filters for work order lists. "Waiting" covers checked in,
 * inspected and approved; "accepted" is folded into Technician assigned and
 * never shown on its own.
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

/** "some_value" → "Some value", for a status this file does not know. */
function humanize(value) {
  const s = String(value ?? '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * The display key for a work order.
 *
 * @param {string|{status?: string, customer_approved_at?: (string|Date|null)}} rowOrStatus
 *   A work_orders row (only `status` and `customer_approved_at` are read) or
 *   a bare status. Pass the row when you have it: a pending or confirmed job
 *   the customer has approved is "approved", which a bare status cannot show.
 *   Do not pass a job card row — its `status` is the job card's.
 * @returns {string|null} one of WO_DISPLAY_KEYS, or null for an unknown status.
 *
 * @example woDisplayKey('ready_for_pickup')                                     // 'ready'
 * @example woDisplayKey({ status: 'pending', customer_approved_at: new Date() }) // 'approved'
 */
export function woDisplayKey(rowOrStatus) {
  const row = rowOrStatus && typeof rowOrStatus === 'object' ? rowOrStatus : null;
  const status = row ? row.status : rowOrStatus;
  const key = STATUS_TO_KEY[status];
  if (!key) return null;
  if ((status === 'pending' || status === 'confirmed') && row?.customer_approved_at) return 'approved';
  return key;
}

/**
 * The label for a work order's status.
 *
 * @param {string|object} rowOrStatus  see woDisplayKey().
 * @param {'staff'|'short'|'customer'} [audience='staff']
 * @returns {string} e.g. "Ready for collection". An unknown status comes back
 *   humanized ("some_value" → "Some value"), never as the raw enum.
 *
 * @example woLabel('ready_for_pickup')              // 'Ready for collection'
 * @example woLabel('in_progress', 'customer')       // 'Repair in progress'
 * @example `Status updated: ${woLabel(newStatus)}`  // API message
 */
export function woLabel(rowOrStatus, audience = 'staff') {
  const key = woDisplayKey(rowOrStatus);
  const table = WO_LABELS[audience] || WO_LABELS.staff;
  if (key === 'approved' && Number(rowOrStatus?.awaiting_physical_inspection)) {
    const first = WO_APPROVED_INSPECTION_FIRST[WO_LABELS[audience] ? audience : 'staff'];
    if (first) return first;
  }
  if (key) return table[key];
  const raw = rowOrStatus && typeof rowOrStatus === 'object' ? rowOrStatus.status : rowOrStatus;
  return humanize(raw);
}

/**
 * The WO_FILTERS key a work order falls under ('waiting', 'assigned', …).
 * @param {string|object} rowOrStatus  a status or a row with `status`.
 * @returns {string|null}
 */
export function woFilterKey(rowOrStatus) {
  const status = rowOrStatus && typeof rowOrStatus === 'object' ? rowOrStatus.status : rowOrStatus;
  return WO_FILTERS.find(f => f.statuses.includes(status))?.key || null;
}

// ─── Job cards ────────────────────────────────────────────────

/**
 * Job card labels — one set for staff and technicians (job_cards.status).
 * qc_passed and ready_for_billing read the same: billing is not the
 * technician's business.
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

/**
 * The label for a job card status.
 * @param {string} status  job_cards.status
 * @returns {string} e.g. "Rework needed"; an unknown value comes back humanized.
 */
export function jcLabel(status) {
  return JC_LABELS[status] || humanize(status);
}

// ─── Time booked on a job card (Start / Pause / Stop) ─────────

/**
 * Clock states of one job card for one technician, from
 * technician_time_logs:
 *   idle    — no time booked yet          ("Not started")
 *   running — a log with no clock_out     ("Working")
 *   paused  — last log ended 'pause'      ("Paused" or "Paused · Break")
 *   stopped — last log ended 'stop'       ("Stopped")
 */
export const TIME_STATES = Object.freeze(['idle', 'running', 'paused', 'stopped']);

export const TIME_STATE_LABELS = Object.freeze({
  idle: 'Not started',
  running: 'Working',
  paused: 'Paused',
  stopped: 'Stopped',
});

/**
 * Why a technician paused the clock — technician_time_logs.pause_reason
 * (added with end_note by the technician-app migration). 'other' needs a
 * note (technician_time_logs.end_note, up to PAUSE_NOTE_MAX characters).
 */
export const PAUSE_REASONS = Object.freeze(['break', 'waiting_parts', 'waiting_info', 'other_job', 'other']);

export const PAUSE_REASON_LABELS = Object.freeze({
  break: 'Break',
  waiting_parts: 'Waiting for parts',
  waiting_info: 'Waiting for information or approval',
  other_job: 'Moved to another job',
  other: 'Other',
});

/** technician_time_logs.end_note is VARCHAR(255). */
export const PAUSE_NOTE_MAX = 255;

/**
 * The clock state from one technician's logs on one job card — the same rule
 * GET /job-cards/mine has always used for `time_state`.
 *
 * @param {Array<{clock_in: *, clock_out: *, end_reason?: ('pause'|'stop'|null)}>} logs
 *   that technician's technician_time_logs rows for the card, oldest first
 *   (ORDER BY clock_in).
 * @returns {'idle'|'running'|'paused'|'stopped'}
 */
export function timeStateFromLogs(logs) {
  const list = Array.isArray(logs) ? logs : [];
  if (list.some(l => !l.clock_out)) return 'running';
  const last = list.at(-1);
  if (last?.end_reason === 'pause') return 'paused';
  if (last?.end_reason === 'stop') return 'stopped';
  return 'idle';
}

/**
 * The label for a pause reason.
 * @param {string} reason  one of PAUSE_REASONS
 * @returns {string|null} null when there is no (known) reason.
 */
export function pauseReasonLabel(reason) {
  return PAUSE_REASON_LABELS[reason] || null;
}

/**
 * The label for a clock state, with the pause reason when there is one.
 *
 * @param {'idle'|'running'|'paused'|'stopped'} state
 * @param {string|null} [pauseReason]  only used when state is 'paused'.
 * @returns {string}
 *
 * @example timeStateLabel('paused', 'waiting_parts')  // 'Paused · Waiting for parts'
 * @example timeStateLabel('running')                  // 'Working'
 */
export function timeStateLabel(state, pauseReason) {
  const label = TIME_STATE_LABELS[state] || humanize(state);
  const reason = state === 'paused' ? pauseReasonLabel(pauseReason) : null;
  return reason ? `${label} · ${reason}` : label;
}

/** True when `reason` is one of PAUSE_REASONS. */
export function isPauseReason(reason) {
  return PAUSE_REASONS.includes(reason);
}

/**
 * Checks the body of POST /job-cards/:id/time/pause ({reason?, note?}).
 *
 * The reason is optional in the API (the Team Board pauses without one)
 * unless `required` is set; the technician app always sends one. A reason
 * must be one of PAUSE_REASONS, and 'other' needs a note. The note is
 * trimmed and cut to PAUSE_NOTE_MAX characters.
 *
 * @param {{reason?: *, note?: *}} [body]
 * @param {{required?: boolean}} [opts]
 * @returns {{ok: true, reason: (string|null), note: (string|null)}
 *         | {ok: false, code: ('PAUSE_REASON_REQUIRED'|'PAUSE_REASON_INVALID'|'PAUSE_NOTE_REQUIRED'), message: string}}
 *   On failure, answer 400 with `{ success:false, code, message }`.
 *
 * @example
 *   const p = parsePauseInput(req.body);
 *   if (!p.ok) return res.status(400).json({ success: false, code: p.code, message: p.message });
 *   // … SET end_reason = 'pause', pause_reason = p.reason, end_note = p.note
 */
export function parsePauseInput(body, { required = false } = {}) {
  const rawReason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const rawNote = typeof body?.note === 'string' ? body.note.trim() : '';
  const note = rawNote ? rawNote.slice(0, PAUSE_NOTE_MAX) : null;
  if (!rawReason) {
    if (required) {
      return { ok: false, code: 'PAUSE_REASON_REQUIRED', message: 'Choose why the job is paused.' };
    }
    return { ok: true, reason: null, note };
  }
  if (!isPauseReason(rawReason)) {
    return {
      ok: false,
      code: 'PAUSE_REASON_INVALID',
      message: `Pause reason must be one of: ${PAUSE_REASONS.join(', ')}.`,
    };
  }
  if (rawReason === 'other' && !note) {
    return { ok: false, code: 'PAUSE_NOTE_REQUIRED', message: 'Say why the job is paused.' };
  }
  return { ok: true, reason: rawReason, note };
}

export default {
  woDisplayKey, woLabel, woFilterKey, jcLabel,
  timeStateFromLogs, timeStateLabel, pauseReasonLabel, isPauseReason, parsePauseInput,
};
