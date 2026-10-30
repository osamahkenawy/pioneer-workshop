/**
 * customer-status.js — what a customer sees about their car.
 *
 * One payload for the public status page (/service-status/:token, the link
 * in every SMS, e-mail, WhatsApp text and job sheet QR) and for the customer
 * portal's job cards. It is built from buildWorkflow() (Steps 1–7, the same
 * source as the staff job card screen) and put into the customer's seven
 * stages:
 *
 *   received → inspection_estimate → approval → repair → quality_check
 *            → ready → collected
 *
 * with two special endings: 'declined' (the customer rejected the whole
 * estimate; the car goes back) and 'cancelled'.
 *
 * The public link has no login and gets forwarded, so the payload is a
 * whitelist. Never in it: staff names or phones, the customer's phone,
 * addresses, coordinates, notes, the payment method, prices of parts. The
 * workshop's own phone, WhatsApp and address are in it — that is how the
 * customer reaches us.
 *
 * Tokens shorter than 20 characters (the old pre-printed 'WO-' + 8 hex
 * tokens, 32 bits) can be guessed, so they get a reduced view: the stage and
 * the make and model, nothing that identifies the customer or the job.
 */
import { query } from './database.js';
import { buildWorkflow, JC_QC_PASSED, JC_WORK_DONE } from './workflow.js';
import { customerStatusUrl, customerAppBase } from './customer-link.js';

/** The customer's stages, in order. */
export const STAGES = Object.freeze([
  'received', 'inspection_estimate', 'approval', 'repair', 'quality_check', 'ready', 'collected',
]);

/** Below this length a token is guessable: reduced view only. */
export const REDUCED_TOKEN_LENGTH = 20;

const TOKEN_RE = /^[A-Za-z0-9_-]{4,128}$/;
const OPEN_FOR_REPAIR = ['assigned', 'accepted', 'in_progress'];

const clip = (s, max) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const money = n => (n == null || n === '' || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
// Newest / oldest of some timestamps, returned as the database gave them (the
// API's 'YYYY-MM-DD HH:MM:SS'), so every time in the payload reads the same way.
const asTime = d => new Date(typeof d === 'string' ? d.replace(' ', 'T') : d).getTime();
const pickTime = (dates, newest) => dates.filter(d => d && !Number.isNaN(asTime(d)))
  .sort((a, b) => (newest ? asTime(b) - asTime(a) : asTime(a) - asTime(b)))[0] || null;
const latest = dates => pickTime(dates, true);
const earliest = dates => pickTime(dates, false);

function parseSettings(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s) || {}; } catch { return {}; }
}

