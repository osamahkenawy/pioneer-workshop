import { useState, useEffect } from 'react';
import {
  HeadsetHelp, Plus, Eye, EditPencil, Send, Trash,
  WarningTriangle, CheckCircle, Clock, Filter, Search,
  Refresh, ChatBubble
} from 'iconoir-react';
import './SuperAdmin.css';
import { useSAToast } from './SAToastContext';

import { useConfirm } from './components';
const API = import.meta.env.VITE_API_URL || '/api';
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('superAdminToken')}`, 'Content-Type': 'application/json' });

const PRIORITY_CONFIG = {
  low: { color: '#6b7280', bg: '#f9fafb', label: 'Low' },
  medium: { color: '#3b82f6', bg: '#eff6ff', label: 'Medium' },
  high: { color: '#f59e0b', bg: '#fffbeb', label: 'High' },
  critical: { color: '#ef4444', bg: '#fef2f2', label: 'Critical' }
};

const STATUS_CONFIG = {
  open: { color: '#3b82f6', label: 'Open' },
  in_progress: { color: '#f59e0b', label: 'In Progress' },
  waiting: { color: '#8b5cf6', label: 'Waiting' },
  resolved: { color: '#10b981', label: 'Resolved' },
  closed: { color: '#6b7280', label: 'Closed' }
};

const SuperAdminTickets = () => {
  const askConfirm = useConfirm();
  const showToast = useSAToast();
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ subject: '', description: '', category: 'other', priority: 'medium', workshop_id: '' });
  const [workshops, setWorkshops] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [search, setSearch] = useState('');
  const [admins, setAdmins] = useState([]);

  useEffect(() => { fetchTickets(); fetchWorkshops(); fetchAdmins(); }, [filterStatus, filterPriority]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterPriority) params.set('priority', filterPriority);
      if (search) params.set('search', search);
      const res = await fetch(`${API}/super-admin/tickets?${params}`, { headers: headers() });
      if (res.ok) { const d = await res.json(); setTickets(d.tickets || []); setStats(d.stats || {}); }
    } catch (_) {}
    setLoading(false);
  };

  const fetchWorkshops = async () => {
    try {
      const res = await fetch(`${API}/super-admin/workshops?limit=999`, { headers: headers() });
      if (res.ok) { const d = await res.json(); setWorkshops(d.workshops || []); }
    } catch (_) {}
  };

  const fetchAdmins = async () => {
    try {
      const res = await fetch(`${API}/super-admin/platform-users`, { headers: headers() });
      if (res.ok) setAdmins(await res.json());
    } catch (_) {}
  };

  const openTicket = async (id) => {
    try {
      const res = await fetch(`${API}/super-admin/tickets/${id}`, { headers: headers() });
      if (res.ok) {
        const d = await res.json();
        setTicketDetail(d.ticket);
        setReplies(d.replies || []);
        setSelectedTicket(id);
      }
    } catch (_) {}
  };

  const createTicket = async () => {
    const res = await fetch(`${API}/super-admin/tickets`, {
      method: 'POST', headers: headers(), body: JSON.stringify(createForm)
    });
    if (res.ok) { setShowCreate(false); setCreateForm({ subject: '', description: '', category: 'other', priority: 'medium', workshop_id: '' }); fetchTickets(); }
  };

  const updateTicket = async (id, updates) => {
    await fetch(`${API}/super-admin/tickets/${id}`, {
      method: 'PUT', headers: headers(), body: JSON.stringify(updates)
    });
    fetchTickets();
    if (selectedTicket === id) openTicket(id);
  };

  const addReply = async () => {
    if (!replyText.trim()) return;
    await fetch(`${API}/super-admin/tickets/${selectedTicket}/reply`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ message: replyText })
    });
    setReplyText('');
    openTicket(selectedTicket);
  };

  const deleteTicket = async (id) => {
    if (!(await askConfirm({ title: 'Delete ticket?', message: 'This will permanently remove the ticket and all its replies.', danger: true, confirmLabel: 'Delete' }))) return;
    await fetch(`${API}/super-admin/tickets/${id}`, { method: 'DELETE', headers: headers() });
    setSelectedTicket(null); fetchTickets();
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>Support Tickets</h1>
          <p>Manage and resolve support requests from workshops</p>
        </div>
        <button className="sa-primary-btn" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Ticket
        </button>
      </div>

      {/* Stats */}
      <div className="sa-stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 20 }}>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <div key={key} className="sa-stat-card" onClick={() => setFilterStatus(filterStatus === key ? '' : key)} style={{ cursor: 'pointer', border: filterStatus === key ? `2px solid ${cfg.color}` : '2px solid transparent' }}>
            <div className="sa-stat-icon" style={{ background: `${cfg.color}15`, color: cfg.color }}>
              {key === 'open' ? <HeadsetHelp size={20} /> : key === 'resolved' ? <CheckCircle size={20} /> : <Clock size={20} />}
            </div>
            <div className="sa-stat-content">
              <h3>{stats[`${key}_count`] || 0}</h3>
              <p>{cfg.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="sa-card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="sa-search-input" style={{ flex: 1, minWidth: 200 }}>
          <Search size={16} />
          <input placeholder="Search tickets..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchTickets()} />
        </div>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="sa-select">
          <option value="">All Priorities</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="sa-secondary-btn" onClick={fetchTickets} style={{ padding: '8px 12px' }}>
          <Filter size={16} /> Filter
        </button>
      </div>

      {/* Ticket List */}
      {loading ? (
        <div className="sa-loading-page"><div className="loading-spinner"></div></div>
      ) : (
        <div className="sa-card">
          {tickets.length === 0 ? (
            <div className="sa-empty-state">
              <HeadsetHelp size={48} />
              <h3>No tickets found</h3>
              <p>Support tickets will appear here</p>
            </div>
          ) : (
            <div className="sa-table-container">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th>Subject</th>
                    <th>Workshop</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Assigned</th>
                    <th>Replies</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => {
                    const pri = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.medium;
                    const st = STATUS_CONFIG[t.status] || STATUS_CONFIG.open;
                    return (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => openTicket(t.id)}>
                        <td>{t.id}</td>
                        <td>
                          <div>
                            <strong>{t.subject}</strong>
                            <div style={{ fontSize: 12, color: '#6b7280' }}>{t.category}</div>
                          </div>
                        </td>
                        <td>{t.workshop_name || '—'}</td>
                        <td>
                          <span className="sa-badge-pill" style={{ background: pri.bg, color: pri.color }}>{pri.label}</span>
                        </td>
                        <td>
                          <span className="sa-badge-pill" style={{ background: `${st.color}15`, color: st.color }}>{st.label}</span>
                        </td>
                        <td>{t.assigned_name || '—'}</td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <ChatBubble size={14} /> {t.reply_count || 0}
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDate(t.created_at)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                            <button className="sa-icon-btn" onClick={() => openTicket(t.id)}><Eye size={16} /></button>
                            <button className="sa-icon-btn danger" onClick={() => deleteTicket(t.id)}><Trash size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Ticket Detail Modal */}
      {selectedTicket && ticketDetail && (
        <div className="sa-modal-backdrop" onClick={() => setSelectedTicket(null)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 750 }}>
            <div className="sa-modal-header">
              <h2>Ticket #{ticketDetail.id}: {ticketDetail.subject}</h2>
              <button className="sa-modal-close" onClick={() => setSelectedTicket(null)}>×</button>
            </div>
            <div className="sa-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {/* Ticket info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, padding: 16, background: '#f8fafc', borderRadius: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>Status</label>
                  <select value={ticketDetail.status} onChange={e => updateTicket(ticketDetail.id, { status: e.target.value })} className="sa-select" style={{ marginTop: 4 }}>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>Priority</label>
                  <select value={ticketDetail.priority} onChange={e => updateTicket(ticketDetail.id, { priority: e.target.value })} className="sa-select" style={{ marginTop: 4 }}>
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>Assigned To</label>
                  <select value={ticketDetail.assigned_to || ''} onChange={e => updateTicket(ticketDetail.id, { assigned_to: parseInt(e.target.value) || null })} className="sa-select" style={{ marginTop: 4 }}>
                    <option value="">Unassigned</option>
                    {admins.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>Category</label>
                  <span style={{ display: 'block', marginTop: 4, textTransform: 'capitalize' }}>{ticketDetail.category?.replace(/_/g, ' ')}</span>
                </div>
              </div>

              {/* Description */}
              {ticketDetail.description && (
                <div style={{ padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16 }}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{ticketDetail.description}</p>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                    {ticketDetail.user_name} — {fmtDate(ticketDetail.created_at)}
                  </div>
                </div>
              )}

              {/* Replies */}
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 8 }}>Conversation ({replies.length})</h4>
                {replies.map(r => (
                  <div key={r.id} style={{ padding: 12, background: r.sender_type === 'admin' ? '#eff6ff' : '#f8fafc', borderRadius: 8, marginBottom: 8, borderLeft: `3px solid ${r.sender_type === 'admin' ? '#3b82f6' : '#10b981'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <strong style={{ fontSize: 13 }}>{r.sender_name} ({r.sender_type})</strong>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>{fmtDate(r.created_at)}</span>
                    </div>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.message}</p>
                  </div>
                ))}
              </div>

              {/* Reply box */}
              <div>
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Type your reply..." rows={3} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db', resize: 'vertical' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="sa-primary-btn" onClick={addReply} disabled={!replyText.trim()}>
                    <Send size={16} /> Send Reply
                  </button>
                </div>
              </div>

              {/* Resolution */}
              {ticketDetail.status === 'resolved' && ticketDetail.resolution && (
                <div style={{ padding: 12, background: '#ecfdf5', borderRadius: 8, marginTop: 12 }}>
                  <strong style={{ color: '#10b981' }}>Resolution:</strong>
                  <p style={{ margin: '4px 0 0' }}>{ticketDetail.resolution}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Ticket Modal */}
      {showCreate && (
        <div className="sa-modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()}>
            <div className="sa-modal-header">
              <h2>New Support Ticket</h2>
              <button className="sa-modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div className="sa-modal-body">
              <div className="sa-form-grid">
                <div className="sa-form-group full-width">
                  <label>Subject</label>
                  <input value={createForm.subject} onChange={e => setCreateForm({ ...createForm, subject: e.target.value })} placeholder="Ticket subject..." />
                </div>
                <div className="sa-form-group">
                  <label>Workshop (optional)</label>
                  <select value={createForm.workshop_id} onChange={e => setCreateForm({ ...createForm, workshop_id: e.target.value })}>
                    <option value="">No specific workshop</option>
                    {workshops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Category</label>
                  <select value={createForm.category} onChange={e => setCreateForm({ ...createForm, category: e.target.value })}>
                    <option value="bug">Bug</option><option value="feature_request">Feature Request</option>
                    <option value="billing">Billing</option><option value="account">Account</option>
                    <option value="technical">Technical</option><option value="other">Other</option>
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Priority</label>
                  <select value={createForm.priority} onChange={e => setCreateForm({ ...createForm, priority: e.target.value })}>
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div className="sa-form-group full-width">
                  <label>Description</label>
                  <textarea value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} rows={5} placeholder="Describe the issue..." />
                </div>
              </div>
            </div>
            <div className="sa-modal-footer">
              <button className="sa-secondary-btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="sa-primary-btn" onClick={createTicket} disabled={!createForm.subject}>Create Ticket</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminTickets;
