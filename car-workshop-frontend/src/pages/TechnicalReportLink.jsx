/**
 * TechnicalReportLink — public, no-login page a customer reaches from the
 * link the workshop sends once the technical inspection is completed
 * (routes/technical-inspections.js POST /:id/share, by WhatsApp or e-mail).
 * Same shape as InspectionLink.jsx: plain fetch against /api/public/...,
 * no auth headers, its own small CSS file, built phone-first.
 *
 * It is the customer's copy of the technical report (client meeting,
 * 3 Nov 2026): the work the car needs — each job / service, its service
 * type, the labour and the parts by name (TechnicalReportLines). No hours,
 * quantities or prices: the prices come with the estimate. A cancelled job's
 * link closes (410); while the workshop has reopened the report to change it
 * the page says so (409 REPORT_UPDATING).
 *
 * Words: t('techReport.*', 'English default'); the cancelled state is the
 * shared customer status (lib/statusLabels.js).
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import TechnicalReportLines from '../components/TechnicalReportLines';
import { woLabel } from '../lib/statusLabels';
import { logoSrc } from '../components/service-status/workshopLogo';
import './TechnicalReportLink.css';

/** The Pioneer mark (with "Car Service Center"), used when the workshop has no logo of its own. */
const PIONEER_LOGO = '/assets/images/logos/pioneer/pioneer_logo_main.svg';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// The API sends 'YYYY-MM-DD HH:MM:SS'; Safari only parses it with the T.
const fmtDate = d => (d ? new Date(String(d).replace(' ', 'T')).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function TechnicalReportLink() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | ready | updating | invalid | closed | error
  const [workshop, setWorkshop] = useState(null);
  const [report, setReport] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/public/technical-reports/${token}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 410) { setPhase('closed'); return; }
      if (res.status === 409 && json.code === 'REPORT_UPDATING') { setWorkshop(json.workshop || null); setPhase('updating'); return; }
      if (res.status >= 500 || res.status === 429) { setPhase('error'); return; }
      if (!res.ok || !json.success) { setPhase('invalid'); return; }
      setWorkshop(json.workshop || {});
      setReport(json.report);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const retry = (
    <button type="button" className="trp-btn trp-retry" onClick={() => { setPhase('loading'); load(); }}>
      {t('techReport.retry', 'Try again')}
    </button>
  );
  if (phase === 'loading') {
    return <div className="trp-page"><div className="trp-card trp-center"><div className="trp-spinner" aria-hidden />{t('techReport.loading', 'Loading your report…')}</div></div>;
  }
  if (phase === 'invalid') {
    return <div className="trp-page"><div className="trp-card trp-center">
      <h1>{t('techReport.invalid_title', 'Link not found')}</h1>
      <p>{t('techReport.invalid_body', "This report link isn't valid. Please contact the workshop for a new one.")}</p>
    </div></div>;
  }
  if (phase === 'closed') {
    return <div className="trp-page"><div className="trp-card trp-center">
      <h1>{woLabel(t, 'cancelled', 'customer')}</h1>
      <p>{t('techReport.closed_body', 'This job was cancelled, so its report is no longer available here. Please contact the workshop.')}</p>
    </div></div>;
  }
  if (phase === 'updating') {
    return <div className="trp-page"><div className="trp-card trp-center">
      <h1>{t('techReport.updating_title', 'Report being updated')}</h1>
      <p>{t('techReport.updating_body', 'The workshop is updating this report. Please check this link again later.')}</p>
      {retry}
      {workshop?.phone && <Contact t={t} phone={workshop.phone} />}
    </div></div>;
  }
  if (phase === 'error') {
    return <div className="trp-page"><div className="trp-card trp-center">
      <h1>{t('techReport.error_title', 'Something went wrong')}</h1>
      <p>{t('techReport.error_body', 'Please check your connection and refresh the page, or contact the workshop directly.')}</p>
      {retry}
    </div></div>;
  }

  const v = report.vehicle || {};
  const vehicleName = [v.make, v.model, v.year].filter(Boolean).join(' ');

  return (
    <div className="trp-page">
      <div className="trp-card">
        <div className="trp-header">
          <img
            className="trp-logo"
            src={workshop.logo_url ? logoSrc(workshop.logo_url) : PIONEER_LOGO}
            alt={workshop.name || 'Pioneer Car Service Center'}
            onError={e => { if (!e.currentTarget.src.endsWith(PIONEER_LOGO)) e.currentTarget.src = PIONEER_LOGO; }}
          />
          <h1>{t('techReport.title', 'Technical inspection report')}</h1>
          <div className="trp-meta">
            {/* WO-… is the work order; "job card" is the workshop's JC-…, not shown to the customer. */}
            <span>{t('techReport.work_order_n', 'Work order {{n}}', { n: report.work_order_number })}</span>
            {report.completed_at && <span>{fmtDate(report.completed_at)}</span>}
          </div>
        </div>

        {/* ── Vehicle ── */}
        <section className="trp-section">
          <h2>{t('techReport.vehicle', 'Vehicle')}</h2>
          <dl className="trp-facts">
            {vehicleName && <div><dt>{t('techReport.make_model', 'Make / model')}</dt><dd>{vehicleName}</dd></div>}
            {v.plate && <div><dt>{t('techReport.plate', 'Plate')}</dt><dd><span className="trp-plate">{v.plate}</span></dd></div>}
            {v.vin_last6 && <div><dt>{t('techReport.vin', 'VIN')}</dt><dd dir="ltr">…{v.vin_last6}</dd></div>}
          </dl>
        </section>

        {/* ── The work found ── */}
        <section className="trp-section">
          <h2>{t('techReport.work_n', 'Work needed ({{n}})', { n: report.lines?.length || 0 })}</h2>
          <p className="trp-muted">{t('techReport.intro', 'Our technicians inspected your vehicle. This is the work it needs, with the parts. The prices come with the estimate.')}</p>
          <TechnicalReportLines lines={report.lines} />
        </section>

        {workshop.phone && <Contact t={t} phone={workshop.phone} />}
      </div>
    </div>
  );
}

function Contact({ t, phone }) {
  return (
    <p className="trp-contact">
      {t('techReport.questions', 'Questions about your vehicle?')}{' '}
      <a href={`tel:${String(phone).replace(/[^\d+]/g, '')}`} dir="ltr">{phone}</a>
    </p>
  );
}
