import { WarningTriangle, Xmark } from 'iconoir-react';

/**
 * Modern confirmation dialog with backdrop blur.
 *
 * Usage:
 *   <SAConfirmDialog
 *     open={showConfirm}
 *     title="Delete Workshop?"
 *     message="This action cannot be undone."
 *     confirmLabel="Delete"
 *     confirmColor="danger"
 *     onConfirm={() => handleDelete()}
 *     onCancel={() => setShowConfirm(false)}
 *     loading={deleting}
 *   />
 */
export default function SAConfirmDialog({
  open,
  icon: Icon = WarningTriangle,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmColor = 'danger',
  onConfirm,
  onCancel,
  loading = false,
}) {
  if (!open) return null;

  return (
    <div className="sa-confirm-overlay" onClick={onCancel}>
      <div className="sa-confirm-card" onClick={(e) => e.stopPropagation()}>
        <button className="sa-confirm-close" onClick={onCancel} aria-label="Close">
          <Xmark size={18} />
        </button>
        <div className={`sa-confirm-icon ${confirmColor}`}>
          <Icon size={28} />
        </div>
        <h3 className="sa-confirm-title">{title}</h3>
        {message && <p className="sa-confirm-message">{message}</p>}
        <div className="sa-confirm-actions">
          <button className="sa-btn secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button className={`sa-btn ${confirmColor}`} onClick={onConfirm} disabled={loading}>
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
