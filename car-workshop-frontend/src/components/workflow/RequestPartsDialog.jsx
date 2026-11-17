/**
 * RequestPartsDialog — request a job's parts from the Store (material
 * requisition, MRN) from the Team Board or Job Assignment (client feedback,
 * 16 Nov 2026, point 5). The parts come before the technician (point 18,
 * backend lib/parts-request.js): until it is sent nobody can be assigned.
 *
 * Starts from the approved parts lines (GET /api/job-tasks/parts-request:
 * work_order_items of type parts with the estimate line's part number),
 * each editable — quantity, part number, remove — plus lines added by hand
 * and a note, and sends them as one requisition on the job's Inspection job
 * card (POST /api/job-cards/:id/requisitions; the Store is notified). Lines
 * already on a requisition start unticked.
 *
 * Props: workOrderId, onClose, onDone({ req_number, items }).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Package, Plus, Trash, WarningTriangle, Xmark, InfoCircle } from 'iconoir-react';
import api from '../../lib/api';
import './RequestPartsDialog.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let rowSeq = 0;
const newRow = (over = {}) => ({ key: ++rowSeq, on: true, description: '', part_number: '', quantity: 1, job_name: null, fromJob: false, ...over });
const qtyText = n => String(Math.round(Number(n) * 1000) / 1000);

export default function RequestPartsDialog({ workOrderId, onClose, onDone }) {
  const { t } = useTranslation();
  const id = useId();
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [touched, setTouched] = useState(false);
  const ref = useRef(null);
  const sendRef = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await api.get(`/job-tasks/parts-request?work_order_id=${workOrderId}`);
        if (!live) return;
        if (!r.success) { setLoadErr(r.message || t('requestParts.load_failed', 'Could not load the parts.')); return; }
        setData(r.data);
        const lines = r.data.lines || [];
        setRows(lines.length
          ? lines.map(l => newRow({ on: !l.requested, description: l.description, part_number: l.part_number || '', quantity: l.quantity, job_name: l.job_name, fromJob: true, requested: l.requested }))
          : [newRow()]);
      } catch {
        if (live) setLoadErr(t('requestParts.network', 'Network error — check the connection.'));
      }
    })();
    return () => { live = false; };
  }, [workOrderId, t]);

  // Focus the dialog, keep Tab inside, Esc closes.
  useEffect(() => { requestAnimationFrame(() => (ref.current?.querySelector(FOCUSABLE) || ref.current)?.focus()); }, []);
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!saving) onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const upd = (key, patch) => { setTouched(true); setErr(''); setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r))); };
  const remove = key => { setTouched(true); setRows(rs => rs.filter(r => r.key !== key)); };
  const add = () => {
    setTouched(true);
    const r = newRow();
    setRows(rs => [...rs, r]);
    requestAnimationFrame(() => document.getElementById(`${id}-d${r.key}`)?.focus());
  };
  const chosen = rows.filter(r => r.on && r.description.trim());
  const badQty = chosen.some(r => !(Number(r.quantity) > 0));
  const card = data?.job_card;
  const canSend = !!card && data?.can_request !== false && chosen.length > 0 && !badQty && !saving;

  const submit = async e => {
    e.preventDefault();
    if (!canSend) {
      if (!chosen.length) setErr(t('requestParts.err_none', 'Tick or add at least one part.'));
      else if (badQty) setErr(t('requestParts.err_qty', 'Each quantity must be more than 0.'));
      return;
    }
    setSaving(true); setErr('');
    try {
      const items = chosen.map(r => ({ description: r.description.trim(), part_number: r.part_number.trim() || null, quantity: Number(r.quantity) }));
      const res = await api.post(`/job-cards/${card.id}/requisitions`, { items, notes: notes.trim() || undefined });
      if (!res.success) { setErr(res.message || t('requestParts.failed', 'The requisition was not sent.')); setSaving(false); return; }
      onDone?.({ req_number: res.req_number, items: items.length, job_card_number: card.job_card_number });
    } catch (e2) {
      setErr(e2?.message || t('requestParts.failed', 'The requisition was not sent.'));
      setSaving(false);
    }
  };

  const reqs = data?.requisitions || [];
  return createPortal(
    <div className="rpd-layer" onMouseDown={e => { if (e.target === e.currentTarget && !saving && !touched) onClose(); }}>
      <form ref={ref} className="rpd" role="dialog" aria-modal="true" aria-labelledby={`${id}-h`} tabIndex={-1}
        onSubmit={submit} onKeyDown={onKeyDown} noValidate>
        <header className="rpd-head">
          <span className="rpd-ico" aria-hidden="true"><Package width={18} height={18} /></span>
          <div className="rpd-titles">
            <h2 id={`${id}-h`}>{t('requestParts.title', 'Request parts')}{data?.work_order ? ` · ${data.work_order.work_order_number}` : ''}</h2>
            <p>{card
              ? t('requestParts.sub', 'A material requisition (MRN) to the Store on the Inspection job card {{jc}}. The technician can be assigned once it is sent.', { jc: card.job_card_number })
              : t('requestParts.sub_plain', 'A material requisition (MRN) to the Store.')}</p>
          </div>
          <button type="button" className="rpd-x" aria-label={t('requestParts.close', 'Close')} onClick={onClose} disabled={saving}><Xmark width={18} height={18} /></button>
        </header>

        <div className="rpd-body">
          {loadErr ? <p className="rpd-err" role="alert"><WarningTriangle width={15} height={15} /> {loadErr}</p>
            : !data ? <div className="rpd-skel" aria-busy="true"><span /><span /><span /></div>
              : (
                <>
                  {!card && <p className="rpd-err" role="alert"><WarningTriangle width={15} height={15} /> {t('requestParts.no_card', 'This job has no Inspection job card yet, so there is nothing to request parts on.')}</p>}
                  {data.can_request === false && <p className="rpd-note"><InfoCircle width={15} height={15} /> {t('requestParts.no_right', 'Parts are requested by the Team Leader, Supervisor, Foreman or Service Advisor.')}</p>}
                  {reqs.length > 0 && (
                    <p className="rpd-note">
                      <InfoCircle width={15} height={15} />
                      <span>{t('requestParts.already', 'Already requested:')} {reqs.map(r => `${r.req_number} (${t(`requestParts.req_status.${r.status}`, String(r.status).replace(/_/g, ' '))})`).join(', ')}</span>
                    </p>
                  )}
                  <div className="rpd-table" role="group" aria-label={t('requestParts.parts', 'Parts')}>
                    <div className="rpd-row rpd-th" aria-hidden="true">
                      <span />
                      <span>{t('requestParts.col_part', 'Part')}</span>
                      <span>{t('requestParts.col_no', 'Part no.')}</span>
                      <span>{t('requestParts.col_qty', 'Qty')}</span>
                      <span />
                    </div>
                    {rows.map(r => (
                      <div key={r.key} className={`rpd-row${r.on ? '' : ' is-off'}`}>
                        <span className="rpd-tick">
                          <input type="checkbox" checked={r.on} onChange={e => upd(r.key, { on: e.target.checked })}
                            aria-label={t('requestParts.include', 'Include {{part}}', { part: r.description || t('requestParts.this_part', 'this part') })} />
                        </span>
                        <span className="rpd-desc">
                          <input id={`${id}-d${r.key}`} className="rpd-input" value={r.description} maxLength={500}
                            placeholder={t('requestParts.ph_part', 'Part description')} onChange={e => upd(r.key, { description: e.target.value })}
                            aria-label={t('requestParts.col_part', 'Part')} />
                          {(r.job_name || r.requested) && (
                            <small>
                              {r.job_name && t('requestParts.for_job', 'For {{job}}', { job: r.job_name })}
                              {r.requested && <em>{r.job_name ? ' · ' : ''}{t('requestParts.on_mrn', 'already on a requisition')}</em>}
                            </small>
                          )}
                        </span>
                        <input className="rpd-input rpd-no" value={r.part_number} maxLength={100} placeholder={t('requestParts.ph_no', 'Optional')}
                          onChange={e => upd(r.key, { part_number: e.target.value })} aria-label={t('requestParts.col_no', 'Part no.')} />
                        <input className="rpd-input rpd-qty" type="number" inputMode="decimal" min="0.001" step="any" value={r.quantity === '' ? '' : qtyText(r.quantity)}
                          onChange={e => upd(r.key, { quantity: e.target.value })} aria-label={t('requestParts.col_qty', 'Qty')}
                          aria-invalid={r.on && !(Number(r.quantity) > 0) ? true : undefined} />
                        <button type="button" className="rpd-del" onClick={() => remove(r.key)}
                          aria-label={t('requestParts.remove', 'Remove {{part}}', { part: r.description || t('requestParts.this_part', 'this part') })}>
                          <Trash width={15} height={15} />
                        </button>
                      </div>
                    ))}
                    {!rows.length && <p className="rpd-empty">{t('requestParts.empty', 'No parts on the list. Add one below.')}</p>}
                  </div>
                  <button type="button" className="rpd-add" onClick={add}><Plus width={14} height={14} /> {t('requestParts.add', 'Add a part')}</button>
                  <label className="rpd-notes">
                    <span>{t('requestParts.notes', 'Note for the Store (optional)')}</span>
                    <textarea rows={2} maxLength={1000} value={notes} onChange={e => { setTouched(true); setNotes(e.target.value); }}
                      placeholder={t('requestParts.notes_ph', 'e.g. needed by 2 pm, customer waiting')} />
                  </label>
                </>
              )}
        </div>

        <footer className="rpd-foot">
          {err && <p className="rpd-err" role="alert"><WarningTriangle width={15} height={15} /> {err}</p>}
          <button type="button" className="rpd-btn ghost" onClick={onClose} disabled={saving}>{t('requestParts.cancel', 'Cancel')}</button>
          <button ref={sendRef} type="submit" className="rpd-btn primary" disabled={!canSend}>
            <Package width={15} height={15} />
            {saving ? t('requestParts.sending', 'Sending…')
              : chosen.length === 1 ? t('requestParts.send_one', 'Send 1 part to the Store')
                : t('requestParts.send_n', 'Send {{n}} parts to the Store', { n: chosen.length })}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
