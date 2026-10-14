/**
 * PortalInspection — the customer's copy of a vehicle inspection inside the
 * portal, and where they sign it.
 *
 * The same content as the public inspection link (InspectionLink.jsx): the
 * damage marked on the diagram (read-only CarDamageDiagram) or the pages of
 * the paper form, what was recommended, and the signature. When the
 * walk-around was finished without the customer at the car, they sign here:
 * their name, the pad, and the confirmation sentence, then
 * POST /customer-portal/inspections/:id/sign. Once only — the server refuses
 * a second signature (409) and this then shows the one that won.
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { EditPencil, Check, WarningTriangle, Page } from 'iconoir-react';
import CarDamageDiagram, { DAMAGE_COLORS, damageLabel, viewLabel } from '../../components/CarDamageDiagram';
import api from '../../lib/customerApi';
import { fmtWhen } from '../../components/service-status/ServiceStatusCard';
import './PortalInspection.css';

/** Open a page of the paper form: fetched with the customer's login, shown from memory. */
async function openDocument(inspectionId, doc) {
  const win = window.open('', '_blank');
  try {
    const res = await api.raw(`/customer-portal/inspections/${inspectionId}/documents/${doc.id}`);
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    if (win) win.close();
    throw new Error('open failed');
  }
}

export default function PortalInspection({ inspection, autoFocusSign = false, onSigned }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [selected, setSelected] = useState('');
  const [docError, setDocError] = useState('');
  const insp = inspection;
  const handover = insp.type === 'joint';
  const marks = insp.marks || [];
  const docs = insp.documents || [];
  const views = [...new Set(marks.map(m => m.view))];
  const v = insp.vehicle || {};

  return (
    <article className="cpi" id={`inspection-${insp.id}`} aria-labelledby={`inspection-${insp.id}-title`}>
      <header className="cpi-head">
        <h3 className="cpi-title" id={`inspection-${insp.id}-title`}>
          {handover
            ? t('portal.inspection.title_handover', 'Vehicle inspection — handover')
            : t('portal.inspection.title_dropoff', 'Vehicle inspection — drop-off')}
        </h3>
        <p className="cpi-meta">
          {[insp.completed_at && fmtWhen(insp.completed_at, lang),
            [v.make, v.model].filter(Boolean).join(' '),
            v.plate,
            insp.odometer != null && t('portal.inspection.km', '{{n}} km', { n: Number(insp.odometer).toLocaleString(lang) })]
            .filter(Boolean).join(' · ')}
        </p>
        {insp.needs_signature
          ? <span className="cpi-badge cpi-badge-todo">{t('portal.inspection.to_sign', 'Waiting for your signature')}</span>
          : insp.signature?.signed
            ? <span className="cpi-badge cpi-badge-ok"><Check width={14} height={14} aria-hidden="true" /> {t('portal.inspection.signed', 'Signed')}</span>
            : null}
      </header>

      {insp.entry_mode === 'document' ? (
        <section className="cpi-section">
          <h4>{t('portal.inspection.paper_form', 'Inspection form')}</h4>
          <p className="cpi-muted">{t('portal.inspection.paper_form_hint', 'The inspection was done on the paper form at the workshop.')}</p>
          {docError && <p className="cpi-error" role="alert">{docError}</p>}
          {docs.length === 0 ? (
            <p className="cpi-muted">{t('portal.inspection.no_docs', 'No pages attached.')}</p>
          ) : (
            <ul className="cpi-docs">
              {docs.map(d => (
                <li key={d.id}>
                  <span className="cpi-doc-name"><Page width={16} height={16} aria-hidden="true" /> {d.name}</span>
                  <button type="button" className="cp-btn cp-btn-outline"
                    onClick={() => { setDocError(''); openDocument(insp.id, d).catch(() => setDocError(t('portal.inspection.doc_failed', "Couldn't open the page. Please try again."))); }}>
                    {t('portal.inspection.open', 'Open')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="cpi-section">
          <h4>{t('portal.inspection.damage_n', 'Marked damage ({{n}})', { n: marks.length })}</h4>
          {marks.length === 0 ? (
            <p className="cpi-muted">{t('portal.inspection.no_damage', 'No damage was marked during the inspection.')}</p>
          ) : (
            <>
              <div className="cpi-diagram">
                <CarDamageDiagram compact marks={marks} views={views}
                  selectedMarkId={selected} onSelectMark={setSelected} />
              </div>
              <ol className="cpi-marks">
                {marks.map((m, i) => (
                  <li key={m.id}>
                    <button type="button" className={`cpi-mark${m.id === selected ? ' is-on' : ''}`} onClick={() => setSelected(m.id)}>
                      <span className="cpi-mark-n">{i + 1}</span>
                      <span className="cpi-mark-code" style={{ background: DAMAGE_COLORS[m.code] || '#dc2626' }}>{m.code}</span>
                      <span className="cpi-mark-main">
                        <span className="cpi-mark-label">{damageLabel(t, m.code, m.label)}</span>
                        <span className="cpi-mark-view">{viewLabel(t, m.view)}</span>
                        {m.note && <span className="cpi-mark-note">{m.note}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      {(insp.service_recommended || insp.notes) && (
        <section className="cpi-section">
          {insp.service_recommended && (<>
            <h4>{t('portal.inspection.service_recommended', 'Service recommended')}</h4>
            <p className="cpi-text">{insp.service_recommended}</p>
          </>)}
          {insp.notes && (<>
            <h4>{t('portal.inspection.notes', 'Notes')}</h4>
            <p className="cpi-text">{insp.notes}</p>
          </>)}
        </section>
      )}

      <section className="cpi-section">
        <h4>{t('portal.inspection.signature', 'Your signature')}</h4>
        {insp.signature?.signed ? (
          <div className="cpi-signed">
            {insp.signature.image_url && <img src={insp.signature.image_url} alt={t('portal.inspection.signature_alt', 'Your signature')} />}
            <p>
              {insp.signature.signed_by_name
                ? t('portal.inspection.signed_by', 'Signed by {{name}} on {{date}}', { name: insp.signature.signed_by_name, date: fmtWhen(insp.signature.signed_at, lang) })
                : t('portal.inspection.signed_on', 'Signed on {{date}}', { date: fmtWhen(insp.signature.signed_at, lang) })}
              {' · '}
              {insp.signature.signed_via === 'portal'
                ? t('portal.inspection.via_portal', 'in the customer portal')
                : insp.signature.signed_via === 'link'
                  ? t('portal.inspection.via_remote', 'signed online')
                  : t('portal.inspection.via_on_site', 'at the workshop')}
            </p>
          </div>
        ) : insp.entry_mode === 'document' ? (
          <p className="cpi-muted">{t('portal.inspection.paper_signed', 'You signed the paper form at the workshop.')}</p>
        ) : insp.needs_signature ? (
          <SignForm inspection={insp} autoFocus={autoFocusSign} onSigned={onSigned} />
        ) : (
          <p className="cpi-muted">{t('portal.inspection.cannot_sign', 'This job is closed, so the inspection can no longer be signed here. Please contact the workshop.')}</p>
        )}
      </section>
    </article>
  );
}

/** Name + signature pad (touch and mouse) + the confirmation, then Sign. */
function SignForm({ inspection, autoFocus, onSigned }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const nameRef = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const handover = inspection.type === 'joint';

  useEffect(() => {
    if (!autoFocus) return;
    const el = document.getElementById(`inspection-${inspection.id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 400);
  }, [autoFocus, inspection.id]);

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e) => {
    if (busy) return;
    e.preventDefault();
    drawing.current = true;
    setError('');
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f172a';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y); ctx.stroke();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setHasInk(true);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.lineTo(x, y); ctx.stroke();
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const sign = async () => {
    if (!name.trim()) { setError(t('portal.inspection.err_name', 'Please type your name.')); return; }
    if (!hasInk) { setError(t('portal.inspection.err_signature', 'Please sign in the box.')); return; }
    if (!confirmed) { setError(t('portal.inspection.err_confirm', 'Please tick the box to confirm.')); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post(`/customer-portal/inspections/${inspection.id}/sign`, {
        name: name.trim(), confirmed: true, signature: canvasRef.current.toDataURL('image/png'),
      });
      if (!res.success) {
        setError(res.message || t('portal.inspection.err_sign', 'Could not save your signature. Please try again.'));
        // Signed meanwhile (at the workshop), or the job closed: show that instead.
        if (res.status === 409 || res.status === 410) onSigned?.();
        return;
      }
      onSigned?.(res.data);
    } catch {
      setError(t('portal.network_error', 'Connection problem. Check your internet and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cpi-sign">
      <p className="cpi-muted">{t('portal.inspection.sign_intro', 'Please check the inspection above. If it matches your vehicle, sign below.')}</p>
      <label className="cp-form-group">
        <span className="cp-form-label">{t('portal.inspection.your_name', 'Your full name')}</span>
        <input ref={nameRef} className="cp-form-input" value={name} maxLength={150} autoComplete="name"
          onChange={e => { setName(e.target.value); setError(''); }} disabled={busy} />
      </label>
      <div className="cpi-pad-head">
        <span className="cp-form-label">{t('portal.inspection.sign_here', 'Sign here')}</span>
        <button type="button" className="cp-btn cp-btn-outline" onClick={clear} disabled={busy || !hasInk}>
          {t('portal.inspection.clear', 'Clear')}
        </button>
      </div>
      <canvas ref={canvasRef} className="cpi-pad" width={600} height={220} dir="ltr"
        aria-label={t('portal.inspection.sign_here', 'Sign here')}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end} />
      <label className="cpi-confirm">
        <input type="checkbox" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); setError(''); }} disabled={busy} />
        <span>{handover
          ? t('portal.inspection.confirm_handover', 'I confirm this is the condition of my vehicle at handover.')
          : t('portal.inspection.confirm_dropoff', 'I confirm this is the condition of my vehicle at drop-off.')}</span>
      </label>
      {error && <div className="cp-alert cp-alert-error" role="alert"><WarningTriangle width={16} height={16} aria-hidden="true" /> <span>{error}</span></div>}
      <button type="button" className="cp-btn cp-btn-primary cp-btn-block" onClick={sign} disabled={busy}>
        <EditPencil width={16} height={16} />
        {busy ? t('portal.inspection.signing', 'Signing…') : t('portal.inspection.sign', 'Sign the inspection')}
      </button>
    </div>
  );
}
