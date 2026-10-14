import { useState, useEffect, useCallback } from 'react';
import {
  StatsUpSquare, Wrench, Clock, Medal, StarSolid,
  Timer, Check, Xmark, StatUp, StatDown,
  Refresh, Download
} from 'iconoir-react';
import api from '../lib/api';
import { StatCardSkeleton, ChartSkeleton } from '../components/Loader';
import { woFilterLabel, woTone } from '../lib/statusLabels';
import { downloadCsv } from '../utils/csv';
import './Performance.css';
import { useTranslation } from 'react-i18next';

// The stored status whose colour each status bar borrows ("Waiting" uses
// the slate of "Checked in").
const BAR_TONE_STATUS = {
  closed: 'completed', in_work: 'in_progress', quality_check: 'inspection',
  ready: 'ready_for_pickup', waiting: 'pending', cancelled: 'cancelled',
};

const PERIOD_OPTIONS = [
  { value: 'today', labelKey: 'performance.period_today' },
  { value: 'week', labelKey: 'performance.period_week' },
  { value: 'month', labelKey: 'performance.period_month' },
  { value: 'quarter', labelKey: 'performance.period_quarter' },
  { value: 'custom', labelKey: 'performance.period_custom' },
];

function SLARing({ percent, color, size = 100, stroke = 8 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  return (
    <div className="perf-sla-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="#f1f5f9" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <span className="perf-sla-ring-text">{percent}%</span>
    </div>
  );
}

function RatingStars({ rating }) {
  return (
    <span className="perf-rating">
      {[1,2,3,4,5].map(s => (
        <StarSolid key={s} width={14} height={14}
          className={`perf-rating-star ${s <= Math.round(rating) ? '' : 'empty'}`} />
      ))}
      <span className="perf-rating-value">{rating.toFixed(1)}</span>
    </span>
  );
}

export default function Performance() {
  const { t } = useTranslation();
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === 'custom' && dateFrom) params.set('date_from', dateFrom);
      if (period === 'custom' && dateTo) params.set('date_to', dateTo);
      const res = await api.get(`/reports/performance?${params}`);
      if (res.success) setData(res.data);
    } catch (e) {
      console.error('Performance load error', e);
    } finally {
      setLoading(false);
    }
  }, [period, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const kpis = data?.kpis || {};
  // /reports/performance sends the scorecards as `drivers` (with driver_id);
  // reading only `mechanics` left the Scorecards tab empty.
  const mechanicPerf = (data?.mechanics || data?.drivers || [])
    .map(d => ({ ...d, mechanic_id: d.mechanic_id ?? d.driver_id }));
  const slaTarget = kpis.slaTargetHours || 24;

  // Status bars in the workshop's words (lib/statusLabels.js, WO_FILTERS
  // keys). The report counts courier-era buckets: delivered = completed,
  // in_transit = in_progress, failed = cancelled. "Waiting" is every job
  // not yet started (checked in, inspected, approved or assigned), so it is
  // what is left of the total.
  const statusBars = (() => {
    const counted = {
      closed: kpis.delivered || 0,
      in_work: kpis.in_transit || 0,
      quality_check: kpis.inspection || 0,
      ready: kpis.ready_for_pickup || 0,
      cancelled: kpis.failed || 0,
    };
    const accounted = Object.values(counted).reduce((a, b) => a + b, 0);
    const waiting = Math.max(kpis.pending || 0, (kpis.total || 0) - accounted);
    return ['closed', 'in_work', 'quality_check', 'ready', 'waiting', 'cancelled'].map(key => ({
      key,
      label: woFilterLabel(t, key),
      count: key === 'waiting' ? waiting : counted[key],
      color: woTone(BAR_TONE_STATUS[key]).color,
    }));
  })();
  const barMax = Math.max(1, ...statusBars.map(b => b.count));

  const gradeClass = (pct) => pct >= 85 ? 'excellent' : pct >= 60 ? 'good' : 'poor';
  const gradeLabel = (pct) => pct >= 85 ? t('performance.grade_excellent') : pct >= 60 ? t('performance.grade_good') : t('performance.grade_needs_improvement');
  const rankClass = (i) => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';

  const formatHours = (h) => {
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 24) return `${h.toFixed(1)}h`;
    return `${(h/24).toFixed(1)}d`;
  };

  // Technician scorecards. No courier columns (Vehicle, Delivered):
  // Jobs = job cards assigned in the period, Completed = closed ones,
  // Reworks = failed quality checks, when the report sends them.
  const exportCSV = () => {
    if (!mechanicPerf.length) return;
    const headers = ['Rank', 'Technician', 'Phone', 'Jobs', 'Completed', 'Cancelled', 'Reworks', 'Completion %', 'On-time %', 'Avg time', 'Rating', 'Grade'];
    const rows = mechanicPerf.map((d, i) => [
      i + 1, d.name, d.phone || '', d.total, d.delivered, d.failed,
      d.reworks ?? d.rework_count ?? '',
      d.successRate, d.onTimePct, formatHours(d.avgHours), d.rating, d.grade,
    ]);
    // csvCell quotes and neutralises spreadsheet formulas (SR-15).
    downloadCsv(`technician-performance-${period}.csv`, headers, rows);
  };

  if (loading) return <div className="perf-page"><StatCardSkeleton count={4} /><ChartSkeleton height={200} /></div>;

  return (
    <div className="perf-page">
      {/* Hero */}
      <div className="module-hero">
        <div className="module-hero-left">
          <h1 className="module-hero-title">{t("performance.title")}</h1>
          <p className="module-hero-sub">
            {t('performance.subtitle')}
          </p>
        </div>
        <div className="module-hero-actions">
          <button onClick={exportCSV} className="module-btn module-btn-outline" title={t('performance.export_title')}>
            <Download width={16} height={16} /> {t('performance.export_btn')}
          </button>
          <button onClick={load} className="module-btn module-btn-outline">
            <Refresh width={16} height={16} /> {t('performance.refresh_btn')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="perf-filters">
        <select className="perf-filter-select" value={period} onChange={e => setPeriod(e.target.value)}>
          {PERIOD_OPTIONS.map(p => <option key={p.value} value={p.value}>{t(p.labelKey)}</option>)}
        </select>
        {period === 'custom' && (
          <>
            <input type="date" className="perf-date-input" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)} />
            <span style={{ color: '#94a3b8' }}>{t('performance.date_to')}</span>
            <input type="date" className="perf-date-input" value={dateTo}
              onChange={e => setDateTo(e.target.value)} />
          </>
        )}
      </div>

      {/* Stat Cards */}
      <div className="perf-stats-grid">
        <div className="perf-stat-card primary">
          <div className="perf-stat-card-row">
            <div className="perf-stat-icon" style={{ background: '#fff7ed', color: '#f97316' }}>
              <StatsUpSquare width={22} height={22} />
            </div>
            <div className="perf-stat-body">
              <span className="perf-stat-val">{kpis.total || 0}</span>
              <span className="perf-stat-lbl">{t("performance.total_shipments")}</span>
            </div>
          </div>
        </div>
        <div className="perf-stat-card success">
          <div className="perf-stat-card-row">
            <div className="perf-stat-icon" style={{ background: '#dcfce7', color: '#16a34a' }}>
              <Check width={22} height={22} />
            </div>
            <div className="perf-stat-body">
              <span className="perf-stat-val">{kpis.deliveryRate || 0}%</span>
              <span className="perf-stat-lbl">{t('performance.delivery_rate')}</span>
              <div className={`perf-stat-change ${(kpis.deliveryRate || 0) >= 80 ? 'up' : 'down'}`}>
                {(kpis.deliveryRate || 0) >= 80 ? <StatUp width={12} height={12} /> : <StatDown width={12} height={12} />}
                {t('performance.delivered_count', { count: kpis.delivered || 0 })}
              </div>
            </div>
          </div>
        </div>
        <div className="perf-stat-card info">
          <div className="perf-stat-card-row">
            <div className="perf-stat-icon" style={{ background: '#ede9fe', color: '#667eea' }}>
              <Timer width={22} height={22} />
            </div>
            <div className="perf-stat-body">
              <span className="perf-stat-val">{formatHours(kpis.avgDeliveryHours || 0)}</span>
              <span className="perf-stat-lbl">{t('performance.avg_delivery_time')}</span>
            </div>
          </div>
        </div>
        <div className="perf-stat-card warning">
          <div className="perf-stat-card-row">
            <div className="perf-stat-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
              <Clock width={22} height={22} />
            </div>
            <div className="perf-stat-body">
              <span className="perf-stat-val">{kpis.onTimePct || 0}%</span>
              <span className="perf-stat-lbl">{t('performance.on_time_sla', { hours: slaTarget })}</span>
            </div>
          </div>
        </div>
        <div className="perf-stat-card danger">
          <div className="perf-stat-card-row">
            <div className="perf-stat-icon" style={{ background: '#fee2e2', color: '#ef4444' }}>
              <Xmark width={22} height={22} />
            </div>
            <div className="perf-stat-body">
              {/* Was "Failed & Returned" summing two fields that now both come
                  from status='cancelled' (returned is no longer a status at
                  all), which double-counted. One status, one number. */}
              <span className="perf-stat-val">{kpis.failed || 0}</span>
              <span className="perf-stat-lbl">{t('statuses.cancelled')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="perf-tabs">
        {[
          { key: 'overview', label: t('performance.tabs.sla'), Icon: StatsUpSquare },
          { key: 'mechanics', label: t('performance.tabs.scorecards'), Icon: Wrench },
        ].map(tab => (
          <button key={tab.key} className={`perf-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}>
            <tab.Icon width={15} height={15} /> {tab.label}
          </button>
        ))}
      </div>

      {/* SLA Overview Tab */}
      {activeTab === 'overview' && (
        <>
          <div className="perf-sla-grid">
            <div className="perf-sla-card">
              <SLARing percent={kpis.onTimePct || 0}
                color={(kpis.onTimePct||0) >= 85 ? '#16a34a' : (kpis.onTimePct||0) >= 60 ? '#f97316' : '#ef4444'} />
              <div className="perf-sla-label">{t("performance.on_time_delivery")}</div>
              <div className="perf-sla-sub">{t('performance.sla_target_sub', { hours: slaTarget })} — {gradeLabel(kpis.onTimePct || 0)}</div>
            </div>
            <div className="perf-sla-card">
              <SLARing percent={kpis.firstAttemptPct || 0}
                color={(kpis.firstAttemptPct||0) >= 85 ? '#16a34a' : (kpis.firstAttemptPct||0) >= 60 ? '#f97316' : '#ef4444'} />
              <div className="perf-sla-label">{t('performance.sla.first_attempt')}</div>
              <div className="perf-sla-sub">{t('performance.sla_of_total', { delivered: kpis.delivered || 0, total: (kpis.delivered||0) + (kpis.failed||0) })} — {gradeLabel(kpis.firstAttemptPct || 0)}</div>
            </div>
            <div className="perf-sla-card">
              <SLARing percent={kpis.deliveryRate || 0}
                color={(kpis.deliveryRate||0) >= 85 ? '#16a34a' : (kpis.deliveryRate||0) >= 60 ? '#f97316' : '#ef4444'} />
              <div className="perf-sla-label">{t("performance.overall_rate")}</div>
              <div className="perf-sla-sub">{t('performance.sla_of_total', { delivered: kpis.delivered || 0, total: kpis.total || 0 })} — {gradeLabel(kpis.deliveryRate || 0)}</div>
            </div>
            <div className="perf-sla-card">
              <SLARing percent={Math.min(100, Math.round((1 - (kpis.avgDeliveryHours||0) / (slaTarget * 2)) * 100))}
                color={(kpis.avgDeliveryHours||0) <= slaTarget ? '#16a34a' : '#ef4444'} />
              <div className="perf-sla-label">{t('performance.sla.avg_speed')}</div>
              <div className="perf-sla-sub">
                {t('performance.sla_avg_sub', { time: formatHours(kpis.avgDeliveryHours || 0) })} — {(kpis.avgDeliveryHours||0) <= slaTarget ? t('performance.sla.within') : t('performance.sla.over')}
              </div>
            </div>
          </div>

          {/* Distribution Chart */}
          <div className="perf-charts-grid">
            <div className="perf-chart-card">
              <div className="perf-chart-title">
                <StatsUpSquare width={16} height={16} style={{ color: '#f97316' }} />
                {t('performance.chart.status_dist')}
              </div>
              <div className="perf-chart-sub">{t("performance.subtitle")}</div>
              <div className="perf-chart-body">
                <div className="perf-bars">
                  {statusBars.map(b => (
                    <div key={b.key} className="perf-bar">
                      <div className="perf-bar-fill"
                        style={{ blockSize: `${(b.count / barMax) * 140}px`, background: b.color }} />
                      <div className="perf-bar-count">{b.count}</div>
                      <div className="perf-bar-label">{b.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="perf-chart-card">
              <div className="perf-chart-title">
                <Wrench width={16} height={16} style={{ color: '#f97316' }} />
                {t('performance.chart.top_mechanics')}
              </div>
              <div className="perf-chart-sub">{t('performance.chart.top_mechanics_sub')}</div>
              <div className="perf-chart-body">
                <div style={{ width: '100%', padding: '0 8px' }}>
                  {mechanicPerf.slice(0, 5).map((d, i) => (
                    <div key={d.mechanic_id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
                    }}>
                      <span className={`perf-rank ${rankClass(i)}`}>{i + 1}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                        {d.name}
                      </span>
                      <div style={{ width: 120 }}>
                        <div className="perf-progress-wrap">
                          <div className="perf-progress-bar-bg">
                            <div className={`perf-progress-bar ${gradeClass(d.successRate)}`}
                              style={{ width: `${d.successRate}%` }} />
                          </div>
                          <span className="perf-progress-pct" style={{ color: d.successRate >= 85 ? '#16a34a' : d.successRate >= 60 ? '#d97706' : '#ef4444' }}>
                            {d.successRate}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {mechanicPerf.length === 0 && (
                    <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 20 }}>
                      {t('performance.no_mechanic_data_available')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Mechanic Scorecards Tab */}
      {activeTab === 'mechanics' && (
        mechanicPerf.length === 0 ? (
          <div className="perf-empty">
            <div className="perf-empty-icon"><Wrench width={28} height={28} /></div>
            <h3>{t("performance.no_mechanic_data")}</h3>
            <p>{t('performance.no_orders_period')}</p>
          </div>
        ) : (
          <div className="perf-table-wrap">
            <table className="perf-table">
              <thead>
                <tr>
                  <th>{t('performance.col.rank')}</th>
                  <th>{t('performance.col.mechanic')}</th>
                  <th>{t('performance.col.total')}</th>
                  <th>{t('performance.col.delivered')}</th>
                  <th>{t('performance.col.failed')}</th>
                  <th>{t('performance.success_rate')}</th>
                  <th>{t('performance.on_time')}</th>
                  <th>{t('performance.col.avg_time')}</th>
                  <th>{t('performance.rating')}</th>
                  <th>{t('performance.grade')}</th>
                </tr>
              </thead>
              <tbody>
                {mechanicPerf.map((d, i) => (
                  <tr key={d.mechanic_id}>
                    <td><span className={`perf-rank ${rankClass(i)}`}>{i + 1}</span></td>
                    <td>
                      <div className="perf-mechanic-cell">
                        <div className="perf-mechanic-avatar">
                          {d.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="perf-mechanic-info">
                          <div className="perf-mechanic-name">{d.name}</div>
                          {d.phone && <div className="perf-mechanic-phone">{d.phone}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontWeight: 700 }}>{d.total}</td>
                    <td style={{ fontWeight: 700, color: '#16a34a' }}>{d.delivered}</td>
                    <td style={{ fontWeight: 700, color: d.failed > 0 ? '#ef4444' : '#94a3b8' }}>{d.failed}</td>
                    <td>
                      <div className="perf-progress-wrap">
                        <div className="perf-progress-bar-bg">
                          <div className={`perf-progress-bar ${gradeClass(d.successRate)}`}
                            style={{ width: `${d.successRate}%` }} />
                        </div>
                        <span className="perf-progress-pct"
                          style={{ color: d.successRate >= 85 ? '#16a34a' : d.successRate >= 60 ? '#d97706' : '#ef4444' }}>
                          {d.successRate}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: d.onTimePct >= 85 ? '#16a34a' : d.onTimePct >= 60 ? '#d97706' : '#ef4444' }}>
                        {d.onTimePct}%
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{formatHours(d.avgHours)}</td>
                    <td><RatingStars rating={d.rating || 0} /></td>
                    <td>
                      <span className={`perf-badge ${d.grade || gradeClass(d.successRate)}`}>
                        {gradeLabel(d.successRate)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
