/**
 * ═══════════════════════════════════════════════════════════════════
 *  Vehicle inspection — the customer's link (no login)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Sent from POST /api/vehicle-inspections/:id/share by WhatsApp or e-mail once
 * the walk-around is completed. The customer sees what was recorded at the car
 * — the damage marked on the diagram and the photos, or the uploaded paper
 * form — and, if they did not sign at the car, signs here (once). Signing the
 * physical inspection (drop-off) is their acknowledgement of the vehicle's
 * condition: it opens an external customer's job card (lib/physical-inspection.js).
 *
 * Anonymous: anyone holding the link can open it, and links get forwarded. So
 * nothing here carries the customer's phone or e-mail, prices, or staff names,
 * and the VIN is cut to its last six characters. Rate-limited by
 * inspectionLinkLimiter (lib/rate-limits.js); the 256-bit token is what stops
 * guessing. A cancelled job's link closes (410); staff can also replace a link
 * that went to the wrong chat (POST /api/vehicle-inspections/:id/share/reset).
 */
import express from 'express';
import { query, execute } from '../lib/database.js';
import { inspectionLinkLimiter } from '../lib/rate-limits.js';
import { createInAppNotification } from '../lib/notify.js';
import { notifyGroups } from '../lib/workflow.js';
import { openJobCardIfReady } from '../lib/physical-inspection.js';
import { saveBase64Signature } from './uploads.js';
import { DAMAGE_CODES, readDocs, readPhotos, sendDocument, signatureError, cleanName } from './vehicle-inspections.js';
import { IMAGE_COORD } from '../lib/inspection-marks.js';

const router = express.Router();
router.use(inspectionLinkLimiter);

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

// The paper form's pages, when that is how the inspection was recorded. Files
// left over from switching to the on-screen form are not the customer's copy.
const docsOf = row => (row.entry_mode === 'document' ? readDocs(row) : []);
// The vehicle photos, taken with the on-screen form.
export const photosOf = row => (row.entry_mode === 'document' ? [] : readPhotos(row));

async function loadByToken(token, res) {
  const [row] = TOKEN_RE.test(token || '') ? await query(
    `SELECT vi.*, wo.work_order_number, wo.status AS wo_status,
            w.name AS workshop_name, w.phone AS workshop_phone, w.logo_url AS workshop_logo, w.settings AS workshop_settings
       FROM vehicle_inspections vi
       JOIN work_orders wo ON wo.id = vi.work_order_id AND wo.workshop_id = vi.workshop_id
       JOIN workshops w ON w.id = vi.workshop_id
      WHERE vi.share_token = ?`,
    [token]
  ) : [];
  if (!row) { res.status(404).json({ success: false, message: 'This link is not valid.' }); return null; }
  if (row.wo_status === 'cancelled') {
    res.status(410).json({ success: false, code: 'CANCELLED', message: 'This job was cancelled, so the inspection is no longer available here. Please contact the workshop.' });
    return null;
  }
  return row;
}

// Signed on the paper form when it was uploaded instead; once a job is
// closed its inspection is no longer signed from the link.
const canSign = row => row.entry_mode !== 'document' && !row.signature_url
  && row.status === 'completed' && row.wo_status !== 'completed';

const signatureOf = row => ({
  signed: !!row.signature_url,
  signed_at: row.signed_at || null,
  signed_via: row.signed_via || null,
  signed_by_name: row.signed_by_name || null,
  image_url: row.signature_url || null,
});

/** What the customer's page gets — built from loadByToken's row, and nothing else of it. */
export function publicView(row) {
  let settings = row.workshop_settings;
  if (typeof settings === 'string') { try { settings = JSON.parse(settings); } catch { settings = {}; } }
  let marks = row.marks;
  if (typeof marks === 'string') { try { marks = JSON.parse(marks); } catch { marks = []; } }

  return {
    workshop: {
      name: settings?.company_name || row.workshop_name,
      phone: row.workshop_phone || null,
      logo_url: row.workshop_logo || null,
    },
    inspection: {
      type: row.inspection_type,
      work_order_number: row.work_order_number,
      completed_at: row.completed_at,
      entry_mode: row.entry_mode,
      vehicle: {
        make: row.vehicle_make, model: row.vehicle_model, year: row.vehicle_year, plate: row.plate_number,
        vin_last6: row.vin ? String(row.vin).slice(-6) : null,
      },
      odometer: row.odometer,
      // coord 'img': x/y on the car picture; none: an older marker, on the staff form's box.
      marks: (Array.isArray(marks) ? marks : []).map(m => ({
        id: m.id, view: m.view, code: m.code, label: DAMAGE_CODES[m.code] || m.code, x: m.x, y: m.y,
        ...(m.coord === IMAGE_COORD ? { coord: IMAGE_COORD } : {}),
        note: m.note || '',
      })),
      service_recommended: row.service_recommended,
      notes: row.notes,
      documents: docsOf(row).map(d => ({ id: d.id, name: d.name, type: d.type })),
      photos: photosOf(row).map(p => ({ id: p.id, name: p.name, type: p.type })),
      signature: signatureOf(row),
      can_sign: canSign(row),
      job_closed: row.wo_status === 'completed',
    },
  };
}

