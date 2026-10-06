/**
 * Consistent badge/pill component for status, labels, and counts.
 *
 * Usage:
 *   <SABadge color="success">Active</SABadge>
 *   <SABadge color="warning" dot>Trial</SABadge>
 *   <SABadge color="info" size="sm">3</SABadge>
 */
export default function SABadge({
  children,
  color = 'secondary',
  size = 'md',
  dot = false,
  className = '',
}) {
  return (
    <span className={`sa-badge-v2 sa-badge-${color} sa-badge-${size} ${className}`}>
      {dot && <span className="sa-badge-dot" />}
      {children}
    </span>
  );
}
