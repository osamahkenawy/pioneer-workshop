/**
 * crm-cycle.js — the joins between the stages of the customer cycle:
 *
 *   lead (enquiry) → follow up → quote (estimate) → book (appointment) →
 *   visit (job card) → after the visit → service due → a reply to the
 *   reminder is a new enquiry.
 *
 * Small helpers the routes call at each hand-off, so an enquiry knows it was
 * quoted and converted, and the follow-ups the process map asks for land in
 * Tasks & Follow-ups instead of depending on someone remembering.
 *
 * Every submitted enquiry gets its work order — the visit — at once (client
 * e-mail, 2026-10-29: openEnquiryWorkOrder below), linked both ways
 * (enquiries.work_order_id, work_orders.enquiry_id). Converting the lead
 * later (direct convert, booking check-in, approved quote) works on that
 * work order; an enquiry closed with nothing done on it cancels it.
 */
import pool, { query, execute } from './database.js';
import { serviceStatusToken } from './tokens.js';
import { notifyGroups, fulfilReminders } from './workflow.js';
import { openJobCardIfReady } from './physical-inspection.js';

/**
 * Open a CRM task unless an open one already exists for the same record and
 * type (so retries and re-saves don't stack duplicates). Returns the task id
 * or null.
 */
export async function createTask({
  workshopId, title, details = null, taskType = 'follow_up', priority = 'normal',
  customerId = null, vehicleId = null, relatedType = 'none', relatedId = null,
  assignedTo = null, dueAt = null, createdBy = null,
}) {
  try {
    if (relatedId) {
      const [open] = await query(
        `SELECT id FROM crm_tasks WHERE workshop_id = ? AND related_type = ? AND related_id = ? AND task_type = ?
            AND status IN ('open','in_progress') LIMIT 1`,
        [workshopId, relatedType, relatedId, taskType]);
      if (open) return open.id;
    }
    const r = await execute(
      `INSERT INTO crm_tasks
         (workshop_id, title, details, task_type, priority, status, customer_id, vehicle_id,
          related_type, related_id, assigned_to, due_at, created_by)
       VALUES (?,?,?,?,?,'open',?,?,?,?,?,?,?)`,
      [workshopId, String(title).slice(0, 200), details, taskType, priority, customerId, vehicleId,
       relatedType, relatedId, assignedTo, dueAt, createdBy]);
    return r.insertId;
  } catch (e) {
    console.error('[crm-cycle] task:', e.message);
    return null;
  }
}

/** Close the open tasks of a type (or all types) on a record. */
export async function closeTasks({ workshopId, relatedType, relatedId, taskType = null, outcome = null, userId = null }) {
  if (!relatedId) return;
  await execute(
    `UPDATE crm_tasks SET status = 'done', completed_at = NOW(), completed_by = ?, outcome = COALESCE(outcome, ?)
      WHERE workshop_id = ? AND related_type = ? AND related_id = ? AND status IN ('open','in_progress')
        ${taskType ? 'AND task_type = ?' : ''}`,
    [userId, outcome, workshopId, relatedType, relatedId, ...(taskType ? [taskType] : [])],
  ).catch(e => console.error('[crm-cycle] close tasks:', e.message));
}

const hoursFromNow = h => new Date(Date.now() + h * 3600 * 1000);

/** A new enquiry: someone calls the customer back the same day. */
export async function onEnquiryCreated(enq, userId = null) {
  if (!enq) return;
  await createTask({
    workshopId: enq.workshop_id,
    title: `Call back ${enq.contact_name || 'new enquiry'} — ${enq.enquiry_number}`,
    details: [enq.description, enq.vehicle_description].filter(Boolean).join(' · ') || null,
    taskType: 'call_back', priority: 'high',
    customerId: enq.customer_id || null, vehicleId: enq.vehicle_id || null,
    relatedType: 'enquiry', relatedId: enq.id, assignedTo: enq.assigned_to || null,
    dueAt: hoursFromNow(2), createdBy: userId,
  });
}

