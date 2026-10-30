/**
 * Estimates — the staff side of the estimate pipeline.
 *
 * Until this screen existed the backend pipeline was complete but nobody
 * could reach it: drafts were stranded, a partially approved estimate sat
 * unseen, and convert-to-job-card was never called from the UI.
 *
 * Organised around who has to act next (process steps 4–6):
 *   Parts to price  — the Store prices each part line in every category of
 *                     the customer's parts preference (Genuine / After-Market
 *                     / Used): available or not, price, quantity, delivery —
 *                     and may offer an alternative; only for users who may
 *                     price parts (GET /estimates?view=parts_to_price)
 *   Needs approval  — an external customer's estimate waiting for a
 *                     supervisor / workshop manager to sign it off
 *   With customer   — sent, waiting for the customer's line decisions
 *   To convert      — the customer approved some or all lines; open the job card
 * and the history: drafts, converted, rejected.
 *
 * The detail shows the price per job — labour and the total in each category
 * of the preference, with any alternative apart (it never replaces a
 * requested category) — and is sent by email or WhatsApp.
 *
 * URLs: /estimates?id=<id> (notifications) · /estimates?new=1 (dashboard) ·
 * /estimates?new=1&wo=<workOrderId> (from a job card: the estimate for that visit).
 */
import { useEffect, useState, useCallback, useContext, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Search, Refresh, Check, Xmark, SendMail, WarningCircle, ChatBubble, OpenNewWindow, EditPencil, Label, Whatsapp,
} from 'iconoir-react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import NewEstimateModal, {
  mayPriceParts, summarisePricing, partUnpriced, effectiveOption, jobKeyOf, PART_CATEGORIES, categoryLabel, categoryWords,
  catCols, preferenceOf, partOptions, hasCategoryPricing, SendEstimatePanel, CopyButton,
} from '../components/NewEstimateModal';
import './Estimates.css';
import { canDo } from '../lib/permissions';

const VIEWS = [
  { key: 'parts_to_price', label: 'Parts to price', store: true },
  { key: 'needs_approval', label: 'Needs approval' },
  { key: 'with_customer',  label: 'With customer' },
  { key: 'to_convert',     label: 'To convert' },
  { key: 'drafts',         label: 'Drafts' },
  { key: 'converted',      label: 'Job card opened' },
  { key: 'rejected',       label: 'Rejected / expired' },
];

const EMPTY = {
  parts_to_price: 'No estimates are waiting for part prices.',
  needs_approval: 'Nothing waiting for sign-off.',
  with_customer: 'No estimates are waiting on a customer.',
  to_convert: 'No approved estimates waiting to become job cards.',
  drafts: 'No drafts.',
  converted: 'No estimates have become job cards yet.',
  rejected: 'No rejected or expired estimates.',
};

const STATUS_LABEL = {
  draft: 'Draft', sent_to_customer: 'With customer', partially_approved: 'Partially approved',
  approved: 'Approved', rejected: 'Rejected', expired: 'Expired', converted: 'Job card opened',
};

const TYPE_LABEL = { labour: 'Labour', parts: 'Parts', sublet: 'Sublet', consumable: 'Consumable', discount: 'Discount' };

/** The customer's parts preference as small chips ("Genuine · Used"). */
function PreferenceChips({ pref, t }) {
  return (
    <span className="es-prefChips" aria-label={t('estimates.pref_label', 'Customer’s parts preference')}>
      {pref.map(c => <span key={c} className={`es-catChip es-cat-${c}`}>{categoryLabel(t, c)}</span>)}
    </span>
  );
}

const fmtDay = d => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

