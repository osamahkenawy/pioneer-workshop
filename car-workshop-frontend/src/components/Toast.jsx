/**
 * Toast.jsx — lightweight toast notifications.
 * Usage:  const { toasts, showToast } = useToast();
 *         showToast('Saved', 'success');   // types: success|error|warning|info
 *         <Toast toasts={toasts} />
 */
import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, WarningTriangle, InfoCircle, XmarkCircle } from 'iconoir-react';

let _id = 0;

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const showToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++_id;
    setToasts((prev) => [...prev, { id, message, type }]);
    timers.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      delete timers.current[id];
    }, duration);
    return id;
  }, []);

  return { toasts, showToast };
}

const ICONS = {
  success: CheckCircle,
  error: XmarkCircle,
  warning: WarningTriangle,
  info: InfoCircle,
};
const COLORS = {
  success: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
  error: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  warning: { bg: '#fffbeb', border: '#fde68a', text: '#b45309' },
  info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
};

export default function Toast({ toasts = [] }) {
  if (!toasts.length) return null;
  return createPortal(
    <div style={{
      position: 'fixed', top: 20, insetInlineEnd: 20, zIndex: 99999,
      display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 380,
    }}>
      {toasts.map((t) => {
        const Icon = ICONS[t.type] || InfoCircle;
        const c = COLORS[t.type] || COLORS.info;
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: c.bg, border: `1px solid ${c.border}`, color: c.text,
            borderRadius: 10, padding: '12px 16px', fontSize: 14, fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', animation: 'toast-in 0.25s ease',
          }}>
            <Icon width={18} height={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ lineHeight: 1.45 }}>{t.message}</span>
          </div>
        );
      })}
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }`}</style>
    </div>,
    document.body
  );
}
