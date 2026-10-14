/**
 * EstimateApproval — public, no-login page a customer reaches from the
 * "Review and approve" link in the estimate email or WhatsApp message
 * (routes/estimates.js POST /:id/send). Mirrors CustomerSurveyPublic.jsx's
 * shape: plain fetch against /api/public/..., no auth headers, its own small
 * CSS file. Most customers open it on a phone, from WhatsApp.
 *
 * The interaction is per line, not one "approve the estimate" button,
 * because that is what the backend actually models (estimate_lines.
 * customer_status) and what the workshop asked for: a customer can accept
 * the labour and decline a part, or vice versa. The job card is created
 * automatically the moment every line has been decided and none were
 * rejected — this page just reflects that back; it has no "create job card"
 * action of its own to keep in sync with the server's own rollup.
 *
 * Lines are grouped by job (process Step 4). The estimate's format decides
 * how parts are shown (Step 5/6): Format 1 Genuine and Format 2 After-Market
 * show one price; Format 3 shows both side by side and the customer picks a
 * type for each part — sent as part_option with the approval.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './EstimateApproval.css';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const fmt = n => `AED ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const isNA = v => v !== null && v !== undefined && v !== '' && Number(v) === 0;
const jobKey = l => String(l.job_name || l.description || 'Job').trim() || 'Job';
const qtyOf = l => Number(l.quantity) || 1;
const discOf = l => 1 - Number(l.discount_pct || 0) / 100;
const lineAmount = l => Number(l.line_total ?? qtyOf(l) * Number(l.unit_price || 0) * discOf(l));

function prices(l) {
  const gNA = isNA(l.genuine_available);
  const aNA = isNA(l.aftermarket_available);
  return { g: gNA ? null : num(l.genuine_price), a: aNA ? null : num(l.aftermarket_price) };
}
/** The type a part line counts at in a single-type format (falls back when one is unavailable). */
function effectiveOption(l, format) {
  const { g, a } = prices(l);
  if (g == null && a == null) return null;
  const want = l.part_option || (format === 'after_market' ? 'after_market' : 'genuine');
  if (want === 'after_market') return a != null ? 'after_market' : 'genuine';
  return g != null ? 'genuine' : 'after_market';
}

