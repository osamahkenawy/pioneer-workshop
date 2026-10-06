import { useState, useEffect, useContext, useRef, useMemo } from 'react';
import {
  User, Phone, Mail, MapPin, Star, Package, DeliveryTruck, Check, Xmark,
  Plus, Search, EditPencil, Eye, EyeClosed, Refresh, NavArrowLeft, NavArrowRight,
  StatsReport, Medal, Timer, TruckLength, Clock, Calendar, Bicycle, XmarkCircle,
  MoreHoriz, Prohibition, Gps, DollarCircle, ArrowRight, Copy,
  Motorcycle, Car, Truck, Bus, Key as KeyIcon, InfoCircle,
} from 'iconoir-react';
import { AuthContext } from '../context/AuthContext';
import api from '../lib/api';
import usePlanUsage from '../hooks/usePlanUsage';
import { dispatchPlanUpdate } from '../hooks/usePlanUsage';
import UpgradeModal from '../components/dashboard/UpgradeModal';
import MapView from '../components/MapView';
import './CRMPages.css';
import PhoneInput, { PHONE_CODES } from '../components/PhoneInput';
import { fmtCurrency } from '../utils/currency';

/* Helper to extract country code from a full phone number */
function parsePhoneCode(fullPhone) {
  if (!fullPhone) return { code: '+971', local: '' };
  const p = fullPhone.trim();
  // Try matching longest codes first (e.g. +234 before +2)
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (p.startsWith(c.code)) {
      return { code: c.code, local: p.slice(c.code.length).replace(/^\s+/, '') };
    }
  }
  return { code: '+971', local: p.replace(/^\+?\d{1,4}\s*/, '') };
}
import { useTranslation } from 'react-i18next';

/* ─── Constants ─────────────────────────────────────────────── */
const STATUS_META = {
  available: { label: 'Available', bg: '#dcfce7', color: '#16a34a', pulse: true },
  busy:      { label: 'Busy',      bg: '#fce7f3', color: '#be185d', pulse: false },
  on_break:  { label: 'On Break',  bg: '#fef3c7', color: '#d97706', pulse: false },
  offline:   { label: 'Offline',   bg: '#f1f5f9', color: '#94a3b8', pulse: false },
};

const VEHICLE_META = {
  motorcycle: { label: 'Motorcycle', Icon: Motorcycle, color: '#f97316' },
  car:        { label: 'Car',        Icon: Car,        color: '#3b82f6' },
  van:        { label: 'Van',        Icon: Bus,        color: '#8b5cf6' },
  truck:      { label: 'Truck',      Icon: Truck,      color: '#ef4444' },
  bicycle:    { label: 'Bicycle',    Icon: Bicycle,    color: '#10b981' },
};

const EMPTY_FORM = {
  full_name: '', phone: '', phone_code: '+971', email: '', national_id: '',
  vehicle_type: 'motorcycle', vehicle_plate: '', vehicle_model: '',
  vehicle_color: '', license_number: '', service_bay_id: '', password: '',
  joined_at: '', notes: '', status: 'available',
};

/* ─── Helpers ────────────────────────────────────────────────── */
const fmtDate  = d => d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtPct   = (a, b) => b > 0 ? `${Math.round((a / b) * 100)}%` : '—';
const fmtSpecialty = s => s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
const fmtPing  = d => {
  if (!d) return 'Never';
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return fmtDate(d);
};

/* F10 — grapheme-safe initial extraction (handles emoji + combined CJK chars). */
const initialOf = (name) => {
  if (!name || typeof name !== 'string') return '?';
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const first = seg.segment(name.trim())[Symbol.iterator]().next().value;
      return (first?.segment || name[0] || '?').toUpperCase();
    }
  } catch (_) {}
  // Fallback: take the first code point (avoids splitting surrogate pairs).
  return Array.from(name.trim())[0]?.toUpperCase() || '?';
};

/* ─── Sub-components ─────────────────────────────────────────── */
const StatusBadge = ({ status, size = 'sm' }) => {
  const { t } = useTranslation();
  const m = STATUS_META[status] || STATUS_META.offline;
  return (
    <span className={`drv-status-badge ${size}`} style={{ background: m.bg, color: m.color }}>
      <span className={`drv-status-dot ${m.pulse ? 'pulse' : ''}`} style={{ background: m.color }} />
      {t(`mechanics.status.${status}`, { defaultValue: m.label })}
    </span>
  );
};

const StarRating = ({ value }) => {
  const filled = Math.round(parseFloat(value) || 0);
  return (
    <div className="drv-stars">
      {[1,2,3,4,5].map(i => (
        <Star key={i} width={13} height={13}
          fill={i <= filled ? '#f59e0b' : 'none'}
          style={{ color: i <= filled ? '#f59e0b' : '#d1d5db' }} />
      ))}
      {value ? <span className="drv-stars-val">{parseFloat(value).toFixed(1)}</span> : null}
    </div>
  );
};

const MetricCard = ({ icon: Icon, value, label, accent = '#1e3a6b' }) => (
  <div className="drv-metric">
    <div className="drv-metric-val" style={{ color: accent }}>{value}</div>
    <div className="drv-metric-lbl">{label}</div>
  </div>
);

const SkeletonGrid = () => (
  <div className="drv-grid">
    {[1,2,3,4,5,6].map(i => (
      <div key={i} className="drv-card skeleton-pulse" style={{ height: 260 }} />
    ))}
  </div>
);

/* Parse a notes field that may contain either free text or the JSON payload
   the Oracle migration stamps on every row. Internal-only keys are hidden. */
