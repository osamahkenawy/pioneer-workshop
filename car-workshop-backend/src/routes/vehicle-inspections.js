import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { saveBase64Signature } from './uploads.js';
import { validateUpload, DOC_KINDS, sniffKind } from '../lib/file-validate.js';
import { stripMarkup } from '../lib/sanitize.js';
import { sendNotificationEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit.js';
import { can } from '../lib/roles.js';
import { isTechnician } from '../lib/access.js';
import { customerAppBase } from '../lib/customer-link.js';
import { woLabel } from '../lib/status-labels.js';
import { IMAGE_COORD, DAMAGE_CODES } from '../lib/inspection-marks.js';

/* The paper inspection form, uploaded instead of (or as well as) filling it
 * in on screen: scans, photos of the pages or a PDF. Kept out of the public
 * uploads folder — they carry the customer's details — and read back through
 * GET /:id/documents/:docId with the staff login, or from the customer's link
 * (public-inspections.js). */
export const DOCS_DIR = path.resolve('private-uploads', 'inspections');
fs.mkdirSync(DOCS_DIR, { recursive: true });
const MAX_DOCS = 10;
const DOC_MIME = { pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const docUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DOCS_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: MAX_DOCS },
  fileFilter: (_req, file, cb) => (/\.(pdf|jpe?g|png|webp)$/i.test(file.originalname)
    ? cb(null, true) : cb(new Error('Upload a PDF or a photo (JPG, PNG, WEBP).'))),
});

/**
 * ═══════════════════════════════════════════════════════════════════
 *  Vehicle Inspection Form — the walk-around damage check
 * ═══════════════════════════════════════════════════════════════════
 *
 * Backs the visual inspection form: a car diagram the inspector clicks to
 * drop damage markers (legend codes: DS deep scratch, DD dents/dings, ...),
 * done with the customer present at intake (Step 4, the technical
 * inspection) and again at handover (Step 7).
 *
 * Markers are stored in `vehicle_inspections.marks` as JSON —
 *   [{ id, view: top|left|right|front|rear, code, x: 0..1, y: 0..1, coord?: 'img', note }]
 * — x/y normalised. With coord 'img' (every marker placed since 2026-10) they
 * are relative to the car picture, so they land on the same spot of the car
 * at any size: the staff form, its print-out, the customer's link and the job
 * sheet PDF. Without it (older markers) they are relative to the staff form's
 * view box, and are drawn as they always were. The geometry is in
 * lib/inspection-marks.js and the front end's lib/inspectionMarks.js.
 *
 * Completing an intake inspection stamps work_orders.intake_inspection_at, and
 * a joint inspection stamps joint_inspection_at, so the Customer Journey
 * checklist on the work order stays in sync without a second manual step.
 *
 * The walk-around ends with the customer's sign-off: on the screen at the car,
 * or — when they could not stay — from the link POST /:id/share sends them
 * (the customer's page is public-inspections.js). The link is their copy
 * either way.
 */

const router = express.Router();
router.use(authMiddleware);
// The walk-around is the Service Advisor's (Step 4): it carries the
// customer's contact details and can be completed, signed, shared and
// deleted. Technicians work from My Jobs and never reach it.
router.use((req, res, next) => (isTechnician(req.user)
  ? res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'The vehicle inspection is done by the Service Advisor.' })
  : next()));

const VIEWS = ['top', 'left', 'right', 'front', 'rear'];
// The walk-arounds done with the customer; 'qc' is the workshop's own check.
const CUSTOMER_FACING = ['intake', 'joint'];
const SHARE_CHANNELS = ['whatsapp', 'email', 'link'];

const SIGNATURE_REQUIRED_MSG = "The customer hasn't signed yet. Ask them to sign above — or, if they aren't here, tick “Customer not present” and send them the link to sign.";

const toFlag = v => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
// A signer's name: markup and runs of whitespace dropped; the caller checks the length.
export const cleanName = v => (stripMarkup(typeof v === 'string' ? v : '', 1000) || '').replace(/\s+/g, ' ').trim();

/* A signature as drawn on a pad is a PNG (or JPEG) of a few KB. The cap and
 * the content check keep the public sign route from being a way to park
 * arbitrary files in the uploads folder. Returns what is wrong, or null. */
const SIGNATURE_MAX_BYTES = 500 * 1024;
export function signatureError(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > SIGNATURE_MAX_BYTES * 1.4 + 64) {
    return typeof dataUrl === 'string' ? 'The signature image is too large.' : 'A signature image is required.';
  }
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return 'The signature must be a PNG or JPEG image.';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > SIGNATURE_MAX_BYTES) return 'The signature image is too large.';
  if (sniffKind(buf) !== m[1]) return 'The signature must be a PNG or JPEG image.';
  return null;
}

