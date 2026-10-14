/**
 * JobCardWorkflow — the workshop workflow, Steps 1–7, on the job card screen
 * (Pioneer_Complete_Workshop_Workflow_Steps_1_to_7.pdf).
 *
 * Where the job stands (stepper), what has to happen next and whose job it is
 * (banner), and the actions for each step. Everything comes from
 * GET /api/workflow/work-orders/:id (backend lib/workflow.js); the actions call
 * the workflow, job card, estimate and invoice routes and then reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Check, Xmark, User, Car, Page, Search, Wrench, ShieldCheck, Key, Phone, Mail, Plus,
  Play, Pause, Square, Box3dPoint, Clock, WarningTriangle, Printer, NavArrowRight, Refresh, Calendar,
} from 'iconoir-react';
import api from '../../lib/api';
import { fmtCurrency } from '../../utils/currency';
import { jcLabel, timeStateLabel } from '../../lib/statusLabels';
import { buildStatusMessage } from '../../lib/whatsapp';
import { customerStatusUrl } from '../../lib/customerLink';
import { hasModule } from '../../lib/modules';
import './JobCardWorkflow.css';

const STEP_ICONS = { classification: User, intake: Car, job_card: Page, inspection_pricing: Search, estimate: Mail, work: Wrench, closure: ShieldCheck };
const DEPARTMENTS = [
  ['mechanical', 'Mechanical'], ['body_paint', 'Body & paint'], ['electrical', 'Electrical'], ['tyres', 'Tyres'], ['other', 'Other'],
];
// Job card status → pill colour. The words are the shared job card labels
// (lib/statusLabels.js jcLabel), the same ones the technician sees.
const JC_TONE = {
  open: 'neutral', parts_requested: 'warn', parts_issued: 'info', in_progress: 'info', qc_pending: 'warn',
  qc_passed: 'good', qc_failed: 'bad', ready_for_billing: 'good', billed: 'good', cancelled: 'neutral',
};
const jcPill = (t, status) => [jcLabel(t, status), JC_TONE[status] || 'neutral'];
const SUBCATS = { internal: [['fleet', 'Fleet'], ['insurance', 'Insurance'], ['asset', 'Asset']], external: [['fleet', 'Fleet'], ['insurance', 'Insurance'], ['walkin', 'Walk-in']] };

// What the viewer may do comes from the server (lib/roles.js capabilities),
// so the screen and the API agree — including roles changed in Settings.
function rolesFrom(capabilities = []) {
  const can = c => capabilities.includes(c);
  return {
    can,
    open: can('job.open'), estimate: can('estimate.raise'), approval: can('customer.approval'),
    leader: can('job.assign'), time: can('time.book'), parts: can('parts.request'),
    store: can('store.issue'), qc: can('qc.perform'), handover: can('delivery.handover'),
  };
}
/** The capability the "next" action needs (to mark it "your turn"). */
const NEXT_CAP = {
  classify: 'job.open', intake: 'job.open', intake_missing: 'job.open', open_job_card: 'job.open', counter_needs_estimate: 'estimate.raise', create_estimate: 'estimate.raise', create_estimate_from_inspection: 'estimate.raise', price_labour: 'estimate.raise',
  send_estimate: 'estimate.raise', price_parts: 'estimate.price_parts', approve_estimate: 'estimate.approve', record_approval: 'customer.approval',
  assign: 'job.assign', parts_waiting: 'store.issue', work: 'time.book', qc_failed: 'job.assign', qc: 'qc.perform',
  contact: 'delivery.handover', payment: 'delivery.handover', gate_pass: 'delivery.handover', close: 'delivery.handover', rejected_all: 'customer.approval',
};

// Reclassifying an account (the class, or a subcategory already set) is the
// Workshop Manager's call (backend customers.js); job.open may only fill in a
// missing external subcategory.
const MANAGER_ROLES = ['admin', 'super_admin', 'general_manager', 'workshop_manager'];
const isManager = u => !!u && (u.is_owner === true || Number(u.is_owner) === 1
  || MANAGER_ROLES.includes(u.role) || MANAGER_ROLES.includes(u.role_slug));

/** Odometer as typed → digits only (Arabic-Indic digits converted; spaces and
 *  thousands commas dropped). Anything else ('12.5', '1e5', '-500') is kept so
 *  the check below refuses it instead of silently turning it into another number. */
const normKm = v => String(v ?? '')
  .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x660))
  .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x6F0))
  .replace(/[\s,]/g, '');
