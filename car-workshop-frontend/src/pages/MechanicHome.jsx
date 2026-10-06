    import { useState, useEffect, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package, DeliveryTruck, Check, MapPin, User,
  CheckCircle, WarningTriangle, DollarCircle, Refresh,
  NavArrowRight, Calendar, Clock, QrCode, Phone,
} from 'iconoir-react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import Toast, { useToast } from '../components/Toast';
import { useTranslation } from 'react-i18next';
import './MechanicPortal.css';
import './MechanicHome.css';

/* ── Status meta ── */
const STATUS_META = {
  assigned:         { label: 'Assigned',         color: '#7c3aed', bg: '#ede9fe' },
  accepted:         { label: 'Accepted',         color: '#1565C0', bg: '#e0e7ff' },
  in_progress:      { label: 'In Progress',      color: '#0e7490', bg: '#cffafe' },
  ready_for_pickup: { label: 'Ready for Pickup', color: '#c2410c', bg: '#ffedd5' },
  completed:        { label: 'Completed',        color: '#16a34a', bg: '#dcfce7' },
  cancelled:        { label: 'Cancelled',        color: '#64748b', bg: '#f1f5f9' },
};

const fmtAEDVal = v => { const n = parseFloat(v); return !isNaN(n) && n > 0 ? n.toFixed(2) : '0.00'; };
const fmtDate   = d => d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short' }) : '';
const fmtTime   = d => d ? new Date(d).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' }) : '';

