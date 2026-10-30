/**
 * job-phase.js — where a car stands on the Vehicle Status Board
 * (GET /api/vehicle-board), in the workshop's Steps 1–7.
 *
 * The board answers "where is every car right now, which step is it at, and
 * who is it waiting for". It loads every open work order in one query
 * (routes/vehicle-board.js) and calls boardPhase() on each row's flags — never
 * buildWorkflow() per row. The rules below follow buildWorkflow()'s own
 * conditions (lib/workflow.js), so the board and the job card agree.
 *
 *   phase      board column            steps   waiting on (usually)
 *   intake     Reception               1–3     Service Advisor
 *   pricing    Inspection & pricing    4–5     Storekeeper / Service Advisor / Supervisor
 *   customer   With customer           5–6     Customer
 *   work       In work                 6       Team Leader / Store / Technician
 *   qc         Quality check           7       Supervisor / Foreman / Team Leader
 *   ready      Ready for collection    7       Service Advisor / Cashier
 *   closed     Closed today            7       —
 *
 * Labels are English; the screen translates them with the keys
 * vehicleBoard.phase.*, vehicleBoard.badge.* and vehicleBoard.who.*.
 */
import { JC_WORK_DONE, JC_QC_PASSED } from './workflow.js';

/** Board columns, in process order. */
export const PHASES = Object.freeze(['intake', 'pricing', 'customer', 'work', 'qc', 'ready', 'closed']);

export const PHASE_LABELS = Object.freeze({
  intake: 'Reception',
  pricing: 'Inspection & pricing',
  customer: 'With customer',
  work: 'In work',
  qc: 'Quality check',
  ready: 'Ready for collection',
  closed: 'Closed today',
});

/** The steps (Steps 1–7) each column covers, for the column header. */
export const PHASE_STEPS = Object.freeze({
  intake: [1, 3], pricing: [4, 5], customer: [5, 6], work: [6, 6], qc: [7, 7], ready: [7, 7], closed: [7, 7],
});

/** Who a job is waiting on. */
export const WHO = Object.freeze({
  service_advisor: 'Service Advisor',
  storekeeper: 'Storekeeper',
  supervisor_wm: 'Supervisor / Workshop Manager',
  customer: 'Customer',
  team_leader: 'Team Leader',
  technician: 'Technician',
  qc: 'Supervisor / Foreman / Team Leader',
  cashier: 'Cashier / Service Advisor',
});

/** When a column has no more specific answer. */
const PHASE_WHO = Object.freeze({
  intake: 'service_advisor', pricing: 'service_advisor', customer: 'customer',
  work: 'technician', qc: 'qc', ready: 'service_advisor', closed: null,
});

/**
 * How long a car may sit in a column before it is late, in minutes. The
 * client still has to confirm these (plan §7, question 6). `work` applies
 * only when the Team Leader booked no end time: past scheduled_end_at is late.
 */
export const LATE_MINUTES = Object.freeze({
  intake: 2 * 60,
  pricing: 24 * 60,
  customer: 24 * 60,
  work: 3 * 24 * 60,
  qc: 2 * 60,
  ready: 48 * 60,
});

/**
 * Is this work order "legacy" — imported from the old system and never
 * worked in the Steps 1–7 process? The board hides those unless asked
 * (?include_legacy=1).
 *
 * A job card is never deleted (cancelling one keeps the row), so a work order
 * with any job card is in the process. One with none is legacy when it was
 * opened before the job card process went live, i.e. before the workshop's
 * first job card. A job with no card opened after that is in the process
 * too: an external customer's job waits for its card until the customer
 * acknowledges the physical inspection (lib/physical-inspection.js), and it
 * shows in Reception.
 *
 * @param {{anyCard: boolean, createdAgoSecs: number|null, liveAgoSecs: number|null}} p
 *   createdAgoSecs: seconds since the work order was opened; liveAgoSecs:
 *   seconds since the workshop's first job card (null: none yet, nothing is legacy)
 */
export function isLegacyJob({ anyCard, createdAgoSecs, liveAgoSecs }) {
  if (anyCard || liveAgoSecs == null || createdAgoSecs == null) return false;
  return Number(createdAgoSecs) > Number(liveAgoSecs);
}

/**
 * Every badge a card can carry: English text ({{x}} = params), chip tone
 * (the tone names of the front end's statusLabels.js TONES) and who acts on it.
 */
