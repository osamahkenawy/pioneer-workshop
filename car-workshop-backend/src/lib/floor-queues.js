/**
 * floor-queues.js — the Team Leader's floor queues (Steps 6–7).
 *
 * Used by GET /workflow/my-tasks and GET /team-leader/overview, so "Your
 * tasks" and the Team Board always show the same numbers. Each fragment is a
 * WHERE clause with one placeholder, the workshop id:
 *
 *   ASSIGN_WHERE / AWAITING_CUSTOMER_WHERE  over  work_orders wo
 *   ASSIGN_SUB_WHERE / QC_WHERE / REWORK_WHERE  over  job_cards jc JOIN work_orders wo
 */
const LIVE_WO = "wo.status NOT IN ('completed','cancelled')";

/** Step 6: a live job card the customer has approved, with no technician yet. */
export const ASSIGN_WHERE = `wo.workshop_id = ? AND ${LIVE_WO}
  AND EXISTS (SELECT 1 FROM job_cards jc0 WHERE jc0.work_order_id = wo.id AND jc0.status <> 'cancelled')
  AND wo.customer_approved_at IS NOT NULL AND wo.mechanic_id IS NULL`;

/** The same job cards still waiting for the customer's decision (not the Team Leader's yet). */
export const AWAITING_CUSTOMER_WHERE = `wo.workshop_id = ? AND ${LIVE_WO}
  AND EXISTS (SELECT 1 FROM job_cards jc0 WHERE jc0.work_order_id = wo.id AND jc0.status <> 'cancelled')
  AND wo.customer_approved_at IS NULL AND wo.mechanic_id IS NULL`;

/** Step 6: sub-job cards without a technician. */
export const ASSIGN_SUB_WHERE = `jc.workshop_id = ? AND jc.parent_job_card_id IS NOT NULL AND jc.mechanic_id IS NULL
  AND jc.status NOT IN ('cancelled','billed') AND ${LIVE_WO}`;

/** Step 7: job done, waiting for the quality check and test drive. */
export const QC_WHERE = `jc.workshop_id = ? AND jc.status = 'qc_pending' AND ${LIVE_WO}`;

/** Step 7: failed the quality check, back to the technician. */
export const REWORK_WHERE = `jc.workshop_id = ? AND jc.status = 'qc_failed' AND ${LIVE_WO}`;
