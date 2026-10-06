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
 */
import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import './FleetIntake.css';

const API = import.meta.env.VITE_API_URL || '/api';

const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
const WORK_TYPES = ['Maintenance', 'Accident', 'Breakdown', 'Service', 'Inspection', 'Other'];

const EMPTY = {
  fleet_code: '', plate_number: '', plate_code: '', plate_emirate: '',
  make: '', model: '', year: '', color: '', vin: '', engine_no: '',
  odometer: '', complaint: '', work_type: '', external_ref: '',
  driver_name: '', driver_phone: '', permit_id: '', submitted_by: '',
  preferred_date: '',
};

export default function FleetIntake() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [form, setForm] = useState({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/public/fleet-intake/${token}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j.success) { setLink(j.data); setForm(f => ({ ...f, submitted_by: j.data.contact_name || '' })); }
        else setLoadError(j.message || 'This link is no longer valid.');
      })
      .catch(() => { if (!cancelled) setLoadError('Could not reach the workshop. Check your connection and try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

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

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.complaint.trim()) return setError('Describe the problem with the vehicle.');
    if (!form.vin.trim()) return setError('VIN / chassis number is required.');
    if (!String(form.odometer).trim()) return setError('Mileage (odometer reading) is required.');
    if (!form.plate_number.trim() && !form.fleet_code.trim()) {
      return setError('Give either the plate number or your own unit code so we can identify the vehicle.');
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/public/fleet-intake/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (j.success) setDone(j.data);
      else setError(j.message || 'Could not send this form.');
    } catch {
      setError('Could not reach the workshop. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="fi-shell"><div className="fi-card fi-center"><div className="fi-spinner" /><p>Opening the form…</p></div></div>;
  }

  if (loadError) {
    return (
      <div className="fi-shell">
        <div className="fi-card fi-center">
          <div className="fi-badIcon">!</div>
          <h1 className="fi-h1">Link not valid</h1>
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
          <h1 className="fi-h1">Received</h1>
          <p className="fi-muted">Our service team will confirm shortly.</p>
          <div className="fi-ref">
            <span>Your reference</span>
            <strong>{done.reference}</strong>
          </div>
          {done.matched_vehicle && (
            <p className="fi-muted fi-sm">
              Matched to {done.matched_vehicle.plate_number} — {done.matched_vehicle.make} {done.matched_vehicle.model}.
            </p>
          )}
          <button className="fi-btn fi-btnGhost" onClick={() => { setDone(null); setForm({ ...EMPTY, submitted_by: link.contact_name || '' }); }}>
            Send another vehicle
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fi-shell">
      <div className="fi-card">
        <header className="fi-head">
          <div>
            <p className="fi-eyebrow">{link.workshop_name}</p>
            <h1 className="fi-h1">Send a vehicle in</h1>
            <p className="fi-muted">
              Submitting for <strong>{link.customer_name}</strong>
              {link.customer_code ? ` (${link.customer_code})` : ''}
            </p>
          </div>
        </header>

        <form onSubmit={submit} className="fi-form">
          {error && <div className="fi-error">{error}</div>}

          {link.vehicles?.length > 0 && (
            <section className="fi-section">
              <label className="fi-label" htmlFor="fi-known">Pick one of your vehicles</label>
              <select id="fi-known" className="fi-input" value={selectedId}
                onChange={e => pickVehicle(link.vehicles.find(v => String(v.id) === e.target.value))}>
                <option value="">Not listed — I will type the details</option>
                {link.vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {[v.plate_number, v.fleet_code && `Unit ${v.fleet_code}`, `${v.make} ${v.model}`].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
              <p className="fi-help">Fills in the details we already hold. You still enter today's mileage and the fault.</p>
            </section>
          )}

          <section className="fi-section">
            <h2 className="fi-h2">Vehicle</h2>
            <div className="fi-grid3">
              <Field label="Plate number" value={form.plate_number} onChange={v => set('plate_number', v)} placeholder="AD5946" />
              <Field label="Plate code" value={form.plate_code} onChange={v => set('plate_code', v)} placeholder="A" />
              <Field label="Emirate" value={form.plate_emirate} onChange={v => set('plate_emirate', v)} type="select" options={EMIRATES} />
            </div>
            <div className="fi-grid3">
              <Field label="Your unit / taxi code" value={form.fleet_code} onChange={v => set('fleet_code', v)} placeholder="5946" />
              <Field label="Make" value={form.make} onChange={v => set('make', v)} placeholder="Toyota" />
              <Field label="Model" value={form.model} onChange={v => set('model', v)} placeholder="Camry" />
            </div>
            <div className="fi-grid3">
              <Field label="Year" value={form.year} onChange={v => set('year', v.replace(/\D/g, '').slice(0, 4))} placeholder="2022" inputMode="numeric" />
              <Field label="Colour" value={form.color} onChange={v => set('color', v)} placeholder="White" />
              <Field label="Engine number" value={form.engine_no} onChange={v => set('engine_no', v)} placeholder="A0C01177" />
            </div>
            <div className="fi-grid2">
              <Field required label="VIN / chassis number" value={form.vin}
                onChange={v => set('vin', v.toUpperCase())} placeholder="JTNB19HK6N3177217" mono />
              <Field required label="Mileage (KM)" value={form.odometer}
                onChange={v => set('odometer', v.replace(/\D/g, ''))} placeholder="732759" inputMode="numeric" />
            </div>
          </section>

          <section className="fi-section">
            <h2 className="fi-h2">What is wrong with it</h2>
            <Field required label="Fault / repair needed" value={form.complaint}
              onChange={v => set('complaint', v.slice(0, 2000))} type="textarea"
              placeholder="CHK GEAR NOISE, BRAKE VIBRATION" />
            <div className="fi-grid2">
              <Field label="Work type" value={form.work_type} onChange={v => set('work_type', v)} type="select" options={WORK_TYPES} />
              <Field label="Your work order number" value={form.external_ref} onChange={v => set('external_ref', v)} placeholder="WK140854" />
            </div>
          </section>

          <section className="fi-section">
            <h2 className="fi-h2">Driver &amp; contact</h2>
            <div className="fi-grid3">
              <Field label="Driver name" value={form.driver_name} onChange={v => set('driver_name', v)} placeholder="Lingaiah Tappetla" />
              <Field label="Driver mobile" value={form.driver_phone} onChange={v => set('driver_phone', v)} placeholder="0586091163" />
              <Field label="Permit ID" value={form.permit_id} onChange={v => set('permit_id', v)} placeholder="117389" />
            </div>
            <div className="fi-grid2">
              <Field label="Your name" value={form.submitted_by} onChange={v => set('submitted_by', v)} placeholder="Renjit" />
              <Field label="Preferred date" value={form.preferred_date} onChange={v => set('preferred_date', v)} type="date" />
            </div>
          </section>

          <div className="fi-actions">
            <button type="submit" className="fi-btn" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send to the workshop'}
            </button>
            <p className="fi-help fi-center">
              VIN, mileage and the fault are required. Everything else helps us book it in faster.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, required, type = 'text', options, inputMode, mono }) {
  const id = `fi-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="fi-field">
      <label className="fi-label" htmlFor={id}>
        {label}{required && <span className="fi-req"> *</span>}
      </label>
      {type === 'textarea' ? (
        <textarea id={id} className="fi-input fi-textarea" value={value}
          onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} />
      ) : type === 'select' ? (
        <select id={id} className="fi-input" value={value} onChange={e => onChange(e.target.value)}>
          <option value="">Select…</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input id={id} className={`fi-input${mono ? ' fi-mono' : ''}`} type={type} value={value}
          inputMode={inputMode} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}