export const BADGES = Object.freeze({
  // Step 7.2, in the order the Service Advisor works through them
  call_customer:          { text: 'Call customer', tone: 'amber', who: 'service_advisor' },
  awaiting_payment:       { text: 'Awaiting payment', tone: 'amber', who: 'cashier' },
  issue_gate_pass:        { text: 'Issue gate pass', tone: 'sky', who: 'service_advisor' },
  close_job:              { text: 'Close job', tone: 'green', who: 'service_advisor' },
  // Step 7.1
  qc_waiting:             { text: 'Quality check & test drive', tone: 'purple', who: 'qc' },
  // Step 6
  rework:                 { text: 'Rework', tone: 'red', who: 'technician' },
  no_technician:          { text: 'Waiting for technician', tone: 'amber', who: 'team_leader' },
  waiting_parts:          { text: 'Waiting parts', tone: 'amber', who: 'storekeeper' },
  waiting_parts_eta:      { text: 'Waiting parts · ETA {{date}}', tone: 'amber', who: 'storekeeper' },
  clock_running:          { text: 'Clock running', tone: 'green', who: 'technician' },
  paused:                 { text: 'Paused', tone: 'amber', who: 'technician' },
  paused_reason:          { text: 'Paused · {{reason}}', tone: 'amber', who: 'technician' },
  not_started:            { text: 'Not started', tone: 'slate', who: 'technician' },
  // Steps 5–6, with the customer
  declined:               { text: 'Declined — return vehicle', tone: 'red', who: 'service_advisor' },
  sent:                   { text: 'Sent {{ago}} ago', tone: 'sky', who: 'customer' },
  awaiting_approval:      { text: 'Awaiting customer approval', tone: 'sky', who: 'customer' },
  // Steps 4–5
  store_pricing:          { text: 'Parts to price: {{n}}', tone: 'amber', who: 'storekeeper' },
  labour_not_priced:      { text: 'Labour not priced', tone: 'amber', who: 'service_advisor' },
  needs_approval:         { text: 'Needs Supervisor/WM approval', tone: 'amber', who: 'supervisor_wm' },
  ready_to_send:          { text: 'Ready to send', tone: 'sky', who: 'service_advisor' },
  estimate_not_raised:    { text: 'Raise the estimate', tone: 'slate', who: 'service_advisor' },
  estimate_expired:       { text: 'Estimate expired', tone: 'amber', who: 'service_advisor' },
  // Steps 1–3
  not_classified:         { text: 'Customer not classified', tone: 'amber', who: 'service_advisor' },
  vehicle_missing:        { text: 'Vehicle / issue missing', tone: 'red', who: 'service_advisor' },
  physical_not_started:   { text: 'Physical inspection not started', tone: 'slate', who: 'service_advisor' },
  physical_in_progress:   { text: 'Physical inspection in progress', tone: 'sky', who: 'service_advisor' },
  awaiting_acknowledgement: { text: 'Waiting for the customer\'s signature', tone: 'sky', who: 'customer' },
  open_job_card:          { text: 'Open the job card', tone: 'amber', who: 'service_advisor' },
  // Imported jobs
  no_job_card:            { text: 'No job card', tone: 'grey', who: null },
});

/** Statuses that put an imported job with no job card in each column (rule 10b). */
const NO_CARD_PHASE = Object.freeze({
  pending: 'intake', confirmed: 'intake', estimate_approved: 'intake',
  assigned: 'work', accepted: 'work', auto_assign: 'work', in_progress: 'work',
  inspection: 'qc', ready_for_pickup: 'ready', completed: 'closed',
});

/** Work order statuses that mean the job is past the customer's decision (rule 5). */
const WORK_STATUSES = ['assigned', 'accepted', 'in_progress', 'estimate_approved', 'auto_assign'];

/** "3h 20m", "2d 4h" — for the English badge text only; the screen formats its own. */
export function fmtAge(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-15' → '15 Oct' (the English text only; params keep the date). */
function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : String(iso || '');
}

/**
 * { key, text, tone, who, params } for a BADGES key. `params` go to the
 * screen as data (an ISO date, minutes, a count); `textParams` override
 * them in the English text only.
 */
