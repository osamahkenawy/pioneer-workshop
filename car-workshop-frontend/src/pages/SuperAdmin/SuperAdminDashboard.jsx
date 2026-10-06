import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Building, User, CheckCircle, Clock, DollarCircle,
  Plus, Eye, ArrowRight, ArrowUp, ArrowDown,
  GraphUp, Trophy, WarningTriangle, Bell, StatsReport,
  Calendar, Group, ShieldAlert, Package
} from 'iconoir-react';
import Chart from 'react-apexcharts';
import SEO from '../../components/SEO';
import { StatCardSkeleton, CardListSkeleton } from '../../components/Loader';
import { useSAToast } from './SAToastContext';
import { SAStatCard, SABadge } from './components';
import { formatDate, formatRelative } from './utils/dateFormat';
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
import './SuperAdmin.css';

const PLAN_COLORS = ['#14284d', '#f97316', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#94a3b8'];

const SuperAdminDashboard = () => {
  const { t } = useTranslation();
  const showToast = useSAToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('AED');

  useEffect(() => { fetchDashboard(); }, []);

  const fetchDashboard = async () => {
    try {
      const token = localStorage.getItem('superAdminToken');
      const hdrs = { Authorization: `Bearer ${token}` };
      const [res, settingsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/super-admin/dashboard`, { headers: hdrs }),
        fetch(`${API_BASE_URL}/super-admin/settings`, { headers: hdrs }),
      ]);
      if (res.ok) {
        setData(await res.json());
      } else {
        showToast('Failed to load dashboard', 'error');
      }
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setCurrency(s.default_currency || 'AED');
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      showToast('Connection error loading dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'success';
      case 'trial': return 'warning';
      case 'suspended': return 'danger';
      default: return 'secondary';
    }
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getActivityDot = (action) => {
    if (!action) return 'default';
    if (action.includes('signup') || action.includes('create')) return 'signup';
    if (action.includes('order')) return 'order';
    if (action.includes('ticket')) return 'ticket';
    return 'default';
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case 'warning': return <Clock size={18} />;
      case 'danger': return <ShieldAlert size={18} />;
      case 'info': return <Bell size={18} />;
      default: return <WarningTriangle size={18} />;
    }
  };

  // ── Chart configs ──
  const revenueChartOpts = useMemo(() => {
    if (!data?.revenueByMonth?.length) return null;
    const months = data.revenueByMonth.map(r => {
      const [y, m] = r.month.split('-');
      return new Date(y, m - 1).toLocaleDateString('en', { month: 'short' });
    });
    return {
      options: {
        chart: { type: 'area', toolbar: { show: false }, sparkline: { enabled: false }, fontFamily: 'inherit' },
        colors: ['#14284d'],
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } },
        stroke: { curve: 'smooth', width: 2.5 },
        dataLabels: { enabled: false },
        xaxis: { categories: months, labels: { style: { colors: '#94a3b8', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '11px' }, formatter: v => `${(v / 1000).toFixed(0)}k` } },
        grid: { borderColor: '#f1f5f9', strokeDashArray: 3 },
        tooltip: { y: { formatter: v => `${currency} ${Number(v).toLocaleString()}` } },
      },
      series: [{ name: 'Revenue', data: data.revenueByMonth.map(r => Number(r.revenue) || 0) }]
    };
  }, [data?.revenueByMonth, currency]);

  const workshopGrowthChartOpts = useMemo(() => {
    if (!data?.workshopGrowthByMonth?.length) return null;
    const months = data.workshopGrowthByMonth.map(r => {
      const [y, m] = r.month.split('-');
      return new Date(y, m - 1).toLocaleDateString('en', { month: 'short' });
    });
    return {
      options: {
        chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
        colors: ['#f97316'],
        plotOptions: { bar: { borderRadius: 6, columnWidth: '55%' } },
        dataLabels: { enabled: false },
        xaxis: { categories: months, labels: { style: { colors: '#94a3b8', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '11px' } } },
        grid: { borderColor: '#f1f5f9', strokeDashArray: 3 },
        tooltip: { y: { formatter: v => `${v} workshops` } },
      },
      series: [{ name: 'New Workshops', data: data.workshopGrowthByMonth.map(r => Number(r.new_workshops) || 0) }]
    };
  }, [data?.workshopGrowthByMonth]);

  const planChartOpts = useMemo(() => {
    if (!data?.planDistribution?.length) return null;
    const labels = data.planDistribution.map(p => p.plan_name === 'none' ? 'No Plan' : (p.plan_name || 'Unknown'));
    const values = data.planDistribution.map(p => Number(p.count) || 0);
    return {
      options: {
        chart: { type: 'donut', fontFamily: 'inherit' },
        colors: PLAN_COLORS.slice(0, labels.length),
        labels,
        legend: { show: false },
        dataLabels: { enabled: false },
        stroke: { width: 2, colors: ['#fff'] },
        plotOptions: { pie: { donut: { size: '72%', labels: { show: true, total: { show: true, label: 'Total', fontSize: '13px', fontWeight: 500, color: '#94a3b8', formatter: w => w.globals.seriesTotals.reduce((a, b) => a + b, 0) } } } } },
        tooltip: { y: { formatter: v => `${v} workshops` } },
      },
      series: values
    };
  }, [data?.planDistribution]);

  const kpi = data?.kpi || {};
  const adminName = (() => {
    try {
      const u = JSON.parse(localStorage.getItem('superAdminUser') || '{}');
      return u.full_name || u.username || 'Admin';
    } catch { return 'Admin'; }
  })();

  if (loading) {
    return (
      <div className="sa-dashboard">
        <StatCardSkeleton count={4} />
        <CardListSkeleton count={5} />
      </div>
    );
  }

  return (
    <div className="sa-dashboard">
      <SEO page="superAdminDashboard" noindex={true} />

      {/* ── Welcome Banner ── */}
      <div className="sa-welcome-banner">
        <div className="sa-welcome-info">
          <h1>{getGreeting()}, {adminName}</h1>
          <p>{new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div className="sa-welcome-actions">
          <Link to="/super-admin/workshops" className="sa-welcome-btn primary">
            <Plus size={16} /> New Workshop
          </Link>
          <Link to="/super-admin/analytics" className="sa-welcome-btn ghost">
            <GraphUp size={16} /> Analytics
          </Link>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="sa-stats-grid-v2">
        <SAStatCard
          icon={Building}
          value={kpi.total_workshops || 0}
          label="Total Workshops"
          trend={kpi.workshop_growth ? `${kpi.workshop_growth > 0 ? '+' : ''}${kpi.workshop_growth}%` : undefined}
          color="primary"
        />
        <SAStatCard
          icon={CheckCircle}
          value={kpi.active_workshops || 0}
          label="Active Workshops"
          color="success"
        />
        <SAStatCard
          icon={DollarCircle}
          value={`${currency} ${Number(kpi.mrr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          label="Monthly Revenue"
          color="warning"
        />
        <SAStatCard
          icon={Package}
          value={kpi.total_orders || 0}
          label="Total WorkOrders"
          trend={kpi.order_growth ? `${kpi.order_growth > 0 ? '+' : ''}${kpi.order_growth}%` : undefined}
          color="info"
        />
      </div>

      {/* ── Quick Stats Row ── */}
      <div className="sa-quick-stats">
        <div className="sa-quick-stat"><Clock size={15} /> <strong>{kpi.trial_workshops || 0}</strong> Trials</div>
        <div className="sa-quick-stat"><User size={15} /> <strong>{kpi.total_users || 0}</strong> Users</div>
        <div className="sa-quick-stat"><ShieldAlert size={15} /> <strong>{kpi.suspended_workshops || 0}</strong> Suspended</div>
      </div>

      {/* ── Revenue Chart + Workshop Growth ── */}
      <div className="sa-dash-grid two-col">
        <div className="sa-chart-card">
          <div className="sa-chart-card-header">
            <div>
              <h3>Revenue Overview</h3>
              <p className="sa-chart-subtitle">Last 6 months</p>
            </div>
            <Link to="/super-admin/analytics" className="sa-link">Details <ArrowRight size={14} /></Link>
          </div>
          {revenueChartOpts ? (
            <Chart options={revenueChartOpts.options} series={revenueChartOpts.series} type="area" height={280} />
          ) : (
            <div className="sa-feed-empty">
              <GraphUp size={32} />
              <p>No revenue data yet</p>
            </div>
          )}
        </div>

        <div className="sa-chart-card">
          <div className="sa-chart-card-header">
            <div>
              <h3>Workshop Growth</h3>
              <p className="sa-chart-subtitle">New signups per month</p>
            </div>
          </div>
          {workshopGrowthChartOpts ? (
            <Chart options={workshopGrowthChartOpts.options} series={workshopGrowthChartOpts.series} type="bar" height={280} />
          ) : (
            <div className="sa-feed-empty">
              <Building size={32} />
              <p>No workshop growth data</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Activity Feed + Plan Distribution + Alerts ── */}
      <div className="sa-dash-grid three-col">
        {/* Activity Feed */}
        <div className="sa-chart-card">
          <div className="sa-chart-card-header">
            <h3>Recent Activity</h3>
            <Link to="/super-admin/activity-log" className="sa-link">View All <ArrowRight size={14} /></Link>
          </div>
          {data?.recentActivity?.length > 0 ? (
            <ul className="sa-activity-feed">
              {data.recentActivity.slice(0, 8).map((a, i) => (
                <li key={a.id || i} className="sa-activity-item">
                  <div className={`sa-activity-dot ${getActivityDot(a.action)}`} />
                  <div className="sa-activity-content">
                    <div className="sa-activity-text">
                      <strong>{a.workshop_name || a.user_name || 'System'}</strong>{' '}
                      {a.details || a.action}
                    </div>
                    <div className="sa-activity-time">{formatRelative(a.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="sa-feed-empty">
              <StatsReport size={32} />
              <p>No recent activity</p>
            </div>
          )}
        </div>

        {/* Plan Distribution */}
        <div className="sa-chart-card">
          <div className="sa-chart-card-header">
            <h3>Plan Distribution</h3>
          </div>
          {planChartOpts ? (
            <>
              <Chart options={planChartOpts.options} series={planChartOpts.series} type="donut" height={200} />
              <div className="sa-plan-legend">
                {data.planDistribution.map((p, i) => (
                  <div key={p.plan_name} className="sa-plan-legend-item">
                    <div className="sa-plan-legend-left">
                      <div className="sa-plan-legend-dot" style={{ background: PLAN_COLORS[i] || '#94a3b8' }} />
                      <span className="sa-plan-legend-name">{p.plan_name === 'none' ? 'No Plan' : (p.plan_name || 'Unknown')}</span>
                    </div>
                    <span className="sa-plan-legend-count">{p.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="sa-feed-empty">
              <Group size={32} />
              <p>No plan data</p>
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="sa-chart-card">
          <div className="sa-chart-card-header">
            <h3>Alerts</h3>
          </div>
          {data?.alerts?.length > 0 ? (
            <div className="sa-alerts-list">
              {data.alerts.map((alert, i) => (
                <Link key={i} to={alert.link || '#'} className="sa-alert-item">
                  <div className={`sa-alert-icon ${alert.type}`}>
                    {getAlertIcon(alert.type)}
                  </div>
                  <div className="sa-alert-info">
                    <div className="sa-alert-title">{alert.title}</div>
                    <div className="sa-alert-message">{alert.message}</div>
                  </div>
                  <ArrowRight size={16} color="#94a3b8" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="sa-feed-empty">
              <CheckCircle size={32} />
              <p>No active alerts — all clear!</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Workshops Cards + Top Workshops Leaderboard ── */}
      <div className="sa-dash-grid two-col">
        {/* Recent Workshops — Card Grid */}
        <div className="sa-chart-card">
          <div className="sa-chart-card-header">
            <h3>Recent Workshops</h3>
            <Link to="/super-admin/workshops" className="sa-link">View All <ArrowRight size={14} /></Link>
          </div>
          {data?.recentWorkshops?.length > 0 ? (
            <div className="sa-workshop-cards">
              {data.recentWorkshops.map(workshop => (
                <Link key={workshop.id} to={`/super-admin/workshops/${workshop.id}`} className="sa-workshop-card">
                  <div className="sa-workshop-card-top">
                    <div className="sa-workshop-card-avatar">{workshop.name?.charAt(0)}</div>
                    <div className="sa-workshop-card-info">
                      <h4>{workshop.name}</h4>
                      <span>{workshop.industry || workshop.email}</span>
                    </div>
                    <SABadge color={getStatusColor(workshop.status)} size="sm">{workshop.status}</SABadge>
                  </div>
                  <div className="sa-workshop-card-meta">
                    <div className="sa-workshop-card-stat"><User size={13} /> <strong>{workshop.user_count || 0}</strong> users</div>
                    <div className="sa-workshop-card-stat"><Calendar size={13} /> {formatDate(workshop.created_at)}</div>
                    {workshop.plan && <SABadge color="primary" size="sm">{workshop.plan}</SABadge>}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="sa-feed-empty">
              <Building size={32} />
              <p>No workshops yet. Create your first workshop to get started.</p>
            </div>
          )}
        </div>

        {/* Top Performing Workshops */}
        <div className="sa-chart-card">
          <div className="sa-chart-card-header">
            <div>
              <h3>Top Workshops</h3>
              <p className="sa-chart-subtitle">By order count</p>
            </div>
            <Link to="/super-admin/analytics" className="sa-link">Details <ArrowRight size={14} /></Link>
          </div>
          {data?.topWorkshops?.length > 0 ? (
            <ul className="sa-leaderboard">
              {data.topWorkshops.map((workshop, i) => (
                <li key={workshop.id} className="sa-leaderboard-item">
                  <div className={`sa-leaderboard-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'default'}`}>
                    {i + 1}
                  </div>
                  <div className="sa-leaderboard-info">
                    <div className="sa-leaderboard-name">{workshop.name}</div>
                    <div className="sa-leaderboard-meta">{workshop.users || 0} users · <SABadge color={getStatusColor(workshop.status)} size="sm">{workshop.status}</SABadge></div>
                  </div>
                  <div className="sa-leaderboard-stat">
                    <strong>{workshop.order_count}</strong>
                    <span>{currency} {Number(workshop.revenue || 0).toLocaleString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="sa-feed-empty">
              <Trophy size={32} />
              <p>No order data yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SuperAdminDashboard;

