/**
 * Customer Portal — the workshop customer's own jobs, inspections, estimates,
 * invoices and vehicles.
 *
 * Every endpoint is scoped to the signed-in customer: authMiddleware (a
 * role 'customer' token, lib/access.js) and then req.customer from
 * customers.user_id. Nothing here takes a customer id from the request.
 *
 * Sections:
 *   ── Home                — "Action needed" (sign the inspection, approve the
 *                            estimate, ready for collection) and open jobs
 *   ── Job cards           — status in the customer's stages (lib/customer-status.js),
 *                            one job's detail, the job sheet PDF
 *   ── Inspections         — the customer's copy of the walk-around (with its
 *                            photos), and the sign-off from inside the portal
 *                            (once only; it opens the job card, as the link's)
 *   ── Invoices & payments — invoices with paid / balance, PDF
 *   ── My vehicles
 *   ── Profile
 *   ── Retired             — the delivery product's create-order, addresses,
 *                            wallet / COD and cash summary (410)
 */

import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { getFinancialConfig } from '../lib/financial.js';
import { generateInvoicePDF } from './invoices.js';
import { createInAppNotification } from '../lib/notify.js';
import { notifyGroups } from '../lib/workflow.js';
import { woLabel } from '../lib/status-labels.js';
import { customerView } from '../lib/customer-status.js';
import { saveBase64Signature } from './uploads.js';
import { readDocs, sendDocument, signatureError, cleanName } from './vehicle-inspections.js';
import { publicView as inspectionView, photosOf, openPhysicalJobCard } from './public-inspections.js';
import { preferBearerToken } from '../lib/portal-access.js';

const router = express.Router();
router.use(preferBearerToken, authMiddleware);

/* ──────────────────────────────────────────────────────────────
 * Helper — resolve the customer record for the authenticated user
 * ────────────────────────────────────────────────────────────── */
async function getCustomerForUser(userId, workshopId) {
  const [customer] = await query(
    'SELECT * FROM customers WHERE user_id = ? AND workshop_id = ?',
    [userId, workshopId]
  );
  return customer || null;
}

/* ──────────────────────────────────────────────────────────────
 * Middleware — inject req.customer on every request
 * A staff login is never a customer, whatever a customers row says.
 * ────────────────────────────────────────────────────────────── */
router.use(async (req, res, next) => {
  try {
    if (req.user?.role !== 'customer') {
      return res.status(403).json({ success: false, message: 'This is the customer portal. Sign in with a customer account.' });
    }
    const customer = await getCustomerForUser(req.user.id, req.workshopId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer profile not found' });
    }
    if (!customer.is_active) {
      return res.status(403).json({ success: false, message: 'Your account is deactivated. Contact the workshop.' });
    }
    req.customer = customer;
    next();
  } catch (err) {
    console.error('[CustomerPortal] Customer lookup error:', err);
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
});

/** The customer's own work order (the visit / job card), or null. */
async function ownWorkOrder(req, id) {
  const [wo] = await query(
    'SELECT id, work_order_number, status, service_status_token, vehicle_id FROM work_orders WHERE id = ? AND customer_id = ? AND workshop_id = ?',
    [id, req.customer.id, req.workshopId]
  );
  return wo || null;
}

const money = n => Math.round((Number(n) || 0) * 100) / 100;
const OPEN_LIMIT = 20;

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  INSPECTIONS — the customer's copy, and their sign-off  ════════════════
 * Same shape as the public inspection link (public-inspections.js publicView),
 * reached through the customer's own login instead of the link's token.
 * ══════════════════════════════════════════════════════════════════════════════ */

// The walk-arounds done with the customer; 'qc' is the workshop's own check.
const CUSTOMER_FACING = ['intake', 'joint'];

const INSPECTION_SELECT = `
  SELECT vi.*, wo.work_order_number, wo.status AS wo_status,
         w.name AS workshop_name, w.phone AS workshop_phone, w.logo_url AS workshop_logo, w.settings AS workshop_settings
    FROM vehicle_inspections vi
    JOIN work_orders wo ON wo.id = vi.work_order_id AND wo.workshop_id = vi.workshop_id
    JOIN workshops w ON w.id = vi.workshop_id`;

/** Completed customer-facing inspections of this customer's jobs (cancelled jobs' are closed, as on the link). */
async function ownInspections(req, { id = null, workOrderId = null } = {}) {
  const params = [req.customer.id, req.workshopId];
  let where = `WHERE wo.customer_id = ? AND vi.workshop_id = ? AND vi.status = 'completed'
                 AND vi.inspection_type IN ('intake','joint') AND wo.status <> 'cancelled'`;
  if (id) { where += ' AND vi.id = ?'; params.push(id); }
  if (workOrderId) { where += ' AND vi.work_order_id = ?'; params.push(workOrderId); }
  return query(`${INSPECTION_SELECT} ${where} ORDER BY vi.completed_at DESC, vi.id DESC LIMIT 50`, params);
}

/** The portal's view of one inspection: the link's view plus what the portal links by. */
function portalInspection(row) {
  const { workshop, inspection } = inspectionView(row);
  return {
    id: row.id,
    work_order_id: row.work_order_id,
    workshop,
    ...inspection,
    // To sign in the portal: drawn on screen, completed, not yet signed, job not closed.
    needs_signature: inspection.can_sign,
  };
}

/* ── GET /inspections — the customer's inspections (?work_order_id=) ── */
router.get('/inspections', async (req, res) => {
  try {
    const rows = await ownInspections(req, { workOrderId: req.query.work_order_id || null });
    return res.json({ success: true, data: rows.map(portalInspection) });
  } catch (err) {
    console.error('[CustomerPortal] Inspections error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load inspections' });
  }
});

