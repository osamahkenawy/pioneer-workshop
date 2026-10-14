/**
 * PortalRedirect — old and unknown portal addresses, sent to the matching
 * /customer/* page with the rest of the path and the query string (the token
 * in a reset, set-password or verification link already in someone's inbox).
 *
 *   <Route path="/merchant/*" element={<PortalRedirect />} />
 *   <Route path="/portal/*" element={<PortalRedirect />} />
 *   <Route path="/customer/*" element={<PortalRedirect />} />   (after the real /customer/… routes)
 *
 * e.g. /merchant/work-orders/42 → /customer/jobs/42,
 *      /portal/set-password?token=… → /customer/set-password?token=…,
 *      /customer/home → /customer/dashboard.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { legacyPortalTarget, PORTAL } from './portalPaths';

export default function PortalRedirect() {
  const { pathname, search } = useLocation();
  let to = legacyPortalTarget(pathname, search);
  // A /customer/* catch-all that maps onto itself means that page has no
  // route: go Home (or to sign-in, if Home itself is missing) instead of
  // redirecting in a loop.
  const toPath = to.split('?')[0];
  if (toPath === pathname.replace(/\/+$/, '')) to = pathname.startsWith(PORTAL.home) ? PORTAL.login : PORTAL.home;
  return <Navigate to={to} replace />;
}
