/**
 * parts-eta-alerts.js — Step 6, materials: when a part is not on the shelf
 * the Store records the expected arrival date, and the floor is alerted
 * 24 hours before that date. Runs hourly; each line is alerted once per
 * expected date (a new date clears eta_alerted_at, see routes/workflow.js).
 * After the alert the line stays "not available" until the Store re-checks
 * it — the "return to the Store availability check" of the process chart.
 */
import cron from 'node-cron';
import { query, execute } from './database.js';
import { notifyGroups, notifyMechanic, FLOOR } from './workflow.js';

let task = null;

export async function runPartsEtaAlerts() {
  const due = await query(
    `SELECT i.id, i.description, i.quantity_requested, i.expected_date, r.workshop_id, r.req_number,
            jc.id AS job_card_id, jc.job_card_number, jc.mechanic_id, wo.id AS work_order_id, wo.work_order_number
       FROM material_requisition_items i
       JOIN material_requisitions r ON r.id = i.requisition_id
       JOIN job_cards jc ON jc.id = r.job_card_id
       JOIN work_orders wo ON wo.id = jc.work_order_id
      WHERE i.availability = 'not_available' AND i.status NOT IN ('issued','cancelled','returned')
        AND i.expected_date IS NOT NULL AND i.eta_alerted_at IS NULL
        AND i.expected_date <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        AND wo.status NOT IN ('completed','cancelled')`
  );
  for (const p of due) {
    const date = p.expected_date instanceof Date ? p.expected_date.toISOString().slice(0, 10) : String(p.expected_date).slice(0, 10);
    const body = `${Number(p.quantity_requested)} × ${p.description} for ${p.job_card_number} is expected ${date}. Plan the bay and technician; the Store re-checks on arrival.`;
    await notifyGroups(p.workshop_id, [...FLOOR, 'storekeeper'], {
      title: `Part arriving within 24 h: ${p.work_order_number}`, body,
      link: `/work-orders/${p.work_order_id}`, orderId: p.work_order_id, icon: '🚚', type: `workflow_part_eta_alert_${p.id}`,
    });
    if (p.mechanic_id) {
      await notifyMechanic(p.workshop_id, p.mechanic_id, {
        title: `Part arriving within 24 h: ${p.work_order_number}`, body,
        jobCardId: p.job_card_id, orderId: p.work_order_id, type: `workflow_part_eta_alert_${p.id}`,
      });
    }
    await execute('UPDATE material_requisition_items SET eta_alerted_at = NOW() WHERE id = ?', [p.id]);
  }
  return due.length;
}

export function startPartsEtaAlerts() {
  if (task) return;
  task = cron.schedule('5 * * * *', () => {
    runPartsEtaAlerts().catch(err => console.error('[PartsETA] run failed:', err.message));
  }, { timezone: 'Asia/Dubai' });
}
