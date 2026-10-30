/**
 * /api/workflow — the workshop workflow, Steps 1–7
 * (Pioneer_Complete_Workshop_Workflow_Steps_1_to_7.pdf), staff side.
 * Technicians use /api/job-cards (time booking, job done, requisitions).
 *
 *   GET   /work-orders/:id                 where the job stands in Steps 1–7
 *   POST  /work-orders/:id/job-card        open the main job card (Step 3; a manager's override)
 *   POST  /work-orders/:id/sub-job-cards   sub-job card for part of the approved work (Step 6)
 *   PATCH /job-cards/:id/technician        assign a sub-job card's technician (Step 6)
 *   GET   /store/queue                     what the Store has to act on
 *   PATCH /requisition-items/:id           Store: on the shelf → issue; not → expected arrival date (Step 6)
 *   POST  /work-orders/:id/contacts        collection call log (Step 7.2)
 *   POST  /work-orders/:id/gate-pass       final gate pass (Step 7.2)
 *   POST  /work-orders/:id/close           close the job (Step 7.2)
 */
import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import {
  buildWorkflow, getMainJobCard, notifyGroups, notifyMechanic,
  paymentSettled, JC_QC_PASSED, FLOOR, genJobCardNumber, UNPRICED_PART_SQL,
} from '../lib/workflow.js';
import { syncWorkOrderFromJobCards } from '../lib/workflow-sync.js';
import { can, requireCapability, capabilitiesOf, isManagerRole } from '../lib/roles.js';
import { ASSIGN_WHERE, ASSIGN_SUB_WHERE, QC_WHERE, REWORK_WHERE } from '../lib/floor-queues.js';
import { jobCardGate, openJobCardIfReady, PHYSICAL_INSPECTION_REQUIRED } from '../lib/physical-inspection.js';

const anyCapability = caps => (req, res, next) => caps.some(c => can(req.user, c)) ? next()
  : res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: "Your role can't do this." });
import { applyStatusChange } from './work-orders.js';
import { createInvoiceFromWorkOrder } from './invoices.js';

const router = express.Router();
router.use(authMiddleware);

const DEPARTMENTS = ['mechanical', 'body_paint', 'electrical', 'tyres', 'other'];
const isoDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

async function loadWorkOrder(id, workshopId) {
  const [wo] = await query(
    `SELECT wo.*, c.customer_class FROM work_orders wo LEFT JOIN customers c ON c.id = wo.customer_id
      WHERE wo.id = ? AND wo.workshop_id = ?`, [id, workshopId]);
  return wo || null;
}

