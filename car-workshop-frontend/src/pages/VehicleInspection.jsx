/**
 * Vehicle Inspection Form — the walk-around damage check, done with the
 * customer standing at the car: the intake inspection (Step 4, technical
 * inspection) and the joint walk-around at handover (Step 7).
 *
 * Pick a damage code from the legend, click the spot on the car diagram, and a
 * marker lands there. Completing the form stamps the matching Customer Journey
 * checkpoint on the work order.
 *
 * The inspection can also be done on the paper form and uploaded instead
 * (a PDF or photos of the pages) — "Upload the paper form" below.
 *
 * Reached from WorkOrderDetail and the job card workflow:
 * /work-orders/:id/inspection[?type=joint]. After it is completed the bar at
 * the bottom leads on to the next step (raise / open the estimate).
 *
 * It ends with the customer's signature on the pad — or, when they are not at
 * the car, "Customer not present" and they sign from the link. Once completed,
 * "Send to the customer" sends that link (WhatsApp / e-mail / copy): their copy
 * of the inspection, and where they sign if they have not (InspectionLink.jsx).
 *
 * Words: t('inspection.*', 'English default'); the damage codes and view
 * names are shared with the customer's page (inspection.code.*, inspection.view.*).
 */
import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Check, Printer, Trash, WarningTriangle, Erase, Upload, Page, EditPencil, NavArrowRight, OpenNewWindow,
  Whatsapp, SendMail, Copy,
} from 'iconoir-react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { canDo } from '../lib/permissions';
import { woLabel, woTone } from '../lib/statusLabels';
import CarDamageDiagram, { DAMAGE_CODES, damageLabel, viewLabel } from '../components/CarDamageDiagram';

const CODE_LIST = Object.keys(DAMAGE_CODES);

const LBL = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 };
const INPUT = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#fff', boxSizing: 'border-box' };
const CARD = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 };
const BTN = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent' };

// Responsive layout and print. Inline styles elsewhere follow the rest of the
// page; what has to change with the width lives here.
const PAGE_CSS = `
  .vi-page { padding: 20px; max-width: 1300px; margin: 0 auto; box-sizing: border-box; }
  .vi-diagram-row { display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 16px; align-items: start; }
  .vi-legend-list { display: flex; flex-direction: column; gap: 3px; }
  .vi-mark-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .vi-mark-name { min-width: 130px; }
  .vi-mark-view { min-width: 100px; }
  .vi-mark-note { flex: 1 1 180px; min-width: 0; }
  .vi-status-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; margin-inline-end: 6px; vertical-align: 1px; }
  @media screen and (max-width: 900px) {
    .vi-diagram-row { grid-template-columns: minmax(0, 1fr); }
    .vi-legend-card { order: -1; }
    .vi-legend-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
  }
  @media screen and (max-width: 600px) {
    .vi-page { padding: 16px; }
    .vi-mark-name, .vi-mark-view { min-width: 0; }
    .vi-mode-btn { min-width: 0 !important; flex: 1 1 100%; }
  }
  /* Fingers need 44px targets; the markers on the car keep their own size. */
  @media screen and (max-width: 900px), (pointer: coarse) {
    .vi-page button:not(.cdd-mark) { min-height: 44px; }
    .vi-page input:not([type="checkbox"]) { min-height: 44px; }
    .vi-check { min-height: 44px; }
  }
  @media print {
    body * { visibility: hidden !important; }
    .vi-page, .vi-page * { visibility: visible !important; }
    .vi-page { position: absolute; inset: 0; padding: 0 !important; max-width: none; }
    .vi-no-print { display: none !important; }
    .vi-view-panel { break-inside: avoid; }
  }
`;

const when = d => (d ? new Date(String(d).replace(' ', 'T')).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Clipboard, with the old textarea fallback for http:// and older browsers.
 *  `text` may be a promise (the link still being made): the write is started
 *  at once, inside the click — Safari and iOS refuse one made after an await. */
async function copyText(text) {
  try {
    if (typeof text === 'string') await navigator.clipboard.writeText(text);
    else await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(t => new Blob([t], { type: 'text/plain' })) })]);
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

/** Any ink on the pad? A tap without a stroke leaves it blank. */
function hasInk(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
  return false;
}

/** A work order status as the shared chip (lib/statusLabels.js). */
function WoChip({ t, status }) {
  const tone = woTone(status);
  const Icon = tone.icon;
  return (
    <span className="vi-status-chip" style={{ background: tone.bg, color: tone.color }}>
      <Icon width={12} height={12} aria-hidden /> {woLabel(t, status)}
    </span>
  );
}

