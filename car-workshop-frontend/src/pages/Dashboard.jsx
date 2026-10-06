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
  Package, DeliveryTruck, Check, WarningTriangle, DollarCircle,
  Clock, MapPin, StatUp, StatDown, ArrowRight, Plus, Activity,
  Timer, Wallet, Refresh, Settings, Wrench
} from 'iconoir-react';
import { AuthContext } from '../context/AuthContext';
import api from '../lib/api';
import { fmtCurrency } from '../utils/currency';
import './Dashboard.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const AUTO_REFRESH_MS = 30000; // 30 seconds

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
    try { return localStorage.getItem('dashboard_period') === 'week' ? 'week' : 'month'; } catch { return 'month'; }
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
    : t('dashboard.this_month', 'This Month');
  // Deltas compare against the previous period, not yesterday
  const vsLabel = period === 'week'
    ? t('dashboard.vs_last_week', 'vs last week')
    : t('dashboard.vs_last_month', 'vs last month');

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
  const fmtMins = (m) => {
    if (!m || m <= 0) return '—';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r > 0 ? `${h}h ${r}m` : `${h}h`;
  };

  const DeltaBadge = ({ delta }) => {
    if (delta === undefined || delta === null) return null;
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
    labels: chart.map(d => new Date(d.date).toLocaleDateString(undefined,
      chart.length > 7 ? { day: 'numeric', month: 'short' } : { weekday: 'short' })),
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

  const statusLabel = (s) => t(`statuses.${s}`, s);
  const statusColor = (s) => {
    const map = { completed: '#22c55e', cancelled: '#94a3b8', in_progress: '#3b82f6', inspection: '#7c3aed', assigned: '#8b5cf6', accepted: '#1565C0', ready_for_pickup: '#f97316', pending: '#d97706', confirmed: '#0ea5e9' };
    return map[s] || '#64748b';
  };

  /* Status breakdown — one slice per actual status, in lifecycle order, so a
     slice maps 1:1 onto a work-order status and can drill through to the list
     filtered by exactly that status. Empty statuses are dropped. */
  const STATUS_ORDER = ['pending','confirmed','assigned','accepted','in_progress','inspection','ready_for_pickup','completed','cancelled'];
  const statusSlices = STATUS_ORDER
    .map(s => ({ status: s, count: Number(ordersByStatus.find(r => r.status === s)?.count || 0) }))
    .filter(s => s.count > 0);
  const statusTotal = statusSlices.reduce((sum, s) => sum + s.count, 0);

  const statusData = {
    labels: statusSlices.map(s => statusLabel(s.status)),
    datasets: [{
      data: statusSlices.map(s => s.count),
      backgroundColor: statusSlices.map(s => statusColor(s.status)),
      borderWidth: 0,
    }]
  };

  // Carry the dashboard's period into the list, so the row count the user
  // lands on matches the slice they clicked.
  const goToStatus = (status) => {
    const range = periodRange
      ? `&date_from=${periodRange.start_date}&date_to=${periodRange.end_date}`
      : '';
    navigate(`/work-orders?status=${status}${range}`);
  };

  const doughnutOptions = {
    responsive: true, maintainAspectRatio: false, cutout: '70%',
    // Click a slice (or its legend entry) to open the work-order list already
    // filtered to that status.
    onClick: (_evt, elements) => {
      const slice = statusSlices[elements?.[0]?.index];
      if (slice) goToStatus(slice.status);
    },
    onHover: (evt, elements) => {
      if (evt?.native?.target) evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: {
        position: 'right',
        onClick: (_e, item) => {
          const slice = statusSlices[item?.index];
          if (slice) goToStatus(slice.status);
        },
        labels: {
          usePointStyle: true,
          padding: 12,
          // Show the count next to each status so the breakdown is readable
          // without hovering
          generateLabels: (chart) => {
            const ds = chart.data.datasets[0] || { data: [], backgroundColor: [] };
            return (chart.data.labels || []).map((label, i) => ({
              text: `${label} — ${ds.data[i]}`,
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
            return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
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
              { k: 'month', label: t('dashboard.this_month', 'This Month') }].map(opt => (
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
              {periodRange.start_date} → {periodRange.end_date}
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
          <Link to="/work-orders" className="btn-primary">
            <Plus width={18} height={18} />
            {t('dashboard.new_order')}
          </Link>
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

      {/* Key Metrics Row — 6 cards now (#42 monthly revenue, #48 avg delivery time) */}
      {widgetVis.metrics && (() => {
        // Freshly imported datasets can have every WO dated in the past,
        // which leaves every "This Month" tile at 0. Fall back to all-time
        // figures so the dashboard actually shows the workshop's backlog.
        const usePeriod = (stats.orders_period || 0) > 0;
        const scopeLabel = usePeriod ? periodLabel : t('dashboard.all_time', 'All time');
        const ordersVal = usePeriod ? (stats.orders_period || 0) : (stats.total_orders_all_time || 0);
        const completedVal = usePeriod ? (stats.completed_period || 0) : (stats.completed_orders_all_time || 0);
        const revenueVal = usePeriod ? (stats.revenue_period || 0) : (stats.revenue_all_time || 0);
        const cancelledVal = usePeriod ? (stats.cancelled_period || 0) : Math.max(0, (stats.total_orders_all_time || 0) - (stats.completed_orders_all_time || 0) - (stats.active_orders_all_time || 0));
        return (
        <div className="metrics-row">
        <div className="metric-card primary">
          <div className="metric-icon" style={{ background: 'rgba(242,66,27,0.1)', color: '#159fd9' }}>
            <Package width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{ordersVal}</span>
            <span className="metric-label">{t('dashboard.kpiCards.orders_period', 'Work Orders')} · {scopeLabel}</span>
          </div>
          {usePeriod && <DeltaBadge delta={stats.delta_orders_period} />}
          <div className="metric-trend positive">
            <StatUp width={14} height={14} />
            <span>{t('dashboard.active_label')}: {stats.active_orders_all_time || stats.active_orders || 0}</span>
          </div>
        </div>

        <div className="metric-card success">
          <div className="metric-icon" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
            <Check width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{completedVal}</span>
            <span className="metric-label">{t('dashboard.kpiCards.completed_orders')} · {scopeLabel}</span>
          </div>
          <DeltaBadge delta={stats.delta_completed_period} />
          <div className="metric-trend positive">
            <StatUp width={14} height={14} />
            <span>{t('dashboard.rate_label')}: {stats.success_rate_period || 0}%</span>
          </div>
        </div>

        <div className="metric-card tertiary">
          <div className="metric-icon" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
            <Wrench width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{stats.available_mechanics || 0}<span style={{ fontSize: 13, fontWeight: 500, color: '#94a3b8' }}>/{stats.total_mechanics || 0}</span></span>
            <span className="metric-label">{t('dashboard.kpiCards.active_mechanics')}</span>
          </div>
          <div className="metric-trend">
            <Activity width={14} height={14} />
            <span>{t('dashboard.pending_label')}: {stats.pending_orders || 0}</span>
          </div>
        </div>

        <div className="metric-card info">
          <div className="metric-icon" style={{ background: 'rgba(102,126,234,0.1)', color: '#667eea' }}>
            <Timer width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{fmtMins(stats.avg_minutes_period)}</span>
            <span className="metric-label">{t('dashboard.kpiCards.delivery_time')}</span>
          </div>
          <div className="metric-trend">
            <Clock width={14} height={14} />
            <span>{periodLabel}</span>
          </div>
        </div>

        <div className="metric-card secondary">
          <div className="metric-icon" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>
            <DollarCircle width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value" style={{ fontSize: 17 }}>{fmtAED(revenueVal)}</span>
            <span className="metric-label">{t('dashboard.kpiCards.revenue', 'Revenue')} · {scopeLabel}</span>
          </div>
          {usePeriod && <DeltaBadge delta={stats.delta_revenue_period} />}
        </div>

        {/* The fixed "Revenue This Month" tile was removed — the revenue tile
            above already follows the period switcher, so on the month view the
            two showed the identical figure. */}
        <div className="metric-card accent">
          <div className="metric-icon" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
            <Wallet width={24} height={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{cancelledVal}</span>
            <span className="metric-label">{t('statuses.cancelled')} · {scopeLabel}</span>
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
              <p>{t('dashboard.daily_volume_trend')}</p>
            </div>
          </div>
          <div className="chart-body">
            <Line data={lineData} options={lineOptions} />
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
            <span className="total-value">{statusTotal}</span>
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
            <Link to="/service-bays" className="view-all">{t('dashboard.view_all')} <ArrowRight width={16} height={16} /></Link>
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
                      {bay.orders_count || 0} orders
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}

        {widgetVis.mechanics && topMechanics.length > 0 && (
        <div className="recent-card">
          <div className="card-header">
            <h3><DeliveryTruck width={20} height={20} /> {t('dashboard.top_mechanics')}</h3>
            <Link to="/mechanics" className="view-all">{t('dashboard.view_all')} <ArrowRight width={16} height={16} /></Link>
          </div>
          <div className="card-body">
            <div className="recent-list">
              {topMechanics.slice(0, 5).map((mechanic, i) => (
                <div key={i} className="recent-item">
                  <div className="recent-avatar">
                    {mechanic.full_name?.charAt(0)}
                  </div>
                  <div className="recent-info">
                    <strong>{mechanic.full_name}</strong>
                    <span>{mechanic.specialty ? mechanic.specialty.replace(/_/g, ' ') : t('dashboard.mechanic')}</span>
                  </div>
                  <span className="status-badge active"
                    style={{ background: '#f0fdf4', color: '#16a34a' }}>
                    {mechanic.jobs_completed || mechanic.total_deliveries || 0} {t('dashboard.jobs_short', 'jobs')}
                  </span>
                </div>
              ))}
            </div>
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
                  const primary = order.recipient_name || order.customer_name || t('orders.walk_in', 'Walk-in');
                  const secondaryBits = [];
                  if (vehicleLabel) secondaryBits.push(vehicleLabel);
                  if (order.vehicle_plate_number) secondaryBits.push(order.vehicle_plate_number);
                  if (!secondaryBits.length && order.mechanic_name) secondaryBits.push(order.mechanic_name);
                  secondaryBits.push(new Date(order.created_at).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true }));
                  return (
                    <div key={order.id} className="recent-item">
                      <div className="recent-avatar" style={{ background: statusColor(order.status), fontSize: 10 }}>
                        {order.work_order_number?.slice(-3) || '#'}
                      </div>
                      <div className="recent-info">
                        <strong>{primary}</strong>
                        <span>{secondaryBits.join(' \u00B7 ')}</span>
                      </div>
                      <span className="status-badge" style={{ background: `${statusColor(order.status)}18`, color: statusColor(order.status) }}>
                        {statusLabel(order.status)}
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
          <Link to="/work-orders" className="quick-action-card">
            <div className="quick-action-icon"><Package width={24} height={24} /></div>
            <span>{t('dashboard.new_order')}</span>
          </Link>
          <Link to="/mechanics" className="quick-action-card">
            <div className="quick-action-icon"><DeliveryTruck width={24} height={24} /></div>
            <span>{t('dashboard.add_mechanic')}</span>
          </Link>
          <Link to="/job-assignment" className="quick-action-card">
            <div className="quick-action-icon"><MapPin width={24} height={24} /></div>
            <span>{t('dashboard.job-assignment')}</span>
          </Link>
          <Link to="/service-tracking" className="quick-action-card">
            <div className="quick-action-icon" style={{ background: '#e0f2fe' }}><MapPin width={24} height={24} color="#0369a1" /></div>
            <span>{t('dashboard.track_shipments')}</span>
          </Link>
          <Link to="/live-map" className="quick-action-card">
            <div className="quick-action-icon" style={{ background: '#fce7f3' }}><MapPin width={24} height={24} color="#be185d" /></div>
            <span>{t('dashboard.live_map')}</span>
          </Link>
          <Link to="/customers" className="quick-action-card">
            <div className="quick-action-icon"><Activity width={24} height={24} /></div>
            <span>{t('dashboard.customers')}</span>
          </Link>
          <Link to="/bulk-import" className="quick-action-card">
            <div className="quick-action-icon" style={{ background: '#ede9fe' }}><Package width={24} height={24} color="#7c3aed" /></div>
            <span>{t('dashboard.bulk_import')}</span>
          </Link>
          <Link to="/wallet" className="quick-action-card">
            <div className="quick-action-icon"><DollarCircle width={24} height={24} /></div>
            <span>{t('dashboard.wallet')}</span>
          </Link>
          <Link to="/reports" className="quick-action-card">
            <div className="quick-action-icon"><StatUp width={24} height={24} /></div>
            <span>{t('dashboard.reports')}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
