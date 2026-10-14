/**
 * job-delay-checker.js — jobs running late in the workshop
 * (renamed from delivery-delay-checker.js)
 *
 * Runs every 30 minutes over live jobs (opened in the last 14 days — the
 * imported history sits open forever) and tells the person who can move
 * each one (S14):
 *
 *   assigned, no time booked for 6 h, or past the promised time
 *       → the technician (in-app + push, opening their job card) and managers
 *   in progress and past the planned finish (Team Leader's booking) or the
 *   promised time, or no clock running and nothing booked for 8 h
 *       → the technician and managers
 *   quality check (every job card done) waiting more than 2 h
 *       → the QC group (Supervisor, Workshop Foreman, Team Leader)
 *   ready for collection and not collected after 24 h
 *       → the Service Advisors
 *
 * A car waiting for its quality check or for the customer is not the
 * technician's to fix, so they are never told about those.
 *
 * Each work order is alerted once per kind, then again after 4 h, 12 h and
 * 24 h, then no more.
 */

import cron from 'node-cron';
import { query } from './database.js';
import { createInAppNotification } from './notify.js';
import { sendPushToUser } from './push.js';
import { sendFCMToUser } from './firebase.js';
import { getIO } from './socket.js';
import { usersInGroups, notifyGroups, technicianJobLink, FLOOR } from './workflow.js';

let cronJob = null;
let isRunning = false; // re-entry guard — if a tick is still running, skip the next

// Thresholds (in hours)
const DELAY_THRESHOLDS = {
  not_started: 6,      // assigned / accepted with no time booked
  no_booking: 8,       // in progress with no clock running and nothing booked
  quality_check: 2,    // every job card done, quality check not recorded
  collection: 24,      // ready for collection, not collected
};

// What each kind of delay is recorded as (user_notifications.type — also the
// dedup key of createInAppNotification, and the escalation history below).
const DELAY_TYPES = {
  technician: 'job_delay',            // not started / running late
  quality_check: 'job_delay_qc',
  collection: 'job_delay_collection',
};

// Hard caps to keep memory + DB pressure bounded under load
const MAX_ORDERS_PER_TICK = 500;     // never process more than this in one cron run
const HISTORY_CHUNK_SIZE  = 200;     // chunk size for `WHERE work_order_id IN (...)`
const ADMIN_CACHE_TTL_MS  = 5 * 60_000; // cache the manager lookup per workshop for 5 min
const workshopAdminCache = new Map();  // Map<workshopId, { ids:number[], at:number }>

// Escalation: notify once, then 4h, 12h, 24h after the previous alert, then stop.
const ESCALATION_GAPS_MS = [
  0,             // 1st alert: send immediately
  4  * 3600_000, // 2nd alert: 4h after 1st
  12 * 3600_000, // 3rd alert: 12h after 2nd
  24 * 3600_000, // 4th alert: 24h after 3rd
];
const MAX_ALERTS_PER_ORDER = ESCALATION_GAPS_MS.length;

/**
 * Start the delay-checker cron (every 30 minutes)
 */
export function startJobDelayChecker() {
  if (cronJob) return;

  cronJob = cron.schedule('*/30 * * * *', async () => {
    if (isRunning) {
      console.warn('[DelayChecker] Previous run still in progress — skipping this tick.');
      return;
    }
    isRunning = true;
    const startedAt = Date.now();
    console.log('[DelayChecker] Running job delay check…');
    try {
      await checkJobDelays();
    } catch (err) {
      console.error('[DelayChecker] Error:', err.message);
    } finally {
      isRunning = false;
      console.log(`[DelayChecker] Tick finished in ${Date.now() - startedAt}ms`);
    }
  });

  console.log('[DelayChecker] Cron scheduled — every 30 minutes');
}

const hours = minutes => Math.floor(Number(minutes || 0) / 60);

/**
 * Which delay a live work order is in, if any:
 * { kind: 'technician'|'quality_check'|'collection', reason, detail } or null.
 * Exported for tests.
 */
