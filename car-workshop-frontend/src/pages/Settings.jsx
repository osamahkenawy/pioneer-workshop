import { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import {
  Settings as SettingsIcon, User, Building, DeliveryTruck, Mail, Bell,
  Label as Tag, Plus, Trash, CheckCircle, WarningCircle, Globe, Phone,
  MapPin, Wallet, Clock, EditPencil, Xmark, Upload, Eye, EyeClosed,
  NavArrowRight, SwitchOn as ToggleOn, ShieldCheck, Printer, Camera,
  Home, Package, StatsUpSquare, Wrench, Page, WarningTriangle, Check,
  Search as SearchIcon, EmojiSatisfied,
} from 'iconoir-react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../lib/api';
import { COUNTRY_REGIONS, COUNTRY_REGION_LABEL, getRegions, getRegionLabel, getCountryCenter } from '../lib/regions';
import Toast, { useToast } from '../components/Toast';
import usePlanUsage, { invalidatePlanCache } from '../hooks/usePlanUsage';
import UpgradeModal from '../components/dashboard/UpgradeModal';
import './Settings.css';

/* Fix leaflet marker icon paths (Vite) */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/* ── Map helpers ── */
function MapClickHandler({ onClick }) {
  useMapEvents({ click: (e) => onClick(e.latlng) });
  return null;
}
function FlyToCenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.flyTo(center, Math.max(map.getZoom(), 15), { duration: 0.6 }); }, [center]);
  return null;
}

/* ── helpers ──────────────────────────────────────────────── */
const fmtDate = (d, language = 'en') => d ? new Date(d).toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-AE', { day:'2-digit', month:'short', year:'numeric' }) : '—';

const ROLE_META = {
  superadmin: { badge:'#7c3aed', bg:'#ede9fe' },
  admin:      { badge:'#1d4ed8', bg:'#dbeafe' },
  dispatcher: { badge:'#0d9488', bg:'#ccfbf1' },
  mechanic:     { badge:'#d97706', bg:'#fef3c7' },
  customer:     { badge:'#64748b', bg:'#f1f5f9' },
};

const TIMEZONE_OPTIONS = ['Asia/Dubai','Asia/Riyadh','Asia/Kuwait','Europe/London','America/New_York'];

/* COUNTRY_REGIONS and COUNTRY_REGION_LABEL now imported from lib/regions.js */
const CURRENCY_OPTIONS = ['AED','USD','SAR','KWD','BHD','EUR','EGP','JOD','OMR','QAR','GBP','INR','PKR','PHP','BRL','CAD','AUD','SGD','MYR','IDR','TRY','ZAR','NGN','KES','GHS','MAD','TND','LBP','IQD','SYP','YER','LYD','SDG','DZD','MRU','SOS','DJF','KMF','AFN','BDT','LKR','NPR','MMK','THB','VND','KHR','LAK','CNY','JPY','KRW','TWD','HKD','MOP','NZD','FJD','PGK','WST','TOP','VUV','SBD','XPF','MXN','BZD','GTQ','HNL','NIO','CRC','PAB','COP','VES','PEN','BOB','PYG','UYU','ARS','CLP','GYD','SRD','TTD','JMD','HTG','DOP','BBD','BSD','XCD','CUP','AWG','ANG','BMD','KYD','RUB','UAH','PLN','CZK','HUF','RON','BGN','HRK','RSD','BAM','ALL','MKD','GEL','AMD','AZN','MDL','BYN','ISK','NOK','SEK','DKK','CHF'];

/* ── ISO code → emoji flag ── */
const cFlag = (code) => code ? String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';

/* ── Countries with default currency + ISO code ── */
const COUNTRIES = [
  { name: 'United Arab Emirates', code: 'AE', currency: 'AED' },
  { name: 'Saudi Arabia', code: 'SA', currency: 'SAR' },
  { name: 'Kuwait', code: 'KW', currency: 'KWD' },
  { name: 'Bahrain', code: 'BH', currency: 'BHD' },
  { name: 'Oman', code: 'OM', currency: 'OMR' },
  { name: 'Qatar', code: 'QA', currency: 'QAR' },
  { name: 'Jordan', code: 'JO', currency: 'JOD' },
  { name: 'Egypt', code: 'EG', currency: 'EGP' },
  { name: 'Iraq', code: 'IQ', currency: 'IQD' },
  { name: 'Lebanon', code: 'LB', currency: 'LBP' },
  { name: 'Syria', code: 'SY', currency: 'SYP' },
  { name: 'Yemen', code: 'YE', currency: 'YER' },
  { name: 'Libya', code: 'LY', currency: 'LYD' },
  { name: 'Sudan', code: 'SD', currency: 'SDG' },
  { name: 'Tunisia', code: 'TN', currency: 'TND' },
  { name: 'Algeria', code: 'DZ', currency: 'DZD' },
  { name: 'Morocco', code: 'MA', currency: 'MAD' },
  { name: 'Mauritania', code: 'MR', currency: 'MRU' },
  { name: 'Somalia', code: 'SO', currency: 'SOS' },
  { name: 'Djibouti', code: 'DJ', currency: 'DJF' },
  { name: 'Comoros', code: 'KM', currency: 'KMF' },
  { name: 'Palestine', code: 'PS', currency: 'ILS' },
  { name: 'United States', code: 'US', currency: 'USD' },
  { name: 'United Kingdom', code: 'GB', currency: 'GBP' },
  { name: 'India', code: 'IN', currency: 'INR' },
  { name: 'Pakistan', code: 'PK', currency: 'PKR' },
  { name: 'Philippines', code: 'PH', currency: 'PHP' },
  { name: 'Bangladesh', code: 'BD', currency: 'BDT' },
  { name: 'Sri Lanka', code: 'LK', currency: 'LKR' },
  { name: 'Nepal', code: 'NP', currency: 'NPR' },
  { name: 'Afghanistan', code: 'AF', currency: 'AFN' },
  { name: 'Turkey', code: 'TR', currency: 'TRY' },
  { name: 'Germany', code: 'DE', currency: 'EUR' },
  { name: 'France', code: 'FR', currency: 'EUR' },
  { name: 'Italy', code: 'IT', currency: 'EUR' },
  { name: 'Spain', code: 'ES', currency: 'EUR' },
  { name: 'Netherlands', code: 'NL', currency: 'EUR' },
  { name: 'Belgium', code: 'BE', currency: 'EUR' },
  { name: 'Portugal', code: 'PT', currency: 'EUR' },
  { name: 'Greece', code: 'GR', currency: 'EUR' },
  { name: 'Ireland', code: 'IE', currency: 'EUR' },
  { name: 'Austria', code: 'AT', currency: 'EUR' },
  { name: 'Finland', code: 'FI', currency: 'EUR' },
  { name: 'Canada', code: 'CA', currency: 'CAD' },
  { name: 'Australia', code: 'AU', currency: 'AUD' },
  { name: 'New Zealand', code: 'NZ', currency: 'NZD' },
  { name: 'South Africa', code: 'ZA', currency: 'ZAR' },
  { name: 'Nigeria', code: 'NG', currency: 'NGN' },
  { name: 'Kenya', code: 'KE', currency: 'KES' },
  { name: 'Ghana', code: 'GH', currency: 'GHS' },
  { name: 'Brazil', code: 'BR', currency: 'BRL' },
  { name: 'Mexico', code: 'MX', currency: 'MXN' },
  { name: 'Colombia', code: 'CO', currency: 'COP' },
  { name: 'Argentina', code: 'AR', currency: 'ARS' },
  { name: 'Chile', code: 'CL', currency: 'CLP' },
  { name: 'Peru', code: 'PE', currency: 'PEN' },
  { name: 'Singapore', code: 'SG', currency: 'SGD' },
  { name: 'Malaysia', code: 'MY', currency: 'MYR' },
  { name: 'Indonesia', code: 'ID', currency: 'IDR' },
  { name: 'Thailand', code: 'TH', currency: 'THB' },
  { name: 'Vietnam', code: 'VN', currency: 'VND' },
  { name: 'China', code: 'CN', currency: 'CNY' },
  { name: 'Japan', code: 'JP', currency: 'JPY' },
  { name: 'South Korea', code: 'KR', currency: 'KRW' },
  { name: 'Russia', code: 'RU', currency: 'RUB' },
  { name: 'Poland', code: 'PL', currency: 'PLN' },
  { name: 'Sweden', code: 'SE', currency: 'SEK' },
  { name: 'Norway', code: 'NO', currency: 'NOK' },
  { name: 'Denmark', code: 'DK', currency: 'DKK' },
  { name: 'Switzerland', code: 'CH', currency: 'CHF' },
  { name: 'Romania', code: 'RO', currency: 'RON' },
  { name: 'Czech Republic', code: 'CZ', currency: 'CZK' },
  { name: 'Hungary', code: 'HU', currency: 'HUF' },
  { name: 'Ukraine', code: 'UA', currency: 'UAH' },
  { name: 'Georgia', code: 'GE', currency: 'GEL' },
  { name: 'Myanmar', code: 'MM', currency: 'MMK' },
  { name: 'Cambodia', code: 'KH', currency: 'KHR' },
  { name: 'Hong Kong', code: 'HK', currency: 'HKD' },
  { name: 'Taiwan', code: 'TW', currency: 'TWD' },
].sort((a, b) => a.name.localeCompare(b.name));
const CATEGORY_COLORS  = ['#f97316','#3b82f6','#8b5cf6','#16a34a','#3bb4e8','#ef4444','#0d9488','#64748b','#f59e0b','#06b6d4','#84cc16','#a855f7'];

