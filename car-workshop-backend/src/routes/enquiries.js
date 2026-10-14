/**
 * ═══════════════════════════════════════════════════════════════════
 *  Enquiries — journey stages 01-02 (awareness, enquiry & quotation)
 * ═══════════════════════════════════════════════════════════════════
 *
 * The CX journey map flags the enquiry log as a system gap handled
 * manually today. Every enquiry is captured with the channel it arrived
 * through, so conversion can be measured by source; enquiries that don't
 * convert record a reason and a re-offer date, which is the "nurture and
 * re-offer" loop drawn back to stage 01 on the map.
 *
 * Mounted at: /api/enquiries
 */
import express from 'express';
import pool, { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { ensureMainJobCard } from '../lib/workflow.js';
import { requireCapability } from '../lib/roles.js';
import { serviceStatusToken } from '../lib/tokens.js';
import {
  onEnquiryCreated, onEnquiryNurture, closeTasks, markEnquiryConverted, customerForEnquiry, vehicleForEnquiry,
  notePlateConflict, intakeChannelFor, payerTypeForClass, snapshotIntakeClass, enquiryContactMethods,
} from '../lib/crm-cycle.js';

const router = express.Router();
router.use(authMiddleware);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
function genEnquiryNumber() {
  return `ENQ-${today()}-${Math.floor(Math.random() * 9000) + 1000}`;
}

// The enquiries table's enums. A value outside them used to reach MySQL and
// come back as a bare 500; now it is a 400 that says which field is wrong.
// contact_method is read from the column (see enquiryContactMethods), so
// 'social' starts working the moment its migration adds it.
const ENUMS = {
  source_channel: ['owned_repeat', 'search_discovery', 'passing_local', 'partner_referred'],
  enquiry_type: ['service', 'repair', 'diagnostic', 'bodywork', 'accident', 'other'],
  service_tier: ['tier1_routine', 'tier2_diagnostic', 'tier3_major'],
  payer_type: ['self_pay', 'insurance', 'corporate', 'fleet'],
  status: ['new', 'quoted', 'converted', 'lost', 'nurture'],
};
async function enumProblem(f) {
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (f[field] != null && f[field] !== '' && !allowed.includes(f[field])) return `${field.replace(/_/g, ' ')} "${f[field]}" is not one of: ${allowed.join(', ')}`;
  }
  if (f.contact_method != null && f.contact_method !== '') {
    const methods = await enquiryContactMethods();
    if (!methods.includes(f.contact_method)) {
      if (f.contact_method === 'social') {
        return 'Social media leads cannot be stored yet — the enquiries table needs its "social" contact method (pending database update). Record it as the closest method and put the platform in Source detail.';
      }
      return `contact method "${f.contact_method}" is not one of: ${methods.join(', ')}`;
    }
  }
  return '';
}
// 'social_media' is what the CRM activity log calls it.
const normMethod = m => (m === 'social_media' ? 'social' : m);

