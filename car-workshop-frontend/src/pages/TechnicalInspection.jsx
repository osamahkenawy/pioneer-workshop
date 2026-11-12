/**
 * Technical Inspection — Step 4 (client review, 2 Nov 2026; client meeting,
 * 3 Nov 2026). Once the job card is open, the Supervisor or Workshop Foreman
 * inspects the car and writes the technical report: the service lines — each
 * a job / service (picked from lib/serviceJobs.js, or typed under "Other"),
 * its service type (required on every line), the labour and its parts (part
 * number, quantity). Completing it tells the Service Advisor, who raises the
 * estimate from it (the estimate form is pre-filled from the lines: the
 * advisor prices the labour, the parts go to the Store). Printed, this page
 * IS the technical report.
 *
 * There is no findings field since 3 Nov 2026; a report that has findings
 * from before shows them read-only.
 *
 * Completed, the report goes to the customer: "Send to the customer"
 * (WhatsApp / e-mail / copy link, as on the vehicle inspection) sends the
 * link made at completion — their copy shows only the jobs, service types,
 * labour and the parts' names (no hours, quantities or part numbers):
 * /technical-report/:token (TechnicalReportLink.jsx), and the job's page in
 * the customer portal.
 *
 * /work-orders/:id/technical-inspection — reached from the job card workflow
 * (Step 4) and the advisor's "Technical report ready" notification. Backend:
 * routes/technical-inspections.js (GET ?work_order_id=, POST, PUT /:id,
 * PATCH /:id/complete, PATCH /:id/reopen, GET/POST /:id/share,
 * POST /:id/share/reset).
 *
 * Written by the roles with tech.inspect (the server says: you.can_inspect);
 * everyone else reads it — technicians too, on their own jobs (Protected lets
 * them in; the server leaves out the customer's name for them). "Edit again"
 * is possible until an estimate has been raised. The fields are a first
 * version: the client is still settling them.
 *
 * Words: t('techinsp.*', 'English default').
 */
import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Check, Printer, Plus, Trash, WarningTriangle, EditPencil, NavArrowRight, Page, Whatsapp, SendMail, Copy, OpenNewWindow,
} from 'iconoir-react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { canDo } from '../lib/permissions';
import { hasModule, isTechnician } from '../lib/modules';
import { JOB_TYPES, jobTypeLabel } from '../lib/intakeOptions';
import { SERVICE_JOBS, isListedJob } from '../lib/serviceJobs';

// The server's limits (routes/technical-inspections.js).
const MAX = { lines: 50, job: 200, labour: 500, hours: 999, parts: 30, description: 200, part_number: 100, quantity: 9999, notes: 1000 };

