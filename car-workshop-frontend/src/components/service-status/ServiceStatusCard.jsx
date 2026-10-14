/**
 * ServiceStatusCard — where a customer's car is, in their seven stages.
 *
 * Draws the payload of GET /api/public/service-status/:token and of the
 * customer portal's job cards (car-workshop-backend/src/lib/customer-status.js):
 *
 *   Vehicle received → Inspection & estimate → Your approval → Repair in
 *   progress → Quality check & test drive → Ready for collection → Collected
 *
 * with the two special endings "Estimate declined" and "Cancelled".
 *
 *   variant="full"     the public status page and the portal's job card page:
 *                      hero, stage tracker, what to do now, what you told us,
 *                      contact, work photos
 *   variant="compact"  a card in the portal's lists: vehicle, stage, a short
 *                      progress bar
 *
 * `actions` is drawn under the hero (the portal's links); `approveHref`
 * puts a "Review & approve" button on the approval card — the portal passes
 * it for the signed-in owner; the public link never does (anyone holding a
 * job sheet QR could approve).
 *
 * Every word is t('serviceStatus.*', 'English default').
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Check, Clock, Phone, MapPin, WarningTriangle, Page, MediaImage, Wrench, NavArrowRight,
} from 'iconoir-react';
import './ServiceStatusCard.css';

export const STAGES = ['received', 'inspection_estimate', 'approval', 'repair', 'quality_check', 'ready', 'collected'];

const STAGE_LABELS = {
  received: 'Vehicle received',
  inspection_estimate: 'Inspection & estimate',
  approval: 'Your approval',
  repair: 'Repair in progress',
  quality_check: 'Quality check & test drive',
  ready: 'Ready for collection',
  collected: 'Collected',
};

/** Tone of the hero and the stage chip. */
const STAGE_TONE = {
  received: 'slate', inspection_estimate: 'sky', approval: 'amber', repair: 'cyan',
  quality_check: 'violet', ready: 'orange', collected: 'green', declined: 'grey', cancelled: 'grey',
};

const toDate = v => (v ? new Date(typeof v === 'string' ? v.replace(' ', 'T') : v) : null);
const valid = d => d && !Number.isNaN(d.getTime());