/** The workshop as the customer reaches it: name, phone, WhatsApp, address, a map search. */
export function workshopContact(w) {
  if (!w) return null;
  const settings = parseSettings(w.settings);
  const name = settings.company_name || w.name || null;
  const address = [w.address, w.area, w.city, w.emirate && w.emirate !== w.city ? w.emirate : null]
    .filter(Boolean).join(', ') || null;
  const search = [name, address].filter(Boolean).join(', ');
  return {
    name,
    phone: w.phone || null,
    whatsapp: settings.whatsapp || settings.whatsapp_number || w.phone || null,
    address,
    map_url: search ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(search)}` : null,
    logo_url: w.logo_url || null,
    currency: w.currency || 'AED',
  };
}

/** Billed to the customer's account rather than paid at the counter (as lib/workflow.js paymentSettled reads it). */
const onAccountFor = (customerClass, payerType) =>
  customerClass === 'internal' || ['fleet', 'insurance', 'corporate'].includes(payerType);

/**
 * Which stage the job is at, and the special ending if any. `awaitingAck`:
 * an external customer's job whose physical inspection they have not
 * acknowledged yet — no job card, so the car is still "received" even when
 * the walk-around is done, or the customer already approved a quote for it
 * (lib/physical-inspection.js). A quote still waiting for their decision is
 * "Your approval" all the same.
 * @returns {{ key: string, special: null|'declined'|'cancelled' }}
 */
export function stageOf({ status, estimateStatus, approved, qcPassedAll, workDoneAll, inspected, estimateSent, awaitingAck = false }) {
  if (status === 'cancelled') return { key: estimateStatus === 'rejected' ? 'declined' : 'cancelled', special: estimateStatus === 'rejected' ? 'declined' : 'cancelled' };
  if (status === 'completed') return { key: 'collected', special: null };
  if (status === 'ready_for_pickup' || qcPassedAll) return { key: 'ready', special: null };
  if (status === 'inspection' || workDoneAll) return { key: 'quality_check', special: null };
  if (OPEN_FOR_REPAIR.includes(status) || (approved && !awaitingAck)) return { key: 'repair', special: null };
  if (estimateSent && !approved) return { key: 'approval', special: null };
  if (awaitingAck) return { key: 'received', special: null };
  if (inspected || status === 'confirmed') return { key: 'inspection_estimate', special: null };
  return { key: 'received', special: null };
}

/**
 * The status payload for one work order.
 *
 * @param {{token?: string, workOrderId?: number, workshopId?: number}} ref
 *   the public token, or the work order (portal: already checked to be the
 *   customer's own).
 * @param {{reduceShortTokens?: boolean}} [opts] reduceShortTokens (default
 *   true for a token lookup) gives the reduced view for a short token.
 * @returns {Promise<object|null>} null when there is no such job.
 */
export async function buildCustomerStatus({ token, workOrderId, workshopId } = {}, opts = {}) {
  let ref;
  if (token !== undefined) {
    const t = String(token || '').trim();
    if (!TOKEN_RE.test(t)) return null;
    [ref] = await query('SELECT id, workshop_id, service_status_token FROM work_orders WHERE service_status_token = ? LIMIT 1', [t]);
  } else if (workOrderId) {
    [ref] = await query('SELECT id, workshop_id, service_status_token FROM work_orders WHERE id = ? AND workshop_id = ?', [workOrderId, workshopId]);
  }
  if (!ref) return null;
  const reduced = token !== undefined && (opts.reduceShortTokens ?? true) && String(token).trim().length < REDUCED_TOKEN_LENGTH;

  const wf = await buildWorkflow(ref.id, ref.workshop_id);
  if (!wf) return null;
  const w = wf.work_order;

  const [[extra], [workshop], logs] = await Promise.all([
    query(
      `SELECT wo.created_at, wo.intake_inspection_at, wo.estimated_completion_at, wo.completed_at, wo.cancelled_at,
              v.make, v.model, v.year, v.color, v.plate_number, v.plate_code
         FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id
        WHERE wo.id = ?`, [ref.id]),
    query('SELECT name, phone, address, area, city, emirate, currency, settings, logo_url FROM workshops WHERE id = ?', [ref.workshop_id]),
    // Every log, in order: 'ready' is when the current ready run began, which
    // needs the logs in between (a rework sends the job back to work).
    query('SELECT status, created_at FROM work_order_status_logs WHERE work_order_id = ? ORDER BY id', [ref.id]),
  ]);

  // ── Where the job is ──
  const cards = wf.job_cards || [];
  const estimate = wf.estimate;
  const estimateSent = !!estimate?.sent_to_customer_at;
  const approved = !!w.customer_approved_at
    || (!!estimate && ['approved', 'partially_approved', 'converted'].includes(estimate.status) && !!estimate.customer_approved_at);
  const workDoneAll = cards.length > 0 && cards.every(c => JC_WORK_DONE.includes(c.status));
  const qcPassedAll = cards.length > 0 && cards.every(c => JC_QC_PASSED.includes(c.status));
  const intakeDone = (wf.inspections || []).find(i => i.inspection_type === 'intake' && i.status === 'completed');
  // An external job's technical inspection starts once the job card is open,
  // i.e. once the customer has acknowledged the physical inspection.
  const pi = wf.physical_inspection;
  const awaitingAck = !!pi?.needed && !pi.job_card_open && !cards.length;
  const inspectedAt = awaitingAck ? null : (intakeDone?.completed_at || extra?.intake_inspection_at || null);
  const { key: stageKey, special } = stageOf({
    status: w.status, estimateStatus: estimate?.status, approved, qcPassedAll, workDoneAll,
    inspected: !!inspectedAt || !!estimate, estimateSent, awaitingAck,
  });

  // ── When each stage happened ──
  const lastLog = s => latest(logs.filter(l => l.status === s).map(l => l.created_at));
  const firstClockIn = earliest(cards.flatMap(c => (c.time_logs || []).map(t => t.clock_in)).concat(cards.map(c => c.started_at)));
  const qcAt = latest(cards.map(c => c.qc_passed_at));
  const gateReleasedAt = wf.gate_pass?.status === 'released' ? wf.gate_pass.released_at : null;
  // The time the job closed, as the portal's job list shows it.
  const collectedAt = w.status === 'completed' ? (w.completed_at || gateReleasedAt || lastLog('completed')) : null;
  // Ready since the first log of the current ready run: the collection call
  // and the gate pass log the same status again and must not move it; any
  // other status (a rework) ends the run.
  let readySince = null;
  let prev = null;
  for (const l of logs) {
    if (l.status === 'ready_for_pickup' && prev !== 'ready_for_pickup') readySince = l.created_at;
    else if (l.status !== 'ready_for_pickup' && l.status !== 'completed') readySince = null;
    prev = l.status;
  }
  const approvalAt = approved ? (w.customer_approved_at || estimate?.customer_approved_at || null) : (estimate?.sent_to_customer_at || null);
  const at = {
    received: extra?.created_at || null,
    inspection_estimate: inspectedAt,
    approval: approvalAt,
    repair: firstClockIn,
    quality_check: qcAt,
    ready: readySince || (qcPassedAll ? qcAt : null),
    collected: collectedAt,
  };

  // done | current | upcoming | skipped. A special ending stops the line where
  // the job was: what was reached is done, the rest skipped.
  const reachedIndex = (() => {
    if (!special) return STAGES.indexOf(stageKey);
    let i = 0;
    STAGES.forEach((s, n) => { if (at[s]) i = n; });
    return i;
  })();
  const stages = STAGES.map((key, i) => {
    let state;
    if (special) state = i <= reachedIndex && (at[key] || i === 0) ? 'done' : 'skipped';
    else if (i < reachedIndex) state = key === 'approval' && !at.approval && !estimateSent ? 'skipped' : 'done';
    else if (i === reachedIndex) state = key === 'collected' ? 'done' : 'current';
    else state = 'upcoming';
    return { key, state, at: state === 'upcoming' || state === 'skipped' ? null : (at[key] || null) };
  });
  const since = special
    ? (extra?.cancelled_at || lastLog('cancelled') || null)
    : (at[stageKey] || stages.slice(0, reachedIndex + 1).reverse().find(s => s.at)?.at || null);

  const contact = workshopContact(workshop);
  if (reduced) {
    return {
      reduced: true,
      workshop: contact,
      vehicle: { make: extra?.make || w.make || null, model: extra?.model || w.model || null },
      stage: { key: stageKey, since: null },
      special,
      stages: stages.map(s => ({ key: s.key, state: s.state, at: null })),
    };
  }

  // ── What the action card needs ──
  const sentEstimate = estimateSent ? {
    number: estimate.estimate_number,
    status: estimate.status,
    total: money(estimate.total_amount),
    sent_at: estimate.sent_to_customer_at,
  } : null;

  const waiting = cards.flatMap(c => c.parts || [])
    .filter(p => p.availability !== 'available' && Number(p.quantity_issued) < Number(p.quantity_requested));
  const partsWait = stageKey === 'repair' && waiting.length
    ? { count: waiting.length, expected_date: latest(waiting.map(p => p.expected_date)) }
    : null;

  // A draft invoice has not been given to the customer yet, and the job's
  // invoice (raised when the work is assigned) is shown from ready for
  // collection on, not during the repair.
  const inv = wf.invoice && wf.invoice.status !== 'draft' && ['ready', 'collected'].includes(stageKey) ? wf.invoice : null;
  const onAccount = onAccountFor(w.customer_class, w.payer_type);
  const invoice = inv ? {
    number: inv.invoice_number,
    total: money(inv.total_amount),
    paid: money(inv.amount_paid) || 0,
    balance: Math.max(0, money((Number(inv.total_amount) || 0) - (Number(inv.amount_paid) || 0)) || 0),
    status: inv.status,
    on_account: onAccount,
  } : null;

  // When it should be ready: the Team Leader's booked end time, else the
  // estimate the job was opened with. Not once it is past — a time already
  // gone by tells the customer nothing.
  const expectedRaw = ['collected', 'ready'].includes(stageKey) || special ? null
    : (wf.assignment?.scheduled_end_at || extra?.estimated_completion_at || null);
  const expected = expectedRaw && asTime(expectedRaw) > Date.now() ? expectedRaw : null;

  let photos = [];
  let surveyUrl = null;
  if (['ready', 'collected'].includes(stageKey)) {
    try {
      photos = (await query(
        'SELECT photo_url, caption FROM completion_photos WHERE work_order_id = ? ORDER BY uploaded_at, id LIMIT 12', [ref.id]))
        .filter(p => p.photo_url).map(p => ({ url: p.photo_url, caption: p.caption || null }));
    } catch { /* table absent on old installs */ }
  }
  if (stageKey === 'collected') {
    try {
      const [s] = await query(
        `SELECT token FROM survey_invites
          WHERE work_order_id = ? AND responded_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY id DESC LIMIT 1`, [ref.id]);
      if (s?.token) surveyUrl = `${customerAppBase()}/survey/${s.token}`;
    } catch { /* no surveys */ }
  }

  // Within the repair stage, what the customer is told: approved and being
  // scheduled, waiting for parts, or being worked on.
  const stageDetail = stageKey !== 'repair' ? null
    : partsWait ? 'waiting_parts'
    : firstClockIn || w.status === 'in_progress' ? 'working'
    : 'scheduled';

  const mainCard = cards.find(c => !c.parent_job_card_id) || null;
  return {
    reduced: false,
    workshop: contact,
    vehicle: {
      plate: [extra?.plate_code, extra?.plate_number || w.plate_number].filter(Boolean).join(' ') || null,
      make: extra?.make || w.make || null,
      model: extra?.model || w.model || null,
      year: extra?.year || null,
      colour: extra?.color || null,
    },
    job: {
      work_order_number: w.work_order_number,
      job_card_number: mainCard?.job_card_number || null,
      opened_at: extra?.created_at || null,
      reported_issue: w.description ? clip(w.description, 200) : null,
    },
    stage: { key: stageKey, since, detail: stageDetail },
    special,
    stages,
    expected_ready_at: expected,
    estimate: sentEstimate,
    parts_wait: partsWait,
    invoice,
    collected_at: collectedAt,
    photos,
    survey_url: surveyUrl,
  };
}

/**
 * The portal's copy: the public payload plus the job's id (for the portal's
 * own pages) and its status link. Only for a work order already checked to
 * belong to the logged-in customer.
 */
export async function customerView(workOrderId, workshopId) {
  const data = await buildCustomerStatus({ workOrderId, workshopId });
  if (!data) return null;
  const [row] = await query('SELECT service_status_token, status FROM work_orders WHERE id = ?', [workOrderId]);
  return { ...data, work_order_id: Number(workOrderId), status_url: customerStatusUrl(row) };
}

export default buildCustomerStatus;
