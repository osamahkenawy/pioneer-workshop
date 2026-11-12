/**
 * /api/technical-inspections — Step 4, the technical inspection and the
 * technical report (client review, 2 Nov 2026; client meeting, 3 Nov 2026).
 *
 * Once the main job card is open (the customer acknowledged the physical
 * inspection; an internal customer's opens with the work order), the
 * Supervisor or Workshop Foreman (tech.inspect, lib/roles.js) inspects the
 * car and writes the technical report: the service lines, each a job /
 * service with its service type, the labour and its parts. Completing it
 * tells the Service Advisor, who raises the estimate from it — the estimate
 * form is pre-filled from the lines; the advisor prices the labour and the
 * parts go to the Store. One per work order (technical_inspections.work_order_id
 * is unique). A first version: the client is still settling the fields.
 *
 *   GET   /?work_order_id=   the work order's inspection (or null), the report header and the customer's link
 *   POST  /                  { work_order_id } start it (or get the one already started)
 *   PUT   /:id               { service_lines } save the draft
 *   PATCH /:id/complete      the report is done: job types merged, the Service Advisor told, the customer's link made
 *   PATCH /:id/reopen        back to draft, while no estimate has been raised
 *   GET   /:id/share         the customer's link and the channels that reach them
 *   POST  /:id/share         { channel: whatsapp | email | link } send the customer the report
 *   POST  /:id/share/reset   a new link (the old one stops working)
 *
 * service_lines: [{ job, service_type (a lib/intake-rules.js JOB_TYPES key,
 * required on every line since 3 Nov 2026), labour, hours,
 * parts: [{ description, part_number, quantity }], notes }].
 *
 * The findings field left the report on 3 Nov 2026: it is no longer written
 * (a `findings` sent is ignored); a report that has findings keeps them, and
 * the screen shows them read-only.
 *
 * The customer gets the report once it is completed — only what is to be
 * done: the jobs, their service types, the labour and the parts' names; no
 * hours, quantities or part numbers (routes/public-technical-reports.js
 * customerReportView). The link is made at completion, so it is ready at
 * once; sending it stays a click (WhatsApp / e-mail / copy), as for the
 * inspection (routes/vehicle-inspections.js POST /:id/share). The customer
 * opens it at /technical-report/<token>, or on the job's page in the portal.
 *
 * Every staff role reads it. A technician (lib/access.js lets their GET
 * through) only on a job that is theirs, and without the customer's name —
 * as on their job card (routes/job-cards.js). Raising an estimate does not
 * wait for the report: lib/workflow.js only points to it as the next step.
 */
import express from 'express';
import crypto from 'crypto';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { can, requireCapability } from '../lib/roles.js';
import { isTechnician } from '../lib/access.js';
import { stripMarkup, clampText } from '../lib/sanitize.js';
import { jobCardGate, PHYSICAL_INSPECTION_REQUIRED } from '../lib/physical-inspection.js';
import { getMainJobCard, notifyGroups } from '../lib/workflow.js';
import { JOB_TYPES, jobTypesOf } from '../lib/intake-rules.js';
import { sendNotificationEmail } from '../lib/email.js';
import { customerAppBase } from '../lib/customer-link.js';
import { waDigits } from '../lib/portal-access.js';

const router = express.Router();
router.use(authMiddleware);

const INSPECT = requireCapability('tech.inspect');

// The report's fields and their limits (the client's first version).
const MAX = { lines: 50, job: 200, labour: 500, hours: 999, parts: 30, description: 200, part_number: 100, quantity: 9999, notes: 1000 };

const isClosed = status => ['completed', 'cancelled'].includes(status);
const closedBody = status => ({ success: false, code: 'JOB_CLOSED', message: `This work order is ${status}.` });

/* ── Reading ──────────────────────────────────────────────────────────── */

const parseLines = v => {
  try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch { return []; }
};

/** The inspection as the screens read it: the lines parsed, with who started and who completed it.
 *  The customer's link is not in it: GET /:id/share hands it to the roles that send it. */
