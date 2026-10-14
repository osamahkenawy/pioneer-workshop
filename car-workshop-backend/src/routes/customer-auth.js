/**
 * Customer Portal — Authentication Routes
 *
 * Customer self-registration, login, password reset.
 * Customers are stored in the `customers` table with a linked `users` row (role='customer').
 * Most workshop customers do not register: staff give them access from the
 * customer page (lib/portal-access.js), and they choose their password from
 * the link they are sent (POST /reset-password).
 *
 * Endpoints (mounted at /api/customer-auth):
 *   POST /register             — customer self-registration
 *   POST /verify-email         — email verification
 *   POST /resend-verification  — send the verification e-mail again
 *   POST /login                — customer login (e-mail or mobile number) → JWT
 *   POST /forgot-password      — password reset e-mail
 *   POST /reset-password       — set a new password via token (also the staff invitation's set-password link)
 *   GET  /session              — validate session
 *   PUT  /change-password      — change password (authed)
 *   POST /logout
 *
 * Links in e-mails go to the portal's own pages, /customer/* (portalUrl):
 * /customer/verify-email, /customer/reset-password, /customer/set-password.
 * The front end redirects the older /portal/* and /merchant/* paths there.
 *
 * The portal sends its token in the Authorization header (crm_token in the
 * browser). Login no longer sets the shared `auth_token` cookie: the staff
 * app uses that cookie too, so a customer signing in on a staff member's
 * browser turned every staff request into the customer's (403s), and logging
 * out of the portal signed staff out. authMiddleware reads the header first.
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, execute } from '../lib/database.js';
import { generateToken, authMiddleware, verifyToken } from '../middleware/auth.js';
import { sendNotificationEmail } from '../lib/email.js';
import { loginLimiter, passwordResetLimiter, registrationLimiter, tokenRedeemLimiter } from '../lib/rate-limits.js';
import { portalUrl, phoneKey, phoneKeySql, looksLikePhone, preferBearerToken } from '../lib/portal-access.js';

const router = express.Router();

/** Names go into e-mail HTML. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ──────────────────────────────────────────────────────────────
 * DB schema migration — ensure customers table has auth columns
 * Runs once on first import (idempotent). portal_invited_* also come with
 * migrations/20261018_customer_portal_invite.sql.
 * ────────────────────────────────────────────────────────────── */
async function ensureCustomerAuthSchema() {
  const cols = [
    { col: 'password_hash',       def: "ALTER TABLE customers ADD COLUMN password_hash VARCHAR(255) DEFAULT NULL" },
    { col: 'is_verified',         def: "ALTER TABLE customers ADD COLUMN is_verified TINYINT(1) DEFAULT 0" },
    { col: 'verification_token',  def: "ALTER TABLE customers ADD COLUMN verification_token VARCHAR(255) DEFAULT NULL" },
    { col: 'verification_expires', def: "ALTER TABLE customers ADD COLUMN verification_expires DATETIME DEFAULT NULL" },
    { col: 'reset_token',         def: "ALTER TABLE customers ADD COLUMN reset_token VARCHAR(255) DEFAULT NULL" },
    { col: 'reset_token_expires', def: "ALTER TABLE customers ADD COLUMN reset_token_expires DATETIME DEFAULT NULL" },
    { col: 'last_login_at',       def: "ALTER TABLE customers ADD COLUMN last_login_at DATETIME DEFAULT NULL" },
    { col: 'portal_invited_at',   def: "ALTER TABLE customers ADD COLUMN portal_invited_at DATETIME DEFAULT NULL" },
    { col: 'portal_invited_by',   def: "ALTER TABLE customers ADD COLUMN portal_invited_by INT DEFAULT NULL" },
  ];

  for (const { col, def } of cols) {
    try {
      await execute(def);
      console.log(`  ✅ customers.${col} added`);
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') continue; // already exists
      // Check for "Duplicate column name" in message
      if (err.message?.includes('Duplicate column')) continue;
      console.error(`  ⚠️  Failed to add customers.${col}:`, err.message);
    }
  }

  // Ensure index on email for login lookups
  try {
    await execute('ALTER TABLE customers ADD INDEX idx_customer_email (email)');
  } catch { /* already exists */ }
  try {
    await execute('ALTER TABLE customers ADD INDEX idx_customer_phone (phone)');
  } catch { /* already exists */ }
}

