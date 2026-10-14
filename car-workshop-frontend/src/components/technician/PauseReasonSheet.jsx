/**
 * PauseReasonSheet — "Why are you pausing?" before the clock stops.
 *
 * Break · Waiting for parts · Waiting for information or approval · Moved to
 * another job · Other (with a note, required, 255 characters). The reason is
 * sent with POST /api/job-cards/:id/time/pause { reason, note } and comes
 * back as "Paused · Waiting for parts" on the card, the clock pill and the
 * Team Board.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PauseSolid, Xmark } from 'iconoir-react';
import { PAUSE_REASONS, PAUSE_NOTE_MAX, pauseReasonLabel } from '../../lib/statusLabels';
import Sheet from './Sheet';

export default function PauseReasonSheet({ open, card, busy = false, onCancel, onPause }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setReason(''); setNote(''); setError(''); }
  }, [open]);

  const submit = (e) => {
    e.preventDefault();
    if (!reason) { setError(t('technician.pause_pick', 'Choose why you are pausing.')); return; }
    if (reason === 'other' && !note.trim()) { setError(t('technician.pause_other_hint', 'Say why — a note is needed for Other.')); return; }
    onPause(reason, note.trim());
  };

  const id = `tk-pause-${card?.id || 'x'}`;
  return (
    <Sheet open={open} onClose={onCancel} labelledBy={`${id}-title`}>
      <button type="button" className="tk-sheet-x" onClick={onCancel} aria-label={t('technician.close', 'Close')}>
        <Xmark width={18} height={18} />
      </button>
      <form onSubmit={submit} noValidate>
        <h2 id={`${id}-title`} className="tk-sheet-title">{t('technician.pause_title', 'Why are you pausing?')}</h2>
        {card && <p className="tk-sheet-ref">{[card.plate_number, card.job_card_number].filter(Boolean).join(' · ')}</p>}
        <fieldset className="tk-reasons">
          <legend className="tk-sr-only">{t('technician.pause_title', 'Why are you pausing?')}</legend>
          {PAUSE_REASONS.map((r, i) => (
            <label key={r} className={`tk-reason${reason === r ? ' is-on' : ''}`}>
              <input type="radio" name={`${id}-reason`} value={r} checked={reason === r}
                data-autofocus={i === 0 ? true : undefined}
                onChange={() => { setReason(r); setError(''); }} />
              <span>{pauseReasonLabel(t, r)}</span>
            </label>
          ))}
        </fieldset>
        {reason === 'other' && (
          <div className="tk-field">
            <label htmlFor={`${id}-note`} className="tk-field-label">{t('technician.pause_note', 'What is the reason?')}</label>
            <textarea id={`${id}-note`} className="tk-input tk-textarea" rows={2} maxLength={PAUSE_NOTE_MAX} required
              value={note} onChange={(e) => { setNote(e.target.value); setError(''); }} />
            <div className="tk-field-count" aria-hidden="true">{note.length}/{PAUSE_NOTE_MAX}</div>
          </div>
        )}
        {error && <p className="tk-form-error" role="alert">{error}</p>}
        <div className="tk-sheet-actions">
          <button type="button" className="tk-btn tk-btn--ghost" onClick={onCancel}>{t('technician.cancel', 'Cancel')}</button>
          <button type="submit" className="tk-btn tk-btn--pause-solid" disabled={busy}>
            {busy ? <span className="tk-spin" aria-hidden="true" /> : <PauseSolid width={18} height={18} aria-hidden="true" />}
            {t('technician.pause', 'Pause')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
