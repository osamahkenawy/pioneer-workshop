/**
 * TechnicianJob — one job card, full screen (/mechanic/jobs/:jobCardId).
 * Where notifications, Today's bookings and "Scan job card" land.
 *
 * GET /api/job-cards/mine/:id: one of my job cards in any status, with my
 * time log. A QC-passed card is read-only ("QC passed — … The Service
 * Advisor hands the car over."); a closed job shows "Handed over {date}".
 * A card that is not mine (404) says so. On a phone the actions sit in a
 * bar at the bottom of the screen.
 */
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NavArrowLeft, WarningTriangle, Lock } from 'iconoir-react';
import Toast, { useToast } from '../../components/Toast';
import { useMyJobCard, useNow } from '../../components/technician/useMyJobs';
import JobCardTile from '../../components/technician/JobCardTile';
import '../../components/technician/technician.css';

export default function TechnicianJob() {
  const { jobCardId } = useParams();
  const { t } = useTranslation();
  const { toasts, showToast } = useToast();
  const { card, runningElsewhere, loading, error, notMine, fetchedAt, refresh } = useMyJobCard(jobCardId);
  const now = useNow();

  return (
    <div className="tk-page tk-jobpage">
      <Link to="/mechanic" className="tk-back">
        <NavArrowLeft width={18} height={18} aria-hidden="true" className="tk-flip" /> {t('technician.my_jobs', 'My Jobs')}
      </Link>

      {loading && !card ? (
        <div className="tk-empty" aria-busy="true">
          <span className="tk-spin tk-spin--dark" aria-hidden="true" />
          <p>{t('technician.loading_card', 'Loading the job card…')}</p>
        </div>
      ) : notMine ? (
        <div className="tk-empty">
          <Lock width={32} height={32} aria-hidden="true" />
          <h1 className="tk-empty-title">{t('technician.not_your_card', 'This job card is not assigned to you.')}</h1>
          <p className="tk-muted">{t('technician.not_your_card_hint', 'Ask your Team Leader if you should be working on it.')}</p>
          <Link to="/mechanic" className="tk-btn tk-btn--ghost">{t('technician.back_to_jobs', 'Back to My Jobs')}</Link>
        </div>
      ) : !card ? (
        <div className="tk-banner tk-banner--error" role="alert">
          <WarningTriangle width={18} height={18} aria-hidden="true" />
          <span>{error || t('technician.load_error', "Couldn't load your jobs. Tap Retry.")}</span>
          <button type="button" className="tk-btn tk-btn--ghost tk-btn--sm" onClick={refresh}>{t('technician.retry', 'Retry')}</button>
        </div>
      ) : (
        <>
          {error && (
            <div className="tk-banner tk-banner--error" role="alert">
              <WarningTriangle width={18} height={18} aria-hidden="true" />
              <span>{t('technician.load_error', "Couldn't load your jobs. Tap Retry.")}</span>
              <button type="button" className="tk-btn tk-btn--ghost tk-btn--sm" onClick={refresh}>{t('technician.retry', 'Retry')}</button>
            </div>
          )}
          <h1 className="tk-sr-only">{card.plate_number || card.job_card_number}</h1>
          <JobCardTile card={card} mode="page" now={now} fetchedAt={fetchedAt}
            runningElsewhere={runningElsewhere} onChanged={refresh} showToast={showToast} />
        </>
      )}
      <Toast toasts={toasts} />
    </div>
  );
}