export function badge(key, params = {}, textParams = {}) {
  const def = BADGES[key];
  const fill = { ...params, ...textParams };
  const text = def.text.replace(/\{\{(\w+)\}\}/g, (_, k) => (fill[k] != null ? String(fill[k]) : ''));
  return { key, text, tone: def.tone, who: def.who, ...(Object.keys(params).length ? { params } : {}) };
}

/** The pickup call, payment, gate pass and closing, in order (Step 7.2). */
function collectionBadge(f) {
  if (!f.pickupContacted) return badge('call_customer');
  if (!f.paid) return badge('awaiting_payment');
  if (!f.gateReleased) return badge('issue_gate_pass');
  return badge('close_job');
}

/** The Step 6 badges: technician, parts, clock. */
function workBadges(f) {
  const out = [];
  if (!f.hasTechnician) out.push(badge('no_technician'));
  if (f.partsWaiting > 0) out.push(f.partsEta ? badge('waiting_parts_eta', { date: f.partsEta }, { date: fmtDay(f.partsEta) }) : badge('waiting_parts'));
  if (f.clock === 'running') out.push(badge('clock_running'));
  else if (f.clock === 'paused') out.push(f.pauseReasonLabel ? badge('paused_reason', { reason: f.pauseReasonLabel, reason_key: f.pauseReason }) : badge('paused'));
  else if (f.hasTechnician && !f.timeBooked) out.push(badge('not_started'));
  return out;
}

/**
 * Which column a work order belongs in, and why.
 *
 * @param {object} f  flags for one work order (routes/vehicle-board.js builds them):
 *   status            work_orders.status
 *   cards             live (not cancelled) job cards on it
 *   cardsDone         …of them in JC_WORK_DONE
 *   cardsPassed       …in JC_QC_PASSED
 *   cardsQcPending    …qc_pending
 *   cardsQcFailed     …qc_failed
 *   approved          the customer's agreement is on record (the work order's, or the estimate's)
 *   hasTechnician     the work order has a technician
 *   partsWaiting      requisition lines not issued yet; partsEta: earliest expected date (YYYY-MM-DD)
 *   clock             'running' | 'paused' | 'stopped' | null; pauseReason / pauseReasonLabel
 *   timeBooked        any time booked on the job's cards
 *   estimate          null | { status, sentMinutesAgo, lines, unpricedParts, unpricedLabour, needsApproval }
 *   counterPriced     priced on the job card (lines or a fee) with no estimate
 *   itemised          billing_basis = 'itemised'
 *   classified        Step 1 done (class and subcategory)
 *   vehicleAndIssue   Step 2 done (vehicle and reported issue)
 *   inspection        'none' | 'draft' | 'completed' (the physical inspection, intake)
 *   inProcess         opened in the Steps 1–7 process (not a legacy import — isLegacyJob)
 *   anyCard           a job card was ever opened on it (cancelled ones count)
 *   physicalNeeded    an external customer: the job card waits for the physical inspection
 *   acknowledged      the customer acknowledged it (signed, or the paper form), or a manager's override
 *   pickupContacted, paid, gateReleased   Step 7.2
 * @returns {{ phase: string, step: number, sub_status: (object|null), badges: object[],
 *             waiting_on: ({key: string, label: string}|null) }}
 *   badges are in priority order; sub_status is the first of them.
 */
