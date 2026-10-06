import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, User, SendMail, ClipboardCheck,
  WarningTriangle, Refresh, Phone, ChatBubble, Quote, Calendar, ArrowRight, Download,
} from 'iconoir-react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { toCsv, downloadCsvText } from '../utils/csv';
import { downloadXlsx, th, title, note, num, signed } from '../utils/xlsx';
import { responsesSheet } from '../utils/survey-export';
import './Reports.css';
import './CustomerExperience.css';

/**
 * Customer Experience dashboard — KPI matrix category "Customer Experience"
 * (rows 36-37: NPS, survey response rate), widened to include the adjacent
 * rows that are genuinely about the customer's experience even though the
 * matrix filed them under "Customer & CRM": booking conversion and show-up
 * rate (row 1-3 — did their booking go smoothly), and repeat rate (row 4-5 —
 * did they come back). Contact channel volume (row 9) sits here too, since
 * it is which door the customer walked through, not an operational metric.
 *
 * Everything on this page reads from endpoints that already exist — nothing
 * new was added on the backend to build it. The one new piece of behaviour is
 * "Needs attention": survey_responses already tracks is_flagged/followed_up_at,
 * and PATCH /customer-survey/:id/follow-up already exists (Customer Feedback
 * uses it), but nothing surfaced that queue anywhere a person would act on it
 * in one sitting — this dashboard is where that happens.
 *
 * NPS gets a hero gauge instead of a plain stat card: it's the one number
 * this page exists to answer, and a bounded score reads better against a
 * "where does this sit" arc than as an isolated digit. The promoter/passive/
 * detractor split (npsBreakdown, already returned by /customer-survey/stats
 * but never rendered before) sits under it as the same story in more detail.
 *
 * Complaints (KPI rows 7/8/10/11) now read real data from /api/disputes/
 * stats — volume, ack SLA, resolution time — with a link through to the
 * full Complaints page. The one thing still missing is a categorised
 * breakdown, blocked on a category taxonomy from GM Pioneer; the note under
 * the card says so rather than the card pretending nothing is missing.
 */

/** -100..100 → a verdict band, each with its own colour, so the score reads
 *  with context rather than in isolation. Bands follow the informal NPS
 *  convention (below 0 poor, 0-30 good, 30-70 great, 70+ excellent) — not a
 *  regulatory scale, just a common enough read for a quick glance. */
function npsBand(v) {
  if (v == null) return { label: '', color: '#94a3b8', bg: '#f1f5f9' };
  if (v < 0) return { label: 'cx.band_needs_work', color: '#dc2626', bg: '#fdeeea' };
  if (v < 30) return { label: 'cx.band_good', color: '#d97706', bg: '#fdf2e0' };
  if (v < 70) return { label: 'cx.band_great', color: '#16a34a', bg: '#e7f3ec' };
  return { label: 'cx.band_excellent', color: '#0d9488', bg: '#e0f5f3' };
}

function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polar(cx, cy, r, endDeg);
  const e = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? '0' : '1';
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

/** A half-dome gauge for a -100..100 score: a thin zoned reference band
 *  (the same red/amber/green/teal bands npsBand uses) under a bold value
 *  arc that stops exactly at the score, with the number in the middle of
 *  the dome rather than bolted on beside it. */