async function loadInspection(where, params) {
  const [row] = await query(
    `SELECT ti.*, ui.full_name AS inspected_by_name, uc.full_name AS completed_by_name
       FROM technical_inspections ti
       LEFT JOIN users ui ON ui.id = ti.inspected_by
       LEFT JOIN users uc ON uc.id = ti.completed_by
      WHERE ${where}`, params);
  if (!row) return null;
  const { share_token: _token, ...rest } = row;
  return { ...rest, service_lines: parseLines(row.service_lines) };
}
const byId = (id, workshopId) => loadInspection('ti.id = ? AND ti.workshop_id = ?', [id, workshopId]);
const byWorkOrder = (workOrderId, workshopId) => loadInspection('ti.work_order_id = ? AND ti.workshop_id = ?', [workOrderId, workshopId]);

/** The estimate raised for the work order (any not rejected or expired), or null. */
async function liveEstimate(workOrderId, workshopId) {
  const [e] = await query(
    `SELECT id, estimate_number, status FROM service_estimates
      WHERE workshop_id = ? AND (intake_work_order_id = ? OR work_order_id = ?) AND status NOT IN ('rejected','expired')
      ORDER BY id DESC LIMIT 1`, [workshopId, workOrderId, workOrderId]);
  return e || null;
}

/** A technician's own job: theirs on the work order, or one of its job cards is. */
async function isTheirJob(req, wo) {
  const [m] = await query('SELECT id FROM mechanics WHERE user_id = ? AND workshop_id = ?', [req.user.id, req.workshopId]);
  if (!m) return false;
  if (Number(wo.mechanic_id) === Number(m.id)) return true;
  const [jc] = await query(
    "SELECT id FROM job_cards WHERE work_order_id = ? AND workshop_id = ? AND mechanic_id = ? AND status <> 'cancelled' LIMIT 1",
    [wo.id, req.workshopId, m.id]);
  return !!jc;
}

/* ── Checking what is sent ────────────────────────────────────────────── */

const blank = v => v === undefined || v === null || (typeof v === 'string' && !v.trim());

/** Optional text, trimmed: { value } (null when blank) or { error }. `plural`: "the notes are". */
function textOf(v, max, what, plural = false) {
  if (blank(v)) return { value: null };
  if (typeof v !== 'string' && typeof v !== 'number') return { error: `${what} must be text.` };
  const s = String(v).trim();
  return s.length > max ? { error: `${what} ${plural ? 'are' : 'is'} too long (at most ${max} characters).` } : { value: s };
}
// Short labels (the job, a part, its number) lose any markup, as names do
// elsewhere; the free text keeps "< 2mm" (lib/sanitize.js).
const label = (s, max) => (s == null ? null : (stripMarkup(s, max) || '').replace(/\s+/g, ' ').trim() || null);
const freeText = (s, max) => (s == null ? null : clampText(s, max));

/** Optional number from `min` (or above it, `above`) to `max`, to two decimals: { value } or { error }. */
function numberOf(v, { min = 0, above = false, max, what }) {
  if (blank(v)) return { value: null };
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  const r = Math.round(n * 100) / 100;
  if (!Number.isFinite(n) || (above ? r <= min : r < min) || r > max) {
    return { error: `${what} must be a number ${above ? 'above' : 'from'} ${min}${above ? ' and up to' : ' to'} ${max}.` };
  }
  return { value: r };
}

const typeList = () => Object.values(JOB_TYPES).join(', ');
/** A line without a known service type: { error, code, line } (line: its index), as the save and the completion refuse it. */
const typeRequired = i => ({
  error: `Service line ${i + 1}: choose its service type (${typeList()}).`, code: 'SERVICE_TYPE_REQUIRED', line: i,
});

/**
 * The service lines of a request: { lines } cleaned, or { error, code?, line? }.
 * A line or a part row left completely empty (added on the screen, never
 * filled in) is dropped; anything else has to be valid. Every line has a job
 * and a service type (client meeting, 3 Nov 2026).
 */