/** Not converted but a re-offer is scheduled: a task on that date. */
export async function onEnquiryNurture(enq, userId = null) {
  if (!enq?.follow_up_at) return;
  await closeTasks({ workshopId: enq.workshop_id, relatedType: 'enquiry', relatedId: enq.id, taskType: 'call_back', userId, outcome: 'Not converted — re-offer scheduled' });
  await createTask({
    workshopId: enq.workshop_id,
    title: `Re-offer to ${enq.contact_name || 'customer'} — ${enq.enquiry_number}`,
    details: [enq.lost_reason && `Reason: ${String(enq.lost_reason).replace(/_/g, ' ')}`, enq.lost_notes].filter(Boolean).join(' · ') || null,
    taskType: 'follow_up', customerId: enq.customer_id || null, vehicleId: enq.vehicle_id || null,
    relatedType: 'enquiry', relatedId: enq.id, assignedTo: enq.assigned_to || null,
    dueAt: new Date(enq.follow_up_at), createdBy: userId,
  });
}

/** A quote was raised for the enquiry. */
export async function markEnquiryQuoted({ workshopId, enquiryId, amount = null, userId = null }) {
  if (!enquiryId) return;
  await execute(
    `UPDATE enquiries SET status = CASE WHEN status IN ('new','nurture','lost') THEN 'quoted' ELSE status END,
            quoted_amount = COALESCE(?, quoted_amount), quoted_at = NOW()
      WHERE id = ? AND workshop_id = ? AND converted_work_order_id IS NULL`,
    [amount, enquiryId, workshopId]);
  await closeTasks({ workshopId, relatedType: 'enquiry', relatedId: enquiryId, taskType: 'call_back', userId, outcome: 'Quote raised' });
}

/**
 * The helpers below run either on the pool or, when the caller is inside a
 * transaction (enquiry convert, booking check-in), on that connection — so
 * the customer and car they find or create are part of the same commit, and
 * a second advisor converting the same enquiry waits on the row lock instead
 * of creating a second customer and car.
 */
const via = conn => (conn ? async (sql, params = []) => (await conn.query(sql, params))[0] : query);

/**
 * The enquiry became a job (approved quote, check-in or direct convert) —
 * normally on its own work order. A path that opened a different one takes
 * its place: the enquiry's is cancelled when nothing happened on it yet, so
 * the visit is not left twice on the boards.
 */
export async function markEnquiryConverted({ workshopId, enquiryId, workOrderId, customerId = null, userId = null, conn = null }) {
  if (!enquiryId || !workOrderId) return;
  const q = via(conn);
  const [enq] = await q('SELECT work_order_id FROM enquiries WHERE id = ? AND workshop_id = ?', [enquiryId, workshopId]);
  let repoint = !enq?.work_order_id;
  if (enq?.work_order_id && Number(enq.work_order_id) !== Number(workOrderId)) {
    const [other] = await q('SELECT work_order_number FROM work_orders WHERE id = ?', [workOrderId]);
    const r = await cancelUnstartedWorkOrder({
      workshopId, workOrderId: enq.work_order_id, userId, conn,
      note: `Enquiry converted to work order ${other?.work_order_number || `#${workOrderId}`}`,
    });
    repoint = r.cancelled || !r.live;
  }
  await q(
    `UPDATE enquiries SET status = 'converted', converted_work_order_id = ?, converted_at = NOW(),
            work_order_id = IF(?, ?, work_order_id), customer_id = COALESCE(customer_id, ?)
      WHERE id = ? AND workshop_id = ? AND converted_work_order_id IS NULL`,
    [workOrderId, repoint ? 1 : 0, workOrderId, customerId, enquiryId, workshopId]);
  await q('UPDATE work_orders SET enquiry_id = COALESCE(enquiry_id, ?) WHERE id = ? AND workshop_id = ?',
    [enquiryId, workOrderId, workshopId]);
  await closeTasks({ workshopId, relatedType: 'enquiry', relatedId: enquiryId, userId, outcome: 'Converted to a job' });
}

/**
 * A work order nothing has happened on yet — no job card opened, no customer
 * approval, still Received / Inspected — cancelled, with `note` in its
 * history ("Enquiry closed: …"). Quietly: no "cancelled" message to the
 * customer, who turned the visit down or never had one. A job with work on
 * it is left for the Service Advisor.
 *
 * @returns {Promise<{cancelled: boolean, live: boolean, workOrderNumber: string|null}>}
 *   live — the work order is still open afterwards.
 */
