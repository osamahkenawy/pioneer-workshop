import { useState, useEffect, useCallback, useRef, useMemo, useContext } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Package, Plus, Search, EditPencil, Trash, Eye, DeliveryTruck,
  Check, Xmark, NavArrowRight, NavArrowLeft, Filter, Copy, Mail,
  Clock, MapPin, User, Phone, Building, Download, ArrowRight,
  WarningTriangle, CheckCircle, StatsUpSquare, Wallet,
  DollarCircle, Calendar, Box3dPoint, Hashtag,
  CreditCard, Weight, Prohibition, Refresh, Group, OpenNewWindow, ShareAndroid,
  ScanBarcode, Printer, Wrench, SendMail,
} from 'iconoir-react';
import api from '../lib/api';
import { TableSkeleton } from '../components/Loader';
import usePlanUsage, { dispatchPlanUpdate } from '../hooks/usePlanUsage';
import UpgradeModal from '../components/dashboard/UpgradeModal';
import NewWorkOrderModal from '../components/NewWorkOrderModal';
import NewEstimateModal from '../components/NewEstimateModal';
import PhoneInput, { getPhoneCodeForCountry } from '../components/PhoneInput';
import JsBarcode from 'jsbarcode';
import Toast, { useToast } from '../components/Toast';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AuthContext } from '../context/AuthContext';
import { fmtCurrency } from '../utils/currency';
import { getRegions, getRegionLabel } from '../lib/regions';
import { downloadCsv, toCsv, csvCell } from '../utils/csv';

/* Fix leaflet marker icon paths (Vite) */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/* ══════════════════════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════════════════════ */
const STATUS_META = {
  // Additive — the new first state for a job card born from an approved
  // estimate (routes/estimates.js). The full pending/confirmed/assigned/
  // accepted rename is a separate, deliberately-deferred migration; see
  // 20260914_work_order_status_rename_widen.sql on the backend.
  estimate_approved: { label:'Estimate Approved', bg:'#eef2ff', color:'#4f46e5', icon: Check },
  pending:          { label:'Pending',          bg:'#fef3c7', color:'#d97706', icon: Clock },
  confirmed:        { label:'Confirmed',        bg:'#dbeafe', color:'#2563eb', icon: Check },
  assigned:         { label:'Assigned',         bg:'#ede9fe', color:'#7c3aed', icon: User },
  accepted:         { label:'Accepted',         bg:'#e0e7ff', color:'#1565C0', icon: Check },
  in_progress:      { label:'In Progress',      bg:'#cffafe', color:'#0e7490', icon: Wrench },
  inspection:       { label:'Inspection',       bg:'#ede9fe', color:'#7c3aed', icon: Eye },
  ready_for_pickup: { label:'Ready for Pickup', bg:'#ffedd5', color:'#c2410c', icon: Package },
  completed:        { label:'Completed',        bg:'#dcfce7', color:'#16a34a', icon: CheckCircle },
  cancelled:        { label:'Cancelled',        bg:'#f1f5f9', color:'#64748b', icon: Prohibition },
};
const ORDER_TYPES   = ['standard','express','same_day','scheduled','return'];
// Valid status transitions — mirrors backend VALID_TRANSITIONS
const VALID_TRANSITIONS_FRONTEND = {
  estimate_approved: ['confirmed', 'cancelled'],
  pending:          ['confirmed', 'cancelled'],
  confirmed:        ['assigned', 'in_progress', 'cancelled'],
  assigned:         ['accepted', 'in_progress', 'cancelled', 'confirmed'],
  accepted:         ['in_progress', 'cancelled', 'assigned'],
  in_progress:      ['inspection', 'ready_for_pickup', 'cancelled'],
  inspection:       ['ready_for_pickup', 'in_progress', 'cancelled'],
  ready_for_pickup: ['completed', 'cancelled'],
  completed:        [],
  cancelled:        ['pending'],
};
// EMIRATES removed — now using getRegions(workshop.country) from lib/regions.js
// Fallback used only before categories are fetched from settings
const DEFAULT_CATEGORIES = [
  { slug:'parcel',      name:'Parcel',      name_ar:'طرد' },
  { slug:'document',   name:'Document',    name_ar:'وثيقة' },
  { slug:'food',       name:'Food',        name_ar:'طعام' },
  { slug:'grocery',    name:'Grocery',     name_ar:'بقالة' },
  { slug:'medicine',   name:'Medicine',    name_ar:'دواء' },
  { slug:'electronics',name:'Electronics', name_ar:'إلكترونيات' },
  { slug:'fragile',    name:'Fragile',     name_ar:'هشّ' },
  { slug:'other',      name:'Other',       name_ar:'أخرى' },
];
const PAYMENT_MAP   = { cod:'Cash on Delivery', prepaid:'Prepaid', credit:'Credit', wallet:'Wallet' };
const INPUT  = { width:'100%', padding:'10px 13px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:14, boxSizing:'border-box', outline:'none' };
const LABEL  = { display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.04em' };
const LIMIT  = 10;

const STEPS = [
  { num:1, titleKey:'orders.form.step1_title', descKey:'orders.form.step1_desc' },
  { num:2, titleKey:'orders.form.step2_title', descKey:'orders.form.step2_desc' },
  { num:3, titleKey:'orders.form.step3_title', descKey:'orders.form.step3_desc' },
  { num:4, titleKey:'orders.form.step4_title', descKey:'orders.form.step4_desc' },
];

const EMPTY_PKG = {
  category:'parcel', weight_kg:'', dimensions:'', cash_amount:'',
  description:'', special_instructions:'',
};

const ADDRESS_TYPES = ['building','villa','compound','office','warehouse','other'];

const EMPTY_STOP = {
  recipient_name:'', recipient_phone:'', recipient_email:'',
  phone_code:'+971',
  recipient_address:'', recipient_area:'', recipient_emirate:'',
  address_type:'', building_name:'', floor_number:'', flat_number:'',
  recipient_lat:'', recipient_lng:'', service_bay_id:'',
  work_order_type:'standard', service_fee:'', scheduled_at:'',
  payment_method:'cod', discount:'',
  _mapOpen:false,
  packages:[{ ...EMPTY_PKG }],
};

const EMPTY_FORM = {
  sender_type:'customer', // 'customer' | 'business'
  customer_id:'', sender_name:'', sender_phone:'', sender_address:'',
  sender_lat:'', sender_lng:'',
  payment_method:'cod', discount:'', internal_notes:'',
  pickup_notes:'',
  pregenerated_token:'',
};

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */
const fmtDate = (d, language = 'en') => d ? new Date(d).toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-AE',{day:'2-digit',month:'short',year:'numeric'}) : '\u2014';
const fmtTime = (d, language = 'en') => d ? new Date(d).toLocaleTimeString(language === 'ar' ? 'ar-AE' : 'en-AE',{hour:'2-digit',minute:'2-digit'}) : '';
const fmtType = t => t ? t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : '\u2014';

/* Parse a notes column that may hold either freeform text or the JSON payload
   the Oracle migration stamps on every work order. Internal keys hidden. */
const NOTES_HIDDEN_KEYS = new Set(['src', 'src_id', 'batch']);
const NOTES_LABEL_OVERRIDES = {
  loc:        'Location',
  job_type:   'Job Type',
  svc_type:   'Service Type',
  operator:   'Operator',
  salesman:   'Salesman',
  inv:        'Invoice #',
  party_code: 'Account Code',
  opening_km: 'Opening KM',
  kind:       'Kind',
};
function parseSrcNotes(raw) {
  if (raw === null || raw === undefined || raw === '') return { kind: 'empty' };
  if (typeof raw !== 'string') return { kind: 'text', text: String(raw) };
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { kind: 'text', text: raw };
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'text', text: raw };
    const entries = Object.entries(parsed)
      .filter(([k, v]) => !NOTES_HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== '')
      .map(([k, v]) => [NOTES_LABEL_OVERRIDES[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    return { kind: 'json', entries, source: parsed.src || null };
  } catch {
    return { kind: 'text', text: raw };
  }
}

/* ── WhatsApp helpers ── */
const WhatsAppIcon = ({ size = 14, color = '#25D366' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink:0 }}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const formatPhoneForWA = (phone) => {
  if (!phone) return '';
  let digits = phone.replace(/[^0-9]/g, '');
  // UAE: if starts with 0, replace with 971
  if (digits.startsWith('0')) digits = '971' + digits.slice(1);
  // If no country code prefix, assume UAE (971)
  if (digits.length <= 10 && !digits.startsWith('971')) digits = '971' + digits;
  return digits;
};

/**
 * The WhatsApp message a customer receives about their job.
 *
 * Rewritten from the delivery-platform version, which addressed a parcel
 * recipient and read order.recipient_name, recipient_address, recipient_area
 * and recipient_emirate. None of those columns exist on work_orders — they are
 * customer_name and dropoff_address — so all four lines evaluated to undefined
 * and were dropped by the filter at the end. Every message went out with no
 * name and no address on it.
 *
 * The vehicle and the total are what a workshop customer wants read back to
 * them, so they take the place of the parcel fields.
 */
const buildWAServiceMessage = (order, trackingUrl, currency = 'AED') => {
  // The list endpoint aliases these as vehicle_*; the single-order and label
  // endpoints return the bare column names. Accept both, so the vehicle line
  // renders wherever the message is built from.
  const make = order.vehicle_make || order.make;
  const model = order.vehicle_model || order.model;
  const plateNo = order.vehicle_plate_number || order.plate_number;
  const vehicle = [make, model].filter(Boolean).join(' ');
  const plate = plateNo ? ' · ' + plateNo : '';
  // total_amount is the figure on the invoice, service_fee the fallback.
  // 0.00 is not null, so each has to be tested rather than COALESCEd.
  const total = Number(order.total_amount) || Number(order.service_fee) || 0;

  const lines = [
    '🔧 *Service Update*',
    '',
    'Job: *#' + (order.work_order_number || order.id) + '*',
    order.customer_name ? 'Customer: ' + order.customer_name : null,
    vehicle ? '🚗 Vehicle: ' + vehicle + plate : null,
    // service_category is a snake_case enum; a customer should not be sent
    // "engine_repair".
    order.service_category
      ? '🛠 Service: ' + String(order.service_category).replace(/_/g, ' ')
          .replace(/^./, ch => ch.toUpperCase())
      : null,
    order.dropoff_address ? '📍 ' + order.dropoff_address : null,
    total > 0 ? '💰 Total Cost: ' + currency + ' ' + total.toFixed(2) : null,
    order.cash_amount > 0
      ? '💵 Cash to collect: ' + currency + ' ' + parseFloat(order.cash_amount).toFixed(2)
      : null,
    order.scheduled_at
      ? '📅 Booked: ' + new Date(order.scheduled_at).toLocaleString('en-AE')
      : null,
    '',
    trackingUrl ? '🔗 Track your service:\n' + trackingUrl : null,
    '',
    'Thank you! 🙏',
  ];
  return lines.filter(l => l !== null).join('\n');
};

const openWhatsApp = (phone, message) => {
  const waPhone = formatPhoneForWA(phone);
  const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
};

const WhatsAppButton = ({ phone, order, style = {}, size = 'normal', trackingUrl, currency = 'AED' }) => {
  if (!phone) return null;
  const url = trackingUrl || (order?.service_status_token ? `${window.location.origin}/track/${order.service_status_token}` : '');
  const msg = buildWAServiceMessage(order || {}, url, currency);
  const isSmall = size === 'small';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); openWhatsApp(phone, msg); }}
      title="Share via WhatsApp"
      style={{
        padding: isSmall ? '3px 6px' : '5px 9px',
        borderRadius: 8,
        border: '1px solid #25D366',
        background: '#f0fdf4',
        color: '#25D366',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: isSmall ? 10 : 11,
        fontWeight: 700,
        transition: 'all 0.15s',
        ...style,
      }}
      onMouseOver={e => { e.currentTarget.style.background = '#25D366'; e.currentTarget.style.color = '#fff'; }}
      onMouseOut={e => { e.currentTarget.style.background = '#f0fdf4'; e.currentTarget.style.color = '#25D366'; }}
    >
      <WhatsAppIcon size={isSmall ? 12 : 14} color="currentColor" />
      {!isSmall && <span>WhatsApp</span>}
    </button>
  );
};