// GET /api/workflow/my-tasks — what is waiting on the logged-in person's
// role, step by step (the queues behind each capability). Each group: up to
// 8 items plus the total.
router.get('/my-tasks', async (req, res) => {
  try {
    const W = req.workshopId;
    const groups = [];
    const add = async (capability, kind, title, countSql, listSql, params, map) => {
      if (!can(req.user, capability)) return;
      const [{ n }] = await query(countSql, params);
      if (!Number(n)) return;
      const rows = await query(listSql + ' LIMIT 8', params);
      groups.push({ capability, kind, title, total: Number(n), items: rows.map(map) });
    };
    const woItem = r => ({ id: r.id, title: r.work_order_number, subtitle: [r.plate_number, r.customer_name].filter(Boolean).join(' · '), link: `/work-orders/${r.id}`, at: r.at });
    const WO_BASE = `FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id
                     WHERE wo.workshop_id = ? AND wo.status NOT IN ('completed','cancelled')
                       AND EXISTS (SELECT 1 FROM job_cards jc WHERE jc.work_order_id = wo.id AND jc.status <> 'cancelled')`;
    const WO_COLS = 'SELECT wo.id, wo.work_order_number, wo.customer_name, v.plate_number, wo.updated_at AS at ';

    // Storekeeper. A part line still to price in the customer's categories
    // (lib/workflow.js; `l` the line, `e` its estimate).
    const UNPRICED = UNPRICED_PART_SQL;
    await add('estimate.price_parts', 'price_parts', 'Price parts',
      `SELECT COUNT(DISTINCT e.id) n FROM service_estimates e JOIN estimate_lines l ON l.estimate_id = e.id WHERE e.workshop_id = ? AND e.status = 'draft' AND ${UNPRICED}`,
      `SELECT e.id, e.estimate_number, e.customer_name, e.vehicle_plate, e.created_at AS at, COUNT(*) AS n FROM service_estimates e JOIN estimate_lines l ON l.estimate_id = e.id
        WHERE e.workshop_id = ? AND e.status = 'draft' AND ${UNPRICED} GROUP BY e.id ORDER BY e.created_at`,
      [W], r => ({ id: r.id, title: r.estimate_number, subtitle: [r.vehicle_plate, r.customer_name, `${r.n} part line(s)`].filter(Boolean).join(' · '), link: `/estimates?id=${r.id}`, at: r.at }));
    const REQ = `FROM material_requisition_items i JOIN material_requisitions r ON r.id = i.requisition_id JOIN job_cards jc ON jc.id = r.job_card_id
                 JOIN work_orders wo ON wo.id = jc.work_order_id
                 WHERE r.workshop_id = ? AND r.status <> 'cancelled' AND i.status NOT IN ('issued','cancelled','returned') AND wo.status NOT IN ('completed','cancelled')
                   AND (i.availability = 'unchecked' OR (i.availability = 'not_available' AND i.expected_date <= CURDATE()))`;
    await add('store.issue', 'store', 'Check the shelf / issue parts',
      `SELECT COUNT(*) n ${REQ}`,
      `SELECT i.id, i.description, i.quantity_requested, i.availability, i.expected_date, wo.work_order_number, wo.id AS wo_id, r.created_at AS at ${REQ} ORDER BY r.created_at`,
      [W], r => ({ id: r.id, title: `${Number(r.quantity_requested)} × ${r.description}`, subtitle: `${r.work_order_number}${r.availability === 'not_available' ? ' · re-check — expected date reached' : ''}`, link: '/store', at: r.at }));

    // Supervisor / managers: external estimates waiting for sign-off
    const APPROVE = `FROM service_estimates e LEFT JOIN customers c ON c.id = e.customer_id
                     WHERE e.workshop_id = ? AND e.status = 'draft' AND e.internal_approved_at IS NULL
                       AND COALESCE(c.customer_class, 'external') <> 'internal' AND e.customer_type <> 'internal_fleet'
                       AND EXISTS (SELECT 1 FROM estimate_lines l WHERE l.estimate_id = e.id)
                       AND NOT EXISTS (SELECT 1 FROM estimate_lines l WHERE l.estimate_id = e.id AND ${UNPRICED})`;
    await add('estimate.approve', 'approve_estimate', 'Approve estimates (external customers)',
      `SELECT COUNT(*) n ${APPROVE}`,
      `SELECT e.id, e.estimate_number, e.customer_name, e.vehicle_plate, e.total_amount, e.updated_at AS at ${APPROVE} ORDER BY e.updated_at`,
      [W], r => ({ id: r.id, title: r.estimate_number, subtitle: [r.vehicle_plate, r.customer_name].filter(Boolean).join(' · '), link: `/estimates?id=${r.id}`, at: r.at }));

    // Service Advisor
    // Step 3: external jobs whose job card waits for the physical inspection
    // and the customer's acknowledgement (lib/physical-inspection.js). A job
    // with no card opened before the workshop's first job card is the old
    // system's, as on the Vehicle Status Board (lib/job-phase.js isLegacyJob).
    const PHYSICAL = `FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id LEFT JOIN customers c ON c.id = wo.customer_id
                      LEFT JOIN vehicle_inspections vi ON vi.work_order_id = wo.id AND vi.inspection_type = 'intake'
                      WHERE wo.workshop_id = ? AND wo.status NOT IN ('completed','cancelled')
                        AND (CASE WHEN wo.intake_customer_class IS NOT NULL AND wo.intake_customer_subcategory IS NOT NULL THEN wo.intake_customer_class
                                  ELSE COALESCE(c.customer_class, wo.intake_customer_class, 'external') END) <> 'internal'
                        AND NOT EXISTS (SELECT 1 FROM job_cards jc WHERE jc.work_order_id = wo.id)
                        AND wo.created_at >= COALESCE((SELECT MIN(jf.created_at) FROM job_cards jf WHERE jf.workshop_id = wo.workshop_id), wo.created_at)`;
    const physicalState = r => (!r.insp_status ? 'physical inspection not started'
      : r.insp_status !== 'completed' ? 'physical inspection in progress'
      : r.signed_at || r.entry_mode === 'document' ? 'acknowledged — open the job card'
      : r.shared_at ? 'link sent — waiting for the signature' : 'not signed — send the link');
    await add('job.open', 'physical_inspection', 'Physical inspection',
      `SELECT COUNT(*) n ${PHYSICAL}`,
      `SELECT wo.id, wo.work_order_number, wo.customer_name, v.plate_number, wo.created_at AS at, vi.status AS insp_status, vi.signed_at, vi.entry_mode, vi.shared_at
         ${PHYSICAL} ORDER BY wo.created_at`,
      [W], r => ({ id: r.id, title: r.work_order_number, subtitle: [r.plate_number, r.customer_name, physicalState(r)].filter(Boolean).join(' · '),
                   link: `/work-orders/${r.id}/inspection?type=intake`, at: r.at }));
    await add('estimate.raise', 'raise_estimate', 'Raise the estimate',
      `SELECT COUNT(*) n ${WO_BASE} AND wo.customer_approved_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM work_order_items i WHERE i.work_order_id = wo.id)
         AND NOT EXISTS (SELECT 1 FROM service_estimates e WHERE e.intake_work_order_id = wo.id AND e.status NOT IN ('rejected','expired'))`,
      `${WO_COLS} ${WO_BASE} AND wo.customer_approved_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM work_order_items i WHERE i.work_order_id = wo.id)
         AND NOT EXISTS (SELECT 1 FROM service_estimates e WHERE e.intake_work_order_id = wo.id AND e.status NOT IN ('rejected','expired'))
       ORDER BY wo.created_at`, [W], woItem);
    const SEND = `FROM service_estimates e LEFT JOIN customers c ON c.id = e.customer_id
                  WHERE e.workshop_id = ? AND e.status = 'draft'
                    AND (e.internal_approved_at IS NOT NULL OR COALESCE(c.customer_class, 'external') = 'internal' OR e.customer_type = 'internal_fleet')
                    AND EXISTS (SELECT 1 FROM estimate_lines l WHERE l.estimate_id = e.id)
                    AND NOT EXISTS (SELECT 1 FROM estimate_lines l WHERE l.estimate_id = e.id AND ${UNPRICED})`;
    await add('estimate.raise', 'send_estimate', 'Send estimates to the customer',
      `SELECT COUNT(*) n ${SEND}`,
      `SELECT e.id, e.estimate_number, e.customer_name, e.vehicle_plate, e.updated_at AS at ${SEND} ORDER BY e.updated_at`,
      [W], r => ({ id: r.id, title: r.estimate_number, subtitle: [r.vehicle_plate, r.customer_name].filter(Boolean).join(' · '), link: `/estimates?id=${r.id}`, at: r.at }));
    await add('customer.approval', 'record_approval', "Record the customer's approval",
      `SELECT COUNT(*) n ${WO_BASE} AND wo.customer_approved_at IS NULL AND wo.billing_basis = 'itemised'
         AND EXISTS (SELECT 1 FROM work_order_items i WHERE i.work_order_id = wo.id)`,
      `${WO_COLS} ${WO_BASE} AND wo.customer_approved_at IS NULL AND wo.billing_basis = 'itemised'
         AND EXISTS (SELECT 1 FROM work_order_items i WHERE i.work_order_id = wo.id) ORDER BY wo.created_at`, [W], woItem);
    await add('customer.approval', 'convert_partial', 'Partially approved estimates — open the job card',
      `SELECT COUNT(*) n FROM service_estimates e WHERE e.workshop_id = ? AND e.status = 'partially_approved' AND e.work_order_id IS NULL`,
      `SELECT e.id, e.estimate_number, e.customer_name, e.vehicle_plate, e.updated_at AS at FROM service_estimates e
        WHERE e.workshop_id = ? AND e.status = 'partially_approved' AND e.work_order_id IS NULL ORDER BY e.updated_at`,
      [W], r => ({ id: r.id, title: r.estimate_number, subtitle: [r.vehicle_plate, r.customer_name].filter(Boolean).join(' · '), link: `/estimates?id=${r.id}`, at: r.at }));
    await add('delivery.handover', 'delivery', 'Ready for collection — call, payment, gate pass',
      `SELECT COUNT(*) n ${WO_BASE} AND wo.status = 'ready_for_pickup'`,
      `${WO_COLS} ${WO_BASE} AND wo.status = 'ready_for_pickup' ORDER BY wo.updated_at`, [W], woItem);

    // Floor — the same queues as the Team Board (lib/floor-queues.js)
    await add('job.assign', 'assign', 'Assign a technician',
      `SELECT COUNT(*) n FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id WHERE ${ASSIGN_WHERE}`,
      `${WO_COLS} FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id WHERE ${ASSIGN_WHERE} ORDER BY wo.customer_approved_at`, [W], woItem);
    await add('job.assign', 'assign_sub', 'Sub-job cards without a technician',
      `SELECT COUNT(*) n FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id WHERE ${ASSIGN_SUB_WHERE}`,
      `SELECT wo.id, wo.work_order_number, jc.title, jc.job_card_number, jc.created_at AS at FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id
        WHERE ${ASSIGN_SUB_WHERE} ORDER BY jc.created_at`,
      [W], r => ({ id: r.id, title: r.work_order_number, subtitle: `${r.job_card_number}${r.title ? ` · ${r.title}` : ''}`, link: `/work-orders/${r.id}`, at: r.at }));
    await add('qc.perform', 'qc', 'Quality check & test drive',
      `SELECT COUNT(*) n FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id WHERE ${QC_WHERE}`,
      `SELECT wo.id, wo.work_order_number, wo.customer_name, jc.job_card_number, jc.title, jc.completed_at AS at FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id
        WHERE ${QC_WHERE} ORDER BY jc.completed_at`,
      [W], r => ({ id: r.id, title: r.work_order_number, subtitle: `${r.job_card_number}${r.title && r.title !== 'Main job card' ? ` · ${r.title}` : ''}`, link: `/work-orders/${r.id}`, at: r.at }));
    await add('job.assign', 'rework', 'Rework after a failed quality check',
      `SELECT COUNT(*) n FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id WHERE ${REWORK_WHERE}`,
      `SELECT wo.id, wo.work_order_number, jc.job_card_number, jc.qc_notes, jc.updated_at AS at FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id
        WHERE ${REWORK_WHERE} ORDER BY jc.updated_at`,
      [W], r => ({ id: r.id, title: r.work_order_number, subtitle: `${r.job_card_number}${r.qc_notes ? ` · ${String(r.qc_notes).slice(0, 80)}` : ''}`, link: `/work-orders/${r.id}`, at: r.at }));

    res.json({ success: true, data: { capabilities: capabilitiesOf(req.user), groups } });
  } catch (err) {
    console.error('GET /workflow/my-tasks error:', err);
    res.status(500).json({ success: false, message: 'Failed to load your tasks' });
  }
});

