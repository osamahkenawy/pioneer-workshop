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
import Toast, { useToast } from '../components/Toast';
import Loader from '../components/Loader';
import PlateNumber from '../components/PlateNumber';
import { fmtCurrency } from '../utils/currency';
import './CRMPages.css';

const EMPTY_FORM = {
  customer_id: '', make: '', model: '', year: '', plate_number: '',
  vin: '', color: '', mileage: '', fuel_type: 'petrol', transmission: 'automatic', notes: '',
};

const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'other'];

/* ── Fuel-type visual metadata ── */
const FUEL_META = {
  petrol:   { label: 'Petrol',   color: '#f59e0b', bg: '#fef3c7' },
  diesel:   { label: 'Diesel',   color: '#64748b', bg: '#e2e8f0' },
  hybrid:   { label: 'Hybrid',   color: '#10b981', bg: '#d1fae5' },
  electric: { label: 'Electric', color: '#159fd9', bg: '#dbeafe' },
  other:    { label: 'Other',    color: '#8b5cf6', bg: '#ede9fe' },
};

/* ── WorkOrder status → color chip ── */
const WO_STATUS_META = {
  pending:          { color: '#b45309', bg: '#fef3c7' },
  confirmed:        { color: '#2563eb', bg: '#dbeafe' },
  assigned:         { color: '#1d4ed8', bg: '#dbeafe' },
  accepted:         { color: '#1565C0', bg: '#e0e7ff' },
  in_progress:      { color: '#0e7490', bg: '#cffafe' },
  ready_for_pickup: { color: '#c2410c', bg: '#ffedd5' },
  completed:        { color: '#15803d', bg: '#dcfce7' },
  failed:           { color: '#dc2626', bg: '#fee2e2' },
  cancelled:        { color: '#b91c1c', bg: '#fee2e2' },
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
  const { workshop } = useContext(AuthContext);
  const { toasts, showToast } = useToast();
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
    form: {
      customer_id: v.customer_id || '', make: v.make || '', model: v.model || '',
      year: v.year || '', plate_number: v.plate_number || '', vin: v.vin || '',
      color: v.color || '', mileage: v.mileage ?? '', fuel_type: v.fuel_type || 'petrol',
      transmission: v.transmission || 'automatic', notes: v.notes || '',
    },
  });

  const setField = (k, val) => setModal((m) => ({ ...m, form: { ...m.form, [k]: val } }));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!modal) return;
    const f = modal.form;
    if (!f.customer_id || !f.make.trim() || !f.model.trim()) {
      showToast(t('vehicles.required_fields', 'Customer, make and model are required'), 'warning');
      return;
    }
    setSaving(true);
    const payload = {
      customer_id: Number(f.customer_id),
      make: f.make.trim(),
      model: f.model.trim(),
      year: f.year ? Number(f.year) : null,
      plate_number: f.plate_number.trim() || null,
      vin: f.vin.trim() || null,
      color: f.color.trim() || null,
      mileage: f.mileage === '' ? null : Number(f.mileage),
      fuel_type: f.fuel_type,
      transmission: f.transmission,
      notes: f.notes.trim() || null,
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
      showToast(res?.message || t('vehicles.save_failed', 'Failed to save vehicle'), 'error');
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
        <button className="veh-add-btn" onClick={openCreate}>
          <Plus width={18} height={18} /> {t('vehicles.add', 'Add Vehicle')}
        </button>
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
          <button className="veh-add-btn" onClick={openCreate}><Plus width={16} height={16} /> {t('vehicles.add', 'Add Vehicle')}</button>
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
                  {v.plate_number && <PlateNumber plateNumber={v.plate_number} size="md" />}
                </div>

                <div className="veh-card-badges">
                  <FuelBadge fuel={v.fuel_type} />
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
                  <div className="veh-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button title={t('common.edit', 'Edit')} onClick={() => openEdit(v)}><EditPencil width={15} height={15} /></button>
                    <button className="danger" title={t('common.delete', 'Delete')} onClick={() => setConfirmDelete(v)}><Trash width={15} height={15} /></button>
                  </div>
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
                        <div className="veh-tcell-sub">{v.year || '—'}{v.vin ? ` · VIN ·${String(v.vin).slice(-6)}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td>{v.plate_number ? <PlateNumber plateNumber={v.plate_number} size="sm" /> : '—'}</td>
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
                    <button title={t('common.edit', 'Edit')} onClick={() => openEdit(v)}><EditPencil width={16} height={16} /></button>
                    <button className="danger" title={t('common.delete', 'Delete')} onClick={() => setConfirmDelete(v)}><Trash width={16} height={16} /></button>
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
                        {detail.year || '—'} · {t(`vehicles.fuel_${detail.fuel_type}`, detail.fuel_type || '')} · {t(`vehicles.trans_${detail.transmission}`, detail.transmission || '')}
                      </div>
                    </div>
                    {detail.plate_number && <PlateNumber plateNumber={detail.plate_number} plateColor="#dc2626" size="lg" />}
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
                    <div className="veh-spec"><span>{t('vehicles.color', 'Color')}</span>
                      <strong className="veh-spec-color">
                        {detail.color ? <span className="veh-color-dot" style={{ background: colorToCss(detail.color) }} /> : null}{detail.color || '—'}
                      </strong>
                    </div>
                    <div className="veh-spec"><span>{t('vehicles.mileage', 'Mileage')}</span><strong>{detail.mileage != null ? `${Number(detail.mileage).toLocaleString()} km` : '—'}</strong></div>
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
                  <div className="veh-drawer-actions">
                    <button className="veh-add-btn" onClick={() => openEdit(detail)}>
                      <EditPencil width={15} height={15} /> {t('common.edit', 'Edit')}
                    </button>
                    <Link to={`/work-orders?vehicle_id=${detail.id}&customer_id=${detail.customer_id || ''}`} className="veh-secondary-btn">
                      <Wrench width={15} height={15} /> {t('vehicles.new_work_order', 'New Work Order')}
                    </Link>
                  </div>

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
                        const st = WO_STATUS_META[wo.status] || { color: '#64748b', bg: '#e2e8f0' };
                        return (
                          <Link key={wo.id} to={`/work-orders/${wo.id}`} className="veh-wo">
                            <span className="veh-wo-dot" style={{ background: st.color }} />
                            <div className="veh-wo-main">
                              <div className="veh-wo-top">
                                <span className="veh-wo-num">{wo.work_order_number}</span>
                                <span className="veh-wo-amount">{fmtCurrency(wo.total_amount, workshop?.currency)}</span>
                              </div>
                              <div className="veh-wo-bot">
                                <span className="veh-wo-status" style={{ background: st.bg, color: st.color }}>
                                  {String(wo.status || '').replace(/_/g, ' ')}
                                </span>
                                <span className="veh-muted">{fmtDate(wo.created_at)}</span>
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
          <form onSubmit={handleSave} onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, width: 'min(560px, 100%)', maxHeight: '92vh', overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ margin: 0 }}>
                {modal.mode === 'create' ? t('vehicles.add', 'Add Vehicle') : t('vehicles.edit', 'Edit Vehicle')}
              </h3>
              <button type="button" onClick={() => setModal(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <Xmark width={20} height={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label style={{ gridColumn: '1 / -1', fontSize: 13, color: '#475569' }}>
                {t('vehicles.customer', 'Customer')} *
                <select value={modal.form.customer_id} required onChange={(e) => setField('customer_id', e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <option value="">{t('vehicles.select_customer', 'Select customer…')}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.name} {c.phone ? `— ${c.phone}` : ''}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13, color: '#475569' }}>
                {t('vehicles.make', 'Make')} *
                <select value={modal.form.make} required onChange={(e) => { setField('make', e.target.value); setField('model', ''); }}
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <option value="">{t('vehicles.select_make', 'Select make…')}</option>
                  {CAR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13, color: '#475569' }}>
                {t('vehicles.model', 'Model')} *
                {modal.form.make && CAR_CATALOG[modal.form.make] && CAR_CATALOG[modal.form.make].length > 0 ? (
                  <select value={modal.form.model} required onChange={(e) => setField('model', e.target.value)}
                    style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                    <option value="">{t('vehicles.select_model', 'Select model…')}</option>
                    {CAR_CATALOG[modal.form.make].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input value={modal.form.model} required onChange={(e) => setField('model', e.target.value)}
                    placeholder={modal.form.make ? 'Enter model' : 'Select make first'}
                    disabled={!modal.form.make}
                    style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }} />
                )}
              </label>
              <label style={{ fontSize: 13, color: '#475569' }}>
                {t('vehicles.year', 'Year')}
                <input type="number" min="1950" max="2100" value={modal.form.year} onChange={(e) => setField('year', e.target.value)} placeholder="2022"
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }} />
              </label>
              <label style={{ fontSize: 13, color: '#475569' }}>
                {t('vehicles.plate', 'Plate Number')}
                <input value={modal.form.plate_number} onChange={(e) => setField('plate_number', e.target.value)} placeholder="A 12345"
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }} />
              </label>
              <label style={{ fontSize: 13, color: '#475569' }}>
                VIN
                <input value={modal.form.vin} onChange={(e) => setField('vin', e.target.value)} placeholder="JTDBR32E720xxxxxx"
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'monospace' }} />
              </label>
              <label style={{ fontSize: 13, color: '#475569' }}>
                {t('vehicles.color', 'Color')}
                <input value={modal.form.color} onChange={(e) => setField('color', e.target.value)} placeholder={t('vehicles.color_placeholder', 'White')}
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }} />
              </label>
              <label style={{ fontSize: 13, color: '#475569' }}>
                {t('vehicles.mileage', 'Mileage (km)')}
                <input type="number" min="0" value={modal.form.mileage} onChange={(e) => setField('mileage', e.target.value)} placeholder="45000"
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }} />
              </label>
              <label style={{ fontSize: 13, color: '#475569' }}>
                {t('vehicles.fuel', 'Fuel Type')}
                <select value={modal.form.fuel_type} onChange={(e) => setField('fuel_type', e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  {FUEL_TYPES.map((f) => <option key={f} value={f}>{t(`vehicles.fuel_${f}`, f)}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13, color: '#475569' }}>
                {t('vehicles.transmission', 'Transmission')}
                <select value={modal.form.transmission} onChange={(e) => setField('transmission', e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <option value="automatic">{t('vehicles.trans_automatic', 'Automatic')}</option>
                  <option value="manual">{t('vehicles.trans_manual', 'Manual')}</option>
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1', fontSize: 13, color: '#475569' }}>
                {t('vehicles.notes', 'Notes')}
                <textarea rows={3} value={modal.form.notes} onChange={(e) => setField('notes', e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8, resize: 'vertical' }} />
              </label>
            </div>

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