const LBL = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 };
const INPUT = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit' };
const CARD = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 };
const BTN = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent' };
const H2 = { margin: 0, fontSize: 15, fontWeight: 800, color: '#1e3a6b' };
const ICON_BTN = { ...BTN, padding: '7px 9px', background: '#fff', color: '#dc2626', borderColor: '#fecaca' };
const ADD_BTN = { ...BTN, padding: '7px 12px', background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe', marginTop: 8 };
const BAD = { borderColor: '#dc2626', boxShadow: '0 0 0 3px rgba(220,38,38,.12)' };
// The job select's "Other — type it" entry (a job not on lib/serviceJobs.js).
const OTHER = '__other';

// Responsive layout and the print-out (the report). Inline styles elsewhere,
// as on the vehicle inspection page.
const PAGE_CSS = `
  .ti-page { padding: 20px; max-width: 1100px; margin: 0 auto; box-sizing: border-box; }
  .ti-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: -6px 0 14px; padding: 6px 0 10px; background: #f5f7fa; }
  .ti-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px 16px; }
  .ti-wide { grid-column: 1 / -1; }
  .ti-val { font-size: 14px; font-weight: 600; color: #0f172a; overflow-wrap: anywhere; white-space: pre-wrap; }
  .ti-line { position: relative; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 12px; background: #fff; }
  .ti-line-head { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; padding-inline-end: 46px; }
  .ti-line-del { position: absolute; inset-block-start: 12px; inset-inline-end: 12px; }
  .ti-line-no { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; inline-size: 26px; block-size: 26px; border-radius: 50%;
    background: #1e3a6b; color: #fff; font-size: 12.5px; font-weight: 800; margin-block-end: 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ti-f-job { flex: 3 1 240px; min-width: 0; }
  .ti-f-type { flex: 1 1 150px; min-width: 130px; }
  .ti-f-hours { flex: 0 1 100px; min-width: 80px; }
  .ti-part-head, .ti-part-row { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 1.4fr) 92px 40px; gap: 8px; align-items: center; }
  .ti-part-head { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .3px; margin-block-end: 4px; }
  .ti-part-row { margin-block-end: 6px; }
  .ti-line-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .ti-line-title .ti-line-no { margin: 0; }
  .ti-type { padding: 2px 9px; border-radius: 999px; background: #fff7ed; color: #c2410c; font-size: 11.5px; font-weight: 700; }
  .ti-hours { font-size: 12.5px; font-weight: 700; color: #475569; }
  .ti-kv { margin: 8px 0 0; font-size: 13.5px; color: #0f172a; white-space: pre-wrap; overflow-wrap: anywhere; }
  .ti-kv b { display: inline-block; min-inline-size: 64px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; }
  .ti-parts { inline-size: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; table-layout: fixed; }
  .ti-parts th:nth-child(2) { inline-size: 34%; }
  .ti-parts th { text-align: start; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .3px; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  .ti-parts td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; overflow-wrap: anywhere; }
  .ti-parts .num { text-align: end; inline-size: 70px; }
  .ti-chip { display: inline-block; margin-inline-start: 8px; padding: 2px 10px; border-radius: 12px; font-weight: 700; font-size: 11px; text-transform: uppercase; vertical-align: 1px; }
  .ti-print-only { display: none; }
  .ti-sign { display: grid; grid-template-columns: 2fr 1fr; gap: 28px; margin-top: 36px; font-size: 12px; color: #475569; }
  .ti-sign span { border-top: 1px solid #64748b; padding-top: 6px; }
  @media screen {
    .ti-bar { position: sticky; top: var(--topbar-height, 70px); z-index: 6; }
  }
  @media screen and (max-width: 600px) {
    .ti-page { padding: 16px 12px; }
    .ti-part-head { display: none; }
    .ti-part-row { grid-template-columns: minmax(0, 1fr) 84px 44px; margin-block-end: 10px; }
    .ti-part-row .ti-part-desc { grid-column: 1 / -1; }
  }
  /* Fingers need 44px targets. */
  @media screen and (max-width: 900px), (pointer: coarse) {
    .ti-page button { min-height: 44px; }
    .ti-page input, .ti-page select { min-height: 44px; }
  }
  @media print {
    body * { visibility: hidden !important; }
    .ti-page, .ti-page * { visibility: visible !important; }
    .ti-page { position: absolute; top: 0; left: 0; right: 0; padding: 0 !important; max-width: none; }
    .ti-no-print { display: none !important; }
    .ti-print-only { display: grid !important; }
    .ti-line { break-inside: avoid; }
    /* The app's frame is hidden, but its height would still add a blank page. */
    .main-content { min-height: 0 !important; padding: 0 !important; }
  }
`;

const when = d => (d ? new Date(String(d).replace(' ', 'T')).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Clipboard, with the old textarea fallback for http:// and older browsers.
 *  `text` may be a promise (the link still being made): the write is started
 *  at once, inside the click — Safari and iOS refuse one made after an await.
 *  (As VehicleInspection.jsx.) */
async function copyText(text) {
  try {
    if (typeof text === 'string') await navigator.clipboard.writeText(text);
    else await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(v => new Blob([v], { type: 'text/plain' })) })]);
    return true;
  } catch { /* fall back */ }
  let value;
  try { value = typeof text === 'string' ? text : await text; } catch { return false; }
  const ta = document.createElement('textarea');
  ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/* ── The form: the report's lines as edited on screen ─────────────────── */
let seq = 0;
const uid = () => `k${++seq}`;
const blankPart = () => ({ key: uid(), description: '', part_number: '', quantity: 1 });
// jobOther: the job is typed (not one of SERVICE_JOBS) — the select shows "Other — type it".
const blankLine = () => ({ key: uid(), job: '', jobOther: false, service_type: '', labour: '', hours: '', notes: '', parts: [blankPart()] });
const lineOf = l => ({
  key: uid(), job: l.job || '', jobOther: !!l.job && !isListedJob(l.job),
  service_type: l.service_type || '', labour: l.labour || '', hours: l.hours ?? '', notes: l.notes || '',
  parts: (l.parts || []).map(p => ({ key: uid(), description: p.description || '', part_number: p.part_number || '', quantity: p.quantity ?? 1 })),
});
/** The saved report as a form (one empty line to start with). */
function formOf(row) {
  const lines = (row?.service_lines || []).map(lineOf);
  return { lines: lines.length ? lines : [blankLine()] };
}
/** The form as the PUT body. Empty lines and part rows are dropped by the server. */
const bodyOf = form => ({
  service_lines: form.lines.map(l => ({
    job: l.job, service_type: l.service_type || null, labour: l.labour, hours: l.hours === '' ? null : l.hours, notes: l.notes,
    parts: l.parts.map(p => ({ description: p.description, part_number: p.part_number, quantity: p.quantity === '' ? null : p.quantity })),
  })),
});
const lineHasContent = l => [l.job, l.service_type, l.labour, l.notes, String(l.hours)].some(v => String(v || '').trim()) || l.parts.some(p => p.description.trim() || p.part_number.trim());
/** A line the estimate can be raised from: the job, and its labour or parts (the server's rule). */
const usableLine = l => !!l.job.trim() && (!!l.labour.trim() || l.parts.some(p => p.description.trim()));
/** What the lines still lack before they can be saved (the server's rules: every line
 *  with anything in it has its job and its service type): { [line key]: { job, type } }, and the first gap. */
function gapsOf(lines) {
  const gaps = {};
  let first = null;
  lines.forEach((l, i) => {
    if (!lineHasContent(l)) return;
    const g = { job: !l.job.trim(), type: !l.service_type };
    if (!g.job && !g.type) return;
    gaps[l.key] = g;
    if (!first) first = { n: i + 1, ...g };
  });
  return { gaps, first };
}

