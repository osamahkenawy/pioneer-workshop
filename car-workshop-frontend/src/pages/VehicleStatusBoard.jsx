/**
 * VehicleStatusBoard — every car in the workshop, by process step (Steps 1–7
 * of the workshop workflow), and who it is waiting on. It replaces Service
 * Tracking (/service-tracking redirects here) and is often shown on a wall TV.
 *
 * Read-only: every action opens the job card or sends the customer their
 * status link. One call, GET /api/vehicle-board, places each car in a column
 * (backend lib/job-phase.js); the side panel reads the job card's own
 * workflow for one car.
 *
 *   tiles      Cars in workshop · Reception · Inspection & pricing · With
 *              customer · In work · Quality check · Ready for collection ·
 *              Closed today — clickable filters (?phase=)
 *   board      one column per step, oldest first; or a sortable list
 *   TV mode    full screen, no side panel, refresh every 30 s
 *   phone      step chips, search, filters in a bottom sheet, full-width cards
 *
 * Refreshes every 60 s while the tab is visible, on focus, and shortly after
 * a job changes status (socket).
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Car, Refresh, Tv, Xmark, ViewColumns3, List, NavArrowLeft, NavArrowRight, WarningTriangle,
} from 'iconoir-react';
import api from '../lib/api';
import { getSocket } from '../lib/socketClient';
import { AuthContext } from '../context/AuthContext';
import Toast, { useToast } from '../components/Toast';
import BoardCard from '../components/vehicle-board/BoardCard';
import BoardDrawer from '../components/vehicle-board/BoardDrawer';
import BoardFilters, { activeFilterCount } from '../components/vehicle-board/BoardFilters';
import BoardList from '../components/vehicle-board/BoardList';
import { useBoardActions } from '../components/vehicle-board/actions';
import {
  OPEN_PHASES, PHASES, PHASE_ICON, boardOrder, fmtTime, phaseBg, phaseColor, phaseLabel, readStore, stepsLabel, whoLabel, writeStore,
} from '../components/vehicle-board/board';
import './VehicleStatusBoard.css';

const REFRESH_MS = 60000;
const TV_REFRESH_MS = 30000;
const COLUMN_PAGE = 40;
const PHONE_PAGE = 30;
// A job moving on the floor refreshes the board a moment later.
const SOCKET_EVENTS = ['work-order:status-changed', 'work-order:mechanic-assigned'];
const EMPTY_FILTERS = { q: '', cls: '', sub: '', department: '', team_leader_id: '', late: false, include_legacy: false };

function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia(query);
    const onChange = () => setOn(m.matches);
    onChange();
    m.addEventListener?.('change', onChange);
    return () => m.removeEventListener?.('change', onChange);
  }, [query]);
  return on;
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** "Waiting on: Storekeeper 2 · Service Advisor 1" for a column. */
function waitingSummary(t, items) {
  const by = new Map();
  for (const i of items) if (i.waiting_on) by.set(i.waiting_on.key, (by.get(i.waiting_on.key) || 0) + 1);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (!top.length) return null;
  const who = top.map(([k, n]) => (by.size > 1 ? `${whoLabel(t, k)} ${n}` : whoLabel(t, k))).join(' · ');
  return t('vehicleBoard.waiting_on', 'Waiting on: {{who}}', { who });
}

