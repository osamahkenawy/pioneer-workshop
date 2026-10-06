/**
 * PhoneInput — Reusable phone input with country code dropdown
 * Countries are loaded from the API (/api/countries) and cached.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './PhoneInput.css';

// Fallback so the UI works even before the API responds
const DEFAULT_ENTRY = { code: '+971', flag: '🇦🇪', name: 'United Arab Emirates', iso: 'AE' };

// Module-level cache: populated from API, consumed by all components
export let PHONE_CODES = [DEFAULT_ENTRY];

let _fetchPromise = null;
export function loadCountries() {
  if (_fetchPromise) return _fetchPromise;
  const API_BASE = import.meta.env.VITE_API_URL || '/api';
  _fetchPromise = fetch(`${API_BASE}/countries`)
    .then(r => r.json())
    .then(res => {
      if (res.success && res.data?.length) {
        PHONE_CODES = res.data.map(c => ({
          code: c.phone_code, flag: c.flag, name: c.name, iso: c.iso,
        }));
      }
      return PHONE_CODES;
    })
    .catch(() => PHONE_CODES); // keep fallback on network error
  return _fetchPromise;
}
// Kick off fetch immediately on import
loadCountries();

/** Resolve a country name/iso to its phone code. Used to set default from workshop settings. */
export function getPhoneCodeForCountry(country) {
  if (!country) return '+971';
  const lower = country.toLowerCase().trim();
  // Try ISO code match first
  const byIso = PHONE_CODES.find(c => c.iso?.toLowerCase() === lower);
  if (byIso) return byIso.code;
  // Try exact name match
  const byName = PHONE_CODES.find(c => c.name.toLowerCase() === lower);
  if (byName) return byName.code;
  // Try partial match
  const byPartial = PHONE_CODES.find(c => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()));
  if (byPartial) return byPartial.code;
  // Common aliases
  const aliases = {
    'uae': '+971', 'emirates': '+971', 'usa': '+1', 'us': '+1', 'uk': '+44',
    'england': '+44', 'ksa': '+966', 'korea': '+82', 'czech': '+420',
    'russia': '+7', 'palestine': '+970', 'ivory coast': '+225', 'cote d\'ivoire': '+225',
    'congo': '+243', 'drc': '+243',
  };
  return aliases[lower] || '+971';
}

export default function PhoneInput({
  value, onChange, phoneCode, onPhoneCodeChange,
  placeholder, id, searchPlaceholder, className = '', required = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [codes, setCodes] = useState(PHONE_CODES);
  const [dropStyle, setDropStyle] = useState({});
  const ref = useRef(null);
  const btnRef = useRef(null);
  const dropRef = useRef(null);

  // Refresh when API data arrives
  useEffect(() => { loadCountries().then(() => setCodes([...PHONE_CODES])); }, []);

  const selected = codes.find(c => c.code === phoneCode) || codes[0];

  // Position the dropdown using fixed positioning relative to the button
  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setDropStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: 260, zIndex: 10000 });
  }, []);

  useEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) &&
          dropRef.current && !dropRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = search
    ? codes.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.code.includes(search) || (c.iso && c.iso.toLowerCase().includes(search.toLowerCase())))
    : codes;

  return (
    <div className={`phone-input-wrap ${className}`} ref={ref} dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
      <button ref={btnRef} type="button" className="phone-code-btn" onClick={() => setOpen(o => !o)}>
        <span className="phone-flag">{selected.flag}</span>
        <span className="phone-code-text">{selected.code}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && createPortal(
        <div className="phone-dropdown" ref={dropRef} style={dropStyle}>
          <input
            type="text"
            className="phone-search"
            placeholder={searchPlaceholder || "Search country..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className="phone-list">
            {filtered.map(c => (
              <button
                key={c.iso}
                type="button"
                className={`phone-option${c.code === phoneCode ? ' active' : ''}`}
                onClick={() => { onPhoneCodeChange(c.code); setOpen(false); setSearch(''); }}
              >
                <span className="phone-flag">{c.flag}</span>
                <span className="phone-option-name">{c.name}</span>
                <span className="phone-option-code">{c.code}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
      <input
        id={id}
        type="tel"
        className="phone-number-input"
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder={placeholder || 'Phone number'}
        required={required}
      />
    </div>
  );
}
