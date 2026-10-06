/**
 * TrialExpiredModal.jsx — Fullscreen blocking modal for trial_expired state (Scenario 5)
 * 
 * When subscription status = 'trial_expired', this overlays the entire app,
 * preventing interaction. User must upgrade or logout.
 */
import { useState, useContext } from 'react';
import { WarningTriangle } from 'iconoir-react';
import { AuthContext } from '../../App';
import usePlanUsage from '../../hooks/usePlanUsage';
import UpgradeModal from './UpgradeModal';

export default function TrialExpiredModal() {
  const { trialExpired, subscriptionStatus, isSuspended, isPastDue, planName, loading } = usePlanUsage();
  const { logout } = useContext(AuthContext);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Only show when subscription is truly blocked
  const isBlocked = subscriptionStatus === 'trial_expired' || subscriptionStatus === 'suspended';

  if (loading || !isBlocked) return null;

  const isTrialBlock = subscriptionStatus === 'trial_expired';
  const isSuspendedBlock = subscriptionStatus === 'suspended';

  // When the upgrade modal is open, hide this blocking overlay so the
  // UpgradeModal (lower z-index) is fully interactive. Closing the upgrade
  // modal brings this back automatically.
  if (showUpgrade) {
    return (
      <UpgradeModal
        onClose={() => setShowUpgrade(false)}
        triggerReason={isTrialBlock ? 'Your free trial has ended. Choose a plan to continue.' : 'Reactivate your subscription.'}
      />
    );
  }

  return (
    <>
      <div style={overlayStyle}>
        <div style={cardStyle}>
          {/* Icon */}
          <div style={iconContainerStyle}>
            <WarningTriangle width={48} height={48} color="#dc2626" />
          </div>

          {/* Title */}
          <h2 style={titleStyle}>
            {isTrialBlock ? 'Your Free Trial Has Ended' : 'Subscription Suspended'}
          </h2>

          {/* Description */}
          <p style={descStyle}>
            {isTrialBlock
              ? 'Your 7-day free trial has expired. To continue using Pioneer\'s car workshop management platform, please upgrade to a paid plan.'
              : 'Your subscription has been suspended due to a billing issue. Please update your payment information to restore access.'}
          </p>

          {/* Data safety message */}
          <div style={safetyBannerStyle}>
            <span style={{ fontWeight: 600 }}>🔒 Your data is safe</span>
            <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
              All your orders, customers, mechanics, and settings are preserved. 
              They will be fully restored once you upgrade.
            </p>
          </div>

          {/* Action buttons */}
          <div style={buttonContainerStyle}>
            <button
              onClick={() => setShowUpgrade(true)}
              style={primaryBtnStyle}
            >
              {isTrialBlock ? '🚀 Upgrade Now' : '💳 Update Billing'}
            </button>

            <a
              href="https://pioneercarservice.com/service-pricing"
              target="_blank"
              rel="noopener noreferrer"
              style={secondaryBtnStyle}
            >
              View ServicePricing Plans
            </a>

            <button
              onClick={() => { if (logout) logout(); }}
              style={logoutBtnStyle}
            >
              Log Out
            </button>
          </div>

          {/* Support link */}
          <p style={supportStyle}>
            Need help? Contact us at{' '}
            <a href="mailto:info@pioneercarservice.com" style={{ color: '#2563eb' }}>info@pioneercarservice.com</a>
          </p>
        </div>
      </div>
    </>
  );
}

/* ── Inline styles (no CSS file needed — blocking modal) ──── */
const overlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 99999,
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
};

const cardStyle = {
  background: '#fff',
  borderRadius: '16px',
  padding: '40px',
  maxWidth: '520px',
  width: '90%',
  textAlign: 'center',
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  animation: 'fadeInUp 0.3s ease-out',
};

const iconContainerStyle = {
  marginBottom: '16px',
};

const titleStyle = {
  fontSize: '24px',
  fontWeight: 700,
  color: '#111827',
  marginBottom: '12px',
};

const descStyle = {
  fontSize: '15px',
  color: '#4b5563',
  lineHeight: 1.6,
  marginBottom: '20px',
};

const safetyBannerStyle = {
  background: '#f0fdf4',
  border: '1px solid #bbf7d0',
  borderRadius: '10px',
  padding: '12px 16px',
  marginBottom: '24px',
  color: '#166534',
  fontSize: '14px',
  textAlign: 'left',
};

const buttonContainerStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  marginBottom: '20px',
};

const primaryBtnStyle = {
  padding: '14px 24px',
  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  fontSize: '16px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'transform 0.1s',
};

const secondaryBtnStyle = {
  display: 'inline-block',
  padding: '12px 24px',
  background: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'none',
  textAlign: 'center',
};

const logoutBtnStyle = {
  padding: '10px 24px',
  background: 'transparent',
  color: '#6b7280',
  border: 'none',
  borderRadius: '10px',
  fontSize: '13px',
  cursor: 'pointer',
  textDecoration: 'underline',
};

const supportStyle = {
  fontSize: '13px',
  color: '#9ca3af',
  margin: 0,
};
