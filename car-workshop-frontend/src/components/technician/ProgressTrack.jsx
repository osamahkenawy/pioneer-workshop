/**
 * ProgressTrack — where this job card is, in the technician's words:
 *
 *   Assigned → Working → Job done → Quality check → QC passed
 *
 * A failed quality check shows a red "Rework" marker on Working, which is
 * where the job goes back to. It replaces the courier progress steps.
 */
import { useTranslation } from 'react-i18next';
import { Check } from 'iconoir-react';
import { PASSED } from './format';

const STEPS = [
  ['assigned', 'technician.progress.assigned', 'Assigned'],
  ['working', 'technician.progress.working', 'Working'],
  ['done', 'technician.progress.done', 'Job done'],
  ['qc', 'technician.progress.qc', 'Quality check'],
  ['passed', 'technician.progress.passed', 'QC passed'],
];

/** How many steps are complete, and which one is current (-1 = none). */
function position(card) {
  const s = card?.status;
  if (PASSED.includes(s)) return { done: 5, current: -1 };
  if (s === 'qc_pending') return { done: 3, current: 3 };
  const started = s === 'in_progress' || s === 'qc_failed' || (card?.time_state && card.time_state !== 'idle') || Number(card?.minutes) > 0;
  return started ? { done: 1, current: 1 } : { done: 1, current: -1 };
}

export default function ProgressTrack({ card }) {
  const { t } = useTranslation();
  const { done, current } = position(card);
  const rework = card?.status === 'qc_failed';
  return (
    <ol className="tk-track" aria-label={t('technician.progress_title', 'Progress')}>
      {STEPS.map(([key, i18nKey, def], i) => {
        const state = i < done ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={key} className={`tk-track-step is-${state}${rework && key === 'working' ? ' is-rework' : ''}`}
            aria-current={i === current ? 'step' : undefined}>
            <span className="tk-track-dot" aria-hidden="true">{state === 'done' ? <Check width={12} height={12} /> : null}</span>
            <span className="tk-track-label">{t(i18nKey, def)}</span>
            {rework && key === 'working' && <span className="tk-track-rework">{t('technician.progress.rework', 'Rework')}</span>}
          </li>
        );
      })}
    </ol>
  );
}
