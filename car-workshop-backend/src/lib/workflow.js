/**
 * workflow.js — the workshop workflow, Steps 1–7
 * (Pioneer_Complete_Workshop_Workflow_Steps_1_to_7.pdf).
 *
 * The visit is the work order (WO). Work is carried out on job cards (JC):
 * one MAIN job card per work order, opened at intake (Step 3), plus SUB-job
 * cards when part of the approved work needs its own card (Step 6). Time
 * booking, parts requisitions, the quality check and the gate pass all hang
 * off job cards (tables from the SOW schema that nothing used to create).
 *
 * This module holds what several routes share:
 *   - who plays which part in the process (ROLE_GROUPS) and notifying them,
 *   - opening the main job card,
 *   - buildWorkflow(): where one work order stands in Steps 1–7.
 */
import { query, execute } from './database.js';
import { createInAppNotification } from './notify.js';
import { sendPushToUser } from './push.js';
import { sendFCMToUser } from './firebase.js';
import { isManagerRole } from './roles.js';
import { jobClassification, canApproveEstimates } from './job-card-approval.js';

// Step 1 as recorded on the job (the approval rules read it too).
export { jobClassification };

// ── Who does what ──────────────────────────────────────────────────────
// Groups of people to notify, by effective role (lib/roles.js: the assigned
// roles.slug, else the legacy users.role; 'dispatcher' acts as the Service
// Advisor). Permissions themselves are capabilities in lib/roles.js.
export const ROLE_GROUPS = {
  supervisor:      ['supervisor'],
  foreman:         ['workshop_foreman'],
  team_leader:     ['team_leader'],
  service_advisor: ['service_advisor', 'dispatcher'],
  storekeeper:     ['storekeeper', 'part_advisor'],
  manager:         ['admin', 'general_manager', 'workshop_manager'],
};

/** The floor: who is told when a request is raised or work is ready to assign. */
export const FLOOR = ['supervisor', 'foreman', 'team_leader'];

/** True if the user belongs to any of the groups. Managers and the owner always do. */
export function userInGroups(user, groups) {
  if (!user) return false;
  if (isManagerRole(user)) return true;
  const key = user.role_slug || user.role;
  return groups.some(g => (ROLE_GROUPS[g] || []).includes(key));
}

/** Active user ids in a workshop belonging to any of the groups. */
export async function usersInGroups(workshopId, groups) {
  const keys = [...new Set(groups.flatMap(g => ROLE_GROUPS[g] || []))];
  if (!keys.length) return [];
  const rows = await query(
    `SELECT DISTINCT u.id FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.workshop_id = ? AND u.is_active = 1
        AND COALESCE(r.slug, u.role) IN (?)`,
    [workshopId, keys]
  );
  return rows.map(r => r.id);
}

/**
 * In-app notification (bell + socket) to everyone in the groups. Never
 * throws — a notification must not undo the action that caused it.
 * `type` doubles as the dedup key in createInAppNotification (one per
 * user + work order + type per hour), so give each event its own type.
 */
export async function notifyGroups(workshopId, groups, { title, body, link = null, orderId = null, icon = '🔔', type = 'workflow', exceptUserId = null }) {
  try {
    const ids = await usersInGroups(workshopId, groups);
    for (const userId of ids) {
      if (userId === exceptUserId) continue;
      await createInAppNotification({ workshopId, userId, title, body, type, icon, link, orderId });
    }
    return ids.length;
  } catch (err) {
    console.error('[Workflow] notify failed:', err.message);
    return 0;
  }
}

/**
 * Where a technician's notification opens: their job card in the technician
 * app (/mechanic/jobs/{id}), never the staff work order page, which shows
 * prices and calls staff-only APIs. `jobCardId` when the caller knows the
 * card; otherwise the technician's own card on the work order, the main card
 * first; /mechanic (My Jobs) when there is none.
 */
export async function technicianJobLink({ workshopId, mechanicId, orderId = null, jobCardId = null }) {
  if (jobCardId) return `/mechanic/jobs/${jobCardId}`;
  if (orderId && mechanicId) {
    const [jc] = await query(
      `SELECT id FROM job_cards
        WHERE work_order_id = ? AND workshop_id = ? AND mechanic_id = ? AND status <> 'cancelled'
        ORDER BY parent_job_card_id IS NOT NULL, id LIMIT 1`,
      [orderId, workshopId, mechanicId]
    );
    if (jc) return `/mechanic/jobs/${jc.id}`;
  }
  return '/mechanic';
}

/**
 * Notify the technician's login (mechanics.user_id), if they have one.
 *
 * The link is always rewritten to the technician app (technicianJobLink():
 * payload.jobCardId, else their card on payload.orderId) — callers still pass
 * staff links such as /work-orders/:id, which a technician cannot use. A
 * link that already starts with /mechanic is kept.
 *
 * `push` ({ title?, body? }) also sends a phone push (Web Push + FCM) with
 * the same link, once: not when the in-app notice was a duplicate (same
 * technician, work order and type within the hour).
 *
 * @returns {Promise<boolean>} true when the technician has a login and was told.
 */
export async function notifyMechanic(workshopId, mechanicId, payload = {}) {
  try {
    const [m] = await query('SELECT user_id FROM mechanics WHERE id = ? AND workshop_id = ?', [mechanicId, workshopId]);
    if (!m?.user_id) return false;
    const { jobCardId = null, push = null, link: given = null, ...rest } = payload;
    const link = typeof given === 'string' && given.startsWith('/mechanic')
      ? given
      : await technicianJobLink({ workshopId, mechanicId, orderId: rest.orderId, jobCardId });
    const r = await createInAppNotification({ workshopId, userId: m.user_id, type: 'workflow_assigned', icon: '🔧', ...rest, link });
    if (push && r?.success && !r.deduped) {
      const pushPayload = {
        title: push.title || rest.title,
        body: push.body || rest.body,
        url: link,
        tag: `job-${rest.orderId || mechanicId}`,
        data: { orderId: rest.orderId || null, url: link },
      };
      await sendPushToUser(m.user_id, pushPayload).catch(() => {});
      await sendFCMToUser(m.user_id, pushPayload).catch(e => console.error('[Workflow] FCM (technician) error:', e.message));
    }
    return true;
  } catch (err) {
    console.error('[Workflow] mechanic notify failed:', err.message);
    return false;
  }
}

// ── Job cards ──────────────────────────────────────────────────────────

export function genJobCardNumber() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `JC-${stamp}-${Math.floor(Math.random() * 90000) + 10000}`;
}

/** The main job card's department follows the kind of work booked in. */
const DEPARTMENT_BY_CATEGORY = { bodywork: 'body_paint', electrical: 'electrical', tire_service: 'tyres' };
export const departmentFor = serviceCategory => DEPARTMENT_BY_CATEGORY[serviceCategory] || 'mechanical';

