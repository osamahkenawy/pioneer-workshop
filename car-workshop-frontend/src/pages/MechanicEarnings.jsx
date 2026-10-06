import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import api from '../lib/api';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';

/* ── Inline SVG icons (no extra dependencies) ── */
const Icon = ({ d, size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const MechanicsIcon = ({ size = 24, color = '#1B2A4A' }) => (
  <svg width={size} height={size} strokeWidth="1.5" viewBox="0 0 24 24" fill="none" color={color}>
    <path d="M1 20V19C1 15.134 4.13401 12 8 12V12C11.866 12 15 15.134 15 19V20" stroke="currentColor" strokeLinecap="round" />
    <path d="M13 14V14C13 11.2386 15.2386 9 18 9V9C20.7614 9 23 11.2386 23 14V14.5" stroke="currentColor" strokeLinecap="round" />
    <path d="M8 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 8 4C5.79086 4 4 5.79086 4 8C4 10.2091 5.79086 12 8 12Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M18 9C19.6569 9 21 7.65685 21 6C21 4.34315 19.6569 3 18 3C16.3431 3 15 4.34315 15 6C15 7.65685 16.3431 9 18 9Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const icons = {
  wallet:     'M2 6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm18 4h-4a2 2 0 100 4h4',
  clock:      'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4v6l4 2',
  check:      'M20 6L9 17l-5-5',
  dollar:     'M12 1v22m5-18H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H7',
  truck:      'M5 18h-1a2 2 0 01-2-2V8a2 2 0 012-2h10l4 4v6a2 2 0 01-2 2h-1m-8 0a2 2 0 104 0m-4 0a2 2 0 004 0m6 0a2 2 0 104 0m-4 0a2 2 0 004 0',
  search:     'M21 21l-5.2-5.2m2.7-6.3a8.5 8.5 0 11-17 0 8.5 8.5 0 0117 0z',
  filter:     'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  x:          'M18 6L6 18M6 6l12 12',
  chevDown:   'M6 9l6 6 6-6',
  banknote:   'M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7zm10 2a3 3 0 100 6 3 3 0 000-6z',
  refresh:    'M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15',
  user:       'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2m8-10a4 4 0 100-8 4 4 0 000 8',
  calendar:   'M16 2v4M8 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  arrowUp:    'M12 19V5m-7 7l7-7 7 7',
  arrowDown:  'M12 5v14m7-7l-7 7-7-7',
  gift:       'M20 12v10H4V12m-2 0h20M12 22V7m0 0a4 4 0 00-4-4c-1.5 0-3 1.5-3 3s2.5 2 4 1m3 0a4 4 0 014-4c1.5 0 3 1.5 3 3s-2.5 2-4 1',
  plus:       'M12 5v14m-7-7h14',
};

const fmtCurrency = (v, currency = 'AED') => `${currency} ${parseFloat(v || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export default function MechanicEarnings() {
  const { t } = useTranslation();
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';

  /* ── State ── */
  const [mechanics, setMechanics] = useState([]);
  const [selectedMechanic, setSelectedMechanic] = useState('');
  const [earnings, setEarnings] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState(null);
  const [flash, setFlash] = useState(null);
  const [tab, setTab] = useState('summary');
  const [searchQ, setSearchQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('total_pending');
  const [sortDir, setSortDir] = useState('desc');

  /* ── Pay Modal State ── */
  const [payModal, setPayModal] = useState(null); // { mechanicId, mechanicName, pending, earningId? }
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNotes, setPayNotes] = useState('');
  const [payProcessing, setPayProcessing] = useState(false);

  /* ── Bonus Modal State ── */
  const [bonusModal, setBonusModal] = useState(null); // { mechanicId, mechanicName }
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusType, setBonusType] = useState('bonus');
  const [bonusNotes, setBonusNotes] = useState('');
  const [bonusPaidNow, setBonusPaidNow] = useState(false);
  const [bonusProcessing, setBonusProcessing] = useState(false);

  const showFlash = (type, msg) => { setFlash({ type, msg }); setTimeout(() => setFlash(null), 5000); };

  /* ── Fetch ── */
  useEffect(() => { api.get('/mechanics').then(r => { if (r.success) setMechanics(r.data || []); }); }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (selectedMechanic) params.mechanic_id = selectedMechanic;
      if (statusFilter) params.status = statusFilter;
      const [sumRes, earRes] = await Promise.all([
        api.get('/mechanic-earnings/summary'),
        api.get('/mechanic-earnings', { params }),
      ]);
      if (sumRes.success) setSummary(sumRes.data || []);
      if (earRes.success) setEarnings(earRes.data || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, [selectedMechanic, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Pay Modal Logic ── */
  const openPayModal = (mechanicId, mechanicName, pending, earningId = null) => {
    setPayModal({ mechanicId, mechanicName, pending, earningId });
    setPayAmount(parseFloat(pending || 0).toFixed(2));
    setPayMethod('cash');
    setPayNotes('');
  };
  const closePayModal = () => { setPayModal(null); setPayProcessing(false); };

  const submitPay = async () => {
    if (!payModal) return;
    setPayProcessing(true);
    try {
      let res;
      if (payModal.earningId) {
        // Single earning
        res = await api.patch(`/mechanic-earnings/${payModal.earningId}`, {
          status: 'paid', notes: payNotes || undefined, payment_method: payMethod,
        });
      } else {
        // Bulk pay with optional amount
        res = await api.post('/mechanic-earnings/bulk-pay', {
          mechanic_id: payModal.mechanicId,
          amount: parseFloat(payAmount),
          notes: payNotes || undefined,
          payment_method: payMethod,
        });
      }
      if (res.success) {
        showFlash('success', res.message || t('mechanicEarnings.paymentSuccess'));
        closePayModal();
        fetchData();
      } else {
        showFlash('error', res.message || t('mechanicEarnings.paymentFailed'));
        setPayProcessing(false);
      }
    } catch (e) {
      showFlash('error', t('mechanicEarnings.paymentFailed'));
      setPayProcessing(false);
    }
  };

  /* ── Bonus Modal Logic ── */
  const openBonusModal = (mechanicId = '', mechanicName = '') => {
    setBonusModal({ mechanicId, mechanicName });
    setBonusAmount('');
    setBonusType('bonus');
    setBonusNotes('');
    setBonusPaidNow(false);
  };
  const closeBonusModal = () => { setBonusModal(null); setBonusProcessing(false); };

  const submitBonus = async () => {
    if (!bonusModal || !bonusAmount || parseFloat(bonusAmount) <= 0) return;
    if (!bonusModal.mechanicId) { showFlash('error', t('mechanicEarnings.selectMechanic')); return; }
    setBonusProcessing(true);
    try {
      const res = await api.post('/mechanic-earnings', {
        mechanic_id: bonusModal.mechanicId,
        earning_type: bonusType,
        base_amount: parseFloat(bonusAmount),
        bonus: 0,
        deductions: 0,
        notes: bonusNotes || `${bonusType === 'bonus' ? 'Bonus' : bonusType === 'incentive' ? 'Incentive' : 'Extra'} payment`,
      });
      if (res.success) {
        // If "Mark as paid now" is checked, immediately pay it
        if (bonusPaidNow && res.data?.id) {
          await api.patch(`/mechanic-earnings/${res.data.id}`, { status: 'paid' });
        }
        showFlash('success', bonusPaidNow ? t('mechanicEarnings.bonusAddedPaid') : t('mechanicEarnings.bonusAdded'));
        closeBonusModal();
        fetchData();
      } else {
        showFlash('error', res.message || t('mechanicEarnings.bonusFailed'));
        setBonusProcessing(false);
      }
    } catch (e) {
      showFlash('error', t('mechanicEarnings.bonusFailed'));
      setBonusProcessing(false);
    }
  };

  /* ── Derived Data ── */
  const totalPending = summary.reduce((s, d) => s + Number(d.total_pending || 0), 0);
  const totalPaid = summary.reduce((s, d) => s + Number(d.total_paid || 0), 0);
  const totalNet = summary.reduce((s, d) => s + Number(d.total_net || 0), 0);
  const totalMechanics = summary.length;
  const totalDeliveries = summary.reduce((s, d) => s + Number(d.total_entries || 0), 0);
  const mechanicsWithPending = summary.filter(d => Number(d.total_pending) > 0).length;

  const filteredSummary = useMemo(() => {
    let list = [...summary];
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(s => (s.mechanic_name || '').toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const av = Number(a[sortKey] || 0), bv = Number(b[sortKey] || 0);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [summary, searchQ, sortKey, sortDir]);

  const filteredEarnings = useMemo(() => {
    let list = [...earnings];
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(e => (e.mechanic_name || '').toLowerCase().includes(q) || (e.work_order_number || '').toLowerCase().includes(q));
    }
    return list;
  }, [earnings, searchQ]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const SortIcon = ({ col }) => sortKey === col
    ? <Icon d={sortDir === 'asc' ? icons.arrowUp : icons.arrowDown} size={12} />
    : null;

  /* ── Render ── */
  return (
    <div className="de-root">
      {/* Flash */}
      {flash && (
        <div className={`de-toast de-toast-${flash.type}`} onClick={() => setFlash(null)}>
          <Icon d={flash.type === 'success' ? icons.check : icons.x} size={18} />
          <span>{flash.msg}</span>
        </div>
      )}

      {/* Header */}
      <div className="de-header">
        <div>
          <h1 className="de-title">
            <MechanicsIcon size={28} color="#1B2A4A" />
            {t('mechanicEarnings.pageTitle')}
          </h1>
          <p className="de-subtitle">{totalMechanics} mechanics · {totalDeliveries} deliveries · {mechanicsWithPending} pending payouts</p>
        </div>
        <div className="de-header-actions">
          <button className="de-btn-bonus" onClick={() => openBonusModal()}>
            <Icon d={icons.gift} size={16} /> {t('mechanicEarnings.giveBonus')}
          </button>
          <button className="de-btn-outline" onClick={fetchData} title="Refresh">
            <Icon d={icons.refresh} size={16} /> {t('mechanicEarnings.refresh')}
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="de-cards">
        <div className="de-card de-card-total">
          <div className="de-card-icon"><Icon d={icons.dollar} size={24} color="#1B2A4A" /></div>
          <div className="de-card-body">
            <span className="de-card-label">{t('mechanicEarnings.totalEarned')}</span>
            <span className="de-card-value">{fmtCurrency(totalNet, cur)}</span>
          </div>
          <div className="de-card-accent" style={{ background: 'linear-gradient(135deg, #1B2A4A, #2d4a7a)' }} />
        </div>
        <div className="de-card de-card-pending">
          <div className="de-card-icon"><Icon d={icons.clock} size={24} color="#f59e0b" /></div>
          <div className="de-card-body">
            <span className="de-card-label">{t('mechanicEarnings.pendingPayout')}</span>
            <span className="de-card-value" style={{ color: '#d97706' }}>{fmtCurrency(totalPending, cur)}</span>
          </div>
          <div className="de-card-accent" style={{ background: 'linear-gradient(135deg, #f59e0b, #fbbf24)' }} />
        </div>
        <div className="de-card de-card-paid">
          <div className="de-card-icon"><Icon d={icons.check} size={24} color="#10b981" /></div>
          <div className="de-card-body">
            <span className="de-card-label">{t('mechanicEarnings.totalPaid')}</span>
            <span className="de-card-value" style={{ color: '#059669' }}>{fmtCurrency(totalPaid, cur)}</span>
          </div>
          <div className="de-card-accent" style={{ background: 'linear-gradient(135deg, #10b981, #34d399)' }} />
        </div>
        <div className="de-card de-card-mechanics">
          <div className="de-card-icon"><MechanicsIcon size={24} color="#1B2A4A" /></div>
          <div className="de-card-body">
            <span className="de-card-label">{t('mechanicEarnings.activeMechanics')}</span>
            <span className="de-card-value">{totalMechanics}</span>
          </div>
          <div className="de-card-accent" style={{ background: 'linear-gradient(135deg, #1B2A4A, #2d4a7a)' }} />
        </div>
      </div>

      {/* Progress bar showing paid vs pending */}
      {totalNet > 0 && (
        <div className="de-progress-wrap">
          <div className="de-progress-bar">
            <div className="de-progress-fill" style={{ width: `${(totalPaid / totalNet * 100).toFixed(1)}%` }} />
          </div>
          <div className="de-progress-labels">
            <span><span className="de-dot de-dot-paid" /> {t('mechanicEarnings.paid')} {((totalPaid / totalNet) * 100).toFixed(0)}%</span>
            <span><span className="de-dot de-dot-pending" /> {t('mechanicEarnings.pending')} {((totalPending / totalNet) * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Tabs + Search/Filter Bar */}
      <div className="de-toolbar">
        <div className="de-tabs">
          <button className={`de-tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>
            <Icon d={icons.user} size={15} /> {t('mechanicEarnings.perMechanic')}
          </button>
          <button className={`de-tab ${tab === 'transactions' ? 'active' : ''}`} onClick={() => setTab('transactions')}>
            <Icon d={icons.banknote} size={15} /> {t('mechanicEarnings.allTransactions')}
          </button>
        </div>
        <div className="de-filters">
          <div className="de-search-box">
            <Icon d={icons.search} size={16} color="#94a3b8" />
            <input
              type="text"
              placeholder={t('mechanicEarnings.searchPlaceholder')}
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
            />
            {searchQ && <button className="de-search-clear" onClick={() => setSearchQ('')}><Icon d={icons.x} size={14} /></button>}
          </div>
          {tab === 'transactions' && (
            <>
              <select className="de-select" value={selectedMechanic} onChange={e => setSelectedMechanic(e.target.value)}>
                <option value="">{t('mechanicEarnings.allMechanics')}</option>
                {mechanics.map(d => <option key={d.id} value={d.id}>{d.full_name || d.name}</option>)}
              </select>
              <select className="de-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">{t('mechanicEarnings.allStatus')}</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="de-loading">
          <div className="de-spinner" />
          <span>{t('mechanicEarnings.loadingEarnings')}</span>
        </div>
      ) : tab === 'summary' ? (
        /* ════════ Per Mechanic Summary ════════ */
        <div className="de-table-wrap">
          <table className="de-table">
            <thead>
              <tr>
                <th>{t('mechanicEarnings.mechanic')}</th>
                <th className="de-sort" onClick={() => toggleSort('total_net')}>{t('mechanicEarnings.totalEarnedCol')} <SortIcon col="total_net" /></th>
                <th className="de-sort" onClick={() => toggleSort('total_paid')}>{t('mechanicEarnings.paidCol')} <SortIcon col="total_paid" /></th>
                <th className="de-sort" onClick={() => toggleSort('total_pending')}>{t('mechanicEarnings.pendingCol')} <SortIcon col="total_pending" /></th>
                <th className="de-sort" onClick={() => toggleSort('total_entries')}>{t('mechanicEarnings.deliveries')} <SortIcon col="total_entries" /></th>
                <th style={{ width: 140 }}>{t('mechanicEarnings.action')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredSummary.length === 0 && (
                <tr><td colSpan={6} className="de-empty">
                  <Icon d={icons.truck} size={40} color="#cbd5e1" />
                  <p>{t('mechanicEarnings.noEarningsYet')}</p>
                  <span>{t('mechanicEarnings.earningsAutoCreated')}</span>
                </td></tr>
              )}
              {filteredSummary.map((s, i) => {
                const pct = Number(s.total_net) > 0 ? ((Number(s.total_paid) / Number(s.total_net)) * 100) : 0;
                return (
                  <tr key={s.mechanic_id} className={i % 2 === 0 ? 'de-row-alt' : ''}>
                    <td>
                      <div className="de-mechanic-cell">
                        <div className="de-avatar">{(s.mechanic_name || 'D')[0].toUpperCase()}</div>
                        <div>
                          <div className="de-mechanic-name">{s.mechanic_name || `Mechanic #${s.mechanic_id}`}</div>
                          <div className="de-mechanic-meta">{s.total_entries} deliveries</div>
                        </div>
                      </div>
                    </td>
                    <td className="de-num"><strong>{fmtCurrency(s.total_net, cur)}</strong></td>
                    <td className="de-num de-paid">{fmtCurrency(s.total_paid, cur)}</td>
                    <td className="de-num">
                      <span className={Number(s.total_pending) > 0 ? 'de-pending-val' : ''}>{fmtCurrency(s.total_pending, cur)}</span>
                    </td>
                    <td className="de-num">
                      <div className="de-delivery-bar">
                        <div className="de-mini-bar"><div className="de-mini-fill" style={{ width: `${pct}%` }} /></div>
                        <span>{pct.toFixed(0)}% paid</span>
                      </div>
                    </td>
                    <td>
                      <div className="de-action-btns">
                        <button className="de-bonus-btn-sm" onClick={() => openBonusModal(s.mechanic_id, s.mechanic_name)} title="Give Bonus">
                          <Icon d={icons.gift} size={14} />
                        </button>
                        {Number(s.total_pending) > 0 ? (
                          <button className="de-pay-btn" onClick={() => openPayModal(s.mechanic_id, s.mechanic_name, s.total_pending)}>
                            <Icon d={icons.banknote} size={15} /> {t('mechanicEarnings.payMechanic')}
                          </button>
                        ) : (
                          <span className="de-paid-badge"><Icon d={icons.check} size={14} /> {t('mechanicEarnings.allPaid')}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ════════ All Transactions ════════ */
        <div className="de-table-wrap">
          <table className="de-table">
            <thead>
              <tr>
                <th>{t('mechanicEarnings.order')}</th>
                <th>{t('mechanicEarnings.mechanic')}</th>
                <th>{t('mechanicEarnings.base')}</th>
                <th>{t('mechanicEarnings.bonus')}</th>
                <th>{t('mechanicEarnings.netAmount')}</th>
                <th>{t('mechanicEarnings.status')}</th>
                <th>{t('mechanicEarnings.date')}</th>
                <th style={{ width: 120 }}>{t('mechanicEarnings.action')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredEarnings.length === 0 && (
                <tr><td colSpan={8} className="de-empty">
                  <Icon d={icons.banknote} size={40} color="#cbd5e1" />
                  <p>{t('mechanicEarnings.noTransactions')}</p>
                </td></tr>
              )}
              {filteredEarnings.map((e, i) => (
                <tr key={e.id} className={i % 2 === 0 ? 'de-row-alt' : ''}>
                  <td><span className="de-order-num">{e.work_order_number || `#${e.work_order_id || '—'}`}</span></td>
                  <td>
                    <div className="de-mechanic-cell de-mechanic-cell-sm">
                      <div className="de-avatar de-avatar-sm">{(e.mechanic_name || 'D')[0].toUpperCase()}</div>
                      <span>{e.mechanic_name || `Mechanic #${e.mechanic_id}`}</span>
                    </div>
                  </td>
                  <td className="de-num">{fmtCurrency(e.base_amount, cur)}</td>
                  <td className="de-num">{Number(e.bonus) > 0 ? <span className="de-bonus">+{fmtCurrency(e.bonus, cur)}</span> : '—'}</td>
                  <td className="de-num"><strong>{fmtCurrency(e.net_amount, cur)}</strong></td>
                  <td>
                    <span className={`de-status de-status-${e.status}`}>
                      {e.status === 'paid' ? `✓ ${t('mechanicEarnings.paidStatus')}` : e.status === 'cancelled' ? `✗ ${t('mechanicEarnings.cancelledStatus')}` : `⏳ ${t('mechanicEarnings.pendingStatus')}`}
                    </span>
                  </td>
                  <td className="de-date">{fmtDateTime(e.created_at)}</td>
                  <td>
                    {e.status === 'pending' && (
                      <button
                        className="de-pay-btn de-pay-btn-sm"
                        disabled={payingId === e.id}
                        onClick={() => openPayModal(e.mechanic_id, e.mechanic_name, e.net_amount, e.id)}
                      >
                        {payingId === e.id ? '...' : <><Icon d={icons.check} size={14} /> Pay</>}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEarnings.length > 0 && (
            <div className="de-table-footer">
              {t('mechanicEarnings.showingTransactions', { count: filteredEarnings.length })}
              {selectedMechanic && ` ${t('mechanicEarnings.forSelectedMechanic')}`}
            </div>
          )}
        </div>
      )}

      {/* ════════ Pay Modal ════════ */}
      {payModal && (
        <div className="de-modal-overlay" onClick={closePayModal}>
          <div className="de-modal" onClick={e => e.stopPropagation()}>
            <div className="de-modal-header">
              <div className="de-modal-icon"><Icon d={icons.banknote} size={24} color="#fff" /></div>
              <div>
                <h3>{t('mechanicEarnings.recordPayment')}</h3>
                <p>{payModal.mechanicName || 'Mechanic'}</p>
              </div>
              <button className="de-modal-close" onClick={closePayModal}><Icon d={icons.x} size={18} /></button>
            </div>

            <div className="de-modal-body">
              {/* Amount */}
              <label className="de-field">
                <span className="de-field-label">{t('mechanicEarnings.paymentAmount')} ({cur})</span>
                <div className="de-amount-input">
                  <span className="de-amount-prefix">{cur}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={parseFloat(payModal.pending || 0).toFixed(2)}
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    className="de-input de-input-amount"
                    autoFocus
                  />
                </div>
                <div className="de-amount-helpers">
                  <span className="de-amount-hint">{t('mechanicEarnings.pendingAmount')}: {fmtCurrency(payModal.pending, cur)}</span>
                  <div className="de-quick-amounts">
                    {[0.25, 0.5, 0.75, 1].map(pct => {
                      const val = (parseFloat(payModal.pending || 0) * pct).toFixed(2);
                      return (
                        <button
                          key={pct}
                          className={`de-quick-btn ${payAmount === val ? 'active' : ''}`}
                          onClick={() => setPayAmount(val)}
                        >
                          {pct === 1 ? t('mechanicEarnings.full') : `${pct * 100}%`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </label>

              {/* Payment Method */}
              <label className="de-field">
                <span className="de-field-label">{t('mechanicEarnings.paymentMethod')}</span>
                <div className="de-method-grid">
                  {[
                    { key: 'cash', label: t('mechanicEarnings.cash'), icon: icons.banknote },
                    { key: 'bank_transfer', label: t('mechanicEarnings.bankTransfer'), icon: icons.wallet },
                    { key: 'cheque', label: t('mechanicEarnings.cheque'), icon: icons.dollar },
                    { key: 'other', label: t('mechanicEarnings.other'), icon: icons.filter },
                  ].map(m => (
                    <button
                      key={m.key}
                      className={`de-method-btn ${payMethod === m.key ? 'active' : ''}`}
                      onClick={() => setPayMethod(m.key)}
                    >
                      <Icon d={m.icon} size={18} />
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
              </label>

              {/* Notes */}
              <label className="de-field">
                <span className="de-field-label">{t('mechanicEarnings.notes')} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({t('mechanicEarnings.notesOptional')})</span></span>
                <textarea
                  className="de-textarea"
                  rows={2}
                  placeholder={t('mechanicEarnings.notesPlaceholder')}
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                />
              </label>

              {/* Summary */}
              <div className="de-modal-summary">
                <div className="de-summary-row">
                  <span>{t('mechanicEarnings.payingTo')}</span>
                  <strong>{payModal.mechanicName || 'Mechanic'}</strong>
                </div>
                <div className="de-summary-row">
                  <span>{t('mechanicEarnings.amount')}</span>
                  <strong className="de-summary-amount">{fmtCurrency(payAmount, cur)}</strong>
                </div>
                <div className="de-summary-row">
                  <span>{t('mechanicEarnings.method')}</span>
                  <span style={{ textTransform: 'capitalize' }}>{payMethod.replace('_', ' ')}</span>
                </div>
                {parseFloat(payAmount) < parseFloat(payModal.pending) && (
                  <div className="de-summary-row de-summary-remaining">
                    <span>{t('mechanicEarnings.remainingAfter')}</span>
                    <span>{fmtCurrency(parseFloat(payModal.pending) - parseFloat(payAmount || 0), cur)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="de-modal-footer">
              <button className="de-btn-cancel" onClick={closePayModal}>{t('mechanicEarnings.cancel')}</button>
              <button
                className="de-btn-confirm"
                disabled={payProcessing || !payAmount || parseFloat(payAmount) <= 0}
                onClick={submitPay}
              >
                {payProcessing ? (
                  <><div className="de-spinner-sm" /> {t('mechanicEarnings.processing')}</>
                ) : (
                  <><Icon d={icons.check} size={16} /> {t('mechanicEarnings.confirmPayment')}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ Bonus Modal ════════ */}
      {bonusModal && (
        <div className="de-modal-overlay" onClick={closeBonusModal}>
          <div className="de-modal" onClick={e => e.stopPropagation()}>
            <div className="de-modal-header">
              <div className="de-modal-icon de-modal-icon-bonus"><Icon d={icons.gift} size={24} color="#fff" /></div>
              <div>
                <h3>{t('mechanicEarnings.giveBonusExtra')}</h3>
                <p>{bonusModal.mechanicName || 'Select a mechanic below'}</p>
              </div>
              <button className="de-modal-close" onClick={closeBonusModal}><Icon d={icons.x} size={18} /></button>
            </div>

            <div className="de-modal-body">
              {/* Mechanic select (if opened from header without a specific mechanic) */}
              {!bonusModal.mechanicId && (
                <label className="de-field">
                  <span className="de-field-label">{t('mechanicEarnings.mechanic')}</span>
                  <select
                    className="de-select de-select-full"
                    value={bonusModal.mechanicId}
                    onChange={e => setBonusModal(prev => ({
                      ...prev,
                      mechanicId: e.target.value,
                      mechanicName: mechanics.find(d => String(d.id) === e.target.value)?.full_name || mechanics.find(d => String(d.id) === e.target.value)?.name || '',
                    }))}
                  >
                    <option value="">{t('mechanicEarnings.selectMechanic')}</option>
                    {mechanics.map(d => <option key={d.id} value={d.id}>{d.full_name || d.name}</option>)}
                  </select>
                </label>
              )}

              {/* Type */}
              <label className="de-field">
                <span className="de-field-label">{t('mechanicEarnings.type')}</span>
                <div className="de-bonus-type-grid">
                  {[
                    { key: 'bonus', label: t('mechanicEarnings.bonusLabel'), desc: t('mechanicEarnings.bonusDesc'), icon: icons.gift },
                    { key: 'incentive', label: t('mechanicEarnings.incentiveLabel'), desc: t('mechanicEarnings.incentiveDesc'), icon: icons.arrowUp },
                    { key: 'extra', label: t('mechanicEarnings.extraPayLabel'), desc: t('mechanicEarnings.extraPayDesc'), icon: icons.plus },
                  ].map(bt => (
                    <button
                      key={bt.key}
                      className={`de-bonus-type-btn ${bonusType === bt.key ? 'active' : ''}`}
                      onClick={() => setBonusType(bt.key)}
                    >
                      <Icon d={bt.icon} size={20} />
                      <strong>{bt.label}</strong>
                      <span>{bt.desc}</span>
                    </button>
                  ))}
                </div>
              </label>

              {/* Amount */}
              <label className="de-field">
                <span className="de-field-label">{t('mechanicEarnings.amount')} ({cur})</span>
                <div className="de-amount-input">
                  <span className="de-amount-prefix">{cur}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={bonusAmount}
                    onChange={e => setBonusAmount(e.target.value)}
                    className="de-input de-input-amount"
                    placeholder="0.00"
                    autoFocus={!!bonusModal.mechanicId}
                  />
                </div>
                <div className="de-quick-amounts" style={{ marginTop: 6 }}>
                  {[10, 25, 50, 100, 200].map(v => (
                    <button
                      key={v}
                      className={`de-quick-btn ${bonusAmount === String(v) ? 'active' : ''}`}
                      onClick={() => setBonusAmount(String(v))}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </label>

              {/* Notes */}
              <label className="de-field">
                <span className="de-field-label">{t('mechanicEarnings.reasonNotes')} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({t('mechanicEarnings.notesOptional')})</span></span>
                <textarea
                  className="de-textarea"
                  rows={2}
                  placeholder={t('mechanicEarnings.reasonPlaceholder')}
                  value={bonusNotes}
                  onChange={e => setBonusNotes(e.target.value)}
                />
              </label>

              {/* Mark as paid toggle */}
              <label className="de-toggle-row">
                <div>
                  <strong>{t('mechanicEarnings.markPaidImmediately')}</strong>
                  <span>{t('mechanicEarnings.markPaidHint')}</span>
                </div>
                <div className={`de-toggle ${bonusPaidNow ? 'active' : ''}`} onClick={() => setBonusPaidNow(v => !v)}>
                  <div className="de-toggle-knob" />
                </div>
              </label>

              {/* Summary */}
              {bonusAmount && parseFloat(bonusAmount) > 0 && (
                <div className="de-modal-summary">
                  <div className="de-summary-row">
                    <span>{t('mechanicEarnings.mechanic')}</span>
                    <strong>{bonusModal.mechanicName || '—'}</strong>
                  </div>
                  <div className="de-summary-row">
                    <span>{t('mechanicEarnings.type')}</span>
                    <span style={{ textTransform: 'capitalize' }}>{bonusType}</span>
                  </div>
                  <div className="de-summary-row">
                    <span>{t('mechanicEarnings.amount')}</span>
                    <strong className="de-summary-amount">{fmtCurrency(bonusAmount, cur)}</strong>
                  </div>
                  <div className="de-summary-row">
                    <span>{t('mechanicEarnings.statusAfter')}</span>
                    <span className={`de-status ${bonusPaidNow ? 'de-status-paid' : 'de-status-pending'}`}>{bonusPaidNow ? `✓ ${t('mechanicEarnings.paidStatus')}` : `⏳ ${t('mechanicEarnings.pendingStatus')}`}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="de-modal-footer">
              <button className="de-btn-cancel" onClick={closeBonusModal}>{t('mechanicEarnings.cancel')}</button>
              <button
                className="de-btn-confirm de-btn-confirm-bonus"
                disabled={bonusProcessing || !bonusAmount || parseFloat(bonusAmount) <= 0 || !bonusModal.mechanicId}
                onClick={submitBonus}
              >
                {bonusProcessing ? (
                  <><div className="de-spinner-sm" /> {t('mechanicEarnings.processing')}</>
                ) : (
                  <><Icon d={icons.gift} size={16} /> {bonusType === 'bonus' ? t('mechanicEarnings.addBonus') : bonusType === 'incentive' ? t('mechanicEarnings.addIncentive') : t('mechanicEarnings.addExtraPay')}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* ── Root ── */
        .de-root { padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }

        /* ── Header ── */
        .de-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .de-title { display: flex; align-items: center; gap: 10px; font-size: 26px; font-weight: 800; color: #0f172a; margin: 0 0 4px 0; }
        .de-subtitle { font-size: 13px; color: #94a3b8; margin: 0; font-weight: 500; }
        .de-btn-outline { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border: 1.5px solid #e2e8f0; border-radius: 10px; background: #fff; font-size: 13px; font-weight: 600; color: #475569; cursor: pointer; transition: all .2s; }
        .de-btn-outline:hover { border-color: #1B2A4A; color: #1B2A4A; background: #e8edf4; }

        /* ── Stat Cards ── */
        .de-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
        .de-card { position: relative; background: #fff; border-radius: 16px; padding: 20px; display: flex; align-items: center; gap: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.03); transition: transform .2s, box-shadow .2s; }
        .de-card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,0,0,.08); }
        .de-card-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .de-card-total .de-card-icon { background: #e8edf4; }
        .de-card-pending .de-card-icon { background: #fffbeb; }
        .de-card-paid .de-card-icon { background: #ecfdf5; }
        .de-card-mechanics .de-card-icon { background: #e8edf4; }
        .de-card-body { display: flex; flex-direction: column; gap: 2px; z-index: 1; }
        .de-card-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; }
        .de-card-value { font-size: 24px; font-weight: 800; color: #0f172a; }
        .de-card-accent { position: absolute; top: -30px; right: -30px; width: 80px; height: 80px; border-radius: 50%; opacity: .08; }

        /* ── Progress ── */
        .de-progress-wrap { margin-bottom: 24px; }
        .de-progress-bar { height: 8px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .de-progress-fill { height: 100%; background: linear-gradient(90deg, #10b981, #34d399); border-radius: 99px; transition: width .5s ease; }
        .de-progress-labels { display: flex; gap: 20px; margin-top: 8px; font-size: 12px; color: #64748b; font-weight: 500; }
        .de-dot { display: inline-block; width: 8px; height: 8px; border-radius: 99px; margin-right: 6px; }
        .de-dot-paid { background: #10b981; }
        .de-dot-pending { background: #f59e0b; }

        /* ── Toolbar ── */
        .de-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
        .de-tabs { display: flex; gap: 4px; background: #f1f5f9; border-radius: 12px; padding: 4px; }
        .de-tab { display: flex; align-items: center; gap: 6px; padding: 8px 18px; border: none; background: transparent; border-radius: 10px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; transition: all .15s; }
        .de-tab.active { background: #fff; color: #0f172a; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
        .de-tab:hover:not(.active) { color: #475569; }
        .de-filters { display: flex; gap: 8px; align-items: center; }
        .de-search-box { display: flex; align-items: center; gap: 8px; padding: 0 12px; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px; transition: border-color .15s; }
        .de-search-box:focus-within { border-color: #1B2A4A; box-shadow: 0 0 0 3px rgba(27,42,74,.1); }
        .de-search-box input { border: none; outline: none; padding: 8px 0; font-size: 13px; width: 180px; background: none; }
        .de-search-clear { border: none; background: none; cursor: pointer; padding: 0; color: #94a3b8; }
        .de-select { padding: 8px 12px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 13px; background: #fff; color: #334155; cursor: pointer; }
        .de-select:focus { border-color: #1B2A4A; outline: none; }

        /* ── Loading ── */
        .de-loading { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 60px; color: #94a3b8; font-size: 14px; }
        .de-spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #1B2A4A; border-radius: 50%; animation: de-spin 0.6s linear infinite; }
        .de-spinner-sm { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: de-spin 0.6s linear infinite; }
        @keyframes de-spin { to { transform: rotate(360deg); } }

        /* ── Table ── */
        .de-table-wrap { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.03); }
        .de-table { width: 100%; border-collapse: collapse; }
        .de-table th { padding: 14px 16px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .06em; background: #f8fafc; border-bottom: 1px solid #e2e8f0; text-align: left; white-space: nowrap; user-select: none; }
        .de-table th.de-sort { cursor: pointer; }
        .de-table th.de-sort:hover { color: #1B2A4A; }
        .de-table td { padding: 14px 16px; font-size: 14px; color: #334155; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .de-row-alt { background: #fafbfc; }
        .de-table tbody tr { transition: background .15s; }
        .de-table tbody tr:hover { background: #edf1f7; }
        .de-num { text-align: right; font-variant-numeric: tabular-nums; }
        .de-paid { color: #059669; }
        .de-date { font-size: 12px; color: #64748b; white-space: nowrap; }
        .de-empty { text-align: center; padding: 60px 20px !important; color: #94a3b8; }
        .de-empty p { font-size: 16px; font-weight: 600; color: #64748b; margin: 12px 0 4px; }
        .de-empty span { font-size: 13px; }
        .de-table-footer { padding: 10px 16px; font-size: 12px; color: #94a3b8; background: #fafbfc; border-top: 1px solid #f1f5f9; }

        /* ── Mechanic cell ── */
        .de-mechanic-cell { display: flex; align-items: center; gap: 12px; }
        .de-mechanic-cell-sm { gap: 8px; }
        .de-avatar { width: 38px; height: 38px; border-radius: 12px; background: linear-gradient(135deg, #1B2A4A, #2d4a7a); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; flex-shrink: 0; }
        .de-avatar-sm { width: 28px; height: 28px; border-radius: 8px; font-size: 12px; }
        .de-mechanic-name { font-weight: 600; color: #0f172a; }
        .de-mechanic-meta { font-size: 12px; color: #94a3b8; }

        /* ── Status badges ── */
        .de-status { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }
        .de-status-pending { background: #fffbeb; color: #d97706; }
        .de-status-paid { background: #ecfdf5; color: #059669; }
        .de-status-cancelled { background: #fef2f2; color: #dc2626; }
        .de-pending-val { color: #d97706; font-weight: 700; background: #fffbeb; padding: 2px 8px; border-radius: 6px; }
        .de-order-num { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px; font-weight: 600; color: #1B2A4A; background: #e8edf4; padding: 2px 8px; border-radius: 6px; }
        .de-bonus { color: #059669; font-weight: 600; }
        .de-paid-badge { display: inline-flex; align-items: center; gap: 4px; color: #059669; font-size: 12px; font-weight: 600; }

        /* ── Mini progress ── */
        .de-delivery-bar { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
        .de-mini-bar { width: 60px; height: 5px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
        .de-mini-fill { height: 100%; background: linear-gradient(90deg, #10b981, #34d399); border-radius: 99px; }
        .de-delivery-bar span { font-size: 10px; color: #94a3b8; font-weight: 600; }

        /* ── Pay Button ── */
        .de-pay-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: none; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all .2s; background: linear-gradient(135deg, #1B2A4A, #0f1d33); color: #fff; box-shadow: 0 2px 8px rgba(27,42,74,.3); }
        .de-pay-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(27,42,74,.4); }
        .de-pay-btn:active { transform: translateY(0); }
        .de-pay-btn-sm { padding: 6px 12px; font-size: 12px; }

        /* ── Toast ── */
        .de-toast { position: fixed; top: 20px; right: 20px; display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-radius: 12px; font-size: 14px; font-weight: 600; z-index: 9999; cursor: pointer; animation: de-slideIn .3s ease; box-shadow: 0 8px 30px rgba(0,0,0,.12); }
        .de-toast-success { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
        .de-toast-error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
        @keyframes de-slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

        /* ── Modal ── */
        .de-modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 9998; animation: de-fadeIn .2s; }
        .de-modal { background: #fff; border-radius: 20px; width: 480px; max-width: 95vw; max-height: 90vh; overflow-y: auto; animation: de-scaleIn .25s ease; box-shadow: 0 20px 60px rgba(0,0,0,.15); }
        @keyframes de-fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes de-scaleIn { from { transform: scale(.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .de-modal-header { display: flex; align-items: center; gap: 14px; padding: 24px 24px 16px; border-bottom: 1px solid #f1f5f9; }
        .de-modal-icon { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #1B2A4A, #0f1d33); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .de-modal-header h3 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0; }
        .de-modal-header p { font-size: 13px; color: #64748b; margin: 2px 0 0; }
        .de-modal-close { margin-left: auto; border: none; background: #f1f5f9; border-radius: 10px; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #64748b; transition: all .15s; }
        .de-modal-close:hover { background: #fee2e2; color: #dc2626; }
        .de-modal-body { padding: 20px 24px; }
        .de-modal-footer { padding: 16px 24px; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 10px; }

        /* ── Form Fields ── */
        .de-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
        .de-field-label { font-size: 13px; font-weight: 600; color: #334155; }
        .de-amount-input { display: flex; align-items: center; border: 2px solid #e2e8f0; border-radius: 12px; overflow: hidden; transition: border-color .15s; }
        .de-amount-input:focus-within { border-color: #1B2A4A; box-shadow: 0 0 0 3px rgba(27,42,74,.1); }
        .de-amount-prefix { padding: 12px 14px; font-size: 14px; font-weight: 700; color: #64748b; background: #f8fafc; border-right: 1px solid #e2e8f0; }
        .de-input-amount { flex: 1; padding: 12px 14px; border: none; outline: none; font-size: 22px; font-weight: 700; color: #0f172a; background: none; }
        .de-input-amount::-webkit-inner-spin-button { -webkit-appearance: none; }
        .de-amount-helpers { display: flex; justify-content: space-between; align-items: center; }
        .de-amount-hint { font-size: 12px; color: #94a3b8; font-weight: 500; }
        .de-quick-amounts { display: flex; gap: 6px; }
        .de-quick-btn { padding: 4px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px; background: #fff; font-size: 12px; font-weight: 600; color: #64748b; cursor: pointer; transition: all .15s; }
        .de-quick-btn:hover { border-color: #1B2A4A; color: #1B2A4A; }
        .de-quick-btn.active { background: #1B2A4A; border-color: #1B2A4A; color: #fff; }

        /* ── Method Grid ── */
        .de-method-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .de-method-btn { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 8px; border: 1.5px solid #e2e8f0; border-radius: 12px; background: #fff; font-size: 11px; font-weight: 600; color: #64748b; cursor: pointer; transition: all .15s; }
        .de-method-btn:hover { border-color: #b8c5d6; color: #1B2A4A; }
        .de-method-btn.active { border-color: #1B2A4A; background: #e8edf4; color: #1B2A4A; box-shadow: 0 0 0 3px rgba(27,42,74,.08); }

        /* ── Textarea ── */
        .de-textarea { padding: 10px 14px; border: 1.5px solid #e2e8f0; border-radius: 12px; resize: vertical; font-size: 13px; font-family: inherit; color: #334155; transition: border-color .15s; }
        .de-textarea:focus { border-color: #1B2A4A; outline: none; box-shadow: 0 0 0 3px rgba(27,42,74,.1); }

        /* ── Modal Summary ── */
        .de-modal-summary { background: #f8fafc; border-radius: 12px; padding: 14px 16px; border: 1px solid #e2e8f0; }
        .de-summary-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 13px; color: #64748b; }
        .de-summary-row + .de-summary-row { border-top: 1px dashed #e2e8f0; }
        .de-summary-amount { font-size: 18px; color: #1B2A4A; }
        .de-summary-remaining { color: #d97706; }

        /* ── Buttons ── */
        .de-btn-cancel { padding: 10px 20px; border: 1.5px solid #e2e8f0; border-radius: 10px; background: #fff; font-size: 14px; font-weight: 600; color: #64748b; cursor: pointer; transition: all .15s; }
        .de-btn-cancel:hover { background: #f8fafc; border-color: #cbd5e1; }
        .de-btn-confirm { display: flex; align-items: center; gap: 8px; padding: 10px 24px; border: none; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; transition: all .2s; background: linear-gradient(135deg, #1B2A4A, #0f1d33); color: #fff; box-shadow: 0 2px 10px rgba(27,42,74,.3); }
        .de-btn-confirm:hover:not(:disabled) { box-shadow: 0 4px 20px rgba(27,42,74,.4); transform: translateY(-1px); }
        .de-btn-confirm:disabled { opacity: .5; cursor: not-allowed; }
        .de-btn-confirm-bonus { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 2px 10px rgba(245,158,11,.3); }
        .de-btn-confirm-bonus:hover:not(:disabled) { box-shadow: 0 4px 20px rgba(245,158,11,.4); }

        /* ── Header Actions ── */
        .de-header-actions { display: flex; gap: 8px; align-items: center; }
        .de-btn-bonus { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border: 2px solid #f59e0b; border-radius: 10px; background: #fffbeb; font-size: 13px; font-weight: 700; color: #d97706; cursor: pointer; transition: all .2s; }
        .de-btn-bonus:hover { background: #f59e0b; color: #fff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(245,158,11,.3); }

        /* ── Bonus type grid ── */
        .de-bonus-type-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .de-bonus-type-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 8px; border: 1.5px solid #e2e8f0; border-radius: 12px; background: #fff; cursor: pointer; transition: all .15s; text-align: center; }
        .de-bonus-type-btn strong { font-size: 13px; color: #334155; }
        .de-bonus-type-btn span { font-size: 11px; color: #94a3b8; }
        .de-bonus-type-btn:hover { border-color: #fbbf24; background: #fffbeb; }
        .de-bonus-type-btn.active { border-color: #f59e0b; background: #fffbeb; box-shadow: 0 0 0 3px rgba(245,158,11,.1); }
        .de-bonus-type-btn.active strong { color: #d97706; }

        /* ── Inline bonus btn in table ── */
        .de-action-btns { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
        .de-bonus-btn-sm { width: 32px; height: 32px; border-radius: 8px; border: 1.5px solid #fbbf24; background: #fffbeb; color: #d97706; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .15s; flex-shrink: 0; }
        .de-bonus-btn-sm:hover { background: #f59e0b; color: #fff; border-color: #f59e0b; }

        /* ── Modal icon bonus variant ── */
        .de-modal-icon-bonus { background: linear-gradient(135deg, #f59e0b, #d97706) !important; }

        /* ── Toggle ── */
        .de-toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; margin-bottom: 14px; gap: 16px; cursor: pointer; }
        .de-toggle-row div:first-child { display: flex; flex-direction: column; }
        .de-toggle-row strong { font-size: 13px; color: #334155; }
        .de-toggle-row span { font-size: 12px; color: #94a3b8; }
        .de-toggle { width: 44px; height: 24px; border-radius: 99px; background: #e2e8f0; position: relative; transition: background .2s; flex-shrink: 0; cursor: pointer; }
        .de-toggle.active { background: #10b981; }
        .de-toggle-knob { width: 18px; height: 18px; border-radius: 50%; background: #fff; position: absolute; top: 3px; left: 3px; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
        .de-toggle.active .de-toggle-knob { transform: translateX(20px); }

        /* ── Select full width ── */
        .de-select-full { width: 100%; }

        /* ── Responsive ── */
        @media (max-width: 1024px) { .de-cards { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 768px) {
          .de-cards { grid-template-columns: 1fr; }
          .de-toolbar { flex-direction: column; align-items: stretch; }
          .de-filters { flex-wrap: wrap; }
          .de-method-grid { grid-template-columns: repeat(2, 1fr); }
          .de-bonus-type-grid { grid-template-columns: 1fr; }
          .de-header { flex-direction: column; gap: 12px; }
          .de-header-actions { width: 100%; }
        }
      `}</style>
    </div>
  );
}
