import { Link, useLocation } from 'react-router-dom';
import { Home, NavArrowRight } from 'iconoir-react';

/**
 * Auto-generated breadcrumbs from route path.
 * Renders: Dashboard > Workshops > Detail
 */

const ROUTE_LABELS = {
  'super-admin': null, // skip
  dashboard: 'Dashboard',
  workshops: 'Workshops',
  users: 'Platform Users',
  modules: 'Modules',
  subscriptions: 'Subscriptions',
  revenue: 'Revenue',
  announcements: 'Announcements',
  tickets: 'Support Tickets',
  'email-templates': 'Email Templates',
  'landing-contacts': 'Landing Contacts',
  branding: 'Branding',
  barcodes: 'Barcodes',
  vacancies: 'Vacancies',
  'bulk-operations': 'Bulk Operations',
  'system-health': 'System Health',
  analytics: 'Analytics',
  'audit-log': 'Audit Log',
  backups: 'Backups & Export',
  settings: 'Settings',
  onboarding: 'Onboard Workshop',
};

export default function SABreadcrumb() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  const crumbs = [];
  let currentPath = '';

  for (const seg of segments) {
    currentPath += `/${seg}`;
    const label = ROUTE_LABELS[seg];
    if (label === null) continue; // skip "super-admin"
    if (label) {
      crumbs.push({ label, path: currentPath });
    } else if (/^\d+$/.test(seg)) {
      crumbs.push({ label: 'Detail', path: currentPath });
    } else {
      // Unknown segment — capitalize it
      crumbs.push({
        label: seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        path: currentPath,
      });
    }
  }

  if (crumbs.length === 0) return null;

  return (
    <nav className="sa-breadcrumb" aria-label="Breadcrumb">
      <Link to="/super-admin/dashboard" className="sa-breadcrumb-home">
        <Home size={15} />
      </Link>
      {crumbs.map((crumb, i) => (
        <span key={crumb.path} className="sa-breadcrumb-segment">
          <NavArrowRight size={14} className="sa-breadcrumb-sep" />
          {i === crumbs.length - 1 ? (
            <span className="sa-breadcrumb-current">{crumb.label}</span>
          ) : (
            <Link to={crumb.path} className="sa-breadcrumb-link">{crumb.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
