import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import jsQR from 'jsqr';
import {
  Camera, RotateCameraRight, VideoCamera, MapPin, Phone,
  WarningTriangle, Clock, XmarkCircle, NavArrowRight, ScanBarcode,
  Package as PackageIcon, CheckCircle,
} from 'iconoir-react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import './CRMPages.css';

/* ── Status transition rules (mirrors backend MECHANIC_TRANSITIONS) ── */
const VALID_NEXT = {
  pending:          ['confirmed', 'cancelled'],
  confirmed:        ['assigned', 'cancelled'],
  assigned:         ['accepted', 'in_progress', 'cancelled'],
  accepted:         ['in_progress', 'cancelled'],
  in_progress:      ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['completed', 'cancelled'],
  completed:        [],
  cancelled:        [],
};

const STATUS_META = {
  pending:          { color: '#f59e0b', labelKey: 'pending' },
  confirmed:        { color: '#10b981', labelKey: 'confirmed' },
  assigned:         { color: '#6366f1', labelKey: 'assigned' },
  accepted:         { color: '#1565C0', labelKey: 'accepted' },
  in_progress:      { color: '#0e7490', labelKey: 'in_progress' },
  ready_for_pickup: { color: '#c2410c', labelKey: 'ready_for_pickup' },
  completed:        { color: '#16a34a', labelKey: 'completed' },
  cancelled:        { color: '#94a3b8', labelKey: 'cancelled' },
};

const STATUS_FLOW = {
  confirmed:        { actionKey: 'confirmed',        scan_type: 'bay_in',         bg: '#10b981' },
  accepted:         { actionKey: 'accepted',         scan_type: 'checkin_scan',   bg: '#1565C0' },
  in_progress:      { actionKey: 'in_progress',      scan_type: 'pickup_scan',    bg: '#0e7490' },
  ready_for_pickup: { actionKey: 'ready_for_pickup',  scan_type: 'checkin_scan',   bg: '#c2410c' },
  completed:        { actionKey: 'completed',         scan_type: 'completion_scan', bg: '#16a34a' },
  cancelled:        { actionKey: 'cancelled',         scan_type: 'checkin_scan',   bg: '#94a3b8' },
};

const PART_STATUS_META = {
  ordered:   { color: '#f59e0b', label: 'Ordered' },
  in_stock:  { color: '#3b82f6', label: 'In Stock' },
  installed: { color: '#16a34a', label: 'Installed' },
  returned:  { color: '#dc2626', label: 'Returned' },
};

function getGPS() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 4000 }
    );
  });
}