const aed = n => `AED ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lineTotal = l => Number(l.line_total ?? (Number(l.quantity) * Number(l.unit_price) * (1 - Number(l.discount_pct || 0) / 100)));

export default function Estimates() {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext) || {};
  const canParts = mayPriceParts(user);
  const isStoreRole = ['storekeeper', 'part_advisor'].includes(user?.role_slug) || user?.role === 'part_advisor';
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState(isStoreRole ? 'parts_to_price' : 'with_customer');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [intakeWO, setIntakeWO] = useState(null);
  const [fromEnquiry, setFromEnquiry] = useState(null);
  const reqRef = useRef(0);
  const toastTimer = useRef(null);
  const openId = params.get('id');

  const flash = useCallback(m => {
    if (!m) return;
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3800);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ?new=1 (dashboard quick action) opens the new-estimate form;
  // ?new=1&wo=<id> (job card screen) opens it for that work order.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    const woId = params.get('wo');
    const enquiryId = params.get('enquiry');
    const next = new URLSearchParams(params); next.delete('new'); next.delete('wo'); next.delete('enquiry');
    setParams(next, { replace: true });
    if (enquiryId) {
      // Quote stage: the enquiry's customer and vehicle (found or created on the server).
      (async () => {
        try {
          const res = await api.post(`/enquiries/${encodeURIComponent(enquiryId)}/prepare-quote`);
          if (!res?.success) { flash(res?.message || t('estimates.err_load_enquiry', 'Could not open that enquiry.')); return; }
          setIntakeWO(null);
          setFromEnquiry({ id: res.data.enquiry_id, enquiry_number: res.data.enquiry_number, customer: res.data.customer, vehicle_id: res.data.vehicle_id });
          setShowNew(true);
        } catch { flash(t('estimates.err_load_enquiry', 'Could not open that enquiry.')); }
      })();
      return;
    }
    if (!woId) { setIntakeWO(null); setFromEnquiry(null); setShowNew(true); return; }
    (async () => {
      try {
        const res = await api.get(`/work-orders/${encodeURIComponent(woId)}`);
        const w = res?.data;
        if (!res?.success || !w) { flash(res?.message || t('estimates.err_load_wo', 'Could not open that job card.')); return; }
        setIntakeWO({
          id: w.id, work_order_number: w.work_order_number,
          customer_id: w.customer_id, customer_name: w.customer_name_ref || w.customer_name,
          vehicle_id: w.vehicle_id, plate_number: w.vehicle_plate_number,
        });
        setShowNew(true);
      } catch {
        flash(t('estimates.err_load_wo', 'Could not open that job card.'));
      }
    })();
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    setLoading(true);
    try {
      // Every tab, "Parts to price" included, is a view of GET /estimates;
      // its counts carry each tab's number.
      const q = new URLSearchParams({ view, limit: '100' });
      if (search.trim()) q.set('search', search.trim());
      const res = await api.get(`/estimates?${q}`);
      if (req !== reqRef.current) return;
      if (res.success) { setRows(res.estimates || []); setCounts(res.counts || {}); }
    } catch { /* the empty state covers it */ }
    finally { if (req === reqRef.current) setLoading(false); }
  }, [view, search]);

  useEffect(() => { const tm = setTimeout(load, search ? 300 : 0); return () => clearTimeout(tm); }, [load, search]);

  // Land on the queue that needs someone first, once, when nothing is open.
  useEffect(() => {
    if (counts.needs_approval > 0 && view === 'with_customer' && !rows.length && !loading) setView('needs_approval');
  }, [counts]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = id => setParams(id ? { id: String(id) } : {});
  const views = VIEWS.filter(v => !v.store || canParts);
  const countOf = key => counts[key] ?? 0;

  return (
    <>
      <div className="es-wrap">
        <header className="es-head">
          <div>
            <h1 className="es-title">{t('estimates.title', 'Estimates')}</h1>
            <p className="es-sub">{t('estimates.subtitle_pref', 'Quotes for the customer to approve line by line. The Store prices parts in the customer’s parts preference (Genuine, After-Market, Used); the approved lines go onto the job card.')}</p>
          </div>
          <div className="es-headActions">
            <button className="es-btn es-btnGhost" onClick={load}><Refresh width={16} height={16} /> {t('estimates.refresh', 'Refresh')}</button>
            {canDo(user, 'estimate.raise') && <button className="es-btn" onClick={() => { setIntakeWO(null); setFromEnquiry(null); setShowNew(true); }}>{t('estimates.new', 'New estimate')}</button>}
          </div>
        </header>

        <div className="es-tabs">
          {views.map(v => (
            <button key={v.key} className={`es-tab${view === v.key ? ' es-tabOn' : ''}${['needs_approval', 'to_convert', 'parts_to_price'].includes(v.key) && countOf(v.key) ? ' es-tabAct' : ''}`}
              onClick={() => setView(v.key)}>
              {v.store && <Label width={14} height={14} />}
              {t(`estimates.view_${v.key}`, v.label)}<span className="es-count">{countOf(v.key)}</span>
            </button>
          ))}
          <div className="es-searchWrap">
            <Search width={15} height={15} />
            <input className="es-search" placeholder={t('estimates.search_ph', 'Estimate no., customer or plate…')} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="es-empty">{t('estimates.loading', 'Loading…')}</div>
        ) : rows.length === 0 ? (
          <div className="es-empty"><p>{search.trim() ? t('estimates.no_match', 'Nothing matches "{{q}}".', { q: search }) : t(`estimates.empty_${view}`, EMPTY[view])}</p></div>
        ) : view === 'parts_to_price' ? (
          <div className="es-list">
            {rows.map(r => (
              <button key={r.id} className="es-row" onClick={() => open(r.id)}>
                <div className="es-rowRef">{r.estimate_number}</div>
                <div className="es-rowMain">
                  <div className="es-rowName">{r.customer_full_name || r.customer_name || '—'}</div>
                  <div className="es-rowMeta">{r.plate_number || r.vehicle_plate || t('estimates.no_vehicle', 'No vehicle')}</div>
                </div>
                <div className="es-rowLines es-rowStore">
                  <Label width={14} height={14} /> {t('estimates.n_parts_to_price', '{{n}} part(s) to price', { n: Number(r.unpriced_parts) || 0 })}
                  <PreferenceChips pref={preferenceOf(r)} t={t} />
                </div>
                <div className="es-rowTotal" />
                <div className="es-rowRight">
                  <span className="es-chip es-chip-hold">{t('estimates.waiting_store', 'Waiting for the Store')}</span>
                  <div className="es-rowAgo">{ago(r.created_at, t)}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="es-list">
            {rows.map(r => (
              <button key={r.id} className="es-row" onClick={() => open(r.id)}>
                <div className="es-rowRef">{r.estimate_number}</div>
                <div className="es-rowMain">
                  <div className="es-rowName">{r.customer_full_name || r.customer_name || '—'}</div>
                  <div className="es-rowMeta">{[r.plate_number || r.vehicle_plate, [r.make, r.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || t('estimates.no_vehicle', 'No vehicle')}</div>
                </div>
                <div className="es-rowLines">{t('estimates.n_of_m_approved', '{{a}}/{{n}} approved', { a: r.approved_count, n: r.line_count })}</div>
                <div className="es-rowTotal">{aed(r.total_amount)}</div>
                <div className="es-rowRight">
                  <StatusChip status={r.status} needsApproval={!!Number(r.needs_internal_approval)} />
                  <div className="es-rowAgo">{ago(r.created_at, t)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {openId && (
        <EstimateDetail id={openId} user={user} onClose={() => open(null)}
          onChanged={msg => { if (msg) flash(msg); load(); }} onError={flash} />
      )}
      {showNew && (
        <NewEstimateModal
          open
          intakeWorkOrder={intakeWO}
          enquiry={fromEnquiry}
          onClose={() => { setShowNew(false); setIntakeWO(null); setFromEnquiry(null); load(); }}
          onSaved={() => load()}
          onSent={() => load()}
        />
      )}
      {toast && <div className="es-toast">{toast}</div>}
    </>
  );
}

function StatusChip({ status, needsApproval }) {
  const { t } = useTranslation();
  if (needsApproval) return <span className="es-chip es-chip-hold">{t('estimates.status_needs_approval', 'Needs approval')}</span>;
  return <span className={`es-chip es-chip-${status}`}>{t(`estimates.status_${status}`, STATUS_LABEL[status] || status)}</span>;
}

/** Lines grouped by job, in estimate order. */
function groupByJob(lines) {
  const map = new Map();
  for (const l of lines) {
    const k = jobKeyOf(l);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(l);
  }
  return [...map.entries()];
}

/* ── Detail ─────────────────────────────────────────────────────────── */
function EstimateDetail({ id, user, onClose, onChanged, onError }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState(null); // last send result: { approval_url, whatsapp_url, channel }
  const [sendOpen, setSendOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const canParts = mayPriceParts(user);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/estimates/${id}`);
      if (res.success) setData(res);
      else { onError(res.message || t('estimates.err_open', 'Could not open that estimate')); onClose(); }
    } catch { onError(t('estimates.err_open', 'Could not open that estimate')); onClose(); }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSent(null); setData(null); load(); }, [load]);

  if (!data) return <Shell onClose={onClose}><div className="es-mLoading">{t('estimates.loading', 'Loading…')}</div></Shell>;
  const { estimate: e, lines, can_approve } = data;

  const act = async (key, fn, okMsg) => {
    setBusy(key);
    try {
      const res = await fn();
      if (res.success) { onChanged(typeof okMsg === 'function' ? okMsg(res) : okMsg); await load(); return res; }
      onError(res.message || t('estimates.err_generic', 'That did not work'));
      if (res.code === 'MANAGER_APPROVAL_REQUIRED') await load();
    } catch { onError(t('estimates.err_generic', 'That did not work')); }
    finally { setBusy(''); }
    return null;
  };

  const approve = () => act('approve', () => api.post(`/estimates/${e.id}/internal-approve`), t('estimates.approved_ready', 'Estimate approved — it can be sent now.'));
  const convert = () => act('convert', () => api.post(`/estimates/${e.id}/convert-to-work-order`), r => t('estimates.jc_opened', 'Job card {{n}} opened.', { n: r.work_order_number }));
  const decide = (lineId, status, partOption) => act(`line-${lineId}`,
    () => api.patch(`/estimates/${e.id}/lines/${lineId}/approve`, { customer_status: status, ...(partOption ? { part_option: partOption } : {}) }),
    r => (r.work_order_number ? t('estimates.all_approved_jc', 'All lines approved — job card {{n}} opened.', { n: r.work_order_number }) : null));

  const pref = preferenceOf(e);
  // The server's per-job, per-category numbers (lib/workflow.js); the same arithmetic here as a fallback.
  const summary = data.pricing?.totals ? data.pricing : summarisePricing(lines, pref);
  const groups = groupByJob(lines);
  const showGroupRows = groups.length > 1 || lines.some(l => l.job_name);
  const vatRate = Number(e.vat_rate || 0);
  const closed = !!e.work_order_id || ['converted', 'expired', 'rejected'].includes(e.status);
  const pricingOpen = canParts && !closed;
  const decided = lines.filter(l => l.customer_status !== 'pending').length;
  const approvedSub = lines.filter(l => l.customer_status === 'approved' && l.line_type !== 'discount').reduce((s, l) => s + lineTotal(l), 0);
  const approvedTotal = approvedSub * (1 + vatRate / 100);
  // Raising/sending is the Service Advisor's; recording the customer's
  // decision too. The Supervisor only approves, the Store only prices.
  const mayRaise = canDo(user, 'estimate.raise');
  const mayRecord = canDo(user, 'customer.approval');
  const canSend = mayRaise && ['draft', 'sent_to_customer'].includes(e.status) && !e.work_order_id;
  const canEdit = mayRaise && ['draft', 'sent_to_customer'].includes(e.status) && !e.work_order_id;
  const canConvert = mayRecord && ['approved', 'partially_approved'].includes(e.status) && !e.work_order_id;
  const canDecideInPerson = mayRecord && e.status === 'sent_to_customer';
  const phone = String(e.customer_phone || '').replace(/[^\d]/g, '');
  // The customer's approval link — also after reopening an estimate that is
  // already out (to resend it, or to open it at the counter).
  const link = sent?.approval_url
    || (e.approval_token && e.status === 'sent_to_customer' ? `${window.location.origin}/estimate-approval/${e.approval_token}` : '');
  const hasCatParts = lines.some(l => l.line_type === 'parts' && hasCategoryPricing(l));
  const waText = link && encodeURIComponent(`Your estimate ${e.estimate_number} from Pioneer Car Service Center is ready`
    + `${hasCatParts ? ` (parts priced in ${pref.map(c => categoryLabel(t, c)).join(' / ')})` : ''}`
    + `${summary.alternatives?.length ? `; ${summary.alternatives.length} part(s) offered as an alternative for your approval` : ''}. Please review and approve each item here: ${link}`);
  const altByJob = job => (summary.alternatives || []).filter(a => a.job === job);

  const sendLabel = e.needs_internal_approval
    ? (can_approve ? t('estimates.approve_send_btn', 'Approve & send…') : t('estimates.ask_approval_btn', 'Ask for approval…'))
    : e.status === 'sent_to_customer' ? t('estimates.resend_btn', 'Resend…') : t('estimates.send_btn', 'Send to customer…');

  return (
    <>
      <Shell onClose={onClose}>
        <div className="es-mHead">
          <div>
            <p className="es-mRef">{e.estimate_number}{e.version > 1 ? ` · v${e.version}` : ''}</p>
            <h2 className="es-mTitle">{e.customer_full_name || e.customer_name || t('estimates.customer', 'Customer')}</h2>
            <p className="es-mSub">
              {[e.plate_number || e.vehicle_plate, [e.make, e.model, e.year].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || t('estimates.no_vehicle', 'No vehicle')}
              <span className={`es-class ${e.is_external ? 'es-classExt' : 'es-classInt'}`}>{e.is_external ? t('estimates.external', 'External') : t('estimates.internal', 'Internal')}</span>
              {lines.some(l => l.line_type === 'parts') && <PreferenceChips pref={pref} t={t} />}
              {e.intake_work_order_id && !e.work_order_id && (
                <Link to={`/work-orders/${e.intake_work_order_id}`} className="es-woLink">{t('estimates.for_wo_number', 'For work order {{n}}', { n: e.intake_work_order_number || `#${e.intake_work_order_id}` })}</Link>
              )}
            </p>
          </div>
          <StatusChip status={e.status} needsApproval={e.needs_internal_approval} />
        </div>

        <div className="es-mBody">
          {summary.unpricedParts > 0 && !closed && (
            <div className="es-banner es-bannerHold">
              <Label width={18} height={18} />
              <div>
                <b>{t('estimates.parts_waiting_n', '{{n}} part(s) waiting for the Store.', { n: summary.unpricedParts })}</b>{' '}
                {canParts
                  ? t('estimates.parts_waiting_store_cat', 'For each part below: {{cats}} — available or not, price and delivery.', { cats: categoryWords(t, pref) })
                  : t('estimates.parts_waiting_other', 'The Storekeeper has been notified — it can be sent once every part is priced.')}
              </div>
            </div>
          )}
          {e.needs_internal_approval && (
            <div className="es-banner es-bannerHold">
              <WarningCircle width={18} height={18} />
              <div>
                <b>{t('estimates.waiting_signoff', 'Waiting for supervisor or workshop manager approval.')}</b>{' '}
                {t('estimates.signoff_why', "External customers' estimates are signed off before they are sent.")}
                {!can_approve && mayRaise && ` ${t('estimates.signoff_how', 'Use “Ask for approval” to notify them.')}`}
              </div>
            </div>
          )}
          {!e.needs_internal_approval && e.internal_approved_at && e.status === 'draft' && (
            <div className="es-banner es-bannerOk"><Check width={18} height={18} /><div>{t('estimates.approved_by', 'Approved by {{n}} — ready to send.', { n: e.internal_approved_by_name || t('estimates.a_manager', 'a manager') })}</div></div>
          )}
          {e.status === 'sent_to_customer' && (
            <div className="es-banner es-bannerInfo"><SendMail width={18} height={18} /><div>{t('estimates.with_customer_n', 'With the customer — {{d}} of {{n}} lines decided.', { d: decided, n: lines.length })}</div></div>
          )}
          {canConvert && (
            <div className="es-banner es-bannerAct">
              <WarningCircle width={18} height={18} />
              <div><b>{t('estimates.customer_approved_n', 'The customer approved {{a}} of {{n}} lines.', { a: lines.filter(l => l.customer_status === 'approved').length, n: lines.length })}</b> {t('estimates.open_jc_hint', 'Open the job card for the approved work.')}</div>
            </div>
          )}
          {e.work_order_id && (
            <div className="es-banner es-bannerOk">
              <Check width={18} height={18} />
              <div>{t('estimates.jc_label', 'Job card')} <Link to={`/work-orders/${e.work_order_id}`} className="es-link">{e.work_order_number || `#${e.work_order_id}`} <OpenNewWindow width={13} height={13} /></Link> {t('estimates.jc_from_lines', 'opened from the approved lines.')}</div>
            </div>
          )}
          {e.status === 'rejected' && (
            <div className="es-banner es-bannerBad"><Xmark width={18} height={18} /><div>{t('estimates.rejected_msg', 'The customer rejected this estimate. No work will be carried out.')}</div></div>
          )}

          {summary.jobs.length > 0 && (
            <section className="es-section">
              <div className="es-h3">{t('estimates.price_by_job', 'Price by job')}</div>
              <div className="es-scroll">
                {/* One column per category of the preference (parts, then the total with labour); an alternative apart. */}
                <table className="es-jobs">
                  <thead>
                    <tr>
                      <th>{t('estimates.col_job', 'Job')}</th>
                      <th className="es-num">{t('estimates.col_labour', 'Labour')}</th>
                      {pref.map(c => <th key={c} className="es-num es-colTot es-colHi">{t('estimates.col_total_cat', 'Total {{cat}}', { cat: categoryLabel(t, c) })}</th>)}
                      {summary.alternatives?.length > 0 && <th className="es-num">{t('estimates.col_alternative', 'Alternative')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.jobs.map(j => {
                      const alts = altByJob(j.job);
                      return (
                        <tr key={j.job}>
                          <td>
                            <span className="es-jobName">{j.job}</span>
                            {j.waiting > 0 && <span className="es-badge es-badgeWait">{t('estimates.n_waiting_store', '{{n}} waiting for Store', { n: j.waiting })}</span>}
                          </td>
                          <td className="es-num">{aed(j.labour)}</td>
                          {pref.map(c => (
                            <td key={c} className="es-num es-colTot es-colHi">
                              {aed(j.totals?.[c])}
                              {j.part_lines > 0 && (
                                <span className="es-subAmt">
                                  {j.waiting === j.part_lines ? <span className="es-waitTxt">{t('estimates.waiting_short', 'Waiting')}</span>
                                    : t('estimates.parts_amt', 'parts {{a}}', { a: aed(j.parts?.[c]) })}
                                  {j.na?.[c] && <NABadge t={t} title={t('estimates.na_cat_tip', 'A part of this job is not available in {{cat}} — it is not in this total, and no other type is used instead', { cat: categoryLabel(t, c) })} />}
                                </span>
                              )}
                            </td>
                          ))}
                          {summary.alternatives?.length > 0 && (
                            <td className="es-num">
                              {alts.length ? (
                                <>{aed(alts.reduce((s, a) => s + Number(a.amount || 0), 0))}
                                  <span className="es-subAmt">{alts.map(a => categoryLabel(t, a.option)).join(', ')} · {t('estimates.needs_customer_ok', 'customer approves')}</span></>
                              ) : <span className="es-dash">—</span>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>{t('estimates.total_excl_vat', 'Total (excl. VAT)')}</td>
                      {pref.map(c => <td key={c} className="es-num es-colTot es-colHi">{aed(summary.totals?.[c])}</td>)}
                      {summary.alternatives?.length > 0 && <td />}
                    </tr>
                    <tr className="es-jobsVat">
                      <td colSpan={2}>{t('estimates.total_incl_vat', 'Total incl. {{v}}% VAT', { v: vatRate })}</td>
                      {pref.map(c => <td key={c} className="es-num es-colTot es-colHi">{aed(Number(summary.totals?.[c] || 0) * (1 + vatRate / 100))}</td>)}
                      {summary.alternatives?.length > 0 && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          <div className="es-h3">{t('estimates.lines', 'Lines')}</div>
          <div className="es-scroll">
            <table className="es-lines">
              <thead>
                <tr>
                  <th>{t('estimates.col_item', 'Item')}</th>
                  <th className="es-num">{t('estimates.col_qty', 'Qty')}</th>
                  <th className="es-num">{t('estimates.col_price', 'Price')}</th>
                  <th className="es-num">{t('estimates.col_total', 'Total')}</th>
                  <th>{t('estimates.col_customer', 'Customer')}</th>
                </tr>
              </thead>
              {groups.map(([job, ls]) => (
                <tbody key={job}>
                  {showGroupRows && <tr className="es-groupRow"><td colSpan={5}>{job}</td></tr>}
                  {ls.map(l => (
                    <LineRow key={l.id} t={t} estimateId={e.id} line={l} pref={pref}
                      canDecide={canDecideInPerson} busy={busy} onDecide={decide}
                      pricingOpen={pricingOpen && l.line_type === 'parts' && l.customer_status === 'pending'}
                      onPriced={res => {
                        const left = Number(res.parts_left_to_price) || 0;
                        onChanged(left
                          ? t('estimates.priced_left', 'Saved — {{n}} part line(s) still to price.', { n: left })
                          : t('estimates.priced_all', 'All parts priced — the Service Advisor has been notified.'));
                        load();
                      }} />
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          <div className="es-totals">
            <div><span>{t('estimates.quoted_subtotal', 'Quoted subtotal')}</span><span>{aed(Number(e.subtotal_labour) + Number(e.subtotal_parts) + Number(e.subtotal_sublet))}</span></div>
            <div><span>{t('estimates.vat_n', 'VAT ({{v}}%)', { v: vatRate })}</span><span>{aed(e.vat_amount)}</span></div>
            <div className="es-totalGrand"><span>{t('estimates.quoted_total', 'Quoted total')}</span><span>{aed(e.total_amount)}</span></div>
            {decided > 0 && <div className="es-totalApproved"><span>{t('estimates.approved_total', 'Approved by customer (incl. VAT)')}</span><span>{aed(approvedTotal)}</span></div>}
            {hasCatParts && pref.length > 1 && (
              <p className="es-totNote">{t('estimates.pref_note', 'Parts count at the first available of {{cats}} until the customer chooses; an alternative counts only once they approve it.', { cats: categoryWords(t, pref) })}</p>
            )}
          </div>

          {e.customer_notes && (
            <div className="es-notes">
              <div className="es-h3">{t('estimates.customer_reasons', "Customer's reasons")}</div>
              {String(e.customer_notes).split('\n').map((n, i) => <p key={i}>{n}</p>)}
            </div>
          )}

          {link && (
            <div className="es-linkBox">
              <div className="es-h3">{t('estimates.approval_link', 'Approval link')}</div>
              <code className="es-url">{link}</code>
              <div className="es-linkActions">
                <CopyButton text={link} label={t('estimates.copy', 'Copy')} className="es-btn es-btnGhost es-btnSm" />
                {sent?.whatsapp_url ? (
                  <a className="es-btn es-btnGhost es-btnSm" href={sent.whatsapp_url} target="_blank" rel="noreferrer">
                    <Whatsapp width={14} height={14} /> {t('estimates.open_whatsapp', 'Open WhatsApp again')}
                  </a>
                ) : phone ? (
                  <a className="es-btn es-btnGhost es-btnSm" href={`https://wa.me/${phone}?text=${waText}`} target="_blank" rel="noreferrer">
                    <ChatBubble width={14} height={14} /> {t('estimates.share_whatsapp', 'Share on WhatsApp')}
                  </a>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="es-mFoot">
          {canEdit && (
            <button className="es-btn es-btnGhost" disabled={!!busy} onClick={() => setEditing(true)}>
              <EditPencil width={15} height={15} /> {t('estimates.edit', 'Edit')}
            </button>
          )}
          {e.needs_internal_approval && can_approve && (
            <button className="es-btn es-btnGhost" disabled={!!busy} onClick={approve}><Check width={15} height={15} /> {busy === 'approve' ? t('estimates.approving', 'Approving…') : t('estimates.approve_only', 'Approve only')}</button>
          )}
          {canSend && (
            <button className="es-btn" disabled={!!busy} onClick={() => setSendOpen(true)}>
              <SendMail width={15} height={15} /> {sendLabel}
            </button>
          )}
          {canConvert && (
            <button className="es-btn" disabled={!!busy} onClick={convert}>{busy === 'convert' ? t('estimates.opening', 'Opening…') : t('estimates.open_jc', 'Open job card')}</button>
          )}
          {/* Book (CRM stage 05): an approved quote for a car not yet in the workshop */}
          {e.work_order_id && !e.intake_work_order_id && canDo(user, 'job.open') && (
            <Link className="es-btn" to={`/appointments?new=1&estimate=${e.id}`}>{t('estimates.book_visit', 'Book the visit')}</Link>
          )}
        </div>
      </Shell>

      {sendOpen && (
        <div className="es-overlay es-overlayTop" onClick={() => setSendOpen(false)}>
          <div className="es-modal es-sendModal" onClick={ev => ev.stopPropagation()}>
            <button className="es-close" onClick={() => setSendOpen(false)} aria-label={t('estimates.close', 'Close')}><Xmark width={18} height={18} /></button>
            <div className="es-mHead">
              <div>
                <p className="es-mRef">{e.estimate_number}</p>
                <h2 className="es-mTitle">{t('estimates.send_title', 'Send to the customer')}</h2>
                <p className="es-mSub">{e.customer_full_name || e.customer_name}</p>
              </div>
            </div>
            <div className="es-mBody">
              <SendEstimatePanel
                data={data}
                onCancel={() => setSendOpen(false)}
                onDone={res => {
                  setSendOpen(false);
                  if (res.held) { onChanged(res.message); load(); return; }
                  setSent(res);
                  onChanged(res.channel === 'whatsapp'
                    ? t('estimates.wa_opened', 'WhatsApp opened with the message — press Send there.')
                    : res.message);
                  load();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {editing && (
        <NewEstimateModal
          open
          editEstimate={data}
          onClose={() => setEditing(false)}
          onSaved={() => { onChanged(t('estimates.updated', 'Estimate updated.')); load(); }}
        />
      )}
    </>
  );
}

function NABadge({ t, title }) {
  return <span className="es-na" title={title}>{t('estimates.na', 'N/A')}</span>;
}

/** One estimate line, plus the Store's pricing editor under a part line. */
function LineRow({ t, estimateId, line: l, pref, canDecide, busy, onDecide, pricingOpen, onPriced }) {
  const isPart = l.line_type === 'parts';
  const waiting = isPart && partUnpriced(l, pref);
  const [editOpen, setEditOpen] = useState(waiting);
  return (
    <>
      <tr className={`es-line-${l.customer_status}${waiting ? ' es-lineWait' : ''}`}>
        <td>
          <div className="es-lineDesc">{l.description}</div>
          <div className="es-lineType">{t(`estimates.type_${l.line_type}`, TYPE_LABEL[l.line_type] || l.line_type)}{l.part_number ? ` · ${l.part_number}` : ''}</div>
          {isPart && <OptionPills t={t} line={l} pref={pref} />}
          {pricingOpen && !editOpen && (
            <button type="button" className="es-linkBtn" onClick={() => setEditOpen(true)}>
              <Label width={13} height={13} /> {t('estimates.edit_store_price', 'Edit Store price')}
            </button>
          )}
        </td>
        <td className="es-num">{Number(l.quantity)}</td>
        <td className="es-num">{waiting ? <span className="es-dash">—</span> : aed(l.unit_price)}</td>
        <td className="es-num">{waiting ? <span className="es-dash">—</span> : aed(lineTotal(l))}</td>
        <td><DecisionCell t={t} line={l} pref={pref} canDecide={canDecide} busy={busy} onDecide={onDecide} /></td>
      </tr>
      {pricingOpen && editOpen && (
        <tr className="es-priceRow">
          <td colSpan={5}>
            <PartPricingEditor t={t} estimateId={estimateId} line={l} pref={pref}
              onSaved={res => { setEditOpen(false); onPriced(res); }}
              onCancel={waiting ? null : () => setEditOpen(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

/** When a priced category can be had: in stock, or the expected date. */
const whenText = (t, o) => (o.expected_date ? t('estimates.expected_on', 'expected {{d}}', { d: fmtDay(o.expected_date) }) : t('estimates.in_stock', 'in stock'));

/**
 * A part's price in each category of the preference (the one it counts at
 * highlighted) or "not available", and the Store's alternative — shown
 * apart, with whether the customer took it.
 */
function OptionPills({ t, line, pref }) {
  if (partUnpriced(line, pref)) {
    return <div className="es-opts"><span className="es-badge es-badgeWait"><Label width={12} height={12} /> {t('estimates.waiting_store', 'Waiting for the Store')}</span></div>;
  }
  if (!hasCategoryPricing(line)) return null; // priced as one price before categories existed
  const { requested, alternative } = partOptions(line, pref);
  const eff = effectiveOption(line, pref);
  return (
    <div className="es-opts">
      {requested.map(o => (
        <span key={o.option} className={`es-opt${eff?.option === o.option ? ' es-optOn' : ''}${o.usable ? '' : ' es-optNA'}`}>
          {categoryLabel(t, o.option)} <b>{o.usable ? aed(o.price) : t('estimates.not_available_short', 'Not available')}</b>
          {o.usable && <span className="es-optWhen"> · {whenText(t, o)}</span>}
        </span>
      ))}
      {alternative && (
        <span className={`es-opt es-optAlt${eff?.alternative ? ' es-optOn' : ''}`}>
          {alternative.for
            ? t('estimates.alt_for', 'Alternative to {{cat}}', { cat: categoryLabel(t, alternative.for) })
            : t('estimates.alt_short', 'Alternative')}: {categoryLabel(t, alternative.option)} <b>{aed(alternative.price)}</b>
          <span className="es-optWhen"> · {whenText(t, alternative)} · {alternative.approved === true ? t('estimates.alt_approved', 'approved by the customer')
            : alternative.approved === false ? t('estimates.alt_not_taken', 'not taken') : t('estimates.alt_needs_ok', 'needs the customer’s approval')}</span>
        </span>
      )}
      {!requested.some(o => o.usable) && !alternative && <span className="es-badge es-badgeBad">{t('estimates.not_available', 'Not available')}</span>}
    </div>
  );
}

/**
 * Customer column: the decision, or in-person Approve / Reject. A part is
 * approved in one of the categories on offer; the alternative only when
 * picked — it is never preselected.
 */
function DecisionCell({ t, line: l, pref, canDecide, busy, onDecide }) {
  const isPart = l.line_type === 'parts' && hasCategoryPricing(l);
  const { requested, alternative } = isPart ? partOptions(l, pref) : { requested: [], alternative: null };
  const choices = [...requested.filter(o => o.usable), ...(alternative ? [alternative] : [])];
  const eff = isPart ? effectiveOption(l, pref) : null;
  const [opt, setOpt] = useState(() => (eff && !eff.alternative ? eff.option : null));
  const showChoice = isPart && (choices.length > 1 || choices[0]?.alternative);

  if (l.customer_status === 'pending' && canDecide) {
    return (
      <div className="es-decideWrap">
        {showChoice && (
          <div className="es-seg" role="radiogroup" aria-label={t('estimates.part_type', 'Part type')}>
            {choices.map(o => (
              <button key={o.option} type="button" role="radio" aria-checked={opt === o.option} className={`${opt === o.option ? 'es-segOn' : ''}${o.alternative ? ' es-segAlt' : ''}`}
                title={`${categoryLabel(t, o.option)} ${aed(o.price)}${o.alternative ? ` — ${t('estimates.alt_needs_ok', 'needs the customer’s approval')}` : ''}`}
                onClick={() => setOpt(o.option)}>
                {o.alternative ? `${t('estimates.alt_prefix', 'Alt.')} ` : ''}{categoryLabel(t, o.option)}
              </button>
            ))}
          </div>
        )}
        {isPart && !choices.length && <span className="es-dec es-dec-rejected">{t('estimates.reject_only', 'Not available — reject it')}</span>}
        <div className="es-decide">
          <button className="es-mini es-miniOk" disabled={!!busy || (isPart && !opt)} onClick={() => onDecide(l.id, 'approved', isPart ? opt : undefined)}
            title={isPart && !opt ? t('estimates.choose_option_first', 'Choose the type the customer approved') : t('estimates.approved_in_person_tip', 'Customer approved in person')}>
            {t('estimates.approve', 'Approve')}
          </button>
          <button className="es-mini es-miniBad" disabled={!!busy} onClick={() => onDecide(l.id, 'rejected')}
            title={t('estimates.rejected_in_person_tip', 'Customer rejected in person')}>{t('estimates.reject', 'Reject')}</button>
        </div>
      </div>
    );
  }
  const label = {
    approved: t('estimates.dec_approved', '✓ Approved'), rejected: t('estimates.dec_rejected', '✕ Rejected'),
    deferred: t('estimates.dec_deferred', 'Deferred'), pending: t('estimates.dec_pending', 'Pending'),
  }[l.customer_status] || l.customer_status;
  return (
    <span className={`es-dec es-dec-${l.customer_status}`}>
      {label}
      {l.line_type === 'parts' && l.customer_status === 'approved' && l.part_option
        ? ` · ${categoryLabel(t, l.part_option)}${Number(l.alternative_approved) === 1 ? ` (${t('estimates.alt_lower', 'alternative')})` : ''}` : ''}
      {l.response_channel === 'in_person' && l.customer_status !== 'pending' ? ` ${t('estimates.in_person', '(in person)')}` : ''}
    </span>
  );
}

/**
 * Store, Step 5: for each category the customer asked for — available or
 * not, the price, and the delivery (in stock / expected date); the quantity
 * the Store can supply (one for every category); and, when a requested
 * category is not available, an optional alternative category for the
 * customer to approve.
 */
function PartPricingEditor({ t, estimateId, line, pref, onSaved, onCancel }) {
  const str = v => (v === null || v === undefined || v === '' ? '' : String(Number(v)));
  const [cats, setCats] = useState(() => Object.fromEntries(pref.map(c => {
    const col = catCols(c);
    const na = line[col.available] !== null && line[col.available] !== undefined && Number(line[col.available]) === 0;
    const date = line[col.expected] ? String(line[col.expected]).slice(0, 10) : '';
    return [c, { avail: na ? 'no' : 'yes', price: str(line[col.price]), when: date ? 'date' : 'stock', date }];
  })));
  const others = PART_CATEGORIES.filter(c => !pref.includes(c));
  const oldAlt = line.alternative_option && others.includes(line.alternative_option) ? line.alternative_option : null;
  const altCol = c => catCols(c);
  const [alt, setAlt] = useState(() => ({
    on: !!oldAlt,
    option: oldAlt || others[0] || '',
    for: line.alternative_for && pref.includes(line.alternative_for) ? line.alternative_for : '',
    price: oldAlt ? str(line[altCol(oldAlt).price]) : '',
    when: oldAlt && line[altCol(oldAlt).expected] ? 'date' : 'stock',
    date: oldAlt && line[altCol(oldAlt).expected] ? String(line[altCol(oldAlt).expected]).slice(0, 10) : '',
  }));
  const [qty, setQty] = useState(str(line.quantity) || '1');
  const [partNo, setPartNo] = useState(line.part_number || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const unavailable = pref.filter(c => cats[c].avail === 'no');
  const canOffer = unavailable.length > 0 && others.length > 0;
  const setCat = (c, patch) => setCats(prev => ({ ...prev, [c]: { ...prev[c], ...patch } }));

  async function save() {
    const body = { part_number: partNo.trim() || undefined };
    for (const c of pref) {
      const s = cats[c];
      const col = catCols(c);
      if (s.avail === 'no') { body[col.available] = false; body[col.price] = null; body[col.expected] = null; continue; }
      if (s.price.trim() === '' || !(Number(s.price) >= 0)) {
        setErr(t('estimates.err_cat_price', 'Enter the {{cat}} price, or mark it not available.', { cat: categoryLabel(t, c) })); return;
      }
      if (s.when === 'date' && !s.date) { setErr(t('estimates.err_cat_date', 'Enter the expected delivery date for {{cat}}, or choose In stock.', { cat: categoryLabel(t, c) })); return; }
      body[col.available] = true; body[col.price] = Number(s.price); body[col.expected] = s.when === 'date' ? s.date : null;
    }
    if (!(Number(qty) > 0)) { setErr(t('estimates.err_qty_store', 'The quantity must be more than zero.')); return; }
    if (Number(qty) !== Number(line.quantity)) body.quantity = Number(qty);
    if (canOffer && alt.on) {
      if (alt.price.trim() === '' || !(Number(alt.price) >= 0)) { setErr(t('estimates.err_alt_price', 'Enter the alternative’s price.')); return; }
      if (alt.when === 'date' && !alt.date) { setErr(t('estimates.err_alt_date', 'Enter the alternative’s expected delivery date, or choose In stock.')); return; }
      body.alternative = { option: alt.option, for: unavailable.includes(alt.for) ? alt.for : unavailable[0], price: Number(alt.price), expected_date: alt.when === 'date' ? alt.date : null };
    } else if (oldAlt) {
      body.alternative = null;
    }
    setSaving(true); setErr('');
    try {
      const res = await api.patch(`/estimates/${estimateId}/lines/${line.id}/pricing`, body);
      if (!res.success) {
        setErr(res.status === 403 ? t('estimates.err_price_403', 'Only the Storekeeper or a manager can price parts.') : (res.message || t('estimates.err_generic', 'That did not work')));
        return;
      }
      onSaved(res);
    } catch {
      setErr(t('estimates.err_network', 'Network error — please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="es-priceEd">
      <div className="es-priceEdHead"><Label width={14} height={14} /> {t('estimates.store_price_cat', 'Store price — the customer asked for {{cats}}', { cats: categoryWords(t, pref) })}</div>
      {pref.map(c => {
        const s = cats[c];
        const label = categoryLabel(t, c);
        return (
          <div key={c} className="es-catRow">
            <div className="es-catName">{label}</div>
            <div className="es-priceField">
              <span>{t('estimates.availability', 'Availability')}</span>
              <select className="es-input es-inputSm" value={s.avail} onChange={ev => setCat(c, { avail: ev.target.value })} aria-label={`${label} — ${t('estimates.availability', 'Availability')}`}>
                <option value="yes">{t('estimates.available', 'Available')}</option>
                <option value="no">{t('estimates.not_available_short', 'Not available')}</option>
              </select>
            </div>
            {s.avail === 'yes' && (
              <>
                <div className="es-priceField">
                  <span>{t('estimates.unit_price', 'Price (each)')}</span>
                  <input className="es-input es-inputSm" type="number" min="0" step="0.01" inputMode="decimal" placeholder="AED"
                    value={s.price} onChange={ev => setCat(c, { price: ev.target.value })} aria-label={`${label} — ${t('estimates.unit_price', 'Price (each)')}`} />
                </div>
                <DeliveryField t={t} label={label} value={s.when} date={s.date} onWhen={v => setCat(c, { when: v })} onDate={v => setCat(c, { date: v })} />
              </>
            )}
          </div>
        );
      })}

      <div className="es-priceEdFields">
        <div className="es-priceField">
          <span>{t('estimates.qty_store', 'Quantity')}</span>
          <input className="es-input es-inputSm es-inputQty" type="number" min="0" step="1" inputMode="decimal" value={qty} onChange={ev => setQty(ev.target.value)} />
        </div>
        <div className="es-priceField">
          <span>{t('estimates.part_no', 'Part no.')}</span>
          <input className="es-input es-inputSm es-inputPn" value={partNo} onChange={ev => setPartNo(ev.target.value)} />
        </div>
      </div>

      {canOffer && (
        <div className="es-altBox">
          <label className="es-naChk">
            <input type="checkbox" checked={alt.on} onChange={ev => setAlt(a => ({ ...a, on: ev.target.checked }))} />
            {t('estimates.offer_alt', 'Offer an alternative — the customer has to approve it')}
          </label>
          {alt.on && (
            <div className="es-priceEdFields">
              <div className="es-priceField">
                <span>{t('estimates.alt_category', 'Alternative')}</span>
                <select className="es-input es-inputSm" value={alt.option} onChange={ev => setAlt(a => ({ ...a, option: ev.target.value }))} aria-label={t('estimates.alt_category', 'Alternative')}>
                  {others.map(c => <option key={c} value={c}>{categoryLabel(t, c)}</option>)}
                </select>
              </div>
              {unavailable.length > 1 && (
                <div className="es-priceField">
                  <span>{t('estimates.alt_instead_of', 'Instead of')}</span>
                  <select className="es-input es-inputSm" value={unavailable.includes(alt.for) ? alt.for : unavailable[0]} onChange={ev => setAlt(a => ({ ...a, for: ev.target.value }))} aria-label={t('estimates.alt_instead_of', 'Instead of')}>
                    {unavailable.map(c => <option key={c} value={c}>{categoryLabel(t, c)}</option>)}
                  </select>
                </div>
              )}
              <div className="es-priceField">
                <span>{t('estimates.unit_price', 'Price (each)')}</span>
                <input className="es-input es-inputSm" type="number" min="0" step="0.01" inputMode="decimal" placeholder="AED"
                  value={alt.price} onChange={ev => setAlt(a => ({ ...a, price: ev.target.value }))} aria-label={`${t('estimates.alt_category', 'Alternative')} — ${t('estimates.unit_price', 'Price (each)')}`} />
              </div>
              <DeliveryField t={t} label={t('estimates.alt_category', 'Alternative')} value={alt.when} date={alt.date}
                onWhen={v => setAlt(a => ({ ...a, when: v }))} onDate={v => setAlt(a => ({ ...a, date: v }))} />
            </div>
          )}
        </div>
      )}

      <div className="es-priceActions">
        {onCancel && <button type="button" className="es-btn es-btnGhost es-btnSm" disabled={saving} onClick={onCancel}>{t('estimates.cancel', 'Cancel')}</button>}
        <button type="button" className="es-btn es-btnSm" disabled={saving} onClick={save}>
          <Check width={14} height={14} /> {saving ? t('estimates.saving', 'Saving…') : t('estimates.save', 'Save')}
        </button>
      </div>
      {err && <div className="es-priceErr">{err}</div>}
    </div>
  );
}

/** In stock, or expected on a date. */
function DeliveryField({ t, label, value, date, onWhen, onDate }) {
  return (
    <div className="es-priceField">
      <span>{t('estimates.delivery', 'Delivery')}</span>
      <div className="es-deliv">
        <select className="es-input es-inputSm" value={value} onChange={ev => onWhen(ev.target.value)} aria-label={`${label} — ${t('estimates.delivery', 'Delivery')}`}>
          <option value="stock">{t('estimates.in_stock_cap', 'In stock')}</option>
          <option value="date">{t('estimates.expected_cap', 'Expected on…')}</option>
        </select>
        {value === 'date' && (
          <input className="es-input es-inputSm" type="date" value={date} onChange={ev => onDate(ev.target.value)} aria-label={`${label} — ${t('estimates.expected_date', 'Expected date')}`} />
        )}
      </div>
    </div>
  );
}

function Shell({ children, onClose }) {
  const { t } = useTranslation();
  return (
    <div className="es-overlay" onClick={onClose}>
      <div className="es-modal" onClick={ev => ev.stopPropagation()}>
        <button className="es-close" onClick={onClose} aria-label={t('estimates.close', 'Close')}><Xmark width={18} height={18} /></button>
        {children}
      </div>
    </div>
  );
}

function ago(ts, t) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return t('estimates.just_now', 'just now');
  if (mins < 60) return t('estimates.m_ago', '{{n}}m ago', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('estimates.h_ago', '{{n}}h ago', { n: hrs });
  const days = Math.floor(hrs / 24);
  return days === 1 ? t('estimates.yesterday', 'yesterday') : t('estimates.d_ago', '{{n}}d ago', { n: days });
}
