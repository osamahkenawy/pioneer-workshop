import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, User, Phone, Clock, Check, Refresh, EditPencil, Hashtag,
  DollarCircle, Calendar, CreditCard, Box3dPoint, ArrowRight, Copy,
  WarningTriangle, Notes, Printer, Eye, OpenNewWindow, Wrench, ClipboardCheck,
  Group, Undo, Prohibition, Page,
} from 'iconoir-react';
import { AuthContext } from '../context/AuthContext';
import api from '../lib/api';
import { canDo } from '../lib/permissions';
import { shareViaWhatsApp, buildStatusMessage } from '../lib/whatsapp';
import { woLabel, woTone } from '../lib/statusLabels';
import { customerStatusUrl } from '../lib/customerLink';
import { isTechnician } from '../lib/modules';
import './CRMPages.css';
import './WorkOrderDetail.css';
import JobCardWorkflow from '../components/workflow/JobCardWorkflow';
import { useTranslation } from 'react-i18next';
import { fmtCurrency } from '../utils/currency';

/* ── WhatsApp SVG Icon ── */
const WhatsAppIcon = ({ width = 16, height = 16, color = 'currentColor' }) => (
  <svg width={width} height={height} viewBox="0 0 24 24" fill={color}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

/* ── Status changes by hand ───────────────────────────────── */
/* The Steps 1–7 workflow below moves the job card on (assigning, booking
   time, the quality check, the gate pass). By hand, staff only cancel a job
   or reopen a cancelled one; a manager can also override the status when the
   workflow is stuck — never to 'accepted', the courier "driver accepted"
   step. Same rules as the Work Orders list. */
const NEXT_STATUSES = {
  estimate_approved: ['confirmed', 'cancelled'],
  pending:          ['confirmed', 'cancelled'],
  confirmed:        ['assigned', 'in_progress', 'cancelled'],
  assigned:         ['accepted', 'in_progress', 'cancelled', 'confirmed'],
  accepted:         ['in_progress', 'cancelled', 'assigned'],
  in_progress:      ['inspection', 'ready_for_pickup', 'cancelled'],
  inspection:       ['ready_for_pickup', 'in_progress', 'cancelled'],
  ready_for_pickup: ['completed', 'cancelled'],
  completed:        [],
  cancelled:        ['pending'],
};
// Who may move a job card to each status — mirrors the capability check on
// PATCH /work-orders/:id/status (backend lib/roles.js; managers hold all).
const STATUS_CAPS = {
  cancelled: ['job.open'], pending: ['job.open'], confirmed: ['job.open'],
  assigned: ['job.assign'], accepted: ['job.assign'],
  in_progress: ['time.book', 'job.assign'],
  inspection: ['qc.perform', 'job.assign'], ready_for_pickup: ['qc.perform', 'job.assign'],
  completed: ['delivery.handover'],
};
const canSetStatus = (user, status) => (STATUS_CAPS[status] || []).some(c => canDo(user, c));
// Mirrors lib/roles.js isManagerRole.
const MANAGER_ROLES = ['admin', 'super_admin', 'general_manager', 'workshop_manager'];
const isManager = u => !!u && (u.is_owner === true || Number(u.is_owner) === 1
  || MANAGER_ROLES.includes(u.role) || MANAGER_ROLES.includes(u.role_slug));

/* How the job is to be paid (work_orders.payment_method). Workshop words:
   'credit' is a customer on account; 'cod' (old imported rows) was cash. */
const PAYMENT_LABELS = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', credit: 'On account',
  prepaid: 'Prepaid', wallet: 'Account balance',
};
const paymentLabel = (t, method) => {
  const key = method === 'cod' ? 'cash' : method;
  return PAYMENT_LABELS[key] ? t(`orderDetail.payment_method.${key}`, PAYMENT_LABELS[key]) : fmtType(method);
};