/** The customer's link to the inspection — on the same customer site as the
 *  status page (lib/customer-link.js: never a localhost address in production). */
export function inspectionLinkUrl(token) {
  return `${customerAppBase()}/inspection/${token}`;
}

// Damage legend (lib/inspection-marks.js), re-exported for public-inspections.js.
export { DAMAGE_CODES };

// Keeps a stray click or a malformed payload from being persisted: anything
// that isn't a known code / known view / in-range coordinate is dropped rather
// than stored, since a marker with a bad view or x=1e9 renders nowhere.
// `coord` survives only as 'img' (relative to the car picture); any other
// value means an older, box-relative marker and is left off.
function sanitizeMarks(marks) {
  if (!Array.isArray(marks)) return [];
  return marks
    .filter(m => m && VIEWS.includes(m.view) && DAMAGE_CODES[m.code])
    .map((m, i) => ({
      id: String(m.id || `m${i + 1}`).slice(0, 40),
      view: m.view,
      code: m.code,
      x: Math.min(1, Math.max(0, Number(m.x) || 0)),
      y: Math.min(1, Math.max(0, Number(m.y) || 0)),
      ...(m.coord === IMAGE_COORD ? { coord: IMAGE_COORD } : {}),
      note: (m.note || '').toString().slice(0, 500),
    }))
    .slice(0, 500);
}

function parseMarks(row) {
  if (!row) return row;
  if (typeof row.marks === 'string') {
    try { row.marks = JSON.parse(row.marks); } catch { row.marks = []; }
  }
  row.marks = row.marks || [];
  // Uploaded documents: what the screen needs, never the file's place on disk.
  row.documents = readDocs(row).map(({ file, ...d }) => d);
  // The customer's link is handed out by GET / POST /:id/share, to the roles that send it.
  delete row.share_token;
  return row;
}

// GET /api/vehicle-inspections/codes — the damage legend (single source of truth)
router.get('/codes', (req, res) => {
  return res.json({ success: true, data: DAMAGE_CODES });
});

// GET /api/vehicle-inspections?work_order_id=&status=&type=
router.get('/', async (req, res) => {
  try {
    const { work_order_id, status, type } = req.query;
    const params = [req.workshopId];
    let where = 'WHERE vi.workshop_id = ?';
    if (work_order_id) { where += ' AND vi.work_order_id = ?'; params.push(work_order_id); }
    if (status)        { where += ' AND vi.status = ?';        params.push(status); }
    if (type)          { where += ' AND vi.inspection_type = ?'; params.push(type); }

    const rows = await query(
      `SELECT vi.*, wo.work_order_number
         FROM vehicle_inspections vi
         LEFT JOIN work_orders wo ON wo.id = vi.work_order_id
         ${where}
        ORDER BY vi.created_at DESC
        LIMIT 200`,
      params
    );
    return res.json({ success: true, data: rows.map(parseMarks) });
  } catch (err) {
    console.error('[VehicleInspections] List error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load inspections' });
  }
});

