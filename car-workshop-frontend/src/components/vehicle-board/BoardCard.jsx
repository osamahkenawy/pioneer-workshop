/**
 * BoardCard — one car on the Vehicle Status Board.
 *
 *   plate                                  age in this step (amber / red when late)
 *   make model year · colour
 *   WO-… · JC-… (+2)
 *   customer                               External · Walk-in
 *   [badge] [badge] +n
 *   (AB) technician                        ● clock running / paused
 *
 * Clicking it opens the side panel, except on the TV (`interactive` false).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { timeStateLabel } from '../../lib/statusLabels';
import {
  ageTone, badgeText, classChip, fmtAge, initials, jobLine, plainName, toneOf, vehicleLine,
} from './board';

const MAX_BADGES = 2;

function BoardCard({ item, lateMinutes, onOpen, interactive = true, selected = false }) {
  const { t } = useTranslation();
  const tone = ageTone(item, lateMinutes);
  const chip = classChip(t, item);
  const shown = item.badges.slice(0, MAX_BADGES);
  const more = item.badges.length - shown.length;
  const tech = item.technician?.name ? plainName(item.technician.name) : null;
  const clock = item.clock?.state;
  const open = () => interactive && onOpen?.(item);

  return (
    <article
      className={`vsb-card${interactive ? ' is-interactive' : ''}${selected ? ' is-selected' : ''}${item.late ? ' is-late' : ''}`}
      {...(interactive ? {
        role: 'button', tabIndex: 0, onClick: open,
        onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
        'aria-label': t('vehicleBoard.card_aria', '{{plate}}, {{job}}: open details', { plate: item.plate || item.work_order_number, job: item.work_order_number }),
      } : {})}
    >
      <div className="vsb-card-top">
        <span className="vsb-plate" dir="ltr">{item.plate || '—'}</span>
        <span className={`vsb-age is-${tone}`} title={t('vehicleBoard.age', 'Time in this step')}>
          {fmtAge(item.age_minutes)}
        </span>
      </div>
      {vehicleLine(item) && <div className="vsb-card-vehicle">{vehicleLine(item)}</div>}
      <div className="vsb-card-job" dir="ltr">{jobLine(item)}</div>
      <div className="vsb-card-customer">
        <span className="vsb-card-name">{item.customer_name || '—'}</span>
        {chip && <span className="vsb-class-chip">{chip}</span>}
      </div>
      {shown.length > 0 && (
        <div className="vsb-badges">
          {shown.map(b => {
            const c = toneOf(b.tone);
            return <span key={b.key} className="vsb-badge" style={{ background: c.bg, color: c.color }}>{badgeText(t, b)}</span>;
          })}
          {more > 0 && <span className="vsb-badge is-more">+{more}</span>}
        </div>
      )}
      <div className="vsb-card-foot">
        {tech ? (
          <span className="vsb-tech">
            <span className="vsb-avatar" aria-hidden="true">{initials(item.technician.name)}</span>
            <span className="vsb-tech-name">{tech}</span>
          </span>
        ) : (
          <span className="vsb-tech is-none">{t('vehicleBoard.no_tech', 'No technician')}</span>
        )}
        {clock && (
          <span className={`vsb-clock is-${clock}`}>
            <span className="vsb-dot" aria-hidden="true" />
            {timeStateLabel(t, clock)}
          </span>
        )}
      </div>
    </article>
  );
}

export default memo(BoardCard);
