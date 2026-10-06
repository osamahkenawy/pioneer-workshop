/**
 * NewEstimateModal — staff-side estimate builder, sent to a customer for
 * per-line approval (routes/estimates.js: POST /, POST /:id/send).
 *
 * Deliberately separate from NewWorkOrderModal, not a replacement for it.
 * "New Job Card" still creates a job card immediately — a walk-in whose car
 * is on the ramp right now cannot wait on an email round-trip. This is for
 * the case the workshop actually asked for: build the estimate, the
 * customer approves or rejects each line from their phone, and the job card
 * appears automatically the moment every line is decided
 * (estimates.js: applyLineDecision → convertEstimateToWorkOrder).
 *
 * Labour and parts are separate lists, not one flat item list like the job
 * card modal's estimate step — that split is the data model
 * (estimate_lines.line_type) and the SOP ask ("Labor charges separate and
 * Part separate"), not just a layout choice.
 */
import { useState, useEffect, useCallback } from 'react';
import { Xmark, Wrench, Cube, Plus, Trash, SendMail, FloppyDisk } from 'iconoir-react';
import api from '../lib/api';
import CustomerPicker from './CustomerPicker';

const ORANGE = '#f97316';
const NAVY = '#1e3a6b';

const EMPTY_LINE = () => ({ description: '', quantity: 1, unit_cost: '', unit_price: '', part_number: '', urgency: 'now' });

const URGENCY = [
  { value: 'now', label: 'Now' },
  { value: 'soon', label: 'Soon' },
  { value: 'can_wait', label: 'Can wait' },
];

const CUSTOMER_TYPES = [
  { value: 'retail_cash', label: 'Retail / cash' },
  { value: 'credit', label: 'Credit account' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'internal_fleet', label: 'Internal fleet' },
];