const NOTES_HIDDEN_KEYS = new Set(['src', 'src_id', 'batch']);
const NOTES_LABEL_OVERRIDES = {
  designation:   'Designation',
  employee_code: 'Employee Code',
  user_code:     'User Code',
  shift:         'Shift',
  loc:           'Location',
  job_type:      'Job Type',
  svc_type:      'Service Type',
  operator:      'Operator',
  salesman:      'Salesman',
  party_code:    'Account Code',
  opening_km:    'Opening KM',
  kind:          'Kind',
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

/* ─── WorkOrder status mini badge ── */
const miniStatus = {
  delivered:  { bg: '#dcfce7', color: '#16a34a' },
  in_transit: { bg: '#e0f2fe', color: '#0369a1' },
  failed:     { bg: '#fee2e2', color: '#dc2626' },
  cancelled:  { bg: '#f1f5f9', color: '#64748b' },
  pending:    { bg: '#fef3c7', color: '#d97706' },
};

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function Mechanics() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { user, workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const fmtAED = v => fmtCurrency(v, cur);
  const { isAtUserLimit, usage, refresh: refreshPlan } = usePlanUsage();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [mechanics,    setMechanics]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [viewMechanic, setViewMechanic] = useState(null);
  const [viewDetail, setViewDetail] = useState(null); /* full detail with recent orders */
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab,  setActiveTab]  = useState('profile');
  const [showForm,   setShowForm]   = useState(false);
  const [selected,   setSelected]   = useState(null);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [credentialsModal, setCredentialsModal] = useState(null);
  const [service_bays,      setServiceBays]      = useState([]);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [filters,    setFilters]    = useState({ search: '', status: '', vehicle_type: '', is_active: '', sort: 'status' });
  const [selectedIds, setSelectedIds] = useState([]); /* F5 — multi-select for bulk actions */
  const [slowNetwork, setSlowNetwork] = useState(false); /* F11 */
  const [confirmStatus, setConfirmStatus] = useState(null); /* F1 — { mechanic, newStatus } */
  const [showPwd,    setShowPwd]    = useState(false);
  const debounceRef = useRef(null);
  const searchInputRef = useRef(null); /* F8 — focus on '/' */

  useEffect(() => { fetchMechanics(); fetchServiceBays(); }, []);

  const fetchMechanics = async () => {
    setLoading(true);
    setSlowNetwork(false);
    // F11 — show "slow network" badge if request takes > 3 s
    const slowTimer = setTimeout(() => setSlowNetwork(true), 3000);
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (filters.status)       params.append('status',       filters.status);
      if (filters.vehicle_type) params.append('vehicle_type', filters.vehicle_type);
      if (filters.search)       params.append('search',       filters.search);
      if (filters.is_active !== '')   params.append('is_active', filters.is_active);
      if (filters.sort)         params.append('sort',         filters.sort);
      const res = await api.get(`/mechanics?${params}`);
      if (res.success) setMechanics(res.data || []);
    } catch (e) { console.error(e); }
    finally { clearTimeout(slowTimer); setSlowNetwork(false); setLoading(false); }
  };

  const fetchServiceBays = async () => {
    const res = await api.get('/service-bays');
    if (res.success) setServiceBays((res.data || []).filter(z => z.is_active));
  };

  const fetchDetail = async (id) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/mechanics/${id}`);
      if (res.success) setViewDetail(res.data);
    } catch (e) { console.error(e); }
    finally { setDetailLoading(false); }
  };

  /* Debounced filter fetch */
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchMechanics, 350);
    return () => clearTimeout(debounceRef.current);
  }, [filters.search]);

  useEffect(() => { fetchMechanics(); }, [filters.status, filters.vehicle_type, filters.is_active, filters.sort]);

  /* F8 — global keyboard shortcuts: '/' focuses search, 'n' opens new mechanic, 'Esc' closes drawer/modal. */
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = ['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'n' && !typing && !showForm) {
        e.preventDefault();
        openNew();
      } else if (e.key === 'Escape') {
        if (confirmStatus) setConfirmStatus(null);
        else if (viewMechanic) setViewMechanic(null);
        else if (showForm) closeForm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, viewMechanic, confirmStatus]);

  /* Filtered list (customer-side vehicle_type since backend may not filter it) */
  const visibleMechanics = useMemo(() => {
    if (!filters.vehicle_type) return mechanics;
    return mechanics.filter(d => d.vehicle_type === filters.vehicle_type);
  }, [mechanics, filters.vehicle_type]);

  /* Stats */
  const stats = useMemo(() => {
    const s = { total: mechanics.length, available: 0, busy: 0, on_break: 0, offline: 0 };
    mechanics.forEach(d => { if (s[d.status] !== undefined) s[d.status]++; });
    return s;
  }, [mechanics]);

  /* Open a mechanic in the view drawer */
  const openView = (mechanic) => {
    setViewMechanic(mechanic);
    setViewDetail(null);
    setActiveTab('profile');
    fetchDetail(mechanic.id);
  };

  const handleStatusChange = async (mechanicId, status) => {
    // F1 — guard rails: confirm before flipping a busy mechanic to offline mid-shift.
    const mechanic = mechanics.find(d => d.id === mechanicId);
    const dangerous = (status === 'offline') && mechanic && (mechanic.active_orders > 0 || mechanic.status === 'busy');
    if (dangerous) {
      setConfirmStatus({ mechanic, newStatus: status });
      return;
    }
    await api.patch(`/mechanics/${mechanicId}/status`, { status });
    fetchMechanics();
    if (viewMechanic?.id === mechanicId) setViewMechanic(v => ({ ...v, status }));
  };

  /* F1 confirmation handler */
  const confirmStatusChange = async (force = false) => {
    if (!confirmStatus) return;
    const { mechanic, newStatus } = confirmStatus;
    await api.patch(`/mechanics/${mechanic.id}/status`, { status: newStatus, force });
    setConfirmStatus(null);
    fetchMechanics();
    if (viewMechanic?.id === mechanic.id) setViewMechanic(v => ({ ...v, status: newStatus }));
  };

  /* F5 — bulk operations on selected mechanics */
  const toggleSelected = (id) => setSelectedIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const clearSelection = () => setSelectedIds([]);
  const selectAllVisible = () => setSelectedIds(visibleMechanics.map(d => d.id));
  const bulkSetStatus = async (status) => {
    if (!selectedIds.length) return;
    const res = await api.patch('/mechanics/bulk-status', { ids: selectedIds, status });
    if (res?.success) {
      clearSelection();
      fetchMechanics();
    } else {
      alert(res?.message || 'Bulk update failed');
    }
  };

  const handleToggleActive = async (mechanic) => {
    const newActive = !mechanic.is_active;
    await api.put(`/mechanics/${mechanic.id}`, { ...mechanic, is_active: newActive ? 1 : 0 });
    fetchMechanics();
    if (viewMechanic?.id === mechanic.id) setViewMechanic(v => ({ ...v, is_active: newActive }));
  };

  const openNew = () => {
    if (isAtUserLimit) {
      setShowUpgradeModal(true);
      return;
    }
    setSelected(null); setForm(EMPTY_FORM); setError(''); setShowForm(true);
  };
  const openEdit = (mechanic) => {
    setSelected(mechanic);
    const parsed = parsePhoneCode(mechanic.phone);
    setForm({
      full_name:      mechanic.full_name      || '',
      phone:          parsed.local,
      phone_code:     parsed.code,
      email:          mechanic.email          || '',
      national_id:    mechanic.national_id    || '',
      vehicle_type:   mechanic.vehicle_type   || 'motorcycle',
      vehicle_plate:  mechanic.vehicle_plate  || '',
      vehicle_model:  mechanic.vehicle_model  || '',
      vehicle_color:  mechanic.vehicle_color  || '',
      license_number: mechanic.license_number || '',
      service_bay_id:        mechanic.service_bay_id        || '',
      password:       '',
      joined_at:      mechanic.joined_at ? mechanic.joined_at.split('T')[0] : '',
      notes:          mechanic.notes          || '',
      status:         mechanic.status         || 'offline',
    });
    setError(''); setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setSelected(null); setForm(EMPTY_FORM); setError(''); setShowPwd(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form };
      // Combine phone_code + phone into full phone number
      payload.phone = `${form.phone_code} ${form.phone}`.trim();
      payload.phone_code = form.phone_code;
      if (!payload.password) delete payload.password;
      const res = selected
        ? await api.put(`/mechanics/${selected.id}`, payload)
        : await api.post('/mechanics', payload);
      if (res.success) {
        // Show mechanic account credentials on new creation
        if (!selected && res.account) {
          setCredentialsModal(res.account);
        }
        closeForm();
        fetchMechanics();
        refreshPlan(); // refresh plan usage counts
        dispatchPlanUpdate(); // notify sidebar plan badge
      } else if (res.upgrade_required) {
        closeForm();
        setShowUpgradeModal(true);
      } else {
        setError(res.message || 'Failed to save mechanic');
      }
    } catch { setError('Network error. Please try again.'); }
    finally { setSaving(false); }
  };

  const clearFilters = () => setFilters({ search: '', status: '', vehicle_type: '', is_active: '', sort: 'status' });
  const hasFilters   = filters.search || filters.status || filters.vehicle_type || filters.is_active;

  /* ══════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════ */
  return (
    <div className="page-container">

      {/* ── Header ── */}
      <div className="module-hero">
        <div className="module-hero-left">
          <h2 className="module-hero-title">{t('mechanics.title')}</h2>
          <p className="module-hero-sub">{t('mechanics.registered_mechanics', { count: stats.total })}</p>
        </div>
        <div className="module-hero-actions">
          <button className="module-btn module-btn-outline" onClick={fetchMechanics}>
            <Refresh width={15} height={15} /> {t('common.refresh')}
          </button>
          <button className="module-btn module-btn-primary" onClick={openNew}
            style={isAtUserLimit ? { background: '#9ca3af', cursor: 'not-allowed' } : undefined}
            title={isAtUserLimit ? `User limit reached (${usage.active_users}/${usage.users_limit}). Upgrade to add more.` : ''}
          >
            <Plus width={16} height={16} /> {t('mechanics.add_mechanic')}
          </button>
        </div>
      </div>

      {/* User limit warning banner */}
      {isAtUserLimit && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
          padding: '12px 20px', marginBottom: 16, gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <XmarkCircle width={20} height={20} style={{ color: '#dc2626', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, color: '#991b1b', fontSize: 14 }}>
                User limit reached ({usage.active_users}/{usage.users_limit})
              </div>
              <div style={{ fontSize: 12, color: '#b91c1c' }}>
                Mechanics count as users. Upgrade your plan to add more mechanics or users.
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowUpgradeModal(true)}
            style={{
              background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            Upgrade Plan
          </button>
        </div>
      )}

      {/* ── Stat Cards ── */}
      <div className="ord-stats-row">
        <div className="ord-stat-card">
          <div className="ord-stat-icon" style={{ background: '#1e3a6b' + '18', color: '#1e3a6b' }}>
            <User width={18} height={18} />
          </div>
          <div className="ord-stat-info">
            <div className="ord-stat-value">{stats.total}</div>
            <div className="ord-stat-label">{t('mechanics.total_mechanics')}</div>
          </div>
        </div>
        {Object.entries(STATUS_META).map(([key, m]) => (
          <div key={key} className="ord-stat-card drv-stat-clickable"
            onClick={() => setFilters(f => ({ ...f, status: f.status === key ? '' : key }))}>
            <div className="ord-stat-icon" style={{ background: m.bg, color: m.color }}>
              {key === 'available' ? <Check width={18} height={18} /> :
               key === 'busy'      ? <DeliveryTruck width={18} height={18} /> :
               key === 'on_break'  ? <Clock width={18} height={18} /> :
               <Prohibition width={18} height={18} />}
            </div>
            <div className="ord-stat-info">
              <div className="ord-stat-value" style={{ color: m.color }}>{stats[key]}</div>
              <div className="ord-stat-label">{t(`mechanics.status.${key}`, { defaultValue: m.label })}</div>
            </div>
            {filters.status === key && <div className="drv-stat-active-pip" style={{ background: m.color }} />}
          </div>
        ))}
      </div>

      {/* ── Filter Bar ── */}
      <div className="filter-bar">
        <div className="search-box">
          <Search width={15} height={15} className="search-icon" />
          <input ref={searchInputRef} type="text" placeholder={t("mechanics.search_placeholder")}
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            className="search-input" />
          {filters.search && (
            <button className="search-clear" onClick={() => setFilters(f => ({ ...f, search: '' }))}>
              <XmarkCircle width={15} height={15} />
            </button>
          )}
        </div>
        <select className="filter-select"
          value={filters.vehicle_type}
          onChange={e => setFilters(f => ({ ...f, vehicle_type: e.target.value }))}>
          <option value="">{t("mechanics.all_vehicles")}</option>
          {Object.entries(VEHICLE_META).map(([k, v]) => (
          <option key={k} value={k}>{t(`mechanics.vehicle.${k}`, { defaultValue: v.label })}</option>
          ))}
        </select>
        {/* F6 — active/inactive filter */}
        <select className="filter-select"
          value={filters.is_active}
          onChange={e => setFilters(f => ({ ...f, is_active: e.target.value }))}
          title={t('mechanics.activity_filter', { defaultValue: 'Activity' })}>
          <option value="">{t('mechanics.all_activity', { defaultValue: 'All mechanics' })}</option>
          <option value="true">{t('mechanics.active_only', { defaultValue: 'Active only' })}</option>
          <option value="false">{t('mechanics.inactive_only', { defaultValue: 'Inactive only' })}</option>
        </select>
        {/* F3 — sort dropdown */}
        <select className="filter-select"
          value={filters.sort}
          onChange={e => setFilters(f => ({ ...f, sort: e.target.value }))}
          title={t('mechanics.sort_by', { defaultValue: 'Sort by' })}>
          <option value="status">{t('mechanics.sort_status', { defaultValue: 'Sort: Status' })}</option>
          <option value="name">{t('mechanics.sort_name', { defaultValue: 'Sort: Name' })}</option>
          <option value="rating">{t('mechanics.sort_rating', { defaultValue: 'Sort: Rating' })}</option>
          <option value="deliveries">{t('mechanics.sort_deliveries', { defaultValue: 'Sort: Deliveries' })}</option>
          <option value="joined">{t('mechanics.sort_joined', { defaultValue: 'Sort: Joined' })}</option>
          <option value="last_ping">{t('mechanics.sort_last_ping', { defaultValue: 'Sort: Last ping' })}</option>
        </select>
        {hasFilters && (
          <button className="module-btn module-btn-outline" onClick={clearFilters}>
            <Xmark width={14} height={14} /> {t('common.clear')}
          </button>
        )}
        <span className="filter-count">{t('mechanics.filter_count', { count: visibleMechanics.length })}</span>
        {slowNetwork && (
          <span className="drv-slow-net-badge" title="Slow network">
            <Clock width={12} height={12} /> {t('common.slow_network', { defaultValue: 'Slow network…' })}
          </span>
        )}
      </div>

      {/* F5 — bulk action bar (visible when something is selected) */}
      {selectedIds.length > 0 && (
        <div className="drv-bulk-bar">
          <span className="drv-bulk-count">
            {t('mechanics.bulk_selected', { count: selectedIds.length, defaultValue: `${selectedIds.length} selected` })}
          </span>
          <button className="module-btn module-btn-outline" onClick={selectAllVisible}>
            {t('mechanics.select_all_visible', { defaultValue: 'Select all visible' })}
          </button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: '#64748b' }}>{t('mechanics.set_status_to', { defaultValue: 'Set status to' })}:</span>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <button key={k} className="module-btn module-btn-outline"
              onClick={() => bulkSetStatus(k)}
              style={{ borderColor: m.color, color: m.color }}>
              {t(`mechanics.status.${k}`, { defaultValue: m.label })}
            </button>
          ))}
          <button className="module-btn module-btn-outline" onClick={clearSelection}>
            <Xmark width={14} height={14} /> {t('common.cancel')}
          </button>
        </div>
      )}

      {/* ── Mechanics Grid ── */}
      {loading ? <SkeletonGrid /> : visibleMechanics.length === 0 ? (
        <div className="ord-empty">
          <div className="ord-empty-icon"><User width={48} height={48} /></div>
          <h3>{t("mechanics.no_mechanics")}</h3>
          <p>{hasFilters ? t('mechanics.adjust_filters') : t('mechanics.no_mechanics_hint')}</p>
          {!hasFilters && (
            <button className="module-btn module-btn-primary" onClick={openNew}>
              <Plus width={16} height={16} /> {t('mechanics.add_mechanic')}
            </button>
          )}
        </div>
      ) : (
        <div className="drv-grid">
          {visibleMechanics.map(mechanic => {
            const sm  = STATUS_META[mechanic.status]  || STATUS_META.offline;
            // No motorcycle fallback — a car-workshop mechanic doesn't have a delivery vehicle.
            const vm  = VEHICLE_META[mechanic.vehicle_type];
            const pct = mechanic.total_orders > 0
              ? Math.round((mechanic.delivered_orders / mechanic.total_orders) * 100)
              : null;
            const isInactive = mechanic.is_active === 0 || mechanic.is_active === false;
            return (
              <div key={mechanic.id} className={`drv-card ${isInactive ? 'inactive' : ''} ${selectedIds.includes(mechanic.id) ? 'selected' : ''}`}
                onClick={() => openView(mechanic)}>

                {/* Status accent strip */}
                <div className="drv-card-strip" style={{ background: sm.color }} />

                {/* F5 — selection checkbox */}
                <label className="drv-card-select" onClick={e => e.stopPropagation()}>
                  <input type="checkbox"
                    checked={selectedIds.includes(mechanic.id)}
                    onChange={() => toggleSelected(mechanic.id)}
                    aria-label={`Select ${mechanic.full_name}`} />
                </label>

                {/* Header: avatar + status */}
                <div className="drv-card-header">
                  <div className="drv-avatar-wrap">
                    <div className="drv-avatar" style={{ background: sm.bg, color: sm.color }}>
                      {initialOf(mechanic.full_name)}
                    </div>
                    <span className={`drv-dot ${sm.pulse ? 'pulse' : ''}`}
                      style={{ background: sm.color }} />
                  </div>
                  <div className="drv-card-title">
                    <div className="drv-card-name">{mechanic.full_name}</div>
                    <div className="drv-card-phone">{mechanic.phone}</div>
                    {mechanic.username && <div className="drv-card-username"><KeyIcon width={11} height={11} /> {mechanic.username}</div>}
                    {mechanic.email && <div className="drv-card-email">{mechanic.email}</div>}
                  </div>
                  <select value={mechanic.status}
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); handleStatusChange(mechanic.id, e.target.value); }}
                    className="drv-status-select"
                    style={{ background: sm.bg, color: sm.color }}>
                    {Object.entries(STATUS_META).map(([k, m]) => (
                      <option key={k} value={k}>{t(`mechanics.status.${k}`, { defaultValue: m.label })}</option>
                    ))}  
                  </select>
                </div>

                {/* Specialty (car workshop) + ServiceBay. Vehicle badge only
                    renders for mechanics that actually have a delivery vehicle
                    recorded — avoids the "Motorcycle" fallback on every card. */}
                <div className="drv-card-tags">
                  {mechanic.specialty ? (
                    <span className="drv-tag vehicle" style={{ background: '#eef2ff', color: '#4338ca' }}>
                      {t(`mechanics.specialty.${mechanic.specialty}`, { defaultValue: fmtSpecialty(mechanic.specialty) })}
                    </span>
                  ) : vm ? (
                    <span className="drv-tag vehicle" style={{ background: vm.color + '15', color: vm.color }}>
                      {vm.Icon && <vm.Icon width={13} height={13} />} {t(`mechanics.vehicle.${mechanic.vehicle_type}`, { defaultValue: vm.label })}
                      {mechanic.vehicle_plate && <> · {mechanic.vehicle_plate}</>}
                    </span>
                  ) : null}
                  {mechanic.zone_name && (
                    <span className="drv-tag bay">
                      <MapPin width={11} height={11} /> {mechanic.zone_name}
                    </span>
                  )}
                  {isInactive && <span className="drv-tag inactive">{t('mechanics.inactive')}</span>}
                </div>

                {/* Rating + Active orders */}
                <div className="drv-card-mid">
                  <StarRating value={mechanic.rating} />
                  {mechanic.active_orders > 0 && (
                    <span className="drv-active-badge">
                      <DeliveryTruck width={12} height={12} />
                      {t('mechanics.active_orders', { count: mechanic.active_orders })}
                    </span>
                  )}
                </div>

                {/* Metrics */}
                <div className="drv-metrics">
                  <div className="drv-metric">
                    <div className="drv-metric-val">{mechanic.total_deliveries || mechanic.total_orders || 0}</div>
                    <div className="drv-metric-lbl">{t('mechanics.metric_total')}</div>
                  </div>
                  <div className="drv-metric">
                    <div className="drv-metric-val" style={{ color: '#0369a1' }}>{mechanic.orders_today || 0}</div>
                    <div className="drv-metric-lbl">{t('mechanics.metric_today')}</div>
                  </div>
                  <div className="drv-metric">
                    <div className="drv-metric-val" style={{ color: '#16a34a' }}>
                      {pct !== null ? `${pct}%` : '—'}
                    </div>
                    <div className="drv-metric-lbl">{t('mechanics.metric_success')}</div>
                  </div>
                </div>

                {/* Footer */}
                <div className="drv-card-footer" onClick={e => e.stopPropagation()}>
                  <div className="drv-card-date">
                    {mechanic.joined_at ? (
                      <><Calendar width={11} height={11} /> {t('mechanics.joined', { date: fmtDate(mechanic.joined_at) })}</>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>{t("mechanics.no_join_date")}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="action-btn view" title={t('mechanics.view_details')}
                      onClick={e => { e.stopPropagation(); openView(mechanic); }}>
                      <Eye width={13} height={13} />
                    </button>
                    <button className="action-btn edit" title={t('common.edit')}
                      onClick={e => { e.stopPropagation(); openEdit(mechanic); }}>
                      <EditPencil width={13} height={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
         MECHANIC DETAIL DRAWER
         ══════════════════════════════════════════════════════════ */}
      {viewMechanic && (
        <div className="modal-overlay" onClick={() => setViewMechanic(null)}>
          <div className="ord-drawer drv-drawer" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="ord-drawer-header drv-drawer-hero">
              <div className="drv-drawer-avatar"
                style={{ background: STATUS_META[viewMechanic.status]?.bg, color: STATUS_META[viewMechanic.status]?.color }}>
                {initialOf(viewMechanic.full_name)}
              </div>
              <div className="drv-drawer-hero-text">
                <h3>{viewMechanic.full_name}</h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <StatusBadge status={viewMechanic.status} size="sm" />
                  {viewMechanic.vehicle_type && (
                    <span className="drv-tag vehicle" style={{
                      background: (VEHICLE_META[viewMechanic.vehicle_type]?.color || '#666') + '18',
                      color: VEHICLE_META[viewMechanic.vehicle_type]?.color || '#666', fontSize: 12
                    }}>
                      {(() => { const VIcon = VEHICLE_META[viewMechanic.vehicle_type]?.Icon; return VIcon ? <VIcon width={13} height={13} /> : null; })()} {t(`mechanics.vehicle.${viewMechanic.vehicle_type}`, { defaultValue: VEHICLE_META[viewMechanic.vehicle_type]?.label })}
                    </span>
                  )}
                </div>
              </div>
              <button className="modal-close" onClick={() => setViewMechanic(null)}>
                <Xmark width={18} height={18} />
              </button>
            </div>

            {/* Tabs */}
            <div className="drv-tabs">
              <button className={`drv-tab ${activeTab === 'profile' ? 'active' : ''}`}
                onClick={() => setActiveTab('profile')}>
                <User width={14} height={14} /> {t('mechanics.tab_profile')}
              </button>
              <button className={`drv-tab ${activeTab === 'orders' ? 'active' : ''}`}
                onClick={() => setActiveTab('orders')}>
                <Package width={14} height={14} />
                {t('mechanics.tab_orders')}
                {viewDetail?.recent_orders?.length > 0 && (
                  <span className="drv-tab-badge">{viewDetail.recent_orders.length}</span>
                )}
              </button>
            </div>

            {/* Body */}
            <div className="ord-drawer-body">
              {detailLoading ? (
                <div className="drv-detail-loading">
                  <div className="skeleton-pulse" style={{ height: 80, borderRadius: 12, marginBottom: 12 }} />
                  <div className="skeleton-pulse" style={{ height: 120, borderRadius: 12, marginBottom: 12 }} />
                  <div className="skeleton-pulse" style={{ height: 60, borderRadius: 12 }} />
                </div>
              ) : activeTab === 'profile' ? (
                <>
                  {/* Performance metrics */}
                  <div className="ord-view-section">
                    <div className="drv-perf-row">
                      <div className="drv-perf-card" style={{ '--accent': '#1e3a6b' }}>
                        <div className="drv-perf-val">{viewDetail?.total_deliveries || viewDetail?.total_orders || 0}</div>
                        <div className="drv-perf-lbl">{t('mechanics.total_deliveries')}</div>
                      </div>
                      <div className="drv-perf-card" style={{ '--accent': '#0369a1' }}>
                        <div className="drv-perf-val">{viewDetail?.orders_today || 0}</div>
                        <div className="drv-perf-lbl">{t('mechanics.metric_today')}</div>
                      </div>
                      <div className="drv-perf-card" style={{ '--accent': '#16a34a' }}>
                        <div className="drv-perf-val">
                          {fmtPct(viewDetail?.delivered_orders, viewDetail?.total_orders)}
                        </div>
                        <div className="drv-perf-lbl">{t('mechanics.metric_success_rate')}</div>
                      </div>
                      <div className="drv-perf-card" style={{ '--accent': '#d97706' }}>
                        <div className="drv-perf-val">{fmtAED(viewDetail?.total_earned)}</div>
                        <div className="drv-perf-lbl">{t('mechanics.earned')}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                      <StarRating value={viewDetail?.rating} />
                      {viewDetail?.last_ping && (
                        <span className="drv-ping-chip">
                          <Gps width={12} height={12} /> {fmtPing(viewDetail.last_ping)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Contact */}
                  <div className="ord-view-section">
                    <div className="ord-view-section-title"><User width={14} height={14} /> {t('mechanics.contact')}</div>
                    <div className="ord-view-card">
                      {(viewMechanic.username || viewDetail?.username) && (
                        <div className="ord-view-row">
                          <span className="ord-view-label">{t('mechanics.credentials.username')}</span>
                          <span className="ord-view-value" style={{ fontFamily: 'monospace', fontWeight: 600 }}>{viewMechanic.username || viewDetail?.username}</span>
                        </div>
                      )}
                      <div className="ord-view-row">
                        <span className="ord-view-label">{t('common.phone')}</span>
                        <a href={`tel:${viewMechanic.phone}`} className="ord-view-value link">{viewMechanic.phone}</a>
                      </div>
                      {viewMechanic.email && (
                        <div className="ord-view-row">
                          <span className="ord-view-label">{t('common.email')}</span>
                          <span className="ord-view-value">{viewMechanic.email}</span>
                        </div>
                      )}
                      {viewMechanic.national_id && (
                        <div className="ord-view-row">
                          <span className="ord-view-label">{t("mechanics.national_id")}</span>
                          <span className="ord-view-value">{viewMechanic.national_id}</span>
                        </div>
                      )}
                      {viewMechanic.joined_at && (
                        <div className="ord-view-row">
                          <span className="ord-view-label">{t('mechanics.joined_label')}</span>
                          <span className="ord-view-value">{fmtDate(viewMechanic.joined_at)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Vehicle — only render if the mechanic actually has vehicle data
                      (imported/legacy records don't and would otherwise render as
                      "License #: <employee code>" / "Type: mechanics.vehicle.undefined"). */}
                  {(viewMechanic.vehicle_type || viewMechanic.vehicle_plate || viewMechanic.vehicle_model || viewMechanic.license_number) && (
                    <div className="ord-view-section">
                    <div className="ord-view-section-title">
                      {(() => { const VIcon = VEHICLE_META[viewMechanic.vehicle_type]?.Icon || Car; return <VIcon width={14} height={14} />; })()} {t('mechanics.vehicle_section')}
                    </div>
                    <div className="ord-view-card">
                      {viewMechanic.vehicle_type && (
                        <div className="ord-view-row">
                          <span className="ord-view-label">{t('mechanics.type')}</span>
                          <span className="ord-view-value bold">{t(`mechanics.vehicle.${viewMechanic.vehicle_type}`, { defaultValue: VEHICLE_META[viewMechanic.vehicle_type]?.label || viewMechanic.vehicle_type })}</span>
                        </div>
                      )}
                      {viewMechanic.vehicle_plate && (
                        <div className="ord-view-row">
                          <span className="ord-view-label">{t('mechanics.plate')}</span>
                          <span className="ord-view-value drv-plate">{viewMechanic.vehicle_plate}</span>
                        </div>
                      )}
                      {viewMechanic.vehicle_model && (
                        <div className="ord-view-row">
                          <span className="ord-view-label">{t('mechanics.vehicle_model')}</span>
                          <span className="ord-view-value">{viewMechanic.vehicle_model}</span>
                        </div>
                      )}
                      {viewMechanic.vehicle_color && (
                        <div className="ord-view-row">
                          <span className="ord-view-label">{t('mechanics.vehicle_color')}</span>
                          <span className="ord-view-value">{viewMechanic.vehicle_color}</span>
                        </div>
                      )}
                      {viewMechanic.license_number && (
                        <div className="ord-view-row">
                          <span className="ord-view-label">{t('mechanics.license_hash')}</span>
                          <span className="ord-view-value">{viewMechanic.license_number}</span>
                        </div>
                      )}
                    </div>
                    </div>
                  )}

                  {/* ServiceBay + Last Location */}
                  {(viewMechanic.zone_name || viewDetail?.last_lat) && (
                    <div className="ord-view-section">
                      <div className="ord-view-section-title"><MapPin width={14} height={14} /> Location</div>
                      {viewMechanic.zone_name && (
                        <div className="ord-view-card" style={{ marginBottom: 8 }}>
                          <div className="ord-view-row">
                            <span className="ord-view-label">{t("mechanics.assigned_zone")}</span>
                            <span className="ord-view-value bold">{viewMechanic.zone_name}</span>
                          </div>
                        </div>
                      )}
                      {viewDetail?.last_lat && viewDetail?.last_lng && (
                        <div className="ord-view-map">
                          <MapView
                            markers={[{
                              lat: parseFloat(viewDetail.last_lat),
                              lng: parseFloat(viewDetail.last_lng),
                              type: 'mechanic',
                              label: viewMechanic.full_name,
                              popup: (
                                <div style={{ minWidth: 180, fontFamily: 'Inter, system-ui, sans-serif', fontSize: '0.82rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontWeight: 700, fontSize: '0.9rem' }}>
                                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem' }}>
                                      {viewMechanic.full_name?.charAt(0)}
                                    </span>
                                    {viewMechanic.full_name}
                                  </div>
                                  {viewMechanic.vehicle_type && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#374151', marginTop: 4 }}>
                                      <DeliveryTruck width={14} height={14} style={{ flexShrink: 0 }} />
                                      <span style={{ textTransform: 'capitalize' }}>{viewMechanic.vehicle_type}</span>
                                      <span style={{ color: '#9ca3af' }}>•</span>
                                      <span style={{ fontFamily: 'monospace', fontWeight: 600, background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{viewMechanic.vehicle_plate || '—'}</span>
                                    </div>
                                  )}
                                  {viewDetail.last_ping && (
                                    <div style={{ marginTop: 6, color: '#6b7280', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <MapPin width={11} height={11} /> Last ping: {fmtPing(viewDetail.last_ping)}
                                    </div>
                                  )}
                                </div>
                              )
                            }]}
                            height={160} zoom={14} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Notes — plain text for freeform notes, key/value grid when
                      the notes column holds the JSON payload the migration stamps. */}
                  {viewMechanic.notes && (() => {
                    const parsed = parseSrcNotes(viewMechanic.notes);
                    if (parsed.kind === 'empty') return null;
                    if (parsed.kind === 'json' && parsed.entries.length > 0) {
                      return (
                        <div className="ord-view-section">
                          <div className="ord-view-section-title">
                            <InfoCircle width={14} height={14} /> {t('mechanics.employment', { defaultValue: 'Employment' })}
                            {parsed.source && (
                              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {parsed.source}
                              </span>
                            )}
                          </div>
                          <div className="ord-view-card">
                            {parsed.entries.map(([label, value]) => (
                              <div key={label} className="ord-view-row">
                                <span className="ord-view-label">{label}</span>
                                <span className="ord-view-value">{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="ord-view-section">
                        <div className="ord-view-card subtle">
                          <div className="ord-view-row" style={{ alignItems: 'flex-start' }}>
                            <span className="ord-view-label">{t('common.notes')}</span>
                            <span className="ord-view-value" style={{ whiteSpace: 'pre-wrap' }}>{parsed.text}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : (
                /* ── WorkOrders Tab ── */
                <div className="ord-view-section">
                  {!viewDetail?.recent_orders?.length ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                      <Package width={36} height={36} style={{ marginBottom: 8 }} />
                      <p>{t("mechanics.no_orders_yet")}</p>
                    </div>
                  ) : (
                    <div className="drv-orders-list">
                      {viewDetail.recent_orders.map(o => {
                        const ms = miniStatus[o.status] || miniStatus.pending;
                        return (
                          <div key={o.id} className="drv-order-row">
                            <div className="drv-order-num">{o.work_order_number}</div>
                            <div className="drv-order-recipient">{o.recipient_name}</div>
                            <div className="drv-order-emirate">{o.recipient_emirate}</div>
                            <span className="drv-mini-badge"
                              style={{ background: ms.bg, color: ms.color }}>
                              {o.status.replace(/_/g, ' ')}
                            </span>
                            <div className="drv-order-fee">{fmtAED(o.service_fee)}</div>
                            <div className="drv-order-date">
                              <div>{fmtDate(o.created_at)}</div>
                              {o.completed_at && (
                                <div style={{ fontSize:10, color:'#10b981', fontWeight:600, marginTop:1 }}>
                                  ✓ {fmtDate(o.completed_at)}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="ord-drawer-footer">
              <button className="module-btn module-btn-outline drv-deactivate"
                onClick={() => handleToggleActive(viewMechanic)}
                style={{ color: viewMechanic.is_active === 0 ? '#16a34a' : '#dc2626',
                         borderColor: viewMechanic.is_active === 0 ? '#bbf7d0' : '#fecaca' }}>
                {viewMechanic.is_active === 0 ? <><Check width={14} height={14} /> {t('mechanics.activate')}</> : <><Prohibition width={14} height={14} /> {t('mechanics.deactivate')}</>}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="module-btn module-btn-outline" onClick={() => setViewMechanic(null)}>{t('common.close')}</button>
                <button className="module-btn module-btn-primary"
                  onClick={() => { setViewMechanic(null); openEdit(viewMechanic); }}>
                  <EditPencil width={14} height={14} /> {t('mechanics.edit_mechanic')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
         CREATE / EDIT MODAL
         ══════════════════════════════════════════════════════════ */}
      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal-container large drv-form-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header drv-form-header">
              <div className="drv-form-header-icon">
                {selected
                  ? <EditPencil width={20} height={20} />
                  : <User width={20} height={20} />}
              </div>
              <div className="drv-form-header-text">
                <h3>{selected ? t('mechanics.edit_title', { name: selected.full_name }) : t('mechanics.add_mechanic_title')}</h3>
                <p>{selected
                  ? t('mechanics.edit_subtitle', { defaultValue: 'Update profile, vehicle and assignment details.' })
                  : t('mechanics.add_subtitle', { defaultValue: 'Create a mechanic profile, login and vehicle in one step.' })}
                </p>
              </div>
              <button className="modal-close" onClick={closeForm}><Xmark width={18} height={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {error && (
                  <div className="alert-error" style={{ marginBottom: '1rem' }}>
                    <Prohibition width={16} height={16} /> {error}
                  </div>
                )}

                {/* Personal */}
                <div className="drv-form-section">
                <div className="form-section-title">
                  <User width={15} height={15} style={{ verticalAlign: 'middle', [isRTL?'marginLeft':'marginRight']: 6 }} />
                  {t('mechanics.personal_info')}
                </div>
                <div className="form-grid-2">
                  <div className="form-field">
                    <label>{t('mechanics.full_name_required')}</label>
                    <input required type="text" value={form.full_name}
                      onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                      placeholder={t("mechanics.name_placeholder")} />
                  </div>
                  <div className="form-field">
                    <label>{t('mechanics.phone_required')}</label>
                    <PhoneInput
                      required
                      value={form.phone}
                      onChange={v => setForm(f => ({ ...f, phone: v }))}
                      phoneCode={form.phone_code}
                      onPhoneCodeChange={c => setForm(f => ({ ...f, phone_code: c }))}
                      placeholder="50 000 0000"
                    />
                  </div>
                  <div className="form-field">
                    <label>{t('common.email')}</label>
                    <input type="email" value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="mechanic@example.com" />
                  </div>
                  <div className="form-field">
                    <label>{t("mechanics.national_id")}</label>
                    <input type="text" value={form.national_id}
                      onChange={e => setForm(f => ({ ...f, national_id: e.target.value }))}
                      placeholder={t("mechanics.national_id_placeholder")} />
                  </div>
                  <div className="form-field">
                    <label>{t("mechanics.joined_date")}</label>
                    <input type="date" value={form.joined_at}
                      max={new Date().toISOString().split('T')[0]}
                      onChange={e => setForm(f => ({ ...f, joined_at: e.target.value }))} />
                  </div>
                  <div className="form-field">
                    <label>{t('mechanics.status_label')}</label>
                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      {Object.entries(STATUS_META).map(([k, m]) => (
                        <option key={k} value={k}>{t(`mechanics.status.${k}`, { defaultValue: m.label })}</option>
                      ))}
                    </select>
                  </div>
                  {!selected && (
                    <div className="form-field">
                      <label>{t('common.password') || 'Password'}</label>
                      <div className="drv-pwd-wrap">
                        <input type={showPwd ? 'text' : 'password'} value={form.password}
                          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                          placeholder={t("mechanics.password_placeholder")} autoComplete="new-password" />
                        <button type="button" className="drv-pwd-toggle"
                          onClick={() => setShowPwd(s => !s)}
                          aria-label={showPwd ? 'Hide password' : 'Show password'}
                          tabIndex={-1}>
                          {showPwd ? <EyeClosed width={16} height={16} /> : <Eye width={16} height={16} />}
                        </button>
                      </div>
                      <span className="drv-field-hint">
                        <InfoCircle width={11} height={11} /> {t('mechanics.password_hint', { defaultValue: 'Min 6 characters — mechanic will use this to log in.' })}
                      </span>
                    </div>
                  )}
                </div>
                </div>

                {/* Vehicle */}
                <div className="drv-form-section">
                <div className="form-section-title">
                  <Car width={15} height={15} style={{ verticalAlign: 'middle', [isRTL?'marginLeft':'marginRight']: 6 }} />
                  {t('mechanics.vehicle_info')}
                </div>
                <div className="form-grid-2">
                  <div className="form-field">
                    <label>{t('mechanics.vehicle_type')}</label>
                    <select value={form.vehicle_type} onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}>
                      {Object.entries(VEHICLE_META).map(([k, v]) => (
                        <option key={k} value={k}>{t(`mechanics.vehicle.${k}`, { defaultValue: v.label })}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>{t('mechanics.plate_number')}</label>
                    <input type="text" value={form.vehicle_plate}
                      onChange={e => setForm(f => ({ ...f, vehicle_plate: e.target.value }))}
                      placeholder="e.g. A 12345 Dubai" />
                  </div>
                  <div className="form-field">
                    <label>{t('mechanics.vehicle_model_label')}</label>
                    <input type="text" value={form.vehicle_model}
                      onChange={e => setForm(f => ({ ...f, vehicle_model: e.target.value }))}
                      placeholder="e.g. Honda CB150" />
                  </div>
                  <div className="form-field">
                    <label>{t('mechanics.vehicle_color_label')}</label>
                    <input type="text" value={form.vehicle_color}
                      onChange={e => setForm(f => ({ ...f, vehicle_color: e.target.value }))}
                      placeholder="e.g. Red" />
                  </div>
                  <div className="form-field">
                    <label>{t("mechanics.license_number")}</label>
                    <input type="text" value={form.license_number}
                      onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))}
                      placeholder={t("mechanics.license_placeholder")} />
                  </div>
                  <div className="form-field">
                    <label>{t("mechanics.assigned_zone")}</label>
                    <select value={form.service_bay_id} onChange={e => setForm(f => ({ ...f, service_bay_id: e.target.value }))}>
                      <option value="">{t("mechanics.no_zone_assigned")}</option>
                      {service_bays.map(z => (
                        <option key={z.id} value={z.id}>{z.name} — {z.emirate}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field span-2">
                    <label>{t('common.notes')}</label>
                    <textarea rows={3} value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder={t("mechanics.notes_placeholder")} />
                  </div>
                </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="module-btn module-btn-outline" onClick={closeForm}>{t('common.cancel')}</button>
                <button type="submit" className="module-btn module-btn-primary" disabled={saving}>
                  {saving ? t('common.loading') : selected ? t('mechanics.update_mechanic') : t('mechanics.add_mechanic')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Mechanic Credentials Modal ── */}
      {credentialsModal && (
        <div
          onClick={() => setCredentialsModal(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(10,18,35,0.72)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
            animation: 'cred-fade-in 0.22s ease',
          }}
        >
          <style>{`
            @keyframes cred-fade-in { from { opacity:0 } to { opacity:1 } }
            @keyframes cred-slide-up { from { opacity:0; transform:translateY(28px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
            @keyframes cred-ring-pulse { 0%,100% { transform:scale(1); opacity:0.35 } 50% { transform:scale(1.18); opacity:0.12 } }
            @keyframes cred-check-pop { 0% { transform:scale(0) } 60% { transform:scale(1.15) } 100% { transform:scale(1) } }
            @keyframes cred-shimmer { 0% { background-position:-200% 0 } 100% { background-position:200% 0 } }
            .cred-row-copy:hover { background: rgba(36,64,102,0.08) !important; }
            .cred-btn-copy:hover { background: #14284d !important; }
            .cred-btn-close:hover { background: #f1f5f9 !important; border-color: #cbd5e1 !important; }
          `}</style>

          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 420,
              background: '#fff',
              borderRadius: 24,
              overflow: 'hidden',
              boxShadow: '0 32px 80px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.12)',
              animation: 'cred-slide-up 0.3s cubic-bezier(0.34,1.36,0.64,1)',
            }}
          >
            {/* ── Gradient header ── */}
            <div style={{
              background: 'linear-gradient(135deg, #0d2137 0%, #1a3d5c 50%, #0f4c2a 100%)',
              padding: '36px 28px 28px',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Decorative orbs */}
              <div style={{ position:'absolute', top:-40, right:-40, width:160, height:160, borderRadius:'50%', background:'rgba(34,197,94,0.12)', pointerEvents:'none' }} />
              <div style={{ position:'absolute', bottom:-30, left:-30, width:120, height:120, borderRadius:'50%', background:'rgba(36,64,102,0.25)', pointerEvents:'none' }} />

              {/* Truck + check icon combo */}
              <div style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom:16 }}>
                {/* Pulsing ring */}
                <div style={{
                  position:'absolute', width:84, height:84, borderRadius:'50%',
                  border:'2px solid rgba(34,197,94,0.4)',
                  animation:'cred-ring-pulse 2s ease-in-out infinite',
                }} />
                <div style={{
                  position:'absolute', width:68, height:68, borderRadius:'50%',
                  border:'2px solid rgba(34,197,94,0.25)',
                  animation:'cred-ring-pulse 2s ease-in-out infinite 0.4s',
                }} />
                {/* Main icon circle */}
                <div style={{
                  width:58, height:58, borderRadius:'50%',
                  background:'linear-gradient(135deg, #16a34a, #22c55e)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  boxShadow:'0 8px 24px rgba(34,197,94,0.45)',
                  animation:'cred-check-pop 0.5s cubic-bezier(0.34,1.36,0.64,1) 0.1s both',
                  position:'relative', zIndex:1,
                }}>
                  <Check width={28} height={28} color="#fff" strokeWidth={2.5} />
                </div>
                {/* Mini truck badge */}
                <div style={{
                  position:'absolute', bottom:-2, right:-4,
                  width:24, height:24, borderRadius:'50%',
                  background:'#f97316',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  border:'2px solid #fff',
                  boxShadow:'0 2px 8px rgba(249,115,22,0.5)',
                  zIndex:2,
                }}>
                  <DeliveryTruck width={12} height={12} color="#fff" />
                </div>
              </div>

              <h3 style={{ margin:0, fontSize:'1.3rem', fontWeight:800, color:'#fff', letterSpacing:'-0.02em' }}>
                {t('mechanics.credentials.title')}
              </h3>
              <p style={{ margin:'6px 0 0', color:'rgba(255,255,255,0.62)', fontSize:'0.83rem', fontWeight:500 }}>
                {credentialsModal.isDefault
                  ? t('mechanics.credentials.default_password')
                  : t('mechanics.credentials.custom_password')}
              </p>
            </div>

            {/* ── Credential rows ── */}
            <div style={{ padding:'24px 24px 20px' }}>

              {/* Username row */}
              <div
                className="cred-row-copy"
                onClick={() => navigator.clipboard?.writeText(credentialsModal.username)}
                title="Click to copy"
                style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'13px 14px', borderRadius:14, marginBottom:10,
                  background:'#f8fafc', border:'1.5px solid #e2e8f0',
                  cursor:'pointer', transition:'background 0.15s',
                }}
              >
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>
                    {t('mechanics.credentials.username')}
                  </div>
                  <div style={{ fontSize:'1rem', fontWeight:700, fontFamily:'monospace', color:'#0f172a', letterSpacing:'0.03em' }}>
                    {credentialsModal.username}
                  </div>
                </div>
                <div style={{
                  width:30, height:30, borderRadius:8,
                  background:'#e2e8f0', display:'flex', alignItems:'center', justifyContent:'center',
                  flexShrink:0,
                }}>
                  <Copy width={14} height={14} color="#64748b" />
                </div>
              </div>

              {/* Password row */}
              <div
                className="cred-row-copy"
                onClick={() => navigator.clipboard?.writeText(credentialsModal.password)}
                title="Click to copy"
                style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'13px 14px', borderRadius:14, marginBottom:16,
                  background: 'linear-gradient(135deg, #fff7ed, #fff)',
                  border:'1.5px solid #fed7aa',
                  cursor:'pointer', transition:'background 0.15s',
                }}
              >
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:'#f97316', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>
                    {t('mechanics.credentials.password')}
                  </div>
                  <div style={{ fontSize:'1rem', fontWeight:700, fontFamily:'monospace', color:'#0f172a', letterSpacing:'0.05em' }}>
                    {credentialsModal.password}
                  </div>
                </div>
                <div style={{
                  width:30, height:30, borderRadius:8,
                  background:'#fed7aa', display:'flex', alignItems:'center', justifyContent:'center',
                  flexShrink:0,
                }}>
                  <Copy width={14} height={14} color="#f97316" />
                </div>
              </div>

              {/* Warning strip */}
              {credentialsModal.isDefault && (
                <div style={{
                  background:'linear-gradient(135deg, #fff7ed, #fef3c7)',
                  border:'1px solid #fde68a', borderRadius:12,
                  padding:'10px 14px', display:'flex', gap:10, alignItems:'flex-start',
                  marginBottom:18,
                }}>
                  <span style={{ fontSize:16, flexShrink:0, marginTop:1 }}><KeyIcon width={16} height={16} /></span>
                  <p style={{ margin:0, fontSize:'0.78rem', color:'#92400e', lineHeight:1.55, fontWeight:500 }}>
                    {t('mechanics.credentials.warning')}
                  </p>
                </div>
              )}

              {/* Copy & Close button */}
              <button
                className="cred-btn-copy"
                onClick={() => {
                  const text = `Username: ${credentialsModal.username}\nPassword: ${credentialsModal.password}`;
                  navigator.clipboard?.writeText(text);
                  setCredentialsModal(null);
                }}
                style={{
                  width:'100%', padding:'13px',
                  background:'linear-gradient(135deg, #1e3a6b, #1a3d5c)',
                  color:'#fff', border:'none', borderRadius:14,
                  fontSize:'0.9rem', fontWeight:700, cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                  boxShadow:'0 4px 16px rgba(36,64,102,0.35)',
                  transition:'background 0.15s',
                }}
              >
                <Copy width={15} height={15} /> {t('mechanics.credentials.copy_close')}
              </button>

              {/* Close only */}
              <button
                className="cred-btn-close"
                onClick={() => setCredentialsModal(null)}
                style={{
                  width:'100%', padding:'11px',
                  background:'transparent', color:'#64748b',
                  border:'1.5px solid #e2e8f0', borderRadius:14,
                  fontSize:'0.85rem', fontWeight:600, cursor:'pointer',
                  marginTop:8, transition:'background 0.15s, border-color 0.15s',
                }}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Upgrade Modal ── */}
      {showUpgradeModal && (
        <UpgradeModal
          onClose={() => setShowUpgradeModal(false)}
          triggerReason="User limit reached. Mechanics count as users. Please upgrade your plan to add more."
        />
      )}

      {/* F1 — confirm dangerous status flips (e.g. busy mechanic → offline mid-shift) */}
      {confirmStatus && (
        <div className="modal-overlay" onClick={() => setConfirmStatus(null)}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background: '#fef3c7', borderBottom: '1px solid #fde68a' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#92400e' }}>
                <Prohibition width={18} height={18} />
                {t('mechanics.confirm_status_title', { defaultValue: 'Confirm status change' })}
              </h3>
              <button className="modal-close" onClick={() => setConfirmStatus(null)}><Xmark width={16} height={16} /></button>
            </div>
            <div className="modal-body" style={{ padding: 20, lineHeight: 1.55 }}>
              <p style={{ margin: 0, color: '#1f2937' }}>
                <strong>{confirmStatus.mechanic.full_name}</strong>
                {' '}{t('mechanics.confirm_status_currently', { defaultValue: 'is currently' })}{' '}
                <strong>{t(`mechanics.status.${confirmStatus.mechanic.status}`, { defaultValue: confirmStatus.mechanic.status })}</strong>
                {confirmStatus.mechanic.active_orders > 0 && (
                  <> {t('mechanics.confirm_status_with_orders', {
                    count: confirmStatus.mechanic.active_orders,
                    defaultValue: `with ${confirmStatus.mechanic.active_orders} active order(s)`,
                  })}</>
                )}.
              </p>
              <p style={{ marginTop: 12, color: '#b45309' }}>
                {t('mechanics.confirm_status_warning', {
                  defaultValue: 'Setting status to offline will block new assignments. Active orders will not be reassigned automatically.',
                })}
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 16 }}>
              <button className="module-btn module-btn-outline" onClick={() => setConfirmStatus(null)}>
                {t('common.cancel')}
              </button>
              <button className="module-btn module-btn-primary"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => confirmStatusChange(true)}>
                {t('mechanics.confirm_status_proceed', { defaultValue: 'Proceed anyway' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
