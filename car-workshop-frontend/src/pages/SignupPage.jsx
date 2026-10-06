import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, WarningTriangle, ArrowLeft, ArrowRight, Check, Building, User, Phone, Mail, Lock, Globe, Language } from 'iconoir-react';
import { PHONE_CODES as SHARED_CODES, loadCountries } from '../components/PhoneInput';
import './SignupPage.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

/* ────────────────────────────────────────────────────────────
   Phone Input with Country Code Dropdown
   ──────────────────────────────────────────────────────────── */
function PhoneInput({ value, onChange, phoneCode, onPhoneCodeChange, placeholder, id, searchPlaceholder }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [codes, setCodes] = useState(SHARED_CODES);
  const ref = useRef(null);

  useEffect(() => { loadCountries().then(() => setCodes([...SHARED_CODES])); }, []);

  const selected = codes.find(c => c.code === phoneCode) || codes[0];

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = search
    ? codes.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.code.includes(search))
    : codes;

  return (
    <div className="sp-phone-wrap" ref={ref} dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
      <button type="button" className="sp-phone-code-btn" onClick={() => setOpen(o => !o)}>
        <span className="sp-phone-flag">{selected.flag}</span>
        <span className="sp-phone-code-text">{selected.code}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="sp-phone-dropdown">
          <input
            type="text"
            className="sp-phone-search"
            placeholder={searchPlaceholder || "Search country..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className="sp-phone-list">
            {filtered.map(c => (
              <button
                key={c.code}
                type="button"
                className={`sp-phone-option${c.code === phoneCode ? ' active' : ''}`}
                onClick={() => { onPhoneCodeChange(c.code); setOpen(false); setSearch(''); }}
              >
                <span className="sp-phone-flag">{c.flag}</span>
                <span className="sp-phone-option-name">{c.name}</span>
                <span className="sp-phone-option-code">{c.code}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <input
        id={id}
        type="tel"
        className="sp-phone-input"
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder={placeholder || 'Phone number'}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Languages list
   ──────────────────────────────────────────────────────────── */
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

/* ────────────────────────────────────────────────────────────
   Signup Page Component
   ──────────────────────────────────────────────────────────── */
export default function SignupPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState('');

  /* ── Language switcher ── */
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (langRef.current && !langRef.current.contains(e.target)) setLangOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const switchLanguage = (code) => {
    const lang = LANGUAGES.find(l => l.code === code);
    i18n.changeLanguage(code);
    document.documentElement.dir = lang?.dir || 'ltr';
    document.documentElement.lang = code;
    setLangOpen(false);
  };
  const currentLang = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];
  const [fieldErrors, setFieldErrors] = useState({});

  // Step 1 — Company Info
  const [companyName, setCompanyName] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyPhoneCode, setCompanyPhoneCode] = useState('+971');

  // Step 2 — Admin Info
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminPhoneCode, setAdminPhoneCode] = useState('+971');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showCpw, setShowCpw] = useState(false);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const clearFieldError = (field) => {
    setFieldErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  /* ── Step 1 Validation ── */
  const validateStep1 = () => {
    const errors = {};
    if (!companyName.trim()) errors.company_name = t('signup.company_name_required');
    if (!companyEmail.trim()) errors.company_email = t('signup.company_email_required');
    else if (!emailRegex.test(companyEmail.trim())) errors.company_email = t('signup.company_email_invalid');
    if (!companyPhone.trim()) errors.company_phone = t('signup.company_phone_required');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /* ── Step 1: Check availability before moving to step 2 ── */
  const handleNextStep = async () => {
    if (!validateStep1()) return;
    setLoading(true);
    setGlobalError('');
    try {
      const res = await fetch(`${API_URL}/public/check-availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName.trim(),
          company_email: companyEmail.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setGlobalError(t('signup.check_availability_failed'));
        return;
      }
      if (!data.available) {
        setFieldErrors(data.errors || {});
        return;
      }
      setStep(2);
    } catch {
      setGlobalError(t('signup.connection_error'));
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 2 Validation ── */
  const validateStep2 = () => {
    const errors = {};
    if (!adminName.trim()) errors.admin_full_name = t('signup.admin_name_required');
    if (!adminEmail.trim()) errors.admin_email = t('signup.admin_email_required');
    else if (!emailRegex.test(adminEmail.trim())) errors.admin_email = t('signup.admin_email_invalid');
    if (!password) errors.password = t('signup.password_required');
    else if (password.length < 8) errors.password = t('signup.password_min_length');
    else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) errors.password = t('signup.password_complexity');
    if (!confirmPassword) errors.confirm_password = t('signup.confirm_password_required');
    else if (password !== confirmPassword) errors.confirm_password = t('signup.passwords_mismatch');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /* ── Submit Signup ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateStep2()) return;
    setLoading(true);
    setGlobalError('');
    try {
      const res = await fetch(`${API_URL}/public/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName.trim(),
          company_email: companyEmail.trim(),
          company_phone: `${companyPhoneCode}${companyPhone.trim()}`,
          admin_full_name: adminName.trim(),
          admin_email: adminEmail.trim(),
          admin_phone: adminPhone.trim() ? `${adminPhoneCode}${adminPhone.trim()}` : null,
          password,
        }),
      });
      const data = await res.json();
      if (data.success) {
        navigate('/signup-success', { state: { email: adminEmail.trim() } });
      } else {
        if (data.field) {
          setFieldErrors({ [data.field]: data.message });
          // Go back to step 1 if the error is on a step 1 field
          if (['company_name', 'company_email', 'company_phone'].includes(data.field)) {
            setStep(1);
          }
        } else {
          setGlobalError(data.message || t('signup.signup_failed'));
        }
      }
    } catch {
      setGlobalError(t('signup.connection_error'));
    } finally {
      setLoading(false);
    }
  };

  const logoSrc = '/assets/images/logos/pioneer/pioneer_logo_main_colors.svg';

  return (
    <div className="sp-page" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="sp-left">
        {/* Language Switcher */}
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

        <div className="sp-content">
          <div className="sp-header">
            <Link to="/login" className="sp-logo">
              <img src={logoSrc} alt="Pioneer" style={{ filter: 'invert(1)' }} />
            </Link>
          </div>

          {/* ── Step Indicator ── */}
          <div className="sp-steps">
            <div className={`sp-step-item${step >= 1 ? ' active' : ''}${step > 1 ? ' done' : ''}`}>
              <div className="sp-step-circle">
                {step > 1 ? <Check width={14} height={14} /> : '1'}
              </div>
              <span className="sp-step-label">{t('signup.step_company')}</span>
            </div>
            <div className="sp-step-line" />
            <div className={`sp-step-item${step >= 2 ? ' active' : ''}`}>
              <div className="sp-step-circle">2</div>
              <span className="sp-step-label">{t('signup.step_admin')}</span>
            </div>
          </div>

          {globalError && (
            <div className="sp-error-global">
              <WarningTriangle width={16} height={16} />&nbsp;{globalError}
            </div>
          )}

          {/* ══════════ STEP 1 — Company Info ══════════ */}
          {step === 1 && (
            <div className="sp-form-section sp-fade-in">
              <h1>{t('signup.start_free_trial')}</h1>
              <p className="sp-subtitle">{t('signup.trial_subtitle')}</p>

              <div className="sp-field">
                <label htmlFor="companyName">
                  <Building width={14} height={14} /> {t('signup.company_name')} <span className="sp-req">*</span>
                </label>
                <input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={e => { setCompanyName(e.target.value); clearFieldError('company_name'); }}
                  placeholder={t('signup.company_name_placeholder')}
                  className={fieldErrors.company_name ? 'sp-input-error' : ''}
                />
                {fieldErrors.company_name && <p className="sp-field-error">{fieldErrors.company_name}</p>}
              </div>

              <div className="sp-field">
                <label htmlFor="companyEmail">
                  <Mail width={14} height={14} /> {t('signup.company_email')} <span className="sp-req">*</span>
                </label>
                <input
                  id="companyEmail"
                  type="email"
                  value={companyEmail}
                  onChange={e => { setCompanyEmail(e.target.value); clearFieldError('company_email'); }}
                  placeholder={t('signup.company_email_placeholder')}
                  className={fieldErrors.company_email ? 'sp-input-error' : ''}
                />
                {fieldErrors.company_email && <p className="sp-field-error">{fieldErrors.company_email}</p>}
              </div>

              <div className="sp-field">
                <label htmlFor="companyPhone">
                  <Phone width={14} height={14} /> {t('signup.company_phone')} <span className="sp-req">*</span>
                </label>
                <PhoneInput
                  id="companyPhone"
                  value={companyPhone}
                  onChange={v => { setCompanyPhone(v); clearFieldError('company_phone'); }}
                  phoneCode={companyPhoneCode}
                  onPhoneCodeChange={setCompanyPhoneCode}
                  placeholder={t('signup.company_phone_placeholder')}
                  searchPlaceholder={t('signup.search_country')}
                />
                {fieldErrors.company_phone && <p className="sp-field-error">{fieldErrors.company_phone}</p>}
              </div>

              <button type="button" className="sp-btn-primary" onClick={handleNextStep} disabled={loading}>
                {loading ? <span className="sp-spinner" /> : null}
                {loading ? t('signup.checking') : t('signup.continue')}
                {!loading && <ArrowRight width={16} height={16} />}
              </button>

              <p className="sp-login-link">
                {t('signup.already_have_account')}{' '}
                <Link to="/login">{t('signup.sign_in')}</Link>
              </p>
            </div>
          )}

          {/* ══════════ STEP 2 — Admin Info ══════════ */}
          {step === 2 && (
            <form className="sp-form-section sp-fade-in" onSubmit={handleSubmit}>
              <button type="button" className="sp-back-btn" onClick={() => { setStep(1); setFieldErrors({}); setGlobalError(''); }}>
                <ArrowLeft width={14} height={14} /> {t('signup.back_to_company')}
              </button>

              <h1>{t('signup.create_admin_account')}</h1>
              <p className="sp-subtitle">{t('signup.admin_subtitle_prefix')} <strong>{companyName}</strong>{t('signup.admin_subtitle_suffix')}</p>

              <div className="sp-field">
                <label htmlFor="adminName">
                  <User width={14} height={14} /> {t('signup.admin_name')} <span className="sp-req">*</span>
                </label>
                <input
                  id="adminName"
                  type="text"
                  value={adminName}
                  onChange={e => { setAdminName(e.target.value); clearFieldError('admin_full_name'); }}
                  placeholder={t('signup.admin_name_placeholder')}
                  className={fieldErrors.admin_full_name ? 'sp-input-error' : ''}
                />
                {fieldErrors.admin_full_name && <p className="sp-field-error">{fieldErrors.admin_full_name}</p>}
              </div>

              <div className="sp-field">
                <label htmlFor="adminEmail">
                  <Mail width={14} height={14} /> {t('signup.admin_email')} <span className="sp-req">*</span>
                </label>
                <input
                  id="adminEmail"
                  type="email"
                  value={adminEmail}
                  onChange={e => { setAdminEmail(e.target.value); clearFieldError('admin_email'); }}
                  placeholder={t('signup.admin_email_placeholder')}
                  className={fieldErrors.admin_email ? 'sp-input-error' : ''}
                />
                {fieldErrors.admin_email && <p className="sp-field-error">{fieldErrors.admin_email}</p>}
              </div>

              <div className="sp-field">
                <label htmlFor="adminPhone">
                  <Phone width={14} height={14} /> {t('signup.admin_phone')} <span className="sp-optional">({t('signup.admin_phone_optional')})</span>
                </label>
                <PhoneInput
                  id="adminPhone"
                  value={adminPhone}
                  onChange={setAdminPhone}
                  phoneCode={adminPhoneCode}
                  onPhoneCodeChange={setAdminPhoneCode}
                  placeholder={t('signup.company_phone_placeholder')}
                  searchPlaceholder={t('signup.search_country')}
                />
              </div>

              <div className="sp-field">
                <label htmlFor="password">
                  <Lock width={14} height={14} /> {t('signup.password')} <span className="sp-req">*</span>
                </label>
                <div className="sp-pw-wrap">
                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); clearFieldError('password'); clearFieldError('confirm_password'); }}
                    placeholder={t('signup.password_placeholder')}
                    className={fieldErrors.password ? 'sp-input-error' : ''}
                  />
                  <button type="button" className="sp-pw-eye" onClick={() => setShowPw(p => !p)}>
                    {showPw ? <EyeClosed width={16} height={16} /> : <Eye width={16} height={16} />}
                  </button>
                </div>
                {fieldErrors.password && <p className="sp-field-error">{fieldErrors.password}</p>}
              </div>

              <div className="sp-field">
                <label htmlFor="confirmPassword">
                  <Lock width={14} height={14} /> {t('signup.confirm_password')} <span className="sp-req">*</span>
                </label>
                <div className="sp-pw-wrap">
                  <input
                    id="confirmPassword"
                    type={showCpw ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); clearFieldError('confirm_password'); }}
                    placeholder={t('signup.confirm_password_placeholder')}
                    className={fieldErrors.confirm_password ? 'sp-input-error' : ''}
                  />
                  <button type="button" className="sp-pw-eye" onClick={() => setShowCpw(p => !p)}>
                    {showCpw ? <EyeClosed width={16} height={16} /> : <Eye width={16} height={16} />}
                  </button>
                </div>
                {fieldErrors.confirm_password && <p className="sp-field-error">{fieldErrors.confirm_password}</p>}
              </div>

              <button type="submit" className="sp-btn-primary" disabled={loading}>
                {loading ? <span className="sp-spinner" /> : null}
                {loading ? t('signup.creating_account') : t('signup.start_trial_btn')}
              </button>

              <p className="sp-terms">
                {t('signup.terms_prefix')}{' '}
                <a href="https://pioneercarservice.com/terms" target="_blank" rel="noopener noreferrer">{t('signup.terms_of_service')}</a>{' '}
                {t('signup.and')}{' '}
                <a href="https://pioneercarservice.com/privacy-policy" target="_blank" rel="noopener noreferrer">{t('signup.privacy_policy')}</a>.
              </p>
            </form>
          )}
        </div>
      </div>

      <div className="sp-right">
        <div className="sp-hero-overlay">
          <div className="sp-hero-card">
            <h2 className="sp-hero-title">{t('signup.hero_title', { defaultValue: 'Your Deliveries, Simplified.' })}</h2>
            <p className="sp-hero-text">{t('signup.hero_text', { defaultValue: 'Stop chasing mechanics and tracking spreadsheets. Pioneer automates your entire car workshop workflow so you can focus on growing your business.' })}</p>
            <div className="sp-hero-stats">
              <div className="sp-hero-stat">
                <span className="sp-hero-stat-value">99.9%</span>
                <span className="sp-hero-stat-label">{t('signup.hero_stat_uptime', { defaultValue: 'Uptime' })}</span>
              </div>
              <div className="sp-hero-stat">
                <span className="sp-hero-stat-value">50K+</span>
                <span className="sp-hero-stat-label">{t('signup.hero_stat_deliveries', { defaultValue: 'Deliveries' })}</span>
              </div>
              <div className="sp-hero-stat">
                <span className="sp-hero-stat-value">24/7</span>
                <span className="sp-hero-stat-label">{t('signup.hero_stat_support', { defaultValue: 'Support' })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
