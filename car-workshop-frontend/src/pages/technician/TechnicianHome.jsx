/**
 * TechnicianHome — "My Jobs" (/mechanic), the technician's screen for Step 6.
 *
 *   header      date, "Hi, {name}", the clock pill, Scan job card, Refresh
 *   today       time booked, jobs done, waiting for QC, rework (no money)
 *   bookings    today's windows from the Team Leader
 *   job cards   To do · Waiting for QC · Finished → (/mechanic/history)
 *
 * One request (GET /api/job-cards/mine), refreshed every 30 s, on focus and
 * after every action. ?wo=:id (old notification links) opens the first of
 * my job cards on that work order.
 *
 * Desktop (≥ 992px): the list on the left, today and bookings in a sticky
 * right rail. Phone: one column, 16px gutters.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QrCode, Refresh, Wrench, WarningTriangle, NavArrowRight } from 'iconoir-react';
import { AuthContext } from '../../context/AuthContext';
import Toast, { useToast } from '../../components/Toast';
import { useMyJobs, useNow } from '../../components/technician/useMyJobs';
import ClockPill from '../../components/technician/ClockPill';
import TodayStrip from '../../components/technician/TodayStrip';
import TodaySchedule from '../../components/technician/TodaySchedule';
import JobCardTile from '../../components/technician/JobCardTile';
import { todayLabel } from '../../components/technician/format';
import '../../components/technician/technician.css';

/** To do, in this order: rework, running, paused, parts issued, started, not started, waiting for parts. */
function todoRank(c) {
  if (c.status === 'qc_failed') return 0;
  if (c.time_state === 'running') return 1;
  if (c.time_state === 'paused') return 2;
  if (c.status === 'parts_issued') return 3;
  if (c.status === 'in_progress') return 4;
  if (c.status === 'open') return 5;
  if (c.status === 'parts_requested') return 6;
  return 7;
}

