/**
 * portal-access.js — a workshop customer's login to the customer portal.
 *
 * Customers do not have to register themselves. The Service Advisor opens the
 * customer page and presses "Give portal access" (POST
 * /api/customers/:id/portal-access): the customer gets a portal login, is
 * marked verified (staff know who they are), and receives a link to choose
 * their password — by WhatsApp, e-mail or a copied link, like the inspection
 * link. "Send a new link" issues a fresh one. They then sign in with their
 * e-mail or mobile number.
 *
 * The login is a `users` row with role 'customer' (username customer_<id>,
 * linked from customers.user_id) — what the JWT and authMiddleware need. Its
 * password is random and unusable until the customer sets theirs; the portal
 * checks customers.password_hash, which stays empty until then.
 *
 * The set-password link reuses the reset-password columns and page
 * (customers.reset_token / reset_token_expires), with 7 days to use it.
 *
 * Also the one place portal links are built (portalUrl), so e-mails point at
 * the portal's real pages: /customer/* (the old /portal/* and /merchant/*
 * paths redirect there on the front end, query string kept).
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, execute } from './database.js';
import { customerAppBase } from './customer-link.js';

/**
 * Express middleware for the portal's routes: the portal sends its own token
 * in the Authorization header (crm_token). In a browser where a staff member
 * is signed in, the shared `auth_token` cookie is the staff login. When the
 * request carries a Bearer token, that is the credential this client chose;
 * the cookie is dropped. authMiddleware (requestToken) now prefers the header
 * everywhere; this stays so the portal never falls back to a staff cookie.
 */
export function preferBearerToken(req, _res, next) {
  if (/^Bearer\s+\S/.test(req.headers.authorization || '') && req.cookies) delete req.cookies.auth_token;
  next();
}

/** Where the customer portal lives on the front end (/customer/login, /customer/dashboard …). */
export const PORTAL_BASE = '/customer';

/** How long a staff invitation (set-password link) stays valid. */
export const INVITE_DAYS = 7;

/**
 * An absolute link to a portal page.
 * @param {string} page  e.g. 'login', 'reset-password', 'set-password', 'verify-email'
 * @param {Record<string,string>} [params]  query string
 * @example portalUrl('set-password', { token }) // 'https://app.pioneercarservice.com/customer/set-password?token=…'
 */
