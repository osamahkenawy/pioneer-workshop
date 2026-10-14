/* ══════════════════════════════════════════════════════════════
 * CustomerVerifyEmail.jsx — the link in the confirmation e-mail.
 * Route: /customer/verify-email?token=… (older e-mails point at
 * /portal/verify-email or /merchant/verify-email; PortalRedirect sends them here).
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle, WarningTriangle } from 'iconoir-react';
import api from '../../lib/customerApi';
import { logoSrc, onLogoError } from '../../components/service-status/workshopLogo';
import { PORTAL } from './portalPaths';
import './CustomerAuth.css';

export default function CustomerVerifyEmail() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState(token ? 'loading' : 'error');

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const res = await api.post('/customer-auth/verify-email', { token });
        if (alive) setStatus(res.success ? 'success' : 'error');
      } catch {
        if (alive) setStatus('error');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  return (
    <div className="ca-page">
      <div className="ca-left">
        <div className="ca-logo-box"><img src={logoSrc(null)} alt="Pioneer" className="ca-logo" onError={onLogoError} /></div>
        <div className="ca-form ca-center">
          {status === 'loading' && (
            <>
              <span className="ca-spinner" style={{ borderColor: '#e2e8f0', borderTopColor: '#c2410c' }} aria-hidden="true" />
              <h1 className="ca-title" role="status">{t('portal.verify.checking', 'Confirming your e-mail…')}</h1>
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle width={56} height={56} className="ca-icon-ok" aria-hidden="true" />
              <h1 className="ca-title">{t('portal.verify.done_title', 'E-mail confirmed')}</h1>
              <p className="ca-subtitle">{t('portal.verify.done_text', 'Your customer portal is ready. You can sign in now.')}</p>
              <Link to={PORTAL.login} className="ca-btn ca-btn-primary">{t('portal.auth.go_to_login', 'Go to sign in')}</Link>
            </>
          )}
          {status === 'error' && (
            <>
              <WarningTriangle width={56} height={56} className="ca-icon-warn" aria-hidden="true" />
              <h1 className="ca-title">{t('portal.verify.failed_title', "We couldn't confirm your e-mail")}</h1>
              <p className="ca-subtitle">{t('portal.verify.failed_text', 'The link was already used or has run out. Sign in to have the e-mail sent again.')}</p>
              <Link to={PORTAL.login} className="ca-btn ca-btn-outline">{t('portal.auth.back_to_login', 'Back to sign in')}</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
