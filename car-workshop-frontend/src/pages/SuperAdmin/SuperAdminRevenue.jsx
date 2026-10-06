import { useState, useEffect } from 'react';
import {
  Cash, GraphUp, Building, Refresh, Calendar,
  CheckCircle, Clock, WarningTriangle
} from 'iconoir-react';
import './SuperAdmin.css';
import { StatCardSkeleton, ChartSkeleton } from '../../components/Loader';

const API = import.meta.env.VITE_API_URL || '/api';
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('superAdminToken')}` });

const SuperAdminRevenue = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('AED');

  useEffect(() => { fetchRevenue(); }, []);

  const fetchRevenue = async () => {
    setLoading(true);
    try {
      const [res, settingsRes] = await Promise.all([
        fetch(`${API}/super-admin/revenue`, { headers: headers() }),
        fetch(`${API}/super-admin/settings`, { headers: headers() }),
      ]);
      if (res.ok) setData(await res.json());
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setCurrency(s.default_currency || 'AED');
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const fmtCur = (n) => `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmt = (n) => Number(n || 0).toLocaleString();

  if (loading) return <div className="sa-revenue"><StatCardSkeleton count={3} /><ChartSkeleton height={200} /></div>;

  const { mrr = 0, arr = 0, totalRevenue = 0, outstanding = {}, revenueByMonth = [], revenueByPlan = [], topPayers = [], planDistribution = [] } = data || {};

  // Find max for chart bars
  const maxMonthly = Math.max(...revenueByMonth.map(m => parseFloat(m.revenue) || 0), 1);

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>Revenue Dashboard</h1>
          <p>Financial overview and revenue analytics</p>
        </div>
        <button className="sa-primary-btn" onClick={fetchRevenue}>
          <Refresh size={16} /> Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="sa-stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="sa-stat-card">
          <div className="sa-stat-icon primary"><Cash size={22} /></div>
          <div className="sa-stat-content">
            <h3>{fmtCur(mrr)}</h3>
            <p>Monthly Recurring (MRR)</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon success"><GraphUp size={22} /></div>
          <div className="sa-stat-content">
            <h3>{fmtCur(arr)}</h3>
            <p>Annual Recurring (ARR)</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon info"><CheckCircle size={22} /></div>
          <div className="sa-stat-content">
            <h3>{fmtCur(totalRevenue)}</h3>
            <p>Total Revenue</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon warning"><Clock size={22} /></div>
          <div className="sa-stat-content">
            <h3>{fmtCur(outstanding.amount)}</h3>
            <p>Outstanding ({outstanding.count || 0} invoices)</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Revenue by Month Chart */}
        <div className="sa-card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 20px' }}>Revenue by Month</h3>
          {revenueByMonth.length === 0 ? (
            <div className="sa-empty-state" style={{ padding: 40 }}>
              <Calendar size={36} />
              <p>No revenue data yet</p>
            </div>
          ) : (
            <div className="sa-chart-bars">
              {revenueByMonth.map(m => (
                <div key={m.month} className="sa-chart-bar-group">
                  <div className="sa-chart-bar-label">{fmtCur(m.revenue)}</div>
                  <div className="sa-chart-bar-container">
                    <div className="sa-chart-bar" style={{ height: `${(parseFloat(m.revenue) / maxMonthly) * 180}px` }} />
                  </div>
                  <div className="sa-chart-bar-month">{m.month}</div>
                  <div className="sa-chart-bar-count">{m.invoices_paid} inv</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Plan Distribution */}
        <div className="sa-card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 20px' }}>Plan Distribution</h3>
          {planDistribution.map(p => {
            const total = planDistribution.reduce((sum, x) => sum + (x.count || 0), 0) || 1;
            const pct = ((p.count / total) * 100).toFixed(0);
            const colors = { trial: '#6b7280', starter: '#3b82f6', professional: '#8b5cf6', enterprise: '#f59e0b', self_hosted: '#10b981' };
            return (
              <div key={p.plan} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 14 }}>
                  <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{p.plan}</span>
                  <span style={{ color: '#6b7280' }}>{p.count} ({pct}%)</span>
                </div>
                <div style={{ background: '#f1f5f9', borderRadius: 8, height: 10, overflow: 'hidden' }}>
                  <div style={{ background: colors[p.plan] || '#6b7280', width: `${pct}%`, height: '100%', borderRadius: 8, transition: 'width 0.5s' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Revenue by Plan */}
        <div className="sa-card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px' }}>Revenue by Plan</h3>
          <div className="sa-table-container">
            <table className="sa-table">
              <thead>
                <tr><th>Plan</th><th>Workshops</th><th>Monthly Rev</th></tr>
              </thead>
              <tbody>
                {revenueByPlan.map(p => (
                  <tr key={p.plan}>
                    <td><span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{p.plan}</span></td>
                    <td>{p.workshop_count}</td>
                    <td><strong>{fmtCur(p.monthly_revenue)}</strong></td>
                  </tr>
                ))}
                {revenueByPlan.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: '#9ca3af', padding: 20 }}>No active subscriptions</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Payers */}
        <div className="sa-card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px' }}>Top Payers</h3>
          <div className="sa-table-container">
            <table className="sa-table">
              <thead>
                <tr><th>Workshop</th><th>Plan</th><th>Total Paid</th></tr>
              </thead>
              <tbody>
                {topPayers.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div>
                        <strong>{p.name}</strong>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{p.status}</div>
                      </div>
                    </td>
                    <td><span style={{ textTransform: 'capitalize' }}>{p.plan || '—'}</span></td>
                    <td><strong>{fmtCur(p.total_paid)}</strong></td>
                  </tr>
                ))}
                {topPayers.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: '#9ca3af', padding: 20 }}>No payment data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminRevenue;