export function portalUrl(page = '', params = null) {
  const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString() : '';
  return `${customerAppBase()}${PORTAL_BASE}/${String(page).replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}

// ── Phone numbers ──
// The same rule as routes/customers.js phoneKey: two spellings of one number
// (05X…, +9715X…, 009715X…, spaced) share their last 9 digits once the
// 00971 / 971 / 0 prefix is off. A customer signs in with any of them.

/** Arabic-Indic digits as ASCII. */
const asciiDigits = s => String(s)
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));

export function phoneKey(raw) {
  return asciiDigits(raw == null ? '' : raw).replace(/\D/g, '').replace(/^(00971|971|0)/, '').slice(-9);
}

/** SQL for phoneKey() on a column. */
export const phoneKeySql = col => `RIGHT(REGEXP_REPLACE(REGEXP_REPLACE(${col}, '[^0-9]', ''), '^(00971|971|0)', ''), 9)`;

/** True when the typed sign-in name is a phone number rather than an e-mail. */
export function looksLikePhone(identifier) {
  const s = String(identifier || '').trim();
  return !s.includes('@') && /^[+\d\s\-().٠-٩۰-۹]{7,}$/.test(s) && phoneKey(s).length >= 7;
}

/** wa.me wants the number in international form, digits only (UAE numbers on file are often local). */
export function waDigits(phone) {
  let d = asciiDigits(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (/^0\d{8,9}$/.test(d)) d = `971${d.slice(1)}`;
  if (/^9710\d{8,9}$/.test(d)) d = `971${d.slice(4)}`;
  return d.length >= 8 ? d : '';
}

const isRealEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());

/**
 * Where a customer's portal access stands, for the customer page.
 *   none    — no portal login
 *   invited — a login exists, never signed in (invite_expired when the link ran out and no password was set)
 *   active  — has signed in (last_login_at)
 */
export function portalAccessStatus(c) {
  if (!c) return null;
  const hasLogin = !!c.user_id && !!c.u_id;
  const expires = c.reset_token_expires ? new Date(c.reset_token_expires) : null;
  let status = 'none';
  if (hasLogin) status = c.last_login_at ? 'active' : 'invited';
  return {
    status,
    invited_at: c.portal_invited_at || null,
    link_expires_at: status !== 'none' && c.reset_token && expires ? expires : null,
    invite_expired: status === 'invited' && !c.password_hash && (!expires || expires < new Date()),
    has_password: !!c.password_hash,
    last_login_at: c.last_login_at || null,
    login_email: isRealEmail(c.email) ? c.email : null,
    login_phone: phoneKey(c.phone).length >= 7 ? c.phone : null,
    is_active: !!c.is_active,
  };
}

/** The customer row with what portalAccessStatus() needs. */
export async function loadPortalCustomer(customerId, workshopId) {
  const [c] = await query(
    `SELECT c.id, c.workshop_id, c.full_name, c.company_name, c.email, c.phone, c.is_active, c.user_id,
            c.password_hash, c.reset_token, c.reset_token_expires, c.last_login_at, c.portal_invited_at,
            u.id AS u_id, u.role AS u_role, u.workshop_id AS u_workshop_id
       FROM customers c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = ? AND c.workshop_id = ?`,
    [customerId, workshopId]
  );
  return c || null;
}

/**
 * Create the customer's portal login when missing, mark them verified and
 * issue a fresh set-password link (INVITE_DAYS). An existing password stays
 * until the customer uses the link.
 *
 * @returns {Promise<{ok: true, url: string, token: string, expires_at: Date, created: boolean}
 *                  | {ok: false, status: number, code: string, message: string}>}
 */
export async function issuePortalInvite({ customer: c, staffUserId = null }) {
  if (!c.is_active) {
    return { ok: false, status: 409, code: 'CUSTOMER_INACTIVE', message: 'This customer is deactivated. Reactivate them first.' };
  }
  if (!isRealEmail(c.email) && phoneKey(c.phone).length < 7) {
    return { ok: false, status: 400, code: 'NO_CONTACT', message: 'Add an e-mail or a mobile number to this customer first — they sign in with one of them.' };
  }

  let userId = c.u_id || null;
  let created = false;
  if (userId && (c.u_role !== 'customer' || Number(c.u_workshop_id) !== Number(c.workshop_id))) {
    // customers.user_id pointing at a staff login: never hand that out.
    return { ok: false, status: 409, code: 'LINKED_TO_STAFF', message: 'This customer record is linked to a staff login. Ask a manager to fix the record.' };
  }
  if (!userId) {
    const username = `customer_${c.id}`;
    const [existing] = await query('SELECT id, role, workshop_id FROM users WHERE username = ?', [username]);
    if (existing && (existing.role !== 'customer' || Number(existing.workshop_id) !== Number(c.workshop_id))) {
      return { ok: false, status: 409, code: 'USERNAME_TAKEN', message: `The login name ${username} is already in use.` };
    }
    if (existing) {
      userId = existing.id;
    } else {
      // users.email is unique across the platform and required; the customer
      // signs in through the customers row, so a placeholder is fine when the
      // address is missing or another account already has it.
      let email = isRealEmail(c.email) ? String(c.email).trim() : null;
      if (email) {
        const [taken] = await query('SELECT id FROM users WHERE email = ?', [email]);
        if (taken) email = null;
      }
      const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const r = await execute(
        `INSERT INTO users (workshop_id, full_name, username, email, phone, password, role, is_active, is_owner)
         VALUES (?, ?, ?, ?, ?, ?, 'customer', 1, 0)`,
        [c.workshop_id, c.full_name || c.company_name || username, username, email || `${username}@portal.invalid`,
         c.phone || null, unusable]
      );
      userId = r.insertId;
      created = true;
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  await execute(
    `UPDATE customers
        SET user_id = ?, is_verified = 1, verification_token = NULL, verification_expires = NULL,
            reset_token = ?, reset_token_expires = ?, portal_invited_at = NOW(), portal_invited_by = ?
      WHERE id = ? AND workshop_id = ?`,
    [userId, token, expires, staffUserId, c.id, c.workshop_id]
  );
  await execute('UPDATE users SET is_active = 1 WHERE id = ? AND role = ?', [userId, 'customer']);
  return { ok: true, url: portalUrl('set-password', { token }), token, expires_at: expires, created };
}