// GET /api/vehicle-inspections/:id
router.get('/:id', async (req, res) => {
  try {
    const [row] = await query(
      `SELECT vi.*, wo.work_order_number
         FROM vehicle_inspections vi
         LEFT JOIN work_orders wo ON wo.id = vi.work_order_id
        WHERE vi.id = ? AND vi.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    return res.json({ success: true, data: parseMarks(row) });
  } catch (err) {
    console.error('[VehicleInspections] Get error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load inspection' });
  }
});

/**
 * POST /api/vehicle-inspections — start an inspection for a work order.
 *
 * The header fields are pre-filled from the work order + its vehicle/customer
 * so the inspector isn't retyping the plate and VIN at the car; anything passed
 * in the body wins over the pre-fill.
 */
router.post('/', async (req, res) => {
  try {
    const { work_order_id, inspection_type = 'intake', job_card_id = null } = req.body;
    if (!work_order_id) {
      return res.status(400).json({ success: false, message: 'work_order_id is required' });
    }
    if (!['intake', 'joint', 'qc'].includes(inspection_type)) {
      return res.status(400).json({ success: false, message: 'Invalid inspection_type' });
    }

    const [wo] = await query(
      `SELECT wo.*, v.year AS v_year, v.make AS v_make, v.model AS v_model,
              v.vin AS v_vin, v.plate_number AS v_plate, v.mileage AS v_mileage
         FROM work_orders wo
         LEFT JOIN vehicles v ON v.id = wo.vehicle_id
        WHERE wo.id = ? AND wo.workshop_id = ?`,
      [work_order_id, req.workshopId]
    );
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });

    // One inspection of a given type per work order — reopen the existing one
    // rather than creating duplicates if the page is opened twice. This check
    // alone isn't enough: React's dev StrictMode fires the effect twice, and
    // two concurrent requests both saw "none" and both inserted. A UNIQUE key
    // on (work_order_id, inspection_type) settles the race; the insert below
    // catches the duplicate-key error and returns the winner's row.
    const returnExisting = async () => {
      const [row] = await query(
        'SELECT * FROM vehicle_inspections WHERE work_order_id = ? AND inspection_type = ? AND workshop_id = ?',
        [work_order_id, inspection_type, req.workshopId]
      );
      return row ? res.json({ success: true, data: parseMarks(row), reused: true }) : null;
    };
    const [existing] = await query(
      'SELECT id FROM vehicle_inspections WHERE work_order_id = ? AND inspection_type = ? AND workshop_id = ?',
      [work_order_id, inspection_type, req.workshopId]
    );
    if (existing) return returnExisting();

    const b = req.body;
    const result = await execute(
      `INSERT INTO vehicle_inspections
         (workshop_id, work_order_id, job_card_id, vehicle_id, customer_id, inspection_type,
          estimate_date, original_estimate, customer_name, customer_phone, customer_email,
          vehicle_year, vehicle_make, vehicle_model, vin, plate_number, odometer,
          service_recommended, service_accepted, marks, notes, inspected_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        req.workshopId, work_order_id, job_card_id, wo.vehicle_id || null, wo.customer_id || null,
        inspection_type,
        b.estimate_date || new Date().toISOString().slice(0, 10),
        b.original_estimate ?? wo.service_fee ?? null,
        b.customer_name  ?? wo.customer_name  ?? null,
        b.customer_phone ?? wo.customer_phone ?? null,
        b.customer_email ?? wo.customer_email ?? null,
        b.vehicle_year   ?? (wo.v_year != null ? String(wo.v_year) : null),
        b.vehicle_make   ?? wo.v_make  ?? null,
        b.vehicle_model  ?? wo.v_model ?? null,
        b.vin            ?? wo.v_vin   ?? null,
        b.plate_number   ?? wo.v_plate ?? null,
        b.odometer       ?? wo.v_mileage ?? null,
        b.service_recommended ?? wo.description ?? null,
        b.service_accepted ?? null,
        JSON.stringify(sanitizeMarks(b.marks)),
        b.notes || null,
        req.user.id,
      ]
    );

    const [row] = await query('SELECT * FROM vehicle_inspections WHERE id = ?', [result.insertId]);
    return res.status(201).json({ success: true, data: parseMarks(row) });
  } catch (err) {
    // Lost the race against a concurrent create for the same work order and
    // type — hand back the row that won instead of failing the request.
    if (err.code === 'ER_DUP_ENTRY') {
      try {
        const { work_order_id, inspection_type = 'intake' } = req.body;
        const [row] = await query(
          'SELECT * FROM vehicle_inspections WHERE work_order_id = ? AND inspection_type = ? AND workshop_id = ?',
          [work_order_id, inspection_type, req.workshopId]
        );
        if (row) return res.json({ success: true, data: parseMarks(row), reused: true });
      } catch (_) { /* fall through to the 500 below */ }
    }
    console.error('[VehicleInspections] Create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create inspection' });
  }
});