// GET /api/enquiries — list with filters
router.get('/', async (req, res) => {
  try {
    const { status, source_channel, payer_type, service_tier, search, due, page = 1, limit = 50 } = req.query;
    const pg = parseInt(page, 10) || 1;
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const offset = (pg - 1) * lim;

    let where = 'WHERE e.workshop_id = ?';
    const params = [req.workshopId];
    if (status) { where += ' AND e.status = ?'; params.push(status); }
    if (source_channel) { where += ' AND e.source_channel = ?'; params.push(source_channel); }
    if (payer_type) { where += ' AND e.payer_type = ?'; params.push(payer_type); }
    if (service_tier) { where += ' AND e.service_tier = ?'; params.push(service_tier); }
    if (due === 'true') { where += ' AND e.follow_up_at IS NOT NULL AND e.follow_up_at <= NOW() AND e.status IN ("new","quoted","nurture")'; }
    if (search) {
      where += ' AND (e.enquiry_number LIKE ? OR e.contact_name LIKE ? OR e.contact_phone LIKE ? OR e.description LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const [{ total }] = await query(`SELECT COUNT(*) as total FROM enquiries e ${where}`, params);
    const rows = await query(
      `SELECT e.*, c.full_name AS customer_full_name, wo.work_order_number
       FROM enquiries e
       LEFT JOIN customers c ON e.customer_id = c.id
       LEFT JOIN work_orders wo ON e.converted_work_order_id = wo.id
       ${where}
       ORDER BY e.created_at DESC
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );
    return res.json({ success: true, data: rows, pagination: { total, page: pg, limit: lim } });
  } catch (err) {
    console.error('[Enquiries] list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch enquiries' });
  }
});

// GET /api/enquiries/stats — conversion by channel (the point of capturing source)
router.get('/stats', async (req, res) => {
  try {
    const [totals] = await query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'new') AS new_count,
              SUM(status = 'quoted') AS quoted,
              SUM(status = 'converted') AS converted,
              SUM(status = 'lost') AS lost,
              SUM(status = 'nurture') AS nurture,
              SUM(follow_up_at IS NOT NULL AND follow_up_at <= NOW()
                  AND status IN ('new','quoted','nurture')) AS follow_ups_due
       FROM enquiries WHERE workshop_id = ?`,
      [req.workshopId]
    );

    const byChannel = await query(
      `SELECT source_channel,
              COUNT(*) AS total,
              SUM(status = 'converted') AS converted,
              ROUND(100 * SUM(status = 'converted') / NULLIF(COUNT(*), 0), 1) AS conversion_rate
       FROM enquiries WHERE workshop_id = ?
       GROUP BY source_channel ORDER BY total DESC`,
      [req.workshopId]
    );

    // Counts both 'lost' and 'nurture' — an enquiry with a re-offer scheduled
    // still recorded a reason it didn't convert, and that reason is the point.
    const lostReasons = await query(
      `SELECT lost_reason,
              COUNT(*) AS count,
              SUM(status = 'nurture') AS in_nurture
       FROM enquiries
       WHERE workshop_id = ? AND status IN ('lost','nurture') AND lost_reason IS NOT NULL
       GROUP BY lost_reason ORDER BY count DESC`,
      [req.workshopId]
    );

    // The cycle as a funnel: enquiry → quoted → booked → job → completed,
    // by channel. Quoted/booked are read from the linked estimate and
    // booking, so they count even after the enquiry moved on to 'converted'.
    const funnel = await query(
      `SELECT e.source_channel,
              COUNT(*) AS enquiries,
              SUM(e.status = 'quoted' OR e.quoted_amount IS NOT NULL OR EXISTS (SELECT 1 FROM service_estimates se WHERE se.enquiry_id = e.id)) AS quoted,
              SUM(EXISTS (SELECT 1 FROM appointments a WHERE a.enquiry_id = e.id AND a.status NOT IN ('cancelled'))) AS booked,
              SUM(e.converted_work_order_id IS NOT NULL) AS jobs,
              SUM(wo.status = 'completed') AS completed
         FROM enquiries e
         LEFT JOIN work_orders wo ON wo.id = e.converted_work_order_id
        WHERE e.workshop_id = ?
        GROUP BY e.source_channel ORDER BY enquiries DESC`,
      [req.workshopId]
    );
    const sum = k => funnel.reduce((n, r) => n + Number(r[k] || 0), 0);

    return res.json({
      success: true,
      data: {
        totals: totals || {},
        by_channel: byChannel,
        lost_reasons: lostReasons,
        funnel: {
          total: { enquiries: sum('enquiries'), quoted: sum('quoted'), booked: sum('booked'), jobs: sum('jobs'), completed: sum('completed') },
          by_channel: funnel,
        },
      },
    });
  } catch (err) {
    console.error('[Enquiries] stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch enquiry stats' });
  }
});

