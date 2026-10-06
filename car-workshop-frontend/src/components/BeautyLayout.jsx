import { useState, useContext, useEffect, useReducer, Fragment } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Collapse } from 'react-bootstrap';
import { AuthContext } from '../context/AuthContext';
import AIChatbot from './AIChatbot';
import './BeautyLayout.css';

// Reducer for menu state
const reducer = (previousState, updatedState) => ({
  ...previousState,
  ...updatedState,
});

const initialState = {
  active: "",
  activeSubmenu: "",
};

// Beauty Center Navigation Menu - Simple structure like CRM
const beautyMenuList = [
  { title: 'MAIN', classsChange: 'menu-title' },
  {
    title: 'Dashboard',
    to: '/beauty-dashboard',
    iconStyle: <i className="flaticon-home" />,
  },
  {
    title: 'Appointments',
    to: '/appointments',
    iconStyle: <i className="flaticon-calendar-2" />,
  },
  {
    title: 'Customers',
    to: '/beauty-customers',
    iconStyle: <i className="flaticon-user" />,
  },
  { title: 'SERVICES', classsChange: 'menu-title' },
  {
    title: 'Services',
    to: '/beauty-services',
    iconStyle: <i className="flaticon-heart" />,
  },
  {
    title: 'Staff',
    to: '/staff-schedule',
    iconStyle: <i className="flaticon-user-1" />,
  },
  { title: 'BUSINESS', classsChange: 'menu-title' },
  {
    title: 'Payments',
    to: '/beauty-payments',
    iconStyle: <i className="flaticon-shopping-cart" />,
  },
  {
    title: 'Loyalty',
    to: '/loyalty',
    iconStyle: <i className="flaticon-heart-1" />,
  },
  {
    title: 'Gift Cards',
    to: '/gift-cards',
    iconStyle: <i className="flaticon-price-tag" />,
  },
  {
    title: 'Reports',
    to: '/beauty-reports',
    iconStyle: <i className="flaticon-bar-chart" />,
  },
  { title: 'SETTINGS', classsChange: 'menu-title' },
  {
    title: 'Settings',
    classsChange: 'mm-collapse',
    iconStyle: <i className="flaticon-app" />,
    content: [
      { title: 'Business Info', to: '/beauty-settings' },
      { title: 'Working Hours', to: '/beauty-settings/hours' },
      { title: 'Notifications', to: '/beauty-settings/notifications' },
    ],
  },
];