export default function TechnicalInspection() {
  const { t } = useTranslation();
  const { id } = useParams();                 // work order id
  const navigate = useNavigate();
  const { workshop, user } = useContext(AuthContext);

  const [loading, setLoading] = useState(true);
  const [wo, setWo] = useState(null);         // the report header (work order, job card, vehicle)
  const [inspection, setInspection] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [canInspect, setCanInspect] = useState(false);
  const [form, setForm] = useState(() => formOf(null));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');       // '' | 'start' | 'save' | 'complete' | 'reopen'
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [gaps, setGaps] = useState({});       // { [line key]: { job, type } } — outlined after a refused save
  // The customer's link (completed reports; null for technicians): { url, shared_at, shared_via, can_send, can_email, ... }
  const [share, setShare] = useState(null);
  const [sharing, setSharing] = useState(''); // '' | 'whatsapp' | 'email' | 'link' | 'reset'
  const [shareNote, setShareNote] = useState('');
  const [shareError, setShareError] = useState('');

  const apply = useCallback(row => { setInspection(row); setForm(formOf(row)); setDirty(false); setGaps({}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api.get(`/technical-inspections?work_order_id=${encodeURIComponent(id)}`);
      if (!r.success) { setError(r.message || t('techinsp.err_load', 'Could not load the technical inspection.')); return; }
      setWo(r.work_order); setEstimate(r.estimate || null); setCanInspect(!!r.you?.can_inspect); setShare(r.share || null);
      apply(r.data);
    } catch {
      setError(t('techinsp.err_network', 'Network error — check the connection.'));
    } finally {
      setLoading(false);
    }
    // t changes with the language only; reloading for it is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, apply]);
  useEffect(() => { load(); }, [load]);

  // Typed and not saved: the browser asks before the tab is closed or reloaded.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /* ── Editing ── */
  const edit = fn => { setForm(fn); setDirty(true); setNote(''); };
  // patch: { field: value, ... }. Filling in a job or a service type takes its outline off.
  const setLine = (key, patch) => {
    edit(f => ({ ...f, lines: f.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) }));
    if (gaps[key] && ('job' in patch || 'service_type' in patch)) {
      setGaps(g => ({ ...g, [key]: { job: g[key].job && !('job' in patch && String(patch.job).trim()), type: g[key].type && !patch.service_type } }));
    }
  };
  const patchParts = (key, fn) => edit(f => ({ ...f, lines: f.lines.map(l => (l.key === key ? { ...l, parts: fn(l.parts) } : l)) }));
  const addLine = () => edit(f => (f.lines.length >= MAX.lines ? f : { ...f, lines: [...f.lines, blankLine()] }));
  const removeLine = (line, n) => {
    if (lineHasContent(line) && !window.confirm(t('techinsp.confirm_remove_line', 'Remove service line {{n}}?', { n }))) return;
    edit(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter(l => l.key !== line.key) : [blankLine()] }));
  };

  /* ── Start / save / complete / edit again ── */
  // The server's answer (null on a network error); a refusal is shown in the bar.
  const run = async (kind, fn, fallback) => {
    setBusy(kind); setError(''); setNote('');
    try {
      const r = await fn();
      if (!r?.success) setError(r?.message || fallback);
      return r;
    } catch {
      setError(t('techinsp.err_network', 'Network error — check the connection.'));
      return null;
    } finally {
      setBusy('');
    }
  };
  const start = async () => {
    const r = await run('start', () => api.post('/technical-inspections', { work_order_id: Number(id) }), t('techinsp.err_start', 'Could not start the technical inspection.'));
    if (r?.success) apply(r.data);
  };
  // Every line with anything in it needs its job and its service type (the server refuses it too).
  const checkLines = () => {
    const { gaps: found, first } = gapsOf(form.lines);
    setGaps(found);
    if (!first) return true;
    setError(first.type && !first.job
      ? t('techinsp.err_type_n', 'Service line {{n}}: choose its service type.', { n: first.n })
      : first.job && !first.type
        ? t('techinsp.err_job_n', 'Service line {{n}}: choose or type the job / service.', { n: first.n })
        : t('techinsp.err_job_type_n', 'Service line {{n}}: choose the job / service and its service type.', { n: first.n }));
    setNote('');
    return false;
  };
  const save = async () => {
    if (!checkLines()) return false;
    const r = await run('save', () => api.put(`/technical-inspections/${inspection.id}`, bodyOf(form)), t('techinsp.err_save', 'Could not save the technical inspection.'));
    if (!r?.success) {
      // The server's own refusal names the line (its index among those sent).
      const bad = r?.line != null ? form.lines[r.line] : null;
      if (bad) setGaps({ [bad.key]: { job: !bad.job.trim(), type: r.code === 'SERVICE_TYPE_REQUIRED' || !bad.service_type } });
      return false;
    }
    // The form stays as typed (a line just added stays); the server dropped what was empty.
    setInspection(r.data); setDirty(false); setSavedAt(new Date());
    return true;
  };
  const complete = async () => {
    if (!checkLines()) return;
    if (!form.lines.some(usableLine)) {
      setError(t('techinsp.err_incomplete', 'Add at least one service line with the job and its labour or parts before completing the report.'));
      return;
    }
    if (!window.confirm(t('techinsp.confirm_complete', 'Complete the technical report? The Service Advisor is told to raise the estimate from it. It can still be edited until the estimate is raised.'))) return;
    if (!(await save())) return;
    const r = await run('complete', () => api.patch(`/technical-inspections/${inspection.id}/complete`), t('techinsp.err_complete', 'Could not complete the technical report.'));
    if (!r?.success) return;
    apply(r.data);
    if (r.share) setShare(r.share);
    setShareNote(''); setShareError('');
    setNote(r.share?.can_send
      ? t('techinsp.completed_note_send', "Report completed — the Service Advisor has been told to raise the estimate from it. The customer's copy is ready: send it below.")
      : t('techinsp.completed_note', 'Report completed — the Service Advisor has been told to raise the estimate from it.'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const reopen = async () => {
    const r = await run('reopen', () => api.patch(`/technical-inspections/${inspection.id}/reopen`), t('techinsp.err_reopen', 'Could not reopen the technical report.'));
    if (r?.success) apply(r.data);
    else if (r?.estimate) setEstimate(r.estimate);   // raised meanwhile: the buttons follow
  };
  /* ── Send to the customer (completed) ── */
  const shareVia = async (channel) => {
    setSharing(channel); setShareNote(''); setShareError('');
    // Opened now, while the click still counts as the user's — a window
    // opened after the request would be blocked as a pop-up. The copy too.
    const win = channel === 'whatsapp' ? window.open('', '_blank') : null;
    const sent = api.post(`/technical-inspections/${inspection.id}/share`, { channel });
    const copied = channel === 'link'
      ? copyText(share?.url || sent.then(r => (r.success ? r.url : Promise.reject(new Error(r.message)))))
      : null;
    try {
      const res = await sent;
      if (!res.success) {
        if (win) win.close();
        setShareError(res.message || t('techinsp.err_share', 'Could not send the report.'));
        // Reopened or cancelled meanwhile: bring the screen up to date.
        if (res.status === 409) load();
        return;
      }
      if (res.share) setShare(res.share);
      if (channel === 'whatsapp') {
        if (win) win.location.href = res.whatsapp_url; else window.open(res.whatsapp_url, '_blank');
        setShareNote(res.message || t('techinsp.share_whatsapp_opened', 'WhatsApp opened with the message — press send there.'));
      } else if (channel === 'email') {
        setShareNote(res.message || t('techinsp.share_email_sent', 'E-mail sent.'));
      } else {
        setShareNote(await copied
          ? t('techinsp.share_link_copied', 'Link copied — paste it to the customer.')
          : t('techinsp.share_link_copy_manually', 'Copy the link below and send it to the customer.'));
      }
    } catch (e) {
      if (win) win.close();
      setShareError(e.message || t('techinsp.err_share', 'Could not send the report.'));
    } finally {
      setSharing('');
    }
  };
  // A link that went to the wrong chat: replace it.
  const resetLink = async () => {
    if (!window.confirm(t('techinsp.reset_confirm', 'Make a new link? The current one stops working.'))) return;
    setSharing('reset'); setShareNote(''); setShareError('');
    try {
      const res = await api.post(`/technical-inspections/${inspection.id}/share/reset`);
      if (!res.success) { setShareError(res.message || t('techinsp.err_reset', 'Could not reset the link.')); return; }
      setShare(res.share);
      setShareNote(t('techinsp.reset_done', 'The old link no longer works. Send the customer the new link.'));
    } catch (e) {
      setShareError(e.message || t('techinsp.err_reset', 'Could not reset the link.'));
    } finally {
      setSharing('');
    }
  };

  const back = () => {
    if (dirty && !window.confirm(t('techinsp.confirm_leave', 'Leave without saving your changes?'))) return;
    navigate(`/work-orders/${id}`);
  };

  if (loading && !wo) return <div style={{ padding: 32, color: '#64748b' }}>{t('techinsp.loading', 'Loading the technical inspection…')}</div>;
  if (!wo) {
    return (
      <div style={{ padding: 32 }}>
        <p style={{ color: '#dc2626', marginBottom: 12 }}>{error || t('techinsp.unavailable', 'The technical inspection is not available.')}</p>
        <button style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => navigate(-1)}>
          <ArrowLeft width={14} height={14} /> {t('techinsp.back_plain', 'Back')}
        </button>
      </div>
    );
  }

  const completed = inspection?.status === 'completed';
  const woClosed = ['completed', 'cancelled'].includes(wo.status);
  const editable = !!inspection && !completed && canInspect && !woClosed;
  const lines = inspection?.service_lines || [];
  const vehicle = [wo.plate_number, [wo.make, wo.model].filter(Boolean).join(' '), wo.year].filter(Boolean).join(' · ');
  const mayRaise = canDo(user, 'estimate.raise') && !estimate && !woClosed;
  const sharedVia = v => ({
    whatsapp: t('techinsp.shared_via.whatsapp', 'WhatsApp'),
    email: t('techinsp.shared_via.email', 'e-mail'),
    link: t('techinsp.shared_via.link', 'copied link'),
  }[v] || v);

  return (
    <div className="ti-page">
      <style>{PAGE_CSS}</style>

      {/* ── Actions (not printed) ── */}
      <div className="ti-bar ti-no-print">
        <button style={{ ...BTN, background: '#fff', color: '#334155', borderColor: '#e2e8f0' }} onClick={back}>
          <ArrowLeft width={14} height={14} /> {isTechnician(user) ? t('techinsp.back_tech', 'My job card') : t('techinsp.back', 'Work order')}
        </button>
        <div style={{ flex: 1 }} />
        {editable && (dirty
          ? <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>{t('techinsp.unsaved', 'Unsaved changes')}</span>
          : savedAt && <span style={{ fontSize: 12, color: '#16a34a' }}>{t('techinsp.saved_at', 'Saved {{time}}', { time: savedAt.toLocaleTimeString() })}</span>)}
        {completed && (
          <button style={{ ...BTN, background: '#fff', color: '#334155', borderColor: '#e2e8f0' }} onClick={() => window.print()}>
            <Printer width={14} height={14} /> {t('techinsp.print', 'Print report')}
          </button>
        )}
        {editable && (
          <>
            <button disabled={!!busy} style={{ ...BTN, background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe' }} onClick={save}>
              <Check width={14} height={14} /> {busy === 'save' ? t('techinsp.saving', 'Saving…') : t('techinsp.save_draft', 'Save draft')}
            </button>
            <button disabled={!!busy} style={{ ...BTN, background: '#16a34a', color: '#fff' }} onClick={complete}>
              <Check width={14} height={14} /> {busy === 'complete' ? t('techinsp.completing', 'Completing…') : t('techinsp.complete', 'Complete the report')}
            </button>
          </>
        )}
        {completed && canInspect && !estimate && !woClosed && (
          <button disabled={!!busy} style={{ ...BTN, background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe' }} onClick={reopen}>
            <EditPencil width={14} height={14} /> {busy === 'reopen' ? t('techinsp.reopening', 'Reopening…') : t('techinsp.edit_again', 'Edit again')}
          </button>
        )}
        {completed && mayRaise && (
          <button style={{ ...BTN, background: '#ea580c', color: '#fff' }} onClick={() => navigate(`/estimates?new=1&wo=${id}`)}>
            {t('techinsp.raise_estimate', 'Raise the estimate from this report')} <NavArrowRight width={14} height={14} />
          </button>
        )}
        {estimate && hasModule(user, 'estimates') && (
          <button style={{ ...BTN, background: '#fff', color: '#c2410c', borderColor: '#fed7aa' }} onClick={() => navigate(`/estimates?id=${estimate.id}`)}>
            <Page width={14} height={14} /> {t('techinsp.open_estimate', 'Open estimate {{n}}', { n: estimate.estimate_number })}
          </button>
        )}
        {error && (
          <div role="alert" style={{ flexBasis: '100%', display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', borderRadius: 10,
            border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
            <WarningTriangle width={16} height={16} style={{ flexShrink: 0 }} /> {error}
          </div>
        )}
        {note && (
          <div role="status" style={{ flexBasis: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#15803d', fontSize: 13, fontWeight: 600 }}>
            {note}
          </div>
        )}
      </div>

      {/* ── Title block ── */}
      <div style={{ ...CARD, textAlign: 'center', paddingBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: '#1e3a6b' }}>
          {wo.workshop_name || workshop?.name || t('techinsp.workshop', 'Workshop')} <span style={{ color: '#0e7490' }}>— {t('techinsp.title', 'Technical inspection report')}</span>
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
          {t('techinsp.wo_n', 'Work order {{n}}', { n: wo.work_order_number })}
          {wo.job_card_number ? <>{' · '}{t('techinsp.jc_n', 'Job card {{n}}', { n: wo.job_card_number })}</> : null}
          {inspection && (completed
            ? <span className="ti-chip" style={{ background: '#dcfce7', color: '#15803d' }}>{t('techinsp.completed_badge', 'Completed')}</span>
            : <span className="ti-chip" style={{ background: '#fef3c7', color: '#b45309' }}>{t('techinsp.draft_badge', 'Draft')}</span>)}
        </p>
        {!canInspect && (
          <p className="ti-no-print" style={{ margin: '6px 0 0', fontSize: 12.5, color: '#64748b' }}>{t('techinsp.view_only', 'Recorded by the Supervisor / Foreman.')}</p>
        )}
      </div>

      {/* ── Send to the customer: their copy of the completed report ── */}
      {completed && share && (
        <div className="ti-no-print" style={{ ...CARD, padding: '14px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e3a6b' }}>{t('techinsp.share_title', 'Send to the customer')}</div>
              <div style={{ fontSize: 12.5, marginTop: 3, color: '#475569' }}>
                {t('techinsp.share_what', 'Their copy shows the jobs, service types, labour and the parts’ names — no hours, quantities or prices.')}
              </div>
              <div style={{ fontSize: 12, color: share.shared_at ? '#15803d' : '#b45309', fontWeight: 600, marginTop: 2 }}>
                {share.shared_at
                  ? t('techinsp.last_sent', 'Last sent: via {{channel}} · {{date}}', { channel: sharedVia(share.shared_via), date: when(share.shared_at) })
                  : t('techinsp.not_sent', 'Not sent yet.')}
              </div>
            </div>
            {share.work_order_cancelled ? (
              <span style={{ fontSize: 12.5, color: '#64748b' }}>{t('techinsp.share_wo_cancelled', 'Nothing is sent to the customer for a cancelled work order.')}</span>
            ) : !share.can_send ? (
              <span style={{ fontSize: 12.5, color: '#64748b' }}>{t('techinsp.share_advisor_only', 'The Service Advisor sends it to the customer.')}</span>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" disabled={!!sharing} style={{ ...BTN, background: '#16a34a', color: '#fff' }} onClick={() => shareVia('whatsapp')}>
                  <Whatsapp width={14} height={14} /> {sharing === 'whatsapp' ? t('techinsp.opening', 'Opening…') : t('techinsp.whatsapp', 'WhatsApp')}
                </button>
                <button type="button" disabled={!!sharing || !share.can_email}
                  title={!share.can_email ? t('techinsp.no_email', 'No e-mail on file for this customer') : undefined}
                  style={{ ...BTN, background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe', opacity: share.can_email ? 1 : 0.5 }}
                  onClick={() => shareVia('email')}>
                  <SendMail width={14} height={14} /> {sharing === 'email' ? t('techinsp.sending', 'Sending…') : t('techinsp.email', 'E-mail')}
                </button>
                <button type="button" disabled={!!sharing} style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => shareVia('link')}>
                  <Copy width={14} height={14} /> {t('techinsp.copy_link', 'Copy link')}
                </button>
              </div>
            )}
          </div>
          {share.can_send && !share.can_email && !share.work_order_cancelled && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>{t('techinsp.no_email_hint', 'No e-mail on file for this customer — add it on the work order, or use WhatsApp / the link.')}</p>
          )}
          {shareNote && <p role="status" style={{ margin: '8px 0 0', fontSize: 12.5, color: '#15803d', fontWeight: 600 }}>{shareNote}</p>}
          {shareError && <p role="alert" style={{ margin: '8px 0 0', fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{shareError}</p>}
          {share.can_send && share.url && !share.work_order_cancelled && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input readOnly aria-label={t('techinsp.customer_link', 'Customer link')} value={share.url} dir="ltr" onFocus={e => e.target.select()}
                style={{ ...INPUT, flex: '1 1 240px', minWidth: 0, fontSize: 12, color: '#475569', background: '#f8fafc' }} />
              <a href={share.url} target="_blank" rel="noopener noreferrer" title={t('techinsp.open_link_title', "What the customer sees")}
                style={{ ...BTN, padding: '7px 10px', background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe', textDecoration: 'none', flexShrink: 0 }}>
                <OpenNewWindow width={14} height={14} /> {t('techinsp.open_link', 'Open')}
              </a>
              <button type="button" disabled={!!sharing} title={t('techinsp.new_link_title', 'The current link stops working; the next send makes a new one')}
                style={{ ...BTN, padding: '7px 10px', background: '#fff', color: '#64748b', borderColor: '#e2e8f0', flexShrink: 0 }} onClick={resetLink}>
                {t('techinsp.new_link', 'New link')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── The work order, the job card and the car ── */}
      <div style={CARD}>
        <div className="ti-grid">
          {'customer_name' in wo && <Info label={t('techinsp.customer', 'Customer')} value={wo.customer_name} />}
          <Info label={t('techinsp.vehicle', 'Vehicle')} value={vehicle} />
          <Info label={t('techinsp.vin', 'VIN')} value={wo.vin} ltr />
          <Info label={t('techinsp.odometer', 'Odometer')} value={wo.odometer_in != null ? t('techinsp.km', '{{n}} km', { n: Number(wo.odometer_in).toLocaleString('en-US') }) : null} />
          <Info wide label={t('techinsp.complaint', "Customer's complaint")} value={wo.complaint} />
        </div>
      </div>

      {!inspection ? (
        /* ── Not started ── */
        <div style={CARD}>
          <p style={{ margin: 0, fontWeight: 700, color: '#1e3a6b' }}>{t('techinsp.not_started', 'The technical inspection has not started yet.')}</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
            {woClosed ? t('techinsp.wo_closed', 'This work order is closed.')
              : !wo.ready ? t('techinsp.wait_job_card', 'It starts once the job card is open — when the customer has acknowledged the physical inspection.')
              : estimate ? t('techinsp.estimate_without', 'Estimate {{n}} was raised without a technical report.', { n: estimate.estimate_number })
              : canInspect ? t('techinsp.start_hint_lines', 'Inspect the car, then write the report: a service line for each job, with its service type, labour and parts.')
              : t('techinsp.waiting', "Waiting for the Supervisor / Foreman's technical inspection.")}
          </p>
          {canInspect && wo.ready && !woClosed && !estimate && (
            <button className="ti-no-print" disabled={!!busy} style={{ ...BTN, background: '#ea580c', color: '#fff', marginTop: 12 }} onClick={start}>
              <Plus width={14} height={14} /> {busy === 'start' ? t('techinsp.starting', 'Starting…') : t('techinsp.start', 'Start the technical inspection')}
            </button>
          )}
        </div>
      ) : (
        <>
          {completed && canInspect && estimate && (
            <p className="ti-no-print" style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
              {t('techinsp.locked_by_estimate', 'Estimate {{n}} has been raised from this report, so the report can no longer be edited.', { n: estimate.estimate_number })}
            </p>
          )}

          {/* ── Findings: no longer part of the report (3 Nov 2026); an older report's, read-only ── */}
          {inspection.findings && (
            <div style={CARD}>
              <h2 style={{ ...H2, marginBottom: 8 }}>{t('techinsp.findings_old', 'Findings (recorded earlier)')}</h2>
              <p className="ti-val" style={{ margin: 0, fontWeight: 400 }}>{inspection.findings}</p>
              <p className="ti-no-print" style={{ margin: '6px 0 0', fontSize: 12, color: '#94a3b8' }}>
                {t('techinsp.findings_old_hint', 'The report no longer has a findings field — kept as it was written. Not sent to the customer.')}
              </p>
            </div>
          )}

          {/* ── Service lines ── */}
          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 10px', marginBottom: 12 }}>
              <h2 style={H2}>{t('techinsp.lines', 'Service lines')}</h2>
              <span style={{ fontSize: 12, color: '#64748b' }}>{t('techinsp.lines_hint_type', 'One line per job: its service type, the labour and the parts it needs. The estimate is raised from these.')}</span>
            </div>
            {editable
              ? form.lines.map((l, i) => (
                <LineEditor key={l.key} t={t} line={l} n={i + 1} gap={gaps[l.key]}
                  onChange={patch => setLine(l.key, patch)}
                  onPart={(partKey, field, value) => patchParts(l.key, ps => ps.map(p => (p.key === partKey ? { ...p, [field]: value } : p)))}
                  onAddPart={() => patchParts(l.key, ps => (ps.length >= MAX.parts ? ps : [...ps, blankPart()]))}
                  onRemovePart={partKey => patchParts(l.key, ps => ps.filter(p => p.key !== partKey))}
                  onRemove={() => removeLine(l, i + 1)} />
              ))
              : lines.length
                ? lines.map((l, i) => <LineView key={i} t={t} line={l} n={i + 1} />)
                : <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>{t('techinsp.no_lines', 'No service lines yet.')}</p>}
            {editable && (
              <button type="button" className="ti-no-print" style={ADD_BTN} disabled={form.lines.length >= MAX.lines} onClick={addLine}>
                <Plus width={14} height={14} /> {t('techinsp.add_line', 'Add service line')}
              </button>
            )}
          </div>

          {/* ── Who inspected it; the signature on paper ── */}
          <div style={CARD}>
            <div className="ti-grid">
              <Info label={t('techinsp.inspected_by', 'Inspected by')} value={inspection.inspected_by_name} />
              <Info label={t('techinsp.completed_by', 'Completed by')}
                value={completed ? `${inspection.completed_by_name || '—'} · ${when(inspection.completed_at)}` : t('techinsp.not_completed', 'Not completed yet')} />
            </div>
            <div className="ti-print-only ti-sign">
              <span>{t('techinsp.sign_sf', 'Supervisor / Foreman — name and signature')}</span>
              <span>{t('techinsp.sign_date', 'Date')}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Info({ label, value, wide = false, ltr = false }) {
  return (
    <div className={wide ? 'ti-wide' : undefined}>
      <div style={LBL}>{label}</div>
      <div className="ti-val" dir={ltr && value ? 'ltr' : undefined} style={value ? undefined : { color: '#94a3b8', fontWeight: 400 }}>{value || '—'}</div>
    </div>
  );
}

/* ── One service line being written ─────────────────────────────────── */
// gap: { job, type } — what a refused save found missing on this line (outlined).
function LineEditor({ t, line, n, gap, onChange, onPart, onAddPart, onRemovePart, onRemove }) {
  const fid = k => `ti-${k}-${line.key}`;
  const otherRef = useRef(null);
  const onField = (field, value) => onChange({ [field]: value });
  // The job: one of lib/serviceJobs.js, or "Other — type it" (then typed below the select).
  const pickJob = value => {
    if (value === OTHER) {
      onChange({ jobOther: true, job: line.jobOther ? line.job : '' });
      setTimeout(() => otherRef.current?.focus(), 0);
    } else {
      onChange({ jobOther: false, job: value });
    }
  };
  const req = <span aria-hidden="true" style={{ color: '#dc2626' }}> *</span>;
  return (
    <div className="ti-line">
      <button type="button" className="ti-line-del" style={ICON_BTN} onClick={onRemove}
        aria-label={t('techinsp.remove_line', 'Remove service line {{n}}', { n })} title={t('techinsp.remove_line', 'Remove service line {{n}}', { n })}>
        <Trash width={15} height={15} />
      </button>
      <div className="ti-line-head">
        <span className="ti-line-no" aria-hidden="true">{n}</span>
        <div className="ti-f-job">
          <label style={LBL} htmlFor={fid('job')}>{t('techinsp.f_job', 'Job / service')}{req}</label>
          <select id={fid('job')} style={{ ...INPUT, fontWeight: 700, ...(gap?.job && !line.jobOther ? BAD : null) }} aria-required="true"
            aria-invalid={(gap?.job && !line.jobOther) || undefined} value={line.jobOther ? OTHER : line.job} onChange={e => pickJob(e.target.value)}>
            <option value="">{t('techinsp.job_choose', 'Choose the job / service…')}</option>
            {SERVICE_JOBS.map(name => <option key={name} value={name}>{name}</option>)}
            <option value={OTHER}>{t('techinsp.job_other', 'Other — type it')}</option>
          </select>
          {line.jobOther && (
            <input ref={otherRef} style={{ ...INPUT, fontWeight: 700, marginTop: 6, ...(gap?.job ? BAD : null) }} maxLength={MAX.job} aria-required="true"
              aria-invalid={gap?.job || undefined} aria-label={t('techinsp.job_other_aria', 'Service line {{n}}: the job / service', { n })} value={line.job}
              placeholder={t('techinsp.ph_job', 'e.g. Front brake pads')} onChange={e => onField('job', e.target.value)} />
          )}
        </div>
        <div className="ti-f-type">
          <label style={LBL} htmlFor={fid('type')}>{t('techinsp.f_type', 'Service type')}{req}</label>
          <select id={fid('type')} style={{ ...INPUT, ...(gap?.type ? BAD : null) }} aria-required="true" aria-invalid={gap?.type || undefined}
            value={line.service_type} onChange={e => onField('service_type', e.target.value)}>
            <option value="">{t('techinsp.type_choose', 'Choose…')}</option>
            {JOB_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="ti-f-hours">
          <label style={LBL} htmlFor={fid('hours')}>{t('techinsp.f_hours', 'Hours')}</label>
          <input id={fid('hours')} style={INPUT} type="number" min="0" max={MAX.hours} step="0.25" inputMode="decimal" value={line.hours}
            onChange={e => onField('hours', e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={LBL} htmlFor={fid('labour')}>{t('techinsp.f_labour', 'Labour')}</label>
        <textarea id={fid('labour')} rows={2} maxLength={MAX.labour} style={{ ...INPUT, resize: 'vertical' }} value={line.labour}
          placeholder={t('techinsp.ph_labour', 'The work to do, e.g. Replace the front pads, clean and grease the calipers')} onChange={e => onField('labour', e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <span style={LBL}>{t('techinsp.f_parts', 'Parts')}</span>
        {line.parts.length > 0 && (
          <div className="ti-part-head" aria-hidden="true">
            <span>{t('techinsp.col_part', 'Description')}</span><span>{t('techinsp.col_part_no', 'Part no.')}</span><span>{t('techinsp.col_qty', 'Qty')}</span><span />
          </div>
        )}
        {line.parts.map((p, j) => (
          <div key={p.key} className="ti-part-row">
            <input className="ti-part-desc" style={INPUT} maxLength={MAX.description} value={p.description}
              aria-label={t('techinsp.part_desc_n', 'Part {{n}}: description', { n: j + 1 })} placeholder={t('techinsp.ph_part', 'Part description')}
              onChange={e => onPart(p.key, 'description', e.target.value)} />
            <input style={INPUT} maxLength={MAX.part_number} value={p.part_number} dir="ltr"
              aria-label={t('techinsp.part_no_n', 'Part {{n}}: part number', { n: j + 1 })} placeholder={t('techinsp.ph_part_no', 'Part no.')}
              onChange={e => onPart(p.key, 'part_number', e.target.value)} />
            <input style={INPUT} type="number" min="0" max={MAX.quantity} step="any" inputMode="decimal" value={p.quantity}
              aria-label={t('techinsp.part_qty_n', 'Part {{n}}: quantity', { n: j + 1 })} placeholder={t('techinsp.ph_qty', 'Qty')}
              onChange={e => onPart(p.key, 'quantity', e.target.value)} />
            <button type="button" style={ICON_BTN} onClick={() => onRemovePart(p.key)} aria-label={t('techinsp.remove_part', 'Remove part {{n}}', { n: j + 1 })}>
              <Trash width={14} height={14} />
            </button>
          </div>
        ))}
        <button type="button" style={ADD_BTN} disabled={line.parts.length >= MAX.parts} onClick={onAddPart}>
          <Plus width={14} height={14} /> {t('techinsp.add_part', 'Add part')}
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={LBL} htmlFor={fid('notes')}>{t('techinsp.f_notes', 'Notes')}</label>
        <input id={fid('notes')} style={INPUT} maxLength={MAX.notes} value={line.notes}
          placeholder={t('techinsp.ph_notes', 'Anything the estimate or the technician should know')} onChange={e => onField('notes', e.target.value)} />
      </div>
    </div>
  );
}

/* ── One service line as recorded (and printed) ──────────────────────── */
function LineView({ t, line, n }) {
  const parts = Array.isArray(line.parts) ? line.parts : [];
  return (
    <div className="ti-line">
      <div className="ti-line-title">
        <span className="ti-line-no" aria-hidden="true">{n}</span>
        <strong style={{ fontSize: 15, color: '#0f172a' }}>{line.job}</strong>
        {line.service_type && <span className="ti-type">{jobTypeLabel(line.service_type)}</span>}
        {line.hours != null && line.hours !== '' && <span className="ti-hours">{t('techinsp.hours_n', '{{n}} h', { n: line.hours })}</span>}
      </div>
      {line.labour && <p className="ti-kv"><b>{t('techinsp.f_labour', 'Labour')}</b> {line.labour}</p>}
      {parts.length > 0 ? (
        <table className="ti-parts">
          <thead>
            <tr><th>{t('techinsp.col_part', 'Description')}</th><th>{t('techinsp.col_part_no', 'Part no.')}</th><th className="num">{t('techinsp.col_qty', 'Qty')}</th></tr>
          </thead>
          <tbody>
            {parts.map((p, j) => (
              <tr key={j}><td>{p.description}</td><td dir="ltr">{p.part_number || '—'}</td><td className="num">{p.quantity}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="ti-kv" style={{ color: '#94a3b8' }}>{t('techinsp.no_parts', 'No parts.')}</p>}
      {line.notes && <p className="ti-kv"><b>{t('techinsp.f_notes', 'Notes')}</b> {line.notes}</p>}
    </div>
  );
}
