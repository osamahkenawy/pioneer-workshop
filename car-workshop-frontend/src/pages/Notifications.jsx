import { useState, useEffect, useCallback } from 'react';
import {
  BellNotification, Bell, SendDiagonal, Mail, Phone, MessageText,
  Check, CheckCircle, Xmark, WarningTriangle, Calendar, Search,
  SendMail, RefreshDouble, Archive, Package, Clock, Download,
} from 'iconoir-react';
import api from '../lib/api';
import { CardListSkeleton } from '../components/Loader';
import './Notifications.css';
import { useTranslation } from 'react-i18next';
import { downloadCsv, toCsv, csvCell } from '../utils/csv';

/* ── Channel config with icons ────────────────────────────────── */
const CH = {
  sms:      { Icon: Phone,       label: 'notifications.channel_sms',      bg: '#dbeafe', color: '#1d4ed8' },
  email:    { Icon: Mail,        label: 'notifications.channel_email',    bg: '#fce7f3', color: '#be185d' },
  push:     { Icon: Bell,        label: 'notifications.channel_push',     bg: '#f3e8ff', color: '#7c3aed' },
  whatsapp: { Icon: MessageText, label: 'notifications.channel_whatsapp', bg: '#dcfce7', color: '#16a34a' },
};

const SB = {
  sent:      { bg: '#ecfdf5', color: '#16a34a', label: 'notifications.status_sent',      Icon: CheckCircle },
  failed:    { bg: '#fee2e2', color: '#dc2626', label: 'notifications.status_failed',    Icon: Xmark },
  pending:   { bg: '#f1f5f9', color: '#64748b', label: 'notifications.status_pending',   Icon: Clock },
  delivered: { bg: '#dbeafe', color: '#1d4ed8', label: 'notifications.status_delivered', Icon: Check },
  queued:    { bg: '#fef3c7', color: '#92400e', label: 'notifications.status_pending',   Icon: Clock },
  unknown:   { bg: '#f1f5f9', color: '#64748b', label: 'notifications.status_pending',   Icon: WarningTriangle },
};

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  /* ── state ─────────────────────────────────────────────────── */
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [smsLogs, setSmsLogs] = useState([]);
  const [emailLogs, setEmailLogs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [stats, setStats] = useState({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | sent | failed | pending | delivered
  const PER = 25;

  /* modals */
  const [showSend, setShowSend] = useState(false);
  const [showSmsTest, setShowSmsTest] = useState(false);
  const [showEmailTest, setShowEmailTest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  /* forms */
  const [sendForm, setSendForm] = useState({ channels: ['sms'], phone: '', email: '', message: '', subject: '', work_order_id: '', user_id: '' });
  const [smsForm, setSmsForm] = useState({ phone: '', message: '', work_order_id: '' });
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', message: '', work_order_id: '' });

  /* ── fetch all data ────────────────────────────────────────── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    // N5: use allSettled so a single failing endpoint doesn't strand the page
    const results = await Promise.allSettled([
      api.get('/notifications'),
      api.get('/notifications/templates'),
      api.get('/notifications/sms-logs'),
      api.get('/notifications/email-logs'),
      api.get('/notifications/stats'),
    ]);
    const [nRes, tRes, sRes, eRes, stRes] = results.map(r => r.status === 'fulfilled' ? r.value : { success: false });
    if (nRes.success) setNotifications(nRes.data || []);
    if (tRes.success) setTemplates(tRes.data || []);
    if (sRes.success) setSmsLogs(sRes.data || []);
    if (eRes.success) setEmailLogs(eRes.data || []);
    if (stRes.success) setStats(stRes.data || {});
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value && r.value.success === false)).length;
    if (failed === results.length) setError(t('common.failed') || 'Failed to load notifications');
    setLoading(false);
  }, [t]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── handlers ──────────────────────────────────────────────── */
  const handleSend = async (e) => {
    e.preventDefault(); setSaving(true); setError(''); setResult(null);
    const res = await api.post('/notifications/send', sendForm);
    if (res.success) {
      setResult(res);
      setSendForm({ channels: ['sms'], phone: '', email: '', message: '', subject: '', work_order_id: '', user_id: '' });
      fetchAll();
    } else { setError(res.message || t('common.failed')); }
    setSaving(false);
  };
  const handleSmsTest = async (e) => {
    e.preventDefault(); setSaving(true); setResult(null);
    const res = await api.post('/notifications/sms-test', smsForm);
    setResult(res); if (res.success) fetchAll();
    setSaving(false);
  };
  const handleEmailTest = async (e) => {
    e.preventDefault(); setSaving(true); setResult(null);
    const res = await api.post('/notifications/email-test', emailForm);
    setResult(res); if (res.success) fetchAll();
    setSaving(false);
  };

  const toggleChannel = (ch) => {
    setSendForm(f => {
      const arr = f.channels.includes(ch) ? f.channels.filter(c => c !== ch) : [...f.channels, ch];
      return { ...f, channels: arr.length ? arr : ['sms'] };
    });
  };

  /* ── derived data ──────────────────────────────────────────── */
  const rawList = tab === 'sms' ? smsLogs : tab === 'email' ? emailLogs : notifications;
  const searched = search
    ? rawList.filter(n =>
        (n.message || '').toLowerCase().includes(search.toLowerCase()) ||
        (n.recipient_phone || '').includes(search) ||
        (n.recipient_email || '').toLowerCase().includes(search.toLowerCase()) ||
        (n.work_order_number || '').toLowerCase().includes(search.toLowerCase())
      )
    : rawList;
  const filtered = statusFilter === 'all'
    ? searched
    : searched.filter(n => (n.status || 'unknown') === statusFilter);
  const paged = filtered.slice((page - 1) * PER, page * PER);
  const totalPages = Math.ceil(filtered.length / PER);

  /* ── status counts for filter pills ────────────────────────── */
  const statusCounts = searched.reduce((acc, n) => {
    const s = n.status || 'unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  /* ── CSV export of currently-filtered rows ─────────────────── */
  const exportCSV = () => {
    if (!filtered.length) return;
    const headers = ['channel', 'recipient', 'message', 'order', 'status', 'date'];
    // SR-15 — quoted correctly but did not neutralise spreadsheet
    // formulas; csvCell does both.
    const escape = csvCell;
    const rows = filtered.map(n => [
      n.type || tab,
      n.recipient_phone || n.recipient_email || '',
      n.message || '',
      n.work_order_number || '',
      n.status || '',
      n.created_at ? new Date(n.created_at).toISOString() : '',
    ].map(escape).join(','));
    const blob = new Blob([headers.join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notifications-${tab}-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ── stat cards config ─────────────────────────────────────── */
  const statCards = [
    { label: t('notifications.stats.total_sent'),  value: stats.sent || 0,         Icon: SendDiagonal,  variant: 'sent',   sub: t('notifications.stats.of_total', { total: stats.total || 0 }) },
    { label: t('notifications.stats.sms'),          value: stats.sms_count || 0,    Icon: Phone,         variant: 'sms' },
    { label: t('notifications.stats.email'),        value: stats.email_count || 0,  Icon: Mail,          variant: 'email' },
    { label: t('notifications.stats.push'),         value: stats.push_count || 0,   Icon: Bell,          variant: 'push' },
    { label: t('notifications.stats.failed'),       value: stats.failed || 0,       Icon: WarningTriangle, variant: 'failed' },
    { label: t('notifications.stats.today'),        value: stats.today || 0,        Icon: Calendar,      variant: 'today' },
  ];

  const tabs = [
    { key: 'all',       label: t('notifications.tabs.all'),       Icon: BellNotification, count: notifications.length },
    { key: 'sms',       label: t('notifications.tabs.sms'),       Icon: Phone,            count: smsLogs.length },
    { key: 'email',     label: t('notifications.tabs.email'),     Icon: Mail,             count: emailLogs.length },
    { key: 'templates', label: t('notifications.tabs.templates'), Icon: Package,          count: templates.length },
  ];

  /* ── render ────────────────────────────────────────────────── */
  return (
    <div className="page-container notif-page">

      {/* ── Header ────────────────────────────────────────── */}
      <div className="notif-header">
        <div className="notif-header-left">
          <h1>
            <BellNotification width={24} height={24} />
            {t('notifications.title')}
          </h1>
          <p>{t('notifications.header_stats', { total: stats.total || 0, sent: stats.sent || 0, failed: stats.failed || 0 })}</p>
        </div>
        <div className="notif-header-actions">
          <button className="notif-btn outline" onClick={() => { setResult(null); setShowSmsTest(true); }}>
            <Phone width={14} height={14} /> {t('notifications.sms_test')}
          </button>
          <button className="notif-btn outline" onClick={() => { setResult(null); setShowEmailTest(true); }}>
            <Mail width={14} height={14} /> {t('notifications.email_test')}
          </button>
          <button className="notif-btn primary" onClick={() => { setResult(null); setError(''); setShowSend(true); }}>
            <SendDiagonal width={14} height={14} /> {t('notifications.send')}
          </button>
        </div>
      </div>

      {/* ── Stat Cards ────────────────────────────────────── */}
      <div className="notif-stats">
        {statCards.map(c => (
          <div key={c.label} className="notif-stat-card">
            <div className={`notif-stat-icon ${c.variant}`}>
              <c.Icon width={22} height={22} />
            </div>
            <div className="notif-stat-info">
              <h3>{c.value}</h3>
              <p>{c.label}</p>
            </div>
            {c.sub && <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', position: 'absolute', bottom: 8, [isRTL?'left':'right']: 14 }}>{c.sub}</span>}
          </div>
        ))}
      </div>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <div className="notif-tab-bar">
        {tabs.map(tb => (
          <button
            key={tb.key}
            className={`notif-tab ${tab === tb.key ? 'active' : ''}`}
            onClick={() => { setTab(tb.key); setPage(1); setSearch(''); }}
          >
            <tb.Icon width={15} height={15} />
            {tb.label}
            {tb.count > 0 && <span className="notif-tab-badge">{tb.count}</span>}
          </button>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────────── */}
      {loading ? (
        <CardListSkeleton count={6} />
      ) : tab === 'templates' ? (
        /* ── Templates Grid ──────────────────────────────── */
        <div className="notif-template-grid">
          {templates.map(tmpl => (
            <div key={tmpl.template_key || tmpl.id || tmpl.key} className="notif-template-card">
              <div className="notif-template-header">
                <div>
                  <div className="notif-template-title">{tmpl.label}</div>
                  <div className="notif-template-channels">
                    {(tmpl.channels || [tmpl.type]).map(ch => {
                      const c = CH[ch] || CH.sms;
                      return (
                        <span key={ch} className="notif-channel-badge" style={{ background: c.bg, color: c.color }}>
                          <c.Icon width={12} height={12} /> {t(c.label)}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <button
                  className="notif-template-use-btn"
                  onClick={() => { setSendForm(f => ({ ...f, message: tmpl.message, channels: tmpl.channels || ['sms'] })); setShowSend(true); }}
                >
                  {t('notifications.use_template')}
                </button>
              </div>
              <p className="notif-template-body">{tmpl.message}</p>
            </div>
          ))}
        </div>
      ) : (
        /* ── Notification Table ──────────────────────────── */
        <>
          {/* Filter / Search bar */}
          <div className="notif-filters">
            <div className="notif-search">
              <Search width={14} height={14} className="notif-search-icon" />
              <input
                type="text"
                placeholder={t("notifications.search_placeholder")}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            {/* Status filter pills */}
            <div className="notif-status-pills">
              {[
                { key: 'all',       label: t('notifications.filter.all') || 'All', color: '#64748b' },
                { key: 'sent',      label: t('notifications.status_sent') || 'Sent', color: '#16a34a' },
                { key: 'delivered', label: t('notifications.status_delivered') || 'Delivered', color: '#1d4ed8' },
                { key: 'pending',   label: t('notifications.status_pending') || 'Pending', color: '#92400e' },
                { key: 'failed',    label: t('notifications.status_failed') || 'Failed', color: '#dc2626' },
              ].map(p => {
                const count = p.key === 'all' ? searched.length : (statusCounts[p.key] || 0);
                if (p.key !== 'all' && count === 0) return null;
                const active = statusFilter === p.key;
                return (
                  <button key={p.key}
                    onClick={() => { setStatusFilter(p.key); setPage(1); }}
                    className={`notif-status-pill ${active ? 'active' : ''}`}
                    style={active ? { background: p.color, borderColor: p.color, color: '#fff' } : undefined}
                  >
                    <span className="notif-status-pill-dot" style={{ background: p.color }} />
                    {p.label}
                    <span className="notif-status-pill-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="notif-list">
            <div className="notif-list-header">
              <h3>
                {tab === 'sms' ? t('notifications.list.sms_logs') : tab === 'email' ? t('notifications.list.email_logs') : t('notifications.list.all')}
                {search && ` — "${search}"`}
              </h3>
              <div className="notif-list-actions">
                <button className="notif-btn ghost" onClick={exportCSV} disabled={!filtered.length}
                  title={t('notifications.export_csv') || 'Export CSV'}>
                  <Download width={14} height={14} /> {t('notifications.export_csv') || 'Export'}
                </button>
                <button className="notif-btn ghost" onClick={() => fetchAll()}>
                  <RefreshDouble width={14} height={14} /> {t('notifications.refresh')}
                </button>
              </div>
            </div>

            <table className="notif-table">
              <thead>
                <tr>
                  <th>{t("notifications.channel")}</th>
                  <th>{t("notifications.recipient")}</th>
                  <th>{t('notifications.col.message')}</th>
                  <th>{t('notifications.col.order')}</th>
                  <th>{t('notifications.col.status')}</th>
                  <th>{t('notifications.col.date')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="notif-empty">
                        <div className="notif-empty-icon">
                          <Bell width={36} height={36} />
                        </div>
                        <h3>{t("notifications.no_notifications")}</h3>
                        <p>
                          {tab === 'sms' ? t('notifications.no_sms') : tab === 'email' ? t('notifications.no_email') : t('notifications.empty_hint')}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : paged.map(n => {
                  const ch = CH[n.type] || CH.sms;
                  const sb = SB[n.status] || SB.unknown;
                  return (
                    <tr key={n.id}>
                      <td>
                        <span className="notif-channel-badge" style={{ background: ch.bg, color: ch.color }}>
                          <ch.Icon width={12} height={12} /> {t(ch.label)}
                        </span>
                      </td>
                      <td className="notif-recipient-cell">
                        {n.recipient_phone || n.recipient_email || '—'}
                      </td>
                      <td className="notif-msg-cell">{n.message}</td>
                      <td className="notif-order-cell">{n.work_order_number || '—'}</td>
                      <td>
                        <span className="notif-status-badge" style={{ background: sb.bg, color: sb.color }}>
                          <sb.Icon width={11} height={11} /> {t(sb.label)}
                        </span>
                      </td>
                      <td className="notif-date-cell">
                        {(() => {
                          const s = String(n.created_at || '');
                          const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
                          const d = new Date(iso);
                          return (
                            <span title={d.toLocaleString()}>
                              {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                              {d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="notif-pagination">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  {t('notifications.prev')}
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const p = i + 1;
                  return (
                    <button key={p} className={page === p ? 'active' : ''} onClick={() => setPage(p)}>
                      {p}
                    </button>
                  );
                })}
                {totalPages > 7 && <span className="notif-page-info">...</span>}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  {t('notifications.next')}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
            MODALS
         ═══════════════════════════════════════════════════════ */}

      {/* ── Send Notification Modal ─────────────────────────── */}
      {showSend && (
        <div className="notif-overlay" onClick={() => setShowSend(false)}>
          <div className="notif-modal" onClick={e => e.stopPropagation()}>
            <h3 className="notif-modal-title">
              <SendDiagonal width={20} height={20} /> {t('notifications.modal.send_title')}
            </h3>
            <p className="notif-modal-subtitle">{t("notifications.subtitle")}</p>

            {error && (
              <div className="notif-alert error">
                <WarningTriangle width={16} height={16} /> {error}
              </div>
            )}
            {result?.success && (
              <div className="notif-alert success">
                <CheckCircle width={16} height={16} /> {t('notifications.sent_success')}
              </div>
            )}

            <form onSubmit={handleSend}>
              {/* Channels */}
              <div className="notif-form-group">
                <label className="notif-form-label">{t("notifications.channels")}</label>
                <div className="notif-channel-toggles">
                  {Object.entries(CH).map(([key, val]) => (
                    <button key={key} type="button" onClick={() => toggleChannel(key)}
                      className="notif-channel-toggle"
                      style={{
                        border: sendForm.channels.includes(key) ? `2px solid ${val.color}` : '2px solid var(--border, #e9ecef)',
                        background: sendForm.channels.includes(key) ? val.bg : 'transparent',
                        color: sendForm.channels.includes(key) ? val.color : 'var(--text-muted)',
                      }}>
                      <val.Icon width={14} height={14} /> {t(val.label)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="notif-form-grid">
                {sendForm.channels.includes('sms') && (
                  <div>
                    <label className="notif-form-label">{t("notifications.phone_sms")}</label>
                    <input type="tel" placeholder="+971501234567" value={sendForm.phone}
                      onChange={e => setSendForm(f => ({ ...f, phone: e.target.value }))} className="notif-form-input" />
                  </div>
                )}
                {sendForm.channels.includes('email') && (
                  <div>
                    <label className="notif-form-label">{t('notifications.form.email_label')}</label>
                    <input type="email" placeholder="recipient@email.com" value={sendForm.email}
                      onChange={e => setSendForm(f => ({ ...f, email: e.target.value }))} className="notif-form-input" />
                  </div>
                )}
                {sendForm.channels.includes('email') && (
                  <div>
                    <label className="notif-form-label">{t("notifications.subject")}</label>
                    <input value={sendForm.subject} placeholder={t("notifications.subject_placeholder")}
                      onChange={e => setSendForm(f => ({ ...f, subject: e.target.value }))} className="notif-form-input" />
                  </div>
                )}
                <div>
                  <label className="notif-form-label">{t('notifications.form.work_order_id')}</label>
                  <input value={sendForm.work_order_id} placeholder={t('notifications.form.work_order_id_placeholder')}
                    onChange={e => setSendForm(f => ({ ...f, work_order_id: e.target.value }))} className="notif-form-input" />
                </div>
                {sendForm.channels.includes('push') && (
                  <div>
                    <label className="notif-form-label">{t('notifications.form.user_id')}</label>
                    <input value={sendForm.user_id} placeholder={t('notifications.form.user_id_placeholder')}
                      onChange={e => setSendForm(f => ({ ...f, user_id: e.target.value }))} className="notif-form-input" />
                  </div>
                )}
              </div>

              <div className="notif-form-group" style={{ marginTop: 14 }}>
                <label className="notif-form-label">{t('notifications.form.message')}</label>
                <textarea required value={sendForm.message} rows={4} placeholder={t("notifications.message_placeholder")}
                  onChange={e => setSendForm(f => ({ ...f, message: e.target.value }))}
                  className="notif-form-textarea" />
                <div className="notif-char-count">
                    <span>{sendForm.message.length} {t('notifications.form.characters')}</span>
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {t('notifications.form.sending_via')} {sendForm.channels.map(c => { const C = CH[c]; return C ? <C.Icon key={c} width={12} height={12} style={{ color: C.color }} /> : null; })}
                  </span>
                </div>
              </div>

              <div className="notif-form-footer">
                <button type="button" onClick={() => setShowSend(false)} className="notif-btn outline">{t("common.cancel")}</button>
                <button type="submit" disabled={saving} className="notif-btn primary" style={{ opacity: saving ? .6 : 1 }}>
                  {saving ? t('notifications.form.sending') : t('notifications.form.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── SMS Test Modal ──────────────────────────────────── */}
      {showSmsTest && (
        <div className="notif-overlay" onClick={() => { setShowSmsTest(false); setResult(null); }}>
          <div className="notif-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h3 className="notif-modal-title">
              <Phone width={20} height={20} /> {t('notifications.sms_modal.title')}
            </h3>
            <p className="notif-modal-subtitle">{t('notifications.sms_modal.sub')}</p>
            {result && (
              <div className={`notif-alert ${result.success ? 'success' : 'error'}`}>
                {result.success
                  ? <><CheckCircle width={16} height={16} /> {t('notifications.sms_modal.sent')} {result.sid}</>
                  : <><WarningTriangle width={16} height={16} /> {result.message}</>
                }
              </div>
            )}
            <form onSubmit={handleSmsTest}>
              <div className="notif-form-group">
                <label className="notif-form-label">{t('notifications.sms_modal.phone')}</label>
                <input type="tel" required placeholder="+971501234567" value={smsForm.phone}
                  onChange={e => setSmsForm(f => ({ ...f, phone: e.target.value }))} className="notif-form-input" />
              </div>
              <div className="notif-form-group">
                <label className="notif-form-label">{t('notifications.sms_modal.message')}</label>
                <textarea required rows={3} value={smsForm.message}
                  onChange={e => setSmsForm(f => ({ ...f, message: e.target.value }))} className="notif-form-textarea" />
                <div className="notif-char-count">
                  <span>{t('notifications.sms_modal.char_count', { count: smsForm.message.length })}</span>
                </div>
              </div>
              <div className="notif-form-group">
                <label className="notif-form-label">{t('notifications.sms_modal.work_order_id')}</label>
                <input value={smsForm.work_order_id} onChange={e => setSmsForm(f => ({ ...f, work_order_id: e.target.value }))} className="notif-form-input" />
              </div>
              <div className="notif-form-footer">
                <button type="button" onClick={() => { setShowSmsTest(false); setResult(null); }} className="notif-btn outline">{t("common.close")}</button>
                <button type="submit" disabled={saving} className="notif-btn primary" style={{ opacity: saving ? .6 : 1 }}>
                  {saving ? t('notifications.sms_modal.sending') : t('notifications.sms_modal.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Email Test Modal ────────────────────────────────── */}
      {showEmailTest && (
        <div className="notif-overlay" onClick={() => { setShowEmailTest(false); setResult(null); }}>
          <div className="notif-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <h3 className="notif-modal-title">
              <SendMail width={20} height={20} /> {t('notifications.email_modal.title')}
            </h3>
            <p className="notif-modal-subtitle">{t('notifications.email_modal.sub')}</p>
            {result && (
              <div className={`notif-alert ${result.success ? 'success' : 'error'}`}>
                {result.success
                  ? <><CheckCircle width={16} height={16} /> {t('notifications.email_modal.sent')} {result.messageId}</>
                  : <><WarningTriangle width={16} height={16} /> {result.message}</>
                }
              </div>
            )}
            <form onSubmit={handleEmailTest}>
              <div className="notif-form-group">
                <label className="notif-form-label">{t('notifications.email_modal.to')}</label>
                <input type="email" required placeholder="test@example.com" value={emailForm.to}
                  onChange={e => setEmailForm(f => ({ ...f, to: e.target.value }))} className="notif-form-input" />
              </div>
              <div className="notif-form-group">
                <label className="notif-form-label">{t("notifications.subject")}</label>
                <input value={emailForm.subject} placeholder={t('notifications.email_modal.subject_placeholder')}
                  onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))} className="notif-form-input" />
              </div>
              <div className="notif-form-group">
                <label className="notif-form-label">{t('notifications.email_modal.message')}</label>
                <textarea required rows={3} value={emailForm.message}
                  onChange={e => setEmailForm(f => ({ ...f, message: e.target.value }))} className="notif-form-textarea" />
              </div>
              <div className="notif-form-group">
                <label className="notif-form-label">{t('notifications.email_modal.work_order_id')}</label>
                <input value={emailForm.work_order_id} onChange={e => setEmailForm(f => ({ ...f, work_order_id: e.target.value }))} className="notif-form-input" />
              </div>
              <div className="notif-form-footer">
                <button type="button" onClick={() => { setShowEmailTest(false); setResult(null); }} className="notif-btn outline">{t("common.close")}</button>
                <button type="submit" disabled={saving} className="notif-btn primary" style={{ opacity: saving ? .6 : 1 }}>
                  {saving ? t('notifications.email_modal.sending') : t('notifications.email_modal.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