export function classifyDelay(o) {
  const promiseLate = !!o.past_promise;
  if (['assigned', 'accepted'].includes(o.status) && Number(o.bookings) === 0) {
    if (promiseLate) return { kind: 'technician', reason: 'overdue', detail: 'past the promised time and not started' };
    if (o.status_minutes >= DELAY_THRESHOLDS.not_started * 60) {
      return { kind: 'technician', reason: 'not_started', detail: `assigned ${hours(o.status_minutes)} h ago — no time booked yet` };
    }
  }
  if (o.status === 'in_progress') {
    if (o.past_planned_end) return { kind: 'technician', reason: 'past_planned_end', detail: 'past the planned finish time' };
    if (promiseLate) return { kind: 'technician', reason: 'overdue', detail: 'past the promised time' };
    if (Number(o.clocks_running) === 0 && o.idle_minutes >= DELAY_THRESHOLDS.no_booking * 60) {
      return { kind: 'technician', reason: 'no_booking', detail: `no time booked for ${hours(o.idle_minutes)} h` };
    }
  }
  if (o.status === 'inspection' && o.status_minutes >= DELAY_THRESHOLDS.quality_check * 60) {
    return { kind: 'quality_check', reason: 'qc_waiting', detail: `job done ${hours(o.status_minutes)} h ago — waiting for the quality check` };
  }
  if (o.status === 'ready_for_pickup' && o.status_minutes >= DELAY_THRESHOLDS.collection * 60) {
    return { kind: 'collection', reason: 'not_collected', detail: `ready for collection for ${hours(o.status_minutes)} h` };
  }
  return null;
}

/**
 * The live work orders that are late now, each with its delay:
 * Map<workOrderId, row + { kind, reason, detail, type }>. Reads only.
 */
export async function findDelayedJobs() {
  // One pass over the live jobs. Every time difference is worked out in SQL,
  // against the database clock the timestamps were written with.
  const rows = await query(`
    SELECT x.*,
           TIMESTAMPDIFF(MINUTE, COALESCE(x.status_since, x.started_at, x.created_at), NOW()) AS status_minutes,
           TIMESTAMPDIFF(MINUTE, COALESCE(x.last_booking_at, x.status_since, x.started_at, x.created_at), NOW()) AS idle_minutes,
           (x.scheduled_end_at IS NOT NULL AND x.scheduled_end_at < NOW()) AS past_planned_end,
           (x.estimated_completion_at IS NOT NULL AND x.estimated_completion_at < NOW()) AS past_promise
      FROM (
        SELECT o.id, o.work_order_number, o.workshop_id, o.mechanic_id, o.status,
               o.created_at, o.started_at, o.estimated_completion_at,
               d.full_name AS mechanic_name, d.user_id AS mechanic_user_id,
               v.plate_number, v.make, v.model,
               (SELECT jc.job_card_number FROM job_cards jc
                 WHERE jc.work_order_id = o.id AND jc.parent_job_card_id IS NULL AND jc.status <> 'cancelled'
                 ORDER BY jc.id LIMIT 1) AS job_card_number,
               (SELECT MAX(sl.created_at) FROM work_order_status_logs sl
                 WHERE sl.work_order_id = o.id AND sl.status = o.status) AS status_since,
               (SELECT a.scheduled_end_at FROM work_order_assignments a
                 WHERE a.work_order_id = o.id AND a.is_current = 1 ORDER BY a.id DESC LIMIT 1) AS scheduled_end_at,
               (SELECT COUNT(*) FROM technician_time_logs t JOIN job_cards jc ON jc.id = t.job_card_id
                 WHERE jc.work_order_id = o.id) AS bookings,
               (SELECT COUNT(*) FROM technician_time_logs t JOIN job_cards jc ON jc.id = t.job_card_id
                 WHERE jc.work_order_id = o.id AND t.clock_out IS NULL) AS clocks_running,
               (SELECT MAX(COALESCE(t.clock_out, t.clock_in)) FROM technician_time_logs t JOIN job_cards jc ON jc.id = t.job_card_id
                 WHERE jc.work_order_id = o.id) AS last_booking_at
          FROM work_orders o
          LEFT JOIN mechanics d ON o.mechanic_id = d.id
          LEFT JOIN vehicles v ON v.id = o.vehicle_id
         WHERE o.status IN ('assigned', 'accepted', 'in_progress', 'inspection', 'ready_for_pickup')
           AND o.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)  -- live jobs only: hundreds of imported legacy jobs sit 'in_progress' forever
      ) x
  `);

  // Each delayed work order with the kind of delay it is in
  const delayed = new Map();
  for (const o of rows) {
    const d = classifyDelay(o);
    if (d) delayed.set(o.id, { ...o, ...d, type: DELAY_TYPES[d.kind] });
  }
  return delayed;
}

