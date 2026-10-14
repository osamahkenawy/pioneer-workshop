/**
 * TodayStrip — four tiles about the technician's day. No money anywhere.
 *
 *   Time booked today · Jobs done today · Waiting for QC (tap → that list)
 *   · Rework (red above 0; tap → To do, rework first)
 */
import { useTranslation } from 'react-i18next';
import { Timer, CheckCircle, Hourglass, Repeat } from 'iconoir-react';
import { fmtMinutes } from './format';

export default function TodayStrip({ summary, runningExtraMin = 0, onWaitingQc, onRework }) {
  const { t } = useTranslation();
  const s = summary || {};
  const rework = Number(s.rework) || 0;
  const tiles = [
    { key: 'time', icon: Timer, value: fmtMinutes((Number(s.time_booked_today_min) || 0) + runningExtraMin), label: t('technician.today_time', 'Time booked today') },
    { key: 'done', icon: CheckCircle, value: Number(s.jobs_done_today) || 0, label: t('technician.today_done', 'Jobs done today') },
    { key: 'qc', icon: Hourglass, value: Number(s.waiting_qc) || 0, label: t('technician.today_qc', 'Waiting for QC'), onClick: onWaitingQc },
    { key: 'rework', icon: Repeat, value: rework, label: t('technician.today_rework', 'Rework'), onClick: onRework, alert: rework > 0 },
  ];
  return (
    <section className="tk-strip" aria-label={t('technician.today_title', 'Today')}>
      {tiles.map(({ key, icon: Icon, value, label, onClick, alert }) => {
        const inner = (
          <>
            <Icon width={18} height={18} aria-hidden="true" className="tk-tile-icon" />
            <span className="tk-tile-value">{value}</span>
            <span className="tk-tile-label">{label}</span>
          </>
        );
        const cls = `tk-tile tk-tile--${key}${alert ? ' is-alert' : ''}`;
        return onClick
          ? <button key={key} type="button" className={`${cls} is-link`} onClick={onClick}>{inner}</button>
          : <div key={key} className={cls}>{inner}</div>;
      })}
    </section>
  );
}