// GET /api/workflow/work-orders/:id
router.get('/work-orders/:id', async (req, res) => {
  try {
    const data = await buildWorkflow(req.params.id, req.workshopId);
    if (!data) return res.status(404).json({ success: false, message: 'Work order not found' });
    // What the person looking can do — the screen shows only their actions.
    // can_override_job_card: may open an external job's card without the
    // customer's acknowledgement (POST /work-orders/:id/job-card).
    data.you = { capabilities: capabilitiesOf(req.user), can_override_job_card: isManagerRole(req.user) };
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /workflow/work-orders/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the workflow' });
  }
});

/**
 * POST /api/workflow/work-orders/:id/job-card — Step 3, open the main job card.
 * Body, for a manager's override only: { override_reason }
 *
 * An internal customer's job, or an external one whose physical inspection
 * the customer has acknowledged (lib/physical-inspection.js) — normally it
 * has opened by itself by then. Without the acknowledgement only a manager
 * (Workshop / General Manager, admin, the owner) may open it, giving a
 * reason: kept on the work order (inspection_override_*), in its history
 * and in the audit log. Anyone else gets 409 PHYSICAL_INSPECTION_REQUIRED.
 */
router.post('/work-orders/:id/job-card', requireCapability('job.open'), async (req, res) => {
  try {
    const wo = await loadWorkOrder(req.params.id, req.workshopId);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (['completed', 'cancelled'].includes(wo.status)) return res.status(409).json({ success: false, message: `This job is ${wo.status}.` });
    const gate = await jobCardGate({ workOrderId: wo.id, workshopId: req.workshopId });
    let overridden = false;
    if (!gate.jobCardOpen && !gate.internal && !gate.acknowledged) {
      if (!isManagerRole(req.user)) {
        return res.status(409).json({ success: false, ...PHYSICAL_INSPECTION_REQUIRED,
          message: 'The customer has not acknowledged the physical inspection yet, so the job card cannot be opened. Only a manager can open it without that.' });
      }
      const reason = String(req.body?.override_reason ?? '').replace(/\s+/g, ' ').trim();
      if (!reason) {
        return res.status(400).json({ success: false, code: 'REASON_REQUIRED', message: 'Give the reason for opening the job card without the customer\'s acknowledgement.' });
      }
      await execute(
        `UPDATE work_orders SET inspection_override_at = NOW(), inspection_override_by = ?, inspection_override_reason = ?
          WHERE id = ? AND workshop_id = ?`,
        [req.user.id, reason.slice(0, 500), wo.id, req.workshopId]);
      await logAudit({
        workshopId: req.workshopId, userId: req.user.id, action: 'JOB_CARD_OVERRIDE', entityType: 'work_orders', entityId: wo.id,
        newValue: { reason: reason.slice(0, 500), physical_inspection: 'not acknowledged' },
      });
      overridden = true;
    }
    // The history gets "Main job card … opened — physical inspection skipped (…: reason)".
    const r = await openJobCardIfReady({ workOrderId: wo.id, workshopId: req.workshopId, userId: req.user.id });
    if (!r.opened) return res.status(409).json({ success: false, ...PHYSICAL_INSPECTION_REQUIRED });
    res.status(201).json({ success: true, data: r.jobCard, overridden });
  } catch (err) {
    console.error('POST /workflow/work-orders/:id/job-card error:', err);
    res.status(500).json({ success: false, message: 'Failed to open the job card' });
  }
});

