import { useState, useContext, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { isTechnician, isManager } from '../lib/modules';
import {
  HomeSimple, Package, User,
  DollarCircle, Bell, Wallet, Page, StatsUpSquare, Settings,
  Network, Menu, LogOut, Language,
  RefreshDouble, CreditCard, Medal, QrCode, Wrench, Archive, Megaphone,
  EmojiSatisfied, ClipboardCheck, StarSolid, WarningTriangle, GraphUp, Group, Truck, PageEdit, Shop, Calendar,
  Car, Garage, Tools, TaskList, UserBadgeCheck, CheckCircle,
} from 'iconoir-react';
import NotificationBell from './NotificationBell';
import PlanBadge from './dashboard/PlanBadge';
import TrialBanner from './dashboard/TrialBanner';
import './Layout.css';

const iconMap = {
  'dashboard':        HomeSimple,
  'orders':           ClipboardCheck,
  'estimates':        PageEdit,
  'appointments':     Calendar,
  'vehicle-board':    Garage,
  'mechanics':          Wrench,
  'job-assignment':         UserBadgeCheck,
  'team-leader':            Group,
  'fleet-intake':           Truck,
  // Technician app
  'tech-jobs':        Wrench,
  'tech-scan':        QrCode,
  'tech-history':     CheckCircle,
  'customers':          User,
  'vehicles':           Car,
  'parts':              Wrench,
  'enquiries':          Megaphone,
  'inventory':          Archive,
  'store':              Shop,
  'service_bays':            Tools,
  'pricing':          DollarCircle,
  'notifications':    Bell,
  'wallet':           Wallet,
  'invoices':         Page,
  'reports':          StatsUpSquare,
  'settings':         Settings,
  'api-keys':         Network,
  'returns':          RefreshDouble,
  'cod':              CreditCard,
  'performance':      Medal,
  'customer_feedback': EmojiSatisfied,
  'customer-360':     User,
  'reminders':        Bell,
  'crm-tasks':        TaskList,
  'customer-experience': StarSolid,
  'complaints':       WarningTriangle,
  'technician-kpi':   GraphUp,
};

/*
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * ROLE-BASED SIDEBAR NAVIGATION
 *
 * Each nav item has a `roles` array defining who can see it.
 * Roles: admin, dispatcher (staff), mechanic
 *
 * Admin        â†’ Full access to everything
 * Service Advisor   â†’ Operations + Finance (no config/system)
 * Mechanic       â†’ Only mechanic-specific pages
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

const navSections = [
  /* â”€â”€ MAIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  {
    titleKey: 'main',
    items: [
      { path: '/dashboard',          labelKey: 'dashboard',       iconKey: 'dashboard',        moduleKey: 'dashboard',         roles: ['admin', 'dispatcher'] },
      // Technician app. The module keys are the old ones, so roles keep working.
      { path: '/mechanic',           i18nKey: 'technician.my_jobs', labelDefault: 'My Jobs', iconKey: 'tech-jobs', moduleKey: 'mechanic-dashboard', roles: ['mechanic'] },
    ]
  },
  /* â”€â”€ OPERATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  {
    titleKey: 'operations',
    items: [
      { path: '/enquiries',          labelKey: 'enquiries',       iconKey: 'enquiries',        moduleKey: 'enquiries',         roles: ['admin', 'dispatcher'] },
      { path: '/work-orders',        labelKey: 'orders',          iconKey: 'orders',           moduleKey: 'work-orders',       roles: ['admin', 'dispatcher'] },
      // Every car in the workshop by step (replaced Service Tracking; same module key).
      { path: '/vehicle-board',      labelKey: 'vehicle_status_board', labelDefault: 'Vehicle Status Board', iconKey: 'vehicle-board', moduleKey: 'service-status', roles: ['admin', 'dispatcher'] },
      // Shares the work-orders moduleKey: an estimate is the first half of a job card, and
      // a new key would hide it from every dynamic role until someone edited each one.
      { path: '/estimates',          labelKey: 'estimates',       iconKey: 'estimates',        moduleKey: 'estimates',       roles: ['admin', 'dispatcher'] },
      // The BOOK stage (enquiry → quote → book → visit). labelDefault: common.bookings
      // is not in the locale files yet.
      { path: '/appointments',       labelKey: 'bookings',        labelDefault: 'Bookings', iconKey: 'appointments', moduleKey: 'appointments', roles: ['admin', 'dispatcher'] },
      { path: '/invoices',           labelKey: 'invoices',        iconKey: 'invoices',         moduleKey: 'invoices',          roles: ['admin', 'dispatcher'] },
      { path: '/customers',          labelKey: 'customers',       iconKey: 'customers',        moduleKey: 'customers',         roles: ['admin', 'dispatcher'] },
      { path: '/vehicles',           labelKey: 'vehicles',        iconKey: 'vehicles',         moduleKey: 'vehicles',          roles: ['admin', 'dispatcher'] },
      { path: '/mechanics',          labelKey: 'technicians',     labelDefault: 'Technicians', iconKey: 'mechanics', moduleKey: 'mechanics',         roles: ['admin', 'dispatcher'] },
      { path: '/service-bays',       labelKey: 'service_bays',    iconKey: 'service_bays',     moduleKey: 'service-bays',      roles: ['admin', 'dispatcher'] },
      // Not 'dispatcher': legacy accounts with no role row are Service Advisors,
      // and assigning work is the Team Leader's (job.assign).
      { path: '/job-assignment',     labelKey: 'job_assignment',  iconKey: 'job-assignment',   moduleKey: 'job-assignment',    roles: ['admin'] },
      // No role's module list contains 'team-leader' or 'fleet-intake', so with
      // their own keys these were invisible to every dynamic role (managers,
      // advisors, supervisors). They ride on the module each one belongs to.
      { path: '/team-leader',        labelKey: 'team_board',      iconKey: 'team-leader',      moduleKey: 'team-leader',    roles: ['admin', 'dispatcher'] },
      { path: '/fleet-intake',       labelKey: 'fleet_intake',    iconKey: 'fleet-intake',     moduleKey: 'fleet-intake',       roles: ['admin', 'dispatcher'] },
      // Step 6, materials: the Store's queue (requisitions to check/issue, estimate
      // parts to price). Rides on 'inventory', which the Storekeeper and Part
      // Advisor roles already carry. labelDefault: common.store is not in the
      // locale files yet.
      { path: '/store',              labelKey: 'store',           labelDefault: 'Store', iconKey: 'store', moduleKey: 'store',         roles: ['admin', 'dispatcher'] },
      // The stock list and parts catalogue (Storekeeper and Part Advisor roles
      // carry these modules). Not 'dispatcher', so legacy no-role accounts
      // (Service Advisors) do not get them through the roles fallback.
      { path: '/inventory',          labelKey: 'inventory',       iconKey: 'inventory',        moduleKey: 'inventory',         roles: ['admin'] },
      { path: '/parts',              labelKey: 'parts',           iconKey: 'parts',            moduleKey: 'parts',             roles: ['admin'] },
    ]
  },

  /* â”€â”€ CRM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     Sits next to Operations because the work flows from Enquiries and
     Customers, directly above it. Each entry carries a moduleKey so the
     super-admin module toggles can switch it on per workshop. */
  {
    titleKey: 'crm',
    items: [
      { path: '/crm/reminders',      labelKey: 'service_reminders', iconKey: 'reminders',     moduleKey: 'crm-reminders',  roles: ['admin', 'dispatcher'] },
      { path: '/crm/tasks',          labelKey: 'crm_tasks',         iconKey: 'crm-tasks',     moduleKey: 'crm-tasks',      roles: ['admin', 'dispatcher'] },
      { path: '/complaints',         labelKey: 'complaints',        iconKey: 'complaints',    moduleKey: 'complaints',     roles: ['admin', 'dispatcher'] },
      { path: '/warranty-claims',    labelKey: 'warranty_claims', iconKey: 'returns',          moduleKey: 'warranty-claims',   roles: ['admin', 'dispatcher'] },
    ]
  },
  /* ── TECHNICIAN TOOLS ───────────────────────────────────── */
  {
    titleKey: 'tools',
    items: [
      { path: '/mechanic/scan',      i18nKey: 'technician.scan_job_card', labelDefault: 'Scan job card', iconKey: 'tech-scan', moduleKey: 'mechanic-scan', roles: ['mechanic'] },
      { path: '/mechanic/history',   i18nKey: 'technician.finished_jobs', labelDefault: 'Finished jobs', iconKey: 'tech-history', moduleKey: 'my-work-orders', roles: ['mechanic'] },
    ]
  },
  /* â”€â”€ ANALYTICS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  {
    titleKey: 'analytics',
    items: [
      { path: '/reports',            labelKey: 'reports',         iconKey: 'reports',          moduleKey: 'reports',           roles: ['admin', 'dispatcher'] },
      { path: '/performance',        labelKey: 'performance',     iconKey: 'performance',      moduleKey: 'performance',       roles: ['admin', 'dispatcher'] },
      { path: '/technician-kpi',     labelKey: 'technician_kpi',  iconKey: 'technician-kpi',   moduleKey: 'technician-kpi',    roles: ['admin', 'dispatcher'] },
      { path: '/customer-feedback',  labelKey: 'customer_feedback', iconKey: 'customer_feedback', moduleKey: 'customer-feedback', roles: ['admin', 'dispatcher'] },
      { path: '/customer-experience', labelKey: 'customer_experience', iconKey: 'customer-experience', moduleKey: 'customer-experience', roles: ['admin', 'dispatcher'] },
    ]
  },
  /* â”€â”€ SYSTEM (admin-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  {
    titleKey: 'system',
    items: [
      // Templates, SMS / e-mail logs and broadcasts: managers only (every role
      // row carries the 'notifications' module, for the bell).
      { path: '/notifications',      labelKey: 'notifications',   iconKey: 'notifications',    moduleKey: 'notifications',     roles: ['admin'], managersOnly: true },
      { path: '/settings',           labelKey: 'settings',        iconKey: 'settings',         moduleKey: 'settings',          roles: ['admin'] },
      { path: '/api-keys',           labelKey: 'integrations',    iconKey: 'api-keys',         moduleKey: 'integrations',      roles: ['admin'] },
    ]
  },
];

/**
 * Filter nav sections based on user's permitted modules (dynamic roles).
 * If permittedModules is null/undefined â†’ unrestricted (show all for that legacy role).
 * If permittedModules is an array â†’ show only items whose moduleKey is included.
 * Falls back to legacy role-based filtering when no permittedModules.
 */
function getNavForRole(role, permittedModules, manager) {
  return navSections
    .map(section => ({
      ...section,
      items: section.items.filter(item => {
        if (item.managersOnly && !manager) return false;
        // Dynamic: if user has permittedModules array, use it
        if (Array.isArray(permittedModules)) {
          return permittedModules.includes(item.moduleKey);
        }
        // Legacy fallback: use hardcoded roles array
        return item.roles.includes(role);
      }),
    }))
    .filter(section => section.items.length > 0);
}

const allNavItems = navSections.flatMap(s => s.items);

/**
 * Page path → the menu module that opens it, for Protected's route guard: the
 * sidebar items (technician app and Dashboard left out: they have their own
 * rules), plus pages reached only through links.
 */
export const ROUTE_MODULES = Object.freeze(Object.fromEntries([
  ...allNavItems
    .filter(item => item.path !== '/dashboard' && !item.roles.includes('mechanic'))
    .map(item => [item.path, item.moduleKey]),
  ['/crm/customers', 'crm-customers'],
]));

/** The item's label: its own key (technician.*) or common.<labelKey>. */
const navLabel = (t, item) => t(item.i18nKey || `common.${item.labelKey}`, item.labelDefault);

/** `pathname` is `path` or a page under it ('/mechanic' is not under '/mechanics'). */
const isUnder = (pathname, path) => pathname === path || pathname.startsWith(`${path}/`);

/** The nav item for this page: the longest path that contains it (/mechanic/scan, not /mechanic). */
function activeNavPath(pathname, items) {
  let best = null;
  for (const item of items) {
    if (isUnder(pathname, item.path) && (!best || item.path.length > best.length)) best = item.path;
  }
  return best;
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const { user, workshop, logout } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const isRTL = i18n.language === 'ar' || i18n.language === 'ur';

  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [isRTL, i18n.language]);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 992;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
      else setSidebarOpen(true);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const changeLanguage = (lng) => {
    const rtlLangs = ['ar', 'ur'];
    i18n.changeLanguage(lng);
    document.documentElement.dir = rtlLangs.includes(lng) ? 'rtl' : 'ltr';
    document.documentElement.lang = lng;
    setShowLangMenu(false);
  };

  // Pages reachable without a sidebar entry of their own still get a title.
  // A string is a path prefix; a RegExp matches the whole path and wins.
  const ROUTE_TITLES = [
    [/^\/work-orders\/[^/]+\/inspection\/?$/, 'layout.vehicle_inspection', 'Vehicle inspection'],
    ['/invoices', 'common.invoices', 'Invoices'], ['/service-bays', 'common.service_bays', 'Service Bays'],
    ['/parts', 'common.parts', 'Parts'], ['/inventory', 'common.inventory', 'Inventory'],
    ['/warranty-claims', 'common.warranty_claims', 'Warranty Claims'], ['/service-pricing', 'common.pricing', 'Service Pricing'],
    ['/cash-payments', 'common.cash_payments', 'Cash Payments'],
    ['/crm/customers', 'common.customers', 'Customers'], ['/mechanic-earnings', 'common.mechanic_earnings', 'Mechanic Earnings'],
    ['/mechanic/jobs', 'technician.job_card', 'Job card'],
  ];
  const getPageTitle = () => {
    const { pathname } = location;
    const exact = ROUTE_TITLES.find(([p]) => p instanceof RegExp && p.test(pathname));
    if (exact) return t(exact[1], exact[2]);
    // The longest matching path, from the menu or the list above
    const candidates = [
      ...allNavItems.map(item => [item.path, () => navLabel(t, item)]),
      ...ROUTE_TITLES.filter(([p]) => typeof p === 'string').map(([p, key, def]) => [p, () => t(key, def)]),
    ].filter(([p]) => isUnder(pathname, p));
    if (!candidates.length) return 'Pioneer Car Service Center';
    candidates.sort((a, b) => b[0].length - a[0].length);
    return candidates[0][1]();
  };
  const navForRole = getNavForRole(user?.role || 'admin', user?.permitted_modules, isManager(user));
  const activePath = activeNavPath(location.pathname, navForRole.flatMap(s => s.items));
  const homePath = isTechnician(user) ? '/mechanic' : '/dashboard';

  const renderIcon = (iconKey) => {
    const IconComponent = iconMap[iconKey];
    return IconComponent ? <IconComponent width={20} height={20} strokeWidth={1.5} /> : null;
  };

  return (
    <div className={`staff-wrapper ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'} ${isRTL ? 'rtl' : ''}`}>
      <div
        className={`sidebar-overlay ${sidebarOpen && isMobile ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`custom-sidebar ${sidebarOpen ? (isMobile ? 'open' : '') : 'closed'}`}>
        <div className="sidebar-brand">
          <Link to={homePath}>
            <img
              src="/assets/images/logos/pioneer/pioneer_logo_white.svg"
              alt={user?.workshop_name || workshop?.name || 'Pioneer Car Service Center'}
              style={{ height: '64px', width: '100%', objectFit: 'contain', display: 'block' }}
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
            />
            <span style={{ display: 'none', fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
              Pioneer
            </span>
          </Link>
        </div>

        <nav className="sidebar-nav">
          {navForRole.map((section) => (
            <div key={section.titleKey} className="nav-section">
              <div className="sidebar-nav-label">
                {t(`common.${section.titleKey}`)}
              </div>
              {section.items.map((item) => (
                <div key={item.path} className="sidebar-nav-item">
                  <Link
                    to={item.path}
                    className={`sidebar-nav-link ${item.path === activePath ? 'active' : ''}`}
                    aria-current={item.path === activePath ? 'page' : undefined}
                    onClick={() => isMobile && setSidebarOpen(false)}
                  >
                    {renderIcon(item.iconKey)}
                    <span>{navLabel(t, item)}</span>
                  </Link>
                </div>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <header className={`custom-topbar ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        <div className="topbar-left">
          <button className="menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Menu width={24} height={24} />
          </button>

          {!sidebarOpen && (
            <div className="topbar-brand-mobile">
              <img
                src="/assets/images/logos/pioneer/pioneer_logo_main_colors.svg"
                alt={user?.workshop_name || 'Pioneer'}
                style={{ height: '35px', marginRight: '10px', mixBlendMode: 'screen' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            </div>
          )}

          <h1 className="page-title">{getPageTitle()}</h1>
        </div>

        <div className="topbar-actions">
          <NotificationBell />

          <div className="lang-switcher">
            <button className="lang-toggle" onClick={() => setShowLangMenu(!showLangMenu)}>
              <Language width={20} height={20} />
              <span>{i18n.language.toUpperCase()}</span>
            </button>
            {showLangMenu && (
              <div className="lang-dropdown">
                {[
                  { code: 'en', label: 'English' },
                  { code: 'ar', label: 'العربية' },
                  { code: 'es', label: 'Español' },
                  { code: 'pt', label: 'Português' },
                  { code: 'zh', label: '中文' },
                  { code: 'ja', label: '日本語' },
                  { code: 'fr', label: 'Français' },
                  { code: 'ur', label: 'اردو' },
                  { code: 'hi', label: 'हिन्दी' },
                  { code: 'tl', label: 'Tagalog' },
                  { code: 'tr', label: 'Türkçe' },
                  { code: 'sw', label: 'Kiswahili' },
                ].map(lang => (
                  <button
                    key={lang.code}
                    className={`lang-option ${i18n.language === lang.code ? 'active' : ''}`}
                    onClick={() => changeLanguage(lang.code)}
                  >
                    {lang.code.toUpperCase()} &mdash; {lang.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* The five original roles keep their own badge and colour. Anything
              else is a custom role from the `roles` table, and falls back to
              the role's own name — otherwise a Service Advisor or Part Advisor
              signs in and the header shows no role at all. */}
          {user?.role === 'superadmin'  && <span className="role-badge super-admin">{t('roles.super_admin')}</span>}
          {user?.role === 'super_admin' && <span className="role-badge super-admin">{t('roles.super_admin')}</span>}
          {user?.role === 'admin'       && <span className="role-badge admin">{t('roles.admin')}</span>}
          {/* a staff account given a role (e.g. Team Leader) shows that role */}
          {user?.role === 'dispatcher'  && <span className="role-badge staff">{user.role_name || t('roles.staff')}</span>}
          {/* roles.mechanic reads "TECHNICIAN" */}
          {user?.role === 'mechanic'      && <span className="role-badge technician">{t('roles.mechanic', 'TECHNICIAN')}</span>}
          {user?.role
            && !['superadmin', 'super_admin', 'admin', 'dispatcher', 'mechanic'].includes(user.role)
            && (
              <span className="role-badge staff">
                {/* role_name comes from the roles row and is already the
                    human label ("Service Advisor"); the slug is only a
                    fallback if the row went missing. */}
                {user.role_name || String(user.role).replace(/_/g, ' ')}
              </span>
            )}

          <div className="user-menu-wrapper">
            <button className="user-avatar-toggle" onClick={() => setShowUserMenu(!showUserMenu)}>
              {user?.full_name?.charAt(0) || user?.username?.charAt(0) || 'U'}
            </button>

            <div className={`user-dropdown ${showUserMenu ? 'show' : ''}`}>
              <div className="user-dropdown-header">
                <div className="user-dropdown-avatar">
                  {user?.full_name?.charAt(0) || user?.username?.charAt(0) || 'U'}
                </div>
                <div>
                  <strong>{user?.full_name || user?.username}</strong>
                  <span>{user?.email}</span>
                </div>
              </div>
              <button onClick={handleLogout} className="user-dropdown-item danger">
                <LogOut width={18} height={18} />
                {t('common.logout')}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className={`main-content ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        {/* D.5 — Trial expiry banner */}
        <TrialBanner />
        {children}
      </main>

      <footer className={`custom-footer ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        {t('footer.copyright', { year: new Date().getFullYear() })}
      </footer>
    </div>
  );
}
