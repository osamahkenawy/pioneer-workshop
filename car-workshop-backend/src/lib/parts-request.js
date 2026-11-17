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
 *
 * The boards ask for many jobs at once (partsRequestStatus) and the Request
 * parts dialog starts from the approved parts lines (approvedPartsLines) —
 * client feedback, 16 Nov 2026, point 5: "no option to request for parts from
 * the Job assignment screen or Team board screen".
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

/**
 * The same rule for many work orders at once (the boards):
 * Map work order id → { needed, parts, requisitions, main_job_card_id }.
 */
export async function partsRequestStatus(workOrderIds, workshopId) {
  const ids = [...new Set((workOrderIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await query(
    `SELECT wo.id,
            (SELECT jc.id FROM job_cards jc
              WHERE jc.work_order_id = wo.id AND jc.parent_job_card_id IS NULL AND jc.status <> 'cancelled'
              ORDER BY jc.id LIMIT 1) AS main_job_card_id,
            (SELECT COUNT(*) FROM work_order_items i WHERE i.work_order_id = wo.id AND i.item_type = 'parts') AS parts,
            (SELECT COUNT(*) FROM material_requisitions r JOIN job_cards jc ON jc.id = r.job_card_id
              WHERE jc.work_order_id = wo.id AND r.status <> 'cancelled') AS mrns
       FROM work_orders wo WHERE wo.workshop_id = ? AND wo.id IN (?)`,
    [workshopId, ids]);
  return new Map(rows.map(r => [r.id, {
    needed: !!r.main_job_card_id && Number(r.parts) > 0 && !Number(r.mrns),
    parts: Number(r.parts), requisitions: Number(r.mrns), main_job_card_id: r.main_job_card_id || null,
  }]));
}

/** The part number of the category the customer approved, else the line's own. */
function partNumberOf(l) {
  const byOption = { genuine: l.genuine_part_number, after_market: l.aftermarket_part_number, used: l.used_part_number }[l.part_option];
  return String(byOption || l.part_number || '').trim() || null;
}

/**
 * What the Request parts dialog starts from: the approved parts lines
 * (work_order_items of type parts) with their estimate line's job and part
 * number, the main job card the requisition goes on, and the requisitions
 * already raised on the job (each line marked `requested` when an open
 * requisition already carries a part of that name).
 */
export async function approvedPartsLines(workOrderId, workshopId) {
  const [wo] = await query('SELECT id, work_order_number, status FROM work_orders WHERE id = ? AND workshop_id = ?', [workOrderId, workshopId]);
  if (!wo) return null;
  const [lines, [main], reqs] = await Promise.all([
    query(
      `SELECT i.id, i.name, i.quantity, i.job_card_id, el.job_name, el.part_number, el.part_option,
              el.genuine_part_number, el.aftermarket_part_number, el.used_part_number
         FROM work_order_items i LEFT JOIN estimate_lines el ON el.id = i.estimate_line_id
        WHERE i.work_order_id = ? AND i.item_type = 'parts'
        ORDER BY i.id`, [wo.id]),
    query(
      `SELECT id, job_card_number, status FROM job_cards
        WHERE work_order_id = ? AND workshop_id = ? AND parent_job_card_id IS NULL AND status <> 'cancelled'
        ORDER BY id LIMIT 1`, [wo.id, workshopId]),
    query(
      `SELECT r.id, r.req_number, r.status, r.created_at, jc.job_card_number,
              GROUP_CONCAT(LOWER(TRIM(ri.description)) SEPARATOR '\n') AS names, COUNT(ri.id) AS items
         FROM material_requisitions r
         JOIN job_cards jc ON jc.id = r.job_card_id
         LEFT JOIN material_requisition_items ri ON ri.requisition_id = r.id AND ri.status <> 'cancelled'
        WHERE jc.work_order_id = ? AND r.workshop_id = ? AND r.status <> 'cancelled'
        GROUP BY r.id ORDER BY r.id`, [wo.id, workshopId]),
  ]);
  const requested = new Set(reqs.flatMap(r => String(r.names || '').split('\n').filter(Boolean)));
  return {
    work_order: { id: wo.id, work_order_number: wo.work_order_number, status: wo.status },
    job_card: main ? { id: main.id, job_card_number: main.job_card_number, status: main.status } : null,
    lines: lines.map(l => {
      const name = String(l.name || '').trim();
      const partNumber = partNumberOf(l);
      // The approved line reads "Brake pads (After-Market · P/N 123)": the
      // part number has its own column on the requisition.
      const description = partNumber ? name.split(` · P/N ${partNumber}`).join('') : name;
      return {
        item_id: l.id, description, part_number: partNumber,
        quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1, job_name: l.job_name || null,
        requested: requested.has(name.toLowerCase()) || requested.has(description.toLowerCase()),
      };
    }),
    requisitions: reqs.map(r => ({
      id: r.id, req_number: r.req_number, status: r.status, created_at: r.created_at,
      job_card_number: r.job_card_number, items: Number(r.items),
    })),
  };
}