// PUT /api/vehicle-inspections/:id — save the form (marks + header fields)
router.put('/:id', async (req, res) => {
  try {
    const [row] = await query(
      'SELECT id, status FROM vehicle_inspections WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    if (row.status === 'completed') return res.status(409).json({ success: false, message: 'This inspection is completed; it can no longer be changed.' });

    const editable = [
      'estimate_date', 'original_estimate', 'customer_name', 'customer_phone', 'customer_email',
      'vehicle_year', 'vehicle_make', 'vehicle_model', 'vin', 'plate_number', 'odometer',
      'service_recommended', 'service_accepted', 'notes', 'job_card_id',
    ];
    // Not signature_url: the signature is written only by PATCH /:id/signature
    // and the customer's link, which check the image and stamp signed_at / signed_via.
    const fields = [];
    const values = [];
    for (const f of editable) {
      if (req.body[f] !== undefined) { fields.push(`${f} = ?`); values.push(req.body[f] === '' ? null : req.body[f]); }
    }
    // Filled in on screen, or done on paper and uploaded.
    if (req.body.entry_mode !== undefined) {
      if (!['form', 'document'].includes(req.body.entry_mode)) return res.status(400).json({ success: false, message: 'entry_mode must be form or document' });
      fields.push('entry_mode = ?'); values.push(req.body.entry_mode);
    }
    if (req.body.marks !== undefined) {
      fields.push('marks = ?');
      values.push(JSON.stringify(sanitizeMarks(req.body.marks)));
    }
    // The signature card: who signs, or that the customer is not at the car
    // and will sign from the link.
    if (req.body.signed_by_name !== undefined) {
      const name = cleanName(req.body.signed_by_name);
      if (name.length > 150) return res.status(400).json({ success: false, message: 'The name can be up to 150 characters.' });
      fields.push('signed_by_name = ?'); values.push(name || null);
    }
    if (req.body.customer_present !== undefined) {
      fields.push('customer_present = ?'); values.push(toFlag(req.body.customer_present));
    }
    if (!fields.length) return res.status(400).json({ success: false, message: 'No fields to update' });

    values.push(req.params.id, req.workshopId);
    await execute(`UPDATE vehicle_inspections SET ${fields.join(', ')} WHERE id = ? AND workshop_id = ?`, values);

    const [updated] = await query('SELECT * FROM vehicle_inspections WHERE id = ?', [req.params.id]);
    return res.json({ success: true, data: parseMarks(updated) });
  } catch (err) {
    console.error('[VehicleInspections] Update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save inspection' });
  }
});

export function readDocs(row) {
  let d = row?.documents;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = []; } }
  return Array.isArray(d) ? d : [];
}

/** Stream one uploaded file — here with the staff login, and from the customer's link. */
export function sendDocument(res, doc) {
  if (!doc || !/^[\w.-]+$/.test(doc.file || '')) return res.status(404).json({ success: false, message: 'Document not found' });
  res.setHeader('Content-Type', doc.type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${String(doc.name).replace(/[^\w. -]/g, '_')}"`);
  return res.sendFile(path.join(DOCS_DIR, doc.file), err => {
    if (err && !res.headersSent) res.status(404).json({ success: false, message: 'Document not found' });
  });
}

/**
 * POST /api/vehicle-inspections/:id/documents — upload the paper inspection
 * form (multipart, field "files", up to 10 files of 15 MB: PDF, JPG, PNG,
 * WEBP). Content is checked, not just the extension.
 */
router.post('/:id/documents', (req, res, next) => docUpload.array('files', MAX_DOCS)(req, res, err => {
  if (err) return res.status(400).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'Each file can be up to 15 MB.' : err.message });
  next();
}), validateUpload(DOC_KINDS, { field: 'files' }), async (req, res) => {
  const files = req.files || [];
  const discard = () => Promise.all(files.map(f => fs.promises.unlink(f.path).catch(() => {})));
  try {
    if (!files.length) return res.status(400).json({ success: false, message: 'Choose a file to upload.' });
    const [row] = await query('SELECT id, status, documents FROM vehicle_inspections WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!row) { await discard(); return res.status(404).json({ success: false, message: 'Inspection not found' }); }
    if (row.status === 'completed') { await discard(); return res.status(409).json({ success: false, message: 'This inspection is completed; it can no longer be changed.' }); }
    const docs = readDocs(row);
    if (docs.length + files.length > MAX_DOCS) { await discard(); return res.status(400).json({ success: false, message: `Up to ${MAX_DOCS} files per inspection.` }); }
    for (const f of files) {
      docs.push({
        id: crypto.randomBytes(6).toString('hex'),
        name: String(f.originalname).slice(0, 200),
        type: DOC_MIME[f.detectedKind] || f.mimetype,
        size: f.size,
        file: path.basename(f.path),
        uploaded_at: new Date().toISOString(),
        uploaded_by: req.user?.id || null,
      });
    }
    await execute("UPDATE vehicle_inspections SET documents = ?, entry_mode = 'document' WHERE id = ? AND workshop_id = ?",
      [JSON.stringify(docs), row.id, req.workshopId]);
    const [updated] = await query('SELECT * FROM vehicle_inspections WHERE id = ?', [row.id]);
    return res.status(201).json({ success: true, data: parseMarks(updated) });
  } catch (err) {
    await discard();
    console.error('[VehicleInspections] Document upload error:', err);
    return res.status(500).json({ success: false, message: 'Failed to upload the document' });
  }
});

