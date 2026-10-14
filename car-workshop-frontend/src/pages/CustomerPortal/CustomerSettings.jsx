/* ══════════════════════════════════════════════════════════════
 * CustomerSettings.jsx — the customer's details and password.
 * The e-mail and mobile number are what they sign in with and what the
 * workshop contacts them on, so the workshop changes those.
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Lock, Check, WarningTriangle } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import api from '../../lib/customerApi';
import './CustomerPages.css';

const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'];

function Message({ msg }) {
  if (!msg?.text) return null;
  return (
    <div className={`cp-alert cp-alert-${msg.type}`} role={msg.type === 'error' ? 'alert' : 'status'}>
      {msg.type === 'error' ? <WarningTriangle width={16} height={16} aria-hidden="true" /> : <Check width={16} height={16} aria-hidden="true" />}
      <span>{msg.text}</span>
    </div>
  );
}

export default function CustomerSettings() {
  const { t } = useTranslation();
  const { user, setUser } = useContext(CustomerAuthContext);
  const [profile, setProfile] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/customer-portal/profile');
      if (res.success) setProfile(res.data || {});
      else setMsg({ type: 'error', text: res.message || t('portal.load_failed', "We couldn't load your portal. Please try again.") });
    } catch {
      setMsg({ type: 'error', text: t('portal.network_error', 'Connection problem. Check your internet and try again.') });
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setProfile(p => ({ ...p, [k]: v }));

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!String(profile.full_name || '').trim()) {
      setMsg({ type: 'error', text: t('portal.settings.name_required', 'Please enter your name.') });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      const res = await api.put('/customer-portal/profile', {
        full_name: profile.full_name, company_name: profile.company_name, phone_alt: profile.phone_alt,
        address_line1: profile.address_line1, address_line2: profile.address_line2, city: profile.city, emirate: profile.emirate,
      });
      if (res.success) {
        setProfile(res.data || profile);
        if (user && setUser) setUser({ ...user, full_name: res.data?.full_name ?? user.full_name, company_name: res.data?.company_name ?? user.company_name });
        setMsg({ type: 'success', text: t('portal.settings.saved', 'Your details are saved.') });
      } else setMsg({ type: 'error', text: res.message || t('portal.settings.save_failed', "Couldn't save. Please try again.") });
    } catch {
      setMsg({ type: 'error', text: t('portal.network_error', 'Connection problem. Check your internet and try again.') });
    }
    setSaving(false);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < 6) { setPwMsg({ type: 'error', text: t('portal.password.too_short', 'Use at least 6 characters.') }); return; }
    if (pw.next !== pw.confirm) { setPwMsg({ type: 'error', text: t('portal.password.mismatch', "The passwords don't match.") }); return; }
    setSavingPw(true); setPwMsg(null);
    try {
      const res = await api.put('/customer-auth/change-password', { current_password: pw.current, new_password: pw.next });
      if (res.success) {
        setPwMsg({ type: 'success', text: t('portal.settings.password_changed', 'Your password is changed.') });
        setPw({ current: '', next: '', confirm: '' });
      } else setPwMsg({ type: 'error', text: res.message || t('portal.settings.save_failed', "Couldn't save. Please try again.") });
    } catch {
      setPwMsg({ type: 'error', text: t('portal.network_error', 'Connection problem. Check your internet and try again.') });
    }
    setSavingPw(false);
  };

  if (loading) {
    return <div className="cp-page"><div className="cp-loading" role="status"><span className="cp-spinner" aria-hidden="true" />{t('portal.loading', 'Loading…')}</div></div>;
  }

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <h1 className="cp-page-title">{t('portal.nav.settings', 'Settings')}</h1>
      </div>

      <div className="cp-settings-grid">
        <section className="cp-card" aria-labelledby="cp-details">
          <h2 className="cp-card-title" id="cp-details"><User width={18} height={18} aria-hidden="true" /> {t('portal.settings.details', 'My details')}</h2>
          <Message msg={msg} />
          <form onSubmit={saveProfile} style={{ marginBlockStart: msg ? 12 : 0 }}>
            <div className="cp-form-grid">
              <label className="cp-form-group">
                <span className="cp-form-label">{t('portal.settings.full_name', 'Full name')}</span>
                <input className="cp-form-input" value={profile.full_name || ''} onChange={e => set('full_name', e.target.value)} autoComplete="name" maxLength={255} />
              </label>
              <label className="cp-form-group">
                <span className="cp-form-label">{t('portal.settings.company', 'Company (optional)')}</span>
                <input className="cp-form-input" value={profile.company_name || ''} onChange={e => set('company_name', e.target.value)} autoComplete="organization" maxLength={255} />
              </label>
              <label className="cp-form-group">
                <span className="cp-form-label">{t('portal.settings.email', 'E-mail')}</span>
                <input className="cp-form-input" value={profile.email || ''} readOnly dir="ltr" />
              </label>
              <label className="cp-form-group">
                <span className="cp-form-label">{t('portal.settings.mobile', 'Mobile number')}</span>
                <input className="cp-form-input" value={profile.phone || ''} readOnly dir="ltr" />
              </label>
              <p className="cp-form-hint cp-span-2">{t('portal.settings.contact_hint', 'You sign in with your e-mail or mobile number. To change them, please contact the workshop.')}</p>
              <label className="cp-form-group">
                <span className="cp-form-label">{t('portal.settings.other_phone', 'Other phone (optional)')}</span>
                <input className="cp-form-input" value={profile.phone_alt || ''} onChange={e => set('phone_alt', e.target.value)} inputMode="tel" dir="ltr" maxLength={50} />
              </label>
              <label className="cp-form-group">
                <span className="cp-form-label">{t('portal.settings.emirate', 'Emirate')}</span>
                <select className="cp-form-input" value={profile.emirate || ''} onChange={e => set('emirate', e.target.value)}>
                  <option value="">{t('portal.settings.choose', 'Choose…')}</option>
                  {EMIRATES.map(em => <option key={em} value={em}>{em}</option>)}
                </select>
              </label>
              <label className="cp-form-group cp-span-2">
                <span className="cp-form-label">{t('portal.settings.address', 'Address (optional)')}</span>
                <input className="cp-form-input" value={profile.address_line1 || ''} onChange={e => set('address_line1', e.target.value)} autoComplete="street-address" maxLength={255} />
              </label>
              <label className="cp-form-group">
                <span className="cp-form-label">{t('portal.settings.city', 'City')}</span>
                <input className="cp-form-input" value={profile.city || ''} onChange={e => set('city', e.target.value)} maxLength={100} />
              </label>
            </div>
            <div className="cp-btn-row">
              <button type="submit" className="cp-btn cp-btn-primary" disabled={saving}>
                <Check width={16} height={16} /> {saving ? t('portal.saving', 'Saving…') : t('portal.save', 'Save')}
              </button>
            </div>
          </form>
        </section>

        <section className="cp-card" aria-labelledby="cp-password">
          <h2 className="cp-card-title" id="cp-password"><Lock width={18} height={18} aria-hidden="true" /> {t('portal.settings.password', 'Change password')}</h2>
          <Message msg={pwMsg} />
          <form onSubmit={changePassword} style={{ marginBlockStart: pwMsg ? 12 : 0 }}>
            <div className="cp-form-grid">
              <label className="cp-form-group cp-span-2">
                <span className="cp-form-label">{t('portal.settings.current_password', 'Current password')}</span>
                <input type="password" className="cp-form-input" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} autoComplete="current-password" required />
              </label>
              <label className="cp-form-group cp-span-2">
                <span className="cp-form-label">{t('portal.password.new', 'New password')}</span>
                <input type="password" className="cp-form-input" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} autoComplete="new-password" required minLength={6} />
              </label>
              <label className="cp-form-group cp-span-2">
                <span className="cp-form-label">{t('portal.password.confirm', 'Confirm new password')}</span>
                <input type="password" className="cp-form-input" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" required minLength={6} />
              </label>
            </div>
            <div className="cp-btn-row">
              <button type="submit" className="cp-btn cp-btn-primary" disabled={savingPw}>
                <Lock width={16} height={16} /> {savingPw ? t('portal.saving', 'Saving…') : t('portal.settings.password', 'Change password')}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
