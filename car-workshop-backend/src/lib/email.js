import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { query } from './database.js';
import { customerAppBase } from './customer-link.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Singleton transporter ──────────────────────────────────
let transporter = null;

/**
 * Get or create the Nodemailer transporter.
 * Handles Office 365, Gmail, and generic SMTP.
 */
function getTransporter() {
  if (transporter) return transporter;

  const { host, port, user, pass, secure, tls } = config.smtp;

  if (!host) {
    console.warn('⚠️  Email not configured — no EMAIL_HOST in .env');
    return null;
  }

  const opts = {
    host,
    port,
    secure,                         // true for 465, false for 587
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  };

  // Only add auth if credentials are provided
  if (user && pass) {
    opts.auth = { user, pass };
  }

  // For secure (port 465) — just allow self-signed certs in dev
  if (secure) {
    opts.tls = { rejectUnauthorized: false };
  }
  // STARTTLS (port 587) — Office 365, Namecheap, etc.
  else if (tls) {
    opts.requireTLS = true;
    opts.tls = {
      rejectUnauthorized: false,
    };
  }

  transporter = nodemailer.createTransport(opts);

  // Verify connection on first creation (non-blocking)
  transporter.verify()
    .then(() => console.log('✅ Email transporter verified — ready to send'))
    .catch((err) => {
      console.error('❌ Email transporter verification failed:', err.message);
      if (err.code === 'EAUTH' || err.message.includes('535') || err.message.includes('Authentication')) {
        console.error('\n═══════════════════════════════════════════════════════════');
        console.error('  EMAIL AUTH FAILED — check your EMAIL_USER / EMAIL_PASS');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('  For Office 365:');
        console.error('  1. admin.microsoft.com → Users → Active users → noreply@pioneercarservice.com');
        console.error('  2. Mail tab → Manage email apps → Enable "Authenticated SMTP"');
        console.error('  OR use App Password if MFA is enabled');
        console.error('═══════════════════════════════════════════════════════════\n');
      } else if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        console.error('  💡 Network issue — cannot reach', host + ':' + port);
      }
    });

  return transporter;
}

/**
 * Get the "From" display name for a workshop.
 * Falls back to: workshop.name → EMAIL_NAME env → "Pioneer Solutions"
 */
async function getFromName(workshopId) {
  if (workshopId) {
    try {
      const rows = await query('SELECT name, settings FROM workshops WHERE id = ?', [workshopId]);
      if (rows.length > 0) {
        let settings = {};
        try {
          settings = rows[0].settings
            ? (typeof rows[0].settings === 'string' ? JSON.parse(rows[0].settings) : rows[0].settings)
            : {};
        } catch (e) { /* ignore */ }
        if (settings.company_name) return settings.company_name;
        if (rows[0].name) return rows[0].name;
      }
    } catch (e) { /* ignore, use fallback */ }
  }
  return config.smtp.fromName || 'Pioneer Solutions';
}

/**
 * Get the public base URL for constructing absolute links: FRONTEND_URL,
 * with the same production safety net as customer links (lib/customer-link.js
 * — never a localhost or the old delivery.* host in a production email).
 */
function getBaseUrl() {
  return customerAppBase();
}

/**
 * Get the backend API base URL (for serving uploaded files like logos).
 * BACKEND_URL when set; in production the app's own origin, which serves
 * the API (the front end calls it on the relative /api).
 */
function getApiBaseUrl() {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/+$/, '');
  if (config.env === 'production') return customerAppBase();
  return `http://localhost:${config.port || 4000}`;
}

/**
 * Default Pioneer logo URL — hosted from backend uploads so it works
 * in all email clients regardless of frontend state.
 */
function getDefaultPioneerLogo() {
  return `${getApiBaseUrl()}/uploads/logos/email/pioneer-logo.png`;
}

/**
 * Get the Pioneer logo as a CID attachment for embedding in emails.
 * Returns { src, attachment } where:
 *   - src = 'cid:pioneer-logo' (use in <img src="...">)
 *   - attachment = Nodemailer attachment object to include in the email
 */
