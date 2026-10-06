import { useState, useEffect, useCallback, useContext } from 'react';
import {
  Page, Download, Eye, Search, Trash, Check, Clock, WarningTriangle,
  Xmark, DollarCircle, CheckCircleSolid, SendDiagonalSolid,
  ClockSolid, FlashSolid, WarningCircleSolid, XmarkCircleSolid,
  Prohibition, GraphUp, Timer, RefreshDouble
} from 'iconoir-react';
import api from '../lib/api';
import { CardListSkeleton } from '../components/Loader';
import { useTranslation } from 'react-i18next';
import Toast, { useToast } from '../components/Toast';
import { AuthContext } from '../context/AuthContext';
import { fmtCurrency } from '../utils/currency';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/* ── Status config ─────────────────────────────────────────────────────────── */
const STATUS_CONFIG = {
  draft:          { color: '#3b82f6', bg: '#eff6ff', label: 'Draft',     Icon: Page },
  sent:           { color: '#d97706', bg: '#fef3c7', label: 'Sent',      Icon: SendDiagonalSolid },
  paid:           { color: '#16a34a', bg: '#dcfce7', label: 'Paid',      Icon: CheckCircleSolid },
  partially_paid: { color: '#7c3aed', bg: '#f3e8ff', label: 'Partial',   Icon: FlashSolid },
  overdue:        { color: '#ef4444', bg: '#fee2e2', label: 'Overdue',   Icon: WarningCircleSolid },
  void:           { color: '#64748b', bg: '#f1f5f9', label: 'Void',      Icon: Prohibition },
  cancelled:      { color: '#94a3b8', bg: '#f8fafc', label: 'Cancelled', Icon: XmarkCircleSolid },
};

