import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  RefreshDouble, Search, Plus, Eye, Check, Xmark,
  Package, Clock, WarningCircle, DeliveryTruck,
  ArrowDown, User, Phone, Calendar, EditPencil, MapPin
} from 'iconoir-react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';
import './WarrantyClaims.css';
import { useTranslation } from 'react-i18next';

/* Fix leaflet marker icon paths (Vite) */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const RETURN_REASON_KEYS = {
  'Damaged item': 'damaged_item',
  'Wrong item delivered': 'wrong_item',
  'Item not as described': 'not_as_described',
  'Customer changed mind': 'changed_mind',
  'Defective product': 'defective',
  'Missing parts': 'missing_parts',
  'Duplicate order': 'duplicate_order',
  'Late delivery': 'late_delivery',
  'Other': 'other'
};

const RETURN_REASONS = [
  'Damaged item', 'Wrong item delivered', 'Item not as described',
  'Customer changed mind', 'Defective product', 'Missing parts',
  'Duplicate order', 'Late delivery', 'Other'
];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const emptyForm = {
  work_order_id: '', reason: '', notes: '', pickup_address: '', pickup_date: '',
  pickup_lat: null, pickup_lng: null
};

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

export default function WarrantyClaims() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [returns, setReturns] = useState([]);
  const [orders, setWorkOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderDropdownOpen, setOrderDropdownOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const orderDropRef = useRef(null);

  /* Close order dropdown on outside click */
  useEffect(() => {
    const h = (e) => { if (orderDropRef.current && !orderDropRef.current.contains(e.target)) setOrderDropdownOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [claimsRes, completedRes, failedRes] = await Promise.all([
        api.get(`/warranty-claims${statusFilter ? `?status=${statusFilter}` : ''}`),
        api.get('/work-orders?status=completed&limit=200'),
        api.get('/work-orders?status=failed&limit=200'),
      ]);
      // The API answers under `warrantyClaims`; the other two keys are kept
      // as fallbacks so an older build of the backend still renders.
      setReturns(claimsRes?.warrantyClaims || claimsRes?.returns || claimsRes?.data || []);
      const completed = completedRes?.data || [];
      const failed = (failedRes?.data || []).map(o => ({ ...o, _returnSource: 'failed' }));
      setWorkOrders([...completed, ...failed]);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const stats = useMemo(() => {
    const s = { total: returns.length, requested: 0, approved: 0, in_progress: 0, completed: 0, rejected: 0 };
    returns.forEach(r => {
      if (r.status === 'requested') s.requested++;
      else if (r.status === 'approved' || r.status === 'pickup_scheduled') s.approved++;
      else if (r.status === 'in_progress' || r.status === 'picked_up') s.in_progress++;
      else if (['resolved', 'closed', 'received', 'refunded'].includes(r.status)) s.completed++;
      else if (r.status === 'rejected' || r.status === 'cancelled') s.rejected++;
    });
    return s;
  }, [returns]);

  const filtered = useMemo(() => {
    let list = returns;
    if (activeTab === 'pending') list = list.filter(r => r.status === 'requested');
    else if (activeTab === 'active') list = list.filter(r => ['approved','in_progress','pickup_scheduled','picked_up'].includes(r.status));
    else if (activeTab === 'completed') list = list.filter(r => ['resolved','closed','received','refunded'].includes(r.status));
    else if (activeTab === 'rejected') list = list.filter(r => ['rejected','cancelled'].includes(r.status));
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(r =>
        r.work_order_number?.toLowerCase().includes(s) ||
        r.recipient_name?.toLowerCase().includes(s) ||
        r.reason?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [returns, activeTab, search]);

  const handleSubmit = async () => {
    if (!form.work_order_id || !form.reason) return;
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.pickup_lat) payload.pickup_lat = parseFloat(payload.pickup_lat);
      if (payload.pickup_lng) payload.pickup_lng = parseFloat(payload.pickup_lng);
      const res = await api.post('/warranty-claims', payload);
      if (res?.success) {
        setShowModal(false);
        setForm({ ...emptyForm });
        setSelectedOrder(null);
        setOrderSearch('');
        loadData();
      } else {
        console.error('Return creation failed:', res?.message);
      }
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  /* Filtered orders for dropdown search */
  const filteredWorkOrders = useMemo(() => {
    if (!orderSearch) return orders;
    const s = orderSearch.toLowerCase();
    return orders.filter(o =>
      o.work_order_number?.toLowerCase().includes(s) ||
      o.recipient_name?.toLowerCase().includes(s) ||
      o.recipient_phone?.includes(s)
    );
  }, [orders, orderSearch]);

  /* Select an order from dropdown — auto-fill contact details */
  const selectOrder = (order) => {
    setSelectedOrder(order);
    setForm(f => ({
      ...f,
      work_order_id: order.id,
      pickup_address: order.recipient_address || '',
      pickup_lat: order.recipient_lat || null,
      pickup_lng: order.recipient_lng || null,
      ...(order._returnSource === 'failed' && order.failure_reason ? { reason: order.failure_reason } : {}),
    }));
    setOrderSearch(order.work_order_number + ' — ' + (order.recipient_name || '') + (order._returnSource === 'failed' ? ' (Failed)' : ''));
    setOrderDropdownOpen(false);
  };

  /* Map pin click for pickup address */
  const handleMapPick = async (lat, lng) => {
    setForm(f => ({ ...f, pickup_lat: lat, pickup_lng: lng }));
    // Reverse geocode
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await r.json();
      if (data?.display_name) {
        setForm(f => ({ ...f, pickup_address: data.display_name }));
      }
    } catch { /* ignore */ }
  };

  /* Address search for pickup location */
  const addressTimer = useRef(null);
  const addressDropRef = useRef(null);
  const [addressResults, setAddressResults] = useState([]);
  const [addressDropOpen, setAddressDropOpen] = useState(false);

  useEffect(() => {
    const h = (e) => { if (addressDropRef.current && !addressDropRef.current.contains(e.target)) setAddressDropOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const searchAddress = (val) => {
    setForm(f => ({ ...f, pickup_address: val }));
    clearTimeout(addressTimer.current);
    if (val.length < 3) { setAddressResults([]); return; }
    addressTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&countrycodes=ae&limit=5`);
        const data = await r.json();
        setAddressResults(data);
        setAddressDropOpen(true);
      } catch { setAddressResults([]); }
    }, 400);
  };

  const handleAction = async (id, action) => {
    try {
      await api.patch(`/warranty-claims/${id}/status`, { status: action });
      loadData();
    } catch (err) { console.error(err); }
  };

  const statCards = [
    { label: t('returns.stats.total_returns'), value: stats.total, color: 'primary', bg: '#fff7ed', iconColor: '#f97316', icon: RefreshDouble },
    { label: t('returns.stats.pending'), value: stats.requested, color: 'warning', bg: '#fef3c7', iconColor: '#d97706', icon: Clock },
    { label: t('returns.stats.in_progress'), value: stats.approved + stats.in_progress, color: 'info', bg: '#eff6ff', iconColor: '#2563eb', icon: DeliveryTruck },
    { label: t('returns.stats.completed'), value: stats.completed, color: 'success', bg: '#dcfce7', iconColor: '#16a34a', icon: Check },
    { label: t('returns.stats.rejected'), value: stats.rejected, color: 'danger', bg: '#fee2e2', iconColor: '#ef4444', icon: Xmark },
  ];

  return (
    <div className="ret-page">
      {/* Hero */}
      <div className="module-hero">
        <div className="module-hero-left">
          <div className="module-hero-icon"><RefreshDouble size={26} /></div>
          <div>
            <h1 className="module-hero-title">{t('returns.page_title')}</h1>
            <p className="module-hero-sub">{t("returns.subtitle")}</p>
          </div>
        </div>
        <div className="module-hero-actions">
          <button className="module-btn module-btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> {t('returns.new_return')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="ret-stats-grid">
        {statCards.map((s, i) => (
          <div key={i} className={`ret-stat-card ${s.color}`}>
            <div className="ret-stat-card-row">
              <div className="ret-stat-icon" style={{ background: s.bg }}>
                <s.icon size={22} color={s.iconColor} />
              </div>
              <div className="ret-stat-body">
                <span className="ret-stat-val">{s.value}</span>
                <span className="ret-stat-lbl">{s.label}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="ret-tabs">
        {[
          { key: 'all', label: t('returns.tabs.all'), count: stats.total },
          { key: 'pending', label: t('returns.tabs.pending'), count: stats.requested },
          { key: 'active', label: t('returns.tabs.in_progress'), count: stats.approved + stats.in_progress },
          { key: 'completed', label: t('returns.tabs.completed'), count: stats.completed },
          { key: 'rejected', label: t('returns.tabs.rejected'), count: stats.rejected },
        ].map(tab => (
          <button key={tab.key} className={`ret-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
            <span className="ret-tab-badge">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="ret-filters">
        <div className="ret-search-wrap">
          <Search size={16} className="ret-search-icon" />
          <input className="ret-search-input" placeholder={t("returns.search_placeholder")}
                 value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="ret-spinner" />
      ) : filtered.length === 0 ? (
        <div className="ret-empty">
          <div className="ret-empty-icon"><RefreshDouble size={28} /></div>
          <h3 className='text-center' style={{textAlign: 'center'}} >{t("returns.no_returns")}</h3>
          <p className='text-center' style={{textAlign: 'center'}}>{t("returns.no_results")}</p>
        </div>
      ) : (
        <div className="ret-table-wrap">
          <table className="ret-table">
            <thead>
              <tr>
                <th>{t("returns.return_id")}</th>
                <th>{t("returns.col.order_num")}</th>
                <th>{t("returns.customer")}</th>
                <th>{t("returns.col.reason")}</th>
                <th>{t("returns.col.status")}</th>
                <th>{t("returns.col.requested")}</th>
                <th>{t("returns.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ret => (
                <tr key={ret.id} onClick={() => setShowDetail(ret)}>
                  <td style={{ fontWeight: 700, color: '#f97316', fontFamily: 'monospace' }}>
                    RET-{String(ret.id).padStart(4, '0')}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600, color: '#1e293b' }}>
                    {ret.orig_work_order_number || ret.work_order_number || `#${ret.work_order_id}`}
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>{ret.customer_name || ret.recipient_name || '—'}</span>
                  </td>
                  <td>
                    <span className="ret-reason-tag">{RETURN_REASON_KEYS[ret.reason] ? t('returns.reasons.' + RETURN_REASON_KEYS[ret.reason]) : ret.reason}</span>
                  </td>
                  <td>
                    <span className={`ret-status ${ret.status}`}>
                      <span className="ret-status-dot" />
                      {t('returns.status_labels.' + ret.status)}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                    {formatDate(ret.created_at)}
                  </td>
                  <td>
                    <div className="ret-actions" onClick={e => e.stopPropagation()}>
                      <button className="ret-action-btn" onClick={() => setShowDetail(ret)} title={t("common.view")}>
                        <Eye size={14} />
                      </button>
                      {ret.status === 'requested' && (
                        <>
                          <button className="ret-action-btn approve" onClick={() => handleAction(ret.id, 'approved')} title={t("returns.approve")}>
                            <Check size={14} />
                          </button>
                          <button className="ret-action-btn reject" onClick={() => handleAction(ret.id, 'rejected')} title={t("returns.reject")}>
                            <Xmark size={14} />
                          </button>
                        </>
                      )}
                      {ret.status === 'approved' && (
                        <button className="ret-action-btn approve" onClick={() => handleAction(ret.id, 'pickup_scheduled')} title={t("returns.schedule_pickup")}>
                          <DeliveryTruck size={14} />
                        </button>
                      )}
                      {ret.status === 'pickup_scheduled' && (
                        <button className="ret-action-btn approve" onClick={() => handleAction(ret.id, 'picked_up')} title={t("returns.mark_picked_up")}>
                          <Package size={14} />
                        </button>
                      )}
                      {ret.status === 'picked_up' && (
                        <button className="ret-action-btn approve" onClick={() => handleAction(ret.id, 'received')} title={t("returns.mark_received")}>
                          <Check size={14} />
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

      {/* New Return Modal */}
      {showModal && (
        <div className="ret-modal-overlay" onClick={() => { setShowModal(false); setSelectedOrder(null); setOrderSearch(''); }}>
          <div className="ret-modal ret-modal-large" onClick={e => e.stopPropagation()}>
            <div className="ret-modal-header">
              <h3><RefreshDouble size={18} /> {t('returns.modal.new_title')}</h3>
              <button className="ret-modal-close" onClick={() => { setShowModal(false); setSelectedOrder(null); setOrderSearch(''); }}><Xmark size={16} /></button>
            </div>
            <div className="ret-modal-body" style={{ overflowY: 'auto', maxHeight: '65vh' }}>
              <div className="ret-form-grid">

                {/* Searchable WorkOrder Dropdown */}
                <div className="ret-form-group span-2" ref={orderDropRef} style={{ position: 'relative' }}>
                  <label className="ret-form-label">{t('returns.form.order')}</label>
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', [isRTL ? 'right' : 'left']: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                      className="ret-form-input"
                      style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: 36 }}
                      placeholder={t('returns.form.search_order')}
                      value={orderSearch}
                      onChange={e => { setOrderSearch(e.target.value); setOrderDropdownOpen(true); if (!e.target.value) { setSelectedOrder(null); setForm(f => ({ ...f, work_order_id: '' })); } }}
                      onFocus={() => setOrderDropdownOpen(true)}
                    />
                  </div>
                  {orderDropdownOpen && filteredWorkOrders.length > 0 && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderRadius: 10,
                      boxShadow: '0 8px 30px rgba(0,0,0,0.15)', border: '1px solid #e2e8f0', zIndex: 50,
                      maxHeight: 200, overflowY: 'auto', marginTop: 4
                    }}>
                      {filteredWorkOrders.map(o => (
                        <div key={o.id} onClick={() => selectOrder(o)}
                          style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f8fafc', fontSize: 13 }}
                          onMouseOver={e => e.currentTarget.style.background = '#f8fafc'}
                          onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                          <div style={{ fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                            {o.work_order_number}
                            {o._returnSource === 'failed' && (
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#fee2e2', color: '#dc2626' }}>FAILED</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, display: 'flex', gap: 12 }}>
                            <span><User size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />{o.recipient_name || '—'}</span>
                            <span><Phone size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />{o.recipient_phone || '—'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Contact Details Card (auto-populated from selected order) */}
                {selectedOrder && (
                  <div className="span-2" style={{
                    background: '#f8fafc', borderRadius: 12, padding: '14px 18px', border: '1px solid #e2e8f0',
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13
                  }}>
                    <div>
                      <span style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', fontWeight: 700 }}>{t('returns.detail.customer')}</span>
                      <div style={{ fontWeight: 600, color: '#1e293b', marginTop: 2 }}>{selectedOrder.recipient_name || '—'}</div>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', fontWeight: 700 }}>{t('returns.detail.phone')}</span>
                      <div style={{ fontWeight: 600, color: '#1e293b', marginTop: 2 }}>{selectedOrder.recipient_phone || '—'}</div>
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                      <span style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', fontWeight: 700 }}>{t('returns.detail.address')}</span>
                      <div style={{ fontWeight: 600, color: '#1e293b', marginTop: 2 }}>{selectedOrder.recipient_address || '—'}</div>
                    </div>
                  </div>
                )}

                {/* Reason */}
                <div className="ret-form-group span-2">
                  <label className="ret-form-label">{t('returns.form.reason')}</label>
                  <select className="ret-form-select" value={form.reason}
                          onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
                    <option value="">{t('returns.form.select_reason')}</option>
                    {RETURN_REASONS.map(r => (
                      <option key={r} value={r}>{t('returns.reasons.' + RETURN_REASON_KEYS[r])}</option>
                    ))}
                  </select>
                </div>

                {/* Pickup Address Search */}
                <div className="ret-form-group span-2" ref={addressDropRef} style={{ position: 'relative' }}>
                  <label className="ret-form-label"><MapPin size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{t('returns.pickup_address')}</label>
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', [isRTL ? 'right' : 'left']: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input className="ret-form-input"
                      style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: 36 }}
                      placeholder={t('returns.address_placeholder')}
                      value={form.pickup_address}
                      onChange={e => searchAddress(e.target.value)}
                      onFocus={() => addressResults.length && setAddressDropOpen(true)}
                    />
                  </div>
                  {addressDropOpen && addressResults.length > 0 && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderRadius: 10,
                      boxShadow: '0 8px 30px rgba(0,0,0,0.15)', border: '1px solid #e2e8f0', zIndex: 50,
                      maxHeight: 180, overflowY: 'auto', marginTop: 4
                    }}>
                      {addressResults.map((r, i) => (
                        <div key={i} onClick={() => {
                          setForm(f => ({ ...f, pickup_address: r.display_name, pickup_lat: parseFloat(r.lat), pickup_lng: parseFloat(r.lon) }));
                          setAddressDropOpen(false);
                        }}
                          style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f8fafc', fontSize: 13, color: '#1e293b' }}
                          onMouseOver={e => e.currentTarget.style.background = '#f8fafc'}
                          onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                          <div style={{ fontWeight: 600 }}>{r.display_name.split(',')[0]}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{r.display_name.split(',').slice(1, 3).join(',')}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Map Picker */}
                <div className="ret-form-group span-2">
                  <label className="ret-form-label" style={{ fontSize: 11, color: '#94a3b8' }}>
                    {t('returns.tap_to_pick')}
                  </label>
                  <div style={{ borderRadius: 12, overflow: 'hidden', border: '1.5px solid #e2e8f0', height: 200, position: 'relative' }}>
                    <MapContainer
                      center={form.pickup_lat && form.pickup_lng ? [form.pickup_lat, form.pickup_lng] : [25.2048, 55.2708]}
                      zoom={form.pickup_lat ? 15 : 11}
                      style={{ height: '100%', width: '100%' }}
                      scrollWheelZoom={true}
                      doubleClickZoom={false}
                      attributionControl={false}
                    >
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      <ClickHandler onClick={(latlng) => handleMapPick(latlng.lat, latlng.lng)} />
                      {form.pickup_lat && form.pickup_lng && <FlyTo center={[form.pickup_lat, form.pickup_lng]} />}
                      {form.pickup_lat && form.pickup_lng && <Marker position={[form.pickup_lat, form.pickup_lng]} />}
                    </MapContainer>
                    {form.pickup_lat && form.pickup_lng && (
                      <div style={{
                        position: 'absolute', bottom: 8, [isRTL ? 'right' : 'left']: 8,
                        background: 'rgba(0,0,0,.7)', color: '#fff', borderRadius: 6,
                        padding: '4px 10px', fontSize: 11, fontWeight: 600, zIndex: 999, backdropFilter: 'blur(4px)'
                      }}>
                        {parseFloat(form.pickup_lat).toFixed(5)}, {parseFloat(form.pickup_lng).toFixed(5)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Pickup Date */}
                <div className="ret-form-group">
                  <label className="ret-form-label">{t('returns.preferred_date')}</label>
                  <input type="date" className="ret-form-input" value={form.pickup_date}
                         onChange={e => setForm(f => ({ ...f, pickup_date: e.target.value }))} />
                </div>

                {/* Notes */}
                <div className="ret-form-group span-2">
                  <label className="ret-form-label">{t('returns.form.notes')}</label>
                  <textarea className="ret-form-textarea" placeholder={t('returns.notes_placeholder')}
                            value={form.notes}
                            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="ret-modal-footer">
              <button className="ret-btn-secondary" onClick={() => { setShowModal(false); setSelectedOrder(null); setOrderSearch(''); }}>{t('common.cancel')}</button>
              <button className="ret-btn-primary" onClick={handleSubmit} disabled={saving || !form.work_order_id || !form.reason}>
                {saving ? t('returns.submitting') : <><Plus size={14} /> {t('returns.submit')}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetail && (
        <div className="ret-modal-overlay" onClick={() => setShowDetail(null)}>
          <div className="ret-modal" onClick={e => e.stopPropagation()}>
            <div className="ret-modal-header">
              <h3><Eye size={18} /> {t('returns.modal.detail_title')}</h3>
              <button className="ret-modal-close" onClick={() => setShowDetail(null)}><Xmark size={16} /></button>
            </div>
            <div className="ret-modal-body">
              <div className="ret-detail-grid">
                <div className="ret-detail-item">
                  <div className="ret-detail-label">{t("returns.return_id")}</div>
                  <div className="ret-detail-value" style={{ color: '#f97316', fontFamily: 'monospace' }}>RET-{String(showDetail.id).padStart(4, '0')}</div>
                </div>
                <div className="ret-detail-item">
                  <div className="ret-detail-label">{t('returns.detail.status')}</div>
                  <div className="ret-detail-value">
                    <span className={`ret-status ${showDetail.status}`}>
                      <span className="ret-status-dot" />
                      {t('returns.status_labels.' + showDetail.status)}
                    </span>
                  </div>
                </div>
                <div className="ret-detail-item">
                  <div className="ret-detail-label">{t('returns.detail.order')}</div>
                  <div className="ret-detail-value" style={{ fontFamily: 'monospace' }}>{showDetail.work_order_number || `#${showDetail.work_order_id}`}</div>
                </div>
                <div className="ret-detail-item">
                  <div className="ret-detail-label">{t("returns.customer")}</div>
                  <div className="ret-detail-value">{showDetail.recipient_name || '—'}</div>
                </div>
                <div className="ret-detail-item ret-detail-wide">
                  <div className="ret-detail-label">{t('returns.detail.reason')}</div>
                  <div className="ret-detail-value">{RETURN_REASON_KEYS[showDetail.reason] ? t('returns.reasons.' + RETURN_REASON_KEYS[showDetail.reason]) : showDetail.reason}</div>
                </div>
                {showDetail.notes && (
                  <div className="ret-detail-item ret-detail-wide">
                    <div className="ret-detail-label">{t('returns.detail.notes')}</div>
                    <div className="ret-detail-value" style={{ fontSize: 13, fontWeight: 400 }}>{showDetail.notes}</div>
                  </div>
                )}
                {showDetail.pickup_address && (
                  <div className="ret-detail-item ret-detail-wide">
                    <div className="ret-detail-label">{t("returns.pickup_address")}</div>
                    <div className="ret-detail-value" style={{ fontSize: 13 }}>{showDetail.pickup_address}</div>
                  </div>
                )}
                <div className="ret-detail-item">
                  <div className="ret-detail-label">{t('returns.detail.requested')}</div>
                  <div className="ret-detail-value" style={{ fontSize: 12 }}>{formatDate(showDetail.created_at)}</div>
                </div>
                {showDetail.resolved_at && (
                  <div className="ret-detail-item">
                    <div className="ret-detail-label">{t('returns.detail.resolved')}</div>
                    <div className="ret-detail-value" style={{ fontSize: 12 }}>{formatDate(showDetail.resolved_at)}</div>
                  </div>
                )}
              </div>
            </div>
            <div className="ret-modal-footer">
              <button className="ret-btn-secondary" onClick={() => setShowDetail(null)}>{t("common.close")}</button>
              {showDetail.status === 'requested' && (
                <>
                  <button className="ret-btn-danger" onClick={() => { handleAction(showDetail.id, 'rejected'); setShowDetail(null); }}>
                    <Xmark size={14} /> {t('returns.reject')}
                  </button>
                  <button className="ret-btn-success" onClick={() => { handleAction(showDetail.id, 'approved'); setShowDetail(null); }}>
                    <Check size={14} /> {t('returns.approve')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
