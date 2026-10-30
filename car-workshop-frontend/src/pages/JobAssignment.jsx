import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Refresh, Check, Xmark, WarningTriangle, Clock, Calendar, User, Phone, ArrowRight,
  Search, ScanBarcode, QrCode, Camera, NavArrowDown, Filter as FilterIcon,
  Eye, Copy, Printer, OpenNewWindow, Prohibition, Download, Settings,
  Wrench, Car, Group, PasteClipboard, Package, MapPin, Notes,
} from 'iconoir-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import api from '../lib/api';
import './CRMPages.css';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { getPhoneCodeForCountry } from '../components/PhoneInput';
import { escapeHtml } from '../utils/escapeHtml';
import { downloadCsv } from '../utils/csv';
import { woLabel, woTone, woDisplayKey, WO_DISPLAY_KEYS } from '../lib/statusLabels';
import { customerStatusUrl, extractStatusToken } from '../lib/customerLink';
import { buildStatusMessage, shareViaWhatsApp } from '../lib/whatsapp';
import { hasModule, MODULES } from '../lib/modules';
import { canDo } from '../lib/permissions';

const PART_STATUS_STYLE = {
  ordered:   { bg: '#fffbeb', color: '#f59e0b', label: 'Ordered' },
  in_stock:  { bg: '#eff6ff', color: '#3b82f6', label: 'In Stock' },
  installed: { bg: '#f0fdf4', color: '#16a34a', label: 'Installed' },
  returned:  { bg: '#fef2f2', color: '#dc2626', label: 'Returned' },
};

/* Status filter of the board, by display key (lib/statusLabels.js). Each key
   is labelled through one stored status that maps to it — "approved" through
   estimate_approved. Closed and cancelled jobs are not on the board. */
const BOARD_STATUS_KEYS = ['checked_in', 'inspected', 'approved', 'assigned', 'in_work', 'quality_check', 'ready'];
const STATUS_OF_KEY = {
  checked_in: 'pending', inspected: 'confirmed', approved: 'estimate_approved', assigned: 'assigned',
  in_work: 'in_progress', quality_check: 'inspection', ready: 'ready_for_pickup',
};

// Why auto-assign-all skipped a job card (POST /job-assignment/auto-assign-all `skipped[].reason`).
const SKIP_REASONS = {
  no_eligible_mechanic: 'No technician free within the limits',
  out_of_range: 'No technician within the distance limit',
  physical_inspection: 'Waiting for the physical inspection — no job card yet',
};