// GET /api/enquiries/:id
router.get('/:id', async (req, res) => {
  try {
    const [row] = await query(
      `SELECT e.*, c.full_name AS customer_full_name, wo.work_order_number
       FROM enquiries e
       LEFT JOIN customers c ON e.customer_id = c.id
       LEFT JOIN work_orders wo ON e.converted_work_order_id = wo.id
       WHERE e.id = ? AND e.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Enquiry not found' });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch enquiry' });
  }
});

// POST /api/enquiries
router.post('/', async (req, res) => {
  try {
    const {
      customer_id, vehicle_id, contact_name, contact_phone, contact_email, vehicle_description, vehicle_plate,
      enquiry_type, service_tier, description, quoted_amount,
      source_channel, source_detail, referred_by, contact_method,
      payer_type, status, follow_up_at, assigned_to,
    } = req.body;

    // Website leads can arrive with only an e-mail address; either way the
    // workshop needs one way to reach the person.
    if (!contact_name || !(String(contact_phone || '').trim() || String(contact_email || '').trim())) {
      return res.status(400).json({ success: false, message: 'Contact name and a phone number or e-mail are required' });
    }
    if (!source_channel) {
      return res.status(400).json({ success: false, message: 'Source channel is required — it is what makes conversion measurable' });
    }
    const method = normMethod(contact_method) || 'phone';
    const problem = await enumProblem({ source_channel, enquiry_type, service_tier, payer_type, status, contact_method: method });
    if (problem) return res.status(400).json({ success: false, code: 'INVALID_VALUE', message: problem });

    // Enquiry numbers are a random draw per day; a collision draws again.
    let result;
    for (let attempt = 0; attempt < 6 && !result; attempt++) {
      try {
        result = await execute(
          `INSERT INTO enquiries
             (workshop_id, enquiry_number, customer_id, vehicle_id, contact_name, contact_phone, contact_email,
              vehicle_description, vehicle_plate, enquiry_type, service_tier, description, quoted_amount, quoted_at,
              source_channel, source_detail, referred_by, contact_method, payer_type, status,
              follow_up_at, assigned_to, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [req.workshopId, genEnquiryNumber(), customer_id || null, vehicle_id || null,
           contact_name.trim(), String(contact_phone || '').trim() || null, contact_email || null, vehicle_description || null,
           vehicle_plate ? String(vehicle_plate).trim().toUpperCase().slice(0, 30) : null,
           enquiry_type || 'service', service_tier || null, description || null,
           quoted_amount != null && quoted_amount !== '' ? quoted_amount : null,
           quoted_amount != null && quoted_amount !== '' ? new Date() : null,
           source_channel, source_detail || null, referred_by || null,
           method, payer_type || 'self_pay', status || 'new',
           follow_up_at || null, assigned_to || null, req.user.id]
        );
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY' || !/enquiry_number/.test(e.message)) throw e;
      }
    }
    if (!result) throw new Error('Could not allocate an enquiry number');

    const [row] = await query('SELECT * FROM enquiries WHERE id = ?', [result.insertId]);
    // Follow up: a call-back task for whoever picks up new enquiries.
    await onEnquiryCreated(row, req.user?.id);
    return res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('[Enquiries] create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create enquiry' });
  }
});

// PUT /api/enquiries/:id
router.put('/:id', async (req, res) => {
  try {
    const [existing] = await query('SELECT * FROM enquiries WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!existing) return res.status(404).json({ success: false, message: 'Enquiry not found' });

    const f = { ...existing, ...req.body };
    if (req.body.contact_method !== undefined) f.contact_method = normMethod(req.body.contact_method);
    const problem = await enumProblem(Object.fromEntries(Object.keys({ ...ENUMS, contact_method: 1 })
      .filter(k => req.body[k] !== undefined).map(k => [k, f[k]])));
    if (problem) return res.status(400).json({ success: false, code: 'INVALID_VALUE', message: problem });
    const quotedChanged = req.body.quoted_amount != null && String(req.body.quoted_amount) !== String(existing.quoted_amount);

    await execute(
      `UPDATE enquiries SET
         customer_id=?, vehicle_id=?, contact_name=?, contact_phone=?, contact_email=?, vehicle_description=?, vehicle_plate=?,
         enquiry_type=?, service_tier=?, description=?, quoted_amount=?, quoted_at=?,
         source_channel=?, source_detail=?, referred_by=?, contact_method=?, payer_type=?,
         status=?, lost_reason=?, lost_notes=?, follow_up_at=?, assigned_to=?
       WHERE id = ? AND workshop_id = ?`,
      [f.customer_id || null, f.vehicle_id || null, f.contact_name, f.contact_phone || null, f.contact_email || null,
       f.vehicle_description || null, f.vehicle_plate ? String(f.vehicle_plate).trim().toUpperCase().slice(0, 30) : null, f.enquiry_type, f.service_tier || null, f.description || null,
       f.quoted_amount != null && f.quoted_amount !== '' ? f.quoted_amount : null,
       quotedChanged ? new Date() : (existing.quoted_at || null),
       f.source_channel, f.source_detail || null, f.referred_by || null, f.contact_method, f.payer_type,
       f.status, f.lost_reason || null, f.lost_notes || null, f.follow_up_at || null, f.assigned_to || null,
       req.params.id, req.workshopId]
    );

    const [row] = await query('SELECT * FROM enquiries WHERE id = ?', [req.params.id]);
    return res.json({ success: true, data: row });
  } catch (err) {
    console.error('[Enquiries] update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update enquiry' });
  }
});

