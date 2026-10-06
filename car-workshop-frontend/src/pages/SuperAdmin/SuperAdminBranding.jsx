import { useState, useEffect } from 'react';
import {
  ColorFilter, Building, EditPencil, Refresh, Eye,
  Trash, CheckCircle, Palette
} from 'iconoir-react';
import './SuperAdmin.css';

import { useConfirm } from './components';
const API = import.meta.env.VITE_API_URL || '/api';
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('superAdminToken')}`, 'Content-Type': 'application/json' });

const DEFAULT_BRANDING = {
  primary_color: '#f97316',
  secondary_color: '#1e293b',
  accent_color: '#3b82f6',
  sidebar_color: '#1e293b',
  font_family: 'Inter',
  logo_url: '',
  favicon_url: '',
  custom_domain: '',
  custom_css: ''
};

const FONT_OPTIONS = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Poppins', 'Nunito', 'Montserrat', 'Source Sans Pro'];

const SuperAdminBranding = () => {
  const askConfirm = useConfirm();
  const [brandings, setBrandings] = useState([]);
  const [unbrandedWorkshops, setUnbrandedWorkshops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editWorkshopId, setEditWorkshopId] = useState(null);
  const [form, setForm] = useState({ ...DEFAULT_BRANDING });
  const [editWorkshopName, setEditWorkshopName] = useState('');

  useEffect(() => { fetchBrandings(); }, []);

  const fetchBrandings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/super-admin/branding`, { headers: headers() });
      if (res.ok) {
        const d = await res.json();
        setBrandings(d.brandings || []);
        setUnbrandedWorkshops(d.unbrandedWorkshops || []);
      }
    } catch (_) {}
    setLoading(false);
  };

  const openEdit = async (workshopId, workshopName) => {
    try {
      const res = await fetch(`${API}/super-admin/branding/${workshopId}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setForm({ ...DEFAULT_BRANDING, ...data });
        setEditWorkshopId(workshopId);
        setEditWorkshopName(workshopName);
      }
    } catch (_) {}
  };

  const saveBranding = async () => {
    await fetch(`${API}/super-admin/branding/${editWorkshopId}`, {
      method: 'PUT', headers: headers(), body: JSON.stringify(form)
    });
    setEditWorkshopId(null);
    fetchBrandings();
  };

  const resetBranding = async (workshopId) => {
    if (!(await askConfirm({ title: 'Reset branding?', message: "Reset this workshop's branding to defaults? Custom colors, logo and CSS will be removed.", danger: true, confirmLabel: 'Reset' }))) return;
    await fetch(`${API}/super-admin/branding/${workshopId}`, { method: 'DELETE', headers: headers() });
    fetchBrandings();
  };

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>Custom Branding</h1>
          <p>Manage workshop-specific logos, colors, and themes</p>
        </div>
        <button className="sa-primary-btn" onClick={fetchBrandings}>
          <Refresh size={16} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="sa-loading-page"><div className="loading-spinner"></div></div>
      ) : (
        <>
          {/* Branded Workshops */}
          <div className="sa-card" style={{ padding: 24, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Palette size={20} /> Branded Workshops ({brandings.length})
            </h3>
            {brandings.length === 0 ? (
              <p style={{ color: '#6b7280' }}>No workshops have custom branding yet</p>
            ) : (
              <div className="sa-branding-grid">
                {brandings.map(b => (
                  <div key={b.id} className="sa-branding-card">
                    <div className="sa-branding-preview" style={{
                      background: `linear-gradient(135deg, ${b.primary_color} 0%, ${b.secondary_color} 100%)`,
                      borderRadius: '12px 12px 0 0', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {b.logo_url ? (
                        <img src={b.logo_url} alt="Logo" style={{ maxHeight: 40, maxWidth: 120 }} />
                      ) : (
                        <span style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>{b.workshop_name}</span>
                      )}
                    </div>
                    <div style={{ padding: 16 }}>
                      <h4 style={{ margin: '0 0 8px' }}>{b.workshop_name}</h4>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        {[b.primary_color, b.secondary_color, b.accent_color, b.sidebar_color].map((c, i) => (
                          <div key={i} style={{ width: 24, height: 24, borderRadius: 6, background: c, border: '2px solid #e5e7eb' }} title={c} />
                        ))}
                      </div>
                      <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px' }}>Font: {b.font_family}</p>
                      {b.custom_domain && <p style={{ fontSize: 12, color: '#3b82f6', margin: '0 0 8px' }}>{b.custom_domain}</p>}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="sa-icon-btn" onClick={() => openEdit(b.workshop_id, b.workshop_name)}><EditPencil size={16} /></button>
                        <button className="sa-icon-btn danger" onClick={() => resetBranding(b.workshop_id)}><Trash size={16} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Unbranded Workshops */}
          {unbrandedWorkshops.length > 0 && (
            <div className="sa-card" style={{ padding: 24 }}>
              <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building size={20} /> Workshops Using Default Theme ({unbrandedWorkshops.length})
              </h3>
              <div className="sa-table-container">
                <table className="sa-table">
                  <thead>
                    <tr><th>Workshop</th><th>Status</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {unbrandedWorkshops.map(t => (
                      <tr key={t.id}>
                        <td><strong>{t.name}</strong></td>
                        <td><span className={`sa-status-badge ${t.status}`}>{t.status}</span></td>
                        <td>
                          <button className="sa-secondary-btn" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => openEdit(t.id, t.name)}>
                            <Palette size={14} /> Customize
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Edit Modal */}
      {editWorkshopId && (
        <div className="sa-modal-backdrop" onClick={() => setEditWorkshopId(null)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="sa-modal-header">
              <h2>Branding — {editWorkshopName}</h2>
              <button className="sa-modal-close" onClick={() => setEditWorkshopId(null)}>×</button>
            </div>
            <div className="sa-modal-body">
              {/* Live Preview */}
              <div style={{
                background: `linear-gradient(135deg, ${form.primary_color} 0%, ${form.secondary_color} 100%)`,
                borderRadius: 12, padding: 24, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}>
                <div style={{ color: '#fff' }}>
                  <h3 style={{ margin: 0, fontFamily: form.font_family }}>{editWorkshopName}</h3>
                  <p style={{ margin: '4px 0 0', opacity: 0.8, fontFamily: form.font_family }}>Live Preview</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ background: form.accent_color, color: '#fff', padding: '8px 16px', borderRadius: 8, fontFamily: form.font_family, fontSize: 13 }}>Button</div>
                </div>
              </div>

              <div className="sa-form-grid">
                <div className="sa-form-group">
                  <label>Primary Color</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={form.primary_color} onChange={e => setForm({ ...form, primary_color: e.target.value })} style={{ width: 40, height: 36, padding: 2, cursor: 'pointer' }} />
                    <input value={form.primary_color} onChange={e => setForm({ ...form, primary_color: e.target.value })} style={{ flex: 1 }} />
                  </div>
                </div>
                <div className="sa-form-group">
                  <label>Secondary Color</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={form.secondary_color} onChange={e => setForm({ ...form, secondary_color: e.target.value })} style={{ width: 40, height: 36, padding: 2, cursor: 'pointer' }} />
                    <input value={form.secondary_color} onChange={e => setForm({ ...form, secondary_color: e.target.value })} style={{ flex: 1 }} />
                  </div>
                </div>
                <div className="sa-form-group">
                  <label>Accent Color</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={form.accent_color} onChange={e => setForm({ ...form, accent_color: e.target.value })} style={{ width: 40, height: 36, padding: 2, cursor: 'pointer' }} />
                    <input value={form.accent_color} onChange={e => setForm({ ...form, accent_color: e.target.value })} style={{ flex: 1 }} />
                  </div>
                </div>
                <div className="sa-form-group">
                  <label>Sidebar Color</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={form.sidebar_color} onChange={e => setForm({ ...form, sidebar_color: e.target.value })} style={{ width: 40, height: 36, padding: 2, cursor: 'pointer' }} />
                    <input value={form.sidebar_color} onChange={e => setForm({ ...form, sidebar_color: e.target.value })} style={{ flex: 1 }} />
                  </div>
                </div>
                <div className="sa-form-group">
                  <label>Font Family</label>
                  <select value={form.font_family} onChange={e => setForm({ ...form, font_family: e.target.value })}>
                    {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Custom Domain</label>
                  <input value={form.custom_domain} onChange={e => setForm({ ...form, custom_domain: e.target.value })} placeholder="app.company.com" />
                </div>
                <div className="sa-form-group full-width">
                  <label>Logo URL</label>
                  <input value={form.logo_url} onChange={e => setForm({ ...form, logo_url: e.target.value })} placeholder="https://..." />
                </div>
                <div className="sa-form-group full-width">
                  <label>Favicon URL</label>
                  <input value={form.favicon_url} onChange={e => setForm({ ...form, favicon_url: e.target.value })} placeholder="https://..." />
                </div>
                <div className="sa-form-group full-width">
                  <label>Custom CSS (advanced)</label>
                  <textarea value={form.custom_css} onChange={e => setForm({ ...form, custom_css: e.target.value })} rows={4} style={{ fontFamily: 'monospace', fontSize: 13 }} placeholder=".sidebar { background: #000; }" />
                </div>
              </div>
            </div>
            <div className="sa-modal-footer">
              <button className="sa-secondary-btn" onClick={() => setEditWorkshopId(null)}>Cancel</button>
              <button className="sa-primary-btn" onClick={saveBranding}>Save Branding</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminBranding;
