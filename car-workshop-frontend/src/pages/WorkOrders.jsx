import { Fragment, useState, useEffect, useRef, useContext } from 'react';
import { canDo } from '../lib/permissions';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus, Search, EditPencil, Eye, Xmark, NavArrowRight, NavArrowLeft, Copy,
  Clock, MapPin, User, Phone, Building, Download, ArrowRight,
  WarningTriangle, CheckCircle, DollarCircle, Box3dPoint, Page,
  Prohibition, Group, OpenNewWindow, ShareAndroid, Printer, Wrench, SendMail,
  ClipboardCheck, ViewGrid, Undo,
} from 'iconoir-react';
import api from '../lib/api';
import { TableSkeleton } from '../components/Loader';
import usePlanUsage, { dispatchPlanUpdate } from '../hooks/usePlanUsage';
import UpgradeModal from '../components/dashboard/UpgradeModal';
import NewWorkOrderModal from '../components/NewWorkOrderModal';
import NewEstimateModal from '../components/NewEstimateModal';
import Toast, { useToast } from '../components/Toast';
import { AuthContext } from '../context/AuthContext';
import { fmtCurrency } from '../utils/currency';
import { toCsv } from '../utils/csv';
import { woLabel, woTone, woFilterLabel, WO_FILTERS, WO_STATUSES } from '../lib/statusLabels';
import { customerStatusUrl } from '../lib/customerLink';
import { hasModule, isTechnician as isTechnicianUser, MODULES } from '../lib/modules';
import { buildStatusMessage } from '../lib/whatsapp';

/* ══════════════════════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════════════════════ */
// Job types the job card wizard offers (NewWorkOrderModal, backend
// VALID_WORK_ORDER_TYPES). 'return' was a courier type, never a workshop one.
const ORDER_TYPES   = ['standard','express','same_day','scheduled','warranty'];
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
// Who may move a job card to each status — mirrors the capability check on
// PATCH /work-orders/:id/status (backend lib/roles.js; managers hold all).
const STATUS_CAPS = {
  cancelled: ['job.open'], pending: ['job.open'], confirmed: ['job.open'],
  assigned: ['job.assign'], accepted: ['job.assign'],
  in_progress: ['time.book', 'job.assign'],
  inspection: ['qc.perform', 'job.assign'], ready_for_pickup: ['qc.perform', 'job.assign'],
  completed: ['delivery.handover'],
};
const canSetStatus = (user, status) => (STATUS_CAPS[status] || []).some(c => canDo(user, c));
// Completed and cancelled job cards are closed: no edit, no cancel (the server refuses with 409).
const isClosedStatus = (status) => ['completed', 'cancelled'].includes(status);

/* The status is moved by the workflow (Steps 1–7): the Team Leader assigns,
   booking time starts the work, the quality check and the gate pass finish
   it. By hand, staff only cancel a job or reopen a cancelled one. A manager
   can also override the status when the workflow is stuck — never to
   'accepted', the courier "driver accepted" step. Mirrors lib/roles.js
   isManagerRole. */
const MANAGER_ROLES = ['admin', 'super_admin', 'general_manager', 'workshop_manager'];
const isManager = u => !!u && (u.is_owner === true || Number(u.is_owner) === 1
  || MANAGER_ROLES.includes(u.role) || MANAGER_ROLES.includes(u.role_slug));
/** Where a manager may override a job's status to (Cancel and Reopen have their own buttons). */
const overrideTargets = (user, status) => (isManager(user)
  ? (VALID_TRANSITIONS_FRONTEND[status] || []).filter(s => s !== 'accepted' && s !== 'cancelled' && status !== 'cancelled' && canSetStatus(user, s))
  : []);
/** A cancelled job goes back to the start (job.open). */
const mayReopen = (user, status) => status === 'cancelled' && canSetStatus(user, 'pending');

/** The stored statuses a list filter stands for: a WO_FILTERS key
 *  ('waiting'), or one or more statuses from a link ('pending',
 *  'estimate_approved,auto_assign'). Sent to the API as a comma list. */
function filterStatuses(value) {
  const f = WO_FILTERS.find(x => x.key === value);
  if (f) return [...f.statuses];
  return String(value || '').split(',').map(s => s.trim()).filter(s => WO_STATUSES.includes(s));
}
/** A link's ?status= as the chip it is ('in_progress' → 'in_work'), or the statuses it names. */
function normaliseStatusFilter(value) {
  const list = filterStatuses(value);
  if (!list.length) return '';
  const f = WO_FILTERS.find(x => x.statuses.length === list.length && x.statuses.every(s => list.includes(s)));
  return f ? f.key : list.join(',');
}

const INPUT  = { width:'100%', padding:'10px 13px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:14, boxSizing:'border-box', outline:'none' };
const LIMIT  = 10;

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */
const fmtDate = (d, language = 'en') => d ? new Date(d).toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-AE',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const fmtTime = (d, language = 'en') => d ? new Date(d).toLocaleTimeString(language === 'ar' ? 'ar-AE' : 'en-AE',{hour:'2-digit',minute:'2-digit'}) : '';
const fmtType = t => t ? t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : '—';

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

const openWhatsApp = (phone, message) => {
  const waPhone = formatPhoneForWA(phone);
  const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
};

/* The customer's status update: their name, the car, the job card, the stage
   in customer words and the /service-status link (lib/whatsapp.js). It used
   to be a courier-style card with the drop-off address and "Cash to collect". */
const WhatsAppButton = ({ phone, order, style = {}, size = 'normal', workshopName }) => {
  const { t } = useTranslation();
  if (!phone) return null;
  const msg = buildStatusMessage({ t, wo: order || {}, link: customerStatusUrl(order), workshopName });
  const isSmall = size === 'small';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); openWhatsApp(phone, msg); }}
      title={t('orders.actions.share_whatsapp', 'Share via WhatsApp')}
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
      <div style={{ fontSize:24, fontWeight:900, color:'#1e293b', lineHeight:1 }}>{value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-AE') : value}</div>
      <div style={{ fontSize:12, color:'#64748b', marginTop:4, fontWeight:500 }}>{label}</div>
      {sub && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

/* The work order's status in the workshop's words (lib/statusLabels.js).
   Pass the work order, not just its status: a job the customer has approved
   reads "Approved — to assign" while it is still pending or confirmed. */
function StatusPill({ wo }) {
  const { t } = useTranslation();
  const tone = woTone(wo);
  const Icon = tone.icon;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', whiteSpace:'nowrap',
      borderRadius:20, fontSize:12, fontWeight:700, background:tone.bg, color:tone.color }}>
      <Icon width={12} height={12} />{woLabel(t, wo)}
    </span>
  );
}

