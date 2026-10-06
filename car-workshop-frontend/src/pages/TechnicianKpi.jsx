import { useState, useEffect, useCallback, useMemo } from 'react';
import { Wrench, DollarCircle, Clock, GraphUp, Search, WarningTriangle } from 'iconoir-react';
import api from '../lib/api';
import './CRMPages.css';
import './CrmSurface.css';
import './TechnicianKpi.css';

/**
 * Technician KPI — the periodic attendance/billing report (days present,
 * hours, billed value, utilization/productivity/efficiency) per technician.
 *
 * Only Jul-2026 comes from a real attendance report. The other periods are
 * modeled figures from a workbook that labels itself "SIMULATED /
 * ESTIMATED ... not to be treated as accounting, payroll, HR or operational
 * source-of-truth data", so this page carries that distinction everywhere
 * the numbers appear: a badge next to the period, a notice above the
 * figures, and hatched (not merely recoloured) bars in the trend strip —
 * the actual/estimated split is a status dimension, so it must not rely on
 * colour alone.
 *
 * Deliberately a separate page from Performance.jsx — that page already
 * means work-order delivery/success rate per mechanic, which is a different
 * question from billed-hour efficiency.
 */

const band = pct => {
  if (pct == null) return { color: 'var(--cs-ink-faint)', bg: 'var(--cs-rule-soft)' };
  if (pct < 60) return { color: 'var(--cs-rose)', bg: 'var(--cs-rose-tint)' };
  if (pct < 85) return { color: 'var(--cs-amber)', bg: 'var(--cs-amber-tint)' };
  return { color: 'var(--cs-green)', bg: 'var(--cs-green-tint)' };
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' -> 'Jul 2026', parsed as plain date parts so a UTC shift
 *  can't roll a period label back into the previous month. */
const periodLabel = (start, end) => {
  const [y, m] = String(start).split('-').map(Number);
  const endDay = Number(String(end).split('-')[2]);
  const lastOfMonth = new Date(y, m, 0).getDate();
  const partial = endDay < lastOfMonth ? ` 1–${endDay}` : '';
  return `${MONTH_SHORT[m - 1]}${partial ? partial : ''} ${y}`;
};
const monthTick = start => {
  const [, m] = String(start).split('-').map(Number);
  return MONTH_SHORT[m - 1];
};

const fmtMoney = v => v != null ? `AED ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';
const fmtCompact = v => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
};
const n1 = v => v == null ? '—' : Number(v).toFixed(1);
const pct0 = v => v == null ? '—' : `${Math.round(Number(v))}%`;

export default function TechnicianKpi() {
  const [periods, setPeriods] = useState([]);
  const [trend, setTrend] = useState([]);
  const [selected, setSelected] = useState(null);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hoverIdx, setHoverIdx] = useState(null);

  const [search, setSearch] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [bandFilter, setBandFilter] = useState('');
  const [sortKey, setSortKey] = useState('efficiency_pct');
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/mechanic-kpi/periods'),
      api.get('/mechanic-kpi/trend'),
    ]).then(([p, t]) => {
      if (p?.success && p.data?.length) {
        setPeriods(p.data);
        setSelected(p.data[0]);
      } else {
        setLoading(false);
      }
      if (t?.success) setTrend(t.data || []);
    }).catch(() => setLoading(false));
  }, []);

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const qs = `period_start=${selected.period_start}&period_end=${selected.period_end}`;
      const r = await api.get(`/mechanic-kpi/snapshots?${qs}`);
      if (r?.success) { setRows(r.data || []); setSummary(r.summary); }
      else setBanner({ kind: 'error', text: r?.message || 'Could not load the KPI report.' });
    } catch (e) {
      setBanner({ kind: 'error', text: e?.message || 'Could not load the KPI report.' });
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { load(); }, [load]);

  const designations = useMemo(
    () => [...new Set(rows.map(r => r.designation).filter(Boolean))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r =>
        r.mechanic_name.toLowerCase().includes(q) ||
        r.designation?.toLowerCase().includes(q) ||
        r.employee_code?.toLowerCase().includes(q));
    }
    if (designationFilter) list = list.filter(r => r.designation === designationFilter);
    if (bandFilter) {
      list = list.filter(r => {
        const e = Number(r.efficiency_pct);
        if (bandFilter === 'low') return e < 60;
        if (bandFilter === 'mid') return e >= 60 && e < 85;
        return e >= 85;
      });
    }
    return [...list].sort((a, b) => Number(b[sortKey] ?? -1) - Number(a[sortKey] ?? -1));
  }, [rows, search, designationFilter, bandFilter, sortKey]);

  // Totals for the rows actually on screen, so the footer agrees with the
  // filtered view rather than silently reporting the whole period.
  const totals = useMemo(() => {
    if (!filtered.length) return null;
    const s = k => filtered.reduce((a, r) => a + Number(r[k] || 0), 0);
    const a = k => s(k) / filtered.length;
    return {
      count: filtered.length,
      days_present: s('days_present'),
      avail_hrs: s('avail_hrs'),
      ot_hrs: s('ot_hrs'),
      total_hrs: s('total_hrs'),
      worked_hrs: s('worked_hrs'),
      billed_value: s('billed_value'),
      billed_hrs: s('billed_hrs'),
      billed_hours: s('billed_hours'),
      u: a('utilization_pct'), p: a('productivity_pct'), e: a('efficiency_pct'),
    };
  }, [filtered]);

  const isEstimated = !!selected?.is_estimated;
  const activeFilters = Boolean(search || designationFilter || bandFilter);

  // A period whose end isn't its month's last day is month-to-date, so its
  // billed total isn't magnitude-comparable with the full months beside it.
  // Flagged rather than rescaled — and excluded from the mean reference line.
  const isPartial = t => {
    const [y, m] = String(t.period_start).split('-').map(Number);
    return Number(String(t.period_end).split('-')[2]) < new Date(y, m, 0).getDate();
  };
  const maxBilled = Math.max(1, ...trend.map(t => Number(t.total_billed_value || 0)));
  // Monthly billing sits in a narrow band (~0.92–1.05M), so on a zero
  // baseline the bars read as one flat slab. A mean line over the complete
  // months makes the real variation legible without truncating the axis.
  const completeMonths = trend.filter(t => !isPartial(t));
  const meanBilled = completeMonths.length
    ? completeMonths.reduce((a, t) => a + Number(t.total_billed_value || 0), 0) / completeMonths.length
    : 0;

  const cards = summary ? [
    { key: 'count', label: 'Technicians in report', value: summary.technician_count, Icon: Wrench, tone: 'blue' },
    { key: 'billed', label: 'Total billed value', value: fmtMoney(summary.total_billed_value), Icon: DollarCircle, tone: 'green' },
    { key: 'util', label: 'Avg. utilization', value: `${summary.avg_utilization_pct}%`, Icon: Clock, tone: 'amber' },
    { key: 'eff', label: 'Avg. efficiency', value: `${summary.avg_efficiency_pct}%`, Icon: GraphUp, tone: 'rose' },
  ] : [];

  return (
    <div className="page-container cs">
      <header className="cs-head">
        <div>
          <h1 className="cs-title">Technician KPI</h1>
          <p className="cs-sub" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {selected
              ? <>
                  <span>{periodLabel(selected.period_start, selected.period_end)} · attendance, hours and billing per technician</span>
                  <span className={`tk-badge tk-badge--${isEstimated ? 'estimated' : 'actual'}`}>
                    {isEstimated ? 'Estimated' : 'Actual report'}
                  </span>
                </>
              : 'Attendance, hours and billing performance by technician'}
          </p>
        </div>
      </header>

      {banner && <div role="status" className={`cs-banner is-${banner.kind}`}>{banner.text}</div>}

      {!loading && !selected ? (
        <div className="cs-empty" style={{ padding: '48px 20px' }}>
          <Wrench width={40} height={40} />
          <p>No technician KPI report has been imported yet.</p>
        </div>
      ) : (
        <>
          {isEstimated && (
            <div className="tk-notice" role="note">
              <WarningTriangle width={18} height={18} className="tk-notice-icon" />
              <div>
                <strong>These are estimated figures, not a real attendance report</strong>
                <p>
                  {periodLabel(selected.period_start, selected.period_end)} is modeled around the
                  Jul 2026 baseline. Only <b>Jul 2026</b> is transcribed from an actual report — use
                  that one for anything payroll, HR or accounting related.
                </p>
              </div>
            </div>
          )}

          {trend.length > 1 && (
            <div className="tk-trend">
              <div className="tk-trend-head">
                <h3>Billed value by period</h3>
                <span className="tk-trend-sub">Select a period to view its report</span>
              </div>

              <div className="tk-bars" role="tablist" aria-label="Select reporting period">
                {meanBilled > 0 && (
                  <div className="tk-meanline" style={{ bottom: `${(meanBilled / maxBilled) * 100}%` }}>
                    <span>avg {fmtCompact(meanBilled)}</span>
                  </div>
                )}
                {trend.map((t, i) => {
                  const isSel = selected && t.period_start === selected.period_start;
                  const h = Math.max(3, (Number(t.total_billed_value) / maxBilled) * 100);
                  return (
                    <button
                      key={t.period_start}
                      role="tab"
                      aria-selected={!!isSel}
                      className={`tk-bar-btn${isSel ? ' is-selected' : ''}`}
                      onClick={() => setSelected(periods.find(p => p.period_start === t.period_start) || t)}
                      onMouseEnter={() => setHoverIdx(i)}
                      onMouseLeave={() => setHoverIdx(null)}
                      title={`${periodLabel(t.period_start, t.period_end)} — ${fmtMoney(t.total_billed_value)}`}
                    >
                      {hoverIdx === i && (
                        <div className="tk-tip">
                          <div><b>{periodLabel(t.period_start, t.period_end)}</b>{t.is_estimated ? ' · estimated' : ' · actual'}{isPartial(t) ? ' · part month' : ''}</div>
                          <div className="tk-tip-row"><span>Billed</span><span>{fmtMoney(t.total_billed_value)}</span></div>
                          <div className="tk-tip-row"><span>Avg U / P / E</span><span>{t.avg_utilization_pct}% / {t.avg_productivity_pct}% / {t.avg_efficiency_pct}%</span></div>
                        </div>
                      )}
                      <span className="tk-bar-value">{isSel ? fmtCompact(t.total_billed_value) : ''}</span>
                      <span
                        className={`tk-bar${t.is_estimated ? ' tk-bar--estimated' : ''}`}
                        style={{ height: `${h}%` }}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="tk-bar-labels" aria-hidden="true">
                {trend.map(t => {
                  const isSel = selected && t.period_start === selected.period_start;
                  return (
                    <span key={t.period_start} className={`tk-bar-label${isSel ? ' is-selected' : ''}`}>
                      {monthTick(t.period_start)}{isPartial(t) ? '*' : ''}
                    </span>
                  );
                })}
              </div>

              <div className="tk-legend">
                <span><i className="solid" /> Actual report</span>
                <span><i className="hatched" /> Estimated</span>
                <span>* part month — month-to-date, not comparable with full months</span>
              </div>
            </div>
          )}

          <div className="cs-kpis">
            {cards.map(c => (
              <div className={`cs-kpi cs-kpi--${c.tone}`} key={c.key}>
                <div className="cs-kpi-icon"><c.Icon width={24} height={24} /></div>
                <div className="cs-kpi-body">
                  <p className="cs-kpi-value">{c.value ?? 0}</p>
                  <p className="cs-kpi-label">{c.label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="cs-controls">
            <div className="cs-search">
              <Search width={17} height={17} />
              <input placeholder="Search technician, ID or designation…" value={search}
                onChange={e => setSearch(e.target.value)} aria-label="Search technicians" />
            </div>
            <select className="form-control tk-fixed-select" value={designationFilter}
              onChange={e => setDesignationFilter(e.target.value)} aria-label="Filter by designation">
              <option value="">All designations</option>
              {designations.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="form-control tk-fixed-select" value={bandFilter}
              onChange={e => setBandFilter(e.target.value)} aria-label="Filter by efficiency band">
              <option value="">All efficiency</option>
              <option value="high">High (85%+)</option>
              <option value="mid">Mid (60–84%)</option>
              <option value="low">Low (under 60%)</option>
            </select>
            <select className="form-control tk-fixed-select" value={sortKey}
              onChange={e => setSortKey(e.target.value)} aria-label="Sort by">
              <option value="efficiency_pct">Sort: Efficiency</option>
              <option value="utilization_pct">Sort: Utilization</option>
              <option value="productivity_pct">Sort: Productivity</option>
              <option value="billed_value">Sort: Billed value</option>
              <option value="worked_hrs">Sort: Worked hours</option>
              <option value="days_present">Sort: Days present</option>
            </select>
            {activeFilters && (
              <button className="cs-filter-clear" style={{ flex: 'none' }}
                onClick={() => { setDesignationFilter(''); setBandFilter(''); setSearch(''); }}>
                Clear filters
              </button>
            )}
          </div>

          <div className="cs-tablewrap tk-scroll">
            <table className="cs-table tk-table">
              <thead>
                <tr>
                  <th className="tk-tech-cell">Technician</th>
                  <th>Designation</th>
                  <th>Days</th>
                  <th>Avail hrs</th>
                  <th>OT</th>
                  <th>Total hrs</th>
                  <th>Worked hrs</th>
                  <th>Prod%</th>
                  <th>Idle%</th>
                  <th>Billed value</th>
                  <th>Billed hrs</th>
                  <th>Billed hours</th>
                  <th>U%</th>
                  <th>P%</th>
                  <th>E%</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={15} className="cs-empty">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={15} className="cs-empty">No technicians match those filters.</td></tr>
                ) : filtered.map(r => {
                  const u = band(r.utilization_pct), p = band(r.productivity_pct), e = band(r.efficiency_pct);
                  return (
                    <tr key={r.id}>
                      <td className="tk-tech-cell">
                        <div className="cs-name">{r.mechanic_name}</div>
                        <div className="cs-meta">{r.employee_code}</div>
                      </td>
                      <td className="cs-service">{r.designation}</td>
                      <td className="cs-num">{r.days_present}</td>
                      <td className="cs-num">{n1(r.avail_hrs)}</td>
                      <td className="cs-num">{Number(r.ot_hrs) ? n1(r.ot_hrs) : '—'}</td>
                      <td className="cs-num">{n1(r.total_hrs)}</td>
                      <td className="cs-num">{n1(r.worked_hrs)}</td>
                      {/* Idle is derived from the rounded Prod rather than
                          rounded on its own, or 99.46%/0.54% renders as
                          "100% / 1%" and appears to sum to 101. */}
                      <td className="cs-num">{r.prod_hrs_pct == null ? '—' : `${Math.round(Number(r.prod_hrs_pct) * 100)}%`}</td>
                      <td className="cs-num">{r.prod_hrs_pct == null ? '—' : `${100 - Math.round(Number(r.prod_hrs_pct) * 100)}%`}</td>
                      <td className="cs-num">{fmtMoney(r.billed_value)}</td>
                      <td className="cs-num">{n1(r.billed_hrs)}</td>
                      <td className="cs-num">{n1(r.billed_hours)}</td>
                      <td><span className="tk-pill" style={{ color: u.color, background: u.bg }}>{pct0(r.utilization_pct)}</span></td>
                      <td><span className="tk-pill" style={{ color: p.color, background: p.bg }}>{pct0(r.productivity_pct)}</span></td>
                      <td><span className="tk-pill" style={{ color: e.color, background: e.bg }}>{pct0(r.efficiency_pct)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
              {totals && (
                <tfoot>
                  <tr>
                    <td className="tk-tech-cell">
                      {activeFilters ? `Total / avg — ${totals.count} shown` : `Total / avg — ${totals.count} technicians`}
                    </td>
                    <td />
                    <td className="cs-num">{totals.days_present}</td>
                    <td className="cs-num">{Math.round(totals.avail_hrs)}</td>
                    <td className="cs-num">{totals.ot_hrs ? Math.round(totals.ot_hrs) : '—'}</td>
                    <td className="cs-num">{Math.round(totals.total_hrs)}</td>
                    <td className="cs-num">{Math.round(totals.worked_hrs)}</td>
                    <td />
                    <td />
                    <td className="cs-num">{fmtMoney(totals.billed_value)}</td>
                    <td className="cs-num">{Math.round(totals.billed_hrs)}</td>
                    <td className="cs-num">{Math.round(totals.billed_hours)}</td>
                    <td className="cs-num">{pct0(totals.u)}</td>
                    <td className="cs-num">{pct0(totals.p)}</td>
                    <td className="cs-num">{pct0(totals.e)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}
