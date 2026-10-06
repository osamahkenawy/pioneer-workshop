import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatsUpSquare, Home, Car, Scissor } from 'iconoir-react';
import './BusinessTypeSelector.css';

const businessTypes = [
  {
    id: 'crm',
    icon: <StatsUpSquare width={24} height={24} />,
    title: 'General CRM',
    subtitle: 'Sales, leads & contacts',
    description: 'Full CRM suite with pipelines, deals, campaigns, and more.',
    color: '#1e3a6b',
    gradient: 'linear-gradient(135deg, #1e3a6b, #3b6cb3)',
    route: '/dashboard',
    features: ['Leads & Deals', 'Pipelines', 'Campaigns', 'Reports'],
  },
  {
    id: 'beauty',
    icon: <Scissor width={24} height={24} />,
    title: 'Beauty Center',
    subtitle: 'Salon & spa management',
    description: 'Appointments, services, staff scheduling, and loyalty programs.',
    color: '#E91E63',
    gradient: 'linear-gradient(135deg, #E91E63, #c2185b)',
    route: '/beauty-dashboard',
    features: ['Appointments', 'Services', 'Staff Schedule', 'Loyalty'],
  },
  {
    id: 'realestate',
    icon: <Home width={24} height={24} />,
    title: 'Real Estate',
    subtitle: 'Properties & listings',
    description: 'Manage properties, listings, workshops, and real estate deals.',
    color: '#ff9f43',
    gradient: 'linear-gradient(135deg, #ff9f43, #e67e22)',
    route: '/dashboard',
    features: ['Listings', 'Properties', 'Workshops', 'Contracts'],
    comingSoon: true,
  },
  {
    id: 'auto',
    icon: <Car width={24} height={24} />,
    title: 'Auto Dealership',
    subtitle: 'Vehicle sales & service',
    description: 'Inventory, test drives, financing, and service management.',
    color: '#00cfe8',
    gradient: 'linear-gradient(135deg, #00cfe8, #0097a7)',
    route: '/dashboard',
    features: ['Inventory', 'Test Drives', 'Financing', 'Service'],
    comingSoon: true,
  },
];

export default function BusinessTypeSelector({ show, onClose, onSelect }) {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState(null);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    if (show) {
      requestAnimationFrame(() => setAnimateIn(true));
    } else {
      setAnimateIn(false);
    }
  }, [show]);

  const handleSelect = (type) => {
    if (type.comingSoon) return;
    setSelectedType(type.id);

    // Save preference
    localStorage.setItem('crm_business_type', type.id);

    // Animate out then navigate
    setTimeout(() => {
      setAnimateIn(false);
      setTimeout(() => {
        onSelect?.(type.id);
        onClose?.();
        navigate(type.route);
      }, 300);
    }, 400);
  };

  const handleSkip = () => {
    localStorage.setItem('crm_business_type', 'crm');
    setAnimateIn(false);
    setTimeout(() => {
      onSelect?.('crm');
      onClose?.();
      navigate('/dashboard');
    }, 300);
  };

  if (!show) return null;

  return (
    <div className={`bts-overlay ${animateIn ? 'show' : ''}`}>
      <div className={`bts-modal ${animateIn ? 'show' : ''}`}>
        {/* Header */}
        <div className="bts-header">
          <div className="bts-logo">
            <img
              src="/assets/images/logos/T_ONLY.png"
              alt="Pioneer"
              style={{ height: 40 }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          </div>
          <h2>Welcome to Pioneer</h2>
          <p>Select your business type to get a personalized experience</p>
        </div>

        {/* Business Type Cards */}
        <div className="bts-grid">
          {businessTypes.map((type, idx) => (
            <button
              key={type.id}
              className={`bts-card ${selectedType === type.id ? 'selected' : ''} ${type.comingSoon ? 'coming-soon' : ''}`}
              onClick={() => handleSelect(type)}
              style={{
                animationDelay: `${idx * 0.08}s`,
                '--card-color': type.color,
                '--card-gradient': type.gradient,
              }}
            >
              {type.comingSoon && <span className="bts-badge-soon">Coming Soon</span>}

              <div className="bts-card-icon">
                <span>{type.icon}</span>
              </div>

              <h3>{type.title}</h3>
              <span className="bts-card-subtitle">{type.subtitle}</span>
              <p className="bts-card-desc">{type.description}</p>

              <div className="bts-features">
                {type.features.map(f => (
                  <span key={f} className="bts-feature-tag">{f}</span>
                ))}
              </div>

              {selectedType === type.id && (
                <div className="bts-check">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <circle cx="14" cy="14" r="14" fill={type.color} />
                    <path d="M8 14.5L12 18.5L20 10.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="bts-footer">
          <button className="bts-skip" onClick={handleSkip}>
            Skip for now — take me to General CRM
          </button>
          <p className="bts-change-note">
            You can switch your business type anytime from settings
          </p>
        </div>
      </div>
    </div>
  );
}
