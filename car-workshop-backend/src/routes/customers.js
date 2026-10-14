import express from 'express';
import pool, { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireManager } from '../lib/access.js';
import { requireCapability, isManagerRole, can } from '../lib/roles.js';
import { logAudit } from '../lib/audit.js';
import { stripMarkupFields, clampTextFields, stripMarkup } from '../lib/sanitize.js';
import { sendNotificationEmail } from '../lib/email.js';
import {
  loadPortalCustomer, portalAccessStatus, issuePortalInvite, waDigits, INVITE_DAYS,
} from '../lib/portal-access.js';

// Matches the customers.type enum.
const CUSTOMER_TYPES = ['individual', 'business', 'corporate', 'insurance', 'fleet', 'other'];

// ── Step 1 classification ──
// Internal: Fleet / Insurance / Asset. External: Fleet / Insurance / Walk-in,
// or none yet — most of the imported book has none, and the job card wizard
// asks for it the next time they come in (document Step 1, D5).
const ALL_SUBCATEGORIES = ['fleet', 'insurance', 'asset', 'walkin'];

/** A sent customer_class, lower-cased: undefined when not sent, false when not a class. */
function parseClass(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const c = String(v).trim().toLowerCase();
  return ['internal', 'external'].includes(c) ? c : false;
}

/** A sent customer_subcategory: undefined when not sent, null when cleared, false when unknown. */
function parseSub(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  return ALL_SUBCATEGORIES.includes(s) ? s : false;
}

/** Why a class + subcategory pair cannot be stored, or null. */
function classificationProblem(cls, sub) {
  if (cls === 'external' && sub === 'asset') return 'Asset is an internal-only subcategory';
  if (cls === 'internal' && sub === 'walkin') return 'Walk-in is an external-only subcategory';
  // An internal account with no subcategory is listed under none of
  // Fleet / Insurance / Asset, so the wizard can never find it (#82).
  if (cls === 'internal' && !sub) return 'Choose Fleet, Insurance or Asset for an internal customer.';
  return null;
}

// D11: customers are created and edited by whoever opens job cards
// (Service Advisor, Supervisor, managers). A Storekeeper or Team Leader got
// here through the API, or by typing /customers, and could reclassify an
// account as Internal — which removes the estimate approval (#6/#43).
const canEditCustomers = requireCapability('job.open',
  "Your role can't add or edit customers. A Service Advisor, Supervisor or manager does this.");

function roleNotAllowed(res, message) {
  return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message });
}

// ── Phone numbers ──
// The book holds one UAE mobile written several ways (05XXXXXXXX,
// 05X-XXXXXXX, +9715XXXXXXXX, spaced). Search and the duplicate check
// compared the raw string, so a returning customer typed another way was
// not found and got a second record (#10/#12). Two spellings of one number
// share their last 9 digits (after any 00971 / 971 / 0 prefix); that is
// what search and the duplicate check compare.

/** Arabic-Indic digits from an Arabic keyboard, as ASCII. */
function asciiDigits(s) {
  return String(s)
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0));
}

/** How a new or changed number is stored: +971… for a UAE number, otherwise without separators. */
function normalizePhone(raw) {
  let p = asciiDigits(raw == null ? '' : raw).replace(/[\s\-().]/g, '');
  if (/^00\d/.test(p)) p = '+' + p.slice(2);
  if (/^0\d{8,9}$/.test(p)) return '+971' + p.slice(1);       // 050 123 4567, 04 123 4567
  if (/^971\d{8,9}$/.test(p)) return '+' + p;                  // 971501234567
  if (/^\+9710\d{8,9}$/.test(p)) return '+971' + p.slice(5);   // +971 050…, trunk zero kept
  return p;
}

/**
 * What every spelling of one number has in common: the last 9 digits once
 * the 00971 / 971 / 0 prefix is off. For a mobile that is simply its last 9
 * digits; the prefix matters for an 8-digit landline (04 123 4567 vs
 * +971 4 123 4567), whose last 9 digits would otherwise differ.
 */
function phoneKey(raw) {
  return asciiDigits(raw == null ? '' : raw).replace(/\D/g, '').replace(/^(00971|971|0)/, '').slice(-9);
}
const PHONE_KEY_SQL = "RIGHT(REGEXP_REPLACE(REGEXP_REPLACE(phone, '[^0-9]', ''), '^(00971|971|0)', ''), 9)";

/** '-', '+971' and '' hold no number. The internal accounts were imported with '-' (#79). */
function isPlaceholderPhone(raw) {
  return asciiDigits(raw == null ? '' : raw).replace(/\D/g, '').replace(/^(00)?971/, '') === '';
}

