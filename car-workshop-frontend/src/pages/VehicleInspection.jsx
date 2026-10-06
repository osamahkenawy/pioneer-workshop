/**
 * Vehicle Inspection Form — the walk-around damage check, done with the
 * customer standing at the car (journey step 3 at intake, step 9 at handover).
 *
 * Pick a damage code from the legend, click the spot on the car diagram, and a
 * marker lands there. Completing the form stamps the matching Customer Journey
 * checkpoint on the work order.
 *
 * Reached from WorkOrderDetail: /work-orders/:id/inspection[?type=joint]
 */
import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Check, Printer, Trash, WarningTriangle, Erase,
} from 'iconoir-react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { fmtCurrency } from '../utils/currency';
import CarDamageDiagram, { DAMAGE_CODES } from '../components/CarDamageDiagram';

const CODE_LIST = Object.entries(DAMAGE_CODES);

const VIEW_LABELS = {
  top: 'Top / Roof', left: 'Driver Side', right: 'Passenger Side', front: 'Front', rear: 'Rear',
};

const LBL = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 };
const INPUT = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#fff', boxSizing: 'border-box' };
const CARD = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 };
const BTN = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent' };

export default function VehicleInspection() {
  const { id } = useParams();               // work order id
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inspectionType = searchParams.get('type') === 'joint' ? 'joint' : 'intake';
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';

  const [inspection, setInspection] = useState(null);
  const [form, setForm] = useState({});
  const [marks, setMarks] = useState([]);
  const [activeCode, setActiveCode] = useState('');
  const [selectedMarkId, setSelectedMarkId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  const markSeq = useRef(1);

  /* ── Load (or start) the inspection for this work order ── */
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // POST is idempotent per (work order, type): it reopens the existing
      // inspection rather than creating a second one.
      const res = await api.post('/vehicle-inspections', {
        work_order_id: Number(id), inspection_type: inspectionType,
      });
      if (!res.success) { setError(res.message || 'Could not open the inspection'); return; }
      applyRow(res.data);
    } catch (e) {
      setError(e.message || 'Could not open the inspection');
    } finally {
      setLoading(false);
    }
  }, [id, inspectionType]);

  useEffect(() => { load(); }, [load]);

  function applyRow(row) {
    setInspection(row);
    setForm({
      estimate_date: (row.estimate_date || '').toString().slice(0, 10),
      original_estimate: row.original_estimate ?? '',
      customer_name: row.customer_name || '',
      customer_phone: row.customer_phone || '',
      customer_email: row.customer_email || '',
      vehicle_year: row.vehicle_year || '',
      vehicle_make: row.vehicle_make || '',
      vehicle_model: row.vehicle_model || '',
      vin: row.vin || '',
      plate_number: row.plate_number || '',
      odometer: row.odometer ?? '',
      service_recommended: row.service_recommended || '',
      service_accepted: row.service_accepted || '',
      notes: row.notes || '',
    });
    const loaded = Array.isArray(row.marks) ? row.marks : [];
    setMarks(loaded);
    markSeq.current = loaded.length + 1;
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isCompleted = inspection?.status === 'completed';

  /* ── Marker editing ── */
  const addMark = (view, x, y) => {
    if (isCompleted || !activeCode) return;
    const mark = { id: `m${Date.now()}${markSeq.current++}`, view, code: activeCode, x, y, note: '' };
    setMarks(prev => [...prev, mark]);
    setSelectedMarkId(mark.id);
  };
  const updateMark = (markId, patch) =>
    setMarks(prev => prev.map(m => (m.id === markId ? { ...m, ...patch } : m)));
  const removeMark = (markId) => {
    setMarks(prev => prev.filter(m => m.id !== markId));
    setSelectedMarkId(s => (s === markId ? '' : s));
  };

  /* ── Save / complete ── */
  const save = async ({ silent = false } = {}) => {
    if (isCompleted) return true;
    setSaving(true); setError('');
    try {
      const res = await api.put(`/vehicle-inspections/${inspection.id}`, {
        ...form,
        original_estimate: form.original_estimate === '' ? null : form.original_estimate,
        odometer: form.odometer === '' ? null : form.odometer,
        marks,
      });
      if (!res.success) { setError(res.message || 'Save failed'); return false; }
      setInspection(res.data);
      setSavedAt(new Date());
      return true;
    } catch (e) {
      setError(e.message || 'Save failed');
      return false;
    } finally {
      setSaving(false);
      if (silent) { /* no-op, kept for call-site clarity */ }
    }
  };

  const complete = async () => {
    if (!(await save())) return;
    if (signatureDirty.current) await uploadSignature();
    setSaving(true);
    try {
      const res = await api.patch(`/vehicle-inspections/${inspection.id}/complete`);
      if (res.success) setInspection(res.data);
      else setError(res.message || 'Could not complete the inspection');
    } finally { setSaving(false); }
  };

  /* ── Signature pad ── */
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const signatureDirty = useRef(false);

  const canvasPos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const startDraw = (e) => {
    if (isCompleted) return;
    drawing.current = true; signatureDirty.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = canvasPos(e);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    ctx.beginPath(); ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveDraw = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = canvasPos(e);
    ctx.lineTo(x, y); ctx.stroke();
  };
  const endDraw = () => { drawing.current = false; };
  const clearSignature = () => {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    signatureDirty.current = false;
  };
  const uploadSignature = async () => {
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const res = await api.patch(`/vehicle-inspections/${inspection.id}/signature`, { signature: dataUrl });
      if (res.success) {
        setInspection(i => ({ ...i, signature_url: res.url }));
        signatureDirty.current = false;
      }
    } catch { /* non-blocking — the form itself is already saved */ }
  };

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>Loading inspection…</div>;
  if (!inspection) {
    return (
      <div style={{ padding: 32 }}>
        <p style={{ color: '#dc2626', marginBottom: 12 }}>{error || 'Inspection unavailable'}</p>
        <button style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => navigate(-1)}>
          <ArrowLeft width={14} height={14} /> Back
        </button>
      </div>
    );
  }

  const selected = marks.find(m => m.id === selectedMarkId);

  return (
    <div className="vi-page" style={{ padding: 20, maxWidth: 1300, margin: '0 auto' }}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .vi-page, .vi-page * { visibility: visible !important; }
          .vi-page { position: absolute; inset: 0; padding: 0 !important; max-width: none; }
          .vi-no-print { display: none !important; }
          .vi-view-panel { break-inside: avoid; }
        }
      `}</style>

      {/* ── Header ── */}
      <div className="vi-no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => navigate(`/work-orders/${id}`)}>
          <ArrowLeft width={14} height={14} /> Work Order
        </button>
        <div style={{ flex: 1 }} />
        {savedAt && !isCompleted && (
          <span style={{ fontSize: 12, color: '#16a34a' }}>Saved {savedAt.toLocaleTimeString()}</span>
        )}
        <button style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => window.print()}>
          <Printer width={14} height={14} /> Print
        </button>
        {!isCompleted && (
          <>
            <button disabled={saving} style={{ ...BTN, background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe' }} onClick={() => save()}>
              <Check width={14} height={14} /> {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button disabled={saving} style={{ ...BTN, background: '#16a34a', color: '#fff' }} onClick={complete}>
              <Check width={14} height={14} /> Complete Inspection
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="vi-no-print" style={{ ...CARD, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c', display: 'flex', gap: 8, alignItems: 'center' }}>
          <WarningTriangle width={16} height={16} /> {error}
        </div>
      )}

      {/* ── Title block ── */}
      <div style={{ ...CARD, textAlign: 'center', paddingBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: '#1e3a6b' }}>
          {workshop?.name || 'Workshop'} <span style={{ color: '#0e7490' }}>— Vehicle Inspection Form</span>
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
          {inspectionType === 'joint' ? 'Joint inspection at handover' : 'Intake inspection — exterior condition'}
          {' · '}Work Order {inspection.work_order_number || `#${id}`}
          {isCompleted && (
            <span style={{ marginLeft: 8, background: '#dcfce7', color: '#16a34a', padding: '2px 10px', borderRadius: 12, fontWeight: 700, fontSize: 11 }}>
              COMPLETED
            </span>
          )}
        </p>
      </div>

      {/* ── Header fields ── */}
      <div style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div><label style={LBL}>Date of Estimate</label>
            <input type="date" style={INPUT} disabled={isCompleted} value={form.estimate_date || ''} onChange={e => set('estimate_date', e.target.value)} /></div>
          <div><label style={LBL}>Original Estimate ({cur})</label>
            <input type="number" step="0.01" style={INPUT} disabled={isCompleted} value={form.original_estimate ?? ''} onChange={e => set('original_estimate', e.target.value)} /></div>
          <div><label style={LBL}>Name</label>
            <input style={INPUT} disabled={isCompleted} value={form.customer_name} onChange={e => set('customer_name', e.target.value)} /></div>
          <div><label style={LBL}>Phone</label>
            <input style={INPUT} disabled={isCompleted} value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} /></div>
          <div><label style={LBL}>E-mail</label>
            <input style={INPUT} disabled={isCompleted} value={form.customer_email} onChange={e => set('customer_email', e.target.value)} /></div>
          <div><label style={LBL}>Year</label>
            <input style={INPUT} disabled={isCompleted} value={form.vehicle_year} onChange={e => set('vehicle_year', e.target.value)} /></div>
          <div><label style={LBL}>Make</label>
            <input style={INPUT} disabled={isCompleted} value={form.vehicle_make} onChange={e => set('vehicle_make', e.target.value)} /></div>
          <div><label style={LBL}>Model</label>
            <input style={INPUT} disabled={isCompleted} value={form.vehicle_model} onChange={e => set('vehicle_model', e.target.value)} /></div>
          <div><label style={LBL}>VIN</label>
            <input style={INPUT} disabled={isCompleted} value={form.vin} onChange={e => set('vin', e.target.value)} /></div>
          <div><label style={LBL}>Plate</label>
            <input style={INPUT} disabled={isCompleted} value={form.plate_number} onChange={e => set('plate_number', e.target.value)} /></div>
          <div><label style={LBL}>Odometer (km)</label>
            <input type="number" style={INPUT} disabled={isCompleted} value={form.odometer ?? ''} onChange={e => set('odometer', e.target.value)} /></div>
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 12.5, color: '#1e3a6b', fontWeight: 600 }}>
          Inspect the vehicle with the customer. Point out and mark on the diagram any current damage or issues.
        </p>
      </div>

      {/* ── Diagram + legend ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 230px', gap: 16, alignItems: 'start' }}>
        <div style={CARD}>
          <CarDamageDiagram
            marks={marks}
            activeCode={isCompleted ? '' : activeCode}
            selectedMarkId={selectedMarkId}
            onAddMark={isCompleted ? undefined : addMark}
            onSelectMark={setSelectedMarkId}
          />
          {!isCompleted && (
            <p className="vi-no-print" style={{ margin: '10px 2px 0', fontSize: 12, color: activeCode ? '#0e7490' : '#94a3b8' }}>
              {activeCode
                ? `Click on the car to mark "${DAMAGE_CODES[activeCode]}"`
                : 'Pick a damage code from the legend, then click the spot on the car.'}
            </p>
          )}
        </div>

        {/* Legend */}
        <div style={{ ...CARD, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#1e3a6b', textAlign: 'center', marginBottom: 8, letterSpacing: 0.5 }}>
            LEGEND
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {CODE_LIST.map(([code, label]) => {
              const on = code === activeCode;
              const used = marks.filter(m => m.code === code).length;
              return (
                <button
                  key={code}
                  disabled={isCompleted}
                  onClick={() => setActiveCode(on ? '' : code)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6,
                    border: `1px solid ${on ? '#0e7490' : '#e2e8f0'}`,
                    background: on ? '#cffafe' : '#fff',
                    cursor: isCompleted ? 'default' : 'pointer', textAlign: 'left', width: '100%',
                  }}
                >
                  <span style={{
                    fontSize: 11, fontWeight: 800, color: on ? '#0e7490' : '#334155',
                    background: on ? '#fff' : '#f1f5f9', borderRadius: 4, padding: '2px 5px', minWidth: 26, textAlign: 'center',
                  }}>{code}</span>
                  <span style={{ fontSize: 11.5, color: '#334155', flex: 1 }}>{label}</span>
                  {used > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626' }}>{used}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Marked damage list ── */}
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a6b', marginBottom: 10 }}>
          Marked Damage ({marks.length})
        </div>
        {marks.length === 0 ? (
          <p style={{ fontSize: 12.5, color: '#94a3b8', margin: 0 }}>No damage marked yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {marks.map((m, i) => (
              <div key={m.id}
                onClick={() => setSelectedMarkId(m.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8,
                  border: `1px solid ${m.id === selectedMarkId ? '#0e7490' : '#f1f5f9'}`,
                  background: m.id === selectedMarkId ? '#f0fdfa' : '#f8fafc', cursor: 'pointer',
                }}>
                <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 16 }}>{i + 1}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '2px 6px', minWidth: 28, textAlign: 'center' }}>
                  {m.code}
                </span>
                <span style={{ fontSize: 12.5, color: '#334155', minWidth: 130 }}>{DAMAGE_CODES[m.code]}</span>
                <span style={{ fontSize: 11.5, color: '#64748b', minWidth: 100 }}>{VIEW_LABELS[m.view]}</span>
                <input
                  style={{ ...INPUT, flex: 1, padding: '5px 8px', fontSize: 12 }}
                  placeholder="Note (optional)"
                  disabled={isCompleted}
                  value={m.note || ''}
                  onClick={e => e.stopPropagation()}
                  onChange={e => updateMark(m.id, { note: e.target.value })}
                />
                {!isCompleted && (
                  <button className="vi-no-print"
                    onClick={e => { e.stopPropagation(); removeMark(m.id); }}
                    style={{ ...BTN, padding: '5px 8px', background: '#fff', color: '#dc2626', borderColor: '#fecaca' }}>
                    <Trash width={13} height={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Service recommended / accepted ── */}
      <div style={{ ...CARD, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div>
          <label style={LBL}>Service Recommended</label>
          <textarea rows={3} style={{ ...INPUT, resize: 'vertical' }} disabled={isCompleted}
            value={form.service_recommended} onChange={e => set('service_recommended', e.target.value)} />
        </div>
        <div>
          <label style={LBL}>Service Accepted</label>
          <textarea rows={3} style={{ ...INPUT, resize: 'vertical' }} disabled={isCompleted}
            value={form.service_accepted} onChange={e => set('service_accepted', e.target.value)} />
        </div>
        <div>
          <label style={LBL}>Notes</label>
          <textarea rows={3} style={{ ...INPUT, resize: 'vertical' }} disabled={isCompleted}
            value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>

      {/* ── Customer signature ── */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1e3a6b' }}>Customer Signature</span>
          <div style={{ flex: 1 }} />
          {!isCompleted && (
            <>
              <button className="vi-no-print" style={{ ...BTN, padding: '5px 10px', background: '#f1f5f9', color: '#334155' }} onClick={clearSignature}>
                <Erase width={13} height={13} /> Clear
              </button>
              <button className="vi-no-print" style={{ ...BTN, padding: '5px 10px', background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe' }} onClick={uploadSignature}>
                <Check width={13} height={13} /> Save Signature
              </button>
            </>
          )}
        </div>
        {inspection.signature_url ? (
          <img src={inspection.signature_url} alt="Customer signature"
            style={{ maxHeight: 130, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }} />
        ) : (
          <canvas
            ref={canvasRef} width={600} height={150}
            onPointerDown={startDraw} onPointerMove={moveDraw} onPointerUp={endDraw} onPointerLeave={endDraw}
            style={{
              width: '100%', maxWidth: 600, height: 150, border: '1px dashed #cbd5e1', borderRadius: 8,
              background: '#fff', touchAction: 'none', cursor: isCompleted ? 'default' : 'crosshair',
            }}
          />
        )}
      </div>

      {isCompleted && (
        <p style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          Completed {inspection.completed_at ? new Date(inspection.completed_at).toLocaleString() : ''} — this inspection is locked.
        </p>
      )}
    </div>
  );
}
