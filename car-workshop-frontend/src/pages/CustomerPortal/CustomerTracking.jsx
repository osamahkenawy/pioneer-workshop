/* ══════════════════════════════════════════════════════════════
 * CustomerTracking.jsx — Public-Style Tracking Page for Merchants
 * ══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { Search, Package, MapPin, Calendar, Wrench, Box } from 'iconoir-react';
import './CustomerPages.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const STATUS_STEPS = ['pending', 'confirmed', 'assigned', 'accepted', 'in_progress', 'ready_for_pickup', 'completed'];
const STATUS_LABELS = {
  pending:          'Pending',
  confirmed:        'Confirmed',
  assigned:         'Mechanic Assigned',
  accepted:         'Accepted',
  in_progress:      'In Progress',
  ready_for_pickup: 'Ready for Pickup',
  completed:        'Completed',
  cancelled:        'Cancelled',
};

export default function CustomerTracking() {
  const [query, setQuery]       = useState('');
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const token = localStorage.getItem('crm_token');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const handleTrack = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setError(''); setResult(null); setLoading(true);

    try {
      const res = await fetch(`${API_URL}/customer-portal/service-status/${encodeURIComponent(query.trim())}`, {
        headers, credentials: 'include',
      });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      const data = await res.json();
      if (data.success) setResult(data.data);
      else setError(data.message || 'Work order not found');
    } catch { setError('Tracking failed'); }
    setLoading(false);
  };

  const currentStep = result ? STATUS_STEPS.indexOf(result.status) : -1;

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <h1 className="cp-page-title">Track Service</h1>
      </div>

      {/* Search */}
      <div className="cp-card" style={{ maxWidth: 600 }}>
        <form onSubmit={handleTrack} className="cp-tracking-form">
          <div className="cp-tracking-input-wrap">
            <Search width={18} height={18} />
            <input
              type="text"
              className="cp-form-input"
              placeholder="Enter order number, tracking token, or package barcode..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ paddingLeft: 40 }}
            />
          </div>
          <button type="submit" className="cp-btn cp-btn-primary" disabled={loading}>
            {loading ? <span className="cp-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : 'Track'}
          </button>
        </form>
        {error && <p className="cp-error-text" style={{ marginTop: 12 }}>{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="cp-tracking-result" style={{ marginTop: 24 }}>
          {/* Header */}
          <div className="cp-card">
            <div className="cp-tracking-header">
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                  <Package width={18} height={18} style={{ marginRight: 6, verticalAlign: -3 }} />
                  {result.work_order_number}
                </h3>
                <p className="cp-detail-sub" style={{ marginTop: 4 }}>
                  {result.service_status_token && `Tracking: ${result.service_status_token}`}
                </p>
              </div>
              <span className={`cp-status-badge status-${result.status}`}>
                {STATUS_LABELS[result.status] || result.status}
              </span>
            </div>
          </div>

          {/* Progress Steps */}
          {!['cancelled'].includes(result.status) && (
            <div className="cp-card" style={{ marginTop: 16 }}>
              <h4 className="cp-card-title">Service Progress</h4>
              <div className="cp-progress-track">
                {STATUS_STEPS.map((step, i) => (
                  <div key={step} className={`cp-progress-step ${i <= currentStep ? 'cp-step-active' : ''} ${i === currentStep ? 'cp-step-current' : ''}`}>
                    <div className="cp-step-dot" />
                    <span className="cp-step-label">{STATUS_LABELS[step]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Details */}
          <div className="cp-detail-grid" style={{ marginTop: 16 }}>
            <div className="cp-card">
              <h4 className="cp-card-title"><MapPin width={16} height={16} /> Customer</h4>
              <p style={{ fontWeight: 600 }}>{result.customer_name}</p>
              <p className="cp-detail-sub">{result.customer_phone}</p>
              {result.dropoff_address && <p className="cp-detail-sub">{result.dropoff_address}</p>}
            </div>
            <div className="cp-card">
              <h4 className="cp-card-title"><Wrench width={16} height={16} /> Service</h4>
              <p className="cp-detail-sub"><Calendar width={14} height={14} style={{ verticalAlign: -2 }} /> Created: {new Date(result.created_at).toLocaleDateString()}</p>
              {result.completed_at && <p className="cp-detail-sub">Completed: {new Date(result.completed_at).toLocaleDateString()}</p>}
              <p className="cp-detail-sub"><Box width={14} height={14} style={{ verticalAlign: -2 }} /> {result.description || '—'}</p>
              {result.mechanic_name && <p className="cp-detail-sub">Mechanic: {result.mechanic_name}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
