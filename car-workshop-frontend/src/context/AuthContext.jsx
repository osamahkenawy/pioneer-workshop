/**
 * AuthContext.jsx — session state for the workshop staff app.
 *
 * Exposes: user, workshop, loading, login(), logout(), checkSession(),
 * setUser(), setWorkshop().  Token is persisted in localStorage and sent
 * as a Bearer header by src/lib/api.js.
 */
import { createContext, useState, useEffect, useCallback } from 'react';
import api, { setToken, getToken } from '../lib/api';

export const AuthContext = createContext(null);

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
};
const save = (key, val) => {
  try {
    if (val) localStorage.setItem(key, JSON.stringify(val));
    else localStorage.removeItem(key);
  } catch { /* ignore */ }
};

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => load('auth_user'));
  const [workshop, setWorkshopState] = useState(() => load('auth_workshop'));
  const [loading, setLoading] = useState(true);

  const setUser = useCallback((u) => { setUserState(u); save('auth_user', u); }, []);
  const setWorkshop = useCallback((w) => { setWorkshopState(w); save('auth_workshop', w); }, []);

  const login = useCallback(async (username, password) => {
    try {
      const res = await api.post('/auth/login', { username, password });
      if (res?.success && res.data) {
        if (res.data.token) setToken(res.data.token);
        setUser(res.data);
        setWorkshop(res.data.workshop || null);
        return {
          success: true,
          role: res.data.role,
          user: res.data,
          subscription_warning: res.subscription_warning || null,
        };
      }
      return { success: false, message: res?.message, code: res?.code };
    } catch {
      return { success: false, message: 'Network error. Please try again.' };
    }
  }, [setUser, setWorkshop]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken(null);
    setUser(null);
    setWorkshop(null);
  }, [setUser, setWorkshop]);

  const checkSession = useCallback(async () => {
    if (!getToken()) { setLoading(false); return null; }
    try {
      const res = await api.get('/auth/session');
      if (res?.success && res.data) {
        setUser({ ...load('auth_user'), ...res.data });
        setWorkshop(res.data.workshop || null);
        setLoading(false);
        return res.data;
      }
      if (res?.status === 401) {
        setToken(null); setUser(null); setWorkshop(null);
      }
    } catch { /* keep cached session on network error */ }
    setLoading(false);
    return null;
  }, [setUser, setWorkshop]);

  useEffect(() => { checkSession(); }, [checkSession]);

  // Global 401 handler from the api client
  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null); setUser(null); setWorkshop(null);
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, [setUser, setWorkshop]);

  return (
    <AuthContext.Provider value={{ user, workshop, loading, login, logout, checkSession, setUser, setWorkshop }}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
