import { useState, useEffect, useMemo, useRef, useCallback, useContext } from 'react';
import {
  Plus, MapPin, EditPencil, Trash, Refresh,
  Search, Xmark, NavArrowLeft, Gps,
  DollarCircle, Clock, Weight, Truck,
  WarningTriangle, Globe, ShieldCheck, BoxIso, Map as MapIcon,
  HalfMoon, SunLight, PlanetSat,
} from 'iconoir-react';
import {
  MapContainer, TileLayer, Circle, Marker, Popup, useMap, useMapEvents
} from 'react-leaflet';
import L from 'leaflet';
import { MARKER_ICONS } from '../components/LocationPicker';
import api from '../lib/api';
import Toast, { useToast } from '../components/Toast';
import 'leaflet/dist/leaflet.css';
import './CRMPages.css';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { getRegions, getRegionLabel, getCountryCenter } from '../lib/regions';

// EMIRATES removed — now using getRegions(workshop.country) from lib/regions.js
const ZONE_COLORS = ['#3b82f6','#f97316','#22c55e','#8b5cf6','#3bb4e8','#14b8a6','#f43f5e','#eab308'];

/* ── Tile providers (street / satellite / dark / light) ──── */
const TILE_PROVIDERS = {
  street:    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                                                 label: 'Street',    Icon: MapIcon },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',     label: 'Satellite', Icon: PlanetSat },
  light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',                                     label: 'Light',     Icon: SunLight  },
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',                                      label: 'Dark',      Icon: HalfMoon  },
};

/* Floating tile-type switcher (top-right of each map) */
function TileSwitcher({ value, onChange }) {
  return (
    <div className="service_bays-tile-switcher" onClick={e => e.stopPropagation()}>
      {Object.entries(TILE_PROVIDERS).map(([key, t]) => (
        <button
          key={key}
          type="button"
          className={`service_bays-tile-btn ${value === key ? 'active' : ''}`}
          onClick={() => onChange(key)}
          title={t.label}
          aria-pressed={value === key}
        >
          <t.Icon width={14} height={14} />
          <span className="service_bays-tile-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

const EMPTY_FORM = {
  name:'', city:'', emirate:'', base_service_fee:'',
  extra_km_fee:'', max_weight_kg:'', estimated_minutes:'',
  is_active:true, color:'#3b82f6', notes:'',
  center_lat:null, center_lng:null, radius:5000,
};

/* ── Helpers ─────────────────────────────────────────────────── */
const pf = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const hasCoords = (lat, lng) => pf(lat) !== null && pf(lng) !== null;

/* ── Icons ───────────────────────────────────────────────────── */
const myLocIcon = L.divIcon({
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 4px rgba(59,130,246,0.25),0 2px 8px rgba(0,0,0,0.2)"></div>',
  iconSize:[16,16], iconAnchor:[8,8], className:'custom-map-marker',
});

/* ── Sub-components ──────────────────────────────────────────── */
function FlyTo({ lat, lng, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) map.flyTo([lat, lng], zoom || 13, { duration: 0.6 });
  }, [lat, lng, zoom, map]);
  return null;
}

function ClickHandler({ onClick }) {
  useMapEvents({ click: (e) => onClick(e.latlng) });
  return null;
}

function FitAllServiceBays({ service_bays }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    if (!service_bays || service_bays.length === 0) return;
    const valid = service_bays.filter(z => z.is_active && hasCoords(z.center_lat, z.center_lng));
    if (valid.length === 0) return;
    const bounds = L.latLngBounds(valid.map(z => {
      const r = pf(z.radius) || 5000;
      const lat = pf(z.center_lat);
      const lng = pf(z.center_lng);
      const latOff = r / 111320;
      const lngOff = r / (111320 * Math.cos(lat * Math.PI / 180));
      return [L.latLng(lat - latOff, lng - lngOff), L.latLng(lat + latOff, lng + lngOff)];
    }).flat());
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
      fitted.current = true;
    }
  }, [service_bays, map]);
  return null;
}