/** An ACTIVE customer already on this number (other than `exceptId`), or null. */
async function findPhoneOwner(run, workshopId, phone, exceptId = null) {
  const rows = await run(
    `SELECT id, full_name, phone, customer_class, customer_subcategory FROM customers
      WHERE workshop_id = ? AND is_active = 1
        AND ${PHONE_KEY_SQL} = ? ${exceptId ? 'AND id <> ?' : ''}
      ORDER BY id LIMIT 1`,
    exceptId ? [workshopId, phoneKey(phone), exceptId] : [workshopId, phoneKey(phone)]
  );
  return rows[0] || null;
}

/** 409 naming the customer who has the number, so the wizard can offer "Use this customer". */
function duplicatePhone(res, dup) {
  return res.status(409).json({
    success: false,
    code: 'DUPLICATE_PHONE',
    message: `A customer with this phone number already exists: ${dup.full_name} (${dup.phone}).`,
    existing: {
      id: dup.id, full_name: dup.full_name, phone: dup.phone,
      customer_class: dup.customer_class, customer_subcategory: dup.customer_subcategory,
    },
  });
}

// #93: the name is printed on the job card, the estimate and the gate pass.
// _clean strips markup and stripMarkup cuts at 255, so a name with a '<' in
// it or an over-long one was stored as something other than what the advisor
// typed and saw on the review step. Refused with the reason instead.
function nameProblem(body, key, label) {
  const v = body ? body[key] : undefined;
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return `${label} must be text.`;
  if (/[<>]/.test(v)) return `${label} cannot contain < or >.`;
  const len = v.trim().length;
  if (len > 255) return `${label} must be 255 characters or fewer (this one has ${len}).`;
  return null;
}

const trimmed = v => (typeof v === 'string' ? v.trim() : v);
const truthy = v => v === true || v === 1 || v === '1' || v === 'true';

// SR-01/SR-16 — sanitise at the write boundary. Identity fields can never
// legitimately contain markup, so it is stripped; free text is stored verbatim
// because HTML-stripping a note destroys legitimate content such as
// "worn < 2mm". Only keys actually present in the body are touched, so the
// update routes' "default to the existing row" destructuring still works.
const CUSTOMERS_IDENTITY = ['full_name', 'company_name', 'email', 'phone', 'phone_alt', 'address_line1', 'address_line2', 'area', 'city', 'emirate', 'trn', 'contact_person', 'code'];
const CUSTOMERS_FREE_TEXT = ['notes'];
function _clean(body) {
  return clampTextFields(stripMarkupFields(body || {}, CUSTOMERS_IDENTITY), CUSTOMERS_FREE_TEXT);
}

// The portal login's secrets live on the customers row (customer-auth.js).
// Every route here answered with SELECT c.*, so any staff screen received the
// password hash and the live reset / verification tokens — a reset token is
// a way into the customer's account. They never leave the server.
const CUSTOMER_SECRETS = ['password_hash', 'reset_token', 'reset_token_expires', 'verification_token', 'verification_expires'];
function withoutSecrets(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of CUSTOMER_SECRETS) delete out[k];
  return out;
}


const router = express.Router();
router.use(authMiddleware);

// JUDGMENT CALL: dropped zone_id (geographic delivery-zone assignment) — a customer's
// service bay is decided per work order (which bay services their vehicle), not stored
// on the customer record. Kept city/emirate as plain address fields (still relevant —
// customers still have a home/business address in the UAE).
// JUDGMENT CALL: dropped custom_delivery_fee — not clearly reusable in a workshop context
// (no per-order delivery fee concept); tax_exempt / credit_limit / credit_used kept as-is
// since workshop credit accounts (e.g. fleet/corporate customers) are plausible.

