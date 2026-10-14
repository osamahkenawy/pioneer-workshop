/**
 * ═══════════════════════════════════════════════════════════════════
 *  Notification Service  –  Unified work order lifecycle notifications
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Channels:  SMS  ·  Email  ·  Push (Web Push)  ·  In-App (Socket.io)
 *
 *  Usage:
 *    import { notifyWorkOrderStatus, notifyMechanicAssigned } from '../lib/notify.js';
 *    await notifyWorkOrderStatus({ order, status, workshopId, changedBy });
 *
 *  Who hears what (Steps 1–7):
 *    Customer   — SMS and email at four moments only (CUSTOMER_MILESTONES):
 *                 job opened, ready for collection, job closed, job cancelled.
 *                 Internal steps send nothing, and the technician is never named.
 *    Technician — when a job card is assigned to them (in-app + phone push),
 *                 always opening the technician app, never a staff page
 *                 (lib/workflow.js notifyTechnicianAssigned).
 *    Managers   — push + in-app when a job is closed or cancelled. Every
 *                 other step is announced to the right group by
 *                 lib/workflow.js and lib/workflow-sync.js.
 *
 *  All channel failures are non-blocking — the work order lifecycle
 *  continues even if one channel fails.  Every attempt is logged to
 *  the `notifications` table.
 * ═══════════════════════════════════════════════════════════════════
 */

import { query, execute } from './database.js';
import { sendSMS, interpolate } from './sms.js';
import { sendEmail, sendNotificationEmail, buildWorkOrderStatusEmail, customerEmailSubject, getWorkshopBranding } from './email.js';
import { sendPushToUser } from './push.js';
import { sendFCMToUser } from './firebase.js';
import { getIO } from './socket.js';
import { customerStatusUrl, customerAppBase } from './customer-link.js';
import { woLabel } from './status-labels.js';
import { jobClassification } from './job-card-approval.js';

// ─── In-App notification helper ───────────────────────────────
/**
 * Create an in-app notification record for a specific user.
 * These appear in the notification bell dropdown.
 */
