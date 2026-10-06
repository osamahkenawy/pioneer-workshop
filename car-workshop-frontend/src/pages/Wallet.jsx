import { useState, useEffect, useCallback, useContext } from 'react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { StatCardSkeleton, TableSkeleton } from '../components/Loader';
import './Wallet.css';
import { useTranslation } from 'react-i18next';
import {
  CardWallet, HandCash, Coins, GraphUp, GraphDown,
  ReceiveDollars, WarningTriangle, CheckCircle, InfoCircle,
  XmarkCircle, Box3dCenter as Package
} from 'iconoir-react';

/* ── Type → badge map ─────────────────────────────────── */
const TX_BADGE = {
  topup:            { bg: '#dcfce7', color: '#16a34a', label: 'wallet.type_topup' },
  credit:           { bg: '#dcfce7', color: '#16a34a', label: 'wallet.type_credit' },
  debit:            { bg: '#fee2e2', color: '#dc2626', label: 'wallet.type_debit' },
  cash_collected:    { bg: '#dbeafe', color: '#1d4ed8', label: 'wallet.type_cash_collected' },
  cod_settled:      { bg: '#fef3c7', color: '#d97706', label: 'wallet.type_cod_settled' },
  charge:           { bg: '#fee2e2', color: '#dc2626', label: 'wallet.type_charge' },
  withdrawal:       { bg: '#fef3c7', color: '#d97706', label: 'wallet.type_withdrawal' },
  hold:             { bg: '#f3e8ff', color: '#7c3aed', label: 'wallet.type_hold' },
  release:          { bg: '#e0f2fe', color: '#0284c7', label: 'wallet.type_release' },
  prepaid_settled:  { bg: '#fef3c7', color: '#d97706', label: 'wallet.type_prepaid_settled' },
};

const PER_PAGE = 20;

