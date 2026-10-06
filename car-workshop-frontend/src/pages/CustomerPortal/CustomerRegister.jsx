/* ══════════════════════════════════════════════════════════════
 * CustomerRegister.jsx — Merchant Self-Registration
 * Route: /merchant/register
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, WarningTriangle, CheckCircle, Building, ShoppingBag, User, Flash, MapPin, Lock, SmartphoneDevice } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import './CustomerAuth.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function CustomerRegister() {
  const { t } = useTranslation();
  const { user, setUser, setWorkshop } = useContext(CustomerAuthContext);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    full_name: '', company_name: '', email: '', phone: '', password: '', confirm_password: '',
    address_line1: '', address_line2: '', city: '', emirate: 'Dubai', type: 'individual',
  });
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState(false);
  const [branding, setBranding] = useState(null);

  useEffect(() => {
    if (user && user.role === 'customer') navigate('/merchant/dashboard');
  }, [user, navigate]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/branding`);
        const data = await res.json();
        if (data.success && data.data) setBranding(data.data);
      } catch { /* */ }
    })();
  }, []);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password.length < 6) return setError('Password must be at least 6 characters');
    if (form.password !== form.confirm_password) return setError('Passwords do not match');

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/customer-auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        // Store token immediately
        if (data.data?.token) {
          localStorage.setItem('crm_token', data.data.token);
          localStorage.setItem('crm_user', JSON.stringify(data.data));
          if (data.data.workshop) {
            localStorage.setItem('crm_workshop', JSON.stringify(data.data.workshop));
            setWorkshop(data.data.workshop);
          }
          setUser(data.data);
        }
      } else {
        setError(data.message || 'Registration failed');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const logoUrl = branding?.logo_url
    ? '/api/file?path=' + encodeURIComponent(branding.logo_url.replace(/^\/uploads\//, ''))
    : '/assets/images/logos/pioneer_with_bg.jpg';

  if (success) {
    return (
      <div className="ca-page">
        <div className="ca-left">
          <div className="ca-logo-box"><img src={logoUrl} alt="" className="ca-logo" /></div>
          <div className="ca-form" style={{ textAlign: 'center' }}>
            <div className="ca-success-icon">
              <CheckCircle width={64} height={64} style={{ color: '#10b981' }} />
            </div>
            <h1 className="ca-title">{t('merchant.registration_success', 'Registration Successful!')}</h1>
            <p className="ca-subtitle">{t('merchant.verify_prompt', "We've sent a verification email. Please check your inbox to activate your account.")}</p>
            <Link to="/merchant/login" className="ca-btn ca-btn-primary" style={{ display: 'inline-block', marginTop: 20, textDecoration: 'none' }}>
              {t('merchant.go_to_login', 'Go to Login')}
            </Link>
          </div>
        </div>
        <div className="ca-right">
          <div className="ca-hero-content">
            <div className="ca-hero-badge">Welcome!</div>
            <h2 className="ca-hero-title">You're Almost There</h2>
            <p className="ca-hero-text">Verify your email and start shipping in minutes.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ca-page">
      <div className="ca-left ca-left-scroll">
        <div className="ca-logo-box"><img src={logoUrl} alt="" className="ca-logo" /></div>

        <form className="ca-form" onSubmit={handleSubmit}>
          <h1 className="ca-title">{t('merchant.register_title', 'Create Merchant Account')}</h1>
          <p className="ca-subtitle">{t('merchant.register_subtitle', 'Start shipping with us — set up your merchant account')}</p>

          {error && (
            <div className="ca-alert ca-alert-error"><WarningTriangle width={16} height={16} /><span>{error}</span></div>
          )}

          <div className="ca-grid-2">
            <div>
              <label className="ca-label">{t('merchant.full_name', 'Full Name')} *</label>
              <input className="ca-input" value={form.full_name} onChange={e => update('full_name', e.target.value)} placeholder="John Doe" required />
            </div>
            <div>
              <label className="ca-label">{t('merchant.company', 'Company Name')}</label>
              <input className="ca-input" value={form.company_name} onChange={e => update('company_name', e.target.value)} placeholder="Acme Corp" />
            </div>
          </div>

          <div className="ca-grid-2">
            <div>
              <label className="ca-label">{t('merchant.email', 'Email')} *</label>
              <input className="ca-input" type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="merchant@company.com" required />
            </div>
            <div>
              <label className="ca-label">{t('merchant.phone', 'Phone')} *</label>
              <input className="ca-input" type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="+971 50 123 4567" required />
            </div>
          </div>

          <div className="ca-grid-2">
            <div>
              <label className="ca-label">{t('merchant.password', 'Password')} *</label>
              <div className="ca-input-group">
                <input className="ca-input" type={showPw ? 'text' : 'password'} value={form.password} onChange={e => update('password', e.target.value)} placeholder="Min 6 characters" required />
                <button type="button" className="ca-toggle-pw" onClick={() => setShowPw(p => !p)}>
                  {showPw ? <EyeClosed width={18} height={18} /> : <Eye width={18} height={18} />}
                </button>
              </div>
            </div>
            <div>
              <label className="ca-label">{t('merchant.confirm_password', 'Confirm Password')} *</label>
              <input className="ca-input" type={showPw ? 'text' : 'password'} value={form.confirm_password} onChange={e => update('confirm_password', e.target.value)} placeholder="••••••••" required />
            </div>
          </div>

          <div className="ca-divider" />

          <label className="ca-label">{t('merchant.business_type', 'Account Type')}</label>
          <div className="ca-type-grid">
            {['individual', 'business', 'fleet', 'other'].map(typ => (
              <button
                key={typ}
                type="button"
                className={`ca-type-btn ${form.type === typ ? 'active' : ''}`}
                onClick={() => update('type', typ)}
              >
                <span className="ca-type-icon">
                  {typ === 'business' ? <Building width={18} height={18} /> : typ === 'fleet' ? <ShoppingBag width={18} height={18} /> : <User width={18} height={18} />}
                </span>
                <span>{typ.charAt(0).toUpperCase() + typ.slice(1)}</span>
              </button>
            ))}
          </div>

          <label className="ca-label">{t('merchant.address', 'Address')}</label>
          <input className="ca-input" value={form.address_line1} onChange={e => update('address_line1', e.target.value)} placeholder="Street, Building, Suite" />

          <div className="ca-grid-3">
            <div>
              <label className="ca-label">{t('merchant.area', 'Address Line 2')}</label>
              <input className="ca-input" value={form.address_line2} onChange={e => update('address_line2', e.target.value)} placeholder="Apartment, suite, etc. (optional)" />
            </div>
            <div>
              <label className="ca-label">{t('merchant.city', 'City')}</label>
              <input className="ca-input" value={form.city} onChange={e => update('city', e.target.value)} placeholder="Dubai" />
            </div>
            <div>
              <label className="ca-label">{t('merchant.emirate', 'Emirate')}</label>
              <select className="ca-input" value={form.emirate} onChange={e => update('emirate', e.target.value)}>
                {['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'].map(em => (
                  <option key={em} value={em}>{em}</option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" className="ca-btn ca-btn-primary" disabled={loading} style={{ marginTop: 20 }}>
            {loading ? <span className="ca-spinner" /> : t('merchant.create_account', 'Create Account')}
          </button>

          <p className="ca-footer-text">
            {t('merchant.already_account', 'Already have an account?')}{' '}
            <Link to="/merchant/login" className="ca-link">{t('merchant.sign_in', 'Sign In')}</Link>
          </p>
        </form>
      </div>

      <div className="ca-right">
        <div className="ca-hero-content">
          <div className="ca-hero-badge">Merchant Portal</div>
          <h2 className="ca-hero-title">Join Our Delivery Network</h2>
          <p className="ca-hero-text">Thousands of businesses trust us for fast, reliable delivery across the UAE.</p>
          <div className="ca-hero-features">
            <div className="ca-hero-feature"><span className="ca-feature-icon"><Flash width={18} height={18} /></span> Same-day delivery</div>
            <div className="ca-hero-feature"><span className="ca-feature-icon"><MapPin width={18} height={18} /></span> Full UAE coverage</div>
            <div className="ca-hero-feature"><span className="ca-feature-icon"><Lock width={18} height={18} /></span> Secure COD handling</div>
            <div className="ca-hero-feature"><span className="ca-feature-icon"><SmartphoneDevice width={18} height={18} /></span> Real-time tracking</div>
          </div>
        </div>
      </div>
    </div>
  );
}
