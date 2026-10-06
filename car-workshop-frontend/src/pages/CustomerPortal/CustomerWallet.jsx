/* ══════════════════════════════════════════════════════════════
 * CustomerWallet.jsx — Wallet Balance + COD Summary
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useContext } from 'react';
import { Wallet, DollarCircle, ArrowDown, ArrowUp, Calendar, Refresh } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import './CustomerPages.css';
import { StatCardSkeleton, TableSkeleton } from '../../components/Loader';
const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function CustomerWallet() {
  const { workshop } = useContext(CustomerAuthContext);
  const cur = workshop?.currency || 'AED';
  const [wallet, setWallet]     = useState(null);
  const [codData, setCodData]   = useState(null);
  const [loading, setLoading]   = useState(true);

  const token = localStorage.getItem('crm_token');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [walletRes, codRes] = await Promise.all([
        fetch(`${API_URL}/customer-portal/wallet`, { headers, credentials: 'include' }),
        fetch(`${API_URL}/customer-portal/cash-summary`, { headers, credentials: 'include' }),
      ]);
      if (walletRes.status === 401) { window.location.href = '/merchant/login'; return; }
      const walletData = await walletRes.json();
      const codDataJson = await codRes.json();
      if (walletData.success) setWallet(walletData.data);
      if (codDataJson.success) setCodData(codDataJson.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmt = (n) => parseFloat(n || 0).toFixed(2);

  if (loading) return <div className="cp-page"><StatCardSkeleton count={3} /><TableSkeleton rows={4} cols={4} /></div>;

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <h1 className="cp-page-title">Wallet & COD</h1>
        <button className="cp-btn cp-btn-outline" onClick={fetchData}>
          <Refresh width={16} height={16} /> Refresh
        </button>
      </div>

      {/* Balance Cards */}
      <div className="cp-kpi-grid">
        <div className="cp-kpi-card" style={{ borderLeft: '4px solid #f97316' }}>
          <div className="cp-kpi-icon" style={{ background: '#fff7ed', color: '#f97316' }}>
            <Wallet width={22} height={22} />
          </div>
          <div>
            <p className="cp-kpi-label">Wallet Balance</p>
            <h3 className="cp-kpi-value">{cur} {fmt(wallet?.wallet_balance)}</h3>
          </div>
        </div>

        <div className="cp-kpi-card" style={{ borderLeft: '4px solid #22c55e' }}>
          <div className="cp-kpi-icon" style={{ background: '#f0fdf4', color: '#22c55e' }}>
            <ArrowDown width={22} height={22} />
          </div>
          <div>
            <p className="cp-kpi-label">Total COD Collected</p>
            <h3 className="cp-kpi-value">{cur} {fmt(codData?.collected)}</h3>
          </div>
        </div>

        <div className="cp-kpi-card" style={{ borderLeft: '4px solid #3b82f6' }}>
          <div className="cp-kpi-icon" style={{ background: '#eff6ff', color: '#3b82f6' }}>
            <ArrowUp width={22} height={22} />
          </div>
          <div>
            <p className="cp-kpi-label">Total Settled</p>
            <h3 className="cp-kpi-value">{cur} {fmt(wallet?.cod_balance?.cod_settled)}</h3>
          </div>
        </div>

        <div className="cp-kpi-card" style={{ borderLeft: '4px solid #eab308' }}>
          <div className="cp-kpi-icon" style={{ background: '#fefce8', color: '#eab308' }}>
            <DollarCircle width={22} height={22} />
          </div>
          <div>
            <p className="cp-kpi-label">Pending Settlement</p>
            <h3 className="cp-kpi-value">{cur} {fmt(codData?.outstanding)}</h3>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      {wallet?.transactions?.length > 0 && (
        <div className="cp-card" style={{ marginTop: 24 }}>
          <h3 className="cp-card-title">Recent Transactions</h3>
          <div className="cp-table-wrap">
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {wallet.transactions.map(tx => (
                  <tr key={tx.id}>
                    <td>
                      <Calendar width={14} height={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                      {new Date(tx.created_at).toLocaleDateString()}
                    </td>
                    <td><span className={`cp-badge ${tx.type === 'credit' ? 'cp-badge-success' : 'cp-badge-error'}`}>{tx.type}</span></td>
                    <td className="cp-detail-sub">{tx.description || '—'}</td>
                    <td style={{ fontWeight: 600, color: tx.type === 'credit' ? '#22c55e' : '#ef4444' }}>
                      {tx.type === 'credit' ? '+' : '-'} {cur} {fmt(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* COD orders breakdown */}
      {codData?.recent_orders?.length > 0 && (
        <div className="cp-card" style={{ marginTop: 24 }}>
          <h3 className="cp-card-title">COD WorkOrders</h3>
          <div className="cp-table-wrap">
            <table className="cp-table">
              <thead>
                <tr>
                  <th>WorkOrder #</th>
                  <th>Recipient</th>
                  <th>COD Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {codData.recent_orders.map(o => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 600 }}>{o.work_order_number}</td>
                    <td>{o.recipient_name}</td>
                    <td>{cur} {fmt(o.cash_amount)}</td>
                    <td><span className={`cp-status-badge status-${o.status}`}>{o.status?.replace(/_/g, ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
