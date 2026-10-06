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
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Search, Car, Check, Xmark, Plus, Link as LinkIcon, Copy, WarningCircle, Refresh,
} from 'iconoir-react';
import api from '../lib/api';
import Layout from '../components/Layout';
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

export default function FleetIntakeQueue() {
  const [tab, setTab] = useState('submitted');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ submitted: 0, accepted: 0, rejected: 0, converted: 0 });
  const [loading, setLoading] = useState(true);
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
      if (res.success) { setRows(res.data || []); setCounts(res.counts || counts); }
    } catch { /* surfaced by the empty state */ }
    finally { setLoading(false); }
  }, [tab, search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  const openDetail = async (row) => {
    setDetailLoading(true);
    setDetail({ id: row.id, loading: true });
    try {
      const res = await api.get(`/fleet-intake/${row.id}`);
      if (res.success) setDetail(res.data);
      else { setDetail(null); setToast(res.message || 'Could not open that request'); }
    } catch { setDetail(null); setToast('Could not open that request'); }
    finally { setDetailLoading(false); }
  };

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3600); };

  return (
    <Layout>
      <div className="fq-wrap">
        <header className="fq-head">
          <div>
            <h1 className="fq-title">Fleet intake</h1>
            <p className="fq-sub">Vehicles sent in by fleet coordinators, waiting to be booked in.</p>
          </div>
          <div className="fq-headActions">
            <button className="fq-btn fq-btnGhost" onClick={load} title="Refresh">
              <Refresh width={16} height={16} /> Refresh
            </button>
            <button className="fq-btn" onClick={() => setShowLinks(true)}>
              <LinkIcon width={16} height={16} /> Coordinator links
            </button>
          </div>
        </header>

        <div className="fq-tabs">
          {STATUS_TABS.map(t => (
            <button key={t.key}
              className={`fq-tab${tab === t.key ? ' fq-tabOn' : ''}`}
              onClick={() => setTab(t.key)}>
              {t.label}
              <span className="fq-count">{counts[t.key] ?? 0}</span>
            </button>
          ))}
          <div className="fq-searchWrap">
            <Search width={15} height={15} />
            <input className="fq-search" placeholder="Plate, VIN, unit code or fleet…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="fq-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="fq-empty">
            <Car width={30} height={30} />
            <p>{search.trim()
              ? `Nothing matches "${search}".`
              : tab === 'submitted'
                ? 'Nothing waiting. Coordinators who have a link can send vehicles in at any time.'
                : `No ${STATUS_TABS.find(t => t.key === tab).label.toLowerCase()} requests.`}</p>
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
                    {!r.vehicle_id && <span className="fq-chip fq-chipWarn">New to us</span>}
                  </div>
                  <div className="fq-rowMeta">
                    {[r.make, r.model, r.year].filter(Boolean).join(' ') || 'Vehicle not described'}
                    {r.fleet_code ? ` · Unit ${r.fleet_code}` : ''}
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
                    : <span className="fq-rowKm">{r.odometer != null ? `${Number(r.odometer).toLocaleString()} km` : '—'}</span>}
                  <div className="fq-rowAgo">{ago(r.created_at)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {detail && (
        <DetailModal
          detail={detail} loading={detailLoading}
          onClose={() => setDetail(null)}
          onDone={(msg) => { setDetail(null); flash(msg); load(); }}
          onError={flash}
        />
      )}
      {showLinks && <LinksModal onClose={() => setShowLinks(false)} onFlash={flash} />}
      {toast && <div className="fq-toast">{toast}</div>}
    </Layout>
  );
}

