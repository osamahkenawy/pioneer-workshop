import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import {
  CreditCard, Search, Check, Xmark, Eye, Clock, Download,
  DeliveryTruck, User, Package, DollarCircle, Calendar,
  Wallet, RefreshDouble, WarningCircle
} from 'iconoir-react';
import { api } from '../lib/api';
import './CashPayments.css';
import { useTranslation } from 'react-i18next';
import Toast, { useToast } from '../components/Toast';
import { AuthContext } from '../context/AuthContext';
import { downloadCsv, toCsv, csvCell } from '../utils/csv';

function formatCurrency(amount, currency = 'AED') {
  return `${currency} ${parseFloat(amount || 0).toFixed(2)}`;
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function CashPayments() {
  const { t } = useTranslation();
  const [orders, setWorkOrders] = useState([]);
  const [mechanics, setMechanics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mechanicFilter, setMechanicFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [showSettleModal, setShowSettleModal] = useState(null);
  const [settling, setSettling] = useState(false);
  const { toasts, showToast } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ payment_method: 'cod', limit: 500 });
      if (mechanicFilter) params.set('mechanic_id', mechanicFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const [ordersRes, mechanicsRes] = await Promise.all([
        api.get(`/work-orders?${params}`),
        api.get('/mechanics')
      ]);
      setWorkOrders(ordersRes?.data || []);
      setMechanics(mechanicsRes?.data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [mechanicFilter, dateFrom, dateTo]);

  useEffect(() => { loadData(); }, [loadData]);

  // Calculate stats
  const stats = useMemo(() => {
    const s = {
      total_cod: 0, collected: 0, pending: 0, settled: 0,
      total_orders: orders.length, delivered_cod: 0
    };
    orders.forEach(o => {
      const amt = parseFloat(o.cash_amount || 0);
      s.total_cod += amt;
      if (o.status === 'delivered') {
        s.delivered_cod++;
        if (o.cash_collected === 2) {
          s.settled += amt;
        } else {
          s.collected += amt;
        }
      } else if (['pending','confirmed','assigned','picked_up','in_transit'].includes(o.status)) {
        s.pending += amt;
      }
    });
    return s;
  }, [orders]);

  // Mechanic COD aggregation
  const mechanicCOD = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      if (!o.mechanic_id) return;
      if (!map[o.mechanic_id]) {
        map[o.mechanic_id] = {
          mechanic_id: o.mechanic_id,
          mechanic_name: o.mechanic_name || 'Unknown',
          mechanic_phone: o.mechanic_phone || '',
          total_collected: 0,
          total_settled: 0,
          total_pending: 0,
          order_count: 0,
          delivered_count: 0,
        };
      }
      const d = map[o.mechanic_id];
      const amt = parseFloat(o.cash_amount || 0);
      d.order_count++;
      if (o.status === 'delivered') {
        d.delivered_count++;
        if (o.cash_collected === 2) {
          d.total_settled += amt;
        } else {
          d.total_collected += amt;
        }
      } else if (['assigned','picked_up','in_transit'].includes(o.status)) {
        d.total_pending += amt;
      }
    });
    return Object.values(map).sort((a, b) => b.total_collected - a.total_collected);
  }, [orders]);

  // Filtered orders for table view
  const filtered = useMemo(() => {
    let list = orders;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(o =>
        o.work_order_number?.toLowerCase().includes(s) ||
        o.recipient_name?.toLowerCase().includes(s) ||
        o.mechanic_name?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [orders, search]);

  const handleSettle = async (mechanicId) => {
    setSettling(true);
    try {
      const res = await api.post('/cash-payments/settle', { mechanic_id: mechanicId });
      if (res.success) {
        setShowSettleModal(null);
        showToast(res.message || t('cod.modal.success'), 'success');
        loadData();
      } else {
        showToast(res.message || t('cod.settle_failed', 'Settlement failed'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(err?.message || t('cod.settle_failed', 'Settlement failed'), 'error');
    }
    finally { setSettling(false); }
  };

  const exportCSV = () => {
    const headers = [t('cod.col.order'), t('cod.col.recipient'), t('cod.col.mechanic'), t('cod.col.amount'), t('cod.col.status'), t('cod.col.date')];
    const rows = filtered.map(o => [
      o.work_order_number, o.recipient_name, o.mechanic_name || t('cod.unassigned'),
      parseFloat(o.cash_amount || 0).toFixed(2), o.status,
      o.created_at ? new Date(o.created_at).toLocaleDateString() : ''
    ]);
    // SR-15 — was headers.join(',') with no escaping at all: a comma in a
    // recipient name shifted every later column, and a value starting with
    // = or + was evaluated as a formula when the export was opened.
    downloadCsv(`cod_report_${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
  };

  const { workshop } = useContext(AuthContext);
  const curr = workshop?.currency || 'AED';
  const statCards = [
    { label: t('cod.stats.total'), value: formatCurrency(stats.total_cod, curr), color: 'primary', bg: '#fff7ed', iconColor: '#f97316', icon: CreditCard },
    { label: t('cod.stats.collected'), value: formatCurrency(stats.collected, curr), color: 'success', bg: '#dcfce7', iconColor: '#16a34a', icon: Check },
    { label: t('cod.stats.pending'), value: formatCurrency(stats.pending, curr), color: 'warning', bg: '#fef3c7', iconColor: '#d97706', icon: Clock },
    { label: t('cod.stats.orders'), value: orders.filter(o => o.payment_method === 'cod').length, color: 'info', bg: '#eff6ff', iconColor: '#2563eb', icon: Package },
  ];

  return (
    <>
    <div className="cod-page">
      {/* Hero */}
      <div className="module-hero">
        <div className="module-hero-left">
          <div className="module-hero-icon"><CreditCard size={26} /></div>
          <div>
            <h1 className="module-hero-title">{t("cod.title")}</h1>
            <p className="module-hero-sub">{t('cod.subtitle')}</p>
          </div>
        </div>
        <div className="module-hero-actions">
          <button className="module-btn module-btn-outline" onClick={exportCSV}>
            <Download size={16} /> {t('cod.export_report')}
          </button>
          <button className="module-btn module-btn-outline" onClick={loadData}>
            <RefreshDouble size={16} /> {t('cod.refresh')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="cod-stats-grid">
        {statCards.map((s, i) => (
          <div key={i} className={`cod-stat-card ${s.color}`}>
            <div className="cod-stat-card-row">
              <div className="cod-stat-icon" style={{ background: s.bg }}>
                <s.icon size={22} color={s.iconColor} />
              </div>
              <div className="cod-stat-body">
                <span className="cod-stat-val">{s.value}</span>
                <span className="cod-stat-lbl">{s.label}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="cod-tabs">
        {[
          { key: 'overview', label: t('cod.tabs.overview') },
          { key: 'orders', label: t('cod.tabs.orders') },
        ].map(tab => (
          <button key={tab.key} className={`cod-tab ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
        ))}
      </div>

      {/* Filters */}
      <div className="cod-filters">
        <div className="cod-search-wrap">
          <Search size={16} className="cod-search-icon" />
          <input className="cod-search-input" placeholder={t('cod.search_placeholder')}
                 value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="cod-filter-select" value={mechanicFilter} onChange={e => setMechanicFilter(e.target.value)}>
          <option value="">{t("cod.all_mechanics")}</option>
          {mechanics.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
        <input type="date" className="cod-date-input" value={dateFrom}
               onChange={e => setDateFrom(e.target.value)} placeholder={t('cod.from')} />
        <input type="date" className="cod-date-input" value={dateTo}
               onChange={e => setDateTo(e.target.value)} placeholder={t('cod.to')} />
      </div>

      {loading ? <div className="cod-spinner" /> : (
        <>
          {/* Tab: Mechanic Overview */}
          {activeTab === 'overview' && (
            mechanicCOD.length === 0 ? (
              <div className="cod-empty">
                <div className="cod-empty-icon"><DeliveryTruck size={28} /></div>
                <h3>{t('cod.no_data')}</h3>
                <p>{t('cod.no_mechanics')}</p>
              </div>
            ) : (
              <div className="cod-mechanic-grid">
                {mechanicCOD.map(d => {
                  const balance = d.total_collected;
                  const topClass = balance > 0 ? 'owe' : d.total_pending > 0 ? 'partial' : 'clear';
                  return (
                    <div key={d.mechanic_id} className="cod-mechanic-card">
                      <div className={`cod-mechanic-card-top ${topClass}`} />
                      <div className="cod-mechanic-card-body">
                        <div className="cod-mechanic-header">
                          <div className="cod-mechanic-avatar">
                            {d.mechanic_name?.charAt(0) || 'D'}
                          </div>
                          <div>
                            <div className="cod-mechanic-name">{d.mechanic_name}</div>
                            <div className="cod-mechanic-phone">{d.mechanic_phone || t('cod.no_phone')}</div>
                          </div>
                        </div>
                        <div className="cod-mechanic-stats">
                          <div className="cod-mechanic-stat">
                            <div className="cod-mechanic-stat-label">{t('cod.mechanic.collected')}</div>
                            <div className="cod-mechanic-stat-value" style={{ color: d.total_collected > 0 ? '#f97316' : '#16a34a' }}>
                              {formatCurrency(d.total_collected, curr)}
                            </div>
                          </div>
                          <div className="cod-mechanic-stat">
                            <div className="cod-mechanic-stat-label">{t('cod.mechanic.pending')}</div>
                            <div className="cod-mechanic-stat-value" style={{ color: '#d97706' }}>
                              {formatCurrency(d.total_pending, curr)}
                            </div>
                          </div>
                          <div className="cod-mechanic-stat">
                            <div className="cod-mechanic-stat-label">{t('cod.mechanic.orders')}</div>
                            <div className="cod-mechanic-stat-value">{d.order_count}</div>
                          </div>
                          <div className="cod-mechanic-stat">
                            <div className="cod-mechanic-stat-label">{t('cod.mechanic.delivered')}</div>
                            <div className="cod-mechanic-stat-value">{d.delivered_count}</div>
                          </div>
                        </div>
                        {d.total_settled > 0 && (
                          <div style={{ padding: '6px 16px', fontSize: 12, color: '#16a34a', background: '#f0fdf4', borderRadius: 6, margin: '0 16px 8px', textAlign: 'center', fontWeight: 600 }}>
                            {t('cod.mechanic.already_settled')}: {formatCurrency(d.total_settled, curr)}
                          </div>
                        )}
                        <div className="cod-mechanic-actions">
                          <button className="cod-mechanic-btn" onClick={() => { setMechanicFilter(String(d.mechanic_id)); setActiveTab('orders'); }}>
                            <Eye size={14} /> {t('cod.view_orders')}
                          </button>
                          {d.total_collected > 0 ? (
                            <button className="cod-mechanic-btn settle" onClick={() => setShowSettleModal(d)}>
                              <Check size={14} /> {t('cod.settle')}
                            </button>
                          ) : (
                            <span style={{ padding: '6px 16px', fontSize: 12, color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Check size={14} /> {t('cod.all_settled')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Tab: COD WorkOrders */}
          {activeTab === 'orders' && (
            filtered.length === 0 ? (
              <div className="cod-empty">
                <div className="cod-empty-icon"><Package size={28} /></div>
                <h3>{t('cod.no_orders')}</h3>
                <p>{t('cod.no_orders_sub')}</p>
              </div>
            ) : (
              <div className="cod-table-wrap">
                <table className="cod-table">
                  <thead>
                    <tr>
                      <th>{t('cod.col.order')}</th>
                      <th>{t('cod.col.recipient')}</th>
                      <th>{t('cod.col.mechanic')}</th>
                      <th>{t('cod.col.amount')}</th>
                      <th>{t('cod.col.service_fee')}</th>
                      <th>{t('cod.col.status')}</th>
                      <th>{t('cod.col.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(order => (
                      <tr key={order.id}>
                        <td style={{ fontWeight: 700, color: '#f97316', fontFamily: 'monospace' }}>
                          {order.work_order_number}
                        </td>
                        <td style={{ fontWeight: 600 }}>{order.recipient_name}</td>
                        <td style={{ color: order.mechanic_name ? '#1e293b' : '#94a3b8' }}>
                          {order.mechanic_name || t('cod.unassigned')}
                        </td>
                        <td>
                          <span className={`cod-amount ${order.status === 'delivered' ? 'collected' : 'pending'}`}>
                            {formatCurrency(order.cash_amount, curr)}
                          </span>
                        </td>
                        <td style={{ color: '#64748b' }}>{formatCurrency(order.service_fee, curr)}</td>
                        <td>
                          <span className={`cod-settlement-status ${
                            order.cash_collected >= 2 ? 'settled'
                            : order.status === 'delivered' ? 'collected' : 'pending'
                          }`}>
                            <span className="cod-settlement-dot" />
                            {order.cash_collected >= 2
                              ? t('cod.status.settled', { defaultValue: 'Settled' })
                              : order.status === 'delivered'
                                ? t('cod.status.collected')
                                : t('cod.status.pending')}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                          {formatDateTime(order.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}

      {/* Settlement Modal */}
      {showSettleModal && (
        <div className="cod-modal-overlay" onClick={() => setShowSettleModal(null)}>
          <div className="cod-modal" onClick={e => e.stopPropagation()}>
            <div className="cod-modal-header">
              <h3><Wallet size={18} /> {t('cod.modal.title', { mechanicName: showSettleModal.mechanic_name })}</h3>
              <button className="cod-modal-close" onClick={() => setShowSettleModal(null)}><Xmark size={16} /></button>
            </div>
            <div className="cod-modal-body">
              <div className="cod-summary-row">
                <span className="cod-summary-label">{t('cod.modal.total_collected')}</span>
                <span className="cod-summary-value" style={{ color: '#16a34a' }}>
                  {formatCurrency(showSettleModal.total_collected, curr)}
                </span>
              </div>
              <div className="cod-summary-row">
                <span className="cod-summary-label">{t('cod.modal.delivered_orders')}</span>
                <span className="cod-summary-value">{showSettleModal.delivered_count}</span>
              </div>
              <div className="cod-summary-row" style={{ background: '#fff7ed', borderColor: '#fed7aa' }}>
                <span className="cod-summary-label" style={{ fontWeight: 700, color: '#1e293b' }}>{t('cod.modal.amount_to_settle')}</span>
                <span className="cod-summary-value" style={{ color: '#f97316', fontSize: 22 }}>
                  {formatCurrency(showSettleModal.total_collected, curr)}
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 12, textAlign: 'center' }}>
                {t('cod.modal.confirm_text', { mechanicName: showSettleModal.mechanic_name })}
              </p>
            </div>
            <div className="cod-modal-footer">
              <button className="cod-btn-secondary" onClick={() => setShowSettleModal(null)}>{t('cod.cancel')}</button>
              <button className="cod-btn-success" onClick={() => handleSettle(showSettleModal.mechanic_id)} disabled={settling}>
                {settling ? t('cod.settling') : <><Check size={14} /> {t('cod.confirm_settlement')}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    <Toast toasts={toasts} />
  </>
  );
}