export function parseServiceLines(input) {
  if (!Array.isArray(input)) return { error: 'service_lines must be a list.' };
  if (input.length > MAX.lines) return { error: `At most ${MAX.lines} service lines.` };
  const lines = [];
  for (const [i, raw] of input.entries()) {
    const at = `Service line ${i + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${at} is not valid.` };
    const rawParts = raw.parts ?? [];
    if (!Array.isArray(rawParts)) return { error: `${at}: the parts must be a list.` };
    if (rawParts.length > MAX.parts) return { error: `${at}: at most ${MAX.parts} parts.` };
    const emptyPart = p => !p || (typeof p === 'object' && blank(p.description) && blank(p.part_number));
    if (['job', 'service_type', 'labour', 'hours', 'notes'].every(k => blank(raw[k])) && rawParts.every(emptyPart)) continue;

    const job = textOf(raw.job, MAX.job, `${at}: the job / service`);
    const labour = textOf(raw.labour, MAX.labour, `${at}: the labour`);
    const notes = textOf(raw.notes, MAX.notes, `${at}: the notes`, true);
    const hours = numberOf(raw.hours, { min: 0, max: MAX.hours, what: `${at}: the hours` });
    const bad = [job, labour, notes, hours].find(x => x.error);
    if (bad) return { error: bad.error };
    const jobName = label(job.value, MAX.job);
    if (!jobName) return { error: `${at}: the job / service is required.`, line: i };
    const type = blank(raw.service_type) ? null : String(raw.service_type).trim().toLowerCase();
    if (!type) return typeRequired(i);
    if (!JOB_TYPES[type]) return { error: `${at}: the service type must be one of: ${typeList()}.`, line: i };

    const parts = [];
    for (const [j, p] of rawParts.entries()) {
      if (emptyPart(p)) continue;
      const pat = `${at}, part ${j + 1}`;
      if (typeof p !== 'object' || Array.isArray(p)) return { error: `${pat} is not valid.` };
      const description = textOf(p.description, MAX.description, `${pat}: the description`);
      const partNumber = textOf(p.part_number, MAX.part_number, `${pat}: the part number`);
      const quantity = numberOf(p.quantity, { min: 0, above: true, max: MAX.quantity, what: `${pat}: the quantity` });
      const badPart = [description, partNumber, quantity].find(x => x.error);
      if (badPart) return { error: badPart.error };
      const desc = label(description.value, MAX.description);
      if (!desc) return { error: `${pat}: the description is required.` };
      parts.push({ description: desc, part_number: label(partNumber.value, MAX.part_number), quantity: quantity.value ?? 1 });
    }
    lines.push({
      job: jobName, service_type: type, labour: freeText(labour.value, MAX.labour), hours: hours.value,
      parts, notes: freeText(notes.value, MAX.notes),
    });
  }
  return { lines };
}

/** A line the estimate can be raised from: the job, and its labour or parts. */
const usableLine = l => !!String(l?.job || '').trim() && (!!String(l.labour || '').trim() || (Array.isArray(l.parts) && l.parts.length > 0));

/* ── The customer's link ──────────────────────────────────────────────── */

const SHARE_CHANNELS = ['whatsapp', 'email', 'link'];
const newToken = () => crypto.randomBytes(32).toString('base64url');

/** The customer's copy of the report — on the same customer site as the
 *  status page and the inspection link (lib/customer-link.js). */
export function technicalReportUrl(token) {
  return `${customerAppBase()}/technical-report/${token}`;
}

/** Who sends the customer the report: the advisor's desk (estimates,
 *  handover), the Supervisor / Foreman who wrote it, and managers. */
const canSend = user => can(user, 'estimate.raise') || can(user, 'delivery.handover') || can(user, 'tech.inspect');
const NOT_ALLOWED = { success: false, code: 'ROLE_NOT_ALLOWED', message: "Your role can't send the technical report to the customer — ask the Service Advisor." };

// The report and who it goes to: the work order's customer, as on the job card.
async function loadForShare(id, workshopId) {
  const [row] = await query(
    `SELECT ti.id, ti.work_order_id, ti.status, ti.share_token, ti.shared_at, ti.shared_via,
            TIMESTAMPDIFF(SECOND, ti.shared_at, NOW()) AS shared_secs_ago,
            wo.work_order_number, wo.status AS wo_status, v.plate_number,
            COALESCE(NULLIF(wo.customer_email, ''), NULLIF(c.email, '')) AS to_email,
            COALESCE(NULLIF(wo.customer_phone, ''), NULLIF(c.phone, '')) AS to_phone
       FROM technical_inspections ti
       JOIN work_orders wo ON wo.id = ti.work_order_id AND wo.workshop_id = ti.workshop_id
       LEFT JOIN customers c ON c.id = wo.customer_id
       LEFT JOIN vehicles v ON v.id = wo.vehicle_id
      WHERE ti.id = ? AND ti.workshop_id = ?`, [id, workshopId]);
  return row || null;
}

