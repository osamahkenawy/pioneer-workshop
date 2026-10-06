/**
 * UpgradeModal.jsx — Module D.6 — In-app plan upgrade flow
 * Shows plan comparison when user hits a limit or clicks "Upgrade"
 * Supports:
 *   - First-time subscription via Stripe Checkout redirect
 *   - In-place upgrade with proration preview & confirmation
 * Plans are fetched from the same /api/public/pricing endpoint used by the
 * landing page so pricing, features, and limits always stay in sync.
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import usePlanUsage, { invalidatePlanCache } from '../../hooks/usePlanUsage';
import { api } from '../../lib/api';
import './PlanBadge.css';
import './UpgradeCalc.css';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PK;
if (!STRIPE_PK) console.error('[Stripe] VITE_STRIPE_PK not set — payments will not work');
const stripePromise = loadStripe(STRIPE_PK);

const API_BASE = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') : '';

/* ── Feature key → human-readable text (matches landing page i18n) ── */
const FEATURE_KEY_MAP = {
  mechanicAppFree: 'Mechanic App (iOS & Android)',
  starterF1: 'Create and optimize routes',
  starterF2: 'Unlimited merchants and mechanics',
  starterF3: 'Real-time tracking and notifications',
  starterF4: '1 custom delivery property',
  starterF5: '5 proof of delivery photos per stop',
  starterF6: '30 day data history',
  growthF1: 'Branded recipient tracking page',
  growthF2: 'Custom notification sender ID',
  growthF3: '3 custom delivery properties',
  growthF4: 'Extra proof of delivery photos per stop',
  growthF5: '1 year data history',
  enterpriseF1: 'Personalized onboarding',
  enterpriseF2: '10 custom delivery properties',
  enterpriseF3: '5 year data history',
  enterpriseF4: 'Dedicated account manager',
};

/** Feature header per plan tier */
const PLAN_FEATURE_HEADERS = {
  starter: 'Get started with:',
  growth: 'Everything in Starter, plus:',
  enterprise: 'Everything in Growth, plus:',
};

/** Keys that should show a "Free" badge */
const FREE_BADGE_KEYS = ['mechanicAppFree'];

/** Resolve featureKeys array to human-readable strings */
function resolveFeatureKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return [];
  return keys.map(k => FEATURE_KEY_MAP[k] || k);
}

/* ── Hardcoded fallback (only used when API is unreachable) ── */
const FALLBACK_PLANS = [
  {
    slug: 'starter',
    name: 'Starter',
    price: '125',
    priceNum: 125,
    yearlyPrice: 1275,
    currency: 'AED',
    period: '/month',
    baseStops: 1000,
    extraRate: 0.007,
    limits: { orders: '1,000/mo' },
    featureKeys: ['mechanicAppFree','starterF1','starterF2','starterF3','starterF4','starterF5','starterF6'],
    features: [
      'Mechanic App (iOS & Android)',
      'Create and optimize routes',
      'Unlimited merchants and mechanics',
      'Real-time tracking and notifications',
      '1 custom delivery property',
      '5 proof of delivery photos per stop',
      '30 day data history',
    ],
  },
  {
    slug: 'growth',
    name: 'Growth',
    price: '225',
    priceNum: 225,
    yearlyPrice: 2295,
    currency: 'AED',
    period: '/month',
    recommended: true,
    baseStops: 2000,
    extraRate: 0.01,
    limits: { orders: '3,000/mo' },
    featureKeys: ['mechanicAppFree','growthF1','growthF2','growthF3','growthF4','growthF5'],
    features: [
      'Mechanic App (iOS & Android)',
      'Branded recipient tracking page',
      'Custom notification sender ID',
      '3 custom delivery properties',
      'Extra proof of delivery photos per stop',
      '1 year data history',
    ],
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    price: '415',
    priceNum: 415,
    yearlyPrice: 4233,
    currency: 'AED',
    period: '/month',
    baseStops: 12000,
    extraRate: 0.012,
    limits: { orders: '12,000/mo' },
    featureKeys: ['mechanicAppFree','enterpriseF1','enterpriseF2','enterpriseF3','enterpriseF4'],
    features: [
      'Mechanic App (iOS & Android)',
      'Personalized onboarding',
      '10 custom delivery properties',
      '5 year data history',
      'Dedicated account manager',
    ],
  },
];