/* ── WorkOrder Number Tooltip ── */
function OrderNumCell({ orderNumber }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [show, setShow] = useState(false);
  // The whole number: it is what staff read out and search by. It used to be
  // cut to its first five characters ("WO-20…"), identical on every row.
  const displayNum = orderNumber || '—';
  const [justCopied, setJustCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(orderNumber).then(() => {
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    });
  };

  // The raw status token used to be shown here too; it meant nothing to staff.
  // The row's "Copy customer link" button gives the customer's page instead.
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}>
      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 13, cursor: 'default', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
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
              title={t('orders.copy_number', 'Copy the number')}
              style={{
                background: justCopied ? '#22c55e' : 'rgba(255,255,255,0.15)',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                padding: '3px 8px', color: '#fff', fontSize: 11, fontWeight: 600,
                transition: 'background .2s', flexShrink: 0,
              }}>
              {justCopied ? t('orders.tooltip.copied') : <Copy width={12} height={12} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Cancel / Reopen for everyone allowed to, plus a manager's "Override
   status". Used in the job card drawer; the job card page has the same rules. */
function StatusMenu({ wo, user, onChange, dark = false }) {
  const { t } = useTranslation();
  const status = wo?.status;
  const targets = overrideTargets(user, status);
  const reopen = mayReopen(user, status);
  if (!targets.length && !reopen) return null;
  const btn = {
    display:'inline-flex', alignItems:'center', gap:5, minHeight:32, padding:'5px 12px', borderRadius:8,
    fontSize:12, fontWeight:700, cursor:'pointer',
    border: dark ? '1px solid rgba(255,255,255,0.2)' : '1px solid #e2e8f0',
    background: dark ? 'rgba(255,255,255,0.08)' : '#fff', color: dark ? '#e2e8f0' : '#334155',
  };
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
      {reopen && (
        <button type="button" style={btn} onClick={() => onChange('pending')}>
          <Undo width={13} height={13} /> {t('orders.reopen', 'Reopen')}
        </button>
      )}
      {targets.length > 0 && (
        <select value="" aria-label={t('orders.override_status', 'Override status')}
          onChange={e => { if (e.target.value) onChange(e.target.value); }}
          style={{ ...btn, appearance:'auto', paddingInlineEnd:8 }}>
          <option value="" disabled>{t('orders.override_status', 'Override status')}…</option>
          {targets.map(s => <option key={s} value={s} style={{ color:'#1e293b' }}>{woLabel(t, s)}</option>)}
        </select>
      )}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function WorkOrders() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { user, workshop } = useContext(AuthContext);
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
     overwritten when that stale request lands. `status` is a WO_FILTERS key
     ('waiting', 'in_work', …) or, from a link, a comma list of statuses. */
  const [filters,    setFilters]    = useState(() => ({
    status:          normaliseStatusFilter(searchParams.get('status')),
    search:          '',
    date_from:       searchParams.get('date_from') || '',
    date_to:         searchParams.get('date_to')   || '',
    work_order_type: '',
    customer_id:     '',
  }));
  const [sortBy,     setSortBy]     = useState('');     // '' | 'date' | 'status' | 'work_order_number' | 'total_amount' | 'completed_at'
  const [sortDir,    setSortDir]    = useState('desc'); // 'asc' | 'desc'
  const [drawer,     setDrawer]     = useState(null);
  const [drawerFull, setDrawerFull] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [customers,    setCustomers]    = useState([]);
  const [mechanics,    setMechanics]    = useState([]);
  const { toasts, showToast } = useToast();
  const [copied,     setCopied]     = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(null);
  const [mechanicPicker, setMechanicPicker] = useState(null); // { workOrderId } when open
  const [mechanicSearch, setMechanicSearch] = useState('');
  const [assigningMechanic, setAssigningMechanic] = useState(null); // mechanic.id being assigned
  const [labelSelected, setLabelSelected] = useState(new Set()); // job sheets to print together
  const debounceRef = useRef(null);
  const didAutoOpen = useRef(false);

  /* Plan usage for order limit warnings */
  const { usage, isAtOrderLimit } = usePlanUsage();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showNewWO, setShowNewWO] = useState(false);
  const [showNewEstimate, setShowNewEstimate] = useState(false);
  const [newWOPresetCustomerId, setNewWOPresetCustomerId] = useState(null);
  const [newWOPresetVehicleId, setNewWOPresetVehicleId] = useState(null);
  // A fresh wizard on every open: nothing typed or chosen for the previous
  // job card (customer approval, technician…) can carry over to the next.
  const [wizardSeq, setWizardSeq] = useState(0);
  const [editWorkOrder, setEditWorkOrder] = useState(null);
  // Prompt shown right after a job card is created, offering to jump straight
  // into the physical inspection (Step 3) — for an external customer the job
  // card opens once they have acknowledged it.
  const [inspectionPrompt, setInspectionPrompt] = useState(null);

  /* A technician works from My Jobs (/mechanic); the workshop's whole book is
     not theirs to browse, and the staff calls below would only be refused. */
  const isTechnician = isTechnicianUser(user);
  useEffect(() => {
    if (isTechnician) navigate('/mechanic', { replace: true });
  }, [isTechnician]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ?new=1 opens the job card wizard straight away — the dashboard's
     "New Work Order" button used to land on the plain list. */
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    openNew();
    const next = new URLSearchParams(searchParams); next.delete('new');
    setSearchParams(next, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ?customer_id=[&vehicle_id=] (the Customers and Vehicles drawers' "New
     job card") opens the wizard with that customer — any customer, internal
     or external. The wizard loads the customer by id itself, so this must not
     depend on the dropdown list above (it only holds the first 500 names). */
  useEffect(() => {
    if (didAutoOpen.current) return;
    const cid = searchParams.get('customer_id');
    if (!cid || !/^\d+$/.test(cid)) return;
    didAutoOpen.current = true;
    const vid = searchParams.get('vehicle_id');
    openNew({ id: Number(cid) }, vid && /^\d+$/.test(vid) ? Number(vid) : null);
    const next = new URLSearchParams(searchParams); next.delete('customer_id'); next.delete('vehicle_id');
    setSearchParams(next, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ?edit=<id> opens the Edit wizard for that job card (the job card
     screen's workflow panel links here to complete missing intake data). */
  useEffect(() => {
    const eid = searchParams.get('edit');
    if (!eid || !/^\d+$/.test(eid)) return;
    const next = new URLSearchParams(searchParams); next.delete('edit');
    setSearchParams(next, { replace: true });
    (async () => {
      try {
        const res = await api.get(`/work-orders/${eid}`);
        if (res.success && res.data) openEdit(res.data);
        else showToast(res.message || t('orders.toast.not_found', 'Job card not found.'), 'error');
      } catch { showToast(t('orders.toast.status_network_error'), 'error'); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* data fetching */
  useEffect(() => { fetchWorkOrders(); }, [page, filters.status, filters.date_from, filters.date_to, filters.work_order_type, filters.customer_id, sortBy, sortDir]);
  useEffect(() => { fetchDropdowns(); fetchStats(); }, []);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchWorkOrders(), 350);
    return () => clearTimeout(debounceRef.current);
  }, [filters.search]);

  /** The list's query: the filters, as GET /work-orders reads them. */
  const listParams = (extra) => {
    const p = new URLSearchParams(extra);
    const statuses = filterStatuses(filters.status);
    if (statuses.length)    p.append('status', statuses.join(','));
    if (filters.search)     p.append('search', filters.search);
    if (filters.date_from)  p.append('date_from', filters.date_from);
    if (filters.date_to)    p.append('date_to', filters.date_to);
    if (filters.work_order_type) p.append('work_order_type', filters.work_order_type);
    if (filters.customer_id)  p.append('customer_id', filters.customer_id);
    return p;
  };

  const fetchWorkOrders = async () => {
    if (isTechnician) return;
    setLoading(true);
    try {
      const p = listParams({ page, limit: LIMIT });
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
    if (isTechnician) return;
    try {
      const res = await api.get('/work-orders/stats');
      if (res.success) setStats(res.data || {});
    } catch {}
  };

  const fetchDropdowns = async () => {
    if (isTechnician) return;
    try {
      const [cRes, dRes] = await Promise.all([
        api.get('/customers?limit=500'), api.get('/mechanics?limit=500'),
      ]);
      if (cRes.success)   setCustomers(cRes.data || []);
      if (dRes.success)   setMechanics(dRes.data || []);
    } catch (e) { console.error(e); }
  };

  const fetchWorkOrderDetail = async (workOrderId) => {
    setDrawerLoading(true);
    try {
      const res = await api.get(`/work-orders/${workOrderId}`);
      if (res.success) setDrawerFull(res.data);
    } catch {}
    finally { setDrawerLoading(false); }
  };

  // Opening and editing job cards is the Service Advisor's / Supervisor's /
  // a manager's job (job.open). Every way in goes through these two, so a
  // ?new=1 or ?customer_id= link does nothing for other roles instead of
  // opening a five-page wizard that can only fail at the last click.
  const mayOpenJob = canDo(user, 'job.open');
  const openNew = (presetCustomer, presetVehicleId = null) => {
    if (!mayOpenJob) {
      showToast(t('orders.toast.job_open_only', 'Only a Service Advisor, Supervisor or manager can open a job card.'), 'error');
      return;
    }
    if (isAtOrderLimit) {
      setShowUpgradeModal(true);
      return;
    }
    // Car-workshop job-card flow (customer → vehicle → services → parts → assign).
    setNewWOPresetCustomerId(presetCustomer?.id || null);
    setNewWOPresetVehicleId(presetCustomer?.id ? presetVehicleId : null);
    setWizardSeq(n => n + 1);
    setShowNewWO(true);
  };

  const openEdit = (order) => {
    if (!mayOpenJob) {
      showToast(t('orders.toast.job_edit_only', 'Only a Service Advisor, Supervisor or manager can edit a job card.'), 'error');
      return;
    }
    if (isClosedStatus(order?.status)) {
      showToast(t('orders.toast.closed_no_edit', 'This job card is closed and can no longer be edited.'), 'error');
      return;
    }
    // Use the new car-workshop job-card modal for editing
    setEditWorkOrder(order);
    setWizardSeq(n => n + 1);
    setShowNewWO(true);
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
        showToast(t('orders.toast.status_updated', { status: woLabel(t, newStatus) }));
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

  /* The customer's status page (/service-status/:token). Older imported jobs
     have no token: their copy / open / WhatsApp-link buttons are hidden. */
  const copyCustomerLink = (wo) => {
    const link = customerStatusUrl(wo);
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(link); setTimeout(() => setCopied(''), 1500);
      showToast(t('orders.toast.link_copied', 'Customer link copied'));
    });
  };
  const openCustomerPage = (wo) => {
    const link = customerStatusUrl(wo);
    if (link) window.open(link, '_blank', 'noopener');
  };

  const openDrawer = (order) => {
    setDrawer(order);
    setDrawerFull(null);
    fetchWorkOrderDetail(order.id);
  };

  /* CSV export — fetches ALL orders with current filters. One row per job
     card in workshop terms; the courier columns (recipient, emirate, cash on
     delivery, delivery fee) are gone. Status in English staff words, like the
     headers. Labour = the labour / service fee; Parts = the parts & services
     lines (cash_amount on itemised jobs). */
  const [exporting, setExporting] = useState(false);
  const exportCSV = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/work-orders?${listParams({ page: 1, limit: 10000 })}`);
      const allWorkOrders = res.success ? (res.data || []) : [];
      if (!allWorkOrders.length) { setExporting(false); return; }
      const classOf = o => [
        o.intake_customer_class ? fmtType(o.intake_customer_class) : '',
        o.intake_customer_subcategory ? (o.intake_customer_subcategory === 'walkin' ? 'Walk-in' : fmtType(o.intake_customer_subcategory)) : '',
      ].filter(Boolean).join(' · ');
      const money = v => Number(v || 0).toFixed(2);
      const headers = ['WO No.','JC No.','Status','Customer','Classification','Plate','Vehicle','Technician','Labour','Parts','VAT','Total','Opened','Closed'];
      const rows = allWorkOrders.map(o => [
        o.work_order_number, o.main_job_card_number || '', woLabel(null, o), o.customer_name || 'Walk-in', classOf(o),
        o.vehicle_plate_number || '', [o.vehicle_make, o.vehicle_model].filter(Boolean).join(' '), o.mechanic_name || '',
        money(o.service_fee), money(o.cash_amount), money(o.vat_amount), money(o.total_amount),
        fmtDate(o.created_at), o.completed_at ? fmtDate(o.completed_at) : '',
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

  /* ── Job sheets: the printed A6 job card with its QR (GET /:id/label, POST /labels) ── */
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
      .catch(e => { console.error(e); showToast(t('orders.toast.job_sheet_failed', 'Could not print the job sheet.'), 'error'); });
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
      .catch(e => { console.error(e); showToast(t('orders.toast.job_sheet_failed', 'Could not print the job sheet.'), 'error'); });
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
    <div style={{ padding: _mob ? '16px' : '28px 32px', maxWidth:1400, margin:'0 auto' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems: _mob ? 'stretch' : 'flex-start', marginBottom: _mob ? 16 : 24, flexDirection: _mob ? 'column' : 'row', gap: _mob ? 12 : 0 }}>
        <div>
          <h2 style={{ margin:0, fontSize: _mob ? 20 : 26, fontWeight:900, color:'#1e293b' }}>{t('orders.title')}</h2>
          <p style={{ margin:'4px 0 0', color:'#94a3b8', fontSize:14 }}>
            {total > 0 ? t('orders.subtitle_count', { count: total }) : t('orders.subtitle_empty')}
          </p>
        </div>
        <div style={{ display:'flex', gap: _mob ? 8 : 10, flexWrap:'wrap' }}>
          {/* Where every car is, by process step. Only for roles that hold the
              board's module (the Storekeeper does not). */}
          {hasModule(user, MODULES.vehicleBoard) && (
            <button onClick={() => navigate('/vehicle-board')} title={t('orders.vehicle_board', 'Vehicle board')}
              style={{ minHeight:44, padding: _mob ? '8px 12px' : '10px 16px', borderRadius:10, border:'1px solid #bfdbfe',
                background:'#eff6ff', cursor:'pointer', fontWeight:600, fontSize: _mob ? 12 : 14,
                color:'#1d4ed8', display:'flex', alignItems:'center', gap: _mob ? 5 : 7 }}>
              <ViewGrid width={15} height={15} /> {t('orders.vehicle_board', 'Vehicle board')}
            </button>
          )}
          {hasModule(user, 'job-assignment') && (
            <button onClick={() => navigate('/job-assignment')} title={t('orders.actions.job-assignment')}
              style={{ minHeight:44, padding:'10px 16px', borderRadius:10, border:'1px solid #d9f99d',
                background:'#f7fee7', cursor:'pointer', fontWeight:600, fontSize:14,
                color:'#4d7c0f', display:'flex', alignItems:'center', gap:7 }}>
              <Group width={15} height={15} /> {t('orders.actions.job-assignment')}
            </button>
          )}
          <button onClick={exportCSV} disabled={exporting} title={t('orders.actions.export')}
            style={{ padding:'10px 16px', borderRadius:10, border:'1px solid #e2e8f0',
              background: exporting ? '#f8fafc' : '#fff',
              cursor: exporting ? 'not-allowed' : 'pointer', fontWeight:600, fontSize:14,
              color: exporting ? '#94a3b8' : '#475569',
              display:'flex', alignItems:'center', gap:7 }}>
            <Download width={15} height={15} /> {exporting ? t('orders.actions.exporting') : t('orders.actions.export')}
          </button>
          {labelSelected.size > 0 && (
            <button onClick={printBatchLabels} title={t('orders.print_job_sheets', 'Print job sheets ({{count}})', { count: labelSelected.size })}
              style={{ minHeight:44, padding:'10px 16px', borderRadius:10, border:'1px solid #fed7aa',
                background:'#fff7ed', cursor:'pointer', fontWeight:600, fontSize:14,
                color:'#c2410c', display:'flex', alignItems:'center', gap:7 }}>
              <Printer width={15} height={15} /> {t('orders.print_job_sheets', 'Print job sheets ({{count}})', { count: labelSelected.size })}
            </button>
          )}
          {/* Estimate-first path: build labour/parts lines, the customer
              approves or rejects each from their phone, and the job card is
              created automatically the moment every line is decided. Sits
              alongside New Job Card rather than replacing it — a walk-in
              whose car is already on the ramp cannot wait on an email
              round-trip, so immediate creation stays available too. */}
          {canDo(user, 'estimate.raise') && <button onClick={() => setShowNewEstimate(true)}
            style={{ padding:'10px 20px', borderRadius:10, border:'1.5px solid #e2e8f0',
              background:'#fff', color:'#1e3a6b', cursor:'pointer', fontWeight:700, fontSize:14,
              display:'flex', alignItems:'center', gap:7 }}>
            <SendMail width={16} height={16} /> {t('dashboard.new_estimate', 'New Estimate')}
          </button>}
          {canDo(user, 'job.open') && <button onClick={() => openNew()}
            style={{ padding:'10px 22px', borderRadius:10, border:'none',
              background: isAtOrderLimit ? '#9ca3af' : 'linear-gradient(135deg,#f97316,#ea580c)', color:'#fff',
              cursor: isAtOrderLimit ? 'not-allowed' : 'pointer', fontWeight:700, fontSize:14, display:'flex', alignItems:'center', gap:7,
              boxShadow: isAtOrderLimit ? 'none' : '0 4px 14px rgba(249,115,22,0.3)' }}
            title={isAtOrderLimit ? `WorkOrder limit reached (${usage?.orders_this_month || '?'}/${usage?.orders_limit || '?'})` : ''}>
            <Plus width={16} height={16} /> {t('orders.new_order')}
          </button>}
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

      {/* KPI Cards — Waiting covers Steps 1–6 up to the Team Leader's
          assignment (checked in, inspected, approved); "approved, to assign"
          is the part the Team Leader can act on now. */}
      {(() => {
        const n = k => Number(stats[k] || 0);
        const count = key => (WO_FILTERS.find(f => f.key === key)?.statuses || []).reduce((sum, s) => sum + n(s), 0);
        return (
          <div style={{ display: _mob ? 'grid' : 'flex', gridTemplateColumns: _mob ? '1fr 1fr' : undefined, gap: _mob ? 10 : 16, marginBottom: _mob ? 16 : 24, flexWrap:'wrap' }}>
            <KPICard icon={ClipboardCheck} label={t('orders.stats.total_orders')} value={stats.total || 0} sub={t('orders.stats.today_count', { count: stats.today||0 })} color="#1e3a6b" />
            <KPICard icon={Clock} label={woFilterLabel(t, 'waiting')} value={count('waiting')}
              sub={t('orders.stats.approved_waiting', '{{n}} approved, to assign', { n: stats.to_assign ?? (n('approved_waiting') + n('estimate_approved') + n('auto_assign')) })} color="#4338ca" />
            <KPICard icon={Wrench} label={woLabel(t, 'in_progress', 'short')} value={count('in_work')}
              sub={t('orders.stats.ready_collection', '{{n}} ready for collection', { n: count('ready') })} color="#0e7490" />
            <KPICard icon={CheckCircle} label={woFilterLabel(t, 'closed')} value={count('closed')} sub={fmtAED(stats.total_revenue)} color="#15803d" />
          </div>
        );
      })()}

      {/* Status filter chips */}
      <div style={{ display:'flex', gap:8, flexWrap: _mob ? 'nowrap' : 'wrap', marginBottom:16, overflowX: _mob ? 'auto' : 'visible', paddingBottom: _mob ? 4 : 0, WebkitOverflowScrolling: 'touch' }}>
        <button onClick={() => { setPage(1); setFilters(f=>({...f, status:''})); }}
          style={{ minHeight:36, padding:'6px 16px', borderRadius:20, border: !filters.status ? '2px solid #1e3a6b' : '1px solid #e2e8f0',
            background: !filters.status ? '#eff6ff' : '#fff', color: !filters.status ? '#1e3a6b' :'#64748b',
            cursor:'pointer', fontWeight:700, fontSize:13, whiteSpace:'nowrap', flexShrink:0 }}>
          {t('orders.filters.all_with_count', { count: stats.total||0 })}
        </button>
        {/* A link from the Dashboard can name statuses no chip stands for
            (e.g. only "Checked in"): show it as its own chip, tap to clear. */}
        {filters.status && !WO_FILTERS.some(f => f.key === filters.status) && (() => {
          const list = filterStatuses(filters.status);
          const tone = woTone(list[0]);
          return (
            <button onClick={() => { setPage(1); setFilters(f=>({...f, status:''})); }}
              style={{ minHeight:36, padding:'6px 14px', borderRadius:20, border:`2px solid ${tone.color}`, background:tone.bg, color:tone.color,
                cursor:'pointer', fontWeight:600, fontSize:12, display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap', flexShrink:0 }}>
              {[...new Set(list.map(s => woLabel(t, s)))].join(' / ')} <Xmark width={12} height={12} />
            </button>
          );
        })()}
        {WO_FILTERS.map(f => {
          const tone = woTone(f.statuses[0]);
          const on = filters.status === f.key;
          const count = f.statuses.reduce((sum, s) => sum + Number(stats[s] || 0), 0);
          return (
            <button key={f.key} onClick={() => { setPage(1); setFilters(x=>({...x, status: x.status===f.key ? '' : f.key})); }}
              style={{ minHeight:36, padding:'6px 14px', borderRadius:20,
                border: on ? `2px solid ${tone.color}` : '1px solid #e2e8f0',
                background: on ? tone.bg : '#fff', color: on ? tone.color : '#64748b',
                cursor:'pointer', fontWeight:600, fontSize:12, display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap', flexShrink:0 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:tone.color }} />
              {woFilterLabel(t, f.key)} ({count})
            </button>
          );
        })}
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
            <ClipboardCheck width={48} height={48} style={{ color:'#cbd5e1', marginBottom:16 }} />
            <h3 style={{ color:'#1e293b', fontSize:16, fontWeight:700 }}>{t('orders.empty.title')}</h3>
            <p style={{ color:'#94a3b8', fontSize:14, marginBottom:18 }}>
              {hasFilters ? t('orders.empty.subtitle_filter') : t('orders.empty.subtitle_new')}
            </p>
            {!hasFilters && mayOpenJob && (
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
                  const tone = woTone(o);
                  const StIcon = tone.icon;
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
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', whiteSpace:'nowrap',
                          borderRadius:20, fontSize:11, fontWeight:700, background:tone.bg, color:tone.color }}>
                          <StIcon width={12} height={12} /> {woLabel(t, o, 'short')}
                        </span>
                      </div>
                      <div style={{ display:'flex', gap:12, fontSize:12, color:'#475569', marginBottom:6 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>{t('common.customer')}</div>
                          <div style={{ fontWeight:600, overflowWrap:'anywhere' }}>{o.customer_name || t('orders.walk_in')}</div>
                          {o.customer_phone && (
                            <div style={{ display:'flex', alignItems:'center', gap:3, fontSize:11, color:'#94a3b8' }} dir="ltr">
                              <Phone width={10} height={10} /> {o.customer_phone}
                            </div>
                          )}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>{t('orders.drawer.vehicle', 'Vehicle')}</div>
                          <div style={{ fontWeight:600 }}>{[o.vehicle_make, o.vehicle_model].filter(Boolean).join(' ') || '\u2014'}</div>
                          {o.vehicle_plate_number && <div style={{ fontSize:11, color:'#94a3b8' }}>{o.vehicle_plate_number}</div>}
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                        {o.service_bay_name && (
                          <span style={{ display:'flex', alignItems:'center', gap:3, fontSize:11, color:'#475569' }}>
                            <MapPin width={11} height={11} color="#94a3b8" /> {o.service_bay_name}
                          </span>
                        )}
                        <span style={{ padding:'2px 8px', borderRadius:12, fontSize:10, fontWeight:600,
                          background:'#f1f5f9', color:'#475569' }}>
                          {fmtType(o.work_order_type)}
                        </span>
                        {o.mechanic_name && (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:11, color:'#475569' }}>
                            <Wrench width={11} height={11} color="#94a3b8" /> {o.mechanic_name}
                          </span>
                        )}
                        <Link to={`/work-orders/${o.id}`} onClick={e => e.stopPropagation()}
                          title={t('orders.open_job_card', 'Open the job card')}
                          style={{ marginInlineStart:'auto', minHeight:36, padding:'0 12px', borderRadius:8, background:'#1e3a6b', color:'#fff',
                            textDecoration:'none', fontSize:12.5, fontWeight:700, display:'inline-flex', alignItems:'center', gap:4 }}>
                          {t('orders.actions.details', 'Details')} <NavArrowRight width={13} height={13} />
                        </Link>
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
                        style={{ cursor:'pointer', width:15, height:15, accentColor:'#f97316' }} title={t('orders.select_all_job_sheets', 'Select all to print their job sheets')} />
                    </th>
                    {[
                      { label: t('orders.table.order_num'), key: 'work_order_number' },
                      { label: t('orders.table.status'), key: 'status' },
                      { label: t('orders.table.customer'), key: '' },
                      { label: t('orders.table.vehicle', 'Vehicle'), key: '' },
                      { label: t('orders.table.total_cost', 'Total Cost'), key: 'total_amount' },
                      { label: t('orders.table.type'), key: '' },
                      { label: t('orders.table.date'), key: 'date' },
                      { label: t('orders.table.closed_at', 'Closed'), key: 'completed_at' },
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
                        <OrderNumCell orderNumber={o.work_order_number} />
                      </td>
                      <td style={{ padding:'13px 16px' }}><StatusPill wo={o} /></td>
                      <td style={{ padding:'13px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <Avatar name={o.customer_name || t('orders.walk_in')} size={34} />
                          <div>
                            <div style={{ fontWeight:600, color:'#1e293b', fontSize:13 }}>
                              {o.customer_name || t('orders.walk_in')}
                            </div>
                            {o.customer_phone && (
                              <div style={{ fontSize:11, color:'#94a3b8', whiteSpace:'nowrap' }} dir="ltr">{o.customer_phone}</div>
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
                          {/* The job card page (Steps 1–7). A link, so Ctrl/Cmd-click opens a new tab. */}
                          <Link to={`/work-orders/${o.id}`} title={t('orders.open_job_card', 'Open the job card')}
                            style={{ padding:'6px 11px', borderRadius:8, border:'1px solid #1e3a6b', background:'#1e3a6b',
                              color:'#fff', textDecoration:'none', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:4, whiteSpace:'nowrap' }}>
                            {t('orders.actions.details', 'Details')} <NavArrowRight width={13} height={13} />
                          </Link>
                          <button onClick={() => openDrawer(o)} title={t('orders.quick_view', 'Quick view')}
                            style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #dbeafe', background:'#eff6ff',
                              color:'#2563eb', cursor:'pointer', display:'flex', alignItems:'center' }}>
                            <Eye width={13} height={13} />
                          </button>
                          <button onClick={() => printSingleLabel(o.id)} title={t('orders.print_job_sheet', 'Print job sheet')}
                            style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #fed7aa', background:'#fff7ed',
                              color:'#ea580c', cursor:'pointer', display:'flex', alignItems:'center' }}>
                            <Printer width={13} height={13} />
                          </button>
                          {mayOpenJob && !isClosedStatus(o.status) && (
                            <button onClick={() => openEdit(o)} title={t('orders.actions.edit')}
                              style={{ padding:'6px 11px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff',
                                cursor:'pointer', fontSize:13, fontWeight:600, color:'#374151', display:'flex', alignItems:'center', gap:5 }}>
                              <EditPencil width={13} height={13} /> {t('orders.actions.edit')}
                            </button>
                          )}
                          {o.customer_phone && (
                            <WhatsAppButton phone={o.customer_phone} order={o} size="small" workshopName={workshop?.name} />
                          )}
                          {customerStatusUrl(o) && o.status !== 'cancelled' && (
                            <button onClick={() => copyCustomerLink(o)} title={t('orders.copy_customer_link', 'Copy customer link')}
                              style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #bbf7d0', background:'#f0fdf4',
                                color:'#16a34a', cursor:'pointer', display:'flex', alignItems:'center' }}>
                              <ShareAndroid width={13} height={13} />
                            </button>
                          )}
                          {customerStatusUrl(o) && o.status !== 'cancelled' && (
                            <button onClick={() => openCustomerPage(o)} title={t('orders.open_customer_page', 'Open the customer\'s status page')}
                              style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #bfdbfe', background:'#eff6ff',
                                color:'#2563eb', cursor:'pointer', display:'flex', alignItems:'center' }}>
                              <OpenNewWindow width={13} height={13} />
                            </button>
                          )}
                          {canSetStatus(user, 'cancelled') && !isClosedStatus(o.status) && (
                            <button onClick={() => setCancelConfirm(o)} title={t('orders.actions.cancel_order')}
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
                        <Fragment key={p2}>
                          {prev && p2 - prev > 1 && (
                            <span style={{ padding:'7px 4px', fontSize:13, color:'#94a3b8' }}>…</span>
                          )}
                          <button onClick={() => setPage(p2)}
                            style={{ ...btnBase,
                              background: p2 === page ? '#1e3a6b' : '#fff',
                              color: p2 === page ? '#fff' : '#374151',
                              border: p2 === page ? '1px solid #1e3a6b' : '1px solid #e2e8f0',
                              fontWeight: p2 === page ? 800 : 600 }}>
                            {p2}
                          </button>
                        </Fragment>
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
          <div onClick={() => { setDrawer(null); setDrawerFull(null); }}
            style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', zIndex:9990, backdropFilter:'blur(4px)' }} />
          <div style={{ position:'fixed', top:0, [isRTL?'left':'right']:0, bottom:0, width:560, maxWidth:'96vw',
            background:'#ffffff', zIndex:9991, overflowY:'auto',
            boxShadow: isRTL ? '8px 0 50px rgba(0,0,0,0.18)' : '-8px 0 50px rgba(0,0,0,0.18)', display:'flex', flexDirection:'column' }}>

            {/* ── Drawer Header ── */}
            <div style={{ background:'linear-gradient(135deg,#0f172a,#1e293b)', padding:'22px 24px 20px', position:'relative' }}>
              <button onClick={() => { setDrawer(null); setDrawerFull(null); }}
                style={{ position:'absolute', top:16, [isRTL?'left':'right']:16, background:'rgba(255,255,255,0.12)',
                  border:'none', color:'#fff', width:32, height:32, borderRadius:10,
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                  transition:'background 0.2s' }}
                onMouseOver={e => e.currentTarget.style.background='rgba(255,255,255,0.2)'}
                onMouseOut={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}>
                <Xmark width={16} height={16} />
              </button>

              {/* WorkOrder number + customer link */}
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14 }}>
                <div style={{ width:44, height:44, borderRadius:12,
                  background:'linear-gradient(135deg,#3b82f6,#2563eb)',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                  boxShadow:'0 4px 12px rgba(59,130,246,0.3)' }}>
                  <ClipboardCheck width={22} height={22} color="#fff" />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:'#fff', fontWeight:800, fontSize:18, letterSpacing:'-0.3px' }}>{drawer.work_order_number}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                    {/* Showed the raw 32-character status token, which means nothing
                        to staff; the button now copies the customer's status link. */}
                    <span style={{ color:'#94a3b8', fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {[drawer.vehicle_plate_number, [drawer.vehicle_make, drawer.vehicle_model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                    </span>
                    {customerStatusUrl(drawer) && <button onClick={() => copyCustomerLink(drawer)} title={t('orders.copy_customer_link', 'Copy customer link')} style={{
                      background:'rgba(255,255,255,0.1)', border:'none', borderRadius:4,
                      padding:'2px 6px', cursor:'pointer', color:'#94a3b8', fontSize:10, fontWeight:600,
                      display:'flex', alignItems:'center', gap:3, flexShrink:0,
                    }}>
                      <Copy width={10} height={10} /> {copied === customerStatusUrl(drawer) ? t('orders.drawer.copied') : t('orders.copy_customer_link', 'Copy customer link')}
                    </button>}
                  </div>
                </div>
              </div>

              {/* Status, plus Reopen / a manager's Override status. Cancel is
                  in the action row below. */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14, flexWrap:'wrap' }}>
                <StatusPill wo={drawerFull || drawer} />
                <StatusMenu wo={drawerFull || drawer} user={user} dark onChange={s => handleStatusChange(drawer.id, s)} />
              </div>

              {/* Action buttons + WhatsApp - single icon row */}
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                {[
                  ...(mayOpenJob && !isClosedStatus(drawerFull?.status || drawer.status) ? [{ label: t('orders.actions.edit'), icon: EditPencil, bg:'#3b82f6', onClick:() => { setDrawer(null); setDrawerFull(null); openEdit(drawerFull || drawer); }}] : []),
                  { label: t('orders.print_job_sheet', 'Print job sheet'), icon: Printer, bg:'#8b5cf6', onClick:() => printSingleLabel(drawer.id) },
                  ...(customerStatusUrl(drawer) && (drawerFull?.status || drawer.status) !== 'cancelled' ? [{ label: t('orders.open_customer_page', 'Open the customer\'s status page'), icon: OpenNewWindow, bg:'#0369a1', onClick:() => openCustomerPage(drawer) }] : []),
                  ...(drawerFull ? [{ label: t('orders.drawer.details'), icon: ArrowRight, bg:'#1e3a6b', onClick:() => { setDrawer(null); setDrawerFull(null); navigate(`/work-orders/${drawerFull.id}`); }}] : []),
                  ...(canSetStatus(user, 'cancelled') && !isClosedStatus(drawerFull?.status || drawer.status) ? [{ label: t('orders.actions.cancel_order'), icon: Prohibition, bg:'transparent', border:true, onClick:() => { setDrawer(null); setCancelConfirm(drawer); }}] : []),
                  // WhatsApp to the customer: the stage and their status link
                  ...(() => {
                    const o = drawerFull || drawer;
                    if (!o?.customer_phone) return [];
                    const msg = () => buildStatusMessage({ t, wo: o, link: customerStatusUrl(o), workshopName: workshop?.name });
                    return [{ label: t('orders.actions.share_whatsapp', 'Share via WhatsApp'), icon: null, waIcon: true, bg:'#25D366', onClick:() => openWhatsApp(o.customer_phone, msg()) }];
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
                    <button onClick={btn.onClick} aria-label={btn.label} style={{
                      width:44, height:44, borderRadius:12,
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
                      always read "0" / "\u2014" for a workshop job card. The cost
                      tile (labelled "Total Cost") showed only the service fee, so
                      a job card with parts read AED 80 instead of its real total. */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:18 }}>
                    {[
                      { label:t('orders.drawer.service_fee'), value:fmtAED(drawerFull.total_amount ?? drawerFull.service_fee), color:'#16a34a', bg:'#f0fdf4', Icon:DollarCircle },
                      { label:t('orders.drawer.type'),         value:fmtType(drawerFull.work_order_type),  color:'#7c3aed', bg:'#faf5ff', Icon:Page },
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

                  {/* ── Customer ── (the sender / recipient blocks of the courier
                      product are gone; a job card has one customer) */}
                  <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0', marginBottom:14 }}>
                    <div style={{ fontWeight:700, fontSize:10, marginBottom:8, color:'#64748b',
                      display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                      <Building width={12} height={12} color="#3b82f6" /> {t('common.customer')}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <Avatar name={drawerFull.customer_name || drawerFull.customer_name_ref || t('orders.walk_in')} size={32} />
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:13, color:'#0f172a', overflowWrap:'anywhere' }}>{drawerFull.customer_name || drawerFull.customer_name_ref || t('orders.walk_in')}</div>
                        {drawerFull.company_name && <div style={{ fontSize:10, color:'#64748b' }}>{drawerFull.company_name}</div>}
                        {(drawerFull.customer_phone || drawerFull.customer_phone_ref) && (
                          <a href={`tel:${drawerFull.customer_phone || drawerFull.customer_phone_ref}`} dir="ltr"
                            style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, color:'#2563eb', textDecoration:'none', fontWeight:600 }}>
                            <Phone width={10} height={10} /> {drawerFull.customer_phone || drawerFull.customer_phone_ref}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Job Details ── */}
                  <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0', marginBottom:14 }}>
                    <div style={{ fontWeight:700, fontSize:10, marginBottom:8, color:'#64748b',
                      display:'flex', alignItems:'center', gap:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                      <Wrench width={12} height={12} color="#8b5cf6" /> {t('orders.drawer.job_details', 'Job Details')}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 16px' }}>
                      {[
                        { label:t('orders.drawer.technician', 'Technician'), value: drawerFull.mechanic_name ? `${drawerFull.mechanic_name}${drawerFull.mechanic_specialty ? ` · ${fmtType(drawerFull.mechanic_specialty)}` : ''}` : null,
                          // Step 6: the Team Leader assigns (job.assign); closed jobs are not reassigned.
                          assignable: !drawerFull.mechanic_name && canDo(user, 'job.assign') && !isClosedStatus(drawerFull.status) },
                        { label:t('orders.drawer.service_category', 'Category'), value: drawerFull.service_category ? fmtType(drawerFull.service_category) : null },
                        { label:t('orders.drawer.vehicle', 'Vehicle'), value: [drawerFull.vehicle_make, drawerFull.vehicle_model, drawerFull.vehicle_year].filter(Boolean).join(' ') || null },
                        { label:t('orders.drawer.plate', 'Plate'), value: drawerFull.vehicle_plate_number },
                        { label:t('orders.drawer.bay', 'Service Bay'), value: drawerFull.service_bay_name },
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
                          const m = woTone(log.status);
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
                                  <span style={{ fontWeight:700, fontSize:11, color:m.color }}>{woLabel(t, log.status)}</span>
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
                            <div style={{ fontSize:10, color:'#94a3b8' }}>{t('orders.drawer.qty')} {Number(item.quantity)}</div>
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
                    <span>{t('orders.drawer.created')} {fmtDate(drawerFull.created_at)} {fmtTime(drawerFull.created_at)}</span>
                    {drawerFull.started_at && <span>{t('orders.drawer.work_started', 'Work started:')} {fmtDate(drawerFull.started_at)} {fmtTime(drawerFull.started_at)}</span>}
                    {drawerFull.completed_at && <span>{t('orders.drawer.closed', 'Closed:')} {fmtDate(drawerFull.completed_at)} {fmtTime(drawerFull.completed_at)}</span>}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </>
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
                          {d.specialty && <span style={{ background:'#f1f5f9', padding:'1px 6px', borderRadius:4 }}>{fmtType(d.specialty)}</span>}
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
        key={wizardSeq}
        open={showNewWO}
        presetCustomerId={newWOPresetCustomerId}
        presetVehicleId={newWOPresetVehicleId}
        editOrder={editWorkOrder}
        currency={cur}
        onClose={() => { setShowNewWO(false); setEditWorkOrder(null); setNewWOPresetCustomerId(null); setNewWOPresetVehicleId(null); }}
        onCreated={(created) => {
          setShowNewWO(false);
          setEditWorkOrder(null);
          setNewWOPresetCustomerId(null);
          setNewWOPresetVehicleId(null);
          fetchWorkOrders();
          fetchStats();
          dispatchPlanUpdate();
          showToast(`Work order created${created?.work_order_number ? ` — ${created.work_order_number}` : ''} ✓`, 'success');
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

      {/* Post-creation prompt — jump straight into the physical inspection */}
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
              {t('workOrders.physical_prompt_title', 'Start the physical inspection?')}
            </h3>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
              {inspectionPrompt.intake_customer_class === 'internal'
                ? t('workOrders.physical_prompt_internal', '{{n}} was created and its job card is open. For an internal customer the walk-around is optional — do it now if you want the vehicle\'s condition on record.', { n: inspectionPrompt.work_order_number || t('workOrders.this_job_card', 'This job card') })
                : t('workOrders.physical_prompt_body', '{{n}} was created. Walk round the vehicle with the customer now — its condition, any damage, photos — and ask them to sign. The job card opens once they have acknowledged it.', { n: inspectionPrompt.work_order_number || t('workOrders.this_job_card', 'This job card') })}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setInspectionPrompt(null)} style={{
                flex: 1, padding: '11px 18px', borderRadius: 10,
                border: '1px solid #e2e8f0', background: '#fff',
                color: '#64748b', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
                {t('workOrders.later', 'Later')}
              </button>
              <button
                onClick={() => { const id = inspectionPrompt.id; setInspectionPrompt(null); navigate(`/work-orders/${id}/inspection?type=intake`); }}
                style={{
                  flex: 1, padding: '11px 18px', borderRadius: 10, border: 'none',
                  background: '#1d4ed8', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {t('workOrders.start_inspection', 'Start the inspection')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
