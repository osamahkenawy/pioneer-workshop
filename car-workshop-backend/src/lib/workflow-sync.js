/**
 * workflow-sync.js — keeps the work order's status in step with its job
 * cards, so the status the whole system already reads (lists, the customer
 * status page, SMS, reports) follows the work on the floor:
 *
 *   time booking starts on a job card  → work order in_progress   (Step 6)
 *   every job card marked JOB DONE      → work order inspection    (Step 6 → 7)
 *   every job card passes the QC        → work order ready_for_pickup (shown as
 *                                         "Ready for collection"), and the Service
 *                                         Advisor is told to call the customer
 *                                         to arrange collection   (Step 7.1)
 *   a QC fails                          → work order back to in_progress, and the
 *                                         Team Leader / Supervisor are told
 *
 * Every move goes through applyStatusChange (routes/work-orders.js), so it
 * has the same side effects as pressing the status button.
 */
import { query } from './database.js';
import { applyStatusChange } from '../routes/work-orders.js';
import { JC_WORK_DONE, JC_QC_PASSED, notifyGroups } from './workflow.js';

// The route from each status to the target, through VALID_TRANSITIONS.
const PATHS = {
  in_progress: {
    pending: ['confirmed', 'in_progress'], estimate_approved: ['confirmed', 'in_progress'],
    confirmed: ['in_progress'], assigned: ['in_progress'], accepted: ['in_progress'], inspection: ['in_progress'],
  },
  inspection: { in_progress: ['inspection'] },
  ready_for_pickup: { inspection: ['ready_for_pickup'], in_progress: ['ready_for_pickup'] },
};

async function walk(wo, target, { workshopId, userId, note }) {
  const path = PATHS[target]?.[wo.status];
  if (!path) return { ok: wo.status === target };
  for (const step of path) {
    const r = await applyStatusChange({ workOrderId: wo.id, workshopId, userId, status: step, note });
    if (!r.ok) return r;
  }
  return { ok: true, moved: true };
}

/**
 * Bring the work order to where its job cards are. Returns what happened,
 * e.g. { moved: 'ready_for_pickup' } or { blocked: { code, message } }.
 */
export async function syncWorkOrderFromJobCards({ workOrderId, workshopId, userId = null, reason = null }) {
  const [wo] = await query(
    'SELECT id, status, work_order_number FROM work_orders WHERE id = ? AND workshop_id = ?',
    [workOrderId, workshopId]
  );
  if (!wo || ['completed', 'cancelled'].includes(wo.status)) return {};
  const cards = await query(
    "SELECT status FROM job_cards WHERE work_order_id = ? AND workshop_id = ? AND status <> 'cancelled'",
    [workOrderId, workshopId]
  );
  if (!cards.length) return {};

  const allPassed = cards.every(c => JC_QC_PASSED.includes(c.status));
  const allDone = cards.every(c => JC_WORK_DONE.includes(c.status));
  const anyFailed = cards.some(c => c.status === 'qc_failed');
  const anyWorking = cards.some(c => c.status === 'in_progress');

  let target = null;
  if (allPassed) target = 'ready_for_pickup';
  else if (anyFailed || anyWorking) target = 'in_progress';
  else if (allDone) target = 'inspection';
  if (!target || wo.status === target) return {};
  // Never move a job backwards out of ready_for_pickup except for a failed QC.
  if (wo.status === 'ready_for_pickup' && target !== 'in_progress') return {};

  const r = await walk(wo, target, { workshopId, userId, note: reason });
  if (!r.ok) return { blocked: { code: r.code, message: r.message } };

  if (target === 'ready_for_pickup') {
    await notifyGroups(workshopId, ['service_advisor'], {
      title: `Ready for collection: ${wo.work_order_number}`,
      body: 'Quality check and test drive passed. Call the customer to arrange collection.',
      link: `/work-orders/${wo.id}`, orderId: wo.id, icon: '🚗', type: 'workflow_ready_for_collection', exceptUserId: userId,
    });
  }
  return { moved: target };
}