// POST /api/enquiries/:id/lost — record why it didn't convert + schedule a re-offer
router.post('/:id/lost', async (req, res) => {
  try {
    const { lost_reason, lost_notes, follow_up_at } = req.body;
    if (!lost_reason) return res.status(400).json({ success: false, message: 'lost_reason is required' });

    const [existing] = await query('SELECT id FROM enquiries WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!existing) return res.status(404).json({ success: false, message: 'Enquiry not found' });

    // A scheduled re-offer keeps it in the nurture loop rather than closing it out.
    const status = follow_up_at ? 'nurture' : 'lost';
    await execute(
      'UPDATE enquiries SET status = ?, lost_reason = ?, lost_notes = ?, follow_up_at = ? WHERE id = ? AND workshop_id = ?',
      [status, lost_reason, lost_notes || null, follow_up_at || null, req.params.id, req.workshopId]
    );
    const [row] = await query('SELECT * FROM enquiries WHERE id = ?', [req.params.id]);
    if (status === 'nurture') await onEnquiryNurture(row, req.user?.id);
    else await closeTasks({ workshopId: req.workshopId, relatedType: 'enquiry', relatedId: row.id, userId: req.user?.id, outcome: `Not converted: ${lost_reason}` });
    return res.json({ success: true, data: row });
  } catch (err) {
    console.error('[Enquiries] lost error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record outcome' });
  }
});

