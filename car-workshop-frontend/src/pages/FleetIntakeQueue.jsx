/**
 * FleetIntakeQueue — what fleet coordinators have sent in, and turning it
 * into job cards.
 *
 * The staff half of the tokenised intake link. An advisor works this queue
 * the way they used to work a pile of paper sheets, except the chassis
 * number arrives typed rather than read off a photocopy.
 *
 * The important screen here is the detail panel's discrepancy list: where
 * our record of a vehicle and the fleet's own paperwork disagree. That is
 * the bit a human has to decide, and it is why nothing auto-converts.
 *
 * Accepting, rejecting, booking in and issuing links is intake work (Step 2:
 * job.open — Service Advisor, Supervisor, managers); other roles only read.
 */
import { useEffect, useState, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search, Car, Check, Xmark, Plus, Link as LinkIcon, Copy, WarningCircle, Refresh,
} from 'iconoir-react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { canDo } from '../lib/permissions';
import './FleetIntakeQueue.css';

const STATUS_TABS = [
  { key: 'submitted', label: 'Waiting' },
  { key: 'accepted',  label: 'Accepted' },
  { key: 'converted', label: 'Booked in' },
  { key: 'rejected',  label: 'Rejected' },
];

const SERVICE_CATEGORIES = [
  ['general_maintenance', 'General maintenance'], ['oil_change', 'Oil change'],
  ['brake_repair', 'Brake repair'], ['diagnostic', 'Diagnostic'],
  ['bodywork', 'Bodywork'], ['tire_service', 'Tire service'],
  ['engine_repair', 'Engine repair'], ['transmission', 'Transmission'],
  ['electrical', 'Electrical'], ['other', 'Other'],
];

const ref = (id) => `FI-${String(id).padStart(6, '0')}`;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isExpired = (l) => !!l.expires_at && new Date(String(l.expires_at).replace(' ', 'T')) < new Date();
/** A link's expiry as a local calendar day (the server sends a timestamp). */
const fmtDay = (s) => { const d = new Date(String(s).replace(' ', 'T')); return Number.isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };

