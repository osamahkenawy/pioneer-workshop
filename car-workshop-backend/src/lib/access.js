/**
 * access.js — who may reach what.
 *
 * Every staff router is guarded by authMiddleware alone, which only checked
 * that the caller is logged in. Two kinds of account share that JWT and must
 * not reach the staff API:
 *
 *   customer — anyone can create one (POST /api/customer-auth/register is
 *              public), and with it read every customer, change settings,
 *              delete invoices.
 *   mechanic — a technician's login could create admins or reset the
 *              owner's password through /api/settings/users.
 *
 * Both are now held to the routes their own screens use. Separately,
 * administrative writes (users, roles, workshop settings) and destructive
 * deletes need a manager.
 *
 * Retired APIs (RETIRED_PREFIXES) are refused for every account: they are
 * leftovers of the delivery product that still answer if mounted.
 */
import { effectiveRole, isManagerRole } from './roles.js';

// Roles that run the workshop: may manage users and settings, delete records.
const MANAGER_ROLES = ['admin', 'super_admin', 'general_manager', 'workshop_manager'];

export function isManager(user) {
  return !!user && (MANAGER_ROLES.includes(user.role) || MANAGER_ROLES.includes(user.role_slug) || user.is_owner === 1);
}

// Path prefixes (no query string) each restricted role may use.
const CUSTOMER_ROUTES = ['/api/customer-portal', '/api/customer-auth', '/api/user-notifications', '/api/auth'];

// The technician app (My Jobs, the job card, Scan, Finished jobs) reads and
// books everything through /api/job-cards (/mine…), which strips customer
// contact details and prices. /api/service-status stays reachable for GET
// /my-orders only; the token tools in routes/service-status.js refuse a
// technician themselves. The intake inspection (/api/vehicle-inspections) is
// the Service Advisor's: it carries the customer's name, phone and e-mail and
// can be completed, signed and shared, so technicians do not reach it.
const MECHANIC_ROUTES = [
  '/api/auth', '/api/user-notifications', '/api/service-status',
  '/api/uploads', '/api/job-cards',
];
// Read-only for mechanics: the plan banner every screen loads. The staff
// work order and vehicle lists are not theirs (no technician screen calls
// them since the technician app replaced the courier screens).
const MECHANIC_READ_ROUTES = ['/api/workshops/usage'];

// The courier mobile API (routes/mechanic-app.js): reject, fail, collect cash
// and deliver, with statuses a workshop job does not have. No longer mounted
// (server.js); refused for every account should it come back.
const RETIRED_PREFIXES = ['/api/mechanic-app'];

/** Whether this user's role may call this route at all. */
export function roleMayUseRoute(user, method, path) {
  const under = (prefixes) => prefixes.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
  if (under(RETIRED_PREFIXES)) return false;
  if (user.role === 'customer') return under(CUSTOMER_ROUTES);
  // users.role 'mechanic', or a roles row with the technician slug (the same
  // test the routers use, isTechnician()).
  if (user.role === 'mechanic' || isTechnician(user)) {
    if (under(MECHANIC_ROUTES)) return true;
    return method === 'GET' && under(MECHANIC_READ_ROUTES);
  }
  return true;
}

/**
 * A technician's login: the workflow role 'technician' (users.role
 * 'mechanic', or a roles row with that slug). Managers never count, whatever
 * their role row says. Technicians work from My Jobs (/api/job-cards), not
 * from the staff tools.
 */
export function isTechnician(user) {
  return !!user && effectiveRole(user) === 'technician' && !isManagerRole(user);
}

/** Express middleware: managers only. */
export function requireManager(req, res, next) {
  if (!isManager(req.user)) {
    return res.status(403).json({ success: false, message: 'Only a manager can do this.' });
  }
  next();
}

/** Express middleware: managers only for anything that changes data. */
export function managerForWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return requireManager(req, res, next);
}

/**
 * Self-service workshop signup (trial, licence activation, public register)
 * creates a new tenant and an admin account from an anonymous request. Pioneer
 * runs as one workshop, so these are off unless ALLOW_PUBLIC_SIGNUP=true.
 */
export function publicSignupGate(req, res, next) {
  if (process.env.ALLOW_PUBLIC_SIGNUP === 'true') return next();
  return res.status(404).json({ success: false, message: 'Not found' });
}
