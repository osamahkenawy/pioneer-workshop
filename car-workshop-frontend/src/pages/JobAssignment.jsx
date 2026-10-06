import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package, DeliveryTruck, MapPin, Refresh, Check, Xmark, WarningTriangle, Map as MapIcon, ViewGrid,
  Weight, Wallet, CreditCard, Box3dPoint, Clock, Calendar, User, Phone, ArrowRight, HandBrake,
  Search, ScanBarcode, QrCode, Camera, Building, Notes, NavArrowDown, Filter as FilterIcon,
  Eye, Copy, Printer, OpenNewWindow, DollarCircle, Prohibition, Download, Settings,
} from 'iconoir-react';
import JsBarcode from 'jsbarcode';
import { BrowserMultiFormatReader } from '@zxing/browser';
import api from '../lib/api';
import MapView from '../components/MapView';
import './CRMPages.css';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { getPhoneCodeForCountry } from '../components/PhoneInput';
import { escapeHtml } from '../utils/escapeHtml';
import { downloadCsv, toCsv, csvCell } from '../utils/csv';

/* ── Barcode SVG ─────────────────────────────────────────── */
function BarcodeDisplay({ value, small }) {
  const svgRef = useRef(null);
  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, String(value), {
        format: 'CODE128',
        width: small ? 1 : 1.4,
        height: small ? 24 : 36,
        displayValue: false,
        margin: 0,
        background: 'transparent',
        lineColor: '#1e293b',
      });
    } catch {}
  }, [value, small]);
  if (!value) return null;
  return (
    <div style={{ background:'#f8fafc', borderRadius: small ? 6 : 8, padding: small ? '4px 6px' : '8px 10px', textAlign:'center',
      border:'1px solid #e2e8f0', margin: small ? '0' : '10px 0 4px' }}>
      <svg ref={svgRef} style={{ width:'100%', maxWidth: small ? 140 : 220, height: small ? 24 : 36 }} />
      <div style={{ fontFamily:'monospace', fontSize: small ? 8 : 10, color:'#64748b', letterSpacing:'0.08em',
        marginTop:1, fontWeight:600 }}>{String(value)}</div>
    </div>
  );
}

const PKG_STATUS_STYLE = {
  created:      { bg: '#f1f5f9', color: '#64748b', label: 'Created' },
  assigned:     { bg: '#ede9fe', color: '#7c3aed', label: 'Assigned' },
  warehouse_in: { bg: '#dbeafe', color: '#1d4ed8', label: 'Warehouse' },
  picked_up:    { bg: '#fce7f3', color: '#be185d', label: 'Picked Up' },
  in_transit:   { bg: '#e0f2fe', color: '#0369a1', label: 'In Transit' },
  out_for_delivery: { bg: '#fef3c7', color: '#d97706', label: 'Out for Delivery' },
  delivered:    { bg: '#dcfce7', color: '#16a34a', label: 'Delivered' },
  failed:       { bg: '#fee2e2', color: '#dc2626', label: 'Failed' },
  returned:     { bg: '#fff7ed', color: '#ea580c', label: 'Returned' },
};

const PART_STATUS_STYLE = {
  ordered:   { bg: '#fffbeb', color: '#f59e0b', label: 'Ordered' },
  in_stock:  { bg: '#eff6ff', color: '#3b82f6', label: 'In Stock' },
  installed: { bg: '#f0fdf4', color: '#16a34a', label: 'Installed' },
  returned:  { bg: '#fef2f2', color: '#dc2626', label: 'Returned' },
};

const STATUS_STYLE = {
  pending:          { background: '#fef3c7', color: '#d97706', border: '#f59e0b' },
  confirmed:        { background: '#dbeafe', color: '#1d4ed8', border: '#3b82f6' },
  assigned:         { background: '#ede9fe', color: '#7c3aed', border: '#8b5cf6' },
  accepted:         { background: '#e0e7ff', color: '#1565C0', border: '#3b82f6' },
  in_progress:      { background: '#cffafe', color: '#0e7490', border: '#22d3ee' },
  ready_for_pickup: { background: '#ffedd5', color: '#c2410c', border: '#f97316' },
  completed:        { background: '#dcfce7', color: '#16a34a', border: '#22c55e' },
  cancelled:        { background: '#f1f5f9', color: '#64748b', border: '#94a3b8' },
};

