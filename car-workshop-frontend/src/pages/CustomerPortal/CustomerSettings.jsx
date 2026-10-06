/* ══════════════════════════════════════════════════════════════
 * CustomerSettings.jsx — Profile & Change Password
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback } from 'react';
import { Settings, User, Lock, Check, WarningTriangle } from 'iconoir-react';
import './CustomerPages.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function CustomerSettings() {
  const [profile, setProfile]   = useState({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState({ type: '', text: '' });

  /* Password fields */
  const [pw, setPw] = useState({ current: '', newPw: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState({ type: '', text: '' });
  const [savingPw, setSavingPw] = useState(false);

  const token = localStorage.getItem('crm_token');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/customer-portal/profile`, { headers, credentials: 'include' });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      const data = await res.json();
      if (data.success) setProfile(data.data || {});
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  /* Save profile */
  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg({ type: '', text: '' });
    try {
      const res = await fetch(`${API_URL}/customer-portal/profile`, {
        method: 'PUT', headers, credentials: 'include',
        body: JSON.stringify({
          company_name: profile.company_name,
          full_name: profile.full_name,
          phone_alt: profile.phone_alt,
          address_line1: profile.address_line1,
          address_line2: profile.address_line2,
          city: profile.city,
          emirate: profile.emirate,
        }),
      });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      const data = await res.json();
      if (data.success) setMsg({ type: 'success', text: 'Profile updated successfully' });
      else setMsg({ type: 'error', text: data.message || 'Update failed' });
    } catch { setMsg({ type: 'error', text: 'Update failed' }); }
    setSaving(false);
  };

  /* Change password */
  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.newPw !== pw.confirm) { setPwMsg({ type: 'error', text: 'Passwords do not match' }); return; }
    if (pw.newPw.length < 6) { setPwMsg({ type: 'error', text: 'Password must be at least 6 characters' }); return; }
    setSavingPw(true); setPwMsg({ type: '', text: '' });
    try {
      const res = await fetch(`${API_URL}/customer-auth/change-password`, {
        method: 'PUT', headers, credentials: 'include',
        body: JSON.stringify({ current_password: pw.current, new_password: pw.newPw }),
      });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      const data = await res.json();
      if (data.success) {
        setPwMsg({ type: 'success', text: 'Password changed successfully' });
        setPw({ current: '', newPw: '', confirm: '' });
      } else setPwMsg({ type: 'error', text: data.message || 'Change failed' });
    } catch { setPwMsg({ type: 'error', text: 'Change failed' }); }
    setSavingPw(false);
  };

  const setP = (f, v) => setProfile(prev => ({ ...prev, [f]: v }));

  if (loading) return <div className="cp-loading"><span className="cp-spinner" /><p>Loading settings...</p></div>;

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <h1 className="cp-page-title"><Settings width={22} height={22} /> Settings</h1>
      </div>

      <div className="cp-settings-grid">
        {/* Profile Section */}
        <div className="cp-card">
          <h3 className="cp-card-title"><User width={18} height={18} /> Business Profile</h3>
          {msg.text && <div className={`ca-alert ca-alert-${msg.type}`}>{msg.type === 'error' ? <WarningTriangle width={16} height={16} /> : <Check width={16} height={16} />}{msg.text}</div>}
          <form onSubmit={saveProfile}>
            <div className="cp-form-grid">
              <div className="cp-form-group cp-span-2">
                <label className="cp-form-label">Business Name</label>
                <input className="cp-form-input" value={profile.company_name || ''} onChange={e => setP('company_name', e.target.value)} />
              </div>
              <div className="cp-form-group">
                <label className="cp-form-label">Contact Person</label>
                <input className="cp-form-input" value={profile.full_name || ''} onChange={e => setP('full_name', e.target.value)} />
              </div>
              <div className="cp-form-group">
                <label className="cp-form-label">Phone</label>
                <input className="cp-form-input" value={profile.phone || ''} onChange={e => setP('phone', e.target.value)} />
              </div>
              <div className="cp-form-group">
                <label className="cp-form-label">Email</label>
                <input className="cp-form-input" value={profile.email || ''} disabled style={{ background: '#f1f5f9' }} />
              </div>
              <div className="cp-form-group cp-span-2">
                <label className="cp-form-label">Address</label>
                <input className="cp-form-input" value={profile.address_line1 || ''} onChange={e => setP('address_line1', e.target.value)} />
              </div>
              <div className="cp-form-group">
                <label className="cp-form-label">City</label>
                <input className="cp-form-input" value={profile.city || ''} onChange={e => setP('city', e.target.value)} />
              </div>
              <div className="cp-form-group">
                <label className="cp-form-label">Emirate</label>
                <select className="cp-form-input" value={profile.emirate || ''} onChange={e => setP('emirate', e.target.value)}>
                  <option value="">Select…</option>
                  {['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'].map(em => (
                    <option key={em} value={em}>{em}</option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" className="cp-btn cp-btn-primary" disabled={saving} style={{ marginTop: 16 }}>
              {saving ? <span className="cp-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <><Check width={16} height={16} /> Save Changes</>}
            </button>
          </form>
        </div>

        {/* Password Section */}
        <div className="cp-card">
          <h3 className="cp-card-title"><Lock width={18} height={18} /> Change Password</h3>
          {pwMsg.text && <div className={`ca-alert ca-alert-${pwMsg.type}`}>{pwMsg.type === 'error' ? <WarningTriangle width={16} height={16} /> : <Check width={16} height={16} />}{pwMsg.text}</div>}
          <form onSubmit={changePassword}>
            <div className="cp-form-grid">
              <div className="cp-form-group cp-span-2">
                <label className="cp-form-label">Current Password</label>
                <input type="password" className="cp-form-input" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} />
              </div>
              <div className="cp-form-group">
                <label className="cp-form-label">New Password</label>
                <input type="password" className="cp-form-input" value={pw.newPw} onChange={e => setPw(p => ({ ...p, newPw: e.target.value }))} />
              </div>
              <div className="cp-form-group">
                <label className="cp-form-label">Confirm Password</label>
                <input type="password" className="cp-form-input" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
              </div>
            </div>
            <button type="submit" className="cp-btn cp-btn-primary" disabled={savingPw} style={{ marginTop: 16 }}>
              {savingPw ? <span className="cp-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <><Lock width={16} height={16} /> Change Password</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
