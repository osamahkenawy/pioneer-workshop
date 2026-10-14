import { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Loader, { DashboardSkeleton } from '../components/Loader';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { 
  Package, Check, WarningTriangle, DollarCircle,
  Clock, MapPin, StatUp, StatDown, ArrowRight, Plus, Activity,
  Timer, Refresh, Settings, Wrench, Page, ClipboardCheck, Group, Truck, User
} from 'iconoir-react';
import { AuthContext } from '../context/AuthContext';
import api from '../lib/api';
import { fmtCurrency } from '../utils/currency';
import './Dashboard.css';
import MyTasks from '../components/workflow/MyTasks';
import { canDo, hasModule } from '../lib/permissions';
import { woDisplayKey, woLabel, WO_DISPLAY_KEYS, WO_STATUSES } from '../lib/statusLabels';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const AUTO_REFRESH_MS = 30000; // 30 seconds

/* Chart colours per workshop stage (lib/statusLabels.js display keys); the
   words come from woLabel. Brighter than the chip tones so slices read on
   the white card. */
const STAGE_COLORS = {
  checked_in: '#64748b', inspected: '#0ea5e9', approved: '#6366f1', assigned: '#8b5cf6', in_work: '#3b82f6',
  quality_check: '#a855f7', ready: '#f97316', closed: '#22c55e', cancelled: '#94a3b8',
};

const WIDGET_DEFS = [
  { key: 'metrics',      label: 'dashboard.widgets.metrics' },
  { key: 'charts',       label: 'dashboard.widgets.charts' },
  { key: 'hourly',       label: 'dashboard.widgets.hourly' },
  { key: 'service_bays',        label: 'dashboard.widgets.service_bays' },
  { key: 'mechanics',      label: 'dashboard.widgets.mechanics' },
  { key: 'recent',       label: 'dashboard.widgets.recent' },
];
const DEFAULT_VISIBLE = () => WIDGET_DEFS.reduce((acc, w) => ({ ...acc, [w.key]: true }), {});
const STORAGE_KEY = 'dashboard_widgets';
const loadWidgets = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || DEFAULT_VISIBLE(); } catch { return DEFAULT_VISIBLE(); } };

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  const [chart, setChart] = useState([]);
  const [topServiceBays, setTopServiceBays] = useState([]);
  const [topMechanics, setTopMechanics] = useState([]);
  const [recentWorkOrders, setRecentWorkOrders] = useState([]);
  const [ordersByHour, setWorkOrdersByHour] = useState([]);
  const [ordersByStatus, setOrdersByStatus] = useState([]);
  /* Week vs month view. A workshop that hasn't booked anything since this
     morning still wants to see how the period is going, so the dashboard is
     period-based rather than day-based. Remembered per browser. */
  const [period, setPeriod] = useState(() => {
    try { const p = localStorage.getItem('dashboard_period'); return ['week', 'all'].includes(p) ? p : 'month'; } catch { return 'month'; }
  });
  const [periodRange, setPeriodRange] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [widgetVis, setWidgetVis] = useState(loadWidgets);
  const [showWidgetPanel, setShowWidgetPanel] = useState(false);
  const { user, workshop } = useContext(AuthContext);
  const refreshTimer = useRef(null);

  const toggleWidget = (key) => {
    setWidgetVis(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const fetchStats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get(`/stats?period=${period}`);
      if (res.success) {
        setStats(res.data?.kpis || {});
        setChart(res.data?.daily_chart || []);
        setTopServiceBays(res.data?.top_zones || []);
        setTopMechanics(res.data?.top_mechanics || []);
        setRecentWorkOrders(res.data?.recent_orders || []);
        setWorkOrdersByHour(res.data?.orders_by_hour || []);
        setOrdersByStatus(res.data?.orders_by_status || []);
        setPeriodRange(res.data?.period || null);
        setLastRefreshed(new Date());
      }
    } catch (e) {
      console.error('Stats error:', e);
    } finally {
      if (!silent) {
        setLoading(false);
        // After loading finishes and charts render, trigger resize for Chart.js
        setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
      }
    }
  }, [period]);

  const periodLabel = period === 'week'
    ? t('dashboard.this_week', 'This Week')
    : period === 'all' ? t('dashboard.all_time', 'All time')
    : t('dashboard.this_month', 'This Month');
  // "this month" / "this week" for use inside a sentence
  const periodPhrase = period === 'week' ? t('dashboard.phrase_week', 'this week') : t('dashboard.phrase_month', 'this month');
  // Deltas compare with the previous period up to the same day (stats.js)
  const vsLabel = period === 'week'
    ? t('dashboard.vs_same_point_last_week', 'vs this point last week')
    : t('dashboard.vs_same_point_last_month', 'vs this point last month');

  const changePeriod = (next) => {
    setPeriod(next);
    try { localStorage.setItem('dashboard_period', next); } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchStats();
    const clockTimer = setInterval(() => setCurrentTime(new Date()), 60000);
    // Trigger resize so Chart.js recalculates canvas size after CSS layout settles
    const resizeTimer = setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
    return () => { clearInterval(clockTimer); clearTimeout(resizeTimer); };
  }, [fetchStats]);

  // Auto-refresh (#44)
  useEffect(() => {
    if (autoRefresh) {
      refreshTimer.current = setInterval(() => fetchStats(true), AUTO_REFRESH_MS);
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [autoRefresh, fetchStats]);

  const getGreeting = () => {
    const h = currentTime.getHours();
    if (h >= 5 && h < 12) return t('dashboard.good_morning');
    if (h >= 12 && h < 17) return t('dashboard.good_afternoon');
    if (h >= 17 && h < 21) return t('dashboard.good_evening');
    return t('dashboard.good_night');
  };

  const formatTime = () => currentTime.toLocaleTimeString(i18n.language === 'ar' ? 'ar-AE' : 'en-AE', { hour: '2-digit', minute: '2-digit', hour12: true });
  const formatDate = () => currentTime.toLocaleDateString(i18n.language === 'ar' ? 'ar-AE' : 'en-AE', { weekday: 'long', month: 'long', day: 'numeric' });
  const cur = workshop?.currency || 'AED';
  const fmtAED = (v) => fmtCurrency(v, cur);
  const fmtNum = (n) => Number(n || 0).toLocaleString('en-AE');
  const fmtDay = (iso) => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  // Recent rows span months of history: a bare time ("04:26 PM") hid that
  // most of them are not from today.
  const fmtWhen = (ts) => {
    const d = new Date(ts);
    const time = d.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true });
    return d.toDateString() === new Date().toDateString()
      ? time : `${d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })}, ${time}`;
  };
  const fmtMins = (m) => {
    if (!m || m <= 0) return '—';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r > 0 ? `${h}h ${r}m` : `${h}h`;
  };

  const DeltaBadge = ({ delta }) => {
    // Nothing to say when there is no comparison, or when the period is empty
    // (the header already says so — a row of red "-100%" badges adds nothing).
    if (delta === undefined || delta === null || period === 'all' || !(stats.orders_period > 0)) return null;
    const isUp = delta >= 0;
    return (
      <span className={`delta-badge ${isUp ? 'up' : 'down'}`}>
        {isUp ? <StatUp width={11} height={11} /> : <StatDown width={11} height={11} />}
        {Math.abs(delta)}% {vsLabel}
      </span>
    );
  };

  const lineData = {
    // A month's worth of points can't be labelled by weekday (they'd repeat),
    // so switch to day-of-month once the range is longer than a week.
    labels: chart.map(d => new Date(`${d.date}T00:00:00`).toLocaleDateString('en-AE',
      periodRange?.granularity === 'month' ? { month: 'short', year: 'numeric' }
        : chart.length > 7 ? { day: 'numeric', month: 'short' } : { weekday: 'short' })),
    datasets: [
      {
        label: t('dashboard.chart_orders'),
        data: chart.map(d => d.orders || 0),
        borderColor: '#1e3a6b',
        backgroundColor: 'rgba(36,64,102,0.08)',
        fill: true, tension: 0.4, pointRadius: 4,
        pointBackgroundColor: '#1e3a6b',
      },
      {
        label: t('dashboard.chart_delivered'),
        data: chart.map(d => d.delivered || 0),
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.08)',
        fill: true, tension: 0.4, pointRadius: 3,
        pointBackgroundColor: '#22c55e',
        borderDash: [5, 3],
      },
    ]
  };
  const lineOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 16, font: { size: 11 } } }, tooltip: { backgroundColor: '#1e3a6b', cornerRadius: 8, padding: 12 } },
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
      x: { grid: { display: false } }
    }
  };

  const stageColor = (woOrStatus) => STAGE_COLORS[woDisplayKey(woOrStatus)] || '#64748b';

  /* Status breakdown — one slice per workshop stage, in Steps 1–7 order.
     Stored statuses that read the same fold into one slice: 'accepted' (the
     old courier step) into Technician assigned, 'estimate_approved' and
     'auto_assign' into Approved. A slice drills through to the list filtered
     by exactly the statuses in it. Empty stages are dropped. */
  const statusSlices = WO_DISPLAY_KEYS
    .map(key => {
      const statuses = WO_STATUSES.filter(s => woDisplayKey(s) === key);
      const count = ordersByStatus.filter(r => statuses.includes(r.status)).reduce((sum, r) => sum + Number(r.count || 0), 0);
      return { key, statuses, count };
    })
    .filter(s => s.count > 0);
  const statusTotal = statusSlices.reduce((sum, s) => sum + s.count, 0);

  const statusData = {
    labels: statusSlices.map(s => woLabel(t, s.statuses[0])),
    datasets: [{
      data: statusSlices.map(s => s.count),
      backgroundColor: statusSlices.map(s => STAGE_COLORS[s.key]),
      borderWidth: 0,
    }]
  };

  // Carry the dashboard's period into the list, so the row count the user
  // lands on matches the slice they clicked.
  const goToStatus = (statuses) => {
    const range = periodRange
      ? `&date_from=${periodRange.start_date}&date_to=${periodRange.end_date}`
      : '';
    navigate(`/work-orders?status=${statuses.join(',')}${range}`);
  };

  const doughnutOptions = {
    responsive: true, maintainAspectRatio: false, cutout: '70%',
    // Click a slice (or its legend entry) to open the work-order list already
    // filtered to that status.
    onClick: (_evt, elements) => {
      const slice = statusSlices[elements?.[0]?.index];
      if (slice) goToStatus(slice.statuses);
    },
    onHover: (evt, elements) => {
      if (evt?.native?.target) evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: {
        // Under the ring on a phone, where a side legend squeezes it to nothing.
        position: typeof window !== 'undefined' && window.innerWidth < 600 ? 'bottom' : 'right',
        onClick: (_e, item) => {
          const slice = statusSlices[item?.index];
          if (slice) goToStatus(slice.statuses);
        },
        labels: {
          usePointStyle: true,
          padding: 12,
          // Show the count next to each status so the breakdown is readable
          // without hovering
          generateLabels: (chart) => {
            const ds = chart.data.datasets[0] || { data: [], backgroundColor: [] };
            return (chart.data.labels || []).map((label, i) => ({
              text: `${label} — ${Number(ds.data[i]).toLocaleString('en-AE')}`,
              fillStyle: ds.backgroundColor[i],
              strokeStyle: ds.backgroundColor[i],
              pointStyle: 'circle',
              hidden: false,
              index: i,
            }));
          },
        },
      },
      tooltip: {
        backgroundColor: '#1e3a6b', cornerRadius: 8, padding: 12,
        callbacks: {
          label: (ctx) => {
            const pct = statusTotal ? Math.round((ctx.parsed / statusTotal) * 100) : 0;
            return ` ${ctx.label}: ${Number(ctx.parsed).toLocaleString('en-AE')} (${pct}%)`;
          },
          footer: () => 'Click to view these work orders',
        },
      },
    },
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="dashboard">
      {/* Welcome Header */}
      <div className="dashboard-header">
        {/* The glow shapes live in their own clipped layer. They used to sit
            on the header itself, whose overflow:hidden then also clipped the
            "Customize widgets" panel opening out of it. */}
        <div className="dashboard-header-deco" aria-hidden="true" />
        <div className="welcome-section">
          <div className="greeting-time">
            <Clock width={16} height={16} />
            <span>{formatTime()}</span>
            <span className="date-divider">&bull;</span>
            <span>{formatDate()}</span>
          </div>
          <h1>{getGreeting()}, {user?.full_name || user?.username}</h1>
          <p className="welcome-subtitle">{t('dashboard.subtitle')}</p>
          {/* Period switcher — drives the KPI tiles, the trend chart and the
              status breakdown below. */}
          <div style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, background: 'rgba(255,255,255,0.14)', marginTop: 10 }}>
            {[{ k: 'week', label: t('dashboard.this_week', 'This Week') },
              { k: 'month', label: t('dashboard.this_month', 'This Month') },
              { k: 'all', label: t('dashboard.all_time', 'All time') }].map(opt => (
              <button
                key={opt.k}
                onClick={() => changePeriod(opt.k)}
                style={{
                  padding: '5px 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 700,
                  background: period === opt.k ? '#fff' : 'transparent',
                  color: period === opt.k ? '#1e3a6b' : 'rgba(255,255,255,0.85)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {periodRange && (
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>
              {fmtDay(periodRange.start_date)} → {fmtDay(periodRange.end_date)}
            </div>
          )}
          {period !== 'all' && !loading && (stats.orders_period || 0) === 0 && (
            <div className="period-empty-hint">
              {t('dashboard.no_orders_in_period', 'No new work orders {{period}} yet.', { period: periodPhrase })}
              <button onClick={() => changePeriod('all')}>{t('dashboard.show_all_time', 'Show all time')}</button>
            </div>
          )}
        </div>
        <div className="header-actions">
          <button
            className={`btn-auto-refresh ${autoRefresh ? 'active' : ''}`}
            onClick={() => setAutoRefresh(prev => !prev)}
            title={autoRefresh ? t('dashboard.auto_refresh_on') : t('dashboard.auto_refresh_off')}
          >
            <Refresh width={15} height={15} className={autoRefresh ? 'spin-slow' : ''} />
            {autoRefresh ? t('dashboard.live_label') : t('dashboard.paused_label')}
          </button>
          {lastRefreshed && (
            <span className="last-refreshed">
              {t('dashboard.updated')} {lastRefreshed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
            </span>
          )}
          {canDo(user, 'job.open') && (
            <Link to="/work-orders?new=1" className="btn-primary">
              <Plus width={18} height={18} />
              {t('dashboard.new_order')}
            </Link>
          )}
          <div style={{ position: 'relative' }}>
            <button className="btn-auto-refresh" onClick={() => setShowWidgetPanel(v => !v)} title={t('dashboard.settings.customize_widgets')}>
              <Settings width={15} height={15} /> {t('dashboard.settings.customize_widgets')}
            </button>
            {showWidgetPanel && (
              <div className="widget-panel">
                <div className="widget-panel-header">
                  <strong>{t('dashboard.toggle_widgets')}</strong>
                  <button className="widget-panel-close" onClick={() => setShowWidgetPanel(false)}>&times;</button>
                </div>
                {WIDGET_DEFS.map(w => (
                  <label key={w.key} className="widget-panel-item">
                    <input type="checkbox" checked={!!widgetVis[w.key]} onChange={() => toggleWidget(w.key)} />
                    <span>{t(w.label)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Steps 1–7: what is waiting on this person's role */}
      <MyTasks />

      {/* Key Metrics Row — every tile follows the period switcher. When a
          period is empty the tiles say so and the header offers "Show all
          time"; they no longer swap to all-time figures behind a label that
          still reads "This Month". */}
      {widgetVis.metrics && (() => {
        const isAll = period === 'all';
        const cancelledVal = isAll ? (stats.cancelled_all_time || 0) : (stats.cancelled_period || 0);
        const allTimeNote = (txt) => !isAll && <span className="metric-sub">{txt}</span>;
        return (
        <div className="metrics-row">
        <div className="metric-card primary">
          <div className="metric-icon" style={{ background: 'rgba(242,66,27,0.1)', color: '#159fd9' }}>
            <Package width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{fmtNum(stats.orders_period)}</span>
            <span className="metric-label">{t('dashboard.kpiCards.orders_period', 'Work Orders')} · {periodLabel}</span>
            {allTimeNote(t('dashboard.n_all_time', '{{n}} all time', { n: fmtNum(stats.total_orders_all_time) }))}
          </div>
          <DeltaBadge delta={stats.delta_orders_period} />
          <div className="metric-trend neutral">
            <Activity width={14} height={14} />
            <span>{t('dashboard.active_now', 'In the workshop now')}: {fmtNum(stats.active_orders_all_time || stats.active_orders)} · {t('dashboard.waiting', 'Waiting')}: {fmtNum(stats.waiting_orders ?? stats.pending_orders)}</span>
          </div>
        </div>

        <div className="metric-card success">
          <div className="metric-icon" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
            <Check width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{fmtNum(stats.completed_period)}</span>
            <span className="metric-label">{t('dashboard.kpiCards.completed_orders')} · {periodLabel}</span>
            {allTimeNote(t('dashboard.n_all_time', '{{n}} all time', { n: fmtNum(stats.completed_orders_all_time) }))}
          </div>
          <DeltaBadge delta={stats.delta_completed_period} />
          {stats.success_rate_period != null && (
            <div className="metric-trend positive">
              <StatUp width={14} height={14} />
              <span>{t('dashboard.completion_rate', 'Completion rate')}: {stats.success_rate_period}%</span>
            </div>
          )}
        </div>

        <div className="metric-card tertiary">
          <div className="metric-icon" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
            <Wrench width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{fmtNum(stats.available_mechanics)}<span style={{ fontSize: 13, fontWeight: 500, color: '#94a3b8' }}> / {fmtNum(stats.total_mechanics)}</span></span>
            <span className="metric-label">{t('dashboard.kpiCards.active_mechanics')}</span>
          </div>
          <div className="metric-trend neutral">
            <Activity width={14} height={14} />
            <span>{t('dashboard.on_a_job', 'On a job')}: {fmtNum(stats.busy_mechanics)} · {t('dashboard.off_duty', 'Off')}: {fmtNum(stats.offline_mechanics)}</span>
          </div>
        </div>

        <div className="metric-card info">
          <div className="metric-icon" style={{ background: 'rgba(102,126,234,0.1)', color: '#667eea' }}>
            <Timer width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{fmtMins(stats.avg_minutes_period)}</span>
            <span className="metric-label">{t('dashboard.kpiCards.delivery_time')} · {periodLabel}</span>
            {!stats.avg_minutes_period && <span className="metric-sub">{t('dashboard.no_completed_in_period', 'No jobs completed {{period}}', { period: isAll ? '' : periodPhrase })}</span>}
          </div>
        </div>

        <div className="metric-card secondary">
          <div className="metric-icon" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>
            <DollarCircle width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value" style={{ fontSize: 20 }}>{fmtAED(stats.revenue_period)}</span>
            <span className="metric-label">{t('dashboard.kpiCards.revenue', 'Revenue')} · {periodLabel}</span>
            {allTimeNote(t('dashboard.amount_all_time', '{{amount}} all time', { amount: fmtAED(stats.revenue_all_time) }))}
          </div>
          <DeltaBadge delta={stats.delta_revenue_period} />
        </div>

        <div className="metric-card accent">
          <div className="metric-icon" style={{ background: 'rgba(148,163,184,0.15)', color: '#64748b' }}>
            <WarningTriangle width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{fmtNum(cancelledVal)}</span>
            <span className="metric-label">{woLabel(t, 'cancelled')} · {periodLabel}</span>
            {allTimeNote(t('dashboard.n_all_time', '{{n}} all time', { n: fmtNum(stats.cancelled_all_time) }))}
          </div>
        </div>
      </div>
      );
      })()}

      {/* Cash Collection card removed — cash reconciliation lives on its own
          page (/cash-payments); it was duplicating that here. */}

      {/* Charts Row */}
      {widgetVis.charts && <div className="charts-row">
        <div className="chart-card sales-chart">
          <div className="chart-header">
            <div>
              <h3>{t('dashboard.work_order_volume', 'Work Order Volume')} · {periodLabel}</h3>
              <p>{period === 'all' ? t('dashboard.monthly_volume_trend', 'Work orders and completions per month') : t('dashboard.daily_volume_trend')}</p>
            </div>
          </div>
          <div className="chart-body">
            {chart.some(d => d.orders > 0 || d.delivered > 0)
              ? <Line data={lineData} options={lineOptions} />
              : <div className="chart-empty">
                  <span>{t('dashboard.no_orders_in_period', 'No new work orders {{period}} yet.', { period: periodPhrase })}</span>
                  <button onClick={() => changePeriod('all')}>{t('dashboard.show_all_time', 'Show all time')}</button>
                </div>}
          </div>
        </div>

        <div className="chart-card pipeline-chart">
          <div className="chart-header">
            <div>
              <h3>{t('dashboard.order_status_breakdown')}</h3>
              <p>{t('dashboard.click_slice_hint', 'Click a slice to view those work orders')}</p>
            </div>
          </div>
          <div className="chart-body">
            {statusSlices.length > 0
              ? <Doughnut data={statusData} options={doughnutOptions} />
              : <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94a3b8', fontSize:13 }}>
                  {t('dashboard.no_work_orders', 'No work orders yet')}
                </div>}
          </div>
          {/* Total of the breakdown above — not a "today" figure, so the ring
              and the number underneath always agree. */}
          <div className="pipeline-total">
            <span className="total-label">{t('dashboard.total_work_orders', 'Total Work Orders')}</span>
            <span className="total-value">{fmtNum(statusTotal)}</span>
          </div>
        </div>
      </div>}

      {/* WorkOrders by Hour (#56) */}
      {widgetVis.hourly && ordersByHour.some(h => h.orders > 0) && (
        <div className="chart-card" style={{ marginBottom: 24 }}>
          <div className="chart-header">
            <div>
              <h3><Activity width={20} height={20} /> {t('dashboard.todays_activity')}</h3>
              <p>{t('dashboard.order_distribution')}</p>
            </div>
          </div>
          <div className="chart-body">
            <Bar
              data={{
                labels: ordersByHour.map(h => h.label),
                datasets: [
                  {
                    label: t('dashboard.chart_orders'),
                    data: ordersByHour.map(h => h.orders),
                    backgroundColor: 'rgba(36, 64, 102, 0.75)',
                    borderRadius: 4,
                    borderSkipped: false,
                  },
                  {
                    label: t('dashboard.chart_delivered'),
                    data: ordersByHour.map(h => h.delivered),
                    backgroundColor: 'rgba(34, 197, 94, 0.75)',
                    borderRadius: 4,
                    borderSkipped: false,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
                  tooltip: {
                    callbacks: {
                      title: (ctx) => `${ctx[0].label}`,
                    },
                  },
                },
                scales: {
                  x: { grid: { display: false } },
                  y: { beginAtZero: true, ticks: { stepSize: 1 } },
                },
              }}
              height={220}
            />
          </div>
        </div>
      )}

      {/* Top ServiceBays, Top Mechanics, Recent WorkOrders */}
      {(widgetVis.service_bays || widgetVis.mechanics || widgetVis.recent) && (
      <div className="recent-data-row triple">
        {widgetVis.service_bays && (
        <div className="recent-card">
          <div className="card-header">
            <h3><MapPin width={20} height={20} /> {t('dashboard.top_zones')}</h3>
            {hasModule(user, 'service-bays') && <Link to="/service-bays" className="view-all">{t('dashboard.view_all')} <ArrowRight width={16} height={16} /></Link>}
          </div>
          <div className="card-body">
            {topServiceBays.length === 0 ? (
              <div className="empty-state-mini">
                <MapPin width={32} height={32} />
                <p>{t('dashboard.no_zone_data')}</p>
              </div>
            ) : (
              <div className="recent-list">
                {topServiceBays.slice(0, 5).map((bay, i) => (
                  <div key={i} className="recent-item">
                    <div className="recent-avatar" style={{ background: '#1e3a6b' }}>
                      {i + 1}
                    </div>
                    <div className="recent-info">
                      <strong>{bay.name}</strong>
                      <span>{bay.bay_type ? bay.bay_type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : bay.bay_number}</span>
                    </div>
                    <span className="status-badge" style={{ background: '#fff7ed', color: '#f97316' }}>
                      {fmtNum(bay.orders_count)} {t('dashboard.orders_short', 'orders')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}

        {widgetVis.mechanics && (
        <div className="recent-card">
          <div className="card-header">
            <h3><Wrench width={20} height={20} /> {t('dashboard.top_mechanics')}</h3>
            {hasModule(user, 'mechanics') && <Link to="/mechanics" className="view-all">{t('dashboard.view_all')} <ArrowRight width={16} height={16} /></Link>}
          </div>
          <div className="card-body">
            {topMechanics.length === 0 ? (
              <div className="empty-state-mini">
                <Wrench width={32} height={32} />
                <p>{t('dashboard.no_completed_in_period', 'No jobs completed {{period}}', { period: period === 'all' ? '' : periodPhrase })}</p>
              </div>
            ) : (
            <div className="recent-list">
              {topMechanics.slice(0, 5).map((mechanic, i) => (
                <div key={i} className="recent-item">
                  <div className="recent-avatar">
                    {mechanic.full_name?.charAt(0)}
                  </div>
                  <div className="recent-info">
                    <strong>{mechanic.full_name}</strong>
                    <span>{mechanic.specialty ? mechanic.specialty.replace(/_/g, ' ') : t('dashboard.technician', 'Technician')}</span>
                  </div>
                  <span className="status-badge active"
                    style={{ background: '#f0fdf4', color: '#16a34a' }}>
                    {mechanic.jobs_completed || 0} {t('dashboard.jobs_short', 'jobs')}
                  </span>
                </div>
              ))}
            </div>
            )}
          </div>
        </div>
        )}

        {/* Recent WorkOrders Feed (#53) */}
        {widgetVis.recent && (
        <div className="recent-card">
          <div className="card-header">
            <h3><Package width={20} height={20} /> {t('dashboard.recent_orders')}</h3>
            <Link to="/work-orders" className="view-all">{t('dashboard.view_all')} <ArrowRight width={16} height={16} /></Link>
          </div>
          <div className="card-body">
            {recentWorkOrders.length === 0 ? (
              <div className="empty-state-mini">
                <Package width={32} height={32} />
                <p>{t('dashboard.no_recent_orders')}</p>
              </div>
            ) : (
              <div className="recent-list">
                {recentWorkOrders.slice(0, 5).map((order) => {
                  const vehicleLabel = [order.vehicle_make, order.vehicle_model].filter(Boolean).join(' ');
                  const primary = order.customer_name || t('orders.walk_in', 'Walk-in');
                  const secondaryBits = [];
                  if (vehicleLabel) secondaryBits.push(vehicleLabel);
                  if (order.vehicle_plate_number) secondaryBits.push(order.vehicle_plate_number);
                  if (!secondaryBits.length && order.mechanic_name) secondaryBits.push(order.mechanic_name);
                  secondaryBits.push(fmtWhen(order.created_at));
                  return (
                    <div key={order.id} className="recent-item">
                      <div className="recent-avatar" style={{ background: stageColor(order), fontSize: 10 }}>
                        {order.work_order_number?.slice(-3) || '#'}
                      </div>
                      <div className="recent-info">
                        <strong>{primary}</strong>
                        <span>{secondaryBits.join(' \u00B7 ')}</span>
                      </div>
                      <span className="status-badge" style={{ background: `${stageColor(order)}18`, color: stageColor(order) }}>
                        {woLabel(t, order, 'short')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
      )}

      {/* Quick Actions */}
      <div className="quick-actions-section">
        <h3>{t('dashboard.quick_actions')}</h3>
        <div className="quick-actions-grid">
          {[
            { to: '/work-orders?new=1', icon: Plus, label: t('dashboard.new_order'), bg: '#fff7ed', color: '#ea580c', cap: 'job.open' },
            { to: '/estimates?new=1', icon: Page, label: t('dashboard.new_estimate', 'New Estimate'), bg: '#eef2ff', color: '#4f46e5', cap: 'estimate.raise' },
            { to: '/estimates', icon: ClipboardCheck, label: t('common.estimates', 'Estimates'), mod: 'estimates' },
            { to: '/store', icon: Page, label: t('common.store', 'Store'), mod: 'store' },
            { to: '/job-assignment', icon: Group, label: t('dashboard.job-assignment'), mod: 'job-assignment' },
            { to: '/team-leader', icon: Group, label: t('common.team_board', 'Team Board'), mod: 'team-leader' },
            { to: '/fleet-intake', icon: Truck, label: t('common.fleet_intake', 'Fleet Intake'), mod: 'fleet-intake' },
            { to: '/customers', icon: User, label: t('dashboard.customers'), mod: 'customers' },
            { to: '/reports', icon: StatUp, label: t('dashboard.reports'), mod: 'reports' },
          ].filter(a => (!a.cap || canDo(user, a.cap)) && (!a.mod || hasModule(user, a.mod))).map(a => (
            <Link key={a.to} to={a.to} className="quick-action-card">
              <div className="quick-action-icon" style={a.bg ? { background: a.bg } : undefined}>
                <a.icon width={24} height={24} color={a.color} />
              </div>
              <span>{a.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
