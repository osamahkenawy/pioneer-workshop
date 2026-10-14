/**
 * RequestPartsForm — "Request parts": what is needed and how many, sent to
 * the Store as a material requisition (POST /api/job-cards/:id/requisitions).
 * The Store's answer comes back on the card's parts list.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash, Package } from 'iconoir-react';
import api from '../../lib/api';

const EMPTY_ROW = { description: '', quantity: 1 };

export default function RequestPartsForm({ card, onSent, onCancel, toast }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([{ ...EMPTY_ROW }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = (idx, field, value) => setRows(rs => rs.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const send = async (e) => {
    e.preventDefault();
    const items = rows
      .map(r => ({ description: String(r.description || '').trim(), quantity: Math.max(1, parseInt(r.quantity, 10) || 1) }))
      .filter(r => r.description);
    if (!items.length) { setError(t('technician.parts_empty', 'Describe at least one part.')); return; }
    setBusy(true);
    try {
      const res = await api.post(`/job-cards/${card.id}/requisitions`, { items });
      if (res.success) {
        toast?.(`${t('technician.toast_parts', 'Parts requested — the Store has been notified')}${res.req_number ? ` (${res.req_number})` : ''}`);
        setRows([{ ...EMPTY_ROW }]);
        onSent?.();
      } else {
        setError(res.message || t('technician.action_failed', "Couldn't save. Try again."));
      }
    } catch {
      setError(t('technician.network_error', 'No connection. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tk-reqform" onSubmit={send} noValidate>
      {rows.map((r, idx) => (
        <div key={idx} className="tk-reqrow">
          <input className="tk-input tk-reqrow-desc" value={r.description}
            placeholder={t('technician.part_placeholder', 'Part, e.g. front brake pads')}
            aria-label={t('technician.part_desc', 'Part')}
            autoFocus={idx === rows.length - 1 && idx > 0}
            onChange={e => { update(idx, 'description', e.target.value); setError(''); }} />
          <input className="tk-input tk-reqrow-qty" type="number" inputMode="numeric" min="1" step="1" value={r.quantity}
            aria-label={t('technician.part_qty', 'Quantity')}
            onChange={e => update(idx, 'quantity', e.target.value)} />
          <button type="button" className="tk-icon-btn tk-icon-btn--danger" disabled={rows.length === 1}
            aria-label={t('technician.part_remove', 'Remove this part')}
            onClick={() => setRows(rs => rs.filter((_, i) => i !== idx))}>
            <Trash width={16} height={16} />
          </button>
        </div>
      ))}
      <button type="button" className="tk-linkbtn" onClick={() => setRows(rs => [...rs, { ...EMPTY_ROW }])}>
        <Plus width={15} height={15} aria-hidden="true" /> {t('technician.part_add', 'Add another part')}
      </button>
      {error && <p className="tk-form-error" role="alert">{error}</p>}
      <div className="tk-reqactions">
        <button type="button" className="tk-btn tk-btn--ghost" onClick={onCancel}>{t('technician.cancel', 'Cancel')}</button>
        <button type="submit" className="tk-btn tk-btn--store" disabled={busy}>
          {busy ? <span className="tk-spin" aria-hidden="true" /> : <Package width={16} height={16} aria-hidden="true" />}
          {t('technician.send_to_store', 'Send to the Store')}
        </button>
      </div>
    </form>
  );
}