/** "Tue 15 Oct, 5:00 pm" in the reader's language. */
export function fmtWhen(value, lang, { time = true } = {}) {
  const d = toDate(value);
  if (!valid(d)) return '';
  try {
    return d.toLocaleString(lang || undefined, time
      ? { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return d.toLocaleString();
  }
}

/** "AED 1,234.50" in the reader's language. */
export function fmtMoney(amount, currency = 'AED', lang) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat(lang || undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** The label of one stage in the tracker. */
export function stageLabel(t, key) {
  return t(`serviceStatus.stage.${key}`, STAGE_LABELS[key] || key);
}

/** The big title: the stage, the special ending, or within repair what is happening. */
export function stageTitle(t, s) {
  if (!s) return '';
  if (s.special === 'declined') return t('serviceStatus.special.declined', 'Estimate declined — please collect your vehicle');
  if (s.special === 'cancelled') return t('serviceStatus.special.cancelled', 'Cancelled — contact us');
  if (s.stage?.key === 'repair' && s.stage.detail === 'scheduled') return t('serviceStatus.title.repair_scheduled', 'Work approved — repair scheduled');
  if (s.stage?.key === 'repair' && s.stage.detail === 'waiting_parts') return t('serviceStatus.title.waiting_parts', 'Waiting for parts');
  return stageLabel(t, s.stage?.key);
}

/** One sentence under the title. */
export function stageSentence(t, s, lang) {
  if (!s) return '';
  if (s.special === 'declined') return t('serviceStatus.sentence.declined', 'You declined the estimate — your car is ready to collect.');
  if (s.special === 'cancelled') return t('serviceStatus.sentence.cancelled', 'This job was cancelled — please contact us.');
  switch (s.stage?.key) {
    case 'received': return t('serviceStatus.sentence.received', 'We have your car and have opened its job card.');
    case 'inspection_estimate': return t('serviceStatus.sentence.inspection_estimate', "We're inspecting your car and preparing your estimate.");
    case 'approval': return t('serviceStatus.sentence.approval', 'Your estimate is waiting for your approval.');
    case 'repair':
      if (s.stage.detail === 'scheduled') return t('serviceStatus.sentence.repair_scheduled', "You approved the work — we're scheduling your repair.");
      if (s.stage.detail === 'waiting_parts') return t('serviceStatus.sentence.repair_waiting_parts', "We're waiting for parts for your car.");
      return t('serviceStatus.sentence.repair', 'Our technicians are working on your car.');
    case 'quality_check': return t('serviceStatus.sentence.quality_check', "The work is done. We're checking the quality and test-driving your car.");
    case 'ready': return t('serviceStatus.sentence.ready', 'Your car is ready. You can collect it.');
    case 'collected':
      return s.collected_at
        ? t('serviceStatus.sentence.collected_on', 'Collected on {{date}}. Thank you!', { date: fmtWhen(s.collected_at, lang, { time: false }) })
        : t('serviceStatus.sentence.collected', 'This job is complete. Thank you!');
    default: return '';
  }
}

export const stageTone = s => STAGE_TONE[s?.special || s?.stage?.key] || 'slate';

const vehicleName = v => [v?.make, v?.model, v?.year].filter(Boolean).join(' ');

/** wa.me wants digits in international form. */
const waDigits = phone => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (/^0\d{8,9}$/.test(d)) d = `971${d.slice(1)}`;
  return d.length >= 8 ? d : '';
};
const telHref = phone => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

export const WhatsAppIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z" />
  </svg>
);

/* ── Pieces ─────────────────────────────────────────────── */

function PlateBadge({ plate }) {
  if (!plate) return null;
  return <span className="ssc-plate" dir="ltr">{plate}</span>;
}

/** The seven steps: down the card, or across it when the card is wide (CSS container query). */
function Tracker({ t, status, lang }) {
  const stages = status.stages || [];
  return (
    <ol className="ssc-tracker" aria-label={t('serviceStatus.progress', 'Progress')}>
      {stages.map((s, i) => {
        const when = s.at ? fmtWhen(s.at, lang) : '';
        const stateText = {
          done: t('serviceStatus.state.done', 'Done'),
          current: t('serviceStatus.state.current', 'Now'),
          upcoming: t('serviceStatus.state.upcoming', 'Next'),
          skipped: t('serviceStatus.state.skipped', 'Not needed'),
        }[s.state] || '';
        return (
          <li key={s.key} className={`ssc-step is-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
            <span className="ssc-step-dot" aria-hidden="true">
              {s.state === 'done' ? <Check width={14} height={14} strokeWidth={2.4} /> : <span>{i + 1}</span>}
            </span>
            <span className="ssc-step-text">
              <span className="ssc-step-label">{stageLabel(t, s.key)}</span>
              <span className="ssc-step-when">
                <span className="ssc-visually-hidden">{stateText}. </span>
                {s.state === 'current' && !when ? t('serviceStatus.state.current', 'Now') : when}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A thin bar for list cards. */
function MiniTracker({ t, status }) {
  const stages = status.stages || [];
  const done = stages.filter(s => s.state === 'done').length;
  return (
    <div className="ssc-mini" role="img"
      aria-label={t('serviceStatus.progress_n', 'Stage {{n}} of {{total}}', { n: Math.min(stages.length, done + (status.special ? 0 : 1)), total: stages.length })}>
      {stages.map(s => <span key={s.key} className={`ssc-mini-seg is-${s.state}`} />)}
    </div>
  );
}

/** What the customer can do now, by stage. */
function ActionCard({ t, status, lang, approveHref }) {
  const s = status;
  const cur = s.workshop?.currency || 'AED';
  const w = s.workshop || {};
  const directions = w.map_url ? (
    <a className="ssc-btn ssc-btn-ghost" href={w.map_url} target="_blank" rel="noopener noreferrer">
      <MapPin width={18} height={18} /> {t('serviceStatus.directions', 'Get directions')}
    </a>
  ) : null;
  const callUs = w.phone ? (
    <a className="ssc-btn ssc-btn-ghost" href={telHref(w.phone)}>
      <Phone width={18} height={18} /> {t('serviceStatus.call_us', 'Call us')}
    </a>
  ) : null;

  if (s.special === 'declined' || s.special === 'cancelled') {
    return (
      <div className="ssc-card ssc-action ssc-action-muted">
        <p className="ssc-action-text">
          <WarningTriangle width={18} height={18} aria-hidden="true" />
          <span>{s.special === 'declined'
            ? t('serviceStatus.sentence.declined', 'You declined the estimate — your car is ready to collect.')
            : t('serviceStatus.sentence.cancelled', 'This job was cancelled — please contact us.')}</span>
        </p>
        <div className="ssc-btn-row">{callUs}{s.special === 'declined' && directions}</div>
      </div>
    );
  }

  switch (s.stage?.key) {
    case 'approval': {
      const e = s.estimate;
      return (
        <div className="ssc-card ssc-action ssc-action-amber">
          <p className="ssc-action-text">
            <Page width={18} height={18} aria-hidden="true" />
            <span>{e
              ? t('serviceStatus.approval_msg', 'Your estimate {{number}} ({{amount}}) was sent to you on {{date}} by WhatsApp or e-mail. Reply or call us to approve.', {
                number: e.number, amount: fmtMoney(e.total, cur, lang), date: fmtWhen(e.sent_at, lang, { time: false }),
              })
              : t('serviceStatus.approval_msg_no_estimate', 'Your estimate was sent to you by WhatsApp or e-mail. Reply or call us to approve.')}</span>
          </p>
          <div className="ssc-btn-row">
            {approveHref && (
              <a className="ssc-btn ssc-btn-primary" href={approveHref}>
                {t('serviceStatus.review_approve', 'Review & approve')} <NavArrowRight width={18} height={18} className="ssc-flip" />
              </a>
            )}
            {callUs}
          </div>
        </div>
      );
    }
    case 'repair':
      if (!s.parts_wait) return null;
      return (
        <div className="ssc-card ssc-action ssc-action-cyan">
          <p className="ssc-action-text">
            <Wrench width={18} height={18} aria-hidden="true" />
            <span>{s.parts_wait.expected_date
              ? t('serviceStatus.parts_wait', 'Waiting for parts — expected {{date}}.', { date: fmtWhen(s.parts_wait.expected_date, lang, { time: false }) })
              : t('serviceStatus.parts_wait_no_date', "Waiting for parts — we'll update you when they arrive.")}</span>
          </p>
        </div>
      );
    case 'ready': {
      const inv = s.invoice;
      return (
        <div className="ssc-card ssc-action ssc-action-orange">
          <p className="ssc-action-text ssc-action-strong">
            <Check width={18} height={18} aria-hidden="true" />
            <span>{t('serviceStatus.ready_title', 'Your car is ready for collection.')}</span>
          </p>
          {inv && (inv.on_account
            ? <p className="ssc-action-sub">{t('serviceStatus.on_account', 'Billed to your account (invoice {{number}}).', { number: inv.number })}</p>
            : inv.balance > 0
              ? <p className="ssc-action-sub">{t('serviceStatus.ready_amount', 'Amount due {{amount}} (invoice {{number}}).', { amount: fmtMoney(inv.balance, cur, lang), number: inv.number })}</p>
              : <p className="ssc-action-sub">{t('serviceStatus.paid', 'Paid — invoice {{number}}.', { number: inv.number })}</p>)}
          {!inv && <p className="ssc-action-sub">{t('serviceStatus.ready_no_invoice', 'Your invoice will be ready when you collect.')}</p>}
          <div className="ssc-btn-row">{directions}{callUs}</div>
        </div>
      );
    }
    case 'collected':
      return (
        <div className="ssc-card ssc-action ssc-action-green">
          <p className="ssc-action-text ssc-action-strong">
            <Check width={18} height={18} aria-hidden="true" />
            <span>{t('serviceStatus.thank_you', 'Thank you for choosing {{name}}.', { name: w.name || t('serviceStatus.us', 'us') })}</span>
          </p>
          {s.invoice && <p className="ssc-action-sub">{t('serviceStatus.invoice_n', 'Invoice {{number}}', { number: s.invoice.number })}</p>}
          {s.survey_url && (
            <div className="ssc-btn-row">
              <a className="ssc-btn ssc-btn-primary" href={s.survey_url}>{t('serviceStatus.survey', 'Tell us how we did')}</a>
            </div>
          )}
        </div>
      );
    default:
      return null;
  }
}

function ContactCard({ t, workshop }) {
  const w = workshop || {};
  if (!w.phone && !w.whatsapp && !w.address) return null;
  const wa = waDigits(w.whatsapp);
  return (
    <div className="ssc-card ssc-block">
      <h3 className="ssc-block-title">{t('serviceStatus.contact', 'Contact us')}</h3>
      {w.address && <p className="ssc-contact-line"><MapPin width={16} height={16} aria-hidden="true" /> <span>{w.address}</span></p>}
      <div className="ssc-btn-row">
        {w.phone && (
          <a className="ssc-btn ssc-btn-ghost" href={telHref(w.phone)}>
            <Phone width={18} height={18} /> <bdi dir="ltr">{w.phone}</bdi>
          </a>
        )}
        {wa && (
          <a className="ssc-btn ssc-btn-whatsapp" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon /> {t('serviceStatus.whatsapp', 'WhatsApp')}
          </a>
        )}
        {w.map_url && (
          <a className="ssc-btn ssc-btn-ghost" href={w.map_url} target="_blank" rel="noopener noreferrer">
            <MapPin width={18} height={18} /> {t('serviceStatus.directions', 'Get directions')}
          </a>
        )}
      </div>
    </div>
  );
}

/* ── The card ───────────────────────────────────────────── */

export default function ServiceStatusCard({ status, variant = 'full', actions = null, approveHref = null, to = null, showContact = true }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  if (!status) return null;
  const s = status;
  const tone = stageTone(s);
  const v = s.vehicle || {};
  const job = s.job || {};
  const jobLine = [
    job.job_card_number && t('serviceStatus.job_card', 'Job card {{n}}', { n: job.job_card_number }),
    job.work_order_number,
  ].filter(Boolean).join(' · ');

  if (variant === 'compact') {
    const body = (
      <>
        <div className="ssc-compact-head">
          <PlateBadge plate={v.plate} />
          <span className="ssc-compact-vehicle">{vehicleName(v) || t('serviceStatus.your_car', 'Your car')}</span>
        </div>
        {jobLine && <p className="ssc-job">{jobLine}</p>}
        <p className={`ssc-chip ssc-tone-${tone}`}>{stageTitle(t, s)}</p>
        <p className="ssc-sentence">{stageSentence(t, s, lang)}</p>
        {!s.special && s.stages?.length > 0 && <MiniTracker t={t} status={s} />}
      </>
    );
    return (
      <article className="ssc ssc-compact">
        {to
          ? <Link to={to} className="ssc-compact-link">{body}<NavArrowRight width={20} height={20} className="ssc-compact-chevron ssc-flip" aria-hidden="true" /></Link>
          : <div className="ssc-compact-body">{body}</div>}
        {actions && <div className="ssc-compact-actions">{actions}</div>}
      </article>
    );
  }

  return (
    <section className="ssc ssc-full">
      <div className={`ssc-card ssc-hero ssc-tone-${tone}`}>
        <div className="ssc-hero-vehicle">
          <PlateBadge plate={v.plate} />
          <span className="ssc-hero-name">{vehicleName(v) || t('serviceStatus.your_car', 'Your car')}</span>
        </div>
        {!s.reduced && jobLine && <p className="ssc-job">{jobLine}</p>}
        <h2 className="ssc-title">{stageTitle(t, s)}</h2>
        <p className="ssc-sentence">{stageSentence(t, s, lang)}</p>
        {s.expected_ready_at && (
          <p className="ssc-expected">
            <Clock width={16} height={16} aria-hidden="true" />
            {t('serviceStatus.expected_ready', 'Expected ready: {{when}}', { when: fmtWhen(s.expected_ready_at, lang) })}
          </p>
        )}
        {actions && <div className="ssc-hero-actions">{actions}</div>}
      </div>

      <div className="ssc-card ssc-block ssc-tracker-wrap">
        <h3 className="ssc-block-title">{t('serviceStatus.progress', 'Progress')}</h3>
        <Tracker t={t} status={s} lang={lang} />
      </div>

      {s.reduced ? (
        <p className="ssc-note">{t('serviceStatus.reduced_note', 'For your privacy this link shows only the stage of the work. Ask the workshop for your full status link.')}</p>
      ) : (
        <>
          <ActionCard t={t} status={s} lang={lang} approveHref={approveHref} />
          {job.reported_issue && (
            <div className="ssc-card ssc-block">
              <h3 className="ssc-block-title">{t('serviceStatus.you_told_us', 'What you told us')}</h3>
              <p className="ssc-text">{job.reported_issue}</p>
            </div>
          )}
        </>
      )}

      {showContact && <ContactCard t={t} workshop={s.workshop} />}

      {!s.reduced && s.photos?.length > 0 && (
        <div className="ssc-card ssc-block">
          <h3 className="ssc-block-title"><MediaImage width={16} height={16} aria-hidden="true" /> {t('serviceStatus.photos', 'Work photos')}</h3>
          <ul className="ssc-photos">
            {s.photos.map((p, i) => (
              <li key={`${p.url}-${i}`}>
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  <img src={p.url} alt={p.caption || t('serviceStatus.photo_n', 'Photo {{n}}', { n: i + 1 })} loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