/**
 * Core logic — find delayed work orders and send notifications
 */
async function checkJobDelays() {
  const allDelayed = await findDelayedJobs();

  if (allDelayed.size === 0) {
    console.log('[DelayChecker] No delayed work orders found.');
    return;
  }

  console.log(`[DelayChecker] Found ${allDelayed.size} delayed work order(s). Applying escalation…`);

  // Hard cap: never process more than MAX_ORDERS_PER_TICK in a single tick.
  // Anything truncated will be picked up next run.
  if (allDelayed.size > MAX_ORDERS_PER_TICK) {
    console.warn(`[DelayChecker] Capping ${allDelayed.size} work orders → ${MAX_ORDERS_PER_TICK} for this tick.`);
    const trimmed = [...allDelayed].slice(0, MAX_ORDERS_PER_TICK);
    allDelayed.clear();
    for (const [id, o] of trimmed) allDelayed.set(id, o);
  }

  // ── N1: Escalation backoff, per work order and kind of delay. One alert
  //        goes to several people, so a round is counted once per hour, not
  //        once per row.
  const orderIds = [...allDelayed.keys()];
  const history = new Map();   // Map<`${workOrderId}:${type}`, { count, lastNotifiedMs }>
  try {
    for (let i = 0; i < orderIds.length; i += HISTORY_CHUNK_SIZE) {
      const chunk = orderIds.slice(i, i + HISTORY_CHUNK_SIZE);
      const hist = await query(
        `SELECT work_order_id, type,
                COUNT(DISTINCT DATE_FORMAT(created_at, '%Y-%m-%d %H')) AS rounds, MAX(created_at) AS last_at
           FROM user_notifications
          WHERE type IN (?) AND work_order_id IN (?)
          GROUP BY work_order_id, type`,
        [Object.values(DELAY_TYPES), chunk]
      );
      for (const r of hist) {
        history.set(`${r.work_order_id}:${r.type}`, {
          count: Number(r.rounds) || 0,
          lastNotifiedMs: r.last_at ? new Date(r.last_at).getTime() : 0,
        });
      }
    }
  } catch (_) { /* no history — proceed anyway */ }

  let notifiedCount = 0;
  let suppressedDup = 0;
  let suppressedMax = 0;

  for (const [orderId, order] of allDelayed) {
    const h = history.get(`${orderId}:${order.type}`) || { count: 0, lastNotifiedMs: 0 };

    if (h.count >= MAX_ALERTS_PER_ORDER) {
      suppressedMax++;
      continue;
    }
    const requiredGap = ESCALATION_GAPS_MS[h.count];
    if (h.lastNotifiedMs && (Date.now() - h.lastNotifiedMs) < requiredGap) {
      suppressedDup++;
      continue;
    }

    try {
      await notifyDelay(order);
      notifiedCount++;
    } catch (err) {
      console.error(`[DelayChecker] Failed to notify for work order ${order.work_order_number}:`, err.message);
    }
  }

  console.log(
    `[DelayChecker] Notified ${notifiedCount} | suppressed (within backoff) ${suppressedDup} | suppressed (max alerts reached) ${suppressedMax}`
  );
}

/** Managers (admin, general manager, workshop manager) of a workshop, cached for 5 min. */
async function managerIds(workshopId) {
  const cached = workshopAdminCache.get(workshopId);
  if (cached && (Date.now() - cached.at) < ADMIN_CACHE_TTL_MS) return cached.ids;
  const ids = await usersInGroups(workshopId, ['manager']);
  workshopAdminCache.set(workshopId, { ids, at: Date.now() });
  return ids;
}

