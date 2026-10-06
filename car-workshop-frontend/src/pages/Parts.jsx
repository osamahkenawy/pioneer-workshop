import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wrench, Search, Plus, Trash, EditPencil, Xmark, Check, Package,
  Clock, WarningTriangle, ShieldCheck, RefreshDouble, DollarCircle,
} from 'iconoir-react';
import api from '../lib/api';

/**
 * Parts.jsx — inventory parts consumed on work orders.
 *
 * The backend models a part as scoped to a single work order (not a
 * shop-wide stock catalog with independent quantities-on-hand) — see
 * src/routes/parts.js for the full lifecycle rationale. This page is a
 * cross-work-order view: list/filter every part, add parts to a work
 * order, and move a part through ordered → in_stock → installed →
 * returned as work progresses.
 */

const STATUS_META = {
  ordered:   { label: 'Ordered',   color: '#f59e0b', bg: '#fffbeb', icon: Clock },
  in_stock:  { label: 'In Stock',  color: '#3b82f6', bg: '#eff6ff', icon: Package },
  installed: { label: 'Installed', color: '#16a34a', bg: '#f0fdf4', icon: Check },
  returned:  { label: 'Returned',  color: '#dc2626', bg: '#fef2f2', icon: RefreshDouble },
};
const TRANSITIONS = {
  ordered:   ['in_stock', 'returned'],
  in_stock:  ['installed', 'returned'],
  installed: ['returned'],
  returned:  ['ordered'],
};
const NAVY = '#1e3a6b';
const ORANGE = '#f97316';

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

function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.ordered;
  const Icon = m.icon;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px',
      borderRadius: 20, fontSize: 12, fontWeight: 700, background: m.bg, color: m.color }}>
      <Icon width={12} height={12} />{m.label}
    </span>
  );
}

