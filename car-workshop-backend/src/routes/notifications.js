import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireFeature } from '../middleware/plan-gate.js';
import { sendSMS, interpolate } from '../lib/sms.js';
import { sendEmail, sendNotificationEmail } from '../lib/email.js';
import { getVapidPublicKey, saveSubscription, removeSubscription, sendPushToUser, sendPushToWorkshop } from '../lib/push.js';
import { registerDeviceToken, removeDeviceToken, removeAllDeviceTokens, sendFCMToUser } from '../lib/firebase.js';
import { sendCustomNotification } from '../lib/notify.js';
import { requireManager } from '../lib/access.js';

const router = express.Router();
router.use(authMiddleware);
// The log, templates, tests, sending and broadcasts are a manager's
// (requireManager on each route): the logs carry customers' phone numbers,
// e-mail addresses and message text. The push / device routes stay open to
// everyone, because each one only acts on the caller's own subscription.

// =================================================================
//  GET /api/notifications — list all notifications (paginated)
// =================================================================
router.get('/', requireManager, async (req, res) => {
  try {
    const { type, status, channel, page = 1, limit = 50 } = req.query;
    const pg = parseInt(page, 10) || 1;
    const lim = parseInt(limit, 10) || 50;
    const offset = (pg - 1) * lim;
    let where = 'WHERE n.workshop_id = ?';
    const params = [req.workshopId];
    // N17: `type` and `channel` both filter by n.type. Accept either, but apply only once.
    const channelFilter = type || channel;
    if (channelFilter) { where += ' AND n.type = ?';   params.push(channelFilter); }
    if (status)        { where += ' AND n.status = ?'; params.push(status); }

    const [{ total }] = await query(`SELECT COUNT(*) as total FROM notifications n ${where}`, params);
    const notifications = await query(
      `SELECT n.*, o.work_order_number FROM notifications n
       LEFT JOIN work_orders o ON n.work_order_id = o.id
       ${where} ORDER BY n.created_at DESC LIMIT ${lim} OFFSET ${offset}`,
      params
    );
    return res.json({ success: true, data: notifications, total, pagination: { total, page: pg, limit: lim } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

// =================================================================
//  GET /api/notifications/stats — notification channel stats
// =================================================================
router.get('/stats', requireManager, async (req, res) => {
  try {
    const [stats] = await query(`
      SELECT
        COUNT(*) as total,
        SUM(type = 'sms')   as sms_count,
        SUM(type = 'email') as email_count,
        SUM(type = 'push')  as push_count,
        SUM(status = 'sent')    as sent,
        SUM(status = 'failed')  as failed,
        SUM(status = 'pending') as pending,
        SUM(DATE(created_at) = CURDATE()) as today
      FROM notifications WHERE workshop_id = ?
    `, [req.workshopId]);
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// =================================================================
//  POST /api/notifications/send — send via one or multiple channels
// =================================================================
router.post('/send', requireManager, async (req, res) => {
  try {
    const { channels = ['sms'], phone, email, message, subject, work_order_id, user_id } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, message: 'message is required' });
    }
    if (!phone && !email && !user_id) {
      return res.status(400).json({ success: false, message: 'Provide phone, email, or user_id' });
    }

    const results = await sendCustomNotification({
      channels: Array.isArray(channels) ? channels : [channels],
      phone, email, message, subject,
      tenantId: req.workshopId,
      orderId: work_order_id || null,
      userId: user_id || null,
    });

    const anySent = Object.values(results).some(r => r?.success);
    return res.status(anySent ? 200 : 422).json({
      success: anySent,
      results,
      message: anySent ? 'Notification sent' : 'All channels failed',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to send notification' });
  }
});

// =================================================================
//  Notification templates — DB-backed CRUD
//  (falls back to built-in defaults when no DB rows exist)
// =================================================================

// The customer hears from the workshop at four moments only (lib/notify.js
// CUSTOMER_MILESTONES): the job is opened, the car is ready for collection,
// the job is closed, the job is cancelled. These are those messages, as
// snippets for Notifications → Send: with a work order chosen, the
// placeholders are filled in from it (lib/notify.js sendCustomNotification —
// {workshop}, {vehicle}, {plate}, {jc}, {wo}, {link}, {payment}, {inv},
// {workshop_phone}). The automatic messages are built in lib/notify.js.
// Rows a workshop already has keep their text; only new workshops and
// "reset to defaults" get these.
const DEFAULT_TEMPLATES = [
  { template_key: 'job_opened',           label: 'Vehicle received',        channels: JSON.stringify(['sms','email']), message: '{workshop}: we have received your {vehicle} ({plate}), job card {jc}. Follow your service: {link}' },
  { template_key: 'ready_for_collection', label: 'Ready for collection',    channels: JSON.stringify(['sms','email']), message: '{workshop}: your {vehicle} ({plate}) is ready for collection. {payment} Details: {link}' },
  { template_key: 'job_closed',           label: 'Job closed — thank you',  channels: JSON.stringify(['sms','email']), message: 'Thank you for choosing {workshop}. Job {wo} is closed.' },
  { template_key: 'job_cancelled',        label: 'Job cancelled',           channels: JSON.stringify(['sms','email']), message: '{workshop}: job {wo} for {plate} has been cancelled. Questions? Call {workshop_phone}.' },
];

// GET /api/notifications/templates
router.get('/templates', requireManager, async (req, res) => {
  try {
    let rows = await query(
      'SELECT * FROM notification_templates WHERE workshop_id = ? ORDER BY id',
      [req.workshopId]
    );
    // If no custom templates exist yet, seed defaults and return them
    if (!rows?.length) {
      for (const t of DEFAULT_TEMPLATES) {
        try {
          await execute(
            'INSERT INTO notification_templates (workshop_id, template_key, label, channels, message) VALUES (?,?,?,?,?)',
            [req.workshopId, t.template_key, t.label, t.channels, t.message]
          );
        } catch { /* ignore duplicate */ }
      }
      rows = await query(
        'SELECT * FROM notification_templates WHERE workshop_id = ? ORDER BY id',
        [req.workshopId]
      );
    }
    const data = (rows || []).map(r => ({ ...r, channels: typeof r.channels === 'string' ? JSON.parse(r.channels) : r.channels }));
    return res.json({ success: true, data });
  } catch {
    // Table doesn't exist yet — return hardcoded defaults
    const data = DEFAULT_TEMPLATES.map(t => ({ ...t, channels: JSON.parse(t.channels) }));
    return res.json({ success: true, data, source: 'default' });
  }
});

// PUT /api/notifications/templates/:id — update a template
router.put('/templates/:id', requireManager, async (req, res) => {
  try {
    const { message, label, channels } = req.body;
    await execute(
      'UPDATE notification_templates SET message = ?, label = ?, channels = ? WHERE id = ? AND workshop_id = ?',
      [message, label, JSON.stringify(Array.isArray(channels) ? channels : [channels]), req.params.id, req.workshopId]
    );
    return res.json({ success: true, message: 'Template updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update template' });
  }
});

// POST /api/notifications/templates/reset — reset to built-in defaults
router.post('/templates/reset', requireManager, async (req, res) => {
  try {
    await execute('DELETE FROM notification_templates WHERE workshop_id = ?', [req.workshopId]);
    for (const t of DEFAULT_TEMPLATES) {
      await execute(
        'INSERT INTO notification_templates (workshop_id, template_key, label, channels, message) VALUES (?,?,?,?,?)',
        [req.workshopId, t.template_key, t.label, t.channels, t.message]
      );
    }
    return res.json({ success: true, message: 'Templates reset to defaults' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to reset templates' });
  }
});

// =================================================================
//  SMS routes
// =================================================================

// POST /api/notifications/sms-test
router.post('/sms-test', requireManager, async (req, res) => {
  try {
    const { phone, message, work_order_id } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'phone and message required' });
    }
    // N15: validate E.164 (+ followed by 8–15 digits) before hitting Twilio
    if (!/^\+[1-9]\d{7,14}$/.test(String(phone).trim())) {
      return res.status(400).json({ success: false, message: 'phone must be in E.164 format (e.g. +971501234567)' });
    }
    const result = await sendSMS(phone, message);
    const status = result.success ? 'sent' : 'failed';
    await execute(
      `INSERT INTO notifications (workshop_id, type, recipient_phone, message, work_order_id, status, sent_at)
       VALUES (?, 'sms', ?, ?, ?, ?, NOW())`,
      [req.workshopId, phone, message, work_order_id || null, status]
    );
    if (result.success) {
      return res.json({ success: true, sid: result.sid, message: 'SMS sent' });
    }
    return res.status(422).json({ success: false, message: result.error || 'SMS failed', logged: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'SMS test failed' });
  }
});

// GET /api/notifications/sms-logs
router.get('/sms-logs', requireManager, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM notifications WHERE workshop_id = ? AND type = 'sms'`,
      [req.workshopId]
    );
    const logs = await query(
      `SELECT n.*, o.work_order_number FROM notifications n
       LEFT JOIN work_orders o ON n.work_order_id = o.id
       WHERE n.workshop_id = ? AND n.type = 'sms'
       ORDER BY n.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`,
      [req.workshopId]
    );
    return res.json({ success: true, data: logs, total });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch SMS logs' });
  }
});

// =================================================================
//  Email routes
// =================================================================

// POST /api/notifications/email-test — send a test email
router.post('/email-test', requireManager, async (req, res) => {
  try {
    const { to, subject, message, work_order_id } = req.body;
    if (!to || !message) {
      return res.status(400).json({ success: false, message: 'to (email) and message required' });
    }
    // N16: basic email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to).trim())) {
      return res.status(400).json({ success: false, message: 'to must be a valid email address' });
    }
    const result = await sendNotificationEmail({
      to,
      subject: subject || 'Test Email from Pioneer Solutions',
      title: subject || 'Test Notification',
      body: `<p>${message}</p>`,
      tenantId: req.workshopId,
    });
    const status = result.success ? 'sent' : 'failed';
    await execute(
      `INSERT INTO notifications (workshop_id, type, recipient_email, message, work_order_id, status, error_message, sent_at)
       VALUES (?, 'email', ?, ?, ?, ?, ?, ${result.success ? 'NOW()' : 'NULL'})`,
      [req.workshopId, to, message, work_order_id || null, status, result.error || null]
    );
    if (result.success) {
      return res.json({ success: true, messageId: result.messageId, message: 'Email sent' });
    }
    return res.status(422).json({ success: false, message: result.error || 'Email failed', logged: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Email test failed' });
  }
});

// GET /api/notifications/email-logs
router.get('/email-logs', requireManager, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM notifications WHERE workshop_id = ? AND type = 'email'`,
      [req.workshopId]
    );
    const logs = await query(
      `SELECT n.*, o.work_order_number FROM notifications n
       LEFT JOIN work_orders o ON n.work_order_id = o.id
       WHERE n.workshop_id = ? AND n.type = 'email'
       ORDER BY n.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`,
      [req.workshopId]
    );
    return res.json({ success: true, data: logs, total });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch email logs' });
  }
});

// =================================================================
//  Push notification routes
// =================================================================

// GET /api/notifications/push/vapid-key — frontend needs this to subscribe
router.get('/push/vapid-key', async (req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    return res.status(503).json({ success: false, message: 'Push not configured (no VAPID keys)' });
  }
  return res.json({ success: true, data: { publicKey: key } });
});

// POST /api/notifications/push/subscribe — save browser push subscription
router.post('/push/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys) {
      return res.status(400).json({ success: false, message: 'Push subscription object required' });
    }
    await saveSubscription(
      req.workshopId, req.user.id, subscription,
      req.headers['user-agent'] || null
    );
    return res.json({ success: true, message: 'Push subscription saved' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to save subscription' });
  }
});

// POST /api/notifications/push/unsubscribe
router.post('/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ success: false, message: 'endpoint required' });
    await removeSubscription(req.user.id, endpoint);
    return res.json({ success: true, message: 'Unsubscribed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to unsubscribe' });
  }
});

