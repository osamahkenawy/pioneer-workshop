/**
 * parts-request.js — the parts come before the technician (client meeting,
 * 3 Nov 2026, point 18): whoever assigns a technician first requests the
 * job's parts from the Store with a material requisition (MRN, POST
 * /api/job-cards/:id/requisitions).
 *
 * Needed when the approved work has parts (work_order_items of type parts) and
 * no requisition has been raised on any of the job's job cards; labour-only
 * work needs none. Jobs without a main job card (imported history) are left
 * alone. Every assignment path asks this before it writes.
 */
import { query } from './database.js';

export const MRN_REQUIRED = 'MRN_REQUIRED';

/** null when the job may be assigned, else { code, message } for a 409. */
export async function partsRequestMissing({ workOrderId, workshopId, q = query }) {
  const [row] = await q(
    `SELECT wo.work_order_number,
            (SELECT COUNT(*) FROM job_cards jc
              WHERE jc.work_order_id = wo.id AND jc.parent_job_card_id IS NULL AND jc.status <> 'cancelled') AS cards,
            (SELECT COUNT(*) FROM work_order_items i WHERE i.work_order_id = wo.id AND i.item_type = 'parts') AS parts,
            (SELECT COUNT(*) FROM material_requisitions r JOIN job_cards jc ON jc.id = r.job_card_id
              WHERE jc.work_order_id = wo.id AND r.status <> 'cancelled') AS mrns
       FROM work_orders wo WHERE wo.id = ? AND wo.workshop_id = ?`,
    [workOrderId, workshopId]
  );
  if (!row || !Number(row.cards) || !Number(row.parts) || Number(row.mrns)) return null;
  return {
    code: MRN_REQUIRED,
    message: `${row.work_order_number}'s approved work has parts — request them from the Store with a material requisition (MRN) first, then assign the technician.`,
  };
}
