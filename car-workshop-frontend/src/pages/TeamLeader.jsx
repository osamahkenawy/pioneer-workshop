/**
 * TeamLeader — the Team Board, Steps 6–7 of the workshop workflow
 * (Pioneer_Complete_Workshop_Workflow_Steps_1_to_7.pdf).
 *
 * Left: the floor queues — job cards to assign, sub-job cards, quality checks
 * and rework. The numbers are the same as "Your tasks" (backend
 * lib/floor-queues.js). Right: the team, one row per technician with what
 * they are on and their day as a lane, then the job cards on the team.
 *
 * Everything comes from GET /api/team-leader/overview. The board assigns and
 * books time for technicians with no phone at hand; Job done, the quality
 * check, parts and new sub-job cards stay on the job card.
 */
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import {
  UserPlus, MultiplePages, ShieldCheck, Undo, Flash, OpenNewWindow, Car, Play, Pause, Square, Group,
  PhoneDisabled, Refresh, Search, Check, CheckCircle, Xmark, InfoCircle, WarningTriangle, Box3dPoint,
  Clock, NavArrowRight,
} from 'iconoir-react';
import api from '../lib/api';
import { getSocket } from '../lib/socketClient';
import { jcLabel, jcTone, timeStateLabel, pauseReasonLabel, PAUSE_REASONS, PAUSE_NOTE_MAX } from '../lib/statusLabels';
import './TeamLeader.css';

// Age colours are a visual cue, not a process step (confirm with the client).
const AGE_WARN_MIN = 120;
const AGE_LATE_MIN = 480;
const PAGE = 20;

const QUEUES = [
  { key: 'assign', icon: UserPlus, step: 6 },
  { key: 'assign_sub', icon: MultiplePages, step: 6 },
  { key: 'qc', icon: ShieldCheck, step: 7 },
  { key: 'rework', icon: Undo, step: 7 },
];
const DEFAULT_TAB_ORDER = ['rework', 'assign', 'assign_sub', 'qc'];
const STATES = ['working', 'paused', 'assigned', 'free', 'off'];
const STATE_RANK = { free: 0, assigned: 1, paused: 2, working: 3, off: 9 };
const DEPT_SPECIALTY = { body_paint: ['bodywork'], electrical: ['electrical', 'diagnostics'], tyres: ['tires'] };
const AVATAR_BG = ['#1e3a6b', '#0369a1', '#0e7490', '#7c3aed', '#b45309', '#be185d'];
const TIME_STATUSES = ['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_failed'];
const CARD_FILTERS = ['in_progress', 'parts_requested', 'parts_issued', 'open', 'qc_failed', 'qc_pending'];
const DEPT_EN = { mechanical: 'Mechanical', body_paint: 'Body & paint', electrical: 'Electrical', tyres: 'Tyres', other: 'Other' };
const DURATIONS = [30, 60, 120, 180, 240];
const SOCKET_EVENTS = ['notification:new', 'work-order:status-changed', 'work-order:mechanic-assigned'];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ── Helpers ─────────────────────────────────────────────────────── */

const readStore = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStore = (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };

/** "Hassan (AC & electrical)" → { name: 'Hassan', note: 'AC & electrical' } */
function splitName(full) {
  const s = String(full || '').trim();
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(s);
  return m ? { name: m[1], note: m[2].trim() || null } : { name: s, note: null };
}

/** "Ali (Technician)" → "A"; "Rashid Al Mansouri" → "RM". */
function initials(full) {
  const words = (splitName(full).name.match(/[\p{L}\p{N}]+/gu) || []).filter(w => /\p{L}/u.test(w));
  if (!words.length) return '?';
  const first = [...words[0]][0];
  return (words.length > 1 ? first + [...words[words.length - 1]][0] : first).toUpperCase();
}

/** The server sends naive local DATETIME strings ('YYYY-MM-DD HH:MM:SS'). */
const parseDT = s => {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
};

// The server's clock, corrected for this browser's: set on every load.
let skew = 0;
const nowMs = () => Date.now() + skew;

const formatters = new Map();
const dtf = opts => {
  const lang = i18next.language || 'en';
  const key = `${lang}|${JSON.stringify(opts)}`;
  if (!formatters.has(key)) {
    let f;
    // Latin digits, next to the Latin WO numbers and plates.
    try { f = new Intl.DateTimeFormat(`${lang}-u-nu-latn`, opts); } catch { f = new Intl.DateTimeFormat('en', opts); }
    formatters.set(key, f);
  }
  return formatters.get(key);
};
const HM = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const fmtHM = d => (d ? dtf(HM).format(d) : '');
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtDayHM = d => (!d ? '' : sameDay(d, new Date(nowMs())) ? fmtHM(d) : dtf({ day: 'numeric', month: 'short', ...HM }).format(d));
const fmtFull = d => (d ? dtf({ day: 'numeric', month: 'short', year: 'numeric', ...HM }).format(d) : '');
const fmtDate = d => (d ? dtf({ day: 'numeric', month: 'short' }).format(d) : '');

const fmtDur = min => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return m < 60
    ? i18next.t('teamBoard.dur_m', '{{m}}m', { m })
    : i18next.t('teamBoard.dur_hm', '{{h}}h {{m}}m', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
};
const fmtAge = min => (min >= 1440
  ? i18next.t('teamBoard.age_dh', '{{d}}d {{h}}h', { d: Math.floor(min / 1440), h: Math.floor((min % 1440) / 60) })
  : fmtDur(min));
const ageTone = min => (min < AGE_WARN_MIN ? 'fresh' : min < AGE_LATE_MIN ? 'aging' : 'late');
const minutesSince = (since, fallback = 0) => {
  const d = parseDT(since);
  return d ? Math.max(0, (nowMs() - d.getTime()) / 60000) : Number(fallback) || 0;
};

/** "20 sec" / "3 min" in the UI language, for "Updated … ago". */
const fmtAgo = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  const [n, unit] = s < 60 ? [s, 'second'] : s < 3600 ? [Math.round(s / 60), 'minute'] : [Math.round(s / 3600), 'hour'];
  try {
    return new Intl.NumberFormat(`${i18next.language || 'en'}-u-nu-latn`, { style: 'unit', unit, unitDisplay: 'short' }).format(n);
  } catch { return `${n} ${unit}`; }
};

/** Best technician first: specialty for the department, then who is freest. 'off' always last. */
function rankTechnicians(techs, department) {
  const want = DEPT_SPECIALTY[department];
  const score = x => [x.state === 'off' ? 1 : 0, want ? (want.includes(x.specialty) ? 0 : 1) : 0,
    STATE_RANK[x.state] ?? 5, x.remaining_booked_min || 0, x.open_count || 0];
  return [...techs].sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    return splitName(a.full_name).name.localeCompare(splitName(b.full_name).name);
  });
}

/** datetime-local wants 'YYYY-MM-DDTHH:mm'. */
const toLocalInput = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toSql = v => `${v.replace('T', ' ')}:00`;
const roundUp15 = ms => Math.ceil(ms / 900000) * 900000;

/** A window after their last booking today, as long as the labour on the job card. */
function defaultWindow(tech, labourHours, bookingsToday) {
  const now = nowMs();
  const ends = bookingsToday
    .filter(b => tech && b.mechanic_id === tech.id)
    .map(b => parseDT(b.scheduled_end_at)?.getTime())
    .filter(e => e > now);
  const start = roundUp15(Math.max(now + 5 * 60000, ...ends));
  const durMin = labourHours > 0 ? Math.min(8, Math.max(0.5, Math.ceil(labourHours * 2) / 2)) * 60 : 120;
  return { start: toLocalInput(new Date(start)), end: toLocalInput(new Date(start + durMin * 60000)) };
}

const norm = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const searchText = r => norm([r.work_order_number, r.job_card_number, r.plate_number, r.customer_name, r.vehicle_make,
  r.vehicle_model, r.mechanic_name, r.main_mechanic_name].filter(Boolean).join(' '));
const vehicleOf = r => [r.vehicle_make, r.vehicle_model, r.vehicle_year].filter(Boolean).join(' ');
const shortWo = n => (n ? `WO-…${String(n).slice(-4)}` : '');

/** A translated sentence with elements (links, timers) in place of its {{placeholders}}. */
const MARK = '⁣';
function withNodes(text, nodes) {
  return text.split(new RegExp(`(${MARK}\\d+${MARK})`)).map((part, i) => {
    const m = new RegExp(`^${MARK}(\\d+)${MARK}$`).exec(part);
    return m ? <Fragment key={i}>{nodes[Number(m[1])]}</Fragment> : part;
  });
}
const slot = i => `${MARK}${i}${MARK}`;

/** Re-render every `ms` (ages, timers, the now line). */
function useTick(ms) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setN(x => x + 1), ms);
    return () => clearInterval(i);
  }, [ms]);
  return n;
}

const stateLabel = (t, s) => ({
  working: t('teamBoard.state_working', 'Working'), paused: t('teamBoard.state_paused', 'Paused'),
  assigned: t('teamBoard.state_assigned', 'Assigned'), free: t('teamBoard.state_free', 'Free'), off: t('teamBoard.state_off', 'Off'),
})[s];
const specialtyLabel = (t, s) => ({
  engine: t('teamBoard.spec_engine', 'Engine'), transmission: t('teamBoard.spec_transmission', 'Transmission'),
  electrical: t('teamBoard.spec_electrical', 'Electrical'), bodywork: t('teamBoard.spec_bodywork', 'Bodywork'),
  tires: t('teamBoard.spec_tires', 'Tyres'), diagnostics: t('teamBoard.spec_diagnostics', 'Diagnostics'),
})[s] || null;
// Job card words and colours are the app's shared ones (lib/statusLabels.js).
const jcPillStyle = s => { const x = jcTone(s); return { background: x.bg, color: x.color }; };

/**
 * Why the technician's clock is paused, when the server says: the current
 * card's `pause_reason` / `last_pause_reason`, else the last booking today
 * on that card. null when unknown (the board then shows plain "Paused").
 */
function pauseReasonOf(data, mechanicId, jobCardId, current = null) {
  const card = data?.open_cards?.find(x => x.id === jobCardId);
  const direct = current?.pause_reason || current?.last_pause_reason || card?.pause_reason || card?.last_pause_reason;
  if (direct) return direct;
  const logs = (data?.time_today || []).filter(l => l.job_card_id === jobCardId && l.mechanic_id === mechanicId);
  const last = logs[logs.length - 1];
  return last?.clock_out && last.end_reason === 'pause' ? last.pause_reason || null : null;
}
const deptLabel = (t, d) => t(`workflow.dept.${d}`, DEPT_EN[d] || d);

/* ── The board ───────────────────────────────────────────────────── */

