/* ══════════════════════════════════════════════════════════════
 * CustomerLogin.jsx — Customer Portal sign-in.
 * Route: /customer/login (?next=/customer/… to return after signing in)
 *
 * Sign in with the e-mail or the mobile number on file. Most customers get
 * their access from the workshop (the Service Advisor sends a link to set a
 * password); "Forgot password" sends a new link to the e-mail on file.
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useContext } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, Mail, WarningTriangle, Language } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import api from '../../lib/customerApi';
import { logoSrc, onLogoError } from '../../components/service-status/workshopLogo';
import PortalAuthHero from './PortalAuthHero';
import { PORTAL, isPortalPath } from './portalPaths';
import './CustomerAuth.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

/** Only back into the portal — never an outside address. */
const safeNext = n => (isPortalPath(n) && n !== PORTAL.login && !n.startsWith('//') ? n : PORTAL.home);

export default function CustomerLogin() {
  const { t, i18n } = useTranslation();
  const { user, login } = useContext(CustomerAuthContext);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  const [view, setView] = useState('login'); // login | forgot | sent
  const [fpId, setFpId] = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const [fpError, setFpError] = useState('');

  const [branding, setBranding] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/branding`);
        const data = await res.json();
        if (data.success && data.data) setBranding(data.data);
      } catch { /* fallback logo */ }
    })();
  }, []);

  useEffect(() => {
    if (user && user.role === 'customer') navigate(next, { replace: true });
  }, [user, navigate, next]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setUnverified(false); setResendMsg('');
    setLoading(true);
    const r = await login(identifier.trim(), password);
    setLoading(false);
    if (r.success) { navigate(next, { replace: true }); return; }
    if (r.code === 'EMAIL_NOT_VERIFIED') setUnverified(true);
    setError(r.code === 'EMAIL_NOT_VERIFIED'
      ? t('portal.auth.verify_first', 'Please confirm your e-mail first — check your inbox.')
      : r.message === 'Invalid credentials'
        ? t('portal.auth.invalid', "That e-mail or mobile number and password don't match.")
        : (r.message || t('portal.auth.login_failed', "Couldn't sign you in. Please try again.")));
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setFpError(''); setFpLoading(true);
    try {
      const res = await api.post('/customer-auth/forgot-password', { email: fpId.trim() });
      if (res.success) setView('sent');
      else setFpError(res.message || t('portal.auth.request_failed', 'Something went wrong. Please try again.'));
    } catch {
      setFpError(t('portal.network_error', 'Connection problem. Check your internet and try again.'));
    }
    setFpLoading(false);
  };

  const handleResend = async () => {
    if (!identifier || resendLoading) return;
    setResendLoading(true); setResendMsg('');
    try {
      const res = await api.post('/customer-auth/resend-verification', { email: identifier.trim() });
      setResendMsg(res.success
        ? t('portal.auth.resend_done', 'We have sent the confirmation e-mail again.')
        : (res.message || t('portal.auth.request_failed', 'Something went wrong. Please try again.')));
    } catch {
      setResendMsg(t('portal.network_error', 'Connection problem. Check your internet and try again.'));
    }
    setResendLoading(false);
  };

  const isArabic = i18n.language === 'ar';

  return (
    <div className="ca-page">
      <div className="ca-left">
        <div className="ca-logo-box">
          <img src={logoSrc(branding?.logo_url)} alt={branding?.name || 'Pioneer'} className="ca-logo" onError={onLogoError} />
        </div>

        {view === 'login' && (
          <form className="ca-form" onSubmit={handleLogin} noValidate>
            <h1 className="ca-title">{t('portal.title', 'Customer Portal')}</h1>
            <p className="ca-subtitle">{t('portal.auth.login_subtitle', 'Sign in to follow your car through the workshop.')}</p>

            {error && (
              <div className="ca-alert ca-alert-error" role="alert">
                <WarningTriangle width={16} height={16} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            {unverified && (
              <div className="ca-alert ca-alert-warning">
                <Mail width={16} height={16} aria-hidden="true" />
                <div style={{ flex: 1 }}>
                  {resendMsg ? <span>{resendMsg}</span> : (
                    <button type="button" className="ca-link" onClick={handleResend} disabled={resendLoading}>
                      {resendLoading ? t('portal.auth.sending', 'Sending…') : t('portal.auth.resend', 'Send the confirmation e-mail again')}
                    </button>
                  )}
                </div>
              </div>
            )}

            <label className="ca-label" htmlFor="cl-id">{t('portal.auth.identifier', 'E-mail or mobile number')}</label>
            <input id="cl-id" className="ca-input" type="text" inputMode="email" autoComplete="username" dir="ltr"
              value={identifier} onChange={e => setIdentifier(e.target.value)}
              placeholder={t('portal.auth.identifier_ph', 'you@example.com or 05X XXX XXXX')} required autoFocus />

            <label className="ca-label" htmlFor="cl-pw">{t('portal.auth.password', 'Password')}</label>
            <div className="ca-input-group">
              <input id="cl-pw" className="ca-input" type={showPw ? 'text' : 'password'} autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)} required />
              <button type="button" className="ca-toggle-pw" onClick={() => setShowPw(p => !p)}
                aria-label={showPw ? t('portal.auth.hide_password', 'Hide password') : t('portal.auth.show_password', 'Show password')}>
                {showPw ? <EyeClosed width={18} height={18} /> : <Eye width={18} height={18} />}
              </button>
            </div>

            <div className="ca-row" style={{ justifyContent: 'flex-end', marginBlockEnd: 8 }}>
              <button type="button" className="ca-link" onClick={() => { setView('forgot'); setFpId(identifier); }}>
                {t('portal.auth.forgot', 'Forgot password?')}
              </button>
            </div>

            <button type="submit" className="ca-btn ca-btn-primary" disabled={loading || !identifier.trim() || !password}>
              {loading ? <span className="ca-spinner" /> : t('portal.auth.sign_in', 'Sign in')}
            </button>

            <p className="ca-note">{t('portal.auth.invite_hint', 'Already a customer of ours? Ask your Service Advisor to send you a link to set up your access.')}</p>

            <p className="ca-footer-text">
              {t('portal.auth.no_account', 'New customer?')}{' '}
              <Link to={PORTAL.register} className="ca-link">{t('portal.auth.create_account', 'Create an account')}</Link>
            </p>
            <p className="ca-footer-text" style={{ marginBlockStart: 0 }}>
              <button type="button" className="ca-link" onClick={() => i18n.changeLanguage(isArabic ? 'en' : 'ar')}>
                <Language width={14} height={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {isArabic ? 'English' : 'العربية'}
              </button>
              {' · '}
              <Link to="/login" className="ca-link">{t('portal.auth.staff_login', 'Staff sign-in')}</Link>
            </p>
          </form>
        )}

        {view === 'forgot' && (
          <form className="ca-form" onSubmit={handleForgot}>
            <h1 className="ca-title">{t('portal.auth.reset_title', 'Reset your password')}</h1>
            <p className="ca-subtitle">{t('portal.auth.reset_subtitle', "Enter your e-mail or mobile number. We'll e-mail you a link to choose a new password.")}</p>
            {fpError && <div className="ca-alert ca-alert-error" role="alert"><WarningTriangle width={16} height={16} aria-hidden="true" /><span>{fpError}</span></div>}
            <label className="ca-label" htmlFor="cl-fp">{t('portal.auth.identifier', 'E-mail or mobile number')}</label>
            <input id="cl-fp" className="ca-input" type="text" inputMode="email" dir="ltr" value={fpId} onChange={e => setFpId(e.target.value)} required autoFocus />
            <button type="submit" className="ca-btn ca-btn-primary" disabled={fpLoading || !fpId.trim()} style={{ marginBlockStart: 20 }}>
              {fpLoading ? <span className="ca-spinner" /> : t('portal.auth.send_link', 'Send the link')}
            </button>
            <p className="ca-note">{t('portal.auth.no_email_hint', 'No e-mail on file? Ask the workshop to send you a link by WhatsApp.')}</p>
            <div className="ca-footer-text">
              <button type="button" className="ca-link" onClick={() => setView('login')}>{t('portal.auth.back_to_login', 'Back to sign in')}</button>
            </div>
          </form>
        )}

        {view === 'sent' && (
          <div className="ca-form ca-center">
            <div className="ca-success-icon"><Mail width={28} height={28} aria-hidden="true" /></div>
            <h1 className="ca-title">{t('portal.auth.check_email', 'Check your e-mail')}</h1>
            <p className="ca-subtitle">{t('portal.auth.reset_sent', "If that account is registered, you'll receive a link by e-mail shortly.")}</p>
            <button type="button" className="ca-btn ca-btn-outline" onClick={() => setView('login')}>
              {t('portal.auth.back_to_login', 'Back to sign in')}
            </button>
          </div>
        )}
      </div>

      <PortalAuthHero />
    </div>
  );
}
