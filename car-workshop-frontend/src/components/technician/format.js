/**
 * format.js — times, durations and job card wording for the technician app.
 *
 * The API sends times as the server's local clock ("2026-10-13 09:42:10", no
 * zone). They are shown as written, without a Date round trip, so the time
 * on the phone is the time the server recorded; durations are worked out
 * against the server's own clock (`server_time` in GET /job-cards/mine).
 */

/**
 * Wraps text that must read left to right (times, ranges, numbers) in
 * Unicode isolates, so "08:44–11:59" does not turn into "11:59–08:44" inside
 * an Arabic or Urdu sentence.
 */
export function ltr(text) {
  return text ? `\u2066${text}\u2069` : '';
}

/** "2026-10-13 09:42:10" → "09:42". A value that carries a zone is shown in local time. */
export function clockOf(s) {
  if (!s) return '';
  const str = String(s);
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(str)) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const m = str.match(/[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

/** 'YYYY-MM-DD…' → a local Date at midnight of that day (no timezone shift), or null. */
function dayDate(s) {
  const [y, m, d] = String(s || '').slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

/** 'YYYY-MM-DD…' → "14 Oct". */
export function dayOf(s, lang) {
  const d = dayDate(s);
  return d ? d.toLocaleDateString(lang || undefined, { day: 'numeric', month: 'short' }) : '';
}

/** 'YYYY-MM-DD…' → "Tue 13 Oct". */
export function weekdayOf(s, lang) {
  const d = dayDate(s);
  return d ? d.toLocaleDateString(lang || undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
}

/** Today in the browser as "Tue 13 Oct". */
export function todayLabel(lang) {
  return new Date().toLocaleDateString(lang || undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** 125 → "2h 05m", 35 → "35m". */
export function fmtMinutes(total) {
  const mins = Math.max(0, Math.floor(Number(total) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "09:00–11:30" for a booked window, isolated left to right. */
export function rangeOf(from, to) {
  const a = clockOf(from);
  const b = clockOf(to);
  return ltr(a && b ? `${a}–${b}` : a);
}

/** Server-local "YYYY-MM-DD HH:MM:SS" as minutes on one naive scale (for differences only). */
function naiveMinutes(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 60000;
}

/**
 * Minutes from a server time `since` until now, on the server's clock:
 * `serverTime` was the server's NOW() when the data arrived at `fetchedAt`
 * (browser ms), and `now` is the browser's Date.now().
 */
export function minutesSince(since, serverTime, fetchedAt, now) {
  const a = naiveMinutes(since);
  const b = naiveMinutes(serverTime);
  if (a == null || b == null) return 0;
  return Math.max(0, b - a + (now - fetchedAt) / 60000);
}

/** A card's booked minutes, counting a running clock up to now. */
export function liveMinutes(card, field, fetchedAt, now) {
  const base = Number(card?.[field] || 0);
  return card?.time_state === 'running' ? base + Math.max(0, (now - fetchedAt) / 60000) : base;
}

/** The department's name ("Body & paint"), from the job card workflow's labels. */
export function deptLabel(t, dept) {
  const fallback = { mechanical: 'Mechanical', body_paint: 'Body & paint', electrical: 'Electrical', tyres: 'Tyres', other: 'Other' };
  if (!dept) return '';
  return t(`workflow.dept.${dept}`, fallback[dept] || String(dept).replace(/_/g, ' '));
}

/** "Main job card" or "Sub-job card · Body & paint". */
export function cardKindLabel(t, card) {
  if (card?.is_main ?? !card?.parent_job_card_id) return t('technician.main_card', 'Main job card');
  const dept = deptLabel(t, card?.department);
  return dept
    ? t('technician.sub_card_dept', { dept, defaultValue: 'Sub-job card · {{dept}}' })
    : t('technician.sub_card', 'Sub-job card');
}

/** "Toyota Camry 2021 · White". */
export function vehicleLine(card) {
  const name = [card?.make, card?.model, card?.vehicle_year].filter(Boolean).join(' ');
  return [name, card?.vehicle_colour].filter(Boolean).join(' · ');
}

/** "3 × Brake pads" — quantities without trailing zeros ("1.500" → 1.5). */
export function qty(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? String(Math.round(v * 1000) / 1000) : '1';
}

/** Job card statuses where the technician's part is over (QC passed and later). */
export const PASSED = ['qc_passed', 'ready_for_billing', 'billed'];
