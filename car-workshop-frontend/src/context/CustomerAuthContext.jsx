/**
 * CustomerAuthContext.jsx — session state for the customer (merchant) portal.
 *
 * Separate from AuthContext (staff) — a customer and a staff member can be
 * logged in in the same browser at once. Token persisted as `crm_token`.
 */
import { createContext, useState, useEffect, useCallback } from 'react';
import customerApi, { setCustomerToken, getCustomerToken } from '../lib/customerApi';

export const CustomerAuthContext = createContext(null);

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
};
const save = (key, val) => {
  try {
    if (val) localStorage.setItem(key, JSON.stringify(val));
    else localStorage.removeItem(key);
  } catch { /* ignore */ }
};

export function CustomerAuthProvider({ children }) {
  const [user, setUserState] = useState(() => load('crm_user'));
  const [workshop, setWorkshopState] = useState(() => load('crm_workshop'));
  const [loading, setLoading] = useState(true);

  const setUser = useCallback((u) => { setUserState(u); save('crm_user', u); }, []);
  const setWorkshop = useCallback((w) => { setWorkshopState(w); save('crm_workshop', w); }, []);

  const login = useCallback(async (email, password) => {
    try {
      const res = await customerApi.post('/customer-auth/login', { email, password });
      if (res?.success && res.data) {
        if (res.data.token) setCustomerToken(res.data.token);
        setUser(res.data);
        setWorkshop(res.data.workshop || null);
        return { success: true, user: res.data };
      }
      return { success: false, message: res?.message, code: res?.code };
    } catch {
      return { success: false, message: 'Network error. Please try again.' };
    }
  }, [setUser, setWorkshop]);

  const logout = useCallback(async () => {
    try { await customerApi.post('/customer-auth/logout'); } catch { /* ignore */ }
    setCustomerToken(null);
    setUser(null);
    setWorkshop(null);
  }, [setUser, setWorkshop]);

  const checkSession = useCallback(async () => {
    if (!getCustomerToken()) { setLoading(false); return null; }
    try {
      const res = await customerApi.get('/customer-auth/session');
      if (res?.success && res.data) {
        setUser({ ...load('crm_user'), ...res.data });
        setWorkshop(res.data.workshop || null);
        setLoading(false);
        return res.data;
      }
      if (res?.status === 401) {
        setCustomerToken(null); setUser(null); setWorkshop(null);
      }
    } catch { /* keep cached session on network error */ }
    setLoading(false);
    return null;
  }, [setUser, setWorkshop]);

  useEffect(() => { checkSession(); }, [checkSession]);

  useEffect(() => {
    const onUnauthorized = () => {
      setCustomerToken(null); setUser(null); setWorkshop(null);
    };
    window.addEventListener('customer-auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('customer-auth:unauthorized', onUnauthorized);
  }, [setUser, setWorkshop]);

  return (
    <CustomerAuthContext.Provider value={{ user, workshop, loading, login, logout, checkSession, setUser, setWorkshop }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export default CustomerAuthProvider;
