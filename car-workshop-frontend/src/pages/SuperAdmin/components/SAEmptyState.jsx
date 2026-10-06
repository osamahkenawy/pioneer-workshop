import { Package } from 'iconoir-react';

/**
 * Reusable empty state component for SuperAdmin pages.
 *
 * Usage:
 *   <SAEmptyState
 *     icon={Building}
 *     title="No workshops found"
 *     description="Try adjusting your filters or create a new workshop."
 *     actionLabel="Create Workshop"
 *     onAction={() => setShowModal(true)}
 *   />
 */
export default function SAEmptyState({ 
  icon: Icon = Package, 
  title = 'No data found', 
  description, 
  actionLabel, 
  onAction,
  actionTo 
}) {
  return (
    <div className="sa-empty-state">
      <div className="sa-empty-state-icon">
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {actionLabel && onAction && (
        <button className="sa-primary-btn" onClick={onAction} style={{ fontSize: 13 }}>
          {actionLabel}
        </button>
      )}
      {actionLabel && actionTo && (
        <a href={actionTo} className="sa-primary-btn" style={{ fontSize: 13, textDecoration: 'none' }}>
          {actionLabel}
        </a>
      )}
    </div>
  );
}
