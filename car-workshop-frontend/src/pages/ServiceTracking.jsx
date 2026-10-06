import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Package, DeliveryTruck, MapPin, Clock, Check, Xmark,
  Eye, Copy, NavArrowRight, ArrowDown, ArrowUp, Calendar,
  User, Phone, Mail, Cube, WarningCircle, RefreshDouble,
  Map, Timer, CreditCard, EditPencil, OpenNewWindow, ShareAndroid,
} from 'iconoir-react';
import { api } from '../lib/api';
import './ServiceTracking.css';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';

const STATUS_FLOW = ['pending','confirmed','assigned','picked_up','in_transit','delivered'];
const STATUS_LABELS = {
  pending: 'Pending', confirmed: 'Confirmed', assigned: 'Assigned', accepted: 'Accepted',
  picked_up: 'Picked Up', in_transit: 'In Transit', delivered: 'Delivered',
  failed: 'Failed', returned: 'Returned', cancelled: 'Cancelled'
};
const STATUS_ICONS = {
  pending: Clock, confirmed: Check, assigned: User, accepted: Check, picked_up: Cube,
  in_transit: DeliveryTruck, delivered: Check, failed: Xmark,
  returned: ArrowDown, cancelled: Xmark
};
const STATUS_COLORS = {
  pending: '#94a3b8', confirmed: '#2563eb', assigned: '#7c3aed', accepted: '#1565C0',
  picked_up: '#be185d', in_transit: '#0369a1', delivered: '#16a34a',
  failed: '#dc2626', returned: '#ea580c', cancelled: '#64748b'
};

