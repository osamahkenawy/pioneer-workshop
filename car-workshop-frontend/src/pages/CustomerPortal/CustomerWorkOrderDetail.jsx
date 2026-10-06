/* ══════════════════════════════════════════════════════════════
 * CustomerWorkOrderDetail.jsx — Single WorkOrder View with Timeline
 * Route: /merchant/work-orders/:id
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useContext } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Xmark, Copy, CheckCircle } from 'iconoir-react';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import api from '../../lib/customerApi';
import { shareViaWhatsApp, buildOrderMessage } from '../../lib/whatsapp';
import './CustomerPages.css';

/* ── WhatsApp SVG Icon ── */
const WhatsAppIcon = ({ width = 16, height = 16, color = 'currentColor' }) => (
  <svg width={width} height={height} viewBox="0 0 24 24" fill={color}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const STATUS_COLORS = {
  pending: '#f59e0b', confirmed: '#3b82f6', assigned: '#8b5cf6', accepted: '#1565C0',
  in_progress: '#0e7490', ready_for_pickup: '#c2410c', completed: '#10b981', failed: '#ef4444', cancelled: '#94a3b8',
};
const PART_STATUS_COLORS = { ordered: '#f59e0b', in_stock: '#3b82f6', installed: '#10b981', returned: '#ef4444' };

export default function CustomerWorkOrderDetail() {
  const { workshop } = useContext(CustomerAuthContext);
  const cur = workshop?.currency || 'AED';
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/customer-portal/work-orders/${id}`);
        if (res.success) setOrder(res.data);
      } catch (err) {
        console.error('Failed to fetch order:', err);
      }
      setLoading(false);
    })();
  }, [id]);

  const cancelOrder = async () => {
    if (!confirm('Cancel this order?')) return;
    const res = await api.delete(`/customer-portal/work-orders/${id}`);
    if (res.success) navigate('/merchant/work-orders');
    else alert(res.message);
  };

  const downloadLabel = async () => {
    try {
      const token = localStorage.getItem('crm_token');
      const API_URL = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${API_URL}/customer-portal/work-orders/${id}/invoice`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      if (!res.ok) { alert('Failed to generate document'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `work-order-${order?.work_order_number}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { alert('Download error'); }
  };

  const copyTracking = () => {
    navigator.clipboard.writeText(order?.service_status_token || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <div className="cp-loading"><div className="cp-spinner" /></div>;
  if (!order) return <div className="cp-page"><p>WorkOrder not found</p></div>;

  const o = order;

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/merchant/work-orders" className="cp-back-btn"><ArrowLeft width={18} height={18} /></Link>
          <div>
            <h1 className="cp-page-title" style={{ margin: 0 }}>{o.work_order_number}</h1>
            <span className="cp-cell-sub">Created {new Date(o.created_at).toLocaleString()}</span>
            {o.completed_at && (
              <span className="cp-cell-sub" style={{ color: '#10b981', fontWeight: 600, marginLeft: 12 }}>
                Completed {new Date(o.completed_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="cp-btn cp-btn-outline" onClick={downloadLabel}><Download width={16} height={16} /> Invoice</button>
          <button className="wa-share-btn" onClick={() => {
            const trackingUrl = window.location.origin;
            const msg = buildOrderMessage(o, null, trackingUrl);
            shareViaWhatsApp(o.customer_phone, msg);
          }} title="Share via WhatsApp">
            <WhatsAppIcon width={15} height={15} color="#fff" /> Share
          </button>
          {['pending', 'confirmed'].includes(o.status) && (
            <button className="cp-btn cp-btn-danger" onClick={cancelOrder}><Xmark width={16} height={16} /> Cancel</button>
          )}
        </div>
      </div>

      {/* Status badge */}
      <div style={{ marginBottom: 24 }}>
        <span className="cp-status-badge cp-status-badge-lg" style={{ background: STATUS_COLORS[o.status] + '18', color: STATUS_COLORS[o.status], borderColor: STATUS_COLORS[o.status] + '40' }}>
          {o.status?.replace(/_/g, ' ').toUpperCase()}
        </span>
        {o.service_status_token && (
          <button className="cp-copy-btn" onClick={copyTracking} style={{ marginLeft: 16 }}>
            {copied ? <CheckCircle width={14} height={14} /> : <Copy width={14} height={14} />}
            {copied ? 'Copied!' : o.service_status_token}
          </button>
        )}
        {o.awb_number && <span className="cp-awb-tag">AWB: {o.awb_number}</span>}
      </div>

      <div className="cp-detail-grid">
        {/* Left: Info Cards */}
        <div className="cp-detail-left">
          <div className="cp-detail-card">
            <h3 className="cp-detail-card-title">Vehicle</h3>
            {o.vehicle ? (
              <>
                <p className="cp-detail-val">{o.vehicle.make} {o.vehicle.model} {o.vehicle.year ? `(${o.vehicle.year})` : ''}</p>
                <p className="cp-detail-sub">{o.vehicle.plate_number || '—'}{o.vehicle.color ? ` · ${o.vehicle.color}` : ''}</p>
              </>
            ) : <p className="cp-detail-sub">No vehicle on record</p>}
          </div>

          <div className="cp-detail-card">
            <h3 className="cp-detail-card-title">Customer</h3>
            <p className="cp-detail-val">{o.customer_name || '—'}</p>
            <p className="cp-detail-sub" style={{ display:'flex', alignItems:'center', gap:6 }}>
              {o.customer_phone}
              {o.customer_phone && (
                <button className="wa-share-inline" onClick={() => {
                  const msg = buildOrderMessage(o, null, window.location.origin);
                  shareViaWhatsApp(o.customer_phone, msg);
                }} title="Share via WhatsApp">
                  <WhatsAppIcon width={18} height={18} color="#fff" />
                </button>
              )}
            </p>
            {o.dropoff_address && <p className="cp-detail-sub">{o.dropoff_address}</p>}
          </div>

          <div className="cp-detail-card">
            <h3 className="cp-detail-card-title">Service Details</h3>
            <div className="cp-detail-row"><span>Type:</span><span>{o.work_order_type}</span></div>
            <div className="cp-detail-row"><span>Category:</span><span>{o.service_category?.replace(/_/g, ' ')}</span></div>
            {o.description && <div className="cp-detail-row"><span>Description:</span><span>{o.description}</span></div>}
            {o.special_instructions && <div className="cp-detail-row"><span>Instructions:</span><span>{o.special_instructions}</span></div>}
          </div>

          {/* Parts */}
          {o.parts?.length > 0 && (
            <div className="cp-detail-card">
              <h3 className="cp-detail-card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Parts</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#f97316', background: '#fff7ed', padding: '2px 10px', borderRadius: 10 }}>
                  {o.parts.filter(p => p.status === 'installed').length}/{o.parts.length}
                </span>
              </h3>
              {o.parts.map((part, idx) => (
                <div key={part.id || idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: idx < o.parts.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{part.quantity}× {part.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      {part.part_number ? `#${part.part_number}` : ''}
                      {parseFloat(part.total_cost) > 0 ? ` · ${cur} ${parseFloat(part.total_cost).toFixed(2)}` : ''}
                    </div>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#fff',
                    background: PART_STATUS_COLORS[part.status] || '#94a3b8' }}>
                    {part.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="cp-detail-card">
            <h3 className="cp-detail-card-title">Payment</h3>
            <div className="cp-detail-row"><span>Method:</span><span className="cp-badge">{o.payment_method?.toUpperCase()}</span></div>
            <div className="cp-detail-row"><span>Service Fee:</span><span>{cur} {o.service_fee}</span></div>
            {o.discount > 0 && <div className="cp-detail-row"><span>Discount:</span><span>-{cur} {o.discount}</span></div>}
            <div className="cp-detail-row"><span>Total:</span><strong>{cur} {o.total_amount}</strong></div>
            {o.payment_method === 'cash' && <div className="cp-detail-row"><span>Cash Amount:</span><strong>{cur} {o.cash_amount}</strong></div>}
          </div>

          {o.mechanic_name && (
            <div className="cp-detail-card">
              <h3 className="cp-detail-card-title">Mechanic</h3>
              <p className="cp-detail-val">{o.mechanic_name}</p>
              <p className="cp-detail-sub" style={{ display:'flex', alignItems:'center', gap:6 }}>
                {o.mechanic_phone}
                {o.mechanic_phone && (
                  <button className="wa-share-inline" onClick={() => {
                    const msg = buildOrderMessage(o, null, window.location.origin);
                    shareViaWhatsApp(o.mechanic_phone, msg);
                  }} title="Share via WhatsApp">
                    <WhatsAppIcon width={18} height={18} color="#fff" />
                  </button>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Right: Timeline */}
        <div className="cp-detail-right">
          <div className="cp-detail-card">
            <h3 className="cp-detail-card-title">Status Timeline</h3>
            <div className="cp-timeline">
              {(o.timeline || []).map((tl, i) => (
                <div key={i} className={`cp-timeline-item ${i === (o.timeline || []).length - 1 ? 'cp-tl-active' : ''}`}>
                  <div className="cp-tl-dot" style={{ background: STATUS_COLORS[tl.status] || '#94a3b8' }} />
                  <div className="cp-tl-content">
                    <span className="cp-tl-status">{tl.status?.replace(/_/g, ' ')}</span>
                    {tl.note && <span className="cp-tl-notes">{tl.note}</span>}
                    <span className="cp-tl-time">{new Date(tl.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {(!o.timeline || o.timeline.length === 0) && (
                <p className="cp-detail-sub">No status updates yet</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