/* ── Custom Mechanic Dropdown ─────────────────────────────── */
const MECHANIC_STATUS_META = {
  available: { label: 'Available', bg: '#dcfce7', color: '#16a34a', dot: '#22c55e' },
  busy:      { label: 'Busy',      bg: '#fee2e2', color: '#dc2626', dot: '#ef4444' },
  on_break:  { label: 'On Break',  bg: '#fef3c7', color: '#d97706', dot: '#f59e0b' },
  offline:   { label: 'Offline',   bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8' },
};
// Open jobs on a technician, as the board API sends it (active_orders is the
// courier-era name), and their trade.
const activeJobs = (d) => parseInt(d?.active_work_orders ?? d?.active_orders, 10) || 0;
const tradeOf = (d) => (d?.specialty ? String(d.specialty).replace(/_/g, ' ') : '');

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
    return d.full_name?.toLowerCase().includes(q) || d.phone?.includes(q) || tradeOf(d).toLowerCase().includes(q)
      || (d.service_bay_name || '').toLowerCase().includes(q);
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
              <span className="drv-dd-sel-meta">{[tradeOf(selected), selected.service_bay_name].filter(Boolean).join(' • ') || selected.phone}</span>
            </span>
            <span className="drv-dd-sel-status" style={{ background: MECHANIC_STATUS_META[selected.status]?.bg, color: MECHANIC_STATUS_META[selected.status]?.color }}>
              <span className="drv-dd-dot" style={{ background: MECHANIC_STATUS_META[selected.status]?.dot }} />
              {MECHANIC_STATUS_META[selected.status]?.label}
            </span>
          </span>
        ) : (
          <span className="drv-dd-placeholder">
            <Wrench width={16} height={16} /> {placeholder || 'Select technician'}
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
                      {tradeOf(d) && <span style={{ textTransform: 'capitalize' }}>{tradeOf(d)}</span>}
                      {d.service_bay_name && <span>• {d.service_bay_name}</span>}
                      {activeJobs(d) > 0 && <span className="drv-dd-item-orders">{translate ? translate('jobAssignment.jobs_open', '{{count}} open', { count: activeJobs(d) }) : `${activeJobs(d)} open`}</span>}
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

// The customer's status update for WhatsApp (lib/whatsapp.js): their car,
// the job card, the stage in customer words and the status link.
const sendStatusWhatsApp = ({ t, wo, workshopName, dialCode }) => {
  const message = buildStatusMessage({ t, wo, workshopName });
  shareViaWhatsApp(_formatPhoneForWA(wo?.customer_phone || wo?.customer_phone_ref, dialCode), message);
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

// What a workshop job card is: who and which car. The cards used to show only
// the delivery app's recipient_name, which a job card never has.
const jobLine = (o) => [
  o?.customer_name || o?.customer_name_ref,
  [o?.vehicle_make, o?.vehicle_model].filter(Boolean).join(' '),
  o?.vehicle_plate_number,
].filter(Boolean).join(' · ');

// The number staff call the job by: the main job card's, else the work order's.
const jcNo = (o) => o?.main_job_card_number || o?.work_order_number || (o?.id ? `#${o.id}` : '');
const vehicleOf = (o) => [o?.vehicle_make, o?.vehicle_model].filter(Boolean).join(' ');
// The approved work lines (work_order_items) as one line; the reported issue when there are none.
const workOf = (o) => (o?.items || []).map(i => i.name).filter(Boolean).join(', ') || o?.description || '';
const fmtDay = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDayTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function JobAssignment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, workshop } = useContext(AuthContext);
  // Assigning is the Team Leader's (job.assign; the server refuses everyone
  // else). Without it the board is read-only: no select, assign, reassign,
  // unassign, auto-assign or drag.
  const canAssign = canDo(user, 'job.assign');
  const dialCode = getPhoneCodeForCountry(workshop?.country);
  const [board, setBoard]                 = useState({ unassigned: [], active_deliveries: [], available_mechanics: [], all_mechanics: [] });
  const [loading, setLoading]             = useState(true);
  const [assigning, setAssigning]         = useState(null);
  const [selectedWorkOrders, setSelectedWorkOrders] = useState(new Set());
  const [selectedMechanic, setSelectedMechanic] = useState('');
  const [error, setError]                 = useState('');

  /* ── Search & Scanner state ── */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showScanner, setShowScanner] = useState(false); // false | 'barcode' | 'qr'

  /* ── Filter state ── */
  const [filterStatus, setFilterStatus] = useState('');         // '' = all, else a display key (BOARD_STATUS_KEYS)
  const [filterZone, setFilterZone] = useState('');             // '' = all, else a service bay name
  const [filterDate, setFilterDate] = useState('');             // '' | 'today' | 'week' | 'custom'
  const [filterDateFrom, setFilterDateFrom] = useState('');     // YYYY-MM-DD
  const [filterDateTo, setFilterDateTo] = useState('');         // YYYY-MM-DD
  const [showFilters, setShowFilters] = useState(false);        // toggle filter bar
  const [sortBy, setSortBy] = useState('');                     // '' | 'date' | 'promised' | 'bay' | 'status'
  const [sortDir, setSortDir] = useState('asc');                // 'asc' | 'desc'

  /* ── Auto-assign state ── */
  const [autoAssigning, setAutoAssigning] = useState(null);    // order id being auto-assigned
  const [autoAssignAll, setAutoAssignAll] = useState(false);   // batch in progress
  const [autoAssignResult, setAutoAssignResult] = useState(null); // { workOrderId, success, message }

  /* ── Auto-assign configuration (per-workshop settings) ── */
  const [showAutoAssignConfig, setShowAutoAssignConfig] = useState(false);
  // The keys job-assignment.js reads (loadAssignmentConfig). Distance and
  // parcel-weight capacity were courier settings and are gone from the panel.
  const [autoAssignCfg, setAutoAssignCfg] = useState({
    max_work_orders_per_mechanic: 5,
    min_mechanic_rating: 0,
    enforce_specialty_match: false,
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
  const canOpenBoard = hasModule(user, MODULES.vehicleBoard);

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
          if (e.shiftKey && canAssign) {
            // Shift+A = auto-assign all
            e.preventDefault();
            handleAutoAssignAll();
          }
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
  }, [drawer, showScanner, showFilters, canAssign]);

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
  // "Copy customer link": the /service-status page the customer follows
  // (lib/customerLink.js), not the bare token.
  const copyCustomerLink = (o) => {
    const url = customerStatusUrl(o);
    if (!url) return;
    navigator.clipboard?.writeText(url);
    setCopiedToken(url);
    setTimeout(() => setCopiedToken(null), 1500);
  };
  // The service job sheet PDF, fetched with the session so it opens even
  // where the auth cookie is not sent.
  const printJobSheet = async (workOrderId) => {
    try {
      const res = await api.get(`/work-orders/${workOrderId}/label`, { raw: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      console.error('Job sheet error:', e);
      setError(t('jobAssignment.job_sheet_failed', 'Could not open the job sheet. Please try again.'));
    }
  };



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
    if (!window.confirm(t('jobAssignment.auto_assign_all_confirm', 'Auto-assign all {{count}} unassigned job cards to available technicians?', { count }))) return;
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
  // The keys loadAssignmentConfig() in job-assignment.js reads. The panel
  // used to save max_orders_per_mechanic / enforce_vehicle_capacity, which the
  // server never read.
  const loadAutoAssignConfig = useCallback(async () => {
    try {
      const res = await api.get('/settings');
      const s = res?.data?.settings || {};
      const num = (v, def) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : def);
      setAutoAssignCfg({
        max_work_orders_per_mechanic: num(s.max_work_orders_per_mechanic, 5),
        min_mechanic_rating: num(s.min_mechanic_rating, 0),
        enforce_specialty_match: s.enforce_specialty_match === true || ['true', '1', 'yes'].includes(String(s.enforce_specialty_match).toLowerCase()),
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
          max_work_orders_per_mechanic: Math.max(1, parseInt(autoAssignCfg.max_work_orders_per_mechanic, 10) || 5),
          min_mechanic_rating: Math.max(0, Math.min(5, parseFloat(autoAssignCfg.min_mechanic_rating) || 0)),
          enforce_specialty_match: !!autoAssignCfg.enforce_specialty_match,
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
  const hasActiveFilters = filterStatus || filterZone || filterDate || sortBy || searchQuery.trim();
  const activeFilterCount = [filterStatus, filterZone, filterDate, sortBy].filter(Boolean).length;

  const clearAllFilters = () => {
    setFilterStatus(''); setFilterZone('');
    setFilterDate(''); setFilterDateFrom(''); setFilterDateTo('');
    setSortBy(''); setSortDir('asc');
    setSearchQuery('');
  };

  // Service bays on the board, for the bay filter
  const availableServiceBays = [...new Set(
    [...(board.unassigned || []), ...(board.active_deliveries || [])]
      .map(o => o.service_bay_name).filter(Boolean)
  )].sort();

  const filterWorkOrders = (orders) => {
    let out = orders;

    // Text search: job card / work order number, customer, car, plate, VIN, token
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter(o =>
        String(o.work_order_number || o.id).toLowerCase().includes(q) ||
        String(o.main_job_card_number || '').toLowerCase().includes(q) ||
        jobLine(o).toLowerCase().includes(q) ||
        String(o.vehicle_vin || '').toLowerCase().includes(q) ||
        String(o.customer_phone || '').toLowerCase().includes(q) ||
        String(o.service_status_token || '').toLowerCase().includes(q)
      );
    }

    // Status filter (display key — "Approved" covers every approved status)
    if (filterStatus) {
      out = out.filter(o => woDisplayKey(o) === filterStatus);
    }

    // Service bay filter
    if (filterZone) {
      out = out.filter(o => o.service_bay_name === filterZone);
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
      const stepOf = (o) => { const i = WO_DISPLAY_KEYS.indexOf(woDisplayKey(o)); return i < 0 ? 99 : i; };
      // Jobs with no promised date go last whichever the direction
      const promised = (o) => (o.estimated_completion_at ? new Date(o.estimated_completion_at).getTime() : null);
      out = [...out].sort((a, b) => {
        if (sortBy === 'date') {
          return dir * (new Date(a.created_at || 0) - new Date(b.created_at || 0));
        } else if (sortBy === 'promised') {
          const pa = promised(a), pb = promised(b);
          if (pa === null || pb === null) return (pa === null) - (pb === null);
          return dir * (pa - pb);
        } else if (sortBy === 'bay') {
          return dir * (a.service_bay_name || '').localeCompare(b.service_bay_name || '');
        } else if (sortBy === 'status') {
          return dir * (stepOf(a) - stepOf(b));
        }
        return 0;
      });
    }

    return out;
  };

  /* ── Job card scan → select that job card ── */
  // A scan is the job sheet's QR (a /service-status/… or /track/… link), its
  // job card or work order number, the plate or the VIN.
  const handleJobScan = (scanned) => {
    const code = String(extractStatusToken(scanned) || '').trim().toLowerCase();
    if (!code) return;
    const all = [...(board.unassigned || []), ...(board.active_deliveries || [])];
    const hit = all.find(o => [o.work_order_number, o.main_job_card_number, o.service_status_token, o.vehicle_plate_number, o.vehicle_vin]
      .some(v => v && String(v).toLowerCase() === code));
    if (hit) {
      if (canAssign) setSelectedWorkOrders(new Set([hit.id]));
      setSearchQuery(String(hit.work_order_number || hit.id));
    } else {
      setSearchQuery(code);
    }
  };

  const filteredUnassigned = filterWorkOrders(board.unassigned || []);
  const filteredActive = filterWorkOrders(board.active_deliveries || []);

  /* ── Export / print: one row per job card ── */
  // Columns: JC No., Plate, Vehicle, Customer, Work, Technician, Status, Promised.
  const boardSections = useCallback(() => ([
    { key: 'unassigned', title: t('job-assignment.col.unassigned', 'Unassigned'), rows: board.unassigned || [] },
    { key: 'active', title: t('job-assignment.col.in_progress', 'In Progress'), rows: board.active_deliveries || [] },
    { key: 'closed', title: t('jobAssignment.closed_today', 'Closed today'), rows: board.completed_today || [] },
  ]), [board, t]);
  const exportRow = useCallback((o) => [
    jcNo(o),
    o.vehicle_plate_number || '',
    vehicleOf(o),
    o.customer_name || o.customer_name_ref || '',
    workOf(o),
    o.mechanic_name || '',
    woLabel(t, o),
    fmtDay(o.estimated_completion_at),
  ], [t]);
  const exportHeaders = () => [
    t('jobAssignment.col.jc_no', 'JC No.'), t('jobAssignment.col.plate', 'Plate'), t('jobAssignment.col.vehicle', 'Vehicle'),
    t('jobAssignment.col.customer', 'Customer'), t('jobAssignment.col.work', 'Work'), t('jobAssignment.col.technician', 'Technician'),
    t('jobAssignment.col.status', 'Status'), t('jobAssignment.col.promised', 'Promised'),
  ];

  const handleExportCSV = useCallback(() => {
    const rows = boardSections().flatMap(sec => sec.rows.map(exportRow));
    if (!rows.length) return;
    // csvCell quotes and neutralises spreadsheet formulas (SR-15).
    downloadCsv(`job-assignment-${new Date().toISOString().slice(0, 10)}.csv`, exportHeaders(), rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardSections, exportRow]);

  /* ── Print job-assignment board ── */
  const handlePrint = useCallback(() => {
    const sections = boardSections().filter(sec => sec.rows.length);
    const now = new Date();
    const title = t('jobAssignment.report_title', 'Job Assignment Report');
    const dir = document?.documentElement?.dir === 'rtl' ? 'rtl' : 'ltr';
    let html = `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      body{font-family:Inter,system-ui,sans-serif;margin:20px;color:#1e293b;font-size:12px}
      h1{font-size:18px;margin:0 0 4px}
      .meta{color:#64748b;font-size:11px;margin-bottom:16px}
      h2{font-size:14px;margin:16px 0 8px;padding:6px 10px;background:#f1f5f9;border-radius:6px}
      table{width:100%;border-collapse:collapse;margin-bottom:12px}
      th{text-align:start;padding:6px 8px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:0.05em}
      td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;vertical-align:top}
      .badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700}
      @media print{body{margin:10px}h2{break-before:auto}}
    </style></head><body>`;
    html += `<h1>${escapeHtml(title)}</h1>`;
    html += `<div class="meta">${escapeHtml(now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))} — ${escapeHtml(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</div>`;
    const heads = exportHeaders();
    for (const sec of sections) {
      html += `<h2>${escapeHtml(sec.title)} (${sec.rows.length})</h2>`;
      html += `<table><thead><tr>${heads.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>`;
      sec.rows.forEach(o => {
        const tone = woTone(o);
        const cells = exportRow(o);
        html += '<tr>' + cells.map((c, i) => (i === 6
          ? `<td><span class="badge" style="background:${tone.bg};color:${tone.color}">${escapeHtml(c)}</span></td>`
          : `<td>${i === 0 ? `<strong>${escapeHtml(c)}</strong>` : (escapeHtml(c) || '—')}</td>`)).join('') + '</tr>';
      });
      html += `</tbody></table>`;
    }
    html += `</body></html>`;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardSections, exportRow]);

  /* ── Job card on the board ── */
  // A job card: JC number, status, customer and car, the approved work, the
  // bay, the technician and the promised date. No parcel, recipient, COD,
  // fee, weight, distance or ETA.
  const OrderCard = ({ order, showUnassign }) => {
    const tone = woTone(order);
    const canDrag = canAssign && !showUnassign;
    const isSelected = selectedWorkOrders.has(order.id);
    const lines = order.items || [];
    const work = lines.length ? lines.map(i => i.name).filter(Boolean) : [];

    return (
      <div
        className={`job-assignment-card${canDrag && draggingOrder === order.id ? ' dragging' : ''}${reassigningOrder === order.id ? ' reassigning' : ''}`}
        style={{ borderColor: isSelected ? tone.color : undefined }}
        draggable={canDrag}
        onDragStart={canDrag ? (e) => {
          setDraggingOrder(order.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(order.id));
        } : undefined}
        onDragEnd={canDrag ? () => { setDraggingOrder(null); setDragOverMechanic(null); } : undefined}
      >
        {/* Color accent bar */}
        <div className="job-assignment-card-accent" style={{ background: tone.color }} />
        <div className="job-assignment-card-inner">

          {/* Header: job card number + status */}
          <div className="job-assignment-card-header">
            <div style={{ flex:1, minWidth:0 }}>
              <div className="job-assignment-order-id">{jcNo(order)}</div>
              <div className="job-assignment-recipient">{jobLine(order) || '—'}</div>
            </div>
            <span className="status-badge" style={{
              background: tone.bg, color: tone.color, fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20,
              border:`1px solid ${tone.color}25`, letterSpacing:'0.01em', whiteSpace:'nowrap', textTransform:'none',
            }}>{woLabel(t, order, 'short')}</span>
          </div>

          {/* The approved work (or the reported issue) */}
          {(work.length > 0 || order.description) && (
            <div style={{ display:'flex', alignItems:'flex-start', gap:5, fontSize:12, color:'#475569', margin:'0 0 6px', lineHeight:1.4 }}>
              <Notes width={13} height={13} style={{ flexShrink:0, marginTop:2, color:'#94a3b8' }} />
              <span style={{ overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflowWrap:'anywhere' }}>
                {work.length ? work.slice(0, 3).join(' · ') + (work.length > 3 ? ` +${work.length - 3}` : '') : order.description}
              </span>
            </div>
          )}

          {/* Bay · technician · promised / booked */}
          <div className="job-assignment-meta">
            {order.service_bay_name && (
              <span style={{ color:'#7c3aed', fontWeight:600 }}>
                <MapPin width={13} height={13} style={{ color:'#7c3aed' }} /> {order.service_bay_name}
              </span>
            )}
            {order.mechanic_name && (
              <span style={{ color:'#15803d', fontWeight:600 }}>
                <Wrench width={13} height={13} style={{ color:'#15803d' }} /> {order.mechanic_name}
              </span>
            )}
            {order.estimated_completion_at ? (
              <span style={{ color:'#9333ea', fontWeight:600 }}>
                <Calendar width={12} height={12} /> {t('jobAssignment.promised', 'Promised {{date}}', { date: fmtDayTime(order.estimated_completion_at) })}
              </span>
            ) : order.scheduled_at ? (
              <span style={{ color:'#9333ea', fontWeight:600 }}>
                <Calendar width={12} height={12} /> {t('jobAssignment.booked', 'Booked {{date}}', { date: fmtDayTime(order.scheduled_at) })}
              </span>
            ) : null}
            {(order.parts || []).length > 0 && (
              <span>
                <Package width={12} height={12} /> {t('jobAssignment.parts_count', '{{count}} parts', { count: order.parts.length })}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="job-assignment-actions" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn-sm"
              onClick={(e) => { e.stopPropagation(); openDrawer(order); }}
              title={t('job-assignment.view_details', 'View Details')}
              aria-label={t('job-assignment.view_details', 'View Details')}
              style={{
                background:'linear-gradient(135deg,#1e3a6b,#1e293b)', color:'#fff',
                border:'none', fontWeight:700, fontSize:12, borderRadius:8,
                minHeight:44, minWidth:44, padding:'6px 10px', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:4, transition:'all .2s',
              }}
            >
              <Eye width={13} height={13} />
            </button>
            {canAssign && !showUnassign && (
              <>
                <button
                  className={`btn-sm ${isSelected ? 'btn-sm-primary' : 'btn-sm-outline'}`}
                  style={{ minHeight: 44 }}
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
                    minHeight: 44, padding: '6px 12px', cursor: autoAssigning === order.id ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5, transition: 'all .2s',
                  }}
                >
                  <User width={13} height={13} />
                  {autoAssigning === order.id ? t('job-assignment.auto_assigning') : t('job-assignment.auto_assign')}
                </button>
              </>
            )}
            {canAssign && showUnassign && (
              <>
                <button
                  className="btn-sm"
                  onClick={() => { setReassigningOrder(reassigningOrder === order.id ? null : order.id); setReassignMechanic(''); }}
                  style={{
                    background: reassigningOrder === order.id ? '#e0e7ff' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    color: reassigningOrder === order.id ? '#3b82f6' : '#fff',
                    border: 'none', fontWeight: 700, fontSize: 12, borderRadius: 8,
                    minHeight: 44, padding: '6px 12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5, transition: 'all .2s',
                  }}
                >
                  <User width={13} height={13} />
                  {t('job-assignment.reassign')}
                </button>
                <button className="btn-sm btn-sm-danger" style={{ minHeight: 44 }} onClick={() => handleUnassign(order.id)}>
                  <Xmark width={14} height={14} /> {t('job-assignment.unassign')}
                </button>
              </>
            )}
          </div>
          {/* Reassign mechanic picker */}
          {canAssign && reassigningOrder === order.id && (
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
                  style={{ flex: 1, minHeight: 44, opacity: !reassignMechanic ? 0.5 : 1 }}
                >
                  <Check width={13} height={13} />
                  {assigning === order.id ? t('job-assignment.reassigning') : t('job-assignment.confirm_reassign')}
                </button>
                <button
                  className="btn-sm btn-sm-outline"
                  style={{ minHeight: 44 }}
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

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="module-hero">
        <div className="module-hero-left">
          <h2 className="module-hero-title">{t('job-assignment.title')}</h2>
          <p className="module-hero-sub">{t('jobAssignment.subtitle', 'Step 6 — give each approved job card to a technician')}</p>
        </div>
        <div className="module-hero-actions" style={{ flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/work-orders')} style={{
            minHeight: 44, padding: '8px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff',
            cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#475569',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <PasteClipboard width={14} height={14} /> {t('job-assignment.orders')}
          </button>
          {/* Was "Live Map" → /live-map, a route that never existed (it bounced
              to the dashboard). The Team Board is where technicians are booked. */}
          <button onClick={() => navigate('/team-leader')} style={{
            minHeight: 44, padding: '8px 14px', borderRadius: 10, border: '1px solid #bfdbfe', background: '#eff6ff',
            cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#2563eb',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Group width={14} height={14} /> {t('common.team_board', 'Team Board')}
          </button>
          {/* Was "Track" → the courier Service Tracking page. The Vehicle Status
              Board shows where every car is in Steps 1–7; only roles with that
              module see the button. */}
          {canOpenBoard && (
            <button onClick={() => navigate('/vehicle-board')} style={{
              minHeight: 44, padding: '8px 14px', borderRadius: 10, border: '1px solid #bbf7d0', background: '#f0fdf4',
              cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#15803d',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <Car width={14} height={14} /> {t('jobAssignment.vehicle_board', 'Vehicle board')}
            </button>
          )}

          <button className="module-btn module-btn-outline" onClick={handleExportCSV}
            title={t('job-assignment.export_csv', 'Export CSV')} aria-label={t('job-assignment.export_csv', 'Export CSV')}
            style={{ minHeight: 44, minWidth: 44 }}>
            <Download width={16} height={16} />
          </button>
          <button className="module-btn module-btn-outline" onClick={handlePrint}
            title={t('job-assignment.print', 'Print Report')} aria-label={t('job-assignment.print', 'Print Report')}
            style={{ minHeight: 44, minWidth: 44 }}>
            <Printer width={16} height={16} />
          </button>
          <button className="module-btn module-btn-outline" onClick={fetchBoard} title="Refresh (R)" style={{ minHeight: 44 }}>
            <Refresh width={16} height={16} /> {t('job-assignment.refresh')}
          </button>
        </div>
      </div>

      {/* ── Stats Strip ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16,
      }}>
        {[
          { label: t('job-assignment.stats_total'), value: (board.unassigned?.length || 0) + (board.active_deliveries?.length || 0), color: '#6366f1', bg: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', icon: <PasteClipboard width={20} height={20} color="#6366f1" /> },
          { label: t('job-assignment.stats_unassigned'), value: board.unassigned?.length || 0, color: '#b45309', bg: 'linear-gradient(135deg, #fffbeb, #fef3c7)', icon: <Clock width={20} height={20} color="#b45309" /> },
          { label: t('job-assignment.stats_active'), value: board.active_deliveries?.length || 0, color: '#1d4ed8', bg: 'linear-gradient(135deg, #eff6ff, #dbeafe)', icon: <Wrench width={20} height={20} color="#1d4ed8" /> },
          { label: t('job-assignment.stats_mechanics'), value: board.available_mechanics?.length || 0, color: '#15803d', bg: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', icon: <User width={20} height={20} color="#15803d" /> },
          { label: t('jobAssignment.closed_today', 'Closed today'), value: board.completed_today?.length || 0, color: '#15803d', bg: 'linear-gradient(135deg, #f0fdf4, #bbf7d0)', icon: <Check width={20} height={20} color="#15803d" /> },
        ].map(s => (
          <div key={s.label} style={{
            background: s.bg, borderRadius: 14, padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 12, minWidth: 0,
            border: '1px solid rgba(0,0,0,0.04)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}>{s.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2, overflowWrap: 'anywhere' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>


      {/* ── Search / Filter Bar ── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 16px', marginBottom: 16,
        background: '#fff', borderRadius: '0 0 14px 14px',
        border: '1px solid #e2e8f0', borderTop: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
      }}>
        <div style={{ flex: '1 1 240px', minWidth: 0, position: 'relative' }}>
          <Search width={16} height={16} style={{
            position: 'absolute', insetInlineStart: 14, top: '50%', transform: 'translateY(-50%)',
            color: '#94a3b8', pointerEvents: 'none',
          }} />
          <input
            type="text"
            placeholder={t('job-assignment.search_placeholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && searchQuery.trim()) {
                // A typed or pasted job card number, plate, VIN or status link
                handleJobScan(searchQuery.trim());
              }
            }}
            style={{
              width: '100%', boxSizing: 'border-box', paddingBlock: 11, paddingInline: 40, minHeight: 44, borderRadius: 12,
              border: `2px solid ${searchFocused ? '#3b82f6' : '#e2e8f0'}`, fontSize: 14, fontWeight: 500,
              outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
              background: searchFocused ? '#fff' : '#f8fafc',
              boxShadow: searchFocused ? '0 0 0 3px rgba(59,130,246,0.1)' : 'none',
            }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} aria-label={t('common.clear', 'Clear')} style={{
              position: 'absolute', insetInlineEnd: 6, top: '50%', transform: 'translateY(-50%)',
              background: '#f1f5f9', border: 'none', borderRadius: 6, width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#64748b',
            }}>
              <Xmark width={14} height={14} />
            </button>
          )}
        </div>
        <button onClick={() => setShowScanner('barcode')} style={{
          minHeight: 44, padding: '11px 18px', borderRadius: 12, border: '2px solid #e2e8f0',
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
          minHeight: 44, padding: '11px 16px', borderRadius: 12, border: '2px solid #e2e8f0',
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
          style={{ minHeight: 44 }}
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
              {BOARD_STATUS_KEYS.map(key => (
                <option key={key} value={key}>{woLabel(t, STATUS_OF_KEY[key])}</option>
              ))}
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
              <option value="promised">{t('jobAssignment.sort_promised', 'Promised date')}</option>
              <option value="bay">{t('job-assignment.filter.sort.bay', 'ServiceBay')}</option>
              <option value="status">{t('job-assignment.filter.sort.status', 'Status')}</option>
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
          {filterStatus && <span className="job-assignment-active-tag">{t('job-assignment.filter.status', 'Status')}: {woLabel(t, STATUS_OF_KEY[filterStatus])}</span>}
          {filterZone && <span className="job-assignment-active-tag">{t('job-assignment.filter.bay', 'ServiceBay')}: {filterZone}</span>}
          {filterDate && <span className="job-assignment-active-tag">{t('job-assignment.filter.date', 'Date')}: {filterDate === 'custom' ? `${filterDateFrom || '…'} → ${filterDateTo || '…'}` : filterDate}</span>}
          {sortBy && <span className="job-assignment-active-tag">{t('job-assignment.filter.sort_by', 'Sort')}: {({
            date: t('job-assignment.filter.sort.date', 'Created Date'),
            promised: t('jobAssignment.sort_promised', 'Promised date'),
            bay: t('job-assignment.filter.sort.bay', 'ServiceBay'),
            status: t('job-assignment.filter.sort.status', 'Status'),
          })[sortBy] || sortBy} {sortDir === 'desc' ? '↓' : '↑'}</span>}
          <span style={{ color: '#64748b', fontWeight: 500 }}>
            — {`${filteredUnassigned.length + filteredActive.length} ${t('job-assignment.results_found')}`}
          </span>
          <button onClick={clearAllFilters} style={{
            marginInlineStart: 'auto', padding: '3px 10px', borderRadius: 6,
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
        onScan={(val) => { handleJobScan(val); setShowScanner(false); }}
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
      {canAssign && selectedWorkOrders.size > 0 && (
        <div className="assign-panel">
          <div className="assign-panel-label">
            <PasteClipboard width={16} height={16} />
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
      ) : (
        /* ═══════ BOARD VIEW ═══════ */
        <div className="job-assignment-board">
          {/* Unassigned */}
          <div className="job-assignment-col">
            <div className="job-assignment-col-header">
              <div className="col-dot" style={{ background: '#f59e0b' }} />
              <h3>{t('job-assignment.col.unassigned')}</h3>
              <span className="col-count amber">{filteredUnassigned.length}</span>
              {canAssign && filteredUnassigned.length > 0 && (
                <>
                <button
                  onClick={() => {
                    const allIds = filteredUnassigned.map(o => o.id);
                    const allSelected = allIds.every(id => selectedWorkOrders.has(id));
                    setSelectedWorkOrders(allSelected ? new Set() : new Set(allIds));
                  }}
                  style={{
                    marginInlineStart: 'auto', minHeight: 36, padding: '4px 10px', borderRadius: 8,
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
                  title="Auto-assign all unassigned job cards (Shift+A)"
                  style={{
                    minHeight: 36, padding: '5px 12px', borderRadius: 8, border: 'none',
                    background: autoAssignAll ? '#e0e7ff' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                    color: autoAssignAll ? '#6366f1' : '#fff',
                    fontWeight: 700, fontSize: 11, cursor: autoAssignAll ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5, transition: 'all .2s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <User width={13} height={13} />
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontWeight: 600, color: '#475569', fontSize: 11 }}>
                      {t('jobAssignment.cfg.max_jobs', 'Most open jobs per technician')}
                    </span>
                    <input
                      type="number" min={1} max={50}
                      value={autoAssignCfg.max_work_orders_per_mechanic}
                      onChange={e => setAutoAssignCfg(c => ({ ...c, max_work_orders_per_mechanic: e.target.value }))}
                      style={{ minHeight: 40, padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontWeight: 600, color: '#475569', fontSize: 11 }}>
                      {t('jobAssignment.cfg.min_rating', 'Lowest technician rating (0 = off)')}
                    </span>
                    <input
                      type="number" min={0} max={5} step={0.1}
                      value={autoAssignCfg.min_mechanic_rating}
                      onChange={e => setAutoAssignCfg(c => ({ ...c, min_mechanic_rating: e.target.value }))}
                      style={{ minHeight: 40, padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, gridColumn: '1 / -1' }}>
                    <input
                      type="checkbox"
                      checked={!!autoAssignCfg.enforce_specialty_match}
                      onChange={e => setAutoAssignCfg(c => ({ ...c, enforce_specialty_match: e.target.checked }))}
                      style={{ width: 18, height: 18 }}
                    />
                    <span style={{ fontWeight: 600, color: '#475569', fontSize: 11 }}>
                      {t('jobAssignment.cfg.trade_match', "Only suggest technicians whose trade matches the job's service category")}
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
                      marginInlineStart: 'auto', padding: '6px 10px', borderRadius: 8,
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
                    <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                      {autoAssignResult.skipped.slice(0, 20).map(s => (
                        <li key={s.work_order_id}>
                          {s.work_order_number} — {t(`jobAssignment.skip_reason.${s.reason}`, SKIP_REASONS[s.reason] || s.reason)}
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
                      width:'calc(100% - 20px)', minHeight:44, margin:'8px 10px 12px', padding:'8px 0', borderRadius:8,
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
                      width:'calc(100% - 20px)', minHeight:44, margin:'8px 10px 12px', padding:'8px 0', borderRadius:8,
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
                <Search width={14} height={14} style={{ position:'absolute', insetInlineStart:10, top:'50%', transform:'translateY(-50%)', color:'#94a3b8', pointerEvents:'none' }} />
                <input
                  type="text"
                  value={mechanicSearch}
                  onChange={e => setMechanicSearch(e.target.value)}
                  placeholder={t('job-assignment.search_mechanics', 'Search mechanics...')}
                  style={{ width:'100%', boxSizing:'border-box', minHeight:40, paddingBlock:7, paddingInlineStart:30, paddingInlineEnd:10, borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, outline:'none', background:'#f8fafc', transition:'border-color .2s' }}
                  onFocus={e => e.target.style.borderColor = '#1e3a6b'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                />
                {mechanicSearch && (
                  <button onClick={() => setMechanicSearch('')} aria-label={t('common.clear', 'Clear')} style={{ position:'absolute', insetInlineEnd:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', padding:0, color:'#94a3b8', display:'flex' }}>
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
                      || tradeOf(d).toLowerCase().includes(q)
                      || (d.service_bay_name || '').toLowerCase().includes(q)
                      || (d.phone || '').includes(q);
                  })
                : (board.available_mechanics || []);
              if (filteredMechanics.length === 0) {
                return <div className="empty-col">{mechanicSearch ? t('job-assignment.no_mechanics_match', 'No mechanics match') : t('job-assignment.no_mechanics')}</div>;
              }
              return filteredMechanics.map(mechanic => {
                const load = activeJobs(mechanic);
                return (
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
                    <div className="mechanic-meta" style={{ textTransform: 'capitalize' }}>
                      {[tradeOf(mechanic), mechanic.service_bay_name].filter(Boolean).join(' • ') || mechanic.phone}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className="status-badge" style={{ background: '#f0fdf4', color: '#15803d' }}>{t('mechanics.status.available', 'Available')}</span>
                    <span className="mechanic-workload" style={{
                      background: load >= 5 ? '#fef2f2' : load >= 3 ? '#fef3c7' : '#f0fdf4',
                      color: load >= 5 ? '#991b1b' : load >= 3 ? '#92400e' : '#166534',
                      border: `1px solid ${load >= 5 ? '#fecaca' : load >= 3 ? '#fde68a' : '#bbf7d0'}`,
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                    }}>
                      <Wrench width={10} height={10} />
                      {t('jobAssignment.jobs_open', '{{count}} open', { count: load })}
                    </span>
                  </div>
                </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ═══════ COMPLETED TODAY SECTION ═══════ */}
      {(board.completed_today?.length > 0) && (
        <div style={{ marginTop: 20 }}>
          <button
            onClick={() => setShowCompleted(c => !c)}
            aria-expanded={showCompleted}
            style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, width: '100%', minHeight: 48,
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
            {t('jobAssignment.closed_today', 'Closed today')}
            <span style={{
              padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800,
              background: '#dcfce7', color: '#166534', marginInlineStart: 4,
            }}>
              {board.completed_today.length}
            </span>
            <span style={{ marginInlineStart: 'auto', fontSize: 11, color: '#64748b', fontWeight: 500 }}>
              {(() => {
                const ct = board.completed_today;
                const closed = ct.filter(o => o.status === 'completed').length;
                const cancelled = ct.filter(o => o.status === 'cancelled').length;
                const parts = [];
                if (closed) parts.push(`${closed} ${woLabel(t, 'completed').toLowerCase()}`);
                if (cancelled) parts.push(`${cancelled} ${woLabel(t, 'cancelled').toLowerCase()}`);
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 10 }}>
                {board.completed_today.map(o => {
                  const isCompleted = o.status === 'completed';
                  const tone = woTone(o);
                  const statusColor = tone.color;
                  const statusBg = tone.bg;
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
                            {jcNo(o)}
                          </span>
                          <span style={{
                            padding: '1px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                            background: statusBg, color: statusColor, border: `1px solid ${statusColor}22`,
                          }}>
                            {woLabel(t, o, 'short')}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {jobLine(o) || '—'}
                          {o.service_bay_name && <span> · {o.service_bay_name}</span>}
                        </div>
                      </div>
                      {/* Technician & time */}
                      <div style={{ textAlign: 'end', flexShrink: 0 }}>
                        {o.mechanic_name && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{o.mechanic_name}</div>
                        )}
                        {completedAt && (
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
                            {completedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
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


      {/* ═══════════ JOB CARD DRAWER ═══════════ */}
      {drawer && (() => {
        // The board row (main job card number, work lines) under the full
        // work order from GET /work-orders/:id (VIN, odometer, phone, lines).
        const jc = drawerFull ? { ...drawer, ...drawerFull } : drawer;
        const tone = woTone(jc);
        const statusLink = customerStatusUrl(jc);
        const customerPhone = jc.customer_phone || jc.customer_phone_ref;
        const CL = {
          internal: t('customers.class.internal', 'Internal'), external: t('customers.class.external', 'External'),
          fleet: t('customers.class.fleet', 'Fleet'), insurance: t('customers.class.insurance', 'Insurance'),
          asset: t('customers.class.asset', 'Asset'), walkin: t('customers.class.walkin', 'Walk-in'),
        };
        const classification = [CL[jc.intake_customer_class], CL[jc.intake_customer_subcategory]].filter(Boolean).join(' · ');
        const lines = jc.items || [];
        const sectionTitle = { fontWeight: 700, fontSize: 10, marginBottom: 8, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5, textTransform: 'uppercase', letterSpacing: '0.06em' };
        const box = { background: '#fff', borderRadius: 12, padding: '12px 14px', border: '1px solid #e2e8f0', marginBottom: 14 };
        const Row = ({ label, value, mono }) => (value || value === 0) ? (
          <div style={{ padding: '4px 0', minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', overflowWrap: 'anywhere', fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
          </div>
        ) : null;
        const actions = [
          { key: 'sheet', label: t('jobAssignment.drawer.job_sheet', 'Job sheet'), icon: Printer, bg: '#6d28d9', onClick: () => printJobSheet(jc.id) },
          ...(statusLink ? [
            { key: 'status', label: t('jobAssignment.drawer.status_page', 'Customer status page'), icon: OpenNewWindow, bg: '#0369a1', onClick: () => window.open(statusLink, '_blank', 'noopener') },
            { key: 'copy', label: copiedToken ? t('orders.drawer.copied', 'Copied!') : t('orders.drawer.copy_link', 'Copy customer link'), icon: Copy, bg: '#334155', onClick: () => copyCustomerLink(jc) },
          ] : []),
          ...(customerPhone ? [
            { key: 'wa', label: t('jobAssignment.drawer.whatsapp', 'WhatsApp the customer'), icon: null, bg: '#15803d',
              onClick: () => sendStatusWhatsApp({ t, wo: jc, workshopName: workshop?.name, dialCode }) },
          ] : []),
          { key: 'open', label: t('jobAssignment.drawer.open_job_card', 'Open job card'), icon: ArrowRight, bg: '#1e3a6b', onClick: () => { closeDrawer(); navigate(`/work-orders/${jc.id}`); } },
        ];
        return (
        <>
          <div onClick={closeDrawer}
            style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', zIndex:9990, backdropFilter:'blur(4px)' }} />
          <div role="dialog" aria-modal="true" aria-label={jcNo(jc)}
            style={{ position:'fixed', insetBlock:0, insetInlineEnd:0, width:'min(520px, 100vw)',
            background:'#ffffff', zIndex:9991, overflowY:'auto',
            boxShadow:'0 0 50px rgba(0,0,0,0.18)', display:'flex', flexDirection:'column' }}>

            {/* ── Header ── */}
            <div style={{ background:'linear-gradient(135deg,#0f172a,#1e293b)', padding:'22px 16px 20px', position:'relative' }}>
              <button onClick={closeDrawer} aria-label={t('common.close', 'Close')}
                style={{ position:'absolute', top:12, insetInlineEnd:12, background:'rgba(255,255,255,0.12)',
                  border:'none', color:'#fff', width:44, height:44, borderRadius:10,
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Xmark width={18} height={18} />
              </button>

              {/* Job card number, then the work order number */}
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14, paddingInlineEnd:52 }}>
                <div style={{ width:44, height:44, borderRadius:12,
                  background:'linear-gradient(135deg,#3b82f6,#2563eb)',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <PasteClipboard width={22} height={22} color="#fff" />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:'#fff', fontWeight:800, fontSize:18, letterSpacing:'-0.3px', overflowWrap:'anywhere' }}>{jcNo(jc)}</div>
                  {jc.main_job_card_number && jc.work_order_number && (
                    <div style={{ color:'#cbd5e1', fontSize:11, fontFamily:'monospace', marginTop:3 }}>{jc.work_order_number}</div>
                  )}
                </div>
              </div>

              <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:20,
                background:tone.bg, color:tone.color, fontWeight:700, fontSize:12 }}>
                <tone.icon width={12} height={12} /> {woLabel(t, jc)}
              </span>

              {/* Actions */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:14 }}>
                {actions.map(a => (
                  <button key={a.key} onClick={a.onClick} title={a.label}
                    style={{ minHeight:44, padding:'8px 12px', borderRadius:10, border:'none', background:a.bg, color:'#fff',
                      cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6, fontSize:12, fontWeight:700 }}>
                    {a.icon ? <a.icon width={15} height={15} /> : <WhatsAppIconSvg size={15} color="#fff" />}
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Body ── */}
            <div style={{ padding:'18px 16px', flex:1 }}>
              {drawerLoading ? (
                <div style={{ textAlign:'center', padding:60, color:'#64748b' }}>
                  <div style={{ width:32, height:32, border:'3px solid #e2e8f0', borderTopColor:'#3b82f6',
                    borderRadius:'50%', margin:'0 auto 12px', animation:'spin 0.8s linear infinite' }} />
                  {t('jobAssignment.drawer.loading', 'Loading the job card…')}
                </div>
              ) : (
                <>
                  {/* Customer and classification */}
                  <div style={box}>
                    <div style={sectionTitle}><User width={12} height={12} color="#3b82f6" /> {t('jobAssignment.drawer.customer', 'Customer')}</div>
                    <div style={{ fontWeight:700, fontSize:13, color:'#0f172a' }}>
                      {jc.customer_name || jc.customer_name_ref || t('orders.walk_in', 'Walk-in')}
                    </div>
                    {jc.company_name && <div style={{ fontSize:11, color:'#64748b' }}>{jc.company_name}</div>}
                    {customerPhone && (
                      <a href={`tel:${customerPhone}`} style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:12, color:'#1d4ed8', textDecoration:'none', marginTop:4, minHeight:32 }}>
                        <Phone width={12} height={12} /> {customerPhone}
                      </a>
                    )}
                    {classification && (
                      <div style={{ marginTop:6 }}>
                        <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'#e0e7ff', color:'#3730a3' }}>{classification}</span>
                      </div>
                    )}
                  </div>

                  {/* Vehicle */}
                  <div style={box}>
                    <div style={sectionTitle}><Car width={12} height={12} color="#0369a1" /> {t('jobAssignment.drawer.vehicle', 'Vehicle')}</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:'6px 16px' }}>
                      <Row label={t('jobAssignment.drawer.make_model', 'Make & model')} value={[jc.vehicle_make, jc.vehicle_model, jc.vehicle_year].filter(Boolean).join(' ')} />
                      <Row label={t('jobAssignment.col.plate', 'Plate')} value={jc.vehicle_plate_number} mono />
                      <Row label={t('jobAssignment.drawer.vin', 'VIN')} value={jc.vehicle_vin} mono />
                      <Row label={t('jobAssignment.drawer.odometer', 'Odometer')} value={jc.odometer_in ? `${Number(jc.odometer_in).toLocaleString()} km` : null} />
                    </div>
                  </div>

                  {/* Reported issue */}
                  {jc.description && (
                    <div style={box}>
                      <div style={sectionTitle}><Notes width={12} height={12} color="#b45309" /> {t('jobAssignment.drawer.reported_issue', 'Reported issue')}</div>
                      <div style={{ fontSize:13, color:'#1e293b', whiteSpace:'pre-wrap', overflowWrap:'anywhere' }}>{jc.description}</div>
                    </div>
                  )}

                  {/* Approved work */}
                  <div style={box}>
                    <div style={sectionTitle}><Wrench width={12} height={12} color="#6d28d9" /> {t('jobAssignment.drawer.approved_work', 'Approved work')}</div>
                    {lines.length === 0 ? (
                      <div style={{ fontSize:12, color:'#64748b' }}>{t('jobAssignment.drawer.no_lines', 'No work lines on this job card yet.')}</div>
                    ) : lines.map((line, i) => (
                      <div key={line.id || i} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'6px 0',
                        borderBottom: i < lines.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                        <span style={{ minWidth:28, fontSize:11, fontWeight:800, color:'#6d28d9' }}>{Number(line.quantity) > 0 ? `${Number(line.quantity)}×` : '•'}</span>
                        <span style={{ flex:1, fontSize:12, fontWeight:600, color:'#1e293b', overflowWrap:'anywhere' }}>{line.name}</span>
                        {line.item_type && <span style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'capitalize' }}>{String(line.item_type).replace(/_/g, ' ')}</span>}
                      </div>
                    ))}
                  </div>

                  {/* Parts on this job card */}
                  {drawerPackages.length > 0 && (
                    <div style={{ ...box, padding:0, overflow:'hidden' }}>
                      <div style={{ padding:'12px 14px', borderBottom:'1px solid #f1f5f9',
                        display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                        <span style={{ ...sectionTitle, marginBottom:0 }}>
                          <Package width={12} height={12} color="#6366f1" /> {t('orders.drawer.parts', 'Parts')}
                        </span>
                        <span style={{ fontSize:10, fontWeight:700, color:'#4338ca',
                          background:'#eef2ff', padding:'2px 8px', borderRadius:10 }}>
                          {t('jobAssignment.drawer.parts_installed', '{{done}}/{{total}} installed', { done: drawerPackages.filter(p => p.status === 'installed').length, total: drawerPackages.length })}
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
                                <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:6, marginBottom:2 }}>
                                  <span style={{ fontWeight:600, fontSize:12, color:'#1e293b' }}>{part.name}</span>
                                  <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:8,
                                    background:ps.bg, color:ps.color }}>{ps.label}</span>
                                </div>
                                {part.part_number && (
                                  <span style={{ fontSize:10, fontWeight:700, padding:'1px 5px', borderRadius:4, background:'#eff6ff', color:'#1d4ed8' }}>
                                    #{part.part_number}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Who and when */}
                  <div style={box}>
                    <div style={sectionTitle}><Calendar width={12} height={12} color="#15803d" /> {t('jobAssignment.drawer.job', 'Job')}</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:'6px 16px' }}>
                      <Row label={t('jobAssignment.col.technician', 'Technician')} value={jc.mechanic_name || t('jobAssignment.drawer.not_assigned', 'Not assigned yet')} />
                      <Row label={t('orders.drawer.bay', 'Service Bay')} value={jc.service_bay_name} />
                      <Row label={t('jobAssignment.col.promised', 'Promised')} value={fmtDayTime(jc.estimated_completion_at) || t('jobAssignment.drawer.no_promised', 'Not set')} />
                      <Row label={t('jobAssignment.drawer.booked', 'Booked for')} value={fmtDayTime(jc.scheduled_at)} />
                      <Row label={t('jobAssignment.drawer.approved_at', 'Customer approved')} value={fmtDayTime(jc.customer_approved_at)} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
        );
      })()}
    </div>
  );
}