/* ═══════════════════════════ MAIN COMPONENT ═══════════════════════════ */
export default function Invoices() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const { toasts, showToast } = useToast();
  const PER_PAGE = 12;

  useEffect(() => { fetchInvoices(); }, []);

  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/invoices');
      if (res.success) setInvoices(res.data || []);
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const generateMissing = async () => {
    try {
      setGenerating(true);
      const res = await api.post('/invoices/generate-missing');
      if (res.success) {
        const { created, failed } = res.data || {};
        if (created > 0) {
          showToast(t('invoices.generate_success', { count: created }), 'success');
          fetchInvoices();
        } else {
          showToast(t('invoices.generate_none'), 'warning');
        }
      } else {
        showToast(res.message || t('invoices.generate_failed'), 'error');
      }
    } catch (err) {
      console.error('Failed to generate missing invoices:', err);
      showToast(t('invoices.generate_failed'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleStatusChange = async (invoiceId, newStatus) => {
    try {
      const res = await api.patch(`/invoices/${invoiceId}/status`, { status: newStatus });
      if (res.success) {
        fetchInvoices();
        if (showDetails) setShowDetails(false);
      }
    } catch (err) { console.error('Failed to update status:', err); }
  };

  const downloadPDF = async (inv) => {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${API_BASE}/invoices/${inv.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return showToast(t('invoices.pdf_failed'), 'error');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoice_number || 'invoice-' + inv.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Error downloading PDF:', err); }
  };

  const viewDetails = async (inv) => {
    try {
      setDetailLoading(true);
      setShowDetails(true);
      const res = await api.get(`/invoices/${inv.id}`);
      if (res.success) setSelectedInvoice(res.data);
      else setSelectedInvoice(inv);
    } catch {
      setSelectedInvoice(inv);
    } finally {
      setDetailLoading(false);
    }
  };

  const deleteInvoice = (invoiceId) => {
    setConfirmDlg({
      message: t('invoices.delete_confirm'),
      onConfirm: async () => {
        setConfirmDlg(null);
        try {
          const res = await api.delete(`/invoices/${invoiceId}`);
          if (res.success) {
            showToast(t('invoices.deleted_success') || 'Invoice deleted', 'success');
            fetchInvoices();
          }
        } catch (err) {
          console.error('Failed to delete invoice:', err);
          showToast(t('invoices.delete_failed') || 'Failed to delete', 'error');
        }
      },
    });
  };

  /* ── Filter & Paginate ── */
  let filtered = invoices;
  if (statusFilter) filtered = filtered.filter(i => i.status === statusFilter);
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(i =>
      (i.invoice_number || '').toLowerCase().includes(term) ||
      (i.customer_name || '').toLowerCase().includes(term) ||
      (i.work_order_number || '').toLowerCase().includes(term)
    );
  }
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  /* ── Stats ── */
  const totalAmount = invoices.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
  const paidAmount = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
  const pendingAmount = invoices.filter(i => ['draft', 'sent', 'partially_paid'].includes(i.status)).reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
  const overdueAmount = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
  const paidPct = totalAmount > 0 ? ((paidAmount / totalAmount) * 100).toFixed(0) : 0;

  /* ── Helpers ── */
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(i18n.language === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtMoney = (v) => parseFloat(v || 0).toFixed(2);

  const statCards = [
    { label: t('invoices.stats.total'), value: `${cur} ${fmtMoney(totalAmount)}`, sub: t('invoices.invoices_count', { count: invoices.length }), cardColor: 'primary', bg: '#fff7ed', iconColor: '#f97316', Icon: DollarCircle },
    { label: t('invoices.stats.collected'), value: `${cur} ${fmtMoney(paidAmount)}`, sub: t('invoices.collection_rate', { rate: paidPct }), cardColor: 'success', bg: '#dcfce7', iconColor: '#16a34a', Icon: CheckCircleSolid },
    { label: t('invoices.stats.pending'), value: `${cur} ${fmtMoney(pendingAmount)}`, sub: t('invoices.invoices_count', { count: invoices.filter(i => ['draft','sent','partially_paid'].includes(i.status)).length }), cardColor: 'warning', bg: '#fef3c7', iconColor: '#d97706', Icon: ClockSolid },
    { label: t('invoices.stats.overdue'), value: `${cur} ${fmtMoney(overdueAmount)}`, sub: t('invoices.invoices_count', { count: invoices.filter(i => i.status === 'overdue').length }), cardColor: 'danger', bg: '#fee2e2', iconColor: '#ef4444', Icon: WarningTriangle },
  ];

  /* ═══════════════════════════ RENDER ═══════════════════════════ */
  return (
    <div style={{ padding: 24 }}>

      {/* ── Hero (shared module-hero class, same as ServiceTracking) ── */}
      <div className="module-hero">
        <div className="module-hero-left">
          <div className="module-hero-icon">
            <Page width={26} height={26} />
          </div>
          <div>
            <h1 className="module-hero-title">{t("invoices.title")}</h1>
            <p className="module-hero-sub">{t('invoices.subtitle')}</p>
          </div>
        </div>
        <div className="module-hero-actions">
          <button className="module-btn module-btn-primary" onClick={generateMissing} disabled={generating}
            style={{ background: generating ? '#94a3b8' : undefined }}>
            {generating
              ? <><span className="trk-spinner" style={{ width:14, height:14, borderWidth:2 }} /> {t('invoices.generating')}</>
              : <><FlashSolid width={16} height={16} /> {t('invoices.generate_invoices')}</>
            }
          </button>
          <button className="module-btn module-btn-outline" onClick={fetchInvoices}>
            <RefreshDouble width={16} height={16} /> {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* ── Stat Cards (same style as ServiceTracking) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 16,
        marginBottom: 24,
      }}>
        {statCards.map((s, i) => (
          <div key={i} style={{
            background: '#fff',
            border: '1px solid #f1f5f9',
            borderRadius: 14,
            padding: '18px 20px',
            position: 'relative',
            overflow: 'hidden',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            {/* Color top bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: s.iconColor }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 46, height: 46,
                borderRadius: 12,
                background: s.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <s.Icon width={22} height={22} color={s.iconColor} />
              </div>
              <div>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', display: 'block' }}>{s.value}</span>
                <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.label}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Search & Filters ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 360 }}>
          <Search width={16} height={16} style={{ position: 'absolute', [isRTL?'right':'left']: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder={t("invoices.search_placeholder")}
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
            style={{
              width: '100%',
              height: 38,
              padding: '0 14px 0 38px',
              border: '1px solid #e0e0e0',
              borderRadius: 10,
              fontSize: 13,
              background: '#fff',
              outline: 'none',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={e => { e.target.style.borderColor = '#f97316'; e.target.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.08)'; }}
            onBlur={e => { e.target.style.borderColor = '#e0e0e0'; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <FilterPill active={!statusFilter} onClick={() => { setStatusFilter(''); setPage(1); }}>
          {t('invoices.filter_all')} ({invoices.length})
        </FilterPill>
        {Object.entries(STATUS_CONFIG).filter(([k]) => !['void','cancelled'].includes(k)).map(([key, cfg]) => {
          const IconComp = cfg.Icon;
          return (
            <FilterPill key={key} active={statusFilter === key} onClick={() => { setStatusFilter(key); setPage(1); }} color={cfg.color}>
              <IconComp width={13} height={13} /> {t('invoices.status.' + key)} ({invoices.filter(i => i.status === key).length})
            </FilterPill>
          );
        })}
      </div>

      {/* ── Invoice Grid ── */}
      {loading ? (
        <CardListSkeleton count={6} />
      ) : paged.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 32px',
          background: '#fff',
          borderRadius: 16,
          border: '2px dashed #e2e8f0'
        }}>
          <Page width={44} height={44} color="#94a3b8" style={{ marginBottom: 14 }} />
          <h3 style={{textAlign: 'center', margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: '#1e293b' }}>{t("invoices.no_invoices")}</h3>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 380, marginInline: 'auto', lineHeight: 1.6 }}>
            {t('invoices.empty_hint')}
          </p>
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 16
          }}>
            {paged.map(inv => <InvoiceCard key={inv.id} inv={inv} onView={viewDetails} onDownload={downloadPDF} onDelete={deleteInvoice} onStatusChange={handleStatusChange} />)}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 24, flexWrap: 'wrap' }}>
              <PgBtn disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{t('invoices.prev')}</PgBtn>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <PgBtn key={p} active={p === page} onClick={() => setPage(p)}>{p}</PgBtn>
              ))}
              <PgBtn disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>{t("common.next")}</PgBtn>
            </div>
          )}
        </>
      )}

      {/* ── Toast Notifications ── */}
      <Toast toasts={toasts} />

      {/* ── Confirm Dialog ── */}
      {confirmDlg && (
        <ConfirmDialog
          message={confirmDlg.message}
          onConfirm={confirmDlg.onConfirm}
          onCancel={() => setConfirmDlg(null)}
        />
      )}

      {/* ── Detail Modal ── */}
      {showDetails && (
        <DetailModal
          invoice={selectedInvoice}
          loading={detailLoading}
          onClose={() => { setShowDetails(false); setSelectedInvoice(null); }}
          onDownload={downloadPDF}
          onStatusChange={handleStatusChange}
          fmtDate={fmtDate}
          fmtMoney={fmtMoney}
        />
      )}
    </div>
  );
}


