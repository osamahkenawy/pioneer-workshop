/**
 * TrialBanner.jsx — Module D.5 — Top banner for trial expiry warning
 * Shows when trial is expiring soon or has expired (grace period)
 * Also shows for past_due subscription status
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningTriangle, Clock, Rocket } from 'iconoir-react';
import usePlanUsage from '../../hooks/usePlanUsage';
import UpgradeModal from './UpgradeModal';
import './PlanBadge.css';

export default function TrialBanner() {
  const { t } = useTranslation();
  const { isTrial, trialDaysRemaining, trialExpired, isTrialExpiring, isPastDue, subscriptionStatus, planName, cancelAtPeriodEnd, cancelAt } = usePlanUsage();
  const [dismissed, setDismissed] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Show for scheduled cancellation (cancel_at_period_end OR cancel_at set)
  if ((cancelAtPeriodEnd || cancelAt) && subscriptionStatus === 'active') {
    const cancelDate = cancelAt
      ? new Date(cancelAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : t('subscription.end_of_billing_period');
    return (
      <>
        <div className="trial-banner expired">
          <div className="trial-banner-inner">
            <span className="trial-banner-icon-wrap expired-icon">
              <WarningTriangle width={16} height={16} />
            </span>
            <span className="trial-banner-text">
              <strong>{t('subscription.cancellation_scheduled')}</strong>&nbsp;&mdash;&nbsp;{t('subscription.cancel_on_date', { date: cancelDate })}
            </span>
          </div>
          <div className="trial-banner-actions">
            <button className="trial-banner-btn" onClick={() => setShowUpgrade(true)}>
              {t('subscription.reactivate')} <span className="btn-arrow">&rarr;</span>
            </button>
          </div>
        </div>
        {showUpgrade && (
          <UpgradeModal onClose={() => setShowUpgrade(false)} triggerReason={t('subscription.scheduled_for_cancellation')} />
        )}
      </>
    );
  }

  // Show for past_due subscription
  if (isPastDue) {
    return (
      <>
        <div className="trial-banner expired">
          <div className="trial-banner-inner">
            <span className="trial-banner-icon-wrap expired-icon">
              <WarningTriangle width={16} height={16} />
            </span>
            <span className="trial-banner-text">
              <strong>{t('subscription.payment_past_due')}</strong>&nbsp;&mdash;&nbsp;{t('subscription.update_billing_warning')}
            </span>
          </div>
          <div className="trial-banner-actions">
            <button className="trial-banner-btn" onClick={() => setShowUpgrade(true)}>
              {t('subscription.update_billing')} <span className="btn-arrow">&rarr;</span>
            </button>
          </div>
        </div>
        {showUpgrade && (
          <UpgradeModal onClose={() => setShowUpgrade(false)} triggerReason={t('subscription.past_due_reason')} />
        )}
      </>
    );
  }

  // Only show for trial users with expiry info
  if (!isTrial || trialDaysRemaining === null) return null;
  // Don't show if more than 7 days remaining
  if (trialDaysRemaining > 7 && !trialExpired) return null;
  // Allow dismiss only for non-expired trials
  if (dismissed && !trialExpired) return null;

  const isExpired = trialExpired || trialDaysRemaining <= 0;
  const urgency = !isExpired && trialDaysRemaining <= 2 ? 'urgent' : '';

  return (
    <>
      <div className={`trial-banner ${isExpired ? 'expired' : ''} ${urgency}`}>
        <div className="trial-banner-shimmer" />
        <div className="trial-banner-inner">
          {isExpired ? (
            <span className="trial-banner-icon-wrap expired-icon">
              <WarningTriangle width={16} height={16} />
            </span>
          ) : (
            <span className="trial-banner-countdown">
              <span className="countdown-number">{trialDaysRemaining}</span>
              <span className="countdown-label">{trialDaysRemaining !== 1 ? t('common.days') : t('common.day')}</span>
            </span>
          )}
          <span className="trial-banner-text">
            {isExpired
              ? <><strong>{t('subscription.trial_expired')}</strong>&nbsp;&mdash;&nbsp;{t('subscription.subscribe_to_continue')}</>
              : <><strong>{t('subscription.trial_ending_soon')}</strong>&nbsp;&mdash;&nbsp;{t('subscription.upgrade_to_keep')}</>
            }
          </span>
        </div>
        <div className="trial-banner-actions">
          <button className="trial-banner-btn" onClick={() => setShowUpgrade(true)}>
            {isExpired ? t('subscription.subscribe_now') : t('subscription.view_plans')} <span className="btn-arrow">&rarr;</span>
          </button>
          {!isExpired && (
            <button className="trial-banner-close" onClick={() => setDismissed(true)} title="Dismiss">
              &times;
            </button>
          )}
        </div>
      </div>

      {showUpgrade && (
        <UpgradeModal
          onClose={() => setShowUpgrade(false)}
          triggerReason={isExpired ? t('subscription.trial_has_ended') : null}
        />
      )}
    </>
  );
}
