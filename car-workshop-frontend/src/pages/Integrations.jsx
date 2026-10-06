import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import {
  Key, Network, DataTransferBoth, Plus, Trash, RefreshDouble,
  Copy, Check, ArrowUpRight, Lock, CheckCircle, Clock, Book, Xmark,
  Search, EditPencil, WarningTriangle, Shield, Eye, EyeClosed, Activity,
} from 'iconoir-react';
import api from '../lib/api';
import './Integrations.css';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = d => d ? new Date(d).toLocaleString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const trunc   = (s, n = 50) => s?.length > n ? s.slice(0, n) + '…' : s;

function timeAgo(d) {
  if (!d) return null;
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
}

const PERM_META = {
  read:  { label: 'integrations.read_only',   color: '#16a34a', bg: '#dcfce7', icon: Eye,    scopes: 'orders:read, tracking:read' },
  write: { label: 'integrations.read_write',   color: '#2563eb', bg: '#dbeafe', icon: EditPencil, scopes: 'orders:read/write, tracking:read' },
  full:  { label: 'integrations.full_access',  color: '#9333ea', bg: '#f3e8ff', icon: Shield, scopes: 'All permissions' },
};

const EVENT_GROUPS = {
  'WorkOrder Events':   ['order.created','order.confirmed','order.assigned','order.picked_up','order.in_transit','order.delivered','order.failed','order.returned','order.cancelled'],
  'Return Events':  ['return.created','return.approved','return.picked_up','return.refunded'],
  'Mechanic Events':  ['mechanic.assigned','mechanic.location'],
  'Finance Events': ['cod.settled'],
};

const STATUS_BADGE = {
  sent:    { bg: '#dcfce7', color: '#16a34a', labelKey: 'integrations.status_sent' },
  failed:  { bg: '#fee2e2', color: '#dc2626', labelKey: 'integrations.status_failed' },
  pending: { bg: '#fef3c7', color: '#d97706', labelKey: 'integrations.status_pending' },
};