export async function cancelUnstartedWorkOrder({ workshopId, workOrderId, note, userId = null, conn = null }) {
  const q = via(conn);
  const [wo] = await q(
    `SELECT wo.id, wo.work_order_number, wo.status, wo.customer_approved_at,
            EXISTS (SELECT 1 FROM job_cards jc WHERE jc.work_order_id = wo.id AND jc.status <> 'cancelled') AS has_card
       FROM work_orders wo WHERE wo.id = ? AND wo.workshop_id = ?`,
    [workOrderId, workshopId]);
  if (!wo) return { cancelled: false, live: false, workOrderNumber: null };
  const live = !['completed', 'cancelled'].includes(wo.status);
  if (!live || Number(wo.has_card) || wo.customer_approved_at || !['pending', 'confirmed'].includes(wo.status)) {
    return { cancelled: false, live, workOrderNumber: wo.work_order_number };
  }
  const reason = String(note || 'Enquiry closed').slice(0, 500);
  const r = await q(
    `UPDATE work_orders SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = ?
      WHERE id = ? AND workshop_id = ? AND status IN ('pending','confirmed') AND customer_approved_at IS NULL`,
    [reason, wo.id, workshopId]);
  if (!r.affectedRows) return { cancelled: false, live: true, workOrderNumber: wo.work_order_number };
  await q('INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
    [wo.id, 'cancelled', userId, reason]);
  return { cancelled: true, live: false, workOrderNumber: wo.work_order_number };
}

/**
 * The enquiry was closed without the visit (lost, or not now — a re-offer
 * date): its work order is cancelled when nothing has happened on it yet,
 * with "Enquiry closed: <reason>" in its history.
 * @returns {Promise<{cancelled: boolean, live: boolean, workOrderNumber: string|null}|null>} null: no work order.
 */
export async function closeEnquiryWorkOrder({ workshopId, enquiryId, reason, userId = null }) {
  const [enq] = await query(
    `SELECT e.work_order_id, (SELECT wo.id FROM work_orders wo WHERE wo.enquiry_id = e.id AND wo.workshop_id = e.workshop_id
                                AND wo.status NOT IN ('completed','cancelled') ORDER BY wo.id DESC LIMIT 1) AS linked_id
       FROM enquiries e WHERE e.id = ? AND e.workshop_id = ?`,
    [enquiryId, workshopId]);
  const workOrderId = enq?.work_order_id || enq?.linked_id;
  if (!workOrderId) return null;
  const text = String(reason || '').replace(/_/g, ' ').trim();
  return cancelUnstartedWorkOrder({ workshopId, workOrderId, userId, note: `Enquiry closed${text ? `: ${text}` : ''}` });
}

const CHANNEL_WORDS = { advisor: 'the Service Advisor', website: 'the website', whatsapp: 'WhatsApp', social: 'social media', fleet_link: 'the fleet link', api: 'the API' };
const ymd = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

/**
 * The enquiry's work order — the visit — opened (or found) inside the
 * caller's transaction (`conn`, the enquiry row locked) or on the pool.
 *
 * The enquiry's live work order (enquiries.work_order_id, else the open one
 * carrying its enquiry_id) is reused, so no path opens a second one. Else:
 * the customer behind the enquiry (customerForEnquiry), the car it names
 * (vehicleForEnquiry; a plate on file for someone else is left off and comes
 * back in `info.conflict`), and a 'pending' work order linked both ways,
 * with the source in intake_channel (`channel`, else from the contact
 * method) and the Step 1 classification snapshot. The reported issue is
 * `complaint`, else the enquiry's description — it may still be empty, and
 * Step 2 then asks for it.
 *
 * No job card here: after the commit, announceEnquiryWorkOrder() opens it
 * when the rule allows (internal customer) and tells the Service Advisors.
 *
 * @returns {Promise<{workOrderId: number, workOrderNumber: string, customerId: number,
 *   vehicleId: number|null, created: boolean}>}
 */