/* ═══════════════════════════ SUB-COMPONENTS ═══════════════════════════ */

/* ── Filter Pill ── */
function FilterPill({ active, onClick, color = '#f97316', children }) {
  return (
    <button onClick={onClick} style={{
      height: 38,
      padding: '0 14px',
      borderRadius: 10,
      border: active ? `1px solid ${color}` : '1px solid #e0e0e0',
      background: active ? (color === '#f97316' ? '#fff7ed' : `${color}15`) : '#fff',
      color: active ? color : '#64748b',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: active ? 600 : 400,
      transition: 'all 0.2s',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      whiteSpace: 'nowrap'
    }}>
      {children}
    </button>
  );
}

/* ── Pagination Button ── */
function PgBtn({ active, disabled, onClick, children }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      minWidth: 34,
      height: 34,
      padding: '0 10px',
      borderRadius: 8,
      border: active ? '1px solid #f97316' : '1px solid #e2e8f0',
      background: active ? '#fff7ed' : '#fff',
      color: active ? '#f97316' : disabled ? '#cbd5e1' : '#64748b',
      cursor: disabled ? 'default' : 'pointer',
      fontSize: 13,
      fontWeight: active ? 700 : 500,
      transition: 'all 0.2s',
      opacity: disabled ? 0.5 : 1
    }}>
      {children}
    </button>
  );
}

