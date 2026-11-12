/**
 * ScanStation — the PC at the scanning station (client meeting, 3 Nov 2026,
 * point 17). Technicians work from printed job cards: each job on the card
 * has its own barcode (backend lib/service-job-sheet.js). A USB barcode
 * scanner types the code and presses Enter into the one input here, which
 * keeps the focus:
 *
 *   a job's code   → not started (or paused): START it for its technician;
 *                    running: END it (the job is finished)
 *   a badge's code → says who is at the station; their next job scan must be
 *                    one of theirs (required when a manager switches it on)
 *
 * POST /api/job-tasks/scan does the work (lib/job-tasks.js scanTask). The
 * station is signed in as floor staff (time.book or job.assign); the screen
 * answers with a colour, a sound and big text, then waits for the next scan.
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScanBarcode, Play, Check, WarningTriangle, User, Expand, Clock, Lock } from 'iconoir-react';
import { AuthContext } from '../context/AuthContext';
import { canDo } from '../lib/permissions';
import api from '../lib/api';
import './ScanStation.css';

const BADGE_SECONDS = 30;
const RESULT_SECONDS = 9;
const hhmm = s => (s ? String(s).replace('T', ' ').slice(11, 16) : '');
const fmtMin = m => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`; };

/** Short tones: no files to load, works offline. */
function useBeep() {
  const ctx = useRef(null);
  return useCallback(kind => {
    try {
      ctx.current = ctx.current || new (window.AudioContext || window.webkitAudioContext)();
      const ac = ctx.current;
      const notes = { start: [[660, 0], [880, 0.12]], end: [[880, 0], [660, 0.12], [990, 0.24]], badge: [[740, 0]], error: [[200, 0], [160, 0.18]], warn: [[440, 0]] }[kind] || [[600, 0]];
      for (const [freq, at] of notes) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = kind === 'error' ? 'square' : 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, ac.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + 0.16);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + at); o.stop(ac.currentTime + at + 0.18);
      }
    } catch { /* no sound: the colour still shows */ }
  }, []);
}