/* ── Helpers ────────────────────────────────────────────────── */
const fmtDatetime = d => d ? new Date(d).toLocaleString('en-AE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

const fmtType = t => t ? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—';

/** A phone number as wa.me wants it: digits, UAE local numbers given 971. */
const waPhone = (phone) => {
  let digits = String(phone || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = '971' + digits.slice(1);
  if (digits && digits.length <= 10 && !digits.startsWith('971')) digits = '971' + digits;
  return digits;
};

/* Parse a notes column that may hold either freeform text or the JSON payload
   the Oracle migration stamps on every work order. Internal keys hidden. */
const NOTES_HIDDEN_KEYS = new Set(['src', 'src_id', 'batch']);
const NOTES_LABEL_OVERRIDES = {
  loc:        'Location',
  job_type:   'Job Type',
  svc_type:   'Service Type',
  operator:   'Operator',
  salesman:   'Salesman',
  inv:        'Invoice #',
  party_code: 'Account Code',
  opening_km: 'Opening KM',
  kind:       'Kind',
};
function parseSrcNotes(raw) {
  if (raw === null || raw === undefined || raw === '') return { kind: 'empty' };
  if (typeof raw !== 'string') return { kind: 'text', text: String(raw) };
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { kind: 'text', text: raw };
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'text', text: raw };
    const entries = Object.entries(parsed)
      .filter(([k, v]) => !NOTES_HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== '')
      .map(([k, v]) => [NOTES_LABEL_OVERRIDES[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    return { kind: 'json', entries, source: parsed.src || null };
  } catch {
    return { kind: 'text', text: raw };
  }
}

/* ── StatusBadge ────────────────────────────────────────────── */
/* The work order's status in the workshop's words (lib/statusLabels.js). */
const StatusBadge = ({ wo, size = 'md' }) => {
  const { t } = useTranslation();
  const tone = woTone(wo);
  const Icon = tone.icon;
  return (
    <span className={`ord-status-badge ${size === 'lg' ? 'lg' : ''}`} style={{ background: tone.bg, color: tone.color }}>
      <Icon width={size === 'lg' ? 14 : 12} height={size === 'lg' ? 14 : 12} /> {woLabel(t, wo)}
    </span>
  );
};

/* ── QuickStat ──────────────────────────────────────────────── */
const QuickStat = ({ icon: Icon, label, value, color, bg }) => (
  <div className="od-quick-stat" style={{ '--qs-color': color, '--qs-bg': bg }}>
    <div className="od-quick-stat-icon"><Icon width={18} height={18} /></div>
    <div className="od-quick-stat-body">
      <span className="od-quick-stat-value">{value}</span>
      <span className="od-quick-stat-label">{label}</span>
    </div>
  </div>
);

/* ── InfoRow ────────────────────────────────────────────────── */
const InfoRow = ({ icon: Icon, label, value, mono, accent }) => (
  <div className="od-info-row">
    <Icon width={15} height={15} className="od-info-icon" style={accent ? { color: accent } : undefined} />
    <span className="od-info-label">{label}</span>
    <span className={`od-info-value${mono ? ' mono' : ''}`}>{value || '—'}</span>
  </div>
);

/* ══════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════ */
export default function WorkOrderDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, workshop } = useContext(AuthContext);
  // A technician works from My Jobs, which opens this job's card for them:
  // this staff page shows prices and makes staff calls they would be refused.
  const technician = isTechnician(user);

  const cur = workshop?.currency || 'AED';
  const fmtAED = (v) => fmtCurrency(v, cur);

  const [order, setOrder] = useState(null);
  const [mechanics, setMechanics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusNote, setStatusNote] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [approvalChannel, setApprovalChannel] = useState('in_person');
  const [approvalNote, setApprovalNote] = useState('');
  const [savingApproval, setSavingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [showReassign, setShowReassign] = useState(false);
  const [reassignMechanic, setReassignMechanic] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  /* ── Customer journey + follow-up call state ── */
  const [followUp, setFollowUp] = useState(null);

  // The courier packages / multi-stop tabs, their map and their API calls
  // are gone: those endpoints were removed with the delivery product.
  useEffect(() => {
    if (technician) { navigate(`/mechanic?wo=${encodeURIComponent(id)}`, { replace: true }); return; }
    fetchOrder(); fetchMechanics(); fetchFollowUp();
  }, [id, technician]); // eslint-disable-line react-hooks/exhaustive-deps

  // A network error used to leave the skeleton up forever (setLoading(false)
  // never ran), and any failure other than 404 showed "not found".
  const [loadError, setLoadError] = useState('');
  // quiet: refresh in place (after a workflow action) instead of swapping
  // the whole page for the loading skeleton.
  const fetchOrder = async (quiet = false) => {
    if (quiet !== true) setLoading(true);
    setLoadError('');
    try {
      const r = await api.get(`/work-orders/${id}`);
      if (r.success) setOrder(r.data);
      else if (r.status !== 404) setLoadError(r.message || 'Could not load this job card.');
    } catch {
      setLoadError('Network error — check the connection and try again.');
    } finally {
      setLoading(false);
    }
  };
  const fetchMechanics = async () => { const r = await api.get('/mechanics?limit=500'); if (r.success) setMechanics((r.data || []).filter(d => d.is_active)); };

  const fetchFollowUp = async () => {
    try { const r = await api.get(`/customer-feedback?work_order_id=${id}`); if (r.success) setFollowUp(r.data?.[0] || null); } catch {}
  };
  const updateFollowUp = async (status) => {
    if (!followUp) return;
    try { const r = await api.patch(`/customer-feedback/${followUp.id}`, { status }); if (r.success) setFollowUp(r.data); } catch {}
  };

  const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
  const openPdf = (url) => {
    const token = localStorage.getItem('auth_token');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { localStorage.removeItem('auth_token'); window.location.href = '/login'; throw new Error('Session expired'); } if (!r.ok) throw new Error('Failed'); return r.blob(); })
      .then(blob => { const u = URL.createObjectURL(blob); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); })
      .catch(e => console.error('PDF error:', e));
  };
  // The printed job sheet (A6, with the customer's QR code).
  const printJobSheet = () => openPdf(`${API_BASE_URL}/work-orders/${id}/label`);

  const handleStatusUpdate = async () => {
    if (!newStatus) return;
    setSavingStatus(true); setStatusError('');
    try {
      const r = await api.patch(`/work-orders/${id}/status`, { status: newStatus, note: statusNote });
      if (r.success) { setNewStatus(''); setStatusNote(''); fetchOrder(); }
      else setStatusError(r.message || 'Could not update the status.');
    } catch { setStatusError('Could not update the status.'); }
    setSavingStatus(false);
  };
  // Process step 6: the customer's agreement, recorded before work starts.
  const handleRecordApproval = async () => {
    setSavingApproval(true); setApprovalError('');
    try {
      const r = await api.patch(`/work-orders/${id}/customer-approval`, { channel: approvalChannel, note: approvalNote.trim() || undefined });
      if (r.success) { setApprovalNote(''); setStatusError(''); fetchOrder(); }
      else setApprovalError(r.message || 'Could not record the approval.');
    } catch { setApprovalError('Could not record the approval.'); }
    setSavingApproval(false);
  };
  // Step 6: the Team Leader assigns the technician. Same guarded route as
  // the workflow panel (job.assign), not the unguarded /job-assignment one.
  const handleReassign = async () => {
    if (!reassignMechanic) return;
    const mechanic = mechanics.find(d => String(d.id) === String(reassignMechanic));
    if (mechanic && mechanic.status === 'busy' && !window.confirm(t('orderDetail.busy_mechanic_warning'))) return;
    setReassigning(true); setAssignError('');
    try {
      const r = await api.patch(`/work-orders/${id}/assign-mechanic`, { mechanic_id: Number(reassignMechanic) });
      if (r.success) { setShowReassign(false); setReassignMechanic(''); fetchOrder(); fetchMechanics(); }
      else setAssignError(r.message || t('orderDetail.assign_failed', 'Could not assign the technician.'));
    } catch { setAssignError(t('orderDetail.assign_failed', 'Could not assign the technician.')); }
    setReassigning(false);
  };

  // The customer's status page (/service-status/:token); none for older
  // imported jobs without a token.
  const statusLink = customerStatusUrl(order);
  const copyLink = () => { if (!statusLink) return; navigator.clipboard.writeText(statusLink); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const customerPhone = order?.customer_phone || order?.customer_phone_ref || '';
  // The stage in customer words, the car, the job card and the status link.
  const sendWhatsApp = () => shareViaWhatsApp(waPhone(customerPhone), buildStatusMessage({ t, wo: order, link: statusLink, workshopName: workshop?.name }));

  // Cancel / Reopen for the roles allowed to; a manager's Override status.
  const closed = ['completed', 'cancelled'].includes(order?.status);
  const mayCancel = !closed && canSetStatus(user, 'cancelled');
  const mayReopen = order?.status === 'cancelled' && canSetStatus(user, 'pending');
  const overrides = isManager(user)
    ? (NEXT_STATUSES[order?.status] || []).filter(s => s !== 'accepted' && s !== 'cancelled' && order?.status !== 'cancelled' && canSetStatus(user, s))
    : [];
  const actionLabel = s => s === 'cancelled' ? t('orders.actions.cancel_order')
    : (s === 'pending' && order?.status === 'cancelled') ? t('orders.reopen', 'Reopen')
    : t('orderDetail.mark_as', { status: woLabel(t, s) });

  if (technician) return null;

  /* ══ LOADING ══ */
  if (loading) return (
    <div className="page-container">
      <div className="od-loading">
        <div className="skeleton-pulse" style={{ height: 40, width: 200, borderRadius: 8 }} />
        <div className="skeleton-pulse" style={{ height: 300, borderRadius: 12, marginTop: 20 }} />
      </div>
    </div>
  );

  if (!order && loadError) return (
    <div className="page-container">
      <div className="ord-empty">
        <WarningTriangle width={48} height={48} />
        <h3>{loadError}</h3>
        <button className="module-btn module-btn-primary" onClick={fetchOrder}>{t('common.retry', 'Try again')}</button>
      </div>
    </div>
  );

  if (!order) return (
    <div className="page-container">
      <div className="ord-empty">
        <ClipboardCheck width={48} height={48} />
        <h3>{t("orderDetail.order_not_found")}</h3>
        <button className="module-btn module-btn-primary" onClick={() => navigate('/work-orders')}><ArrowLeft width={15} height={15} /> {t('orderDetail.back_to_orders')}</button>
      </div>
    </div>
  );

  return (
    <div className="page-container od-modern">

      {/* ════════════════ HERO HEADER ════════════════ */}
      <div className="od-hero">
        <div className="od-hero-top">
          <button className="od-back-btn" onClick={() => navigate('/work-orders')}><ArrowLeft width={16} height={16} /> {t('orderDetail.orders_back')}</button>
          <div className="od-hero-actions">
            <button className="od-icon-action" onClick={fetchOrder} title={t('orderDetail.refresh')} aria-label={t('orderDetail.refresh')}><Refresh width={16} height={16} /></button>
            {/* No token (e.g. older imported jobs): no customer link. */}
            {statusLink && <>
              <button className="od-icon-action" onClick={copyLink} title={t('orders.copy_customer_link', 'Copy customer link')} aria-label={t('orders.copy_customer_link', 'Copy customer link')}>
                <Copy width={16} height={16} />
                {copied && <span className="od-copied-toast">{t('orderDetail.copied')}</span>}
              </button>
              <a href={statusLink} target="_blank" rel="noreferrer" className="od-icon-action" title={t('orders.open_customer_page', 'Open the customer\'s status page')} aria-label={t('orders.open_customer_page', 'Open the customer\'s status page')}><OpenNewWindow width={16} height={16} /></a>
            </>}
            <button className="od-icon-action" onClick={printJobSheet} title={t('orders.print_job_sheet', 'Print job sheet')} aria-label={t('orders.print_job_sheet', 'Print job sheet')}><Printer width={16} height={16} /></button>
            {customerPhone && (
              <button className="od-icon-action wa" onClick={sendWhatsApp} title={t('orders.actions.share_whatsapp', 'Share via WhatsApp')} aria-label={t('orders.actions.share_whatsapp', 'Share via WhatsApp')}>
                <WhatsAppIcon width={16} height={16} color="#fff" />
              </button>
            )}
          </div>
        </div>
        <div className="od-hero-identity">
          <div className="od-hero-left">
            <div className="od-hero-number-row">
              <h1 className="od-hero-number">{order.work_order_number}</h1>
              <StatusBadge wo={order} size="lg" />
            </div>
            <div className="od-hero-meta">
              <span className="od-meta-chip type">{fmtType(order.work_order_type)}</span>
              {order.service_bay_name && <span className="od-meta-chip bay">{order.service_bay_name}</span>}
              {statusLink && <button type="button" className="od-meta-chip token" onClick={copyLink} title={t('orderDetail.copy_link_hint', 'Copy the link the customer uses to follow this job')}><Copy width={11} height={11} /> {copied ? t('orderDetail.link_copied', 'Link copied') : t('orderDetail.copy_customer_link', 'Customer link')}</button>}
            </div>
          </div>
          <div className="od-hero-right">
            {canDo(user, 'job.assign') && <button className="od-hero-btn job-assignment" onClick={() => navigate('/job-assignment')}><Group width={15} height={15} /> {t('orderDetail.job-assignment')}</button>}
          </div>
        </div>

        {/* When it happened. The 8-dot courier bar (Pending … Accepted …
            Ready for Pickup) that sat here is gone: the Steps 1–7 workflow
            right below says where the job stands. */}
        <div className="od-timestamps">
          <span><Clock width={13} height={13} /> {t('orderDetail.created')} {fmtDatetime(order.created_at)}</span>
          {order.scheduled_at && <span><Calendar width={13} height={13} /> {t('orderDetail.scheduled')} {fmtDatetime(order.scheduled_at)}</span>}
          {order.started_at && <span><Wrench width={13} height={13} /> {t('orders.drawer.work_started', 'Work started:')} {fmtDatetime(order.started_at)}</span>}
          {order.completed_at && <span><Check width={13} height={13} /> {t('orders.drawer.closed', 'Closed:')} {fmtDatetime(order.completed_at)}</span>}
        </div>

        <div className="od-quick-stats">
          <QuickStat icon={DollarCircle} label={t('orderDetail.service_fee')} value={fmtAED(order.billing_basis === 'itemised' ? order.total_amount : order.service_fee)} color="#15803d" bg="#dcfce7" />
          <QuickStat icon={Box3dPoint} label={t('orderDetail.tab_items', 'Items')} value={order.items?.length || 0} color="#6d28d9" bg="#ede9fe" />
          <QuickStat icon={CreditCard} label={t('orderDetail.payment')} value={paymentLabel(t, order.payment_method)} color="#4338ca" bg="#eef2ff" />
        </div>
      </div>

      {/* ════════════════ WORKSHOP WORKFLOW, STEPS 1–7 ════════════════ */}
      {/* Replaces the six "Customer Journey" timestamp chips (an earlier
          12-step draft of the process) with the client's Steps 1–7. */}
      <JobCardWorkflow workOrderId={id} user={user} currency={cur} mechanics={mechanics} workshopName={workshop?.name} onChanged={() => fetchOrder(true)}
        version={`${order.status}|${order.mechanic_id}|${order.updated_at}|${order.customer_approved_at}`} />

      <div className="od-progress-card od-extras">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1e3a6b' }}>{t('orderDetail.inspections', 'Vehicle inspections')}</span>
          {[['intake', 'intake_inspection_at', t('orderDetail.intake_inspection', 'Intake walk-around')], ['joint', 'joint_inspection_at', t('orderDetail.joint_inspection', 'Joint inspection at handover')]].map(([type, col, label]) => (
            <button key={type} className="od-insp-btn" onClick={() => navigate(`/work-orders/${id}/inspection?type=${type}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: '1px solid',
                cursor: 'pointer', background: order[col] ? '#dcfce7' : '#eff6ff', color: order[col] ? '#16a34a' : '#1d4ed8', borderColor: order[col] ? '#bbf7d0' : '#bfdbfe' }}>
              {order[col] ? <Check width={13} height={13} /> : <Eye width={13} height={13} />} {label}{order[col] ? ` · ${fmtDatetime(order[col])}` : ''}
            </button>
          ))}
        </div>
        {followUp && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1e3a6b' }}>Follow-up call</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {followUp.status === 'scheduled' && `Scheduled for ${fmtDatetime(followUp.scheduled_at)}`}
              {followUp.status === 'attempted' && 'Attempted, no answer yet'}
              {followUp.status === 'completed' && `Done ${fmtDatetime(followUp.completed_at)}`}
              {followUp.status === 'skipped' && 'Skipped'}
            </span>
            {['scheduled', 'attempted'].includes(followUp.status) && (
              <>
                <button onClick={() => updateFollowUp('attempted')} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 14, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer' }}>Mark Attempted</button>
                <button onClick={() => updateFollowUp('completed')} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 14, border: '1px solid #bbf7d0', background: '#dcfce7', color: '#16a34a', cursor: 'pointer' }}>Mark Done</button>
                <button onClick={() => updateFollowUp('skipped')} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 14, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer' }}>Skip</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ════════════════ TABS ════════════════ */}
      <div className="od-tabs">
        {[
          { key:'overview', label:t('orderDetail.tab_details'), icon:Eye },
          { key:'timeline', label:t('orderDetail.tab_timeline'), icon:Clock, badge:order.status_logs?.length||null },
          { key:'items', label:t('orderDetail.tab_items'), icon:Box3dPoint, badge:order.items?.length||null },
        ].map(tab => (
          <button key={tab.key} className={`od-tab ${activeTab===tab.key?'active':''}`} onClick={() => setActiveTab(tab.key)}>
            <tab.icon width={14} height={14} />
            {tab.label}
            {tab.badge && <span className="od-tab-badge">{tab.badge}</span>}
          </button>
        ))}
      </div>

      <div className="od-body">

        {/* ════════════════ OVERVIEW ════════════════ */}
        {activeTab === 'overview' && (
          <>
            {/* Customer + Vehicle */}
            <div className="od-overview-grid">
              <div className="od-card od-card-sender">
                <div className="od-card-header"><div className="od-card-icon sender"><User width={16} height={16} /></div><h4>{t('orderDetail.section.customer', 'Customer')}</h4></div>
                <div className="od-card-body">
                  <InfoRow icon={User} label={t('orderDetail.name')} value={order.customer_name || order.customer_name_ref || order.company_name} />
                  <InfoRow icon={Phone} label={t('orderDetail.phone')} value={customerPhone ? <span className="od-phone-row"><a className="mono" href={`tel:${customerPhone}`}>{customerPhone}</a><button className="wa-share-inline sm" onClick={sendWhatsApp} aria-label={t('orders.actions.share_whatsapp', 'Share via WhatsApp')}><WhatsAppIcon width={14} height={14} color="#fff" /></button></span> : null} />
                  {order.customer_email && <InfoRow icon={User} label={t('orderDetail.email', 'Email')} value={order.customer_email} />}
                </div>
              </div>
              <div className="od-card od-card-vehicle">
                <div className="od-card-header"><div className="od-card-icon vehicle"><Wrench width={16} height={16} /></div><h4>{t('orderDetail.section.vehicle', 'Vehicle')}</h4></div>
                <div className="od-card-body">
                  {(order.vehicle_make || order.vehicle_model) ? (
                    <>
                      <InfoRow icon={Wrench} label={t('orderDetail.vehicle_make_model', 'Make / Model')} value={[order.vehicle_make, order.vehicle_model, order.vehicle_year].filter(Boolean).join(' ')} />
                      {order.vehicle_plate_number && <InfoRow icon={Hashtag} label={t('orderDetail.plate', 'Plate')} value={order.vehicle_plate_number} mono />}
                      {order.vehicle_color && <InfoRow icon={Box3dPoint} label={t('orderDetail.color', 'Color')} value={order.vehicle_color} />}
                      {order.vehicle_vin && <InfoRow icon={Hashtag} label="VIN" value={order.vehicle_vin} mono />}
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>{t('orderDetail.no_vehicle', 'No vehicle linked to this job card.')}</div>
                  )}
                </div>
              </div>
            </div>

            {/* WorkOrder Info + Financial + Technician */}
            <div className="od-overview-grid three-col">
              <div className="od-card">
                <div className="od-card-header"><div className="od-card-icon info"><Page width={16} height={16} /></div><h4>{t('orderDetail.section.order_info')}</h4></div>
                <div className="od-card-body">
                  <InfoRow icon={Hashtag} label={t('orderDetail.order_num')} value={order.work_order_number} mono />
                  <InfoRow icon={Box3dPoint} label={t('orderDetail.type')} value={fmtType(order.work_order_type)} />
                  <InfoRow icon={CreditCard} label={t('orderDetail.payment')} value={paymentLabel(t, order.payment_method)} />
                  {order.customer_name && <InfoRow icon={User} label={t('orderDetail.customer')} value={order.customer_name} />}
                </div>
              </div>

              <div className="od-card od-card-financial">
                <div className="od-card-header"><div className="od-card-icon financial"><DollarCircle width={16} height={16} /></div><h4>{t('orderDetail.section.financial')}</h4></div>
                <div className="od-card-body">
                  <div className="od-fin-rows">
                    {/* Itemised job cards bill every line on the Items tab plus the
                        service fee (cash_amount is kept equal to the items total);
                        legacy ones bill service_fee alone. The platform commission,
                        platform fee and "net payable to merchant" rows of the courier
                        product are not shown: a workshop bills its own customer. */}
                    {order.billing_basis === 'itemised' ? (
                      <>
                        <div className="od-fin-row"><span>{t('orderDetail.fin.items_total', { defaultValue: 'Parts & services' })}</span><span className="od-fin-amount">{fmtAED(order.cash_amount)}</span></div>
                        {parseFloat(order.service_fee) > 0 && <div className="od-fin-row"><span>{t('orderDetail.fin.labour_fee', { defaultValue: 'Labour / service fee' })}</span><span className="od-fin-amount">{fmtAED(order.service_fee)}</span></div>}
                      </>
                    ) : (
                      <div className="od-fin-row"><span>{t('orderDetail.fin.subtotal')}</span><span className="od-fin-amount">{fmtAED(order.service_fee)}</span></div>
                    )}
                    {parseFloat(order.discount) > 0 && <div className="od-fin-row discount"><span>{t('orderDetail.fin.discount')}</span><span>- {fmtAED(order.discount)}</span></div>}
                    {parseFloat(order.vat_amount) > 0 && <div className="od-fin-row vat"><span>{t('orderDetail.fin.vat')} ({order.vat_rate}%)</span><span>{fmtAED(order.vat_amount)}</span></div>}
                    <div className="od-fin-divider" />
                    <div className="od-fin-row total"><span>{t('orderDetail.fin.total')}</span><span>{fmtAED(order.total_amount)}</span></div>
                  </div>
                </div>
              </div>

              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-icon mechanic"><Wrench width={16} height={16} /></div>
                  <h4>{t('orderDetail.technician', 'Technician')}</h4>
                  {canDo(user, 'job.assign') && ['pending','confirmed','assigned'].includes(order.status) && (
                    <button className="od-card-action" onClick={() => { setAssignError(''); setShowReassign(v => !v); }}><EditPencil width={12} height={12} /> {order.mechanic_id ? t('orderDetail.reassign') : t('orderDetail.assign_mechanic')}</button>
                  )}
                </div>
                <div className="od-card-body">
                  {order.mechanic_name ? (
                    <>
                      <div className="od-mechanic-hero">
                        <div className="od-mechanic-avatar">{order.mechanic_name.charAt(0).toUpperCase()}</div>
                        <div>
                          <div className="od-mechanic-name">{order.mechanic_name}</div>
                          <div className="od-mechanic-vehicle">
                            {order.mechanic_specialty ? fmtType(order.mechanic_specialty) : ''}
                            {order.service_bay_name ? ` • ${order.service_bay_name}` : ''}
                          </div>
                        </div>
                      </div>
                      {/* The technician's number, to call them. The WhatsApp button
                          that sat here sent them the customer's status message. */}
                      {order.mechanic_phone && <InfoRow icon={Phone} label={t('orderDetail.phone')} value={<a className="mono" href={`tel:${order.mechanic_phone}`} dir="ltr">{order.mechanic_phone}</a>} />}
                    </>
                  ) : (
                    <div className="od-no-mechanic-box"><Wrench width={24} height={24} /><span>{t("orderDetail.no_mechanic")}</span></div>
                  )}
                  {showReassign && (
                    <div className="od-reassign-row">
                      <select className="od-select" value={reassignMechanic} onChange={e => setReassignMechanic(e.target.value)}>
                        <option value="">{t('orderDetail.select_mechanic')}</option>
                        {mechanics.map(d => <option key={d.id} value={d.id}>{d.full_name}{d.specialty ? ` (${fmtType(d.specialty)})` : ''}{d.status === 'busy' ? ` ⚠ ${t('orders.mechanic_picker.status_busy', 'Busy')}` : ''}</option>)}
                      </select>
                      <button className="module-btn module-btn-primary sm" onClick={handleReassign} disabled={!reassignMechanic || reassigning}>{reassigning ? t('orderDetail.assigning') : t('orderDetail.confirm')}</button>
                      <button className="module-btn module-btn-outline sm" onClick={() => setShowReassign(false)}>{t("common.cancel")}</button>
                    </div>
                  )}
                  {showReassign && assignError && <div className="od-approval-error">{assignError}</div>}
                </div>
              </div>
            </div>

            {/* Notes + Status Update */}
            <div className="od-overview-grid">
              {(order.notes || order.description || order.special_instructions) && (
                <div className="od-card">
                  <div className="od-card-header"><div className="od-card-icon notes"><Notes width={16} height={16} /></div><h4>{t('orderDetail.section.notes')}</h4></div>
                  <div className="od-card-body">
                    {(() => {
                      const parsed = parseSrcNotes(order.notes);
                      if (parsed.kind === 'json' && parsed.entries.length > 0) {
                        return (
                          <div style={{ marginBottom: (order.description || order.special_instructions) ? 10 : 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {t('orderDetail.fin.migration_source', { defaultValue: 'Migration Info' })}
                              {parsed.source && (
                                <span style={{ fontSize: 9, fontWeight: 800, color: '#78350f', background: '#fde68a', padding: '1px 6px', borderRadius: 4, letterSpacing: '0.04em' }}>
                                  {parsed.source}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', rowGap: 6, columnGap: 16 }}>
                              {parsed.entries.map(([label, value]) => (
                                <div key={label} style={{ fontSize: 12, color: '#334155' }}>
                                  <span style={{ fontWeight: 700, color: '#64748b', marginInlineEnd: 4 }}>{label}:</span>
                                  <span>{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      if (parsed.kind === 'text' || parsed.kind === 'json') {
                        return parsed.text ? <p className="od-note-text">{parsed.text}</p> : null;
                      }
                      return null;
                    })()}
                    {order.description && <p className="od-note-text">{order.description}</p>}
                    {order.special_instructions && <div className="od-note-warn"><WarningTriangle width={14} height={14} /> {order.special_instructions}</div>}
                  </div>
                </div>
              )}
              {order.billing_basis === 'itemised' && (order.customer_approved_at || !['completed', 'cancelled'].includes(order.status)) && (() => {
                const approved = !!order.customer_approved_at;
                const grown = approved && parseFloat(order.total_amount) > parseFloat(order.customer_approved_total || 0) + 0.004;
                const open = !['completed', 'cancelled'].includes(order.status);
                const via = { estimate: 'through the estimate link', in_person: 'in person', phone: 'by phone', written: 'in writing' }[order.customer_approval_channel] || order.customer_approval_channel;
                return (
                  <div className="od-card">
                    <div className="od-card-header"><div className="od-card-icon status"><ClipboardCheck width={16} height={16} /></div><h4>{t('orderDetail.customer_approval', { defaultValue: 'Customer approval' })}</h4></div>
                    <div className="od-card-body">
                      {approved ? (
                        <div className={`od-approval ${grown ? 'od-approval-warn' : 'od-approval-ok'}`}>
                          <div><b>{grown ? 'Extra work not yet approved' : '✓ Approved by the customer'}</b></div>
                          <div>Agreed {via}{order.customer_approved_by_name ? ` (recorded by ${order.customer_approved_by_name})` : ''} on {new Date(order.customer_approved_at).toLocaleString()} — {fmtAED(order.customer_approved_total)}.</div>
                          {order.customer_approval_note && <div className="od-approval-note">“{order.customer_approval_note}”</div>}
                          {grown && <div>The job card is now {fmtAED(order.total_amount)}: {fmtAED(parseFloat(order.total_amount) - parseFloat(order.customer_approved_total))} more than the customer agreed. Get their approval for the extra work.</div>}
                        </div>
                      ) : (
                        <div className="od-approval od-approval-warn">
                          <div><b>Waiting for the customer's approval</b></div>
                          <div>Work can't start on this job card until the customer's agreement to {fmtAED(order.total_amount)} is recorded.</div>
                        </div>
                      )}
                      {open && (!approved || grown) && canDo(user, 'customer.approval') && (
                        <div className="od-approval-form">
                          <select className="od-note-input" value={approvalChannel} onChange={e => setApprovalChannel(e.target.value)}>
                            <option value="in_person">Approved in person</option>
                            <option value="phone">Approved by phone</option>
                            <option value="written">Approved in writing</option>
                          </select>
                          <input type="text" className="od-note-input" placeholder="Note — who agreed, reference (optional)" value={approvalNote} onChange={e => setApprovalNote(e.target.value)} maxLength={500} />
                          <button className="module-btn module-btn-primary" onClick={handleRecordApproval} disabled={savingApproval}>{savingApproval ? t('orderDetail.saving') : 'Record approval'}</button>
                          {approvalError && <div className="od-approval-error">{approvalError}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {(mayCancel || mayReopen || overrides.length > 0) && (
                <div className="od-card od-card-status">
                  <div className="od-card-header"><div className="od-card-icon status"><ArrowRight width={16} height={16} /></div><h4>{t('orderDetail.update_status')}</h4></div>
                  <div className="od-card-body">
                    <p className="od-status-hint">{t('orderDetail.status_hint', 'The workflow above moves the job card from step to step. Here you can cancel it, or reopen it if it was cancelled.')}</p>
                    <div className="od-status-actions">
                      {mayCancel && (
                        <button className={`od-status-btn ${newStatus==='cancelled'?'selected':''}`} style={{'--s-color':'#b91c1c','--s-bg':'#fee2e2'}} onClick={() => { setStatusError(''); setNewStatus(ns => ns==='cancelled'?'':'cancelled'); }}><Prohibition width={14} height={14} /> {t('orders.actions.cancel_order')}</button>
                      )}
                      {mayReopen && (
                        <button className={`od-status-btn ${newStatus==='pending'?'selected':''}`} style={{'--s-color':'#334155','--s-bg':'#f1f5f9'}} onClick={() => { setStatusError(''); setNewStatus(ns => ns==='pending'?'':'pending'); }}><Undo width={14} height={14} /> {t('orders.reopen', 'Reopen')}</button>
                      )}
                    </div>
                    {overrides.length > 0 && (
                      <>
                        <div className="od-status-sub">{t('orders.override_status', 'Override status')}</div>
                        <div className="od-status-actions">
                          {overrides.map(s => { const tone = woTone(s); const Icon = tone.icon; return (
                            <button key={s} className={`od-status-btn ${newStatus===s?'selected':''}`} style={{'--s-color':tone.color,'--s-bg':tone.bg}} onClick={() => { setStatusError(''); setNewStatus(ns => ns===s?'':s); }}><Icon width={14} height={14} /> {woLabel(t, s)}</button>
                          ); })}
                        </div>
                      </>
                    )}
                    {newStatus && (
                      <div className="od-status-confirm">
                        <input type="text" className="od-note-input" placeholder={t("orderDetail.add_note")} value={statusNote} onChange={e => setStatusNote(e.target.value)} />
                        <button className="module-btn module-btn-primary" onClick={handleStatusUpdate} disabled={savingStatus}>{savingStatus ? t('orderDetail.saving') : actionLabel(newStatus)}</button>
                      </div>
                    )}
                    {statusError && <div className="od-approval-error">{statusError}</div>}
                  </div>
                </div>
              )}
            </div>

            {/* Job photos and the customer's signature at handover. The
                courier pickup / proof-of-delivery blocks are gone. */}
            {((order.photos && order.photos.length > 0) || order.completion_photo_url || order.signature_url) && (
              <div className="od-card">
                <div className="od-card-header"><div className="od-card-icon notes"><Eye width={16} height={16} /></div><h4>{t('orderDetail.job_photos', 'Job photos')}</h4></div>
                <div className="od-card-body">
                  {order.photos && order.photos.length > 0 ? (
                    <div className="od-photo-grid" style={{ marginBottom: order.signature_url ? 16 : 0 }}>
                      {order.photos.map((p) => (
                        <figure key={p.id} className="od-photo">
                          <a href={p.photo_url} target="_blank" rel="noopener noreferrer">
                            <img src={p.photo_url} alt={p.caption || t('orderDetail.job_photo', 'Job photo')} />
                          </a>
                          {p.caption && <figcaption>{p.caption}</figcaption>}
                        </figure>
                      ))}
                    </div>
                  ) : order.completion_photo_url && (
                    <div className="od-photo-grid" style={{ marginBottom: order.signature_url ? 16 : 0 }}>
                      <figure className="od-photo">
                        <a href={order.completion_photo_url} target="_blank" rel="noopener noreferrer">
                          <img src={order.completion_photo_url} alt={t('orderDetail.job_photo', 'Job photo')} />
                        </a>
                      </figure>
                    </div>
                  )}
                  {order.signature_url && (
                    <div>
                      <div className="od-photo-title">{t('orderDetail.handover_signature', 'Customer signature at handover')}</div>
                      <a href={order.signature_url} target="_blank" rel="noopener noreferrer">
                        <img className="od-signature" src={order.signature_url} alt={t('orderDetail.handover_signature', 'Customer signature at handover')} />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════════════ TIMELINE ════════════════ */}
        {activeTab === 'timeline' && (
          <div className="od-timeline-wrap">
            {!order.status_logs?.length ? <p className="od-empty-tab">{t("orderDetail.no_history")}</p> : (
              <div className="od-timeline">
                {order.status_logs.map((log, i) => {
                  const m = woTone(log.status); const Icon = m.icon; const isLast = i===order.status_logs.length-1;
                  return (
                    <div key={log.id} className={`od-tl-item ${isLast?'latest':''}`}>
                      <div className="od-tl-dot" style={{background:m.color}}><Icon width={11} height={11} color="#fff" /></div>
                      {!isLast && <div className="od-tl-line" />}
                      <div className="od-tl-content">
                        <div className="od-tl-header"><span className="od-tl-status" style={{color:m.color}}>{woLabel(t, log.status)}</span><span className="od-tl-time">{fmtDatetime(log.created_at)}</span></div>
                        {log.note && <p className="od-tl-note">{log.note}</p>}
                        {log.changed_by_name && <span className="od-tl-by">{t('orderDetail.by')} {log.changed_by_name}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════════════════ ITEMS ════════════════ */}
        {activeTab === 'items' && (
          <div className="od-items-wrap">
            {!order.items?.length ? <p className="od-empty-tab">{t('orderDetail.no_items')}</p> : (
              <table className="od-items-table">
                <thead><tr><th>{t('orderDetail.item')}</th><th>{t('orderDetail.qty')}</th><th>{t('orderDetail.unit_price')}</th><th>{t('orderDetail.notes')}</th></tr></thead>
                <tbody>{order.items.map(item => (<tr key={item.id}><td className="od-item-name">{item.name}</td><td>{Number(item.quantity)}</td><td>{fmtAED(item.unit_price)}</td><td className="od-item-notes">{item.notes||'—'}</td></tr>))}</tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