export async function workOrderForEnquiry(enq, { conn = null, userId = null, channel = null, complaint = null, info = {} } = {}) {
  const q = via(conn);
  const [live] = await q(
    `SELECT id, work_order_number, customer_id, vehicle_id FROM work_orders
      WHERE workshop_id = ? AND status NOT IN ('completed','cancelled') AND (id = ? OR enquiry_id = ?)
      ORDER BY id = ? DESC, id DESC LIMIT 1`,
    [enq.workshop_id, enq.work_order_id || 0, enq.id, enq.work_order_id || 0]);
  if (live) {
    if (Number(enq.work_order_id) !== Number(live.id)) await q('UPDATE enquiries SET work_order_id = ? WHERE id = ?', [live.id, enq.id]);
    return { workOrderId: live.id, workOrderNumber: live.work_order_number, customerId: live.customer_id, vehicleId: live.vehicle_id, created: false };
  }

  const customerId = await customerForEnquiry(enq, { conn });
  const vehicleId = await vehicleForEnquiry({ ...enq, customer_id: customerId }, customerId, { conn, info });
  const [cust] = await q('SELECT full_name, phone, email, customer_class, customer_subcategory FROM customers WHERE id = ?', [customerId]);
  // An insurer- or company-paid enquiry keeps its payer route; otherwise the
  // payer follows the Step 1 classification.
  const payer = enq.payer_type && enq.payer_type !== 'self_pay'
    ? enq.payer_type : payerTypeForClass(cust?.customer_class, cust?.customer_subcategory);
  const realPhone = p => (/\d{5,}/.test(String(p || '').replace(/\D/g, '')) ? p : null);
  const issue = String(complaint ?? enq.description ?? '').trim();
  const notes = info.conflict
    ? `Plate ${info.conflict.plate} from the enquiry is on file for ${info.conflict.owner_name || 'another customer'} — not attached; confirm the owner.` : null;

  let workOrderId = null; let workOrderNumber = null;
  for (let attempt = 0; attempt < 6 && !workOrderId; attempt++) {
    const number = `WO-${ymd()}-${Math.floor(Math.random() * 9000) + 1000}`;
    try {
      const ins = await q(
        `INSERT INTO work_orders
           (workshop_id, work_order_number, customer_id, vehicle_id, customer_name, customer_phone, customer_email,
            description, service_tier, payer_type, enquiry_id, service_fee, intake_channel, status, service_status_token, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?, 'pending', ?, ?)`,
        [enq.workshop_id, number, customerId, vehicleId || null,
         cust?.full_name || enq.contact_name, realPhone(cust?.phone) || enq.contact_phone || cust?.phone || '',
         cust?.email || enq.contact_email || null,
         issue ? issue.slice(0, 5000) : null, enq.service_tier || null, payer, enq.id,
         channel || intakeChannelFor(enq.contact_method), serviceStatusToken(), notes]);
      workOrderId = ins.insertId; workOrderNumber = number;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY' || !/work_order_number/.test(e.message)) throw e; // a number collision: draw another
    }
  }
  if (!workOrderId) throw new Error('Could not allocate a work order number');
  await q('INSERT INTO work_order_status_logs (work_order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
    [workOrderId, 'pending', userId, `Created from enquiry ${enq.enquiry_number}`]);
  await snapshotIntakeClass(workOrderId, { conn });
  await q('UPDATE enquiries SET work_order_id = ? WHERE id = ?', [workOrderId, enq.id]);
  return { workOrderId, workOrderNumber, customerId, vehicleId, created: true };
}

/**
 * After the commit that opened an enquiry's work order: the plate clash
 * noted, the main job card opened when the rule allows (an internal
 * customer; an external one's waits for the physical inspection), and the
 * Service Advisors told a new work order arrived and through which channel.
 * Never throws.
 */
export async function announceEnquiryWorkOrder({ enq, workOrderId, conflict = null, userId = null }) {
  try {
    if (conflict) await notePlateConflict({ enq, conflict, userId });
    const { opened, jobCard } = await openJobCardIfReady({ workOrderId, workshopId: enq.workshop_id, userId });
    if (!opened) fulfilReminders({ workshopId: enq.workshop_id, workOrderId });
    const [wo] = await query(
      `SELECT wo.work_order_number, wo.customer_name, wo.description, wo.intake_channel, v.plate_number
         FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id WHERE wo.id = ?`, [workOrderId]);
    if (!wo) return;
    const issue = String(wo.description || '').replace(/\s+/g, ' ').trim();
    await notifyGroups(enq.workshop_id, ['service_advisor'], {
      title: `New work order ${wo.work_order_number}${wo.plate_number ? ` · ${wo.plate_number}` : ''}`,
      body: `${wo.customer_name || enq.contact_name || 'A customer'} — enquiry ${enq.enquiry_number} through ${CHANNEL_WORDS[wo.intake_channel] || 'the Service Advisor'}`
        + `${issue ? `: ${issue.length > 120 ? `${issue.slice(0, 119)}…` : issue}` : ''}. `
        + (opened ? `Job card ${jobCard.job_card_number} is open.` : 'Next: the physical inspection with the customer.'),
      link: `/work-orders/${workOrderId}`, orderId: workOrderId, icon: '📥', type: 'enquiry_work_order', exceptUserId: userId,
    });
  } catch (err) {
    console.error('[crm-cycle] enquiry work order follow-up:', err.message);
  }
}

