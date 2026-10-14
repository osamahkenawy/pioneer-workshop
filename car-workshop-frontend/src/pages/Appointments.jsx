/**
 * Bookings — the BOOK stage of the customer cycle:
 *   lead (enquiry) → quote (estimate) → BOOK → visit (job card) → after the visit.
 *
 * One day at a time, grouped by time. The front desk confirms a booking,
 * checks the car in when it arrives (which opens the work order and its
 * main job card, then goes straight to it), or records a no-show / a
 * cancellation with its reason.
 *
 * URLs: /appointments?date=YYYY-MM-DD
 *       /appointments?new=1                 — open the booking form
 *       /appointments?new=1&enquiry=<id>    — booking for an enquiry
 *       /appointments?new=1&estimate=<id>   — booking for a quote
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Calendar, NavArrowLeft, NavArrowRight, Plus, Check, Xmark, LogIn, UserXmark, Refresh,
  Car, Clock, Phone, WarningCircle, OpenNewWindow,
} from 'iconoir-react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { canDo } from '../lib/permissions';
import BookAppointmentModal, { categoryLabel, sourceLabel, ymd, addDays } from '../components/BookAppointmentModal';
import './Appointments.css';

const STATUS_DEFAULT = {
  pending: 'Pending', confirmed: 'Confirmed', arrived: 'Arrived', in_progress: 'In progress',
  completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show',
};
const ARRIVED = ['arrived', 'in_progress', 'completed'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const FILTERS = {
  all: () => true,
  confirmed: a => a.status === 'confirmed',
  arrived: a => ARRIVED.includes(a.status),
  missed: a => a.status === 'no_show' || a.status === 'cancelled',
};

export default function Appointments() {
  const { t, i18n } = useTranslation();
  const { user } = useContext(AuthContext) || {};
  const mayBook = canDo(user, 'job.open');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const today = ymd(new Date());
  const paramDate = params.get('date');
  const date = paramDate && DATE_RE.test(paramDate) ? paramDate : today;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [preset, setPreset] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'checkin'|'cancel'|'no_show', appt }
  const reqRef = useRef(0);
  const toastTimer = useRef(null);

  const flash = useCallback(m => {
    if (!m) return;
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3800);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const setDate = useCallback(d => {
    const next = new URLSearchParams(params);
    if (d && d !== today) next.set('date', d); else next.delete('date');
    setParams(next, { replace: true });
  }, [params, setParams, today]);

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get(`/appointments?date=${encodeURIComponent(date)}&limit=500`);
      if (req !== reqRef.current) return;
      if (!r?.success) { setRows([]); setLoadError(r?.message || t('bookings.err_load', 'Could not load bookings.')); return; }
      setRows(r.appointments || []);
    } catch {
      if (req === reqRef.current) { setRows([]); setLoadError(t('bookings.err_load', 'Could not load bookings.')); }
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [date, t]);

  useEffect(() => { load(); }, [load]);

  // ?new=1 [&enquiry=<id> | &estimate=<id>] opens the booking form, pre-filled.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    const enquiryId = params.get('enquiry');
    const estimateId = params.get('estimate');
    const next = new URLSearchParams(params);
    next.delete('new'); next.delete('enquiry'); next.delete('estimate');
    setParams(next, { replace: true });
    if (!mayBook) { flash(t('bookings.err_no_permission', 'Your role cannot make bookings.')); return; }

    (async () => {
      try {
        if (estimateId) {
          const r = await api.get(`/estimates/${encodeURIComponent(estimateId)}`);
          const e = r?.estimate;
          if (!r?.success || !e) { flash(r?.message || t('bookings.err_load_quote', 'Could not open that quote.')); return; }
          setPreset({
            estimate_id: e.id, estimate_number: e.estimate_number,
            enquiry_id: e.enquiry_id || undefined,
            customer_id: e.customer_id || undefined,
            customer_name: e.customer_full_name || e.customer_name || '',
            customer_phone: e.customer_phone || '',
            vehicle_id: e.vehicle_id || undefined,
            plate_number: e.plate_number || e.vehicle_plate || '',
            notes: t('bookings.notes_from_quote', 'Quote {{n}}', { n: e.estimate_number }),
          });
        } else if (enquiryId) {
          const r = await api.get(`/enquiries/${encodeURIComponent(enquiryId)}`);
          const q = r?.data;
          if (!r?.success || !q) { flash(r?.message || t('bookings.err_load_enquiry', 'Could not open that enquiry.')); return; }
          setPreset({
            enquiry_id: q.id, enquiry_number: q.enquiry_number,
            customer_id: q.customer_id || undefined,
            customer_name: q.customer_full_name || q.contact_name || '',
            customer_phone: q.contact_phone || '',
            vehicle_id: q.vehicle_id || undefined,
            notes: [q.vehicle_description, q.description].filter(Boolean).join(' — '),
          });
        } else {
          setPreset(null);
        }
        setShowNew(true);
      } catch {
        flash(t('bookings.err_network', 'Network error — please try again.'));
      }
    })();
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setPreset(null); setShowNew(true); };

  const onBooked = appt => {
    setShowNew(false);
    setPreset(null);
    flash(t('bookings.saved', 'Booking saved.'));
    if (appt?.appointment_date && appt.appointment_date !== date) setDate(appt.appointment_date);
    else load();
  };

  // ── actions ──
  const setStatus = async (appt, status, extra = {}) => {
    setBusyId(appt.id);
    try {
      const r = await api.patch(`/appointments/${appt.id}/status`, { status, ...extra });
      if (!r?.success) { flash(r?.message || t('bookings.err_update', 'Could not update the booking.')); return false; }
      flash(({
        confirmed: t('bookings.done_confirmed', 'Booking confirmed.'),
        cancelled: t('bookings.done_cancelled', 'Booking cancelled.'),
        no_show: t('bookings.done_no_show', 'Marked as no-show.'),
      })[status] || r.message);
      await load();
      return true;
    } catch {
      flash(t('bookings.err_network', 'Network error — please try again.'));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const checkIn = async (appt, odometer) => {
    setBusyId(appt.id);
    try {
      const r = await api.post(`/appointments/${appt.id}/check-in`, { odometer_in: odometer ? Number(odometer) : null });
      if (!r?.success || !r.work_order_id) return r?.message || t('bookings.err_checkin', 'Could not check the car in.');
      setDialog(null);
      navigate(`/work-orders/${r.work_order_id}`);
      return null;
    } catch {
      return t('bookings.err_network', 'Network error — please try again.');
    } finally {
      setBusyId(null);
    }
  };

  // ── derived ──
  const counts = useMemo(() => ({
    all: rows.length,
    confirmed: rows.filter(FILTERS.confirmed).length,
    arrived: rows.filter(FILTERS.arrived).length,
    missed: rows.filter(FILTERS.missed).length,
  }), [rows]);

  const groups = useMemo(() => {
    const out = [];
    const by = new Map();
    for (const a of rows.filter(FILTERS[filter])) {
      const key = String(a.appointment_time || '').slice(0, 5);
      if (!by.has(key)) { by.set(key, []); out.push(key); }
      by.get(key).push(a);
    }
    return out.map(time => ({ time, items: by.get(time) }));
  }, [rows, filter]);

  const dateLabel = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    try {
      return new Date(y, m - 1, d).toLocaleDateString(i18n.language || undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return date; }
  }, [date, i18n.language]);

  const statusLabel = s => t(`bookings.status_${s}`, STATUS_DEFAULT[s] || s);

  const tiles = [
    { key: 'all', label: t('bookings.tile_total', 'Bookings'), cls: '' },
    { key: 'confirmed', label: t('bookings.tile_confirmed', 'Confirmed'), cls: 'bk-tile-confirmed' },
    { key: 'arrived', label: t('bookings.tile_arrived', 'Arrived'), cls: 'bk-tile-arrived' },
    { key: 'missed', label: t('bookings.tile_missed', 'No-show / cancelled'), cls: 'bk-tile-missed' },
  ];

  return (
    <div className="bk-wrap">
      <div className="bk-head">
        <div className="bk-headText">
          <h1 className="bk-title"><Calendar width={24} height={24} /> {t('bookings.title', 'Bookings')}</h1>
          <p className="bk-sub">
            {t('bookings.subtitle', 'Book the visit, confirm it, and check the car in — check-in opens the job card.')}
          </p>
        </div>
        {mayBook && (
          <button type="button" className="bk-btn bk-btnPrimary" onClick={openNew}>
            <Plus width={18} height={18} /> {t('bookings.new_booking', 'New booking')}
          </button>
        )}
      </div>

      {/* ── date navigator ── */}
      <div className="bk-dateBar">
        <div className="bk-dateNav">
          <button type="button" className="bk-btn bk-btnGhost bk-btnIcon" onClick={() => setDate(addDays(date, -1))}
            aria-label={t('bookings.prev_day', 'Previous day')}>
            <NavArrowLeft width={18} height={18} className="bk-flip" />
            <span className="bk-hideSm">{t('bookings.prev', 'Previous')}</span>
          </button>
          <button type="button" className={`bk-btn bk-btnGhost${date === today ? ' is-on' : ''}`} onClick={() => setDate(today)}>
            {t('bookings.today', 'Today')}
          </button>
          <button type="button" className="bk-btn bk-btnGhost bk-btnIcon" onClick={() => setDate(addDays(date, 1))}
            aria-label={t('bookings.next_day', 'Next day')}>
            <span className="bk-hideSm">{t('bookings.next', 'Next')}</span>
            <NavArrowRight width={18} height={18} className="bk-flip" />
          </button>
        </div>
        <input type="date" className="bk-dateInput" dir="ltr" value={date} aria-label={t('bookings.date', 'Date')}
          onChange={e => { if (DATE_RE.test(e.target.value)) setDate(e.target.value); }} />
        <div className="bk-dateLabel">{dateLabel}</div>
        <button type="button" className="bk-btn bk-btnGhost bk-btnIcon bk-refresh" onClick={load} disabled={loading}
          aria-label={t('bookings.refresh', 'Refresh')} title={t('bookings.refresh', 'Refresh')}>
          <Refresh width={17} height={17} />
        </button>
      </div>

      {/* ── summary tiles (also filters) ── */}
      <div className="bk-tiles">
        {tiles.map(tl => (
          <button type="button" key={tl.key} className={`bk-tile ${tl.cls}${filter === tl.key ? ' bk-tileOn' : ''}`}
            onClick={() => setFilter(f => (f === tl.key && tl.key !== 'all' ? 'all' : tl.key))} aria-pressed={filter === tl.key}>
            <span className="bk-tile-n">{counts[tl.key]}</span>
            <span className="bk-tile-l">{tl.label}</span>
          </button>
        ))}
      </div>

      {loadError && (
        <div className="bk-error"><WarningCircle width={16} height={16} /> {loadError}
          <button type="button" className="bk-link" onClick={load}>{t('bookings.retry', 'Try again')}</button>
        </div>
      )}

      {loading && !rows.length ? (
        <div className="bk-empty"><div className="bk-spinner" aria-hidden="true" />{t('bookings.loading', 'Loading…')}</div>
      ) : !groups.length ? (
        <div className="bk-empty">
          <Calendar width={30} height={30} className="bk-empty-ico" />
          <div className="bk-empty-title">
            {rows.length ? t('bookings.empty_filter', 'Nothing in this view.') : t('bookings.empty_day', 'No bookings for this day.')}
          </div>
          {!rows.length && mayBook && (
            <button type="button" className="bk-btn bk-btnPrimary" onClick={openNew}>
              <Plus width={16} height={16} /> {t('bookings.new_booking', 'New booking')}
            </button>
          )}
        </div>
      ) : (
        <div className="bk-groups">
          {groups.map(g => (
            <section key={g.time} className="bk-group">
              <div className="bk-groupHead">
                <Clock width={16} height={16} />
                <span className="bk-groupTime" dir="ltr">{g.time}</span>
                <span className="bk-groupN">{t('bookings.n_bookings', '{{count}} booking(s)', { count: g.items.length })}</span>
              </div>
              <ul className="bk-list">
                {g.items.map(a => (
                  <BookingRow key={a.id} a={a} t={t} mayBook={mayBook} busy={busyId === a.id}
                    statusLabel={statusLabel}
                    onConfirm={() => setStatus(a, 'confirmed')}
                    onCheckIn={() => setDialog({ kind: 'checkin', appt: a })}
                    onNoShow={() => setDialog({ kind: 'no_show', appt: a })}
                    onCancel={() => setDialog({ kind: 'cancel', appt: a })} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <BookAppointmentModal open={showNew} preset={preset} onClose={() => { setShowNew(false); setPreset(null); }} onBooked={onBooked} />

      {dialog && (
        <ActionDialog
          dialog={dialog} t={t} busy={busyId === dialog.appt.id}
          onClose={() => setDialog(null)}
          onCheckIn={checkIn}
          onStatus={async (status, extra) => { if (await setStatus(dialog.appt, status, extra)) setDialog(null); }}
        />
      )}

      {toast && <div className="bk-toast" role="status">{toast}</div>}
    </div>
  );
}

function BookingRow({ a, t, mayBook, busy, statusLabel, onConfirm, onCheckIn, onNoShow, onCancel }) {
  const name = a.customer_full_name || a.customer_name || t('bookings.no_name', 'No name');
  const phone = a.customer_phone || (a.customer_phone_db && a.customer_phone_db !== '-' ? a.customer_phone_db : '');
  const vehicle = [a.make, a.model, a.vehicle_year].filter(Boolean).join(' ');
  const plate = a.plate_number || a.vehicle_plate_db;
  const service = categoryLabel(t, a.service_category);
  const open = ['pending', 'confirmed', 'no_show'].includes(a.status);
  const checkedIn = ARRIVED.includes(a.status) && a.work_order_id;

  return (
    <li className={`bk-row bk-row-${a.status}`}>
      <div className="bk-rowTop">
        <div className="bk-rowMain">
          <div className="bk-name">
            {a.customer_id
              ? <Link to={`/crm/customers/${a.customer_id}`} className="bk-nameLink">{name}</Link>
              : name}
          </div>
          <div className="bk-meta">
            {phone && <a className="bk-phone" href={`tel:${phone.replace(/\s/g, '')}`} dir="ltr"><Phone width={13} height={13} /> {phone}</a>}
            {plate && <span className="bk-plate" dir="ltr"><Car width={13} height={13} /> {plate}</span>}
            {vehicle && <span>{vehicle}</span>}
          </div>
        </div>
        <span className={`bk-chip bk-chip-${a.status}`}>{statusLabel(a.status)}</span>
      </div>

      <div className="bk-facts">
        {service && <span className="bk-fact"><b>{t('bookings.service', 'Service')}:</b> {service}</span>}
        <span className="bk-fact"><b>{t('bookings.bay', 'Bay')}:</b> {a.bay_name || t('bookings.any_bay_short', 'Any')}</span>
        <span className="bk-fact"><b>{t('bookings.length', 'Length')}:</b> {t('bookings.n_minutes', '{{n}} min', { n: a.slot_duration_min || 60 })}</span>
        {a.source && <span className="bk-fact"><b>{t('bookings.source', 'Booked by')}:</b> {sourceLabel(t, a.source)}</span>}
      </div>

      {a.notes && <p className="bk-notes">{a.notes}</p>}
      {a.status === 'cancelled' && a.cancelled_reason && (
        <p className="bk-reason"><b>{t('bookings.cancel_reason', 'Reason')}:</b> {a.cancelled_reason}</p>
      )}

      {(a.enquiry_id || a.estimate_id || a.work_order_id) && (
        <div className="bk-links">
          {a.enquiry_id && (
            <Link className="bk-ref" to={`/enquiries?id=${a.enquiry_id}`}>
              {t('bookings.enquiry', 'Enquiry')} <span dir="ltr">{a.enquiry_number || `#${a.enquiry_id}`}</span>
            </Link>
          )}
          {a.estimate_id && (
            <Link className="bk-ref" to={`/estimates?id=${a.estimate_id}`}>
              {t('bookings.quote', 'Quote')} <span dir="ltr">{a.estimate_number || `#${a.estimate_id}`}</span>
            </Link>
          )}
          {a.work_order_id && (
            <Link className="bk-ref bk-refJob" to={`/work-orders/${a.work_order_id}`}>
              {t('bookings.job_card', 'Job card')} <span dir="ltr">{a.work_order_number || `#${a.work_order_id}`}</span>
            </Link>
          )}
        </div>
      )}

      {mayBook && (open || checkedIn) && (
        <div className="bk-actions">
          {checkedIn ? (
            <Link className="bk-btn bk-btnNavy" to={`/work-orders/${a.work_order_id}`}>
              <OpenNewWindow width={16} height={16} /> {t('bookings.open_job_card', 'Open job card')}
            </Link>
          ) : (
            <>
              <button type="button" className="bk-btn bk-btnPrimary" onClick={onCheckIn} disabled={busy}>
                <LogIn width={16} height={16} /> {t('bookings.check_in', 'Check in')}
              </button>
              {a.status === 'pending' && (
                <button type="button" className="bk-btn bk-btnOk" onClick={onConfirm} disabled={busy}>
                  <Check width={16} height={16} /> {t('bookings.confirm', 'Confirm')}
                </button>
              )}
              {a.status !== 'no_show' && (
                <button type="button" className="bk-btn bk-btnGhost" onClick={onNoShow} disabled={busy}>
                  <UserXmark width={16} height={16} /> {t('bookings.no_show', 'No-show')}
                </button>
              )}
              <button type="button" className="bk-btn bk-btnDanger" onClick={onCancel} disabled={busy}>
                <Xmark width={16} height={16} /> {t('bookings.cancel_booking', 'Cancel booking')}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Odometer as typed → digits only: Arabic-Indic digits converted, spaces and
 *  thousands commas dropped; anything else ('12.5', '-500') is left for the
 *  check to refuse rather than silently changed into another number. */
const normKm = v => String(v ?? '')
  .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x660))
  .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x6F0))
  .replace(/[\s,]/g, '');

/** Check-in (asks the odometer — optional, recorded when given), cancel (asks
 *  the reason), no-show (confirms). */
function ActionDialog({ dialog, t, busy, onClose, onCheckIn, onStatus }) {
  const { kind, appt } = dialog;
  const [odo, setOdo] = useState('');
  const [lowOk, setLowOk] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const name = appt.customer_full_name || appt.customer_name || '';
  const plate = appt.plate_number || appt.vehicle_plate_db || '';
  const lastKm = appt.vehicle_mileage != null ? Number(appt.vehicle_mileage) : null;

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async e => {
    e.preventDefault();
    setError('');
    if (kind === 'checkin') {
      const clean = normKm(odo);
      if (clean && !/^\d{1,7}$/.test(clean)) { setError(t('bookings.err_odometer', 'Enter the reading in km, digits only.')); return; }
      if (clean && lastKm != null && Number(clean) < lastKm && !lowOk) {
        setError(t('bookings.err_odometer_low', 'The reading is lower than the last one recorded — tick the box to confirm it.')); return;
      }
      const msg = await onCheckIn(appt, clean);
      if (msg) setError(msg);
    } else if (kind === 'cancel') {
      if (!reason.trim()) { setError(t('bookings.err_reason', 'Give a reason for the cancellation.')); return; }
      await onStatus('cancelled', { cancelled_reason: reason.trim() });
    } else {
      await onStatus('no_show');
    }
  };

  const title = kind === 'checkin' ? t('bookings.checkin_title', 'Check the car in')
    : kind === 'cancel' ? t('bookings.cancel_title', 'Cancel this booking?')
      : t('bookings.no_show_title', 'Mark as no-show?');
  const cleanOdo = normKm(odo);
  const lower = kind === 'checkin' && lastKm != null && /^\d+$/.test(cleanOdo) && Number(cleanOdo) < lastKm;

  return (
    <div className="bk-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="bk-dlg" role="dialog" aria-modal="true" aria-labelledby="bk-dlg-title" onSubmit={submit}>
        <div className="bk-dlgHead">
          <h2 id="bk-dlg-title" className="bk-dlgTitle">{title}</h2>
          <button type="button" className="bk-dlgClose" onClick={onClose} disabled={busy} aria-label={t('bookings.close', 'Close')}>
            <Xmark width={18} height={18} />
          </button>
        </div>
        <p className="bk-dlgWho">
          <span>{name}</span>
          {plate && <span className="bk-plate" dir="ltr"><Car width={13} height={13} /> {plate}</span>}
          <span className="bk-dlgWhen" dir="ltr">{appt.appointment_date} · {String(appt.appointment_time).slice(0, 5)}</span>
        </p>

        {kind === 'checkin' && (
          <>
            <p className="bk-dlgText">
              {appt.work_order_id
                ? t('bookings.checkin_existing', 'The car arrives on its job card {{n}}.', { n: appt.work_order_number || `#${appt.work_order_id}` })
                : t('bookings.checkin_text', 'This opens the job card for the visit and takes you to it.')}
            </p>
            <label className="bk-field">
              <span>{t('bookings.odometer', 'Odometer (km)')} <span style={{ color: '#94a3b8', fontWeight: 600 }}>{t('bookings.optional', '(optional)')}</span></span>
              <input className="bk-input" inputMode="numeric" dir="ltr" autoFocus value={odo}
                onChange={e => { setOdo(e.target.value); setLowOk(false); }} placeholder={t('bookings.odometer_ph', 'Today\'s reading')} />
              {lastKm != null && (
                <small className={`bk-hint${lower ? ' bk-hintWarn' : ''}`}>
                  {lower
                    ? t('bookings.odometer_lower', 'Lower than the last reading ({{km}} km) — check it.', { km: lastKm.toLocaleString() })
                    : t('bookings.odometer_last', 'Last reading: {{km}} km', { km: lastKm.toLocaleString() })}
                </small>
              )}
            </label>
            {lower && (
              <label className="bk-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={lowOk} onChange={e => setLowOk(e.target.checked)} />
                <span>{t('bookings.odometer_low_ok', 'The reading is correct (e.g. the cluster was replaced)')}</span>
              </label>
            )}
          </>
        )}

        {kind === 'cancel' && (
          <label className="bk-field">
            <span>{t('bookings.cancel_reason', 'Reason')}</span>
            <textarea className="bk-input bk-textarea" rows={3} autoFocus value={reason}
              placeholder={t('bookings.cancel_reason_ph', 'e.g. customer rescheduled, car sold, went elsewhere…')}
              onChange={e => setReason(e.target.value)} />
          </label>
        )}

        {kind === 'no_show' && (
          <p className="bk-dlgText">{t('bookings.no_show_text', 'The customer did not arrive. The slot is freed; you can still check them in if they turn up late.')}</p>
        )}

        {error && <div className="bk-error bk-dlgError"><WarningCircle width={16} height={16} /> {error}</div>}

        <div className="bk-dlgFoot">
          <button type="button" className="bk-btn bk-btnGhost" onClick={onClose} disabled={busy}>
            {t('bookings.back', 'Back')}
          </button>
          <button type="submit" className={`bk-btn ${kind === 'cancel' ? 'bk-btnDangerSolid' : 'bk-btnPrimary'}`} disabled={busy}>
            {busy ? t('bookings.working', 'Working…')
              : kind === 'checkin' ? t('bookings.checkin_go', 'Check in & open job card')
                : kind === 'cancel' ? t('bookings.cancel_go', 'Cancel booking')
                  : t('bookings.no_show_go', 'Mark no-show')}
          </button>
        </div>
      </form>
    </div>
  );
}
