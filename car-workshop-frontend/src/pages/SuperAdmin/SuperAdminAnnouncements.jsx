import { useState, useEffect } from 'react';
import {
  Bell, Plus, EditPencil, Trash, Send, Pin, Eye,
  WarningTriangle, InfoCircle, CheckCircle, Building
} from 'iconoir-react';
import './SuperAdmin.css';

import { useConfirm } from './components';
const API = import.meta.env.VITE_API_URL || '/api';
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('superAdminToken')}`, 'Content-Type': 'application/json' });

const TYPE_CONFIG = {
  info: { icon: <InfoCircle size={18} />, color: '#3b82f6', bg: '#eff6ff', label: 'Info' },
  warning: { icon: <WarningTriangle size={18} />, color: '#f59e0b', bg: '#fffbeb', label: 'Warning' },
  critical: { icon: <WarningTriangle size={18} />, color: '#ef4444', bg: '#fef2f2', label: 'Critical' },
  maintenance: { icon: <Building size={18} />, color: '#8b5cf6', bg: '#faf5ff', label: 'Maintenance' },
  update: { icon: <CheckCircle size={18} />, color: '#10b981', bg: '#ecfdf5', label: 'Update' }
};

const SuperAdminAnnouncements = () => {
  const askConfirm = useConfirm();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', type: 'info', target: 'all', is_pinned: false, send_email: false, workshop_ids: [] });
  const [editId, setEditId] = useState(null);
  const [workshops, setWorkshops] = useState([]);

  useEffect(() => { fetchAnnouncements(); fetchWorkshops(); }, []);

  const fetchAnnouncements = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/super-admin/announcements`, { headers: headers() });
      if (res.ok) { const d = await res.json(); setAnnouncements(d.announcements || []); }
    } catch (_) {}
    setLoading(false);
  };

  const fetchWorkshops = async () => {
    try {
      const res = await fetch(`${API}/super-admin/workshops?limit=999`, { headers: headers() });
      if (res.ok) { const d = await res.json(); setWorkshops(d.workshops || []); }
    } catch (_) {}
  };

  const save = async () => {
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API}/super-admin/announcements/${editId}` : `${API}/super-admin/announcements`;
    await fetch(url, { method, headers: headers(), body: JSON.stringify(form) });
    setShowModal(false); setForm({ title: '', message: '', type: 'info', target: 'all', is_pinned: false, send_email: false, workshop_ids: [] }); setEditId(null);
    fetchAnnouncements();
  };

  const remove = async (id) => {
    if (!(await askConfirm({ title: 'Delete announcement?', message: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' }))) return;
    await fetch(`${API}/super-admin/announcements/${id}`, { method: 'DELETE', headers: headers() });
    fetchAnnouncements();
  };

  const toggleActive = async (ann) => {
    await fetch(`${API}/super-admin/announcements/${ann.id}`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ is_active: !ann.is_active })
    });
    fetchAnnouncements();
  };

  const togglePin = async (ann) => {
    await fetch(`${API}/super-admin/announcements/${ann.id}`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ is_pinned: !ann.is_pinned })
    });
    fetchAnnouncements();
  };

  const openEdit = (ann) => {
    setEditId(ann.id);
    setForm({ title: ann.title, message: ann.message, type: ann.type, target: ann.target || 'all', is_pinned: ann.is_pinned, send_email: false, workshop_ids: ann.workshop_ids ? JSON.parse(ann.workshop_ids) : [] });
    setShowModal(true);
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>Announcements</h1>
          <p>Communicate with workshops — broadcast updates, warnings, and maintenance notices</p>
        </div>
        <button className="sa-primary-btn" onClick={() => { setEditId(null); setForm({ title: '', message: '', type: 'info', target: 'all', is_pinned: false, send_email: false, workshop_ids: [] }); setShowModal(true); }}>
          <Plus size={16} /> New Announcement
        </button>
      </div>

      {/* Stats */}
      <div className="sa-stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 20 }}>
        {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
          const count = announcements.filter(a => a.type === key).length;
          return (
            <div key={key} className="sa-stat-card" style={{ background: cfg.bg }}>
              <div className="sa-stat-icon" style={{ background: `${cfg.color}20`, color: cfg.color }}>{cfg.icon}</div>
              <div className="sa-stat-content"><h3>{count}</h3><p>{cfg.label}</p></div>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="sa-loading-page"><div className="loading-spinner"></div></div>
      ) : announcements.length === 0 ? (
        <div className="sa-card">
          <div className="sa-empty-state">
            <Bell size={48} />
            <h3>No announcements yet</h3>
            <p>Create your first announcement to communicate with workshops</p>
          </div>
        </div>
      ) : (
        <div className="sa-announcements-list">
          {announcements.map(ann => {
            const cfg = TYPE_CONFIG[ann.type] || TYPE_CONFIG.info;
            return (
              <div key={ann.id} className={`sa-announcement-card ${!ann.is_active ? 'inactive' : ''}`} style={{ borderLeftColor: cfg.color }}>
                <div className="sa-announcement-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {ann.is_pinned && <Pin size={16} style={{ color: '#f59e0b' }} />}
                    <span className="sa-badge-pill" style={{ background: cfg.bg, color: cfg.color }}>{cfg.icon} {cfg.label}</span>
                    <h3 style={{ margin: 0 }}>{ann.title}</h3>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="sa-icon-btn" onClick={() => togglePin(ann)} title={ann.is_pinned ? 'Unpin' : 'Pin'}>
                      <Pin size={16} />
                    </button>
                    <button className="sa-icon-btn" onClick={() => toggleActive(ann)} title={ann.is_active ? 'Deactivate' : 'Activate'}>
                      <Eye size={16} />
                    </button>
                    <button className="sa-icon-btn" onClick={() => openEdit(ann)}><EditPencil size={16} /></button>
                    <button className="sa-icon-btn danger" onClick={() => remove(ann.id)}><Trash size={16} /></button>
                  </div>
                </div>
                <p className="sa-announcement-body">{ann.message}</p>
                <div className="sa-announcement-meta">
                  <span>By {ann.created_by_name || 'Admin'}</span>
                  <span>•</span>
                  <span>{fmtDate(ann.created_at)}</span>
                  <span>•</span>
                  <span>Target: {ann.target === 'all' ? 'All Workshops' : 'Specific'}</span>
                  {!ann.is_active && <span className="sa-badge-pill" style={{ background: '#fef2f2', color: '#dc2626', marginLeft: 8 }}>Inactive</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="sa-modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 650 }}>
            <div className="sa-modal-header">
              <h2>{editId ? 'Edit Announcement' : 'New Announcement'}</h2>
              <button className="sa-modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="sa-modal-body">
              <div className="sa-form-grid">
                <div className="sa-form-group full-width">
                  <label>Title</label>
                  <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Announcement title..." />
                </div>
                <div className="sa-form-group full-width">
                  <label>Message</label>
                  <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Write your message..." rows={5} />
                </div>
                <div className="sa-form-group">
                  <label>Type</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                    {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Target</label>
                  <select value={form.target} onChange={e => setForm({ ...form, target: e.target.value })}>
                    <option value="all">All Workshops</option>
                    <option value="specific">Specific Workshops</option>
                  </select>
                </div>
                {form.target === 'specific' && (
                  <div className="sa-form-group full-width">
                    <label>Select Workshops</label>
                    <select multiple value={form.workshop_ids?.map(String) || []} onChange={e => setForm({ ...form, workshop_ids: Array.from(e.target.selectedOptions, o => parseInt(o.value)) })} style={{ minHeight: 100 }}>
                      {workshops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="sa-form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_pinned} onChange={e => setForm({ ...form, is_pinned: e.target.checked })} />
                    Pin to top
                  </label>
                </div>
                {!editId && (
                  <div className="sa-form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.send_email} onChange={e => setForm({ ...form, send_email: e.target.checked })} />
                      Also send by email
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="sa-modal-footer">
              <button className="sa-secondary-btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="sa-primary-btn" onClick={save}>
                {editId ? 'Update' : <><Send size={16} /> Publish</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminAnnouncements;
