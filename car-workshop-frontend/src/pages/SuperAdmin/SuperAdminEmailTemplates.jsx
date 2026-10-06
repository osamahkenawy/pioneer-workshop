import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mail, Plus, EditPencil, Trash, Send, Eye, Copy,
  CheckCircle, Code, Search, Filter, RefreshDouble,
  Group, User, Building, WarningTriangle
} from 'iconoir-react';
import './SuperAdmin.css';

import { useConfirm } from './components';
import HtmlPreview from '../../components/HtmlPreview';
const API = import.meta.env.VITE_API_URL || '/api';
const hdrs = () => ({ Authorization: `Bearer ${localStorage.getItem('superAdminToken')}`, 'Content-Type': 'application/json' });

const safeVars = (v) => {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
};

const CATS = {
  welcome:      { color: '#10b981', label: 'Welcome',      bg: '#ecfdf5' },
  notification: { color: '#3b82f6', label: 'Notification', bg: '#eff6ff' },
  billing:      { color: '#f59e0b', label: 'Billing',      bg: '#fffbeb' },
  system:       { color: '#8b5cf6', label: 'System',       bg: '#f5f3ff' },
  custom:       { color: '#6b7280', label: 'Custom',       bg: '#f9fafb' },
};

const SOURCE_LABELS = { workshops: 'Workshops', contacts: 'Contacts', trials: 'Trial Requests' };
const SOURCE_ICONS  = { workshops: Building, contacts: User, trials: Group };

