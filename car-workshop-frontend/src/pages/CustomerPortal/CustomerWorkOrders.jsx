/* ══════════════════════════════════════════════════════════════
 * CustomerWorkOrders.jsx — Merchant WorkOrders List
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import { Search, Plus, Download, Eye, Xmark } from 'iconoir-react';
import api from '../../lib/customerApi';
import { Skeleton } from '../../components/Loader';
import './CustomerPages.css';

const STATUS_COLORS = {
  pending: '#f59e0b', confirmed: '#3b82f6', assigned: '#8b5cf6', accepted: '#1565C0',
  in_progress: '#0e7490', ready_for_pickup: '#c2410c', completed: '#10b981', failed: '#ef4444', cancelled: '#94a3b8',
};

export default function CustomerWorkOrders() {
  const { t } = useTranslation();
  const { workshop } = useContext(CustomerAuthContext);
  const cur = workshop?.currency || 'AED';
  const [orders, setWorkOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [filters, setFilters] = useState({ status: '', search: '', page: 1 });

  const fetchWorkOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      params.set('page', filters.page);
      params.set('limit', '20');

      const res = await api.get(`/customer-portal/work-orders?${params}`);
      if (res.success) {
        setWorkOrders(res.data);
        setPagination(res.pagination);
      }
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { fetchWorkOrders(); }, [filters.status, filters.page, filters.search]);

  const handleSearch = (e) => {
    e.preventDefault();
    setFilters(f => ({ ...f, page: 1 }));
  };

  const cancelOrder = async (id) => {
    if (!confirm('Cancel this order?')) return;
    const res = await api.delete(`/customer-portal/work-orders/${id}`);
    if (res.success) fetchWorkOrders();
    else alert(res.message || 'Failed to cancel');
  };

  const downloadLabel = async (id, orderNum) => {
    try {
      const token = localStorage.getItem('crm_token');
      const API_URL = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${API_URL}/customer-portal/work-orders/${id}/invoice`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      if (!res.ok) { alert('Failed to generate document'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `work-order-${orderNum}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { alert('Download failed'); }
  };

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <h1 className="cp-page-title">My Work Orders</h1>
        <Link to="/merchant/create-order" className="cp-btn cp-btn-primary">
          <Plus width={16} height={16} /> New Work Order
        </Link>
      </div>

      {/* Filters */}
      <div className="cp-filters-bar">
        <form className="cp-search-box" onSubmit={handleSearch}>
          <Search width={16} height={16} />
          <input
            className="cp-search-input"
            placeholder="Search by work order #, customer, tracking..."
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          />
        </form>
        <select
          className="cp-filter-select"
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}
        >
          <option value="">All Statuses</option>
          {Object.keys(STATUS_COLORS).map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="cp-table-wrap">
        <table className="cp-table">
          <thead>
            <tr>
              <th>Work Order #</th>
              <th>Vehicle</th>
              <th>Status</th>
              <th>Type</th>
              <th>Cash</th>
              <th>Fee</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }, (_, i) => (
                <tr key={i}>{Array.from({ length: 8 }, (_, c) => <td key={c}><Skeleton height={14} radius={4} /></td>)}</tr>
              ))
            ) : orders.length === 0 ? (
              <tr><td colSpan={8} className="cp-empty-row">No orders found. <Link to="/merchant/create-order">Create your first order</Link></td></tr>
            ) : orders.map(o => (
              <tr key={o.id}>
                <td><span className="cp-order-num">{o.work_order_number}</span></td>
                <td>
                  <div className="cp-cell-stack">
                    <span className="cp-cell-main">{o.vehicle_make ? `${o.vehicle_make} ${o.vehicle_model}` : '—'}</span>
                    <span className="cp-cell-sub">{o.vehicle_plate || ''}</span>
                  </div>
                </td>
                <td>
                  <span className="cp-status-badge" style={{ background: STATUS_COLORS[o.status] + '18', color: STATUS_COLORS[o.status], borderColor: STATUS_COLORS[o.status] + '40' }}>
                    {o.status?.replace(/_/g, ' ')}
                  </span>
                </td>
                <td>{o.work_order_type}</td>
                <td>{o.payment_method === 'cash' ? `${cur} ${o.cash_amount}` : '—'}</td>
                <td>{cur} {o.service_fee}</td>
                <td>
                  <div className="cp-cell-stack">
                    <span className="cp-cell-sub">{new Date(o.created_at).toLocaleDateString()}</span>
                    {o.completed_at && (
                      <span className="cp-cell-sub" style={{ color: '#10b981', fontWeight: 600 }}>
                        Completed: {new Date(o.completed_at).toLocaleDateString()} {new Date(o.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="cp-actions">
                    <Link to={`/merchant/work-orders/${o.id}`} className="cp-action-btn" title="View">
                      <Eye width={16} height={16} />
                    </Link>
                    <button className="cp-action-btn" title="Download Label" onClick={() => downloadLabel(o.id, o.work_order_number)}>
                      <Download width={16} height={16} />
                    </button>
                    {['pending', 'confirmed'].includes(o.status) && (
                      <button className="cp-action-btn cp-action-danger" title="Cancel" onClick={() => cancelOrder(o.id)}>
                        <Xmark width={16} height={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="cp-pagination">
          <button disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>Prev</button>
          <span>Page {filters.page} of {pagination.pages}</span>
          <button disabled={filters.page >= pagination.pages} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>Next</button>
        </div>
      )}
    </div>
  );
}
