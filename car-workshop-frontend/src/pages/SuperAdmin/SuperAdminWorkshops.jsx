import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Building, Search, Plus, Eye, User, Package,
  Refresh, Play, Pause, Xmark, WarningTriangle,
  CheckCircle, ViewGrid, List, Calendar, ArrowUp, ArrowDown,
  Activity, Mail, Clock, CreditCard, ArrowLeft, ArrowRight, Bell,
} from 'iconoir-react';
import avatarPlaceholder from '../../assets/images/PioneerLogos/avatar-placeholder.png';
import { useSAToast } from './SAToastContext';
import './SuperAdminModern.css';

const API = import.meta.env.VITE_API_URL || '/api';
const VIEW_KEY = 'sa.workshops.viewMode';

/* ── Status presentation map (covers all workshops.status + virtual past_due) ── */
const STATUS_META = {
  active:        { label: 'Active',        color: '#10b981', bg: '#ecfdf5' },
  trial:         { label: 'Trial',         color: '#f59e0b', bg: '#fffbeb' },
  trial_expired: { label: 'Trial Expired', color: '#ea580c', bg: '#fff7ed' },
  past_due:      { label: 'Past Due',      color: '#dc2626', bg: '#fef2f2' },
  suspended:     { label: 'Suspended',     color: '#ef4444', bg: '#fef2f2' },
  cancelled:     { label: 'Cancelled',     color: '#6b7280', bg: '#f3f4f6' },
  inactive:      { label: 'Inactive',      color: '#6b7280', bg: '#f3f4f6' },
};

const FILTER_CHIPS = [
  { key: 'all',           label: 'Total',         tone: 'default', icon: Building },
  { key: 'active',        label: 'Active',        tone: 'green',   icon: CheckCircle },
  { key: 'trial',         label: 'Trial',         tone: 'amber',   icon: Activity },
  { key: 'trial_expired', label: 'Trial Expired', tone: 'orange',  icon: Clock },
  { key: 'past_due',      label: 'Past Due',      tone: 'red',     icon: CreditCard },
  { key: 'suspended',     label: 'Suspended',     tone: 'red',     icon: WarningTriangle },
  { key: 'cancelled',     label: 'Cancelled',     tone: 'gray',    icon: Xmark },
];

const avatarColor = (name = '') => {
  const colors = ['#1e3a6b','#f94c29','#2d5a8c','#3a7bc8','#14284d','#e0380f','#4a7fa5','#c94420','#1e4d7a'];
  let h = 0; for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
};

