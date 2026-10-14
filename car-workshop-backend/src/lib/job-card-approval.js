/**
 * job-card-approval.js — the two approvals process steps 5–6 require.
 *
 *  1. Customer agreement on a job card. Roadmap Phase 1: "No work begins
 *     without the customer's agreement." A job card from an approved
 *     estimate carries it (channel 'estimate'); one opened at the counter
 *     needs the advisor to record how the customer agreed before any path
 *     can move it to in_progress. Only billing_basis = 'itemised' job cards
 *     are held to it — imported legacy rows were agreed in the old system.
 *
 *  2. Internal sign-off on an estimate for an EXTERNAL customer before it is
 *     sent: "Supervisor or Workshop Manager approves it first". Internal
 *     (fleet / asset) customers' estimates go straight out.
 */
import { query, execute } from './database.js';

// 'estimate' is written only by the estimate conversion, never by hand.
export const CUSTOMER_APPROVAL_CHANNELS = ['in_person', 'phone', 'written'];

export const CUSTOMER_APPROVAL_REQUIRED = {
  code: 'CUSTOMER_APPROVAL_REQUIRED',
  message: 'Work can\'t start yet — the customer hasn\'t approved this job card. Record their approval on the job card first.',
};

/** True when this job card may not be started because the customer's agreement is not on record. */
export async function customerApprovalMissing(workOrderId, workshopId) {
  const [wo] = await query(
    'SELECT billing_basis, customer_approved_at FROM work_orders WHERE id = ? AND workshop_id = ?',
    [workOrderId, workshopId]
  );
  return !!wo && wo.billing_basis === 'itemised' && !wo.customer_approved_at;
}

/**
 * Nothing priced on the job card yet — no lines and no fee — so there is
 * nothing for the customer to agree to. Their decision follows the estimate
 * (Steps 4–5), or counter lines on an internal job; an approval of AED 0
 * would open the "no work without approval" gate with nothing agreed.
 * `db` is an open transaction's connection, when there is one.
 */
export async function nothingToApprove(workOrderId, workshopId, db = null) {
  const sql = `SELECT wo.service_fee, (SELECT COUNT(*) FROM work_order_items i WHERE i.work_order_id = wo.id) AS line_count
                 FROM work_orders wo WHERE wo.id = ? AND wo.workshop_id = ?`;
  const [wo] = db ? (await db.query(sql, [workOrderId, workshopId]))[0] : await query(sql, [workOrderId, workshopId]);
  return !!wo && Number(wo.line_count) === 0 && !(Number(wo.service_fee) > 0);
}

export const NOTHING_TO_APPROVE = {
  code: 'NOTHING_TO_APPROVE',
  message: 'Nothing is priced on this job card yet, so there is nothing for the customer to approve. Raise the estimate after the inspection.',
};

/**
 * Record the customer's agreement and snapshot the total they agreed to.
 * Call after the job card's totals are current (syncJobCardBilling).
 * `db`: run inside the caller's transaction (the job card create does).
 */
export async function recordCustomerApproval({ workOrderId, workshopId, channel, note = null, userId = null, db = null }) {
  const run = db ? (sql, p) => db.query(sql, p) : execute;
  await run(
    `UPDATE work_orders
        SET customer_approved_at = NOW(), customer_approval_channel = ?, customer_approved_by = ?,
            customer_approval_note = ?, customer_approved_total = total_amount
      WHERE id = ? AND workshop_id = ?`,
    [channel, userId, note ? String(note).slice(0, 500) : null, workOrderId, workshopId]
  );
  await run(
    'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) SELECT id, status, ?, ? FROM work_orders WHERE id = ? AND workshop_id = ?',
    [userId, `Customer approval recorded (${channel.replace('_', ' ')})${note ? `: ${String(note).slice(0, 200)}` : ''}`, workOrderId, workshopId]
  ).catch(err => console.error('[Approval] status log failed:', err.message));
}

// ── Step 1 classification ──────────────────────────────────────────────

/**
 * The job's Step 1 classification: what it was classified as at intake
 * (work_orders.intake_customer_*, 20261015_intake_integrity.sql), so
 * reclassifying the account later does not rewrite old jobs or their
 * approval rule. A job whose intake classification was never complete (no
 * subcategory) falls back to the customer as it stands now — completing the
 * customer then completes Step 1. `row` carries intake_customer_class /
 * intake_customer_subcategory and the customer's customer_class /
 * customer_subcategory.
 */
export function jobClassification(row) {
  if (row?.intake_customer_class && row?.intake_customer_subcategory) {
    return { cls: row.intake_customer_class, sub: row.intake_customer_subcategory, fromJob: true };
  }
  return { cls: row?.customer_class || row?.intake_customer_class || null, sub: row?.customer_subcategory || null, fromJob: false };
}

// ── Internal estimate sign-off ─────────────────────────────────────────

const APPROVER_ROLES = ['admin', 'super_admin', 'general_manager', 'workshop_manager', 'supervisor'];

/** Supervisor, workshop manager, general manager, or the owner. users.role is
 *  the legacy enum; role_slug covers roles added through the roles table. */
export function canApproveEstimates(user) {
  return !!user && (APPROVER_ROLES.includes(user.role) || APPROVER_ROLES.includes(user.role_slug) || user.is_owner === 1);
}

/**
 * External unless the Step 1 classification says internal: the job's own
 * (intake) classification when the estimate belongs to a job, else the
 * customer's. The estimate's account type ("Internal fleet") is billing
 * detail and cannot drop the approval for an external customer; it decides
 * only for an estimate with no customer at all.
 */
export async function isExternalEstimate(estimate) {
  const woId = estimate.intake_work_order_id || estimate.work_order_id;
  if (woId) {
    const [wo] = await query(
      `SELECT wo.intake_customer_class, wo.intake_customer_subcategory, c.customer_class, c.customer_subcategory
         FROM work_orders wo LEFT JOIN customers c ON c.id = wo.customer_id
        WHERE wo.id = ? AND wo.workshop_id = ?`, [woId, estimate.workshop_id]);
    const { cls } = jobClassification(wo || {});
    if (cls) return cls !== 'internal';
  }
  if (estimate.customer_id) {
    const [c] = await query('SELECT customer_class FROM customers WHERE id = ? AND workshop_id = ?',
      [estimate.customer_id, estimate.workshop_id]);
    if (c) return c.customer_class !== 'internal';
  }
  return estimate.customer_type !== 'internal_fleet';
}

/** Users who can sign an estimate off, for the "waiting for you" notification. */
export async function estimateApprovers(workshopId) {
  return query(
    `SELECT u.id FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.workshop_id = ? AND u.is_active = 1
        AND (u.role IN (?) OR r.slug IN (?) OR u.is_owner = 1)`,
    [workshopId, APPROVER_ROLES, APPROVER_ROLES]
  );
}