/**
 * A submitted enquiry's work order, in a transaction of its own with the
 * enquiry row locked (two requests for the same enquiry open one), then
 * announced. For the routes that have just stored the enquiry: staff CRM,
 * the website form, the v1 API. A failure is logged and returns null — the
 * enquiry is kept, and converting it later opens the work order.
 */
export async function openEnquiryWorkOrder({ enquiryId, workshopId, userId = null, channel = null }) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[enq]] = await conn.query('SELECT * FROM enquiries WHERE id = ? AND workshop_id = ? FOR UPDATE', [enquiryId, workshopId]);
    if (!enq) { await conn.rollback(); return null; }
    const info = {};
    const r = await workOrderForEnquiry(enq, { conn, userId, channel, info });
    await conn.commit();
    conn.release(); conn = null;
    if (r.created) await announceEnquiryWorkOrder({ enq: { ...enq, customer_id: r.customerId }, workOrderId: r.workOrderId, conflict: info.conflict || null, userId });
    return r;
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch { /* connection gone */ } }
    console.error('[crm-cycle] enquiry work order:', err.message);
    return null;
  } finally {
    if (conn) conn.release();
  }
}

// Arabic-Indic (and Persian) digits typed on a phone keyboard count as digits.
const asciiDigits = s => String(s || '')
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
const digits = s => asciiDigits(s).replace(/\D/g, '');

/**
 * The country code a number was written with, when it says: '+966 5…' and
 * '00966 5…' are Saudi, a local '05…' is the UAE, a bare 9 digits says
 * nothing. Used only to stop a last-9-digits match from joining a Saudi
 * mobile to a UAE customer who happens to share the subscriber digits.
 */
function countryCodeOf(raw) {
  const d = digits(raw);
  if (d.length <= 9) return null;
  if (d.startsWith('00')) return d.slice(2, -9) || null;
  if (d.startsWith('0')) return '971';
  return d.slice(0, -9);
}
// '971' and '9715' (a long subscriber number) agree; '966' and '971' do not.
const sameCountry = (a, b) => !a || !b || a.startsWith(b) || b.startsWith(a);

/**
 * An ACTIVE customer on file with this phone (compared on the last 9 digits,
 * so 050…, +97150… and 97150… are the same number) or, failing that, this
 * e-mail. Of several, the one with exactly this name, then the most recently
 * updated — never the oldest record by accident, and never a deactivated one.
 */
export async function findCustomerByContact({ workshopId, phone, email, name }, { conn = null } = {}) {
  const q = via(conn);
  const wantName = String(name || '').trim().toLowerCase();
  const pick = rows => rows
    .map(r => ({ ...r, _name: String(r.full_name || '').trim().toLowerCase() === wantName && !!wantName }))
    .sort((a, b) => (b._name - a._name) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || b.id - a.id)[0] || null;

  const tail = digits(phone).slice(-9);
  if (tail.length === 9) {
    const cc = countryCodeOf(phone);
    const rows = (await q(
      `SELECT id, full_name, phone, updated_at FROM customers
        WHERE workshop_id = ? AND is_active = 1 AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 9) = ?
        ORDER BY updated_at DESC, id DESC LIMIT 25`,
      [workshopId, tail])).filter(r => sameCountry(cc, countryCodeOf(r.phone)));
    const hit = pick(rows);
    if (hit) return hit.id;
  }
  const mail = String(email || '').trim();
  if (mail) {
    const rows = await q(
      `SELECT id, full_name, updated_at FROM customers
        WHERE workshop_id = ? AND is_active = 1 AND LOWER(email) = LOWER(?)
        ORDER BY updated_at DESC, id DESC LIMIT 25`,
      [workshopId, mail]);
    const hit = pick(rows);
    if (hit) return hit.id;
  }
  return null;
}

/**
 * The customer behind an enquiry: the one already linked (while it is still
 * active), else one on file with the same phone or e-mail, else a new record
 * from the enquiry's contact details. Links it on the enquiry.
 */
