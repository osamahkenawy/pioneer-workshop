import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import {
  Clock, Check, User, Package, DeliveryTruck, CheckCircle,
  MapPin, Phone, Refresh, Map, NavArrowRight, Prohibition,
  WarningTriangle, Calendar, Timer, Wrench,
} from 'iconoir-react';
import { escapeHtml } from '../utils/escapeHtml';

let leafletLoaded = false;
function ensureLeaflet() {
  if (leafletLoaded || typeof window === 'undefined') return;
  leafletLoaded = true;
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  if (!document.getElementById('leaflet-zoom-spacing')) {
    const style = document.createElement('style');
    style.id = 'leaflet-zoom-spacing';
    style.textContent = '.leaflet-control-zoom { display: flex; flex-direction: column; gap: 8px; } .leaflet-control-zoom-in, .leaflet-control-zoom-out { margin: 0 !important; }';
    document.head.appendChild(style);
  }
  if (!document.getElementById('leaflet-js')) {
    const script = document.createElement('script');
    script.id = 'leaflet-js';
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    document.head.appendChild(script);
  }
}

const STATUS_STEPS = ['pending', 'confirmed', 'assigned', 'accepted', 'in_progress', 'ready_for_pickup', 'completed'];
const STATUS_LABELS = {
  pending: 'Work Order Placed', confirmed: 'Confirmed', assigned: 'Mechanic Assigned',
  accepted: 'Accepted', in_progress: 'In Progress', ready_for_pickup: 'Ready for Pickup', completed: 'Completed',
  cancelled: 'Cancelled',
};
const STATUS_ICONS = {
  pending: Clock, confirmed: CheckCircle, assigned: User, accepted: Check,
  in_progress: Wrench, ready_for_pickup: Package, completed: Check, cancelled: Prohibition,
};
const STATUS_COLORS = {
  pending: '#f59e0b', confirmed: '#3b82f6', assigned: '#8b5cf6', accepted: '#1565C0',
  in_progress: '#0e7490', ready_for_pickup: '#c2410c', completed: '#16a34a', cancelled: '#64748b',
};
const LIVE_STATUSES = new Set(['in_progress']);