// POST /api/workflow/work-orders/:id/sub-job-cards — { title, department, mechanic_id, item_ids }
router.post('/work-orders/:id/sub-job-cards', anyCapability(['job.open', 'job.assign']), async (req, res) => {
  try {
    const wo = await loadWorkOrder(req.params.id, req.workshopId);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (['completed', 'cancelled'].includes(wo.status)) return res.status(409).json({ success: false, message: `This job is ${wo.status}.` });
    const title = String(req.body?.title || '').trim().slice(0, 255);
    if (!title) return res.status(400).json({ success: false, message: 'Give the sub-job card a title, e.g. "Body & paint".' });
    const department = DEPARTMENTS.includes(req.body?.department) ? req.body.department : 'mechanical';
    let mechanicId = Number(req.body?.mechanic_id) || null;
    if (mechanicId) {
      const [m] = await query('SELECT id FROM mechanics WHERE id = ? AND workshop_id = ?', [mechanicId, req.workshopId]);
      if (!m) mechanicId = null;
    }
    // A sub-job card hangs off the main one, which an external job only has
    // once the customer has acknowledged the physical inspection.
    const { jobCard: main } = await openJobCardIfReady({ workOrderId: wo.id, workshopId: req.workshopId, userId: req.user.id });
    if (!main) return res.status(409).json({ success: false, ...PHYSICAL_INSPECTION_REQUIRED });
    const [veh] = wo.vehicle_id ? await query('SELECT plate_number FROM vehicles WHERE id = ?', [wo.vehicle_id]) : [];

    let jcId, number;
    for (let attempt = 0; attempt < 3 && !jcId; attempt++) {
      number = genJobCardNumber();
      try {
        const r = await execute(
          `INSERT INTO job_cards (workshop_id, job_card_number, work_order_id, parent_job_card_id, title, customer_id,
                                  vehicle_id, vehicle_plate, service_bay_id, mechanic_id, department, status, wip_opened_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW(), ?)`,
          [req.workshopId, number, wo.id, main.id, title, wo.customer_id, wo.vehicle_id, veh?.plate_number || null,
           wo.service_bay_id, mechanicId, department, req.user.id]
        );
        jcId = r.insertId;
      } catch (err) { if (err.code !== 'ER_DUP_ENTRY') throw err; }
    }
    const itemIds = (Array.isArray(req.body?.item_ids) ? req.body.item_ids : []).map(Number).filter(Boolean);
    if (itemIds.length) {
      await execute('UPDATE work_order_items SET job_card_id = ? WHERE work_order_id = ? AND id IN (?)', [jcId, wo.id, itemIds]);
    }
    await notifyGroups(req.workshopId, FLOOR, {
      title: `Sub-job card ${number}: ${title}`,
      body: `${wo.work_order_number} — part of the approved work moved to its own job card.${mechanicId ? '' : ' Needs a technician.'}`,
      link: `/work-orders/${wo.id}`, orderId: wo.id, icon: '🧩', type: `workflow_sub_jc_${jcId}`, exceptUserId: req.user.id,
    });
    if (mechanicId) {
      await notifyMechanic(req.workshopId, mechanicId, {
        title: `Job assigned: ${wo.work_order_number} · ${title}`, body: `Sub-job card ${number}.`,
        jobCardId: jcId, orderId: wo.id, type: `workflow_sub_jc_${jcId}`,
      });
    }
    // A new open card means the job is not done any more.
    await syncWorkOrderFromJobCards({ workOrderId: wo.id, workshopId: req.workshopId, userId: req.user.id });
    await logAudit(req.workshopId, req.user.id, 'CREATE', 'job_cards', jcId, null, { job_card_number: number, parent: main.id, title });
    res.status(201).json({ success: true, data: { id: jcId, job_card_number: number } });
  } catch (err) {
    console.error('POST /workflow/work-orders/:id/sub-job-cards error:', err);
    res.status(500).json({ success: false, message: 'Failed to create the sub-job card' });
  }
});