export default function MechanicHome() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const navigate = useNavigate();
  const { toasts, showToast } = useToast();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await api.get('/service-status/my-orders');
      if (res.success) { setData(res.data); setNoProfile(false); }
      else if (res.message?.includes('No mechanic profile')) setNoProfile(true);
    } catch (e) {
      if (e?.response?.status === 404) setNoProfile(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Loader ── */
  if (loading) {
    return (
      <div className="dh-loader">
        <div className="dp-spinner" style={{ width: 36, height: 36 }} />
        <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 14 }}>{t('mechanicDashboard.loading_orders')}</p>
      </div>
    );
  }

  /* ── No profile ── */
  if (noProfile) {
    return (
      <div className="dp-no-profile">
        <div className="dp-no-profile-icon"><WarningTriangle width={40} height={40} color="#dc2626" /></div>
        <h2 style={{ textAlign: 'center' }}>{t('mechanicDashboard.no_profile')}</h2>
        <p>{t('mechanicDashboard.no_profile_message')}</p>
        <Toast toasts={toasts} />
      </div>
    );
  }

  const stats        = data?.stats        || {};
  const allTimeStats = data?.allTimeStats || {};
  const mechanic       = data?.mechanic       || {};
  const recentWorkOrders = (data?.orders || []).slice(0, 5);
  const today        = new Date().toLocaleDateString(isRTL ? 'ar-AE' : 'en-AE', { weekday: 'long', day: 'numeric', month: 'long' });
  const deliveryRate = allTimeStats.total_orders > 0
    ? Math.round((allTimeStats.total_delivered / allTimeStats.total_orders) * 100) : 0;
  const activeWorkOrders = (data?.orders || []).filter(o => ['assigned', 'accepted', 'in_progress', 'ready_for_pickup'].includes(o.status));

  return (
    <div className="mechanic-portal">

      {/* ═══ Hero ═══ */}
      <div className="dp-hero">
        <div className="dp-hero-top">
          <div>
            <div className="dp-hero-greeting">{today}</div>
            <h2 className="dp-hero-name">
              {mechanic.name
                ? t('mechanicDashboard.greeting', { name: mechanic.name.split(' ')[0] })
                : t('mechanicHome.welcome')}
            </h2>
            <div className="dp-hero-status">
              <span className={`dp-status-dot ${mechanic.status || 'offline'}`} />
              <span className="dp-status-text">
                {t('mechanicDashboard.mechanic_status_' + (mechanic.status || 'busy'))}
              </span>
              {mechanic.vehicle_type && (
                <span className="dp-gps-badge">
                  <DeliveryTruck width={11} height={11} /> {mechanic.vehicle_type}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            title={t('mechanicDashboard.refresh')}
            className="dp-btn-refresh"
          >
            <Refresh width={16} height={16} style={refreshing ? { animation: 'spin 0.8s linear infinite' } : {}} />
          </button>
        </div>

        {/* Today's KPI row */}
        <div className="dp-today-label">{t('mechanicDashboard.today_performance')}</div>
        <div className="dp-today-grid">
          {[
            { label: t('mechanicDashboard.stat_active'),    value: stats.active    || 0, icon: <Package      width={18} height={18} color="#f97316" />, bg: 'rgba(249,115,22,0.12)' },
            { label: t('mechanicDashboard.stat_delivered'), value: stats.delivered || 0, icon: <CheckCircle  width={18} height={18} color="#16a34a" />, bg: 'rgba(34,197,94,0.12)'  },
            { label: t('mechanicDashboard.stat_revenue'),   value: `${cur} ${fmtAEDVal(stats.revenue)}`, icon: <DollarCircle width={18} height={18} color="#0ea5e9" />, bg: 'rgba(14,165,233,0.12)' },
          ].map(s => (
            <div key={s.label} className="dp-today-card" style={{ background: s.bg }}>
              <div className="tc-icon">{s.icon}</div>
              <div className="tc-value">{s.value}</div>
              <div className="tc-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Quick Actions ═══ */}
      <div className="dh-quick-actions">
        <button className="dh-action-card dh-action-primary" onClick={() => navigate('/mechanic/work-orders')}>
          <div className="dh-action-icon">
            <Package width={26} height={26} />
          </div>
          <div className="dh-action-body">
            <div className="dh-action-title">{t('mechanicHome.my_orders')}</div>
            <div className="dh-action-sub">
              {activeWorkOrders.length > 0
                ? t('mechanicHome.active_orders_count', { count: activeWorkOrders.length })
                : t('mechanicHome.no_active_orders')}
            </div>
          </div>
          <NavArrowRight width={20} height={20} className="dh-action-arrow" />
        </button>

        <button className="dh-action-card dh-action-secondary" onClick={() => navigate('/mechanic/scan')}>
          <div className="dh-action-icon">
            <QrCode width={26} height={26} />
          </div>
          <div className="dh-action-body">
            <div className="dh-action-title">{t('mechanicHome.scan_shipment')}</div>
            <div className="dh-action-sub">{t('mechanicHome.scan_sub')}</div>
          </div>
          <NavArrowRight width={20} height={20} className="dh-action-arrow" />
        </button>
      </div>

      {/* ═══ All-Time Performance ═══ */}
      {allTimeStats.total_orders > 0 && (
        <div className="dp-alltime">
          <div className="dp-alltime-header">
            <h3 className="dp-alltime-title">{t('mechanicDashboard.overall_performance')}</h3>
            <span className={`dp-rate-badge ${deliveryRate >= 90 ? 'excellent' : deliveryRate >= 70 ? 'good' : 'poor'}`}>
              {t('mechanicDashboard.success_badge', { rate: deliveryRate })}
            </span>
          </div>
          <div className="dp-alltime-grid">
            {[
              { label: t('mechanicDashboard.total_orders'),    value: allTimeStats.total_orders,    color: '#3b82f6', bg: '#eff6ff' },
              { label: t('mechanicDashboard.stat_delivered'),  value: allTimeStats.total_delivered, color: '#16a34a', bg: '#f0fdf4' },
              { label: t('mechanicDashboard.earned'),          value: `${cur} ${fmtAEDVal(allTimeStats.total_revenue)}`, color: '#0369a1', bg: '#f0f9ff' },
            ].map(s => (
              <div key={s.label} className="dp-alltime-stat" style={{ background: s.bg }}>
                <div className="as-value" style={{ color: s.color }}>{s.value}</div>
                <div className="as-label">{s.label}</div>
              </div>
            ))}
          </div>
          {/* Delivery success rate bar */}
          <div className="dp-rate-bar-wrap">
            <div className="dp-rate-bar-label">
              <span>{t('mechanicDashboard.delivery_success_rate')}</span>
              <span>{deliveryRate}%</span>
            </div>
            <div className="dp-rate-bar">
              <div
                className="dp-rate-bar-fill"
                style={{
                  width: `${deliveryRate}%`,
                  background: deliveryRate >= 90
                    ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                    : deliveryRate >= 70
                    ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                    : 'linear-gradient(90deg, #ef4444, #dc2626)',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══ Recent WorkOrders ═══ */}
      <div className="dh-recent-section">
        <div className="dh-section-header">
          <h3 className="dh-section-title">{t('mechanicHome.recent_orders')}</h3>
          <button className="dh-view-all" onClick={() => navigate('/mechanic/work-orders')}>
            {t('mechanicHome.view_all')} <NavArrowRight width={14} height={14} />
          </button>
        </div>

        {recentWorkOrders.length === 0 ? (
          <div className="dp-empty" style={{ padding: '32px 20px' }}>
            <div className="dp-empty-icon">
              <Package width={36} height={36} style={{ color: '#cbd5e1' }} />
            </div>
            <h3 style={{ fontSize: 15 }}>{t('mechanicDashboard.no_active_deliveries')}</h3>
            <p style={{ fontSize: 13 }}>{t('mechanicDashboard.empty_active_hint')}</p>
          </div>
        ) : (
          <div className="dh-orders-list">
            {recentWorkOrders.map(order => {
              const m = STATUS_META[order.status] || STATUS_META.assigned;
              return (
                <div key={order.id} className="dh-order-row">
                  {/* Status dot */}
                  <div className="dh-order-dot" style={{ background: m.bg }}>
                    <Package width={16} height={16} color={m.color} />
                  </div>

                  {/* WorkOrder info */}
                  <div className="dh-order-info">
                    <div className="dh-order-num">{order.work_order_number}</div>
                    <div className="dh-order-recipient">
                      <User width={11} height={11} style={{ opacity: 0.5 }} /> {order.recipient_name}
                    </div>
                    <div className="dh-order-addr">
                      <MapPin width={11} height={11} style={{ opacity: 0.5 }} />{' '}
                      {[order.recipient_area, order.recipient_emirate].filter(Boolean).join(', ') || order.recipient_address || '—'}
                    </div>
                  </div>

                  {/* Right side */}
                  <div className="dh-order-right">
                    <span className="dh-status-pill" style={{ background: m.bg, color: m.color }}>
                      {t('mechanicDashboard.status_' + order.status)}
                    </span>
                    <div className="dh-order-time">
                      <Clock width={10} height={10} />{' '}
                      {order.completed_at
                        ? fmtDate(order.completed_at)
                        : fmtDate(order.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ Mechanic Profile Summary ═══ */}
      {mechanic.name && (
        <div className="dh-profile-card">
          <div className="dh-profile-avatar">
            <User width={28} height={28} color="#1e3a6b" />
          </div>
          <div className="dh-profile-info">
            <div className="dh-profile-name">{mechanic.name}</div>
            {mechanic.phone && (
              <div className="dh-profile-detail"><Phone width={14} height={14} /> {mechanic.phone}</div>
            )}
            {mechanic.vehicle_type && (
              <div className="dh-profile-detail"><DeliveryTruck width={14} height={14} /> {mechanic.vehicle_type}{mechanic.plate_number ? ` · ${mechanic.plate_number}` : ''}</div>
            )}
          </div>
          <div className={`dh-profile-status ${mechanic.status || 'offline'}`}>
            <span className={`dp-status-dot ${mechanic.status || 'offline'}`} />
            {t('mechanicDashboard.mechanic_status_' + (mechanic.status || 'offline'))}
          </div>
        </div>
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