const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  : '—';
const fmtMoney = (v, currency = 'AED') => v == null
  ? '—'
  : `${currency} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const StatusPill = ({ status }) => {
  const meta = STATUS_META[status] || { label: status || 'unknown', color: '#6b7280', bg: '#f3f4f6' };
  return <span className="sa-status-pill" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>;
};

/* ── Reusable confirm modal ────────────────────────────────────── */
function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel, busy }) {
  if (!open) return null;
  return (
    <div className="sa-modal-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="sa-modal-card" role="dialog" aria-modal="true" aria-labelledby="sa-modal-title">
        <div className="sa-modal-head">
          <h3 id="sa-modal-title">{title}</h3>
          <button className="sa-modal-close" onClick={onCancel} disabled={busy} aria-label="Close"><Xmark size={18} /></button>
        </div>
        <div className="sa-modal-body">{typeof message === 'string' ? <p>{message}</p> : message}</div>
        <div className="sa-modal-foot">
          <button className="sa-btn sa-btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className={`sa-btn ${danger ? 'sa-btn-danger' : 'sa-btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const SuperAdminWorkshops = () => {
  const showToast = useSAToast();
  const [params, setParams] = useSearchParams();

  const [workshops, setWorkshops] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, trial: 0, trial_expired: 0, past_due: 0, suspended: 0, cancelled: 0 });
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [actionWorkshop, setActionWorkshop] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [busyById, setBusyById] = useState({});

  const search = params.get('q') || '';
  const statusFilter = params.get('status') || 'all';
  const sortBy = params.get('sort') || 'created_at';
  const sortDir = params.get('dir') || 'desc';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(VIEW_KEY) || 'grid');

  useEffect(() => { localStorage.setItem(VIEW_KEY, viewMode); }, [viewMode]);

  /* ── Debounced search input → URL ── */
  const [searchInput, setSearchInput] = useState(search);
  const debounceRef = useRef();
  useEffect(() => { setSearchInput(search); }, [search]);
  const onSearchChange = (val) => {
    setSearchInput(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (val) next.set('q', val); else next.delete('q');
      next.set('page', '1');
      setParams(next, { replace: true });
    }, 300);
  };

  const updateParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value == null || value === '' || value === 'all') next.delete(key);
    else next.set(key, String(value));
    if (key !== 'page') next.set('page', '1');
    setParams(next, { replace: false });
  };

  const fetchWorkshops = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('superAdminToken');
      const qs = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') qs.set('status', statusFilter);
      if (search) qs.set('q', search);
      qs.set('page', String(page));
      qs.set('limit', String(limit));
      qs.set('sort_by', sortBy);
      qs.set('sort_dir', sortDir);

      const r = await fetch(`${API}/super-admin/workshops?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setWorkshops(d.workshops || []);
      if (d.stats) setStats(d.stats);
      if (d.pagination) setPagination(d.pagination);
    } catch (err) {
      setWorkshops([]);
      showToast('Failed to load workshops', 'error');
    }
    setLoading(false);
  }, [statusFilter, search, page, limit, sortBy, sortDir, showToast]);

  useEffect(() => { fetchWorkshops(); }, [fetchWorkshops]);

  /* ── Workshop actions ── */
  const callWorkshopAction = async (id, path, body, successMsg) => {
    setBusyById(prev => ({ ...prev, [id]: true }));
    try {
      const token = localStorage.getItem('superAdminToken');
      const r = await fetch(`${API}/super-admin/workshops/${id}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && (d.success || d.message)) {
        showToast(d.message || successMsg);
        return true;
      }
      showToast(d.error || d.message || 'Action failed', 'error');
      return false;
    } catch {
      showToast('Network error', 'error');
      return false;
    } finally {
      setBusyById(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  const requestToggleStatus = (t) => {
    const newStatus = t.status === 'active' ? 'suspended' : 'active';
    if (newStatus === 'active') {
      doToggleStatus(t.id, newStatus);
      return;
    }
    setActionWorkshop({
      title: 'Suspend workshop?',
      message: `${t.name || 'This workshop'} will be suspended. All non-admin users will be deactivated and their subscription paused. You can reactivate later.`,
      confirmLabel: 'Suspend',
      danger: true,
      run: () => doToggleStatus(t.id, newStatus),
    });
  };

  const doToggleStatus = async (id, status) => {
    const ok = await callWorkshopAction(id, '/toggle-status', { status }, `Workshop ${status === 'active' ? 'activated' : 'suspended'}`);
    if (ok) fetchWorkshops();
  };

  const requestSendReminder = (t) => {
    setActionWorkshop({
      title: 'Send payment reminder?',
      message: `An email will be sent to ${t.email || 'the workshop owner'} asking them to update their payment method.`,
      confirmLabel: 'Send reminder',
      run: async () => { await callWorkshopAction(t.id, '/send-payment-reminder', null, 'Reminder sent'); },
    });
  };

  const requestExtendTrial = (t) => {
    setActionWorkshop({
      title: 'Extend trial by 7 days?',
      message: `Add 7 days to ${t.name || 'this workshop'}'s trial period.`,
      confirmLabel: 'Extend by 7 days',
      run: async () => {
        const ok = await callWorkshopAction(t.id, '/extend-trial', { days: 7 }, 'Trial extended by 7 days');
        if (ok) fetchWorkshops();
      },
    });
  };

  const runAction = async () => {
    if (!actionWorkshop) return;
    setActionBusy(true);
    try { await actionWorkshop.run(); }
    finally {
      setActionBusy(false);
      setActionWorkshop(null);
    }
  };

  /* ── Sorting ── */
  const toggleSort = (field) => {
    const next = new URLSearchParams(params);
    if (sortBy === field) next.set('dir', sortDir === 'asc' ? 'desc' : 'asc');
    else { next.set('sort', field); next.set('dir', 'asc'); }
    setParams(next, { replace: true });
  };
  const sortIndicator = (field) => sortBy === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const totalForChip = (key) => key === 'all' ? stats.total : (stats[key] ?? 0);

  return (
    <div className="sa-modern-page">
      {/* Page Header */}
      <div className="sa-page-header-row">
        <div>
          <h1 className="sa-page-title">Workshops</h1>
          <p className="sa-page-subtitle">Manage all platform workshops and their subscriptions</p>
        </div>
        <div className="sa-header-actions">
          <button className="sa-btn sa-btn-outline" onClick={fetchWorkshops} disabled={loading}>
            <Refresh size={16} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
          <Link to="/super-admin/onboarding" className="sa-btn sa-btn-primary"><Plus size={16} /> New Workshop</Link>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="sa-stats-bar">
        {FILTER_CHIPS.map(({ key, label, tone, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`sa-stat-chip ${tone} ${statusFilter === key ? 'active' : ''}`}
            onClick={() => updateParam('status', key)}
            aria-pressed={statusFilter === key}
            title={`Filter by ${label}`}
          >
            <Icon size={18} />
            <span className="sa-stat-number">{totalForChip(key).toLocaleString()}</span>
            <span className="sa-stat-label">{label}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="sa-toolbar">
        <div className="sa-search-box">
          <Search size={18} />
          <input
            value={searchInput}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search by name, email, slug, domain…"
            aria-label="Search workshops"
          />
          {searchInput && (
            <button className="sa-search-clear" onClick={() => onSearchChange('')} aria-label="Clear search">
              <Xmark size={16} />
            </button>
          )}
        </div>
        <div className="sa-toolbar-right">
          <select className="sa-select" value={sortBy} onChange={e => updateParam('sort', e.target.value)} aria-label="Sort by">
            <option value="created_at">Date Created</option>
            <option value="name">Name</option>
            <option value="status">Status</option>
            <option value="updated_at">Last Updated</option>
          </select>
          <button
            className="sa-sort-toggle"
            onClick={() => updateParam('dir', sortDir === 'asc' ? 'desc' : 'asc')}
            aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
          >
            {sortDir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
          </button>
          <div className="sa-view-toggle" role="group" aria-label="View mode">
            <button
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              aria-label="Grid view"
            ><ViewGrid size={18} /></button>
            <button
              className={viewMode === 'table' ? 'active' : ''}
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              aria-label="Table view"
            ><List size={18} /></button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading && workshops.length === 0 ? (
        <div className="sa-skeleton-grid">
          {[...Array(6)].map((_, i) => <div key={i} className="sa-skeleton-card" />)}
        </div>
      ) : workshops.length === 0 ? (
        <div className="sa-empty">
          <Building size={48} />
          <h3>No workshops found</h3>
          <p>{search || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Onboard your first workshop to get started'}</p>
          {!search && statusFilter === 'all' && (
            <Link to="/super-admin/onboarding" className="sa-btn sa-btn-primary"><Plus size={16} /> Onboard Workshop</Link>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="sa-workshop-grid">
          {workshops.map(t => {
            const tName = t.name || t.company_name || 'Unnamed';
            const color = avatarColor(tName);
            const logoSrc = t.logo_url || avatarPlaceholder;
            const status = t.effective_status || t.status;
            const isPastDue = status === 'past_due';
            const isTrial = status === 'trial' || status === 'trial_expired';
            const isSuspended = status === 'suspended';
            const busy = !!busyById[t.id];
            return (
              <div key={t.id} className={`sa-workshop-card ${isPastDue ? 'is-past-due' : ''} ${isSuspended ? 'is-suspended' : ''}`}>
                <div className="sa-card-header-strip" style={{ background: `linear-gradient(135deg, ${color}18, ${color}08)` }}>
                  <img className="sa-card-avatar-img" src={logoSrc} alt="" />
                  <StatusPill status={status} />
                </div>
                <div className="sa-card-body">
                  <h3 className="sa-card-name" title={tName}>{tName}</h3>
                  <p className="sa-card-domain">
                    {t.subdomain ? `${t.subdomain}.pioneercarservice.com` : (t.domain || t.email || '—')}
                  </p>
                  {t.plan && (
                    <div className="sa-card-plan">
                      <span className="sa-plan-badge">{t.plan}</span>
                      {t.billing_cycle && <span className="sa-plan-cycle">{t.billing_cycle}</span>}
                      {t.billing_cycle === 'yearly'
                        ? (t.price_yearly && <span className="sa-plan-price">{fmtMoney(t.price_yearly, t.currency)}/yr</span>)
                        : (t.price_monthly && <span className="sa-plan-price">{fmtMoney(t.price_monthly, t.currency)}/mo</span>)
                      }
                    </div>
                  )}
                  <div className="sa-card-meta">
                    <span><User size={14} /> {t.user_count ?? 0} users</span>
                    <span><Package size={14} /> {t.module_count ?? 0} modules</span>
                  </div>
                  {(isPastDue || isTrial || isSuspended) && (
                    <div className="sa-card-billing-line">
                      {isPastDue && t.days_past_due > 0 && (
                        <span className="sa-billing-warn">⚠ {t.days_past_due}d past due</span>
                      )}
                      {isTrial && t.trial_ends_at && (
                        <span className="sa-billing-info">Trial ends {fmtDate(t.trial_ends_at)}</span>
                      )}
                      {!isTrial && !isPastDue && t.current_period_end && (
                        <span className="sa-billing-info">Next renewal {fmtDate(t.current_period_end)}</span>
                      )}
                    </div>
                  )}
                  <div className="sa-card-date"><Calendar size={14} /> Joined {fmtDate(t.created_at)}</div>
                </div>
                <div className="sa-card-actions">
                  <Link to={`/super-admin/workshops/${t.id}`} className="sa-btn-sm sa-btn-primary"><Eye size={14} /> View</Link>
                  <button
                    className="sa-btn-sm sa-btn-outline"
                    onClick={() => requestToggleStatus(t)}
                    disabled={busy}
                    title={t.status === 'active' ? 'Suspend workshop' : 'Activate workshop'}
                  >
                    {t.status === 'active' ? <><Pause size={14} /> Suspend</> : <><Play size={14} /> Activate</>}
                  </button>
                  {(isPastDue || status === 'trial_expired') && (
                    <button
                      className="sa-btn-sm sa-btn-outline"
                      onClick={() => requestSendReminder(t)}
                      disabled={busy}
                      title="Send payment reminder email"
                    ><Bell size={14} /> Remind</button>
                  )}
                  {status === 'trial' && (
                    <button
                      className="sa-btn-sm sa-btn-outline"
                      onClick={() => requestExtendTrial(t)}
                      disabled={busy}
                      title="Extend trial by 7 days"
                    ><Clock size={14} /> +7d</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sa-table-wrapper">
          <table className="sa-modern-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')} className="sortable">Workshop{sortIndicator('name')}</th>
                <th onClick={() => toggleSort('status')} className="sortable">Status{sortIndicator('status')}</th>
                <th>Plan</th>
                <th>Users</th>
                <th>Renewal / Trial</th>
                <th onClick={() => toggleSort('created_at')} className="sortable">Created{sortIndicator('created_at')}</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workshops.map(t => {
                const status = t.effective_status || t.status;
                const isPastDue = status === 'past_due';
                const isTrial = status === 'trial' || status === 'trial_expired';
                const busy = !!busyById[t.id];
                return (
                  <tr key={t.id} className={isPastDue ? 'row-past-due' : ''}>
                    <td>
                      <div className="sa-table-company">
                        <img
                          className="sa-table-avatar-img"
                          src={t.logo_url || avatarPlaceholder}
                          alt=""
                        />
                        <div>
                          <div className="sa-table-name-line">{t.name || 'Unnamed'}</div>
                          <div className="sa-table-sub-line">{t.subdomain ? `${t.subdomain}.pioneercarservice.com` : (t.email || '—')}</div>
                        </div>
                      </div>
                    </td>
                    <td><StatusPill status={status} /></td>
                    <td>
                      {t.plan ? (
                        <div className="sa-table-plan-cell">
                          <span className="sa-plan-badge">{t.plan}</span>
                          {t.billing_cycle && <span className="sa-table-meta">{t.billing_cycle}</span>}
                        </div>
                      ) : '—'}
                    </td>
                    <td>{t.user_count ?? 0}{t.max_users ? ` / ${t.max_users}` : ''}</td>
                    <td>
                      {isTrial && t.trial_ends_at
                        ? <span className="sa-table-meta">Trial ends {fmtDate(t.trial_ends_at)}</span>
                        : t.current_period_end
                          ? <span className="sa-table-meta">{fmtDate(t.current_period_end)}</span>
                          : '—'}
                      {isPastDue && t.days_past_due > 0 && (
                        <div className="sa-billing-warn" style={{ marginTop: 4 }}>{t.days_past_due}d past due</div>
                      )}
                    </td>
                    <td>{fmtDate(t.created_at)}</td>
                    <td className="sa-table-actions">
                      <Link to={`/super-admin/workshops/${t.id}`} className="sa-btn-icon" title="View"><Eye size={16} /></Link>
                      {(isPastDue || status === 'trial_expired') && (
                        <button className="sa-btn-icon" disabled={busy} onClick={() => requestSendReminder(t)} title="Send payment reminder"><Mail size={16} /></button>
                      )}
                      {status === 'trial' && (
                        <button className="sa-btn-icon" disabled={busy} onClick={() => requestExtendTrial(t)} title="Extend trial 7 days"><Clock size={16} /></button>
                      )}
                      <button
                        className="sa-btn-icon"
                        disabled={busy}
                        onClick={() => requestToggleStatus(t)}
                        title={t.status === 'active' ? 'Suspend' : 'Activate'}
                      >
                        {t.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="sa-pagination">
          <button
            className="sa-btn sa-btn-outline sa-btn-sm"
            disabled={page <= 1 || loading}
            onClick={() => updateParam('page', String(page - 1))}
          ><ArrowLeft size={14} /> Prev</button>
          <span className="sa-page-indicator">Page <strong>{pagination.page}</strong> of <strong>{pagination.total_pages}</strong></span>
          <button
            className="sa-btn sa-btn-outline sa-btn-sm"
            disabled={page >= pagination.total_pages || loading}
            onClick={() => updateParam('page', String(page + 1))}
          >Next <ArrowRight size={14} /></button>
          <select
            className="sa-select sa-select-sm"
            value={limit}
            onChange={(e) => updateParam('limit', e.target.value)}
            aria-label="Page size"
          >
            <option value="10">10 / page</option>
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
        </div>
      )}

      <div className="sa-results-footer">
        Showing <strong>{workshops.length}</strong> of <strong>{pagination.total.toLocaleString()}</strong> workshop(s)
        {statusFilter !== 'all' && <> · filter: <strong>{STATUS_META[statusFilter]?.label || statusFilter}</strong></>}
        {search && <> · search: <strong>“{search}”</strong></>}
      </div>

      <ConfirmModal
        open={!!actionWorkshop}
        title={actionWorkshop?.title}
        message={actionWorkshop?.message}
        confirmLabel={actionWorkshop?.confirmLabel}
        danger={actionWorkshop?.danger}
        busy={actionBusy}
        onCancel={() => setActionWorkshop(null)}
        onConfirm={runAction}
      />
    </div>
  );
};

export default SuperAdminWorkshops;
