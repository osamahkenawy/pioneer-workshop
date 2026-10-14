/**
 * modules.js — may this user open a page (menu module)?
 *
 * Reads `permitted_modules` from the login response (backend routes/auth.js):
 *   an array — the role's modules, already narrowed to the workshop's
 *              allowed_modules: the key must be in it;
 *   null     — no role row (owners, old accounts): staff are allowed,
 *              technicians and customers are not.
 *
 * This differs on purpose from hasModule in lib/permissions.js, where null
 * allows everyone: a route guard built on this one never opens a staff page
 * to a technician or customer whose session has no module list. The server
 * still enforces access either way; this only decides what to show.
 */

/**
 * Module keys of the pages the workshop clean-up added or renamed. The keys
 * are the existing ones, so roles already configured keep working.
 */
export const MODULES = Object.freeze({
  vehicleBoard: 'service-status',        // Vehicle Status Board (/vehicle-board), was Service Tracking
  technicianJobs: 'mechanic-dashboard',  // My Jobs (/mechanic)
  technicianScan: 'mechanic-scan',       // Scan job card (/mechanic/scan)
  technicianHistory: 'my-work-orders',   // Finished jobs (/mechanic/history)
});

/** A technician account (users.role 'mechanic'). */
export function isTechnician(user) {
  return user?.role === 'mechanic' || user?.role_slug === 'technician' || user?.role_slug === 'mechanic';
}

const MANAGER_ROLES = ['admin', 'super_admin', 'general_manager', 'workshop_manager'];

/** A manager (owner, admin, General or Workshop Manager); mirrors backend lib/roles.js isManagerRole. */
export function isManager(user) {
  return !!user && (user.is_owner === true || Number(user.is_owner) === 1
    || MANAGER_ROLES.includes(user.role) || MANAGER_ROLES.includes(user.role_slug));
}

/** A customer-portal account. */
export function isCustomer(user) {
  return user?.role === 'customer' || user?.role_slug === 'customer';
}

/**
 * True when `user` may open the module `key`.
 *
 * @param {{role?: string, role_slug?: string, permitted_modules?: (string[]|null)}|null} user
 * @param {string} [key]  a module key (see MODULES and Layout's moduleKey);
 *   no key means nothing is required → true for any signed-in user.
 * @returns {boolean} false when nobody is signed in.
 *
 * @example hasModule(user, MODULES.vehicleBoard)  // show the "Vehicle board" button
 */
export function hasModule(user, key) {
  if (!user) return false;
  if (!key) return true;
  if (Array.isArray(user.permitted_modules)) return user.permitted_modules.includes(key);
  return !isTechnician(user) && !isCustomer(user);
}