/** GET /api/vehicle-inspections/:id/documents/:docId — the file itself (staff login). */
router.get('/:id/documents/:docId', async (req, res) => {
  try {
    const [row] = await query('SELECT documents FROM vehicle_inspections WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    return sendDocument(res, readDocs(row).find(d => d.id === req.params.docId));
  } catch (err) {
    console.error('[VehicleInspections] Document read error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load the document' });
  }
});

/** DELETE /api/vehicle-inspections/:id/documents/:docId — remove an upload (not after completion). */
router.delete('/:id/documents/:docId', async (req, res) => {
  try {
    const [row] = await query('SELECT id, status, documents FROM vehicle_inspections WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    if (row.status === 'completed') return res.status(409).json({ success: false, message: 'This inspection is completed; it can no longer be changed.' });
    const docs = readDocs(row);
    const doc = docs.find(d => d.id === req.params.docId);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    await execute('UPDATE vehicle_inspections SET documents = ? WHERE id = ?', [JSON.stringify(docs.filter(d => d !== doc)), row.id]);
    if (/^[\w.-]+$/.test(doc.file || '')) await fs.promises.unlink(path.join(DOCS_DIR, doc.file)).catch(() => {});
    const [updated] = await query('SELECT * FROM vehicle_inspections WHERE id = ?', [row.id]);
    return res.json({ success: true, data: parseMarks(updated) });
  } catch (err) {
    console.error('[VehicleInspections] Document delete error:', err);
    return res.status(500).json({ success: false, message: 'Failed to remove the document' });
  }
});

/**
 * PATCH /api/vehicle-inspections/:id/complete — sign the inspection off.
 * Body (optional): { customer_present: false } — the customer is not at the car.
 * Also stamps the matching Customer Journey checkpoint on the work order.
 */
router.patch('/:id/complete', async (req, res) => {
  try {
    const [row] = await query(
      'SELECT * FROM vehicle_inspections WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    // A second call (a double click, a retry) changes nothing: completed_at and
    // inspected_by are on the customer's copy and decide who hears it was signed.
    if (row.status === 'completed') return res.json({ success: true, data: parseMarks(row), already_completed: true });
    if (row.entry_mode === 'document' && !readDocs(row).length) {
      return res.status(400).json({ success: false, code: 'DOCUMENT_REQUIRED', message: 'Upload the inspection form first (PDF or photos), or switch to filling it in on screen.' });
    }
    // Filled in on screen, the walk-around ends with the customer's signature
    // (the paper form carries its own). Unsigned only when the customer is not
    // at the car — they sign from the link instead (POST /:id/share).
    const customerPresent = req.body?.customer_present !== undefined ? toFlag(req.body.customer_present) : (row.customer_present ? 1 : 0);
    if (row.entry_mode !== 'document' && CUSTOMER_FACING.includes(row.inspection_type) && customerPresent && !row.signature_url) {
      return res.status(400).json({ success: false, code: 'SIGNATURE_REQUIRED', message: SIGNATURE_REQUIRED_MSG });
    }

    await execute(
      `UPDATE vehicle_inspections
          SET status = 'completed', completed_at = NOW(), inspected_by = ?, customer_present = ?
        WHERE id = ? AND workshop_id = ?`,
      [req.user.id, customerPresent, req.params.id, req.workshopId]
    );

    // Keep the work order's journey checklist in step with the inspection
    const journeyColumn = row.inspection_type === 'joint' ? 'joint_inspection_at'
                        : row.inspection_type === 'intake' ? 'intake_inspection_at'
                        : null;
    if (journeyColumn) {
      try {
        await execute(
          `UPDATE work_orders SET ${journeyColumn} = NOW()
            WHERE id = ? AND workshop_id = ? AND ${journeyColumn} IS NULL`,
          [row.work_order_id, req.workshopId]
        );
      } catch (e) {
        console.error('[VehicleInspections] Journey stamp failed:', e.message);
      }
    }

    // Auto-advance the work order's status now that a walk-around has been
    // signed off. Only nudges by one step and only from the safe states —
    // staff can still change it through the normal status controls.
    //  intake  : pending     \u2192 confirmed  ("Inspected": Step 4 signed off, on to pricing)
    //  joint   : in_progress \u2192 inspection ("Quality check", Step 7.1)
    // The log notes use the shared status words (lib/status-labels.js).
    try {
      if (row.inspection_type === 'intake') {
        const bump = await execute(
          `UPDATE work_orders
              SET status = 'confirmed'
            WHERE id = ? AND workshop_id = ? AND status = 'pending'`,
          [row.work_order_id, req.workshopId]
        );
        if (bump?.affectedRows > 0) {
          await execute(
            'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note, created_at) VALUES (?, ?, ?, ?, NOW())',
            [row.work_order_id, 'confirmed', req.user.id,
              `${woLabel('confirmed')} — intake inspection completed${customerPresent ? '' : ', customer signs from the link'}`]
          );
        }
      } else if (row.inspection_type === 'joint') {
        const bump = await execute(
          `UPDATE work_orders
              SET status = 'inspection'
            WHERE id = ? AND workshop_id = ? AND status = 'in_progress'`,
          [row.work_order_id, req.workshopId]
        );
        if (bump?.affectedRows > 0) {
          await execute(
            'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note, created_at) VALUES (?, ?, ?, ?, NOW())',
            [row.work_order_id, 'inspection', req.user.id, `${woLabel('inspection')} — handover walk-around signed off`]
          );
        }
      }
    } catch (e) {
      console.error('[VehicleInspections] Auto-status bump failed:', e.message);
    }

    const [updated] = await query('SELECT * FROM vehicle_inspections WHERE id = ?', [req.params.id]);
    return res.json({ success: true, data: parseMarks(updated) });
  } catch (err) {
    console.error('[VehicleInspections] Complete error:', err);
    return res.status(500).json({ success: false, message: 'Failed to complete inspection' });
  }
});

/**
 * PATCH /api/vehicle-inspections/:id/signature — customer sign-off at the car.
 * Body: { signature: "data:image/png;base64,...", name?: "who signed" }
 *
 * Stored against the inspection only. Deliberately does NOT touch
 * work_orders.signature_url, which is the completion/handover signature —
 * the walk-around sign-off is a different signature at a different moment.
 *
 * Before completion it can be redone. After completion it can still be
 * captured once, if the inspection was completed unsigned — never replaced.
 */
router.patch('/:id/signature', async (req, res) => {
  try {
    const { signature } = req.body;
    const bad = signatureError(signature);
    if (bad) return res.status(400).json({ success: false, message: bad });
    const name = cleanName(req.body.name);
    if (name.length > 150) return res.status(400).json({ success: false, message: 'The name can be up to 150 characters.' });
    const [row] = await query(
      'SELECT id, work_order_id, status, signature_url FROM vehicle_inspections WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    const locked = row.status === 'completed';
    if (locked && row.signature_url) {
      return res.status(409).json({ success: false, code: 'SIGNATURE_LOCKED', message: 'The customer has already signed this inspection.' });
    }

    const url = await saveBase64Signature(signature, `insp${row.id}`);
    // Completed: only if still unsigned — the customer may be signing from the link at the same moment.
    const result = await execute(
      `UPDATE vehicle_inspections
          SET signature_url = ?, signed_at = NOW(), signed_via = 'on_site', customer_present = 1,
              signed_by_name = COALESCE(?, signed_by_name)
        WHERE id = ? AND workshop_id = ?${locked ? ' AND signature_url IS NULL' : ''}`,
      [url, name || null, row.id, req.workshopId]);
    if (!result.affectedRows) {
      return res.status(409).json({ success: false, code: 'SIGNATURE_LOCKED', message: 'The customer has already signed this inspection.' });
    }

    const [updated] = await query('SELECT * FROM vehicle_inspections WHERE id = ?', [row.id]);
    return res.json({ success: true, url, data: parseMarks(updated) });
  } catch (err) {
    console.error('[VehicleInspections] Signature error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to save signature' });
  }
});

/* ── The customer's copy: a link by WhatsApp or e-mail ─────────────────── */

// Who the link goes to: the work order's customer, as on the job card.
async function loadForShare(id, workshopId) {
  const [row] = await query(
    `SELECT vi.*, wo.work_order_number, wo.status AS wo_status,
            TIMESTAMPDIFF(SECOND, vi.shared_at, NOW()) AS shared_secs_ago,
            COALESCE(NULLIF(wo.customer_email, ''), NULLIF(c.email, ''), NULLIF(vi.customer_email, '')) AS to_email,
            COALESCE(NULLIF(wo.customer_phone, ''), NULLIF(c.phone, ''), NULLIF(vi.customer_phone, '')) AS to_phone
       FROM vehicle_inspections vi
       JOIN work_orders wo ON wo.id = vi.work_order_id
       LEFT JOIN customers c ON c.id = wo.customer_id
      WHERE vi.id = ? AND vi.workshop_id = ?`,
    [id, workshopId]
  );
  return row;
}

/* wa.me wants the number in international form, digits only. Numbers on file
 * are often local ("050 123 4567") — those are the UAE's, as customers.js
 * normalizePhone reads them. */
const waDigits = (phone) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (/^0\d{8,9}$/.test(d)) d = '971' + d.slice(1);
  if (/^9710\d{8,9}$/.test(d)) d = '971' + d.slice(4);   // +971 050…, trunk zero kept
  return d.length >= 8 ? d : '';
};

/** Who sends the customer their copy: the advisor's desk (estimates, handover), managers, or whoever did the walk-around. */
const canSend = (user, row) => can(user, 'estimate.raise') || can(user, 'delivery.handover') || (!!user && row.inspected_by === user.id);
const NOT_ALLOWED = { success: false, code: 'ROLE_NOT_ALLOWED', message: "Your role can't send the inspection to the customer — ask the Service Advisor." };

/** GET /api/vehicle-inspections/:id/share — where the link stands, and which channels can reach the customer. */
router.get('/:id/share', async (req, res) => {
  try {
    const row = await loadForShare(req.params.id, req.workshopId);
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    const canShare = canSend(req.user, row);
    return res.json({
      success: true,
      data: {
        url: row.share_token && canShare ? inspectionLinkUrl(row.share_token) : null,
        shared_at: row.shared_at, shared_via: row.shared_via,
        can_send: canShare,
        can_email: !!row.to_email, can_whatsapp: !!waDigits(row.to_phone),
        work_order_cancelled: row.wo_status === 'cancelled',
        // Closed at pickup: the link stays as their copy but is no longer signed there.
        job_closed: row.wo_status === 'completed',
      },
    });
  } catch (err) {
    console.error('[VehicleInspections] Share status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load the link' });
  }
});

