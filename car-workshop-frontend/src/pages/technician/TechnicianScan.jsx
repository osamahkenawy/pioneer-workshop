/**
 * TechnicianScan — "Scan job card" (/mechanic/scan).
 *
 * Finds the technician's job card from:
 *   1. the QR on the printed job sheet (the customer status link,
 *      /service-status/:token or /track/:token — lib/customerLink.js
 *      extractStatusToken() takes the token out);
 *   2. the car's VIN barcode (Code 39 / Code 128 / Data Matrix / QR);
 *   3. what is typed: job card number, WO number, plate, full VIN or its
 *      last 6 characters.
 * GET /api/job-cards/mine/lookup?code= answers; a scan only looks the job
 * up and opens it. It changes nothing.
 *
 *   one of my cards     → its page (/mechanic/jobs/:id)
 *   several of mine     → a list to pick from
 *   someone else's      → "Not assigned to you — ask your Team Leader" (403 NOT_YOURS)
 *   nothing             → "No open job card for this car" (404)
 *
 * Decoding: the browser's BarcodeDetector where it has one (Chrome on
 * Android), otherwise ZXing (@zxing/browser, loaded only when needed), so
 * iPhone Safari reads VIN barcodes too. No location is used.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, Search, WarningTriangle, Lock, NavArrowRight, Refresh } from 'iconoir-react';
import api from '../../lib/api';
import { extractStatusToken } from '../../lib/customerLink';
import { jcLabel, jcTone } from '../../lib/statusLabels';
import { cardKindLabel } from '../../components/technician/format';
import '../../components/technician/technician.css';

/** BarcodeDetector names of the codes on a job sheet and a car. */
const NATIVE_FORMATS = ['qr_code', 'code_39', 'code_128', 'data_matrix'];

/**
 * Starts decoding frames of `video`; calls onCode(text) for each code read.
 * Returns a stop function.
 */
async function startDecoder(video, onCode) {
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const supported = (await window.BarcodeDetector.getSupportedFormats?.()) || NATIVE_FORMATS;
      const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
      if (formats.length) {
        const detector = new window.BarcodeDetector({ formats });
        let stopped = false;
        let timer = null;
        const tick = async () => {
          if (stopped) return;
          if (video.readyState >= 2) {
            try {
              const hit = (await detector.detect(video)).find(c => c.rawValue);
              if (hit && !stopped) onCode(hit.rawValue);
            } catch { /* a frame that could not be read */ }
          }
          if (!stopped) timer = setTimeout(tick, 200);
        };
        tick();
        return () => { stopped = true; clearTimeout(timer); };
      }
    } catch { /* no usable detector: ZXing below */ }
  }
  const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([
    import('@zxing/browser'), import('@zxing/library'),
  ]);
  const hints = new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_39, BarcodeFormat.CODE_128, BarcodeFormat.DATA_MATRIX]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
  const controls = await reader.decodeFromVideoElement(video, (result) => {
    if (result) onCode(result.getText());
  });
  return () => controls.stop();
}

