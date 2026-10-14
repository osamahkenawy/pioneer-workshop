/**
 * TodaySchedule — "Today's bookings": the windows the Team Leader booked for
 * this technician today (GET /job-cards/mine `bookings_today`). Shown only
 * when there is at least one.
 *
 *   09:00–11:30 · A 12345 Toyota Camry · Main job card · [Now|Next|Late|Done]
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarCheck } from 'iconoir-react';
import { deptLabel, rangeOf } from './format';

const STATES = {
  now: ['technician.booking_now', 'Now'],
  next: ['technician.booking_next', 'Next'],
  late: ['technician.booking_late', 'Late'],
  done: ['technician.booking_done', 'Done'],
  later: ['technician.booking_later', 'Later'],
};

export default function TodaySchedule({ bookings }) {
  const { t } = useTranslation();
  if (!bookings?.length) return null;
  return (
    <section className="tk-panel" aria-labelledby="tk-bookings-title">
      <h2 id="tk-bookings-title" className="tk-panel-title">
        <CalendarCheck width={16} height={16} aria-hidden="true" /> {t('technician.bookings_title', "Today's bookings")}
      </h2>
      <ul className="tk-bookings">
        {bookings.map(b => {
          const [key, def] = STATES[b.state] || STATES.later;
          const dept = deptLabel(t, b.department);
          return (
            <li key={`${b.work_order_id}-${b.job_card_id}`}>
              <Link to={`/mechanic/jobs/${b.job_card_id}`} className="tk-booking">
                <span className="tk-booking-time">{rangeOf(b.scheduled_start_at, b.scheduled_end_at)}</span>
                <span className="tk-booking-car">
                  <b>{b.plate || b.work_order_number}</b>
                  {[b.make, b.model].filter(Boolean).length > 0 && <span> {[b.make, b.model].filter(Boolean).join(' ')}</span>}
                </span>
                <span className="tk-booking-kind">
                  {b.is_main ? t('technician.main_card', 'Main job card') : t('technician.sub_short', { dept, defaultValue: 'Sub · {{dept}}' })}
                </span>
                <span className={`tk-pill tk-pill--${b.state || 'later'}`}>{t(key, def)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
