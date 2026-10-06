import { useState, useEffect } from 'react';
import {
  Suitcase, Plus, EditPencil, Trash, Eye, EyeClosed, UserPlus,
  Search, Calendar, MapPin, Clock, Send, CheckCircle,
  WarningTriangle, Hourglass, Phone, Mail, Page, Download,
  Xmark
} from 'iconoir-react';
import './SuperAdmin.css';

import { useConfirm } from './components';
const API = import.meta.env.VITE_API_URL || '/api';
const hdrs = () => ({
  Authorization: `Bearer ${localStorage.getItem('superAdminToken')}`,
  'Content-Type': 'application/json',
});

const STATUS_CFG = {
  new:         { color: '#3b82f6', bg: '#eff6ff',  label: 'New',         icon: <UserPlus size={14} /> },
  reviewing:   { color: '#8b5cf6', bg: '#faf5ff',  label: 'Reviewing',   icon: <Eye size={14} /> },
  shortlisted: { color: '#f59e0b', bg: '#fffbeb',  label: 'Shortlisted', icon: <CheckCircle size={14} /> },
  interview:   { color: '#06b6d4', bg: '#ecfeff',  label: 'Interview',   icon: <Calendar size={14} /> },
  offered:     { color: '#10b981', bg: '#ecfdf5',  label: 'Offered',     icon: <Send size={14} /> },
  hired:       { color: '#22c55e', bg: '#f0fdf4',  label: 'Hired',       icon: <CheckCircle size={14} /> },
  rejected:    { color: '#ef4444', bg: '#fef2f2',  label: 'Rejected',    icon: <WarningTriangle size={14} /> },
};

const TYPES = ['full-time', 'part-time', 'contract', 'internship'];

const DEPT_COLORS = {
  Engineering: { gradient: 'linear-gradient(135deg,#3b82f6,#6366f1)', text: '#3b82f6' },
  Product:     { gradient: 'linear-gradient(135deg,#8b5cf6,#a855f7)', text: '#8b5cf6' },
  Sales:       { gradient: 'linear-gradient(135deg,#f59e0b,#f97316)', text: '#f59e0b' },
  Support:     { gradient: 'linear-gradient(135deg,#06b6d4,#0ea5e9)', text: '#06b6d4' },
  Marketing:   { gradient: 'linear-gradient(135deg,#3bb4e8,#f43f5e)', text: '#3bb4e8' },
  Design:      { gradient: 'linear-gradient(135deg,#14b8a6,#10b981)', text: '#14b8a6' },
  default:     { gradient: 'linear-gradient(135deg,#64748b,#475569)', text: '#64748b' },
};

