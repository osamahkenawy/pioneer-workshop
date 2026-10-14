/**
 * InspectionLink — public, no-login page a customer reaches from the link the
 * workshop sends once the walk-around is completed (routes/vehicle-inspections.js
 * POST /:id/share, by WhatsApp or e-mail). Same shape as EstimateApproval.jsx:
 * plain fetch against /api/public/..., no auth headers, its own small CSS file,
 * built phone-first.
 *
 * It is the customer's copy of what was recorded at the car — the damage
 * marked on the diagram (drawn read-only with the staff form's
 * CarDamageDiagram) or the uploaded paper form — and, when they did not sign
 * at the car, where they sign. Signing is once only; the server refuses a
 * second, and a cancelled job's link closes (410).
 *
 * Words: t('inspectionLink.*', 'English default'); the damage codes and view
 * names are the staff form's (inspection.code.*, inspection.view.*), and the
 * cancelled state is the shared customer status (lib/statusLabels.js).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CarDamageDiagram, { DAMAGE_COLORS, damageLabel, viewLabel } from '../components/CarDamageDiagram';
import { woLabel } from '../lib/statusLabels';
import { logoSrc } from '../components/service-status/workshopLogo';
import './InspectionLink.css';

/** The Pioneer mark (with "Car Service Center"), used when the workshop has no logo of its own. */
const PIONEER_LOGO = '/assets/images/logos/pioneer/pioneer_logo_main.svg';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// The API sends 'YYYY-MM-DD HH:MM:SS'; Safari only parses it with the T.
const fmtDate = d => (d ? new Date(String(d).replace(' ', 'T')).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function InspectionLink() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | ready | invalid | closed | error
  const [workshop, setWorkshop] = useState(null);
  const [insp, setInsp] = useState(null);
  const [selectedMarkId, setSelectedMarkId] = useState('');
  const [justSigned, setJustSigned] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/public/inspections/${token}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 410) { setPhase('closed'); return; }
      if (res.status >= 500 || res.status === 429) { setPhase('error'); return; }
      if (!res.ok || !json.success) { setPhase('invalid'); return; }
      setWorkshop(json.workshop || {});
      setInsp(json.inspection);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (phase === 'loading') {
    return <div className="il-page"><div className="il-card il-center"><div className="il-spinner" aria-hidden />{t('inspectionLink.loading', 'Loading your inspection…')}</div></div>;
  }
  if (phase === 'invalid') {
    return <div className="il-page"><div className="il-card il-center">
      <h1>{t('inspectionLink.invalid_title', 'Link not found')}</h1>
      <p>{t('inspectionLink.invalid_body', "This inspection link isn't valid. Please contact the workshop for a new one.")}</p>
    </div></div>;
  }
  if (phase === 'closed') {
    return <div className="il-page"><div className="il-card il-center">
      <h1>{woLabel(t, 'cancelled', 'customer')}</h1>
      <p>{t('inspectionLink.closed_body', 'This job was cancelled, so its inspection is no longer available here. Please contact the workshop.')}</p>
    </div></div>;
  }
  if (phase === 'error') {
    return <div className="il-page"><div className="il-card il-center">
      <h1>{t('inspectionLink.error_title', 'Something went wrong')}</h1>
      <p>{t('inspectionLink.error_body', 'Please check your connection and refresh the page, or contact the workshop directly.')}</p>
      <button type="button" className="il-btn il-btn-ghost il-retry" onClick={() => { setPhase('loading'); load(); }}>
        {t('inspectionLink.retry', 'Try again')}
      </button>
    </div></div>;
  }

  const handover = insp.type === 'joint';
  const v = insp.vehicle || {};
  const marks = insp.marks || [];
  const docs = insp.documents || [];
  const markedViews = [...new Set(marks.map(m => m.view))];
  const docUrl = d => `${API_BASE}/public/inspections/${token}/documents/${d.id}`;
  const vehicleName = [v.make, v.model, v.year].filter(Boolean).join(' ');

  return (
    <div className="il-page">
      <div className="il-card">
        <div className="il-header">
          <div className="il-brand-row">
            <img
              className="il-logo"
              src={workshop.logo_url ? logoSrc(workshop.logo_url) : PIONEER_LOGO}
              alt={workshop.name || 'Pioneer Car Service Center'}
              onError={e => { if (!e.currentTarget.src.endsWith(PIONEER_LOGO)) e.currentTarget.src = PIONEER_LOGO; }}
            />
          </div>
          <h1>{handover
            ? t('inspectionLink.title_handover', 'Vehicle inspection — handover')
            : t('inspectionLink.title_checkin', 'Vehicle inspection — check-in')}</h1>
          <div className="il-meta">
            <span>{t('inspectionLink.job_card_n', 'Job card {{n}}', { n: insp.work_order_number })}</span>
            {insp.completed_at && <span>{fmtDate(insp.completed_at)}</span>}
          </div>
        </div>

        {/* ── Vehicle ── */}
        <section className="il-section">
          <h2>{t('inspectionLink.vehicle', 'Vehicle')}</h2>
          <dl className="il-facts">
            {vehicleName && <div><dt>{t('inspectionLink.make_model', 'Make / model')}</dt><dd>{vehicleName}</dd></div>}
            {v.plate && <div><dt>{t('inspectionLink.plate', 'Plate')}</dt><dd><span className="il-plate">{v.plate}</span></dd></div>}
            {v.vin_last6 && <div><dt>{t('inspectionLink.vin', 'VIN')}</dt><dd dir="ltr">…{v.vin_last6}</dd></div>}
            {insp.odometer != null && <div><dt>{t('inspectionLink.odometer', 'Odometer')}</dt><dd>{t('inspectionLink.km', '{{n}} km', { n: Number(insp.odometer).toLocaleString() })}</dd></div>}
          </dl>
        </section>

        {/* ── What was recorded: the diagram, or the uploaded paper form ── */}
        {insp.entry_mode === 'document' ? (
          <section className="il-section">
            <h2>{t('inspectionLink.paper_form', 'Inspection form')}</h2>
            <p className="il-muted">{t('inspectionLink.paper_form_hint', 'The inspection was done on the paper form at the workshop. Here are the pages:')}</p>
            {docs.length === 0 ? (
              <p className="il-muted">{t('inspectionLink.no_docs', 'No pages attached.')}</p>
            ) : (
              <ul className="il-docs">
                {docs.map(d => (String(d.type || '').startsWith('image/') ? (
                  <li key={d.id} className="il-doc il-doc-img">
                    <a href={docUrl(d)} target="_blank" rel="noopener noreferrer">
                      <img src={docUrl(d)} alt={d.name} loading="lazy" />
                    </a>
                  </li>
                ) : (
                  <li key={d.id} className="il-doc">
                    <span className="il-doc-name">{d.name}</span>
                    <a className="il-btn il-btn-ghost il-btn-sm" href={docUrl(d)} target="_blank" rel="noopener noreferrer">
                      {t('inspectionLink.open', 'Open')}
                    </a>
                  </li>
                )))}
              </ul>
            )}
          </section>
        ) : (
          <section className="il-section">
            <h2>{t('inspectionLink.damage_n', 'Marked damage ({{n}})', { n: marks.length })}</h2>
            {marks.length === 0 ? (
              <p className="il-muted">{t('inspectionLink.no_damage', 'No damage was marked during the inspection.')}</p>
            ) : (
              <>
                <div className="il-diagram">
                  <CarDamageDiagram compact marks={marks} views={markedViews}
                    selectedMarkId={selectedMarkId} onSelectMark={setSelectedMarkId} />
                </div>
                <ol className="il-marks">
                  {marks.map((m, i) => (
                    <li key={m.id} className={m.id === selectedMarkId ? 'il-mark il-mark-on' : 'il-mark'}>
                      <button type="button" onClick={() => setSelectedMarkId(m.id)}>
                        <span className="il-mark-n">{i + 1}</span>
                        <span className="il-mark-code" style={{ background: DAMAGE_COLORS[m.code] || '#dc2626' }}>{m.code}</span>
                        <span className="il-mark-main">
                          <span className="il-mark-label">{damageLabel(t, m.code, m.label)}</span>
                          <span className="il-mark-view">{viewLabel(t, m.view)}</span>
                          {m.note && <span className="il-mark-note">{m.note}</span>}
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
          <section className="il-section">
            {insp.service_recommended && (<>
              <h2>{t('inspectionLink.service_recommended', 'Service recommended')}</h2>
              <p className="il-text">{insp.service_recommended}</p>
            </>)}
            {insp.notes && (<>
              <h2>{t('inspectionLink.notes', 'Notes')}</h2>
              <p className="il-text">{insp.notes}</p>
            </>)}
          </section>
        )}

        {/* ── Signature ── */}
        <section className="il-section">
          <h2>{t('inspectionLink.signature', 'Your signature')}</h2>
          {insp.signature.signed ? (
            <div className="il-signed">
              {justSigned && (
                <div className="il-banner il-banner-ok" role="status">
                  {t('inspectionLink.thanks', 'Thank you — your signature has been recorded. This page stays available as your copy.')}
                </div>
              )}
              {insp.signature.image_url && <img src={insp.signature.image_url} alt={t('inspectionLink.signature_alt', 'Customer signature')} />}
              <p>
                {insp.signature.signed_by_name
                  ? t('inspectionLink.signed_by', 'Signed by {{name}} on {{date}}', { name: insp.signature.signed_by_name, date: fmtDate(insp.signature.signed_at) })
                  : t('inspectionLink.signed_on', 'Signed on {{date}}', { date: fmtDate(insp.signature.signed_at) })}
                {' · '}
                {insp.signature.signed_via === 'link'
                  ? t('inspectionLink.via_link', 'from this link')
                  : insp.signature.signed_via === 'portal'
                    ? t('inspectionLink.via_portal', 'in the customer portal')
                    : t('inspectionLink.via_on_site', 'at the workshop')}
              </p>
            </div>
          ) : insp.entry_mode === 'document' ? (
            <p className="il-muted">{t('inspectionLink.paper_signed', 'You signed the paper form at the workshop — it is attached above.')}</p>
          ) : insp.can_sign ? (
            <SignForm t={t} token={token} handover={handover}
              onSigned={sig => { setInsp(i => ({ ...i, signature: sig, can_sign: false })); setJustSigned(true); }}
              onStale={load} />
          ) : (
            <p className="il-muted">{t('inspectionLink.cannot_sign', 'This job is closed, so the inspection can no longer be signed here. Please contact the workshop.')}</p>
          )}
        </section>

        {workshop.phone && (
          <p className="il-contact">
            {t('inspectionLink.questions', 'Questions about your vehicle?')}{' '}
            <a href={`tel:${String(workshop.phone).replace(/[^\d+]/g, '')}`} dir="ltr">{workshop.phone}</a>
          </p>
        )}
      </div>
    </div>
  );
}

/** Name + signature pad (touch and mouse) + the confirmation, then Sign. */
function SignForm({ t, token, handover, onSigned, onStale }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    if (!name.trim()) { setError(t('inspectionLink.err_name', 'Please type your name.')); return; }
    if (!hasInk) { setError(t('inspectionLink.err_signature', 'Please sign in the box.')); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/public/inspections/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), signature: canvasRef.current.toDataURL('image/png') }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.message || t('inspectionLink.err_sign', 'Could not save your signature. Please try again.'));
        // Signed meanwhile (at the workshop), or the link closed: show that instead.
        if (res.status === 409 || res.status === 410) await onStale();
        return;
      }
      onSigned(json.signature);
    } catch {
      setError(t('inspectionLink.err_network', 'Network error — please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="il-sign-form">
      <p className="il-muted">{t('inspectionLink.sign_intro', 'Please check the inspection above. If it matches your vehicle, sign below.')}</p>
      <label className="il-field">
        {t('inspectionLink.your_name', 'Your full name')}
        <input value={name} onChange={e => { setName(e.target.value); setError(''); }} maxLength={150} autoComplete="name"
          placeholder={t('inspectionLink.name_ph', 'Full name')} disabled={busy} />
      </label>
      <div className="il-pad-head">
        <span>{t('inspectionLink.sign_here', 'Sign here')}</span>
        <button type="button" className="il-link-btn" onClick={clear} disabled={busy || !hasInk}>
          {t('inspectionLink.clear', 'Clear')}
        </button>
      </div>
      <canvas ref={canvasRef} className="il-pad" width={600} height={220} dir="ltr"
        aria-label={t('inspectionLink.sign_here', 'Sign here')}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end} />
      <p className="il-confirm">
        {handover
          ? t('inspectionLink.confirm_handover', 'I confirm this is the condition of my vehicle at handover.')
          : t('inspectionLink.confirm_checkin', 'I confirm this is the condition of my vehicle at check-in.')}
      </p>
      {error && <div className="il-banner il-banner-warn" role="alert">{error}</div>}
      <button type="button" className="il-btn il-btn-primary" onClick={sign} disabled={busy}>
        {busy ? t('inspectionLink.signing', 'Signing…') : t('inspectionLink.sign', 'Sign')}
      </button>
    </div>
  );
}
