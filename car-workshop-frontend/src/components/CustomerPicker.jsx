import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Xmark } from 'iconoir-react';
import api from '../lib/api';
import './CustomerPicker.css';

/**
 * CustomerPicker — type-to-search customer selector.
 *
 * Replaces the `<select>` fed by `/customers?limit=300|500` that several
 * forms used. That pattern was fine at a few hundred customers and broke
 * when the full master list (3,472) was imported: the dropdown could only
 * ever offer the first N alphabetically, so most customers simply couldn't
 * be selected. This queries the backend's existing `?search=` instead, so
 * reachability doesn't depend on list size.
 *
 * Uncontrolled-ish by design: it owns the query text and result list, and
 * reports the chosen customer up via onChange(customer | null). The parent
 * keeps whatever id/label it needs.
 */
export default function CustomerPicker({
  value,            // currently selected customer object (or null)
  onChange,
  placeholder = 'Search customer by name or phone…',
  emptyLabel = 'No customer linked',
  autoFocus = false,
}) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  const search = useCallback(async () => {
    if (!debounced) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await api.get(`/customers?search=${encodeURIComponent(debounced)}&limit=20`);
      setResults(r?.success ? (r.data || []) : []);
      setActiveIdx(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => { search(); }, [search]);

  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = c => {
    onChange?.(c);
    setOpen(false);
    setTerm('');
    setResults([]);
  };

  const onKeyDown = e => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[activeIdx]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  if (value) {
    return (
      <div className="cp-selected">
        <div className="cp-selected-body">
          <span className="cp-selected-name">{value.full_name}</span>
          {value.phone && value.phone !== '-' && <span className="cp-selected-meta">{value.phone}</span>}
        </div>
        <button type="button" className="cp-clear" onClick={() => onChange?.(null)} aria-label="Clear selected customer">
          <Xmark width={15} height={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="cp-wrap" ref={boxRef}>
      <div className="cp-input">
        <Search width={16} height={16} />
        <input
          value={term}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={e => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Search customers"
          autoComplete="off"
        />
      </div>

      {open && (term.trim() || loading) && (
        <div className="cp-menu" role="listbox">
          {loading ? (
            <div className="cp-msg">Searching…</div>
          ) : results.length === 0 ? (
            <div className="cp-msg">No customer matches “{term.trim()}”.</div>
          ) : results.map((c, i) => (
            <button
              type="button"
              key={c.id}
              role="option"
              aria-selected={i === activeIdx}
              className={`cp-option${i === activeIdx ? ' is-active' : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => pick(c)}
            >
              <span className="cp-option-name">{c.full_name}</span>
              <span className="cp-option-meta">
                {[c.phone && c.phone !== '-' ? c.phone : null, c.company_name].filter(Boolean).join(' · ') || '—'}
              </span>
            </button>
          ))}
        </div>
      )}

      {!term.trim() && !open && <p className="cp-hint">{emptyLabel}</p>}
    </div>
  );
}
