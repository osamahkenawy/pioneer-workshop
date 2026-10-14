/**
 * Protected.jsx — the staff app's route guard, and where each kind of
 * session starts.
 *
 *   <Protected>…</Protected>                         any signed-in staff member whose
 *                                                    role has the page's menu module
 *   <Protected module="service-status">…</Protected>  … that module, named explicitly
 *   <Protected managersOnly>…</Protected>             … and a manager
 *
 * - Signed out → /login, which returns to the page asked for after sign-in
 *   (state.from), so links in e-mails and notifications still land.
 * - A customer account in the staff session (someone who signed in on the
 *   staff page with their portal login) → the customer portal.
 * - A technician uses the technician app (/mechanic, /mechanic/…) only. Any
 *   other page sends them to My Jobs; a work order page opens their card on
 *   that work order (/mechanic?wo=:id). The vehicle inspection
 *   (/work-orders/:id/inspection) is the Service Advisor's, and /mechanics and
 *   /mechanic-earnings are staff pages.
 * - Without a module prop, the page's module comes from the sidebar
 *   (Layout's ROUTE_MODULES, longest matching path): '/customers' needs
 *   'customers', '/crm/reminders' needs 'crm-reminders'. The Dashboard and the
 *   vehicle inspection need none.
 * - A role without the module, or a non-manager on a managers' page, sees
 *   "Not available for your role" inside the normal frame, with a link to its
 *   own home page. The server still checks every request; this only decides
 *   what to show.
 *
 * The staff session (AuthContext, auth_token) and the customer portal session
 * (CustomerAuthContext, crm_token) are separate and can both be open in one
 * browser. StaffSessionNote and CustomerSessionNote say so on the sign-in
 * pages instead of one session taking the other's page over.
 */
import { useContext } from 'react';
import { Navigate, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock } from 'iconoir-react';
import { AuthContext } from '../context/AuthContext';
import { CustomerAuthContext } from '../context/CustomerAuthContext';
import { hasModule, isTechnician, isCustomer, isManager } from '../lib/modules';
import { PORTAL } from '../pages/CustomerPortal/portalPaths';
import Layout, { ROUTE_MODULES } from './Layout';
import Loader from './Loader';

export const STAFF_HOME = '/dashboard';
export const TECHNICIAN_HOME = '/mechanic';

/** The page a session starts on: staff → Dashboard, technician → My Jobs, customer → the portal. */
export function homeFor(user) {
  if (!user) return '/login';
  if (isCustomer(user)) return PORTAL.home;
  if (isTechnician(user)) return TECHNICIAN_HOME;
  return STAFF_HOME;
}

/** A path in the technician app. Not '/mechanics' or '/mechanic-earnings'. */
export const isTechnicianPath = p => p === TECHNICIAN_HOME || p.startsWith(`${TECHNICIAN_HOME}/`);

const INSPECTION_PAGE = /^\/work-orders\/[^/]+\/inspection\/?$/;
const WORK_ORDER_PAGE = /^\/work-orders\/(\d+)\/?$/;

/**
 * Where a technician who opened `pathname` should be: null when the page is
 * theirs to use (the technician app), otherwise My Jobs (with ?wo= for a
 * work order page).
 */
export function technicianTarget(pathname) {
  if (isTechnicianPath(pathname)) return null;
  const wo = pathname.match(WORK_ORDER_PAGE);
  return wo ? `${TECHNICIAN_HOME}?wo=${wo[1]}` : TECHNICIAN_HOME;
}

/** The menu module a staff page needs (ROUTE_MODULES, longest path), or undefined. */
export function moduleForPath(pathname) {
  if (INSPECTION_PAGE.test(pathname) || isTechnicianPath(pathname)) return undefined;
  let best;
  for (const path of Object.keys(ROUTE_MODULES)) {
    if ((pathname === path || pathname.startsWith(`${path}/`)) && (!best || path.length > best.length)) best = path;
  }
  return best ? ROUTE_MODULES[best] : undefined;
}

function NotAvailable({ home }) {
  const { t } = useTranslation();
  return (
    <div className="role-blocked" role="alert">
      <span className="role-blocked-icon" aria-hidden="true"><Lock width={26} height={26} strokeWidth={1.8} /></span>
      <h2 className="role-blocked-title">{t('access.not_available_title', 'Not available for your role')}</h2>
      <p className="role-blocked-text">
        {t('access.not_available_body', 'This page is not part of your role. Ask a manager if you need it.')}
      </p>
      <Link to={home} className="role-blocked-btn">{t('access.back_home', 'Go to your home page')}</Link>
    </div>
  );
}

export default function Protected({ children, module, managersOnly = false }) {
  const { user, loading } = useContext(AuthContext);
  const { pathname, search } = useLocation();

  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace state={{ from: pathname + search }} />;
  if (isCustomer(user)) return <Navigate to={PORTAL.home} replace />;
  if (isTechnician(user)) {
    const to = technicianTarget(pathname);
    if (to) return <Navigate to={to} replace />;
  }
  const needs = module || moduleForPath(pathname);
  if ((needs && !hasModule(user, needs)) || (managersOnly && !isManager(user))) {
    return <Layout><NotAvailable home={homeFor(user)} /></Layout>;
  }
  return <Layout>{children}</Layout>;
}

/**
 * For "/" and unknown addresses: the home page of whoever is signed in.
 * A staff session wins when both are open; a portal customer goes to the
 * portal; nobody signed in → the staff sign-in page.
 */
export function RoleHome() {
  const { user, loading } = useContext(AuthContext);
  const { user: customer, loading: customerLoading } = useContext(CustomerAuthContext);
  if (user) return <Navigate to={homeFor(user)} replace />;
  if (loading || customerLoading) return <Loader />;
  if (customer) return <Navigate to={PORTAL.home} replace />;
  return <Navigate to="/login" replace />;
}

/**
 * Above the customer portal's sign-in pages when a staff session is open in
 * this browser. Signing in to the portal does not end it.
 */
export function StaffSessionNote() {
  const { user, logout } = useContext(AuthContext);
  const { t } = useTranslation();
  if (!user || isCustomer(user)) return null;
  const name = user.full_name || user.username || '';
  return (
    <div className="session-note session-note--bar" role="status">
      <span className="session-note-text">
        {t('session.staff_open', {
          name,
          defaultValue: 'You are signed in to the staff app as {{name}}. The customer portal has its own sign-in; your staff session stays open.',
        })}
      </span>
      <span className="session-note-actions">
        <Link to={homeFor(user)} className="session-note-link">{t('session.back_to_staff', 'Back to the staff app')}</Link>
        <button type="button" className="session-note-link" onClick={() => logout()}>
          {t('session.sign_out_staff', 'Sign out of the staff app')}
        </button>
      </span>
    </div>
  );
}

/** On the staff sign-in page when a customer portal session is open in this browser. */
export function CustomerSessionNote() {
  const { user: customer } = useContext(CustomerAuthContext);
  const { t } = useTranslation();
  if (!customer) return null;
  const name = customer.full_name || customer.company_name || customer.email || '';
  return (
    <div className="session-note" role="status">
      <span className="session-note-text">
        {t('session.customer_open', {
          name,
          defaultValue: 'You are signed in to the customer portal as {{name}}. This page is the staff sign-in.',
        })}
      </span>
      <span className="session-note-actions">
        <Link to={PORTAL.home} className="session-note-link">{t('session.go_to_portal', 'Go to your portal')}</Link>
      </span>
    </div>
  );
}
