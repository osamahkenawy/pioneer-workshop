/* ══════════════════════════════════════════════════════════════
 * CustomerVehicles.jsx — My vehicles.
 *
 * GET /customer-portal/vehicles: the customer's cars on file with the
 * workshop, their last visit, and the job card open on them, if any.
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Car, WarningTriangle, Refresh } from 'iconoir-react';
import api from '../../lib/customerApi';
import { fmtWhen } from '../../components/service-status/ServiceStatusCard';
import { PORTAL } from './portalPaths';
import './CustomerPages.css';

export default function CustomerVehicles() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/customer-portal/vehicles');
      if (res.success) setVehicles(res.data || []);
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
          <h1 className="cp-page-title">{t('portal.nav.vehicles', 'My vehicles')}</h1>
          <p className="cp-page-sub">{t('portal.vehicles.sub', 'The cars we have on file for you.')}</p>
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

      {!loading && !error && (vehicles.length === 0 ? (
        <div className="cp-empty">
          <Car width={32} height={32} aria-hidden="true" />
          <p>{t('portal.vehicles.none', 'No vehicles on file yet. The workshop adds your car when you bring it in.')}</p>
        </div>
      ) : (
        <div className="cp-list cp-list-2">
          {vehicles.map(v => {
            const plate = [v.plate_code, v.plate_number].filter(Boolean).join(' ');
            return (
              <article className="cp-card" key={v.id}>
                <div className="cp-vehicle-head">
                  {plate && <span className="cp-plate" dir="ltr">{plate}</span>}
                  <span className="cp-vehicle-name">{[v.make, v.model, v.year].filter(Boolean).join(' ')}</span>
                </div>
                <dl className="cp-facts">
                  {v.color && <div><dt>{t('portal.vehicles.colour', 'Colour')}</dt><dd>{v.color}</dd></div>}
                  {v.vin && <div><dt>{t('portal.vehicles.vin', 'VIN')}</dt><dd dir="ltr">…{String(v.vin).slice(-6)}</dd></div>}
                  {v.mileage != null && <div><dt>{t('portal.vehicles.mileage', 'Mileage')}</dt><dd>{t('portal.inspection.km', '{{n}} km', { n: Number(v.mileage).toLocaleString(lang) })}</dd></div>}
                  <div><dt>{t('portal.vehicles.last_visit', 'Last visit')}</dt>
                    <dd>{v.last_visit_at ? fmtWhen(v.last_visit_at, lang, { time: false }) : t('portal.vehicles.no_visits', 'None yet')}</dd></div>
                  <div><dt>{t('portal.vehicles.visits', 'Visits')}</dt><dd>{Number(v.visits) || 0}</dd></div>
                </dl>
                {v.open_work_order_id && (
                  <div className="cp-btn-row">
                    <Link className="cp-btn cp-btn-primary" to={PORTAL.job(v.open_work_order_id)}>
                      {t('portal.vehicles.at_workshop', 'At the workshop now — see its job card')}
                    </Link>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ))}
    </div>
  );
}
