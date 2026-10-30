/**
 * board.js — words, colours and formatting shared by the Vehicle Status
 * Board's pieces (pages/VehicleStatusBoard.jsx and components/vehicle-board/*).
 *
 * The server (GET /api/vehicle-board, backend lib/job-phase.js) places each
 * car in a phase and sends English text with every badge; the screen shows
 * the translation: vehicleBoard.phase.*, vehicleBoard.badge.*,
 * vehicleBoard.who.*. Change a word in both places.
 */
import i18next from 'i18next';
import { PasteClipboard, Search, ChatBubble, Wrench, ShieldCheck, Car, Check } from 'iconoir-react';
import { TONES, pauseReasonLabel } from '../../lib/statusLabels';

/** Board columns, in process order; 'closed' is "Closed today". */
export const PHASES = ['intake', 'pricing', 'customer', 'work', 'qc', 'ready', 'closed'];
export const OPEN_PHASES = PHASES.slice(0, 6);

export const PHASE_EN = {
  intake: 'Reception',
  pricing: 'Inspection & pricing',
  customer: 'With customer',
  work: 'In work',
  qc: 'Quality check',
  ready: 'Ready for collection',
  closed: 'Closed today',
};

/** The steps each column covers (Steps 1–7). */
export const PHASE_STEPS = {
  intake: [1, 3], pricing: [4, 5], customer: [5, 6], work: [6, 6], qc: [7, 7], ready: [7, 7], closed: [7, 7],
};

/** Column colours follow the work order status tones (lib/statusLabels.js). */
export const PHASE_TONE = {
  intake: 'slate', pricing: 'sky', customer: 'indigo', work: 'cyan', qc: 'purple', ready: 'orange', closed: 'green',
};

export const PHASE_ICON = {
  intake: PasteClipboard, pricing: Search, customer: ChatBubble, work: Wrench, qc: ShieldCheck, ready: Car, closed: Check,
};

/** Accent colour of a phase (the dark text colour of its tone). */
export const phaseColor = phase => TONES[PHASE_TONE[phase]]?.color || TONES.slate.color;
export const phaseBg = phase => TONES[PHASE_TONE[phase]]?.bg || TONES.slate.bg;

export const WHO_EN = {
  service_advisor: 'Service Advisor',
  storekeeper: 'Storekeeper',
  supervisor_wm: 'Supervisor / Workshop Manager',
  customer: 'Customer',
  team_leader: 'Team Leader',
  technician: 'Technician',
  qc: 'Supervisor / Foreman / Team Leader',
  cashier: 'Cashier / Service Advisor',
};

/** English text of every badge (the server sends the same, filled in). */
export const BADGE_EN = {
  call_customer: 'Call customer',
  awaiting_payment: 'Awaiting payment',
  issue_gate_pass: 'Issue gate pass',
  close_job: 'Close job',
  qc_waiting: 'Quality check & test drive',
  rework: 'Rework',
  no_technician: 'Waiting for technician',
  waiting_parts: 'Waiting parts',
  waiting_parts_eta: 'Waiting parts · ETA {{date}}',
  clock_running: 'Clock running',
  paused: 'Paused',
  paused_reason: 'Paused · {{reason}}',
  not_started: 'Not started',
  declined: 'Declined — return vehicle',
  sent: 'Sent {{ago}} ago',
  awaiting_approval: 'Awaiting customer approval',
  store_pricing: 'Parts to price: {{n}}',
  labour_not_priced: 'Labour not priced',
  needs_approval: 'Needs Supervisor/WM approval',
  ready_to_send: 'Ready to send',
  estimate_not_raised: 'Raise the estimate',
  estimate_expired: 'Estimate expired',
  not_classified: 'Customer not classified',
  vehicle_missing: 'Vehicle / issue missing',
  physical_not_started: 'Physical inspection not started',
  physical_in_progress: 'Physical inspection in progress',
  awaiting_acknowledgement: 'Waiting for the customer\'s signature',
  open_job_card: 'Open the job card',
  no_job_card: 'No job card',
};

export const DEPARTMENTS = ['mechanical', 'body_paint', 'electrical', 'tyres', 'other'];
export const DEPT_EN = { mechanical: 'Mechanical', body_paint: 'Body & paint', electrical: 'Electrical', tyres: 'Tyres', other: 'Other' };
export const CLASS_EN = { internal: 'Internal', external: 'External' };
export const SUBCATEGORIES = ['fleet', 'insurance', 'asset', 'walkin'];
export const SUB_EN = { fleet: 'Fleet', insurance: 'Insurance', asset: 'Asset', walkin: 'Walk-in' };

// ─── Labels ────────────────────────────────────────────────────

export const phaseLabel = (t, phase) => t(`vehicleBoard.phase.${phase}`, PHASE_EN[phase] || phase);

/** "Steps 1–3" / "Step 6". */
export function stepsLabel(t, phase) {
  const [from, to] = PHASE_STEPS[phase] || [];
  if (from == null) return '';
  return from === to
    ? t('vehicleBoard.step_n', 'Step {{n}}', { n: from })
    : t('vehicleBoard.steps_range', 'Steps {{from}}–{{to}}', { from, to });
}