// Run migration on import
ensureCustomerAuthSchema().catch(err => console.error('Customer auth schema error:', err.message));

/* ──────────────────────────────────────────────────────────────
 * Helper: resolve workshop from slug or pick the first active one
 * ────────────────────────────────────────────────────────────── */
async function resolveWorkshop(slug) {
  if (slug) {
    const [w] = await query(
      "SELECT id, name, slug, logo_url, logo_url_white, industry, status FROM workshops WHERE slug = ? AND status != 'cancelled'",
      [slug]
    );
    return w || null;
  }
  // Fallback: first active workshop
  const [w] = await query(
    "SELECT id, name, slug, logo_url, logo_url_white, industry, status FROM workshops WHERE status != 'cancelled' ORDER BY id ASC LIMIT 1"
  );
  return w || null;
}

/**
 * Customers matching what was typed at sign-in: an e-mail, or a mobile
 * number in any spelling (05…, +9715…, 009715…). `extraWhere` narrows it
 * (e.g. 'c.password_hash IS NOT NULL'). Most recently active first.
 */
async function findCustomersByLogin(identifier, { workshopId = null, extraWhere = '1=1', limit = 1 } = {}) {
  const id = String(identifier || '').trim();
  if (!id) return [];
  const byPhone = looksLikePhone(id);
  const match = byPhone ? `${phoneKeySql('c.phone')} = ?` : 'c.email = ?';
  const params = [byPhone ? phoneKey(id) : id];
  let scope = 'JOIN workshops w ON c.workshop_id = w.id AND w.status NOT IN (\'cancelled\',\'suspended\')';
  if (workshopId) { scope += ' AND w.id = ?'; params.unshift(workshopId); }
  return query(
    `SELECT c.*, u.id AS u_id, u.username, u.is_active AS user_active
       FROM customers c
       ${scope}
       LEFT JOIN users u ON c.user_id = u.id
      WHERE ${match} AND ${extraWhere}
      ORDER BY c.last_login_at IS NULL, c.last_login_at DESC, c.id DESC
      LIMIT ${Number(limit) || 1}`,
    params
  );
}

function sendVerificationEmail({ to, workshopId, workshopName, name, token }) {
  return sendNotificationEmail({
    to,
    tenantId: workshopId,
    subject: 'Confirm your e-mail for the customer portal',
    title: `Welcome to ${workshopName || 'the workshop'}`,
    body: `
      <p>Hi <strong>${esc(name)}</strong>,</p>
      <p>Please confirm your e-mail address to open your customer portal, where you can follow your job card,
         sign your vehicle inspection, approve estimates and see your invoices.</p>
    `,
    ctaText: 'Confirm e-mail',
    ctaUrl: portalUrl('verify-email', { token }),
  });
}

/* ══════════════════════════════════════════════════════════════
 * POST /register — Customer self-registration
 * ══════════════════════════════════════════════════════════════ */