/* ── Invoice Card ── */
function InvoiceCard({ inv, onView, onDownload, onDelete, onStatusChange }) {
  const { t, i18n } = useTranslation();
  const cfg = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
  const StatusIcon = cfg.Icon;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff',
        borderRadius: 14,
        overflow: 'hidden',
        border: `1px solid ${hovered ? '#e0e0e0' : '#f1f5f9'}`,
        boxShadow: hovered ? '0 8px 28px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.04)',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
      }}
    >
      {/* Colored top bar */}
      <div style={{ height: 3, background: cfg.color }} />

      {/* Card Header */}
      <div style={{
        padding: '16px 20px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38,
            borderRadius: 10,
            background: cfg.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <StatusIcon width={18} height={18} color={cfg.color} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b', letterSpacing: '-0.3px' }}>{inv.invoice_number}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginTop: 1 }}>{inv.customer_name || t('invoices.walk_in')}</div>
          </div>
        </div>
        <span style={{
          background: cfg.bg,
          color: cfg.color,
          padding: '4px 10px',
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
        }}>
          {t('invoices.status.' + inv.status)}
        </span>
      </div>

      {/* Card Body */}
      <div style={{ padding: '0 20px 16px' }}>
        {/* WorkOrder badge */}
        {inv.work_order_number && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ background: '#f1f5f9', padding: '3px 10px', borderRadius: 6, fontWeight: 600, fontSize: 11, color: '#64748b' }}>
              {inv.work_order_number}
            </span>
          </div>
        )}

        {/* Total Amount */}
        <div style={{
          background: 'linear-gradient(135deg, #1e293b, #334155)',
          padding: '14px 16px',
          borderRadius: 12,
          marginBottom: 12,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{t("invoices.total_amount")}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
            {inv.currency || cur} {parseFloat(inv.total_amount || 0).toFixed(2)}
          </div>
        </div>

        {/* Details row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14, fontSize: 12 }}>
          <div>
            <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', marginBottom: 2 }}>{t('invoices.created')}</div>
            <div style={{ color: '#1e293b', fontWeight: 600 }}>
              {inv.created_at ? new Date(inv.created_at).toLocaleDateString(i18n.language === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short' }) : '—'}
            </div>
          </div>
          <div>
            <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', marginBottom: 2 }}>{t('invoices.payment')}</div>
            <div style={{ color: '#1e293b', fontWeight: 600, textTransform: 'uppercase' }}>{inv.payment_method || 'COD'}</div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6 }}>
          <ActionBtn onClick={() => onView(inv)} color="#3b82f6" flex={1}>
            <Eye width={14} height={14} /> {t('invoices.view')}
          </ActionBtn>
          <ActionBtn onClick={() => onDownload(inv)} color="#64748b" flex={1}>
            <Download width={14} height={14} /> {t('invoices.pdf')}
          </ActionBtn>
          {inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'cancelled' && (
            <ActionBtn onClick={() => onStatusChange(inv.id, 'paid')} color="#16a34a" flex={0} title={t('invoices.mark_paid')}>
              <Check width={14} height={14} />
            </ActionBtn>
          )}
          <ActionBtn onClick={() => onDelete(inv.id)} color="#ef4444" flex={0} title={t('common.delete')}>
            <Trash width={14} height={14} />
          </ActionBtn>
        </div>
      </div>
    </div>
  );
}

/* ── Action Button ── */
function ActionBtn({ onClick, color, flex, children, title }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        flex: flex ?? 'unset',
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        background: h ? `${color}12` : 'transparent',
        color: color,
        border: `1px solid ${h ? color : '#e2e8f0'}`
      }}
    >
      {children}
    </button>
  );
}