/** Where the link stands, for the "Send to the customer" area. The link itself only for those who send it. */
function shareState(row, user) {
  const mine = canSend(user);
  return {
    url: row.share_token && mine ? technicalReportUrl(row.share_token) : null,
    shared_at: row.shared_at || null, shared_via: row.shared_via || null,
    can_send: mine,
    can_email: !!row.to_email, can_whatsapp: !!waDigits(row.to_phone),
    completed: row.status === 'completed',
    work_order_cancelled: row.wo_status === 'cancelled',
  };
}

/* ── Routes ───────────────────────────────────────────────────────────── */

// GET /api/technical-inspections?work_order_id= — the inspection (or null),
// the report header (work_order), whether the viewer may write it, and —
// for staff other than technicians — where the customer's link stands (share).
router.get('/', async (req, res) => {
  try {
    const woId = Number(req.query.work_order_id);
    if (!Number.isInteger(woId) || woId <= 0) return res.status(400).json({ success: false, message: 'work_order_id is required' });
    const [wo] = await query(
      `SELECT wo.id, wo.work_order_number, wo.status, wo.customer_name, wo.description, wo.odometer_in, wo.mechanic_id,
              c.full_name AS customer_full_name, v.plate_number, v.make, v.model, v.year, v.vin, w.name AS workshop_name
         FROM work_orders wo
         LEFT JOIN customers c ON c.id = wo.customer_id
         LEFT JOIN vehicles v  ON v.id = wo.vehicle_id
         LEFT JOIN workshops w ON w.id = wo.workshop_id
        WHERE wo.id = ? AND wo.workshop_id = ?`, [woId, req.workshopId]);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    const technician = isTechnician(req.user);
    if (technician && !(await isTheirJob(req, wo))) return res.status(404).json({ success: false, message: 'Work order not found' });

    const [inspection, main, gate, estimate] = await Promise.all([
      byWorkOrder(wo.id, req.workshopId),
      getMainJobCard(wo.id, req.workshopId),
      jobCardGate({ workOrderId: wo.id, workshopId: req.workshopId }),
      technician ? null : liveEstimate(wo.id, req.workshopId),
    ]);
    const header = {
      id: wo.id, work_order_number: wo.work_order_number, status: wo.status, workshop_name: wo.workshop_name || null,
      job_card_number: main?.job_card_number || null,
      // The inspection can start: the main job card is open, or the customer is internal.
      ready: gate.internal || gate.jobCardOpen,
      customer_name: wo.customer_full_name || wo.customer_name || null,
      plate_number: wo.plate_number || null, make: wo.make || null, model: wo.model || null, year: wo.year || null, vin: wo.vin || null,
      odometer_in: wo.odometer_in, complaint: wo.description || null,
    };
    if (technician) delete header.customer_name;
    const shareRow = inspection && !technician ? await loadForShare(inspection.id, req.workshopId) : null;
    res.json({
      success: true, data: inspection, work_order: header, estimate,
      share: shareRow ? shareState(shareRow, req.user) : null,
      you: { can_inspect: can(req.user, 'tech.inspect') },
    });
  } catch (err) {
    console.error('GET /technical-inspections error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the technical inspection' });
  }
});