export default function TechnicianScan() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const videoRef = useRef(null);
  const inputRef = useRef(null);
  const streamRef = useRef(null);
  const stopDecodeRef = useRef(null);
  const alive = useRef(true);
  const lookingUp = useRef(false);
  const [camera, setCamera] = useState('starting');   // starting | on | off | denied | unavailable
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);          // { kind: 'many'|'not_yours'|'none'|'short'|'error', … }
  const resultRef = useRef(null);

  // On a phone the camera fills the screen: bring the answer into view.
  useEffect(() => {
    if (!result || result.kind === 'short') return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    resultRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [result]);

  const stopCamera = useCallback(() => {
    try { stopDecodeRef.current?.(); } catch { /* already stopped */ }
    stopDecodeRef.current = null;
    streamRef.current?.getTracks().forEach(tr => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const lookup = useCallback(async (raw) => {
    const value = extractStatusToken(raw);
    if (value.replace(/[\s-]+/g, '').length < 3) { setResult({ kind: 'short' }); inputRef.current?.focus(); return; }
    if (lookingUp.current) return;
    lookingUp.current = true;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.get(`/job-cards/mine/lookup?code=${encodeURIComponent(value)}`);
      if (!alive.current) return;
      if (res.success && Array.isArray(res.data)) {
        if (res.data.length === 1) { navigateRef.current(`/mechanic/jobs/${res.data[0].id}`); return; }
        setResult({ kind: 'many', cards: res.data });
      } else if (res.code === 'NOT_YOURS') {
        setResult({ kind: 'not_yours', match: res.match || null });
      } else if (res.status === 404) {
        // Show what was typed; a scanned status link shows as "this code".
        setResult({ kind: 'none', code: value === String(raw).trim() ? value : '' });
      } else if (res.code === 'CODE_TOO_SHORT') {
        setResult({ kind: 'short' });
      } else {
        setResult({ kind: 'error', message: res.message });
      }
    } catch {
      if (alive.current) setResult({ kind: 'error' });
    } finally {
      lookingUp.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const onCode = useCallback((text) => {
    if (lookingUp.current) return;
    stopCamera();
    setCamera('off');
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch { /* not allowed */ } }
    const value = extractStatusToken(text);
    // Keep a scanned customer link out of the field; a VIN or number goes in.
    setCode(value === String(text).trim() ? value : '');
    lookup(text);
  }, [lookup, stopCamera]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      inputRef.current?.focus();
      return;
    }
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      if (!alive.current) { stream.getTracks().forEach(tr => tr.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setCamera('on');
      stopDecodeRef.current = await startDecoder(video, onCode);
      if (!streamRef.current) { stopDecodeRef.current?.(); stopDecodeRef.current = null; }
    } catch (err) {
      if (!alive.current) return;
      stopCamera();
      setCamera(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'unavailable');
      inputRef.current?.focus();
    }
  }, [onCode, stopCamera]);

  useEffect(() => {
    alive.current = true;
    startCamera();
    const onHide = () => { if (document.visibilityState === 'hidden') { stopCamera(); setCamera('off'); } };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onHide);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const submit = (e) => {
    e.preventDefault();
    if (camera === 'on' || camera === 'starting') { stopCamera(); setCamera('off'); }
    lookup(code);
  };

  return (
    <div className="tk-page tk-scan">
      <h1 className="tk-page-title">{t('technician.scan_job_card', 'Scan job card')}</h1>

      <div className={`tk-camera is-${camera}`}>
        <video ref={videoRef} className="tk-camera-video" playsInline muted autoPlay aria-hidden="true" />
        {camera === 'on' && <div className="tk-camera-frame" aria-hidden="true" />}
        {camera !== 'on' && (
          <div className="tk-camera-msg">
            {camera === 'starting' && <><span className="tk-spin" aria-hidden="true" /><span>{t('technician.camera_starting', 'Starting the camera…')}</span></>}
            {camera === 'denied' && <><WarningTriangle width={22} height={22} aria-hidden="true" /><span>{t('technician.camera_denied', 'The camera is blocked. Allow it in the browser settings, or type the number below.')}</span></>}
            {camera === 'unavailable' && <><WarningTriangle width={22} height={22} aria-hidden="true" /><span>{t('technician.camera_unavailable', 'No camera found. Type the number below.')}</span></>}
            {(camera === 'off' || camera === 'denied' || camera === 'unavailable') && (
              <button type="button" className="tk-btn tk-btn--light" onClick={startCamera}>
                <Camera width={18} height={18} aria-hidden="true" />
                {camera === 'off' ? t('technician.scan_again', 'Scan again') : t('technician.camera_retry', 'Try the camera again')}
              </button>
            )}
          </div>
        )}
      </div>
      <p className="tk-hint">{t('technician.scan_hint', 'Point the camera at the QR code on the job sheet, or at the VIN barcode.')}</p>

      <form className="tk-findform" onSubmit={submit}>
        <label htmlFor="tk-code" className="tk-field-label">{t('technician.scan_manual', 'Plate, WO number, job card number or VIN')}</label>
        <div className="tk-findrow">
          <input id="tk-code" ref={inputRef} className="tk-input" value={code} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            enterKeyHint="search" onChange={e => setCode(e.target.value)} />
          <button type="submit" className="tk-btn tk-btn--dark" disabled={busy}>
            {busy ? <span className="tk-spin" aria-hidden="true" /> : <Search width={18} height={18} aria-hidden="true" />}
            {t('technician.find', 'Find')}
          </button>
        </div>
      </form>

      <div aria-live="polite" ref={resultRef}>
        {result?.kind === 'many' && (
          <section className="tk-results" aria-labelledby="tk-results-title">
            <h2 id="tk-results-title" className="tk-panel-title">{t('technician.scan_pick', 'Your job cards on this car')}</h2>
            <ul className="tk-result-list">
              {result.cards.map(c => {
                const tone = jcTone(c.status);
                return (
                  <li key={c.id}>
                    <Link to={`/mechanic/jobs/${c.id}`} className="tk-result-row">
                      <span className="tk-result-plate">{c.plate_number || c.work_order_number}</span>
                      <span className="tk-result-ref">{c.job_card_number} · {cardKindLabel(t, c)}</span>
                      <span className="tk-chip" style={{ background: tone.bg, color: tone.color }}>{jcLabel(t, c.status)}</span>
                      <NavArrowRight width={18} height={18} aria-hidden="true" className="tk-flip" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {result?.kind === 'not_yours' && (
          <div className="tk-alert tk-alert--amber tk-alert--big">
            <Lock width={22} height={22} aria-hidden="true" />
            <div>
              <div className="tk-alert-title">{t('technician.not_yours', 'Not assigned to you — ask your Team Leader.')}</div>
              {result.match && (
                <div className="tk-alert-sub">
                  {[result.match.plate_number, [result.match.make, result.match.model].filter(Boolean).join(' '), result.match.work_order_number].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </div>
        )}
        {result?.kind === 'none' && (
          <div className="tk-alert tk-alert--grey tk-alert--big">
            <Search width={22} height={22} aria-hidden="true" />
            <div>
              <div className="tk-alert-title">{t('technician.not_found_title', 'No open job card for this car.')}</div>
              <div className="tk-alert-sub">
                {result.code
                  ? t('technician.not_found', { code: result.code, defaultValue: 'No job card found for "{{code}}". Check the number and try again.' })
                  : t('technician.not_found_scan', 'Check the job sheet, or type the number.')}
              </div>
            </div>
          </div>
        )}
        {result?.kind === 'short' && (
          <p className="tk-form-error" role="alert">{t('technician.code_short', 'Type at least 3 characters.')}</p>
        )}
        {result?.kind === 'error' && (
          <div className="tk-banner tk-banner--error" role="alert">
            <WarningTriangle width={18} height={18} aria-hidden="true" />
            <span>{result.message || t('technician.network_error', 'No connection. Try again.')}</span>
            <button type="button" className="tk-btn tk-btn--ghost tk-btn--sm" onClick={() => lookup(code)}>
              <Refresh width={16} height={16} aria-hidden="true" /> {t('technician.retry', 'Retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
