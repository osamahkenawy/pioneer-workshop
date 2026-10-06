import { createContext, useContext } from 'react';
import { useToast } from '../../components/Toast';

const SAToastContext = createContext(null);

export function SAToastProvider({ children }) {
  const { toasts, showToast } = useToast();
  return (
    <SAToastContext.Provider value={showToast}>
      {children}
      {/* Toast container injected at layout level */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 10000,
          display: 'flex', flexDirection: 'column', gap: 10,
          pointerEvents: 'none',
        }}>
          {toasts.map(t => (
            <div
              key={t.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '13px 18px', borderRadius: 12, fontWeight: 600,
                fontSize: 14, minWidth: 280, maxWidth: 400,
                boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
                background:
                  t.type === 'success' ? '#10b981'
                  : t.type === 'error' ? '#ef4444'
                  : t.type === 'warning' ? '#f59e0b'
                  : '#3b82f6',
                color: '#fff',
                animation: 'toastSlideIn 0.3s ease',
              }}
            >
              {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
              <span>{t.msg}</span>
            </div>
          ))}
          <style>{`
            @keyframes toastSlideIn {
              from { opacity: 0; transform: translateX(40px); }
              to   { opacity: 1; transform: translateX(0);    }
            }
          `}</style>
        </div>
      )}
    </SAToastContext.Provider>
  );
}

export function useSAToast() {
  const ctx = useContext(SAToastContext);
  if (!ctx) throw new Error('useSAToast must be used within SAToastProvider');
  return ctx;
}