export const whoLabel = (t, key) => (key ? t(`vehicleBoard.who.${key}`, WHO_EN[key] || key) : '');
export const deptLabel = (t, key) => (key ? t(`vehicleBoard.dept.${key}`, DEPT_EN[key] || key) : '');
export const classLabel = (t, key) => (key ? t(`vehicleBoard.filter.${key}`, CLASS_EN[key] || key) : '');
export const subLabel = (t, key) => (key ? t(`vehicleBoard.filter.${key}`, SUB_EN[key] || key) : '');

/** "External · Walk-in", or null when the job is not classified. */
export function classChip(t, item) {
  const parts = [classLabel(t, item.customer_class), subLabel(t, item.customer_subcategory)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** A badge's text in the screen's language, its params formatted here. */
export function badgeText(t, b) {
  if (!b) return '';
  const p = b.params || {};
  const vars = {
    n: p.n,
    date: p.date ? fmtDay(p.date) : '',
    ago: p.minutes != null ? fmtAge(p.minutes) : p.ago || '',
    reason: p.reason_key ? (pauseReasonLabel(t, p.reason_key) || p.reason) : p.reason || '',
  };
  return t(`vehicleBoard.badge.${b.key}`, BADGE_EN[b.key] || b.text || b.key, vars);
}

/** { bg, color } of a badge or status tone name. */
export const toneOf = name => TONES[name] || TONES.slate;

// ─── Dates, times, money ───────────────────────────────────────

const formatters = new Map();
function dtf(opts) {
  const lang = i18next.language || 'en';
  const key = `${lang}|${JSON.stringify(opts)}`;
  if (!formatters.has(key)) {
    let f;
    // Latin digits, next to the Latin WO numbers and plates.
    try { f = new Intl.DateTimeFormat(`${lang}-u-nu-latn`, opts); } catch { f = new Intl.DateTimeFormat('en', opts); }
    formatters.set(key, f);
  }
  return formatters.get(key);
}
const HM = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** An ISO instant (the board sends instants) or a naive 'YYYY-MM-DD HH:MM:SS' (other endpoints). */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "10:42". */
export const fmtTime = v => { const d = toDate(v); return d ? dtf(HM).format(d) : ''; };
/** "15 Oct". */
export const fmtDay = v => { const d = toDate(v); return d ? dtf({ day: 'numeric', month: 'short' }).format(d) : ''; };
/** "10:42" today, otherwise "15 Oct, 10:42". */
export function fmtWhen(v) {
  const d = toDate(v);
  if (!d) return '';
  return sameDay(d, new Date()) ? dtf(HM).format(d) : dtf({ day: 'numeric', month: 'short', ...HM }).format(d);
}

/** "45m", "3h 20m", "2d 4h". */
export function fmtAge(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m >= 1440) return i18next.t('vehicleBoard.age_dh', '{{d}}d {{h}}h', { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60) });
  if (m >= 60) return i18next.t('vehicleBoard.age_hm', '{{h}}h {{m}}m', { h: Math.floor(m / 60), m: m % 60 });
  return i18next.t('vehicleBoard.age_m', '{{m}}m', { m });
}

/** "AED 1,250.00". */
export function money(amount, currency = 'AED') {
  const n = Number(amount) || 0;
  return `${currency} ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * How the age chip looks: 'late' past the column's limit, 'warn' from three
 * quarters of it, otherwise 'ok'.
 */
export function ageTone(item, lateMinutes) {
  if (item.late) return 'late';
  const limit = lateMinutes?.[item.phase];
  return limit && item.age_minutes >= limit * 0.75 ? 'warn' : 'ok';
}

// ─── People ────────────────────────────────────────────────────

/** "Ali (Technician)" → "Ali". */
export function plainName(full) {
  const s = String(full || '').trim();
  const m = /^(.*?)\s*\([^)]*\)\s*$/.exec(s);
  return m && m[1] ? m[1] : s;
}

/** "Rashid Al Mansouri" → "RM"; "Ali" → "A". */
export function initials(full) {
  const words = (plainName(full).match(/[\p{L}\p{N}]+/gu) || []).filter(w => /\p{L}/u.test(w));
  if (!words.length) return '?';
  const first = [...words[0]][0];
  return (words.length > 1 ? first + [...words[words.length - 1]][0] : first).toUpperCase();
}

/** "Toyota Hilux 2020 · White". */
export function vehicleLine(item) {
  const main = [item.make, item.model, item.year].filter(Boolean).join(' ');
  return [main, item.colour].filter(Boolean).join(' · ');
}

/** "WO-… · JC-… (+2)". */
export function jobLine(item) {
  const extra = item.sub_cards > 0 ? ` (+${item.sub_cards})` : '';
  return [item.work_order_number, item.main_job_card_number ? `${item.main_job_card_number}${extra}` : null].filter(Boolean).join(' · ');
}

/**
 * The board's default order across columns: jobs worked on job cards first
 * (imported jobs with none last), then by step, oldest first.
 */
export function boardOrder(a, b) {
  const noCard = i => (i.main_job_card_number ? 0 : 1);
  return noCard(a) - noCard(b) || PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || b.age_minutes - a.age_minutes || a.id - b.id;
}

/** What the customer still has to pay, or null when nothing is due from them now. */
export function amountDue(item) {
  const inv = item.invoice;
  if (!inv || inv.on_account || inv.settled) return null;
  return inv.balance > 0 ? inv.balance : null;
}

// ─── Small browser helpers ─────────────────────────────────────

export const readStore = key => { try { return localStorage.getItem(key); } catch { return null; } };
export const writeStore = (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };

/** Copies text; resolves true when it worked. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
