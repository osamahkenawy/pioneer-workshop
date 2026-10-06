import { useState, useContext, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, WarningTriangle, Mail, ArrowLeft, CheckCircle, Language } from 'iconoir-react';
import { AuthContext } from '../context/AuthContext';
import './LoginPage.css';
import { escapeHtml } from '../utils/escapeHtml';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const LANGUAGES = [
  { code: 'en', label: 'English',    dir: 'ltr' },
  { code: 'ar', label: 'العربية',    dir: 'rtl' },
  { code: 'es', label: 'Español',    dir: 'ltr' },
  { code: 'pt', label: 'Português',  dir: 'ltr' },
  { code: 'zh', label: '中文',      dir: 'ltr' },
  { code: 'ja', label: '日本語',    dir: 'ltr' },
  { code: 'fr', label: 'Français',  dir: 'ltr' },
  { code: 'ur', label: 'اردو',     dir: 'rtl' },
  { code: 'hi', label: 'हिन्दी',       dir: 'ltr' },
  { code: 'tl', label: 'Tagalog',    dir: 'ltr' },
  { code: 'tr', label: 'Türkçe',   dir: 'ltr' },
  { code: 'sw', label: 'Kiswahili', dir: 'ltr' },
];

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  /* ── Login state ──
     Deliberately empty. These were pre-filled with the seeded admin username
     and password for local convenience, which meant every visitor to the
     deployed login page arrived with working credentials already typed in. */
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  /* ── Forgot-password state ── */
  const [view,     setView]     = useState('login'); // 'login' | 'forgot' | 'sent' | 'verify'
  const [fpEmail,  setFpEmail]  = useState('');
  const [fpLoading,setFpLoading]= useState(false);
  const [fpError,  setFpError]  = useState('');

  /* ── Resend verification state ── */
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg,     setResendMsg]     = useState('');

  /* ── Branding state ── */
  const [branding, setBranding] = useState(null);

  const { login } = useContext(AuthContext);
  const navigate  = useNavigate();

  /* ── Fetch workshop branding on mount ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/branding`);
        const json = await res.json();
        if (json.success && json.data) setBranding(json.data);
      } catch { /* fallback to default logo */ }
    })();
  }, []);

  /* ── Login submit ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.success) {
        navigate(result.role === 'mechanic' ? '/mechanic/work-orders' : '/dashboard');
      } else if (result.code === 'EMAIL_NOT_VERIFIED') {
        // Switch to verification view with the entered email
        setView('verify');
        setResendMsg('');
      } else {
        setError(result.message || t('auth.invalid_credentials'));
      }
    } catch {
      setError(t('auth.error_occurred'));
    } finally {
      setLoading(false);
    }
  };

  /* ── Resend verification email ── */
  const handleResendVerification = async () => {
    setResendLoading(true);
    setResendMsg('');
    try {
      const res = await fetch(`${API_URL}/public/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username }),
      });
      const data = await res.json();
      setResendMsg(data.success ? 'Verification email sent! Check your inbox.' : (data.message || 'Failed to send. Please try again.'));
    } catch {
      setResendMsg('Network error. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  /* ── Forgot-password submit ── */
  const handleForgot = async (e) => {
    e.preventDefault();
    setFpError('');
    setFpLoading(true);
    try {
      const res  = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fpEmail }),
      });
      const data = await res.json();
      if (data.success) {
        setView('sent');
      } else {
        setFpError(data.message || t('auth.something_wrong'));
      }
    } catch {
      setFpError(t('auth.network_error'));
    } finally {
      setFpLoading(false);
    }
  };

  /* ── Use workshop branding logo if available ── */
  const rawLogo = null; // Login always uses default Pioneer logo
  const logoSrc = '/assets/images/logos/pioneer/pioneer_logo_login.svg';
  const logoAlt = branding?.name || 'Pioneer Car Service Center';

  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef(null);

  const switchLanguage = (code) => {
    const lang = LANGUAGES.find(l => l.code === code);
    i18n.changeLanguage(code);
    document.documentElement.dir = lang?.dir || 'ltr';
    document.documentElement.lang = code;
    setLangOpen(false);
  };

  useEffect(() => {
    const handleClick = (e) => { if (langRef.current && !langRef.current.contains(e.target)) setLangOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const currentLang = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="lp-lang-dropdown" ref={langRef}>
          <button type="button" className="lp-lang-toggle" onClick={() => setLangOpen(o => !o)}>
            <Language width={18} height={18} />
            <span>{currentLang.label}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 2, transform: langOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {langOpen && (
            <div className="lp-lang-menu">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  type="button"
                  className={`lp-lang-option${lang.code === i18n.language ? ' active' : ''}`}
                  onClick={() => switchLanguage(lang.code)}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="login-content">
          <div className="login-header">
            <div className="logo">
              <img src={logoSrc} alt={logoAlt} />
              <span style={{ display: 'none', fontSize: 28, fontWeight: 800, color: '#1e3a6b' }}>{logoAlt}</span>
            </div>
          </div>

          {/* ── LOGIN VIEW ── */}
          {view === 'login' && (
            <div className="lp-view lp-view-enter">
              <h1>{t('auth.welcome_title')}</h1>
              <p className="lp-subtitle">{t('auth.welcome_subtitle')}</p>

              <form onSubmit={handleSubmit} className="login-form">
                {error && (
                  <div className="lp-error">
                    <WarningTriangle width={16} height={16} />&nbsp;{error}
                  </div>
                )}

                <div className="lp-field">
                  <label>{t('auth.username_or_email')}</label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder={t('auth.username_placeholder')}
                    autoComplete="username"
                    required
                  />
                </div>

                <div className="lp-field">
                  <div className="lp-field-row" style={{ marginBottom: 6 }}>
                    <label style={{ margin: 0 }}>{t('auth.password')}</label>
                    <button type="button" className="lp-forgot-link" onClick={() => { setView('forgot'); setFpError(''); }}>
                      {t('auth.forgot_password_link')}
                    </button>
                  </div>
                  <div className="lp-pw-wrap">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={t('auth.password_placeholder')}
                      autoComplete="current-password"
                      required
                    />
                    <button type="button" className="lp-pw-eye" onClick={() => setShowPw(p => !p)}>
                      {showPw ? <EyeClosed width={16} height={16} /> : <Eye width={16} height={16} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="lp-btn-primary" disabled={loading}>
                  {loading ? <span className="lp-spinner" /> : null}
                  {loading ? t('auth.signing_in') : t('auth.sign_in')}
                </button>
              </form>
            </div>
          )}

          {/* ── FORGOT PASSWORD VIEW ── */}
          {view === 'forgot' && (
            <div className="lp-view lp-view-enter">
              <button type="button" className="lp-back-view" onClick={() => setView('login')}>
                <ArrowLeft width={14} height={14} /> {t('auth.back_to_sign_in')}
              </button>

              <div className="lp-fp-icon">
                <Mail width={26} height={26} />
              </div>
              <h1 style={{ marginBottom: 8 }}>{t('auth.forgot_password_title')}</h1>
              <p className="lp-subtitle">{t('auth.forgot_password_subtitle')}</p>

              <form onSubmit={handleForgot} className="login-form" style={{ marginTop: 24 }}>
                {fpError && (
                  <div className="lp-error">
                    <WarningTriangle width={16} height={16} />&nbsp;{fpError}
                  </div>
                )}
                <div className="lp-field">
                  <label>{t('auth.email_address')}</label>
                  <input
                    type="email"
                    value={fpEmail}
                    onChange={e => setFpEmail(e.target.value)}
                    placeholder={t('auth.email_placeholder')}
                    autoComplete="email"
                    required
                  />
                </div>
                <button type="submit" className="lp-btn-primary" disabled={fpLoading}>
                  {fpLoading ? <span className="lp-spinner" /> : null}
                  {fpLoading ? t('auth.sending') : t('auth.send_reset_link')}
                </button>
              </form>
            </div>
          )}

          {/* ── SENT VIEW ── */}
          {view === 'sent' && (
            <div className="lp-view lp-view-enter lp-sent-view">
              <div className="lp-sent-icon">
                <CheckCircle width={32} height={32} />
              </div>
              <h1 style={{ marginBottom: 8 }}>{t('auth.check_inbox')}</h1>
              <p className="lp-subtitle" style={{ marginBottom: 20 }}
                /* i18next runs with escapeValue:false, so the email must be escaped here
                   before it reaches innerHTML. The <strong> in the translation is
                   ours; only the value is untrusted. */
                dangerouslySetInnerHTML={{ __html: t('auth.check_inbox_desc', { email: escapeHtml(fpEmail) }) }}
              />
              <div className="lp-sent-tips">
                <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 13, color: '#374151' }}>{t('auth.didnt_get_email')}</p>
                <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, color: '#64748b', lineHeight: 1.8 }}>
                  <li>{t('auth.check_spam')}</li>
                  <li>{t('auth.check_correct_email')}</li>
                  <li>{t('auth.link_expires')}</li>
                </ul>
              </div>
              <button
                type="button"
                className="lp-btn-primary"
                style={{ marginTop: 20 }}
                onClick={() => { setView('login'); setFpEmail(''); }}
              >
                {t('auth.back_to_sign_in')}
              </button>
              <button
                type="button"
                className="lp-back-view"
                style={{ marginTop: 12 }}
                onClick={() => { setView('forgot'); setFpError(''); }}
              >
                {t('auth.try_different_email')}
              </button>
            </div>
          )}

          {/* ── EMAIL VERIFICATION REQUIRED VIEW ── */}
          {view === 'verify' && (
            <div className="lp-view lp-view-enter lp-sent-view">
              <div className="lp-fp-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                <Mail width={26} height={26} />
              </div>
              <h1 style={{ marginBottom: 8 }}>Email Verification Required</h1>
              <p className="lp-subtitle" style={{ marginBottom: 12 }}>
                Your email <strong>{username}</strong> has not been verified yet. Please check your inbox for the verification link.
              </p>

              <div className="lp-sent-tips">
                <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 13, color: '#374151' }}>Didn't receive it?</p>
                <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, color: '#64748b', lineHeight: 1.8 }}>
                  <li>Check your spam or junk folder</li>
                  <li>Make sure the email address is correct</li>
                  <li>Click the button below to resend the verification</li>
                </ul>
              </div>

              {resendMsg && (
                <div style={{
                  marginTop: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                  background: resendMsg.includes('sent') ? '#f0fdf4' : '#fef2f2',
                  border: resendMsg.includes('sent') ? '1px solid #bbf7d0' : '1px solid #fecaca',
                  color: resendMsg.includes('sent') ? '#166534' : '#dc2626',
                }}>
                  {resendMsg}
                </div>
              )}

              <button
                type="button"
                className="lp-btn-primary"
                style={{ marginTop: 20, background: '#f94c29', color: '#fff' }}
                onClick={handleResendVerification}
                disabled={resendLoading}
              >
                {resendLoading ? <span className="lp-spinner" /> : <Mail width={16} height={16} />}
                {resendLoading ? ' Sending...' : ' Resend Verification Email'}
              </button>

              <button
                type="button"
                className="lp-back-view"
                style={{ marginTop: 12 }}
                onClick={() => { setView('login'); setError(''); setResendMsg(''); }}
              >
                <ArrowLeft width={14} height={14} /> Back to Sign In
              </button>
            </div>
          )}

        </div>
      </div>

      <div className="login-right" />
    </div>
  );
}