export async function createInAppNotification({ workshopId, userId, title, body, type = 'info', icon = '🔔', link = null, orderId = null }) {
  try {
    // ── N7: insert-time dedup ──
    // For work-order-scoped notifications, suppress if an identical
    // (user_id, order_id, type) row was created in the last hour.
    // Prevents racing crons / endpoints from inserting duplicates.
    if (orderId) {
      try {
        const dup = await query(
          `SELECT id FROM user_notifications
            WHERE user_id = ? AND work_order_id = ? AND type = ?
              AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
            LIMIT 1`,
          [userId, orderId, type]
        );
        if (dup && dup.length) {
          return { success: true, id: dup[0].id, deduped: true };
        }
      } catch (e) {
        // This used to swallow silently, which hid the fact that the table
        // did not exist at all. Dedup is best-effort, so still proceed.
        console.warn('[notify] dedup check failed:', e.message);
      }
    }

    const result = await execute(
      `INSERT INTO user_notifications (workshop_id, user_id, title, body, type, icon, link, work_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [workshopId, userId, title, body, type, icon, link || null, orderId || null]
    );

    // Push real-time via Socket.io so UI updates instantly
    try {
      const io = getIO();
      io.to(`user:${userId}`).emit('notification:new', {
        id: result.insertId,
        title, body, type, icon, link, order_id: orderId,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    } catch (_) { /* socket may not be ready */ }

    return { success: true, id: result.insertId };
  } catch (e) {
    console.error('[InApp] Failed to create in-app notification:', e.message);
    return { success: false, error: e.message };
  }
}

// ─── Status metadata ──────────────────────────────────────────
// Keyed on the real work_orders.status enum. The labels are the workshop's
// words (lib/status-labels.js — "Ready for collection", never "Ready for
// Pickup"); the icon names are ones the notification bell knows.
const STATUS_ICONS = {
  pending: 'clock', confirmed: 'check', estimate_approved: 'check', auto_assign: 'check',
  assigned: 'user', accepted: 'user', in_progress: 'clock', inspection: 'check',
  ready_for_pickup: 'check', completed: 'check', cancelled: 'cancelled',
};
const STATUS_META = Object.fromEntries(
  Object.entries(STATUS_ICONS).map(([status, icon]) => [status, { icon, label: woLabel(status) }])
);

/**
 * The only moments a customer hears from the workshop by SMS and email
 * (S12): the job is opened (Step 3), the car is ready for collection
 * (Step 7, QC passed), the job is closed, the job is cancelled. confirmed,
 * assigned, accepted, in_progress and inspection are internal steps.
 * The template_key logged for each is `order_${status}` —
 * 'order_ready_for_pickup' is read by lib/workflow.js (Step 7 checks).
 */
export const CUSTOMER_MILESTONES = Object.freeze(['pending', 'ready_for_pickup', 'completed', 'cancelled']);

// ─── Customer SMS per milestone ───────────────────────────────
// Built from customerVars(); every optional part (plate, link, amount,
// invoice, phone) drops out cleanly instead of printing "undefined".
const CUSTOMER_SMS = {
  pending: v => [
    `${v.workshop}: we have received your ${v.vehicle_plate}, ${v.jc ? `job card ${v.jc}` : `job ${v.wo}`}.`,
    v.link && `Follow your service: ${v.link}`,
  ],
  ready_for_pickup: v => [
    `${v.workshop}: your ${v.vehicle_plate} is ready for collection.`,
    v.payment,
    v.link && `Details: ${v.link}`,
  ],
  completed: v => [
    `Thank you for choosing ${v.workshop}. Job ${v.wo} is closed${v.inv ? `, invoice ${v.inv}` : ''}.`,
  ],
  cancelled: v => [
    `${v.workshop}: job ${v.wo}${v.plate ? ` for ${v.plate}` : ''} has been cancelled.`,
    v.workshop_phone && `Questions? Call ${v.workshop_phone}.`,
  ],
};

/** The customer SMS for a milestone, or null for any other status. */
export function customerSmsText(status, vars) {
  const build = CUSTOMER_SMS[status];
  return build ? build(vars).filter(Boolean).join(' ') : null;
}

// ─── Helper: log notification to DB ───────────────────────────
async function logNotification({
  workshopId, type, recipientPhone, recipientEmail,
  templateKey, message, orderId, userId, driverId, status, errorMessage,
}) {
  try {
    await execute(
      // Was (tenant_id, …, order_id, …, driver_id): none of those columns
      // exist, so every send failed to log and the error was swallowed.
      `INSERT INTO notifications
       (workshop_id, type, recipient_phone, recipient_email, template_key, message, work_order_id, user_id, mechanic_id, status, error_message, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === 'sent' ? 'NOW()' : 'NULL'})`,
      [workshopId, type, recipientPhone || null, recipientEmail || null,
       templateKey || null, message, orderId || null, userId || null,
       driverId || null, status || 'pending', errorMessage || null]
    );
  } catch (e) {
    console.error('[Notify] Failed to log notification:', e.message);
  }
}

// ─── Helper: what a customer message says about one job ───────

/** settings JSON column as an object (mysql2 may return it parsed or as text). */
function parseSettings(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

/** "AED 1,250.00" */
function money(amount, currency) {
  return `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Everything a customer message says about one work order, read from the
 * real tables — the work order, its vehicle, its main job card, its latest
 * live invoice, the customer and the workshop. Shared by the SMS, the
 * status email (lib/email.js buildWorkOrderStatusEmail) and manual sends.
 *
 * Billed on account (internal customers; fleet, insurance or corporate
 * payers — the gate-pass rule in lib/workflow.js paymentSettled) means
 * nothing to pay at collection; otherwise the amount due is the invoice
 * balance (or the work order total while there is no invoice yet).
 *
 * @param {object} order       a work_orders row (SELECT * is enough)
 * @param {number} workshopId
 * @param {string} [status]    the milestone, for the customer stage label;
 *                             defaults to order.status
 * @returns {Promise<object>}  { customer_name, customer_email, work_order_number,
 *   job_card_number, make_model, plate, vehicle, stage, on_account, amount_due,
 *   amount_due_text, invoice_number, currency, link, workshop: { name, phone,
 *   email, address } }
 */
export async function customerMessageView(order, workshopId, status = order?.status) {
  const wid = workshopId || order.workshop_id;
  const [[ws] = [], [veh] = [], [jc] = [], [inv] = [], [cust] = []] = await Promise.all([
    query('SELECT name, phone, email, currency, settings, address, area, city, emirate FROM workshops WHERE id = ?', [wid]),
    order.vehicle_id ? query('SELECT plate_number, make, model FROM vehicles WHERE id = ?', [order.vehicle_id]) : [],
    query(
      `SELECT job_card_number FROM job_cards
        WHERE work_order_id = ? AND workshop_id = ? AND parent_job_card_id IS NULL
        ORDER BY status = 'cancelled', id LIMIT 1`, [order.id, wid]),
    query(
      `SELECT invoice_number, status, total_amount, amount_paid FROM invoices
        WHERE work_order_id = ? AND workshop_id = ? AND status NOT IN ('void','cancelled')
        ORDER BY id DESC LIMIT 1`, [order.id, wid]),
    order.customer_id
      ? query('SELECT full_name, email, customer_class, customer_subcategory FROM customers WHERE id = ?', [order.customer_id])
      : [],
  ]);

  const settings = parseSettings(ws?.settings);
  const currency = ws?.currency || 'AED';
  const makeModel = [veh?.make, veh?.model].filter(Boolean).join(' ').trim();
  const plate = String(veh?.plate_number || '').trim();
  const { cls } = jobClassification({ ...order, customer_class: cust?.customer_class, customer_subcategory: cust?.customer_subcategory });
  const onAccount = cls === 'internal' || ['fleet', 'insurance', 'corporate'].includes(order.payer_type);
  const due = inv
    ? Math.max(0, Number(inv.total_amount || 0) - Number(inv.amount_paid || 0))
    : Math.max(0, Number(order.total_amount || 0));
  const amountDue = Math.round(due * 100) / 100;

  return {
    customer_name: String(order.customer_name || cust?.full_name || '').trim(),
    customer_email: cust?.email || null,
    work_order_number: order.work_order_number || '',
    job_card_number: jc?.job_card_number || null,
    make_model: makeModel,
    plate,
    vehicle: `${makeModel || 'car'}${plate ? ` (${plate})` : ''}`,
    stage: woLabel({ ...order, status }, 'customer'),
    on_account: onAccount,
    amount_due: onAccount ? 0 : amountDue,
    amount_due_text: !onAccount && amountDue > 0 ? money(amountDue, currency) : '',
    invoice_number: inv?.invoice_number || null,
    currency,
    link: customerStatusUrl(order),
    workshop: {
      name: settings.company_name || ws?.name || 'Pioneer Car Service',
      phone: ws?.phone || '',
      email: ws?.email || '',
      address: [ws?.address, ws?.area, ws?.city || ws?.emirate].filter(Boolean).join(', '),
    },
  };
}

/**
 * Template variables for a customer message — the names the built-in SMS
 * use, plus the older ones ({order_number}, {customer_name},
 * {tracking_url}…) so a saved custom message still fills in.
 */
export function customerVars(view, extra = {}) {
  const payment = view.on_account ? 'Billed to your account.'
    : view.amount_due > 0 ? `Amount due: ${view.amount_due_text}.` : '';
  return {
    name: view.customer_name,
    customer_name: view.customer_name,
    wo: view.work_order_number,
    work_order_number: view.work_order_number,
    order_number: view.work_order_number,
    jc: view.job_card_number || '',
    vehicle: view.make_model || 'car',
    plate: view.plate,
    vehicle_plate: view.vehicle,
    link: view.link || '',
    tracking_url: view.link || '',
    amount_due: view.on_account ? 'Billed to your account' : view.amount_due_text,
    payment,
    inv: view.invoice_number || '',
    workshop: view.workshop.name,
    workshop_phone: view.workshop.phone,
    ...extra,
  };
}

/** Active managers and Service Advisor desks (legacy dispatcher) to tell about a closed or cancelled job. */
async function managerIds(workshopId, exceptUserId) {
  const rows = await query(
    "SELECT id FROM users WHERE workshop_id = ? AND is_active = 1 AND role IN ('admin','workshop_manager','general_manager','dispatcher') AND id != ?",
    [workshopId, exceptUserId || 0]
  );
  return rows.map(r => r.id);
}

// ═══════════════════════════════════════════════════════════════
//  MAIN: Notify on work order status change
// ═══════════════════════════════════════════════════════════════

/**
 * Fire the notification channels for a work order status change.
 *
 *   pending, ready_for_pickup, completed, cancelled → customer SMS + email
 *   assigned                                        → the technician
 *   completed, cancelled                            → managers (push + in-app)
 *   every status                                    → Socket.io event
 *
 * @param {Object}  opts
 * @param {Object}  opts.order       – Work order row (SELECT * from work_orders)
 * @param {string}  opts.status      – The new status
 * @param {number}  opts.workshopId  – Workshop ID
 * @param {number}  [opts.changedBy] – User ID who triggered the change
 * @param {Object}  [opts.extra]     – Extra template variables
 */
export async function notifyWorkOrderStatus({ order, status, workshopId, changedBy, extra = {} }) {
  const meta = STATUS_META[status];
  if (!meta || !order) return;

  const results = { sms: null, email: null, push: null, socket: null };
  // `order` is the row as it was before the change (or the new row, when a
  // job is opened). Reopening a cancelled job is not "vehicle received" again.
  const reopened = status === 'pending' && order.status && order.status !== 'pending';
  const milestone = CUSTOMER_MILESTONES.includes(status) && !reopened;
  let view = null;
  if (milestone) {
    try {
      view = await customerMessageView(order, workshopId, status);
    } catch (e) {
      console.error('[Notify] Could not read the job for the customer message:', e.message);
    }
  }

  // ──────────────────────────────────────
  //  1. SMS to customer (milestones only)
  // ──────────────────────────────────────
  if (view && order.customer_phone) {
    try {
      const body = customerSmsText(status, customerVars(view, extra));
      const smsResult = await sendSMS(order.customer_phone, body);
      results.sms = smsResult;
      await logNotification({
        workshopId, type: 'sms', recipientPhone: order.customer_phone,
        templateKey: `order_${status}`, message: body, orderId: order.id,
        status: smsResult.success ? 'sent' : 'failed',
        errorMessage: smsResult.error || null,
      });
    } catch (e) {
      console.error('[Notify] SMS error:', e.message);
    }
  }

  // ──────────────────────────────────────
  //  2. Email to customer (milestones only): the job's own email, else the
  //     customer record's; on close / cancel also the account email when it
  //     differs (business record).
  // ──────────────────────────────────────
  if (view) {
    const jobEmail = order.customer_email || order.customer_email_ref || view.customer_email;
    const recipients = [{ to: jobEmail, key: `order_${status}` }];
    if (['completed', 'cancelled'].includes(status) && view.customer_email && view.customer_email !== jobEmail) {
      recipients.push({ to: view.customer_email, key: `client_${status}` });
    }
    let branding = null;
    for (const { to, key } of recipients) {
      if (!to) continue;
      try {
        branding ||= await getWorkshopBranding(workshopId);
        const subject = customerEmailSubject(status, view);
        const html = buildWorkOrderStatusEmail({ status, view, branding });
        const emailResult = await sendEmail({ to, subject, html, tenantId: workshopId });
        if (key.startsWith('order_')) results.email = emailResult;
        await logNotification({
          workshopId, type: 'email', recipientEmail: to,
          templateKey: key, message: subject, orderId: order.id,
          status: emailResult.success ? 'sent' : 'failed',
          errorMessage: emailResult.error || null,
        });
      } catch (e) {
        console.error('[Notify] Email error:', e.message);
      }
    }
  }

  // ──────────────────────────────────────
  //  3. The technician — only when a job is assigned to them. The same
  //     notice as every other assign path (one per assignment, dedup'd).
  // ──────────────────────────────────────
  if (status === 'assigned' && order.mechanic_id) {
    try {
      const { notifyTechnicianAssigned } = await import('./workflow.js');
      await notifyTechnicianAssigned({ workshopId, workOrderId: order.id, mechanicId: order.mechanic_id });
    } catch (e) {
      console.error('[Notify] Technician notice error:', e.message);
    }
  }

  // ──────────────────────────────────────
  //  4. Managers — push + in-app when the job is closed or cancelled
  // ──────────────────────────────────────
  if (view && ['completed', 'cancelled'].includes(status)) {
    try {
      const ref = `${view.work_order_number}${view.plate ? ` · ${view.plate}` : ''}`;
      const title = status === 'completed' ? `Job closed: ${ref}` : `Job cancelled: ${ref}`;
      const what = `${view.job_card_number ? `Job card ${view.job_card_number}` : `Job ${view.work_order_number}`} · ${view.vehicle}`;
      const body = status === 'completed'
        ? `${what} is closed${view.invoice_number ? ` — invoice ${view.invoice_number}` : ''}.`
        : `${what} was cancelled.`;
      for (const userId of await managerIds(workshopId, changedBy)) {
        const pushPayload = {
          title, body,
          url:  `/work-orders/${order.id}`,
          tag:  `admin-order-${order.id}`,
          data: { orderId: order.id, status, orderNumber: order.work_order_number },
        };
        await sendPushToUser(userId, pushPayload).catch(() => {});
        await sendFCMToUser(userId, pushPayload).catch(() => {});
        await createInAppNotification({
          workshopId, userId, title, body,
          type: `workflow_${status === 'completed' ? 'closed' : 'cancelled'}`, icon: meta.icon,
          link: `/work-orders/${order.id}`, orderId: order.id,
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[Notify] Manager notice error:', e.message);
    }
  }

  // ──────────────────────────────────────
  //  5. Socket.io real-time event
  // ──────────────────────────────────────
  try {
    const io = getIO();
    io.to(`workshop:${workshopId}`).emit('work-order:status-changed', {
      orderId:     order.id,
      orderNumber: order.work_order_number,
      status,
      statusLabel: meta.label,
      previousStatus: order.status,
      driverName:  order.mechanic_name || null,
      timestamp:   new Date().toISOString(),
    });
  } catch (e) {
    // Socket might not be initialized in testing
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
//  Notify: Technician assigned to work order
// ═══════════════════════════════════════════════════════════════

/**
 * Notify when a technician is assigned to a work order (Team Leader board,
 * job assignment, auto-assign).
 *
 * The customer is not told: assignment is an internal step. The technician
 * gets the shared "Job assigned" notice (lib/workflow.js
 * notifyTechnicianAssigned — in-app + push, opening the job card in the
 * technician app; dedup'd against onTechnicianAssigned) and an email to
 * their own login, with the job card, vehicle and reported issue — no
 * customer name, phone, address or money. Managers and Service Advisor
 * desks get an in-app line that says "{technician} assigned to work order …".
 *
 * @param {object} opts
 * @param {object} opts.order    work order row (id and work_order_number at least)
 * @param {object} opts.driver   the technician (mechanics row: id, full_name, user_id?)
 * @param {number} opts.tenantId workshop id
 */
export async function notifyMechanicAssigned({ order, driver, tenantId }) {
  const workshopId = tenantId;
  if (!order?.id || !driver?.id) return;
  const technicianName = driver.full_name || driver.name || 'A technician';

  let job = null;
  try {
    const { notifyTechnicianAssigned } = await import('./workflow.js');
    job = await notifyTechnicianAssigned({ workshopId, workOrderId: order.id, mechanicId: driver.id });
  } catch (e) {
    console.error('[Notify] Technician notice error:', e.message);
  }

  // Email to the technician's own login
  try {
    const userId = driver.user_id
      || (await query('SELECT user_id FROM mechanics WHERE id = ? AND workshop_id = ?', [driver.id, workshopId]))[0]?.user_id;
    const [techUser] = userId ? await query('SELECT email, full_name FROM users WHERE id = ?', [userId]) : [];
    if (techUser?.email && job) {
      const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const cell = 'padding:8px 12px;border:1px solid #e2e8f0;';
      const row = (label, value) => value
        ? `<tr><td style="${cell}font-weight:600;background:#f8fafc;width:140px;">${label}</td><td style="${cell}">${esc(value)}</td></tr>` : '';
      const subject = `Job card assigned — ${job.jobCardNumber || order.work_order_number}${job.plate ? ` · ${job.plate}` : ''}`;
      const r = await sendNotificationEmail({
        to: techUser.email,
        subject,
        title: 'New job card',
        body: `
          <p>Hi <strong>${esc(techUser.full_name || driver.full_name || '')}</strong>,</p>
          <p>A job card has been assigned to you:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            ${row('Job card', job.jobCardNumber)}
            ${row('Work order', order.work_order_number)}
            ${row('Vehicle', [job.plate, job.makeModel].filter(Boolean).join(' · '))}
            ${row('Reported issue', job.complaint)}
          </table>
          <p>Open My Jobs and press Start when you begin.</p>
        `,
        ctaText: 'Open My Jobs',
        ctaUrl: `${customerAppBase()}${job.link}`,
        tenantId: workshopId,
      });
      await logNotification({
        workshopId, type: 'email', recipientEmail: techUser.email,
        templateKey: 'technician_assigned_email', message: subject,
        orderId: order.id, driverId: driver.id, userId, status: r.success ? 'sent' : 'failed',
        errorMessage: r.error || null,
      });
    }
  } catch (e) {
    console.error('[Notify] Technician email error:', e.message);
  }

  // In-app notification to managers and Service Advisor desks. Keeps the
  // phrase "assigned to work order" (scripts/qa/intake-test.mjs).
  try {
    const adminUsers = await query(
      "SELECT id FROM users WHERE workshop_id = ? AND is_active = 1 AND role IN ('admin','workshop_manager','general_manager','dispatcher')",
      [workshopId]
    );
    const plate = job?.plate ? ` · ${job.plate}` : '';
    for (const au of adminUsers) {
      await createInAppNotification({
        workshopId, userId: au.id,
        title: 'Technician assigned',
        body: `${technicianName} assigned to work order ${order.work_order_number}${plate}`,
        type: 'assignment', icon: 'assignment',
        link: `/work-orders/${order.id}`, orderId: order.id,
      }).catch(() => {});
    }
  } catch (e) { /* non-blocking */ }

  // Socket
  try {
    const io = getIO();
    io.to(`workshop:${workshopId}`).emit('work-order:mechanic-assigned', {
      orderId:     order.id,
      orderNumber: order.work_order_number,
      driverId:    driver.id,
      driverName:  technicianName,
      timestamp:   new Date().toISOString(),
    });
  } catch (e) { /* non-blocking */ }
}

// ═══════════════════════════════════════════════════════════════
//  Notify: Cash payment collected
// ═══════════════════════════════════════════════════════════════

/**
 * A cash payment was recorded. Staff screens are refreshed over the socket;
 * the customer is not sent an SMS (payment is part of the invoice, and the
 * customer hears from us only at the four milestones).
 */
export async function notifyCashCollected({ order, amount, tenantId }) {
  const workshopId = tenantId;
  try {
    const io = getIO();
    io.to(`workshop:${workshopId}`).emit('work-order:cash-collected', {
      orderId: order.id, orderNumber: order.work_order_number,
      amount: parseFloat(amount), timestamp: new Date().toISOString(),
    });
  } catch (e) { /* non-blocking */ }
}

// ═══════════════════════════════════════════════════════════════
//  Notify: Custom / manual notification
// ═══════════════════════════════════════════════════════════════

/**
 * Send a custom notification via one or more channels.
 *
 * With `orderId`, placeholders in the message and subject are filled in from
 * that work order — the same names the built-in customer messages use:
 * {name}, {vehicle}, {plate}, {wo}, {jc}, {link}, {amount_due}, {inv},
 * {workshop}, {workshop_phone} (and the older {work_order_number},
 * {customer_name}, {tracking_url}). Unknown placeholders are left as typed.
 *
 * @param {Object}  opts
 * @param {string[]} opts.channels  – ['sms', 'email', 'push']
 * @param {string}  opts.phone      – Recipient phone (for SMS)
 * @param {string}  opts.email      – Recipient email
 * @param {string}  opts.message    – Message text
 * @param {string}  [opts.subject]  – Email subject
 * @param {number}  [opts.tenantId] – Workshop ID
 * @param {number}  [opts.orderId]
 * @param {number}  [opts.userId]   – Target user for push
 */
export async function sendCustomNotification({ channels = [], phone, email, message, subject, tenantId, orderId, userId }) {
  const workshopId = tenantId;
  const results = {};

  if (orderId && workshopId && /\{\{?\s*\w+\s*\}?\}/.test(`${message || ''} ${subject || ''}`)) {
    try {
      const [order] = await query('SELECT * FROM work_orders WHERE id = ? AND workshop_id = ?', [orderId, workshopId]);
      if (order) {
        const vars = customerVars(await customerMessageView(order, workshopId));
        message = interpolate(message, vars);
        if (subject) subject = interpolate(subject, vars);
      }
    } catch (e) {
      console.error('[Notify] Custom message placeholders:', e.message);
    }
  }

  if (channels.includes('sms') && phone) {
    try {
      const r = await sendSMS(phone, message);
      results.sms = r;
      await logNotification({
        workshopId, type: 'sms', recipientPhone: phone,
        templateKey: 'custom', message, orderId,
        status: r.success ? 'sent' : 'failed', errorMessage: r.error,
      });
    } catch (e) { results.sms = { success: false, error: e.message }; }
  }

  if (channels.includes('email') && email) {
    try {
      const safe = String(message || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      const r = await sendNotificationEmail({
        to: email, subject: subject || 'Notification from Pioneer',
        title: subject || 'Notification',
        body: `<p>${safe}</p>`,
        tenantId: workshopId,
      });
      results.email = r;
      await logNotification({
        workshopId, type: 'email', recipientEmail: email,
        templateKey: 'custom', message: subject || message, orderId,
        status: r.success ? 'sent' : 'failed', errorMessage: r.error,
      });
    } catch (e) { results.email = { success: false, error: e.message }; }
  }

  if (channels.includes('push') && userId) {
    try {
      const pushPayload = {
        title: subject || 'Notification',
        body:  message,
        url:   orderId ? `/work-orders/${orderId}` : '/',
      };
      const r = await sendPushToUser(userId, pushPayload);
      results.push = r;
      // Also send via FCM to mobile devices
      await sendFCMToUser(userId, pushPayload).catch(() => {});
    } catch (e) { results.push = { success: false, error: e.message }; }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
//  Notify: Per-part status change
// ═══════════════════════════════════════════════════════════════

/**
 * A part on a work order changed status (routes/parts.js: ordered,
 * installed, returned…). Staff screens are refreshed over the socket. The
 * customer is not texted — the old per-part SMS was the courier's
 * "package 2/3 delivered" message, and the customer hears from us only at
 * the four milestones.
 *
 * @param {Object}  opts
 * @param {Object}  opts.order        – Parent work order row
 * @param {Object}  opts.pkg          – Part row (id, barcode/part_number, sequence)
 * @param {string}  opts.newStatus    – The new part status
 * @param {number}  opts.tenantId     – Workshop ID
 * @param {number}  [opts.delivered]  – Count of parts installed
 * @param {number}  [opts.total]      – Total parts on the work order
 */
export async function notifyPartStatus({ order, pkg, newStatus, tenantId, delivered = 0, total = 0 }) {
  const workshopId = tenantId;
  if (!order || !pkg) return;
  try {
    const io = getIO();
    io.to(`workshop:${workshopId}`).emit('part:status-changed', {
      packageId: pkg.id,
      packageBarcode: pkg.barcode,
      packageSequence: pkg.sequence,
      orderId: order.id,
      orderNumber: order.work_order_number,
      status: newStatus,
      delivered,
      total,
      timestamp: new Date().toISOString(),
    });
  } catch (_) { /* socket not ready */ }
}

export default {
  notifyWorkOrderStatus,
  notifyMechanicAssigned,
  notifyCashCollected,
  notifyPartStatus,
  sendCustomNotification,
  customerMessageView,
  customerSmsText,
};