/**
 * POST /api/vehicle-inspections/:id/share — send the customer their copy.
 * Body: { channel: 'whatsapp' | 'email' | 'link' }
 *
 * Completed inspections only. The link is made the first time and reused, so
 * every message the customer gets opens the same page. 'whatsapp' returns a
 * wa.me link for the screen to open (the message is sent from the advisor's
 * WhatsApp); 'email' sends it from here; 'link' is the copy button.
 * Sent by the advisor's desk, a manager or whoever did the walk-around
 * (canSend); the same e-mail is not sent twice within a minute.
 */
router.post('/:id/share', async (req, res) => {
  try {
    const channel = req.body?.channel;
    if (!SHARE_CHANNELS.includes(channel)) {
      return res.status(400).json({ success: false, message: 'channel must be whatsapp, email or link' });
    }
    const row = await loadForShare(req.params.id, req.workshopId);
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    if (!canSend(req.user, row)) return res.status(403).json(NOT_ALLOWED);
    if (!CUSTOMER_FACING.includes(row.inspection_type)) {
      return res.status(400).json({ success: false, message: 'Only the intake and handover inspections are sent to the customer.' });
    }
    if (row.status !== 'completed') {
      return res.status(409).json({ success: false, code: 'NOT_COMPLETED', message: 'Complete the inspection first, then send it to the customer.' });
    }
    // The customer's page closes for a cancelled job (public-inspections.js), so there is nothing to send.
    if (row.wo_status === 'cancelled') {
      return res.status(409).json({ success: false, code: 'WORK_ORDER_CANCELLED', message: 'This job card is cancelled — the inspection is no longer sent to the customer.' });
    }
    if (channel === 'email' && !row.to_email) {
      return res.status(400).json({ success: false, code: 'NO_EMAIL', message: 'No e-mail on file for this customer — send it by WhatsApp, or copy the link.' });
    }
    if (channel === 'email' && row.shared_via === 'email' && row.shared_secs_ago != null && row.shared_secs_ago < 60) {
      return res.status(429).json({ success: false, code: 'JUST_SENT', message: 'The e-mail was just sent — wait a minute before sending it again.' });
    }

    // Made once; a second send (or two at once) keeps the first token.
    await execute('UPDATE vehicle_inspections SET share_token = COALESCE(share_token, ?) WHERE id = ?',
      [crypto.randomBytes(32).toString('base64url'), row.id]);
    const [{ share_token: token }] = await query('SELECT share_token FROM vehicle_inspections WHERE id = ?', [row.id]);
    const url = inspectionLinkUrl(token);

    const handover = row.inspection_type === 'joint';
    const jobClosed = row.wo_status === 'completed';
    // As the customer's page decides (public-inspections.js canSign).
    const toSign = row.entry_mode !== 'document' && !row.signature_url && !jobClosed;
    const plate = stripMarkup(row.plate_number || '', 30);
    const vehicle = plate ? `your vehicle (${plate})` : 'your vehicle';
    // The customer's words for the two walk-arounds: check-in (intake) and handover.
    const moment = handover ? 'at handover' : 'at check-in';

    if (channel === 'email') {
      const sent = await sendNotificationEmail({
        to: row.to_email,
        tenantId: req.workshopId,
        subject: `Vehicle inspection — ${row.work_order_number}`,
        title: `Your vehicle ${moment}`,
        body: `Here is the inspection of ${vehicle} ${moment}, job card ${row.work_order_number}: ` +
          'the condition we recorded, with any damage marked. ' +
          (toSign ? 'Please check it and sign to confirm.' : 'Keep this link as your copy.'),
        ctaText: toSign ? 'View and sign' : 'View the inspection',
        ctaUrl: url,
      });
      if (!sent?.success) {
        return res.status(502).json({ success: false, code: 'EMAIL_FAILED', message: 'The e-mail could not be sent — send it by WhatsApp, or copy the link.', url });
      }
    }

    await execute('UPDATE vehicle_inspections SET shared_at = NOW(), shared_via = ? WHERE id = ?', [channel, row.id]);
    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id, action: 'SHARE', entityType: 'vehicle_inspections',
      entityId: row.id, newValue: { channel },
    });

    const out = { success: true, url, emailed: channel === 'email', job_closed: jobClosed };
    if (channel === 'whatsapp') {
      // No number on file: wa.me without one lets the advisor pick the chat.
      const phone = waDigits(row.to_phone);
      const text = `The inspection of ${vehicle} ${moment} (job card ${row.work_order_number}) is ready. ` +
        `${toSign ? 'Please check it and sign to confirm' : 'Your copy'}: ${url}`;
      out.whatsapp_url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      if (!phone) out.message = 'No phone number on file — choose the chat in WhatsApp.';
    } else if (channel === 'email') {
      out.message = `Sent to ${row.to_email}`;
    }
    const [updated] = await query('SELECT * FROM vehicle_inspections WHERE id = ?', [row.id]);
    out.data = parseMarks(updated);
    return res.json(out);
  } catch (err) {
    console.error('[VehicleInspections] Share error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send the inspection' });
  }
});