function NpsGauge({ value }) {
  const size = 220, cx = size / 2, cy = size / 2 + 6, r = 86;
  const zones = [
    { from: -100, to: 0, color: '#dc2626' },
    { from: 0, to: 30, color: '#d97706' },
    { from: 30, to: 70, color: '#16a34a' },
    { from: 70, to: 100, color: '#0d9488' },
  ];
  const toAngle = v => -90 + ((v + 100) / 200) * 180;
  const band = npsBand(value);
  const valueAngle = value != null ? toAngle(Math.max(-100, Math.min(100, value))) : -90;

  return (
    <svg width={size} height={size / 2 + 34} viewBox={`0 0 ${size} ${size / 2 + 34}`} className="cx-gauge-svg">
      {zones.map(z => (
        <path key={z.from} d={arcPath(cx, cy, r, toAngle(z.from), toAngle(z.to))}
          stroke={z.color} strokeWidth={6} strokeLinecap="butt" fill="none" opacity={0.28} />
      ))}
      {value != null && (
        <path d={arcPath(cx, cy, r, -90, valueAngle)}
          stroke={band.color} strokeWidth={11} strokeLinecap="round" fill="none" className="cx-gauge-value-arc" />
      )}
      {value != null && (() => {
        const tip = polar(cx, cy, r, valueAngle);
        return <circle cx={tip.x} cy={tip.y} r={7} fill="#fff" stroke={band.color} strokeWidth={4} />;
      })()}
      <text x={cx} y={cy - 16} textAnchor="middle" className="cx-gauge-number">
        {value != null ? (value > 0 ? `+${value}` : value) : '—'}
      </text>
      <text x={cx} y={cy + 6} textAnchor="middle" className="cx-gauge-caption">NPS</text>
      <text x={20} y={cy + 22} textAnchor="start" className="cx-gauge-endlabel">-100</text>
      <text x={size - 20} y={cy + 22} textAnchor="end" className="cx-gauge-endlabel">+100</text>
    </svg>
  );
}

const fmtDaysAgo = (iso, t) => {
  if (!iso) return '';
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (days === 0) return t('cx.today');
  if (days === 1) return t('cx.yesterday');
  return t('cx.days_ago', { n: days });
};

// Sections in the pack are separated by a blank CRLF line: toCsv emits no
// trailing newline, so one separator between a section and the empty string
// pushed after it yields exactly one blank row in Excel.
const SECTION_GAP = '\r\n';

/*
 * The workshop lists its branches in this order — Abu Dhabi, Sharjah, Dubai,
 * Al Ain — and it is not volume order, so the API's "ORDER BY responses DESC"
 * cannot produce it and the dropdown and by-branch table sort by this instead.
 *
 * A branch not on the list still appears, after the known ones and
 * alphabetically among themselves. That covers a new site opening, a value
 * renamed in the data but not here, and the legacy "area — emirate" labels
 * that scripts/rename-branches.js has not been run against yet. Dropping
 * unknown branches would silently hide real responses.
 */
const BRANCH_ORDER = ['Abu Dhabi', 'Sharjah', 'Dubai', 'Al Ain'];

const byBranchOrder = (a, b) => {
  const ia = BRANCH_ORDER.indexOf(a);
  const ib = BRANCH_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return String(a).localeCompare(String(b));
};

const NPS_SEGMENTS = [
  { key: 'promoter',  labelKey: 'cx.promoters',  color: '#16a34a', pctKey: 'promoterPct',  countKey: 'promoters' },
  { key: 'passive',   labelKey: 'cx.passives',   color: '#d97706', pctKey: 'passivePct',   countKey: 'passives' },
  { key: 'detractor', labelKey: 'cx.detractors', color: '#dc2626', pctKey: 'detractorPct', countKey: 'detractors' },
];

const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2)
  .map(w => w[0]).join('').toUpperCase() || '?';

