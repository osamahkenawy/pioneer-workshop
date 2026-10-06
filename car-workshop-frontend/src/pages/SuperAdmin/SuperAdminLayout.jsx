import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Menu, LogOut, Home, Building, User, Settings, ShieldCheck,
  Globe, Package, Bell, Search, NavArrowLeft, NavArrowRight, StatsReport, Activity,
  CreditCard, Megaphone, Mail, DollarCircle, Archive,
  ChatLines, Palette, UserPlus, ClipboardCheck, CheckCircle, QrCode, Suitcase,
  Xmark, SidebarCollapse, SidebarExpand, Page
} from 'iconoir-react';
import SEO from '../../components/SEO';
import { SAToastProvider } from './SAToastContext';
import { SAConfirmProvider } from './components';
import { SABreadcrumb } from './components';
import { formatRelative } from './utils/dateFormat';
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
import './SuperAdmin.css';

const SESSION_CHECK_INTERVAL = 5 * 60 * 1000;

const SuperAdminLayout = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef(null);
  const searchTimerRef = useRef(null);

  // Dropdown states
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const notifRef = useRef(null);
  const userMenuRef = useRef(null);

  // Mock notifications (will be replaced with real data later)
  const [notifications] = useState([
    { id: 1, text: 'New workshop "FastDeliver" signed up', type: 'info', time: new Date(Date.now() - 1800000), unread: true },
    { id: 2, text: 'Trial expiring for "QuickShip" in 3 days', type: 'warning', time: new Date(Date.now() - 7200000), unread: true },
    { id: 3, text: 'Backup completed successfully', type: 'success', time: new Date(Date.now() - 86400000), unread: false },
  ]);

  const unreadCount = notifications.filter(n => n.unread).length;

  const expireSession = useCallback(() => {
    localStorage.removeItem('superAdminToken');
    setSessionExpired(true);
    setTimeout(() => navigate('/super-admin/login'), 2000);
  }, [navigate]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setSearchQuery('');
        setSearchResults(null);
        setNotifOpen(false);
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close dropdowns on click outside
  useEffect(() => {
    const handler = (e) => {
      if (searchOpen && !e.target.closest('.sa-search-container')) {
        setSearchOpen(false);
      }
      if (notifOpen && notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen, notifOpen, userMenuOpen]);

  // Close everything on navigation
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults(null);
    setNotifOpen(false);
    setUserMenuOpen(false);
    setMobileOpen(false);
  }, [location.pathname]);

  // Debounced search
  const handleSearch = useCallback((value) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.length < 2) { setSearchResults(null); return; }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const token = localStorage.getItem('superAdminToken');
        const res = await fetch(`${API_BASE_URL}/super-admin/search?q=${encodeURIComponent(value)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setSearchResults(await res.json());
        }
      } catch {
        // Fail silently for search
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, []);

  useEffect(() => {
    checkAuth();
  }, []);

  // Periodic session validation
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      try {
        const token = localStorage.getItem('superAdminToken');
        if (!token) { expireSession(); return; }
        const res = await fetch(`${API_BASE_URL}/super-admin/session`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) expireSession();
      } catch {
        // Network error — don't expire, might be temporary
      }
    }, SESSION_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [user, expireSession]);

  const checkAuth = async () => {
    const token = localStorage.getItem('superAdminToken');
    if (!token) {
      navigate('/super-admin/login');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/super-admin/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Session invalid');
      }

      const data = await response.json();
      setUser(data.user);
    } catch (error) {
      localStorage.removeItem('superAdminToken');
      navigate('/super-admin/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('superAdminToken');
    navigate('/super-admin/login');
  };

  // Grouped & ordered sidebar navigation
  const navSections = [
    {
      label: 'Main',
      items: [
        { path: '/super-admin/dashboard', icon: Home, label: 'Dashboard' },
      ]
    },
    {
      label: 'Workshop Management',
      items: [
        { path: '/super-admin/workshops', icon: Building, label: 'Workshops' },
        { path: '/super-admin/onboarding', icon: UserPlus, label: 'Onboard Workshop' },
        { path: '/super-admin/users', icon: User, label: 'Platform Users' },
        { path: '/super-admin/modules', icon: Package, label: 'Modules' },
      ]
    },
    {
      label: 'Billing & Revenue',
      items: [
        { path: '/super-admin/subscriptions', icon: CreditCard, label: 'Subscriptions' },
        { path: '/super-admin/revenue', icon: DollarCircle, label: 'Revenue' },
      ]
    },
    {
      label: 'Communication',
      items: [
        { path: '/super-admin/announcements', icon: Megaphone, label: 'Announcements' },
        { path: '/super-admin/tickets', icon: ChatLines, label: 'Support Tickets' },
        { path: '/super-admin/email-templates', icon: Mail, label: 'Email Templates' },
        { path: '/super-admin/landing-contacts', icon: ChatLines, label: 'Landing Contacts' },
      ]
    },
    {
      label: 'Customization',
      items: [
        { path: '/super-admin/branding', icon: Palette, label: 'Branding' },
        { path: '/super-admin/barcodes', icon: QrCode, label: 'Barcodes' },
        { path: '/super-admin/legal-pages', icon: Page, label: 'Legal Pages' },
      ]
    },
    {
      label: 'Operations',
      items: [
        { path: '/super-admin/vacancies', icon: Suitcase, label: 'Vacancies' },
        { path: '/super-admin/bulk-operations', icon: CheckCircle, label: 'Bulk Operations' },
      ]
    },
    {
      label: 'System',
      items: [
        { path: '/super-admin/system-health', icon: Activity, label: 'System Health' },
        { path: '/super-admin/analytics', icon: StatsReport, label: 'Analytics' },
        { path: '/super-admin/audit-log', icon: ClipboardCheck, label: 'Audit Log' },
        { path: '/super-admin/backups', icon: Archive, label: 'Backups & Export' },
        { path: '/super-admin/settings', icon: Settings, label: 'Settings' },
      ]
    },
  ];

  const layoutClass = sidebarCollapsed ? 'sidebar-collapsed' : '';

  if (loading) {
    return (
      <div className="super-admin-loading">
        <div className="loading-spinner large"></div>
        <p>Loading platform...</p>
      </div>
    );
  }

  return (
    <div className={`super-admin-layout ${layoutClass}`}>
      <SEO 
        title="Super Admin - Pioneer | System Administration" 
        description="Super Admin panel for Pioneer. Manage workshops, users, and system settings."
        noindex={true}
      />

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="sa-sidebar-backdrop visible" onClick={() => setMobileOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={`sa-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        {/* Collapse button (desktop) */}
        <button
          className="sa-sidebar-collapse-btn"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <SidebarExpand size={14} /> : <SidebarCollapse size={14} />}
        </button>

        <div className="sa-sidebar-header">
          <div className="sa-logo">
            <img className="sa-logo-full" src="/assets/images/logos/pioneer/pioneer_logo_main_colors.svg" alt="Pioneer" style={{ mixBlendMode: 'screen', display: 'block' }} />
            <img className="sa-logo-icon" src="/assets/images/logos/pioneer/pioneer_logo_main_colors.svg" alt="Pioneer" style={{ mixBlendMode: 'screen', width: 32, display: 'block' }} />
          </div>
        </div>
 
        <nav className="sa-nav">
          {navSections.map((section, si) => (
            <div key={si} className="sa-nav-section">
              {section.label !== 'Main' && (
                <div className="sa-nav-section-label">{section.label}</div>
              )}
              {section.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`sa-nav-item ${location.pathname.startsWith(item.path) ? 'active' : ''}`}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sa-sidebar-footer">
          {/* User profile card in sidebar */}
          <div className="sa-sidebar-user">
            <div className="sa-sidebar-user-avatar">
              {user?.full_name?.charAt(0) || 'A'}
            </div>
            <div className="sa-sidebar-user-info">
              <span className="sa-sidebar-user-name">{user?.full_name}</span>
              <span className="sa-sidebar-user-role">{user?.role?.replace('_', ' ')}</span>
            </div>
          </div>
          <button className="sa-logout-btn" onClick={handleLogout}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="sa-main">
        {/* Topbar */}
        <header className="sa-topbar">
          <div className="sa-topbar-left">
            <button className="sa-menu-toggle" onClick={() => setMobileOpen(!mobileOpen)}>
              <Menu size={22} />
            </button>
            <Link to="/dashboard" className="sa-back-to-crm">
              <NavArrowLeft size={16} />
              <span>Back to CRM</span>
            </Link>
            <SABreadcrumb />
          </div>

          <div className="sa-topbar-right">
            {/* Search */}
            <div className={`sa-search-container ${searchOpen ? 'active' : ''}`}>
              <div className="sa-search">
                <Search size={16} />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search... (⌘K)"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  onFocus={() => setSearchOpen(true)}
                />
                {searchQuery ? (
                  <button className="sa-search-clear" onClick={() => { setSearchQuery(''); setSearchResults(null); }}>
                    <Xmark size={14} />
                  </button>
                ) : (
                  <kbd className="sa-search-kbd">⌘K</kbd>
                )}
              </div>
              {searchOpen && searchQuery.length >= 2 && (
                <div className="sa-search-dropdown">
                  {searchLoading ? (
                    <div className="sa-search-loading">Searching...</div>
                  ) : searchResults && (searchResults.workshops?.length || searchResults.users?.length || searchResults.tickets?.length) ? (
                    <>
                      {searchResults.workshops?.length > 0 && (
                        <div className="sa-search-section">
                          <div className="sa-search-section-label">Workshops</div>
                          {searchResults.workshops.map(t => (
                            <Link key={`t-${t.id}`} to={`/super-admin/workshops/${t.id}`} className="sa-search-item" onClick={() => setSearchOpen(false)}>
                              <Building size={16} />
                              <div>
                                <div className="sa-search-item-name">{t.name}</div>
                                <div className="sa-search-item-meta">{t.email} · <span className={`sa-search-status ${t.status}`}>{t.status}</span></div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                      {searchResults.users?.length > 0 && (
                        <div className="sa-search-section">
                          <div className="sa-search-section-label">Users</div>
                          {searchResults.users.map(u => (
                            <Link key={`u-${u.id}`} to="/super-admin/users" className="sa-search-item" onClick={() => setSearchOpen(false)}>
                              <User size={16} />
                              <div>
                                <div className="sa-search-item-name">{u.full_name || u.username}</div>
                                <div className="sa-search-item-meta">{u.email} · {u.role}</div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                      {searchResults.tickets?.length > 0 && (
                        <div className="sa-search-section">
                          <div className="sa-search-section-label">Tickets</div>
                          {searchResults.tickets.map(tk => (
                            <Link key={`tk-${tk.id}`} to="/super-admin/tickets" className="sa-search-item" onClick={() => setSearchOpen(false)}>
                              <ChatLines size={16} />
                              <div>
                                <div className="sa-search-item-name">{tk.subject}</div>
                                <div className="sa-search-item-meta">{tk.workshop_name} · {tk.status}</div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="sa-search-empty">No results for "{searchQuery}"</div>
                  )}
                </div>
              )}
            </div>

            {/* Notifications */}
            <div style={{ position: 'relative' }} ref={notifRef}>
              <button className="sa-topbar-btn" onClick={() => { setNotifOpen(!notifOpen); setUserMenuOpen(false); }}>
                <Bell size={19} />
                {unreadCount > 0 && <span className="sa-notif-dot" />}
              </button>
              {notifOpen && (
                <div className="sa-notif-dropdown">
                  <div className="sa-notif-dropdown-header">
                    <h4>Notifications</h4>
                    {unreadCount > 0 && (
                      <button className="sa-notif-mark-read">Mark all read</button>
                    )}
                  </div>
                  <div className="sa-notif-list">
                    {notifications.length === 0 ? (
                      <div className="sa-notif-empty">No notifications</div>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id} className={`sa-notif-item ${n.unread ? 'unread' : ''}`}>
                          <div className={`sa-notif-icon ${n.type}`}>
                            {n.type === 'info' && <Building size={16} />}
                            {n.type === 'warning' && <Bell size={16} />}
                            {n.type === 'success' && <CheckCircle size={16} />}
                          </div>
                          <div className="sa-notif-body">
                            <p className="sa-notif-text">{n.text}</p>
                            <span className="sa-notif-time">{formatRelative(n.time)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User menu */}
            <div style={{ position: 'relative' }} ref={userMenuRef}>
              <button className="sa-user-menu-trigger" onClick={() => { setUserMenuOpen(!userMenuOpen); setNotifOpen(false); }}>
                <div className="sa-user-avatar">
                  {user?.full_name?.charAt(0) || 'A'}
                </div>
                <div className="sa-user-details">
                  <span className="sa-user-name">{user?.full_name}</span>
                  <span className="sa-user-role">{user?.role?.replace('_', ' ')}</span>
                </div>
              </button>
              {userMenuOpen && (
                <div className="sa-user-dropdown">
                  <Link to="/super-admin/settings" className="sa-user-dropdown-item" onClick={() => setUserMenuOpen(false)}>
                    <Settings size={16} /> Settings
                  </Link>
                  <Link to="/super-admin/audit-log" className="sa-user-dropdown-item" onClick={() => setUserMenuOpen(false)}>
                    <ClipboardCheck size={16} /> Audit Log
                  </Link>
                  <Link to="/dashboard" className="sa-user-dropdown-item" onClick={() => setUserMenuOpen(false)}>
                    <NavArrowLeft size={16} /> Back to CRM
                  </Link>
                  <div className="sa-user-dropdown-divider" />
                  <button className="sa-user-dropdown-item danger" onClick={handleLogout}>
                    <LogOut size={16} /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="sa-content">
          <SAToastProvider>
            <SAConfirmProvider>
              <Outlet context={{ user }} />
            </SAConfirmProvider>
          </SAToastProvider>
        </main>
      </div>

      {/* Session Expired Overlay */}
      {sessionExpired && (
        <div className="sa-session-expired-overlay">
          <div className="sa-session-expired-card">
            <ShieldCheck size={32} />
            <h3>Session Expired</h3>
            <p>Your session has expired. Redirecting to login...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminLayout;

