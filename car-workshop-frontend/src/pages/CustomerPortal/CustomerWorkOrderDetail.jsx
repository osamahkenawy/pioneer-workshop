/* ══════════════════════════════════════════════════════════════
 * CustomerWorkOrderDetail.jsx — one job card in the portal.
 *
 * GET /customer-portal/work-orders/:id:
 *   - where it stands (ServiceStatusCard, full), with "Open status page"
 *     and "Copy status link" (the link to share with family or the fleet
 *     desk — the same one the workshop sends);
 *   - the vehicle inspections: the customer's copy, and the sign-off when
 *     they were not at the car (?sign=<inspection id> opens it);
 *   - the estimates sent to them, with "Review & approve" while waiting;
 *   - invoices with paid / balance and the PDF.
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useContext } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, OpenNewWindow, Copy, Check, Download, WarningTriangle, Refresh } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import api from '../../lib/customerApi';
import ServiceStatusCard, { fmtMoney, fmtWhen } from '../../components/service-status/ServiceStatusCard';
import PortalInspection from './PortalInspection';
import { PORTAL } from './portalPaths';
import { invoiceStatusBadge, estimateStatusBadge, downloadInvoicePdf } from './portalShared';
import './CustomerPages.css';

export default function CustomerWorkOrderDetail() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id } = useParams();
  const [params] = useSearchParams();
  const signId = Number(params.get('sign')) || null;
  const { workshop } = useContext(CustomerAuthContext);
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | ready | not_found | error
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [pdfError, setPdfError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/customer-portal/work-orders/${id}`);
      if (res.success) { setData(res.data); setPhase('ready'); }
      else setPhase(res.status === 404 ? 'not_found' : 'error');
    } catch {
      setPhase('error');
    }
  }, [id]);

  useEffect(() => { setPhase('loading'); load(); }, [load]);

  const copyLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(t('portal.job.copy_prompt', 'Copy this link:'), url);
    }
  };

  if (phase === 'loading') {
    return <div className="cp-page"><div className="cp-loading" role="status"><span className="cp-spinner" aria-hidden="true" />{t('portal.loading', 'Loading…')}</div></div>;
  }
  if (phase !== 'ready') {
    return (
      <div className="cp-page">
        <Link to={PORTAL.jobs} className="cp-back"><ArrowLeft width={18} height={18} className="cp-flip" /> {t('portal.nav.jobs', 'My job cards')}</Link>
        <div className="cp-alert cp-alert-error" role="alert">
          <WarningTriangle width={18} height={18} aria-hidden="true" />
          <div>
            <p style={{ margin: 0 }}>{phase === 'not_found'
              ? t('portal.job.not_found', "We couldn't find this job card.")
              : t('portal.load_failed', "We couldn't load your portal. Please try again.")}</p>
            {phase === 'error' && (
              <button type="button" className="cp-btn cp-btn-outline" style={{ marginBlockStart: 8 }} onClick={() => { setPhase('loading'); load(); }}>
                <Refresh width={16} height={16} /> {t('portal.retry', 'Try again')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const status = data.status;
  const cur = status?.workshop?.currency || workshop?.currency || 'AED';
  const awaiting = (data.estimates || []).find(e => e.awaiting_decision && e.approval_path);
  const statusActions = status?.status_url ? (
    <>
      <a className="ssc-btn ssc-btn-ghost" href={status.status_url} target="_blank" rel="noopener noreferrer">
        <OpenNewWindow width={18} height={18} /> {t('portal.job.open_status', 'Open status page')}
      </a>
      <button type="button" className="ssc-btn ssc-btn-ghost" onClick={() => copyLink(status.status_url)}>
        {copied ? <Check width={18} height={18} /> : <Copy width={18} height={18} />}
        {copied ? t('portal.job.copied', 'Link copied') : t('portal.job.copy_status', 'Copy status link')}
      </button>
    </>
  ) : null;

  return (
    <div className="cp-page">
      <Link to={PORTAL.jobs} className="cp-back"><ArrowLeft width={18} height={18} className="cp-flip" /> {t('portal.nav.jobs', 'My job cards')}</Link>

      {notice && <div className="cp-alert cp-alert-success" role="status"><Check width={18} height={18} aria-hidden="true" /> <span>{notice}</span></div>}

      {status && <ServiceStatusCard status={status} variant="full" actions={statusActions} approveHref={awaiting?.approval_path || null} />}

      {data.inspections?.length > 0 && (
        <section className="cp-section" aria-labelledby="cp-job-inspections">
          <h2 className="cp-section-title" id="cp-job-inspections">{t('portal.job.inspections', 'Vehicle inspection')}</h2>
          {data.inspections.map(insp => (
            <PortalInspection key={insp.id} inspection={insp} autoFocusSign={insp.id === signId && insp.needs_signature}
              onSigned={() => { setNotice(t('portal.inspection.thanks', 'Thank you — your signature has been recorded.')); load(); }} />
          ))}
        </section>
      )}

      {data.estimates?.length > 0 && (
        <section className="cp-card" aria-labelledby="cp-job-estimates">
          <h2 className="cp-card-title" id="cp-job-estimates">{t('portal.job.estimates', 'Estimates')}</h2>
          <ul className="cp-rows">
            {data.estimates.map(e => {
              const badge = estimateStatusBadge(t, e);
              return (
                <li className="cp-row" key={e.id}>
                  <div className="cp-row-main">
                    <p className="cp-row-title">{e.estimate_number} · <bdi>{fmtMoney(e.total, cur, lang)}</bdi></p>
                    <p className="cp-row-sub">{t('portal.estimate.sent_on', 'Sent {{date}}', { date: fmtWhen(e.sent_at, lang, { time: false }) })}</p>
                  </div>
                  <span className={`cp-badge ${badge.cls}`}>{badge.text}</span>
                  {e.approval_path && (
                    <a className={`cp-btn ${e.awaiting_decision ? 'cp-btn-primary' : 'cp-btn-outline'}`} href={e.approval_path}>
                      {e.awaiting_decision ? t('portal.home.approve_now', 'Review & approve') : t('portal.estimate.view', 'View estimate')}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.invoices?.length > 0 && (
        <section className="cp-card" aria-labelledby="cp-job-invoices">
          <h2 className="cp-card-title" id="cp-job-invoices">{t('portal.nav.invoices', 'Invoices & payments')}</h2>
          {pdfError && <p className="cp-alert cp-alert-error" role="alert">{pdfError}</p>}
          <ul className="cp-rows">
            {data.invoices.map(inv => {
              const badge = invoiceStatusBadge(t, inv);
              return (
                <li className="cp-row" key={inv.id}>
                  <div className="cp-row-main">
                    <p className="cp-row-title">{inv.invoice_number}</p>
                    <p className="cp-amounts">
                      <span>{t('portal.invoices.total', 'Total')} <strong><bdi>{fmtMoney(inv.total_amount, cur, lang)}</bdi></strong></span>
                      <span>{t('portal.invoices.paid', 'Paid')} <strong><bdi>{fmtMoney(inv.amount_paid, cur, lang)}</bdi></strong></span>
                      <span>{t('portal.invoices.balance', 'Balance')} <strong><bdi>{fmtMoney(inv.balance, cur, lang)}</bdi></strong></span>
                    </p>
                  </div>
                  <span className={`cp-badge ${badge.cls}`}>{badge.text}</span>
                  <button type="button" className="cp-btn cp-btn-outline"
                    onClick={() => { setPdfError(''); downloadInvoicePdf(inv).catch(() => setPdfError(t('portal.invoices.pdf_failed', "Couldn't download the invoice. Please try again."))); }}>
                    <Download width={16} height={16} /> {t('portal.invoices.pdf', 'PDF')}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