// PATCH /api/workflow/job-cards/:id/technician — { mechanic_id } (sub-job cards; the main
// job card follows the work order's technician, assigned on the Team Leader board)
router.patch('/job-cards/:id/technician', async (req, res) => {
  try {
    if (!can(req.user, 'job.assign')) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'The Team Leader assigns technicians.' });
    }
    const [jc] = await query(
      `SELECT jc.*, wo.work_order_number FROM job_cards jc JOIN work_orders wo ON wo.id = jc.work_order_id
        WHERE jc.id = ? AND jc.workshop_id = ?`, [req.params.id, req.workshopId]);
    if (!jc) return res.status(404).json({ success: false, message: 'Job card not found' });
    if (!jc.parent_job_card_id) return res.status(400).json({ success: false, message: 'Assign the main job card from the work order (Team Leader board).' });
    const [m] = await query('SELECT id, full_name FROM mechanics WHERE id = ? AND workshop_id = ?', [req.body?.mechanic_id, req.workshopId]);
    if (!m) return res.status(404).json({ success: false, message: 'Technician not found' });
    await execute('UPDATE job_cards SET mechanic_id = ? WHERE id = ?', [m.id, jc.id]);
    await notifyMechanic(req.workshopId, m.id, {
      title: `Job assigned: ${jc.work_order_number} · ${jc.title || jc.job_card_number}`, body: `Sub-job card ${jc.job_card_number}.`,
      jobCardId: jc.id, orderId: jc.work_order_id, type: `workflow_sub_jc_${jc.id}_assigned`,
    });
    res.json({ success: true, message: `Assigned to ${m.full_name}` });
  } catch (err) {
    console.error('PATCH /workflow/job-cards/:id/technician error:', err);
    res.status(500).json({ success: false, message: 'Failed to assign the technician' });
  }
});

