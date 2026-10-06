import { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Package, DeliveryTruck, User, Phone, MapPin,
  Clock, Check, Xmark, Refresh, EditPencil, Hashtag,
  DollarCircle, Weight, Calendar, CreditCard, Box3dPoint,
  ArrowRight, Copy, WarningTriangle, Notes, Prohibition, Printer,
  Plus, NavArrowUp, NavArrowDown, Trash, ScanBarcode, Eye,
  OpenNewWindow, Globe, Wrench
} from 'iconoir-react';
import { AuthContext } from '../context/AuthContext';
import api from '../lib/api';
import { shareViaWhatsApp, buildOrderMessage } from '../lib/whatsapp';
import MapView from '../components/MapView';
import LocationPicker from '../components/LocationPicker';
import './CRMPages.css';
import './WorkOrderDetail.css';
import FailureReasonModal from '../components/FailureReasonModal';
import { useTranslation } from 'react-i18next';
import { fmtCurrency } from '../utils/currency';
import { getRegions, getRegionLabel } from '../lib/regions';

/* ── WhatsApp SVG Icon ── */
const WhatsAppIcon = ({ width = 16, height = 16, color = 'currentColor' }) => (
  <svg width={width} height={height} viewBox="0 0 24 24" fill={color}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

/* ── Status metadata ──────────────────────────────────────── */
const STATUS_META = {
  pending:          { label: 'Pending',          bg: '#fef3c7', color: '#d97706', icon: Clock },
  confirmed:        { label: 'Confirmed',        bg: '#dbeafe', color: '#2563eb', icon: Check },
  assigned:         { label: 'Assigned',         bg: '#ede9fe', color: '#7c3aed', icon: User },
  accepted:         { label: 'Accepted',         bg: '#e0e7ff', color: '#1565C0', icon: Check },
  in_progress:      { label: 'In Progress',      bg: '#cffafe', color: '#0e7490', icon: Wrench },
  inspection:       { label: 'Inspection',       bg: '#ede9fe', color: '#7c3aed', icon: Eye },
  ready_for_pickup: { label: 'Ready for Pickup', bg: '#ffedd5', color: '#c2410c', icon: Package },
  completed:        { label: 'Completed',        bg: '#dcfce7', color: '#16a34a', icon: Check },
  cancelled:        { label: 'Cancelled',        bg: '#f1f5f9', color: '#64748b', icon: Prohibition },
};

const STATUS_FLOW = ['pending', 'confirmed', 'assigned', 'accepted', 'in_progress', 'inspection', 'ready_for_pickup', 'completed'];

const NEXT_STATUSES = {
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

/* ── Customer-journey checkpoints (layered on top of `status`) ──────── */
const JOURNEY_STAGES = [
  { key: 'intake_inspection', column: 'intake_inspection_at', label: 'Intake Inspection',   step: 3 },
  { key: 'job_card_signed',   column: 'job_card_signed_at',   label: 'Job Card Signed',      step: 4 },
  { key: 'diagnosed',         column: 'diagnosed_at',         label: 'Test Drive & Diagnose', step: 5 },
  { key: 'estimate_approved', column: 'estimate_approved_at', label: 'Estimate Approved',    step: 6 },
  { key: 'joint_inspection',  column: 'joint_inspection_at',  label: 'Joint Inspection',     step: 9 },
  { key: 'invoiced',          column: 'invoiced_at',          label: 'Invoiced',             step: 10 },
];

const PKG_STATUS = {
  created:          { label: 'Created',          bg: '#f1f5f9', color: '#64748b' },
  warehouse_in:     { label: 'Warehouse In',     bg: '#fef3c7', color: '#d97706' },
  assigned:         { label: 'Assigned',         bg: '#ede9fe', color: '#7c3aed' },
  picked_up:        { label: 'Picked Up',        bg: '#fce7f3', color: '#be185d' },
  in_transit:       { label: 'In Transit',       bg: '#e0f2fe', color: '#0369a1' },
  out_for_delivery: { label: 'Out for Delivery', bg: '#dbeafe', color: '#2563eb' },
  delivered:        { label: 'Delivered',         bg: '#dcfce7', color: '#16a34a' },
  failed:           { label: 'Failed',            bg: '#fee2e2', color: '#dc2626' },
  returned:         { label: 'Returned',          bg: '#fff7ed', color: '#ea580c' },
  cancelled:        { label: 'Cancelled',         bg: '#f1f5f9', color: '#94a3b8' },
};

const PKG_NEXT = {
  created: ['warehouse_in','cancelled'],
  warehouse_in: ['assigned','cancelled'],
  assigned: ['picked_up','cancelled'],
  picked_up: ['in_transit'],
  in_transit: ['out_for_delivery','failed','returned'],
  out_for_delivery: ['delivered','failed','returned'],
  delivered: [], failed: ['returned'], returned: [], cancelled: [],
};

// EMIRATES removed — now using getRegions(workshop.country) from lib/regions.js

/* ── Helpers ────────────────────────────────────────────────── */
const fmtDatetime = d => d ? new Date(d).toLocaleString('en-AE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

const fmtType = t => t ? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—';
const timeSince = d => {
  if (!d) return '';
  const sec = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return `${Math.floor(sec/86400)}d ago`;
};

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

/* ── StatusBadge ────────────────────────────────────────────── */
const StatusBadge = ({ status, size = 'md' }) => {
  const { t } = useTranslation();
  const m = STATUS_META[status] || STATUS_META.pending;
  const Icon = m.icon;
  return (
    <span className={`ord-status-badge ${size === 'lg' ? 'lg' : ''}`} style={{ background: m.bg, color: m.color }}>
      <Icon width={size === 'lg' ? 14 : 12} height={size === 'lg' ? 14 : 12} /> {t(`orderDetail.status.${status}`)}
    </span>
  );
};

/* ── StatusProgress ─────────────────────────────────────────── */
const StatusProgress = ({ status }) => {
  const { t } = useTranslation();
  const isTerminal = ['completed','cancelled'].includes(status);
  const currentIdx = isTerminal ? -1 : STATUS_FLOW.indexOf(status);
  return (
    <div className="od-progress-wrap">
      {STATUS_FLOW.map((s, i) => {
        const m = STATUS_META[s];
        const Icon = m.icon;
        const done = !isTerminal && i < currentIdx;
        const active = s === status;
        return (
          <div key={s} className={`od-progress-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
            <div className="od-progress-dot"><Icon width={12} height={12} /></div>
            {i < STATUS_FLOW.length - 1 && <div className={`od-progress-line ${done ? 'done' : ''}`} />}
            <span className="od-progress-label">{t(`orderDetail.status.${s}`)}</span>
          </div>
        );
      })}
      {isTerminal && (
        <div className="od-terminal-badge" style={{ background: STATUS_META[status]?.bg, color: STATUS_META[status]?.color }}>
          {t(`orderDetail.status.${status}`)}
        </div>
      )}
    </div>
  );
};

/* ── QuickStat ──────────────────────────────────────────────── */
const QuickStat = ({ icon: Icon, label, value, color, bg }) => (
  <div className="od-quick-stat" style={{ '--qs-color': color, '--qs-bg': bg }}>
    <div className="od-quick-stat-icon"><Icon width={18} height={18} /></div>
    <div className="od-quick-stat-body">
      <span className="od-quick-stat-value">{value}</span>
      <span className="od-quick-stat-label">{label}</span>
    </div>
  </div>
);

/* ── InfoRow ────────────────────────────────────────────────── */
const InfoRow = ({ icon: Icon, label, value, mono, accent }) => (
  <div className="od-info-row">
    <Icon width={15} height={15} className="od-info-icon" style={accent ? { color: accent } : undefined} />
    <span className="od-info-label">{label}</span>
    <span className={`od-info-value${mono ? ' mono' : ''}`}>{value || '—'}</span>
  </div>
);

/* ══════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════ */
export default function WorkOrderDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, workshop } = useContext(AuthContext);

  const cur = workshop?.currency || 'AED';
  const fmtAED = (v) => fmtCurrency(v, cur);

  const [order, setOrder] = useState(null);
  const [mechanics, setMechanics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusNote, setStatusNote] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [reassignMechanic, setReassignMechanic] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  /* ── Multi-stop state ── */
  const [stops, setStops] = useState([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStop, setEditingStop] = useState(null);
  const [stopSaving, setStopSaving] = useState(false);
  const emptyStop = { address:'', contact_name:'', contact_phone:'', stop_type:'delivery', cash_amount:'0', special_instructions:'', lat:'', lng:'' };
  const [newStop, setNewStop] = useState({...emptyStop});

  /* ── Packages state ── */
  const [packages, setPackages] = useState([]);
  const [pkgSummary, setPkgSummary] = useState({ total: 0, delivered: 0, failed: 0, in_progress: 0 });
  const [pkgLoading, setPkgLoading] = useState(false);
  const [showAddPkg, setShowAddPkg] = useState(false);
  const [pkgSaving, setPkgSaving] = useState(false);
  const [pkgError, setPkgError] = useState('');
  const [expandedPkg, setExpandedPkg] = useState(null);
  const [pkgScanLogs, setPkgScanLogs] = useState({});
  const emptyPkg = { recipient_name:'', recipient_phone:'', recipient_address:'', recipient_area:'', recipient_emirate:'', recipient_lat:'', recipient_lng:'', service_bay_id:'', weight_kg:'', cash_amount:'0', description:'', special_instructions:'', _expanded: false };
  const [newPkgRows, setNewPkgRows] = useState([{...emptyPkg}]);
  const [service_bays, setServiceBays] = useState([]);
  const autoStopsTriggered = useRef(false);
  const [failModal, setFailModal] = useState({ open: false, onConfirm: null, title: '', subtitle: '' });

  /* ── Customer journey + follow-up call state ── */
  const [followUp, setFollowUp] = useState(null);
  const [journeySaving, setJourneySaving] = useState('');

  useEffect(() => { fetchOrder(); fetchMechanics(); fetchStops(); fetchPackages(); fetchServiceBays(); fetchFollowUp(); }, [id]);

  // Re-check stops auto-generation when packages load and stops are empty
  useEffect(() => {
    if (packages.length > 0 && stops.length === 0 && !autoStopsTriggered.current) {
      fetchStops();
    }
  }, [packages]);

  const fetchServiceBays = async () => { try { const r = await api.get('/service-bays'); if (r.success) setServiceBays(r.data || []); } catch {} };
  const fetchOrder = async () => { setLoading(true); const r = await api.get(`/work-orders/${id}`); if (r.success) setOrder(r.data); setLoading(false); };
  const fetchMechanics = async () => { const r = await api.get('/mechanics?limit=500'); if (r.success) setMechanics((r.data || []).filter(d => d.is_active)); };

  const fetchFollowUp = async () => {
    try { const r = await api.get(`/customer-feedback?work_order_id=${id}`); if (r.success) setFollowUp(r.data?.[0] || null); } catch {}
  };
  const logJourneyStage = async (stage) => {
    setJourneySaving(stage);
    try { const r = await api.patch(`/work-orders/${id}/journey`, { stage }); if (r.success) setOrder(r.data); } catch {}
    setJourneySaving('');
  };
  const updateFollowUp = async (status) => {
    if (!followUp) return;
    try { const r = await api.patch(`/customer-feedback/${followUp.id}`, { status }); if (r.success) setFollowUp(r.data); } catch {}
  };

  const fetchPackages = async () => {
    setPkgLoading(true);
    try { const r = await api.get(`/packages/work-order/${id}`); if (r.success) { setPackages(r.data?.packages || []); setPkgSummary(r.data?.summary || { total:0, delivered:0, failed:0, in_progress:0 }); } } catch {}
    setPkgLoading(false);
  };

  const handleAddPackages = async () => {
    const valid = newPkgRows.filter(r => r.recipient_name && r.recipient_phone && r.recipient_address).map(({ _expanded, ...rest }) => rest);
    if (!valid.length) { setPkgError(t('orders.packages.error_required')); return; }
    setPkgSaving(true); setPkgError('');
    try { const r = await api.post('/packages', { work_order_id: Number(id), packages: valid }); if (r.success) { setShowAddPkg(false); setNewPkgRows([{...emptyPkg}]); fetchPackages(); fetchOrder(); } else setPkgError(r.message || 'Failed'); } catch (e) { setPkgError(e.message); }
    setPkgSaving(false);
  };

  const handlePkgStatus = async (pkgId, status, extra = {}) => { try { const r = await api.patch(`/packages/${pkgId}/status`, { status, ...extra }); if (r.success) { fetchPackages(); fetchOrder(); } } catch {} };
  const handleDeletePkg = async (pkgId) => { if (!window.confirm('Delete this package?')) return; try { const r = await api.delete(`/packages/${pkgId}`); if (r.success) { fetchPackages(); fetchOrder(); } } catch {} };
  const fetchPkgScanLogs = async (pkgId) => { try { const r = await api.get(`/packages/${pkgId}`); if (r.success) setPkgScanLogs(prev => ({ ...prev, [pkgId]: r.data?.scan_logs || [] })); } catch {} };

  const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
  const openPdf = (url) => {
    const token = localStorage.getItem('auth_token');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { localStorage.removeItem('auth_token'); window.location.href = '/login'; throw new Error('Session expired'); } if (!r.ok) throw new Error('Failed'); return r.blob(); })
      .then(blob => { const u = URL.createObjectURL(blob); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); })
      .catch(e => console.error('PDF error:', e));
  };
  const printPkgLabel = (pkgId) => openPdf(`${API_BASE_URL}/packages/${pkgId}/label`);
  const printSingleLabel = () => openPdf(`${API_BASE_URL}/work-orders/${id}/label`);

  const handleAutoStops = async () => { try { const r = await api.post(`/packages/work-order/${id}/auto-stops`); if (r.success) fetchStops(true); } catch {} };

  /* ── Multi-stop API calls ── */
  const fetchStops = async (skipAutoGen) => {
    setStopsLoading(true);
    try {
      const r = await api.get(`/multi-stop/work-orders/${id}/stops`);
      const fetchedStops = r.success ? (r.data?.stops || []) : [];
      setStops(fetchedStops);
      // Auto-generate stops from packages if stops are empty and packages exist
      if (!skipAutoGen && !autoStopsTriggered.current && fetchedStops.length === 0 && packages.length > 0) {
        autoStopsTriggered.current = true;
        try {
          const ar = await api.post(`/packages/work-order/${id}/auto-stops`);
          if (ar.success) {
            const r2 = await api.get(`/multi-stop/work-orders/${id}/stops`);
            if (r2.success) setStops(r2.data?.stops || []);
          }
        } catch {}
      }
    } catch {}
    setStopsLoading(false);
  };
  const handleAddStop = async () => { if (!newStop.address) return; setStopSaving(true); try { const r = await api.post(`/multi-stop/work-orders/${id}/stops`, { stops: [{ ...newStop, cash_amount: parseFloat(newStop.cash_amount) || 0, lat: newStop.lat || null, lng: newStop.lng || null }] }); if (r.success) { setNewStop({...emptyStop}); setShowAddForm(false); fetchStops(); } } catch {} setStopSaving(false); };
  const handleEditStop = async (stopId) => { const s = editingStop; if (!s) return; setStopSaving(true); try { const r = await api.put(`/multi-stop/work-orders/${id}/stops/${stopId}`, { address:s.address, contact_name:s.contact_name, contact_phone:s.contact_phone, stop_type:s.stop_type, cash_amount:parseFloat(s.cash_amount)||0, special_instructions:s.special_instructions, lat:s.lat||null, lng:s.lng||null }); if (r.success) { setEditingStop(null); fetchStops(); } } catch {} setStopSaving(false); };
  const handleDeleteStop = async (stopId) => { if (!window.confirm('Delete this stop?')) return; await api.delete(`/multi-stop/work-orders/${id}/stops/${stopId}`); fetchStops(); };
  const handleStopStatus = async (stopId, status, extra = {}) => { await api.patch(`/multi-stop/work-orders/${id}/stops/${stopId}/status`, { status, ...extra }); fetchStops(); };
  const handleReorderStop = async (stopId, direction) => { await api.patch(`/multi-stop/work-orders/${id}/stops/${stopId}/reorder`, { direction }); fetchStops(); };
  const updateStopField = (field, value) => { if (editingStop) setEditingStop(prev => ({ ...prev, [field]: value })); else setNewStop(prev => ({ ...prev, [field]: value })); };

  const handleStatusUpdate = async () => { if (!newStatus) return; setSavingStatus(true); const r = await api.patch(`/work-orders/${id}/status`, { status: newStatus, note: statusNote }); if (r.success) { setNewStatus(''); setStatusNote(''); fetchOrder(); } setSavingStatus(false); };
  const handleReassign = async () => {
    if (!reassignMechanic) return;
    const mechanic = mechanics.find(d => String(d.id) === String(reassignMechanic));
    if (mechanic && mechanic.status === 'busy' && !window.confirm(t('orderDetail.busy_mechanic_warning'))) return;
    setReassigning(true); const r = await api.post('/job-assignment/assign', { work_order_id: Number(id), mechanic_id: Number(reassignMechanic) }); if (r.success) { setShowReassign(false); setReassignMechanic(''); fetchOrder(); fetchMechanics(); } setReassigning(false);
  };
  const copyToken = () => { navigator.clipboard.writeText(order.service_status_token); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const mapMarkers = useMemo(() => {
    const m = [];
    // Pickup / Sender location
    if (order?.sender_lat && order?.sender_lng) m.push({ lat: parseFloat(order.sender_lat), lng: parseFloat(order.sender_lng), type: 'pickup', label: t('orderDetail.pickup'), popup: order.sender_address || order.sender_name || '' });

    // All stops from order_stops
    if (stops.length > 0) {
      stops.forEach((stop, idx) => {
        if (stop.lat && stop.lng) {
          m.push({ lat: parseFloat(stop.lat), lng: parseFloat(stop.lng), type: 'delivery', label: `${t('orderDetail.delivery_label')} #${idx+1}: ${stop.contact_name || ''}`, popup: stop.address || '' });
        }
      });
    }

    // Also add package recipient locations (unique by lat/lng)
    const addedCoords = new Set(m.map(mk => `${mk.lat},${mk.lng}`));
    packages.forEach((pkg, idx) => {
      const lat = parseFloat(pkg.recipient_lat || pkg.lat);
      const lng = parseFloat(pkg.recipient_lng || pkg.lng);
      if (lat && lng && !addedCoords.has(`${lat},${lng}`)) {
        addedCoords.add(`${lat},${lng}`);
        m.push({ lat, lng, type: 'delivery', label: `${pkg.recipient_name || `Package ${idx+1}`}`, popup: pkg.address || pkg.recipient_address || '' });
      }
    });

    // Fallback: single recipient from order if no stops/packages have coords
    if (m.length <= 1 && order?.recipient_lat && order?.recipient_lng) {
      const key = `${parseFloat(order.recipient_lat)},${parseFloat(order.recipient_lng)}`;
      if (!addedCoords.has(key)) {
        m.push({ lat: parseFloat(order.recipient_lat), lng: parseFloat(order.recipient_lng), type: 'delivery', label: t('orderDetail.delivery_label'), popup: order.recipient_address || '' });
      }
    }

    return m;
  }, [order, stops, packages, t]);

  const nextStatuses = NEXT_STATUSES[order?.status] || [];
  const totalCOD = useMemo(() => packages.reduce((s, p) => s + (parseFloat(p.cash_amount) || 0), 0), [packages]);
  const totalWeight = useMemo(() => packages.reduce((s, p) => s + (parseFloat(p.weight_kg) || 0), 0), [packages]);

  /* ══ LOADING ══ */
  if (loading) return (
    <div className="page-container">
      <div className="od-loading">
        <div className="skeleton-pulse" style={{ height: 40, width: 200, borderRadius: 8 }} />
        <div className="skeleton-pulse" style={{ height: 300, borderRadius: 12, marginTop: 20 }} />
      </div>
    </div>
  );

  if (!order) return (
    <div className="page-container">
      <div className="ord-empty">
        <Package width={48} height={48} />
        <h3>{t("orderDetail.order_not_found")}</h3>
        <button className="module-btn module-btn-primary" onClick={() => navigate('/work-orders')}><ArrowLeft width={15} height={15} /> {t('orderDetail.back_to_orders')}</button>
      </div>
    </div>
  );

  return (
    <div className="page-container od-modern">

      {/* ════════════════ HERO HEADER ════════════════ */}
      <div className="od-hero">
        <div className="od-hero-top">
          <button className="od-back-btn" onClick={() => navigate('/work-orders')}><ArrowLeft width={16} height={16} /> {t('orderDetail.orders_back')}</button>
          <div className="od-hero-actions">
            <button className="od-icon-action" onClick={fetchOrder} title={t('orderDetail.refresh')}><Refresh width={16} height={16} /></button>
            <button className="od-icon-action" onClick={copyToken} title={t('orderDetail.copy_tracking_link')}>
              <Copy width={16} height={16} />
              {copied && <span className="od-copied-toast">{t('orderDetail.copied')}</span>}
            </button>
            <a href={`/track/${order.service_status_token}`} target="_blank" rel="noreferrer" className="od-icon-action" title={t('orderDetail.track')}><OpenNewWindow width={16} height={16} /></a>
            <button className="od-icon-action" onClick={printSingleLabel} title={t('orderDetail.print_label', 'Print Label')}><Printer width={16} height={16} /></button>
            <button className="od-icon-action wa" onClick={() => shareViaWhatsApp(order.recipient_phone, buildOrderMessage(order, t, window.location.origin))} title="WhatsApp">
              <WhatsAppIcon width={16} height={16} color="#fff" />
            </button>
          </div>
        </div>
        <div className="od-hero-identity">
          <div className="od-hero-left">
            <div className="od-hero-number-row">
              <h1 className="od-hero-number">{order.work_order_number}</h1>
              <StatusBadge status={order.status} size="lg" />
            </div>
            <div className="od-hero-meta">
              <span className="od-meta-chip type">{fmtType(order.work_order_type)}</span>
              {order.zone_name && <span className="od-meta-chip bay">{order.zone_name}</span>}
              {order.awb_number && <span className="od-meta-chip awb">AWB {order.awb_number}</span>}
              <span className="od-meta-chip token" onClick={copyToken} style={{ cursor:'pointer' }}><Copy width={11} height={11} /> {order.service_status_token}</span>
            </div>
          </div>
          <div className="od-hero-right">
            <button className="od-hero-btn job-assignment" onClick={() => navigate('/job-assignment')}><DeliveryTruck width={15} height={15} /> {t('orderDetail.job-assignment')}</button>
            <button className="od-hero-btn track" onClick={() => navigate('/service-tracking')}><MapPin width={15} height={15} /> {t('orderDetail.all_tracking')}</button>
          </div>
        </div>

        {/* Quick stats — dropped Cash Amount / Weight / Stops tiles that were
            carry-overs from the delivery UI (always \u00a3\u00a3 0 / \u2014 for a workshop
            job card). Kept the workshop-relevant ones. */}
        <div className="od-quick-stats">
          <QuickStat icon={DollarCircle} label={t('orderDetail.service_fee')} value={fmtAED(order.service_fee)} color="#16a34a" bg="#dcfce7" />
          <QuickStat icon={Package} label={t('orderDetail.tab_packages', 'Parts')} value={`${pkgSummary.delivered}/${pkgSummary.total}`} color="#7c3aed" bg="#ede9fe" />
          <QuickStat icon={CreditCard} label={t('orderDetail.payment')} value={t(`orderDetail.payment_labels.${order.payment_method}`, { defaultValue: fmtType(order.payment_method) })} color="#6366f1" bg="#eef2ff" />
        </div>
      </div>

      {/* ════════════════ PROGRESS ════════════════ */}
      <div className="od-progress-card">
        <StatusProgress status={order.status} />
        <div className="od-timestamps">
          <span><Clock width={13} height={13} /> {t('orderDetail.created')} {fmtDatetime(order.created_at)}</span>
          {order.scheduled_at && <span><Calendar width={13} height={13} /> {t('orderDetail.scheduled')} {fmtDatetime(order.scheduled_at)}</span>}
          {order.started_at && <span><Wrench width={13} height={13} /> {t('orderDetail.started')} {fmtDatetime(order.started_at)}</span>}
          {order.completed_at && <span><Check width={13} height={13} /> {t('orderDetail.completed')} {fmtDatetime(order.completed_at)}</span>}
        </div>
      </div>

      {/* ════════════════ CUSTOMER JOURNEY ════════════════ */}
      <div className="od-progress-card">
        <div style={{ fontWeight: 700, fontSize: 13, color: '#1e3a6b', marginBottom: 10 }}>Customer Journey</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {JOURNEY_STAGES.map(stage => {
            const doneAt = order[stage.column];
            // The two inspection steps open the walk-around form instead of
            // just stamping a timestamp — completing that form stamps them.
            const inspectionType = stage.key === 'intake_inspection' ? 'intake'
                                 : stage.key === 'joint_inspection' ? 'joint' : null;
            if (inspectionType) {
              return (
                <button
                  key={stage.key}
                  onClick={() => navigate(`/work-orders/${id}/inspection?type=${inspectionType}`)}
                  title={doneAt ? `${fmtDatetime(doneAt)} — open inspection form` : `Open the ${stage.label} form`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
                    fontSize: 12, fontWeight: 600, border: '1px solid', cursor: 'pointer',
                    background: doneAt ? '#dcfce7' : '#eff6ff',
                    color: doneAt ? '#16a34a' : '#1d4ed8',
                    borderColor: doneAt ? '#bbf7d0' : '#bfdbfe',
                  }}
                >
                  {doneAt ? <Check width={13} height={13} /> : <Eye width={13} height={13} />}
                  {stage.label}{doneAt ? ` · ${fmtDatetime(doneAt)}` : ''}
                </button>
              );
            }
            return (
              <button
                key={stage.key}
                disabled={!!doneAt || journeySaving === stage.key}
                onClick={() => logJourneyStage(stage.key)}
                title={doneAt ? fmtDatetime(doneAt) : `Mark "${stage.label}" done`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
                  fontSize: 12, fontWeight: 600, border: '1px solid', cursor: doneAt ? 'default' : 'pointer',
                  background: doneAt ? '#dcfce7' : '#f8fafc',
                  color: doneAt ? '#16a34a' : '#64748b',
                  borderColor: doneAt ? '#bbf7d0' : '#e2e8f0',
                }}
              >
                {doneAt ? <Check width={13} height={13} /> : <span style={{ width: 13, height: 13, borderRadius: '50%', border: '1.5px solid #cbd5e1', display: 'inline-block' }} />}
                {stage.label}{doneAt ? ` · ${fmtDatetime(doneAt)}` : ''}
              </button>
            );
          })}
        </div>
        {followUp && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1e3a6b' }}>Follow-up call</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {followUp.status === 'scheduled' && `Scheduled for ${fmtDatetime(followUp.scheduled_at)}`}
              {followUp.status === 'attempted' && 'Attempted, no answer yet'}
              {followUp.status === 'completed' && `Done ${fmtDatetime(followUp.completed_at)}`}
              {followUp.status === 'skipped' && 'Skipped'}
            </span>
            {['scheduled', 'attempted'].includes(followUp.status) && (
              <>
                <button onClick={() => updateFollowUp('attempted')} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 14, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer' }}>Mark Attempted</button>
                <button onClick={() => updateFollowUp('completed')} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 14, border: '1px solid #bbf7d0', background: '#dcfce7', color: '#16a34a', cursor: 'pointer' }}>Mark Done</button>
                <button onClick={() => updateFollowUp('skipped')} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 14, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer' }}>Skip</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ════════════════ TABS ════════════════ */}
      <div className="od-tabs">
        {[
          { key:'overview', label:t('orderDetail.tab_details'), icon:Eye },
          { key:'packages', label:t('orderDetail.tab_packages', 'Packages'), icon:Package, badge:pkgSummary.total||null, badgeColor:pkgSummary.delivered>=pkgSummary.total&&pkgSummary.total>0?'#16a34a':pkgSummary.delivered>0?'#d97706':undefined },
          { key:'timeline', label:t('orderDetail.tab_timeline'), icon:Clock, badge:order.status_logs?.length||null },
          { key:'items', label:t('orderDetail.tab_items'), icon:Box3dPoint, badge:order.items?.length||null },
          { key:'stops', label:t('orderDetail.tab_stops', 'Stops'), icon:MapPin, badge:stops.length||null },
        ].map(tab => (
          <button key={tab.key} className={`od-tab ${activeTab===tab.key?'active':''}`} onClick={() => setActiveTab(tab.key)}>
            <tab.icon width={14} height={14} />
            {tab.label}
            {tab.badge && <span className="od-tab-badge" style={tab.badgeColor?{background:tab.badgeColor}:undefined}>{tab.badge}</span>}
          </button>
        ))}
      </div>

      <div className="od-body">

        {/* ════════════════ OVERVIEW ════════════════ */}
        {activeTab === 'overview' && (
          <>
            {/* Customer + Vehicle */}
            <div className="od-overview-grid">
              <div className="od-card od-card-sender">
                <div className="od-card-header"><div className="od-card-icon sender"><User width={16} height={16} /></div><h4>{t('orderDetail.section.customer', 'Customer')}</h4></div>
                <div className="od-card-body">
                  <InfoRow icon={User} label={t('orderDetail.name')} value={order.customer_name || order.sender_name} />
                  <InfoRow icon={Phone} label={t('orderDetail.phone')} value={<span className="od-phone-row"><span className="mono">{order.customer_phone || order.sender_phone}</span>{(order.customer_phone || order.sender_phone) && <button className="wa-share-inline sm" onClick={() => shareViaWhatsApp(order.customer_phone || order.sender_phone, buildOrderMessage(order, t, window.location.origin))}><WhatsAppIcon width={14} height={14} color="#fff" /></button>}</span>} />
                  {order.customer_email && <InfoRow icon={User} label={t('orderDetail.email', 'Email')} value={order.customer_email} />}
                </div>
              </div>
              <div className="od-card od-card-recipient">
                <div className="od-card-header"><div className="od-card-icon recipient"><Wrench width={16} height={16} /></div><h4>{t('orderDetail.section.vehicle', 'Vehicle')}</h4></div>
                <div className="od-card-body">
                  {(order.vehicle_make || order.vehicle_model) ? (
                    <>
                      <InfoRow icon={Wrench} label={t('orderDetail.vehicle_make_model', 'Make / Model')} value={[order.vehicle_make, order.vehicle_model, order.vehicle_year].filter(Boolean).join(' ')} />
                      {order.vehicle_plate_number && <InfoRow icon={Hashtag} label={t('orderDetail.plate', 'Plate')} value={order.vehicle_plate_number} mono />}
                      {order.vehicle_color && <InfoRow icon={Box3dPoint} label={t('orderDetail.color', 'Color')} value={order.vehicle_color} />}
                      {order.vehicle_vin && <InfoRow icon={Hashtag} label="VIN" value={order.vehicle_vin} mono />}
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>{t('orderDetail.no_vehicle', 'No vehicle linked to this job card.')}</div>
                  )}
                </div>
              </div>
            </div>

            {/* WorkOrder Info + Financial + Mechanic */}
            <div className="od-overview-grid three-col">
              <div className="od-card">
                <div className="od-card-header"><div className="od-card-icon info"><Package width={16} height={16} /></div><h4>{t('orderDetail.section.order_info')}</h4></div>
                <div className="od-card-body">
                  <InfoRow icon={Hashtag} label={t('orderDetail.order_num')} value={order.work_order_number} mono />
                  {order.awb_number && <InfoRow icon={Hashtag} label="AWB" value={order.awb_number} mono />}
                  <InfoRow icon={Box3dPoint} label={t('orderDetail.type')} value={fmtType(order.work_order_type)} />
                  <InfoRow icon={CreditCard} label={t('orderDetail.payment')} value={t(`orderDetail.payment_labels.${order.payment_method}`, { defaultValue: order.payment_method })} />
                  {order.customer_name && <InfoRow icon={User} label={t('orderDetail.customer')} value={order.customer_name} />}
                </div>
              </div>

              <div className="od-card od-card-financial">
                <div className="od-card-header"><div className="od-card-icon financial"><DollarCircle width={16} height={16} /></div><h4>{t('orderDetail.section.financial')}</h4></div>
                <div className="od-card-body">
                  <div className="od-fin-rows">
                    <div className="od-fin-row"><span>{t('orderDetail.fin.subtotal')}</span><span className="od-fin-amount">{fmtAED(order.service_fee)}</span></div>
                    {parseFloat(order.discount) > 0 && <div className="od-fin-row discount"><span>{t('orderDetail.fin.discount')}</span><span>- {fmtAED(order.discount)}</span></div>}
                    {parseFloat(order.commission_amount) > 0 && <div className="od-fin-row commission"><span>{t('orderDetail.fin.commission')} ({order.commission_rate}%)</span><span>- {fmtAED(order.commission_amount)}</span></div>}
                    {parseFloat(order.vat_amount) > 0 && <div className="od-fin-row vat"><span>{t('orderDetail.fin.vat')} ({order.vat_rate}%)</span><span>{fmtAED(order.vat_amount)}</span></div>}
                    {parseFloat(order.platform_fee) > 0 && <div className="od-fin-row platform"><span>{t('orderDetail.fin.platform_fee')}</span><span>- {fmtAED(order.platform_fee)}</span></div>}
                    <div className="od-fin-divider" />
                    {parseFloat(order.net_payable) > 0 && <div className="od-fin-row total net"><span>{t('orderDetail.fin.net_payable')}</span><span>{fmtAED(order.net_payable)}</span></div>}
                    <div className="od-fin-row total"><span>{t('orderDetail.fin.total')}</span><span>{fmtAED(order.total_amount)}</span></div>
                  </div>
                </div>
              </div>

              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-icon mechanic"><DeliveryTruck width={16} height={16} /></div>
                  <h4>{t('orderDetail.section.mechanic')}</h4>
                  {['pending','confirmed','assigned'].includes(order.status) && (
                    <button className="od-card-action" onClick={() => setShowReassign(v => !v)}><EditPencil width={12} height={12} /> {order.mechanic_id ? t('orderDetail.reassign') : t('orderDetail.assign_mechanic')}</button>
                  )}
                </div>
                <div className="od-card-body">
                  {order.mechanic_name ? (
                    <>
                      <div className="od-mechanic-hero">
                        <div className="od-mechanic-avatar">{order.mechanic_name.charAt(0).toUpperCase()}</div>
                        <div>
                          <div className="od-mechanic-name">{order.mechanic_name}</div>
                          <div className="od-mechanic-vehicle">
                            {order.mechanic_specialty ? fmtType(order.mechanic_specialty) : ''}
                            {order.service_bay_name ? ` • ${order.service_bay_name}` : ''}
                          </div>
                        </div>
                      </div>
                      <InfoRow icon={Phone} label={t('orderDetail.phone')} value={<span className="od-phone-row"><span className="mono">{order.mechanic_phone}</span>{order.mechanic_phone && <button className="wa-share-inline sm" onClick={() => shareViaWhatsApp(order.mechanic_phone, buildOrderMessage(order, t, window.location.origin))}><WhatsAppIcon width={14} height={14} color="#fff" /></button>}</span>} />
                    </>
                  ) : (
                    <div className="od-no-mechanic-box"><DeliveryTruck width={24} height={24} /><span>{t("orderDetail.no_mechanic")}</span></div>
                  )}
                  {showReassign && (
                    <div className="od-reassign-row">
                      <select className="od-select" value={reassignMechanic} onChange={e => setReassignMechanic(e.target.value)}>
                        <option value="">{t('orderDetail.select_mechanic')}</option>
                        {mechanics.map(d => <option key={d.id} value={d.id}>{d.full_name}{d.specialty ? ` (${fmtType(d.specialty)})` : ''}{d.status === 'busy' ? ` ⚠ ${t('orderDetail.status.busy', 'Busy')}` : ''}</option>)}
                      </select>
                      <button className="module-btn module-btn-primary sm" onClick={handleReassign} disabled={!reassignMechanic || reassigning}>{reassigning ? t('orderDetail.assigning') : t('orderDetail.confirm')}</button>
                      <button className="module-btn module-btn-outline sm" onClick={() => setShowReassign(false)}>{t("common.cancel")}</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Notes + Status Update */}
            <div className="od-overview-grid">
              {(order.notes || order.description || order.special_instructions) && (
                <div className="od-card">
                  <div className="od-card-header"><div className="od-card-icon notes"><Notes width={16} height={16} /></div><h4>{t('orderDetail.section.notes')}</h4></div>
                  <div className="od-card-body">
                    {(() => {
                      const parsed = parseSrcNotes(order.notes);
                      if (parsed.kind === 'json' && parsed.entries.length > 0) {
                        return (
                          <div style={{ marginBottom: (order.description || order.special_instructions) ? 10 : 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {t('orderDetail.fin.migration_source', { defaultValue: 'Migration Info' })}
                              {parsed.source && (
                                <span style={{ fontSize: 9, fontWeight: 800, color: '#78350f', background: '#fde68a', padding: '1px 6px', borderRadius: 4, letterSpacing: '0.04em' }}>
                                  {parsed.source}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', rowGap: 6, columnGap: 16 }}>
                              {parsed.entries.map(([label, value]) => (
                                <div key={label} style={{ fontSize: 12, color: '#334155' }}>
                                  <span style={{ fontWeight: 700, color: '#64748b', marginRight: 4 }}>{label}:</span>
                                  <span>{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      if (parsed.kind === 'text' || parsed.kind === 'json') {
                        return parsed.text ? <p className="od-note-text">{parsed.text}</p> : null;
                      }
                      return null;
                    })()}
                    {order.description && <p className="od-note-text">{order.description}</p>}
                    {order.special_instructions && <div className="od-note-warn"><WarningTriangle width={14} height={14} /> {order.special_instructions}</div>}
                  </div>
                </div>
              )}
              {nextStatuses.length > 0 && (
                <div className="od-card od-card-status">
                  <div className="od-card-header"><div className="od-card-icon status"><ArrowRight width={16} height={16} /></div><h4>{t('orderDetail.update_status')}</h4></div>
                  <div className="od-card-body">
                    <div className="od-status-actions">
                      {nextStatuses.map(s => { const m = STATUS_META[s]; const Icon = m.icon; return (
                        <button key={s} className={`od-status-btn ${newStatus===s?'selected':''}`} style={{'--s-color':m.color,'--s-bg':m.bg}} onClick={() => setNewStatus(ns => ns===s?'':s)}><Icon width={14} height={14} /> {t(`orderDetail.status.${s}`)}</button>
                      ); })}
                    </div>
                    {newStatus && (
                      <div className="od-status-confirm">
                        <input type="text" className="od-note-input" placeholder={t("orderDetail.add_note")} value={statusNote} onChange={e => setStatusNote(e.target.value)} />
                        <button className="module-btn module-btn-primary" onClick={handleStatusUpdate} disabled={savingStatus}>{savingStatus ? t('orderDetail.saving') : t('orderDetail.mark_as', { status: t(`orderDetail.status.${newStatus}`) })}</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Proof & Evidence */}
            {(order.proof_of_delivery_url || order.signature_url || order.pickup_proof_url || order.pickup_signature_url || (order.photos && order.photos.length > 0) || (stops && stops.some(s => s.proof_photo_url || s.signature_url)) || (packages && packages.some(p => p.proof_photo_url || p.signature_url))) && (
              <div className="od-card">
                <div className="od-card-header"><div className="od-card-icon notes"><Eye width={16} height={16} /></div><h4>{t('orderDetail.section.proof', { defaultValue: 'Proof & Evidence' })}</h4></div>
                <div className="od-card-body">
                  {/* Multi-photo gallery */}
                  {order.photos && order.photos.length > 0 && (
                    <div style={{ marginBottom: order.signature_url ? 16 : 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                        {t('orderDetail.delivery_photos', { defaultValue: 'Delivery Photos' })}
                        <span style={{ fontWeight: 400, marginInlineStart: 6, color: '#94a3b8' }}>({order.photos.length})</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {order.photos.map((p) => (
                          <div key={p.id} style={{ position: 'relative' }}>
                            <a href={p.photo_url} target="_blank" rel="noopener noreferrer">
                              <img src={p.photo_url} alt={p.photo_type || 'Delivery photo'} style={{ width: 140, height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
                            </a>
                            {p.caption && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption}</div>}
                            {p.stop_id && <div style={{ position: 'absolute', top: 4, left: 4, background: '#0d9488', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>{t('orderDetail.stop_label', { defaultValue: 'Stop' })}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Pickup proof */}
                  {order.pickup_proof_url && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>{t('orderDetail.pickup_proof', { defaultValue: 'Pickup Proof Photo' })}</div>
                      <a href={order.pickup_proof_url} target="_blank" rel="noopener noreferrer">
                        <img src={order.pickup_proof_url} alt="Pickup proof" style={{ width: 180, height: 140, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
                      </a>
                    </div>
                  )}
                  {order.pickup_signature_url && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>{t('orderDetail.pickup_signature', { defaultValue: 'Pickup Signature' })}</div>
                      <a href={order.pickup_signature_url} target="_blank" rel="noopener noreferrer">
                        <img src={order.pickup_signature_url} alt="Pickup signature" style={{ width: 180, height: 140, objectFit: 'contain', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
                      </a>
                    </div>
                  )}
                  {/* Additional proof media */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                    {(!order.photos || order.photos.length === 0) && order.proof_of_delivery_url && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>{t('orderDetail.proof_of_delivery', { defaultValue: 'Proof of Delivery' })}</div>
                        <a href={order.proof_of_delivery_url} target="_blank" rel="noopener noreferrer">
                          <img src={order.proof_of_delivery_url} alt="Proof of delivery" style={{ width: 180, height: 140, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
                        </a>
                      </div>
                    )}
                    {stops && stops.filter(s => s.proof_photo_url).map((s, i) => (
                      <div key={`stop-proof-${s.id || i}`}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                          {t('orderDetail.stop_proof', { defaultValue: 'Stop {{num}} Proof', num: s.sequence_number || s.stop_order || (i + 1) })}
                        </div>
                        <a href={s.proof_photo_url} target="_blank" rel="noopener noreferrer">
                          <img src={s.proof_photo_url} alt={`Stop ${s.sequence_number || s.stop_order || i+1} proof`} style={{ width: 180, height: 140, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
                        </a>
                      </div>
                    ))}
                    {packages && packages.filter(p => p.proof_photo_url).map((p, i) => (
                      <div key={`pkg-proof-${p.id || i}`}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                          {t('orderDetail.package_proof', { defaultValue: 'Package {{num}} Proof', num: p.sequence || (i + 1) })}
                        </div>
                        <a href={p.proof_photo_url} target="_blank" rel="noopener noreferrer">
                          <img src={p.proof_photo_url} alt={`Package ${p.sequence || i+1} proof`} style={{ width: 180, height: 140, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
                        </a>
                      </div>
                    ))}
                  </div>
                  {/* Signatures */}
                  {(order.signature_url || (stops && stops.some(s => s.signature_url && s.signature_url !== order.signature_url)) || (packages && packages.some(p => p.signature_url && p.signature_url !== order.signature_url))) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: (order.photos?.length > 0 || order.proof_of_delivery_url || (stops && stops.some(s => s.proof_photo_url)) || (packages && packages.some(p => p.proof_photo_url))) ? 16 : 0 }}>
                      {order.signature_url && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>{t('orderDetail.signature', { defaultValue: 'Recipient Signature' })}</div>
                          <a href={order.signature_url} target="_blank" rel="noopener noreferrer">
                            <img src={order.signature_url} alt="Signature" style={{ width: 180, height: 140, objectFit: 'contain', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
                          </a>
                        </div>
                      )}
                      {stops && stops.filter(s => s.signature_url && s.signature_url !== order.signature_url).map((s, i) => (
                        <div key={`stop-signature-${s.id || i}`}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                            {t('orderDetail.stop_signature', { defaultValue: 'Stop {{num}} Signature', num: s.sequence_number || s.stop_order || (i + 1) })}
                          </div>
                          <a href={s.signature_url} target="_blank" rel="noopener noreferrer">
                            <img src={s.signature_url} alt={`Stop ${s.sequence_number || s.stop_order || i+1} signature`} style={{ width: 180, height: 140, objectFit: 'contain', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
                          </a>
                        </div>
                      ))}
                      {packages && packages.filter(p => p.signature_url && p.signature_url !== order.signature_url).map((p, i) => (
                        <div key={`pkg-signature-${p.id || i}`}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                            {t('orderDetail.package_signature', { defaultValue: 'Package {{num}} Signature', num: p.sequence || (i + 1) })}
                          </div>
                          <a href={p.signature_url} target="_blank" rel="noopener noreferrer">
                            <img src={p.signature_url} alt={`Package ${p.sequence || i+1} signature`} style={{ width: 180, height: 140, objectFit: 'contain', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Map */}
            {mapMarkers.length > 0 && (
              <div className="od-card od-card-map">
                <div className="od-card-header"><div className="od-card-icon map"><MapPin width={16} height={16} /></div><h4>{t('orderDetail.section.location')}</h4></div>
                <div className="od-map-body">
                  <MapView markers={mapMarkers} height={280} zoom={12} center={mapMarkers[mapMarkers.length-1] ? [mapMarkers[mapMarkers.length-1].lat, mapMarkers[mapMarkers.length-1].lng] : undefined} />
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════════════ PACKAGES ════════════════ */}
        {activeTab === 'packages' && (
          <div className="od-packages-section">
            <div className="od-pkg-header">
              <div className="od-pkg-header-left">
                <h3><Package width={18} height={18} /> {t('orders.packages.add_packages', 'Packages')}</h3>
                {pkgSummary.total > 0 && (
                  <div className="od-pkg-stats-row">
                    <span className="od-pkg-stat delivered">{pkgSummary.delivered} {t('orderDetail.status.delivered')}</span>
                    {pkgSummary.failed > 0 && <span className="od-pkg-stat failed">{pkgSummary.failed} {t('orderDetail.status.failed')}</span>}
                    <span className="od-pkg-stat total">{pkgSummary.total} {t('orderDetail.total_count', { count: pkgSummary.total }).replace(String(pkgSummary.total), '').trim()}</span>
                    {totalCOD > 0 && <span className="od-pkg-stat cod">{t('orderDetail.cod_label')} {fmtAED(totalCOD)}</span>}
                    {totalWeight > 0 && <span className="od-pkg-stat weight">{totalWeight.toFixed(1)} kg</span>}
                  </div>
                )}
              </div>
              <div className="od-pkg-header-actions">
                {packages.length > 0 && <button className="module-btn module-btn-outline sm" onClick={handleAutoStops}><MapPin width={13} height={13} /> {t('orders.packages.auto_stops')}</button>}
                <button className="module-btn module-btn-primary sm" onClick={() => setShowAddPkg(true)}><Plus width={13} height={13} /> {t('orders.packages.add_packages')}</button>
              </div>
            </div>

            {pkgSummary.total > 0 && (
              <div className="od-pkg-progress">
                <div className="od-pkg-progress-bar">
                  <div className="od-pkg-progress-fill delivered" style={{ width: `${(pkgSummary.delivered/pkgSummary.total)*100}%` }} />
                  <div className="od-pkg-progress-fill failed" style={{ width: `${(pkgSummary.failed/pkgSummary.total)*100}%` }} />
                </div>
                <span className="od-pkg-progress-text">{pkgSummary.delivered+pkgSummary.failed}/{pkgSummary.total} {t('orderDetail.complete', 'completed')}</span>
              </div>
            )}

            {/* Add packages form */}
            {showAddPkg && (
              <div className="od-pkg-add-form">
                <div className="od-pkg-add-header"><h5><Package width={15} height={15} /> {t('orders.packages.new_packages')}</h5><span className="od-pkg-add-count">{newPkgRows.filter(r => r.recipient_name).length} {t('orderDetail.tab_packages', 'packages')}</span></div>
                {pkgError && <div className="od-pkg-error"><WarningTriangle width={14} height={14} /> {pkgError}</div>}
                <div className="od-pkg-hint"><Package width={13} height={13} /> {t('orders.packages.section_hint')}</div>
                {newPkgRows.map((row, idx) => {
                  const isExpanded = row._expanded;
                  const updateRow = (field, value) => { const r = [...newPkgRows]; r[idx] = { ...r[idx], [field]: value }; setNewPkgRows(r); };
                  const handleZoneChange = (serviceBayId) => { const r = [...newPkgRows]; r[idx] = { ...r[idx], service_bay_id: serviceBayId }; const z = service_bays.find(z => String(z.id) === String(serviceBayId)); if(z){r[idx].recipient_area=z.name||'';r[idx].recipient_emirate=z.emirate||'';r[idx].recipient_lat=z.center_lat||'';r[idx].recipient_lng=z.center_lng||'';} setNewPkgRows(r); };
                  return (
                    <div key={idx} className="od-pkg-form-card">
                      <div className="od-pkg-form-card-header">
                        <div className="od-pkg-form-num">{idx+1}</div>
                        <span className="od-pkg-form-title">{t('orders.packages.package_num', { num: idx+1 })}</span>
                        {row.recipient_name && <span className="od-pkg-form-preview">— {row.recipient_name}</span>}
                        <div className="od-pkg-form-controls">
                          <button className="od-pkg-form-toggle" onClick={() => updateRow('_expanded', !isExpanded)}>{isExpanded ? t('orders.packages.collapse_details') : t('orders.packages.expand_details')}</button>
                          <button className="od-pkg-form-delete" onClick={() => { const r = newPkgRows.filter((_,i)=>i!==idx); setNewPkgRows(r.length?r:[{...emptyPkg}]); }}><Trash width={13} height={13} /></button>
                        </div>
                      </div>
                      <div className="od-pkg-form-grid">
                        <div className="od-field"><label>{t('orders.packages.name')} *</label><input value={row.recipient_name} placeholder={t('orders.packages.name')} onChange={e => updateRow('recipient_name', e.target.value)} /></div>
                        <div className="od-field"><label>{t('orders.packages.phone')} *</label><input value={row.recipient_phone} placeholder="+971..." onChange={e => updateRow('recipient_phone', e.target.value)} /></div>
                        <div className="od-field"><label>{t('orders.packages.bay')}</label><select value={row.service_bay_id||''} onChange={e => handleZoneChange(e.target.value)}><option value="">{t('orders.packages.select_zone')}</option>{service_bays.filter(z => z.is_active).map(z => <option key={z.id} value={z.id}>{z.name} — {z.emirate}</option>)}</select></div>
                      </div>
                      <div className="od-pkg-form-grid wide">
                        <div className="od-field span-2"><label>{t('orders.packages.address')} *</label><input value={row.recipient_address} placeholder={t('orders.packages.address')} onChange={e => updateRow('recipient_address', e.target.value)} /></div>
                        <div className="od-field"><label>{t('orders.packages.area')}</label><input value={row.recipient_area||''} placeholder={t('orders.packages.area')} onChange={e => updateRow('recipient_area', e.target.value)} /></div>
                        <div className="od-field"><label>{getRegionLabel(workshop?.country, i18n.language)}</label>{getRegions(workshop?.country).length > 0 ? <select value={row.recipient_emirate||''} onChange={e => updateRow('recipient_emirate', e.target.value)}><option value="">—</option>{getRegions(workshop?.country).map(em => <option key={em} value={em}>{em}</option>)}</select> : <input value={row.recipient_emirate||''} onChange={e => updateRow('recipient_emirate', e.target.value)} placeholder={getRegionLabel(workshop?.country, i18n.language)} />}</div>
                      </div>
                      <div className="od-pkg-form-grid"><div className="od-field"><label>{t('orders.packages.weight')}</label><input type="number" step="0.1" value={row.weight_kg} placeholder="0.0" onChange={e => updateRow('weight_kg', e.target.value)} /></div><div className="od-field"><label>{t('orders.packages.cod')}</label><input type="number" step="0.01" value={row.cash_amount} placeholder="0.00" onChange={e => updateRow('cash_amount', e.target.value)} /></div></div>
                      {(row.recipient_lat && row.recipient_lng) && <div className="od-pkg-location-badge"><MapPin width={12} height={12} /> {parseFloat(row.recipient_lat).toFixed(5)}, {parseFloat(row.recipient_lng).toFixed(5)}{row.service_bay_id && <span className="od-pkg-auto-tag">{t('orders.packages.location_auto')}</span>}</div>}
                      {isExpanded && (
                        <div className="od-pkg-form-expanded">
                          <LocationPicker lat={row.recipient_lat||''} lng={row.recipient_lng||''} address={row.recipient_address||''} height={200} markerType="delivery" onChange={({ lat, lng, address }) => { updateRow('recipient_lat', lat); updateRow('recipient_lng', lng); if(address)updateRow('recipient_address', address); }} />
                          <div className="od-pkg-form-grid"><div className="od-field"><label>{t('orders.packages.description')}</label><textarea rows={2} value={row.description||''} onChange={e => updateRow('description', e.target.value)} /></div><div className="od-field"><label>{t('orders.packages.special_instructions')}</label><textarea rows={2} value={row.special_instructions||''} onChange={e => updateRow('special_instructions', e.target.value)} /></div></div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="od-pkg-form-actions">
                  <button className="od-pkg-add-row-btn" onClick={() => setNewPkgRows(prev => [...prev, {...emptyPkg}])}><Plus width={14} height={14} /> {t('orders.packages.add_row')}</button>
                  <button className="module-btn module-btn-outline sm" onClick={() => { setShowAddPkg(false); setPkgError(''); setNewPkgRows([{...emptyPkg}]); }}>{t('orders.form.cancel', 'Cancel')}</button>
                  <button className="module-btn module-btn-primary sm" onClick={handleAddPackages} disabled={pkgSaving}>{pkgSaving ? t('orders.packages.creating') : t('orders.packages.create_btn', { count: newPkgRows.filter(r => r.recipient_name).length })}</button>
                </div>
              </div>
            )}

            {/* Package list */}
            <div className="od-pkg-list">
              {pkgLoading ? (
                <div className="od-loading"><div className="skeleton-pulse" style={{ height:90, borderRadius:12 }} /><div className="skeleton-pulse" style={{ height:90, borderRadius:12, marginTop:8 }} /></div>
              ) : packages.length === 0 ? (
                <div className="od-pkg-empty"><Package width={40} height={40} /><div className="od-pkg-empty-title">{t('orders.packages.no_packages')}</div><div className="od-pkg-empty-hint">{t('orders.packages.no_packages_hint')}</div></div>
              ) : packages.map(pkg => {
                const ps = PKG_STATUS[pkg.status] || PKG_STATUS.created;
                const isOpen = expandedPkg === pkg.id;
                const nextSteps = PKG_NEXT[pkg.status] || [];
                return (
                  <div key={pkg.id} className={`od-pkg-card ${isOpen ? 'expanded' : ''}`}>
                    <div className="od-pkg-card-main" onClick={() => { setExpandedPkg(isOpen ? null : pkg.id); if (!isOpen && !pkgScanLogs[pkg.id]) fetchPkgScanLogs(pkg.id); }}>
                      <div className="od-pkg-seq">{pkg.sequence_number || '#'}</div>
                      <div className="od-pkg-card-info">
                        <div className="od-pkg-card-top"><span className="od-pkg-name">{pkg.recipient_name}</span><span className="od-pkg-barcode">{pkg.barcode}</span></div>
                        <div className="od-pkg-card-addr">{pkg.recipient_address?.length > 70 ? pkg.recipient_address.slice(0,70)+'...' : pkg.recipient_address}</div>
                      </div>
                      <div className="od-pkg-card-badges">
                        {parseFloat(pkg.cash_amount) > 0 && <span className="od-pkg-badge cod">COD {fmtAED(pkg.cash_amount)}</span>}
                        {pkg.weight_kg > 0 && <span className="od-pkg-badge weight">{pkg.weight_kg} kg</span>}
                        <span className="od-pkg-badge status" style={{ background:ps.bg, color:ps.color }}>{ps.label}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="od-pkg-card-expanded">
                        <div className="od-pkg-detail-grid">
                          <div className="od-pkg-detail"><span className="od-pkg-detail-label">{t('orders.packages.phone')}</span><div className="mono">{pkg.recipient_phone || '—'}</div></div>
                          <div className="od-pkg-detail"><span className="od-pkg-detail-label">{t('orders.packages.area')}</span><div>{pkg.recipient_area || pkg.recipient_city || '—'}</div></div>
                          <div className="od-pkg-detail"><span className="od-pkg-detail-label">{t('orders.packages.emirate')}</span><div>{pkg.recipient_emirate || '—'}</div></div>
                          <div className="od-pkg-detail"><span className="od-pkg-detail-label">{t('orders.packages.description')}</span><div>{pkg.description || '—'}</div></div>
                          <div className="od-pkg-detail"><span className="od-pkg-detail-label">{t('orders.packages.special_instructions')}</span><div>{pkg.special_instructions || '—'}</div></div>
                          <div className="od-pkg-detail"><span className="od-pkg-detail-label">Tracking #</span><div className="mono">{pkg.work_work_order_number || '—'}</div></div>
                          {(pkg.recipient_lat||pkg.recipient_lng) && <div className="od-pkg-detail"><span className="od-pkg-detail-label">Coordinates</span><div className="mono" style={{fontSize:12}}>{pkg.recipient_lat}, {pkg.recipient_lng}</div></div>}
                          <div className="od-pkg-detail"><span className="od-pkg-detail-label">Created</span><div>{fmtDatetime(pkg.created_at)}</div></div>
                          {pkg.completed_at && <div className="od-pkg-detail"><span className="od-pkg-detail-label">Delivered</span><div style={{color:'#16a34a',fontWeight:600}}>{fmtDatetime(pkg.completed_at)}</div></div>}
                          {pkg.failed_reason && <div className="od-pkg-detail"><span className="od-pkg-detail-label">Failure</span><div style={{color:'#dc2626',fontWeight:600}}>{pkg.failed_reason}</div></div>}
                        </div>
                        <div className="od-pkg-actions">
                          {nextSteps.map(ns => { const nsMeta = PKG_STATUS[ns]||PKG_STATUS.created; return (
                            <button key={ns} className="od-pkg-action-btn" style={{'--pa-bg':nsMeta.bg,'--pa-color':nsMeta.color}} onClick={() => { if(ns==='failed'){setFailModal({open:true,title:'Package Failed',subtitle:`#${pkg.work_work_order_number||pkg.id}`,onConfirm:(reason)=>{if(reason)handlePkgStatus(pkg.id,ns,{failure_reason:reason});}});}else handlePkgStatus(pkg.id,ns); }}><ArrowRight width={11} height={11} /> {nsMeta.label}</button>
                          ); })}
                          <button className="od-pkg-action-btn label" onClick={() => printPkgLabel(pkg.id)}><Printer width={11} height={11} /> Label</button>
                          {['created','warehouse_in'].includes(pkg.status) && <button className="od-pkg-action-btn delete" onClick={() => handleDeletePkg(pkg.id)}><Trash width={11} height={11} /> Delete</button>}
                        </div>
                        {pkgScanLogs[pkg.id]?.length > 0 && (
                          <div className="od-pkg-scan-history"><h5><ScanBarcode width={13} height={13} /> Scan History</h5><div className="od-pkg-scan-list">{pkgScanLogs[pkg.id].map((log,i) => (<div key={i} className="od-pkg-scan-item"><span className="od-pkg-scan-time">{fmtDatetime(log.scanned_at||log.created_at)}</span><span className="od-pkg-scan-type">{(log.scan_type||log.event_type||'').replace(/_/g,' ')}</span>{log.location && <span className="od-pkg-scan-loc">@ {log.location}</span>}</div>))}</div></div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ════════════════ TIMELINE ════════════════ */}
        {activeTab === 'timeline' && (
          <div className="od-timeline-wrap">
            {!order.status_logs?.length ? <p className="od-empty-tab">{t("orderDetail.no_history")}</p> : (
              <div className="od-timeline">
                {order.status_logs.map((log, i) => {
                  const m = STATUS_META[log.status]||STATUS_META.pending; const Icon = m.icon; const isLast = i===order.status_logs.length-1;
                  return (
                    <div key={log.id} className={`od-tl-item ${isLast?'latest':''}`}>
                      <div className="od-tl-dot" style={{background:m.color}}><Icon width={11} height={11} color="#fff" /></div>
                      {!isLast && <div className="od-tl-line" />}
                      <div className="od-tl-content">
                        <div className="od-tl-header"><span className="od-tl-status" style={{color:m.color}}>{t(`orderDetail.status.${log.status}`)}</span><span className="od-tl-time">{fmtDatetime(log.created_at)}</span></div>
                        {log.note && <p className="od-tl-note">{log.note}</p>}
                        {log.changed_by_name && <span className="od-tl-by">{t('orderDetail.by')} {log.changed_by_name}</span>}
                        {(log.lat&&log.lng) && <span className="od-tl-gps"><MapPin width={11} height={11} /> {parseFloat(log.lat).toFixed(5)}, {parseFloat(log.lng).toFixed(5)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════════════════ ITEMS ════════════════ */}
        {activeTab === 'items' && (
          <div className="od-items-wrap">
            {!order.items?.length ? <p className="od-empty-tab">{t('orderDetail.no_items')}</p> : (
              <table className="od-items-table">
                <thead><tr><th>{t('orderDetail.item')}</th><th>{t('orderDetail.qty')}</th><th>{t('orderDetail.weight')}</th><th>{t('orderDetail.unit_price')}</th><th>{t('orderDetail.notes')}</th></tr></thead>
                <tbody>{order.items.map(item => (<tr key={item.id}><td className="od-item-name">{item.name}</td><td>{item.quantity}</td><td>{item.weight_kg?`${item.weight_kg} kg`:'—'}</td><td>{fmtAED(item.unit_price)}</td><td className="od-item-notes">{item.notes||'—'}</td></tr>))}</tbody>
              </table>
            )}
          </div>
        )}

        {/* ════════════════ STOPS ════════════════ */}
        {activeTab === 'stops' && (
          <div className="od-grid" style={{ gridTemplateColumns:'1fr' }}>
            <div className="od-card ms-panel">
              <div className="ms-header">
                <div className="ms-header-left"><h4>{t('orderDetail.multi_stop_deliveries')}</h4>{stops.length > 0 && <span className="ms-stop-count">{stops.length}</span>}</div>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  {stops.length > 0 && <div className="ms-progress-mini"><div className="ms-progress-bar"><div className="ms-progress-fill" style={{ width:`${(stops.filter(s=>s.status==='completed').length/stops.length)*100}%` }} /></div><span>{stops.filter(s=>s.status==='completed').length}/{stops.length} {t('orderDetail.done_count', { done: stops.filter(s=>s.status==='completed').length, total: stops.length }).replace(`${stops.filter(s=>s.status==='completed').length}/${stops.length}`, '').trim()}</span></div>}
                  <button className="ms-add-btn" onClick={() => { setShowAddForm(v=>!v); setEditingStop(null); }}><Plus width={14} height={14} /> {t('orderDetail.add_stop')}</button>
                </div>
              </div>
              {(showAddForm||editingStop) && (
                <div className="ms-add-form">
                  <h5>{editingStop ? t('orderDetail.edit_stop') : t('orderDetail.new_stop')}</h5>
                  <div className="ms-form-grid">
                    <div className="ms-form-group full"><label className="ms-form-label">{t('orderDetail.address_required')} *</label><LocationPicker lat={editingStop?editingStop.lat:newStop.lat} lng={editingStop?editingStop.lng:newStop.lng} address={editingStop?editingStop.address:newStop.address} onChange={({lat,lng,address})=>{if(editingStop)setEditingStop(p=>({...p,lat,lng,address}));else setNewStop(p=>({...p,lat,lng,address}));}} height={220} markerType="delivery" /></div>
                    <div className="ms-form-group"><label className="ms-form-label">{t('orderDetail.contact_name')}</label><input className="ms-form-input" placeholder={t('orderDetail.recipient_name_placeholder')} value={editingStop?editingStop.contact_name||'':newStop.contact_name} onChange={e=>updateStopField('contact_name',e.target.value)} /></div>
                    <div className="ms-form-group"><label className="ms-form-label">{t('orderDetail.phone')}</label><input className="ms-form-input" placeholder={t('orderDetail.phone_placeholder')} value={editingStop?editingStop.contact_phone||'':newStop.contact_phone} onChange={e=>updateStopField('contact_phone',e.target.value)} /></div>
                    <div className="ms-form-group"><label className="ms-form-label">{t('orderDetail.stop_type')}</label><select className="ms-form-select" value={editingStop?editingStop.stop_type:newStop.stop_type} onChange={e=>updateStopField('stop_type',e.target.value)}><option value="delivery">{t('orderDetail.stop_type_delivery')}</option><option value="pickup">{t('orderDetail.stop_type_pickup')}</option><option value="return">{t('orderDetail.stop_type_return')}</option></select></div>
                    <div className="ms-form-group"><label className="ms-form-label">{t('orderDetail.cash_amount_label')}</label><input className="ms-form-input" type="number" step="0.01" placeholder="0.00" value={editingStop?editingStop.cash_amount||'':newStop.cash_amount} onChange={e=>updateStopField('cash_amount',e.target.value)} /></div>
                    <div className="ms-form-group full"><label className="ms-form-label">{t('orderDetail.special_instructions')}</label><input className="ms-form-input" placeholder={t('orderDetail.special_instructions_placeholder')} value={editingStop?editingStop.special_instructions||'':newStop.special_instructions} onChange={e=>updateStopField('special_instructions',e.target.value)} /></div>
                    <div className="ms-form-actions">
                      {editingStop ? (<><button className="module-btn module-btn-primary" onClick={()=>handleEditStop(editingStop.id)} disabled={stopSaving}>{stopSaving ? t('orderDetail.saving_ellipsis') : t('orderDetail.save_changes')}</button><button className="module-btn module-btn-outline" onClick={()=>setEditingStop(null)}>{t('common.cancel', 'Cancel')}</button></>) : (<><button className="module-btn module-btn-primary" onClick={handleAddStop} disabled={stopSaving||!newStop.address}>{stopSaving ? t('orderDetail.adding_ellipsis') : t('orderDetail.add_stop')}</button><button className="module-btn module-btn-outline" onClick={()=>setShowAddForm(false)}>{t('common.cancel', 'Cancel')}</button></>)}
                    </div>
                  </div>
                </div>
              )}
              {stopsLoading ? (<div className="od-loading"><div className="skeleton-pulse" style={{height:80,borderRadius:12}} /><div className="skeleton-pulse" style={{height:80,borderRadius:12,marginTop:8}} /></div>
              ) : stops.length === 0 ? (<div className="od-empty-tab" style={{padding:'40px 0'}}><MapPin width={32} height={32} style={{color:'var(--gray-300)',marginBottom:8}} /><div>{t('orderDetail.no_stops')}</div><div style={{fontSize:12,color:'var(--gray-400)',marginTop:4}}>{t('orderDetail.no_stops_hint')}</div></div>
              ) : (
                <div className="ms-stops-list">
                  {stops.map((stop, i) => {
                    const statusColors={pending:'#d97706',arrived:'#8b5cf6',completed:'#16a34a',failed:'#dc2626',skipped:'#94a3b8'};
                    const statusBg={pending:'#fef3c7',arrived:'#f3e8ff',completed:'#dcfce7',failed:'#fee2e2',skipped:'#f1f5f9'};
                    const typeBg={pickup:'#e0f2fe',delivery:'#ede9fe',return:'#fff7ed'};
                    const typeColor={pickup:'#0369a1',delivery:'#7c3aed',return:'#ea580c'};
                    return (
                      <div key={stop.id} className="ms-stop-item">
                        <div className="ms-stop-timeline"><div className={`ms-stop-dot ${stop.status==='completed'?'completed':stop.status==='failed'?'failed':stop.stop_type}`}>{stop.sequence_number||i+1}</div>{i<stops.length-1&&<div className={`ms-stop-connector ${stop.status==='completed'?'done':''}`} />}</div>
                        <div className={`ms-stop-card ${stop.status}`}>
                          <div className="ms-stop-top"><div style={{display:'flex',gap:6,alignItems:'center'}}><span className={`ms-stop-type ${stop.stop_type}`} style={{background:typeBg[stop.stop_type],color:typeColor[stop.stop_type]}}>{stop.stop_type}</span><span className={`ms-stop-status ${stop.status}`} style={{background:statusBg[stop.status],color:statusColors[stop.status]}}>{stop.status}</span></div><div style={{display:'flex',gap:4}}><button className="ms-action" onClick={()=>handleReorderStop(stop.id,'up')} title="Move up"><NavArrowUp width={13} height={13} /></button><button className="ms-action" onClick={()=>handleReorderStop(stop.id,'down')} title="Move down"><NavArrowDown width={13} height={13} /></button></div></div>
                          {stop.contact_name && <div className="ms-stop-contact">{stop.contact_name}</div>}
                          {stop.contact_phone && <div className="ms-stop-phone">{stop.contact_phone}</div>}
                          <div className="ms-stop-address"><MapPin width={13} height={13} /><span>{stop.address || t('orderDetail.no_address')}</span></div>
                          {stop.lat&&stop.lng&&<div style={{fontSize:11,color:'var(--gray-400)',marginTop:4,display:'flex',alignItems:'center',gap:4}}><MapPin width={11} height={11} /> {parseFloat(stop.lat).toFixed(5)}, {parseFloat(stop.lng).toFixed(5)}</div>}
                          {parseFloat(stop.cash_amount)>0&&<div className={`ms-stop-cod ${stop.cash_collected?'collected':''}`}><DollarCircle width={12} height={12} /> {cur} {parseFloat(stop.cash_amount).toFixed(2)}{stop.cash_collected&&<><Check width={11} height={11} /> {t('orderDetail.collected')}</>}</div>}
                          {stop.failure_reason&&<div className="ms-stop-failure"><WarningTriangle width={12} height={12} /> {stop.failure_reason}</div>}
                          {stop.special_instructions&&<div className="ms-stop-instructions">{stop.special_instructions}</div>}
                          <div className="ms-stop-actions">
                            {stop.status==='pending'&&<button className="ms-action primary" onClick={()=>handleStopStatus(stop.id,'arrived')}><MapPin width={12} height={12} /> {t('orderDetail.arrived')}</button>}
                            {stop.status==='arrived'&&<button className="ms-action success" onClick={()=>handleStopStatus(stop.id,'completed')}><Check width={12} height={12} /> {t('orderDetail.complete')}</button>}
                            {['pending','arrived'].includes(stop.status)&&<button className="ms-action warning" onClick={()=>{setFailModal({open:true,title:t('orderDetail.stop_failed_title'),subtitle:stop.contact_name||`Stop #${stop.sequence}`,onConfirm:(reason)=>{if(reason)handleStopStatus(stop.id,'failed',{failure_reason:reason});}});}}><Xmark width={12} height={12} /> {t('orderDetail.fail')}</button>}
                            <button className="ms-action" onClick={()=>{setEditingStop({...stop});setShowAddForm(false);}}><EditPencil width={12} height={12} /> {t('orderDetail.edit')}</button>
                            <button className="ms-action danger" onClick={()=>handleDeleteStop(stop.id)}><Trash width={12} height={12} /> {t('orderDetail.delete')}</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
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
