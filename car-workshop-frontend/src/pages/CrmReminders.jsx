import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell, Calendar, Send, Clock, CheckCircle, Refresh, Search, Phone, Mail,
  ChatBubble, ChatBubbleSolid, Xmark, Car, MoreVert, SortDown,
} from 'iconoir-react';
import api from '../lib/api';
import './CRMPages.css';
import './CrmSurface.css';

/**
 * Service Reminders — the CRM module with a revenue case rather than a
 * time-saving one: it brings cars back.
 *
 * The engine works out which vehicles are due from the last completed job of
 * each service type. Sending is a deliberate act here rather than automatic —
 * a cron that messages customers unattended is how a workshop texts three
 * hundred people at 3am.
 */

const STATUS_META = {
  scheduled: { label: 'Upcoming',  color: '#4C5C64', bg: '#EDEEEA' },
  due:       { label: 'Due Now',   color: '#c0392b', bg: '#fdeaea' },
  sent:      { label: 'Sent',      color: '#2E5E7E', bg: '#E6EEF4' },
  snoozed:   { label: 'Snoozed',   color: '#6B5B95', bg: '#EFEAF6' },
  booked:    { label: 'Booked',    color: '#1C6B52', bg: '#E7F0EB' },
  converted: { label: 'Converted', color: '#1C6B52', bg: '#E7F0EB' },
  dismissed: { label: 'Dismissed', color: '#8A8A8A', bg: '#F0F0F0' },
  expired:   { label: 'Expired',   color: '#8A8A8A', bg: '#F0F0F0' },
};

const SERVICE_LABELS = {
  oil_change: 'Oil change',
  general_maintenance: 'Periodic maintenance',
  tire_service: 'Tyre check / rotation',
  brake_repair: 'Brake inspection',
  diagnostic: 'Diagnostic check',
  electrical: 'Battery / electrical',
  transmission: 'Transmission service',
};

/**
 * Channel gets its own icon and label casing — "SMS", not "Sms".
 *
 * iconoir carries no brand marks, so WhatsApp is the solid bubble in its own
 * green against the outline bubble used for SMS. That reads as two different
 * channels at a glance without pulling in an icon set for a single glyph.
 */
const CHANNEL_META = {
  whatsapp: { Icon: ChatBubbleSolid, label: 'WhatsApp' },
  sms:      { Icon: ChatBubble,      label: 'SMS' },
  email:    { Icon: Mail,            label: 'Email' },
  call:     { Icon: Phone,           label: 'Call' },
  none:     { Icon: Xmark,           label: 'No channel' },
};

const VIEWS = [
  { key: 'due',      label: 'Due now' },
  { key: 'overdue',  label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'sent',     label: 'Awaiting reply' },
  { key: 'won',      label: 'Booked' },
  { key: '',         label: 'All open' },
];

/* Row avatars are tinted so a long list is scannable by colour as well as by
   name. The tint is derived from the name so it is stable across reloads and
   across views — a customer keeps their colour. */
const AVATAR_TINTS = [
  { bg: '#fbe2e2', fg: '#b5372a' },
  { bg: '#e3ecfd', fg: '#2455c8' },
  { bg: '#ddf0e6', fg: '#166b4a' },
  { bg: '#fcf0d9', fg: '#96651a' },
  { bg: '#ece5fa', fg: '#5b3fa0' },
  { bg: '#dcedf1', fg: '#0d6273' },
];

