/**
 * PortalAuthHero — the right-hand panel of the portal's sign-in and
 * register pages (hidden on phones): what the Customer Portal is for.
 */
import { useTranslation } from 'react-i18next';
import { Wrench, EditPencil, Page, Wallet } from 'iconoir-react';

export default function PortalAuthHero() {
  const { t } = useTranslation();
  const features = [
    { icon: Wrench, text: t('portal.auth.feature_follow', 'Follow your job card') },
    { icon: EditPencil, text: t('portal.auth.feature_sign', 'Sign your vehicle inspection') },
    { icon: Page, text: t('portal.auth.feature_approve', 'Approve estimates') },
    { icon: Wallet, text: t('portal.auth.feature_invoices', 'Invoices & payments') },
  ];
  return (
    <div className="ca-right">
      <div className="ca-right-grid" />
      <div className="ca-hero-content">
        <div className="ca-hero-badge">{t('portal.title', 'Customer Portal')}</div>
        <h2 className="ca-hero-title">{t('portal.auth.hero_title', 'Pioneer Customer Portal')}</h2>
        <p className="ca-hero-text">{t('portal.auth.hero_text', 'Follow your car through the workshop.')}</p>
        <div className="ca-hero-features">
          {features.map(f => (
            <div className="ca-hero-feature" key={f.text}>
              <span className="ca-feature-icon"><f.icon width={18} height={18} aria-hidden="true" /></span> {f.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
