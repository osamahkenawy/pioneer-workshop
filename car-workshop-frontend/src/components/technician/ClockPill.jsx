/**
 * ClockPill — where the technician's clock is, at the top of My Jobs.
 *
 *   green, pulsing  "On the clock · WO-… · since 09:42 · 1h 05m"
 *   amber           "Paused · Waiting for parts · since 11:10"
 *   grey            "Not clocked in"
 *
 * Tapping a green or amber pill opens that job card (onOpen(jobCardId)).
 * From GET /job-cards/mine `summary.running` / `summary.paused`.
 */
import { useTranslation } from 'react-i18next';
import { Clock, PauseSolid } from 'iconoir-react';
import { timeStateLabel } from '../../lib/statusLabels';
import { clockOf, fmtMinutes, minutesSince } from './format';

export default function ClockPill({ summary, serverTime, fetchedAt, now, onOpen }) {
  const { t } = useTranslation();
  const running = summary?.running;
  const paused = summary?.paused;

  if (running) {
    const mins = minutesSince(running.since, serverTime, fetchedAt, now);
    return (
      <button type="button" className="tk-clock tk-clock--on" onClick={() => onOpen?.(running.job_card_id)}>
        <span className="tk-pulse" aria-hidden="true" />
        <span className="tk-clock-text">
          {t('technician.clock_on', { wo: running.work_order_number, time: clockOf(running.since), defaultValue: 'On the clock · {{wo}} · since {{time}}' })}
        </span>
        <span className="tk-clock-dur">{fmtMinutes(mins)}</span>
      </button>
    );
  }
  if (paused) {
    return (
      <button type="button" className="tk-clock tk-clock--paused" onClick={() => onOpen?.(paused.job_card_id)}>
        <PauseSolid width={14} height={14} aria-hidden="true" />
        <span className="tk-clock-text">
          {t('technician.clock_paused', { state: timeStateLabel(t, 'paused', paused.reason), time: clockOf(paused.since), defaultValue: '{{state}} · since {{time}}' })}
          {paused.work_order_number ? ` · ${paused.work_order_number}` : ''}
        </span>
      </button>
    );
  }
  return (
    <div className="tk-clock tk-clock--off">
      <Clock width={14} height={14} aria-hidden="true" />
      <span className="tk-clock-text">{t('technician.clock_off', 'Not clocked in')}</span>
    </div>
  );
}
