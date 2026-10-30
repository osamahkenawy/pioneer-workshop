/**
 * physical-inspection.js — the main job card waits for the customer's
 * acknowledgement of the physical inspection (client e-mail, 2026-10-29).
 *
 * The physical inspection is the walk-around with the customer at drop-off
 * (vehicle_inspections.inspection_type 'intake'): the vehicle's condition,
 * damage, photos and the customer's signature. Acknowledging the condition
 * is separate from approving the repair (the estimate, Steps 5–6).
 *
 * EXTERNAL customers: the main job card is not opened with the work order.
 * It opens when the inspection is acknowledged —
 *   - completed with the customer's signature on the screen at the car,
 *   - completed as "customer not present" and signed later from the link
 *     (public-inspections.js) or in the customer portal (customer-portal.js),
 *   - completed in paper-upload mode (the paper form carries the signature),
 * or when a manager opens it without that, giving a reason (Step 3 on the
 * job card screen: work_orders.inspection_override_*).
 * INTERNAL customers skip it: their job card opens with the work order.
 *
 * Every path that opens a main job card goes through openJobCardIfReady();
 * routes/estimates.js reads jobCardGate() before an estimate is raised. Keep
 * the two signatures stable.
 */
import { query, execute } from './database.js';
import { ensureMainJobCard, getMainJobCard, jobClassification } from './workflow.js';

/** How the acknowledgement was given — work_order_status_logs wording. */
export const ACKNOWLEDGED_VIA = Object.freeze({
  on_site: 'signed by the customer at the car',
  link: 'signed by the customer from the link',
  portal: 'signed by the customer in the customer portal',
  paper: 'paper form uploaded',
  override: 'opened by a manager without the acknowledgement',
});

const SIGNED_VIA = ['on_site', 'link', 'portal'];

/**
 * How the physical inspection was acknowledged, or null. Pure: `inspection`
 * is the work order's intake inspection row (status, entry_mode, signed_at,
 * signed_via), `wo` the work order (inspection_override_at). Signed before
 * completion does not count yet — the walk-around may still change.
 *
 * @returns {'on_site'|'link'|'portal'|'paper'|'override'|null}
 */
export function acknowledgedVia(inspection, wo = null) {
  if (inspection?.status === 'completed') {
    if (inspection.signed_at) return SIGNED_VIA.includes(inspection.signed_via) ? inspection.signed_via : 'on_site';
    if (inspection.entry_mode === 'document') return 'paper';
  }
  if (wo?.inspection_override_at) return 'override';
  return null;
}

const runner = db => (db ? async (sql, p = []) => (await db.query(sql, p))[0] : query);

/**
 * Where the work order stands against the job card rule.
 *
 * @param {{workOrderId: number, workshopId: number, db?: object|null}} args
 *   `db`: a connection with an open transaction, to read on it.
 * @returns {Promise<{internal: boolean, acknowledged: boolean,
 *   via: ('on_site'|'link'|'portal'|'paper'|'override'|null), jobCardOpen: boolean}>}
 *   internal — the job's Step 1 classification (work_orders.intake_customer_class,
 *              else the customer's) is internal: no acknowledgement needed;
 *   acknowledged / via — the intake inspection is completed and signed (via
 *              'on_site' | 'link' | 'portal'), completed in paper mode
 *              ('paper'), or a manager override was recorded ('override');
 *   jobCardOpen — a live (not cancelled) main job card exists.
 *   A work order that does not exist reads as all false / null.
 */
export async function jobCardGate({ workOrderId, workshopId, db = null }) {
  const q = runner(db);
  // wo.* — the override columns arrive with 20261029_physical_inspection.sql.
  const [wo] = await q(
    `SELECT wo.*, c.customer_class, c.customer_subcategory
       FROM work_orders wo LEFT JOIN customers c ON c.id = wo.customer_id
      WHERE wo.id = ? AND wo.workshop_id = ?`,
    [workOrderId, workshopId]
  );
  if (!wo) return { internal: false, acknowledged: false, via: null, jobCardOpen: false };
  const [inspection] = await q(
    `SELECT status, entry_mode, signed_at, signed_via FROM vehicle_inspections
      WHERE work_order_id = ? AND workshop_id = ? AND inspection_type = 'intake' ORDER BY id LIMIT 1`,
    [wo.id, workshopId]
  );
  const main = await getMainJobCard(wo.id, workshopId, db);
  const via = acknowledgedVia(inspection, wo);
  return { internal: jobClassification(wo).cls === 'internal', acknowledged: !!via, via, jobCardOpen: !!main };
}

/**
 * Open the work order's main job card if the rule allows it: an internal
 * customer, or the physical inspection acknowledged. Otherwise nothing is
 * opened. ensureMainJobCard() does the opening, so the Supervisor, Foreman
 * and Team Leader are told a request has been raised — unless `notify` is
 * false, or `db` is given: the card is then written on that transaction and
 * the caller runs announceMainJobCard() after the commit.
 *
 * The work order's history gets "Main job card JC-… opened — <how it was
 * acknowledged>" (not for internal customers, whose card opens with the job).
 *
 * @param {{workOrderId: number, workshopId: number, userId?: number|null,
 *          db?: object|null, notify?: boolean}} args
 * @returns {Promise<{opened: boolean, jobCard: object|null, reason: string|null}>}
 *   opened — a live main job card exists after the call; jobCard — that row.
 *   reason — null when it was opened now; 'ALREADY_OPEN' when it already
 *   was (opened: true); with opened: false, 'PHYSICAL_INSPECTION_REQUIRED',
 *   'WORK_ORDER_CLOSED' (completed / cancelled) or 'NOT_FOUND'.
 */
