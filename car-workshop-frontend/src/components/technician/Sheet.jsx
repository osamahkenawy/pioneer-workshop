/**
 * Sheet — a bottom sheet on phones, a centred dialog (400px) from 560px up.
 * Used by the pause reasons and the technician's confirmations.
 *
 * Focus moves into the sheet when it opens (the element with
 * data-autofocus, else the first control), Tab stays inside it, Escape or
 * a tap on the backdrop closes it, and focus returns to where it was.
 *
 *   <Sheet open={open} onClose={close} labelledBy="tk-x-title">…</Sheet>
 *   <ConfirmSheet open title body confirmLabel onConfirm onClose busy tone />
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Xmark } from 'iconoir-react';
import './technician.css';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export default function Sheet({ open, onClose, labelledBy, children, className = '' }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    const el = ref.current;
    (el?.querySelector('[data-autofocus]') || el?.querySelector(FOCUSABLE))?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (before && typeof before.focus === 'function') before.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="tk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeRef.current?.(); }}>
      <div ref={ref} className={`tk-sheet ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>,
    document.body
  );
}

/** A yes/no question in a Sheet. `tone`: 'dark' (Job done) or 'start' (green). */
export function ConfirmSheet({ open, id, title, body, warning, confirmLabel, onConfirm, onClose, busy = false, tone = 'dark', icon: Icon }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose} labelledBy={`${id}-title`}>
      <button type="button" className="tk-sheet-x" onClick={onClose} aria-label={t('technician.close', 'Close')}>
        <Xmark width={18} height={18} />
      </button>
      {Icon && <div className={`tk-sheet-icon tk-sheet-icon--${tone}`} aria-hidden="true"><Icon width={26} height={26} /></div>}
      <h2 id={`${id}-title`} className="tk-sheet-title">{title}</h2>
      {body && <p className="tk-sheet-body">{body}</p>}
      {warning && <p className="tk-sheet-warn" role="note">{warning}</p>}
      <div className="tk-sheet-actions">
        <button type="button" className="tk-btn tk-btn--ghost" onClick={onClose}>{t('technician.cancel', 'Cancel')}</button>
        <button type="button" className={`tk-btn tk-btn--${tone}`} onClick={onConfirm} disabled={busy} data-autofocus>
          {busy && <span className="tk-spin" aria-hidden="true" />}{confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
