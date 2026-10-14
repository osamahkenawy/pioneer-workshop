/**
 * ServiceStatusPublic — the customer's status link, no login.
 *
 * Route /service-status/:token, and /track/:token for job sheets already
 * printed. Every SMS, e-mail, WhatsApp text and job sheet QR links here
 * (lib/customerLink.js). The payload comes from
 * GET /api/public/service-status/:token (routes/public-service-status.js) and
 * is drawn by ServiceStatusCard: where the car is in the seven stages, what
 * to do now, and how to reach the workshop.
 *
 * Phone first, one column (max 560px, centred on desktop). No map, GPS,
 * sockets or polling — the customer refreshes when they want to.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Refresh, Language, WarningTriangle } from 'iconoir-react';
import ServiceStatusCard from '../components/service-status/ServiceStatusCard';
import { logoSrc, onLogoError } from '../components/service-status/workshopLogo';
import './ServiceStatusPublic.css';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function ServiceStatusPublic() {
  const { t, i18n } = useTranslation();
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | ready | not_found | error
  const [status, setStatus] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!token) { setPhase('not_found'); return; }
    if (silent) setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/public/service-status/${encodeURIComponent(token)}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 404) { setPhase('not_found'); return; }
      if (!res.ok || !json.success) { setPhase(p => (p === 'ready' ? 'ready' : 'error')); return; }
      setStatus(json.data);
      setUpdatedAt(new Date());
      setPhase('ready');
    } catch {
      setPhase(p => (p === 'ready' ? 'ready' : 'error'));
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const isArabic = i18n.language === 'ar';
  const toggleLanguage = () => i18n.changeLanguage(isArabic ? 'en' : 'ar');
  const workshop = status?.workshop || {};

  return (
    <div className="ssp-page">
      <header className="ssp-header">
        <div className="ssp-header-inner">
          <div className="ssp-brand">
            <img className="ssp-logo" src={logoSrc(workshop.logo_url)} alt=""
              onError={onLogoError} />
            <span className="ssp-brand-name">{workshop.name || t('serviceStatus.workshop_fallback', 'Pioneer Car Service')}</span>
          </div>
          <button type="button" className="ssp-lang" onClick={toggleLanguage}
            aria-label={isArabic ? 'English' : 'العربية'}>
            <Language width={18} height={18} aria-hidden="true" />
            <span>{isArabic ? 'English' : 'العربية'}</span>
          </button>
        </div>
      </header>

      <main className="ssp-main">
        <h1 className="ssp-heading">{t('serviceStatus.page_title', 'Your car at the workshop')}</h1>

        {phase === 'loading' && (
          <div className="ssp-state" role="status">
            <span className="ssp-spinner" aria-hidden="true" />
            {t('serviceStatus.loading', 'Loading your car’s status…')}
          </div>
        )}

        {phase === 'not_found' && (
          <div className="ssp-state ssp-state-warn" role="alert">
            <WarningTriangle width={28} height={28} aria-hidden="true" />
            <p>{t('serviceStatus.not_found_no_phone', "We couldn't find this job. Check the link, or call the workshop.")}</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="ssp-state ssp-state-warn" role="alert">
            <WarningTriangle width={28} height={28} aria-hidden="true" />
            <p>{t('serviceStatus.error', "We couldn't load the status. Check your connection and try again.")}</p>
            <button type="button" className="ssc-btn ssc-btn-primary" onClick={() => { setPhase('loading'); load(); }}>
              <Refresh width={18} height={18} /> {t('serviceStatus.retry', 'Try again')}
            </button>
          </div>
        )}

        {phase === 'ready' && status && (
          <>
            <ServiceStatusCard status={status} variant="full" />
            <footer className="ssp-footer">
              <span>{updatedAt && t('serviceStatus.updated', 'Updated {{time}}', {
                time: updatedAt.toLocaleTimeString(i18n.language || undefined, { hour: 'numeric', minute: '2-digit' }),
              })}</span>
              <button type="button" className="ssc-btn ssc-btn-ghost" onClick={() => load({ silent: true })} disabled={refreshing}>
                <Refresh width={18} height={18} className={refreshing ? 'ssp-spin' : ''} />
                {t('serviceStatus.refresh', 'Refresh')}
              </button>
            </footer>
          </>
        )}

      </main>
    </div>
  );
}
