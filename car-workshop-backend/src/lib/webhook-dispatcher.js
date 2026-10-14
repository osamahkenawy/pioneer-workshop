/**
 * ═══════════════════════════════════════════════════════════════════
 *  Webhook Dispatcher  —  fire outbound webhooks for work order events
 * ═══════════════════════════════════════════════════════════════════
 *  Called by work-orders.js, service-status.js, job-assignment.js,
 *  warranty-claims.js, cash-payment.js at the end of every
 *  state-changing operation.
 *
 *  Usage:
 *    import { dispatchWebhook } from '../lib/webhook-dispatcher.js';
 *    dispatchWebhook({ tenantId: workshopId, event: workOrderStatusToEvent(status), data: order });
 *
 *  Non-blocking — all failures are logged, never thrown.
 * ═══════════════════════════════════════════════════════════════════
 */
import { query } from './database.js';
import { deliverWebhook } from '../routes/webhooks.js';

/**
 * dispatchWebhook
 * Finds all active webhook endpoints subscribed to `event` for the
 * given workshop, then fires them all concurrently (non-blocking).
 * Failed deliveries are automatically retried up to 2 more times
 * with exponential back-off (5 s → 60 s).
 *
 * @param {object} opts
 * @param {number} opts.workshopId
 * @param {string} opts.event    — e.g. 'work_order.ready_for_collection'. An
 *                                 endpoint still subscribed to an older name of
 *                                 the event (EVENT_ALIASES) gets it under that name.
 * @param {object} opts.data     — payload data (order, mechanic, etc.)
 */

/** Delays (ms) before retry attempt 2, then attempt 3 */
const RETRY_DELAYS = [5_000, 60_000];

export async function dispatchWebhook({ tenantId, event, data }) {
  const workshopId = tenantId;
  if (!workshopId || !event) return;

  try {
    const names = [event, ...(EVENT_ALIASES[event] || [])];
    // workshop_id — this read tenant_id, which does not exist, so no webhook ever fired.
    const endpoints = await query(
      `SELECT id, url, secret, headers, events
       FROM webhook_endpoints
       WHERE workshop_id = ? AND is_active = 1
         AND (${names.map(() => 'JSON_CONTAINS(events, JSON_QUOTE(?))').join(' OR ')})`,
      [workshopId, ...names]
    );

    if (!endpoints?.length) return;

    const timestamp = new Date().toISOString();

    // Fire each endpoint independently (non-blocking); each manages its own retries
    for (const ep of endpoints) {
      let subscribed = [];
      try { subscribed = typeof ep.events === 'string' ? JSON.parse(ep.events) : (ep.events || []); } catch { /* none */ }
      const name = names.find(n => subscribed.includes(n)) || event;
      const payload = { event: name, timestamp, tenant_id: workshopId, data };
      _deliverWithRetry({ endpoint: ep, event: name, payload, workshopId, attempt: 1 })
        .catch(e => console.error(`[Webhook] unhandled error for ${ep.url}:`, e.message));
    }
  } catch (err) {
    // Never throw — webhook failures must never affect the main request
    console.error('[Webhook] Dispatcher error:', err.message);
  }
}

/**
 * _deliverWithRetry
 * Attempts delivery and, on failure, schedules the next retry up to
 * RETRY_DELAYS.length additional attempts.
 */
async function _deliverWithRetry({ endpoint, event, payload, workshopId, attempt }) {
  try {
    const result = await deliverWebhook({ endpoint, event, payload, tenantId: workshopId });

    if (result?.status === 'failed') {
      const retryIndex = attempt - 1; // 0-based index into RETRY_DELAYS
      if (retryIndex < RETRY_DELAYS.length) {
        const delayMs = RETRY_DELAYS[retryIndex];
        console.warn(
          `[Webhook] ${event} → ${endpoint.url} failed (attempt ${attempt}/${attempt + RETRY_DELAYS.length - retryIndex}),` +
          ` retrying in ${delayMs / 1000}s`
        );
        setTimeout(() => {
          _deliverWithRetry({ endpoint, event, payload, workshopId, attempt: attempt + 1 })
            .catch(e => console.error(`[Webhook] retry error ${endpoint.url}:`, e.message));
        }, delayMs);
      } else {
        console.error(`[Webhook] ${event} → ${endpoint.url} permanently failed after ${attempt} attempt(s).`);
      }
    }
  } catch (err) {
    console.error(`[Webhook] ${event} → ${endpoint.url} attempt ${attempt} threw:`, err.message);
  }
}

// ── Event name helpers ────────────────────────────────────────

/**
 * Work order status → webhook event, in the workshop's words (Steps 1–7).
 * Every stored status is mapped; the courier events (picked_up, in_transit,
 * delivered, failed, returned) are gone — no status ever produced them.
 */
const WORK_ORDER_EVENTS = {
  pending:           'work_order.received',
  confirmed:         'work_order.inspected',
  estimate_approved: 'work_order.approved',
  auto_assign:       'work_order.approved',
  assigned:          'work_order.assigned',
  accepted:          'work_order.assigned',
  in_progress:       'work_order.in_progress',
  inspection:        'work_order.quality_check',
  ready_for_pickup:  'work_order.ready_for_collection',
  completed:         'work_order.closed',
  cancelled:         'work_order.cancelled',
};

/**
 * Older names of an event that endpoints may still be subscribed to — the
 * names routes/webhooks.js used to offer, and the order.* names this file
 * used to send (and Settings → Integrations still offers). Such an endpoint
 * receives the event under its old name.
 */
export const EVENT_ALIASES = Object.freeze({
  'work_order.received':             ['work_order.created', 'order.created'],
  'work_order.inspected':            ['work_order.confirmed', 'order.confirmed'],
  'work_order.assigned':             ['work_order.accepted', 'order.assigned'],
  'work_order.ready_for_collection': ['work_order.ready_for_pickup'],
  'work_order.closed':               ['work_order.completed', 'order.delivered'],
  'work_order.cancelled':            ['order.cancelled'],
});

/** Map a work order status to its webhook event name */
export function workOrderStatusToEvent(status) {
  return WORK_ORDER_EVENTS[status] || null;
}

/** Map a warranty claim status to its webhook event name */
export function warrantyClaimStatusToEvent(status) {
  const map = {
    approved:         'return.approved',
    pickup_scheduled: 'return.pickup_scheduled',
    picked_up:        'return.picked_up',
    received:         'return.received',
    refunded:         'return.refunded',
    rejected:         'return.rejected',
  };
  return map[status] || null;
}
