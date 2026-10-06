import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  NavArrowLeft, Building, User, Package, Settings, Eye, EditPencil,
  Copy, Trash, CheckCircle, WarningTriangle, Play, Pause, Key,
  Calendar, Globe, Mail, CreditCard, Palette, StatsReport, Shield,
  OpenNewWindow, RefreshDouble, Xmark, Clock
} from 'iconoir-react';
import avatarPlaceholder from '../../assets/images/PioneerLogos/avatar-placeholder.png';
import './SuperAdminModern.css';
import './SuperAdmin.css';

import { useConfirm } from './components';
const API = import.meta.env.VITE_API_URL || '/api';

const statusColors = { active: '#10b981', inactive: '#6b7280', suspended: '#ef4444', trial: '#f59e0b', trialing: '#f59e0b', trial_expired: '#dc2626', past_due: '#ea580c', cancelled: '#6b7280' };
const statusBg    = { active: '#ecfdf5', inactive: '#f3f4f6', suspended: '#fef2f2', trial: '#fffbeb', trialing: '#fffbeb', trial_expired: '#fef2f2', past_due: '#fff7ed', cancelled: '#f3f4f6' };

const SuperAdminWorkshopDetail = () => {
  const askConfirm = useConfirm();
  const { id } = useParams();
  const navigate = useNavigate();
  const [workshop, setWorkshop] = useState(null);
  const [users, setUsers] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [usage, setUsage] = useState(null);
  const [branding, setBranding] = useState(null);
  const [allModules, setAllModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [toast, setToast] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // Trial management state
  const [extendDays, setExtendDays] = useState(7);
  const [trialAction, setTrialAction] = useState(null); // 'extending' | 'stopping' | 'activating'
  const [activatePlan, setActivatePlan] = useState('starter');

  // Add User modal state
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [addUserForm, setAddUserForm] = useState({ full_name: '', username: '', email: '', phone: '', role: 'dispatcher', password: '' });
  const [addingUser, setAddingUser] = useState(false);
  const [userLimitError, setUserLimitError] = useState(null);
  const [sendingWelcome, setSendingWelcome] = useState(false);

  // Billing history
  const [billing, setBilling] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);

  const token = localStorage.getItem('superAdminToken');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const copyText = txt => { navigator.clipboard.writeText(txt); showToast('Copied!'); };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, uRes, mRes, bRes] = await Promise.all([
        fetch(`${API}/super-admin/workshops/${id}`, { headers }),
        fetch(`${API}/super-admin/workshops/${id}/usage`, { headers }).catch(() => null),
        fetch(`${API}/super-admin/modules`, { headers }).catch(() => null),
        fetch(`${API}/super-admin/branding/${id}`, { headers }).catch(() => null),
      ]);

      // Workshop detail endpoint returns { workshop, users, subscription }
      const tData = await tRes.json();
      setWorkshop(tData.workshop || tData);
      setUsers(tData.users || []);
      setSubscription(tData.subscription || null);

      // Usage endpoint returns stats object directly (not wrapped)
      if (uRes && uRes.ok) {
        const uData = await uRes.json();
        setUsage(uData.usage || uData);
      }

      // Modules endpoint returns array directly (not wrapped)
      if (mRes && mRes.ok) {
        const mData = await mRes.json();
        setAllModules(Array.isArray(mData) ? mData : (mData.modules || mData.data || []));
      }

      // Branding endpoint returns { branding } or branding object
      if (bRes && bRes.ok) {
        const bData = await bRes.json();
        setBranding(bData.branding || bData);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      showToast('Failed to load workshop', 'error');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Fetch billing history when tab opened
  const fetchBilling = useCallback(async () => {
    setBillingLoading(true);
    try {
      const r = await fetch(`${API}/super-admin/workshops/${id}/billing-history`, { headers });
      if (r.ok) {
        const d = await r.json();
        setBilling(d);
      }
    } catch (e) { /* ignore */ }
    setBillingLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (activeTab === 'billing' && !billing && !billingLoading) fetchBilling();
  }, [activeTab, billing, billingLoading, fetchBilling]);

  // Toggle status – backend uses POST /toggle-status
  const toggleStatus = async () => {
    if (!workshop) return;
    const newStatus = workshop.status === 'active' ? 'suspended' : 'active';
    try {
      await fetch(`${API}/super-admin/workshops/${id}/toggle-status`, {
        method: 'POST', headers, body: JSON.stringify({ status: newStatus })
      });
      setWorkshop(p => ({ ...p, status: newStatus }));
      showToast(`Workshop ${newStatus === 'active' ? 'activated' : 'suspended'}`);
    } catch { showToast('Action failed', 'error'); }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== (workshop.name || workshop.company_name)) return;
    try {
      await fetch(`${API}/super-admin/workshops/${id}`, { method: 'DELETE', headers });
      showToast('Workshop deleted');
      setTimeout(() => navigate('/super-admin/workshops'), 1200);
    } catch { showToast('Delete failed', 'error'); }
  };

  const impersonate = async () => {
    try {
      const r = await fetch(`${API}/super-admin/workshops/${id}/impersonate`, { method: 'POST', headers });
      const d = await r.json();
      if (d.token) {
        localStorage.setItem('token', d.token);
        if (d.user) localStorage.setItem('user', JSON.stringify(d.user));
        window.open('/dashboard', '_blank');
        showToast('Impersonation started');
      } else {
        showToast(d.error || 'Impersonation failed', 'error');
      }
    } catch { showToast('Impersonation failed', 'error'); }
  };

  /* ---- loading skeleton ---- */
  if (loading) return (
    <div className="sa-modern-page">
      <div className="sa-skeleton-card" style={{ height: 200, marginBottom: 24 }} />
      <div className="sa-skeleton-grid"><div className="sa-skeleton-card" /><div className="sa-skeleton-card" /><div className="sa-skeleton-card" /></div>
    </div>
  );

  if (!workshop) return (
    <div className="sa-modern-page"><div className="sa-empty"><WarningTriangle size={48} /><h3>Workshop not found</h3><Link to="/super-admin/workshops" className="sa-btn sa-btn-primary">Back to Workshops</Link></div></div>
  );

  // ── Trial Management Handlers ──
  const handleExtendTrial = async () => {
    setTrialAction('extending');
    try {
      const res = await fetch(`${API}/super-admin/workshops/${id}/extend-trial`, {
        method: 'POST', headers, body: JSON.stringify({ days: extendDays }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Trial extended by ${extendDays} days`, 'success');
        fetchAll();
      } else showToast(data.message || 'Failed to extend trial', 'error');
    } catch (e) { showToast('Error extending trial', 'error'); }
    setTrialAction(null);
  };

  const handleStopTrial = async () => {
    if (!(await askConfirm({ title: 'Stop trial now?', message: "This workshop will lose access immediately.", danger: true, confirmLabel: 'Stop Trial' }))) return;
    setTrialAction('stopping');
    try {
      const res = await fetch(`${API}/super-admin/workshops/${id}/stop-trial`, {
        method: 'POST', headers,
      });
      const data = await res.json();
      if (data.success) {
        showToast('Trial stopped', 'success');
        fetchAll();
      } else showToast(data.message || 'Failed to stop trial', 'error');
    } catch (e) { showToast('Error stopping trial', 'error'); }
    setTrialAction(null);
  };

  const handleActivatePlan = async () => {
    setTrialAction('activating');
    try {
      const res = await fetch(`${API}/super-admin/workshops/${id}/activate-plan`, {
        method: 'POST', headers, body: JSON.stringify({ plan: activatePlan }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Activated ${activatePlan} plan`, 'success');
        fetchAll();
      } else showToast(data.message || 'Failed to activate plan', 'error');
    } catch (e) { showToast('Error activating plan', 'error'); }
    setTrialAction(null);
  };

  const handleSendWelcomeEmail = async () => {
    setSendingWelcome(true);
    try {
      const res = await fetch(`${API}/super-admin/workshops/${id}/send-welcome-email`, { method: 'POST', headers });
      const data = await res.json();
      if (data.success) showToast(data.message || 'Welcome email sent!', 'success');
      else showToast(data.message || 'Failed to send email', 'error');
    } catch (e) { showToast('Error sending welcome email', 'error'); }
    setSendingWelcome(false);
  };

  // ── Module Toggle Handlers ──
  const toggleModule = async (moduleId) => {
    const current = [...allowedModules];
    const updated = current.includes(moduleId)
      ? current.filter(m => m !== moduleId)
      : [...current, moduleId];
    try {
      const r = await fetch(`${API}/super-admin/workshops/${id}/modules`, {
        method: 'POST', headers, body: JSON.stringify({ modules: updated }),
      });
      if (r.ok) {
        setWorkshop(p => ({ ...p, allowed_modules: updated }));
        showToast(`Module ${current.includes(moduleId) ? 'disabled' : 'enabled'}`);
      } else showToast('Failed to update modules', 'error');
    } catch { showToast('Failed to update modules', 'error'); }
  };

  const toggleAllModules = async (enableAll) => {
    const updated = enableAll ? allModules.map(m => m.id) : [];
    try {
      const r = await fetch(`${API}/super-admin/workshops/${id}/modules`, {
        method: 'POST', headers, body: JSON.stringify({ modules: updated }),
      });
      if (r.ok) {
        setWorkshop(p => ({ ...p, allowed_modules: updated }));
        showToast(enableAll ? 'All modules enabled' : 'All modules disabled');
      } else showToast('Failed to update modules', 'error');
    } catch { showToast('Failed to update modules', 'error'); }
  };

  // Derive display values
  const companyName = workshop.name || workshop.company_name || 'Unnamed Workshop';
  const logoSrc = workshop.logo_url || avatarPlaceholder;
  const plan = subscription?.plan || workshop.plan || 'Free';
  const subStatus = subscription?.status || workshop.subscription_status || '—';

  // Determine enabled module IDs from workshop settings
  const allowedModules = workshop.allowed_modules || (workshop.settings?.allowed_modules) || [];

  const tabs = [
    { key: 'overview', label: 'Overview', icon: StatsReport },
    { key: 'users', label: 'Users', icon: User, count: users.length || workshop.user_count },
    { key: 'modules', label: 'Modules', icon: Package, count: allowedModules.length },
    { key: 'billing', label: 'Billing', icon: CreditCard },
    { key: 'branding', label: 'Branding', icon: Palette },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="sa-modern-page">
      {/* Back link */}
      <Link to="/super-admin/workshops" className="sa-back-link"><NavArrowLeft size={18} /> Back to Workshops</Link>

      {/* Hero Header */}
      <div className="sa-detail-hero">
        <div className="sa-hero-content">
          <img className="sa-hero-avatar-img" src={logoSrc} alt={companyName} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} />
          <div className="sa-hero-info">
            <div className="sa-hero-title-row">
              <h1>{companyName}</h1>
              <span className="sa-status-pill" style={{ color: statusColors[workshop.status], background: statusBg[workshop.status] }}>{workshop.status}</span>
            </div>
            <div className="sa-hero-meta">
              {workshop.domain && <span><Globe size={14} /> {workshop.domain}</span>}
              {workshop.email && <span><Mail size={14} /> {workshop.email}</span>}
              {workshop.created_at && <span><Calendar size={14} /> Joined {new Date(workshop.created_at).toLocaleDateString()}</span>}
            </div>
          </div>
        </div>
        <div className="sa-hero-actions">
          <button className="sa-btn sa-btn-outline" onClick={impersonate}><OpenNewWindow size={16} /> Impersonate</button>
          <button className="sa-btn sa-btn-outline" onClick={handleSendWelcomeEmail} disabled={sendingWelcome}>
            <Mail size={16} /> {sendingWelcome ? 'Sending…' : 'Send Welcome Email'}
          </button>
          <button className="sa-btn sa-btn-outline" onClick={toggleStatus}>
            {workshop.status === 'active' ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Activate</>}
          </button>
          <button className="sa-btn sa-btn-outline" onClick={fetchAll}><RefreshDouble size={16} /></button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="sa-quick-stats">
        <div className="sa-qstat">
          <div className="sa-qstat-icon blue"><User size={20} /></div>
          <div><div className="sa-qstat-value">{users.length || workshop.user_count || 0}</div><div className="sa-qstat-label">Users</div></div>
        </div>
        <div className="sa-qstat">
          <div className="sa-qstat-icon purple"><Package size={20} /></div>
          <div><div className="sa-qstat-value">{allowedModules.length}</div><div className="sa-qstat-label">Modules</div></div>
        </div>
        <div className="sa-qstat">
          <div className="sa-qstat-icon green"><CreditCard size={20} /></div>
          <div><div className="sa-qstat-value">{plan}</div><div className="sa-qstat-label">Plan</div></div>
        </div>
        <div className="sa-qstat">
          <div className="sa-qstat-icon amber"><Shield size={20} /></div>
          <div><div className="sa-qstat-value">{subStatus}</div><div className="sa-qstat-label">Subscription</div></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sa-modern-tabs">
        {tabs.map(tab => (
          <button key={tab.key} className={`sa-tab ${activeTab===tab.key?'active':''}`} onClick={() => setActiveTab(tab.key)}>
            <tab.icon size={16} /> {tab.label}
            {tab.count != null && <span className="sa-tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="sa-tab-content">
        {/* ---- OVERVIEW ---- */}
        {activeTab === 'overview' && (
          <div className="sa-detail-grid">
            <div className="sa-modern-card">
              <h3 className="sa-card-heading">Company Information</h3>
              <div className="sa-info-list">
                <div className="sa-info-row"><span className="sa-info-label">Company</span><span className="sa-info-value">{companyName}</span></div>
                <div className="sa-info-row"><span className="sa-info-label">Domain</span><span className="sa-info-value">{workshop.domain || '—'} {workshop.domain && <button className="sa-copy-btn" onClick={() => copyText(workshop.domain)}><Copy size={12} /></button>}</span></div>
                <div className="sa-info-row"><span className="sa-info-label">Email</span><span className="sa-info-value">{workshop.email || '—'}</span></div>
                <div className="sa-info-row"><span className="sa-info-label">Phone</span><span className="sa-info-value">{workshop.phone || '—'}</span></div>
                <div className="sa-info-row"><span className="sa-info-label">Country</span><span className="sa-info-value">{workshop.country || '—'}</span></div>
                <div className="sa-info-row"><span className="sa-info-label">Industry</span><span className="sa-info-value">{workshop.industry || '—'}</span></div>
                <div className="sa-info-row"><span className="sa-info-label">Workshop ID</span><span className="sa-info-value sa-mono">{workshop.id} <button className="sa-copy-btn" onClick={() => copyText(String(workshop.id))}><Copy size={12} /></button></span></div>
              </div>
            </div>
            <div className="sa-modern-card">
              <h3 className="sa-card-heading">Subscription Details</h3>
              <div className="sa-info-list">
                <div className="sa-info-row"><span className="sa-info-label">Plan</span><span className="sa-info-value">{plan}</span></div>
                <div className="sa-info-row"><span className="sa-info-label">Status</span><span className="sa-info-value"><span className="sa-status-pill" style={{ color: statusColors[subscription?.status || workshop.status], background: statusBg[subscription?.status || workshop.status] }}>{subStatus}</span></span></div>
                <div className="sa-info-row"><span className="sa-info-label">Max Users</span><span className="sa-info-value">{subscription?.max_users || workshop.max_users || '—'}</span></div>
                <div className="sa-info-row"><span className="sa-info-label">Active Users</span><span className="sa-info-value">{workshop.active_users ?? '—'} / {users.length || workshop.user_count || 0}</span></div>
                {subscription?.created_at && <div className="sa-info-row"><span className="sa-info-label">Since</span><span className="sa-info-value">{new Date(subscription.created_at).toLocaleDateString()}</span></div>}
                {subscription?.trial_end && <div className="sa-info-row"><span className="sa-info-label">Trial End</span><span className="sa-info-value">{new Date(subscription.trial_end).toLocaleDateString()}</span></div>}
                {subscription?.trial_days && <div className="sa-info-row"><span className="sa-info-label">Trial Days</span><span className="sa-info-value">{subscription.trial_days}{subscription.trial_extended ? ' (extended)' : ''}</span></div>}
              </div>
            </div>

            {/* ── Trial Management Card (Scenario 8) ── */}
            <div className="sa-modern-card">
              <h3 className="sa-card-heading">Trial Management</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Extend Trial */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', minWidth: '80px', color: '#374151' }}>Extend by</label>
                  <select value={extendDays} onChange={e => setExtendDays(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px' }}>
                    {[3, 5, 7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} days</option>)}
                  </select>
                  <button onClick={handleExtendTrial} disabled={!!trialAction} className="sa-btn sa-btn-sm sa-btn-primary" style={{ fontSize: '12px', padding: '6px 14px' }}>
                    {trialAction === 'extending' ? 'Extending…' : '+ Extend Trial'}
                  </button>
                </div>

                {/* Stop Trial */}
                {(subscription?.status === 'trialing' || workshop.status === 'trial') && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <label style={{ fontSize: '13px', minWidth: '80px', color: '#374151' }}>Stop trial</label>
                    <button onClick={handleStopTrial} disabled={!!trialAction} className="sa-btn sa-btn-sm" style={{ fontSize: '12px', padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                      {trialAction === 'stopping' ? 'Stopping…' : '⛔ Stop Trial Now'}
                    </button>
                  </div>
                )}

                {/* Activate Plan */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
                  <label style={{ fontSize: '13px', minWidth: '80px', color: '#374151' }}>Activate</label>
                  <select value={activatePlan} onChange={e => setActivatePlan(e.target.value)} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px' }}>
                    <option value="starter">Starter</option>
                    <option value="growth">Growth</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                    <option value="self_hosted">Self-Hosted</option>
                  </select>
                  <button onClick={handleActivatePlan} disabled={!!trialAction} className="sa-btn sa-btn-sm sa-btn-primary" style={{ fontSize: '12px', padding: '6px 14px', background: '#10b981' }}>
                    {trialAction === 'activating' ? 'Activating…' : '✅ Activate Plan'}
                  </button>
                </div>
              </div>
            </div>
            {usage && (
              <div className="sa-modern-card sa-span-2">
                <h3 className="sa-card-heading">Usage Overview</h3>
                <div className="sa-usage-grid">
                  {Object.entries(usage).map(([k, v]) => (
                    <div key={k} className="sa-usage-item">
                      <div className="sa-usage-label">{k.replace(/_/g, ' ')}</div>
                      <div className="sa-usage-value">{typeof v === 'number' ? v.toLocaleString() : String(v)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- USERS ---- */}
        {activeTab === 'users' && (
          <div className="sa-modern-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="sa-card-heading" style={{ margin: 0 }}>
                Workshop Users ({users.filter(u => u.is_active).length}
                {(subscription?.max_users || workshop?.max_users) ? ` / ${subscription?.max_users || workshop?.max_users}` : ''})
              </h3>
              <button className="sa-primary-btn" onClick={() => {
                const maxUsers = subscription?.max_users || workshop?.max_users || 5;
                const activeUsers = users.filter(u => u.is_active).length;
                if (activeUsers >= maxUsers) {
                  setUserLimitError({
                    message: `User limit reached (${activeUsers}/${maxUsers}). Increase max_users for this workshop or upgrade their plan.`,
                    current: activeUsers,
                    max: maxUsers,
                    plan: subscription?.plan || 'starter',
                  });
                } else {
                  setUserLimitError(null);
                  setAddUserForm({ full_name: '', username: '', email: '', phone: '', role: 'dispatcher', password: '' });
                  setShowAddUserModal(true);
                }
              }}>
                + Add User
              </button>
            </div>

            {/* User limit warning */}
            {userLimitError && (
              <div style={{ padding: '14px 18px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <WarningTriangle size={18} style={{ color: '#dc2626', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 700, color: '#dc2626', fontSize: 14, marginBottom: 4 }}>User Limit Reached</div>
                    <div style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 10 }}>{userLimitError.message}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Link to={`/super-admin/workshops/${id}`} onClick={() => { setActiveTab('settings'); setUserLimitError(null); }} className="sa-btn sa-btn-outline" style={{ fontSize: 12, padding: '6px 12px' }}>
                        <Settings size={14} /> Increase Max Users
                      </Link>
                      <button className="sa-btn sa-btn-outline" onClick={() => setUserLimitError(null)} style={{ fontSize: 12, padding: '6px 12px' }}>
                        Dismiss
                      </button>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: '#9ca3af' }}>
                      Support: <a href="mailto:support@pioneercarservice.com" style={{ color: '#2563eb' }}>support@pioneercarservice.com</a> · <a href="mailto:info@pioneercarservice.com" style={{ color: '#2563eb' }}>info@pioneercarservice.com</a> · <a href="https://wa.me/971503920037" target="_blank" rel="noopener noreferrer" style={{ color: '#25d366' }}>WhatsApp +971 50 392 0037</a>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {users.length > 0 ? (
              <table className="sa-modern-table">
                <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th></tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td><strong>{u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || '—'}</strong></td>
                      <td className="sa-mono">{u.username || '—'}</td>
                      <td>{u.email}</td>
                      <td><span className="sa-role-pill">{u.role}</span></td>
                      <td><span className="sa-status-pill" style={{ color: u.is_active ? '#10b981' : '#6b7280', background: u.is_active ? '#ecfdf5' : '#f3f4f6' }}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="sa-empty-small"><User size={32} /><p>No users found for this workshop</p></div>
            )}

            {/* Add User Modal */}
            {showAddUserModal && (
              <div className="sa-modal-overlay" onClick={e => e.target === e.currentTarget && setShowAddUserModal(false)}>
                <div className="sa-modal" style={{ maxWidth: 500 }}>
                  <div className="sa-modal-header">
                    <h3>Add User to {workshop?.name}</h3>
                    <button className="sa-modal-close" onClick={() => setShowAddUserModal(false)}>&times;</button>
                  </div>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    setAddingUser(true);
                    try {
                      const token = localStorage.getItem('superAdminToken');
                      const res = await fetch(`${API}/super-admin/workshops/${id}/users`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify(addUserForm),
                      });
                      const data = await res.json();
                      if (data.success) {
                        showToast(data.message || 'User added successfully');
                        setShowAddUserModal(false);
                        fetchAll(); // refresh
                      } else if (data.upgrade_required) {
                        setShowAddUserModal(false);
                        setUserLimitError({
                          message: data.message,
                          current: data.current_usage,
                          max: data.limit,
                          plan: data.current_plan,
                        });
                      } else {
                        showToast(data.message || 'Failed to add user', 'error');
                      }
                    } catch (err) {
                      showToast('Failed to add user', 'error');
                    }
                    setAddingUser(false);
                  }} style={{ padding: 20 }}>
                    <div style={{ display: 'grid', gap: 14 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Full Name *</label>
                        <input className="sa-input" value={addUserForm.full_name} onChange={e => setAddUserForm(p => ({ ...p, full_name: e.target.value }))} required />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Username *</label>
                        <input className="sa-input" value={addUserForm.username} onChange={e => setAddUserForm(p => ({ ...p, username: e.target.value }))} required />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Email *</label>
                        <input className="sa-input" type="email" value={addUserForm.email} onChange={e => setAddUserForm(p => ({ ...p, email: e.target.value }))} required />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Phone</label>
                        <input className="sa-input" value={addUserForm.phone} onChange={e => setAddUserForm(p => ({ ...p, phone: e.target.value }))} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Role</label>
                        <select className="sa-input" value={addUserForm.role} onChange={e => setAddUserForm(p => ({ ...p, role: e.target.value }))}>
                          <option value="admin">Admin</option>
                          <option value="dispatcher">Service Advisor</option>
                          <option value="mechanic">Mechanic</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Password *</label>
                        <input className="sa-input" type="password" value={addUserForm.password} onChange={e => setAddUserForm(p => ({ ...p, password: e.target.value }))} required minLength={6} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                      <button type="button" className="sa-btn sa-btn-outline" onClick={() => setShowAddUserModal(false)}>Cancel</button>
                      <button type="submit" className="sa-primary-btn" disabled={addingUser}>
                        {addingUser ? 'Adding...' : 'Add User'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- BILLING HISTORY ---- */}
        {activeTab === 'billing' && (
          <div className="sa-modern-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <h3 className="sa-card-heading" style={{ margin: 0 }}>
                Payment History
                {billing?.summary && (
                  <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 500, color: '#6b7280' }}>
                    {billing.summary.cycle === 'yearly' ? 'Yearly' : 'Monthly'} cycle
                  </span>
                )}
              </h3>
              <button className="sa-btn sa-btn-outline" onClick={fetchBilling} disabled={billingLoading}>
                <RefreshDouble size={14} /> {billingLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {billingLoading && !billing && (
              <div className="sa-skeleton-grid">
                <div className="sa-skeleton-card" style={{ height: 60 }} />
                <div className="sa-skeleton-card" style={{ height: 60 }} />
                <div className="sa-skeleton-card" style={{ height: 60 }} />
              </div>
            )}

            {billing && (
              <>
                {/* Summary chips */}
                <div className="sa-billing-summary">
                  <div className="sa-billing-stat">
                    <div className="sa-billing-stat-value">{billing.summary.total_periods}</div>
                    <div className="sa-billing-stat-label">{billing.summary.cycle === 'yearly' ? 'Years' : 'Months'} billed</div>
                  </div>
                  <div className="sa-billing-stat sa-billing-stat-paid">
                    <div className="sa-billing-stat-value">{billing.summary.paid_periods}</div>
                    <div className="sa-billing-stat-label">Paid</div>
                  </div>
                  <div className="sa-billing-stat sa-billing-stat-unpaid">
                    <div className="sa-billing-stat-value">{billing.summary.unpaid_periods}</div>
                    <div className="sa-billing-stat-label">Unpaid</div>
                  </div>
                  <div className="sa-billing-stat sa-billing-stat-total">
                    <div className="sa-billing-stat-value">
                      {billing.summary.currency} {Number(billing.summary.total_paid_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                    <div className="sa-billing-stat-label">Total received</div>
                  </div>
                </div>

                {billing.periods.length === 0 ? (
                  <div className="sa-empty" style={{ padding: 32 }}>
                    <Clock size={36} />
                    <h4 style={{ margin: '12px 0 4px' }}>No billing periods yet</h4>
                    <p style={{ color: '#6b7280', fontSize: 13 }}>
                      This workshop hasn't completed a paid billing cycle. They may still be on trial or recently activated.
                    </p>
                  </div>
                ) : (
                  <div className="sa-table-wrapper" style={{ marginTop: 16 }}>
                    <table className="sa-modern-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{billing.summary.cycle === 'yearly' ? 'Year' : 'Month'}</th>
                          <th>Status</th>
                          <th>Amount</th>
                          <th>Paid On</th>
                          <th>Method</th>
                          <th>Invoice</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.periods.map((p, idx) => (
                          <tr key={p.period_start} className={p.paid ? '' : (p.current ? '' : 'row-past-due')}>
                            <td style={{ color: '#6b7280' }}>{idx + 1}</td>
                            <td><strong>{p.label}</strong></td>
                            <td>
                              {p.paid ? (
                                <span className="sa-status-pill" style={{ color: '#10b981', background: '#ecfdf5' }}>
                                  <CheckCircle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Paid
                                </span>
                              ) : p.current ? (
                                <span className="sa-status-pill" style={{ color: '#f59e0b', background: '#fffbeb' }}>
                                  <Clock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Current
                                </span>
                              ) : (
                                <span className="sa-status-pill" style={{ color: '#dc2626', background: '#fef2f2' }}>
                                  <Xmark size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Unpaid
                                </span>
                              )}
                            </td>
                            <td>
                              {p.paid && p.invoice
                                ? `${p.invoice.currency || p.currency} ${Number(p.invoice.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                : p.expected_amount
                                  ? <span style={{ color: '#6b7280' }}>{p.currency} {Number(p.expected_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>(expected)</small></span>
                                  : '—'}
                            </td>
                            <td>{p.invoice?.paid_at ? new Date(p.invoice.paid_at).toLocaleDateString() : '—'}</td>
                            <td style={{ textTransform: 'capitalize' }}>{p.invoice?.payment_method?.replace(/_/g, ' ') || '—'}</td>
                            <td className="sa-mono" style={{ fontSize: 12, color: '#6b7280' }}>
                              {p.invoice?.invoice_number || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ---- MODULES ---- */}
        {activeTab === 'modules' && (
          <div className="sa-modern-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="sa-card-heading" style={{ margin: 0 }}>Modules ({allowedModules.length} enabled of {allModules.length})</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="sa-btn sa-btn-outline" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => toggleAllModules(true)}>Enable All</button>
                <button className="sa-btn sa-btn-outline" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => toggleAllModules(false)}>Disable All</button>
              </div>
            </div>
            {allModules.length > 0 ? (
              <div className="sa-modules-grid">
                {allModules.map(m => {
                  const enabled = allowedModules.includes(m.id);
                  return (
                    <div key={m.id} className={`sa-module-chip ${enabled ? 'enabled' : 'disabled'}`} onClick={() => toggleModule(m.id)} style={{ cursor: 'pointer' }}>
                      <Package size={16} />
                      <span>{m.name}</span>
                      {enabled && <CheckCircle size={14} className="sa-module-check" />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="sa-empty-small"><Package size={32} /><p>No modules available</p></div>
            )}
          </div>
        )}

        {/* ---- BRANDING ---- */}
        {activeTab === 'branding' && (
          <div className="sa-modern-card">
            <h3 className="sa-card-heading">Branding Preview</h3>
            {branding && (branding.logo_url || branding.primary_color) ? (
              <div className="sa-branding-preview">
                {branding.logo_url && <div className="sa-branding-logo"><img src={branding.logo_url} alt="Logo" /><span>Logo</span></div>}
                <div className="sa-color-swatches">
                  {branding.primary_color && <div className="sa-swatch"><div className="sa-swatch-circle" style={{background: branding.primary_color}} /><span>Primary</span><code>{branding.primary_color}</code></div>}
                  {branding.secondary_color && <div className="sa-swatch"><div className="sa-swatch-circle" style={{background: branding.secondary_color}} /><span>Secondary</span><code>{branding.secondary_color}</code></div>}
                  {branding.accent_color && <div className="sa-swatch"><div className="sa-swatch-circle" style={{background: branding.accent_color}} /><span>Accent</span><code>{branding.accent_color}</code></div>}
                </div>
                {branding.company_name && <div style={{marginTop: 12, fontSize: 13, color: '#64748b'}}>Brand Name: <strong>{branding.company_name}</strong></div>}
              </div>
            ) : (
              <div className="sa-empty-small"><Palette size={32} /><p>No branding configured for this workshop</p></div>
            )}
          </div>
        )}

        {/* ---- SETTINGS / DANGER ZONE ---- */}
        {activeTab === 'settings' && (
          <div className="sa-settings-stack">
            <div className="sa-modern-card">
              <h3 className="sa-card-heading">Quick Actions</h3>
              <div className="sa-actions-row">
                <button className="sa-btn sa-btn-outline" onClick={toggleStatus}>
                  {workshop.status === 'active' ? <><Pause size={16} /> Suspend Workshop</> : <><Play size={16} /> Activate Workshop</>}
                </button>
                <button className="sa-btn sa-btn-outline" onClick={impersonate}><OpenNewWindow size={16} /> Impersonate Admin</button>
                <button className="sa-btn sa-btn-outline" onClick={() => copyText(`${window.location.origin}/super-admin/workshops/${workshop.id}`)}><Copy size={16} /> Copy Link</button>
              </div>
            </div>
            <div className="sa-danger-bay">
              <h3><WarningTriangle size={18} /> Danger ServiceBay</h3>
              <p>Permanently delete this workshop and all associated data. This action cannot be undone.</p>
              <div className="sa-delete-confirm">
                <label>Type <strong>{companyName}</strong> to confirm:</label>
                <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder={companyName} />
                <button className="sa-btn sa-btn-danger" disabled={deleteConfirm !== companyName} onClick={handleDelete}>
                  <Trash size={16} /> Delete Workshop
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && <div className={`sa-toast ${toast.type}`}>{toast.type === 'success' ? <CheckCircle size={18} /> : <WarningTriangle size={18} />} {toast.msg}</div>}
    </div>
  );
};

export default SuperAdminWorkshopDetail;
