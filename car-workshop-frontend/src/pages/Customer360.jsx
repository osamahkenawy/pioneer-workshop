import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  User, Car, Wallet, Calendar, Megaphone, Package, Page, EmojiSatisfied,
  Bell, Phone, Mail, MapPin, Plus, ArrowLeft, ArrowRight, CheckCircle,
  Clock, ClipboardCheck, Search, Download, Filter, MoreVert, Wrench, Xmark,
  Key, Copy,
} from 'iconoir-react';
import api from '../lib/api';
import { fmtCurrency } from '../utils/currency';
import { downloadCsv } from '../utils/csv';
import './CRMPages.css';
import './Customer360.css';

/**
 * Customer 360 — one screen for everything known about a customer.
 *
 * The history already existed, scattered across enquiries, work orders,
 * invoices, feedback and vehicles. Answering "what is the story with this
 * customer?" meant opening four pages and reading dates. This assembles it.
 *
 * Reached with an :id, or by searching from here when opened without one.
 */

/** How each timeline event is drawn. */
const EVENT_META = {
  enquiry:              { Icon: Megaphone,      tone: 'amber'  },
  work_order:           { Icon: Wrench,         tone: 'blue'   },
  work_order_completed: { Icon: CheckCircle,    tone: 'green'  },
  invoice:              { Icon: Page,           tone: 'violet' },
  feedback:             { Icon: EmojiSatisfied, tone: 'teal'   },
  activity:             { Icon: Phone,          tone: 'blue'   },
  reminder_sent:        { Icon: Bell,           tone: 'amber'  },
  estimate:             { Icon: Page,           tone: 'amber'  },
  booking:              { Icon: Calendar,       tone: 'blue'   },
};

const TONES = {
  blue:   { fg: 'var(--c360-blue)',   bg: 'var(--c360-blue-wash)' },
  green:  { fg: 'var(--c360-green)',  bg: 'var(--c360-green-wash)' },
  amber:  { fg: 'var(--c360-amber)',  bg: 'var(--c360-amber-wash)' },
  violet: { fg: 'var(--c360-violet)', bg: 'var(--c360-violet-wash)' },
  teal:   { fg: 'var(--c360-teal)',   bg: 'var(--c360-teal-wash)' },
};

const EVENT_FILTERS = [
  { v: 'all',       label: 'All events' },
  { v: 'work',      label: 'Jobs only' },
  { v: 'enquiry',   label: 'Enquiries' },
  { v: 'activity',  label: 'Calls & notes' },
  { v: 'money',     label: 'Invoices' },
  { v: 'feedback',  label: 'Feedback' },
];

const ACTIVITY_TYPES = [
  { v: 'call_out',     label: 'Called them' },
  { v: 'call_in',      label: 'They called' },
  { v: 'whatsapp',     label: 'WhatsApp' },
  { v: 'email',        label: 'Email' },
  { v: 'visit',        label: 'Walk-in visit' },
  // Channels a customer used that the system did not capture automatically —
  // logged by hand so the contact still counts on the KPI report (row 9).
  { v: 'social_media', label: 'Social media' },
  { v: 'mobile_app',   label: 'Mobile app (manual log)' },
  { v: 'web_portal',   label: 'Web portal (manual log)' },
  { v: 'complaint',    label: 'Complaint' },
  { v: 'note',         label: 'Note' },
];

const CHANNELS = [
  { v: 'whatsapp', label: 'WhatsApp',   Icon: Phone },
  { v: 'sms',      label: 'SMS',        Icon: Phone },
  { v: 'email',    label: 'Email',      Icon: Mail },
  { v: 'call',     label: 'Phone call', Icon: Phone },
];

const initials = name => String(name || '?')
  .trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

const fmtWhen = v => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(+d)) return String(v).slice(0, 16);
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};
const fmtDay = v => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(+d) ? String(v).slice(0, 10)
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Clipboard, with the textarea fallback for http:// and older browsers.
 *  `text` may be a promise (the link still being made): the write starts
 *  inside the click — Safari and iOS refuse one made after an await. */
async function copyText(text) {
  try {
    if (typeof text === 'string') await navigator.clipboard.writeText(text);
    else await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(v => new Blob([v], { type: 'text/plain' })) })]);
    return true;
  } catch { /* fall back */ }
  let value;
  try { value = typeof text === 'string' ? text : await text; } catch { return false; }
  const ta = document.createElement('textarea');
  ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

