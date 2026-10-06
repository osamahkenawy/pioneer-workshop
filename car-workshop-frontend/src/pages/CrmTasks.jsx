import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle, Clock, WarningTriangle, Plus, Search, Xmark, Calendar,
  ClipboardCheck, MoreVert, Play, ArrowUp, ArrowDown, ArrowRight, Filter,
  Page, Wallet, Package, Bell, ChatBubble, Phone, Undo,
} from 'iconoir-react';
import api from '../lib/api';
import './CRMPages.css';
import './CrmSurface.css';

/**
 * Tasks & Follow-ups — one list of what staff owe customers.
 *
 * The Enquiries page already tracks follow-ups, but only for enquiries. A
 * promise made on a work order or a complaint was invisible. This covers any
 * record, and reports the enquiry follow-ups alongside so nobody has to
 * remember there are two places a follow-up can hide.
 */

/* Priority drives both the pill and the tint of the task square, so urgency
   reads down the column before any text is parsed. The icon is there so the
   pill is not colour-only. */
const PRIORITY_META = {
  urgent: { label: 'Urgent', color: '#c0392b', bg: '#fdeaea', tint: '#fbe2e2', Icon: WarningTriangle },
  high:   { label: 'High',   color: '#b26a00', bg: '#fdf2e0', tint: '#fcf0d9', Icon: ArrowUp },
  // Stored as `normal`; shown as "Medium" because that is the word the rest of
  // the workshop uses. The create form below says the same thing.
  normal: { label: 'Medium', color: '#2563eb', bg: '#eaf1fe', tint: '#e3ecfd', Icon: ArrowDown },
  low:    { label: 'Low',    color: '#5b6678', bg: '#f1f4f8', tint: '#eef1f6', Icon: ArrowDown },
};

const STATUS_META = {
  open:        { label: 'Open',        color: '#2563eb', bg: '#eaf1fe' },
  in_progress: { label: 'In progress', color: '#b26a00', bg: '#fdf2e0' },
  done:        { label: 'Done',        color: '#17734f', bg: '#e7f3ec' },
  cancelled:   { label: 'Cancelled',   color: '#8b93a3', bg: '#f1f4f8' },
};

const TASK_TYPES = [
  { v: 'follow_up',       label: 'Follow up',      Icon: ChatBubble },
  { v: 'call_back',       label: 'Call back',      Icon: Phone },
  { v: 'quote_chase',     label: 'Chase a quote',  Icon: Page },
  { v: 'collect_payment', label: 'Collect payment', Icon: Wallet },
  { v: 'check_part',      label: 'Check a part',   Icon: Package },
  { v: 'complaint',       label: 'Complaint',      Icon: WarningTriangle },
  { v: 'reminder',        label: 'Reminder',       Icon: Bell },
  { v: 'other',           label: 'Other',          Icon: ClipboardCheck },
];

const VIEWS = [
  { key: 'overdue',    label: 'Overdue' },
  { key: 'today',      label: 'Due today' },
  { key: 'mine',       label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: '',           label: 'All open' },
  { key: 'done',       label: 'Finished' },
];

const fmtDue = v => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(+d)) return null;
  const days = Math.floor((d - new Date()) / 86400000);
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (days < -1) return { date, rel: `${Math.abs(days)} days late`, late: true };
  if (days === -1 || (days === 0 && d < new Date())) return { date, rel: 'Overdue', late: true };
  if (days === 0) return { date, rel: 'Due today', late: false, soon: true };
  if (days === 1) return { date, rel: 'Due in 1 day', late: false, soon: true };
  return { date, rel: `Due in ${days} days`, late: false };
};

