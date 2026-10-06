/**
 * FailureReasonModal.jsx — prompt for a failure/cancellation reason.
 * Props: open, title, subtitle, onClose, onConfirm(reason)
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { WarningTriangle, Xmark } from 'iconoir-react';
import './FailureReasonModal.css';

const PRESET_KEYS = [
  ['customer_unreachable', 'Customer unreachable'],
  ['parts_unavailable', 'Parts unavailable'],
  ['customer_declined_repair', 'Customer declined the repair'],
  ['vehicle_condition', 'Vehicle condition prevents the service'],
  ['payment_issue', 'Payment issue'],
  ['other', 'Other'],
];

export default function FailureReasonModal({ open, title, subtitle, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState('');
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (open) { setSelected(''); setCustom(''); }
  }, [open]);

  if (!open) return null;

  const reason = selected === 'Other' || selected === '' ? custom || selected : selected;
  const canConfirm = Boolean(selected && (selected !== 'Other' || custom.trim()));

  return createPortal(
    <div className="frm-overlay" onClick={onClose}>
      <div className="frm-modal" onClick={(e) => e.stopPropagation()}>
        <button className="frm-close" onClick={onClose} aria-label="Close">
          <Xmark width={18} height={18} />
        </button>
        <div className="frm-icon"><WarningTriangle width={24} height={24} /></div>
        <h3 className="frm-title">{title || t('failure_modal.title', 'Mark as failed')}</h3>
        {subtitle && <p className="frm-subtitle">{subtitle}</p>}

        <div className="frm-reasons">
          {PRESET_KEYS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`frm-reason ${selected === label ? 'active' : ''}`}
              onClick={() => setSelected(label)}
            >
              {t(`failure_modal.${key}`, label)}
            </button>
          ))}
        </div>

        {selected === 'Other' && (
          <textarea
            className="frm-custom"
            rows={3}
            placeholder={t('failure_modal.custom_placeholder', 'Describe the reason…')}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        )}

        <div className="frm-actions">
          <button type="button" className="frm-btn-cancel" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            className="frm-btn-confirm"
            disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm?.(reason)}
          >
            {t('common.confirm', 'Confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
