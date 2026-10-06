/**
 * TeamLeader — the board a team leader runs their bay from.
 *
 * A job card comes back approved and sits with nobody on it. This is where
 * a technician gets put on it and their window gets booked. Four questions,
 * one screen: who's on my team, what are they on, what's booked, and who is
 * free right now.
 *
 * Layout follows the order of the work, not the order of the data: the
 * queue of unassigned job cards leads, because clearing it is the job.
 * Everything else is what you need to clear it well.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wrench, Car, Clock, User, Group, Plus, Xmark, Check, Search,
  Calendar, WarningTriangle, Timer, NavArrowRight,
} from 'iconoir-react';
import api from '../lib/api';
import './TeamLeader.css';

const SPECIALTY_LABEL = {
  general: 'General', engine: 'Engine', transmission: 'Transmission',
  electrical: 'Electrical', bodywork: 'Bodywork', tires: 'Tyres',
  diagnostics: 'Diagnostics',
};

const STATUS_META = {
  assigned:    { label: 'Assigned',    cls: 'st-assigned' },
  accepted:    { label: 'Accepted',    cls: 'st-accepted' },
  in_progress: { label: 'In progress', cls: 'st-progress' },
  inspection:  { label: 'Inspection',  cls: 'st-inspection' },
  pending:     { label: 'Pending',     cls: 'st-pending' },
  confirmed:   { label: 'Confirmed',   cls: 'st-confirmed' },
  estimate_approved: { label: 'Estimate approved', cls: 'st-approved' },
};

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2)
  .map(w => w[0]).join('').toUpperCase() || '?';

const fmtTime = (v) => {
  if (!v) return null;
  const d = new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const fmtDay = (v) => {
  if (!v) return null;
  const d = new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/** "in 2h 30m" / "4h 15m" — a booked window is easier to judge as a duration. */