function avatarTint(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

const initials = name => String(name || '?')
  .trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

export default function CrmReminders() {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [view, setView] = useState('due');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [soonestFirst, setSoonestFirst] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [banner, setBanner] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const menuRef = useRef(null);

  // The search box used to refetch the list *and* the stats on every
  // keystroke, so typing a plate fired seven pairs of requests.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 280);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (view) qs.set('view', view);
      if (debounced) qs.set('search', debounced);
      const [list, s] = await Promise.all([
        api.get(`/crm/reminders?${qs}`),
        api.get('/crm/reminders/stats'),
      ]);
      if (list?.success) setRows(list.data || []);
      if (s?.success) setStats(s.data);
    } catch (e) {
      setBanner({
        kind: 'error',
        text: e?.message
          ? `Could not load reminders — ${e.message}`
          : 'Could not load reminders. Try again.',
      });
    } finally {
      setLoading(false);
    }
  }, [view, debounced]);

  useEffect(() => { load(); }, [load]);

  // Close the row menu on an outside click or Escape, so it cannot be left
  // hanging open over the row beneath it.
  useEffect(() => {
    if (menuId === null) return;
    const onDown = e => { if (!menuRef.current?.contains(e.target)) setMenuId(null); };
    const onKey = e => { if (e.key === 'Escape') setMenuId(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  async function generate() {
    setGenerating(true);
    setBanner(null);
    try {
      // 400 days rather than the default 45: a workshop whose service history
      // is recent has nothing due inside six weeks, and an empty list looks
      // like a broken feature rather than an accurate one.
      const res = await api.post('/crm/reminders/generate', { horizon_days: 400 });
      if (res?.success) {
        const d = res.data || {};
        setBanner({
          kind: d.created ? 'ok' : 'info',
          text: d.created
            ? `${d.created} reminder${d.created === 1 ? '' : 's'} added from ${d.vehicles_considered} vehicles.`
            : `Nothing new — all ${d.vehicles_considered} vehicles already have their reminders.`,
        });
        load();
      }
    } catch (e) {
      setBanner({ kind: 'error', text: 'Could not generate reminders.' });
    } finally {
      setGenerating(false);
    }
  }

  async function send(row) {
    setBusyId(row.id);
    setBanner(null);
    try {
      const res = await api.post(`/crm/reminders/${row.id}/send`);
      setBanner({ kind: res?.success ? 'ok' : 'error', text: res?.message || 'Sent.' });
      load();
    } catch (e) {
      setBanner({ kind: 'error', text: e?.message || 'Could not send that reminder.' });
    } finally {
      setBusyId(null);
    }
  }

  async function patch(row, body, okText) {
    setMenuId(null);
    setBusyId(row.id);
    try {
      const res = await api.patch(`/crm/reminders/${row.id}`, body);
      if (res?.success) setBanner({ kind: 'ok', text: okText });
      load();
    } catch (e) {
      setBanner({ kind: 'error', text: 'Could not update that reminder.' });
    } finally {
      setBusyId(null);
    }
  }

  const T = stats?.totals || {};

  const cards = [
    {
      key: 'due_now', label: 'Due now', value: T.due_now, Icon: Bell, tone: 'rose',
      sub: Number(T.overdue) > 0 ? `${Number(T.overdue)} already overdue` : null,
      subUrgent: true,
    },
    { key: 'upcoming', label: 'Upcoming', value: T.upcoming, Icon: Calendar, tone: 'blue' },
    { key: 'sent', label: 'Awaiting reply', value: T.awaiting_reply, Icon: Send, tone: 'amber' },
    {
      key: 'won', label: 'Booked', value: T.won, Icon: CheckCircle, tone: 'green',
      sub: Number(T.sent_total) > 0 ? `${T.conversion_rate}% of those sent` : null,
    },
  ];

  /* The sort toggle is client-side on purpose: the list is capped at 100 rows,
     so flipping the order does not need a round trip. */
  const ordered = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const x = String(a.due_at || '');
      const y = String(b.due_at || '');
      return soonestFirst ? x.localeCompare(y) : y.localeCompare(x);
    });
    return copy;
  }, [rows, soonestFirst]);

  return (
    <div className="page-container cs">
      <header className="cs-head">
        <div>
          <h1 className="cs-title">{t('common.service_reminders', 'Service Reminders')}</h1>
          <p className="cs-sub">Cars due for service, and whether the reminder brought them back</p>
        </div>
        <button className="cs-generate" onClick={generate} disabled={generating}>
          <Refresh width={17} height={17} />
          {generating ? 'Working…' : 'Find due services'}
        </button>
      </header>

      {banner && <div role="status" className={`cs-banner is-${banner.kind}`}>{banner.text}</div>}

      <div className="cs-kpis">
        {cards.map(c => (
          <div className={`cs-kpi cs-kpi--${c.tone}`} key={c.key}>
            <div className="cs-kpi-icon"><c.Icon width={24} height={24} /></div>
            <div className="cs-kpi-body">
              <p className="cs-kpi-value">{Number(c.value ?? 0)}</p>
              <p className="cs-kpi-label">{c.label}</p>
              {c.sub && <p className={`cs-kpi-sub${c.subUrgent ? ' is-urgent' : ''}`}>{c.sub}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="cs-controls">
        <div className="cs-views" role="tablist" aria-label="Reminder views">
          {VIEWS.map(v => (
            <button
              key={v.key || 'all'}
              role="tab"
              aria-selected={view === v.key}
              className={`cs-view${view === v.key ? ' is-active' : ''}`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="cs-search">
          <Search width={17} height={17} />
          <input
            placeholder="Search name, phone or plate…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search reminders"
          />
        </div>
        <button
          className={`cs-sort${soonestFirst ? '' : ' is-active'}`}
          onClick={() => setSoonestFirst(v => !v)}
          title={soonestFirst ? 'Showing soonest first' : 'Showing latest first'}
          aria-label={soonestFirst ? 'Sort latest first' : 'Sort soonest first'}
        >
          <SortDown width={18} height={18} />
        </button>
      </div>

      <div className="cs-tablewrap">
        <table className="cs-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Vehicle</th>
              <th>Service</th>
              <th>Due</th>
              <th>Channel</th>
              <th>Status</th>
              <th style={{ textAlign: 'end' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="cs-empty">Loading…</td></tr>
            ) : ordered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="cs-empty">
                    <Bell width={40} height={40} />
                    {/* An empty "Due now" tab while dozens sit under Upcoming reads
                        as a broken feature. Say where they are, and offer the jump. */}
                    {view === 'due' && Number(T.upcoming) > 0 ? (
                      <>
                        <p>Nothing due today — and that is the point of getting ahead of it.</p>
                        <p>
                          <strong>{Number(T.upcoming)}</strong> reminder
                          {Number(T.upcoming) === 1 ? '' : 's'} scheduled for later.
                        </p>
                        <button className="cs-empty-cta" onClick={() => setView('upcoming')}>
                          See what is coming
                        </button>
                      </>
                    ) : Number(T.total) === 0 ? (
                      <p>
                        Nothing yet. Press <strong>Find due services</strong> to work out which
                        cars are due, from the last job on each vehicle.
                      </p>
                    ) : (
                      <p>No reminders in this view.</p>
                    )}
                  </div>
                </td>
              </tr>
            ) : ordered.map(r => {
              const meta = STATUS_META[r.status] || STATUS_META.scheduled;
              const ch = CHANNEL_META[r.send_channel] || CHANNEL_META.sms;
              const overdue = Number(r.is_overdue) === 1;
              const busy = busyId === r.id;
              const tint = avatarTint(r.customer_name);
              const open = ['scheduled', 'due', 'snoozed'].includes(r.status);
              const closed = ['dismissed', 'expired', 'converted'].includes(r.status);
              return (
                <tr key={r.id}>
                  <td>
                    <div className="cs-who">
                      <span className="cs-avatar" style={{ background: tint.bg, color: tint.fg }}>
                        {initials(r.customer_name)}
                      </span>
                      <span>
                        <div className="cs-name">{r.customer_name || '—'}</div>
                        <div className="cs-meta">{r.customer_phone || r.customer_email || ''}</div>
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="cs-vehicle">
                      <Car width={17} height={17} />
                      <span>{[r.make, r.model].filter(Boolean).join(' ') || '—'}</span>
                    </div>
                    <div className="cs-meta">
                      {r.plate_number || ''}
                      {r.vehicle_mileage
                        ? `${r.plate_number ? ' • ' : ''}${Number(r.vehicle_mileage).toLocaleString()} km`
                        : ''}
                    </div>
                  </td>
                  <td className="cs-service">
                    {SERVICE_LABELS[r.service_type] || r.service_type?.replace(/_/g, ' ')}
                    {r.due_mileage ? (
                      <div className="cs-meta">or {Number(r.due_mileage).toLocaleString()} km</div>
                    ) : null}
                  </td>
                  <td>
                    <div className={`cs-due${overdue ? ' is-late' : ''}`}>
                      {String(r.due_at || '').slice(0, 10)}
                    </div>
                    {r.days_until_due !== null && r.days_until_due !== undefined && (
                      <div className="cs-meta" style={overdue ? { color: 'var(--cs-rose)' } : undefined}>
                        {Number(r.days_until_due) < 0
                          ? `${Math.abs(r.days_until_due)} days late`
                          : Number(r.days_until_due) === 0 ? 'today' : `in ${r.days_until_due} days`}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`cs-channel${r.send_channel === 'whatsapp' ? ' is-whatsapp' : ''}`}>
                      <ch.Icon width={17} height={17} />
                      {ch.label}
                    </span>
                  </td>
                  <td>
                    <span className="cs-pill" style={{ color: meta.color, background: meta.bg }}>
                      {meta.label}
                    </span>
                  </td>
                  <td>
                    <div className="cs-actions">
                      {/* A closed reminder has nothing left to do, but a wholly
                          blank cell under an "Action" header reads as a
                          rendering gap rather than as "finished". */}
                      {closed && <span className="cs-done">No action needed</span>}
                      {open && (
                        <button className="cs-send" disabled={busy} onClick={() => send(r)}>
                          <Send width={15} height={15} />
                          {busy ? '…' : 'Send'}
                        </button>
                      )}
                      {r.status === 'sent' && (
                        <button
                          className="cs-send"
                          disabled={busy}
                          onClick={() => patch(r, { status: 'booked' }, 'Marked as booked.')}
                        >
                          <CheckCircle width={15} height={15} />
                          Booked
                        </button>
                      )}
                      {!closed && (
                        <>
                          <button
                            className="cs-icon-btn"
                            disabled={busy}
                            onClick={() => patch(r, { snooze_days: 30 }, 'Snoozed for 30 days.')}
                            title="Snooze 30 days"
                            aria-label="Snooze 30 days"
                          >
                            <Clock width={17} height={17} />
                          </button>
                          <span className="cs-menu-wrap" ref={menuId === r.id ? menuRef : undefined}>
                            <button
                              className="cs-icon-btn"
                              disabled={busy}
                              onClick={() => setMenuId(menuId === r.id ? null : r.id)}
                              aria-label="More actions"
                              aria-expanded={menuId === r.id}
                            >
                              <MoreVert width={17} height={17} />
                            </button>
                            {menuId === r.id && (
                              <div className="cs-menu" role="menu">
                                <button
                                  role="menuitem"
                                  onClick={() => patch(r, { snooze_days: 7 }, 'Snoozed for a week.')}
                                >
                                  <Clock width={15} height={15} /> Snooze a week
                                </button>
                                <button
                                  role="menuitem"
                                  onClick={() => patch(r, { snooze_days: 90 }, 'Snoozed for 90 days.')}
                                >
                                  <Clock width={15} height={15} /> Snooze 90 days
                                </button>
                                {r.status !== 'booked' && (
                                  <button
                                    role="menuitem"
                                    onClick={() => patch(r, { status: 'booked' }, 'Marked as booked.')}
                                  >
                                    <CheckCircle width={15} height={15} /> Mark as booked
                                  </button>
                                )}
                                <div className="cs-menu-rule" />
                                <button
                                  role="menuitem"
                                  className="is-danger"
                                  onClick={() => patch(r, { status: 'dismissed' }, 'Dismissed.')}
                                >
                                  <Xmark width={15} height={15} /> Dismiss reminder
                                </button>
                              </div>
                            )}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {stats?.by_type?.length > 0 && (
        <section className="cs-bytype">
          <h2>By service</h2>
          <div className="cs-bytype-list">
            {stats.by_type.map(x => (
              <span key={x.service_type} className="cs-chip">
                {SERVICE_LABELS[x.service_type] || x.service_type}
                {' · '}<strong>{x.total}</strong>
                {Number(x.due_now) > 0 && <em>{x.due_now} due</em>}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
