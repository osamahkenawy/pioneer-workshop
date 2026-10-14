/**
 * portalPaths.js — where the customer portal's pages live.
 *
 * The portal lives at /customer/* (Home is /customer/dashboard). It replaced
 * the delivery product's /merchant/*, and for a while it was planned at
 * /portal/*. Every link in the portal is built here, so the base changes in
 * one place; the server builds the links in its e-mails the same way
 * (car-workshop-backend/src/lib/portal-access.js portalUrl). Old /merchant/*
 * and /portal/* links (e-mails already sent, bookmarks) and old page names
 * under /customer/* are sent to the right page by PortalRedirect.jsx.
 *
 * Not to be confused with the staff pages /customers, /customer-feedback and
 * /customer-experience: they do not start with '/customer/'.
 */
export const PORTAL_BASE = '/customer';

/** '/customer/<page>' */
export const portalPath = (page = '') => `${PORTAL_BASE}${page ? `/${String(page).replace(/^\/+/, '')}` : ''}`;

export const PORTAL = Object.freeze({
  home: portalPath('dashboard'),
  jobs: portalPath('jobs'),
  job: id => portalPath(`jobs/${id}`),
  vehicles: portalPath('vehicles'),
  invoices: portalPath('invoices'),
  settings: portalPath('settings'),
  login: portalPath('login'),
  register: portalPath('register'),
  resetPassword: portalPath('reset-password'),
  setPassword: portalPath('set-password'),
  verifyEmail: portalPath('verify-email'),
});

/** True for a path inside the portal ('/customer' or '/customer/…'), never '/customers'. */
export const isPortalPath = p => typeof p === 'string' && (p === PORTAL_BASE || p.startsWith(`${PORTAL_BASE}/`));

/**
 * The portal page for an old or unknown portal path, keeping the query string
 * (the token in a reset, set-password or verification link). Handles the
 * /merchant/*, /portal/* and /customer/* prefixes; unknown pages go to Home,
 * whose sign-in guard sends a signed-out visitor to the sign-in page.
 * @param {string} pathname e.g. '/merchant/work-orders/42', '/portal/jobs/42' or '/customer/home'
 * @param {string} [search] e.g. '?token=…'
 */
export function legacyPortalTarget(pathname, search = '') {
  const rest = String(pathname || '').replace(/^\/(merchant|portal|customer)(\/|$)/, '').replace(/\/+$/, '');
  const [page = '', id] = rest.split('/');
  const map = {
    '': PORTAL.home, home: PORTAL.home, dashboard: PORTAL.home, 'create-order': PORTAL.home,
    jobs: id ? PORTAL.job(id) : PORTAL.jobs,
    'work-orders': id ? PORTAL.job(id) : PORTAL.jobs,
    'job-cards': id ? PORTAL.job(id) : PORTAL.jobs,
    'service-status': PORTAL.jobs, tracking: PORTAL.jobs,
    invoices: PORTAL.invoices, wallet: PORTAL.invoices,
    addresses: PORTAL.vehicles, vehicles: PORTAL.vehicles,
    settings: PORTAL.settings, profile: PORTAL.settings,
    login: PORTAL.login, register: PORTAL.register,
    'reset-password': PORTAL.resetPassword, 'set-password': PORTAL.setPassword, 'verify-email': PORTAL.verifyEmail,
  };
  return `${map[page] || PORTAL.home}${search || ''}`;
}