const getDeptColor = (dept) => DEPT_COLORS[dept] || DEPT_COLORS.default;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const SuperAdminVacancies = () => {
  const askConfirm = useConfirm();
  const [tab, setTab] = useState('openings');
  const [openings, setOpenings] = useState([]);
  const [applications, setApplications] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [showAppDetail, setShowAppDetail] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterOpening, setFilterOpening] = useState('');

  const blankForm = {
    title: '', department: '', location: '', employment_type: 'full-time',
    description: '', requirements: '', salary_range: '', icon: 'mdi:briefcase-outline',
    sort_order: 0, is_active: 1,
  };
  const [form, setForm] = useState(blankForm);

  useEffect(() => { fetchAll(); }, []);
  useEffect(() => { fetchApplications(); }, [filterStatus, filterOpening, searchTerm]);

  const fetchAll = () => { fetchOpenings(); fetchApplications(); };

  const fetchOpenings = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/super-admin/vacancies`, { headers: hdrs() });
      if (r.ok) { const d = await r.json(); setOpenings(d.openings || []); setStats(d.stats || {}); }
    } catch (_) {}
    setLoading(false);
  };

  const fetchApplications = async () => {
    try {
      const p = new URLSearchParams({ limit: '200' });
      if (filterStatus) p.set('status', filterStatus);
      if (filterOpening) p.set('opening_id', filterOpening);
      if (searchTerm) p.set('search', searchTerm);
      const r = await fetch(`${API}/super-admin/applications?${p}`, { headers: hdrs() });
      if (r.ok) { const d = await r.json(); setApplications(d.applications || []); }
    } catch (_) {}
  };

  const saveOpening = async () => {
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API}/super-admin/vacancies/${editId}` : `${API}/super-admin/vacancies`;
    await fetch(url, { method, headers: hdrs(), body: JSON.stringify(form) });
    closeModal(); fetchOpenings();
  };

  const deleteOpening = async (id) => {
    if (!(await askConfirm({ title: 'Delete vacancy?', message: 'This vacancy and ALL its applications will be deleted.', danger: true, confirmLabel: 'Delete' }))) return;
    await fetch(`${API}/super-admin/vacancies/${id}`, { method: 'DELETE', headers: hdrs() });
    fetchAll();
  };

  const toggleOpening = async (id) => {
    await fetch(`${API}/super-admin/vacancies/${id}/toggle`, { method: 'PATCH', headers: hdrs() });
    fetchOpenings();
  };

  const openEdit = (o) => {
    setEditId(o.id);
    setForm({ title: o.title, department: o.department, location: o.location,
      employment_type: o.employment_type, description: o.description || '',
      requirements: o.requirements || '', salary_range: o.salary_range || '',
      icon: o.icon || 'mdi:briefcase-outline', sort_order: o.sort_order || 0, is_active: o.is_active });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditId(null); setForm(blankForm); };

  const updateAppStatus = async (appId, status) => {
    await fetch(`${API}/super-admin/applications/${appId}/status`, {
      method: 'PATCH', headers: hdrs(), body: JSON.stringify({ status }),
    });
    fetchApplications(); fetchOpenings();
    if (showAppDetail?.id === appId) setShowAppDetail(prev => ({ ...prev, status }));
  };

  const deleteApp = async (id) => {
    if (!(await askConfirm({ title: 'Delete application?', message: 'This applicant record will be permanently removed.', danger: true, confirmLabel: 'Delete' }))) return;
    await fetch(`${API}/super-admin/applications/${id}`, { method: 'DELETE', headers: hdrs() });
    fetchAll(); if (showAppDetail?.id === id) setShowAppDetail(null);
  };

  /* ─────────────────── RENDER ─────────────────── */
  return (
    <div className="sav">
      {/* ── Hero Header ── */}
      <div className="sav-hero">
        <div className="sav-hero-bg">
          <div className="sav-hero-circle c1" />
          <div className="sav-hero-circle c2" />
          <div className="sav-hero-circle c3" />
        </div>
        <div className="sav-hero-content">
          <div className="sav-hero-text">
            <h1><Suitcase size={32} /> Recruitment Hub</h1>
            <p>Manage openings, track candidates, and build your dream team</p>
          </div>
          <button className="sav-hero-btn" onClick={() => { setEditId(null); setForm(blankForm); setShowModal(true); }}>
            <Plus size={18} /> New Vacancy
          </button>
        </div>
      </div>

      {/* ── Stats Strip ── */}
      <div className="sav-stats">
        {[
          { label: 'Active Openings', value: stats.active_openings || 0, icon: <Suitcase size={20} />, gradient: 'linear-gradient(135deg,#3b82f6,#6366f1)' },
          { label: 'Total Applications', value: stats.total_applications || 0, icon: <UserPlus size={20} />, gradient: 'linear-gradient(135deg,#8b5cf6,#a855f7)' },
          { label: 'New / Unread', value: stats.new_applications || 0, icon: <Hourglass size={20} />, gradient: 'linear-gradient(135deg,#f59e0b,#f97316)' },
          { label: 'In Interview', value: stats.interviewing || 0, icon: <Calendar size={20} />, gradient: 'linear-gradient(135deg,#06b6d4,#0ea5e9)' },
          { label: 'Hired', value: stats.hired || 0, icon: <CheckCircle size={20} />, gradient: 'linear-gradient(135deg,#22c55e,#16a34a)' },
        ].map((s, i) => (
          <div key={i} className="sav-stat-card">
            <div className="sav-stat-icon" style={{ background: s.gradient }}>{s.icon}</div>
            <div className="sav-stat-data">
              <span className="sav-stat-value">{s.value}</span>
              <span className="sav-stat-label">{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="sav-tabs-bar">
        <div className="sav-tabs">
          <button className={`sav-tab ${tab === 'openings' ? 'active' : ''}`} onClick={() => setTab('openings')}>
            <Suitcase size={16} /> Openings <span className="sav-tab-count">{openings.length}</span>
          </button>
          <button className={`sav-tab ${tab === 'applications' ? 'active' : ''}`} onClick={() => setTab('applications')}>
            <UserPlus size={16} /> Applications <span className="sav-tab-count">{applications.length}</span>
          </button>
        </div>
        {tab === 'openings' && (
          <button className="sav-add-btn-sm" onClick={() => { setEditId(null); setForm(blankForm); setShowModal(true); }}>
            <Plus size={15} /> Add
          </button>
        )}
      </div>

      {/* ═══════ OPENINGS TAB ═══════ */}
      {tab === 'openings' && (
        loading ? (
          <div className="sav-loading"><div className="loading-spinner" /></div>
        ) : openings.length === 0 ? (
          <div className="sav-empty-card">
            <div className="sav-empty-icon"><Suitcase size={56} /></div>
            <h3>No vacancies yet</h3>
            <p>Create your first job opening to start building your team</p>
            <button className="sav-hero-btn" onClick={() => { setEditId(null); setForm(blankForm); setShowModal(true); }}>
              <Plus size={18} /> Create First Vacancy
            </button>
          </div>
        ) : (
          <div className="sav-vacancy-grid">
            {openings.map(o => {
              const dc = getDeptColor(o.department);
              return (
                <div key={o.id} className={`sav-vcard ${!o.is_active ? 'inactive' : ''}`}>
                  <div className="sav-vcard-accent" style={{ background: dc.gradient }} />
                  <div className="sav-vcard-body">
                    <div className="sav-vcard-top">
                      <span className="sav-vcard-dept" style={{ color: dc.text, background: `${dc.text}14` }}>{o.department}</span>
                      <div className="sav-vcard-actions">
                        <button onClick={() => toggleOpening(o.id)} title={o.is_active ? 'Pause' : 'Activate'}>
                          {o.is_active ? <EyeClosed size={15} /> : <Eye size={15} />}
                        </button>
                        <button onClick={() => openEdit(o)} title="Edit"><EditPencil size={15} /></button>
                        <button className="danger" onClick={() => deleteOpening(o.id)} title="Delete"><Trash size={15} /></button>
                      </div>
                    </div>
                    <h3 className="sav-vcard-title">{o.title}</h3>
                    <div className="sav-vcard-meta">
                      <span><MapPin size={14} /> {o.location}</span>
                      <span><Clock size={14} /> {o.employment_type}</span>
                    </div>
                    {o.description && <p className="sav-vcard-desc">{o.description.substring(0, 100)}{o.description.length > 100 ? '…' : ''}</p>}
                    <div className="sav-vcard-foot">
                      <div className="sav-vcard-apps">
                        <span className="sav-vcard-apps-total">{o.total_applications || 0}</span>
                        <span>applicants</span>
                        {(o.new_applications || 0) > 0 && <span className="sav-vcard-new">{o.new_applications} new</span>}
                      </div>
                      <span className="sav-vcard-date">{fmtDate(o.created_at)}</span>
                    </div>
                    {!o.is_active && <div className="sav-vcard-paused">PAUSED</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ═══════ APPLICATIONS TAB ═══════ */}
      {tab === 'applications' && (
        <>
          <div className="sav-filter-row">
            <div className="sav-search-box">
              <Search size={16} />
              <input placeholder="Search candidates…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              {searchTerm && <button className="sav-search-clear" onClick={() => setSearchTerm('')}><Xmark size={14} /></button>}
            </div>
            <select className="sav-sel" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select className="sav-sel" value={filterOpening} onChange={e => setFilterOpening(e.target.value)}>
              <option value="">All positions</option>
              {openings.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </div>

          {applications.length === 0 ? (
            <div className="sav-empty-card sm">
              <UserPlus size={40} style={{ color: '#9ca3af' }} />
              <h3>No applications match your filters</h3>
              <p>Candidates who apply through the careers page will appear here</p>
            </div>
          ) : (
            <div className="sav-app-list">
              {applications.map(app => {
                const sc = STATUS_CFG[app.status] || STATUS_CFG.new;
                return (
                  <div key={app.id} className="sav-app-row" onClick={() => setShowAppDetail(app)}>
                    <div className="sav-app-avatar" style={{ background: sc.bg, color: sc.color }}>
                      {app.full_name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="sav-app-info">
                      <strong>{app.full_name}</strong>
                      <span>{app.email}</span>
                    </div>
                    <div className="sav-app-pos">
                      <strong>{app.position_title}</strong>
                      <span>{app.position_department}</span>
                    </div>
                    <span className="sav-app-badge" style={{ background: sc.bg, color: sc.color }}>
                      {sc.icon} {sc.label}
                    </span>
                    <span className="sav-app-date">{fmtDate(app.created_at)}</span>
                    <div className="sav-app-quick">
                      <select value={app.status} onClick={e => e.stopPropagation()}
                        onChange={e => { e.stopPropagation(); updateAppStatus(app.id, e.target.value); }}>
                        {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <button className="danger" onClick={e => { e.stopPropagation(); deleteApp(app.id); }}>
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══════ CREATE / EDIT MODAL ═══════ */}
      {showModal && (
        <div className="sav-backdrop" onClick={closeModal}>
          <div className="sav-modal" onClick={e => e.stopPropagation()}>
            <div className="sav-modal-head">
              <div>
                <h2>{editId ? 'Edit Vacancy' : 'Create New Vacancy'}</h2>
                <p>{editId ? 'Update the job listing details' : 'Fill in the details to publish a new position'}</p>
              </div>
              <button className="sav-modal-x" onClick={closeModal}><Xmark size={22} /></button>
            </div>

            <div className="sav-modal-body">
              <div className="sav-form-row">
                <label className="sav-field full">
                  <span>Job Title <em>*</em></span>
                  <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. Senior Full-Stack Engineer" />
                </label>
              </div>
              <div className="sav-form-row two">
                <label className="sav-field">
                  <span>Department <em>*</em></span>
                  <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
                    placeholder="e.g. Engineering" />
                </label>
                <label className="sav-field">
                  <span>Location <em>*</em></span>
                  <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                    placeholder="e.g. Remote / Dubai, UAE" />
                </label>
              </div>
              <div className="sav-form-row three">
                <label className="sav-field">
                  <span>Type</span>
                  <select value={form.employment_type} onChange={e => setForm({ ...form, employment_type: e.target.value })}>
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="sav-field">
                  <span>Salary Range</span>
                  <input value={form.salary_range} onChange={e => setForm({ ...form, salary_range: e.target.value })}
                    placeholder="e.g. 15k – 25k AED" />
                </label>
                <label className="sav-field">
                  <span>Sort WorkOrder</span>
                  <input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} />
                </label>
              </div>
              <div className="sav-form-row">
                <label className="sav-field full">
                  <span>Description</span>
                  <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="Describe role and responsibilities…" rows={4} />
                </label>
              </div>
              <div className="sav-form-row">
                <label className="sav-field full">
                  <span>Requirements</span>
                  <textarea value={form.requirements} onChange={e => setForm({ ...form, requirements: e.target.value })}
                    placeholder="Skills, experience, qualifications…" rows={4} />
                </label>
              </div>
            </div>

            <div className="sav-modal-foot">
              <button className="sav-btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="sav-btn-primary" onClick={saveOpening}
                disabled={!form.title || !form.department || !form.location}>
                {editId ? 'Save Changes' : <><Plus size={16} /> Publish Vacancy</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ APPLICATION DETAIL SLIDE-OVER ═══════ */}
      {showAppDetail && (() => {
        const a = showAppDetail;
        const sc = STATUS_CFG[a.status] || STATUS_CFG.new;
        return (
          <div className="sav-backdrop" onClick={() => setShowAppDetail(null)}>
            <div className="sav-drawer" onClick={e => e.stopPropagation()}>
              <div className="sav-drawer-head">
                <h2>Applicant Profile</h2>
                <button className="sav-modal-x" onClick={() => setShowAppDetail(null)}><Xmark size={22} /></button>
              </div>

              <div className="sav-drawer-body">
                {/* Profile card */}
                <div className="sav-profile-card">
                  <div className="sav-profile-avatar" style={{ background: sc.bg, color: sc.color }}>
                    {a.full_name?.charAt(0)?.toUpperCase()}
                  </div>
                  <h3>{a.full_name}</h3>
                  <p>Applied for <strong>{a.position_title}</strong></p>
                  <span className="sav-app-badge lg" style={{ background: sc.bg, color: sc.color }}>
                    {sc.icon} {sc.label}
                  </span>
                </div>

                {/* Details */}
                <div className="sav-detail-section">
                  <h4>Contact</h4>
                  <div className="sav-detail-row"><Mail size={16} /> {a.email}</div>
                  {a.phone && <div className="sav-detail-row"><Phone size={16} /> {a.phone}</div>}
                </div>

                <div className="sav-detail-section">
                  <h4>Position Info</h4>
                  <div className="sav-detail-row"><Suitcase size={16} /> {a.position_department}</div>
                  <div className="sav-detail-row"><Calendar size={16} /> Applied {fmtDate(a.created_at)}</div>
                </div>

                {a.resume_url && (
                  <a href={`${API.replace('/api', '')}${a.resume_url}`} target="_blank" rel="noopener noreferrer" className="sav-download-btn">
                    <Download size={16} /> Download Resume
                  </a>
                )}

                {a.cover_letter && (
                  <div className="sav-detail-section">
                    <h4>Cover Letter</h4>
                    <div className="sav-cover-text">{a.cover_letter}</div>
                  </div>
                )}

                {/* Pipeline */}
                <div className="sav-detail-section">
                  <h4>Update Pipeline Stage</h4>
                  <div className="sav-pipeline">
                    {Object.entries(STATUS_CFG).map(([key, cfg]) => (
                      <button key={key}
                        className={`sav-pipe-btn ${a.status === key ? 'active' : ''}`}
                        style={{ '--pc': cfg.color, '--pb': cfg.bg }}
                        onClick={() => updateAppStatus(a.id, key)}>
                        {cfg.icon} {cfg.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="sav-drawer-foot">
                <button className="sav-btn-danger" onClick={() => { deleteApp(a.id); setShowAppDetail(null); }}>
                  <Trash size={15} /> Delete
                </button>
                <button className="sav-btn-ghost" onClick={() => setShowAppDetail(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default SuperAdminVacancies;
