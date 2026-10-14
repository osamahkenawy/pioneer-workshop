/**
 * PhaseStepper — Steps 1–7 of one job as seven dots (done, current, upcoming,
 * stopped), the current step's name, and "Next: {who} — {what}". It reads the
 * workflow the job card screen uses (GET /api/workflow/work-orders/:id:
 * `steps`, `current_step`, `next`) and the same translations (workflow.steps.*,
 * workflow.who.*, workflow.next.*), so the two always say the same thing.
 */
import { useTranslation } from 'react-i18next';
import { Check, Xmark } from 'iconoir-react';

const STATE_EN = { done: 'done', current: 'current', upcoming: 'not started', stopped: 'stopped' };

export default function PhaseStepper({ steps = [], currentStep, next }) {
  const { t } = useTranslation();
  if (!steps.length) return null;
  const current = steps.find(s => s.n === currentStep) || steps.find(s => s.state === 'current');
  const stepTitle = s => t(`workflow.steps.${s.key}`, s.title);

  return (
    <div className="vsb-stepper">
      <ol className="vsb-stepper-dots">
        {steps.map(s => (
          <li key={s.n} className={`vsb-stepper-dot is-${s.state}`}
            aria-label={t('vehicleBoard.drawer.step_aria', 'Step {{n}}: {{title}} — {{state}}',
              { n: s.n, title: stepTitle(s), state: t(`vehicleBoard.drawer.state_${s.state}`, STATE_EN[s.state] || s.state) })}
            title={`${s.n}. ${stepTitle(s)}`}>
            <span className="vsb-stepper-circle" aria-hidden="true">
              {s.state === 'done' ? <Check width={14} height={14} strokeWidth={2.4} />
                : s.state === 'stopped' ? <Xmark width={14} height={14} strokeWidth={2.4} /> : s.n}
            </span>
          </li>
        ))}
      </ol>
      {current && (
        <div className="vsb-stepper-current">
          {t('vehicleBoard.drawer.step_of', 'Step {{n}} of 7', { n: current.n })} · <strong>{stepTitle(current)}</strong>
        </div>
      )}
      {next && (next.who || next.text) && (
        <div className="vsb-stepper-next">
          <span className="vsb-stepper-next-label">{t('vehicleBoard.next', 'Next')}:</span>{' '}
          {next.who_key && <strong>{t(`workflow.who.${next.who_key}`, next.who)} — </strong>}
          {t(`workflow.next.${next.key}`, { defaultValue: next.text, ...(next.params || {}) })}
        </div>
      )}
    </div>
  );
}
