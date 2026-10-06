/**
 * usePlanUsage.js — Hook to fetch and cache plan/subscription usage data
 * Module D.5 — Provides plan limits, usage stats, trial info to any component
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';

// Cache globally so sidebar + pages share the same data
let _cachedData = null;
let _lastFetch = 0;
const CACHE_TTL = 60_000; // 1 minute

export default function usePlanUsage() {
  const [planData, setPlanData] = useState(_cachedData);
  const [loading, setLoading] = useState(!_cachedData);
  const mountedRef = useRef(true);

  const fetchPlanUsage = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && _cachedData && (now - _lastFetch < CACHE_TTL)) {
      if (mountedRef.current) setPlanData(_cachedData);
      return _cachedData;
    }

    try {
      if (mountedRef.current) setLoading(true);
      const res = await api.get('/workshops/usage');
      if (res?.success && res.data) {
        _cachedData = res.data;
        _lastFetch = now;
        if (mountedRef.current) {
          setPlanData(res.data);
          setLoading(false);
        }
        return res.data;
      }
    } catch (err) {
      console.warn('usePlanUsage fetch error:', err.message);
    }
    if (mountedRef.current) setLoading(false);
    return null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchPlanUsage();

    // Auto-refresh when plan-affecting actions happen
    const onPlanChanged = () => fetchPlanUsage(true);
    window.addEventListener('plan-usage-changed', onPlanChanged);

    // BUG 18 FIX: Periodic refresh should respect CACHE_TTL (don't force).
    // The event listener already handles forced refreshes after plan changes.
    const interval = setInterval(() => fetchPlanUsage(false), 60_000);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('plan-usage-changed', onPlanChanged);
      clearInterval(interval);
    };
  }, [fetchPlanUsage]);

  // Derived convenience values
  const plan = planData?.plan || 'trial';
  const planName = planData?.plan_name || 'Trial';
  const usage = planData?.usage || {};
  const limits = planData?.limits || {};
  const features = planData?.features || {};
  const isTrial = planData?.is_trial || false;
  const subscriptionStatus = planData?.status || 'none';
  const workshopStatus = planData?.workshop_status || 'active';
  const trialEnd = planData?.trial_end || null;
  const trialDaysRemaining = planData?.trial_days_remaining;
  const trialExpired = planData?.trial_expired || subscriptionStatus === 'trial_expired';
  const cancelAtPeriodEnd = planData?.cancel_at_period_end || false;
  const cancelAt = planData?.cancel_at || null;

  // Warning thresholds (mechanics are counted as users — unified limit)
  const isNearOrderLimit = (usage.orders_pct || 0) >= 80;
  const isNearUserLimit = (usage.users_pct || 0) >= 80;
  const isAtUserLimit = (usage.users_pct || 0) >= 100;
  const isAtOrderLimit = (usage.orders_pct || 0) >= 100;
  const hasAnyWarning = isNearOrderLimit || isNearUserLimit;
  const isTrialExpiring = isTrial && trialDaysRemaining !== null && trialDaysRemaining <= 7 && trialDaysRemaining > 0;

  return {
    planData,
    loading,
    refresh: () => fetchPlanUsage(true),
    plan,
    planName,
    usage,
    limits,
    features,
    isTrial,
    subscriptionStatus,
    workshopStatus,
    trialEnd,
    trialDaysRemaining,
    trialExpired,
    cancelAtPeriodEnd,
    cancelAt,
    isNearOrderLimit,
    isNearUserLimit,
    isAtUserLimit,
    isAtOrderLimit,
    hasAnyWarning,
    isTrialExpiring,
    isPastDue: subscriptionStatus === 'past_due',
    isSuspended: subscriptionStatus === 'suspended' || workshopStatus === 'suspended',
    hasFeature: (name) => !!features[name],
    getFeatureLimit: (name) => typeof features[name] === 'number' ? features[name] : null,
  };
}

// Invalidate cache (call after plan changes)
export function invalidatePlanCache() {
  _cachedData = null;
  _lastFetch = 0;
}

// JobAssignment event to trigger plan badge refresh (call after creating orders, mechanics, etc.)
export function dispatchPlanUpdate() {
  _cachedData = null;
  _lastFetch = 0;
  window.dispatchEvent(new Event('plan-usage-changed'));
}
