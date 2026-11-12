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
import './DashboardHome.css';
import MyTasks from '../components/workflow/MyTasks';
import { canDo, hasModule } from '../lib/permissions';
import { woDisplayKey, woLabel, WO_DISPLAY_KEYS, WO_STATUSES } from '../lib/statusLabels';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const AUTO_REFRESH_MS = 30000; // 30 seconds

/* Charts use the app's typeface and the page's muted ink (DashboardHome.css). */
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const INK_MUTED = '#64748b';
const GRID = '#eef2f6';
const TOOLTIP = { backgroundColor: '#0f172a', cornerRadius: 8, padding: 10, titleFont: { family: FONT, size: 12, weight: '600' }, bodyFont: { family: FONT, size: 12 } };

/** One KPI tile: icon + label, the figure, then a line or two of context. */
function Kpi({ icon: Icon, tone, label, value, unit, delta, children }) {
  return (
    <div className={`dsh-kpi tone-${tone}`}>
      <div className="dsh-kpi-top">
        <span className="dsh-kpi-icon" aria-hidden="true"><Icon width={16} height={16} strokeWidth={1.8} /></span>
        <span className="dsh-kpi-label">{label}</span>
      </div>
      <div className="dsh-kpi-value">{value}{unit && <small>{unit}</small>}</div>
      {delta}
      {children && <div className="dsh-kpi-meta">{children}</div>}
    </div>
  );
}

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
      <span className={`dsh-delta ${isUp ? 'up' : 'down'}`}>
        <b>{isUp ? <StatUp width={12} height={12} /> : <StatDown width={12} height={12} />}{isUp ? '+' : '−'}{Math.abs(delta)}%</b>
        <span>{vsLabel}</span>
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
        backgroundColor: 'rgba(30,58,107,0.07)',
        borderWidth: 2, fill: true, tension: 0.35, cubicInterpolationMode: 'monotone',
        pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: '#1e3a6b',
      },
      {
        label: t('dashboard.chart_delivered'),
        data: chart.map(d => d.delivered || 0),
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22,163,74,0.05)',
        borderWidth: 2, fill: true, tension: 0.35, cubicInterpolationMode: 'monotone',
        pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: '#16a34a',
        borderDash: [5, 4],
      },
    ]
  };
  const lineOptions = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, padding: 14, color: INK_MUTED, font: { family: FONT, size: 12 } } },
      tooltip: TOOLTIP,
    },
    scales: {
      y: { beginAtZero: true, border: { display: false }, grid: { color: GRID }, ticks: { color: INK_MUTED, font: { family: FONT, size: 11 }, precision: 0, padding: 6 } },
      x: { border: { display: false }, grid: { display: false }, ticks: { color: INK_MUTED, font: { family: FONT, size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
    },
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
      borderWidth: 2, borderColor: '#fff', hoverOffset: 4,
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
    responsive: true, maintainAspectRatio: false, cutout: '72%',
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
          boxWidth: 7, boxHeight: 7,
          padding: 10,
          color: '#334155',
          font: { family: FONT, size: 12 },
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
        ...TOOLTIP,
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

  const periodOptions = [
    { k: 'week', label: t('dashboard.this_week', 'This Week') },
    { k: 'month', label: t('dashboard.this_month', 'This Month') },
    { k: 'all', label: t('dashboard.all_time', 'All time') },
  ];
  const isAll = period === 'all';
  const cancelledVal = isAll ? (stats.cancelled_all_time || 0) : (stats.cancelled_period || 0);
  const allTime = (txt) => !isAll && <span>{txt}</span>;
  const quickActions = [
    { to: '/work-orders?new=1', icon: Plus, label: t('dashboard.new_order'), tone: 'orange', cap: 'job.open' },
    { to: '/estimates?new=1', icon: Page, label: t('dashboard.new_estimate', 'New Estimate'), tone: 'indigo', cap: 'estimate.raise' },
    { to: '/estimates', icon: ClipboardCheck, label: t('common.estimates', 'Estimates'), tone: 'sky', mod: 'estimates' },
    { to: '/store', icon: Page, label: t('common.store', 'Store'), tone: 'violet', mod: 'store' },
    { to: '/job-assignment', icon: Group, label: t('dashboard.job-assignment'), tone: 'navy', mod: 'job-assignment' },
    { to: '/team-leader', icon: Group, label: t('common.team_board', 'Team Board'), tone: 'navy', mod: 'team-leader' },
    { to: '/fleet-intake', icon: Truck, label: t('common.fleet_intake', 'Fleet Intake'), tone: 'teal', mod: 'fleet-intake' },
    { to: '/customers', icon: User, label: t('dashboard.customers'), tone: 'slate', mod: 'customers' },
    { to: '/reports', icon: StatUp, label: t('dashboard.reports'), tone: 'green', mod: 'reports' },
  ].filter(a => (!a.cap || canDo(user, a.cap)) && (!a.mod || hasModule(user, a.mod)));
  const showLists = widgetVis.service_bays || widgetVis.mechanics || widgetVis.recent;
  const listCols = [widgetVis.service_bays, widgetVis.mechanics, widgetVis.recent].filter(Boolean).length;

  return (
    <div className="dashboard dsh">
      {/* Page header: greeting, the period every figure below follows, live
          refresh, widgets and the main action. */}
      <header className="dsh-head">
        <div className="dsh-head-text">
          <h1>{getGreeting()}, {user?.full_name || user?.username}</h1>
          <p>
            <span>{formatDate()}</span>
            {periodRange && (
              <>
                <span className="dsh-sep" aria-hidden="true">·</span>
                <span>{periodLabel}: {fmtDay(periodRange.start_date)} – {fmtDay(periodRange.end_date)}</span>
              </>
            )}
          </p>
        </div>
        <div className="dsh-head-actions">
          <div className="dsh-seg" role="group" aria-label={t('dashboard.period', 'Period')}>
            {periodOptions.map(opt => (
              <button key={opt.k} type="button" className={period === opt.k ? 'on' : ''} aria-pressed={period === opt.k} onClick={() => changePeriod(opt.k)}>
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`dsh-live ${autoRefresh ? 'on' : ''}`}
            onClick={() => setAutoRefresh(prev => !prev)}
            title={`${autoRefresh ? t('dashboard.auto_refresh_on') : t('dashboard.auto_refresh_off')}${lastRefreshed ? ` · ${t('dashboard.updated')} ${lastRefreshed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}` : ''}`}
          >
            <span className="dsh-live-dot" aria-hidden="true" />
            {autoRefresh ? t('dashboard.live_label') : t('dashboard.paused_label')}
            {lastRefreshed && <span className="dsh-live-time">{lastRefreshed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })}</span>}
          </button>
          <div className="dsh-widgets">
            <button type="button" className="dsh-icon-btn" onClick={() => setShowWidgetPanel(v => !v)}
              title={t('dashboard.settings.customize_widgets')} aria-label={t('dashboard.settings.customize_widgets')} aria-expanded={showWidgetPanel}>
              <Settings width={16} height={16} />
            </button>
            {showWidgetPanel && (
              <div className="dsh-widget-panel">
                <div className="dsh-widget-panel-head">
                  <strong>{t('dashboard.settings.customize_widgets')}</strong>
                  <button type="button" onClick={() => setShowWidgetPanel(false)} aria-label={t('common.close', 'Close')}>&times;</button>
                </div>
                {WIDGET_DEFS.map(w => (
                  <label key={w.key} className="dsh-widget-item">
                    <input type="checkbox" checked={!!widgetVis[w.key]} onChange={() => toggleWidget(w.key)} />
                    <span>{t(w.label)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {canDo(user, 'job.open') && (
            <Link to="/work-orders?new=1" className="dsh-btn-primary">
              <Plus width={16} height={16} strokeWidth={2} />
              {t('dashboard.new_order')}
            </Link>
          )}
        </div>
      </header>

      {period !== 'all' && (stats.orders_period || 0) === 0 && (
        <div className="dsh-hint">
          <span>{t('dashboard.no_orders_in_period', 'No new work orders {{period}} yet.', { period: periodPhrase })}</span>
          <button type="button" onClick={() => changePeriod('all')}>{t('dashboard.show_all_time', 'Show all time')}</button>
        </div>
      )}

      {/* Key figures — every tile but Technicians follows the period above. */}
      {widgetVis.metrics && (
        <section className="dsh-kpis" aria-label={t('dashboard.widgets.metrics')}>
          <Kpi icon={Package} tone="navy" label={t('dashboard.kpiCards.orders_period', 'Work Orders')}
            value={fmtNum(stats.orders_period)} delta={<DeltaBadge delta={stats.delta_orders_period} />}>
            {allTime(t('dashboard.n_all_time', '{{n}} all time', { n: fmtNum(stats.total_orders_all_time) }))}
            <span>{t('dashboard.active_now', 'In the workshop now')}: <b>{fmtNum(stats.active_orders_all_time || stats.active_orders)}</b> · {t('dashboard.waiting', 'Waiting')}: <b>{fmtNum(stats.waiting_orders ?? stats.pending_orders)}</b></span>
          </Kpi>
          <Kpi icon={Check} tone="green" label={t('dashboard.kpiCards.completed_orders')}
            value={fmtNum(stats.completed_period)} delta={<DeltaBadge delta={stats.delta_completed_period} />}>
            {allTime(t('dashboard.n_all_time', '{{n}} all time', { n: fmtNum(stats.completed_orders_all_time) }))}
            {stats.success_rate_period != null && <span>{t('dashboard.completion_rate', 'Completion rate')}: <b>{stats.success_rate_period}%</b></span>}
          </Kpi>
          <Kpi icon={Wrench} tone="blue" label={t('dashboard.kpiCards.active_mechanics')}
            value={fmtNum(stats.available_mechanics)} unit={` / ${fmtNum(stats.total_mechanics)}`}>
            <span>{t('dashboard.on_a_job', 'On a job')}: <b>{fmtNum(stats.busy_mechanics)}</b> · {t('dashboard.off_duty', 'Off')}: <b>{fmtNum(stats.offline_mechanics)}</b></span>
          </Kpi>
          <Kpi icon={Timer} tone="indigo" label={t('dashboard.kpiCards.delivery_time')} value={fmtMins(stats.avg_minutes_period)}>
            {!stats.avg_minutes_period && <span>{t('dashboard.no_completed_in_period', 'No jobs completed {{period}}', { period: isAll ? '' : periodPhrase })}</span>}
          </Kpi>
          <Kpi icon={DollarCircle} tone="violet" label={t('dashboard.kpiCards.revenue', 'Revenue')}
            value={fmtAED(stats.revenue_period)} delta={<DeltaBadge delta={stats.delta_revenue_period} />}>
            {allTime(t('dashboard.amount_all_time', '{{amount}} all time', { amount: fmtAED(stats.revenue_all_time) }))}
          </Kpi>
          <Kpi icon={WarningTriangle} tone="slate" label={woLabel(t, 'cancelled')} value={fmtNum(cancelledVal)}>
            {allTime(t('dashboard.n_all_time', '{{n}} all time', { n: fmtNum(stats.cancelled_all_time) }))}
          </Kpi>
        </section>
      )}

      {/* Steps 1–7: what is waiting on this person's role */}
      <MyTasks />

      {widgetVis.charts && (
        <div className="dsh-grid dsh-grid-charts">
          <section className="dsh-card">
            <div className="dsh-card-head">
              <div>
                <h2>{t('dashboard.work_order_volume', 'Work Order Volume')}</h2>
                <p>{period === 'all' ? t('dashboard.monthly_volume_trend', 'Work orders and completions per month') : t('dashboard.daily_volume_trend')}</p>
              </div>
            </div>
            <div className="dsh-chart">
              {chart.some(d => d.orders > 0 || d.delivered > 0)
                ? <Line data={lineData} options={lineOptions} />
                : <div className="dsh-empty">
                    <span>{t('dashboard.no_orders_in_period', 'No new work orders {{period}} yet.', { period: periodPhrase })}</span>
                    <button type="button" onClick={() => changePeriod('all')}>{t('dashboard.show_all_time', 'Show all time')}</button>
                  </div>}
            </div>
          </section>

          <section className="dsh-card">
            <div className="dsh-card-head">
              <div>
                <h2>{t('dashboard.order_status_breakdown')}</h2>
                <p>{t('dashboard.click_slice_hint', 'Click a slice to view those work orders')}</p>
              </div>
              {/* Total of the breakdown — not a "today" figure, so the ring and
                  the number always agree. */}
              <div className="dsh-card-stat">
                <b>{fmtNum(statusTotal)}</b>
                <span>{t('dashboard.total_work_orders', 'Total Work Orders')}</span>
              </div>
            </div>
            <div className="dsh-chart">
              {statusSlices.length > 0
                ? <Doughnut data={statusData} options={doughnutOptions} />
                : <div className="dsh-empty"><span>{t('dashboard.no_work_orders', 'No work orders yet')}</span></div>}
            </div>
          </section>
        </div>
      )}

      {/* Work orders by hour (#56) */}
      {widgetVis.hourly && ordersByHour.some(h => h.orders > 0) && (
        <section className="dsh-card dsh-card-wide">
          <div className="dsh-card-head">
            <div>
              <h2>{t('dashboard.todays_activity')}</h2>
              <p>{t('dashboard.order_distribution')}</p>
            </div>
          </div>
          <div className="dsh-chart dsh-chart-short">
            <Bar
              data={{
                labels: ordersByHour.map(h => h.label),
                datasets: [
                  { label: t('dashboard.chart_orders'), data: ordersByHour.map(h => h.orders), backgroundColor: '#1e3a6b', borderRadius: 3, borderSkipped: false, maxBarThickness: 14 },
                  { label: t('dashboard.chart_delivered'), data: ordersByHour.map(h => h.delivered), backgroundColor: '#22c55e', borderRadius: 3, borderSkipped: false, maxBarThickness: 14 },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, padding: 14, color: INK_MUTED, font: { family: FONT, size: 12 } } },
                  tooltip: { ...TOOLTIP, callbacks: { title: (ctx) => `${ctx[0].label}` } },
                },
                scales: {
                  x: { border: { display: false }, grid: { display: false }, ticks: { color: INK_MUTED, font: { family: FONT, size: 11 }, maxRotation: 0, autoSkipPadding: 8 } },
                  y: { beginAtZero: true, border: { display: false }, grid: { color: GRID }, ticks: { stepSize: 1, precision: 0, color: INK_MUTED, font: { family: FONT, size: 11 } } },
                },
              }}
            />
          </div>
        </section>
      )}

      {/* Top service bays, top technicians, recent work orders */}
      {showLists && (
        <div className={`dsh-grid dsh-grid-lists cols-${listCols}`}>
          {widgetVis.service_bays && (
            <section className="dsh-card">
              <div className="dsh-card-head">
                <h2><MapPin width={16} height={16} /> {t('dashboard.top_zones')}</h2>
                {hasModule(user, 'service-bays') && <Link to="/service-bays" className="dsh-link">{t('dashboard.view_all')} <ArrowRight width={14} height={14} /></Link>}
              </div>
              {topServiceBays.length === 0 ? (
                <div className="dsh-empty dsh-empty-list"><MapPin width={22} height={22} /><span>{t('dashboard.no_zone_data')}</span></div>
              ) : (
                <ul className="dsh-list">
                  {topServiceBays.slice(0, 5).map((bay, i) => (
                    <li key={i}>
                      <span className="dsh-rank">{i + 1}</span>
                      <div className="dsh-list-text">
                        <strong>{bay.name}</strong>
                        <span>{bay.bay_type ? bay.bay_type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : bay.bay_number}</span>
                      </div>
                      <span className="dsh-pill tone-orange">{fmtNum(bay.orders_count)} {t('dashboard.orders_short', 'orders')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {widgetVis.mechanics && (
            <section className="dsh-card">
              <div className="dsh-card-head">
                <h2><Wrench width={16} height={16} /> {t('dashboard.top_mechanics')}</h2>
                {hasModule(user, 'mechanics') && <Link to="/mechanics" className="dsh-link">{t('dashboard.view_all')} <ArrowRight width={14} height={14} /></Link>}
              </div>
              {topMechanics.length === 0 ? (
                <div className="dsh-empty dsh-empty-list"><Wrench width={22} height={22} /><span>{t('dashboard.no_completed_in_period', 'No jobs completed {{period}}', { period: isAll ? '' : periodPhrase })}</span></div>
              ) : (
                <ul className="dsh-list">
                  {topMechanics.slice(0, 5).map((mechanic, i) => (
                    <li key={i}>
                      <span className="dsh-avatar">{mechanic.full_name?.charAt(0)}</span>
                      <div className="dsh-list-text">
                        <strong>{mechanic.full_name}</strong>
                        <span>{mechanic.specialty ? mechanic.specialty.replace(/_/g, ' ') : t('dashboard.technician', 'Technician')}</span>
                      </div>
                      <span className="dsh-pill tone-green">{mechanic.jobs_completed || 0} {t('dashboard.jobs_short', 'jobs')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Recent work orders feed (#53) */}
          {widgetVis.recent && (
            <section className="dsh-card">
              <div className="dsh-card-head">
                <h2><Package width={16} height={16} /> {t('dashboard.recent_orders')}</h2>
                <Link to="/work-orders" className="dsh-link">{t('dashboard.view_all')} <ArrowRight width={14} height={14} /></Link>
              </div>
              {recentWorkOrders.length === 0 ? (
                <div className="dsh-empty dsh-empty-list"><Package width={22} height={22} /><span>{t('dashboard.no_recent_orders')}</span></div>
              ) : (
                <ul className="dsh-list">
                  {recentWorkOrders.slice(0, 5).map((order) => {
                    const vehicleLabel = [order.vehicle_make, order.vehicle_model].filter(Boolean).join(' ');
                    const primary = order.customer_name || t('orders.walk_in', 'Walk-in');
                    const secondaryBits = [];
                    if (vehicleLabel) secondaryBits.push(vehicleLabel);
                    if (order.vehicle_plate_number) secondaryBits.push(order.vehicle_plate_number);
                    if (!secondaryBits.length && order.mechanic_name) secondaryBits.push(order.mechanic_name);
                    secondaryBits.push(fmtWhen(order.created_at));
                    const color = stageColor(order);
                    return (
                      <li key={order.id}>
                        <Link to={`/work-orders/${order.id}`} className="dsh-list-link">
                          <span className="dsh-stage-dot" style={{ background: color }} aria-hidden="true" />
                          <div className="dsh-list-text">
                            <strong>{primary}</strong>
                            <span>{order.work_order_number ? `${order.work_order_number} · ` : ''}{secondaryBits.join(' · ')}</span>
                          </div>
                          <span className="dsh-pill" style={{ background: `${color}14`, color }}>{woLabel(t, order, 'short')}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {quickActions.length > 0 && (
        <section className="dsh-card dsh-card-wide">
          <div className="dsh-card-head"><h2>{t('dashboard.quick_actions')}</h2></div>
          <div className="dsh-actions">
            {quickActions.map(a => (
              <Link key={a.to} to={a.to} className={`dsh-action tone-${a.tone}`}>
                <span className="dsh-action-icon" aria-hidden="true"><a.icon width={16} height={16} strokeWidth={1.8} /></span>
                <span>{a.label}</span>
                <ArrowRight width={14} height={14} className="dsh-action-arrow" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