const WhatsAppGlyph = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z" />
  </svg>
);

/**
 * Customer portal access — "No portal access" / "Invited <date>" /
 * "Active — last sign-in <date>", and the button that gives access or sends
 * a new link: by WhatsApp (opens the advisor's WhatsApp with the message),
 * e-mail, or a copied link. POST /api/customers/:id/portal-access creates the
 * customer's portal login, marks them verified and issues a link to set
 * their password (7 days). They sign in with their e-mail or mobile number.
 */
function PortalAccessCard({ customerId }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);
  const [link, setLink] = useState('');

  useEffect(() => {
    let alive = true;
    setInfo(null); setFailed(false); setNote(null); setLink('');
    api.get(`/customers/${customerId}/portal-access`)
      .then(r => { if (!alive) return; if (r?.success) setInfo(r.data); else setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [customerId]);

  const send = async (channel) => {
    setBusy(channel); setNote(null);
    // Opened now, while the click still counts as the user's — a window
    // opened after the request would be blocked as a pop-up. The copy too.
    const win = channel === 'whatsapp' ? window.open('', '_blank') : null;
    const sent = api.post(`/customers/${customerId}/portal-access`, { channel });
    const copied = channel === 'link'
      ? copyText(sent.then(r => (r.success ? r.url : Promise.reject(new Error(r.message)))))
      : null;
    try {
      const res = await sent;
      if (!res.success) {
        if (win) win.close();
        setNote({ kind: 'error', text: res.message || t('portal.access.err', 'Could not give portal access.') });
        if (res.url) setLink(res.url);
        return;
      }
      if (res.data) setInfo(res.data);
      setLink(res.url || '');
      if (channel === 'whatsapp') {
        if (win) win.location.href = res.whatsapp_url; else window.open(res.whatsapp_url, '_blank');
        setNote({ kind: 'ok', text: t('portal.access.whatsapp_opened', 'WhatsApp opened with the message — press send there.') });
      } else if (channel === 'email') {
        setNote({ kind: 'ok', text: res.message || t('portal.access.email_sent', 'E-mail sent.') });
      } else {
        setNote({ kind: 'ok', text: await copied
          ? t('portal.access.link_copied', 'Link copied — paste it to the customer.')
          : t('portal.access.copy_manually', 'Copy the link below and send it to the customer.') });
      }
    } catch (e) {
      if (win) win.close();
      setNote({ kind: 'error', text: e.message || t('portal.access.err', 'Could not give portal access.') });
    } finally {
      setBusy('');
    }
  };

  const ids = info ? [info.login_email, info.login_phone].filter(Boolean) : [];
  let state = null;
  if (info) {
    if (info.status === 'active') {
      state = { cls: 'on', text: t('portal.access.active', 'Active — last sign-in {{date}}', { date: fmtWhen(info.last_login_at) }) };
    } else if (info.status === 'invited') {
      state = info.invited_at
        ? { cls: info.invite_expired ? 'warn' : 'wait', text: info.invite_expired
          ? t('portal.access.invited_expired', 'Invited {{date}} — the link has run out', { date: fmtDay(info.invited_at) })
          : t('portal.access.invited', 'Invited {{date}}', { date: fmtDay(info.invited_at) }) }
        : { cls: 'wait', text: t('portal.access.not_signed_in', 'Has a login — not signed in yet') };
    } else {
      state = { cls: 'off', text: t('portal.access.none', 'No portal access') };
    }
  }

  return (
    <div className="c360-card c360-portal">
      <div className="c360-panel-head">
        <h3 className="c360-panel-title"><Key width={14} height={14} /> {t('portal.access.title', 'Customer portal')}</h3>
      </div>
      <div className="c360-portal-body">
        {!info && !failed && <p className="c360-row-meta">{t('portal.loading', 'Loading…')}</p>}
        {failed && <p className="c360-row-meta">{t('portal.access.load_failed', 'Could not load the portal access.')}</p>}
        {info && (
          <>
            <span className={`c360-state ${state.cls}`}>{state.text}</span>
            <p className="c360-row-meta">
              {ids.length
                ? t('portal.access.signs_in_with', 'Signs in with {{ids}}', { ids: ids.join(' / ') })
                : t('portal.access.no_contact', 'Add an e-mail or a mobile number first — the customer signs in with one of them.')}
            </p>
            {!info.is_active ? (
              <p className="c360-row-meta">{t('portal.access.inactive', 'This customer is deactivated.')}</p>
            ) : info.can_send ? (
              <>
                <p className="c360-portal-lead">{info.status === 'none'
                  ? t('portal.access.give_by', 'Give portal access — send the link by:')
                  : t('portal.access.resend_by', 'Send a new link by:')}</p>
                <div className="c360-portal-actions">
                  <button type="button" className="c360-portal-btn wa" disabled={!!busy || !info.can_whatsapp}
                    title={!info.can_whatsapp ? t('portal.access.no_phone', 'No mobile number on file') : undefined}
                    onClick={() => send('whatsapp')}>
                    <WhatsAppGlyph /> {busy === 'whatsapp' ? t('portal.access.sending', 'Sending…') : t('portal.access.whatsapp', 'WhatsApp')}
                  </button>
                  <button type="button" className="c360-portal-btn" disabled={!!busy || !info.can_email}
                    title={!info.can_email ? t('portal.access.no_email', 'No e-mail on file') : undefined}
                    onClick={() => send('email')}>
                    <Mail width={15} height={15} /> {busy === 'email' ? t('portal.access.sending', 'Sending…') : t('portal.access.email', 'E-mail')}
                  </button>
                  <button type="button" className="c360-portal-btn" disabled={!!busy || !ids.length} onClick={() => send('link')}>
                    <Copy width={15} height={15} /> {busy === 'link' ? t('portal.access.sending', 'Sending…') : t('portal.access.copy_link', 'Copy link')}
                  </button>
                </div>
                <p className="c360-consent-note">{t('portal.access.hint', 'The link lets the customer choose a password. It works for 7 days; a new link replaces the old one.')}</p>
              </>
            ) : (
              <p className="c360-row-meta">{t('portal.access.advisor_only', 'A Service Advisor or a manager gives portal access.')}</p>
            )}
            {note && <div className={`c360-banner ${note.kind}`} role="status" style={{ marginBlock: '10px 0' }}>{note.text}</div>}
            {link && (
              <input className="form-control c360-portal-link" readOnly value={link} dir="ltr"
                aria-label={t('portal.access.link_label', 'Set-password link')} onFocus={e => e.target.select()} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Customer360() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [logForm, setLogForm] = useState({ activity_type: 'call_out', subject: '', body: '' });
  const [eventFilter, setEventFilter] = useState('all');

  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/crm/customers/${id}`);
      if (res?.success) setData(res.data);
      else setError(res?.message || 'Could not load that customer.');
    } catch (e) {
      setError(e?.message ? `Could not load that customer — ${e.message}` : 'Could not load that customer.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // With no customer chosen the page used to be a bare search box, which makes
  // the operator type before they can do anything. Show the customers most
  // recently active instead, so the common case — "the person I just spoke to"
  // — is one click away.
  useEffect(() => {
    if (id) return;
    let alive = true;
    setSearching(true);
    api.get('/customers?limit=12&sort=recent')
      .then(r => { if (alive && r?.success) setResults(r.data || []); })
      .catch(() => {})
      .finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; };
  }, [id]);

  async function search(e) {
    e?.preventDefault();
    if (!term.trim()) return;
    setSearched(true);
    setSearching(true);
    try {
      const res = await api.get(`/customers?search=${encodeURIComponent(term.trim())}&limit=20`);
      if (res?.success) setResults(res.data || []);
    } catch { setResults([]); } finally { setSearching(false); }
  }

  async function logActivity(e) {
    e.preventDefault();
    if (!logForm.subject.trim() && !logForm.body.trim()) return;
    try {
      const res = await api.post(`/crm/customers/${id}/activities`, logForm);
      if (res?.success) {
        setShowLog(false);
        setLogForm({ activity_type: 'call_out', subject: '', body: '' });
        setBanner({ kind: 'ok', text: 'Logged. It is on the timeline now.' });
        load();
      }
    } catch (err) {
      setBanner({ kind: 'error', text: err?.message || 'Could not save that.' });
    }
  }

  async function setChannel(channel) {
    try {
      await api.patch(`/crm/customers/${id}/consent`, { preferred_channel: channel });
      setBanner({ kind: 'ok', text: `Reminders will go by ${channel}.` });
      load();
    } catch { setBanner({ kind: 'error', text: 'Could not change the channel.' }); }
  }

  async function toggleConsent(on) {
    try {
      await api.patch(`/crm/customers/${id}/consent`, { marketing_consent: on, source: 'staff' });
      setBanner({ kind: 'ok', text: on ? 'Marketing consent recorded.' : 'Marketing consent withdrawn.' });
      load();
    } catch { setBanner({ kind: 'error', text: 'Could not update consent.' }); }
  }

  /** Which timeline kinds each filter shows. */
  const visibleEvents = useMemo(() => {
    const all = data?.timeline?.events || [];
    if (eventFilter === 'all') return all;
    const groups = {
      work:     ['work_order', 'work_order_completed', 'booking'],
      enquiry:  ['enquiry', 'estimate'],
      activity: ['activity', 'reminder_sent'],
      money:    ['invoice'],
      feedback: ['feedback'],
    };
    const keep = groups[eventFilter] || [];
    return all.filter(e => keep.includes(e.kind));
  }, [data, eventFilter]);

  function exportTimeline() {
    // Reuses utils/csv.js, so the export is escaped and formula-safe like
    // every other export in the app.
    downloadCsv(
      `customer-${id}-history.csv`,
      ['When', 'Type', 'Title', 'Detail', 'Amount', 'Status'],
      visibleEvents.map(e => [
        fmtWhen(e.at), e.kind, e.title, e.detail || '',
        e.meta?.amount ?? '', e.meta?.status ?? '',
      ])
    );
  }

  /* ── Opened without a customer: search ──────────────────── */
  if (!id) {
    return (
      <div className="page-container c360">
        <h1 className="c360-title">{t('common.customer_360', 'Customer 360')}</h1>
        <p style={{ color: 'var(--c360-ink-soft)', margin: '-12px 0 20px' }}>
          Everything you know about one customer, on one screen.
        </p>
        <form onSubmit={search} className="filter-bar" style={{ gap: 8 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <Search width={16} height={16}
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9aa0aa' }} />
            <input className="form-control" style={{ paddingInlineStart: 32 }} autoFocus
              placeholder="Search by name, phone or email…"
              value={term} onChange={e => setTerm(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {results.length > 0 && (
          <>
            <p className="c360-prefs-label" style={{ margin: '18px 0 8px' }}>
              {searched ? `Matches for “${term}”` : 'Recently active customers'}
            </p>
          <div className="table-responsive">
            <table className="contacts-table">
              <thead>
                <tr>
                  <th>Customer</th><th>Phone</th><th>City</th>
                  <th>Jobs</th><th>Lifetime value</th><th>Last visit</th><th />
                </tr>
              </thead>
              <tbody>
                {results.map(c => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.full_name}</strong>
                      {c.company_name ? <div style={{ fontSize: 12, color: '#7d8494' }}>{c.company_name}</div> : null}
                    </td>
                    <td>{c.phone || '—'}</td>
                    <td>{c.city || '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {Number(c.total_work_orders ?? 0)}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {/* A column of "AED 0.00" reads as a broken figure rather
                          than as "no completed job yet", so use the same dash
                          the other columns use for nothing-to-show. */}
                      {Number(c.lifetime_value) > 0
                        ? <bdi>{fmtCurrency(c.lifetime_value)}</bdi>
                        : <span style={{ color: '#9aa1ad' }}>—</span>}
                    </td>
                    <td>{c.last_visit_at ? fmtDay(c.last_visit_at) : 'Never'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-sm-primary" onClick={() => navigate(`/crm/customers/${c.id}`)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        {results.length === 0 && searched && !searching && (
          <div className="empty-state">
            <User className="empty-icon" width={40} height={40} />
            <p>Nobody matched “{term}”.</p>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return <div className="page-container c360"><p style={{ color: 'var(--c360-ink-soft)' }}>Loading…</p></div>;
  }
  if (error) {
    return (
      <div className="page-container c360">
        <button className="c360-back" onClick={() => navigate('/crm/customers')}>
          <ArrowLeft width={15} height={15} /> All customers
        </button>
        <div className="empty-state" style={{ marginTop: 20 }}>
          <User className="empty-icon" width={40} height={40} />
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { customer: c, vehicles, stats, feedback, timeline, tasks, reminders } = data;
  const optedIn = Number(c.marketing_consent) === 1;

  const metrics = [
    {
      key: 'ltv', label: 'Lifetime value', Icon: Wallet, tone: 'blue',
      value: fmtCurrency(stats.lifetime_value),
      sub: Number(stats.avg_job_value) > 0 ? `${fmtCurrency(stats.avg_job_value)} average job` : null,
    },
    {
      key: 'jobs', label: 'Jobs completed', Icon: ClipboardCheck, tone: 'green',
      value: Number(stats.jobs_completed ?? 0),
      sub: `${Number(stats.jobs_total ?? 0)} total jobs`,
    },
    {
      key: 'last', label: 'Last visit', Icon: Calendar, tone: 'amber',
      value: stats.days_since_last_visit === null ? 'Never'
        : stats.days_since_last_visit === 0 ? 'Today' : `${stats.days_since_last_visit}d ago`,
      sub: stats.last_visit_at ? fmtDay(stats.last_visit_at) : null,
    },
    {
      key: 'enq', label: 'Total enquiries', Icon: Megaphone, tone: 'violet',
      value: Number(stats.enquiries_total ?? 0),
      sub: Number(stats.enquiries_converted) > 0
        ? `${Number(stats.enquiries_converted)} converted` : 'All time',
    },
  ];

  return (
    <div className="page-container c360">
      <button className="c360-back" onClick={() => navigate('/crm/customers')}>
        <ArrowLeft width={15} height={15} /> All customers
      </button>
      <h1 className="c360-title">{t('common.customer_360', 'Customer 360')}</h1>

      {banner && <div className={`c360-banner ${banner.kind}`} role="status">{banner.text}</div>}

      {/* ── Identity ─────────────────────────────────────────── */}
      <div className="c360-card c360-identity">
        <div className="c360-avatar" aria-hidden="true">{initials(c.full_name)}</div>
        <div className="c360-identity-main">
          <div className="c360-name-row">
            <h2 className="c360-name">{c.full_name}</h2>
            {stats.is_repeat && <span className="c360-pill">Repeat customer</span>}
            {Number(c.is_active) === 0 && (
              <span className="c360-pill" style={{ background: 'var(--c360-rule-soft)', color: 'var(--c360-ink-faint)' }}>
                Inactive
              </span>
            )}
          </div>
          <div className="c360-contact">
            {c.phone && <span><Phone width={14} height={14} />{c.phone}</span>}
            {c.email && <span><Mail width={14} height={14} />{c.email}</span>}
            {(c.city || c.area) && (
              <span><MapPin width={14} height={14} />{[c.area, c.city].filter(Boolean).join(', ')}</span>
            )}
            {c.company_name && <span><User width={14} height={14} />{c.company_name}</span>}
          </div>
        </div>
        <button className="btn-primary-action" onClick={() => setShowLog(true)}>
          <Plus width={16} height={16} /> Log a call or note
        </button>
      </div>

      {/* ── Metrics ──────────────────────────────────────────── */}
      <div className="c360-metrics">
        {metrics.map(m => {
          const tone = TONES[m.tone];
          return (
            <div className="c360-metric" key={m.key}>
              <div className="c360-metric-icon" style={{ background: tone.bg, color: tone.fg }}>
                <m.Icon width={21} height={21} />
              </div>
              <div className="c360-metric-body">
                <p className="c360-metric-label">{m.label}</p>
                <p className="c360-metric-value"><bdi>{m.value}</bdi></p>
                {m.sub && (
                  <p className="c360-metric-sub" style={{ color: tone.fg }}><bdi>{m.sub}</bdi></p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Preferences ──────────────────────────────────────── */}
      <div className="c360-card c360-prefs">
        <div className="c360-prefs-block">
          <p className="c360-prefs-label">Reminders go by</p>
          <div className="c360-chips">
            {CHANNELS.map(ch => (
              <button key={ch.v}
                className={`c360-chip${c.preferred_channel === ch.v ? ' is-on' : ''}`}
                onClick={() => setChannel(ch.v)}
                aria-pressed={c.preferred_channel === ch.v}>
                <ch.Icon width={14} height={14} /> {ch.label}
              </button>
            ))}
          </div>
        </div>
        <div className="c360-prefs-block">
          <p className="c360-prefs-label">Marketing preference</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className={`c360-state ${optedIn ? 'on' : 'off'}`}>
              {optedIn ? 'Opted in' : 'Not opted in'}
            </span>
            <button className="c360-chip" onClick={() => toggleConsent(!optedIn)}>
              {optedIn ? 'Withdraw' : 'Record consent'}
            </button>
          </div>
          <p className="c360-consent-note">
            Service reminders are sent either way. This covers promotions only.
          </p>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="c360-body">
        <div className="c360-card">
          <div className="c360-panel-head">
            <h3 className="c360-panel-title">
              <Clock width={14} height={14} />
              History · {timeline.total} events
            </h3>
            <div className="c360-panel-tools">
              <select className="c360-select" value={eventFilter}
                onChange={e => setEventFilter(e.target.value)} aria-label="Filter events">
                {EVENT_FILTERS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
              <button className="c360-icon-btn" onClick={exportTimeline}
                title="Download this history as CSV" aria-label="Download history">
                <Download width={15} height={15} />
              </button>
            </div>
          </div>

          {visibleEvents.length === 0 ? (
            <div className="c360-empty">
              {timeline.total === 0
                ? 'Nothing recorded for this customer yet.'
                : 'No events of that kind. Try a different filter.'}
            </div>
          ) : (
            <div className="c360-timeline">
              {visibleEvents.map((e, i) => {
                const m = EVENT_META[e.kind] || { Icon: Clock, tone: 'blue' };
                const tone = TONES[m.tone];
                return (
                  <div className="c360-event" key={`${e.kind}-${e.id}-${i}`}>
                    <div className="c360-event-badge" style={{ background: tone.bg, color: tone.fg }}>
                      <m.Icon width={16} height={16} />
                    </div>
                    <div className="c360-event-when">{fmtWhen(e.at)}</div>
                    <p className="c360-event-title">{e.title}</p>
                    {e.detail && <p className="c360-event-detail">{e.detail}</p>}
                    {e.meta?.by && <p className="c360-event-by">by {e.meta.by}</p>}
                    <div className="c360-event-tags">
                      {e.meta?.status && (
                        <span className="c360-tag">{String(e.meta.status).replace(/_/g, ' ')}</span>
                      )}
                      {Number(e.meta?.amount) > 0 && (
                        <span className="c360-tag money"><bdi>{fmtCurrency(e.meta.amount)}</bdi></span>
                      )}
                      {e.meta?.channel && <span className="c360-tag info">{e.meta.channel}</span>}
                      {e.meta?.nps !== undefined && e.meta?.nps !== null && (
                        <span className="c360-tag score">NPS <bdi>{e.meta.nps}</bdi></span>
                      )}
                      {e.meta?.activity_type && (
                        <span className="c360-tag">{String(e.meta.activity_type).replace(/_/g, ' ')}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Side ───────────────────────────────────────────── */}
        <div className="c360-side">
          <PortalAccessCard customerId={c.id} />

          <div className="c360-card">
            <div className="c360-panel-head">
              <h3 className="c360-panel-title"><Car width={14} height={14} /> Vehicles · {vehicles.length}</h3>
            </div>
            {vehicles.length === 0 ? (
              <div className="c360-empty">No vehicles on file.</div>
            ) : (
              <div className="c360-rows">
                {vehicles.map(v => (
                  <button className="c360-row" key={v.id} onClick={() => navigate('/vehicles')}>
                    {/* A tinted icon rather than a photo: the app holds no vehicle
                        images, and a stock car photo would imply data we do not have. */}
                    <div className="c360-thumb"><Car width={22} height={22} /></div>
                    <div className="c360-row-main">
                      <p className="c360-row-title">{[v.make, v.model, v.year].filter(Boolean).join(' ')}</p>
                      <p className="c360-row-meta">
                        {v.plate_number || '—'}
                        {v.mileage ? ` · ${Number(v.mileage).toLocaleString()} km` : ''}
                      </p>
                      <p className="c360-row-meta">
                        {v.jobs_completed > 0
                          ? `${v.jobs_completed} job${v.jobs_completed === 1 ? '' : 's'} · last ${fmtDay(v.last_service_at)}`
                          : 'Never serviced here'}
                      </p>
                    </div>
                    <ArrowRight className="c360-row-chevron" width={16} height={16} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="c360-card">
            <div className="c360-panel-head">
              <h3 className="c360-panel-title"><ClipboardCheck width={14} height={14} /> Open tasks · {tasks.length}</h3>
            </div>
            {tasks.length === 0 ? (
              <div className="c360-empty">Nothing outstanding.</div>
            ) : (
              <div className="c360-rows">
                {tasks.map(tk => (
                  <div className="c360-row" key={tk.id} style={{ cursor: 'default' }}>
                    <div className="c360-row-main">
                      <p className="c360-row-title" style={{ whiteSpace: 'normal' }}>{tk.title}</p>
                      <p className="c360-row-meta">
                        {tk.due_at ? `due ${fmtDay(tk.due_at)}` : 'no due date'} · {tk.priority}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="c360-panel-foot">
              <Link to="/crm/tasks" className="c360-link">
                View all tasks <ArrowRight width={13} height={13} />
              </Link>
            </div>
          </div>

          <div className="c360-card">
            <div className="c360-panel-head">
              <h3 className="c360-panel-title"><Bell width={14} height={14} /> Reminders · {reminders.length}</h3>
            </div>
            {reminders.length === 0 ? (
              <div className="c360-empty">None scheduled.</div>
            ) : (
              <div className="c360-rows">
                {reminders.map(r => (
                  <div className="c360-row" key={r.id} style={{ cursor: 'default' }}>
                    <div className="c360-row-main">
                      <p className="c360-row-title">{String(r.service_type).replace(/_/g, ' ')}</p>
                      <p className="c360-row-meta">
                        {[r.make, r.model].filter(Boolean).join(' ')} · due {fmtDay(r.due_at)}
                      </p>
                      <p className="c360-row-meta">{r.status} · {r.send_channel}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="c360-panel-foot">
              <Link to="/crm/reminders" className="c360-link">
                All reminders <ArrowRight width={13} height={13} />
              </Link>
            </div>
          </div>

          {feedback && Number(feedback.responses) > 0 && (
            <div className="c360-card">
              <div className="c360-panel-head">
                <h3 className="c360-panel-title"><EmojiSatisfied width={14} height={14} /> Feedback</h3>
              </div>
              <div style={{ padding: '14px 20px' }}>
                <p style={{ margin: 0, fontSize: 14 }}>
                  {feedback.responses} response{Number(feedback.responses) === 1 ? '' : 's'}
                </p>
                <p className="c360-row-meta">
                  {feedback.avg_nps !== null && <>NPS <bdi>{feedback.avg_nps}</bdi></>}
                  {feedback.avg_nps !== null && feedback.avg_csat !== null && ' · '}
                  {feedback.avg_csat !== null && <>CSAT <bdi>{feedback.avg_csat}</bdi></>}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showLog && (
        <div className="modal-overlay" onClick={() => setShowLog(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Log a call or note</h2>
              <button className="modal-close" onClick={() => setShowLog(false)} aria-label="Close">
                <Xmark width={18} height={18} />
              </button>
            </div>
            <form onSubmit={logActivity}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">What happened</label>
                  <select className="form-control" value={logForm.activity_type}
                    onChange={e => setLogForm({ ...logForm, activity_type: e.target.value })}>
                    {ACTIVITY_TYPES.map(a => <option key={a.v} value={a.v}>{a.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Summary</label>
                  <input className="form-control" autoFocus value={logForm.subject}
                    onChange={e => setLogForm({ ...logForm, subject: e.target.value })}
                    placeholder="Called about the AC quote" />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea className="form-control" rows={4} value={logForm.body}
                    onChange={e => setLogForm({ ...logForm, body: e.target.value })}
                    placeholder="What was agreed, and anything to pick up next time" />
                </div>
                <p className="form-hint">Whoever opens this customer next will see it on the timeline.</p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowLog(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