export default function NewEstimateModal({ open, onClose, onSent }) {
  const [customer, setCustomer] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState('');
  const [customerType, setCustomerType] = useState('retail_cash');
  const [labourLines, setLabourLines] = useState([EMPTY_LINE()]);
  const [partsLines, setPartsLines] = useState([EMPTY_LINE()]);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(null); // null | 'draft' | 'send'
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { estimate_number, approval_url? }

  const reset = useCallback(() => {
    setCustomer(null); setVehicles([]); setVehicleId(''); setCustomerType('retail_cash');
    setLabourLines([EMPTY_LINE()]); setPartsLines([EMPTY_LINE()]); setEmail('');
    setSubmitting(null); setError(''); setResult(null);
  }, []);

  useEffect(() => { if (open) reset(); }, [open, reset]);

  useEffect(() => {
    if (!customer?.id) { setVehicles([]); setVehicleId(''); return; }
    setEmail(customer.email || '');
    (async () => {
      const res = await api.get(`/vehicles?customer_id=${customer.id}`);
      if (res.success) setVehicles(res.data || []);
    })();
  }, [customer]);

  if (!open) return null;

  const money = v => Number(v || 0).toFixed(2);
  const lineTotal = l => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
  const labourTotal = labourLines.reduce((s, l) => s + lineTotal(l), 0);
  const partsTotal = partsLines.reduce((s, l) => s + lineTotal(l), 0);
  const vat = (labourTotal + partsTotal) * 0.05;
  const grand = labourTotal + partsTotal + vat;

  const updateLine = (setFn, idx, field, value) =>
    setFn(prev => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = setFn => setFn(prev => [...prev, EMPTY_LINE()]);
  const removeLine = (setFn, idx) => setFn(prev => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  function validate() {
    if (!customer?.id) return 'Choose a customer.';
    const allLines = [...labourLines.map(l => ({ ...l, line_type: 'labour' })),
                       ...partsLines.map(l => ({ ...l, line_type: 'parts' }))]
      .filter(l => l.description.trim());
    if (!allLines.length) return 'Add at least one labour or parts line with a description.';
    for (const l of allLines) {
      if (!(Number(l.unit_price) >= 0)) return `"${l.description}" needs a valid price.`;
    }
    return '';
  }

  async function buildAndCreate() {
    const lines = [
      ...labourLines.filter(l => l.description.trim()).map(l => ({ ...l, line_type: 'labour' })),
      ...partsLines.filter(l => l.description.trim()).map(l => ({ ...l, line_type: 'parts' })),
    ];
    return api.post('/estimates', {
      customer_id: Number(customer.id),
      vehicle_id: vehicleId ? Number(vehicleId) : null,
      customer_type: customerType,
      vat_rate: 5,
      lines: lines.map(l => ({
        line_type: l.line_type,
        description: l.description.trim(),
        part_number: l.part_number || undefined,
        quantity: Number(l.quantity) || 1,
        unit_cost: Number(l.unit_cost) || 0,
        unit_price: Number(l.unit_price) || 0,
        urgency: l.urgency,
      })),
    });
  }

  async function saveDraft() {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setSubmitting('draft'); setError('');
    try {
      const res = await buildAndCreate();
      if (!res.success) { setError(res.message || 'Could not save the estimate.'); return; }
      setResult({ estimate_number: res.estimate_number, estimateId: res.estimateId });
    } catch (e) {
      setError(e?.message || 'Could not save the estimate.');
    } finally {
      setSubmitting(null);
    }
  }

  async function sendForApproval() {
    const msg = validate();
    if (msg) { setError(msg); return; }
    if (!email.trim() && !customer?.email) {
      setError('No email on file for this customer — enter one to send to.');
      return;
    }
    setSubmitting('send'); setError('');
    try {
      const create = await buildAndCreate();
      if (!create.success) { setError(create.message || 'Could not create the estimate.'); return; }
      const send = await api.post(`/estimates/${create.estimateId}/send`, { email: email.trim() || undefined });
      if (!send.success) { setError(send.message || 'Estimate created, but could not send it.'); return; }
      setResult({ estimate_number: create.estimate_number, sentTo: send.message, approval_url: send.approval_url });
      onSent?.({ estimateId: create.estimateId, estimate_number: create.estimate_number });
    } catch (e) {
      setError(e?.message || 'Could not send the estimate.');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.header}>
          <div>
            <h2 style={st.title}>New Estimate</h2>
            <p style={st.subtitle}>Send line items to the customer for approval — a job card is created automatically once every line is decided.</p>
          </div>
          <button style={st.closeBtn} onClick={onClose}><Xmark width={18} height={18} /></button>
        </div>

        <div style={st.body}>
          {error && <div style={st.error}>{error}</div>}

          {result ? (
            <div style={st.resultBox}>
              <div style={st.resultTitle}>✓ Estimate {result.estimate_number}</div>
              {result.sentTo ? (
                <>
                  <p>{result.sentTo}. The customer can approve or reject each line from their phone.</p>
                  {result.approval_url && (
                    <p style={st.approvalLink}>Link (for testing / manual sharing): <a href={result.approval_url} target="_blank" rel="noreferrer">{result.approval_url}</a></p>
                  )}
                </>
              ) : (
                <p>Saved as a draft. Open it from the Estimates list to send it when ready.</p>
              )}
              <button style={st.primaryBtn} onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              <div style={st.grid2}>
                <Field label="Customer *">
                  <CustomerPicker value={customer} onChange={setCustomer} />
                </Field>
                <Field label="Account type">
                  <select style={st.input} value={customerType} onChange={e => setCustomerType(e.target.value)}>
                    {CUSTOMER_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>

              <div style={st.grid2}>
                <Field label="Vehicle">
                  <select style={st.input} value={vehicleId} onChange={e => setVehicleId(e.target.value)} disabled={!customer?.id}>
                    <option value="">{customer?.id ? 'Select vehicle…' : 'Choose a customer first'}</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>{v.make} {v.model}{v.plate_number ? ` — ${v.plate_number}` : ''}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Send to email">
                  <input style={st.input} value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@example.com" />
                </Field>
              </div>

              <LineSection
                icon={Wrench} title="Labour" lines={labourLines}
                onChange={(i, f, v) => updateLine(setLabourLines, i, f, v)}
                onAdd={() => addLine(setLabourLines)}
                onRemove={i => removeLine(setLabourLines, i)}
              />
              <LineSection
                icon={Cube} title="Parts" lines={partsLines} showPartNumber
                onChange={(i, f, v) => updateLine(setPartsLines, i, f, v)}
                onAdd={() => addLine(setPartsLines)}
                onRemove={i => removeLine(setPartsLines, i)}
              />

              <div style={st.totalsBox}>
                <Row label="Labour" value={`AED ${money(labourTotal)}`} />
                <Row label="Parts" value={`AED ${money(partsTotal)}`} />
                <Row label="VAT (5%)" value={`AED ${money(vat)}`} />
                <div style={st.totalDivider} />
                <Row label="Estimate total" value={`AED ${money(grand)}`} strong />
              </div>
            </>
          )}
        </div>

        {!result && (
          <div style={st.footer}>
            <button style={st.ghostBtn} onClick={onClose}>Cancel</button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...st.ghostBtn, opacity: submitting ? 0.6 : 1 }} disabled={!!submitting} onClick={saveDraft}>
                <FloppyDisk width={15} height={15} /> {submitting === 'draft' ? 'Saving…' : 'Save as draft'}
              </button>
              <button style={{ ...st.primaryBtn, opacity: submitting ? 0.7 : 1 }} disabled={!!submitting} onClick={sendForApproval}>
                <SendMail width={15} height={15} /> {submitting === 'send' ? 'Sending…' : 'Send for approval'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LineSection({ icon: Icon, title, lines, onChange, onAdd, onRemove, showPartNumber }) {
  return (
    <div style={st.section}>
      <div style={st.sectionLabel}><Icon width={14} height={14} /> {title}</div>
      {lines.map((l, i) => (
        <div key={i} style={st.lineRow}>
          <input style={{ ...st.input, flex: 2 }} placeholder="Description"
            value={l.description} onChange={e => onChange(i, 'description', e.target.value)} />
          {showPartNumber && (
            <input style={{ ...st.input, flex: 1 }} placeholder="Part #"
              value={l.part_number} onChange={e => onChange(i, 'part_number', e.target.value)} />
          )}
          <input style={{ ...st.input, width: 56 }} type="number" min="0" step="1" placeholder="Qty"
            value={l.quantity} onChange={e => onChange(i, 'quantity', e.target.value)} />
          <input style={{ ...st.input, width: 90 }} type="number" min="0" step="0.01" placeholder="Price"
            value={l.unit_price} onChange={e => onChange(i, 'unit_price', e.target.value)} />
          <select style={{ ...st.input, width: 92 }} value={l.urgency} onChange={e => onChange(i, 'urgency', e.target.value)}>
            {URGENCY.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          <button style={st.lineDel} onClick={() => onRemove(i)}><Trash width={15} height={15} /></button>
        </div>
      ))}
      <button style={st.addLineBtn} onClick={onAdd}><Plus width={14} height={14} /> Add line</button>
    </div>
  );
}

function Field({ label, children }) {
  return <label style={st.field}><span style={st.fieldLabel}>{label}</span>{children}</label>;
}
function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13.5, fontWeight: strong ? 800 : 500, color: strong ? NAVY : '#475569' }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

const st = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: '#fff', borderRadius: 18, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 24px 16px', borderBottom: '1px solid #eef1f5' },
  title: { margin: 0, fontSize: 20, fontWeight: 800, color: NAVY },
  subtitle: { margin: '4px 0 0', fontSize: 13, color: '#64748b', maxWidth: 460 },
  closeBtn: { background: '#f1f5f9', border: 'none', borderRadius: 10, width: 32, height: 32, cursor: 'pointer', color: '#475569' },
  body: { padding: '18px 24px', overflowY: 'auto', flex: 1 },
  error: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14, fontWeight: 500 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: 700, color: '#475569' },
  input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, outline: 'none', color: '#1e293b', background: '#fff', fontFamily: 'inherit' },
  section: { marginBottom: 16 },
  sectionLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: NAVY, fontWeight: 800, marginBottom: 8 },
  lineRow: { display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' },
  lineDel: { width: 32, height: 32, borderRadius: 8, border: 'none', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  addLineBtn: { display: 'flex', alignItems: 'center', gap: 6, border: '1.5px dashed #cbd5e1', background: '#f8fafc', color: NAVY, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 },
  totalsBox: { background: '#f8fafc', borderRadius: 12, padding: '14px 16px', marginTop: 4 },
  totalDivider: { height: 1, background: '#e2e8f0', margin: '6px 0' },
  footer: { display: 'flex', justifyContent: 'space-between', padding: '16px 24px', borderTop: '1px solid #eef1f5' },
  ghostBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 13.5, fontWeight: 600 },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${ORANGE},#ea580c)`, color: '#fff', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, boxShadow: '0 4px 14px rgba(249,115,22,0.3)' },
  resultBox: { background: '#ecfdf3', border: '1px solid #bbf7d0', borderRadius: 12, padding: '20px 22px', textAlign: 'center' },
  resultTitle: { fontSize: 16, fontWeight: 800, color: '#15803d', marginBottom: 8 },
  approvalLink: { fontSize: 12, color: '#64748b', wordBreak: 'break-all', marginTop: 8 },
};
