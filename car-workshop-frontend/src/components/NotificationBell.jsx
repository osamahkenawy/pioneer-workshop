import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellNotification, Check, CheckCircle, WarningTriangle,
  Xmark, Package, DeliveryTruck, MapPin, Mail,
  Clock, User, Settings,
} from 'iconoir-react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { getSocket } from '../lib/socketClient';

/* ── helpers ──────────────────────────────────────────────── */
// MySQL DATETIME/TIMESTAMP comes back as 'YYYY-MM-DD HH:MM:SS' with no
// timezone marker. Values are stored in UTC, so we coerce the string to
// a proper UTC ISO before letting JS parse it as local time.
function parseUTC(dateStr) {
  if (!dateStr) return new Date(NaN);
  if (dateStr instanceof Date) return dateStr;
  const s = String(dateStr);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

function timeAgo(dateStr, t, locale) {
  const ms = parseUTC(dateStr).getTime();
  if (Number.isNaN(ms)) return '';
  const diff = Math.max(0, (Date.now() - ms) / 1000);
  if (diff < 60) return t('notifBell.just_now');
  if (diff < 3600) return t('notifBell.minutes_ago', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('notifBell.hours_ago', { count: Math.floor(diff / 3600) });
  if (diff < 604800) return t('notifBell.days_ago', { count: Math.floor(diff / 86400) });
  return parseUTC(dateStr).toLocaleDateString(locale === 'ar' ? 'ar-AE' : 'en-US', { month: 'short', day: 'numeric' });
}

function dateBucket(dateStr, t) {
  const d = parseUTC(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const ts = d.getTime();
  if (ts >= startOfToday) return t('notifBell.today') || 'Today';
  if (ts >= startOfYesterday) return t('notifBell.yesterday') || 'Yesterday';
  if (ts >= startOfToday - 6 * 86400000) return t('notifBell.this_week') || 'This week';
  return t('notifBell.earlier') || 'Earlier';
}

/* ── icon + color config per notification type ────────────── */
const TYPE_CONFIG = {
  info:       { Icon: Bell,            color: '#6366f1', bg: '#eef2ff' },
  success:    { Icon: CheckCircle,     color: '#16a34a', bg: '#ecfdf5' },
  warning:    { Icon: WarningTriangle, color: '#f59e0b', bg: '#fffbeb' },
  error:      { Icon: Xmark,           color: '#dc2626', bg: '#fef2f2' },
  order:      { Icon: Package,         color: '#3b82f6', bg: '#eff6ff' },
  order_update: { Icon: Package,       color: '#f97316', bg: '#fff7ed' },
  mechanic:     { Icon: DeliveryTruck,   color: '#8b5cf6', bg: '#f5f3ff' },
  assignment: { Icon: MapPin,          color: '#0d9488', bg: '#f0fdfa' },
  delivery:   { Icon: Mail,            color: '#3bb4e8', bg: '#fdf2f8' },
};

/* ── icon-name–to-Component fallback map (for backend icon field) */
const ICON_NAME_MAP = {
  clock: Clock, check: CheckCircle, user: User, package: Package,
  truck: DeliveryTruck, delivery: CheckCircle, error: Xmark,
  returned: DeliveryTruck, cancelled: Xmark, assignment: MapPin,
};

function getNotifConfig(n) {
  const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.info;
  if (n.icon && ICON_NAME_MAP[n.icon]) {
    return { ...cfg, Icon: ICON_NAME_MAP[n.icon] };
  }
  return cfg;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const [hasNew, setHasNew] = useState(false);
  const ref = useRef(null);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  /* ── fetch unread count ──────────────────────────────────── */
  const fetchCount = useCallback(async () => {
    try {
      const res = await api.get('/user-notifications/unread-count');
      if (res.success) setUnreadCount(res.count || 0);
    } catch { /* silent */ }
  }, []);

  /* ── fetch notifications list ────────────────────────────── */
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/user-notifications?limit=20');
      if (res.success) setNotifications(res.data || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  /* ── initial load + smart polling fallback ────────── */
  useEffect(() => {
    fetchCount();
    const interval = setInterval(() => {
      const socket = getSocket();
      if (!socket?.connected) fetchCount();
    }, 120000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  /* ── socket.io real-time ─────────────────────────────────── */
  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('crm_user') || '{}');
    if (!user?.id) return;

    const socket = getSocket();
    if (socket.connected) {
      socket.emit('join-user', user.id);
    } else {
      socket.once('connect', () => socket.emit('join-user', user.id));
    }

    const handler = (notification) => {
      setUnreadCount(c => c + 1);
      setNotifications(prev => [notification, ...prev].slice(0, 20));
      setHasNew(true);
      setTimeout(() => setHasNew(false), 1800);
    };
    socket.on('notification:new', handler);
    return () => socket.off('notification:new', handler);
  }, []);

  /* ── click outside to close ──────────────────────────────── */
  useEffect(() => {
    const handler = (e) => {
      if (
        ref.current && !ref.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── close on Escape ─────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /* ── when opened, fetch list ─────────────────────────────── */
  useEffect(() => {
    if (open) fetchList();
  }, [open, fetchList]);

  /* ── mark single as read ─────────────────────────────────── */
  const markRead = async (id) => {
    await api.post(`/user-notifications/${id}/read`);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(c => Math.max(0, c - 1));
  };

  /* ── mark all as read ────────────────────────────────────── */
  const markAllRead = async () => {
    await api.post('/user-notifications/read-all');
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };
  /* ── N10: delete a single notification ────────────── */
  const deleteOne = async (e, n) => {
    e.stopPropagation();
    try {
      await api.delete(`/user-notifications/${n.id}`);
      setNotifications(prev => prev.filter(x => x.id !== n.id));
      if (!n.is_read) setUnreadCount(c => Math.max(0, c - 1));
    } catch { /* silent */ }
  };
  /* ── click notification ──────────────────────────────────── */
  const handleClick = (n) => {
    if (!n.is_read) markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
    else if (n.work_order_id) navigate(`/work-orders?highlight=${n.work_order_id}`);
  };

  /* ── derived: filter + group by date bucket ──────────────── */
  const grouped = useMemo(() => {
    const list = filter === 'unread'
      ? notifications.filter(n => !n.is_read)
      : notifications;
    const buckets = new Map();
    list.forEach(n => {
      const key = dateBucket(n.created_at, t);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(n);
    });
    return Array.from(buckets.entries());
  }, [notifications, filter, t]);

  const filteredCount = filter === 'unread'
    ? notifications.filter(n => !n.is_read).length
    : notifications.length;

  return (
    <div ref={ref} style={{ position: 'relative', zIndex: 1100 }}>
      {/* ── Trigger Button ───────────────────────────────── */}
      <button
        onClick={() => setOpen(!open)}
        title={t('notifBell.title')}
        aria-label={t('notifBell.title')}
        aria-expanded={open}
        style={{
          position: 'relative', width: 42, height: 42, borderRadius: 12,
          border: '1px solid var(--border)',
          background: open ? 'var(--bg-hover)' : 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all .15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        <Bell
          width={20} height={20} strokeWidth={1.8}
          color={unreadCount > 0 ? '#f97316' : 'var(--text-secondary)'}
          style={hasNew ? { animation: 'bellShake .8s ease-in-out' } : undefined}
        />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18,
            borderRadius: 9,
            background: 'linear-gradient(135deg, #f97316, #ea580c)',
            color: '#fff',
            fontSize: '.65rem', fontWeight: 800, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '0 5px',
            border: '2px solid var(--bg-card, #fff)',
            boxShadow: '0 2px 6px rgba(249,115,22,.45)',
            animation: 'bellPulse 2s infinite',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* ── Dropdown (portal → avoids topbar stacking context) ── */}
      {open && createPortal(
        <div ref={dropdownRef} className="notif-bell-dd" style={{
          position: 'fixed', top: 70, [isRTL?'left':'right']: 20,
          width: 420, maxHeight: 'calc(100vh - 100px)',
          background: 'var(--bg-card, #fff)',
          border: '1px solid var(--border)', borderRadius: 18,
          boxShadow: '0 24px 70px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.06)',
          zIndex: 99999,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'bellDropIn .22s cubic-bezier(.21,1.02,.73,1)',
        }}>

          {/* Header */}
          <div style={{
            padding: '14px 18px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'linear-gradient(135deg, rgba(249,115,22,.06), rgba(234,88,12,.02))',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: 'linear-gradient(135deg, #f97316, #ea580c)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(249,115,22,.35)',
                }}>
                  <BellNotification width={16} height={16} color="#fff" />
                </div>
                <div>
                  <div style={{
                    fontWeight: 800, fontSize: '.95rem',
                    color: 'var(--text-primary)', lineHeight: 1.1,
                  }}>
                    {t('notifBell.title')}
                  </div>
                  <div style={{
                    fontSize: '.7rem', color: 'var(--text-muted)',
                    fontWeight: 600, marginTop: 2,
                  }}>
                    {unreadCount > 0
                      ? (t('notifBell.unread_summary', { count: unreadCount }) || `${unreadCount} unread`)
                      : (t('notifBell.all_read') || 'All caught up')}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {unreadCount > 0 && (
                  <button onClick={markAllRead}
                    title={t('notifBell.mark_all_read')}
                    style={{
                      border: 'none', background: 'rgba(249,115,22,.1)',
                      color: '#f97316', fontSize: '.72rem', fontWeight: 700,
                      cursor: 'pointer', padding: '6px 10px', borderRadius: 8,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(249,115,22,.18)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(249,115,22,.1)'}
                  >
                    <Check width={12} height={12} /> {t('notifBell.mark_all_read')}
                  </button>
                )}
                <button
                  onClick={() => { setOpen(false); navigate('/notifications'); }}
                  title={t('notifBell.settings') || 'Settings'}
                  style={{
                    border: 'none', background: 'transparent',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    padding: 6, borderRadius: 8,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background .15s, color .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <Settings width={15} height={15} />
                </button>
              </div>
            </div>

            {/* Filter chips */}
            <div style={{
              display: 'flex', gap: 6, marginTop: 12,
            }}>
              {[
                { key: 'all', label: t('notifBell.filter_all') || 'All', count: notifications.length },
                { key: 'unread', label: t('notifBell.filter_unread') || 'Unread', count: unreadCount },
              ].map(chip => {
                const active = filter === chip.key;
                return (
                  <button
                    key={chip.key}
                    onClick={() => setFilter(chip.key)}
                    style={{
                      cursor: 'pointer',
                      padding: '5px 12px', borderRadius: 99,
                      fontSize: '.72rem', fontWeight: 700,
                      background: active ? 'var(--text-primary, #1c2430)' : 'transparent',
                      color: active ? 'var(--bg-card, #fff)' : 'var(--text-muted)',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      transition: 'all .15s',
                      border: active ? '1px solid transparent' : '1px solid var(--border)',
                    }}
                  >
                    {chip.label}
                    {chip.count > 0 && (
                      <span style={{
                        background: active ? 'rgba(255,255,255,.22)' : 'var(--bg-hover)',
                        padding: '1px 6px', borderRadius: 99,
                        fontSize: '.66rem', fontWeight: 800,
                        minWidth: 16, textAlign: 'center',
                      }}>{chip.count > 99 ? '99+' : chip.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 420, background: 'var(--bg-card, #fff)' }}>
            {loading ? (
              <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-muted)', fontSize: '.85rem' }}>
                <div style={{
                  width: 28, height: 28, border: '3px solid var(--border)',
                  borderTopColor: '#f97316', borderRadius: '50%',
                  animation: 'notifSpin .8s linear infinite',
                  margin: '0 auto 10px',
                }} />
                {t('notifBell.loading')}
              </div>
            ) : filteredCount === 0 ? (
              <div style={{ padding: '50px 30px', textAlign: 'center' }}>
                <div style={{
                  width: 72, height: 72, borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(249,115,22,.1), rgba(234,88,12,.04))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px', color: '#f97316',
                  border: '1px solid rgba(249,115,22,.15)',
                }}>
                  <CheckCircle width={32} height={32} strokeWidth={1.8} />
                </div>
                <div style={{ fontWeight: 700, fontSize: '.92rem', color: 'var(--text-primary)', marginBottom: 4 }}>
                  {filter === 'unread'
                    ? (t('notifBell.no_unread') || 'No unread notifications')
                    : t('notifBell.all_caught_up')}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', lineHeight: 1.45 }}>
                  {filter === 'unread'
                    ? (t('notifBell.no_unread_hint') || "You're all caught up — new alerts will appear here.")
                    : t('notifBell.no_notifications')}
                </div>
              </div>
            ) : (
              grouped.map(([bucket, items]) => (
                <div key={bucket}>
                  <div style={{
                    padding: '10px 18px 6px',
                    fontSize: '.66rem', fontWeight: 800,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '.08em',
                    background: 'var(--bg-card, #fff)',
                    position: 'sticky', top: 0, zIndex: 1,
                    borderBottom: '1px solid var(--border)',
                  }}>{bucket}</div>
                  {items.map(n => {
                    const cfg = getNotifConfig(n);
                    return (
                      <div key={n.id}
                        className="notif-row"
                        onClick={() => handleClick(n)}
                        style={{
                          padding: '13px 18px', cursor: 'pointer',
                          transition: 'background .12s',
                          borderBottom: '1px solid var(--border)',
                          background: n.is_read ? 'transparent' : 'rgba(249,115,22,.04)',
                          [isRTL?'borderRight':'borderLeft']: n.is_read ? '3px solid transparent' : '3px solid #f97316',
                          display: 'flex', gap: 12, alignItems: 'flex-start',
                          position: 'relative',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = n.is_read ? 'var(--bg-hover)' : 'rgba(249,115,22,.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = n.is_read ? 'transparent' : 'rgba(249,115,22,.04)'}
                      >
                        {/* Icon */}
                        <div style={{
                          width: 38, height: 38, borderRadius: 11,
                          background: cfg.bg, color: cfg.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                          boxShadow: `0 2px 8px ${cfg.color}22`,
                        }}>
                          <cfg.Icon width={17} height={17} strokeWidth={2} />
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, gap: 6 }}>
                            <span style={{
                              fontWeight: n.is_read ? 600 : 700, fontSize: '.83rem',
                              color: 'var(--text-primary)', lineHeight: 1.3,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {n.title}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              {!n.is_read && (
                                <span style={{
                                  width: 8, height: 8, borderRadius: '50%', background: '#f97316',
                                  animation: 'bellPulse 2s infinite',
                                  boxShadow: '0 0 0 3px rgba(249,115,22,.18)',
                                }} />
                              )}
                              <button
                                onClick={(e) => deleteOne(e, n)}
                                title={t('common.delete') || 'Dismiss'}
                                aria-label={t('common.delete') || 'Dismiss'}
                                className="notif-row-dismiss"
                                style={{
                                  border: 'none', background: 'transparent', cursor: 'pointer',
                                  padding: 3, borderRadius: 6, color: 'var(--text-muted)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  transition: 'opacity .15s, background .15s, color .15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = '#dc2626'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                              >
                                <Xmark width={13} height={13} />
                              </button>
                            </div>
                          </div>
                          <div style={{
                            fontSize: '.78rem', color: 'var(--text-muted)', lineHeight: 1.45,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                          }}>
                            {n.body}
                          </div>
                          <div style={{
                            fontSize: '.7rem', color: 'var(--text-muted)', marginTop: 6,
                            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                          }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Clock width={11} height={11} />
                              {timeAgo(n.created_at, t, i18n.language)}
                            </span>
                            {n.work_order_number && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                background: 'var(--bg-hover)',
                                padding: '1px 7px', borderRadius: 99,
                                fontWeight: 700, color: 'var(--text-secondary, #4a5568)',
                                fontSize: '.66rem',
                              }}>
                                <Package width={10} height={10} /> #{n.work_order_number}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '11px 18px',
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
            background: 'var(--bg-card, #fff)',
          }}>
            <button onClick={() => { setOpen(false); navigate('/notifications'); }}
              style={{
                border: 'none', background: 'transparent', color: '#f97316',
                fontSize: '.82rem', fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 10px', borderRadius: 8,
                transition: 'background .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(249,115,22,.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {t('notifBell.view_all')}
              <span style={{ fontSize: '.9rem' }}>{isRTL ? '\u2190' : '\u2192'}</span>
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ── Inline keyframes ─────────────────────────────── */}
      <style>{`
        @keyframes bellPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
        @keyframes bellDropIn {
          from { opacity: 0; transform: translateY(-10px) scale(.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes notifSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes bellShake {
          0%, 100% { transform: rotate(0); }
          15% { transform: rotate(-14deg); }
          30% { transform: rotate(12deg); }
          45% { transform: rotate(-8deg); }
          60% { transform: rotate(6deg); }
          75% { transform: rotate(-3deg); }
        }
        .notif-bell-dd .notif-row-dismiss { opacity: 0; }
        .notif-bell-dd .notif-row:hover .notif-row-dismiss { opacity: .7; }
      `}</style>
    </div>
  );
}
