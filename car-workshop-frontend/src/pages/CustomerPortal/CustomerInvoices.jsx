/* ══════════════════════════════════════════════════════════════
 * CustomerInvoices.jsx — Invoices & payments.
 *
 * GET /customer-portal/invoices: every invoice the workshop has issued to
 * the customer (not drafts, not void), with what was paid and what is left,
 * the job card and car it was for, and the PDF.
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useContext } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, WarningTriangle, Refresh, Page } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import api from '../../lib/customerApi';
import { fmtMoney, fmtWhen } from '../../components/service-status/ServiceStatusCard';
import { invoiceStatusBadge, downloadInvoicePdf } from './portalShared';
import { PORTAL } from './portalPaths';
import './CustomerPages.css';

export default function CustomerInvoices() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { workshop } = useContext(CustomerAuthContext);
  const [invoices, setInvoices] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/customer-portal/invoices');
      if (res.success) { setInvoices(res.data || []); setTotals(res.totals || null); }
      else setError(res.message || t('portal.load_failed', "We couldn't load your portal. Please try again."));
    } catch {
      setError(t('portal.network_error', 'Connection problem. Check your internet and try again.'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const download = async (inv) => {
    setPdfError(''); setBusyId(inv.id);
    try { await downloadInvoicePdf(inv); }
    catch { setPdfError(t('portal.invoices.pdf_failed', "Couldn't download the invoice. Please try again.")); }
    setBusyId(null);
  };

  const cur = invoices[0]?.currency || workshop?.currency || 'AED';

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <div>
          <h1 className="cp-page-title">{t('portal.nav.invoices', 'Invoices & payments')}</h1>
          <p className="cp-page-sub">{t('portal.invoices.sub', 'What you were billed, what you paid and what is left to pay.')}</p>
        </div>
      </div>

      {loading && <div className="cp-loading" role="status"><span className="cp-spinner" aria-hidden="true" />{t('portal.loading', 'Loading…')}</div>}

      {!loading && error && (
        <div className="cp-alert cp-alert-error" role="alert">
          <WarningTriangle width={18} height={18} aria-hidden="true" />
          <div>
            <p style={{ margin: 0 }}>{error}</p>
            <button type="button" className="cp-btn cp-btn-outline" style={{ marginBlockStart: 8 }} onClick={load}>
              <Refresh width={16} height={16} /> {t('portal.retry', 'Try again')}
            </button>
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          {totals && invoices.length > 0 && (
            <div className="cp-totals">
              <div className="cp-total">
                <span className="cp-total-label">{t('portal.invoices.billed', 'Billed')}</span>
                <span className="cp-total-value"><bdi>{fmtMoney(totals.billed, cur, lang)}</bdi></span>
              </div>
              <div className="cp-total">
                <span className="cp-total-label">{t('portal.invoices.paid', 'Paid')}</span>
                <span className="cp-total-value"><bdi>{fmtMoney(totals.paid, cur, lang)}</bdi></span>
              </div>
              <div className={`cp-total${totals.balance > 0 ? ' is-due' : ''}`}>
                <span className="cp-total-label">{t('portal.invoices.to_pay', 'To pay')}</span>
                <span className="cp-total-value"><bdi>{fmtMoney(totals.balance, cur, lang)}</bdi></span>
              </div>
            </div>
          )}

          {pdfError && <div className="cp-alert cp-alert-error" role="alert"><WarningTriangle width={16} height={16} aria-hidden="true" /> <span>{pdfError}</span></div>}

          {invoices.length === 0 ? (
            <div className="cp-empty">
              <Page width={32} height={32} aria-hidden="true" />
              <p>{t('portal.invoices.none', 'No invoices yet.')}</p>
            </div>
          ) : (
            <div className="cp-list cp-list-2">
              {invoices.map(inv => {
                const badge = invoiceStatusBadge(t, inv);
                const car = [inv.vehicle?.plate, [inv.vehicle?.make, inv.vehicle?.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
                return (
                  <article className="cp-card" key={inv.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <p className="cp-row-title" style={{ margin: 0 }}>{inv.invoice_number}</p>
                      <span className={`cp-badge ${badge.cls}`}>{badge.text}</span>
                    </div>
                    <p className="cp-row-sub">
                      {[fmtWhen(inv.created_at, lang, { time: false }), car].filter(Boolean).join(' · ')}
                    </p>
                    <p className="cp-amounts">
                      <span>{t('portal.invoices.total', 'Total')} <strong><bdi>{fmtMoney(inv.total_amount, cur, lang)}</bdi></strong></span>
                      <span>{t('portal.invoices.paid', 'Paid')} <strong><bdi>{fmtMoney(inv.amount_paid, cur, lang)}</bdi></strong></span>
                      <span>{t('portal.invoices.balance', 'Balance')} <strong><bdi>{fmtMoney(inv.balance, cur, lang)}</bdi></strong></span>
                    </p>
                    <div className="cp-btn-row">
                      <button type="button" className="cp-btn cp-btn-outline" onClick={() => download(inv)} disabled={busyId === inv.id}>
                        <Download width={16} height={16} /> {t('portal.invoices.pdf', 'PDF')}
                      </button>
                      {inv.work_order_id && (
                        <Link className="cp-btn cp-btn-outline" to={PORTAL.job(inv.work_order_id)}>
                          {t('portal.view_job', 'View job card')}
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