// POST /api/technical-inspections — { work_order_id }: start the inspection
// (a draft), or get the one already started.
router.post('/', INSPECT, async (req, res) => {
  try {
    const woId = Number(req.body?.work_order_id);
    if (!Number.isInteger(woId) || woId <= 0) return res.status(400).json({ success: false, message: 'work_order_id is required' });
    const [wo] = await query('SELECT id, work_order_number, status FROM work_orders WHERE id = ? AND workshop_id = ?', [woId, req.workshopId]);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (isClosed(wo.status)) return res.status(409).json(closedBody(wo.status));
    const existing = await byWorkOrder(wo.id, req.workshopId);
    if (existing) return res.json({ success: true, data: existing });
    // The report is written under the main job card, which an external
    // customer's job only has once they acknowledged the physical inspection.
    const gate = await jobCardGate({ workOrderId: wo.id, workshopId: req.workshopId });
    if (!gate.internal && !gate.jobCardOpen) {
      return res.status(409).json({ success: false, ...PHYSICAL_INSPECTION_REQUIRED,
        message: 'The technical inspection starts once the job card is open — the customer has not acknowledged the physical inspection yet.' });
    }
    const main = await getMainJobCard(wo.id, req.workshopId);
    let created = true;
    try {
      await execute(
        `INSERT INTO technical_inspections (workshop_id, work_order_id, job_card_id, status, service_lines, inspected_by)
         VALUES (?, ?, ?, 'draft', '[]', ?)`, [req.workshopId, wo.id, main?.id || null, req.user.id]);
    } catch (err) {
      // Two starts racing: the other one's draft is the inspection.
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      created = false;
    }
    const row = await byWorkOrder(wo.id, req.workshopId);
    if (created) {
      await logAudit({ workshopId: req.workshopId, userId: req.user.id, action: 'CREATE', entityType: 'technical_inspections', entityId: row.id,
        newValue: { work_order_id: wo.id, job_card_id: row.job_card_id } });
    }
    res.status(created ? 201 : 200).json({ success: true, data: row, message: 'Technical inspection started' });
  } catch (err) {
    console.error('POST /technical-inspections error:', err);
    res.status(500).json({ success: false, message: 'Failed to start the technical inspection' });
  }
});

// PUT /api/technical-inspections/:id — { service_lines }: save the draft.
// Not sent: the lines stay as they are. `findings` is no longer written
// (client meeting, 3 Nov 2026): one sent is ignored, a report's own stay.
router.put('/:id', INSPECT, async (req, res) => {
  try {
    const row = await byId(req.params.id, req.workshopId);
    if (!row) return res.status(404).json({ success: false, message: 'Technical inspection not found' });
    if (row.status === 'completed') {
      return res.status(409).json({ success: false, code: 'REPORT_COMPLETED', message: 'The technical report is completed — reopen it to change it.' });
    }
    const [wo] = await query('SELECT status FROM work_orders WHERE id = ? AND workshop_id = ?', [row.work_order_id, req.workshopId]);
    if (isClosed(wo?.status)) return res.status(409).json(closedBody(wo.status));

    const body = req.body || {};
    const sets = [], params = [];
    if (body.service_lines !== undefined) {
      const p = parseServiceLines(body.service_lines);
      if (p.error) {
        return res.status(400).json({ success: false, code: p.code || 'VALIDATION_ERROR', message: p.error, ...(p.line != null ? { line: p.line } : {}) });
      }
      sets.push('service_lines = ?'); params.push(JSON.stringify(p.lines));
    }
    if (sets.length) {
      // Only a draft: completed by someone else in the meantime → refused.
      const r = await execute(`UPDATE technical_inspections SET ${sets.join(', ')} WHERE id = ? AND workshop_id = ? AND status = 'draft'`,
        [...params, row.id, req.workshopId]);
      if (!r.affectedRows) {
        return res.status(409).json({ success: false, code: 'REPORT_COMPLETED', message: 'The technical report has just been completed — reopen it to change it.' });
      }
    }
    res.json({ success: true, data: await byId(row.id, req.workshopId), message: 'Saved' });
  } catch (err) {
    console.error('PUT /technical-inspections/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to save the technical inspection' });
  }
});

