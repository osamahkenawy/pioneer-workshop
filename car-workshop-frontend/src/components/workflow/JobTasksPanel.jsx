/**
 * JobTasksPanel — the jobs on the job card, each with its own technician
 * (client meeting, 3 Nov 2026, points 14, 16, 17). Shown in Step 6 of
 * JobCardWorkflow.
 *
 * Everything comes from GET /api/job-tasks?work_order_id= (backend
 * lib/job-tasks.js): one row per approved job / service, kept in step with
 * the approved work, with its technician, status and times, and the
 * technicians to offer with their availability (client feedback, 16 Nov
 * 2026, point 4). The technician scans the job's barcode on the printed job
 * card at the scan station to start and end it; the Team Leader /
 * Supervisor / Foreman (job.assign) assigns each job here with the
 * technician picker — technicians qualified for its service type first; a
 * manager may assign someone else with a reason. When the parts have not
 * been requested yet (MRN, point 18) the panel says so and offers Request
 * parts (point 5); the Team Board assigns every job of a job in one go.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, User, WarningTriangle, Undo, Refresh, Package } from 'iconoir-react';
import api from '../../lib/api';
import TechnicianPicker from './TechnicianPicker';
import RequestPartsDialog from './RequestPartsDialog';
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
  const [parts, setParts] = useState(false);

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

  const assign = (task, mechanicId, override, reason) => act(`assign${task.id}`, () => api.patch(`/job-tasks/${task.id}/technician`,
    override ? { mechanic_id: Number(mechanicId), override: true, reason } : { mechanic_id: Number(mechanicId) }));

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
  const blocked = data?.can_assign && !closed && !data?.closed ? data?.blocked : null;
  const waiting = live.filter(x => !x.mechanic_id && x.status === 'open').length;

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
      {blocked && live.length > 0 && (
        <div className="jt-blocked" role="status">
          <WarningTriangle width={15} height={15} />
          <span>{blocked.code === 'MRN_REQUIRED'
            ? t('jobTasks.blocked_mrn', 'Parts to request: the approved work has parts — request them from the Store (MRN) before anyone is assigned.')
            : blocked.message}</span>
          {blocked.code === 'MRN_REQUIRED' && data.can_request_parts && (
            <button type="button" className="wf-btn primary sm" onClick={() => setParts(true)}>
              <Package width={14} height={14} /> {t('jobTasks.request_parts', 'Request parts')}
            </button>
          )}
        </div>
      )}
      {data && !live.length && (
        <p className="wf-note">{t('jobTasks.none', 'The jobs appear here once the customer has approved the work.')}</p>
      )}
      {data?.can_assign && !blocked && waiting > 0 && live.length > 1 && !closed && (
        <p className="wf-muted sm">{waiting === 1
          ? t('jobTasks.waiting_one', '1 job is waiting for a technician.')
          : t('jobTasks.waiting_n', '{{n}} jobs are waiting for a technician.', { n: waiting })}</p>
      )}

      {live.length > 0 && (
        <ol className="jt-list">
          {tasks.map((task, i) => (
            <TaskRow key={task.id} n={i + 1} task={task} data={data} t={t} closed={closed || data.closed} blocked={!!blocked}
              showCard={cards.size > 1} busy={busy} onAssign={assign}
              onType={type => act(`type${task.id}`, () => api.patch(`/job-tasks/${task.id}/service-type`, { service_type: type }))}
              onReopen={() => act(`reopen${task.id}`, () => api.post(`/job-tasks/${task.id}/reopen`))} />
          ))}
        </ol>
      )}
      {data?.can_assign && data.team_only && live.length > 0 && (
        <p className="wf-muted sm">{t('jobTasks.team_only', 'You can assign the technicians on your team.')}</p>
      )}
      {parts && (
        <RequestPartsDialog workOrderId={workOrderId} onClose={() => setParts(false)}
          onDone={res => {
            setParts(false);
            setNote({ tone: 'good', text: t('jobTasks.parts_sent', 'Requisition {{number}} sent to the Store — the technicians can be assigned now.', { number: res.req_number }) });
            load();
          }} />
      )}
    </section>
  );
}

function TaskRow({ n, task, data, t, closed, blocked, showCard, busy, onAssign, onType, onReopen }) {
  const [pick, setPick] = useState(null); // { id, qualified, tech }
  const [reason, setReason] = useState('');
  const cancelled = task.status === 'cancelled';
  const statusText = {
    open: t('jobTasks.status.open', 'Not started'),
    in_progress: `${t('jobTasks.status.running', 'Running since')} ${hhmm(task.running_since)}`,
    paused: t('jobTasks.status.paused', 'Paused'),
    done: t('jobTasks.status.done', 'Finished'),
    cancelled: t('jobTasks.status.cancelled', 'No longer approved'),
  }[task.status] || task.status;
  const techs = data.technicians || [];
  const types = task.service_type ? [task.service_type] : [];
  const qualifiedCount = techs.filter(m => !task.service_type || (m.skills || []).includes(task.service_type)).length;
  const canChange = data.can_assign && !closed && !cancelled && task.status !== 'done' && !task.running;
  const cardWorkable = ['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_failed'].includes(task.job_card_status);
  const changed = pick && (Number(pick.id) !== Number(task.mechanic_id) || task.inherited);
  const needReason = changed && !pick.qualified;
  const saving = busy === `assign${task.id}`;
  const submit = async () => {
    if (!changed || (needReason && reason.trim().length < 3)) return;
    const r = await onAssign(task, pick.id, !pick.qualified, reason.trim());
    if (r?.success) { setPick(null); setReason(''); }
  };
  // Client feedback (18 Nov 2026), point 8: record the job's service type as
  // the technician's skill (the user-to-skill mapping), then assign — no reason.
  const [learnErr, setLearnErr] = useState('');
  const learnAndAssign = async () => {
    if (!changed || !task.service_type) return;
    setLearnErr('');
    const tech = pick.tech || techs.find(m => Number(m.id) === Number(pick.id));
    const skills = [...new Set([...(tech?.skills || []), task.service_type])];
    const s = await api.patch(`/mechanics/${pick.id}/skills`, { skills }).catch(() => null);
    if (!s?.success) { setLearnErr(s?.message || t('jobTasks.skills_failed', 'Could not record the skill.')); return; }
    const r = await onAssign(task, pick.id, false, '');
    if (r?.success) { setPick(null); setReason(''); }
  };
  const pickName = (pick?.tech?.full_name || techs.find(m => Number(m.id) === Number(pick?.id))?.full_name || '').split(' ')[0];

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
        </div>
        {canChange && (
          <div className="jt-pick">
            <TechnicianPicker technicians={techs} value={pick?.id ?? null} currentId={task.mechanic_id}
              serviceTypes={types} serviceLabels={data.service_types} canOverride={data.can_override} canLearn
              preferTeamId={data.prefer_team_leader_id} disabled={blocked || saving}
              label={t('jobTasks.pick_label', 'Technician for {{job}}', { job: task.job_name })}
              placeholder={task.mechanic_id ? t('jobTasks.reassign', 'Reassign to…') : t('jobTasks.assign_to', 'Assign to…')}
              onChange={(id, info) => { setPick({ id, qualified: info.qualified, tech: info.tech }); setReason(''); }} />
            {changed && needReason && task.service_type && (
              <div className="jt-confirm">
                <button type="button" className="wf-btn primary sm" disabled={saving} onClick={learnAndAssign}>
                  {t('jobTasks.learn_assign', 'Add {{type}} to {{name}}\'s skills & assign', { type: task.service_type_label || task.service_type, name: pickName || t('jobTasks.tech', 'the technician') })}
                </button>
                {!data.can_override && (
                  <button type="button" className="wf-btn ghost sm" disabled={saving} onClick={() => { setPick(null); setReason(''); setLearnErr(''); }}>
                    {t('jobTasks.cancel', 'Cancel')}
                  </button>
                )}
                {learnErr && <span className="wf-bad sm" role="alert">{learnErr}</span>}
              </div>
            )}
            {changed && (!needReason || data.can_override || !task.service_type) && (
              <div className="jt-confirm">
                {needReason && (
                  <input className="wf-input sm jt-reason" value={reason} maxLength={255} autoFocus
                    onChange={e => setReason(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                    placeholder={t('jobTasks.override_reason', 'Why outside their skills? (recorded on the job)')}
                    aria-label={t('jobTasks.override_reason', 'Why outside their skills? (recorded on the job)')} />
                )}
                <button type="button" className="wf-btn primary sm" disabled={saving || (needReason && reason.trim().length < 3)} onClick={submit}>
                  {needReason ? t('jobTasks.assign_override_once', 'Just this once, with a reason') : t('jobTasks.assign', 'Assign')}
                </button>
                <button type="button" className="wf-btn ghost sm" disabled={saving} onClick={() => { setPick(null); setReason(''); }}>
                  {t('jobTasks.cancel', 'Cancel')}
                </button>
              </div>
            )}
          </div>
        )}
        {canChange && !blocked && task.service_type && !qualifiedCount && techs.length > 0 && (
          <div className="wf-muted sm">{t('jobTasks.none_qualified_learn', 'No technician has {{type}} on file yet — pick one and their skill is recorded as you assign (or tick skills for everyone on Technicians → Skills).', { type: task.service_type_label })}</div>
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