// POST /api/enquiries/:id/prepare-quote — Quote stage: make sure the enquiry
// has a customer (the one on file with the same phone/e-mail, else a new
// record) and, when it names one, a vehicle, so the estimate form can open
// already filled in. Returns what the form needs.
router.post('/:id/prepare-quote', requireCapability('estimate.raise'), async (req, res) => {
  // The enquiry row is locked while its customer and car are found or
  // created, so two people pressing Quote at once get one of each.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[enq]] = await conn.query('SELECT * FROM enquiries WHERE id = ? AND workshop_id = ? FOR UPDATE', [req.params.id, req.workshopId]);
    if (!enq) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Enquiry not found' }); }
    if (enq.converted_work_order_id) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'This enquiry is already a job — raise the estimate from its job card.' });
    }
    const info = {};
    const customerId = await customerForEnquiry(enq, { conn });
    const vehicleId = await vehicleForEnquiry(enq, customerId, { conn, info });
    await conn.commit();
    if (info.conflict) await notePlateConflict({ enq: { ...enq, customer_id: customerId }, conflict: info.conflict, userId: req.user?.id });
    const [customer] = await query(
      'SELECT id, full_name, phone, email, code, customer_class, customer_subcategory FROM customers WHERE id = ?', [customerId]);
    return res.json({
      success: true,
      data: { enquiry_id: enq.id, enquiry_number: enq.enquiry_number, customer, vehicle_id: vehicleId,
              payer_type: enq.payer_type, description: enq.description,
              vehicle_conflict: info.conflict || null },
    });
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection gone */ }
    console.error('[Enquiries] prepare-quote error:', err);
    return res.status(500).json({ success: false, message: 'Could not prepare the quote' });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/enquiries/:id/convert — turn an enquiry into a work order (job card).
 *
 * Body (all optional): customer_id, vehicle_id, service_bay_id, scheduled_at,
 *   complaint      — the reported issue, when the enquiry has none (or to correct it)
 *   odometer_in    — the reading, if the car is already here (digits only)
 *
 * Step 2 of the process: the job carries the reported issue and the channel
 * the request came through (WhatsApp, website, social media, else the
 * advisor). The odometer and the VIN may still be missing — the car is often
 * not in yet — and the workflow keeps Step 2 open until they are recorded.
 *
 * Every job card has a customer record: the one on the enquiry, else the one
 * on file with the same phone / e-mail, else a new one (the old "untick to
 * skip the customer" path left job cards stuck at Step 1). The enquiry's
 * quoted amount stays on the enquiry as a reference — the job is priced on
 * the estimate after inspection, not by a figure given on the phone.
 *
 * One transaction with the enquiry row locked: two advisors converting the
 * same WhatsApp lead at the same moment get one job card and a 409.
 */
router.post('/:id/convert', requireCapability('job.open'), async (req, res) => {
  const b = req.body || {};
  let odometer = null;
  if (b.odometer_in !== undefined && b.odometer_in !== null && String(b.odometer_in).trim() !== '') {
    const s = String(b.odometer_in).trim()
      .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0));
    if (!/^\d{1,7}$/.test(s)) return res.status(400).json({ success: false, message: 'Mileage looks wrong — enter the reading in km, digits only.' });
    odometer = Number(s);
  }
  if (b.scheduled_at && !/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(String(b.scheduled_at))) {
    return res.status(400).json({ success: false, message: 'Scheduled drop-off must be a date and time (YYYY-MM-DD HH:MM).' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[enq]] = await conn.query('SELECT * FROM enquiries WHERE id = ? AND workshop_id = ? FOR UPDATE', [req.params.id, req.workshopId]);
    if (!enq) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Enquiry not found' }); }
    if (enq.converted_work_order_id) {
      await conn.rollback();
      return res.status(409).json({ success: false, code: 'ALREADY_CONVERTED', message: 'This enquiry has already been converted',
        data: { work_order_id: enq.converted_work_order_id } });
    }

    // Step 2: the reported issue is what the job card is for.
    const complaint = String(b.complaint ?? b.description ?? enq.description ?? '').trim();
    if (!complaint) {
      await conn.rollback();
      return res.status(400).json({ success: false, code: 'COMPLAINT_REQUIRED',
        message: 'Record the reported issue on the enquiry (what the customer says is wrong) before opening a job card.' });
    }

    // Step 1: the customer record.
    let customerId = b.customer_id || null;
    if (customerId) {
      const [[c]] = await conn.query('SELECT id FROM customers WHERE id = ? AND workshop_id = ?', [customerId, req.workshopId]);
      if (!c) { await conn.rollback(); return res.status(400).json({ success: false, message: 'Customer not found' }); }
    } else {
      customerId = await customerForEnquiry(enq, { conn });
    }
    const [[cust]] = await conn.query(
      'SELECT id, full_name, phone, email, customer_class, customer_subcategory, is_active FROM customers WHERE id = ?', [customerId]);
    if (!cust.is_active) {
      await conn.rollback();
      return res.status(400).json({ success: false, code: 'CUSTOMER_INACTIVE', message: `${cust.full_name} is deactivated. Reactivate the customer or choose another before opening a job card.` });
    }

    // The car: one of this customer's, never someone else's.
    const info = {};
    let vehicleId = b.vehicle_id || null;
    if (vehicleId) {
      const [[v]] = await conn.query('SELECT id FROM vehicles WHERE id = ? AND workshop_id = ? AND customer_id = ?', [vehicleId, req.workshopId, customerId]);
      if (!v) { await conn.rollback(); return res.status(400).json({ success: false, code: 'VEHICLE_NOT_CUSTOMERS', message: 'That vehicle does not belong to this customer.' }); }
    } else {
      vehicleId = await vehicleForEnquiry({ ...enq, customer_id: customerId }, customerId, { conn, info });
    }
    if (b.service_bay_id) {
      const [[bay]] = await conn.query('SELECT id FROM service_bays WHERE id = ? AND workshop_id = ?', [b.service_bay_id, req.workshopId]);
      if (!bay) { await conn.rollback(); return res.status(400).json({ success: false, message: 'Service bay not found' }); }
    }

    // An insurer- or company-paid enquiry keeps its payer route; otherwise
    // the payer follows the Step 1 classification.
    const payer = enq.payer_type && enq.payer_type !== 'self_pay'
      ? enq.payer_type : payerTypeForClass(cust.customer_class, cust.customer_subcategory);
    const realPhone = p => (/\d{5,}/.test(String(p || '').replace(/\D/g, '')) ? p : null);
    const notes = info.conflict
      ? `Plate ${info.conflict.plate} from the enquiry is on file for ${info.conflict.owner_name || 'another customer'} — not attached; confirm the owner.` : null;

    let workOrderId = null; let work_order_number = null;
    for (let attempt = 0; attempt < 6 && !workOrderId; attempt++) {
      const number = `WO-${today()}-${Math.floor(Math.random() * 9000) + 1000}`;
      try {
        const [ins] = await conn.query(
          `INSERT INTO work_orders
             (workshop_id, work_order_number, customer_id, vehicle_id, service_bay_id,
              customer_name, customer_phone, customer_email, description,
              service_tier, payer_type, enquiry_id, scheduled_at, service_fee, odometer_in,
              intake_channel, status, service_status_token, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?, 'pending', ?, ?)`,
          [req.workshopId, number, customerId, vehicleId || null, b.service_bay_id || null,
           cust.full_name || enq.contact_name, realPhone(cust.phone) || enq.contact_phone || cust.phone || '',
           cust.email || enq.contact_email || null,
           complaint.slice(0, 5000), enq.service_tier || null, payer,
           enq.id, b.scheduled_at ? String(b.scheduled_at).replace('T', ' ') : null, odometer,
           // Step 2: how the request reached the workshop
           intakeChannelFor(enq.contact_method), serviceStatusToken(), notes]
        );
        workOrderId = ins.insertId; work_order_number = number;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY' || !/work_order_number/.test(e.message)) throw e; // a number collision: draw another
      }
    }
    if (!workOrderId) throw new Error('Could not allocate a work order number');

    await conn.query(
      'INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
      [workOrderId, 'pending', req.user?.id || null, `Created from enquiry ${enq.enquiry_number}`]);
    await snapshotIntakeClass(workOrderId, { conn });
    // Same monotonic guard as the counter: never wind a vehicle's mileage back.
    if (vehicleId && odometer != null) {
      await conn.query('UPDATE vehicles SET mileage = ? WHERE id = ? AND (mileage IS NULL OR mileage < ?)', [odometer, vehicleId, odometer]);
    }
    await markEnquiryConverted({ workshopId: req.workshopId, enquiryId: enq.id, workOrderId, customerId, userId: req.user?.id, conn });
    await conn.commit();

    // After the commit (as fleet-intake and check-in do): Step 3, the main
    // job card, and the floor told a request was raised.
    await ensureMainJobCard({ workOrderId, workshopId: req.workshopId, userId: req.user?.id })
      .catch(e => console.error('[Enquiries] main job card:', e.message));
    if (info.conflict) {
      await notePlateConflict({ enq: { ...enq, customer_id: customerId }, conflict: info.conflict, userId: req.user?.id });
    }

    const [wo] = await query('SELECT * FROM work_orders WHERE id = ?', [workOrderId]);
    return res.status(201).json({ success: true, data: { work_order: wo, enquiry_id: enq.id, vehicle_conflict: info.conflict || null } });
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection gone */ }
    console.error('[Enquiries] convert error:', err);
    return res.status(500).json({ success: false, message: 'Failed to convert enquiry' });
  } finally {
    conn.release();
  }
});

// DELETE /api/enquiries/:id
router.delete('/:id', async (req, res) => {
  try {
    const [existing] = await query('SELECT converted_work_order_id FROM enquiries WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!existing) return res.status(404).json({ success: false, message: 'Enquiry not found' });
    if (existing.converted_work_order_id) {
      return res.status(409).json({ success: false, message: 'Cannot delete a converted enquiry — it is linked to a work order' });
    }
    await execute('DELETE FROM enquiries WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    return res.json({ success: true, message: 'Enquiry deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to delete enquiry' });
  }
});

export default router;