/** A complaint as one short line for a notification: whitespace collapsed,
 *  cut with an ellipsis, no trailing punctuation (the sentence adds its own). */
export function shortText(text, max = 120) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (raw.length > max) return raw.slice(0, max - 1).trimEnd() + '…';
  return raw.replace(/[\s.!?;:,]+$/, '');
}

/**
 * Step 3: the work order's main job card, created if it does not exist yet.
 * The unique key on job_cards.main_for_work_order makes this safe against
 * two requests racing to open it. Opening it is also Step 4's trigger: the
 * Supervisor, Foreman and Team Leader are told a request has been raised.
 *
 * `db` is a connection with an open transaction (POST /api/work-orders opens
 * the job card in the same transaction as the work order). The card is then
 * written on that connection and nothing is announced: the caller runs
 * announceMainJobCard() once the transaction has committed.
 */
export async function ensureMainJobCard({ workOrderId, workshopId, userId = null, notify = true, db = null }) {
  const q = db ? async (sql, p = []) => (await db.query(sql, p))[0] : query;
  const existing = await getMainJobCard(workOrderId, workshopId, db);
  if (existing) return existing;

  const [wo] = await q(
    `SELECT wo.id, wo.work_order_number, wo.customer_id, wo.vehicle_id, wo.service_bay_id, wo.mechanic_id,
            wo.service_category, v.plate_number
       FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id
      WHERE wo.id = ? AND wo.workshop_id = ?`,
    [workOrderId, workshopId]
  );
  if (!wo) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const number = genJobCardNumber();
    try {
      const r = await q(
        `INSERT INTO job_cards
           (workshop_id, job_card_number, work_order_id, title, customer_id, vehicle_id, vehicle_plate,
            service_bay_id, mechanic_id, department, status, wip_opened_at, created_by)
         VALUES (?, ?, ?, 'Main job card', ?, ?, ?, ?, ?, ?, 'open', NOW(), ?)`,
        [workshopId, number, wo.id, wo.customer_id, wo.vehicle_id, wo.plate_number || null,
         wo.service_bay_id, wo.mechanic_id, departmentFor(wo.service_category), userId]
      );
      await q(
        `INSERT INTO wip_ledger (workshop_id, job_card_id, work_order_id, entry_type, amount, description, posted_by)
         VALUES (?, ?, ?, 'open', 0.00, ?, ?)`,
        [workshopId, r.insertId, wo.id, `WIP opened: ${number}`, userId]
      ).catch(() => {});
      if (!db) await announceMainJobCard({ workOrderId: wo.id, workshopId, userId, notify });
      return getMainJobCard(workOrderId, workshopId, db);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      // Either the number collided (retry) or another request opened the
      // main job card first (return it).
      const raced = await getMainJobCard(workOrderId, workshopId, db);
      if (raced) return raced;
    }
  }
  throw new Error('Could not allocate a job card number');
}

/**
 * What follows opening the main job card: the car's open service reminders
 * are booked (CRM), and — unless `notify` is false — the floor is told a
 * request has been raised (Step 4). Never throws.
 */
export async function announceMainJobCard({ workOrderId, workshopId, userId = null, notify = true }) {
  try {
    // Loaded lazily: the reminders route imports nothing from here.
    import('../routes/crm-reminders.js')
      .then(m => m.fulfilOpenReminders({ workshopId, workOrderId }))
      .catch(e => console.error('[workflow] reminders:', e.message));
    if (!notify) return;
    const [wo] = await query(
      `SELECT wo.id, wo.work_order_number, wo.customer_name, wo.description, v.plate_number, jc.job_card_number
         FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id
         LEFT JOIN job_cards jc ON jc.work_order_id = wo.id AND jc.parent_job_card_id IS NULL AND jc.status <> 'cancelled'
        WHERE wo.id = ? AND wo.workshop_id = ? ORDER BY jc.id LIMIT 1`,
      [workOrderId, workshopId]
    );
    if (!wo) return;
    const vehicle = wo.plate_number ? ` · ${wo.plate_number}` : '';
    const complaint = shortText(wo.description, 120);
    await notifyGroups(workshopId, FLOOR, {
      title: `New request ${wo.work_order_number}${vehicle}`,
      body: `Job card ${wo.job_card_number} opened for ${wo.customer_name || 'a customer'}${complaint ? ` — ${complaint}` : ''}${complaint.endsWith('…') ? ' ' : '. '}Technical inspection is next.`,
      link: `/work-orders/${wo.id}`, orderId: wo.id, icon: '📋', type: 'workflow_request_raised',
      exceptUserId: userId,
    });
  } catch (err) {
    console.error('[Workflow] request-raised follow-up failed:', err.message);
  }
}

export async function getMainJobCard(workOrderId, workshopId, db = null) {
  const sql = `SELECT * FROM job_cards
      WHERE work_order_id = ? AND workshop_id = ? AND parent_job_card_id IS NULL AND status <> 'cancelled'
      ORDER BY id LIMIT 1`;
  const [jc] = db ? (await db.query(sql, [workOrderId, workshopId]))[0] : await query(sql, [workOrderId, workshopId]);
  return jc || null;
}

/** Job card statuses that mean "the work is done" (Step 6 JOB DONE). */
export const JC_WORK_DONE = ['qc_pending', 'qc_passed', 'qc_failed', 'ready_for_billing', 'billed'];
/** …and "the quality check passed" (Step 7). */
export const JC_QC_PASSED = ['qc_passed', 'ready_for_billing', 'billed'];

/** Step 7, quality check, including the test drive. */
export const QC_CHECKLIST = [
  // The client's post-repair quality check (2026-10-12): three points.
  // 'check' items are pass / not OK and both must pass; 'comment' is free text.
  { key: 'issue_repaired', label: 'Vehicle issue has been repaired correctly', type: 'check', required: true },
  { key: 'test_drive',     label: 'Test drive', type: 'check', required: true },
  { key: 'other_issues',   label: 'Any other issues or comments', type: 'comment' },
];

/**
 * Payment is settled enough for the gate pass when the invoice is paid —
 * or, for customers billed on account (internal fleet / asset / insurance,
 * corporate credit), once the invoice has been raised.
 */
export function paymentSettled(invoice, { customerClass, payerType }) {
  if (!invoice || ['void', 'cancelled'].includes(invoice.status)) return false;
  if (invoice.status === 'paid') return true;
  const onAccount = customerClass === 'internal' || ['fleet', 'insurance', 'corporate'].includes(payerType);
  return onAccount && invoice.status !== 'draft';
}