/* ── Detail: review, match, convert ───────────────────────────────────── */
function DetailModal({ detail, loading, onClose, onDone, onError }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [createVehicle, setCreateVehicle] = useState(false);
  const [updateVehicle, setUpdateVehicle] = useState(true);
  const [category, setCategory] = useState('general_maintenance');
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    // Default the "add as new vehicle" tick to whatever this request needs:
    // on when we hold no match, off when we do. An advisor who never looks
    // at it still gets the right outcome.
    if (detail && !detail.loading) setCreateVehicle(!detail.matched_vehicle);
  }, [detail]);

  if (loading || detail.loading) {
    return <Shell onClose={onClose}><div className="fq-mLoading">Loading…</div></Shell>;
  }

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res.success) onDone(okMsg(res));
      else onError(res.message || 'That did not work');
    } catch { onError('That did not work'); }
    finally { setBusy(false); }
  };

  const convert = () => act(
    () => api.post(`/fleet-intake/${detail.id}/convert`, {
      vehicle_id: detail.matched_vehicle?.id || undefined,
      create_vehicle: createVehicle,
      update_vehicle: updateVehicle,
      service_category: category,
    }),
    (res) => `Job card ${res.data.work_order_number} created`
  );

  const review = (decision) => act(
    () => api.post(`/fleet-intake/${detail.id}/review`, { decision, review_note: note }),
    () => decision === 'accepted' ? 'Accepted' : 'Rejected'
  );

  const done = detail.status === 'converted';

  return (
    <Shell onClose={onClose}>
      <header className="fq-mHead">
        <div>
          <p className="fq-mRef">{ref(detail.id)}</p>
          <h2 className="fq-mTitle">
            {detail.plate_number || detail.fleet_code || 'Vehicle'}
            {detail.plate_code ? ` ${detail.plate_code}` : ''}
          </h2>
          <p className="fq-mSub">
            {detail.customer_name}{detail.customer_code ? ` · ${detail.customer_code}` : ''}
          </p>
        </div>
        <span className={`fq-status fq-status-${detail.status}`}>{statusLabel(detail.status)}</span>
      </header>

      <div className="fq-mBody">
        {done && (
          <div className="fq-banner fq-bannerOk">
            Booked in as <strong>{detail.work_order_number}</strong>.
          </div>
        )}
        {detail.status === 'rejected' && (
          <div className="fq-banner fq-bannerBad">
            Rejected{detail.review_note ? ` — ${detail.review_note}` : ''}.
          </div>
        )}

        <section className="fq-mSection">
          <h3 className="fq-mH3">What they sent</h3>
          <dl className="fq-dl">
            <Row k="Fault" v={detail.complaint} wide />
            <Row k="Mileage" v={detail.odometer != null ? `${Number(detail.odometer).toLocaleString()} km` : null} />
            <Row k="VIN" v={detail.vin} mono />
            <Row k="Engine no" v={detail.engine_no} mono />
            <Row k="Unit code" v={detail.fleet_code} />
            <Row k="Vehicle" v={[detail.year, detail.make, detail.model, detail.color].filter(Boolean).join(' ')} />
            <Row k="Work type" v={detail.work_type} />
            <Row k="Their WO ref" v={detail.external_ref} mono />
            <Row k="Driver" v={[detail.driver_name, detail.driver_phone].filter(Boolean).join(' · ')} />
            <Row k="Permit ID" v={detail.permit_id} />
            <Row k="Sent by" v={detail.submitted_by} />
            <Row k="Preferred date" v={detail.preferred_date ? String(detail.preferred_date).slice(0, 10) : null} />
          </dl>
        </section>

        <section className="fq-mSection">
          <h3 className="fq-mH3">Our record</h3>
          {detail.matched_vehicle ? (
            <>
              <div className="fq-matched">
                <Car width={17} height={17} />
                <div>
                  <strong>{detail.matched_vehicle.plate_number || '—'}</strong>
                  {' — '}{[detail.matched_vehicle.make, detail.matched_vehicle.model].filter(Boolean).join(' ')}
                  <div className="fq-matchedOn">Matched on {matchLabel(detail.matched_on)}</div>
                </div>
              </div>

              {detail.discrepancies?.length > 0 && (
                <div className="fq-disc">
                  <div className="fq-discTitle">
                    <WarningCircle width={15} height={15} />
                    {detail.discrepancies.length === 1
                      ? 'One detail does not match our record'
                      : `${detail.discrepancies.length} details do not match our record`}
                  </div>
                  <table className="fq-discTable">
                    <thead><tr><th>Field</th><th>Ours</th><th>Theirs</th></tr></thead>
                    <tbody>
                      {detail.discrepancies.map(d => (
                        <tr key={d.field}>
                          <td>{d.label}</td>
                          <td className="fq-mono">{d.ours}</td>
                          <td className="fq-mono fq-theirs">{d.submitted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="fq-discHelp">
                    Nothing is overwritten automatically. Check the car, then correct
                    whichever record is wrong from the Vehicles page.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="fq-noMatch">
              <WarningCircle width={17} height={17} />
              <div>
                No vehicle on file matches this plate, VIN or unit code.
                {!done && ' Tick below to add it as a new vehicle.'}
              </div>
            </div>
          )}
        </section>

        {!done && detail.status !== 'rejected' && (
          <section className="fq-mSection">
            <h3 className="fq-mH3">Book it in</h3>
            <label className="fq-check">
              <input type="checkbox" checked={createVehicle} disabled={!!detail.matched_vehicle}
                onChange={e => setCreateVehicle(e.target.checked)} />
              <span>Add as a new vehicle{detail.matched_vehicle ? ' (already matched)' : ''}</span>
            </label>
            <label className="fq-check">
              <input type="checkbox" checked={updateVehicle}
                onChange={e => setUpdateVehicle(e.target.checked)} />
              <span>Copy any missing VIN, engine number or unit code onto the vehicle</span>
            </label>
            <div className="fq-catRow">
              <label className="fq-label" htmlFor="fq-cat">Service category</label>
              <select id="fq-cat" className="fq-input" value={category} onChange={e => setCategory(e.target.value)}>
                {SERVICE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            {rejecting && (
              <div className="fq-rejectBox">
                <label className="fq-label" htmlFor="fq-note">Why is this being rejected?</label>
                <textarea id="fq-note" className="fq-input" rows={2} value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Duplicate of FI-000012 — same car already booked in." />
                <p className="fq-help">The fleet needs to know what to fix, so a reason is required.</p>
              </div>
            )}
          </section>
        )}
      </div>

      <footer className="fq-mFoot">
        <button className="fq-btn fq-btnGhost" onClick={onClose} disabled={busy}>Close</button>
        {!done && detail.status !== 'rejected' && (
          <>
            {rejecting ? (
              <>
                <button className="fq-btn fq-btnGhost" onClick={() => { setRejecting(false); setNote(''); }} disabled={busy}>
                  Cancel
                </button>
                <button className="fq-btn fq-btnDanger" onClick={() => review('rejected')} disabled={busy || !note.trim()}>
                  <Xmark width={16} height={16} /> Confirm reject
                </button>
              </>
            ) : (
              <>
                <button className="fq-btn fq-btnGhost" onClick={() => setRejecting(true)} disabled={busy}>
                  <Xmark width={16} height={16} /> Reject
                </button>
                <button className="fq-btn" onClick={convert} disabled={busy}>
                  <Check width={16} height={16} /> {busy ? 'Working…' : 'Create job card'}
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
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customer_id: '', label: '', contact_name: '', contact_phone: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/fleet-intake/links');
      if (res.success) setLinks(res.data || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Links are only worth issuing to accounts that send vehicles in bulk,
    // which in practice means the internal fleet and insurance accounts.
    api.get('/customers?customer_class=internal&active_only=1&limit=200')
      .then(r => { if (r.success) setCustomers(r.data || []); })
      .catch(() => {});
  }, []);

  const create = async () => {
    if (!form.customer_id) return onFlash('Choose the fleet account first');
    setCreating(true);
    try {
      const res = await api.post('/fleet-intake/links', form);
      if (res.success) {
        setForm({ customer_id: '', label: '', contact_name: '', contact_phone: '' });
        onFlash('Link created — copy it and send it to the coordinator');
        load();
      } else onFlash(res.message || 'Could not create the link');
    } finally { setCreating(false); }
  };

  const toggle = async (l) => {
    const res = await api.patch(`/fleet-intake/links/${l.id}`, { is_active: !l.is_active });
    if (res.success) { onFlash(res.message); load(); } else onFlash(res.message || 'Could not update');
  };

  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); onFlash('Link copied'); }
    catch { onFlash('Could not copy — select the link and copy it by hand'); }
  };

  return (
    <Shell onClose={onClose} wide>
      <header className="fq-mHead">
        <div>
          <h2 className="fq-mTitle">Coordinator links</h2>
          <p className="fq-mSub">
            One link per fleet account. Anyone holding it can send vehicles in for
            that account without a login — so treat it like a key and disable it
            when someone leaves.
          </p>
        </div>
      </header>

      <div className="fq-mBody">
        <section className="fq-mSection">
          <h3 className="fq-mH3">Issue a new link</h3>
          <div className="fq-linkForm">
            <select className="fq-input" value={form.customer_id}
              onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
              <option value="">Choose the fleet account…</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} — ` : ''}{c.full_name}
                </option>
              ))}
            </select>
            <input className="fq-input" placeholder="Label, e.g. Renjit — Fleet Supervisor"
              value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            <input className="fq-input" placeholder="Contact name"
              value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
            <input className="fq-input" placeholder="Contact phone"
              value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} />
            <button className="fq-btn" onClick={create} disabled={creating}>
              <Plus width={16} height={16} /> {creating ? 'Creating…' : 'Create link'}
            </button>
          </div>
          {customers.length === 0 && (
            <p className="fq-help">
              No internal accounts are classified yet. Set a customer's type to Internal
              on the Customers page and it will appear here.
            </p>
          )}
        </section>

        <section className="fq-mSection">
          <h3 className="fq-mH3">Existing links</h3>
          {loading ? <div className="fq-mLoading">Loading…</div>
            : links.length === 0 ? <p className="fq-help">No links issued yet.</p>
            : (
              <div className="fq-linkList">
                {links.map(l => (
                  <div key={l.id} className={`fq-link${l.is_active ? '' : ' fq-linkOff'}`}>
                    <div className="fq-linkMain">
                      <div className="fq-linkName">
                        {l.label || l.customer_name}
                        {!l.is_active && <span className="fq-chip">Disabled</span>}
                      </div>
                      <div className="fq-linkMeta">
                        {l.customer_code ? `${l.customer_code} · ` : ''}{l.customer_name}
                        {l.submission_count ? ` · ${l.submission_count} sent` : ' · none sent yet'}
                        {l.last_used_at ? ` · last ${ago(l.last_used_at)}` : ''}
                      </div>
                      <code className="fq-linkUrl">{l.url}</code>
                    </div>
                    <div className="fq-linkActions">
                      <button className="fq-btn fq-btnGhost fq-btnSm" onClick={() => copy(l.url)}>
                        <Copy width={14} height={14} /> Copy
                      </button>
                      <button className="fq-btn fq-btnGhost fq-btnSm" onClick={() => toggle(l)}>
                        {l.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </section>
      </div>

      <footer className="fq-mFoot">
        <button className="fq-btn fq-btnGhost" onClick={onClose}>Close</button>
      </footer>
    </Shell>
  );
}

/* ── bits ─────────────────────────────────────────────────────────────── */
function Shell({ children, onClose, wide }) {
  return (
    <div className="fq-overlay" onClick={onClose}>
      <div className={`fq-modal${wide ? ' fq-modalWide' : ''}`} onClick={e => e.stopPropagation()}>
        <button className="fq-close" onClick={onClose} aria-label="Close"><Xmark width={18} height={18} /></button>
        {children}
      </div>
    </div>
  );
}

function Row({ k, v, mono, wide }) {
  if (!v) return null;
  return (
    <div className={`fq-dRow${wide ? ' fq-dRowWide' : ''}`}>
      <dt>{k}</dt>
      <dd className={mono ? 'fq-mono' : ''}>{v}</dd>
    </div>
  );
}

const statusLabel = (s) => ({
  submitted: 'Waiting', accepted: 'Accepted', rejected: 'Rejected', converted: 'Booked in',
}[s] || s);

const matchLabel = (m) => ({
  vin: 'the chassis number', plate: 'the plate number',
  fleet_code: 'their unit code', stored: 'a previous match',
}[m] || m);

function ago(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}