const durationOf = (start, end) => {
  if (!start || !end) return null;
  const a = new Date(String(start).replace(' ', 'T'));
  const b = new Date(String(end).replace(' ', 'T'));
  const mins = Math.round((b - a) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
};

/** datetime-local wants 'YYYY-MM-DDTHH:mm'. */
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function TeamLeader() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState(null);
  const [assignFor, setAssignFor] = useState(null);   // job card being assigned
  const [teamPicker, setTeamPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/team-leader/overview');
      if (res.success) { setData(res); setError(''); }
      else setError(res.message || 'Could not load the team board.');
    } catch (e) {
      setError(e?.message || 'Could not load the team board.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = data?.summary;
  const technicians = data?.technicians || [];
  const awaiting = data?.awaiting || [];
  const activeJobs = data?.activeJobs || [];
  const bookings = data?.bookings || [];

  // Bookings read best grouped by technician: a leader scanning the day is
  // asking "what has Rashid got on", not "what happens at 11am".
  const bookingsByTech = useMemo(() => {
    const by = new Map();
    for (const b of bookings) {
      if (!by.has(b.mechanic_id)) by.set(b.mechanic_id, { name: b.mechanic_name, rows: [] });
      by.get(b.mechanic_id).rows.push(b);
    }
    return [...by.values()];
  }, [bookings]);

  if (loading && !data) {
    return <div className="tl-page"><div className="tl-loading">Loading the team board…</div></div>;
  }

  return (
    <div className="tl-page">
      <header className="tl-head">
        <div>
          <h1>Team Board</h1>
          <p>
            {data?.scope?.all_teams
              ? 'Every team in the workshop — narrow to one leader from Mechanics.'
              : 'Your technicians, and the job cards waiting on them.'}
          </p>
        </div>
        <button className="tl-btn-ghost" onClick={() => setTeamPicker(true)}>
          <Group width={16} height={16} /> Manage team
        </button>
      </header>

      {error && <div className="tl-alert tl-alert-err">{error}</div>}
      {banner && (
        <div className={`tl-alert tl-alert-${banner.kind}`} role="status">
          {banner.text}
          <button className="tl-alert-x" onClick={() => setBanner(null)} aria-label="Dismiss"><Xmark width={14} height={14} /></button>
        </div>
      )}

      {/* ── Availability strip ─────────────────────────────────────── */}
      <div className="tl-stats">
        <Stat n={s?.awaiting_assignment ?? 0} label="Waiting for a technician" tone="urgent" icon={WarningTriangle} />
        <Stat n={s?.working ?? 0} label="Working now" tone="busy" icon={Wrench} />
        <Stat n={s?.free ?? 0} label="Free" tone="free" icon={Check} />
        <Stat n={s?.unavailable ?? 0} label="Off / on break" tone="off" icon={Clock} />
        <Stat n={s?.booked_today ?? 0} label="Booked today" tone="plain" icon={Calendar} />
      </div>

      <div className="tl-grid">
        {/* ── The queue ───────────────────────────────────────────── */}
        <section className="tl-card tl-queue">
          <div className="tl-card-head">
            <h2>Waiting for a technician</h2>
            <span className="tl-count">{awaiting.length}</span>
          </div>
          {awaiting.length === 0 ? (
            <p className="tl-empty">Nothing waiting — every approved job card has someone on it.</p>
          ) : (
            <div className="tl-queue-list">
              {awaiting.map(job => (
                <article key={job.id} className="tl-job">
                  <div className="tl-job-main">
                    <div className="tl-job-top">
                      <span className="tl-wo">{job.work_order_number}</span>
                      <StatusPill status={job.status} />
                    </div>
                    <div className="tl-job-vehicle">
                      <Car width={14} height={14} />
                      {job.vehicle_make ? `${job.vehicle_make} ${job.vehicle_model || ''}` : 'No vehicle on file'}
                      {job.plate_number && <span className="tl-plate">{job.plate_number}</span>}
                    </div>
                    <div className="tl-job-meta">
                      {job.customer_name || 'No customer'}
                      {job.service_category && <> · {job.service_category.replace(/_/g, ' ')}</>}
                    </div>
                  </div>
                  <button className="tl-btn-assign" onClick={() => setAssignFor(job)}>
                    Assign <NavArrowRight width={14} height={14} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* ── My technicians ──────────────────────────────────────── */}
        <section className="tl-card">
          <div className="tl-card-head">
            <h2>My technicians</h2>
            <span className="tl-count">{technicians.length}</span>
          </div>
          {technicians.length === 0 ? (
            <p className="tl-empty">
              No technicians on your team yet. Use <b>Manage team</b> to add them.
            </p>
          ) : (
            <div className="tl-tech-list">
              {technicians.slice(0, 40).map(t => {
                const busy = Number(t.live_jobs) > 0;
                return (
                  <div key={t.id} className={`tl-tech ${busy ? 'is-busy' : t.status === 'available' ? 'is-free' : 'is-off'}`}>
                    <span className="tl-avatar">{initials(t.full_name)}</span>
                    <div className="tl-tech-body">
                      <div className="tl-tech-name">{t.full_name}</div>
                      <div className="tl-tech-meta">
                        {SPECIALTY_LABEL[t.specialty] || t.specialty}
                        {t.service_bay_name && <> · {t.service_bay_name}</>}
                      </div>
                    </div>
                    <div className="tl-tech-state">
                      {busy
                        ? <span className="tl-dot-label busy">{t.live_jobs} job{Number(t.live_jobs) > 1 ? 's' : ''}</span>
                        : t.status === 'available'
                          ? <span className="tl-dot-label free">Free</span>
                          : <span className="tl-dot-label off">{t.status.replace('_', ' ')}</span>}
                    </div>
                  </div>
                );
              })}
              {technicians.length > 40 && (
                <p className="tl-empty tl-more">+ {technicians.length - 40} more on the team</p>
              )}
            </div>
          )}
        </section>

        {/* ── Vehicles on the team ────────────────────────────────── */}
        <section className="tl-card tl-span">
          <div className="tl-card-head">
            <h2>Vehicles on my team</h2>
            <span className="tl-count">{activeJobs.length}</span>
          </div>
          {activeJobs.length === 0 ? (
            <p className="tl-empty">No job cards in progress on your team right now.</p>
          ) : (
            <div className="tl-table-scroll">
              <table className="tl-table">
                <thead>
                  <tr>
                    <th>Job card</th><th>Vehicle</th><th>Technician</th>
                    <th>Booked window</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeJobs.map(j => (
                    <tr key={j.id}>
                      <td className="tl-td-wo">{j.work_order_number}</td>
                      <td>
                        {j.vehicle_make ? `${j.vehicle_make} ${j.vehicle_model || ''}` : '—'}
                        {j.plate_number && <span className="tl-plate sm">{j.plate_number}</span>}
                      </td>
                      <td>{j.mechanic_name || '—'}</td>
                      <td className="tl-td-window">
                        {j.scheduled_start_at ? (
                          <>
                            <span>{fmtDay(j.scheduled_start_at)} {fmtTime(j.scheduled_start_at)} → {fmtTime(j.scheduled_end_at)}</span>
                            {durationOf(j.scheduled_start_at, j.scheduled_end_at) && (
                              <span className="tl-dur">{durationOf(j.scheduled_start_at, j.scheduled_end_at)}</span>
                            )}
                          </>
                        ) : <span className="tl-unbooked">Not booked</span>}
                      </td>
                      <td><StatusPill status={j.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Technician times ────────────────────────────────────── */}
        <section className="tl-card tl-span">
          <div className="tl-card-head">
            <h2>Technician times — today</h2>
            <span className="tl-count">{bookings.length}</span>
          </div>
          {bookingsByTech.length === 0 ? (
            <p className="tl-empty">
              Nothing booked for today. A window is set when you assign a job card.
            </p>
          ) : (
            <div className="tl-times">
              {bookingsByTech.map((group, i) => (
                <div key={i} className="tl-time-row">
                  <div className="tl-time-who">
                    <span className="tl-avatar sm">{initials(group.name)}</span>
                    {group.name}
                  </div>
                  <div className="tl-time-slots">
                    {group.rows.map((b, j) => (
                      <div key={j} className="tl-slot">
                        <Timer width={13} height={13} />
                        <b>{fmtTime(b.scheduled_start_at)} – {fmtTime(b.scheduled_end_at)}</b>
                        <span className="tl-slot-wo">{b.work_order_number}</span>
                        {b.plate_number && <span className="tl-plate sm">{b.plate_number}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {assignFor && (
        <AssignModal
          job={assignFor}
          technicians={technicians}
          onClose={() => setAssignFor(null)}
          onDone={(msg, conflict) => {
            setAssignFor(null);
            setBanner({ kind: conflict ? 'warn' : 'ok', text: msg });
            load();
          }}
        />
      )}
      {teamPicker && (
        <TeamModal
          onClose={() => setTeamPicker(false)}
          onDone={(msg) => { setTeamPicker(false); setBanner({ kind: 'ok', text: msg }); load(); }}
        />
      )}
    </div>
  );
}

function Stat({ n, label, tone, icon: Icon }) {
  return (
    <div className={`tl-stat tone-${tone}`}>
      <div className="tl-stat-icon"><Icon width={16} height={16} /></div>
      <div>
        <div className="tl-stat-n">{n}</div>
        <div className="tl-stat-l">{label}</div>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const m = STATUS_META[status] || { label: status, cls: 'st-pending' };
  return <span className={`tl-pill ${m.cls}`}>{m.label}</span>;
}

/* ── Assign a technician + book the window ───────────────────────── */
function AssignModal({ job, technicians, onClose, onDone }) {
  const now = new Date();
  const start = new Date(now.getTime() + 15 * 60000);
  const end = new Date(start.getTime() + 2 * 3600000);

  const [mechanicId, setMechanicId] = useState('');
  const [startAt, setStartAt] = useState(toLocalInput(start));
  const [endAt, setEndAt] = useState(toLocalInput(end));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? technicians.filter(t => (t.full_name || '').toLowerCase().includes(q))
      : technicians;
    // Free technicians first — that is the decision being made here.
    return [...base].sort((a, b) => Number(a.live_jobs) - Number(b.live_jobs));
  }, [technicians, search]);

  async function submit() {
    if (!mechanicId) { setErr('Pick a technician.'); return; }
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) {
      setErr('The end of the window must be after its start.');
      return;
    }
    setSaving(true); setErr('');
    try {
      const res = await api.post('/team-leader/assign', {
        work_order_id: job.id,
        mechanic_id: Number(mechanicId),
        scheduled_start_at: startAt ? startAt.replace('T', ' ') + ':00' : null,
        scheduled_end_at: endAt ? endAt.replace('T', ' ') + ':00' : null,
      });
      if (!res.success) { setErr(res.message || 'Could not assign.'); return; }
      const msg = res.conflict
        ? `${res.message} Heads up — that technician is already booked ${fmtTime(res.conflict.scheduled_start_at)}–${fmtTime(res.conflict.scheduled_end_at)} on ${res.conflict.work_order_number}.`
        : res.message;
      onDone(msg, res.conflict);
    } catch (e) {
      setErr(e?.message || 'Could not assign.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tl-overlay" onClick={onClose}>
      <div className="tl-modal" onClick={e => e.stopPropagation()}>
        <div className="tl-modal-head">
          <div>
            <h3>Assign {job.work_order_number}</h3>
            <p>
              {job.vehicle_make ? `${job.vehicle_make} ${job.vehicle_model || ''}` : 'No vehicle'}
              {job.plate_number ? ` · ${job.plate_number}` : ''}
              {job.customer_name ? ` · ${job.customer_name}` : ''}
            </p>
          </div>
          <button className="tl-x" onClick={onClose} aria-label="Close"><Xmark width={18} height={18} /></button>
        </div>

        <div className="tl-modal-body">
          {err && <div className="tl-alert tl-alert-err">{err}</div>}

          <label className="tl-label" htmlFor="tl-tech-search">Technician</label>
          <div className="tl-search">
            <Search width={15} height={15} />
            <input id="tl-tech-search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search your technicians…" />
          </div>
          <div className="tl-pick-list">
            {list.length === 0 && <p className="tl-empty">No technicians match.</p>}
            {list.slice(0, 50).map(t => {
              const busy = Number(t.live_jobs) > 0;
              return (
                <button key={t.id} type="button"
                  className={`tl-pick ${String(t.id) === String(mechanicId) ? 'is-on' : ''}`}
                  onClick={() => setMechanicId(String(t.id))}>
                  <span className="tl-avatar sm">{initials(t.full_name)}</span>
                  <span className="tl-pick-body">
                    <span className="tl-pick-name">{t.full_name}</span>
                    <span className="tl-pick-meta">{SPECIALTY_LABEL[t.specialty] || t.specialty}</span>
                  </span>
                  <span className={`tl-dot-label ${busy ? 'busy' : t.status === 'available' ? 'free' : 'off'}`}>
                    {busy ? `${t.live_jobs} job${Number(t.live_jobs) > 1 ? 's' : ''}` : t.status === 'available' ? 'Free' : t.status.replace('_', ' ')}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="tl-window">
            <div className="tl-window-head">
              <Calendar width={15} height={15} /> Booked window
            </div>
            <div className="tl-window-grid">
              <div>
                <label className="tl-label" htmlFor="tl-start">Start date &amp; time</label>
                <input id="tl-start" type="datetime-local" value={startAt}
                  onChange={e => setStartAt(e.target.value)} />
              </div>
              <div>
                <label className="tl-label" htmlFor="tl-end">End date &amp; time</label>
                <input id="tl-end" type="datetime-local" value={endAt}
                  onChange={e => setEndAt(e.target.value)} />
              </div>
            </div>
            {durationOf(startAt, endAt) && (
              <p className="tl-window-note">Booked for {durationOf(startAt, endAt)}</p>
            )}
          </div>
        </div>

        <div className="tl-modal-foot">
          <button className="tl-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="tl-btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Assigning…' : 'Assign & book'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Build the team ──────────────────────────────────────────────── */
function TeamModal({ onClose, onDone }) {
  const [pool, setPool] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/team-leader/unassigned-technicians')
      .then(r => { if (r.success) setPool(r.data || []); })
      .catch(() => setErr('Could not load technicians.'))
      .finally(() => setLoading(false));
  }, []);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? pool.filter(t => (t.full_name || '').toLowerCase().includes(q)) : pool;
  }, [pool, search]);

  const toggle = (id) => setPicked(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  async function submit() {
    if (!picked.size) { setErr('Pick at least one technician.'); return; }
    setSaving(true); setErr('');
    try {
      const res = await api.post('/team-leader/team', {
        mechanic_ids: [...picked], action: 'add',
      });
      if (!res.success) { setErr(res.message || 'Could not update the team.'); return; }
      onDone(res.message);
    } catch (e) {
      setErr(e?.message || 'Could not update the team.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tl-overlay" onClick={onClose}>
      <div className="tl-modal" onClick={e => e.stopPropagation()}>
        <div className="tl-modal-head">
          <div>
            <h3>Add technicians to your team</h3>
            <p>Only technicians who aren&apos;t on another team are listed.</p>
          </div>
          <button className="tl-x" onClick={onClose} aria-label="Close"><Xmark width={18} height={18} /></button>
        </div>
        <div className="tl-modal-body">
          {err && <div className="tl-alert tl-alert-err">{err}</div>}
          <div className="tl-search">
            <Search width={15} height={15} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name…" aria-label="Search technicians" />
          </div>
          {loading ? <p className="tl-empty">Loading…</p> : (
            <div className="tl-pick-list tall">
              {list.length === 0 && <p className="tl-empty">Nobody left to add — every technician is already on a team.</p>}
              {list.slice(0, 100).map(t => (
                <button key={t.id} type="button"
                  className={`tl-pick ${picked.has(t.id) ? 'is-on' : ''}`}
                  onClick={() => toggle(t.id)}>
                  <span className="tl-avatar sm">{initials(t.full_name)}</span>
                  <span className="tl-pick-body">
                    <span className="tl-pick-name">{t.full_name}</span>
                    <span className="tl-pick-meta">{SPECIALTY_LABEL[t.specialty] || t.specialty}</span>
                  </span>
                  {picked.has(t.id) && <Check width={16} height={16} className="tl-pick-check" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="tl-modal-foot">
          <button className="tl-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="tl-btn-primary" onClick={submit} disabled={saving || !picked.size}>
            {saving ? 'Adding…' : `Add ${picked.size || ''} to my team`}
          </button>
        </div>
      </div>
    </div>
  );
}
