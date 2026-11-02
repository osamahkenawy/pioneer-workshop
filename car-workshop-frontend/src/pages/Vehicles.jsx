/**
 * Vehicles.jsx — NEW page (no delivery-service equivalent).
 * Customer vehicles list + detail drawer with CRUD against /api/vehicles.
 * Linked from Customers (per-customer vehicles) and WorkOrders pages.
 */
import { useState, useEffect, useCallback, useContext } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus, Search, Xmark, EditPencil, Trash, Car, User, Page,
  NavArrowLeft, NavArrowRight, WarningTriangle, Wrench, GasTank,
  Group, Wallet, Calendar, ViewGrid, List, Settings as SettingsIcon,
} from 'iconoir-react';
import api from '../lib/api';
import { CAR_CATALOG, CAR_MAKES } from '../lib/carCatalog';
import { AuthContext } from '../context/AuthContext';
import { canDo } from '../lib/permissions';
import Toast, { useToast } from '../components/Toast';
import Loader from '../components/Loader';
import PlateNumber from '../components/PlateNumber';
import { fmtCurrency } from '../utils/currency';
import { woLabel, woTone } from '../lib/statusLabels';
import { VEHICLE_TYPES, vehicleTypeLabel } from '../lib/intakeOptions';
import './CRMPages.css';

const EMPTY_FORM = {
  customer_id: '', make: '', model: '', vehicle_type: '', year: '', plate_number: '', plate_code: '', plate_emirate: '',
  vin: '', color: '', mileage: '', fuel_type: 'petrol', transmission: 'automatic', notes: '',
};

const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'other'];

/* The seven emirates, as the job card wizard offers them (the server refuses others). */
const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];

/* VIN, plate number, emirate and model year are mandatory (client review,
   2 Nov 2026): on a new vehicle always; an older record may still lack them,
   but cannot lose what it has — the server's rule too. */
const REQUIRED_DETAILS = ['vin', 'plate_number', 'plate_emirate', 'year'];

/* A server error code → the form field it is about. */
const ERROR_FIELD = {
  VIN_REQUIRED: 'vin', VIN_INVALID: 'vin', VIN_DUPLICATE: 'vin', YEAR_INVALID: 'year', EMIRATE_INVALID: 'plate_emirate',
  VEHICLE_TYPE_INVALID: 'vehicle_type', MILEAGE_INVALID: 'mileage', PLATE_DUPLICATE: 'plate_number',
};

const isBlank = (v) => v == null || String(v).trim() === '';
/* The plate as the plate badge reads it: code in front of the number ("A 12345"). */
const plateOf = (v) => [v?.plate_code, v?.plate_number].filter(Boolean).join(' ');
const fmtKm = (n) => (n != null ? `${Number(n).toLocaleString()} km` : '—');

const LABEL = { fontSize: 13, color: '#475569' };
// border-box: a text input at 100% plus its padding ran into the next column.
const INPUT = { width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 };

/* ── Fuel-type visual metadata ── */
const FUEL_META = {
  petrol:   { label: 'Petrol',   color: '#f59e0b', bg: '#fef3c7' },
  diesel:   { label: 'Diesel',   color: '#64748b', bg: '#e2e8f0' },
  hybrid:   { label: 'Hybrid',   color: '#10b981', bg: '#d1fae5' },
  electric: { label: 'Electric', color: '#159fd9', bg: '#dbeafe' },
  other:    { label: 'Other',    color: '#8b5cf6', bg: '#ede9fe' },
};

const fmtDate = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  return dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

