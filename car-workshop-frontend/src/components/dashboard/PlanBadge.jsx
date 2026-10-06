/**
 * PlanBadge.jsx — Sidebar plan badge + usage mini-bars
 * Module D.5 — Shows current plan, usage percentages, and trial countdown
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import usePlanUsage from '../../hooks/usePlanUsage';
import UpgradeModal from './UpgradeModal';
import './PlanBadge.css';

const PLAN_COLORS = {
  trial:        { bg: '#fef3c7', text: '#92400e', bar: '#f59e0b' },
  starter:      { bg: '#dbeafe', text: '#1e40af', bar: '#3b82f6' },
  professional: { bg: '#ede9fe', text: '#5b21b6', bar: '#8b5cf6' },
  enterprise:   { bg: '#d1fae5', text: '#065f46', bar: '#10b981' },
  self_hosted:  { bg: '#f3f4f6', text: '#374151', bar: '#6b7280' },
};

export default function PlanBadge({ collapsed = false }) {
  const { t } = useTranslation();
  const { planData, loading, plan, planName, usage, isTrial, trialDaysRemaining, isTrialExpiring, hasAnyWarning } = usePlanUsage();
  const [showUpgrade, setShowUpgrade] = useState(false);

  if (loading || !planData) return null;

  const colors = PLAN_COLORS[plan] || PLAN_COLORS.trial;

  if (collapsed) {
    return (
      <div className="plan-badge-collapsed" title={`${planName} Plan`} style={{ background: colors.bg }}>
        <span style={{ color: colors.text, fontWeight: 700, fontSize: 11 }}>
          {planName.charAt(0)}
        </span>
        {(hasAnyWarning || isTrialExpiring) && <span className="plan-warning-dot" />}
      </div>
    );
  }

  return (
    <>
      <div className="plan-badge" style={{ background: colors.bg, borderColor: colors.bar + '40' }}>
        <div className="plan-badge-header">
          <span className="plan-badge-name" style={{ color: colors.text }}>{planName}</span>
          <button className="plan-badge-upgrade" onClick={() => setShowUpgrade(true)}>
            {plan === 'enterprise' || plan === 'self_hosted' ? t('subscription.manage') : t('subscription.upgrade')}
          </button>
        </div>

        {isTrial && trialDaysRemaining !== null && (
          <div className={`plan-trial-countdown ${isTrialExpiring ? 'warning' : ''}`}>
            {trialDaysRemaining > 0
              ? t('subscription.trial_days_left', { count: trialDaysRemaining })
              : t('subscription.trial_expired')}
          </div>
        )}

        {/* Usage mini-bars */}
        <div className="plan-usage-bars">
          <UsageBar label={t('subscription.orders')} current={usage.orders_this_month} max={usage.orders_limit} pct={usage.orders_pct} color={colors.bar} />
          <UsageBar label={t('subscription.users')} current={usage.active_users} max={usage.users_limit} pct={usage.users_pct} color={colors.bar} />
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </>
  );
}

function UsageBar({ label, current = 0, max = 0, pct = 0, color }) {
  const isWarn = pct >= 80;
  const isFull = pct >= 100;
  const barColor = isFull ? '#dc2626' : isWarn ? '#f59e0b' : color;

  return (
    <div className="plan-usage-row">
      <div className="plan-usage-label">
        <span>{label}</span>
        <span className={`plan-usage-count ${isFull ? 'full' : isWarn ? 'warn' : ''}`}>
          {current}/{max >= 999999 ? '∞' : max.toLocaleString()}
        </span>
      </div>
      <div className="plan-usage-track">
        <div
          className="plan-usage-fill"
          style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
        />
      </div>
    </div>
  );
}