function APIKeysTab() {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const [keys,         setKeys]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showCreate,   setShowCreate]   = useState(false);
  const [form,         setForm]         = useState({ name: '', description: '', permissions: 'read', expires_at: '' });
  const [saving,       setSaving]       = useState(false);
  const [newKey,       setNewKey]       = useState(null);
  const [copied,       setCopied]       = useState(false);
  const [search,       setSearch]       = useState('');
  const [editKey,      setEditKey]      = useState(null);
  const [editForm,     setEditForm]     = useState({ name: '', description: '' });
  const [expandedId,   setExpandedId]   = useState(null);
  const [regenConfirm, setRegenConfirm] = useState(null);
  const [error,        setError]        = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get('/integrations');
      if (res.success) setKeys(res.data || []);
      else setError(res.message || 'Failed to load API keys');
    } catch (err) {
      setError('Network error loading API keys');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return keys;
    const q = search.toLowerCase();
    return keys.filter(k =>
      k.name?.toLowerCase().includes(q) ||
      k.description?.toLowerCase().includes(q) ||
      k.key_preview?.toLowerCase().includes(q)
    );
  }, [keys, search]);

  const handleCreate = async e => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const res = await api.post('/integrations', form);
      if (res.success) {
        setNewKey(res.data?.api_key);
        setForm({ name: '', description: '', permissions: 'read', expires_at: '' });
        setShowCreate(false);
        load();
      } else {
        setError(res.message || 'Failed to create API key');
      }
    } catch (err) {
      setError('Network error creating API key');
    }
    setSaving(false);
  };

  const handleEdit = async e => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const res = await api.put(`/integrations/${editKey.id}`, editForm);
      if (res.success) { setEditKey(null); load(); }
      else setError(res.message || 'Failed to update API key');
    } catch (err) {
      setError('Network error updating API key');
    }
    setSaving(false);
  };

  const handleRegenerate = async (id) => {
    setError(null);
    try {
      const res = await api.post(`/integrations/${id}/regenerate`);
      if (res.success) {
        setNewKey(res.data?.api_key);
        setRegenConfirm(null);
        load();
      } else {
        setError(res.message || 'Failed to regenerate API key');
        setRegenConfirm(null);
      }
    } catch (err) {
      setError('Network error regenerating API key');
      setRegenConfirm(null);
    }
  };

  const copy = val => { navigator.clipboard.writeText(val); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const permLevel = (perms) => {
    if (!perms) return 'read';
    const raw = typeof perms === 'string' ? perms.replace(/[\[\]"]/g, '') : perms;
    if (raw === 'full') return 'full';
    if (raw === 'write') return 'write';
    if (typeof raw === 'string' && raw.includes('write')) return 'write';
    return 'read';
  };

  const activeCount = keys.filter(k => k.is_active).length;
  const revokedCount = keys.filter(k => !k.is_active).length;
  const totalRequests = keys.reduce((s, k) => s + (k.request_count || 0), 0);

  return (
    <div>
      {/* ── Error banner ─────────────────────────────────────── */}
      {error && (
        <div className="intg-error-banner" style={{background:'#fee2e2',color:'#dc2626',padding:'10px 16px',borderRadius:8,marginBottom:14,fontSize:13,display:'flex',alignItems:'center',gap:8}}>
          <WarningTriangle width={15} height={15} />
          {error}
          <button style={{marginLeft:'auto',background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:600}} onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* ── Stats bar ────────────────────────────────────────── */}
      {keys.length > 0 && (
        <div className="intg-stats-bar">
          <div className="intg-stat-card">
            <Key width={18} height={18} />
            <div className="intg-stat-value">{keys.length}</div>
            <div className="intg-stat-label">{t('integrations.total_keys', 'Total Keys')}</div>
          </div>
          <div className="intg-stat-card">
            <CheckCircle width={18} height={18} style={{ color: '#16a34a' }} />
            <div className="intg-stat-value">{activeCount}</div>
            <div className="intg-stat-label">{t('integrations.active', 'Active')}</div>
          </div>
          <div className="intg-stat-card">
            <Lock width={18} height={18} style={{ color: '#dc2626' }} />
            <div className="intg-stat-value">{revokedCount}</div>
            <div className="intg-stat-label">{t('integrations.revoked', 'Revoked')}</div>
          </div>
          <div className="intg-stat-card">
            <Activity width={18} height={18} style={{ color: '#2563eb' }} />
            <div className="intg-stat-value">{totalRequests.toLocaleString()}</div>
            <div className="intg-stat-label">{t('integrations.total_requests', 'Total Requests')}</div>
          </div>
        </div>
      )}

      {/* ── Header + search ─────────────────────────────────── */}
      <div className="intg-section-header">
        <div>
          <h3 className="intg-section-title">{t('integrations.api_keys')}</h3>
          <p className="intg-section-sub">{t('integrations.api_keys_sub')}</p>
        </div>
        <div className="intg-header-actions">
          {keys.length > 0 && (
            <div className="intg-search-wrap">
              <Search width={14} height={14} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder={t('integrations.search_keys', 'Search keys…')}
                className="intg-search-input"
              />
            </div>
          )}
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus width={16} height={16} /> {t('integrations.generate_key_btn')}
          </button>
        </div>
      </div>

      {/* ── New key banner ──────────────────────────────────── */}
      {newKey && (
        <div className="intg-key-banner">
          <div className="intg-key-banner-title"><CheckCircle width={17} height={17} /> {t('integrations.key_created_notice')}</div>
          <div className="intg-key-banner-row">
            <code className="intg-key-code">{newKey}</code>
            <button className={`intg-copy-btn${copied ? ' copied' : ''}`} onClick={() => copy(newKey)}>
              {copied ? <Check width={14} height={14} /> : <Copy width={14} height={14} />} {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
          <button className="intg-dismiss" onClick={() => setNewKey(null)}>{t('integrations.dismiss')}</button>
        </div>
      )}

      {/* ── Key list ────────────────────────────────────────── */}
      {loading ? <div className="loading-state">{t('common.loading')}</div>
       : keys.length === 0 ? (
        <div className="empty-state">
          <Key width={40} height={40} className="empty-state-icon" />
          <div className="empty-state-title">{t('integrations.no_keys')}</div>
          <div className="empty-state-sub">{t('integrations.api_keys_desc')}</div>
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => setShowCreate(true)}>
            <Plus width={14} height={14} /> {t('integrations.generate_key_btn')}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Search width={36} height={36} className="empty-state-icon" />
          <div className="empty-state-title">{t('integrations.no_search_results', 'No matching keys')}</div>
          <div className="empty-state-sub">{t('integrations.try_different_search', 'Try a different search term')}</div>
        </div>
      ) : (
        <div className="intg-keys-list">
          {filtered.map(k => {
            const perm = PERM_META[permLevel(k.permissions)] || PERM_META.read;
            const PermIcon = perm.icon;
            const isExpired = k.expires_at && new Date(k.expires_at) < new Date();
            const isExpanded = expandedId === k.id;

            return (
              <div key={k.id} className={`intg-key-card${!k.is_active ? ' revoked' : ''}${isExpired ? ' expired' : ''}`}>
                <div className="intg-key-card-top" onClick={() => setExpandedId(isExpanded ? null : k.id)}>
                  <div className="intg-key-card-icon" style={{ background: k.is_active ? perm.bg : '#f1f5f9', color: k.is_active ? perm.color : '#94a3b8' }}>
                    <PermIcon width={20} height={20} />
                  </div>
                  <div className="intg-key-card-info">
                    <div className="intg-key-card-name">
                      {k.name}
                      {!k.is_active && <span className="intg-key-badge-revoked">{t('integrations.revoked')}</span>}
                      {isExpired && k.is_active && <span className="intg-key-badge-expired">{t('integrations.expired', 'Expired')}</span>}
                    </div>
                    {k.description && <div className="intg-key-card-desc">{k.description}</div>}
                    <div className="intg-key-card-meta">
                      <code className="intg-key-preview">{k.key_preview || '••••••'}</code>
                      <span className="intg-key-perm-badge" style={{ background: perm.bg, color: perm.color }}>{t(perm.label)}</span>
                      {k.expires_at && (
                        <span className={`intg-key-meta-item${isExpired ? ' expired' : ''}`}>
                          <Clock width={12} height={12} /> {isExpired ? t('integrations.expired', 'Expired') : t('integrations.expires_on', 'Expires')} {fmtDate(k.expires_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="intg-key-card-stats">
                    <div className="intg-key-stat">
                      <div className="intg-key-stat-value">{(k.request_count || 0).toLocaleString()}</div>
                      <div className="intg-key-stat-label">{t('integrations.requests', 'Requests')}</div>
                    </div>
                    <div className="intg-key-stat">
                      <div className="intg-key-stat-value">{timeAgo(k.last_used_at) || t('integrations.never_used', 'Never')}</div>
                      <div className="intg-key-stat-label">{t('integrations.last_used', 'Last Used')}</div>
                    </div>
                  </div>
                </div>

                {/* ── Expanded details ──────────────────────── */}
                {isExpanded && (
                  <div className="intg-key-card-expanded">
                    <div className="intg-key-detail-grid">
                      <div className="intg-key-detail">
                        <span className="intg-key-detail-label">{t('integrations.col.created', 'Created')}</span>
                        <span>{fmtDate(k.created_at)}</span>
                      </div>
                      <div className="intg-key-detail">
                        <span className="intg-key-detail-label">{t('integrations.col.permissions', 'Permissions')}</span>
                        <span>{perm.scopes}</span>
                      </div>
                      <div className="intg-key-detail">
                        <span className="intg-key-detail-label">{t('integrations.last_ip', 'Last IP')}</span>
                        <span>{k.last_used_ip || '—'}</span>
                      </div>
                      <div className="intg-key-detail">
                        <span className="intg-key-detail-label">{t('integrations.col.expires', 'Expires')}</span>
                        <span>{k.expires_at ? fmtDate(k.expires_at) : t('integrations.expires_never')}</span>
                      </div>
                    </div>
                    <div className="intg-key-card-actions">
                      <button className="btn-ghost-sm" onClick={(e) => { e.stopPropagation(); setEditKey(k); setEditForm({ name: k.name, description: k.description || '' }); }}>
                        <EditPencil width={13} height={13} /> {t('common.edit', 'Edit')}
                      </button>
                      {isAdmin && <button className="btn-ghost-sm" onClick={(e) => { e.stopPropagation(); api.patch(`/integrations/${k.id}/toggle`).then(load); }}>
                        {k.is_active ? t('integrations.revoke') : t('integrations.enable')}
                      </button>}
                      {isAdmin && <button className="btn-ghost-sm intg-btn-regen" onClick={(e) => { e.stopPropagation(); setRegenConfirm(k.id); }}>
                        <RefreshDouble width={13} height={13} /> {t('integrations.regenerate', 'Regenerate')}
                      </button>}
                      {isAdmin && <button className="btn-danger-sm" onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(t('integrations.delete_key_confirm'))) return;
                        setError(null);
                        const res = await api.delete(`/integrations/${k.id}`);
                        if (res.success) load();
                        else setError(res.message || 'Failed to delete API key');
                      }}>
                        <Trash width={13} height={13} /> {t('common.delete', 'Delete')}
                      </button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Modal ────────────────────────────────────── */}
      {showCreate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal-box intg-create-modal">
            <div className="modal-header">
              <div>
                <h3>{t('integrations.generate_key')}</h3>
                <p className="modal-header-sub">{t('integrations.generate_key_subtitle', 'Create a new API key for external integrations')}</p>
              </div>
              <button className="modal-close" onClick={() => setShowCreate(false)}><Xmark width={16} height={16} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>{t('integrations.form.key_name')}</label>
                <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('integrations.form.key_name_placeholder')} className="form-input" maxLength={100} />
              </div>
              <div className="form-group">
                <label>{t('integrations.form.description', 'Description (optional)')}</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder={t('integrations.description_placeholder_key', 'e.g. Used by Shopify order sync')} className="form-input" maxLength={500} />
              </div>

              {/* ── Permission cards ─────────────────────── */}
              <div className="form-group">
                <label>{t('integrations.form.permissions')}</label>
                <div className="intg-perm-cards">
                  {Object.entries(PERM_META).map(([key, meta]) => {
                    const Icon = meta.icon;
                    return (
                      <label key={key} className={`intg-perm-card${form.permissions === key ? ' selected' : ''}`}
                        style={{ '--perm-color': meta.color, '--perm-bg': meta.bg }}>
                        <input type="radio" name="permissions" value={key} checked={form.permissions === key}
                          onChange={() => setForm(f => ({ ...f, permissions: key }))} />
                        <div className="intg-perm-card-icon" style={{ background: meta.bg, color: meta.color }}>
                          <Icon width={18} height={18} />
                        </div>
                        <div className="intg-perm-card-text">
                          <strong>{t(meta.label)}</strong>
                          <span>{meta.scopes}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label>{t('integrations.form.expires_at')}</label>
                <input type="date" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                  className="form-input" min={new Date().toISOString().split('T')[0]} />
                <span className="form-hint">{t('integrations.expires_hint', 'Leave empty for a non-expiring key')}</span>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? t('integrations.generating') : <><Key width={14} height={14} /> {t('integrations.generate_key_btn')}</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Modal ──────────────────────────────────────── */}
      {editKey && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditKey(null)}>
          <div className="modal-box">
            <div className="modal-header">
              <h3>{t('integrations.edit_key', 'Edit API Key')}</h3>
              <button className="modal-close" onClick={() => setEditKey(null)}><Xmark width={16} height={16} /></button>
            </div>
            <form onSubmit={handleEdit}>
              <div className="form-group">
                <label>{t('integrations.form.key_name')}</label>
                <input required value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="form-input" maxLength={100} />
              </div>
              <div className="form-group">
                <label>{t('integrations.form.description', 'Description (optional)')}</label>
                <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className="form-input" maxLength={500}
                  placeholder={t('integrations.description_placeholder_key', 'e.g. Used by Shopify order sync')} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-ghost" onClick={() => setEditKey(null)}>{t('common.cancel')}</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('integrations.saving') : t('common.save', 'Save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Regenerate Confirm ──────────────────────────────── */}
      {regenConfirm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setRegenConfirm(null)}>
          <div className="modal-box intg-confirm-modal">
            <div className="intg-confirm-icon"><WarningTriangle width={32} height={32} /></div>
            <h3>{t('integrations.regenerate_confirm_title', 'Regenerate API Key?')}</h3>
            <p>{t('integrations.regenerate_confirm_desc', 'The current key will stop working immediately. Any integrations using this key will break until they are updated with the new key.')}</p>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setRegenConfirm(null)}>{t('common.cancel')}</button>
              <button className="btn-danger" onClick={() => handleRegenerate(regenConfirm)}>
                <RefreshDouble width={14} height={14} /> {t('integrations.regenerate', 'Regenerate')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WebhooksTab() {
  const { t } = useTranslation();
  const [webhooks,   setWebhooks]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showModal,  setShowModal]  = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [form,       setForm]       = useState({ name:'', url:'', description:'', events:[] });
  const [saving,     setSaving]     = useState(false);
  const [testing,    setTesting]    = useState(null);
  const [testResult, setTestResult] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get('/webhooks');
    if (res.success) setWebhooks(res.data || []);
    else setWebhooks([]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm({name:'',url:'',description:'',events:[]}); setEditId(null); setShowModal(true); };
  const openEdit   = wh => { setForm({name:wh.name,url:wh.url,description:wh.description||'',events:wh.events||[]}); setEditId(wh.id); setShowModal(true); };

  const handleSave = async e => {
    e.preventDefault(); setSaving(true);
    const res = editId ? await api.put(`/webhooks/${editId}`, form) : await api.post('/webhooks', form);
    if (res.success) { setShowModal(false); load(); }
    setSaving(false);
  };

  const toggle    = async id => { await api.patch(`/webhooks/${id}/toggle`); load(); };
  const del       = async id => { if(!confirm(t('integrations.delete_webhook_confirm')))return; await api.delete(`/webhooks/${id}`); load(); };

  const testPing  = async id => {
    setTesting(id);
    const res = await api.post(`/webhooks/${id}/test`);
    setTestResult(r => ({ ...r, [id]: res.data || res }));
    setTesting(null);
  };

  const toggleEvent = ev => setForm(f => ({
    ...f, events: f.events.includes(ev) ? f.events.filter(e=>e!==ev) : [...f.events, ev],
  }));

  const toggleGroup = evts => setForm(f => {
    const all = evts.every(e => f.events.includes(e));
    return { ...f, events: all ? f.events.filter(e=>!evts.includes(e)) : [...new Set([...f.events,...evts])] };
  });

  return (
    <div>
      <div className="intg-section-header">
        <div>
          <h3 className="intg-section-title">{t('integrations.webhooks_title')}</h3>
          <p className="intg-section-sub">{t('integrations.webhooks_sub')}</p>
        </div>
        <button className="btn-primary" onClick={openCreate}><Plus width={16} height={16} /> {t('integrations.add_endpoint')}</button>
      </div>
      {loading ? <div className="loading-state">{t('common.loading')}</div>
       : webhooks.length === 0 ? (
        <div className="empty-state">
          <Network width={42} height={42} className="empty-state-icon" />
          <div className="empty-state-title">{t("integrations.no_webhooks")}</div>
          <div className="empty-state-sub">{t('integrations.no_webhooks_hint')}</div>
          <button className="btn-primary" style={{marginTop:16}} onClick={openCreate}><Plus width={14} height={14} /> {t('integrations.add_first_endpoint')}</button>
        </div>
      ) : (
        <div className="intg-webhook-list">
          {webhooks.map(wh => (
            <div key={wh.id} className={`intg-webhook-card${!wh.is_active?' inactive':''}`}>
              <div className="intg-webhook-top">
                <div className="intg-webhook-info">
                  <div className="intg-webhook-name">{wh.name}</div>
                  <a href={wh.url} target="_blank" rel="noreferrer" className="intg-webhook-url">
                    {trunc(wh.url,65)} <ArrowUpRight width={11} height={11} />
                  </a>
                  {wh.description && <div className="intg-webhook-desc">{wh.description}</div>}
                </div>
                <div className="intg-webhook-meta">
                  {wh.failure_count > 0 && <span className="badge badge-red">{t('integrations.failures_count', {count: wh.failure_count})}</span>}
                  <span className={`badge ${wh.is_active?'badge-green':'badge-gray'}`}>{wh.is_active?t('integrations.active'):t('integrations.paused')}</span>
                </div>
              </div>
              <div className="intg-webhook-events">
                {(wh.events||[]).map(ev=><span key={ev} className="intg-event-chip">{ev}</span>)}
                {(!wh.events||!wh.events.length)&&<span className="td-secondary" style={{fontSize:12}}>{t("integrations.no_events")}</span>}
              </div>
              {wh.last_fired_at && <div className="intg-webhook-last">{t('integrations.last_fired')}{fmtTime(wh.last_fired_at)}</div>}
              {testResult[wh.id] && (
                <div className={`intg-test-result ${testResult[wh.id].status==='sent'?'success':'fail'}`}>
                  {testResult[wh.id].status==='sent'
                    ? t('integrations.test_sent_success', {status: testResult[wh.id].httpStatus, ms: testResult[wh.id].durationMs})
                    : t('integrations.test_failed_result', {response: testResult[wh.id].response || t('integrations.no_response')})}
                </div>
              )}
              <div className="intg-webhook-actions">
                <button className="btn-ghost-sm" onClick={()=>testPing(wh.id)} disabled={testing===wh.id}>
                  <RefreshDouble width={13} height={13} /> {testing===wh.id?t('integrations.testing'):t('integrations.test_ping')}
                </button>
                <button className="btn-ghost-sm" onClick={()=>openEdit(wh)}>{t('common.edit')}</button>
                <button className="btn-ghost-sm" onClick={()=>toggle(wh.id)}>{wh.is_active?t('integrations.pause'):t('integrations.activate')}</button>
                <button className="btn-danger-sm" onClick={()=>del(wh.id)}><Trash width={13} height={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal-box modal-lg">
            <div className="modal-header">
              <h3>{editId?t('integrations.modal.edit_webhook'):t('integrations.modal.add_webhook')}</h3>
              <button className="modal-close" onClick={()=>setShowModal(false)}><Xmark width={16} height={16} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>{t('integrations.form.endpoint_name')}</label>
                  <input required value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder={t('integrations.endpoint_name_placeholder')} className="form-input" />
                </div>
                <div className="form-group">
                  <label>{t('integrations.form.endpoint_url')}</label>
                  <input required type="url" value={form.url} onChange={e=>setForm(f=>({...f,url:e.target.value}))} placeholder={t('integrations.endpoint_url_placeholder')} className="form-input" />
                </div>
                <div className="form-group" style={{gridColumn:'1/-1'}}>
                  <label>{t('integrations.form.description')}</label>
                  <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder={t('integrations.description_placeholder')} className="form-input" />
                </div>
              </div>
              <div className="form-group">
                <label>{t("integrations.subscribe_events")}</label>
                <div className="intg-event-groups">
                  {Object.entries(EVENT_GROUPS).map(([group, evts]) => (
                    <div key={group} className="intg-event-group">
                      <div className="intg-event-group-header" onClick={()=>toggleGroup(evts)}>
                        <span className="intg-event-group-name">{t(`integrations.${group.toLowerCase().replace(/\s/g, '_')}`)}</span>
                        <span className="intg-event-group-sel">{evts.filter(e=>form.events.includes(e)).length}/{evts.length}</span>
                      </div>
                      <div className="intg-event-checkboxes">
                        {evts.map(ev=>(
                          <label key={ev} className="intg-event-check">
                            <input type="checkbox" checked={form.events.includes(ev)} onChange={()=>toggleEvent(ev)} />
                            <span>{ev}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="form-hint"><Lock width={12} height={12} /> {t('integrations.hmac_hint')}</div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-ghost" onClick={()=>setShowModal(false)}>{t("common.cancel")}</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving?t('integrations.saving'):editId?t('integrations.update_webhook'):t('integrations.create_webhook')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryLogTab() {
  const { t } = useTranslation();
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [fStatus,  setFStatus]  = useState('');
  const [fEvent,   setFEvent]   = useState('');
  const [retrying, setRetrying] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page, limit: 50 });
    if (fStatus) p.set('status', fStatus);
    if (fEvent)  p.set('event',  fEvent);
    const res = await api.get(`/webhooks/deliveries?${p}`);
    if (res.success) { setRows(res.data||[]); setTotal(res.total||0); }
    else setRows([]);
    setLoading(false);
  }, [page, fStatus, fEvent]);

  useEffect(() => { load(); }, [load]);

  const retry = async id => { setRetrying(id); await api.post(`/webhooks/retry/${id}`); setRetrying(null); load(); };

  return (
    <div>
      <div className="intg-section-header">
        <div>
          <h3 className="intg-section-title">{t('integrations.delivery_log_title')}</h3>
          <p className="intg-section-sub">{t('integrations.deliveries_total', {count: total})}</p>
        </div>
        <div className="filter-row">
          <select value={fStatus} onChange={e=>{setFStatus(e.target.value);setPage(1);}} className="form-select-sm">
            <option value="">{t('integrations.all_status')}</option>
            <option value="sent">{t("integrations.sent")}</option>
            <option value="failed">{t('integrations.failed')}</option>
          </select>
          <input value={fEvent} onChange={e=>{setFEvent(e.target.value);setPage(1);}} placeholder={t('integrations.filter_events')} className="form-input-sm" />
        </div>
      </div>
      {loading ? <div className="loading-state">{t('common.loading')}</div>
       : rows.length === 0 ? (
        <div className="empty-state">
          <DataTransferBoth width={40} height={40} className="empty-state-icon" />
          <div className="empty-state-title">{t('integrations.no_deliveries')}</div>
          <div className="empty-state-sub">{t('integrations.no_deliveries_hint')}</div>
        </div>
      ) : (
        <div className="data-card">
          <table className="data-table">
            <thead><tr>{[t('integrations.col.event'),t('integrations.col.endpoint'),t('integrations.col.status'),t('integrations.col.http'),t('integrations.col.duration'),t('integrations.col.attempt'),t('integrations.col.time'),''].map((h,i)=><th key={i}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => {
                const sb = STATUS_BADGE[r.status]||STATUS_BADGE.pending;
                return (
                  <tr key={r.id}>
                    <td><span className="intg-event-chip">{r.event}</span></td>
                    <td>
                      <div className="td-primary">{r.endpoint_name||'—'}</div>
                      <div className="td-secondary">{trunc(r.url,42)}</div>
                    </td>
                    <td><span className="badge" style={{background:sb.bg,color:sb.color}}>{t(sb.labelKey)}</span></td>
                    <td className="td-secondary">{r.http_status||'—'}</td>
                    <td className="td-secondary">{r.duration_ms!=null?`${r.duration_ms}ms`:'—'}</td>
                    <td className="td-secondary">{r.attempt}</td>
                    <td className="td-secondary">{fmtTime(r.completed_at||r.created_at)}</td>
                    <td>{r.status==='failed'&&<button className="btn-ghost-sm" disabled={retrying===r.id} onClick={()=>retry(r.id)}><RefreshDouble width={12} height={12}/>{retrying===r.id?'…':t('common.retry')}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total>50&&(
            <div className="pagination-bar">
              <button className="btn-ghost-sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>{t('integrations.prev')}</button>
              <span className="td-secondary">{t('integrations.page_info', {page, total: Math.ceil(total/50)})}</span>
              <button className="btn-ghost-sm" disabled={rows.length<50} onClick={()=>setPage(p=>p+1)}>{t("common.next")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function APIDocsTab() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState([]);
  const [selectedKey, setSelectedKey] = useState('YOUR_API_KEY');
  const [copiedIdx, setCopiedIdx] = useState(null);

  useEffect(() => {
    api.get('/integrations').then(res => {
      if (res.success && res.data?.length) {
        setKeys(res.data);
        const active = res.data.find(k => k.is_active);
        if (active?.api_key) setSelectedKey(active.api_key.slice(0, 22) + '…');
      }
    });
  }, []);

  const baseUrl = window.location.origin + '/api/v1';

  const copySnippet = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const ENDPOINTS = [
    {
      method: 'GET', path: '/work-orders', title: t('integrations.docs.list_orders', 'List WorkOrders'),
      desc: t('integrations.docs.list_orders_desc', 'Fetch orders with pagination and optional filters.'),
      perms: 'orders:read',
      params: 'page, limit, status, from, to, service_status_token',
      curl: `curl -s "${baseUrl}/work-orders?limit=10&status=pending" \\\n  -H "X-API-Key: ${selectedKey}"`,
    },
    {
      method: 'GET', path: '/work-orders/:id', title: t('integrations.docs.get_order', 'Get WorkOrder'),
      desc: t('integrations.docs.get_order_desc', 'Fetch a single order by ID or tracking token. Includes status history.'),
      perms: 'orders:read',
      curl: `curl -s "${baseUrl}/work-orders/123" \\\n  -H "X-API-Key: ${selectedKey}"`,
    },
    {
      method: 'POST', path: '/work-orders', title: t('integrations.docs.create_order', 'Create WorkOrder'),
      desc: t('integrations.docs.create_order_desc', 'Create a new delivery order. Required fields: recipient_name, recipient_phone, recipient_address.'),
      perms: 'orders:write',
      curl: `curl -s "${baseUrl}/work-orders" \\\n  -X POST \\\n  -H "X-API-Key: ${selectedKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "recipient_name": "Ahmed Ali",\n    "recipient_phone": "0501234567",\n    "recipient_address": "Downtown Dubai, Tower 1",\n    "payment_method": "cod",\n    "cash_amount": 150,\n    "service_fee": 25\n  }'`,
    },
    {
      method: 'PATCH', path: '/work-orders/:id/cancel', title: t('integrations.docs.cancel_order', 'Cancel WorkOrder'),
      desc: t('integrations.docs.cancel_order_desc', 'Cancel a pending/confirmed order. Cannot cancel orders already in transit or delivered.'),
      perms: 'orders:write',
      curl: `curl -s "${baseUrl}/work-orders/123/cancel" \\\n  -X PATCH \\\n  -H "X-API-Key: ${selectedKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"reason": "Customer requested cancellation"}'`,
    },
    {
      method: 'GET', path: '/service-status/:token', title: t('integrations.docs.track_order', 'Track WorkOrder'),
      desc: t('integrations.docs.track_order_desc', 'Track an order by its tracking token. WarrantyClaims current status and full status history.'),
      perms: 'tracking:read',
      curl: `curl -s "${baseUrl}/service-status/TR0B64E7E75FBF" \\\n  -H "X-API-Key: ${selectedKey}"`,
    },
    {
      method: 'GET', path: '/customers', title: t('integrations.docs.list_customers', 'List Customers'),
      desc: t('integrations.docs.list_customers_desc', 'List all merchant customers. Useful for getting customer_id to associate with orders.'),
      perms: 'customers:read',
      curl: `curl -s "${baseUrl}/customers" \\\n  -H "X-API-Key: ${selectedKey}"`,
    },
  ];

  const METHOD_COLORS = { GET: '#16a34a', POST: '#2563eb', PATCH: '#d97706', DELETE: '#dc2626' };

  return (
    <div className="intg-docs">
      <div className="intg-section-header">
        <div>
          <h3 className="intg-section-title">{t('integrations.docs.title', 'API Documentation')}</h3>
          <p className="intg-section-sub">{t('integrations.docs.subtitle', 'Integrate with the Pioneer API using your API keys.')}</p>
        </div>
      </div>

      {/* Auth Info */}
      <div className="data-card" style={{marginBottom: 20, padding: 20}}>
        <h4 style={{margin: '0 0 12px', fontWeight: 600}}>{t('integrations.docs.authentication', 'Authentication')}</h4>
        <p style={{margin: '0 0 12px', color: '#64748b', fontSize: 14}}>
          {t('integrations.docs.auth_desc', 'Include your API key in every request using one of these headers:')}
        </p>
        <div style={{display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16}}>
          <code className="intg-docs-code-inline">X-API-Key: td_XXXXXXXXXXXX</code>
          <span style={{color: '#94a3b8', alignSelf: 'center'}}>{t('common.or', 'or')}</span>
          <code className="intg-docs-code-inline">Authorization: Bearer td_XXXXXXXXXXXX</code>
        </div>
        <div style={{display: 'flex', gap: 16, flexWrap: 'wrap'}}>
          <div className="intg-docs-perm-card">
            <strong>read</strong>
            <span>orders:read, tracking:read</span>
          </div>
          <div className="intg-docs-perm-card">
            <strong>write</strong>
            <span>orders:read, orders:write, tracking:read</span>
          </div>
          <div className="intg-docs-perm-card">
            <strong>full</strong>
            <span>All permissions including customers &amp; webhooks</span>
          </div>
        </div>
      </div>

      {/* Base URL */}
      <div className="data-card" style={{marginBottom: 20, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <div>
          <span style={{fontSize: 13, color: '#64748b'}}>{t('integrations.docs.base_url', 'Base URL')}</span>
          <code style={{display: 'block', fontSize: 15, fontWeight: 600, marginTop: 4}}>{baseUrl}</code>
        </div>
        <button className="btn-ghost-sm" onClick={() => copySnippet(baseUrl, 'base')}>
          {copiedIdx === 'base' ? <Check width={14}/> : <Copy width={14}/>}
        </button>
      </div>

      {/* Rate Limits */}
      <div className="data-card" style={{marginBottom: 20, padding: '14px 20px'}}>
        <span style={{fontSize: 13, color: '#64748b'}}>{t('integrations.docs.rate_limits', 'Rate Limits')}</span>
        <p style={{margin: '6px 0 0', fontSize: 14}}>500 {t('integrations.docs.requests_per', 'requests per')} 15 {t('integrations.docs.minutes', 'minutes')}</p>
      </div>

      {/* Endpoints */}
      <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
        {ENDPOINTS.map((ep, idx) => (
          <div key={idx} className="data-card" style={{padding: 0, overflow: 'hidden'}}>
            <div style={{padding: '16px 20px', borderBottom: '1px solid #f1f5f9'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8}}>
                <span className="intg-docs-method" style={{background: METHOD_COLORS[ep.method] + '18', color: METHOD_COLORS[ep.method]}}>{ep.method}</span>
                <code style={{fontSize: 14, fontWeight: 600}}>{ep.path}</code>
                <span className="badge badge-blue" style={{fontSize: 11, marginLeft: 'auto'}}>{ep.perms}</span>
              </div>
              <h4 style={{margin: '0 0 4px', fontWeight: 600, fontSize: 15}}>{ep.title}</h4>
              <p style={{margin: 0, color: '#64748b', fontSize: 13}}>{ep.desc}</p>
              {ep.params && <p style={{margin: '8px 0 0', fontSize: 12, color: '#94a3b8'}}>Params: {ep.params}</p>}
            </div>
            <div style={{position: 'relative', background: '#1e293b', padding: '14px 20px', borderRadius: '0 0 12px 12px'}}>
              <button className="intg-copy-btn" style={{position: 'absolute', top: 10, right: 14, background: 'rgba(255,255,255,0.1)', color: '#fff'}}
                onClick={() => copySnippet(ep.curl, idx)}>
                {copiedIdx === idx ? <Check width={13}/> : <Copy width={13}/>}
              </button>
              <pre style={{margin: 0, color: '#e2e8f0', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', paddingRight: 40}}>{ep.curl}</pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TABS = [
  { id:'api-keys', labelKey:'integrations.api_keys',         icon: Key },
  { id:'webhooks', labelKey:'integrations.tab_webhooks',     icon: Network },
  { id:'log',      labelKey:'integrations.tab_delivery_log', icon: DataTransferBoth },
  { id:'docs',     labelKey:'integrations.tab_api_docs',     icon: Book },
];

export default function Integrations() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('api-keys');
  return (
    <div className="page-container">
      <div className="module-hero">
        <div className="module-hero-left">
          <h2 className="module-hero-title">{t("integrations.title")}</h2>
          <p className="module-hero-sub">{t("integrations.subtitle")}</p>
        </div>
      </div>
      <div className="intg-tab-bar">
        {TABS.map(item => (
          <button key={item.id} className={`intg-tab-btn${tab===item.id?' active':''}`} onClick={()=>setTab(item.id)}>
            <item.icon width={15} height={15} /> {t(item.labelKey)}
          </button>
        ))}
      </div>
      <div className="intg-tab-body">
        {tab==='api-keys' && <APIKeysTab />}
        {tab==='webhooks' && <WebhooksTab />}
        {tab==='log'      && <DeliveryLogTab />}
        {tab==='docs'     && <APIDocsTab />}
      </div>
    </div>
  );
}
