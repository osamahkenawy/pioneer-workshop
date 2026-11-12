/**
 * TechnicalReportLines — the customer's view of the technical report's
 * service lines: each job / service with its service type, the labour, and
 * the parts by name (client meeting, 3 Nov 2026). No hours, quantities, part
 * numbers or prices — the server does not send them (routes/
 * public-technical-reports.js customerReportView).
 *
 * Drawn on the public link (pages/TechnicalReportLink.jsx) and on the job's
 * page in the customer portal (CustomerWorkOrderDetail.jsx), so both show the
 * same thing. Its own small CSS (trl-*), phone first, logical properties.
 *
 * Words: t('techReport.*', 'English default').
 */
import { useTranslation } from 'react-i18next';
import { jobTypeLabel } from '../lib/intakeOptions';
import './TechnicalReportLines.css';

export default function TechnicalReportLines({ lines }) {
  const { t } = useTranslation();
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return <p className="trl-muted">{t('techReport.no_lines', 'No work is listed on this report.')}</p>;
  return (
    <ol className="trl-lines">
      {list.map((l, i) => (
        <li key={i} className="trl-line">
          <div className="trl-head">
            <span className="trl-no" aria-hidden="true">{i + 1}</span>
            <span className="trl-job">{l.job}</span>
            {l.service_type && <span className="trl-type">{jobTypeLabel(l.service_type) || l.service_type_label}</span>}
          </div>
          {l.labour && (
            <p className="trl-labour"><span className="trl-label">{t('techReport.labour', 'Work to do')}</span>{l.labour}</p>
          )}
          {l.parts?.length > 0 && (
            <div className="trl-parts">
              <span className="trl-label">{t('techReport.parts', 'Parts')}</span>
              <ul>
                {l.parts.map((p, j) => <li key={j}>{p.name}</li>)}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