// PATCH /api/technical-inspections/:id/complete — the technical report is
// done. Every line needs its service type (a draft saved before that rule may
// lack one). Its service types join the work order's job types, the history
// says so, the Service Advisor is told to raise the estimate from it, and the
// customer's link is made — ready to send (POST /:id/share).
router.patch('/:id/complete', INSPECT, async (req, res) => {
  try {
    const row = await byId(req.params.id, req.workshopId);
    if (!row) return res.status(404).json({ success: false, message: 'Technical inspection not found' });
    if (row.status === 'completed') return res.json({ success: true, data: row, message: 'Already completed' });
    const [wo] = await query(
      `SELECT wo.id, wo.work_order_number, wo.status, wo.job_types, wo.customer_name, c.full_name AS customer_full_name, v.plate_number
         FROM work_orders wo LEFT JOIN customers c ON c.id = wo.customer_id LEFT JOIN vehicles v ON v.id = wo.vehicle_id
        WHERE wo.id = ? AND wo.workshop_id = ?`, [row.work_order_id, req.workshopId]);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (isClosed(wo.status)) return res.status(409).json(closedBody(wo.status));
    const lines = row.service_lines;
    if (!lines.some(usableLine)) {
      return res.status(400).json({ success: false, code: 'REPORT_INCOMPLETE',
        message: 'Add at least one service line with the job and its labour or parts before completing the report.' });
    }
    const untyped = lines.findIndex(l => !JOB_TYPES[l.service_type]);
    if (untyped >= 0) {
      const e = typeRequired(untyped);
      return res.status(400).json({ success: false, code: e.code, line: e.line, message: e.error });
    }
    // The customer's link is made now (kept from an earlier completion), so it is there to send.
    const r = await execute(
      `UPDATE technical_inspections SET status = 'completed', completed_by = ?, completed_at = NOW(), share_token = COALESCE(share_token, ?)
        WHERE id = ? AND workshop_id = ? AND status = 'draft'`,
      [req.user.id, newToken(), row.id, req.workshopId]);
    if (!r.affectedRows) return res.json({ success: true, data: await byId(row.id, req.workshopId), message: 'Already completed' });

    // Job types (Step 4): the advisor's ticks stay, the report's service types are added.
    const before = jobTypesOf(wo);
    const types = new Set([...before, ...lines.map(l => l.service_type).filter(t => JOB_TYPES[t])]);
    const jobTypes = [...Object.keys(JOB_TYPES).filter(k => types.has(k)), ...before.filter(k => !JOB_TYPES[k])];
    if (jobTypes.join(',') !== before.join(',')) {
      await execute('UPDATE work_orders SET job_types = ? WHERE id = ? AND workshop_id = ?', [JSON.stringify(jobTypes), wo.id, req.workshopId]);
    }

    const n = lines.length;
    const lineWords = `${n} service line${n === 1 ? '' : 's'}`;
    const typeWords = [...new Set(lines.map(l => JOB_TYPES[l.service_type]).filter(Boolean))].join(', ');
    await execute(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
      [wo.id, wo.status, req.user.id, `Technical report completed — ${lineWords}${typeWords ? ` (${typeWords})` : ''}`]);
    // The advisor raises the estimate from it — unless one was raised already (without the report).
    const customer = wo.customer_full_name || wo.customer_name;
    const estimate = await liveEstimate(wo.id, req.workshopId);
    if (!estimate) {
      await notifyGroups(req.workshopId, ['service_advisor'], {
        title: `Technical report ready for ${wo.work_order_number}: raise the estimate`,
        body: `${req.user.full_name || 'The Supervisor'} completed the technical inspection${wo.plate_number ? ` of ${wo.plate_number}` : ''}`
          + `${customer ? ` (${customer})` : ''}: ${lineWords}. Raise the estimate from the report — price the labour; the parts go to the Store.`
          + ' Send the customer their copy of the report from there.',
        link: `/work-orders/${wo.id}/technical-inspection`, orderId: wo.id, icon: '🔧', type: 'workflow_tech_report_ready', exceptUserId: req.user.id,
      });
    }
    await logAudit({ workshopId: req.workshopId, userId: req.user.id, action: 'COMPLETE', entityType: 'technical_inspections', entityId: row.id,
      newValue: { work_order_id: wo.id, service_lines: n, job_types: jobTypes } });
    const shareRow = await loadForShare(row.id, req.workshopId);
    res.json({ success: true, data: await byId(row.id, req.workshopId), job_types: jobTypes, share: shareRow ? shareState(shareRow, req.user) : null,
      message: estimate ? `Technical report completed (estimate ${estimate.estimate_number} is already raised).`
        : 'Technical report completed — the Service Advisor has been told to raise the estimate.' });
  } catch (err) {
    console.error('PATCH /technical-inspections/:id/complete error:', err);
    res.status(500).json({ success: false, message: 'Failed to complete the technical report' });
  }
});

