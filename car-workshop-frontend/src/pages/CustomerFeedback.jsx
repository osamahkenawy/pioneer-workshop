import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  StatsUpSquare, EmojiSatisfied, Flash, WarningTriangle, Xmark, Link as LinkIcon,
  Copy, CheckCircle, Search, Refresh, MessageText, Building, Wrench, QrCode,
  Download,
} from 'iconoir-react';
import { useTranslation } from 'react-i18next';
import * as QRCodeModule from 'qrcode';
import api from '../lib/api';
import { downloadXlsx } from '../utils/xlsx';
import { responsesSheet } from '../utils/survey-export';

/**
 * Customer Feedback — CES / NPS / CSAT analysis.
 *
 * Every survey response lands here with its scores already derived, plus the
 * three headline metrics the business asked for. The survey itself is the
 * public page at /survey; this is where the results are read.
 *
 * Two things are deliberately prominent:
 *   - the NPS split, because a bare NPS number hides whether it moved because
 *     promoters grew or detractors shrank;
 *   - the follow-up queue, because a detractor or an unresolved job is only
 *     worth collecting if somebody actually calls the customer back.
 */

/**
 * Hidden for now at the customer's request. Both are fully wired and working —
 * flip a flag back to true to restore that piece, no other change needed.
 *   SHOW_KPI_SUBTEXT — the small qualifier under each headline score
 *                      ("from 6 scored", "50% rated 4 or 5", ...)
 *   SHOW_FILTERS     — the date / branch / category / follow-up controls. The
 *                      filter state and its query building stay in place, so
 *                      with this off the page simply reports on all responses.
 *   SHOW_ALL_RESPONSES — the "All responses" table, which lists individual
 *                      customers by name. The aggregate scores above it are
 *                      unaffected.
 * The search box is deliberately not covered by any flag.
 */
const SHOW_KPI_SUBTEXT   = false;
const SHOW_FILTERS       = false;
/*
 * Hidden at the customer's request, 2026-09-03. All three are fully wired —
 * flip a flag to true to bring one back, nothing else to change.
 *   SHOW_BY_BRANCH  / SHOW_BY_SERVICE — the two breakdown tables. The Google
 *                     Form does not ask for branch or service, so every
 *                     response has neither and each table showed a single
 *                     "Unspecified" row carrying no information. Add those
 *                     questions to the Form and these become worth showing.
 *   SHOW_TREND      — the 12-month chart. With two months of data it drew 81
 *                     then -17, which reads as a collapse rather than as a
 *                     six-response sample.
 */
const SHOW_BY_BRANCH     = false;
const SHOW_BY_SERVICE    = false;
const SHOW_TREND         = false;

const SHOW_ALL_RESPONSES = true;    // per-response table — re-enabled: every
                                    // submission has to be visible individually,
                                    // not only inside the aggregate scores

const NAVY   = '#1e3a6b';
const TEAL   = '#0d6273';
const GREEN  = '#16a34a';
const AMBER  = '#d97706';
const RED    = '#dc2626';

// Colours only — the labels come from the translation files, keyed by
// `cat_<category>` and `res_<resolution>`.
const CATEGORY = {
  promoter:  { color: GREEN, bg: '#dcfce7' },
  passive:   { color: AMBER, bg: '#fef3c7' },
  detractor: { color: RED,   bg: '#fee2e2' },
};

const RESOLUTION = {
  yes:       { color: GREEN },
  partially: { color: AMBER },
  no:        { color: RED },
};

