/**
 * BookAppointmentModal — make a booking (the BOOK stage of the cycle:
 * enquiry → quote → book → visit).
 *
 * Props:
 *   open, onClose
 *   onBooked(appointment)  — called with the saved booking (GET shape)
 *   preset                 — optional { customer_id, vehicle_id, customer_name,
 *                            customer_phone, enquiry_id, estimate_id,
 *                            service_category, notes, date,
 *                            enquiry_number, estimate_number, plate_number }
 *
 * Times come from GET /appointments/available-slots, so a slot the bays
 * cannot take is shown but cannot be picked; the server checks again on save.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Xmark, Calendar, Clock, WarningCircle, User } from 'iconoir-react';
import api from '../lib/api';
import CustomerPicker from './CustomerPicker';
import './BookAppointmentModal.css';

/** work_orders.service_category values — check-in carries them onto the job card. */
export const SERVICE_CATEGORIES = [
  ['general_maintenance', 'General maintenance'],
  ['oil_change', 'Oil change'],
  ['diagnostic', 'Diagnostic'],
  ['brake_repair', 'Brake repair'],
  ['tire_service', 'Tyre service'],
  ['engine_repair', 'Engine repair'],
  ['transmission', 'Transmission'],
  ['electrical', 'Electrical'],
  ['bodywork', 'Bodywork'],
  ['other', 'Other'],
];
const CATEGORY_DEFAULT = Object.fromEntries(SERVICE_CATEGORIES);

/** Label for a booking's service: a known category translated, else the text as typed. */
export function categoryLabel(t, value) {
  if (!value) return '';
  const key = String(value).toLowerCase();
  return CATEGORY_DEFAULT[key] ? t(`bookings.cat_${key}`, CATEGORY_DEFAULT[key]) : value;
}

const SOURCES = [
  ['call_centre', 'Phone call'],
  ['walk_in', 'Walk-in'],
  ['app', 'App / online'],
  ['self_service', 'Self-service'],
];
export function sourceLabel(t, value) {
  const hit = SOURCES.find(([k]) => k === value);
  return hit ? t(`bookings.source_${hit[0]}`, hit[1]) : (value || '');
}

const DURATIONS = [30, 60, 90, 120];

export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (s, n) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
};
const todayStr = () => ymd(new Date());

function blankForm(preset = {}) {
  const p = preset || {};
  return {
    customer: p.customer_id ? { id: p.customer_id, full_name: p.customer_name || '', phone: p.customer_phone || '' } : null,
    contactName: p.customer_id ? '' : (p.customer_name || ''),
    contactPhone: p.customer_id ? '' : (p.customer_phone || ''),
    vehicleId: p.vehicle_id ? String(p.vehicle_id) : '',
    date: p.date || addDays(todayStr(), 1),
    duration: 60,
    time: '',
    bayId: '',
    category: p.service_category && CATEGORY_DEFAULT[String(p.service_category).toLowerCase()]
      ? String(p.service_category).toLowerCase() : (p.service_category ? 'other' : 'general_maintenance'),
    customCategory: p.service_category && !CATEGORY_DEFAULT[String(p.service_category).toLowerCase()] ? p.service_category : '',
    source: 'call_centre',
    notes: p.notes || '',
  };
}