/* ══════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ══════════════════════════════════════════════════════════════ */
function Avatar({ name, size = 44 }) {
  const initials = name?.split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()).join('') || '?';
  const hue = (name?.charCodeAt(0)||0) % 360;
  return (
    <div style={{ width:size, height:size, borderRadius:'50%',
      background:`hsl(${hue},55%,46%)`, color:'#fff', fontWeight:700,
      fontSize:size*0.36, flexShrink:0,
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      {initials}
    </div>
  );
}

function KPICard({ icon: Icon, label, value, sub, color }) {
  return (
    <div style={{ background:'#fff', borderRadius:16, padding:'16px 18px', flex:1, minWidth:0,
      boxShadow:'0 1px 4px rgba(0,0,0,0.08)', borderTop:`3px solid ${color}` }}>
      <div style={{ width:34, height:34, borderRadius:10, background:color+'18',
        display:'flex', alignItems:'center', justifyContent:'center', marginBottom:10 }}>
        <Icon width={18} height={18} color={color} strokeWidth={1.8} />
      </div>
      <div style={{ fontSize:24, fontWeight:900, color:'#1e293b', lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:12, color:'#64748b', marginTop:4, fontWeight:500 }}>{label}</div>
      {sub && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function StatusPill({ status }) {
  const { t } = useTranslation();
  const m = STATUS_META[status] || STATUS_META.pending;
  const Icon = m.icon;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px',
      borderRadius:20, fontSize:12, fontWeight:700, background:m.bg, color:m.color }}>
      <Icon width={12} height={12} />{t(`orders.status.${status}`)}
    </span>
  );
}

/* ── WorkOrder Number Tooltip ── */
function OrderNumCell({ orderNumber, trackingToken, onCopyToken, copied }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [show, setShow] = useState(false);
  const displayNum = orderNumber ? orderNumber.substring(0, 5) + (orderNumber.length > 5 ? '…' : '') : '—';
  const [justCopied, setJustCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(orderNumber).then(() => {
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    });
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}>
      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 14, cursor: 'default', letterSpacing: '.02em' }}>
        {displayNum}
      </div>
      {show && (
        <div style={{
          position: 'absolute', [isRTL?'right':'left']: 0, top: '110%', zIndex: 9999,
          background: '#1e293b', color: '#fff', borderRadius: 10,
          padding: '10px 14px', minWidth: 230, boxShadow: '0 8px 24px rgba(0,0,0,.22)',
          pointerEvents: 'all',
        }}
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}>
          {/* Arrow */}
          <div style={{ position: 'absolute', top: -7, [isRTL?'right':'left']: 14, width: 14, height: 14, background: '#1e293b', transform: 'rotate(45deg)', borderRadius: 2 }} />
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>{t('orders.tooltip.work_order_number')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: 'monospace', fontSize: 14, fontWeight: 700, letterSpacing: '.03em',
              color: '#f97316', userSelect: 'all', cursor: 'text',
            }}>{orderNumber}</span>
            <button
              onClick={handleCopy}
              title="Copy order number"
              style={{
                background: justCopied ? '#22c55e' : 'rgba(255,255,255,0.15)',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                padding: '3px 8px', color: '#fff', fontSize: 11, fontWeight: 600,
                transition: 'background .2s', flexShrink: 0,
              }}>
              {justCopied ? t('orders.tooltip.copied') : <Copy width={12} height={12} />}
            </button>
          </div>
          {trackingToken && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{t('orders.tooltip.service_status_token')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#94a3b8', userSelect: 'all', cursor: 'text' }}>{trackingToken}</span>
                <button
                  onClick={e => { e.stopPropagation(); onCopyToken(trackingToken); }}
                  title="Copy tracking token"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#64748b' }}>
                  <Copy width={11} height={11} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepBar({ current, t }) {
  const isMobile = window.innerWidth <= 768;
  const stepSize = isMobile ? 28 : 32;
  const fontSize = isMobile ? 12 : 14;
  const titleFontSize = isMobile ? 11 : 12;
  const descFontSize = isMobile ? 9 : 10;
  
  return (
    <div style={{ display:'flex', padding: isMobile ? '14px 20px 0' : '18px 28px 0', position:'relative' }}>
      {STEPS.map((s, i) => {
        const done = current > s.num;
        const active = current === s.num;
        return (
          <div key={s.num} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', position:'relative', zIndex:1 }}>
            {i < STEPS.length - 1 && (
              <div style={{ position:'absolute', top:stepSize/2 - 1.5, left:'50%', width:'100%', height:3,
                background: done ? '#f97316' : '#e2e8f0', borderRadius:2, zIndex:0 }} />
            )}
            <div style={{ width:stepSize, height:stepSize, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
              fontWeight:700, fontSize:fontSize, zIndex:1,
              background: done ? '#f97316' : active ? '#fff' : '#f1f5f9',
              color: done ? '#fff' : active ? '#f97316' : '#94a3b8',
              border: active ? '2px solid #f97316' : done ? '2px solid #f97316' : '2px solid #e2e8f0' }}>
              {done ? <Check width={isMobile ? 14 : 16} height={isMobile ? 14 : 16} /> : s.num}
            </div>
            <div style={{ marginTop: isMobile ? 6 : 8, textAlign:'center' }}>
              <div style={{ fontSize:titleFontSize, fontWeight:700, color: active||done ? '#1e293b' : '#94a3b8' }}>
                {t(s.titleKey)}
              </div>
              {!isMobile && <div style={{ fontSize:descFontSize, color:'#94a3b8', marginTop:1 }}>{t(s.descKey)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Address search (Nominatim) */
function AddressSearch({ onSelect }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [q, setQ]         = useState('');
  const [results, setRes] = useState([]);
  const [open, setOpen]   = useState(false);
  const ref               = useRef(null);
  const timer             = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const search = (val) => {
    setQ(val);
    clearTimeout(timer.current);
    if (val.length < 3) { setRes([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&countrycodes=ae&limit=5`);
        const data = await r.json();
        setRes(data); setOpen(true);
      } catch { setRes([]); }
    }, 400);
  };

  return (
    <div ref={ref} style={{ position:'relative', gridColumn:'1/-1' }}>
      <label style={LABEL}>{t('orders.form.search_address')}</label>
      <div style={{ position:'relative' }}>
        <Search width={14} height={14} style={{ position:'absolute', [isRTL?'right':'left']:12, top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
        <input value={q} onChange={e=>search(e.target.value)} onFocus={()=>results.length&&setOpen(true)}
          style={{ ...INPUT, [isRTL?'paddingRight':'paddingLeft']:34 }} placeholder={t('orders.placeholders.search_address')} />
      </div>
      {open && results.length > 0 && (
        <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', borderRadius:10,
          boxShadow:'0 8px 30px rgba(0,0,0,0.15)', border:'1px solid #e2e8f0', zIndex:9999, maxHeight:220, overflowY:'auto', marginTop:4 }}>
          {results.map((r,i) => (
            <div key={i} onClick={() => { onSelect({ lat:r.lat, lng:r.lon, display:r.display_name }); setQ(r.display_name.split(',')[0]); setOpen(false); }}
              style={{ padding:'10px 14px', cursor:'pointer', borderBottom:'1px solid #f8fafc', fontSize:13, color:'#1e293b' }}
              onMouseOver={e=>e.currentTarget.style.background='#f8fafc'}
              onMouseOut={e=>e.currentTarget.style.background='#fff'}>
              <div style={{ fontWeight:600 }}>{r.display_name.split(',')[0]}</div>
              <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{r.display_name.split(',').slice(1,3).join(',')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Map click handler ── */
function ClickHandler({ onClick }) {
  useMapEvents({ click: (e) => onClick(e.latlng) });
  return null;
}
function FlyTo({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.flyTo(center, Math.max(map.getZoom(), 15), { duration: 0.6 }); }, [center]);
  return null;
}

/* Location picker map for order form */
function LocationPickerMap({ lat, lng, onPick, height: customHeight }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const center = (lat && lng) ? [parseFloat(lat), parseFloat(lng)] : [25.2048, 55.2708]; // Dubai default
  const hasPin = lat && lng;
  const isMobile = window.innerWidth <= 768;
  const mapHeight = customHeight || (isMobile ? 180 : 240);
  
  return (
    <div style={{ gridColumn: customHeight ? undefined : '1/-1' }}>
      <label style={LABEL}>
        <MapPin width={12} height={12} style={{ [isRTL?'marginLeft':'marginRight']:4, verticalAlign:'middle' }} />
        {t('orders.form.pin_location')} <span style={{ fontWeight:400, textTransform:'none', fontSize:11, color:'#94a3b8' }}>
          {isMobile ? ` — ${t('orders.form.tap_map')}` : ` — ${t('orders.form.click_map')}`}
        </span>
      </label>
      <div style={{ borderRadius: isMobile ? 8 : 12, overflow:'hidden', border:'1.5px solid #e2e8f0', 
        height: mapHeight, position:'relative' }}>
        <MapContainer center={center} zoom={hasPin ? 15 : 11} style={{ height:'100%', width:'100%' }}
          scrollWheelZoom={!isMobile} doubleClickZoom={false} attributionControl={false}
          dragging={!isMobile} touchZoom={isMobile}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ClickHandler onClick={(latlng) => onPick(latlng.lat, latlng.lng)} />
          {hasPin && <FlyTo center={center} />}
          {hasPin && <Marker position={center} />}
        </MapContainer>
        {hasPin && (
          <div style={{ position:'absolute', bottom: isMobile ? 4 : 8, [isRTL?'right':'left']: isMobile ? 4 : 8, 
            background:'rgba(0,0,0,.7)', color:'#fff',
            borderRadius:6, padding: isMobile ? '2px 6px' : '4px 10px', 
            fontSize: isMobile ? 10 : 11, fontWeight:600, zIndex:999, backdropFilter:'blur(4px)' }}>
            {parseFloat(lat).toFixed(5)}, {parseFloat(lng).toFixed(5)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Mini Barcode for sidebar ── */
function SidebarBarcode({ value }) {
  const svgRef = useRef(null);
  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, String(value), {
        format: 'CODE128', width: 1, height: 22, displayValue: false,
        margin: 0, background: 'transparent', lineColor: '#1e293b',
      });
    } catch {}
  }, [value]);
  if (!value) return null;
  return (
    <div style={{ textAlign:'center' }}>
      <svg ref={svgRef} style={{ width:'100%', maxWidth:130, height:22 }} />
      <div style={{ fontFamily:'monospace', fontSize:8, color:'#64748b', letterSpacing:'0.06em', fontWeight:600 }}>{String(value)}</div>
    </div>
  );
}

const PKG_STATUS_MAP = {
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

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function WorkOrders() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const fmtAED = (v) => fmtCurrency(v, cur);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  /* ── Responsive breakpoint: listen for resize ── */
  const [windowW, setWindowW] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const _mob = windowW <= 768;
  const _tab = windowW > 768 && windowW <= 1024;

  /* state */
  const [orders,     setWorkOrders]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [stats,      setStats]      = useState({});
  const [page,       setPage]       = useState(1);
  const [total,      setTotal]      = useState(0);
  /* Seeded from ?status=&date_from=&date_to= so a deep link (the Dashboard's
     status-breakdown chart drills through with one) opens already filtered.
     This has to be the INITIAL state rather than an effect: the list schedules
     a debounced fetch on mount, and a filter applied afterwards would be
     overwritten when that stale request lands. */
  const [filters,    setFilters]    = useState(() => ({
    status:          searchParams.get('status')    || '',
    search:          '',
    date_from:       searchParams.get('date_from') || '',
    date_to:         searchParams.get('date_to')   || '',
    work_order_type: '',
    customer_id:     '',
  }));
  const [sortBy,     setSortBy]     = useState('');     // '' | 'date' | 'cod' | 'bay' | 'status' | 'recipient' | 'work_order_number' | 'completed_at'
  const [sortDir,    setSortDir]    = useState('desc'); // 'asc' | 'desc'
  const [showForm,   setShowForm]   = useState(false);
  const [selected,   setSelected]   = useState(null);
  const [drawer,     setDrawer]     = useState(null);
  const [drawerFull, setDrawerFull] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [step,       setStep]       = useState(1);
  const [formError,  setFormError]  = useState('');
  const [saving,     setSaving]     = useState(false);
  const [service_bays,      setServiceBays]      = useState([]);
  const [customers,    setCustomers]    = useState([]);
  const [mechanics,    setMechanics]    = useState([]);
  const [categories, setCategories] = useState([]);
  const { toasts, showToast } = useToast();
  const [copied,     setCopied]     = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(null);
  const [mechanicPicker, setMechanicPicker] = useState(null); // { workOrderId } when open
  const [mechanicSearch, setMechanicSearch] = useState('');
  const [assigningMechanic, setAssigningMechanic] = useState(null); // mechanic.id being assigned
  const [preTokenValidation, setPreTokenValidation] = useState(null); // { valid, reason, work_order_number } or null
  const [labelSelected, setLabelSelected] = useState(new Set()); // MODULE B: batch label selection
  const [drawerStops, setDrawerStops] = useState([]);
  const [drawerPackages, setDrawerPackages] = useState([]);
  const [orderMode, setOrderMode] = useState('single'); // 'single' | 'multi_stop' | 'barcode'
  const [stops, setStops] = useState([{ ...EMPTY_STOP, packages:[{ ...EMPTY_PKG }] }]);
  const [workshopInfo, setWorkshopInfo] = useState(null); // workshop profile for business-as-sender
  const debounceRef = useRef(null);
  const didAutoOpen = useRef(false);

  /* Plan usage for order limit warnings */
  const { usage, plan, isAtOrderLimit, hasFeature, refresh: refreshPlan } = usePlanUsage();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showNewWO, setShowNewWO] = useState(false);
  const [showNewEstimate, setShowNewEstimate] = useState(false);
  const [newWOPresetCustomerId, setNewWOPresetCustomerId] = useState(null);
  const [editWorkOrder, setEditWorkOrder] = useState(null);
  // Prompt shown right after a job card is created, offering to jump straight
  // into the intake inspection form (Customer Journey step 3).
  const [inspectionPrompt, setInspectionPrompt] = useState(null);

  /* Auto-open new order if ?customer_id= is in the URL (from Customers drawer) */
  useEffect(() => {
    if (didAutoOpen.current) return;
    const cid = searchParams.get('customer_id');
    if (cid && customers.length > 0) {
      const c = customers.find(cl => String(cl.id) === String(cid));
      if (c) {
        openNew(c);
        setSearchParams({}, { replace: true });
        didAutoOpen.current = true;
      }
    }
  }, [customers, searchParams]);

  /* data fetching */
  useEffect(() => { fetchWorkOrders(); }, [page, filters.status, filters.date_from, filters.date_to, filters.work_order_type, filters.customer_id, sortBy, sortDir]);
  useEffect(() => { fetchDropdowns(); fetchStats(); }, []);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchWorkOrders(), 350);
    return () => clearTimeout(debounceRef.current);
  }, [filters.search]);

  const fetchWorkOrders = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, limit: LIMIT });
      if (filters.status)     p.append('status', filters.status);
      if (filters.search)     p.append('search', filters.search);
      if (filters.date_from)  p.append('date_from', filters.date_from);
      if (filters.date_to)    p.append('date_to', filters.date_to);
      if (filters.work_order_type) p.append('work_order_type', filters.work_order_type);
      if (filters.customer_id)  p.append('customer_id', filters.customer_id);
      if (sortBy)             p.append('sort_by', sortBy);
      if (sortBy)             p.append('sort_dir', sortDir);
      const res = await api.get(`/work-orders?${p}`);
      if (res.success) {
        setWorkOrders(res.data || []);
        setTotal(res.pagination?.total || 0);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get('/work-orders/stats');
      if (res.success) setStats(res.data || {});
    } catch {}
  };

  const fetchDropdowns = async () => {
    try {
      const [zRes, cRes, dRes, catRes, sRes] = await Promise.all([
        api.get('/service-bays'), api.get('/customers?limit=500'), api.get('/mechanics?limit=500'),
        api.get('/settings/categories'), api.get('/settings'),
      ]);
      if (zRes.success)   setServiceBays(zRes.data || []);
      if (cRes.success)   setCustomers(cRes.data || []);
      if (dRes.success)   setMechanics(dRes.data || []);
      if (catRes.success) setCategories((catRes.data || []).filter(c => c.is_active));
      if (sRes.success && sRes.data) setWorkshopInfo(sRes.data);
    } catch (e) { console.error(e); }
  };

  const fetchWorkOrderDetail = async (workOrderId) => {
    setDrawerLoading(true);
    try {
      const res = await api.get(`/work-orders/${workOrderId}`);
      if (res.success) setDrawerFull(res.data);
    } catch {}
    finally { setDrawerLoading(false); }
    // Fetch packages
    let pkgs = [];
    try {
      const pRes = await api.get(`/packages/work-order/${workOrderId}`);
      if (pRes.success) { pkgs = pRes.data?.packages || []; setDrawerPackages(pkgs); }
      else setDrawerPackages([]);
    } catch { setDrawerPackages([]); }
    // Fetch stops
    try {
      const sRes = await api.get(`/multi-stop/work-orders/${workOrderId}/stops`);
      let fetchedStops = sRes.success ? (sRes.data?.stops || []) : [];
      // Auto-generate stops from packages if stops are empty but packages exist
      if (fetchedStops.length === 0 && pkgs.length > 0) {
        try {
          const ar = await api.post(`/packages/work-order/${workOrderId}/auto-stops`);
          if (ar.success) {
            const s2 = await api.get(`/multi-stop/work-orders/${workOrderId}/stops`);
            if (s2.success) fetchedStops = s2.data?.stops || [];
          }
        } catch {}
      }
      setDrawerStops(fetchedStops);
    } catch { setDrawerStops([]); }
  };

  /* form helpers */
  const set = (k, v) => {
    setForm(f => {
      const next = { ...f, [k]: v };
      // When switching sender_type, auto-fill or clear
      if (k === 'sender_type') {
        if (v === 'business' && workshopInfo) {
          next.customer_id = '';
          next.sender_name    = workshopInfo.name || '';
          next.sender_phone   = workshopInfo.phone || '';
          next.sender_address = [workshopInfo.building_name, workshopInfo.floor ? `Floor ${workshopInfo.floor}` : null, workshopInfo.office_number ? `Office ${workshopInfo.office_number}` : null, workshopInfo.address, workshopInfo.area, workshopInfo.city, workshopInfo.emirate, workshopInfo.country].filter(Boolean).join(', ');
          next.sender_lat = workshopInfo.company_lat || '';
          next.sender_lng = workshopInfo.company_lng || '';
        } else if (v === 'customer') {
          next.sender_name = ''; next.sender_phone = ''; next.sender_address = '';
          next.sender_lat = ''; next.sender_lng = '';
        }
      }
      if (k === 'customer_id' && v) {
        const c = customers.find(cl => String(cl.id) === String(v));
        if (c) {
          next.sender_name    = c.full_name || '';
          next.sender_phone   = c.phone || '';
          next.sender_address = [c.address_line1, c.area, c.city].filter(Boolean).join(', ');
          next.sender_lat     = c.latitude || '';
          next.sender_lng     = c.longitude || '';
        }
      }
      if (k === 'customer_id' && !v) {
        next.sender_name = ''; next.sender_phone = ''; next.sender_address = '';
        next.sender_lat = ''; next.sender_lng = '';
      }
      return next;
    });
  };

  /* ── Stop helpers ── */
  const updateStop = (idx, field, value) => {
    setStops(prev => { const n = [...prev]; n[idx] = { ...n[idx], [field]: value }; return n; });
  };
  const addStop = () => setStops(prev => [...prev, { ...EMPTY_STOP, phone_code: getPhoneCodeForCountry(workshopInfo?.country), packages:[{ ...EMPTY_PKG }] }]);
  const removeStop = (idx) => setStops(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  const duplicateStop = (idx) => setStops(prev => {
    const copy = JSON.parse(JSON.stringify(prev[idx]));
    copy.recipient_name = ''; copy.recipient_phone = ''; copy.recipient_email = '';
    return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
  });
  const handleStopZoneChange = (sIdx, serviceBayId) => {
    setStops(prev => {
      const n = [...prev]; const s = { ...n[sIdx], service_bay_id: serviceBayId };
      const z = service_bays.find(z => String(z.id) === String(serviceBayId));
      if (z) {
        if (z.name && !s.recipient_area) s.recipient_area = z.name;
        if (z.emirate) s.recipient_emirate = z.emirate;
        if (z.center_lat && !s.recipient_lat) s.recipient_lat = z.center_lat;
        if (z.center_lng && !s.recipient_lng) s.recipient_lng = z.center_lng;
        if (z.base_service_fee) s.service_fee = String(z.base_service_fee);
      }
      n[sIdx] = s; return n;
    });
  };

  /* ── Package helpers ── */
  const updatePkg = (sIdx, pIdx, field, value) => {
    setStops(prev => {
      const n = JSON.parse(JSON.stringify(prev));
      n[sIdx].packages[pIdx] = { ...n[sIdx].packages[pIdx], [field]: value };
      return n;
    });
  };
  const addPkg = (sIdx) => {
    setStops(prev => {
      const n = JSON.parse(JSON.stringify(prev));
      n[sIdx].packages.push({ ...EMPTY_PKG });
      return n;
    });
  };
  const removePkg = (sIdx, pIdx) => {
    setStops(prev => {
      const n = JSON.parse(JSON.stringify(prev));
      n[sIdx].packages = n[sIdx].packages.filter((_, i) => i !== pIdx);
      if (n[sIdx].packages.length === 0) n[sIdx].packages.push({ ...EMPTY_PKG });
      return n;
    });
  };

  /* ── Review totals (memoized) ── */
  const reviewTotals = useMemo(() => {
    let totalPkgs = 0, totalCod = 0, totalFee = 0, totalDisc = 0;
    stops.forEach(s => {
      totalFee += parseFloat(s.service_fee) || 0;
      totalDisc += parseFloat(s.discount) || 0;
      s.packages.forEach(p => { totalPkgs++; totalCod += parseFloat(p.cash_amount) || 0; });
    });
    return { stops: stops.length, packages: totalPkgs, cod: totalCod, fee: totalFee, discount: totalDisc, total: totalCod + totalFee - totalDisc };
  }, [stops]);

  const validateStep = () => {
    if (step === 1) {
      if (form.sender_type === 'business') {
        if (!form.sender_name) return t('orders.validation.sender_name_required');
        if (!form.sender_phone) return t('orders.validation.sender_phone_required');
      } else {
        if (!form.customer_id && !form.sender_name) return t('orders.validation.select_customer_or_sender');
        if (!form.customer_id && !form.sender_phone) return t('orders.validation.sender_phone_required');
      }
    }
    if (step === 2) {
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        if (!s.recipient_name) return `${t('orders.stops.stop_label')} ${i+1}: ${t('orders.validation.recipient_name_required')}`;
        if (!s.recipient_phone) return `${t('orders.stops.stop_label')} ${i+1}: ${t('orders.validation.recipient_phone_required')}`;
        if (!s.recipient_address) return `${t('orders.stops.stop_label')} ${i+1}: ${t('orders.validation.delivery_address_required')}`;
        if (!s.recipient_lat || !s.recipient_lng) return `${t('orders.stops.stop_label')} ${i+1}: Please select a location on the map or search for an address`;
      }
    }
    if (step === 3) {
      for (let i = 0; i < stops.length; i++) {
        for (let j = 0; j < stops[i].packages.length; j++) {
          const p = stops[i].packages[j];
          const w = parseFloat(p.weight_kg);
          if (p.weight_kg !== '' && (isNaN(w) || w < 0 || w > 99999))
            return `${t('orders.stops.stop_label')} ${i+1}, ${t('orders.stops.pkg')} ${j+1}: ${t('orders.validation.weight_range')}`;
          const cod = parseFloat(p.cash_amount);
          if (p.cash_amount !== '' && (isNaN(cod) || cod < 0 || cod > 99999999))
            return `${t('orders.stops.stop_label')} ${i+1}, ${t('orders.stops.pkg')} ${j+1}: ${t('orders.validation.cod_range')}`;
        }
        const fee = parseFloat(stops[i].service_fee);
        if (stops[i].service_fee !== '' && (isNaN(fee) || fee < 0 || fee > 99999999))
          return `${t('orders.stops.stop_label')} ${i+1}: ${t('orders.validation.fee_range')}`;
      }
      const disc = parseFloat(form.discount);
      if (form.discount !== '' && (isNaN(disc) || disc < 0 || disc > 99999999))
        return t('orders.validation.discount_range');
    }
    return null;
  };

  const nextStep = (e) => {
    e.preventDefault(); e.stopPropagation();
    const err = validateStep();
    if (err) { setFormError(err); return; }
    setFormError('');
    setStep(s => Math.min(s + 1, STEPS.length));
  };

  const prevStep = (e) => {
    e.preventDefault(); e.stopPropagation();
    setFormError('');
    setStep(s => Math.max(s - 1, 1));
  };

  const openNew = (presetCustomer) => {
    if (isAtOrderLimit) {
      setShowUpgradeModal(true);
      return;
    }
    // Car-workshop job-card flow (customer → vehicle → services → parts → assign).
    setNewWOPresetCustomerId(presetCustomer?.id || null);
    setShowNewWO(true);
  };

  const openEdit = (order) => {
    // Use the new car-workshop job-card modal for editing
    setEditWorkOrder(order);
    setShowNewWO(true);
  };

  const closeForm = () => {
    setShowForm(false); setSelected(null); setForm({ ...EMPTY_FORM }); setFormError('');
    setStep(1); setPreTokenValidation(null);
    setStops([{ ...EMPTY_STOP, packages:[{ ...EMPTY_PKG }] }]); setOrderMode('single');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (step !== STEPS.length) return;
    const err = validateStep();
    if (err) { setFormError(err); return; }
    setFormError(''); setSaving(true);
    try {
      const first = stops[0];
      const firstPkg = first.packages[0] || {};

      const payload = {
        customer_id: form.sender_type === 'customer' ? (form.customer_id || undefined) : undefined,
        sender_type: form.sender_type || 'customer',
        sender_name: form.sender_name, sender_phone: form.sender_phone,
        sender_address: form.sender_address,
        sender_lat: form.sender_lat || undefined, sender_lng: form.sender_lng || undefined,
        recipient_name: first.recipient_name, recipient_phone: (first.phone_code || '+971') + first.recipient_phone,
        recipient_email: first.recipient_email || undefined,
        recipient_address: first.recipient_address,
        recipient_area: first.recipient_area || undefined,
        recipient_emirate: first.recipient_emirate || undefined,
        address_type: first.address_type || undefined,
        building_name: first.building_name || undefined,
        floor_number: first.floor_number || undefined,
        flat_number: first.flat_number || undefined,
        recipient_lat: first.recipient_lat || undefined, recipient_lng: first.recipient_lng || undefined,
        service_bay_id: first.service_bay_id || undefined,
        work_order_type: first.work_order_type || 'standard',
        scheduled_at: first.scheduled_at || undefined,
        category: firstPkg.category || 'parcel',
        weight_kg: parseFloat(firstPkg.weight_kg) || 0,
        dimensions: firstPkg.dimensions || undefined,
        description: firstPkg.description || undefined,
        special_instructions: firstPkg.special_instructions || undefined,
        payment_method: stops[0]?.payment_method || form.payment_method || 'cod',
        cash_amount: reviewTotals.cod || 0,
        service_fee: reviewTotals.fee || 0,
        discount: parseFloat(stops[0]?.discount || form.discount) || 0,
        notes: form.internal_notes || undefined,
        pregenerated_token: form.pregenerated_token || undefined,
      };

      // Clean up
      Object.keys(payload).forEach(k => { if (payload[k] === undefined) delete payload[k]; });
      if (!payload.cash_amount) payload.cash_amount = 0;
      if (!payload.service_fee) payload.service_fee = 0;
      if (!payload.discount) payload.discount = 0;
      if (!payload.weight_kg) payload.weight_kg = 0;

      // Build packages from all stops
      const allPkgs = [];
      stops.forEach(s => {
        s.packages.forEach(p => {
          allPkgs.push({
            recipient_name: s.recipient_name, recipient_phone: (s.phone_code || '+971') + s.recipient_phone,
            recipient_address: s.recipient_address, recipient_area: s.recipient_area || '',
            recipient_emirate: s.recipient_emirate || '',
            address_type: s.address_type || '', building_name: s.building_name || '',
            floor_number: s.floor_number || '', flat_number: s.flat_number || '',
            recipient_lat: s.recipient_lat || '', recipient_lng: s.recipient_lng || '',
            service_bay_id: s.service_bay_id || '',
            category: p.category || 'parcel', weight_kg: p.weight_kg || '',
            dimensions: p.dimensions || '', cash_amount: p.cash_amount || '0',
            description: p.description || '', special_instructions: p.special_instructions || '',
            payment_method: s.payment_method || 'cod',
            discount: s.discount || '0',
          });
        });
      });
      const validPkgs = allPkgs.filter(p => p.recipient_name && p.recipient_phone && p.recipient_address);
      if (validPkgs.length > 0) payload.packages = validPkgs;

      const res = selected
        ? await api.put(`/work-orders/${selected.id}`, payload)
        : await api.post('/work-orders', payload);
      if (res.success) {
        closeForm();
        fetchWorkOrders();
        fetchStats();
        if (!selected) dispatchPlanUpdate(); // notify sidebar plan badge on new order
        showToast(selected
          ? t('orders.toast.updated')
          : `${t('orders.toast.created')} \u2014 ${res.data?.work_order_number || ''}${validPkgs.length > 0 ? ` (${validPkgs.length} ${t('orders.stops.packages_total')})` : ''}`);
      } else {
        if (res.upgrade_required) { setShowUpgradeModal(true); setFormError(''); }
        else setFormError(res.message || t('orders.toast.save_failed'));
      }
    } catch { setFormError(t('orders.toast.network_error')); }
    finally { setSaving(false); }
  };

  const handleStatusChange = async (workOrderId, newStatus, note = '') => {
    // If changing to "assigned", show mechanic picker instead of direct status change
    if (newStatus === 'assigned') {
      const order = drawerFull || drawer;
      if (!order?.mechanic_id) {
        setMechanicPicker({ workOrderId });
        setMechanicSearch('');
        return;
      }
    }
    try {
      const res = await api.patch(`/work-orders/${workOrderId}/status`, { status: newStatus, note });
      if (res.success) {
        fetchWorkOrders(); fetchStats();
        showToast(t('orders.toast.status_updated', { status: t(`orders.status.${newStatus}`) }));
        if (drawerFull && drawerFull.id === workOrderId) {
          setDrawerFull(prev => ({ ...prev, status: newStatus }));
        }
      } else {
        showToast(res.message || t('orders.toast.status_failed'), 'error');
      }
    } catch { showToast(t('orders.toast.status_network_error'), 'error'); }
  };

  const handleAssignMechanic = async (mechanicId) => {
    if (!mechanicPicker) return;
    const mechanic = mechanics.find(d => d.id === mechanicId);
    if (mechanic && mechanic.status === 'busy' && !window.confirm(t('orderDetail.busy_mechanic_warning', 'This mechanic is currently busy. Are you sure you want to assign them?'))) return;
    setAssigningMechanic(mechanicId);
    try {
      const res = await api.patch(`/work-orders/${mechanicPicker.workOrderId}/assign-mechanic`, { mechanic_id: mechanicId });
      if (res.success) {
        fetchWorkOrders(); fetchStats();
        const mechanic = mechanics.find(d => d.id === mechanicId);
        showToast(t('orders.toast.mechanic_assigned', { name: mechanic?.full_name || '' }));
        if (drawerFull && drawerFull.id === mechanicPicker.workOrderId) {
          setDrawerFull(prev => ({ ...prev, status: 'assigned', mechanic_id: mechanicId, mechanic_name: mechanic?.full_name }));
        }
        setMechanicPicker(null);
      } else {
        showToast(res.message || t('orders.toast.assign_failed'), 'error');
      }
    } catch { showToast(t('orders.toast.status_network_error'), 'error'); }
    finally { setAssigningMechanic(null); }
  };

  const handleCancel = async () => {
    if (!cancelConfirm) return;
    const { id } = cancelConfirm;
    setCancelConfirm(null);
    await handleStatusChange(id, 'cancelled', 'Cancelled by admin');
  };

  const copyToken = (token) => {
    navigator.clipboard.writeText(token).then(() => { setCopied(token); setTimeout(() => setCopied(''), 1500); });
  };

  const openDrawer = (order) => {
    setDrawer(order);
    setDrawerFull(null);
    fetchWorkOrderDetail(order.id);
  };

  /* CSV export — fetches ALL orders with current filters */
  const [exporting, setExporting] = useState(false);
  const exportCSV = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams({ page: 1, limit: 10000 });
      if (filters.status)     p.append('status', filters.status);
      if (filters.search)     p.append('search', filters.search);
      if (filters.date_from)  p.append('date_from', filters.date_from);
      if (filters.date_to)    p.append('date_to', filters.date_to);
      if (filters.work_order_type) p.append('work_order_type', filters.work_order_type);
      if (filters.customer_id)  p.append('customer_id', filters.customer_id);
      const res = await api.get(`/work-orders?${p}`);
      const allWorkOrders = res.success ? (res.data || []) : [];
      if (!allWorkOrders.length) { setExporting(false); return; }
      const headers = ['WorkOrder #','Status','Customer','Recipient','Phone',getRegionLabel(workshop?.country, 'en'),'ServiceBay','Type','Payment','COD Amount','Delivery Fee','Date'];
      const rows = allWorkOrders.map(o => [
        o.work_order_number, o.status, o.customer_name||'Walk-in', o.recipient_name, o.customer_phone || o.recipient_phone,
        o.recipient_emirate, o.zone_name||'', o.work_order_type, o.payment_method,
        o.cash_amount||0, o.service_fee||0, fmtDate(o.created_at)
      ]);
      // SR-15 — quoting was correct but a leading = + @ was still a formula.
      const csv = toCsv(headers, rows);
      const blob = new Blob([csv], { type:'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `orders-${new Date().toISOString().slice(0,10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    setExporting(false);
  };

  const clearFilters = () => setFilters({ status:'', search:'', date_from:'', date_to:'', work_order_type:'', customer_id:'' });
  const hasFilters = filters.status || filters.search || filters.date_from || filters.date_to || filters.work_order_type || filters.customer_id;
  const totalPages = Math.ceil(total / LIMIT);

  /* ── MODULE B: Shipping Label helpers ──────────────────────── */
  const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
  const getAuthToken = () => localStorage.getItem('auth_token');

  const printSingleLabel = (workOrderId) => {
    const token = getAuthToken();
    const url = `${API_BASE_URL}/work-orders/${workOrderId}/label`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (r.status === 401) { localStorage.removeItem('auth_token'); window.location.href = '/login'; throw new Error('Session expired'); }
        if (!r.ok) throw new Error('Label generation failed');
        return r.blob();
      })
      .then(blob => {
        const pdfUrl = URL.createObjectURL(blob);
        window.open(pdfUrl, '_blank');
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
      })
      .catch(e => { console.error(e); showToast('Failed to generate label', 'error'); });
  };

  const printBatchLabels = () => {
    if (labelSelected.size === 0) return;
    const token = getAuthToken();
    const url = `${API_BASE_URL}/work-orders/labels`;
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_order_ids: [...labelSelected] }),
    })
      .then(r => {
        if (r.status === 401) { localStorage.removeItem('auth_token'); window.location.href = '/login'; throw new Error('Session expired'); }
        if (!r.ok) throw new Error('Batch label generation failed');
        return r.blob();
      })
      .then(blob => {
        const pdfUrl = URL.createObjectURL(blob);
        window.open(pdfUrl, '_blank');
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
        setLabelSelected(new Set());
      })
      .catch(e => { console.error(e); showToast('Failed to generate labels', 'error'); });
  };

  const toggleLabelSelect = (id, e) => {
    e?.stopPropagation();
    setLabelSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllLabelSelect = () => {
    if (labelSelected.size === orders.length) setLabelSelected(new Set());
    else setLabelSelected(new Set(orders.map(o => o.id)));
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <div style={{ padding: _mob ? '16px 12px' : '28px 32px', maxWidth:1400, margin:'0 auto' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems: _mob ? 'stretch' : 'flex-start', marginBottom: _mob ? 16 : 24, flexDirection: _mob ? 'column' : 'row', gap: _mob ? 12 : 0 }}>
        <div>
          <h2 style={{ margin:0, fontSize: _mob ? 20 : 26, fontWeight:900, color:'#1e293b' }}>{t('orders.title')}</h2>
          <p style={{ margin:'4px 0 0', color:'#94a3b8', fontSize:14 }}>
            {total > 0 ? t('orders.subtitle_count', { count: total }) : t('orders.subtitle_empty')}
          </p>
        </div>
        <div style={{ display:'flex', gap: _mob ? 8 : 10, flexWrap:'wrap' }}>
          <button onClick={() => navigate('/service-tracking')} title="Track services"
            style={{ padding: _mob ? '8px 12px' : '10px 16px', borderRadius:10, border:'1px solid #bfdbfe',
              background:'#eff6ff', cursor:'pointer', fontWeight:600, fontSize: _mob ? 12 : 14,
              color:'#2563eb', display:'flex', alignItems:'center', gap: _mob ? 5 : 7 }}>
            <MapPin width={15} height={15} /> {!_mob && t('orders.actions.track')}
          </button>
          <button onClick={() => navigate('/job-assignment')} title="JobAssignment board"
            style={{ padding:'10px 16px', borderRadius:10, border:'1px solid #d9f99d',
              background:'#f7fee7', cursor:'pointer', fontWeight:600, fontSize:14,
              color:'#65a30d', display:'flex', alignItems:'center', gap:7 }}>
            <DeliveryTruck width={15} height={15} /> {t('orders.actions.job-assignment')}
          </button>
          <button onClick={exportCSV} disabled={exporting} title="Export all orders as CSV"
            style={{ padding:'10px 16px', borderRadius:10, border:'1px solid #e2e8f0',
              background: exporting ? '#f8fafc' : '#fff',
              cursor: exporting ? 'not-allowed' : 'pointer', fontWeight:600, fontSize:14,
              color: exporting ? '#94a3b8' : '#475569',
              display:'flex', alignItems:'center', gap:7 }}>
            <Download width={15} height={15} /> {exporting ? t('orders.actions.exporting') : t('orders.actions.export')}
          </button>
          {labelSelected.size > 0 && (
            <button onClick={printBatchLabels} title="Print shipping labels for selected orders"
              style={{ padding:'10px 16px', borderRadius:10, border:'1px solid #fed7aa',
                background:'#fff7ed', cursor:'pointer', fontWeight:600, fontSize:14,
                color:'#ea580c', display:'flex', alignItems:'center', gap:7 }}>
              <Printer width={15} height={15} /> Print Labels ({labelSelected.size})
            </button>
          )}
          {/* Estimate-first path: build labour/parts lines, the customer
              approves or rejects each from their phone, and the job card is
              created automatically the moment every line is decided. Sits
              alongside New Job Card rather than replacing it — a walk-in
              whose car is already on the ramp cannot wait on an email
              round-trip, so immediate creation stays available too. */}
          <button onClick={() => setShowNewEstimate(true)}
            style={{ padding:'10px 20px', borderRadius:10, border:'1.5px solid #e2e8f0',
              background:'#fff', color:'#1e3a6b', cursor:'pointer', fontWeight:700, fontSize:14,
              display:'flex', alignItems:'center', gap:7 }}>
            <SendMail width={16} height={16} /> New Estimate
          </button>
          <button onClick={() => openNew()}
            style={{ padding:'10px 22px', borderRadius:10, border:'none',
              background: isAtOrderLimit ? '#9ca3af' : 'linear-gradient(135deg,#f97316,#ea580c)', color:'#fff',
              cursor: isAtOrderLimit ? 'not-allowed' : 'pointer', fontWeight:700, fontSize:14, display:'flex', alignItems:'center', gap:7,
              boxShadow: isAtOrderLimit ? 'none' : '0 4px 14px rgba(249,115,22,0.3)' }}
            title={isAtOrderLimit ? `WorkOrder limit reached (${usage?.orders_this_month || '?'}/${usage?.orders_limit || '?'})` : ''}>
            <Plus width={16} height={16} /> {t('orders.new_order')}
          </button>
        </div>
      </div>

      {/* WorkOrder limit warning banner */}
      {isAtOrderLimit && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:'12px 18px',
          marginBottom:16, display:'flex', alignItems:'center', gap:10, justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <WarningTriangle width={18} height={18} style={{ color:'#dc2626' }} />
            <span style={{ color:'#991b1b', fontWeight:600, fontSize:14 }}>
              WorkOrder limit reached ({usage?.orders_this_month || 0}/{usage?.orders_limit || 0}).
              Upgrade your plan to create more orders.
            </span>
          </div>
          <button onClick={() => setShowUpgradeModal(true)}
            style={{ padding:'8px 18px', borderRadius:8, border:'none', background:'#dc2626', color:'#fff',
              cursor:'pointer', fontWeight:700, fontSize:13, whiteSpace:'nowrap' }}>
            Upgrade
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: _mob ? 'grid' : 'flex', gridTemplateColumns: _mob ? '1fr 1fr' : undefined, gap: _mob ? 10 : 16, marginBottom: _mob ? 16 : 24, flexWrap:'wrap' }}>
        <KPICard icon={Package}       label={t('orders.stats.total_orders')}  value={stats.total || 0}      sub={t('orders.stats.today_count', { count: stats.today||0 })}       color="#1e3a6b" />
        <KPICard icon={Clock}         label={t('orders.stats.pending')}       value={stats.pending || 0}     sub={t('orders.stats.awaiting_confirmation')}            color="#d97706" />
        <KPICard icon={Wrench}       label={t('orders.stats.in_progress')}   value={stats.in_progress || 0} sub={t('orders.stats.ready_count', { count: stats.ready_for_pickup||0 })} color="#0e7490" />
        <KPICard icon={CheckCircle}   label={t('orders.stats.completed')}     value={stats.completed || 0}   sub={fmtAED(stats.total_revenue)}       color="#16a34a" />
      </div>

      {/* Status filter chips */}
      <div style={{ display:'flex', gap:8, flexWrap: _mob ? 'nowrap' : 'wrap', marginBottom:16, overflowX: _mob ? 'auto' : 'visible', paddingBottom: _mob ? 4 : 0, WebkitOverflowScrolling: 'touch' }}>
        <button onClick={() => setFilters(f=>({...f, status:''}))}
          style={{ padding:'6px 16px', borderRadius:20, border: !filters.status ? '2px solid #1e3a6b' : '1px solid #e2e8f0',
            background: !filters.status ? '#eff6ff' : '#fff', color: !filters.status ? '#1e3a6b' :'#64748b',
            cursor:'pointer', fontWeight:700, fontSize:13 }}>
          {t('orders.filters.all_with_count', { count: stats.total||0 })}
        </button>
        {Object.entries(STATUS_META).map(([k,m]) => (
          <button key={k} onClick={() => setFilters(f=>({...f, status: f.status===k ? '' : k}))}
            style={{ padding:'6px 14px', borderRadius:20,
              border: filters.status===k ? `2px solid ${m.color}` : '1px solid #e2e8f0',
              background: filters.status===k ? m.bg : '#fff', color: filters.status===k ? m.color : '#64748b',
              cursor:'pointer', fontWeight:600, fontSize:12, display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:m.color }} />
            {t(`orders.status.${k}`)} ({stats[k]||0})
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ position:'relative', flex:1, minWidth:220 }}>
          <Search width={15} height={15} style={{ position:'absolute', [isRTL?'right':'left']:12, top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
          <input type="text" placeholder={t('orders.filters.search_placeholder')}
            value={filters.search} onChange={e => setFilters(f=>({...f, search:e.target.value}))}
            style={{ ...INPUT, [isRTL?'paddingRight':'paddingLeft']:36, background:'#fff' }} />
        </div>
        <select value={filters.work_order_type} onChange={e=>setFilters(f=>({...f, work_order_type:e.target.value}))}
          style={{ ...INPUT, width:140, background:'#fff' }}>
          <option value="">{t('orders.filters.all_types')}</option>
          {ORDER_TYPES.map(ot => <option key={ot} value={ot}>{fmtType(ot)}</option>)}
        </select>
        <select value={filters.customer_id} onChange={e=>setFilters(f=>({...f, customer_id:e.target.value}))}
          style={{ ...INPUT, width:180, background:'#fff' }}>
          <option value="">{t('orders.filters.all_customers')}</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.full_name}{c.company_name ? ` (${c.company_name})` : ''}</option>)}
        </select>
        <input type="date" value={filters.date_from} onChange={e=>setFilters(f=>({...f, date_from:e.target.value}))}
          style={{ ...INPUT, width:140 }} />
        <span style={{ color:'#94a3b8', fontSize:13 }}>{t('orders.filters.to')}</span>
        <input type="date" value={filters.date_to} onChange={e=>setFilters(f=>({...f, date_to:e.target.value}))}
          style={{ ...INPUT, width:140 }} />
        {hasFilters && (
          <button onClick={clearFilters}
            style={{ padding:'10px 14px', borderRadius:9, border:'1px solid #fecaca', background:'#fff5f5',
              color:'#dc2626', cursor:'pointer', fontWeight:600, fontSize:13, display:'flex', alignItems:'center', gap:5 }}>
            <Xmark width={14} height={14} /> {t('common.clear')}
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
         ORDERS TABLE
         ══════════════════════════════════════════════════════ */}
      <div style={{ background:'#fff', borderRadius:16, boxShadow:'0 1px 4px rgba(0,0,0,0.08)', overflow:'hidden' }}>
        {loading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : orders.length === 0 ? (
          <div style={{ padding:60, textAlign:'center' }}>
            <Package width={48} height={48} style={{ color:'#cbd5e1', marginBottom:16 }} />
            <h3 style={{ color:'#1e293b', fontSize:16, fontWeight:700 }}>{t('orders.empty.title')}</h3>
            <p style={{ color:'#94a3b8', fontSize:14, marginBottom:18 }}>
              {hasFilters ? t('orders.empty.subtitle_filter') : t('orders.empty.subtitle_new')}
            </p>
            {!hasFilters && (
              <button onClick={() => openNew()}
                style={{ padding:'10px 22px', borderRadius:10, border:'none', background:'#f97316', color:'#fff',
                  cursor:'pointer', fontWeight:700, fontSize:14 }}>
                <Plus width={16} height={16} /> {t('orders.new_order')}
              </button>
            )}
          </div>
        ) : (
          <>
            {_mob ? (
              /* ── Mobile card view ── */
              <div style={{ padding:'8px' }}>
                {orders.map(o => {
                  const sm = STATUS_META[o.status] || {};
                  const StIcon = sm.icon || Package;
                  return (
                    <div key={o.id} onClick={() => openDrawer(o)}
                      style={{ padding:'14px', marginBottom:8, borderRadius:12, border:'1px solid #f1f5f9',
                        background: labelSelected.has(o.id) ? '#fff7ed' : '#fff', cursor:'pointer', transition:'background 0.15s' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <input type="checkbox" checked={labelSelected.has(o.id)} readOnly
                            onClick={e => toggleLabelSelect(o.id, e)}
                            style={{ cursor:'pointer', width:15, height:15, accentColor:'#f97316' }} />
                          <div>
                            <div style={{ fontWeight:700, color:'#1e293b', fontSize:13 }}>{o.work_order_number}</div>
                            <div style={{ fontSize:11, color:'#94a3b8' }}>{fmtDate(o.created_at)} · {fmtTime(o.created_at)}</div>
                          </div>
                        </div>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px',
                          borderRadius:20, fontSize:11, fontWeight:700, background:sm.bg, color:sm.color }}>
                          <StIcon width={12} height={12} /> {t(`orders.status.${o.status}`)}
                        </span>
                      </div>
                      <div style={{ display:'flex', gap:12, fontSize:12, color:'#475569', marginBottom:6 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>{t('orders.table.recipient')}</div>
                          <div style={{ fontWeight:600 }}>{o.recipient_name}</div>
                          <div style={{ display:'flex', alignItems:'center', gap:3, fontSize:11, color:'#94a3b8' }}>
                            <Phone width={10} height={10} /> {o.customer_phone || o.recipient_phone}
                          </div>
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>{t('orders.table.customer_sender')}</div>
                          <div style={{ fontWeight:600 }}>{o.customer_name || o.sender_name || t('orders.walk_in')}</div>
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                        {o.zone_name && (
                          <span style={{ display:'flex', alignItems:'center', gap:3, fontSize:11, color:'#475569' }}>
                            <MapPin width={11} height={11} color="#94a3b8" /> {o.zone_name}
                          </span>
                        )}
                        <span style={{ padding:'2px 8px', borderRadius:12, fontSize:10, fontWeight:600,
                          background:'#f1f5f9', color:'#475569' }}>
                          {fmtType(o.work_order_type)}
                        </span>
                        {o.total_packages > 0 && (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:3,
                            padding:'2px 8px', borderRadius:12, fontSize:10, fontWeight:700,
                            background: o.delivered_packages >= o.total_packages ? '#dcfce7' : '#f1f5f9',
                            color: o.delivered_packages >= o.total_packages ? '#16a34a' : '#64748b' }}>
                            <Package width={10} height={10} />
                            {o.delivered_packages || 0}/{o.total_packages}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            /* ── Desktop table view ── */
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
                <thead>
                  <tr style={{ background:'#f8fafc', borderBottom:'2px solid #f1f5f9' }}>
                    <th style={{ padding:'12px 8px 12px 16px', width:36 }} onClick={e => { e.stopPropagation(); toggleAllLabelSelect(); }}>
                      <input type="checkbox" checked={orders.length > 0 && labelSelected.size === orders.length} readOnly
                        style={{ cursor:'pointer', width:15, height:15, accentColor:'#f97316' }} title="Select all for label printing" />
                    </th>
                    {[
                      { label: t('orders.table.order_num'), key: 'work_order_number' },
                      { label: t('orders.table.status'), key: 'status' },
                      { label: t('orders.table.customer'), key: '' },
                      { label: t('orders.table.vehicle', 'Vehicle'), key: '' },
                      { label: t('orders.table.total_cost', 'Total Cost'), key: 'total_amount' },
                      { label: t('orders.table.type'), key: '' },
                      { label: t('orders.table.date'), key: 'date' },
                      { label: t('orders.table.completed_at', 'Completed At'), key: 'completed_at' },
                      { label: '', key: '' },
                    ].map((h, i) => (
                      <th key={i}
                        style={{ padding:'12px 16px', textAlign: isRTL ? 'right' : 'left', fontWeight:700, fontSize:12,
                          color: sortBy === h.key ? '#1e3a6b' : '#64748b', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap',
                          cursor: h.key ? 'pointer' : 'default', userSelect:'none', transition:'color 0.15s' }}
                        onClick={h.key ? () => { if (sortBy === h.key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); } else { setSortBy(h.key); setSortDir('asc'); } } : undefined}
                      >
                        {h.label}
                        {h.key && sortBy === h.key && <span style={{ marginLeft:4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                        {h.key && sortBy !== h.key && <span style={{ marginLeft:4, opacity:0.3 }}>↕</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id} onClick={() => openDrawer(o)}
                      style={{ borderBottom:'1px solid #f8fafc', cursor:'pointer', transition:'background 0.15s',
                        background: labelSelected.has(o.id) ? '#fff7ed' : '#fff' }}
                      onMouseOver={e=>e.currentTarget.style.background=labelSelected.has(o.id)?'#fed7aa':'#fafbfc'}
                      onMouseOut={e=>e.currentTarget.style.background=labelSelected.has(o.id)?'#fff7ed':'#fff'}>
                      <td style={{ padding:'13px 8px 13px 16px', width:36 }} onClick={e => toggleLabelSelect(o.id, e)}>
                        <input type="checkbox" checked={labelSelected.has(o.id)} readOnly
                          style={{ cursor:'pointer', width:15, height:15, accentColor:'#f97316' }} />
                      </td>
                      <td style={{ padding:'13px 16px' }}>
                        <OrderNumCell
                          orderNumber={o.work_order_number}
                          trackingToken={o.service_status_token}
                          onCopyToken={copyToken}
                          copied={copied}
                        />
                      </td>
                      <td style={{ padding:'13px 16px' }}><StatusPill status={o.status} /></td>
                      <td style={{ padding:'13px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <Avatar name={o.customer_name || t('orders.walk_in')} size={34} />
                          <div>
                            <div style={{ fontWeight:600, color:'#1e293b', fontSize:13 }}>
                              {o.customer_name || t('orders.walk_in')}
                            </div>
                            {o.customer_name && (
                              <div style={{ fontSize:11, color:'#94a3b8' }}>
                                <Building width={10} height={10} style={{ verticalAlign:'middle', [isRTL?'marginLeft':'marginRight']:3 }} />
                                {t('orders.table.customer_label')}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding:'13px 16px' }}>
                        {/* Vehicle — replaces the old delivery "Recipient" and
                            "Packages" columns, whose fields no longer exist on
                            a work order (they rendered a bare phone and a dash) */}
                        {(o.vehicle_make || o.vehicle_model || o.vehicle_plate_number) ? (
                          <>
                            <div style={{ fontWeight:600, color:'#1e293b', fontSize:13 }}>
                              {[o.vehicle_make, o.vehicle_model].filter(Boolean).join(' ')}
                            </div>
                            {o.vehicle_plate_number && (
                              <div style={{ fontSize:11, color:'#94a3b8' }}>{o.vehicle_plate_number}</div>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize:12, color:'#cbd5e1' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding:'13px 16px' }}>
                        {(() => {
                          const amt = parseFloat(o.total_amount || o.service_fee || 0);
                          return amt > 0 ? (
                            <div style={{ fontWeight:700, color:'#16a34a', fontSize:13, whiteSpace:'nowrap' }}>
                              {fmtAED(amt)}
                            </div>
                          ) : (
                            <span style={{ fontSize:12, color:'#cbd5e1' }}>{'\u2014'}</span>
                          );
                        })()}
                      </td>
                      <td style={{ padding:'13px 16px' }}>
                        <span style={{ padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:600,
                          background:'#f1f5f9', color:'#475569' }}>
                          {fmtType(o.work_order_type)}
                        </span>
                      </td>
                      <td style={{ padding:'13px 16px', minWidth:110, maxWidth:140 }}>
                        <div style={{ fontSize:12, color:'#475569', whiteSpace:'nowrap' }}>{fmtDate(o.created_at)}</div>
                        <div style={{ fontSize:10, color:'#94a3b8', whiteSpace:'nowrap' }}>{fmtTime(o.created_at)}</div>
                      </td>
                      <td style={{ padding:'13px 16px', minWidth:110, maxWidth:140 }}>
                        {o.completed_at ? (
                          <>
                            <div style={{ fontSize:12, color:'#10b981', fontWeight:600, whiteSpace:'nowrap' }}>✓ {fmtDate(o.completed_at)}</div>
                            <div style={{ fontSize:10, color:'#6ee7b7', whiteSpace:'nowrap' }}>{fmtTime(o.completed_at)}</div>
                          </>
                        ) : (
                          <span style={{ fontSize:12, color:'#cbd5e1' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding:'13px 16px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={() => openDrawer(o)} title={t('orders.actions.details', 'Details')}
                            style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #dbeafe', background:'#eff6ff',
                              color:'#2563eb', cursor:'pointer', display:'flex', alignItems:'center' }}>
                            <Eye width={13} height={13} />
                          </button>
                          <button onClick={() => printSingleLabel(o.id)} title={o.total_packages > 1 ? `Print ${o.total_packages} Package Labels` : "Print Shipping Label"}
                            style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #fed7aa', background:'#fff7ed',
                              color:'#ea580c', cursor:'pointer', display:'flex', alignItems:'center' }}>
                            <Printer width={13} height={13} />
                          </button>
                          {!['completed','cancelled'].includes(o.status) && (
                            <button onClick={() => openEdit(o)} title="Edit"
                              style={{ padding:'6px 11px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff',
                                cursor:'pointer', fontSize:13, fontWeight:600, color:'#374151', display:'flex', alignItems:'center', gap:5 }}>
                              <EditPencil width={13} height={13} /> {t('orders.actions.edit')}
                            </button>
                          )}
                          {(o.customer_phone || o.recipient_phone) && (
                            <WhatsAppButton phone={o.customer_phone || o.recipient_phone} order={o} size="small" currency={cur} />
                          )}
                          {o.service_status_token && !['completed','cancelled'].includes(o.status) && (
                            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/track/${o.service_status_token}`); showToast(t('orders.toast.tracking_copied')); }} title="Copy public tracking link"
                              style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #bbf7d0', background:'#f0fdf4',
                                color:'#16a34a', cursor:'pointer', display:'flex', alignItems:'center' }}>
                              <ShareAndroid width={13} height={13} />
                            </button>
                          )}
                          {o.service_status_token && !['completed','cancelled'].includes(o.status) && (
                            <button onClick={() => window.open(`/track/${o.service_status_token}`, '_blank')} title="Live track"
                              style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #bfdbfe', background:'#eff6ff',
                                color:'#2563eb', cursor:'pointer', display:'flex', alignItems:'center' }}>
                              <OpenNewWindow width={13} height={13} />
                            </button>
                          )}
                          {!['completed','cancelled'].includes(o.status) && (
                            <button onClick={() => setCancelConfirm(o)} title="Cancel"
                              style={{ padding:'6px 10px', borderRadius:8, border:'1px solid #fecaca',
                                background:'#fff5f5', color:'#dc2626', cursor:'pointer', display:'flex', alignItems:'center' }}>
                              <Xmark width={13} height={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (() => {
              /* build visible page numbers: always show first, last, current ±2, with ellipsis */
              const delta = 2;
              const range = [];
              for (let i = Math.max(2, page - delta); i <= Math.min(totalPages - 1, page + delta); i++) range.push(i);
              const pages = [1, ...range, totalPages].filter((v,i,a) => a.indexOf(v) === i).sort((a,b)=>a-b);
              const btnBase = { padding:'7px 11px', borderRadius:8, border:'1px solid #e2e8f0',
                fontSize:13, fontWeight:600, cursor:'pointer', minWidth:36, textAlign:'center' };
              return (
                <div style={{ padding:'14px 18px', borderTop:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                  <span style={{ fontSize:13, color:'#64748b' }}>
                    {t('common.showing')} {(page-1)*LIMIT+1}–{Math.min(page*LIMIT,total)} {t('common.of')} <strong>{total}</strong> {t('common.orders')}
                  </span>
                  <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                    <button disabled={page===1} onClick={() => setPage(p=>p-1)}
                      style={{ ...btnBase, background:page===1?'#f8fafc':'#fff', cursor:page===1?'not-allowed':'pointer',
                        display:'flex', alignItems:'center', gap:4, opacity:page===1?0.5:1 }}>
                      {isRTL ? <NavArrowRight width={14} height={14} /> : <NavArrowLeft width={14} height={14} />} {t('orders.pagination.prev')}
                    </button>
                    {pages.map((p2, i) => {
                      const prev = pages[i - 1];
                      return (
                        <>
                          {prev && p2 - prev > 1 && (
                            <span key={`e${p2}`} style={{ padding:'7px 4px', fontSize:13, color:'#94a3b8' }}>…</span>
                          )}
                          <button key={p2} onClick={() => setPage(p2)}
                            style={{ ...btnBase,
                              background: p2 === page ? '#1e3a6b' : '#fff',
                              color: p2 === page ? '#fff' : '#374151',
                              border: p2 === page ? '1px solid #1e3a6b' : '1px solid #e2e8f0',
                              fontWeight: p2 === page ? 800 : 600 }}>
                            {p2}
                          </button>
                        </>
                      );
                    })}
                    <button disabled={page>=totalPages} onClick={() => setPage(p=>p+1)}
                      style={{ ...btnBase, background:page>=totalPages?'#f8fafc':'#fff', cursor:page>=totalPages?'not-allowed':'pointer',
                        display:'flex', alignItems:'center', gap:4, opacity:page>=totalPages?0.5:1 }}>
                      {t('orders.pagination.next')} {isRTL ? <NavArrowLeft width={14} height={14} /> : <NavArrowRight width={14} height={14} />}
                    </button>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
         ORDER DETAIL DRAWER
         ══════════════════════════════════════════════════════ */}
      {drawer && (
        <>
          <div onClick={() => { setDrawer(null); setDrawerFull(null); setDrawerStops([]); setDrawerPackages([]); }}
            style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', zIndex:9990, backdropFilter:'blur(4px)' }} />
          <div style={{ position:'fixed', top:0, [isRTL?'left':'right']:0, bottom:0, width:560, maxWidth:'96vw',
            background:'#ffffff', zIndex:9991, overflowY:'auto',
            boxShadow: isRTL ? '8px 0 50px rgba(0,0,0,0.18)' : '-8px 0 50px rgba(0,0,0,0.18)', display:'flex', flexDirection:'column' }}>

            {/* ── Drawer Header ── */}
            <div style={{ background:'linear-gradient(135deg,#0f172a,#1e293b)', padding:'22px 24px 20px', position:'relative' }}>
              <button onClick={() => { setDrawer(null); setDrawerFull(null); setDrawerStops([]); setDrawerPackages([]); }}
                style={{ position:'absolute', top:16, [isRTL?'left':'right']:16, background:'rgba(255,255,255,0.12)',
                  border:'none', color:'#fff', width:32, height:32, borderRadius:10,
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                  transition:'background 0.2s' }}
                onMouseOver={e => e.currentTarget.style.background='rgba(255,255,255,0.2)'}
                onMouseOut={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}>
                <Xmark width={16} height={16} />
              </button>

              {/* WorkOrder number + tracking */}
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14 }}>
                <div style={{ width:44, height:44, borderRadius:12,
                  background:'linear-gradient(135deg,#3b82f6,#2563eb)',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                  boxShadow:'0 4px 12px rgba(59,130,246,0.3)' }}>
                  <Package width={22} height={22} color="#fff" />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:'#fff', fontWeight:800, fontSize:18, letterSpacing:'-0.3px' }}>{drawer.work_order_number}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                    <span style={{ color:'#64748b', fontSize:11, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {drawer.service_status_token}
                    </span>
                    <button onClick={() => copyToken(drawer.service_status_token)} style={{
                      background:'rgba(255,255,255,0.1)', border:'none', borderRadius:4,
                      padding:'2px 6px', cursor:'pointer', color:'#94a3b8', fontSize:10, fontWeight:600,
                      display:'flex', alignItems:'center', gap:3,
                    }}>
                      <Copy width={10} height={10} /> {copied === drawer.service_status_token ? t('orders.drawer.copied') : t('orders.drawer.copy')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Status + quick change */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
                <StatusPill status={drawerFull?.status || drawer.status} />
                {(() => {
                  const curStatus = drawerFull?.status || drawer.status;
                  const allowed = VALID_TRANSITIONS_FRONTEND[curStatus] || [];
                  return (
                    <select value={curStatus}
                      onChange={e => handleStatusChange(drawer.id, e.target.value)}
                      style={{ padding:'5px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.15)',
                        background:'rgba(255,255,255,0.06)', color:'#cbd5e1', fontSize:11, fontWeight:600, cursor: allowed.length > 0 ? 'pointer' : 'default' }}>
                      {Object.entries(STATUS_META).map(([k]) => {
                        const isAllowed = k === curStatus || allowed.includes(k);
                        return (
                          <option key={k} value={k} disabled={!isAllowed}
                            style={{ color: isAllowed ? '#1e293b' : '#94a3b8' }}>
                            {t(`orders.status.${k}`)}
                          </option>
                        );
                      })}
                    </select>
                  );
                })()}
              </div>

              {/* Action buttons + WhatsApp - single icon row */}
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                {[
                  ...(!['completed','cancelled'].includes(drawer.status) ? [{ label: t('orders.actions.edit'), icon: EditPencil, bg:'#3b82f6', onClick:() => { setDrawer(null); setDrawerFull(null); setDrawerStops([]); setDrawerPackages([]); openEdit(drawerFull || drawer); }}] : []),
                  { label: drawerPackages.length > 1 ? t('orders.drawer.labels_count', { count: drawerPackages.length }) : t('orders.drawer.label'), icon: Printer, bg:'#8b5cf6', onClick:() => printSingleLabel(drawer.id) },
                  ...(drawer.service_status_token && !['completed','cancelled'].includes(drawer.status) ? [{ label: t('orders.drawer.track'), icon: OpenNewWindow, bg:'#0369a1', onClick:() => window.open(`/track/${drawer.service_status_token}`, '_blank') }] : []),
                  ...(drawerFull ? [{ label: t('orders.drawer.details'), icon: ArrowRight, bg:'#1e3a6b', onClick:() => { setDrawer(null); setDrawerFull(null); setDrawerStops([]); setDrawerPackages([]); navigate(`/work-orders/${drawerFull.id}`); }}] : []),
                  ...(!['completed','cancelled'].includes(drawer.status) ? [{ label: t('orders.actions.cancel_order'), icon: Prohibition, bg:'transparent', border:true, onClick:() => { setDrawer(null); setCancelConfirm(drawer); }}] : []),
                  // WhatsApp buttons inline
                  ...(() => {
                    const o = drawerFull || drawer;
                    if (!o) return [];
                    const pkgs = drawerPackages || [];
                    const url = o.service_status_token ? `${window.location.origin}/track/${o.service_status_token}` : '';
                    const recipientMap = {};
                    pkgs.forEach(pkg => {
                      const key = `${(pkg.customer_name || pkg.recipient_name || '').trim().toLowerCase()}|${(pkg.recipient_phone || '').trim()}|${(pkg.address || '').trim().toLowerCase()}`;
                      if (!recipientMap[key]) recipientMap[key] = { ...pkg, pkgCount: 1 };
                      else recipientMap[key].pkgCount++;
                    });
                    const uniqueRecipients = Object.values(recipientMap);
                    const isMulti = uniqueRecipients.length > 1;
                    if (isMulti) {
                      return uniqueRecipients.filter(pkg => pkg.recipient_phone).map((pkg, i) => {
                        const phone = pkg.recipient_phone;
                        const stopOrder = { ...o, recipient_name: pkg.customer_name || pkg.recipient_name || `Stop ${i+1}`, recipient_phone: phone, recipient_address: pkg.address || pkg.recipient_address, recipient_area: pkg.area || pkg.recipient_area, recipient_emirate: pkg.emirate || pkg.recipient_emirate, cash_amount: pkg.cash_amount || 0 };
                        return { label: `WhatsApp: ${pkg.customer_name || pkg.recipient_name || `Stop ${i+1}`}`, icon: null, waIcon: true, bg:'#25D366', onClick:() => openWhatsApp(phone, buildWAServiceMessage(stopOrder, url, cur)) };
                      });
                    }
                    if (o.customer_phone || o.recipient_phone) {
                      return [{ label: t('orders.actions.share_whatsapp', 'Share via WhatsApp'), icon: null, waIcon: true, bg:'#25D366', onClick:() => openWhatsApp(o.customer_phone || o.recipient_phone, buildWAServiceMessage(o, url, cur)) }];
                    }
                    return [];
                  })(),
                ].map((btn, i) => (
                  <div key={i} style={{ position:'relative', flexShrink:0 }}
                    onMouseOver={e => {
                      const tip = e.currentTarget.querySelector('.drawer-tip');
                      if (tip) tip.style.opacity='1';
                      const b = e.currentTarget.querySelector('button');
                      if (b) { b.style.opacity='0.85'; b.style.transform='scale(1.1)'; }
                    }}
                    onMouseOut={e => {
                      const tip = e.currentTarget.querySelector('.drawer-tip');
                      if (tip) tip.style.opacity='0';
                      const b = e.currentTarget.querySelector('button');
                      if (b) { b.style.opacity='1'; b.style.transform='scale(1)'; }
                    }}>
                    <button onClick={btn.onClick} style={{
                      width:38, height:38, borderRadius:12,
                      border: btn.border ? '1.5px solid rgba(255,255,255,0.25)' : 'none',
                      background: btn.border ? 'rgba(255,255,255,0.08)' : btn.bg, color:'#fff',
                      cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                      transition:'all 0.2s',
                    }}>
                      {btn.waIcon ? <WhatsAppIcon size={17} color="#fff" /> : <btn.icon width={17} height={17} />}
                    </button>
                    <span className="drawer-tip" style={{
                      position:'absolute', left:'50%', top:'100%', transform:'translateX(-50%)',
                      marginTop:6, background:'#0f172a', color:'#fff', fontSize:10, fontWeight:600,
                      padding:'4px 10px', borderRadius:6, whiteSpace:'nowrap', pointerEvents:'none',
                      opacity:0, transition:'opacity 0.15s', zIndex:10,
                      boxShadow:'0 4px 12px rgba(0,0,0,0.25)',
                    }}>{btn.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Drawer Body ── */}
            <div style={{ padding:'18px 20px', flex:1 }}>
              {drawerLoading ? (
                <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>
                  <div style={{ width:32, height:32, border:'3px solid #e2e8f0', borderTopColor:'#3b82f6',
                    borderRadius:'50%', margin:'0 auto 12px', animation:'spin 0.8s linear infinite' }} />
                  {t('orders.drawer.loading')}
                </div>
              ) : drawerFull ? (
                <>
                  {/* ── Quick Stats Grid ── */}
                  {/* Weight + COD tiles were carry-overs from the delivery UI and
                      always read "0" / "\u2014" for a workshop job card. Kept just
                      the service fee + order type. */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:18 }}>
                    {[
                      { label:t('orders.drawer.service_fee'), value:fmtAED(drawerFull.service_fee), color:'#16a34a', bg:'#f0fdf4', Icon:DollarCircle },
                      { label:t('orders.drawer.type'),         value:fmtType(drawerFull.work_order_type),  color:'#7c3aed', bg:'#faf5ff', Icon:Package },
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

                  {/* ── Packages with Barcodes ── */}
                  {drawerPackages.length > 0 && (
                    <div style={{ background:'#fff', borderRadius:12, marginBottom:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
                      <div style={{ padding:'12px 14px', borderBottom:'1px solid #f1f5f9',
                        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <span style={{ fontWeight:700, fontSize:12, color:'#0f172a',
                          display:'flex', alignItems:'center', gap:6, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                          <Package width={14} height={14} color="#6366f1" /> {t('orders.drawer.packages')}
                        </span>
                        <span style={{ fontSize:10, fontWeight:700, color:'#6366f1',
                          background:'#eef2ff', padding:'2px 8px', borderRadius:10 }}>
                          {t('orders.drawer.delivered_count', { delivered: drawerPackages.filter(p => p.status === 'delivered').length, total: drawerPackages.length })}
                        </span>
                      </div>
                      <div style={{ padding:'8px 12px' }}>
                        {drawerPackages.map((pkg, i) => {
                          const ps = PKG_STATUS_MAP[pkg.status] || PKG_STATUS_MAP.created;
                          return (
                            <div key={pkg.id || i} style={{
                              display:'flex', alignItems:'center', gap:10, padding:'8px 0',
                              borderBottom: i < drawerPackages.length - 1 ? '1px solid #f8fafc' : 'none',
                            }}>
                              <div style={{ width:28, height:28, borderRadius:8, background:ps.bg, flexShrink:0,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                fontWeight:800, fontSize:10, color:ps.color }}>
                                {pkg.sequence}
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                                  <span style={{ fontWeight:600, fontSize:12, color:'#1e293b' }}>
                                    {pkg.customer_name || pkg.recipient_name || t('orders.drawer.package_num', { num: pkg.sequence })}
                                  </span>
                                  <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:8,
                                    background:ps.bg, color:ps.color }}>{ps.label}</span>
                                </div>
                                {pkg.barcode && <SidebarBarcode value={pkg.barcode} />}
                                <div style={{ display:'flex', gap:6, marginTop:2, fontSize:10, color:'#94a3b8', flexWrap:'wrap' }}>
                                  {pkg.payment_method && (
                                    <span style={{ fontWeight:700, padding:'1px 5px', borderRadius:4,
                                      background: pkg.payment_method === 'cod' ? '#fef3c7' : '#eff6ff',
                                      color: pkg.payment_method === 'cod' ? '#b45309' : '#2563eb' }}>
                                      {pkg.payment_method === 'cod' ? t('orders.drawer.cod_label') : pkg.payment_method.toUpperCase()}
                                    </span>
                                  )}
                                  {pkg.address && (
                                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200 }}>
                                      {pkg.address}
                                    </span>
                                  )}
                                  {pkg.cash_amount > 0 && (
                                    <span style={{ fontWeight:700, color:'#d97706' }}>{t('orders.drawer.cod_label')}: {parseFloat(pkg.cash_amount).toFixed(0)}</span>
                                  )}
                                  {parseFloat(pkg.discount) > 0 && (
                                    <span style={{ fontWeight:700, color:'#dc2626' }}>{t('orders.drawer.disc_label')}: {parseFloat(pkg.discount).toFixed(0)}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Sender + Recipient(s) ── */}
                  {(() => {
                    /* Group packages by unique recipient (name+phone+address) → each group = 1 stop */
                    const stopMap = {};
                    drawerPackages.forEach((pkg, i) => {
                      const key = `${(pkg.customer_name || pkg.recipient_name || '').trim().toLowerCase()}|${(pkg.recipient_phone || '').trim()}|${(pkg.address || '').trim().toLowerCase()}`;
                      if (!stopMap[key]) {
                        stopMap[key] = {
                          seq: pkg.sequence || i + 1,
                          name: pkg.customer_name || pkg.recipient_name || `Package ${pkg.sequence || i + 1}`,
                          phone: pkg.recipient_phone,
                          address: pkg.address,
                          area: pkg.area,
                          emirate: pkg.emirate,
                          packages: [pkg],
                        };
                      } else {
                        stopMap[key].packages.push(pkg);
                      }
                    });
                    const recipients = Object.values(stopMap);
                    const isMultiRecipient = recipients.length > 1;
                    return (
                      <div style={{ display:'grid', gridTemplateColumns: isMultiRecipient ? '1fr' : '1fr 1fr', gap:10, marginBottom:14 }}>
                        {/* Customer / Sender */}
                        <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                          <div style={{ fontWeight:700, fontSize:10, marginBottom:8, color:'#64748b',
                            display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                            <Building width={12} height={12} color="#3b82f6" /> {t('orders.drawer.customer_sender')}
                          </div>
                          {drawerFull.customer_name ? (
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <Avatar name={drawerFull.customer_name} size={32} />
                              <div>
                                <div style={{ fontWeight:700, fontSize:13, color:'#0f172a' }}>{drawerFull.customer_name}</div>
                                {drawerFull.company_name && <div style={{ fontSize:10, color:'#64748b' }}>{drawerFull.company_name}</div>}
                                {drawerFull.customer_phone && <div style={{ fontSize:10, color:'#94a3b8' }}>{drawerFull.customer_phone}</div>}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div style={{ fontWeight:700, fontSize:13, color:'#0f172a' }}>{drawerFull.sender_name || t('orders.walk_in')}</div>
                              {drawerFull.sender_phone && <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{drawerFull.sender_phone}</div>}
                              {drawerFull.sender_address && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2, lineHeight:'1.3' }}>{drawerFull.sender_address}</div>}
                            </div>
                          )}
                        </div>

                        {/* Single Recipient (normal order) */}
                        {!isMultiRecipient && (
                          <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                            <div style={{ fontWeight:700, fontSize:10, marginBottom:8, color:'#64748b',
                              display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                              <User width={12} height={12} color="#f97316" /> {t('orders.drawer.recipient')}
                            </div>
                            <div style={{ fontWeight:700, fontSize:13, color:'#0f172a' }}>{drawerFull.recipient_name || '\u2014'}</div>
                            {drawerFull.recipient_phone && (
                              <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:2 }}>
                                <a href={`tel:${drawerFull.recipient_phone}`} style={{ fontSize:11, color:'#3b82f6', textDecoration:'none', fontWeight:600 }}>
                                  {drawerFull.recipient_phone}
                                </a>
                              </div>
                            )}
                            {drawerFull.recipient_address && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2, lineHeight:'1.3' }}>{drawerFull.recipient_address}</div>}
                            {(drawerFull.recipient_area || drawerFull.recipient_emirate) && (
                              <div style={{ fontSize:10, color:'#64748b', marginTop:1 }}>
                                {[drawerFull.recipient_area, drawerFull.recipient_emirate].filter(Boolean).join(', ')}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Multiple Recipients (multi-stop) */}
                        {isMultiRecipient && (
                          <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
                            <div style={{ padding:'10px 14px', borderBottom:'1px solid #f1f5f9',
                              display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                              <span style={{ fontWeight:700, fontSize:10, color:'#64748b',
                                display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                                <User width={12} height={12} color="#f97316" /> {t('orders.drawer.recipients')}
                              </span>
                              <span style={{ fontSize:10, fontWeight:700, color:'#f97316',
                                background:'#fff7ed', padding:'2px 8px', borderRadius:10 }}>
                                {recipients.length === 1 ? t('orders.drawer.stops_count', { count: recipients.length }) : t('orders.drawer.stops_count_plural', { count: recipients.length })}{drawerPackages.length > recipients.length ? ` · ${t('orders.drawer.pkg_count', { count: drawerPackages.length })}` : ''}
                              </span>
                            </div>
                            <div style={{ padding:'6px 10px' }}>
                              {recipients.map((r, i) => {
                                const deliveredCount = r.packages.filter(p => p.status === 'delivered').length;
                                const allDelivered = deliveredCount === r.packages.length;
                                const someDelivered = deliveredCount > 0;
                                return (
                                  <div key={i} style={{
                                    display:'flex', gap:10, padding:'8px 4px',
                                    borderBottom: i < recipients.length - 1 ? '1px solid #f1f5f9' : 'none',
                                  }}>
                                    <div style={{
                                      width:26, height:26, borderRadius:'50%', flexShrink:0,
                                      background:'linear-gradient(135deg,#f97316,#fb923c)', color:'#fff',
                                      display:'flex', alignItems:'center', justifyContent:'center',
                                      fontWeight:800, fontSize:10,
                                    }}>{r.seq}</div>
                                    <div style={{ flex:1, minWidth:0 }}>
                                      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:1 }}>
                                        <span style={{ fontWeight:700, fontSize:12, color:'#0f172a' }}>{r.name}</span>
                                        <span style={{ fontSize:8, fontWeight:700, padding:'1px 5px', borderRadius:6,
                                          background: allDelivered ? '#dcfce7' : someDelivered ? '#fef3c7' : '#f1f5f9',
                                          color: allDelivered ? '#16a34a' : someDelivered ? '#d97706' : '#64748b' }}>
                                          {t('orders.drawer.delivered_count', { delivered: deliveredCount, total: r.packages.length })}
                                        </span>
                                      </div>
                                      {r.phone && (
                                        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                                          <a href={`tel:${r.phone}`} style={{ fontSize:10, color:'#3b82f6', textDecoration:'none', fontWeight:600 }}>
                                            {r.phone}
                                          </a>
                                        </div>
                                      )}
                                      {r.address && (
                                        <div style={{ fontSize:10, color:'#94a3b8', marginTop:1, lineHeight:'1.3' }}>{r.address}</div>
                                      )}
                                      {(r.area || r.emirate) && (
                                        <div style={{ fontSize:9, color:'#64748b', marginTop:1 }}>
                                          {[r.area, r.emirate].filter(Boolean).join(', ')}
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
                    );
                  })()}

                  {/* ── Delivery Details ── */}
                  <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0', marginBottom:14 }}>
                    <div style={{ fontWeight:700, fontSize:10, marginBottom:8, color:'#64748b',
                      display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                      <Wrench width={12} height={12} color="#8b5cf6" /> {t('orders.drawer.job_details', 'Job Details')}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 16px' }}>
                      {[
                        { label:t('orders.drawer.mechanic', 'Technician'), value: drawerFull.mechanic_name ? `${drawerFull.mechanic_name}${drawerFull.mechanic_specialty ? ` · ${fmtType(drawerFull.mechanic_specialty)}` : ''}` : null, assignable: !drawerFull.mechanic_name },
                        { label:t('orders.drawer.service_category', 'Category'), value: drawerFull.service_category ? fmtType(drawerFull.service_category) : ((() => { const cat = categories.find(c=>c.slug===drawerFull.category); return cat ? (isRTL && cat.name_ar ? cat.name_ar : cat.name) : fmtType(drawerFull.category); })()) },
                        { label:t('orders.drawer.vehicle', 'Vehicle'), value: [drawerFull.vehicle_make, drawerFull.vehicle_model, drawerFull.vehicle_year].filter(Boolean).join(' ') || null },
                        { label:t('orders.drawer.plate', 'Plate'), value: drawerFull.vehicle_plate_number },
                        { label:t('orders.drawer.bay', 'Service Bay'), value: drawerFull.service_bay_name || drawerFull.zone_name },
                        { label:t('orders.drawer.scheduled', 'Scheduled'), value: drawerFull.scheduled_at ? `${fmtDate(drawerFull.scheduled_at)} ${fmtTime(drawerFull.scheduled_at)}` : null },
                      ].filter(r=>r.value || r.assignable).map(row => (
                        <div key={row.label} style={{ padding:'4px 0' }}>
                          <div style={{ fontSize:9, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2 }}>{row.label}</div>
                          {row.assignable ? (
                            <button onClick={() => { setMechanicPicker({ workOrderId: drawerFull.id }); setMechanicSearch(''); }}
                              style={{ background:'#eef2ff', color:'#6366f1', border:'none', borderRadius:6,
                                padding:'3px 8px', fontSize:11, fontWeight:700, cursor:'pointer',
                                display:'flex', alignItems:'center', gap:3 }}>
                              <Plus width={10} height={10} /> {t('orders.drawer.assign', 'Assign')}
                            </button>
                          ) : (
                            <div style={{ fontSize:12, fontWeight:600, color:'#1e293b' }}>{row.value || '\u2014'}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Notes ── */}
                  {(drawerFull.description || drawerFull.special_instructions || drawerFull.notes) && (
                    <div style={{ background:'#fffbeb', borderRadius:12, padding:'12px 14px', border:'1px solid #fef3c7', marginBottom:14 }}>
                      <div style={{ fontWeight:700, fontSize:10, marginBottom:6, color:'#92400e',
                        display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                        <Eye width={12} height={12} color="#d97706" /> {t('orders.drawer.notes_instructions')}
                      </div>
                      {[
                        { label:t('orders.drawer.description'), text: drawerFull.description },
                        { label:t('orders.drawer.special_instructions'), text: drawerFull.special_instructions },
                      ].filter(n=>n.text).map(n => (
                        <div key={n.label} style={{ marginBottom:4 }}>
                          <div style={{ fontSize:9, fontWeight:700, color:'#b45309', textTransform:'uppercase', marginBottom:1 }}>{n.label}</div>
                          <div style={{ fontSize:12, color:'#78350f', whiteSpace:'pre-wrap', lineHeight:'1.4' }}>{n.text}</div>
                        </div>
                      ))}
                      {(() => {
                        const parsed = parseSrcNotes(drawerFull.notes);
                        if (parsed.kind === 'empty') return null;
                        if (parsed.kind === 'json' && parsed.entries.length > 0) {
                          return (
                            <div style={{ marginTop: 6 }}>
                              <div style={{ fontSize:9, fontWeight:700, color:'#b45309', textTransform:'uppercase', marginBottom:4, display:'flex', alignItems:'center', gap:6 }}>
                                {t('orders.drawer.internal_notes')}
                                {parsed.source && (
                                  <span style={{ fontSize:8, fontWeight:700, color:'#78350f', background:'#fde68a', padding:'1px 5px', borderRadius:4, letterSpacing:'0.03em' }}>
                                    {parsed.source}
                                  </span>
                                )}
                              </div>
                              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 12px' }}>
                                {parsed.entries.map(([label, value]) => (
                                  <div key={label} style={{ fontSize:11, color:'#78350f' }}>
                                    <span style={{ fontWeight:700, marginRight:4 }}>{label}:</span>
                                    <span>{value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div style={{ marginBottom:4 }}>
                            <div style={{ fontSize:9, fontWeight:700, color:'#b45309', textTransform:'uppercase', marginBottom:1 }}>{t('orders.drawer.internal_notes')}</div>
                            <div style={{ fontSize:12, color:'#78350f', whiteSpace:'pre-wrap', lineHeight:'1.4' }}>{parsed.text}</div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* ── Delivery Stops ── */}
                  {drawerStops.length > 0 && (
                    <div style={{ background:'#fff', borderRadius:12, marginBottom:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
                      <div style={{ padding:'12px 14px', borderBottom:'1px solid #f1f5f9',
                        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <span style={{ fontWeight:700, fontSize:12, color:'#0f172a',
                          display:'flex', alignItems:'center', gap:6, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                          <MapPin width={14} height={14} color="#f97316" /> {t('orders.drawer.delivery_stops')}
                        </span>
                        <span style={{ fontSize:10, fontWeight:700, color:'#fff',
                          background:'linear-gradient(135deg,#16a34a,#22c55e)', padding:'2px 8px', borderRadius:10 }}>
                          {drawerStops.filter(s => s.status === 'completed').length}/{drawerStops.length}
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div style={{ height:3, background:'#f1f5f9', margin:'0 14px' }}>
                        <div style={{ height:'100%', borderRadius:2, background:'linear-gradient(90deg,#16a34a,#4ade80)', transition:'width .4s ease',
                          width: `${(drawerStops.filter(s=>s.status==='completed').length / drawerStops.length)*100}%` }} />
                      </div>
                      <div style={{ padding:'10px 14px' }}>
                        {drawerStops.map((stop, i) => {
                          const statusColors = { pending:'#d97706', arrived:'#8b5cf6', completed:'#16a34a', failed:'#dc2626', skipped:'#94a3b8' };
                          const statusBg     = { pending:'#fef3c7', arrived:'#f3e8ff', completed:'#dcfce7', failed:'#fee2e2', skipped:'#f1f5f9' };
                          const typeBg       = { pickup:'#e0f2fe', delivery:'#eef2ff', return:'#fff7ed' };
                          const typeColor    = { pickup:'#0369a1', delivery:'#6366f1', return:'#ea580c' };
                          return (
                            <div key={stop.id} style={{ display:'flex', gap:10, position:'relative',
                              paddingBottom: i < drawerStops.length-1 ? 12 : 0 }}>
                              {i < drawerStops.length-1 && (
                                <div style={{ position:'absolute', [isRTL?'right':'left']:11, top:24, bottom:0, width:2,
                                  background: stop.status === 'completed' ? '#16a34a' : '#e2e8f0' }} />
                              )}
                              <div style={{ width:24, height:24, borderRadius:8, flexShrink:0, zIndex:1,
                                background: statusColors[stop.status] || '#94a3b8', color:'#fff',
                                display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:10 }}>
                                {stop.sequence_number || i+1}
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2 }}>
                                  <span style={{ fontSize:8, fontWeight:800, textTransform:'uppercase', letterSpacing:'.4px',
                                    padding:'1px 5px', borderRadius:3, background: typeBg[stop.stop_type] || '#f1f5f9',
                                    color: typeColor[stop.stop_type] || '#64748b' }}>{stop.stop_type}</span>
                                  <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:8,
                                    background: statusBg[stop.status] || '#f1f5f9', color: statusColors[stop.status] || '#94a3b8' }}>
                                    {stop.status}
                                  </span>
                                </div>
                                {stop.contact_name && <div style={{ fontWeight:700, fontSize:12, color:'#1e293b' }}>{stop.contact_name}</div>}
                                <div style={{ fontSize:11, color:'#64748b', display:'flex', alignItems:'flex-start', gap:3, marginTop:1, lineHeight:'1.3' }}>
                                  <MapPin width={10} height={10} style={{ marginTop:2, flexShrink:0, color:'#94a3b8' }} />
                                  <span style={{ overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{stop.address || 'No address'}</span>
                                </div>
                                {parseFloat(stop.cash_amount) > 0 && (
                                  <div style={{ fontSize:10, fontWeight:700, color:'#d97706', marginTop:3,
                                    background:'#fef3c7', display:'inline-flex', padding:'1px 6px', borderRadius:4 }}>
                                    COD: {cur} {parseFloat(stop.cash_amount).toFixed(2)}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}



                  {/* ── Status Timeline ── */}
                  {drawerFull.status_logs && drawerFull.status_logs.length > 0 && (
                    <details style={{ background:'#fff', borderRadius:12, marginBottom:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
                      <summary style={{
                        padding:'12px 14px', cursor:'pointer', userSelect:'none',
                        display:'flex', alignItems:'center', justifyContent:'space-between',
                        listStyle:'none', fontSize:12, fontWeight:700, color:'#0f172a',
                      }}>
                        <span style={{ display:'flex', alignItems:'center', gap:6, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                          <Clock width={14} height={14} color="#64748b" /> {t('orders.drawer.status_timeline')}
                        </span>
                        <span style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>{drawerFull.status_logs.length} events</span>
                      </summary>
                      <div style={{ padding:'0 14px 12px' }}>
                        {drawerFull.status_logs.map((log, i) => {
                          const m = STATUS_META[log.status] || STATUS_META.pending;
                          return (
                            <div key={i} style={{ display:'flex', gap:10, position:'relative',
                              paddingBottom: i < drawerFull.status_logs.length-1 ? 12 : 0 }}>
                              {i < drawerFull.status_logs.length - 1 && (
                                <div style={{ position:'absolute', [isRTL?'right':'left']:9, top:20, bottom:0, width:2, background:'#e2e8f0' }} />
                              )}
                              <div style={{ width:20, height:20, borderRadius:'50%', background:m.bg, flexShrink:0,
                                display:'flex', alignItems:'center', justifyContent:'center', zIndex:1 }}>
                                <m.icon width={10} height={10} style={{ color:m.color }} />
                              </div>
                              <div style={{ flex:1 }}>
                                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                  <span style={{ fontWeight:700, fontSize:11, color:m.color }}>{t(`orders.status.${log.status}`)}</span>
                                  <span style={{ fontSize:9, color:'#94a3b8' }}>{fmtDate(log.created_at)} {fmtTime(log.created_at)}</span>
                                </div>
                                {log.note && <div style={{ fontSize:10, color:'#64748b', marginTop:1 }}>{log.note}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}

                  {/* ── Items ── */}
                  {drawerFull.items && drawerFull.items.length > 0 && (
                    <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0', marginBottom:14 }}>
                      <div style={{ fontWeight:700, fontSize:10, marginBottom:8, color:'#64748b',
                        display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                        <Box3dPoint width={12} height={12} color="#64748b" /> {t('orders.drawer.items')} ({drawerFull.items.length})
                      </div>
                      {drawerFull.items.map((item, i) => (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                          padding:'5px 0', borderBottom: i < drawerFull.items.length-1 ? '1px solid #f8fafc' : 'none', fontSize:12 }}>
                          <div>
                            <div style={{ fontWeight:600, color:'#1e293b' }}>{item.name}</div>
                            <div style={{ fontSize:10, color:'#94a3b8' }}>Qty {item.quantity}{item.weight_kg ? ` · ${item.weight_kg}kg` : ''}</div>
                          </div>
                          {item.unit_price > 0 && (
                            <span style={{ fontWeight:700, color:'#16a34a', fontSize:11 }}>{cur} {parseFloat(item.unit_price).toFixed(2)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Meta timestamps ── */}
                  <div style={{ fontSize:10, color:'#94a3b8', display:'flex', flexWrap:'wrap', gap:'4px 12px' }}>
                    <span>Created: {fmtDate(drawerFull.created_at)} {fmtTime(drawerFull.created_at)}</span>
                    {drawerFull.started_at && <span>Picked up: {fmtDate(drawerFull.started_at)} {fmtTime(drawerFull.started_at)}</span>}
                    {drawerFull.completed_at && <span>Delivered: {fmtDate(drawerFull.completed_at)} {fmtTime(drawerFull.completed_at)}</span>}
                    {drawerFull.failed_at && <span>Failed: {fmtDate(drawerFull.failed_at)} {fmtTime(drawerFull.failed_at)}</span>}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════
         CREATE / EDIT 3-STEP WIZARD
         ══════════════════════════════════════════════════════ */}
      {showForm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1100,
          display:'flex', alignItems:'flex-start', justifyContent:'center',
          padding: _mob ? '8px' : '10px', 
          paddingTop: _mob ? '10px' : _tab ? '24px' : '40px',
          overflowY:'auto', 
          WebkitOverflowScrolling: 'touch' }}>
          <div style={{ background:'#fff', borderRadius: _mob ? 12 : 20, 
            width:'100%', 
            maxWidth: _mob ? '100%' : _tab ? '95%' : 1100,
            maxHeight: _mob ? 'calc(100vh - 20px)' : _tab ? 'calc(100vh - 48px)' : '90vh',
            minHeight: _mob ? 'auto' : '500px',
            display:'flex', flexDirection:'column', overflow:'hidden', 
            boxShadow:'0 24px 70px rgba(0,0,0,0.2)',
            margin: _mob ? '0' : 'auto' }}>

            {/* Modal Header */}
            <div style={{ padding: _mob ? '14px 16px 0' : '22px 28px 0', 
              display:'flex', justifyContent:'space-between', alignItems:'center', gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 style={{ margin:0, fontSize: _mob ? 16 : 20, fontWeight:800, color:'#1e293b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {selected ? `${t('orders.edit_order')} \u2014 ${selected.work_order_number}` : t('orders.new_order')}
                </h3>
                <p style={{ margin:'3px 0 0', color:'#94a3b8', fontSize: _mob ? 11 : 13 }}>
                  {t('common.step')} {step} {t('common.of')} {STEPS.length} {'\u2014'} {t(STEPS[step-1].descKey)}
                  {step > 1 && <span style={{ marginLeft:8, fontWeight:600, color:'#ea580c' }}>{'\u00B7'} {stops.length} {stops.length===1 ? t('orders.stops.stop') : t('orders.stops.stops')} {'\u00B7'} {stops.reduce((a,s)=>a+s.packages.length,0)} {t('orders.stops.packages_total')}</span>}
                </p>
              </div>
              <button type="button" onClick={closeForm}
                style={{ background:'#f1f5f9', border:'none', cursor:'pointer', color:'#64748b',
                  width: _mob ? 32 : 34, 
                  height: _mob ? 32 : 34, flexShrink: 0,
                  borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Xmark width={_mob ? 14 : 16} height={_mob ? 14 : 16} />
              </button>
            </div>

            <StepBar current={step} t={t} />
            <div style={{ margin:'20px 0 0', height:1, background:'#f1f5f9' }} />

            <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
              <div style={{ overflowY:'auto', overflowX:'visible', flex:1, 
                padding: _mob ? '12px 14px 0' : _tab ? '18px 22px 0' : '22px 28px 0',
                WebkitOverflowScrolling: 'touch' }}>
                {formError && (
                  <div style={{ background:'#fee2e2', color:'#dc2626', padding:'10px 14px',
                    borderRadius:8, marginBottom:16, fontSize:14, display:'flex', alignItems:'center', gap:8 }}>
                    <WarningTriangle width={16} height={16} /> {formError}
                  </div>
                )}

                {/* ── WorkOrder Mode Selector ── */}
                {!selected && (
                  <div style={{ display:'flex', gap:8, marginBottom:18, padding:6, background:'#f8fafc', borderRadius:12, border:'1px solid #e2e8f0' }}>
                    {[
                      { key:'single',     icon:<Mail width={16} height={16} />, label:t('orders.mode.single'),     desc:t('orders.mode.single_desc'), locked:false },
                      { key:'multi_stop', icon:<MapPin width={16} height={16} />, label:t('orders.mode.multi_stop'), desc:t('orders.mode.multi_stop_desc'), locked:!hasFeature('multi_stop') },
                      { key:'barcode',    icon:<ScanBarcode width={16} height={16} />, label:t('orders.mode.barcode'),    desc:t('orders.mode.barcode_desc'), locked:false },
                    ].map(m => (
                      <button key={m.key} type="button" onClick={() => {
                        if (m.locked) { setShowUpgradeModal(true); return; }
                        setOrderMode(m.key);
                        if (m.key === 'single' && stops.length > 1) setStops(prev => [prev[0]]);
                      }}
                        style={{ flex:1, padding: _mob ? '8px 4px' : '10px 8px', borderRadius:10,
                          border: orderMode === m.key ? '2px solid #f97316' : '2px solid transparent',
                          background: m.locked ? '#f1f5f9' : orderMode === m.key ? 'linear-gradient(135deg,#fff7ed,#fef3c7)' : '#fff',
                          cursor: m.locked ? 'not-allowed' : 'pointer', textAlign:'center', transition:'all 0.15s',
                          opacity: m.locked ? 0.6 : 1, position:'relative' }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                          <span style={{ display:'flex', color: m.locked ? '#94a3b8' : orderMode === m.key ? '#ea580c' : '#94a3b8' }}>{m.icon}</span>
                          <span style={{ fontWeight:700, fontSize: _mob ? 11 : 13, color: m.locked ? '#94a3b8' : orderMode === m.key ? '#ea580c' : '#64748b' }}>{m.label}</span>
                          {m.locked && <span style={{ fontSize:10, marginLeft:2 }}>🔒</span>}
                        </div>
                        {!_mob && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{m.locked ? t('orders.mode.upgrade_required') || 'Growth plan required' : m.desc}</div>}
                      </button>
                    ))}
                  </div>
                )}

                {/* ═══════ Step 1: Sender & Pickup ═══════ */}
                {step === 1 && (() => { const _bizNoAddr = form.sender_type === 'business' && (!workshopInfo || !workshopInfo.address); const _showMap = (form.sender_type === 'customer' && !form.customer_id) || _bizNoAddr; return (
                  <div style={{ display:'flex',
                    flexDirection: (_mob || _tab) ? 'column' : (isRTL ? 'row-reverse' : 'row'),
                    gap: _mob ? 12 : 24 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr' : '1fr 1fr', gap: _mob ? 10 : 16 }}>

                    {/* Pre-printed barcode (only create, prominent in barcode mode) */}
                    {!selected && (
                      <div style={{ gridColumn:'1/-1', marginBottom: 4,
                        ...(orderMode === 'barcode' ? { padding:14, background:'linear-gradient(135deg,#eff6ff,#dbeafe)', borderRadius:12, border:'2px solid #93c5fd' } : {}) }}>
                        <label style={LABEL}>
                          <ScanBarcode width={13} height={13} style={{ verticalAlign:-2, marginRight:4 }} />
                          {t('orders.form.scan_barcode')}
                        </label>
                        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                          <input value={form.pregenerated_token}
                            onChange={async (e) => {
                              const val = e.target.value.toUpperCase();
                              set('pregenerated_token', val);
                              setPreTokenValidation(null);
                              if (val.length >= 8) {
                                try {
                                  const res = await api.post('/work-orders/validate-pregenerated', { service_status_token: val });
                                  if (res.success) setPreTokenValidation(res.data);
                                } catch {}
                              }
                            }}
                            style={{ ...INPUT, flex:1, fontFamily:'monospace', fontSize:15, letterSpacing:1 }}
                            placeholder="TRS-XXXXXXXX" autoComplete="off" autoFocus={orderMode === 'barcode'} />
                          {preTokenValidation && (
                            <span style={{ fontSize:12, fontWeight:600, whiteSpace:'nowrap',
                              color: preTokenValidation.valid ? '#16a34a' : '#dc2626' }}>
                              {preTokenValidation.valid ? '\u2713 Valid' : preTokenValidation.reason === 'already_used'
                                  ? `\u2717 Used (${preTokenValidation.work_order_number})` : preTokenValidation.reason === 'expired' ? '\u2717 Expired' : '\u2717 Not found'}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Sender Type Toggle ── */}
                    <div style={{ gridColumn:'1/-1' }}>
                      <label style={LABEL}>{t('orders.form.sender_type_label')}</label>
                      <div style={{ display:'flex', gap:8 }}>
                        {[
                          { key:'business', icon: <Building width={15} height={15} />, label: t('orders.form.sender_business'), desc: t('orders.form.sender_business_desc') },
                          { key:'customer',   icon: <User width={15} height={15} />,     label: t('orders.form.sender_customer'),   desc: t('orders.form.sender_customer_desc') },
                        ].map(st => (
                          <button key={st.key} type="button" onClick={() => set('sender_type', st.key)}
                            style={{ flex:1, padding: _mob ? '10px 8px' : '12px 14px', borderRadius:10,
                              border: form.sender_type === st.key ? '2px solid #f97316' : '2px solid #e2e8f0',
                              background: form.sender_type === st.key ? 'linear-gradient(135deg,#fff7ed,#fef3c7)' : '#fff',
                              cursor:'pointer', transition:'all 0.15s', textAlign: isRTL ? 'right' : 'left' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ display:'flex', color: form.sender_type === st.key ? '#ea580c' : '#94a3b8' }}>{st.icon}</span>
                              <span style={{ fontWeight:700, fontSize:13, color: form.sender_type === st.key ? '#ea580c' : '#64748b' }}>{st.label}</span>
                            </div>
                            {!_mob && <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>{st.desc}</div>}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ── Business sender info card ── */}
                    {form.sender_type === 'business' && workshopInfo && (
                      <div style={{ gridColumn:'1/-1', padding:'12px 16px', background:'linear-gradient(135deg,#f0fdf4,#ecfdf5)',
                        borderRadius:10, border:'1px solid #bbf7d0' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                          <Building width={14} height={14} color="#16a34a" />
                          <span style={{ fontWeight:700, fontSize:12, color:'#16a34a' }}>{t('orders.form.business_sender_info')}</span>
                        </div>
                        <div style={{ fontSize:13, color:'#374151', lineHeight:1.7 }}>
                          <div><strong>{workshopInfo.name}</strong></div>
                          {workshopInfo.phone && <div>{workshopInfo.phone}</div>}
                          {workshopInfo.email && <div style={{ color:'#64748b' }}>{workshopInfo.email}</div>}
                          {(workshopInfo.address || workshopInfo.city) && (
                            <div style={{ color:'#64748b', fontSize:12 }}>{[workshopInfo.address, workshopInfo.city, workshopInfo.country].filter(Boolean).join(', ')}</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Business sender: no address hint ── */}
                    {form.sender_type === 'business' && (!workshopInfo || !workshopInfo.address) && (
                      <div style={{ gridColumn:'1/-1', padding:'10px 14px', background:'linear-gradient(135deg,#fffbeb,#fef3c7)',
                        borderRadius:10, border:'1px solid #fde68a', display:'flex', alignItems:'center', gap:8 }}>
                        <MapPin width={16} height={16} color="#d97706" style={{ flexShrink:0 }} />
                        <span style={{ fontSize:12, color:'#92400e', fontWeight:600 }}>{t('orders.form.no_business_address_hint')}</span>
                      </div>
                    )}

                    {/* ── Business sender: editable fields ── */}
                    {form.sender_type === 'business' && (
                      <>
                        <div>
                          <label style={LABEL}>{t('orders.form.sender_name')} *</label>
                          <input value={form.sender_name} onChange={e=>set('sender_name',e.target.value)}
                            style={INPUT} placeholder={t('orders.placeholders.company_or_person')} />
                        </div>
                        <div>
                          <label style={LABEL}>{t('orders.form.sender_phone')} *</label>
                          <input value={form.sender_phone} onChange={e=>set('sender_phone',e.target.value)}
                            style={INPUT} placeholder={t('orders.placeholders.phone')} />
                        </div>
                        <div style={{ gridColumn:'1/-1' }}>
                          <label style={LABEL}>{t('orders.form.sender_address')}</label>
                          <input value={form.sender_address} onChange={e=>set('sender_address',e.target.value)}
                            style={INPUT} placeholder={t('orders.placeholders.pickup_address')} />
                        </div>
                      </>
                    )}

                    {/* ── Customer sender: customer select + auto-fill ── */}
                    {form.sender_type === 'customer' && (
                      <>
                        <div style={{ gridColumn:'1/-1' }}>
                          <label style={LABEL}>{t('orders.form.customer_selection')}</label>
                          <select value={form.customer_id} onChange={e=>set('customer_id',e.target.value)} style={INPUT}>
                            <option value="">{t('orders.form.no_customer')}</option>
                            {customers.filter(c=>!!c.is_active).map(c => (
                              <option key={c.id} value={c.id}>{c.full_name}{c.company_name ? ` \u2014 ${c.company_name}` : ''} ({c.phone})</option>
                            ))}
                          </select>
                          {form.customer_id && (() => {
                            const c = customers.find(cl=>String(cl.id)===String(form.customer_id));
                            return c ? (
                              <div style={{ marginTop:8, padding:'10px 14px', background:'#eff6ff', borderRadius:10, border:'1px solid #dbeafe', fontSize:12 }}>
                                <div style={{ fontWeight:700, color:'#1d4ed8', marginBottom:4 }}>{t('orders.form.customer_selected')}</div>
                                <div style={{ color:'#64748b' }}>{c.full_name} {'\u00B7'} {c.phone} {'\u00B7'} {c.emirate}</div>
                              </div>
                            ) : null;
                          })()}
                        </div>

                        {/* Divider */}
                        <div style={{ gridColumn:'1/-1', padding:'8px 0' }}>
                          <div style={{ height:1, background:'#f1f5f9', position:'relative' }}>
                            <span style={{ position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)',
                              background:'#fff', padding:'0 12px', fontSize:12, color:'#94a3b8', fontWeight:600 }}>
                              {form.customer_id ? t('orders.form.auto_filled') : t('orders.form.sender_details')}
                            </span>
                          </div>
                        </div>

                        {/* Sender info */}
                        <div>
                          <label style={LABEL}>{t('orders.form.sender_name')} {form.customer_id ? '' : '*'}</label>
                          <input value={form.sender_name} onChange={e=>set('sender_name',e.target.value)}
                            style={{ ...INPUT, background: form.customer_id ? '#f8fafc' : '#fff' }}
                            placeholder={t('orders.placeholders.company_or_person')} readOnly={!!form.customer_id} />
                        </div>
                        <div>
                          <label style={LABEL}>{t('orders.form.sender_phone')} {form.customer_id ? '' : '*'}</label>
                          <input value={form.sender_phone} onChange={e=>set('sender_phone',e.target.value)}
                            style={{ ...INPUT, background: form.customer_id ? '#f8fafc' : '#fff' }}
                            placeholder={t('orders.placeholders.phone')} readOnly={!!form.customer_id} />
                        </div>
                        <div style={{ gridColumn:'1/-1' }}>
                          <label style={LABEL}>{t('orders.form.sender_address')}</label>
                          <input value={form.sender_address} onChange={e=>set('sender_address',e.target.value)}
                            style={{ ...INPUT, background: form.customer_id ? '#f8fafc' : '#fff' }}
                            placeholder={t('orders.placeholders.pickup_address')} readOnly={!!form.customer_id} />
                        </div>
                      </>
                    )}

                    {/* Pickup settings */}
                    <div>
                      <label style={LABEL}>{t('orders.form.pickup_notes')}</label>
                      <textarea rows={2} value={form.pickup_notes} onChange={e=>set('pickup_notes',e.target.value)}
                        style={{ ...INPUT, resize:'vertical' }} placeholder={t('orders.placeholders.pickup_notes')} />
                    </div>

                      </div>{/* close grid */}
                    </div>{/* close form column */}
                    {/* ─ Map Side Column ─ */}
                    {_showMap && (
                      <div style={{ width: (_mob || _tab) ? '100%' : 380, flexShrink:0 }}>
                        <div style={{ position: (_mob || _tab) ? 'relative' : 'sticky', top:0 }}>
                          <AddressSearch onSelect={({ lat, lng, display }) => {
                            set('sender_lat', lat); set('sender_lng', lng);
                            if (display) set('sender_address', display);
                          }} />
                          <div style={{ marginTop:12 }}>
                            <LocationPickerMap lat={form.sender_lat} lng={form.sender_lng}
                              height={_mob ? 160 : _tab ? 200 : 400}
                              onPick={async (lat, lng) => {
                                set('sender_lat', lat); set('sender_lng', lng);
                                try {
                                  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
                                  const data = await r.json();
                                  if (data.display_name) set('sender_address', data.display_name);
                                } catch {}
                              }} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ); })()}

                {/* ═══════ Step 2: Recipients / Stops ═══════ */}
                {step === 2 && (
                  <div>
                    {/* Stops summary bar */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14,
                      padding:'10px 16px', background:'linear-gradient(135deg,#fff7ed,#fffbeb)', borderRadius:12, border:'1px solid #fed7aa' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <MapPin width={16} height={16} color="#ea580c" />
                        <span style={{ fontWeight:700, fontSize:14, color:'#1e293b' }}>
                          {stops.length} {stops.length === 1 ? t('orders.stops.stop') : t('orders.stops.stops')}
                        </span>
                        <span style={{ fontSize:12, color:'#64748b' }}>
                          {'\u00B7'} {stops.reduce((a, s) => a + s.packages.length, 0)} {t('orders.stops.packages_total')}
                        </span>
                      </div>
                      {orderMode !== 'single' && hasFeature('multi_stop') && (
                        <button type="button" onClick={addStop}
                          style={{ padding:'6px 14px', borderRadius:10, border:'2px dashed #f97316', background:'#fff',
                            cursor:'pointer', fontSize:12, fontWeight:700, color:'#ea580c', display:'flex', alignItems:'center', gap:5 }}>
                          <Plus width={13} height={13} /> {t('orders.stops.add_stop')}
                        </button>
                      )}
                    </div>

                    {/* Stop cards */}
                    {stops.map((stop, sIdx) => (
                      <div key={sIdx} style={{ background:'#fff', borderRadius:14, padding: _mob ? 12 : 16, marginBottom:12,
                        border:'1px solid #e2e8f0', boxShadow:'0 2px 8px rgba(0,0,0,0.04)', transition:'all 0.2s' }}>
                        {/* Stop header */}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ width:30, height:30, borderRadius:10,
                              background:'linear-gradient(135deg,#3b82f6,#2563eb)',
                              display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800, fontSize:13 }}>
                              {sIdx + 1}
                            </div>
                            <div>
                              <div style={{ fontWeight:700, fontSize:14, color:'#1e293b' }}>
                                {t('orders.stops.stop_label')} {sIdx + 1}
                                {stop.recipient_name && <span style={{ fontWeight:500, color:'#64748b' }}> \u2014 {stop.recipient_name}</span>}
                              </div>
                              {stop.service_bay_id && (() => {
                                const z = service_bays.find(z => String(z.id) === String(stop.service_bay_id));
                                return z ? <div style={{ fontSize:11, color:'#16a34a', fontWeight:600 }}>{z.name} \u00B7 {z.emirate}</div> : null;
                              })()}
                            </div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                            {orderMode !== 'single' && (
                              <>
                                <button type="button" onClick={() => duplicateStop(sIdx)} title={t('orders.stops.duplicate')}
                                  style={{ padding:'5px 8px', borderRadius:8, border:'1px solid #e2e8f0', background:'#f8fafc',
                                    cursor:'pointer', color:'#64748b', display:'flex', alignItems:'center' }}>
                                  <Copy width={13} height={13} />
                                </button>
                                <button type="button" onClick={() => removeStop(sIdx)} title={t('orders.stops.remove')}
                                  style={{ padding:'5px 8px', borderRadius:8, border:'1px solid #fecaca', background:'#fef2f2',
                                    color:'#dc2626', cursor:'pointer', display:'flex', alignItems:'center' }}>
                                  <Xmark width={13} height={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Recipient fields */}
                        <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr' : '1fr 1fr 1fr', gap:10, marginBottom:10 }}>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.recipient_name')} *</label>
                            <input value={stop.recipient_name} placeholder={t('orders.placeholders.full_name')}
                              onChange={e => updateStop(sIdx, 'recipient_name', e.target.value)}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13 }} autoFocus={sIdx === 0} />
                          </div>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.recipient_phone')} *</label>
                            <PhoneInput
                              value={stop.recipient_phone}
                              onChange={val => updateStop(sIdx, 'recipient_phone', val)}
                              phoneCode={stop.phone_code || '+971'}
                              onPhoneCodeChange={code => updateStop(sIdx, 'phone_code', code)}
                              placeholder={t('orders.placeholders.phone') || 'Phone number'}
                              required
                            />
                          </div>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.delivery_zone')}</label>
                            <select value={stop.service_bay_id || ''} onChange={e => handleStopZoneChange(sIdx, e.target.value)}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13 }}>
                              <option value="">{t('orders.form.select_zone')}</option>
                              {service_bays.filter(z => z.is_active).map(z =>
                                <option key={z.id} value={z.id}>{z.name} \u2014 {z.emirate}{z.base_service_fee ? ` (${cur} ${z.base_service_fee})` : ''}</option>
                              )}
                            </select>
                          </div>
                        </div>

                        {/* Address row */}
                        <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr' : '1fr', gap:10, marginBottom:10 }}>
                          <AddressSearch onSelect={({ lat, lng, display }) => {
                            updateStop(sIdx, 'recipient_lat', lat);
                            updateStop(sIdx, 'recipient_lng', lng);
                            if (display) updateStop(sIdx, 'recipient_address', display);
                          }} />
                        </div>

                        {/* Map — always visible */}
                        <div style={{ marginBottom:10 }}>
                          <LocationPickerMap lat={stop.recipient_lat} lng={stop.recipient_lng}
                            height={_mob ? 160 : 220}
                            onPick={async (lat, lng) => {
                              updateStop(sIdx, 'recipient_lat', lat);
                              updateStop(sIdx, 'recipient_lng', lng);
                              try {
                                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
                                const data = await r.json();
                                if (data.display_name) updateStop(sIdx, 'recipient_address', data.display_name);
                                if (data.address?.suburb || data.address?.neighbourhood) updateStop(sIdx, 'recipient_area', data.address.suburb || data.address.neighbourhood);
                                if (data.address?.state) {
                                  const regions = getRegions(workshop?.country);
                                  const match = regions.find(em => data.address.state?.includes(em));
                                  if (match) updateStop(sIdx, 'recipient_emirate', match);
                                }
                              } catch {}
                            }} />
                        </div>

                        {/* Location badge */}
                        {(stop.recipient_lat && stop.recipient_lng) && (
                          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
                            <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:700,
                              padding:'4px 12px', borderRadius:20, background:'#f0fdf4', color:'#16a34a', border:'1px solid #bbf7d0' }}>
                              <MapPin width={12} height={12} />
                              {parseFloat(stop.recipient_lat).toFixed(5)}, {parseFloat(stop.recipient_lng).toFixed(5)}
                            </span>
                            {stop.service_bay_id && (
                              <span style={{ fontSize:11, color:'#16a34a', fontWeight:600 }}>{t('orders.packages.location_auto')}</span>
                            )}
                          </div>
                        )}

                        {/* Address summary (read-only, populated from map/search) */}
                        <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr' : '2fr 1fr 1fr', gap:10, marginBottom:10 }}>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.delivery_address')} *</label>
                            <input value={stop.recipient_address} readOnly
                              placeholder={t('orders.placeholders.building_street')}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13, background:'#f8fafc', color:'#475569', cursor:'default' }} />
                          </div>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.area')}</label>
                            <input value={stop.recipient_area || ''} placeholder={t('orders.placeholders.area')}
                              onChange={e => updateStop(sIdx, 'recipient_area', e.target.value)}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13, background: stop.service_bay_id ? '#f0fdf4' : '#fff' }} />
                          </div>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{getRegionLabel(workshop?.country, i18n.language)}</label>
                            {getRegions(workshop?.country).length > 0 ? (
                              <select value={stop.recipient_emirate || ''} onChange={e => updateStop(sIdx, 'recipient_emirate', e.target.value)}
                                style={{ ...INPUT, padding:'8px 12px', fontSize:13, background: stop.service_bay_id ? '#f0fdf4' : '#fff' }}>
                                <option value="">{t('orders.form.select_region', 'Select...')}</option>
                                {getRegions(workshop?.country).map(em => <option key={em} value={em}>{em}</option>)}
                              </select>
                            ) : (
                              <input value={stop.recipient_emirate || ''} onChange={e => updateStop(sIdx, 'recipient_emirate', e.target.value)}
                                placeholder={getRegionLabel(workshop?.country, i18n.language)}
                                style={{ ...INPUT, padding:'8px 12px', fontSize:13, background: stop.service_bay_id ? '#f0fdf4' : '#fff' }} />
                            )}
                          </div>
                        </div>

                        {/* Address details row (building/villa, floor, flat) */}
                        <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr' : '1fr 1.5fr 0.7fr 0.7fr', gap:10, marginBottom:10 }}>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.address_type')}</label>
                            <select value={stop.address_type || ''} onChange={e => updateStop(sIdx, 'address_type', e.target.value)}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13 }}>
                              <option value="">{t('orders.form.select_type')}</option>
                              {ADDRESS_TYPES.map(at => (
                                <option key={at} value={at}>{t(`orders.form.address_types.${at}`)}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.building_name')}</label>
                            <input value={stop.building_name || ''} placeholder={t('orders.placeholders.building_villa_name')}
                              onChange={e => updateStop(sIdx, 'building_name', e.target.value)}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13 }} />
                          </div>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.floor')}</label>
                            <input value={stop.floor_number || ''} placeholder={t('orders.placeholders.floor')}
                              onChange={e => updateStop(sIdx, 'floor_number', e.target.value)}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13 }} />
                          </div>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.flat_number')}</label>
                            <input value={stop.flat_number || ''} placeholder={t('orders.placeholders.flat_unit')}
                              onChange={e => updateStop(sIdx, 'flat_number', e.target.value)}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13 }} />
                          </div>
                        </div>

                        {/* WorkOrder type + scheduled */}
                        <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr' : '1fr 1fr', gap:10, marginBottom:10 }}>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.work_order_type')}</label>
                            <select value={stop.work_order_type} onChange={e => updateStop(sIdx, 'work_order_type', e.target.value)}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13 }}>
                              {ORDER_TYPES.map(ot => <option key={ot} value={ot}>{fmtType(ot)}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={{ ...LABEL, fontSize:11 }}>{t('orders.form.scheduled_at')}</label>
                            <input type="datetime-local" value={stop.scheduled_at}
                              onChange={e => updateStop(sIdx, 'scheduled_at', e.target.value)}
                              style={{ ...INPUT, padding:'8px 12px', fontSize:13 }} />
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Add another stop (bottom) */}
                    {orderMode !== 'single' && hasFeature('multi_stop') && (
                      <button type="button" onClick={addStop}
                        style={{ padding:'10px', borderRadius:12, border:'2px dashed #cbd5e1', background:'#fff', cursor:'pointer',
                          fontSize:13, fontWeight:700, color:'#64748b', display:'flex', alignItems:'center', gap:6,
                          width:'100%', justifyContent:'center', transition:'all 0.2s' }}>
                        <Plus width={15} height={15} /> {t('orders.stops.add_another')}
                      </button>
                    )}
                  </div>
                )}

                {/* ═══════ Step 3: Packages & Charges ═══════ */}
                {step === 3 && (
                  <div>
                    {/* Per-stop package sections */}
                    {stops.map((stop, sIdx) => (
                      <div key={sIdx} style={{ marginBottom:18 }}>
                        {/* Stop header with delivery fee */}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10,
                          padding:'10px 14px', background:'linear-gradient(135deg,#eff6ff,#dbeafe)', borderRadius:10, border:'1px solid #bfdbfe' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ width:24, height:24, borderRadius:8, background:'#3b82f6',
                              display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800, fontSize:11 }}>{sIdx+1}</div>
                            <div>
                              <span style={{ fontWeight:700, fontSize:13, color:'#1e293b' }}>{stop.recipient_name || t('orders.stops.stop_label') + ' ' + (sIdx+1)}</span>
                              <span style={{ fontSize:11, color:'#64748b', marginLeft:8 }}>
                                {stop.packages.length} {stop.packages.length === 1 ? t('orders.stops.pkg') : t('orders.stops.packages_total')}
                              </span>
                            </div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <label style={{ fontSize:11, fontWeight:600, color:'#64748b' }}>{t('orders.form.fee_aed')}</label>
                            <input type="number" min="0" step="0.01" value={stop.service_fee}
                              onChange={e => updateStop(sIdx, 'service_fee', e.target.value)}
                              style={{ width:100, padding:'5px 10px', borderRadius:8, border:'1px solid #bfdbfe', fontSize:13, boxSizing:'border-box',
                                background: stop.service_bay_id ? '#f0fdf4' : '#fff', textAlign:'center' }}
                              placeholder="0.00" />
                          </div>
                        </div>

                        {/* Per-stop payment & discount */}
                        <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr 1fr' : '1fr 1fr 1fr', gap:10, marginBottom:10 }}>
                          <div>
                            <label style={{ ...LABEL, fontSize:10 }}>{t('orders.form.payment_method')}</label>
                            <select value={stop.payment_method || 'cod'} onChange={e => updateStop(sIdx, 'payment_method', e.target.value)}
                              style={{ ...INPUT, padding:'7px 10px', fontSize:12 }}>
                              {Object.entries(PAYMENT_MAP).map(([k,v]) => <option key={k} value={k}>{t(`orders.payment.${k}`)}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={{ ...LABEL, fontSize:10 }}>{t('orders.form.discount_aed')}</label>
                            <input type="number" min="0" step="0.01" value={stop.discount}
                              onChange={e => updateStop(sIdx, 'discount', e.target.value)}
                              style={{ ...INPUT, padding:'7px 10px', fontSize:12 }} placeholder="0.00" />
                          </div>
                        </div>

                        {/* Package cards */}
                        {stop.packages.map((pkg, pIdx) => (
                          <div key={pIdx} style={{ background:'#fff', borderRadius:10, padding: _mob ? 10 : 14, marginBottom:8,
                            border:'1px solid #e2e8f0', boxShadow:'0 1px 3px rgba(0,0,0,0.03)' }}>
                            {/* Package header (only if multiple) */}
                            {stop.packages.length > 1 && (
                              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                  <Package width={13} height={13} color="#f97316" />
                                  <span style={{ fontWeight:700, fontSize:12, color:'#1e293b' }}>
                                    {t('orders.stops.pkg')} {pIdx+1}
                                  </span>
                                </div>
                                <button type="button" onClick={() => removePkg(sIdx, pIdx)}
                                  style={{ padding:'3px 8px', borderRadius:6, border:'1px solid #fecaca', background:'#fef2f2',
                                    color:'#dc2626', cursor:'pointer', display:'flex', alignItems:'center', fontSize:11 }}>
                                  <Xmark width={12} height={12} />
                                </button>
                              </div>
                            )}

                            {/* Package fields row 1: category, weight, dimensions, COD */}
                            <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap:10, marginBottom:8 }}>
                              <div>
                                <label style={{ ...LABEL, fontSize:10 }}>{t('orders.form.category')}</label>
                                <select value={pkg.category} onChange={e => updatePkg(sIdx, pIdx, 'category', e.target.value)}
                                  style={{ ...INPUT, padding:'7px 10px', fontSize:12 }}>
                                  {(categories.length > 0 ? categories : DEFAULT_CATEGORIES).map(c => (
                                    <option key={c.slug} value={c.slug}>{isRTL && c.name_ar ? c.name_ar : c.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label style={{ ...LABEL, fontSize:10 }}>{t('orders.form.weight_kg')}</label>
                                <input type="number" min="0" max="99999" step="0.1" value={pkg.weight_kg}
                                  onChange={e => updatePkg(sIdx, pIdx, 'weight_kg', e.target.value)}
                                  style={{ ...INPUT, padding:'7px 10px', fontSize:12 }} placeholder="0.0" />
                              </div>
                              <div>
                                <label style={{ ...LABEL, fontSize:10 }}>{t('orders.form.dimensions')}</label>
                                <input value={pkg.dimensions} onChange={e => updatePkg(sIdx, pIdx, 'dimensions', e.target.value)}
                                  style={{ ...INPUT, padding:'7px 10px', fontSize:12 }} placeholder={t('orders.placeholders.dimensions')} />
                              </div>
                              <div>
                                <label style={{ ...LABEL, fontSize:10 }}>{t('orders.form.cod_aed')}</label>
                                <input type="number" min="0" step="0.01" value={pkg.cash_amount}
                                  onChange={e => updatePkg(sIdx, pIdx, 'cash_amount', e.target.value)}
                                  style={{ ...INPUT, padding:'7px 10px', fontSize:12, display: (stop.payment_method || 'cod') === 'cod' ? 'block' : 'none' }} placeholder="0.00" />
                                {(stop.payment_method || 'cod') !== 'cod' && (
                                  <div style={{ padding:'7px 10px', fontSize:12, color:'#94a3b8', fontStyle:'italic' }}>{t('orders.payment.'+(stop.payment_method || 'cod'))}</div>
                                )}
                              </div>
                            </div>

                            {/* Package fields row 2: description, instructions */}
                            <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr' : '1fr 1fr', gap:10 }}>
                              <div>
                                <label style={{ ...LABEL, fontSize:10 }}>{t('orders.form.package_description')}</label>
                                <textarea rows={1} value={pkg.description} onChange={e => updatePkg(sIdx, pIdx, 'description', e.target.value)}
                                  style={{ ...INPUT, padding:'7px 10px', fontSize:12, resize:'vertical' }} placeholder={t('orders.placeholders.description')} />
                              </div>
                              <div>
                                <label style={{ ...LABEL, fontSize:10 }}>{t('orders.form.special_instructions')}</label>
                                <textarea rows={1} value={pkg.special_instructions} onChange={e => updatePkg(sIdx, pIdx, 'special_instructions', e.target.value)}
                                  style={{ ...INPUT, padding:'7px 10px', fontSize:12, resize:'vertical' }} placeholder={t('orders.placeholders.instructions')} />
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* Add package button */}
                        <button type="button" onClick={() => addPkg(sIdx)}
                          style={{ padding:'6px 14px', borderRadius:8, border:'1px dashed #cbd5e1', background:'#fff', cursor:'pointer',
                            fontSize:11, fontWeight:600, color:'#64748b', display:'flex', alignItems:'center', gap:5, marginTop:4 }}>
                          <Plus width={12} height={12} /> {t('orders.stops.add_package')}
                        </button>
                      </div>
                    ))}

                    {/* ── Internal Notes ── */}
                    <div style={{ marginTop:8, padding: _mob ? 12 : 16, background:'#f8fafc', borderRadius:12, border:'1px solid #e2e8f0' }}>
                      <div style={{ fontWeight:700, fontSize:13, color:'#1e293b', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
                        <CreditCard width={14} height={14} color="#64748b" /> {t('orders.form.internal_notes')}
                      </div>
                      <textarea rows={2} value={form.internal_notes} onChange={e=>set('internal_notes',e.target.value)}
                        style={{ ...INPUT, padding:'8px 12px', fontSize:13, resize:'vertical', width:'100%' }} placeholder={t('orders.placeholders.notes')} />
                    </div>
                  </div>
                )}

                {/* ═══════ Step 4: Review & Confirm ═══════ */}
                {step === 4 && (
                  <div>
                    {/* Sender card */}
                    <div style={{ padding:16, background:'linear-gradient(135deg,#f0fdf4,#ecfdf5)', borderRadius:12,
                      border:'1px solid #bbf7d0', marginBottom:14 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                        {form.sender_type === 'business' ? <Building width={15} height={15} color="#16a34a" /> : <User width={15} height={15} color="#16a34a" />}
                        <span style={{ fontWeight:700, fontSize:14, color:'#1e293b' }}>
                          {form.sender_type === 'business' ? t('orders.review.sender_business') : t('orders.review.sender')}
                        </span>
                        {form.sender_type === 'business' && (
                          <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:6, background:'#dbeafe', color:'#1d4ed8' }}>
                            {t('orders.form.sender_business')}
                          </span>
                        )}
                        <button type="button" onClick={() => setStep(1)}
                          style={{ marginLeft:'auto', padding:'3px 10px', borderRadius:6, border:'1px solid #bbf7d0',
                            background:'#fff', cursor:'pointer', fontSize:11, fontWeight:600, color:'#16a34a' }}>
                          {t('orders.review.edit')}
                        </button>
                      </div>
                      <div style={{ fontSize:13, color:'#374151', lineHeight:1.6 }}>
                        <div><strong>{form.sender_name || '\u2014'}</strong> {'\u00B7'} {form.sender_phone || '\u2014'}</div>
                        {form.sender_address && <div style={{ fontSize:12, color:'#64748b' }}>{form.sender_address}</div>}
                      </div>
                    </div>

                    {/* Stops + Packages */}
                    <div style={{ marginBottom:14 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                        <MapPin width={15} height={15} color="#3b82f6" />
                        <span style={{ fontWeight:700, fontSize:14, color:'#1e293b' }}>
                          {t('orders.review.delivery_stops')} ({stops.length})
                        </span>
                        <button type="button" onClick={() => setStep(2)}
                          style={{ marginLeft:'auto', padding:'3px 10px', borderRadius:6, border:'1px solid #bfdbfe',
                            background:'#fff', cursor:'pointer', fontSize:11, fontWeight:600, color:'#3b82f6' }}>
                          {t('orders.review.edit')}
                        </button>
                      </div>
                      {stops.map((stop, sIdx) => (
                        <div key={sIdx} style={{ padding:12, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', marginBottom:8 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                            <div style={{ width:22, height:22, borderRadius:6, background:'#3b82f6',
                              display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800, fontSize:10 }}>{sIdx+1}</div>
                            <div>
                              <span style={{ fontWeight:700, fontSize:13, color:'#1e293b' }}>{stop.recipient_name}</span>
                              <span style={{ fontSize:12, color:'#64748b', marginLeft:6 }}>{stop.recipient_phone}</span>
                            </div>
                          </div>
                          <div style={{ fontSize:12, color:'#64748b', marginBottom:4 }}>{stop.recipient_address}</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:6, fontSize:11 }}>
                            {stop.service_bay_id && (() => {
                              const z = service_bays.find(z => String(z.id) === String(stop.service_bay_id));
                              return z ? <span style={{ padding:'2px 8px', borderRadius:6, background:'#eff6ff', color:'#2563eb', fontWeight:600 }}>{z.name}</span> : null;
                            })()}
                            <span style={{ padding:'2px 8px', borderRadius:6, background:'#f1f5f9', color:'#64748b', fontWeight:600 }}>
                              {fmtType(stop.work_order_type)}
                            </span>
                            {stop.service_fee && (
                              <span style={{ padding:'2px 8px', borderRadius:6, background:'#fef3c7', color:'#b45309', fontWeight:600 }}>
                                {cur} {parseFloat(stop.service_fee).toFixed(2)}
                              </span>
                            )}
                          </div>
                          {/* Package list */}
                          <div style={{ marginTop:8, paddingTop:8, borderTop:'1px dashed #e2e8f0' }}>
                            <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                              <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:6,
                                background: (stop.payment_method || 'cod') === 'cod' ? '#fef3c7' : '#eff6ff',
                                color: (stop.payment_method || 'cod') === 'cod' ? '#b45309' : '#2563eb' }}>
                                {t(`orders.payment.${stop.payment_method || 'cod'}`)}
                              </span>
                              {parseFloat(stop.discount) > 0 && (
                                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:6,
                                  background:'#fef2f2', color:'#dc2626' }}>
                                  Disc: {cur} {parseFloat(stop.discount).toFixed(2)}
                                </span>
                              )}
                            </div>
                            {stop.packages.map((pkg, pIdx) => (
                              <div key={pIdx} style={{ display:'flex', alignItems:'center', gap:10, padding:'4px 0', fontSize:12 }}>
                                <Package width={12} height={12} color="#f97316" />
                                <span style={{ fontWeight:600, color:'#1e293b' }}>
                                  {(categories.length > 0 ? categories : DEFAULT_CATEGORIES).find(c => c.slug === pkg.category)?.name || pkg.category}
                                </span>
                                {pkg.weight_kg && <span style={{ color:'#64748b' }}>{pkg.weight_kg}kg</span>}
                                {parseFloat(pkg.cash_amount) > 0 && (stop.payment_method || 'cod') === 'cod' && (
                                  <span style={{ color:'#b45309', fontWeight:600 }}>COD: {cur} {parseFloat(pkg.cash_amount).toFixed(2)}</span>
                                )}
                                {pkg.description && <span style={{ color:'#94a3b8', fontStyle:'italic' }}>{pkg.description}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Totals summary */}
                    <div style={{ padding:16, background:'linear-gradient(135deg,#fff7ed,#fffbeb)', borderRadius:12,
                      border:'1px solid #fed7aa' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                        <DollarCircle width={15} height={15} color="#ea580c" />
                        <span style={{ fontWeight:700, fontSize:14, color:'#1e293b' }}>{t('orders.review.summary')}</span>
                        <button type="button" onClick={() => setStep(3)}
                          style={{ marginLeft:'auto', padding:'3px 10px', borderRadius:6, border:'1px solid #fed7aa',
                            background:'#fff', cursor:'pointer', fontSize:11, fontWeight:600, color:'#ea580c' }}>
                          {t('orders.review.edit')}
                        </button>
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns: _mob ? '1fr 1fr' : '1fr 1fr 1fr 1fr 1fr 1fr', gap:12 }}>
                        <div style={{ textAlign:'center', padding:10, background:'#fff', borderRadius:8 }}>
                          <div style={{ fontSize:22, fontWeight:800, color:'#3b82f6' }}>{reviewTotals.stops}</div>
                          <div style={{ fontSize:10, fontWeight:600, color:'#64748b', textTransform:'uppercase' }}>{t('orders.review.stops')}</div>
                        </div>
                        <div style={{ textAlign:'center', padding:10, background:'#fff', borderRadius:8 }}>
                          <div style={{ fontSize:22, fontWeight:800, color:'#f97316' }}>{reviewTotals.packages}</div>
                          <div style={{ fontSize:10, fontWeight:600, color:'#64748b', textTransform:'uppercase' }}>{t('orders.review.packages')}</div>
                        </div>
                        <div style={{ textAlign:'center', padding:10, background:'#fff', borderRadius:8 }}>
                          <div style={{ fontSize:22, fontWeight:800, color:'#16a34a' }}>{cur} {reviewTotals.cod.toFixed(2)}</div>
                          <div style={{ fontSize:10, fontWeight:600, color:'#64748b', textTransform:'uppercase' }}>{t('orders.review.total_cod')}</div>
                        </div>
                        <div style={{ textAlign:'center', padding:10, background:'#fff', borderRadius:8 }}>
                          <div style={{ fontSize:22, fontWeight:800, color:'#ea580c' }}>{cur} {reviewTotals.fee.toFixed(2)}</div>
                          <div style={{ fontSize:10, fontWeight:600, color:'#64748b', textTransform:'uppercase' }}>{t('orders.review.service_fees')}</div>
                        </div>
                        <div style={{ textAlign:'center', padding:10, background:'#fff', borderRadius:8 }}>
                          <div style={{ fontSize:22, fontWeight:800, color:'#dc2626' }}>{cur} {reviewTotals.discount.toFixed(2)}</div>
                          <div style={{ fontSize:10, fontWeight:600, color:'#64748b', textTransform:'uppercase' }}>{t('orders.review.discount')}</div>
                        </div>
                        <div style={{ textAlign:'center', padding:10, background:'linear-gradient(135deg,#f97316,#ea580c)', borderRadius:8 }}>
                          <div style={{ fontSize:22, fontWeight:800, color:'#fff' }}>{cur} {reviewTotals.total.toFixed(2)}</div>
                          <div style={{ fontSize:10, fontWeight:600, color:'rgba(255,255,255,0.8)', textTransform:'uppercase' }}>{t('orders.review.total')}</div>
                        </div>
                      </div>
                      {/* Payment methods summary */}
                      <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <CreditCard width={13} height={13} color="#64748b" />
                        {stops.map((s, i) => (
                          <span key={i} style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:6,
                            background: (s.payment_method || 'cod') === 'cod' ? '#fef3c7' : '#eff6ff',
                            color: (s.payment_method || 'cod') === 'cod' ? '#b45309' : '#2563eb' }}>
                            Stop {i+1}: {t(`orders.payment.${s.payment_method || 'cod'}`)}
                          </span>
                        ))}
                        {form.internal_notes && (
                          <span style={{ fontSize:11, color:'#94a3b8', marginLeft:12 }}>
                            \u2022 {t('orders.form.internal_notes')}: {form.internal_notes.substring(0,50)}{form.internal_notes.length > 50 ? '...' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer nav — sticky */}
              <div style={{ padding: _mob ? '10px 14px 14px' : '16px 28px 20px', 
                display:'flex', justifyContent:'space-between', alignItems:'center',
                borderTop:'1px solid #f1f5f9', background:'#fff', flexShrink:0,
                gap: _mob ? '8px' : '0' }}>
                <button type="button"
                  onClick={step > 1 ? (e) => prevStep(e) : closeForm}
                  style={{ padding: _mob ? '8px 14px' : '10px 22px', 
                    borderRadius:10, border:'1px solid #e2e8f0',
                    background:'#fff', cursor:'pointer', fontWeight:600, 
                    fontSize: _mob ? 13 : 14,
                    display:'flex', alignItems:'center', gap: _mob ? 6 : 7, 
                    color:'#475569', flex: _mob ? '1' : 'none' }}>
                  {isRTL ? <NavArrowRight width={15} height={15} /> : <NavArrowLeft width={15} height={15} />}
                  {step > 1 ? t('orders.form.back') : t('orders.form.cancel')}
                </button>

                {step < STEPS.length ? (
                  <button type="button" onClick={(e) => nextStep(e)}
                    style={{ padding: _mob ? '8px 18px' : '10px 28px', 
                      borderRadius:10, border:'none',
                      background:'linear-gradient(135deg,#f97316,#ea580c)', color:'#fff',
                      cursor:'pointer', fontWeight:700, fontSize: _mob ? 13 : 14, 
                      display:'flex', alignItems:'center', gap: _mob ? 6 : 7,
                      boxShadow:'0 4px 14px rgba(249,115,22,0.35)',
                      flex: _mob ? '2' : 'none' }}>
                    {t('orders.form.next')} {isRTL ? <NavArrowLeft width={15} height={15} /> : <NavArrowRight width={15} height={15} />}
                  </button>
                ) : (
                  <button type="submit" disabled={saving}
                    style={{ padding: _mob ? '8px 18px' : '10px 28px', 
                      borderRadius:10, border:'none',
                      background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff',
                      cursor:saving?'not-allowed':'pointer', fontWeight:700, 
                      fontSize: _mob ? 13 : 14,
                      opacity:saving?0.7:1, display:'flex', alignItems:'center', 
                      gap: _mob ? 6 : 7,
                      boxShadow:'0 4px 14px rgba(22,163,74,0.35)',
                      flex: _mob ? '2' : 'none' }}>
                    <CheckCircle width={15} height={15} />
                    {saving ? t('orders.form.saving') : selected ? t('orders.form.update_order') : t('orders.form.create_order')}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Confirm */}
      {cancelConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1100,
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:20, padding:34, width:390, textAlign:'center',
            boxShadow:'0 24px 70px rgba(0,0,0,0.2)' }}>
            <div style={{ width:60, height:60, borderRadius:'50%', background:'#fee2e2',
              display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
              <WarningTriangle width={28} height={28} color="#dc2626" />
            </div>
            <h3 style={{ margin:'0 0 10px', fontSize:19, fontWeight:800 }}>{t('orders.cancel.title')}</h3>
            <p style={{ color:'#64748b', marginBottom:26, lineHeight:1.6 }}>
              <strong>{cancelConfirm.work_order_number}</strong> {t('orders.cancel.message')}
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setCancelConfirm(null)}
                style={{ flex:1, padding:12, borderRadius:10, border:'1px solid #e2e8f0',
                  background:'#fff', cursor:'pointer', fontWeight:600, fontSize:14 }}>
                {t('orders.cancel.keep')}
              </button>
              <button onClick={handleCancel}
                style={{ flex:1, padding:12, borderRadius:10, border:'none',
                  background:'#dc2626', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:14 }}>
                {t('orders.cancel.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mechanic Picker Modal ── */}
      {mechanicPicker && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:10000,
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={() => setMechanicPicker(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:20, width:440, maxWidth:'96vw',
            maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 70px rgba(0,0,0,0.22)',
            overflow:'hidden', animation:'fadeInUp 0.25s ease' }}>
            {/* Header */}
            <div style={{ padding:'22px 24px 16px', borderBottom:'1px solid #f1f5f9' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:'#ede9fe',
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <User width={20} height={20} color="#7c3aed" />
                  </div>
                  <div>
                    <h3 style={{ margin:0, fontSize:17, fontWeight:800, color:'#1e293b' }}>{t('orders.mechanic_picker.title')}</h3>
                    <p style={{ margin:0, fontSize:12, color:'#94a3b8' }}>{t('orders.mechanic_picker.subtitle')}</p>
                  </div>
                </div>
                <button onClick={() => setMechanicPicker(null)}
                  style={{ width:32, height:32, borderRadius:'50%', border:'none', background:'#f1f5f9',
                    cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Xmark width={14} height={14} color="#64748b" />
                </button>
              </div>
              {/* Search */}
              <div style={{ position:'relative' }}>
                <Search width={14} height={14} style={{ position:'absolute', [isRTL?'right':'left']:11, top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
                <input value={mechanicSearch} onChange={e => setMechanicSearch(e.target.value)}
                  placeholder={t('orders.mechanic_picker.search_placeholder')}
                  style={{ width:'100%', padding:'9px 12px', [isRTL?'paddingRight':'paddingLeft']:34, borderRadius:10,
                    border:'1px solid #e2e8f0', fontSize:13, outline:'none', boxSizing:'border-box' }}
                  autoFocus />
              </div>
            </div>
            {/* Mechanic List */}
            <div style={{ overflowY:'auto', padding:'8px 12px', flex:1 }}>
              {mechanics
                .filter(d => d.is_active)
                .filter(d => {
                  if (!mechanicSearch) return true;
                  const q = mechanicSearch.toLowerCase();
                  return (d.full_name||'').toLowerCase().includes(q) || (d.phone||'').includes(q) || (d.zone_name||'').toLowerCase().includes(q);
                })
                .map(d => {
                  const statusColor = d.status === 'available' ? '#16a34a' : d.status === 'busy' ? '#f59e0b' : '#94a3b8';
                  const statusBg    = d.status === 'available' ? '#dcfce7' : d.status === 'busy' ? '#fef3c7' : '#f1f5f9';
                  const isAssigning = assigningMechanic === d.id;
                  return (
                    <button key={d.id} onClick={() => handleAssignMechanic(d.id)} disabled={isAssigning}
                      style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
                        borderRadius:12, border:'1px solid #f1f5f9', background: isAssigning ? '#f8fafc' : '#fff',
                        cursor: isAssigning ? 'wait' : 'pointer', marginBottom:6, textAlign: isRTL ? 'right' : 'left',
                        transition:'all 0.15s', opacity: isAssigning ? 0.7 : 1 }}
                      onMouseOver={e => { if (!isAssigning) e.currentTarget.style.background='#f8fafc'; e.currentTarget.style.borderColor='#e2e8f0'; }}
                      onMouseOut={e => { if (!isAssigning) e.currentTarget.style.background='#fff'; e.currentTarget.style.borderColor='#f1f5f9'; }}>
                      {/* Avatar */}
                      <div style={{ width:42, height:42, borderRadius:12, background:'linear-gradient(135deg,#1e3a6b,#334155)',
                        display:'flex', alignItems:'center', justifyContent:'center', color:'#fff',
                        fontWeight:800, fontSize:14, flexShrink:0 }}>
                        {(d.full_name || '?')[0].toUpperCase()}
                      </div>
                      {/* Info */}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:14, color:'#1e293b', marginBottom:2 }}>{d.full_name}</div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, color:'#94a3b8', flexWrap:'wrap' }}>
                          <span>{d.phone}</span>
                          {d.vehicle_type && <span style={{ background:'#f1f5f9', padding:'1px 6px', borderRadius:4 }}>{d.vehicle_type}</span>}
                          {d.zone_name && <span>{d.zone_name}</span>}
                        </div>
                      </div>
                      {/* Status + WorkOrders */}
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20,
                          background: statusBg, color: statusColor, textTransform:'capitalize' }}>
                          {t(`orders.mechanic_picker.status_${d.status}`) || d.status}
                        </span>
                        {d.orders_today > 0 && (
                          <span style={{ fontSize:10, color:'#94a3b8' }}>{d.orders_today} {t('orders.mechanic_picker.today')}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              {mechanics.filter(d => d.is_active).length === 0 && (
                <div style={{ textAlign:'center', padding:'30px 0', color:'#94a3b8' }}>
                  <User width={36} height={36} style={{ marginBottom:8, opacity:0.4 }} />
                  <p style={{ fontSize:14, fontWeight:600 }}>{t('orders.mechanic_picker.no_mechanics')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toasts} />
      {showUpgradeModal && <UpgradeModal onClose={() => setShowUpgradeModal(false)} triggerReason="WorkOrder limit reached. Upgrade your plan to create more orders." />}
      <NewWorkOrderModal
        open={showNewWO}
        presetCustomerId={newWOPresetCustomerId}
        editOrder={editWorkOrder}
        currency={cur}
        onClose={() => { setShowNewWO(false); setEditWorkOrder(null); setNewWOPresetCustomerId(null); }}
        onCreated={(created) => {
          setShowNewWO(false);
          setEditWorkOrder(null);
          setNewWOPresetCustomerId(null);
          fetchWorkOrders();
          fetchStats();
          dispatchPlanUpdate();
          showToast(`Job card created${created?.work_order_number ? ` — ${created.work_order_number}` : ''} ✓`, 'success');
          if (created?.id) setInspectionPrompt(created);
        }}
        onUpdated={(updated) => {
          setShowNewWO(false);
          setEditWorkOrder(null);
          fetchWorkOrders();
          fetchStats();
          if (drawerFull && drawerFull.id === updated?.id) setDrawerFull(prev => ({ ...prev, ...updated }));
          showToast(`Job card updated${updated?.work_order_number ? ` — ${updated.work_order_number}` : ''} ✓`, 'success');
        }}
      />

      <NewEstimateModal
        open={showNewEstimate}
        onClose={() => setShowNewEstimate(false)}
        onSent={() => {
          // No job card exists yet at this point — one appears only once the
          // customer has decided every line — so there is nothing to refresh
          // in the work orders list. The confirmation lives inside the modal
          // itself (estimate number, who it was sent to).
          showToast('Estimate sent for approval ✓', 'success');
        }}
      />

      {/* Post-creation prompt — jump straight into the intake inspection form */}
      {inspectionPrompt && (
        <div
          onClick={() => setInspectionPrompt(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1100, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16, padding: '28px 24px',
              maxWidth: 400, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.18)',
              textAlign: 'center',
            }}
          >
            <div style={{
              width: 52, height: 52, borderRadius: 14, background: '#eff6ff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Eye width={24} height={24} color="#1d4ed8" />
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: '#1e293b' }}>
              Start the intake inspection?
            </h3>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
              {inspectionPrompt.work_order_number || 'This job card'} was created. Do the walk-around
              damage check with the customer now, before the vehicle goes to the bay.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setInspectionPrompt(null)} style={{
                flex: 1, padding: '11px 18px', borderRadius: 10,
                border: '1px solid #e2e8f0', background: '#fff',
                color: '#64748b', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
                Later
              </button>
              <button
                onClick={() => { const id = inspectionPrompt.id; setInspectionPrompt(null); navigate(`/work-orders/${id}/inspection?type=intake`); }}
                style={{
                  flex: 1, padding: '11px 18px', borderRadius: 10, border: 'none',
                  background: '#1d4ed8', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Start Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