const CHANNEL_LABELS = {
  advisor: 'Service Advisor (manual)', fleet_link: 'Fleet coordinator link', website: 'Website',
  whatsapp: 'WhatsApp', social: 'Social media', api: 'API',
};

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));

/**
 * Where one work order stands in Steps 1–7, plus everything the job card
 * screen needs to act on it. Each step: { n, key, title, state, summary,
 * checks: [{ label, done, detail }] }. state is done | current | upcoming |
 * stopped (customer rejected everything). `next` says what has to happen
 * now and whose job it is.
 */
export async function buildWorkflow(workOrderId, workshopId) {
  const [wo] = await query(
    `SELECT wo.*, c.full_name AS customer_full_name, c.customer_class, c.customer_subcategory, c.code AS customer_code,
            c.email AS customer_email_ref, v.plate_number, v.make, v.model, v.year, v.vin,
            m.full_name AS mechanic_name
       FROM work_orders wo
       LEFT JOIN customers c ON c.id = wo.customer_id
       LEFT JOIN vehicles v  ON v.id = wo.vehicle_id
       LEFT JOIN mechanics m ON m.id = wo.mechanic_id
      WHERE wo.id = ? AND wo.workshop_id = ?`,
    [workOrderId, workshopId]
  );
  if (!wo) return null;

  const jobCards = await query(
    `SELECT jc.*, m.full_name AS mechanic_name, p.job_card_number AS parent_number
       FROM job_cards jc
       LEFT JOIN mechanics m ON m.id = jc.mechanic_id
       LEFT JOIN job_cards p ON p.id = jc.parent_job_card_id
      WHERE jc.work_order_id = ? AND jc.workshop_id = ? AND jc.status <> 'cancelled'
      ORDER BY jc.parent_job_card_id IS NOT NULL, jc.id`,
    [wo.id, workshopId]
  );
  const jcIds = jobCards.map(j => j.id);
  const main = jobCards.find(j => !j.parent_job_card_id) || null;
  // A job closed on a rejected estimate cancels its job card; it was still opened.
  const [everOpened] = main ? [main] : await query(
    'SELECT job_card_number FROM job_cards WHERE work_order_id = ? AND workshop_id = ? AND parent_job_card_id IS NULL ORDER BY id LIMIT 1',
    [wo.id, workshopId]);

  const [items, timeLogs, qcRows, reqItems, estimates, inspections, invoices, contacts, gatePasses, assignment, sentNotices, [creator]] = await Promise.all([
    query('SELECT id, name, item_type, quantity, unit_price, job_card_id FROM work_order_items WHERE work_order_id = ? ORDER BY id', [wo.id]),
    jcIds.length ? query(
      `SELECT t.id, t.job_card_id, t.mechanic_id, COALESCE(m.full_name, t.mechanic_name) AS mechanic_name,
              t.clock_in, t.clock_out, t.end_reason, t.pause_reason, t.end_note
         FROM technician_time_logs t LEFT JOIN mechanics m ON m.id = t.mechanic_id
        WHERE t.job_card_id IN (?) ORDER BY t.clock_in`, [jcIds]) : [],
    jcIds.length ? query('SELECT * FROM qc_checklists WHERE job_card_id IN (?)', [jcIds]) : [],
    jcIds.length ? query(
      `SELECT i.*, r.req_number, r.job_card_id, r.status AS requisition_status, r.created_at AS requested_at
         FROM material_requisition_items i JOIN material_requisitions r ON r.id = i.requisition_id
        WHERE r.job_card_id IN (?) AND r.status <> 'cancelled' ORDER BY i.id`, [jcIds]) : [],
    query(
      `SELECT id, estimate_number, status, customer_type, total_amount, estimate_format,
              internal_approved_at, sent_to_customer_at, customer_approved_at, customer_notes, created_at,
              work_order_id, intake_work_order_id
         FROM service_estimates
        WHERE workshop_id = ? AND (intake_work_order_id = ? OR work_order_id = ?)
        ORDER BY id DESC`, [workshopId, wo.id, wo.id]),
    query(`SELECT id, inspection_type, status, completed_at, signed_at, signed_via, signed_by_name, shared_at, shared_via
             FROM vehicle_inspections WHERE work_order_id = ? AND workshop_id = ? ORDER BY id`, [wo.id, workshopId]),
    query(`SELECT id, invoice_number, status, total_amount, amount_paid, created_at FROM invoices
            WHERE work_order_id = ? AND workshop_id = ? AND status NOT IN ('void','cancelled') ORDER BY id DESC`, [wo.id, workshopId]),
    query(
      `SELECT c.*, u.full_name AS contacted_by_name FROM work_order_contacts c LEFT JOIN users u ON u.id = c.contacted_by
        WHERE c.work_order_id = ? AND c.workshop_id = ? ORDER BY c.id DESC`, [wo.id, workshopId]),
    query(`SELECT * FROM gate_passes WHERE work_order_id = ? AND workshop_id = ? AND status <> 'voided' ORDER BY id DESC`, [wo.id, workshopId]),
    query(
      `SELECT a.assigned_at, a.scheduled_start_at, a.scheduled_end_at, u.full_name AS assigned_by_name
         FROM work_order_assignments a LEFT JOIN users u ON u.id = a.assigned_by
        WHERE a.work_order_id = ? AND a.is_current = 1 ORDER BY a.id DESC LIMIT 1`, [wo.id]),
    query(`SELECT type, status, created_at FROM notifications
            WHERE work_order_id = ? AND workshop_id = ? AND template_key = 'order_ready_for_pickup' AND status = 'sent'`, [wo.id, workshopId]),
    // Who opened the job (its first status log) — a counter price set by a
    // Supervisor / Workshop Manager is their approval (Step 5).
    query(
      `SELECT u.role, r.slug AS role_slug, u.is_owner FROM work_order_status_logs sl
         JOIN users u ON u.id = sl.changed_by LEFT JOIN roles r ON r.id = u.role_id
        WHERE sl.work_order_id = ? ORDER BY sl.id LIMIT 1`, [wo.id]),
  ]);

  // Estimate pricing summary (Step 5)
  const estimate = estimates[0] || null;
  let pricing = null;
  if (estimate) {
    const lines = await query(
      `SELECT id, job_name, line_type, description, quantity, unit_price, genuine_price, genuine_available,
              aftermarket_price, aftermarket_available, part_option, customer_status
         FROM estimate_lines WHERE estimate_id = ? AND line_type <> 'discount' ORDER BY sort_order, id`, [estimate.id]);
    pricing = summariseEstimatePricing(lines);
  }

  // Time booking per job card
  const now = new Date();
  const timeByCard = {};
  for (const t of timeLogs) {
    const k = t.job_card_id;
    timeByCard[k] ||= { minutes: 0, running: [], paused: false, sessions: 0 };
    timeByCard[k].sessions++;
    timeByCard[k].minutes += minutesBetween(t.clock_in, t.clock_out || now);
    if (!t.clock_out) timeByCard[k].running.push({ mechanic_id: t.mechanic_id, mechanic_name: t.mechanic_name, since: t.clock_in });
  }
  for (const k of Object.keys(timeByCard)) {
    const last = timeLogs.filter(t => String(t.job_card_id) === k).at(-1);
    timeByCard[k].state = timeByCard[k].running.length ? 'running' : last?.end_reason === 'pause' ? 'paused' : last?.end_reason === 'stop' ? 'stopped' : 'idle';
  }

  const cards = jobCards.map(jc => ({
    ...jc,
    items: items.filter(i => (i.job_card_id || main?.id) === jc.id),
    time: timeByCard[jc.id] || { minutes: 0, running: [], state: 'idle', sessions: 0 },
    time_logs: timeLogs.filter(t => t.job_card_id === jc.id),
    qc: qcRows.find(q => q.job_card_id === jc.id) || null,
    parts: reqItems.filter(r => r.job_card_id === jc.id),
  }));

  const invoice = invoices[0] || null;
  const gatePass = gatePasses.find(g => g.status === 'released') || gatePasses[0] || null;
  // Step 1 as recorded on the job at intake (fallback: the customer).
  const classification = jobClassification(wo);
  const customerClass = classification.cls;
  const customerSub = classification.sub;
  const isInternal = customerClass === 'internal';
  const isClosed = wo.status === 'completed';
  const isCancelled = wo.status === 'cancelled';
  const counterPriced = !estimate && (items.length > 0 || Number(wo.service_fee) > 0);   // priced in the intake wizard
  // An external job priced at the counter skipped the estimate; it carries
  // the Supervisor / Workshop Manager approval only if one of them priced it.
  const counterSignedOff = counterPriced && !isInternal && !!creator && canApproveEstimates(creator);
  // The estimate's account type counts only for a job with no classification at all.
  const estimateInternal = isInternal || (!customerClass && estimate?.customer_type === 'internal_fleet');
  const managerApproved = estimateInternal || !!estimate?.internal_approved_at || counterSignedOff;
  const hasVin = !!(wo.vin && String(wo.vin).trim());
  const hasIssue = !!(wo.description && wo.description.trim());
  // Step 2 of the process: the vehicle information and the reported issue.
  // The odometer and VIN are recorded when available but do not hold the step.
  const intakeMissing = [!wo.vehicle_id && 'the vehicle', !hasIssue && 'the reported issue'].filter(Boolean);
  const approved = !!wo.customer_approved_at || (estimate && ['approved', 'partially_approved', 'converted'].includes(estimate.status) && !!estimate.customer_approved_at);
  const rejectedAll = estimate?.status === 'rejected';
  const workDone = cards.length > 0 && cards.every(c => JC_WORK_DONE.includes(c.status));
  const qcPassed = cards.length > 0 && cards.every(c => JC_QC_PASSED.includes(c.status));
  const qcFailed = cards.some(c => c.status === 'qc_failed');
  // The automatic "ready for collection" SMS/email is not the call the
  // process asks for ("call the customer to arrange collection") — only a
  // logged contact by staff completes it. (purpose 'pickup' is the stored key.)
  const pickupContacted = contacts.some(c => c.purpose === 'pickup');
  const paid = paymentSettled(invoice, { customerClass, payerType: wo.payer_type });
  const gateReleased = gatePass?.status === 'released';
  const intakeInspection = inspections.find(i => i.inspection_type === 'intake' && i.status === 'completed') || (wo.intake_inspection_at ? { completed_at: wo.intake_inspection_at } : null);
  const partsWaiting = reqItems.filter(i => i.availability !== 'available' && Number(i.quantity_issued) < Number(i.quantity_requested));

  // Every visible string is sent with an i18n key + params (the screen
  // translates it; the English text is the fallback).
  const L = (key, text, params = {}) => ({ text, i18n: { key, params } });
  const C = (key, label, done, detail = null, detailI18n = null) => ({ key, label, done, detail, ...(detailI18n ? { detail_i18n: detailI18n } : {}) });
  const subLabel = fmtSub(customerSub);
  const sumOf = x => ({ summary: x.text, summary_i18n: x.i18n });
  const NOT_RECORDED = ['Not recorded', { key: 'val.not_recorded' }];

  const steps = [
    {
      n: 1, key: 'classification', title: 'Customer classification',
      ...sumOf(customerClass
        ? L(`sum.class_${customerClass}`, `${customerClass === 'internal' ? 'Internal' : 'External'}${subLabel ? ` · ${subLabel}` : ' · subcategory not set'}`, { sub: customerSub || '' })
        : L('sum.not_classified', 'Not classified')),
      checks: [
        C('main_category', 'Main category (Internal / External)', !!customerClass, customerClass ? cap(customerClass) : null, customerClass ? { key: `val.class_${customerClass}` } : null),
        C('subcategory', 'Subcategory', !!customerSub, subLabel, customerSub ? { key: `val.sub_${customerSub}` } : null),
        C('customer', 'Customer', !!(wo.customer_full_name || wo.customer_name), wo.customer_full_name || wo.customer_name),
      ],
      done: !!customerClass && !!customerSub,
    },
    {
      // Done with the vehicle and the reported issue (document Step 2). The
      // odometer and VIN are shown as recorded / not recorded and do not hold
      // the step. Checks are found by key on the screen; 'vin' is last.
      n: 2, key: 'intake', title: 'Vehicle information & issue',
      ...sumOf((() => { const v = [wo.plate_number, [wo.make, wo.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
        return v ? L('sum.raw', v, { v }) : L('sum.no_vehicle', 'No vehicle'); })()),
      checks: [
        C('vehicle', 'Vehicle', !!wo.vehicle_id, [wo.plate_number, wo.make, wo.model, wo.year].filter(Boolean).join(' ') || null),
        C('reported_issue', 'Reported issue', hasIssue, hasIssue ? clip(wo.description, 160) : null),
        C('odometer', 'Odometer', wo.odometer_in != null, wo.odometer_in != null ? `${Number(wo.odometer_in).toLocaleString('en-US')} km` : NOT_RECORDED[0], wo.odometer_in != null ? null : NOT_RECORDED[1]),
        C('received_via', 'Received via', true, CHANNEL_LABELS[wo.intake_channel] || 'Service Advisor (manual)', { key: `val.channel_${wo.intake_channel || 'advisor'}` }),
        C('vin', 'VIN / chassis number', !!wo.vehicle_id && hasVin, hasVin ? String(wo.vin).trim() : wo.vehicle_id ? 'No VIN on file' : null,
          !hasVin && wo.vehicle_id ? { key: 'val.no_vin' } : null),
      ],
      done: intakeMissing.length === 0,
    },
    {
      n: 3, key: 'job_card', title: 'Job card (JC)',
      ...sumOf(main
        ? (cards.length > 1 ? L('sum.jc_with_subs', `${main.job_card_number} + ${cards.length - 1} sub-job card(s)`, { jc: main.job_card_number, n: cards.length - 1 })
                            : L('sum.raw', main.job_card_number, { v: main.job_card_number }))
        : everOpened ? L('sum.jc_cancelled', `${everOpened.job_card_number} (cancelled)`, { jc: everOpened.job_card_number })
        : L('sum.not_opened', 'Not opened')),
      checks: [
        C('main_jc_opened', 'Main job card opened', !!everOpened, everOpened ? everOpened.job_card_number : null),
        C('floor_notified', 'Supervisor, Foreman and Team Leader notified', !!everOpened, everOpened ? 'On opening' : null, everOpened ? { key: 'val.on_opening' } : null),
      ],
      done: !!everOpened,
    },
    {
      n: 4, key: 'inspection_pricing', title: 'Inspection & pricing',
      ...sumOf(counterPriced ? L('sum.priced_counter', 'Priced at the counter')
        : !estimate ? L('sum.no_estimate', 'No estimate yet')
        : pricing.unpricedParts > 0 ? L('sum.parts_waiting_store', `${pricing.unpricedParts} part line(s) waiting for the store`, { n: pricing.unpricedParts })
        : pricing.unpricedLabour > 0 ? L('sum.labour_not_priced', 'Labour not priced')
        : L('sum.estimate_priced', `Estimate ${estimate.estimate_number} priced`, { est: estimate.estimate_number })),
      // A job priced at the counter skipped the estimate: it is priced (the
      // step is done), but the checks say what did not happen — no inspection
      // on record, parts not priced by the Storekeeper.
      checks: [
        C('technical_inspection', 'Technical inspection', !!intakeInspection || !!estimate,
          intakeInspection?.completed_at ? 'Intake inspection completed' : counterPriced ? 'Not recorded — priced at the counter' : null,
          intakeInspection?.completed_at ? { key: 'val.intake_done' } : counterPriced ? { key: 'val.inspection_not_recorded' } : null),
        C('parts_priced', 'Parts priced by the Storekeeper (Genuine / After-Market)', !!pricing && pricing.unpricedParts === 0,
          pricing ? `${pricing.partLines - pricing.unpricedParts}/${pricing.partLines} part lines` : counterPriced ? 'Priced at the counter, not by the Storekeeper' : null,
          pricing ? { key: 'val.part_lines', params: { a: pricing.partLines - pricing.unpricedParts, b: pricing.partLines } } : counterPriced ? { key: 'val.counter_not_store' } : null),
        C('labour_priced', 'Labour priced by the Service Advisor', counterPriced || (!!pricing && pricing.unpricedLabour === 0),
          pricing ? `${pricing.labourLines - pricing.unpricedLabour}/${pricing.labourLines} labour lines` : counterPriced ? 'Priced at the counter' : null,
          pricing ? { key: 'val.labour_lines', params: { a: pricing.labourLines - pricing.unpricedLabour, b: pricing.labourLines } } : counterPriced ? { key: 'val.priced_counter' } : null),
      ],
      done: counterPriced || (!!pricing && pricing.lines > 0 && pricing.unpricedParts === 0 && pricing.unpricedLabour === 0),
    },
    {
      // External customers: the Supervisor or Workshop Manager approves first
      // (document Step 5). The classification decides, not the estimate's
      // account type. A counter-priced external job carries that approval only
      // when one of them priced it; otherwise the check stays open.
      n: 5, key: 'estimate', title: 'Estimate to customer',
      ...sumOf(counterPriced ? (managerApproved ? L('sum.shown_counter', 'Shown to the customer at the counter')
                                                : L('sum.counter_no_approval', 'Priced at the counter — no Supervisor / Workshop Manager approval'))
        : !estimate ? L('sum.raw', '—', { v: '—' })
        : estimate.sent_to_customer_at ? L(`sum.sent_${estimate.estimate_format || 'genuine'}`, `Sent ${fmtFormat(estimate.estimate_format)}`)
        : !estimateInternal && !estimate.internal_approved_at ? L('sum.needs_approval', 'Needs Supervisor / Workshop Manager approval')
        : L('sum.ready_to_send', 'Ready to send')),
      checks: [
        C('manager_approval', 'Supervisor / Workshop Manager approval (external customers)', estimateInternal || managerApproved,
          estimateInternal ? 'Not needed — internal customer' : estimate?.internal_approved_at ? 'Approved'
            : counterSignedOff ? 'Priced by a Supervisor / Workshop Manager at the counter' : counterPriced ? 'Not given — priced at the counter' : null,
          estimateInternal ? { key: 'val.not_needed_internal' } : estimate?.internal_approved_at ? { key: 'val.approved' }
            : counterSignedOff ? { key: 'val.counter_signed_off' } : counterPriced ? { key: 'val.counter_no_approval' } : null),
        C('sent', 'Sent by WhatsApp or Email', counterPriced || !!estimate?.sent_to_customer_at,
          estimate?.sent_to_customer_at ? fmtFormat(estimate.estimate_format) : counterPriced ? 'Shown at the counter' : null,
          estimate?.sent_to_customer_at ? { key: `val.format_${estimate.estimate_format || 'genuine'}` } : counterPriced ? { key: 'val.shown_counter' } : null),
      ],
      // A counter-priced external job without that approval is done here only
      // once the customer has agreed (history cannot be redone); the check
      // above still shows the approval never happened.
      done: counterPriced ? (managerApproved || approved) : !!estimate?.sent_to_customer_at,
    },
    {
      n: 6, key: 'work', title: 'Customer decision & work',
      ...sumOf(rejectedAll ? L('sum.rejected_all', 'Customer rejected all work — job closed')
        : !approved ? L('sum.waiting_decision', 'Waiting for the customer\'s decision')
        : workDone ? L('sum.job_done', 'Job done')
        : timeByCardRunning(cards) ? L('sum.work_in_progress', 'Work in progress')
        : wo.mechanic_id ? L('sum.assigned_to', `Assigned to ${wo.mechanic_name}`, { name: wo.mechanic_name })
        : L('sum.waiting_assign', 'Approved — waiting for the Team Leader to assign')),
      checks: [
        C('decision', 'Customer decision', approved || rejectedAll,
          rejectedAll ? 'Rejected all' : estimate?.status === 'partially_approved' || (estimate?.status === 'converted' && pricing?.rejected > 0) ? 'Partial approval — approved lines only' : approved ? 'Approved' : null,
          rejectedAll ? { key: 'val.rejected_all' } : estimate?.status === 'partially_approved' || (estimate?.status === 'converted' && pricing?.rejected > 0) ? { key: 'val.partial' } : approved ? { key: 'val.approved' } : null),
        C('jc_for_work', 'Job card(s) for the approved work', approved && !!main,
          cards.length ? `${cards.length} job card(s)` : null, cards.length ? { key: 'val.job_cards', params: { n: cards.length } } : null),
        C('technician', 'Technician assigned by the Team Leader', !!wo.mechanic_id, wo.mechanic_name || null),
        C('time_booked', 'Time booked (Start / Pause / Stop)', cards.some(c => c.time.sessions > 0),
          cards.some(c => c.time.sessions > 0) ? `${fmtMinutes(cards.reduce((s, c) => s + c.time.minutes, 0))}${timeByCardRunning(cards) ? ' · running' : ''}` : null,
          cards.some(c => c.time.sessions > 0) ? { key: timeByCardRunning(cards) ? 'val.minutes_running' : 'val.minutes', params: { t: fmtMinutes(cards.reduce((s, c) => s + c.time.minutes, 0)) } } : null),
        C('parts_issued', 'Parts issued', reqItems.length === 0 || partsWaiting.length === 0,
          reqItems.length ? `${reqItems.length - partsWaiting.length}/${reqItems.length} issued` : 'No parts requested',
          reqItems.length ? { key: 'val.issued_of', params: { a: reqItems.length - partsWaiting.length, b: reqItems.length } } : { key: 'val.no_parts' }),
        C('job_done', 'Job done', workDone),
      ],
      done: workDone,
      stopped: rejectedAll,
    },
    {
      n: 7, key: 'closure', title: 'Quality check, collection & closure',
      ...sumOf(isClosed ? L('sum.closed', 'Closed') : qcFailed ? L('sum.qc_failed', 'Quality check failed — back to the Team Leader')
        : !qcPassed ? (workDone ? L('sum.waiting_qc', 'Waiting for the quality check') : L('sum.raw', '—', { v: '—' }))
        : !pickupContacted ? L('sum.contact_customer', 'Ready for collection — call the customer')
        : !paid ? L('sum.waiting_payment', 'Waiting for payment')
        : !gateReleased ? L('sum.issue_gate_pass', 'Issue the gate pass')
        : L('sum.ready_to_close', 'Ready to close')),
      checks: [
        C('qc_passed', 'Quality check & test drive passed', qcPassed, qcFailed ? 'Failed — rework' : null, qcFailed ? { key: 'val.failed_rework' } : null),
        C('sa_notified', 'Service Advisor told: ready for collection', qcPassed),
        C('pickup_contacted', 'Customer called to arrange collection', pickupContacted,
          contacts[0] ? `${cap(contacts[0].channel)} · ${fmtOutcome(contacts[0].outcome)}` : sentNotices.length ? 'Automatic "ready for collection" message sent — call to agree a time' : null,
          contacts[0] ? { key: 'val.contact', params: { channel: contacts[0].channel, outcome: contacts[0].outcome || '' } } : sentNotices.length ? { key: 'val.auto_ready_sent' } : null),
        C('payment', 'Payment & invoice', paid, invoice ? `${invoice.invoice_number} · ${invoice.status.replace('_', ' ')}` : 'No invoice yet',
          invoice ? { key: `val.invoice_${invoice.status}`, params: { inv: invoice.invoice_number } } : { key: 'val.no_invoice' }),
        C('gate_pass', 'Final gate pass', gateReleased, gatePass?.gate_pass_number || null),
        C('job_closed', 'Job closed', isClosed),
      ],
      done: isClosed,
    },
  ];

  // Current step = first not done. A rejected estimate stops the flow at 6.
  let currentFound = false;
  for (const s of steps) {
    if (isCancelled || (rejectedAll && s.n > 6)) { s.state = s.done ? 'done' : 'stopped'; continue; }
    if (s.stopped) { s.state = 'stopped'; currentFound = true; continue; }
    if (s.done && !currentFound) { s.state = 'done'; continue; }
    if (!currentFound) { s.state = 'current'; currentFound = true; continue; }
    s.state = s.done ? 'done' : 'upcoming';
  }

  // Closed in the old system (imported, never had a job card): the 7 steps
  // don't apply — the screen shows a note instead of a half-empty stepper.
  const legacy = !everOpened && ['completed', 'cancelled'].includes(wo.status) && wo.billing_basis !== 'itemised';

  return {
    legacy,
    work_order: {
      id: wo.id, work_order_number: wo.work_order_number, status: wo.status, billing_basis: wo.billing_basis,
      completed_at: wo.completed_at, cancelled_at: wo.cancelled_at,
      customer_id: wo.customer_id, customer_name: wo.customer_full_name || wo.customer_name, customer_phone: wo.customer_phone,
      // Step 1 as the job records it (classification_from_job: false = no
      // complete intake snapshot, the customer's current classification).
      customer_email: wo.customer_email || wo.customer_email_ref, customer_class: customerClass, customer_subcategory: customerSub,
      classification_from_job: classification.fromJob,
      payer_type: wo.payer_type, mechanic_id: wo.mechanic_id, mechanic_name: wo.mechanic_name, total_amount: wo.total_amount,
      service_status_token: wo.service_status_token, plate_number: wo.plate_number, make: wo.make, model: wo.model,
      vehicle_id: wo.vehicle_id, vin: wo.vin || null, odometer_in: wo.odometer_in, description: wo.description,
      customer_approved_at: wo.customer_approved_at, intake_channel: wo.intake_channel, updated_at: wo.updated_at,
    },
    steps,
    current_step: steps.find(s => s.state === 'current')?.n || null,
    next: nextAction({ wo, steps, estimate, pricing, approved, counterPriced, managerApproved, intakeMissing, cards, workDone, qcPassed, qcFailed, pickupContacted, paid, gateReleased, isClosed, isCancelled, rejectedAll, partsWaiting, customerClass, intakeDone: !!intakeInspection?.completed_at }),
    job_cards: cards,
    estimate: estimate ? { ...estimate, pricing } : null,
    estimates,
    inspections,
    invoice,
    contacts,
    gate_pass: gatePass,
    assignment: assignment[0] || null,
    qc_checklist: QC_CHECKLIST,
    parts_waiting: partsWaiting.length,
  };
}

/**
 * Step 5 numbers: for each job (estimate lines grouped by job_name), the
 * total with Genuine parts and with After-Market parts. Labour counts in
 * both. A part type marked unavailable (N/A) falls back to the other type
 * for that job, as the process chart says.
 */
export function summariseEstimatePricing(lines) {
  const jobs = new Map();
  let unpricedParts = 0, unpricedLabour = 0, partLines = 0, labourLines = 0, rejected = 0;
  for (const l of lines) {
    const key = (l.job_name || l.description || 'Job').trim();
    if (!jobs.has(key)) jobs.set(key, { job: key, labour: 0, genuine: 0, after_market: 0, genuine_na: false, after_market_na: false, other: 0, lines: 0 });
    const j = jobs.get(key);
    j.lines++;
    if (l.customer_status === 'rejected') rejected++;
    const qty = Number(l.quantity) || 1;
    if (l.line_type === 'labour') {
      labourLines++;
      if (l.unit_price == null || Number(l.unit_price) <= 0) unpricedLabour++;
      j.labour += qty * Number(l.unit_price || 0);
    } else if (l.line_type === 'parts') {
      partLines++;
      const g = l.genuine_available === 0 ? null : (l.genuine_price != null ? Number(l.genuine_price) : null);
      const a = l.aftermarket_available === 0 ? null : (l.aftermarket_price != null ? Number(l.aftermarket_price) : null);
      const legacy = l.genuine_price == null && l.aftermarket_price == null && Number(l.unit_price) > 0 ? Number(l.unit_price) : null;
      const bothNA = l.genuine_available === 0 && l.aftermarket_available === 0;
      if (g == null && a == null && legacy == null && !bothNA) unpricedParts++;
      if (l.genuine_available === 0) j.genuine_na = true;
      if (l.aftermarket_available === 0) j.after_market_na = true;
      const gUse = g ?? a ?? legacy ?? 0;    // N/A → fall back to the other type
      const aUse = a ?? g ?? legacy ?? 0;
      j.genuine += qty * gUse;
      j.after_market += qty * aUse;
    } else {
      const v = qty * Number(l.unit_price || 0);
      j.other += v;
    }
  }
  const r2 = n => Math.round(n * 100) / 100;
  const out = [...jobs.values()].map(j => ({
    job: j.job,
    labour: r2(j.labour),
    genuine_parts: r2(j.genuine), after_market_parts: r2(j.after_market),
    total_genuine: r2(j.labour + j.genuine + j.other), total_after_market: r2(j.labour + j.after_market + j.other),
    genuine_na: j.genuine_na, after_market_na: j.after_market_na,
  }));
  return {
    jobs: out,
    total_genuine: r2(out.reduce((s, j) => s + j.total_genuine, 0)),
    total_after_market: r2(out.reduce((s, j) => s + j.total_after_market, 0)),
    lines: lines.length, partLines, labourLines, unpricedParts, unpricedLabour, rejected,
  };
}

function nextAction(c) {
  const { steps } = c;
  // who_key / key are i18n keys (workflow.who.* / workflow.next.*); text is the English fallback.
  const N = (whoKey, who, key, text, action = null, params = {}) => ({ who_key: whoKey, who, key, text, action, params });
  if (c.isCancelled) return N(null, null, 'cancelled', 'This job card is cancelled.');
  if (c.isClosed) return N(null, null, 'closed', 'Job closed. Nothing left to do.');
  const cur = steps.find(s => s.state === 'current');
  if (c.rejectedAll) return N('service_advisor', 'Service Advisor', 'rejected_all', 'The customer rejected the estimate. The regret email has gone out — record their reason and close the job.');
  if (!cur) return null;
  switch (cur.key) {
    case 'classification': return N('service_advisor', 'Service Advisor', 'classify', 'Classify the customer: Internal or External, then Fleet, Insurance, Asset or Walk-in.', 'classify');
    case 'intake': {
      // Say what is missing, not just "the intake" (C7).
      const list = c.intakeMissing.length ? c.intakeMissing : ['the vehicle', 'the reported issue'];
      const missing = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
      return N('service_advisor', 'Service Advisor', 'intake_missing', `Record ${missing} on the job card.`, 'edit', { missing });
    }
    case 'job_card': return N('service_advisor', 'Service Advisor', 'open_job_card', 'Open the main job card.', 'open_job_card');
    case 'inspection_pricing':
      if (!c.estimate) {
        // The walk-around is done: only the estimate is left.
        return c.intakeDone
          ? N('service_advisor', 'Service Advisor', 'create_estimate_from_inspection', 'Raise the estimate with the inspection findings.', 'create_estimate')
          : N('service_advisor', 'Service Advisor', 'create_estimate', 'Carry out the technical inspection and raise the estimate with the findings.', 'create_estimate');
      }
      if (c.pricing?.unpricedParts > 0) return N('storekeeper', 'Storekeeper', 'price_parts', 'Price the parts — Genuine and After-Market, or mark a type N/A.', 'price_parts');
      return N('service_advisor', 'Service Advisor', 'price_labour', 'Price the labour on the estimate.', 'open_estimate');
    case 'estimate':
      if (c.counterPriced && !c.managerApproved) return N('service_advisor', 'Service Advisor', 'counter_needs_estimate',
        'This external job was priced at the counter without Supervisor / Workshop Manager approval. Raise the estimate so it can be approved before it goes to the customer.', 'create_estimate');
      if (c.counterPriced) return N('service_advisor', 'Service Advisor', 'record_approval', 'Record how the customer agreed to the job card.', 'record_approval');
      if (!c.managerApproved)
        return N('manager', 'Supervisor / Workshop Manager', 'approve_estimate', 'Approve the estimate before it goes to this external customer.', 'open_estimate');
      return N('service_advisor', 'Service Advisor', 'send_estimate', 'Send the estimate to the customer by WhatsApp or Email.', 'open_estimate');
    case 'work':
      if (!c.approved) return N('customer', 'Customer', 'await_customer', 'Waiting for the customer to approve or reject the estimate lines.', c.counterPriced ? 'record_approval' : 'open_estimate');
      if (!c.wo.mechanic_id) return N('team_leader', 'Team Leader', 'assign', 'Assign the job to a technician.', 'assign');
      if (c.partsWaiting.length) return N('storekeeper', 'Storekeeper', 'parts_waiting', `${c.partsWaiting.length} part(s) not issued yet — check the shelf or record the expected arrival date.`, 'parts', { n: c.partsWaiting.length });
      return N('technician', 'Technician', 'work', 'Work the job with time booking (Start / Pause / Stop), then mark it done.', 'time');
    case 'closure':
      if (c.qcFailed) return N('team_leader_supervisor', 'Team Leader / Supervisor', 'qc_failed', 'The quality check failed. Put the job back in work and re-check.', 'time');
      if (!c.qcPassed) return N('supervisor_foreman', 'Supervisor / Foreman', 'qc', 'Carry out the quality check, including the test drive.', 'qc');
      if (!c.pickupContacted) return N('service_advisor', 'Service Advisor', 'contact', 'Job completed — ready for collection. Call the customer to arrange collection.', 'contact');
      if (!c.paid) return N('cashier', 'Cashier / Service Advisor', 'payment', 'Complete the payment and invoice.', 'invoice');
      if (!c.gateReleased) return N('service_advisor', 'Service Advisor', 'gate_pass', 'Issue the final gate pass.', 'gate_pass');
      return N('service_advisor', 'Service Advisor', 'close', 'Close the job.', 'close');
    default: return null;
  }
}

function timeByCardRunning(cards) { return cards.some(c => c.time.state === 'running'); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s; }
function clip(s, max) { const t = String(s || '').trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; }
function fmtSub(s) { return s ? ({ walkin: 'Walk-in', fleet: 'Fleet', insurance: 'Insurance', asset: 'Asset' })[s] || cap(s) : null; }
function fmtFormat(f) { return f === 'genuine' ? '(Format 1 — Genuine)' : f === 'after_market' ? '(Format 2 — After-Market)' : f === 'both' ? '(Format 3 — Genuine & After-Market)' : ''; }
function fmtOutcome(o) { return o === 'reached' ? 'reached' : o === 'no_answer' ? 'no answer' : o === 'message_sent' ? 'message sent' : 'logged'; }
export function fmtMinutes(m) { const h = Math.floor(m / 60); const mm = m % 60; return h ? `${h}h ${mm}m` : `${mm}m`; }

/**
 * Step 6, technician assignment: the main job card follows the work order's
 * technician, and the technician is told. Called by every assign path
 * (Team Leader board, job card screen, work order assign).
 */
export async function onTechnicianAssigned({ workOrderId, workshopId, mechanicId }) {
  try {
    const main = await ensureMainJobCard({ workOrderId, workshopId, notify: false });
    if (main) await execute('UPDATE job_cards SET mechanic_id = ? WHERE id = ?', [mechanicId, main.id]);
    await notifyTechnicianAssigned({ workshopId, workOrderId, mechanicId, jobCardId: main?.id || null });
  } catch (err) {
    console.error('[Workflow] assignment follow-up failed:', err.message);
  }
}

/**
 * Step 6: tell the technician a job card is theirs — in-app ("Job assigned:
 * WO · plate", the prefix the QA suite checks) and a phone push ("New job
 * card: plate vehicle"), both opening the card in the technician app. The
 * job card, vehicle and reported issue only: no customer name or phone, no
 * money, no "pickup".
 *
 * Every assign path ends here — onTechnicianAssigned, lib/notify.js
 * notifyMechanicAssigned (job assignment, auto-assign) and a manual
 * "assigned" status — and the in-app dedup (technician + work order +
 * 'workflow_assigned' within the hour) keeps it to one notice and one push
 * per assignment.
 *
 * @returns {Promise<null|{jobCardId, jobCardNumber, plate, makeModel, complaint, link}>}
 *   what was said (lib/notify.js reuses it for the technician's email), or
 *   null when the work order does not exist.
 */
export async function notifyTechnicianAssigned({ workshopId, workOrderId, mechanicId, jobCardId = null }) {
  const [wo] = await query(
    `SELECT wo.work_order_number, wo.description, v.plate_number, v.make, v.model
       FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id WHERE wo.id = ? AND wo.workshop_id = ?`,
    [workOrderId, workshopId]
  );
  if (!wo) return null;
  // The card named in the notice: the one given, else the technician's own
  // (main first), else the work order's main card.
  const [jc] = jobCardId
    ? await query('SELECT id, job_card_number FROM job_cards WHERE id = ? AND workshop_id = ?', [jobCardId, workshopId])
    : await query(
      `SELECT id, job_card_number FROM job_cards
        WHERE work_order_id = ? AND workshop_id = ? AND status <> 'cancelled' AND (mechanic_id = ? OR parent_job_card_id IS NULL)
        ORDER BY mechanic_id = ? DESC, parent_job_card_id IS NOT NULL, id LIMIT 1`,
      [workOrderId, workshopId, mechanicId, mechanicId]);
  const plate = String(wo.plate_number || '').trim();
  const makeModel = [wo.make, wo.model].filter(Boolean).join(' ').trim();
  const vehicle = [plate, makeModel].filter(Boolean).join(' ');
  const complaint = shortText(wo.description, 140);
  const what = jc ? `Job card ${jc.job_card_number}` : `Work order ${wo.work_order_number}`;
  // Only a card given by the caller is trusted as theirs; otherwise the link
  // looks up the technician's own card (a card that is not theirs would 404).
  const link = await technicianJobLink({ workshopId, mechanicId, orderId: workOrderId, jobCardId });
  await notifyMechanic(workshopId, mechanicId, {
    title: `Job assigned: ${wo.work_order_number}${plate ? ` · ${plate}` : ''}`,
    body: `${what} assigned${vehicle ? `: ${vehicle}` : ''}${complaint ? ` — ${complaint}` : ''}${complaint.endsWith('…') ? ' ' : '. '}Press Start when you begin.`,
    link, orderId: workOrderId, type: 'workflow_assigned',
    push: { title: `New job card: ${vehicle || wo.work_order_number}` },
  });
  return { jobCardId: jc?.id || null, jobCardNumber: jc?.job_card_number || null, plate, makeModel, complaint, link };
}

/** Step 6: the customer approved — the floor is told the work is ready to assign. */
export async function onWorkApproved({ workOrderId, workshopId, userId = null, how = '' }) {
  try {
    const main = await ensureMainJobCard({ workOrderId, workshopId, userId, notify: false });
    const [wo] = await query('SELECT work_order_number, mechanic_id FROM work_orders WHERE id = ? AND workshop_id = ?', [workOrderId, workshopId]);
    if (!wo) return;
    await notifyGroups(workshopId, FLOOR, {
      title: `Approved: ${wo.work_order_number}`,
      body: `The customer approved the work${how ? ` (${how})` : ''}. ${wo.mechanic_id ? 'A technician is already assigned.' : 'Ready for the Team Leader to assign a technician.'}${main ? ` Job card ${main.job_card_number}.` : ''}`,
      link: `/work-orders/${workOrderId}`, orderId: workOrderId, icon: '✅', type: 'workflow_work_approved', exceptUserId: userId,
    });
  } catch (err) {
    console.error('[Workflow] approval follow-up failed:', err.message);
  }
}
