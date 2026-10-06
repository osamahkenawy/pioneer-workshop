import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package, DeliveryTruck, Check, Xmark, Clock, MapPin, User, Phone,
  NavArrowRight, CheckCircle, WarningTriangle, DollarCircle, Wallet,
  Prohibition, Refresh, Eye, Copy, ArrowRight, Calendar, Timer,
  HandBrake, Wrench,
} from 'iconoir-react';
import api from '../lib/api';
import Toast, { useToast } from '../components/Toast';
import FailureReasonModal from '../components/FailureReasonModal';
import './MechanicPortal.css';
import { CardListSkeleton } from '../components/Loader';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { fmtCurrency } from '../utils/currency';

/* ── Status meta ── */
const STATUS_META = {
  assigned:         { label: 'Assigned',         bg: '#ede9fe', color: '#7c3aed', icon: User,        gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' },
  accepted:         { label: 'Accepted',         bg: '#e0e7ff', color: '#1565C0', icon: Check,       gradient: 'linear-gradient(135deg, #6366f1, #1565C0)' },
  in_progress:      { label: 'In Progress',      bg: '#cffafe', color: '#0e7490', icon: Wrench,      gradient: 'linear-gradient(135deg, #22d3ee, #0e7490)' },
  ready_for_pickup: { label: 'Ready for Pickup', bg: '#ffedd5', color: '#c2410c', icon: Package,     gradient: 'linear-gradient(135deg, #fb923c, #c2410c)' },
  completed:        { label: 'Completed',        bg: '#dcfce7', color: '#16a34a', icon: Check,       gradient: 'linear-gradient(135deg, #22c55e, #16a34a)' },
  cancelled:        { label: 'Cancelled',        bg: '#f1f5f9', color: '#64748b', icon: Prohibition, gradient: 'linear-gradient(135deg, #94a3b8, #64748b)' },
};

const NEXT_STATUS = { assigned: 'accepted', accepted: 'in_progress', in_progress: 'ready_for_pickup', ready_for_pickup: 'completed' };

const fmtTime = d => d ? new Date(d).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' }) : '';
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short' }) : '';

const fmtFull = d => d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

/* ── Progress Steps ── */
function ProgressSteps({ current }) {
  const { t } = useTranslation();
  const steps = ['assigned', 'accepted', 'in_progress', 'ready_for_pickup', 'completed'];
  const idx = steps.indexOf(current);
  const stepLabels = [t('mechanicDashboard.step_assigned'), t('mechanicDashboard.step_accepted'), t('mechanicDashboard.step_in_progress'), t('mechanicDashboard.step_ready_for_pickup'), t('mechanicDashboard.step_completed')];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, margin: '12px 0 8px', padding: '0 4px' }}>
      {steps.map((s, i) => {
        const m = STATUS_META[s];
        const done = i <= idx && idx >= 0;
        const active = i === idx;
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? m.color : '#e2e8f0', color: done ? '#fff' : '#94a3b8',
                fontSize: 10, fontWeight: 700, flexShrink: 0, transition: 'all 0.3s',
                boxShadow: active ? `0 0 0 4px ${m.color}25` : 'none',
              }}>
                {done ? <Check width={13} height={13} /> : i + 1}
              </div>
              <span style={{ fontSize: 9, fontWeight: 600, color: done ? m.color : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                {stepLabels[i]}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 3, background: i < idx ? m.color : '#e2e8f0', borderRadius: 2, transition: 'all 0.3s', marginBottom: 16 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Dashboard ── */
export default function MechanicDashboard() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const fmtAED = v => fmtCurrency(v, cur);
  const navigate = useNavigate();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState('active');
  const [updating, setUpdating] = useState(null);
  const [codInput, setCodInput] = useState({});
  const { toasts, showToast } = useToast();
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [noProfile, setNoProfile] = useState(false);
  const [gpsActive, setGpsActive] = useState(false);
  const [gpsError, setGpsError]   = useState(null);
  const [gpsCoords, setGpsCoords] = useState(null);   // for debug display
  const [proofUploading, setProofUploading] = useState(null); // order.id being uploaded
  const [failModal, setFailModal] = useState({ open: false, title: '', subtitle: '', onConfirm: null });
  const refreshRef              = useRef(null);
  const gpsRef                  = useRef(null);
  const watchRef                = useRef(null);
  const lastPosRef              = useRef(null);   // persist GPS across re-renders
  const dataRef                 = useRef(null);    // always-current data for sendPing

  const fetchWorkOrders = useCallback(async () => {
    try {
      const statusParam = tab === 'active' ? '' : 'completed';
      const res = await api.get(`/service-status/my-orders${statusParam ? `?status=${statusParam}` : ''}`);
      if (res.success) { setData(res.data); setNoProfile(false); }
      else if (res.message?.includes('No mechanic profile')) { setNoProfile(true); }
    } catch (e) {
      if (e?.response?.status === 404 || e?.message?.includes('404')) setNoProfile(true);
      console.error(e);
    }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { setLoading(true); fetchWorkOrders(); }, [tab]);
  useEffect(() => {
    refreshRef.current = setInterval(fetchWorkOrders, 30000);
    return () => clearInterval(refreshRef.current);
  }, [fetchWorkOrders]);

  /* ── Keep dataRef always current so GPS ping uses fresh data ── */
  useEffect(() => { dataRef.current = data; }, [data]);

  /* ── Continuous GPS broadcasting (every 10s while mechanic has a job in progress) ── */
  const hasActiveTrip = (data?.orders || []).some(o => o.status === 'in_progress');
  const mechanicId = data?.mechanic?.id;

  useEffect(() => {
    if (!hasActiveTrip || !mechanicId || !navigator.geolocation) {
      // Stop broadcasting if no active trip
      if (gpsRef.current) { clearInterval(gpsRef.current); gpsRef.current = null; }
      if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
      setGpsActive(false);
      setGpsError(null);
      return;
    }

    // Already broadcasting — don't restart
    if (gpsRef.current) return;

    setGpsActive(true);
    setGpsError(null);

    // Use watchPosition for continuous high-accuracy GPS
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        lastPosRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          accuracy: pos.coords.accuracy,
        };
        setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGpsError(null);
        console.log('[GPS] Position updated:', pos.coords.latitude.toFixed(6), pos.coords.longitude.toFixed(6), 'accuracy:', pos.coords.accuracy?.toFixed(0) + 'm');
      },
      (err) => {
        console.warn('[GPS] watchPosition Error:', err.code, err.message);
        setGpsError(err.message);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );

    const sendPing = async () => {
      // If watchPosition hasn't given us a fresh position, try getCurrentPosition
      if (!lastPosRef.current) {
        console.log('[GPS] No watchPosition fix yet, trying getCurrentPosition...');
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject,
              { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
          });
          lastPosRef.current = {
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            speed: pos.coords.speed, heading: pos.coords.heading,
            accuracy: pos.coords.accuracy,
          };
          setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
          console.log('[GPS] getCurrentPosition fallback:', pos.coords.latitude.toFixed(6), pos.coords.longitude.toFixed(6));
        } catch (err) {
          console.warn('[GPS] getCurrentPosition fallback failed:', err.message);
          return;
        }
      }
      const pos = lastPosRef.current;
      const currentData = dataRef.current;
      const currentMechanicId = currentData?.mechanic?.id;
      const activeOrder = (currentData?.orders || []).find(o => o.status === 'in_progress');
      if (!currentMechanicId) return;
      try {
        await api.patch(`/mechanics/${currentMechanicId}/location`, {
          lat: pos.lat, lng: pos.lng,
          speed: pos.speed ?? null, heading: pos.heading ?? null,
          work_order_id: activeOrder?.id || null,
        });
        console.log('[GPS] Ping sent:', pos.lat.toFixed(6), pos.lng.toFixed(6), 'accuracy:', pos.accuracy?.toFixed(0) + 'm');
      } catch (err) { console.warn('[GPS] Ping failed:', err); }
    };

    // First ping after a short delay to let watchPosition acquire a fix
    const initialTimeout = setTimeout(sendPing, 2000);
    gpsRef.current = setInterval(sendPing, 10000);

    return () => {
      clearTimeout(initialTimeout);
      if (gpsRef.current) { clearInterval(gpsRef.current); gpsRef.current = null; }
      if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
      setGpsActive(false);
    };
  }, [hasActiveTrip, mechanicId]);

  const getGPS = () => new Promise(resolve => {
    // Use cached position from watchPosition if available (faster)
    if (lastPosRef.current) return resolve({ lat: lastPosRef.current.lat, lng: lastPosRef.current.lng });
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  const advanceStatus = async (order) => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;

    setUpdating(order.id);
    const gps = await getGPS();
    const payload = { status: next, lat: gps?.lat, lng: gps?.lng };

    // Cash collection on completion
    if (next === 'completed' && order.payment_method === 'cash') {
      const amt = codInput[order.id];
      if (amt) payload.cash_collected_amount = parseFloat(amt);
    }

    try {
      const res = await api.patch(`/service-status/${order.service_status_token}/status`, payload);
      if (res.success) {
        showToast(t('mechanicDashboard.status_updated', { orderNumber: order.work_order_number, status: t('mechanicDashboard.status_' + next) }));
        fetchWorkOrders();
      } else {
        showToast(res.message || t('mechanicDashboard.failed_to_update'), 'error');
      }
    } catch { showToast(t('mechanicDashboard.network_error'), 'error'); }
    finally { setUpdating(null); }
  };

  /* Proof-of-delivery photo upload (order-level) */
  const uploadProof = async (workOrderId, file) => {
    if (!file) return;
    setProofUploading(workOrderId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/uploads/work-orders/${workOrderId}/proof`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        showToast(t('mechanicDashboard.proof_uploaded_toast'));
        fetchWorkOrders();
      } else {
        showToast(data.message || t('mechanicDashboard.upload_failed'), 'error');
      }
    } catch {
      showToast(t('mechanicDashboard.network_error_upload'), 'error');
    } finally {
      setProofUploading(null);
    }
  };

  const markFailed = (order) => {
    setFailModal({
      open: true,
      title: t('mechanicDashboard.delivery_failed_note', { defaultValue: 'Delivery Failed' }),
      subtitle: `#${order.work_order_number}`,
      onConfirm: async (reason) => {
        setUpdating(order.id);
        const gps = await getGPS();
        try {
          const res = await api.patch(`/service-status/${order.service_status_token}/status`, {
            status: 'cancelled', lat: gps?.lat, lng: gps?.lng, note: reason || t('mechanicDashboard.delivery_failed_note'),
          });
          if (res.success) {
            showToast(t('mechanicDashboard.marked_as_failed', { orderNumber: order.work_order_number }), 'error');
            fetchWorkOrders();
          } else {
            showToast(res.message || t('mechanicDashboard.failed_toast'), 'error');
          }
        } catch { showToast(t('mechanicDashboard.network_error'), 'error'); }
        finally { setUpdating(null); }
      },
    });
  };

  /* Start Trip */
  const startTrip = async () => {
    setStarting(true);
    const gps = await getGPS();
    try {
      const res = await api.post('/service-status/start-trip', { lat: gps?.lat, lng: gps?.lng });
      if (res.success) {
        showToast(res.message || t('mechanicDashboard.orders_started', { count: res.started }));
        fetchWorkOrders();
      } else {
        showToast(res.message || t('mechanicDashboard.failed_to_start_trip'), 'error');
      }
    } catch { showToast(t('mechanicDashboard.network_error'), 'error'); }
    finally { setStarting(false); }
  };

  const copyToken = (token) => {
    navigator.clipboard.writeText(`${window.location.origin}/track/${token}`);
    showToast(t('mechanicDashboard.tracking_link_copied'));
  };


  const stats = data?.stats || {};
  const allTimeStats = data?.allTimeStats || {};
  const tabCounts = data?.tabCounts || {};
  const orders = data?.orders || [];
  const mechanic = data?.mechanic || {};
  const today = new Date().toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long' });
  const assignedCount = orders.filter(o => o.status === 'assigned').length;
  const deliveryRate = allTimeStats.total_orders > 0 ? Math.round((allTimeStats.total_completed / allTimeStats.total_orders) * 100) : 0;

  /* ── No mechanic profile state ── */
  if (noProfile && !loading) {
    return (
      <div className="dp-no-profile">
        <div className="dp-no-profile-icon">
          <WarningTriangle width={40} height={40} color="#dc2626" />
        </div>
        <h2 style={{textAlign: 'center'}}>{t("mechanicDashboard.no_profile")}</h2>
        <p>{t('mechanicDashboard.no_profile_message')}</p>
        <Toast toasts={toasts} />
      </div>
    );
  }

  return (
    <div className="mechanic-portal">

      {/* ═══ Hero Header ═══ */}
      <div className="dp-hero">
        <div className="dp-hero-top">
          <div>
            <div className="dp-hero-greeting">{today}</div>
            <h2 className="dp-hero-name">
              {mechanic.name ? t('mechanicDashboard.greeting', { name: mechanic.name.split(' ')[0] }) : t('mechanicDashboard.my_deliveries')}
            </h2>
            <div className="dp-hero-status">
              <span className={`dp-status-dot ${mechanic.status || 'offline'}`} />
              <span className="dp-status-text">{t('mechanicDashboard.mechanic_status_' + (mechanic.status || 'busy'))}</span>
              {gpsActive && !gpsError && (
                <span className="dp-gps-badge">
                  <span className="dp-gps-dot" />
                  {t('mechanicDashboard.gps_live')}
                </span>
              )}
              {gpsActive && gpsError && (
                <span className="dp-gps-badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#dc2626' }}>
                  <WarningTriangle width={11} height={11} /> {t('mechanicDashboard.gps_error_label')}
                </span>
              )}
            </div>
            {/* GPS coordinates debug — shows mechanic their actual tracked position */}
            {gpsActive && gpsCoords && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
                {gpsCoords.lat.toFixed(6)}, {gpsCoords.lng.toFixed(6)} ±{gpsCoords.accuracy?.toFixed(0) || '?'}m
              </div>
            )}
            {gpsActive && gpsError && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#fca5a5' }}>
                {t('mechanicDashboard.gps_error_hint', { error: gpsError })}
              </div>
            )}
          </div>
          <div className="dp-hero-actions">
            <button onClick={() => { setLoading(true); fetchWorkOrders(); }} title={t('mechanicDashboard.refresh')} className="dp-btn-refresh">
              <Refresh width={16} height={16} />
            </button>
            <button onClick={() => navigate('/mechanic/scan')} className="dp-btn-scan">
              <Eye width={14} height={14} /> {t('mechanicDashboard.scan')}
            </button>
          </div>
        </div>

        {/* Quick Stats Row Inside Hero — Today */}
        <div className="dp-today-label">{t("mechanicDashboard.today_performance")}</div>
        <div className="dp-today-grid">
          {[
            { label: t('mechanicDashboard.stat_active'),    value: stats.active || 0,   icon: <Package width={18} height={18} color="#f97316" />, bg: 'rgba(249,115,22,0.12)' },
            { label: t('mechanicDashboard.stat_delivered'), value: stats.completed || 0, icon: <CheckCircle width={18} height={18} color="#16a34a" />, bg: 'rgba(34,197,94,0.12)' },
            { label: t('mechanicDashboard.stat_revenue'),   value: fmtAED(stats.revenue), icon: <DollarCircle width={18} height={18} color="#0ea5e9" />, bg: 'rgba(14,165,233,0.12)' },
          ].map(s => (
            <div key={s.label} className="dp-today-card" style={{ background: s.bg }}>
              <div className="tc-icon">{s.icon}</div>
              <div className="tc-value">{s.value}</div>
              <div className="tc-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ All-Time Stats Card ═══ */}
      {allTimeStats.total_orders > 0 && (
        <div className="dp-alltime">
          <div className="dp-alltime-header">
            <h3 className="dp-alltime-title">{t("mechanicDashboard.overall_performance")}</h3>
            <span className={`dp-rate-badge ${deliveryRate >= 90 ? 'excellent' : deliveryRate >= 70 ? 'good' : 'poor'}`}>
              {t('mechanicDashboard.success_badge', { rate: deliveryRate })}
            </span>
          </div>
          <div className="dp-alltime-grid">
            {[
              { label: t('mechanicDashboard.total_orders'), value: allTimeStats.total_orders, color: '#3b82f6', bg: '#eff6ff' },
              { label: t('mechanicDashboard.stat_delivered'), value: allTimeStats.total_completed, color: '#16a34a', bg: '#f0fdf4' },
              { label: t('mechanicDashboard.earned'), value: fmtAED(allTimeStats.total_revenue), color: '#0369a1', bg: '#f0f9ff' },
            ].map(s => (
              <div key={s.label} className="dp-alltime-stat" style={{ background: s.bg }}>
                <div className="as-value" style={{ color: s.color }}>{s.value}</div>
                <div className="as-label">{s.label}</div>
              </div>
            ))}
          </div>
          {/* Progress bar */}
          <div className="dp-rate-bar-wrap">
            <div className="dp-rate-bar-label">
              <span>{t("mechanicDashboard.delivery_success_rate")}</span>
              <span>{deliveryRate}%</span>
            </div>
            <div className="dp-rate-bar">
              <div className="dp-rate-bar-fill" style={{
                width: `${deliveryRate}%`,
                background: deliveryRate >= 90 ? 'linear-gradient(90deg, #22c55e, #16a34a)' : deliveryRate >= 70 ? 'linear-gradient(90deg, #f59e0b, #d97706)' : 'linear-gradient(90deg, #ef4444, #dc2626)',
              }} />
            </div>
          </div>
        </div>
      )}

      {/* ═══ Start Work Banner ═══ */}
      {tab === 'active' && assignedCount > 0 && (
        <button onClick={startTrip} disabled={starting} className="dp-start-trip">
          <Wrench width={20} height={20} />
          {starting ? t('mechanicDashboard.starting_trip') : t('mechanicDashboard.confirm_all_pickups', { defaultValue: `Start Work \u2014 ${assignedCount} Work Order${assignedCount > 1 ? 's' : ''}`, count: assignedCount })}
        </button>
      )}

      {/* ═══ Tabs ═══ */}
      <div className="dp-tabs">
        {[
          { key: 'active',    label: t('mechanicDashboard.tab_active'),    count: tabCounts.active,    color: '#f97316' },
          { key: 'completed', label: t('mechanicDashboard.tab_delivered'), count: tabCounts.completed, color: '#16a34a' },
        ].map(tabItem => (
          <button key={tabItem.key} onClick={() => setTab(tabItem.key)}
            className={`dp-tab ${tab === tabItem.key ? 'active' : ''}`}
            style={tab === tabItem.key ? { color: tabItem.color } : undefined}>
            {tabItem.label}
            {tabItem.count != null && (
              <span className="dp-tab-count" style={{
                background: tab === tabItem.key ? tabItem.color + '15' : '#e2e8f0',
                color: tab === tabItem.key ? tabItem.color : '#94a3b8',
              }}>{tabItem.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ WorkOrders List ═══ */}
      {loading ? (
        <CardListSkeleton count={5} />
      ) : orders.length === 0 ? (
        <div className="dp-empty">
          <div className="dp-empty-icon">
            <Package width={40} height={40} style={{ color: '#cbd5e1' }} />
          </div>
          <h3>{tab === 'active' ? t('mechanicDashboard.no_active_deliveries') : t('mechanicDashboard.no_delivered_orders')}</h3>
          <p>{tab === 'active' ? t('mechanicDashboard.empty_active_hint') : t('mechanicDashboard.empty_history_hint')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {orders.map(order => {
            const m = STATUS_META[order.status] || STATUS_META.assigned;
            const isUpdating = updating === order.id;
            const isTerminal = ['completed', 'cancelled'].includes(order.status);
            const next = NEXT_STATUS[order.status];
            const parts = order.parts || [];
            const isCashCollection = next === 'completed' && order.payment_method === 'cash';

            return (
              <div key={order.id} className="dp-order-card">
                {/* ── WorkOrder Header with gradient ── */}
                <div className="dp-order-header" style={{ background: m.gradient }}>
                  <div>
                    <div className="dp-order-number">{order.work_order_number}</div>
                    <div className="dp-order-time"><Clock width={10} height={10} /> {fmtFull(order.created_at)}</div>
                  </div>
                  <div className="dp-order-badges">
                    <span className="dp-status-pill">{t('mechanicDashboard.status_' + order.status)}</span>
                    <button onClick={() => copyToken(order.service_status_token)} title={t('mechanicDashboard.copy_tracking')} className="dp-copy-btn">
                      <Copy width={14} height={14} />
                    </button>
                  </div>
                </div>

                {/* Progress Steps */}
                {!isTerminal && <div className="dp-progress-wrap"><ProgressSteps current={order.status} /></div>}

                {!isTerminal && (
                  <div style={{ margin: '0 16px 12px' }}>
                    {/* Customer & vehicle info */}
                    <div style={{ background: '#f8fafc', borderRadius: 12, padding: '12px 14px', border: '1px solid #e2e8f0', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: order.dropoff_address || order.service_category ? 10 : 0 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <User width={18} height={18} color="#7c3aed" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{order.customer_full_name || order.customer_name || '—'}</div>
                          {order.customer_phone && (
                            <a href={`tel:${order.customer_phone}`} style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                              <Phone width={11} height={11} /> {order.customer_phone}
                            </a>
                          )}
                        </div>
                      </div>
                      {order.service_category && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', marginBottom: 4 }}>
                          <Wrench width={12} height={12} color="#64748b" /> {order.service_category.replace(/_/g, ' ')}
                          {order.service_bay_name && <span style={{ color: '#94a3b8' }}>· {order.service_bay_name}</span>}
                        </div>
                      )}
                      {order.dropoff_address && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: '#475569' }}>
                          <MapPin width={12} height={12} color="#64748b" style={{ marginTop: 2, flexShrink: 0 }} /> {order.dropoff_address}
                        </div>
                      )}
                      {(order.special_instructions || order.notes) && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8, background: '#fef3c7', borderRadius: 8, padding: '8px 10px' }}>
                          <WarningTriangle width={13} height={13} color="#d97706" style={{ marginTop: 1, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: '#92400e' }}>{order.special_instructions || order.notes}</span>
                        </div>
                      )}
                    </div>

                    {/* Parts used on this job */}
                    {parts.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Package width={11} height={11} /> {t('mechanicDashboard.packages_lbl', { defaultValue: 'Parts' })} ({parts.length})
                        </div>
                        {parts.map(part => (
                          <div key={part.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', borderRadius: 6, padding: '6px 8px', marginBottom: 3, fontSize: 12, border: '1px solid #e2e8f0' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>{part.quantity}× {part.name}</span>
                            {parseFloat(part.total_cost) > 0 && <span style={{ color: '#d97706', fontWeight: 600, fontSize: 11 }}>{cur} {parseFloat(part.total_cost).toFixed(0)}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Payment info strip */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <div style={{ flex: 1, background: '#fff', borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{t('mechanicDashboard.payment')}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: order.payment_method === 'cash' ? '#d97706' : '#2563eb', textTransform: 'uppercase' }}>{order.payment_method || '—'}</div>
                      </div>
                      <div style={{ flex: 1, background: '#fff', borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{t('mechanicDashboard.fee')}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{fmtAED(order.service_fee)}</div>
                      </div>
                      {parseFloat(order.cash_amount) > 0 && (
                        <div style={{ flex: 1, background: '#fef3c7', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: '#d97706', fontWeight: 600, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}><Wallet width={10} height={10} /> {t('mechanicDashboard.collect')}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#d97706' }}>{cur} {parseFloat(order.cash_amount).toFixed(0)}</div>
                        </div>
                      )}
                    </div>

                    {/* Cash collection input — shown right before completing a cash job */}
                    {isCashCollection && (
                      <div className="dp-cod-box" style={{ marginBottom: 12 }}>
                        <label className="dp-cod-label"><Wallet width={13} height={13} /> {t('mechanicDashboard.cash_amount_collected')}</label>
                        <input type="number" step="0.01" className="dp-cod-input"
                          placeholder={t('mechanicDashboard.enter_amount_expected', { amount: (parseFloat(order.cash_amount) || 0).toFixed(0) })}
                          value={codInput[order.id] || ''}
                          onChange={e => setCodInput(prev => ({ ...prev, [order.id]: e.target.value }))}
                        />
                      </div>
                    )}

                    {/* Advance / Fail actions */}
                    <div style={{ display: 'flex', gap: 10 }}>
                      {next && (
                        <button onClick={() => advanceStatus(order)} disabled={isUpdating}
                          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 12, border: 'none', fontWeight: 700, fontSize: 14, color: '#fff', cursor: 'pointer', background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 4px 16px rgba(34,197,94,0.35)' }}>
                          {isUpdating
                            ? <><div className="dp-btn-spinner" /> {t('mechanicDashboard.processing')}</>
                            : <><CheckCircle width={16} height={16} /> {t('mechanicDashboard.status_' + next)}</>}
                        </button>
                      )}
                      {order.status !== 'ready_for_pickup' && (
                        <button onClick={() => markFailed(order)} disabled={isUpdating} className="dp-btn-fail" style={{ padding: '12px 16px' }}>
                          <Xmark width={14} height={14} /> {t('mechanicDashboard.failed_btn')}
                        </button>
                      )}
                    </div>

                    {/* Proof of completion photo */}
                    {!order.completion_photo_url ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1.5px dashed #94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#64748b', background: '#f8fafc', marginTop: 10 }}>
                        {proofUploading === order.id
                          ? <><div className="dp-btn-spinner" /> {t('mechanicDashboard.uploading')}</>
                          : <><Eye width={14} height={14} /> {t('mechanicDashboard.add_proof_photo')}</>}
                        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={!!proofUploading} onChange={e => uploadProof(order.id, e.target.files?.[0])} />
                      </label>
                    ) : (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#16a34a', fontWeight: 600, marginBottom: 6 }}>
                          <CheckCircle width={13} height={13} /> {t('mechanicDashboard.proof_uploaded')}
                        </div>
                        <img src={order.completion_photo_url} alt="Proof" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} onClick={() => window.open(order.completion_photo_url, '_blank')} />
                      </div>
                    )}
                  </div>
                )}

                {/* ═══ TERMINAL STATE (completed/cancelled) ═══ */}
                {isTerminal && (
                  <div style={{ margin: '0 16px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User width={16} height={16} color={m.color} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{order.customer_full_name || order.customer_name || '—'}</div>
                        {order.service_category && <span style={{ fontSize: 12, color: '#64748b' }}>{order.service_category.replace(/_/g, ' ')}</span>}
                      </div>
                    </div>
                    <div className="dp-payment-strip">
                      <div className="dp-payment-cell">
                        <div className="pc-label">{t('mechanicDashboard.payment')}</div>
                        <div className="pc-value" style={{ color: order.payment_method === 'cash' ? '#d97706' : '#2563eb', textTransform: 'uppercase' }}>{order.payment_method || '—'}</div>
                      </div>
                      <div className="dp-payment-cell">
                        <div className="pc-label">{t('mechanicDashboard.fee')}</div>
                        <div className="pc-value">{fmtAED(order.service_fee)}</div>
                      </div>
                      {order.payment_method === 'cash' && parseFloat(order.cash_amount) > 0 && (
                        <div className="dp-payment-cell cod-collect">
                          <div className="pc-label"><Wallet width={12} height={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> {t('mechanicDashboard.collect')}</div>
                          <div className="pc-value">{cur} {parseFloat(order.cash_amount).toFixed(0)}</div>
                        </div>
                      )}
                    </div>
                    <div className="dp-completed-strip">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar width={12} height={12} /> {fmtDate(order.created_at)}</span>
                      <span style={{ fontWeight: 600, color: order.completed_at ? '#16a34a' : '#dc2626' }}>
                        {order.completed_at && t('mechanicDashboard.delivered_stamp', { time: fmtTime(order.completed_at) })}
                        {order.failed_at && t('mechanicDashboard.failed_stamp', { time: fmtTime(order.failed_at) })}
                      </span>
                    </div>
                    {order.completion_photo_url && (
                      <img src={order.completion_photo_url} alt="Proof" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0', marginTop: 10 }} onClick={() => window.open(order.completion_photo_url, '_blank')} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Toast toasts={toasts} />
      <FailureReasonModal
        open={failModal.open}
        title={failModal.title}
        subtitle={failModal.subtitle}
        onClose={() => setFailModal(p => ({ ...p, open: false }))}
        onConfirm={(reason) => {
          failModal.onConfirm?.(reason);
          setFailModal(p => ({ ...p, open: false }));
        }}
      />
    </div>
  );
}