// POST /api/notifications/push/test — test push to current user
router.post('/push/test', async (req, res) => {
  try {
    const { title, body } = req.body;
    const result = await sendPushToUser(req.user.id, {
      title: title || 'Test Push',
      body:  body  || 'This is a test push notification from Pioneer Solutions.',
      url: '/notifications',
    });
    return res.json({ success: result.success, sent: result.sent, failed: result.failed });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Push test failed' });
  }
});

// POST /api/notifications/subscribe — shorthand alias (accepts flat or wrapped subscription)
router.post('/subscribe', async (req, res) => {
  try {
    // Accept both { endpoint, keys } and { subscription: { endpoint, keys } }
    const sub = req.body.subscription ?? req.body;
    if (!sub?.endpoint || !sub?.keys) {
      return res.status(400).json({ success: false, message: 'endpoint and keys required' });
    }
    await saveSubscription(
      req.workshopId, req.user.id, sub,
      req.headers['user-agent'] || null
    );
    return res.json({ success: true, message: 'Push subscription saved' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to save subscription' });
  }
});

// =================================================================
//  Mobile device token registration (FCM)
// =================================================================

// POST /api/notifications/register-device — register FCM device token
router.post('/register-device', async (req, res) => {
  try {
    const { device_token, platform, device_info } = req.body;
    if (!device_token) {
      return res.status(400).json({ success: false, message: 'device_token is required' });
    }
    if (platform && !['ios', 'android'].includes(platform)) {
      return res.status(400).json({ success: false, message: 'platform must be ios or android' });
    }
    await registerDeviceToken(
      req.workshopId, req.user.id,
      device_token, platform || 'android',
      device_info || req.headers['user-agent'] || null
    );
    return res.json({ success: true, message: 'Device registered for push notifications' });
  } catch (err) {
    console.error('[FCM] Register device error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Failed to register device' });
  }
});

// DELETE /api/notifications/unregister-device — remove FCM device token (on logout)
router.delete('/unregister-device', async (req, res) => {
  try {
    const { device_token } = req.body;
    if (device_token) {
      await removeDeviceToken(req.user.id, device_token);
    } else {
      // No token provided — remove all tokens for this user
      await removeAllDeviceTokens(req.user.id);
    }
    return res.json({ success: true, message: 'Device unregistered' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to unregister device' });
  }
});

// POST /api/notifications/push/test-fcm — test FCM push to current user
router.post('/push/test-fcm', async (req, res) => {
  try {
    const { title, body } = req.body;
    const result = await sendFCMToUser(req.user.id, {
      title: title || 'Test FCM Push',
      body: body || 'This is a test push notification via Firebase Cloud Messaging.',
      data: { type: 'test' },
    });
    return res.json({ success: result.success, sent: result.sent, failed: result.failed });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'FCM test failed' });
  }
});

// POST /api/notifications/push/broadcast — push to all workshop users
router.post('/push/broadcast', requireManager, async (req, res) => {
  try {
    const { title, body, url } = req.body;
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'title and body required' });
    }
    const result = await sendPushToWorkshop(req.workshopId, { title, body, url: url || '/' });
    return res.json({ success: result.success, sent: result.sent, failed: result.failed });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Broadcast failed' });
  }
});

export default router;
