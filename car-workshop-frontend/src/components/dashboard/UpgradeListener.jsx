/**
 * UpgradeListener.jsx — Module D.6 — Global listener for plan upgrade events
 * Listens for 'plan-upgrade-required' custom events dispatched by api.js
 * and automatically shows the UpgradeModal with the relevant error message.
 */
import { useState, useEffect, useCallback } from 'react';
import UpgradeModal from './UpgradeModal';

export default function UpgradeListener() {
  const [upgradeInfo, setUpgradeInfo] = useState(null);

  const handleUpgradeRequired = useCallback((e) => {
    const detail = e.detail;
    setUpgradeInfo(detail);
  }, []);

  useEffect(() => {
    window.addEventListener('plan-upgrade-required', handleUpgradeRequired);
    return () => window.removeEventListener('plan-upgrade-required', handleUpgradeRequired);
  }, [handleUpgradeRequired]);

  if (!upgradeInfo) return null;

  return (
    <UpgradeModal
      onClose={() => setUpgradeInfo(null)}
      triggerReason={upgradeInfo.message || 'Plan limit reached. Please upgrade.'}
    />
  );
}