/* Map a free-text color name to a renderable CSS color for the swatch dot */
const COLOR_MAP = {
  white: '#f8fafc', black: '#1e293b', silver: '#cbd5e1', grey: '#94a3b8', gray: '#94a3b8',
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308', orange: '#f97316',
  brown: '#92400e', gold: '#d4af37', beige: '#e7d3b3', purple: '#a855f7', maroon: '#7f1d1d',
};
const colorToCss = (c) => {
  if (!c) return '#cbd5e1';
  const key = String(c).trim().toLowerCase();
  return COLOR_MAP[key] || (/^#|^rgb|^hsl/.test(key) ? key : '#cbd5e1');
};

/* Colored circular icon avatar for a vehicle */
function VehAvatar({ fuel, size = 44 }) {
  const meta = FUEL_META[fuel] || FUEL_META.other;
  return (
    <div className="veh-avatar" style={{ width: size, height: size, background: meta.bg, color: meta.color }}>
      <Car width={size * 0.5} height={size * 0.5} strokeWidth={1.8} />
    </div>
  );
}

function FuelBadge({ fuel }) {
  const meta = FUEL_META[fuel] || FUEL_META.other;
  return (
    <span className="veh-badge" style={{ background: meta.bg, color: meta.color }}>
      <GasTank width={12} height={12} /> {meta.label}
    </span>
  );
}

function VehKPI({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="veh-kpi" style={{ borderTopColor: color }}>
      <div className="veh-kpi-icon" style={{ background: color + '18', color }}>
        <Icon width={21} height={21} strokeWidth={1.8} />
      </div>
      <div className="veh-kpi-value">{value}</div>
      <div className="veh-kpi-label">{label}</div>
      {sub != null && <div className="veh-kpi-sub">{sub}</div>}
    </div>
  );
}

export default function Vehicles() {
  const { t } = useTranslation();
  const { workshop, user } = useContext(AuthContext);
  const { toasts, showToast } = useToast();
  // Adding, editing and removing vehicles — and opening a job card — is the
  // job.open roles' work (Service Advisor, Supervisor, managers).
  const mayEdit = canDo(user, 'job.open');
  const [searchParams, setSearchParams] = useSearchParams();

  const [vehicles, setVehicles] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState('');
  const [fuelFilter, setFuelFilter] = useState('');
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState('grid'); // 'grid' | 'table'
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(null); // null | { mode: 'create'|'edit', form, id? }
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null); // vehicle detail (with work orders)
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const customerFilter = searchParams.get('customer_id') || '';

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit, sort });
      if (search.trim()) params.set('search', search.trim());
      if (customerFilter) params.set('customer_id', customerFilter);
      if (fuelFilter) params.set('fuel_type', fuelFilter);
      const res = await api.get(`/vehicles?${params}`);
      if (res?.success) {
        setVehicles(res.data || []);
        setTotal(res.pagination?.total || 0);
        setSummary(res.summary || null);
      }
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, customerFilter, fuelFilter, sort]);

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

  useEffect(() => {
    (async () => {
      const res = await api.get('/customers?limit=500');
      if (res?.success) setCustomers(res.data || []);
    })();
  }, []);

  const openDetail = async (id) => {
    setDetailLoading(true);
    setDetail({ id });
    const res = await api.get(`/vehicles/${id}`);
    if (res?.success) setDetail(res.data);
    else { setDetail(null); showToast(res?.message || t('vehicles.load_failed', 'Failed to load vehicle'), 'error'); }
    setDetailLoading(false);
  };

  const openCreate = () => setModal({
    mode: 'create',
    form: { ...EMPTY_FORM, customer_id: customerFilter || '' },
  });

  const openEdit = (v) => setModal({
    mode: 'edit',
    id: v.id,
    orig: v,
    form: {
      customer_id: v.customer_id || '', make: v.make || '', model: v.model || '', vehicle_type: v.vehicle_type || '',
      year: v.year || '', plate_number: v.plate_number || '', plate_code: v.plate_code || '',
      plate_emirate: v.plate_emirate || '', vin: v.vin || '',
      color: v.color || '', mileage: v.mileage ?? '', fuel_type: v.fuel_type || 'petrol',
      transmission: v.transmission || 'automatic', notes: v.notes || '',
    },
  });

  // Editing a field clears its mark and the message; a changed plate also
  // drops the duplicate-plate question.
  const setField = (k, val) => setModal((m) => ({
    ...m, form: { ...m.form, [k]: val },
    errors: (m.errors || []).filter((x) => x !== k), error: null,
    dup: ['plate_number', 'plate_code', 'plate_emirate'].includes(k) ? null : m.dup,
  }));

  const typeLabel = (v) => t(`vehicles.vtype_${v}`, vehicleTypeLabel(v) || v);
  const maxYear = new Date().getFullYear() + 1;
  const fieldLabel = {
    customer_id: t('vehicles.customer', 'Customer'), make: t('vehicles.make', 'Make'), model: t('vehicles.model', 'Model'),
    vin: 'VIN', plate_number: t('vehicles.plate_number', 'Plate number'), plate_emirate: t('vehicles.emirate', 'Emirate'),
    year: t('vehicles.year', 'Year'),
  };
  // Customer, make and model always; the VIN, plate, emirate and year on a
  // new vehicle, and on an older one only what it already has. Removing a
  // recorded VIN is the server's to judge (a manager may).
  const need = (k) => ['customer_id', 'make', 'model'].includes(k)
    || (REQUIRED_DETAILS.includes(k) && (modal?.mode === 'create' || (k !== 'vin' && !isBlank(modal?.orig?.[k]))));
  const inp = (k, extra) => ({ ...INPUT, ...extra, ...(modal?.errors?.includes(k) ? { border: '1px solid #dc2626', background: '#fef2f2' } : null) });
  // What an older record still lacks of the mandatory details (edit only).
  const gaps = modal?.mode === 'edit' ? REQUIRED_DETAILS.filter((k) => isBlank(modal.orig?.[k])) : [];

  const handleSave = async (e, confirmPlate = false) => {
    e?.preventDefault();
    if (!modal) return;
    const f = modal.form;
    const missing = ['customer_id', 'make', 'model', ...REQUIRED_DETAILS].filter((k) => need(k) && isBlank(f[k]));
    if (missing.length) {
      setModal((m) => ({ ...m, errors: missing, dup: null,
        error: t('vehicles.required_missing', 'Fill in the required fields: {{fields}}.', { fields: missing.map((k) => fieldLabel[k]).join(', ') }) }));
      return;
    }
    // Only a year typed here is checked, as on the server: an imported car's
    // odd year does not block editing its mileage.
    const yearTyped = modal.mode === 'create' || String(f.year ?? '') !== String(modal.orig?.year ?? '');
    if (yearTyped && !isBlank(f.year) && !(/^\d{4}$/.test(String(f.year).trim()) && Number(f.year) >= 1950 && Number(f.year) <= maxYear)) {
      setModal((m) => ({ ...m, errors: ['year'], dup: null, error: t('vehicles.year_range', 'Year must be between 1950 and {{max}}.', { max: maxYear }) }));
      return;
    }
    setSaving(true);
    const payload = {
      customer_id: Number(f.customer_id),
      make: f.make.trim(),
      model: f.model.trim(),
      vehicle_type: f.vehicle_type || null,
      year: f.year ? Number(f.year) : null,
      plate_number: f.plate_number.trim() || null,
      plate_code: f.plate_code.trim() || null,
      plate_emirate: f.plate_emirate || null,
      vin: f.vin.trim() || null,
      color: f.color.trim() || null,
      mileage: f.mileage === '' ? null : Number(f.mileage),
      fuel_type: f.fuel_type,
      transmission: f.transmission,
      notes: f.notes.trim() || null,
      // Set once the advisor has answered "it is a different car" to the
      // duplicate-plate question below.
      ...(confirmPlate ? { confirm_duplicate_plate: true } : {}),
    };
    const res = modal.mode === 'create'
      ? await api.post('/vehicles', payload)
      : await api.put(`/vehicles/${modal.id}`, payload);
    setSaving(false);
    if (res?.success) {
      showToast(modal.mode === 'create'
        ? t('vehicles.created', 'Vehicle added')
        : t('vehicles.updated', 'Vehicle updated'), 'success');
      setModal(null);
      fetchVehicles();
      if (detail?.id && modal.id === detail.id) openDetail(detail.id);
    } else {
      // The server's message stays in the form with its field marked. A
      // duplicate plate is a question, not a block: a plate can move to the
      // owner's next car.
      const fields = res?.fields || (ERROR_FIELD[res?.code] ? [ERROR_FIELD[res.code]] : []);
      setModal((m) => ({ ...m, errors: fields,
        error: res?.message || t('vehicles.save_failed', 'Failed to save vehicle'),
        dup: res?.code === 'PLATE_DUPLICATE' ? (res.existing || res.data || {}) : null }));
    }
  };

  const handleDelete = async (id) => {
    const res = await api.delete(`/vehicles/${id}`);
    setConfirmDelete(null);
    if (res?.success) {
      showToast(t('vehicles.deleted', 'Vehicle deleted'), 'success');
      if (detail?.id === id) setDetail(null);
      fetchVehicles();
    } else {
      showToast(res?.message || t('vehicles.delete_failed', 'Failed to delete vehicle'), 'error');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const filterCustomer = customers.find((c) => String(c.id) === String(customerFilter));
  const fuelCounts = summary?.fuel_breakdown || {};

  return (
    <div className="crm-page veh-page">
      {/* ── Header ── */}
      <div className="veh-header">
        <div>
          <h2 className="veh-title">
            <span className="veh-title-icon"><Car width={22} height={22} /></span>
            {t('vehicles.title', 'Vehicles')}
            <span className="veh-count-badge">{total}</span>
          </h2>
          <p className="veh-subtitle">{t('vehicles.subtitle', 'Manage customer vehicles and track per-vehicle service history')}</p>
          {filterCustomer && (
            <div className="veh-filter-chip">
              {t('vehicles.filtered_by', 'Showing vehicles of')} <strong>{filterCustomer.full_name || filterCustomer.name}</strong>
              <button
                className="veh-chip-clear"
                onClick={() => { searchParams.delete('customer_id'); setSearchParams(searchParams); setPage(1); }}
              >
                <Xmark width={12} height={12} /> {t('common.clear', 'Clear')}
              </button>
            </div>
          )}
        </div>
        {mayEdit && <button className="veh-add-btn" onClick={openCreate}>
          <Plus width={18} height={18} /> {t('vehicles.add', 'Add Vehicle')}
        </button>}
      </div>

      {/* ── KPI cards ── */}
      <div className="veh-kpis">
        <VehKPI icon={Car}    color="#159fd9" label={t('vehicles.kpi.total', 'Total Vehicles')}
          value={summary?.total_vehicles ?? total}
          sub={t('vehicles.kpi.avg_mileage', '{{km}} km avg', { km: (summary?.avg_mileage || 0).toLocaleString() })} />
        <VehKPI icon={Wrench} color="#1e3a6b" label={t('vehicles.kpi.services', 'Service Records')}
          value={summary?.total_services ?? 0}
          sub={t('vehicles.kpi.all_time', 'all-time work orders')} />
        <VehKPI icon={Group}  color="#8b5cf6" label={t('vehicles.kpi.owners', 'Vehicle Owners')}
          value={summary?.unique_owners ?? 0}
          sub={t('vehicles.kpi.unique', 'unique customers')} />
      </div>

      {/* ── Toolbar ── */}
      <div className="veh-toolbar">
        <div className="veh-search">
          <Search width={16} height={16} className="veh-search-icon" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('vehicles.search_placeholder', 'Search plate, make, model, VIN or owner…')}
          />
        </div>
        <select className="veh-select" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
          <option value="recent">{t('vehicles.sort.recent', 'Newest first')}</option>
          <option value="oldest">{t('vehicles.sort.oldest', 'Oldest first')}</option>
          <option value="make">{t('vehicles.sort.make', 'Make A–Z')}</option>
          <option value="services">{t('vehicles.sort.services', 'Most serviced')}</option>
          <option value="mileage">{t('vehicles.sort.mileage', 'Highest mileage')}</option>
        </select>
        <div className="veh-view-toggle">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title={t('vehicles.view.grid', 'Grid')}>
            <ViewGrid width={16} height={16} />
          </button>
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} title={t('vehicles.view.table', 'Table')}>
            <List width={16} height={16} />
          </button>
        </div>
      </div>

      {/* ── Fuel segment pills ── */}
      <div className="veh-segments">
        <span className="veh-segments-label">{t('vehicles.fuel', 'Fuel')}</span>
        <button className={`veh-seg ${!fuelFilter ? 'active' : ''}`} onClick={() => { setFuelFilter(''); setPage(1); }}>
          {t('common.all', 'All')} <span className="veh-seg-count">{summary?.total_vehicles ?? total}</span>
        </button>
        {FUEL_TYPES.map((f) => {
          const cnt = fuelCounts[f] || 0;
          if (!cnt) return null;
          const meta = FUEL_META[f];
          const active = fuelFilter === f;
          return (
            <button key={f} onClick={() => { setFuelFilter(active ? '' : f); setPage(1); }}
              className={`veh-seg ${active ? 'active' : ''}`}
              style={active ? { background: meta.color, borderColor: meta.color, color: '#fff' } : { color: meta.color }}>
              <span className="veh-seg-dot" style={{ background: meta.color }} />
              {t(`vehicles.fuel_${f}`, meta.label)} <span className="veh-seg-count">{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* ── Body ── */}
      {loading ? <Loader /> : vehicles.length === 0 ? (
        <div className="veh-empty">
          <div className="veh-empty-icon"><Car width={40} height={40} /></div>
          <h3>{t('vehicles.empty', 'No vehicles found')}</h3>
          <p>{t('vehicles.empty_hint', 'Add a customer vehicle to start tracking its service history.')}</p>
          {mayEdit && <button className="veh-add-btn" onClick={openCreate}><Plus width={16} height={16} /> {t('vehicles.add', 'Add Vehicle')}</button>}
        </div>
      ) : view === 'grid' ? (
        <div className="veh-grid">
          {vehicles.map((v) => {
            const last = fmtDate(v.last_service_at);
            return (
              <div key={v.id} className="veh-card" onClick={() => openDetail(v.id)}>
                <div className="veh-card-top">
                  <VehAvatar fuel={v.fuel_type} />
                  <div className="veh-card-heading">
                    <div className="veh-card-name">{v.make} {v.model}</div>
                    <div className="veh-card-year">
                      {v.year || '—'} · {t(`vehicles.trans_${v.transmission}`, v.transmission || '')}
                    </div>
                  </div>
                  {v.plate_number && <PlateNumber plateNumber={plateOf(v)} size="md" />}
                </div>

                <div className="veh-card-badges">
                  <FuelBadge fuel={v.fuel_type} />
                  {v.vehicle_type && (
                    <span className="veh-badge veh-badge-muted" style={{ textTransform: 'none' }}>
                      <Car width={12} height={12} /> {typeLabel(v.vehicle_type)}
                    </span>
                  )}
                  {v.color && (
                    <span className="veh-badge veh-badge-muted">
                      <span className="veh-color-dot" style={{ background: colorToCss(v.color) }} />{v.color}
                    </span>
                  )}
                  {v.vin && <span className="veh-badge veh-badge-muted veh-mono">VIN ·{String(v.vin).slice(-6)}</span>}
                </div>

                <div className="veh-card-meta">
                  <div className="veh-meta-row">
                    <User width={14} height={14} />
                    {v.customer_id ? (
                      <Link to={`/customers?highlight=${v.customer_id}`} onClick={(e) => e.stopPropagation()} className="veh-owner-link">
                        {v.customer_name || `#${v.customer_id}`}
                      </Link>
                    ) : <span className="veh-muted">{t('vehicles.no_owner', 'No owner')}</span>}
                  </div>
                  <div className="veh-meta-row">
                    <SettingsIcon width={14} height={14} />
                    <span>{v.mileage != null ? `${Number(v.mileage).toLocaleString()} km` : '—'}</span>
                  </div>
                </div>

                <div className="veh-card-foot">
                  <div className="veh-foot-stat" title={t('vehicles.work_orders', 'work orders')}>
                    <Wrench width={14} height={14} /> {v.wo_count || 0}
                  </div>
                  <div className="veh-foot-stat" title={t('vehicles.last_service', 'Last service')}>
                    <Calendar width={14} height={14} /> {last || t('vehicles.never', 'Never')}
                  </div>
                  {mayEdit && <div className="veh-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button title={t('common.edit', 'Edit')} onClick={() => openEdit(v)}><EditPencil width={15} height={15} /></button>
                    <button className="danger" title={t('common.delete', 'Delete')} onClick={() => setConfirmDelete(v)}><Trash width={15} height={15} /></button>
                  </div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="veh-table-wrap">
          <table className="veh-table">
            <thead>
              <tr>
                <th>{t('vehicles.vehicle', 'Vehicle')}</th>
                <th>{t('vehicles.plate', 'Plate')}</th>
                <th>{t('vehicles.fuel', 'Fuel')}</th>
                <th>{t('vehicles.customer', 'Customer')}</th>
                <th>{t('vehicles.mileage', 'Mileage')}</th>
                <th>{t('vehicles.service_history', 'Services')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} onClick={() => openDetail(v.id)}>
                  <td>
                    <div className="veh-tcell">
                      <VehAvatar fuel={v.fuel_type} size={34} />
                      <div>
                        <div className="veh-tcell-name">{v.make} {v.model}</div>
                        <div className="veh-tcell-sub">
                          {v.year || '—'}{v.vehicle_type ? ` · ${typeLabel(v.vehicle_type)}` : ''}{v.vin ? ` · VIN ·${String(v.vin).slice(-6)}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{v.plate_number ? <PlateNumber plateNumber={plateOf(v)} size="sm" /> : '—'}</td>
                  <td><FuelBadge fuel={v.fuel_type} /></td>
                  <td>
                    {v.customer_id ? (
                      <Link to={`/customers?highlight=${v.customer_id}`} onClick={(e) => e.stopPropagation()} className="veh-owner-link">
                        <User width={14} height={14} /> {v.customer_name || `#${v.customer_id}`}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="veh-muted">{v.mileage != null ? `${Number(v.mileage).toLocaleString()} km` : '—'}</td>
                  <td>
                    <div className="veh-tservice">
                      <span className="veh-tservice-count">{v.wo_count || 0}</span>
                      <span className="veh-muted">{fmtDate(v.last_service_at) || t('vehicles.never', 'Never')}</span>
                    </div>
                  </td>
                  <td className="veh-tactions" onClick={(e) => e.stopPropagation()}>
                    {mayEdit && <>
                      <button title={t('common.edit', 'Edit')} onClick={() => openEdit(v)}><EditPencil width={16} height={16} /></button>
                      <button className="danger" title={t('common.delete', 'Delete')} onClick={() => setConfirmDelete(v)}><Trash width={16} height={16} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="veh-pagination">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <NavArrowLeft width={16} height={16} />
          </button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <NavArrowRight width={16} height={16} />
          </button>
        </div>
      )}

      {/* ── Detail drawer ── */}
      {detail && (
        <div className="veh-drawer-overlay" onClick={() => setDetail(null)}>
          <div className="veh-drawer" onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <div style={{ padding: 24 }}><Loader /></div>
            ) : (
              <>
                {/* Gradient header */}
                <div className="veh-drawer-head">
                  <button className="veh-drawer-close" onClick={() => setDetail(null)}>
                    <Xmark width={20} height={20} />
                  </button>
                  <div className="veh-drawer-head-main">
                    <div className="veh-drawer-avatar"><Car width={30} height={30} /></div>
                    <div>
                      <div className="veh-drawer-name">{detail.make} {detail.model}</div>
                      <div className="veh-drawer-sub">
                        {detail.vehicle_type && <>{typeLabel(detail.vehicle_type)} · </>}
                        {detail.year || '—'} · {t(`vehicles.fuel_${detail.fuel_type}`, detail.fuel_type || '')} · {t(`vehicles.trans_${detail.transmission}`, detail.transmission || '')}
                      </div>
                    </div>
                    {detail.plate_number && <PlateNumber plateNumber={plateOf(detail)} plateColor="#dc2626" size="lg" />}
                  </div>
                </div>

                <div className="veh-drawer-body">
                  {/* Stat tiles */}
                  <div className="veh-stat-tiles">
                    <div className="veh-tile">
                      <div className="veh-tile-val">{detail.total_work_orders ?? (detail.work_orders || []).length}</div>
                      <div className="veh-tile-lbl">{t('vehicles.work_orders', 'Work Orders')}</div>
                    </div>
                    <div className="veh-tile">
                      <div className="veh-tile-val">{detail.completed_work_orders ?? 0}</div>
                      <div className="veh-tile-lbl">{t('vehicles.completed', 'Completed')}</div>
                    </div>
                    <div className="veh-tile">
                      <div className="veh-tile-val veh-tile-money">
                        {fmtCurrency((detail.work_orders || []).filter(w => w.status === 'completed').reduce((s, w) => s + Number(w.total_amount || 0), 0), workshop?.currency)}
                      </div>
                      <div className="veh-tile-lbl">{t('vehicles.total_spent', 'Total Spent')}</div>
                    </div>
                  </div>

                  {/* Spec grid */}
                  <div className="veh-spec-grid">
                    <div className="veh-spec"><span>VIN</span><strong className="veh-mono">{detail.vin || '—'}</strong></div>
                    <div className="veh-spec"><span>{t('vehicles.vehicle_type', 'Vehicle type')}</span><strong>{detail.vehicle_type ? typeLabel(detail.vehicle_type) : '—'}</strong></div>
                    <div className="veh-spec"><span>{t('vehicles.emirate', 'Emirate')}</span><strong>{detail.plate_emirate || '—'}</strong></div>
                    <div className="veh-spec"><span>{t('vehicles.color', 'Color')}</span>
                      <strong className="veh-spec-color">
                        {detail.color ? <span className="veh-color-dot" style={{ background: colorToCss(detail.color) }} /> : null}{detail.color || '—'}
                      </strong>
                    </div>
                    {/* The odometer (client review, 2 Nov 2026): the latest
                        reading on file, and where and when the car was last
                        read at a visit — with that reading when it differs. */}
                    <div className="veh-spec"><span>{t('vehicles.odometer_latest', 'Odometer (latest)')}</span>
                      <strong>{fmtKm(detail.mileage)}</strong>
                      {detail.last_odometer && (
                        <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>
                          {Number(detail.last_odometer.reading) === Number(detail.mileage)
                            ? t('vehicles.odometer_read_at', 'Read at')
                            : t('vehicles.odometer_last_visit', 'Last visit: {{km}}', { km: fmtKm(detail.last_odometer.reading) })}{' '}
                          <Link to={`/work-orders/${detail.last_odometer.work_order_id}`} className="veh-owner-link">{detail.last_odometer.work_order_number}</Link>
                          {fmtDate(detail.last_odometer.read_at) ? ` · ${fmtDate(detail.last_odometer.read_at)}` : ''}
                        </div>
                      )}
                    </div>
                    <div className="veh-spec"><span>{t('vehicles.last_service', 'Last Service')}</span><strong>{fmtDate(detail.last_service_at) || t('vehicles.never', 'Never')}</strong></div>
                  </div>

                  {/* Owner card */}
                  {detail.customer_id && (
                    <Link to={`/customers?highlight=${detail.customer_id}`} className="veh-owner-card">
                      <div className="veh-owner-ava"><User width={18} height={18} /></div>
                      <div>
                        <div className="veh-owner-name">{detail.customer_name || `${t('vehicles.customer', 'Customer')} #${detail.customer_id}`}</div>
                        {detail.customer_phone && <div className="veh-owner-phone">{detail.customer_phone}</div>}
                      </div>
                      <NavArrowRight width={16} height={16} className="veh-owner-arrow" />
                    </Link>
                  )}

                  {detail.notes && <p className="veh-notes">{detail.notes}</p>}

                  {/* Actions */}
                  {mayEdit && <div className="veh-drawer-actions">
                    <button className="veh-add-btn" onClick={() => openEdit(detail)}>
                      <EditPencil width={15} height={15} /> {t('common.edit', 'Edit')}
                    </button>
                    {/* The job card wizard opens with this vehicle's owner (and
                        the vehicle, where the wizard supports it). */}
                    {detail.customer_id && (
                      <Link to={`/work-orders?customer_id=${detail.customer_id}&vehicle_id=${detail.id}`} className="veh-secondary-btn">
                        <Wrench width={15} height={15} /> {t('vehicles.new_work_order', 'New Work Order')}
                      </Link>
                    )}
                  </div>}

                  {/* Service history timeline */}
                  <h4 className="veh-section-title">
                    {t('vehicles.service_history', 'Service History')}
                    <span className="veh-section-count">{(detail.work_orders || []).length}</span>
                  </h4>
                  {(detail.work_orders || []).length === 0 ? (
                    <p className="veh-muted" style={{ fontSize: 13 }}>{t('vehicles.no_history', 'No service history yet.')}</p>
                  ) : (
                    <div className="veh-timeline">
                      {(detail.work_orders || []).map((wo) => {
                        // Workshop words and colours from the shared helper — the
                        // chip used to print the raw enum ("ready for pickup").
                        const st = woTone(wo);
                        return (
                          <Link key={wo.id} to={`/work-orders/${wo.id}`} className="veh-wo">
                            <span className="veh-wo-dot" style={{ background: st.color }} />
                            <div className="veh-wo-main">
                              <div className="veh-wo-top">
                                <span className="veh-wo-num">{wo.work_order_number}</span>
                                <span className="veh-wo-amount">{fmtCurrency(wo.total_amount, workshop?.currency)}</span>
                              </div>
                              <div className="veh-wo-bot">
                                <span className="veh-wo-status" style={{ background: st.bg, color: st.color, textTransform: 'none' }}>
                                  {woLabel(t, wo)}
                                </span>
                                <span className="veh-muted">
                                  {fmtDate(wo.created_at)}{wo.odometer_in != null ? ` · ${fmtKm(wo.odometer_in)}` : ''}
                                </span>
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Create / Edit modal ── */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setModal(null)}>
          {/* noValidate: the required fields are checked in handleSave, all
              at once and with the older-record leniency the browser's own
              check cannot express. */}
          <form onSubmit={handleSave} onClick={(e) => e.stopPropagation()} noValidate
            style={{ background: '#fff', borderRadius: 14, width: 'min(560px, 100%)', maxHeight: '92vh', overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ margin: 0 }}>
                {modal.mode === 'create' ? t('vehicles.add', 'Add Vehicle') : t('vehicles.edit', 'Edit Vehicle')}
              </h3>
              <button type="button" onClick={() => setModal(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <Xmark width={20} height={20} />
              </button>
            </div>

            {gaps.length > 0 && (
              <div style={{ marginBottom: 14, padding: '9px 12px', borderRadius: 8, fontSize: 13, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                {t('vehicles.details_missing_hint', 'Required details still missing: {{fields}}. Fill in what you have.', { fields: gaps.map((k) => fieldLabel[k]).join(', ') })}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label style={{ ...LABEL, gridColumn: '1 / -1' }}>
                {t('vehicles.customer', 'Customer')} *
                <select value={modal.form.customer_id} required onChange={(e) => setField('customer_id', e.target.value)} style={inp('customer_id')}>
                  <option value="">{t('vehicles.select_customer', 'Select customer…')}</option>
                  {/* The page loads 500 customers; the owner being edited is always on offer. */}
                  {modal.orig?.customer_id && !customers.some((c) => String(c.id) === String(modal.orig.customer_id)) && (
                    <option value={modal.orig.customer_id}>{modal.orig.customer_name || `#${modal.orig.customer_id}`}</option>
                  )}
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.name} {c.phone ? `— ${c.phone}` : ''}</option>
                  ))}
                </select>
              </label>
              <label style={LABEL}>
                {t('vehicles.make', 'Make')} *
                <select value={modal.form.make} required onChange={(e) => { setField('make', e.target.value); setField('model', ''); }} style={inp('make')}>
                  <option value="">{t('vehicles.select_make', 'Select make…')}</option>
                  {CAR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label style={LABEL}>
                {t('vehicles.model', 'Model')} *
                {modal.form.make && CAR_CATALOG[modal.form.make] && CAR_CATALOG[modal.form.make].length > 0 ? (
                  <select value={modal.form.model} required onChange={(e) => setField('model', e.target.value)} style={inp('model')}>
                    <option value="">{t('vehicles.select_model', 'Select model…')}</option>
                    {CAR_CATALOG[modal.form.make].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input value={modal.form.model} required onChange={(e) => setField('model', e.target.value)}
                    placeholder={modal.form.make ? 'Enter model' : 'Select make first'}
                    disabled={!modal.form.make}
                    style={inp('model')} />
                )}
              </label>
              {/* A UAE plate is number + code + emirate, kept apart as in the
                  job card wizard ("87345 / A / Abu Dhabi"). */}
              <label style={LABEL}>
                {t('vehicles.plate_number', 'Plate number')} *
                <input value={modal.form.plate_number} required={need('plate_number')} onChange={(e) => setField('plate_number', e.target.value)}
                  placeholder="87345" maxLength={50} dir="ltr" autoComplete="off" style={inp('plate_number', { textTransform: 'uppercase' })} />
              </label>
              <label style={LABEL}>
                {t('vehicles.plate_code', 'Plate code')}
                <input value={modal.form.plate_code} onChange={(e) => setField('plate_code', e.target.value)}
                  placeholder="A" maxLength={10} dir="ltr" autoComplete="off" style={inp('plate_code', { textTransform: 'uppercase' })} />
              </label>
              <label style={LABEL}>
                {t('vehicles.emirate', 'Emirate')} *
                <select value={modal.form.plate_emirate} required={need('plate_emirate')} onChange={(e) => setField('plate_emirate', e.target.value)} style={inp('plate_emirate')}>
                  <option value="">{t('vehicles.select_emirate', 'Select emirate…')}</option>
                  {/* An older record's emirate outside the list stays on offer, so an edit does not drop it. */}
                  {modal.orig?.plate_emirate && !EMIRATES.includes(modal.orig.plate_emirate) && (
                    <option value={modal.orig.plate_emirate}>{modal.orig.plate_emirate}</option>
                  )}
                  {EMIRATES.map((em) => <option key={em} value={em}>{em}</option>)}
                </select>
              </label>
              <label style={LABEL}>
                {t('vehicles.year', 'Year')} *
                <input type="number" min="1950" max={maxYear} value={modal.form.year} required={need('year')} onChange={(e) => setField('year', e.target.value)}
                  placeholder="2022" style={inp('year')} />
              </label>
              <label style={LABEL}>
                VIN *
                <input value={modal.form.vin} required={need('vin')} onChange={(e) => setField('vin', e.target.value)} placeholder="JTDBR32E720xxxxxx"
                  maxLength={25} dir="ltr" autoComplete="off" style={inp('vin', { fontFamily: 'monospace', textTransform: 'uppercase' })} />
              </label>
              <label style={LABEL}>
                {t('vehicles.vehicle_type', 'Vehicle type')}
                <select value={modal.form.vehicle_type} onChange={(e) => setField('vehicle_type', e.target.value)} style={inp('vehicle_type')}>
                  <option value="">{t('vehicles.select_vehicle_type', 'Select type…')}</option>
                  {VEHICLE_TYPES.map((o) => <option key={o.value} value={o.value}>{typeLabel(o.value)}</option>)}
                </select>
              </label>
              <label style={LABEL}>
                {t('vehicles.color', 'Color')}
                <input value={modal.form.color} onChange={(e) => setField('color', e.target.value)} placeholder={t('vehicles.color_placeholder', 'White')}
                  style={inp('color')} />
              </label>
              <label style={LABEL}>
                {t('vehicles.odometer_km', 'Odometer (km)')}
                <input type="number" min="0" value={modal.form.mileage} onChange={(e) => setField('mileage', e.target.value)} placeholder="45000"
                  style={inp('mileage')} />
              </label>
              <label style={LABEL}>
                {t('vehicles.fuel', 'Fuel Type')}
                <select value={modal.form.fuel_type} onChange={(e) => setField('fuel_type', e.target.value)} style={inp('fuel_type')}>
                  {FUEL_TYPES.map((f) => <option key={f} value={f}>{t(`vehicles.fuel_${f}`, f)}</option>)}
                </select>
              </label>
              <label style={LABEL}>
                {t('vehicles.transmission', 'Transmission')}
                <select value={modal.form.transmission} onChange={(e) => setField('transmission', e.target.value)} style={inp('transmission')}>
                  <option value="automatic">{t('vehicles.trans_automatic', 'Automatic')}</option>
                  <option value="manual">{t('vehicles.trans_manual', 'Manual')}</option>
                </select>
              </label>
              <label style={{ ...LABEL, gridColumn: '1 / -1' }}>
                {t('vehicles.notes', 'Notes')}
                <textarea rows={3} value={modal.form.notes} onChange={(e) => setField('notes', e.target.value)}
                  style={inp('notes', { resize: 'vertical' })} />
              </label>
            </div>

            {modal.error && (
              <div role="alert" style={{
                marginTop: 16, padding: '10px 12px', borderRadius: 8, fontSize: 13,
                background: modal.dup ? '#fffbeb' : '#fef2f2', border: `1px solid ${modal.dup ? '#fde68a' : '#fecaca'}`, color: modal.dup ? '#92400e' : '#b91c1c',
              }}>
                {modal.error}
                {modal.dup && (
                  <div style={{ marginTop: 8 }}>
                    <button type="button" disabled={saving} onClick={() => handleSave(null, true)}
                      style={{ border: '1px solid #f59e0b', background: '#fff', color: '#92400e', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                      {t('vehicles.plate_confirm_different', 'It is a different car — save anyway')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" onClick={() => setModal(null)}
                style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, padding: '9px 18px', cursor: 'pointer' }}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button type="submit" className="crm-btn-primary" disabled={saving}>
                {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setConfirmDelete(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(400px, 100%)', padding: 24, textAlign: 'center' }}>
            <WarningTriangle width={32} height={32} style={{ color: '#dc2626', marginBottom: 10 }} />
            <h3 style={{ margin: '0 0 8px' }}>{t('vehicles.delete_title', 'Delete this vehicle?')}</h3>
            <p style={{ fontSize: 13.5, color: '#64748b' }}>
              {confirmDelete.make} {confirmDelete.model} {confirmDelete.plate_number ? `(${confirmDelete.plate_number})` : ''} — {t('vehicles.delete_warning', 'this cannot be undone.')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 16 }}>
              <button onClick={() => setConfirmDelete(null)}
                style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, padding: '9px 18px', cursor: 'pointer' }}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button onClick={() => handleDelete(confirmDelete.id)}
                style={{ border: 'none', background: '#dc2626', color: '#fff', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600 }}>
                {t('common.delete', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
