/**
 * Mechanic Documents API (M1)  +  Min-version config (DM11)
 *
 * Ported from driver-documents.js (driver license/registration docs) to the
 * car-workshop domain: mechanic certifications/licenses (e.g. trade
 * certification, safety certification) with expiry tracking. The upload +
 * expiry-check structure is unchanged — only the vocabulary and table name
 * (driver_documents -> mechanic_documents) were renamed.
 *
 * Mounted in server.js, managers only:
 *   app.use('/api/mechanic-documents', authMiddleware, requireManager, mechanicDocumentsRouter);
 *
 * The columns are the mechanic_documents table's: document_url, issued_at,
 * expires_at, status (valid / expiring_soon / expired, from the expiry date),
 * notes. The body may still send expiry_date for expires_at.
 *
 * Storage: uses the same /uploads/mechanic-docs folder as other media.
 */
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { query, execute } from '../lib/database.js';
import { fileSuffix } from '../lib/tokens.js';
import { validateUpload, DOC_KINDS } from '../lib/file-validate.js';

const router = express.Router();

/* ── Upload setup (PDF + image, 8 MB) ───────────────────────── */
const UPLOADS_DIR = path.resolve('uploads');
const DOCS_DIR = path.join(UPLOADS_DIR, 'mechanic-docs');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