export default function BookAppointmentModal({ open, onClose, onBooked, preset }) {
  const { t } = useTranslation();
  const [f, setF] = useState(() => blankForm(preset));
  const [vehicles, setVehicles] = useState([]);
  const [vehLoading, setVehLoading] = useState(false);
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsMsg, setSlotsMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = useCallback(patch => setF(prev => ({ ...prev, ...patch })), []);
  const fromSource = !!(preset?.estimate_id || preset?.enquiry_id);
  // A quote is for one customer and car — those are not changed here.
  const lockedCustomer = !!(preset?.estimate_id && preset?.customer_id);

  // Fresh form every time it opens (from the preset it was opened with)
  useEffect(() => {
    if (!open) return;
    setF(blankForm(preset));
    setError('');
    setSaving(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  // The chosen customer's vehicles
  const customerId = f.customer?.id || null;
  useEffect(() => {
    if (!open || !customerId) { setVehicles([]); return undefined; }
    let live = true;
    setVehLoading(true);
    api.get(`/vehicles?customer_id=${encodeURIComponent(customerId)}&limit=50`)
      .then(r => {
        if (!live) return;
        const list = r?.success ? (r.data || []) : [];
        setVehicles(list);
        setF(prev => {
          if (prev.vehicleId && list.some(v => String(v.id) === String(prev.vehicleId))) return prev;
          // Keep a preset vehicle even if the list did not return it; else pick the only car.
          if (prev.vehicleId && String(prev.vehicleId) === String(preset?.vehicle_id || '')) return prev;
          return { ...prev, vehicleId: list.length === 1 ? String(list[0].id) : '' };
        });
      })
      .catch(() => { if (live) setVehicles([]); })
      .finally(() => { if (live) setVehLoading(false); });
    return () => { live = false; };
  }, [open, customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Slots for the day
  useEffect(() => {
    if (!open || !f.date) return undefined;
    let live = true;
    setSlotsLoading(true);
    setSlotsMsg('');
    api.get(`/appointments/available-slots?date=${encodeURIComponent(f.date)}&duration_min=${f.duration}`)
      .then(r => {
        if (!live) return;
        if (!r?.success) { setSlots([]); setSlotsMsg(r?.message || ''); return; }
        setSlots(r.slots || []);
        setSlotsMsg(r.slots?.length ? '' : (r.message || ''));
      })
      .catch(() => { if (live) { setSlots([]); setSlotsMsg(t('bookings.err_slots', 'Could not load the free times.')); } })
      .finally(() => { if (live) setSlotsLoading(false); });
    return () => { live = false; };
  }, [open, f.date, f.duration, t]);

  const isPast = useCallback(time => {
    const today = todayStr();
    if (f.date < today) return true;
    if (f.date > today) return false;
    const now = new Date();
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m <= now.getHours() * 60 + now.getMinutes();
  }, [f.date]);

  const selectedSlot = useMemo(() => slots.find(s => s.time.slice(0, 5) === f.time) || null, [slots, f.time]);

  // Drop a time (or bay) that the new day / length no longer allows.
  useEffect(() => {
    if (!f.time || slotsLoading) return;
    if (!slots.length) return; // free-typed time (no bays set up) stays
    const s = slots.find(x => x.time.slice(0, 5) === f.time);
    if (!s || !s.is_available || isPast(f.time)) { set({ time: '', bayId: '' }); return; }
    if (f.bayId) {
      const b = s.bays?.find(x => String(x.bay_id) === String(f.bayId));
      if (!b || b.available <= 0) set({ bayId: '' });
    }
  }, [slots, slotsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const pickCustomer = c => {
    set({ customer: c ? { id: c.id, full_name: c.full_name, phone: c.phone } : null, vehicleId: '' });
  };

  const save = async e => {
    e?.preventDefault?.();
    setError('');
    if (!f.customer && (!f.contactName.trim() || !f.contactPhone.trim())) {
      setError(t('bookings.err_customer', 'Choose a customer, or enter a name and phone number.'));
      return;
    }
    if (!f.date) { setError(t('bookings.err_date', 'Choose a date.')); return; }
    if (!f.time) { setError(t('bookings.err_time', 'Choose a time.')); return; }

    const service = f.category === 'other' && f.customCategory.trim() ? f.customCategory.trim() : f.category;
    const body = {
      appointment_date: f.date,
      appointment_time: f.time,
      slot_duration_min: f.duration,
      service_category: service,
      notes: f.notes.trim() || null,
      source: f.source,
      service_bay_id: f.bayId ? Number(f.bayId) : null,
    };
    if (f.customer) {
      body.customer_id = f.customer.id;
      if (f.vehicleId) body.vehicle_id = Number(f.vehicleId);
    } else {
      body.customer_name = f.contactName.trim();
      body.customer_phone = f.contactPhone.trim();
    }
    if (preset?.enquiry_id) body.enquiry_id = preset.enquiry_id;
    if (preset?.estimate_id) body.estimate_id = preset.estimate_id;

    setSaving(true);
    try {
      const r = await api.post('/appointments', body);
      if (!r?.success) { setError(r?.message || t('bookings.err_save', 'Could not save the booking.')); return; }
      onBooked?.(r.appointment || { id: r.appointmentId, appointment_date: f.date });
    } catch {
      setError(t('bookings.err_network', 'Network error — please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const minDate = todayStr();

  return (
    <div className="bkm-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose?.(); }}>
      <form className="bkm-modal" role="dialog" aria-modal="true" aria-labelledby="bkm-title" onSubmit={save}>
        <div className="bkm-head">
          <div className="bkm-headMain">
            <h2 id="bkm-title" className="bkm-title">
              <Calendar width={20} height={20} /> {t('bookings.new_booking', 'New booking')}
            </h2>
            <p className="bkm-sub">{t('bookings.modal_sub', 'Pick a free time. At check-in the booking becomes the job card.')}</p>
            {fromSource && (
              <div className="bkm-from">
                {preset?.enquiry_id && (
                  <span className="bkm-fromChip">
                    {t('bookings.from_enquiry', 'From enquiry')} {preset.enquiry_number || `#${preset.enquiry_id}`}
                  </span>
                )}
                {preset?.estimate_id && (
                  <span className="bkm-fromChip">
                    {t('bookings.from_quote', 'From quote')} {preset.estimate_number || `#${preset.estimate_id}`}
                  </span>
                )}
              </div>
            )}
          </div>
          <button type="button" className="bkm-close" onClick={onClose} disabled={saving} aria-label={t('bookings.close', 'Close')}>
            <Xmark width={18} height={18} />
          </button>
        </div>

        <div className="bkm-body">
          {/* ── Customer ── */}
          <section className="bkm-section">
            <h3 className="bkm-h">{t('bookings.customer', 'Customer')}</h3>
            {lockedCustomer ? (
              <div className="bkm-fixed">
                <User width={16} height={16} />
                <span className="bkm-fixedName">{f.customer?.full_name || preset?.customer_name}</span>
                {(f.customer?.phone || preset?.customer_phone) && <span className="bkm-fixedMeta">{f.customer?.phone || preset?.customer_phone}</span>}
              </div>
            ) : (
              <>
                <CustomerPicker
                  value={f.customer}
                  onChange={pickCustomer}
                  placeholder={t('bookings.search_customer', 'Search customer by name or phone…')}
                  emptyLabel={t('bookings.no_customer_hint', 'Not on file? Enter a name and phone below.')}
                />
                {!f.customer && (
                  <div className="bkm-grid2 bkm-contact">
                    <label className="bkm-field">
                      <span>{t('bookings.contact_name', 'Name')}</span>
                      <input className="bkm-input" value={f.contactName} onChange={e => set({ contactName: e.target.value })} autoComplete="off" />
                    </label>
                    <label className="bkm-field">
                      <span>{t('bookings.contact_phone', 'Phone')}</span>
                      <input className="bkm-input" type="tel" dir="ltr" value={f.contactPhone} onChange={e => set({ contactPhone: e.target.value })} autoComplete="off" />
                    </label>
                  </div>
                )}
              </>
            )}

            {f.customer && (
              <label className="bkm-field bkm-vehicle">
                <span>{t('bookings.vehicle', 'Vehicle')}</span>
                <select className="bkm-input" value={f.vehicleId} onChange={e => set({ vehicleId: e.target.value })} disabled={vehLoading || (lockedCustomer && !!preset?.vehicle_id)}>
                  <option value="">{vehLoading ? t('bookings.loading', 'Loading…') : t('bookings.no_vehicle', 'Not known yet')}</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      {[v.plate_number, [v.make, v.model].filter(Boolean).join(' '), v.year].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                  {f.vehicleId && !vehicles.some(v => String(v.id) === String(f.vehicleId)) && (
                    <option value={f.vehicleId}>{preset?.plate_number || `#${f.vehicleId}`}</option>
                  )}
                </select>
              </label>
            )}
          </section>

          {/* ── When ── */}
          <section className="bkm-section">
            <h3 className="bkm-h">{t('bookings.when', 'When')}</h3>
            <div className="bkm-grid2">
              <label className="bkm-field">
                <span>{t('bookings.date', 'Date')}</span>
                <input className="bkm-input" type="date" dir="ltr" min={minDate} value={f.date}
                  onChange={e => set({ date: e.target.value, time: '', bayId: '' })} required />
              </label>
              <label className="bkm-field">
                <span>{t('bookings.duration', 'Length')}</span>
                <select className="bkm-input" value={f.duration} onChange={e => set({ duration: Number(e.target.value), time: '', bayId: '' })}>
                  {DURATIONS.map(m => (
                    <option key={m} value={m}>{t('bookings.n_minutes', '{{n}} min', { n: m })}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="bkm-field">
              <span>{t('bookings.time', 'Time')}</span>
              {slotsLoading ? (
                <div className="bkm-slotsMsg">{t('bookings.loading_slots', 'Checking free times…')}</div>
              ) : slots.length ? (
                <div className="bkm-slots" role="radiogroup" aria-label={t('bookings.time', 'Time')}>
                  {slots.map(s => {
                    const hhmm = s.time.slice(0, 5);
                    const past = isPast(hhmm);
                    const full = !s.is_available;
                    const on = f.time === hhmm;
                    return (
                      <button
                        type="button" key={s.time} role="radio" aria-checked={on}
                        className={`bkm-slot${on ? ' is-on' : ''}${full ? ' is-full' : ''}`}
                        disabled={full || past}
                        onClick={() => set({ time: hhmm, bayId: '' })}
                        title={full ? t('bookings.slot_full', 'Full') : undefined}
                      >
                        <span className="bkm-slotTime" dir="ltr">{hhmm}</span>
                        <span className="bkm-slotFree">
                          {full ? t('bookings.slot_full', 'Full')
                            : past ? t('bookings.slot_past', 'Past')
                              : t('bookings.slot_free', '{{n}} free', { n: s.total_available })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  {slotsMsg && <div className="bkm-slotsMsg"><WarningCircle width={15} height={15} /> {slotsMsg}</div>}
                  <input className="bkm-input bkm-timeInput" type="time" dir="ltr" value={f.time} onChange={e => set({ time: e.target.value })} />
                </>
              )}
            </div>

            {selectedSlot?.bays?.length > 0 && (
              <label className="bkm-field">
                <span>{t('bookings.bay_optional', 'Bay (optional)')}</span>
                <select className="bkm-input" value={f.bayId} onChange={e => set({ bayId: e.target.value })}>
                  <option value="">{t('bookings.any_bay', 'Any free bay')}</option>
                  {selectedSlot.bays.map(b => (
                    <option key={b.bay_id} value={b.bay_id} disabled={b.available <= 0}>
                      {b.bay_name} — {b.available > 0 ? t('bookings.slot_free', '{{n}} free', { n: b.available }) : t('bookings.slot_full', 'Full')}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          {/* ── What ── */}
          <section className="bkm-section">
            <h3 className="bkm-h">{t('bookings.what', 'What for')}</h3>
            <div className="bkm-grid2">
              <label className="bkm-field">
                <span>{t('bookings.service', 'Service')}</span>
                <select className="bkm-input" value={f.category} onChange={e => set({ category: e.target.value })}>
                  {SERVICE_CATEGORIES.map(([k, label]) => (
                    <option key={k} value={k}>{t(`bookings.cat_${k}`, label)}</option>
                  ))}
                </select>
              </label>
              <label className="bkm-field">
                <span>{t('bookings.source', 'Booked by')}</span>
                <select className="bkm-input" value={f.source} onChange={e => set({ source: e.target.value })}>
                  {SOURCES.map(([k, label]) => (
                    <option key={k} value={k}>{t(`bookings.source_${k}`, label)}</option>
                  ))}
                </select>
              </label>
            </div>
            {f.category === 'other' && (
              <label className="bkm-field">
                <span>{t('bookings.service_other', 'Describe the service')}</span>
                <input className="bkm-input" value={f.customCategory} maxLength={100} onChange={e => set({ customCategory: e.target.value })} />
              </label>
            )}
            <label className="bkm-field">
              <span>{t('bookings.notes', 'Notes')}</span>
              <textarea className="bkm-input bkm-textarea" rows={3} value={f.notes}
                placeholder={t('bookings.notes_ph', 'What the customer reported, anything to prepare…')}
                onChange={e => set({ notes: e.target.value })} />
            </label>
          </section>

          {error && <div className="bkm-error" role="alert"><WarningCircle width={16} height={16} /> {error}</div>}
        </div>

        <div className="bkm-foot">
          {f.time && (
            <span className="bkm-summary">
              <Clock width={15} height={15} /> <span dir="ltr">{f.date} · {f.time}</span>
            </span>
          )}
          <button type="button" className="bkm-btn bkm-btnGhost" onClick={onClose} disabled={saving}>
            {t('bookings.cancel', 'Cancel')}
          </button>
          <button type="submit" className="bkm-btn" disabled={saving}>
            {saving ? t('bookings.saving', 'Saving…') : t('bookings.save_booking', 'Save booking')}
          </button>
        </div>
      </form>
    </div>
  );
}
