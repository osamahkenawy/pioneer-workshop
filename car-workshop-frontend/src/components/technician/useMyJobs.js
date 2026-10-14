/**
 * useMyJobs.js — the technician app's data.
 *
 *   useMyJobs()       GET /api/job-cards/mine       my open job cards, today's summary and bookings
 *   useMyJobCard(id)  GET /api/job-cards/mine/:id   one of my job cards, any status, with its time log
 *   useNow()          the browser clock, redrawn every 30 s
 *   useMediaQuery(q)  true while a CSS media query matches
 *
 * One request per screen. It refreshes every 30 s, when the window gets the
 * focus again and after every action (call `refresh()`), and it waits while
 * the tab is hidden. A failed refresh keeps the last data on screen and sets
 * `error`. Timers are worked out from `running_since` and redrawn every 30 s,
 * not every second, to save the phone's battery.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';

const POLL_MS = 30000;

/** GETs `path` now, every 30 s while the page is visible, and on focus; no path, no request. */
function usePolled(path) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(0);        // HTTP status of the last answer
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const mounted = useRef(true);
  const inFlight = useRef(null);

  const refresh = useCallback(() => {
    if (!path) return Promise.resolve(null);
    if (inFlight.current) return inFlight.current;
    const p = (async () => {
      try {
        const res = await api.get(path);
        if (!mounted.current) return null;
        setStatus(res.status || 0);
        if (res.success) {
          setData(res);
          setFetchedAt(Date.now());
          setError('');
        } else {
          setError(res.message || t('technician.load_error', "Couldn't load your jobs. Tap Retry."));
        }
        return res;
      } catch {
        if (mounted.current) setError(t('technician.load_error', "Couldn't load your jobs. Tap Retry."));
        return null;
      } finally {
        inFlight.current = null;
        if (mounted.current) setLoading(false);
      }
    })();
    inFlight.current = p;
    return p;
  }, [path, t]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    refresh();
    let timer = null;
    const schedule = () => {
      clearInterval(timer);
      timer = document.visibilityState === 'hidden' ? null : setInterval(refresh, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
      schedule();
    };
    const onFocus = () => refresh();
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return { data, status, loading, error, fetchedAt, refresh };
}

/**
 * My Jobs. `cards`, `summary` and `bookings` are always arrays/objects, empty
 * until the first answer. `mechanicId` is null when the login is not linked
 * to a technician profile.
 */
export function useMyJobs() {
  const q = usePolled('/job-cards/mine');
  const d = q.data;
  return {
    ...q,
    cards: Array.isArray(d?.jobCards) ? d.jobCards : [],
    summary: d?.summary || null,
    bookings: Array.isArray(d?.bookings_today) ? d.bookings_today : [],
    mechanicId: d ? d.mechanic_id : undefined,
    serverTime: d?.server_time || null,
  };
}

/** One of my job cards. `notMine` is true when the server answers 404. */
export function useMyJobCard(id) {
  const q = usePolled(id ? `/job-cards/mine/${encodeURIComponent(id)}` : null);
  return {
    ...q,
    card: q.data?.jobCard || null,
    runningElsewhere: q.data?.running_elsewhere || null,
    serverTime: q.data?.server_time || null,
    notMine: q.status === 404,
  };
}

/** Date.now(), updated every `everyMs` (30 s) and when the tab comes back. */
export function useNow(everyMs = POLL_MS) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [everyMs]);
  return now;
}

/** True while `query` matches, e.g. useMediaQuery('(max-width: 767px)'). */
export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

export default useMyJobs;