export default function CrmTasks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [staff, setStaff] = useState([]);
  const [view, setView] = useState('overdue');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState({ priority: '', task_type: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [banner, setBanner] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const menuRef = useRef(null);
  const filterRef = useRef(null);
  const [form, setForm] = useState({
    title: '', details: '', task_type: 'follow_up', priority: 'normal', due_at: '', assigned_to: '',
  });
  const [formErrors, setFormErrors] = useState([]);

  // The search box used to refetch the list *and* the stats on every
  // keystroke, so typing a customer name fired a request per character.
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
      if (filters.priority) qs.set('priority', filters.priority);
      if (filters.task_type) qs.set('task_type', filters.task_type);
      const [list, s] = await Promise.all([
        api.get(`/crm/tasks?${qs}`),
        api.get('/crm/tasks/stats'),
      ]);
      if (list?.success) setRows(list.data || []);
      if (s?.success) setStats(s.data);
    } catch (e) {
      setBanner({
        kind: 'error',
        text: e?.message ? `Could not load tasks — ${e.message}` : 'Could not load tasks. Try again.',
      });
    } finally {
      setLoading(false);
    }
  }, [view, debounced, filters]);

  useEffect(() => { load(); }, [load]);

  // Staff list for assignment. Optional — the page works unassigned if the
  // users endpoint is not permitted for this role.
  useEffect(() => {
    api.get('/users?limit=100')
      .then(r => { if (r?.success) setStaff(r.data || []); })
      .catch(() => {});
  }, []);

  // Close the row menu and the filter panel on an outside click or Escape, so
  // neither can be left hanging open over the rows beneath.
  useEffect(() => {
    if (menuId === null && !showFilters) return;
    const onDown = e => {
      if (menuId !== null && !menuRef.current?.contains(e.target)) setMenuId(null);
      if (showFilters && !filterRef.current?.contains(e.target)) setShowFilters(false);
    };
    const onKey = e => {
      if (e.key !== 'Escape') return;
      setMenuId(null);
      setShowFilters(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId, showFilters]);

  async function complete(row) {
    setMenuId(null);
    setBusyId(row.id);
    try {
      const res = await api.post(`/crm/tasks/${row.id}/complete`, {});
      setBanner({ kind: res?.success ? 'ok' : 'error', text: res?.message || 'Done.' });
      load();
    } catch (e) {
      setBanner({ kind: 'error', text: e?.message || 'Could not complete that task.' });
    } finally {
      setBusyId(null);
    }
  }

  async function patch(row, body, okText) {
    setMenuId(null);
    setBusyId(row.id);
    try {
      const res = await api.patch(`/crm/tasks/${row.id}`, body);
      if (res?.success) setBanner({ kind: 'ok', text: okText });
      load();
    } catch {
      setBanner({ kind: 'error', text: 'Could not update that task.' });
    } finally {
      setBusyId(null);
    }
  }

  async function create(e) {
    e.preventDefault();
    setFormErrors([]);
    try {
      const res = await api.post('/crm/tasks', {
        ...form,
        assigned_to: form.assigned_to || null,
        due_at: form.due_at || null,
      });
      if (res?.success) {
        setShowNew(false);
        setForm({ title: '', details: '', task_type: 'follow_up', priority: 'normal', due_at: '', assigned_to: '' });
        setBanner({ kind: 'ok', text: 'Task added.' });
        load();
      }
    } catch (err) {
      // The API returns per-field messages written for a person to read.
      setFormErrors(err?.errors || [{ message: err?.message || 'Could not save the task.' }]);
    }
  }

  const T = stats?.totals || {};

  const cards = [
    { key: 'overdue', label: 'Overdue',   value: T.overdue,   Icon: WarningTriangle, tone: 'rose' },
    { key: 'today',   label: 'Due today', value: T.due_today, Icon: Calendar,        tone: 'amber' },
    {
      key: 'open', label: 'Open', value: T.open_count, Icon: ClipboardCheck, tone: 'blue',
      sub: Number(T.unassigned) > 0 ? `${Number(T.unassigned)} unassigned` : null,
    },
    { key: 'done', label: 'Done today', value: T.done_today, Icon: CheckCircle, tone: 'green' },
  ];

  const activeFilters = useMemo(
    () => Object.values(filters).filter(Boolean).length,
    [filters],
  );

  return (
    <div className="page-container cs">
      <header className="cs-head">
        <div>
          <h1 className="cs-title">{t('common.crm_tasks', 'Tasks & Follow-ups')}</h1>
          <p className="cs-sub">Everything staff owe customers, in one list</p>
        </div>
        <button className="cs-generate" onClick={() => setShowNew(true)}>
          <Plus width={17} height={17} /> New task
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
              {c.sub && <p className="cs-kpi-sub" style={{ color: 'var(--cs-blue)' }}>{c.sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {Number(T.enquiry_follow_ups_due) > 0 && (
        <div className="cs-crossref">
          <span className="cs-crossref-icon"><Clock width={18} height={18} /></span>
          <p>
            <strong>{T.enquiry_follow_ups_due}</strong> enquiry follow-up
            {Number(T.enquiry_follow_ups_due) === 1 ? ' is' : 's are'} also due, tracked on the
            Enquiries page rather than here.
          </p>
          <button className="cs-crossref-go" onClick={() => navigate('/enquiries')}>
            Go to Enquiries <ArrowRight width={15} height={15} />
          </button>
        </div>
      )}

      <div className="cs-controls">
        <div className="cs-views" role="tablist" aria-label="Task views">
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
            placeholder="Search task, customer or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search tasks"
          />
        </div>
        <span className="cs-filter-wrap" ref={filterRef}>
          <button
            className={`cs-sort${activeFilters ? ' is-active' : ''}`}
            onClick={() => setShowFilters(v => !v)}
            aria-label="Filter by priority and type"
            aria-expanded={showFilters}
          >
            <Filter width={18} height={18} />
            {activeFilters > 0 && <span className="cs-filter-dot">{activeFilters}</span>}
          </button>
          {showFilters && (
            <div className="cs-filter-panel">
              <label htmlFor="f-priority">Priority</label>
              <select
                id="f-priority"
                value={filters.priority}
                onChange={e => setFilters({ ...filters, priority: e.target.value })}
              >
                <option value="">Any priority</option>
                {Object.entries(PRIORITY_META).map(([v, m]) => (
                  <option key={v} value={v}>{m.label}</option>
                ))}
              </select>
              <label htmlFor="f-type">Type</label>
              <select
                id="f-type"
                value={filters.task_type}
                onChange={e => setFilters({ ...filters, task_type: e.target.value })}
              >
                <option value="">Any type</option>
                {TASK_TYPES.map(x => <option key={x.v} value={x.v}>{x.label}</option>)}
              </select>
              <button
                className="cs-filter-clear"
                onClick={() => setFilters({ priority: '', task_type: '' })}
                disabled={!activeFilters}
              >
                Clear filters
              </button>
            </div>
          )}
        </span>
      </div>

      <div className="cs-tablewrap">
        <table className="cs-table cs-table--tasks">
          <thead>
            <tr>
              <th>Task</th>
              <th>Customer</th>
              <th>Type</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Assigned</th>
              <th>Status</th>
              <th style={{ textAlign: 'end' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="cs-empty">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="cs-empty">
                    <ClipboardCheck width={40} height={40} />
                    {/* Filters are checked first: with one applied, "nothing
                        overdue" would be a lie about the data rather than a
                        statement about what is being shown. */}
                    <p>
                      {activeFilters > 0
                        ? 'No tasks match those filters.'
                        : view === 'overdue'
                          ? 'Nothing overdue — every promise is still inside its due date.'
                          : 'No tasks in this view.'}
                    </p>
                    {activeFilters > 0 && (
                      <button
                        className="cs-empty-cta"
                        onClick={() => setFilters({ priority: '', task_type: '' })}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : rows.map(r => {
              const p = PRIORITY_META[r.priority] || PRIORITY_META.normal;
              const s = STATUS_META[r.status] || STATUS_META.open;
              const type = TASK_TYPES.find(x => x.v === r.task_type) || TASK_TYPES[7];
              const due = fmtDue(r.due_at);
              const busy = busyId === r.id;
              const open = ['open', 'in_progress'].includes(r.status);
              return (
                <tr key={r.id}>
                  <td>
                    <div className="cs-task">
                      <span className="cs-task-icon" style={{ background: p.tint, color: p.color }}>
                        <type.Icon width={18} height={18} />
                      </span>
                      <span className="cs-task-body">
                        <div className="cs-task-title">{r.title}</div>
                        {r.details && <div className="cs-task-note">{r.details}</div>}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="cs-name">{r.customer_name || '—'}</div>
                    {r.customer_phone && <div className="cs-meta">{r.customer_phone}</div>}
                    {(r.make || r.plate_number) && (
                      <div className="cs-meta">
                        {[r.make, r.model].filter(Boolean).join(' ')} {r.plate_number || ''}
                      </div>
                    )}
                  </td>
                  <td className="cs-service">{type.label}</td>
                  <td>
                    <span className="cs-pill" style={{ color: p.color, background: p.bg }}>
                      <span className="cs-pill-icon">
                        <p.Icon width={12} height={12} /> {p.label}
                      </span>
                    </span>
                  </td>
                  <td>
                    {due ? (
                      <>
                        <div className={`cs-due${due.late ? ' is-late' : ''}`}>{due.date}</div>
                        <div
                          className="cs-meta"
                          style={
                            due.late ? { color: 'var(--cs-rose)' }
                              : due.soon ? { color: 'var(--cs-amber)' } : undefined
                          }
                        >
                          {due.rel}
                        </div>
                      </>
                    ) : <span style={{ color: 'var(--cs-ink-faint)' }}>—</span>}
                  </td>
                  <td>
                    {r.assigned_name || <span className="cs-unassigned">Unassigned</span>}
                  </td>
                  <td>
                    <span className="cs-pill" style={{ color: s.color, background: s.bg }}>
                      {s.label}
                    </span>
                  </td>
                  <td>
                    <div className="cs-actions">
                      {/* A finished task has nothing left to do, but a wholly
                          blank cell under an "Action" header reads as a
                          rendering gap rather than as "finished". */}
                      {!open && <span className="cs-done">No action needed</span>}
                      {open && (
                        <>
                          <button className="cs-send" disabled={busy} onClick={() => complete(r)}>
                            <CheckCircle width={15} height={15} />
                            {busy ? '…' : 'Done'}
                          </button>
                          {r.status === 'open' && (
                            <button
                              className="cs-btn-ghost"
                              disabled={busy}
                              onClick={() => patch(r, { status: 'in_progress' }, 'Marked in progress.')}
                            >
                              <Play width={15} height={15} /> Start
                            </button>
                          )}
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
                                {r.status === 'in_progress' && (
                                  <button
                                    role="menuitem"
                                    onClick={() => patch(r, { status: 'open' }, 'Put back to open.')}
                                  >
                                    <Undo width={15} height={15} /> Put back to open
                                  </button>
                                )}
                                <button
                                  role="menuitem"
                                  onClick={() => patch(r, { priority: 'urgent' }, 'Raised to urgent.')}
                                  disabled={r.priority === 'urgent'}
                                >
                                  <WarningTriangle width={15} height={15} /> Raise to urgent
                                </button>
                                <button
                                  role="menuitem"
                                  onClick={() => patch(r, { assigned_to: null }, 'Unassigned.')}
                                  disabled={!r.assigned_to}
                                >
                                  <Xmark width={15} height={15} /> Unassign
                                </button>
                                <div className="cs-menu-rule" />
                                <button
                                  role="menuitem"
                                  className="is-danger"
                                  onClick={() => patch(r, { status: 'cancelled' }, 'Task cancelled.')}
                                >
                                  <Xmark width={15} height={15} /> Cancel task
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

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New task</h2>
              <button className="modal-close" onClick={() => setShowNew(false)} aria-label="Close">
                <Xmark width={18} height={18} />
              </button>
            </div>
            <form onSubmit={create}>
              <div className="modal-body">
                {formErrors.length > 0 && (
                  <div className="alert-error" style={{ marginBottom: 12 }}>
                    {formErrors.map((e, i) => <div key={i}>{e.message}</div>)}
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">What needs doing</label>
                  <input className="form-control" autoFocus value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="Call Mr Haddad about the brake quote" />
                </div>
                <div className="form-group">
                  <label className="form-label">Details</label>
                  <textarea className="form-control" rows={3} value={form.details}
                    onChange={e => setForm({ ...form, details: e.target.value })}
                    placeholder="Anything the person picking this up needs to know" />
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <select className="form-control" value={form.task_type}
                      onChange={e => setForm({ ...form, task_type: e.target.value })}>
                      {TASK_TYPES.map(x => <option key={x.v} value={x.v}>{x.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Priority</label>
                    <select className="form-control" value={form.priority}
                      onChange={e => setForm({ ...form, priority: e.target.value })}>
                      {Object.entries(PRIORITY_META).map(([v, m]) => (
                        <option key={v} value={v}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Due</label>
                    <input type="datetime-local" className="form-control" value={form.due_at}
                      onChange={e => setForm({ ...form, due_at: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Assign to</label>
                    <select className="form-control" value={form.assigned_to}
                      onChange={e => setForm({ ...form, assigned_to: e.target.value })}>
                      <option value="">Nobody yet</option>
                      {staff.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Add task</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
