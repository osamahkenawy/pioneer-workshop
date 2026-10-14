/* ══════════════════════════════════════════════════════════════
 * CustomerWorkOrders.jsx — My job cards.
 *
 * GET /customer-portal/service-status: a ServiceStatusCard for every job
 * open at the workshop (where it is in the seven stages), then the jobs
 * closed in the last 30 days. Each opens the job card page.
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useContext } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NavArrowRight, WarningTriangle, Refresh } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import api from '../../lib/customerApi';
import ServiceStatusCard, { fmtMoney, fmtWhen } from '../../components/service-status/ServiceStatusCard';
import { PORTAL } from './portalPaths';
import './CustomerPages.css';

const DAYS = 30;

export default function CustomerWorkOrders() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { workshop } = useContext(CustomerAuthContext);
  const cur = workshop?.currency || 'AED';
  const [open, setOpen] = useState([]);
  const [closed, setClosed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get(`/customer-portal/service-status?days=${DAYS}`);
      if (res.success) { setOpen(res.data || []); setClosed(res.closed || []); }
      else setError(res.message || t('portal.load_failed', "We couldn't load your portal. Please try again."));
    } catch {
      setError(t('portal.network_error', 'Connection problem. Check your internet and try again.'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <div>
          <h1 className="cp-page-title">{t('portal.nav.jobs', 'My job cards')}</h1>
          <p className="cp-page-sub">{t('portal.jobs.sub', 'Where each of your cars is, step by step.')}</p>
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
          <section className="cp-section" aria-labelledby="cp-open-jobs">
            <h2 className="cp-section-title" id="cp-open-jobs">{t('portal.jobs.open', 'At the workshop')}</h2>
            {open.length === 0 ? (
              <div className="cp-empty"><p>{t('portal.jobs.none_open', 'None of your cars is at the workshop right now.')}</p></div>
            ) : (
              <div className="cp-list cp-list-2">
                {open.map(j => <ServiceStatusCard key={j.work_order_id} status={j} variant="compact" to={PORTAL.job(j.work_order_id)} />)}
              </div>
            )}
          </section>

          <section className="cp-section" aria-labelledby="cp-closed-jobs">
            <h2 className="cp-section-title" id="cp-closed-jobs">{t('portal.jobs.closed', 'Closed in the last {{n}} days', { n: DAYS })}</h2>
            {closed.length === 0 ? (
              <div className="cp-empty"><p>{t('portal.jobs.none_closed', 'No job cards closed in this time.')}</p></div>
            ) : (
              <div className="cp-card">
                <ul className="cp-rows">
                  {closed.map(j => (
                    <li key={j.work_order_id}>
                      <Link className="cp-row-link" to={PORTAL.job(j.work_order_id)}>
                        <span className="cp-row-main">
                          <span className="cp-row-title" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            {j.vehicle?.plate && <span className="cp-plate" dir="ltr">{j.vehicle.plate}</span>}
                            {[j.vehicle?.make, j.vehicle?.model].filter(Boolean).join(' ')}
                          </span>
                          <span className="cp-row-sub" style={{ display: 'block' }}>
                            {[j.job?.job_card_number || j.job?.work_order_number, fmtWhen(j.stage?.since, lang, { time: false })].filter(Boolean).join(' · ')}
                            {j.invoice && j.invoice.balance > 0 && ` · ${t('portal.jobs.balance', 'Balance {{amount}}', { amount: fmtMoney(j.invoice.balance, cur, lang) })}`}
                          </span>
                        </span>
                        <span className={`cp-badge ${j.special ? '' : 'cp-badge-ok'}`}>
                          {j.special === 'declined' ? t('portal.jobs.badge_declined', 'Declined')
                            : j.special === 'cancelled' ? t('portal.jobs.badge_cancelled', 'Cancelled')
                            : t('portal.jobs.badge_collected', 'Collected')}
                        </span>
                        <NavArrowRight width={18} height={18} className="cp-flip" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
