/* ══════════════════════════════════════════════════════════════
 * CustomerDashboard.jsx — Merchant Dashboard — Premium Modern
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import { Package, Wrench, CheckCircle, Clock, Plus, WarningTriangle, ArrowRight, Search, StatsUpSquare } from 'iconoir-react';
import api from '../../lib/customerApi';
import { StatCardSkeleton } from '../../components/Loader';
import './CustomerPages.css';

export default function CustomerDashboard() {
  const { t } = useTranslation();
  const { user, workshop } = useContext(CustomerAuthContext);
  const cur = workshop?.currency || 'AED';
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/customer-portal/stats');
        if (res.success) setStats(res.data);
        else setError('Failed to load dashboard data');
      } catch { setError('Connection error'); }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="cp-page"><StatCardSkeleton count={4} /></div>;
  }

  const s = stats || {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="cp-page">
      {error && <div className="ca-alert ca-alert-error" style={{ marginBottom: 16 }}><WarningTriangle width={16} height={16} /> {error}</div>}

      {/* Welcome banner */}
      <div className="cp-welcome-banner">
        <div className="cp-welcome-content">
          <p className="cp-welcome-greeting">{greeting},</p>
          <h1 className="cp-welcome-title">{user?.full_name || 'Merchant'}</h1>
          <p className="cp-welcome-sub">Here's your service overview for today</p>
        </div>
        <Link to="/merchant/create-order" className="cp-btn cp-btn-white">
          <Plus width={18} height={18} /> New Work Order
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="cp-kpi-grid">
        <div className="cp-kpi-card cp-kpi-blue">
          <div className="cp-kpi-icon"><Package width={26} height={26} /></div>
          <div className="cp-kpi-data">
            <span className="cp-kpi-value">{s.orders_today || 0}</span>
            <span className="cp-kpi-label">Work Orders Today</span>
          </div>
        </div>
        <div className="cp-kpi-card cp-kpi-orange">
          <div className="cp-kpi-icon"><Wrench width={26} height={26} /></div>
          <div className="cp-kpi-data">
            <span className="cp-kpi-value">{s.in_progress || 0}</span>
            <span className="cp-kpi-label">In Progress</span>
          </div>
        </div>
        <div className="cp-kpi-card cp-kpi-green">
          <div className="cp-kpi-icon"><CheckCircle width={26} height={26} /></div>
          <div className="cp-kpi-data">
            <span className="cp-kpi-value">{s.completed || 0}</span>
            <span className="cp-kpi-label">Completed</span>
          </div>
        </div>
        <div className="cp-kpi-card cp-kpi-red">
          <div className="cp-kpi-icon"><WarningTriangle width={26} height={26} /></div>
          <div className="cp-kpi-data">
            <span className="cp-kpi-value">{s.cancelled || 0}</span>
            <span className="cp-kpi-label">Cancelled</span>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="cp-stats-row">
        <div className="cp-stat-card">
          <div className="cp-stat-card-header">
            <h3 className="cp-stat-title">Work Order Summary</h3>
            <Link to="/merchant/work-orders" className="cp-stat-link">View all <ArrowRight width={14} height={14} /></Link>
          </div>
          <div className="cp-stat-grid">
            <div className="cp-stat-item">
              <span className="cp-stat-num">{s.total_work_orders || 0}</span>
              <span className="cp-stat-lbl">Total Work Orders</span>
            </div>
            <div className="cp-stat-item">
              <span className="cp-stat-num">{s.pending || 0}</span>
              <span className="cp-stat-lbl">Pending</span>
            </div>
            <div className="cp-stat-item">
              <span className="cp-stat-num">{s.assigned || 0}</span>
              <span className="cp-stat-lbl">Assigned</span>
            </div>
            <div className="cp-stat-item">
              <span className="cp-stat-num">{s.ready_for_pickup || 0}</span>
              <span className="cp-stat-lbl">Ready for Pickup</span>
            </div>
            <div className="cp-stat-item">
              <span className="cp-stat-num">{s.cancelled || 0}</span>
              <span className="cp-stat-lbl">Cancelled</span>
            </div>
          </div>
        </div>

        <div className="cp-stat-card">
          <div className="cp-stat-card-header">
            <h3 className="cp-stat-title">Financial Overview</h3>
            <Link to="/merchant/wallet" className="cp-stat-link">Wallet <ArrowRight width={14} height={14} /></Link>
          </div>
          <div className="cp-stat-grid">
            <div className="cp-stat-item">
              <span className="cp-stat-num cp-stat-currency">{cur} {Number(s.total_service_fees || 0).toLocaleString()}</span>
              <span className="cp-stat-lbl">Total Service Fees</span>
            </div>
            <div className="cp-stat-item">
              <span className="cp-stat-num cp-stat-currency">{cur} {Number(s.total_cash || 0).toLocaleString()}</span>
              <span className="cp-stat-lbl">Total Cash</span>
            </div>
            <div className="cp-stat-item">
              <span className="cp-stat-num cp-stat-currency">{cur} {Number(s.spend_this_month || 0).toLocaleString()}</span>
              <span className="cp-stat-lbl">This Month</span>
            </div>
            <div className="cp-stat-item">
              <span className="cp-stat-num">{s.orders_this_month || 0}</span>
              <span className="cp-stat-lbl">Work Orders This Month</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="cp-quick-actions">
        <h3 className="cp-section-title">Quick Actions</h3>
        <div className="cp-action-grid">
          <Link to="/merchant/create-order" className="cp-action-card">
            <div className="cp-action-icon-wrap cp-action-orange"><Plus width={24} height={24} /></div>
            <div>
              <span className="cp-action-title">Book a Service</span>
              <span className="cp-action-desc">New work order</span>
            </div>
          </Link>
          <Link to="/merchant/service-status" className="cp-action-card">
            <div className="cp-action-icon-wrap cp-action-green"><Search width={24} height={24} /></div>
            <div>
              <span className="cp-action-title">Track Service</span>
              <span className="cp-action-desc">Real-time status</span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