// GET /api/workflow/store/queue — part lines to check, overdue expected dates, estimates to price
router.get('/store/queue', async (req, res) => {
  try {
    if (!['store.issue', 'estimate.price_parts', 'job.assign', 'estimate.raise', 'qc.perform'].some(c => can(req.user, c))) {
      return res.status(403).json({ success: false, message: 'The Store queue is for the Store and the floor.' });
    }
    const items = await query(
      `SELECT i.id, i.description, i.part_number, i.quantity_requested, i.quantity_issued, i.availability, i.expected_date,
              i.eta_alerted_at, i.checked_at, r.req_number, r.created_at AS requested_at,
              jc.id AS job_card_id, jc.job_card_number, jc.title AS job_card_title, wo.id AS work_order_id, wo.work_order_number,
              v.plate_number, u.full_name AS requested_by_name
         FROM material_requisition_items i
         JOIN material_requisitions r ON r.id = i.requisition_id
         JOIN job_cards jc ON jc.id = r.job_card_id
         JOIN work_orders wo ON wo.id = jc.work_order_id
         LEFT JOIN vehicles v ON v.id = wo.vehicle_id
         LEFT JOIN users u ON u.id = r.requested_by
        WHERE r.workshop_id = ? AND r.status <> 'cancelled' AND i.status NOT IN ('issued','cancelled','returned')
          AND wo.status NOT IN ('completed','cancelled')
        ORDER BY (i.availability = 'unchecked') DESC, i.expected_date IS NULL, i.expected_date, i.id`,
      [req.workshopId]
    );
    const estimates = await query(
      `SELECT e.id, e.estimate_number, e.customer_name, e.vehicle_plate, e.created_at, e.intake_work_order_id,
              COUNT(l.id) AS part_lines
         FROM service_estimates e
         JOIN estimate_lines l ON l.estimate_id = e.id AND l.line_type = 'parts'
        WHERE e.workshop_id = ? AND e.status = 'draft' AND ${UNPRICED_PART_SQL}
        GROUP BY e.id ORDER BY e.created_at`,
      [req.workshopId]
    );
    res.json({ success: true, data: { items, estimates } });
  } catch (err) {
    console.error('GET /workflow/store/queue error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the store queue' });
  }
});

// PATCH /api/workflow/requisition-items/:id — Store availability check
// { availability: 'available', unit_cost? }  → parts issued to the job card
// { availability: 'not_available', expected_date: 'YYYY-MM-DD' } → floor alerted 24 h before
router.patch('/requisition-items/:id', async (req, res) => {
  try {
    if (!can(req.user, 'store.issue')) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'The Store checks availability and issues parts.' });
    }
    const [item] = await query(
      `SELECT i.*, r.id AS requisition_id, r.req_number, r.job_card_id, jc.job_card_number, jc.mechanic_id,
              jc.work_order_id, wo.work_order_number
         FROM material_requisition_items i
         JOIN material_requisitions r ON r.id = i.requisition_id
         JOIN job_cards jc ON jc.id = r.job_card_id
         JOIN work_orders wo ON wo.id = jc.work_order_id
        WHERE i.id = ? AND r.workshop_id = ?`, [req.params.id, req.workshopId]);
    if (!item) return res.status(404).json({ success: false, message: 'Requisition line not found' });
    if (item.status === 'issued') return res.status(409).json({ success: false, message: 'Already issued.' });
    const availability = req.body?.availability;

    if (availability === 'available') {
      const unitCost = req.body?.unit_cost != null && req.body.unit_cost !== '' ? Math.max(0, Number(req.body.unit_cost) || 0) : (item.unit_cost ?? 0);
      const issueNumber = `MI-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900) + 100}`;
      const r = await execute(
        `INSERT INTO material_issues (workshop_id, issue_number, requisition_id, job_card_id, issued_by, issue_type, notes)
         VALUES (?, ?, ?, ?, ?, 'standard', ?)`,
        [req.workshopId, issueNumber, item.requisition_id, item.job_card_id, req.user.id, `Issued against ${item.req_number}`]
      );
      await execute(
        'INSERT INTO material_issue_items (issue_id, part_number, description, quantity, unit_cost) VALUES (?, ?, ?, ?, ?)',
        [r.insertId, item.part_number, item.description, item.quantity_requested, unitCost]
      );
      await execute(
        `UPDATE material_requisition_items
            SET availability = 'available', status = 'issued', quantity_issued = quantity_requested, unit_cost = ?,
                checked_by = ?, checked_at = NOW()
          WHERE id = ?`, [unitCost, req.user.id, item.id]);
      const [left] = await query(
        "SELECT COUNT(*) AS n FROM material_requisition_items WHERE requisition_id = ? AND status NOT IN ('issued','cancelled')", [item.requisition_id]);
      await execute('UPDATE material_requisitions SET status = ? WHERE id = ?', [Number(left.n) ? 'partially_issued' : 'issued', item.requisition_id]);
      if (item.mechanic_id) {
        await notifyMechanic(req.workshopId, item.mechanic_id, {
          title: `Parts issued: ${item.work_order_number}`, body: `${Number(item.quantity_requested)} × ${item.description} — collect from the Store.`,
          jobCardId: item.job_card_id, orderId: item.work_order_id, type: `workflow_parts_issued_${item.id}`,
        });
      }
      await logAudit(req.workshopId, req.user.id, 'ISSUE', 'material_requisition_items', item.id, item.availability, { issue_number: issueNumber });
      return res.json({ success: true, message: 'Parts issued', issue_number: issueNumber });
    }

    if (availability === 'not_available') {
      const expected = req.body?.expected_date;
      if (!isoDate(expected)) return res.status(400).json({ success: false, message: 'Record the expected arrival date.' });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (new Date(`${expected}T00:00:00`) < today) return res.status(400).json({ success: false, message: 'The expected arrival date is in the past.' });
      // A new date means a new 24-hour alert.
      await execute(
        `UPDATE material_requisition_items
            SET availability = 'not_available', expected_date = ?, eta_alerted_at = NULL, checked_by = ?, checked_at = NOW()
          WHERE id = ?`, [expected, req.user.id, item.id]);
      await notifyGroups(req.workshopId, FLOOR, {
        title: `Part not on the shelf: ${item.work_order_number}`,
        body: `${item.description} for ${item.job_card_number} — expected ${expected}. The floor will be alerted 24 hours before.`,
        link: `/work-orders/${item.work_order_id}`, orderId: item.work_order_id, icon: '⏳', type: `workflow_part_eta_${item.id}`, exceptUserId: req.user.id,
      });
      if (item.mechanic_id) {
        await notifyMechanic(req.workshopId, item.mechanic_id, {
          title: `Waiting for a part: ${item.work_order_number}`, body: `${item.description} expected ${expected}.`,
          jobCardId: item.job_card_id, orderId: item.work_order_id, type: `workflow_part_eta_${item.id}`,
        });
      }
      await logAudit(req.workshopId, req.user.id, 'NOT_AVAILABLE', 'material_requisition_items', item.id, item.availability, { expected_date: expected });
      return res.json({ success: true, message: `Recorded — expected ${expected}` });
    }
    return res.status(400).json({ success: false, message: "availability must be 'available' or 'not_available'" });
  } catch (err) {
    console.error('PATCH /workflow/requisition-items/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to update the part' });
  }
});

