import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Mail, Search, Refresh, Xmark, ArrowUp, ArrowDown,
  Eye, Archive, Trash, CheckCircle, Clock, ChatLines
} from 'iconoir-react';
import './SuperAdminModern.css';

import { useConfirm } from './components';
const API = import.meta.env.VITE_API_URL || '/api';

const statusColors = { new: '#3b82f6', read: '#f59e0b', replied: '#10b981', archived: '#6b7280' };
const statusBg     = { new: '#eff6ff', read: '#fffbeb', replied: '#ecfdf5', archived: '#f3f4f6' };
const statusIcons  = { new: Mail, read: Eye, replied: CheckCircle, archived: Archive };

const SuperAdminLandingContacts = () => {
  const askConfirm = useConfirm();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [selected, setSelected] = useState(null);
  const [updating, setUpdating] = useState(false);

  const headers = useCallback(() => ({
    Authorization: `Bearer ${localStorage.getItem('superAdminToken')}`,
    'Content-Type': 'application/json',
  }), []);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/super-admin/landing-contacts`, { headers: headers() });
      const d = await r.json();
      setContacts(d.contacts || []);
    } catch { setContacts([]); }
    setLoading(false);
  }, [headers]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const stats = useMemo(() => {
    const total = contacts.length;
    const newCount = contacts.filter(c => (c.status || 'new') === 'new').length;
    const read = contacts.filter(c => c.status === 'read').length;
    const replied = contacts.filter(c => c.status === 'replied').length;
    const archived = contacts.filter(c => c.status === 'archived').length;
    return { total, new: newCount, read, replied, archived };
  }, [contacts]);

  const filtered = useMemo(() => {
    let list = [...contacts];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.subject || '').toLowerCase().includes(q) ||
        (c.message || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') list = list.filter(c => (c.status || 'new') === statusFilter);
    list.sort((a, b) => {
      const av = a[sortBy] || '', bv = b[sortBy] || '';
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    return list;
  }, [contacts, search, statusFilter, sortBy, sortDir]);

  const updateStatus = async (id, status) => {
    setUpdating(true);
    try {
      await fetch(`${API}/super-admin/landing-contacts/${id}`, {
        method: 'PUT', headers: headers(), body: JSON.stringify({ status }),
      });
      setContacts(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    } catch {}
    setUpdating(false);
  };

  const deleteContact = async (id) => {
    if (!(await askConfirm({ title: 'Delete contact?', message: 'Delete this contact submission permanently?', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await fetch(`${API}/super-admin/landing-contacts/${id}`, {
        method: 'DELETE', headers: headers(),
      });
      setContacts(prev => prev.filter(c => c.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch {}
  };

  if (loading) return (
    <div className="sa-modern-page">
      <div className="sa-skeleton-grid">
        {[...Array(4)].map((_, i) => <div key={i} className="sa-skeleton-card" />)}
      </div>
    </div>
  );

  return (
    <div className="sa-modern-page">
      {/* Page Header */}
      <div className="sa-page-header-row">
        <div>
          <h1 className="sa-page-title">Landing Contacts</h1>
          <p className="sa-page-subtitle">Messages submitted via the landing page contact form</p>
        </div>
        <div className="sa-header-actions">
          <button className="sa-btn sa-btn-outline" onClick={fetchContacts}><Refresh size={16} /> Refresh</button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="sa-stats-bar">
        <button className={`sa-stat-chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
          <Mail size={18} /> <span className="sa-stat-number">{stats.total}</span> <span className="sa-stat-label">Total</span>
        </button>
        <button className={`sa-stat-chip ${statusFilter === 'new' ? 'active' : ''}`} onClick={() => setStatusFilter('new')} style={{ '--chip-color': '#3b82f6' }}>
          <Clock size={18} /> <span className="sa-stat-number">{stats.new}</span> <span className="sa-stat-label">New</span>
        </button>
        <button className={`sa-stat-chip amber ${statusFilter === 'read' ? 'active' : ''}`} onClick={() => setStatusFilter('read')}>
          <Eye size={18} /> <span className="sa-stat-number">{stats.read}</span> <span className="sa-stat-label">Read</span>
        </button>
        <button className={`sa-stat-chip green ${statusFilter === 'replied' ? 'active' : ''}`} onClick={() => setStatusFilter('replied')}>
          <CheckCircle size={18} /> <span className="sa-stat-number">{stats.replied}</span> <span className="sa-stat-label">Replied</span>
        </button>
        <button className={`sa-stat-chip ${statusFilter === 'archived' ? 'active' : ''}`} onClick={() => setStatusFilter('archived')}>
          <Archive size={18} /> <span className="sa-stat-number">{stats.archived}</span> <span className="sa-stat-label">Archived</span>
        </button>
      </div>

      {/* Toolbar */}
      <div className="sa-toolbar">
        <div className="sa-search-box">
          <Search size={18} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email, phone, subject…" />
          {search && <button className="sa-search-clear" onClick={() => setSearch('')}><Xmark size={16} /></button>}
        </div>
        <div className="sa-toolbar-right">
          <select className="sa-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="created_at">Date</option>
            <option value="first_name">Name</option>
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="status">Status</option>
          </select>
          <button className="sa-sort-toggle" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
            {sortDir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
          </button>
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="sa-empty">
          <Mail size={48} />
          <h3>No contact submissions</h3>
          <p>{search || statusFilter !== 'all' ? 'Try adjusting your filters' : 'No messages have been submitted yet'}</p>
        </div>
      ) : (
        <div className="sa-table-wrapper">
          <table className="sa-modern-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Details</th>
                <th>Status</th>
                <th>Date</th>
                <th style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => {
                const effectiveStatus = c.status || 'new';
                const StatusIcon = statusIcons[effectiveStatus] || Mail;
                return (
                  <tr key={c.id} style={{ background: selected?.id === c.id ? 'rgba(36,64,102,0.04)' : undefined }}>
                    <td style={{ color: '#6b7280', fontSize: 13 }}>{idx + 1}</td>
                    <td>
                      <button
                        onClick={() => { setSelected(selected?.id === c.id ? null : c); if (effectiveStatus === 'new') updateStatus(c.id, 'read'); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: effectiveStatus === 'new' ? 700 : 400, color: '#14284d', textAlign: 'left' }}
                      >
                        {c.first_name} {c.last_name || ''}
                      </button>
                    </td>
                    <td style={{ fontSize: 13, color: '#475569' }}>{c.email || '—'}</td>
                    <td style={{ fontSize: 13, color: '#475569' }}>
                      {c.phone ? (
                        <a href={`tel:${c.phone}`} style={{ color: '#1e3a6b', textDecoration: 'none', fontWeight: 600 }}>
                          {c.phone}
                        </a>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: 13, color: '#475569', maxWidth: 260 }}>
                      <div style={{ fontWeight: 600, color: '#334155', marginBottom: 2 }}>{c.subject || 'General inquiry'}</div>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.message || '—'}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20,
                        fontSize: 12, fontWeight: 600, color: statusColors[effectiveStatus], background: statusBg[effectiveStatus],
                      }}>
                        <StatusIcon size={14} /> {effectiveStatus}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, color: '#6b7280' }}>
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="sa-btn-sm sa-btn-outline" onClick={() => setSelected(selected?.id === c.id ? null : c)} title="View">
                          <Eye size={14} />
                        </button>
                        {effectiveStatus !== 'replied' && (
                          <button className="sa-btn-sm sa-btn-primary" onClick={() => updateStatus(c.id, 'replied')} disabled={updating} title="Mark Replied">
                            <CheckCircle size={14} />
                          </button>
                        )}
                        {effectiveStatus !== 'archived' && (
                          <button className="sa-btn-sm sa-btn-outline" onClick={() => updateStatus(c.id, 'archived')} disabled={updating} title="Archive">
                            <Archive size={14} />
                          </button>
                        )}
                        <button className="sa-btn-sm sa-btn-outline" onClick={() => deleteContact(c.id)} style={{ color: '#ef4444' }} title="Delete">
                          <Trash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Panel */}
      {selected && (
        <div style={{
          marginTop: 24, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
          padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, color: '#14284d', fontSize: 18 }}>{selected.first_name} {selected.last_name || ''}</h3>
              <p style={{ margin: '4px 0 0', color: '#475569', fontSize: 14 }}>{selected.email || 'No email provided'}</p>
              {selected.phone && <p style={{ margin: '4px 0 0', color: '#475569', fontSize: 14 }}>📞 {selected.phone}</p>}
            </div>
            <button className="sa-btn-sm sa-btn-outline" onClick={() => setSelected(null)}><Xmark size={16} /></button>
          </div>
          {selected.subject && <p style={{ fontWeight: 600, color: '#334155', margin: '0 0 8px' }}>{selected.subject}</p>}
          <p style={{ color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selected.message}</p>
          {selected.notes && <p style={{ color: '#64748b', fontSize: 14, margin: '12px 0 0' }}><strong>Internal notes:</strong> {selected.notes}</p>}
          <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 12, color: '#94a3b8' }}>
            <span>Source: {selected.source || 'landing_page'}</span>
            <span>IP: {selected.ip_address || '—'}</span>
            <span>Submitted: {selected.created_at ? new Date(selected.created_at).toLocaleString() : '—'}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminLandingContacts;