router.post('/register', registrationLimiter, async (req, res) => {
  try {
    const {
      full_name, company_name, email, phone, password,
      address_line1, address_line2, city, emirate = 'Dubai',
      type = 'individual', workshop_slug
    } = req.body;

    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, phone, and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    // Resolve workshop
    const workshop = await resolveWorkshop(workshop_slug);
    if (!workshop) {
      return res.status(400).json({ success: false, message: 'Invalid platform domain' });
    }
    if (workshop.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'This platform is currently suspended' });
    }

    // Check duplicate email/phone within workshop. A customer who has been
    // here before is already on file: their access comes from the workshop
    // (the link the Service Advisor sends), not a second record.
    const [existing] = await query(
      'SELECT id FROM customers WHERE workshop_id = ? AND (email = ? OR phone = ?)',
      [workshop.id, email, phone]
    );
    if (existing) {
      return res.status(409).json({
        success: false, code: 'ALREADY_CUSTOMER',
        message: 'You are already one of our customers. Sign in, or ask the workshop to send you a link to set up your access.',
      });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // Create customer record
    const customerResult = await execute(
      `INSERT INTO customers (
        workshop_id, full_name, company_name, email, phone,
        type, address_line1, address_line2, city, emirate,
        password_hash, is_verified, verification_token, verification_expires,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)`,
      [
        workshop.id, full_name, company_name || null, email, phone,
        type, address_line1 || null, address_line2 || null, city || null, emirate,
        password_hash, verificationToken, verificationExpires,
      ]
    );

    const customerId = customerResult.insertId;

    // Also create a user record with role='customer' for JWT auth middleware compatibility
    const username = `customer_${customerId}`;
    const userResult = await execute(
      `INSERT INTO users (workshop_id, full_name, username, email, phone, password, role, is_active, is_owner)
       VALUES (?, ?, ?, ?, ?, ?, 'customer', 1, 0)`,
      [workshop.id, full_name, username, email, phone, password_hash]
    );
    const userId = userResult.insertId;

    // Link customer to user
    await execute('UPDATE customers SET user_id = ? WHERE id = ?', [userId, customerId]);

    sendVerificationEmail({ to: email, workshopId: workshop.id, workshopName: workshop.name, name: full_name, token: verificationToken })
      .catch(err => console.error('[CustomerAuth] Verification email error:', err.message));

    // The token comes back in the body (the portal keeps it in the browser);
    // the account works once the e-mail is confirmed.
    const token = generateToken({ id: userId, username, role: 'customer', workshop_id: workshop.id });

    return res.status(201).json({
      success: true,
      data: {
        id: userId,
        customer_id: customerId,
        full_name,
        company_name: company_name || null,
        email,
        phone,
        role: 'customer',
        is_verified: false,
        workshop: {
          id: workshop.id,
          name: workshop.name,
          slug: workshop.slug,
          logo_url: workshop.logo_url,
          logo_url_white: workshop.logo_url_white,
        },
        token,
      },
    });
  } catch (err) {
    console.error('[CustomerAuth] Register error:', err);
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
 * POST /verify-email — Verify email with token
 * ══════════════════════════════════════════════════════════════ */
router.post('/verify-email', tokenRedeemLimiter, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Verification token required' });

    const [customer] = await query(
      'SELECT id, user_id FROM customers WHERE verification_token = ? AND verification_expires > NOW()',
      [String(token)]  // never an object: it would format into a match-anything condition
    );
    if (!customer) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification link' });
    }

    await execute(
      'UPDATE customers SET is_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?',
      [customer.id]
    );

    return res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    console.error('[CustomerAuth] Verify error:', err);
    return res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
 * POST /resend-verification — the confirmation e-mail again
 * The login screen's "Resend" called the workshop sign-up's
 * /api/public/resend-verification, which knows nothing of customers.
 * Same answer whether or not the address is on file.
 * ══════════════════════════════════════════════════════════════ */
router.post('/resend-verification', passwordResetLimiter, async (req, res) => {
  const done = () => res.json({ success: true, message: 'If that account is waiting for confirmation, we have sent the e-mail again.' });
  try {
    const identifier = req.body?.email || req.body?.identifier;
    if (!identifier) return res.status(400).json({ success: false, message: 'Email required' });
    const [c] = await findCustomersByLogin(identifier, { extraWhere: 'c.is_verified = 0 AND c.password_hash IS NOT NULL' });
    if (!c || !c.email) return done();
    const token = crypto.randomBytes(32).toString('hex');
    await execute('UPDATE customers SET verification_token = ?, verification_expires = ? WHERE id = ?',
      [token, new Date(Date.now() + 24 * 60 * 60 * 1000), c.id]);
    const [w] = await query('SELECT name FROM workshops WHERE id = ?', [c.workshop_id]);
    sendVerificationEmail({ to: c.email, workshopId: c.workshop_id, workshopName: w?.name, name: c.full_name, token })
      .catch(err => console.error('[CustomerAuth] Resend verification error:', err.message));
    return done();
  } catch (err) {
    console.error('[CustomerAuth] Resend verification error:', err);
    return res.status(500).json({ success: false, message: 'Request failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
 * POST /login — Customer login
 * Body: { email, password } — `email` is the e-mail OR the mobile number
 * (`identifier` is accepted too).
 * ══════════════════════════════════════════════════════════════ */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { password, workshop_slug } = req.body;
    const identifier = req.body.identifier || req.body.email;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Email or mobile number and password required' });
    }

    let workshop = null;
    if (workshop_slug) {
      workshop = await resolveWorkshop(workshop_slug);
      if (!workshop) {
        return res.status(400).json({ success: false, message: 'Platform not found' });
      }
    }
    // One phone can be on more than one record (a family car, an old
    // duplicate): the password decides which one is signing in.
    const candidates = await findCustomersByLogin(identifier, {
      workshopId: workshop?.id || null, extraWhere: 'c.password_hash IS NOT NULL', limit: 5,
    });
    let customer = null;
    for (const c of candidates) {
      if (await bcrypt.compare(String(password), c.password_hash)) { customer = c; break; }
    }
    if (!customer) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (!workshop) {
      [workshop] = await query(
        'SELECT id, name, slug, logo_url, logo_url_white, industry, status, phone, currency FROM workshops WHERE id = ?',
        [customer.workshop_id]
      );
    }

    if (!customer.is_active || (customer.u_id && !customer.user_active)) {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact the workshop.' });
    }
    if (!customer.u_id) {
      // A password with no portal login behind it: the token would name no user.
      return res.status(403).json({ success: false, code: 'NO_PORTAL_LOGIN', message: 'Your portal access is not set up yet. Ask the workshop to send you a link.' });
    }

    if (!customer.is_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email first. Check your inbox.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    // Update last login
    await execute('UPDATE customers SET last_login_at = NOW() WHERE id = ?', [customer.id]);
    await execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [customer.u_id]);

    // Generate JWT
    const token = generateToken({
      id: customer.u_id,
      username: customer.username || `customer_${customer.id}`,
      role: 'customer',
      workshop_id: workshop.id,
    });

    return res.json({
      success: true,
      data: {
        id: customer.u_id,
        customer_id: customer.id,
        full_name: customer.full_name,
        company_name: customer.company_name,
        email: customer.email,
        phone: customer.phone,
        role: 'customer',
        is_verified: !!customer.is_verified,
        workshop: {
          id: workshop.id,
          name: workshop.name,
          slug: workshop.slug,
          logo_url: workshop.logo_url,
          logo_url_white: workshop.logo_url_white,
          industry: workshop.industry,
          phone: workshop.phone || null,
          currency: workshop.currency || 'AED',
        },
        token,
      },
    });
  } catch (err) {
    console.error('[CustomerAuth] Login error:', err);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
 * POST /forgot-password — Send reset email
 * Body: { email } — the e-mail or mobile number; the link goes to the
 * e-mail on file. Also for a customer who was given access and never set a
 * password (their invitation ran out).
 * ══════════════════════════════════════════════════════════════ */
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const identifier = req.body?.email || req.body?.identifier;
    if (!identifier) return res.status(400).json({ success: false, message: 'Email required' });

    // Always respond success to prevent enumeration
    const [customer] = await findCustomersByLogin(identifier, {
      extraWhere: "(c.password_hash IS NOT NULL OR c.user_id IS NOT NULL) AND c.is_active = 1 AND c.email IS NOT NULL AND c.email <> ''",
    });

    if (customer) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await execute(
        'UPDATE customers SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
        [resetToken, resetExpires, customer.id]
      );

      sendNotificationEmail({
        to: customer.email,
        tenantId: customer.workshop_id,
        subject: 'Reset your customer portal password',
        title: 'Reset your password',
        body: `
          <p>Hi <strong>${esc(customer.full_name || 'there')}</strong>,</p>
          <p>We received a request to reset the password of your customer portal.</p>
          <p>Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
          <p>If you didn't ask for this, you can ignore this e-mail.</p>
        `,
        ctaText: 'Reset password',
        ctaUrl: portalUrl('reset-password', { token: resetToken }),
      }).catch(err => console.error('[CustomerAuth] Reset email error:', err.message));
    }

    return res.json({
      success: true,
      message: "If that account is registered, you'll receive a reset link by e-mail shortly.",
    });
  } catch (err) {
    console.error('[CustomerAuth] Forgot password error:', err);
    return res.status(500).json({ success: false, message: 'Request failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
 * POST /reset-password — Set new password via token
 * Also the staff invitation's set-password link (lib/portal-access.js).
 * The link reached the customer through a channel on file, so using it
 * confirms them (is_verified).
 * ══════════════════════════════════════════════════════════════ */
router.post('/reset-password', tokenRedeemLimiter, async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res.status(400).json({ success: false, message: 'Token and new password required' });
    }
    if (String(new_password).length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const [customer] = await query(
      `SELECT c.id, c.user_id, c.email, c.phone, u.id AS u_id
         FROM customers c LEFT JOIN users u ON u.id = c.user_id AND u.role = 'customer'
        WHERE c.reset_token = ? AND c.reset_token_expires > NOW()`,
      [String(token)]  // never an object: it would format into a match-anything condition
    );
    if (!customer) {
      return res.status(400).json({ success: false, code: 'LINK_EXPIRED', message: 'This link has expired or was already used. Ask the workshop for a new one.' });
    }

    const hashed = await bcrypt.hash(String(new_password), 12);

    // Update customer password; the link is used up.
    await execute(
      'UPDATE customers SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, is_verified = 1 WHERE id = ?',
      [hashed, customer.id]
    );

    // Also update the linked user
    if (customer.u_id) {
      await execute('UPDATE users SET password = ? WHERE id = ?', [hashed, customer.u_id]);
    }

    return res.json({
      success: true,
      message: 'Password saved. You can now sign in.',
      // What to sign in with, so the page can say it.
      data: { email: customer.email || null, phone: customer.phone || null },
    });
  } catch (err) {
    console.error('[CustomerAuth] Reset password error:', err);
    return res.status(500).json({ success: false, message: 'Reset failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
 * GET /session — Validate customer session
 * ══════════════════════════════════════════════════════════════ */
router.get('/session', preferBearerToken, authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ success: false, message: 'Not a customer account' });
    }

    const [customer] = await query(
      `SELECT c.*, w.name as workshop_name, w.slug as workshop_slug, w.logo_url as workshop_logo,
              w.logo_url_white as workshop_logo_white, w.industry as workshop_type, w.status as workshop_status,
              w.phone as workshop_phone, w.currency as workshop_currency
       FROM customers c
       LEFT JOIN workshops w ON c.workshop_id = w.id
       WHERE c.user_id = ? AND c.workshop_id = ?`,
      [req.user.id, req.workshopId]
    );

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer profile not found' });
    }

    return res.json({
      success: true,
      data: {
        id: req.user.id,
        customer_id: customer.id,
        full_name: customer.full_name,
        company_name: customer.company_name,
        email: customer.email,
        phone: customer.phone,
        role: 'customer',
        is_verified: !!customer.is_verified,
        address_line1: customer.address_line1,
        address_line2: customer.address_line2,
        city: customer.city,
        emirate: customer.emirate,
        workshop: {
          id: customer.workshop_id,
          name: customer.workshop_name,
          slug: customer.workshop_slug,
          logo_url: customer.workshop_logo,
          logo_url_white: customer.workshop_logo_white,
          industry: customer.workshop_type,
          status: customer.workshop_status,
          phone: customer.workshop_phone,
          currency: customer.workshop_currency || 'AED',
        },
      },
    });
  } catch (err) {
    console.error('[CustomerAuth] Session error:', err);
    return res.status(500).json({ success: false, message: 'Session check failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
 * PUT /change-password — Change password (authenticated)
 * ══════════════════════════════════════════════════════════════ */
router.put('/change-password', preferBearerToken, authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ success: false, message: 'Not a customer account' });
    }

    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, message: 'Both passwords required' });
    }
    if (String(new_password).length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const [customer] = await query(
      'SELECT id, password_hash FROM customers WHERE user_id = ? AND workshop_id = ?',
      [req.user.id, req.workshopId]
    );
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const valid = customer.password_hash && await bcrypt.compare(String(current_password), customer.password_hash);
    if (!valid) return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(String(new_password), 12);
    await execute('UPDATE customers SET password_hash = ? WHERE id = ?', [hashed, customer.id]);
    if (req.user.id) {
      await execute('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    }

    return res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('[CustomerAuth] Change password error:', err);
    return res.status(500).json({ success: false, message: 'Password change failed' });
  }
});

/* ══════════════════════════════════════════════════════════════
 * POST /logout — the portal drops its token itself. A customer cookie left
 * from before (login used to set it) is cleared; a staff member's never is.
 * ══════════════════════════════════════════════════════════════ */
router.post('/logout', (req, res) => {
  const cookieToken = req.cookies?.auth_token;
  if (cookieToken && verifyToken(cookieToken)?.role === 'customer') res.clearCookie('auth_token');
  return res.json({ success: true, message: 'Logged out' });
});

export default router;