// POST /api/workflow/work-orders/:id/contacts — { channel, outcome, note, purpose }
router.post('/work-orders/:id/contacts', requireCapability('delivery.handover'), async (req, res) => {
  try {
    const wo = await loadWorkOrder(req.params.id, req.workshopId);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    const channel = ['phone', 'whatsapp', 'email', 'sms'].includes(req.body?.channel) ? req.body.channel : null;
    if (!channel) return res.status(400).json({ success: false, message: 'channel must be phone, whatsapp, email or sms' });
    const outcome = ['reached', 'no_answer', 'message_sent'].includes(req.body?.outcome) ? req.body.outcome : (channel === 'phone' ? 'reached' : 'message_sent');
    const purpose = ['pickup', 'update', 'other'].includes(req.body?.purpose) ? req.body.purpose : 'pickup';
    const r = await execute(
      `INSERT INTO work_order_contacts (workshop_id, work_order_id, channel, purpose, outcome, note, contacted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.workshopId, wo.id, channel, purpose, outcome, req.body?.note ? String(req.body.note).slice(0, 500) : null, req.user.id]
    );
    await execute(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
      [wo.id, wo.status, req.user.id, `Customer contacted for ${purpose === 'pickup' ? 'collection' : purpose} by ${channel} (${outcome.replace('_', ' ')})${req.body?.note ? `: ${String(req.body.note).slice(0, 150)}` : ''}`]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (err) {
    console.error('POST /workflow/work-orders/:id/contacts error:', err);
    res.status(500).json({ success: false, message: 'Failed to log the contact' });
  }
});

/** Why the vehicle cannot leave yet (empty when it can). */
async function gatePassBlockers(wo, workshopId) {
  const blockers = [];
  const cards = await query("SELECT status FROM job_cards WHERE work_order_id = ? AND workshop_id = ? AND status <> 'cancelled'", [wo.id, workshopId]);
  if (!cards.length || !cards.every(c => JC_QC_PASSED.includes(c.status))) blockers.push('The quality check has not passed on every job card.');
  const [invoice] = await query(
    "SELECT id, invoice_number, status, total_amount, amount_paid FROM invoices WHERE work_order_id = ? AND workshop_id = ? AND status NOT IN ('void','cancelled') ORDER BY id DESC LIMIT 1",
    [wo.id, workshopId]);
  if (!invoice) blockers.push('No invoice has been raised.');
  else if (!paymentSettled(invoice, { customerClass: wo.customer_class, payerType: wo.payer_type })) {
    const due = Math.max(0, (Number(invoice.total_amount) || 0) - (Number(invoice.amount_paid) || 0));
    blockers.push(`Invoice ${invoice.invoice_number} is ${invoice.status === 'partially_paid' ? 'partly paid' : 'not paid yet'} (AED ${due.toFixed(2)} due) — take the payment first.`);
  }
  return { blockers, invoice };
}

// POST /api/workflow/work-orders/:id/gate-pass — { odometer_out, notes }
router.post('/work-orders/:id/gate-pass', requireCapability('delivery.handover'), async (req, res) => {
  try {
    const wo = await loadWorkOrder(req.params.id, req.workshopId);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    const [existing] = await query("SELECT * FROM gate_passes WHERE work_order_id = ? AND workshop_id = ? AND status = 'released' LIMIT 1", [wo.id, req.workshopId]);
    if (existing) return res.json({ success: true, data: existing, message: 'Gate pass already issued' });

    // Raise the invoice if it is missing — the gate pass checks it.
    const [anyInvoice] = await query("SELECT id FROM invoices WHERE work_order_id = ? AND workshop_id = ? AND status NOT IN ('void','cancelled') LIMIT 1", [wo.id, req.workshopId]);
    if (!anyInvoice) await createInvoiceFromWorkOrder(wo.id, req.workshopId, req.user.id).catch(e => console.error('[Workflow] invoice for gate pass failed:', e.message));

    const { blockers, invoice } = await gatePassBlockers(wo, req.workshopId);
    if (blockers.length) return res.status(409).json({ success: false, code: 'GATE_PASS_BLOCKED', message: blockers.join(' '), blockers });

    const main = await getMainJobCard(wo.id, req.workshopId);
    const [veh] = wo.vehicle_id ? await query('SELECT plate_number FROM vehicles WHERE id = ?', [wo.vehicle_id]) : [];
    const number = `GP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900) + 100}`;
    const odo = Number(req.body?.odometer_out) > 0 ? Math.round(Number(req.body.odometer_out)) : null;
    const r = await execute(
      `INSERT INTO gate_passes (workshop_id, gate_pass_number, job_card_id, work_order_id, invoice_id, customer_id, customer_name,
                                vehicle_id, vehicle_plate, odometer_out, payment_confirmed, qc_confirmed, released_by, released_at, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, NOW(), 'released', ?)`,
      [req.workshopId, number, main?.id || null, wo.id, invoice.id, wo.customer_id, wo.customer_name, wo.vehicle_id,
       veh?.plate_number || null, odo, req.user.id, req.body?.notes ? String(req.body.notes).slice(0, 1000) : null]
    );
    await execute(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
      [wo.id, wo.status, req.user.id, `Final gate pass ${number} issued`]
    );
    await logAudit(req.workshopId, req.user.id, 'CREATE', 'gate_passes', r.insertId, null, { gate_pass_number: number });
    const [gp] = await query('SELECT * FROM gate_passes WHERE id = ?', [r.insertId]);
    res.status(201).json({ success: true, data: gp, message: `Gate pass ${number} issued` });
  } catch (err) {
    console.error('POST /workflow/work-orders/:id/gate-pass error:', err);
    res.status(500).json({ success: false, message: 'Failed to issue the gate pass' });
  }
});

// POST /api/workflow/work-orders/:id/close — Step 7.2 Closing
router.post('/work-orders/:id/close', requireCapability('delivery.handover'), async (req, res) => {
  try {
    const wo = await loadWorkOrder(req.params.id, req.workshopId);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (wo.status === 'completed') return res.json({ success: true, message: 'Already closed' });
    // Bring the status up to date first (e.g. QC passed but still 'inspection').
    await syncWorkOrderFromJobCards({ workOrderId: wo.id, workshopId: req.workshopId, userId: req.user.id });
    const r = await applyStatusChange({
      workOrderId: wo.id, workshopId: req.workshopId, userId: req.user.id, status: 'completed',
      note: req.body?.note ? String(req.body.note).slice(0, 500) : 'Job closed',
    });
    if (!r.ok) return res.status(r.http).json({ success: false, code: r.code, message: r.message });
    // Close the job cards and their WIP.
    const cards = await query("SELECT id, job_card_number, total_cost FROM job_cards WHERE work_order_id = ? AND workshop_id = ? AND status <> 'cancelled'", [wo.id, req.workshopId]);
    for (const c of cards) {
      await execute("UPDATE job_cards SET status = 'billed', wip_closed_at = NOW() WHERE id = ?", [c.id]);
      await execute(
        `INSERT INTO wip_ledger (workshop_id, job_card_id, work_order_id, entry_type, amount, description, posted_by)
         VALUES (?, ?, ?, 'close', ?, ?, ?)`,
        [req.workshopId, c.id, wo.id, c.total_cost || 0, `WIP closed: ${c.job_card_number}`, req.user.id]
      ).catch(() => {});
    }
    res.json({ success: true, message: 'Job closed' });
  } catch (err) {
    console.error('POST /workflow/work-orders/:id/close error:', err);
    res.status(500).json({ success: false, message: 'Failed to close the job' });
  }
});

export default router;