export default function EstimateApproval() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | ready | invalid | expired | error
  const [estimate, setEstimate] = useState(null);
  const [lines, setLines] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [byType, setByType] = useState(null);
  const [choice, setChoice] = useState({}); // lineId → 'genuine' | 'after_market'
  const [busyLineId, setBusyLine] = useState(null);
  const [banner, setBanner] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/public/estimates/${token}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 410) { setPhase('expired'); return; }
      if (!res.ok || !json.success) { setPhase('invalid'); return; }
      setEstimate(json.estimate);
      setLines(json.lines || []);
      setJobs(json.jobs || []);
      setByType(json.totals_by_type || null);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const format = estimate?.estimate_format || 'genuine';
  const isBoth = format === 'both';
  const hasParts = lines.some(l => l.line_type === 'parts');

  /** The type the customer has picked (or would get) for a part line. */
  const selectedOf = useCallback(l => {
    const { g, a } = prices(l);
    const pick = choice[l.id] || l.part_option;
    if (pick === 'after_market' && a != null) return 'after_market';
    if (pick === 'genuine' && g != null) return 'genuine';
    return g != null ? 'genuine' : a != null ? 'after_market' : null;
  }, [choice]);

  /** What a line costs as things stand (pending Format 3 parts: at the chosen type). */
  const amountOf = useCallback(l => {
    if (isBoth && l.line_type === 'parts' && l.customer_status === 'pending') {
      const { g, a } = prices(l);
      const sel = selectedOf(l);
      const p = sel === 'after_market' ? a : sel === 'genuine' ? g : null;
      if (p != null) return qtyOf(l) * p * discOf(l);
    }
    return lineAmount(l);
  }, [isBoth, selectedOf]);

  const groups = useMemo(() => {
    const by = new Map();
    for (const l of lines) {
      const k = jobKey(l);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(l);
    }
    return [...by.entries()];
  }, [lines]);
  const jobInfo = useMemo(() => new Map(jobs.map(j => [j.job, j])), [jobs]);

  const pendingCount = lines.filter(l => l.customer_status === 'pending').length;
  const anyRejected = lines.some(l => l.customer_status === 'rejected');
  const vatRate = Number(estimate?.vat_rate || 0);
  // What the customer actually agreed to — the header totals are the quote
  // and still include every line they rejected. Discount lines are left out
  // to match how the quote totals are computed.
  const approvedTotal = useMemo(() => {
    const sub = lines
      .filter(l => l.customer_status === 'approved' && l.line_type !== 'discount')
      .reduce((s, l) => s + lineAmount(l), 0);
    return sub * (1 + vatRate / 100);
  }, [lines, vatRate]);
  // Format 3: everything not rejected, parts at the type picked.
  const selectionSub = useMemo(() => lines
    .filter(l => l.line_type !== 'discount' && l.customer_status !== 'rejected')
    .reduce((s, l) => s + amountOf(l), 0), [lines, amountOf]);
  const jobCardCreated = estimate?.work_order_id != null;
  const canDecide = !jobCardCreated && !['expired', 'converted'].includes(estimate?.status);

  async function decide(line, decision) {
    setBusyLine(line.id);
    setBanner('');
    try {
      const body = {
        decision,
        name: name.trim() || undefined,
        reason: decision === 'rejected' ? (reason.trim() || undefined) : undefined,
      };
      if (decision === 'approved' && isBoth && line.line_type === 'parts') {
        const sel = selectedOf(line);
        if (sel) body.part_option = sel;
      }
      const res = await fetch(`${API_BASE}/public/estimates/${token}/lines/${line.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setBanner(json.message || t('estimates.pub_err_decide', 'Could not record your decision. Please try again.'));
        // 409: the estimate became a job card while this page was open —
        // reload so the page shows that instead of live buttons.
        if (res.status === 409) await load();
        return;
      }
      if (json.added_to_job) {
        // The car is already in the workshop: the work joins its job card
        setBanner(t('estimates.pub_all_approved_added', 'All items approved — thank you. The workshop will start the work.'));
      } else if (json.work_order_created) {
        setBanner(t('estimates.pub_all_approved', 'All items approved — job card {{n}} has been created. The workshop will be in touch.', { n: json.work_order_number }));
      }
      await load();
    } catch {
      setBanner(t('estimates.pub_err_network', 'Network error — please try again.'));
    } finally {
      setBusyLine(null);
    }
  }

  if (phase === 'loading') {
    return <div className="ea-page"><div className="ea-card ea-center"><div className="ea-spinner" aria-hidden />{t('estimates.pub_loading', 'Loading your estimate…')}</div></div>;
  }
  if (phase === 'invalid') {
    return <div className="ea-page"><div className="ea-card ea-center">
      <h1>{t('estimates.pub_invalid_title', 'Link not found')}</h1>
      <p>{t('estimates.pub_invalid_body', "This approval link isn't valid. Please contact the workshop for a new one.")}</p>
    </div></div>;
  }
  if (phase === 'expired') {
    return <div className="ea-page"><div className="ea-card ea-center">
      <h1>{t('estimates.pub_expired_title', 'This link has expired')}</h1>
      <p>{t('estimates.pub_expired_body', 'Ask the workshop to resend your estimate.')}</p>
    </div></div>;
  }
  if (phase === 'error') {
    return <div className="ea-page"><div className="ea-card ea-center">
      <h1>{t('estimates.pub_error_title', 'Something went wrong')}</h1>
      <p>{t('estimates.pub_error_body', 'Please refresh the page, or contact the workshop directly.')}</p>
    </div></div>;
  }

  const typeName = k => (k === 'after_market' ? t('estimates.pub_after_market', 'After-Market') : t('estimates.pub_genuine', 'Genuine'));
  // Everything not rejected, parts at the type chosen (Format 3) or quoted (Formats 1/2), incl. VAT.
  const runningTotal = selectionSub * (1 + vatRate / 100);

  return (
    <div className="ea-page">
      <div className="ea-card">
        <div className="ea-header">
          <div className="ea-brand">Pioneer Car Service Center</div>
          <h1>{t('estimates.pub_estimate_n', 'Estimate {{n}}', { n: estimate.estimate_number })}</h1>
          <div className="ea-meta">
            {estimate.customer_name && <span>{estimate.customer_name}</span>}
            {estimate.vehicle_plate && <span className="ea-plate">{estimate.vehicle_plate}</span>}
          </div>
          {hasParts && (
            <div className={`ea-format ea-format-${format}`}>
              {isBoth
                ? t('estimates.pub_format_both', 'Genuine and After-Market prices — you choose for each part')
                : format === 'after_market'
                  ? t('estimates.pub_format_am', 'Priced with After-Market parts')
                  : t('estimates.pub_format_genuine', 'Priced with Genuine parts')}
            </div>
          )}
        </div>

        {jobCardCreated && (
          <div className="ea-banner ea-banner-ok">
            {t('estimates.pub_jc_created', 'Every item has been decided. Job card created — the workshop has been notified and will begin work.')}
          </div>
        )}
        {!jobCardCreated && estimate.status === 'rejected' && (
          <div className="ea-banner ea-banner-warn">
            {t('estimates.pub_rejected', "You've declined this estimate. No job card was created. Contact the workshop if you'd like to discuss it.")}
          </div>
        )}
        {!jobCardCreated && estimate.status === 'partially_approved' && (
          <div className="ea-banner ea-banner-info">
            {t('estimates.pub_partial', 'Thank you — every item has been decided. The workshop has been notified and will confirm the approved work with you before it begins.')}
          </div>
        )}
        {banner && !jobCardCreated && <div className="ea-banner ea-banner-info" role="status">{banner}</div>}

        {isBoth && hasParts && byType && (
          <div className="ea-compare">
            <div className="ea-compare-tile">
              <span className="ea-compare-label">{t('estimates.pub_all_genuine', 'All Genuine')}</span>
              <span className="ea-compare-amt">{fmt(byType.genuine)}</span>
              <span className="ea-compare-sub">{t('estimates.pub_excl_vat', 'excl. VAT')}</span>
            </div>
            <div className="ea-compare-tile">
              <span className="ea-compare-label">{t('estimates.pub_all_am', 'All After-Market')}</span>
              <span className="ea-compare-amt">{fmt(byType.after_market)}</span>
              <span className="ea-compare-sub">{t('estimates.pub_excl_vat', 'excl. VAT')}</span>
            </div>
          </div>
        )}

        {pendingCount > 0 && canDecide && (
          <p className="ea-instructions">
            {isBoth && hasParts
              ? t('estimates.pub_instructions_both', 'For each part, choose Genuine or After-Market, then approve or reject each item. Work only begins once every item has been decided.')
              : t('estimates.pub_instructions', 'Please review each item below and approve or reject it. Work only begins once every item has been decided.')}
          </p>
        )}

        {canDecide && pendingCount > 0 && (
          <div className="ea-fields">
            <label className="ea-name-field">
              {t('estimates.pub_name', 'Your name (optional, for our records)')}
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t('estimates.pub_name_ph', 'Full name')} autoComplete="name" />
            </label>
            <label className="ea-name-field">
              {t('estimates.pub_reason', 'If you reject anything, please tell us why (optional)')}
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder={t('estimates.pub_reason_ph', 'e.g. too expensive, will do it later')} maxLength={500} />
            </label>
          </div>
        )}

        {groups.map(([job, rows]) => {
          const info = jobInfo.get(job);
          const multi = rows.length > 1 || rows.some(l => l.job_name);
          const jobSub = rows.filter(l => l.line_type !== 'discount' && l.customer_status !== 'rejected').reduce((s, l) => s + amountOf(l), 0);
          return (
            <section key={job} className="ea-job">
              {multi && (
                <div className="ea-job-head">
                  <h2 className="ea-job-title">{job}</h2>
                  {isBoth && info && rows.some(l => l.line_type === 'parts') ? (
                    <div className="ea-job-totals">
                      <span>{t('estimates.pub_genuine', 'Genuine')} <b>{fmt(info.total_genuine)}</b>{info.genuine_na && <i className="ea-na-dot" title={t('estimates.pub_some_na', 'Some parts not available in this type')}>*</i>}</span>
                      <span>{t('estimates.pub_after_market', 'After-Market')} <b>{fmt(info.total_after_market)}</b>{info.after_market_na && <i className="ea-na-dot" title={t('estimates.pub_some_na', 'Some parts not available in this type')}>*</i>}</span>
                    </div>
                  ) : (
                    <div className="ea-job-totals"><span><b>{fmt(jobSub)}</b></span></div>
                  )}
                </div>
              )}
              {rows.map(l => (
                <LineCard key={l.id} t={t} line={l} isBoth={isBoth} format={format}
                  selected={l.line_type === 'parts' ? selectedOf(l) : null}
                  onSelect={opt => setChoice(c => ({ ...c, [l.id]: opt }))}
                  typeName={typeName} canDecide={canDecide}
                  busy={busyLineId === l.id} anyBusy={busyLineId != null}
                  onDecide={d => decide(l, d)} />
              ))}
            </section>
          );
        })}

        <div className="ea-totals">
          {isBoth ? (
            <>
              <div><span>{anyRejected ? t('estimates.pub_selection_excl_rej', 'Your selection, without rejected items') : t('estimates.pub_selection', 'Your selection')}</span><span>{fmt(selectionSub)}</span></div>
              <div><span>{t('estimates.pub_vat', 'VAT ({{v}}%)', { v: vatRate })}</span><span>{fmt(selectionSub * vatRate / 100)}</span></div>
              <div className="ea-total-grand"><span>{t('estimates.pub_your_total', 'Your total (incl. VAT)')}</span><span>{fmt(selectionSub * (1 + vatRate / 100))}</span></div>
              {lines.some(l => l.customer_status === 'approved') && pendingCount > 0 && (
                <div className="ea-total-approved"><span>{t('estimates.pub_approved_so_far', 'Approved so far (incl. VAT)')}</span><span>{fmt(approvedTotal)}</span></div>
              )}
            </>
          ) : (
            <>
              <div><span>{t('estimates.pub_sub_labour', 'Subtotal — labour')}</span><span>{fmt(estimate.subtotal_labour)}</span></div>
              <div><span>{t('estimates.pub_sub_parts', 'Subtotal — parts')}</span><span>{fmt(estimate.subtotal_parts)}</span></div>
              {Number(estimate.subtotal_sublet) > 0 && (
                <div><span>{t('estimates.pub_sub_sublet', 'Subtotal — sublet')}</span><span>{fmt(estimate.subtotal_sublet)}</span></div>
              )}
              <div><span>{t('estimates.pub_vat', 'VAT ({{v}}%)', { v: vatRate })}</span><span>{fmt(estimate.vat_amount)}</span></div>
              <div className={anyRejected ? undefined : 'ea-total-grand'}><span>{anyRejected ? t('estimates.pub_quoted_total', 'Quoted total') : t('estimates.pub_total', 'Total')}</span><span>{fmt(estimate.total_amount)}</span></div>
              {anyRejected && (
                <div className="ea-total-grand"><span>{t('estimates.pub_approved_total', 'Approved total (incl. VAT)')}</span><span>{fmt(approvedTotal)}</span></div>
              )}
            </>
          )}
        </div>

        {estimate.valid_until && (
          <p className="ea-valid">{t('estimates.pub_valid_until', 'Prices valid until {{d}}', { d: new Date(estimate.valid_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>
        )}
      </div>

      {pendingCount > 0 && canDecide && (
        <div className="ea-sticky" role="status">
          <span>{pendingCount === 1
            ? t('estimates.pub_left_one', '1 item still needs your decision')
            : t('estimates.pub_left_n', '{{n}} items still need your decision', { n: pendingCount })}</span>
          <b>{fmt(runningTotal)}</b>
        </div>
      )}
    </div>
  );
}

function LineCard({ t, line: l, isBoth, format, selected, onSelect, typeName, canDecide, busy, anyBusy, onDecide }) {
  const isPart = l.line_type === 'parts';
  const pending = l.customer_status === 'pending';
  const qty = qtyOf(l);
  const { g, a } = isPart ? prices(l) : { g: null, a: null };
  const showChoice = isBoth && isPart && pending && canDecide && (g != null || a != null);
  const eff = isPart ? (isBoth ? (l.part_option || null) : effectiveOption(l, format)) : null;
  const fallback = isPart && !isBoth && eff && eff !== (format === 'after_market' ? 'after_market' : 'genuine');

  return (
    <div className={`ea-line ea-line-${l.customer_status}`}>
      <div className="ea-line-top">
        <div className="ea-line-main">
          <div className="ea-line-desc">
            {l.description}
            {qty > 1 && <span className="ea-line-qty"> × {qty}</span>}
          </div>
          <div className="ea-line-tags">
            <span className="ea-tag ea-tag-type">{{
              labour: t('estimates.pub_type_labour', 'Labour'), parts: t('estimates.pub_type_parts', 'Part'),
              sublet: t('estimates.pub_type_sublet', 'Sublet'), consumable: t('estimates.pub_type_consumable', 'Consumables'),
              discount: t('estimates.pub_type_discount', 'Discount'),
            }[l.line_type] || l.line_type}</span>
            {eff && !showChoice && <span className={`ea-tag ea-tag-${eff}`}>{typeName(eff)}</span>}
            {fallback && <span className="ea-tag ea-tag-muted">{t('estimates.pub_other_na', '{{type}} not available', { type: typeName(format === 'after_market' ? 'after_market' : 'genuine') })}</span>}
            {l.urgency === 'now' && <span className="ea-tag ea-tag-urgent">{t('estimates.pub_urgent', 'Needs attention')}</span>}
          </div>
        </div>
        {!showChoice && <div className="ea-line-price">{fmt(lineAmount(l))}</div>}
      </div>

      {showChoice && (
        <div className="ea-opts" role="radiogroup" aria-label={t('estimates.pub_choose_type', 'Choose the part type')}>
          {[['genuine', g], ['after_market', a]].map(([key, price]) => {
            const na = price == null;
            const on = selected === key;
            return (
              <label key={key} className={`ea-opt${on ? ' ea-opt-on' : ''}${na ? ' ea-opt-na' : ''}`}>
                <input type="radio" name={`opt-${l.id}`} value={key} checked={on} disabled={na || busy}
                  onChange={() => onSelect(key)} />
                <span className="ea-opt-radio" aria-hidden />
                <span className="ea-opt-label">{typeName(key)}</span>
                {na ? (
                  <span className="ea-opt-unavail">{t('estimates.pub_not_available', 'Not available')}</span>
                ) : (
                  <>
                    <span className="ea-opt-price">{fmt(price * qty * discOf(l))}</span>
                    {qty > 1 && <span className="ea-opt-each">{t('estimates.pub_each', '{{p}} each', { p: fmt(price) })}</span>}
                  </>
                )}
              </label>
            );
          })}
        </div>
      )}

      {pending && canDecide ? (
        <div className="ea-line-actions">
          <button className="ea-btn ea-btn-reject" disabled={anyBusy} onClick={() => onDecide('rejected')}>
            {busy ? '…' : t('estimates.pub_reject', 'Reject')}
          </button>
          <button className="ea-btn ea-btn-approve" disabled={anyBusy} onClick={() => onDecide('approved')}>
            {busy ? '…' : showChoice && selected
              ? t('estimates.pub_approve_type', 'Approve {{type}}', { type: typeName(selected) })
              : t('estimates.pub_approve', 'Approve')}
          </button>
        </div>
      ) : !pending ? (
        <div className={`ea-decided ea-decided-${l.customer_status}`}>
          {l.customer_status === 'approved' ? t('estimates.pub_approved', '✓ Approved')
            : l.customer_status === 'rejected' ? t('estimates.pub_rejected_line', '✕ Rejected')
            : t('estimates.pub_deferred', 'Deferred')}
        </div>
      ) : null}
    </div>
  );
}