// PATCH /api/technical-inspections/:id/reopen — back to draft to change it.
// Refused once an estimate has been raised for the work order: the estimate
// is what changes from then on. The customer's link stays; until the report
// is completed again it says the report is being updated.
router.patch('/:id/reopen', INSPECT, async (req, res) => {
  try {
    const row = await byId(req.params.id, req.workshopId);
    if (!row) return res.status(404).json({ success: false, message: 'Technical inspection not found' });
    if (row.status === 'draft') return res.json({ success: true, data: row, message: 'Already a draft' });
    const [wo] = await query('SELECT id, status FROM work_orders WHERE id = ? AND workshop_id = ?', [row.work_order_id, req.workshopId]);
    if (isClosed(wo?.status)) return res.status(409).json(closedBody(wo.status));
    const estimate = await liveEstimate(row.work_order_id, req.workshopId);
    if (estimate) {
      return res.status(409).json({ success: false, code: 'ESTIMATE_RAISED', estimate,
        message: `Estimate ${estimate.estimate_number} has been raised for this work order, so the technical report can no longer be changed — change the estimate instead.` });
    }
    await execute(
      "UPDATE technical_inspections SET status = 'draft', completed_by = NULL, completed_at = NULL WHERE id = ? AND workshop_id = ?",
      [row.id, req.workshopId]);
    await execute(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
      [wo.id, wo.status, req.user.id, 'Technical report reopened for changes']);
    await logAudit({ workshopId: req.workshopId, userId: req.user.id, action: 'REOPEN', entityType: 'technical_inspections', entityId: row.id,
      oldValue: { status: 'completed', completed_by: row.completed_by, completed_at: row.completed_at }, newValue: { status: 'draft' } });
    res.json({ success: true, data: await byId(row.id, req.workshopId), message: 'Reopened — the technical report can be changed again.' });
  } catch (err) {
    console.error('PATCH /technical-inspections/:id/reopen error:', err);
    res.status(500).json({ success: false, message: 'Failed to reopen the technical report' });
  }
});

/* ── The customer's copy: a link by WhatsApp or e-mail ─────────────────── */

// GET /api/technical-inspections/:id/share — where the link stands, and which
// channels can reach the customer. Not for technicians (lib/access.js lets
// their GET through for the report itself).
router.get('/:id/share', async (req, res) => {
  try {
    if (isTechnician(req.user)) return res.status(403).json(NOT_ALLOWED);
    const row = await loadForShare(req.params.id, req.workshopId);
    if (!row) return res.status(404).json({ success: false, message: 'Technical inspection not found' });
    res.json({ success: true, data: shareState(row, req.user) });
  } catch (err) {
    console.error('GET /technical-inspections/:id/share error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the link' });
  }
});

/**
 * POST /api/technical-inspections/:id/share — send the customer the report.
 * Body: { channel: 'whatsapp' | 'email' | 'link' }
 *
 * Completed reports only, as the inspection's (routes/vehicle-inspections.js):
 * the link is made once and reused, so every message opens the same page.
 * 'whatsapp' returns a wa.me link for the screen to open (the message is sent
 * from the advisor's WhatsApp); 'email' sends it from here; 'link' is the
 * copy button. The same e-mail is not sent twice within a minute.
 */