/**
 * Send delay notifications for a single work order
 */
async function notifyDelay(order) {
  const { workshop_id: workshopId, mechanic_user_id: mechanicUserId, work_order_number: orderNumber, mechanic_name: mechanicName } = order;
  const plate = order.plate_number ? ` · ${order.plate_number}` : '';
  const vehicle = [order.plate_number, [order.make, order.model].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  const card = order.job_card_number ? `Job card ${order.job_card_number}` : `Work order ${orderNumber}`;
  const link = `/work-orders/${order.id}`;

  // N12: plain titles (no emoji) — UI renders the icon separately.
  if (order.kind === 'quality_check') {
    await notifyGroups(workshopId, FLOOR, {
      title: `Waiting for quality check: ${orderNumber}${plate}`,
      body: `${card}${vehicle ? ` (${vehicle})` : ''}: ${order.detail}. Carry out the quality check and test drive.`,
      link, orderId: order.id, icon: 'clock', type: order.type,
    });
  } else if (order.kind === 'collection') {
    await notifyGroups(workshopId, ['service_advisor'], {
      title: `Not collected yet: ${orderNumber}${plate}`,
      body: `${vehicle || card} has been ${order.detail}. Call the customer to arrange collection.`,
      link, orderId: order.id, icon: 'clock', type: order.type,
    });
  } else {
    const notStarted = order.reason === 'not_started' || (order.reason === 'overdue' && order.status !== 'in_progress');
    // ── The technician: their job card in the technician app, no customer details ──
    if (mechanicUserId) {
      const title = notStarted ? `Job not started: ${orderNumber}${plate}` : `Job running late: ${orderNumber}${plate}`;
      const body = `${card}${vehicle ? ` (${vehicle})` : ''}: ${order.detail}. ${notStarted ? 'Press Start when you begin' : 'Book your time on the job card'}, or tell your Team Leader what is holding it up.`;
      const techLink = await technicianJobLink({ workshopId, mechanicId: order.mechanic_id, orderId: order.id });
      const r = await createInAppNotification({
        workshopId, userId: mechanicUserId, title, body,
        type: order.type, icon: 'clock', link: techLink, orderId: order.id,
      }).catch(() => null);
      if (r?.success && !r.deduped) {
        const pushPayload = { title, body, url: techLink, tag: `delay-${order.id}`, data: { orderId: String(order.id), orderNumber, type: 'job_delay', url: techLink } };
        await sendPushToUser(mechanicUserId, pushPayload).catch(() => {});
        await sendFCMToUser(mechanicUserId, pushPayload).catch(() => {});
      }
    }

    // ── Managers (in-app + push) ──
    const adminTitle = notStarted ? `Job not started: ${orderNumber}${plate}` : `Job running late: ${orderNumber}${plate}`;
    const adminBody = `${mechanicName || 'No technician'} — ${card}: ${order.detail}.`;
    for (const userId of await managerIds(workshopId)) {
      await createInAppNotification({
        workshopId, userId, title: adminTitle, body: adminBody,
        type: order.type, icon: 'clock', link, orderId: order.id,
      }).catch(() => {});
      const pushPayload = { title: adminTitle, body: adminBody, url: link, tag: `admin-delay-${order.id}`, data: { orderId: String(order.id), orderNumber } };
      await sendPushToUser(userId, pushPayload).catch(() => {});
      await sendFCMToUser(userId, pushPayload).catch(() => {});
    }
  }

  // ── Socket.io real-time event to workshop dashboard ──
  try {
    const io = getIO();
    io.to(`workshop:${workshopId}`).emit('work-order:job-delayed', {
      orderId: order.id,
      orderNumber,
      mechanicName: mechanicName || null,
      reason: order.reason,
      detail: order.detail,
      timestamp: new Date().toISOString(),
    });
  } catch (_) {}
}

/**
 * Manual trigger for testing
 */
export async function runJobDelayCheckNow() {
  return checkJobDelays();
}
