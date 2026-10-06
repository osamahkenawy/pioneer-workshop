import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, Search, Calendar, Filter, Download, Refresh, User,
  Eye, Settings, Building, Trash, EditPencil, Package, CreditCard,
  Page, Megaphone, Flash, Mail, Sparks, ShareAndroid,
  ColorFilter, Label, Notes, Check,
} from 'iconoir-react';
import './SuperAdmin.css';

const API = import.meta.env.VITE_API_URL || '/api';

const ACTION_ICONS = {
  plan_created: <Package width={14} height={14} />, plan_updated: <Package width={14} height={14} />, plan_deleted: <Package width={14} height={14} />,
  subscription_updated: <CreditCard width={14} height={14} />, invoice_created: <Page width={14} height={14} />, invoice_updated: <Page width={14} height={14} />,
  announcement_created: <Megaphone width={14} height={14} />, announcement_updated: <Megaphone width={14} height={14} />, announcement_deleted: <Megaphone width={14} height={14} />,
  bulk_status_change: <Flash width={14} height={14} />, bulk_module_change: <Flash width={14} height={14} />, bulk_plan_change: <Flash width={14} height={14} />, bulk_workshop_delete: <Flash width={14} height={14} />,
  template_created: <Mail width={14} height={14} />, template_updated: <Mail width={14} height={14} />, template_deleted: <Mail width={14} height={14} />, template_test_sent: <Mail width={14} height={14} />,
  workshop_onboarded: <Sparks width={14} height={14} />, workshop_data_exported: <ShareAndroid width={14} height={14} />, workshops_csv_exported: <ShareAndroid width={14} height={14} />,
  audit_logs_exported: <ShareAndroid width={14} height={14} />, branding_updated: <ColorFilter width={14} height={14} />, branding_reset: <ColorFilter width={14} height={14} />,
  ticket_created: <Label width={14} height={14} />, ticket_updated: <Label width={14} height={14} />, ticket_reply_added: <Label width={14} height={14} />, ticket_deleted: <Label width={14} height={14} />,
  default: <Notes width={14} height={14} />
};

const ACTION_COLORS = {
  created: '#10b981', updated: '#3b82f6', deleted: '#ef4444',
  exported: '#8b5cf6', change: '#f59e0b', default: '#6b7280'
};

const getActionColor = (action) => {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action?.includes(key)) return color;
  }
  return ACTION_COLORS.default;
};

