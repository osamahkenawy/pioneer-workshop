/* ══════════════════════════════════════════════════════════════
 * CustomerRegister.jsx — a new customer creates their portal account.
 * Route: /customer/register
 *
 * Customers already on file (they have been to the workshop) get their
 * access from the workshop instead — the server answers ALREADY_CUSTOMER and
 * this page says so. A new account works once the e-mail is confirmed.
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, WarningTriangle, Mail } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import api from '../../lib/customerApi';
import { logoSrc, onLogoError } from '../../components/service-status/workshopLogo';
import PortalAuthHero from './PortalAuthHero';
import { PORTAL } from './portalPaths';
import './CustomerAuth.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'];

export default function CustomerRegister() {
  const { t } = useTranslation();
  const { user } = useContext(CustomerAuthContext);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    full_name: '', company_name: '', email: '', phone: '', password: '', confirm_password: '', city: '', emirate: 'Dubai',
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [alreadyCustomer, setAlreadyCustomer] = useState(false);
  const [done, setDone] = useState(false);
  const [branding, setBranding] = useState(null);

  useEffect(() => {
    if (user && user.role === 'customer') navigate(PORTAL.home, { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/branding`);
        const data = await res.json();
        if (data.success && data.data) setBranding(data.data);
      } catch { /* fallback logo */ }
    })();
  }, []);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setAlreadyCustomer(false);
    if (form.password.length < 6) return setError(t('portal.password.too_short', 'Use at least 6 characters.'));
    if (form.password !== form.confirm_password) return setError(t('portal.password.mismatch', "The passwords don't match."));

    setLoading(true);
    try {
      const { confirm_password: _c, ...body } = form;
      const res = await api.post('/customer-auth/register', { ...body, type: form.company_name ? 'business' : 'individual' });
      // The account opens once the e-mail is confirmed, so no session is kept here.
      if (res.success) setDone(true);
      else if (res.code === 'ALREADY_CUSTOMER') setAlreadyCustomer(true);
      else setError(res.message || t('portal.auth.register_failed', "Couldn't create your account. Please try again."));
    } catch {
      setError(t('portal.network_error', 'Connection problem. Check your internet and try again.'));
    } finally {
      setLoading(false);
    }
  };

  const logo = <div className="ca-logo-box"><img src={logoSrc(branding?.logo_url)} alt={branding?.name || 'Pioneer'} className="ca-logo" onError={onLogoError} /></div>;

  if (done) {
    return (
      <div className="ca-page">
        <div className="ca-left">
          {logo}
          <div className="ca-form ca-center">
            <div className="ca-success-icon"><Mail width={28} height={28} aria-hidden="true" /></div>
            <h1 className="ca-title">{t('portal.auth.check_email', 'Check your e-mail')}</h1>
            <p className="ca-subtitle">{t('portal.auth.register_done', 'We sent you an e-mail. Confirm your address to open your customer portal.')}</p>
            <Link to={PORTAL.login} className="ca-btn ca-btn-primary">{t('portal.auth.go_to_login', 'Go to sign in')}</Link>
          </div>
        </div>
        <PortalAuthHero />
      </div>
    );
  }

  return (
    <div className="ca-page">
      <div className="ca-left ca-left-scroll">
        {logo}
        <form className="ca-form" onSubmit={handleSubmit}>
          <h1 className="ca-title">{t('portal.auth.register_title', 'Create your account')}</h1>
          <p className="ca-subtitle">{t('portal.auth.register_subtitle', 'Pioneer Customer Portal — follow your car through the workshop.')}</p>

          {error && <div className="ca-alert ca-alert-error" role="alert"><WarningTriangle width={16} height={16} aria-hidden="true" /><span>{error}</span></div>}
          {alreadyCustomer && (
            <div className="ca-alert ca-alert-warning" role="alert">
              <WarningTriangle width={16} height={16} aria-hidden="true" />
              <span>
                {t('portal.auth.already_customer', "You're already one of our customers. Sign in, or ask your Service Advisor to send you a link to set up your access.")}{' '}
                <Link to={PORTAL.login} className="ca-link">{t('portal.auth.sign_in', 'Sign in')}</Link>
              </span>
            </div>
          )}

          <div className="ca-grid-2">
            <div>
              <label className="ca-label" htmlFor="cr-name">{t('portal.settings.full_name', 'Full name')} *</label>
              <input id="cr-name" className="ca-input" value={form.full_name} onChange={e => update('full_name', e.target.value)} autoComplete="name" required />
            </div>
            <div>
              <label className="ca-label" htmlFor="cr-company">{t('portal.settings.company', 'Company (optional)')}</label>
              <input id="cr-company" className="ca-input" value={form.company_name} onChange={e => update('company_name', e.target.value)} autoComplete="organization" />
            </div>
          </div>

          <div className="ca-grid-2">
            <div>
              <label className="ca-label" htmlFor="cr-email">{t('portal.settings.email', 'E-mail')} *</label>
              <input id="cr-email" className="ca-input" type="email" dir="ltr" value={form.email} onChange={e => update('email', e.target.value)} autoComplete="email" required />
            </div>
            <div>
              <label className="ca-label" htmlFor="cr-phone">{t('portal.settings.mobile', 'Mobile number')} *</label>
              <input id="cr-phone" className="ca-input" type="tel" dir="ltr" value={form.phone} onChange={e => update('phone', e.target.value)}
                placeholder="05X XXX XXXX" autoComplete="tel" required />
            </div>
          </div>

          <div className="ca-grid-2">
            <div>
              <label className="ca-label" htmlFor="cr-pw">{t('portal.auth.password', 'Password')} *</label>
              <div className="ca-input-group">
                <input id="cr-pw" className="ca-input" type={showPw ? 'text' : 'password'} value={form.password}
                  onChange={e => update('password', e.target.value)} autoComplete="new-password" required minLength={6} />
                <button type="button" className="ca-toggle-pw" onClick={() => setShowPw(p => !p)}
                  aria-label={showPw ? t('portal.auth.hide_password', 'Hide password') : t('portal.auth.show_password', 'Show password')}>
                  {showPw ? <EyeClosed width={18} height={18} /> : <Eye width={18} height={18} />}
                </button>
              </div>
            </div>
            <div>
              <label className="ca-label" htmlFor="cr-pw2">{t('portal.password.confirm', 'Confirm new password')} *</label>
              <input id="cr-pw2" className="ca-input" type={showPw ? 'text' : 'password'} value={form.confirm_password}
                onChange={e => update('confirm_password', e.target.value)} autoComplete="new-password" required minLength={6} />
            </div>
          </div>

          <div className="ca-grid-2">
            <div>
              <label className="ca-label" htmlFor="cr-city">{t('portal.settings.city', 'City')}</label>
              <input id="cr-city" className="ca-input" value={form.city} onChange={e => update('city', e.target.value)} />
            </div>
            <div>
              <label className="ca-label" htmlFor="cr-emirate">{t('portal.settings.emirate', 'Emirate')}</label>
              <select id="cr-emirate" className="ca-input" value={form.emirate} onChange={e => update('emirate', e.target.value)}>
                {EMIRATES.map(em => <option key={em} value={em}>{em}</option>)}
              </select>
            </div>
          </div>

          <button type="submit" className="ca-btn ca-btn-primary" disabled={loading} style={{ marginBlockStart: 20 }}>
            {loading ? <span className="ca-spinner" /> : t('portal.auth.create_account', 'Create an account')}
          </button>

          <p className="ca-footer-text">
            {t('portal.auth.have_account', 'Already have an account?')}{' '}
            <Link to={PORTAL.login} className="ca-link">{t('portal.auth.sign_in', 'Sign in')}</Link>
          </p>
        </form>
      </div>

      <PortalAuthHero />
    </div>
  );
}
