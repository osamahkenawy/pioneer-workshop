/* ══════════════════════════════════════════════════════════════
 * CustomerLogin.jsx — Merchant Portal Login Page
 * Route: /merchant/login
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useRef, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, Mail, Language, WarningTriangle, Package, Label as Tag, StatsUpSquare, Wallet } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import './CustomerAuth.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function CustomerLogin() {
  const { t, i18n } = useTranslation();
  const { user } = useContext(CustomerAuthContext);
  const navigate = useNavigate();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [unverified, setUnverified] = useState(false);

  // Resend verification state
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  // Forgot password state
  const [view, setView]         = useState('login'); // login | forgot | sent
  const [fpEmail, setFpEmail]   = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const [fpError, setFpError]   = useState('');

  // Branding
  const [branding, setBranding] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/branding`);
        const data = await res.json();
        if (data.success && data.data) setBranding(data.data);
      } catch { /* fallback */ }
    })();
  }, []);

  // If already logged in as customer, redirect
  useEffect(() => {
    if (user && user.role === 'customer') navigate('/merchant/dashboard');
  }, [user, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/customer-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        const token = data.data.token;
        localStorage.setItem('crm_token', token);
        localStorage.setItem('crm_user', JSON.stringify(data.data));
        if (data.data.workshop) {
          localStorage.setItem('crm_workshop', JSON.stringify(data.data.workshop));
        }
        window.location.href = '/merchant/dashboard';
      } else {
        if (data.code === 'EMAIL_NOT_VERIFIED') {
          setUnverified(true);
        }
        setError(data.message || 'Login failed');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setFpError('');
    setFpLoading(true);
    try {
      const res = await fetch(`${API_URL}/customer-auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fpEmail }),
      });
      const data = await res.json();
      if (data.success) setView('sent');
      else setFpError(data.message);
    } catch { setFpError('Network error'); } finally { setFpLoading(false); }
  };

  const handleResendVerification = async () => {
    if (!email || resendLoading) return;
    setResendLoading(true);
    setResendMsg('');
    try {
      const res = await fetch(`${API_URL}/public/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setResendMsg(data.success
        ? t('merchant.resend_success', 'Verification email sent! Check your inbox.')
        : (data.message || t('merchant.resend_failed', 'Failed to send. Please try again.')));
    } catch {
      setResendMsg(t('merchant.resend_error', 'Connection error. Please try again.'));
    } finally {
      setResendLoading(false);
    }
  };

  const logoUrl = branding?.logo_url
    ? '/api/file?path=' + encodeURIComponent(branding.logo_url.replace(/^\/uploads\//, ''))
    : '/assets/images/logos/pioneer_with_bg.jpg';

  return (
    <div className="ca-page">
      <div className="ca-left">
        {/* LOGO */}
        <div className="ca-logo-box">
          <img src={logoUrl} alt={branding?.name || 'Pioneer'} className="ca-logo" />
        </div>

        {view === 'login' && (
          <form className="ca-form" onSubmit={handleLogin}>
            <h1 className="ca-title">{t('merchant.login_title', 'Merchant Portal')}</h1>
            <p className="ca-subtitle">{t('merchant.login_subtitle', 'Sign in to manage your services')}</p>

            {error && (
              <div className="ca-alert ca-alert-error">
                <WarningTriangle width={16} height={16} />
                <span>{error}</span>
              </div>
            )}
            {unverified && (
              <div className="ca-alert ca-alert-warning">
                <Mail width={16} height={16} />
                <div style={{ flex: 1 }}>
                  <span>{t('merchant.verify_email_prompt', 'Please verify your email. Check your inbox.')}</span>
                  <div style={{ marginTop: 6 }}>
                    {resendMsg ? (
                      <span style={{ fontSize: 13 }}>{resendMsg}</span>
                    ) : (
                      <button
                        type="button"
                        className="ca-link"
                        style={{ fontSize: 13 }}
                        onClick={handleResendVerification}
                        disabled={resendLoading}
                      >
                        {resendLoading
                          ? t('merchant.resending', 'Sending...')
                          : t('merchant.resend_verification', 'Resend verification email')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <label className="ca-label">{t('merchant.email', 'Email or Phone')}</label>
            <input
              className="ca-input"
              type="text"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="merchant@company.com"
              required
              autoFocus
            />

            <label className="ca-label">{t('merchant.password', 'Password')}</label>
            <div className="ca-input-group">
              <input
                className="ca-input"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <button type="button" className="ca-toggle-pw" onClick={() => setShowPw(p => !p)}>
                {showPw ? <EyeClosed width={18} height={18} /> : <Eye width={18} height={18} />}
              </button>
            </div>

            <div className="ca-row" style={{ justifyContent: 'flex-end', marginBottom: 16 }}>
              <button type="button" className="ca-link" onClick={() => { setView('forgot'); setFpEmail(email); }}>
                {t('merchant.forgot_password', 'Forgot password?')}
              </button>
            </div>

            <button type="submit" className="ca-btn ca-btn-primary" disabled={loading}>
              {loading ? <span className="ca-spinner" /> : t('merchant.sign_in', 'Sign In')}
            </button>

            <p className="ca-footer-text">
              {t('merchant.no_account', "Don't have an account?")}{' '}
              <Link to="/merchant/register" className="ca-link">{t('merchant.register_now', 'Register Now')}</Link>
            </p>

            <div className="ca-divider" />
            <p className="ca-footer-text" style={{ fontSize: 12, opacity: 0.6 }}>
              <Link to="/login" className="ca-link">{t('merchant.admin_login', 'Admin / Staff Login')}</Link>
            </p>
          </form>
        )}

        {view === 'forgot' && (
          <form className="ca-form" onSubmit={handleForgot}>
            <h1 className="ca-title">{t('merchant.reset_title', 'Reset Password')}</h1>
            <p className="ca-subtitle">{t('merchant.reset_subtitle', "Enter your email and we'll send a reset link")}</p>

            {fpError && (
              <div className="ca-alert ca-alert-error"><WarningTriangle width={16} height={16} /><span>{fpError}</span></div>
            )}

            <label className="ca-label">Email</label>
            <input className="ca-input" type="email" value={fpEmail} onChange={e => setFpEmail(e.target.value)} placeholder="merchant@company.com" required autoFocus />

            <button type="submit" className="ca-btn ca-btn-primary" disabled={fpLoading}>
              {fpLoading ? <span className="ca-spinner" /> : t('merchant.send_reset', 'Send Reset Link')}
            </button>

            <button type="button" className="ca-link" style={{ marginTop: 16, textAlign: 'center', display: 'block' }} onClick={() => setView('login')}>
              {t('merchant.back_to_login', 'Back to Login')}
            </button>
          </form>
        )}

        {view === 'sent' && (
          <div className="ca-form" style={{ textAlign: 'center' }}>
            <div className="ca-success-icon"><Mail width={28} height={28} /></div>
            <h1 className="ca-title">{t('merchant.check_email', 'Check Your Email')}</h1>
            <p className="ca-subtitle">{t('merchant.reset_sent', "If that email is registered, you'll receive a reset link shortly.")}</p>
            <button type="button" className="ca-btn ca-btn-outline" onClick={() => setView('login')}>
              {t('merchant.back_to_login', 'Back to Login')}
            </button>
          </div>
        )}
      </div>

      <div className="ca-right">
        <div className="ca-right-grid" />
        <div className="ca-hero-content">
          <div className="ca-hero-badge">Merchant Portal</div>
          <h2 className="ca-hero-title">{t('merchant.hero_title', 'Ship Smarter, Grow Faster')}</h2>
          <p className="ca-hero-text">{t('merchant.hero_text', 'Create orders, print labels, track services, and manage invoices — all from one powerful dashboard.')}</p>
          <div className="ca-hero-features">
            <div className="ca-hero-feature"><span className="ca-feature-icon"><Package width={18} height={18} /></span> Create & track orders</div>
            <div className="ca-hero-feature"><span className="ca-feature-icon"><Tag width={18} height={18} /></span> Print shipping labels</div>
            <div className="ca-hero-feature"><span className="ca-feature-icon"><StatsUpSquare width={18} height={18} /></span> Real-time dashboard</div>
            <div className="ca-hero-feature"><span className="ca-feature-icon"><Wallet width={18} height={18} /></span> COD & invoice management</div>
          </div>
        </div>
      </div>
    </div>
  );
}