export default function TechnicianHome() {
  const { t, i18n } = useTranslation();
  const { user } = useContext(AuthContext);
  const { toasts, showToast } = useToast();
  const [params] = useSearchParams();
  const { data, cards, summary, bookings, mechanicId, serverTime, loading, error, fetchedAt, refresh } = useMyJobs();
  const now = useNow();
  const [filter, setFilter] = useState('todo');
  const [toggled, setToggled] = useState({});       // job card id → expanded, as the technician set it
  const [highlight, setHighlight] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const handledWo = useRef(null);

  const todo = useMemo(() => cards.filter(c => c.status !== 'qc_pending').sort((a, b) => todoRank(a) - todoRank(b)), [cards]);
  const waiting = useMemo(() => cards.filter(c => c.status === 'qc_pending'), [cards]);
  const list = filter === 'qc' ? waiting : todo;

  const isExpanded = (c) => (c.id in toggled ? toggled[c.id] : cards.length === 1 || c.time_state === 'running');

  /** Show one card: right filter, expanded, scrolled into view and outlined for a moment. */
  const openCard = useCallback((id) => {
    const card = cards.find(c => Number(c.id) === Number(id));
    if (!card) return;
    setFilter(card.status === 'qc_pending' ? 'qc' : 'todo');
    setToggled(p => ({ ...p, [card.id]: true }));
    setHighlight(card.id);
    requestAnimationFrame(() => {
      document.getElementById(`tk-card-${card.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [cards]);

  useEffect(() => {
    if (!highlight) return undefined;
    const id = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(id);
  }, [highlight]);

  // ?wo=:id — open the first of my job cards on that work order, once.
  useEffect(() => {
    const wo = params.get('wo');
    if (!wo || !cards.length || handledWo.current === wo) return;
    handledWo.current = wo;
    const card = cards.find(c => String(c.work_order_id) === wo);
    if (card) openCard(card.id);
  }, [params, cards, openCard]);

  const doRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const firstName = String(user?.full_name || user?.username || '').trim().split(/\s+/)[0];
  const runningExtra = summary?.running ? Math.max(0, (now - fetchedAt) / 60000) : 0;

  return (
    <div className="tk-page tk-home">
      {/* ── header ── */}
      <header className="tk-head">
        <div className="tk-head-top">
          <div className="tk-head-who">
            <div className="tk-date">{todayLabel(i18n.language)}</div>
            <h1 className="tk-hello">
              {firstName ? t('technician.greeting', { name: firstName, defaultValue: 'Hi, {{name}}' }) : t('technician.my_jobs', 'My Jobs')}
            </h1>
          </div>
          <div className="tk-head-actions">
            <Link to="/mechanic/scan" className="tk-icon-btn tk-icon-btn--lg" aria-label={t('technician.scan_job_card', 'Scan job card')} title={t('technician.scan_job_card', 'Scan job card')}>
              <QrCode width={22} height={22} />
            </Link>
            <button type="button" className="tk-icon-btn tk-icon-btn--lg" onClick={doRefresh} disabled={refreshing}
              aria-label={t('technician.refresh', 'Refresh')} title={t('technician.refresh', 'Refresh')}>
              <Refresh width={20} height={20} className={refreshing ? 'tk-rotating' : ''} />
            </button>
          </div>
        </div>
        <ClockPill summary={summary} serverTime={serverTime} fetchedAt={fetchedAt} now={now} onOpen={openCard} />
      </header>

      {error && (
        <div className="tk-banner tk-banner--error" role="alert">
          <WarningTriangle width={18} height={18} aria-hidden="true" />
          <span>{t('technician.load_error', "Couldn't load your jobs. Tap Retry.")}</span>
          <button type="button" className="tk-btn tk-btn--ghost tk-btn--sm" onClick={doRefresh}>{t('technician.retry', 'Retry')}</button>
        </div>
      )}

      {/* ── today (right rail on desktop) ── */}
      <aside className="tk-rail">
        <TodayStrip summary={summary} runningExtraMin={runningExtra}
          onWaitingQc={() => { setFilter('qc'); document.getElementById('tk-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
          onRework={() => { setFilter('todo'); document.getElementById('tk-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
        <TodaySchedule bookings={bookings} />
      </aside>

      {/* ── job cards ── */}
      <section className="tk-main" id="tk-list" aria-label={t('technician.my_jobs', 'My Jobs')}>
        <div className="tk-chips" role="group" aria-label={t('technician.filter_label', 'Show')}>
          <button type="button" className={`tk-chip-btn${filter === 'todo' ? ' is-on' : ''}`} aria-pressed={filter === 'todo'} onClick={() => setFilter('todo')}>
            {t('technician.filter_todo', { n: todo.length, defaultValue: 'To do ({{n}})' })}
          </button>
          <button type="button" className={`tk-chip-btn${filter === 'qc' ? ' is-on' : ''}`} aria-pressed={filter === 'qc'} onClick={() => setFilter('qc')}>
            {t('technician.filter_qc', { n: waiting.length, defaultValue: 'Waiting for QC ({{n}})' })}
          </button>
          <Link to="/mechanic/history" className="tk-chip-btn tk-chip-btn--link">
            {t('technician.filter_finished', 'Finished')} <NavArrowRight width={14} height={14} aria-hidden="true" className="tk-flip" />
          </Link>
        </div>

        {!data && loading ? (
          <div className="tk-empty" aria-busy="true">
            <span className="tk-spin tk-spin--dark" aria-hidden="true" />
            <p>{t('technician.loading', 'Loading your jobs…')}</p>
          </div>
        ) : !data ? null /* the first load failed: the banner above says so */ : mechanicId === null ? (
          <div className="tk-empty">
            <WarningTriangle width={32} height={32} aria-hidden="true" />
            <p className="tk-empty-title">{t('technician.no_profile', 'This login is not linked to a technician. Ask your manager to link it.')}</p>
          </div>
        ) : list.length === 0 ? (
          <div className="tk-empty">
            <Wrench width={32} height={32} aria-hidden="true" />
            <p className="tk-empty-title">
              {filter === 'qc'
                ? t('technician.qc_empty', 'Nothing is waiting for the quality check.')
                : t('technician.empty', 'No job cards assigned to you right now. When the Team Leader assigns you a job it appears here and you get a notification.')}
            </p>
          </div>
        ) : (
          <div className="tk-cards">
            {list.map(c => (
              <JobCardTile key={c.id} card={c} mode="list" now={now} fetchedAt={fetchedAt}
                expanded={isExpanded(c)} onToggle={() => setToggled(p => ({ ...p, [c.id]: !isExpanded(c) }))}
                runningElsewhere={summary?.running} onChanged={refresh} showToast={showToast} highlight={highlight === c.id} />
            ))}
          </div>
        )}
      </section>
      <Toast toasts={toasts} />
    </div>
  );
}
