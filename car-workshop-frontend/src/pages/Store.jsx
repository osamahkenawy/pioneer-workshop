/**
 * Store — the storekeeper's queue (Step 6, materials).
 *
 *   GET   /api/workflow/store/queue            requisition lines + estimates to price
 *   PATCH /api/workflow/requisition-items/:id  { availability: 'available', unit_cost? }
 *                                              { availability: 'not_available', expected_date }
 *
 * Requisitions: each line raised by a technician is checked against the
 * shelf. On the shelf → issued to the job card. Not on the shelf → the
 * expected delivery date is recorded, the floor is alerted 24 h before it,
 * and on (or after) that date the line comes back here as "Re-check now".
 *
 * Parts to price: draft estimates with part lines that have no price yet.
 */
import { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive, Refresh, CheckCircle, WarningTriangle, Calendar, Package, PageEdit,
  NavArrowRight, Bell, Hourglass, Search, Car, Xmark, User, Clock,
} from 'iconoir-react';
import api from '../lib/api';
import Toast, { useToast } from '../components/Toast';
import { AuthContext } from '../context/AuthContext';
import './Store.css';

const POLL_MS = 60000;

/* Mirrors userInGroups(user, ['storekeeper']) in the backend (lib/workflow.js):
 * the Store group plus managers and the owner. The server stays the judge —
 * this only decides whether to show the action buttons or a view-only note. */
const STORE_ROLES = ['admin', 'super_admin', 'part_advisor', 'general_manager', 'workshop_manager'];
const STORE_SLUGS = ['storekeeper', 'part_advisor', 'general_manager', 'workshop_manager'];
function canActOnStore(user) {
  if (!user) return false;
  if (user.is_owner === 1 || user.is_owner === true) return true;
  return STORE_ROLES.includes(user.role) || STORE_SLUGS.includes(user.role_slug);
}

/* Local calendar day as YYYY-MM-DD (not toISOString, which is UTC and is
 * yesterday for most of the morning in the Gulf). */
function ymdLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return ymdLocal(new Date(y, m - 1, d + n));
}
function fmtDay(ymd, lang) {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(ymd);
  return new Date(y, m - 1, d).toLocaleDateString(lang || undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtStamp(s, lang) {
  if (!s) return '';
  const str = String(s);
  const d = new Date(str.includes('T') ? str : str.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? str : d.toLocaleString(lang || undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* What the Store has to do with a line. */
function lineState(item, today) {
  if (item.availability === 'not_available') {
    const exp = item.expected_date ? String(item.expected_date).slice(0, 10) : '';
    return exp && exp <= today ? 'recheck' : 'waiting';
  }
  return 'check';
}
const STATE_RANK = { recheck: 0, check: 1, waiting: 2 };

export default function Store() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { user } = useContext(AuthContext);
  const canAct = canActOnStore(user);
  const { toasts, showToast } = useToast();

  const [tab, setTab] = useState('requisitions');
  const [filter, setFilter] = useState('all');           // all | check | recheck | waiting
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [panel, setPanel] = useState({});                // itemId → 'issue' | 'na'
  const [cost, setCost] = useState({});                  // itemId → unit cost text
  const [dates, setDates] = useState({});                // itemId → YYYY-MM-DD
  const [busy, setBusy] = useState(null);
  const [today, setToday] = useState(() => ymdLocal());

  const load = useCallback(async () => {
    try {
      const res = await api.get('/workflow/store/queue');
      if (res.success) {
        setItems(res.data?.items || []);
        setEstimates(res.data?.estimates || []);
        setLoadError('');
      } else {
        setLoadError(res.message || t('store.load_failed', 'Could not load the Store queue.'));
      }
    } catch {
      setLoadError(t('store.network_error', 'Network error — check the connection and try again.'));
    } finally {
      setLoading(false);
      setToday(ymdLocal());
    }
  }, [t]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  /* ── derived ── */
  const withState = useMemo(
    () => items.map(i => ({ ...i, _state: lineState(i, today) })),
    [items, today]
  );
  const counts = useMemo(() => ({
    all: withState.length,
    check: withState.filter(i => i._state === 'check').length,
    recheck: withState.filter(i => i._state === 'recheck').length,
    waiting: withState.filter(i => i._state === 'waiting').length,
  }), [withState]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = withState.filter(i => {
      if (filter !== 'all' && i._state !== filter) return false;
      if (!q) return true;
      return [i.description, i.part_number, i.work_order_number, i.plate_number, i.job_card_number, i.req_number, i.requested_by_name]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
    const map = new Map();
    for (const i of visible) {
      const key = i.work_order_id;
      if (!map.has(key)) {
        map.set(key, {
          work_order_id: i.work_order_id, work_order_number: i.work_order_number,
          plate_number: i.plate_number, lines: [], rank: 9,
        });
      }
      const g = map.get(key);
      g.lines.push(i);
      g.rank = Math.min(g.rank, STATE_RANK[i._state]);
    }
    const list = [...map.values()];
    list.forEach(g => g.lines.sort((a, b) => STATE_RANK[a._state] - STATE_RANK[b._state]));
    return list.sort((a, b) => a.rank - b.rank);
  }, [withState, filter, search]);

  /* ── actions ── */
  const openPanel = (item, kind) => {
    setPanel(p => ({ ...p, [item.id]: p[item.id] === kind ? null : kind }));
    if (kind === 'na' && !dates[item.id]) {
      const exp = item.expected_date ? String(item.expected_date).slice(0, 10) : '';
      setDates(d => ({ ...d, [item.id]: exp && exp > today ? exp : addDays(today, 1) }));
    }
  };
  const closePanel = (id) => setPanel(p => ({ ...p, [id]: null }));

  const patch = async (item, body, okMsg) => {
    setBusy(item.id);
    try {
      const res = await api.patch(`/workflow/requisition-items/${item.id}`, body);
      if (res.success) {
        showToast(okMsg, 'success');
        closePanel(item.id);
        setCost(c => ({ ...c, [item.id]: '' }));
        await load();
      } else {
        showToast(res.message || t('store.update_failed', 'Could not update the part.'), 'error', 5500);
        if (res.status === 409) load();
      }
    } catch {
      showToast(t('store.network_error', 'Network error — check the connection and try again.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const issue = (item) => {
    const raw = String(cost[item.id] ?? '').trim();
    if (raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) {
      showToast(t('store.bad_cost', 'Unit cost must be a number, 0 or more.'), 'error');
      return;
    }
    const body = { availability: 'available' };
    if (raw !== '') body.unit_cost = Number(raw);
    patch(item, body, t('store.issued_toast', { qty: Number(item.quantity_requested) || 1, part: item.description, defaultValue: 'Issued {{qty}} × {{part}}' }));
  };

  const notAvailable = (item) => {
    const date = dates[item.id];
    if (!date) { showToast(t('store.date_required', 'Pick the expected arrival date.'), 'error'); return; }
    if (date < today) { showToast(t('store.date_past', 'The expected date cannot be in the past.'), 'error'); return; }
    patch(item, { availability: 'not_available', expected_date: date },
      t('store.eta_toast', { date: fmtDay(date, lang), defaultValue: 'Recorded — expected {{date}}. The floor is alerted 24 h before.' }));
  };

  /* ── pieces ── */
  const stateBadge = (i) => {
    if (i._state === 'recheck') {
      return (
        <span className="st-badge st-badge-recheck">
          <WarningTriangle width={12} height={12} /> {t('store.recheck_now', 'Re-check now')}
        </span>
      );
    }
    if (i._state === 'waiting') {
      return (
        <span className="st-badge st-badge-waiting">
          <Hourglass width={12} height={12} /> {t('store.not_available', 'Not available')}
        </span>
      );
    }
    return (
      <span className="st-badge st-badge-check">
        <Search width={12} height={12} /> {t('store.needs_check', 'Check the shelf')}
      </span>
    );
  };

  const etaLine = (i) => {
    if (i.availability !== 'not_available' || !i.expected_date) return null;
    const exp = String(i.expected_date).slice(0, 10);
    const overdue = exp < today;
    return (
      <div className={`st-eta${i._state === 'recheck' ? ' st-eta-hot' : ''}`}>
        <span>
          <Calendar width={13} height={13} />
          {exp === today
            ? t('store.expected_today', 'Expected today')
            : overdue
              ? t('store.expected_overdue', { date: fmtDay(exp, lang), defaultValue: 'Was expected {{date}}' })
              : t('store.expected_on', { date: fmtDay(exp, lang), defaultValue: 'Expected {{date}}' })}
        </span>
        <span className="st-alert">
          <Bell width={13} height={13} />
          {i.eta_alerted_at
            ? t('store.alert_sent', { when: fmtStamp(i.eta_alerted_at, lang), defaultValue: 'Floor alerted {{when}}' })
            : t('store.alert_due', { date: fmtDay(addDays(exp, -1), lang), defaultValue: '24 h alert due {{date}}' })}
        </span>
      </div>
    );
  };

  const FILTERS = [
    { key: 'all', label: t('store.filter_all', 'All lines'), cls: '' },
    { key: 'recheck', label: t('store.filter_recheck', 'Re-check now'), cls: 'st-tile-hot' },
    { key: 'check', label: t('store.filter_check', 'To check'), cls: 'st-tile-check' },
    { key: 'waiting', label: t('store.filter_waiting', 'Waiting for parts to arrive'), cls: 'st-tile-wait' },
  ];

  return (
    <div className="st-wrap">
      <header className="st-head">
        <div>
          <h1 className="st-title"><Archive width={24} height={24} /> {t('store.title', 'Store')}</h1>
          <p className="st-sub">{t('store.subtitle', 'Parts requested from the floor, and estimate parts waiting for a price.')}</p>
        </div>
        <button type="button" className="st-btn st-btn-ghost" onClick={() => { setLoading(true); load(); }}>
          <Refresh width={15} height={15} /> {t('store.refresh', 'Refresh')}
        </button>
      </header>

      {!canAct && (
        <div className="st-note">
          <User width={15} height={15} />
          {t('store.view_only', 'View only — issuing parts and recording expected arrival dates is done by the Store (Storekeeper or Part Advisor) or a manager.')}
        </div>
      )}

      <div className="st-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'requisitions'}
          className={`st-tab${tab === 'requisitions' ? ' st-tabOn' : ''}`} onClick={() => setTab('requisitions')}>
          <Package width={16} height={16} /> {t('store.tab_requisitions', 'Requisitions')}
          <span className="st-count">{counts.all}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'pricing'}
          className={`st-tab${tab === 'pricing' ? ' st-tabOn' : ''}`} onClick={() => setTab('pricing')}>
          <PageEdit width={16} height={16} /> {t('store.tab_pricing', 'Parts to price')}
          <span className="st-count">{estimates.length}</span>
        </button>
      </div>

      {loadError && !loading && (
        <div className="st-error">
          <WarningTriangle width={16} height={16} /> {loadError}
          <button type="button" className="st-link" onClick={() => { setLoading(true); load(); }}>{t('store.retry', 'Try again')}</button>
        </div>
      )}

      {/* ══ Requisitions ══ */}
      {tab === 'requisitions' && (
        <>
          <div className="st-tiles">
            {FILTERS.map(f => (
              <button key={f.key} type="button"
                className={`st-tile ${f.cls}${filter === f.key ? ' st-tileOn' : ''}`}
                onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}>
                <span className="st-tile-n">{counts[f.key]}</span>
                <span className="st-tile-l">{f.label}</span>
              </button>
            ))}
          </div>

          <div className="st-searchWrap">
            <Search width={15} height={15} />
            <input className="st-search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('store.search_placeholder', 'Part, work order, plate, job card…')} />
            {search && (
              <button type="button" className="st-clear" onClick={() => setSearch('')} aria-label={t('store.clear', 'Clear')}>
                <Xmark width={14} height={14} />
              </button>
            )}
          </div>

          {loading && items.length === 0 ? (
            <div className="st-empty">{t('store.loading', 'Loading…')}</div>
          ) : groups.length === 0 ? (
            <div className="st-empty">
              <CheckCircle width={40} height={40} className="st-empty-ico" />
              <div className="st-empty-title">
                {counts.all === 0
                  ? t('store.empty_all', 'Nothing to do — no open requisitions.')
                  : t('store.empty_filter', 'No lines match this filter.')}
              </div>
              <div className="st-empty-hint">
                {counts.all === 0
                  ? t('store.empty_all_hint', 'When a technician requests parts on a job card, the lines appear here.')
                  : (
                    <button type="button" className="st-link" onClick={() => { setFilter('all'); setSearch(''); }}>
                      {t('store.show_all', 'Show all lines')}
                    </button>
                  )}
              </div>
            </div>
          ) : (
            <div className="st-groups">
              {groups.map(g => (
                <section key={g.work_order_id} className={`st-group${g.rank === 0 ? ' st-group-hot' : ''}`}>
                  <header className="st-group-head">
                    <Link to={`/work-orders/${g.work_order_id}`} className="st-wo">
                      {g.work_order_number} <NavArrowRight width={14} height={14} />
                    </Link>
                    {g.plate_number && <span className="st-plate"><Car width={13} height={13} /> {g.plate_number}</span>}
                    <span className="st-group-n">
                      {t('store.lines_count', { count: g.lines.length, defaultValue: '{{count}} line(s)' })}
                    </span>
                  </header>

                  <ul className="st-lines">
                    {g.lines.map(i => {
                      const open = panel[i.id];
                      const isBusy = busy === i.id;
                      return (
                        <li key={i.id} className={`st-line st-line-${i._state}`}>
                          <div className="st-line-top">
                            <div className="st-line-main">
                              <div className="st-part">
                                <span className="st-qty">{Number(i.quantity_requested) || 1}×</span> {i.description}
                                {i.part_number && <span className="st-pn">{i.part_number}</span>}
                              </div>
                              <div className="st-meta">
                                <Link to={`/work-orders/${i.work_order_id}`} className="st-meta-link">
                                  {i.job_card_number}{i.job_card_title ? ` · ${i.job_card_title}` : ''}
                                </Link>
                                <span>· {i.req_number}</span>
                                {i.requested_by_name && <span>· {i.requested_by_name}</span>}
                                {i.requested_at && <span className="st-nowrap">· <Clock width={11} height={11} /> {fmtStamp(i.requested_at, lang)}</span>}
                              </div>
                            </div>
                            {stateBadge(i)}
                          </div>

                          {etaLine(i)}

                          {canAct && (
                            <div className="st-actions">
                              <button type="button" className={`st-btn st-btn-issue${open === 'issue' ? ' is-on' : ''}`}
                                disabled={isBusy} onClick={() => openPanel(i, 'issue')}>
                                <CheckCircle width={15} height={15} /> {t('store.on_shelf', 'On the shelf — Issue')}
                              </button>
                              <button type="button" className={`st-btn st-btn-na${open === 'na' ? ' is-on' : ''}`}
                                disabled={isBusy} onClick={() => openPanel(i, 'na')}>
                                <Calendar width={15} height={15} />
                                {i.availability === 'not_available'
                                  ? t('store.change_date', 'Still not here — new date')
                                  : t('store.not_on_shelf', 'Not available')}
                              </button>
                            </div>
                          )}

                          {canAct && open === 'issue' && (
                            <div className="st-panel st-panel-issue">
                              <label className="st-field">
                                <span>{t('store.unit_cost', 'Unit cost (optional)')}</span>
                                <input type="number" inputMode="decimal" min="0" step="0.01" className="st-input"
                                  value={cost[i.id] ?? ''} placeholder="0.00"
                                  onChange={e => setCost(c => ({ ...c, [i.id]: e.target.value }))} />
                              </label>
                              <div className="st-panel-actions">
                                <button type="button" className="st-btn st-btn-ghost" onClick={() => closePanel(i.id)}>
                                  {t('store.cancel', 'Cancel')}
                                </button>
                                <button type="button" className="st-btn st-btn-primary" disabled={isBusy} onClick={() => issue(i)}>
                                  {isBusy ? <span className="st-spin" /> : <CheckCircle width={15} height={15} />}
                                  {t('store.issue_confirm', { qty: Number(i.quantity_requested) || 1, defaultValue: 'Issue {{qty}} to the job card' })}
                                </button>
                              </div>
                            </div>
                          )}

                          {canAct && open === 'na' && (
                            <div className="st-panel st-panel-na">
                              <label className="st-field">
                                <span>{t('store.expected_date', 'Expected arrival date')}</span>
                                <input type="date" className="st-input" min={today}
                                  value={dates[i.id] || ''}
                                  onChange={e => setDates(d => ({ ...d, [i.id]: e.target.value }))} />
                              </label>
                              <div className="st-panel-hint">
                                {t('store.eta_hint', 'The floor and the technician are told now, and alerted again 24 hours before this date.')}
                              </div>
                              <div className="st-panel-actions">
                                <button type="button" className="st-btn st-btn-ghost" onClick={() => closePanel(i.id)}>
                                  {t('store.cancel', 'Cancel')}
                                </button>
                                <button type="button" className="st-btn st-btn-warn" disabled={isBusy || !dates[i.id]} onClick={() => notAvailable(i)}>
                                  {isBusy ? <span className="st-spin" /> : <Calendar width={15} height={15} />}
                                  {t('store.save_date', 'Save expected date')}
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* ══ Parts to price ══ */}
      {tab === 'pricing' && (
        loading && estimates.length === 0 ? (
          <div className="st-empty">{t('store.loading', 'Loading…')}</div>
        ) : estimates.length === 0 ? (
          <div className="st-empty">
            <CheckCircle width={40} height={40} className="st-empty-ico" />
            <div className="st-empty-title">{t('store.empty_pricing', 'No estimates are waiting for part prices.')}</div>
            <div className="st-empty-hint">{t('store.empty_pricing_hint', 'Draft estimates with unpriced part lines show up here.')}</div>
          </div>
        ) : (
          <ul className="st-estimates">
            {estimates.map(e => (
              <li key={e.id}>
                <Link to={`/estimates?id=${e.id}`} className="st-est">
                  <div className="st-est-main">
                    <div className="st-est-no">{e.estimate_number}</div>
                    <div className="st-est-meta">
                      {e.customer_name || t('store.no_customer', 'No customer name')}
                      {e.vehicle_plate && <span className="st-plate st-plate-sm">{e.vehicle_plate}</span>}
                    </div>
                  </div>
                  <div className="st-est-side">
                    <span className="st-badge st-badge-check">
                      {t('store.part_lines', { count: Number(e.part_lines) || 0, defaultValue: '{{count}} part line(s) to price' })}
                    </span>
                    <span className="st-est-date">{fmtStamp(e.created_at, lang)}</span>
                  </div>
                  <NavArrowRight width={18} height={18} className="st-est-arrow" />
                </Link>
              </li>
            ))}
          </ul>
        )
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