/* ── GET /inspections/:id — one inspection ── */
router.get('/inspections/:id', async (req, res) => {
  try {
    const [row] = await ownInspections(req, { id: req.params.id });
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    return res.json({ success: true, data: portalInspection(row) });
  } catch (err) {
    console.error('[CustomerPortal] Inspection error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load the inspection' });
  }
});

/* ── GET /inspections/:id/documents/:docId — a page of the paper form ── */
router.get('/inspections/:id/documents/:docId', async (req, res) => {
  try {
    const [row] = await ownInspections(req, { id: req.params.id });
    const docs = row && row.entry_mode === 'document' ? readDocs(row) : [];
    return sendDocument(res, docs.find(d => d.id === req.params.docId));
  } catch (err) {
    console.error('[CustomerPortal] Inspection document error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load the document' });
  }
});

/* ── GET /inspections/:id/photos/:photoId — a vehicle photo ── */
router.get('/inspections/:id/photos/:photoId', async (req, res) => {
  try {
    const [row] = await ownInspections(req, { id: req.params.id });
    return sendDocument(res, row ? photosOf(row).find(p => p.id === req.params.photoId) : null);
  } catch (err) {
    console.error('[CustomerPortal] Inspection photo error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load the photo' });
  }
});

/**
 * POST /inspections/:id/sign — the customer signs the inspection in the portal.
 * Body: { signature: "data:image/png;base64,...", name: "Full name", confirmed: true }
 *
 * Their own job only (inspection → work order → this customer). Once only,
 * with the same one-time conditional update as the link
 * (public-inspections.js): whoever signs first — at the car, from the link
 * or here — wins, and a signed inspection is never re-signed. Recorded with
 * signed_via 'portal': signed by the customer under their own login, so a
 * staff "new link" (share/reset), which clears 'link' signatures, keeps it.
 * Signing the drop-off (physical) inspection acknowledges the vehicle's
 * condition and opens an external customer's job card (lib/physical-inspection.js).
 */
