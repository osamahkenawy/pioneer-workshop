/* ══════════════════════════════════════════════════════════════
 * CustomerAddresses.jsx — Saved Pickup Addresses Management
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback } from 'react';
import { MapPin, Plus, Edit, Trash, Check, Xmark } from 'iconoir-react';
import './CustomerPages.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const EMPTY_ADDR = { label: '', contact_name: '', contact_phone: '', address_line1: '', area: '', emirate: '', is_default: false };

export default function CustomerAddresses() {
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editing, setEditing]     = useState(null);   // id or 'new'
  const [form, setForm]           = useState({ ...EMPTY_ADDR });
  const [saving, setSaving]       = useState(false);

  const token = localStorage.getItem('crm_token');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchAddresses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/customer-portal/saved-addresses`, { headers, credentials: 'include' });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      const data = await res.json();
      if (data.success) setAddresses(data.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAddresses(); }, [fetchAddresses]);

  const startNew = () => { setForm({ ...EMPTY_ADDR }); setEditing('new'); };
  const startEdit = (addr) => {
    setForm({ label: addr.label || '', contact_name: addr.contact_name || '', contact_phone: addr.contact_phone || '',
      address_line1: addr.address_line1 || '', area: addr.area || '', emirate: addr.emirate || '', is_default: !!addr.is_default });
    setEditing(addr.id);
  };
  const cancelEdit = () => { setEditing(null); setForm({ ...EMPTY_ADDR }); };

  const handleSave = async () => {
    if (!form.label || !form.address_line1) return;
    setSaving(true);
    try {
      const isNew = editing === 'new';
      const url = isNew ? `${API_URL}/customer-portal/saved-addresses` : `${API_URL}/customer-portal/saved-addresses/${editing}`;
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT', headers, credentials: 'include',
        body: JSON.stringify(form),
      });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      const data = await res.json();
      if (data.success) { fetchAddresses(); cancelEdit(); }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this address?')) return;
    try {
      await fetch(`${API_URL}/customer-portal/saved-addresses/${id}`, { method: 'DELETE', headers, credentials: 'include' });
      fetchAddresses();
    } catch { /* ignore */ }
  };

  const setF = (field, val) => setForm(prev => ({ ...prev, [field]: val }));

  if (loading) return <div className="cp-loading"><span className="cp-spinner" /><p>Loading addresses...</p></div>;

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <h1 className="cp-page-title">Saved Addresses</h1>
        {editing === null && (
          <button className="cp-btn cp-btn-primary" onClick={startNew}>
            <Plus width={16} height={16} /> Add Address
          </button>
        )}
      </div>

      {/* Form */}
      {editing !== null && (
        <div className="cp-card cp-address-form" style={{ marginBottom: 24 }}>
          <h3 className="cp-card-title">{editing === 'new' ? 'New Address' : 'Edit Address'}</h3>
          <div className="cp-form-grid">
            <div className="cp-form-group">
              <label className="cp-form-label">Label *</label>
              <input className="cp-form-input" placeholder="e.g. Main Warehouse" value={form.label} onChange={e => setF('label', e.target.value)} />
            </div>
            <div className="cp-form-group">
              <label className="cp-form-label">Contact Name</label>
              <input className="cp-form-input" value={form.contact_name} onChange={e => setF('contact_name', e.target.value)} />
            </div>
            <div className="cp-form-group">
              <label className="cp-form-label">Phone</label>
              <input className="cp-form-input" value={form.contact_phone} onChange={e => setF('contact_phone', e.target.value)} />
            </div>
            <div className="cp-form-group cp-span-2">
              <label className="cp-form-label">Address *</label>
              <input className="cp-form-input" value={form.address_line1} onChange={e => setF('address_line1', e.target.value)} />
            </div>
            <div className="cp-form-group">
              <label className="cp-form-label">Area</label>
              <input className="cp-form-input" value={form.area} onChange={e => setF('area', e.target.value)} />
            </div>
            <div className="cp-form-group">
              <label className="cp-form-label">Emirate</label>
              <select className="cp-form-input" value={form.emirate} onChange={e => setF('emirate', e.target.value)}>
                <option value="">Select…</option>
                {['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'].map(em => (
                  <option key={em} value={em}>{em}</option>
                ))}
              </select>
            </div>
            <div className="cp-form-group">
              <label className="cp-form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.is_default} onChange={e => setF('is_default', e.target.checked)} />
                Default pickup address
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="cp-btn cp-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <span className="cp-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <><Check width={16} height={16} /> Save</>}
            </button>
            <button className="cp-btn cp-btn-outline" onClick={cancelEdit}><Xmark width={16} height={16} /> Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      {addresses.length === 0 ? (
        <div className="cp-empty">
          <MapPin width={48} height={48} />
          <p>No saved addresses yet</p>
          <button className="cp-btn cp-btn-primary" onClick={startNew}><Plus width={16} height={16} /> Add First Address</button>
        </div>
      ) : (
        <div className="cp-address-grid">
          {addresses.map(addr => (
            <div key={addr.id} className={`cp-card cp-address-card ${addr.is_default ? 'cp-address-default' : ''}`}>
              <div className="cp-address-card-header">
                <h4>
                  <MapPin width={16} height={16} style={{ color: '#f97316', verticalAlign: -3, marginRight: 4 }} />
                  {addr.label}
                  {addr.is_default && <span className="cp-badge cp-badge-success" style={{ marginLeft: 8, fontSize: 10 }}>Default</span>}
                </h4>
                <div className="cp-address-actions">
                  <button className="cp-btn-icon" title="Edit" onClick={() => startEdit(addr)}><Edit width={14} height={14} /></button>
                  <button className="cp-btn-icon" title="Delete" onClick={() => handleDelete(addr.id)}><Trash width={14} height={14} style={{ color: '#ef4444' }} /></button>
                </div>
              </div>
              {addr.contact_name && <p style={{ fontWeight: 500, fontSize: 13, margin: '4px 0' }}>{addr.contact_name}</p>}
              {addr.contact_phone && <p className="cp-detail-sub">{addr.contact_phone}</p>}
              <p className="cp-detail-sub">{addr.address_line1}</p>
              {(addr.area || addr.emirate) && <p className="cp-detail-sub">{[addr.area, addr.emirate].filter(Boolean).join(', ')}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