function getProgressPercent(status) {
  const map = { pending: 10, confirmed: 25, assigned: 40, picked_up: 55, in_transit: 75, delivered: 100, failed: 80, returned: 90, cancelled: 0 };
  return map[status] || 0;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ServiceTracking() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const navigate = useNavigate();
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const [orders, setWorkOrders] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderDetail, setWorkOrderDetail] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [quickTrack, setQuickTrack] = useState('');
  const [quickResult, setQuickResult] = useState(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const limit = 30;

  const showToast = useCallback((msg, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 3000);
  }, []);

  const copyPublicLink = (token) => {
    const url = `${window.location.origin}/track/${token}`;
    navigator.clipboard.writeText(url);
    showToast(t('shipmentTracking.link_copied'));
  };

  const openPublicTracking = (token) => {
    window.open(`/track/${token}`, '_blank');
  };

  const doQuickTrack = async () => {
    if (!quickTrack.trim()) return;
    setQuickLoading(true);
    setQuickResult(null);
    try {
      const res = await api.get(`/service-status/${quickTrack.trim()}`);
      if (res.success) setQuickResult(res.data);
      else showToast(t('shipmentTracking.not_found'), 'error');
    } catch { showToast(t('shipmentTracking.token_not_found'), 'error'); }
    finally { setQuickLoading(false); }
  };

  const loadWorkOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const [ordersRes, statsRes] = await Promise.all([
        api.get(`/work-orders?${params}`),
        api.get('/work-orders/stats')
      ]);
      setWorkOrders(ordersRes?.data || []);
      setTotal(ordersRes?.pagination?.total || 0);
      setStats(statsRes?.data || {});
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search, statusFilter, page]);

  useEffect(() => { loadWorkOrders(); }, [loadWorkOrders]);

  const openDrawer = async (order) => {
    setSelectedOrder(order);
    setDrawerLoading(true);
    try {
      const res = await api.get(`/work-orders/${order.id}`);
      setWorkOrderDetail(res?.data || null);
    } catch (err) { console.error(err); }
    finally { setDrawerLoading(false); }
  };

  const closeDrawer = () => { setSelectedOrder(null); setWorkOrderDetail(null); };

  const tabCounts = useMemo(() => {
    const s = stats;
    return {
      all: parseInt(s.total || 0),
      active: parseInt(s.picked_up || 0) + parseInt(s.in_transit || 0) + parseInt(s.assigned || 0),
      delivered: parseInt(s.delivered || 0),
      failed: parseInt(s.failed || 0) + parseInt(s.returned || 0),
      pending: parseInt(s.pending || 0) + parseInt(s.confirmed || 0),
    };
  }, [stats]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setPage(1);
    const tabStatusMap = { all: '', active: '', delivered: 'delivered', failed: '', pending: '' };
    // For active/failed/pending we'll do customer-side or use status param
    if (tab === 'active') setStatusFilter('in_transit');
    else if (tab === 'failed') setStatusFilter('failed');
    else if (tab === 'pending') setStatusFilter('pending');
    else if (tab === 'delivered') setStatusFilter('delivered');
    else setStatusFilter('');
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast(t('shipmentTracking.copied_clipboard'));
  };

  const totalPages = Math.ceil(total / limit);

  const statCards = [
    { label: t('shipmentTracking.stats.total'), value: stats.total || 0, color: 'primary', bg: '#fff7ed', iconColor: '#f97316', icon: Package },
    { label: t('shipmentTracking.stats.in_transit'), value: parseInt(stats.in_transit || 0) + parseInt(stats.picked_up || 0), color: 'warning', bg: '#fef3c7', iconColor: '#d97706', icon: DeliveryTruck },
    { label: t('shipmentTracking.stats.delivered'), value: stats.delivered || 0, color: 'success', bg: '#dcfce7', iconColor: '#16a34a', icon: Check },
    { label: t('shipmentTracking.stats.failed_returned'), value: parseInt(stats.failed || 0) + parseInt(stats.returned || 0), color: 'danger', bg: '#fee2e2', iconColor: '#ef4444', icon: WarningCircle },
    { label: t('shipmentTracking.stats.today'), value: stats.today || 0, color: 'info', bg: '#eff6ff', iconColor: '#2563eb', icon: Calendar },
  ];

  return (
    <div className="trk-page">
      {/* Toast Notifications */}
      <div style={{ position: 'fixed', top: 24, [isRTL?'left':'right']: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none' }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px',
            borderRadius: 12, fontWeight: 600, fontSize: 14, minWidth: 260,
            boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
            background: toast.type === 'success' ? '#16a34a' : '#dc2626',
            color: '#fff', animation: 'slideInRight 0.3s ease',
          }}>
            {toast.type === 'success' ? <Check width={16} height={16} /> : <WarningCircle width={16} height={16} />}
            {toast.msg}
          </div>
        ))}
      </div>
      <style>{`@keyframes slideInRight{from{opacity:0;transform:translateX(${isRTL ? '-40px' : '40px'})}to{opacity:1;transform:translateX(0)}}`}</style>

      {/* Hero */}
      <div className="module-hero">
        <div className="module-hero-left">
          <div className="module-hero-icon"><MapPin size={26} /></div>
          <div>
            <h1 className="module-hero-title">{t("shipmentTracking.title")}</h1>
            <p className="module-hero-sub">{t('shipmentTracking.subtitle')}</p>
          </div>
        </div>
        <div className="module-hero-actions">
          <button className="module-btn module-btn-outline" onClick={() => navigate('/job-assignment')}>
            <Map size={16} /> {t('shipmentTracking.dispatch_map')}
          </button>
          <button className="module-btn module-btn-outline" onClick={loadWorkOrders}>
            <RefreshDouble size={16} /> {t('shipmentTracking.refresh')}
          </button>
        </div>
      </div>

      {/* Quick Track */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b, #334155)', borderRadius: 16, padding: 20,
        marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff' }}>
          <Search width={18} height={18} />
          <span style={{ fontWeight: 800, fontSize: 16 }}>{t("shipmentTracking.quick_track")}</span>
          <span style={{ fontSize: 12, color: '#94a3b8', [isRTL?'marginRight':'marginLeft']: 4 }}>{t("shipmentTracking.enter_token")}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={quickTrack} onChange={e => setQuickTrack(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doQuickTrack()}
            placeholder={t("shipmentTracking.paste_token")}
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontFamily: 'monospace',
            }}
          />
          <button onClick={doQuickTrack} disabled={quickLoading}
            style={{
              padding: '12px 24px', borderRadius: 10, border: 'none',
              background: '#f97316', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            {quickLoading ? t('shipmentTracking.tracking_loading') : <><Search width={14} height={14} /> {t('shipmentTracking.track_btn')}</>}
          </button>
        </div>

        {/* Quick Track Result */}
        {quickResult && (
          <div style={{
            background: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginTop: 4,
            border: '1px solid rgba(255,255,255,0.1)', animation: 'slideInRight 0.3s ease',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <span style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>{quickResult.work_order_number}</span>
                <span style={{
                  display: 'inline-block', [isRTL?'marginRight':'marginLeft']: 10, padding: '3px 10px', borderRadius: 8,
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  background: STATUS_COLORS[quickResult.status] + '30',
                  color: STATUS_COLORS[quickResult.status] || '#fff',
                }}>
                          {t('shipmentTracking.status.' + quickResult.status)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => copyPublicLink(quickResult.service_status_token)}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600 }}>
                  <Copy width={12} height={12} /> {t('shipmentTracking.copy_link')}
                </button>
                <button onClick={() => openPublicTracking(quickResult.service_status_token)}
                  style={{ background: '#f97316', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600 }}>
                  <OpenNewWindow width={12} height={12} /> {t('shipmentTracking.live_track')}
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('shipmentTracking.recipient')}</div>
                <div style={{ color: '#fff', fontWeight: 700 }}>{quickResult.recipient_name}</div>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('shipmentTracking.mechanic_label')}</div>
                <div style={{ color: '#fff', fontWeight: 700 }}>{quickResult.mechanic_name || t('shipmentTracking.unassigned')}</div>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('shipmentTracking.area')}</div>
                <div style={{ color: '#fff', fontWeight: 700 }}>{quickResult.recipient_area || quickResult.recipient_emirate || '—'}</div>
              </div>
            </div>
            {/* Mini progress */}
            <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.1)', borderRadius: 6, height: 6, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 6, transition: 'width 0.5s',
                width: `${getProgressPercent(quickResult.status)}%`,
                background: quickResult.status === 'delivered' ? '#22c55e' : ['failed','returned','cancelled'].includes(quickResult.status) ? '#ef4444' : '#f97316',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="trk-stats-grid">
        {statCards.map((s, i) => (
          <div key={i} className={`trk-stat-card ${s.color}`}>
            <div className="trk-stat-card-row">
              <div className="trk-stat-icon" style={{ background: s.bg }}>
                <s.icon size={22} color={s.iconColor} />
              </div>
              <div className="trk-stat-body">
                <span className="trk-stat-val">{s.value}</span>
                <span className="trk-stat-lbl">{s.label}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="trk-tabs">
        {[
          { key: 'all', label: t('shipmentTracking.tabs.all'), count: tabCounts.all },
          { key: 'active', label: t('shipmentTracking.tabs.active'), count: tabCounts.active },
          { key: 'delivered', label: t('shipmentTracking.tabs.delivered'), count: tabCounts.delivered },
          { key: 'failed', label: t('shipmentTracking.tabs.failed'), count: tabCounts.failed },
          { key: 'pending', label: t('shipmentTracking.tabs.pending'), count: tabCounts.pending },
        ].map(tab => (
          <button key={tab.key} className={`trk-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => handleTabChange(tab.key)}>
            {tab.label}
            <span className="trk-tab-badge">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="trk-filters">
        <div className="trk-search-wrap">
          <Search size={16} className="trk-search-icon" />
          <input className="trk-search-input" placeholder={t('shipmentTracking.search_placeholder')}
                 value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="trk-spinner" />
      ) : orders.length === 0 ? (
        <div className="trk-empty">
          <div className="trk-empty-icon"><Package size={28} /></div>
          <h3>{t("shipmentTracking.no_shipments")}</h3>
          <p>{t('shipmentTracking.try_adjusting')}</p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="trk-table-wrap">
            <table className="trk-table">
              <thead>
                <tr>
                  <th>{t('shipmentTracking.col.order_num')}</th>
                  <th>{t('shipmentTracking.col.tracking')}</th>
                  <th>{t('shipmentTracking.col.recipient')}</th>
                  <th>{t('shipmentTracking.col.status')}</th>
                  <th>{t("shipmentTracking.progress")}</th>
                  <th>{t('shipmentTracking.col.mechanic')}</th>
                  <th>{t('shipmentTracking.col.bay')}</th>
                  <th>{t('shipmentTracking.col.payment')}</th>
                  <th>{t('shipmentTracking.col.created')}</th>
                  <th>{t('shipmentTracking.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => {
                  const StatusIcon = STATUS_ICONS[order.status] || Clock;
                  const pct = getProgressPercent(order.status);
                  const barColor = order.status === 'delivered' ? 'green' : ['failed','returned','cancelled'].includes(order.status) ? 'red' : 'orange';
                  return (
                    <tr key={order.id} onClick={() => openDrawer(order)}>
                      <td>
                        <span className="trk-order-num">{order.work_order_number}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>
                            {order.service_status_token?.substring(0, 8)}...
                          </span>
                          <button className="trk-copy-btn" onClick={e => { e.stopPropagation(); copyToClipboard(order.service_status_token); }} title={t('shipmentTracking.copy_token')}>
                            <Copy size={12} />
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="trk-recipient-cell">
                          <span className="trk-recipient-name">{order.recipient_name}</span>
                          <span className="trk-recipient-addr">{order.recipient_address}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`trk-status ${order.status}`}>
                          <span className="trk-status-dot" />
                          {t('shipmentTracking.status.' + order.status) || order.status}
                        </span>
                      </td>
                      <td>
                        <div className="trk-progress-wrap" style={{ width: 80 }}>
                          <div className={`trk-progress-bar ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: order.mechanic_name ? '#1e293b' : '#94a3b8' }}>
                        {order.mechanic_name || t('shipmentTracking.unassigned')}
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>{order.zone_name || '—'}</td>
                      <td>
                        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: order.payment_method === 'cod' ? '#d97706' : '#2563eb' }}>
                          {order.payment_method || t('shipmentTracking.na')}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                        {formatDate(order.created_at)}
                      </td>
                      <td>
                        <div className="trk-actions" onClick={e => e.stopPropagation()}>
                          <button className="trk-action-btn view" onClick={() => openDrawer(order)} title={t('shipmentTracking.view_details')}>
                            <Eye size={14} />
                          </button>
                          <button className="trk-action-btn" onClick={() => copyPublicLink(order.service_status_token)} title={t('shipmentTracking.copy_public_link')}
                            style={{ background: '#f0fdf4', color: '#16a34a' }}>
                            <ShareAndroid size={14} />
                          </button>
                          <button className="trk-action-btn" onClick={() => openPublicTracking(order.service_status_token)} title={t('shipmentTracking.open_tracking')}
                            style={{ background: '#eff6ff', color: '#2563eb' }}>
                            <OpenNewWindow size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="trk-pagination">
              <button className="trk-page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('shipmentTracking.previous')}</button>
              <span className="trk-page-info">{t('shipmentTracking.page_info', { page, totalPages, total })}</span>
              <button className="trk-page-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("common.next")}</button>
            </div>
          )}
        </>
      )}

      {/* Detail Drawer */}
      {selectedOrder && (
        <>
          <div className="trk-drawer-overlay" onClick={closeDrawer} />
          <div className="trk-drawer">
            <div className="trk-drawer-header">
              <h3><Package size={20} /> {t('shipmentTracking.drawer.title')}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {selectedOrder.service_status_token && (
                  <>
                    <button onClick={() => copyPublicLink(selectedOrder.service_status_token)}
                      style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                      <Copy size={12} /> {t('shipmentTracking.copy_link')}
                    </button>
                    <button onClick={() => openPublicTracking(selectedOrder.service_status_token)}
                      style={{ background: '#f97316', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#fff' }}>
                      <OpenNewWindow size={12} /> {t('shipmentTracking.live_track')}
                    </button>
                  </>
                )}
                <button className="trk-drawer-close" onClick={closeDrawer}><Xmark size={18} /></button>
              </div>
            </div>
            <div className="trk-drawer-body">
              {drawerLoading ? (
                <div className="trk-spinner" />
              ) : orderDetail ? (
                <>
                  {/* WorkOrder Info */}
                  <div className="trk-detail-section">
                    <div className="trk-detail-section-title"><Package size={14} /> {t('shipmentTracking.section.order_info')}</div>
                    <div className="trk-detail-grid">
                      <div className="trk-detail-item">
                        <div className="trk-detail-label">{t("shipmentTracking.work_order_number")}</div>
                        <div className="trk-detail-value" style={{ fontFamily: 'monospace', color: '#f97316' }}>
                          {orderDetail.work_order_number}
                        </div>
                      </div>
                      <div className="trk-detail-item">
                        <div className="trk-detail-label">{t('shipmentTracking.status_label')}</div>
                        <div className="trk-detail-value">
                          <span className={`trk-status ${orderDetail.status}`}>
                            <span className="trk-status-dot" />
                            {t('shipmentTracking.status.' + orderDetail.status)}
                          </span>
                        </div>
                      </div>
                      <div className="trk-detail-item">
                        <div className="trk-detail-label">{t('shipmentTracking.service_status_token')}</div>
                        <div className="trk-detail-value" style={{ fontSize: 12, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {orderDetail.service_status_token}
                          <button className="trk-copy-btn" onClick={() => copyToClipboard(orderDetail.service_status_token)}><Copy size={12} /></button>
                        </div>
                      </div>
                      <div className="trk-detail-item">
                        <div className="trk-detail-label">{t('shipmentTracking.type_label')}</div>
                        <div className="trk-detail-value" style={{ textTransform: 'capitalize' }}>{orderDetail.work_order_type}</div>
                      </div>
                      <div className="trk-detail-item">
                        <div className="trk-detail-label">{t('shipmentTracking.payment')}</div>
                        <div className="trk-detail-value" style={{ textTransform: 'uppercase' }}>{orderDetail.payment_method}</div>
                      </div>
                      <div className="trk-detail-item">
                        <div className="trk-detail-label">{t("shipmentTracking.cash_amount")}</div>
                        <div className="trk-detail-value">{cur} {parseFloat(orderDetail.cash_amount || 0).toFixed(2)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="trk-detail-section">
                    <div className="trk-detail-section-title"><Timer size={14} /> {t('shipmentTracking.section.progress')}</div>
                    <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        {STATUS_FLOW.map((s, i) => {
                          const Icon = STATUS_ICONS[s];
                          const current = STATUS_FLOW.indexOf(orderDetail.status);
                          const isActive = i <= current && !['failed','returned','cancelled'].includes(orderDetail.status);
                          return (
                            <div key={s} style={{ textAlign: 'center', flex: 1 }}>
                              <div style={{
                                width: 28, height: 28, borderRadius: '50%', margin: '0 auto 4px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: isActive ? '#f97316' : '#e2e8f0',
                                color: isActive ? '#fff' : '#94a3b8',
                                transition: 'all 0.3s'
                              }}>
                                <Icon size={14} />
                              </div>
                              <span style={{ fontSize: 9, color: isActive ? '#f97316' : '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
                                {t('shipmentTracking.status_short.' + s)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="trk-progress-wrap">
                        <div
                          className={`trk-progress-bar ${['failed','returned','cancelled'].includes(orderDetail.status) ? 'red' : orderDetail.status === 'delivered' ? 'green' : 'orange'}`}
                          style={{ width: `${getProgressPercent(orderDetail.status)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Recipient */}
                  <div className="trk-detail-section">
                    <div className="trk-detail-section-title"><User size={14} /> {t('shipmentTracking.recipient')}</div>
                    <div className="trk-detail-grid">
                      <div className="trk-detail-item">
                        <div className="trk-detail-label">{t('shipmentTracking.name_label')}</div>
                        <div className="trk-detail-value">{orderDetail.recipient_name}</div>
                      </div>
                      <div className="trk-detail-item">
                        <div className="trk-detail-label">{t('shipmentTracking.phone_label')}</div>
                        <div className="trk-detail-value">{orderDetail.recipient_phone}</div>
                      </div>
                      <div className="trk-detail-item trk-detail-wide">
                        <div className="trk-detail-label">{t('shipmentTracking.address_label')}</div>
                        <div className="trk-detail-value" style={{ fontSize: 13 }}>
                          {orderDetail.recipient_address}
                          {orderDetail.recipient_area && `, ${orderDetail.recipient_area}`}
                          {orderDetail.recipient_emirate && ` — ${orderDetail.recipient_emirate}`}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Mechanic */}
                  {orderDetail.mechanic_name && (
                    <div className="trk-detail-section">
                      <div className="trk-detail-section-title"><DeliveryTruck size={14} /> {t('shipmentTracking.section.mechanic')}</div>
                      <div className="trk-detail-grid">
                        <div className="trk-detail-item">
                          <div className="trk-detail-label">{t('shipmentTracking.name_label')}</div>
                          <div className="trk-detail-value">{orderDetail.mechanic_name}</div>
                        </div>
                        <div className="trk-detail-item">
                          <div className="trk-detail-label">{t('shipmentTracking.phone_label')}</div>
                          <div className="trk-detail-value">{orderDetail.mechanic_phone || '—'}</div>
                        </div>
                        <div className="trk-detail-item">
                          <div className="trk-detail-label">{t('shipmentTracking.vehicle_label')}</div>
                          <div className="trk-detail-value" style={{ textTransform: 'capitalize' }}>{orderDetail.vehicle_type || '—'}</div>
                        </div>
                        <div className="trk-detail-item">
                          <div className="trk-detail-label">{t('shipmentTracking.plate')}</div>
                          <div className="trk-detail-value">{orderDetail.vehicle_plate || '—'}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Packages */}
                  {orderDetail.packages?.length > 0 && (
                    <div className="trk-detail-section">
                      <div className="trk-detail-section-title">
                        <Package size={14} /> {t('shipmentTracking.section.packages', { defaultValue: 'Packages' })}
                        <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: '#fff7ed', color: '#f97316' }}>
                          {orderDetail.packages.filter(p => p.status === 'delivered').length}/{orderDetail.packages.length}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {orderDetail.packages.map(pkg => {
                          const pkgColor = STATUS_COLORS[pkg.status] || '#94a3b8';
                          return (
                            <div key={pkg.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', borderRadius: 10, padding: '10px 14px', border: '1px solid #f1f5f9' }}>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: '#334155' }}>{pkg.barcode}</div>
                                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                  {pkg.recipient_name || orderDetail.recipient_name}
                                  {pkg.weight ? ` • ${pkg.weight} kg` : ''}
                                  {pkg.description ? ` • ${pkg.description}` : ''}
                                </div>
                              </div>
                              <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#fff', background: pkgColor }}>
                                {t('shipmentTracking.status.' + pkg.status, { defaultValue: pkg.status })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Timestamps */}
                  <div className="trk-detail-section">
                    <div className="trk-detail-section-title"><Clock size={14} /> {t('shipmentTracking.section.timestamps')}</div>
                    <div className="trk-detail-grid">
                      <div className="trk-detail-item">
                        <div className="trk-detail-label">{t('shipmentTracking.created_label')}</div>
                        <div className="trk-detail-value" style={{ fontSize: 12 }}>{formatDate(orderDetail.created_at)}</div>
                      </div>
                      {orderDetail.started_at && (
                        <div className="trk-detail-item">
                          <div className="trk-detail-label">{t('shipmentTracking.timestamp.picked_up')}</div>
                          <div className="trk-detail-value" style={{ fontSize: 12 }}>{formatDate(orderDetail.started_at)}</div>
                        </div>
                      )}
                      {orderDetail.in_transit_at && (
                        <div className="trk-detail-item">
                          <div className="trk-detail-label">{t('shipmentTracking.timestamp.in_transit')}</div>
                          <div className="trk-detail-value" style={{ fontSize: 12 }}>{formatDate(orderDetail.in_transit_at)}</div>
                        </div>
                      )}
                      {orderDetail.completed_at && (
                        <div className="trk-detail-item">
                          <div className="trk-detail-label">{t('shipmentTracking.timestamp.delivered')}</div>
                          <div className="trk-detail-value" style={{ fontSize: 12, color: '#16a34a' }}>{formatDate(orderDetail.completed_at)}</div>
                        </div>
                      )}
                      {orderDetail.failed_at && (
                        <div className="trk-detail-item">
                          <div className="trk-detail-label">{t('shipmentTracking.timestamp.failed')}</div>
                          <div className="trk-detail-value" style={{ fontSize: 12, color: '#ef4444' }}>{formatDate(orderDetail.failed_at)}</div>
                        </div>
                      )}
                      {orderDetail.returned_at && (
                        <div className="trk-detail-item">
                          <div className="trk-detail-label">{t('shipmentTracking.timestamp.returned')}</div>
                          <div className="trk-detail-value" style={{ fontSize: 12, color: '#c62828' }}>{formatDate(orderDetail.returned_at)}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status Timeline */}
                  {orderDetail.status_logs?.length > 0 && (
                    <div className="trk-detail-section">
                      <div className="trk-detail-section-title"><Clock size={14} /> {t('shipmentTracking.section.timeline')}</div>
                      <div className="trk-timeline">
                        {orderDetail.status_logs.map((log, i) => {
                          const LogIcon = STATUS_ICONS[log.status] || Clock;
                          return (
                            <div key={i} className="trk-timeline-item">
                              <div className="trk-timeline-line" />
                              <div className={`trk-timeline-dot ${log.status}`}>
                                <LogIcon size={16} />
                              </div>
                              <div className="trk-timeline-content">
                                <div className="trk-timeline-title">{t('shipmentTracking.status.' + log.status) || log.status}</div>
                                {log.note && <div className="trk-timeline-note">{log.note}</div>}
                                <div className="trk-timeline-meta">
                                  <span><Clock size={10} /> {formatDate(log.created_at)}</span>
                                  {log.changed_by_name && <span><User size={10} /> {log.changed_by_name}</span>}
                                  {log.lat && log.lng && <span><MapPin size={10} /> {parseFloat(log.lat).toFixed(4)}, {parseFloat(log.lng).toFixed(4)}</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Proof of Delivery */}
                  {orderDetail.status === 'delivered' && (
                    <div className="trk-pod-section">
                      <div className="trk-pod-title"><Check size={16} /> {t('shipmentTracking.section.pod')}</div>
                      {orderDetail.pod_photos?.length > 0 ? (
                        <div className="trk-pod-photos">
                          {orderDetail.pod_photos.map((photo, i) => (
                            <img key={i} src={photo} alt={`POD ${i + 1}`} className="trk-pod-photo" />
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{t("shipmentTracking.no_photos")}</p>
                      )}
                      <div className="trk-pod-sig">
                        <div>
                          <div className="trk-pod-sig-label">{t('shipmentTracking.pod.signed_by')}</div>
                          <div className="trk-pod-sig-name">{orderDetail.pod_signer || orderDetail.recipient_name}</div>
                        </div>
                        <span style={{ fontSize: 11, color: '#94a3b8', [isRTL?'marginRight':'marginLeft']: 'auto' }}>
                          {formatDate(orderDetail.completed_at)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Items */}
                  {orderDetail.items?.length > 0 && (
                    <div className="trk-detail-section" style={{ marginTop: 20 }}>
                      <div className="trk-detail-section-title"><Cube size={14} /> {t('shipmentTracking.section.items', { count: orderDetail.items.length })}</div>
                      <div className="trk-table-wrap">
                        <table className="trk-table">
                          <thead>
                            <tr><th>{t('shipmentTracking.items_col.item')}</th><th>{t('shipmentTracking.items_col.qty')}</th><th>{t('shipmentTracking.items_col.weight')}</th><th>{t('shipmentTracking.items_col.price')}</th></tr>
                          </thead>
                          <tbody>
                            {orderDetail.items.map((item, i) => (
                              <tr key={i} style={{ cursor: 'default' }}>
                                <td style={{ fontWeight: 600 }}>{item.name}</td>
                                <td>{item.quantity}</td>
                                <td>{item.weight_kg ? `${item.weight_kg} kg` : '—'}</td>
                                <td>{cur} {parseFloat(item.unit_price || 0).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Special Instructions */}
                  {orderDetail.special_instructions && (
                    <div className="trk-detail-section" style={{ marginTop: 16 }}>
                      <div className="trk-detail-section-title"><WarningCircle size={14} /> {t('shipmentTracking.section.instructions')}</div>
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 14, fontSize: 13, color: '#92400e' }}>
                        {orderDetail.special_instructions}
                      </div>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                    <button onClick={() => { closeDrawer(); navigate(`/work-orders`); }}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 10, border: '1px solid #e2e8f0',
                        background: '#fff', color: '#475569', fontWeight: 700, fontSize: 13,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}>
                      <EditPencil size={14} /> {t('shipmentTracking.edit_order')}
                    </button>
                    <button onClick={() => { closeDrawer(); navigate('/job-assignment'); }}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                        background: '#f97316', color: '#fff', fontWeight: 700, fontSize: 13,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}>
                      <Map size={14} /> {t('shipmentTracking.view_on_map')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="trk-empty">
                  <h3>{t('shipmentTracking.unable_to_load')}</h3>
                  <p>{t('shipmentTracking.please_try_again')}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