const ALLOWED_DOC_EXT  = /\.(jpg|jpeg|png|webp|pdf)$/i;
const ALLOWED_DOC_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const docStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DOCS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${fileSuffix()}${ext}`);
  },
});
const docUpload = multer({
  storage: docStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_DOC_EXT.test(file.originalname)) return cb(new Error('PDF, JPG, PNG, WEBP only'));
    if (file.mimetype && !ALLOWED_DOC_MIME.has(file.mimetype.toLowerCase())) {
      return cb(new Error('PDF, JPG, PNG, WEBP only'));
    }
    cb(null, true);
  },
});

/* ── Helpers ───────────────────────────────────────────────── */
// The table's doc_type and status values.
const VALID_DOC_TYPES   = ['trade_certificate', 'safety_certificate', 'id_card', 'other'];
const VALID_DOC_STATUS  = ['valid', 'expiring_soon', 'expired'];
const EXPIRING_DAYS = 30;

/** A date from the body: undefined = not sent, null = cleared, 'YYYY-MM-DD', or { error }. */
function parseDate(v) {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === '') return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : { error: true };
}

/** The status the expiry date gives: expired, expiring within 30 days, or valid. */
function statusFor(expiresAt) {
  if (!expiresAt) return 'valid';
  const days = Math.floor((Date.parse(expiresAt) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000);
  return days < 0 ? 'expired' : days <= EXPIRING_DAYS ? 'expiring_soon' : 'valid';
}

async function assertMechanicInWorkshop(mechanicId, workshopId) {
  const [m] = await query(
    'SELECT id FROM mechanics WHERE id = ? AND workshop_id = ? LIMIT 1',
    [mechanicId, workshopId]
  );
  return !!m;
}

/* ────────────────────────────────────────────────────────────
   GET /api/mechanic-documents?mechanic_id=&status=&expiring_in_days=
   ──────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { mechanic_id, status, doc_type, expiring_in_days } = req.query;
    let where = 'md.workshop_id = ?'; const params = [req.workshopId];
    if (mechanic_id) { where += ' AND md.mechanic_id = ?'; params.push(mechanic_id); }
    if (status && VALID_DOC_STATUS.includes(status)) { where += ' AND md.status = ?'; params.push(status); }
    if (doc_type && VALID_DOC_TYPES.includes(doc_type)) { where += ' AND md.doc_type = ?'; params.push(doc_type); }
    if (expiring_in_days) {
      const days = Math.min(365, Math.max(0, parseInt(expiring_in_days, 10) || 0));
      where += ' AND md.expires_at IS NOT NULL AND md.expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)';
      params.push(days);
    }
    const rows = await query(
      `SELECT md.*, m.full_name AS mechanic_name
         FROM mechanic_documents md
         JOIN mechanics m ON m.id = md.mechanic_id
        WHERE ${where}
        ORDER BY md.expires_at IS NULL, md.expires_at ASC, md.created_at DESC
        LIMIT 500`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[MechanicDocs] list error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/mechanic-documents  (multipart: file, mechanic_id, doc_type, issued_at?, expires_at? (or expiry_date), notes?)
   ──────────────────────────────────────────────────────────── */
router.post('/', docUpload.single('file'), validateUpload(DOC_KINDS), async (req, res) => {
  try {
    const { mechanic_id, doc_type, notes } = req.body;
    const expiresAt = parseDate(req.body.expires_at ?? req.body.expiry_date);
    const issuedAt = parseDate(req.body.issued_at);
    if (expiresAt?.error || issuedAt?.error) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'Dates must be YYYY-MM-DD' });
    }
    if (!mechanic_id || !doc_type) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'mechanic_id and doc_type required' });
    }
    if (!VALID_DOC_TYPES.includes(doc_type)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'Invalid doc_type' });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'File required' });
    if (!await assertMechanicInWorkshop(mechanic_id, req.workshopId)) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, message: 'Mechanic not found' });
    }
    const fileUrl = `/uploads/mechanic-docs/${req.file.filename}`;
    const result = await execute(
      `INSERT INTO mechanic_documents
        (workshop_id, mechanic_id, doc_type, document_url, issued_at, expires_at, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.workshopId, mechanic_id, doc_type, fileUrl, issuedAt ?? null, expiresAt ?? null,
       statusFor(expiresAt), notes ? String(notes).slice(0, 5000) : null]
    );
    const [doc] = await query('SELECT * FROM mechanic_documents WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('[MechanicDocs] upload error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ────────────────────────────────────────────────────────────
   PATCH /api/mechanic-documents/:id   { status?, notes?, issued_at?, expires_at? (or expiry_date) }
   ──────────────────────────────────────────────────────────── */
router.patch('/:id', async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (status && !VALID_DOC_STATUS.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const expiresAt = parseDate(req.body.expires_at ?? req.body.expiry_date);
    const issuedAt = parseDate(req.body.issued_at);
    if (expiresAt?.error || issuedAt?.error) return res.status(400).json({ success: false, message: 'Dates must be YYYY-MM-DD' });
    const sets = []; const params = [];
    if (notes !== undefined)     { sets.push('notes = ?');      params.push(notes == null ? null : String(notes).slice(0, 5000)); }
    if (issuedAt !== undefined)  { sets.push('issued_at = ?');  params.push(issuedAt); }
    if (expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(expiresAt); }
    // A new expiry date sets the status, unless one is given.
    if (status)                       { sets.push('status = ?'); params.push(status); }
    else if (expiresAt !== undefined) { sets.push('status = ?'); params.push(statusFor(expiresAt)); }
    if (!sets.length) return res.status(400).json({ success: false, message: 'No fields to update' });
    params.push(req.params.id, req.workshopId);
    const result = await execute(
      `UPDATE mechanic_documents SET ${sets.join(', ')} WHERE id = ? AND workshop_id = ?`,
      params
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Document not found' });
    const [doc] = await query('SELECT * FROM mechanic_documents WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[MechanicDocs] patch error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ────────────────────────────────────────────────────────────
   DELETE /api/mechanic-documents/:id
   ──────────────────────────────────────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const [doc] = await query(
      'SELECT document_url FROM mechanic_documents WHERE id = ? AND workshop_id = ? LIMIT 1',
      [req.params.id, req.workshopId]
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    await execute('DELETE FROM mechanic_documents WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (doc.document_url?.startsWith('/uploads/mechanic-docs/')) {
      const local = path.resolve('.' + doc.document_url);
      fs.unlink(local, () => {});
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[MechanicDocs] delete error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
