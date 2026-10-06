import { ArrowUp, ArrowDown } from 'iconoir-react';

/**
 * Modern stat card with icon, value, label, and optional trend indicator.
 *
 * Usage:
 *   <SAStatCard
 *     icon={Building}
 *     value={42}
 *     label="Total Workshops"
 *     trend={12.5}        // positive = up, negative = down (optional)
 *     color="primary"      // primary | success | warning | info | danger
 *   />
 */
export default function SAStatCard({
  icon: Icon,
  value,
  label,
  trend,
  color = 'primary',
  onClick
}) {
  const hasTrend = trend !== undefined && trend !== null;
  const isUp = hasTrend && trend >= 0;

  return (
    <div className={`sa-stat-card-v2 sa-stat-${color}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="sa-stat-card-v2-top">
        <div className={`sa-stat-icon-v2 ${color}`}>
          {Icon && <Icon size={22} />}
        </div>
        {hasTrend && (
          <span className={`sa-stat-trend ${isUp ? 'up' : 'down'}`}>
            {isUp ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="sa-stat-card-v2-body">
        <div className="sa-stat-value-v2">{value}</div>
        <div className="sa-stat-label-v2">{label}</div>
      </div>
    </div>
  );
}