/**
 * POST /api/vehicle-inspections/:id/share/reset — a new link, for when the
 * old one went to the wrong chat. The old link stops working, and a signature
 * made from it comes off too (whoever held the link could sign under any
 * name), so the customer signs again: at the car, from the new link or in
 * the portal. A signature taken at the car ('on_site') or by the customer in
 * the customer portal under their own login ('portal') stays. The next send
 * makes the new link.
 */
router.post('/:id/share/reset', async (req, res) => {
  try {
    const row = await loadForShare(req.params.id, req.workshopId);
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    if (!canSend(req.user, row)) return res.status(403).json(NOT_ALLOWED);

    // One statement, so a signature landing from the old link meanwhile comes
    // off with it. signed_via goes last: MySQL applies the SET list in order.
    await execute(
      `UPDATE vehicle_inspections
          SET share_token = NULL, shared_at = NULL, shared_via = NULL,
              signature_url  = IF(signed_via = 'link', NULL, signature_url),
              signed_at      = IF(signed_via = 'link', NULL, signed_at),
              signed_by_name = IF(signed_via = 'link', NULL, signed_by_name),
              signed_via     = IF(signed_via = 'link', NULL, signed_via)
        WHERE id = ? AND workshop_id = ?`,
      [row.id, req.workshopId]
    );
    const signatureCleared = row.signed_via === 'link';
    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id, action: 'RESET_LINK', entityType: 'vehicle_inspections', entityId: row.id,
      oldValue: {
        shared_via: row.shared_via, shared_at: row.shared_at,
        ...(signatureCleared ? { signature_url: row.signature_url, signed_at: row.signed_at, signed_by_name: row.signed_by_name } : {}),
      },
    });

    const [updated] = await query('SELECT * FROM vehicle_inspections WHERE id = ?', [row.id]);
    return res.json({ success: true, signature_cleared: signatureCleared, data: parseMarks(updated) });
  } catch (err) {
    console.error('[VehicleInspections] Share reset error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reset the link' });
  }
});

// DELETE /api/vehicle-inspections/:id — discard a draft
router.delete('/:id', async (req, res) => {
  try {
    const [row] = await query(
      'SELECT id, status FROM vehicle_inspections WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Inspection not found' });
    if (row.status === 'completed') {
      return res.status(400).json({ success: false, message: 'A completed inspection cannot be deleted' });
    }
    await execute('DELETE FROM vehicle_inspections WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[VehicleInspections] Delete error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete inspection' });
  }
});

export default router;