router.post('/:id/share', async (req, res) => {
  try {
    const channel = req.body?.channel;
    if (!SHARE_CHANNELS.includes(channel)) {
      return res.status(400).json({ success: false, message: 'channel must be whatsapp, email or link' });
    }
    const row = await loadForShare(req.params.id, req.workshopId);
    if (!row) return res.status(404).json({ success: false, message: 'Technical inspection not found' });
    if (!canSend(req.user)) return res.status(403).json(NOT_ALLOWED);
    if (row.status !== 'completed') {
      return res.status(409).json({ success: false, code: 'NOT_COMPLETED', message: 'Complete the technical report first, then send it to the customer.' });
    }
    // The customer's page closes for a cancelled job (public-technical-reports.js), so there is nothing to send.
    if (row.wo_status === 'cancelled') {
      return res.status(409).json({ success: false, code: 'WORK_ORDER_CANCELLED', message: 'This work order is cancelled — the technical report is no longer sent to the customer.' });
    }
    if (channel === 'email' && !row.to_email) {
      return res.status(400).json({ success: false, code: 'NO_EMAIL', message: 'No e-mail on file for this customer — send it by WhatsApp, or copy the link.' });
    }
    if (channel === 'email' && row.shared_via === 'email' && row.shared_secs_ago != null && row.shared_secs_ago < 60) {
      return res.status(429).json({ success: false, code: 'JUST_SENT', message: 'The e-mail was just sent — wait a minute before sending it again.' });
    }

    // Made at completion; a report completed before that, or a "New link", gets it here.
    await execute('UPDATE technical_inspections SET share_token = COALESCE(share_token, ?) WHERE id = ?', [newToken(), row.id]);
    const [{ share_token: token }] = await query('SELECT share_token FROM technical_inspections WHERE id = ?', [row.id]);
    const url = technicalReportUrl(token);

    const plate = stripMarkup(row.plate_number || '', 30);
    const vehicle = plate ? `your vehicle (${plate})` : 'your vehicle';
    if (channel === 'email') {
      const sent = await sendNotificationEmail({
        to: row.to_email,
        tenantId: req.workshopId,
        subject: `Technical report — ${row.work_order_number}`,
        title: 'Your technical report',
        body: `Here is the technical inspection report of ${vehicle}, work order ${row.work_order_number}: `
          + 'the work our technicians found it needs, with the parts. The prices come with the estimate.',
        ctaText: 'View the report',
        ctaUrl: url,
      });
      if (!sent?.success) {
        return res.status(502).json({ success: false, code: 'EMAIL_FAILED', message: 'The e-mail could not be sent — send it by WhatsApp, or copy the link.', url });
      }
    }

    await execute('UPDATE technical_inspections SET shared_at = NOW(), shared_via = ? WHERE id = ?', [channel, row.id]);
    await logAudit({ workshopId: req.workshopId, userId: req.user?.id, action: 'SHARE', entityType: 'technical_inspections', entityId: row.id,
      newValue: { channel } });

    const out = { success: true, url, emailed: channel === 'email' };
    if (channel === 'whatsapp') {
      // No number on file: wa.me without one lets the advisor pick the chat.
      const phone = waDigits(row.to_phone);
      const text = `The technical inspection report of ${vehicle} (work order ${row.work_order_number}) is ready: `
        + `the work it needs, with the parts. The prices come with the estimate. Your copy: ${url}`;
      out.whatsapp_url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      if (!phone) out.message = 'No phone number on file — choose the chat in WhatsApp.';
    } else if (channel === 'email') {
      out.message = `Sent to ${row.to_email}`;
    }
    out.share = shareState(await loadForShare(row.id, req.workshopId), req.user);
    res.json(out);
  } catch (err) {
    console.error('POST /technical-inspections/:id/share error:', err);
    res.status(500).json({ success: false, message: 'Failed to send the technical report' });
  }
});

// POST /api/technical-inspections/:id/share/reset — a new link, for when the
// old one went to the wrong chat. The old link stops working at once; the
// next send makes the new one.
router.post('/:id/share/reset', async (req, res) => {
  try {
    const row = await loadForShare(req.params.id, req.workshopId);
    if (!row) return res.status(404).json({ success: false, message: 'Technical inspection not found' });
    if (!canSend(req.user)) return res.status(403).json(NOT_ALLOWED);
    await execute('UPDATE technical_inspections SET share_token = NULL, shared_at = NULL, shared_via = NULL WHERE id = ? AND workshop_id = ?',
      [row.id, req.workshopId]);
    await logAudit({ workshopId: req.workshopId, userId: req.user?.id, action: 'RESET_LINK', entityType: 'technical_inspections', entityId: row.id,
      oldValue: { shared_via: row.shared_via, shared_at: row.shared_at } });
    res.json({ success: true, share: shareState(await loadForShare(row.id, req.workshopId), req.user) });
  } catch (err) {
    console.error('POST /technical-inspections/:id/share/reset error:', err);
    res.status(500).json({ success: false, message: 'Failed to reset the link' });
  }
});

export default router;