export default function Wallet() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';

  const fmtAED = (v) => `${cur} ${parseFloat(v || 0).toFixed(2)}`;

  /* ── State ─────────────────────────────────────────── */
  const [wallet,       setWallet]       = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [codWorkOrders,    setCodWorkOrders]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [activeTab,    setActiveTab]    = useState('transactions');
  const [showTopup,    setShowTopup]    = useState(false);
  const [showSettle,   setShowSettle]   = useState(false);
  const [topupForm,    setTopupForm]    = useState({ amount: '', reference: '', description: '' });
  const [settleForm,   setSettleForm]   = useState({ amount: '', reference: '', note: '' });
  const [collectOrder, setCollectOrder] = useState(null);
  const [collectAmt,   setCollectAmt]   = useState('');
  const [saving,       setSaving]       = useState(false);
  const [page,         setPage]         = useState(1);
  const [flash,        setFlash]        = useState(null);

  /* ── Flash message helper ──────────────────────────── */
  const showFlash = (type, msg) => {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), 4000);
  };

  /* ── Data fetching ─────────────────────────────────── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [wRes, tRes, cRes] = await Promise.all([
        api.get('/wallet'),
        api.get('/wallet/transactions'),
        api.get('/wallet/cash-orders'),
      ]);
      if (wRes.success) setWallet(wRes.data);
      if (tRes.success) setTransactions(tRes.data || []);
      if (cRes.success) setCodWorkOrders(cRes.data || []);
    } catch (e) { /* silently handle */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── Actions ───────────────────────────────────────── */
  const handleTopup = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/wallet/topup', topupForm);
      if (res.success) {
        setShowTopup(false);
        setTopupForm({ amount: '', reference: '', description: '' });
        showFlash('success', t('wallet.topup_success'));
        fetchAll();
      } else {
        showFlash('error', t('wallet.topup_failed'));
      }
    } catch { showFlash('error', t('wallet.topup_failed')); }
    setSaving(false);
  };

  const handleSettle = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/wallet/settle-cod', settleForm);
      if (res.success) {
        setShowSettle(false);
        setSettleForm({ amount: '', reference: '', note: '' });
        showFlash('success', t('wallet.settle_success'));
        fetchAll();
      } else {
        showFlash('error', t('wallet.settle_failed'));
      }
    } catch { showFlash('error', t('wallet.settle_failed')); }
    setSaving(false);
  };

  const handleCollectCOD = async () => {
    if (!collectOrder || !collectAmt) return;
    setSaving(true);
    try {
      const res = await api.post('/wallet/collect-cod', {
        work_order_id: collectOrder.id,
        amount: collectAmt,
        note: t('wallet.cash_collected_note', { work_order_number: collectOrder.work_order_number }),
      });
      if (res.success) {
        setCollectOrder(null);
        setCollectAmt('');
        showFlash('success', t('wallet.collect_success'));
        fetchAll();
      } else {
        showFlash('error', t('wallet.collect_failed'));
      }
    } catch { showFlash('error', t('wallet.collect_failed')); }
    setSaving(false);
  };

  /* ── Derived ───────────────────────────────────────── */
  const paged      = transactions.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.ceil(transactions.length / PER_PAGE);
  const pendingCOD   = codWorkOrders.filter(o => !o.cash_collected);
  const collectedCOD = codWorkOrders.filter(o => o.cash_collected);

  /* ── Stats cards config ────────────────────────────── */
  const stats = [
    { label: t('wallet.available_balance'), value: fmtAED(wallet?.balance),       color: 'orange', Icon: CardWallet,      iconBg: '#fff7ed', iconColor: '#f97316' },
    { label: t('wallet.cod_pending'),       value: fmtAED(wallet?.cod_pending),    color: 'blue',   Icon: Package,         iconBg: '#eff6ff', iconColor: '#3b82f6' },
    { label: t('wallet.total_credited'),    value: fmtAED(wallet?.total_credited), color: 'green',  Icon: GraphUp,         iconBg: '#f0fdf4', iconColor: '#16a34a' },
    { label: t('wallet.total_debited'),     value: fmtAED(wallet?.total_debited),  color: 'red',    Icon: GraphDown,       iconBg: '#fef2f2', iconColor: '#dc2626' },
    { label: t('wallet.transactions'),      value: transactions.length,            color: 'slate',  Icon: Coins,           iconBg: '#f8fafc', iconColor: '#64748b' },
    { label: t('wallet.uncollected_cod'),   value: `${pendingCOD.length} ${t('wallet.orders_suffix')}`, color: 'purple', Icon: WarningTriangle, iconBg: '#faf5ff', iconColor: '#8b5cf6' },
  ];

  /* ── Tabs config ───────────────────────────────────── */
  const tabs = [
    { key: 'transactions', label: t('wallet.tab_transactions_count', { count: '' }), badge: transactions.length },
    { key: 'cod-pending',  label: t('wallet.tab_cod_uncollected_count', { count: '' }), badge: pendingCOD.length },
    { key: 'cod-done',     label: t('wallet.tab_cash_collected_count', { count: '' }), badge: collectedCOD.length },
  ];

  /* ══════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════ */
  return (
    <div className="wlt-page">
      {/* ── Hero ──────────────────────────────────────── */}
      <div className="module-hero">
        <div className="module-hero-left">
          <h1 className="module-hero-title">
            <CardWallet width={26} height={26} style={{ verticalAlign: 'middle', marginRight: isRTL ? 0 : 8, marginLeft: isRTL ? 8 : 0 }} />
            {t('wallet.title')}
          </h1>
          <p className="module-hero-sub">{t('wallet.subtitle')}</p>
        </div>
        <div className="module-hero-actions">
          <button className="module-btn module-btn-outline" onClick={() => setShowSettle(true)}>
            <HandCash width={16} height={16} /> {t('wallet.settle_cod')}
          </button>
          <button className="module-btn module-btn-primary" onClick={() => setShowTopup(true)}>
            <ReceiveDollars width={16} height={16} /> {t('wallet.top_up_btn')}
          </button>
        </div>
      </div>

      {/* ── Flash Message ─────────────────────────────── */}
      {flash && (
        <div className={`wlt-msg ${flash.type}`}>
          {flash.type === 'success'
            ? <CheckCircle width={18} height={18} />
            : <XmarkCircle width={18} height={18} />}
          {flash.msg}
        </div>
      )}

      {loading ? (
        <>
          <StatCardSkeleton count={4} />
          <TableSkeleton rows={5} cols={5} />
        </>
      ) : (
        <>
          {/* ── Stats Grid ────────────────────────────── */}
          <div className="wlt-stats-grid">
            {stats.map(s => (
              <div key={s.label} className={`wlt-stat-card ${s.color}`}>
                <div className="wlt-stat-row">
                  <div className="wlt-stat-icon" style={{ background: s.iconBg }}>
                    <s.Icon width={22} height={22} color={s.iconColor} />
                  </div>
                  <div className="wlt-stat-body">
                    <span className="wlt-stat-val">{s.value}</span>
                    <span className="wlt-stat-lbl">{s.label}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Tabs ──────────────────────────────────── */}
          <div className="wlt-tabs">
            {tabs.map(tab => (
              <button
                key={tab.key}
                className={`wlt-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => { setActiveTab(tab.key); setPage(1); }}
              >
                {tab.label}
                <span className="wlt-tab-badge">{tab.badge}</span>
              </button>
            ))}
          </div>

          {/* ── Transactions Tab ──────────────────────── */}
          {activeTab === 'transactions' && (
            <div className="wlt-table-card">
              <div className="wlt-table-wrap">
              <table className="wlt-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_date')}</th>
                    <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_type')}</th>
                    <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_order')}</th>
                    <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_amount')}</th>
                    <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_balance_after')}</th>
                    <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_reference')}</th>
                    <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_description')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="wlt-empty">
                          <div className="wlt-empty-icon"><Coins width={26} height={26} /></div>
                          <div className="wlt-empty-title">{t('wallet.no_transactions')}</div>
                        </div>
                      </td>
                    </tr>
                  ) : paged.map(tx => {
                    const badge = TX_BADGE[tx.type] || { bg: '#f1f5f9', color: '#64748b', label: tx.type };
                    const isCredit = ['topup','credit','cod_settled','release','prepaid_settled'].includes(tx.type);
                    return (
                      <tr key={tx.id}>
                        <td className="wlt-muted" style={{ whiteSpace: 'nowrap' }}>
                          {new Date(tx.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <span className="wlt-badge" style={{ background: badge.bg, color: badge.color }}>
                            {t(badge.label)}
                          </span>
                        </td>
                        <td className="wlt-muted">{tx.work_order_number || '—'}</td>
                        <td className={isCredit ? 'wlt-amount-credit' : 'wlt-amount-debit'}>
                          {isCredit ? '+' : '-'}{fmtAED(tx.amount)}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtAED(tx.balance_after)}</td>
                        <td className="wlt-muted">{tx.reference || '—'}</td>
                        <td className="wlt-muted">{tx.description || tx.notes || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              {totalPages > 1 && (
                <div className="wlt-pagination">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                    <button
                      key={p}
                      className={`wlt-page-btn ${p === page ? 'active' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── COD Pending Tab ───────────────────────── */}
          {activeTab === 'cod-pending' && (
            <div className="wlt-table-card">
              {pendingCOD.length === 0 ? (
                <div className="wlt-empty">
                  <div className="wlt-empty-icon"><CheckCircle width={26} height={26} /></div>
                  <div className="wlt-empty-title">{t('wallet.all_cash_collected')}</div>
                </div>
              ) : (
                <div className="wlt-table-wrap">
                <table className="wlt-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_order')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_recipient')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_cash_amount')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_service_fee')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_mechanic')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_date')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingCOD.map(o => (
                      <tr key={o.id}>
                        <td className="wlt-bold">{o.work_order_number}</td>
                        <td>{o.recipient_name}</td>
                        <td className="wlt-amount-orange">{fmtAED(o.cash_amount)}</td>
                        <td>{fmtAED(o.service_fee)}</td>
                        <td className="wlt-muted">{o.mechanic_name || '—'}</td>
                        <td className="wlt-muted" style={{ whiteSpace: 'nowrap' }}>
                          {new Date(o.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <button
                            className="wlt-btn-collect"
                            onClick={() => { setCollectOrder(o); setCollectAmt(o.cash_amount || ''); }}
                          >
                            {t('wallet.mark_collected_btn')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          )}

          {/* ── COD Collected Tab ─────────────────────── */}
          {activeTab === 'cod-done' && (
            <div className="wlt-table-card">
              {collectedCOD.length === 0 ? (
                <div className="wlt-empty">
                  <div className="wlt-empty-icon"><Package width={26} height={26} /></div>
                  <div className="wlt-empty-title">{t('wallet.no_cod_orders')}</div>
                </div>
              ) : (
                <div className="wlt-table-wrap">
                <table className="wlt-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_order')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_recipient')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_collected')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_collected_at')}</th>
                      <th style={{ textAlign: isRTL ? 'right' : 'left' }}>{t('wallet.col_mechanic')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collectedCOD.map(o => (
                      <tr key={o.id}>
                        <td className="wlt-bold">{o.work_order_number}</td>
                        <td>{o.recipient_name}</td>
                        <td className="wlt-amount-credit">{fmtAED(o.cash_collected)}</td>
                        <td className="wlt-muted" style={{ whiteSpace: 'nowrap' }}>
                          {o.cash_collected_at ? new Date(o.cash_collected_at).toLocaleString() : '—'}
                        </td>
                        <td className="wlt-muted">{o.mechanic_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════
         MODALS
         ══════════════════════════════════════════════════ */}

      {/* ── Top Up Modal ──────────────────────────────── */}
      {showTopup && (
        <div className="wlt-modal-overlay" onClick={() => setShowTopup(false)}>
          <div className="wlt-modal" onClick={e => e.stopPropagation()}>
            <div className="wlt-modal-header">
              <h3 className="wlt-modal-title">{t('wallet.top_up')}</h3>
              <p className="wlt-modal-sub">{t('wallet.topup_desc')}</p>
            </div>
            <div className="wlt-modal-body">
              <form onSubmit={handleTopup} id="topup-form">
                <div className="wlt-field">
                  <label className="wlt-field-label">{t('wallet.amount_aed_required')}</label>
                  <input
                    className="wlt-field-input"
                    type="number" min="1" step="0.01" required
                    value={topupForm.amount}
                    onChange={e => setTopupForm(p => ({ ...p, amount: e.target.value }))}
                  />
                </div>
                <div className="wlt-field">
                  <label className="wlt-field-label">{t('wallet.reference_label')}</label>
                  <input
                    className="wlt-field-input"
                    type="text"
                    value={topupForm.reference}
                    onChange={e => setTopupForm(p => ({ ...p, reference: e.target.value }))}
                  />
                </div>
                <div className="wlt-field">
                  <label className="wlt-field-label">{t('wallet.description_label')}</label>
                  <input
                    className="wlt-field-input"
                    type="text"
                    value={topupForm.description}
                    onChange={e => setTopupForm(p => ({ ...p, description: e.target.value }))}
                  />
                </div>
              </form>
            </div>
            <div className="wlt-modal-footer">
              <button type="button" className="wlt-btn-cancel" onClick={() => setShowTopup(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" form="topup-form" className="wlt-btn-primary" disabled={saving}>
                {saving ? t('wallet.processing') : t('wallet.add_funds')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settle COD Modal ──────────────────────────── */}
      {showSettle && (
        <div className="wlt-modal-overlay" onClick={() => setShowSettle(false)}>
          <div className="wlt-modal" onClick={e => e.stopPropagation()}>
            <div className="wlt-modal-header">
              <h3 className="wlt-modal-title">{t('wallet.settle_cod_balance')}</h3>
              <p className="wlt-modal-sub">
                {t('wallet.cod_pending_label')} <strong>{fmtAED(wallet?.cod_pending)}</strong>
              </p>
            </div>
            <div className="wlt-modal-body">
              <form onSubmit={handleSettle} id="settle-form">
                <div className="wlt-field">
                  <label className="wlt-field-label">{t('wallet.amount_aed_required')}</label>
                  <input
                    className="wlt-field-input"
                    type="number" min="0.01" step="0.01" required
                    value={settleForm.amount}
                    onChange={e => setSettleForm(p => ({ ...p, amount: e.target.value }))}
                  />
                </div>
                <div className="wlt-field">
                  <label className="wlt-field-label">{t('wallet.reference_label')}</label>
                  <input
                    className="wlt-field-input"
                    type="text"
                    value={settleForm.reference}
                    onChange={e => setSettleForm(p => ({ ...p, reference: e.target.value }))}
                  />
                </div>
                <div className="wlt-field">
                  <label className="wlt-field-label">{t('wallet.note_label')}</label>
                  <input
                    className="wlt-field-input"
                    type="text"
                    value={settleForm.note}
                    onChange={e => setSettleForm(p => ({ ...p, note: e.target.value }))}
                  />
                </div>
              </form>
            </div>
            <div className="wlt-modal-footer">
              <button type="button" className="wlt-btn-cancel" onClick={() => setShowSettle(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" form="settle-form" className="wlt-btn-primary" disabled={saving}>
                {saving ? t('wallet.processing') : t('wallet.settle_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Collect COD Modal ─────────────────────────── */}
      {collectOrder && (
        <div className="wlt-modal-overlay" onClick={() => setCollectOrder(null)}>
          <div className="wlt-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="wlt-modal-header">
              <h3 className="wlt-modal-title">{t('wallet.mark_collected')}</h3>
            </div>
            <div className="wlt-modal-body">
              <div className="wlt-modal-info">
                <div className="wlt-modal-info-icon">
                  <Package width={18} height={18} />
                </div>
                <div className="wlt-modal-info-text">
                  <strong>{collectOrder.work_order_number}</strong> — {collectOrder.recipient_name}
                </div>
              </div>
              <div className="wlt-field">
                <label className="wlt-field-label">{t('wallet.amount_collected_label')}</label>
                <input
                  className="wlt-field-input"
                  type="number" step="0.01" min="0.01"
                  value={collectAmt}
                  onChange={e => setCollectAmt(e.target.value)}
                  style={{ fontSize: 16, fontWeight: 700 }}
                />
              </div>
            </div>
            <div className="wlt-modal-footer">
              <button type="button" className="wlt-btn-cancel" onClick={() => setCollectOrder(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="wlt-btn-blue"
                disabled={saving || !collectAmt}
                onClick={handleCollectCOD}
              >
                {saving ? t('wallet.saving') : t('wallet.confirm_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
