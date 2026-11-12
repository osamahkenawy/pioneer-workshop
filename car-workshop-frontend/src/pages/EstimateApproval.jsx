/**
 * EstimateApproval — public, no-login page a customer reaches from the
 * "Review and approve" link in the estimate email or WhatsApp message
 * (routes/estimates.js POST /:id/send), and from "Review & approve" in the
 * customer portal. Mirrors CustomerSurveyPublic.jsx's shape: plain fetch
 * against /api/public/..., no auth headers, its own small CSS file. Most
 * customers open it on a phone, from WhatsApp.
 *
 * The interaction is per line, not one "approve the estimate" button,
 * because that is what the backend actually models (estimate_lines.
 * customer_status) and what the workshop asked for: a customer can accept
 * the labour and decline a part, or vice versa. The job card is created
 * automatically the moment every line has been decided and none were
 * rejected — this page just reflects that back; it has no "create job card"
 * action of its own to keep in sync with the server's own rollup.
 *
 * Lines are grouped by job (process Step 4). Parts come in the categories of
 * the customer's parts preference (Genuine / After-Market / Used, any
 * combination): each part line carries its `options` from the server — the
 * requested categories (priced, or not available) and, when one is not
 * available, the Store's alternative. With more than one priced option the
 * customer picks one per part; the alternative is shown as "Alternative —
 * needs your approval" and is never preselected. The choice is sent as
 * part_option with the approval; the server refuses an option not on offer.
 *
 * Several at once (client decisions, 3 Nov 2026): "Approve all" / "Reject
 * all", or tick jobs and approve / reject the selection — one request
 * (POST /:token/decide-bulk), the same rules as one line: a part that needs
 * a type chosen, or can only be rejected, is named before anything is sent.
 *
 * A supplementary estimate (SEST-…) is additional work on the job, at a
 * fixed cost — one price per line, nothing to choose. Approving any of it
 * opens the consent step: what is being approved, its fixed cost incl. VAT,
 * the statement to tick ("I agree to the additional work at the fixed cost
 * of AED X") and the customer's name — the server stores it (who, when, the
 * statement, the IP) and checks the cost is still X.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './EstimateApproval.css';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const fmt = n => `AED ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const jobKey = l => String(l.job_name || l.description || 'Job').trim() || 'Job';
const qtyOf = l => Number(l.quantity) || 1;
const discOf = l => 1 - Number(l.discount_pct || 0) / 100;
const lineAmount = l => Number(l.line_total ?? qtyOf(l) * Number(l.unit_price || 0) * discOf(l));
const CATEGORY_EN = { genuine: 'Genuine', after_market: 'After-Market', used: 'Used' };
const fmtDay = d => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
/** 1234.5 → "1,234.50" — the amount exactly as the consent statement gives it (the server words it the same way). */
const consentAmount = n => r2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The options a part line offers (server-computed), or null for a line priced as one price. */
function optionsOf(l) {
  if (l.line_type !== 'parts' || !l.options) return null;
  const requested = l.options.requested || [];
  const alternative = l.options.alternative || null;
  return { requested, alternative, choices: [...requested.filter(o => o.usable), ...(alternative ? [alternative] : [])] };
}

