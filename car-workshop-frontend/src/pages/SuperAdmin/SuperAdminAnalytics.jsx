import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Building, User, Package, CheckCircle, Clock,
  Xmark, DeliveryTruck, GraphUp, StatsReport, Refresh,
  Calendar, Cash
} from 'iconoir-react';
import './SuperAdmin.css';
import { StatCardSkeleton, ChartSkeleton } from '../../components/Loader';
import { useSAToast } from './SAToastContext';

const API = import.meta.env.VITE_API_URL || '/api';

const SuperAdminAnalytics = () => {
  const { t } = useTranslation();
  const showToast = useSAToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('AED');

  useEffect(() => { fetchAnalytics(); }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('superAdminToken');
      const hdrs = { Authorization: `Bearer ${token}` };
      const [res, settingsRes] = await Promise.all([
        fetch(`${API}/super-admin/analytics`, { headers: hdrs }),
        fetch(`${API}/super-admin/settings`, { headers: hdrs }),
      ]);
      if (res.ok) setData(await res.json());
      else showToast('Failed to load analytics', 'error');
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setCurrency(s.default_currency || 'AED');
      }
    } catch (e) {
      console.error('Analytics fetch failed:', e);
      showToast('Connection error loading analytics', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n) => Number(n || 0).toLocaleString();
  const fmtCur = (n) => `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (loading) {
    return (
      <div className="sa-analytics">
        <StatCardSkeleton count={6} />
        <ChartSkeleton height={200} />
      </div>
    );
  }

  const { workshops = {}, users = {}, orders = {}, ordersByMonth = [], topWorkshops = [], activeSessions = 0 } = data || {};

  const deliveryRate = orders.total_orders > 0
    ? ((orders.delivered / orders.total_orders) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>Platform Analytics</h1>
          <p>Comprehensive overview of platform performance</p>
        </div>
        <button className="sa-primary-btn" onClick={fetchAnalytics}>
          <Refresh size={18} />
          <span>Refresh</span>
        </button>
      </div>

      {/* KPI Cards Row 1 */}
      <div className="sa-stats-grid sa-stats-5">
        <div className="sa-stat-card">
          <div className="sa-stat-icon primary"><Building size={22} /></div>
          <div className="sa-stat-content">
            <h3>{fmt(workshops.total_workshops)}</h3>
            <p>Total Workshops</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon success"><User size={22} /></div>
          <div className="sa-stat-content">
            <h3>{fmt(users.total_users)}</h3>
            <p>Total Users</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon info"><Package size={22} /></div>
          <div className="sa-stat-content">
            <h3>{fmt(orders.total_orders)}</h3>
            <p>Total WorkOrders</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon accent"><Cash size={22} /></div>
          <div className="sa-stat-content">
            <h3>{fmtCur(orders.total_revenue)}</h3>
            <p>Total Revenue</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon warning"><GraphUp size={22} /></div>
          <div className="sa-stat-content">
            <h3>{activeSessions}</h3>
            <p>Active (24h)</p>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="sa-analytics-grid">

        {/* Workshop Breakdown */}
        <div className="sa-card">
          <div className="sa-card-header"><h2>Workshop Status</h2></div>
          <div className="sa-breakdown-list">
            <div className="sa-breakdown-item">
              <div className="sa-breakdown-label"><span className="sa-dot success" /> Active</div>
              <div className="sa-breakdown-bar">
                <div className="sa-bar-fill success" style={{ width: `${workshops.total_workshops ? (workshops.active / workshops.total_workshops * 100) : 0}%` }} />
              </div>
              <span className="sa-breakdown-val">{fmt(workshops.active)}</span>
            </div>
            <div className="sa-breakdown-item">
              <div className="sa-breakdown-label"><span className="sa-dot warning" /> Trial</div>
              <div className="sa-breakdown-bar">
                <div className="sa-bar-fill warning" style={{ width: `${workshops.total_workshops ? (workshops.trial / workshops.total_workshops * 100) : 0}%` }} />
              </div>
              <span className="sa-breakdown-val">{fmt(workshops.trial)}</span>
            </div>
            <div className="sa-breakdown-item">
              <div className="sa-breakdown-label"><span className="sa-dot danger" /> Suspended</div>
              <div className="sa-breakdown-bar">
                <div className="sa-bar-fill danger" style={{ width: `${workshops.total_workshops ? (workshops.suspended / workshops.total_workshops * 100) : 0}%` }} />
              </div>
              <span className="sa-breakdown-val">{fmt(workshops.suspended)}</span>
            </div>
          </div>
        </div>

        {/* User Breakdown */}
        <div className="sa-card">
          <div className="sa-card-header"><h2>User Roles</h2></div>
          <div className="sa-breakdown-list">
            <div className="sa-breakdown-item">
              <div className="sa-breakdown-label"><span className="sa-dot primary" /> Admins</div>
              <div className="sa-breakdown-bar">
                <div className="sa-bar-fill primary" style={{ width: `${users.total_users ? (users.admins / users.total_users * 100) : 0}%` }} />
              </div>
              <span className="sa-breakdown-val">{fmt(users.admins)}</span>
            </div>
            <div className="sa-breakdown-item">
              <div className="sa-breakdown-label"><span className="sa-dot info" /> Service Advisors</div>
              <div className="sa-breakdown-bar">
                <div className="sa-bar-fill info" style={{ width: `${users.total_users ? (users.dispatchers / users.total_users * 100) : 0}%` }} />
              </div>
              <span className="sa-breakdown-val">{fmt(users.dispatchers)}</span>
            </div>
            <div className="sa-breakdown-item">
              <div className="sa-breakdown-label"><span className="sa-dot success" /> Mechanics</div>
              <div className="sa-breakdown-bar">
                <div className="sa-bar-fill success" style={{ width: `${users.total_users ? (users.mechanics / users.total_users * 100) : 0}%` }} />
              </div>
              <span className="sa-breakdown-val">{fmt(users.mechanics)}</span>
            </div>
            <div className="sa-breakdown-item">
              <div className="sa-breakdown-label"><span className="sa-dot secondary" /> Active</div>
              <div className="sa-breakdown-bar">
                <div className="sa-bar-fill secondary" style={{ width: `${users.total_users ? (users.active_users / users.total_users * 100) : 0}%` }} />
              </div>
              <span className="sa-breakdown-val">{fmt(users.active_users)}</span>
            </div>
          </div>
        </div>

        {/* WorkOrder Performance */}
        <div className="sa-card">
          <div className="sa-card-header"><h2>WorkOrder Performance</h2></div>
          <div className="sa-perf-stats">
            <div className="sa-perf-circle">
              <svg viewBox="0 0 36 36" className="sa-circular-chart">
                <path className="sa-circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path className="sa-circle-fg" strokeDasharray={`${deliveryRate}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <text x="18" y="20.35" className="sa-circle-text">{deliveryRate}%</text>
              </svg>
              <p>Delivery Rate</p>
            </div>
            <div className="sa-perf-details">
              <div className="sa-perf-row"><span>Delivered</span><strong>{fmt(orders.delivered)}</strong></div>
              <div className="sa-perf-row"><span>In Progress</span><strong>{fmt(orders.in_progress)}</strong></div>
              <div className="sa-perf-row"><span>Pending</span><strong>{fmt(orders.pending)}</strong></div>
              <div className="sa-perf-row"><span>Cancelled</span><strong>{fmt(orders.cancelled)}</strong></div>
              <div className="sa-perf-row sa-perf-highlight"><span>Avg WorkOrder Value</span><strong>{fmtCur(orders.avg_order_value)}</strong></div>
            </div>
          </div>
        </div>

        {/* Monthly Trend */}
        <div className="sa-card">
          <div className="sa-card-header"><h2>Monthly Trend (Last 6 Months)</h2></div>
          {ordersByMonth.length === 0 ? (
            <div className="sa-empty-state">No data for the selected period</div>
          ) : (
            <div className="sa-bar-chart">
              {ordersByMonth.map((m) => {
                const maxWorkOrders = Math.max(...ordersByMonth.map(x => x.orders), 1);
                return (
                  <div key={m.month} className="sa-bar-col">
                    <div className="sa-bar-value">{m.orders}</div>
                    <div className="sa-bar-track">
                      <div className="sa-bar-inner" style={{ height: `${(m.orders / maxWorkOrders) * 100}%` }} />
                    </div>
                    <div className="sa-bar-label">{m.month.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top Workshops Table */}
      <div className="sa-card">
        <div className="sa-card-header"><h2>Top Workshops by WorkOrders</h2></div>
        <div className="sa-table-wrapper">
          <table className="sa-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Workshop</th>
                <th>Status</th>
                <th>Users</th>
                <th>WorkOrders</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topWorkshops.length === 0 ? (
                <tr><td colSpan="6" className="sa-empty-row">No data</td></tr>
              ) : topWorkshops.map((tt, i) => (
                <tr key={tt.id}>
                  <td><span className="sa-rank">{i + 1}</span></td>
                  <td>
                    <div className="sa-workshop-name">
                      <div className="sa-workshop-avatar">{tt.name?.charAt(0)}</div>
                      <span>{tt.name}</span>
                    </div>
                  </td>
                  <td><span className={`sa-status-badge ${tt.status === 'active' ? 'success' : tt.status === 'trial' ? 'warning' : 'danger'}`}>{tt.status}</span></td>
                  <td>{fmt(tt.users)}</td>
                  <td><strong>{fmt(tt.order_count)}</strong></td>
                  <td>{fmtCur(tt.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminAnalytics;
