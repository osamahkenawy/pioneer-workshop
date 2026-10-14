/**
 * Estimates — the staff side of the estimate pipeline.
 *
 * Until this screen existed the backend pipeline was complete but nobody
 * could reach it: drafts were stranded, a partially approved estimate sat
 * unseen, and convert-to-job-card was never called from the UI.
 *
 * Organised around who has to act next (process steps 4–6):
 *   Parts to price  — the Store prices each part line Genuine and After-Market
 *                     (or marks a type N/A); only for users who may price parts
 *   Needs approval  — an external customer's estimate waiting for a
 *                     supervisor / workshop manager to sign it off
 *   With customer   — sent, waiting for the customer's line decisions
 *   To convert      — the customer approved some or all lines; open the job card
 * and the history: drafts, converted, rejected.
 *
 * The detail shows the price per job — labour, Genuine parts, After-Market
 * parts, Total Genuine, Total After-Market — and is sent in one of three
 * formats (1 Genuine, 2 After-Market, 3 both, customer chooses per part) by
 * email or WhatsApp.
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
  mayPriceParts, summarisePricing, partPrices, partUnpriced, effectiveOption, jobKeyOf, isNA,
  SendEstimatePanel, CopyButton,
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

const FORMAT_LABEL = {
  genuine: 'Format 1 — Genuine',
  after_market: 'Format 2 — After-Market',
  both: 'Format 3 — Both, customer chooses',
};

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
  const [storeCount, setStoreCount] = useState(0);
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
      if (view === 'parts_to_price') {
        const [q, c] = await Promise.all([
          api.get('/workflow/store/queue'),
          api.get('/estimates?limit=1').catch(() => null),
        ]);
        if (req !== reqRef.current) return;
        const list = q?.success ? (q.data?.estimates || []) : [];
        setStoreCount(list.length);
        const s = search.trim().toLowerCase();
        setRows(s ? list.filter(r => [r.estimate_number, r.customer_name, r.vehicle_plate].some(v => String(v || '').toLowerCase().includes(s))) : list);
        if (c?.success) setCounts(c.counts || {});
      } else {
        const q = new URLSearchParams({ view, limit: '100' });
        if (search.trim()) q.set('search', search.trim());
        const [res, sq] = await Promise.all([
          api.get(`/estimates?${q}`),
          canParts ? api.get('/workflow/store/queue').catch(() => null) : Promise.resolve(null),
        ]);
        if (req !== reqRef.current) return;
        if (res.success) { setRows(res.estimates || []); setCounts(res.counts || {}); }
        if (sq?.success) setStoreCount((sq.data?.estimates || []).length);
      }
    } catch { /* the empty state covers it */ }
    finally { if (req === reqRef.current) setLoading(false); }
  }, [view, search, canParts]);

  useEffect(() => { const tm = setTimeout(load, search ? 300 : 0); return () => clearTimeout(tm); }, [load, search]);

  // Land on the queue that needs someone first, once, when nothing is open.
  useEffect(() => {
    if (counts.needs_approval > 0 && view === 'with_customer' && !rows.length && !loading) setView('needs_approval');
  }, [counts]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = id => setParams(id ? { id: String(id) } : {});
  const views = VIEWS.filter(v => !v.store || canParts);
  const countOf = key => (key === 'parts_to_price' ? storeCount : counts[key]) ?? 0;

  return (
    <>
      <div className="es-wrap">
        <header className="es-head">
          <div>
            <h1 className="es-title">{t('estimates.title', 'Estimates')}</h1>
            <p className="es-sub">{t('estimates.subtitle', 'Quotes for the customer to approve line by line. The Store prices parts in Genuine and After-Market; an approved estimate becomes the job card.')}</p>
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
                  <div className="es-rowName">{r.customer_name || '—'}</div>
                  <div className="es-rowMeta">{r.vehicle_plate || t('estimates.no_vehicle', 'No vehicle')}</div>
                </div>
                <div className="es-rowLines es-rowStore">
                  <Label width={14} height={14} /> {t('estimates.n_parts_to_price', '{{n}} part(s) to price', { n: Number(r.part_lines) || 0 })}
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

  const format = e.estimate_format || null;
  const summary = summarisePricing(lines);
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
  const waText = link && encodeURIComponent(`Your estimate ${e.estimate_number} from Pioneer Car Service Center is ready. Please review and approve each item here: ${link}`);
  const hiG = format === 'genuine' || format === 'both';
  const hiA = format === 'after_market' || format === 'both';

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
              {format && <span className="es-fmtChip">{t(`estimates.format_label_${format}`, FORMAT_LABEL[format])}</span>}
              {e.intake_work_order_id && !e.work_order_id && (
                <Link to={`/work-orders/${e.intake_work_order_id}`} className="es-woLink">{t('estimates.for_wo_number', 'For job card {{n}}', { n: e.intake_work_order_number || `#${e.intake_work_order_id}` })}</Link>
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
                  ? t('estimates.parts_waiting_store', 'Enter the Genuine and After-Market price for each below, or mark a type N/A.')
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
                <table className="es-jobs">
                  <thead>
                    <tr>
                      <th>{t('estimates.col_job', 'Job')}</th>
                      <th className="es-num">{t('estimates.col_labour', 'Labour')}</th>
                      <th className="es-num">{t('estimates.col_genuine_parts', 'Genuine parts')}</th>
                      <th className="es-num">{t('estimates.col_am_parts', 'After-Market parts')}</th>
                      <th className={`es-num es-colTot${hiG ? ' es-colHi' : ''}`}>{t('estimates.col_total_genuine', 'Total Genuine')}</th>
                      <th className={`es-num es-colTot${hiA ? ' es-colHi' : ''}`}>{t('estimates.col_total_am', 'Total After-Market')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.jobs.map(j => (
                      <tr key={j.job}>
                        <td>
                          <span className="es-jobName">{j.job}</span>
                          {j.waiting > 0 && <span className="es-badge es-badgeWait">{t('estimates.n_waiting_store', '{{n}} waiting for Store', { n: j.waiting })}</span>}
                        </td>
                        <td className="es-num">{aed(j.labour)}</td>
                        <td className="es-num">
                          {!j.parts ? <span className="es-dash">—</span>
                            : j.waiting === j.parts ? <span className="es-waitTxt">{t('estimates.waiting_short', 'Waiting')}</span>
                            : <>{aed(j.genuine_parts)}{j.genuine_na && <NABadge t={t} title={t('estimates.na_genuine_tip', 'Not available in Genuine — the After-Market price is used for that part')} />}</>}
                        </td>
                        <td className="es-num">
                          {!j.parts ? <span className="es-dash">—</span>
                            : j.waiting === j.parts ? <span className="es-waitTxt">{t('estimates.waiting_short', 'Waiting')}</span>
                            : <>{aed(j.after_market_parts)}{j.after_market_na && <NABadge t={t} title={t('estimates.na_am_tip', 'Not available in After-Market — the Genuine price is used for that part')} />}</>}
                        </td>
                        <td className={`es-num es-colTot${hiG ? ' es-colHi' : ''}`}>{aed(j.total_genuine)}</td>
                        <td className={`es-num es-colTot${hiA ? ' es-colHi' : ''}`}>{aed(j.total_after_market)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>{t('estimates.total_excl_vat', 'Total (excl. VAT)')}</td>
                      <td className={`es-num es-colTot${hiG ? ' es-colHi' : ''}`}>{aed(summary.total_genuine)}</td>
                      <td className={`es-num es-colTot${hiA ? ' es-colHi' : ''}`}>{aed(summary.total_after_market)}</td>
                    </tr>
                    <tr className="es-jobsVat">
                      <td colSpan={4}>{t('estimates.total_incl_vat', 'Total incl. {{v}}% VAT', { v: vatRate })}</td>
                      <td className={`es-num es-colTot${hiG ? ' es-colHi' : ''}`}>{aed(summary.total_genuine * (1 + vatRate / 100))}</td>
                      <td className={`es-num es-colTot${hiA ? ' es-colHi' : ''}`}>{aed(summary.total_after_market * (1 + vatRate / 100))}</td>
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
                    <LineRow key={l.id} t={t} estimateId={e.id} line={l} format={format}
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
            {format === 'both' && <p className="es-totNote">{t('estimates.both_note', 'Parts count at the Genuine price until the customer chooses.')}</p>}
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
function LineRow({ t, estimateId, line: l, format, canDecide, busy, onDecide, pricingOpen, onPriced }) {
  const isPart = l.line_type === 'parts';
  const waiting = isPart && partUnpriced(l);
  const [editOpen, setEditOpen] = useState(waiting);
  return (
    <>
      <tr className={`es-line-${l.customer_status}${waiting ? ' es-lineWait' : ''}`}>
        <td>
          <div className="es-lineDesc">{l.description}</div>
          <div className="es-lineType">{t(`estimates.type_${l.line_type}`, TYPE_LABEL[l.line_type] || l.line_type)}{l.part_number ? ` · ${l.part_number}` : ''}</div>
          {isPart && <OptionPills t={t} line={l} format={format} />}
          {pricingOpen && !editOpen && (
            <button type="button" className="es-linkBtn" onClick={() => setEditOpen(true)}>
              <Label width={13} height={13} /> {t('estimates.edit_store_price', 'Edit Store price')}
            </button>
          )}
        </td>
        <td className="es-num">{Number(l.quantity)}</td>
        <td className="es-num">{waiting ? <span className="es-dash">—</span> : aed(l.unit_price)}</td>
        <td className="es-num">{waiting ? <span className="es-dash">—</span> : aed(lineTotal(l))}</td>
        <td><DecisionCell t={t} line={l} format={format} canDecide={canDecide} busy={busy} onDecide={onDecide} /></td>
      </tr>
      {pricingOpen && editOpen && (
        <tr className="es-priceRow">
          <td colSpan={5}>
            <PartPricingEditor t={t} estimateId={estimateId} line={l}
              onSaved={res => { setEditOpen(false); onPriced(res); }}
              onCancel={waiting ? null : () => setEditOpen(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Genuine / After-Market prices of a part line; the one it counts at is highlighted. */
function OptionPills({ t, line, format }) {
  if (partUnpriced(line)) {
    return <div className="es-opts"><span className="es-badge es-badgeWait"><Label width={12} height={12} /> {t('estimates.waiting_store', 'Waiting for the Store')}</span></div>;
  }
  const { g, a, gNA, aNA } = partPrices(line);
  if (g == null && a == null && !gNA && !aNA) return null; // priced before Genuine / After-Market existed
  const eff = effectiveOption(line, format);
  const pill = (label, price, na, on) => (
    <span className={`es-opt${on ? ' es-optOn' : ''}${na ? ' es-optNA' : ''}`}>
      {label} <b>{na ? t('estimates.na', 'N/A') : price != null ? aed(price) : '—'}</b>
    </span>
  );
  return (
    <div className="es-opts">
      {pill(t('estimates.genuine', 'Genuine'), g, gNA, eff === 'genuine')}
      {pill(t('estimates.after_market', 'After-Market'), a, aNA, eff === 'after_market')}
      {gNA && aNA && <span className="es-badge es-badgeBad">{t('estimates.not_available', 'Not available')}</span>}
    </div>
  );
}

/** Customer column: the decision, or in-person Approve / Reject (Format 3 parts: pick the type). */
function DecisionCell({ t, line: l, format, canDecide, busy, onDecide }) {
  const isPart = l.line_type === 'parts';
  const p = isPart ? partPrices(l) : { g: null, a: null };
  const choose = isPart && format === 'both' && p.g != null && p.a != null;
  const [opt, setOpt] = useState(l.part_option === 'after_market' ? 'after_market' : 'genuine');

  if (l.customer_status === 'pending' && canDecide) {
    return (
      <div className="es-decideWrap">
        {choose && (
          <div className="es-seg" role="radiogroup" aria-label={t('estimates.part_type', 'Part type')}>
            <button type="button" role="radio" aria-checked={opt === 'genuine'} className={opt === 'genuine' ? 'es-segOn' : ''}
              title={`${t('estimates.genuine', 'Genuine')} ${aed(p.g)}`} onClick={() => setOpt('genuine')}>{t('estimates.genuine', 'Genuine')}</button>
            <button type="button" role="radio" aria-checked={opt === 'after_market'} className={opt === 'after_market' ? 'es-segOn' : ''}
              title={`${t('estimates.after_market', 'After-Market')} ${aed(p.a)}`} onClick={() => setOpt('after_market')}>{t('estimates.after_market_short', 'After-Mkt')}</button>
          </div>
        )}
        <div className="es-decide">
          <button className="es-mini es-miniOk" disabled={!!busy} onClick={() => onDecide(l.id, 'approved', choose ? opt : undefined)}
            title={t('estimates.approved_in_person_tip', 'Customer approved in person')}>
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
      {isPart && l.customer_status === 'approved' && l.part_option
        ? ` · ${l.part_option === 'genuine' ? t('estimates.genuine', 'Genuine') : t('estimates.after_market', 'After-Market')}` : ''}
      {l.response_channel === 'in_person' && l.customer_status !== 'pending' ? ` ${t('estimates.in_person', '(in person)')}` : ''}
    </span>
  );
}

/** Store step 5: Genuine and After-Market price (or N/A) for one part line. */
function PartPricingEditor({ t, estimateId, line, onSaved, onCancel }) {
  const str = v => (v === null || v === undefined || v === '' ? '' : String(Number(v)));
  const [g, setG] = useState(str(line.genuine_price));
  const [gNA, setGNA] = useState(isNA(line.genuine_available));
  const [a, setA] = useState(str(line.aftermarket_price));
  const [aNA, setANA] = useState(isNA(line.aftermarket_available));
  const [partNo, setPartNo] = useState(line.part_number || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const gv = gNA || g.trim() === '' ? null : Number(g);
    const av = aNA || a.trim() === '' ? null : Number(a);
    if (!gNA && gv == null) { setErr(t('estimates.err_g_missing', 'Enter the Genuine price, or mark it N/A.')); return; }
    if (!aNA && av == null) { setErr(t('estimates.err_a_missing', 'Enter the After-Market price, or mark it N/A.')); return; }
    if ((gv != null && !(gv >= 0)) || (av != null && !(av >= 0))) { setErr(t('estimates.err_bad_price', 'Prices must be a number, zero or more.')); return; }
    setSaving(true); setErr('');
    try {
      const res = await api.patch(`/estimates/${estimateId}/lines/${line.id}/pricing`, {
        genuine_price: gv, genuine_available: !gNA,
        aftermarket_price: av, aftermarket_available: !aNA,
        part_number: partNo.trim() || undefined,
      });
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

  const onKey = ev => { if (ev.key === 'Enter') save(); };
  return (
    <div className="es-priceEd">
      <div className="es-priceEdHead"><Label width={14} height={14} /> {t('estimates.store_price', 'Store price')}</div>
      <div className="es-priceEdFields">
        <div className="es-priceField">
          <span>{t('estimates.genuine', 'Genuine')}</span>
          <input className="es-input es-inputSm" type="number" min="0" step="0.01" inputMode="decimal" disabled={gNA}
            placeholder={gNA ? t('estimates.na', 'N/A') : 'AED'} value={gNA ? '' : g} onChange={ev => setG(ev.target.value)} onKeyDown={onKey} />
          <label className="es-naChk"><input type="checkbox" checked={gNA} onChange={ev => setGNA(ev.target.checked)} /> {t('estimates.na', 'N/A')}</label>
        </div>
        <div className="es-priceField">
          <span>{t('estimates.after_market', 'After-Market')}</span>
          <input className="es-input es-inputSm" type="number" min="0" step="0.01" inputMode="decimal" disabled={aNA}
            placeholder={aNA ? t('estimates.na', 'N/A') : 'AED'} value={aNA ? '' : a} onChange={ev => setA(ev.target.value)} onKeyDown={onKey} />
          <label className="es-naChk"><input type="checkbox" checked={aNA} onChange={ev => setANA(ev.target.checked)} /> {t('estimates.na', 'N/A')}</label>
        </div>
        <div className="es-priceField">
          <span>{t('estimates.part_no', 'Part no.')}</span>
          <input className="es-input es-inputSm es-inputPn" value={partNo} onChange={ev => setPartNo(ev.target.value)} onKeyDown={onKey} />
        </div>
        <div className="es-priceActions">
          {onCancel && <button type="button" className="es-btn es-btnGhost es-btnSm" disabled={saving} onClick={onCancel}>{t('estimates.cancel', 'Cancel')}</button>}
          <button type="button" className="es-btn es-btnSm" disabled={saving} onClick={save}>
            <Check width={14} height={14} /> {saving ? t('estimates.saving', 'Saving…') : t('estimates.save', 'Save')}
          </button>
        </div>
      </div>
      {err && <div className="es-priceErr">{err}</div>}
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