/* ── Location search with Nominatim ──────────────────────────── */
function LocationSearch({ onSelect, initialQuery }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => { setQuery(initialQuery || ''); }, [initialQuery]);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const doSearch = useCallback((q) => {
    if (!q || q.length < 3) { setResults([]); setOpen(false); return; }
    clearTimeout(timerRef.current);
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await r.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 350);
  }, []);

  return (
    <div className="loc-search-wrap" ref={wrapRef}>
      <div className="loc-search-bar">
        <Search width={14} height={14} />
        <input type="text" value={query}
          onChange={e => { setQuery(e.target.value); doSearch(e.target.value); }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={t("service_bays.location_placeholder")}
        />
        {loading && <span className="loc-search-spin" />}
        {query && !loading && (
          <button type="button" onClick={() => { setQuery(''); setResults([]); setOpen(false); }}>
            <Xmark width={14} height={14} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="loc-search-list">
          {results.map((item, i) => (
            <li key={i} onClick={() => {
              setQuery(item.display_name.split(',').slice(0, 2).join(', '));
              setOpen(false);
              onSelect({
                lat: parseFloat(item.lat), lng: parseFloat(item.lon),
                address: item.display_name,
                city: item.address?.city || item.address?.town || item.address?.village || '',
                emirate: item.address?.state || '',
              });
            }}>
              <MapPin width={14} height={14} style={{ flexShrink:0, marginTop:2 }} />
              <div>
                <div className="loc-name">{item.display_name.split(',').slice(0, 3).join(', ')}</div>
                <div className="loc-detail">{item.display_name}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
export default function ServiceBays() {
  const { t, i18n } = useTranslation();
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const [service_bays, setServiceBays]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showForm, setShowForm]       = useState(false);
  const [selected, setSelected]       = useState(null);
  const [activeZone, setActiveZone]   = useState(null);
  const [emirateFilter, setEmirateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm]               = useState(EMPTY_FORM);
  const [error, setError]             = useState('');
  const [saving, setSaving]           = useState(false);
  const [myLocation, setMyLocation]   = useState(null);
  const [confirmDlg, setConfirmDlg]   = useState(null);
  const [formTile, setFormTile]       = useState('street');
  const [listTile, setListTile]       = useState('street');
  const { toasts, showToast }         = useToast();

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => setMyLocation([p.coords.latitude, p.coords.longitude]),
        () => {}, { enableHighAccuracy: true, maximumAge: 60000 }
      );
    }
    if (!document.getElementById('leaflet-zoom-spacing')) {
      const style = document.createElement('style');
      style.id = 'leaflet-zoom-spacing';
      style.textContent = '.leaflet-control-zoom { display: flex; flex-direction: column; gap: 8px; } .leaflet-control-zoom-in, .leaflet-control-zoom-out { margin: 0 !important; }';
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => { fetchServiceBays(); }, []);

  const fetchServiceBays = async () => {
    setLoading(true);
    try {
      const r = await api.get('/service-bays');
      if (r.success) setServiceBays(r.data || []);
    } catch (e) { console.error('fetchServiceBays error:', e); }
    finally { setLoading(false); }
  };

  /* ── Form validation ─────────────────────────────────────────── */
  const formCenterLat = pf(form.center_lat);
  const formCenterLng = pf(form.center_lng);
  const formHasCenter = formCenterLat !== null && formCenterLng !== null;
  const canSubmit = !!(form.name && form.emirate && formHasCenter);

  /* ── Submit bay ─────────────────────────────────────────────── */
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!canSubmit) { setError(t('service_bays.validation_error')); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        name: form.name,
        emirate: form.emirate,
        city: form.city || null,
        color: form.color || '#3b82f6',
        notes: form.notes || null,
        is_active: form.is_active !== false,
        center_lat: formCenterLat,
        center_lng: formCenterLng,
        radius: pf(form.radius) || 5000,
        base_service_fee: pf(form.base_service_fee) || 0,
        extra_km_fee: pf(form.extra_km_fee) || 0,
        max_weight_kg: pf(form.max_weight_kg) || null,
        estimated_minutes: pf(form.estimated_minutes) || null,
        polygon: null,
      };
      console.log('ServiceBay payload:', JSON.stringify(payload));
      const res = selected
        ? await api.put(`/service-bays/${selected.id}`, payload)
        : await api.post('/service-bays', payload);
      if (res.success) {
        showToast(selected ? t('service_bays.toast_updated') || 'ServiceBay updated successfully' : t('service_bays.toast_created') || 'ServiceBay created successfully');
        closeForm();
        fetchServiceBays();
      } else {
        setError(res.message || t('service_bays.save_failed'));
        showToast(res.message || t('service_bays.save_failed'), 'error');
      }
    } catch (err) {
      console.error('ServiceBay save error:', err);
      setError(t('service_bays.network_error'));
      showToast(t('service_bays.network_error') || 'Network error', 'error');
    }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    setConfirmDlg({
      message: t('service_bays.delete_confirm') || 'Are you sure you want to delete this bay? This action cannot be undone.',
      onConfirm: async () => {
        setConfirmDlg(null);
        try {
          const res = await api.delete(`/service-bays/${id}`);
          if (res.success) {
            showToast(t('service_bays.toast_deleted') || 'ServiceBay deleted successfully');
            if (activeZone === id) setActiveZone(null);
            fetchServiceBays();
          } else {
            showToast(res.message || 'Failed to delete bay', 'error');
          }
        } catch (e) {
          console.error('Delete error:', e);
          showToast('Failed to delete bay', 'error');
        }
      },
    });
  };

  /* Toggle active — only send is_active + required fields, NOT the full bay */
  const handleToggleActive = async (bay) => {
    try {
      await api.put(`/service-bays/${bay.id}`, {
        name: bay.name,
        emirate: bay.emirate,
        city: bay.city || null,
        color: bay.color || '#3b82f6',
        notes: bay.notes || null,
        is_active: bay.is_active ? false : true,
        center_lat: pf(bay.center_lat),
        center_lng: pf(bay.center_lng),
        radius: pf(bay.radius) || 5000,
        base_service_fee: pf(bay.base_service_fee) || 0,
        extra_km_fee: pf(bay.extra_km_fee) || 0,
        max_weight_kg: pf(bay.max_weight_kg) || null,
        estimated_minutes: pf(bay.estimated_minutes) || null,
        polygon: null,
      });
      showToast(bay.is_active ? (t('service_bays.toast_deactivated') || 'ServiceBay deactivated') : (t('service_bays.toast_activated') || 'ServiceBay activated'));
      fetchServiceBays();
    } catch (e) {
      console.error('Toggle error:', e);
      showToast('Failed to toggle bay status', 'error');
    }
  };

  const openEdit = (z) => {
    setSelected(z);
    setForm({
      name: z.name||'', city: z.city||'', emirate: z.emirate||'Dubai',
      base_service_fee: z.base_service_fee||'', extra_km_fee: z.extra_km_fee||'',
      max_weight_kg: z.max_weight_kg||'', estimated_minutes: z.estimated_minutes||'',
      is_active: z.is_active !== 0 && z.is_active !== false,
      color: z.color||'#3b82f6', notes: z.notes||'',
      center_lat: pf(z.center_lat), center_lng: pf(z.center_lng),
      radius: pf(z.radius) || 5000,
    });
    setError(''); setShowForm(true);
  };

  const openNew = () => { setForm({...EMPTY_FORM}); setSelected(null); setError(''); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setSelected(null); setForm({...EMPTY_FORM}); setError(''); };

  const filtered = useMemo(() => service_bays.filter(z => {
    if (emirateFilter && z.emirate !== emirateFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return z.name?.toLowerCase().includes(q) || z.city?.toLowerCase().includes(q) || z.emirate?.toLowerCase().includes(q);
    }
    return true;
  }), [service_bays, emirateFilter, searchQuery]);

  const activeData = useMemo(() => activeZone ? service_bays.find(z => z.id === activeZone) : null, [service_bays, activeZone]);

  const flyTarget = useMemo(() => {
    if (activeData && hasCoords(activeData.center_lat, activeData.center_lng)) {
      const km = (pf(activeData.radius) || 5000) / 1000;
      const zoom = km > 20 ? 10 : km > 10 ? 11 : km > 5 ? 12 : km > 2 ? 13 : 14;
      return { lat: pf(activeData.center_lat), lng: pf(activeData.center_lng), zoom };
    }
    return null;
  }, [activeData]);

  const handleFormMapClick = async (latlng) => {
    setForm(f => ({ ...f, center_lat: latlng.lat, center_lng: latlng.lng }));
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latlng.lat}&lon=${latlng.lng}&format=json&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const d = await r.json();
      if (d?.address) {
        const city = d.address.city || d.address.town || d.address.village || '';
        const emirate = d.address.state || '';
        setForm(f => ({
          ...f,
          city: city || f.city,
          emirate: getRegions(workshop?.country).find(e => emirate.toLowerCase().includes(e.toLowerCase())) || f.emirate,
        }));
      }
    } catch {}
  };

  const handleLocationSelect = ({ lat, lng, city, emirate }) => {
    setForm(f => ({
      ...f,
      center_lat: lat,
      center_lng: lng,
      city: city || f.city,
      emirate: getRegions(workshop?.country).find(e => (emirate||'').toLowerCase().includes(e.toLowerCase())) || f.emirate,
    }));
  };

  const fmtFee = v => { const n = pf(v); return n && n > 0 ? n.toFixed(0) : '0'; };

  /* ── Summary stats ───────────────────────────────────────────── */
  const stats = useMemo(() => {
    const activeCount = service_bays.filter(z => z.is_active).length;
    const totalMechanics = service_bays.reduce((s, z) => s + (z.mechanic_count || 0), 0);
    const totalWorkOrders = service_bays.reduce((s, z) => s + (z.order_count || 0), 0);
    const uniqueEmirates = new Set(service_bays.map(z => z.emirate)).size;
    return { activeCount, totalMechanics, totalWorkOrders, uniqueEmirates };
  }, [service_bays]);

  const regionLabel = getRegionLabel(workshop?.country, i18n.language);

  /* ═══════════════════════════════════════════════════════════════
     CREATION / EDIT FORM
     ═══════════════════════════════════════════════════════════════ */
  if (showForm) {
    return (
      <div className="page-container">
        {/* Header */}
        <div className="zf-header">
          <button className="zf-back" onClick={closeForm}>
            <NavArrowLeft width={20} height={20} />
          </button>
          <div className="zf-header-text">
            <h2>{selected ? t('service_bays.edit_title') : t('service_bays.create_title')}</h2>
            <p>{t('service_bays.form_subtitle')}</p>
          </div>
          <div className="zf-header-actions">
            <button type="button" className="module-btn module-btn-outline" onClick={closeForm}>{t("service_bays.discard")}</button>
            <button className="module-btn module-btn-primary" onClick={handleSubmit} disabled={saving || !canSubmit}
              title={!canSubmit ? t('service_bays.validation_hint') : ''}>
              {saving ? t('service_bays.saving') : selected ? t('service_bays.save_changes') : t('service_bays.create_btn')}
            </button>
          </div>
        </div>

        {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}

        <div className="zf-layout">
          {/* ── LEFT: Map ── */}
          <div className="zf-map-col">
            <div className="zf-map-search">
              <LocationSearch
                onSelect={handleLocationSelect}
                initialQuery={selected?.name || ''}
              />
            </div>
            <div className="zf-map-wrap">
              <MapContainer
                center={formHasCenter ? [formCenterLat, formCenterLng] : (myLocation || getCountryCenter(workshop?.country, workshop?.company_lat, workshop?.company_lng))}
                zoom={formHasCenter ? 13 : 10}
                style={{ height:'100%', width:'100%', zIndex:1 }}
                scrollWheelZoom={true} attributionControl={false}
              >
                <TileLayer key={formTile} url={TILE_PROVIDERS[formTile].url} maxZoom={19} />
                <ClickHandler onClick={handleFormMapClick} />
                {formHasCenter && <FlyTo lat={formCenterLat} lng={formCenterLng} zoom={13} />}

                {formHasCenter && (
                  <>
                    <Circle
                      center={[formCenterLat, formCenterLng]}
                      radius={pf(form.radius) || 5000}
                      pathOptions={{ color:form.color, fillColor:form.color, fillOpacity:0.18, weight:2.5, dashArray:'6 4' }}
                    />
                    <Marker position={[formCenterLat, formCenterLng]} icon={MARKER_ICONS.bay}>
                      <Popup><strong>{form.name || t('service_bays.zone_center')}</strong></Popup>
                    </Marker>
                  </>
                )}

                {/* Other service_bays faintly */}
                {service_bays.filter(z => !selected || z.id !== selected.id).map((z, i) => {
                  if (!hasCoords(z.center_lat, z.center_lng)) return null;
                  return (
                    <Circle key={z.id}
                      center={[pf(z.center_lat), pf(z.center_lng)]}
                      radius={pf(z.radius) || 5000}
                      pathOptions={{ color: z.color||ZONE_COLORS[i%8], fillColor: z.color||ZONE_COLORS[i%8], fillOpacity:0.08, weight:1.5, opacity:0.35 }}
                    />
                  );
                })}
                {myLocation && <Marker position={myLocation} icon={myLocIcon}><Popup><strong>{t('service_bays.you')}</strong></Popup></Marker>}
              </MapContainer>

              <TileSwitcher value={formTile} onChange={setFormTile} />

              {!formHasCenter && (
                <div className="zf-map-hint">
                  <Gps width={18} height={18} />
                  <span>{t('service_bays.map_hint')}</span>
                </div>
              )}
            </div>

            {/* Radius bar under map */}
            <div className="zf-radius-bar">
              <label>{t("service_bays.radius")}</label>
              <input type="range" min="500" max="50000" step="500"
                value={pf(form.radius) || 5000}
                onChange={e => setForm(f => ({ ...f, radius: parseInt(e.target.value) }))}
                className="radius-slider" />
              <span className="zf-radius-val">{((pf(form.radius) || 5000) / 1000).toFixed(1)} {t('service_bays.km')}</span>
            </div>
          </div>

          {/* ── RIGHT: Compact Form ── */}
          <div className="zf-form-col">
            {/* ServiceBay name + color */}
            <div className="zf-card">
              <div className="zf-card-label">{t('service_bays.form.name')}</div>
              <input required type="text" value={form.name} className="zf-input-lg"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={t("service_bays.zone_name_placeholder")} />
              <div className="zf-color-row">
                {ZONE_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={`zf-color-dot ${form.color === c ? 'selected' : ''}`}
                    style={{ '--dot-color': c }} />
                ))}
              </div>
            </div>

            {/* Location info */}
            <div className="zf-card">
              <div className="zf-row">
                <div className="zf-field">
                  <div className="zf-card-label">{t('service_bays.city')}</div>
                  <input type="text" value={form.city}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder={t("service_bays.auto_detected")} />
                </div>
                <div className="zf-field">
                  <div className="zf-card-label">{regionLabel}</div>
                  {getRegions(workshop?.country).length > 0 ? (
                    <select value={form.emirate} onChange={e => setForm(f => ({ ...f, emirate: e.target.value }))}>
                      <option value="">{t('orders.form.select_region', 'Select...')}</option>
                      {getRegions(workshop?.country).map(em => <option key={em} value={em}>{em}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={form.emirate} onChange={e => setForm(f => ({ ...f, emirate: e.target.value }))}
                      placeholder={regionLabel} />
                  )}
                </div>
              </div>
              {formHasCenter ? (
                <div className="zf-coords">
                  <MapPin width={13} height={13} />
                  <span>{formCenterLat.toFixed(5)}, {formCenterLng.toFixed(5)}</span>
                  <button type="button" onClick={() => setForm(f => ({ ...f, center_lat:null, center_lng:null }))}>{t("common.clear")}</button>
                </div>
              ) : (
                <div className="zf-coords" style={{ background:'#fef3c7', borderColor:'#fbbf24' }}>
                  <Gps width={13} height={13} style={{ color:'#d97706' }} />
                  <span style={{ color:'#92400e' }}>{t('service_bays.no_location_hint')}</span>
                </div>
              )}
            </div>

            {/* ServicePricing */}
            <div className="zf-card">
              <div className="zf-card-title">
                <DollarCircle width={15} height={15} /> {t('service_bays.form.pricing')}
              </div>
              <div className="zf-row">
                <div className="zf-field">
                  <div className="zf-card-label">{t('service_bays.form.base_fee')}</div>
                  <input type="number" min="0" step="0.01" value={form.base_service_fee}
                    onChange={e => setForm(f => ({ ...f, base_service_fee: e.target.value }))} placeholder="25" />
                </div>
                <div className="zf-field">
                  <div className="zf-card-label">{t('service_bays.form.per_km')}</div>
                  <input type="number" min="0" step="0.01" value={form.extra_km_fee}
                    onChange={e => setForm(f => ({ ...f, extra_km_fee: e.target.value }))} placeholder="2.5" />
                </div>
              </div>
              <div className="zf-row">
                <div className="zf-field">
                  <div className="zf-card-label">{t("service_bays.max_weight")}</div>
                  <input type="number" min="0" step="0.1" value={form.max_weight_kg}
                    onChange={e => setForm(f => ({ ...f, max_weight_kg: e.target.value }))} placeholder="50" />
                </div>
                <div className="zf-field">
                  <div className="zf-card-label">{t("service_bays.est_minutes")}</div>
                  <input type="number" min="0" value={form.estimated_minutes}
                    onChange={e => setForm(f => ({ ...f, estimated_minutes: e.target.value }))} placeholder="45" />
                </div>
              </div>
            </div>

            {/* Status + Notes */}
            <div className="zf-card">
              <div className="zf-status-row">
                <button type="button" className={`toggle-switch ${form.is_active ? 'active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}>
                  <span className="toggle-knob" />
                </button>
                <span style={{ fontWeight:600, fontSize:'0.88rem', color: form.is_active ? '#16a34a' : '#94a3b8' }}>
                  {form.is_active ? t('service_bays.active_status') : t('service_bays.inactive_status')}
                </span>
              </div>
              <textarea rows={2} value={form.notes} className="zf-notes"
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={t("service_bays.notes_placeholder")} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     MAIN LIST VIEW
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="page-container">
      {/* ── Hero ── */}
      <div className="module-hero">
        <div className="module-hero-left">
          <div className="module-hero-icon"><MapIcon width={26} height={26} /></div>
          <div>
            <h2 className="module-hero-title">{t('service_bays.title')}</h2>
            <p className="module-hero-sub">{t('service_bays.zones_configured', { count: service_bays.length })}</p>
          </div>
        </div>
        <div className="module-hero-actions">
          <button className="module-btn module-btn-outline" onClick={fetchServiceBays}><Refresh width={15} height={15} /> {t('service_bays.refresh_btn')}</button>
          <button className="module-btn module-btn-primary" onClick={openNew}><Plus width={16} height={16} /> {t('service_bays.add_btn')}</button>
        </div>
      </div>

      {/* ── Summary Stat Cards ── */}
      <div className="service_bays-stat-cards">
        <div className="service_bays-stat-card">
          <div className="service_bays-stat-card-icon" style={{ background: '#eff6ff', color: '#3b82f6' }}><MapPin width={20} height={20} /></div>
          <div><div className="service_bays-stat-card-value">{service_bays.length}</div><div className="service_bays-stat-card-label">{t('service_bays.stats.total') || 'Total ServiceBays'}</div></div>
        </div>
        <div className="service_bays-stat-card">
          <div className="service_bays-stat-card-icon" style={{ background: '#f0fdf4', color: '#22c55e' }}><ShieldCheck width={20} height={20} /></div>
          <div><div className="service_bays-stat-card-value">{stats.activeCount}</div><div className="service_bays-stat-card-label">{t('service_bays.stats.active') || 'Active'}</div></div>
        </div>
        <div className="service_bays-stat-card">
          <div className="service_bays-stat-card-icon" style={{ background: '#fef3c7', color: '#f59e0b' }}><Globe width={20} height={20} /></div>
          <div><div className="service_bays-stat-card-value">{stats.uniqueEmirates}</div><div className="service_bays-stat-card-label">{regionLabel + 's'}</div></div>
        </div>
        <div className="service_bays-stat-card">
          <div className="service_bays-stat-card-icon" style={{ background: '#fce7f3', color: '#3bb4e8' }}><Truck width={20} height={20} /></div>
          <div><div className="service_bays-stat-card-value">{stats.totalMechanics}</div><div className="service_bays-stat-card-label">{t('service_bays.stats.mechanics') || 'Mechanics'}</div></div>
        </div>
        <div className="service_bays-stat-card">
          <div className="service_bays-stat-card-icon" style={{ background: '#f5f3ff', color: '#8b5cf6' }}><BoxIso width={20} height={20} /></div>
          <div><div className="service_bays-stat-card-value">{stats.totalWorkOrders}</div><div className="service_bays-stat-card-label">{t('service_bays.stats.orders') || 'WorkOrders'}</div></div>
        </div>
      </div>

      {/* Filters */}
      <div className="zl-filters">
        <div className="search-box" style={{ maxWidth:220 }}>
          <Search width={14} height={14} className="search-icon" />
          <input type="text" placeholder={t("service_bays.search_placeholder")} value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} className="search-input" />
        </div>
        <div className="zl-chips">
          <button onClick={() => setEmirateFilter('')}
            className={`summary-chip ${!emirateFilter ? 'active' : ''}`}
            style={{ '--chip-color':'#1e3a6b', '--chip-bg':'#eff6ff' }}>{t('service_bays.all_count', { count: service_bays.length })}</button>
          {getRegions(workshop?.country).map(em => {
            const cnt = service_bays.filter(z => z.emirate === em).length;
            if (!cnt) return null;
            return (
              <button key={em} onClick={() => setEmirateFilter(emirateFilter === em ? '' : em)}
                className={`summary-chip ${emirateFilter === em ? 'active' : ''}`}
                style={{ '--chip-color':'#1e3a6b', '--chip-bg':'#eff6ff' }}>{em} ({cnt})</button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="loading-rows">{[1,2,3].map(i => <div key={i} className="skeleton-card" style={{ height:100 }} />)}</div>
      ) : (
        <div className="service_bays-layout">
          {/* LEFT: ServiceBay cards */}
          <div className="service_bays-list-panel">
            {filtered.length === 0 ? (
              <div className="zl-empty">
                <MapPin width={36} height={36} />
                <p>{t("service_bays.no_zones")}</p>
                <button className="module-btn module-btn-primary" onClick={openNew}><Plus width={15} height={15} /> {t('service_bays.add_btn')}</button>
              </div>
            ) : filtered.map((bay, i) => {
              const c = bay.color || ZONE_COLORS[i % 8];
              const isActive = activeZone === bay.id;
              const hasLoc = hasCoords(bay.center_lat, bay.center_lng);
              return (
                <div key={bay.id} className={`zl-card ${isActive ? 'active' : ''} ${!bay.is_active ? 'dim' : ''}`}
                  onClick={() => hasLoc && setActiveZone(isActive ? null : bay.id)}>
                  <div className="zl-card-accent" style={{ background: c }} />
                  <div className="zl-card-body">
                    <div className="zl-card-top">
                      <div>
                        <div className="zl-card-name">{bay.name}</div>
                        <div className="zl-card-sub">
                          {bay.city ? `${bay.city}, ` : ''}{bay.emirate}
                          {bay.radius ? ` \u00b7 ${(pf(bay.radius)/1000).toFixed(1)} km` : ''}
                        </div>
                        {!hasLoc && (
                          <div style={{ fontSize:'0.7rem', color:'#d97706', fontWeight:600, marginTop:2 }}>
                            {'\u26a0'} No location — edit to set coordinates
                          </div>
                        )}
                      </div>
                      <div className="zl-card-right" onClick={e => e.stopPropagation()}>
                        <button className={`toggle-switch sm ${bay.is_active ? 'active' : ''}`}
                          onClick={() => handleToggleActive(bay)}>
                          <span className="toggle-knob" />
                        </button>
                      </div>
                    </div>
                    <div className="zl-card-stats">
                      <div className="zl-stat">
                        <DollarCircle width={12} height={12} />
                        <span>{cur} {fmtFee(bay.base_service_fee)}</span>
                      </div>
                      <div className="zl-stat">
                        <Truck width={12} height={12} />
                        <span>{t('service_bays.mechanic_count', { count: bay.mechanic_count || 0 })}</span>
                      </div>
                      <div className="zl-stat">
                        <BoxIso width={12} height={12} />
                        <span>{(bay.order_count || 0)} orders</span>
                      </div>
                      {pf(bay.extra_km_fee) > 0 && (
                        <div className="zl-stat">
                          <MapPin width={12} height={12} />
                          <span>{t('service_bays.per_km_suffix', { fee: fmtFee(bay.extra_km_fee) })}</span>
                        </div>
                      )}
                    </div>
                    <div className="zl-card-actions" onClick={e => e.stopPropagation()}>
                      <button onClick={() => openEdit(bay)}>
                        <EditPencil width={12} height={12} /> {t('service_bays.edit_btn')}
                      </button>
                      <button className="danger" onClick={() => handleDelete(bay.id)}>
                        <Trash width={12} height={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT: Map */}
          <div className="service_bays-map-panel">
            <MapContainer center={myLocation || getCountryCenter(workshop?.country, workshop?.company_lat, workshop?.company_lng)} zoom={9}
              style={{ height:'100%', width:'100%', zIndex:1 }}
              scrollWheelZoom={true} attributionControl={false}>
              <TileLayer key={listTile} url={TILE_PROVIDERS[listTile].url} maxZoom={19} />
              {flyTarget && <FlyTo lat={flyTarget.lat} lng={flyTarget.lng} zoom={flyTarget.zoom} />}
              <FitAllServiceBays service_bays={service_bays} />

              {service_bays.map((z, i) => {
                if (!z.is_active || !hasCoords(z.center_lat, z.center_lng)) return null;
                const lat = pf(z.center_lat);
                const lng = pf(z.center_lng);
                const rad = pf(z.radius) || 5000;
                const col = z.color || ZONE_COLORS[i % 8];
                const act = activeZone === z.id;
                return (
                  <Circle key={`circle-${z.id}`}
                    center={[lat, lng]}
                    radius={rad}
                    pathOptions={{
                      color: col, fillColor: col,
                      fillOpacity: act ? 0.3 : 0.18,
                      weight: act ? 3.5 : 2,
                      opacity: act ? 1 : 0.8,
                    }}
                    eventHandlers={{ click: () => setActiveZone(z.id) }}
                  >
                    <Popup>
                      <div className="map-popup">
                        <strong>{z.name}</strong>
                        <div className="popup-detail">{z.emirate} &bull; {cur} {fmtFee(z.base_service_fee)} &bull; {(rad/1000).toFixed(1)} {t('service_bays.km')}</div>
                      </div>
                    </Popup>
                  </Circle>
                );
              })}

              {service_bays.map(z => {
                if (!z.is_active || !hasCoords(z.center_lat, z.center_lng)) return null;
                return (
                  <Marker key={`marker-${z.id}`}
                    position={[pf(z.center_lat), pf(z.center_lng)]}
                    icon={MARKER_ICONS.bay}
                    eventHandlers={{ click: () => setActiveZone(z.id) }}>
                    <Popup>
                      <div className="map-popup">
                        <strong>{z.name}</strong>
                        <div className="popup-detail">{z.emirate}</div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {myLocation && <Marker position={myLocation} icon={myLocIcon}><Popup><strong>{t("service_bays.your_location")}</strong></Popup></Marker>}
            </MapContainer>

            <TileSwitcher value={listTile} onChange={setListTile} />
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      <Toast toasts={toasts} />

      {/* ── Confirm Dialog ── */}
      {confirmDlg && (
        <ConfirmDialog
          message={confirmDlg.message}
          onConfirm={confirmDlg.onConfirm}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
    </div>
  );
}

/* ── Confirm Dialog ── */
function ConfirmDialog({ message, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 1100, padding: 20,
        animation: 'zonesFadeIn 0.2s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: '28px 24px',
          maxWidth: 400, width: '100%',
          boxShadow: '0 24px 80px rgba(0,0,0,0.18)',
          animation: 'zonesSlideUp 0.3s ease',
          textAlign: 'center',
        }}
      >
        <div style={{
          width: 52, height: 52, borderRadius: 14, background: '#fee2e2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <WarningTriangle width={24} height={24} color="#ef4444" />
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: '#1e293b' }}>
          {t('service_bays.confirm_title') || 'Confirm Delete'}
        </h3>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '11px 18px', borderRadius: 10,
            border: '1px solid #e2e8f0', background: '#fff',
            color: '#64748b', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.2s',
          }}>
            {t('common.cancel') || 'Cancel'}
          </button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: '11px 18px', borderRadius: 10,
            border: 'none', background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', boxShadow: '0 2px 8px rgba(239,68,68,0.3)',
            transition: 'all 0.2s',
          }}>
            {t('common.delete') || 'Delete'}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes zonesFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes zonesSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
    </div>
  );
}
