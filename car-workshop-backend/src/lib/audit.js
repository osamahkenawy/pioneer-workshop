/**
 * audit.js — Lightweight audit log writer
 *
 * Fire-and-forget: failures are logged to console but never thrown, so a
 * broken audit_logs table (or a transient DB hiccup) can never take down a
 * request that's just trying to record "who did what."
 */

import { execute } from './database.js';

/**
 * Insert one row into `audit_logs`.
 *
 * @param {object} params
 * @param {number} params.workshopId
 * @param {number} params.userId
 * @param {string} params.action - e.g. 'dispute.created', 'escrow.hold'
 * @param {string} params.entityType - e.g. 'dispute', 'wallet', 'settings'
 * @param {number|string} params.entityId
 * @param {*} [params.oldValue] - JSON-serializable snapshot before the change
 * @param {*} [params.newValue] - JSON-serializable snapshot after the change
 * @param {string} [params.ip]
 * @param {string} [params.userAgent]
 *
 * Also accepts the positional form the SOW route files (job-cards, sublet,
 * inventory, appointments, vehicle-receiving, vat-evhc-integration) were
 * written against:
 *   logAudit(workshopId, userId, action, entityType, entityId, oldValue, newValue)
 * Passed to the object signature, every field was undefined and the insert
 * failed on audit_logs.workshop_id NOT NULL, so those modules had no audit
 * trail at all.
 */
export async function logAudit(...args) {
  const first = args[0];
  const {
    workshopId,
    userId,
    action,
    entityType,
    entityId,
    oldValue = null,
    newValue = null,
    ip = null,
    userAgent = null,
  } = (first !== null && typeof first === 'object')
    ? first
    : {
        workshopId: args[0], userId: args[1], action: args[2], entityType: args[3],
        entityId: args[4], oldValue: args[5] ?? null, newValue: args[6] ?? null,
      };
  try {
    await execute(
      `INSERT INTO audit_logs
        (workshop_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        workshopId ?? null,
        userId ?? null,
        action ?? null,
        entityType ?? null,
        entityId ?? null,
        oldValue != null ? JSON.stringify(oldValue) : null,
        newValue != null ? JSON.stringify(newValue) : null,
        ip,
        userAgent,
      ]
    );
  } catch (err) {
    console.error('[Audit] Failed to write audit log:', err.message);
  }
}
