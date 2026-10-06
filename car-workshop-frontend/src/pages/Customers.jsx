import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Group, User, Search, EditPencil, Trash, Plus,
  Mail, Phone, Building, MapPin, Download, NavArrowRight, NavArrowLeft,
  WarningTriangle, Xmark, CheckCircle, Package, DeliveryTruck,
  StatsUpSquare, Wallet, Filter, Eye, Clock,
} from 'iconoir-react';
import api from '../lib/api';
import { CAR_CATALOG, CAR_MAKES } from '../lib/carCatalog';
import { TableSkeleton } from '../components/Loader';
import { shareViaWhatsApp, buildCustomerMessage } from '../lib/whatsapp';
import Toast, { useToast } from '../components/Toast';
import PhoneInputShared from '../components/PhoneInput';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { downloadCsv, toCsv, csvCell } from '../utils/csv';

/* ── WhatsApp SVG Icon ── */
const WhatsAppIcon = ({ width = 16, height = 16, color = 'currentColor' }) => (
  <svg width={width} height={height} viewBox="0 0 24 24" fill={color}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const TYPE_META = {
  individual: { bg: '#fef3c7', color: '#d97706', label: 'Retail / Individual', desc: 'Walk-in cash or card payment' },
  corporate:  { bg: '#ede9fe', color: '#7c3aed', label: 'Corporate / Credit',  desc: 'B2B with credit facility & trade licence' },
  insurance:  { bg: '#dbeafe', color: '#1d4ed8', label: 'Insurance',           desc: 'Insurer as primary payer' },
  fleet:      { bg: '#dcfce7', color: '#16a34a', label: 'Fleet / Internal',    desc: 'Group fleet via coordinator' },
  other:      { bg: '#f1f5f9', color: '#475569', label: 'Other',               desc: 'Other customer arrangement' },
};

const CATEGORIES = ['mechanical','body_paint','electrical','tyres','ac_service','inspection','other'];
const STATUS_COLORS = {
  pending:'#f59e0b', confirmed:'#3b82f6', assigned:'#8b5cf6', picked_up:'#06b6d4',
  in_transit:'#f97316', delivered:'#16a34a', failed:'#dc2626', returned:'#6b7280',
};
const INPUT = { width:'100%', padding:'10px 13px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:14, boxSizing:'border-box', outline:'none' };
const LABEL = { display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.04em' };
const LIMIT = 10;
const emptyForm = {
  full_name:'', company_name:'', email:'', phone:'', phone_alt:'',
  type:'individual', customer_category:'other',
  emirates_id:'', trade_licence:'', tax_registration:'', commercial_registration:'',
  insurer_name:'', insurer_contact:'', fleet_coordinator:'',
  address_line1:'', area:'', city:'', emirate:'',
  service_bay_id:'', latitude:'', longitude:'',
  credit_limit:'', notes:'', is_active:true,
};
const EMPTY_VEHICLE = { make:'', model:'', year:'', plate_number:'', vin:'', color:'', mileage:'', fuel_type:'petrol', transmission:'automatic' };
const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'lpg'];

/* ── Helpers ── */
function Avatar({ name, size = 44 }) {
  const initials = name?.split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()).join('') || '?';
  const hue = (name?.charCodeAt(0)||0) % 360;
  return (
    <div style={{ width:size, height:size, borderRadius:'50%',
      background:`hsl(${hue},55%,46%)`,
      color:'#fff', fontWeight:700, fontSize:size*0.36, flexShrink:0,
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      {initials}
    </div>
  );
}

function KPICard({ icon: Icon, label, value, sub, color }) {
  return (
    <div style={{ background:'#fff', borderRadius:16, padding:'20px 22px', flex:1, minWidth:155,
      boxShadow:'0 1px 4px rgba(0,0,0,0.08)', borderTop:`3px solid ${color}` }}>
      <div style={{ width:38, height:38, borderRadius:10, background:color+'18',
        display:'flex', alignItems:'center', justifyContent:'center', marginBottom:12 }}>
        <Icon width={21} height={21} color={color} strokeWidth={1.8} />
      </div>
      <div style={{ fontSize:30, fontWeight:900, color:'#1e293b', lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:13, color:'#64748b', marginTop:5, fontWeight:500 }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function StatusPill({ active }) {
  const { t } = useTranslation();
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5,
      background:active?'#dcfce7':'#fee2e2', color:active?'#16a34a':'#dc2626',
      padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:700 }}>
      <span style={{ width:7, height:7, borderRadius:'50%', background:active?'#16a34a':'#dc2626', display:'inline-block' }} />
      {active ? t('customers.status.active') : t('customers.status.inactive')}
    </span>
  );
}

/* ── Step indicator ── */
function StepBar({ current, steps }) {
  return (
    <div style={{ display:'flex', alignItems:'center', padding:'26px 32px 0', position:'relative' }}>
      {/* Connector track — full-width background rail + a proportional green fill */}
      <div style={{ position:'absolute', top:46, left:32+20, right:32+20, height:3, background:'#eef2f7', borderRadius:99, zIndex:0 }} />
      <div style={{
        position:'absolute', top:46, left:32+20, height:3, borderRadius:99, zIndex:0,
        width: `calc((100% - ${2*(32+20)}px) * ${Math.max(0, Math.min(1, (current-1)/(steps.length-1)))})`,
        background:'linear-gradient(90deg,#16a34a,#22c55e)', transition:'width 0.35s ease',
      }} />

      <div style={{ display:'flex', width:'100%', position:'relative', zIndex:1 }}>
        {steps.map((s) => {
          const done   = current > s.num;
          const active = current === s.num;
          return (
            <div key={s.num} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center' }}>
              <div style={{
                width:40, height:40, borderRadius:'50%', fontWeight:800, fontSize:15,
                display:'flex', alignItems:'center', justifyContent:'center',
                background: done ? 'linear-gradient(135deg,#22c55e,#16a34a)'
                          : active ? 'linear-gradient(135deg,#fb923c,#f97316)' : '#fff',
                border: done||active ? 'none' : '2px solid #e2e8f0',
                color: done||active?'#fff':'#94a3b8',
                boxShadow: active ? '0 4px 14px rgba(249,115,22,0.35), 0 0 0 5px rgba(249,115,22,0.14)'
                          : done ? '0 3px 10px rgba(22,163,74,0.25)' : 'none',
                transform: active ? 'scale(1.06)' : 'scale(1)',
                transition:'all 0.25s' }}>
                {done ? <CheckCircle width={19} height={19} /> : s.num}
              </div>
              <div style={{ marginTop:9, fontSize:12.5, fontWeight:active?700:600,
                color:active?'#f97316':done?'#16a34a':'#94a3b8',
                whiteSpace:'nowrap', textAlign:'center', letterSpacing:'0.01em' }}>
                {s.title}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}



/* ── Nominatim address search dropdown ── */
function AddressSearch({ onSelect }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef(null);
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = (val) => {
    setQ(val);
    clearTimeout(timer.current);
    if (!val.trim() || val.length < 3) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&addressdetails=1&limit=6`, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch { setResults([]); }
      setLoading(false);
    }, 400);
  };

  const pick = (item) => {
    onSelect({
      lat: parseFloat(item.lat).toFixed(7),
      lng: parseFloat(item.lon).toFixed(7),
      display: item.display_name,
      address: item.address,
    });
    setQ(item.display_name.split(',').slice(0,2).join(','));
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position:'relative', gridColumn:'1/-1', marginBottom:4 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.04em' }}>
        {t('customers.search_location')}
      </label>
      <div style={{ position:'relative' }}>
        <input
          value={q}
          onChange={e => search(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={t("customers.search_address_placeholder")}
          style={{ width:'100%', padding:'10px 36px 10px 13px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:14, boxSizing:'border-box', outline:'none' }}
        />
        <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', color:'#94a3b8', pointerEvents:'none' }}>
          {loading ? <Clock width={14} height={14} strokeWidth={2} /> : <Search width={14} height={14} strokeWidth={2} />}
        </div>
        {q && (
          <button type="button" onClick={() => { setQ(''); setResults([]); setOpen(false); }}
            style={{ position:'absolute', right:30, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, padding:0, lineHeight:1 }}>
            ×
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:2000, background:'#fff',
          borderRadius:12, boxShadow:'0 8px 32px rgba(0,0,0,0.15)', border:'1px solid #e2e8f0', marginTop:4, maxHeight:260, overflowY:'auto' }}>
          {results.map((r, i) => {
            const title = [r.address?.road, r.address?.suburb, r.address?.city || r.address?.town].filter(Boolean).join(', ') || r.display_name.split(',')[0];
            const sub = r.display_name;
            return (
              <button key={i} type="button" onClick={() => pick(r)}
                style={{ display:'flex', alignItems:'flex-start', gap:10, width:'100%', padding:'11px 14px', border:'none', background:'none',
                  cursor:'pointer', textAlign: isRTL ? 'right' : 'left', borderBottom: i < results.length-1 ? '1px solid #f1f5f9':'none' }}
                onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background='none'}>
                <span style={{ color:'#f97316', flexShrink:0, marginTop:2 }}><MapPin width={14} height={14} /></span>
                <div>
                  <div style={{ fontWeight:600, fontSize:13, color:'#1e293b' }}>{title}</div>
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:480 }}>{sub}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Tiny Leaflet location picker (CDN-injected) ── */
function LocationPickerMap({ lat, lng, onPick }) {
  const divRef = React.useRef(null);
  const mapObj = React.useRef(null);

  React.useEffect(() => {
    const initMap = () => {
      if (mapObj.current || !divRef.current) return;
      const L = window.L;
      const center = (lat && lng) ? [parseFloat(lat), parseFloat(lng)] : [25.2048, 55.2708];
      const map = L.map(divRef.current, { zoomControl: true }).setView(center, 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM', maxZoom: 19,
      }).addTo(map);
      const icon = L.divIcon({ html: '<div style="width:22px;height:22px;background:#f97316;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>', className:'', iconAnchor:[11,11] });
      const marker = L.marker(center, { draggable: true, icon }).addTo(map);
      marker.on('dragend', e => { const p = e.target.getLatLng(); onPick(p.lat.toFixed(7), p.lng.toFixed(7)); });
      map.on('click', e => { marker.setLatLng(e.latlng); onPick(e.latlng.lat.toFixed(7), e.latlng.lng.toFixed(7)); });
      mapObj.current = { map, marker };
    };

    if (!document.getElementById('lf-css')) {
      const l = document.createElement('link'); l.id='lf-css'; l.rel='stylesheet';
      l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l);
    }
    if (!document.getElementById('lf-zoom-spacing')) {
      const s = document.createElement('style'); s.id='lf-zoom-spacing';
      s.textContent = '.leaflet-control-zoom { display: flex; flex-direction: column; gap: 8px; } .leaflet-control-zoom-in, .leaflet-control-zoom-out { margin: 0 !important; }';
      document.head.appendChild(s);
    }
    if (window.L) { initMap(); }
    else {
      const s = document.createElement('script'); s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = initMap; document.head.appendChild(s);
    }
    return () => { if (mapObj.current) { mapObj.current.map.remove(); mapObj.current = null; } };
  }, []);

  React.useEffect(() => {
    if (!mapObj.current || !lat || !lng) return;
    const { map, marker } = mapObj.current;
    const pos = [parseFloat(lat), parseFloat(lng)];
    marker.setLatLng(pos); map.setView(pos, 14, { animate: true });
  }, [lat, lng]);

  return <div ref={divRef} style={{ height:200, borderRadius:10, border:'1px solid #e2e8f0', marginTop:8, background:'#f1f5f9' }} />;
}

/* ── Main component ── */
export default function Customers() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const navigate = useNavigate();
  const [customers,       setCustomers]       = useState([]);
  const [stats,         setStats]         = useState({ total: 0, active: 0, business: 0, fleet: 0, total_work_orders: 0 });
  const [loading,       setLoading]       = useState(true);
  const [total,         setTotal]         = useState(0);
  const [page,          setPage]          = useState(1);
  const [search,        setSearch]        = useState('');
  const [typeFilter,    setTypeFilter]    = useState('');

  const [statusFilter,  setStatusFilter]  = useState('');
  const [showForm,      setShowForm]      = useState(false);
  const [step,          setStep]          = useState(1);
  const [selected,      setSelected]      = useState(null);
  const [drawer,        setDrawer]        = useState(null);
  const [drawerWorkOrders,  setDrawerWorkOrders]  = useState([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [formError,     setFormError]     = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [phoneCode, setPhoneCode] = useState('+971');
  const [phoneAltCode, setPhoneAltCode] = useState('+971');
  const [vehicleForm, setVehicleForm] = useState({ ...EMPTY_VEHICLE });
  const setVeh = (k, v) => setVehicleForm(p => ({ ...p, [k]: v }));
  const set = (k, v) => setForm(p => {
    const next = { ...p, [k]: v };
    if (k === 'service_bay_id') {
      const z = service_bays.find(z => String(z.id) === String(v));
      if (z) { next.latitude = z.center_lat || ''; next.longitude = z.center_lng || ''; }
    }
    return next;
  });

  /* ── Toast ── */
  const { toasts, showToast } = useToast();

  /* ── Steps ── */
  // Vehicle step only makes sense on creation — editing an existing customer
  // already has vehicles managed from the Vehicles page / a work order.
  const STEPS = selected ? [
    { num:1, title: 'Basic Info',     desc: 'Name & contact details' },
    { num:2, title: 'Business Info',  desc: 'Customer type & account details' },
    { num:3, title: 'Address & Limit',desc: 'Location, credit limit & notes' },
  ] : [
    { num:1, title: 'Basic Info',     desc: 'Name & contact details' },
    { num:2, title: 'Business Info',  desc: 'Customer type & account details' },
    { num:3, title: 'Address & Limit',desc: 'Location, credit limit & notes' },
    { num:4, title: 'Vehicle',        desc: 'Optional — add their vehicle now' },
  ];

  /* ── ServiceBays ── */
  const [service_bays, setServiceBays] = useState([]);
  useEffect(() => {
    api.get('/service-bays').then(r => { if (r.success) setServiceBays(r.data || []); });
  }, []);

  // Workshop-wide KPI counts. Refetched after mutations so the tiles stay in
  // sync with the paginated table below.
  const fetchStats = useCallback(async () => {
    const r = await api.get('/customers/stats');
    if (r.success) setStats(r.data || {});
  }, []);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: LIMIT });
    if (search)        params.set('search',  search);
    if (typeFilter)    params.set('type',    typeFilter);
    const res = await api.get(`/customers?${params}`);
    if (res.success) {
      let data = res.data || [];
      if (statusFilter === 'active')   data = data.filter(c => !!c.is_active);
      if (statusFilter === 'inactive') data = data.filter(c => !c.is_active);
      setCustomers(data);
      setTotal(res.pagination?.total || data.length);
    }
    setLoading(false);
  }, [search, typeFilter, statusFilter, page]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const openDrawer = async (customer) => {
    setDrawer(customer);
    setDrawerLoading(true);
    const res = await api.get(`/customers/${customer.id}`);
    if (res.success) { setDrawer(res.data); setDrawerWorkOrders(res.data.orders || []); }
    setDrawerLoading(false);
  };

  const openEdit = (c, e) => {
    e?.stopPropagation();
    setSelected(c);
    // Extract phone code from stored phone number (e.g. "+971501234567" → code="+971", number="501234567")
    let pCode = '+971', pNum = c.phone || '';
    let paCode = '+971', paNum = c.phone_alt || '';
    const extractCode = (phone) => {
      if (!phone) return ['+971', ''];
      const m = phone.match(/^(\+\d{1,4})(.*)/);
      return m ? [m[1], m[2]] : ['+971', phone];
    };
    [pCode, pNum] = extractCode(c.phone);
    [paCode, paNum] = extractCode(c.phone_alt);
    setPhoneCode(pCode); setPhoneAltCode(paCode);
    setForm({ ...emptyForm, ...c, phone: pNum, phone_alt: paNum });
    setFormError(''); setStep(1);
    setShowForm(true);
  };

  const openCreate = () => {
    setSelected(null); setForm(emptyForm);
    setPhoneCode('+971'); setPhoneAltCode('+971');
    setVehicleForm({ ...EMPTY_VEHICLE });
    setFormError(''); setStep(1);
    setShowForm(true);
  };

  /* validate current step before going next */
  const validateStep = () => {
    if (step === 1) {
      if (!form.full_name.trim()) { setFormError(t('customers.validation.full_name_required')); return false; }
      if (!form.phone.trim())     { setFormError(t('customers.validation.phone_required')); return false; }
    }
    setFormError('');
    return true;
  };

  const nextStep = (e) => { e?.preventDefault(); e?.stopPropagation(); if (validateStep()) setStep(s => Math.min(s + 1, STEPS.length)); };
  const prevStep = (e) => { e?.preventDefault(); e?.stopPropagation(); setFormError(''); setStep(s => Math.max(s - 1, 1)); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (step !== STEPS.length) return; // safety guard — only submit on last step
    setSaving(true); setFormError('');
    const payload = {
      ...form,
      client_category: form.customer_category, // backend field is client_category, not customer_category
      phone: form.phone ? `${phoneCode}${form.phone}` : '',
      phone_alt: form.phone_alt ? `${phoneAltCode}${form.phone_alt}` : '',
    };
    const res = selected
      ? await api.put(`/customers/${selected.id}`, payload)
      : await api.post('/customers', payload);
    if (res.success) {
      // Optional vehicle, new customers only — never blocks the customer
      // creation itself if it fails, since it's a "nice to have" add-on.
      if (!selected && vehicleForm.make.trim() && vehicleForm.model.trim()) {
        try {
          const vRes = await api.post('/vehicles', {
            customer_id: res.data.id, ...vehicleForm,
            year: vehicleForm.year || null, mileage: vehicleForm.mileage || null,
          });
          if (!vRes.success) showToast(t('customers.toast.created') + ' — vehicle could not be saved: ' + (vRes.message || ''), 'error');
        } catch { showToast(t('customers.toast.created') + ' — vehicle could not be saved (network error).', 'error'); }
      }
      showToast(selected ? t('customers.toast.updated') : t('customers.toast.created'));
      setShowForm(false); setSelected(null);
      fetchCustomers();
      fetchStats();
      if (drawer && drawer.id === selected?.id) setDrawer(res.data);
    } else { setFormError(res.message || t('customers.toast.save_failed')); }
    setSaving(false);
  };

  const handleToggle = async (c, e) => {
    e?.stopPropagation();
    const newActive = !c.is_active;
    const res = await api.put(`/customers/${c.id}`, { ...c, is_active: newActive });
    if (res.success) {
      showToast(newActive ? t('customers.toast.activated', { name: c.full_name }) : t('customers.toast.deactivated', { name: c.full_name }));
      fetchCustomers();
      fetchStats();
      if (drawer?.id === c.id) setDrawer(d => ({ ...d, is_active: newActive }));
    } else {
      showToast(t('customers.toast.status_update_failed'), 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const { id, full_name: name } = deleteConfirm;
    const res = await api.delete(`/customers/${id}`);
    setDeleteConfirm(null);
    if (res.success !== false) {
      showToast(t('customers.toast.deactivated', { name }));
      if (drawer?.id === id) setDrawer(null);
      fetchCustomers();
      fetchStats();
    } else {
      showToast(t('customers.toast.deactivate_failed'), 'error');
    }
  };

  const exportCSV = async () => {
    setExporting(true);
    const params = new URLSearchParams({ limit: 10000 });
    if (search)        params.set('search',  search);
    if (typeFilter)    params.set('type',    typeFilter);
    const res = await api.get(`/customers?${params}`);
    setExporting(false);
    if (!res.success) { showToast(t('customers.toast.export_failed'), 'error'); return; }
    const data = res.data || [];
    let filtered = data;
    if (statusFilter === 'active')   filtered = filtered.filter(c => !!c.is_active);
    if (statusFilter === 'inactive') filtered = filtered.filter(c => !c.is_active);
    const headers = ['ID','Name','Company','Type','Phone','Email','City','WorkOrders','Delivered','Credit Limit','Status'];
    const rows = filtered.map(c => [
      c.id, c.full_name, c.company_name||'', TYPE_META[c.type]?.label||c.type,
      c.phone, c.email||'', c.city||'',
      c.total_orders||0, c.delivered_orders||0, c.credit_limit||0,
      c.is_active?'Active':'Inactive',
    ]);
    // SR-15 — quoting was correct but a leading = + @ was still a formula.
    const csv = toCsv(headers, rows);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = `customers-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const clearFilters = () => { setSearch(''); setTypeFilter(''); setStatusFilter(''); setPage(1); };
  const hasFilters   = search || typeFilter || statusFilter;
  const activeCount  = customers.filter(c => !!c.is_active).length;
  const totalWorkOrders  = customers.reduce((s,c) => s + (parseInt(c.total_orders)||0), 0);

  /* ── Render ── */
  return (
    <div className="page-container">

      {/* Page Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:26, fontWeight:900, color:'#1e293b', display:'flex', alignItems:'center', gap:10 }}>
            <Group width={28} height={28} color="#f97316" /> {t('customers.page.title')}
          </h2>
          <p style={{ margin:'5px 0 0', color:'#64748b', fontSize:14 }}>
            {t('customers.page.subtitle', { total, activeCount })}
          </p>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={exportCSV} disabled={exporting}
            style={{ padding:'10px 18px', borderRadius:10, border:'1px solid #e2e8f0', background:'#fff',
              cursor:exporting?'not-allowed':'pointer', fontWeight:600, fontSize:13, color:'#475569',
              display:'flex', alignItems:'center', gap:7, opacity:exporting?0.6:1 }}>
            <Download width={15} height={15} /> {exporting ? t('customers.button.exporting') : t('customers.button.export_csv')}
          </button>
          <button onClick={openCreate}
            style={{ padding:'10px 22px', borderRadius:10, border:'none',
              background:'linear-gradient(135deg,#f97316,#ea580c)', color:'#fff',
              cursor:'pointer', fontWeight:700, fontSize:14, display:'flex', alignItems:'center', gap:7,
              boxShadow:'0 4px 14px rgba(249,115,22,0.38)' }}>
            <Plus width={16} height={16} /> {t('customers.button.new_customer')}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display:'flex', gap:14, marginBottom:24, flexWrap:'wrap' }}>
        <KPICard icon={Group}          label={t('customers.kpi.total_customers')} value={stats.total || 0}                                                                sub={t('customers.kpi.active_count', { count: stats.active || 0 })} color="#f97316" />
        <KPICard icon={Package}        label={t('customers.kpi.total_orders')}    value={stats.total_work_orders || 0}                                                    sub={t('customers.kpi.all_time')}                                    color="#3b82f6" />
        <KPICard icon={Building}       label="Business"                           value={stats.business || 0}                                                             sub="Company / corporate accounts"                                   color="#8b5cf6" />
        <KPICard icon={DeliveryTruck}  label="Fleet"                              value={stats.fleet || 0}                                                                sub="Managed fleet accounts"                                         color="#10b981" />
      </div>

      {/* Filter Bar */}
      <div style={{ background:'#fff', borderRadius:14, padding:'15px 18px',
        boxShadow:'0 1px 3px rgba(0,0,0,0.07)', marginBottom:20,
        display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ position:'relative', flex:1, minWidth:220 }}>
          <Search width={15} height={15} color="#9ca3af"
            style={{ position:'absolute', [isRTL?'right':'left']:11, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }} />
          <input placeholder={t("customers.search_placeholder")}
            value={search} onChange={e=>{ setSearch(e.target.value); setPage(1); }}
            style={{ ...INPUT, [isRTL?'paddingRight':'paddingLeft']:33 }} />
        </div>
        <select value={typeFilter} onChange={e=>{ setTypeFilter(e.target.value); setPage(1); }}
          style={{ ...INPUT, width:148 }}>
          <option value="">{t("common.all_types")}</option>
          {Object.entries(TYPE_META).map(([t,m]) => <option key={t} value={t}>{m.label}</option>)}
        </select>

        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
          style={{ ...INPUT, width:128 }}>
          <option value="">{t("common.all_status")}</option>
          <option value="active">{t('customers.status.active')}</option>
          <option value="inactive">{t('customers.status.inactive')}</option>
        </select>
        {hasFilters && (
          <button onClick={clearFilters}
            style={{ padding:'9px 13px', borderRadius:8, border:'1px solid #fecaca', background:'#fff5f5',
              color:'#dc2626', cursor:'pointer', fontSize:13, fontWeight:600,
              display:'flex', alignItems:'center', gap:5 }}>
            <Xmark width={13} height={13} /> {t('customers.button.clear')}
          </button>
        )}
      </div>

      {/* Table Card */}
      <div style={{ background:'#fff', borderRadius:16, boxShadow:'0 1px 4px rgba(0,0,0,0.08)', overflow:'hidden' }}>
        {/* Segment pills */}
        <div style={{ padding:'12px 18px', borderBottom:'1px solid #f1f5f9',
          display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize:11, color:'#94a3b8', fontWeight:700, [isRTL?'marginLeft':'marginRight']:4, letterSpacing:'0.06em' }}>{t('customers.segment_label')}</span>
          {Object.entries(TYPE_META).map(([t,m]) => {
            const cnt    = customers.filter(c => c.type === t).length;
            const active = typeFilter === t;
            if (!cnt) return null;
            return (
              <button key={t} onClick={() => { setTypeFilter(active?'':t); setPage(1); }}
                style={{ background:active?m.color:m.bg, color:active?'#fff':m.color,
                  border:'none', borderRadius:20, padding:'4px 12px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                {m.label} ({cnt})
              </button>
            );
          })}
          <span style={{ [isRTL?'marginRight':'marginLeft']:'auto', color:'#94a3b8', fontSize:13 }}>{customers.length} {t('customers.shown')}</span>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : customers.length === 0 ? (
          <div style={{ textAlign:'center', padding:70 }}>
            <Group width={56} height={56} color="#e2e8f0" style={{ marginBottom:14 }} />
            <div style={{ fontWeight:800, fontSize:20, marginBottom:6 }}>
              {hasFilters ? t('customers.empty.filter_mismatch') : t('customers.empty.no_customers')}
            </div>
            <div style={{ color:'#94a3b8', marginBottom:24, fontSize:14 }}>
              {hasFilters ? t('customers.empty.filter_help') : t('customers.empty.first_customer_help')}
            </div>
            {hasFilters
              ? <button onClick={clearFilters} style={{ padding:'10px 24px', borderRadius:10, border:'1px solid #e2e8f0', background:'#fff', cursor:'pointer', fontWeight:600 }}>{t("common.clear_filters")}</button>
              : <button onClick={openCreate}   style={{ padding:'11px 28px', borderRadius:10, border:'none', background:'#f97316', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:15 }}>{t('customers.button.add_first')}</button>
            }
          </div>
        ) : (
          <>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:860 }}>
                <thead>
                  <tr style={{ background:'#f8fafc', borderBottom:'2px solid #f1f5f9' }}>
                    {[t('customers.table.customer'), t('customers.table.type'), t('customers.table.contact'), t('customers.table.location'), t('customers.table.orders'), t('customers.table.credit_limit'), t('customers.table.status'), ''].map(h => (
                      <th key={h} style={{ padding:'10px 16px', textAlign: isRTL ? 'right' : 'left', fontSize:11,
                        fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.map(customer => {
                    const tm       = TYPE_META[customer.type] || TYPE_META.other;
                    const creditL  = parseFloat(customer.credit_limit) || 0;
                    const creditU  = parseFloat(customer.credit_used   || 0);
                    const creditPct= creditL > 0 ? Math.min(100,(creditU/creditL)*100) : 0;
                    const isActive = !!customer.is_active;
                    return (
                      <tr key={customer.id} onClick={() => openDrawer(customer)}
                        style={{ borderBottom:'1px solid #f8fafc', cursor:'pointer', transition:'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background='#fafafa'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                        <td style={{ padding:'13px 16px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:11 }}>
                            <Avatar name={customer.full_name} />
                            <div>
                              <div style={{ fontWeight:700, fontSize:14, color:'#1e293b' }}>{customer.full_name}</div>
                              {customer.company_name && (
                                <div style={{ fontSize:12, color:'#64748b', marginTop:1, display:'flex', alignItems:'center', gap:4 }}>
                                  <Building width={11} height={11} /> {customer.company_name}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding:'13px 16px' }}>
                          <span style={{ background:tm.bg, color:tm.color, padding:'4px 10px', borderRadius:20, fontSize:12, fontWeight:700 }}>{tm.label}</span>
                        </td>
                        <td style={{ padding:'13px 16px' }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'#1e293b', display:'flex', alignItems:'center', gap:5 }}>
                            <Phone width={12} height={12} color="#94a3b8" /> {customer.phone}
                          </div>
                          {customer.email && (
                            <div style={{ fontSize:12, color:'#94a3b8', marginTop:2, display:'flex', alignItems:'center', gap:4 }}>
                              <Mail width={11} height={11} /> {customer.email}
                            </div>
                          )}
                        </td>
                        <td style={{ padding:'13px 16px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:13, color:'#475569' }}>
                            <MapPin width={13} height={13} color="#94a3b8" /> {(() => { const parts = [customer.city, customer.area, customer.emirate].filter(Boolean).map(p => p === 'Dubai' ? 'Abu Dhabi' : p); return parts.length ? [...new Set(parts)].join(', ') : t('customers.default_location', 'Abu Dhabi'); })()}
                          </div>
                        </td>
                        <td style={{ padding:'13px 16px' }}>
                          <div style={{ fontSize:17, fontWeight:800, color:'#1e293b' }}>{customer.total_orders||0}</div>
                          {parseInt(customer.delivered_orders)>0 && (
                            <div style={{ fontSize:11, color:'#16a34a', fontWeight:600, display:'flex', alignItems:'center', gap:3 }}>
                              <CheckCircle width={11} height={11} /> {t('customers.table.done', { count: customer.delivered_orders })}
                            </div>
                          )}
                        </td>
                        <td style={{ padding:'13px 16px', minWidth:130 }}>
                          {creditL > 0 ? (
                            <>
                              <div style={{ fontSize:12, color:'#64748b', marginBottom:5, fontWeight:600 }}>
                                {cur} {creditU.toFixed(0)} / {creditL.toFixed(0)}
                              </div>
                              <div style={{ height:5, background:'#f1f5f9', borderRadius:3, overflow:'hidden' }}>
                                <div style={{ height:'100%', width:creditPct+'%', borderRadius:3,
                                  background:creditPct>80?'#dc2626':creditPct>50?'#f59e0b':'#16a34a', transition:'width 0.4s' }} />
                              </div>
                            </>
                          ) : <span style={{ color:'#cbd5e1', fontSize:13 }}>{t('customers.status.no_limit')}</span>}
                        </td>
                        <td style={{ padding:'13px 16px' }}><StatusPill active={isActive} /></td>
                        <td style={{ padding:'13px 16px' }} onClick={e=>e.stopPropagation()}>
                          <div style={{ display:'flex', gap:6 }}>
                            <button onClick={e=>openEdit(customer,e)}
                              style={{ padding:'6px 11px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff',
                                cursor:'pointer', fontSize:13, fontWeight:600, color:'#374151',
                                display:'flex', alignItems:'center', gap:5 }}>
                              <EditPencil width={13} height={13} /> {t('customers.button.edit')}
                            </button>
                            <button onClick={e=>{ e.stopPropagation(); setDeleteConfirm(customer); }}
                              style={{ padding:'6px 10px', borderRadius:8, border:'1px solid #fecaca',
                                background:'#fff5f5', color:'#dc2626', cursor:'pointer',
                                display:'flex', alignItems:'center' }}>
                              <Trash width={13} height={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {total > LIMIT && (() => {
              const maxPages = Math.ceil(total / LIMIT);
              const getPageNumbers = () => {
                const pages = [];
                if (maxPages <= 7) {
                  for (let i = 1; i <= maxPages; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (page > 3) pages.push('...');
                  for (let i = Math.max(2, page - 1); i <= Math.min(page + 1, maxPages - 1); i++) {
                    if (!pages.includes(i)) pages.push(i);
                  }
                  if (page < maxPages - 2) pages.push('...');
                  if (!pages.includes(maxPages)) pages.push(maxPages);
                }
                return pages;
              };
              const pageNumbers = getPageNumbers();
              return (
                <div style={{ padding:'13px 18px', borderTop:'1px solid #f1f5f9',
                  display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:13, color:'#64748b' }}>
                    {t('customers.pagination.showing', { start: (page-1)*LIMIT+1, end: Math.min(page*LIMIT,total), total })}
                  </span>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <button disabled={page===1} onClick={()=>setPage(p=>p-1)}
                      style={{ padding:'7px 11px', borderRadius:8, border:'1px solid #e2e8f0',
                        background:page===1?'#f8fafc':'#fff', cursor:page===1?'not-allowed':'pointer',
                        fontSize:12, fontWeight:600, opacity:page===1?0.5:1, display:'flex', alignItems:'center', gap:4 }}>
                      {isRTL ? <NavArrowRight width={13} height={13} /> : <NavArrowLeft width={13} height={13} />} {t('common.prev')}
                    </button>
                    {pageNumbers.map((p, i) => p === '...' ? (
                      <span key={i} style={{ padding:'4px 8px', color:'#94a3b8', fontSize:12 }}>…</span>
                    ) : (
                      <button key={p} onClick={()=>setPage(p)}
                        style={{ padding:'6px 11px', borderRadius:6, border:'1px solid #e2e8f0',
                          background:page===p?'#1e3a6b':'#fff', color:page===p?'#fff':'#475569',
                          cursor:'pointer', fontSize:12, fontWeight:page===p?700:600,
                          transition:'all 0.2s' }}>
                        {p}
                      </button>
                    ))}
                    <button disabled={page*LIMIT>=total} onClick={()=>setPage(p=>p+1)}
                      style={{ padding:'7px 11px', borderRadius:8, border:'1px solid #e2e8f0',
                        background:page*LIMIT>=total?'#f8fafc':'#fff', cursor:page*LIMIT>=total?'not-allowed':'pointer',
                        fontSize:12, fontWeight:600, opacity:page*LIMIT>=total?0.5:1, display:'flex', alignItems:'center', gap:4 }}>
                      {t('common.next')} {isRTL ? <NavArrowLeft width={13} height={13} /> : <NavArrowRight width={13} height={13} />}
                    </button>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* ── Customer Detail Drawer ── */}
      {drawer && (
        <>
          <div onClick={() => setDrawer(null)}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', zIndex:9990 }} />
          <div style={{ position:'fixed', top:0, [isRTL?'left':'right']:0, bottom:0, width:510, maxWidth:'96vw',
            background:'#f8fafc', zIndex:9991, overflowY:'auto',
            boxShadow: isRTL?'8px 0 40px rgba(0,0,0,0.14)':'-8px 0 40px rgba(0,0,0,0.14)', display:'flex', flexDirection:'column' }}>

            <div style={{ background:'linear-gradient(135deg,#1e293b,#334155)', padding:'26px 26px 22px', position:'relative' }}>
              <button onClick={() => setDrawer(null)}
                style={{ position:'absolute', top:14, [i18n.language === 'ar' ? 'left' : 'right']:14, background:'rgba(255,255,255,0.1)',
                  border:'none', color:'#fff', width:30, height:30, borderRadius:'50%',
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Xmark width={15} height={15} />
              </button>
              <div style={{ display:'flex', alignItems:'center', gap:15, marginBottom:16 }}>
                <Avatar name={drawer.full_name} size={60} />
                <div>
                  <div style={{ color:'#fff', fontWeight:800, fontSize:20, lineHeight:1.2 }}>{drawer.full_name}</div>
                  {drawer.company_name && (
                    <div style={{ color:'#94a3b8', fontSize:13, marginTop:3, display:'flex', alignItems:'center', gap:5 }}>
                      <Building width={12} height={12} /> {drawer.company_name}
                    </div>
                  )}
                  <div style={{ marginTop:8, display:'flex', gap:8, flexWrap:'wrap' }}>
                    <StatusPill active={!!drawer.is_active} />
                    {drawer.type && (
                      <span style={{ background:TYPE_META[drawer.type]?.bg, color:TYPE_META[drawer.type]?.color,
                        padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:700 }}>
                        {TYPE_META[drawer.type]?.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={e=>openEdit(drawer,e)}
                  style={{ flex:1, padding:'10px', borderRadius:10, border:'none',
                    background:'#f97316', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:14,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                  <EditPencil width={15} height={15} /> {t('customers.button.edit_customer')}
                </button>
                <button onClick={() => navigate(`/work-orders?customer_id=${drawer.id}`)}
                  style={{ flex:1, padding:'10px', borderRadius:10, border:'none',
                    background:'#16a34a', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:14,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                  <Package width={15} height={15} /> {t('customers.button.new_order')}
                </button>
                <button onClick={e=>handleToggle(drawer,e)}
                  style={{ flex:1, padding:'10px', borderRadius:10, border:'1px solid rgba(255,255,255,0.2)',
                    background:'rgba(255,255,255,0.08)', color:'#fff', cursor:'pointer', fontWeight:600, fontSize:14,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                  {!!drawer.is_active ? <Xmark width={14} height={14} /> : <CheckCircle width={14} height={14} />}
                  {!!drawer.is_active ? t('customers.button.deactivate') : t('customers.button.activate')}
                </button>
              </div>
              <div style={{ marginTop:10 }}>
                <button onClick={() => {
                  const portalUrl = window.location.origin + '/merchant/login';
                  const msg = buildCustomerMessage(drawer, t, portalUrl);
                  shareViaWhatsApp(drawer.phone, msg);
                }}
                  className="wa-share-btn wa-share-btn-full"
                  title={t('whatsapp.share_credentials', 'Share Portal Access via WhatsApp')}>
                  <WhatsAppIcon width={15} height={15} color="#fff" /> {t('whatsapp.share_portal_access', 'Share Portal Access via WhatsApp')}
                </button>
              </div>
            </div>

            <div style={{ padding:22, flex:1 }}>
              {drawerLoading ? (
                <div style={{ textAlign:'center', padding:50, color:'#94a3b8' }}>{t("customers.loading_details")}</div>
              ) : (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
                    {(() => {
                      const creditVal = parseFloat(drawer.credit_limit) || 0;
                      const drawerKpiStats = [
                        { label: t('customers.drawer.total_orders'), Icon: Package, value: drawer.total_orders || 0, color: '#3b82f6' },
                        { label: t('customers.drawer.delivered'), Icon: CheckCircle, value: drawer.delivered_orders || 0, color: '#16a34a' },
                        { label: t('customers.drawer.credit_limit'), Icon: Wallet, value: creditVal > 0 ? `${cur} ${creditVal.toFixed(0)}` : t('customers.drawer.no_limit'), color: '#8b5cf6' },
                        { label: t('customers.profile.location'), Icon: MapPin, value: (() => { const parts = [drawer.city, drawer.area, drawer.emirate].filter(Boolean).map(p => p === 'Dubai' ? 'Abu Dhabi' : p); return parts.length ? [...new Set(parts)].join(', ') : t('customers.default_location', 'Abu Dhabi'); })(), color: '#f97316' },
                      ];
                      return drawerKpiStats.map(s => (
                        <div key={s.label} style={{ background:'#fff', borderRadius:12, padding:'13px 15px',
                          [isRTL?'borderRight':'borderLeft']:`4px solid ${s.color}`, boxShadow:'0 1px 3px rgba(0,0,0,0.07)' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <s.Icon width={22} height={22} color={s.color} />
                            <div>
                              <div style={{ fontWeight:800, fontSize:17, color:'#1e293b' }}>{s.value}</div>
                              <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600, marginTop:1 }}>{s.label}</div>
                            </div>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>

                  <div style={{ background:'#fff', borderRadius:14, padding:18,
                    boxShadow:'0 1px 3px rgba(0,0,0,0.07)', marginBottom:16 }}>
                    <div style={{ fontWeight:700, fontSize:13, marginBottom:13, color:'#374151',
                      display:'flex', alignItems:'center', gap:7, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                      <User width={15} height={15} color="#f97316" /> {t('customers.drawer.profile_information')}
                    </div>
                    {(() => {
                      const profileLabels = [
                        { label: t('customers.profile.phone'),    Icon: Phone,   value: drawer.phone},
                        { label: t('customers.profile.alt_phone'), Icon: Phone,   value: drawer.phone_alt},
                        { label: t('customers.profile.email'),    Icon: Mail,    value: drawer.email},
                        { label: t('customers.profile.bay'),     Icon: MapPin,  value: drawer.zone_name},
                        { label: t('customers.profile.address'),  Icon: MapPin,  value: [drawer.address_line1, drawer.area, drawer.city].filter(Boolean).join(', ')},
                        { label: t('customers.profile.notes'),    Icon: Eye,     value: drawer.notes},
                        { label: t('customers.profile.joined'),   Icon: StatsUpSquare, value: drawer.created_at ? new Date(drawer.created_at).toLocaleDateString() : null},
                      ];
                      return profileLabels.filter(r => r.value).map(row => (
                        <div key={row.label} style={{ display:'flex', alignItems:'flex-start', padding:'8px 0', borderBottom:'1px solid #f8fafc', fontSize:13 }}>
                          <div style={{ width:105, display:'flex', alignItems:'center', gap:5, color:'#94a3b8', fontSize:11, fontWeight:700, flexShrink:0, paddingTop:2 }}>
                            <row.Icon width={12} height={12} /> {row.label}
                          </div>
                          <span style={{ color:'#1e293b', fontWeight:500, flex:1 }}>{row.value}</span>
                        </div>
                      ));
                    })()}
                  </div>

                  {drawerWorkOrders.length > 0 && (
                    <div style={{ background:'#fff', borderRadius:14, padding:18,
                      boxShadow:'0 1px 3px rgba(0,0,0,0.07)' }}>
                      <div style={{ fontWeight:700, fontSize:13, marginBottom:13, color:'#374151',
                        display:'flex', justifyContent:'space-between', alignItems:'center',
                        textTransform:'uppercase', letterSpacing:'0.05em' }}>
                        <span style={{ display:'flex', alignItems:'center', gap:7 }}>
                          <DeliveryTruck width={15} height={15} color="#f97316" /> {t('customers.drawer.recent_orders')}
                        </span>
                        <span style={{ color:'#94a3b8', fontSize:12, fontWeight:400, textTransform:'none' }}>{drawerWorkOrders.length} {t('customers.total_label')}</span>
                      </div>
                      {drawerWorkOrders.slice(0,8).map(o => {
                        const sc = STATUS_COLORS[o.status]||'#94a3b8';
                        return (
                          <div key={o.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                            padding:'9px 0', borderBottom:'1px solid #f8fafc' }}>
                            <div>
                              <div style={{ fontWeight:700, fontSize:13, color:'#1e293b' }}>#{o.work_order_number}</div>
                              <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>{new Date(o.created_at).toLocaleDateString()}</div>
                            </div>
                            <div style={{ textAlign: isRTL ? 'left' : 'right' }}>
                              <span style={{ background:sc+'20', color:sc, padding:'3px 9px',
                                borderRadius:20, fontSize:11, fontWeight:700, textTransform:'capitalize' }}>
                                {o.status?.replace(/_/g,' ')}
                              </span>
                              {o.total_amount && (
                                <div style={{ fontSize:12, color:'#64748b', marginTop:3, fontWeight:600 }}>
                                  {cur} {parseFloat(o.total_amount).toFixed(2)}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Multi-Step Form Modal ── */}
      {showForm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.55)', zIndex:9999,
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div className="new-customer-modal" style={{ background:'#fff', borderRadius:22, width:'100%', maxWidth:660,
            maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 30px 90px rgba(15,23,42,0.35)' }}>
            <style>{`
              .new-customer-modal input:not([type=checkbox]),
              .new-customer-modal select,
              .new-customer-modal textarea {
                border: 1.5px solid #e2e8f0 !important;
                border-radius: 10px !important;
                background: #fbfcfe !important;
                color: #1e293b;
                transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
              }
              .new-customer-modal input:focus,
              .new-customer-modal select:focus,
              .new-customer-modal textarea:focus {
                border-color: #f97316 !important;
                box-shadow: 0 0 0 3px rgba(249,115,22,0.12) !important;
                background: #fff !important;
                outline: none !important;
              }
              .new-customer-modal select { cursor: pointer; }
              .new-customer-modal label {
                color: #64748b !important;
                font-weight: 700 !important;
              }
              .new-customer-modal ::-webkit-scrollbar { width: 7px; }
              .new-customer-modal ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
              .new-customer-modal ::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
            `}</style>

            {/* Modal Header */}
            <div style={{ padding:'26px 32px 0', display:'flex', justifyContent:'space-between', alignItems:'center', position:'relative' }}>
              <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                <div style={{ width:44, height:44, borderRadius:14, flexShrink:0,
                  background:'linear-gradient(135deg,#fff7ed,#ffedd5)', border:'1px solid #fed7aa',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Group width={22} height={22} color="#f97316" strokeWidth={1.8} />
                </div>
                <div>
                  <h3 style={{ margin:0, fontSize:20, fontWeight:800, color:'#1e293b' }}>
                    {selected ? t('customers.modal.edit_title') : t('customers.modal.new_title')}
                  </h3>
                  <p style={{ margin:'3px 0 0', color:'#94a3b8', fontSize:13 }}>
                    Step {step} of {STEPS.length} — {STEPS[step-1]?.desc}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setShowForm(false)}
                style={{ background:'#f1f5f9', border:'none', cursor:'pointer', color:'#64748b',
                  width:34, height:34, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <Xmark width={16} height={16} />
              </button>
            </div>

            {/* Step Bar */}
            <StepBar current={step} steps={STEPS} />

            {/* Divider */}
            <div style={{ margin:'22px 0 0', height:1, background:'#f1f5f9' }} />

            <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden' }}>
              <div style={{ overflowY:'auto', flex:1, padding:'26px 32px 26px' }}>
                {formError && (
                  <div style={{ background:'#fee2e2', color:'#dc2626', padding:'10px 14px',
                    borderRadius:8, marginBottom:16, fontSize:14,
                    display:'flex', alignItems:'center', gap:8 }}>
                    <WarningTriangle width={16} height={16} /> {formError}
                  </div>
                )}

                {/* ── Step 1: Basic Info ── */}
                {step === 1 && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

                    {/* Section label */}
                    <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                      <div style={{ width:3, height:18, borderRadius:4, background:'#f97316' }} />
                      <span style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                        Contact Details
                      </span>
                    </div>

                    <div style={{ gridColumn:'1/-1' }}>
                      <label style={LABEL}>{t('customers.form.full_name')} <span style={{ color:'#f97316' }}>*</span></label>
                      <input required value={form.full_name} onChange={e=>set('full_name',e.target.value)}
                        style={{ ...INPUT, fontSize:15, padding:'12px 14px' }}
                        placeholder={t('customers.form.full_name_placeholder')} autoFocus />
                    </div>

                    <div>
                      <label style={LABEL}>{t('customers.form.phone')} <span style={{ color:'#f97316' }}>*</span></label>
                      <PhoneInputShared
                        id="customer-phone"
                        value={form.phone}
                        onChange={v => set('phone', v)}
                        phoneCode={phoneCode}
                        onPhoneCodeChange={setPhoneCode}
                        placeholder={t('customers.form.phone_placeholder')}
                        required
                      />
                    </div>
                    <div>
                      <label style={LABEL}>{t('customers.form.alternate_phone')}</label>
                      <PhoneInputShared
                        id="customer-phone-alt"
                        value={form.phone_alt}
                        onChange={v => set('phone_alt', v)}
                        phoneCode={phoneAltCode}
                        onPhoneCodeChange={setPhoneAltCode}
                        placeholder={t('customers.form.optional')}
                      />
                    </div>

                    <div style={{ gridColumn:'1/-1' }}>
                      <label style={LABEL}>{t('customers.form.email')}</label>
                      <input type="email" value={form.email} onChange={e=>set('email',e.target.value)}
                        style={INPUT} placeholder={t('customers.form.email_placeholder')} />
                    </div>

                    {/* National ID — optional, relevant for workshop */}
                    <div style={{ gridColumn:'1/-1' }}>
                      <label style={LABEL}>Emirates ID / National ID <span style={{ color:'#94a3b8', fontWeight:400, textTransform:'none', letterSpacing:0 }}>(optional)</span></label>
                      <input value={form.emirates_id} onChange={e=>set('emirates_id',e.target.value)}
                        style={INPUT} placeholder="784-XXXX-XXXXXXX-X" maxLength={18} />
                    </div>
                  </div>
                )}

                {/* ── Step 2: Business Info ── */}
                {step === 2 && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

                    {/* Customer type as visual cards */}
                    <div style={{ gridColumn:'1/-1' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                        <div style={{ width:3, height:18, borderRadius:4, background:'#f97316' }} />
                        <span style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                          Customer Type <span style={{ color:'#f97316' }}>*</span>
                        </span>
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                        {Object.entries(TYPE_META).map(([typeKey, meta]) => {
                          const isSelected = form.type === typeKey;
                          return (
                            <button type="button" key={typeKey} onClick={() => set('type', typeKey)}
                              style={{
                                padding:'12px 14px', borderRadius:12, cursor:'pointer', textAlign:'left',
                                border: isSelected ? `2px solid ${meta.color}` : '2px solid #e2e8f0',
                                background: isSelected ? meta.bg : '#fff',
                                transition:'all 0.18s', outline:'none',
                              }}>
                              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:2 }}>
                                <span style={{ fontWeight:700, fontSize:13, color: isSelected ? meta.color : '#374151' }}>
                                  {meta.label}
                                </span>
                                {isSelected && (
                                  <span style={{ width:18, height:18, borderRadius:'50%', background:meta.color,
                                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                    <CheckCircle width={11} height={11} color="#fff" />
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize:11, color: isSelected ? meta.color : '#94a3b8', opacity:isSelected?0.85:1 }}>
                                {meta.desc}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Company / Organisation name — shown for non-individual types */}
                    {form.type !== 'individual' && form.type !== 'other' && (
                      <div style={{ gridColumn:'1/-1' }}>
                        <label style={LABEL}>
                          {form.type === 'insurance' ? 'Vehicle Owner / Company' : 'Company Name'}
                          {form.type === 'corporate' && <span style={{ color:'#f97316' }}> *</span>}
                        </label>
                        <input value={form.company_name} onChange={e=>set('company_name',e.target.value)}
                          style={INPUT} placeholder={t('customers.form.company_placeholder')} />
                      </div>
                    )}

                    {/* Corporate / Credit — trade licence fields */}
                    {form.type === 'corporate' && (
                      <>
                        <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
                          <div style={{ width:3, height:18, borderRadius:4, background:'#7c3aed' }} />
                          <span style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                            Business Registration
                          </span>
                        </div>
                        <div>
                          <label style={LABEL}>Trade Licence No.</label>
                          <input value={form.trade_licence} onChange={e=>set('trade_licence',e.target.value)}
                            style={INPUT} placeholder="e.g. CN-XXXXXXX" />
                        </div>
                        <div>
                          <label style={LABEL}>Tax Registration No.</label>
                          <input value={form.tax_registration} onChange={e=>set('tax_registration',e.target.value)}
                            style={INPUT} placeholder="TRN XXXXXXXXXXXXXXX" />
                        </div>
                        <div style={{ gridColumn:'1/-1' }}>
                          <label style={LABEL}>Commercial Registration No.</label>
                          <input value={form.commercial_registration} onChange={e=>set('commercial_registration',e.target.value)}
                            style={INPUT} placeholder="Optional" />
                        </div>
                      </>
                    )}

                    {/* Insurance — insurer details */}
                    {form.type === 'insurance' && (
                      <>
                        <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
                          <div style={{ width:3, height:18, borderRadius:4, background:'#1d4ed8' }} />
                          <span style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                            Insurer Details
                          </span>
                        </div>
                        <div>
                          <label style={LABEL}>Insurer / Insurance Company <span style={{ color:'#f97316' }}>*</span></label>
                          <input value={form.insurer_name} onChange={e=>set('insurer_name',e.target.value)}
                            style={INPUT} placeholder="e.g. Abu Dhabi National Insurance" />
                        </div>
                        <div>
                          <label style={LABEL}>Insurer Contact / Ref.</label>
                          <input value={form.insurer_contact} onChange={e=>set('insurer_contact',e.target.value)}
                            style={INPUT} placeholder="Phone or claim reference" />
                        </div>
                      </>
                    )}

                    {/* Fleet / Internal — coordinator */}
                    {form.type === 'fleet' && (
                      <>
                        <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
                          <div style={{ width:3, height:18, borderRadius:4, background:'#16a34a' }} />
                          <span style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                            Fleet Details
                          </span>
                        </div>
                        <div style={{ gridColumn:'1/-1' }}>
                          <label style={LABEL}>Fleet Coordinator Name</label>
                          <input value={form.fleet_coordinator} onChange={e=>set('fleet_coordinator',e.target.value)}
                            style={INPUT} placeholder="Name of the assigned fleet coordinator" />
                        </div>
                      </>
                    )}

                    {/* Service category */}
                    <div style={{ gridColumn:'1/-1' }}>
                      <label style={LABEL}>Primary Service Category</label>
                      <select value={form.customer_category} onChange={e=>set('customer_category',e.target.value)} style={INPUT}>
                        {CATEGORIES.map(c => (
                          <option key={c} value={c}>
                            {{ mechanical:'Mechanical', body_paint:'Body & Paint', electrical:'Electrical',
                               tyres:'Tyres & Wheels', ac_service:'A/C Service', inspection:'Inspection / Testing', other:'Other' }[c] || c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* ── Step 3: Address & Settings ── */}
                {step === 3 && (() => {
                  const zoneData = form.service_bay_id ? service_bays.find(z => String(z.id) === String(form.service_bay_id)) : null;
                  return (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

                      {/* Section label */}
                      <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                        <div style={{ width:3, height:18, borderRadius:4, background:'#f97316' }} />
                        <span style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                          Address & Limits
                        </span>
                      </div>

                      {/* Active Toggle at Top */}
                      <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', background:'#f0fdf4', borderRadius:10, border:'1px solid #dcfce7', marginBottom:4 }}>
                        <label style={{ fontSize:14, fontWeight:700, color:'#16a34a', margin:0, cursor:'pointer', userSelect:'none' }}>
                          {t("customers.active_status")}
                        </label>
                        <button type="button" onClick={() => set('is_active', !form.is_active)}
                          style={{
                            position:'relative', width:52, height:28, borderRadius:99, border:'none',
                            background: form.is_active ? '#16a34a' : '#cbd5e1', cursor:'pointer',
                            transition:'background 0.3s',
                            padding:0, display:'flex', alignItems:'center',
                            boxShadow: form.is_active ? '0 0 0 3px rgba(22,163,74,0.1)' : 'none'
                          }}>
                          <span style={{
                            position:'absolute', [isRTL?'right':'left']: form.is_active ? '26px' : '2px',
                            width:24, height:24, background:'#fff', borderRadius:'50%',
                            transition: isRTL ? 'right 0.3s' : 'left 0.3s', boxShadow:'0 2px 4px rgba(0,0,0,0.1)'
                          }} />
                        </button>
                      </div>

                      {/* Search Location + auto-fill address fields */}
                      <div style={{ gridColumn:'1/-1' }}>
                        <AddressSearch onSelect={({ lat, lng, display, address }) => {
                          set('latitude', lat); set('longitude', lng);
                          if (display) set('address_line1', display.split(',').slice(0, 2).join(','));
                          if (address) {
                            const city = address.city || address.town || address.state || '';
                            const area = address.suburb || address.neighbourhood || address.county || '';
                            if (city) set('city', city);
                            if (area) set('area', area);
                          }
                        }} />
                      </div>

                      {/* Map — pick or adjust pin */}
                      <div style={{ gridColumn:'1/-1' }}>
                        <LocationPickerMap
                          lat={form.latitude}
                          lng={form.longitude}
                          onPick={(lat, lng) => { set('latitude', lat); set('longitude', lng); }}
                        />
                        <div style={{ display:'flex', gap:8, marginTop:8 }}>
                          {zoneData?.center_lat && (
                            <button type="button"
                              onClick={() => { set('latitude', String(zoneData.center_lat)); set('longitude', String(zoneData.center_lng)); }}
                              style={{ padding:'7px 12px', fontSize:12, borderRadius:7, border:'1px solid #f97316',
                                background:'#fff7ed', color:'#f97316', cursor:'pointer', fontWeight:600 }}>
                              {t('customers.button.use_zone_center')}
                            </button>
                          )}
                          <button type="button"
                            onClick={() => navigator.geolocation?.getCurrentPosition(
                              p => { set('latitude', p.coords.latitude.toFixed(7)); set('longitude', p.coords.longitude.toFixed(7)); },
                              () => {}
                            )}
                            style={{ padding:'7px 12px', fontSize:12, borderRadius:7, border:'1px solid #6366f1',
                              background:'#eef2ff', color:'#6366f1', cursor:'pointer', fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                            <MapPin width={13} height={13} /> {t('customers.button.my_gps')}
                          </button>
                        </div>
                      </div>

                      {/* Auto-filled address summary (read-only) */}
                      {(form.address_line1 || form.city || form.area) && (
                        <div style={{ gridColumn:'1/-1', padding:'10px 14px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:4 }}>
                            {t('customers.form.selected_address', 'Selected Address')}
                          </div>
                          <div style={{ fontSize:13, color:'#1e293b', fontWeight:500 }}>
                            {[form.address_line1, form.area, form.city].filter(Boolean).join(', ') || '—'}
                          </div>
                          {form.latitude && form.longitude && (
                            <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>
                              {form.latitude}, {form.longitude}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Emirate + City row */}
                      <div>
                        <label style={LABEL}>Emirate</label>
                        <select value={form.emirate} onChange={e=>set('emirate',e.target.value)} style={INPUT}>
                          <option value="">Select emirate</option>
                          {['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'].map(e=>(
                            <option key={e} value={e}>{e}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={LABEL}>City / Area</label>
                        <input value={form.city} onChange={e=>set('city',e.target.value)}
                          style={INPUT} placeholder="e.g. Al Ain" />
                      </div>

                      {/* Credit Limit */}
                      <div style={{ gridColumn:'1/-1' }}>
                        <label style={LABEL}>
                          {t('customers.form.credit_limit')}
                          {form.type === 'corporate' && (
                            <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, color:'#94a3b8', fontSize:11, marginLeft:6 }}>
                              — requires approval before activation
                            </span>
                          )}
                        </label>
                        <div style={{ position:'relative' }}>
                          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)',
                            fontSize:13, fontWeight:700, color:'#64748b', pointerEvents:'none' }}>{cur}</span>
                          <input type="number" min="0" value={form.credit_limit}
                            onChange={e=>set('credit_limit',e.target.value)}
                            style={{ ...INPUT, paddingLeft:48 }} placeholder="0 = no limit" />
                        </div>
                      </div>

                      {/* Internal Notes */}
                      <div style={{ gridColumn:'1/-1' }}>
                        <label style={LABEL}>{t("customers.internal_notes")}</label>
                        <textarea rows={3} value={form.notes} onChange={e=>set('notes',e.target.value)}
                          style={{ ...INPUT, resize:'vertical' }}
                          placeholder={t("customers.notes_placeholder")} />
                      </div>
                    </div>
                  );
                })()}

                {/* ── Step 4: Vehicle (optional, creation only) ── */}
                {step === 4 && !selected && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                    <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                      <div style={{ width:3, height:18, borderRadius:4, background:'#f97316' }} />
                      <span style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                        Vehicle (optional)
                      </span>
                    </div>
                    <div style={{ gridColumn:'1/-1', padding:'10px 14px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0', fontSize:13, color:'#64748b' }}>
                      Leave this blank to skip — you can always add a vehicle for this customer later from the Vehicles page.
                    </div>

                    <div>
                      <label style={LABEL}>Make</label>
                      <select value={vehicleForm.make} onChange={e => setVehicleForm(v => ({ ...v, make: e.target.value, model: '' }))} style={INPUT}>
                        <option value="">Select make…</option>
                        {CAR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={LABEL}>Model</label>
                      {vehicleForm.make && CAR_CATALOG[vehicleForm.make]?.length > 0 ? (
                        <select value={vehicleForm.model} onChange={e => setVeh('model', e.target.value)} style={INPUT}>
                          <option value="">Select model…</option>
                          {CAR_CATALOG[vehicleForm.make].map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      ) : (
                        <input value={vehicleForm.model} onChange={e => setVeh('model', e.target.value)} style={INPUT}
                          placeholder={vehicleForm.make ? 'Enter model' : 'Select make first'} disabled={!vehicleForm.make} />
                      )}
                    </div>

                    <div>
                      <label style={LABEL}>Year</label>
                      <input value={vehicleForm.year} onChange={e => setVeh('year', e.target.value)} style={INPUT} placeholder="2021" />
                    </div>
                    <div>
                      <label style={LABEL}>Plate number</label>
                      <input value={vehicleForm.plate_number} onChange={e => setVeh('plate_number', e.target.value)} style={INPUT} placeholder="A 12345" />
                    </div>

                    <div>
                      <label style={LABEL}>Color</label>
                      <input value={vehicleForm.color} onChange={e => setVeh('color', e.target.value)} style={INPUT} placeholder="White" />
                    </div>
                    <div>
                      <label style={LABEL}>VIN</label>
                      <input value={vehicleForm.vin} onChange={e => setVeh('vin', e.target.value)} style={INPUT} placeholder="Optional" />
                    </div>

                    <div>
                      <label style={LABEL}>Odometer (km)</label>
                      <input value={vehicleForm.mileage} onChange={e => setVeh('mileage', e.target.value)} style={INPUT} placeholder="45000" />
                    </div>
                    <div>
                      <label style={LABEL}>Fuel type</label>
                      <select value={vehicleForm.fuel_type} onChange={e => setVeh('fuel_type', e.target.value)} style={INPUT}>
                        {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer nav — sticky */}
              <div style={{ padding:'20px 32px 24px', display:'flex', justifyContent:'space-between', alignItems:'center', borderTop:'1px solid #f1f5f9', background:'#fff', flexShrink:0 }}>
                <button type="button"
                  onClick={step > 1 ? (e) => prevStep(e) : () => setShowForm(false)}
                  style={{ padding:'11px 24px', borderRadius:11, border:'1.5px solid #e2e8f0',
                    background:'#fff', cursor:'pointer', fontWeight:600, fontSize:14,
                    display:'flex', alignItems:'center', gap:7, color:'#475569' }}>
                  <NavArrowLeft width={15} height={15} />
                  {step > 1 ? t('customers.button.back') : t('common.cancel')}
                </button>

                {step < STEPS.length ? (
                  <button type="button" onClick={(e) => nextStep(e)}
                    style={{ padding:'11px 30px', borderRadius:11, border:'none',
                      background:'linear-gradient(135deg,#f97316,#ea580c)', color:'#fff',
                      cursor:'pointer', fontWeight:700, fontSize:14,
                      display:'flex', alignItems:'center', gap:7,
                      boxShadow:'0 6px 18px rgba(249,115,22,0.35)' }}>
                    {t('common.next')} <NavArrowRight width={15} height={15} />
                  </button>
                ) : (
                  <button type="submit" disabled={saving}
                    style={{ padding:'11px 30px', borderRadius:11, border:'none',
                      background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff',
                      cursor:saving?'not-allowed':'pointer', fontWeight:700, fontSize:14,
                      opacity:saving?0.7:1, display:'flex', alignItems:'center', gap:7,
                      boxShadow:'0 6px 18px rgba(22,163,74,0.35)' }}>
                    <CheckCircle width={15} height={15} />
                    {saving ? t('customers.button.saving') : selected ? t('customers.button.update_customer') : t('customers.button.create_customer')}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Deactivate Confirm ── */}
      {deleteConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1100,
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:20, padding:34, width:390, textAlign:'center',
            boxShadow:'0 24px 70px rgba(0,0,0,0.2)' }}>
            <div style={{ width:60, height:60, borderRadius:'50%', background:'#fee2e2',
              display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
              <WarningTriangle width={28} height={28} color="#dc2626" />
            </div>
            <h3 style={{ margin:'0 0 10px', fontSize:19, fontWeight:800 }}>{t('customers.modal.deactivate_title')}</h3>
            <p style={{ color:'#64748b', marginBottom:26, lineHeight:1.6 }}>
              {t('customers.modal.deactivate_message', { name: deleteConfirm.full_name })}
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={()=>setDeleteConfirm(null)}
                style={{ flex:1, padding:12, borderRadius:10, border:'1px solid #e2e8f0',
                  background:'#fff', cursor:'pointer', fontWeight:600, fontSize:14 }}>{t("common.cancel")}</button>
              <button onClick={handleDelete}
                style={{ flex:1, padding:12, borderRadius:10, border:'none',
                  background:'#dc2626', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:14 }}>
                {t('customers.button.deactivate')}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