const normVin = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const fmtMin = m => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`; };
const hhmm = s => (s ? String(s).replace('T', ' ').slice(11, 16) : '');
const dateOnly = s => (s ? String(s).slice(0, 10) : '');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function JobCardWorkflow({ workOrderId, user, currency = 'AED', mechanics = [], workshopName, onChanged, version }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [capsState, setCapsState] = useState([]);
  const roles = useMemo(() => rolesFrom(capsState), [capsState]);
  const money = v => fmtCurrency(v, currency);
  // Server strings come with an i18n key + params; English is the fallback.
  const tx = (i18n, fallback) => {
    if (!i18n?.key) return fallback;
    // "Internal · Fleet": both halves translated separately
    if (i18n.key.startsWith('sum.class_') && i18n.params?.sub) {
      return `${t(`workflow.val.${i18n.key.slice(4)}`)} · ${t(`workflow.val.sub_${i18n.params.sub}`)}`;
    }
    return t(`workflow.${i18n.key}`, { defaultValue: fallback, ...(i18n.params || {}) });
  };

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null); // { type, ... }
  const loadedAt = useRef(Date.now());
  const [, setTick] = useState(0);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const r = await api.get(`/workflow/work-orders/${workOrderId}`);
      if (r.success) { setData(r.data); setCapsState(r.data?.you?.capabilities || []); setLoadError(''); loadedAt.current = Date.now(); }
      else setLoadError(r.message || t('workflow.load_failed', 'Could not load the workflow.'));
    } catch {
      setLoadError(t('workflow.network', 'Network error — check the connection.'));
    } finally { setLoading(false); }
  }, [workOrderId, t]);

  useEffect(() => { load(); }, [load]);
  // The rest of the job card page changed the work order (status, technician…)
  useEffect(() => { if (version !== undefined) load(true); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const i = setInterval(() => load(true), 30000); return () => clearInterval(i); }, [load]);
  // live timers tick between reloads
  const running = data?.job_cards?.some(c => c.time?.state === 'running');
  useEffect(() => { if (!running) return; const i = setInterval(() => setTick(x => x + 1), 15000); return () => clearInterval(i); }, [running]);
  useEffect(() => { if (data && selected == null) setSelected(data.current_step || 7); }, [data, selected]);
  // On a phone the stepper scrolls sideways: keep the selected step in view.
  const stepperRef = useRef(null);
  useEffect(() => {
    const el = stepperRef.current?.querySelector('.is-selected');
    const box = stepperRef.current;
    if (el && box && box.scrollWidth > box.clientWidth) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [selected, data?.current_step]);
  useEffect(() => { if (!toast) return; const i = setTimeout(() => setToast(null), 4500); return () => clearTimeout(i); }, [toast]);

  // "Go" on the next-step bar: bring the step's panel into view and point at
  // its main button (the panel may already be the one showing).
  const panelRef = useRef(null);
  const [cue, setCue] = useState(0);
  useEffect(() => {
    if (!cue) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let timer;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      panel.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      const btn = panel.querySelector('.wf-btn.primary:not(:disabled)');
      if (!btn) return;
      btn.focus({ preventScroll: true });
      btn.classList.add('wf-cue');
      timer = setTimeout(() => btn.classList.remove('wf-cue'), 1800);
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [cue]);

  /** Run an action, show its message, reload. */
  const act = async (key, fn, okMsg) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && r.success === false) { setToast({ kind: 'bad', text: r.message || t('workflow.failed', 'That did not work.') }); return r; }
      setToast({ kind: 'good', text: okMsg || r?.message || t('workflow.done', 'Done') });
      await load(true);
      onChanged?.();
      return r;
    } catch {
      setToast({ kind: 'bad', text: t('workflow.network', 'Network error — check the connection.') });
      return null;
    } finally { setBusy(''); }
  };

  if (loading && !data) return <section className="wf"><div className="wf-skel" /></section>;
  if (!data) return (
    <section className="wf wf-error">
      <WarningTriangle width={18} height={18} /> {loadError}
      <button className="wf-btn ghost sm" onClick={() => load()}><Refresh width={14} height={14} /> {t('common.retry', 'Try again')}</button>
    </section>
  );

  const wo = data.work_order;
  if (data.legacy) {
    const when = String(wo.completed_at || wo.cancelled_at || '').slice(0, 10);
    return (
      <section className="wf wf-legacy" aria-label={t('workflow.title', 'Workshop workflow')}>
        <div className="wf-eyebrow">{t('workflow.eyebrow', 'Workshop workflow · Steps 1–7')}</div>
        <p className="wf-note">
          {wo.status === 'cancelled'
            ? t('workflow.legacy_cancelled', 'Imported from the previous system and cancelled there{{when}}. The Steps 1–7 workflow applies to job cards opened in this system.', { when: when ? ` (${when})` : '' })
            : t('workflow.legacy_completed', 'Imported from the previous system and completed there{{when}}. The Steps 1–7 workflow applies to job cards opened in this system.', { when: when ? ` (${when})` : '' })}
        </p>
      </section>
    );
  }
  const steps = data.steps;
  const doneCount = steps.filter(s => s.state === 'done').length;
  const step = steps.find(s => s.n === selected) || steps[0];
  const elapsed = Math.floor((Date.now() - loadedAt.current) / 60000);
  const closed = wo.status === 'completed' || wo.status === 'cancelled';

  /** The next-step bar's Go: open the page the step needs, or point at it here. */
  const goNext = () => {
    const action = data.next?.action;
    if (action === 'create_estimate' && roles.estimate) {
      const intake = data.inspections.find(i => i.inspection_type === 'intake');
      if (intake?.status !== 'completed') { navigate(`/work-orders/${wo.id}/inspection?type=intake`); return; }
      if (!data.estimate) { navigate(`/estimates?new=1&wo=${wo.id}`); return; }
    }
    if (action === 'open_estimate' && data.estimate?.id && hasModule(user, 'estimates')) {
      navigate(`/estimates?id=${data.estimate.id}`);
      return;
    }
    setSelected(actionStep(action, data.current_step));
    setCue(c => c + 1);
  };

  return (
    <section className="wf" aria-label={t('workflow.title', 'Workshop workflow')}>
      <header className="wf-head">
        <div>
          <div className="wf-eyebrow">{t('workflow.eyebrow', 'Workshop workflow · Steps 1–7')}</div>
          <h3 className="wf-title">
            {wo.status === 'cancelled' ? t('workflow.cancelled', 'Job closed — no work carried out')
              : wo.status === 'completed' ? t('workflow.closed', 'Job closed')
              : data.current_step ? `${t('workflow.step', 'Step')} ${data.current_step} · ${t(`workflow.steps.${steps[data.current_step - 1].key}`, steps[data.current_step - 1].title)}` : ''}
          </h3>
        </div>
        <div className="wf-meter" title={`${doneCount}/7`}>
          <div className="wf-meter-bar"><span style={{ width: `${(doneCount / 7) * 100}%` }} /></div>
          <span className="wf-meter-txt">{doneCount}/7</span>
          <button className="wf-icon-btn" onClick={() => load()} aria-label={t('workflow.refresh', 'Refresh')}><Refresh width={15} height={15} /></button>
        </div>
      </header>

      <ol className="wf-stepper" ref={stepperRef}>
        {steps.map(s => {
          const Icon = STEP_ICONS[s.key] || Page;
          return (
            <li key={s.n} className={`wf-step is-${s.state}${selected === s.n ? ' is-selected' : ''}`}>
              <button onClick={() => setSelected(s.n)} aria-current={s.state === 'current' ? 'step' : undefined}>
                <span className="wf-dot">{s.state === 'done' ? <Check width={16} height={16} strokeWidth={2.4} /> : s.state === 'stopped' ? <Xmark width={15} height={15} /> : <Icon width={15} height={15} />}</span>
                <span className="wf-step-n">{s.n}</span>
                <span className="wf-step-title">{t(`workflow.steps.${s.key}`, s.title)}</span>
                <span className="wf-step-sum">{tx(s.summary_i18n, s.summary)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {data.next && !closed && (
        <div className={`wf-next${roles.can(NEXT_CAP[data.next.key]) ? ' is-mine' : ''}`}>
          {roles.can(NEXT_CAP[data.next.key]) && <div className="wf-next-mine">{t('workflow.your_turn', 'Your turn')}</div>}
          <div className="wf-next-who">{data.next.who_key ? t(`workflow.who.${data.next.who_key}`, data.next.who) : '—'}</div>
          <div className="wf-next-text">{t(`workflow.next.${data.next.key}`, { defaultValue: data.next.text, ...(data.next.params || {}) })}</div>
          {data.next.action && (
            <button className="wf-btn primary" onClick={goNext}>
              {t('workflow.go', 'Go')} <NavArrowRight width={15} height={15} />
            </button>
          )}
        </div>
      )}

      <div className="wf-panel" key={step.n} ref={panelRef}>
        <div className="wf-panel-head">
          <span className={`wf-chip is-${step.state}`}>{stateLabel(step.state, t)}</span>
          <h4>{step.n}. {t(`workflow.steps.${step.key}`, step.title)}</h4>
        </div>
        <ul className="wf-checks">
          {step.checks.map(c => (
            <li key={c.key || c.label} className={c.done ? 'ok' : ''}>
              <span className="wf-check-ico">{c.done ? <Check width={13} height={13} strokeWidth={2.6} /> : null}</span>
              <span className="wf-check-label">{t(`workflow.chk.${c.key}`, c.label)}</span>
              {c.detail && <span className="wf-check-detail">{tx(c.detail_i18n, c.detail)}</span>}
            </li>
          ))}
        </ul>

        {step.key === 'classification' && <ClassifyBody data={data} t={t} closed={closed} mayOpen={roles.open} manager={isManager(user)}
          openClassify={() => setModal({ type: 'classify' })} onEditWizard={() => navigate(`/work-orders?edit=${wo.id}`)} />}
        {step.key === 'intake' && <IntakeBody data={data} t={t} tx={tx} closed={closed} mayFix={roles.open}
          onEditWizard={() => navigate(`/work-orders?edit=${wo.id}`)}
          onSaved={(msg, partial) => { if (!partial) setToast({ kind: 'good', text: msg }); load(true); onChanged?.(); }} />}
        {step.key === 'job_card' && (
          <JobCardList data={data} t={t} compact>
            {!data.job_cards.length && !closed && roles.open && (
              <button className="wf-btn primary" disabled={busy === 'open'} onClick={() => act('open', () => api.post(`/workflow/work-orders/${wo.id}/job-card`), t('workflow.jc_opened', 'Main job card opened'))}>
                <Plus width={15} height={15} /> {t('workflow.open_jc', 'Open the main job card')}
              </button>
            )}
          </JobCardList>
        )}
        {(step.key === 'inspection_pricing' || step.key === 'estimate') && (
          <EstimateBody data={data} t={t} money={money} closed={closed} step={step.key} canRaise={roles.estimate}
            canOpen={hasModule(user, 'estimates')}
            onInspect={() => navigate(`/work-orders/${wo.id}/inspection?type=intake`)}
            onNew={() => navigate(`/estimates?new=1&wo=${wo.id}`)}
            onOpen={id => navigate(`/estimates?id=${id}`)} />
        )}
        {step.key === 'work' && (
          <WorkBody data={data} t={t} money={money} roles={roles} busy={busy} act={act} elapsed={elapsed} closed={closed}
            mechanics={mechanics} openModal={setModal} />
        )}
        {step.key === 'closure' && (
          <ClosureBody data={data} t={t} money={money} currency={currency} workshopName={workshopName} roles={roles} busy={busy} act={act} closed={closed} openModal={setModal} />
        )}
      </div>

      {toast && <div className={`wf-toast ${toast.kind}`} role="status">{toast.text}</div>}

      {modal?.type === 'classify' && <ClassifyModal t={t} wo={wo} manager={isManager(user)} onClose={() => setModal(null)}
        onSave={(cls, sub) => act('classify', () => api.put(`/customers/${wo.customer_id}`,
          // A non-manager only fills in the missing subcategory (the class stays as it is).
          isManager(user) ? { customer_class: cls, customer_subcategory: sub } : { customer_subcategory: sub }),
          t('workflow.classified', 'Customer classified')).then(r => r?.success !== false && setModal(null))} />}
      {modal?.type === 'sub' && <SubJobCardModal t={t} data={data} mechanics={mechanics} onClose={() => setModal(null)}
        onSave={body => act('sub', () => api.post(`/workflow/work-orders/${wo.id}/sub-job-cards`, body), t('workflow.sub_created', 'Sub-job card created')).then(r => r?.success !== false && setModal(null))} />}
      {modal?.type === 'qc' && <QcModal t={t} card={modal.card} checklist={data.qc_checklist} onClose={() => setModal(null)}
        onSave={body => act('qc', () => api.post(`/job-cards/${modal.card.id}/qc`, body)).then(r => r?.success !== false && setModal(null))} />}
      {modal?.type === 'parts' && <PartsModal t={t} card={modal.card} onClose={() => setModal(null)}
        onSave={items => act('parts', () => api.post(`/job-cards/${modal.card.id}/requisitions`, { items }), t('workflow.parts_requested', 'Requisition sent to the Store')).then(r => r?.success !== false && setModal(null))} />}
      {modal?.type === 'eta' && <EtaModal t={t} item={modal.item} onClose={() => setModal(null)}
        onSave={date => act(`eta${modal.item.id}`, () => api.patch(`/workflow/requisition-items/${modal.item.id}`, { availability: 'not_available', expected_date: date })).then(r => r?.success !== false && setModal(null))} />}
      {modal?.type === 'gatepass' && <GatePassModal t={t} data={data} onClose={() => setModal(null)}
        onSave={body => act('gp', () => api.post(`/workflow/work-orders/${wo.id}/gate-pass`, body)).then(r => r?.success !== false && setModal(null))} />}
      {modal?.type === 'contact' && <ContactModal t={t} wo={wo} channel={modal.channel} onClose={() => setModal(null)}
        onSave={body => act('contact', () => api.post(`/workflow/work-orders/${wo.id}/contacts`, body), t('workflow.contact_logged', 'Contact logged')).then(r => r?.success !== false && setModal(null))} />}
      {modal?.type === 'pay' && <PayModal t={t} invoice={data.invoice} money={money} onClose={() => setModal(null)}
        onSave={body => act('pay', () => api.post(`/invoices/${data.invoice.id}/record-payment`, body), t('workflow.paid', 'Payment recorded')).then(r => r?.success !== false && setModal(null))} />}
    </section>
  );
}

function actionStep(action, current) {
  return ({ classify: 1, edit: 2, open_job_card: 3, create_estimate: 4, price_parts: 4, open_estimate: 5, record_approval: 6, assign: 6, parts: 6, time: 6,
    qc: 7, contact: 7, invoice: 7, gate_pass: 7, close: 7 })[action] || current || 1;
}
function stateLabel(s, t) {
  return ({ done: t('workflow.state.done', 'Done'), current: t('workflow.state.current', 'Now'), upcoming: t('workflow.state.upcoming', 'Later'), stopped: t('workflow.state.stopped', 'Stopped') })[s] || s;
}

/* ── Step 1 ─────────────────────────────────────────────────────────── */
function ClassifyBody({ data, t, closed, mayOpen, manager, openClassify, onEditWizard }) {
  const wo = data.work_order;
  // An external customer with no subcategory yet: the Service Advisor completes
  // Step 1 by choosing Fleet / Insurance / Walk-in. Anything else is a
  // reclassification, which only a manager may make.
  const missingSub = wo.customer_class !== 'internal' && !wo.customer_subcategory;
  const mayClassify = manager || (mayOpen && missingSub);
  return (
    <div className="wf-body">
      <div className="wf-facts">
        <Fact label={t('workflow.customer', 'Customer')} value={wo.customer_name} />
        <Fact label={t('workflow.category', 'Main category')} value={wo.customer_class ? (wo.customer_class === 'internal' ? t('workflow.internal', 'Internal') : t('workflow.external', 'External')) : '—'} />
        <Fact label={t('workflow.subcategory', 'Subcategory')} value={wo.customer_subcategory ? t(`workflow.val.sub_${wo.customer_subcategory}`, ({ fleet: 'Fleet', insurance: 'Insurance', asset: 'Asset', walkin: 'Walk-in' })[wo.customer_subcategory]) : '—'} />
      </div>
      {wo.customer_id && !closed && mayClassify && (
        <button className="wf-btn ghost" onClick={openClassify}><User width={15} height={15} /> {wo.customer_class && wo.customer_subcategory ? t('workflow.reclassify', 'Change classification') : t('workflow.classify', 'Classify customer')}</button>
      )}
      {wo.customer_id && !closed && mayOpen && !mayClassify && (
        <p className="wf-note">{t('workflow.reclassify_manager', 'Only the Workshop Manager can change a customer\'s classification.')}</p>
      )}
      {!wo.customer_id && (
        <>
          <p className="wf-note">{t('workflow.no_customer', 'This job has no customer record to classify.')}</p>
          {!closed && mayOpen && (
            <button className="wf-btn ghost" onClick={onEditWizard}><User width={15} height={15} /> {t('workflow.attach_customer', 'Choose the customer (edit the job card)')}</button>
          )}
        </>
      )}
    </div>
  );
}

/* ── Step 2 ─────────────────────────────────────────────────────────── */
function IntakeBody({ data, t, tx, closed, mayFix, onEditWizard, onSaved }) {
  const wo = data.work_order;
  const checks = data.steps[1].checks;
  // By key, not position: the server adds checks (VIN) over time.
  const chk = k => checks.find(c => c.key === k) || null;
  const vehicleC = chk('vehicle') || {}, issueC = chk('reported_issue') || {}, odoC = chk('odometer') || {}, viaC = chk('received_via') || {}, vinC = chk('vin');

  // The job card itself: the full complaint (the step check carries a short
  // copy), the vehicle, its VIN, the odometer and updated_at for the edit —
  // from the workflow payload, or the work order where an older server
  // does not send them.
  const [fetched, setFetched] = useState(null);
  const [lastKm, setLastKm] = useState(null);
  const inPayload = 'updated_at' in wo && 'vehicle_id' in wo;
  const needKm = mayFix && !closed && !odoC.done;
  const sig = `${wo.id}|${vehicleC.detail}|${odoC.detail}|${issueC.done}|${vinC?.done}`;
  useEffect(() => {
    let live = true;
    const vehicleKm = vid => {
      // The last reading on file: shown as a hint, and a lower one is confirmed.
      if (vid && needKm) api.get(`/vehicles/${vid}`).then(v => { if (live && v?.success) setLastKm(v.data?.mileage != null ? Number(v.data.mileage) : null); }).catch(() => {});
    };
    if (inPayload) vehicleKm(wo.vehicle_id);
    else api.get(`/work-orders/${wo.id}`).then(r => {
      if (!live || !r?.success) return;
      setFetched(r.data);
      vehicleKm(r.data?.vehicle_id);
    }).catch(() => {});
    return () => { live = false; };
  }, [sig, needKm]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = inPayload ? null : fetched;
  const full = inPayload || fetched ? {
    id: wo.id, vehicle_id: src?.vehicle_id ?? wo.vehicle_id,
    vehicle_vin: src?.vehicle_vin ?? wo.vin ?? null,
    description: wo.description ?? src?.description ?? null,
    // As last loaded (the workflow reloads every 30 s and after each action).
    updated_at: wo.updated_at ?? src?.updated_at,
  } : null;

  const hasVin = vinC ? !!vinC.done : !!String(full?.vehicle_vin || '').trim();
  const missing = {
    vehicle: !vehicleC.done,
    issue: !issueC.done,
    odometer: !odoC.done,
    vin: !vehicleC.done ? false : (vinC ? !vinC.done : (full ? !hasVin : false)),
  };
  const anyMissing = Object.values(missing).some(Boolean);
  const fullText = wo.description ?? full?.description;
  const quote = fullText || issueC.detail;
  const cut = !fullText && issueC.detail && String(issueC.detail).length >= 160 && !String(issueC.detail).endsWith('…');

  return (
    <div className="wf-body">
      <div className="wf-facts">
        <Fact label={t('workflow.vehicle', 'Vehicle')} value={vehicleC.detail} />
        <Fact label={t('workflow.odometer', 'Odometer')} value={tx(odoC.detail_i18n, odoC.detail)} />
        {vehicleC.done && !vinC && full && <Fact label={t('workflow.vin', 'VIN')} value={full.vehicle_vin} />}
        <Fact label={t('workflow.channel', 'Received via')} value={viaC.detail_i18n ? t(`workflow.${viaC.detail_i18n.key}`, viaC.detail) : viaC.detail} />
      </div>
      {quote && <blockquote className="wf-quote" style={{ whiteSpace: 'pre-wrap' }}>{quote}{cut ? '…' : ''}</blockquote>}
      {anyMissing && !closed && (
        <IntakeFix t={t} wo={wo} full={full} missing={missing} lastKm={lastKm} mayFix={mayFix}
          onEditWizard={onEditWizard} onSaved={onSaved} />
      )}
    </div>
  );
}

/** Step 2 (document): the vehicle information and the reported issue. The
 *  odometer and the VIN are optional — recorded when known, never holding the
 *  step. Says what is missing and, for job.open, records it here:
 *  PUT /work-orders/:id (odometer_in, description) and PUT /vehicles/:id (vin). */
function IntakeFix({ t, wo, full, missing, lastKm, mayFix, onEditWizard, onSaved }) {
  const [odo, setOdo] = useState('');
  const [vin, setVin] = useState('');
  const [issue, setIssue] = useState('');
  const [lowOk, setLowOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const km = normKm(odo);
  const low = missing.odometer && lastKm != null && /^\d+$/.test(km) && Number(km) < lastKm;
  useEffect(() => { setLowOk(false); }, [km]);
  const names = [
    missing.vehicle && t('workflow.miss_vehicle', 'the vehicle'),
    missing.issue && t('workflow.miss_issue', 'the reported issue'),
  ].filter(Boolean);
  const optional = [
    missing.odometer && t('workflow.miss_odometer', 'the odometer reading'),
    missing.vin && t('workflow.miss_vin', 'the VIN / chassis number'),
  ].filter(Boolean);
  const canInline = mayFix && !missing.vehicle && (missing.odometer || missing.vin || missing.issue);

  // Saves whatever has been filled in; each missing item can be added on its own.
  const save = async () => {
    setErr('');
    const v = normVin(vin);
    const doIssue = missing.issue && !!issue.trim();
    const doKm = missing.odometer && !!km;
    const doVin = missing.vin && !!v;
    if (!doIssue && !doKm && !doVin) return setErr(t('workflow.err_nothing', 'Fill in what is missing, then save.'));
    if (doKm) {
      if (!/^\d{1,7}$/.test(km)) return setErr(t('workflow.err_km', 'Enter the odometer in whole kilometres, digits only.'));
      if (low && !lowOk) return setErr(t('workflow.err_km_low', 'The reading is lower than the last one recorded — tick the box to confirm it.'));
    }
    if (doVin && (v.length < 8 || v.length > 20)) return setErr(t('workflow.err_vin', 'Enter the VIN / chassis number (letters and digits, usually 17).'));
    if (!full?.id) return setErr(t('workflow.failed', 'That did not work.'));
    setBusy(true);
    try {
      if (doVin) {
        const r = await api.put(`/vehicles/${full.vehicle_id}`, { vin: v });
        if (!r?.success) { setErr(r?.message || t('workflow.failed', 'That did not work.')); return; }
        setVin('');
      }
      if (doKm || doIssue) {
        const body = { expected_updated_at: full.updated_at };
        if (doKm) body.odometer_in = Number(km);
        if (doIssue) body.description = issue.trim();
        const r = await api.put(`/work-orders/${wo.id}`, body);
        if (!r?.success) {
          const stale = r?.code === 'STALE_EDIT';
          setErr(stale
            ? t('workflow.err_stale', 'Someone else changed this job card just now. It has been reloaded — check it and save again.')
            : (r?.message || t('workflow.failed', 'That did not work.')));
          if (doVin || stale) onSaved?.(null, true); // reload what is saved
          return;
        }
        setOdo(''); setIssue('');
      }
      onSaved?.(t('workflow.intake_saved', 'Vehicle information saved'));
    } catch {
      setErr(t('workflow.network', 'Network error — check the connection.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="wf-inline-form">
      {names.length > 0
        ? <div className="wf-inline-title"><WarningTriangle width={14} height={14} /> {t('workflow.intake_missing', 'Still needed to complete Step 2: {{list}}.', { list: names.join(', ') })}</div>
        : <div className="wf-inline-title" style={{ color: '#64748b' }}>{t('workflow.intake_optional', 'Not recorded yet (optional): {{list}}.', { list: optional.join(', ') })}</div>}
      {canInline && (
        <>
          {missing.issue && (
            <label className="wf-label">{t('workflow.reported_issue', 'Reported issue')}
              <textarea className="wf-input" rows={2} maxLength={5000} value={issue} onChange={e => setIssue(e.target.value)} />
            </label>
          )}
          <div className="wf-grid2">
            {missing.odometer && (
              <label className="wf-label">{t('workflow.odometer_in', 'Odometer at arrival (km)')}
                <input className="wf-input" inputMode="numeric" dir="ltr" value={odo} onChange={e => setOdo(e.target.value)}
                  placeholder={t('workflow.odometer_ph', 'Today\'s reading')} />
                {lastKm != null && (
                  <span className={`wf-muted sm${low ? ' wf-warn' : ''}`}>
                    {low ? t('workflow.km_low', 'Lower than the last reading ({{km}} km) — check it.', { km: lastKm.toLocaleString('en-US') })
                      : t('workflow.km_last', 'Last reading: {{km}} km', { km: lastKm.toLocaleString('en-US') })}
                  </span>
                )}
              </label>
            )}
            {missing.vin && (
              <label className="wf-label">{t('workflow.vin', 'VIN / chassis number')}
                <input className="wf-input" dir="ltr" maxLength={20} value={vin} onChange={e => setVin(normVin(e.target.value))}
                  placeholder={t('workflow.vin_ph', '17 letters and digits')} style={{ fontFamily: 'ui-monospace, monospace' }} />
                {vin && normVin(vin).length !== 17 && <span className="wf-muted sm">{t('workflow.vin_17', 'A VIN is usually 17 characters — check it.')}</span>}
              </label>
            )}
          </div>
          {low && (
            <label className="wf-cb"><input type="checkbox" checked={lowOk} onChange={e => setLowOk(e.target.checked)} /> {t('workflow.km_low_ok', 'The reading is correct (e.g. the cluster was replaced)')}</label>
          )}
          {err && <p className="wf-bad">{err}</p>}
          <div className="wf-row">
            <button className="wf-btn primary" disabled={busy} onClick={save}><Check width={15} height={15} /> {t('common.save', 'Save')}</button>
          </div>
        </>
      )}
      {mayFix && missing.vehicle && (
        <button className="wf-btn ghost" onClick={onEditWizard}><Car width={15} height={15} /> {t('workflow.edit_to_add_vehicle', 'Edit the job card to add the vehicle')}</button>
      )}
      {!mayFix && <p className="wf-muted sm">{t('workflow.intake_by_sa', 'The Service Advisor records these.')}</p>}
    </div>
  );
}

/* ── Step 3 ─────────────────────────────────────────────────────────── */
function JobCardList({ data, t, children }) {
  return (
    <div className="wf-body">
      {data.job_cards.length > 0 && (
        <div className="wf-jc-mini">
          {data.job_cards.map(c => {
            const [label, tone] = jcPill(t, c.status);
            return (
              <div key={c.id} className="wf-jc-mini-row">
                <Page width={15} height={15} />
                <strong>{c.job_card_number}</strong>
                <span className="wf-muted">{c.parent_job_card_id ? `${t('workflow.sub', 'Sub-job card')}: ${c.title || ''}` : t('workflow.main', 'Main job card')}</span>
                <span className={`wf-pill ${tone}`}>{label}</span>
              </div>
            );
          })}
        </div>
      )}
      {children}
    </div>
  );
}

/* ── Steps 4–5 ──────────────────────────────────────────────────────── */
function EstimateBody({ data, t, money, closed, step, canRaise, canOpen, onInspect, onNew, onOpen }) {
  const est = data.estimate;
  const insp = data.inspections.find(i => i.inspection_type === 'intake');
  const counter = !est && data.job_cards.length && data.steps[3].done;
  return (
    <div className="wf-body">
      {step === 'inspection_pricing' && (
        <div className="wf-row">
          <button className="wf-btn ghost" onClick={onInspect}><Search width={15} height={15} /> {insp?.status === 'completed' ? t('workflow.view_inspection', 'View intake inspection') : t('workflow.do_inspection', 'Technical inspection')}</button>
          {!est && !closed && canRaise && <button className="wf-btn primary" onClick={onNew}><Plus width={15} height={15} /> {t('workflow.raise_estimate', 'Raise the estimate')}</button>}
        </div>
      )}
      {step === 'inspection_pricing' && insp?.status === 'completed' && (
        <p className="wf-note">
          {insp.signed_at
            ? t('workflow.insp_signed', 'Signed by {{name}} ({{via}})', {
              name: insp.signed_by_name || '—',
              via: insp.signed_via === 'link' ? t('workflow.insp_via_link', 'from the link')
                : insp.signed_via === 'portal' ? t('workflow.insp_via_portal', 'in the customer portal')
                : t('workflow.insp_via_on_site', 'at the car'),
            })
            : insp.shared_at
              ? t('workflow.insp_waiting_sig', 'Waiting for the customer’s signature (link sent)')
              : t('workflow.insp_not_sent', 'Not signed yet — send the customer the link')}
        </p>
      )}
      {counter ? <p className="wf-note">{t('workflow.counter_priced', 'This job card was priced at the counter when it was opened; no separate estimate.')}</p> : null}
      {est && (
        <>
          <div className="wf-est-head">
            <div>
              <strong>{est.estimate_number}</strong>
              <span className="wf-muted"> · {String(est.status).replace(/_/g, ' ')}{est.estimate_format ? ` · ${({ genuine: 'Format 1 — Genuine', after_market: 'Format 2 — After-Market', both: 'Format 3 — both' })[est.estimate_format]}` : ''}</span>
            </div>
            {/* The Estimates page is a menu module (the Team Leader's role has none) */}
            {canOpen && <button className="wf-btn ghost sm" onClick={() => onOpen(est.id)}>{t('workflow.open_estimate', 'Open estimate')} <NavArrowRight width={14} height={14} /></button>}
          </div>
          {est.pricing?.jobs?.length > 0 && (
            <div className="wf-table-wrap">
              <table className="wf-table">
                <thead>
                  <tr>
                    <th>{t('workflow.job', 'Job')}</th><th>{t('workflow.labour', 'Labour')}</th>
                    <th>{t('workflow.genuine', 'Genuine')}</th><th>{t('workflow.after_market', 'After-Market')}</th>
                    <th>{t('workflow.total_genuine', 'Total Genuine')}</th><th>{t('workflow.total_am', 'Total After-Market')}</th>
                  </tr>
                </thead>
                <tbody>
                  {est.pricing.jobs.map(j => (
                    <tr key={j.job}>
                      <td>{j.job}</td>
                      <td>{money(j.labour)}</td>
                      <td>{j.genuine_na ? <span className="wf-na">N/A</span> : money(j.genuine_parts)}</td>
                      <td>{j.after_market_na ? <span className="wf-na">N/A</span> : money(j.after_market_parts)}</td>
                      <td className="b">{money(j.total_genuine)}</td>
                      <td className="b">{money(j.total_after_market)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={4}>{t('workflow.before_vat', 'Total before VAT')}</td><td className="b">{money(est.pricing.total_genuine)}</td><td className="b">{money(est.pricing.total_after_market)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}
          {est.pricing?.unpricedParts > 0 && <p className="wf-warn"><Box3dPoint width={14} height={14} /> {t('workflow.waiting_store', '{{n}} part line(s) waiting for the Storekeeper', { n: est.pricing.unpricedParts })}</p>}
          {est.customer_notes && <p className="wf-note">{t('workflow.customer_said', 'Customer')}: {est.customer_notes}</p>}
        </>
      )}
    </div>
  );
}

/* ── Step 6 ─────────────────────────────────────────────────────────── */
function WorkBody({ data, t, money, roles, busy, act, elapsed, closed, mechanics, openModal }) {
  const wo = data.work_order;
  const [channel, setChannel] = useState('in_person');
  const [note, setNote] = useState('');
  const [tech, setTech] = useState('');
  const approved = data.steps[5].checks[0].done;
  const counter = !data.estimate;
  return (
    <div className="wf-body">
      {!approved && counter && !closed && roles.approval && (
        <div className="wf-inline-form">
          <div className="wf-inline-title">{t('workflow.record_approval', 'Record the customer\'s approval')} — {money(wo.total_amount)}</div>
          <div className="wf-row">
            <select value={channel} onChange={e => setChannel(e.target.value)} className="wf-input">
              <option value="in_person">{t('workflow.in_person', 'In person')}</option>
              <option value="phone">{t('workflow.phone', 'By phone')}</option>
              <option value="written">{t('workflow.written', 'In writing')}</option>
            </select>
            <input className="wf-input grow" placeholder={t('workflow.note_optional', 'Note (optional)')} value={note} onChange={e => setNote(e.target.value)} />
            <button className="wf-btn primary" disabled={busy === 'approve'}
              onClick={() => act('approve', () => api.patch(`/work-orders/${wo.id}/customer-approval`, { channel, note: note.trim() || undefined }), t('workflow.approval_recorded', 'Approval recorded'))}>
              <Check width={15} height={15} /> {t('workflow.record', 'Record')}
            </button>
          </div>
        </div>
      )}
      {!approved && !counter && <p className="wf-note">{t('workflow.await_customer', 'Waiting for the customer to approve or reject the estimate lines.')}</p>}

      {approved && !closed && (
        <div className="wf-assign">
          <div>
            <div className="wf-fact-label">{t('workflow.technician', 'Technician (main job card)')}</div>
            <div className="wf-fact-value">{wo.mechanic_name || <span className="wf-muted">{t('workflow.unassigned', 'Not assigned')}</span>}</div>
            {data.assignment?.assigned_by_name && <div className="wf-muted sm">{t('workflow.assigned_by', 'by')} {data.assignment.assigned_by_name}</div>}
          </div>
          {roles.leader && (
            <div className="wf-row">
              <select className="wf-input" value={tech} onChange={e => setTech(e.target.value)}>
                <option value="">{wo.mechanic_id ? t('workflow.reassign', 'Reassign to…') : t('workflow.choose_tech', 'Choose technician…')}</option>
                {mechanics.map(m => <option key={m.id} value={m.id}>{m.full_name}{m.status ? ` · ${m.status}` : ''}</option>)}
              </select>
              <button className="wf-btn primary" disabled={!tech || busy === 'assign'}
                onClick={() => act('assign', () => api.patch(`/work-orders/${wo.id}/assign-mechanic`, { mechanic_id: Number(tech) })).then(() => setTech(''))}>
                {t('workflow.assign', 'Assign')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="wf-cards">
        {data.job_cards.map(c => <JobCardCard key={c.id} card={c} t={t} roles={roles} busy={busy} act={act} elapsed={elapsed}
          closed={closed} approved={approved} mechanics={mechanics} openModal={openModal} />)}
      </div>
      {approved && !closed && data.job_cards.length > 0 && (roles.open || roles.leader) && (
        <button className="wf-btn ghost" onClick={() => openModal({ type: 'sub' })}><Plus width={15} height={15} /> {t('workflow.add_sub', 'Add a sub-job card')}</button>
      )}
    </div>
  );
}

function JobCardCard({ card, t, roles, busy, act, elapsed, closed, approved, mechanics, openModal }) {
  const [label, tone] = jcPill(t, card.status);
  const time = card.time || { minutes: 0, state: 'idle', running: [] };
  // Why the clock is paused, once the time logs carry it (WP-2 pause_reason).
  const pauseReason = time.state === 'paused' ? (card.time_logs || []).at(-1)?.pause_reason : null;
  const live = time.minutes + (time.state === 'running' ? elapsed * Math.max(1, time.running.length) : 0);
  const workable = approved && !closed && ['open', 'parts_requested', 'parts_issued', 'in_progress', 'qc_failed'].includes(card.status);
  const techId = card.mechanic_id;
  const body = techId ? { mechanic_id: techId } : {};
  const [subTech, setSubTech] = useState('');
  return (
    <article className={`wf-jc tone-${tone}`}>
      <header className="wf-jc-head">
        <div>
          <div className="wf-jc-num">{card.job_card_number}</div>
          <div className="wf-jc-title">{card.parent_job_card_id ? `${t('workflow.sub', 'Sub-job card')} · ${card.title || ''}` : t('workflow.main', 'Main job card')}
            <span className="wf-muted"> · {t(`workflow.dept.${card.department}`, (DEPARTMENTS.find(d => d[0] === card.department) || [0, card.department])[1])}</span></div>
        </div>
        <span className={`wf-pill ${tone}`}>{label}</span>
      </header>

      <div className="wf-jc-tech">
        <User width={14} height={14} /> {card.mechanic_name || <span className="wf-muted">{t('workflow.unassigned', 'Not assigned')}</span>}
        {card.parent_job_card_id && roles.leader && !closed && (
          <span className="wf-row tight">
            <select className="wf-input sm" value={subTech} onChange={e => setSubTech(e.target.value)}>
              <option value="">{t('workflow.assign_to', 'Assign to…')}</option>
              {mechanics.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
            <button className="wf-btn ghost sm" disabled={!subTech} onClick={() => act(`subtech${card.id}`, () => api.patch(`/workflow/job-cards/${card.id}/technician`, { mechanic_id: Number(subTech) })).then(() => setSubTech(''))}>{t('workflow.assign', 'Assign')}</button>
          </span>
        )}
      </div>

      {card.items?.length > 0 && (
        <ul className="wf-items">
          {card.items.map(i => <li key={i.id}><span>{i.name}</span><span className="wf-muted">× {Number(i.quantity)}</span></li>)}
        </ul>
      )}

      {card.status === 'qc_failed' && card.qc?.inspector_notes && (
        <p className="wf-bad"><WarningTriangle width={14} height={14} /> {t('workflow.rework', 'Rework')}: {card.qc.inspector_notes}</p>
      )}

      <div className="wf-time">
        <div className={`wf-clock ${time.state}`}>
          <Clock width={16} height={16} />
          <span className="wf-clock-val">{fmtMin(live)}</span>
          <span className="wf-clock-state">
            {time.state === 'running' ? `${t('workflow.running', 'Running')} · ${time.running.map(r => `${r.mechanic_name} ${t('workflow.since', 'since')} ${hhmm(r.since)}`).join(', ')}`
              : time.state === 'paused' ? (pauseReason ? timeStateLabel(t, 'paused', pauseReason) : t('workflow.paused', 'Paused')) : time.state === 'stopped' ? t('workflow.stopped', 'Stopped') : t('workflow.not_started', 'Not started')}
          </span>
        </div>
        {workable && techId && roles.time && (
          <div className="wf-time-btns">
            {time.state !== 'running'
              ? <button className="wf-btn go" disabled={busy === `start${card.id}`} onClick={() => act(`start${card.id}`, async () => {
                  // One clock per technician: when theirs runs on another job
                  // card, offer to pause that one and start here.
                  const r = await api.post(`/job-cards/${card.id}/time/start`, body);
                  if (r?.code !== 'CLOCK_RUNNING_ELSEWHERE') return r;
                  const ok = window.confirm(t('workflow.switch_confirm', 'Time is already running for this technician on {{wo}} / {{jc}}. Pause it and start here?',
                    { wo: r.running?.work_order_number || '', jc: r.running?.job_card_number || '' }));
                  return ok ? api.post(`/job-cards/${card.id}/time/start`, { ...body, pause_other: true }) : r;
                })}><Play width={15} height={15} /> {time.state === 'paused' ? t('workflow.resume', 'Resume') : t('workflow.start', 'Start')}</button>
              : <>
                  <button className="wf-btn ghost" disabled={busy === `pause${card.id}`} onClick={() => act(`pause${card.id}`, () => api.post(`/job-cards/${card.id}/time/pause`, body))}><Pause width={15} height={15} /> {t('workflow.pause', 'Pause')}</button>
                  <button className="wf-btn ghost" disabled={busy === `stop${card.id}`} onClick={() => act(`stop${card.id}`, () => api.post(`/job-cards/${card.id}/time/stop`, body))}><Square width={14} height={14} /> {t('workflow.stop', 'Stop')}</button>
                </>}
            <button className="wf-btn done" disabled={busy === `done${card.id}` || time.sessions === 0}
              title={time.sessions === 0 ? t('workflow.book_first', 'Book time first') : ''}
              onClick={() => {
                const waiting = (card.parts || []).filter(p => p.status !== 'issued').length;
                const msg = waiting
                  ? t('workflow.confirm_done_parts', '{{n}} requested part(s) not issued yet. Mark this job card done anyway and send it to the quality check?', { n: waiting })
                  : t('workflow.confirm_done', 'Mark this job card done and send it to the quality check?');
                if (window.confirm(msg)) act(`done${card.id}`, () => api.post(`/job-cards/${card.id}/done`));
              }}>
              <Check width={15} height={15} /> {t('workflow.job_done', 'Job done')}
            </button>
          </div>
        )}
        {workable && !techId && <p className="wf-note">{t('workflow.assign_first', 'Assign a technician to start time booking.')}</p>}
        {workable && techId && !roles.time && <p className="wf-note">{t('workflow.time_by_floor', 'Time is booked by the technician (or the Team Leader / Supervisor / Foreman).')}</p>}
      </div>

      <div className="wf-parts">
        <div className="wf-parts-head">
          <span><Box3dPoint width={14} height={14} /> {t('workflow.parts', 'Parts')}</span>
          {workable && roles.parts && <button className="wf-btn ghost sm" onClick={() => openModal({ type: 'parts', card })}><Plus width={13} height={13} /> {t('workflow.request_parts', 'Request parts')}</button>}
        </div>
        {!card.parts?.length ? <div className="wf-muted sm">{t('workflow.no_parts', 'No parts requested.')}</div> : (
          <ul className="wf-part-list">
            {card.parts.map(p => {
              const issued = p.status === 'issued';
              const overdue = p.availability === 'not_available' && p.expected_date && dateOnly(p.expected_date) <= todayISO();
              return (
                <li key={p.id} className={issued ? 'issued' : p.availability === 'not_available' ? (overdue ? 'overdue' : 'waiting') : 'unchecked'}>
                  <span className="wf-part-name">{Number(p.quantity_requested)} × {p.description}</span>
                  <span className="wf-part-state">
                    {issued ? t('workflow.issued', 'Issued')
                      : p.availability === 'not_available' ? `${overdue ? t('workflow.recheck', 'Re-check now') : t('workflow.expected', 'Expected')} ${dateOnly(p.expected_date)}${p.eta_alerted_at ? ' · ' + t('workflow.floor_alerted', 'floor alerted') : ''}`
                      : t('workflow.store_checking', 'Waiting for the Store')}
                  </span>
                  {roles.store && !issued && !closed && (
                    <span className="wf-row tight">
                      <button className="wf-btn go sm" disabled={busy === `issue${p.id}`} onClick={() => act(`issue${p.id}`, () => api.patch(`/workflow/requisition-items/${p.id}`, { availability: 'available' }))}>{t('workflow.on_shelf', 'On shelf — issue')}</button>
                      <button className="wf-btn ghost sm" onClick={() => openModal({ type: 'eta', item: p })}><Calendar width={13} height={13} /> {t('workflow.not_available', 'Not available')}</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}

/* ── Step 7 ─────────────────────────────────────────────────────────── */
function ClosureBody({ data, t, money, currency, workshopName, roles, busy, act, closed, openModal }) {
  const wo = data.work_order;
  const inv = data.invoice;
  const gp = data.gate_pass;
  const checks = data.steps[6].checks;
  const qcPassed = checks[0].done;
  const paid = checks[3].done;
  const released = gp?.status === 'released';
  // Step 7.2: the "ready for collection" message — the customer's stage words,
  // the amount still due (an account customer's invoice counts as settled)
  // and the link to their status page (lib/whatsapp.js).
  const due = inv && !paid ? Math.max(0, Number(inv.total_amount) - Number(inv.amount_paid || 0)) : 0;
  const waMsg = buildStatusMessage({
    t, wo: { ...wo, status: 'ready_for_pickup', main_job_card_number: data.job_cards.find(c => !c.parent_job_card_id)?.job_card_number },
    link: customerStatusUrl(wo),
    amountDue: due, currency, workshopName,
  });
  const phone = String(wo.customer_phone || '').replace(/[^\d]/g, '');

  return (
    <div className="wf-body">
      <div className="wf-sub">
        <div className="wf-sub-title"><ShieldCheck width={15} height={15} /> {t('workflow.qc_title', 'Quality check & test drive')}</div>
        <div className="wf-qc-list">
          {data.job_cards.map(c => {
            const [label, tone] = jcPill(t, c.status);
            return (
              <div key={c.id} className="wf-qc-row">
                <span><strong>{c.job_card_number}</strong> <span className="wf-muted">{c.parent_job_card_id ? c.title : t('workflow.main', 'Main job card')}</span></span>
                <span className={`wf-pill ${tone}`}>{label}</span>
                {c.status === 'qc_pending' && !closed && (roles.qc
                  ? <button className="wf-btn primary sm" onClick={() => openModal({ type: 'qc', card: c })}>{t('workflow.do_qc', 'Quality check')}</button>
                  : <span className="wf-muted sm">{t('workflow.qc_by', 'Supervisor / Foreman')}</span>)}
              </div>
            );
          })}
        </div>
      </div>

      <div className={`wf-sub ${qcPassed ? '' : 'muted'}`}>
        <div className="wf-sub-title"><Phone width={15} height={15} /> {t('workflow.pickup_title', 'Customer collection')}</div>
        {qcPassed && !closed && roles.handover && (
          <div className="wf-row">
            {/* No usable number on the job (internal accounts hold '-'): no Call /
                WhatsApp, which would log a contact that never happened. */}
            {phone.length >= 7 ? <>
              <a className="wf-btn ghost" href={`tel:+${phone}`} onClick={() => openModal({ type: 'contact', channel: 'phone' })}><Phone width={15} height={15} /> {t('workflow.call', 'Call')}</a>
              <a className="wf-btn wa" href={`https://wa.me/${phone}?text=${encodeURIComponent(waMsg)}`} target="_blank" rel="noreferrer"
                onClick={() => act('contact', () => api.post(`/workflow/work-orders/${wo.id}/contacts`, { channel: 'whatsapp', outcome: 'message_sent', note: 'Ready for collection' }), t('workflow.contact_logged', 'Contact logged'))}>WhatsApp</a>
            </> : <span className="wf-muted sm">{t('workflow.no_phone', 'No phone number on this job card.')}</span>}
            {wo.customer_email && <a className="wf-btn ghost" href={`mailto:${wo.customer_email}?subject=${encodeURIComponent(t('workflow.ready_subject', '{{plate}} — Ready for collection ({{wo}})', { plate: wo.plate_number || '', wo: wo.work_order_number }).replace(/^ — /, ''))}&body=${encodeURIComponent(waMsg)}`}
              onClick={() => act('contact', () => api.post(`/workflow/work-orders/${wo.id}/contacts`, { channel: 'email', outcome: 'message_sent' }), t('workflow.contact_logged', 'Contact logged'))}><Mail width={15} height={15} /> Email</a>}
          </div>
        )}
        {data.contacts.length > 0 && (
          <ul className="wf-log">
            {data.contacts.slice(0, 4).map(c => <li key={c.id}><span>{String(c.created_at).slice(0, 16).replace('T', ' ')}</span><span>{c.channel} · {String(c.outcome || '').replace('_', ' ')}{c.note ? ` — ${c.note}` : ''}</span><span className="wf-muted">{c.contacted_by_name}</span></li>)}
          </ul>
        )}
      </div>

      <div className={`wf-sub ${qcPassed ? '' : 'muted'}`}>
        <div className="wf-sub-title"><Page width={15} height={15} /> {t('workflow.payment_title', 'Payment & invoice')}</div>
        {inv ? (
          <div className="wf-row spread">
            <span><strong>{inv.invoice_number}</strong> <span className={`wf-pill ${paid ? 'good' : 'warn'}`}>{String(inv.status).replace(/_/g, ' ')}</span>
              <span className="wf-muted"> · {money(inv.amount_paid || 0)} / {money(inv.total_amount)}</span></span>
            {!paid && !closed && roles.handover && Number(inv.total_amount) > Number(inv.amount_paid || 0) && (
              <button className="wf-btn primary sm" onClick={() => openModal({ type: 'pay' })}>{t('workflow.take_payment', 'Take payment')}</button>
            )}
          </div>
        ) : <div className="wf-muted sm">{t('workflow.no_invoice', 'The invoice is raised automatically; it will appear here.')}</div>}
        {paid && inv?.status !== 'paid' && <div className="wf-muted sm">{t('workflow.on_account', 'Billed on account (internal / credit customer).')}</div>}
      </div>

      <div className={`wf-sub ${qcPassed && paid ? '' : 'muted'}`}>
        <div className="wf-sub-title"><Key width={15} height={15} /> {t('workflow.gatepass_title', 'Final gate pass')}</div>
        {released ? (
          <div className="wf-row spread">
            <span><strong>{gp.gate_pass_number}</strong> <span className="wf-muted">· {String(gp.released_at || '').slice(0, 16).replace('T', ' ')}</span></span>
            <button className="wf-btn ghost sm" onClick={() => printGatePass(gp, wo, t)}><Printer width={14} height={14} /> {t('workflow.print', 'Print')}</button>
          </div>
        ) : !closed && roles.handover && (
          <button className="wf-btn primary" disabled={!qcPassed || !paid} onClick={() => openModal({ type: 'gatepass' })}>
            <Key width={15} height={15} /> {t('workflow.issue_gatepass', 'Issue gate pass')}
          </button>
        )}
      </div>

      {!closed && !roles.handover && qcPassed && <p className="wf-note">{t('workflow.handover_by', 'The collection call, payment, gate pass and closing are done by the Service Advisor.')}</p>}
      {!closed && roles.handover && (
        <button className="wf-btn close" disabled={!released || busy === 'close'}
          onClick={() => window.confirm(t('workflow.confirm_close', 'Close this job? The vehicle has left with its gate pass.')) && act('close', () => api.post(`/workflow/work-orders/${wo.id}/close`), t('workflow.closed_ok', 'Job closed'))}>
          <Check width={16} height={16} /> {t('workflow.close_job', 'Close the job')}
        </button>
      )}
    </div>
  );
}

