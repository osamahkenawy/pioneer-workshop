import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Archive, Search, Plus, MapPin, Package, WarningTriangle, Xmark,
  ShieldCheck, ArrowRight, CheckCircle, Building,
} from 'iconoir-react';
import api from '../lib/api';

/**
 * Inventory.jsx — multi-location stock (SOW B6 req 88) + supplier warranty
 * terms (req 89). Backend also exposes requisitions/issues/returns/
 * reservations, but those key off `job_card_id`, and nothing in this app
 * creates a job_cards row yet (see routes/job-cards.js — no caller). That
 * slice is deliberately left out until a Job Cards module exists; wiring
 * a form to an id that can never be selected would just be a dead end.
 */

const NAVY = '#1e3a6b';
const ORANGE = '#f97316';

const LOCATION_TYPE_LABEL = {
  main_store: 'Main Store',
  workshop_sub: 'Workshop Sub-Store',
  external: 'External',
};

const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function KPICard({ icon: Icon, label, value, sub, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '16px 18px', flex: 1, minWidth: 0,
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: `3px solid ${color}` }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: color + '18',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <Icon width={18} height={18} color={color} strokeWidth={1.8} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, color: '#1e293b', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 500 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>{label}</span>
      {children}
    </label>
  );
}

const TABS = [
  { key: 'stock', label: 'Stock Levels', icon: Package },
  { key: 'locations', label: 'Locations', icon: Building },
  { key: 'warranty', label: 'Supplier Warranty Terms', icon: ShieldCheck },
];