/* ─────────────────── WorkOrder Card ──────────────────────────────────── */
function OrderCard({ order, onStatusUpdate, onScan, loading, scannedPartId, cur }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [statusNote, setStatusNote] = useState('');
  const [cashAmt, setCashAmt]       = useState(order.cash_amount || '');
  const [updating, setUpdating]     = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [showPackages, setShowPackages] = useState(!!scannedPartId);

  const parts = order.parts || [];
  const hasPackages = parts.length > 0;
  const deliveredPkgs = parts.filter(p => p.status === 'installed').length;

  const nextStatuses = VALID_NEXT[order.status] || [];
  const meta = STATUS_META[order.status] || {};
  const statusLabel = t(`orders.status.${meta.labelKey}`, { defaultValue: meta.labelKey || order.status });

  const doStatusUpdate = async (newStatus) => {
    setUpdating(true);
    const gps = await getGPS();
    const payload = { statusNote, gps };
    if (newStatus === 'completed' && order.payment_method === 'cash' && cashAmt) {
      payload.cash_collected_amount = parseFloat(cashAmt);
    }
    const result = await onStatusUpdate(order.service_status_token, newStatus, statusNote, gps, payload.cash_collected_amount);
    const newLabel = t(`orders.status.${newStatus}`, { defaultValue: newStatus });
    if (result?.success) {
      setScanResult({ ok: true, msg: t('mechanicScan.marked_as', { status: newLabel }) });
    } else {
      setScanResult({ ok: false, msg: result?.message || t('mechanicScan.update_failed') });
    }
    setUpdating(false);
  };

  const doScan = async (scanType) => {
    setUpdating(true);
    const gps = await getGPS();
    const result = await onScan(order.service_status_token, scanType, gps);
    if (result?.success) {
      setScanResult({ ok: true, msg: result.message || t('mechanicScan.scan_logged') });
    } else {
      setScanResult({ ok: false, msg: result?.message || t('mechanicScan.scan_failed') });
    }
    setUpdating(false);
  };

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
      {/* WorkOrder Header */}
      <div style={{ background: meta.color || '#64748b', padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.25rem' }}>{order.work_order_number}</div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '.85rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 10px', borderRadius: 12, fontWeight: 700 }}>
              {statusLabel}
            </span>
            {order.payment_method === 'cash' && parseFloat(order.cash_amount) > 0 && (
              <span style={{ background: 'rgba(255,255,255,0.25)', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 700 }}>
                CASH {cur} {order.cash_amount}
              </span>
            )}
            {hasPackages && (
              <span style={{ background: 'rgba(255,255,255,0.25)', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 700 }}>
                <PackageIcon width={11} height={11} style={{ verticalAlign: '-1px' }} /> {deliveredPkgs}/{parts.length}
              </span>
            )}
          </div>
        </div>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Clock width={24} height={24} color="#fff" />
        </div>
      </div>

      <div style={{ padding: '18px 20px' }}>
        {/* Customer */}
        <div style={{ background: 'var(--bg-hover)', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>
            {t('mechanicScan.recipient')}
          </div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{order.customer_full_name || order.customer_name}</div>
          {order.customer_phone && (
            <a href={`tel:${order.customer_phone}`} style={{ color: '#f97316', fontWeight: 600, fontSize: '.9rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <Phone width={14} height={14} /> {order.customer_phone}
            </a>
          )}
          {order.dropoff_address && (
            <div style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.4 }}>
              <MapPin width={14} height={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{order.dropoff_address}</span>
            </div>
          )}
          {order.service_bay_name && (
            <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', marginTop: 4 }}>{order.service_bay_name}</div>
          )}
        </div>

        {/* Open in Maps */}
        {(order.dropoff_lat && order.dropoff_lng) ? (
          <a href={`https://maps.google.com/?q=${order.dropoff_lat},${order.dropoff_lng}`} target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px', borderRadius: 10, background: '#dbeafe', color: '#1d4ed8', fontWeight: 700, fontSize: '.85rem', textDecoration: 'none', marginBottom: 14 }}>
            <MapPin width={15} height={15} /> {t('mechanicScan.open_maps')}
          </a>
        ) : order.dropoff_address ? (
          <a href={`https://maps.google.com/?q=${encodeURIComponent(order.dropoff_address)}`} target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px', borderRadius: 10, background: '#dbeafe', color: '#1d4ed8', fontWeight: 700, fontSize: '.85rem', textDecoration: 'none', marginBottom: 14 }}>
            <MapPin width={15} height={15} /> {t('mechanicScan.search_maps')}
          </a>
        ) : null}

        {/* Parts Section */}
        {hasPackages && (
          <div style={{ marginBottom: 14 }}>
            <button onClick={() => setShowPackages(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-hover)', cursor: 'pointer', color: 'var(--text-primary)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '.85rem' }}>
                <PackageIcon width={16} height={16} />
                {t('mechanicScan.packages', { defaultValue: 'Parts' })} ({deliveredPkgs}/{parts.length})
              </span>
              <NavArrowRight width={16} height={16} style={{ transform: showPackages ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
            </button>
            {showPackages && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {parts.map(part => {
                  const partMeta = PART_STATUS_META[part.status] || {};
                  const isScanned = part.id === scannedPartId;
                  return (
                    <div key={part.id} style={{
                      background: isScanned ? '#eff6ff' : 'var(--bg-card)',
                      border: `1px solid ${isScanned ? '#3b82f6' : 'var(--border)'}`,
                      borderRadius: 10, padding: '10px 14px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '.85rem' }}>{part.quantity}× {part.name}</div>
                          {part.part_number && <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>#{part.part_number}</div>}
                        </div>
                        <span style={{ padding: '2px 10px', borderRadius: 10, fontSize: '.72rem', fontWeight: 700, color: '#fff', background: partMeta.color || '#94a3b8' }}>
                          {partMeta.label || part.status}
                        </span>
                      </div>
                      {parseFloat(part.total_cost) > 0 && (
                        <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                          {cur} {parseFloat(part.total_cost).toFixed(2)}
                        </div>
                      )}
                      {isScanned && (
                        <div style={{ marginTop: 6, fontSize: '.75rem', color: '#3b82f6', fontWeight: 600 }}>
                          {t('mechanicScan.scanned_package', { defaultValue: 'Scanned part' })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Cash Collection */}
        {order.payment_method === 'cash' && order.status === 'ready_for_pickup' && (
          <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: '.75rem', fontWeight: 700, color: '#92400e', marginBottom: 8 }}>
              {t('mechanicScan.cod_collect')}
            </div>
            <input type="number" step="0.01" value={cashAmt} onChange={e => setCashAmt(e.target.value)}
              placeholder={t('mechanicScan.enter_amount')}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #fcd34d', fontSize: '1.1rem', fontWeight: 700, color: '#92400e', background: '#fffbeb', boxSizing: 'border-box' }} />
            <div style={{ fontSize: '.75rem', color: '#92400e', marginTop: 4 }}>{t('mechanicScan.confirm_hint')}</div>
          </div>
        )}

        {/* Note */}
        <div style={{ marginBottom: 14 }}>
          <textarea rows={2} placeholder={t('mechanicScan.note_placeholder')} value={statusNote}
            onChange={e => setStatusNote(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-primary)', fontSize: '.875rem', resize: 'none', boxSizing: 'border-box' }} />
        </div>

        {/* Quick Scan Buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {['bay_in', 'bay_out'].map(st => (
            <button key={st} onClick={() => doScan(st)} disabled={updating}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-hover)', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              {st === 'bay_in' ? t('mechanicScan.hub_in') : t('mechanicScan.hub_out')}
            </button>
          ))}
        </div>

        {/* Status Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {nextStatuses.filter(s => STATUS_FLOW[s]).map(s => {
            const flow = STATUS_FLOW[s];
            return (
              <button key={s} onClick={() => doStatusUpdate(s)} disabled={updating || loading}
                style={{ padding: '14px', borderRadius: 12, border: 'none', background: flow.bg, color: '#fff', fontWeight: 800, fontSize: '1rem', cursor: 'pointer', opacity: (updating || loading) ? 0.7 : 1 }}>
                {updating ? t('mechanicScan.processing') : t(`mechanicScan.action.${flow.actionKey}`)}
              </button>
            );
          })}
          {nextStatuses.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: '.9rem' }}>
              {t('mechanicScan.no_actions')} — {statusLabel}
            </div>
          )}
        </div>

        {/* Scan Result Toast */}
        {scanResult && (
          <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, fontSize: '.875rem', fontWeight: 600,
            background: scanResult.ok ? '#dcfce7' : '#fee2e2',
            color: scanResult.ok ? '#16a34a' : '#dc2626' }}>
            {scanResult.msg}
          </div>
        )}

        {/* Status Timeline */}
        {order.status_logs?.length > 0 && (
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: '.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock width={14} height={14} /> {t('mechanicScan.history', { count: order.status_logs.length })}
            </summary>
            <div style={{ marginTop: 10, [isRTL?'paddingRight':'paddingLeft']: 12, [isRTL?'borderRight':'borderLeft']: '2px solid var(--border)' }}>
              {order.status_logs.slice(-6).reverse().map((log, i) => {
                const lMeta = STATUS_META[log.status] || {};
                const lLabel = t(`orders.status.${lMeta.labelKey || log.status}`, { defaultValue: log.status });
                return (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: '.82rem', color: lMeta.color }}>{lLabel}</div>
                    {log.note && <div style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>{log.note}</div>}
                    <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{new Date(log.created_at).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Main Mechanic Scan Page ───────────────────────── */
export default function MechanicScan() {
  const { t } = useTranslation();
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const rafRef     = useRef(null);

  const [scanning,   setScanning]   = useState(false);
  const [cameraErr,  setCameraErr]  = useState('');
  const [manualToken, setManualToken] = useState('');
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [order,      setOrder]      = useState(null);
  const [fetchError, setFetchError] = useState('');
  const [lastToken,  setLastToken]  = useState('');
  const [facingMode, setFacingMode] = useState('environment'); // rear camera default
  const [scannedPartId, setScannedPartId] = useState(null);

  /* ─── Camera ─────────────────────────────────────────────────── */
  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch (err) {
      setCameraErr(t('mechanicScan.camera_error'));
    }
  }, [facingMode]);

  /* ─── QR decode loop ─────────────────────────────────────────── */
  useEffect(() => {
    if (!scanning) return;
    const decode = () => {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(decode);
        return;
      }
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr  = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (qr?.data) {
        const token = extractToken(qr.data);
        if (token && token !== lastToken) {
          setLastToken(token);
          stopCamera();
          loadOrder(token);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(decode);
    };
    rafRef.current = requestAnimationFrame(decode);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [scanning, lastToken]);

  /* ─── Extract token from QR data ────────────────────────────── */
  const extractToken = (data) => {
    // Could be full URL: https://domain/track/TRK-XXXX
    // Or just a token: TRK-XXXX or ORD-XXXX
    try {
      const url = new URL(data);
      const parts = url.pathname.replace(/\/$/, '').split('/');
      const idx = parts.findIndex(p => p === 'track');
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    } catch { /* not a URL — use raw */ }
    return data.trim();
  };

  /* ─── Load order by token ────────────────────────────────────── */
  const loadOrder = async (token) => {
    setLoadingOrder(true);
    setFetchError('');
    setOrder(null);
    setScannedPartId(null);
    const res = await api.get(`/service-status/${token}/order`);
    if (res.success) {
      setOrder(res.data);
      if (res.scanned_part_id) setScannedPartId(res.scanned_part_id);
      // Auto-log the scan
      await api.post(`/service-status/${token}/scan`, { scan_type: 'mechanic_scan' }).catch(() => {});
    } else {
      setFetchError(res.message || t('common.not_found', { defaultValue: 'WorkOrder not found' }));
    }
    setLoadingOrder(false);
  };

  const handleManualSearch = async (e) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    await loadOrder(manualToken.trim());
  };

  const handleStatusUpdate = async (token, status, note, gps, cash_collected_amount) => {
    const payload = {
      status, note: note || undefined, lat: gps?.lat, lng: gps?.lng,
    };
    if (cash_collected_amount != null) payload.cash_collected_amount = cash_collected_amount;
    return await api.patch(`/service-status/${token}/status`, payload);
  };

  const handleScan = async (token, scanType, gps) => {
    return await api.post(`/service-status/${token}/scan`, {
      scan_type: scanType, lat: gps?.lat, lng: gps?.lng,
    });
  };

  const reset = () => {
    setOrder(null);
    setFetchError('');
    setLastToken('');
    setManualToken('');
    setScannedPartId(null);
  };

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <div className="page-container" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="module-hero" style={{ marginBottom: 20 }}>
        <div className="module-hero-left">
          <h2 className="module-hero-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ScanBarcode width={22} height={22} /> {t('mechanicScan.title')}</h2>
          <p className="module-hero-sub">{t("mechanicScan.scan_hint")}</p>
        </div>
        {order && (
          <div className="module-hero-actions">
            <button onClick={reset} className="module-btn module-btn-outline">{t("mechanicScan.scan_another")}</button>
          </div>
        )}
      </div>

      {/* ── Scanner View ──────────────────────────────────────────── */}
      {!order && (
        <>
          {/* Camera Box */}
          <div style={{ position: 'relative', background: '#0f172a', borderRadius: 16, overflow: 'hidden', marginBottom: 16, aspectRatio: '4/3' }}>
            <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: scanning ? 'block' : 'none' }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Viewfinder overlay */}
            {scanning && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: '60%', aspectRatio: '1', border: '3px solid #f97316', borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }}>
                  <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.7)', fontSize: '.8rem', whiteSpace: 'nowrap' }}>
                    {t('mechanicScan.point_qr')}
                  </div>
                </div>
              </div>
            )}

            {/* Idle state */}
            {!scanning && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#94a3b8' }}>
                <VideoCamera width={56} height={56} />
                <div style={{ fontSize: '.9rem' }}>{t('mechanicScan.camera_off')}</div>
              </div>
            )}

            {/* Camera controls */}
            <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 12 }}>
              {!scanning ? (
                <button onClick={startCamera}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 28px', borderRadius: 12, border: 'none', background: '#f97316', color: '#fff', fontWeight: 800, fontSize: '1rem', cursor: 'pointer' }}>
                  <Camera width={18} height={18} /> {t('mechanicScan.start_scanner')}
                </button>
              ) : (
                <>
                  <button onClick={() => { setFacingMode(f => f === 'environment' ? 'user' : 'environment'); stopCamera(); setTimeout(startCamera, 300); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', fontSize: '.85rem' }}>
                    <RotateCameraRight width={16} height={16} /> {t('mechanicScan.flip')}
                  </button>
                  <button onClick={stopCamera}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: 'none', background: 'rgba(255,0,0,0.3)', color: '#fff', cursor: 'pointer', fontSize: '.85rem' }}>
                    <XmarkCircle width={16} height={16} /> {t('mechanicScan.stop')}
                  </button>
                </>
              )}
            </div>
          </div>

          {cameraErr && (
            <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 10, fontSize: '.85rem', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <WarningTriangle width={16} height={16} /> {cameraErr}
            </div>
          )}

          {/* Manual Entry */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', marginBottom: 16 }}>
            <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {t('mechanicScan.or_enter_manually')}
            </div>
            <form onSubmit={handleManualSearch} style={{ display: 'flex', gap: 10 }}>
              <input type="text" value={manualToken} onChange={e => setManualToken(e.target.value)}
                placeholder={t("mechanicScan.token_placeholder")}
                style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-primary)', fontSize: '.9rem' }} />
              <button type="submit" disabled={loadingOrder}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 16px', borderRadius: 10, border: 'none', background: '#f97316', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                {loadingOrder ? <Clock width={18} height={18} /> : <NavArrowRight width={18} height={18} />}
              </button>
            </form>
          </div>

          {fetchError && (
            <div style={{ background: '#fee2e2', color: '#dc2626', padding: '14px 18px', borderRadius: 12, textAlign: 'center', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <WarningTriangle width={16} height={16} /> {fetchError}
            </div>
          )}

          {loadingOrder && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <ScanBarcode width={40} height={40} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div>{t('mechanicScan.looking_up')}</div>
            </div>
          )}
        </>
      )}

      {/* ── WorkOrder Detail View ────────────────────────────────────── */}
      {order && (
        <OrderCard
          order={order}
          onStatusUpdate={handleStatusUpdate}
          onScan={handleScan}
          loading={loadingOrder}
          scannedPartId={scannedPartId}
          cur={cur}
        />
      )}
    </div>
  );
}
