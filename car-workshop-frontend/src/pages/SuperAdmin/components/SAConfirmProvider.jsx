import { createContext, useContext, useState, useCallback, useRef } from 'react';
import SAConfirmDialog from './SAConfirmDialog';

/**
 * useConfirm — drop-in replacement for window.confirm() that returns a promise.
 *
 * Wrap your app (or sub-tree) in <SAConfirmProvider> then call:
 *   const confirm = useConfirm();
 *   if (await confirm({ title, message, confirmLabel, danger: true })) { ... }
 */
const ConfirmCtx = createContext(null);

export function SAConfirmProvider({ children }) {
  const [state, setState] = useState({ open: false });
  const resolverRef = useRef(null);

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({
        open: true,
        title: opts.title || 'Are you sure?',
        message: opts.message || '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        confirmColor: opts.danger ? 'danger' : (opts.confirmColor || 'primary'),
        loading: false,
      });
    });
  }, []);

  const close = useCallback((result) => {
    setState((s) => ({ ...s, open: false }));
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <SAConfirmDialog
        open={state.open}
        title={state.title}
        message={state.message}
        confirmLabel={state.confirmLabel}
        cancelLabel={state.cancelLabel}
        confirmColor={state.confirmColor}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
        loading={state.loading}
      />
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) {
    // Fallback to native confirm if provider missing — safe default
    return async (opts = {}) => window.confirm(opts.message || opts.title || 'Are you sure?');
  }
  return ctx;
}
