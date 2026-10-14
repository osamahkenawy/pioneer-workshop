/* ══════════════════════════════════════════════════════════════
 * CustomerResetPassword.jsx — choose a password from a link.
 *
 *   /customer/set-password?token=…    the workshop gave the customer portal
 *                                     access (Customer page → "Give portal
 *                                     access"); the link works for 7 days
 *   /customer/reset-password?token=…  "Forgot password?"; 1 hour
 *
 * Both post to /customer-auth/reset-password. Afterwards the page says what
 * to sign in with: the e-mail or the mobile number on file.
 * ══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { useSearchParams, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, CheckCircle, WarningTriangle, EyeClosed, Eye } from 'iconoir-react';
import api from '../../lib/customerApi';
import { logoSrc, onLogoError } from '../../components/service-status/workshopLogo';
import { PORTAL } from './portalPaths';
import './CustomerAuth.css';

export default function CustomerResetPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const token = params.get('token') || '';
  const invite = pathname.endsWith('/set-password');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('form'); // form | success | expired
  const [message, setMessage] = useState('');
  const [login, setLogin] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { setMessage(t('portal.password.too_short', 'Use at least 6 characters.')); return; }
    if (password !== confirm) { setMessage(t('portal.password.mismatch', "The passwords don't match.")); return; }
    setLoading(true); setMessage('');
    try {
      const res = await api.post('/customer-auth/reset-password', { token, new_password: password });
      if (res.success) { setLogin(res.data || null); setStatus('success'); }
      else if (res.code === 'LINK_EXPIRED' || res.status === 400) setStatus('expired');
      else setMessage(res.message || t('portal.auth.request_failed', 'Something went wrong. Please try again.'));
    } catch {
      setMessage(t('portal.network_error', 'Connection problem. Check your internet and try again.'));
    }
    setLoading(false);
  };

  const signInWith = [login?.email, login?.phone].filter(Boolean);

  return (
    <div className="ca-page">
      <div className="ca-left">
        <div className="ca-logo-box"><img src={logoSrc(null)} alt="Pioneer" className="ca-logo" onError={onLogoError} /></div>

        {(!token || status === 'expired') && (
          <div className="ca-form ca-center">
            <WarningTriangle width={48} height={48} className="ca-icon-warn" aria-hidden="true" />
            <h1 className="ca-title">{t('portal.password.link_expired_title', 'This link has expired')}</h1>
            <p className="ca-subtitle">{invite
              ? t('portal.password.invite_expired', 'The link to set your password was already used or has run out. Ask the workshop to send you a new one.')
              : t('portal.password.reset_expired', 'The reset link was already used or has run out. You can ask for a new one on the sign-in page.')}</p>
            <Link to={PORTAL.login} className="ca-btn ca-btn-outline">{t('portal.auth.back_to_login', 'Back to sign in')}</Link>
          </div>
        )}

        {token && status === 'form' && (
          <form className="ca-form" onSubmit={handleSubmit}>
            <h1 className="ca-title">{invite
              ? t('portal.password.set_title', 'Welcome — set your password')
              : t('portal.password.reset_title', 'Choose a new password')}</h1>
            <p className="ca-subtitle">{invite
              ? t('portal.password.set_subtitle', 'Your customer portal is ready. Choose a password to follow your job card, sign your inspection, approve estimates and see your invoices.')
              : t('portal.password.reset_subtitle', 'Enter your new password below.')}</p>

            {message && <div className="ca-alert ca-alert-error" role="alert"><WarningTriangle width={16} height={16} aria-hidden="true" /><span>{message}</span></div>}

            <label className="ca-label" htmlFor="crp-pw">{t('portal.password.new', 'New password')}</label>
            <div className="ca-input-group">
              <input id="crp-pw" type={showPw ? 'text' : 'password'} className="ca-input" autoComplete="new-password"
                value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoFocus />
              <button type="button" className="ca-toggle-pw" onClick={() => setShowPw(s => !s)}
                aria-label={showPw ? t('portal.auth.hide_password', 'Hide password') : t('portal.auth.show_password', 'Show password')}>
                {showPw ? <EyeClosed width={18} height={18} /> : <Eye width={18} height={18} />}
              </button>
            </div>
            <label className="ca-label" htmlFor="crp-pw2">{t('portal.password.confirm', 'Confirm new password')}</label>
            <input id="crp-pw2" type={showPw ? 'text' : 'password'} className="ca-input" autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={6} />
            <p className="ca-note">{t('portal.password.rule', 'At least 6 characters.')}</p>

            <button type="submit" className="ca-btn ca-btn-primary" disabled={loading} style={{ marginBlockStart: 20 }}>
              {loading ? <span className="ca-spinner" /> : <><Lock width={18} height={18} /> {t('portal.password.save', 'Save password')}</>}
            </button>
          </form>
        )}

        {status === 'success' && (
          <div className="ca-form ca-center">
            <CheckCircle width={56} height={56} className="ca-icon-ok" aria-hidden="true" />
            <h1 className="ca-title">{t('portal.password.saved_title', 'Password saved')}</h1>
            <p className="ca-subtitle">{signInWith.length
              ? t('portal.password.sign_in_with', 'Sign in with {{ids}} and your new password.', { ids: signInWith.join(t('portal.password.or', ' or ')) })
              : t('portal.password.sign_in_now', 'You can now sign in with your new password.')}</p>
            <Link to={PORTAL.login} className="ca-btn ca-btn-primary">{t('portal.auth.go_to_login', 'Go to sign in')}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
