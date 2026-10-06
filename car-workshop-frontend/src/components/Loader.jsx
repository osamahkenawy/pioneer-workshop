import './Loader.css';

const logoSrc = '/assets/images/logos/pioneer/pioneer_logo_main_colors.svg';

/* ═══════════════════════════════════════════════════════════
   1. APP LOADER — Full-screen branded loader for boot / auth
   ═══════════════════════════════════════════════════════════ */
export default function Loader({ fullPage = true, size = 'md', message }) {
  const content = (
    <div className={`tl-loader tl-loader--${size}`}>
      <div className="tl-loader__logo-wrap">
        <img src={logoSrc} alt="Pioneer" className="tl-loader__logo" style={{ filter: 'invert(1)' }} />
        <div className="tl-loader__ring" />
      </div>
      {message && <p className="tl-loader__msg">{message}</p>}
    </div>
  );

  if (!fullPage) return content;

  return <div className="tl-loader__page">{content}</div>;
}

/* ═══════════════════════════════════════════════════════════
   2. SKELETON LOADERS — Layout-preserving shimmer placeholders
   ═══════════════════════════════════════════════════════════ */

/** Generic shimmer block — adapts to any shape */
export function Skeleton({ width, height = 16, radius = 8, style, className = '' }) {
  return (
    <div
      className={`tl-skeleton ${className}`}
      style={{ width: width ?? '100%', height, borderRadius: radius, ...style }}
    />
  );
}

/** KPI stat card skeleton (matches .metric-card) */
export function StatCardSkeleton({ count = 6 }) {
  return (
    <div className="tl-skel-metrics">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tl-skel-stat-card">
          <Skeleton width={40} height={40} radius={12} />
          <div className="tl-skel-stat-body">
            <Skeleton width={72} height={28} radius={6} />
            <Skeleton width={100} height={12} radius={4} />
          </div>
          <Skeleton width={48} height={18} radius={10} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

/** Chart area skeleton */
export function ChartSkeleton({ height = 260 }) {
  return (
    <div className="tl-skel-chart">
      <div className="tl-skel-chart-header">
        <Skeleton width={160} height={16} radius={4} />
        <Skeleton width={90} height={12} radius={4} />
      </div>
      <Skeleton height={height} radius={12} />
    </div>
  );
}

/** Table rows skeleton */
export function TableSkeleton({ rows = 8, cols = 6 }) {
  return (
    <div className="tl-skel-table">
      <div className="tl-skel-table-head">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} height={14} radius={4} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="tl-skel-table-row">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} height={14} radius={4} style={{ width: c === 0 ? '40%' : undefined }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Card list skeleton (mechanics, notifications, items) */
export function CardListSkeleton({ count = 5 }) {
  return (
    <div className="tl-skel-card-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tl-skel-card-item">
          <Skeleton width={36} height={36} radius="50%" />
          <div className="tl-skel-card-text">
            <Skeleton width="60%" height={14} radius={4} />
            <Skeleton width="40%" height={11} radius={4} />
          </div>
          <Skeleton width={56} height={22} radius={10} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

/** Full dashboard skeleton — mirrors the real layout */
export function DashboardSkeleton() {
  return (
    <div className="dashboard">
      {/* Header skeleton */}
      <div className="tl-skel-dash-header">
        <div>
          <Skeleton width={140} height={12} radius={4} />
          <Skeleton width={280} height={24} radius={6} style={{ marginTop: 8 }} />
          <Skeleton width={200} height={13} radius={4} style={{ marginTop: 6 }} />
        </div>
        <div className="tl-skel-dash-actions">
          <Skeleton width={80} height={34} radius={8} />
          <Skeleton width={120} height={34} radius={8} />
        </div>
      </div>

      {/* Metrics row */}
      <StatCardSkeleton count={6} />

      {/* COD widget skeleton */}
      <div className="tl-skel-cod">
        <Skeleton width={140} height={15} radius={4} />
        <div className="tl-skel-cod-body">
          <Skeleton width={100} height={28} radius={6} />
          <Skeleton width={100} height={28} radius={6} />
          <Skeleton width={100} height={28} radius={6} />
        </div>
      </div>

      {/* Charts row */}
      <div className="tl-skel-charts-row">
        <ChartSkeleton height={220} />
        <ChartSkeleton height={220} />
      </div>

      {/* 3-column cards row */}
      <div className="tl-skel-triple">
        <div className="tl-skel-recent-card">
          <Skeleton width={120} height={16} radius={4} style={{ marginBottom: 16 }} />
          <CardListSkeleton count={5} />
        </div>
        <div className="tl-skel-recent-card">
          <Skeleton width={120} height={16} radius={4} style={{ marginBottom: 16 }} />
          <CardListSkeleton count={5} />
        </div>
        <div className="tl-skel-recent-card">
          <Skeleton width={140} height={16} radius={4} style={{ marginBottom: 16 }} />
          <CardListSkeleton count={5} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   3. INLINE SPINNER — For buttons, actions, save, job-assignment
   ═══════════════════════════════════════════════════════════ */
export function Spinner({ size = 16, color = 'currentColor', className = '' }) {
  return (
    <span
      className={`tl-spinner ${className}`}
      style={{
        width: size,
        height: size,
        borderColor: `${color}33`,
        borderTopColor: color,
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════
   4. MAP / OVERLAY LOADER — For live tracking & panels
   ═══════════════════════════════════════════════════════════ */
export function OverlayLoader({ message, transparent = false }) {
  return (
    <div className={`tl-overlay ${transparent ? 'tl-overlay--transparent' : ''}`}>
      <div className="tl-overlay__inner">
        <span className="tl-spinner tl-spinner--lg" />
        {message && <span className="tl-overlay__msg">{message}</span>}
      </div>
    </div>
  );
}