const fmt = (n, currency = 'AED') => `${currency} ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Parts() {
  const { t } = useTranslation();
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState('AED');

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPart, setEditingPart] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchParts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '200');
      const res = await api.get(`/parts?${params.toString()}`);
      if (res.success) setParts(res.data || []);
      else setError(res.message || 'Failed to load parts');
    } catch { setError('Network error loading parts'); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchParts(); }, [fetchParts]);
  useEffect(() => {
    api.get('/settings').then(res => { if (res.success && res.data?.currency) setCurrency(res.data.currency); }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.part_number || '').toLowerCase().includes(q) ||
      (p.work_order_number || '').toLowerCase().includes(q)
    );
  }, [parts, search]);

  const stats = useMemo(() => {
    const s = { total: parts.length, ordered: 0, in_stock: 0, installed: 0, returned: 0, installedValue: 0 };
    for (const p of parts) {
      s[p.status] = (s[p.status] || 0) + 1;
      if (p.status === 'installed') s.installedValue += Number(p.total_cost) || 0;
    }
    return s;
  }, [parts]);

  const changeStatus = async (part, newStatus) => {
    try {
      const res = await api.patch(`/parts/${part.id}/status`, { status: newStatus });
      if (res.success) fetchParts();
      else setError(res.message || 'Could not update status');
    } catch { setError('Network error updating status'); }
  };

  const deletePart = async (part) => {
    try {
      const res = await api.delete(`/parts/${part.id}`);
      if (res.success) { setDeleteConfirm(null); fetchParts(); }
      else setError(res.message || 'Could not delete part');
    } catch { setError('Network error deleting part'); }
  };

  return (
    <div style={{ padding: '0 0 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0 }}>Parts & Inventory</h1>
          <p style={{ fontSize: 13.5, color: '#64748b', margin: '4px 0 0' }}>Parts and materials consumed across work orders</p>
        </div>
        <button onClick={() => setShowAddModal(true)} style={st.primaryBtn}>
          <Plus width={16} height={16} /> Add Part
        </button>
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
        <KPICard icon={Package} label="Total Parts" value={stats.total} color={NAVY} />
        <KPICard icon={Clock} label="Ordered" value={stats.ordered} color="#f59e0b" />
        <KPICard icon={Package} label="In Stock" value={stats.in_stock} color="#3b82f6" />
        <KPICard icon={ShieldCheck} label="Installed" value={stats.installed} color="#16a34a" sub={fmt(stats.installedValue, currency)} />
        <KPICard icon={RefreshDouble} label="Returned" value={stats.returned} color="#dc2626" />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={st.searchWrap}>
          <Search width={16} height={16} style={{ color: '#94a3b8' }} />
          <input style={st.searchInput} placeholder="Search part name, number, or work order…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={st.filterSelect}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eef2f7' }}>
              {['Part', 'Work Order', 'Qty', 'Unit Cost', 'Total', 'Warranty', 'Status', ''].map(h => (
                <th key={h} style={st.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} style={st.emptyCell}>Loading parts…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} style={st.emptyCell}>
                <Wrench width={32} height={32} style={{ color: '#cbd5e1', marginBottom: 8 }} />
                <div>No parts found. Add a part to a work order to get started.</div>
              </td></tr>
            )}
            {!loading && filtered.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={st.td}>
                  <div style={{ fontWeight: 700, color: '#1e293b' }}>{p.name}</div>
                  {p.part_number && <div style={{ fontSize: 11.5, color: '#94a3b8' }}>#{p.part_number}</div>}
                </td>
                <td style={st.td}>
                  <span style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>{p.work_order_number || '—'}</span>
                </td>
                <td style={st.td}>{p.quantity}</td>
                <td style={st.td}>{fmt(p.unit_cost, currency)}</td>
                <td style={{ ...st.td, fontWeight: 700 }}>{fmt(p.total_cost, currency)}</td>
                <td style={st.td}>{p.warranty_period_days > 0 ? `${p.warranty_period_days}d` : '—'}</td>
                <td style={st.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusPill status={p.status} />
                    {(TRANSITIONS[p.status] || []).length > 0 && (
                      <select
                        value=""
                        onChange={e => { if (e.target.value) changeStatus(p, e.target.value); }}
                        style={st.statusSelect}
                        title="Move to…"
                      >
                        <option value="">Move to…</option>
                        {TRANSITIONS[p.status].map(s => (
                          <option key={s} value={s}>{STATUS_META[s].label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </td>
                <td style={st.td}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditingPart(p)} style={st.iconBtn} title="Edit">
                      <EditPencil width={14} height={14} />
                    </button>
                    <button
                      onClick={() => p.status !== 'installed' && setDeleteConfirm(p)}
                      style={{ ...st.iconBtn, color: p.status === 'installed' ? '#cbd5e1' : '#dc2626', cursor: p.status === 'installed' ? 'not-allowed' : 'pointer' }}
                      title={p.status === 'installed' ? 'Cannot delete an installed part' : 'Delete'}
                    >
                      <Trash width={14} height={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <PartFormModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); fetchParts(); }}
        />
      )}
      {editingPart && (
        <PartFormModal
          part={editingPart}
          onClose={() => setEditingPart(null)}
          onSaved={() => { setEditingPart(null); fetchParts(); }}
        />
      )}
      {deleteConfirm && (
        <div style={st.overlay} onClick={() => setDeleteConfirm(null)}>
          <div style={st.confirmModal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Delete part?</h3>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, color: '#64748b' }}>
              Remove <strong>{deleteConfirm.name}</strong> from work order {deleteConfirm.work_order_number}. This can't be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteConfirm(null)} style={st.ghostBtn}>Cancel</button>
              <button onClick={() => deletePart(deleteConfirm)} style={{ ...st.primaryBtn, background: '#dc2626' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Add / Edit Part modal ── */
function PartFormModal({ part, onClose, onSaved }) {
  const isEdit = !!part;
  const [workOrderId, setWorkOrderId] = useState(part?.work_order_id || '');
  const [woSearch, setWoSearch] = useState(part?.work_order_number || '');
  const [woResults, setWoResults] = useState([]);
  const [woSelected, setWoSelected] = useState(isEdit ? { id: part.work_order_id, work_order_number: part.work_order_number } : null);

  const [partNumber, setPartNumber] = useState(part?.part_number || '');
  const [name, setName] = useState(part?.name || '');
  const [description, setDescription] = useState(part?.description || '');
  const [quantity, setQuantity] = useState(part?.quantity || 1);
  const [unitCost, setUnitCost] = useState(part?.unit_cost || '');
  const [warrantyDays, setWarrantyDays] = useState(part?.warranty_period_days || '');
  const [notes, setNotes] = useState(part?.notes || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isEdit || !woSearch.trim() || woSearch === woSelected?.work_order_number) { setWoResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/work-orders?search=${encodeURIComponent(woSearch.trim())}&limit=8`)
        .then(res => { if (res.success) setWoResults(res.data || []); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [woSearch, isEdit, woSelected]);

  const submit = async () => {
    if (!isEdit && !workOrderId) { setError('Select a work order for this part.'); return; }
    if (!name.trim()) { setError('Part name is required.'); return; }
    setSaving(true); setError('');
    try {
      let res;
      if (isEdit) {
        res = await api.put(`/parts/${part.id}`, {
          part_number: partNumber || null, name: name.trim(), description: description || null,
          quantity: parseInt(quantity, 10) || 1, unit_cost: parseFloat(unitCost) || 0,
          warranty_period_days: parseInt(warrantyDays, 10) || 0, notes: notes || null,
        });
      } else {
        res = await api.post('/parts', {
          work_order_id: Number(workOrderId), part_number: partNumber || null,
          name: name.trim(), description: description || null,
          quantity: parseInt(quantity, 10) || 1, unit_cost: parseFloat(unitCost) || 0,
          warranty_period_days: parseInt(warrantyDays, 10) || 0, notes: notes || null,
        });
      }
      if (res.success) onSaved();
      else setError(res.message || 'Could not save part.');
    } catch { setError('Network error saving part.'); }
    finally { setSaving(false); }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>{isEdit ? 'Edit Part' : 'Add Part'}</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={st.errorBar}>{error}</div>}

          {!isEdit && (
            <Field label="Work order *">
              {woSelected ? (
                <div style={st.selectedWO}>
                  <span>{woSelected.work_order_number} — {woSelected.customer_name}</span>
                  <button onClick={() => { setWoSelected(null); setWorkOrderId(''); setWoSearch(''); }} style={st.linkBtn}>Change</button>
                </div>
              ) : (
                <>
                  <input style={st.input} placeholder="Search work order number or customer…" value={woSearch}
                    onChange={e => setWoSearch(e.target.value)} />
                  {woResults.length > 0 && (
                    <div style={st.woList}>
                      {woResults.map(w => (
                        <button key={w.id} style={st.woItem} onClick={() => {
                          setWorkOrderId(String(w.id)); setWoSelected(w); setWoSearch(w.work_order_number); setWoResults([]);
                        }}>
                          <strong>{w.work_order_number}</strong> — {w.customer_name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Field>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Part number"><input style={st.input} value={partNumber} onChange={e => setPartNumber(e.target.value)} placeholder="e.g. BP-4521" /></Field>
            <Field label="Part name *"><input style={st.input} value={name} onChange={e => setName(e.target.value)} placeholder="Front brake pads" /></Field>
          </div>
          <Field label="Description"><input style={st.input} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional details" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Quantity"><input style={st.input} value={quantity} onChange={e => setQuantity(e.target.value)} /></Field>
            <Field label="Unit cost"><input style={st.input} placeholder="0.00" value={unitCost} onChange={e => setUnitCost(e.target.value)} /></Field>
            <Field label="Warranty (days)"><input style={st.input} placeholder="0" value={warrantyDays} onChange={e => setWarrantyDays(e.target.value)} /></Field>
          </div>
          <Field label="Notes"><input style={st.input} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" /></Field>

          <div style={st.totalPreview}>
            Total: <strong>{fmt((parseFloat(quantity) || 0) * (parseFloat(unitCost) || 0))}</strong>
          </div>
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Part'}
          </button>
        </div>
      </div>
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

const st = {
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: 'none',
    background: `linear-gradient(135deg,${ORANGE},#ea580c)`, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700,
    boxShadow: '0 4px 14px rgba(249,115,22,0.3)' },
  ghostBtn: { padding: '10px 18px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  errorBar: { display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
    padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14, fontWeight: 500 },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '0 12px', background: '#fff', flex: 1, minWidth: 260 },
  searchInput: { border: 'none', outline: 'none', padding: '10px 0', fontSize: 14, width: '100%', background: 'transparent' },
  filterSelect: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, background: '#fff', color: '#334155', cursor: 'pointer' },
  th: { textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' },
  td: { padding: '12px 16px', fontSize: 13.5, color: '#334155', verticalAlign: 'middle' },
  emptyCell: { textAlign: 'center', padding: '48px 16px', color: '#94a3b8', fontSize: 13.5 },
  statusSelect: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 8px', fontSize: 11.5, color: '#64748b', background: '#fff', cursor: 'pointer' },
  iconBtn: { width: 30, height: 30, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569' },
  // z-index must clear the sidebar (1065) and topbar (1060) in Layout.css.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 },
  modal: { background: '#fff', borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,0.28)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 14px' },
  closeBtn: { background: '#f1f5f9', border: 'none', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569' },
  confirmModal: { background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 380, boxShadow: '0 24px 70px rgba(0,0,0,0.28)' },
  input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none', color: '#1e293b', background: '#fff', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  woList: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, maxHeight: 160, overflowY: 'auto', border: '1px solid #eef2f7', borderRadius: 10, padding: 6 },
  woItem: { textAlign: 'left', border: 'none', background: '#f8fafc', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 13 },
  selectedWO: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, fontWeight: 600, color: NAVY },
  linkBtn: { background: 'none', border: 'none', color: ORANGE, cursor: 'pointer', fontSize: 12.5, fontWeight: 700 },
  totalPreview: { background: '#f8fafc', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, color: '#475569' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #f1f5f9' },
};
