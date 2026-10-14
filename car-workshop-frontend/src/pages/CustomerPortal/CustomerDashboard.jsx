/* ══════════════════════════════════════════════════════════════
 * CustomerDashboard.jsx — the portal's Home.
 *
 * "Action needed" first (GET /customer-portal/home):
 *   1. Sign your vehicle inspection — a walk-around finished without the
 *      customer at the car; signed in the portal, on the job card page.
 *   2. Approve your estimate — the existing approval page
 *      (/estimate-approval/:token); the customer is signed in and it is theirs.
 *   3. Your car is ready for collection — with the amount due.
 * Then their cars at the workshop, one ServiceStatusCard each.
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useContext } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EditPencil, Page, Check, MapPin, Phone, WarningTriangle, Refresh, CheckCircle } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import api from '../../lib/customerApi';
import ServiceStatusCard, { fmtMoney, fmtWhen } from '../../components/service-status/ServiceStatusCard';
import { PORTAL } from './portalPaths';
import './CustomerPages.css';

const vehicleText = v => [v?.plate, [v?.make, v?.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

export default function CustomerDashboard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { user, workshop } = useContext(CustomerAuthContext);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/customer-portal/home');
      if (res.success) setData(res.data);
      else setError(res.message || t('portal.load_failed', "We couldn't load your portal. Please try again."));
    } catch {
      setError(t('portal.network_error', 'Connection problem. Check your internet and try again.'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const name = data?.customer?.name || user?.full_name || '';
  const actions = data?.actions || { sign: [], approve: [], ready: [] };
  const actionCount = actions.sign.length + actions.approve.length + actions.ready.length;
  const jobs = data?.jobs || [];
  const contact = jobs[0]?.workshop || (workshop?.phone ? { name: workshop.name, phone: workshop.phone } : null);
  const cur = contact?.currency || workshop?.currency || 'AED';

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <div>
          <h1 className="cp-page-title">{name
            ? t('portal.home.hello', 'Hello, {{name}}', { name })
            : t('portal.home.hello_no_name', 'Hello')}</h1>
          <p className="cp-page-sub">{t('portal.home.sub', 'Follow your car through the workshop.')}</p>
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

      {!loading && data && (
        <>
          {/* ── Action needed ── */}
          <section className="cp-section" aria-labelledby="cp-action-needed">
            <h2 className="cp-section-title" id="cp-action-needed">
              {t('portal.home.action_needed', 'Action needed')}
              {actionCount > 0 && <span className="cp-count">{actionCount}</span>}
            </h2>

            {actionCount === 0 && (
              <div className="cp-all-clear">
                <CheckCircle width={20} height={20} aria-hidden="true" />
                {t('portal.home.nothing_needed', 'Nothing needs you right now.')}
              </div>
            )}

            {actions.sign.map(s => (
              <div className="cp-action-item is-sign" key={`sign-${s.id}`}>
                <span className="cp-action-icon"><EditPencil width={20} height={20} aria-hidden="true" /></span>
                <div className="cp-action-body">
                  <p className="cp-action-title">{t('portal.home.sign_title', 'Sign your vehicle inspection')}</p>
                  <p className="cp-action-text">
                    {s.type === 'joint'
                      ? t('portal.home.sign_text_handover', 'The handover inspection of your {{vehicle}} (job card {{job}}) is ready. Check it and sign.', { vehicle: vehicleText(s.vehicle) || t('serviceStatus.your_car', 'Your car'), job: s.work_order_number })
                      : t('portal.home.sign_text_dropoff', 'The drop-off inspection of your {{vehicle}} (job card {{job}}) is ready. Check it and sign.', { vehicle: vehicleText(s.vehicle) || t('serviceStatus.your_car', 'Your car'), job: s.work_order_number })}
                  </p>
                  <div className="cp-btn-row">
                    <Link className="cp-btn cp-btn-primary" to={`${PORTAL.job(s.work_order_id)}?sign=${s.id}#inspection-${s.id}`}>
                      <EditPencil width={16} height={16} /> {t('portal.home.sign_now', 'Check and sign')}
                    </Link>
                  </div>
                </div>
              </div>
            ))}

            {actions.approve.map(e => (
              <div className="cp-action-item is-approve" key={`est-${e.id}`}>
                <span className="cp-action-icon"><Page width={20} height={20} aria-hidden="true" /></span>
                <div className="cp-action-body">
                  <p className="cp-action-title">{t('portal.home.approve_title', 'Approve your estimate')}</p>
                  <p className="cp-action-text">
                    {t('portal.home.approve_text', 'Estimate {{number}} for {{amount}}, sent {{date}}{{plate}}. Choose which work to go ahead with.', {
                      number: e.estimate_number, amount: fmtMoney(e.total, cur, lang), date: fmtWhen(e.sent_at, lang, { time: false }),
                      plate: e.vehicle_plate ? ` · ${e.vehicle_plate}` : '',
                    })}
                  </p>
                  <div className="cp-btn-row">
                    {e.approval_path && (
                      <a className="cp-btn cp-btn-primary" href={e.approval_path}>
                        {t('portal.home.approve_now', 'Review & approve')}
                      </a>
                    )}
                    {e.work_order_id && (
                      <Link className="cp-btn cp-btn-outline" to={PORTAL.job(e.work_order_id)}>{t('portal.view_job', 'View job card')}</Link>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {actions.ready.map(r => (
              <div className="cp-action-item is-ready" key={`ready-${r.work_order_id}`}>
                <span className="cp-action-icon"><Check width={20} height={20} aria-hidden="true" /></span>
                <div className="cp-action-body">
                  <p className="cp-action-title">{t('portal.home.ready_title', 'Your car is ready for collection')}</p>
                  <p className="cp-action-text">
                    {vehicleText(r.vehicle)}
                    {r.invoice && (r.invoice.on_account
                      ? ` — ${t('portal.home.on_account', 'billed to your account')}`
                      : r.invoice.balance > 0
                        ? ` — ${t('portal.home.amount_due', 'amount due {{amount}}', { amount: fmtMoney(r.invoice.balance, cur, lang) })}`
                        : ` — ${t('portal.home.paid', 'paid')}`)}
                  </p>
                  <div className="cp-btn-row">
                    <Link className="cp-btn cp-btn-primary" to={PORTAL.job(r.work_order_id)}>{t('portal.view_job', 'View job card')}</Link>
                    {contact?.map_url && (
                      <a className="cp-btn cp-btn-outline" href={contact.map_url} target="_blank" rel="noopener noreferrer">
                        <MapPin width={16} height={16} /> {t('serviceStatus.directions', 'Get directions')}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </section>

          {/* ── Cars at the workshop ── */}
          <section className="cp-section" aria-labelledby="cp-at-workshop">
            <h2 className="cp-section-title" id="cp-at-workshop">{t('portal.home.at_workshop', 'Your cars at the workshop')}</h2>
            {jobs.length === 0 ? (
              <div className="cp-empty">
                <p>{t('portal.home.no_open_jobs', "No open job cards. When your car is with us, you'll follow it here.")}</p>
                <Link className="cp-btn cp-btn-outline" to={PORTAL.jobs}>{t('portal.home.past_jobs', 'See past job cards')}</Link>
              </div>
            ) : (
              <div className="cp-list cp-list-2">
                {jobs.map(j => <ServiceStatusCard key={j.work_order_id} status={j} variant="compact" to={PORTAL.job(j.work_order_id)} />)}
              </div>
            )}
          </section>

          {contact?.phone && (
            <section className="cp-card">
              <h2 className="cp-card-title">{t('serviceStatus.contact', 'Contact us')}</h2>
              <p style={{ margin: 0, color: '#475569' }}>{contact.name}{contact.address ? ` · ${contact.address}` : ''}</p>
              <div className="cp-btn-row">
                <a className="cp-btn cp-btn-outline" href={`tel:${String(contact.phone).replace(/[^\d+]/g, '')}`}>
                  <Phone width={16} height={16} /> <bdi dir="ltr">{contact.phone}</bdi>
                </a>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