/* ── Inline Styles ── */
const S = {
  page: { minHeight: '100vh', background: '#f8fafc', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  header: { background: '#1e3a6b', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64, position: 'sticky', top: 0, zIndex: 50, boxShadow: '0 2px 12px rgba(36,64,102,0.3)' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  logo: { height: 36, objectFit: 'contain', filter: 'brightness(100)' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  refreshBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.12)', cursor: 'pointer', color: '#fff', fontWeight: 600, fontSize: 13, transition: 'all 0.2s', backdropFilter: 'blur(4px)' },
  liveTag: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.18)', fontSize: 12, fontWeight: 600, color: '#fff', backdropFilter: 'blur(4px)' },
  liveDot: { width: 7, height: 7, borderRadius: '50%', background: '#4ade80', animation: 'tpPulse 1.5s ease-in-out infinite' },
  content: { maxWidth: 640, margin: '0 auto', padding: '24px 16px 48px' },
  card: { background: '#fff', borderRadius: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.04)', marginBottom: 16, overflow: 'hidden', border: '1px solid #f1f5f9' },
  footer: { textAlign: 'center', padding: '20px 16px', color: '#94a3b8', fontSize: 12, borderTop: '1px solid #f1f5f9' },
};

export default function ServiceStatusPublic() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { token } = useParams();
  const mapRef = useRef(null);
  const mapObjRef = useRef(null);
  const markerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const initialFitRef = useRef(false);
  const timerRef = useRef(null);

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const socketRef = useRef(null);

  const apiBase = import.meta.env.VITE_API_URL || '/api';

  const fetchOrder = async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    try {
      const r = await fetch(`${apiBase}/service-status/${token}`);
      const data = await r.json();
      if (data.success) { setOrder(data.data); setError(''); setLastRefresh(new Date()); }
      else setError(data.message || t('trackingPublic.order_not_found'));
    } catch { setError(t('trackingPublic.unable_to_load')); }
    finally { if (!silent) setLoading(false); setRefreshing(false); }
  };

  useEffect(() => {
    if (!token) { setError(t('trackingPublic.invalid_tracking_link')); setLoading(false); return; }
    ensureLeaflet();
    fetchOrder();
  }, [token]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (order && LIVE_STATUSES.has(order.status)) {
      timerRef.current = setInterval(() => fetchOrder(true), 15000);
    }
    return () => clearInterval(timerRef.current);
  }, [order?.status]);

  /* ── Socket.IO for real-time mechanic location ── */
  useEffect(() => {
    if (!token || !order || !LIVE_STATUSES.has(order.status)) {
      if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
      return;
    }
    const base = (import.meta.env.VITE_API_URL || '/api').replace('/api', '');
    const socket = io(base, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-tracking', token);
    });

    socket.on('mechanic:location', (data) => {
      setOrder(prev => prev ? {
        ...prev,
        mechanic_location: { lat: data.lat, lng: data.lng, recorded_at: data.timestamp },
      } : prev);
      setLastRefresh(new Date());
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [token, order?.status]);

  useEffect(() => {
    if (!order?.mechanic_location || !mapRef.current) return;
    const { lat, lng } = order.mechanic_location;
    if (!lat || !lng) return;
    const initMap = () => {
      const L = window.L;
      if (!L) return setTimeout(initMap, 300);
      if (!mapObjRef.current) {
        mapObjRef.current = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '\u00a9 OpenStreetMap' }).addTo(mapObjRef.current);
      }
      const mechanicIcon = L.divIcon({
        className: '',
        html: `<div style="background:#1e3a6b;border:3px solid #fff;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(36,64,102,0.5)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 19a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm8 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/><path d="M10.05 17H6V4h5l2 3h4l1 4h-2"/><path d="M5.5 17H2V9h4"/></svg>
        </div>`,
        iconSize: [40, 40], iconAnchor: [20, 20],
      });
      if (markerRef.current) { markerRef.current.setLatLng([lat, lng]); }
      else {
        markerRef.current = L.marker([lat, lng], { icon: mechanicIcon }).addTo(mapObjRef.current)
          .bindPopup(`<div style="min-width:180px;font-family:Inter,system-ui,sans-serif">
            <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1e3a6b;border-radius:8px 8px 0 0;color:#fff;font-weight:700;font-size:13px">
              ${t('trackingPublic.your_mechanic')}
            </div>
            <div style="padding:8px 10px;font-size:12px;color:#374151">
              <div style="font-weight:600;font-size:13px;margin-bottom:2px">${escapeHtml(order.mechanic_name) || t('trackingPublic.mechanic_fallback')}</div>
              ${order.mechanic_phone ? `<div style="color:#6b7280;margin-top:2px">${escapeHtml(order.mechanic_phone)}</div>` : ''}
            </div>
          </div>`);
      }
      // Only add destination marker once
      if (!destMarkerRef.current && order.dropoff_lat && order.dropoff_lng) {
        const destIcon = L.divIcon({
          className: '',
          html: `<div style="background:#1d4ed8;border:3px solid #fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(29,78,216,0.4)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>`,
          iconSize: [36, 36], iconAnchor: [18, 18],
        });
        destMarkerRef.current = L.marker([order.dropoff_lat, order.dropoff_lng], { icon: destIcon }).addTo(mapObjRef.current)
          .bindPopup(`<div style="min-width:180px;font-family:Inter,system-ui,sans-serif">
            <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:linear-gradient(135deg,#3b82f6,#2563eb);border-radius:8px 8px 0 0;color:#fff;font-weight:700;font-size:13px">
              ${t('trackingPublic.delivery_location')}
            </div>
            <div style="padding:8px 10px;font-size:12px;color:#374151">
              <div style="font-weight:600;font-size:13px;margin-bottom:2px">${escapeHtml(order.customer_name)}</div>
              <div style="color:#6b7280">${escapeHtml(order.dropoff_address)}</div>
            </div>
          </div>`);
      }
      // Only fit bounds on first load, then just pan to keep mechanic visible
      if (!initialFitRef.current) {
        initialFitRef.current = true;
        if (order.dropoff_lat && order.dropoff_lng) {
          mapObjRef.current.fitBounds([[lat, lng], [order.dropoff_lat, order.dropoff_lng]], { padding: [40, 40] });
        } else {
          mapObjRef.current.setView([lat, lng], 14);
        }
      } else {
        // Smoothly keep mechanic in view without resetting zoom
        if (!mapObjRef.current.getBounds().contains([lat, lng])) {
          mapObjRef.current.panTo([lat, lng], { animate: true, duration: 0.5 });
        }
      }
    };
    initMap();
  }, [order?.mechanic_location?.lat, order?.mechanic_location?.lng]);

  const currentStep = order ? STATUS_STEPS.indexOf(order.status) : -1;
  const isFinal = order && ['completed', 'cancelled'].includes(order.status);
  const isLive = order && LIVE_STATUSES.has(order.status);

  const StatusIcon = ({ status, size = 20, color }) => {
    const Icon = STATUS_ICONS[status] || Package;
    return <Icon width={size} height={size} color={color} />;
  };

  return (
    <div style={S.page}>
      <style>{`
        @keyframes tpPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.6)}}
        @keyframes tpSpin{to{transform:rotate(360deg)}}
        @keyframes tpFadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .tp-refresh-btn:hover{background:rgba(255,255,255,0.22)!important}
        .tp-card{animation:tpFadeIn 0.4s ease}
      `}</style>

      {/* ═══ Header with Logo + Refresh ═══ */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <a href="https://pioneercarservice.com" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
            <img src="/assets/images/logos/pioneer_white_without_bg.png" alt="Pioneer" style={S.logo} />
          </a>
          <div>
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: '.02em' }}>Pioneer Car Service Center</div>
          </div>
        </div>
        <div style={S.headerRight}>
          {isLive && (
            <div style={S.liveTag}>
              <span style={S.liveDot} />
              {t('trackingPublic.live')}
            </div>
          )}
          <button onClick={() => fetchOrder(true)} style={S.refreshBtn} className="tp-refresh-btn"
            title={lastRefresh ? `${t('trackingPublic.last_updated')}: ${lastRefresh.toLocaleTimeString()}` : t('trackingPublic.refresh')}>
            <Refresh width={14} height={14} style={refreshing ? { animation: 'tpSpin 0.8s linear infinite' } : undefined} />
            {lastRefresh && <span>{lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          </button>
        </div>
      </div>

      <div style={S.content}>
        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 80 }}>
            <div style={{ width: 48, height: 48, border: '4px solid #f1f5f9', borderTopColor: '#f97316', borderRadius: '50%', margin: '0 auto 20px', animation: 'tpSpin 0.8s linear infinite' }} />
            <div style={{ color: '#64748b', fontSize: 16, fontWeight: 600 }}>{t("trackingPublic.loading")}</div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={{ textAlign: 'center', padding: 80 }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <WarningTriangle width={32} height={32} color="#dc2626" />
            </div>
            <div style={{ color: '#dc2626', fontSize: 18, fontWeight: 700 }}>{error}</div>
            <div style={{ color: '#64748b', fontSize: 14, marginTop: 8 }}>{t("trackingPublic.not_found")}</div>
          </div>
        )}

        {order && !loading && (
          <>
            {/* ═══ Status Hero Card ═══ */}
            <div className="tp-card" style={{ ...S.card, textAlign: 'center', padding: '32px 24px 28px',
              borderTop: `4px solid ${isFinal && order.status === 'completed' ? '#16a34a' : isFinal ? '#dc2626' : '#f97316'}` }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%', margin: '0 auto 16px',
                background: `${STATUS_COLORS[order.status] || '#f97316'}12`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `3px solid ${STATUS_COLORS[order.status] || '#f97316'}30`,
              }}>
                <StatusIcon status={order.status} size={32} color={STATUS_COLORS[order.status] || '#f97316'} />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>
                {t('trackingPublic.status.' + order.status) || order.status}
              </div>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Package width={14} height={14} color="#94a3b8" /> {t('trackingPublic.work_order_number_label', { number: order.work_order_number })}
              </div>
              {isLive && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fef3c7', padding: '7px 16px', borderRadius: 20, fontSize: 13, color: '#92400e', fontWeight: 600, border: '1px solid #fde68a' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'tpPulse 1.5s ease-in-out infinite' }} />
                  {t('trackingPublic.mechanic_en_route')}
                </div>
              )}
              {order.status === 'completed' && order.completed_at && (
                <div style={{ marginTop: 12, color: '#16a34a', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <CheckCircle width={16} height={16} /> {t('trackingPublic.completed_at')} {new Date(order.completed_at).toLocaleString()}
                </div>
              )}
            </div>

            {/* ═══ Progress Steps ═══ */}
            {((!isFinal && currentStep >= 0) || order.status === 'completed') && (
              <div className="tp-card" style={{ ...S.card, padding: '24px 20px' }}>
                <div style={{ position: 'relative', paddingBottom: 32 }}>
                  <div style={{ position: 'absolute', top: 16, [isRTL?'right':'left']: '8%', [isRTL?'left':'right']: '8%', height: 3, background: '#e2e8f0', borderRadius: 2 }} />
                  <div style={{ position: 'absolute', top: 16, [isRTL?'right':'left']: '8%', height: 3, background: order.status === 'completed' ? 'linear-gradient(90deg, #16a34a, #15803d)' : isRTL ? 'linear-gradient(270deg, #f97316, #ea580c)' : 'linear-gradient(90deg, #f97316, #ea580c)', borderRadius: 2, width: order.status === 'completed' ? '84%' : (currentStep / (STATUS_STEPS.length - 1) * 84) + '%', transition: 'width 0.6s ease' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    {STATUS_STEPS.map((step, idx) => {
                      const isDelivered = order.status === 'completed';
                      const done = isDelivered ? true : idx <= currentStep;
                      const active = isDelivered ? step === 'completed' : idx === currentStep;
                      const stepColor = isDelivered ? '#16a34a' : '#f97316';
                      const stepGradient = isDelivered ? 'linear-gradient(135deg, #16a34a, #15803d)' : 'linear-gradient(135deg, #f97316, #ea580c)';
                      return (
                        <div key={step} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: done ? stepGradient : '#f1f5f9',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: done ? '#fff' : '#94a3b8', fontWeight: 700, fontSize: 12,
                            zIndex: 1, position: 'relative', transition: 'all 0.3s',
                            boxShadow: active ? `0 0 0 4px ${stepColor}33` : done ? `0 2px 8px ${stepColor}4d` : 'none',
                            border: active ? `3px solid ${isDelivered ? '#15803d' : '#ea580c'}` : done ? 'none' : '2px solid #e2e8f0',
                          }}>
                            {done ? (active ? <StatusIcon status={step} size={14} color="#fff" /> : <Check width={14} height={14} />) : <span>{idx + 1}</span>}
                          </div>
                          <div style={{ fontSize: 10, textAlign: 'center', color: done ? stepColor : '#94a3b8', fontWeight: done ? 700 : 500, lineHeight: 1.2 }}>
                            {t('trackingPublic.status.' + step)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ Live Map ═══ */}
            {order.mechanic_location && (
              <div className="tp-card" style={S.card}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Map width={18} height={18} color="#f97316" /> {t('trackingPublic.live_mechanic_location')}
                  </span>
                  {lastRefresh && <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('trackingPublic.as_of')} {lastRefresh.toLocaleTimeString()}</span>}
                </div>
                <div ref={mapRef} style={{ height: 280, width: '100%' }} />
              </div>
            )}

            {/* ═══ Mechanic Info ═══ */}
            {order.mechanic_name && (
              <div className="tp-card" style={{ ...S.card, border: '1px solid #fed7aa', background: '#fffbf5' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #fed7aa', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <DeliveryTruck width={18} height={18} color="#c2410c" />
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#c2410c' }}>{t("trackingPublic.your_mechanic")}</span>
                </div>
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #f97316, #ea580c)', color: '#fff', fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {order.mechanic_name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17, color: '#0f172a' }}>{order.mechanic_name}</div>
                    {order.mechanic_phone && (
                      <a href={'tel:' + order.mechanic_phone} style={{ color: '#f97316', fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                        <Phone width={13} height={13} /> {order.mechanic_phone}
                      </a>
                    )}
                    {order.vehicle_type && (
                      <div style={{ color: '#64748b', fontSize: 13, marginTop: 3 }}>{order.vehicle_type} \u00b7 {order.vehicle_plate}</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ WorkOrder Details ═══ */}
            <div className="tp-card" style={S.card}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Package width={18} height={18} color="#f97316" />
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{t("trackingPublic.order_details")}</span>
              </div>
              <div style={{ padding: '4px 20px 12px' }}>
                {[
                  { key: 'recipient', label: t('trackingPublic.detail.recipient'), value: order.customer_name, icon: User },
                  { key: 'address',   label: t('trackingPublic.detail.address'),   value: order.dropoff_address, icon: MapPin },
                  { key: 'type',      label: t('trackingPublic.detail.type'),      value: order.work_order_type?.replace(/_/g, ' '), icon: Package },
                  { key: 'payment',   label: t('trackingPublic.detail.payment'),   value: order.payment_method?.toUpperCase(), icon: Clock },
                  order.cash_amount > 0 ? { key: 'cod', label: t('trackingPublic.detail.cash_amount'), value: t('trackingPublic.detail.aed') + ' ' + parseFloat(order.cash_amount).toFixed(2), highlight: true, icon: Clock } : null,
                  order.scheduled_at ? { key: 'scheduled', label: t('trackingPublic.detail.scheduled'), value: new Date(order.scheduled_at).toLocaleString(), icon: Calendar } : null,
                ].filter(Boolean).map(item => {
                  const Icon = item.icon;
                  return (
                    <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid #f8fafc' }}>
                      <span style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon width={14} height={14} color="#94a3b8" /> {item.label}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: item.highlight ? 800 : 600, color: item.highlight ? '#f97316' : '#0f172a', textTransform: item.key === 'type' ? 'capitalize' : 'none' }}>{item.value || '\u2014'}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ═══ Parts Breakdown ═══ */}
            {order.parts?.length > 0 && (
              <div className="tp-card" style={S.card}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Package width={18} height={18} color="#f97316" /> {t('trackingPublic.packages', { defaultValue: 'Parts' })}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#f97316', background: '#fff7ed', padding: '3px 10px', borderRadius: 10 }}>
                    {order.parts.filter(p => p.status === 'installed').length}/{order.parts.length}
                  </span>
                </div>
                <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {order.parts.map((part, idx) => {
                    const partColors = { ordered: '#f59e0b', in_stock: '#3b82f6', installed: '#16a34a', returned: '#dc2626' };
                    const partColor = partColors[part.status] || '#94a3b8';
                    return (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: '#f8fafc', borderRadius: 12, border: '1px solid #f1f5f9' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${partColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Package width={18} height={18} color={partColor} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
                            {part.quantity}× {part.name}
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                            {part.description || (part.part_number ? `#${part.part_number}` : '')}
                          </div>
                        </div>
                        <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, color: '#fff', background: partColor, whiteSpace: 'nowrap' }}>
                          {part.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══ Service Journey ═══ */}
            {order.status_logs?.length > 0 && (
              <div className="tp-card" style={S.card}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Timer width={18} height={18} color="#f97316" />
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{t("trackingPublic.journey")}</span>
                </div>
                <div style={{ padding: '16px 20px', position: 'relative', [isRTL?'paddingRight':'paddingLeft']: 44 }}>
                  <div style={{ position: 'absolute', [isRTL?'right':'left']: 30, top: 8, bottom: 8, width: 2, background: '#f1f5f9' }} />
                  {order.status_logs.map((log, idx) => {
                    const isLast = idx === order.status_logs.length - 1;
                    const clr = isLast ? (STATUS_COLORS[log.status] || '#f97316') : '#cbd5e1';
                    return (
                      <div key={idx} style={{ position: 'relative', marginBottom: 20 }}>
                        <div style={{
                          position: 'absolute', [isRTL?'right':'left']: -22, top: 2, width: 18, height: 18, borderRadius: '50%',
                          background: isLast ? clr : '#f8fafc',
                          border: isLast ? 'none' : `2px solid ${clr}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: isLast ? `0 2px 8px ${clr}40` : 'none',
                        }}>
                          {isLast && <StatusIcon status={log.status} size={10} color="#fff" />}
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: isLast ? clr : '#1e293b', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t('trackingPublic.status.' + log.status) || log.status}
                        </div>
                        {(log.note || log.notes) && <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>{log.note || log.notes}</div>}
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Calendar width={10} height={10} /> {new Date(log.created_at).toLocaleString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={S.footer}>
        {t('trackingPublic.powered_by')} <a href="https://pioneercarservice.com" target="_blank" rel="noopener noreferrer" style={{ color: '#1e3a6b', fontWeight: 700, textDecoration: 'none' }}>Pioneer Car Service Center</a>
      </div>
    </div>
  );
}
