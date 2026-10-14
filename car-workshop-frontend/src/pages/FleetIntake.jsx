/**
 * FleetIntake — the vehicle information section, on its own page.
 *
 * Opened from a tokenised link by a fleet coordinator who has no login and
 * works for the fleet, not for Pioneer. It replaces a real piece of paper:
 * the "Work Order Generation" sheet a fleet supervisor fills in by hand and
 * sends over, which a service advisor then re-keys — and the re-keying is
 * where chassis numbers get lost.
 *
 * The token says which fleet is submitting, so the form never asks them to
 * pick a customer. It cannot get that wrong, and they cannot see anyone
 * else's vehicles.
 *
 * English or Arabic: the page has no app chrome, so it carries its own
 * language switch (the choice is remembered like the staff app's).
 */
import { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './FleetIntake.css';

const API = import.meta.env.VITE_API_URL || '/api';
const FieldError = createContext({ field: '', msg: '' });

const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
const WORK_TYPES = ['Maintenance', 'Accident', 'Breakdown', 'Service', 'Inspection', 'Other'];
const slug = s => s.toLowerCase().replace(/\W+/g, '_');

const EMPTY = {
  fleet_code: '', plate_number: '', plate_code: '', plate_emirate: '',
  make: '', model: '', year: '', color: '', vin: '', engine_no: '',
  odometer: '', complaint: '', work_type: '', external_ref: '',
  driver_name: '', driver_phone: '', permit_id: '', submitted_by: '',
  preferred_date: '',
};

/** Mileage as typed → Arabic-Indic digits converted, spaces and thousands
 *  commas dropped. Anything else ('12.5', '-500') stays, so the check refuses
 *  it rather than silently sending a different number. */
const normKm = v => String(v ?? '')
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0))
  .replace(/[\s,]/g, '');

