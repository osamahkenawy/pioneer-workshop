/**
 * JobTasksPanel — the jobs on the job card, each with its own technician
 * (client meeting, 3 Nov 2026, points 14, 16, 17). Shown in Step 6 of
 * JobCardWorkflow.
 *
 * Everything comes from GET /api/job-tasks?work_order_id= (backend
 * lib/job-tasks.js): one row per approved job / service, kept in step with
 * the approved work, with its technician, status and times. The technician
 * scans the job's barcode on the printed job card at the scan station to
 * start and end it; the Team Leader / Supervisor / Foreman (job.assign)
 * assigns each job here — only technicians qualified for its service type
 * are offered; a manager may assign someone else with a reason.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, User, WarningTriangle, Undo, Refresh } from 'iconoir-react';
import api from '../../lib/api';
import './JobTasksPanel.css';

const hhmm = s => (s ? String(s).replace('T', ' ').slice(11, 16) : '');
const fmtMin = m => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`; };
const STATUS_TONE = { open: 'neutral', in_progress: 'info', paused: 'warn', done: 'good', cancelled: 'neutral' };

export default function JobTasksPanel({ workOrderId, closed = false }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState(null); // { tone, text }
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/job-tasks?work_order_id=${workOrderId}`);
      if (r.success) { setData(r.data); setError(''); }
      else setError(r.message || t('jobTasks.load_failed', 'Could not load the jobs.'));
    } catch {
      setError(t('jobTasks.network', 'Network error — check the connection.'));
    }
  }, [workOrderId, t]);
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

  const act = async (key, fn, okText) => {
    setBusy(key); setNote(null);
    try {
      const r = await fn();
      if (r?.success) { setNote({ tone: 'good', text: okText || r.message }); await load(); }
      else setNote({ tone: 'bad', text: r?.message || t('jobTasks.failed', 'That did not work.') });
      return r;
    } catch {
      setNote({ tone: 'bad', text: t('jobTasks.network', 'Network error — check the connection.') });
      return null;
    } finally { setBusy(''); }
  };

  const assign = async (task, mechanicId, qualified) => {
    let body = { mechanic_id: Number(mechanicId) };
    if (!qualified) {
      const reason = window.prompt(t('jobTasks.override_prompt',
        'This technician is not qualified for {{type}}. Assign anyway? Give the reason (recorded on the job):', { type: task.service_type_label || '' }));
      if (!reason || reason.trim().length < 3) return;
      body = { ...body, override: true, reason: reason.trim() };
    }
    await act(`assign${task.id}`, () => api.patch(`/job-tasks/${task.id}/technician`, body));
  };

  const printSheet = async () => {
    setBusy('print');
    try {
      const r = await api.raw(`/job-tasks/work-orders/${workOrderId}/sheet`);
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setNote({ tone: 'bad', text: t('jobTasks.print_failed', 'Could not print the job card.') });
    } finally { setBusy(''); }
  };

  const tasks = data?.tasks || [];
  const live = tasks.filter(x => x.status !== 'cancelled');
  const cards = new Set(live.map(x => x.job_card_id));
  if (!data && !error) return <div className="jt"><div className="wf-muted sm">{t('jobTasks.loading', 'Loading the jobs…')}</div></div>;

  return (
    <section className="jt">
      <header className="jt-head">
        <div>
          <div className="jt-title">{t('jobTasks.title', 'Jobs and technicians')}</div>
          <div className="wf-muted sm">{t('jobTasks.subtitle', 'Each job has its own technician and barcode. The technician scans it at the scan station to start and to finish.')}</div>
        </div>
        <div className="wf-row tight">
          <button className="wf-icon-btn" title={t('jobTasks.refresh', 'Refresh')} onClick={load}><Refresh width={15} height={15} /></button>
          {live.length > 0 && (
            <button className="wf-btn ghost sm" disabled={busy === 'print'} onClick={printSheet}>
              <Printer width={14} height={14} /> {t('jobTasks.print', 'Print job card with barcodes')}
            </button>
          )}
        </div>
      </header>

      {error && <p className="wf-bad"><WarningTriangle width={14} height={14} /> {error}</p>}
      {note && <p className={note.tone === 'good' ? 'jt-ok' : 'wf-bad'}>{note.text}</p>}
      {data && !live.length && (
        <p className="wf-note">{t('jobTasks.none', 'The jobs appear here once the customer has approved the work.')}</p>
      )}

      {live.length > 0 && (
        <ol className="jt-list">
          {tasks.map((task, i) => (
            <TaskRow key={task.id} n={i + 1} task={task} data={data} t={t} closed={closed || data.closed}
              showCard={cards.size > 1} busy={busy} onAssign={assign}
              onType={type => act(`type${task.id}`, () => api.patch(`/job-tasks/${task.id}/service-type`, { service_type: type }))}
              onReopen={() => act(`reopen${task.id}`, () => api.post(`/job-tasks/${task.id}/reopen`))} />
          ))}
        </ol>
      )}
      {data?.can_assign && data.team_only && live.length > 0 && (
        <p className="wf-muted sm">{t('jobTasks.team_only', 'You can assign the technicians on your team.')}</p>
      )}
    </section>
  );
}

function TaskRow({ n, task, data, t, closed, showCard, busy, onAssign, onType, onReopen }) {
  const [pick, setPick] = useState('');
  const cancelled = task.status === 'cancelled';
  const statusText = {
    open: t('jobTasks.status.open', 'Not started'),
    in_progress: `${t('jobTasks.status.running', 'Running since')} ${hhmm(task.running_since)}`,
    paused: t('jobTasks.status.paused', 'Paused'),
    done: t('jobTasks.status.done', 'Finished'),
    cancelled: t('jobTasks.status.cancelled', 'No longer approved'),
  }[task.status] || task.status;
  // Qualified first; the others only for a manager (override with a reason).
  const techs = data.technicians || [];
  const qualified = techs.filter(m => !task.service_type || (m.skills || []).includes(task.service_type));
  const others = data.can_override ? techs.filter(m => !qualified.includes(m) && m.id !== task.mechanic_id) : [];
  const hidden = techs.length - qualified.length;
  const canChange = data.can_assign && !closed && !cancelled && task.status !== 'done' && !task.running;
  const cardWorkable = ['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_failed'].includes(task.job_card_status);

  return (
    <li className={`jt-row${cancelled ? ' is-cancelled' : ''}`}>
      <div className="jt-n">{n}</div>
      <div className="jt-main">
        <div className="jt-job">
          <span className="jt-job-name">{task.job_name}</span>
          {task.service_type
            ? <span className="wf-pill info">{t(`jobTasks.type.${task.service_type}`, task.service_type_label)}</span>
            : canChange
              ? (
                <select className="wf-input sm" value="" onChange={e => e.target.value && onType(e.target.value)} disabled={busy === `type${task.id}`}>
                  <option value="">{t('jobTasks.set_type', 'Service type…')}</option>
                  {Object.entries(data.service_types || {}).map(([k, l]) => <option key={k} value={k}>{t(`jobTasks.type.${k}`, l)}</option>)}
                </select>
              )
              : <span className="wf-pill">{t('jobTasks.no_type', 'No service type')}</span>}
          {showCard && <span className="wf-muted sm">{task.job_card_number}{!task.is_main && task.job_card_title ? ` · ${task.job_card_title}` : ''}</span>}
        </div>

        <div className="jt-tech">
          <User width={14} height={14} />
          {task.mechanic_name
            ? <span className="jt-tech-name">{task.mechanic_name}</span>
            : <span className="wf-muted">{t('jobTasks.unassigned', 'No technician yet')}</span>}
          {task.inherited && <span className="wf-muted sm">{t('jobTasks.inherited', '(the job card\'s technician)')}</span>}
          {task.mechanic_id && task.qualified === false && (
            <span className="wf-pill warn" title={task.override_reason || ''}>
              <WarningTriangle width={11} height={11} /> {t('jobTasks.outside_skills', 'Outside their skills')}{task.override_reason ? `: ${task.override_reason}` : ''}
            </span>
          )}
          {canChange && (
            <span className="wf-row tight jt-assign">
              <select className="wf-input sm" value={pick} onChange={e => setPick(e.target.value)}>
                <option value="">{task.mechanic_id ? t('jobTasks.reassign', 'Reassign to…') : t('jobTasks.assign_to', 'Assign to…')}</option>
                {qualified.length > 0 && (
                  <optgroup label={task.service_type ? t('jobTasks.qualified_for', 'Qualified for {{type}}', { type: task.service_type_label }) : t('jobTasks.technicians', 'Technicians')}>
                    {qualified.filter(m => m.id !== task.mechanic_id || task.inherited).map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </optgroup>
                )}
                {others.length > 0 && (
                  <optgroup label={t('jobTasks.not_qualified', 'Not qualified — manager override')}>
                    {others.map(m => <option key={m.id} value={m.id}>⚠ {m.full_name}{m.skills === null ? ` (${t('jobTasks.no_skills', 'skills not recorded')})` : ''}</option>)}
                  </optgroup>
                )}
              </select>
              <button className="wf-btn primary sm" disabled={!pick || busy === `assign${task.id}`}
                onClick={() => { const q = qualified.some(m => String(m.id) === pick); onAssign(task, pick, q).then(() => setPick('')); }}>
                {t('jobTasks.assign', 'Assign')}
              </button>
            </span>
          )}
        </div>
        {canChange && !qualified.length && (
          <div className="wf-muted sm">{t('jobTasks.none_qualified', 'No technician is qualified for {{type}} yet — tick their skills on the Technicians page.', { type: task.service_type_label })}</div>
        )}
        {canChange && qualified.length > 0 && hidden > 0 && !data.can_override && (
          <div className="wf-muted sm">{t('jobTasks.hidden', '{{n}} technician(s) not qualified for this service type are not offered.', { n: hidden })}</div>
        )}
      </div>

      <div className="jt-side">
        <span className={`wf-pill ${STATUS_TONE[task.status] || 'neutral'}`}>{statusText}</span>
        <div className="wf-muted sm jt-times">
          {task.started_at && <span>{t('jobTasks.started', 'Started')} {hhmm(task.started_at)}</span>}
          {task.finished_at && <span>{t('jobTasks.finished', 'Finished')} {hhmm(task.finished_at)}</span>}
          {(task.minutes > 0 || task.started_at) && <span>{fmtMin(task.minutes)}</span>}
        </div>
        <code className="jt-code" title={t('jobTasks.code_hint', 'The code under the job\'s barcode — type it at the scan station if the paper is damaged.')}>{task.scan_code}</code>
        {data.can_assign && !closed && task.status === 'done' && cardWorkable && (
          <button className="wf-btn ghost sm" disabled={busy === `reopen${task.id}`} onClick={onReopen}
            title={t('jobTasks.reopen_hint', 'Finished by mistake? The next scan starts it again.')}>
            <Undo width={13} height={13} /> {t('jobTasks.reopen', 'Reopen')}
          </button>
        )}
      </div>
    </li>
  );
}