export default function EstimateApproval() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | ready | invalid | expired | error
  const [estimate, setEstimate] = useState(null);
  const [lines, setLines] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [byType, setByType] = useState(null);
  const [choice, setChoice] = useState({}); // lineId → 'genuine' | 'after_market' | 'used'
  const [busyLineId, setBusyLine] = useState(null);
  const [banner, setBanner] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [consents, setConsents] = useState([]);
  // Jobs ticked for a decision together (their pending lines).
  const [picked, setPicked] = useState(() => new Set());
  // A supplementary estimate's approval waiting for consent: { lines, label }.
  const [consentFor, setConsentFor] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

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
      setConsents(json.consents || []);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const pref = useMemo(() => (Array.isArray(estimate?.parts_preference) && estimate.parts_preference.length
    ? estimate.parts_preference : ['genuine']), [estimate]);
  const hasParts = lines.some(l => l.line_type === 'parts');
  const anyAlternative = lines.some(l => optionsOf(l)?.alternative);
  // The customer chooses per part when there is more than one category, or an alternative to take or leave.
  const choosing = hasParts && (pref.length > 1 || anyAlternative);
  const catName = useCallback(k => t(`estimates.pub_cat_${k}`, CATEGORY_EN[k] || k), [t]);

  /** The option picked (or, for a requested category, the one it counts at) for a pending part line. */
  const selectedOf = useCallback(l => {
    const o = optionsOf(l);
    if (!o) return null;
    const pick = choice[l.id];
    if (pick && o.choices.some(c => c.option === pick)) return pick;
    const counted = l.options.counted;
    if (counted && o.requested.some(c => c.usable && c.option === counted)) return counted;
    return o.requested.find(c => c.usable)?.option || null; // never the alternative by default
  }, [choice]);

  /** What approving these lines costs, incl. VAT — each at the price it would be approved at, to the fils, plus VAT: the fixed cost the consent states. */
  const fixedCostOf = useCallback(ls => {
    const sub = ls.filter(l => l.line_type !== 'discount').reduce((sum, l) => {
      const o = optionsOf(l);
      const sel = o ? o.choices.find(c => c.option === selectedOf(l)) : null;
      return sum + r2(qtyOf(l) * (sel ? sel.price : Number(l.unit_price || 0)) * discOf(l));
    }, 0);
    return r2(sub * (1 + Number(estimate?.vat_rate ?? 5) / 100));
  }, [selectedOf, estimate]);

  /** What a line costs as things stand (pending parts: at the option picked). */
  const amountOf = useCallback(l => {
    const o = optionsOf(l);
    if (o && l.customer_status === 'pending') {
      const sel = o.choices.find(c => c.option === selectedOf(l));
      return sel ? qtyOf(l) * sel.price * discOf(l) : 0;
    }
    return lineAmount(l);
  }, [selectedOf]);

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
  // Everything not rejected, parts at the option picked.
  const selectionSub = useMemo(() => lines
    .filter(l => l.line_type !== 'discount' && l.customer_status !== 'rejected')
    .reduce((s, l) => s + amountOf(l), 0), [lines, amountOf]);
  const jobCardCreated = estimate?.work_order_id != null;
  const canDecide = !jobCardCreated && !['expired', 'converted'].includes(estimate?.status);
  const supplementary = estimate?.kind === 'supplementary';
  const consentNeeded = !!estimate?.consent_required;

  /** The consent sent with a supplementary estimate's approval: the statement as shown, its cost, the name. */
  const consentBody = ls => {
    const amount = fixedCostOf(ls);
    return { agreed: true, name: name.trim(), amount, text: consentStatement(amount) };
  };
  const consentStatement = amount => t('estimates.pub_consent_statement',
    'I agree to the additional work at the fixed cost of AED {{amount}} (incl. VAT) — supplementary estimate {{n}}.',
    { amount: consentAmount(amount), n: estimate?.estimate_number });

  /** After a recorded decision: say what happened when the estimate is fully decided, and reload. */
  async function afterDecided(json) {
    if (json.added_to_job) {
      // The car is already in the workshop: the work joins its job card
      setBanner(supplementary
        ? t('estimates.pub_supp_approved_added', 'Thank you — the additional work you approved has been added to your job. The workshop will carry it out.')
        : t('estimates.pub_all_approved_added', 'All items approved — thank you. The workshop will start the work.'));
    } else if (json.work_order_created) {
      setBanner(t('estimates.pub_all_approved', 'All items approved — job card {{n}} has been created. The workshop will be in touch.', { n: json.work_order_number }));
    }
    setPicked(new Set());
    await load();
  }

  /** A refused decision: the server's reason (each line's, when several were sent); 409 reloads the page. */
  async function refused(res, json) {
    const lines = (json.problems || []).map(p => p.message).filter(Boolean);
    setBanner(lines.length > 1 ? `${json.message} ${lines.join(' ')}` : (json.message || t('estimates.pub_err_decide', 'Could not record your decision. Please try again.')));
    // 409: the estimate became a job card while this page was open —
    // reload so the page shows that instead of live buttons.
    if (res.status === 409) await load();
  }

  async function decide(line, decision, consent = null) {
    // A supplementary estimate's approval goes through the consent step first.
    if (decision === 'approved' && consentNeeded && !consent) { askConsent([line]); return; }
    setBusyLine(line.id);
    setBanner('');
    try {
      const body = {
        decision,
        name: name.trim() || undefined,
        reason: decision === 'rejected' ? (reason.trim() || undefined) : undefined,
      };
      if (decision === 'approved' && optionsOf(line)) {
        const sel = selectedOf(line);
        if (sel) body.part_option = sel;
      }
      if (consent) body.consent = consent;
      const res = await fetch(`${API_BASE}/public/estimates/${token}/lines/${line.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) { await refused(res, json); return; }
      setConsentFor(null);
      await afterDecided(json);
    } catch {
      setBanner(t('estimates.pub_err_network', 'Network error — please try again.'));
    } finally {
      setBusyLine(null);
    }
  }

  /**
   * Decide several lines in one request: "Approve all" / "Reject all" (every
   * line still to decide) or the ticked jobs. Approving first checks what
   * cannot be approved as it stands — a part with no type chosen, or with
   * nothing on offer — and names it, rather than sending.
   */
  async function decideMany(decision, ls, consent = null) {
    const targets = ls.filter(l => l.customer_status === 'pending');
    if (!targets.length) return;
    if (decision === 'approved') {
      const stuck = targets.filter(l => optionsOf(l) && !selectedOf(l));
      if (stuck.length) {
        setBanner(t('estimates.pub_bulk_stuck', 'These cannot be approved as they stand — choose the part type, or reject them: {{list}}.',
          { list: stuck.map(l => `“${l.description}”`).join(', ') }));
        return;
      }
      if (consentNeeded && !consent) { askConsent(targets); return; }
    }
    if (targets.length === 1) { await decide(targets[0], decision, consent); return; }
    setBulkBusy(true);
    setBanner('');
    try {
      const part_options = {};
      for (const l of targets) if (decision === 'approved' && optionsOf(l) && selectedOf(l)) part_options[l.id] = selectedOf(l);
      const res = await fetch(`${API_BASE}/public/estimates/${token}/decide-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision, line_ids: targets.map(l => l.id), part_options,
          name: name.trim() || undefined,
          reason: decision === 'rejected' ? (reason.trim() || undefined) : undefined,
          ...(consent ? { consent } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) { await refused(res, json); return; }
      setConsentFor(null);
      await afterDecided(json);
    } catch {
      setBanner(t('estimates.pub_err_network', 'Network error — please try again.'));
    } finally {
      setBulkBusy(false);
    }
  }

  function askConsent(ls) {
    setAgreed(false);
    setBanner('');
    setConsentFor({ lines: ls });
  }
  function confirmConsent() {
    const ls = consentFor?.lines || [];
    if (!agreed || name.trim().length < 2) return;
    const consent = consentBody(ls);
    if (ls.length === 1) decide(ls[0], 'approved', consent);
    else decideMany('approved', ls, consent);
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

  const prefWords = pref.length > 1
    ? t('estimates.pub_cat_list', '{{a}} and {{b}}', { a: pref.slice(0, -1).map(catName).join(', '), b: catName(pref.at(-1)) })
    : catName(pref[0]);
  // Everything not rejected, parts at the option picked (or quoted), incl. VAT.
  const runningTotal = selectionSub * (1 + vatRate / 100);
  const pendingLines = lines.filter(l => l.customer_status === 'pending');
  const pendingOf = rows => rows.filter(l => l.customer_status === 'pending');
  // The pending lines of the ticked jobs.
  const pickedGroups = groups.filter(([job, rows]) => picked.has(job) && pendingOf(rows).length);
  const pickedLines = pickedGroups.flatMap(([, rows]) => pendingOf(rows));
  const togglePick = job => setPicked(prev => { const n = new Set(prev); if (n.has(job)) n.delete(job); else n.add(job); return n; });
  const busyAny = busyLineId != null || bulkBusy;
  // Ticking jobs is worth it when there is more than one to decide.
  const selectable = canDecide && groups.filter(([, rows]) => pendingOf(rows).length).length > 1;

  return (
    <div className="ea-page">
      <div className="ea-card">
        <div className="ea-header">
          <div className="ea-brand">Pioneer Car Service Center</div>
          <h1>{supplementary
            ? t('estimates.pub_supp_n', 'Supplementary estimate {{n}}', { n: estimate.estimate_number })
            : t('estimates.pub_estimate_n', 'Estimate {{n}}', { n: estimate.estimate_number })}</h1>
          <div className="ea-meta">
            {estimate.customer_name && <span>{estimate.customer_name}</span>}
            {estimate.vehicle_plate && <span className="ea-plate">{estimate.vehicle_plate}</span>}
          </div>
          {supplementary && (
            <div className="ea-supp">
              <span className="ea-fixed">{t('estimates.pub_fixed_cost', 'Fixed cost')}</span>
              <span>{estimate.parent_estimate_number
                ? t('estimates.pub_supp_sub', 'Additional work found on your vehicle, beyond estimate {{n}}. Each item has one fixed price; approving it needs your consent.', { n: estimate.parent_estimate_number })
                : t('estimates.pub_supp_sub_plain', 'Additional work found on your vehicle. Each item has one fixed price; approving it needs your consent.')}</span>
            </div>
          )}
          {hasParts && !supplementary && (
            <div className={`ea-format${pref.length > 1 ? ' ea-format-both' : ''}`}>
              {pref.length > 1
                ? t('estimates.pub_pref_many', 'Parts priced in {{cats}} — you choose for each part', { cats: prefWords })
                : t('estimates.pub_pref_one', 'Priced with {{cat}} parts', { cat: prefWords })}
            </div>
          )}
        </div>

        {jobCardCreated && (
          <div className="ea-banner ea-banner-ok">
            {t('estimates.pub_jc_created', 'Every item has been decided. The approved work is on your job card — the workshop has been notified and will begin work.')}
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
        {consents.length > 0 && (
          <div className="ea-banner ea-banner-ok ea-consents">
            {consents.map((c, i) => (
              <div key={i}>{t('estimates.pub_consent_given', 'You agreed to additional work at a fixed cost of AED {{amount}} (incl. VAT) — {{name}}, {{when}}.', {
                amount: consentAmount(c.amount), name: c.name,
                when: c.at ? new Date(String(c.at).replace(' ', 'T')).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '',
              })}</div>
            ))}
          </div>
        )}

        {pref.length > 1 && hasParts && byType && (
          <div className="ea-compare">
            {pref.map(c => (
              <div key={c} className="ea-compare-tile">
                <span className="ea-compare-label">{t('estimates.pub_all_cat', 'All {{cat}}', { cat: catName(c) })}</span>
                <span className="ea-compare-amt">{fmt(byType[c])}</span>
                <span className="ea-compare-sub">
                  {t('estimates.pub_excl_vat', 'excl. VAT')}
                  {jobs.some(j => j.na?.[c]) && ` · ${t('estimates.pub_some_na_short', 'not every part available')}`}
                </span>
              </div>
            ))}
          </div>
        )}

        {pendingCount > 0 && canDecide && (
          <p className="ea-instructions">
            {supplementary
              ? t('estimates.pub_instructions_supp', 'Please review each item and approve or reject it — one at a time, the jobs you tick, or everything at once. To approve, you confirm that you agree to the fixed cost and type your name. No additional work is carried out without your approval.')
              : choosing
              ? t('estimates.pub_instructions_choose', 'For each part, choose the type you want, then approve or reject each item. Where a type you asked for is not available the workshop may offer an alternative — it is only used if you choose it. Work only begins once every item has been decided.')
              : t('estimates.pub_instructions', 'Please review each item below and approve or reject it. Work only begins once every item has been decided.')}
          </p>
        )}

        {canDecide && pendingCount > 0 && (
          <div className="ea-fields">
            <label className="ea-name-field">
              {consentNeeded
                ? t('estimates.pub_name_required', 'Your full name (needed to approve)')
                : t('estimates.pub_name', 'Your name (optional, for our records)')}
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t('estimates.pub_name_ph', 'Full name')} autoComplete="name" />
            </label>
            <label className="ea-name-field">
              {t('estimates.pub_reason', 'If you reject anything, please tell us why (optional)')}
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder={t('estimates.pub_reason_ph', 'e.g. too expensive, will do it later')} maxLength={500} />
            </label>
          </div>
        )}

        {canDecide && pendingCount > 0 && (
          <div className="ea-bulk" role="group" aria-label={t('estimates.pub_bulk_label', 'Decide everything at once')}>
            <span className="ea-bulk-label">{pendingCount === 1
              ? t('estimates.pub_bulk_one', '1 item to decide')
              : t('estimates.pub_bulk_n', '{{n}} items to decide', { n: pendingCount })}</span>
            <div className="ea-bulk-actions">
              <button type="button" className="ea-btn ea-btn-reject" disabled={busyAny} onClick={() => decideMany('rejected', pendingLines)}>
                {pendingCount === 1 ? t('estimates.pub_reject', 'Reject') : t('estimates.pub_reject_all', 'Reject all')}
              </button>
              <button type="button" className="ea-btn ea-btn-approve" disabled={busyAny} onClick={() => decideMany('approved', pendingLines)}>
                {bulkBusy ? '…' : pendingCount === 1 ? t('estimates.pub_approve', 'Approve') : t('estimates.pub_approve_all', 'Approve all')}
              </button>
            </div>
            {selectable && <p className="ea-bulk-hint">{t('estimates.pub_bulk_hint', 'Or tick the jobs you want and approve or reject them together.')}</p>}
          </div>
        )}

        {groups.map(([job, rows]) => {
          const info = jobInfo.get(job);
          const pend = pendingOf(rows).length;
          const multi = rows.length > 1 || rows.some(l => l.job_name) || (selectable && pend > 0);
          const jobSub = rows.filter(l => l.line_type !== 'discount' && l.customer_status !== 'rejected').reduce((s, l) => s + amountOf(l), 0);
          return (
            <section key={job} className={`ea-job${picked.has(job) ? ' ea-job-picked' : ''}`}>
              {multi && (
                <div className="ea-job-head">
                  {selectable && pend > 0 ? (
                    <label className="ea-job-pick">
                      <input type="checkbox" checked={picked.has(job)} disabled={busyAny} onChange={() => togglePick(job)} />
                      <h2 className="ea-job-title">{job}</h2>
                    </label>
                  ) : <h2 className="ea-job-title">{job}</h2>}
                  {pref.length > 1 && info?.totals && rows.some(l => l.line_type === 'parts') ? (
                    <div className="ea-job-totals">
                      {pref.map(c => (
                        <span key={c}>{catName(c)} <b>{fmt(info.totals[c])}</b>{info.na?.[c] && <i className="ea-na-dot" title={t('estimates.pub_some_na', 'Some parts not available in this type')}>*</i>}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="ea-job-totals"><span><b>{fmt(jobSub)}</b></span></div>
                  )}
                </div>
              )}
              {rows.map(l => (
                <LineCard key={l.id} t={t} line={l} catName={catName}
                  selected={optionsOf(l) ? selectedOf(l) : null}
                  onSelect={opt => setChoice(c => ({ ...c, [l.id]: opt }))}
                  canDecide={canDecide} amount={amountOf(l)}
                  busy={busyLineId === l.id} anyBusy={busyAny}
                  onDecide={d => decide(l, d)} />
              ))}
            </section>
          );
        })}

        <div className="ea-totals">
          {choosing ? (
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

      {pendingCount > 0 && canDecide && (pickedLines.length > 0 ? (
        <div className="ea-sticky ea-sticky-pick" role="group" aria-label={t('estimates.pub_selected_label', 'The jobs you ticked')}>
          <span>{t('estimates.pub_selected_n', '{{n}} job(s) ticked — {{amount}}', {
            n: pickedGroups.length,
            amount: fmt(pickedLines.filter(l => l.line_type !== 'discount').reduce((s2, l) => s2 + amountOf(l), 0) * (1 + vatRate / 100)),
          })}</span>
          <div className="ea-sticky-actions">
            <button type="button" className="ea-btn ea-btn-reject" disabled={busyAny} onClick={() => decideMany('rejected', pickedLines)}>
              {t('estimates.pub_reject_selected', 'Reject selected')}
            </button>
            <button type="button" className="ea-btn ea-btn-approve" disabled={busyAny} onClick={() => decideMany('approved', pickedLines)}>
              {bulkBusy ? '…' : t('estimates.pub_approve_selected', 'Approve selected')}
            </button>
          </div>
        </div>
      ) : (
        <div className="ea-sticky" role="status">
          <span>{pendingCount === 1
            ? t('estimates.pub_left_one', '1 item still needs your decision')
            : t('estimates.pub_left_n', '{{n}} items still need your decision', { n: pendingCount })}</span>
          <b>{fmt(runningTotal)}</b>
        </div>
      ))}

      {consentFor && (
        <ConsentSheet t={t} lines={consentFor.lines} amountOf={amountOf} vatRate={vatRate}
          amount={fixedCostOf(consentFor.lines)} statement={consentStatement(fixedCostOf(consentFor.lines))}
          agreed={agreed} onAgreed={setAgreed} name={name} onName={setName} busy={busyAny} banner={banner}
          onCancel={() => setConsentFor(null)} onConfirm={confirmConsent} />
      )}
    </div>
  );
}

/**
 * The consent step of a supplementary estimate: what is being approved, its
 * fixed cost incl. VAT, the statement to tick and the customer's name. The
 * statement shown is the one stored with the approval.
 */
function ConsentSheet({ t, lines, amountOf, vatRate, amount, statement, agreed, onAgreed, name, onName, busy, banner, onCancel, onConfirm }) {
  const ready = agreed && name.trim().length >= 2;
  return (
    <div className="ea-sheet-overlay" onClick={busy ? undefined : onCancel}>
      <div className="ea-sheet" role="dialog" aria-modal="true" aria-labelledby="ea-consent-title" onClick={e => e.stopPropagation()}>
        <h2 id="ea-consent-title">{t('estimates.pub_consent_title', 'Approve the additional work')}</h2>
        <ul className="ea-sheet-items">
          {lines.map(l => (
            <li key={l.id}><span>{l.description}{qtyOf(l) > 1 ? ` × ${qtyOf(l)}` : ''}</span><b>{fmt(amountOf(l))}</b></li>
          ))}
        </ul>
        <div className="ea-sheet-total">
          <span>{t('estimates.pub_consent_total', 'Fixed cost (incl. {{v}}% VAT)', { v: vatRate })}</span>
          <b>{fmt(amount)}</b>
        </div>
        <label className="ea-consent-check">
          <input type="checkbox" checked={agreed} onChange={e => onAgreed(e.target.checked)} disabled={busy} />
          <span>{statement}</span>
        </label>
        <label className="ea-name-field">
          {t('estimates.pub_consent_name', 'Your full name')}
          <input value={name} onChange={e => onName(e.target.value)} placeholder={t('estimates.pub_name_ph', 'Full name')} autoComplete="name" disabled={busy} />
        </label>
        {banner && <div className="ea-banner ea-banner-warn" role="alert">{banner}</div>}
        <div className="ea-sheet-actions">
          <button type="button" className="ea-btn ea-btn-reject" disabled={busy} onClick={onCancel}>{t('estimates.pub_cancel', 'Cancel')}</button>
          <button type="button" className="ea-btn ea-btn-approve" disabled={busy || !ready} onClick={onConfirm}
            title={!ready ? t('estimates.pub_consent_needed', 'Tick the statement and type your name') : undefined}>
            {busy ? '…' : t('estimates.pub_consent_confirm', 'I agree — approve')}
          </button>
        </div>
      </div>
    </div>
  );
}

function LineCard({ t, line: l, catName, selected, onSelect, canDecide, amount, busy, anyBusy, onDecide }) {
  const pending = l.customer_status === 'pending';
  const qty = qtyOf(l);
  const o = optionsOf(l);
  // Radio cards when there is a choice to make: two or more priced
  // categories, or an alternative standing in for one not available.
  const showChoice = !!o && pending && canDecide && (o.choices.length > 1 || !!o.alternative);
  const chosen = o?.choices.find(c => c.option === selected) || null;
  const nothingOnOffer = !!o && !o.choices.length;
  const when = c => (c.expected_date
    ? t('estimates.pub_expected', 'Expected {{d}}', { d: fmtDay(c.expected_date) })
    : t('estimates.pub_in_stock', 'In stock'));
  // A decided part says what it was approved in.
  const decidedTag = !pending && o && l.part_option
    ? (Number(l.alternative_approved) === 1
      ? t('estimates.pub_alt_tag', 'Alternative: {{cat}}', { cat: catName(l.part_option) })
      : catName(l.part_option))
    : null;

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
            {!showChoice && chosen && pending && <span className={`ea-tag ea-tag-${chosen.option}`}>{catName(chosen.option)}</span>}
            {!showChoice && chosen && pending && <span className="ea-tag ea-tag-muted">{when(chosen)}</span>}
            {decidedTag && <span className={`ea-tag ea-tag-${l.part_option}`}>{decidedTag}</span>}
            {l.urgency === 'now' && <span className="ea-tag ea-tag-urgent">{t('estimates.pub_urgent', 'Needs attention')}</span>}
          </div>
        </div>
        {!showChoice && <div className="ea-line-price">{nothingOnOffer && pending ? '—' : fmt(amount)}</div>}
      </div>

      {showChoice && (
        <div className="ea-opts" role="radiogroup" aria-label={t('estimates.pub_choose_type', 'Choose the part type')}>
          {o.requested.map(c => (
            <label key={c.option} className={`ea-opt${selected === c.option ? ' ea-opt-on' : ''}${c.usable ? '' : ' ea-opt-na'}`}>
              <input type="radio" name={`opt-${l.id}`} value={c.option} checked={selected === c.option} disabled={!c.usable || busy}
                onChange={() => onSelect(c.option)} />
              <span className="ea-opt-radio" aria-hidden />
              <span className="ea-opt-label">{catName(c.option)}</span>
              {c.usable ? (
                <>
                  <span className="ea-opt-price">{fmt(c.price * qty * (1 - Number(l.discount_pct || 0) / 100))}</span>
                  {qty > 1 && <span className="ea-opt-each">{t('estimates.pub_each', '{{p}} each', { p: fmt(c.price) })}</span>}
                  <span className="ea-opt-when">{when(c)}</span>
                </>
              ) : (
                <span className="ea-opt-unavail">{t('estimates.pub_not_available', 'Not available')}</span>
              )}
            </label>
          ))}
          {o.alternative && (
            <label className={`ea-opt ea-opt-alt${selected === o.alternative.option ? ' ea-opt-on' : ''}`}>
              <input type="radio" name={`opt-${l.id}`} value={o.alternative.option} checked={selected === o.alternative.option} disabled={busy}
                onChange={() => onSelect(o.alternative.option)} />
              <span className="ea-opt-radio" aria-hidden />
              <span className="ea-opt-flag">{t('estimates.pub_alt_flag', 'Alternative — needs your approval')}</span>
              <span className="ea-opt-label">
                {o.alternative.for
                  ? t('estimates.pub_alt_instead', '{{cat}} instead of {{for}}', { cat: catName(o.alternative.option), for: catName(o.alternative.for) })
                  : catName(o.alternative.option)}
              </span>
              <span className="ea-opt-price">{fmt(o.alternative.price * qty * (1 - Number(l.discount_pct || 0) / 100))}</span>
              {qty > 1 && <span className="ea-opt-each">{t('estimates.pub_each', '{{p}} each', { p: fmt(o.alternative.price) })}</span>}
              <span className="ea-opt-when">{when(o.alternative)}</span>
            </label>
          )}
        </div>
      )}
      {pending && canDecide && nothingOnOffer && (
        <p className="ea-line-note">{t('estimates.pub_none_available', 'This part is not available in the types you asked for. You can only decline it — the workshop will contact you.')}</p>
      )}

      {pending && canDecide ? (
        <div className="ea-line-actions">
          <button className="ea-btn ea-btn-reject" disabled={anyBusy} onClick={() => onDecide('rejected')}>
            {busy ? '…' : t('estimates.pub_reject', 'Reject')}
          </button>
          <button className="ea-btn ea-btn-approve" disabled={anyBusy || (!!o && !chosen)} onClick={() => onDecide('approved')}
            title={o && !chosen ? t('estimates.pub_choose_first', 'Choose an option first') : undefined}>
            {busy ? '…' : showChoice && chosen
              ? (chosen.alternative
                ? t('estimates.pub_approve_alt', 'Approve the alternative')
                : t('estimates.pub_approve_type', 'Approve {{type}}', { type: catName(chosen.option) }))
              : showChoice ? t('estimates.pub_choose_first', 'Choose an option first')
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