export default function CustomerExperience() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [range, setRange] = useState(() => {
    // Local calendar date, not toISOString()'s UTC one — in UAE (UTC+4)
    // that string still reads "yesterday" until 4am local, so "today"
    // silently dropped out of the default range for a third of every day.
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86400000);
    return { from: iso(from), to: iso(to) };
  });

  const [survey, setSurvey] = useState(null);
  const [booking, setBooking] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [contacts, setContacts] = useState(null);
  const [complaints, setComplaints] = useState(null);
  const [attention, setAttention] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(null);
  const [resolving, setResolving] = useState(() => new Set());
  const [branch, setBranch] = useState('');
  // byBranch only lists branches present in the CURRENT result, so once a
  // branch is selected it collapses to that one. Captured on the unfiltered
  // load so the dropdown keeps every option.
  const [branchOptions, setBranchOptions] = useState([]);
  // The whole by-branch table as of the unfiltered load, so the exported
  // pack can report every branch even while the page is filtered to one.
  const [allByBranch, setAllByBranch] = useState([]);
  const [banner, setBanner] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Hand the current period/branch to the feedback list so the drill-down
  // shows the same slice the dashboard was showing.
  const openSegment = key => {
    const p = new URLSearchParams({ category: key, from: range.from, to: range.to });
    if (branch) p.set('branch', branch);
    navigate(`/customer-feedback?${p}`);
  };

  /*
   * Monthly pack export (SOP step 8). Five sections matching what the SOP
   * says the pack contains: headline measures, response volume, the NPS
   * breakdown, question-level scores, and results by branch.
   *
   * Two formats, because they are read by different people for different
   * reasons. Excel is the default: the pack is a monthly management document
   * that gets filed, re-opened and charted, and a workbook gives each section
   * its own tab with real numbers and dates instead of five titled blocks in
   * one CSV sheet. CSV stays for feeding another system.
   *
   * byBranch comes from the unfiltered load, so the by-branch section is
   * whole even when the page is filtered to one branch — a pack that silently
   * dropped the other branches would be worse than no pack.
   */
  const packBaseName = () =>
    `pioneer-cx-pack_${range.from}_to_${range.to}`
    + (branch ? `_${branch.replace(/[^\w-]+/g, '-')}` : '');

  /*
   * The whole branch set from the unfiltered load where we have it, so a
   * branch-filtered page still exports every branch, sorted into the
   * workshop's order. The fallback matters on the very first render, before
   * an unfiltered load has happened, and it needs sorting too — which is why
   * both exports go through here rather than each sorting its own copy.
   */
  const orderedBranchRows = () =>
    [...(allByBranch.length ? allByBranch : (survey?.byBranch || []))]
      .sort((x, y) => byBranchOrder(x.branch, y.branch));

  const exportPackXlsx = async () => {
    if (!survey) return;
    const hh = survey.headline || {};
    const nb = survey.npsBreakdown || {};
    const branchRows = orderedBranchRows();
    const pct = v => (v === null || v === undefined ? null : Number(v));

    setExporting(true);
    try {
      // The aggregates come from the stats already on screen; the individual
      // responses do not, so fetch them. The pack is not much use for acting
      // on without the people in it — an NPS of +41 does not tell anyone who
      // to call. Same range and branch as the page, so the tabs agree.
      const bq = branch ? `&branch=${encodeURIComponent(branch)}` : '';
      const people = await api
        .get(`/customer-survey/export?from=${range.from}&to=${range.to}${bq}`)
        .catch(e => {
          // A pack without the Responses tab still beats no pack, so this
          // degrades rather than failing the whole export.
          console.error('[CX] response-level export unavailable:', e);
          return null;
        });
      const rows = people?.success ? (people.data || []) : [];
      const labels = people?.questions || {};

      await downloadXlsx(`${packBaseName()}.xlsx`, [
        {
          name: 'Headline',
          columns: [{ width: 34 }, { width: 16 }],
          rows: [
            [title('Pioneer Car Service Center — Customer Experience pack')],
            [note(`${range.from} to ${range.to} · ${branch || t('cx.all_branches')}`)],
            [note(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`)],
            null,
            [th('Measure'), th('Value')],
            ['Net Promoter Score', signed(pct(hh.nps))],
            ['Customer satisfaction (of 5)', num(pct(hh.csatAvg), 2)],
            ['Customer Effort Score (of 5)', num(pct(hh.cesAvg), 2)],
            ['Resolution rate (%)', num(pct(survey.resolution?.resolvedPercent), 1)],
            ['Needs follow-up', num(hh.needsFollowUp ?? 0)],
            null,
            [th('Response volume'), th('Value')],
            ['Responses received', num(hh.responses ?? 0)],
            ['Surveys issued', num(hh.invitesSent ?? 0)],
            ['Response rate (%)', num(pct(hh.responseRate), 1)],
            ['Responses scoring NPS', num(hh.npsScored ?? 0)],
          ],
        },
        {
          name: 'NPS breakdown',
          stickyRows: 1,
          columns: [{ width: 16 }, { width: 12 }, { width: 12 }],
          rows: [
            [th('Segment'), th('Responses'), th('Share (%)')],
            ['Promoters', num(nb.promoters ?? 0), num(pct(nb.promoterPct), 1)],
            ['Passives', num(nb.passives ?? 0), num(pct(nb.passivePct), 1)],
            ['Detractors', num(nb.detractors ?? 0), num(pct(nb.detractorPct), 1)],
          ],
        },
        {
          name: 'Question scores',
          stickyRows: 1,
          columns: [{ width: 62 }, { width: 18 }, { width: 16 }],
          rows: [
            [th('Question'), th('Section'), th('Average (of 5)')],
            ...(survey.questions || []).map(q => [q.label, q.section, num(pct(q.avg), 2)]),
          ],
        },
        {
          name: 'By branch',
          stickyRows: 1,
          columns: [{ width: 30 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }],
          rows: [
            [th('Branch'), th('Responses'), th('NPS'), th('CSAT'), th('CES')],
            ...branchRows.map(b => [
              b.branch || 'Unspecified',
              num(b.responses ?? 0),
              signed(pct(b.nps)),
              num(pct(b.csat_avg), 2),
              num(pct(b.ces_avg), 2),
            ]),
          ],
        },
        // One row per respondent with every answer they gave, shared with
        // the Customer Feedback export so the two cannot disagree.
        responsesSheet(rows, labels),
      ]);
    } catch (e) {
      // The workbook writer is loaded on demand, so this also covers the
      // chunk failing to load on a flaky connection — silently doing nothing
      // would look like a dead button.
      console.error('[CX] Excel export failed:', e);
      setBanner({ kind: 'error', text: e?.message || t('cx.export_failed') });
    } finally {
      setExporting(false);
    }
  };

  const exportPackCsv = () => {
    if (!survey) return;
    const hh = survey.headline || {};
    const nb = survey.npsBreakdown || {};
    const blank = '';
    const parts = [];

    parts.push(toCsv(['Pioneer Car Service Center — Customer Experience pack'], []));
    parts.push(toCsv(['Period', `${range.from} to ${range.to}`], []));
    parts.push(toCsv(['Branch', branch || 'All branches'], []));
    parts.push(toCsv(['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')], []));
    parts.push(blank);

    parts.push(toCsv(['Headline measures'], [
      ['Net Promoter Score', hh.nps ?? ''],
      ['Customer satisfaction (of 5)', hh.csatAvg ?? ''],
      ['Customer Effort Score (of 5)', hh.cesAvg ?? ''],
      ['Resolution rate (%)', survey.resolution?.resolvedPercent ?? ''],
      ['Needs follow-up', hh.needsFollowUp ?? 0],
    ]));
    parts.push(blank);

    parts.push(toCsv(['Response volume'], [
      ['Responses received', hh.responses ?? 0],
      ['Surveys issued', hh.invitesSent ?? 0],
      ['Response rate (%)', hh.responseRate ?? ''],
      ['Responses scoring NPS', hh.npsScored ?? 0],
    ]));
    parts.push(blank);

    parts.push(toCsv(['NPS breakdown', 'Responses', 'Share (%)'], [
      ['Promoters', nb.promoters ?? 0, nb.promoterPct ?? 0],
      ['Passives', nb.passives ?? 0, nb.passivePct ?? 0],
      ['Detractors', nb.detractors ?? 0, nb.detractorPct ?? 0],
    ]));
    parts.push(blank);

    parts.push(toCsv(['Question', 'Section', 'Average (of 5)'],
      (survey.questions || []).map(q => [q.label, q.section, q.avg ?? ''])));
    parts.push(blank);

    const branchRows = orderedBranchRows();
    parts.push(toCsv(['Branch', 'Responses', 'NPS', 'CSAT', 'CES'],
      branchRows.map(b => [b.branch || 'Unspecified', b.responses ?? '', b.nps ?? '', b.csat_avg ?? '', b.ces_avg ?? ''])));

    downloadCsvText(`${packBaseName()}.csv`, parts.join(SECTION_GAP));
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = `from=${range.from}&to=${range.to}`;
      // Branch narrows the survey-derived panels only. survey_responses is
      // the one table here carrying a branch; appointments, customers,
      // activities and disputes have no branch column at all, so those
      // panels stay workshop-wide and the UI says so when a branch is set.
      const bq = branch ? `&branch=${encodeURIComponent(branch)}` : '';
      const [s, b, c, ct, a, cp] = await Promise.all([
        api.get(`/customer-survey/stats?${qs}${bq}`),
        api.get(`/appointments/stats?${qs}`),
        api.get(`/customers/stats?${qs}`),
        api.get(`/crm/customers/activities/stats?${qs}`),
        // Unresolved detractors and partial resolutions, most recent first —
        // the queue a person should actually clear, not every response ever.
        api.get(`/customer-survey?flagged=1&${qs}${bq}&limit=8`),
        api.get(`/disputes/stats?${qs}`),
      ]);
      setSurvey(s.success ? s.data : null);
      if (!branch && s.success) {
        // Both sorted into the workshop's own branch order, not the API's
        // volume order, so the dropdown, the table and the export agree.
        setBranchOptions((s.data?.byBranch || [])
          .map(b => b.branch).filter(Boolean).sort(byBranchOrder));
        setAllByBranch([...(s.data?.byBranch || [])]
          .sort((x, y) => byBranchOrder(x.branch, y.branch)));
      }
      setBooking(b.success ? b.data : null);
      setCustomer(c.success ? c.data.period : null);
      setContacts(ct.success ? ct.data : null);
      setAttention(a.success ? a.data : []);
      setComplaints(cp.success ? cp.data : null);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, branch]);

  useEffect(() => { load(); }, [load]);

  async function markFollowedUp(id) {
    setActioning(id);
    try {
      const res = await api.patch(`/customer-survey/${id}/follow-up`, {});
      if (res?.success) {
        setBanner({ kind: 'ok', text: t('cx.followup_ok') });
        // Sit in a "resolved" state briefly before leaving the list — an
        // instant disappearance reads as the row breaking, not as done.
        setResolving(prev => new Set(prev).add(id));
        setTimeout(() => {
          setAttention(prev => (prev || []).filter(r => r.id !== id));
          setResolving(prev => { const n = new Set(prev); n.delete(id); return n; });
        }, 650);
        // The headline card would otherwise sit one stale until the next
        // full reload — decrement it in step with the list it summarises.
        setSurvey(prev => prev && {
          ...prev,
          headline: { ...prev.headline, needsFollowUp: Math.max(0, (prev.headline.needsFollowUp || 0) - 1) },
        });
      } else {
        setBanner({ kind: 'error', text: res?.message || t('cx.followup_err') });
      }
    } catch (e) {
      setBanner({ kind: 'error', text: e?.message || t('cx.followup_err') });
    } finally {
      setActioning(null);
    }
  }

  const h = survey?.headline || {};
  const npsBreakdown = survey?.npsBreakdown;
  const band = npsBand(h.nps);
  const resolvedPct = survey?.resolution?.resolvedPercent;

  return (
    <div className="page-container cx">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{t('cx.title')}</h1>
          <p className="page-subheading">{t('cx.subtitle')}</p>
        </div>
      </div>

      {banner && <div role="status" className={`cx-banner is-${banner.kind}`}>{banner.text}</div>}

      <div className="cx-controls">
        <div className="cx-daterange">
          <div className="cx-date-field">
            <Calendar width={15} height={15} className="cx-date-icon" />
            <div>
              <span className="cx-date-field-label">{t('reports.kpi.range_from')}</span>
              <input type="date" className="cx-date-input" value={range.from}
                onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
            </div>
          </div>
          <span className="cx-daterange-arrow">→</span>
          <div className="cx-date-field">
            <Calendar width={15} height={15} className="cx-date-icon" />
            <div>
              <span className="cx-date-field-label">{t('reports.kpi.range_to')}</span>
              <input type="date" className="cx-date-input" value={range.to}
                onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
            </div>
          </div>
        </div>
        {branchOptions.length > 0 && (
          <select className="cx-branch-select" value={branch}
            onChange={e => setBranch(e.target.value)} aria-label={t('cx.branch')}>
            <option value="">{t('cx.all_branches')}</option>
            {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        <button className="cx-refresh-btn" onClick={load} disabled={loading}>
          <Refresh width={14} height={14} className={loading ? 'cx-spin' : ''} /> {t('reports.refresh')}
        </button>
        {/* Excel first — the pack is a management document that gets filed and
            charted. CSV stays alongside for feeding another system. */}
        <button className="cx-export-btn" onClick={exportPackXlsx}
          disabled={loading || exporting || !survey}
          title={t('cx.export_pack_hint')}>
          <Download width={14} height={14} />
          {exporting ? t('cx.exporting') : t('cx.export_excel')}
        </button>
        <button className="cx-export-btn is-secondary" onClick={exportPackCsv}
          disabled={loading || !survey} title={t('cx.export_csv_hint')}>
          {t('cx.export_csv')}
        </button>
      </div>

      {/* Only survey_responses carries a branch, so say plainly which panels
          the filter reached rather than letting the others look filtered. */}
      {branch && (
        <p className="cx-branch-note">{t('cx.branch_scope_note', { branch })}</p>
      )}

      {loading && !survey ? (
        <div className="rpt-loading">
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton-pulse" style={{ height: 120, borderRadius: 16 }} />)}
        </div>
      ) : (
        <>
          {/* ── Hero: NPS gauge + promoter/passive/detractor split + vitals ── */}
          <div className="cx-hero">
            <div className="cx-hero-gauge" style={{ '--band-bg': band.bg, '--band-color': band.color }}>
              <NpsGauge value={h.nps} />
              {h.nps != null && (
                <div className="cx-band-pill" style={{ color: band.color, background: band.bg }}>
                  {t(band.label)}
                </div>
              )}
              {npsBreakdown && (
                <div className="cx-nps-split">
                  {/* Each segment opens that segment's individual responses,
                      which is the SOP's "select the detractor segment to list
                      the individual responses". The list lives on Customer
                      Feedback, which already filters by category server-side,
                      rather than being duplicated here. */}
                  <div className="cx-nps-split-bar">
                    {NPS_SEGMENTS.map(seg => (
                      <button
                        key={seg.key}
                        type="button"
                        className="cx-nps-seg"
                        style={{ width: `${npsBreakdown[seg.pctKey]}%`, background: seg.color }}
                        title={t('cx.view_segment', { segment: t(seg.labelKey), n: npsBreakdown[seg.countKey] })}
                        aria-label={t('cx.view_segment', { segment: t(seg.labelKey), n: npsBreakdown[seg.countKey] })}
                        onClick={() => openSegment(seg.key)}
                      />
                    ))}
                  </div>
                  <div className="cx-nps-split-legend">
                    {NPS_SEGMENTS.map(seg => (
                      <button key={seg.key} type="button" className="cx-nps-legend-btn"
                        onClick={() => openSegment(seg.key)}>
                        <i style={{ background: seg.color }} />
                        {t(seg.labelKey)} {npsBreakdown[seg.pctKey]}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="cx-hero-vitals">
              <VitalCard icon={Check} color="#f59e0b" label={t('reports.kpi.csat')}
                value={h.csatAvg != null ? `${h.csatAvg}` : '—'} unit="/5" />
              <VitalCard icon={Check} color="#0ea5e9" label={t('cx.ces')}
                value={h.cesAvg != null ? `${h.cesAvg}` : '—'} unit="/5" />
              {/* The count sits beside the rate on purpose: a small sample
                  swings NPS/CSAT hard, so reading a score without knowing
                  how many responses produced it is the trap the SOP warns
                  about ("a small sample moves the score sharply"). */}
              <VitalCard icon={SendMail} color="#8b5cf6" label={t('reports.kpi.survey_response_rate')}
                value={h.responseRate != null ? `${h.responseRate}` : '—'} unit="%"
                sub={survey ? t('cx.responses_of_invites', { n: h.responses ?? 0, sent: h.invitesSent ?? 0 }) : ''} />
              <VitalCard icon={ChatBubble} color="#0d9488" label={t('cx.responses')}
                value={h.responses ?? '—'} unit="" />
              <VitalCard icon={ClipboardCheck} color="#1e3a6b" label={t('cx.resolved_pct')}
                value={resolvedPct != null ? `${resolvedPct}` : '—'} unit="%" />
              <VitalCard icon={WarningTriangle} color={Number(h.needsFollowUp) > 0 ? '#dc2626' : '#16a34a'}
                label={t('cx.needs_followup')} value={h.needsFollowUp ?? '—'} unit=""
                pulse={Number(h.needsFollowUp) > 0} />
            </div>
          </div>

          {/* ── Needs attention: the actual follow-up queue ───────────────── */}
          <div className="cx-section-head cx-section-head--warm">
            <span className="cx-section-dot" />
            <h2>{t('cx.needs_attention_title')}</h2>
            {attention?.length > 0 && <span className="cx-section-count">{attention.length}</span>}
          </div>
          {attention === null ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{t('cx.loading')}</p>
          ) : attention.length === 0 ? (
            <div className="cx-all-clear">
              <div className="cx-all-clear-icon"><Check width={26} height={26} /></div>
              <p>{t('cx.needs_attention_empty')}</p>
            </div>
          ) : (
            <div className="cx-attention-grid">
              {attention.map(r => {
                const sev = r.nps_category === 'detractor' ? 'red' : r.nps_category === 'passive' ? 'amber' : 'green';
                return (
                  <div key={r.id} className={`cx-ticket cx-ticket--${sev}${resolving.has(r.id) ? ' is-resolving' : ''}`}>
                    <div className="cx-ticket-top">
                      <div className="cx-avatar" style={{ background: `var(--cx-${sev}-tint)`, color: `var(--cx-${sev})` }}>
                        {initials(r.contact_name)}
                      </div>
                      <div className="cx-ticket-who">
                        <div className="cx-ticket-name">{r.contact_name || t('cx.anonymous')}</div>
                        <div className="cx-ticket-meta">
                          {r.contact_phone && <span><Phone width={11} height={11} /> {r.contact_phone}</span>}
                          <span><Calendar width={11} height={11} /> {fmtDaysAgo(r.submitted_at, t)}</span>
                        </div>
                      </div>
                      {r.nps_score != null && (
                        <div className="cx-score-badge" style={{ borderColor: `var(--cx-${sev})`, color: `var(--cx-${sev})` }}>
                          {r.nps_score}
                        </div>
                      )}
                    </div>

                    {r.nps_reason && (
                      <div className="cx-ticket-quote">
                        <Quote width={16} height={16} className="cx-quote-mark" />
                        <p>{r.nps_reason}</p>
                      </div>
                    )}

                    <div className="cx-ticket-bottom">
                      {r.resolution && r.resolution !== 'yes' && (
                        <span className="cx-resolution-chip">
                          {r.resolution === 'no' ? t('cx.not_resolved') : t('cx.partially_resolved')}
                        </span>
                      )}
                      <button className="cx-resolve-btn" disabled={actioning === r.id || resolving.has(r.id)}
                        onClick={() => markFollowedUp(r.id)}>
                        <Check width={13} height={13} />
                        {resolving.has(r.id) ? t('cx.followup_ok') : actioning === r.id ? t('cx.saving') : t('cx.mark_followed_up')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Booking experience + loyalty: rows 1-3, 4-5 ─────────────── */}
          <div className="cx-section-head cx-section-head--cool">
            <span className="cx-section-dot" />
            <h2>{t('cx.section_booking_loyalty')}</h2>
          </div>
          <div className="cx-cool-panel">
            <div className="cx-vitals-row">
              <VitalCard icon={Check} color="#0ea5e9" label={t('reports.kpi.booking_conversion')}
                value={booking?.totals?.conversion_rate_pct != null ? `${booking.totals.conversion_rate_pct}` : '—'} unit="%"
                sub={booking ? t('reports.kpi.confirmed_count', { n: booking.totals.confirmed }) : ''} />
              <VitalCard icon={User} color="#22c55e" label={t('reports.kpi.show_up_rate')}
                value={booking?.totals?.show_up_rate_pct != null ? `${booking.totals.show_up_rate_pct}` : '—'} unit="%" />
              <VitalCard icon={User} color="#f97316" label={t('reports.kpi.new_customers')}
                value={customer?.new_customers ?? '—'} unit=""
                sub={customer ? t('reports.kpi.of_customers_served', { n: customer.customers_served }) : ''} />
              <VitalCard icon={User} color="#8b5cf6" label={t('reports.kpi.repeat_customer_rate')}
                value={customer?.repeat_rate_pct != null ? `${customer.repeat_rate_pct}` : '—'} unit="%"
                sub={customer ? t('reports.kpi.repeat_count', { n: customer.repeat_customers }) : ''} />
            </div>
          </div>

          {/* ── Contact channels + complaints roadmap ───────────────────── */}
          <div className="cx-footer-row">
            <div className="cx-channel-card">
              <div className="cx-footer-card-head"><h4>{t('reports.kpi.by_contact_channel_title')}</h4></div>
              {contacts?.by_channel?.length > 0 ? (
                <div className="cx-channel-bars">
                  {(() => {
                    const max = Math.max(1, ...contacts.by_channel.map(row => row.count));
                    return contacts.by_channel.map(row => (
                      <div className="cx-channel-bar-row" key={row.channel}>
                        <span className="cx-channel-bar-label">
                          <ChatBubble width={13} height={13} /> {t(`reports.kpi.channel_${row.channel}`)}
                        </span>
                        <div className="cx-channel-bar-track">
                          <div className="cx-channel-bar-fill" style={{ width: `${(row.count / max) * 100}%` }} />
                        </div>
                        <span className="cx-channel-bar-count">{row.count}</span>
                      </div>
                    ));
                  })()}
                </div>
              ) : <div className="rpt-empty"><p>{t('reports.kpi.no_data')}</p></div>}
              <p className="cx-footnote">{t('reports.kpi.contact_channel_note')}</p>
            </div>

            <div className="cx-roadmap-card">
              <div className="cx-roadmap-card-head">
                <strong>{t('cx.complaints_title')}</strong>
                <button className="cx-roadmap-link" onClick={() => navigate('/complaints')}>
                  {t('cx.view_complaints')} <ArrowRight width={13} height={13} />
                </button>
              </div>
              {complaints?.headline ? (
                <>
                  <div className="cx-mini-vitals">
                    <div className="cx-mini-vital">
                      <span className="cx-mini-vital-value" style={{ color: complaints.headline.stillOpen > 0 ? '#dc2626' : '#16a34a' }}>
                        {complaints.headline.stillOpen}
                      </span>
                      <span className="cx-mini-vital-label">{t('cx.complaints_still_open')}</span>
                    </div>
                    <div className="cx-mini-vital">
                      <span className="cx-mini-vital-value">{complaints.headline.ackSlaPct != null ? `${complaints.headline.ackSlaPct}%` : '—'}</span>
                      <span className="cx-mini-vital-label">{t('cx.complaints_ack_sla')}</span>
                    </div>
                    <div className="cx-mini-vital">
                      <span className="cx-mini-vital-value">{complaints.headline.avgResolutionDays != null ? `${complaints.headline.avgResolutionDays}d` : '—'}</span>
                      <span className="cx-mini-vital-label">{t('cx.complaints_avg_resolution')}</span>
                    </div>
                  </div>
                  <p className="cx-footnote">{t('cx.complaints_note')}</p>
                </>
              ) : <p>{t('cx.complaints_note')}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const VitalCard = ({ icon: Icon, color, label, value, unit, sub, pulse }) => (
  <div className={`cx-vital${pulse ? ' cx-vital--pulse' : ''}`}>
    <div className="cx-vital-icon" style={{ background: color + '18', color }}>
      <Icon width={18} height={18} />
    </div>
    <div className="cx-vital-body">
      <div className="cx-vital-value">{value}<span className="cx-vital-unit">{unit}</span></div>
      <div className="cx-vital-label">{label}</div>
      {sub && <div className="cx-vital-sub">{sub}</div>}
    </div>
  </div>
);