/** Map an API plan object to the shape we render */
function apiPlanToLocal(p) {
  // Prefer featureKeys (landing_features) → resolve to readable text
  const fKeys = Array.isArray(p.featureKeys) && p.featureKeys.length > 0 ? p.featureKeys : [];
  const features = fKeys.length > 0
    ? resolveFeatureKeys(fKeys)
    : (Array.isArray(p.features) && p.features.length > 0 ? p.features : []);
  return {
    slug: p.key,
    name: p.name,
    price: String(p.base),
    priceNum: Number(p.base),
    yearlyPrice: p.yearlyPrice ? Number(p.yearlyPrice) : Math.round(Number(p.base) * 12 * 0.85),
    currency: p.currency || 'AED',
    period: '/month',
    baseStops: p.baseStops,
    extraRate: Number(p.extraRate),
    recommended: !!p.featured,
    featureKeys: fKeys,
    limits: {
      orders: `${(p.limits?.maxWorkOrdersPerMonth ?? p.baseStops).toLocaleString()}/mo`,
    },
    features,
  };
}

export default function UpgradeModal({ onClose, triggerReason = null, supportInfo = null }) {
  const { t } = useTranslation();
  const { plan: currentPlan, planName, usage, refresh } = usePlanUsage();
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState('');
  const [showContactPopup, setShowContactPopup] = useState(false);

  /* ── Fetch plans from the same API the landing page uses ── */
  const [apiPlans, setApiPlans] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function fetchPlans() {
      try {
        const res = await fetch(`${API_BASE}/api/public/service-pricing`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        if (!cancelled && data.success && data.plans?.length) {
          setApiPlans(data.plans.map(apiPlanToLocal));
        }
      } catch {
        // keep fallback
      }
    }
    fetchPlans();
    return () => { cancelled = true };
  }, []);

  const PLANS = useMemo(() => apiPlans || FALLBACK_PLANS, [apiPlans]);

  // ── Delivery calculator state ──
  const [showCalc, setShowCalc] = useState(false);
  const [mechanics, setMechanics] = useState('');
  const [stopsPerMechanic, setStopsPerMechanic] = useState('');
  const [freq, setFreq] = useState('day');   // 'day' | 'week' | 'month'
  const [workDays, setWorkDays] = useState(5);
  const [estimatedDeliveries, setEstimatedDeliveries] = useState(0);
  const [billingCycle, setBillingCycle] = useState('monthly'); // BUG 11 FIX: 'monthly' | 'yearly'

  const calcResult = useCallback(() => {
    const d = parseInt(mechanics) || 0;
    const s = parseInt(stopsPerMechanic) || 0;
    let monthly = d * s;
    if (freq === 'day') monthly *= workDays * 4.33;
    else if (freq === 'week') monthly *= 4.33;
    return Math.round(monthly);
  }, [mechanics, stopsPerMechanic, freq, workDays]);

  /** Compute the dynamic price for a plan given estimated deliveries and billing cycle */
  const computePrice = useCallback((plan) => {
    const isYearly = billingCycle === 'yearly';
    const basePrice = isYearly ? (plan.yearlyPrice || Math.round(plan.priceNum * 12 * 0.85)) : plan.priceNum;
    if (!estimatedDeliveries || estimatedDeliveries <= 0) return basePrice;
    const extra = Math.max(0, estimatedDeliveries - (plan.baseStops || 0));
    const extraCost = Math.round(extra * (plan.extraRate || 0) * (isYearly ? 12 : 1));
    return basePrice + extraCost;
  }, [estimatedDeliveries, billingCycle]);

  const handleUpdatePlans = useCallback(() => {
    const result = calcResult();
    setEstimatedDeliveries(result);
    setShowCalc(false);
  }, [calcResult]);

  const handleResetCalc = useCallback(() => {
    setEstimatedDeliveries(0);
    setMechanics('');
    setStopsPerMechanic('');
    setFreq('day');
    setWorkDays(5);
  }, []);

  // ── Proration state ──
  const [prorationPreview, setProrationPreview] = useState(null); // preview data from API
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmingUpgrade, setConfirmingUpgrade] = useState(false);

  /**
   * Step 1: User clicks "Upgrade" on a plan card.
   * - If no Stripe subscription exists → redirect to Checkout (current flow)
   * - If subscription exists → fetch proration preview
   */
  const handleUpgrade = useCallback(async (planSlug) => {
    setLoadingPlan(planSlug);
    setError('');
    setProrationPreview(null);

    try {
      // First, try create-checkout-session — it will tell us if a sub already exists
      const res = await api.post('/stripe/create-checkout-session', {
        plan: planSlug,
        billing_cycle: billingCycle,
        estimated_deliveries: estimatedDeliveries || 0,
      });

      // Case A: Workshop already has a Stripe subscription → show proration preview
      if (res.success && res.has_subscription) {
        setPreviewLoading(true);
        setLoadingPlan(null);

        const preview = await api.post('/stripe/preview-upgrade', {
          plan: planSlug,
          billing_cycle: billingCycle,
          estimated_deliveries: estimatedDeliveries || 0,
        });

        if (preview.success && preview.has_subscription) {
          setProrationPreview(preview);
        } else if (preview.success && !preview.has_subscription) {
          // Fallback: sub was lost, redirect to checkout
          setError('Subscription needs to be re-created. Redirecting to checkout...');
          setTimeout(() => handleFirstTimeCheckout(planSlug), 1500);
        } else {
          setError(preview.message || 'Failed to preview upgrade.');
        }
        setPreviewLoading(false);
        return;
      }

      // Case B: No subscription — redirect to Stripe Checkout
      if (res.success && res.url) {
        window.location.href = res.url;
      } else if (res.success && res.sessionId) {
        const stripe = await stripePromise;
        const { error: stripeError } = await stripe.redirectToCheckout({ sessionId: res.sessionId });
        if (stripeError) setError(stripeError.message);
      } else {
        setError(res.message || 'Failed to start checkout. Please try again or contact support.');
      }
    } catch (err) {
      setError('Unable to connect to payment service. Please contact support.');
    }
    setLoadingPlan(null);
  }, [estimatedDeliveries, billingCycle]);

  /**
   * Fallback: redirect to Stripe Checkout for first-time subscription.
   */
  const handleFirstTimeCheckout = useCallback(async (planSlug) => {
    try {
      const res = await api.post('/stripe/create-checkout-session', {
        plan: planSlug,
        billing_cycle: billingCycle,
        estimated_deliveries: estimatedDeliveries || 0,
      });
      if (res.url) window.location.href = res.url;
    } catch { /* ignore */ }
  }, [estimatedDeliveries, billingCycle]);

  /**
   * Step 2: User confirms proration → execute upgrade via API (no redirect).
   */
  const handleConfirmUpgrade = useCallback(async () => {
    if (!prorationPreview) return;
    setConfirmingUpgrade(true);
    setError('');

    try {
      const res = await api.post('/stripe/upgrade-subscription', {
        plan: prorationPreview.new_plan,
        billing_cycle: prorationPreview.billing_cycle,
        proration_date: prorationPreview.proration_date,
        estimated_deliveries: estimatedDeliveries || 0,
      });

      if (res.success) {
        invalidatePlanCache();
        refresh();
        setProrationPreview(null);
        setError('');
        alert(res.message);
        onClose();
      } else if (res.requires_action && res.payment_intent_client_secret) {
        // 3D Secure / SCA authentication required
        try {
          const stripe = await stripePromise;
          const { error: confirmError } = await stripe.confirmCardPayment(res.payment_intent_client_secret);
          if (confirmError) {
            setError(confirmError.message || 'Payment authentication failed. Please try again.');
          } else {
            // Payment confirmed after 3DS — retry the upgrade
            const retry = await api.post('/stripe/upgrade-subscription', {
              plan: prorationPreview.new_plan,
              billing_cycle: prorationPreview.billing_cycle,
              proration_date: prorationPreview.proration_date,
              estimated_deliveries: estimatedDeliveries || 0,
            });
            if (retry.success) {
              invalidatePlanCache();
              refresh();
              setProrationPreview(null);
              setError('');
              alert(retry.message);
              onClose();
            } else {
              setError(retry.message || 'Upgrade failed after payment verification. Please try again.');
            }
          }
        } catch (stripeErr) {
          setError('Payment authentication failed. Please try again.');
        }
      } else if (res.payment_failed) {
        setError(res.message || 'Payment failed. Please update your payment method in Manage Billing and try again.');
      } else if (res.needs_checkout) {
        setError('Subscription requires checkout. Redirecting...');
        setTimeout(() => handleFirstTimeCheckout(prorationPreview.new_plan), 1500);
      } else {
        setError(res.message || 'Upgrade failed. Please try again.');
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || '';
      if (msg.includes('Payment failed') || msg.includes('declined')) {
        setError(msg);
      } else {
        setError('Failed to process upgrade. Please contact support.');
      }
    }
    setConfirmingUpgrade(false);
  }, [prorationPreview, onClose, refresh, handleFirstTimeCheckout, estimatedDeliveries]);

  // ──────────────────────────────────────────
  // Proration Confirmation View
  // ──────────────────────────────────────────
  if (prorationPreview) {
    const p = prorationPreview;
    return (
      <div className="upgrade-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="upgrade-modal" style={{ position: 'relative', maxWidth: 520 }}>
          <button className="upgrade-close" onClick={() => { setProrationPreview(null); setError(''); }}>&times;</button>

          <div className="upgrade-modal-header">
            <h2>Confirm Plan {p.is_upgrade ? 'Upgrade' : 'Change'}</h2>
            <p style={{ color: '#6b7280', marginTop: 4 }}>
              {p.current_plan_name} → {p.new_plan_name}
            </p>
          </div>

          {/* UX Message */}
          <div style={{ padding: '0 24px', marginBottom: 16 }}>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '14px 18px', fontSize: 13, color: '#1e40af', lineHeight: 1.6 }}>
              <strong><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1e40af" strokeWidth="2" style={{verticalAlign:'middle',marginRight:4}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>How proration works:</strong><br />
              Your plan will be upgraded immediately. You will only be charged the prorated difference
              for the rest of this billing period. Your full new plan amount will start from the next renewal date.
            </div>
          </div>

          {/* Proration Breakdown */}
          <div style={{ padding: '0 24px', marginBottom: 16 }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, overflow: 'hidden' }}>

              {/* Line items */}
              {p.line_items && p.line_items.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Billing Details
                  </div>
                  {p.line_items.map((item, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 0', borderBottom: i < p.line_items.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}>
                      <span style={{
                        fontSize: 13, color: '#475569', flex: 1, paddingRight: 12,
                        ...(item.proration ? {} : { fontWeight: 600 }),
                      }}>
                        {item.proration && (item.amount < 0 ? '↩ ' : '→ ')}
                        {item.description}
                      </span>
                      <span style={{
                        fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                        color: item.amount < 0 ? '#16a34a' : item.amount > 0 ? '#1e293b' : '#6b7280',
                      }}>
                        {item.amount < 0 ? '−' : ''}{p.currency || 'AED'} {Math.abs(item.amount).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Summary */}
              <div style={{ borderTop: '2px solid #f97316', paddingTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Due Now (Prorated)</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#f97316' }}>
                    {p.currency || 'AED'} {p.proration.amount_due_now.toFixed(2)}
                  </span>
                </div>

                {p.proration.credit < 0 && (
                  <div style={{ fontSize: 12, color: '#16a34a', marginBottom: 4 }}>
                    ↩ Credit for unused {p.current_plan_name}: {p.currency || 'AED'} {Math.abs(p.proration.credit).toFixed(2)}
                  </div>
                )}
                {p.proration.charge > 0 && (
                  <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>
                    → Charge for remaining {p.new_plan_name}: {p.currency || 'AED'} {p.proration.charge.toFixed(2)}
                  </div>
                )}
              </div>

              {/* Next cycle */}
              <div style={{ marginTop: 14, padding: '12px 0 0', borderTop: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280' }}>
                  <span>Next renewal ({p.next_cycle.date_formatted})</span>
                  <span style={{ fontWeight: 700, color: '#1e293b' }}>{p.currency || 'AED'} {p.next_cycle.amount.toFixed(2)}/{p.billing_cycle === 'yearly' ? 'yr' : 'mo'}</span>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div style={{ padding: '10px 16px', margin: '0 24px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ padding: '0 24px 24px', display: 'flex', gap: 10 }}>
            <button
              onClick={() => { setProrationPreview(null); setError(''); }}
              style={{
                flex: 1, padding: '12px', borderRadius: 10, border: '1px solid #e5e7eb',
                background: '#fff', color: '#6b7280', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Back
            </button>
            <button
              onClick={handleConfirmUpgrade}
              disabled={confirmingUpgrade}
              style={{
                flex: 2, padding: '12px', borderRadius: 10, border: 'none',
                background: confirmingUpgrade ? '#9ca3af' : (p.is_upgrade ? '#f97316' : '#8b5cf6'),
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: confirmingUpgrade ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {confirmingUpgrade ? (
                <><span className="upgrade-btn-spinner" /> Processing...</>
              ) : (
                <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:4}}><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>Confirm {p.is_upgrade ? 'Upgrade' : 'Change'} — Pay {p.currency || 'AED'} {p.proration.amount_due_now.toFixed(2)} Now</>
              )}
            </button>
          </div>

          <div className="upgrade-modal-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>Payments secured by <strong>Stripe</strong> — prorated to the second</span>
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────
  // Plan Selection View (default)
  // ──────────────────────────────────────────

  const planIcons = {
    starter: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
    growth: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    enterprise: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  };

  return (
    <div className="upgrade-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="upgrade-modal" style={{ position: 'relative' }}>
        <button className="upgrade-close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div className="upgrade-modal-header">
          <h2>{triggerReason ? (<><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" style={{verticalAlign:'middle',marginRight:6}}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Upgrade Required</>) : 'Choose Your Plan'}</h2>
          <p>
            {triggerReason
              ? `You've reached the limit on your ${planName} plan. Upgrade to unlock more.`
              : `You're currently on the ${planName} plan. Compare options below.`}
          </p>
          {triggerReason && (
            <p style={{ color: '#dc2626', fontWeight: 600, marginTop: 8, fontSize: 13 }}>
              {triggerReason}
            </p>
          )}
        </div>

        {error && (
          <div style={{ padding: '10px 16px', margin: '12px 28px 0', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#dc2626', fontSize: 13, flexShrink: 0 }}>
            {error}
          </div>
        )}

        {previewLoading && (
          <div style={{ padding: '16px 28px', textAlign: 'center', color: '#64748b', fontSize: 14, flexShrink: 0 }}>
            <span className="upgrade-btn-spinner" style={{ marginRight: 8, borderTopColor: '#8b5cf6', borderColor: 'rgba(139,92,246,0.2)' }} />
            Calculating prorated cost...
          </div>
        )}

        {/* ── Billing Cycle Toggle ── */}
        <div className="upgrade-billing-toggle">
          {['monthly', 'yearly'].map(cycle => (
            <button
              key={cycle}
              className={`upgrade-billing-btn ${billingCycle === cycle ? 'is-active' : ''}`}
              onClick={() => setBillingCycle(cycle)}
            >
              {cycle === 'monthly' ? 'Monthly' : (<>Yearly<span className="upgrade-billing-yearly-badge">-15%</span></>)}
            </button>
          ))}
        </div>

        {/* ── Scrollable body: calculator, plans, support ── */}
        <div className="upgrade-modal-body">

        {/* ── Delivery Calculator Toggle ── */}
        <div className="ucalc-bar">
          {estimatedDeliveries > 0 ? (
            <div className="ucalc-active">
              <span className="ucalc-active-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:4}}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                Estimated: <strong>{estimatedDeliveries.toLocaleString()}</strong> deliveries/month
              </span>
              <div className="ucalc-active-actions">
                <button className="ucalc-edit-btn" onClick={() => setShowCalc(true)}>Edit</button>
                <button className="ucalc-reset-btn" onClick={handleResetCalc}>Reset</button>
              </div>
            </div>
          ) : (
            <button className="ucalc-open-btn" onClick={() => setShowCalc(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:4}}><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="8" y1="18" x2="16" y2="18"/></svg>
              Use calculator to estimate your deliveries
            </button>
          )}
        </div>

        {/* ── Calculator Modal ── */}
        {showCalc && (
          <div className="ucalc-overlay" onClick={(e) => e.target === e.currentTarget && setShowCalc(false)}>
            <div className="ucalc-dialog">
              <h3 className="ucalc-title">Calculate your monthly deliveries</h3>

              <label className="ucalc-label">How many mechanics do you have?</label>
              <input
                className="ucalc-input"
                type="number"
                min={0}
                placeholder="e.g. 10"
                value={mechanics}
                onChange={e => setMechanics(e.target.value)}
              />

              <label className="ucalc-label">How many stops per mechanic?</label>
              <input
                className="ucalc-input"
                type="number"
                min={0}
                placeholder="e.g. 100"
                value={stopsPerMechanic}
                onChange={e => setStopsPerMechanic(e.target.value)}
              />

              <label className="ucalc-label">Frequency</label>
              <div className="ucalc-freq-group">
                {['day', 'week', 'month'].map(f => (
                  <button
                    key={f}
                    className={`ucalc-freq-btn ${freq === f ? 'is-active' : ''}`}
                    onClick={() => setFreq(f)}
                  >
                    per {f}
                  </button>
                ))}
              </div>

              {freq !== 'month' && (
                <>
                  <label className="ucalc-label">How many working days per week?</label>
                  <div className="ucalc-days-group">
                    {[1, 2, 3, 4, 5, 6, 7].map(d => (
                      <button
                        key={d}
                        className={`ucalc-day-btn ${workDays === d ? 'is-active' : ''}`}
                        onClick={() => setWorkDays(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="ucalc-result">
                <span className="ucalc-result-label">Estimated monthly deliveries</span>
                <span className="ucalc-result-value">{calcResult().toLocaleString()}</span>
              </div>

              <button className="ucalc-update-btn" onClick={handleUpdatePlans}>
                Update plans
              </button>
              <button className="ucalc-cancel-btn" onClick={() => setShowCalc(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="upgrade-plans-grid">
          {/* Trial plan card (shown only when on trial) */}
          {currentPlan === 'trial' && (
            <div className="upgrade-plan-card current" style={{ borderColor: '#f59e0b40' }}>
              <div className="upgrade-plan-current-tag" style={{ background: '#fef3c7', color: '#92400e' }}>Current Plan</div>
              <div className="upgrade-plan-icon starter" style={{ background: '#fef3c740' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              </div>
              <div className="upgrade-plan-name">Free Trial</div>
              <div className="upgrade-plan-price">FREE <span>/ 7 days</span></div>
              <div className="upgrade-plan-orders-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                Up to <strong style={{margin:'0 3px'}}>25/mo</strong> orders
              </div>
              <div className="upgrade-features-header">Explore the platform:</div>
              <div className="upgrade-plan-features">
                {['All features accessible', '3 users / 3 mechanics', '25 orders per month', '5 photos per stop', '30-day data history'].map((f,i) => (
                  <div key={i} className="upgrade-feature-item">
                    <svg className="upgrade-feature-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>{f}</span>
                  </div>
                ))}
              </div>
              <button className="upgrade-plan-btn current-btn" disabled>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                Current Plan
              </button>
            </div>
          )}

          {PLANS.map((p) => {
            const isCurrent = p.slug === currentPlan;
            const isRecommended = p.recommended && !isCurrent;
            const isDowngrade = PLANS.findIndex(x => x.slug === p.slug) < PLANS.findIndex(x => x.slug === currentPlan);
            const dynamicPrice = computePrice(p);

            return (
              <div
                key={p.slug}
                className={`upgrade-plan-card ${isCurrent ? 'current' : ''} ${isRecommended ? 'recommended' : ''}`}
              >
                {isCurrent && <div className="upgrade-plan-current-tag">Current Plan</div>}
                {isRecommended && !isCurrent && <div className="upgrade-recommended-tag">Most Popular</div>}

                <div className={`upgrade-plan-icon ${p.slug}`}>
                  {planIcons[p.slug] || planIcons.starter}
                </div>
                <div className="upgrade-plan-name">{p.name}</div>

                <div className="upgrade-plan-price">
                  {p.currency} {dynamicPrice} <span>{billingCycle === 'yearly' ? '/yr' : '/mo'}</span>
                </div>
                {billingCycle === 'yearly' && (
                  <div className="upgrade-plan-price-sub">
                    {p.currency} {(dynamicPrice / 12).toFixed(0)}/mo billed annually
                  </div>
                )}
                {estimatedDeliveries > 0 && (
                  <div className="ucalc-price-note">
                    Base {p.currency} {billingCycle === 'yearly' ? (p.yearlyPrice || Math.round(p.priceNum * 12 * 0.85)) : p.price}{billingCycle === 'yearly' ? '/yr' : '/mo'} + {Math.max(0, estimatedDeliveries - (p.baseStops || 0)).toLocaleString()} extra stops
                  </div>
                )}

                <div className="upgrade-plan-orders-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                  Up to <strong style={{margin:'0 3px'}}>{p.limits.orders}</strong> orders
                </div>

                <div className="upgrade-features-header">
                  {PLAN_FEATURE_HEADERS[p.slug] || 'Includes:'}
                </div>
                <div className="upgrade-plan-features">
                  {p.features.map((f, i) => {
                    const fk = p.featureKeys?.[i];
                    const isFree = fk && FREE_BADGE_KEYS.includes(fk);
                    return (
                      <div key={i} className="upgrade-feature-item">
                        <svg className="upgrade-feature-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        <span>{f}</span>
                        {isFree && <span className="upgrade-feature-badge free">Free</span>}
                      </div>
                    );
                  })}
                  {p.slug === 'enterprise' && (
                    <div className="upgrade-feature-item">
                      <svg className="upgrade-feature-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>Geofencing-restricted deliveries</span>
                      {/* <span className="upgrade-feature-badge soon">Coming soon</span> */}
                    </div>
                  )}
                </div>

                {isCurrent ? (
                  <button className="upgrade-plan-btn current-btn" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    Current Plan
                  </button>
                ) : isDowngrade ? (
                  <button
                    className="upgrade-plan-btn secondary"
                    disabled
                    style={{ opacity: 0.5, fontSize: 11, lineHeight: 1.3 }}
                    title="Contact info@pioneercarservice.com to downgrade your plan"
                  >
                    Contact Support to Downgrade
                  </button>
                ) : (
                  <button
                    className={`upgrade-plan-btn ${isRecommended ? 'primary' : 'secondary'}`}
                    onClick={() => setShowContactPopup(true)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
                    {t('subscription.contact_support_btn')}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Support Contact Section */}
        <div className="upgrade-support-section">
          <div className="upgrade-support-title">Need help or want a custom plan?</div>
          <div className="upgrade-support-contacts">
            <a href="mailto:info@pioneercarservice.com" className="upgrade-support-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              info@pioneercarservice.com
            </a>
            <a href="https://wa.me/971503920037" target="_blank" rel="noopener noreferrer" className="upgrade-support-link whatsapp">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.11.546 4.093 1.502 5.816L.057 23.64l5.985-1.57A11.946 11.946 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.82c-1.88 0-3.63-.5-5.14-1.376l-.37-.218-3.822 1.002 1.02-3.726-.24-.38A9.784 9.784 0 012.18 12c0-5.422 4.398-9.82 9.82-9.82 5.422 0 9.82 4.398 9.82 9.82 0 5.422-4.398 9.82-9.82 9.82z"/></svg>
              WhatsApp: +971 50 392 0037
            </a>
          </div>
        </div>

        </div>{/* end upgrade-modal-body */}

        {/* ── Contact Support Popup ── */}
        {showContactPopup && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 10001,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }} onClick={() => setShowContactPopup(false)}>
            <div style={{
              background: '#fff', borderRadius: 16, padding: '32px 28px', maxWidth: 420, width: '90%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center', position: 'relative'
            }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📞</div>
              <h3 style={{ margin: '0 0 12px', fontSize: 20, color: '#1e293b' }}>
                {t('subscription.contact_support_title')}
              </h3>
              <p style={{ margin: '0 0 24px', fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
                {t('subscription.contact_support_message')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <a href="mailto:info@pioneercarservice.com" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 20px', borderRadius: 10, background: '#6366f1', color: '#fff',
                  textDecoration: 'none', fontWeight: 600, fontSize: 14
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  info@pioneercarservice.com
                </a>
                <a href="https://wa.me/971503920037" target="_blank" rel="noopener noreferrer" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 20px', borderRadius: 10, background: '#25d366', color: '#fff',
                  textDecoration: 'none', fontWeight: 600, fontSize: 14
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.11.546 4.093 1.502 5.816L.057 23.64l5.985-1.57A11.946 11.946 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.82c-1.88 0-3.63-.5-5.14-1.376l-.37-.218-3.822 1.002 1.02-3.726-.24-.38A9.784 9.784 0 012.18 12c0-5.422 4.398-9.82 9.82-9.82 5.422 0 9.82 4.398 9.82 9.82 0 5.422-4.398 9.82-9.82 9.82z"/></svg>
                  WhatsApp: +971 50 392 0037
                </a>
                <button onClick={() => setShowContactPopup(false)} style={{
                  padding: '10px 20px', borderRadius: 10, border: '1px solid #e2e8f0',
                  background: '#f8fafc', color: '#64748b', fontWeight: 500, fontSize: 14, cursor: 'pointer'
                }}>
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="upgrade-modal-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>Payments secured by <strong>Stripe</strong></span>
        </div>
      </div>
    </div>
  );
}