export async function customerForEnquiry(enq, { conn = null } = {}) {
  const q = via(conn);
  if (enq.customer_id) {
    const [linked] = await q('SELECT id FROM customers WHERE id = ? AND workshop_id = ? AND is_active = 1', [enq.customer_id, enq.workshop_id]);
    if (linked) return linked.id;
  }
  let id = await findCustomerByContact(
    { workshopId: enq.workshop_id, phone: enq.contact_phone, email: enq.contact_email, name: enq.contact_name }, { conn });
  if (!id) {
    // An outside company paying (corporate / fleet account) is a fleet
    // customer; a private owner — paying themselves or through their insurer —
    // is a walk-in. An insurer-paid repair keeps the person a walk-in; the
    // job card carries payer 'insurance' from the enquiry's payer route.
    const company = ['corporate', 'fleet'].includes(enq.payer_type);
    const sub = company ? 'fleet' : 'walkin';
    const r = await q(
      `INSERT INTO customers (workshop_id, full_name, phone, email, type, customer_class, customer_subcategory, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [enq.workshop_id, enq.contact_name || 'Customer', enq.contact_phone || '', enq.contact_email || null,
       company ? enq.payer_type : 'individual', 'external', sub, `From enquiry ${enq.enquiry_number}`]);
    id = r.insertId;
  }
  await q('UPDATE enquiries SET customer_id = ? WHERE id = ?', [id, enq.id]);
  return id;
}

/**
 * The customer behind a booking made by name and phone only: the active one
 * on file with that phone, else a new External · Walk-in record. A job card
 * is never opened without a customer record (Step 1 has nothing to classify).
 */
export async function customerForContact({ workshopId, name, phone, email = null, note = null }, { conn = null } = {}) {
  const found = await findCustomerByContact({ workshopId, phone, email, name }, { conn });
  if (found) return found;
  const r = await via(conn)(
    `INSERT INTO customers (workshop_id, full_name, phone, email, type, customer_class, customer_subcategory, notes)
     VALUES (?,?,?,?,'individual','external','walkin',?)`,
    [workshopId, String(name || 'Customer').trim().slice(0, 255), String(phone || '').trim().slice(0, 50), email || null, note]);
  return r.insertId;
}

// Plates compare without spaces, dashes or case: 'dxb 12-345' is 'DXB12345'.
const plateKey = s => String(s || '').replace(/[\s-]/g, '').toUpperCase();
const PLATE_SQL = "UPPER(REPLACE(REPLACE(plate_number, ' ', ''), '-', ''))";

/**
 * The vehicle behind an enquiry: the one linked (if it is this customer's),
 * else THIS customer's vehicle with the enquiry's plate, else a new one when
 * the enquiry names a plate or a vehicle ("Toyota Camry 2019"). Returns null
 * when there is nothing to go on.
 *
 * A plate that is on file under a different customer is neither attached nor
 * duplicated: who owns the car is for the advisor to settle. The vehicle is
 * left unset and the clash comes back in opts.info.conflict, for the caller
 * to record on the enquiry (notePlateConflict) once its transaction commits.
 */
export async function vehicleForEnquiry(enq, customerId, { conn = null, info = {} } = {}) {
  const q = via(conn);
  if (enq.vehicle_id) {
    const [own] = await q('SELECT id FROM vehicles WHERE id = ? AND workshop_id = ? AND customer_id = ?', [enq.vehicle_id, enq.workshop_id, customerId]);
    if (own) return own.id;
  }
  const plate = String(enq.vehicle_plate || '').trim().toUpperCase();
  if (plate) {
    const [v] = await q(
      `SELECT id FROM vehicles WHERE workshop_id = ? AND customer_id = ? AND ${PLATE_SQL} = ?
        ORDER BY is_active DESC, updated_at DESC, id DESC LIMIT 1`,
      [enq.workshop_id, customerId, plateKey(plate)]);
    if (v) { await q('UPDATE enquiries SET vehicle_id = ? WHERE id = ?', [v.id, enq.id]); return v.id; }
    const [other] = await q(
      `SELECT v.id, v.plate_number, v.make, v.model, v.customer_id, c.full_name AS owner_name
         FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id
        WHERE v.workshop_id = ? AND v.customer_id <> ? AND v.is_active = 1 AND ${PLATE_SQL.replace('plate_number', 'v.plate_number')} = ?
        ORDER BY v.updated_at DESC LIMIT 1`,
      [enq.workshop_id, customerId, plateKey(plate)]);
    if (other) {
      info.conflict = { plate, vehicle_id: other.id, owner_id: other.customer_id, owner_name: other.owner_name || null };
      await q('UPDATE enquiries SET vehicle_id = NULL WHERE id = ? AND vehicle_id = ?', [enq.id, enq.vehicle_id || 0]);
      return null;
    }
  }
  const desc = String(enq.vehicle_description || '').trim();
  if (!plate && !desc) return null;
  const year = (desc.match(/\b(19|20)\d{2}\b/) || [])[0] || null;
  const words = desc.replace(/\b(19|20)\d{2}\b/, '').trim().split(/\s+/).filter(Boolean);
  const r = await q(
    'INSERT INTO vehicles (workshop_id, customer_id, make, model, year, plate_number, notes) VALUES (?,?,?,?,?,?,?)',
    [enq.workshop_id, customerId, words[0] || 'Unknown', words.slice(1).join(' ') || '—', year, plate || null,
     `From enquiry ${enq.enquiry_number}`]);
  await q('UPDATE enquiries SET vehicle_id = ? WHERE id = ?', [r.insertId, enq.id]);
  return r.insertId;
}

/**
 * The note for a plate that belongs to someone else: a task on the enquiry
 * (enquiries have no notes column), so the advisor sees it in Tasks &
 * Follow-ups and on the enquiry's call-back list.
 */
export async function notePlateConflict({ enq, conflict, userId = null }) {
  if (!enq || !conflict) return null;
  return createTask({
    workshopId: enq.workshop_id,
    title: `Check who owns ${conflict.plate} — ${enq.enquiry_number}`,
    details: `The plate on this enquiry is on file for ${conflict.owner_name || `customer #${conflict.owner_id}`} (vehicle #${conflict.vehicle_id}). ` +
      'It was not attached to this customer and no second record was created. Confirm the owner, then add the car to the job card.',
    taskType: 'other', priority: 'high', customerId: enq.customer_id || null,
    relatedType: 'enquiry', relatedId: enq.id, assignedTo: enq.assigned_to || null,
    dueAt: hoursFromNow(2), createdBy: userId,
  });
}

/** Step 2 "Received via": the work order's intake channel for an enquiry's contact method. */
export function intakeChannelFor(contactMethod) {
  return ({ whatsapp: 'whatsapp', website_form: 'website', social: 'social' })[contactMethod] || 'advisor';
}

/**
 * Who pays, from the Step 1 classification: an internal account is billed on
 * account (fleet / asset as 'fleet', insurance as 'insurance'); an outside
 * fleet is on account, an outside insurer pays as 'insurance', a walk-in pays.
 */
export function payerTypeForClass(customerClass, subcategory) {
  if (customerClass === 'internal') return subcategory === 'insurance' ? 'insurance' : 'fleet';
  if (subcategory === 'fleet') return 'fleet';
  if (subcategory === 'insurance') return 'insurance';
  return 'self_pay';
}

/**
 * Step 1 recorded on the job: the customer's class and subcategory as they
 * were at intake, so reclassifying the customer later does not rewrite old
 * jobs. Writes work_orders.intake_customer_class / _subcategory when the
 * columns exist (their migration ships with the intake wizard); until then
 * the workflow reads the customer, and this is a no-op.
 */
export async function snapshotIntakeClass(workOrderId, { conn = null } = {}) {
  try {
    await via(conn)(
      `UPDATE work_orders wo JOIN customers c ON c.id = wo.customer_id
          SET wo.intake_customer_class = c.customer_class, wo.intake_customer_subcategory = c.customer_subcategory
        WHERE wo.id = ? AND wo.intake_customer_class IS NULL`,
      [workOrderId]);
  } catch (e) {
    if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
  }
}

/**
 * The contact methods the enquiries table accepts. Read from the column
 * itself: 'social' (social-media leads) is added by a migration, and until
 * it is there an enquiry cannot be stored with it.
 */
let _methods = null; let _methodsAt = 0;
export async function enquiryContactMethods() {
  if (_methods && Date.now() - _methodsAt < 5 * 60 * 1000) return _methods;
  const [col] = await query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enquiries' AND COLUMN_NAME = 'contact_method'`);
  _methods = (String(col?.t || '').match(/'([^']*)'/g) || []).map(s => s.slice(1, -1));
  _methodsAt = Date.now();
  return _methods;
}
