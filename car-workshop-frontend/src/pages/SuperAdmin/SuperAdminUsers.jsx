import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  User, Search, Eye, Mail, Phone, Building, Refresh,
  CheckCircle, Xmark, ArrowUp, ArrowDown, WarningTriangle,
  Activity, Shield
} from 'iconoir-react';
import './SuperAdminModern.css';
import './SuperAdmin.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const avatarColor = (name = '') => {
  const colors = ['#1e3a6b','#f94c29','#2d5a8c','#3a7bc8','#14284d','#e0380f','#4a7fa5','#c94420','#1e4d7a'];
  let h = 0; for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
};

const roleColors = {
  admin:      { color: '#1e40af', bg: '#dbeafe' },
  dispatcher: { color: '#7e22ce', bg: '#f3e8ff' },
  mechanic:     { color: '#b45309', bg: '#fef3c7' },
  customer:     { color: '#0f766e', bg: '#ccfbf1' },
};
const getRoleStyle = (role) => roleColors[role] || { color: '#475569', bg: '#f1f5f9' };

const SuperAdminUsers = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWorkshop, setSelectedWorkshop] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [workshops, setWorkshops] = useState([]);
  const [sortBy, setSortBy] = useState('full_name');
  const [sortDir, setSortDir] = useState('asc');

  const token = localStorage.getItem('superAdminToken');
  const headers = { Authorization: `Bearer ${token}` };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const tRes = await fetch(`${API_BASE_URL}/super-admin/workshops`, { headers });
      let workshopList = [];
      if (tRes.ok) {
        const tData = await tRes.json();
        workshopList = tData.workshops || [];
        setWorkshops(workshopList);
      }

      const workshopsToQuery = selectedWorkshop
        ? workshopList.filter(t => t.id === parseInt(selectedWorkshop))
        : workshopList;

      const userPromises = workshopsToQuery.map(async (workshop) => {
        try {
          const response = await fetch(`${API_BASE_URL}/super-admin/workshops/${workshop.id}`, { headers });
          if (response.ok) {
            const data = await response.json();
            return (data.users || []).map(user => ({
              ...user,
              workshop_name: workshop.name,
              workshop_id: workshop.id,
              workshop_status: workshop.status,
            }));
          }
        } catch (_) {}
        return [];
      });

      const results = await Promise.all(userPromises);
      setUsers(results.flat());
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedWorkshop]);

  useEffect(() => { loadData(); }, [loadData]);

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter(u => u.is_active).length,
    admins: users.filter(u => u.role === 'admin').length,
    mechanics: users.filter(u => u.role === 'mechanic').length,
  }), [users]);

  const filtered = useMemo(() => {
    let list = [...users];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(u =>
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.workshop_name || '').toLowerCase().includes(q)
      );
    }
    if (roleFilter !== 'all') list = list.filter(u => u.role === roleFilter);
    list.sort((a, b) => {
      const av = (a[sortBy] || '').toString().toLowerCase();
      const bv = (b[sortBy] || '').toString().toLowerCase();
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    return list;
  }, [users, searchQuery, roleFilter, sortBy, sortDir]);

  if (loading) return (
    <div className="sa-modern-page">
      <div className="sa-skeleton-grid">
        {[...Array(6)].map((_, i) => <div key={i} className="sa-skeleton-card" />)}
      </div>
    </div>
  );

  return (
    <div className="sa-modern-page">
      {/* Page Header */}
      <div className="sa-page-header-row">
        <div>
          <h1 className="sa-page-title">Platform Users</h1>
          <p className="sa-page-subtitle">Manage all users across workshops</p>
        </div>
        <div className="sa-header-actions">
          <button className="sa-btn sa-btn-outline" onClick={loadData}><Refresh size={16} /> Refresh</button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="sa-stats-bar">
        <button className={`sa-stat-chip ${roleFilter==='all'?'active':''}`} onClick={() => setRoleFilter('all')}>
          <User size={18} /> <span className="sa-stat-number">{stats.total}</span> <span className="sa-stat-label">Total</span>
        </button>
        <button className={`sa-stat-chip green ${roleFilter==='all' && !searchQuery ? '' : ''}`} onClick={() => setRoleFilter('all')}>
          <CheckCircle size={18} /> <span className="sa-stat-number">{stats.active}</span> <span className="sa-stat-label">Active</span>
        </button>
        <button className={`sa-stat-chip ${roleFilter==='admin'?'active':''}`} onClick={() => setRoleFilter('admin')}>
          <Shield size={18} /> <span className="sa-stat-number">{stats.admins}</span> <span className="sa-stat-label">Admins</span>
        </button>
        <button className={`sa-stat-chip amber ${roleFilter==='mechanic'?'active':''}`} onClick={() => setRoleFilter('mechanic')}>
          <Activity size={18} /> <span className="sa-stat-number">{stats.mechanics}</span> <span className="sa-stat-label">Mechanics</span>
        </button>
      </div>

      {/* Toolbar */}
      <div className="sa-toolbar">
        <div className="sa-search-box">
          <Search size={18} />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by name, email, workshop…" />
          {searchQuery && <button className="sa-search-clear" onClick={() => setSearchQuery('')}><Xmark size={16} /></button>}
        </div>
        <div className="sa-toolbar-right">
          <select className="sa-select" value={selectedWorkshop} onChange={e => setSelectedWorkshop(e.target.value)}>
            <option value="">All Workshops</option>
            {workshops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="sa-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="full_name">Name</option>
            <option value="email">Email</option>
            <option value="role">Role</option>
            <option value="workshop_name">Workshop</option>
          </select>
          <button className="sa-sort-toggle" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
            {sortDir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
          </button>
        </div>
      </div>

      {/* User List */}
      {filtered.length === 0 ? (
        <div className="sa-empty">
          <User size={48} />
          <h3>No users found</h3>
          <p>Try adjusting your filters</p>
        </div>
      ) : (
        <div className="sa-user-list">
          {filtered.map(user => {
            const name = user.full_name || user.username || 'Unknown';
            const color = avatarColor(name);
            const roleStyle = getRoleStyle(user.role);
            return (
              <div key={`${user.workshop_id}-${user.id}`} className="sa-user-row">
                <div className="sa-user-row-left">
                  <div className="sa-user-row-avatar" style={{ background: color }}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="sa-user-row-info">
                    <div className="sa-user-row-name">{name}</div>
                    <div className="sa-user-row-email"><Mail size={13} /> {user.email || '—'}</div>
                  </div>
                </div>

                <div className="sa-user-row-workshop">
                  <Building size={14} />
                  <span>{user.workshop_name}</span>
                </div>

                <div className="sa-user-row-role">
                  <span className="sa-role-pill" style={{ color: roleStyle.color, background: roleStyle.bg }}>
                    {user.role || 'user'}
                  </span>
                </div>

                <div className="sa-user-row-contact">
                  {user.phone && <span className="sa-user-row-phone"><Phone size={13} /> {user.phone}</span>}
                </div>

                <div className="sa-user-row-status">
                  <span className="sa-status-pill" style={{
                    color: user.is_active ? '#10b981' : '#6b7280',
                    background: user.is_active ? '#ecfdf5' : '#f3f4f6'
                  }}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="sa-user-row-login">
                  {user.last_login_at
                    ? new Date(user.last_login_at).toLocaleDateString()
                    : 'Never'}
                </div>

                <div className="sa-user-row-actions">
                  <Link to={`/super-admin/workshops/${user.workshop_id}`} className="sa-btn-icon" title="View Workshop">
                    <Eye size={16} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="sa-results-footer">
        Showing <strong>{filtered.length}</strong> of <strong>{users.length}</strong> users
      </div>
    </div>
  );
};

export default SuperAdminUsers;