export default function FleetIntakeQueue() {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const mayAct = canDo(user, 'job.open');
  const [tab, setTab] = useState('submitted');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ submitted: 0, accepted: 0, rejected: 0, converted: 0 });
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(''); // the server's message when this role may not work the queue
  const [toast, setToast] = useState('');

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showLinks, setShowLinks] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: tab, limit: '100' });
      if (search.trim()) params.set('search', search.trim());
      const res = await api.get(`/fleet-intake?${params}`);
      if (res.success) { setRows(res.data || []); setCounts(res.counts || counts); setForbidden(''); }
      else if (res.status === 403) { setRows([]); setForbidden(res.message || t('fleetIntake.sa_only', 'Requests are accepted, rejected and booked in by the Service Advisor, Supervisor or a manager.')); }
    } catch { /* surfaced by the empty state */ }
    finally { setLoading(false); }
  }, [tab, search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const tm = setTimeout(load, search ? 300 : 0); return () => clearTimeout(tm); }, [load, search]);

  const openDetail = async (row) => {
    setDetailLoading(true);
    setDetail({ id: row.id, loading: true });
    try {
      const res = await api.get(`/fleet-intake/${row.id}`);
      if (res.success) setDetail(res.data);
      else { setDetail(null); setToast(res.message || t('fleetIntake.open_failed', 'Could not open that request')); }
    } catch { setDetail(null); setToast(t('fleetIntake.open_failed', 'Could not open that request')); }
    finally { setDetailLoading(false); }
  };

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3600); };
  const tabLabel = (k) => t(`fleetIntake.tab_${k}`, (STATUS_TABS.find(x => x.key === k) || {}).label || k);

  return (
    <>
      <div className="fq-wrap">
        <header className="fq-head">
          <div>
            <h1 className="fq-title">{t('fleetIntake.title', 'Fleet intake')}</h1>
            <p className="fq-sub">{t('fleetIntake.subtitle', 'Vehicles sent in by fleet coordinators, waiting to be booked in.')}</p>
          </div>
          <div className="fq-headActions">
            <button className="fq-btn fq-btnGhost" onClick={load} title={t('fleetIntake.refresh', 'Refresh')}>
              <Refresh width={16} height={16} /> {t('fleetIntake.refresh', 'Refresh')}
            </button>
            {/* The links are keys to the fleet's intake form: issued and
                disabled by the intake roles only. */}
            {mayAct && (
              <button className="fq-btn" onClick={() => setShowLinks(true)}>
                <LinkIcon width={16} height={16} /> {t('fleetIntake.links', 'Coordinator links')}
              </button>
            )}
          </div>
        </header>

        <div className="fq-tabs">
          {STATUS_TABS.map(x => (
            <button key={x.key}
              className={`fq-tab${tab === x.key ? ' fq-tabOn' : ''}`}
              onClick={() => setTab(x.key)}>
              {tabLabel(x.key)}
              <span className="fq-count">{counts[x.key] ?? 0}</span>
            </button>
          ))}
          <div className="fq-searchWrap">
            <Search width={15} height={15} />
            <input className="fq-search" placeholder={t('fleetIntake.search_ph', 'Plate, VIN, unit code or fleet…')}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="fq-empty">{t('fleetIntake.loading', 'Loading…')}</div>
        ) : forbidden ? (
          <div className="fq-empty"><WarningCircle width={30} height={30} /><p>{forbidden}</p></div>
        ) : rows.length === 0 ? (
          <div className="fq-empty">
            <Car width={30} height={30} />
            <p>{search.trim()
              ? t('fleetIntake.no_match', 'Nothing matches "{{q}}".', { q: search })
              : tab === 'submitted'
                ? t('fleetIntake.empty_waiting', 'Nothing waiting. Coordinators who have a link can send vehicles in at any time.')
                : t('fleetIntake.empty_tab', 'No {{tab}} requests.', { tab: tabLabel(tab).toLowerCase() })}</p>
          </div>
        ) : (
          <div className="fq-list">
            {rows.map(r => (
              <button key={r.id} className="fq-row" onClick={() => openDetail(r)}>
                <div className="fq-rowRef">{ref(r.id)}</div>
                <div className="fq-rowMain">
                  <div className="fq-rowPlate">
                    {r.plate_number || r.fleet_code || '—'}
                    {r.plate_code ? <span className="fq-plateCode">{r.plate_code}</span> : null}
                    {!r.vehicle_id && <span className="fq-chip fq-chipWarn">{t('fleetIntake.new_to_us', 'New to us')}</span>}
                  </div>
                  <div className="fq-rowMeta">
                    {[r.make, r.model, r.year].filter(Boolean).join(' ') || t('fleetIntake.not_described', 'Vehicle not described')}
                    {r.fleet_code ? ` · ${t('fleetIntake.unit', 'Unit')} ${r.fleet_code}` : ''}
                  </div>
                </div>
                <div className="fq-rowFleet">
                  <div className="fq-rowFleetName">{r.customer_name}</div>
                  <div className="fq-rowMeta">{r.customer_code || '—'}</div>
                </div>
                <div className="fq-rowComplaint" title={r.complaint}>{r.complaint}</div>
                <div className="fq-rowRight">
                  {r.work_order_number
                    ? <span className="fq-chip fq-chipOk">{r.work_order_number}</span>
                    : <span className="fq-rowKm" dir="ltr">{r.odometer != null ? `${Number(r.odometer).toLocaleString('en-US')} km` : '—'}</span>}
                  <div className="fq-rowAgo">{ago(r.created_at, t)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {detail && (
        <DetailModal
          detail={detail} loading={detailLoading} mayAct={mayAct}
          onClose={() => setDetail(null)}
          onDone={(msg) => { setDetail(null); flash(msg); load(); }}
          onError={flash}
        />
      )}
      {showLinks && mayAct && <LinksModal onClose={() => setShowLinks(false)} onFlash={flash} />}
      {toast && <div className="fq-toast" role="status">{toast}</div>}
    </>
  );
}

/* ── Detail: review, match, convert ───────────────────────────────────── */
function DetailModal({ detail, loading, mayAct, onClose, onDone, onError }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [createVehicle, setCreateVehicle] = useState(false);
  const [updateVehicle, setUpdateVehicle] = useState(true);
  const [category, setCategory] = useState('general_maintenance');
  const [rejecting, setRejecting] = useState(false);
  // Make / model / year for a new vehicle the coordinator did not describe
  // (POST /:id/convert takes them when the request has none).
  const [veh, setVeh] = useState({ make: '', model: '', year: '' });

  useEffect(() => {
    // Default the "add as new vehicle" tick to whatever this request needs:
    // on when we hold no match, off when we do. An advisor who never looks
    // at it still gets the right outcome.
    if (detail && !detail.loading) {
      setCreateVehicle(!detail.matched_vehicle);
      setVeh({ make: detail.make || '', model: detail.model || '', year: detail.year ? String(detail.year) : '' });
    }
  }, [detail]);

  if (loading || detail.loading) {
    return <Shell onClose={onClose}><div className="fq-mLoading">{t('fleetIntake.loading', 'Loading…')}</div></Shell>;
  }

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res.success) onDone(okMsg(res));
      else onError(res.message || t('fleetIntake.failed', 'That did not work'));
    } catch { onError(t('fleetIntake.failed', 'That did not work')); }
    finally { setBusy(false); }
  };

  const convert = () => act(
    () => api.post(`/fleet-intake/${detail.id}/convert`, {
      vehicle_id: detail.matched_vehicle?.id || undefined,
      create_vehicle: createVehicle,
      update_vehicle: updateVehicle,
      service_category: category,
      ...(createVehicle && needsMakeModel ? { make: veh.make.trim(), model: veh.model.trim(), ...(veh.year ? { year: Number(veh.year) } : {}) } : {}),
    }),
    (res) => t('fleetIntake.converted', 'Job card {{n}} created', { n: res.data.work_order_number })
  );

  const review = (decision) => act(
    () => api.post(`/fleet-intake/${detail.id}/review`, { decision, review_note: decision === 'rejected' ? note : (note || undefined) }),
    (res) => decision === 'accepted'
      ? (detail.status === 'rejected' ? t('fleetIntake.reopened', 'Reopened — the request is accepted again') : t('fleetIntake.accepted', 'Accepted'))
      : (res.coordinator_notified ? t('fleetIntake.rejected_told', 'Rejected — the coordinator has been sent the reason') : t('fleetIntake.rejected', 'Rejected'))
  );

  const done = detail.status === 'converted';
  const rejected = detail.status === 'rejected';
  const mv = detail.matched_vehicle;
  // The VIN is on file for ANOTHER customer's car: not this fleet's vehicle
  // (sold on, or a mistyped chassis number). The advisor settles it first.
  const conflict = !mv ? detail.vin_conflict : null;
  // No match and the coordinator gave no make/model: the advisor adds them here.
  const needsMakeModel = !mv && (!detail.make || !detail.model);
  const blocked = !!conflict || (createVehicle && needsMakeModel && (!veh.make.trim() || !veh.model.trim()));

  return (
    <Shell onClose={onClose}>
      <header className="fq-mHead">
        <div>
          <p className="fq-mRef">{ref(detail.id)}</p>
          <h2 className="fq-mTitle">
            {detail.plate_number || detail.fleet_code || t('fleetIntake.vehicle', 'Vehicle')}
            {detail.plate_code ? ` ${detail.plate_code}` : ''}
          </h2>
          <p className="fq-mSub">
            {detail.customer_name}{detail.customer_code ? ` · ${detail.customer_code}` : ''}
          </p>
        </div>
        <span className={`fq-status fq-status-${detail.status}`}>{statusLabel(detail.status, t)}</span>
      </header>

      <div className="fq-mBody">
        {done && (
          <div className="fq-banner fq-bannerOk">
            {t('fleetIntake.booked_as', 'Booked in as')} <strong>{detail.work_order_number}</strong>.
          </div>
        )}
        {rejected && (
          <div className="fq-banner fq-bannerBad">
            {t('fleetIntake.rejected', 'Rejected')}{detail.review_note ? ` — ${detail.review_note}` : ''}.
          </div>
        )}

        <section className="fq-mSection">
          <h3 className="fq-mH3">{t('fleetIntake.what_sent', 'What they sent')}</h3>
          <dl className="fq-dl">
            <Row k={t('fleetIntake.f_fault', 'Fault')} v={detail.complaint} wide />
            <Row k={t('fleetIntake.f_mileage', 'Mileage')} v={detail.odometer != null ? `${Number(detail.odometer).toLocaleString('en-US')} km` : null} ltr />
            <Row k={t('fleetIntake.f_vin', 'VIN')} v={detail.vin} mono />
            <Row k={t('fleetIntake.f_engine', 'Engine no')} v={detail.engine_no} mono />
            <Row k={t('fleetIntake.f_unit', 'Unit code')} v={detail.fleet_code} />
            <Row k={t('fleetIntake.f_vehicle', 'Vehicle')} v={[detail.year, detail.make, detail.model, detail.color].filter(Boolean).join(' ')} />
            <Row k={t('fleetIntake.f_work_type', 'Work type')} v={detail.work_type} />
            <Row k={t('fleetIntake.f_their_ref', 'Their WO ref')} v={detail.external_ref} mono />
            <Row k={t('fleetIntake.f_driver', 'Driver')} v={[detail.driver_name, detail.driver_phone].filter(Boolean).join(' · ')} />
            <Row k={t('fleetIntake.f_permit', 'Permit ID')} v={detail.permit_id} />
            <Row k={t('fleetIntake.f_sent_by', 'Sent by')} v={detail.submitted_by} />
            <Row k={t('fleetIntake.f_preferred', 'Preferred date')} v={detail.preferred_date ? String(detail.preferred_date).slice(0, 10) : null} ltr />
          </dl>
        </section>

        <section className="fq-mSection">
          <h3 className="fq-mH3">{t('fleetIntake.our_record', 'Our record')}</h3>
          {detail.open_work_orders?.length > 0 && !done && (
            <div className="fq-noMatch" style={{ marginBottom: 10 }}>
              <WarningCircle width={17} height={17} />
              <div>
                {t('fleetIntake.already_open', 'This car is already with us on an open job card: {{list}}. Check it is not the same visit before booking it in again.',
                  { list: detail.open_work_orders.map(w => w.work_order_number).join(', ') })}
              </div>
            </div>
          )}
          {conflict ? (
            <div className="fq-noMatch">
              <WarningCircle width={17} height={17} />
              <div>
                {t('fleetIntake.vin_conflict', 'This VIN is on file for a vehicle of another customer ({{owner}}, {{plate}}), not this fleet. Check the chassis number with the coordinator: if it was mistyped, reject the request with the reason so they can send it again; if the car changed hands, move it on the Vehicles page first.',
                  { owner: conflict.owner_name || '—', plate: conflict.plate_number || '—' })}
              </div>
            </div>
          ) : mv ? (
            <>
              <div className="fq-matched">
                <Car width={17} height={17} />
                <div>
                  <strong>{mv.plate_number || '—'}</strong>
                  {' — '}{[mv.make, mv.model].filter(Boolean).join(' ')}
                  <div className="fq-matchedOn">{matchLabel(detail.matched_on, t)}</div>
                </div>
              </div>

              {detail.discrepancies?.length > 0 && (
                <div className="fq-disc">
                  <div className="fq-discTitle">
                    <WarningCircle width={15} height={15} />
                    {detail.discrepancies.length === 1
                      ? t('fleetIntake.disc_one', 'One detail does not match our record')
                      : t('fleetIntake.disc_many', '{{n}} details do not match our record', { n: detail.discrepancies.length })}
                  </div>
                  <table className="fq-discTable">
                    <thead><tr><th>{t('fleetIntake.field', 'Field')}</th><th>{t('fleetIntake.ours', 'Ours')}</th><th>{t('fleetIntake.theirs', 'Theirs')}</th></tr></thead>
                    <tbody>
                      {detail.discrepancies.map(d => (
                        <tr key={d.field}>
                          <td>{t(`fleetIntake.disc_${d.field}`, d.label)}</td>
                          <td className="fq-mono">{d.ours}</td>
                          <td className="fq-mono fq-theirs">{d.submitted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="fq-discHelp">
                    {t('fleetIntake.disc_help', 'Nothing is overwritten automatically. Check the car, then correct whichever record is wrong from the Vehicles page.')}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="fq-noMatch">
              <WarningCircle width={17} height={17} />
              <div>
                {t('fleetIntake.no_vehicle', 'No vehicle on file matches this plate, VIN or unit code.')}
                {!done && !rejected && mayAct && ` ${needsMakeModel
                  ? t('fleetIntake.tick_below_mm', 'It is added as a new vehicle when you book it in — enter its make and model below.')
                  : t('fleetIntake.tick_below', 'Tick below to add it as a new vehicle.')}`}
              </div>
            </div>
          )}
        </section>

        {!done && !rejected && mayAct && !conflict && (
          <section className="fq-mSection">
            <h3 className="fq-mH3">{t('fleetIntake.book_in', 'Book it in')}</h3>
            <label className="fq-check">
              <input type="checkbox" checked={createVehicle} disabled={!!mv}
                onChange={e => setCreateVehicle(e.target.checked)} />
              <span>{t('fleetIntake.add_new_vehicle', 'Add as a new vehicle')}{mv ? ` ${t('fleetIntake.already_matched', '(already matched)')}` : ''}</span>
            </label>
            {createVehicle && needsMakeModel && (
              <div className="fq-linkForm" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 10 }}>
                <input className="fq-input" placeholder={t('fleetIntake.make_req', 'Make *')} aria-label={t('fleetIntake.make', 'Make')}
                  value={veh.make} onChange={e => setVeh(v => ({ ...v, make: e.target.value }))} />
                <input className="fq-input" placeholder={t('fleetIntake.model_req', 'Model *')} aria-label={t('fleetIntake.model', 'Model')}
                  value={veh.model} onChange={e => setVeh(v => ({ ...v, model: e.target.value }))} />
                <input className="fq-input" placeholder={t('fleetIntake.year', 'Year')} aria-label={t('fleetIntake.year', 'Year')} inputMode="numeric" dir="ltr"
                  value={veh.year} onChange={e => setVeh(v => ({ ...v, year: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
              </div>
            )}
            <label className="fq-check">
              <input type="checkbox" checked={updateVehicle}
                onChange={e => setUpdateVehicle(e.target.checked)} />
              <span>{t('fleetIntake.copy_missing', 'Copy any missing VIN, engine number or unit code onto the vehicle')}</span>
            </label>
            <div className="fq-catRow">
              <label className="fq-label" htmlFor="fq-cat">{t('fleetIntake.service_category', 'Service category')}</label>
              <select id="fq-cat" className="fq-input" value={category} onChange={e => setCategory(e.target.value)}>
                {SERVICE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{t(`fleetIntake.cat_${v}`, l)}</option>)}
              </select>
            </div>
          </section>
        )}

        {!done && !rejected && mayAct && rejecting && (
          <section className="fq-mSection">
            <div className="fq-rejectBox">
              <label className="fq-label" htmlFor="fq-note">{t('fleetIntake.why_reject', 'Why is this being rejected?')}</label>
              <textarea id="fq-note" className="fq-input" rows={2} value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('fleetIntake.reject_ph', 'Duplicate of FI-000012 — same car already booked in.')} />
              <p className="fq-help">{t('fleetIntake.reason_required', 'The fleet needs to know what to fix, so a reason is required.')}</p>
            </div>
          </section>
        )}

        {!mayAct && !done && (
          <p className="fq-help">{t('fleetIntake.sa_only', 'Requests are accepted, rejected and booked in by the Service Advisor, Supervisor or a manager.')}</p>
        )}
      </div>

      <footer className="fq-mFoot">
        <button className="fq-btn fq-btnGhost" onClick={onClose} disabled={busy}>{t('fleetIntake.close', 'Close')}</button>
        {/* A rejected request can be reopened (accepted again) and then booked in. */}
        {mayAct && rejected && (
          <button className="fq-btn" onClick={() => review('accepted')} disabled={busy}>
            <Refresh width={16} height={16} /> {t('fleetIntake.reopen', 'Reopen')}
          </button>
        )}
        {mayAct && !done && !rejected && (
          <>
            {rejecting ? (
              <>
                <button className="fq-btn fq-btnGhost" onClick={() => { setRejecting(false); setNote(''); }} disabled={busy}>
                  {t('fleetIntake.cancel', 'Cancel')}
                </button>
                <button className="fq-btn fq-btnDanger" onClick={() => review('rejected')} disabled={busy || !note.trim()}>
                  <Xmark width={16} height={16} /> {t('fleetIntake.confirm_reject', 'Confirm reject')}
                </button>
              </>
            ) : (
              <>
                <button className="fq-btn fq-btnGhost" onClick={() => setRejecting(true)} disabled={busy}>
                  <Xmark width={16} height={16} /> {t('fleetIntake.reject', 'Reject')}
                </button>
                {detail.status === 'submitted' && (
                  <button className="fq-btn fq-btnGhost" onClick={() => review('accepted')} disabled={busy}
                    title={t('fleetIntake.accept_hint', 'Acknowledge it now and book it in when the car arrives')}>
                    <Check width={16} height={16} /> {t('fleetIntake.accept', 'Accept')}
                  </button>
                )}
                <button className="fq-btn" onClick={convert} disabled={busy || blocked}>
                  <Check width={16} height={16} /> {busy ? t('fleetIntake.working', 'Working…') : t('fleetIntake.create_jc', 'Create job card')}
                </button>
              </>
            )}
          </>
        )}
      </footer>
    </Shell>
  );
}

/* ── Coordinator links ────────────────────────────────────────────────── */
function LinksModal({ onClose, onFlash }) {
  const { t } = useTranslation();
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customer_id: '', label: '', contact_name: '', contact_phone: '', expires_on: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/fleet-intake/links');
      if (res.success) setLinks(res.data || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Links are for accounts that send vehicles in bulk: Fleet and Insurance
    // accounts, internal or external (Step 1). Not walk-ins, not company
    // assets, not unclassified accounts.
    Promise.all(['fleet', 'insurance'].map(sub =>
      api.get(`/customers?customer_subcategory=${sub}&active_only=1&limit=200`).catch(() => null)))
      .then(rs => {
        const all = rs.flatMap(r => (r?.success ? r.data || [] : []));
        all.sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
        setCustomers(all);
      });
  }, []);

  const create = async () => {
    if (!form.customer_id) return onFlash(t('fleetIntake.choose_account_first', 'Choose the fleet account first'));
    if (form.expires_on && form.expires_on < todayISO()) return onFlash(t('fleetIntake.expiry_past', 'The expiry date is in the past.'));
    setCreating(true);
    try {
      const { expires_on, ...rest } = form;
      // A date means "valid through that day", not "dead at midnight".
      const body = { ...rest, ...(expires_on ? { expires_at: `${expires_on} 23:59:59` } : {}) };
      const res = await api.post('/fleet-intake/links', body);
      if (res.success) {
        setForm({ customer_id: '', label: '', contact_name: '', contact_phone: '', expires_on: '' });
        onFlash(t('fleetIntake.link_created', 'Link created — copy it and send it to the coordinator'));
        load();
      } else onFlash(res.message || t('fleetIntake.link_failed', 'Could not create the link'));
    } finally { setCreating(false); }
  };

  const toggle = async (l) => {
    const res = await api.patch(`/fleet-intake/links/${l.id}`, { is_active: !l.is_active });
    if (res.success) { onFlash(l.is_active ? t('fleetIntake.link_disabled', 'Link disabled') : t('fleetIntake.link_enabled', 'Link enabled')); load(); }
    else onFlash(res.message || t('fleetIntake.update_failed', 'Could not update'));
  };

  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); onFlash(t('fleetIntake.link_copied', 'Link copied')); }
    catch { onFlash(t('fleetIntake.copy_failed', 'Could not copy — select the link and copy it by hand')); }
  };

  return (
    <Shell onClose={onClose} wide>
      <header className="fq-mHead">
        <div>
          <h2 className="fq-mTitle">{t('fleetIntake.links', 'Coordinator links')}</h2>
          <p className="fq-mSub">
            {t('fleetIntake.links_sub', 'One link per fleet account. Anyone holding it can send vehicles in for that account without a login — so treat it like a key and disable it when someone leaves.')}
          </p>
        </div>
      </header>

      <div className="fq-mBody">
        <section className="fq-mSection">
          <h3 className="fq-mH3">{t('fleetIntake.issue_link', 'Issue a new link')}</h3>
          <div className="fq-linkForm">
            <select className="fq-input" value={form.customer_id}
              onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
              <option value="">{t('fleetIntake.choose_account', 'Choose the fleet account…')}</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} — ` : ''}{c.full_name}
                  {` (${c.customer_class === 'internal' ? t('fleetIntake.internal', 'Internal') : t('fleetIntake.external', 'External')} · ${c.customer_subcategory === 'insurance' ? t('fleetIntake.insurance', 'Insurance') : t('fleetIntake.fleet', 'Fleet')})`}
                </option>
              ))}
            </select>
            <input className="fq-input" placeholder={t('fleetIntake.label_ph', 'Label, e.g. Renjit — Fleet Supervisor')}
              value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            <input className="fq-input" placeholder={t('fleetIntake.contact_name', 'Contact name')}
              value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
            <input className="fq-input" placeholder={t('fleetIntake.contact_phone', 'Contact phone')} dir="ltr"
              value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} />
            <label className="fq-label" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {t('fleetIntake.expires_on', 'Valid until (optional)')}
              <input className="fq-input" type="date" min={todayISO()} value={form.expires_on}
                onChange={e => setForm(f => ({ ...f, expires_on: e.target.value }))} />
            </label>
            <button className="fq-btn" onClick={create} disabled={creating}>
              <Plus width={16} height={16} /> {creating ? t('fleetIntake.creating', 'Creating…') : t('fleetIntake.create_link', 'Create link')}
            </button>
          </div>
          {customers.length === 0 && (
            <p className="fq-help">
              {t('fleetIntake.no_accounts', 'No Fleet or Insurance accounts yet. Classify the customer as Fleet or Insurance on the Customers page and it will appear here.')}
            </p>
          )}
        </section>

        <section className="fq-mSection">
          <h3 className="fq-mH3">{t('fleetIntake.existing_links', 'Existing links')}</h3>
          {loading ? <div className="fq-mLoading">{t('fleetIntake.loading', 'Loading…')}</div>
            : links.length === 0 ? <p className="fq-help">{t('fleetIntake.no_links', 'No links issued yet.')}</p>
            : (
              <div className="fq-linkList">
                {links.map(l => {
                  const expired = isExpired(l);
                  return (
                    <div key={l.id} className={`fq-link${l.is_active && !expired ? '' : ' fq-linkOff'}`}>
                      <div className="fq-linkMain">
                        <div className="fq-linkName">
                          {l.label || l.customer_name}
                          {!l.is_active && <span className="fq-chip">{t('fleetIntake.disabled', 'Disabled')}</span>}
                          {l.is_active && expired && <span className="fq-chip fq-chipWarn">{t('fleetIntake.expired', 'Expired')}</span>}
                        </div>
                        <div className="fq-linkMeta">
                          {l.customer_code ? `${l.customer_code} · ` : ''}{l.customer_name}
                          {l.submission_count ? ` · ${t('fleetIntake.n_sent', '{{n}} sent', { n: l.submission_count })}` : ` · ${t('fleetIntake.none_sent', 'none sent yet')}`}
                          {l.last_used_at ? ` · ${t('fleetIntake.last_used', 'last {{ago}}', { ago: ago(l.last_used_at, t) })}` : ''}
                          {l.expires_at ? ` · ${expired ? t('fleetIntake.expired_on', 'expired {{d}}', { d: fmtDay(l.expires_at) }) : t('fleetIntake.valid_until', 'valid until {{d}}', { d: fmtDay(l.expires_at) })}` : ''}
                        </div>
                        <code className="fq-linkUrl">{l.url}</code>
                      </div>
                      <div className="fq-linkActions">
                        {!expired && (
                          <button className="fq-btn fq-btnGhost fq-btnSm" onClick={() => copy(l.url)}>
                            <Copy width={14} height={14} /> {t('fleetIntake.copy', 'Copy')}
                          </button>
                        )}
                        <button className="fq-btn fq-btnGhost fq-btnSm" onClick={() => toggle(l)}>
                          {l.is_active ? t('fleetIntake.disable', 'Disable') : t('fleetIntake.enable', 'Enable')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </section>
      </div>

      <footer className="fq-mFoot">
        <button className="fq-btn fq-btnGhost" onClick={onClose}>{t('fleetIntake.close', 'Close')}</button>
      </footer>
    </Shell>
  );
}

/* ── bits ─────────────────────────────────────────────────────────────── */
function Shell({ children, onClose, wide }) {
  const { t } = useTranslation();
  return (
    <div className="fq-overlay" onClick={onClose}>
      <div className={`fq-modal${wide ? ' fq-modalWide' : ''}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="fq-close" onClick={onClose} aria-label={t('fleetIntake.close', 'Close')}><Xmark width={18} height={18} /></button>
        {children}
      </div>
    </div>
  );
}

function Row({ k, v, mono, wide, ltr }) {
  if (!v) return null;
  return (
    <div className={`fq-dRow${wide ? ' fq-dRowWide' : ''}`}>
      <dt>{k}</dt>
      <dd className={mono ? 'fq-mono' : ''} dir={mono || ltr ? 'ltr' : undefined}>{v}</dd>
    </div>
  );
}

const statusLabel = (s, t) => ({
  submitted: t('fleetIntake.tab_submitted', 'Waiting'), accepted: t('fleetIntake.tab_accepted', 'Accepted'),
  rejected: t('fleetIntake.tab_rejected', 'Rejected'), converted: t('fleetIntake.tab_converted', 'Booked in'),
}[s] || s);

/** How our record was matched: on what the coordinator sent (VIN, plate,
 *  unit code), or 'stored' — a vehicle an advisor chose by hand. */
const matchLabel = (m, t) => ({
  vin: t('fleetIntake.matched_vin', 'Matched on the chassis number'),
  plate: t('fleetIntake.matched_plate', 'Matched on the plate number'),
  fleet_code: t('fleetIntake.matched_unit', 'Matched on their unit code'),
  stored: t('fleetIntake.matched_by_hand', 'Chosen by an advisor when it was booked in'),
}[m] || t('fleetIntake.matched_on', 'Matched on {{m}}', { m }));

function ago(ts, t) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('fleetIntake.just_now', 'just now');
  if (mins < 60) return t('fleetIntake.mins_ago', '{{n}}m ago', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('fleetIntake.hrs_ago', '{{n}}h ago', { n: hrs });
  const days = Math.floor(hrs / 24);
  return days === 1 ? t('fleetIntake.yesterday', 'yesterday') : t('fleetIntake.days_ago', '{{n}}d ago', { n: days });
}
