/**
 * TechnicianHistory — "Finished jobs" (/mechanic/history): the job cards
 * this technician marked done in the last 7, 30 or 90 days, with the hours
 * booked this week and how many passed the quality check first time.
 * No money.
 *
 * GET /api/job-cards/mine/history?days=7|30|90
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NavArrowLeft, WarningTriangle, CheckCircle, Timer, ShieldCheck } from 'iconoir-react';
import api from '../../lib/api';
import { TONES } from '../../lib/statusLabels';
import { cardKindLabel, fmtMinutes, weekdayOf, dayOf } from '../../components/technician/format';
import '../../components/technician/technician.css';

const RANGES = [7, 30, 90];

const QC_CHIPS = {
  passed_first_time: ['technician.qc_first_time', 'Passed first time', TONES.green],
  passed_after_rework: ['technician.qc_after_rework', 'Passed after rework', TONES.sky],
  waiting: ['technician.qc_waiting', 'Waiting for QC', TONES.amber],
  rework: ['technician.qc_rework', 'Rework needed', TONES.red],
};

export default function TechnicianHistory() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (range) => {
    setLoading(true);
    try {
      const res = await api.get(`/job-cards/mine/history?days=${range}`);
      if (res.success) { setData(res); setError(''); }
      else setError(res.message || t('technician.history_error', "Couldn't load your finished jobs. Tap Retry."));
    } catch {
      setError(t('technician.history_error', "Couldn't load your finished jobs. Tap Retry."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(days); }, [days, load]);

  const groups = useMemo(() => {
    const out = [];
    for (const item of data?.items || []) {
      const day = String(item.completed_at || '').slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [data]);

  const totals = data?.totals || {};
  const pct = totals.first_time_pass_pct;

  return (
    <div className="tk-page tk-history">
      <Link to="/mechanic" className="tk-back">
        <NavArrowLeft width={18} height={18} aria-hidden="true" className="tk-flip" /> {t('technician.my_jobs', 'My Jobs')}
      </Link>
      <h1 className="tk-page-title">{t('technician.finished_jobs', 'Finished jobs')}</h1>

      <div className="tk-chips" role="group" aria-label={t('technician.history_range', 'Show the last')}>
        {RANGES.map(n => (
          <button key={n} type="button" className={`tk-chip-btn${days === n ? ' is-on' : ''}`} aria-pressed={days === n} onClick={() => setDays(n)}>
            {t('technician.history_days', { n, defaultValue: '{{n}} days' })}
          </button>
        ))}
      </div>

      <section className="tk-strip tk-strip--two" aria-label={t('technician.history_summary', 'Summary')}>
        <div className="tk-tile">
          <Timer width={18} height={18} aria-hidden="true" className="tk-tile-icon" />
          <span className="tk-tile-value">{fmtMinutes(totals.minutes_this_week || 0)}</span>
          <span className="tk-tile-label">{t('technician.history_week_hours', 'Hours booked this week')}</span>
        </div>
        <div className="tk-tile">
          <ShieldCheck width={18} height={18} aria-hidden="true" className="tk-tile-icon" />
          <span className="tk-tile-value">{pct == null ? '—' : `${pct}%`}</span>
          <span className="tk-tile-label">{t('technician.history_ftp', 'Passed QC first time')}</span>
        </div>
      </section>

      {error && (
        <div className="tk-banner tk-banner--error" role="alert">
          <WarningTriangle width={18} height={18} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className="tk-btn tk-btn--ghost tk-btn--sm" onClick={() => load(days)}>{t('technician.retry', 'Retry')}</button>
        </div>
      )}

      {loading && !data ? (
        <div className="tk-empty" aria-busy="true"><span className="tk-spin tk-spin--dark" aria-hidden="true" /></div>
      ) : !groups.length ? (
        !error && (
          <div className="tk-empty">
            <CheckCircle width={32} height={32} aria-hidden="true" />
            <p className="tk-empty-title">{t('technician.history_empty', { n: days, defaultValue: 'No finished jobs in the last {{n}} days.' })}</p>
          </div>
        )
      ) : (
        <div className={`tk-history-groups${loading ? ' is-loading' : ''}`}>
          {groups.map(g => (
            <section key={g.day} className="tk-panel" aria-labelledby={`tk-day-${g.day}`}>
              <h2 id={`tk-day-${g.day}`} className="tk-panel-title">{weekdayOf(g.day, lang)}</h2>
              <ul className="tk-result-list">
                {g.items.map(i => {
                  const [key, def, tone] = QC_CHIPS[i.qc_result] || QC_CHIPS.waiting;
                  return (
                    <li key={i.job_card_id}>
                      <Link to={`/mechanic/jobs/${i.job_card_id}`} className="tk-history-row">
                        <span className="tk-history-car">
                          <b>{i.plate || i.work_order_number}</b>
                          {[i.make, i.model].filter(Boolean).length > 0 && <span> {[i.make, i.model].filter(Boolean).join(' ')}</span>}
                        </span>
                        <span className="tk-history-ref">{i.work_order_number} · {i.job_card_number} · {cardKindLabel(t, i)}</span>
                        <span className="tk-history-meta">
                          <span className="tk-history-time"><Timer width={14} height={14} aria-hidden="true" /> {fmtMinutes(i.booked_minutes)}</span>
                          <span className="tk-chip" style={{ background: tone.bg, color: tone.color }}>{t(key, def)}</span>
                          {i.handed_over && (
                            <span className="tk-handed">✓ {t('technician.handed_over', { date: dayOf(i.handed_over_at, lang), defaultValue: 'Handed over {{date}}' })}</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