export default function VehicleInspection() {
  const { t } = useTranslation();
  const { id } = useParams();               // work order id
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inspectionType = searchParams.get('type') === 'joint' ? 'joint' : 'intake';
  const { workshop, user } = useContext(AuthContext);
  const cur = workshop?.currency || 'AED';

  const [inspection, setInspection] = useState(null);
  const [form, setForm] = useState({});
  const [marks, setMarks] = useState([]);
  const [activeCode, setActiveCode] = useState('');
  const [selectedMarkId, setSelectedMarkId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setErrorMsg] = useState('');
  const [errorAt, setErrorAt] = useState('');      // '' = the banner at the top; else next to the button pressed: 'signature' | 'share' | 'bar'
  const [savedAt, setSavedAt] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [estimate, setEstimate] = useState(null);   // the job's estimate, for the next step
  const [share, setShare] = useState(null);         // the customer's link: { url, can_email, can_whatsapp, ... }
  const [sharing, setSharing] = useState('');       // channel being sent
  const [shareNote, setShareNote] = useState('');
  const [resign, setResign] = useState(false);      // redo a saved signature (before completion)
  const [savingSig, setSavingSig] = useState(false);
  const fileRef = useRef(null);

  // The cards at the bottom are a long scroll from the banner, so their errors show beside them.
  const setError = useCallback((msg, at = '') => { setErrorMsg(msg); setErrorAt(at); }, []);

  const markSeq = useRef(1);

  /* ── Load (or start) the inspection for this work order ── */
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // POST is idempotent per (work order, type): it reopens the existing
      // inspection rather than creating a second one.
      const res = await api.post('/vehicle-inspections', {
        work_order_id: Number(id), inspection_type: inspectionType,
      });
      if (!res.success) { setError(res.message || t('inspection.err_open', 'Could not open the inspection')); return; }
      applyRow(res.data);
    } catch (e) {
      setError(e.message || t('inspection.err_open', 'Could not open the inspection'));
    } finally {
      setLoading(false);
    }
    // t changes with the language only; reloading for it is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, inspectionType, setError]);

  useEffect(() => { load(); }, [load]);

  // The next step after the inspection is pricing (process step 4): is there
  // an estimate for this job card already?
  const loadNext = useCallback(async () => {
    try {
      const r = await api.get(`/workflow/work-orders/${id}`);
      if (r.success) setEstimate(r.data?.estimate || null);
    } catch { /* the bar still offers the way back to the job card */ }
  }, [id]);
  useEffect(() => { loadNext(); }, [loadNext]);

  // Once completed: the customer's link, and which channels reach them.
  const inspectionId = inspection?.id;
  const completedNow = inspection?.status === 'completed';
  const loadShare = useCallback(async () => {
    if (!inspectionId) return;
    const r = await api.get(`/vehicle-inspections/${inspectionId}/share`).catch(() => null);
    if (r?.success) setShare(r.data);
  }, [inspectionId]);
  useEffect(() => { if (completedNow) loadShare(); }, [completedNow, loadShare]);

  // The server moved on without this screen (the customer signed from the
  // link, the job card changed): show what it has now.
  const refresh = async () => {
    const r = await api.get(`/vehicle-inspections/${inspectionId}`).catch(() => null);
    if (r?.success) setInspection(r.data);
    loadShare();
  };

  function applyRow(row) {
    setInspection(row);
    setForm({
      estimate_date: (row.estimate_date || '').toString().slice(0, 10),
      original_estimate: row.original_estimate ?? '',
      customer_name: row.customer_name || '',
      customer_phone: row.customer_phone || '',
      customer_email: row.customer_email || '',
      vehicle_year: row.vehicle_year || '',
      vehicle_make: row.vehicle_make || '',
      vehicle_model: row.vehicle_model || '',
      vin: row.vin || '',
      plate_number: row.plate_number || '',
      odometer: row.odometer ?? '',
      service_recommended: row.service_recommended || '',
      service_accepted: row.service_accepted || '',
      notes: row.notes || '',
      signed_by_name: row.signed_by_name || '',
      customer_present: row.customer_present !== 0,
    });
    const loaded = Array.isArray(row.marks) ? row.marks : [];
    setMarks(loaded);
    markSeq.current = loaded.length + 1;
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isCompleted = inspection?.status === 'completed';
  const mode = inspection?.entry_mode === 'document' ? 'document' : 'form';
  const docs = Array.isArray(inspection?.documents) ? inspection.documents : [];

  /* ── Marker editing ── */
  // x / y come relative to the car picture (coord 'img'), so the marker stays
  // on that spot at any width — here, in print and on the customer's page.
  const addMark = (view, x, y, coord) => {
    if (isCompleted || !activeCode) return;
    const mark = { id: `m${Date.now()}${markSeq.current++}`, view, code: activeCode, x, y, ...(coord ? { coord } : {}), note: '' };
    setMarks(prev => [...prev, mark]);
    setSelectedMarkId(mark.id);
  };
  const updateMark = (markId, patch) =>
    setMarks(prev => prev.map(m => (m.id === markId ? { ...m, ...patch } : m)));
  const removeMark = (markId) => {
    setMarks(prev => prev.filter(m => m.id !== markId));
    setSelectedMarkId(s => (s === markId ? '' : s));
  };

  /* ── Save / complete ── */
  const save = async ({ at = '' } = {}) => {
    if (isCompleted) return true;
    setSaving(true); setError('');
    try {
      const res = await api.put(`/vehicle-inspections/${inspection.id}`, {
        ...form,
        entry_mode: mode,
        original_estimate: form.original_estimate === '' ? null : form.original_estimate,
        odometer: form.odometer === '' ? null : form.odometer,
        marks,
      });
      if (!res.success) { setError(res.message || t('inspection.err_save', 'Save failed'), at); return false; }
      setInspection(res.data);
      setSavedAt(new Date());
      return true;
    } catch (e) {
      setError(e.message || t('inspection.err_save', 'Save failed'), at);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const complete = async (at = '') => {
    // Same rule as the server: on screen, the walk-around ends with the
    // customer's signature — unless they are not at the car.
    const present = form.customer_present !== false;
    if (mode === 'form' && present && !inspection.signature_url && !signatureDirty.current) {
      // Same wording as the server's SIGNATURE_REQUIRED (routes/vehicle-inspections.js).
      setError(t('inspection.signature_required', "The customer hasn't signed yet. Ask them to sign above — or, if they aren't here, tick “Customer not present” and send them the link to sign."), at);
      return;
    }
    if (!(await save({ at }))) return;
    if (mode === 'form' && present && signatureDirty.current && !(await uploadSignature(at))) return;
    setSaving(true);
    try {
      const res = await api.patch(`/vehicle-inspections/${inspection.id}/complete`, mode === 'form' ? { customer_present: present } : undefined);
      if (res.success) { setInspection(res.data); setResign(false); loadNext(); }
      else setError(res.message || t('inspection.err_complete', 'Could not complete the inspection'), at);
    } catch (e) {
      setError(e.message || t('inspection.err_complete', 'Could not complete the inspection'), at);
    } finally { setSaving(false); }
  };

  /* ── Fill in on screen, or upload the paper form ── */
  const switchMode = async (next) => {
    if (isCompleted || next === mode) return;
    setError('');
    const res = await api.put(`/vehicle-inspections/${inspection.id}`, { entry_mode: next }).catch(() => null);
    if (res?.success) setInspection(res.data);
    else setError(res?.message || t('inspection.err_switch', 'Could not switch — try again.'));
  };
  const uploadDocs = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const res = await api.post(`/vehicle-inspections/${inspection.id}/documents`, fd);
      if (res.success) setInspection(res.data);
      else setError(res.message || t('inspection.err_upload', 'Upload failed'));
    } catch (e) {
      setError(e.message || t('inspection.err_upload', 'Upload failed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const viewDoc = async (doc) => {
    // Read with the staff login (the files are not public), then open it.
    const win = window.open('', '_blank');
    try {
      const res = await api.raw(`/vehicle-inspections/${inspection.id}/documents/${doc.id}`);
      if (!res.ok) throw new Error(t('inspection.err_open_doc', 'Could not open the document'));
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      if (win) win.close();
      setError(e.message || t('inspection.err_open_doc', 'Could not open the document'));
    }
  };
  const removeDoc = async (doc) => {
    if (!window.confirm(t('inspection.confirm_remove_doc', 'Remove "{{name}}"?', { name: doc.name }))) return;
    const res = await api.delete(`/vehicle-inspections/${inspection.id}/documents/${doc.id}`).catch(() => null);
    if (res?.success) setInspection(res.data);
    else setError(res?.message || t('inspection.err_remove_doc', 'Could not remove the document'));
  };

  /* ── Signature pad ── */
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const signatureDirty = useRef(false);

  const canvasPos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  // The pad takes a signature while none is saved (or it is being redone
  // before completion); after completion only if the customer has not signed.
  const signed = !!inspection?.signature_url;
  const notPresent = !isCompleted && form.customer_present === false;
  const padOpen = mode === 'form' && (!signed || (resign && !isCompleted)) && !notPresent;

  const startDraw = (e) => {
    if (!padOpen) return;
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = canvasPos(e);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    ctx.beginPath(); ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveDraw = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = canvasPos(e);
    ctx.lineTo(x, y); ctx.stroke();
    signatureDirty.current = true;   // only a stroke counts — a tap leaves the pad blank
  };
  const endDraw = () => { drawing.current = false; };
  const clearSignature = () => {
    const c = canvasRef.current;
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    signatureDirty.current = false;
  };
  const uploadSignature = async (at = 'signature') => {
    // After completion a saved signature is final, so a blank one must never get through.
    if (!canvasRef.current || !signatureDirty.current || !hasInk(canvasRef.current)) {
      setError(t('inspection.err_sign_first', 'Ask the customer to sign in the box first.'), at);
      return false;
    }
    setError(''); setSavingSig(true);
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const res = await api.patch(`/vehicle-inspections/${inspection.id}/signature`, { signature: dataUrl, name: form.signed_by_name });
      if (!res.success) {
        setError(res.message || t('inspection.err_signature', 'Could not save the signature'), at);
        // Already signed — from the link, most likely: show that signature instead of the pad.
        if (res.status === 409) refresh();
        return false;
      }
      setInspection(res.data || (i => ({ ...i, signature_url: res.url })));
      signatureDirty.current = false;
      setResign(false);
      return true;
    } catch (e) {
      setError(e.message || t('inspection.err_signature', 'Could not save the signature'), at);
      return false;
    } finally {
      setSavingSig(false);
    }
  };
  const toggleNotPresent = (away) => {
    set('customer_present', !away);
    if (away) clearSignature();
  };

  /* ── Send to the customer (completed) ── */
  const shareVia = async (channel) => {
    setSharing(channel); setShareNote(''); setError('');
    // Opened now, while the click still counts as the user's — a window
    // opened after the request would be blocked as a pop-up. The copy too.
    const win = channel === 'whatsapp' ? window.open('', '_blank') : null;
    const sent = api.post(`/vehicle-inspections/${inspection.id}/share`, { channel });
    const copied = channel === 'link'
      ? copyText(share?.url || sent.then(r => (r.success ? r.url : Promise.reject(new Error(r.message)))))
      : null;
    try {
      const res = await sent;
      if (!res.success) {
        if (win) win.close();
        setError(res.message || t('inspection.err_share', 'Could not send the inspection'), 'share');
        // Not completed / cancelled meanwhile: bring the screen up to date.
        if (res.status === 409) refresh();
        return;
      }
      if (res.data) setInspection(res.data);
      setShare(s => ({ ...s, url: res.url }));
      if (channel === 'whatsapp') {
        if (win) win.location.href = res.whatsapp_url; else window.open(res.whatsapp_url, '_blank');
        setShareNote(res.message || t('inspection.share_whatsapp_opened', 'WhatsApp opened with the message — press send there.'));
      } else if (channel === 'email') {
        setShareNote(res.message || t('inspection.share_email_sent', 'E-mail sent.'));
      } else {
        setShareNote(await copied
          ? t('inspection.share_link_copied', 'Link copied — paste it to the customer.')
          : t('inspection.share_link_copy_manually', 'Copy the link below and send it to the customer.'));
      }
    } catch (e) {
      if (win) win.close();
      setError(e.message || t('inspection.err_share', 'Could not send the inspection'), 'share');
    } finally {
      setSharing('');
    }
  };

  // A link that went to the wrong chat: replace it. A signature made from it comes off too.
  const resetLink = async () => {
    const fromLink = inspection.signed_via === 'link';
    const ok = window.confirm(fromLink
      ? (inspection.signed_by_name
        ? t('inspection.reset_confirm_signed_by', 'Make a new link? The current one stops working, and the signature made from it by {{name}} is removed — the customer signs again.', { name: inspection.signed_by_name })
        : t('inspection.reset_confirm_signed', 'Make a new link? The current one stops working, and the signature made from it is removed — the customer signs again.'))
      : t('inspection.reset_confirm', 'Make a new link? The current one stops working.'));
    if (!ok) return;
    setSharing('reset'); setShareNote(''); setError('');
    try {
      const res = await api.post(`/vehicle-inspections/${inspection.id}/share/reset`);
      if (!res.success) { setError(res.message || t('inspection.err_reset', 'Could not reset the link'), 'share'); return; }
      setInspection(res.data);
      setShare(s => ({ ...s, url: null }));
      setShareNote(res.signature_cleared
        ? t('inspection.reset_done_signature', 'The old link no longer works and its signature was removed. Send the customer the new link.')
        : t('inspection.reset_done', 'The old link no longer works. Send the customer the new link.'));
    } catch (e) {
      setError(e.message || t('inspection.err_reset', 'Could not reset the link'), 'share');
    } finally {
      setSharing('');
    }
  };

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>{t('inspection.loading', 'Loading inspection…')}</div>;
  if (!inspection) {
    return (
      <div style={{ padding: 32 }}>
        <p style={{ color: '#dc2626', marginBottom: 12 }}>{error || t('inspection.unavailable', 'Inspection unavailable')}</p>
        <button style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => navigate(-1)}>
          <ArrowLeft width={14} height={14} /> {t('inspection.back', 'Back')}
        </button>
      </div>
    );
  }

  const canShare = !!share?.can_send;   // the advisor's desk, managers, and whoever did the walk-around
  const jobClosed = !!share?.job_closed;
  const linkClosed = jobClosed || !!share?.work_order_cancelled;   // nothing more to sign from the link
  const errorHere = at => (error && errorAt === at
    ? <p role="alert" style={{ margin: '8px 0 0', flexBasis: '100%', fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{error}</p>
    : null);
  // "Signed from the link by Sara · 13 Oct 2026, 10:42"
  const signedLine = () => {
    const name = inspection.signed_by_name;
    const via = inspection.signed_via;
    const line = via === 'link'
      ? (name ? t('inspection.signed_link_by', 'Signed from the link by {{name}}', { name }) : t('inspection.signed_link', 'Signed from the link'))
      : via === 'portal'
        ? (name ? t('inspection.signed_portal_by', 'Signed in the customer portal by {{name}}', { name }) : t('inspection.signed_portal', 'Signed in the customer portal'))
        : (name ? t('inspection.signed_site_by', 'Signed on site by {{name}}', { name }) : t('inspection.signed_site', 'Signed on site'));
    return inspection.signed_at ? `${line} · ${when(inspection.signed_at)}` : line;
  };
  const sharedVia = v => ({
    whatsapp: t('inspection.shared_via.whatsapp', 'WhatsApp'),
    email: t('inspection.shared_via.email', 'e-mail'),
    link: t('inspection.shared_via.link', 'copied link'),
  }[v] || v);
  const field = (key, label, extra = {}) => (
    <div><label style={LBL} htmlFor={`vi-f-${key}`}>{label}</label>
      <input id={`vi-f-${key}`} style={INPUT} disabled={isCompleted} value={form[key] ?? ''} onChange={e => set(key, e.target.value)} {...extra} /></div>
  );

  return (
    <div className="vi-page">
      <style>{PAGE_CSS}</style>

      {/* ── Header ── */}
      <div className="vi-no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => navigate(`/work-orders/${id}`)}>
          <ArrowLeft width={14} height={14} /> {t('inspection.job_card', 'Job card')}
        </button>
        <div style={{ flex: 1 }} />
        {savedAt && !isCompleted && (
          <span style={{ fontSize: 12, color: '#16a34a' }}>{t('inspection.saved_at', 'Saved {{time}}', { time: savedAt.toLocaleTimeString() })}</span>
        )}
        <button style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => window.print()}>
          <Printer width={14} height={14} /> {t('inspection.print', 'Print')}
        </button>
        {!isCompleted && (
          <>
            <button disabled={saving} style={{ ...BTN, background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe' }} onClick={() => save()}>
              <Check width={14} height={14} /> {saving ? t('inspection.saving', 'Saving…') : t('inspection.save_draft', 'Save draft')}
            </button>
            <button disabled={saving || uploading} style={{ ...BTN, background: '#16a34a', color: '#fff' }} onClick={() => complete()}>
              <Check width={14} height={14} /> {t('inspection.complete', 'Complete inspection')}
            </button>
          </>
        )}
        {/* Done: straight on to the next step of the process (pricing). */}
        {isCompleted && inspectionType !== 'joint' && (estimate ? (
          <button style={{ ...BTN, background: '#ea580c', color: '#fff' }} onClick={() => navigate(`/estimates?id=${estimate.id}`)}>
            {t('inspection.next_open_estimate', 'Next: open the estimate')} <NavArrowRight width={14} height={14} />
          </button>
        ) : canDo(user, 'estimate.raise') ? (
          <button style={{ ...BTN, background: '#ea580c', color: '#fff' }} onClick={() => navigate(`/estimates?new=1&wo=${id}`)}>
            {t('inspection.next_raise_estimate', 'Next: raise the estimate')} <NavArrowRight width={14} height={14} />
          </button>
        ) : null)}
        {isCompleted && (inspectionType === 'joint' || (!estimate && !canDo(user, 'estimate.raise'))) && (
          <button style={{ ...BTN, background: '#ea580c', color: '#fff' }} onClick={() => navigate(`/work-orders/${id}`)}>
            {t('inspection.next_job_card', 'Next: back to the job card')} <NavArrowRight width={14} height={14} />
          </button>
        )}
      </div>

      {error && !errorAt && (
        <div className="vi-no-print" style={{ ...CARD, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c', display: 'flex', gap: 8, alignItems: 'center' }}>
          <WarningTriangle width={16} height={16} style={{ flexShrink: 0 }} /> {error}
        </div>
      )}

      {/* ── Title block ── */}
      <div style={{ ...CARD, textAlign: 'center', paddingBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: '#1e3a6b' }}>
          {workshop?.name || t('inspection.workshop', 'Workshop')} <span style={{ color: '#0e7490' }}>— {t('inspection.form_title', 'Vehicle Inspection Form')}</span>
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
          {inspectionType === 'joint'
            ? t('inspection.type_joint', 'Joint inspection at handover')
            : t('inspection.type_intake', 'Intake inspection — exterior condition')}
          {' · '}{t('inspection.job_card_n', 'Job card {{n}}', { n: inspection.work_order_number || `#${id}` })}
          {isCompleted && (
            <span style={{ marginInlineStart: 8, background: '#dcfce7', color: '#15803d', padding: '2px 10px', borderRadius: 12, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', display: 'inline-block' }}>
              {t('inspection.completed_badge', 'Completed')}
            </span>
          )}
        </p>
      </div>

      {/* ── How this inspection is recorded ── */}
      <div className="vi-no-print" style={{ ...CARD, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1e3a6b', marginInlineEnd: 6 }}>{t('inspection.mode_question', 'How is this inspection recorded?')}</span>
        {[
          ['form', EditPencil, t('inspection.mode_form', 'Fill in the form here'), t('inspection.mode_form_hint', 'Mark the damage on the diagram')],
          ['document', Upload, t('inspection.mode_document', 'Upload the paper form'), t('inspection.mode_document_hint', 'PDF or photos of the pages')],
        ].map(([key, Icon, title, sub]) => {
          const on = mode === key;
          return (
            <button key={key} type="button" className="vi-mode-btn" disabled={isCompleted && !on} aria-pressed={on}
              onClick={() => switchMode(key)}
              style={{ ...BTN, padding: '10px 14px', textAlign: 'start', alignItems: 'flex-start', minWidth: 230,
                background: on ? '#fff7ed' : '#fff', borderColor: on ? '#f97316' : '#e2e8f0', color: '#1e293b',
                cursor: isCompleted ? 'default' : 'pointer', opacity: isCompleted && !on ? 0.45 : 1 }}>
              <Icon width={18} height={18} style={{ color: on ? '#ea580c' : '#64748b', flexShrink: 0, marginTop: 1 }} />
              <span><span style={{ display: 'block', fontWeight: 800 }}>{title}</span>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#64748b' }}>{sub}</span></span>
            </button>
          );
        })}
      </div>

      {/* ── Uploaded paper form ── */}
      {mode === 'document' && (
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#1e3a6b' }}>{t('inspection.docs_title', 'Inspection form (uploaded)')}</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>{t('inspection.docs_limits', 'PDF, JPG, PNG or WEBP · up to 15 MB each · up to 10 files')}</span>
            <div style={{ flex: 1 }} />
            {!isCompleted && (
              <>
                <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
                  style={{ display: 'none' }} onChange={e => uploadDocs(e.target.files)} />
                <button type="button" className="vi-no-print" disabled={uploading}
                  style={{ ...BTN, background: '#1e3a6b', color: '#fff' }} onClick={() => fileRef.current?.click()}>
                  <Upload width={14} height={14} /> {uploading
                    ? t('inspection.uploading', 'Uploading…')
                    : (docs.length ? t('inspection.add_files', 'Add more files') : t('inspection.choose_files', 'Choose files'))}
                </button>
              </>
            )}
          </div>
          {docs.length === 0 ? (
            <div
              onDragOver={e => { if (!isCompleted) e.preventDefault(); }}
              onDrop={e => { if (isCompleted) return; e.preventDefault(); uploadDocs(e.dataTransfer.files); }}
              style={{ border: '2px dashed #cbd5e1', borderRadius: 10, padding: '26px 16px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              {isCompleted
                ? t('inspection.docs_empty', 'No file yet. Choose the scanned form or photos of each page.')
                : t('inspection.docs_empty_drop', 'No file yet. Choose the scanned form or photos of each page — or drop them here.')}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {docs.map(d => (
                <li key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                  <Page width={18} height={18} style={{ color: '#ea580c', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{d.name}</span>
                  <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>{d.size ? t('inspection.kb', '{{n}} KB', { n: Math.max(1, Math.round(d.size / 1024)) }) : ''}</span>
                  <button type="button" className="vi-no-print" style={{ ...BTN, padding: '5px 10px', background: '#f1f5f9', color: '#334155' }} onClick={() => viewDoc(d)}>
                    <OpenNewWindow width={13} height={13} /> {t('inspection.view_doc', 'View')}
                  </button>
                  {!isCompleted && (
                    <button type="button" className="vi-no-print" aria-label={t('inspection.remove_doc', 'Remove {{name}}', { name: d.name })}
                      style={{ ...BTN, padding: '5px 8px', background: '#fff', color: '#dc2626', borderColor: '#fecaca' }} onClick={() => removeDoc(d)}>
                      <Trash width={13} height={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Header fields ── */}
      <div style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {field('estimate_date', t('inspection.field.estimate_date', 'Date of estimate'), { type: 'date' })}
          {field('original_estimate', t('inspection.field.original_estimate', 'Original estimate ({{cur}})', { cur }), { type: 'number', step: '0.01' })}
          {field('customer_name', t('inspection.field.name', 'Name'))}
          {field('customer_phone', t('inspection.field.phone', 'Phone'), { dir: 'ltr' })}
          {field('customer_email', t('inspection.field.email', 'E-mail'), { dir: 'ltr' })}
          {field('vehicle_year', t('inspection.field.year', 'Year'))}
          {field('vehicle_make', t('inspection.field.make', 'Make'))}
          {field('vehicle_model', t('inspection.field.model', 'Model'))}
          {field('vin', t('inspection.field.vin', 'VIN'), { dir: 'ltr' })}
          {field('plate_number', t('inspection.field.plate', 'Plate'))}
          {field('odometer', t('inspection.field.odometer', 'Odometer (km)'), { type: 'number' })}
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 12.5, color: '#1e3a6b', fontWeight: 600 }}>
          {mode === 'document'
            ? t('inspection.document_intro', 'The inspection was done on the paper form — upload it above. The details here come from the job card.')
            : t('inspection.form_intro', 'Inspect the vehicle with the customer. Point out and mark on the diagram any current damage or issues.')}
        </p>
      </div>

      {/* ── Diagram + legend (filled in on screen) ── */}
      {mode === 'form' && (<>
      <div className="vi-diagram-row" style={{ marginBottom: 16 }}>
        <div style={{ ...CARD, marginBottom: 0 }}>
          <CarDamageDiagram
            marks={marks}
            activeCode={isCompleted ? '' : activeCode}
            selectedMarkId={selectedMarkId}
            onAddMark={isCompleted ? undefined : addMark}
            onSelectMark={setSelectedMarkId}
          />
          {!isCompleted && (
            <p className="vi-no-print" role="status" style={{ margin: '10px 2px 0', fontSize: 12, color: activeCode ? '#0e7490' : '#64748b' }}>
              {activeCode
                ? t('inspection.hint_active', 'Click the spot on the car to mark “{{label}}”.', { label: damageLabel(t, activeCode) })
                : t('inspection.hint_pick', 'Pick a damage code from the legend, then click the spot on the car.')}
            </p>
          )}
        </div>

        {/* Legend */}
        <div className="vi-legend-card" style={{ ...CARD, padding: 12, marginBottom: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#1e3a6b', textAlign: 'center', marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {t('inspection.legend', 'Legend')}
          </div>
          <div className="vi-legend-list">
            {CODE_LIST.map(code => {
              const on = code === activeCode;
              const used = marks.filter(m => m.code === code).length;
              return (
                <button
                  key={code}
                  type="button"
                  disabled={isCompleted}
                  aria-pressed={on}
                  onClick={() => setActiveCode(on ? '' : code)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6,
                    border: `1px solid ${on ? '#0e7490' : '#e2e8f0'}`,
                    background: on ? '#cffafe' : '#fff',
                    cursor: isCompleted ? 'default' : 'pointer', textAlign: 'start', width: '100%',
                  }}
                >
                  <span style={{
                    fontSize: 11, fontWeight: 800, color: on ? '#0e7490' : '#334155',
                    background: on ? '#fff' : '#f1f5f9', borderRadius: 4, padding: '2px 5px', minWidth: 26, textAlign: 'center',
                  }}>{code}</span>
                  <span style={{ fontSize: 11.5, color: '#334155', flex: 1 }}>{damageLabel(t, code)}</span>
                  {used > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626' }}>{used}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Marked damage list ── */}
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a6b', marginBottom: 10 }}>
          {t('inspection.marked_n', 'Marked damage ({{n}})', { n: marks.length })}
        </div>
        {marks.length === 0 ? (
          <p style={{ fontSize: 12.5, color: '#64748b', margin: 0 }}>{t('inspection.no_marks', 'No damage marked yet.')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {marks.map((m, i) => (
              <div key={m.id}
                className="vi-mark-row"
                onClick={() => setSelectedMarkId(m.id)}
                style={{
                  padding: '7px 10px', borderRadius: 8,
                  border: `1px solid ${m.id === selectedMarkId ? '#0e7490' : '#f1f5f9'}`,
                  background: m.id === selectedMarkId ? '#f0fdfa' : '#f8fafc', cursor: 'pointer',
                }}>
                <span style={{ fontSize: 11, color: '#64748b', minWidth: 16 }}>{i + 1}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '2px 6px', minWidth: 28, textAlign: 'center' }}>
                  {m.code}
                </span>
                <span className="vi-mark-name" style={{ fontSize: 12.5, color: '#334155' }}>{damageLabel(t, m.code)}</span>
                <span className="vi-mark-view" style={{ fontSize: 11.5, color: '#64748b' }}>{viewLabel(t, m.view)}</span>
                <input
                  className="vi-mark-note"
                  style={{ ...INPUT, padding: '5px 8px', fontSize: 12 }}
                  placeholder={t('inspection.note_ph', 'Note (optional)')}
                  aria-label={t('inspection.note_for', 'Note for mark {{n}}', { n: i + 1 })}
                  disabled={isCompleted}
                  value={m.note || ''}
                  onClick={e => e.stopPropagation()}
                  onChange={e => updateMark(m.id, { note: e.target.value })}
                />
                {!isCompleted && (
                  <button className="vi-no-print" type="button"
                    aria-label={t('inspection.remove_mark', 'Remove mark {{n}}', { n: i + 1 })}
                    onClick={e => { e.stopPropagation(); removeMark(m.id); }}
                    style={{ ...BTN, padding: '5px 8px', background: '#fff', color: '#dc2626', borderColor: '#fecaca' }}>
                    <Trash width={13} height={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </>)}

      {/* ── Service recommended / accepted ── */}
      <div style={{ ...CARD, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 12 }}>
        <div>
          <label style={LBL} htmlFor="vi-f-service_recommended">{t('inspection.field.service_recommended', 'Service recommended')}</label>
          <textarea id="vi-f-service_recommended" rows={3} style={{ ...INPUT, resize: 'vertical' }} disabled={isCompleted}
            value={form.service_recommended} onChange={e => set('service_recommended', e.target.value)} />
        </div>
        <div>
          <label style={LBL} htmlFor="vi-f-service_accepted">{t('inspection.field.service_accepted', 'Service accepted')}</label>
          <textarea id="vi-f-service_accepted" rows={3} style={{ ...INPUT, resize: 'vertical' }} disabled={isCompleted}
            value={form.service_accepted} onChange={e => set('service_accepted', e.target.value)} />
        </div>
        <div>
          <label style={LBL} htmlFor="vi-f-notes">{t('inspection.field.notes', 'Notes')}</label>
          <textarea id="vi-f-notes" rows={3} style={{ ...INPUT, resize: 'vertical' }} disabled={isCompleted}
            value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>

      {/* ── Customer signature (on screen; the paper form carries its own) ── */}
      {mode === 'form' && (
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1e3a6b' }}>{t('inspection.signature_title', 'Customer signature')}</span>
          <div style={{ flex: 1 }} />
          {padOpen && (
            <>
              <button className="vi-no-print" type="button" style={{ ...BTN, padding: '5px 10px', background: '#f1f5f9', color: '#334155' }} onClick={clearSignature}>
                <Erase width={13} height={13} /> {t('inspection.clear', 'Clear')}
              </button>
              <button className="vi-no-print" type="button" disabled={savingSig} style={{ ...BTN, padding: '5px 10px', background: isCompleted ? '#1e3a6b' : '#fff', color: isCompleted ? '#fff' : '#1e3a6b', borderColor: '#c7d2fe' }} onClick={() => uploadSignature()}>
                <Check width={13} height={13} /> {savingSig ? t('inspection.saving', 'Saving…') : t('inspection.save_signature', 'Save signature')}
              </button>
            </>
          )}
          {signed && resign && !isCompleted && (
            <button className="vi-no-print" type="button" style={{ ...BTN, padding: '5px 10px', background: '#f1f5f9', color: '#334155' }} onClick={() => { clearSignature(); setResign(false); }}>
              {t('inspection.keep_signature', 'Keep the saved signature')}
            </button>
          )}
          {signed && !resign && !isCompleted && (
            <button className="vi-no-print" type="button" style={{ ...BTN, padding: '5px 10px', background: '#f1f5f9', color: '#334155' }} onClick={() => setResign(true)}>
              <EditPencil width={13} height={13} /> {t('inspection.sign_again', 'Sign again')}
            </button>
          )}
        </div>
        {signed && !resign ? (
          <>
            <img src={inspection.signature_url} alt={t('inspection.signature_title', 'Customer signature')}
              style={{ maxHeight: 130, maxWidth: '100%', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }} />
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>{signedLine()}</p>
          </>
        ) : (
          <>
            {(padOpen || notPresent) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: '1 1 220px', maxWidth: 360 }}>
                  <label style={LBL} htmlFor="vi-signed-by">{t('inspection.signed_by_label', 'Signed by (name)')}</label>
                  <input id="vi-signed-by" style={INPUT} maxLength={150} disabled={notPresent}
                    placeholder={form.customer_name || t('inspection.optional', 'Optional')}
                    value={form.signed_by_name || ''} onChange={e => set('signed_by_name', e.target.value)} />
                </div>
                {!isCompleted && !signed && (
                  <label className="vi-no-print vi-check" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer', paddingBlock: 8 }}>
                    <input type="checkbox" checked={notPresent} onChange={e => toggleNotPresent(e.target.checked)} />
                    {t('inspection.not_present', "Customer not present — they'll sign from the link")}
                  </label>
                )}
              </div>
            )}
            <canvas
              ref={canvasRef} width={600} height={150} dir="ltr"
              onPointerDown={startDraw} onPointerMove={moveDraw} onPointerUp={endDraw} onPointerLeave={endDraw}
              aria-label={t('inspection.signature_pad', 'Signature pad')}
              aria-disabled={!padOpen}
              style={{
                display: 'block', width: '100%', maxWidth: 600, height: 150, border: '1px dashed #cbd5e1', borderRadius: 8,
                background: padOpen ? '#fff' : '#f8fafc', opacity: padOpen ? 1 : 0.55,
                touchAction: 'none', cursor: padOpen ? 'crosshair' : 'not-allowed', boxSizing: 'border-box',
              }}
            />
            {notPresent && (
              <p className="vi-no-print" style={{ margin: '6px 0 0', fontSize: 12.5, color: '#92400e' }}>
                {t('inspection.not_present_hint', 'Complete the inspection, then send the customer the link — they check it and sign on their phone.')}
              </p>
            )}
            {isCompleted && (
              <p className="vi-no-print" style={{ margin: '6px 0 0', fontSize: 12.5, color: '#92400e' }}>
                {jobClosed
                  ? t('inspection.completed_unsigned_closed', "Completed without the customer's signature. If they are here now, they can sign above (once).")
                  : t('inspection.completed_unsigned', "Completed without the customer's signature. If they are here now, they can sign above (once) — otherwise send them the link below.")}
              </p>
            )}
          </>
        )}
        {errorHere('signature')}
      </div>
      )}

      {isCompleted && (
        <p style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          {t('inspection.locked', 'Completed {{date}} — this inspection is locked.', { date: inspection.completed_at ? new Date(inspection.completed_at).toLocaleString() : '' })}
        </p>
      )}

      {/* ── Send to the customer: their copy, and where they sign if they haven't ── */}
      {isCompleted && (
        <div className="vi-no-print" style={{ ...CARD, padding: '14px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e3a6b' }}>{t('inspection.share_title', 'Send to the customer')}</div>
              <div style={{ fontSize: 12.5, marginTop: 3, color: mode === 'document' || (linkClosed && !signed) ? '#64748b' : signed ? '#15803d' : '#b45309', fontWeight: mode === 'document' || (linkClosed && !signed) ? 500 : 700 }}>
                {mode === 'document'
                  ? t('inspection.share_paper_signed', "The uploaded paper form carries the customer's signature.")
                  : signed
                    ? signedLine()
                    : share?.work_order_cancelled
                      ? t('inspection.share_not_signed', 'Not signed.')
                      : jobClosed
                        ? <><WoChip t={t} status="completed" />{t('inspection.share_closed_unsigned', 'Not signed. The link is a read-only copy now; it can no longer be signed there.')}</>
                        : t('inspection.share_waiting', "Waiting for the customer's signature — send them the link.")}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                {inspection.shared_at
                  ? t('inspection.last_sent', 'Last sent: via {{channel}} · {{date}}', { channel: sharedVia(inspection.shared_via), date: when(inspection.shared_at) })
                  : t('inspection.not_sent', 'Not sent yet.')}
              </div>
            </div>
            {share?.work_order_cancelled ? (
              <span style={{ fontSize: 12.5, color: '#64748b' }}>
                <WoChip t={t} status="cancelled" />{t('inspection.share_wo_cancelled', 'Nothing is sent to the customer for a cancelled job card.')}
              </span>
            ) : share && !canShare ? (
              <span style={{ fontSize: 12.5, color: '#64748b' }}>{t('inspection.share_advisor_only', 'The Service Advisor sends it to the customer.')}</span>
            ) : canShare && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" disabled={!!sharing} style={{ ...BTN, background: '#16a34a', color: '#fff' }} onClick={() => shareVia('whatsapp')}>
                  <Whatsapp width={14} height={14} /> {sharing === 'whatsapp' ? t('inspection.opening', 'Opening…') : t('inspection.whatsapp', 'WhatsApp')}
                </button>
                <button type="button" disabled={!!sharing || (share && !share.can_email)}
                  title={share && !share.can_email ? t('inspection.no_email', 'No e-mail on file for this customer') : undefined}
                  style={{ ...BTN, background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe', opacity: share && !share.can_email ? 0.5 : 1 }}
                  onClick={() => shareVia('email')}>
                  <SendMail width={14} height={14} /> {sharing === 'email' ? t('inspection.sending', 'Sending…') : t('inspection.email', 'E-mail')}
                </button>
                <button type="button" disabled={!!sharing} style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => shareVia('link')}>
                  <Copy width={14} height={14} /> {t('inspection.copy_link', 'Copy link')}
                </button>
              </div>
            )}
          </div>
          {canShare && !share.can_email && !share.work_order_cancelled && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>{t('inspection.no_email_hint', 'No e-mail on file for this customer — add it on the job card, or use WhatsApp / the link.')}</p>
          )}
          {shareNote && <p role="status" style={{ margin: '8px 0 0', fontSize: 12.5, color: '#15803d', fontWeight: 600 }}>{shareNote}</p>}
          {errorHere('share')}
          {canShare && share.url && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input readOnly aria-label={t('inspection.customer_link', 'Customer link')} value={share.url} dir="ltr" onFocus={e => e.target.select()}
                style={{ ...INPUT, flex: 1, minWidth: 0, fontSize: 12, color: '#475569', background: '#f8fafc' }} />
              <button type="button" disabled={!!sharing} title={t('inspection.new_link_title', 'The current link stops working; the next send makes a new one')}
                style={{ ...BTN, padding: '7px 10px', background: '#fff', color: '#64748b', borderColor: '#e2e8f0', flexShrink: 0 }} onClick={resetLink}>
                {t('inspection.new_link', 'New link')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Next step ── at the end of the form (the same action is at the top). */}
      <div className="vi-no-print" style={{
        marginTop: 8, marginBottom: 24, background: isCompleted ? '#f0fdf4' : '#fff',
        border: `1px solid ${isCompleted ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: 12, padding: '12px 16px',
        boxShadow: '0 -4px 14px rgba(15,23,42,.06)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: '1 1 260px', minWidth: 0, fontSize: 13, color: '#334155' }}>
          {!isCompleted ? (
            <><b style={{ color: '#1e3a6b' }}>{inspectionType === 'joint' ? t('inspection.bar_joint', 'Handover inspection') : t('inspection.bar_intake', 'Step 4 · Technical inspection')}</b>
              {' — '}{mode === 'document'
                ? t('inspection.bar_document', 'upload the paper form, then complete the inspection.')
                : t('inspection.bar_form', 'mark what you find, then complete the inspection.')}</>
          ) : inspectionType === 'joint' ? (
            <><b style={{ color: '#15803d' }}>{t('inspection.bar_done', 'Inspection completed.')}</b> {t('inspection.bar_done_joint', 'Continue on the job card.')}</>
          ) : estimate ? (
            <><b style={{ color: '#15803d' }}>{t('inspection.bar_done', 'Inspection completed.')}</b> {t('inspection.bar_done_estimate', 'Next: the estimate {{n}} (process steps 4–5).', { n: estimate.estimate_number })}</>
          ) : (
            <><b style={{ color: '#15803d' }}>{t('inspection.bar_done', 'Inspection completed.')}</b> {t('inspection.bar_done_pricing', 'Next (process step 4): pricing — the Service Advisor raises the estimate with the findings; the Storekeeper prices the parts.')}</>
          )}
        </div>
        <button type="button" style={{ ...BTN, background: '#f1f5f9', color: '#334155' }} onClick={() => navigate(`/work-orders/${id}`)}>
          <ArrowLeft width={14} height={14} /> {t('inspection.back_to_job_card', 'Back to job card')}
        </button>
        {!isCompleted ? (
          <>
            <button type="button" disabled={saving} style={{ ...BTN, background: '#fff', color: '#1e3a6b', borderColor: '#c7d2fe' }} onClick={() => save({ at: 'bar' })}>
              <Check width={14} height={14} /> {saving ? t('inspection.saving', 'Saving…') : t('inspection.save_draft', 'Save draft')}
            </button>
            <button type="button" disabled={saving || uploading} style={{ ...BTN, background: '#16a34a', color: '#fff' }} onClick={() => complete('bar')}>
              {t('inspection.complete', 'Complete inspection')} <NavArrowRight width={14} height={14} />
            </button>
          </>
        ) : inspectionType !== 'joint' && (
          estimate ? (
            <button type="button" style={{ ...BTN, background: '#ea580c', color: '#fff' }} onClick={() => navigate(`/estimates?id=${estimate.id}`)}>
              {t('inspection.open_estimate', 'Open the estimate')} <NavArrowRight width={14} height={14} />
            </button>
          ) : canDo(user, 'estimate.raise') ? (
            <button type="button" style={{ ...BTN, background: '#ea580c', color: '#fff' }} onClick={() => navigate(`/estimates?new=1&wo=${id}`)}>
              {t('inspection.raise_estimate', 'Raise the estimate')} <NavArrowRight width={14} height={14} />
            </button>
          ) : null
        )}
        {errorHere('bar')}
      </div>
    </div>
  );
}