function getLogoCidAttachment() {
  const logoPath = path.resolve(__dirname, '../../uploads/logos/email/pioneer-logo.png');
  return {
    src: 'cid:pioneer-logo',
    attachment: {
      filename: 'pioneer-logo.png',
      path: logoPath,
      cid: 'pioneer-logo',
      contentDisposition: 'inline',
    },
  };
}

/**
 * Convert a stored logo path (e.g. /uploads/logos/xxx.png) to an
 * absolute URL that works inside email clients.
 */
function absoluteLogoUrl(rawUrl) {
  if (!rawUrl) return null;
  // Already absolute
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
  const base = getBaseUrl();
  // /uploads/logos/xxx.png  →  /api/file?path=logos/xxx.png
  if (rawUrl.startsWith('/uploads/')) {
    const relPath = rawUrl.replace(/^\/uploads\//, '');
    return `${base}/api/file?path=${encodeURIComponent(relPath)}`;
  }
  // Any other relative path — just prepend base
  return `${base}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
}

/**
 * Get workshop branding (name + logo URL).
 * Falls back to Pioneer logo when workshop has no logo set.
 */
async function getWorkshopBranding(workshopId) {
  const defaultLogo = getDefaultPioneerLogo();
  if (workshopId) {
    try {
      const rows = await query('SELECT name, logo_url, settings FROM workshops WHERE id = ?', [workshopId]);
      if (rows.length > 0) {
        let settings = {};
        try {
          settings = rows[0].settings
            ? (typeof rows[0].settings === 'string' ? JSON.parse(rows[0].settings) : rows[0].settings)
            : {};
        } catch (e) { /* ignore */ }
        const name = settings.company_name || rows[0].name || 'Pioneer Solutions';

        // Only use workshop logo if it's a non-empty string
        const rawLogo = rows[0].logo_url;
        const hasLogo = rawLogo && typeof rawLogo === 'string' && rawLogo.trim().length > 0;
        const logoUrl = hasLogo ? (absoluteLogoUrl(rawLogo) || defaultLogo) : defaultLogo;
        const isSystem = !hasLogo;

        return { name, logoUrl, isSystem };
      }
    } catch (e) { /* ignore */ }
  }
  return { name: 'Pioneer Solutions', logoUrl: defaultLogo, isSystem: true };
}

/**
 * Build a branded HTML email template for work-order notifications.
 *
 * Accepts either explicit params or a `branding` shortcut:
 *   buildEmailTemplate({ logoUrl, logoAlt, title, bodyHtml, ... })
 *   buildEmailTemplate({ branding, title, bodyHtml, ... })
 *   buildEmailTemplate({ branding, title, body, ... })   // body = alias for bodyHtml
 */
function buildEmailTemplate(opts, legacyBodyHtml) {
  // Legacy 2-arg call:  buildEmailTemplate(branding, htmlString)
  if (legacyBodyHtml !== undefined && typeof legacyBodyHtml === 'string') {
    const branding = opts || {};
    return buildEmailTemplate({
      logoUrl: branding.logoUrl,
      logoAlt: branding.name || 'Pioneer',
      title: '',
      bodyHtml: legacyBodyHtml,
      footerName: branding.name || 'Pioneer Solutions',
      isSystem: branding.isSystem !== false,
    });
  }

  // Support `branding` object shortcut
  const branding = opts.branding || {};
  const cidLogo = getLogoCidAttachment();
  const {
    logoUrl  = branding.logoUrl  || cidLogo.src,
    logoAlt  = branding.name     || 'Pioneer',
    accentColor = '#f97316',
    title, subtitle,
    bodyHtml = opts.body || '',
    ctaText, ctaUrl, copyLink, expiryNote,
    footerName = branding.name || 'Pioneer Solutions',
    isSystem   = branding.isSystem !== undefined ? branding.isSystem : true,
  } = opts;
  // Use CID for the system logo (when branding has no custom logo)
  const effectiveLogoUrl = (isSystem || logoUrl === cidLogo.src) ? cidLogo.src : logoUrl;
  const logoBlock = `
    <table cellpadding="0" cellspacing="0" style="display:inline-table;">
      <tr>
        <td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;
                   box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:14px 28px;text-align:center;">
          <img src="${effectiveLogoUrl}" alt="${logoAlt}" height="44"
               style="display:block;height:44px;width:auto;max-width:220px;" />
        </td>
      </tr>
    </table>`;

  const ctaBlock = ctaText && ctaUrl ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 32px;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" style="border-radius:10px;" bgcolor="${accentColor}">
            <tr>
              <td align="center" style="padding:15px 44px;border-radius:10px;" bgcolor="${accentColor}">
                <a href="${ctaUrl}"
                   style="display:inline-block;color:#ffffff;
                          text-decoration:none;
                          font-size:15px;font-weight:700;letter-spacing:0.02em;
                          font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
                  &#8594;&nbsp; ${ctaText}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>` : '';

  const copyLinkBlock = copyLink ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:#f8fafc;border:1px solid #e9edf2;border-radius:10px;padding:14px 18px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;">Or copy this link</p>
          <p style="margin:0;font-size:12px;color:#475569;word-break:break-all;font-family:'Courier New',monospace;">${copyLink}</p>
        </td>
      </tr>
    </table>` : '';

  const expiryBlock = expiryNote ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
          <p style="margin:0;font-size:13px;color:#92400e;">
            &#9203; This link expires in <strong>${expiryNote}</strong>.
          </p>
        </td>
      </tr>
    </table>` : '';

  const footerHtml = isSystem
    ? `Pioneer Solutions &nbsp;&bull;&nbsp; <a href="https://pioneercarservice.com" style="color:#f97316;text-decoration:none;font-weight:500;">pioneercarservice.com</a>`
    : `${footerName} &nbsp;&bull;&nbsp; Powered by <a href="https://pioneercarservice.com" style="color:#f97316;text-decoration:none;font-weight:500;">Pioneer Solutions</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td align="center" style="padding:0 0 28px;">${logoBlock}</td></tr>
        <tr>
          <td style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;
                     box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="height:6px;font-size:0;line-height:0;" bgcolor="${accentColor}">&nbsp;</td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:40px 40px 32px;">
                  <h1 style="margin:0 0 ${subtitle ? '8' : '28'}px;font-size:22px;font-weight:700;color:#111827;">${title}</h1>
                  ${subtitle ? `<p style="margin:0 0 28px;font-size:14px;color:#6b7280;">${subtitle}</p>` : ''}
                  <div style="font-size:14px;color:#6b7280;line-height:1.75;">${bodyHtml}</div>
                  ${ctaBlock}
                  ${copyLinkBlock}
                  ${expiryBlock}
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;">
              <tr>
                <td style="padding:20px 40px;text-align:center;">
                  <p style="margin:0;font-size:12px;color:#9ca3af;">${footerHtml}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Send an email.
 *
 * @param {Object} opts
 * @param {string}  opts.to          – Recipient email
 * @param {string}  opts.subject     – Subject line
 * @param {string}  opts.html        – HTML body
 * @param {string}  [opts.text]      – Plain-text body (auto-strips HTML if omitted)
 * @param {number}  [opts.tenantId]  – Workshop ID for dynamic "From" name
 * @param {string}  [opts.fromName]  – Override "From" display name
 * @param {Array}   [opts.attachments] – Nodemailer attachment array
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendEmail({ to, subject, html, text, tenantId, fromName, attachments }) {
  const transport = getTransporter();
  if (!transport) {
    console.log(`📧 EMAIL (not configured — dev mode):\n   To: ${to}\n   Subject: ${subject}\n`);
    return { success: false, error: 'Email not configured (no SMTP credentials)' };
  }

  const displayName = fromName || await getFromName(tenantId);
  const fromAddress = config.smtp.from || config.smtp.user;

  // Auto-attach the Pioneer CID logo when the HTML references it
  const allAttachments = Array.isArray(attachments) ? [...attachments] : [];
  if (html && html.includes('cid:pioneer-logo')) {
    const hasCidAlready = allAttachments.some(a => a.cid === 'pioneer-logo');
    if (!hasCidAlready) {
      allAttachments.push(getLogoCidAttachment().attachment);
    }
  }

  try {
    const info = await transport.sendMail({
      from: `"${displayName}" <${fromAddress}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
    });
    console.log(`✅ Email sent to ${to} (messageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a branded notification email (work order updates, service confirmations, etc.)
 */
export async function sendNotificationEmail({ to, subject, title, body, ctaText, ctaUrl, tenantId, attachments, copyLink, expiryNote }) {
  const branding = await getWorkshopBranding(tenantId);
  const cidLogo = getLogoCidAttachment();

  const html = buildEmailTemplate({
    logoUrl: branding.isSystem ? cidLogo.src : branding.logoUrl,
    logoAlt: branding.name,
    accentColor: '#f97316',
    title: title || subject,
    bodyHtml: `<div style="color:#6b7280;line-height:1.75;">${body}</div>`,
    ctaText,
    ctaUrl,
    copyLink,
    expiryNote,
    footerName: branding.name,
    isSystem: branding.isSystem,
  });

  // Always include the CID logo attachment when using system branding
  const allAttachments = [...(Array.isArray(attachments) ? attachments : [])];
  if (branding.isSystem) allAttachments.push(cidLogo.attachment);

  return sendEmail({ to, subject, html, tenantId, fromName: branding.name, attachments: allAttachments.length ? allAttachments : undefined });
}

/** HTML-escape a value for an email body (customer names, notes, numbers). */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The four moments a customer is emailed about their job (lib/notify.js
 * CUSTOMER_MILESTONES), keyed on the work_orders.status that triggers each.
 * `subject` is the subject wording; the accent colours carry white CTA text
 * at 4.5:1 or better.
 */
const CUSTOMER_EMAIL = {
  pending:          { subject: 'Vehicle received',        title: 'Vehicle received',       accent: '#0369a1' },
  ready_for_pickup: { subject: 'Ready for collection',    title: 'Ready for collection',   accent: '#c2410c' },
  completed:        { subject: 'Job closed, thank you',   title: 'Job closed — thank you', accent: '#15803d' },
  cancelled:        { subject: 'Job cancelled',           title: 'Job cancelled',          accent: '#475569' },
};

/**
 * Subject line of a customer status email:
 * "{plate} — Ready for collection ({WO number})". The plate is left out
 * when the job has no vehicle.
 *
 * @param {string} status  one of CUSTOMER_EMAIL's keys
 * @param {object} view    customerMessageView() from lib/notify.js
 * @returns {string|null}  null for a status customers are not emailed about
 */
export function customerEmailSubject(status, view) {
  const copy = CUSTOMER_EMAIL[status];
  if (!copy) return null;
  const plate = view?.plate ? `${view.plate} — ` : '';
  const wo = view?.work_order_number ? ` (${view.work_order_number})` : '';
  return `${plate}${copy.subject}${wo}`;
}

/**
 * The customer's email at one of the four moments they hear from the
 * workshop: the job is opened, the car is ready for collection, the job is
 * closed, the job is cancelled.
 *
 * Built only from what lib/notify.js customerMessageView() read from the
 * real tables (work order, vehicle, main job card, invoice, workshop): the
 * customer's name, the vehicle and plate, the work order and job card
 * numbers, the stage in customer wording, what to do next (come to collect,
 * the amount due) and the workshop's contact details, with a "View your
 * vehicle status" button to /service-status/{token}. Never the technician,
 * the customer's own address or staff notes. Every value is HTML-escaped.
 *
 * @param {object} opts
 * @param {'pending'|'ready_for_pickup'|'completed'|'cancelled'} opts.status
 * @param {object} opts.view      customerMessageView(order, workshopId, status)
 * @param {object} opts.branding  getWorkshopBranding(workshopId)
 * @returns {string|null} the HTML, or null for any other status
 */
export function buildWorkOrderStatusEmail({ status, view, branding = {} }) {
  const copy = CUSTOMER_EMAIL[status];
  if (!copy || !view) return null;
  const ws = view.workshop || {};
  const workshopName = ws.name || branding.name || 'Pioneer Car Service';
  const vehicle = esc(view.vehicle || 'car');
  const wo = esc(view.work_order_number || '');
  const jc = view.job_card_number ? esc(view.job_card_number) : '';
  const inv = view.invoice_number ? esc(view.invoice_number) : '';

  const lead = {
    pending: `We have received your <strong>${vehicle}</strong>${jc ? ` and opened job card <strong>${jc}</strong>` : ''}.`,
    ready_for_pickup: `Your <strong>${vehicle}</strong> has passed its final quality check and test drive and is ready for collection.`,
    completed: `Thank you for choosing ${esc(workshopName)}. Job <strong>${wo}</strong> is closed${inv ? `, invoice <strong>${inv}</strong>` : ''}.`,
    cancelled: `Job <strong>${wo}</strong> for your <strong>${vehicle}</strong> has been cancelled.`,
  }[status];

  let payment = '';
  if (status === 'ready_for_pickup') {
    payment = view.on_account
      ? 'The work is billed to your account — there is nothing to pay at collection.'
      : view.amount_due > 0
        ? `Amount due at collection: <strong>${esc(view.amount_due_text)}</strong>${inv ? ` (invoice ${inv})` : ''}.`
        : 'There is nothing to pay at collection.';
  }
  const next = {
    pending: 'Nothing for now. We will contact you if anything needs your approval, and you can follow your car at any time.',
    ready_for_pickup: `Please call us to agree a time, then come and collect your car. ${payment}`,
    completed: 'If anything is not right with the work, please call us.',
    cancelled: 'If you have any questions, please call us.',
  }[status];

  const row = (label, value) => value ? `
      <tr>
        <td style="padding:8px 0;color:#64748b;width:130px;vertical-align:top;">${label}</td>
        <td style="padding:8px 0;font-weight:600;color:#1e293b;">${value}</td>
      </tr>` : '';
  const details = [
    row('Vehicle', esc(view.make_model)),
    row('Plate', esc(view.plate)),
    row('Job card', jc),
    row('Work order', wo),
    row('Invoice', inv),
    status === 'ready_for_pickup'
      ? row('To pay', view.on_account ? 'Billed to your account' : view.amount_due > 0 ? esc(view.amount_due_text) : 'Nothing to pay')
      : '',
  ].join('');

  const phone = ws.phone ? `<a href="tel:${esc(String(ws.phone).replace(/[^\d+]/g, ''))}" style="color:#1e293b;font-weight:600;text-decoration:none;">${esc(ws.phone)}</a>` : '';
  const mail = ws.email ? `<a href="mailto:${esc(ws.email)}" style="color:#1e293b;text-decoration:none;">${esc(ws.email)}</a>` : '';
  const contact = [esc(workshopName), phone, mail, esc(ws.address || '')].filter(Boolean).join('<br>');

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;color:#374151;">
      Hello${view.customer_name ? ` <strong>${esc(view.customer_name)}</strong>` : ''},
    </p>
    <div style="background:#f8fafc;border-inline-start:4px solid ${copy.accent};border-left:4px solid ${copy.accent};border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 20px;">
      ${view.stage && view.stage !== copy.title ? `<p style="margin:0 0 6px;font-size:18px;font-weight:700;color:${copy.accent};">${esc(view.stage)}</p>` : ''}
      <p style="margin:0;font-size:14px;color:#475569;">${lead}</p>
    </div>
    ${details ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;font-size:13px;">${details}
    </table>` : ''}
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">What happens next</p>
    <p style="margin:0 0 20px;font-size:14px;color:#374151;">${next}</p>
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">Contact us</p>
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${contact}</p>`;

  return buildEmailTemplate({
    logoUrl: branding.logoUrl,
    logoAlt: branding.name || workshopName,
    accentColor: copy.accent,
    title: copy.title,
    subtitle: [view.plate, view.work_order_number].filter(Boolean).map(esc).join(' · ') || undefined,
    bodyHtml,
    ctaText: view.link ? 'View your vehicle status' : undefined,
    ctaUrl: view.link || undefined,
    footerName: branding.name || workshopName,
    isSystem: branding.isSystem,
  });
}

export { buildEmailTemplate, getWorkshopBranding, getFromName, getDefaultPioneerLogo, getLogoCidAttachment };
export default { sendEmail, sendNotificationEmail, buildWorkOrderStatusEmail, customerEmailSubject, buildEmailTemplate, getWorkshopBranding, getDefaultPioneerLogo, getLogoCidAttachment };