const fmtDate = (d, locale) => d
  ? new Date(String(d).replace(' ', 'T')).toLocaleDateString(locale || 'en-AE', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

/** Isolates numbers from surrounding RTL/LTR text so they always read correctly. */
const Num = ({ children }) => <bdi>{children}</bdi>;

/** NPS runs -100..100, so it needs its own banding rather than a 1-5 scale. */
function npsColor(nps) {
  if (nps === null || nps === undefined) return '#94a3b8';
  if (nps >= 50) return GREEN;
  if (nps >= 0)  return AMBER;
  return RED;
}
/** CES and CSAT are both 1-5, where 4+ is the accepted "good" threshold. */
function scoreColor(v) {
  if (v === null || v === undefined) return '#94a3b8';
  if (v >= 4)   return GREEN;
  if (v >= 3)   return AMBER;
  return RED;
}

function KPICard({ icon: Icon, label, value, sub, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '16px 18px', flex: 1, minWidth: 150,
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: `3px solid ${color}` }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: color + '18',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <Icon width={18} height={18} color={color} strokeWidth={1.8} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, color: '#1e293b', lineHeight: 1 }}><Num>{value}</Num></div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 500 }}>{label}</div>
      {sub && <div dir="auto" style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Card({ title, subtitle, right, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      padding: '16px 18px', marginBottom: 18 }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 14.5, fontWeight: 800, color: NAVY, margin: 0 }}>{title}</h3>
            {subtitle && <p style={{ fontSize: 12, color: '#94a3b8', margin: '3px 0 0' }}>{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/** Horizontal bar used for both the per-question averages and the NPS split. */
function Bar({ label, value, max, display, color, note }) {
  const pct = max ? Math.max(0, Math.min(100, (Number(value) / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
        <span dir="auto" style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.35 }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color, whiteSpace: 'nowrap' }}>
          <Num>{display}</Num>{note && <span style={{ color: '#94a3b8', fontWeight: 500 }}> {note}</span>}
        </span>
      </div>
      <div style={{ height: 7, background: '#eef2f5', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

export default function CustomerFeedback() {
  const { t, i18n } = useTranslation();
  const [stats, setStats]     = useState(null);
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  // Seeded from the URL so a drill-down (e.g. clicking the detractor segment
  // on the CX dashboard) opens this list already narrowed to that slice. The
  // filter *controls* are hidden behind SHOW_FILTERS, but the filter state and
  // its query building were always live, so this needs no other change.
  const [filters, setFilters] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return {
      from: q.get('from') || '',
      to: q.get('to') || '',
      branch: q.get('branch') || '',
      category: q.get('category') || '',
      flagged: q.get('flagged') || '',
    };
  });
  const [search, setSearch]   = useState('');
  const [detail, setDetail]   = useState(null);
  const [followUpNote, setFollowUpNote] = useState('');
  const [inviteLink, setLink] = useState(null);
  const [copied, setCopied]   = useState(false);
  const [compose, setCompose] = useState(null);
  const [creating, setCreating] = useState(false);
  const [qrModal, setQrModal]   = useState(null);   // URL string when QR modal is open
  const [qrCopied, setQrCopied]   = useState(false);
  const [exporting, setExporting]  = useState(false);
  const qrCanvasRef = useRef(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }, [filters]);

  useEffect(() => {
    if (!qrModal || !qrCanvasRef.current) return;
    const QR = QRCodeModule.default || QRCodeModule;
    QR.toCanvas(qrCanvasRef.current, qrModal, {
      width: 224, margin: 2,
      color: { dark: '#1e3a6b', light: '#ffffff' },
    }).catch(console.error);
  }, [qrModal]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, l] = await Promise.all([
        api.get(`/customer-survey/stats${qs ? `?${qs}` : ''}`),
        api.get(`/customer-survey?limit=100${qs ? `&${qs}` : ''}`),
      ]);
      if (s.success) setStats(s.data);
      else setError(s.message || t('customerFeedback.err_load'));
      if (l.success) setRows(l.data || []);
    } catch {
      setError(t('customerFeedback.err_net_load'));
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  /*
   * Excel export of every response in the current filter, one row per
   * respondent with all eleven answers and the question wording as the header.
   *
   * It refetches rather than exporting `rows`, for two reasons: the table is
   * capped at 100 and a month of responses runs past that, so exporting what
   * is on screen would silently truncate; and the list endpoint returns only
   * the derived averages, not the individual answers, which are the whole
   * point of this export. /customer-survey/export returns both, unpaginated.
   *
   * The client-side text search is deliberately NOT applied — it narrows what
   * is on screen out of the fetched page only, so honouring it would mean
   * exporting a filter the server never saw and could not reproduce. The
   * date / branch / category filters, which the server does apply, are all
   * carried through in `qs`.
   */
  const exportXlsx = async () => {
    setExporting(true);
    setError('');
    try {
      const res = await api.get(`/customer-survey/export${qs ? `?${qs}` : ''}`);
      if (!res?.success) throw new Error(res?.message || t('customerFeedback.err_load'));

      const rowsOut = res.data || [];
      if (!rowsOut.length) {
        setError(t('customerFeedback.export_empty'));
        return;
      }

      const from = filters.from || 'earliest';
      const to = filters.to || 'latest';
      const parts = ['pioneer-survey-responses', from, 'to', to];
      if (filters.branch) parts.push(filters.branch.replace(/[^\w-]+/g, '-'));
      if (filters.category) parts.push(filters.category);

      await downloadXlsx(`${parts.join('_')}.xlsx`, [
        responsesSheet(rowsOut, res.questions || {}),
      ]);

      if (res.truncated) setError(t('customerFeedback.export_truncated'));
    } catch (e) {
      console.error('[CustomerFeedback] Excel export failed:', e);
      setError(e?.message || t('customerFeedback.export_failed'));
    } finally {
      setExporting(false);
    }
  };

  // Client-side text search over the already-fetched page: the server filters
  // by date / branch / category, this narrows what is on screen.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      [r.contact_name, r.contact_phone, r.branch, r.service_requested, r.nps_reason, r.work_order_number]
        .some(v => v && String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  async function createLink(e) {
    e?.preventDefault();
    setError('');
    if (!compose?.contact_name?.trim() && !compose?.contact_phone?.trim()) {
      setError(t('customerFeedback.err_need_contact'));
      return;
    }
    setCreating(true);
    try {
      const res = await api.post('/customer-survey/invites', {
        channel: compose.channel || 'whatsapp',
        contact_name: compose.contact_name?.trim() || undefined,
        contact_phone: compose.contact_phone?.trim() || undefined,
        branch: compose.branch?.trim() || undefined,
      });
      if (res.success) {
        setLink(`${window.location.origin}${res.data.path}`);
        setCopied(false);
        setCompose(null);
      } else {
        setError(res.message || t('customerFeedback.err_create'));
      }
    } catch {
      setError(t('customerFeedback.err_net_create'));
    } finally {
      setCreating(false);
    }
  }

  async function openDetail(id) {
    try {
      const res = await api.get(`/customer-survey/${id}`);
      // Clear any half-typed outcome from the previously opened response,
      // so it can't be saved against the wrong customer.
      setFollowUpNote('');
      if (res.success) setDetail(res.data);
      else setError(res.message || t('customerFeedback.err_load_response'));
    } catch { setError('Could not load that response'); }
  }

  // The backend has always accepted `notes` here and written it to
  // survey_responses.follow_up_notes; nothing ever sent it, so the column sat
  // empty and "what came of the call" was lost. The SOP asks for exactly that
  // ("record the outcome on the response"), so it's captured now.
  async function markFollowedUp(id, notes) {
    try {
      const res = await api.patch(`/customer-survey/${id}/follow-up`,
        notes && notes.trim() ? { notes: notes.trim() } : {});
      if (!res.success) { setError(res.message || t('customerFeedback.err_followup')); return; }
      setFollowUpNote('');
      setDetail(null);
      load();
    } catch {
      setError(t('customerFeedback.err_net_followup'));
    }
  }

  const h  = stats?.headline || {};
  const nb = stats?.npsBreakdown || {};
  const rz = stats?.resolution || {};

  // Qualify the public link with the workshop slug: a bare /survey cannot be
  // resolved when the deployment hosts more than one workshop.
  const publicSurveyUrl = `${window.location.origin}${stats?.workshop?.surveyPath || '/survey'}`;

  return (
    <div style={{ padding: '0 0 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0 }}>{t('customerFeedback.title')}</h1>
          <p style={{ fontSize: 13.5, color: '#64748b', margin: '4px 0 0' }}>
            {t('customerFeedback.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={load} style={st.ghostBtn}><Refresh width={15} height={15} /> {t('common.refresh')}</button>
          <button onClick={exportXlsx} disabled={exporting} style={st.ghostBtn}>
            <Download width={15} height={15} />
            {exporting ? t('customerFeedback.exporting') : t('customerFeedback.export_excel')}
          </button>
          <button
            onClick={() => { setQrModal(publicSurveyUrl); setQrCopied(false); }}
            style={st.ghostBtn}
          >
            <QrCode width={15} height={15} /> {t('customerFeedback.public_link')}
          </button>
          <button
            onClick={() => setCompose({ contact_name: '', contact_phone: '', branch: '', channel: 'whatsapp' })}
            style={st.primaryBtn}
          >
            <LinkIcon width={15} height={15} /> {t('customerFeedback.send_to_customer')}
          </button>
        </div>
      </div>

      {error && (
        <div style={st.errorBar}>
          <WarningTriangle width={16} height={16} /> {error}
          <button onClick={() => setError('')} style={st.barClose}><Xmark width={14} height={14} /></button>
        </div>
      )}

      {inviteLink && (
        <div style={st.linkBar}>
          <CheckCircle width={16} height={16} color={GREEN} />
          <span style={{ fontWeight: 600 }}>{t('customerFeedback.link_ready')}</span>
          <code style={st.code}>{inviteLink}</code>
          <button
            onClick={() => { navigator.clipboard?.writeText(inviteLink); setCopied(true); }}
            style={st.ghostBtn}
          >
            <Copy width={14} height={14} /> {copied ? t('common.copied') : t('common.copy')}
          </button>
          <button onClick={() => setLink(null)} style={st.barClose}><Xmark width={14} height={14} /></button>
        </div>
      )}

      {/* ── Headline scores ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
        <KPICard
          icon={StatsUpSquare}
          label={t('customerFeedback.kpi_nps')}
          value={h.nps === null || h.nps === undefined ? '—' : h.nps}
          sub={SHOW_KPI_SUBTEXT ? t('customerFeedback.kpi_nps_sub', { count: h.npsScored || 0 }) : undefined}
          color={npsColor(h.nps)}
        />
        <KPICard
          icon={EmojiSatisfied}
          label={t('customerFeedback.kpi_csat')}
          value={h.csatAvg ? `${h.csatAvg} / 5` : '—'}
          sub={SHOW_KPI_SUBTEXT ? t('customerFeedback.kpi_csat_sub', { pct: h.csatPercent || 0 }) : undefined}
          color={scoreColor(h.csatAvg)}
        />
        <KPICard
          icon={Flash}
          label={t('customerFeedback.kpi_ces')}
          value={h.cesAvg ? `${h.cesAvg} / 5` : '—'}
          sub={SHOW_KPI_SUBTEXT ? t('customerFeedback.kpi_ces_sub', { pct: h.cesEasyPercent || 0 }) : undefined}
          color={scoreColor(h.cesAvg)}
        />
        <KPICard
          icon={CheckCircle}
          label={t('customerFeedback.kpi_resolved')}
          value={`${rz.resolvedPercent || 0}%`}
          sub={SHOW_KPI_SUBTEXT ? t('customerFeedback.kpi_resolved_sub', { partially: rz.partially || 0, no: rz.no || 0 }) : undefined}
          color={scoreColor((rz.resolvedPercent || 0) / 20)}
        />
        <KPICard
          icon={WarningTriangle}
          label={t('customerFeedback.kpi_followup')}
          value={h.needsFollowUp || 0}
          sub={SHOW_KPI_SUBTEXT ? t('customerFeedback.kpi_followup_sub') : undefined}
          color={Number(h.needsFollowUp) > 0 ? RED : '#94a3b8'}
        />
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      {/* The search box only narrows the responses table, so it is tied to it;
          with both hidden this card would otherwise render empty. */}
      {/* Arriving from a dashboard drill-down applies filters the controls
          for which are hidden (SHOW_FILTERS), so say what's being narrowed
          and give a way out — otherwise the list silently shows a subset. */}
      {!SHOW_FILTERS && (filters.category || filters.branch || filters.flagged) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          margin: '0 0 14px', padding: '10px 14px', borderRadius: 9,
          background: '#eef5ff', border: '1px solid #d6e4fb', fontSize: 13, color: '#1e3a6b' }}>
          <span>
            {t('customerFeedback.filtered_to')}{' '}
            <strong>
              {[filters.category && t(`customerFeedback.cat_${filters.category}`),
                filters.branch,
                filters.flagged === '1' && t('customerFeedback.filtered_flagged')]
                .filter(Boolean).join(' · ')}
            </strong>
            {filters.from && filters.to ? ` · ${filters.from} → ${filters.to}` : ''}
          </span>
          <button
            onClick={() => setFilters({ from: '', to: '', branch: '', category: '', flagged: '' })}
            style={{ marginInlineStart: 'auto', border: '1px solid #c7dbf8', background: '#fff',
              borderRadius: 7, padding: '5px 11px', fontSize: 12.5, fontWeight: 600,
              color: '#1e3a6b', cursor: 'pointer' }}>
            {t('customerFeedback.show_all')}
          </button>
        </div>
      )}

      {(SHOW_FILTERS || SHOW_ALL_RESPONSES) && (
      <Card>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {SHOW_FILTERS && (<>
          <label style={st.field}>
            <span style={st.fieldLabel}>{t('customerFeedback.filter_from')}</span>
            <input type="date" value={filters.from} style={st.input}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </label>
          <label style={st.field}>
            <span style={st.fieldLabel}>{t('customerFeedback.filter_to')}</span>
            <input type="date" value={filters.to} style={st.input}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </label>
          <label style={st.field}>
            <span style={st.fieldLabel}>{t('customerFeedback.filter_branch')}</span>
            <select value={filters.branch} style={st.input}
              onChange={e => setFilters(f => ({ ...f, branch: e.target.value }))}>
              <option value="">{t('customerFeedback.filter_all_branches')}</option>
              {(stats?.byBranch || []).map(b => (
                <option key={b.branch} value={b.branch === 'Unspecified' ? '' : b.branch}>{b.branch}</option>
              ))}
            </select>
          </label>
          <label style={st.field}>
            <span style={st.fieldLabel}>{t('customerFeedback.filter_category')}</span>
            <select value={filters.category} style={st.input}
              onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
              <option value="">{t('common.all')}</option>
              <option value="promoter">{t('customerFeedback.filter_promoters')}</option>
              <option value="passive">{t('customerFeedback.filter_passives')}</option>
              <option value="detractor">{t('customerFeedback.filter_detractors')}</option>
            </select>
          </label>
          <button
            onClick={() => setFilters(f => ({ ...f, flagged: f.flagged === '1' ? '' : '1' }))}
            style={filters.flagged === '1' ? st.toggleOn : st.toggleOff}
          >
            <WarningTriangle width={14} height={14} /> {t('customerFeedback.filter_followup_only')}
          </button>
          </>)}
          <div style={{ flex: 1 }} />
          {SHOW_ALL_RESPONSES && (
          <div style={{ position: 'relative', minWidth: 210 }}>
            <Search width={15} height={15} color="#94a3b8"
              style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              placeholder={t('customerFeedback.search_placeholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...st.input, width: '100%', paddingLeft: 34, boxSizing: 'border-box' }}
            />
          </div>
          )}
        </div>
      </Card>
      )}

      {loading && <Card><div style={{ color: '#94a3b8', fontSize: 13 }}>{t('common.loading')}</div></Card>}

      {!loading && stats && (
        <>
          {/* ── NPS split ────────────────────────────────────────────── */}
          <Card
            title={t('customerFeedback.nps_breakdown')}
            subtitle={t('customerFeedback.nps_breakdown_sub')}
          >
            {h.npsScored ? (
              <>
                <div style={{ display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                  {[
                    ['promoter', nb.promoterPct, nb.promoters],
                    ['passive', nb.passivePct, nb.passives],
                    ['detractor', nb.detractorPct, nb.detractors],
                  ].map(([k, pct, n]) => pct > 0 && (
                    <div key={k} title={`${t('customerFeedback.cat_' + k)}: ${n} (${pct}%)`}
                      style={{ width: `${pct}%`, background: CATEGORY[k].color, color: '#fff',
                        fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center',
                        justifyContent: 'center' }}>
                      {pct >= 8 ? `${pct}%` : ''}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  {['promoter', 'passive', 'detractor'].map(k => (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: CATEGORY[k].color }} />
                      <span style={{ color: '#475569' }}>{t('customerFeedback.cat_' + k)}</span>
                      <strong style={{ color: '#1e293b' }}><Num>{nb[`${k}s`] ?? 0}</Num></strong>
                      <span style={{ color: '#94a3b8' }}><Num>{`(${nb[`${k}Pct`] ?? 0}%)`}</Num></span>
                    </div>
                  ))}
                </div>
              </>
            ) : <div style={st.empty}>{t('customerFeedback.no_scored')}</div>}
          </Card>

          {/* ── Per-question averages ────────────────────────────────── */}
          <Card title={t('customerFeedback.score_by_question')} subtitle={t('customerFeedback.score_by_question_sub')}>
            {h.responses ? (stats.questions || []).map(q => (
              <Bar
                key={q.key}
                label={`[${q.section}] ${t('customerFeedback.q_' + q.key, { defaultValue: q.label })}`}
                value={q.avg}
                max={5}
                display={q.avg === null ? '—' : `${q.avg} / 5`}
                color={scoreColor(q.avg)}
              />
            )) : <div style={st.empty}>{t('customerFeedback.no_responses')}</div>}
          </Card>

          {/* ── Branch / service breakdown ───────────────────────────── */}
          {(SHOW_BY_BRANCH || SHOW_BY_SERVICE) && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {SHOW_BY_BRANCH && (
            <div style={{ flex: '1 1 340px' }}>
              <Card title={t('customerFeedback.by_branch')} subtitle={t('customerFeedback.by_branch_sub')}>
                {(stats.byBranch || []).length ? (
                  <table style={st.table}>
                    <thead><tr>
                      <th style={st.th}><Building width={13} height={13} /> {t('customerFeedback.col_branch')}</th>
                      <th style={st.thNum}>n</th><th style={st.thNum}>NPS</th><th style={st.thNum}>CSAT</th>
                    </tr></thead>
                    <tbody>
                      {stats.byBranch.map(b => (
                        <tr key={b.branch}>
                          <td dir="auto" style={st.td}>{b.branch}</td>
                          <td style={st.tdNum}><Num>{b.responses}</Num></td>
                          <td style={{ ...st.tdNum, color: npsColor(b.nps), fontWeight: 800 }}>
                            <Num>{b.nps === null ? '—' : b.nps}</Num>
                          </td>
                          <td style={{ ...st.tdNum, color: scoreColor(b.csat_avg), fontWeight: 700 }}>
                            <Num>{b.csat_avg ?? '—'}</Num>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div style={st.empty}>{t('customerFeedback.no_data')}</div>}
              </Card>
            </div>
            )}
            {SHOW_BY_SERVICE && (
            <div style={{ flex: '1 1 340px' }}>
              <Card title={t('customerFeedback.by_service')} subtitle={t('customerFeedback.by_service_sub')}>
                {(stats.byService || []).length ? (
                  <table style={st.table}>
                    <thead><tr>
                      <th style={st.th}><Wrench width={13} height={13} /> {t('customerFeedback.col_service')}</th>
                      <th style={st.thNum}>n</th><th style={st.thNum}>NPS</th><th style={st.thNum}>CSAT</th>
                    </tr></thead>
                    <tbody>
                      {stats.byService.map(s => (
                        <tr key={s.service}>
                          <td dir="auto" style={st.td}>{s.service}</td>
                          <td style={st.tdNum}><Num>{s.responses}</Num></td>
                          <td style={{ ...st.tdNum, color: npsColor(s.nps), fontWeight: 800 }}>
                            <Num>{s.nps === null ? '—' : s.nps}</Num>
                          </td>
                          <td style={{ ...st.tdNum, color: scoreColor(s.csat_avg), fontWeight: 700 }}>
                            <Num>{s.csat_avg ?? '—'}</Num>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div style={st.empty}>{t('customerFeedback.no_data')}</div>}
              </Card>
            </div>
            )}
          </div>
          )}

          {/* ── Trend ───────────────────────────────────────────────── */}
          {SHOW_TREND && (stats.trend || []).length > 1 && (
            <Card title={t('customerFeedback.trend')} subtitle={t('customerFeedback.trend_sub')}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', overflowX: 'auto', paddingBottom: 4 }}>
                {stats.trend.map(m => {
                  // NPS spans -100..100; map onto a 0..100% column height.
                  const height = m.nps === null ? 0 : Math.max(2, ((m.nps + 100) / 200) * 100);
                  return (
                    <div key={m.month} style={{ minWidth: 54, textAlign: 'center' }}>
                      <div style={{ height: 92, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                        <div
                          title={`NPS ${m.nps ?? '—'} · CSAT ${m.csat_avg ?? '—'} · ${m.responses} responses`}
                          style={{ width: 24, height: `${height}%`, background: npsColor(m.nps),
                            borderRadius: '5px 5px 0 0', minHeight: 3 }}
                        />
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: npsColor(m.nps), marginTop: 5 }}>
                        <Num>{m.nps ?? '—'}</Num>
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}><Num>{m.month?.slice(2)}</Num></div>
                      <div style={{ fontSize: 9.5, color: '#cbd5e1' }}><Num>{`n=${m.responses}`}</Num></div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── Verbatims ───────────────────────────────────────────── */}
          <Card
            title={t('customerFeedback.verbatims')}
            subtitle={t('customerFeedback.verbatims_sub')}
          >
            {(stats.verbatims || []).length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {stats.verbatims.map(v => {
                  const c = CATEGORY[v.nps_category] || CATEGORY.passive;
                  return (
                    <div key={v.id} onClick={() => openDetail(v.id)}
                      style={{ border: '1px solid #e8edf1', borderLeft: `3px solid ${c.color}`,
                        borderRadius: 9, padding: '11px 13px', cursor: 'pointer', background: '#fcfdfe' }}>
                      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ ...st.chip, background: c.bg, color: c.color }}>
                          {t('customerFeedback.cat_' + v.nps_category)} · <Num>{v.nps_score}</Num>
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
                          {v.contact_name || t('customerFeedback.anonymous')}
                        </span>
                        {v.branch && <span style={{ fontSize: 11.5, color: '#94a3b8' }}>· {v.branch}</span>}
                        {v.service_requested && <span style={{ fontSize: 11.5, color: '#94a3b8' }}>· {v.service_requested}</span>}
                        <span style={{ fontSize: 11.5, color: '#cbd5e1', marginInlineStart: 'auto' }}>{fmtDate(v.submitted_at, i18n.language)}</span>
                      </div>
                      <div dir="auto" style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                        <MessageText width={13} height={13} style={{ verticalAlign: -2, marginRight: 5, color: '#cbd5e1' }} />
                        {v.nps_reason}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <div style={st.empty}>{t('customerFeedback.no_comments')}</div>}
          </Card>

          {/* ── All responses ───────────────────────────────────────── */}
          {SHOW_ALL_RESPONSES && (
          <Card
            title={t('customerFeedback.all_responses')}
            subtitle={search
              ? t('customerFeedback.shown_of', { count: visible.length, total: rows.length })
              : t('customerFeedback.shown', { count: visible.length })}
          >
            {visible.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={st.table}>
                  <thead><tr>
                    <th style={st.th}>{t('common.customer')}</th>
                    <th style={st.th}>{t('customerFeedback.col_branch_service')}</th>
                    <th style={st.thNum}>NPS</th>
                    <th style={st.thNum}>CSAT</th>
                    <th style={st.thNum}>CES</th>
                    <th style={st.th}>{t('customerFeedback.col_resolved')}</th>
                    <th style={st.th}>{t('customerFeedback.col_received')}</th>
                    <th style={st.th}></th>
                  </tr></thead>
                  <tbody>
                    {visible.map(r => {
                      const c = CATEGORY[r.nps_category];
                      const rr = RESOLUTION[r.resolution];
                      // Coerce: is_flagged arrives as 0/1, and a bare 0 would render as "0".
                      const needsFollowUp = Boolean(r.is_flagged) && !r.followed_up_at;
                      return (
                        <tr key={r.id} style={needsFollowUp ? { background: '#fffbfa' } : undefined}>
                          <td style={st.td}>
                            <div style={{ fontWeight: 700, color: '#1e293b' }}>{r.contact_name || t('customerFeedback.anonymous')}</div>
                            <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                              {r.contact_phone || (r.work_order_number ? r.work_order_number : '—')}
                            </div>
                          </td>
                          <td style={st.td}>
                            <div>{r.branch || '—'}</div>
                            <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{r.service_requested || '—'}</div>
                          </td>
                          <td style={st.tdNum}>
                            {c ? <span style={{ ...st.chip, background: c.bg, color: c.color }}><Num>{r.nps_score}</Num></span> : '—'}
                          </td>
                          <td style={{ ...st.tdNum, color: scoreColor(r.csat_avg), fontWeight: 700 }}><Num>{r.csat_avg ?? '—'}</Num></td>
                          <td style={{ ...st.tdNum, color: scoreColor(r.ces_avg), fontWeight: 700 }}><Num>{r.ces_avg ?? '—'}</Num></td>
                          <td style={st.td}>
                            {rr ? <span style={{ color: rr.color, fontWeight: 600, fontSize: 12 }}>{t('customerFeedback.res_' + r.resolution)}</span> : '—'}
                          </td>
                          <td style={{ ...st.td, whiteSpace: 'nowrap', color: '#64748b', fontSize: 12 }}>
                            {fmtDate(r.submitted_at, i18n.language)}
                          </td>
                          <td style={st.td}>
                            {needsFollowUp && (
                              <span style={{ ...st.chip, background: '#fee2e2', color: RED }}>{t('customerFeedback.chip_followup')}</span>
                            )}
                            <button onClick={() => openDetail(r.id)} style={st.linkBtn}>{t('common.view')}</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={st.empty}>
                {t('customerFeedback.empty_share')}
                <code style={{ ...st.code, marginLeft: 8 }}>{publicSurveyUrl}</code>
              </div>
            )}
          </Card>
          )}
        </>
      )}

      {/* ── Compose a personalised survey link ────────────────────────── */}
      {compose && (
        <div style={st.overlay} onClick={() => setCompose(null)}>
          <form style={{ ...st.modal, maxWidth: 460 }} onClick={e => e.stopPropagation()} onSubmit={createLink}>
            <div style={st.modalHead}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: NAVY }}>{t('customerFeedback.compose_title')}</h3>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: '#94a3b8' }}>
                  {t('customerFeedback.compose_sub')}
                </p>
              </div>
              <button type="button" onClick={() => setCompose(null)} style={st.barClose}>
                <Xmark width={16} height={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={st.field}>
                <span style={st.fieldLabel}>{t('customerFeedback.compose_name')}</span>
                <input
                  autoFocus
                  style={st.input}
                  value={compose.contact_name}
                  onChange={e => setCompose(c => ({ ...c, contact_name: e.target.value }))}
                  placeholder={t('customerFeedback.compose_name_ph')}
                />
              </label>
              <label style={st.field}>
                <span style={st.fieldLabel}>{t('customerFeedback.compose_phone')}</span>
                <input
                  style={st.input}
                  value={compose.contact_phone}
                  onChange={e => setCompose(c => ({ ...c, contact_phone: e.target.value }))}
                  placeholder="+971 50 123 4567"
                />
              </label>
              <label style={st.field}>
                <span style={st.fieldLabel}>{t('customerFeedback.compose_branch')}</span>
                <input
                  style={st.input}
                  value={compose.branch}
                  onChange={e => setCompose(c => ({ ...c, branch: e.target.value }))}
                  placeholder={t('customerFeedback.compose_branch_ph')}
                />
              </label>
              <span style={{ fontSize: 11.5, color: '#94a3b8' }}>
                {t('customerFeedback.compose_hint')}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button type="submit" style={st.primaryBtn} disabled={creating}>
                <LinkIcon width={15} height={15} /> {creating ? t('customerFeedback.compose_creating') : t('customerFeedback.compose_create')}
              </button>
              <button type="button" onClick={() => setCompose(null)} style={st.ghostBtn}>{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Response detail ───────────────────────────────────────────── */}
      {detail && (
        <div style={st.overlay} onClick={() => setDetail(null)}>
          <div style={st.modal} onClick={e => e.stopPropagation()}>
            <div style={st.modalHead}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: NAVY }}>
                  {detail.contact_name || t('customerFeedback.anonymous')}
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: '#94a3b8' }}>
                  {[detail.work_order_number, detail.branch, detail.service_requested]
                    .filter(Boolean).join(' · ') || t('customerFeedback.detail_no_visit')} · {fmtDate(detail.submitted_at, i18n.language)}
                </p>
              </div>
              <button onClick={() => setDetail(null)} style={st.barClose}><Xmark width={16} height={16} /></button>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              {[
                ['NPS', detail.nps_score, npsColor(detail.nps_score >= 9 ? 60 : detail.nps_score >= 7 ? 10 : -40)],
                ['CSAT', detail.csat_avg ? `${detail.csat_avg}/5` : '—', scoreColor(detail.csat_avg)],
                ['CES', detail.ces_avg ? `${detail.ces_avg}/5` : '—', scoreColor(detail.ces_avg)],
              ].map(([l, v, col]) => (
                <div key={l} style={{ flex: 1, minWidth: 90, border: '1px solid #e8edf1', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700, letterSpacing: 0.3 }}>{l}</div>
                  <div style={{ fontSize: 19, fontWeight: 900, color: col }}><Num>{v ?? '—'}</Num></div>
                </div>
              ))}
            </div>

            {['CES', 'NPS', 'CSAT'].map(section => {
              const items = (detail.answers || []).filter(a => a.section === section);
              if (!items.length) return null;
              return (
                <div key={section} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: TEAL, letterSpacing: 0.5, marginBottom: 8 }}>
                    {section}
                  </div>
                  {items.map(a => (
                    <div key={a.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 14,
                      padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12.5 }}>
                      <span dir="auto" style={{ color: '#475569', lineHeight: 1.4 }}>{t('customerFeedback.q_' + a.key, { defaultValue: a.label })}</span>
                      <span style={{ fontWeight: 700, color: '#1e293b', whiteSpace: a.max ? 'nowrap' : 'normal',
                        textAlign: 'right', maxWidth: a.max ? undefined : '55%' }}>
                        {a.value === null || a.value === undefined || a.value === ''
                          ? '—'
                          : a.max ? <Num>{`${a.value} / ${a.max}`}</Num>
                          : (a.key === 'resolution' ? t('customerFeedback.res_' + a.value) : <span dir="auto">{String(a.value)}</span>)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}

            {detail.is_flagged === 1 && !detail.followed_up_at && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 9,
                padding: '11px 13px', marginTop: 6 }}>
                <div style={{ fontSize: 12.5, color: '#9a3412', marginBottom: 9 }}>
                  {t('customerFeedback.detail_flagged')}
                </div>
                <textarea
                  value={followUpNote}
                  onChange={e => setFollowUpNote(e.target.value)}
                  placeholder={t('customerFeedback.detail_outcome_placeholder')}
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', marginBottom: 9, padding: '9px 11px',
                    border: '1px solid #fed7aa', borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
                    resize: 'vertical', background: '#fff' }}
                />
                <button onClick={() => markFollowedUp(detail.id, followUpNote)} style={st.primaryBtn}>
                  <CheckCircle width={15} height={15} /> {t('customerFeedback.detail_mark_followed')}
                </button>
              </div>
            )}
            {detail.followed_up_at && (
              <div>
                <div style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>
                  <CheckCircle width={13} height={13} style={{ verticalAlign: -2 }} /> {t('customerFeedback.detail_followed_on', { date: fmtDate(detail.followed_up_at, i18n.language) })}
                </div>
                {detail.follow_up_notes && (
                  <div style={{ marginTop: 6, padding: '9px 11px', background: '#f4faf7',
                    border: '1px solid #dcefe4', borderRadius: 8, fontSize: 12.5, color: '#14503d' }}>
                    <strong style={{ display: 'block', marginBottom: 2 }}>{t('customerFeedback.detail_outcome')}</strong>
                    {detail.follow_up_notes}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Public survey QR code modal ───────────────────────────────── */}
      {qrModal && (
        <div style={st.overlay} onClick={() => setQrModal(null)}>
          <div style={{ ...st.modal, maxWidth: 380, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ ...st.modalHead, justifyContent: 'flex-end' }}>
              <button onClick={() => setQrModal(null)} style={st.barClose}><Xmark width={18} height={18} /></button>
            </div>
            <QrCode width={32} height={32} color={NAVY} style={{ marginBottom: 8 }} />
            <h3 style={{ fontSize: 17, fontWeight: 800, color: NAVY, margin: '0 0 4px' }}>
              {t('customerFeedback.qr_title')}
            </h3>
            <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 20px' }}>
              {t('customerFeedback.qr_subtitle')}
            </p>
            <canvas
              ref={qrCanvasRef}
              style={{ borderRadius: 12, border: '1px solid #e2e8f0', display: 'block', margin: '0 auto' }}
            />
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <code style={{ ...st.code, maxWidth: '100%', display: 'block', wordBreak: 'break-all' }}>{qrModal}</code>
              <button
                onClick={() => { navigator.clipboard?.writeText(qrModal); setQrCopied(true); setTimeout(() => setQrCopied(false), 2000); }}
                style={st.ghostBtn}
              >
                <Copy width={14} height={14} />
                {qrCopied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const st = {
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, background: NAVY, color: '#fff',
    border: 'none', borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  ghostBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#475569',
    border: '1px solid #dbe3ea', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  linkBtn: { background: 'none', border: 'none', color: NAVY, fontSize: 12, fontWeight: 700,
    cursor: 'pointer', padding: '2px 6px', textDecoration: 'underline' },
  toggleOn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fee2e2', color: RED,
    border: '1px solid #fca5a5', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  toggleOff: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#64748b',
    border: '1px solid #dbe3ea', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  errorBar: { display: 'flex', alignItems: 'center', gap: 9, background: '#fef2f2', border: '1px solid #fecaca',
    color: '#b91c1c', borderRadius: 10, padding: '11px 14px', fontSize: 13, marginBottom: 16 },
  linkBar: { display: 'flex', alignItems: 'center', gap: 10, background: '#f0fdf4', border: '1px solid #bbf7d0',
    color: '#166534', borderRadius: 10, padding: '11px 14px', fontSize: 13, marginBottom: 16, flexWrap: 'wrap' },
  barClose: { marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.7 },
  code: { background: '#fff', border: '1px solid #d7e3da', borderRadius: 6, padding: '3px 8px',
    fontSize: 12, fontFamily: 'ui-monospace, monospace', color: '#334155', wordBreak: 'break-all' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 11.5, fontWeight: 700, color: '#64748b' },
  input: { border: '1px solid #dbe3ea', borderRadius: 8, padding: '8px 11px', fontSize: 13, color: '#1e293b', background: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase',
    letterSpacing: 0.4, padding: '0 10px 9px', borderBottom: '1px solid #eef2f5', whiteSpace: 'nowrap' },
  thNum: { textAlign: 'center', fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase',
    letterSpacing: 0.4, padding: '0 10px 9px', borderBottom: '1px solid #eef2f5' },
  td: { padding: '10px', borderBottom: '1px solid #f4f7f9', color: '#334155', verticalAlign: 'middle' },
  tdNum: { padding: '10px', borderBottom: '1px solid #f4f7f9', textAlign: 'center', verticalAlign: 'middle' },
  chip: { display: 'inline-block', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 800 },
  empty: { color: '#94a3b8', fontSize: 13, padding: '10px 0' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 16, padding: '20px 22px', width: '100%', maxWidth: 560,
    boxShadow: '0 20px 50px rgba(0,0,0,0.25)' },
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
};