export default function FleetIntake() {
  const { t, i18n } = useTranslation();
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [form, setForm] = useState({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [errField, setErrField] = useState(''); // the field the message is about (shown under it)
  const [done, setDone] = useState(null);
  const errRef = useRef(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isAr = i18n.language === 'ar';

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/public/fleet-intake/${token}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j.success) { setLink(j.data); setForm(f => ({ ...f, submitted_by: j.data.contact_name || '' })); }
        else setLoadError(j.message || t('fleetForm.link_invalid_msg', 'This link is no longer valid.'));
      })
      .catch(() => { if (!cancelled) setLoadError(t('fleetForm.unreachable', 'Could not reach the workshop. Check your connection and try again.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Picking one of their own vehicles fills the identity fields, so the
   * coordinator only types the three things that change per visit —
   * mileage, the complaint and who is driving. Retyping a chassis number
   * they have given us twenty times is exactly how it gets mistyped. */
  const pickVehicle = (v) => {
    if (!v) { setForm(f => ({ ...f, ...Object.fromEntries(Object.keys(EMPTY).slice(0, 10).map(k => [k, ''])) })); return; }
    setForm(f => ({
      ...f,
      fleet_code: v.fleet_code || '', plate_number: v.plate_number || '',
      plate_code: v.plate_code || '', plate_emirate: v.plate_emirate || '',
      make: v.make || '', model: v.model || '', year: v.year || '',
      color: v.color || '', vin: v.vin || '', engine_no: v.engine_no || '',
      // Mileage is deliberately NOT carried over. The stored figure is the
      // last reading we took, and offering it as today's is how an old
      // number gets submitted unchanged.
    }));
  };

  const selectedId = useMemo(() => {
    if (!link?.vehicles?.length) return '';
    const m = link.vehicles.find(v =>
      (form.vin && v.vin === form.vin) ||
      (form.plate_number && v.plate_number === form.plate_number));
    return m ? String(m.id) : '';
  }, [link, form.vin, form.plate_number]);

  // On a phone the form is long: the field to fix is scrolled to, focused
  // and gets the message under it (a server message sits by the Send
  // button), so tapping Send never "does nothing".
  const fail = (msg, field) => {
    setError(msg); setErrField(field || '');
    requestAnimationFrame(() => {
      const el = field && document.getElementById(`fi-${field}`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
      else errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setErrField('');
    if (!form.plate_number.trim() && !form.fleet_code.trim()) {
      return fail(t('fleetForm.err_plate_or_unit', 'Give either the plate number or your own unit code so we can identify the vehicle.'), 'plate_number');
    }
    // A vehicle we do not hold yet needs its make and model, or the
    // workshop cannot add it when booking it in.
    if (!selectedId && !form.make.trim()) return fail(t('fleetForm.err_make', 'Enter the make of the vehicle.'), 'make');
    if (!selectedId && !form.model.trim()) return fail(t('fleetForm.err_model', 'Enter the model of the vehicle.'), 'model');
    if (!form.vin.trim()) return fail(t('fleetForm.err_vin', 'VIN / chassis number is required.'), 'vin');
    const km = normKm(form.odometer);
    if (!km) return fail(t('fleetForm.err_km_required', 'Mileage (odometer reading) is required.'), 'odometer');
    if (!/^\d{1,7}$/.test(km)) return fail(t('fleetForm.err_km', 'Enter the mileage in whole kilometres, digits only.'), 'odometer');
    if (!form.complaint.trim()) return fail(t('fleetForm.err_fault', 'Describe the problem with the vehicle.'), 'complaint');
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/public/fleet-intake/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, odometer: km }),
      });
      const j = await res.json();
      if (j.success) { setDone(j.data); window.scrollTo({ top: 0 }); }
      else fail(j.message || t('fleetForm.send_failed', 'Could not send this form.'));
    } catch {
      fail(t('fleetForm.unreachable', 'Could not reach the workshop. Check your connection and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const langSwitch = (
    <button type="button" className="fi-lang" onClick={() => i18n.changeLanguage(isAr ? 'en' : 'ar')}
      lang={isAr ? 'en' : 'ar'} style={{ float: isAr ? 'left' : 'right', background: 'rgba(255,255,255,.12)', color: 'inherit',
        border: '1px solid rgba(255,255,255,.3)', borderRadius: 8, padding: '5px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
      {isAr ? 'English' : 'العربية'}
    </button>
  );

  if (loading) {
    return <div className="fi-shell"><div className="fi-card fi-center"><div className="fi-spinner" /><p>{t('fleetForm.opening', 'Opening the form…')}</p></div></div>;
  }

  if (loadError) {
    return (
      <div className="fi-shell">
        <div className="fi-card fi-center">
          <div className="fi-badIcon">!</div>
          <h1 className="fi-h1">{t('fleetForm.link_invalid', 'Link not valid')}</h1>
          <p className="fi-muted">{loadError}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="fi-shell">
        <div className="fi-card fi-center">
          <div className="fi-okIcon">✓</div>
          <h1 className="fi-h1">{t('fleetForm.received', 'Received')}</h1>
          <p className="fi-muted">{t('fleetForm.will_confirm', 'Our service team will confirm shortly.')}</p>
          <div className="fi-ref">
            <span>{t('fleetForm.your_ref', 'Your reference')}</span>
            <strong dir="ltr">{done.reference}</strong>
          </div>
          {done.matched_vehicle?.plate_number && (
            <p className="fi-muted fi-sm">
              {t('fleetForm.matched_to', 'Matched to your vehicle {{plate}}.', { plate: done.matched_vehicle.plate_number })}
            </p>
          )}
          <button className="fi-btn fi-btnGhost" onClick={() => { setDone(null); setForm({ ...EMPTY, submitted_by: link.contact_name || '' }); }}>
            {t('fleetForm.send_another', 'Send another vehicle')}
          </button>
        </div>
      </div>
    );
  }

  const needMakeModel = !selectedId;
  return (
    <div className="fi-shell">
      <div className="fi-card">
        <header className="fi-head">
          {langSwitch}
          <div>
            <p className="fi-eyebrow">{link.workshop_name}</p>
            <h1 className="fi-h1">{t('fleetForm.title', 'Send a vehicle in')}</h1>
            <p className="fi-muted">
              {t('fleetForm.submitting_for', 'Submitting for')} <strong>{link.customer_name}</strong>
              {link.customer_code ? ` (${link.customer_code})` : ''}
            </p>
          </div>
        </header>

        <FieldError.Provider value={{ field: errField, msg: error }}>
        <form onSubmit={submit} className="fi-form" noValidate>
          {link.vehicles?.length > 0 && (
            <section className="fi-section">
              <label className="fi-label" htmlFor="fi-known">{t('fleetForm.pick_vehicle', 'Pick one of your vehicles')}</label>
              <select id="fi-known" className="fi-input" value={selectedId}
                onChange={e => pickVehicle(link.vehicles.find(v => String(v.id) === e.target.value))}>
                <option value="">{t('fleetForm.not_listed', 'Not listed — I will type the details')}</option>
                {link.vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {[v.plate_number, v.fleet_code && `${t('fleetForm.unit', 'Unit')} ${v.fleet_code}`, `${v.make} ${v.model}`].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
              <p className="fi-help">{t('fleetForm.pick_help', 'Fills in the details we already hold. You still enter today\'s mileage and the fault.')}</p>
            </section>
          )}

          <section className="fi-section">
            <h2 className="fi-h2">{t('fleetForm.vehicle', 'Vehicle')}</h2>
            <div className="fi-grid3">
              <Field name="plate_number" label={t('fleetForm.plate', 'Plate number')} oneOf value={form.plate_number} onChange={v => set('plate_number', v)} placeholder="AD5946" ltr />
              <Field name="plate_code" label={t('fleetForm.plate_code', 'Plate code')} value={form.plate_code} onChange={v => set('plate_code', v)} placeholder="A" ltr />
              <Field name="plate_emirate" label={t('fleetForm.emirate', 'Emirate')} value={form.plate_emirate} onChange={v => set('plate_emirate', v)} type="select"
                options={EMIRATES.map(e => [e, t(`fleetForm.emirate_${slug(e)}`, e)])} />
            </div>
            <div className="fi-grid3">
              <Field name="fleet_code" label={t('fleetForm.unit_code', 'Your unit / taxi code')} oneOf value={form.fleet_code} onChange={v => set('fleet_code', v)} placeholder="5946" ltr />
              <Field name="make" label={t('fleetForm.make', 'Make')} required={needMakeModel} value={form.make} onChange={v => set('make', v)} placeholder="Toyota" />
              <Field name="model" label={t('fleetForm.model', 'Model')} required={needMakeModel} value={form.model} onChange={v => set('model', v)} placeholder="Camry" />
            </div>
            <p className="fi-help" style={{ marginTop: -6, marginBottom: 14 }}>
              <span className="fi-req">†</span> {t('fleetForm.one_of_help', 'Plate number or unit code — give at least one of the two.')}
            </p>
            <div className="fi-grid3">
              <Field name="year" label={t('fleetForm.year', 'Year')} value={form.year} onChange={v => set('year', v.replace(/\D/g, '').slice(0, 4))} placeholder="2022" inputMode="numeric" ltr />
              <Field name="color" label={t('fleetForm.colour', 'Colour')} value={form.color} onChange={v => set('color', v)} placeholder="White" />
              <Field name="engine_no" label={t('fleetForm.engine', 'Engine number')} value={form.engine_no} onChange={v => set('engine_no', v)} placeholder="A0C01177" ltr />
            </div>
            <div className="fi-grid2">
              <Field name="vin" required label={t('fleetForm.vin', 'VIN / chassis number')} value={form.vin}
                onChange={v => set('vin', v.toUpperCase())} placeholder="JTNB19HK6N3177217" mono ltr />
              <Field name="odometer" required label={t('fleetForm.mileage', 'Mileage (KM)')} value={form.odometer}
                onChange={v => set('odometer', normKm(v))} placeholder="732759" inputMode="numeric" ltr />
            </div>
          </section>

          <section className="fi-section">
            <h2 className="fi-h2">{t('fleetForm.whats_wrong', 'What is wrong with it')}</h2>
            <Field name="complaint" required label={t('fleetForm.fault', 'Fault / repair needed')} value={form.complaint}
              onChange={v => set('complaint', v.slice(0, 2000))} type="textarea"
              placeholder="CHK GEAR NOISE, BRAKE VIBRATION" />
            <div className="fi-grid2">
              <Field name="work_type" label={t('fleetForm.work_type', 'Work type')} value={form.work_type} onChange={v => set('work_type', v)} type="select"
                options={WORK_TYPES.map(w => [w, t(`fleetForm.wt_${slug(w)}`, w)])} />
              <Field name="external_ref" label={t('fleetForm.your_wo', 'Your work order number')} value={form.external_ref} onChange={v => set('external_ref', v)} placeholder="WK140854" ltr />
            </div>
          </section>

          <section className="fi-section">
            <h2 className="fi-h2">{t('fleetForm.driver_contact', 'Driver & contact')}</h2>
            <div className="fi-grid3">
              <Field name="driver_name" label={t('fleetForm.driver_name', 'Driver name')} value={form.driver_name} onChange={v => set('driver_name', v)} placeholder="Lingaiah Tappetla" />
              <Field name="driver_phone" label={t('fleetForm.driver_mobile', 'Driver mobile')} value={form.driver_phone} onChange={v => set('driver_phone', v)} placeholder="0586091163" inputMode="tel" ltr />
              <Field name="permit_id" label={t('fleetForm.permit', 'Permit ID')} value={form.permit_id} onChange={v => set('permit_id', v)} placeholder="117389" ltr />
            </div>
            <div className="fi-grid2">
              <Field name="submitted_by" label={t('fleetForm.your_name', 'Your name')} value={form.submitted_by} onChange={v => set('submitted_by', v)} placeholder="Renjit" />
              <Field name="preferred_date" label={t('fleetForm.preferred_date', 'Preferred date')} value={form.preferred_date} onChange={v => set('preferred_date', v)} type="date" />
            </div>
          </section>

          <div className="fi-actions">
            {error && !errField && <div className="fi-error" role="alert" ref={errRef}>{error}</div>}
            <button type="submit" className="fi-btn" disabled={submitting}>
              {submitting ? t('fleetForm.sending', 'Sending…') : t('fleetForm.send', 'Send to the workshop')}
            </button>
            <p className="fi-help fi-center">
              {t('fleetForm.required_help', 'VIN, mileage, the fault, and the plate number or your unit code are required. Everything else helps us book it in faster.')}
            </p>
          </div>
        </form>
        </FieldError.Provider>
      </div>
    </div>
  );
}

function Field({ name, label, value, onChange, placeholder, required, oneOf, type = 'text', options, inputMode, mono, ltr }) {
  const { t } = useTranslation();
  const err = useContext(FieldError);
  const id = `fi-${name}`;
  const bad = err.field === name;
  return (
    <div className="fi-field">
      <label className="fi-label" htmlFor={id}>
        {label}{required && <span className="fi-req"> *</span>}{oneOf && <span className="fi-req"> †</span>}
      </label>
      {type === 'textarea' ? (
        <textarea id={id} className="fi-input fi-textarea" value={value} aria-required={required || undefined} aria-invalid={bad || undefined}
          style={bad ? { borderColor: '#e0464e' } : undefined}
          onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} />
      ) : type === 'select' ? (
        <select id={id} className="fi-input" value={value} onChange={e => onChange(e.target.value)}>
          <option value="">{t('fleetForm.select', 'Select…')}</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <input id={id} className={`fi-input${mono ? ' fi-mono' : ''}`} type={type} value={value} dir={ltr ? 'ltr' : undefined}
          inputMode={inputMode} aria-required={required || undefined} aria-invalid={bad || undefined}
          aria-describedby={bad ? `${id}-err` : undefined} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={bad ? { borderColor: '#e0464e' } : undefined} />
      )}
      {bad && <div id={`${id}-err`} className="fi-error" role="alert" style={{ margin: '6px 0 0', padding: '8px 10px', fontSize: 13 }}>{err.msg}</div>}
    </div>
  );
}