/* ── Detail Modal ── */
function DetailModal({ invoice, loading, onClose, onDownload, onStatusChange, fmtDate, fmtMoney }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  if (!invoice && !loading) return null;
  const cfg = invoice ? (STATUS_CONFIG[invoice.status] || STATUS_CONFIG.draft) : STATUS_CONFIG.draft;
  const StatusIcon = cfg.Icon;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
        animation: 'invFadeIn 0.2s ease'
      }}
    >
      <style>{`@keyframes invFadeIn{from{opacity:0}to{opacity:1}}@keyframes invSlideUp{from{transform:translateY(24px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 18,
          maxWidth: 620,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 24px 80px rgba(0,0,0,0.2)',
          animation: 'invSlideUp 0.3s ease'
        }}
      >
        {loading ? (
          <div style={{ padding: 80, textAlign: 'center', color: '#94a3b8' }}>
            <div className="trk-spinner" style={{ margin: '0 auto 16px' }} />
            <div>{t("invoices.loading_details")}</div>
          </div>
        ) : invoice ? (
          <>
            {/* Modal Header — dark gradient like ServiceTracking sections */}
            <div style={{
              background: 'linear-gradient(135deg, #1e293b, #334155)',
              padding: '20px 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderRadius: '18px 18px 0 0',
              color: '#fff'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  background: 'rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  width: 42,
                  height: 42,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <StatusIcon width={20} height={20} color={cfg.color} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('invoices.label')}</div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' }}>{invoice.invoice_number}</h2>
                </div>
              </div>
              <button onClick={onClose} style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
                width: 36,
                height: 36,
                borderRadius: 10,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Xmark width={18} height={18} />
              </button>
            </div>

            <div style={{ padding: '22px 24px' }}>
              {/* Info Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <MInfoBlock label={t('invoices.customer')} value={invoice.customer_name || t('invoices.walk_in')} sub={invoice.customer_email} />
                <MInfoBlock label={t('invoices.order')} value={invoice.work_order_number || t('invoices.na')} sub={invoice.order_status ? t('invoices.order_status_prefix', { status: invoice.order_status }) : null} />
                <MInfoBlock label={t('invoices.created')} value={fmtDate(invoice.created_at)} />
                <MInfoBlock label={t('invoices.due_date')} value={invoice.due_date ? fmtDate(invoice.due_date) : t('invoices.not_set')} />
              </div>

              {/* Big Amount */}
              <div style={{
                background: 'linear-gradient(135deg, #1e293b, #334155)',
                padding: '20px',
                borderRadius: 14,
                marginBottom: 20,
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{ position: 'absolute', top: 10, [isRTL?'left':'right']: 16, opacity: 0.1 }}>
                  <DollarCircle width={48} height={48} color="#fff" />
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{t("invoices.total_amount")}</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#fff', letterSpacing: '-1px' }}>
                  {invoice.currency || cur} {fmtMoney(invoice.total_amount)}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <span>{t('invoices.subtotal')} {invoice.currency || cur} {fmtMoney(invoice.subtotal)}</span>
                  {parseFloat(invoice.discount_amount || 0) > 0 && <span>{t('invoices.discount')} -{invoice.currency || cur} {fmtMoney(invoice.discount_amount)}</span>}
                  {parseFloat(invoice.tax_amount || 0) > 0 && <span>{t('invoices.tax')} {invoice.currency || cur} {fmtMoney(invoice.tax_amount)}</span>}
                </div>
              </div>

              {/* Line Items */}
              {invoice.items && invoice.items.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{t('invoices.line_items')}</div>
                  <div style={{ border: '1px solid #f1f5f9', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 1fr 1fr 1fr',
                      padding: '8px 14px',
                      background: '#f8fafc',
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#94a3b8',
                      textTransform: 'uppercase',
                    }}>
                      <span>{t('invoices.description')}</span>
                      <span style={{ textAlign: 'right' }}>{t('invoices.qty')}</span>
                      <span style={{ textAlign: 'right' }}>{t('invoices.price')}</span>
                      <span style={{ textAlign: 'right' }}>{t('invoices.total')}</span>
                    </div>
                    {invoice.items.map((item, idx) => (
                      <div key={idx} style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr 1fr',
                        padding: '10px 14px',
                        borderTop: '1px solid #f1f5f9',
                        fontSize: 13,
                        color: '#1e293b'
                      }}>
                        <span style={{ fontWeight: 500 }}>{item.description}</span>
                        <span style={{ textAlign: 'right', color: '#64748b' }}>{item.quantity}</span>
                        <span style={{ textAlign: 'right', color: '#64748b' }}>{fmtMoney(item.unit_price)}</span>
                        <span style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(item.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status & Payment */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                <div style={{ background: '#f8fafc', padding: 14, borderRadius: 10, border: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 6 }}>{t('invoices.status_label')}</div>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 12px',
                    background: cfg.bg,
                    color: cfg.color,
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                  }}>
                    <StatusIcon width={14} height={14} /> {t('invoices.status.' + invoice.status)}
                  </span>
                </div>
                <div style={{ background: '#f8fafc', padding: 14, borderRadius: 10, border: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 6 }}>{t('invoices.payment')}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' }}>{invoice.payment_method || 'COD'}</div>
                  {invoice.paid_at && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{t('invoices.paid_at')} {fmtDate(invoice.paid_at)}</div>}
                </div>
              </div>

              {/* Notes */}
              {invoice.notes && (
                <div style={{ background: '#fef3c7', border: '1px solid #fde68a', padding: 14, borderRadius: 10, marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', marginBottom: 4 }}>{t('invoices.notes')}</div>
                  <div style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.5 }}>{invoice.notes}</div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => onDownload(invoice)}
                  style={{
                    flex: 1,
                    minWidth: 140,
                    padding: '12px 18px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg, #f97316 0%, #159fd9 100%)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 2px 8px rgba(249,115,22,0.3)',
                    transition: 'all 0.2s',
                  }}
                >
                  <Download width={16} height={16} /> {t('invoices.download_pdf')}
                </button>
                {invoice.status !== 'paid' && invoice.status !== 'void' && invoice.status !== 'cancelled' && (
                  <button
                    onClick={() => onStatusChange(invoice.id, 'paid')}
                    style={{
                      flex: 1,
                      minWidth: 140,
                      padding: '12px 18px',
                      borderRadius: 10,
                      border: '2px solid #16a34a',
                      background: '#dcfce7',
                      color: '#16a34a',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      transition: 'all 0.2s'
                    }}
                  >
                    <CheckCircleSolid width={16} height={16} /> {t('invoices.mark_as_paid')}
                  </button>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ── Modal Info Block ── */
function MInfoBlock({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ── Confirm Dialog ── */
function ConfirmDialog({ message, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 1100, padding: 20,
        animation: 'invFadeIn 0.2s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: '28px 24px',
          maxWidth: 400, width: '100%',
          boxShadow: '0 24px 80px rgba(0,0,0,0.18)',
          animation: 'invSlideUp 0.3s ease',
          textAlign: 'center',
        }}
      >
        <div style={{
          width: 52, height: 52, borderRadius: 14, background: '#fee2e2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <WarningTriangle width={24} height={24} color="#ef4444" />
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: '#1e293b' }}>
          {t('invoices.confirm_title') || 'Confirm Action'}
        </h3>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '11px 18px', borderRadius: 10,
            border: '1px solid #e2e8f0', background: '#fff',
            color: '#64748b', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.2s',
          }}>
            {t('common.cancel') || 'Cancel'}
          </button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: '11px 18px', borderRadius: 10,
            border: 'none', background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', boxShadow: '0 2px 8px rgba(239,68,68,0.3)',
            transition: 'all 0.2s',
          }}>
            {t('common.delete') || 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
