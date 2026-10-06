import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard, Plus, EditPencil, Trash, CheckCircle, Clock,
  Xmark, Eye, Building, Refresh, Search, Filter, DeliveryTruck, Check, Globe,
  Star, User, Group, Package, ArrowRight, WarningTriangle, Calendar,
} from 'iconoir-react';
import './SuperAdmin.css';
import { TableSkeleton } from '../../components/Loader';

import { useConfirm } from './components';
const API = import.meta.env.VITE_API_URL || '/api';
const token = () => localStorage.getItem('superAdminToken');
const headers = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

const PLAN_GRADIENTS = {
  trial:        { bg: 'linear-gradient(135deg, #64748b 0%, #475569 100%)', accent: '#64748b', light: '#f1f5f9' },
  starter:      { bg: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', accent: '#3b82f6', light: '#eff6ff' },
  growth:       { bg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', accent: '#8b5cf6', light: '#f5f3ff' },
  professional: { bg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', accent: '#8b5cf6', light: '#f5f3ff' },
  enterprise:   { bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', accent: '#f59e0b', light: '#fffbeb' },
  self_hosted:  { bg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', accent: '#10b981', light: '#ecfdf5' },
};
const DEFAULT_GRADIENT = { bg: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', accent: '#6366f1', light: '#eef2ff' };

const STATUS_CONFIG = {
  active:        { color: '#16a34a', bg: '#dcfce7', icon: '●' },
  trialing:      { color: '#f59e0b', bg: '#fef3c7', icon: '◐' },
  trial_expired: { color: '#dc2626', bg: '#fee2e2', icon: '○' },
  past_due:      { color: '#dc2626', bg: '#fee2e2', icon: '!' },
  cancelled:     { color: '#6b7280', bg: '#f3f4f6', icon: '✕' },
  paused:        { color: '#c2410c', bg: '#fff7ed', icon: '‖' },
  suspended:     { color: '#7c2d12', bg: '#fee2e2', icon: '⊘' },
};

const ALL_PLAN_SLUGS = ['trial', 'starter', 'growth', 'professional', 'enterprise', 'self_hosted'];
const ALL_SUB_STATUSES = ['active', 'trialing', 'trial_expired', 'past_due', 'cancelled', 'paused', 'suspended'];

const SuperAdminSubscriptions = () => {
  const askConfirm = useConfirm();
  const [tab, setTab] = useState('plans');
  const [plans, setPlans] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [editPlan, setEditPlan] = useState(null);
  const [editSub, setEditSub] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState({});
  const [workshops, setWorkshops] = useState([]);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState('AED');

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => { fetchData(); }, [tab]);
  useEffect(() => {
    fetch(`${API}/super-admin/settings`, { headers: headers() })
      .then(r => r.ok ? r.json() : null)
      .then(s => { if (s?.default_currency) setCurrency(s.default_currency); })
      .catch(() => {});
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === 'plans') {
        const res = await fetch(`${API}/super-admin/plans`, { headers: headers() });
        if (res.ok) setPlans(await res.json());
      } else if (tab === 'subscriptions') {
        const [subRes, planRes] = await Promise.all([
          fetch(`${API}/super-admin/subscriptions`, { headers: headers() }),
          fetch(`${API}/super-admin/plans`, { headers: headers() }),
        ]);
        if (subRes.ok) { const d = await subRes.json(); setSubscriptions(d.subscriptions || []); }
        if (planRes.ok) setPlans(await planRes.json());
      } else if (tab === 'invoices') {
        const [invRes, tRes] = await Promise.all([
          fetch(`${API}/super-admin/invoices`, { headers: headers() }),
          fetch(`${API}/super-admin/workshops?limit=999`, { headers: headers() }),
        ]);
        if (invRes.ok) { const d = await invRes.json(); setInvoices(d.invoices || []); }
        if (tRes.ok) { const td = await tRes.json(); setWorkshops(td.workshops || []); }
      }
    } catch (e) { console.error(e); showToast('Failed to load data', 'error'); }
    setLoading(false);
  };

  const savePlan = async () => {
    if (!editPlan.name || !editPlan.slug) { showToast('Name and slug are required', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/super-admin/plans`, {
        method: 'POST', headers: headers(), body: JSON.stringify(editPlan)
      });
      if (res.ok) {
        setShowPlanModal(false); setEditPlan(null); fetchData();
        showToast(editPlan.id ? 'Plan updated successfully' : 'Plan created successfully');
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Failed to save plan', 'error');
      }
    } catch (e) { showToast('Failed to save plan', 'error'); }
    setSaving(false);
  };

  const deletePlan = async (id) => {
    if (!(await askConfirm({ title: 'Delete plan?', message: 'This cannot be undone. Existing subscriptions on this plan will not be affected.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      const res = await fetch(`${API}/super-admin/plans/${id}`, { method: 'DELETE', headers: headers() });
      if (res.ok) { fetchData(); showToast('Plan deleted'); }
      else showToast('Failed to delete plan', 'error');
    } catch { showToast('Failed to delete plan', 'error'); }
  };

  const updateSubscription = async () => {
    if (!editSub) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/super-admin/subscriptions/${editSub.id}`, {
        method: 'PUT', headers: headers(), body: JSON.stringify(editSub)
      });
      if (res.ok) { setEditSub(null); fetchData(); showToast('Subscription updated'); }
      else showToast('Failed to update subscription', 'error');
    } catch { showToast('Failed to update subscription', 'error'); }
    setSaving(false);
  };

  const createInvoice = async () => {
    if (!invoiceForm.workshop_id || !invoiceForm.amount) { showToast('Workshop and amount are required', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/super-admin/invoices`, {
        method: 'POST', headers: headers(), body: JSON.stringify(invoiceForm)
      });
      if (res.ok) { setShowInvoiceModal(false); setInvoiceForm({}); fetchData(); showToast('Invoice created'); }
      else showToast('Failed to create invoice', 'error');
    } catch { showToast('Failed to create invoice', 'error'); }
    setSaving(false);
  };

  const updateInvoiceStatus = async (id, status) => {
    try {
      const res = await fetch(`${API}/super-admin/invoices/${id}`, {
        method: 'PUT', headers: headers(), body: JSON.stringify({ status })
      });
      if (res.ok) { fetchData(); showToast(`Invoice marked as ${status}`); }
      else showToast('Failed to update invoice', 'error');
    } catch { showToast('Failed to update', 'error'); }
  };

  const fmtCur = (n) => `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const safeFeatures = (f) => { if (Array.isArray(f)) return f; if (typeof f === 'string') { try { const p = JSON.parse(f); return Array.isArray(p) ? p : []; } catch { return []; } } return []; };

  const getPlanTheme = (slug) => PLAN_GRADIENTS[slug] || PLAN_GRADIENTS[slug?.toLowerCase()] || DEFAULT_GRADIENT;
  const getStatusStyle = (status) => STATUS_CONFIG[status] || STATUS_CONFIG.active;

  // Summary stats
  const activePlans = plans.filter(p => p.is_active).length;
  const activeSubs = subscriptions.filter(s => s.status === 'active').length;
  const totalMRR = subscriptions.filter(s => s.status === 'active').reduce((sum, s) => sum + Number(s.price_monthly || 0), 0);
  const paidInvoices = invoices.filter(i => i.status === 'paid').length;

  // Dynamic plan options for subscription edit (from actual plans loaded)
  const planOptions = plans.length > 0
    ? [...new Set([...plans.map(p => p.slug), ...ALL_PLAN_SLUGS])]
    : ALL_PLAN_SLUGS;

  const TAB_CONFIG = [
    { key: 'plans', label: 'Plans', icon: <CreditCard width={16} height={16} /> },
    { key: 'subscriptions', label: 'Subscriptions', icon: <Group width={16} height={16} /> },
    { key: 'invoices', label: 'Invoices', icon: <Calendar width={16} height={16} /> },
  ];

  return (
    <div className="sa-page">
      {/* Toast */}
      {toast && (
        <div className={`sa-sub-toast ${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle width={16} height={16} /> : <WarningTriangle width={16} height={16} />}
          {toast.message}
        </div>
      )}

      <div className="sa-page-header">
        <div>
          <h1>Subscriptions & Billing</h1>
          <p>Manage plans, subscriptions, and invoices</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="sa-sub-stats">
        <div className="sa-sub-stat-card" onClick={() => setTab('plans')}>
          <div className="sa-sub-stat-icon" style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
            <CreditCard width={20} height={20} />
          </div>
          <div className="sa-sub-stat-info">
            <span className="sa-sub-stat-value">{activePlans}</span>
            <span className="sa-sub-stat-label">Active Plans</span>
          </div>
        </div>
        <div className="sa-sub-stat-card" onClick={() => setTab('subscriptions')}>
          <div className="sa-sub-stat-icon" style={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' }}>
            <Group width={20} height={20} />
          </div>
          <div className="sa-sub-stat-info">
            <span className="sa-sub-stat-value">{activeSubs}</span>
            <span className="sa-sub-stat-label">Active Subscriptions</span>
          </div>
        </div>
        <div className="sa-sub-stat-card">
          <div className="sa-sub-stat-icon" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>$</span>
          </div>
          <div className="sa-sub-stat-info">
            <span className="sa-sub-stat-value">{fmtCur(totalMRR)}</span>
            <span className="sa-sub-stat-label">Monthly Recurring</span>
          </div>
        </div>
        <div className="sa-sub-stat-card" onClick={() => setTab('invoices')}>
          <div className="sa-sub-stat-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
            <CheckCircle width={20} height={20} />
          </div>
          <div className="sa-sub-stat-info">
            <span className="sa-sub-stat-value">{paidInvoices}</span>
            <span className="sa-sub-stat-label">Paid Invoices</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sa-sub-tabs">
        {TAB_CONFIG.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`sa-sub-tab ${tab === t.key ? 'active' : ''}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : (
        <>
          {/* ═══ PLANS TAB ═══ */}
          {tab === 'plans' && (
            <>
              <div className="sa-sub-toolbar">
                <span className="sa-sub-toolbar-count">{plans.length} plan{plans.length !== 1 ? 's' : ''}</span>
                <button className="sa-primary-btn" onClick={() => { setEditPlan({ name: '', slug: '', description: '', max_mechanics: 10, max_users: 5, max_orders_per_month: 1000, price_aed: 0, setup_fee_aed: 0, features: [], is_active: true, base_stops: 0, extra_rate_aed: 0, is_featured: false, badge_key: '', landing_features: [], landing_visible: true, sort_order: 0 }); setShowPlanModal(true); }}>
                  <Plus size={16} /> New Plan
                </button>
              </div>
              {plans.length === 0 ? (
                <div className="sa-sub-empty">
                  <CreditCard width={48} height={48} />
                  <h3>No Plans Yet</h3>
                  <p>Create your first pricing plan to get started</p>
                  <button className="sa-primary-btn" onClick={() => { setEditPlan({ name: '', slug: '', description: '', max_mechanics: 10, max_users: 5, max_orders_per_month: 1000, price_aed: 0, setup_fee_aed: 0, features: [], is_active: true, base_stops: 0, extra_rate_aed: 0, is_featured: false, badge_key: '', landing_features: [], landing_visible: true, sort_order: 0 }); setShowPlanModal(true); }}>
                    <Plus size={16} /> Create First Plan
                  </button>
                </div>
              ) : (
              <div className="sa-sub-plans-grid">
                {plans.map(plan => {
                  const theme = getPlanTheme(plan.slug);
                  const features = safeFeatures(plan.features);
                  return (
                  <div key={plan.id} className={`sa-sub-plan-card ${plan.is_featured ? 'featured' : ''}`}>
                    {!!plan.is_featured && <div className="sa-sub-plan-ribbon"><Star width={12} height={12} /> Featured</div>}
                    {plan.subscriber_count > 0 && (
                      <div className="sa-sub-plan-sub-count">
                        <Group width={12} height={12} />
                        {plan.subscriber_count} active
                      </div>
                    )}
                    <div className="sa-sub-plan-top" style={{ background: theme.bg }}>
                      <div className="sa-sub-plan-name">{plan.name}</div>
                      <div className="sa-sub-plan-status-row">
                        <span className={`sa-sub-plan-badge ${plan.is_active ? 'active' : 'inactive'}`}>
                          {plan.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {plan.landing_visible ? (
                          <span className="sa-sub-plan-badge landing"><Globe width={11} height={11} /> #{plan.sort_order}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="sa-sub-plan-body">
                      <div className="sa-sub-plan-price-row">
                        <span className="sa-sub-plan-price" style={{ color: theme.accent }}>{fmtCur(plan.price_aed)}</span>
                        <span className="sa-sub-plan-period">/mo</span>
                      </div>
                      {plan.setup_fee_aed > 0 && (
                        <div className="sa-sub-plan-setup">+{fmtCur(plan.setup_fee_aed)} setup fee</div>
                      )}
                      {plan.description && <div className="sa-sub-plan-desc">{plan.description}</div>}

                      {plan.base_stops > 0 && (
                        <div className="sa-sub-plan-delivery" style={{ background: theme.light }}>
                          <DeliveryTruck width={15} height={15} style={{ color: theme.accent }} />
                          <span><strong>{Number(plan.base_stops).toLocaleString()}</strong> stops included</span>
                          <span className="sa-sub-plan-extra">+{Number(plan.extra_rate_aed || 0).toFixed(4)} {currency}/extra</span>
                        </div>
                      )}

                      <div className="sa-sub-plan-limits">
                        <div className="sa-sub-plan-limit-item">
                          <User width={14} height={14} />
                          <strong>{plan.max_users || 5}</strong> Users
                        </div>
                        <div className="sa-sub-plan-limit-item">
                          <Group width={14} height={14} />
                          <strong>{plan.max_mechanics}</strong> Mechanics
                        </div>
                        <div className="sa-sub-plan-limit-item">
                          <Package width={14} height={14} />
                          <strong>{Number(plan.max_orders_per_month).toLocaleString()}</strong> WorkOrders/mo
                        </div>
                      </div>

                      {features.length > 0 && (
                        <div className="sa-sub-plan-features">
                          {features.map((f, i) => (
                            <div key={i} className="sa-sub-plan-feat">
                              <CheckCircle width={14} height={14} style={{ color: theme.accent, flexShrink: 0 }} />
                              <span>{f}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="sa-sub-plan-actions">
                      <button onClick={() => { setEditPlan(plan); setShowPlanModal(true); }} className="sa-sub-plan-btn edit">
                        <EditPencil width={14} height={14} /> Edit
                      </button>
                      <button onClick={() => deletePlan(plan.id)} className="sa-sub-plan-btn delete">
                        <Trash width={14} height={14} />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
              )}
            </>
          )}

          {/* ═══ SUBSCRIPTIONS TAB ═══ */}
          {tab === 'subscriptions' && (
            <>
              <div className="sa-sub-toolbar">
                <span className="sa-sub-toolbar-count">{subscriptions.length} subscription{subscriptions.length !== 1 ? 's' : ''}</span>
              </div>
              {subscriptions.length === 0 ? (
                <div className="sa-sub-empty">
                  <Group width={48} height={48} />
                  <h3>No Subscriptions</h3>
                  <p>Subscriptions will appear when workshops sign up</p>
                </div>
              ) : (
              <div className="sa-card sa-sub-table-card">
                <div className="sa-table-container">
                  <table className="sa-table sa-sub-table">
                    <thead>
                      <tr>
                        <th>Workshop</th>
                        <th>Plan</th>
                        <th>Status</th>
                        <th>Users</th>
                        <th>Billing</th>
                        <th>Monthly Price</th>
                        <th>Period End</th>
                        <th style={{ width: 60 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subscriptions.map(sub => {
                        const theme = getPlanTheme(sub.plan);
                        const statusCfg = getStatusStyle(sub.status);
                        return (
                          <tr key={sub.id}>
                            <td>
                              <div className="sa-sub-workshop-cell">
                                <div className="sa-sub-workshop-avatar" style={{ background: theme.bg }}>
                                  {(sub.workshop_name || 'T')[0].toUpperCase()}
                                </div>
                                <div>
                                  <div className="sa-sub-workshop-name">{sub.workshop_name || `Workshop #${sub.workshop_id}`}</div>
                                  {sub.workshop_email && <div className="sa-sub-workshop-email">{sub.workshop_email}</div>}
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="sa-sub-plan-pill" style={{ background: theme.light, color: theme.accent, borderColor: `${theme.accent}30` }}>
                                {sub.plan}
                              </span>
                            </td>
                            <td>
                              <span className="sa-sub-status-pill" style={{ background: statusCfg.bg, color: statusCfg.color }}>
                                <span className="sa-sub-status-dot" style={{ background: statusCfg.color }} />
                                {sub.status?.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td><span className="sa-sub-cell-num">{sub.max_users}</span></td>
                            <td><span className="sa-sub-cell-cycle">{sub.billing_cycle}</span></td>
                            <td><span className="sa-sub-cell-price">{fmtCur(sub.price_monthly)}</span></td>
                            <td><span className="sa-sub-cell-date">{fmtDate(sub.current_period_end)}</span></td>
                            <td>
                              <button className="sa-sub-edit-btn" onClick={() => setEditSub({ ...sub })} title="Edit subscription">
                                <EditPencil width={15} height={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </>
          )}

          {/* ═══ INVOICES TAB ═══ */}
          {tab === 'invoices' && (
            <>
              <div className="sa-sub-toolbar">
                <span className="sa-sub-toolbar-count">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</span>
                <button className="sa-primary-btn" onClick={() => setShowInvoiceModal(true)}>
                  <Plus size={16} /> Create Invoice
                </button>
              </div>
              {invoices.length === 0 ? (
                <div className="sa-sub-empty">
                  <Calendar width={48} height={48} />
                  <h3>No Invoices Yet</h3>
                  <p>Create an invoice to start billing workshops</p>
                  <button className="sa-primary-btn" onClick={() => setShowInvoiceModal(true)}>
                    <Plus size={16} /> Create First Invoice
                  </button>
                </div>
              ) : (
              <div className="sa-card sa-sub-table-card">
                <div className="sa-table-container">
                  <table className="sa-table sa-sub-table">
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Workshop</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Due Date</th>
                        <th>Paid At</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(inv => {
                        const statusCfg = getStatusStyle(inv.status === 'paid' ? 'active' : inv.status === 'overdue' ? 'past_due' : inv.status === 'sent' ? 'trialing' : 'cancelled');
                        return (
                          <tr key={inv.id}>
                            <td><code className="sa-sub-invoice-num">{inv.invoice_number}</code></td>
                            <td className="sa-sub-workshop-name">{inv.workshop_name || `#${inv.workshop_id}`}</td>
                            <td><strong className="sa-sub-cell-price">{fmtCur(inv.amount)}</strong></td>
                            <td>
                              <span className={`sa-sub-status-pill`} style={{ background: statusCfg.bg, color: statusCfg.color }}>
                                <span className="sa-sub-status-dot" style={{ background: statusCfg.color }} />
                                {inv.status}
                              </span>
                            </td>
                            <td className="sa-sub-cell-date">{fmtDate(inv.due_date)}</td>
                            <td className="sa-sub-cell-date">{fmtDate(inv.paid_at)}</td>
                            <td>
                              <div className="sa-sub-invoice-actions">
                                {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                                  <button className="sa-sub-action-btn success" onClick={() => updateInvoiceStatus(inv.id, 'paid')} title="Mark Paid">
                                    <CheckCircle width={15} height={15} />
                                  </button>
                                )}
                                {inv.status === 'draft' && (
                                  <button className="sa-sub-action-btn info" onClick={() => updateInvoiceStatus(inv.id, 'sent')} title="Mark Sent">
                                    <ArrowRight width={15} height={15} />
                                  </button>
                                )}
                                {inv.status === 'sent' && (
                                  <button className="sa-sub-action-btn warning" onClick={() => updateInvoiceStatus(inv.id, 'overdue')} title="Mark Overdue">
                                    <Clock width={15} height={15} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </>
          )}
        </>
      )}

      {/* ═══ Plan Modal ═══ */}
      {showPlanModal && editPlan && (
        <div className="sa-modal-backdrop" onClick={() => setShowPlanModal(false)}>
          <div className="sa-modal sa-sub-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="sa-modal-header">
              <h2>{editPlan.id ? 'Edit Plan' : 'New Plan'}</h2>
              <button className="sa-modal-close" onClick={() => setShowPlanModal(false)}>×</button>
            </div>
            <div className="sa-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div className="sa-sub-modal-section-title">Core Plan Settings</div>
              <div className="sa-form-grid">
                <div className="sa-form-group">
                  <label>Plan Name</label>
                  <input value={editPlan.name} onChange={e => setEditPlan({ ...editPlan, name: e.target.value })} placeholder="e.g. Growth" />
                </div>
                <div className="sa-form-group">
                  <label>Slug</label>
                  <input value={editPlan.slug} onChange={e => setEditPlan({ ...editPlan, slug: e.target.value })} placeholder="e.g. growth" />
                </div>
                <div className="sa-form-group full-width">
                  <label>Description</label>
                  <input value={editPlan.description || ''} onChange={e => setEditPlan({ ...editPlan, description: e.target.value })} placeholder="Brief plan description" />
                </div>
                <div className="sa-form-group">
                  <label>Price ({currency}/mo)</label>
                  <input type="number" value={editPlan.price_aed} onChange={e => setEditPlan({ ...editPlan, price_aed: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="sa-form-group">
                  <label>Setup Fee ({currency})</label>
                  <input type="number" value={editPlan.setup_fee_aed || 0} onChange={e => setEditPlan({ ...editPlan, setup_fee_aed: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="sa-form-group">
                  <label>Max Users</label>
                  <input type="number" value={editPlan.max_users || 5} onChange={e => setEditPlan({ ...editPlan, max_users: parseInt(e.target.value) || 5 })} />
                </div>
                <div className="sa-form-group">
                  <label>Max Mechanics</label>
                  <input type="number" value={editPlan.max_mechanics} onChange={e => setEditPlan({ ...editPlan, max_mechanics: parseInt(e.target.value) || 10 })} />
                </div>
                <div className="sa-form-group">
                  <label>Max WorkOrders/Month</label>
                  <input type="number" value={editPlan.max_orders_per_month} onChange={e => setEditPlan({ ...editPlan, max_orders_per_month: parseInt(e.target.value) || 1000 })} />
                </div>
                <div className="sa-form-group full-width">
                  <label>Features (comma-separated)</label>
                  <textarea
                    rows={3}
                    value={safeFeatures(editPlan.features).join(', ')}
                    onChange={e => setEditPlan({ ...editPlan, features: e.target.value.split(',').map(f => f.trim()).filter(Boolean) })}
                    placeholder="Feature 1, Feature 2, ..."
                  />
                </div>
              </div>

              <div className="sa-sub-modal-section-title accent">
                <Globe width={14} height={14} /> Landing Page ServicePricing
              </div>
              <div className="sa-form-grid">
                <div className="sa-form-group">
                  <label>Base Stops (included deliveries)</label>
                  <input type="number" value={editPlan.base_stops || 0} onChange={e => setEditPlan({ ...editPlan, base_stops: parseInt(e.target.value) || 0 })} placeholder="e.g. 1000" />
                </div>
                <div className="sa-form-group">
                  <label>Extra Rate ({currency}/delivery)</label>
                  <input type="number" step="0.0001" value={editPlan.extra_rate_aed || 0} onChange={e => setEditPlan({ ...editPlan, extra_rate_aed: parseFloat(e.target.value) || 0 })} placeholder="e.g. 0.04" />
                </div>
                <div className="sa-form-group">
                  <label>Sort WorkOrder</label>
                  <input type="number" value={editPlan.sort_order || 0} onChange={e => setEditPlan({ ...editPlan, sort_order: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="sa-form-group">
                  <label>Badge i18n Key</label>
                  <input value={editPlan.badge_key || ''} onChange={e => setEditPlan({ ...editPlan, badge_key: e.target.value })} placeholder="e.g. pricing.bestForFleets" />
                </div>
                <div className="sa-form-group full-width sa-sub-checkbox-row">
                  <label className="sa-sub-checkbox">
                    <input type="checkbox" checked={!!editPlan.is_featured} onChange={e => setEditPlan({ ...editPlan, is_featured: e.target.checked })} />
                    <span className="sa-sub-checkbox-mark" />
                    Featured Plan
                  </label>
                  <label className="sa-sub-checkbox">
                    <input type="checkbox" checked={editPlan.landing_visible !== false && editPlan.landing_visible !== 0} onChange={e => setEditPlan({ ...editPlan, landing_visible: e.target.checked })} />
                    <span className="sa-sub-checkbox-mark" />
                    Visible on Landing
                  </label>
                </div>
                <div className="sa-form-group full-width">
                  <label>Landing Feature Keys (comma-separated i18n keys)</label>
                  <textarea
                    rows={2}
                    value={safeFeatures(editPlan.landing_features).join(', ')}
                    onChange={e => setEditPlan({ ...editPlan, landing_features: e.target.value.split(',').map(f => f.trim()).filter(Boolean) })}
                    placeholder="starterF1, starterF2, starterF3"
                  />
                </div>
              </div>
            </div>
            <div className="sa-modal-footer">
              <button className="sa-secondary-btn" onClick={() => setShowPlanModal(false)}>Cancel</button>
              <button className="sa-primary-btn" onClick={savePlan} disabled={saving}>
                {saving ? 'Saving...' : 'Save Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Subscription Edit Modal ═══ */}
      {editSub && (
        <div className="sa-modal-backdrop" onClick={() => setEditSub(null)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()}>
            <div className="sa-modal-header">
              <h2>Edit Subscription</h2>
              <button className="sa-modal-close" onClick={() => setEditSub(null)}>×</button>
            </div>
            <div className="sa-sub-modal-workshop-banner">
              <div className="sa-sub-workshop-avatar" style={{ background: getPlanTheme(editSub.plan).bg, width: 36, height: 36, fontSize: 14 }}>
                {(editSub.workshop_name || 'T')[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600, color: '#1e293b' }}>{editSub.workshop_name}</div>
                {editSub.workshop_email && <div style={{ fontSize: 12, color: '#6b7280' }}>{editSub.workshop_email}</div>}
              </div>
            </div>
            <div className="sa-modal-body">
              <div className="sa-form-grid">
                <div className="sa-form-group">
                  <label>Plan</label>
                  <select value={editSub.plan} onChange={e => setEditSub({ ...editSub, plan: e.target.value })}>
                    {planOptions.map(slug => (
                      <option key={slug} value={slug}>{slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Status</label>
                  <select value={editSub.status} onChange={e => setEditSub({ ...editSub, status: e.target.value })}>
                    {ALL_SUB_STATUSES.map(s => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Max Users</label>
                  <input type="number" value={editSub.max_users} onChange={e => setEditSub({ ...editSub, max_users: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="sa-form-group">
                  <label>Billing Cycle</label>
                  <select value={editSub.billing_cycle} onChange={e => setEditSub({ ...editSub, billing_cycle: e.target.value })}>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Monthly Price ({currency})</label>
                  <input type="number" value={editSub.price_monthly} onChange={e => setEditSub({ ...editSub, price_monthly: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="sa-form-group">
                  <label>Period End</label>
                  <input type="date" value={editSub.current_period_end?.substring(0, 10) || ''} onChange={e => setEditSub({ ...editSub, current_period_end: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="sa-modal-footer">
              <button className="sa-secondary-btn" onClick={() => setEditSub(null)}>Cancel</button>
              <button className="sa-primary-btn" onClick={updateSubscription} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Invoice Create Modal ═══ */}
      {showInvoiceModal && (
        <div className="sa-modal-backdrop" onClick={() => setShowInvoiceModal(false)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()}>
            <div className="sa-modal-header">
              <h2>Create Invoice</h2>
              <button className="sa-modal-close" onClick={() => setShowInvoiceModal(false)}>×</button>
            </div>
            <div className="sa-modal-body">
              <div className="sa-form-grid">
                <div className="sa-form-group">
                  <label>Workshop</label>
                  <select value={invoiceForm.workshop_id || ''} onChange={e => setInvoiceForm({ ...invoiceForm, workshop_id: parseInt(e.target.value) })}>
                    <option value="">Select workshop...</option>
                    {workshops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Amount ({currency})</label>
                  <input type="number" step="0.01" value={invoiceForm.amount || ''} onChange={e => setInvoiceForm({ ...invoiceForm, amount: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="sa-form-group">
                  <label>Due Date</label>
                  <input type="date" value={invoiceForm.due_date || ''} onChange={e => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} />
                </div>
                <div className="sa-form-group">
                  <label>Billing Start</label>
                  <input type="date" value={invoiceForm.billing_period_start || ''} onChange={e => setInvoiceForm({ ...invoiceForm, billing_period_start: e.target.value })} />
                </div>
                <div className="sa-form-group">
                  <label>Billing End</label>
                  <input type="date" value={invoiceForm.billing_period_end || ''} onChange={e => setInvoiceForm({ ...invoiceForm, billing_period_end: e.target.value })} />
                </div>
                <div className="sa-form-group full-width">
                  <label>Notes</label>
                  <textarea value={invoiceForm.notes || ''} onChange={e => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} rows={3} placeholder="Optional invoice notes..." />
                </div>
              </div>
            </div>
            <div className="sa-modal-footer">
              <button className="sa-secondary-btn" onClick={() => setShowInvoiceModal(false)}>Cancel</button>
              <button className="sa-primary-btn" onClick={createInvoice} disabled={saving}>
                {saving ? 'Creating...' : 'Create Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminSubscriptions;