/* ── Custom Mechanic Dropdown ─────────────────────────────── */
const MECHANIC_STATUS_META = {
  available: { label: 'Available', bg: '#dcfce7', color: '#16a34a', dot: '#22c55e' },
  busy:      { label: 'Busy',      bg: '#fee2e2', color: '#dc2626', dot: '#ef4444' },
  on_break:  { label: 'On Break',  bg: '#fef3c7', color: '#d97706', dot: '#f59e0b' },
  offline:   { label: 'Offline',   bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8' },
};
const VEHICLE_ICONS = { motorcycle: '🏍️', car: '🚗', van: '🚐', truck: '🚛', bicycle: '🚲' };

function MechanicDropdown({ mechanics, value, onChange, placeholder, t: translate }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [fixedPos, setFixedPos] = useState(null); // desktop-only: escapes scrollable card/column ancestors
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const updateFixedPos = useCallback(() => {
    if (!ref.current || window.innerWidth <= 640) { setFixedPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    setFixedPos({ position: 'fixed', top: r.bottom + 6, left: r.left, width: r.width, right: 'auto' });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateFixedPos();
    window.addEventListener('scroll', updateFixedPos, true);
    window.addEventListener('resize', updateFixedPos);
    return () => {
      window.removeEventListener('scroll', updateFixedPos, true);
      window.removeEventListener('resize', updateFixedPos);
    };
  }, [open, updateFixedPos]);

  const selected = mechanics?.find(d => String(d.id) === String(value));
  const filtered = (mechanics || []).filter(d => {
    if (!search) return true;
    const q = search.toLowerCase();
    return d.full_name?.toLowerCase().includes(q) || d.phone?.includes(q) || d.vehicle_plate?.toLowerCase().includes(q);
  });

  const handleSelect = (d) => { onChange(String(d.id)); setOpen(false); setSearch(''); };

  return (
    <div className="drv-dd" ref={ref}>
      <button type="button" className={`drv-dd-trigger ${open ? 'open' : ''} ${value ? 'has-value' : ''}`}
        onClick={() => { if (!open) updateFixedPos(); setOpen(o => !o); }}>
        {selected ? (
          <span className="drv-dd-selected">
            <span className="drv-dd-avatar" style={{ background: MECHANIC_STATUS_META[selected.status]?.bg, color: MECHANIC_STATUS_META[selected.status]?.color }}>
              {selected.full_name?.charAt(0)}
            </span>
            <span className="drv-dd-sel-info">
              <span className="drv-dd-sel-name">{selected.full_name}</span>
              <span className="drv-dd-sel-meta">{selected.vehicle_type} • {selected.vehicle_plate}</span>
            </span>
            <span className="drv-dd-sel-status" style={{ background: MECHANIC_STATUS_META[selected.status]?.bg, color: MECHANIC_STATUS_META[selected.status]?.color }}>
              <span className="drv-dd-dot" style={{ background: MECHANIC_STATUS_META[selected.status]?.dot }} />
              {MECHANIC_STATUS_META[selected.status]?.label}
            </span>
          </span>
        ) : (
          <span className="drv-dd-placeholder">
            <DeliveryTruck width={16} height={16} /> {placeholder || 'Select mechanic'}
          </span>
        )}
        <NavArrowDown width={16} height={16} className={`drv-dd-chevron ${open ? 'flip' : ''}`} />
      </button>

      {open && (
        <div className="drv-dd-menu" style={fixedPos || undefined}>
          <div className="drv-dd-search-wrap">
            <Search width={14} height={14} />
            <input ref={inputRef} className="drv-dd-search" placeholder={translate?.('job-assignment.search_mechanic') || 'Search mechanic...'}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="drv-dd-list">
            {filtered.length === 0 ? (
              <div className="drv-dd-empty">{translate?.('job-assignment.no_mechanics') || 'No mechanics found'}</div>
            ) : filtered.map(d => {
              const sm = MECHANIC_STATUS_META[d.status] || MECHANIC_STATUS_META.offline;
              return (
                <button key={d.id} type="button" className={`drv-dd-item ${String(d.id) === String(value) ? 'active' : ''}`}
                  onClick={() => handleSelect(d)}>
                  <span className="drv-dd-item-avatar" style={{ background: sm.bg, color: sm.color }}>
                    {d.full_name?.charAt(0)}
                  </span>
                  <span className="drv-dd-item-body">
                    <span className="drv-dd-item-row1">
                      <span className="drv-dd-item-name">{d.full_name}</span>
                      <span className="drv-dd-item-status" style={{ background: sm.bg, color: sm.color }}>
                        <span className="drv-dd-dot" style={{ background: sm.dot }} />
                        {sm.label}
                      </span>
                    </span>
                    <span className="drv-dd-item-row2">
                      <span>{VEHICLE_ICONS[d.vehicle_type] || '🚗'} {d.vehicle_type}</span>
                      {d.vehicle_plate && <span>• {d.vehicle_plate}</span>}
                      {d.active_orders > 0 && <span className="drv-dd-item-orders">{d.active_orders} active</span>}
                      {d.zone_name && <span>• {d.zone_name}</span>}
                    </span>
                  </span>
                  {String(d.id) === String(value) && <Check width={16} height={16} className="drv-dd-check" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── WhatsApp helpers (JobAssignment) ── */
const WhatsAppIconSvg = ({ size = 14, color = '#25D366' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink:0 }}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const _formatPhoneForWA = (phone, dialCode = '+971') => {
  if (!phone) return '';
  const code = dialCode.replace(/[^0-9]/g, '');
  let digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = code + digits.slice(1);
  if (digits.length <= 10 && !digits.startsWith(code)) digits = code + digits;
  return digits;
};

const _buildWAMsg = (o, isPickup, cur = 'AED') => {
  const trackUrl = o.service_status_token ? `${window.location.origin}/track/${o.service_status_token}` : '';
  const lines = [
    `📦 *Delivery Update*`,
    ``,
    `WorkOrder: *#${o.work_order_number || o.id}*`,
    isPickup && o.sender_name ? `Sender: ${o.sender_name}` : null,
    !isPickup && o.recipient_name ? `Recipient: ${o.recipient_name}` : null,
    !isPickup && o.recipient_address ? `📍 ${o.recipient_address}` : null,
    isPickup && o.sender_address ? `📍 ${o.sender_address}` : null,
    o.cash_amount > 0 ? `💰 COD: ${cur} ${parseFloat(o.cash_amount).toFixed(2)}` : null,
    ``,
    trackUrl ? `🔗 Track: ${trackUrl}` : null,
    `Thank you! 🙏`,
  ];
  return lines.filter(l => l !== null).join('\n');
};

const _openWA = (phone, message, dialCode) => {
  window.open(`https://wa.me/${_formatPhoneForWA(phone, dialCode)}?text=${encodeURIComponent(message)}`, '_blank');
};

/* ── Barcode / QR Scanner Component (extracted outside render) ── */
const BARCODE_FORMATS_NATIVE = ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'itf', 'codabar'];
const QR_FORMATS_NATIVE = ['qr_code', 'data_matrix', 'aztec', 'pdf417'];

function ScannerModal({ onScan, onClose, t, initialMode = 'barcode' }) {
  const videoRef = useRef(null);
  const [manualInput, setManualInput] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState(initialMode); // 'barcode' | 'qr'
  const [lastScanned, setLastScanned] = useState(null); // { value, format, time }
  const modeRef = useRef(initialMode);

  // Keep modeRef in sync so the scanning loop reads the latest mode
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    let stream = null;
    let animFrame = null;
    let zxingControls = null;
    let cancelled = false;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setScanning(true);
        }

        if ('BarcodeDetector' in window) {
          // Native BarcodeDetector — scan all formats, filter by mode in the loop
          const detector = new BarcodeDetector({
            formats: [...BARCODE_FORMATS_NATIVE, ...QR_FORMATS_NATIVE]
          });
          const scanFrame = async () => {
            if (cancelled) return;
            if (videoRef.current && videoRef.current.readyState === 4) {
              try {
                const barcodes = await detector.detect(videoRef.current);
                const allowed = modeRef.current === 'qr' ? QR_FORMATS_NATIVE : BARCODE_FORMATS_NATIVE;
                const match = barcodes.find(b => allowed.includes(b.format));
                if (match) {
                  setLastScanned({ value: match.rawValue, format: match.format, time: Date.now() });
                  onScan(match.rawValue);
                  if (stream) stream.getTracks().forEach(t => t.stop());
                  return;
                }
              } catch {}
            }
            animFrame = requestAnimationFrame(scanFrame);
          };
          videoRef.current?.addEventListener('loadeddata', () => scanFrame());
        } else {
          // Fallback: @zxing/browser (Safari, Firefox)
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
            if (result && !cancelled) {
              setLastScanned({ value: result.getText(), format: result.getBarcodeFormat?.() || 'unknown', time: Date.now() });
              onScan(result.getText());
              if (zxingControls) zxingControls.stop();
              if (stream) stream.getTracks().forEach(t => t.stop());
            }
          });
        }
      } catch (e) {
        if (!cancelled) setScanError(t('job-assignment.scanner_no_camera'));
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (animFrame) cancelAnimationFrame(animFrame);
      if (zxingControls) zxingControls.stop();
    };
  }, []);

  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      onScan(manualInput.trim());
    }
  };

  const isQR = mode === 'qr';
  const accentColor = isQR ? '#7c3aed' : '#3b82f6';

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: 460,
        boxShadow: '0 25px 70px rgba(0,0,0,0.25)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: isQR
            ? 'linear-gradient(135deg, #4c1d95, #6d28d9)'
            : 'linear-gradient(135deg, #1e293b, #334155)',
          color: '#fff', transition: 'background 0.3s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isQR ? <QrCode width={20} height={20} /> : <ScanBarcode width={20} height={20} />}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {isQR ? t('job-assignment.scanner_title_qr') : t('job-assignment.scanner_title_barcode')}
              </div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                {isQR ? t('job-assignment.scanner_hint_qr') : t('job-assignment.scanner_hint_barcode')}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8,
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#fff',
          }}>
            <Xmark width={18} height={18} />
          </button>
        </div>

        {/* Mode toggle tabs */}
        <div style={{
          display: 'flex', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0',
        }}>
          {[
            { key: 'barcode', icon: <ScanBarcode width={14} height={14} />, label: t('job-assignment.scan_barcode'), color: '#3b82f6' },
            { key: 'qr', icon: <QrCode width={14} height={14} />, label: t('job-assignment.scan_qr'), color: '#7c3aed' },
          ].map(tab => (
            <button key={tab.key} onClick={() => setMode(tab.key)} style={{
              flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
              background: mode === tab.key ? '#fff' : 'transparent',
              color: mode === tab.key ? tab.color : '#64748b',
              fontWeight: mode === tab.key ? 800 : 600, fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              borderBottom: mode === tab.key ? `3px solid ${tab.color}` : '3px solid transparent',
              transition: 'all 0.2s',
            }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Camera */}
        <div style={{ background: '#000', position: 'relative', minHeight: 260 }}>
          <video ref={videoRef} autoPlay playsInline muted style={{
            width: '100%', height: 260, objectFit: 'cover', display: 'block',
          }} />
          {/* Scan overlay — rectangle for barcode, square for QR */}
          {scanning && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <div style={{
                width: isQR ? 180 : 220, height: isQR ? 180 : 140,
                border: `3px solid ${accentColor}cc`,
                borderRadius: isQR ? 20 : 16, position: 'relative',
                boxShadow: '0 0 0 2000px rgba(0,0,0,0.3)',
                animation: 'scanPulse 2s ease-in-out infinite',
                transition: 'all 0.3s',
              }}>
                {/* Corner markers */}
                <div style={{ position: 'absolute', top: -2, left: -2, width: 20, height: 20, borderTop: `4px solid ${accentColor}`, borderLeft: `4px solid ${accentColor}`, borderRadius: '4px 0 0 0' }} />
                <div style={{ position: 'absolute', top: -2, right: -2, width: 20, height: 20, borderTop: `4px solid ${accentColor}`, borderRight: `4px solid ${accentColor}`, borderRadius: '0 4px 0 0' }} />
                <div style={{ position: 'absolute', bottom: -2, left: -2, width: 20, height: 20, borderBottom: `4px solid ${accentColor}`, borderLeft: `4px solid ${accentColor}`, borderRadius: '0 0 0 4px' }} />
                <div style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderBottom: `4px solid ${accentColor}`, borderRight: `4px solid ${accentColor}`, borderRadius: '0 0 4px 0' }} />
                {/* Mode label */}
                <div style={{
                  position: 'absolute', bottom: -24, left: '50%', transform: 'translateX(-50%)',
                  fontSize: 10, fontWeight: 700, color: '#fff', background: `${accentColor}cc`,
                  padding: '2px 10px', borderRadius: 6, whiteSpace: 'nowrap',
                }}>
                  {isQR ? 'QR Code' : 'Barcode'}
                </div>
              </div>
            </div>
          )}
          {scanError && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', background: '#1e293b', color: '#94a3b8',
            }}>
              <Camera width={40} height={40} style={{ marginBottom: 12, opacity: 0.5 }} />
              <div style={{ fontSize: 13, fontWeight: 600, textAlign: 'center', padding: '0 20px' }}>{scanError}</div>
            </div>
          )}
        </div>

        {/* Last scanned result */}
        {lastScanned && (
          <div style={{
            padding: '10px 22px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Check width={16} height={16} color="#16a34a" />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>{t('job-assignment.scanner_detected')}:</span>
            <code style={{
              fontSize: 13, fontWeight: 700, color: '#1e293b', background: '#dcfce7',
              padding: '2px 8px', borderRadius: 6, fontFamily: 'monospace',
            }}>{lastScanned.value}</code>
          </div>
        )}

        {/* Manual input */}
        <div style={{ padding: '18px 22px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('job-assignment.scanner_manual')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleManualSubmit()}
              placeholder={isQR ? t('job-assignment.scanner_placeholder_qr') : t('job-assignment.search_placeholder')}
              autoFocus={!!scanError}
              style={{
                flex: 1, padding: '11px 14px', borderRadius: 12, border: '2px solid #e2e8f0',
                fontSize: 14, fontWeight: 500, outline: 'none', transition: 'border-color 0.2s',
                fontFamily: 'monospace',
              }}
            />
            <button onClick={handleManualSubmit} style={{
              padding: '11px 20px', borderRadius: 12, border: 'none',
              background: `linear-gradient(135deg, ${accentColor}, ${isQR ? '#5b21b6' : '#2563eb'})`, color: '#fff',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background 0.3s',
            }}>
              <Search width={15} height={15} /> {t('job-assignment.scanner_search')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function JobAssignment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const dialCode = getPhoneCodeForCountry(workshop?.country);
  const [board, setBoard]                 = useState({ unassigned: [], active_deliveries: [], available_mechanics: [], all_mechanics: [] });
  const [loading, setLoading]             = useState(true);
  const [assigning, setAssigning]         = useState(null);
  const [selectedWorkOrders, setSelectedWorkOrders] = useState(new Set());
  const [selectedMechanic, setSelectedMechanic] = useState('');
  const [error, setError]                 = useState('');
  const [view, setView]                   = useState('board');           // 'board' only

  /* ── Search & Scanner state ── */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showScanner, setShowScanner] = useState(false); // false | 'barcode' | 'qr'

  /* ── Filter state ── */
  const [filterStatus, setFilterStatus] = useState('');         // '' = all
  const [filterZone, setFilterZone] = useState('');             // '' = all
  const [filterPayment, setFilterPayment] = useState('');       // '' = all
  const [filterDate, setFilterDate] = useState('');             // '' | 'today' | 'week' | 'custom'
  const [filterDateFrom, setFilterDateFrom] = useState('');     // YYYY-MM-DD
  const [filterDateTo, setFilterDateTo] = useState('');         // YYYY-MM-DD
  const [showFilters, setShowFilters] = useState(false);        // toggle filter bar
  const [sortBy, setSortBy] = useState('');                     // '' | 'date' | 'cod' | 'bay' | 'status'
  const [sortDir, setSortDir] = useState('asc');                // 'asc' | 'desc'

  /* ── Auto-assign state ── */
  const [autoAssigning, setAutoAssigning] = useState(null);    // order id being auto-assigned
  const [autoAssignAll, setAutoAssignAll] = useState(false);   // batch in progress
  const [autoAssignResult, setAutoAssignResult] = useState(null); // { workOrderId, success, message }

  /* ── Auto-assign configuration (per-workshop settings) ── */
  const [showAutoAssignConfig, setShowAutoAssignConfig] = useState(false);
  const [autoAssignCfg, setAutoAssignCfg] = useState({
    max_orders_per_mechanic: 5,
    min_mechanic_rating: 0,
    max_assign_distance_km: 0,
    enforce_vehicle_capacity: true,
  });
  const [autoAssignCfgLoaded, setAutoAssignCfgLoaded] = useState(false);
  const [autoAssignCfgSaving, setAutoAssignCfgSaving] = useState(false);
  const [autoAssignCfgSaved, setAutoAssignCfgSaved] = useState(false);

  /* ── Reassign state ── */
  const [reassigningOrder, setReassigningOrder] = useState(null);  // order id being reassigned
  const [reassignMechanic, setReassignMechanic] = useState('');        // selected new mechanic

  /* ── Drag-and-drop state ── */
  const [draggingOrder, setDraggingOrder] = useState(null);      // order id being dragged
  const [dragOverMechanic, setDragOverMechanic] = useState(null);    // mechanic id under cursor
  const [mechanicSearch, setMechanicSearch] = useState('');           // search in Available Mechanics column

  /* ── Load-more pagination for board columns ── */
  const PAGE_SIZE = 20;
  const [visibleUnassigned, setVisibleUnassigned] = useState(PAGE_SIZE);
  const [visibleActive, setVisibleActive] = useState(PAGE_SIZE);
  const [visibleMapUnassigned, setVisibleMapUnassigned] = useState(PAGE_SIZE);
  const [visibleMapActive, setVisibleMapActive] = useState(PAGE_SIZE);

  /* ── Map sidebar state ── */
  const [mapSidebarTab, setMapSidebarTab] = useState('unassigned'); // 'unassigned' | 'active' | 'mechanics'
  const [mapSidebarSearch, setMapSidebarSearch] = useState('');
  const [mapSidebarCollapsed, setMapSidebarCollapsed] = useState(false);
  const [flyTarget, setFlyTarget] = useState(null);
  const [highlightedCard, setHighlightedCard] = useState(null);
  const mapRef = useRef(null);

  /* ── Completed Today section ── */
  const [showCompleted, setShowCompleted] = useState(false);

  /* ── New-order notification sound ── */
  const prevUnassignedCount = useRef(null);
  const playNotificationSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const playTone = (freq, start, dur) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      };
      playTone(880, 0, 0.15);
      playTone(1100, 0.15, 0.2);
    } catch (e) { /* audio not supported */ }
  }, []);

  /* ── WorkOrder Detail Drawer state ── */
  const [drawer, setDrawer] = useState(null);           // order summary (clicked)
  const [drawerFull, setDrawerFull] = useState(null);    // full order detail from API
  const [drawerPackages, setDrawerPackages] = useState([]); // parts consumed on this work order
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [copiedToken, setCopiedToken] = useState(null);

  useEffect(() => {
    fetchBoard();
    loadAutoAssignConfig();
    const interval = setInterval(fetchBoard, 30000);
    return () => clearInterval(interval);
    // fetchBoard & loadAutoAssignConfig are stable useCallbacks declared
    // later in this component. Including them in the dep array causes a
    // production-only TDZ ("Cannot access 'X' before initialization")
    // because the dep array is evaluated when this useEffect call runs,
    // which is *before* their `const` initializers in render order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Auto-dismiss errors after 5s ── */
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  /* ── Global keyboard shortcuts ── */
  useEffect(() => {
    const handler = (e) => {
      // Skip when typing in inputs, textareas, selects, or contentEditable
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault();
          fetchBoard();
          break;
        case 'a':
          if (e.shiftKey) {
            // Shift+A = auto-assign all
            e.preventDefault();
            handleAutoAssignAll();
          }
          break;
        case 'm':
          e.preventDefault();
          setView(v => v === 'map' ? 'board' : 'map');
          break;
        case 'f':
          e.preventDefault();
          setShowFilters(f => !f);
          break;
        case 'escape':
          if (drawer) { setDrawer(null); setDrawerFull(null); }
          else if (showScanner) setShowScanner(false);
          else if (showFilters) setShowFilters(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drawer, showScanner, showFilters]);

  const fetchBoard = async () => {
    try {
      setLoading(true);
      const res = await api.get('/job-assignment');
      if (res.success) {
        const data = res.data || { unassigned: [], active_deliveries: [], available_mechanics: [] };
        // Play notification sound if new unassigned orders arrived
        const newCount = data.unassigned?.length || 0;
        if (prevUnassignedCount.current !== null && newCount > prevUnassignedCount.current) {
          playNotificationSound();
        }
        prevUnassignedCount.current = newCount;
        setBoard(data);
      }
    } catch (e) { console.error('JobAssignment fetch error:', e); }
    finally { setLoading(false); }
  };

  /* ── WorkOrder Detail Drawer ── */
  const openDrawer = (order) => {
    setDrawer(order);
    setDrawerFull(null);
    setDrawerPackages([]);
    setDrawerLoading(true);
    (async () => {
      try {
        const res = await api.get(`/work-orders/${order.id}`);
        if (res.success) setDrawerFull(res.data);
      } catch {}
      try {
        const partsRes = await api.get(`/parts?work_order_id=${order.id}`);
        if (partsRes.success) setDrawerPackages(partsRes.data || []);
      } catch {}
      setDrawerLoading(false);
    })();
  };
  const closeDrawer = () => { setDrawer(null); setDrawerFull(null); setDrawerPackages([]); };
  const copyToken = (val) => { navigator.clipboard?.writeText(val); setCopiedToken(val); setTimeout(() => setCopiedToken(null), 1500); };



  const handleAssign = async () => {
    if (selectedWorkOrders.size === 0 || !selectedMechanic) return;
    const ids = [...selectedWorkOrders];
    setAssigning('batch');
    setError('');
    let successCount = 0;
    let lastError = '';
    for (const workOrderId of ids) {
      try {
        const res = await api.post('/job-assignment/assign', { work_order_id: workOrderId, mechanic_id: selectedMechanic });
        if (res.success) successCount++;
        else lastError = res.message || t('job-assignment.error.assignment_failed');
      } catch { lastError = t('job-assignment.error.assign_failed'); }
    }
    if (successCount > 0) { setSelectedWorkOrders(new Set()); setSelectedMechanic(''); fetchBoard(); }
    if (lastError && successCount < ids.length) setError(lastError);
    setAssigning(null);
  };

  const handleReassign = async (workOrderId) => {
    if (!reassignMechanic) return;
    setAssigning(workOrderId);
    try {
      const res = await api.post('/job-assignment/assign', { work_order_id: workOrderId, mechanic_id: reassignMechanic });
      if (res.success) { setReassigningOrder(null); setReassignMechanic(''); fetchBoard(); }
      else { setError(res.message || t('job-assignment.error.reassign_failed')); }
    } catch { setError(t('job-assignment.error.reassign_failed')); }
    finally { setAssigning(null); }
  };

  const handleUnassign = async (workOrderId) => {
    if (!window.confirm(t('job-assignment.confirm_unassign'))) return;
    try { await api.post('/job-assignment/unassign', { work_order_id: workOrderId }); fetchBoard(); }
    catch { /* ignore */ }
  };

  /* ── Auto-assign single order ── */
  const handleAutoAssign = async (workOrderId) => {
    setAutoAssigning(workOrderId);
    setAutoAssignResult(null);
    try {
      const res = await api.post('/job-assignment/auto-assign', { work_order_id: workOrderId });
      if (res.success) {
        setAutoAssignResult({ workOrderId, success: true, message: t('job-assignment.auto_assign_success', { mechanic: res.data?.mechanic_name || '' }) });
        fetchBoard();
      } else {
        setAutoAssignResult({ workOrderId, success: false, message: res.message || t('job-assignment.auto_assign_failed') });
      }
    } catch {
      setAutoAssignResult({ workOrderId, success: false, message: t('job-assignment.auto_assign_failed') });
    }
    setAutoAssigning(null);
    setTimeout(() => setAutoAssignResult(null), 4000);
  };

  /* ── Auto-assign all unassigned orders ── */
  const handleAutoAssignAll = async () => {
    const count = board.unassigned?.length || 0;
    if (!count) return;
    if (!window.confirm(t('job-assignment.auto_assign_all_confirm', { count }))) return;
    setAutoAssignAll(true);
    setAutoAssignResult(null);
    try {
      const res = await api.post('/job-assignment/auto-assign-all');
      if (res.success) {
        const skipped = res.skipped_count || 0;
        const msg = skipped > 0
          ? t('job-assignment.auto_assign_all_partial', { count: res.assigned || 0, skipped })
          : t('job-assignment.auto_assign_all_success', { count: res.assigned || 0 });
        setAutoAssignResult({ workOrderId: 'all', success: true, message: msg, skipped: res.skipped });
        fetchBoard();
      } else {
        setAutoAssignResult({ workOrderId: 'all', success: false, message: res.message || t('job-assignment.auto_assign_failed') });
      }
    } catch {
      setAutoAssignResult({ workOrderId: 'all', success: false, message: t('job-assignment.auto_assign_failed') });
    }
    setAutoAssignAll(false);
    setTimeout(() => setAutoAssignResult(null), 6000);
  };

  /* ── Auto-assign config: load + save ── */
  const loadAutoAssignConfig = useCallback(async () => {
    try {
      const res = await api.get('/settings');
      const s = res?.data?.settings || {};
      setAutoAssignCfg({
        max_orders_per_mechanic: Number.isFinite(Number(s.max_orders_per_mechanic)) ? Number(s.max_orders_per_mechanic) : 5,
        min_mechanic_rating: Number.isFinite(Number(s.min_mechanic_rating)) ? Number(s.min_mechanic_rating) : 0,
        max_assign_distance_km: Number.isFinite(Number(s.max_assign_distance_km)) ? Number(s.max_assign_distance_km) : 0,
        enforce_vehicle_capacity: s.enforce_vehicle_capacity === false ? false : true,
      });
      setAutoAssignCfgLoaded(true);
    } catch { /* ignore */ }
  }, []);

  const saveAutoAssignConfig = async () => {
    setAutoAssignCfgSaving(true);
    setAutoAssignCfgSaved(false);
    try {
      await api.put('/settings', {
        settings: {
          max_orders_per_mechanic: Math.max(1, parseInt(autoAssignCfg.max_orders_per_mechanic, 10) || 5),
          min_mechanic_rating: Math.max(0, Math.min(5, parseFloat(autoAssignCfg.min_mechanic_rating) || 0)),
          max_assign_distance_km: Math.max(0, parseFloat(autoAssignCfg.max_assign_distance_km) || 0),
          enforce_vehicle_capacity: !!autoAssignCfg.enforce_vehicle_capacity,
        },
      });
      setAutoAssignCfgSaved(true);
      setTimeout(() => setAutoAssignCfgSaved(false), 2500);
    } catch { /* ignore */ }
    setAutoAssignCfgSaving(false);
  };

  /* ── Drag-and-drop assign ── */
  const handleDragAssign = async (workOrderId, mechanicId) => {
    if (!workOrderId || !mechanicId) return;
    setAssigning(workOrderId);
    setError('');
    try {
      const res = await api.post('/job-assignment/assign', { work_order_id: workOrderId, mechanic_id: mechanicId });
      if (res.success) { fetchBoard(); }
      else { setError(res.message || t('job-assignment.error.assignment_failed')); }
    } catch { setError(t('job-assignment.error.assign_failed')); }
    finally { setAssigning(null); setDraggingOrder(null); setDragOverMechanic(null); }
  };

  /* ── Filter logic ── */
  const hasActiveFilters = filterStatus || filterZone || filterPayment || filterDate || sortBy || searchQuery.trim();
  const activeFilterCount = [filterStatus, filterZone, filterPayment, filterDate, sortBy].filter(Boolean).length;

  const clearAllFilters = () => {
    setFilterStatus(''); setFilterZone(''); setFilterPayment('');
    setFilterDate(''); setFilterDateFrom(''); setFilterDateTo('');
    setSortBy(''); setSortDir('asc');
    setSearchQuery('');
  };

  // Compute unique service_bays from board data for the bay dropdown
  const availableServiceBays = [...new Set(
    [...(board.unassigned || []), ...(board.active_deliveries || [])]
      .map(o => o.zone_name).filter(Boolean)
  )].sort();

  const filterWorkOrders = (orders) => {
    let out = orders;

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter(o =>
        String(o.work_order_number || o.id).toLowerCase().includes(q) ||
        (o.recipient_name || '').toLowerCase().includes(q) ||
        (o.sender_name || '').toLowerCase().includes(q) ||
        (o.recipient_phone || '').toLowerCase().includes(q) ||
        (o.recipient_area || '').toLowerCase().includes(q) ||
        (o.barcode || '').toLowerCase().includes(q) ||
        (o.service_status_token || '').toLowerCase().includes(q) ||
        (o.stops || []).some(s => (s.contact_name || '').toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q))
      );
    }

    // Status filter
    if (filterStatus) {
      out = out.filter(o => o.status === filterStatus);
    }

    // ServiceBay filter
    if (filterZone) {
      out = out.filter(o => o.zone_name === filterZone);
    }

    // Payment method filter
    if (filterPayment) {
      out = out.filter(o => o.payment_method === filterPayment);
    }

    // Date filter
    if (filterDate) {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (filterDate === 'today') {
        out = out.filter(o => o.created_at && new Date(o.created_at) >= startOfDay);
      } else if (filterDate === 'week') {
        const weekAgo = new Date(startOfDay); weekAgo.setDate(weekAgo.getDate() - 7);
        out = out.filter(o => o.created_at && new Date(o.created_at) >= weekAgo);
      } else if (filterDate === 'custom' && (filterDateFrom || filterDateTo)) {
        out = out.filter(o => {
          if (!o.created_at) return false;
          const d = new Date(o.created_at);
          if (filterDateFrom && d < new Date(filterDateFrom)) return false;
          if (filterDateTo && d > new Date(filterDateTo + 'T23:59:59')) return false;
          return true;
        });
      }
    }

    // Sort
    if (sortBy) {
      const dir = sortDir === 'desc' ? -1 : 1;
      out = [...out].sort((a, b) => {
        if (sortBy === 'date') {
          return dir * (new Date(a.created_at || 0) - new Date(b.created_at || 0));
        } else if (sortBy === 'cod') {
          return dir * ((parseFloat(a.cash_amount) || 0) - (parseFloat(b.cash_amount) || 0));
        } else if (sortBy === 'bay') {
          return dir * (a.zone_name || '').localeCompare(b.zone_name || '');
        } else if (sortBy === 'status') {
          return dir * (a.status || '').localeCompare(b.status || '');
        } else if (sortBy === 'recipient') {
          return dir * (a.recipient_name || '').localeCompare(b.recipient_name || '');
        }
        return 0;
      });
    }

    return out;
  };

  /* ── Package barcode scan → auto-select order ── */
  const handlePackageScan = async (barcode) => {
    if (!barcode) return;
    try {
      const res = await api.get(`/packages/scan/${encodeURIComponent(barcode)}`);
      if (res.success && res.data?.work_order_id) {
        const workOrderId = res.data.work_order_id;
        // Auto-select the parent order for assignment
        setSelectedWorkOrders(new Set([workOrderId]));
        setSearchQuery(String(res.data.work_order_number || workOrderId));
      }
    } catch { /* not a package barcode — leave search as-is */ }
  };

  const filteredUnassigned = filterWorkOrders(board.unassigned || []);
  const filteredActive = filterWorkOrders(board.active_deliveries || []);

  /* ── Map sidebar filter by local search ── */
  const mapSidebarFilter = useCallback((list) => {
    if (!mapSidebarSearch.trim()) return list;
    const q = mapSidebarSearch.trim().toLowerCase();
    return list.filter(o =>
      String(o.work_order_number || o.id).toLowerCase().includes(q) ||
      (o.recipient_name || '').toLowerCase().includes(q) ||
      (o.recipient_address || '').toLowerCase().includes(q) ||
      (o.zone_name || '').toLowerCase().includes(q) ||
      (o.stops || []).some(s => (s.contact_name || '').toLowerCase().includes(q))
    );
  }, [mapSidebarSearch]);

  const mapFilteredUnassigned = mapSidebarFilter(filteredUnassigned);
  const mapFilteredActive = mapSidebarFilter(filteredActive);
  const mapFilteredMechanics = mapSidebarSearch.trim()
    ? (board.available_mechanics || []).filter(d => {
        const q = mapSidebarSearch.trim().toLowerCase();
        return (d.full_name || '').toLowerCase().includes(q) ||
          (d.vehicle_plate || '').toLowerCase().includes(q) ||
          (d.zone_name || '').toLowerCase().includes(q);
      })
    : (board.available_mechanics || []);

  /* ── Map marker click → highlight sidebar card ── */
  const handleMapMarkerClick = useCallback((marker) => {
    if (marker.id) {
      setHighlightedCard(marker.id);
      // Determine category and extract order ID from marker IDs like:
      // "unassigned-stop-123-0", "unassigned-sender-123", "unassigned-123",
      // "active-stop-456-1", "active-456", "mechanic-789"
      let category = '';
      let cardId = '';
      const m = marker.id.match(/^(unassigned|active|mechanic)(?:-(?:stop|sender)-(\d+)|-(\d+))/);
      if (m) {
        category = m[1];
        const workOrderId = m[2] || m[3];
        cardId = `map-card-${category}-${workOrderId}`;
      } else {
        cardId = `map-card-${marker.id}`;
      }
      // auto-switch to correct tab
      if (marker.id.startsWith('unassigned-')) setMapSidebarTab('unassigned');
      else if (marker.id.startsWith('active-')) setMapSidebarTab('active');
      else if (marker.id.startsWith('mechanic-')) setMapSidebarTab('mechanics');
      // scroll sidebar to card
      setTimeout(() => {
        const el = document.getElementById(cardId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, []);

  /* ── Sidebar card click → fly to marker on map ── */
  const handleSidebarCardClick = useCallback((order, prefix) => {
    const stops = order.stops || [];
    if (stops.length > 0 && stops[0].lat && stops[0].lng) {
      // Fly to first stop (or could fitBounds for all stops)
      setFlyTarget({ lat: stops[0].lat, lng: stops[0].lng });
      setHighlightedCard(`${prefix}-stop-${order.id}-0`);
    } else if (order.recipient_lat && order.recipient_lng) {
      setFlyTarget({ lat: order.recipient_lat, lng: order.recipient_lng });
      setHighlightedCard(`${prefix}-${order.id}`);
    }
  }, []);

  const handleMechanicCardClick = useCallback((mechanic) => {
    if (mechanic.last_lat && mechanic.last_lng) {
      setFlyTarget({ lat: mechanic.last_lat, lng: mechanic.last_lng });
      setHighlightedCard(`mechanic-${mechanic.id}`);
    }
  }, []);

  /* ── Popup styles ── */
  const popupStyles = {
    card: { minWidth: 240, fontFamily: 'Inter, system-ui, sans-serif', fontSize: '0.82rem', lineHeight: 1.5 },
    header: (bg, color) => ({
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 12px', borderRadius: '8px 8px 0 0',
      background: bg, color, fontWeight: 700, fontSize: '0.85rem',
    }),
    body: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
    row: { display: 'flex', alignItems: 'center', gap: 6, color: '#374151' },
    icon: { width: 14, height: 14, flexShrink: 0, opacity: 0.6 },
    label: { fontSize: '0.72rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' },
    value: { fontWeight: 500 },
    badge: (bg, color) => ({
      display: 'inline-flex', padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 700, background: bg, color, textTransform: 'capitalize',
    }),
    divider: { borderTop: '1px solid #f3f4f6', margin: '2px 0' },
    mechanicTag: {
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
      background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0',
    },
    codTag: {
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
      background: '#fef3c7', borderRadius: 6, fontWeight: 700, color: '#92400e', fontSize: '0.78rem',
    },
  };

  const statusBadgeInfo = (status) => {
    const map = {
      pending:    { bg: '#fef3c7', color: '#d97706', label: t('job-assignment.status.pending') },
      confirmed:  { bg: '#dbeafe', color: '#1d4ed8', label: t('job-assignment.status.confirmed') },
      assigned:   { bg: '#ede9fe', color: '#7c3aed', label: t('job-assignment.status.assigned') },
      accepted:   { bg: '#e0e7ff', color: '#1565C0', label: t('job-assignment.status.accepted', 'Accepted') },
      picked_up:  { bg: '#fce7f3', color: '#be185d', label: t('job-assignment.status.picked_up') },
      in_transit: { bg: '#e0f2fe', color: '#0369a1', label: t('job-assignment.status.in_transit') },
      delivered:  { bg: '#dcfce7', color: '#16a34a', label: t('job-assignment.status.delivered') },
    };
    return map[status] || map.pending;
  };

  /* ── WorkOrder Popup (rich JSX) ── */
  const OrderPopup = ({ o, variant, isPickup, stopPkgs, stopName }) => {
    const si = statusBadgeInfo(o.status);
    const headerBg = isPickup ? 'linear-gradient(135deg, #1e3a6b, #14284d)'
      : variant === 'unassigned' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #3b82f6, #2563eb)';
    const displayName = isPickup ? (o.sender_name || o.customer_name || '—') : (stopName || o.recipient_name || '—');
    const displayPhone = isPickup ? o.sender_phone : o.recipient_phone;
    const displayAddr = isPickup ? o.sender_address : o.recipient_address;
    return (
      <div style={popupStyles.card}>
        <div style={{ ...popupStyles.header('#fff', '#fff'), background: headerBg }}>
          <span>{isPickup ? 'Pickup' : t('job-assignment.order_label')} #{o.work_order_number || o.id}</span>
          <span style={popupStyles.badge(si.bg, si.color)}>{si.label}</span>
        </div>
        <div style={popupStyles.body}>
          {/* Recipient / Sender */}
          <div>
            <div style={popupStyles.label}>{isPickup ? t('job-assignment.popup.sender', 'Sender') : t('job-assignment.popup.recipient')}</div>
            <div style={{ ...popupStyles.row, fontWeight: 600, fontSize: '0.88rem' }}>
              <User width={13} height={13} /> {displayName}
            </div>
            {displayPhone && (
              <div style={{ ...popupStyles.row, gap: 6 }}>
                <Phone width={13} height={13} /> <span style={popupStyles.value}>{displayPhone}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); _openWA(displayPhone, _buildWAMsg(o, isPickup, cur), dialCode); }}
                  title="Share via WhatsApp"
                  style={{
                    padding: '2px 7px', borderRadius: 6, border: '1px solid #25D366',
                    background: '#f0fdf4', color: '#25D366', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    fontSize: '0.7rem', fontWeight: 700, marginLeft: 4,
                  }}
                  onMouseOver={e => { e.currentTarget.style.background = '#25D366'; e.currentTarget.style.color = '#fff'; }}
                  onMouseOut={e => { e.currentTarget.style.background = '#f0fdf4'; e.currentTarget.style.color = '#25D366'; }}
                >
                  <WhatsAppIconSvg size={11} color="currentColor" />
                </button>
              </div>
            )}
          </div>

          <div style={popupStyles.divider} />

          {/* Address */}
          <div>
            <div style={popupStyles.label}>{isPickup ? t('job-assignment.popup.pickup_address', 'Pickup Address') : t('job-assignment.popup.delivery_address')}</div>
            <div style={popupStyles.row}>
              <MapPin width={13} height={13} /> <span style={popupStyles.value}>{displayAddr || '—'}</span>
            </div>
            {!isPickup && (o.recipient_area || o.recipient_emirate) && (
              <div style={{ ...popupStyles.row, fontSize: '0.78rem', color: '#6b7280' }}>
                <Building width={13} height={13} /> {[o.recipient_area, o.recipient_emirate].filter(Boolean).join(', ')}
              </div>
            )}
            {o.zone_name && (
              <div style={{ ...popupStyles.row, fontSize: '0.78rem', color: '#6b7280' }}>
                <MapIcon width={13} height={13} /> {t('job-assignment.popup.bay')} {o.zone_name}
              </div>
            )}
          </div>

          {/* Stop packages summary */}
          {stopPkgs && stopPkgs.length > 0 && (
            <>
              <div style={popupStyles.divider} />
              <div>
                <div style={popupStyles.label}>{t('job-assignment.popup.packages', 'Packages')} ({stopPkgs.length})</div>
                {stopPkgs.slice(0, 3).map((p, i) => (
                  <div key={i} style={{ ...popupStyles.row, fontSize: '0.76rem', color: '#475569' }}>
                    <Package width={11} height={11} /> {p.recipient_name || '—'} {p.cash_amount > 0 ? `· COD ${parseFloat(p.cash_amount).toFixed(0)}` : ''}
                  </div>
                ))}
                {stopPkgs.length > 3 && <div style={{ fontSize: '0.72rem', color: '#94a3b8', paddingLeft: 18 }}>+{stopPkgs.length - 3} more</div>}
              </div>
            </>
          )}

          {/* Mechanic (if assigned) */}
          {o.mechanic_name && (
            <>
              <div style={popupStyles.divider} />
              <div>
                <div style={popupStyles.label}>{t('job-assignment.popup.mechanic')}</div>
                <div style={popupStyles.mechanicTag}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.7rem' }}>
                    {o.mechanic_name.charAt(0)}
                  </span>
                  <span style={{ fontWeight: 600 }}>{o.mechanic_name}</span>
                </div>
              </div>
            </>
          )}

          {/* Payment / COD */}
          {(o.payment_method || o.cash_amount > 0) && (
            <>
              <div style={popupStyles.divider} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {o.payment_method && (
                  <span style={popupStyles.badge('#f3f4f6', '#374151')}>
                    {o.payment_method === 'cod' ? <><Wallet width={12} height={12} /> {t('job-assignment.popup.cod')}</> : o.payment_method === 'prepaid' ? <><CreditCard width={12} height={12} /> {t('job-assignment.popup.prepaid')}</> : o.payment_method}
                  </span>
                )}
                {o.cash_amount > 0 && (
                  <span style={popupStyles.codTag}>{cur} {parseFloat(o.cash_amount).toFixed(0)}</span>
                )}
                {o.service_fee > 0 && (
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{t('job-assignment.popup.fee')} {cur} {parseFloat(o.service_fee).toFixed(0)}</span>
                )}
              </div>
            </>
          )}

          {/* Description / Instructions */}
          {(o.description || o.special_instructions) && (
            <>
              <div style={popupStyles.divider} />
              <div style={{ fontSize: '0.76rem', color: '#6b7280', fontStyle: 'italic', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Notes width={12} height={12} /> {o.special_instructions || o.description}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  /* ── Mechanic Popup (rich JSX) ── */
  const MechanicPopup = ({ d }) => (
    <div style={popupStyles.card}>
      <div style={{ ...popupStyles.header('#fff', '#fff'), background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem' }}>
            {d.full_name?.charAt(0)}
          </span>
          <span>{d.full_name}</span>
        </div>
        <span style={popupStyles.badge('#dcfce7', '#16a34a')}>{t('job-assignment.status.available')}</span>
      </div>
      <div style={popupStyles.body}>
        <div>
          <div style={popupStyles.label}>{t('job-assignment.popup.vehicle')}</div>
          <div style={popupStyles.row}>
            <DeliveryTruck width={13} height={13} />
            <span style={{ ...popupStyles.value, textTransform: 'capitalize' }}>{d.vehicle_type || '—'}</span>
            <span style={{ color: '#9ca3af' }}>•</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{d.vehicle_plate || '—'}</span>
          </div>
        </div>
        {d.phone && (
          <>
            <div style={popupStyles.divider} />
            <div style={popupStyles.row}>
              <Phone width={13} height={13} /> <span style={popupStyles.value}>{d.phone}</span>
            </div>
          </>
        )}
        {d.zone_name && (
          <>
            <div style={popupStyles.divider} />
            <div style={popupStyles.row}>
              <MapIcon width={13} height={13} /> <span style={popupStyles.value}>{t('job-assignment.popup.bay')} {d.zone_name}</span>
            </div>
          </>
        )}
        {d.active_orders > 0 && (
          <>
            <div style={popupStyles.divider} />
            <div style={popupStyles.row}>
              <Package width={13} height={13} /> <span style={popupStyles.value}>{t('job-assignment.popup.active_orders', { count: d.active_orders })}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );

  /* ── Export CSV ── */
  const handleExportCSV = useCallback(() => {
    const allWorkOrders = [
      ...(board.unassigned || []).map(o => ({ ...o, _section: 'Unassigned' })),
      ...(board.active_deliveries || []).map(o => ({ ...o, _section: 'In Progress' })),
      ...(board.completed_today || []).map(o => ({ ...o, _section: 'Completed' })),
    ];
    if (!allWorkOrders.length) return;
    // SR-15 — quoted correctly but did not neutralise spreadsheet
    // formulas; csvCell does both.
    const esc = csvCell;
    const headers = ['Section','WorkOrder #','Status','Recipient','Phone','Address','ServiceBay','Mechanic','Payment','COD','Fee','Packages','Created','Updated'];
    const rows = allWorkOrders.map(o => [
      o._section,
      o.work_order_number || o.id,
      o.status,
      o.recipient_name || '',
      o.recipient_phone || '',
      [o.recipient_address, o.recipient_area, o.recipient_emirate].filter(Boolean).join(', '),
      o.zone_name || '',
      o.mechanic_name || '',
      o.payment_method || '',
      o.cash_amount || 0,
      o.service_fee || 0,
      `${o.delivered_packages || 0}/${o.total_packages || 0}`,
      o.created_at ? new Date(o.created_at).toLocaleString() : '',
      o.updated_at ? new Date(o.updated_at).toLocaleString() : '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-assignment-report-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [board]);

  /* ── Print job-assignment board ── */
  const handlePrint = useCallback(() => {
    const allWorkOrders = [
      ...(board.unassigned || []).map(o => ({ ...o, _section: 'Unassigned' })),
      ...(board.active_deliveries || []).map(o => ({ ...o, _section: 'In Progress' })),
      ...(board.completed_today || []).map(o => ({ ...o, _section: 'Completed' })),
    ];
    const statusColor = { pending: '#f59e0b', confirmed: '#f59e0b', assigned: '#3b82f6', accepted: '#3b82f6', picked_up: '#8b5cf6', in_transit: '#8b5cf6', delivered: '#16a34a', completed: '#16a34a', cancelled: '#9333ea', returned: '#f59e0b' };
    const grouped = {};
    allWorkOrders.forEach(o => {
      if (!grouped[o._section]) grouped[o._section] = [];
      grouped[o._section].push(o);
    });
    const now = new Date();
    let html = `<!DOCTYPE html><html><head><title>JobAssignment Report</title><style>
      body{font-family:Inter,system-ui,sans-serif;margin:20px;color:#1e293b;font-size:12px}
      h1{font-size:18px;margin:0 0 4px}
      .meta{color:#64748b;font-size:11px;margin-bottom:16px}
      h2{font-size:14px;margin:16px 0 8px;padding:6px 10px;background:#f1f5f9;border-radius:6px}
      table{width:100%;border-collapse:collapse;margin-bottom:12px}
      th{text-align:left;padding:6px 8px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:0.05em}
      td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px}
      tr:hover{background:#fafbfc}
      .badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700}
      @media print{body{margin:10px}h2{break-before:auto}}
    </style></head><body>`;
    html += `<h1>JobAssignment Report</h1>`;
    html += `<div class="meta">${now.toLocaleDateString('en-AE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — ${now.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}</div>`;
    for (const [section, orders] of Object.entries(grouped)) {
      html += `<h2>${escapeHtml(section)} (${orders.length})</h2>`;
      html += `<table><thead><tr><th>WorkOrder #</th><th>Status</th><th>Recipient</th><th>Address</th><th>ServiceBay</th><th>Mechanic</th><th>Payment</th><th>COD</th></tr></thead><tbody>`;
      orders.forEach(o => {
        const sc = statusColor[o.status] || '#64748b';
        html += `<tr>
          <td><strong>${escapeHtml(o.work_order_number || o.id)}</strong></td>
          <td><span class="badge" style="background:${sc}18;color:${sc}">${escapeHtml(o.status)}</span></td>
          <td>${escapeHtml(o.recipient_name) || '—'}</td>
          <td>${escapeHtml([o.recipient_area, o.recipient_emirate].filter(Boolean).join(', ') || o.recipient_address) || '—'}</td>
          <td>${escapeHtml(o.zone_name) || '—'}</td>
          <td>${escapeHtml(o.mechanic_name) || '—'}</td>
          <td>${escapeHtml(o.payment_method) || '—'}</td>
          <td>${o.cash_amount ? parseFloat(o.cash_amount).toFixed(2) : '—'}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
    }
    html += `</body></html>`;
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }, [board]);

  /* ── Build map data ── */
  const buildMapMarkers = () => {
    const markers = [];
    const addOrderMarkers = (o, variant) => {
      const type = variant === 'unassigned' ? 'delivery' : 'order';
      const stops = o.stops || [];
      const pkgs = o.packages || [];

      /* — Sender / pickup location — */
      if (o.sender_lat && o.sender_lng) {
        markers.push({
          lat: parseFloat(o.sender_lat), lng: parseFloat(o.sender_lng),
          type: 'pickup', label: `P #${o.id}`,
          popup: <OrderPopup o={o} variant={variant} isPickup />,
          id: `${variant}-sender-${o.id}`,
        });
      }

      /* — Use order_stops as the primary source for delivery markers — */
      if (stops.length > 0) {
        stops.forEach((stop, idx) => {
          const sLat = parseFloat(stop.lat);
          const sLng = parseFloat(stop.lng);
          if (!sLat || !sLng) return;
          // Find packages linked to this stop
          const stopPkgs = stop.package_id
            ? pkgs.filter(p => p.id === stop.package_id)
            : pkgs.filter(p => (p.recipient_name || '').trim() === (stop.contact_name || '').trim());
          markers.push({
            lat: sLat, lng: sLng,
            type, label: `#${o.id}${stops.length > 1 ? `-${idx + 1}` : ''}`,
            popup: <OrderPopup o={o} variant={variant} stopPkgs={stopPkgs} stopName={stop.contact_name} />,
            id: `${variant}-stop-${o.id}-${idx}`,
          });
        });
      } else if (pkgs.length > 0) {
        /* — Fallback: derive stops from packages — */
        const stopMap = {};
        pkgs.forEach(p => {
          const rName  = (p.recipient_name  || '').trim();
          const rPhone = (p.recipient_phone || '').trim();
          const rAddr  = (p.address         || '').trim();
          const key = `${rName}|${rPhone}|${rAddr}`;
          if (!stopMap[key]) {
            stopMap[key] = {
              lat:  parseFloat(p.lat) || null,
              lng:  parseFloat(p.lng) || null,
              name: rName || o.recipient_name,
              pkgs: [],
            };
          }
          if (p.lat && p.lng) {
            stopMap[key].lat = parseFloat(p.lat);
            stopMap[key].lng = parseFloat(p.lng);
          }
          stopMap[key].pkgs.push(p);
        });
        Object.values(stopMap).forEach((stop, idx, arr) => {
          if (!stop.lat || !stop.lng) return;
          markers.push({
            lat: stop.lat, lng: stop.lng,
            type, label: `#${o.id}${arr.length > 1 ? `-${idx + 1}` : ''}`,
            popup: <OrderPopup o={o} variant={variant} stopPkgs={stop.pkgs} stopName={stop.name} />,
            id: `${variant}-stop-${o.id}-${idx}`,
          });
        });
      } else if (o.recipient_lat && o.recipient_lng) {
        /* — Fallback: single delivery point from the order itself — */
        markers.push({
          lat: parseFloat(o.recipient_lat), lng: parseFloat(o.recipient_lng),
          type, label: `#${o.id}`,
          popup: <OrderPopup o={o} variant={variant} />,
          id: `${variant}-${o.id}`,
        });
      }
    };

    (board.unassigned || []).forEach(o => addOrderMarkers(o, 'unassigned'));
    (board.active_deliveries || []).forEach(o => addOrderMarkers(o, 'active'));
    (board.available_mechanics || []).forEach(d => {
      if (d.last_lat && d.last_lng) {
        markers.push({
          lat: parseFloat(d.last_lat), lng: parseFloat(d.last_lng),
          type: 'mechanic', label: d.full_name?.split(' ')[0],
          popup: <MechanicPopup d={d} />,
          id: `mechanic-${d.id}`,
        });
      }
    });
    return markers;
  };

  /* ── Build route polylines from active orders ── */
  const ROUTE_COLORS = ['#6366f1','#0ea5e9','#f59e0b','#22c55e','#ef4444','#3bb4e8','#8b5cf6','#14b8a6'];
  const buildRoutePolylines = () => {
    if (view !== 'map') return [];
    const lines = [];
    const mechanicColorMap = {};
    let colorIdx = 0;
    (board.active_deliveries || []).forEach(o => {
      let poly = o.route_polyline;
      if (!poly) return;
      if (typeof poly === 'string') { try { poly = JSON.parse(poly); } catch { return; } }
      if (!Array.isArray(poly) || poly.length < 2) return;
      // Assign consistent color per mechanic
      const dId = o.mechanic_id || 'unknown';
      if (!mechanicColorMap[dId]) {
        mechanicColorMap[dId] = ROUTE_COLORS[colorIdx % ROUTE_COLORS.length];
        colorIdx++;
      }
      lines.push({
        positions: poly,
        color: mechanicColorMap[dId],
        weight: 4,
        opacity: 0.75,
        popup: `#${o.work_order_number || o.id} — ${o.mechanic_name || 'Mechanic'}`,
      });
    });
    return lines;
  };

  /* ── WorkOrder Card (used in board & sidebar) ── */
  const OrderCard = ({ order, showUnassign, mini }) => {
    const sc = STATUS_STYLE[order.status] || STATUS_STYLE.pending;
    const isSelected = selectedWorkOrders.has(order.id);
    const pkgs = order.packages || [];
    const stops = order.stops || [];
    const [expanded, setExpanded] = useState(false);

    const paymentLabel = {
      cod: t('job-assignment.payment.cod'),
      prepaid: t('job-assignment.payment.prepaid'),
      credit: t('job-assignment.payment.credit'),
      wallet: t('job-assignment.payment.wallet'),
    }[order.payment_method] || order.payment_method;

    /* ── Mini card (sidebar map view) ── */
    if (mini) return (
      <div className="job-assignment-mini-card">
        <div className="job-assignment-card-header">
          <div>
            <div className="job-assignment-order-id">#{order.work_order_number || order.id}</div>
            <div className="job-assignment-recipient">
              {stops.length > 1
                ? stops.map(s => s.contact_name).filter(Boolean).join(' → ')
                : order.recipient_name}
            </div>
            {(order.route_duration_min > 0 || order.mechanic_eta_min > 0) && (
              <div style={{ display:'flex', gap:6, marginTop:2, fontSize:10, color:'#64748b' }}>
                {order.mechanic_eta_min > 0 && <span style={{ color:'#2563eb' }}><DeliveryTruck width={9} height={9} /> ~{Math.ceil(order.mechanic_eta_min)}m</span>}
                {order.route_duration_min > 0 && <span style={{ color:'#16a34a' }}><Clock width={9} height={9} /> ~{Math.ceil(order.route_duration_min)}m</span>}
                {order.route_distance_km > 0 && <span>{parseFloat(order.route_distance_km).toFixed(1)}km</span>}
              </div>
            )}
          </div>
          <span className="status-badge" style={sc}>{t(`job-assignment.status.${order.status}`, order.status)}</span>
        </div>
      </div>
    );

    /* ── Full card ── */
    return (
      <div
        className={`job-assignment-card${!showUnassign && draggingOrder === order.id ? ' dragging' : ''}${reassigningOrder === order.id ? ' reassigning' : ''}`}
        style={{ borderColor: isSelected ? sc.border : undefined }}
        draggable={!showUnassign}
        onDragStart={!showUnassign ? (e) => {
          setDraggingOrder(order.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(order.id));
        } : undefined}
        onDragEnd={!showUnassign ? () => { setDraggingOrder(null); setDragOverMechanic(null); } : undefined}
      >
        {/* Color accent bar */}
        <div className="job-assignment-card-accent" style={{ background: sc.border || sc.color }} />
        <div className="job-assignment-card-inner">

          {/* Header: order # + status + time */}
          <div className="job-assignment-card-header">
            <div style={{ flex:1, minWidth:0 }}>
              <div className="job-assignment-order-id">
                #{order.work_order_number || order.id}
                {order.total_packages > 0 && (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:10, fontWeight:700,
                    padding:'2px 8px', borderRadius:12,
                    background: order.delivered_packages >= order.total_packages ? '#dcfce7'
                      : order.delivered_packages > 0 ? '#fef3c7' : '#f1f5f9',
                    color: order.delivered_packages >= order.total_packages ? '#16a34a'
                      : order.delivered_packages > 0 ? '#d97706' : '#64748b' }}>
                    <Package width={10} height={10} />
                    {order.delivered_packages || 0}/{order.total_packages}
                  </span>
                )}
                {stops.length > 1 && (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:10, fontWeight:700,
                    padding:'2px 8px', borderRadius:12, background:'#dbeafe', color:'#1d4ed8' }}>
                    <MapPin width={10} height={10} />
                    {stops.filter(s => s.status === 'completed').length}/{stops.length} stops
                  </span>
                )}
              </div>
              <div className="job-assignment-recipient">
                {stops.length > 1 ? (
                  <span style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
                    {stops.slice(0, 3).map((s, i) => (
                      <span key={s.id || i} style={{ display:'inline-flex', alignItems:'center', gap:3 }}>
                        <span style={{ width:16, height:16, borderRadius:'50%',
                          background: s.status === 'completed' ? '#16a34a' : s.status === 'arrived' ? '#3b82f6' : (sc.border || '#f97316'),
                          color:'#fff',
                          display:'inline-flex', alignItems:'center', justifyContent:'center',
                          fontSize:8, fontWeight:800, flexShrink:0 }}>{s.sequence_number}</span>
                        <span style={{ maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {s.contact_name || 'Stop'}
                        </span>
                        {i < Math.min(stops.length, 3) - 1 && <span style={{ color:'#cbd5e1' }}>·</span>}
                      </span>
                    ))}
                    {stops.length > 3 && (
                      <span style={{ fontSize:10, color:'#94a3b8', fontWeight:600, background:'#f1f5f9',
                        padding:'1px 6px', borderRadius:8 }}>+{stops.length - 3}</span>
                    )}
                  </span>
                ) : pkgs.length > 1 ? (
                  (() => {
                    // Group packages by unique recipient
                    const rMap = {};
                    pkgs.forEach(p => {
                      const k = `${(p.recipient_name||'').trim().toLowerCase()}|${(p.recipient_phone||'').trim()}`;
                      if (!rMap[k]) rMap[k] = { ...p, cnt: 1 }; else rMap[k].cnt++;
                    });
                    const uniqs = Object.values(rMap);
                    return (
                      <span style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
                        {uniqs.slice(0, 2).map((p, i) => (
                          <span key={i} style={{ display:'inline-flex', alignItems:'center', gap:3 }}>
                            <span style={{ width:16, height:16, borderRadius:'50%', background:sc.border || '#f97316', color:'#fff',
                              display:'inline-flex', alignItems:'center', justifyContent:'center',
                              fontSize:8, fontWeight:800, flexShrink:0 }}>{p.sequence}</span>
                            <span style={{ maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {p.recipient_name || 'Recipient'}{p.cnt > 1 ? ` (${p.cnt})` : ''}
                            </span>
                            {i < Math.min(uniqs.length, 2) - 1 && <span style={{ color:'#cbd5e1' }}>·</span>}
                          </span>
                        ))}
                        {uniqs.length > 2 && (
                          <span style={{ fontSize:10, color:'#94a3b8', fontWeight:600, background:'#f1f5f9',
                            padding:'1px 6px', borderRadius:8 }}>+{uniqs.length - 2}</span>
                        )}
                      </span>
                    );
                  })()
                ) : order.recipient_name}
              </div>
            </div>
            <span className="status-badge" style={{
              ...sc, fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20,
              border:`1px solid ${sc.color}25`, letterSpacing:'0.01em',
            }}>{t(`job-assignment.status.${order.status}`, order.status)}</span>
          </div>

          {/* ── Per-Package Section ── */}
          {pkgs.length > 0 && (
            <div style={{ margin:'0 0 6px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0', overflow:'hidden' }}>
              {/* Package header + expand toggle */}
              <div onClick={() => setExpanded(!expanded)} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'8px 12px', cursor:'pointer', userSelect:'none',
                background: expanded ? 'linear-gradient(135deg,#eef2ff,#e0e7ff)' : 'transparent',
                transition:'background 0.2s',
              }}>
                <span style={{ fontSize:11, fontWeight:700, color:'#475569', display:'flex', alignItems:'center', gap:5 }}>
                  <Package width={13} height={13} color="#6366f1" />
                  {pkgs.length} Package{pkgs.length !== 1 ? 's' : ''}
                </span>
                <span style={{ fontSize:10, color:'#94a3b8', fontWeight:600, display:'flex', alignItems:'center', gap:2 }}>
                  {expanded ? '▲ Collapse' : '▼ Expand'}
                </span>
              </div>
              {/* Mini-summary of packages */}
              {!expanded && (
                <div style={{ padding:'4px 12px 8px', display:'flex', flexWrap:'wrap', gap:4 }}>
                  {pkgs.map((p, i) => {
                    const ps = PKG_STATUS_STYLE[p.status] || PKG_STATUS_STYLE.created;
                    return (
                      <span key={p.id || i} style={{
                        display:'inline-flex', alignItems:'center', gap:3,
                        padding:'2px 8px', borderRadius:8, fontSize:9, fontWeight:700,
                        background: ps.bg, color: ps.color, border:`1px solid ${ps.color}20`,
                      }}>
                        PKG-{p.sequence} · {ps.label}
                      </span>
                    );
                  })}
                </div>
              )}
              {/* Expanded: full package details with barcodes */}
              {expanded && (
                <div style={{ padding:'0 12px 10px', display:'flex', flexDirection:'column', gap:8 }}>
                  {pkgs.map((p, i) => {
                    const ps = PKG_STATUS_STYLE[p.status] || PKG_STATUS_STYLE.created;
                    return (
                      <div key={p.id || i} style={{
                        background:'#fff', borderRadius:10, padding:'10px 12px',
                        border:`1px solid ${ps.color}30`, transition:'box-shadow 0.2s',
                      }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
                          <span style={{ fontWeight:700, fontSize:12, color:'#1e293b', display:'flex', alignItems:'center', gap:5 }}>
                            <Package width={12} height={12} color={ps.color} />
                            Package {p.sequence}
                          </span>
                          <span style={{ fontSize:9, fontWeight:700, padding:'2px 9px', borderRadius:10,
                            background:ps.bg, color:ps.color }}>{ps.label}</span>
                        </div>
                        {p.barcode && <BarcodeDisplay value={p.barcode} small />}
                        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:5, fontSize:10, color:'#64748b' }}>
                          {p.recipient_name && (
                            <span style={{ display:'flex', alignItems:'center', gap:2 }}>
                              <User width={9} height={9} /> {p.recipient_name}
                            </span>
                          )}
                          {p.address && (
                            <span style={{ display:'flex', alignItems:'center', gap:2, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              <MapPin width={9} height={9} /> {p.address}
                            </span>
                          )}
                          {p.cash_amount > 0 && (
                            <span style={{ fontWeight:700, color:'#d97706', background:'#fef3c7', padding:'1px 6px', borderRadius:6 }}>
                              COD: {cur} {parseFloat(p.cash_amount).toFixed(0)}
                            </span>
                          )}
                          {p.weight_kg > 0 && (
                            <span><Weight width={9} height={9} /> {p.weight_kg}kg</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Details rows */}
          <div className="job-assignment-meta">
            {/* Show per-stop addresses when order has multiple stops */}
            {stops.length > 1 ? stops.map((s, si) => (
              <span key={s.id || si} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                  background: s.status === 'completed' ? '#dcfce7' : '#f1f5f9',
                  color: s.status === 'completed' ? '#16a34a' : '#64748b',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 7, fontWeight: 800 }}>{s.sequence_number}</span>
                <MapPin width={11} height={11} color="#94a3b8" />
                {(s.address || '').length > 38 ? s.address.slice(0, 38) + '…' : (s.address || '—')}
                {s.area && <span style={{ color: '#94a3b8', fontSize: '0.8em' }}>({s.area})</span>}
              </span>
            )) : (
              <>
                {order.recipient_address && (
                  <span><MapPin width={13} height={13} color="#94a3b8" />
                    {order.recipient_address.length > 45
                      ? order.recipient_address.slice(0, 45) + '…'
                      : order.recipient_address}
                  </span>
                )}
                {(order.recipient_area || order.recipient_emirate) && (
                  <span>
                    <Building width={12} height={12} color="#94a3b8" /> {[order.recipient_area, order.recipient_emirate].filter(Boolean).join(', ')}
                  </span>
                )}
              </>
            )}
            {order.zone_name && (
              <span style={{ color:'#7c3aed', fontWeight:600 }}>
                <MapPin width={13} height={13} style={{ color:'#7c3aed' }} /> {order.zone_name}
              </span>
            )}
            {order.mechanic_name && (
              <span style={{ color:'#16a34a', fontWeight:600 }}>
                <DeliveryTruck width={13} height={13} style={{ color:'#16a34a' }} /> {order.mechanic_name}
              </span>
            )}
          </div>

          {/* ETA row */}
          {(order.route_duration_min || order.mechanic_eta_min || order.scheduled_at) && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, padding:'0 0 2px', alignItems:'center' }}>
              {order.mechanic_eta_min > 0 && (
                <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:11, fontWeight:600, color:'#2563eb', background:'#eff6ff', padding:'3px 8px', borderRadius:6 }}>
                  <DeliveryTruck width={11} height={11} /> ~{Math.ceil(order.mechanic_eta_min)} {t('job-assignment.min_pickup', 'min to pickup')}
                </span>
              )}
              {order.route_duration_min > 0 && (
                <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:11, fontWeight:600, color:'#16a34a', background:'#f0fdf4', padding:'3px 8px', borderRadius:6 }}>
                  <Clock width={11} height={11} /> ~{Math.ceil(order.route_duration_min)} {t('job-assignment.min_delivery', 'min delivery')}
                </span>
              )}
              {order.route_distance_km > 0 && (
                <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:11, fontWeight:600, color:'#64748b', background:'#f1f5f9', padding:'3px 8px', borderRadius:6 }}>
                  <MapPin width={11} height={11} /> {parseFloat(order.route_distance_km).toFixed(1)} km
                </span>
              )}
              {order.scheduled_at && (
                <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:11, fontWeight:600, color:'#9333ea', background:'#faf5ff', padding:'3px 8px', borderRadius:6 }}>
                  <Calendar width={11} height={11} /> {new Date(order.scheduled_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                </span>
              )}
            </div>
          )}

          {/* Chips: COD / fee / weight / category */}
          <div className="job-assignment-chips">
            {order.payment_method && (
              <span className="job-assignment-chip" style={{
                background: order.payment_method === 'cod' ? '#fef3c7' : '#dbeafe',
                color: order.payment_method === 'cod' ? '#92400e' : '#1d4ed8' }}>
                <CreditCard width={11} height={11} /> {paymentLabel}
              </span>
            )}
            {order.cash_amount > 0 && (
              <span className="job-assignment-chip" style={{ background:'#fef9c3', color:'#713f12' }}>
                <Wallet width={11} height={11} /> {cur} {parseFloat(order.cash_amount).toFixed(0)}
              </span>
            )}
            {order.service_fee > 0 && (
              <span className="job-assignment-chip" style={{ background:'#f0fdf4', color:'#166534' }}>
                {t('job-assignment.fee')}: {cur} {parseFloat(order.service_fee).toFixed(0)}
              </span>
            )}
            {order.weight_kg > 0 && (
              <span className="job-assignment-chip" style={{ background:'#f3f4f6', color:'#374151' }}>
                <Weight width={11} height={11} /> {order.weight_kg} kg
              </span>
            )}
            {order.category && order.category !== 'other' && (
              <span className="job-assignment-chip" style={{ background:'#ede9fe', color:'#5b21b6' }}>
                <Box3dPoint width={11} height={11} />
                {order.category.replace(/_/g,' ')}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="job-assignment-actions">
            <button
              className="btn-sm"
              onClick={(e) => { e.stopPropagation(); openDrawer(order); }}
              title={t('job-assignment.view_details', 'View Details')}
              style={{
                background:'linear-gradient(135deg,#1e3a6b,#1e293b)', color:'#fff',
                border:'none', fontWeight:700, fontSize:12, borderRadius:8,
                padding:'6px 10px', cursor:'pointer',
                display:'flex', alignItems:'center', gap:4, transition:'all .2s',
              }}
            >
              <Eye width={13} height={13} />
            </button>
            {!showUnassign && (
              <>
                <button
                  className={`btn-sm ${isSelected ? 'btn-sm-primary' : 'btn-sm-outline'}`}
                  onClick={() => setSelectedWorkOrders(prev => {
                    const next = new Set(prev);
                    if (next.has(order.id)) next.delete(order.id); else next.add(order.id);
                    return next;
                  })}
                >
                  {isSelected ? <><Check width={14} height={14} /> {t('job-assignment.selected')}</> : t('job-assignment.select')}
                </button>
                <button
                  className="btn-sm"
                  disabled={autoAssigning === order.id}
                  onClick={(e) => { e.stopPropagation(); handleAutoAssign(order.id); }}
                  style={{
                    background: autoAssigning === order.id ? '#e0e7ff' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                    color: autoAssigning === order.id ? '#6366f1' : '#fff',
                    border: 'none', fontWeight: 700, fontSize: 12, borderRadius: 8,
                    padding: '6px 12px', cursor: autoAssigning === order.id ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5, transition: 'all .2s',
                  }}
                >
                  <DeliveryTruck width={13} height={13} />
                  {autoAssigning === order.id ? t('job-assignment.auto_assigning') : t('job-assignment.auto_assign')}
                </button>
              </>
            )}
            {showUnassign && (
              <>
                <button
                  className="btn-sm"
                  onClick={() => { setReassigningOrder(reassigningOrder === order.id ? null : order.id); setReassignMechanic(''); }}
                  style={{
                    background: reassigningOrder === order.id ? '#e0e7ff' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    color: reassigningOrder === order.id ? '#3b82f6' : '#fff',
                    border: 'none', fontWeight: 700, fontSize: 12, borderRadius: 8,
                    padding: '6px 12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5, transition: 'all .2s',
                  }}
                >
                  <DeliveryTruck width={13} height={13} />
                  {t('job-assignment.reassign')}
                </button>
                <button className="btn-sm btn-sm-danger" onClick={() => handleUnassign(order.id)}>
                  <Xmark width={14} height={14} /> {t('job-assignment.unassign')}
                </button>
              </>
            )}
          </div>
          {/* Reassign mechanic picker */}
          {reassigningOrder === order.id && (
            <div style={{
              marginTop: 6, padding: '8px 10px', borderRadius: 10,
              background: '#eff6ff', border: '1px solid #bfdbfe',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#1e40af' }}>
                {t('job-assignment.reassign_to')}
              </span>
              <MechanicDropdown
                mechanics={board.all_mechanics || board.available_mechanics || []}
                value={reassignMechanic}
                onChange={setReassignMechanic}
                placeholder={t('job-assignment.select_mechanic')}
                t={t}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn-sm btn-sm-primary"
                  disabled={!reassignMechanic || assigning === order.id}
                  onClick={() => handleReassign(order.id)}
                  style={{ flex: 1, opacity: !reassignMechanic ? 0.5 : 1 }}
                >
                  <Check width={13} height={13} />
                  {assigning === order.id ? t('job-assignment.reassigning') : t('job-assignment.confirm_reassign')}
                </button>
                <button
                  className="btn-sm btn-sm-outline"
                  onClick={() => { setReassigningOrder(null); setReassignMechanic(''); }}
                >
                  {t('job-assignment.cancel')}
                </button>
              </div>
            </div>
          )}
          {/* Auto-assign result feedback */}
          {autoAssignResult && autoAssignResult.workOrderId === order.id && (
            <div style={{
              padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, marginTop: 4,
              background: autoAssignResult.success ? '#dcfce7' : '#fef2f2',
              color: autoAssignResult.success ? '#166534' : '#991b1b',
              border: `1px solid ${autoAssignResult.success ? '#bbf7d0' : '#fecaca'}`,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              {autoAssignResult.success ? <Check width={12} height={12} /> : <WarningTriangle width={12} height={12} />}
              {autoAssignResult.message}
            </div>
          )}
        </div>
      </div>
    );
  };

  const mapMarkers = view === 'map' ? buildMapMarkers() : [];
  const routePolylines = view === 'map' ? buildRoutePolylines() : [];

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="module-hero">
        <div className="module-hero-left">
          <h2 className="module-hero-title">{t('job-assignment.title')}</h2>
          <p className="module-hero-sub">{t('job-assignment.subtitle')}</p>
        </div>
        <div className="module-hero-actions">
          <button onClick={() => navigate('/work-orders')} style={{
            padding: '8px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff',
            cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#475569',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Package width={14} height={14} /> {t('job-assignment.orders')}
          </button>
          <button onClick={() => navigate('/live-map')} style={{
            padding: '8px 14px', borderRadius: 10, border: '1px solid #bfdbfe', background: '#eff6ff',
            cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#2563eb',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <MapIcon width={14} height={14} /> {t('job-assignment.live_map')}
          </button>
          <button onClick={() => navigate('/service-tracking')} style={{
            padding: '8px 14px', borderRadius: 10, border: '1px solid #bbf7d0', background: '#f0fdf4',
            cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#16a34a',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <MapPin width={14} height={14} /> {t('job-assignment.track')}
          </button>

          <button className="module-btn module-btn-outline" onClick={handleExportCSV} title={t('job-assignment.export_csv', 'Export CSV')}>
            <Download width={16} height={16} />
          </button>
          <button className="module-btn module-btn-outline" onClick={handlePrint} title={t('job-assignment.print', 'Print Report')}>
            <Printer width={16} height={16} />
          </button>
          <button className="module-btn module-btn-outline" onClick={fetchBoard} title="Refresh (R)">
            <Refresh width={16} height={16} /> {t('job-assignment.refresh')}
          </button>
        </div>
      </div>

      {/* ── Stats Strip ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16,
      }}>
        {[
          { label: t('job-assignment.stats_total'), value: (board.unassigned?.length || 0) + (board.active_deliveries?.length || 0), color: '#6366f1', bg: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', icon: <Package width={20} height={20} color="#6366f1" /> },
          { label: t('job-assignment.stats_unassigned'), value: board.unassigned?.length || 0, color: '#f59e0b', bg: 'linear-gradient(135deg, #fffbeb, #fef3c7)', icon: <Clock width={20} height={20} color="#f59e0b" /> },
          { label: t('job-assignment.stats_active'), value: board.active_deliveries?.length || 0, color: '#3b82f6', bg: 'linear-gradient(135deg, #eff6ff, #dbeafe)', icon: <DeliveryTruck width={20} height={20} color="#3b82f6" /> },
          { label: t('job-assignment.stats_mechanics'), value: board.available_mechanics?.length || 0, color: '#22c55e', bg: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', icon: <User width={20} height={20} color="#22c55e" /> },
          { label: t('job-assignment.stats_completed', 'Completed'), value: board.completed_today?.length || 0, color: '#16a34a', bg: 'linear-gradient(135deg, #f0fdf4, #bbf7d0)', icon: <Check width={20} height={20} color="#16a34a" /> },
        ].map(s => (
          <div key={s.label} style={{
            background: s.bg, borderRadius: 14, padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
            border: '1px solid rgba(0,0,0,0.04)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>


      {/* ── Search / Filter Bar ── */}
      <div style={{
        display: 'flex', gap: 10, padding: '14px 16px', marginBottom: 16,
        background: '#fff', borderRadius: '0 0 14px 14px',
        border: '1px solid #e2e8f0', borderTop: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
      }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search width={16} height={16} style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            color: '#94a3b8', pointerEvents: 'none',
          }} />
          <input
            type="text"
            placeholder={t('job-assignment.search_placeholder') + ' (or scan package barcode)'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && searchQuery.trim()) {
                // Try to look up as package barcode
                handlePackageScan(searchQuery.trim());
              }
            }}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '11px 40px 11px 40px', borderRadius: 12,
              border: `2px solid ${searchFocused ? '#3b82f6' : '#e2e8f0'}`, fontSize: 14, fontWeight: 500,
              outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
              background: searchFocused ? '#fff' : '#f8fafc',
              boxShadow: searchFocused ? '0 0 0 3px rgba(59,130,246,0.1)' : 'none',
            }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              background: '#f1f5f9', border: 'none', borderRadius: 6, width: 22, height: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#64748b',
            }}>
              <Xmark width={14} height={14} />
            </button>
          )}
        </div>
        <button onClick={() => setShowScanner('barcode')} style={{
          padding: '11px 18px', borderRadius: 12, border: '2px solid #e2e8f0',
          background: 'linear-gradient(135deg, #f8fafc, #fff)', cursor: 'pointer',
          fontWeight: 700, fontSize: 13, color: '#475569',
          display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.2s',
          whiteSpace: 'nowrap',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#2563eb'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569'; }}
        >
          <ScanBarcode width={18} height={18} /> {t('job-assignment.scan_barcode')}
        </button>
        <button onClick={() => setShowScanner('qr')} style={{
          padding: '11px 16px', borderRadius: 12, border: '2px solid #e2e8f0',
          background: 'linear-gradient(135deg, #f8fafc, #fff)', cursor: 'pointer',
          fontWeight: 700, fontSize: 13, color: '#475569',
          display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.2s',
          whiteSpace: 'nowrap',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#7c3aed'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569'; }}
        >
          <QrCode width={18} height={18} /> {t('job-assignment.scan_qr')}
        </button>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`job-assignment-filter-toggle${showFilters || activeFilterCount > 0 ? ' active' : ''}`}
          title="Toggle filters (F)"
        >
          <FilterIcon width={16} height={16} />
          {t('job-assignment.filters', 'Filters')}
          {activeFilterCount > 0 && <span className="job-assignment-filter-badge">{activeFilterCount}</span>}
        </button>
      </div>

      {/* ── Filter Bar (collapsible) ── */}
      {showFilters && (
        <div className="job-assignment-filter-bar">
          {/* Status */}
          <div className="job-assignment-filter-group">
            <label>{t('job-assignment.filter.status', 'Status')}</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">{t('job-assignment.filter.all', 'All')}</option>
              <option value="pending">{t('job-assignment.status.pending', 'Pending')}</option>
              <option value="confirmed">{t('job-assignment.status.confirmed', 'Confirmed')}</option>
              <option value="assigned">{t('job-assignment.status.assigned', 'Assigned')}</option>
              <option value="accepted">{t('job-assignment.status.accepted', 'Accepted')}</option>
              <option value="picked_up">{t('job-assignment.status.picked_up', 'Picked Up')}</option>
              <option value="in_transit">{t('job-assignment.status.in_transit', 'In Transit')}</option>
            </select>
          </div>

          {/* ServiceBay */}
          <div className="job-assignment-filter-group">
            <label>{t('job-assignment.filter.bay', 'ServiceBay')}</label>
            <select value={filterZone} onChange={e => setFilterZone(e.target.value)}>
              <option value="">{t('job-assignment.filter.all', 'All')}</option>
              {availableServiceBays.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>

          {/* Payment */}
          <div className="job-assignment-filter-group">
            <label>{t('job-assignment.filter.payment', 'Payment')}</label>
            <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
              <option value="">{t('job-assignment.filter.all', 'All')}</option>
              <option value="cod">{t('job-assignment.payment.cod', 'COD')}</option>
              <option value="prepaid">{t('job-assignment.payment.prepaid', 'Prepaid')}</option>
              <option value="credit">{t('job-assignment.payment.credit', 'Credit')}</option>
              <option value="wallet">{t('job-assignment.payment.wallet', 'Wallet')}</option>
            </select>
          </div>

          {/* Date */}
          <div className="job-assignment-filter-group">
            <label>{t('job-assignment.filter.date', 'Date')}</label>
            <select value={filterDate} onChange={e => { setFilterDate(e.target.value); if (e.target.value !== 'custom') { setFilterDateFrom(''); setFilterDateTo(''); } }}>
              <option value="">{t('job-assignment.filter.all', 'All')}</option>
              <option value="today">{t('job-assignment.filter.today', 'Today')}</option>
              <option value="week">{t('job-assignment.filter.this_week', 'This Week')}</option>
              <option value="custom">{t('job-assignment.filter.custom_range', 'Custom Range')}</option>
            </select>
          </div>

          {/* Sort */}
          <div className="job-assignment-filter-group">
            <label>{t('job-assignment.filter.sort_by', 'Sort By')}</label>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="">{t('job-assignment.filter.default', 'Default')}</option>
              <option value="date">{t('job-assignment.filter.sort.date', 'Created Date')}</option>
              <option value="cod">{t('job-assignment.filter.sort.cod', 'COD Amount')}</option>
              <option value="bay">{t('job-assignment.filter.sort.bay', 'ServiceBay')}</option>
              <option value="status">{t('job-assignment.filter.sort.status', 'Status')}</option>
              <option value="recipient">{t('job-assignment.filter.sort.recipient', 'Recipient')}</option>
            </select>
          </div>

          {/* Sort direction */}
          {sortBy && (
            <div className="job-assignment-filter-group">
              <label>{t('job-assignment.filter.direction', 'Direction')}</label>
              <select value={sortDir} onChange={e => setSortDir(e.target.value)}>
                <option value="asc">↑ {t('job-assignment.filter.sort.asc', 'Ascending')}</option>
                <option value="desc">↓ {t('job-assignment.filter.sort.desc', 'Descending')}</option>
              </select>
            </div>
          )}

          {/* Custom date range */}
          {filterDate === 'custom' && (
            <>
              <div className="job-assignment-filter-group">
                <label>{t('job-assignment.filter.from', 'From')}</label>
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
              </div>
              <div className="job-assignment-filter-group">
                <label>{t('job-assignment.filter.to', 'To')}</label>
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
              </div>
            </>
          )}

          {/* Clear all */}
          {activeFilterCount > 0 && (
            <button className="job-assignment-filter-clear" onClick={clearAllFilters}>
              <Xmark width={13} height={13} /> {t('job-assignment.filter.clear_all', 'Clear All')}
            </button>
          )}
        </div>
      )}

      {/* ── Active filter indicator ── */}
      {hasActiveFilters && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', marginBottom: 12,
          background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', borderRadius: 10,
          border: '1px solid #bfdbfe', fontSize: 12, fontWeight: 600, color: '#1d4ed8',
          flexWrap: 'wrap',
        }}>
          <FilterIcon width={14} height={14} />
          {searchQuery.trim() && <span className="job-assignment-active-tag">{t('job-assignment.filter_results')} &ldquo;{searchQuery}&rdquo;</span>}
          {filterStatus && <span className="job-assignment-active-tag">{t('job-assignment.filter.status', 'Status')}: {filterStatus}</span>}
          {filterZone && <span className="job-assignment-active-tag">{t('job-assignment.filter.bay', 'ServiceBay')}: {filterZone}</span>}
          {filterPayment && <span className="job-assignment-active-tag">{t('job-assignment.filter.payment', 'Payment')}: {filterPayment.toUpperCase()}</span>}
          {filterDate && <span className="job-assignment-active-tag">{t('job-assignment.filter.date', 'Date')}: {filterDate === 'custom' ? `${filterDateFrom || '…'} → ${filterDateTo || '…'}` : filterDate}</span>}
          {sortBy && <span className="job-assignment-active-tag">{t('job-assignment.filter.sort_by', 'Sort')}: {sortBy} {sortDir === 'desc' ? '↓' : '↑'}</span>}
          <span style={{ color: '#64748b', fontWeight: 500 }}>
            — {`${filteredUnassigned.length + filteredActive.length} ${t('job-assignment.results_found')}`}
          </span>
          <button onClick={clearAllFilters} style={{
            marginLeft: 'auto', padding: '3px 10px', borderRadius: 6,
            border: '1px solid #93c5fd', background: '#fff', color: '#1d4ed8',
            fontWeight: 700, fontSize: 11, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Xmark width={12} height={12} /> {t('job-assignment.filter.clear_all', 'Clear All')}
          </button>
        </div>
      )}

      {/* Scanner Modal */}
      {showScanner && <ScannerModal
        initialMode={showScanner}
        onScan={(val) => { setSearchQuery(val); setShowScanner(false); }}
        onClose={() => setShowScanner(false)}
        t={t}
      />}

      {/* ═══════════════ WORK ORDERS BOARD ═══════════════ */}
      <>
      {error && (
        <div className="alert-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <WarningTriangle width={16} height={16} /> {error}
          </span>
          <button onClick={() => setError('')} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
            padding: '2px 6px', borderRadius: 4, opacity: 0.7,
          }}>
            <Xmark width={14} height={14} />
          </button>
        </div>
      )}

      {/* ── Assignment Panel (bulk) ── */}
      {selectedWorkOrders.size > 0 && (
        <div className="assign-panel">
          <div className="assign-panel-label">
            <Package width={16} height={16} />
            <strong>{selectedWorkOrders.size}</strong> {selectedWorkOrders.size === 1 ? t('job-assignment.order_selected_suffix') : t('job-assignment.orders_selected', 'orders selected')}
          </div>
          <button className="btn-sm btn-sm-outline" style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => { const ids = (filteredUnassigned || []).map(o => o.id); setSelectedWorkOrders(new Set(ids)); }}>
            {t('job-assignment.select_all', 'Select All')}
          </button>
          <MechanicDropdown
            mechanics={board.all_mechanics || board.available_mechanics || []}
            value={selectedMechanic}
            onChange={setSelectedMechanic}
            placeholder={t('job-assignment.select_mechanic')}
            t={t}
          />
          <button className="module-btn module-btn-primary" onClick={handleAssign}
            disabled={!selectedMechanic || assigning}>
            {assigning ? t('job-assignment.assigning') : `${t('job-assignment.assign_mechanic')} (${selectedWorkOrders.size})`}
          </button>
          <button className="module-btn module-btn-outline"
            onClick={() => { setSelectedWorkOrders(new Set()); setSelectedMechanic(''); }}>
            {t('job-assignment.cancel')}
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading-rows">
          {[1,2,3].map(i => <div key={i} className="skeleton-card" />)}
        </div>
      ) : view === 'board' ? (
        /* ═══════ BOARD VIEW ═══════ */
        <div className="job-assignment-board">
          {/* Unassigned */}
          <div className="job-assignment-col">
            <div className="job-assignment-col-header">
              <div className="col-dot" style={{ background: '#f59e0b' }} />
              <h3>{t('job-assignment.col.unassigned')}</h3>
              <span className="col-count amber">{filteredUnassigned.length}</span>
              {filteredUnassigned.length > 0 && (
                <>
                <button
                  onClick={() => {
                    const allIds = filteredUnassigned.map(o => o.id);
                    const allSelected = allIds.every(id => selectedWorkOrders.has(id));
                    setSelectedWorkOrders(allSelected ? new Set() : new Set(allIds));
                  }}
                  style={{
                    marginLeft: 'auto', padding: '4px 10px', borderRadius: 8,
                    border: '1.5px solid #cbd5e1', background: '#fff',
                    fontWeight: 700, fontSize: 10, cursor: 'pointer', color: '#475569',
                    display: 'flex', alignItems: 'center', gap: 4, transition: 'all .2s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Check width={12} height={12} />
                  {filteredUnassigned.length > 0 && filteredUnassigned.every(o => selectedWorkOrders.has(o.id))
                    ? t('job-assignment.deselect_all', 'Deselect All')
                    : t('job-assignment.select_all', 'Select All')}
                </button>
                <button
                  disabled={autoAssignAll}
                  onClick={handleAutoAssignAll}
                  title="Auto-assign all unassigned orders (Shift+A)"
                  style={{
                    marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: 'none',
                    background: autoAssignAll ? '#e0e7ff' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                    color: autoAssignAll ? '#6366f1' : '#fff',
                    fontWeight: 700, fontSize: 11, cursor: autoAssignAll ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5, transition: 'all .2s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <DeliveryTruck width={13} height={13} />
                  {autoAssignAll
                    ? t('job-assignment.auto_assign_all_running', { count: filteredUnassigned.length })
                    : t('job-assignment.auto_assign_all')}
                </button>
                <button
                  onClick={() => setShowAutoAssignConfig(v => !v)}
                  title={t('job-assignment.auto_assign_config', 'Auto-assign settings')}
                  aria-label={t('job-assignment.auto_assign_config', 'Auto-assign settings')}
                  style={{
                    padding: '5px 8px', borderRadius: 8,
                    border: showAutoAssignConfig ? '1.5px solid #6366f1' : '1.5px solid #cbd5e1',
                    background: showAutoAssignConfig ? '#eef2ff' : '#fff',
                    color: showAutoAssignConfig ? '#4f46e5' : '#475569',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    transition: 'all .2s',
                  }}
                >
                  <Settings width={13} height={13} />
                </button>
                </>
              )}
            </div>
            {/* Auto-assign config panel */}
            {showAutoAssignConfig && (
              <div style={{
                margin: '0 10px 8px', padding: '12px 14px', borderRadius: 10,
                background: '#f8fafc', border: '1px solid #e2e8f0',
                fontSize: 12, color: '#1e293b',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontWeight: 700, fontSize: 12 }}>
                  <Settings width={14} height={14} />
                  {t('job-assignment.auto_assign_config', 'Auto-assign settings')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontWeight: 600, color: '#475569', fontSize: 11 }}>
                      {t('job-assignment.cfg.max_orders_per_mechanic', 'Max orders per mechanic')}
                    </span>
                    <input
                      type="number" min={1} max={50}
                      value={autoAssignCfg.max_orders_per_mechanic}
                      onChange={e => setAutoAssignCfg(c => ({ ...c, max_orders_per_mechanic: e.target.value }))}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontWeight: 600, color: '#475569', fontSize: 11 }}>
                      {t('job-assignment.cfg.min_mechanic_rating', 'Min mechanic rating (0 = off)')}
                    </span>
                    <input
                      type="number" min={0} max={5} step={0.1}
                      value={autoAssignCfg.min_mechanic_rating}
                      onChange={e => setAutoAssignCfg(c => ({ ...c, min_mechanic_rating: e.target.value }))}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontWeight: 600, color: '#475569', fontSize: 11 }}>
                      {t('job-assignment.cfg.max_assign_distance_km', 'Max distance to pickup (km, 0 = unlimited)')}
                    </span>
                    <input
                      type="number" min={0} max={500} step={0.5}
                      value={autoAssignCfg.max_assign_distance_km}
                      onChange={e => setAutoAssignCfg(c => ({ ...c, max_assign_distance_km: e.target.value }))}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
                    <input
                      type="checkbox"
                      checked={!!autoAssignCfg.enforce_vehicle_capacity}
                      onChange={e => setAutoAssignCfg(c => ({ ...c, enforce_vehicle_capacity: e.target.checked }))}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600, color: '#475569', fontSize: 11 }}>
                      {t('job-assignment.cfg.enforce_vehicle_capacity', 'Enforce vehicle capacity by weight')}
                    </span>
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <button
                    disabled={autoAssignCfgSaving || !autoAssignCfgLoaded}
                    onClick={saveAutoAssignConfig}
                    style={{
                      padding: '6px 14px', borderRadius: 8, border: 'none',
                      background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: '#fff',
                      fontWeight: 700, fontSize: 11, cursor: autoAssignCfgSaving ? 'wait' : 'pointer',
                    }}
                  >
                    {autoAssignCfgSaving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
                  </button>
                  {autoAssignCfgSaved && (
                    <span style={{ color: '#16a34a', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Check width={12} height={12} /> {t('common.saved', 'Saved')}
                    </span>
                  )}
                  <button
                    onClick={() => setShowAutoAssignConfig(false)}
                    style={{
                      marginLeft: 'auto', padding: '6px 10px', borderRadius: 8,
                      border: '1px solid #cbd5e1', background: '#fff', color: '#475569',
                      fontWeight: 600, fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    {t('common.close', 'Close')}
                  </button>
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>
                  {t('job-assignment.cfg.hint', 'These limits apply to both single auto-assign and batch auto-assign-all.')}
                </div>
              </div>
            )}
            {/* Auto-assign-all result banner */}
            {autoAssignResult && autoAssignResult.workOrderId === 'all' && (
              <div style={{
                margin: '0 10px 8px', padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: autoAssignResult.success ? '#dcfce7' : '#fef2f2',
                color: autoAssignResult.success ? '#166534' : '#991b1b',
                border: `1px solid ${autoAssignResult.success ? '#bbf7d0' : '#fecaca'}`,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {autoAssignResult.success ? <Check width={14} height={14} /> : <WarningTriangle width={14} height={14} />}
                  {autoAssignResult.message}
                </div>
                {Array.isArray(autoAssignResult.skipped) && autoAssignResult.skipped.length > 0 && (
                  <details style={{ fontSize: 11, fontWeight: 500 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                      {t('job-assignment.auto_assign_skipped_details', 'View skipped orders')}
                    </summary>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {autoAssignResult.skipped.slice(0, 20).map(s => (
                        <li key={s.work_order_id}>
                          {s.work_order_number} — {t(`job-assignment.skip_reason.${s.reason}`, s.reason)}
                        </li>
                      ))}
                      {autoAssignResult.skipped.length > 20 && (
                        <li>… +{autoAssignResult.skipped.length - 20} more</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            )}
            {filteredUnassigned.length === 0
              ? <div className="empty-col">{searchQuery ? t('job-assignment.no_results') : t("job-assignment.no_pending")}</div>
              : <>
                  {filteredUnassigned.slice(0, visibleUnassigned).map(o => <OrderCard key={o.id} order={o} showUnassign={false} />)}
                  {filteredUnassigned.length > visibleUnassigned && (
                    <button onClick={() => setVisibleUnassigned(v => v + PAGE_SIZE)} style={{
                      display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                      width:'calc(100% - 20px)', margin:'8px 10px 12px', padding:'8px 0', borderRadius:8,
                      border:'1.5px dashed #cbd5e1', background:'#fff', color:'#475569',
                      fontWeight:700, fontSize:12, cursor:'pointer', transition:'all .2s',
                    }}>
                      <NavArrowDown width={14} height={14} />
                      {t('job-assignment.show_more', 'Show More')} ({visibleUnassigned}/{filteredUnassigned.length})
                    </button>
                  )}
                </>
            }
          </div>

          {/* In Progress */}
          <div className="job-assignment-col">
            <div className="job-assignment-col-header">
              <div className="col-dot" style={{ background: '#3b82f6' }} />
              <h3>{t('job-assignment.col.in_progress')}</h3>
              <span className="col-count blue">{filteredActive.length}</span>
            </div>
            {filteredActive.length === 0
              ? <div className="empty-col">{searchQuery ? t('job-assignment.no_results') : t('job-assignment.no_active')}</div>
              : <>
                  {filteredActive.slice(0, visibleActive).map(o => <OrderCard key={o.id} order={o} showUnassign={true} />)}
                  {filteredActive.length > visibleActive && (
                    <button onClick={() => setVisibleActive(v => v + PAGE_SIZE)} style={{
                      display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                      width:'calc(100% - 20px)', margin:'8px 10px 12px', padding:'8px 0', borderRadius:8,
                      border:'1.5px dashed #cbd5e1', background:'#fff', color:'#475569',
                      fontWeight:700, fontSize:12, cursor:'pointer', transition:'all .2s',
                    }}>
                      <NavArrowDown width={14} height={14} />
                      {t('job-assignment.show_more', 'Show More')} ({visibleActive}/{filteredActive.length})
                    </button>
                  )}
                </>
            }
          </div>

          {/* Available Mechanics */}
          <div className="job-assignment-col">
            <div className="job-assignment-col-header">
              <div className="col-dot" style={{ background: '#22c55e' }} />
              <h3>{t("job-assignment.available_mechanics")}</h3>
              <span className="col-count green">{board.available_mechanics?.length || 0}</span>
            </div>
            <div style={{ padding:'0 8px 8px' }}>
              <div style={{ position:'relative' }}>
                <Search width={14} height={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#94a3b8', pointerEvents:'none' }} />
                <input
                  type="text"
                  value={mechanicSearch}
                  onChange={e => setMechanicSearch(e.target.value)}
                  placeholder={t('job-assignment.search_mechanics', 'Search mechanics...')}
                  style={{ width:'100%', padding:'7px 10px 7px 30px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, outline:'none', background:'#f8fafc', transition:'border-color .2s' }}
                  onFocus={e => e.target.style.borderColor = '#1e3a6b'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                />
                {mechanicSearch && (
                  <button onClick={() => setMechanicSearch('')} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', padding:0, color:'#94a3b8', display:'flex' }}>
                    <Xmark width={14} height={14} />
                  </button>
                )}
              </div>
            </div>
            {(() => {
              const filteredMechanics = mechanicSearch.trim()
                ? (board.available_mechanics || []).filter(d => {
                    const q = mechanicSearch.toLowerCase();
                    return (d.full_name || '').toLowerCase().includes(q)
                      || (d.vehicle_type || '').toLowerCase().includes(q)
                      || (d.vehicle_plate || '').toLowerCase().includes(q)
                      || (d.zone_name || '').toLowerCase().includes(q)
                      || (d.phone || '').includes(q);
                  })
                : (board.available_mechanics || []);
              if (filteredMechanics.length === 0) {
                return <div className="empty-col">{mechanicSearch ? t('job-assignment.no_mechanics_match', 'No mechanics match') : t('job-assignment.no_mechanics')}</div>;
              }
              return filteredMechanics.map(mechanic => (
                <div
                  key={mechanic.id}
                  className={`mechanic-card${dragOverMechanic === mechanic.id ? ' drag-over' : ''}${draggingOrder ? ' drop-ready' : ''}`}
                  onDragOver={draggingOrder ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
                  onDragEnter={draggingOrder ? () => setDragOverMechanic(mechanic.id) : undefined}
                  onDragLeave={draggingOrder ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverMechanic(null); } : undefined}
                  onDrop={draggingOrder ? (e) => { e.preventDefault(); const oid = parseInt(e.dataTransfer.getData('text/plain'), 10); if (oid) handleDragAssign(oid, mechanic.id); } : undefined}
                >
                  <div className="mechanic-avatar">{mechanic.full_name?.charAt(0)}</div>
                  <div className="mechanic-info">
                    <div className="mechanic-name">{mechanic.full_name}</div>
                    <div className="mechanic-meta">{mechanic.vehicle_type} &bull; {mechanic.vehicle_plate}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className="status-badge" style={{ background: '#f0fdf4', color: '#16a34a' }}>{t('job-assignment.online')}</span>
                    <span className="mechanic-workload" style={{
                      background: mechanic.active_orders >= 5 ? '#fef2f2' : mechanic.active_orders >= 3 ? '#fef3c7' : '#f0fdf4',
                      color: mechanic.active_orders >= 5 ? '#991b1b' : mechanic.active_orders >= 3 ? '#92400e' : '#166534',
                      border: `1px solid ${mechanic.active_orders >= 5 ? '#fecaca' : mechanic.active_orders >= 3 ? '#fde68a' : '#bbf7d0'}`,
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                    }}>
                      <Package width={10} height={10} />
                      {mechanic.active_orders || 0} {t('job-assignment.active', 'active')}
                    </span>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      ) : (
        /* ═══════ MAP VIEW ═══════ */
        <div className={`job-assignment-map-layout ${mapSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <div className="job-assignment-map-main">
            {mapMarkers.length === 0 ? (
              <div className="empty-state-mini" style={{ padding: '4rem 0', textAlign: 'center' }}>
                <MapPin width={48} height={48} />
                <p style={{ fontWeight: 600, marginTop: 12 }}>{t('job-assignment.map.no_locations')}</p>
                <p style={{ color: 'var(--gray-400)', fontSize: '0.85rem' }}>
                  {t('job-assignment.map.no_coords')}
                </p>
              </div>
            ) : (
              null
            )}
          </div>

          {/* ── Enhanced Map Sidebar ── */}
          <div className={`job-assignment-map-sidebar-v2 ${mapSidebarCollapsed ? 'collapsed' : ''}`}>
            {/* Collapse toggle */}
            <button
              className="map-sidebar-collapse-btn"
              onClick={() => setMapSidebarCollapsed(c => !c)}
              title={mapSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <NavArrowDown width={14} height={14} style={{ transform: mapSidebarCollapsed ? 'rotate(90deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />
            </button>

            {!mapSidebarCollapsed && (
              <>
                {/* Sidebar Search */}
                <div className="map-sidebar-search">
                  <Search width={14} height={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                  <input
                    type="text"
                    placeholder={t('job-assignment.map.search_placeholder') || 'Search orders, mechanics...'}
                    value={mapSidebarSearch}
                    onChange={e => setMapSidebarSearch(e.target.value)}
                  />
                  {mapSidebarSearch && (
                    <button onClick={() => setMapSidebarSearch('')} style={{ background:'none', border:'none', cursor:'pointer', padding:2 }}>
                      <Xmark width={12} height={12} color="#94a3b8" />
                    </button>
                  )}
                </div>

                {/* Sidebar Tabs */}
                <div className="map-sidebar-tabs">
                  {[
                    { key: 'unassigned', label: t('job-assignment.col.unassigned') || 'Unassigned', count: mapFilteredUnassigned.length, color: '#f59e0b' },
                    { key: 'active',     label: t('job-assignment.col.in_progress') || 'Active',    count: mapFilteredActive.length,      color: '#3b82f6' },
                    { key: 'mechanics',    label: t('job-assignment.available_mechanics') || 'Mechanics',  count: mapFilteredMechanics.length,     color: '#22c55e' },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      className={`map-sidebar-tab ${mapSidebarTab === tab.key ? 'active' : ''}`}
                      onClick={() => setMapSidebarTab(tab.key)}
                    >
                      <span className="map-sidebar-tab-dot" style={{ background: tab.color }} />
                      <span className="map-sidebar-tab-label">{tab.label}</span>
                      <span className="map-sidebar-tab-count" style={{ background: `${tab.color}18`, color: tab.color }}>{tab.count}</span>
                    </button>
                  ))}
                </div>

                {/* Sidebar Tab Content */}
                <div className="map-sidebar-content">
                  {/* ── Unassigned WorkOrders ── */}
                  {mapSidebarTab === 'unassigned' && (
                    mapFilteredUnassigned.length === 0 ? (
                      <div className="map-sidebar-empty">
                        <Package width={28} height={28} color="#cbd5e1" />
                        <span>{mapSidebarSearch ? 'No matching orders' : 'No unassigned orders'}</span>
                      </div>
                    ) : <>
                      {mapFilteredUnassigned.slice(0, visibleMapUnassigned).map(o => (
                      <div
                        key={o.id}
                        id={`map-card-unassigned-${o.id}`}
                        className={`map-mini-card ${highlightedCard && highlightedCard.match(new RegExp(`^unassigned-(?:stop-|sender-)?${o.id}(?:-|$)`)) ? 'highlighted' : ''} ${selectedWorkOrders.has(o.id) ? 'selected' : ''}`}
                        onClick={() => handleSidebarCardClick(o, 'unassigned')}
                      >
                        <div className="map-mini-card-accent" style={{ background: '#f59e0b' }} />
                        <div className="map-mini-card-body">
                          <div className="map-mini-card-top">
                            <span className="map-mini-card-id">#{o.work_order_number || o.id}</span>
                            <span className="map-mini-card-status" style={{ background: '#fef3c7', color: '#d97706' }}>
                              {t(`job-assignment.status.${o.status}`, o.status)}
                            </span>
                          </div>
                          {/* Show all stops, not just order-level recipient */}
                          {(o.stops || []).length > 0 ? (
                            <div style={{ margin: '4px 0 2px' }}>
                              {o.stops.map((stop, si) => (
                                <div key={stop.id || si} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                                  <span style={{
                                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                                    background: stop.status === 'completed' ? '#dcfce7' : '#fef3c7',
                                    color: stop.status === 'completed' ? '#16a34a' : '#d97706',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 8, fontWeight: 800,
                                  }}>{stop.sequence_number}</span>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                                    {stop.contact_name || '—'}
                                  </span>
                                  {stop.cash_amount > 0 && (
                                    <span style={{ fontSize: 9, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '1px 5px', borderRadius: 4 }}>
                                      COD {parseFloat(stop.cash_amount).toFixed(0)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="map-mini-card-name">{o.recipient_name || '—'}</div>
                          )}
                          {(o.stops || []).length === 0 && o.recipient_address && (
                            <div className="map-mini-card-address">
                              <MapPin width={10} height={10} /> {o.recipient_address.length > 40 ? o.recipient_address.slice(0, 40) + '…' : o.recipient_address}
                            </div>
                          )}
                          <div className="map-mini-card-chips">
                            {o.payment_method && (
                              <span className="map-mini-chip" style={{ background: o.payment_method === 'cod' ? '#fef3c7' : '#dbeafe', color: o.payment_method === 'cod' ? '#92400e' : '#1d4ed8' }}>
                                {o.payment_method.toUpperCase()}
                              </span>
                            )}
                            {o.cash_amount > 0 && (
                              <span className="map-mini-chip" style={{ background: '#fef9c3', color: '#713f12' }}>
                                {cur} {parseFloat(o.cash_amount).toFixed(0)}
                              </span>
                            )}
                            {o.zone_name && (
                              <span className="map-mini-chip" style={{ background: '#ede9fe', color: '#5b21b6' }}>
                                {o.zone_name}
                              </span>
                            )}
                            {(o.stops || []).length > 0 && (
                              <span className="map-mini-chip" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
                                <MapPin width={9} height={9} /> {o.stops.filter(s => s.status === 'completed').length}/{o.stops.length} stops
                              </span>
                            )}
                            {o.total_packages > 0 && (
                              <span className="map-mini-chip" style={{ background: '#f1f5f9', color: '#64748b' }}>
                                <Package width={9} height={9} /> {o.total_packages} pkg
                              </span>
                            )}
                          </div>
                          {/* Quick select button */}
                          <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:4 }}>
                            <button
                              className={`map-mini-select ${selectedWorkOrders.has(o.id) ? 'active' : ''}`}
                              style={{ flex: 1 }}
                              onClick={(e) => { e.stopPropagation(); setSelectedWorkOrders(prev => { const n = new Set(prev); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; }); }}
                            >
                              {selectedWorkOrders.has(o.id) ? <><Check width={11} height={11} /> Selected</> : 'Select for assign'}
                            </button>
                            <button
                              className="map-mini-wa"
                              onClick={(e) => { e.stopPropagation(); openDrawer(o); }}
                              title={t('job-assignment.view_details', 'View Details')}
                              style={{ background:'#1e3a6b', color:'#fff' }}
                            >
                              <Eye width={11} height={11} />
                            </button>
                            {o.recipient_phone && (
                              <button
                                className="map-mini-wa"
                                onClick={(e) => { e.stopPropagation(); _openWA(o.recipient_phone, _buildWAMsg(o, false, cur), dialCode); }}
                                title="WhatsApp"
                              >
                                <WhatsAppIconSvg size={11} color="currentColor" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {mapFilteredUnassigned.length > visibleMapUnassigned && (
                      <button onClick={() => setVisibleMapUnassigned(v => v + PAGE_SIZE)} style={{
                        display:'flex', alignItems:'center', justifyContent:'center', gap:4,
                        width:'100%', padding:'8px 0', borderRadius:8,
                        border:'1.5px dashed #cbd5e1', background:'#fff', color:'#475569',
                        fontWeight:700, fontSize:11, cursor:'pointer', margin:'6px 0',
                      }}>
                        <NavArrowDown width={12} height={12} />
                        {t('job-assignment.show_more', 'Show More')} ({visibleMapUnassigned}/{mapFilteredUnassigned.length})
                      </button>
                    )}
                    </>
                  )}

                  {/* ── Active WorkOrders ── */}
                  {mapSidebarTab === 'active' && (
                    mapFilteredActive.length === 0 ? (
                      <div className="map-sidebar-empty">
                        <DeliveryTruck width={28} height={28} color="#cbd5e1" />
                        <span>{mapSidebarSearch ? 'No matching orders' : 'No active deliveries'}</span>
                      </div>
                    ) : <>
                      {mapFilteredActive.slice(0, visibleMapActive).map(o => {
                      const sc = STATUS_STYLE[o.status] || STATUS_STYLE.pending;
                      return (
                        <div
                          key={o.id}
                          id={`map-card-active-${o.id}`}
                          className={`map-mini-card ${highlightedCard && highlightedCard.match(new RegExp(`^active-(?:stop-|sender-)?${o.id}(?:-|$)`)) ? 'highlighted' : ''}${reassigningOrder === o.id ? ' reassigning' : ''}`}
                          onClick={() => handleSidebarCardClick(o, 'active')}
                        >
                          <div className="map-mini-card-accent" style={{ background: sc.border || sc.color }} />
                          <div className="map-mini-card-body">
                            <div className="map-mini-card-top">
                              <span className="map-mini-card-id">#{o.work_order_number || o.id}</span>
                              <span className="map-mini-card-status" style={{ background: sc.background, color: sc.color }}>
                                {t(`job-assignment.status.${o.status}`, o.status)}
                              </span>
                            </div>
                            {/* Show all stops, not just order-level recipient */}
                            {(o.stops || []).length > 0 ? (
                              <div style={{ margin: '4px 0 2px' }}>
                                {o.stops.map((stop, si) => (
                                  <div key={stop.id || si} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                                    <span style={{
                                      width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                                      background: stop.status === 'completed' ? '#dcfce7' : stop.status === 'arrived' ? '#dbeafe' : '#fef3c7',
                                      color: stop.status === 'completed' ? '#16a34a' : stop.status === 'arrived' ? '#1d4ed8' : '#d97706',
                                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                      fontSize: 8, fontWeight: 800,
                                    }}>{stop.sequence_number}</span>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                                      {stop.contact_name || '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="map-mini-card-name">{o.recipient_name || '—'}</div>
                            )}
                            {o.mechanic_name && (
                              <div className="map-mini-card-mechanic">
                                <span className="map-mini-mechanic-avatar">{o.mechanic_name.charAt(0)}</span>
                                {o.mechanic_name}
                              </div>
                            )}
                            {(o.stops || []).length === 0 && o.recipient_address && (
                              <div className="map-mini-card-address">
                                <MapPin width={10} height={10} /> {o.recipient_address.length > 40 ? o.recipient_address.slice(0, 40) + '…' : o.recipient_address}
                              </div>
                            )}
                            <div className="map-mini-card-chips">
                              {o.payment_method && (
                                <span className="map-mini-chip" style={{ background: o.payment_method === 'cod' ? '#fef3c7' : '#dbeafe', color: o.payment_method === 'cod' ? '#92400e' : '#1d4ed8' }}>
                                  {o.payment_method.toUpperCase()}
                                </span>
                              )}
                              {o.cash_amount > 0 && (
                                <span className="map-mini-chip" style={{ background: '#fef9c3', color: '#713f12' }}>
                                  {cur} {parseFloat(o.cash_amount).toFixed(0)}
                                </span>
                              )}
                              {(o.stops || []).length > 0 && (
                                <span className="map-mini-chip" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
                                  <MapPin width={9} height={9} /> {o.stops.filter(s => s.status === 'completed').length}/{o.stops.length} stops
                                </span>
                              )}
                              {o.total_packages > 0 && (
                                <span className="map-mini-chip" style={{ background: '#f1f5f9', color: '#64748b' }}>
                                  <Package width={9} height={9} /> {o.total_packages} pkg
                                </span>
                              )}
                            </div>
                            {/* Action buttons: View + Reassign + Unassign */}
                            <div className="map-mini-actions">
                              <button
                                className="btn-reassign"
                                onClick={(e) => { e.stopPropagation(); openDrawer(o); }}
                                style={{ background:'#1e3a6b', color:'#fff' }}
                                title={t('job-assignment.view_details', 'View Details')}
                              >
                                <Eye width={11} height={11} />
                              </button>
                              <button
                                className={`btn-reassign ${reassigningOrder === o.id ? 'open' : ''}`}
                                onClick={(e) => { e.stopPropagation(); setReassigningOrder(reassigningOrder === o.id ? null : o.id); setReassignMechanic(''); }}
                              >
                                <DeliveryTruck width={11} height={11} /> {t('job-assignment.reassign')}
                              </button>
                              <button
                                className="btn-unassign"
                                onClick={(e) => { e.stopPropagation(); handleUnassign(o.id); }}
                              >
                                <Xmark width={11} height={11} /> {t('job-assignment.unassign')}
                              </button>
                            </div>
                            {/* Inline reassign mechanic picker */}
                            {reassigningOrder === o.id && (
                              <div className="map-mini-reassign-picker">
                                <span className="picker-label">
                                  {t('job-assignment.reassign_to')}
                                </span>
                                <MechanicDropdown
                                  mechanics={board.all_mechanics || board.available_mechanics || []}
                                  value={reassignMechanic}
                                  onChange={setReassignMechanic}
                                  placeholder={t('job-assignment.select_mechanic')}
                                  t={t}
                                />
                                <div className="picker-actions">
                                  <button
                                    className="btn-confirm"
                                    disabled={!reassignMechanic || assigning === o.id}
                                    onClick={(e) => { e.stopPropagation(); handleReassign(o.id); }}
                                  >
                                    <Check width={11} height={11} />
                                    {assigning === o.id ? t('job-assignment.reassigning') : t('job-assignment.confirm_reassign')}
                                  </button>
                                  <button
                                    className="btn-cancel"
                                    onClick={(e) => { e.stopPropagation(); setReassigningOrder(null); setReassignMechanic(''); }}
                                  >
                                    {t('job-assignment.cancel')}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {mapFilteredActive.length > visibleMapActive && (
                      <button onClick={() => setVisibleMapActive(v => v + PAGE_SIZE)} style={{
                        display:'flex', alignItems:'center', justifyContent:'center', gap:4,
                        width:'100%', padding:'8px 0', borderRadius:8,
                        border:'1.5px dashed #cbd5e1', background:'#fff', color:'#475569',
                        fontWeight:700, fontSize:11, cursor:'pointer', margin:'6px 0',
                      }}>
                        <NavArrowDown width={12} height={12} />
                        {t('job-assignment.show_more', 'Show More')} ({visibleMapActive}/{mapFilteredActive.length})
                      </button>
                    )}
                    </>
                  )}

                  {/* ── Mechanics ── */}
                  {mapSidebarTab === 'mechanics' && (
                    mapFilteredMechanics.length === 0 ? (
                      <div className="map-sidebar-empty">
                        <User width={28} height={28} color="#cbd5e1" />
                        <span>{mapSidebarSearch ? 'No matching mechanics' : 'No available mechanics'}</span>
                      </div>
                    ) : mapFilteredMechanics.map(d => (
                      <div
                        key={d.id}
                        id={`map-card-mechanic-${d.id}`}
                        className={`map-mini-card mechanic-variant ${highlightedCard === `mechanic-${d.id}` ? 'highlighted' : ''}`}
                        onClick={() => handleMechanicCardClick(d)}
                      >
                        <div className="map-mini-card-accent" style={{ background: '#22c55e' }} />
                        <div className="map-mini-card-body">
                          <div className="map-mini-card-top">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="map-mini-mechanic-badge">{d.full_name?.charAt(0)}</span>
                              <div>
                                <div className="map-mini-card-name" style={{ marginTop: 0 }}>{d.full_name}</div>
                                <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                                  {d.vehicle_type || '—'} · {d.vehicle_plate || '—'}
                                </div>
                              </div>
                            </div>
                            <span className="map-mini-card-status" style={{ background: '#dcfce7', color: '#16a34a' }}>
                              {t('job-assignment.online') || 'Online'}
                            </span>
                          </div>
                          <div className="map-mini-card-chips" style={{ marginTop: 6 }}>
                            {d.zone_name && (
                              <span className="map-mini-chip" style={{ background: '#ede9fe', color: '#5b21b6' }}>
                                <MapPin width={9} height={9} /> {d.zone_name}
                              </span>
                            )}
                            {d.active_orders > 0 && (
                              <span className="map-mini-chip" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
                                <Package width={9} height={9} /> {d.active_orders} active
                              </span>
                            )}
                            {d.phone && (
                              <span className="map-mini-chip" style={{ background: '#f1f5f9', color: '#475569' }}>
                                <Phone width={9} height={9} /> {d.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════ COMPLETED TODAY SECTION ═══════ */}
      {(board.completed_today?.length > 0) && (
        <div style={{ marginTop: 20 }}>
          <button
            onClick={() => setShowCompleted(c => !c)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '12px 18px', borderRadius: showCompleted ? '14px 14px 0 0' : 14,
              border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer',
              fontWeight: 700, fontSize: 14, color: '#475569',
              transition: 'all 0.2s',
            }}
          >
            <NavArrowDown width={16} height={16} style={{
              transform: showCompleted ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }} />
            <Check width={16} height={16} color="#16a34a" />
            {t('job-assignment.completed_today', 'Completed Today')}
            <span style={{
              padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800,
              background: '#dcfce7', color: '#166534', marginLeft: 4,
            }}>
              {board.completed_today.length}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
              {(() => {
                const ct = board.completed_today;
                const completed = ct.filter(o => o.status === 'completed').length;
                const cancelled = ct.filter(o => o.status === 'cancelled').length;
                const parts = [];
                if (completed) parts.push(`${completed} completed`);
                if (cancelled) parts.push(`${cancelled} cancelled`);
                return parts.join(' · ');
              })()}
            </span>
          </button>

          {showCompleted && (
            <div style={{
              border: '1px solid #e2e8f0', borderTop: 'none',
              borderRadius: '0 0 14px 14px', background: '#fafbfc',
              padding: 12, maxHeight: 420, overflowY: 'auto',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
                {board.completed_today.map(o => {
                  const isCompleted = o.status === 'completed';
                  const isCancelled = o.status === 'cancelled';
                  const statusColor = isCompleted ? '#16a34a' : isCancelled ? '#9333ea' : '#f59e0b';
                  const statusBg = isCompleted ? '#dcfce7' : isCancelled ? '#faf5ff' : '#fef3c7';
                  const completedAt = o.updated_at ? new Date(o.updated_at) : null;
                  return (
                    <div key={o.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      background: '#fff', borderRadius: 10, padding: '10px 14px',
                      border: '1px solid #f1f5f9', transition: 'box-shadow 0.15s',
                    }}>
                      {/* Status icon */}
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: statusBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isCompleted ? <Check width={16} height={16} color={statusColor} /> :
                         <Prohibition width={16} height={16} color={statusColor} />}
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                            #{o.work_order_number || o.id}
                          </span>
                          <span style={{
                            padding: '1px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                            background: statusBg, color: statusColor, border: `1px solid ${statusColor}22`,
                          }}>
                            {t(`job-assignment.status.${o.status}`, o.status)}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {o.recipient_name || '—'}
                          {o.zone_name && <span> · {o.zone_name}</span>}
                        </div>
                      </div>
                      {/* Mechanic & time */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {o.mechanic_name && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{o.mechanic_name}</div>
                        )}
                        {completedAt && (
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
                            {completedAt.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                        {o.payment_method === 'cod' && o.cash_amount > 0 && (
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', marginTop: 1 }}>
                            COD {parseFloat(o.cash_amount).toFixed(0)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      </>


      {/* ═══════════ ORDER DETAIL DRAWER ═══════════ */}
      {drawer && (
        <>
          <div onClick={closeDrawer}
            style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', zIndex:9990, backdropFilter:'blur(4px)' }} />
          <div style={{ position:'fixed', top:0, right:0, bottom:0, width:520, maxWidth:'96vw',
            background:'#ffffff', zIndex:9991, overflowY:'auto',
            boxShadow:'-8px 0 50px rgba(0,0,0,0.18)', display:'flex', flexDirection:'column' }}>

            {/* ── Header ── */}
            <div style={{ background:'linear-gradient(135deg,#0f172a,#1e293b)', padding:'22px 24px 20px', position:'relative' }}>
              <button onClick={closeDrawer}
                style={{ position:'absolute', top:16, right:16, background:'rgba(255,255,255,0.12)',
                  border:'none', color:'#fff', width:32, height:32, borderRadius:10,
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                  transition:'background 0.2s' }}
                onMouseOver={e => e.currentTarget.style.background='rgba(255,255,255,0.2)'}
                onMouseOut={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}>
                <Xmark width={16} height={16} />
              </button>

              {/* WorkOrder # + tracking */}
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14 }}>
                <div style={{ width:44, height:44, borderRadius:12,
                  background:'linear-gradient(135deg,#3b82f6,#2563eb)',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                  boxShadow:'0 4px 12px rgba(59,130,246,0.3)' }}>
                  <Package width={22} height={22} color="#fff" />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:'#fff', fontWeight:800, fontSize:18, letterSpacing:'-0.3px' }}>
                    {drawer.work_order_number || `#${drawer.id}`}
                  </div>
                  {(drawerFull?.service_status_token || drawer.service_status_token) && (
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                      <span style={{ color:'#64748b', fontSize:11, fontFamily:'monospace' }}>
                        {drawerFull?.service_status_token || drawer.service_status_token}
                      </span>
                      <button onClick={() => copyToken(drawerFull?.service_status_token || drawer.service_status_token)} style={{
                        background:'rgba(255,255,255,0.1)', border:'none', borderRadius:4,
                        padding:'2px 6px', cursor:'pointer', color:'#94a3b8', fontSize:10, fontWeight:600,
                        display:'flex', alignItems:'center', gap:3,
                      }}>
                        <Copy width={10} height={10} /> {copiedToken ? t('orders.drawer.copied', 'Copied!') : t('orders.drawer.copy', 'Copy')}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Status pill */}
              {(() => {
                const s = drawerFull?.status || drawer.status;
                const sc = STATUS_STYLE[s] || STATUS_STYLE.pending;
                return (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:20,
                    background:sc.background, color:sc.color, fontWeight:700, fontSize:12 }}>
                    <Check width={12} height={12} /> {t(`job-assignment.status.${s}`, s)}
                  </span>
                );
              })()}

              {/* Action icon buttons */}
              <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:12 }}>
                {[
                  { label: t('orders.drawer.label', 'Print Label'), icon: Printer, bg:'#8b5cf6', onClick:() => window.open(`/api/work-orders/${drawer.id}/label`, '_blank') },
                  ...(drawerFull?.service_status_token ? [{ label: t('orders.drawer.track', 'Track'), icon: OpenNewWindow, bg:'#0369a1', onClick:() => window.open(`/track/${drawerFull.service_status_token}`, '_blank') }] : []),
                  { label: t('orders.drawer.details', 'Full Details'), icon: ArrowRight, bg:'#1e3a6b', onClick:() => { closeDrawer(); navigate(`/work-orders/${drawer.id}`); }},
                ].map((btn, i) => (
                  <div key={i} style={{ position:'relative', flexShrink:0 }}
                    onMouseOver={e => {
                      const tip = e.currentTarget.querySelector('.dtip');
                      if (tip) tip.style.opacity='1';
                      const b = e.currentTarget.querySelector('button');
                      if (b) { b.style.opacity='0.85'; b.style.transform='scale(1.1)'; }
                    }}
                    onMouseOut={e => {
                      const tip = e.currentTarget.querySelector('.dtip');
                      if (tip) tip.style.opacity='0';
                      const b = e.currentTarget.querySelector('button');
                      if (b) { b.style.opacity='1'; b.style.transform='scale(1)'; }
                    }}>
                    <button onClick={btn.onClick} style={{
                      width:38, height:38, borderRadius:12, border:'none',
                      background:btn.bg, color:'#fff', cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.2s',
                    }}>
                      <btn.icon width={17} height={17} />
                    </button>
                    <span className="dtip" style={{
                      position:'absolute', left:'50%', top:'100%', transform:'translateX(-50%)',
                      marginTop:6, background:'#0f172a', color:'#fff', fontSize:10, fontWeight:600,
                      padding:'4px 10px', borderRadius:6, whiteSpace:'nowrap', pointerEvents:'none',
                      opacity:0, transition:'opacity 0.15s', zIndex:10, boxShadow:'0 4px 12px rgba(0,0,0,0.25)',
                    }}>{btn.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Body ── */}
            <div style={{ padding:'18px 20px', flex:1 }}>
              {drawerLoading ? (
                <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>
                  <div style={{ width:32, height:32, border:'3px solid #e2e8f0', borderTopColor:'#3b82f6',
                    borderRadius:'50%', margin:'0 auto 12px', animation:'spin 0.8s linear infinite' }} />
                  {t('job-assignment.loading', 'Loading...')}
                </div>
              ) : drawerFull ? (
                <>
                  {/* Quick Stats */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:18 }}>
                    {[
                      { label: t('orders.drawer.service_fee', 'Delivery Fee'), value: `${cur} ${parseFloat(drawerFull.service_fee || 0).toFixed(2)}`, color:'#16a34a', bg:'#f0fdf4', Icon:DollarCircle },
                      { label: t('orders.drawer.cash_amount', 'COD Amount'), value: `${cur} ${parseFloat(drawerFull.cash_amount || 0).toFixed(2)}`, color:'#d97706', bg:'#fffbeb', Icon:Wallet },
                      { label: t('orders.drawer.weight_label', 'Weight'), value: drawerFull.weight_kg ? `${parseFloat(drawerFull.weight_kg).toFixed(1)} kg` : '\u2014', color:'#0369a1', bg:'#f0f9ff', Icon:Weight },
                      { label: t('orders.drawer.type', 'Type'), value: drawerFull.work_order_type?.replace(/_/g,' ') || '\u2014', color:'#7c3aed', bg:'#faf5ff', Icon:Package },
                    ].map(s => (
                      <div key={s.label} style={{
                        background:s.bg, borderRadius:14, padding:'14px 14px',
                        border:`1px solid ${s.color}20`, borderLeft:`3px solid ${s.color}`,
                        transition:'transform 0.15s', cursor:'default',
                      }}
                        onMouseOver={e => e.currentTarget.style.transform='translateY(-1px)'}
                        onMouseOut={e => e.currentTarget.style.transform='translateY(0)'}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ width:36, height:36, borderRadius:10, background:`${s.color}15`,
                            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            <s.Icon width={18} height={18} color={s.color} />
                          </div>
                          <div>
                            <div style={{ fontWeight:800, fontSize:16, color:'#0f172a', lineHeight:1.1 }}>{s.value}</div>
                            <div style={{ fontSize:9, color:'#64748b', fontWeight:700, marginTop:3, textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Parts used on this work order */}
                  {drawerPackages.length > 0 && (
                    <div style={{ background:'#fff', borderRadius:12, marginBottom:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
                      <div style={{ padding:'12px 14px', borderBottom:'1px solid #f1f5f9',
                        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <span style={{ fontWeight:700, fontSize:12, color:'#0f172a',
                          display:'flex', alignItems:'center', gap:6, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                          <Package width={14} height={14} color="#6366f1" /> {t('orders.drawer.parts', 'Parts')}
                        </span>
                        <span style={{ fontSize:10, fontWeight:700, color:'#6366f1',
                          background:'#eef2ff', padding:'2px 8px', borderRadius:10 }}>
                          {drawerPackages.filter(p => p.status === 'installed').length}/{drawerPackages.length} installed
                        </span>
                      </div>
                      <div style={{ padding:'8px 12px' }}>
                        {drawerPackages.map((part, i) => {
                          const ps = PART_STATUS_STYLE[part.status] || PART_STATUS_STYLE.ordered;
                          return (
                            <div key={part.id || i} style={{
                              display:'flex', alignItems:'center', gap:10, padding:'8px 0',
                              borderBottom: i < drawerPackages.length - 1 ? '1px solid #f8fafc' : 'none',
                            }}>
                              <div style={{ width:28, height:28, borderRadius:8, background:ps.bg, flexShrink:0,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                fontWeight:800, fontSize:10, color:ps.color }}>
                                {part.quantity}×
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                                  <span style={{ fontWeight:600, fontSize:12, color:'#1e293b' }}>
                                    {part.name}
                                  </span>
                                  <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:8,
                                    background:ps.bg, color:ps.color }}>{ps.label}</span>
                                </div>
                                <div style={{ display:'flex', gap:6, marginTop:2, fontSize:10, color:'#94a3b8', flexWrap:'wrap' }}>
                                  {part.part_number && (
                                    <span style={{ fontWeight:700, padding:'1px 5px', borderRadius:4, background:'#eff6ff', color:'#2563eb' }}>
                                      #{part.part_number}
                                    </span>
                                  )}
                                  {part.total_cost > 0 && (
                                    <span style={{ fontWeight:700, color:'#d97706' }}>{parseFloat(part.total_cost).toFixed(2)}</span>
                                  )}
                                  {part.warranty_period_days > 0 && (
                                    <span>Warranty: {part.warranty_period_days}d</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Sender + Recipient */}
                  <div style={{ display:'grid', gridTemplateColumns: '1fr 1fr', gap:10, marginBottom:14 }}>
                    {/* Customer / Sender */}
                    <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                      <div style={{ fontWeight:700, fontSize:10, marginBottom:8, color:'#64748b',
                        display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                        <Building width={12} height={12} color="#3b82f6" /> {t('orders.drawer.customer_sender', 'Customer / Sender')}
                      </div>
                      <div style={{ fontWeight:700, fontSize:13, color:'#0f172a' }}>
                        {drawerFull.customer_name || drawerFull.sender_name || t('orders.walk_in', 'Walk-in')}
                      </div>
                      {drawerFull.company_name && <div style={{ fontSize:10, color:'#64748b' }}>{drawerFull.company_name}</div>}
                      {(drawerFull.customer_phone || drawerFull.sender_phone) && (
                        <div style={{ fontSize:11, color:'#3b82f6', marginTop:2 }}>
                          <a href={`tel:${drawerFull.customer_phone || drawerFull.sender_phone}`} style={{ color:'inherit', textDecoration:'none' }}>
                            {drawerFull.customer_phone || drawerFull.sender_phone}
                          </a>
                        </div>
                      )}
                      {drawerFull.sender_address && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2, lineHeight:'1.3' }}>{drawerFull.sender_address}</div>}
                    </div>

                    {/* Recipient */}
                    <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                      <div style={{ fontWeight:700, fontSize:10, marginBottom:8, color:'#64748b',
                        display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                        <User width={12} height={12} color="#f97316" /> {t('orders.drawer.recipient', 'Recipient')}
                      </div>
                      <div style={{ fontWeight:700, fontSize:13, color:'#0f172a' }}>{drawerFull.recipient_name || '\u2014'}</div>
                      {drawerFull.recipient_phone && (
                        <a href={`tel:${drawerFull.recipient_phone}`} style={{ fontSize:11, color:'#3b82f6', textDecoration:'none', fontWeight:600 }}>
                          {drawerFull.recipient_phone}
                        </a>
                      )}
                      {drawerFull.recipient_address && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2, lineHeight:'1.3' }}>{drawerFull.recipient_address}</div>}
                      {(drawerFull.recipient_area || drawerFull.recipient_emirate) && (
                        <div style={{ fontSize:10, color:'#64748b', marginTop:1 }}>
                          {[drawerFull.recipient_area, drawerFull.recipient_emirate].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Delivery Details */}
                  <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0', marginBottom:14 }}>
                    <div style={{ fontWeight:700, fontSize:10, marginBottom:8, color:'#64748b',
                      display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                      <DeliveryTruck width={12} height={12} color="#8b5cf6" /> {t('orders.drawer.delivery_details', 'Delivery Details')}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 16px' }}>
                      {[
                        { label: t('orders.drawer.bay', 'ServiceBay'), value: drawerFull.zone_name },
                        { label: t('orders.drawer.mechanic', 'Mechanic'), value: drawerFull.mechanic_name },
                        { label: t('orders.drawer.category', 'Category'), value: drawerFull.category?.replace(/_/g,' ') },
                        { label: t('orders.drawer.payment', 'Payment'), value: drawerFull.payment_method?.toUpperCase() },
                        { label: t('orders.drawer.dimensions', 'Dimensions'), value: drawerFull.dimensions },
                        { label: t('orders.drawer.scheduled', 'Scheduled'), value: drawerFull.scheduled_at ? new Date(drawerFull.scheduled_at).toLocaleString() : null },
                      ].filter(r => r.value).map(row => (
                        <div key={row.label} style={{ padding:'4px 0' }}>
                          <div style={{ fontSize:9, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2 }}>{row.label}</div>
                          <div style={{ fontSize:12, fontWeight:600, color:'#1e293b' }}>{row.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Notes section removed — imported work orders carry the
                      migration JSON envelope here, which was just noise. Any
                      real user-authored description/instructions remain visible
                      elsewhere on the full detail page. */}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