export default function VehicleStatusBoard() {
  const { t } = useTranslation();
  const { workshop } = useContext(AuthContext) || {};
  const currency = workshop?.currency || 'AED';
  const { toasts, showToast } = useToast();
  const actions = useBoardActions(showToast);
  const phone = useMedia('(max-width: 767px)');

  const [params, setParams] = useSearchParams();
  const phaseParam = params.get('phase');
  const phase = PHASES.includes(phaseParam) ? phaseParam : 'all';
  const setPhase = useCallback(p => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (p === 'all') next.delete('phase'); else next.set('phase', p);
      return next;
    }, { replace: true });
  }, [setParams]);

  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, q: params.get('q') || '' }));
  const setFilter = useCallback((key, value) => setFilters(f => ({ ...f, [key]: value })), []);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const q = useDebounced(filters.q.trim(), 300);

  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error | forbidden
  const [refreshing, setRefreshing] = useState(false);
  const [view, setViewState] = useState(() => (readStore('vsb.view') === 'list' ? 'list' : 'board'));
  const setView = v => { setViewState(v); writeStore('vsb.view', v); };
  const [tv, setTv] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [limits, setLimits] = useState({});
  const [closedOpen, setClosedOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const lastLoad = useRef(0);
  const reqId = useRef(0);
  const opener = useRef(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (filters.cls) p.set('class', filters.cls);
    if (filters.sub) p.set('sub', filters.sub);
    if (filters.department) p.set('department', filters.department);
    if (filters.team_leader_id) p.set('team_leader_id', filters.team_leader_id);
    if (filters.late) p.set('late', '1');
    if (filters.include_legacy) p.set('include_legacy', '1');
    return p.toString();
  }, [q, filters.cls, filters.sub, filters.department, filters.team_leader_id, filters.late, filters.include_legacy]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setRefreshing(true);
    try {
      const res = await api.get(`/vehicle-board${queryString ? `?${queryString}` : ''}`);
      if (id !== reqId.current) return;
      if (res?.status === 403) { setStatus('forbidden'); return; }
      if (!res?.success) throw new Error(res?.message || 'load');
      setData(res.data);
      setStatus('ready');
      lastLoad.current = Date.now();
    } catch {
      if (id !== reqId.current) return;
      // Once the board has loaded, a failed refresh keeps it on screen.
      if (lastLoad.current) showToast(t('vehicleBoard.refresh_failed', "Couldn't refresh — showing the last update"), 'warning');
      else setStatus('error');
    } finally {
      if (id === reqId.current) setRefreshing(false);
    }
  }, [queryString, showToast, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setLimits({}); }, [queryString, phase]);

  // Every minute (30 s on the TV) while the tab is visible; at once on coming
  // back; and a few seconds after a job changes status.
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) load(); }, tv ? TV_REFRESH_MS : REFRESH_MS);
    const onBack = () => { if (!document.hidden && Date.now() - lastLoad.current > 15000) load(); };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    const socket = getSocket();
    let debounce;
    const kick = () => { clearTimeout(debounce); debounce = setTimeout(() => { if (!document.hidden) load(); }, 3000); };
    SOCKET_EVENTS.forEach(ev => socket.on(ev, kick));
    return () => {
      clearInterval(timer);
      clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
      SOCKET_EVENTS.forEach(ev => socket.off(ev, kick));
    };
  }, [load, tv]);

  // ── TV mode ────────────────────────────────────────────────────
  const exitTv = useCallback(() => {
    setTv(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);
  const enterTv = () => {
    setSelectedId(null);
    setTv(true);
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ }
  };
  useEffect(() => {
    document.body.classList.toggle('vsb-tv', tv);
    if (!tv) return () => document.body.classList.remove('vsb-tv');
    const onFs = () => { if (!document.fullscreenElement) setTv(false); };
    const onKey = e => { if (e.key === 'Escape') exitTv(); };
    const tick = setInterval(() => setClock(new Date()), 15000);
    setClock(new Date());
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('vsb-tv');
      clearInterval(tick);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('keydown', onKey);
    };
  }, [tv, exitTv]);

  // ── Selection (side panel) ─────────────────────────────────────
  const items = data?.items || [];
  const lateMinutes = useMemo(() => Object.fromEntries((data?.phases || []).map(p => [p.key, p.late_minutes])), [data]);
  const [snapshot, setSnapshot] = useState(null);
  const selected = selectedId ? items.find(i => i.id === selectedId) || snapshot : null;
  const openItem = useCallback(item => {
    opener.current = document.activeElement;
    setSnapshot(item);
    setSelectedId(item.id);
  }, []);
  const closeItem = useCallback(() => {
    setSelectedId(null);
    const el = opener.current;
    if (el && document.contains(el)) setTimeout(() => el.focus(), 0);
  }, []);
  // On a phone, keep the chosen step's chip in view.
  const chipsRef = useRef(null);
  const hasData = !!data;
  useEffect(() => {
    if (!phone || !hasData) return;
    chipsRef.current?.querySelector('.vsb-phase-chip.is-on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [phone, phase, hasData]);

  // The page behind the side panel does not scroll.
  const panelOpen = !!selectedId;
  useEffect(() => {
    if (!panelOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [panelOpen]);

  const counts = data?.counts || {};
  const byPhase = useMemo(() => {
    const m = Object.fromEntries(PHASES.map(p => [p, []]));
    for (const i of items) (m[i.phase] || (m[i.phase] = [])).push(i);
    return m;
  }, [items]);
  const openItems = useMemo(() => items.filter(i => i.phase !== 'closed').sort(boardOrder), [items]);
  const visible = phase === 'all' ? openItems : byPhase[phase] || [];
  const filtered = !!q || activeFilterCount(filters) > 0;
  const showMore = key => setLimits(l => ({ ...l, [key]: (l[key] || (phone ? PHONE_PAGE : COLUMN_PAGE)) + (phone ? PHONE_PAGE : COLUMN_PAGE) }));
  const limitOf = key => limits[key] || (phone ? PHONE_PAGE : COLUMN_PAGE);
  const effectiveView = tv ? 'board' : view;

  const tiles = [
    { key: 'all', label: t('vehicleBoard.tile.in_workshop', 'Cars in workshop'), count: counts.in_workshop,
      sub: counts.late ? t('vehicleBoard.tile.late_n', '{{n}} late', { n: counts.late }) : null, subTone: 'late' },
    ...PHASES.map(p => ({
      key: p, label: phaseLabel(t, p), count: p === 'closed' ? counts.closed_today : counts[p],
      sub: p === 'work' && counts.parts_waiting ? t('vehicleBoard.parts_waiting_n', '{{n}} waiting for parts', { n: counts.parts_waiting }) : stepsLabel(t, p),
      subTone: p === 'work' && counts.parts_waiting ? 'warn' : null,
    })),
  ];

  const updated = data?.generated_at ? t('vehicleBoard.updated', 'Updated {{time}}', { time: fmtTime(data.generated_at) }) : '';

  // ── Empty / error states ───────────────────────────────────────
  const emptyMessage = () => {
    if (q) return t('vehicleBoard.empty.search', "No job matches '{{q}}'", { q });
    if (filtered) return t('vehicleBoard.empty.filters', 'No cars match these filters.');
    if (phase !== 'all') return t('vehicleBoard.empty.column', 'No cars in this step');
    return t('vehicleBoard.empty.board', 'No cars in the workshop right now.');
  };
  const Empty = () => (
    <div className="vsb-empty">
      <Car width={32} height={32} aria-hidden="true" />
      <p>{emptyMessage()}</p>
      {filtered && <button type="button" className="vsb-btn" onClick={clearFilters}>{t('vehicleBoard.filter.clear', 'Clear filters')}</button>}
    </div>
  );

  const renderCards = (list, key) => {
    const limit = limitOf(key);
    return (
      <>
        {list.slice(0, limit).map(i => (
          <BoardCard key={i.id} item={i} lateMinutes={lateMinutes} onOpen={openItem} interactive={!tv} selected={selectedId === i.id} />
        ))}
        {list.length > limit && !tv && (
          <button type="button" className="vsb-more" onClick={() => showMore(key)}>
            {t('vehicleBoard.show_more', 'Show more ({{n}} left)', { n: list.length - limit })}
          </button>
        )}
        {list.length > limit && tv && <div className="vsb-more is-static">{t('vehicleBoard.more_n', '+{{n}} more', { n: list.length - limit })}</div>}
      </>
    );
  };

  const column = p => {
    const list = byPhase[p] || [];
    const Icon = PHASE_ICON[p];
    const isClosed = p === 'closed';
    if (isClosed && !closedOpen && !tv) {
      return (
        <section key={p} className="vsb-col is-collapsed" aria-label={phaseLabel(t, p)}>
          <button type="button" className="vsb-col-expand" onClick={() => setClosedOpen(true)} aria-expanded="false"
            title={t('vehicleBoard.expand', 'Show')}>
            <span className="vsb-col-count" style={{ background: phaseBg(p), color: phaseColor(p) }}>{list.length}</span>
            <span className="vsb-col-vertical">{phaseLabel(t, p)}</span>
            <NavArrowLeft width={16} height={16} className="vsb-flip" aria-hidden="true" />
          </button>
        </section>
      );
    }
    const summary = waitingSummary(t, list);
    return (
      <section key={p} className="vsb-col" aria-label={phaseLabel(t, p)} style={{ '--vsb-accent': phaseColor(p) }}>
        <header className="vsb-col-head">
          <div className="vsb-col-title">
            <Icon width={16} height={16} aria-hidden="true" style={{ color: phaseColor(p) }} />
            <span>{phaseLabel(t, p)}</span>
            <span className="vsb-col-count" style={{ background: phaseBg(p), color: phaseColor(p) }}>{list.length}</span>
            {isClosed && !tv && (
              <button type="button" className="vsb-icon-btn is-sm" onClick={() => setClosedOpen(false)} aria-expanded="true"
                aria-label={t('vehicleBoard.collapse', 'Hide')}>
                <NavArrowRight width={16} height={16} className="vsb-flip" />
              </button>
            )}
          </div>
          <div className="vsb-col-meta">
            {stepsLabel(t, p)}{summary ? <> · {summary}</> : null}
          </div>
        </header>
        <div className="vsb-col-body">
          {list.length ? renderCards(list, p) : <div className="vsb-col-empty">{t('vehicleBoard.empty.column', 'No cars in this step')}</div>}
        </div>
      </section>
    );
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className={`vsb-page${tv ? ' is-tv' : ''}${phone ? ' is-phone' : ''}`}>
      <Toast toasts={toasts} />

      {tv ? (
        <header className="vsb-tv-head">
          <div className="vsb-tv-title">
            <Car width={28} height={28} aria-hidden="true" />
            <h1>{t('vehicleBoard.title', 'Vehicle Status Board')}</h1>
          </div>
          <div className="vsb-tv-clock" aria-live="off">{fmtTime(clock)}</div>
          <div className="vsb-tv-side">
            <span className="vsb-muted">{updated}</span>
            <button type="button" className="vsb-btn" onClick={exitTv}><Xmark width={18} height={18} /> {t('vehicleBoard.exit_tv', 'Exit TV mode')}</button>
          </div>
        </header>
      ) : phone ? (
        <header className="vsb-phone-head">
          <div>
            <h1 className="vsb-phone-title">{t('vehicleBoard.title', 'Vehicle Status Board')}</h1>
            {updated && <div className="vsb-muted vsb-small">{updated}</div>}
          </div>
          <button type="button" className="vsb-icon-btn is-outline" onClick={() => load()} disabled={refreshing}
            aria-label={t('vehicleBoard.refresh', 'Refresh')}>
            <Refresh width={20} height={20} className={refreshing ? 'vsb-spin' : ''} />
          </button>
        </header>
      ) : (
        <div className="module-hero">
          <div className="module-hero-left">
            <div className="module-hero-icon"><Car width={26} height={26} /></div>
            <div>
              <h1 className="module-hero-title">{t('vehicleBoard.title', 'Vehicle Status Board')}</h1>
              <p className="module-hero-sub">{t('vehicleBoard.subtitle', 'Every car in the workshop, by process step')}</p>
            </div>
          </div>
          <div className="module-hero-actions">
            {updated && <span className="vsb-updated">{updated}</span>}
            <button type="button" className="module-btn module-btn-outline" onClick={() => load()} disabled={refreshing}>
              <Refresh width={16} height={16} className={refreshing ? 'vsb-spin' : ''} /> {t('vehicleBoard.refresh', 'Refresh')}
            </button>
            <div className="vsb-seg" role="group" aria-label={t('vehicleBoard.view', 'View')}>
              <button type="button" className={view === 'board' ? 'is-on' : ''} aria-pressed={view === 'board'} onClick={() => setView('board')}>
                <ViewColumns3 width={16} height={16} /> {t('vehicleBoard.view_board', 'Board')}
              </button>
              <button type="button" className={view === 'list' ? 'is-on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>
                <List width={16} height={16} /> {t('vehicleBoard.view_list', 'List')}
              </button>
            </div>
            <button type="button" className="module-btn module-btn-outline" onClick={enterTv}>
              <Tv width={16} height={16} /> {t('vehicleBoard.tv_mode', 'TV mode')}
            </button>
          </div>
        </div>
      )}

      {status === 'loading' && !data && (
        <div className="vsb-state"><span className="vsb-spinner" aria-hidden="true" />{t('vehicleBoard.loading', 'Loading…')}</div>
      )}
      {status === 'error' && !data && (
        <div className="vsb-state is-error">
          <WarningTriangle width={28} height={28} aria-hidden="true" />
          <p>{t('vehicleBoard.error', "Couldn't load the board.")}</p>
          <button type="button" className="vsb-btn is-primary" onClick={() => { setStatus('loading'); load(); }}><Refresh width={16} height={16} /> {t('vehicleBoard.retry', 'Retry')}</button>
        </div>
      )}
      {status === 'forbidden' && (
        <div className="vsb-state">
          <p>{t('vehicleBoard.forbidden', 'The Vehicle Status Board is not available for your role.')}</p>
        </div>
      )}

      {data && status !== 'forbidden' && (
        <>
          {/* Tiles (desktop, tablet) or step chips (phone) */}
          {phone ? (
            <nav ref={chipsRef} className="vsb-phase-chips" aria-label={t('vehicleBoard.steps_nav', 'Process steps')}>
              {tiles.map(tile => (
                <button key={tile.key} type="button" className={`vsb-phase-chip${phase === tile.key ? ' is-on' : ''}`}
                  aria-pressed={phase === tile.key} onClick={() => setPhase(tile.key)}
                  style={tile.key !== 'all' ? { '--vsb-accent': phaseColor(tile.key) } : undefined}>
                  {tile.key === 'all' ? t('vehicleBoard.tile.all_open', 'All open') : tile.label}
                  <span className="vsb-chip-count">{tile.count ?? 0}</span>
                </button>
              ))}
            </nav>
          ) : !tv && (
            <div className="vsb-tiles" role="group" aria-label={t('vehicleBoard.steps_nav', 'Process steps')}>
              {tiles.map(tile => (
                <button key={tile.key} type="button" className={`vsb-tile${phase === tile.key ? ' is-on' : ''}`}
                  aria-pressed={phase === tile.key} onClick={() => setPhase(phase === tile.key && tile.key !== 'all' ? 'all' : tile.key)}
                  style={{ '--vsb-accent': tile.key === 'all' ? 'var(--primary, #1e3a6b)' : phaseColor(tile.key) }}>
                  <span className="vsb-tile-label">{tile.label}</span>
                  <span className="vsb-tile-count">{tile.count ?? 0}</span>
                  {tile.sub && <span className={`vsb-tile-sub${tile.subTone ? ` is-${tile.subTone}` : ''}`}>{tile.sub}</span>}
                </button>
              ))}
            </div>
          )}

          {!tv && (
            <BoardFilters filters={filters} setFilter={setFilter} clearFilters={clearFilters} counts={counts} items={items} liveSince={data.process_live_since}
              teamLeaders={data.team_leaders} canFilterTeam={!!data.you?.can_filter_team} phone={phone} />
          )}

          {refreshing && <div className="vsb-progress" aria-hidden="true" />}

          {phone ? (
            visible.length ? (
              <div className="vsb-phone-list">{renderCards(visible, `phone-${phase}`)}</div>
            ) : <Empty />
          ) : effectiveView === 'list' ? (
            visible.length ? (
              <BoardList items={visible} lateMinutes={lateMinutes} onOpen={openItem} actions={actions} currency={currency} selectedId={selectedId} />
            ) : <Empty />
          ) : phase === 'all' ? (
            items.length ? (
              <div className="vsb-board">
                {OPEN_PHASES.map(column)}
                {column('closed')}
              </div>
            ) : <Empty />
          ) : visible.length ? (
            <div className="vsb-grid">{renderCards(visible, phase)}</div>
          ) : <Empty />}
        </>
      )}

      {selected && !tv && (
        <BoardDrawer item={selected} sheet={phone} onClose={closeItem} actions={actions} />
      )}
    </div>
  );
}