export async function openJobCardIfReady({ workOrderId, workshopId, userId = null, db = null, notify = true }) {
  const q = runner(db);
  const [wo] = await q('SELECT * FROM work_orders WHERE id = ? AND workshop_id = ?', [workOrderId, workshopId]);
  if (!wo) return { opened: false, jobCard: null, reason: 'NOT_FOUND' };
  const existing = await getMainJobCard(wo.id, workshopId, db);
  if (existing) return { opened: true, jobCard: existing, reason: 'ALREADY_OPEN' };
  if (['completed', 'cancelled'].includes(wo.status)) return { opened: false, jobCard: null, reason: 'WORK_ORDER_CLOSED' };

  const gate = await jobCardGate({ workOrderId: wo.id, workshopId, db });
  if (!gate.internal && !gate.acknowledged) return { opened: false, jobCard: null, reason: 'PHYSICAL_INSPECTION_REQUIRED' };

  const jobCard = await ensureMainJobCard({ workOrderId: wo.id, workshopId, userId, notify, db });
  if (!jobCard) return { opened: false, jobCard: null, reason: 'NOT_FOUND' };

  if (!gate.internal) {
    const how = gate.via === 'override' && wo.inspection_override_reason
      ? `${ACKNOWLEDGED_VIA.override}: ${String(wo.inspection_override_reason).slice(0, 200)}`
      : ACKNOWLEDGED_VIA[gate.via];
    const note = `Main job card ${jobCard.job_card_number} opened — physical inspection ${gate.via === 'override' ? 'skipped' : 'acknowledged'} (${how})`;
    // Once per card: two acknowledgements racing (the link and the portal)
    // open one card, and the history says so once.
    const write = db ? (sql, p) => db.query(sql, p) : execute;
    await write(
      `INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note)
       SELECT wo.id, wo.status, ?, ? FROM work_orders wo
        WHERE wo.id = ? AND NOT EXISTS (SELECT 1 FROM work_order_status_logs sl WHERE sl.work_order_id = wo.id AND sl.note LIKE ?)`,
      [userId, note, wo.id, `Main job card ${jobCard.job_card_number} opened%`]
    ).catch(err => console.error('[PhysicalInspection] status log failed:', err.message));
  }
  return { opened: true, jobCard, reason: null };
}

/**
 * Nothing can be put on the floor yet: an external customer's job with no
 * live main job card and no acknowledgement of the physical inspection, so
 * a technician cannot be assigned (Team Board, the job card, Job Assignment)
 * — there is no job card to work on. False for an internal customer, an
 * acknowledged job (assigning opens its card) and an import opened before
 * the workshop's first job card (lib/job-phase.js isLegacyJob; the status
 * rule in routes/work-orders.js applyStatusChange reads it the same way).
 *
 * @param {{workOrderId: number, workshopId: number, db?: object|null}} args
 * @returns {Promise<boolean>}
 */
export async function awaitingPhysicalInspection({ workOrderId, workshopId, db = null }) {
  const gate = await jobCardGate({ workOrderId, workshopId, db });
  if (gate.jobCardOpen || gate.internal || gate.acknowledged) return false;
  const q = runner(db);
  const [wo] = await q('SELECT created_at FROM work_orders WHERE id = ? AND workshop_id = ?', [workOrderId, workshopId]);
  if (!wo) return false;
  const [first] = await q('SELECT MIN(created_at) AS at FROM job_cards WHERE workshop_id = ?', [workshopId]);
  return !(first?.at && new Date(wo.created_at) < new Date(first.at));
}

/**
 * awaitingPhysicalInspection() as a 0/1 SQL expression, for lists (the work
 * order's status label, lib/status-labels.js). `wo` is the work_orders row,
 * `c` its customer (LEFT JOIN customers c ON c.id = wo.customer_id). Open,
 * external (jobClassification), no job card ever opened, not acknowledged
 * (signed / paper form) or overridden, and not an import.
 */
export const AWAITING_PHYSICAL_SQL = `(wo.status NOT IN ('completed','cancelled') AND wo.inspection_override_at IS NULL
  AND (CASE WHEN wo.intake_customer_class IS NOT NULL AND wo.intake_customer_subcategory IS NOT NULL THEN wo.intake_customer_class
            ELSE COALESCE(c.customer_class, wo.intake_customer_class, 'external') END) <> 'internal'
  AND NOT EXISTS (SELECT 1 FROM job_cards jpi WHERE jpi.work_order_id = wo.id)
  AND NOT EXISTS (SELECT 1 FROM vehicle_inspections vpi WHERE vpi.work_order_id = wo.id AND vpi.inspection_type = 'intake'
                   AND vpi.status = 'completed' AND (vpi.signed_at IS NOT NULL OR vpi.entry_mode = 'document'))
  AND wo.created_at >= COALESCE((SELECT MIN(jf.created_at) FROM job_cards jf WHERE jf.workshop_id = wo.workshop_id), wo.created_at))`;

/** The 409 body when an external job's job card (or estimate) waits for the acknowledgement. */
export const PHYSICAL_INSPECTION_REQUIRED = {
  code: 'PHYSICAL_INSPECTION_REQUIRED',
  message: "The job card opens once the customer has acknowledged the physical inspection (signed at the car, from the link or in the portal, or the paper form uploaded). Do the physical inspection with the customer first.",
};