// GET /api/customers
router.get('/', async (req, res) => {
  try {
    const {
      search, type, emirate, page = 1, limit = 50, sort,
      customer_class, customer_subcategory, active_only, include_inactive,
    } = req.query;
    const pg = parseInt(page, 10) || 1;
    const lim = parseInt(limit, 10) || 50;
    const offset = (pg - 1) * lim;
    let where = 'WHERE c.workshop_id = ?';
    const params = [req.workshopId];

    if (type) { where += ' AND c.client_category = ?'; params.push(type); }
    if (emirate) { where += ' AND c.emirate = ?'; params.push(emirate); }

    // Step 1 of the job card wizard filters on these two before showing a
    // single name. Validated against the enum rather than passed through:
    // an unrecognised value would otherwise return the whole unfiltered
    // book of 3,472 customers, which looks like the filter silently not
    // working rather than like an error.
    if (customer_class) {
      if (!['internal', 'external'].includes(customer_class)) {
        return res.status(400).json({ success: false, message: 'customer_class must be internal or external' });
      }
      where += ' AND c.customer_class = ?';
      params.push(customer_class);
    }
    if (customer_subcategory) {
      if (!['fleet', 'insurance', 'asset', 'walkin'].includes(customer_subcategory)) {
        return res.status(400).json({ success: false, message: 'customer_subcategory must be fleet, insurance, asset or walkin' });
      }
      where += ' AND c.customer_subcategory = ?';
      params.push(customer_subcategory);
    }
    // The wizard must not offer a deactivated account to raise a job card
    // against; the Customers screen still wants to list them. A search
    // leaves them out too — the wizard's duplicate-phone lookup offered a
    // deactivated customer to "use" (#90) — unless include_inactive=1.
    if (active_only === '1' || active_only === 'true'
        || (search && !(include_inactive === '1' || include_inactive === 'true'))) {
      where += ' AND c.is_active = 1';
    }
    if (search) {
      const term = String(search).trim();
      const like = `%${term}%`;
      // Plates and VINs compare on letters and digits only, so "G 10628",
      // "G-10628" and "g10628" all find the car stored as G10628, and a
      // code typed in front of the number finds a plate whose code is held
      // in its own column (#92).
      const key = asciiDigits(term).replace(/[^A-Za-z0-9]/g, '');
      // A phone in any spelling: digits only, without the 00971 / 971 / 0
      // prefix, and at most the last 9 (#12). Only for a term that is a
      // phone number, or a VIN's digits would match unrelated phones.
      let phoneDigits = /^[+\d\s\-().\u0660-\u0669\u06F0-\u06F9]+$/.test(term)
        ? asciiDigits(term).replace(/\D/g, '').replace(/^(00971|971|0)/, '')
        : '';
      if (phoneDigits.length > 9) phoneDigits = phoneDigits.slice(-9);
      const byPhone = phoneDigits.length >= 6;
      // Also matches by the plate/VIN of a vehicle the customer owns — the
      // front desk often has the car in front of them (or a VIN off a job
      // sheet) before they have a name to search by. An EXISTS subquery,
      // not a JOIN: this table is already GROUP BY c.id with an aggregate
      // work_orders join below, and a second join here would multiply each
      // customer's rows by their vehicle count before that GROUP BY ran,
      // silently inflating total_work_orders/lifetime_value for anyone with
      // more than one car.
      // `code` is in here because the wizard's search box is labelled
      // "name, code or phone" — the fleet desk quotes AST-001 down the
      // phone far more often than it spells out the registered company
      // name, which on these accounts runs to sixty characters.
      where += ` AND (c.full_name LIKE ? OR c.phone LIKE ? OR c.company_name LIKE ? OR c.email LIKE ?
                 OR c.code LIKE ?
                 ${byPhone ? `OR REGEXP_REPLACE(c.phone, '[^0-9]', '') LIKE ?
                 OR REGEXP_REPLACE(COALESCE(c.phone_alt, ''), '[^0-9]', '') LIKE ?` : ''}
                 OR EXISTS (SELECT 1 FROM vehicles v
                             WHERE v.customer_id = c.id
                               AND (v.plate_number LIKE ? OR v.vin LIKE ? OR v.fleet_code LIKE ?
                                    ${key ? `OR REGEXP_REPLACE(CONCAT(COALESCE(v.plate_code, ''), COALESCE(v.plate_number, '')), '[^A-Za-z0-9]', '') LIKE ?
                                    OR REGEXP_REPLACE(COALESCE(v.vin, ''), '[^A-Za-z0-9]', '') LIKE ?` : ''})))`;
      params.push(like, like, like, like, like);
      if (byPhone) params.push(`%${phoneDigits}%`, `%${phoneDigits}%`);
      params.push(like, like, like);
      if (key) params.push(`%${key}%`, `%${key}%`);
    }

    // Sort is interpolated into the SQL, so it is resolved through this map and
    // never from the raw query string.
    const ORDER_BY = {
      name:   'c.full_name ASC',
      // "Recent" means last touched in any way, so a job still in progress
      // counts. That is deliberately not the same as last_visit_at, which is
      // the last *completed* visit and must match the Customer 360 card.
      recent: 'last_activity_at IS NULL, last_activity_at DESC, c.created_at DESC',
      value:  'lifetime_value DESC, c.full_name ASC',
    };
    const orderBy = ORDER_BY[sort] || ORDER_BY.name;

    const [{ total }] = await query(`SELECT COUNT(*) as total FROM customers c ${where}`, params);
    const customers = await query(
      `SELECT c.*,
              COUNT(o.id) as total_work_orders,
              SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as completed_work_orders,
              MAX(o.completed_at) AS last_visit_at,
              MAX(o.created_at) AS last_activity_at,
              COALESCE(SUM(CASE WHEN o.status = 'completed'
                    THEN COALESCE(NULLIF(o.total_amount, 0), o.service_fee, 0)
                    ELSE 0 END), 0) AS lifetime_value
       FROM customers c
       LEFT JOIN work_orders o ON o.customer_id = c.id
       ${where} GROUP BY c.id ORDER BY ${orderBy} LIMIT ${lim} OFFSET ${offset}`,
      params
    );
    // `total` at the top level as well: the wizard shows "50 of 143" from it.
    return res.json({ success: true, data: customers.map(withoutSecrets), total, pagination: { total, page: pg, limit: lim } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch customers' });
  }
});

// GET /api/customers/stats  — aggregate KPIs for the workshop
router.get('/stats', async (req, res) => {
  try {
    // Rows 4-5 of the KPI matrix: new vs. repeat customer split, and repeat
    // rate, for a period. "Repeat" means the customer had a work order before
    // the period started too - not just more than one order inside it, which
    // would misclassify someone who booked twice in one week as a repeat
    // customer on their very first visit.
    const { from, to } = req.query;
    let periodStats = null;
    if (from && to) {
      // One row per customer, not per work order: the earlier version joined
      // at the order level, so a customer with 40 orders in the period was
      // counted 40 times and repeat_rate_pct came out as 4323%. Collapse to
      // distinct customers served in the period first, then classify each one
      // once against their all-time first order.
      const [p] = await query(
        `SELECT
           COUNT(*) AS served,
           SUM(fo.first_order >= ?) AS new_customers,
           SUM(fo.first_order <  ?) AS repeat_customers
         FROM (
           SELECT DISTINCT customer_id FROM work_orders
            WHERE workshop_id = ? AND customer_id IS NOT NULL
              AND created_at BETWEEN ? AND ?
         ) served
         JOIN (
           SELECT customer_id, MIN(created_at) AS first_order
             FROM work_orders WHERE workshop_id = ? GROUP BY customer_id
         ) fo ON fo.customer_id = served.customer_id`,
        [`${from} 00:00:00`, `${from} 00:00:00`, req.workshopId,
         `${from} 00:00:00`, `${to} 23:59:59`, req.workshopId]
      );
      const served = Number(p.served) || 0;
      const repeat = Number(p.repeat_customers) || 0;
      periodStats = {
        from, to,
        customers_served: served,
        new_customers: Number(p.new_customers) || 0,
        repeat_customers: repeat,
        repeat_rate_pct: served ? Math.round((repeat / served) * 100) : null,
      };
    }

    const [counts] = await query(
      `SELECT
         COUNT(*) as total,
         SUM(is_active = 1) as active,
         SUM(is_active = 0) as inactive,
         SUM(type = 'individual') as individual,
         SUM(type = 'business')   as business,
         SUM(type = 'fleet')      as fleet,
         SUM(type = 'other')      as other
       FROM customers WHERE workshop_id = ?`,
      [req.workshopId]
    );
    const [workOrderStats] = await query(
      `SELECT COUNT(o.id) as total_work_orders,
              SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as completed,
              SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) as failed
       FROM work_orders o
       INNER JOIN customers c ON o.customer_id = c.id
       WHERE c.workshop_id = ?`,
      [req.workshopId]
    );
    const topCustomers = await query(
      `SELECT c.id, c.full_name, c.company_name, c.type,
              COUNT(o.id) as total_work_orders,
              SUM(CASE WHEN o.status='completed' THEN 1 ELSE 0 END) as completed_work_orders
       FROM customers c
       LEFT JOIN work_orders o ON o.customer_id = c.id
       WHERE c.workshop_id = ? AND c.is_active = 1
       GROUP BY c.id ORDER BY total_work_orders DESC LIMIT 5`,
      [req.workshopId]
    );
    return res.json({
      success: true,
      data: { ...counts, ...workOrderStats, top_customers: topCustomers, period: periodStats },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// PATCH /api/customers/:id/toggle — activate / deactivate
// Managers only, the same as DELETE (which is how a customer is
// deactivated): a Storekeeper could switch accounts off through here (#43).
router.patch('/:id/toggle', requireManager, async (req, res) => {
  try {
    const [customer] = await query('SELECT id, is_active FROM customers WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    await execute('UPDATE customers SET is_active = ? WHERE id = ? AND workshop_id = ?',
      [!customer.is_active, req.params.id, req.workshopId]);
    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id, action: customer.is_active ? 'DEACTIVATE' : 'ACTIVATE',
      entityType: 'customers', entityId: customer.id, ip: req.ip,
    });
    return res.json({ success: true, data: { is_active: !customer.is_active } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to toggle customer status' });
  }
});

// ── Customer portal access ──────────────────────────────────────────────
// "Give portal access" on the customer page: the customer gets a portal login
// and a link to choose their password, sent by WhatsApp, e-mail or a copied
// link (lib/portal-access.js). The desk that deals with the customer gives it:
// the Service Advisor (estimates, the customer's decision, handover) and
// managers.
const canGivePortalAccess = user =>
  can(user, 'estimate.raise') || can(user, 'customer.approval') || can(user, 'delivery.handover');
const PORTAL_CHANNELS = ['whatsapp', 'email', 'link'];
const isRealEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());

function portalAccessData(c, user) {
  return {
    ...portalAccessStatus(c),
    can_send: canGivePortalAccess(user),
    can_email: isRealEmail(c.email),
    can_whatsapp: !!waDigits(c.phone),
  };
}

// GET /api/customers/:id/portal-access — where the customer's portal login stands.
router.get('/:id/portal-access', async (req, res) => {
  try {
    const c = await loadPortalCustomer(req.params.id, req.workshopId);
    if (!c) return res.status(404).json({ success: false, message: 'Customer not found' });
    return res.json({ success: true, data: portalAccessData(c, req.user) });
  } catch (err) {
    console.error('[Customers] Portal access status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load portal access' });
  }
});

/**
 * POST /api/customers/:id/portal-access — give portal access, or send a new link.
 * Body: { channel: 'whatsapp' | 'email' | 'link' }
 * Creates the portal login when missing, marks the customer verified, and
 * issues a set-password link valid for INVITE_DAYS (a new link replaces the
 * old one). 'whatsapp' returns a wa.me link for the screen to open (sent
 * from the advisor's WhatsApp); 'email' sends it from here; 'link' is the
 * copy button.
 */
router.post('/:id/portal-access', async (req, res) => {
  try {
    if (!canGivePortalAccess(req.user)) {
      return roleNotAllowed(res, "Your role can't give customers portal access. A Service Advisor or a manager does this.");
    }
    const channel = req.body?.channel || 'link';
    if (!PORTAL_CHANNELS.includes(channel)) {
      return res.status(400).json({ success: false, message: 'channel must be whatsapp, email or link' });
    }
    const c = await loadPortalCustomer(req.params.id, req.workshopId);
    if (!c) return res.status(404).json({ success: false, message: 'Customer not found' });
    if (channel === 'email' && !isRealEmail(c.email)) {
      return res.status(400).json({ success: false, code: 'NO_EMAIL', message: 'No e-mail on file for this customer — send it by WhatsApp, or copy the link.' });
    }
    if (channel === 'whatsapp' && !waDigits(c.phone)) {
      return res.status(400).json({ success: false, code: 'NO_PHONE', message: 'No mobile number on file for this customer — send it by e-mail, or copy the link.' });
    }

    const invite = await issuePortalInvite({ customer: c, staffUserId: req.user?.id || null });
    if (!invite.ok) return res.status(invite.status).json({ success: false, code: invite.code, message: invite.message });

    const [w] = await query('SELECT name FROM workshops WHERE id = ?', [req.workshopId]);
    const workshopName = stripMarkup(w?.name || 'Pioneer Car Service', 120);
    const name = stripMarkup(c.full_name || c.company_name || '', 120);
    const signInWith = [isRealEmail(c.email) ? 'your e-mail' : null, waDigits(c.phone) ? 'your mobile number' : null]
      .filter(Boolean).join(' or ');

    const out = { success: true, url: invite.url, expires_at: invite.expires_at, created: invite.created, emailed: false };
    if (channel === 'email') {
      const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      const sent = await sendNotificationEmail({
        to: c.email,
        tenantId: req.workshopId,
        subject: `Your customer portal — ${workshopName}`,
        title: 'Your customer portal is ready',
        body: `<p>Hello${name ? ` <strong>${esc(name)}</strong>` : ''},</p>
          <p>Follow your job card, sign your vehicle inspection, approve estimates and see your invoices in your customer portal.</p>
          <p>Choose your password with the button below. The link works for ${INVITE_DAYS} days.
             Then sign in with ${esc(signInWith || 'your e-mail')}.</p>`,
        ctaText: 'Set your password',
        ctaUrl: invite.url,
      });
      if (!sent?.success) {
        return res.status(502).json({ success: false, code: 'EMAIL_FAILED', message: 'The e-mail could not be sent — send it by WhatsApp, or copy the link.', url: invite.url });
      }
      out.emailed = true;
      out.message = `Sent to ${c.email}`;
    } else if (channel === 'whatsapp') {
      const text = `Hello${name ? ` ${name}` : ''}, this is ${workshopName}. Your customer portal is ready: ` +
        'follow your job card, sign your vehicle inspection, approve estimates and see your invoices. ' +
        `Set your password here (the link works for ${INVITE_DAYS} days): ${invite.url}` +
        (signInWith ? `\nThen sign in with ${signInWith}.` : '');
      out.whatsapp_url = `https://wa.me/${waDigits(c.phone)}?text=${encodeURIComponent(text)}`;
    }

    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id, action: 'PORTAL_INVITE', entityType: 'customers',
      entityId: c.id, newValue: { channel, login_created: invite.created }, ip: req.ip,
    });
    const fresh = await loadPortalCustomer(c.id, req.workshopId);
    out.data = portalAccessData(fresh, req.user);
    return res.json(out);
  } catch (err) {
    console.error('[Customers] Portal access error:', err);
    return res.status(500).json({ success: false, message: 'Failed to give portal access' });
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res) => {
  try {
    const [customer] = await query(
      `SELECT c.* FROM customers c
       WHERE c.id = ? AND c.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const [workOrderStats] = await query(
      `SELECT COUNT(*) as total_work_orders,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_work_orders,
              SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as failed_work_orders,
              SUM(CASE WHEN payment_method='cash' AND status='completed' THEN COALESCE(cash_amount,0) ELSE 0 END) as credit_used
       FROM work_orders WHERE customer_id = ?`,
      [req.params.id]
    );
    const workOrders = await query(
      `SELECT id, work_order_number, status, customer_approved_at, service_fee, total_amount, cash_amount, payment_method, created_at
       FROM work_orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );
    return res.json({ success: true, data: { ...withoutSecrets(customer), ...workOrderStats, work_orders: workOrders } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch customer' });
  }
});

// POST /api/customers
router.post('/', canEditCustomers, async (req, res) => {
  let conn = null;
  let lockName = null;
  try {
    const nameErr = nameProblem(req.body, 'full_name', 'Customer name')
      || nameProblem(req.body, 'company_name', 'Company name');
    if (nameErr) return res.status(400).json({ success: false, code: 'NAME_INVALID', message: nameErr });

    const {
      full_name: rawFullName, company_name: rawCompany, email: rawEmail, phone: rawPhone, phone_alt: rawPhoneAlt,
      type = 'individual',
      client_category = 'other', address_line1, address_line2, area, city,
      emirate: rawEmirate, latitude, longitude, credit_limit, notes,
      customer_class, customer_subcategory, code,
    } = _clean(req.body);
    const emirate = rawEmirate ? String(rawEmirate).slice(0, 100) : null;
    const full_name = trimmed(rawFullName);
    const company_name = trimmed(rawCompany);
    const email = trimmed(rawEmail);

    // ── Step 1 classification ──
    // Defaults to external/walkin, because the only caller that omits these
    // is the job card wizard creating a customer on the spot — which is, by
    // definition, a walk-in. An explicit value always wins, and an unknown
    // one is refused rather than quietly stored as something else (#82).
    const classIn = parseClass(customer_class);
    if (classIn === false) {
      return res.status(400).json({ success: false, message: 'customer_class must be internal or external' });
    }
    const subIn = parseSub(customer_subcategory);
    if (subIn === false) {
      return res.status(400).json({ success: false, message: 'customer_subcategory must be fleet, insurance, asset or walkin' });
    }
    const _class = classIn || 'external';
    const _sub = subIn !== undefined ? subIn : (classIn ? null : 'walkin');
    // An internal account's estimates skip the Supervisor / Workshop Manager
    // approval (document Step 4-5), so only a manager opens one (D7, C1).
    if (_class === 'internal' && !isManagerRole(req.user)) {
      return roleNotAllowed(res, 'Only the Workshop Manager can add an internal account: its estimates skip the Supervisor / Workshop Manager approval.');
    }
    // 'asset' is internal-only and 'walkin' external-only. Rejecting the
    // combination rather than quietly rewriting it: a caller that sends
    // external+asset has a bug, and silently storing something else makes
    // that bug invisible until the fleet desk cannot find the account.
    const classErr = classificationProblem(_class, _sub);
    if (classErr) return res.status(400).json({ success: false, message: classErr });

    if (!full_name || !rawPhone) {
      return res.status(400).json({ success: false, message: 'Name and phone required' });
    }
    // An unknown type reached MySQL and came back as a 500 "Failed to create customer".
    if (!CUSTOMER_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `Customer type must be one of: ${CUSTOMER_TYPES.join(', ')}` });
    }
    // Phone format validation, on the number as it will be stored
    const phone = normalizePhone(rawPhone);
    if (!/^\+?\d{7,20}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number format' });
    }
    const altNorm = rawPhoneAlt ? normalizePhone(rawPhoneAlt) : '';
    const phone_alt = /^\+?\d{7,20}$/.test(altNorm) ? altNorm : trimmed(rawPhoneAlt);
    // Email format (if provided)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    // Credit limit bounds
    if (credit_limit !== undefined && credit_limit !== null && Number(credit_limit) < 0) {
      return res.status(400).json({ success: false, message: 'Credit limit cannot be negative' });
    }
    // Coordinate bounds
    if (latitude !== undefined && latitude !== null && latitude !== '') {
      const lat = parseFloat(latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ success: false, message: 'Latitude must be between -90 and 90' });
      }
    }
    if (longitude !== undefined && longitude !== null && longitude !== '') {
      const lng = parseFloat(longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ success: false, message: 'Longitude must be between -180 and 180' });
      }
    }
    // Duplicate check — on the last 9 digits, among active customers (C4).
    // Check-then-insert is not atomic: two advisors saving the same walk-in
    // in the same instant both passed it (#158). A named lock on the number
    // holds the second one until the first has inserted.
    conn = await pool.getConnection();
    const run = (sql, params) => conn.query(sql, params).then(([rows]) => rows);
    const wanted = `customer-phone:${req.workshopId}:${phoneKey(phone)}`;
    const [lock] = await run('SELECT GET_LOCK(?, 5) AS got', [wanted]);
    if (lock && Number(lock.got) === 1) lockName = wanted;
    const dup = await findPhoneOwner(run, req.workshopId, phone);
    if (dup) return duplicatePhone(res, dup);

    const result = await run(
      `INSERT INTO customers (workshop_id, full_name, company_name, email, phone, phone_alt, type,
        client_category, customer_class, customer_subcategory, code,
        address_line1, address_line2, area, city, emirate,
        latitude, longitude, credit_limit, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.workshopId, full_name, company_name || null, email || null, phone, phone_alt || null,
       type, client_category, _class, _sub, code || null,
       address_line1 || null, address_line2 || null, area || null,
       city || null, emirate, latitude || null, longitude || null,
       credit_limit || 0, notes || null]
    );
    const [customer] = await run('SELECT * FROM customers WHERE id = ?', [result.insertId]);
    if (_class === 'internal') {
      await logAudit({
        workshopId: req.workshopId, userId: req.user?.id, action: 'CREATE', entityType: 'customers',
        entityId: result.insertId, newValue: { customer_class: _class, customer_subcategory: _sub }, ip: req.ip,
      });
    }
    return res.status(201).json({ success: true, data: withoutSecrets(customer) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Failed to create customer' });
  } finally {
    if (conn) {
      if (lockName) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
      conn.release();
    }
  }
});

// PUT /api/customers/:id
router.put('/:id', canEditCustomers, async (req, res) => {
  try {
    // Fetch existing record so partial updates don't null-out required fields
    const [existing] = await query('SELECT * FROM customers WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!existing) return res.status(404).json({ success: false, message: 'Customer not found' });

    const body = req.body || {};
    const sent = k => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
    const manager = isManagerRole(req.user);

    const nameErr = nameProblem(body, 'full_name', 'Customer name')
      || nameProblem(body, 'company_name', 'Company name');
    if (nameErr) return res.status(400).json({ success: false, code: 'NAME_INVALID', message: nameErr });

    const {
      full_name: rawFullName = existing.full_name,
      company_name: rawCompany = existing.company_name,
      email: rawEmail = existing.email,
      phone: rawPhone = existing.phone,
      phone_alt = existing.phone_alt,
      type = existing.type,
      client_category = existing.client_category,
      address_line1 = existing.address_line1,
      address_line2 = existing.address_line2,
      area = existing.area,
      city = existing.city,
      emirate = existing.emirate,
      latitude = existing.latitude,
      longitude = existing.longitude,
      credit_limit = existing.credit_limit,
      notes = existing.notes,
      code = existing.code,
    } = _clean(body);
    const full_name = trimmed(rawFullName);
    const company_name = trimmed(rawCompany);
    const email = trimmed(rawEmail);
    if (!full_name) {
      return res.status(400).json({ success: false, message: 'Customer name is required' });
    }
    if (!CUSTOMER_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `Customer type must be one of: ${CUSTOMER_TYPES.join(', ')}` });
    }

    // ── Step 1 classification (C1) ──
    // Reclassifying an account is how the remaining internal fleet and
    // insurance customers get set up — the migration could only promote the
    // seven it could identify by name, and who else belongs internal is a
    // business fact, not something to guess at from a company name.
    // It also decides whether estimates need the Supervisor / Workshop
    // Manager approval, so a change is a manager's (#6/#43). The one change
    // the counter makes is giving an external customer the subcategory it
    // was imported without (D5): that is filling a gap, not reclassifying.
    const classIn = parseClass(body.customer_class);
    if (classIn === false) {
      return res.status(400).json({ success: false, message: 'customer_class must be internal or external' });
    }
    const subIn = parseSub(body.customer_subcategory);
    if (subIn === false) {
      return res.status(400).json({ success: false, message: 'customer_subcategory must be fleet, insurance, asset or walkin' });
    }
    const _class = classIn || existing.customer_class;
    const _sub = subIn !== undefined ? subIn : (existing.customer_subcategory || null);
    const classChanged = _class !== existing.customer_class;
    const subChanged = _sub !== (existing.customer_subcategory || null);
    // Checked only on a change, so an old row is still editable as it is.
    if (classChanged || subChanged) {
      const fillingMissing = !classChanged && _class === 'external' && !existing.customer_subcategory;
      if (!manager && !fillingMissing) {
        return roleNotAllowed(res, classChanged
          ? 'Only the Workshop Manager can move a customer between Internal and External.'
          : "Only the Workshop Manager can change a customer's subcategory once it is set.");
      }
      const classErr = classificationProblem(_class, _sub);
      if (classErr) return res.status(400).json({ success: false, message: classErr });
    }

    // Deactivating is what DELETE does, and that is manager-only; this was
    // the way round it (#43).
    const isActive = sent('is_active') ? truthy(body.is_active) : !!existing.is_active;
    const activeChanged = isActive !== !!existing.is_active;
    if (activeChanged && !manager) {
      return roleNotAllowed(res, 'Only a manager can deactivate or reactivate a customer.');
    }

    // ── Phone ──
    // A number that is the same as the stored one (in any spelling) is not
    // re-validated, and a placeholder sent back for a placeholder ('-' on
    // the internal accounts, which the Customers form sends as '+971-')
    // keeps the stored value: otherwise their e-mail could not be updated
    // without also inventing a phone number (#79).
    let phone = existing.phone;
    if (sent('phone')) {
      if (isPlaceholderPhone(rawPhone)) {
        if (!isPlaceholderPhone(existing.phone)) {
          return res.status(400).json({ success: false, message: 'Phone number is required' });
        }
      } else {
        phone = normalizePhone(rawPhone);
        if (!/^\+?\d{7,20}$/.test(phone)) {
          return res.status(400).json({ success: false, message: 'Invalid phone number format' });
        }
        if (phoneKey(phone) !== phoneKey(existing.phone)) {
          const dup = await findPhoneOwner(query, req.workshopId, phone, existing.id);
          if (dup) return duplicatePhone(res, dup);
        }
      }
    }
    // Validate email format if changed
    if (sent('email') && email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    // Credit limit bounds
    if (body.credit_limit !== undefined && Number(credit_limit) < 0) {
      return res.status(400).json({ success: false, message: 'Credit limit cannot be negative' });
    }
    // Coordinate bounds
    if (body.latitude !== undefined && latitude !== null && latitude !== '') {
      const lat = parseFloat(latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ success: false, message: 'Latitude must be between -90 and 90' });
      }
    }
    if (body.longitude !== undefined && longitude !== null && longitude !== '') {
      const lng = parseFloat(longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ success: false, message: 'Longitude must be between -180 and 180' });
      }
    }

    await execute(
      `UPDATE customers SET full_name=?, company_name=?, email=?, phone=?, phone_alt=?, type=?,
       client_category=?, customer_class=?, customer_subcategory=?, code=?,
       address_line1=?, address_line2=?, area=?, city=?, emirate=?,
       latitude=?, longitude=?, credit_limit=?, notes=?, is_active=?
       WHERE id = ? AND workshop_id = ?`,
      [full_name, company_name || null, email || null, phone, phone_alt || null,
       type || 'individual', client_category || 'other',
       _class, _sub, code || null,
       address_line1 || null,
       address_line2 || null, area || null, city || null,
       emirate ? String(emirate).slice(0, 100) : (existing.emirate || null),
       latitude || null, longitude || null, credit_limit || 0,
       notes || null, isActive, req.params.id, req.workshopId]
    );
    // Who reclassified or switched off an account was not recorded anywhere.
    if (classChanged || subChanged) {
      await logAudit({
        workshopId: req.workshopId, userId: req.user?.id, action: 'RECLASSIFY', entityType: 'customers', entityId: existing.id,
        oldValue: { customer_class: existing.customer_class, customer_subcategory: existing.customer_subcategory },
        newValue: { customer_class: _class, customer_subcategory: _sub }, ip: req.ip,
      });
    }
    if (activeChanged) {
      await logAudit({
        workshopId: req.workshopId, userId: req.user?.id, action: isActive ? 'ACTIVATE' : 'DEACTIVATE',
        entityType: 'customers', entityId: existing.id, ip: req.ip,
      });
    }
    const [customer] = await query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    return res.json({ success: true, data: withoutSecrets(customer) });
  } catch (err) {
    console.error('[Customers] Update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update customer' });
  }
});

// DELETE /api/customers/:id
router.delete('/:id', requireManager, async (req, res) => {
  try {
    await execute('UPDATE customers SET is_active = FALSE WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]);
    return res.json({ success: true, message: 'Customer deactivated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to deactivate customer' });
  }
});

export default router;
