/**
 * JobCardTile — one of the technician's job cards (Step 6), on My Jobs
 * (mode "list") and on its own page (mode "page", everything open, the
 * actions in a bar at the bottom of a phone screen).
 *
 * The technician moves work only through the job card:
 *   POST /api/job-cards/:id/time/start   Start / Resume ({pause_other:true} when
 *                                        another clock is running — asked first)
 *   POST /api/job-cards/:id/time/pause   Pause, with a reason (PauseReasonSheet)
 *   POST /api/job-cards/:id/time/stop    Stop (while running or paused)
 *   POST /api/job-cards/:id/done         Job done → quality check
 *   POST /api/job-cards/:id/requisitions Request parts → the Store
 * The work order follows on the server; nothing here sets its status.
 *
 * No prices and no customer details: plate, vehicle, complaint, approved
 * work as "qty × name", parts with the Store's answer, the clock, the QC.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PlaySolid, PauseSolid, CheckCircle, WarningTriangle, Hourglass, Package, Plus,
  NavArrowDown, ShieldCheck, Timer, Repeat,
} from 'iconoir-react';
import api from '../../lib/api';
import { jcLabel, jcTone, timeStateLabel, pauseReasonLabel, TONES } from '../../lib/statusLabels';
import {
  clockOf, dayOf, fmtMinutes, rangeOf, ltr, liveMinutes, cardKindLabel, vehicleLine, qty, PASSED,
} from './format';
import { useMediaQuery } from './useMyJobs';
import PauseReasonSheet from './PauseReasonSheet';
import ProgressTrack from './ProgressTrack';
import RequestPartsForm from './RequestPartsForm';
import { ConfirmSheet } from './Sheet';
import './technician.css';

/** The chip on the right of the header: the clock when it says more than the status. */
function statusChip(t, card) {
  const s = card.status;
  if (s === 'qc_failed' && card.time_state !== 'running') return { label: jcLabel(t, s), ...jcTone(s) };
  if (!PASSED.includes(s) && s !== 'qc_pending' && s !== 'cancelled') {
    if (card.time_state === 'running') return { label: timeStateLabel(t, 'running'), ...TONES.green };
    if (card.time_state === 'paused') return { label: timeStateLabel(t, 'paused', card.last_pause_reason), ...TONES.amber };
  }
  return { label: jcLabel(t, s), ...jcTone(s) };
}

/** The Store's answer on one requisition line. */
function partAnswer(t, p, lang) {
  if (p.status === 'cancelled' || p.status === 'returned') return { tone: 'muted', text: t('technician.store_cancelled', 'Cancelled') };
  if (p.status === 'issued' || p.status === 'partially_issued') return { tone: 'ok', text: t('technician.store_issued', 'Issued — collect from the Store') };
  if (p.availability === 'not_available') {
    return {
      tone: 'warn',
      text: p.expected_date
        ? t('technician.store_eta', { date: dayOf(p.expected_date, lang), defaultValue: 'Not on the shelf — expected {{date}}' })
        : t('technician.store_missing', 'Not on the shelf'),
    };
  }
  return { tone: 'wait', text: t('technician.store_waiting', 'Waiting for the Store') };
}

const ITEM_GROUPS = [
  ['labour', 'technician.labour', 'Labour'],
  ['parts', 'technician.parts', 'Parts'],
  ['other', 'technician.other', 'Other'],
];
const groupOf = item => (item.item_type === 'labour' ? 'labour' : item.item_type === 'parts' ? 'parts' : 'other');

