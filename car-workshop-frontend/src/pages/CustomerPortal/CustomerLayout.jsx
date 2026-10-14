/* ══════════════════════════════════════════════════════════════
 * CustomerLayout.jsx — the Customer Portal's frame.
 *
 * Desktop: a sidebar. Phones: a top bar and a bottom tab bar, so every
 * page is one tap away without a hamburger menu.
 *   Home · My job cards · My vehicles · Invoices & payments · Settings
 *
 * Signed-out visitors are sent to the sign-in page, and back here after.
 * ══════════════════════════════════════════════════════════════ */
import { useContext } from 'react';
import { Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import { HomeSimple, Wrench, Car, Page, Settings, LogOut, Language } from 'iconoir-react';
import { logoSrc, onLogoError } from '../../components/service-status/workshopLogo';
import { PORTAL } from './portalPaths';
import './CustomerLayout.css';

export default function CustomerLayout({ children }) {
  const { user, workshop, loading, logout } = useContext(CustomerAuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const navItems = [
    { to: PORTAL.home, label: t('portal.nav.home', 'Home'), short: t('portal.nav.home', 'Home'), icon: HomeSimple },
    { to: PORTAL.jobs, label: t('portal.nav.jobs', 'My job cards'), short: t('portal.nav.jobs_short', 'Job cards'), icon: Wrench },
    { to: PORTAL.vehicles, label: t('portal.nav.vehicles', 'My vehicles'), short: t('portal.nav.vehicles_short', 'Vehicles'), icon: Car },
    { to: PORTAL.invoices, label: t('portal.nav.invoices', 'Invoices & payments'), short: t('portal.nav.invoices_short', 'Invoices'), icon: Page },
    { to: PORTAL.settings, label: t('portal.nav.settings', 'Settings'), short: t('portal.nav.settings', 'Settings'), icon: Settings },
  ];

  if (!loading && !user) {
    return <Navigate to={`${PORTAL.login}?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  const handleLogout = async () => {
    if (logout) await logout();
    navigate(PORTAL.login, { replace: true });
  };

  const isArabic = i18n.language === 'ar';
  const customerName = user?.full_name || user?.company_name || t('portal.customer', 'Customer');
  const workshopName = workshop?.name || t('serviceStatus.workshop_fallback', 'Pioneer Car Service');

  return (
    <div className="cl-container">
      {/* Sidebar — desktop */}
      <aside className="cl-sidebar" aria-label={t('portal.title', 'Customer Portal')}>
        <Link to={PORTAL.home} className="cl-sidebar-header">
          <img src={logoSrc(workshop?.logo_url)} alt="" className="cl-sidebar-logo" onError={onLogoError} />
          <span className="cl-sidebar-brand">
            <span className="cl-sidebar-name">{workshopName}</span>
            <span className="cl-sidebar-sub">{t('portal.title', 'Customer Portal')}</span>
          </span>
        </Link>
        <nav className="cl-nav">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to}
              className={({ isActive }) => `cl-nav-item${isActive ? ' active' : ''}`}>
              <item.icon width={20} height={20} strokeWidth={1.6} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="cl-sidebar-footer">
          <button type="button" className="cl-nav-item" onClick={() => i18n.changeLanguage(isArabic ? 'en' : 'ar')}>
            <Language width={20} height={20} strokeWidth={1.6} aria-hidden="true" />
            <span>{isArabic ? 'English' : 'العربية'}</span>
          </button>
          <button type="button" className="cl-nav-item cl-logout-btn" onClick={handleLogout}>
            <LogOut width={20} height={20} strokeWidth={1.6} aria-hidden="true" />
            <span>{t('portal.sign_out', 'Sign out')}</span>
          </button>
        </div>
      </aside>

      <div className="cl-main">
        {/* Top bar */}
        <header className="cl-topbar">
          <Link to={PORTAL.home} className="cl-topbar-brand">
            <img src={logoSrc(workshop?.logo_url)} alt="" className="cl-topbar-logo" onError={onLogoError} />
            <span className="cl-topbar-name">{workshopName}</span>
          </Link>
          <div className="cl-topbar-right">
            <div className="cl-user-info">
              <div className="cl-avatar" aria-hidden="true">{customerName.charAt(0).toUpperCase()}</div>
              <div className="cl-user-meta">
                <span className="cl-user-name">{customerName}</span>
                <span className="cl-user-role">{t('portal.customer', 'Customer')}</span>
              </div>
            </div>
            <button type="button" className="cl-icon-btn cl-only-phone" onClick={() => i18n.changeLanguage(isArabic ? 'en' : 'ar')}
              aria-label={isArabic ? 'English' : 'العربية'}>
              <Language width={20} height={20} aria-hidden="true" />
            </button>
            <button type="button" className="cl-icon-btn cl-only-phone" onClick={handleLogout} aria-label={t('portal.sign_out', 'Sign out')}>
              <LogOut width={20} height={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        <main className="cl-content">
          {children}
        </main>
      </div>

      {/* Tab bar — phones */}
      <nav className="cl-tabbar" aria-label={t('portal.title', 'Customer Portal')}>
        {navItems.map(item => (
          <NavLink key={item.to} to={item.to}
            className={({ isActive }) => `cl-tab${isActive ? ' active' : ''}`}>
            <item.icon width={22} height={22} strokeWidth={1.6} aria-hidden="true" />
            <span>{item.short}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