/* ── Toggle switch ────────────────────────────────────────── */
function Toggle({ on, onChange }) {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  return (
    <button type="button" onClick={() => onChange(!on)} style={{
      width:44, height:24, borderRadius:12, border:'none', cursor:'pointer',
      background: on ? '#f97316' : '#e2e8f0', position:'relative', transition:'background .2s', flexShrink:0,
    }}>
      <span style={{
        position:'absolute', top:3, [isRTL?'right':'left']: on ? 22 : 2,
        width:18, height:18, borderRadius:'50%', background:'#fff',
        boxShadow:'0 1px 4px rgba(0,0,0,.2)', transition:(isRTL?'right':'left')+' .2s',
        display:'block',
      }}/>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   GENERAL TAB
═══════════════════════════════════════════════════════════════ */
function GeneralTab({ data, setData, onSave, saving }) {
  const { t } = useTranslation();
  const s = data.settings || {};
  const set = (k, v) => setData(d => ({ ...d, settings: { ...d.settings, [k]: v } }));
  const setWorkshop = (k, v) => setData(d => ({ ...d, [k]: v }));

  const [uploadingColored, setUploadingColored] = useState(false);
  const [uploadingWhite, setUploadingWhite] = useState(false);

  /* ── Address / Map state ── */
  const [addrResults, setAddrResults] = useState([]);
  const [addrLoading, setAddrLoading] = useState(false);
  const [mapCenter, setMapCenter] = useState(null);
  const addrTimer = useRef(null);

  /* Nominatim forward geocode (debounced) — searches as user types in the single address input */
  const handleAddressChange = useCallback((val) => {
    setData(d => ({ ...d, address: val }));
    clearTimeout(addrTimer.current);
    if (!val || val.length < 3) { setAddrResults([]); return; }
    addrTimer.current = setTimeout(async () => {
      try {
        setAddrLoading(true);
        const cc = COUNTRIES.find(c => c.name === data.country)?.code?.toLowerCase() || '';
        const ccParam = cc ? `&countrycodes=${cc}` : '';
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}${ccParam}&limit=5`);
        const json = await r.json();
        setAddrResults(json.map(p => ({ display: p.display_name, lat: parseFloat(p.lat), lng: parseFloat(p.lon) })));
      } catch { setAddrResults([]); }
      setAddrLoading(false);
    }, 400);
  }, [setData, data.country]);

  /* Pick from search dropdown */
  const pickAddress = (item) => {
    setData(d => ({ ...d, address: item.display, company_lat: item.lat, company_lng: item.lng }));
    setMapCenter([item.lat, item.lng]);
    setAddrResults([]);
  };

  /* Reverse geocode on map click */
  const handleMapClick = useCallback(async (latlng) => {
    const { lat, lng } = latlng;
    setData(d => ({ ...d, company_lat: lat, company_lng: lng }));
    setMapCenter([lat, lng]);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const json = await r.json();
      if (json.display_name) setData(d => ({ ...d, address: json.display_name }));
    } catch { /* keep coords even if reverse fails */ }
  }, [setData]);

  const API_URL = import.meta.env.VITE_API_URL || '/api';

  const handleLogoUpload = async (file, variant) => {
    const isWhite = variant === 'white';
    isWhite ? setUploadingWhite(true) : setUploadingColored(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${API_URL}/uploads/logo/${variant}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await res.json();
      if (result.success) {
        const key = isWhite ? 'logo_url_white' : 'logo_url';
        setData(d => ({ ...d, [key]: result.url }));
      }
    } catch (e) { console.error('Logo upload failed:', e); }
    isWhite ? setUploadingWhite(false) : setUploadingColored(false);
  };

  const removeLogo = (variant) => {
    const key = variant === 'white' ? 'logo_url_white' : 'logo_url';
    setData(d => ({ ...d, [key]: '' }));
  };

  return (
    <form onSubmit={onSave} className="stg-content">
      <div className="stg-save-bar" style={{ marginBottom: 16 }}>
        <button type="submit" className="stg-btn-primary" disabled={saving}>
          {saving ? <><span className="stg-spin"/>{t('settings.saving')}</> : <><CheckCircle width={16} height={16}/>{t('settings.save_changes')}</>}
        </button>
      </div>
      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon orange"><Building width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.general.company_info')}</div>
            <div className="stg-section-sub">{t('settings.general.company_info_sub')}</div>
          </div>
        </div>
        <div className="stg-grid">
          <div className="stg-field">
            <label>{t('settings.general.company_name')}</label>
            <div className="stg-input-wrap"><Building width={15} height={15} className="stg-input-icon"/>
              <input value={data.name||''} onChange={e=>setWorkshop('name',e.target.value)} placeholder="Pioneer Car Service Center Co." />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.country')}</label>
            <select value={data.country||''} onChange={e=>{
              const sel = COUNTRIES.find(c=>c.name===e.target.value);
              setData(d=>({...d, country: e.target.value, ...(sel ? { currency: sel.currency } : {})}));
            }}>
              <option value="">{t('settings.general.select_country') || 'Select Country'}</option>
              {COUNTRIES.map(c=><option key={c.code} value={c.name}>{cFlag(c.code)} {c.name}</option>)}
            </select>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.company_phone')}</label>
            <div className="stg-input-wrap"><Phone width={15} height={15} className="stg-input-icon"/>
              <input value={data.phone||''} onChange={e=>setWorkshop('phone',e.target.value)} placeholder="+971 4 000 0000" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.company_email')}</label>
            <div className="stg-input-wrap"><Mail width={15} height={15} className="stg-input-icon"/>
              <input type="email" value={data.email||''} onChange={e=>setWorkshop('email',e.target.value)} placeholder="info@company.ae" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.website')}</label>
            <div className="stg-input-wrap"><Globe width={15} height={15} className="stg-input-icon"/>
              <input value={s.website||''} onChange={e=>set('website',e.target.value)} placeholder="www.company.ae" />
            </div>
          </div>
          <div className="stg-field stg-span">
            <label>{t('settings.general.company_address')}</label>
            <div className="stg-address-picker">
              {/* single unified search + address input */}
              <div className="stg-addr-search-wrap">
                <div className="stg-addr-icon">
                  <MapPin width={15} height={15} />
                </div>
                <input
                  value={data.address || ''}
                  onChange={e => handleAddressChange(e.target.value)}
                  onFocus={e => { if (e.target.value?.length >= 3) handleAddressChange(e.target.value); }}
                  onBlur={() => setTimeout(() => setAddrResults([]), 200)}
                  placeholder={t('settings.general.search_address_placeholder') || 'Search or enter company address...'}
                  className="stg-addr-search-input"
                />
                {addrLoading && <span className="stg-addr-spin" />}
                {addrResults.length > 0 && (
                  <ul className="stg-addr-dropdown">
                    {addrResults.map((r, i) => (
                      <li key={i} onMouseDown={() => pickAddress(r)}>
                        <MapPin width={14} height={14} />
                        <span>{r.display}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* lat/lng display */}
              {(data.company_lat || data.company_lng) && (
                <div className="stg-addr-coords">
                  <span>Lat: {Number(data.company_lat).toFixed(6)}</span>
                  <span>Lng: {Number(data.company_lng).toFixed(6)}</span>
                </div>
              )}
              {/* map */}
              <div className="stg-addr-map">
                <MapContainer
                  center={getCountryCenter(data.country, data.company_lat, data.company_lng)}
                  zoom={data.company_lat ? 15 : 11}
                  style={{ height: '100%', width: '100%', borderRadius: 10 }}
                  scrollWheelZoom={true}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <MapClickHandler onClick={handleMapClick} />
                  {mapCenter && <FlyToCenter center={mapCenter} />}
                  {data.company_lat && data.company_lng && (
                    <Marker position={[Number(data.company_lat), Number(data.company_lng)]} />
                  )}
                </MapContainer>
              </div>
            </div>
          </div>
          {/* ── Address detail fields ── */}
          <div className="stg-field">
            <label>{t('settings.general.building_name')}</label>
            <div className="stg-input-wrap"><Building width={15} height={15} className="stg-input-icon"/>
              <input value={data.building_name||''} onChange={e=>setWorkshop('building_name',e.target.value)} placeholder="Al Manara Tower" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.floor')}</label>
            <div className="stg-input-wrap"><StatsUpSquare width={15} height={15} className="stg-input-icon"/>
              <input value={data.floor||''} onChange={e=>setWorkshop('floor',e.target.value)} placeholder="12" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.office_number')}</label>
            <div className="stg-input-wrap"><Home width={15} height={15} className="stg-input-icon"/>
              <input value={data.office_number||''} onChange={e=>setWorkshop('office_number',e.target.value)} placeholder="1205" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.area')}</label>
            <div className="stg-input-wrap"><MapPin width={15} height={15} className="stg-input-icon"/>
              <input value={data.area||''} onChange={e=>setWorkshop('area',e.target.value)} placeholder="Business Bay" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.city')}</label>
            <input value={data.city||''} onChange={e=>setWorkshop('city',e.target.value)} placeholder="Dubai" />
          </div>
          {(COUNTRY_REGIONS[data.country]?.length > 0) && (
          <div className="stg-field">
            <label>{COUNTRY_REGION_LABEL[data.country]?.[document.documentElement.lang === 'ar' ? 'ar' : 'en'] || t('settings.general.emirate')}</label>
            <select value={data.emirate||''} onChange={e=>setWorkshop('emirate',e.target.value)}>
              <option value="">{`Select ${COUNTRY_REGION_LABEL[data.country]?.en || 'Region'}`}</option>
              {COUNTRY_REGIONS[data.country].map(e=><option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          )}
          <div className="stg-field">
            <label>{t('settings.general.vat_number')}</label>
            <div className="stg-input-wrap"><Wallet width={15} height={15} className="stg-input-icon"/>
              <input value={s.vat_number||''} onChange={e=>set('vat_number',e.target.value)} placeholder="100XXXXXXXXX003" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Logo Upload Section ── */}
      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon orange"><Upload width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.general.company_logos')}</div>
            <div className="stg-section-sub">{t('settings.general.company_logos_sub')}</div>
          </div>
        </div>
        <div className="stg-grid">
          {/* Colored Logo */}
          <div className="stg-field stg-span">
            <label>{t('settings.general.logo_colored')}</label>
            <div className="stg-logo-upload-area">
              {data.logo_url ? (
                <div className="stg-logo-preview">
                  <div className="stg-logo-preview-img" style={{ background: '#f8fafc' }}>
                    <img src={data.logo_url} alt="Colored Logo" onError={e => { e.target.style.display='none'; }} />
                  </div>
                  <div className="stg-logo-preview-info">
                    <span className="stg-logo-filename">{t('settings.general.logo_uploaded')}</span>
                    <div className="stg-logo-actions">
                      <label className="stg-logo-change-btn">
                        {t('settings.general.change_logo')}
                        <input type="file" accept="image/png,image/jpeg,image/webp" hidden
                          onChange={e => e.target.files[0] && handleLogoUpload(e.target.files[0], 'colored')} />
                      </label>
                      <button type="button" className="stg-logo-remove-btn" onClick={() => removeLogo('colored')}>
                        <Trash width={14} height={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <label className="stg-logo-dropzone">
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden
                    onChange={e => e.target.files[0] && handleLogoUpload(e.target.files[0], 'colored')} />
                  {uploadingColored ? (
                    <div className="stg-logo-uploading"><div className="stg-spinner" /> {t('settings.general.uploading')}</div>
                  ) : (
                    <>
                      <Upload width={24} height={24} style={{ color: '#94a3b8' }} />
                      <span>{t('settings.general.upload_colored_hint')}</span>
                      <small>PNG, JPG, WEBP — {t('settings.general.max_2mb')}</small>
                    </>
                  )}
                </label>
              )}
            </div>
          </div>

          {/* White Logo */}
          <div className="stg-field stg-span">
            <label>{t('settings.general.logo_white')}</label>
            <div className="stg-logo-upload-area">
              {data.logo_url_white ? (
                <div className="stg-logo-preview">
                  <div className="stg-logo-preview-img" style={{ background: '#1e293b' }}>
                    <img src={data.logo_url_white} alt="White Logo" onError={e => { e.target.style.display='none'; }} />
                  </div>
                  <div className="stg-logo-preview-info">
                    <span className="stg-logo-filename">{t('settings.general.logo_uploaded')}</span>
                    <div className="stg-logo-actions">
                      <label className="stg-logo-change-btn">
                        {t('settings.general.change_logo')}
                        <input type="file" accept="image/png,image/jpeg,image/webp" hidden
                          onChange={e => e.target.files[0] && handleLogoUpload(e.target.files[0], 'white')} />
                      </label>
                      <button type="button" className="stg-logo-remove-btn" onClick={() => removeLogo('white')}>
                        <Trash width={14} height={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <label className="stg-logo-dropzone">
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden
                    onChange={e => e.target.files[0] && handleLogoUpload(e.target.files[0], 'white')} />
                  {uploadingWhite ? (
                    <div className="stg-logo-uploading"><div className="stg-spinner" /> {t('settings.general.uploading')}</div>
                  ) : (
                    <>
                      <Upload width={24} height={24} style={{ color: '#94a3b8' }} />
                      <span>{t('settings.general.upload_white_hint')}</span>
                      <small>PNG, JPG, WEBP — {t('settings.general.max_2mb')}</small>
                    </>
                  )}
                </label>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon blue"><Globe width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.general.regional')}</div>
            <div className="stg-section-sub">{t('settings.general.regional_sub')}</div>
          </div>
        </div>
        <div className="stg-grid">
          <div className="stg-field">
            <label>{t('settings.general.timezone')}</label>
            <select value={data.timezone||'Asia/Dubai'} onChange={e=>setWorkshop('timezone',e.target.value)}>
              {TIMEZONE_OPTIONS.map(tz=><option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.currency')}</label>
            <select value={data.currency||'AED'} onChange={e=>setWorkshop('currency',e.target.value)}>
              {CURRENCY_OPTIONS.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="stg-field">
            <label>{t('settings.general.default_language')}</label>
            <select value={s.default_language||'en'} onChange={e=>set('default_language',e.target.value)}>
              <option value="en">English</option>
              <option value="ar">Arabic (العربية)</option>
            </select>
          </div>
        </div>
      </div>

    </form>
  );
}

/* ═══════════════════════════════════════════════════════════
   DELIVERY TAB
═══════════════════════════════════════════════════════════════ */
function DeliveryTab({ data, setData, onSave, saving }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const lang = i18n.language === 'ar' ? 'ar' : 'en';
  const s = data.settings || {};
  const currency = data.currency || 'AED';
  const country = data.country || 'United Arab Emirates';
  const regionOptions = COUNTRY_REGIONS[country] || [];
  const regionLabel = COUNTRY_REGION_LABEL[country]?.[lang] || (lang === 'ar' ? 'المنطقة' : 'Region');
  const set = (k, v) => setData(d => ({ ...d, settings: { ...d.settings, [k]: v } }));
  const { hasFeature, plan } = usePlanUsage();
  const canCustody = hasFeature('proof_of_custody');

  return (
    <form onSubmit={onSave} className="stg-content">
      <div className="stg-save-bar" style={{ marginBottom: 16 }}>
        <button type="submit" className="stg-btn-primary" disabled={saving}>
          {saving ? <><span className="stg-spin"/>{t('settings.saving')}</> : <><CheckCircle width={16} height={16}/>{t('settings.save_changes')}</>}
        </button>
      </div>
      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon orange"><DeliveryTruck width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.delivery.defaults')}</div>
            <div className="stg-section-sub">{t('settings.delivery.defaults_sub')}</div>
          </div>
        </div>
        <div className="stg-grid">
          {regionOptions.length > 0 && (
          <div className="stg-field">
            <label>{t('settings.delivery.default_region', { region: regionLabel })}</label>
            <select value={s.default_emirate||''} onChange={e=>set('default_emirate',e.target.value)}>
              <option value="">{lang === 'ar' ? `اختر ${regionLabel}` : `Select ${regionLabel}`}</option>
              {regionOptions.map(e=><option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          )}
          {regionOptions.length === 0 && (
          <div className="stg-field">
            <label>{t('settings.delivery.default_region', { region: regionLabel })}</label>
            <input value={s.default_emirate||''} onChange={e=>set('default_emirate',e.target.value)} placeholder={regionLabel} />
          </div>
          )}
          <div className="stg-field">
            <label>{t('settings.delivery.default_fee_dynamic', { currency })}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">{currency}</span>
              <input type="number" min="0" step="0.01" value={s.default_service_fee||''} onChange={e=>set('default_service_fee',e.target.value)} placeholder="15.00" style={{[isRTL?'paddingRight':'paddingLeft']:52}} />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.delivery.max_cod_dynamic', { currency })}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">{currency}</span>
              <input type="number" min="0" value={s.max_cash_amount||''} onChange={e=>set('max_cash_amount',e.target.value)} placeholder="5000" style={{[isRTL?'paddingRight':'paddingLeft']:52}} />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.delivery.mechanic_commission')}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">%</span>
              <input type="number" min="0" max="100" step="0.1" value={s.mechanic_commission_percent||''} onChange={e=>set('mechanic_commission_percent',e.target.value)} placeholder="20" style={{[isRTL?'paddingRight':'paddingLeft']:36}} />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.delivery.platform_commission')}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">%</span>
              <input type="number" min="0" max="100" step="0.1" value={s.platform_commission_percent||''} onChange={e=>set('platform_commission_percent',e.target.value)} placeholder="15" style={{[isRTL?'paddingRight':'paddingLeft']:36}} />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.delivery.expected_days')}</label>
            <div className="stg-input-wrap"><Clock width={15} height={15} className="stg-input-icon"/>
              <input type="number" min="1" value={s.expected_delivery_days||''} onChange={e=>set('expected_delivery_days',e.target.value)} placeholder="1" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.delivery.max_weight')}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">kg</span>
              <input type="number" min="0" step="0.1" value={s.max_weight_kg||''} onChange={e=>set('max_weight_kg',e.target.value)} placeholder="30" style={{[isRTL?'paddingRight':'paddingLeft']:38}} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Mechanic Earnings Configuration ── */}
      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon" style={{background:'#FFF7ED'}}><StatsUpSquare width={18} height={18} style={{color:'#EA580C'}}/></div>
          <div>
            <div className="stg-section-title">{t('settings.mechanicEarnings.title', 'Mechanic Earnings')}</div>
            <div className="stg-section-sub">{t('settings.mechanicEarnings.subtitle', 'Configure how much mechanics earn per delivery')}</div>
          </div>
        </div>

        {/* Earning type selector — visual cards */}
        <div style={{display:'flex',gap:12,marginBottom:20}}>
          {[
            {value:'fixed', icon:'💰', label:t('settings.mechanicEarnings.fixedLabel','Fixed Amount'), desc:t('settings.mechanicEarnings.fixedDesc','Same amount per delivery')},
            {value:'percentage', icon:'📊', label:t('settings.mechanicEarnings.pctLabel','Percentage'), desc:t('settings.mechanicEarnings.pctDesc','% of delivery fee')},
          ].map(opt => (
            <div
              key={opt.value}
              onClick={()=>set('mechanic_earning_type',opt.value)}
              style={{
                flex:1, padding:'16px 18px', borderRadius:14, cursor:'pointer', transition:'all 0.2s',
                border: (s.mechanic_earning_type||'fixed') === opt.value ? '2px solid #EA580C' : '2px solid #E2E8F0',
                background: (s.mechanic_earning_type||'fixed') === opt.value ? '#FFF7ED' : '#FFF',
              }}
            >
              <div style={{fontSize:22,marginBottom:6}}>{opt.icon}</div>
              <div style={{fontWeight:700,fontSize:14,color:'#1E293B',marginBottom:2}}>{opt.label}</div>
              <div style={{fontSize:12,color:'#64748B'}}>{opt.desc}</div>
            </div>
          ))}
        </div>

        <div className="stg-grid">
          <div className="stg-field">
            <label style={{fontWeight:600}}>
              {(s.mechanic_earning_type||'fixed') === 'percentage'
                ? t('settings.mechanicEarnings.ratePercent', 'Earning Rate (%)')
                : t('settings.mechanicEarnings.rateFixed', 'Amount per Delivery')}
            </label>
            <div className="stg-input-wrap">
              <span className="stg-prefix">{(s.mechanic_earning_type||'fixed') === 'percentage' ? '%' : currency}</span>
              <input
                type="number" min="0" step="0.01"
                value={s.mechanic_earning_rate||''}
                onChange={e=>set('mechanic_earning_rate',e.target.value)}
                placeholder={(s.mechanic_earning_type||'fixed') === 'percentage' ? '80' : '17'}
                style={{[isRTL?'paddingRight':'paddingLeft']:(s.mechanic_earning_type||'fixed') === 'percentage' ? 36 : 52}}
              />
            </div>
            <div style={{fontSize:11,color:'#94A3B8',marginTop:4}}>
              {(s.mechanic_earning_type||'fixed') === 'percentage'
                ? t('settings.mechanicEarnings.ratePercentHint', 'e.g. 80 means mechanic earns 80% of the delivery fee')
                : t('settings.mechanicEarnings.rateFixedHint', `e.g. 17 means mechanic earns ${currency} 17 per delivered order`)}
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.mechanicEarnings.codBonus', 'COD Handling Bonus (%)')}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">%</span>
              <input type="number" min="0" max="10" step="0.1" value={s.mechanic_earning_cod_pct||''} onChange={e=>set('mechanic_earning_cod_pct',e.target.value)} placeholder="0" style={{[isRTL?'paddingRight':'paddingLeft']:36}} />
            </div>
            <div style={{fontSize:11,color:'#94A3B8',marginTop:4}}>
              {t('settings.mechanicEarnings.codBonusHint', 'Extra % of COD amount as bonus for cash handling. Usually 0–2%.')}
            </div>
          </div>
        </div>

        {/* Preview calculation */}
        {Number(s.mechanic_earning_rate) > 0 && (
          <div style={{background:'#F0FDF4',border:'1px solid #BBF7D0',borderRadius:12,padding:'14px 18px',marginTop:8}}>
            <div style={{fontSize:12,fontWeight:700,color:'#15803D',marginBottom:6}}>
              {t('settings.mechanicEarnings.preview', '💡 Example Calculation')}
            </div>
            <div style={{fontSize:13,color:'#166534'}}>
              {(s.mechanic_earning_type||'fixed') === 'percentage'
                ? t('settings.mechanicEarnings.previewPct', `Delivery fee ${currency} 25 → Mechanic earns ${currency} {{amount}}`, {amount: (25 * (Number(s.mechanic_earning_rate)||0) / 100).toFixed(2)})
                : t('settings.mechanicEarnings.previewFixed', `Each delivery → Mechanic earns ${currency} {{amount}}`, {amount: Number(s.mechanic_earning_rate||0).toFixed(2)})}
              {Number(s.mechanic_earning_cod_pct) > 0 && ` + ${(500 * Number(s.mechanic_earning_cod_pct) / 100).toFixed(2)} COD bonus (on ${currency} 500 COD)`}
            </div>
          </div>
        )}
      </div>

      {/* ── Tax & VAT Configuration (#61 #73) ── */}
      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon green" style={{background:'#dcfce7'}}><Wallet width={18} height={18} style={{color:'#16a34a'}}/></div>
          <div>
            <div className="stg-section-title">{t('settings.tax.title')}</div>
            <div className="stg-section-sub">{t('settings.tax.subtitle')}</div>
          </div>
        </div>
        <div className="stg-toggles" style={{marginBottom:16}}>
          <div className="stg-toggle-row">
            <div>
              <div className="stg-toggle-label">{t('settings.tax.vat_enabled')}</div>
              <div className="stg-toggle-desc">{t('settings.tax.vat_enabled_desc')}</div>
            </div>
            <Toggle on={!!s.vat_enabled} onChange={v => set('vat_enabled', v)} />
          </div>
          {s.vat_enabled && (
            <div className="stg-toggle-row">
              <div>
                <div className="stg-toggle-label">{t('settings.tax.apply_on_delivery')}</div>
                <div className="stg-toggle-desc">{t('settings.tax.apply_on_delivery_desc')}</div>
              </div>
              <Toggle on={s.apply_vat_on_service_fee !== false} onChange={v => set('apply_vat_on_service_fee', v)} />
            </div>
          )}
        </div>
        {s.vat_enabled && (
          <div className="stg-grid">
            <div className="stg-field">
              <label>{t('settings.tax.vat_rate')}</label>
              <div className="stg-input-wrap"><span className="stg-prefix">%</span>
                <input type="number" min="0" max="100" step="0.01" value={s.vat_rate||''} onChange={e=>set('vat_rate',e.target.value)} placeholder="5" style={{[isRTL?'paddingRight':'paddingLeft']:36}} />
              </div>
            </div>
            <div className="stg-field">
              <label>{t('settings.tax.vat_trn')}</label>
              <div className="stg-input-wrap"><Wallet width={15} height={15} className="stg-input-icon"/>
                <input value={s.vat_number||''} onChange={e=>set('vat_number',e.target.value)} placeholder="100XXXXXXXXX003" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── NEW FINANCIAL SETTINGS (#63–#109) ────────────────── */}
      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon purple"><Wallet width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.financial.title')}</div>
            <div className="stg-section-sub">{t('settings.financial.subtitle')}</div>
          </div>
        </div>
        <div className="stg-grid">
          <div className="stg-field">
            <label>{t('settings.financial.commission_rate')}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">%</span>
              <input type="number" min="0" max="100" step="0.01" value={s.commission_rate||''} onChange={e=>set('commission_rate',e.target.value)} placeholder="10" style={{[isRTL?'paddingRight':'paddingLeft']:36}} />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.financial.platform_fee')}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">%</span>
              <input type="number" min="0" max="100" step="0.01" value={s.platform_fee_pct||''} onChange={e=>set('platform_fee_pct',e.target.value)} placeholder="2" style={{[isRTL?'paddingRight':'paddingLeft']:36}} />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.financial.payment_gateway_fee')}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">%</span>
              <input type="number" min="0" max="10" step="0.01" value={s.payment_gateway_fee_pct||''} onChange={e=>set('payment_gateway_fee_pct',e.target.value)} placeholder="2.5" style={{[isRTL?'paddingRight':'paddingLeft']:36}} />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.financial.free_delivery_min')}</label>
            <div className="stg-input-wrap"><Wallet width={15} height={15} className="stg-input-icon"/>
              <input type="number" min="0" step="1" value={s.free_delivery_min_order||''} onChange={e=>set('free_delivery_min_order',e.target.value)} placeholder="100" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.financial.late_settlement_fee')}</label>
            <div className="stg-input-wrap"><span className="stg-prefix">%</span>
              <input type="number" min="0" max="50" step="0.1" value={s.late_settlement_fee_pct||''} onChange={e=>set('late_settlement_fee_pct',e.target.value)} placeholder="5" style={{[isRTL?'paddingRight':'paddingLeft']:36}} />
            </div>
          </div>
        </div>
      </div>

      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon purple"><ToggleOn width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.delivery.feature_toggles')}</div>
            <div className="stg-section-sub">{t('settings.delivery.feature_toggles_sub')}</div>
          </div>
        </div>
        <div className="stg-toggles">
          {[
            { key:'cod_enabled',           label:t('settings.delivery.cod_enabled'),         desc:t('settings.delivery.cod_desc') },
            { key:'return_enabled',        label:t('settings.delivery.return_enabled'),      desc:t('settings.delivery.return_desc') },
            { key:'express_enabled',       label:t('settings.delivery.express_enabled'),     desc:t('settings.delivery.express_desc') },
            { key:'sms_tracking_enabled',  label:t('settings.delivery.sms_tracking'),        desc:t('settings.delivery.sms_tracking_desc') },
            { key:'email_tracking_enabled',label:t('settings.delivery.email_tracking'),      desc:t('settings.delivery.email_tracking_desc') },
            { key:'mechanic_tip_enabled',    label:t('settings.delivery.mechanic_tips'),         desc:t('settings.delivery.mechanic_tips_desc') },
          ].map(({ key, label, desc }) => (
            <div key={key} className="stg-toggle-row">
              <div>
                <div className="stg-toggle-label">{label}</div>
                <div className="stg-toggle-desc">{desc}</div>
              </div>
              <Toggle on={!!s[key]} onChange={v => set(key, v)} />
            </div>
          ))}
        </div>
      </div>

      <div className="stg-section" style={{ position: 'relative' }}>
        <div className="stg-section-head">
          <div className="stg-section-icon teal"><Camera width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.delivery.mechanic_app_requirements', 'Mechanic App Requirements')}</div>
            <div className="stg-section-sub">{t('settings.delivery.mechanic_app_requirements_sub', 'Configure what mechanics must provide when completing deliveries')}</div>
          </div>
        </div>
        {!canCustody && (
          <div style={{ position:'absolute', inset:0, zIndex:5, background:'rgba(255,255,255,0.7)', backdropFilter:'blur(2px)', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:6 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span style={{ fontWeight:600, color:'#7c3aed', fontSize:14 }}>Growth Plan Required</span>
            <span style={{ fontSize:12, color:'#64748b' }}>Proof-of-delivery requirements need Growth or higher</span>
          </div>
        )}
        <div className="stg-toggles">
          {[
            { key:'require_photo_proof',  label:t('settings.delivery.require_photo_proof', 'Require Photo Proof'),    desc:t('settings.delivery.require_photo_proof_desc', 'Mechanics must take at least one photo before confirming delivery') },
            { key:'require_signature',    label:t('settings.delivery.require_signature', 'Require Signature'),       desc:t('settings.delivery.require_signature_desc', 'Mechanics must capture recipient signature before confirming delivery') },
            { key:'require_barcode_scan', label:t('settings.delivery.require_barcode_scan', 'Require Barcode Scan'),  desc:t('settings.delivery.require_barcode_scan_desc', 'Mechanics must scan the package barcode before confirming delivery') },
          ].map(({ key, label, desc }) => (
            <div key={key} className="stg-toggle-row">
              <div>
                <div className="stg-toggle-label">{label}</div>
                <div className="stg-toggle-desc">{desc}</div>
              </div>
              <Toggle on={!!s[key]} onChange={v => set(key, v)} />
            </div>
          ))}
        </div>
      </div>

    </form>
  );
}

/* ═══════════════════════════════════════════════════════════
   NOTIFICATIONS TAB
═══════════════════════════════════════════════════════════════ */
function NotificationsTab({ data, setData, onSave, saving }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const s = data.settings || {};
  const set = (k, v) => setData(d => ({ ...d, settings: { ...d.settings, [k]: v } }));
  const [showPass, setShowPass] = useState(false);
  const { hasFeature, plan } = usePlanUsage();
  const canCustomSms = hasFeature('custom_sms_sender');

  return (
    <form onSubmit={onSave} className="stg-content">
      <div className="stg-save-bar" style={{ marginBottom: 16 }}>
        <button type="submit" className="stg-btn-primary" disabled={saving}>
          {saving ? <><span className="stg-spin"/>{t('settings.saving')}</> : <><CheckCircle width={16} height={16}/>{t('settings.save_changes')}</>}
        </button>
      </div>
      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon blue"><Mail width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.notifications.email_smtp')}</div>
            <div className="stg-section-sub">{t('settings.notifications.email_smtp_sub')}</div>
          </div>
        </div>
        <div className="stg-grid">
          <div className="stg-field">
            <label>{t('settings.notifications.smtp_host')}</label>
            <input value={s.smtp_host||''} onChange={e=>set('smtp_host',e.target.value)} placeholder="smtp.office365.com" />
          </div>
          <div className="stg-field">
            <label>{t('settings.notifications.smtp_port')}</label>
            <input type="number" value={s.smtp_port||''} onChange={e=>set('smtp_port',e.target.value)} placeholder="587" />
          </div>
          <div className="stg-field">
            <label>{t('settings.notifications.smtp_username')}</label>
            <div className="stg-input-wrap"><Mail width={15} height={15} className="stg-input-icon"/>
              <input value={s.smtp_user||''} onChange={e=>set('smtp_user',e.target.value)} placeholder="noreply@company.ae" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.notifications.smtp_password')}</label>
            <div className="stg-input-wrap" style={{position:'relative'}}>
              <input type={showPass?'text':'password'} value={s.smtp_pass||''} onChange={e=>set('smtp_pass',e.target.value)} placeholder="••••••••••" style={{[isRTL?'paddingLeft':'paddingRight']:40}} />
              <button type="button" onClick={()=>setShowPass(p=>!p)} style={{position:'absolute',[isRTL?'left':'right']:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:0}}>
                {showPass ? <EyeClosed width={15} height={15}/> : <Eye width={15} height={15}/>}
              </button>
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.notifications.from_name')}</label>
            <input value={s.email_from_name||''} onChange={e=>set('email_from_name',e.target.value)} placeholder="Pioneer Car Service Center" />
          </div>
          <div className="stg-field">
            <label>{t('settings.notifications.reply_to')}</label>
            <input type="email" value={s.email_reply_to||''} onChange={e=>set('email_reply_to',e.target.value)} placeholder="support@company.ae" />
          </div>
        </div>
      </div>

      <div className="stg-section" style={{ position:'relative' }}>
        {!canCustomSms && (
          <div style={{ position:'absolute', inset:0, background:'rgba(255,255,255,0.75)', backdropFilter:'blur(2px)',
            zIndex:10, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8 }}>
            <ShieldCheck width={28} height={28} style={{ color:'#7c3aed' }} />
            <span style={{ fontWeight:700, fontSize:15, color:'#5b21b6' }}>Growth Plan Required</span>
            <span style={{ fontSize:13, color:'#64748b' }}>Upgrade to customize your SMS sender ID</span>
          </div>
        )}
        <div className="stg-section-head">
          <div className="stg-section-icon green"><Bell width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.notifications.sms_title')}</div>
            <div className="stg-section-sub">{t('settings.notifications.sms_sub')}</div>
          </div>
        </div>
        <div className="stg-grid">
          <div className="stg-field">
            <label>{t('settings.notifications.sms_sender_id')}</label>
            <input value={s.sms_sender_id||''} onChange={e=>set('sms_sender_id',e.target.value)} placeholder="PIONEER" maxLength={11} />
          </div>
          <div className="stg-field">
            <label>{t('settings.notifications.twilio_sid')}</label>
            <input value={s.twilio_sid||''} onChange={e=>set('twilio_sid',e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </div>
          <div className="stg-field">
            <label>{t('settings.notifications.twilio_token')}</label>
            <input type="password" value={s.twilio_token||''} onChange={e=>set('twilio_token',e.target.value)} placeholder="••••••••••••••••••••••••••••••••" />
          </div>
          <div className="stg-field">
            <label>{t('settings.notifications.twilio_phone')}</label>
            <div className="stg-input-wrap"><Phone width={15} height={15} className="stg-input-icon"/>
              <input value={s.twilio_phone||''} onChange={e=>set('twilio_phone',e.target.value)} placeholder="+12015550123" />
            </div>
          </div>
        </div>
        <div className="stg-info-box">
          <Bell width={14} height={14}/>
          {t('settings.notifications.sms_info')}
        </div>
      </div>

    </form>
  );
}

/* ═══════════════════════════════════════════════════════════
   SHIPPING LABELS TAB (Module B)
═══════════════════════════════════════════════════════════════ */
function ShippingLabelsTab({ data, setData, onSave, saving }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const s = data.settings || {};
  const lt = (s.label_template && typeof s.label_template === 'object') ? s.label_template : {};

  const setLT = (k, v) => {
    setData(d => ({
      ...d,
      settings: {
        ...d.settings,
        label_template: { ...(d.settings?.label_template || {}), [k]: v },
      },
    }));
  };

  const LABEL_SIZES = [
    { value: 'A6',  label: 'A6 (4.13 × 5.83 in)' },
    { value: 'A5',  label: 'A5 (5.83 × 8.27 in)' },
    { value: '4x6', label: '4 × 6 in' },
  ];

  const LOGO_POSITIONS = [
    { value: 'left',   label: t('settings.labels.pos_left', 'Left') },
    { value: 'center', label: t('settings.labels.pos_center', 'Center') },
    { value: 'right',  label: t('settings.labels.pos_right', 'Right') },
  ];

  const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

  const previewLabel = () => {
    const token = localStorage.getItem('auth_token');
    // Use a recent order or a dummy preview - try fetching from API
    fetch(`${API_BASE_URL}/work-orders?limit=1`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(res => {
        if (res.success && res.data?.length) {
          const workOrderId = res.data[0].id;
          fetch(`${API_BASE_URL}/work-orders/${workOrderId}/label`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.blob())
            .then(blob => {
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            });
        }
      })
      .catch(e => console.error('Preview error:', e));
  };

  return (
    <form onSubmit={onSave} className="stg-content">
      <div className="stg-save-bar" style={{ marginBottom: 16 }}>
        <button type="submit" className="stg-btn-primary" disabled={saving}>
          {saving ? <><span className="stg-spin"/>{t('settings.saving')}</> : <><CheckCircle width={16} height={16}/>{t('settings.save_changes')}</>}
        </button>
      </div>

      {/* ── Label Size & Layout ── */}
      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon orange"><Printer width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.labels.layout_title', 'Label Layout')}</div>
            <div className="stg-section-sub">{t('settings.labels.layout_sub', 'Configure the size and appearance of shipping labels')}</div>
          </div>
        </div>
        <div className="stg-grid">
          <div className="stg-field">
            <label>{t('settings.labels.label_size', 'Label Size')}</label>
            <select value={lt.label_size || 'A6'} onChange={e => setLT('label_size', e.target.value)}>
              {LABEL_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="stg-field">
            <label>{t('settings.labels.logo_position', 'Logo Position')}</label>
            <select value={lt.logo_position || 'left'} onChange={e => setLT('logo_position', e.target.value)}>
              {LOGO_POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="stg-field">
            <label>{t('settings.labels.accent_color', 'Accent Color')}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={lt.accent_color || '#f97316'} onChange={e => setLT('accent_color', e.target.value)}
                style={{ width: 40, height: 32, border: '1px solid #e2e8f0', borderRadius: 6, padding: 2, cursor: 'pointer' }} />
              <input type="text" value={lt.accent_color || '#f97316'} onChange={e => setLT('accent_color', e.target.value)}
                style={{ width: 90, fontFamily: 'monospace', fontSize: 13 }} placeholder="#f97316" />
            </div>
          </div>
          <div className="stg-field">
            <label>{t('settings.labels.cod_badge_color', 'COD Badge Color')}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={lt.cod_badge_color || '#dc2626'} onChange={e => setLT('cod_badge_color', e.target.value)}
                style={{ width: 40, height: 32, border: '1px solid #e2e8f0', borderRadius: 6, padding: 2, cursor: 'pointer' }} />
              <input type="text" value={lt.cod_badge_color || '#dc2626'} onChange={e => setLT('cod_badge_color', e.target.value)}
                style={{ width: 90, fontFamily: 'monospace', fontSize: 13 }} placeholder="#dc2626" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Visibility Toggles ── */}
      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon blue"><Eye width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.labels.visibility_title', 'Label Content')}</div>
            <div className="stg-section-sub">{t('settings.labels.visibility_sub', 'Choose which elements appear on the shipping label')}</div>
          </div>
        </div>
        <div className="stg-toggles">
          {[
            { key: 'show_logo',         label: t('settings.labels.show_logo', 'Company Logo'),        desc: t('settings.labels.show_logo_desc', 'Display your company logo on the label header') },
            { key: 'show_barcode',       label: t('settings.labels.show_barcode', 'Barcode'),           desc: t('settings.labels.show_barcode_desc', 'CODE128 barcode for scanner compatibility') },
            { key: 'show_qr',           label: t('settings.labels.show_qr', 'QR Code'),              desc: t('settings.labels.show_qr_desc', 'QR code linking to order tracking page') },
            { key: 'show_sender',       label: t('settings.labels.show_sender', 'Sender Info'),       desc: t('settings.labels.show_sender_desc', 'Show sender name, phone, and address') },
            { key: 'show_recipient',    label: t('settings.labels.show_recipient', 'Recipient Info'),  desc: t('settings.labels.show_recipient_desc', 'Show recipient name, phone, and address') },
            { key: 'show_order_info',   label: t('settings.labels.show_order_info', 'WorkOrder Details'),  desc: t('settings.labels.show_order_info_desc', 'Display weight, dimensions, and piece count') },
            { key: 'show_cod_badge',    label: t('settings.labels.show_cod_badge', 'COD Badge'),       desc: t('settings.labels.show_cod_badge_desc', 'Show cash-on-delivery amount badge') },
            { key: 'show_instructions', label: t('settings.labels.show_instructions', 'Special Instructions'), desc: t('settings.labels.show_instructions_desc', 'Show special handling instructions box') },
            { key: 'show_awb',          label: t('settings.labels.show_awb', 'AWB Number'),           desc: t('settings.labels.show_awb_desc', 'Display Air Waybill number in footer') },
          ].map(({ key, label, desc }) => (
            <div key={key} className="stg-toggle-row">
              <div>
                <div className="stg-toggle-label">{label}</div>
                <div className="stg-toggle-desc">{desc}</div>
              </div>
              <Toggle on={lt[key] !== false} onChange={v => setLT(key, v)} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Preview ── */}
      <div className="stg-section" style={{ textAlign: 'center', padding: '20px 0' }}>
        <button type="button" className="module-btn module-btn-outline" onClick={previewLabel}
          style={{ color: '#f97316', borderColor: '#fed7aa', gap: 6 }}>
          <Eye width={16} height={16} /> {t('settings.labels.preview', 'Preview Label')}
        </button>
      </div>

    </form>
  );
}

/* ═══════════════════════════════════════════════════════════
   CATEGORIES TAB
═══════════════════════════════════════════════════════════════ */
function CategoriesTab({ toast }) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editing, setEditing]       = useState(null);
  const [saving, setSaving]         = useState(false);
  const emptyForm = { name:'', name_ar:'', color:'#f97316', icon:'package', description:'' };
  const [form, setForm]             = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get('/settings/categories');
    if (res.success) setCategories(res.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd  = () => { setEditing(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = c  => { setEditing(c); setForm({ name:c.name, name_ar:c.name_ar||'', color:c.color||'#f97316', icon:c.icon||'package', description:c.description||'' }); setShowModal(true); };

  const handleSave = async e => {
    e.preventDefault(); setSaving(true);
    const res = editing
      ? await api.put('/settings/categories/'+editing.id, form)
      : await api.post('/settings/categories', form);
    if (res.success) {
      toast('success', editing ? t('settings.categories.updated') : t('settings.categories.created'));
      setShowModal(false); load();
    } else {
      toast('error', res.message || t('settings.categories.save_failed'));
    }
    setSaving(false);
  };

  const handleDelete = async cat => {
    if (!confirm(t('settings.categories.delete_confirm', { name: cat.name }))) return;
    const res = await api.delete('/settings/categories/'+cat.id);
    if (res.success) { toast('success', t('settings.categories.deleted')); load(); }
    else toast('error', t('settings.categories.delete_failed'));
  };

  const handleToggle = async cat => {
    await api.put('/settings/categories/'+cat.id, { ...cat, is_active: !cat.is_active });
    load();
  };

  if (loading) return <div className="stg-loader">{t('settings.categories.loading')}</div>;

  return (
    <div className="stg-content">
      <div className="stg-section">
        <div className="stg-section-head" style={{justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div className="stg-section-icon purple"><Tag width={18} height={18}/></div>
            <div>
              <div className="stg-section-title">{t('settings.categories.title')}</div>
              <div className="stg-section-sub">{t('settings.categories.count', { count: categories.length })}</div>
            </div>
          </div>
          <button className="stg-btn-primary" type="button" onClick={openAdd}>
            <Plus width={15} height={15}/> {t('settings.categories.add')}
          </button>
        </div>

        <div className="stg-cat-grid">
          {categories.map(cat => (
            <div key={cat.id} className={'stg-cat-card'+(cat.is_active?'':' stg-cat-inactive')}>
              <div className="stg-cat-swatch" style={{background:cat.color+'18',border:'2px solid '+cat.color+'40'}}>
                <div className="stg-cat-dot" style={{background:cat.color}}/>
              </div>
              <div className="stg-cat-info">
                <div className="stg-cat-name">{cat.name}</div>
                {cat.name_ar && <div className="stg-cat-ar" dir="rtl">{cat.name_ar}</div>}
                {cat.description && <div className="stg-cat-desc">{cat.description}</div>}
              </div>
              <div className="stg-cat-actions">
                <Toggle on={!!cat.is_active} onChange={() => handleToggle(cat)} />
                <button type="button" className="stg-icon-btn blue" onClick={() => openEdit(cat)} title="Edit"><EditPencil width={14} height={14}/></button>
                <button type="button" className="stg-icon-btn red"  onClick={() => handleDelete(cat)} title="Delete"><Trash width={14} height={14}/></button>
              </div>
            </div>
          ))}
          {categories.length === 0 && (
            <div className="stg-empty"><Tag width={36} height={36}/><p>{t('settings.categories.empty')}</p></div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="stg-overlay" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="stg-modal">
            <div className="stg-modal-head">
              <span>{editing ? t('settings.categories.edit_title') : t('settings.categories.new_title')}</span>
              <button type="button" onClick={()=>setShowModal(false)} className="stg-modal-close"><Xmark width={18} height={18}/></button>
            </div>
            <form onSubmit={handleSave} className="stg-modal-body">
              <div className="stg-grid">
                <div className="stg-field">
                  <label>{t('settings.categories.name_en')}</label>
                  <input required value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Electronics" />
                </div>
                <div className="stg-field">
                  <label>{t('settings.categories.name_ar')}</label>
                  <input dir="rtl" value={form.name_ar} onChange={e=>setForm(f=>({...f,name_ar:e.target.value}))} placeholder="إلكترونيات" />
                </div>
                <div className="stg-field stg-span">
                  <label>{t('settings.categories.description')}</label>
                  <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Short description (optional)" />
                </div>
                <div className="stg-field stg-span">
                  <label>{t('settings.categories.color')}</label>
                  <div className="stg-color-picker">
                    {CATEGORY_COLORS.map(c => (
                      <button key={c} type="button"
                        className={'stg-color-swatch'+(form.color===c?' selected':'')}
                        style={{background:c, outline: form.color===c?'3px solid '+c:undefined, outlineOffset:2}}
                        onClick={() => setForm(f=>({...f,color:c}))} />
                    ))}
                    <input type="color" value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value}))} className="stg-color-custom" title="Custom color" />
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginTop:10}}>
                    <div style={{width:32,height:32,borderRadius:8,background:form.color+'22',border:'2px solid '+form.color,display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <div style={{width:14,height:14,borderRadius:'50%',background:form.color}}/>
                    </div>
                    <span style={{fontSize:12,fontFamily:'monospace',color:'#475569',fontWeight:600}}>{form.color}</span>
                  </div>
                </div>
              </div>
              <div className="stg-modal-footer">
                <button type="button" className="stg-btn-ghost" onClick={()=>setShowModal(false)}>{t('settings.categories.cancel')}</button>
                <button type="submit" className="stg-btn-primary" disabled={saving}>
                  {saving ? <><span className="stg-spin"/>{t('settings.categories.saving')}</> : (editing ? t('settings.categories.update') : t('settings.categories.create'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ROLES & PERMISSIONS TAB
═══════════════════════════════════════════════════════════════ */

const MODULE_SECTIONS = {
  main:       { label: 'Main', icon: <Home width={16} height={16} /> },
  operations: { label: 'Operations', icon: <Package width={16} height={16} /> },
  finance:    { label: 'Finance', icon: <Wallet width={16} height={16} /> },
  analytics:  { label: 'Analytics', icon: <StatsUpSquare width={16} height={16} /> },
  config:     { label: 'Configuration', icon: <SettingsIcon width={16} height={16} /> },
  system:     { label: 'System', icon: <Wrench width={16} height={16} /> },
  mechanic:     { label: 'Mechanic Tools', icon: <DeliveryTruck width={16} height={16} /> },
};

function RolesTab({ toast }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [roles, setRoles]         = useState([]);
  const [modules, setModules]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editRole, setEditRole]   = useState(null);   // null = list view, object = editing
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving]       = useState(false);

  const emptyForm = { name: '', name_ar: '', slug: '', description: '', modules: [] };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    const [rolesRes, modsRes] = await Promise.all([
      api.get('/settings/roles'),
      api.get('/settings/modules'),
    ]);
    if (rolesRes.success) setRoles(rolesRes.data || []);
    if (modsRes.success) setModules(modsRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const g = {};
    for (const m of modules) {
      if (!g[m.section]) g[m.section] = [];
      g[m.section].push(m);
    }
    return g;
  }, [modules]);

  const toggleModule = (key) => {
    setForm(f => ({
      ...f,
      modules: f.modules.includes(key) ? f.modules.filter(k => k !== key) : [...f.modules, key],
    }));
  };

  const toggleSection = (sectionModules) => {
    const keys = sectionModules.map(m => m.key);
    const allSelected = keys.every(k => form.modules.includes(k));
    setForm(f => ({
      ...f,
      modules: allSelected
        ? f.modules.filter(k => !keys.includes(k))
        : [...new Set([...f.modules, ...keys])],
    }));
  };

  const selectAll = () => {
    setForm(f => ({ ...f, modules: modules.map(m => m.key) }));
  };
  const clearAll = () => {
    setForm(f => ({ ...f, modules: [] }));
  };

  const startEdit = (role) => {
    setForm({
      name: role.name,
      name_ar: role.name_ar || '',
      slug: role.slug,
      description: role.description || '',
      modules: Array.isArray(role.modules) ? [...role.modules] : [],
    });
    setEditRole(role);
    setShowCreate(false);
  };

  const startCreate = () => {
    setForm(emptyForm);
    setEditRole(null);
    setShowCreate(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    if (editRole) {
      const res = await api.put('/settings/roles/' + editRole.id, form);
      if (res.success) {
        toast('success', t('settings.roles_tab.saved'));
        setEditRole(null);
        load();
      } else {
        toast('error', res.message || t('settings.roles_tab.save_failed'));
      }
    } else {
      const res = await api.post('/settings/roles', form);
      if (res.success) {
        toast('success', t('settings.roles_tab.created'));
        setShowCreate(false);
        load();
      } else {
        toast('error', res.message || t('settings.roles_tab.create_failed'));
      }
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm(t('settings.roles_tab.delete_confirm'))) return;
    const res = await api.delete('/settings/roles/' + id);
    if (res.success) {
      toast('success', t('settings.roles_tab.deleted'));
      load();
    } else {
      toast('error', res.message || t('settings.roles_tab.delete_failed'));
    }
  };

  if (loading) return <div className="stg-loader">{t('settings.loading')}</div>;

  // Editing / creating form view
  if (editRole || showCreate) {
    return (
      <div className="stg-content">
        <div className="stg-section">
          <div className="stg-section-head" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="stg-section-icon" style={{ background: '#7c3aed20', color: '#7c3aed' }}>
                <ShieldCheck width={18} height={18} />
              </div>
              <div>
                <div className="stg-section-title">
                  {editRole ? t('settings.roles_tab.edit_role') : t('settings.roles_tab.new_role')}
                </div>
                <div className="stg-section-sub">
                  {editRole ? editRole.name : t('settings.roles_tab.new_role_sub')}
                </div>
              </div>
            </div>
            <button className="stg-btn-ghost" type="button" onClick={() => { setEditRole(null); setShowCreate(false); }}>
              ← {t('settings.roles_tab.back')}
            </button>
          </div>

          <form onSubmit={handleSave}>
            <div className="stg-grid" style={{ padding: '0 0 20px' }}>
              <div className="stg-field">
                <label>{t('settings.roles_tab.role_name')}</label>
                <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                       placeholder="e.g. Manager" />
              </div>
              <div className="stg-field">
                <label>{t('settings.roles_tab.role_name_ar')}</label>
                <input value={form.name_ar} onChange={e => setForm(f => ({ ...f, name_ar: e.target.value }))}
                       placeholder="e.g. مدير" dir="rtl" />
              </div>
              {!editRole && (
                <div className="stg-field">
                  <label>{t('settings.roles_tab.slug')}</label>
                  <input required value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') }))}
                         placeholder="e.g. manager" style={{ fontFamily: 'monospace' }} />
                </div>
              )}
              <div className="stg-field" style={{ gridColumn: '1/-1' }}>
                <label>{t('settings.roles_tab.description')}</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                       placeholder={t('settings.roles_tab.description_placeholder')} />
              </div>
            </div>

            {/* Module permissions */}
            <div style={{ padding: '0 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>
                {t('settings.roles_tab.module_permissions')} ({form.modules.length}/{modules.length})
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="stg-btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={selectAll}>
                  {t('settings.roles_tab.select_all')}
                </button>
                <button type="button" className="stg-btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={clearAll}>
                  {t('settings.roles_tab.clear_all')}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              {Object.entries(grouped).map(([section, mods]) => {
                const sectionMeta = MODULE_SECTIONS[section] || { label: section, icon: <Page width={16} height={16} /> };
                const allChecked = mods.every(m => form.modules.includes(m.key));
                const someChecked = mods.some(m => form.modules.includes(m.key));
                return (
                  <div key={section} style={{
                    border: '1px solid #e2e8f0', borderRadius: 12,
                    overflow: 'hidden', background: '#fff'
                  }}>
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 16px', background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0', cursor: 'pointer',
                      }}
                      onClick={() => toggleSection(mods)}
                    >
                      <input type="checkbox" checked={allChecked} readOnly
                             style={{ accentColor: '#7c3aed', width: 16, height: 16 }}
                             ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }} />
                      <span style={{ display: 'flex', alignItems: 'center' }}>{sectionMeta.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {t('settings.roles_tab.section_' + section, sectionMeta.label)}
                      </span>
                      <span style={{ marginInlineStart: 'auto', fontSize: 12, color: '#94a3b8' }}>
                        {mods.filter(m => form.modules.includes(m.key)).length}/{mods.length}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 4, padding: '8px 12px' }}>
                      {mods.map(m => (
                        <label key={m.key} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                          background: form.modules.includes(m.key) ? '#7c3aed10' : 'transparent',
                          transition: 'background 0.15s',
                        }}>
                          <input type="checkbox" checked={form.modules.includes(m.key)}
                                 onChange={() => toggleModule(m.key)}
                                 style={{ accentColor: '#7c3aed', width: 15, height: 15 }} />
                          <span style={{ fontSize: 13, fontWeight: form.modules.includes(m.key) ? 600 : 400, color: '#334155' }}>
                            {m.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingBottom: 20 }}>
              <button type="button" className="stg-btn-ghost" onClick={() => { setEditRole(null); setShowCreate(false); }}>
                {t('settings.roles_tab.cancel')}
              </button>
              <button type="submit" className="stg-btn-primary" disabled={saving}>
                {saving ? t('settings.roles_tab.saving') : editRole ? t('settings.roles_tab.save_changes') : t('settings.roles_tab.create_role')}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="stg-content">
      <div className="stg-section">
        <div className="stg-section-head" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="stg-section-icon" style={{ background: '#7c3aed20', color: '#7c3aed' }}>
              <ShieldCheck width={18} height={18} />
            </div>
            <div>
              <div className="stg-section-title">{t('settings.roles_tab.title')}</div>
              <div className="stg-section-sub">{t('settings.roles_tab.count', { count: roles.length })}</div>
            </div>
          </div>
          <button className="stg-btn-primary" type="button" onClick={startCreate}>
            <Plus width={15} height={15} /> {t('settings.roles_tab.add_role')}
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {roles.map(role => {
            const mCount = Array.isArray(role.modules) ? role.modules.length : 0;
            return (
              <div key={role.id} style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '16px 20px', border: '1px solid #e2e8f0',
                borderRadius: 12, background: '#fff',
                transition: 'box-shadow 0.15s',
              }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: role.is_system ? 'linear-gradient(135deg, #7c3aed33, #7c3aed66)' : 'linear-gradient(135deg, #f9731633, #f9731666)',
                  fontSize: 18, fontWeight: 800,
                  color: role.is_system ? '#7c3aed' : '#f97316',
                }}>
                  {(role.name || '?')[0].toUpperCase()}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>
                    {isRTL && role.name_ar ? role.name_ar : role.name}
                    {role.is_system && (
                      <span style={{
                        marginInlineStart: 8, fontSize: 10, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 20,
                        background: '#ede9fe', color: '#7c3aed',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}>
                        {t('settings.roles_tab.system')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    {role.description || role.slug}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#f1f5f9', color: '#64748b', fontWeight: 600 }}>
                      {t('settings.roles_tab.users_count', { count: role.user_count || 0 })}
                    </span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#f0fdf4', color: '#16a34a', fontWeight: 600 }}>
                      {t('settings.roles_tab.modules_count', { count: mCount })}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="stg-icon-btn" onClick={() => startEdit(role)} title={t('settings.roles_tab.edit')}>
                    <EditPencil width={14} height={14} />
                  </button>
                  {!role.is_system && (
                    <button className="stg-icon-btn red" onClick={() => handleDelete(role.id)} title={t('settings.roles_tab.delete')}>
                      <Trash width={14} height={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {roles.length === 0 && (
            <div className="stg-empty">
              <ShieldCheck width={36} height={36} />
              <p>{t('settings.roles_tab.empty')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   USERS TAB
═══════════════════════════════════════════════════════════════ */
function UsersTab({ toast }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { user: currentUser } = useContext(AuthContext);
  const { isAtUserLimit, usage, refresh: refreshPlan } = usePlanUsage();
  const [users, setUsers]        = useState([]);
  const [roles, setRoles]        = useState([]);
  const [loading, setLoading]    = useState(true);
  const [showModal, setShowModal]= useState(false);
  const [saving, setSaving]      = useState(false);
  const [showPw, setShowPw]      = useState(false);
  const [credentials, setCredentials] = useState(null); // { username, password, email, email_sent }
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState(null);
  const emptyForm = { username:'', full_name:'', email:'', phone:'', password:'', role:'dispatcher', role_id: '' };
  const [form, setForm]          = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    const [usersRes, rolesRes] = await Promise.all([
      api.get('/settings/users'),
      api.get('/settings/roles'),
    ]);
    if (usersRes.success) setUsers(usersRes.data || []);
    if (rolesRes.success) {
      const r = rolesRes.data || [];
      setRoles(r);
      // Set default role_id to first non-admin role
      const defaultRole = r.find(x => x.slug === 'dispatcher') || r[0];
      if (defaultRole) setForm(f => ({ ...f, role: defaultRole.slug, role_id: defaultRole.id }));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async e => {
    e.preventDefault(); setSaving(true);
    const res = await api.post('/settings/users', form);
    if (res.success) {
      toast('success', t('settings.users.created'));
      setShowModal(false);
      setCredentials({
        full_name: form.full_name,
        username: form.username,
        password: form.password,
        email: form.email,
        email_sent: res.email_sent,
      });
      setForm(emptyForm); load(); refreshPlan();
    } else if (res.upgrade_required) {
      setShowModal(false);
      setUpgradeReason(res.message || 'User limit reached. Please upgrade your plan.');
      setShowUpgradeModal(true);
    } else {
      toast('error', res.message || t('settings.users.create_failed'));
    }
    setSaving(false);
  };

  const del = async id => {
    if (!confirm(t('settings.users.deactivate_confirm'))) return;
    const res = await api.delete('/settings/users/'+id);
    if (res.success) { toast('success', t('settings.users.deactivated')); load(); }
  };

  if (loading) return <div className="stg-loader">{t('settings.users.loading')}</div>;

  return (
    <div className="stg-content">
      <div className="stg-section">
        <div className="stg-section-head" style={{justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div className="stg-section-icon blue"><User width={18} height={18}/></div>
            <div>
              <div className="stg-section-title">{t('settings.users.title')}</div>
              <div className="stg-section-sub">{t('settings.users.count', { count: users.length })}</div>
            </div>
          </div>
          <button className="stg-btn-primary" type="button"
            onClick={() => {
              if (isAtUserLimit) { setUpgradeReason('User limit reached. Please upgrade your plan to add more users or mechanics.'); setShowUpgradeModal(true); return; }
              setForm(emptyForm); setShowModal(true);
            }}
            style={isAtUserLimit ? { background: '#9ca3af', cursor: 'not-allowed' } : undefined}
            title={isAtUserLimit ? `User limit reached (${usage?.active_users || '?'}/${usage?.users_limit || '?'})` : ''}
          >
            <Plus width={15} height={15}/> {t('settings.users.add')}
          </button>
        </div>

        <div className="stg-user-list">
          {users.map(u => {
            const meta = ROLE_META[u.role] || ROLE_META.customer;
            const roleObj = roles.find(r => r.slug === u.role);
            const roleName = roleObj ? (isRTL && roleObj.name_ar ? roleObj.name_ar : roleObj.name) : (u.role || 'unknown');
            return (
              <div key={u.id} className="stg-user-row">
                <div className="stg-user-avatar" style={{background:'linear-gradient(135deg,'+meta.badge+'33,'+meta.badge+'66)'}}>
                  <span style={{color:meta.badge,fontWeight:800,fontSize:15}}>
                    {(u.full_name||u.username||'?')[0].toUpperCase()}
                  </span>
                </div>
                <div className="stg-user-info">
                  <div className="stg-user-name">{u.full_name || u.username}</div>
                  <div className="stg-user-meta">{u.email}{u.phone?' · '+u.phone:''}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                  <span className="stg-role-badge" style={{background:meta.bg,color:meta.badge}}>{roleName}</span>
                  <span className="stg-user-date">{fmtDate(u.created_at)}</span>
                  {u.role !== 'superadmin' && !u.is_owner && String(u.id) !== String(currentUser?.id) && (
                    <button className="stg-icon-btn red" onClick={()=>del(u.id)} title="Deactivate"><Trash width={13} height={13}/></button>
                  )}
                </div>
              </div>
            );
          })}
          {users.length === 0 && <div className="stg-empty"><User width={36} height={36}/><p>{t('settings.users.empty')}</p></div>}
        </div>
      </div>

      {showModal && (
        <div className="stg-overlay" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="stg-modal">
            <div className="stg-modal-head">
              <span>{t('settings.users.modal_title')}</span>
              <button type="button" onClick={()=>setShowModal(false)} className="stg-modal-close"><Xmark width={18} height={18}/></button>
            </div>
            <form onSubmit={handleAdd} className="stg-modal-body">
              <div className="stg-grid">
                <div className="stg-field">
                  <label>{t('settings.users.full_name')}</label>
                  <input required value={form.full_name} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))} placeholder="Ahmed Al Mansoori" />
                </div>
                <div className="stg-field">
                  <label>{t('settings.users.username')}</label>
                  <input required value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="ahmed.mansoori" />
                </div>
                <div className="stg-field">
                  <label>{t('settings.users.email')}</label>
                  <input required type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="ahmed@company.ae" />
                </div>
                <div className="stg-field">
                  <label>{t('settings.users.phone')}</label>
                  <input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="+971 50 000 0000" />
                </div>
                <div className="stg-field">
                  <label>{t('settings.users.password')}</label>
                  <div className="stg-input-wrap" style={{position:'relative'}}>
                    <input required type={showPw?'text':'password'} value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="Min. 6 characters" style={{[isRTL?'paddingLeft':'paddingRight']:40}} />
                    <button type="button" onClick={()=>setShowPw(p=>!p)} style={{position:'absolute',[isRTL?'left':'right']:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:0}}>
                      {showPw ? <EyeClosed width={15} height={15}/> : <Eye width={15} height={15}/>}
                    </button>
                  </div>
                </div>
                <div className="stg-field">
                  <label>{t('settings.users.role')}</label>
                  <select value={form.role_id} onChange={e => {
                    const selectedRole = roles.find(r => String(r.id) === e.target.value);
                    setForm(f => ({ ...f, role_id: Number(e.target.value), role: selectedRole?.slug || f.role }));
                  }}>
                    {roles.map(r => <option key={r.id} value={r.id}>{isRTL && r.name_ar ? r.name_ar : r.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="stg-modal-footer">
                <button type="button" className="stg-btn-ghost" onClick={()=>setShowModal(false)}>{t('settings.users.cancel')}</button>
                <button type="submit" className="stg-btn-primary" disabled={saving}>
                  {saving ? <><span className="stg-spin"/>{t('settings.users.creating')}</> : t('settings.users.create_user')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credentials confirmation modal */}
      {credentials && (
        <div className="stg-overlay" onClick={e => e.target === e.currentTarget && setCredentials(null)}>
          <div className="stg-modal" style={{ maxWidth: 440 }}>
            <div className="stg-modal-head" style={{ background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff' }}>
              <span>{t('settings.users.credentials_title')}</span>
              <button type="button" onClick={() => setCredentials(null)} className="stg-modal-close" style={{ color: '#fff' }}>
                <Xmark width={18} height={18} />
              </button>
            </div>
            <div style={{ padding: '24px 28px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
                padding: '12px 16px', background: '#f0fdf4', borderRadius: 10, border: '1px solid #bbf7d0',
              }}>
                <CheckCircle width={20} height={20} style={{ color: '#16a34a', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>
                  {t('settings.users.account_created_for', { name: credentials.full_name })}
                </span>
              </div>

              <div style={{
                background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
                overflow: 'hidden', marginBottom: 16,
              }}>
                {[
                  { label: t('settings.users.username'), value: credentials.username },
                  { label: t('settings.users.password'), value: credentials.password },
                  { label: t('settings.users.email'), value: credentials.email },
                ].map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 16px', borderBottom: i < 2 ? '1px solid #e2e8f0' : 'none',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{item.label}</span>
                    <span style={{ fontSize: 14, fontFamily: "'Courier New', monospace", color: '#111827', fontWeight: 600 }}>{item.value}</span>
                  </div>
                ))}
              </div>

              {credentials.email_sent && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe',
                  marginBottom: 16,
                }}>
                  <Mail width={16} height={16} style={{ color: '#2563eb', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: '#1e40af' }}>
                    {t('settings.users.welcome_email_sent', { email: credentials.email })}
                  </span>
                </div>
              )}

              <div style={{
                padding: '10px 14px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a',
                marginBottom: 20,
              }}>
                <p style={{ margin: 0, fontSize: 12, color: '#92400e' }}>
                  <WarningCircle width={14} height={14} style={{ verticalAlign: 'middle', marginInlineEnd: 6 }} />
                  {t('settings.users.credentials_warning')}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="stg-btn-primary" onClick={() => {
                  const text = `Username: ${credentials.username}\nPassword: ${credentials.password}\nEmail: ${credentials.email}`;
                  navigator.clipboard.writeText(text).then(() => toast('success', t('common.copied')));
                  setCredentials(null);
                }}>
                  {t('settings.users.copy_close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Modal when user limit reached */}
      {showUpgradeModal && (
        <UpgradeModal 
          onClose={() => { setShowUpgradeModal(false); setUpgradeReason(null); }} 
          triggerReason={upgradeReason} 
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   D.6 — SUBSCRIPTION TAB
═══════════════════════════════════════════════════════════════ */
function SubscriptionTab({ toast }) {
  const { t } = useTranslation();
  const { planData, loading, refresh, plan, planName, usage, limits, features, isTrial, trialDaysRemaining, trialExpired } = usePlanUsage();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const verifiedRef = useRef(false);

  // After Stripe Checkout redirect, verify the session and activate the plan
  useEffect(() => {
    if (verifiedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const sessionId = params.get('session_id');

    if (payment === 'success' && sessionId) {
      verifiedRef.current = true;
      setVerifying(true);
      api.post('/stripe/verify-session', { session_id: sessionId })
        .then(res => {
          if (res.success) {
            toast('success', `${res.message || 'Plan upgraded successfully!'}`);
            invalidatePlanCache(); // Clear stale cached data
            refresh(); // Refresh plan data to show new plan
          } else {
            toast('error', res.message || 'Failed to verify payment. Please contact support.');
          }
        })
        .catch(() => {
          toast('error', 'Failed to verify payment. Please contact support.');
        })
        .finally(() => {
          setVerifying(false);
          // Clean up URL params
          const url = new URL(window.location);
          url.searchParams.delete('payment');
          url.searchParams.delete('session_id');
          url.searchParams.delete('plan');
          window.history.replaceState({}, '', url.toString());
        });
    } else if (payment === 'cancelled') {
      toast('error', 'Payment was cancelled.');
      const url = new URL(window.location);
      url.searchParams.delete('payment');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  if (loading || verifying) return <div className="stg-loader">{verifying ? 'Verifying payment...' : 'Loading subscription data...'}</div>;
  if (!planData) return <div className="stg-loader">Unable to load subscription info</div>;

  const PLAN_COLORS = {
    trial: '#f59e0b', starter: '#3b82f6', growth: '#8b5cf6', professional: '#8b5cf6', enterprise: '#10b981', self_hosted: '#6b7280',
  };
  const planColor = PLAN_COLORS[plan] || '#6b7280';

  return (
    <div>
      {/* Current plan card */}
      <div style={{ background: planColor + '10', border: `2px solid ${planColor}30`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Current Plan</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: planColor }}>{planName}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {planData?.has_stripe && (
              <button
                onClick={async () => {
                  setOpeningPortal(true);
                  try {
                    const res = await api.post('/stripe/create-portal-session');
                    if (res.url) window.location.href = res.url;
                    else toast?.('Failed to open billing portal', 'error');
                  } catch (err) {
                    toast?.('Failed to open billing portal', 'error');
                  } finally { setOpeningPortal(false); }
                }}
                disabled={openingPortal}
                style={{ background: '#fff', color: planColor, border: `2px solid ${planColor}`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: openingPortal ? 0.6 : 1 }}
              >
                <Wallet width={14} height={14} /> {openingPortal ? 'Opening…' : 'Manage Billing'}
              </button>
            )}
            <button
              onClick={() => setShowUpgrade(true)}
              style={{ background: planColor, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              {plan === 'enterprise' ? 'Manage Plan' : 'Upgrade Plan'}
            </button>
          </div>
        </div>

        {isTrial && trialDaysRemaining !== null && (
          <div style={{ background: trialExpired ? '#fee2e2' : '#fef3c7', color: trialExpired ? '#dc2626' : '#92400e', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            {trialExpired
              ? <><WarningTriangle width={14} height={14} /> Your trial has expired. Subscribe to continue.</>
              : <><Clock width={14} height={14} /> Trial expires in {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''}</>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ background: planColor + '20', color: planColor, padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
            Status: {planData.status || 'Active'}
          </span>
          {planData.current_period_end && (
            <span style={{ background: '#f3f4f6', padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#6b7280' }}>
              Next billing: {new Date(planData.current_period_end).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Usage section */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', margin: '20px 0 12px' }}>Usage This Month</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <UsageCard label="WorkOrders" current={usage.orders_this_month} max={usage.orders_limit} pct={usage.orders_pct} color={planColor} />
        <UsageCard label="Users (incl. Mechanics)" current={usage.active_users} max={usage.users_limit} pct={usage.users_pct} color={planColor} />
      </div>
      {usage.active_mechanics > 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
          Includes {usage.active_mechanics} mechanic{usage.active_mechanics !== 1 ? 's' : ''} out of {usage.active_users} total users
        </div>
      )}

      {/* Features section */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', margin: '24px 0 12px' }}>Plan Features</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
        {Object.entries(features).map(([key, val]) => (
          <div key={key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', background: '#f9fafb', borderRadius: 8, fontSize: 13,
          }}>
            <span style={{ color: '#4b5563' }}>{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
            <span style={{ fontWeight: 700, color: val === true ? '#10b981' : val === false ? '#dc2626' : planColor }}>
              {val === true ? <Check width={14} height={14} style={{color:'#10b981'}} /> : val === false ? <Xmark width={14} height={14} style={{color:'#dc2626'}} /> : typeof val === 'number' ? (val >= 999 ? '∞' : val) : String(val)}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <button onClick={refresh} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#6b7280' }}>
          ↻ Refresh Usage Data
        </button>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}

function UsageCard({ label, current = 0, max = 0, pct = 0, color }) {
  const isWarn = pct >= 80;
  const isFull = pct >= 100;
  const barColor = isFull ? '#dc2626' : isWarn ? '#f59e0b' : color;
  const displayMax = max >= 999999 ? '∞' : max.toLocaleString();

  return (
    <div style={{ padding: '14px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#4b5563' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: isFull ? '#dc2626' : isWarn ? '#f59e0b' : '#1f2937' }}>
          {current.toLocaleString()} / {displayMax}
        </span>
      </div>
      <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{pct}% used</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN SETTINGS PAGE
═══════════════════════════════════════════════════════════════ */
/*
 * Surveys — the auto-issue trigger the CX SOP describes ("the survey issues
 * automatically on job closure"). Backed by the single `survey_auto_issue`
 * JSON setting, so it needs no dedicated endpoint; PUT /api/settings already
 * upserts arbitrary keys.
 *
 * Settings are per workshop row, and in this schema a branch IS a workshop
 * row — so what's saved here applies to the signed-in branch only, which is
 * what the SOP means by "the trigger is active for your branch". The branch
 * name is shown so that isn't ambiguous.
 *
 * WhatsApp is shown but disabled: survey_invites.channel accepts the value,
 * but there is no WhatsApp sender in the backend, so offering it as a live
 * option would mean a toggle that silently sends nothing.
 */
function SurveysTab({ data, setData, onSave, saving }) {
  const { t } = useTranslation();
  const s = data.settings || {};
  const cfg = s.survey_auto_issue || {};
  const setCfg = (k, v) => setData(d => ({
    ...d,
    settings: { ...d.settings, survey_auto_issue: { ...(d.settings?.survey_auto_issue || {}), [k]: v } },
  }));
  const enabled = !!cfg.enabled;
  const channel = cfg.channel || 'email';

  return (
    <form onSubmit={onSave} className="stg-content">
      <div className="stg-save-bar" style={{ marginBottom: 16 }}>
        <button type="submit" className="stg-btn-primary" disabled={saving}>
          {saving ? <><span className="stg-spin"/>{t('settings.saving')}</> : <><CheckCircle width={16} height={16}/>{t('settings.save_changes')}</>}
        </button>
      </div>

      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon purple"><EmojiSatisfied width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.surveys.trigger')}</div>
            <div className="stg-section-sub">{t('settings.surveys.trigger_sub')}</div>
          </div>
        </div>

        <div className="stg-toggles" style={{ marginBottom: 16 }}>
          <div className="stg-toggle-row">
            <div>
              <div className="stg-toggle-label">{t('settings.surveys.auto_issue')}</div>
              <div className="stg-toggle-desc">{t('settings.surveys.auto_issue_desc')}</div>
            </div>
            <Toggle on={enabled} onChange={v => setCfg('enabled', v)} />
          </div>
        </div>

        <div style={{...{display:'flex',alignItems:'flex-start',gap:8,padding:'10px 14px',borderRadius:8,background:'#f8fafc',border:'1px solid #e2e8f0',fontSize:12.5,color:'#475569'}, marginBottom:16}}>
          <WarningCircle width={15} height={15}/>
          <span>{t('settings.surveys.branch_note', { branch: data.name || t('settings.surveys.this_branch') })}</span>
        </div>

        {enabled && (
          <div className="stg-grid">
            <div className="stg-field">
              <label>{t('settings.surveys.channel')}</label>
              <select value={channel} onChange={e => setCfg('channel', e.target.value)}>
                <option value="email">{t('settings.surveys.channel_email')}</option>
                <option value="sms">{t('settings.surveys.channel_sms')}</option>
                <option value="whatsapp" disabled>{t('settings.surveys.channel_whatsapp_unavailable')}</option>
              </select>
              <div style={{fontSize:11,color:'#94A3B8',marginTop:4}}>
                {channel === 'email' ? t('settings.surveys.channel_email_hint') : t('settings.surveys.channel_sms_hint')}
              </div>
            </div>
            <div className="stg-field">
              <label>{t('settings.surveys.expiry')}</label>
              <input
                type="number" min="1" max="365"
                value={cfg.expires_in_days ?? 30}
                onChange={e => setCfg('expires_in_days', Number(e.target.value) || 30)}
              />
              <div style={{fontSize:11,color:'#94A3B8',marginTop:4}}>{t('settings.surveys.expiry_hint')}</div>
            </div>
          </div>
        )}
      </div>

      <div className="stg-section">
        <div className="stg-section-head">
          <div className="stg-section-icon teal"><Page width={18} height={18}/></div>
          <div>
            <div className="stg-section-title">{t('settings.surveys.public_link')}</div>
            <div className="stg-section-sub">{t('settings.surveys.public_link_sub')}</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'flex-start',gap:8,padding:'10px 14px',borderRadius:8,background:'#f8fafc',border:'1px solid #e2e8f0',fontSize:12.5,color:'#475569'}}>
          <WarningCircle width={15} height={15}/>
          <span>{t('settings.surveys.qr_where')}</span>
        </div>
      </div>
    </form>
  );
}

const TABS = [
  { id:'general',       icon: Building,      color:'#f97316' },
  { id:'delivery',      icon: DeliveryTruck, color:'#3b82f6' },
  { id:'labels',        icon: Printer,       color:'#ea580c' },
  { id:'notifications', icon: Bell,          color:'#8b5cf6' },
  { id:'surveys',       icon: EmojiSatisfied, color:'#0ea5e9' },
  { id:'categories',    icon: Tag,           color:'#0d9488' },
  { id:'roles',         icon: ShieldCheck,   color:'#7c3aed' },
  { id:'users',         icon: User,          color:'#f43f5e' },
  { id:'subscription',  icon: Wallet,        color:'#10b981' },
];

export default function Settings() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  // Read initial tab from URL query param (e.g., ?tab=subscription after Stripe redirect)
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get('tab');
    return TABS.some(tb => tb.id === urlTab) ? urlTab : 'general';
  });
  const [data,    setData]   = useState({});
  const [loading, setLoading]= useState(true);
  const [saving,  setSaving] = useState(false);

  const { toasts, showToast } = useToast();

  // Adapter so older (type,msg) call-sites still work:
  const { checkSession } = useContext(AuthContext);
  const toast = useCallback((type, msg) => showToast(msg, type), [showToast]);

  useEffect(() => {
    api.get('/settings').then(res => {
      if (res.success) setData(res.data || {});
      setLoading(false);
    });
  }, []);

  const handleSave = async e => {
    e.preventDefault();
    setSaving(true);
    const { settings = {}, name, logo_url, logo_url_white, phone, email, address, city, country, currency, timezone,
      company_lat, company_lng, building_name, floor, office_number, area, emirate } = data;
    const res = await api.put('/settings', {
      workshop: { name, logo_url, logo_url_white, phone, email, address, city, country, currency, timezone,
        company_lat, company_lng, building_name, floor, office_number, area, emirate },
      settings,
    });
    if (res.success) {
      showToast(t('settings.save_success'), 'success');
      // Refresh auth context so sidebar/header picks up new logos immediately
      checkSession();
    }
    else showToast(res.message || t('settings.save_failed'), 'error');
    setSaving(false);
  };

  const activeTab = TABS.find(tb => tb.id === tab);

  return (
    <div className="page-container">
      <Toast toasts={toasts} />

      <div className="stg-page-header">
        <div className="stg-page-header-left">
          <div className="stg-page-icon">
            <SettingsIcon width={22} height={22}/>
          </div>
          <div>
            <h2 className="stg-page-title">{t('settings.title')}</h2>
            <p className="stg-page-sub">{t('settings.subtitle')}</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="stg-loader" style={{minHeight:300}}>{t('settings.loading')}</div>
      ) : (
        <div className="stg-layout">
          <nav className="stg-sidebar">
            {TABS.map(tb => (
              <button
                key={tb.id}
                type="button"
                className={'stg-nav-btn'+(tab===tb.id?' active':'')}
                onClick={() => setTab(tb.id)}
                style={tab===tb.id?{'--acc':tb.color}:undefined}
              >
                <div className="stg-nav-icon" style={tab===tb.id?{background:tb.color+'20',color:tb.color}:undefined}>
                  <tb.icon width={16} height={16}/>
                </div>
                <span>{t('settings.tabs.' + tb.id)}</span>
                {tab===tb.id && <NavArrowRight width={13} height={13} style={{[isRTL?'marginRight':'marginLeft']:'auto',color:tb.color}}/>}
              </button>
            ))}
          </nav>

          <div className="stg-main">
            <div className="stg-tab-header" style={{'--acc': activeTab?.color}}>
              {activeTab && <activeTab.icon width={20} height={20}/>}
              <div>
                <div className="stg-tab-title">{t('settings.tabs.' + tab)}</div>
                <div className="stg-tab-sub">{t('settings.tab_descriptions.' + tab)}</div>
              </div>
            </div>

            {tab==='general'       && <GeneralTab       data={data} setData={setData} onSave={handleSave} saving={saving}/>}
            {tab==='delivery'      && <DeliveryTab      data={data} setData={setData} onSave={handleSave} saving={saving}/>}
            {tab==='labels'        && <ShippingLabelsTab data={data} setData={setData} onSave={handleSave} saving={saving}/>}
            {tab==='notifications' && <NotificationsTab data={data} setData={setData} onSave={handleSave} saving={saving}/>}
            {tab==='surveys'       && <SurveysTab       data={data} setData={setData} onSave={handleSave} saving={saving}/>}
            {tab==='categories'    && <CategoriesTab    toast={toast}/>}
            {tab==='roles'         && <RolesTab         toast={toast}/>}
            {tab==='users'         && <UsersTab         toast={toast}/>}
            {tab==='subscription'  && <SubscriptionTab  toast={toast}/>}
          </div>
        </div>
      )}
    </div>
  );
}