function printGatePass(gp, wo, t) {
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) return;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(gp.gate_pass_number)}</title>
    <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:40px;color:#0f172a}h1{font-size:22px;margin:0 0 4px}
    .muted{color:#64748b}.box{border:2px solid #0f172a;border-radius:12px;padding:22px;margin-top:18px}
    table{width:100%;border-collapse:collapse;margin-top:10px}td{padding:8px 0;border-bottom:1px solid #e2e8f0}td:first-child{color:#64748b;width:40%}
    .ok{display:inline-block;background:#dcfce7;color:#166534;border-radius:20px;padding:4px 12px;font-weight:700;font-size:13px}
    .sig{display:flex;gap:40px;margin-top:60px}.sig div{flex:1;border-top:1px solid #0f172a;padding-top:6px;font-size:12px;color:#64748b}</style></head>
    <body><h1>${esc(t('workflow.gatepass_doc', 'Gate pass — vehicle release'))}</h1><div class="muted">${esc(gp.gate_pass_number)}</div>
    <div class="box"><span class="ok">✓ ${esc(t('workflow.cleared', 'Payment confirmed · Quality check passed'))}</span>
    <table><tr><td>Job</td><td>${esc(wo.work_order_number)}</td></tr><tr><td>Customer</td><td>${esc(gp.customer_name || wo.customer_name)}</td></tr>
    <tr><td>Vehicle</td><td>${esc([gp.vehicle_plate || wo.plate_number, wo.make, wo.model].filter(Boolean).join(' · '))}</td></tr>
    <tr><td>Odometer out</td><td>${gp.odometer_out ? esc(Number(gp.odometer_out).toLocaleString('en-US')) + ' km' : '—'}</td></tr>
    <tr><td>Released</td><td>${esc(String(gp.released_at || '').slice(0, 16).replace('T', ' '))}</td></tr></table></div>
    <div class="sig"><div>Released by</div><div>Security / Gate</div><div>Customer</div></div>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

/* ── Modals ─────────────────────────────────────────────────────────── */
function Modal({ title, onClose, children, footer }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="wf-modal-bg" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="wf-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="wf-modal-head"><h4>{title}</h4><button className="wf-icon-btn" onClick={onClose} aria-label="Close"><Xmark width={18} height={18} /></button></div>
        <div className="wf-modal-body">{children}</div>
        {footer && <div className="wf-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function ClassifyModal({ t, wo, manager, onClose, onSave }) {
  const [cls, setCls] = useState(wo.customer_class || 'external');
  const [sub, setSub] = useState(wo.customer_subcategory || '');
  const options = SUBCATS[cls];
  useEffect(() => { if (!options.some(o => o[0] === sub)) setSub(''); }, [cls]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only a manager changes the class (Internal removes the estimate approval);
  // the Service Advisor picks the missing external subcategory.
  const classes = manager ? [['internal', t('workflow.internal', 'Internal')], ['external', t('workflow.external', 'External')]]
    : [[cls, cls === 'internal' ? t('workflow.internal', 'Internal') : t('workflow.external', 'External')]];
  return (
    <Modal title={t('workflow.classify', 'Classify customer')} onClose={onClose}
      footer={<><button className="wf-btn ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="wf-btn primary" disabled={!sub} onClick={() => onSave(cls, sub)}>{t('common.save', 'Save')}</button></>}>
      <p className="wf-muted sm">{t('workflow.classify_scope', 'This is saved on the customer\'s account and used for their job cards from now on. Job cards already opened keep the classification they were opened with, unless it was left incomplete.')}</p>
      <div className="wf-fact-label">{t('workflow.category', 'Main category')}</div>
      <div className="wf-seg">{classes.map(([k, l]) =>
        <button key={k} className={cls === k ? 'on' : ''} onClick={() => setCls(k)}>{l}</button>)}</div>
      {!manager && <p className="wf-muted sm">{t('workflow.class_manager_only', 'Changing Internal / External is done by the Workshop Manager.')}</p>}
      <div className="wf-fact-label" style={{ marginTop: 14 }}>{t('workflow.subcategory', 'Subcategory')}</div>
      <div className="wf-seg">{options.map(([k, l]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{t(`workflow.val.sub_${k}`, l)}</button>)}</div>
    </Modal>
  );
}

function SubJobCardModal({ t, data, mechanics, onClose, onSave }) {
  const main = data.job_cards.find(c => !c.parent_job_card_id);
  const [title, setTitle] = useState('');
  const [dept, setDept] = useState('body_paint');
  const [tech, setTech] = useState('');
  const [items, setItems] = useState([]);
  const toggle = id => setItems(x => x.includes(id) ? x.filter(i => i !== id) : [...x, id]);
  return (
    <Modal title={t('workflow.add_sub', 'Add a sub-job card')} onClose={onClose}
      footer={<><button className="wf-btn ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
        <button className="wf-btn primary" disabled={!title.trim()} onClick={() => onSave({ title: title.trim(), department: dept, mechanic_id: tech ? Number(tech) : undefined, item_ids: items })}>{t('workflow.create', 'Create')}</button></>}>
      <label className="wf-label">{t('workflow.sub_title', 'Title')}<input className="wf-input" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder={t('workflow.sub_title_ph', 'e.g. Body & paint, AC re-gas')} /></label>
      <div className="wf-grid2">
        <label className="wf-label">{t('workflow.department', 'Department')}<select className="wf-input" value={dept} onChange={e => setDept(e.target.value)}>{DEPARTMENTS.map(([k, l]) => <option key={k} value={k}>{t(`workflow.dept.${k}`, l)}</option>)}</select></label>
        <label className="wf-label">{t('workflow.technician_short', 'Technician')}<select className="wf-input" value={tech} onChange={e => setTech(e.target.value)}><option value="">{t('workflow.later', 'Assign later')}</option>{mechanics.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></label>
      </div>
      {main?.items?.length > 0 && (
        <>
          <div className="wf-fact-label">{t('workflow.move_items', 'Move approved work to this card')}</div>
          <div className="wf-checklist">
            {main.items.map(i => <label key={i.id} className="wf-cb"><input type="checkbox" checked={items.includes(i.id)} onChange={() => toggle(i.id)} /> {i.name}</label>)}
          </div>
        </>
      )}
    </Modal>
  );
}

function QcModal({ t, card, checklist, onClose, onSave }) {
  // The client's three points: two OK / Not OK checks (both required) and
  // free-text "any other issues or comments".
  const checks = checklist.filter(c => c.type !== 'comment');
  const commentItem = checklist.find(c => c.type === 'comment');
  const [answers, setAnswers] = useState({});
  const [comments, setComments] = useState('');
  const allOk = checks.every(c => answers[c.key] === true);
  const anyNotOk = checks.some(c => answers[c.key] === false);
  const submit = result => onSave({
    checklist_items: [
      ...checks.map(c => ({ key: c.key, item: c.label, passed: answers[c.key] === true })),
      ...(commentItem ? [{ key: commentItem.key, item: commentItem.label, passed: true, notes: comments.trim() || null }] : []),
    ],
    overall_result: result,
    inspector_notes: comments.trim() || undefined,
  });
  return (
    <Modal title={`${t('workflow.do_qc', 'Quality check')} — ${card.job_card_number}`} onClose={onClose}
      footer={<>
        <button className="wf-btn bad" disabled={!comments.trim()} title={!comments.trim() ? t('workflow.say_why', 'Say what failed') : ''} onClick={() => submit('failed')}><Xmark width={15} height={15} /> {t('workflow.qc_fail', 'Failed — rework')}</button>
        <button className="wf-btn go" disabled={!allOk} onClick={() => submit('passed')}><Check width={15} height={15} /> {t('workflow.qc_pass', 'Passed — ready for collection')}</button>
      </>}>
      <div className="wf-qc">
        {checks.map((c, n) => (
          <div key={c.key} className={`wf-qc-item ${answers[c.key] === true ? 'ok' : answers[c.key] === false ? 'no' : ''}`}>
            <span><b className="wf-qc-n">{n + 1}</b> {t(`workflow.qc_item.${c.key}`, c.label)}</span>
            <span className="wf-yn">
              <button className={answers[c.key] === true ? 'on ok' : ''} onClick={() => setAnswers(a => ({ ...a, [c.key]: true }))} aria-label={t('workflow.ok', 'OK')}><Check width={15} height={15} /></button>
              <button className={answers[c.key] === false ? 'on no' : ''} onClick={() => setAnswers(a => ({ ...a, [c.key]: false }))} aria-label={t('workflow.not_ok', 'Not OK')}><Xmark width={15} height={15} /></button>
            </span>
          </div>
        ))}
      </div>
      {commentItem && (
        <div className="wf-qc-comment">
          <label htmlFor="wf-qc-comments"><b className="wf-qc-n">{checks.length + 1}</b> {t(`workflow.qc_item.${commentItem.key}`, commentItem.label)}</label>
          <textarea id="wf-qc-comments" className="wf-input" rows={3} value={comments} onChange={e => setComments(e.target.value)}
            placeholder={anyNotOk ? t('workflow.qc_say_what', 'Say what is not OK — the Team Leader sees this') : t('workflow.qc_optional', 'Optional')} />
        </div>
      )}
    </Modal>
  );
}

function PartsModal({ t, card, onClose, onSave }) {
  const [rows, setRows] = useState([{ description: '', part_number: '', quantity: 1 }]);
  const upd = (i, k, v) => setRows(r => r.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const valid = rows.filter(r => r.description.trim());
  return (
    <Modal title={`${t('workflow.request_parts', 'Request parts')} — ${card.job_card_number}`} onClose={onClose}
      footer={<><button className="wf-btn ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="wf-btn primary" disabled={!valid.length} onClick={() => onSave(valid.map(r => ({ ...r, quantity: Number(r.quantity) || 1 })))}>{t('workflow.send_store', 'Send to the Store')}</button></>}>
      {rows.map((r, i) => (
        <div key={i} className="wf-part-row">
          <input className="wf-input grow" placeholder={t('workflow.part_desc', 'Part description')} value={r.description} onChange={e => upd(i, 'description', e.target.value)} />
          <input className="wf-input" style={{ width: 120 }} placeholder={t('workflow.part_no', 'Part no.')} value={r.part_number} onChange={e => upd(i, 'part_number', e.target.value)} />
          <input className="wf-input" style={{ width: 70 }} type="number" min="1" value={r.quantity} onChange={e => upd(i, 'quantity', e.target.value)} />
        </div>
      ))}
      <button className="wf-btn ghost sm" onClick={() => setRows(r => [...r, { description: '', part_number: '', quantity: 1 }])}><Plus width={13} height={13} /> {t('workflow.add_line', 'Add line')}</button>
    </Modal>
  );
}

function EtaModal({ t, item, onClose, onSave }) {
  const [date, setDate] = useState(dateOnly(item.expected_date) || '');
  return (
    <Modal title={t('workflow.not_on_shelf', 'Not on the shelf')} onClose={onClose}
      footer={<><button className="wf-btn ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="wf-btn primary" disabled={!date} onClick={() => onSave(date)}>{t('common.save', 'Save')}</button></>}>
      <p className="wf-note">{Number(item.quantity_requested)} × {item.description}</p>
      <label className="wf-label">{t('workflow.expected_date', 'Expected arrival date')}<input className="wf-input" type="date" min={todayISO()} value={date} onChange={e => setDate(e.target.value)} /></label>
      <p className="wf-muted sm">{t('workflow.eta_hint', 'The floor is alerted 24 hours before this date. Re-check the shelf when it arrives.')}</p>
    </Modal>
  );
}

function GatePassModal({ t, data, onClose, onSave }) {
  const [odo, setOdo] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Modal title={t('workflow.issue_gatepass', 'Issue gate pass')} onClose={onClose}
      footer={<><button className="wf-btn ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="wf-btn primary" onClick={() => onSave({ odometer_out: odo ? Number(odo) : undefined, notes: notes.trim() || undefined })}><Key width={15} height={15} /> {t('workflow.release', 'Release vehicle')}</button></>}>
      <p className="wf-note">{data.work_order.plate_number} · {data.work_order.customer_name}</p>
      <label className="wf-label">{t('workflow.odometer_out', 'Odometer out (km)')}<input className="wf-input" type="number" min="0" value={odo} onChange={e => setOdo(e.target.value)} /></label>
      <label className="wf-label">{t('workflow.notes', 'Notes')}<input className="wf-input" value={notes} onChange={e => setNotes(e.target.value)} /></label>
    </Modal>
  );
}

function ContactModal({ t, channel, onClose, onSave }) {
  const [outcome, setOutcome] = useState('reached');
  const [note, setNote] = useState('');
  return (
    <Modal title={t('workflow.log_call', 'Log the call')} onClose={onClose}
      footer={<><button className="wf-btn ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="wf-btn primary" onClick={() => onSave({ channel, outcome, note: note.trim() || undefined, purpose: 'pickup' })}>{t('common.save', 'Save')}</button></>}>
      <div className="wf-seg">{[['reached', t('workflow.reached', 'Reached')], ['no_answer', t('workflow.no_answer', 'No answer')]].map(([k, l]) =>
        <button key={k} className={outcome === k ? 'on' : ''} onClick={() => setOutcome(k)}>{l}</button>)}</div>
      <label className="wf-label" style={{ marginTop: 12 }}>{t('workflow.pickup_note', 'Collection arrangement')}<input className="wf-input" placeholder={t('workflow.pickup_ph', 'e.g. Collecting today at 6 pm')} value={note} onChange={e => setNote(e.target.value)} /></label>
    </Modal>
  );
}

function PayModal({ t, invoice, money, onClose, onSave }) {
  const due = Math.max(0, Number(invoice.total_amount) - Number(invoice.amount_paid || 0));
  const [amount, setAmount] = useState(due.toFixed(2));
  const [method, setMethod] = useState('cash');
  return (
    <Modal title={`${t('workflow.take_payment', 'Take payment')} — ${invoice.invoice_number}`} onClose={onClose}
      footer={<><button className="wf-btn ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="wf-btn primary" disabled={!(Number(amount) > 0)} onClick={() => onSave({ amount: Number(amount), payment_method: method })}>{t('workflow.record_payment', 'Record payment')}</button></>}>
      <p className="wf-note">{t('workflow.due', 'Due')}: <strong>{money(due)}</strong></p>
      <div className="wf-grid2">
        <label className="wf-label">{t('workflow.amount', 'Amount')}<input className="wf-input" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="wf-label">{t('workflow.method', 'Method')}<select className="wf-input" value={method} onChange={e => setMethod(e.target.value)}>
          <option value="cash">{t('workflow.cash', 'Cash')}</option><option value="card">{t('workflow.card', 'Card')}</option><option value="bank_transfer">{t('workflow.bank', 'Bank transfer')}</option></select></label>
      </div>
    </Modal>
  );
}

function Fact({ label, value }) {
  return <div className="wf-fact"><div className="wf-fact-label">{label}</div><div className="wf-fact-value">{value || '—'}</div></div>;
}