export default function JobCardTile({
  card, mode = 'list', expanded = false, onToggle, now, fetchedAt,
  runningElsewhere = null, onChanged, showToast, highlight = false,
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isPage = mode === 'page';
  const phone = useMediaQuery('(max-width: 767px)');
  const [busy, setBusy] = useState(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [switchTo, setSwitchTo] = useState(null);
  const [partsOpen, setPartsOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const toast = (msg, type = 'success') => showToast?.(msg, type, type === 'error' ? 5500 : 3500);

  const s = card.status;
  const running = card.time_state === 'running';
  const paused = card.time_state === 'paused';
  const passed = PASSED.includes(s);
  const qcPending = s === 'qc_pending';
  const rework = s === 'qc_failed';
  const closed = ['completed', 'cancelled'].includes(card.wo_status) || s === 'cancelled';
  const readOnly = passed || closed;
  const open = isPage || expanded;
  const other = runningElsewhere && Number(runningElsewhere.job_card_id) !== Number(card.id) ? runningElsewhere : null;

  /* ── actions ── */
  const post = async (action, path, body) => {
    setBusy(action);
    try {
      const res = await api.post(`/job-cards/${card.id}/${path}`, body);
      return res;
    } catch {
      toast(t('technician.network_error', 'No connection. Try again.'), 'error');
      return null;
    } finally {
      if (mounted.current) setBusy(null);
    }
  };
  const after = async (res, okText) => {
    if (!res) return false;
    if (res.success) { toast(okText); await onChanged?.(); return true; }
    // The server says exactly what blocked it (no time booked, not yours…);
    // reload so the buttons match the server again.
    toast(res.message || t('technician.action_failed', "Couldn't save. Try again."), 'error');
    onChanged?.();
    return false;
  };

  const start = async (pauseOther = false) => {
    if (!pauseOther && other) { setSwitchTo(other); return; }
    const res = await post('start', 'time/start', pauseOther ? { pause_other: true } : {});
    if (res && !res.success && res.code === 'CLOCK_RUNNING_ELSEWHERE') { setSwitchTo(res.running || {}); return; }
    setSwitchTo(null);
    await after(res, t('technician.toast_started', 'Time started'));
  };
  const pause = async (reason, note) => {
    const res = await post('pause', 'time/pause', { reason, note: note || undefined });
    if (await after(res, t('technician.toast_paused', { reason: pauseReasonLabel(t, reason), defaultValue: 'Paused · {{reason}}' }))) setPauseOpen(false);
  };
  const stop = async () => after(await post('stop', 'time/stop', {}), t('technician.toast_stopped', 'Time stopped'));
  const done = async () => {
    const res = await post('done', 'done');
    setConfirmDone(false);
    await after(res, t('technician.toast_done', 'Job done — waiting for the quality check'));
  };

  /* ── figures ── */
  const onJob = liveMinutes(card, 'minutes', fetchedAt, now);
  const today = liveMinutes(card, 'today_minutes', fetchedAt, now);
  const chip = statusChip(t, card);
  const vehicle = vehicleLine(card);
  const parts = card.parts || [];
  const items = card.items || [];
  const missing = parts.filter(p => p.availability === 'not_available' && !['issued', 'partially_issued', 'cancelled', 'returned'].includes(p.status));
  const issuedMr = [...new Set(parts.filter(p => p.status === 'issued' || p.status === 'partially_issued').map(p => p.req_number).filter(Boolean))];

  let stateLine;
  if (running) stateLine = t('technician.working_since', { time: clockOf(card.running_since), defaultValue: 'Working since {{time}}' });
  else if (paused) stateLine = t('technician.paused_since', { state: timeStateLabel(t, 'paused', card.last_pause_reason), time: clockOf(card.paused_since), defaultValue: '{{state}} · since {{time}}' });
  else stateLine = timeStateLabel(t, card.time_state || 'idle');

  const anyBusy = !!busy;
  const actions = !readOnly && !qcPending && (
    <div className={`tk-actions${isPage && phone ? ' tk-actions--bar' : ''}`}>
      <button type="button" className="tk-btn tk-btn--start" onClick={() => start(false)}
        disabled={running || anyBusy || card.approval_missing}>
        {busy === 'start' ? <span className="tk-spin" aria-hidden="true" /> : <PlaySolid width={20} height={20} aria-hidden="true" />}
        {paused ? t('technician.resume', 'Resume') : t('technician.start', 'Start')}
      </button>
      <button type="button" className="tk-btn tk-btn--pause" onClick={() => setPauseOpen(true)} disabled={!running || anyBusy}>
        {busy === 'pause' ? <span className="tk-spin" aria-hidden="true" /> : <PauseSolid width={18} height={18} aria-hidden="true" />}
        {t('technician.pause', 'Pause')}
      </button>
      <button type="button" className="tk-btn tk-btn--stop" onClick={stop} disabled={!(running || paused) || anyBusy}>
        {busy === 'stop' ? <span className="tk-spin" aria-hidden="true" /> : <span className="tk-stop-ico" aria-hidden="true" />}
        {t('technician.stop', 'Stop')}
      </button>
      <button type="button" className="tk-btn tk-btn--done" onClick={() => setConfirmDone(true)} disabled={anyBusy}>
        {busy === 'done' ? <span className="tk-spin" aria-hidden="true" /> : <CheckCircle width={20} height={20} aria-hidden="true" />}
        {t('technician.job_done', 'Job done')}
      </button>
    </div>
  );

  const cls = ['tk-card', `tk-card--${mode}`, running && 'is-running', rework && 'is-rework', qcPending && 'is-qc', passed && 'is-passed', highlight && 'is-highlight']
    .filter(Boolean).join(' ');

  return (
    <article id={`tk-card-${card.id}`} className={cls} aria-labelledby={`tk-card-${card.id}-title`}>
      {/* ── header ── */}
      <header className="tk-card-head">
        <div className="tk-card-id">
          <h3 id={`tk-card-${card.id}-title`} className="tk-plate">{card.plate_number || card.work_order_number}</h3>
          <span className="tk-chip" style={{ background: chip.bg, color: chip.color }}>{chip.label}</span>
        </div>
        <div className="tk-card-refs">
          {isPage
            ? <span>{card.work_order_number} · {card.job_card_number}</span>
            : <Link to={`/mechanic/jobs/${card.id}`} className="tk-card-link">{card.work_order_number} · {card.job_card_number}</Link>}
        </div>
        <div className="tk-card-kind">
          <span className={`tk-kind ${card.is_main ? 'is-main' : 'is-sub'}`}>{cardKindLabel(t, card)}</span>
          {!card.is_main && card.title && <span className="tk-card-title">{card.title}</span>}
        </div>
      </header>

      <div className="tk-card-body">
        {/* ── vehicle ── */}
        {(vehicle || card.bay_name || card.scheduled_start_at) && (
          <div className="tk-vehicle">
            {vehicle && <span>{vehicle}</span>}
            {card.bay_name && <span>{card.bay_name}</span>}
            {card.scheduled_start_at && (
              <span className={`tk-booked${card.late ? ' is-late' : ''}`}>
                {card.late
                  ? t('technician.late_booked', { range: rangeOf(card.scheduled_start_at, card.scheduled_end_at), defaultValue: 'Late · booked {{range}}' })
                  : t('technician.booked', { range: rangeOf(card.scheduled_start_at, card.scheduled_end_at), defaultValue: 'Booked {{range}}' })}
              </span>
            )}
          </div>
        )}

        {/* ── alerts ── */}
        {rework && (
          <div className="tk-alert tk-alert--red" role="alert">
            <WarningTriangle width={18} height={18} aria-hidden="true" />
            <div>
              <div className="tk-alert-title">
                {card.qc_notes
                  ? t('technician.alert_rework', { notes: card.qc_notes, defaultValue: 'Rework needed — {{notes}}' })
                  : jcLabel(t, 'qc_failed')}
              </div>
              {card.qc_inspector_name && (
                <div className="tk-alert-sub">
                  {t('technician.alert_checked_by', { name: card.qc_inspector_name, time: `${dayOf(card.qc_at, lang)} ${clockOf(card.qc_at)}`.trim(), defaultValue: 'Checked by {{name}} at {{time}}' })}
                </div>
              )}
            </div>
          </div>
        )}
        {card.approval_missing && !readOnly && (
          <div className="tk-alert tk-alert--amber">
            <WarningTriangle width={18} height={18} aria-hidden="true" />
            <div className="tk-alert-title">{t('technician.alert_approval', 'Waiting for customer approval — ask the Service Advisor.')}</div>
          </div>
        )}
        {!readOnly && missing.map(p => (
          <div key={`m-${p.id}`} className="tk-alert tk-alert--amber">
            <Package width={18} height={18} aria-hidden="true" />
            <div className="tk-alert-title">
              {p.expected_date
                ? t('technician.alert_part_eta', { part: p.description, date: dayOf(p.expected_date, lang), defaultValue: '{{part}} not on the shelf — expected {{date}}' })
                : t('technician.alert_part_missing', { part: p.description, defaultValue: '{{part}} not on the shelf' })}
            </div>
          </div>
        ))}
        {s === 'parts_issued' && (
          <div className="tk-alert tk-alert--green">
            <Package width={18} height={18} aria-hidden="true" />
            <div className="tk-alert-title">
              {issuedMr.length
                ? t('technician.alert_parts_issued_mr', { mr: issuedMr.join(', '), defaultValue: 'Parts issued — collect from the Store ({{mr}})' })
                : t('technician.alert_parts_issued', 'Parts issued — collect from the Store')}
            </div>
          </div>
        )}

        {/* ── time / result ── */}
        {passed ? (
          <div className="tk-result tk-result--passed" role="status">
            <ShieldCheck width={22} height={22} aria-hidden="true" />
            <div>
              <div className="tk-result-title">{t('technician.qc_passed_banner', 'QC passed — Quality check and test drive passed. The Service Advisor hands the car over.')}</div>
              {card.handed_over_at && (
                <div className="tk-result-sub">✓ {t('technician.handed_over', { date: dayOf(card.handed_over_at, lang), defaultValue: 'Handed over {{date}}' })}</div>
              )}
            </div>
          </div>
        ) : qcPending ? (
          <div className="tk-result tk-result--qc" role="status">
            <Hourglass width={22} height={22} aria-hidden="true" />
            <div className="tk-result-title">{t('technician.waiting_qc_panel', 'Done — waiting for the quality check. The Supervisor, Foreman or Team Leader checks it and test-drives it.')}</div>
          </div>
        ) : closed ? (
          <div className="tk-result tk-result--closed" role="status">
            <div className="tk-result-title">{t('technician.job_closed', 'This job is closed. Nothing more to book on it.')}</div>
          </div>
        ) : null}

        {!passed && (
          <div className={`tk-time tk-time--${card.time_state || 'idle'}`}>
            <div className="tk-time-figures">
              <Timer width={18} height={18} aria-hidden="true" />
              <span>{t('technician.on_job', { time: fmtMinutes(onJob), defaultValue: 'On this job {{time}}' })}</span>
              <span className="tk-time-sep" aria-hidden="true">·</span>
              <span>{t('technician.today_short', { time: fmtMinutes(today), defaultValue: 'today {{time}}' })}</span>
            </div>
            <div className="tk-time-state">
              {running && <span className="tk-pulse" aria-hidden="true" />}
              {stateLine}
            </div>
          </div>
        )}

        {!(isPage && phone) && actions}

        {/* ── job details ── */}
        {!isPage && (
          <button type="button" className="tk-details-toggle" aria-expanded={open} aria-controls={`tk-card-${card.id}-details`} onClick={onToggle}>
            {t('technician.details', 'Job details')}
            <NavArrowDown width={18} height={18} aria-hidden="true" className={open ? 'is-open' : ''} />
          </button>
        )}
        {open && (
          <div id={`tk-card-${card.id}-details`} className="tk-details">
            {card.description && (
              <section className="tk-block">
                <h4 className="tk-label">{t('technician.complaint', 'Complaint')}</h4>
                <p className="tk-text">{card.description}</p>
              </section>
            )}
            {card.special_instructions && String(card.special_instructions).trim() && (
              <section className="tk-block">
                <h4 className="tk-label">{t('technician.notes_for_you', 'Notes for you')}</h4>
                <p className="tk-text tk-text--note">{card.special_instructions}</p>
              </section>
            )}

            <section className="tk-block">
              <h4 className="tk-label">{t('technician.approved_work', 'Approved work')}</h4>
              {items.length ? ITEM_GROUPS.map(([g, key, def]) => {
                const list = items.filter(i => groupOf(i) === g);
                if (!list.length) return null;
                return (
                  <div key={g} className="tk-workgroup">
                    <div className="tk-workgroup-title">{t(key, def)}</div>
                    <ul className="tk-list">
                      {list.map((it, idx) => <li key={`${g}-${idx}`}><span className="tk-qty">{qty(it.quantity)} ×</span> {it.name}</li>)}
                    </ul>
                  </div>
                );
              }) : <p className="tk-muted">{t('technician.no_work', 'No approved work on this job card yet.')}</p>}
            </section>

            <section className="tk-block">
              <div className="tk-block-head">
                <h4 className="tk-label">{t('technician.parts_title', 'Parts')}</h4>
                {!readOnly && !qcPending && !partsOpen && (
                  <button type="button" className="tk-btn tk-btn--outline tk-btn--sm" onClick={() => setPartsOpen(true)}>
                    <Plus width={16} height={16} aria-hidden="true" /> {t('technician.request_parts', 'Request parts')}
                  </button>
                )}
              </div>
              {parts.length > 0 ? (
                <ul className="tk-list tk-parts">
                  {parts.map(p => {
                    const a = partAnswer(t, p, lang);
                    return (
                      <li key={p.id}>
                        <span className="tk-part-name"><span className="tk-qty">{qty(p.quantity_requested)} ×</span> {p.description}</span>
                        <span className={`tk-badge tk-badge--${a.tone}`}>{a.text}</span>
                        {p.req_number && <span className="tk-part-mr">{p.req_number}</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : !partsOpen && <p className="tk-muted">{t('technician.no_parts', 'No parts requested yet.')}</p>}
              {partsOpen && (
                <RequestPartsForm card={card} toast={toast} onCancel={() => setPartsOpen(false)}
                  onSent={async () => { setPartsOpen(false); await onChanged?.(); }} />
              )}
            </section>

            <section className="tk-block">
              <h4 className="tk-label">{t('technician.progress_title', 'Progress')}</h4>
              <ProgressTrack card={card} />
            </section>

            {(Array.isArray(card.time_logs) && card.time_logs.length > 0) || card.odometer_in ? (
              <section className="tk-block">
                <h4 className="tk-label">{t('technician.time_log', 'Time log')}</h4>
                {Array.isArray(card.time_logs) && card.time_logs.length > 0 && (
                  <ul className="tk-list tk-log">
                    {[...card.time_logs].reverse().map((l, idx) => {
                      const end = !l.clock_out
                        ? timeStateLabel(t, 'running')
                        : l.end_reason === 'pause'
                          ? timeStateLabel(t, 'paused', l.pause_reason)
                          : timeStateLabel(t, 'stopped');
                      return (
                        <li key={idx}>
                          <span className="tk-log-when">{dayOf(l.clock_in, lang)} {ltr(`${clockOf(l.clock_in)}–${l.clock_out ? clockOf(l.clock_out) : '…'}`)}</span>
                          <span className="tk-log-what">{end}{l.end_note ? ` — ${l.end_note}` : ''}</span>
                          <span className="tk-log-min">{fmtMinutes(l.minutes)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {card.odometer_in ? (
                  <p className="tk-muted">{t('technician.odometer_in', { km: Number(card.odometer_in).toLocaleString(lang), defaultValue: 'Odometer in: {{km}} km' })}</p>
                ) : null}
              </section>
            ) : null}
          </div>
        )}
      </div>

      {isPage && phone && actions}

      <PauseReasonSheet open={pauseOpen} card={card} busy={busy === 'pause'} onCancel={() => setPauseOpen(false)} onPause={pause} />
      <ConfirmSheet
        open={confirmDone} id={`tk-done-${card.id}`} icon={CheckCircle} tone="dark" busy={busy === 'done'}
        title={t('technician.done_title', { jc: card.job_card_number, defaultValue: 'Mark {{jc}} done?' })}
        body={t('technician.done_confirm', 'Time stops and the Supervisor, Foreman or Team Leader does the quality check and test drive.')}
        warning={Number(card.minutes || 0) === 0 && !running
          ? t('technician.done_no_time', 'No time is booked on this job card yet. Press Start first.') : null}
        confirmLabel={t('technician.done_yes', 'Yes, job done')}
        onConfirm={done} onClose={() => setConfirmDone(false)} />
      <ConfirmSheet
        open={!!switchTo} id={`tk-switch-${card.id}`} icon={Repeat} tone="start" busy={busy === 'start'}
        title={t('technician.switch_title', 'Switch jobs?')}
        body={t('technician.switch_confirm', {
          wo: switchTo?.work_order_number || '', jc: switchTo?.job_card_number || '',
          defaultValue: 'Time is running on {{wo}} / {{jc}}. Pause it and start here?',
        })}
        confirmLabel={t('technician.switch_yes', 'Pause it and start here')}
        onConfirm={() => start(true)} onClose={() => setSwitchTo(null)} />
    </article>
  );
}