export default function TeamBoard() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // A failed response may carry no message at all (a proxy's 502), so the
  // first-load alert hangs on this, not on the text.
  const [loadFailed, setLoadFailed] = useState(false);
  const [stale, setStale] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [team, setTeam] = useState(() => readStore('tb.team') || '');
  const [tab, setTab] = useState(() => readStore('tb.tab'));
  const [assign, setAssign] = useState(null);       // { row, mode: 'main' | 'sub', trigger }
  const [teamModal, setTeamModal] = useState(null); // { trigger }
  const [done, setDone] = useState(() => new Set());
  const [toasts, setToasts] = useState([]);
  const [busyKeys, setBusyKeys] = useState(() => new Set()); // 'tech-3:start', … while each request runs
  const [errors, setErrors] = useState({});
  // 'tech-3' → { running, args }: Start answered 409 CLOCK_RUNNING_ELSEWHERE
  // and the row asks whether to pause the other job card and start this one.
  const [clashes, setClashes] = useState({});
  const [cardsTech, setCardsTech] = useState(null);
  useTick(30000);

  const seq = useRef(0);
  const hold = useRef(false);
  const pending = useRef(false);
  const allCount = useRef(null);
  const toastId = useRef(0);
  const searchRef = useRef(null);
  const cardsRef = useRef(null);
  const manageRef = useRef(null);

  // `auto` refreshes (timer, socket, tab focus) wait while a dialog is open
  // and run once it closes; the ones after an action never wait.
  const load = useCallback(async ({ auto = false } = {}) => {
    if (auto && hold.current) { pending.current = true; return; }
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await api.get(`/team-leader/overview${team ? `?team_leader_id=${encodeURIComponent(team)}` : ''}`);
      if (mine !== seq.current) return;
      if (!res.success) throw new Error(res.message || '');
      const serverNow = parseDT(res.now);
      skew = serverNow ? serverNow.getTime() - Date.now() : 0;
      if (res.scope?.kind === 'all') allCount.current = res.summary.technicians;
      // The board now shows the real state, so an older inline error is stale.
      setData(res); setLoadFailed(false); setStale(false); setLoadedAt(Date.now()); setDone(new Set()); setErrors({});
    } catch {
      if (mine !== seq.current) return;
      setLoadFailed(true); setStale(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [team]);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const auto = () => loadRef.current({ auto: true });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') auto(); }, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') auto(); };
    document.addEventListener('visibilitychange', onVisible);
    const socket = getSocket();
    let debounce;
    const kick = () => { clearTimeout(debounce); debounce = setTimeout(auto, 1500); };
    SOCKET_EVENTS.forEach(ev => socket.on(ev, kick));
    return () => {
      clearInterval(timer); clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisible);
      SOCKET_EVENTS.forEach(ev => socket.off(ev, kick));
    };
  }, []);

  useEffect(() => {
    hold.current = !!assign || !!teamModal;
    if (!hold.current && pending.current) { pending.current = false; loadRef.current(); }
  }, [assign, teamModal]);

  // "/" jumps to the queue search, as in most list screens.
  useEffect(() => {
    const onKey = e => {
      if (e.key !== '/' || hold.current || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]') || !searchRef.current) return;
      e.preventDefault();
      searchRef.current.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const pushToast = useCallback((kind, text) => {
    setToasts(list => [...list, { id: ++toastId.current, kind, text }].slice(-3));
  }, []);
  const dismissToast = useCallback(id => setToasts(list => list.filter(x => x.id !== id)), []);

  const caps = data?.capabilities || [];
  const canAssign = caps.includes('job.assign');
  const canTime = caps.includes('time.book');
  const scope = data?.scope;
  const technicians = data?.technicians || [];
  const showQueue = !data || canAssign || caps.includes('qc.perform');
  const canManage = canAssign && scope?.kind === 'team';

  const tabs = data ? QUEUES.filter(q => data.queues[q.key]) : [];
  const activeTab = tabs.some(q => q.key === tab) ? tab
    : DEFAULT_TAB_ORDER.find(k => data?.queues[k]?.total > 0) || (data?.queues.assign ? 'assign' : tabs[0]?.key);

  const chooseTeam = v => { setTeam(v); writeStore('tb.team', v); setCardsTech(null); };
  const chooseTab = k => { setTab(k); writeStore('tb.tab', k); };

  const openTeam = trigger => { if (canManage) setTeamModal({ trigger }); };
  const closeTeam = () => {
    const back = teamModal?.trigger || manageRef.current;
    setTeamModal(null);
    requestAnimationFrame(() => back?.focus?.());
  };
  const teamChanged = (message, close) => {
    pushToast('ok', message);
    if (close) closeTeam();
    loadRef.current();
  };

  const closeAssign = () => {
    const back = assign?.trigger;
    setAssign(null);
    requestAnimationFrame(() => back?.focus?.());
  };
  const assigned = (res, tech) => {
    const { row, mode, trigger } = assign;
    // Focus moves on to the next row still waiting, or to the tab.
    let next = trigger?.closest('li')?.nextElementSibling;
    while (next && !next.querySelector('[data-assign]')) next = next.nextElementSibling;
    const target = next?.querySelector('[data-assign]') || document.getElementById(`tb-tab-${activeTab}`);
    setDone(prev => new Set(prev).add(`${mode}-${row.id}`));
    setAssign(null);
    const name = splitName(tech?.full_name || res.technician?.full_name).name;
    pushToast('ok', t('teamBoard.toast_assigned', '{{number}} assigned to {{name}}.', {
      number: mode === 'sub' ? row.job_card_number : row.work_order_number, name,
    }));
    if (res.conflict) {
      pushToast('warn', t('teamBoard.toast_conflict', 'Heads up — {{name}} is already booked {{start}}–{{end}} on {{wo}}.', {
        name, wo: res.conflict.work_order_number,
        start: fmtHM(parseDT(res.conflict.scheduled_start_at)), end: fmtHM(parseDT(res.conflict.scheduled_end_at)),
      }));
    }
    requestAnimationFrame(() => target?.focus());
    // loadRef: the load of the team on screen now, not of the render this
    // closure came from.
    loadRef.current();
  };

  // Start / Pause / Stop for a technician with no phone at hand — the job
  // card's own endpoints and rules. Each button stays disabled until the
  // board has the new state, so a second press cannot land on the old one.
  //   start: one clock per technician — a 409 CLOCK_RUNNING_ELSEWHERE asks on
  //          the row; yes resends with pause_other (the other card is paused
  //          as "Moved to another job").
  //   pause: always with a reason (and a note for "Other").
  // Resolves true when the server took it.
  const clearClash = key => setClashes(c => { if (!c[key]) return c; const n = { ...c }; delete n[key]; return n; });
  const timeAction = async (action, args) => {
    const { jcId, jcNumber, mechanicId, name, key, reason = null, note = '', pauseOther = false } = args;
    const k = `${key}:${action}`;
    setBusyKeys(b => new Set(b).add(k));
    setErrors(e => ({ ...e, [key]: '' }));
    clearClash(key);
    try {
      const body = { mechanic_id: mechanicId };
      if (action === 'pause' && reason) { body.reason = reason; if (note) body.note = note; }
      if (action === 'start' && pauseOther) body.pause_other = true;
      const res = await api.post(`/job-cards/${jcId}/time/${action}`, body);
      if (!res.success) {
        if (action === 'start' && !pauseOther && res.code === 'CLOCK_RUNNING_ELSEWHERE') {
          setClashes(c => ({ ...c, [key]: { running: res.running || {}, args: { jcId, jcNumber, mechanicId, name, key } } }));
          return false;
        }
        setErrors(e => ({ ...e, [key]: res.message || t('teamBoard.action_failed', 'That did not work.') }));
        return false;
      }
      const vars = { name: splitName(name).name, jc: jcNumber };
      const why = action === 'pause' ? pauseReasonLabel(t, reason) : null;
      pushToast('ok', action === 'start'
        ? (pauseOther ? t('teamBoard.toast_time_switched', 'Time started for {{name}} on {{jc}}; the other job card is paused.', vars)
          : t('teamBoard.toast_time_started', 'Time started for {{name}} on {{jc}}.', vars))
        : action === 'pause'
          ? (why ? t('teamBoard.toast_time_paused_reason', 'Time paused for {{name}} on {{jc}} · {{reason}}.', { ...vars, reason: why })
            : t('teamBoard.toast_time_paused', 'Time paused for {{name}} on {{jc}}.', vars))
          : t('teamBoard.toast_time_stopped', 'Time stopped for {{name}} on {{jc}}.', vars));
      await loadRef.current();
      return true;
    } catch (err) {
      setErrors(e => ({ ...e, [key]: err?.message || t('teamBoard.action_failed', 'That did not work.') }));
      return false;
    } finally {
      setBusyKeys(b => { const n = new Set(b); n.delete(k); return n; });
    }
  };
  const clashActions = {
    confirm: key => { const c = clashes[key]; if (c) timeAction('start', { ...c.args, pauseOther: true }); },
    cancel: clearClash,
  };

  const showCardsFor = techId => {
    setCardsTech(techId);
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      cardsRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
      cardsRef.current?.focus({ preventScroll: true });
    });
  };

  const failed = !data && loadFailed && !loading;

  return (
    <div className="tb">
      <Hero data={data} loading={loading} failed={failed} stale={stale} loadedAt={loadedAt} team={team} allCount={allCount.current}
        onTeam={chooseTeam} onRefresh={() => load()} onManage={e => openTeam(e.currentTarget)} manageRef={manageRef} />

      {failed ? (
        <div className="tb-alert" role="alert">
          <WarningTriangle width={18} height={18} />
          <span>{t('teamBoard.load_failed', 'Could not load the team board.')}</span>
          <button type="button" className="tb-btn ghost sm" onClick={() => load()}>{t('teamBoard.retry', 'Try again')}</button>
        </div>
      ) : (
        <>
          {!showQueue && (
            <p className="tb-panel tb-noaccess"><InfoCircle width={16} height={16} /> {t('teamBoard.no_queue_access', 'Assigning and quality checks are done by the Team Leader, Supervisor or Foreman.')}</p>
          )}
          <div className={`tb-main${showQueue ? '' : ' no-queue'}`}>
            {showQueue && (
              <QueuePanel data={data} tabs={tabs} active={activeTab} onTab={chooseTab} searchRef={searchRef}
                done={done} canTime={canTime} canManage={canManage} busyKeys={busyKeys} errors={errors}
                clashes={clashes} clashActions={clashActions}
                onAssign={(row, mode, trigger) => setAssign({ row, mode, trigger })}
                onAddTech={e => openTeam(e.currentTarget)}
                onRestart={row => timeAction('start', {
                  jcId: row.id, jcNumber: row.job_card_number, mechanicId: row.mechanic_id, name: row.mechanic_name, key: `rw-${row.id}`,
                })} />
            )}
            <div className="tb-side">
              <TeamPanel data={data} canTime={canTime} canManage={canManage} busyKeys={busyKeys} errors={errors}
                clashes={clashes} clashActions={clashActions} onTime={timeAction} onMore={showCardsFor} onManage={e => openTeam(e.currentTarget)} />
              <CardsPanel data={data} panelRef={cardsRef} tech={cardsTech} onClearTech={() => setCardsTech(null)} />
            </div>
          </div>
        </>
      )}

      {assign && (
        <AssignDialog row={assign.row} mode={assign.mode} technicians={technicians} bookings={data?.bookings || []} data={data}
          scope={scope} canManage={canManage} onClose={closeAssign} onDone={assigned}
          onAddTech={() => { setAssign(null); setTeamModal({ trigger: assign.trigger }); }} />
      )}
      {teamModal && data && (
        <TeamModal scope={scope} technicians={technicians} onClose={closeTeam} onChanged={teamChanged} />
      )}
      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────────────────── */

function Hero({ data, loading, failed, stale, loadedAt, team, allCount, onTeam, onRefresh, onManage, manageRef }) {
  const { t } = useTranslation();
  useTick(10000);
  const scope = data?.scope;
  const teams = data?.teams || [];
  const count = data?.summary?.technicians ?? 0;
  const leader = scope?.team_leader_name ? splitName(scope.team_leader_name).name
    : scope?.team_leader_id ? `#${scope.team_leader_id}` : '';
  const since = loadedAt ? Date.now() - loadedAt : 0;
  const mayManage = data?.capabilities?.includes('job.assign');
  const manageLabel = t('teamBoard.manage_team', 'Manage team');

  return (
    <header className="tb-hero">
      <div className="tb-hero-deco" aria-hidden="true" />
      <div className="tb-hero-text">
        <p className="tb-eyebrow">{t('teamBoard.eyebrow', 'Steps 6–7 · Floor')}</p>
        <h1>{t('common.team_board', 'Team Board')}</h1>
        {!data ? !failed && <span className="tb-shimmer tb-hero-skel" /> : (
          <p className="tb-hero-sub">
            {scope.kind === 'team'
              ? t('teamBoard.sub_team', "{{leader}}'s team · {{count}} technicians", { leader, count })
              : t('teamBoard.sub_all', 'All teams · {{count}} technicians on teams or with open work', { count })}
          </p>
        )}
      </div>
      <div className="tb-hero-side">
        {loadedAt > 0 && (
          <p className={`tb-fresh${stale ? ' is-stale' : ''}`}>
            {stale ? t('teamBoard.stale', "Couldn't refresh — showing data from {{ago}} ago", { ago: fmtAgo(since) })
              : since < 10000 ? t('teamBoard.updated_now', 'Updated just now')
                : t('teamBoard.updated', 'Updated {{ago}} ago', { ago: fmtAgo(since) })}
          </p>
        )}
        <div className="tb-hero-actions">
          {scope?.can_switch && (
            <>
              <label htmlFor="tb-team" className="tb-sr">{t('teamBoard.team_label', 'Team')}</label>
              <select id="tb-team" className="tb-hero-select" value={team} onChange={e => onTeam(e.target.value)}>
                <option value="">
                  {allCount != null ? t('teamBoard.team_all', 'All teams ({{count}})', { count: allCount }) : t('teamBoard.team_title_all', 'All teams')}
                </option>
                {teams.map(x => (
                  <option key={x.leader_id} value={String(x.leader_id)}>
                    {t('teamBoard.team_option', '{{leader}} · {{count}}', { leader: splitName(x.leader_name).name, count: Number(x.technicians) })}
                  </option>
                ))}
                {team && !teams.some(x => String(x.leader_id) === team) && <option value={team}>#{team}</option>}
              </select>
            </>
          )}
          <button type="button" className="tb-hero-icon" onClick={onRefresh} aria-label={t('workflow.refresh', 'Refresh')}>
            <Refresh width={17} height={17} className={loading ? 'tb-spin' : ''} />
          </button>
          {mayManage && (
            <button ref={manageRef} type="button" className="tb-hero-manage" onClick={onManage} aria-label={manageLabel}
              disabled={scope.kind === 'all'} title={scope.kind === 'all' ? t('teamBoard.pick_team_first', 'Pick a team first') : undefined}>
              <Group width={17} height={17} /> <span>{manageLabel}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/* ── Queue panel ─────────────────────────────────────────────────── */

function QueuePanel({ data, tabs, active, onTab, searchRef, done, canTime, canManage, busyKeys, errors, clashes, clashActions, onAssign, onAddTech, onRestart }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('oldest');
  const [mine, setMine] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [active, q, sort, mine]);

  const tabText = {
    assign: [t('teamBoard.tab_assign', 'To assign'), t('workflow.tasks.assign', 'Assign a technician')],
    assign_sub: [t('teamBoard.tab_assign_sub', 'Sub-job cards'), t('workflow.tasks.assign_sub', 'Sub-job cards without a technician')],
    qc: [t('teamBoard.tab_qc', 'Quality check'), t('workflow.tasks.qc', 'Quality check & test drive')],
    rework: [t('teamBoard.tab_rework', 'Rework'), t('workflow.tasks.rework', 'Rework after a failed quality check')],
  };
  const stepText = { 6: t('teamBoard.step6', 'Step 6'), 7: t('teamBoard.step7', 'Step 7') };

  if (!data) {
    return (
      <section className="tb-panel tb-queue" aria-busy="true">
        <div className="tb-tabs" style={{ '--n': 4 }}>{[0, 1, 2, 3].map(i => <span key={i} className="tb-shimmer tb-tab-skel" />)}</div>
        <div className="tb-q-list">{[0, 1, 2, 3].map(i => <span key={i} className="tb-shimmer tb-row-skel" />)}</div>
      </section>
    );
  }

  const queue = data.queues[active];
  const showMine = ['qc', 'rework'].includes(active) && data.scope.kind === 'team';
  const needle = norm(q.trim());
  let rows = (queue?.rows || []).filter(r => (!needle || searchText(r).includes(needle)) && (!showMine || !mine || r.on_my_team));
  if (sort === 'newest') rows = [...rows].reverse();
  const more = rows.length - limit;
  const noTeam = canManage && data.technicians.length === 0;
  const clear = () => { setQ(''); setMine(false); };

  const onTabKey = (e, i) => {
    const rtl = document.dir === 'rtl';
    const n = { ArrowRight: rtl ? i - 1 : i + 1, ArrowLeft: rtl ? i + 1 : i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (n == null) return;
    e.preventDefault();
    const k = tabs[(n + tabs.length) % tabs.length].key;
    onTab(k);
    document.getElementById(`tb-tab-${k}`)?.focus();
  };

  const empty = {
    assign: (
      <div className="tb-empty good">
        <CheckCircle width={20} height={20} />
        <div><b>{t('teamBoard.empty_assign', 'Nothing to assign — every approved job card has a technician.')}</b>
          <span>{t('teamBoard.empty_assign_hint', 'Job cards arrive here when the customer approves the work (Step 6).')}</span></div>
      </div>
    ),
    assign_sub: <div className="tb-empty good"><CheckCircle width={20} height={20} /> {t('teamBoard.empty_sub', 'No sub-job cards are waiting for a technician.')}</div>,
    qc: <div className="tb-empty good"><CheckCircle width={20} height={20} /> {t('teamBoard.empty_qc', 'No job cards are waiting for the quality check.')}</div>,
    rework: <div className="tb-empty good"><CheckCircle width={20} height={20} /> {t('teamBoard.empty_rework', 'No rework — nothing has failed the quality check.')}</div>,
  };

  return (
    <section className="tb-panel tb-queue" aria-labelledby="tb-q-h">
      <h2 id="tb-q-h" className="tb-sr">{t('teamBoard.queues_label', 'Work queues')}</h2>
      <div className="tb-tabs" role="tablist" aria-labelledby="tb-q-h" style={{ '--n': tabs.length }} data-n={tabs.length}>
        {tabs.map((tb, i) => {
          const qd = data.queues[tb.key];
          const on = tb.key === active;
          const Icon = tb.icon;
          const sub = qd.rows.length
            ? t('teamBoard.oldest', 'Oldest: {{age}}', { age: fmtAge(minutesSince(qd.rows[0].since, qd.rows[0].waiting_minutes)) })
            : t('teamBoard.none_waiting', 'Nothing waiting');
          // The sub-line is hidden on a narrow queue; the title keeps it.
          return (
            <button key={tb.key} type="button" role="tab" id={`tb-tab-${tb.key}`} aria-selected={on} aria-controls="tb-tabpanel"
              tabIndex={on ? 0 : -1} title={`${tabText[tb.key][1]} · ${sub}`} onClick={() => onTab(tb.key)} onKeyDown={e => onTabKey(e, i)}
              className={`tb-tab tone-${tb.key}${on ? ' is-on' : ''}${qd.total ? '' : ' is-zero'}`}>
              <span className="tb-tab-top">
                <span className="tb-tab-ico"><Icon width={15} height={15} /></span>
                <span className="tb-tab-step">{stepText[tb.step]}</span>
              </span>
              <span className="tb-tab-n">{qd.total}</span>
              <span className="tb-tab-label">{tabText[tb.key][0]}</span>
              <span className="tb-tab-sub">{!qd.rows.length && <Check width={12} height={12} />} {sub}</span>
            </button>
          );
        })}
      </div>

      <div id="tb-tabpanel" role="tabpanel" aria-labelledby={`tb-tab-${active}`} className="tb-q-body">
        <h3 className="tb-q-title">{tabText[active]?.[1]}</h3>
        <div className="tb-toolbar">
          <div className="tb-search">
            <label htmlFor="tb-q" className="tb-sr">{t('teamBoard.search_label', 'Search the queue')}</label>
            <Search width={15} height={15} aria-hidden="true" />
            <input id="tb-q" ref={searchRef} type="search" value={q} autoComplete="off"
              placeholder={t('teamBoard.search_ph', 'Search WO, job card, plate, customer…')}
              onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
          </div>
          {/* search and sort share a line; only the switch wraps under them */}
          <label htmlFor="tb-sort" className="tb-sr">{t('teamBoard.sort_label', 'Sort')}</label>
          <select id="tb-sort" className="tb-select" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="oldest">{t('teamBoard.sort_oldest', 'Longest waiting first')}</option>
            <option value="newest">{t('teamBoard.sort_newest', 'Newest first')}</option>
          </select>
          {showMine && (
            <label className="tb-switch">
              <input type="checkbox" role="switch" checked={mine} onChange={e => setMine(e.target.checked)} />
              <span className="tb-switch-ui" aria-hidden="true" />
              <span>{t('teamBoard.only_my_team', 'Only my team')}</span>
            </label>
          )}
        </div>

        <div className="tb-q-scroll">
          {!queue?.total ? empty[active] : !rows.length ? (
            !needle && showMine && mine ? (
              <div className="tb-empty">
                <InfoCircle width={18} height={18} />
                <span>{t('teamBoard.none_on_my_team', 'None of these are on your team.')}</span>
                <button type="button" className="tb-btn ghost sm" onClick={() => setMine(false)}>{t('teamBoard.show_all', 'Show all')}</button>
              </div>
            ) : (
              <div className="tb-empty">
                <Search width={18} height={18} />
                <span>{t('teamBoard.no_match', 'No job cards match “{{q}}”.', { q: q.trim() })}</span>
                <button type="button" className="tb-btn ghost sm" onClick={clear}>{t('teamBoard.clear_search', 'Clear search')}</button>
              </div>
            )
          ) : (
            <ul className="tb-q-list">
              {rows.slice(0, limit).map(row => (
                <li key={`${active}-${row.id}`}>
                  <QueueRow kind={active} row={row} done={done.has(`${active === 'assign_sub' ? 'sub' : 'main'}-${row.id}`)}
                    noTeam={noTeam} canTime={canTime} busy={busyKeys.has(`rw-${row.id}:start`)} error={errors[`rw-${row.id}`]}
                    clash={clashes[`rw-${row.id}`]} clashActions={clashActions}
                    onAssign={onAssign} onAddTech={onAddTech} onRestart={onRestart} />
                </li>
              ))}
            </ul>
          )}
          {more > 0 && (
            <button type="button" className="tb-btn ghost tb-more" onClick={() => setLimit(l => l + PAGE)}>
              {t('teamBoard.show_more', 'Show {{n}} more', { n: Math.min(PAGE, more) })}
            </button>
          )}
        </div>

        <footer className="tb-q-foot">
          <span>{t('teamBoard.showing', 'Showing {{shown}} of {{total}}', { shown: rows.length, total: queue?.total ?? 0 })}</span>
          {active === 'assign' && data.summary.awaiting_customer > 0 && (
            <span className="tb-q-note">
              <InfoCircle width={14} height={14} />
              {t('teamBoard.awaiting_customer', "{{count}} job cards are waiting for the customer's decision — they appear here once approved.", { count: data.summary.awaiting_customer })}
            </span>
          )}
        </footer>
      </div>
    </section>
  );
}

function AgeBlock({ since, minutes, caption }) {
  const min = minutesSince(since, minutes);
  return (
    <div className={`tb-age ${ageTone(min)}`} title={fmtFull(parseDT(since))}>
      <b>{fmtAge(min)}</b>
      <span>{caption}</span>
    </div>
  );
}

const Plate = ({ value }) => (value ? <bdi className="tb-plate">{value}</bdi> : null);

/** One row of a queue — the shell is shared; each queue has its own lines and actions. */
function QueueRow({ kind, row, done, noTeam, canTime, busy, error, clash, clashActions, onAssign, onAddTech, onRestart }) {
  const { t } = useTranslation();
  const labelId = `tb-r-${kind}-${row.id}`;
  const woLink = (id) => <Link to={`/work-orders/${row.work_order_id ?? row.id}`} id={id} className="tb-wo"><bdi>{row.work_order_number}</bdi></Link>;
  const vehicle = vehicleOf(row);
  const vehicleLine = (
    <>
      <Car width={14} height={14} aria-hidden="true" />
      {vehicle ? <span>{vehicle}</span> : <i className="tb-faint">{t('teamBoard.no_vehicle', 'No vehicle on file')}</i>}
      <Plate value={row.plate_number} />
      <span className="tb-cust">· {row.customer_name || t('teamBoard.no_customer', 'No customer')}</span>
    </>
  );
  const openLink = (
    <Link to={`/work-orders/${row.work_order_id ?? row.id}`} className="tb-btn ghost icon"
      aria-label={`${t('teamBoard.open_job_card', 'Open job card')} ${row.work_order_number}`}>
      <OpenNewWindow width={16} height={16} />
    </Link>
  );
  const assignBtn = mode => (noTeam && mode === 'main'
    ? <button type="button" className="tb-btn accent" onClick={onAddTech}><UserPlus width={15} height={15} /> {t('teamBoard.add_technicians', 'Add technicians')}</button>
    : <button type="button" className="tb-btn accent" data-assign="" onClick={e => onAssign(row, mode, e.currentTarget)}>
        <Flash width={15} height={15} /> {t('workflow.assign', 'Assign')}
      </button>);
  const myTeam = row.on_my_team && <span className="tb-chip navy">{t('teamBoard.my_team_chip', 'My team')}</span>;
  const techName = row.mechanic_name ? splitName(row.mechanic_name).name : null;

  let age, lines, actions;
  if (kind === 'assign') {
    const channel = row.customer_approval_channel === 'estimate' ? t('teamBoard.channel_estimate', 'via estimate')
      : { in_person: t('workflow.in_person', 'In person'), phone: t('workflow.phone', 'By phone'), written: t('workflow.written', 'In writing') }[row.customer_approval_channel];
    const meta = [
      row.items_preview && `${row.items_preview}${row.line_count > 3 ? ` ${t('teamBoard.lines_more', '+{{n}} more', { n: row.line_count - 3 })}` : ''}`,
      row.labour_hours > 0 && t('teamBoard.labour_h', '{{h}} h labour', { h: row.labour_hours }),
      row.customer_approved_at && t('teamBoard.approved_via', 'Approved {{time}} · {{channel}}', { time: fmtDayHM(parseDT(row.customer_approved_at)), channel: channel || '' }),
    ].filter(Boolean).join(' · ');
    age = <AgeBlock since={row.since} minutes={row.waiting_minutes} caption={t('teamBoard.waiting', 'waiting')} />;
    lines = (
      <>
        <div className="tb-l1">
          {woLink(labelId)}
          {row.job_card_number && <bdi className="tb-mono">{row.job_card_number}</bdi>}
          {row.department && row.department !== 'mechanical' && <span className="tb-chip">{deptLabel(t, row.department)}</span>}
          {!!row.partial_approval && <span className="tb-chip warn">{t('teamBoard.partial', 'Partial approval')}</span>}
          {row.sub_count > 0 && <span className="tb-chip">{t('teamBoard.subs_count', '+{{count}} sub-job cards', { count: Number(row.sub_count) })}</span>}
        </div>
        <div className="tb-l2">{vehicleLine}</div>
        {meta && <div className="tb-l3" title={meta}>{meta}</div>}
      </>
    );
    actions = <>{assignBtn('main')}{openLink}</>;
  } else if (kind === 'assign_sub') {
    const main = row.main_mechanic_name ? splitName(row.main_mechanic_name).name : null;
    age = <AgeBlock since={row.since} minutes={row.waiting_minutes} caption={t('teamBoard.opened', 'opened')} />;
    lines = (
      <>
        <div className="tb-l1">
          <bdi className="tb-mono b" id={labelId}>{row.job_card_number}</bdi>
          {row.title && <span className="tb-title">{row.title}</span>}
          {row.department && <span className="tb-chip">{deptLabel(t, row.department)}</span>}
        </div>
        <div className="tb-l2">{woLink()} {vehicleLine}</div>
        <div className={`tb-l3${main ? '' : ' warn'}`}>
          {main ? t('teamBoard.main_tech', 'Main job card: {{name}}', { name: main }) : t('teamBoard.main_tech_none', 'Main job card: not assigned')}
        </div>
      </>
    );
    actions = <>{assignBtn('sub')}{openLink}</>;
  } else if (kind === 'qc') {
    age = <AgeBlock since={row.since} minutes={row.waiting_minutes} caption={t('teamBoard.done_caption', 'done')} />;
    lines = (
      <>
        <div className="tb-l1">
          <bdi className="tb-mono b" id={labelId}>{row.job_card_number}</bdi>
          <span className="tb-title sm">{row.parent_job_card_id ? `${t('workflow.sub', 'Sub-job card')} · ${row.title || ''}` : t('workflow.main', 'Main job card')}</span>
          {woLink()}
        </div>
        <div className="tb-l2">{vehicleLine}</div>
        <div className="tb-l3">
          {techName ? t('teamBoard.done_by', 'Done by {{name}} · {{time}} booked', { name: techName, time: fmtDur(row.minutes_booked) })
            : t('teamBoard.no_technician', 'No technician')}
          {myTeam}
        </div>
      </>
    );
    actions = (
      <Link to={`/work-orders/${row.work_order_id}`} className="tb-btn accent">
        <ShieldCheck width={15} height={15} /> {t('teamBoard.quality_check', 'Quality check')}
      </Link>
    );
  } else {
    // A card failed through a plain status change has no checklist, so no inspector.
    const time = fmtDayHM(parseDT(row.since));
    const by = row.inspector_name ? t('teamBoard.qc_by', '— {{name}}, {{time}}', { name: splitName(row.inspector_name).name, time })
      : time ? t('teamBoard.qc_at', '— {{time}}', { time }) : '';
    const quote = [row.qc_notes, by].filter(Boolean).join(' ');
    age = <AgeBlock since={row.since} minutes={row.waiting_minutes} caption={t('teamBoard.failed_caption', 'failed')} />;
    lines = (
      <>
        <div className="tb-l1">
          <bdi className="tb-mono b" id={labelId}>{row.job_card_number}</bdi>
          {woLink()}
          <span className="tb-pill" style={jcPillStyle('qc_failed')}>{jcLabel(t, 'qc_failed')}</span>
        </div>
        {quote && <blockquote className="tb-quote" title={quote}><span>{quote}</span></blockquote>}
        <div className="tb-l3">
          {techName ? t('teamBoard.technician_label', 'Technician: {{name}}', { name: techName }) : t('teamBoard.no_technician', 'No technician')}
          {vehicle && <> · {vehicle}</>} <Plate value={row.plate_number} />
          {myTeam}
        </div>
      </>
    );
    actions = (
      <>
        {canTime && row.mechanic_id && (
          <button type="button" className="tb-btn go" disabled={busy} onClick={() => onRestart(row)}
            aria-label={t('teamBoard.restart_time_aria', 'Restart time for {{name}} on {{jc}}', { name: techName, jc: row.job_card_number })}>
            <Play width={15} height={15} /> {t('teamBoard.restart_time', 'Restart time')}
          </button>
        )}
        <Link to={`/work-orders/${row.work_order_id}`} className="tb-btn ghost">{t('teamBoard.open_job_card', 'Open job card')}</Link>
      </>
    );
  }

  return (
    <article className={`tb-row tone-${kind}${done ? ' is-done' : ''}`} aria-labelledby={labelId}>
      {age}
      <div className="tb-row-main">{lines}</div>
      <div className="tb-row-actions">
        {done ? <span className="tb-done"><Check width={15} height={15} /> {t('teamBoard.state_assigned', 'Assigned')}</span> : actions}
      </div>
      {clash && !done && <ClockClash clash={clash} busy={busy} onConfirm={() => clashActions.confirm(`rw-${row.id}`)} onCancel={() => clashActions.cancel(`rw-${row.id}`)} />}
      {error && <p className="tb-row-err" role="alert">{error}</p>}
    </article>
  );
}

/* ── Dialog shell (Assign, Manage team) ──────────────────────────── */

function Dialog({ id, variant, title, sub, dirty, busy = false, onClose, onSubmit, initialFocus, footer, children }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  useEffect(() => {
    const first = initialFocus?.current;
    (first && !first.disabled ? first : ref.current?.querySelector(FOCUSABLE))?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Disabling the focused submit button would drop focus to <body>, where Esc
  // and Tab no longer reach the dialog: the form holds it meanwhile, then
  // hands it back so Enter can try again.
  useEffect(() => {
    const el = document.activeElement;
    if (busy && (el?.disabled || !ref.current?.contains(el))) ref.current?.focus();
    else if (!busy && el === ref.current) initialFocus?.current?.focus();
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // While a request runs the dialog stays: its answer (an error, or the
  // success that moves focus on) has nowhere else to go.
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    // A click on empty space focuses the form itself (tabIndex -1).
    if (!items.includes(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const onBackdrop = e => {
    if (e.target !== e.currentTarget) return;
    // Kept open: keep focus where it was, inside the dialog.
    if (dirty || busy) e.preventDefault(); else onClose();
  };

  // Rendered in <body>: the board is a size container, which would make a
  // fixed-position dialog relative to it instead of the window. tabIndex -1
  // keeps focus inside when empty space is clicked, so Esc and Tab still work.
  return createPortal(
    <div className="tb-layer">
      <div className="tb-dialog-bg" onMouseDown={onBackdrop}>
        <form ref={ref} className={`tb-dialog ${variant}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-h`}
          tabIndex={-1} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
          <header className="tb-dlg-head">
            <div className="tb-dlg-titles">
              <h2 id={`${id}-h`}>{title}</h2>
              {sub && <p>{sub}</p>}
            </div>
            <button type="button" className="tb-btn ghost icon" aria-label={t('teamBoard.close', 'Close')} onClick={onClose} disabled={busy}>
              <Xmark width={18} height={18} />
            </button>
          </header>
          <div className="tb-dlg-body">{children}</div>
          <footer className="tb-dlg-foot">{footer}</footer>
        </form>
      </div>
    </div>,
    document.body
  );
}

function Avatar({ tech, size = 36, ring = true }) {
  return (
    <span className={`tb-av s${size}${ring ? ` ring state-${tech.state}` : ''}`} style={{ background: AVATAR_BG[Math.abs(tech.id) % 6] }} aria-hidden="true">
      {initials(tech.full_name)}
    </span>
  );
}

/** The state word; a paused clock says why when the server knows ("Paused · Waiting for parts"). */
const StateWord = ({ state, pauseReason = null }) => {
  const { t } = useTranslation();
  const label = state === 'paused' && pauseReason ? timeStateLabel(t, 'paused', pauseReason) : stateLabel(t, state);
  return <span className={`tb-state state-${state}`}><i className="tb-dot" aria-hidden="true" />{label}</span>;
};

/** Start answered 409 CLOCK_RUNNING_ELSEWHERE: pause the other job card and start this one? */
function ClockClash({ clash, busy, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const name = splitName(clash.args.name).name;
  const other = clash.running?.job_card_number || clash.running?.work_order_number || t('teamBoard.another_job', 'another job card');
  return (
    <div className="tb-clash" role="alert">
      <span>{t('teamBoard.clash_confirm', '{{name}} is working on {{jc}} — pause it and start this one?', { name, jc: other })}</span>
      <span className="tb-clash-actions">
        <button type="button" className="tb-btn go sm" disabled={busy} onClick={onConfirm}>
          <Play width={14} height={14} /> {t('teamBoard.clash_yes', 'Pause it and start')}
        </button>
        <button type="button" className="tb-btn ghost sm" disabled={busy} onClick={onCancel}>{t('teamBoard.cancel', 'Cancel')}</button>
      </span>
    </div>
  );
}

/** Pause asks why: break, waiting for parts, information or approval, another job, or other (with a note). */
function PauseForm({ name, jc, busy, onSubmit, onCancel }) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const firstRef = useRef(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  const needNote = reason === 'other' && !note.trim();
  const submit = e => {
    e.preventDefault();
    if (!reason || needNote || busy) return;
    onSubmit(reason, note.trim());
  };
  return (
    <form className="tb-pausebox" onSubmit={submit} aria-labelledby={`${id}-h`} noValidate
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <p id={`${id}-h`} className="tb-pause-h">{t('teamBoard.pause_why', 'Why is {{name}} pausing {{jc}}?', { name, jc })}</p>
      <div className="tb-reasons" role="radiogroup" aria-labelledby={`${id}-h`}>
        {PAUSE_REASONS.map((r, i) => (
          <label key={r} className={`tb-reason${reason === r ? ' is-on' : ''}`}>
            <input ref={i === 0 ? firstRef : undefined} type="radio" name={`${id}-reason`} value={r}
              checked={reason === r} onChange={() => setReason(r)} />
            <span>{pauseReasonLabel(t, r)}</span>
          </label>
        ))}
      </div>
      <label htmlFor={`${id}-note`} className="tb-sr">{t('teamBoard.pause_note_label', 'Note')}</label>
      <input id={`${id}-note`} className="tb-input tb-pause-note" type="text" value={note} maxLength={PAUSE_NOTE_MAX}
        onChange={e => setNote(e.target.value)} aria-invalid={needNote || undefined} aria-describedby={needNote ? `${id}-need` : undefined}
        placeholder={reason === 'other' ? t('teamBoard.pause_note_required', 'Say why the job is paused (required)') : t('teamBoard.pause_note_optional', 'Note (optional)')} />
      {needNote && <p id={`${id}-need`} className="tb-pause-hint">{t('teamBoard.pause_note_needed', 'For "Other", say why the job is paused.')}</p>}
      <div className="tb-pause-actions">
        <button type="submit" className="tb-btn primary sm" disabled={busy || !reason || needNote}>
          <Pause width={14} height={14} /> {t('teamBoard.pause_time', 'Pause time')}
        </button>
        <button type="button" className="tb-btn ghost sm" disabled={busy} onClick={onCancel}>{t('teamBoard.cancel', 'Cancel')}</button>
      </div>
    </form>
  );
}

/** What a technician is on, in words. `links` makes the job card and WO links. */
function StateDetail({ tech, links = false }) {
  const { t } = useTranslation();
  const c = tech.current;
  const jc = c && (links ? <Link to={`/work-orders/${c.work_order_id}`}><bdi>{c.job_card_number}</bdi></Link> : <bdi>{c.job_card_number}</bdi>);
  const wo = c && (links ? <Link to={`/work-orders/${c.work_order_id}`}><bdi>{c.work_order_number}</bdi></Link> : <bdi>{c.work_order_number}</bdi>);
  const next = parseDT(tech.next_booking_at);
  if (tech.state === 'working' && c) {
    const since = parseDT(tech.running_since);
    const yesterday = since && !sameDay(since, new Date(nowMs()));
    return (
      <span className="tb-detail">
        {withNodes(t('teamBoard.detail_working', 'On {{jc}} · {{wo}} · since {{time}}', { jc: slot(0), wo: slot(1), time: fmtHM(since) }), [jc, wo])}
        {/* a real space, not a margin: it stays between the two in either direction */}
        {' '}<b className="tb-live" aria-hidden="true">{fmtDur(minutesSince(tech.running_since))}</b>
        {yesterday && <span className="tb-red"> {t('teamBoard.since_yesterday', 'running since yesterday')}</span>}
      </span>
    );
  }
  if (tech.state === 'paused' && c) {
    // The state word already says "Paused" (with the reason when known).
    return <span className="tb-detail">{withNodes(t('teamBoard.detail_paused_on', 'On {{jc}} · {{wo}}', { jc: slot(0), wo: slot(1) }), [jc, wo])}</span>;
  }
  if (tech.state === 'assigned') {
    // A card past 'open' (stopped, waiting for parts, back from QC) has been
    // taken up, so it reads "not running" rather than "not started".
    return (
      <span className="tb-detail">
        {c && c.jc_status !== 'open'
          ? withNodes(t('teamBoard.detail_not_running', 'On {{jc}} · not running', { jc: slot(0) }), [jc])
          : t('teamBoard.detail_assigned', '{{count}} job cards — not started', { count: tech.open_count })}
        {next && <> · {t('teamBoard.next_booking', 'Next booking {{time}}', { time: fmtDayHM(next) })}</>}
      </span>
    );
  }
  if (tech.state === 'free') {
    return <span className="tb-detail">{next ? t('teamBoard.next_booking', 'Next booking {{time}}', { time: fmtDayHM(next) }) : t('teamBoard.free_all_day', 'Nothing booked')}</span>;
  }
  return <span className="tb-detail">{tech.status === 'on_break' ? t('teamBoard.off_break', 'On break') : t('teamBoard.off_offline', 'Offline')}</span>;
}

/* ── Assign dialog ───────────────────────────────────────────────── */

function AssignDialog({ row, mode, technicians, bookings, data, scope, canManage, onClose, onDone, onAddTech }) {
  const { t } = useTranslation();
  const ranked = useMemo(() => rankTechnicians(technicians, row.department), [technicians, row.department]);
  const best = ranked.find(x => x.state !== 'off') || null;
  const labour = Number(row.labour_hours) || 0;
  const [techId, setTechId] = useState(best?.id ?? null);
  const [q, setQ] = useState('');
  const [windowOn, setWindowOn] = useState(true);
  const [win, setWin] = useState(() => defaultWindow(best, labour, bookings));
  const [edited, setEdited] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const submitRef = useRef(null);

  const tech = technicians.find(x => x.id === techId) || null;
  const woId = row.work_order_id ?? row.id;
  const pick = id => {
    setTechId(id); setTouched(true); setErr('');
    if (!edited) setWin(defaultWindow(technicians.find(x => x.id === id), labour, bookings));
  };
  const setStart = v => { setEdited(true); setTouched(true); setWin(w => ({ ...w, start: v })); };
  const setEnd = v => { setEdited(true); setTouched(true); setWin(w => ({ ...w, end: v })); };
  const startD = win.start ? new Date(win.start) : null;
  const endD = win.end ? new Date(win.end) : null;
  const validWindow = startD && endD && endD > startD;
  const durMin = validWindow ? Math.round((endD - startD) / 60000) : 0;
  const overlap = mode === 'main' && windowOn && validWindow && tech && bookings.find(b => b.mechanic_id === tech.id && b.work_order_id !== woId
    && parseDT(b.scheduled_start_at) < endD && (parseDT(b.scheduled_end_at) || parseDT(b.scheduled_start_at)) > startD);
  const needle = norm(q.trim());
  const matches = needle ? ranked.filter(x => norm(x.full_name).includes(needle)) : ranked;
  // The chosen technician stays in view while searching: hiding them would
  // leave the submit button assigning someone the list no longer shows.
  const options = needle ? ranked.filter(x => x.id === techId || matches.includes(x)) : ranked;
  // Enter in the search picks the first match; it never submits the form.
  const onSearchKey = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (needle && matches[0]) pick(matches[0].id);
  };

  const submit = async e => {
    e.preventDefault();
    if (!tech) { setErr(t('teamBoard.err_pick', 'Pick a technician.')); return; }
    if (mode === 'main' && windowOn && !validWindow) { setErr(t('teamBoard.err_window', 'The end of the window must be after its start.')); return; }
    setSaving(true); setErr('');
    try {
      const res = mode === 'sub'
        ? await api.patch(`/workflow/job-cards/${row.id}/technician`, { mechanic_id: tech.id })
        : await api.post('/team-leader/assign', {
          work_order_id: row.id, mechanic_id: tech.id,
          scheduled_start_at: windowOn ? toSql(win.start) : null,
          scheduled_end_at: windowOn ? toSql(win.end) : null,
          // The queue is shared and held while this is open: if another
          // leader assigned it meanwhile, the server says so (409) instead
          // of replacing their technician.
          expected_mechanic_id: null,
        });
      if (!res.success) { setErr(res.message || t('teamBoard.action_failed', 'That did not work.')); setSaving(false); return; }
      onDone(res, tech);
    } catch (e2) {
      setErr(e2?.message || t('teamBoard.action_failed', 'That did not work.'));
      setSaving(false);
    }
  };

  const context = [
    mode === 'sub' ? row.title : row.job_card_number, vehicleOf(row), row.plate_number, row.customer_name,
    t('teamBoard.waiting_for', 'waiting {{age}}', { age: fmtAge(minutesSince(row.since, row.waiting_minutes)) }),
  ].filter(Boolean).join(' · ');
  const freeAt = x => {
    const end = parseDT(x.last_booking_end_today);
    if (end && end.getTime() > nowMs()) return t('teamBoard.free_from', 'Free from {{time}}', { time: fmtHM(end) });
    return x.state === 'free' ? t('teamBoard.free_now', 'Free now') : null;
  };

  return (
    <Dialog id="tb-dlg" variant="is-drawer" dirty={touched} busy={saving} onClose={onClose} onSubmit={submit} initialFocus={submitRef}
      title={mode === 'sub'
        ? t('teamBoard.assign_sub_title', 'Assign sub-job card {{number}}', { number: row.job_card_number })
        : t('teamBoard.assign_title', 'Assign {{number}}', { number: row.work_order_number })}
      sub={context}
      footer={(
        <>
          {err && <p className="tb-dlg-err" role="alert"><WarningTriangle width={15} height={15} /> {err}</p>}
          <button type="button" className="tb-btn ghost" onClick={onClose} disabled={saving}>{t('teamBoard.cancel', 'Cancel')}</button>
          <button ref={submitRef} type="submit" className="tb-btn accent" disabled={saving || !technicians.length}>
            {saving ? t('teamBoard.assigning', 'Assigning…')
              : mode === 'main' && windowOn ? t('teamBoard.assign_book', 'Assign & book') : t('workflow.assign', 'Assign')}
          </button>
        </>
      )}>
      {!technicians.length ? (
        <div className="tb-empty">
          <span>{scope?.kind === 'all' ? t('teamBoard.empty_team_all', 'No technicians are on a team or holding open work.')
            : t('teamBoard.empty_team_leader', 'Your team is empty. Add technicians to start assigning.')}</span>
          {canManage && (
            <button type="button" className="tb-btn accent" onClick={onAddTech}><UserPlus width={15} height={15} /> {t('teamBoard.add_technicians', 'Add technicians')}</button>
          )}
        </div>
      ) : (
        <>
          <fieldset className="tb-fieldset">
            <legend>{t('teamBoard.tech_legend', 'Technician')}</legend>
            {technicians.length > 8 && (
              <div className="tb-search">
                <label htmlFor="tb-dlg-q" className="tb-sr">{t('teamBoard.search_tech', 'Search technicians')}</label>
                <Search width={15} height={15} aria-hidden="true" />
                <input id="tb-dlg-q" type="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey}
                  placeholder={t('teamBoard.search_tech', 'Search technicians')} />
              </div>
            )}
            <div className="tb-opts">
              {options.map(x => {
                const { name, note } = splitName(x.full_name);
                const free = freeAt(x);
                return (
                  <label key={x.id} className={`tb-opt${x.id === techId ? ' is-on' : ''}`}>
                    <input type="radio" className="tb-sr" name="tb-tech" value={x.id} checked={x.id === techId} onChange={() => pick(x.id)} />
                    <Avatar tech={x} />
                    <span className="tb-opt-body">
                      <span className="tb-opt-name">
                        <b>{name}</b>
                        {note && <span className="tb-chip">{note}</span>}
                        {best && x.id === best.id && <span className="tb-chip accent">{t('teamBoard.suggested', 'Suggested')}</span>}
                      </span>
                      <span className="tb-opt-state">
                        <StateWord state={x.state} pauseReason={x.state === 'paused' && x.current ? pauseReasonOf(data, x.id, x.current.job_card_id, x.current) : null} />
                        {' '}<StateDetail tech={x} />
                      </span>
                      <span className="tb-opt-meta">
                        {t('teamBoard.booked_today', '{{time}} booked today', { time: fmtDur(x.booked_min_today) })}
                        {free && <> · {free}</>}
                      </span>
                    </span>
                    {x.id === techId && <Check width={18} height={18} className="tb-opt-check" aria-hidden="true" />}
                  </label>
                );
              })}
            </div>
            <p className="tb-hint">
              <Link to={`/work-orders/${woId}`}>{t('teamBoard.not_listed_hint', 'Someone not listed? Assign from the job card (Step 6).')}</Link>
            </p>
          </fieldset>

          {mode === 'sub' ? (
            <p className="tb-hint muted"><Clock width={14} height={14} /> {t('teamBoard.sub_no_window', 'Time on a sub-job card is booked with Start / Pause / Stop.')}</p>
          ) : (
            <div className="tb-win">
              <label className="tb-switch">
                <input type="checkbox" role="switch" checked={windowOn} onChange={e => { setWindowOn(e.target.checked); setTouched(true); setErr(''); }} />
                <span className="tb-switch-ui" aria-hidden="true" />
                <span>{t('teamBoard.window_switch', 'Book a time window')}</span>
              </label>
              {windowOn && (
                <>
                  <div className="tb-win-grid">
                    <label>
                      <span>{t('teamBoard.start_label', 'Start')}</span>
                      <input type="datetime-local" className="tb-input" value={win.start} onChange={e => setStart(e.target.value)} />
                    </label>
                    <label>
                      <span>{t('teamBoard.end_label', 'End')}</span>
                      <input type="datetime-local" className="tb-input" value={win.end} onChange={e => setEnd(e.target.value)} />
                    </label>
                  </div>
                  <div className="tb-durs" role="group" aria-label={t('teamBoard.duration', 'Duration')}>
                    {DURATIONS.map(d => (
                      <button key={d} type="button" className="tb-chipbtn" aria-pressed={durMin === d} disabled={!startD}
                        onClick={() => setEnd(toLocalInput(new Date(startD.getTime() + d * 60000)))}>
                        {fmtDur(d)}
                      </button>
                    ))}
                  </div>
                  {validWindow && (
                    <p className="tb-win-sum">
                      <Clock width={14} height={14} aria-hidden="true" />
                      {/* Left to right in Arabic too, or the arrow points from the end back to the start;
                          each time keeps its own direction (a date there may carry a month name). */}
                      <bdi dir="ltr">
                        {withNodes(t('teamBoard.window_summary', '{{start}} → {{end}} ({{dur}})', { start: slot(0), end: slot(1), dur: fmtDur(durMin) }),
                          [<bdi>{fmtDayHM(startD)}</bdi>, <bdi>{fmtHM(endD)}</bdi>])}
                      </bdi>
                    </p>
                  )}
                  {overlap && (
                    <p className="tb-warn">
                      <WarningTriangle width={14} height={14} />
                      {t('teamBoard.overlap_warn', 'Overlaps {{wo}} {{start}}–{{end}} — you can still book it.', {
                        wo: overlap.work_order_number, start: fmtHM(parseDT(overlap.scheduled_start_at)), end: fmtHM(parseDT(overlap.scheduled_end_at)),
                      })}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/* ── Team panel ──────────────────────────────────────────────────── */

/** The hours the lanes cover: from the earliest thing today (07:00 at the latest) to 19:00 or later. */
function dayRange(data) {
  const H = 3600000;
  const day0 = parseDT(`${data.today} 00:00:00`).getTime();
  const dayEnd = day0 + 24 * H;
  const now = nowMs();
  const starts = [...data.bookings.map(b => parseDT(b.scheduled_start_at)), ...data.time_today.map(l => parseDT(l.clock_in))]
    .filter(Boolean).map(d => Math.max(d.getTime(), day0));
  const ends = [...data.bookings.map(b => parseDT(b.scheduled_end_at || b.scheduled_start_at)),
    ...data.time_today.map(l => (l.clock_out ? parseDT(l.clock_out) : new Date(now)))]
    .filter(Boolean).map(d => Math.min(d.getTime(), dayEnd));
  const startH = Math.max(0, Math.min(7, starts.length ? Math.floor((Math.min(...starts) - day0) / H) : 7));
  const endH = Math.min(24, Math.max(19, ends.length ? Math.ceil((Math.max(...ends) - day0) / H) : 0, Math.ceil((now + 30 * 60000 - day0) / H)));
  const from = day0 + startH * H, span = (endH - startH) * H;
  const hours = Array.from({ length: endH - startH + 1 }, (_, i) => startH + i);
  return { day0, from, hours, startH, endH, pct: ms => Math.min(100, Math.max(0, ((ms - from) / span) * 100)) };
}

/** Booked windows on one technician's lane; overlapping ones share it in two rows. */
function laneBlocks(tech, data, now) {
  const blocks = data.bookings.filter(b => b.mechanic_id === tech.id).map(b => {
    const s = parseDT(b.scheduled_start_at).getTime();
    const e = (parseDT(b.scheduled_end_at) || parseDT(b.scheduled_start_at)).getTime();
    const cards = data.open_cards.filter(c => c.mechanic_id === tech.id && c.work_order_id === b.work_order_id);
    const card = cards.find(c => !c.parent_job_card_id) || cards[0];
    const running = data.time_today.some(l => l.mechanic_id === tech.id && !l.clock_out && l.work_order_id === b.work_order_id);
    // Not late while the customer has not approved: nobody may start it yet.
    const late = !running && s <= now && card?.jc_status === 'open' && !Number(card.worked_minutes) && !card.approval_missing;
    return { ...b, s, e, tone: running ? 'running' : late ? 'late' : '' };
  }).sort((a, b) => a.s - b.s);
  const ends = [-Infinity, -Infinity];
  let split = false;
  for (const b of blocks) {
    if (b.s >= ends[0]) { b.row = 0; ends[0] = b.e; } else {
      split = true;
      b.row = 1;
      b.over = b.s < ends[1];
      ends[1] = Math.max(ends[1], b.e);
    }
  }
  return { blocks, split };
}

function readTeamView() {
  try {
    const v = JSON.parse(readStore('tb.teamView') || '{}');
    return { states: Array.isArray(v.states) ? v.states.filter(s => STATES.includes(s)) : [], sort: v.sort === 'name' ? 'name' : 'status' };
  } catch { return { states: [], sort: 'status' }; }
}

function TeamPanel({ data, canTime, canManage, busyKeys, errors, clashes, clashActions, onTime, onMore, onManage }) {
  const { t } = useTranslation();
  const [view, setView] = useState(readTeamView);
  const saveView = v => { setView(v); writeStore('tb.teamView', JSON.stringify(v)); };

  if (!data) {
    return (
      <section className="tb-panel tb-team" aria-busy="true">
        <span className="tb-shimmer tb-head-skel" />
        {[0, 1, 2].map(i => <span key={i} className="tb-shimmer tb-lane-skel" />)}
      </section>
    );
  }

  const { scope, technicians } = data;
  const leader = scope.team_leader_name ? splitName(scope.team_leader_name).name : '';
  const title = scope.kind === 'all' ? t('teamBoard.team_title_all', 'All teams')
    : scope.can_switch ? t('teamBoard.team_title_of', "{{leader}}'s team", { leader: leader || `#${scope.team_leader_id}` })
      : t('teamBoard.team_title', 'My team');
  const counts = Object.fromEntries(STATES.map(s => [s, technicians.filter(x => x.state === s).length]));
  const shown = technicians
    .filter(x => !view.states.length || view.states.includes(x.state))
    .sort((a, b) => (view.sort === 'status' ? STATES.indexOf(a.state) - STATES.indexOf(b.state) : 0)
      || splitName(a.full_name).name.localeCompare(splitName(b.full_name).name));
  const toggleState = s => saveView({ ...view, states: view.states.includes(s) ? view.states.filter(x => x !== s) : [...view.states, s] });
  const now = nowMs();
  const range = dayRange(data);
  const nowP = range.pct(now);

  return (
    <section className="tb-panel tb-team" aria-labelledby="tb-team-h">
      <div className="tb-panel-head">
        <h2 id="tb-team-h">{title} <span className="tb-count">{technicians.length}</span></h2>
        <div className="tb-panel-tools">
          <div className="tb-statechips" role="group" aria-label={t('teamBoard.team_label', 'Team')}>
            {STATES.map(s => (
              <button key={s} type="button" className={`tb-statechip state-${s}${counts[s] ? '' : ' is-zero'}`}
                aria-pressed={view.states.includes(s)} onClick={() => toggleState(s)}>
                <i className="tb-dot" aria-hidden="true" />{stateLabel(t, s)} <b>{counts[s]}</b>
              </button>
            ))}
          </div>
          <label htmlFor="tb-team-sort" className="tb-sr">{t('teamBoard.sort_label', 'Sort')}</label>
          <select id="tb-team-sort" className="tb-select sm" value={view.sort} onChange={e => saveView({ ...view, sort: e.target.value })}>
            <option value="status">{t('teamBoard.sort_status', 'By status')}</option>
            <option value="name">{t('teamBoard.sort_name', 'By name')}</option>
          </select>
        </div>
      </div>

      {!technicians.length ? (
        <div className="tb-empty center">
          {scope.kind === 'all' ? <span>{t('teamBoard.empty_team_all', 'No technicians are on a team or holding open work.')}</span> : (
            <>
              <span>{t('teamBoard.empty_team_leader', 'Your team is empty. Add technicians to start assigning.')}</span>
              {canManage && <button type="button" className="tb-btn accent" onClick={onManage}><UserPlus width={15} height={15} /> {t('teamBoard.add_technicians', 'Add technicians')}</button>}
            </>
          )}
        </div>
      ) : (
        <>
          <ul className="tb-legend">
            <li><i className="sw booked" aria-hidden="true" />{t('teamBoard.legend_booked', 'Booked window')}</li>
            <li><i className="sw worked" aria-hidden="true" />{t('teamBoard.legend_worked', 'Time worked')}</li>
            <li><i className="sw now" aria-hidden="true" />{t('teamBoard.legend_now', 'Now')}</li>
            <li><i className="sw late" aria-hidden="true" />{t('teamBoard.legend_late', 'Window started — work not started')}</li>
          </ul>
          {!data.bookings.length && <p className="tb-note">{t('teamBoard.nothing_booked_today', 'Nothing booked today — a window is booked when you assign.')}</p>}

          {!shown.length ? (
            <div className="tb-empty">
              <span>{t('teamBoard.no_state', 'No technicians are {{state}} right now.', { state: view.states.map(s => stateLabel(t, s).toLowerCase()).join(' / ') })}</span>
              <button type="button" className="tb-linkbtn" onClick={() => saveView({ ...view, states: [] })}>{t('teamBoard.show_all', 'Show all')}</button>
            </div>
          ) : (
            <div className="tb-lanes" style={{ '--now': nowP }}>
              <div className="tb-axis" aria-hidden="true">
                <span />
                <div className="tb-track">
                  {range.hours.map(h => (
                    <span key={h} className={`tb-tick${h % 2 ? ' odd' : ''}`} style={{ insetInlineStart: `${range.pct(range.day0 + h * 3600000)}%` }}>
                      {fmtHM(new Date(range.day0 + h * 3600000))}
                    </span>
                  ))}
                  <span className="tb-nowchip" style={{ insetInlineStart: `${nowP}%` }}>{fmtHM(new Date(now))}</span>
                </div>
              </div>
              <ul className="tb-techs">
                {shown.map(x => (
                  <TechRow key={x.id} tech={x} data={data} range={range} now={now} allTeams={scope.kind === 'all'}
                    canTime={canTime} busyKeys={busyKeys} error={errors[`tech-${x.id}`]} clash={clashes[`tech-${x.id}`]}
                    clashActions={clashActions} onTime={onTime} onMore={onMore} />
                ))}
              </ul>
              <span className="tb-nowline" aria-hidden="true" />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TechRow({ tech, data, range, now, allTeams, canTime, busyKeys, error, clash, clashActions, onTime, onMore }) {
  const { t } = useTranslation();
  const { name, note } = splitName(tech.full_name);
  const c = tech.current;
  const spec = tech.specialty !== 'general' && specialtyLabel(t, tech.specialty);
  const running = tech.state === 'working';
  // worked today keeps counting while time is running
  const worked = tech.worked_min_today + (running ? Math.max(0, (now - parseDT(data.now).getTime()) / 60000) : 0);
  const key = `tech-${tech.id}`;
  const timeVars = { name, jc: c?.job_card_number };
  const act = (action, extra = {}) => onTime(action, { jcId: c.job_card_id, jcNumber: c.job_card_number, mechanicId: tech.id, name: tech.full_name, key, ...extra });
  const isBusy = action => busyKeys.has(`${key}:${action}`);
  const pauseReason = tech.state === 'paused' && c ? pauseReasonOf(data, tech.id, c.job_card_id, c) : null;
  // Pause asks why first; the form closes on its own once the clock is no longer running.
  const [askPause, setAskPause] = useState(false);
  useEffect(() => { if (!running) setAskPause(false); }, [running]);
  const pauseBtnRef = useRef(null);
  const closePause = () => { setAskPause(false); requestAnimationFrame(() => pauseBtnRef.current?.focus()); };
  const pauseWith = async (reason, pauseNote) => {
    if (await act('pause', { reason, note: pauseNote })) setAskPause(false);
  };

  return (
    <li className={`tb-tech state-${tech.state}`}>
      <div className="tb-tech-id">
        <Avatar tech={tech} />
        <div className="tb-tech-body">
          <div className="tb-tech-name">
            <b>{name}</b>
            {note && <span className="tb-chip">{note}</span>}
            {spec && <span className="tb-chip">{spec}</span>}
            {tech.service_bay_name && <span className="tb-faint">· {tech.service_bay_name}</span>}
            {!tech.has_login && (
              <span className="tb-chip slate" title={t('teamBoard.no_app_title', 'No app login — book their time here or on the job card')}>
                <PhoneDisabled width={12} height={12} aria-hidden="true" /> {t('teamBoard.no_app', 'No app')}
              </span>
            )}
            {allTeams && <span className="tb-chip navy">{tech.team_leader_name ? splitName(tech.team_leader_name).name : t('teamBoard.no_team_chip', 'No team')}</span>}
          </div>
          <div className={`tb-tech-state state-${tech.state}`}><StateWord state={tech.state} pauseReason={pauseReason} /> <StateDetail tech={tech} links /></div>
          <div className="tb-load">
            {t('teamBoard.load_line', 'Booked {{booked}} · worked {{worked}} today', { booked: fmtDur(tech.booked_min_today), worked: fmtDur(worked) })}
            {tech.awaiting_qc > 0 && <> · {t('teamBoard.awaiting_qc_n', '{{count}} awaiting QC', { count: tech.awaiting_qc })}</>}
            {tech.open_count > 1 && (
              <> · <button type="button" className="tb-linkbtn" onClick={() => onMore(tech.id)}>{t('teamBoard.more_cards', '+{{count}} more', { count: tech.open_count - 1 })}</button></>
            )}
          </div>
          {canTime && c && TIME_STATUSES.includes(c.jc_status) && (
            <div className="tb-timebtns">
              {running ? (
                <>
                  <button ref={pauseBtnRef} type="button" className="tb-btn ghost sm" disabled={isBusy('pause')} onClick={() => setAskPause(v => !v)}
                    aria-expanded={askPause}
                    aria-label={t('teamBoard.time_aria', '{{action}} time for {{name}} on {{jc}}', { ...timeVars, action: t('workflow.pause', 'Pause') })}>
                    <Pause width={14} height={14} /> {t('workflow.pause', 'Pause')}
                  </button>
                  <button type="button" className="tb-btn ghost sm" disabled={isBusy('stop')} onClick={() => act('stop')}
                    aria-label={t('teamBoard.time_aria', '{{action}} time for {{name}} on {{jc}}', { ...timeVars, action: t('workflow.stop', 'Stop') })}>
                    <Square width={13} height={13} /> {t('workflow.stop', 'Stop')}
                  </button>
                </>
              ) : (
                <button type="button" className="tb-btn go sm" disabled={isBusy('start')} onClick={() => act('start')}
                  aria-label={t('teamBoard.time_aria', '{{action}} time for {{name}} on {{jc}}', {
                    ...timeVars, action: tech.state === 'paused' ? t('workflow.resume', 'Resume') : t('workflow.start', 'Start'),
                  })}>
                  <Play width={14} height={14} /> {tech.state === 'paused' ? t('workflow.resume', 'Resume') : t('workflow.start', 'Start')}
                </button>
              )}
              <Link to={`/work-orders/${c.work_order_id}`} className="tb-smalllink">
                {t('teamBoard.open_job_card', 'Open job card')} <NavArrowRight width={13} height={13} className="tb-flip" aria-hidden="true" />
              </Link>
            </div>
          )}
          {canTime && c && running && askPause && (
            <PauseForm name={name} jc={c.job_card_number} busy={isBusy('pause')} onSubmit={pauseWith} onCancel={closePause} />
          )}
          {clash && !running && <ClockClash clash={clash} busy={isBusy('start')} onConfirm={() => clashActions.confirm(key)} onCancel={() => clashActions.cancel(key)} />}
          {error && <p className="tb-row-err" role="alert">{error}</p>}
        </div>
      </div>

      <Lane tech={tech} data={data} range={range} now={now} />
    </li>
  );
}

/** One technician's day: booked windows, time worked, the past shaded and now. */
function Lane({ tech, data, range, now }) {
  const { t } = useTranslation();
  const { blocks, split } = laneBlocks(tech, data, now);
  const logs = data.time_today.filter(l => l.mechanic_id === tech.id);
  const mid = range.hours[Math.floor(range.hours.length / 2)];
  return (
    <>
      <div className={`tb-lane${split ? ' is-split' : ''}`}>
        <span className="tb-lane-past" style={{ inlineSize: `${range.pct(now)}%` }} aria-hidden="true" />
        {range.hours.map(h => (
          <span key={h} className="tb-hourline" style={{ insetInlineStart: `${range.pct(range.day0 + h * 3600000)}%` }} aria-hidden="true" />
        ))}
        {blocks.map(b => {
          const late = b.tone === 'late' ? ` · ${t('teamBoard.legend_late', 'Window started — work not started')}` : '';
          const label = t('teamBoard.block_aria', '{{wo}}, booked {{start}} to {{end}}', { wo: b.work_order_number, start: fmtHM(new Date(b.s)), end: fmtHM(new Date(b.e)) }) + late;
          const p = range.pct(b.s);
          return (
            <Link key={b.work_order_id} to={`/work-orders/${b.work_order_id}`} aria-label={label} title={label}
              className={`tb-block${b.tone ? ` is-${b.tone}` : ''}${split ? ` row-${b.row}` : ''}${b.over ? ' is-over' : ''}`}
              style={{ insetInlineStart: `${p}%`, inlineSize: `max(6px, ${range.pct(b.e) - p}%)` }}>
              <span>{shortWo(b.work_order_number)}{b.plate_number ? ` · ${b.plate_number}` : ''}</span>
            </Link>
          );
        })}
        {logs.map(l => {
          const s = range.pct(parseDT(l.clock_in).getTime());
          const e = range.pct(l.clock_out ? parseDT(l.clock_out).getTime() : now);
          return <span key={l.id} className={`tb-worked${l.clock_out ? '' : ' is-running'}`} style={{ insetInlineStart: `${s}%`, inlineSize: `max(2px, ${e - s}%)` }} aria-hidden="true" />;
        })}
        <span className="tb-lane-now" style={{ insetInlineStart: `${range.pct(now)}%` }} aria-hidden="true" />
        <span className="tb-lane-hours" aria-hidden="true">
          {[range.hours[0], mid, range.hours[range.hours.length - 1]].map((h, i) => <span key={i}>{fmtHM(new Date(range.day0 + h * 3600000))}</span>)}
        </span>
      </div>

      {blocks.length > 0 && (
        <ul className="tb-bchips">
          {blocks.map(b => (
            <li key={b.work_order_id}>
              <Link to={`/work-orders/${b.work_order_id}`} className={b.tone ? `is-${b.tone}` : ''}>
                <bdi>{fmtHM(new Date(b.s))}–{fmtHM(new Date(b.e))}</bdi>·<bdi>{shortWo(b.work_order_number)}</bdi>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ── Job cards on the team ───────────────────────────────────────── */

function CardsPanel({ data, panelRef, tech, onClearTech }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('all');
  if (!data) {
    return (
      <section className="tb-panel tb-cards" aria-busy="true">
        <span className="tb-shimmer tb-head-skel" />
        {[0, 1, 2].map(i => <span key={i} className="tb-shimmer tb-row-skel sm" />)}
      </section>
    );
  }
  const cards = data.open_cards;
  const techs = new Map(data.technicians.map(x => [x.id, x]));
  const running = new Set(data.time_today.filter(l => !l.clock_out).map(l => l.job_card_id));
  const extra = Math.max(0, (nowMs() - parseDT(data.now).getTime()) / 60000);
  const counts = Object.fromEntries(CARD_FILTERS.map(s => [s, cards.filter(c => c.jc_status === s).length]));
  // A filter only applies while its chip shows: a status that emptied on a
  // refresh, or a technician no longer on the board, would hide every row
  // with nothing on screen to clear it.
  const filterTech = tech ? techs.get(tech) : null;
  const active = status !== 'all' && counts[status] ? status : 'all';
  const rows = cards.filter(c => (active === 'all' || c.jc_status === active) && (!filterTech || c.mechanic_id === tech));
  const title = data.scope.kind === 'all' ? t('teamBoard.cards_title_all', 'Job cards in work') : t('teamBoard.cards_title', 'Job cards on my team');

  return (
    <section className="tb-panel tb-cards" aria-labelledby="tb-cards-h">
      <div className="tb-panel-head">
        <h2 id="tb-cards-h" ref={panelRef} tabIndex={-1}>{title} <span className="tb-count">{cards.length}</span></h2>
        <div className="tb-panel-tools">
          <button type="button" className="tb-chipbtn" aria-pressed={active === 'all'} onClick={() => setStatus('all')}>
            {t('teamBoard.cards_filter_all', 'All')} <b>{cards.length}</b>
          </button>
          {CARD_FILTERS.filter(s => counts[s]).map(s => (
            <button key={s} type="button" className="tb-chipbtn" aria-pressed={active === s} onClick={() => setStatus(active === s ? 'all' : s)}>
              {jcLabel(t, s)} <b>{counts[s]}</b>
            </button>
          ))}
          {filterTech && (
            <span className="tb-chip navy tb-filterchip">
              {t('teamBoard.filter_tech', 'Technician: {{name}}', { name: splitName(filterTech.full_name).name })}
              <button type="button" onClick={onClearTech} aria-label={t('teamBoard.clear_filter', 'Clear filter')}><Xmark width={12} height={12} /></button>
            </span>
          )}
        </div>
      </div>

      {!rows.length ? <p className="tb-note">{t('teamBoard.cards_empty', 'No job cards in work on this team right now.')}</p> : (
        <table className="tb-ctable">
          <caption className="tb-sr">{title}</caption>
          <thead>
            <tr>
              <th scope="col">{t('teamBoard.col_job', 'Job card')}</th>
              <th scope="col">{t('teamBoard.col_vehicle', 'Work order · vehicle')}</th>
              <th scope="col">{t('teamBoard.col_tech', 'Technician')}</th>
              <th scope="col">{t('teamBoard.col_status', 'Status')}</th>
              <th scope="col">{t('teamBoard.col_window', 'Booked window')}</th>
              <th scope="col">{t('teamBoard.col_time', 'Time worked')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const who = techs.get(c.mechanic_id);
              const isRunning = running.has(c.id);
              const start = parseDT(c.scheduled_start_at), end = parseDT(c.scheduled_end_at);
              return (
                <tr key={c.id}>
                  <td className="c-job">
                    <Link to={`/work-orders/${c.work_order_id}`} className="tb-mono b"><bdi>{c.job_card_number}</bdi></Link>
                    <span className="tb-sub">
                      {c.parent_job_card_id ? `${t('workflow.sub', 'Sub-job card')} · ${c.title || ''}` : t('workflow.main', 'Main job card')}
                      {c.department && c.department !== 'mechanical' && <> · {deptLabel(t, c.department)}</>}
                    </span>
                  </td>
                  <td className="c-veh">
                    <bdi className="tb-wo-text">{c.work_order_number}</bdi>
                    <span className="tb-sub">{[c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')} <Plate value={c.plate_number} /></span>
                  </td>
                  <td className="c-tech">
                    {who && <><Avatar tech={who} size={22} ring={false} /> <span className="tb-tname" title={who.full_name}>{splitName(who.full_name).name}</span></>}
                  </td>
                  <td className="c-status">
                    <span className="tb-pill" style={jcPillStyle(c.jc_status)}>{jcLabel(t, c.jc_status)}</span>
                    {!isRunning && c.last_end_reason === 'pause' && (
                      <span className="tb-chip warn">{timeStateLabel(t, 'paused', pauseReasonOf(data, c.mechanic_id, c.id))}</span>
                    )}
                    {!!c.approval_missing && <span className="tb-chip">{t('teamBoard.waiting_customer', 'Waiting for the customer')}</span>}
                    {c.parts_waiting > 0 && (
                      <span className="tb-chip warn">
                        <Box3dPoint width={12} height={12} aria-hidden="true" />
                        {t('teamBoard.parts_waiting', '{{count}} parts waiting', { count: c.parts_waiting })}
                        {c.parts_expected && <> · {t('teamBoard.parts_expected', 'expected {{date}}', { date: fmtDate(parseDT(`${c.parts_expected} 00:00:00`)) })}</>}
                      </span>
                    )}
                  </td>
                  <td className="c-win">
                    {start ? <bdi>{fmtDayHM(start)}–{fmtHM(end)}</bdi> : <i className="tb-faint">{t('teamBoard.no_window', 'No window')}</i>}
                  </td>
                  <td className="c-time">
                    {isRunning && <i className="tb-pulse" aria-hidden="true" />}
                    {fmtDur(c.worked_minutes + (isRunning ? extra : 0))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ── Manage team ─────────────────────────────────────────────────── */

function TeamModal({ scope, technicians, onClose, onChanged }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('on');
  const [pool, setPool] = useState(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const onTeam = technicians.filter(x => Number(x.team_leader_id) === Number(scope.team_leader_id));
  // A manager always names the team — without it the server would make the
  // manager the team leader.
  const leaderBody = scope.can_switch ? { team_leader_id: scope.team_leader_id } : {};
  const failed = t('teamBoard.action_failed', 'That did not work.');

  useEffect(() => {
    if (tab !== 'add' || pool) return undefined;
    let live = true;
    api.get('/team-leader/unassigned-technicians')
      .then(r => { if (!live) return; if (r.success) setPool(r.data || []); else { setPool([]); setErr(r.message || failed); } })
      .catch(e => { if (live) { setPool([]); setErr(e?.message || failed); } });
    return () => { live = false; };
  }, [tab, pool, failed]);

  const send = async (body, close) => {
    setSaving(true); setErr('');
    try {
      const res = await api.post('/team-leader/team', { ...body, ...leaderBody });
      if (!res.success) { setErr(res.message || failed); return; }
      setConfirm(null); setPicked(new Set()); setPool(null);
      onChanged(res.message, close);
    } catch (e) {
      setErr(e?.message || failed);
    } finally {
      setSaving(false);
    }
  };
  const submit = e => {
    e.preventDefault();
    if (tab === 'add' && picked.size && !saving) send({ mechanic_ids: [...picked], action: 'add' }, true);
  };
  const toggle = id => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const needle = norm(q.trim());
  const list = (pool || []).filter(x => !needle || norm(x.full_name).includes(needle));
  const leader = scope.team_leader_name ? splitName(scope.team_leader_name).name : `#${scope.team_leader_id}`;
  const onTabKey = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const k = e.key === 'Home' ? 'on' : e.key === 'End' ? 'add' : (tab === 'on' ? 'add' : 'on');
    setTab(k);
    document.getElementById(`tb-tm-${k}`)?.focus();
  };

  return (
    <Dialog id="tb-tm" variant="is-center" dirty={picked.size > 0 || !!confirm} busy={saving} onClose={onClose} onSubmit={submit}
      title={scope.can_switch ? t('teamBoard.team_modal_title', "Manage {{leader}}'s team", { leader }) : t('teamBoard.team_modal_title_mine', 'Manage my team')}
      footer={(
        <>
          {err && <p className="tb-dlg-err" role="alert"><WarningTriangle width={15} height={15} /> {err}</p>}
          <button type="button" className="tb-btn ghost" onClick={onClose} disabled={saving}>{t('teamBoard.close', 'Close')}</button>
          {tab === 'add' && (
            <button type="submit" className="tb-btn accent" disabled={!picked.size || saving}>
              {saving ? t('teamBoard.adding', 'Adding…') : t('teamBoard.add_n', 'Add {{count}} to the team', { count: picked.size })}
            </button>
          )}
        </>
      )}>
      <div className="tb-mtabs" role="tablist">
        {[['on', t('teamBoard.tab_on_team', 'On the team ({{count}})', { count: onTeam.length })], ['add', t('teamBoard.tab_add', 'Add technicians')]].map(([k, label]) => (
          <button key={k} id={`tb-tm-${k}`} type="button" role="tab" aria-selected={tab === k} aria-controls="tb-tm-panel"
            tabIndex={tab === k ? 0 : -1} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)} onKeyDown={onTabKey}>
            {label}
          </button>
        ))}
      </div>
      <div id="tb-tm-panel" role="tabpanel" aria-labelledby={`tb-tm-${tab}`}>
        {tab === 'on' ? (
          !onTeam.length ? <p className="tb-note">{t('teamBoard.on_team_empty', 'No technicians on this team yet.')}</p> : (
            <ul className="tb-mlist">
              {onTeam.map(x => {
                const { name, note } = splitName(x.full_name);
                return (
                  <li key={x.id}>
                    <Avatar tech={x} size={32} ring={false} />
                    <span className="tb-mname"><b>{name}</b>{note && <span className="tb-chip">{note}</span>}</span>
                    {confirm === x.id ? (
                      <span className="tb-confirm">
                        <span>{t('teamBoard.remove_confirm', 'Remove {{name}} from the team?', { name })}</span>
                        <button type="button" className="tb-btn danger-ghost sm" disabled={saving}
                          onClick={() => send({ mechanic_ids: [x.id], action: 'remove' }, false)}>{t('teamBoard.remove_yes', 'Yes, remove')}</button>
                        <button type="button" className="tb-btn ghost sm" onClick={() => setConfirm(null)}>{t('teamBoard.cancel', 'Cancel')}</button>
                      </span>
                    ) : (
                      <button type="button" className="tb-btn danger-ghost sm" onClick={() => setConfirm(x.id)}>{t('teamBoard.remove', 'Remove')}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <>
            <p className="tb-hint muted">{t('teamBoard.pool_hint', "Only technicians who aren't on another team are listed.")}</p>
            <div className="tb-search">
              <label htmlFor="tb-tm-q" className="tb-sr">{t('teamBoard.search_tech', 'Search technicians')}</label>
              <Search width={15} height={15} aria-hidden="true" />
              {/* Enter here searches; it must not add the ticked technicians and close */}
              <input id="tb-tm-q" type="search" value={q} onChange={e => setQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} placeholder={t('teamBoard.search_tech', 'Search technicians')} />
            </div>
            {pool == null ? <p className="tb-note">{t('teamBoard.loading', 'Loading…')}</p>
              : !list.length ? <p className="tb-note">{t('teamBoard.pool_empty', 'Nobody left to add — every technician is already on a team.')}</p> : (
                <ul className="tb-mlist pick">
                  {list.map(x => {
                    const spec = x.specialty !== 'general' && specialtyLabel(t, x.specialty);
                    return (
                      <li key={x.id}>
                        <label>
                          <input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} />
                          <span className="tb-av s32" style={{ background: AVATAR_BG[x.id % 6] }} aria-hidden="true">{initials(x.full_name)}</span>
                          <span className="tb-mname"><b>{x.full_name}</b>{spec && <span className="tb-chip">{spec}</span>}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/* ── Toasts ──────────────────────────────────────────────────────── */

function Toasts({ items, onDismiss }) {
  return createPortal(
    <div className="tb-layer">
      <div className="tb-toasts" aria-live="polite">
        {items.map(x => <Toast key={x.id} toast={x} onDismiss={onDismiss} />)}
      </div>
    </div>,
    document.body
  );
}

function Toast({ toast, onDismiss }) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (toast.kind === 'error' || paused) return undefined;
    const timer = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast, paused, onDismiss]);
  const Icon = toast.kind === 'ok' ? CheckCircle : WarningTriangle;
  return (
    <div className={`tb-toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : undefined}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <Icon width={17} height={17} aria-hidden="true" />
      <span>{toast.text}</span>
      <button type="button" aria-label={t('teamBoard.dismiss', 'Dismiss')} onClick={() => onDismiss(toast.id)}><Xmark width={14} height={14} /></button>
    </div>
  );
}