export default function Inventory() {
  const [tab, setTab] = useState('stock');
  const [locations, setLocations] = useState([]);
  const [stock, setStock] = useState([]);
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');

  const [showAddLocation, setShowAddLocation] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showAddWarranty, setShowAddWarranty] = useState(false);
  const [showCheckWarranty, setShowCheckWarranty] = useState(false);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await api.get('/inventory/locations');
      if (res.success) setLocations(res.locations || []);
    } catch { /* handled by fetchAll error */ }
  }, []);

  const fetchStock = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (locationFilter) params.set('location_id', locationFilter);
      if (search.trim()) params.set('search', search.trim());
      const qs = params.toString();
      const res = await api.get(`/inventory/stock${qs ? `?${qs}` : ''}`);
      if (res.success) setStock(res.stock || []);
      else setError(res.message || 'Failed to load stock');
    } catch { setError('Network error loading stock'); }
  }, [locationFilter, search]);

  const fetchTerms = useCallback(async () => {
    try {
      const res = await api.get('/inventory/warranty-terms');
      if (res.success) setTerms(res.terms || []);
    } catch { /* handled by fetchAll error */ }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    await Promise.all([fetchLocations(), fetchStock(), fetchTerms()]);
    setLoading(false);
  }, [fetchLocations, fetchStock, fetchTerms]);

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchStock(); }, [fetchStock]);

  const stats = useMemo(() => {
    const skus = new Set(stock.map(s => s.part_number));
    const totalUnits = stock.reduce((sum, s) => sum + (parseFloat(s.quantity_on_hand) || 0), 0);
    const lowStock = stock.filter(s => parseFloat(s.reorder_level) > 0 && parseFloat(s.quantity_on_hand) <= parseFloat(s.reorder_level)).length;
    const totalValue = stock.reduce((sum, s) => sum + (parseFloat(s.quantity_on_hand) || 0) * (parseFloat(s.avg_cost) || 0), 0);
    return { locations: locations.length, skus: skus.size, totalUnits, lowStock, totalValue };
  }, [stock, locations]);

  return (
    <div style={{ padding: '0 0 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0 }}>Inventory</h1>
          <p style={{ fontSize: 13.5, color: '#64748b', margin: '4px 0 0' }}>Multi-location stock levels and supplier warranty terms</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {tab === 'stock' && (
            <>
              <button onClick={() => setShowTransfer(true)} style={st.ghostBtn}>
                <ArrowRight width={16} height={16} /> Transfer Stock
              </button>
              <button onClick={() => setShowReceive(true)} style={st.primaryBtn}>
                <Plus width={16} height={16} /> Receive Stock
              </button>
            </>
          )}
          {tab === 'locations' && (
            <button onClick={() => setShowAddLocation(true)} style={st.primaryBtn}>
              <Plus width={16} height={16} /> Add Location
            </button>
          )}
          {tab === 'warranty' && (
            <>
              <button onClick={() => setShowCheckWarranty(true)} style={st.ghostBtn}>
                <ShieldCheck width={16} height={16} /> Check Eligibility
              </button>
              <button onClick={() => setShowAddWarranty(true)} style={st.primaryBtn}>
                <Plus width={16} height={16} /> Add Warranty Term
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div style={st.errorBar}>
          <WarningTriangle width={16} height={16} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>
            <Xmark width={14} height={14} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard icon={Building} label="Locations" value={stats.locations} color={NAVY} />
        <KPICard icon={Archive} label="Distinct Parts (SKUs)" value={stats.skus} color="#3b82f6" />
        <KPICard icon={Package} label="Units On Hand" value={stats.totalUnits.toLocaleString()} color="#16a34a" />
        <KPICard icon={WarningTriangle} label="Low Stock" value={stats.lowStock} color={stats.lowStock > 0 ? '#dc2626' : '#94a3b8'} />
        <KPICard icon={ShieldCheck} label="Stock Value" value={fmt(stats.totalValue)} color="#f59e0b" sub="at average cost" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid #e2e8f0' }}>
        {TABS.map(tb => {
          const Icon = tb.icon;
          const activeStyle = tab === tb.key
            ? { color: ORANGE, borderBottom: `2.5px solid ${ORANGE}` }
            : { color: '#64748b', borderBottom: '2.5px solid transparent' };
          return (
            <button key={tb.key} onClick={() => setTab(tb.key)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 4px', marginBottom: -1,
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, ...activeStyle,
            }}>
              <Icon width={16} height={16} /> {tb.label}
            </button>
          );
        })}
      </div>

      {tab === 'stock' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={st.searchWrap}>
              <Search width={16} height={16} style={{ color: '#94a3b8' }} />
              <input style={st.searchInput} placeholder="Search part number or description…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} style={st.filterSelect}>
              <option value="">All locations</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eef2f7' }}>
                  {['Part', 'Location', 'On Hand', 'Reserved', 'Avg Cost', 'Reorder Level', ''].map(h => (
                    <th key={h} style={st.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={7} style={st.emptyCell}>Loading stock…</td></tr>)}
                {!loading && stock.length === 0 && (
                  <tr><td colSpan={7} style={st.emptyCell}>
                    <Archive width={32} height={32} style={{ color: '#cbd5e1', marginBottom: 8 }} />
                    <div>No stock on hand yet. Receive stock to get started.</div>
                  </td></tr>
                )}
                {!loading && stock.map(s => {
                  const low = parseFloat(s.reorder_level) > 0 && parseFloat(s.quantity_on_hand) <= parseFloat(s.reorder_level);
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={st.td}>
                        <div style={{ fontWeight: 700, color: '#1e293b' }}>{s.part_number}</div>
                        {s.description && <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{s.description}</div>}
                      </td>
                      <td style={st.td}>
                        <span style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>{s.location_name}</span>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{LOCATION_TYPE_LABEL[s.location_type] || s.location_type}</div>
                      </td>
                      <td style={{ ...st.td, fontWeight: 700, color: low ? '#dc2626' : '#1e293b' }}>
                        {fmt(s.quantity_on_hand)} {low && <WarningTriangle width={13} height={13} style={{ marginLeft: 4, verticalAlign: 'middle' }} />}
                      </td>
                      <td style={st.td}>{fmt(s.quantity_reserved)}</td>
                      <td style={st.td}>{fmt(s.avg_cost)}</td>
                      <td style={st.td}>{fmt(s.reorder_level)}</td>
                      <td style={st.td} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'locations' && (
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eef2f7' }}>
                {['Name', 'Type', 'Status'].map(h => <th key={h} style={st.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && (<tr><td colSpan={3} style={st.emptyCell}>Loading locations…</td></tr>)}
              {!loading && locations.length === 0 && (
                <tr><td colSpan={3} style={st.emptyCell}>
                  <Building width={32} height={32} style={{ color: '#cbd5e1', marginBottom: 8 }} />
                  <div>No storage locations yet. Add one to start receiving stock.</div>
                </td></tr>
              )}
              {!loading && locations.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ ...st.td, fontWeight: 700, color: '#1e293b' }}><MapPin width={14} height={14} style={{ marginRight: 6, verticalAlign: 'middle', color: '#94a3b8' }} />{l.name}</td>
                  <td style={st.td}>{LOCATION_TYPE_LABEL[l.location_type] || l.location_type}</td>
                  <td style={st.td}>
                    <span style={{ ...st.pill, background: l.is_active ? '#f0fdf4' : '#fef2f2', color: l.is_active ? '#16a34a' : '#dc2626' }}>
                      {l.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'warranty' && (
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eef2f7' }}>
                {['Part', 'Supplier', 'Warranty (months)', 'Warranty (km)'].map(h => <th key={h} style={st.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && (<tr><td colSpan={4} style={st.emptyCell}>Loading warranty terms…</td></tr>)}
              {!loading && terms.length === 0 && (
                <tr><td colSpan={4} style={st.emptyCell}>
                  <ShieldCheck width={32} height={32} style={{ color: '#cbd5e1', marginBottom: 8 }} />
                  <div>No supplier warranty terms on file yet.</div>
                </td></tr>
              )}
              {!loading && terms.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={st.td}>
                    <div style={{ fontWeight: 700, color: '#1e293b' }}>{t.part_name || t.part_number}</div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8' }}>#{t.part_number}</div>
                  </td>
                  <td style={st.td}>{t.supplier_name || '—'}</td>
                  <td style={st.td}>{t.warranty_months || '—'}</td>
                  <td style={st.td}>{t.warranty_km ? Number(t.warranty_km).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddLocation && (
        <AddLocationModal onClose={() => setShowAddLocation(false)} onSaved={() => { setShowAddLocation(false); fetchLocations(); }} />
      )}
      {showReceive && (
        <ReceiveStockModal locations={locations} onClose={() => setShowReceive(false)} onSaved={() => { setShowReceive(false); fetchStock(); }} />
      )}
      {showTransfer && (
        <TransferStockModal locations={locations} onClose={() => setShowTransfer(false)} onSaved={() => { setShowTransfer(false); fetchStock(); }} />
      )}
      {showAddWarranty && (
        <AddWarrantyModal onClose={() => setShowAddWarranty(false)} onSaved={() => { setShowAddWarranty(false); fetchTerms(); }} />
      )}
      {showCheckWarranty && (
        <CheckWarrantyModal onClose={() => setShowCheckWarranty(false)} />
      )}
    </div>
  );
}

/* ── Add Location modal ── */
function AddLocationModal({ onClose, onSaved }) {
  const [name, setName] = useState('');
  const [locationType, setLocationType] = useState('main_store');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim()) { setError('Location name is required.'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/inventory/locations', { name: name.trim(), location_type: locationType });
      if (res.success) onSaved();
      else setError(res.message || 'Could not save location.');
    } catch { setError('Network error saving location.'); }
    finally { setSaving(false); }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>Add Location</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={st.errorBar}>{error}</div>}
          <Field label="Name *"><input style={st.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main Store" /></Field>
          <Field label="Type">
            <select style={st.input} value={locationType} onChange={e => setLocationType(e.target.value)}>
              <option value="main_store">Main Store</option>
              <option value="workshop_sub">Workshop Sub-Store</option>
              <option value="external">External</option>
            </select>
          </Field>
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Add Location'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Receive Stock modal ── */
function ReceiveStockModal({ locations, onClose, onSaved }) {
  const [locationId, setLocationId] = useState(locations[0]?.id || '');
  const [partNumber, setPartNumber] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [purchaseCost, setPurchaseCost] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!locationId) { setError('Select a location.'); return; }
    if (!partNumber.trim()) { setError('Part number is required.'); return; }
    if (!quantity || Number(quantity) <= 0) { setError('Quantity must be greater than 0.'); return; }
    if (!purchaseCost || Number(purchaseCost) <= 0) { setError('Purchase cost is required.'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/inventory/stock/receive', {
        location_id: Number(locationId),
        reference: reference || null,
        items: [{ part_number: partNumber.trim(), description: description || null, quantity: Number(quantity), purchase_cost: Number(purchaseCost) }],
      });
      if (res.success) onSaved();
      else setError(res.message || 'Could not receive stock.');
    } catch { setError('Network error receiving stock.'); }
    finally { setSaving(false); }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>Receive Stock</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={st.errorBar}>{error}</div>}
          {locations.length === 0 && (
            <div style={st.errorBar}>No locations yet — add a location first.</div>
          )}
          <Field label="Location *">
            <select style={st.input} value={locationId} onChange={e => setLocationId(e.target.value)}>
              <option value="">Select location…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Part number *"><input style={st.input} value={partNumber} onChange={e => setPartNumber(e.target.value)} placeholder="e.g. BP-4521" /></Field>
            <Field label="Description"><input style={st.input} value={description} onChange={e => setDescription(e.target.value)} placeholder="Front brake pads" /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Quantity *"><input style={st.input} type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} /></Field>
            <Field label="Purchase cost (unit) *"><input style={st.input} type="number" min="0" step="0.01" placeholder="0.00" value={purchaseCost} onChange={e => setPurchaseCost(e.target.value)} /></Field>
          </div>
          <Field label="Reference (PO / invoice #)"><input style={st.input} value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" /></Field>
          <div style={st.totalPreview}>This will update the average cost (AVCO) for this part at this location.</div>
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Receive Stock'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Transfer Stock modal ── */
function TransferStockModal({ locations, onClose, onSaved }) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!fromId || !toId) { setError('Select both source and destination locations.'); return; }
    if (fromId === toId) { setError('Source and destination must be different.'); return; }
    if (!partNumber.trim()) { setError('Part number is required.'); return; }
    if (!quantity || Number(quantity) <= 0) { setError('Quantity must be greater than 0.'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/inventory/stock/transfer', {
        from_location_id: Number(fromId), to_location_id: Number(toId),
        part_number: partNumber.trim(), quantity: Number(quantity), notes: notes || null,
      });
      if (res.success) onSaved();
      else setError(res.message || 'Could not transfer stock.');
    } catch { setError('Network error transferring stock.'); }
    finally { setSaving(false); }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>Transfer Stock</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={st.errorBar}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="From location *">
              <select style={st.input} value={fromId} onChange={e => setFromId(e.target.value)}>
                <option value="">Select…</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="To location *">
              <select style={st.input} value={toId} onChange={e => setToId(e.target.value)}>
                <option value="">Select…</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Part number *"><input style={st.input} value={partNumber} onChange={e => setPartNumber(e.target.value)} placeholder="e.g. BP-4521" /></Field>
          <Field label="Quantity *"><input style={st.input} type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} /></Field>
          <Field label="Notes"><input style={st.input} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></Field>
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Transferring…' : 'Transfer Stock'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Add Warranty Term modal ── */
function AddWarrantyModal({ onClose, onSaved }) {
  const [partNumber, setPartNumber] = useState('');
  const [partName, setPartName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [months, setMonths] = useState('');
  const [km, setKm] = useState('');
  const [conditions, setConditions] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!partNumber.trim()) { setError('Part number is required.'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/inventory/warranty-terms', {
        part_number: partNumber.trim(), part_name: partName || null, supplier_name: supplierName || null,
        warranty_months: months ? Number(months) : null, warranty_km: km ? Number(km) : null,
        warranty_conditions: conditions || null,
      });
      if (res.success) onSaved();
      else setError(res.message || 'Could not save warranty term.');
    } catch { setError('Network error saving warranty term.'); }
    finally { setSaving(false); }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>Add Warranty Term</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={st.errorBar}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Part number *"><input style={st.input} value={partNumber} onChange={e => setPartNumber(e.target.value)} placeholder="e.g. BP-4521" /></Field>
            <Field label="Part name"><input style={st.input} value={partName} onChange={e => setPartName(e.target.value)} placeholder="Front brake pads" /></Field>
          </div>
          <Field label="Supplier name"><input style={st.input} value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="Optional" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Warranty (months)"><input style={st.input} type="number" min="0" value={months} onChange={e => setMonths(e.target.value)} placeholder="e.g. 12" /></Field>
            <Field label="Warranty (km)"><input style={st.input} type="number" min="0" value={km} onChange={e => setKm(e.target.value)} placeholder="e.g. 20000" /></Field>
          </div>
          <Field label="Conditions"><input style={st.input} value={conditions} onChange={e => setConditions(e.target.value)} placeholder="Optional terms/conditions" /></Field>
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Add Warranty Term'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Check Warranty Eligibility modal ── */
function CheckWarrantyModal({ onClose }) {
  const [partNumber, setPartNumber] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [odometer, setOdometer] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const submit = async () => {
    if (!partNumber.trim() || !workOrderId.trim()) { setError('Part number and original work order # are required.'); return; }
    setChecking(true); setError(''); setResult(null);
    try {
      const res = await api.post('/inventory/warranty-terms/check', {
        part_number: partNumber.trim(),
        original_work_order_id: Number(workOrderId),
        current_odometer: odometer ? Number(odometer) : undefined,
      });
      if (res.success) setResult(res);
      else setError(res.message || 'Could not check warranty eligibility.');
    } catch { setError('Network error checking warranty eligibility.'); }
    finally { setChecking(false); }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>Check Warranty Eligibility</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={st.errorBar}>{error}</div>}
          <Field label="Part number *"><input style={st.input} value={partNumber} onChange={e => setPartNumber(e.target.value)} placeholder="e.g. BP-4521" /></Field>
          <Field label="Original work order ID *">
            <input style={st.input} value={workOrderId} onChange={e => setWorkOrderId(e.target.value)} placeholder="Internal work order id where the part was installed" />
          </Field>
          <Field label="Current odometer (km)"><input style={st.input} type="number" min="0" value={odometer} onChange={e => setOdometer(e.target.value)} placeholder="Optional — required for km-based terms" /></Field>

          {result && (
            <div style={{
              ...st.totalPreview,
              background: result.eligible ? '#f0fdf4' : '#fef2f2',
              color: result.eligible ? '#16a34a' : '#dc2626',
              display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700,
            }}>
              {result.eligible ? <CheckCircle width={18} height={18} /> : <WarningTriangle width={18} height={18} />}
              {result.eligible ? 'Eligible for warranty' : 'Not eligible'} — {result.reason}
            </div>
          )}
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Close</button>
          <button onClick={submit} disabled={checking} style={{ ...st.primaryBtn, opacity: checking ? 0.7 : 1 }}>{checking ? 'Checking…' : 'Check Eligibility'}</button>
        </div>
      </div>
    </div>
  );
}

const st = {
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: 'none',
    background: `linear-gradient(135deg,${ORANGE},#ea580c)`, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700,
    boxShadow: '0 4px 14px rgba(249,115,22,0.3)' },
  ghostBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  errorBar: { display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
    padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14, fontWeight: 500 },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '0 12px', background: '#fff', flex: 1, minWidth: 260 },
  searchInput: { border: 'none', outline: 'none', padding: '10px 0', fontSize: 14, width: '100%', background: 'transparent' },
  filterSelect: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, background: '#fff', color: '#334155', cursor: 'pointer' },
  th: { textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' },
  td: { padding: '12px 16px', fontSize: 13.5, color: '#334155', verticalAlign: 'middle' },
  emptyCell: { textAlign: 'center', padding: '48px 16px', color: '#94a3b8', fontSize: 13.5 },
  pill: { display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 },
  // z-index must clear the sidebar (1065) and topbar (1060) in Layout.css.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 },
  modal: { background: '#fff', borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,0.28)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 14px' },
  closeBtn: { background: '#f1f5f9', border: 'none', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569' },
  input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none', color: '#1e293b', background: '#fff', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  totalPreview: { background: '#f8fafc', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, color: '#475569' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #f1f5f9' },
};
