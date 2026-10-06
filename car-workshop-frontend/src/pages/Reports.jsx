import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import ReactApexChart from 'react-apexcharts';
import {
  StatsReport, Calendar, MapPin, DeliveryTruck,
  Package, DollarCircle, Check, Xmark, Refresh, Download,
  User, Clock, Timer, Page, Wallet, CreditCard, Bank,
  Mail, Plus, Trash, SendMail, ClipboardCheck
} from 'iconoir-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { convertArabic } from 'arabic-reshaper';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { fmtCurrency, fmtCurrencyCompact } from '../utils/currency';
import './CRMPages.css';
import './Reports.css';
import { useTranslation } from 'react-i18next';
import { downloadCsv, toCsv, csvCell } from '../utils/csv';
import pioneerLogoPdf from '../assets/pioneer-logo-pdf.png';

/* ── Helpers ──────────────────────────────────────────────────── */
const pct    = (a, b) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '0%';

/* ── KPI Card ─────────────────────────────────────────────────── */
const KPI = ({ label, value, sub, color, icon: Icon }) => (
  <div className="rpt-kpi-card">
    <div className="rpt-kpi-icon" style={{ background: color + '18', color }}>
      <Icon width={20} height={20} />
    </div>
    <div className="rpt-kpi-body">
      <div className="rpt-kpi-value">{value}</div>
      <div className="rpt-kpi-label">{label}</div>
      {sub && <div className="rpt-kpi-sub">{sub}</div>}
    </div>
  </div>
);

/* ── Chart base options ───────────────────────────────────────── */
const CHART_BASE = {
  fontFamily: 'inherit',
  toolbar: { show: false },
  zoom:    { enabled: false },
};
const COLORS = ['#f97316', '#1e3a6b', '#22c55e', '#ef4444', '#8b5cf6', '#0ea5e9', '#f59e0b'];

