/**
 * ═══════════════════════════════════════════════════════════════════
 *  Technical report — the customer's link (no login)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Sent from POST /api/technical-inspections/:id/share by WhatsApp or e-mail
 * once the Supervisor / Workshop Foreman has completed the technical
 * inspection (Step 4; client meeting, 3 Nov 2026). The customer sees only
 * what is to be done: each job / service, its service type, the labour and
 * the parts' names. No hours, quantities, part numbers, notes or findings —
 * and there are no prices on it (they come with the estimate).
 *
 * Anonymous, like the inspection link (public-inspections.js): anyone holding
 * the link can open it, and links get forwarded. So nothing here carries the
 * customer's name, phone or e-mail, or staff names, and the VIN is cut to its
 * last six characters. Rate-limited by inspectionLinkLimiter
 * (lib/rate-limits.js); the 256-bit token is what stops guessing. A cancelled
 * job's link closes (410); a report reopened for changes answers 409
 * (REPORT_UPDATING) until it is completed again; staff can replace a link
 * that went to the wrong chat (POST /api/technical-inspections/:id/share/reset).
 *
 * customerReportView is also the customer portal's view of the report
 * (routes/customer-portal.js GET /work-orders/:id, technical_report).
 */
import express from 'express';
import { query } from '../lib/database.js';
import { inspectionLinkLimiter } from '../lib/rate-limits.js';
import { JOB_TYPES } from '../lib/intake-rules.js';

const router = express.Router();
router.use(inspectionLinkLimiter);

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

const REPORT_SELECT = `
  SELECT ti.id, ti.work_order_id, ti.status, ti.service_lines, ti.completed_at,
         wo.work_order_number, wo.status AS wo_status,
         v.make, v.model, v.year, v.plate_number, v.vin,
         w.name AS workshop_name, w.phone AS workshop_phone, w.logo_url AS workshop_logo, w.settings AS workshop_settings
    FROM technical_inspections ti
    JOIN work_orders wo ON wo.id = ti.work_order_id AND wo.workshop_id = ti.workshop_id
    LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    JOIN workshops w ON w.id = ti.workshop_id`;

const parseJson = (v, fallback) => {
  if (typeof v !== 'string') return v ?? fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};

/**
 * What the customer gets of a report — built from a REPORT_SELECT row, and
 * nothing else of it. Each line: the job, its service type (key and name),
 * the labour, and the parts by name only.
 */
export function customerReportView(row) {
  const settings = parseJson(row.workshop_settings, {}) || {};
  const lines = parseJson(row.service_lines, []);
  return {
    workshop: {
      name: settings.company_name || row.workshop_name,
      phone: row.workshop_phone || null,
      logo_url: row.workshop_logo || null,
    },
    report: {
      work_order_number: row.work_order_number,
      completed_at: row.completed_at,
      vehicle: {
        make: row.make || null, model: row.model || null, year: row.year || null, plate: row.plate_number || null,
        vin_last6: row.vin ? String(row.vin).slice(-6) : null,
      },
      lines: (Array.isArray(lines) ? lines : []).map(l => ({
        job: l?.job || '',
        service_type: l?.service_type || null,
        service_type_label: JOB_TYPES[l?.service_type] || null,
        labour: l?.labour || null,
        parts: (Array.isArray(l?.parts) ? l.parts : []).map(p => p?.description).filter(Boolean).map(name => ({ name })),
      })),
    },
  };
}

/** The completed report of a customer's own job, as the portal shows it (null when there is none to show). */
export async function customerTechnicalReport(workOrderId, workshopId) {
  const [row] = await query(
    `${REPORT_SELECT} WHERE ti.work_order_id = ? AND ti.workshop_id = ? AND ti.status = 'completed' AND wo.status <> 'cancelled'`,
    [workOrderId, workshopId]);
  if (!row) return null;
  const { report } = customerReportView(row);
  return { id: row.id, ...report };
}

// GET /api/public/technical-reports/:token — the customer's copy of the report.
router.get('/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const [row] = TOKEN_RE.test(token || '') ? await query(`${REPORT_SELECT} WHERE ti.share_token = ?`, [token]) : [];
    if (!row) return res.status(404).json({ success: false, message: 'This link is not valid.' });
    if (row.wo_status === 'cancelled') {
      return res.status(410).json({ success: false, code: 'CANCELLED', message: 'This job was cancelled, so the report is no longer available here. Please contact the workshop.' });
    }
    if (row.status !== 'completed') {
      const { workshop } = customerReportView(row);
      return res.status(409).json({ success: false, code: 'REPORT_UPDATING', workshop,
        message: 'The workshop is updating this report. Please check again later.' });
    }
    res.json({ success: true, ...customerReportView(row) });
  } catch (err) {
    console.error('GET /public/technical-reports/:token error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the report' });
  }
});

export default router;