// GET /api/public/inspections/:token — the customer's read-only copy.
router.get('/:token', async (req, res) => {
  try {
    const row = await loadByToken(req.params.token, res);
    if (!row) return;
    res.json({ success: true, ...publicView(row) });
  } catch (err) {
    console.error('GET /public/inspections/:token error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the inspection' });
  }
});

// GET /api/public/inspections/:token/documents/:docId — a page of the uploaded paper form.
router.get('/:token/documents/:docId', async (req, res) => {
  try {
    const row = await loadByToken(req.params.token, res);
    if (!row) return;
    return sendDocument(res, docsOf(row).find(d => d.id === req.params.docId));
  } catch (err) {
    console.error('GET /public/inspections/:token/documents/:docId error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the document' });
  }
});

// GET /api/public/inspections/:token/photos/:photoId — a vehicle photo.
router.get('/:token/photos/:photoId', async (req, res) => {
  try {
    const row = await loadByToken(req.params.token, res);
    if (!row) return;
    return sendDocument(res, photosOf(row).find(p => p.id === req.params.photoId));
  } catch (err) {
    console.error('GET /public/inspections/:token/photos/:photoId error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the photo' });
  }
});

/**
 * POST /api/public/inspections/:token/sign — the customer's sign-off from the link.
 * Body: { signature: "data:image/png;base64,...", name: "Full name" }
 * Once only: a signed inspection (at the car or here) is never re-signed.
 */
router.post('/:token/sign', async (req, res) => {
  try {
    const row = await loadByToken(req.params.token, res);
    if (!row) return;
    if (row.signature_url) {
      return res.status(409).json({ success: false, code: 'ALREADY_SIGNED', message: 'This inspection has already been signed.', signature: signatureOf(row) });
    }
    if (row.entry_mode === 'document') {
      return res.status(409).json({ success: false, code: 'PAPER_FORM', message: 'This inspection was signed on the paper form at the workshop.' });
    }
    if (!canSign(row)) {
      return res.status(409).json({ success: false, code: 'JOB_CLOSED', message: 'This job is closed, so the inspection can no longer be signed here. Please contact the workshop.' });
    }

    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ success: false, code: 'NAME_REQUIRED', message: 'Please type your name.' });
    if (name.length > 150) return res.status(400).json({ success: false, message: 'Your name can be up to 150 characters.' });
    const bad = signatureError(req.body?.signature);
    if (bad) return res.status(400).json({ success: false, message: bad });

    const url = await saveBase64Signature(req.body.signature, `insp${row.id}`);
    // Staff may be capturing it at the car at the same moment — first one wins;
    // and a link replaced meanwhile no longer signs.
    const result = await execute(
      `UPDATE vehicle_inspections
          SET signature_url = ?, signed_at = NOW(), signed_via = 'link', signed_by_name = ?
        WHERE id = ? AND share_token = ? AND signature_url IS NULL`,
      [url, name, row.id, req.params.token]
    );
    if (!result.affectedRows) {
      return res.status(409).json({ success: false, code: 'ALREADY_SIGNED', message: 'This inspection has already been signed.' });
    }

    // The drop-off inspection acknowledged: an external customer's job card opens.
    const jobCard = await openPhysicalJobCard(row);
    await notifySigned(row, name, jobCard);
    const [signed] = await query('SELECT signature_url, signed_at, signed_via, signed_by_name FROM vehicle_inspections WHERE id = ?', [row.id]);
    res.json({ success: true, signature: signatureOf(signed) });
  } catch (err) {
    console.error('POST /public/inspections/:token/sign error:', err);
    res.status(500).json({ success: false, message: 'Failed to save your signature' });
  }
});

/**
 * The customer signed the physical inspection (drop-off): open the job's main
 * job card if that was what it waited for (the floor is told). Returns the
 * card when one is open, else null. Never throws — the signature is saved.
 * Shared with the customer portal's sign-off.
 */
export async function openPhysicalJobCard(row) {
  if (row.inspection_type !== 'intake') return null;
  try {
    const r = await openJobCardIfReady({ workOrderId: row.work_order_id, workshopId: row.workshop_id });
    return r.opened ? { ...r.jobCard, opened_now: r.reason === null } : null;
  } catch (err) {
    console.error('[PublicInspections] job card after signing failed:', err.message);
    return null;
  }
}

/** Nobody at the workshop sees this land, so tell whoever did the walk-around
 *  and the job's estimate advisor through the in-app feed — the Service
 *  Advisors as a group when neither is known. */
async function notifySigned(row, name, jobCard = null) {
  try {
    const handover = row.inspection_type === 'joint';
    const payload = {
      title: `Inspection signed by the customer: ${row.work_order_number}`,
      body: `${name} signed the ${handover ? 'handover' : 'physical'} inspection from the link.`
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
    console.error('[PublicInspections] signed notification failed:', err.message);
  }
}

export default router;