export function boardPhase(f) {
  const out = (phase, step, badges = []) => {
    const whoKey = badges.find(b => b.who)?.who || PHASE_WHO[phase];
    return {
      phase, step, sub_status: badges[0] ? { key: badges[0].key, text: badges[0].text, tone: badges[0].tone } : null,
      badges, waiting_on: whoKey ? { key: whoKey, label: WHO[whoKey] } : null,
    };
  };

  // 1. Closed (the board only loads jobs closed today).
  if (f.status === 'completed') return out('closed', 7);

  // 10a. No job card yet, opened here and not started: an external
  // customer's job waits for the physical inspection and the customer's
  // acknowledgement, which open it (Step 3) — Reception. That includes one
  // opened by a quote the customer approved before the car was walked round
  // (estimate_approved). (A job further on with no card is an anomaly,
  // placed by its status as below.)
  if (!f.cards && f.inProcess && !f.anyCard && ['pending', 'confirmed', 'estimate_approved'].includes(f.status)) {
    const badges = [];
    if (!f.classified) badges.push(badge('not_classified'));
    if (!f.vehicleAndIssue) badges.push(badge('vehicle_missing'));
    badges.push(!f.physicalNeeded || f.acknowledged ? badge('open_job_card')
      : badge(f.inspection === 'completed' ? 'awaiting_acknowledgement' : f.inspection === 'draft' ? 'physical_in_progress' : 'physical_not_started'));
    return out('intake', !f.classified ? 1 : !f.vehicleAndIssue ? 2 : 3, badges);
  }

  // 10b. No job card: an imported job. Its status is all there is.
  if (!f.cards) {
    const phase = NO_CARD_PHASE[f.status] || 'intake';
    const badges = [];
    if (phase === 'ready') badges.push(collectionBadge(f));
    if (phase === 'qc') badges.push(badge('qc_waiting'));
    if (phase === 'work' && !f.hasTechnician) badges.push(badge('no_technician'));
    badges.push(badge('no_job_card'));
    return out(phase, { intake: 3, work: 6, qc: 7, ready: 7 }[phase], badges);
  }

  const allPassed = f.cardsPassed === f.cards;
  const allDone = f.cardsDone === f.cards;

  // 2. Every card passed the quality check → collection, payment, gate pass, close.
  if (allPassed || f.status === 'ready_for_pickup') return out('ready', 7, [collectionBadge(f)]);

  // 3. A card failed the quality check → back in work.
  if (f.cardsQcFailed > 0) {
    const rest = workBadges(f).filter(b => b.key !== 'not_started');
    return out('work', 6, [badge('rework'), ...rest]);
  }

  // 4. Every card done and waiting for the quality check.
  if (allDone && f.cardsQcPending > 0) return out('qc', 7, [badge('qc_waiting')]);

  // 5. The customer agreed: the job is on the floor.
  if (f.approved || WORK_STATUSES.includes(f.status)) return out('work', 6, workBadges(f));

  const est = f.estimate;
  // 6. The customer declined every line.
  if (est?.status === 'rejected') return out('customer', 6, [badge('declined')]);

  // 7. Waiting for the customer's decision.
  if (est?.status === 'sent_to_customer') {
    return out('customer', 6, [badge('sent', { minutes: Math.max(0, Math.round(est.sentMinutesAgo || 0)) }, { ago: fmtAge(est.sentMinutesAgo) })]);
  }
  if (!est && f.counterPriced && f.itemised) return out('customer', 5, [badge('awaiting_approval')]);

  // 8. Inspection & pricing: an estimate, or Steps 1–2 done — with a job card
  // open, Step 3 (the physical inspection) is behind the job.
  if (est || (f.classified && f.vehicleAndIssue)) {
    if (!est) return out('pricing', 4, [badge('estimate_not_raised')]);
    const badges = [];
    if (est.status === 'expired') badges.push(badge('estimate_expired'));
    if (est.unpricedParts > 0) badges.push(badge('store_pricing', { n: est.unpricedParts }));
    if (est.unpricedLabour > 0 || !est.lines) badges.push(badge('labour_not_priced'));
    const priced = est.lines > 0 && !est.unpricedParts && !est.unpricedLabour;
    if (priced && est.status !== 'expired') badges.push(badge(est.needsApproval ? 'needs_approval' : 'ready_to_send'));
    return out('pricing', priced ? 5 : 4, badges);
  }

  // 9. Reception: Steps 1–2 not complete.
  const badges = [];
  if (!f.classified) badges.push(badge('not_classified'));
  if (!f.vehicleAndIssue) badges.push(badge('vehicle_missing'));
  return out('intake', !f.classified ? 1 : 2, badges);
}

/**
 * Is the car late in its column?
 * @param {string} phase
 * @param {number} ageMinutes  time in the column
 * @param {number|null} [minutesPastScheduledEnd]  for `work`: now − scheduled_end_at
 *   (negative before it), or null when nothing is booked.
 */
export function isLate(phase, ageMinutes, minutesPastScheduledEnd = null) {
  if (phase === 'closed') return false;
  if (phase === 'work' && minutesPastScheduledEnd != null) return minutesPastScheduledEnd > 0;
  const limit = LATE_MINUTES[phase];
  return limit != null && Number(ageMinutes) > limit;
}

export { JC_WORK_DONE, JC_QC_PASSED };