router.post('/inspections/:id/sign', async (req, res) => {
  try {
    const [row] = await query(
      `${INSPECTION_SELECT} WHERE vi.id = ? AND vi.workshop_id = ? AND wo.customer_id = ?`,
      [req.params.id, req.workshopId, req.customer.id]
    );
    if (!row || !CUSTOMER_FACING.includes(row.inspection_type)) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }
    if (row.wo_status === 'cancelled') {
      return res.status(410).json({ success: false, code: 'CANCELLED', message: 'This job was cancelled, so the inspection can no longer be signed. Please contact the workshop.' });
    }
    const signature = inspectionView(row).inspection.signature;
    if (row.signature_url) {
      return res.status(409).json({ success: false, code: 'ALREADY_SIGNED', message: 'This inspection has already been signed.', signature });
    }
    if (row.entry_mode === 'document') {
      return res.status(409).json({ success: false, code: 'PAPER_FORM', message: 'This inspection was signed on the paper form at the workshop.' });
    }
    if (row.status !== 'completed') {
      return res.status(409).json({ success: false, code: 'NOT_COMPLETED', message: 'The inspection is still being done. You can sign it once the workshop has finished it.' });
    }
    if (row.wo_status === 'completed') {
      return res.status(409).json({ success: false, code: 'JOB_CLOSED', message: 'This job is closed, so the inspection can no longer be signed here. Please contact the workshop.' });
    }

    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ success: false, code: 'NAME_REQUIRED', message: 'Please type your name.' });
    if (name.length > 150) return res.status(400).json({ success: false, message: 'Your name can be up to 150 characters.' });
    if (req.body?.confirmed !== true) {
      return res.status(400).json({ success: false, code: 'CONFIRM_REQUIRED', message: 'Please confirm that this is the condition of your vehicle.' });
    }
    const bad = signatureError(req.body?.signature);
    if (bad) return res.status(400).json({ success: false, message: bad });

    const url = await saveBase64Signature(req.body.signature, `insp${row.id}`);
    // Staff may be capturing it at the car at the same moment — first one wins.
    const result = await execute(
      `UPDATE vehicle_inspections
          SET signature_url = ?, signed_at = NOW(), signed_via = 'portal', signed_by_name = ?
        WHERE id = ? AND workshop_id = ? AND signature_url IS NULL AND status = 'completed' AND entry_mode = 'form'`,
      [url, name, row.id, req.workshopId]
    );
    if (!result.affectedRows) {
      return res.status(409).json({ success: false, code: 'ALREADY_SIGNED', message: 'This inspection has already been signed.' });
    }

    const jobCard = await openPhysicalJobCard(row);
    await notifySigned(row, name, jobCard);
    const [signed] = await ownInspections(req, { id: row.id });
    return res.json({ success: true, data: signed ? portalInspection(signed) : null, signature: signed ? portalInspection(signed).signature : null });
  } catch (err) {
    console.error('[CustomerPortal] Inspection sign error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save your signature' });
  }
});

/** As the link's sign-off (public-inspections.js): whoever did the walk-around
 *  and the job's estimate advisor hear it, the Service Advisors as a group
 *  when neither is known. */