const SuperAdminAuditLog = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ actions: [], entityTypes: [] });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [page, filterAction, filterEntity, dateFrom, dateTo]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('superAdminToken');
      const params = new URLSearchParams({ page, limit: 50 });
      if (search) params.set('search', search);
      if (filterAction) params.set('action', filterAction);
      if (filterEntity) params.set('entity_type', filterEntity);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);

      const res = await fetch(`${API}/super-admin/audit-log?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setTotalPages(data.totalPages || 1);
        setFilters(data.filters || { actions: [], entityTypes: [] });
      }
    } catch (e) {
      console.error('Fetch audit logs error:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('superAdminToken');
      const res = await fetch(`${API}/super-admin/audit-log/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setStats(await res.json());
    } catch (_) {}
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchLogs();
  };

  const exportLogs = async () => {
    const token = localStorage.getItem('superAdminToken');
    const params = new URLSearchParams();
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    window.open(`${API}/super-admin/export/audit-logs?${params}&token=${token}`, '_blank');
  };

  const formatDate = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatAction = (action) => (action || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>Audit Log</h1>
          <p>Track all super admin actions and changes</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="sa-secondary-btn" onClick={exportLogs}>
            <Download size={16} /> Export
          </button>
          <button className="sa-primary-btn" onClick={() => { fetchLogs(); fetchStats(); }}>
            <Refresh size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="sa-stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="sa-stat-card">
            <div className="sa-stat-icon primary"><Activity size={22} /></div>
            <div className="sa-stat-content"><h3>{stats.today}</h3><p>Today</p></div>
          </div>
          <div className="sa-stat-card">
            <div className="sa-stat-icon info"><Calendar size={22} /></div>
            <div className="sa-stat-content"><h3>{stats.thisWeek}</h3><p>This Week</p></div>
          </div>
          <div className="sa-stat-card">
            <div className="sa-stat-icon success"><User size={22} /></div>
            <div className="sa-stat-content"><h3>{stats.byAdmin?.length || 0}</h3><p>Active Admins</p></div>
          </div>
          <div className="sa-stat-card">
            <div className="sa-stat-icon warning"><Eye size={22} /></div>
            <div className="sa-stat-content"><h3>{stats.byAction?.length || 0}</h3><p>Action Types</p></div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="sa-card" style={{ marginBottom: 20 }}>
        <div className="sa-filters-row">
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="sa-search-input" style={{ flex: 1, minWidth: 200 }}>
              <Search size={16} />
              <input
                type="text" placeholder="Search actions, admins..."
                value={search} onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1); }} className="sa-select">
              <option value="">All Actions</option>
              {filters.actions.map(a => <option key={a} value={a}>{formatAction(a)}</option>)}
            </select>
            <select value={filterEntity} onChange={e => { setFilterEntity(e.target.value); setPage(1); }} className="sa-select">
              <option value="">All Entities</option>
              {filters.entityTypes.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="sa-select" />
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="sa-select" />
            <button type="submit" className="sa-primary-btn" style={{ padding: '8px 16px' }}>
              <Filter size={16} /> Filter
            </button>
          </form>
        </div>
      </div>

      {/* Log Table */}
      <div className="sa-card">
        {loading ? (
          <div className="sa-loading-page"><div className="loading-spinner"></div></div>
        ) : logs.length === 0 ? (
          <div className="sa-empty-state">
            <Activity size={48} />
            <h3>No audit logs yet</h3>
            <p>Actions will appear here as they happen</p>
          </div>
        ) : (
          <div className="sa-table-container">
            <table className="sa-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th>Action</th>
                  <th>Admin</th>
                  <th>Entity</th>
                  <th>Details</th>
                  <th>IP</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} onClick={() => setSelectedLog(log)} style={{ cursor: 'pointer' }}>
                    <td>{log.id}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{ACTION_ICONS[log.action] || ACTION_ICONS.default}</span>
                        <span className="sa-badge-pill" style={{ background: `${getActionColor(log.action)}20`, color: getActionColor(log.action) }}>
                          {formatAction(log.action)}
                        </span>
                      </div>
                    </td>
                    <td><span className="sa-text-medium">{log.admin_name || 'System'}</span></td>
                    <td>
                      {log.entity_type && (
                        <span className="sa-badge-pill" style={{ background: '#f1f5f9', color: '#475569' }}>
                          {log.entity_type} {log.entity_id ? `#${log.entity_id}` : ''}
                        </span>
                      )}
                    </td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.details ? JSON.stringify(typeof log.details === 'string' ? JSON.parse(log.details) : log.details).substring(0, 50) : '—'}
                    </td>
                    <td><code style={{ fontSize: 12 }}>{log.ip_address || '—'}</code></td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{formatDate(log.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="sa-pagination">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="sa-pagination-btn">Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="sa-pagination-btn">Next</button>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="sa-modal-backdrop" onClick={() => setSelectedLog(null)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="sa-modal-header">
              <h2>Audit Log Detail #{selectedLog.id}</h2>
              <button className="sa-modal-close" onClick={() => setSelectedLog(null)}>×</button>
            </div>
            <div className="sa-modal-body">
              <div className="sa-detail-grid">
                <div className="sa-detail-row">
                  <label>Action</label>
                  <span className="sa-badge-pill" style={{ background: `${getActionColor(selectedLog.action)}20`, color: getActionColor(selectedLog.action) }}>
                    {ACTION_ICONS[selectedLog.action] || <Notes width={14} height={14} />} {formatAction(selectedLog.action)}
                  </span>
                </div>
                <div className="sa-detail-row"><label>Admin</label><span>{selectedLog.admin_name || 'System'}</span></div>
                <div className="sa-detail-row"><label>Entity</label><span>{selectedLog.entity_type} {selectedLog.entity_id ? `#${selectedLog.entity_id}` : ''}</span></div>
                <div className="sa-detail-row"><label>IP Address</label><span>{selectedLog.ip_address || '—'}</span></div>
                <div className="sa-detail-row"><label>Time</label><span>{formatDate(selectedLog.created_at)}</span></div>
                {selectedLog.user_agent && <div className="sa-detail-row"><label>User Agent</label><span style={{ fontSize: 12, wordBreak: 'break-all' }}>{selectedLog.user_agent}</span></div>}
                {selectedLog.details && (
                  <div className="sa-detail-row" style={{ flexDirection: 'column' }}>
                    <label>Details</label>
                    <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 200 }}>
                      {JSON.stringify(typeof selectedLog.details === 'string' ? JSON.parse(selectedLog.details) : selectedLog.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminAuditLog;
