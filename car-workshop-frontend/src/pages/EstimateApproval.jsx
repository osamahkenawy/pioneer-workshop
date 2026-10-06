/**
 * EstimateApproval — public, no-login page a customer reaches from the
 * "Review and approve" link in the estimate email (routes/estimates.js
 * POST /:id/send). Mirrors CustomerSurveyPublic.jsx's shape: plain fetch
 * against /api/public/..., no auth headers, its own small CSS file.
 *
 * The interaction is per line, not one "approve the estimate" button,
 * because that is what the backend actually models (estimate_lines.
 * customer_status) and what the workshop asked for: a customer can accept
 * the labour and decline a part, or vice versa. The job card is created
 * automatically the moment every line has been decided and none were
 * rejected — this page just reflects that back; it has no "create job card"
 * action of its own to keep in sync with the server's own rollup.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import './EstimateApproval.css';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const TYPE_LABEL = {
  labour: 'Labour', parts: 'Parts', sublet: 'Sublet',
  consumable: 'Consumables', discount: 'Discount',
};

const fmt = n => `AED ${Number(n || 0).toFixed(2)}`;

export default function EstimateApproval() {
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | ready | invalid | expired | error
  const [estimate, setEstimate] = useState(null);
  const [lines, setLines] = useState([]);
  const [busyLineId, setBusyLine] = useState(null);
  const [banner, setBanner] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/public/estimates/${token}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 410) { setPhase('expired'); return; }
      if (!res.ok || !json.success) { setPhase('invalid'); return; }
      setEstimate(json.estimate);
      setLines(json.lines || []);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const by = {};
    for (const l of lines) (by[l.line_type] ||= []).push(l);
    // Fixed order: labour first (what work costs), then parts, then the rest —
    // matches how the estimate email itself lists them.
    return ['labour', 'parts', 'sublet', 'consumable', 'discount']
      .filter(t => by[t]?.length)
      .map(t => [t, by[t]]);
  }, [lines]);

  const pendingCount = lines.filter(l => l.customer_status === 'pending').length;
  const jobCardCreated = estimate?.work_order_id != null;

  async function decide(lineId, decision) {
    setBusyLine(lineId);
    setBanner('');
    try {
      const res = await fetch(`${API_BASE}/public/estimates/${token}/lines/${lineId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, name: name.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setBanner(json.message || 'Could not record your decision. Please try again.');
        return;
      }
      if (json.work_order_created) {
        setBanner(`All items approved — job card ${json.work_order_number} has been created. The workshop will be in touch.`);
      }
      await load();
    } catch {
      setBanner('Network error — please try again.');
    } finally {
      setBusyLine(null);
    }
  }

  if (phase === 'loading') {
    return <div className="ea-page"><div className="ea-card ea-center">Loading your estimate…</div></div>;
  }
  if (phase === 'invalid') {
    return <div className="ea-page"><div className="ea-card ea-center">
      <h1>Link not found</h1>
      <p>This approval link isn't valid. Please contact the workshop for a new one.</p>
    </div></div>;
  }
  if (phase === 'expired') {
    return <div className="ea-page"><div className="ea-card ea-center">
      <h1>This link has expired</h1>
      <p>Ask the workshop to resend your estimate.</p>
    </div></div>;
  }
  if (phase === 'error') {
    return <div className="ea-page"><div className="ea-card ea-center">
      <h1>Something went wrong</h1>
      <p>Please refresh the page, or contact the workshop directly.</p>
    </div></div>;
  }

  return (
    <div className="ea-page">
      <div className="ea-card">
        <div className="ea-header">
          <div className="ea-brand">Pioneer Car Service Center</div>
          <h1>Estimate {estimate.estimate_number}</h1>
          <div className="ea-meta">
            {estimate.customer_name && <span>{estimate.customer_name}</span>}
            {estimate.vehicle_plate && <span>{estimate.vehicle_plate}</span>}
          </div>
        </div>

        {jobCardCreated && (
          <div className="ea-banner ea-banner-ok">
            Every item has been decided. Job card created — the workshop has been notified and will begin work.
          </div>
        )}
        {!jobCardCreated && estimate.status === 'rejected' && (
          <div className="ea-banner ea-banner-warn">
            You've declined this estimate. No job card was created. Contact the workshop if you'd like to discuss it.
          </div>
        )}
        {banner && !jobCardCreated && <div className="ea-banner ea-banner-info">{banner}</div>}

        <p className="ea-instructions">
          Please review each item below and approve or reject it. Work only begins once every item has been decided.
        </p>

        {!jobCardCreated && (
          <label className="ea-name-field">
            Your name (optional, for our records)
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
          </label>
        )}

        {grouped.map(([type, rows]) => (
          <div key={type} className="ea-section">
            <div className="ea-section-title">{TYPE_LABEL[type] || type}</div>
            {rows.map(l => (
              <div key={l.id} className={`ea-line ea-line-${l.customer_status}`}>
                <div className="ea-line-main">
                  <div className="ea-line-desc">
                    {l.description}
                    {l.quantity > 1 && <span className="ea-line-qty"> × {l.quantity}</span>}
                    {l.urgency === 'now' && <span className="ea-tag ea-tag-urgent">Needs attention</span>}
                  </div>
                  <div className="ea-line-price">{fmt(l.line_total ?? l.quantity * l.unit_price)}</div>
                </div>
                {l.customer_status === 'pending' ? (
                  <div className="ea-line-actions">
                    <button className="ea-btn ea-btn-approve" disabled={busyLineId === l.id}
                      onClick={() => decide(l.id, 'approved')}>
                      {busyLineId === l.id ? '…' : 'Approve'}
                    </button>
                    <button className="ea-btn ea-btn-reject" disabled={busyLineId === l.id}
                      onClick={() => decide(l.id, 'rejected')}>
                      {busyLineId === l.id ? '…' : 'Reject'}
                    </button>
                  </div>
                ) : (
                  <div className={`ea-decided ea-decided-${l.customer_status}`}>
                    {l.customer_status === 'approved' ? '✓ Approved' : '✕ Rejected'}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        <div className="ea-totals">
          <div><span>Subtotal — labour</span><span>{fmt(estimate.subtotal_labour)}</span></div>
          <div><span>Subtotal — parts</span><span>{fmt(estimate.subtotal_parts)}</span></div>
          {Number(estimate.subtotal_sublet) > 0 && (
            <div><span>Subtotal — sublet</span><span>{fmt(estimate.subtotal_sublet)}</span></div>
          )}
          <div><span>VAT ({estimate.vat_rate}%)</span><span>{fmt(estimate.vat_amount)}</span></div>
          <div className="ea-total-grand"><span>Total</span><span>{fmt(estimate.total_amount)}</span></div>
        </div>

        {pendingCount > 0 && (
          <p className="ea-remaining">{pendingCount} item{pendingCount > 1 ? 's' : ''} still need your decision.</p>
        )}
      </div>
    </div>
  );
}