async function notifySigned(row, name, jobCard = null) {
  try {
    const handover = row.inspection_type === 'joint';
    const payload = {
      title: `Inspection signed by the customer: ${row.work_order_number}`,
      body: `${name} signed the ${handover ? 'handover' : 'physical'} inspection in the customer portal.`
        + (jobCard?.opened_now ? ` Job card ${jobCard.job_card_number} is open — the technical inspection is next.` : ''),
      link: `/work-orders/${row.work_order_id}/inspection${handover ? '?type=joint' : ''}`,
      orderId: row.work_order_id, type: 'inspection_signed', icon: '✍️',
    };
    const advisors = await query(
      `SELECT DISTINCT advisor_id FROM service_estimates
        WHERE workshop_id = ? AND advisor_id IS NOT NULL AND (work_order_id = ? OR intake_work_order_id = ?)`,
      [row.workshop_id, row.work_order_id, row.work_order_id]
    );
    const recipients = new Set([row.inspected_by, ...advisors.map(a => a.advisor_id)].filter(Boolean));
    if (!recipients.size) { await notifyGroups(row.workshop_id, ['service_advisor'], payload); return; }
    for (const userId of recipients) {
      await createInAppNotification({ workshopId: row.workshop_id, userId, ...payload });
    }
  } catch (err) {
    console.error('[CustomerPortal] signed notification failed:', err.message);
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  ESTIMATES — sent to the customer and waiting for their decision  ══════
 * The decision itself is made on the existing approval page
 * (/estimate-approval/:token, routes/estimates.js publicEstimateRouter): the
 * customer is signed in and the estimate is theirs, so the portal hands them
 * its link.
 * ══════════════════════════════════════════════════════════════════════════════ */

/** Estimates of this customer (by customer, or raised on one of their jobs). */
async function ownEstimates(req, { workOrderId = null, awaitingOnly = false } = {}) {
  const params = [req.workshopId, req.customer.id, req.customer.id];
  let where = `WHERE se.workshop_id = ? AND se.sent_to_customer_at IS NOT NULL
                 AND (se.customer_id = ? OR wo.customer_id = ?)`;
  if (workOrderId) { where += ' AND (se.intake_work_order_id = ? OR se.work_order_id = ?)'; params.push(workOrderId, workOrderId); }
  const rows = await query(
    `SELECT se.id, se.estimate_number, se.status, se.total_amount, se.sent_to_customer_at, se.customer_approved_at,
            se.valid_until, se.vehicle_plate, se.intake_work_order_id, se.work_order_id,
            se.approval_token, se.approval_token_expires_at,
            wo.work_order_number, wo.status AS wo_status,
            (SELECT COUNT(*) FROM estimate_lines l
              WHERE l.estimate_id = se.id AND l.line_type <> 'discount' AND l.customer_status = 'pending') AS pending_lines
       FROM service_estimates se
       LEFT JOIN work_orders wo ON wo.id = COALESCE(se.intake_work_order_id, se.work_order_id) AND wo.workshop_id = se.workshop_id
       ${where}
      ORDER BY se.sent_to_customer_at DESC, se.id DESC
      LIMIT 50`,
    params
  );
  const out = rows.map(e => {
    const linkLive = !!e.approval_token && (!e.approval_token_expires_at || new Date(e.approval_token_expires_at) > new Date());
    // Decisions close once the estimate became work (work_order_id set) or expired.
    const awaiting = linkLive && ['sent_to_customer', 'partially_approved'].includes(e.status) && !e.work_order_id
      && Number(e.pending_lines) > 0 && e.wo_status !== 'cancelled';
    return {
      id: e.id,
      estimate_number: e.estimate_number,
      status: e.status,
      total: money(e.total_amount),
      sent_at: e.sent_to_customer_at,
      decided_at: e.customer_approved_at,
      valid_until: e.valid_until,
      work_order_id: e.intake_work_order_id || e.work_order_id || null,
      work_order_number: e.work_order_number || null,
      vehicle_plate: e.vehicle_plate || null,
      awaiting_decision: awaiting,
      pending_lines: Number(e.pending_lines) || 0,
      approval_path: linkLive ? `/estimate-approval/${e.approval_token}` : null,
    };
  });
  return awaitingOnly ? out.filter(e => e.awaiting_decision) : out;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  INVOICES & PAYMENTS  ══════════════════════════════════════════════════
 * Draft invoices are the workshop's work in progress; void and cancelled ones
 * are not owed. Neither is shown.
 * A job's invoice is raised (status 'sent') when the Team Leader assigns the
 * work, so the staff payment and gate-pass steps have it ready; the customer
 * sees it once the car is ready for collection (or closed), or once they
 * have paid something towards it — not while the repair is still going on.
 * Self-contained, so ownInvoices and the PDF route share it.
 * ══════════════════════════════════════════════════════════════════════════════ */

const INVOICE_VISIBLE = "i.status NOT IN ('draft','void','cancelled') AND (i.work_order_id IS NULL OR i.amount_paid > 0 OR EXISTS ("
  + "SELECT 1 FROM work_orders w2 WHERE w2.id = i.work_order_id AND w2.status IN ('ready_for_pickup','completed')))";

async function ownInvoices(req, { workOrderId = null } = {}) {
  const params = [req.customer.id, req.workshopId];
  let where = `WHERE i.customer_id = ? AND i.workshop_id = ? AND ${INVOICE_VISIBLE}`;
  if (workOrderId) { where += ' AND i.work_order_id = ?'; params.push(workOrderId); }
  const rows = await query(
    `SELECT i.id, i.invoice_number, i.work_order_id, i.subtotal, i.tax_amount, i.total_amount, i.amount_paid,
            i.status, i.due_date, i.paid_at, i.created_at, i.currency,
            wo.work_order_number, v.plate_number, v.make, v.model
       FROM invoices i
       LEFT JOIN work_orders wo ON wo.id = i.work_order_id
       LEFT JOIN vehicles v ON v.id = wo.vehicle_id
       ${where}
      ORDER BY i.created_at DESC, i.id DESC`,
    params
  );
  return rows.map(i => ({
    id: i.id,
    invoice_number: i.invoice_number,
    work_order_id: i.work_order_id,
    work_order_number: i.work_order_number || null,
    vehicle: { plate: i.plate_number || null, make: i.make || null, model: i.model || null },
    subtotal: money(i.subtotal),
    tax_amount: money(i.tax_amount),
    total_amount: money(i.total_amount),
    amount_paid: money(i.amount_paid),
    balance: Math.max(0, money(Number(i.total_amount) - Number(i.amount_paid))),
    status: i.status,
    due_date: i.due_date,
    paid_at: i.paid_at,
    created_at: i.created_at,
    currency: i.currency || null,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  HOME — action needed first  ═══════════════════════════════════════════
 * ══════════════════════════════════════════════════════════════════════════════ */

async function openJobViews(req) {
  const open = await query(
    `SELECT id FROM work_orders
      WHERE customer_id = ? AND workshop_id = ? AND status NOT IN ('completed','cancelled')
      ORDER BY created_at DESC LIMIT ${OPEN_LIMIT}`,
    [req.customer.id, req.workshopId]
  );
  return (await Promise.all(open.map(o => customerView(o.id, req.workshopId)))).filter(Boolean);
}

/**
 * GET /home — what needs the customer, then their open jobs.
 *   actions.sign     — inspections to sign (in the portal)
 *   actions.approve  — estimates waiting for their decision (the approval page)
 *   actions.ready    — cars ready for collection, with the amount due
 */
router.get('/home', async (req, res) => {
  try {
    const [jobs, inspections, estimates] = await Promise.all([
      openJobViews(req),
      ownInspections(req),
      ownEstimates(req, { awaitingOnly: true }),
    ]);
    const toSign = inspections.map(portalInspection).filter(i => i.needs_signature).map(i => ({
      id: i.id, work_order_id: i.work_order_id, work_order_number: i.work_order_number,
      type: i.type, completed_at: i.completed_at, vehicle: i.vehicle,
    }));
    const ready = jobs.filter(j => j.stage.key === 'ready').map(j => ({
      work_order_id: j.work_order_id, vehicle: j.vehicle, job: j.job, invoice: j.invoice, since: j.stage.since,
    }));
    return res.json({
      success: true,
      data: {
        customer: { name: req.customer.full_name || req.customer.company_name || null },
        actions: { sign: toSign, approve: estimates, ready },
        jobs,
      },
    });
  } catch (err) {
    console.error('[CustomerPortal] Home error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load your portal' });
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  JOB CARDS  ════════════════════════════════════════════════════════════
 * ══════════════════════════════════════════════════════════════════════════════ */

/**
 * GET /service-status?days=30 — the customer's jobs in their stages:
 *   data   — open jobs, the full status (lib/customer-status.js)
 *   closed — jobs closed in the last `days` (1–90), a short line each
 */
router.get('/service-status', async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
    const [open, closedRows] = await Promise.all([
      openJobViews(req),
      query(
        `SELECT wo.id, wo.work_order_number, wo.status, wo.completed_at, wo.cancelled_at, wo.updated_at, wo.created_at,
                v.plate_number, v.make, v.model,
                (SELECT se.status FROM service_estimates se
                  WHERE se.workshop_id = wo.workshop_id AND (se.intake_work_order_id = wo.id OR se.work_order_id = wo.id)
                  ORDER BY se.id DESC LIMIT 1) AS estimate_status,
                (SELECT jc.job_card_number FROM job_cards jc
                  WHERE jc.work_order_id = wo.id AND jc.parent_job_card_id IS NULL ORDER BY jc.id LIMIT 1) AS job_card_number
           FROM work_orders wo
           LEFT JOIN vehicles v ON v.id = wo.vehicle_id
          WHERE wo.customer_id = ? AND wo.workshop_id = ? AND wo.status IN ('completed','cancelled')
            AND COALESCE(wo.completed_at, wo.cancelled_at, wo.updated_at) >= DATE_SUB(NOW(), INTERVAL ? DAY)
          ORDER BY COALESCE(wo.completed_at, wo.cancelled_at, wo.updated_at) DESC
          LIMIT 20`,
        [req.customer.id, req.workshopId, days]
      ),
    ]);
    const invoices = closedRows.length ? await ownInvoices(req) : [];
    const closed = closedRows.map(r => {
      const inv = invoices.find(i => i.work_order_id === r.id);
      const special = r.status === 'cancelled' ? (r.estimate_status === 'rejected' ? 'declined' : 'cancelled') : null;
      return {
        work_order_id: r.id,
        vehicle: { plate: r.plate_number || null, make: r.make || null, model: r.model || null },
        job: { work_order_number: r.work_order_number, job_card_number: r.job_card_number || null, opened_at: r.created_at },
        stage: { key: special || 'collected', since: r.completed_at || r.cancelled_at || r.updated_at },
        special,
        invoice: inv ? { number: inv.invoice_number, total: inv.total_amount, paid: inv.amount_paid, balance: inv.balance, status: inv.status } : null,
      };
    });
    return res.json({ success: true, data: open, closed, days });
  } catch (err) {
    console.error('[CustomerPortal] Service status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load your job cards' });
  }
});

/* ── GET /work-orders — this customer's job cards, newest first (no prices, no staff) ── */
router.get('/work-orders', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const pg = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pg - 1) * lim;

    let where = 'WHERE o.workshop_id = ? AND o.customer_id = ?';
    const params = [req.workshopId, req.customer.id];
    if (status) { where += ' AND o.status = ?'; params.push(status); }

    const [{ total }] = await query(`SELECT COUNT(*) as total FROM work_orders o ${where}`, params);
    const rows = await query(
      `SELECT o.id, o.work_order_number, o.status, o.customer_approved_at, o.created_at, o.completed_at,
              v.make as vehicle_make, v.model as vehicle_model, v.plate_number as vehicle_plate
       FROM work_orders o
       LEFT JOIN vehicles v ON o.vehicle_id = v.id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );
    return res.json({
      success: true,
      data: rows.map(r => ({ ...r, status_label: woLabel(r, 'customer') })),
      pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
    });
  } catch (err) {
    console.error('[CustomerPortal] List work orders error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch your job cards' });
  }
});

/**
 * GET /work-orders/:id — one job card for the customer: where it stands
 * (stages), its inspections (view + sign), the estimates sent, invoices.
 * Whitelisted like the public status page: no staff, notes or costs.
 */
router.get('/work-orders/:id', async (req, res) => {
  try {
    const wo = await ownWorkOrder(req, req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Job card not found' });
    const [status, inspections, estimates, invoices] = await Promise.all([
      customerView(wo.id, req.workshopId),
      ownInspections(req, { workOrderId: wo.id }),
      ownEstimates(req, { workOrderId: wo.id }),
      ownInvoices(req, { workOrderId: wo.id }),
    ]);
    return res.json({
      success: true,
      data: { work_order_id: wo.id, status, inspections: inspections.map(portalInspection), estimates, invoices },
    });
  } catch (err) {
    console.error('[CustomerPortal] Work order detail error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch the job card' });
  }
});

/* ── GET /work-orders/:id/invoice — the job sheet PDF (the printed job card) ── */
router.get('/work-orders/:id/invoice', async (req, res) => {
  try {
    const [order] = await query(
      `SELECT o.*, b.name as service_bay_name, c.company_name, c.full_name as customer_full_name
       FROM work_orders o
       LEFT JOIN service_bays b ON o.service_bay_id = b.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = ? AND o.customer_id = ? AND o.workshop_id = ?`,
      [req.params.id, req.customer.id, req.workshopId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'Work order not found' });

    // Count items
    const [itemCount] = await query('SELECT COUNT(*) as cnt FROM work_order_items WHERE work_order_id = ?', [order.id]);
    order.item_count = itemCount?.cnt || 0;

    // Get workshop info
    const [workshop] = await query('SELECT * FROM workshops WHERE id = ?', [req.workshopId]);

    // Get job-sheet/invoice template from settings
    let template = null;
    try {
      const [row] = await query("SELECT `value` FROM settings WHERE workshop_id = ? AND `key` = 'label_template'", [req.workshopId]);
      if (row?.value) template = JSON.parse(row.value);
    } catch (_) {}

    // Dynamically import the job-sheet generator
    const { generateServiceJobSheetPDF } = await import('../lib/service-job-sheet.js');
    await generateServiceJobSheetPDF(res, { orders: [order], tenant: workshop, template });
  } catch (err) {
    console.error('[CustomerPortal] Invoice/job-sheet error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate document' });
  }
});

/* ── GET /estimates — estimates sent to the customer (?awaiting=1 for those waiting on them) ── */
router.get('/estimates', async (req, res) => {
  try {
    const awaitingOnly = req.query.awaiting === '1' || req.query.awaiting === 'true';
    return res.json({ success: true, data: await ownEstimates(req, { awaitingOnly }) });
  } catch (err) {
    console.error('[CustomerPortal] Estimates error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load estimates' });
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  STATS  ════════════════════════════════════════════════════════════════
 * ══════════════════════════════════════════════════════════════════════════════ */

router.get('/stats', async (req, res) => {
  try {
    const [counts] = await query(
      `SELECT COUNT(*) AS total_work_orders,
              COALESCE(SUM(status NOT IN ('completed','cancelled')), 0) AS open_jobs,
              COALESCE(SUM(status = 'ready_for_pickup'), 0)            AS ready_for_collection,
              COALESCE(SUM(status = 'completed'), 0)                   AS completed,
              COALESCE(SUM(status = 'cancelled'), 0)                   AS cancelled
         FROM work_orders WHERE customer_id = ? AND workshop_id = ?`,
      [req.customer.id, req.workshopId]
    );
    const invoices = await ownInvoices(req);
    return res.json({
      success: true,
      data: {
        ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v) || 0])),
        balance_due: money(invoices.reduce((s, i) => s + i.balance, 0)),
      },
    });
  } catch (err) {
    console.error('[CustomerPortal] Stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  INVOICES & PAYMENTS  ══════════════════════════════════════════════════
 * ══════════════════════════════════════════════════════════════════════════════ */

/* ── GET /invoices — customer's invoices, with paid and balance ── */
router.get('/invoices', async (req, res) => {
  try {
    const invoices = await ownInvoices(req);
    const totals = invoices.reduce((t, i) => ({
      billed: t.billed + i.total_amount, paid: t.paid + i.amount_paid, balance: t.balance + i.balance,
    }), { billed: 0, paid: 0, balance: 0 });
    return res.json({ success: true, data: invoices, totals: { billed: money(totals.billed), paid: money(totals.paid), balance: money(totals.balance) } });
  } catch (err) {
    console.error('[CustomerPortal] Invoices error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch invoices' });
  }
});

/* ── GET /invoices/:id/pdf — download invoice PDF ─────────────── */
router.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const [invoice] = await query(
      `SELECT * FROM invoices i WHERE i.id = ? AND i.customer_id = ? AND i.workshop_id = ? AND ${INVOICE_VISIBLE}`,
      [req.params.id, req.customer.id, req.workshopId]
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // Generate directly (this router is customer-authenticated, not staff-authenticated,
    // so we can't redirect into the staff-only /api/invoices/:id/pdf route).
    const [workshop] = await query('SELECT name, email, phone, address, city, country, logo_url FROM workshops WHERE id = ?', [req.workshopId]);
    const customer = req.customer;
    const items = await query('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoice.id]);
    const [order] = invoice.work_order_id
      ? await query('SELECT work_order_number, customer_name, customer_phone, dropoff_address, payment_method FROM work_orders WHERE id = ?', [invoice.work_order_id])
      : [null];

    let vatNumber = '';
    try { const finCfg = await getFinancialConfig(req.workshopId); vatNumber = finCfg.vatNumber || ''; } catch {}

    await generateInvoicePDF(res, { invoice, workshop, customer, items, order, vatNumber, workshopId: req.workshopId });
  } catch (err) {
    console.error('[CustomerPortal] Invoice PDF error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to get invoice PDF' });
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  MY VEHICLES  ══════════════════════════════════════════════════════════
 * The customer's own vehicles (the `vehicles` table routes/vehicles.js also
 * manages), with their last visit and the job open on them, if any. Staff
 * notes on the vehicle are not shown.
 * ══════════════════════════════════════════════════════════════════════════════ */

/* ── GET /vehicles — list this customer's vehicles ────────────── */
router.get('/vehicles', async (req, res) => {
  try {
    const vehicles = await query(
      `SELECT v.id, v.make, v.model, v.year, v.plate_number, v.plate_code, v.plate_emirate, v.vin, v.color,
              v.mileage, v.fuel_type, v.transmission, v.created_at,
              (SELECT MAX(o.completed_at) FROM work_orders o
                WHERE o.vehicle_id = v.id AND o.customer_id = v.customer_id AND o.status = 'completed') AS last_visit_at,
              (SELECT COUNT(*) FROM work_orders o
                WHERE o.vehicle_id = v.id AND o.customer_id = v.customer_id AND o.status = 'completed') AS visits,
              (SELECT o.id FROM work_orders o
                WHERE o.vehicle_id = v.id AND o.customer_id = v.customer_id AND o.status NOT IN ('completed','cancelled')
                ORDER BY o.created_at DESC LIMIT 1) AS open_work_order_id
         FROM vehicles v
        WHERE v.customer_id = ? AND v.workshop_id = ? AND v.is_active = TRUE
        ORDER BY v.created_at DESC`,
      [req.customer.id, req.workshopId]
    );
    return res.json({ success: true, data: vehicles });
  } catch (err) {
    console.error('[CustomerPortal] List vehicles error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch vehicles' });
  }
});

/* ── POST /vehicles — add a vehicle ───────────────────────────── */
router.post('/vehicles', async (req, res) => {
  try {
    const { make, model, year, plate_number, vin, color, mileage, fuel_type = 'petrol', transmission = 'automatic' } = req.body;
    if (!make || !model) {
      return res.status(400).json({ success: false, message: 'Make and model are required' });
    }

    const result = await execute(
      `INSERT INTO vehicles (workshop_id, customer_id, make, model, year, plate_number, vin, color, mileage, fuel_type, transmission)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.workshopId, req.customer.id, make, model, parseInt(year) || null, plate_number || null, vin || null,
       color || null, parseInt(mileage) || null, fuel_type, transmission]
    );

    const [vehicle] = await query(
      `SELECT id, make, model, year, plate_number, plate_code, plate_emirate, vin, color, mileage, fuel_type, transmission, created_at
         FROM vehicles WHERE id = ?`, [result.insertId]);
    return res.status(201).json({ success: true, data: vehicle });
  } catch (err) {
    console.error('[CustomerPortal] Add vehicle error:', err);
    return res.status(500).json({ success: false, message: 'Failed to add vehicle' });
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  PROFILE & SETTINGS  ═══════════════════════════════════════════════════
 * ══════════════════════════════════════════════════════════════════════════════ */

// What the customer sees of their own record: never the password hash, the
// live reset / verification tokens, or the workshop's notes and credit terms.
const PROFILE_FIELDS = ['id', 'full_name', 'company_name', 'email', 'phone', 'phone_alt',
  'address_line1', 'address_line2', 'area', 'city', 'emirate', 'type', 'is_verified', 'created_at'];
const profileOf = c => Object.fromEntries(PROFILE_FIELDS.map(k => [k, c?.[k] ?? null]));

/* ── GET /profile — customer profile ─────────────────────────── */
router.get('/profile', async (req, res) => {
  try {
    return res.json({ success: true, data: profileOf(req.customer) });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
});

/* ── PUT /profile — update customer profile ──────────────────── */
router.put('/profile', async (req, res) => {
  try {
    const {
      full_name, company_name, phone_alt,
      address_line1, address_line2, city, emirate,
    } = req.body;

    await execute(
      `UPDATE customers SET
        full_name = COALESCE(?, full_name),
        company_name = COALESCE(?, company_name),
        phone_alt = ?,
        address_line1 = COALESCE(?, address_line1),
        address_line2 = ?,
        city = COALESCE(?, city),
        emirate = COALESCE(?, emirate)
       WHERE id = ? AND workshop_id = ?`,
      [full_name || null, company_name || null, phone_alt || null,
       address_line1 || null, address_line2 || null,
       city || null, emirate || null, req.customer.id, req.workshopId]
    );

    const [updated] = await query('SELECT * FROM customers WHERE id = ?', [req.customer.id]);
    return res.json({ success: true, data: profileOf(updated) });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ═══  RETIRED — the delivery product's merchant screens  ═════════════════════
 * Creating, editing and cancelling orders, the saved-addresses book, the
 * wallet / COD balance and the cash summary belonged to the courier product.
 * A workshop job is opened at the counter (Steps 1–3) and cancelled by staff,
 * so nothing calls these any more. The table customer_saved_addresses stays.
 * Also gone: GET /work-orders/:id/service-status and GET /service-status/:query
 * (replaced by GET /work-orders/:id and GET /service-status), and the parts
 * list with its costs (GET /work-orders/:id/parts).
 * ══════════════════════════════════════════════════════════════════════════════ */

const retired = message => (_req, res) => res.status(410).json({ success: false, code: 'MOVED', message });
const BOOK_WITH_US = 'Jobs are opened by the workshop. Call or WhatsApp us to book your car in.';

router.post('/work-orders', retired(BOOK_WITH_US));
router.put('/work-orders/:id', retired(BOOK_WITH_US));
router.delete('/work-orders/:id', retired('To cancel a job, please call or WhatsApp the workshop.'));
router.get('/work-orders/:id/parts', retired('See the job card for what was done.'));
router.get('/work-orders/:id/service-status', retired('Use GET /api/customer-portal/work-orders/:id.'));
router.get('/wallet', retired('See Invoices & payments.'));
router.get('/cash-summary', retired('See Invoices & payments.'));
router.all(['/saved-addresses', '/saved-addresses/:id'], retired('Addresses are no longer kept in the portal.'));

export default router;