export default function Reports() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { workshop } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';
  const fmtAED = v => fmtCurrency(v, cur);
  // Headline KPI cards are too narrow for fils; tables keep full precision.
  const fmtAEDShort = v => fmtCurrencyCompact(v, cur);
  const [period,   setPeriod]   = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [data,     setData]     = useState(null);
  const [finData,  setFinData]  = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ frequency: 'daily', recipients: '' });
  const [loading,  setLoading]  = useState(true);
  const [activeSection, setActiveSection] = useState('overview');

  // Business KPIs tab (bookings, repeat customers, survey) keeps its own date
  // range rather than reusing `period`/dateFrom/dateTo above: those drive a
  // server-resolved period type ('all', 'today', ...) for /reports and
  // /reports/financial, a different contract from the explicit from/to these
  // three endpoints expect. Defaults to the trailing 30 days.
  const [kpiRange, setKpiRange] = useState(() => {
    // Local calendar date, not toISOString()'s UTC one — see the same fix
    // in CustomerExperience.jsx for why "today" was dropping out early.
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86400000);
    return { from: iso(from), to: iso(to) };
  });
  const [kpiMatrix, setKpiMatrix] = useState(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const tabsRef = useRef(null);
  const [tabsScroll, setTabsScroll] = useState({ start: false, end: true });

  const handleTabsScroll = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setTabsScroll({
      start: el.scrollLeft > 8,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
    });
  }, []);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    handleTabsScroll();
    el.addEventListener('scroll', handleTabsScroll, { passive: true });
    window.addEventListener('resize', handleTabsScroll);
    return () => {
      el.removeEventListener('scroll', handleTabsScroll);
      window.removeEventListener('resize', handleTabsScroll);
    };
  }, [handleTabsScroll]);

  useEffect(() => { fetchAll(); }, [period, dateFrom, dateTo]);
  useEffect(() => { if (activeSection === 'financial') fetchFinancial(); }, [activeSection, period, dateFrom, dateTo]);
  useEffect(() => { if (activeSection === 'schedules') fetchSchedules(); }, [activeSection]);
  useEffect(() => {
    if (activeSection === 'kpi_matrix') fetchKpiMatrix();
  }, [activeSection, kpiRange.from, kpiRange.to]);

  const fetchSchedules = async () => {
    const res = await api.get('/reports/schedules');
    if (res.success) setSchedules(res.data || []);
  };

  const createSchedule = async () => {
    const recipients = scheduleForm.recipients.split(',').map(e => e.trim()).filter(Boolean);
    if (!recipients.length) return;
    const res = await api.post('/reports/schedules', { frequency: scheduleForm.frequency, recipients });
    if (res.success) {
      setShowScheduleForm(false);
      setScheduleForm({ frequency: 'daily', recipients: '' });
      fetchSchedules();
    }
  };

  const deleteSchedule = async (id) => {
    if (!confirm(t('reports.schedules.delete_confirm'))) return;
    await api.delete(`/reports/schedules/${id}`);
    fetchSchedules();
  };

  const toggleSchedule = async (schedule) => {
    await api.put(`/reports/schedules/${schedule.id}`, { is_active: !schedule.is_active });
    fetchSchedules();
  };

  const sendNow = async (id) => {
    const res = await api.post(`/reports/schedules/${id}/send-now`);
    if (res.success) alert(t('reports.schedules.sent_success'));
  };

  const fetchKpiMatrix = async () => {
    setKpiLoading(true);
    try {
      const qs = `from=${kpiRange.from}&to=${kpiRange.to}`;
      const [booking, customer, survey, contacts] = await Promise.all([
        api.get(`/appointments/stats?${qs}`),
        api.get(`/customers/stats?${qs}`),
        api.get(`/customer-survey/stats?${qs}`),
        api.get(`/crm/customers/activities/stats?${qs}`),
      ]);
      setKpiMatrix({
        booking: booking.success ? booking.data : null,
        customer: customer.success ? customer.data.period : null,
        survey: survey.success ? survey.data : null,
        contacts: contacts.success ? contacts.data : null,
      });
    } finally {
      setKpiLoading(false);
    }
  };

  const fetchFinancial = async () => {
    const params = new URLSearchParams({ period });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    const res = await api.get(`/reports/financial?${params}`);
    if (res.success) setFinData(res.data);
  };

  const fetchAll = async () => {
    setLoading(true);
    const params = new URLSearchParams({ type: 'overview', period });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo)   params.set('date_to',   dateTo);
    const res = await api.get(`/reports?${params}`);
    if (res.success) setData(res.data);
    setLoading(false);
  };

  const exportCSV = (rows, filename) => {
    if (!rows?.length) return;
    // SR-15 — see utils/csv.js. This used a bare join(','), so any value
    // containing a comma corrupted the columns and a leading = was a formula.
    downloadCsv(`${filename}.csv`, Object.keys(rows[0]), rows.map(r => Object.values(r)));
  };

  const exportPDF = async () => {
    if (!data) return;
    const doc = new jsPDF();
    const ov = data.overview || {};
    const now = new Date().toLocaleDateString('en-AE', { dateStyle: 'long' });

    // ── Load Amiri Arabic font (supports Arabic + Latin) ──
    try {
      const [regularResp, boldResp] = await Promise.all([
        fetch('/fonts/Amiri-Regular.ttf'),
        fetch('/fonts/Amiri-Bold.ttf'),
      ]);
      if (regularResp.ok && boldResp.ok) {
        const [regBuf, boldBuf] = await Promise.all([
          regularResp.arrayBuffer(),
          boldResp.arrayBuffer(),
        ]);
        const toBase64 = buf => {
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return btoa(binary);
        };
        doc.addFileToVFS('Amiri-Regular.ttf', toBase64(regBuf));
        doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
        doc.addFileToVFS('Amiri-Bold.ttf', toBase64(boldBuf));
        doc.addFont('Amiri-Bold.ttf', 'Amiri', 'bold');
        doc.setFont('Amiri', 'normal');
      }
    } catch (e) {
      console.warn('Failed to load Arabic font, falling back to default:', e);
    }

    // Logo, top-left regardless of RTL/LTR — the brand mark stays put; only
    // the body text flows with the language.
    let logoHeight = 0;
    try {
      const logoResp = await fetch(pioneerLogoPdf);
      if (logoResp.ok) {
        const logoBuf = await logoResp.arrayBuffer();
        const bytes = new Uint8Array(logoBuf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const logoBase64 = 'data:image/png;base64,' + btoa(binary);
        // Source PNG is 928x166 (aspect 5.59:1) — a fixed width keeps it a
        // sensible size across every page size jsPDF supports.
        const logoWidthMm = 44;
        logoHeight = logoWidthMm * (166 / 928);
        doc.addImage(logoBase64, 'PNG', 14, 10, logoWidthMm, logoHeight);
      }
    } catch (e) {
      console.warn('Failed to embed the Pioneer logo in the PDF export:', e);
    }

    // Enable RTL if Arabic UI
    if (isRTL) doc.setR2L(true);

    // Arabic text reshaping helper — converts to presentation forms so glyphs connect
    const _hasAr = s => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s || '');
    const ar = s => { if (!s || typeof s !== 'string') return s || ''; return _hasAr(s) ? convertArabic(s) : s; };

    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    // For RTL: text anchors on the right; for LTR: on the left
    const textX = isRTL ? pageW - margin : margin;
    const textAlign = isRTL ? 'right' : 'left';

    // Header — pushed down below the logo band (logoHeight is 0 if the fetch
    // above failed, so the layout still holds together without it).
    const titleY = 10 + logoHeight + 10;
    doc.setFontSize(20);
    doc.setTextColor(36, 64, 102);
    doc.text(ar(t('reports.pdf.title')), textX, titleY, { align: textAlign });
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(ar(t('reports.pdf.generated_period', { date: now, days: period })), textX, titleY + 8, { align: textAlign });

    // Common autoTable styles for Arabic font
    const tableFont = { font: 'Amiri' };
    const tableStyles = { ...tableFont, fontSize: 9, halign: isRTL ? 'right' : 'left' };
    const headStyles = { fillColor: [36, 64, 102], ...tableFont, fontStyle: 'bold', halign: isRTL ? 'right' : 'left' };

    // KPIs table
    const kpiHeadingY = titleY + 12;
    doc.setFontSize(13);
    doc.setTextColor(36, 64, 102);
    doc.text(ar(t('reports.pdf.overview')), textX, kpiHeadingY, { align: textAlign });
    autoTable(doc, {
      startY: kpiHeadingY + 4,
      head: [[ar(t('reports.pdf.metric')), ar(t('reports.pdf.value'))]],
      body: [
        [ar(t('reports.pdf.total_orders')), String(ov.total_orders || 0)],
        [ar(t('reports.pdf.delivered')), String(ov.delivered || 0)],
        [ar(t('reports.pdf.failed')), String(ov.failed || 0)],
        [ar(t('reports.pdf.success_rate')), (ov.success_rate || 0) + '%'],
        [ar(t('reports.pdf.total_revenue')), fmtAED(ov.total_revenue)],
        [ar(t('reports.pdf.cash_collected')), fmtAED(ov.cash_collected)],
      ],
      theme: 'grid',
      headStyles,
      styles: tableStyles,
    });

    // ServiceBay table
    if (data.by_zone?.length) {
      doc.setFontSize(13);
      doc.setTextColor(36, 64, 102);
      const zy = doc.lastAutoTable.finalY + 12;
      doc.text(ar(t('reports.pdf.orders_by_zone')), textX, zy, { align: textAlign });
      autoTable(doc, {
        startY: zy + 4,
        head: [[ar(t('reports.pdf.bay')), ar(t('reports.pdf.orders')), ar(t('reports.pdf.delivered')), ar(t('reports.pdf.success_pct')), ar(t('reports.pdf.revenue'))]],
        body: data.by_zone.map(r => [ar(r.bay), r.orders, r.delivered, pct(r.delivered, r.orders), fmtAED(r.revenue)]),
        theme: 'grid',
        headStyles,
        styles: { ...tableStyles, fontSize: 8 },
      });
    }

    // Mechanic table
    if (data.mechanic_performance?.length) {
      const dy = doc.lastAutoTable.finalY + 12;
      if (dy > 240) doc.addPage();
      const startY = dy > 240 ? 20 : dy;
      doc.setFontSize(13);
      doc.setTextColor(36, 64, 102);
      doc.text(ar(t('reports.pdf.mechanic_performance')), textX, startY, { align: textAlign });
      autoTable(doc, {
        startY: startY + 4,
        head: [[ar(t('reports.pdf.mechanic')), ar(t('reports.pdf.specialty')), ar(t('reports.pdf.total')), ar(t('reports.pdf.delivered')), ar(t('reports.pdf.failed')), ar(t('reports.pdf.success_pct')), ar(t('reports.pdf.revenue'))]],
        body: data.mechanic_performance.map(r => [
          ar(r.full_name), ar(r.specialty ? r.specialty.replace(/_/g, ' ') : '—'), r.total_assigned, r.delivered, r.failed,
          pct(r.delivered, r.total_assigned), fmtAED(r.revenue)
        ]),
        theme: 'grid',
        headStyles,
        styles: { ...tableStyles, fontSize: 8 },
      });
    }

    // Customer table
    if (data.top_customers?.length) {
      const cy = doc.lastAutoTable.finalY + 12;
      if (cy > 240) doc.addPage();
      const startY = cy > 240 ? 20 : cy;
      doc.setFontSize(13);
      doc.setTextColor(36, 64, 102);
      doc.text(ar(t('reports.pdf.top_customers')), textX, startY, { align: textAlign });
      autoTable(doc, {
        startY: startY + 4,
        head: [[ar(t('reports.pdf.customer')), ar(t('reports.pdf.orders')), ar(t('reports.pdf.delivered')), ar(t('reports.pdf.revenue')), ar(t('reports.pdf.avg_value'))]],
        body: data.top_customers.map(r => [ar(r.name), r.orders, r.delivered, fmtAED(r.revenue), fmtAED(r.avg_order_value)]),
        theme: 'grid',
        headStyles,
        styles: { ...tableStyles, fontSize: 8 },
      });
    }

    doc.save(`delivery-report-${period}days.pdf`);
  };

  const ov = data?.overview || {};

  const volumeSeries = data?.volume_by_day?.length ? [
    { name: t('reports.chart.total_series'),     data: data.volume_by_day.map(d => d.total || 0) },
    { name: t('reports.chart.delivered_label'), data: data.volume_by_day.map(d => d.delivered || 0) },
    { name: t('reports.chart.failed_label'),    data: data.volume_by_day.map(d => d.failed || 0) },
  ] : [];
  const volumeCategories = data?.volume_by_day?.map(d => d.date?.slice(5) || '') || [];

  const zoneSeries = data?.by_zone?.length ? [
    { name: t('reports.chart.orders_series'),    data: data.by_zone.map(d => d.orders || 0) },
    { name: t('reports.chart.delivered_label'), data: data.by_zone.map(d => d.delivered || 0) },
  ] : [];
  const zoneCategories = data?.by_zone?.map(d => d.bay || '') || [];

  const statusBreakdown = ov.total_orders > 0 ? [
    ov.delivered || 0,
    ov.failed    || 0,
    (ov.total_orders || 0) - (ov.delivered || 0) - (ov.failed || 0),
  ] : [];

  const paymentSeries     = data?.by_payment_method?.map(d => d.count || 0) || [];
  const paymentCategories = data?.by_payment_method?.map(d =>
    d.payment_method?.replace('_', ' ')?.replace(/\b\w/g, c => c.toUpperCase()) || '') || [];

  return (
    <div className="rpt-page">
      <div className="rpt-header">
        <div className="rpt-header-left">
          <div className="rpt-header-icon">
            <StatsReport width={24} height={24} />
          </div>
          <div className="rpt-header-text">
            <h1>{t('reports.title')}</h1>
            <p>{t("reports.subtitle")}</p>
          </div>
        </div>
        <div className="rpt-header-actions">
          <input type="date" className="filter-date" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)} />
          <span className="rpt-date-sep">{t('reports.date_separator')}</span>
          <input type="date" className="filter-date" value={dateTo}
            onChange={e => setDateTo(e.target.value)} />
          <select className="rpt-period-select" value={period}
            onChange={e => { setPeriod(e.target.value); setDateFrom(''); setDateTo(''); }}>
            <option value="all">{t("reports.all_time", "All time")}</option>
            <option value="7">{t("reports.last_7_days")}</option>
            <option value="30">{t("reports.last_30_days")}</option>
            <option value="90">{t("reports.last_90_days")}</option>
            <option value="365">{t('reports.last_year')}</option>
          </select>
          <button className="rpt-btn" onClick={fetchAll}>
            <Refresh width={14} height={14} /> {t('reports.refresh')}
          </button>
          <button className="rpt-btn rpt-btn-accent" onClick={exportPDF}>
            <Page width={14} height={14} /> {t('reports.pdf_report')}
          </button>
        </div>
      </div>

      <div className={`rpt-tabs-wrap${tabsScroll.start ? ' scrolled-start' : ''}${!tabsScroll.end ? ' scrolled-end' : ''}`}>
        <div className="rpt-tabs" ref={tabsRef}>
          {[
            { key: 'overview',      icon: StatsReport,    label: t('reports.tabs.overview') },
            { key: 'kpi_matrix',    icon: ClipboardCheck, label: t('reports.tabs.kpi_matrix') },
            { key: 'volume',        icon: Calendar,       label: t('reports.tabs.daily_volume') },
            { key: 'service_bays',         icon: MapPin,         label: t('reports.tabs.by_zone') },
            { key: 'mechanics',       icon: DeliveryTruck,  label: t('reports.tabs.mechanic_performance') },
            { key: 'customers',       icon: User,           label: t('reports.tabs.customers') },
            { key: 'types',         icon: Package,        label: t('reports.tabs.work_order_types') },
            { key: 'delivery_time', icon: Timer,          label: t('reports.tabs.delivery_time') },
            { key: 'payments',      icon: CreditCard,     label: t('reports.tabs.payments') },
            { key: 'financial',     icon: DollarCircle,   label: t('reports.tabs.financial') },
            { key: 'schedules',     icon: Mail,           label: t('reports.tabs.schedules') },
          ].map(s => (
            <button key={s.key} className={`rpt-tab ${activeSection === s.key ? 'active' : ''}`}
              onClick={(e) => { setActiveSection(s.key); e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); }}>
              <s.icon width={15} height={15} className="rpt-tab-icon" />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rpt-loading">
          {[1,2,3,4].map(i => <div key={i} className="skeleton-pulse" style={{ height: 120, borderRadius: 16 }} />)}
        </div>
      ) : !data ? (
        <div className="rpt-empty">
          <div className="rpt-empty-icon">
            <StatsReport width={36} height={36} />
          </div>
          <h3>{t('reports.no_data')}</h3>
          <p>{t('reports.no_orders_period')}</p>
        </div>
      ) : (
        <>
          {/* OVERVIEW */}
          {activeSection === 'overview' && (
            <div className="rpt-section">
              <div className="rpt-kpi-grid">
                <KPI icon={Package}      label={t('reports.kpi.total_orders')}  value={ov.total_orders || 0}    color="#1e3a6b" />
                <KPI icon={Check}        label={t('reports.kpi.delivered')}     value={ov.delivered || 0}         color="#16a34a" sub={pct(ov.delivered, ov.total_orders) + ' ' + t('reports.success_rate_suffix')} />
                <KPI icon={Xmark}        label={t('reports.kpi.failed')}        value={ov.failed || 0}            color="#dc2626" sub={pct(ov.failed, ov.total_orders) + ' ' + t('reports.of_total_suffix')} />
                <KPI icon={DollarCircle} label={t('reports.kpi.revenue')}       value={fmtAEDShort(ov.total_revenue)}  color="#f97316" />
                <KPI icon={DollarCircle} label={t('reports.kpi.cash_collected')} value={fmtAEDShort(ov.cash_collected)}  color="#8b5cf6" />
                <KPI icon={StatsReport}  label={t('reports.kpi.success_rate')}  value={(ov.success_rate || 0) + '%'} color="#0ea5e9" />
              </div>
              {statusBreakdown.length > 0 && (
                <div className="rpt-chart-row">
                  <div className="rpt-chart-card">
                    <div className="rpt-chart-header"><h4>{t('reports.chart.status_breakdown')}</h4></div>
                    <ReactApexChart type="donut" height={280}
                      series={statusBreakdown}
                      options={{
                        chart: CHART_BASE,
                        labels: [t('reports.chart.delivered_label'), t('reports.chart.failed_label'), t('reports.chart.other_label')],
                        colors: ['#22c55e', '#ef4444', '#94a3b8'],
                        legend: { position: 'bottom' },
                        dataLabels: { formatter: v => v.toFixed(1) + '%' },
                        plotOptions: { pie: { donut: { size: '65%' } } },
                      }}
                    />
                  </div>
                  {/* WorkOrders by Emirate hidden — leftover from the delivery
                      platform; a single-city workshop rarely needs an emirate
                      breakdown, and it displayed as one giant bar. */}
                </div>
              )}
              {/* Failure Reasons (#54) */}
              {data?.failure_reasons?.length > 0 && (
                <div className="rpt-chart-row" style={{ marginTop: 20 }}>
                  <div className="rpt-chart-card">
                    <div className="rpt-chart-header"><h4>{t("reports.failure_reasons")}</h4></div>
                    <ReactApexChart type="donut" height={280}
                      series={data.failure_reasons.map(d => d.count || 0)}
                      options={{
                        chart: CHART_BASE,
                        labels: data.failure_reasons.map(d => d.reason || 'Unknown'),
                        colors: ['#ef4444', '#f97316', '#d97706', '#94a3b8', '#8b5cf6', '#64748b'],
                        legend: { position: 'bottom' },
                        dataLabels: { formatter: v => v.toFixed(1) + '%' },
                        plotOptions: { pie: { donut: { size: '60%' } } },
                      }}
                    />
                  </div>
                  <div className="rpt-table-card" style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>{t("reports.failure_details")}</h4>
                    <table className="od-items-table">
                      <thead><tr><th>{t('reports.col.reason')}</th><th>{t('reports.col.count')}</th><th>{t('reports.col.pct_failed')}</th></tr></thead>
                      <tbody>
                        {data.failure_reasons.map((row, i) => {
                          const totalFailed = data.failure_reasons.reduce((a,b) => a + (b.count || 0), 0);
                          return (
                            <tr key={i}>
                              <td><strong>{row.reason}</strong></td>
                              <td style={{ fontWeight: 700, color: '#ef4444' }}>{row.count}</td>
                              <td>{pct(row.count, totalFailed)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* DAILY VOLUME */}
          {activeSection === 'volume' && (
            <div className="rpt-section rpt-chart-card">
              <div className="rpt-chart-header">
                <h4>{t("reports.daily_volume")}</h4>
                <button className="rpt-export-btn" onClick={() => exportCSV(data?.volume_by_day, 'volume-by-day')}>
                  <Download width={13} height={13} /> {t('reports.export_csv')}
                </button>
              </div>
              {volumeSeries.length > 0 ? (
                <ReactApexChart type="area" height={340} series={volumeSeries}
                  options={{
                    chart: { ...CHART_BASE, stacked: false },
                    colors: ['#1e3a6b', '#22c55e', '#ef4444'],
                    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05 } },
                    stroke: { curve: 'smooth', width: 2 },
                    xaxis: { categories: volumeCategories, labels: { rotate: -45 } },
                    tooltip: { shared: true, intersect: false },
                    legend: { position: 'top' },
                    dataLabels: { enabled: false },
                    grid: { borderColor: '#f1f5f9' },
                  }}
                />
              ) : <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0' }}>{t('reports.no_daily_data')}</p>}
            </div>
          )}

          {/* BY ZONE */}
          {activeSection === 'service_bays' && (
            <div className="rpt-section">
              {/* ServiceBay Heatmap (#57) */}
              {data?.by_zone?.length > 0 && (() => {
                const maxWorkOrders = Math.max(...data.by_zone.map(z => z.orders || 0), 1);
                return (
                  <div className="rpt-chart-card" style={{ marginBottom: 20 }}>
                    <div className="rpt-chart-header"><h4>{t('reports.chart.zone_density')}</h4></div>
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                      gap: 12, padding: '8px 0',
                    }}>
                      {data.by_zone.map((z, i) => {
                        const intensity = (z.orders || 0) / maxWorkOrders;
                        const bg = `rgba(36, 64, 102, ${0.08 + intensity * 0.82})`;
                        const textColor = intensity > 0.45 ? '#fff' : '#1e3a6b';
                        const successRate = z.orders > 0 ? ((z.delivered / z.orders) * 100).toFixed(0) : 0;
                        return (
                          <div key={i} style={{
                            background: bg, borderRadius: 12, padding: '16px 14px',
                            color: textColor, position: 'relative', overflow: 'hidden',
                            minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                          }}>
                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{z.bay || 'Unknown'}</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                              <div>
                                <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{z.orders}</div>
                                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{t('reports.chart.orders_label')}</div>
                              </div>
                              <div style={{ textAlign: isRTL ? 'left' : 'right' }}>
                                <div style={{ fontSize: 14, fontWeight: 700 }}>{successRate}%</div>
                                <div style={{ fontSize: 10, opacity: 0.8 }}>{t('reports.chart.success_label')}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <div className="rpt-chart-card" style={{ marginBottom: 20 }}>
                <div className="rpt-chart-header">
                  <h4>{t('reports.chart.orders_by_zone')}</h4>
                  <button className="rpt-export-btn" onClick={() => exportCSV(data?.by_zone, 'orders-by-bay')}>
                    <Download width={13} height={13} /> {t('reports.export_csv')}
                  </button>
                </div>
                {zoneSeries.length > 0 ? (
                  <ReactApexChart type="bar" height={320} series={zoneSeries}
                    options={{
                      chart: CHART_BASE,
                      colors: ['#1e3a6b', '#22c55e'],
                      xaxis: { categories: zoneCategories },
                      plotOptions: { bar: { borderRadius: 6, columnWidth: '60%', grouped: true } },
                      dataLabels: { enabled: false },
                      legend: { position: 'top' },
                      grid: { borderColor: '#f1f5f9' },
                    }}
                  />
                ) : <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0' }}>{t('reports.no_zone_data')}</p>}
              </div>
              {data?.by_zone?.length > 0 && (
                <div className="rpt-table-card">
                  <table className="od-items-table">
                    <thead><tr><th>{t('reports.col.bay')}</th><th>{t('reports.col.total')}</th><th>{t('reports.col.delivered')}</th><th>{t('reports.col.success_rate')}</th><th>{t('reports.col.revenue')}</th></tr></thead>
                    <tbody>
                      {data.by_zone.map((row, i) => (
                        <tr key={i}>
                          <td><strong>{row.bay}</strong></td>
                          <td>{row.orders}</td>
                          <td>{row.delivered}</td>
                          <td>{pct(row.delivered, row.orders)}</td>
                          <td>{fmtAED(row.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* MECHANIC PERFORMANCE */}
          {activeSection === 'mechanics' && (
            <div className="rpt-section">
              {data?.mechanic_performance?.length > 0 && (
                <div className="rpt-chart-card" style={{ marginBottom: 20 }}>
                  <div className="rpt-chart-header">
                    <h4>{t('reports.chart.top_mechanics')}</h4>
                    <button className="rpt-export-btn" onClick={() => exportCSV(data?.mechanic_performance, 'mechanic-performance')}>
                      <Download width={13} height={13} /> {t('reports.export_csv')}
                    </button>
                  </div>
                  <ReactApexChart type="bar" height={300}
                    series={[
                      { name: t('reports.chart.delivered_label'), data: data.mechanic_performance.slice(0,10).map(d => d.delivered || 0) },
                      { name: t('reports.chart.failed_label'),    data: data.mechanic_performance.slice(0,10).map(d => d.failed || 0) },
                    ]}
                    options={{
                      chart: { ...CHART_BASE, stacked: true },
                      colors: ['#22c55e', '#ef4444'],
                      xaxis: { categories: data.mechanic_performance.slice(0,10).map(d => d.full_name?.split(' ')[0] || '') },
                      plotOptions: { bar: { borderRadius: 4 } },
                      dataLabels: { enabled: false },
                      legend: { position: 'top' },
                      grid: { borderColor: '#f1f5f9' },
                    }}
                  />
                </div>
              )}
              <div className="rpt-table-card">
                <table className="od-items-table">
                  <thead><tr><th>{t('reports.col.mechanic')}</th><th>{t('reports.col.specialty')}</th><th>{t('reports.col.total')}</th><th>{t('reports.col.delivered')}</th><th>{t('reports.col.failed')}</th><th>{t('reports.col.success_rate')}</th><th>{t('reports.col.revenue')}</th><th>{t('reports.col.rating')}</th></tr></thead>
                  <tbody>
                    {data?.mechanic_performance?.length ? data.mechanic_performance.map((row, i) => (
                      <tr key={i}>
                        <td><strong>{row.full_name}</strong></td>
                        <td>{row.specialty ? row.specialty.replace(/_/g, ' ') : '—'}</td>
                        <td>{row.total_assigned}</td>
                        <td style={{ color:'#16a34a', fontWeight:600 }}>{row.delivered}</td>
                        <td style={{ color:'#dc2626' }}>{row.failed}</td>
                        <td>{pct(row.delivered, row.total_assigned)}</td>
                        <td>{fmtAED(row.revenue)}</td>
                        <td>{row.rating ? `⭐ ${parseFloat(row.rating).toFixed(1)}` : '—'}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={8} style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>{t('reports.no_mechanic_data_text')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PAYMENTS */}
          {activeSection === 'payments' && (
            <div className="rpt-section rpt-chart-row">
              {paymentSeries.length > 0 && (
                <div className="rpt-chart-card">
                  <div className="rpt-chart-header"><h4>{t('reports.chart.payment_distribution')}</h4></div>
                  <ReactApexChart type="pie" height={300} series={paymentSeries}
                    options={{
                      chart: CHART_BASE,
                      labels: paymentCategories,
                      colors: COLORS,
                      legend: { position: 'bottom' },
                      dataLabels: { formatter: v => v.toFixed(1) + '%' },
                    }}
                  />
                </div>
              )}
              <div className="rpt-table-card" style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>{t('reports.chart.payment_breakdown')}</h4>
                <table className="od-items-table">
                  <thead><tr><th>{t('reports.col.method')}</th><th>{t('reports.col.orders')}</th><th>{t('reports.col.revenue')}</th></tr></thead>
                  <tbody>
                    {data?.by_payment_method?.length ? data.by_payment_method.map((row, i) => (
                      <tr key={i}>
                        <td><strong>{row.payment_method?.replace('_',' ')?.replace(/\b\w/g, c => c.toUpperCase())}</strong></td>
                        <td>{row.count}</td>
                        <td>{fmtAED(row.revenue)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={3} style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>{t('reports.no_payment_data')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CUSTOMERS (#46) */}
          {activeSection === 'customers' && (
            <div className="rpt-section">
              {data?.top_customers?.length > 0 && (
                <>
                  <div className="rpt-chart-row" style={{ marginBottom: 20 }}>
                    <div className="rpt-chart-card">
                      <div className="rpt-chart-header"><h4>{t('reports.chart.top_customers')}</h4></div>
                      <ReactApexChart type="bar" height={320}
                        series={[
                          { name: t('reports.chart.orders_series'), data: data.top_customers.slice(0,10).map(c => c.orders || 0) },
                          { name: t('reports.chart.delivered_label'), data: data.top_customers.slice(0,10).map(c => c.delivered || 0) },
                        ]}
                        options={{
                          chart: { ...CHART_BASE, stacked: false },
                          colors: ['#1e3a6b', '#22c55e'],
                          xaxis: { categories: data.top_customers.slice(0,10).map(c => c.name?.split(' ')[0] || 'N/A') },
                          plotOptions: { bar: { borderRadius: 6, columnWidth: '55%' } },
                          dataLabels: { enabled: false },
                          legend: { position: 'top' },
                          grid: { borderColor: '#f1f5f9' },
                        }}
                      />
                    </div>
                    <div className="rpt-chart-card">
                      <div className="rpt-chart-header"><h4>{t('reports.chart.revenue_by_customer')}</h4></div>
                      <ReactApexChart type="donut" height={320}
                        series={data.top_customers.slice(0,8).map(c => parseFloat(c.revenue) || 0)}
                        options={{
                          chart: CHART_BASE,
                          labels: data.top_customers.slice(0,8).map(c => c.name || 'N/A'),
                          colors: COLORS,
                          legend: { position: 'bottom' },
                          dataLabels: { formatter: v => v.toFixed(1) + '%' },
                          plotOptions: { pie: { donut: { size: '60%' } } },
                        }}
                      />
                    </div>
                  </div>
                  <div className="rpt-table-card">
                    <div className="rpt-chart-header" style={{ marginBottom: 16 }}>
                      <h4>{t("reports.customer_analytics")}</h4>
                      <button className="rpt-export-btn" onClick={() => exportCSV(data?.top_customers, 'customer-analytics')}>
                        <Download width={13} height={13} /> {t('reports.export_csv')}
                      </button>
                    </div>
                    <table className="od-items-table">
                      <thead><tr><th>{t('reports.col.customer')}</th><th>{t('reports.col.company')}</th><th>{t('reports.col.orders')}</th><th>{t('reports.col.delivered')}</th><th>{t('reports.col.failed')}</th><th>{t('reports.col.success_pct')}</th><th>{t('reports.col.revenue')}</th><th>{t('reports.col.avg_value')}</th><th>{t('reports.cod_total')}</th></tr></thead>
                      <tbody>
                        {data.top_customers.map((row, i) => (
                          <tr key={i}>
                            <td><strong>{row.name}</strong></td>
                            <td>{row.company || '—'}</td>
                            <td style={{ fontWeight: 700 }}>{row.orders}</td>
                            <td style={{ color: '#16a34a', fontWeight: 600 }}>{row.delivered}</td>
                            <td style={{ color: row.failed > 0 ? '#ef4444' : '#94a3b8' }}>{row.failed}</td>
                            <td>{pct(row.delivered, row.orders)}</td>
                            <td>{fmtAED(row.revenue)}</td>
                            <td>{fmtAED(row.avg_order_value)}</td>
                            <td>{fmtAED(row.cod_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {(!data?.top_customers || data.top_customers.length === 0) && (
                <div className="rpt-empty">
                  <div className="rpt-empty-icon"><User width={36} height={36} /></div>
                  <h3>{t('reports.no_customer_data')}</h3>
                  <p>{t('reports.no_customer_orders')}</p>
                </div>
              )}
            </div>
          )}

          {/* ORDER TYPES (#49) */}
          {activeSection === 'types' && (
            <div className="rpt-section rpt-chart-row">
              {data?.by_work_order_type?.length > 0 ? (
                <>
                  <div className="rpt-chart-card">
                    <div className="rpt-chart-header"><h4>{t('reports.chart.work_order_types_dist')}</h4></div>
                    <ReactApexChart type="donut" height={300}
                      series={data.by_work_order_type.map(d => d.count || 0)}
                      options={{
                        chart: CHART_BASE,
                        labels: data.by_work_order_type.map(d => (d.work_order_type || 'standard').replace('_',' ').replace(/\b\w/g, c => c.toUpperCase())),
                        colors: COLORS,
                        legend: { position: 'bottom' },
                        dataLabels: { formatter: v => v.toFixed(1) + '%' },
                        plotOptions: { pie: { donut: { size: '60%' } } },
                      }}
                    />
                  </div>
                  <div className="rpt-table-card" style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>{t('reports.chart.work_order_type_breakdown')}</h4>
                    <table className="od-items-table">
                      <thead><tr><th>{t('reports.col.type')}</th><th>{t('reports.col.count')}</th><th>{t('reports.col.pct_total')}</th></tr></thead>
                      <tbody>
                        {data.by_work_order_type.map((row, i) => (
                          <tr key={i}>
                            <td><strong>{(row.work_order_type || 'standard').replace('_',' ').replace(/\b\w/g, c => c.toUpperCase())}</strong></td>
                            <td style={{ fontWeight: 700 }}>{row.count}</td>
                            <td>{pct(row.count, ov.total_orders)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="rpt-empty" style={{ gridColumn: '1 / -1' }}>
                  <div className="rpt-empty-icon"><Package width={36} height={36} /></div>
                  <h3>{t('reports.no_work_order_type_data')}</h3>
                  <p>{t('reports.no_work_order_type_sub')}</p>
                </div>
              )}
            </div>
          )}

          {/* DELIVERY TIME BY ZONE (#51) */}
          {activeSection === 'delivery_time' && (
            <div className="rpt-section">
              {data?.delivery_time_by_zone?.length > 0 ? (
                <>
                  <div className="rpt-chart-card" style={{ marginBottom: 20 }}>
                    <div className="rpt-chart-header">
                      <h4>{t("reports.avg_delivery_time")}</h4>
                      <button className="rpt-export-btn" onClick={() => exportCSV(data?.delivery_time_by_zone, 'delivery-time-by-bay')}>
                        <Download width={13} height={13} /> {t('reports.export_csv')}
                      </button>
                    </div>
                    <ReactApexChart type="bar" height={340}
                      series={[
                        { name: t('reports.chart.avg_minutes_series'), data: data.delivery_time_by_zone.map(d => d.avg_minutes || 0) },
                      ]}
                      options={{
                        chart: CHART_BASE,
                        colors: ['#667eea'],
                        xaxis: { categories: data.delivery_time_by_zone.map(d => d.bay || '') },
                        plotOptions: { bar: { borderRadius: 6, columnWidth: '50%' } },
                        dataLabels: { enabled: true, formatter: v => v > 60 ? `${(v/60).toFixed(1)}h` : `${v}m` },
                        grid: { borderColor: '#f1f5f9' },
                        yaxis: { title: { text: t('reports.yaxis_minutes') } },
                      }}
                    />
                  </div>
                  <div className="rpt-table-card">
                    <table className="od-items-table">
                      <thead><tr><th>{t('reports.col.bay')}</th><th>{t('reports.deliveries')}</th><th>{t('reports.col.avg_time')}</th><th>{t('reports.fastest')}</th><th>{t('reports.col.slowest')}</th></tr></thead>
                      <tbody>
                        {data.delivery_time_by_zone.map((row, i) => {
                          const fmtM = m => { if (!m) return '—'; return m >= 60 ? `${(m/60).toFixed(1)}h` : `${m}m`; };
                          return (
                            <tr key={i}>
                              <td><strong>{row.bay}</strong></td>
                              <td>{row.delivered}</td>
                              <td style={{ fontWeight: 700, color: '#667eea' }}>{fmtM(row.avg_minutes)}</td>
                              <td style={{ color: '#16a34a' }}>{fmtM(row.min_minutes)}</td>
                              <td style={{ color: '#ef4444' }}>{fmtM(row.max_minutes)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="rpt-empty">
                  <div className="rpt-empty-icon"><Timer width={36} height={36} /></div>
                  <h3>{t('reports.no_delivery_time')}</h3>
                  <p>{t('reports.no_delivery_time_sub')}</p>
                </div>
              )}
            </div>
          )}

          {/* FINANCIAL SUMMARY (#55) */}
          {activeSection === 'financial' && (
            <div className="rpt-section">
              {finData ? (() => {
                const fk = finData.kpis || {};
                return (
                  <>
                    {/* Financial KPI Cards */}
                    <div className="rpt-kpi-grid">
                      <KPI icon={DollarCircle} label={t('reports.financial.gross_fees')}     value={fmtAEDShort(fk.gross_service_fees)} color="#1e3a6b" />
                      <KPI icon={Xmark}        label={t('reports.financial.discounts')}      value={fmtAEDShort(fk.total_discounts)}     color="#ef4444" />
                      <KPI icon={Wallet}       label={t('reports.financial.net_revenue')}    value={fmtAEDShort(fk.net_revenue)}         color="#16a34a" sub={t('reports.financial.delivered_orders_sub', { count: fk.delivered || 0 })} />
                      <KPI icon={CreditCard}   label={t('reports.financial.cash_collected')}  value={fmtAEDShort(fk.cash_collected)}       color="#f97316" />
                      <KPI icon={Bank}         label={t('reports.financial.cod_settled')}    value={fmtAEDShort(fk.cod_settled)}         color="#22c55e" />
                      <KPI icon={Clock}        label={t('reports.financial.cod_pending')}    value={fmtAEDShort(fk.cod_unsettled)}       color="#dc2626" sub={t('reports.financial.outstanding_sub', { amount: fmtAEDShort(fk.cod_outstanding) })} />
                    </div>

                    {/* Revenue Trend Chart */}
                    {finData.revenue_by_day?.length > 0 && (
                      <div className="rpt-chart-card" style={{ marginBottom: 20 }}>
                        <div className="rpt-chart-header">
                          <h4>{t('reports.chart.revenue_trend')}</h4>
                          <button className="rpt-export-btn" onClick={() => exportCSV(finData.revenue_by_day, 'revenue-by-day')}>
                            <Download width={13} height={13} /> {t('reports.export_csv')}
                          </button>
                        </div>
                        <ReactApexChart type="area" height={320}
                          series={[
                            { name: t('reports.chart.revenue_series'), data: finData.revenue_by_day.map(d => parseFloat(d.revenue) || 0) },
                            { name: t('reports.chart.cod_series'),     data: finData.revenue_by_day.map(d => parseFloat(d.cod) || 0) },
                          ]}
                          options={{
                            chart: { ...CHART_BASE, stacked: false },
                            colors: ['#22c55e', '#f97316'],
                            xaxis: { categories: finData.revenue_by_day.map(d => d.date?.slice(5) || '') },
                            stroke: { curve: 'smooth', width: [3, 2] },
                            fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
                            dataLabels: { enabled: false },
                            grid: { borderColor: '#f1f5f9' },
                            yaxis: { title: { text: t('reports.yaxis_aed') }, labels: { formatter: v => v >= 1000 ? (v/1000).toFixed(1) + 'K' : v.toFixed(0) } },
                            legend: { position: 'top' },
                            tooltip: { y: { formatter: v => fmtAED(v) } },
                          }}
                        />
                      </div>
                    )}

                    {/* Payment Method & ServiceBay Revenue side-by-side */}
                    <div className="rpt-chart-row" style={{ marginBottom: 20 }}>
                      {finData.by_payment_method?.length > 0 && (
                        <div className="rpt-chart-card">
                          <div className="rpt-chart-header"><h4>{t('reports.chart.revenue_by_payment')}</h4></div>
                          <ReactApexChart type="donut" height={280}
                            series={finData.by_payment_method.map(d => parseFloat(d.revenue) || 0)}
                            options={{
                              chart: CHART_BASE,
                              labels: finData.by_payment_method.map(d => (d.payment_method || '').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())),
                              colors: ['#22c55e', '#f97316', '#3b82f6', '#8b5cf6'],
                              legend: { position: 'bottom' },
                              dataLabels: { formatter: v => v.toFixed(1) + '%' },
                              plotOptions: { pie: { donut: { size: '60%' } } },
                              tooltip: { y: { formatter: v => fmtAED(v) } },
                            }}
                          />
                        </div>
                      )}
                      {finData.revenue_by_zone?.length > 0 && (
                        <div className="rpt-chart-card">
                          <div className="rpt-chart-header"><h4>{t('reports.chart.revenue_by_zone')}</h4></div>
                          <ReactApexChart type="bar" height={280}
                            series={[{ name: t('reports.chart.revenue_series'), data: finData.revenue_by_zone.map(d => parseFloat(d.revenue) || 0) }]}
                            options={{
                              chart: CHART_BASE,
                              colors: ['#1e3a6b'],
                              xaxis: { categories: finData.revenue_by_zone.map(d => d.bay || '') },
                              plotOptions: { bar: { borderRadius: 6, columnWidth: '50%', horizontal: true } },
                              dataLabels: { enabled: true, formatter: v => fmtAED(v) },
                              grid: { borderColor: '#f1f5f9' },
                              tooltip: { y: { formatter: v => fmtAED(v) } },
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Top Customers by Revenue */}
                    {finData.top_customers?.length > 0 && (
                      <div className="rpt-table-card" style={{ marginBottom: 20 }}>
                        <div className="rpt-chart-header" style={{ marginBottom: 16 }}>
                          <h4>{t('reports.chart.top_customers_revenue')}</h4>
                          <button className="rpt-export-btn" onClick={() => exportCSV(finData.top_customers, 'top-customers-revenue')}>
                            <Download width={13} height={13} /> {t('reports.export_csv')}
                          </button>
                        </div>
                        <table className="od-items-table">
                          <thead><tr><th>{t('reports.col.customer')}</th><th>{t('reports.col.company')}</th><th>{t('reports.col.orders')}</th><th>{t('reports.col.revenue')}</th><th>{t('reports.col.cod')}</th></tr></thead>
                          <tbody>
                            {finData.top_customers.map((row, i) => (
                              <tr key={i}>
                                <td><strong>{row.name}</strong></td>
                                <td>{row.company || '—'}</td>
                                <td>{row.orders}</td>
                                <td style={{ fontWeight: 700, color: '#16a34a' }}>{fmtAED(row.revenue)}</td>
                                <td>{fmtAED(row.cod_total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Mechanic Settlements */}
                    {finData.mechanic_settlements?.length > 0 && (
                      <div className="rpt-table-card">
                        <div className="rpt-chart-header" style={{ marginBottom: 16 }}>
                          <h4>{t('reports.chart.mechanic_settlements')}</h4>
                          <button className="rpt-export-btn" onClick={() => exportCSV(finData.mechanic_settlements, 'mechanic-settlements')}>
                            <Download width={13} height={13} /> {t('reports.export_csv')}
                          </button>
                        </div>
                        <table className="od-items-table">
                          <thead><tr><th>{t('reports.col.mechanic')}</th><th>{t('reports.deliveries')}</th><th>{t('reports.col.revenue_generated')}</th><th>{t('reports.cash_collected')}</th><th>{t('reports.cod_settled')}</th><th>{t('reports.cod_pending')}</th></tr></thead>
                          <tbody>
                            {finData.mechanic_settlements.map((row, i) => (
                              <tr key={i}>
                                <td><strong>{row.name}</strong></td>
                                <td>{row.deliveries}</td>
                                <td style={{ fontWeight: 600 }}>{fmtAED(row.revenue_generated)}</td>
                                <td>{fmtAED(row.cash_collected)}</td>
                                <td style={{ color: '#16a34a' }}>{fmtAED(row.cod_settled)}</td>
                                <td style={{ color: parseFloat(row.cod_pending) > 0 ? '#ef4444' : '#94a3b8', fontWeight: 700 }}>
                                  {fmtAED(row.cod_pending)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                );
              })() : (
                <div className="rpt-loading">
                  {[1,2,3].map(i => <div key={i} className="skeleton-pulse" style={{ height: 120, borderRadius: 12 }} />)}
                </div>
              )}
            </div>
          )}

          {/* EMAIL SCHEDULES (#58) */}
          {activeSection === 'schedules' && (
            <div className="rpt-section">
              <div className="rpt-chart-card" style={{ marginBottom: 20 }}>
                <div className="rpt-chart-header">
                  <h4><Mail width={18} height={18} /> {t('reports.schedules.title')}</h4>
                  <button className="rpt-btn rpt-btn-accent" onClick={() => setShowScheduleForm(v => !v)}
                    style={{ fontSize: '0.82rem' }}>
                    <Plus width={14} height={14} /> {t('reports.schedules.new')}
                  </button>
                </div>
                <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>
                  {t('reports.schedules.desc')}
                </p>
              </div>

              {showScheduleForm && (
                <div className="rpt-schedule-form">
                  <h4>{t("reports.create_schedule")}</h4>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <label>{t("reports.frequency")}</label>
                      <select className="rpt-period-select" value={scheduleForm.frequency}
                        onChange={e => setScheduleForm(f => ({ ...f, frequency: e.target.value }))}>
                        <option value="daily">{t('reports.schedules.daily')}</option>
                        <option value="weekly">{t('reports.schedules.weekly')}</option>
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: 280 }}>
                      <label>
                        {t('reports.schedules.recipients_label')}
                      </label>
                      <input type="text" className="filter-date" style={{ width: '100%' }}
                        placeholder={t('reports.schedules.recipients_placeholder')}
                        value={scheduleForm.recipients}
                        onChange={e => setScheduleForm(f => ({ ...f, recipients: e.target.value }))} />
                    </div>
                    <button className="rpt-action-btn success" onClick={createSchedule}
                      style={{ height: 40 }}>
                      <Check width={14} height={14} /> {t('reports.schedules.create_btn')}
                    </button>
                  </div>
                </div>
              )}

              {schedules.length > 0 ? (
                <div className="rpt-table-card">
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th>{t("reports.frequency")}</th>
                        <th>{t('reports.schedules.col.recipients')}</th>
                        <th>{t('reports.schedules.col.schedule')}</th>
                        <th>{t('reports.last_sent')}</th>
                        <th>{t('reports.col.status')}</th>
                        <th>{t('reports.col.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.map(s => {
                        const recipients = typeof s.recipients === 'string' ? JSON.parse(s.recipients) : (s.recipients || []);
                        return (
                          <tr key={s.id}>
                            <td><strong>{s.frequency === 'weekly' ? t('reports.schedules.freq.weekly') : t('reports.schedules.freq.daily')}</strong></td>
                            <td style={{ maxWidth: 260, wordBreak: 'break-all' }}>
                              {recipients.join(', ')}
                            </td>
                            <td style={{ color: '#64748b', fontSize: 13 }}>{s.cron_expression}</td>
                            <td>{s.last_sent ? new Date(s.last_sent).toLocaleString() : '—'}</td>
                            <td>
                              <span className={`rpt-badge ${s.is_active ? 'rpt-badge-active' : 'rpt-badge-paused'}`}>
                                {s.is_active ? t('common.active') : t('reports.schedules.paused')}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className="rpt-action-btn" onClick={() => toggleSchedule(s)} title={s.is_active ? t('reports.schedules.pause') : t('reports.schedules.activate')}>
                                  {s.is_active ? t('reports.schedules.pause') : t('reports.schedules.activate')}
                                </button>
                                <button className="rpt-action-btn" onClick={() => sendNow(s.id)}
                                  title={t('reports.schedules.send_now')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <SendMail width={13} height={13} /> {t('reports.schedules.send_now')}
                                </button>
                                <button className="rpt-action-btn danger" onClick={() => deleteSchedule(s.id)}
                                  title={t('common.delete')}>
                                  <Trash width={13} height={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : !showScheduleForm ? (
                <div className="rpt-empty">
                  <div className="rpt-empty-icon"><Mail width={36} height={36} /></div>
                  <h3>{t('reports.schedules.empty_title')}</h3>
                  <p>{t('reports.schedules.empty_sub')}</p>
                </div>
              ) : null}
            </div>
          )}

          {/* Business KPIs: bookings, repeat customers, survey */}
          {activeSection === 'kpi_matrix' && (
            <div className="rpt-section">
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                    {t('reports.kpi.range_from')}
                  </label>
                  <input type="date" className="filter-date" value={kpiRange.from}
                    onChange={e => setKpiRange(r => ({ ...r, from: e.target.value }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                    {t('reports.kpi.range_to')}
                  </label>
                  <input type="date" className="filter-date" value={kpiRange.to}
                    onChange={e => setKpiRange(r => ({ ...r, to: e.target.value }))} />
                </div>
                <button className="rpt-btn" onClick={fetchKpiMatrix} disabled={kpiLoading}>
                  <Refresh width={14} height={14} /> {t('reports.refresh')}
                </button>
              </div>

              {kpiLoading && !kpiMatrix ? (
                <div className="rpt-loading">
                  {[1, 2, 3, 4].map(i => <div key={i} className="skeleton-pulse" style={{ height: 120, borderRadius: 16 }} />)}
                </div>
              ) : !kpiMatrix ? (
                <div className="rpt-empty">
                  <div className="rpt-empty-icon"><ClipboardCheck width={36} height={36} /></div>
                  <h3>{t('reports.kpi.no_data')}</h3>
                </div>
              ) : (
                <>
                  <div className="rpt-kpi-grid">
                    <KPI label={t('reports.kpi.bookings_received')}
                      value={kpiMatrix.booking?.totals?.received ?? '\u2014'}
                      sub={kpiMatrix.booking ? t('reports.kpi.confirmed_count', { n: kpiMatrix.booking.totals.confirmed }) : ''}
                      color="#1e3a6b" icon={Calendar} />
                    <KPI label={t('reports.kpi.booking_conversion')}
                      value={kpiMatrix.booking?.totals?.conversion_rate_pct != null ? kpiMatrix.booking.totals.conversion_rate_pct + '%' : '\u2014'}
                      color="#0ea5e9" icon={Check} />
                    <KPI label={t('reports.kpi.show_up_rate')}
                      value={kpiMatrix.booking?.totals?.show_up_rate_pct != null ? kpiMatrix.booking.totals.show_up_rate_pct + '%' : '\u2014'}
                      color="#22c55e" icon={User} />
                    <KPI label={t('reports.kpi.new_customers')}
                      value={kpiMatrix.customer?.new_customers ?? '\u2014'}
                      sub={kpiMatrix.customer ? t('reports.kpi.of_customers_served', { n: kpiMatrix.customer.customers_served }) : ''}
                      color="#f97316" icon={User} />
                    <KPI label={t('reports.kpi.repeat_customer_rate')}
                      value={kpiMatrix.customer?.repeat_rate_pct != null ? kpiMatrix.customer.repeat_rate_pct + '%' : '\u2014'}
                      sub={kpiMatrix.customer ? t('reports.kpi.repeat_count', { n: kpiMatrix.customer.repeat_customers }) : ''}
                      color="#8b5cf6" icon={User} />
                    <KPI label={t('reports.kpi.survey_response_rate')}
                      value={kpiMatrix.survey?.headline?.responseRate != null ? kpiMatrix.survey.headline.responseRate + '%' : '\u2014'}
                      sub={kpiMatrix.survey ? t('reports.kpi.invites_sent_count', { n: kpiMatrix.survey.headline.invitesSent }) : ''}
                      color="#0ea5e9" icon={SendMail} />
                    <KPI label={t('reports.kpi.nps')}
                      value={kpiMatrix.survey?.headline?.nps != null ? (kpiMatrix.survey.headline.nps > 0 ? '+' + kpiMatrix.survey.headline.nps : '' + kpiMatrix.survey.headline.nps) : '\u2014'}
                      color="#22c55e" icon={StatsReport} />
                    <KPI label={t('reports.kpi.csat')}
                      value={kpiMatrix.survey?.headline?.csatAvg != null ? kpiMatrix.survey.headline.csatAvg + '/5' : '\u2014'}
                      color="#f59e0b" icon={Check} />
                  </div>

                  <div className="rpt-chart-row" style={{ marginTop: 20 }}>
                    <div className="rpt-table-card">
                      <div className="rpt-chart-header"><h4>{t('reports.kpi.by_channel_title')}</h4></div>
                      {kpiMatrix.booking?.by_channel?.length > 0 ? (
                        <table className="od-items-table">
                          <thead>
                            <tr>
                              <th>{t('reports.kpi.col_channel')}</th>
                              <th>{t('reports.kpi.col_received')}</th>
                              <th>{t('reports.kpi.col_confirmed')}</th>
                              <th>{t('reports.kpi.col_arrived')}</th>
                              <th>{t('reports.kpi.col_conversion')}</th>
                              <th>{t('reports.kpi.col_show_up')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kpiMatrix.booking.by_channel.map(row => (
                              <tr key={row.channel}>
                                <td><strong>{row.channel}</strong></td>
                                <td>{row.received}</td>
                                <td>{row.confirmed}</td>
                                <td>{row.arrived_or_completed}</td>
                                <td>{row.conversion_rate_pct != null ? row.conversion_rate_pct + '%' : '\u2014'}</td>
                                <td>{row.show_up_rate_pct != null ? row.show_up_rate_pct + '%' : '\u2014'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="rpt-empty"><p>{t('reports.kpi.no_data')}</p></div>}
                    </div>

                    <div className="rpt-table-card">
                      <div className="rpt-chart-header"><h4>{t('reports.kpi.by_customer_type_title')}</h4></div>
                      {kpiMatrix.booking?.by_customer_type?.length > 0 ? (
                        <table className="od-items-table">
                          <thead>
                            <tr>
                              <th>{t('reports.kpi.col_customer_type')}</th>
                              <th>{t('reports.kpi.col_received')}</th>
                              <th>{t('reports.kpi.col_confirmed')}</th>
                              <th>{t('reports.kpi.col_arrived')}</th>
                              <th>{t('reports.kpi.col_conversion')}</th>
                              <th>{t('reports.kpi.col_show_up')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kpiMatrix.booking.by_customer_type.map(row => (
                              <tr key={row.customer_type}>
                                <td><strong>{row.customer_type}</strong></td>
                                <td>{row.received}</td>
                                <td>{row.confirmed}</td>
                                <td>{row.arrived_or_completed}</td>
                                <td>{row.conversion_rate_pct != null ? row.conversion_rate_pct + '%' : '\u2014'}</td>
                                <td>{row.show_up_rate_pct != null ? row.show_up_rate_pct + '%' : '\u2014'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="rpt-empty"><p>{t('reports.kpi.no_data')}</p></div>}
                    </div>

                    <div className="rpt-table-card">
                      <div className="rpt-chart-header"><h4>{t('reports.kpi.by_contact_channel_title')}</h4></div>
                      {kpiMatrix.contacts?.by_channel?.length > 0 ? (
                        <table className="od-items-table">
                          <thead>
                            <tr>
                              <th>{t('reports.kpi.col_channel')}</th>
                              <th>{t('reports.kpi.col_contacts')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kpiMatrix.contacts.by_channel.map(row => (
                              <tr key={row.channel}>
                                <td><strong>{t(`reports.kpi.channel_${row.channel}`)}</strong></td>
                                <td>{row.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="rpt-empty"><p>{t('reports.kpi.no_data')}</p></div>}
                      <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, marginBottom: 0 }}>
                        {t('reports.kpi.contact_channel_note')}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