export default function ScanStation() {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const allowed = canDo(user, 'time.book') || canDo(user, 'job.assign');
  const beep = useBeep();
  const stationRef = useRef(null);
  const inputRef = useRef(null);
  const busyRef = useRef(false);
  const [value, setValue] = useState('');
  const [settings, setSettings] = useState({ badge_required: false, can_configure: false, recent: [] });
  const [result, setResult] = useState(null);   // { tone, ...answer }
  const [badge, setBadge] = useState(null);     // { code, technician, tasks, until }
  const [now, setNow] = useState(new Date());

  const loadStation = useCallback(async () => {
    try {
      const r = await api.get('/job-tasks/station');
      if (r.success) setSettings(r.data);
    } catch { /* keep the last list */ }
  }, []);
  useEffect(() => { if (allowed) { loadStation(); const i = setInterval(loadStation, 30000); return () => clearInterval(i); } return undefined; }, [allowed, loadStation]);
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);

  // The answer fades back to "scan" after a while; a badge waits BADGE_SECONDS for its job.
  useEffect(() => {
    if (!result) return undefined;
    const i = setTimeout(() => setResult(null), RESULT_SECONDS * 1000);
    return () => clearTimeout(i);
  }, [result]);
  const badgeLeft = badge ? Math.max(0, Math.ceil((badge.until - now.getTime()) / 1000)) : 0;
  useEffect(() => { if (badge && badgeLeft <= 0) setBadge(null); }, [badge, badgeLeft]);

  // One input that keeps the focus — the scanner types into it.
  // `force` after the station's own buttons: the focus goes back to the input.
  const refocus = useCallback((force = false) => {
    setTimeout(() => {
      const el = document.activeElement;
      if (!force && el && el !== document.body && el !== inputRef.current && el.closest?.('.ss-keep-focus')) return;
      inputRef.current?.focus();
    }, 30);
  }, []);
  useEffect(() => { refocus(); }, [refocus, result]);

  const submit = async e => {
    e.preventDefault();
    const code = value.trim();
    setValue('');
    if (!code || busyRef.current) return;
    busyRef.current = true;
    try {
      const pending = badge && badgeLeft > 0 ? badge : null;
      const r = await api.post('/job-tasks/scan', { code, ...(pending ? { badge: pending.code } : {}) });
      if (r.success && r.action === 'badge') {
        setBadge({ code: r.badge, technician: r.technician, tasks: r.tasks || [], until: Date.now() + BADGE_SECONDS * 1000 });
        setResult(null);
        beep('badge');
      } else if (r.success) {
        setBadge(null);
        setResult({ tone: r.action === 'ended' ? 'ended' : 'started', ...r });
        beep(r.action === 'ended' ? 'end' : 'start');
        loadStation();
      } else {
        const warn = r.code === 'JUST_SCANNED';
        if (['NOT_YOUR_JOB', 'BADGE_UNKNOWN'].includes(r.code)) setBadge(null);
        setResult({ tone: warn ? 'warn' : 'error', ...r });
        beep(warn ? 'warn' : 'error');
      }
    } catch {
      setResult({ tone: 'error', message: t('scanStation.network', 'No connection — the scan was not recorded. Scan again.') });
      beep('error');
    } finally {
      busyRef.current = false;
      refocus();
    }
  };

  const fullScreen = () => {
    const el = stationRef.current;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el?.requestFullscreen?.().catch(() => {});
    refocus(true);
  };

  const toggleBadge = async () => {
    const r = await api.put('/job-tasks/station', { badge_required: !settings.badge_required });
    if (r.success) setSettings(s => ({ ...s, badge_required: !!r.data?.badge_required }));
    refocus(true);
  };

  if (!allowed) {
    return (
      <div className="ss-blocked">
        <Lock width={28} height={28} />
        <h2>{t('scanStation.not_allowed_title', 'The scan station is for the floor')}</h2>
        <p>{t('scanStation.not_allowed', 'Sign the station PC in as a Team Leader, Supervisor or Workshop Foreman.')}</p>
      </div>
    );
  }

  const job = result?.job;
  const prompt = badge
    ? t('scanStation.prompt_job_for', '{{name}}, now scan your job', { name: badge.technician.full_name })
    : settings.badge_required
      ? t('scanStation.prompt_badge', 'Scan your badge, then the job on your job card')
      : t('scanStation.prompt', 'Scan the job barcode on your job card');

  return (
    <div className="ss" ref={stationRef} onClick={() => refocus()}>
      <header className="ss-top">
        <div className="ss-brand"><ScanBarcode width={26} height={26} /> {t('scanStation.title', 'Scan station')}</div>
        <div className="ss-clock"><Clock width={20} height={20} /> {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="ss-top-actions ss-keep-focus">
          {settings.can_configure && (
            <label className="ss-toggle">
              <input type="checkbox" checked={!!settings.badge_required} onChange={toggleBadge} />
              {t('scanStation.badge_required', 'Badge first')}
            </label>
          )}
          <button type="button" className="ss-icon-btn" onClick={fullScreen} title={t('scanStation.full_screen', 'Full screen')}><Expand width={18} height={18} /></button>
        </div>
      </header>

      <form className="ss-scan" onSubmit={submit}>
        <div className="ss-prompt">{prompt}{badge && <span className="ss-countdown">{badgeLeft}s</span>}</div>
        <input ref={inputRef} className="ss-input" value={value} onChange={e => setValue(e.target.value)} onBlur={() => refocus()}
          autoFocus autoComplete="off" autoCorrect="off" spellCheck={false} inputMode="numeric"
          placeholder={t('scanStation.placeholder', 'Scan — or type the code and press Enter')} aria-label={t('scanStation.input', 'Scanned code')} />
      </form>

      {badge && !result && (
        <div className="ss-result tone-badge">
          <div className="ss-result-head"><User width={34} height={34} /> {t('scanStation.hello', 'Hello, {{name}}', { name: badge.technician.full_name })}</div>
          {badge.tasks.length > 0 ? (
            <ul className="ss-mine">
              {badge.tasks.map(x => (
                <li key={x.id}><b>{x.job_name}</b> · {x.job_card_number} <span className={`ss-chip st-${x.status}`}>{t(`scanStation.st.${x.status}`, { open: 'Not started', in_progress: 'Running', paused: 'Paused' }[x.status] || x.status)}</span></li>
              ))}
            </ul>
          ) : <div className="ss-result-sub">{t('scanStation.no_jobs', 'No jobs assigned to you right now.')}</div>}
        </div>
      )}

      {result && (
        <div className={`ss-result tone-${result.tone}`} role="status" aria-live="assertive">
          <div className="ss-result-head">
            {result.tone === 'started' && <><Play width={40} height={40} /> {result.rework ? t('scanStation.rework', 'REWORK STARTED') : t('scanStation.started', 'STARTED')}</>}
            {result.tone === 'ended' && <><Check width={40} height={40} /> {t('scanStation.ended', 'FINISHED')}</>}
            {(result.tone === 'error' || result.tone === 'warn') && <><WarningTriangle width={40} height={40} /> {result.tone === 'warn' ? t('scanStation.already', 'ALREADY RECORDED') : t('scanStation.not_recorded', 'NOT RECORDED')}</>}
          </div>
          {job && <div className="ss-job">{job.job_name}{job.service_type_label ? <span className="ss-type">{t(`jobTasks.type.${job.service_type}`, job.service_type_label)}</span> : null}</div>}
          {job && (
            <div className="ss-result-sub">
              {job.mechanic_name && <span><User width={18} height={18} /> {job.mechanic_name}</span>}
              <span>{[job.work_order_number, job.plate, job.vehicle].filter(Boolean).join(' · ')}</span>
              {result.at && <span>{t('scanStation.at', 'at {{time}}', { time: hhmm(result.at) })}</span>}
            </div>
          )}
          {result.tone === 'ended' && result.minutes != null && (
            <div className="ss-result-line">{t('scanStation.time_on_job', 'Time on this job: {{t}}', { t: fmtMin(result.minutes) })}</div>
          )}
          {result.paused?.length > 0 && (
            <div className="ss-result-line">{t('scanStation.paused_other', 'Paused: {{jobs}}', { jobs: result.paused.map(p => p.job_name || p.job_card_number).join(', ') })}</div>
          )}
          {result.job_card_done && (
            <div className="ss-result-line">{t('scanStation.card_done', 'Every job on {{jc}} is finished — it goes to the quality check.', { jc: job?.job_card_number || '' })}</div>
          )}
          {(result.tone === 'error' || result.tone === 'warn') && <div className="ss-result-msg">{result.message}</div>}
        </div>
      )}

      {!result && !badge && (
        <div className="ss-idle"><ScanBarcode width={90} height={90} /></div>
      )}

      <section className="ss-recent">
        <div className="ss-recent-title">{t('scanStation.recent', 'Today at the station')}</div>
        {!settings.recent?.length ? <div className="ss-muted">{t('scanStation.recent_none', 'No scans yet today.')}</div> : (
          <ul>
            {settings.recent.map(e => (
              <li key={`${e.id}-${e.action}`}>
                <span className="ss-recent-time">{hhmm(e.at)}</span>
                <span className={`ss-chip ac-${e.action}`}>{t(`scanStation.ac.${e.action}`, { started: 'Started', ended: 'Finished', paused: 'Paused' }[e.action] || e.action)}</span>
                <span className="ss-recent-what"><b>{e.job_name}</b> · {e.mechanic_name} · {e.work_order_number}{e.plate ? ` · ${e.plate}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