const SuperAdminEmailTemplates = () => {
  const askConfirm = useConfirm();
  const [templates, setTemplates]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [catFilter, setCatFilter]     = useState('all');
  const [toast, setToast]             = useState(null);

  // Edit/Create modal
  const [showModal, setShowModal]     = useState(false);
  const [editId, setEditId]           = useState(null);
  const [saving, setSaving]           = useState(false);
  const [form, setForm]               = useState({ name: '', slug: '', subject: '', body: '', variables: [], category: 'custom' });
  const [variableInput, setVariableInput] = useState('');
  const [bodyTab, setBodyTab]         = useState('code'); // 'code' | 'preview'

  // Preview modal
  const [showPreview, setShowPreview] = useState(null);

  // Test email modal
  const [showTestModal, setShowTestModal] = useState(null);
  const [testEmail, setTestEmail]         = useState('');
  const [testSending, setTestSending]     = useState(false);

  // Send email modal (the real deal)
  const [showSendModal, setShowSendModal] = useState(null);
  const [recipients, setRecipients]       = useState({ workshops: [], contacts: [], trials: [] });
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientSource, setRecipientSource] = useState('all');
  const [selectedRecipients, setSelectedRecipients] = useState([]);
  const [customVars, setCustomVars]       = useState({});
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [sending, setSending]             = useState(false);
  const [sendResult, setSendResult]       = useState(null);
  const searchTimeout = useRef(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ─── Fetch templates ───
  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/super-admin/email-templates`, { headers: hdrs() });
      if (res.ok) setTemplates(await res.json());
      else showToast('Failed to load templates', 'error');
    } catch { showToast('Network error loading templates', 'error'); }
    setLoading(false);
  };

  // ─── Filter templates ───
  const filtered = templates.filter(t => {
    if (catFilter !== 'all' && t.category !== catFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return t.name.toLowerCase().includes(s) || t.slug.toLowerCase().includes(s) || t.subject.toLowerCase().includes(s);
    }
    return true;
  });

  // ─── CRUD ───
  const save = async () => {
    if (!form.name || !form.slug || !form.subject || !form.body) {
      showToast('Please fill in all required fields', 'error');
      return;
    }
    setSaving(true);
    try {
      const method = editId ? 'PUT' : 'POST';
      const url = editId ? `${API}/super-admin/email-templates/${editId}` : `${API}/super-admin/email-templates`;
      const res = await fetch(url, { method, headers: hdrs(), body: JSON.stringify(form) });
      if (res.ok) {
        setShowModal(false); setEditId(null);
        showToast(editId ? 'Template updated successfully' : 'Template created successfully', 'success');
        fetchTemplates();
      } else {
        const d = await res.json();
        showToast(d.error || 'Failed to save template', 'error');
      }
    } catch { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const remove = async (id) => {
    if (!(await askConfirm({ title: 'Delete template?', message: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      const res = await fetch(`${API}/super-admin/email-templates/${id}`, { method: 'DELETE', headers: hdrs() });
      if (res.ok) { showToast('Template deleted', 'success'); fetchTemplates(); }
      else showToast('Failed to delete template', 'error');
    } catch { showToast('Network error', 'error'); }
  };

  const toggleActive = async (id) => {
    try {
      const res = await fetch(`${API}/super-admin/email-templates/${id}/toggle`, { method: 'PATCH', headers: hdrs() });
      if (res.ok) {
        const d = await res.json();
        setTemplates(prev => prev.map(t => t.id === id ? { ...t, is_active: d.is_active } : t));
        showToast(`Template ${d.is_active ? 'enabled' : 'disabled'}`, 'success');
      }
    } catch { showToast('Failed to toggle', 'error'); }
  };

  const duplicate = async (id) => {
    try {
      const res = await fetch(`${API}/super-admin/email-templates/${id}/duplicate`, { method: 'POST', headers: hdrs() });
      if (res.ok) { showToast('Template duplicated', 'success'); fetchTemplates(); }
      else showToast('Failed to duplicate', 'error');
    } catch { showToast('Network error', 'error'); }
  };

  const openEdit = (t) => {
    setEditId(t.id);
    setForm({ name: t.name, slug: t.slug, subject: t.subject, body: t.body, variables: safeVars(t.variables), category: t.category });
    setBodyTab('code');
    setShowModal(true);
  };

  const openNew = () => {
    setEditId(null);
    setForm({ name: '', slug: '', subject: '', body: '', variables: [], category: 'custom' });
    setBodyTab('code');
    setShowModal(true);
  };

  const addVariable = () => {
    const v = variableInput.trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    if (v && !form.variables.includes(v)) {
      setForm({ ...form, variables: [...form.variables, v] });
      setVariableInput('');
    }
  };

  // ─── Test email ───
  const sendTest = async (id) => {
    if (!testEmail) { showToast('Enter a recipient email', 'error'); return; }
    setTestSending(true);
    try {
      const res = await fetch(`${API}/super-admin/email-templates/${id}/test`, {
        method: 'POST', headers: hdrs(), body: JSON.stringify({ to: testEmail })
      });
      if (res.ok) { showToast('Test email sent!', 'success'); setShowTestModal(null); setTestEmail(''); }
      else { const d = await res.json(); showToast(d.error || 'Failed to send', 'error'); }
    } catch { showToast('Network error', 'error'); }
    setTestSending(false);
  };

  // ─── Send to recipients ───
  const openSendModal = (t) => {
    setShowSendModal(t);
    setSelectedRecipients([]);
    setRecipientSearch('');
    setRecipientSource('all');
    setCustomVars({});
    setSendResult(null);
    fetchRecipients('');
  };

  const fetchRecipients = async (searchTerm) => {
    setLoadingRecipients(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      if (recipientSource !== 'all') params.set('source', recipientSource);
      const res = await fetch(`${API}/super-admin/email-templates/recipients?${params}`, { headers: hdrs() });
      if (res.ok) setRecipients(await res.json());
    } catch { /* silent */ }
    setLoadingRecipients(false);
  };

  const onRecipientSearchChange = (val) => {
    setRecipientSearch(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchRecipients(val), 300);
  };

  useEffect(() => {
    if (showSendModal) fetchRecipients(recipientSearch);
  }, [recipientSource]);

  const allRecipients = [
    ...(recipientSource === 'all' || recipientSource === 'workshops' ? recipients.workshops : []),
    ...(recipientSource === 'all' || recipientSource === 'contacts' ? recipients.contacts : []),
    ...(recipientSource === 'all' || recipientSource === 'trials' ? recipients.trials : []),
  ];

  const toggleRecipient = (r) => {
    setSelectedRecipients(prev => {
      const key = `${r.type}-${r.id}`;
      const exists = prev.find(x => `${x.type}-${x.id}` === key);
      return exists ? prev.filter(x => `${x.type}-${x.id}` !== key) : [...prev, r];
    });
  };

  const selectAllVisible = () => {
    const keys = new Set(selectedRecipients.map(x => `${x.type}-${x.id}`));
    const newOnes = allRecipients.filter(r => !keys.has(`${r.type}-${r.id}`));
    setSelectedRecipients(prev => [...prev, ...newOnes]);
  };

  const deselectAll = () => setSelectedRecipients([]);

  const sendEmails = async () => {
    if (selectedRecipients.length === 0) { showToast('Select at least one recipient', 'error'); return; }
    if (selectedRecipients.length > 100) { showToast('Maximum 100 recipients per send', 'error'); return; }
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`${API}/super-admin/email-templates/${showSendModal.id}/send`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({ recipients: selectedRecipients, customVariables: customVars })
      });
      const d = await res.json();
      if (res.ok) {
        setSendResult(d);
        if (d.failed === 0) showToast(`Successfully sent ${d.sent} email${d.sent !== 1 ? 's' : ''}!`, 'success');
        else showToast(`Sent ${d.sent}, failed ${d.failed}`, 'error');
      } else {
        showToast(d.error || 'Failed to send emails', 'error');
      }
    } catch { showToast('Network error sending emails', 'error'); }
    setSending(false);
  };

  // ─── Auto-gen slug from name ───
  const onNameChange = (name) => {
    setForm(f => ({
      ...f,
      name,
      ...(editId ? {} : { slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') })
    }));
  };

  // ─── Stats ───
  const stats = {
    total: templates.length,
    active: templates.filter(t => t.is_active).length,
    categories: [...new Set(templates.map(t => t.category))].length,
  };

  return (
    <div className="sa-page">
      {/* Toast */}
      {toast && (
        <div className="sa-toast-container">
          <div style={{
            padding: '12px 20px', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 500,
            background: toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#3b82f6',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 8,
            animation: 'slideInRight 0.3s ease'
          }}>
            {toast.type === 'success' ? <CheckCircle size={18} /> : toast.type === 'error' ? <WarningTriangle size={18} /> : <Mail size={18} />}
            {toast.message}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="sa-page-header">
        <div>
          <h1>Email Templates</h1>
          <p>Create, manage, and send professional email templates to workshops, leads & contacts</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="sa-secondary-btn" onClick={fetchTemplates} title="Refresh">
            <RefreshDouble size={16} />
          </button>
          <button className="sa-primary-btn" onClick={openNew}>
            <Plus size={16} /> New Template
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Templates', value: stats.total, color: '#3b82f6' },
          { label: 'Active', value: stats.active, color: '#10b981' },
          { label: 'Disabled', value: stats.total - stats.active, color: '#ef4444' },
          { label: 'Categories', value: stats.categories, color: '#8b5cf6' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px',
            borderLeft: `4px solid ${s.color}`
          }}>
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</p>
            <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700, color: '#111827' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search & Filter Bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="sa-search-box" style={{ flex: 1, minWidth: 220 }}>
          <Search size={16} />
          <input placeholder="Search templates by name, slug, or subject..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className={`sa-secondary-btn${catFilter === 'all' ? ' active' : ''}`}
            onClick={() => setCatFilter('all')}
            style={{ padding: '6px 14px', fontSize: 13, ...(catFilter === 'all' ? { background: '#f97316', color: '#fff', border: 'none' } : {}) }}
          >All</button>
          {Object.entries(CATS).map(([k, v]) => (
            <button
              key={k}
              className={`sa-secondary-btn${catFilter === k ? ' active' : ''}`}
              onClick={() => setCatFilter(catFilter === k ? 'all' : k)}
              style={{ padding: '6px 14px', fontSize: 13, ...(catFilter === k ? { background: v.color, color: '#fff', border: 'none' } : {}) }}
            >{v.label}</button>
          ))}
        </div>
      </div>

      {/* Template Grid */}
      {loading ? (
        <div className="sa-loading-page"><div className="loading-spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="sa-card" style={{ textAlign: 'center', padding: 60 }}>
          <Mail size={48} style={{ color: '#d1d5db', marginBottom: 12 }} />
          <h3 style={{ color: '#374151', margin: '0 0 6px' }}>{search || catFilter !== 'all' ? 'No matching templates' : 'No templates yet'}</h3>
          <p style={{ color: '#6b7280', margin: 0 }}>{search || catFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first email template to get started'}</p>
        </div>
      ) : (
        <div className="sa-template-grid">
          {filtered.map(t => {
            const cat = CATS[t.category] || CATS.custom;
            const vars = safeVars(t.variables);
            return (
              <div key={t.id} className="sa-template-card" style={{ opacity: t.is_active ? 1 : 0.6, display: 'flex', flexDirection: 'column' }}>
                <div className="sa-template-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    background: cat.bg, color: cat.color, letterSpacing: '0.03em'
                  }}>{cat.label}</span>
                  <label className="sa-toggle" style={{ transform: 'scale(0.8)' }} title={t.is_active ? 'Active — click to disable' : 'Disabled — click to enable'}>
                    <input type="checkbox" checked={!!t.is_active} onChange={() => toggleActive(t.id)} />
                    <span className="sa-toggle-slider" />
                  </label>
                </div>
                <div style={{ padding: '0 16px 16px', flex: 1 }}>
                  <h3 style={{ margin: '12px 0 4px', fontSize: 16, fontWeight: 700, color: '#111827' }}>{t.name}</h3>
                  <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 8px' }}>
                    <code style={{ background: '#f8fafc', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{t.slug}</code>
                  </p>
                  <p style={{ color: '#475569', fontSize: 13, margin: '0 0 12px', lineHeight: 1.4 }}>
                    <strong>Subject:</strong> {t.subject}
                  </p>
                  {vars.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                      {vars.map(v => (
                        <code key={v} style={{ fontSize: 10, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#64748b' }}>
                          {`{{${v}}}`}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sa-template-actions" style={{ borderTop: '1px solid #f3f4f6' }}>
                  <button className="sa-icon-btn" onClick={() => setShowPreview(t)} title="Preview"><Eye size={16} /></button>
                  <button className="sa-icon-btn" onClick={() => { setShowTestModal(t.id); setTestEmail(''); }} title="Send Test"><Send size={16} style={{ color: '#3b82f6' }} /></button>
                  <button className="sa-icon-btn" onClick={() => openSendModal(t)} title="Send to Recipients"
                    style={{ background: '#fff7ed', color: '#f97316', border: '1px solid #fed7aa' }}>
                    <Mail size={16} />
                  </button>
                  <button className="sa-icon-btn" onClick={() => duplicate(t.id)} title="Duplicate"><Copy size={16} /></button>
                  <button className="sa-icon-btn" onClick={() => openEdit(t)} title="Edit"><EditPencil size={16} /></button>
                  <button className="sa-icon-btn danger" onClick={() => remove(t.id)} title="Delete"><Trash size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ Create/Edit Modal ═══ */}
      {showModal && (
        <div className="sa-modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="sa-modal-header">
              <h2>{editId ? 'Edit Template' : 'New Template'}</h2>
              <button className="sa-modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="sa-modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              <div className="sa-form-grid">
                <div className="sa-form-group">
                  <label>Template Name <span style={{ color: '#ef4444' }}>*</span></label>
                  <input value={form.name} onChange={e => onNameChange(e.target.value)} placeholder="e.g. Welcome Email" />
                </div>
                <div className="sa-form-group">
                  <label>Slug <span style={{ color: '#ef4444' }}>*</span></label>
                  <input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} disabled={!!editId}
                    placeholder="auto-generated" style={{ ...(editId ? { opacity: 0.6 } : {}) }} />
                </div>
                <div className="sa-form-group">
                  <label>Category</label>
                  <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Subject Line <span style={{ color: '#ef4444' }}>*</span></label>
                  <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}
                    placeholder="e.g. Welcome to {{workshop_name}}!" />
                </div>
                <div className="sa-form-group full-width">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ margin: 0 }}>Email Body <span style={{ color: '#ef4444' }}>*</span></label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => setBodyTab('code')}
                        style={{
                          padding: '4px 12px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                          background: bodyTab === 'code' ? '#111827' : '#fff', color: bodyTab === 'code' ? '#fff' : '#6b7280',
                        }}>
                        <Code size={12} style={{ marginRight: 4 }} /> HTML
                      </button>
                      <button
                        onClick={() => setBodyTab('preview')}
                        style={{
                          padding: '4px 12px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                          background: bodyTab === 'preview' ? '#111827' : '#fff', color: bodyTab === 'preview' ? '#fff' : '#6b7280',
                        }}>
                        <Eye size={12} style={{ marginRight: 4 }} /> Preview
                      </button>
                    </div>
                  </div>
                  {bodyTab === 'code' ? (
                    <textarea
                      value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={14}
                      style={{ fontFamily: '"SF Mono", Monaco, "Cascadia Code", monospace', fontSize: 13, lineHeight: 1.6, resize: 'vertical' }}
                      placeholder={'<p>Hi {{name}},</p>\n<p>Your content here...</p>'}
                    />
                  ) : (
                    <div style={{
                      border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, background: '#fafafa', minHeight: 200,
                      fontSize: 14, lineHeight: 1.7, color: '#374151'
                    }}>
                      {form.body ? (
                        <HtmlPreview html={form.body} minHeight={160} />
                      ) : (
                        <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>Write HTML in the editor to see a preview here</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="sa-form-group full-width">
                  <label>Template Variables</label>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
                    Use <code style={{ fontSize: 11 }}>{'{{variable_name}}'}</code> in body/subject. They&apos;ll be auto-replaced when sending.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={variableInput} onChange={e => setVariableInput(e.target.value)} placeholder="e.g. workshop_name"
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addVariable())} style={{ flex: 1 }} />
                    <button className="sa-secondary-btn" onClick={addVariable} style={{ padding: '6px 16px', whiteSpace: 'nowrap' }}>
                      <Plus size={14} /> Add
                    </button>
                  </div>
                  {form.variables.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {form.variables.map(v => (
                        <span key={v} onClick={() => setForm({ ...form, variables: form.variables.filter(x => x !== v) })}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                            background: '#f1f5f9', borderRadius: 20, fontSize: 12, cursor: 'pointer', color: '#475569',
                            border: '1px solid #e2e8f0', transition: 'all 0.15s',
                          }}
                          title="Click to remove">
                          <Code size={12} />{`{{${v}}}`} <span style={{ color: '#ef4444', fontWeight: 700, marginLeft: 2 }}>×</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="sa-modal-footer">
              <button className="sa-secondary-btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="sa-primary-btn" onClick={save} disabled={saving}>
                {saving ? 'Saving...' : (editId ? 'Update Template' : 'Create Template')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Preview Modal ═══ */}
      {showPreview && (
        <div className="sa-modal-backdrop" onClick={() => setShowPreview(null)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="sa-modal-header">
              <h2>Preview: {showPreview.name}</h2>
              <button className="sa-modal-close" onClick={() => setShowPreview(null)}>×</button>
            </div>
            <div className="sa-modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                  <strong>Subject:</strong> {showPreview.subject}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
                  Category: {(CATS[showPreview.category] || CATS.custom).label} &bull; {showPreview.is_active ? 'Active' : 'Disabled'}
                </p>
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
                <div style={{ background: '#f97316', height: 4 }} />
                <HtmlPreview html={showPreview.body} minHeight={320} style={{ padding: 0 }} />
              </div>
              {safeVars(showPreview.variables).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', margin: '0 0 6px' }}>Variables</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {safeVars(showPreview.variables).map(v => (
                      <code key={v} style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 8px', borderRadius: 4, color: '#475569' }}>
                        {`{{${v}}}`}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="sa-modal-footer">
              <button className="sa-secondary-btn" onClick={() => setShowPreview(null)}>Close</button>
              <button className="sa-primary-btn" onClick={() => { setShowPreview(null); openSendModal(showPreview); }}>
                <Send size={16} /> Send This Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Test Email Modal ═══ */}
      {showTestModal && (
        <div className="sa-modal-backdrop" onClick={() => setShowTestModal(null)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="sa-modal-header">
              <h2>Send Test Email</h2>
              <button className="sa-modal-close" onClick={() => setShowTestModal(null)}>×</button>
            </div>
            <div className="sa-modal-body">
              <div className="sa-form-group">
                <label>Recipient Email</label>
                <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="you@example.com" autoFocus
                  onKeyDown={e => e.key === 'Enter' && sendTest(showTestModal)} />
              </div>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, marginTop: 12 }}>
                <p style={{ margin: 0, fontSize: 12, color: '#92400e' }}>
                  Variables will be replaced with <strong>[Sample: variable]</strong> placeholders. Subject will be prefixed with <strong>[TEST]</strong>.
                </p>
              </div>
            </div>
            <div className="sa-modal-footer">
              <button className="sa-secondary-btn" onClick={() => setShowTestModal(null)}>Cancel</button>
              <button className="sa-primary-btn" onClick={() => sendTest(showTestModal)} disabled={testSending || !testEmail}>
                {testSending ? 'Sending...' : <><Send size={16} /> Send Test</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Send to Recipients Modal ═══ */}
      {showSendModal && (
        <div className="sa-modal-backdrop" onClick={() => setShowSendModal(null)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="sa-modal-header">
              <div>
                <h2 style={{ margin: 0 }}>Send Email</h2>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
                  Template: <strong>{showSendModal.name}</strong>
                </p>
              </div>
              <button className="sa-modal-close" onClick={() => setShowSendModal(null)}>×</button>
            </div>
            <div className="sa-modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              {!sendResult ? (
                <>
                  {/* Recipient Search & Source Filter */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                    <div className="sa-search-box" style={{ flex: 1, minWidth: 200 }}>
                      <Search size={16} />
                      <input placeholder="Search recipients..." value={recipientSearch} onChange={e => onRecipientSearchChange(e.target.value)} autoFocus />
                    </div>
                    <select value={recipientSource} onChange={e => setRecipientSource(e.target.value)}
                      style={{ padding: '8px 14px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, background: '#fff' }}>
                      <option value="all">All Sources</option>
                      <option value="workshops">Workshops</option>
                      <option value="contacts">Contacts</option>
                      <option value="trials">Trial Requests</option>
                    </select>
                  </div>

                  {/* Selection controls */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                      <strong style={{ color: '#111827' }}>{selectedRecipients.length}</strong> selected
                      {selectedRecipients.length > 0 && <> of {allRecipients.length} shown</>}
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={selectAllVisible} className="sa-secondary-btn" style={{ padding: '4px 12px', fontSize: 12 }}>
                        Select All Visible
                      </button>
                      {selectedRecipients.length > 0 && (
                        <button onClick={deselectAll} className="sa-secondary-btn" style={{ padding: '4px 12px', fontSize: 12, color: '#ef4444' }}>
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Recipient List */}
                  <div style={{
                    border: '1px solid #e5e7eb', borderRadius: 10, maxHeight: 300, overflowY: 'auto',
                    background: '#fafafa'
                  }}>
                    {loadingRecipients ? (
                      <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading recipients...</div>
                    ) : allRecipients.length === 0 ? (
                      <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                        <User size={32} style={{ marginBottom: 8 }} />
                        <p style={{ margin: 0 }}>No recipients found</p>
                      </div>
                    ) : (
                      allRecipients.map(r => {
                        const key = `${r.type}-${r.id}`;
                        const isSelected = selectedRecipients.some(x => `${x.type}-${x.id}` === key);
                        const Icon = SOURCE_ICONS[r.type + 's'] || User;
                        return (
                          <div key={key} onClick={() => toggleRecipient(r)} style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                            background: isSelected ? '#fff7ed' : '#fff', cursor: 'pointer',
                            borderBottom: '1px solid #f3f4f6', transition: 'all 0.15s',
                          }}>
                            <input type="checkbox" checked={isSelected} readOnly style={{ accentColor: '#f97316', width: 16, height: 16 }} />
                            <div style={{
                              width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: isSelected ? '#fed7aa' : '#f1f5f9', flexShrink: 0,
                            }}>
                              <Icon size={16} style={{ color: isSelected ? '#f97316' : '#6b7280' }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.name || '(No name)'}
                              </p>
                              <p style={{ margin: 0, fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.email}
                              </p>
                            </div>
                            <span style={{
                              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                              borderRadius: 20, background: r.type === 'workshop' ? '#ecfdf5' : r.type === 'contact' ? '#eff6ff' : '#f5f3ff',
                              color: r.type === 'workshop' ? '#059669' : r.type === 'contact' ? '#2563eb' : '#7c3aed',
                            }}>
                              {SOURCE_LABELS[r.type + 's'] || r.type}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Custom Variables */}
                  {safeVars(showSendModal.variables).length > 0 && (
                    <div style={{ marginTop: 20 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '0 0 10px' }}>
                        Custom Variable Values <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional overrides)</span>
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {safeVars(showSendModal.variables).filter(v =>
                          !['name', 'first_name', 'last_name', 'email', 'workshop_name', 'company_name'].includes(v)
                        ).map(v => (
                          <div key={v} className="sa-form-group" style={{ margin: 0 }}>
                            <label style={{ fontSize: 12 }}>{`{{${v}}}`}</label>
                            <input value={customVars[v] || ''} onChange={e => setCustomVars(p => ({ ...p, [v]: e.target.value }))}
                              placeholder={`Value for ${v}`} style={{ fontSize: 13 }} />
                          </div>
                        ))}
                      </div>
                      <p style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0 0' }}>
                        <code>name</code>, <code>email</code>, <code>workshop_name</code> are auto-filled from recipient data.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                /* ─── Send Results ─── */
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: sendResult.failed === 0 ? '#ecfdf5' : '#fef3c7',
                  }}>
                    {sendResult.failed === 0
                      ? <CheckCircle size={32} style={{ color: '#10b981' }} />
                      : <WarningTriangle size={32} style={{ color: '#f59e0b' }} />
                    }
                  </div>
                  <h3 style={{ margin: '0 0 8px', color: '#111827' }}>
                    {sendResult.failed === 0 ? 'All Emails Sent Successfully!' : 'Sending Complete with Errors'}
                  </h3>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 24, margin: '16px 0' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: '#10b981' }}>{sendResult.sent}</p>
                      <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>Sent</p>
                    </div>
                    {sendResult.failed > 0 && (
                      <div>
                        <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: '#ef4444' }}>{sendResult.failed}</p>
                        <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>Failed</p>
                      </div>
                    )}
                  </div>
                  {sendResult.errors?.length > 0 && (
                    <div style={{ textAlign: 'left', marginTop: 16 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', marginBottom: 6 }}>Failed recipients:</p>
                      {sendResult.errors.map((e, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#6b7280', padding: '4px 0' }}>
                          {e.email}: <span style={{ color: '#ef4444' }}>{e.error}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="sa-modal-footer">
              {sendResult ? (
                <button className="sa-primary-btn" onClick={() => setShowSendModal(null)}>Done</button>
              ) : (
                <>
                  <button className="sa-secondary-btn" onClick={() => setShowSendModal(null)}>Cancel</button>
                  <button className="sa-primary-btn" onClick={sendEmails}
                    disabled={sending || selectedRecipients.length === 0}
                    style={{ minWidth: 160 }}>
                    {sending ? (
                      <span>Sending...</span>
                    ) : (
                      <><Send size={16} /> Send to {selectedRecipients.length} Recipient{selectedRecipients.length !== 1 ? 's' : ''}</>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminEmailTemplates;
