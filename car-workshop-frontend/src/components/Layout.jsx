import { useState, useContext, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import {
  HomeSimple, Package, DeliveryTruck, Map, User, MapPin,
  DollarCircle, Bell, Wallet, Page, StatsUpSquare, Settings,
  Network, Menu, LogOut, Language, Dashboard, Upload,
  RefreshDouble, CreditCard, Medal, Search, QrCode, ScanBarcode, Wrench, Archive, Megaphone,
  EmojiSatisfied, ClipboardCheck, StarSolid, WarningTriangle, GraphUp, Group, Truck,
} from 'iconoir-react';
import NotificationBell from './NotificationBell';
import PlanBadge from './dashboard/PlanBadge';
import TrialBanner from './dashboard/TrialBanner';
import './Layout.css';

const iconMap = {
  'dashboard':        HomeSimple,
  'orders':           Package,
  'mechanics':          DeliveryTruck,
  'job-assignment':         Map,
  'team-leader':            Group,
  'fleet-intake':           Truck,
  'mechanic-scan':      ScanBarcode,
  'my-deliveries':    Package,
  'mechanic-dashboard': HomeSimple,
  'my-orders':        Package,
  'customers':          User,
  'vehicles':           DeliveryTruck,
  'parts':              Wrench,
  'enquiries':          Megaphone,
  'inventory':          Archive,
  'service_bays':            MapPin,
  'pricing':          DollarCircle,
  'notifications':    Bell,
  'wallet':           Wallet,
  'invoices':         Page,
  'reports':          StatsUpSquare,
  'settings':         Settings,
  'api-keys':         Network,
  'service-tracking': Search,
  'returns':          RefreshDouble,
  'cod':              CreditCard,
  'performance':      Medal,
  'customer_feedback': EmojiSatisfied,
  'customer-360':     User,
  'reminders':        Bell,
  'crm-tasks':        ClipboardCheck,
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
      { path: '/mechanic/dashboard',   labelKey: 'mechanic_home',     iconKey: 'mechanic-dashboard', moduleKey: 'mechanic-dashboard',  roles: ['mechanic'] },
    ]
  },
  /* â”€â”€ OPERATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  {
    titleKey: 'operations',
    items: [
      { path: '/enquiries',          labelKey: 'enquiries',       iconKey: 'enquiries',        moduleKey: 'enquiries',         roles: ['admin', 'dispatcher'] },
      { path: '/work-orders',        labelKey: 'orders',          iconKey: 'orders',           moduleKey: 'work-orders',       roles: ['admin', 'dispatcher'] },
      { path: '/customers',          labelKey: 'customers',       iconKey: 'customers',        moduleKey: 'customers',         roles: ['admin', 'dispatcher'] },
      { path: '/vehicles',           labelKey: 'vehicles',        iconKey: 'vehicles',         moduleKey: 'vehicles',          roles: ['admin', 'dispatcher'] },
      { path: '/mechanics',          labelKey: 'mechanics',       iconKey: 'mechanics',        moduleKey: 'mechanics',         roles: ['admin', 'dispatcher'] },
      { path: '/job-assignment',     labelKey: 'job_assignment',  iconKey: 'job-assignment',   moduleKey: 'job-assignment',    roles: ['admin', 'dispatcher'] },
      { path: '/team-leader',        labelKey: 'team_board',      iconKey: 'team-leader',      moduleKey: 'team-leader',       roles: ['admin', 'dispatcher'] },
      { path: '/fleet-intake',       labelKey: 'fleet_intake',    iconKey: 'fleet-intake',     moduleKey: 'fleet-intake',      roles: ['admin', 'dispatcher'] },
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
    ]
  },
  /* â”€â”€ MECHANIC TOOLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  {
    titleKey: 'tools',
    items: [
      { path: '/mechanic/work-orders',      labelKey: 'my_deliveries',   iconKey: 'my-deliveries',    moduleKey: 'my-work-orders',     roles: ['mechanic'] },
      { path: '/mechanic/scan',        labelKey: 'scan_shipment',   iconKey: 'mechanic-scan',      moduleKey: 'mechanic-scan',       roles: ['mechanic'] },
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
      { path: '/notifications',      labelKey: 'notifications',   iconKey: 'notifications',    moduleKey: 'notifications',     roles: ['admin'] },
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
function getNavForRole(role, permittedModules) {
  return navSections
    .map(section => ({
      ...section,
      items: section.items.filter(item => {
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

  const getPageTitle = () => {
    const item = allNavItems.find(item => location.pathname.startsWith(item.path));
    if (item) {
      return t(`common.${item.labelKey}`);
    }
    return 'Pioneer Car Service Center';
  };

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
          <Link to="/dashboard">
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
          {getNavForRole(user?.role || 'admin', user?.permitted_modules).map((section) => (
            <div key={section.titleKey} className="nav-section">
              <div className="sidebar-nav-label">
                {t(`common.${section.titleKey}`)}
              </div>
              {section.items.map((item) => (
                <div key={item.path} className="sidebar-nav-item">
                  <Link
                    to={item.path}
                    className={`sidebar-nav-link ${location.pathname.startsWith(item.path) ? 'active' : ''}`}
                    onClick={() => isMobile && setSidebarOpen(false)}
                  >
                    {renderIcon(item.iconKey)}
                    <span>{t(`common.${item.labelKey}`)}</span>
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
          {user?.role === 'dispatcher'  && <span className="role-badge staff">{t('roles.staff')}</span>}
          {user?.role === 'mechanic'      && <span className="role-badge staff" style={{ background: '#f973161a', color: '#f97316', borderColor: '#f97316' }}>{t('roles.mechanic')}</span>}
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