export default function BeautyLayout({ children }) {
  const [state, setState] = useReducer(reducer, initialState);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [iconHover, setIconHover] = useState(false);
  const { user, logout } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const isRTL = i18n.language === 'ar';

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

  // Set active menu based on current path
  let path = location.pathname;
  path = path.split("/");
  path = path[path.length - 1] || path[path.length - 2];

  useEffect(() => {
    beautyMenuList.forEach((data) => {
      if (data.to && location.pathname === data.to) {
        setState({ active: data.title });
      }
      data.content?.forEach((item) => {
        if (location.pathname === item.to || location.pathname.startsWith(item.to)) {
          setState({ active: data.title });
        }
        item.content?.forEach(ele => {
          if (location.pathname === ele.to) {
            setState({ activeSubmenu: item.title, active: data.title });
          }
        });
      });
    });
  }, [location.pathname]);

  const handleMenuActive = (status) => {
    setState({ active: status });
    if (state.active === status) {
      setState({ active: "" });
    }
  };

  const handleSubmenuActive = (status) => {
    setState({ activeSubmenu: status });
    if (state.activeSubmenu === status) {
      setState({ activeSubmenu: "" });
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    setShowLangMenu(false);
  };

  return (
    <div className={`beauty-wrapper ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'} ${isRTL ? 'rtl' : ''}`}>
      {/* Overlay for mobile */}
      <div 
        className={`beauty-overlay ${sidebarOpen && isMobile ? 'show' : ''}`} 
        onClick={() => setSidebarOpen(false)}
      />

      {/* Nav Header (Logo) */}
      <div className="nav-header">
        <Link to="/beauty-dashboard" className="brand-logo">
          <img 
            src="/assets/images/logos/PIONEER._WHITE_LOGOsvg.svg" 
            alt="Pioneer" 
            className="logo-abbr"
            style={{ height: '40px' }} 
          />
        </Link>
        <div 
          className="nav-control"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <div className={`hamburger ${sidebarOpen ? 'is-active' : ''}`}>
            <span className="line"></span>
            <span className="line"></span>
            <span className="line"></span>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div 
        className={`ic-sidenav ${iconHover ? 'icon-hover' : ''} ${sidebarOpen ? '' : 'closed'}`}
        onMouseEnter={() => setIconHover(true)}
        onMouseLeave={() => setIconHover(false)}
      >
        <div className="ic-sidenav-scroll">
          <ul className="metismenu" id="menu">
            {beautyMenuList.map((data, index) => {
              let menuClass = data.classsChange;
              
              // Menu Title
              if (menuClass === "menu-title") {
                return (
                  <li className={menuClass} key={index}>{data.title}</li>
                );
              }
              
              // Menu Item with Submenu
              if (data.content && data.content.length > 0) {
                return (
                  <li 
                    key={index}
                    className={`${state.active === data.title ? 'mm-active' : ''}`}
                  >
                    <Link 
                      to="#"
                      className="has-arrow"
                      onClick={(e) => { e.preventDefault(); handleMenuActive(data.title); }}
                    >
                      {data.iconStyle}
                      <span className="nav-text">{data.title}</span>
                    </Link>
                    <Collapse in={state.active === data.title}>
                      <ul className={`${menuClass === "mm-collapse" ? "mm-show" : ""}`}>
                        {data.content.map((item, idx) => {
                          // Sub-submenu
                          if (item.content && item.content.length > 0) {
                            return (
                              <li 
                                key={idx}
                                className={`${state.activeSubmenu === item.title ? "mm-active" : ""}`}
                              >
                                <Link 
                                  to={item.to || "#"} 
                                  className={`${item.hasMenu ? 'has-arrow' : ''} ${location.pathname === item.to ? 'mm-active' : ''}`}
                                  onClick={(e) => { 
                                    if (item.hasMenu) {
                                      e.preventDefault();
                                      handleSubmenuActive(item.title); 
                                    }
                                  }}
                                >
                                  {item.title}
                                </Link>
                                <Collapse in={state.activeSubmenu === item.title}>
                                  <ul className={`${menuClass === "mm-collapse" ? "mm-show" : ""}`}>
                                    {item.content.map((ele, eleIdx) => (
                                      <Fragment key={eleIdx}>
                                        <li>
                                          <Link 
                                            className={`${location.pathname === ele.to ? "mm-active" : ""}`} 
                                            to={ele.to}
                                          >
                                            {ele.title}
                                          </Link>
                                        </li>
                                      </Fragment>
                                    ))}
                                  </ul>
                                </Collapse>
                              </li>
                            );
                          }
                          
                          // Regular submenu item
                          return (
                            <li key={idx}>
                              <Link 
                                to={item.to} 
                                className={`${location.pathname === item.to || location.pathname.startsWith(item.to) ? 'mm-active' : ''}`}
                              >
                                {item.title}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </Collapse>
                  </li>
                );
              }
              
              // Simple Menu Item (no submenu)
              return (
                <li 
                  key={index}
                  className={`${location.pathname === data.to ? 'mm-active' : ''}`}
                >
                  <Link to={data.to}>
                    {data.iconStyle}
                    <span className="nav-text">{data.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Switch to CRM Button */}
          <div className="sidebar-switch">
            <Link to="/dashboard" className="switch-btn">
              <i className="flaticon-rocket"></i>
              <span>Switch to CRM</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className={`header ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        <div className="header-content">
          <nav className="navbar navbar-expand">
            <div className="collapse navbar-collapse justify-content-between">
              <div className="header-left">
                {/* Search */}
                <div className="input-group search-area">
                  <span className="input-group-text">
                    <i className="flaticon-search-interface-symbol"></i>
                  </span>
                  <input type="text" className="form-control" placeholder="Search..." />
                </div>
              </div>
              
              <ul className="navbar-nav header-right">
                {/* Language Switcher */}
                <li className="nav-item dropdown notification_dropdown">
                  <div className="lang-switcher">
                    <button 
                      className="nav-link"
                      onClick={() => setShowLangMenu(!showLangMenu)}
                    >
                      <i className="flaticon-web"></i>
                      <span className="ms-1">{i18n.language.toUpperCase()}</span>
                    </button>
                    {showLangMenu && (
                      <div className="lang-dropdown">
                        <button 
                          className={`lang-option ${i18n.language === 'en' ? 'active' : ''}`}
                          onClick={() => changeLanguage('en')}
                        >
                          🇺🇸 English
                        </button>
                        <button 
                          className={`lang-option ${i18n.language === 'ar' ? 'active' : ''}`}
                          onClick={() => changeLanguage('ar')}
                        >
                          🇦🇪 العربية
                        </button>
                      </div>
                    )}
                  </div>
                </li>

                {/* User Profile */}
                <li className="nav-item dropdown header-profile">
                  <button 
                    className="nav-link"
                    onClick={() => setShowUserMenu(!showUserMenu)}
                  >
                    <div className="header-user">
                      <span className="avatar">{user?.full_name?.charAt(0) || 'U'}</span>
                      <div className="header-info ms-2">
                        <span className="fs-14 font-w600">{user?.full_name || user?.username}</span>
                      </div>
                    </div>
                  </button>
                  
                  {showUserMenu && (
                    <div className="profile-dropdown">
                      <div className="profile-header">
                        <div className="avatar-lg">{user?.full_name?.charAt(0) || 'U'}</div>
                        <div className="ms-3">
                          <h4>{user?.full_name || user?.username}</h4>
                          <p>{user?.email}</p>
                        </div>
                      </div>
                      <div className="profile-menu">
                        <Link to="/profile" className="profile-item">
                          <i className="flaticon-user"></i>
                          <span>Profile</span>
                        </Link>
                        <Link to="/beauty-settings" className="profile-item">
                          <i className="flaticon-app"></i>
                          <span>Settings</span>
                        </Link>
                        <button onClick={handleLogout} className="profile-item logout">
                          <i className="flaticon-x-mark"></i>
                          <span>Logout</span>
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              </ul>
            </div>
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <div className={`content-body ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        <div className="container-fluid">
          {children}
        </div>
      </div>

      {/* AI Chatbot */}
      <AIChatbot />
    </div>
  );
}
