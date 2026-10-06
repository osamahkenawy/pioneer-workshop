/* ══════════════════════════════════════════════════════════════
 * CustomerInvoices.jsx — Invoice List with PDF Download
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback } from 'react';
import { Page, Download, Calendar, DollarCircle } from 'iconoir-react';
import './CustomerPages.css';
import { CardListSkeleton } from '../../components/Loader';
const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function CustomerInvoices() {
  const [invoices, setInvoices]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [page, setPage]           = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const token = localStorage.getItem('crm_token');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/customer-portal/invoices`, { headers, credentials: 'include' });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      const data = await res.json();
      if (data.success) {
        const all = data.data || [];
        setTotalPages(Math.ceil(all.length / 20) || 1);
        setInvoices(all.slice((page - 1) * 20, page * 20));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const downloadPdf = async (invoiceId) => {
    try {
      const res = await fetch(`${API_URL}/customer-portal/invoices/${invoiceId}/pdf`, {
        headers, credentials: 'include', redirect: 'follow',
      });
      if (res.status === 401) { window.location.href = '/merchant/login'; return; }
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `invoice-${invoiceId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const statusBadge = (status) => {
    const map = { paid: 'success', unpaid: 'warning', overdue: 'error', partially_paid: 'warning' };
    return <span className={`cp-status-badge status-${map[status] || 'muted'}`}>{status?.replace(/_/g, ' ')}</span>;
  };

  if (loading) return <div className="cp-page"><CardListSkeleton count={5} /></div>;

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <h1 className="cp-page-title">Invoices</h1>
      </div>

      {invoices.length === 0 ? (
        <div className="cp-empty">
          <Page width={48} height={48} />
          <p>No invoices yet</p>
        </div>
      ) : (
        <>
          <div className="cp-table-wrap">
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Period</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 600 }}>{inv.invoice_number}</td>
                    <td>
                      <Calendar width={14} height={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="cp-detail-sub">{inv.period_start ? `${new Date(inv.period_start).toLocaleDateString()} – ${new Date(inv.period_end).toLocaleDateString()}` : '—'}</td>
                    <td>
                      <DollarCircle width={14} height={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                      <strong>{parseFloat(inv.total_amount || 0).toFixed(2)}</strong>
                    </td>
                    <td>{statusBadge(inv.status)}</td>
                    <td>
                      <button className="cp-btn cp-btn-sm cp-btn-outline" onClick={() => downloadPdf(inv.id)}>
                        <Download width={14} height={14} /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="cp-pagination">
              <button className="cp-btn cp-btn-sm cp-btn-outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span className="cp-pagination-info">Page {page} of {totalPages}</span>
              <button className="cp-btn cp-btn-sm cp-btn-outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
