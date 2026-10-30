/**
 * NewEstimateModal — staff-side estimate builder, sent to a customer for
 * per-line approval (routes/estimates.js: POST /, PUT /:id, POST /:id/send).
 *
 * Deliberately separate from NewWorkOrderModal, not a replacement for it.
 * "New Job Card" still creates a job card immediately — a walk-in whose car
 * is on the ramp right now cannot wait on an email round-trip. This is for
 * the case the workshop actually asked for: build the estimate, the
 * customer approves or rejects each line from their phone, and the job card
 * appears automatically the moment every line is decided
 * (estimates.js: applyLineDecision → convertEstimateToWorkOrder).
 *
 * Process Steps 4–5: lines are grouped into JOBS ("AC compressor", "Brake
 * pads"), each with its labour line(s) and part line(s). The Service Advisor
 * chooses the customer's parts preference (Genuine / After-Market / Used,
 * any combination) and prices labour; the Storekeeper prices every part line
 * in each category of the preference, or marks it not available. So a part
 * line has no price input here unless the user is allowed to price parts;
 * the server ignores an advisor's part price anyway and notifies the Store.
 *
 * Props:
 *   open, onClose, onSent        — as before (WorkOrders.jsx, Estimates.jsx)
 *   onSaved({ estimateId, … })   — after a create or an edit
 *   intakeWorkOrder              — { id, work_order_number, customer_id, customer_name,
 *                                    vehicle_id, plate_number }: the estimate is for an
 *                                    existing job card; customer & vehicle are locked to it
 *   editEstimate                 — the GET /estimates/:id payload ({ estimate, lines }):
 *                                    edit mode (PUT), line ids sent back so Store prices carry over
 *
 * Also exports the parts-category helpers and SendEstimatePanel (the
 * preference with its totals + channel picker) shared with pages/Estimates.jsx
 * and pages/Store.jsx.
 */
import { useState, useEffect, useContext, useMemo } from 'react';
import {
  Xmark, Wrench, Cube, Plus, Trash, SendMail, FloppyDisk, Label, Mail, Whatsapp, WarningCircle, Copy, Check,
} from 'iconoir-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import CustomerPicker from './CustomerPicker';

const ORANGE = '#f97316';
const NAVY = '#1e3a6b';

/* ── Who may price what (mirrors lib/workflow.js ROLE_GROUPS) ─────────── */
const MANAGER_ROLES = ['admin', 'super_admin', 'general_manager', 'workshop_manager'];
const MANAGER_SLUGS = ['general_manager', 'workshop_manager'];
function isManager(u) {
  return !!u && (u.is_owner === true || Number(u.is_owner) === 1
    || MANAGER_ROLES.includes(u.role) || MANAGER_SLUGS.includes(u.role_slug));
}
/** Storekeeper / part advisor, or a manager: may enter Genuine / After-Market prices. */
export function mayPriceParts(u) {
  return !!u && (isManager(u) || ['storekeeper', 'part_advisor'].includes(u.role_slug) || u.role === 'part_advisor');
}
/** Service Advisor, or a manager: may price labour. */
export function mayPriceLabour(u) {
  return !!u && (isManager(u) || u.role_slug === 'service_advisor' || u.role === 'service_advisor');
}

/* ── Parts categories (mirror lib/workflow.js, client changes D4) ────────
 * The customer's parts preference is any combination of Genuine,
 * After-Market and Used. The Store prices each part line in every category
 * of the preference (available or not, price, expected delivery) and may
 * offer an alternative category when a requested one is not available —
 * it counts only once the customer approves it. No automatic fallback.
 */
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** *_available is 1 / 0 / null; 0 means "not available". */
export const isNA = v => v !== null && v !== undefined && v !== '' && Number(v) === 0;

export const PART_CATEGORIES = ['genuine', 'after_market', 'used'];
export const DEFAULT_PREFERENCE = ['genuine', 'after_market'];
const CATEGORY_EN = { genuine: 'Genuine', after_market: 'After-Market', used: 'Used' };
/** A category's name on screen. */
export const categoryLabel = (t, c) => t(`estimates.cat_${c}`, CATEGORY_EN[c] || c);
/** "Genuine and Used" */
export function categoryWords(t, pref) {
  const names = (pref || []).map(c => categoryLabel(t, c));
  return names.length > 1 ? t('estimates.cat_list', '{{a}} and {{b}}', { a: names.slice(0, -1).join(', '), b: names.at(-1) }) : names[0] || '';
}
const COL = { genuine: 'genuine', after_market: 'aftermarket', used: 'used' };
/** The estimate_lines columns of a category. */
export const catCols = c => ({ price: `${COL[c]}_price`, available: `${COL[c]}_available`, expected: `${COL[c]}_expected_date` });

/** The estimate's parts preference (old estimates: from the format they were sent in). */
export function preferenceOf(e) {
  const raw = Array.isArray(e?.preference) ? e.preference : e?.parts_preference;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const pref = PART_CATEGORIES.filter(c => list.includes(c));
  if (pref.length) return pref;
  if (e?.estimate_format === 'genuine') return ['genuine'];
  if (e?.estimate_format === 'after_market') return ['after_market'];
  return DEFAULT_PREFERENCE;
}

/** One category of a part line: price (null = none), available true/false/null, expected_date, decided, usable. */
export function partCategory(l, c) {
  const col = catCols(c);
  const na = isNA(l[col.available]);
  const price = na ? null : num(l[col.price]);
  return { option: c, price, available: na ? false : price != null ? true : null,
    expected_date: !na && l[col.expected] ? String(l[col.expected]).slice(0, 10) : null, decided: na || price != null, usable: price != null };
}

/** False for a line priced as one unit price before categories existed. */
export function hasCategoryPricing(l) {
  return PART_CATEGORIES.some(c => { const col = catCols(c); return (l[col.price] ?? null) !== null || (l[col.available] ?? null) !== null; });
}

/** The requested categories and the alternative (priced, outside the preference) of a part line. */
export function partOptions(l, pref) {
  const requested = pref.map(c => partCategory(l, c));
  let alternative = null;
  const alt = l.alternative_option;
  if (alt && PART_CATEGORIES.includes(alt) && !pref.includes(alt)) {
    const o = partCategory(l, alt);
    if (o.usable) {
      alternative = { ...o, alternative: true,
        for: pref.includes(l.alternative_for) ? l.alternative_for : (requested.find(r => r.available === false)?.option || null),
        approved: l.alternative_approved === null || l.alternative_approved === undefined ? null : Number(l.alternative_approved) === 1 };
    }
  }
  return { requested, alternative };
}

/** The option a part line counts at: the customer's choice while on offer, else the first priced, available requested one. */
export function effectiveOption(l, pref) {
  const { requested, alternative } = partOptions(l, pref);
  const usable = requested.filter(o => o.usable);
  if (l.part_option) {
    const chosen = usable.find(o => o.option === l.part_option) || (alternative?.option === l.part_option && alternative.approved ? alternative : null);
    if (chosen) return chosen;
  }
  return usable[0] || null;
}

/** A part line the Store has still to price: a requested category neither priced nor marked not available. */
export function partUnpriced(l, pref) {
  if (l.line_type !== 'parts') return false;
  if (!hasCategoryPricing(l)) return !(Number(l.unit_price) > 0);
  return partOptions(l, pref).requested.some(o => !o.decided);
}

/** The grouping key the server uses for a job. */
export const jobKeyOf = l => String(l.job_name || l.description || 'Job').trim() || 'Job';

/**
 * Per job and per category of the preference (before VAT) — the same
 * arithmetic as lib/workflow.js summariseEstimatePricing: a part counts in
 * a category only when priced and available in it (else the job is flagged
 * na), alternatives are listed apart and in no total.
 */
export function summarisePricing(lines, pref = DEFAULT_PREFERENCE) {
  const jobs = new Map();
  const alternatives = [];
  let unpricedParts = 0, unpricedLabour = 0, partLines = 0;
  for (const l of lines || []) {
    if (l.line_type === 'discount') continue;
    const key = jobKeyOf(l);
    if (!jobs.has(key)) jobs.set(key, { job: key, labour: 0, other: 0, parts: Object.fromEntries(pref.map(c => [c, 0])), na: {}, alternative: 0, partLines: 0, waiting: 0 });
    const j = jobs.get(key);
    const qty = Number(l.quantity) || 1;
    if (l.line_type === 'labour') {
      if (!(Number(l.unit_price) > 0)) unpricedLabour++;
      j.labour += qty * Number(l.unit_price || 0);
    } else if (l.line_type === 'parts') {
      partLines++; j.partLines++;
      if (partUnpriced(l, pref)) { unpricedParts++; j.waiting++; }
      if (!hasCategoryPricing(l)) { for (const c of pref) j.parts[c] += qty * Number(l.unit_price || 0); continue; }
      const { requested, alternative } = partOptions(l, pref);
      for (const o of requested) {
        if (o.usable) j.parts[o.option] += qty * o.price;
        else if (o.available === false) j.na[o.option] = true;
      }
      if (alternative) {
        j.alternative += qty * alternative.price;
        alternatives.push({ line_id: l.id ?? null, job: key, description: l.description, ...alternative, quantity: qty, amount: qty * alternative.price });
      }
    } else {
      j.other += qty * Number(l.unit_price || 0);
    }
  }
  const r2 = n => Math.round(n * 100) / 100;
  const out = [...jobs.values()].map(j => ({
    job: j.job, labour: r2(j.labour), other: r2(j.other), part_lines: j.partLines, waiting: j.waiting, na: j.na,
    parts: Object.fromEntries(pref.map(c => [c, r2(j.parts[c])])),
    totals: Object.fromEntries(pref.map(c => [c, r2(j.labour + j.parts[c] + j.other)])),
    alternative_parts: r2(j.alternative),
  }));
  return {
    preference: pref, jobs: out, alternatives,
    totals: Object.fromEntries(pref.map(c => [c, r2(out.reduce((s, j) => s + j.totals[c], 0))])),
    unpricedParts, unpricedLabour, partLines,
  };
}

const money = v => `AED ${Number(v || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ── Form rows ────────────────────────────────────────────────────────── */
let seq = 0;
const uid = () => `r${++seq}`;
const perCategory = v => Object.fromEntries(PART_CATEGORIES.map(c => [c, v]));
// price / na: the Store's price and "not available" per category (only shown to whoever prices parts).
const blankLine = () => ({
  key: uid(), id: null, description: '', quantity: 1, unit_price: '', part_number: '', urgency: 'now',
  price: perCategory(''), na: perCategory(false), orig: null,
});
const blankJob = (name = '') => ({ key: uid(), name, labour: [blankLine()], parts: [blankLine()] });

/** Edit mode: the estimate's lines back into job blocks. Other line types are kept aside, untouched. */
function jobsFromLines(lines) {
  const byName = new Map();
  const extras = [];
  for (const l of lines || []) {
    if (!['labour', 'parts'].includes(l.line_type)) { extras.push(l); continue; }
    const name = String(l.job_name || '').trim();
    if (!byName.has(name)) byName.set(name, { key: uid(), name, labour: [], parts: [] });
    byName.get(name)[l.line_type].push({
      key: uid(), id: l.id, description: l.description || '', quantity: Number(l.quantity) || 1,
      unit_price: num(l.unit_price) ?? '', part_number: l.part_number || '', urgency: l.urgency || 'now',
      price: Object.fromEntries(PART_CATEGORIES.map(c => [c, num(l[catCols(c).price]) ?? ''])),
      na: Object.fromEntries(PART_CATEGORIES.map(c => [c, isNA(l[catCols(c).available])])),
      orig: l,
    });
  }
  const jobs = [...byName.values()];
  return { jobs: jobs.length ? jobs : [blankJob()], extras };
}

/** A form part row as an estimate line (the shape partUnpriced() reads): the saved line, with the form's prices when they can be edited here. */
function rowAsPart(r, pref, editable) {
  const l = { ...(r.orig || {}), line_type: 'parts', unit_price: r.orig?.unit_price || 0 };
  if (editable) {
    for (const c of pref) {
      const col = catCols(c);
      l[col.price] = r.na[c] ? null : r.price[c];
      l[col.available] = r.na[c] ? 0 : num(r.price[c]) != null ? 1 : null;
    }
  }
  return l;
}

// Fields this form doesn't edit, carried over on an existing line so the PUT keeps them.
const CARRY = ['unit_cost', 'discount_pct', 'payer_direction', 'operation_id', 'insurance_ref', 'warranty_ref', 'customer_status', 'part_option'];
const carry = o => Object.fromEntries(CARRY.filter(k => o && o[k] !== undefined && o[k] !== null).map(k => [k, o[k]]));

const URGENCY = [
  { value: 'now', label: 'Now' },
  { value: 'soon', label: 'Soon' },
  { value: 'can_wait', label: 'Can wait' },
];

const CUSTOMER_TYPES = [
  { value: 'retail_cash', label: 'Retail / cash' },
  { value: 'credit', label: 'Credit account' },
  { value: 'insurance', label: 'Insurance' },
  // Stored as internal_fleet for every internal account (Fleet, Insurance or
  // Asset); shown as "Internal" with the Step 1 subcategory.
  { value: 'internal_fleet', label: 'Internal' },
];
const SUB_LABELS = { fleet: 'Fleet', insurance: 'Insurance', asset: 'Asset', walkin: 'Walk-in' };

/** The account type that follows from Step 1 (main category + subcategory). */
function typeFromClass(k) {
  if (!k) return 'retail_cash';
  if (k.cls === 'internal') return 'internal_fleet';
  if (k.sub === 'insurance') return 'insurance';
  if (k.sub === 'fleet') return 'credit';
  return 'retail_cash';
}

export default function NewEstimateModal({ open, onClose, onSent, onSaved, intakeWorkOrder = null, editEstimate = null, enquiry = null }) {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext) || {};
  const canParts = mayPriceParts(user);
  const canLabour = mayPriceLabour(user);
  const editE = editEstimate?.estimate || null;
  const isEdit = !!editE;
  const locked = isEdit || !!intakeWorkOrder;

  const [customer, setCustomer] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState('');
  const [customerType, setCustomerType] = useState('retail_cash');
  const [typeTouched, setTypeTouched] = useState(false);
  // Step 1 classification of the job card (its snapshot, else the customer's
  // account) or of the chosen customer: { cls, sub } or null while unknown.
  const [klass, setKlass] = useState(null);
  // Insurer's claim / policy number (or a fleet's LPO), kept on every line (estimate_lines.insurance_ref).
  const [claimRef, setClaimRef] = useState('');
  const manager = isManager(user);
  const [jobs, setJobs] = useState(() => [blankJob()]);
  const [extras, setExtras] = useState([]);
  // The customer's parts preference: which categories the Store prices and the customer chooses from.
  const [pref, setPref] = useState(DEFAULT_PREFERENCE);
  const [submitting, setSubmitting] = useState(null); // null | 'draft' | 'store' | 'send' | 'save'
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { kind, estimateId, estimate_number, … }
  const [sendData, setSendData] = useState(null); // GET /estimates/:id payload for the send step

  const editKey = editE ? `${editE.id}:${editE.version}` : '';
  useEffect(() => {
    if (!open) return;
    setCustomer(null); setVehicles([]); setVehicleId(''); setCustomerType('retail_cash'); setTypeTouched(false); setKlass(null); setClaimRef('');
    setPref(editE ? preferenceOf(editE) : DEFAULT_PREFERENCE);
    if (editEstimate?.lines) {
      const r = jobsFromLines(editEstimate.lines);
      setJobs(r.jobs); setExtras(r.extras);
    } else {
      setJobs([blankJob()]); setExtras([]);
    }
    setSubmitting(null); setError(''); setResult(null); setSendData(null);
    // A quote for an enquiry starts with its customer (and car) chosen.
    if (enquiry?.customer?.id) setCustomer(enquiry.customer);
  }, [open, editKey, intakeWorkOrder?.id, enquiry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The job card's classification decides the account type ("From the job
  // card") and whether the external-customer approval applies.
  useEffect(() => {
    if (!open || !intakeWorkOrder?.id || isEdit) return;
    let live = true;
    (async () => {
      try {
        const [w, c] = await Promise.all([
          api.get(`/work-orders/${intakeWorkOrder.id}`).catch(() => null),
          intakeWorkOrder.customer_id ? api.get(`/customers/${intakeWorkOrder.customer_id}`).catch(() => null) : null,
        ]);
        if (!live) return;
        const wo = w?.success ? w.data : {};
        const cu = c?.success ? c.data : {};
        const cls = wo.intake_customer_class || cu.customer_class || null;
        const sub = wo.intake_customer_subcategory || cu.customer_subcategory || null;
        setKlass(cls ? { cls, sub } : { cls: 'external', sub: null });
      } catch { if (live) setKlass({ cls: 'external', sub: null }); }
    })();
    return () => { live = false; };
  }, [open, intakeWorkOrder?.id, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // A customer chosen here (no job card): its account type follows Step 1 too.
  useEffect(() => {
    if (intakeWorkOrder || isEdit) return;
    const k = customer?.id ? { cls: customer.customer_class || 'external', sub: customer.customer_subcategory || null } : null;
    setKlass(k);
    if (!typeTouched || (!manager && k?.cls !== 'internal' && customerType === 'internal_fleet')) {
      setCustomerType(typeFromClass(k)); setTypeTouched(false);
    }
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!customer?.id) { setVehicles([]); setVehicleId(''); return; }
    let live = true;
    (async () => {
      try {
        const res = await api.get(`/vehicles?customer_id=${customer.id}`);
        if (live && res.success) {
          setVehicles(res.data || []);
          if (enquiry?.vehicle_id && enquiry.customer?.id === customer.id && (res.data || []).some(v => v.id === enquiry.vehicle_id)) {
            setVehicleId(String(enquiry.vehicle_id));
          }
        }
      } catch { /* the select just stays empty */ }
    })();
    return () => { live = false; };
  }, [customer]);

  if (!open) return null;

  const vatRate = Number(editE?.vat_rate ?? 5);

  /* ── account type ── */
  // Internal removes the Supervisor / Workshop Manager approval, so for an
  // external customer only a manager may choose it.
  const fromClass = typeFromClass(klass);
  const typeOptions = CUSTOMER_TYPES.filter(o => o.value !== 'internal_fleet' || manager || klass?.cls === 'internal');
  const typeLabel = v => (v === 'internal_fleet' && klass?.cls === 'internal' && klass.sub
    ? `${t('estimates.ctype_internal_fleet', 'Internal')} · ${t(`workflow.val.sub_${klass.sub}`, SUB_LABELS[klass.sub] || klass.sub)}`
    : t(`estimates.ctype_${v}`, (CUSTOMER_TYPES.find(o => o.value === v) || {}).label || v));
  const effectiveType = intakeWorkOrder ? (typeTouched ? customerType : fromClass) : customerType;

  /* ── edits ── */
  const patchJob = (jobKey, fn) => setJobs(prev => prev.map(j => (j.key === jobKey ? fn(j) : j)));
  const setJobName = (jobKey, name) => patchJob(jobKey, j => ({ ...j, name }));
  const updateLine = (jobKey, kind, rowKey, field, value) =>
    patchJob(jobKey, j => ({ ...j, [kind]: j[kind].map(r => (r.key === rowKey ? { ...r, [field]: value } : r)) }));
  const addLine = (jobKey, kind) => patchJob(jobKey, j => ({ ...j, [kind]: [...j[kind], blankLine()] }));
  const removeLine = (jobKey, kind, rowKey) => patchJob(jobKey, j => ({ ...j, [kind]: j[kind].filter(r => r.key !== rowKey) }));
  const addJob = () => setJobs(prev => [...prev, blankJob()]);
  const removeJob = jobKey => setJobs(prev => (prev.length > 1 ? prev.filter(j => j.key !== jobKey) : prev));

  /* ── what's on the form ── */
  const filled = rows => rows.filter(r => r.description.trim());
  const allLabour = jobs.flatMap(j => filled(j.labour));
  const allParts = jobs.flatMap(j => filled(j.parts));
  const labourTotal = allLabour.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_price) || 0), 0);
  // Parts per category of the preference — no fallback to another category.
  const partsByCat = summarisePricing(allParts.map(r => ({ ...rowAsPart(r, pref, canParts), quantity: Number(r.quantity) || 0, job_name: 'all' })), pref);
  const catParts = c => partsByCat.jobs[0]?.parts[c] || 0;
  const partsWaiting = partsByCat.unpricedParts;
  const labourUnpriced = allLabour.filter(r => !(Number(r.unit_price) > 0)).length;
  const withVat = n => n * (1 + vatRate / 100);
  const togglePref = c => setPref(p => (p.includes(c) ? (p.length > 1 ? p.filter(x => x !== c) : p) : PART_CATEGORIES.filter(x => x === c || p.includes(x))));

  function buildLines() {
    const out = [];
    for (const j of jobs) {
      const rows = [...filled(j.labour).map(r => ['labour', r]), ...filled(j.parts).map(r => ['parts', r])];
      const jobName = (j.name.trim() || rows[0]?.[1].description.trim() || '').slice(0, 200);
      for (const [type, r] of rows) {
        const o = r.orig || {};
        const line = {
          ...carry(o),
          ...(r.id ? { id: r.id } : {}),
          line_type: type,
          job_name: jobName || null,
          description: r.description.trim(),
          quantity: Number(r.quantity) || 1,
          unit_cost: Number(o.unit_cost) || 0,
          urgency: r.urgency,
        };
        if (type === 'labour') {
          line.unit_price = Number(r.unit_price) || 0;
        } else {
          line.part_number = r.part_number.trim() || undefined;
          // Ignored by the server unless the user prices parts; kept for legacy single-price lines.
          line.unit_price = Number(o.unit_price) || 0;
          // The categories of the preference only; a delivery date or an
          // alternative set on the Estimates screen is kept by the server.
          if (canParts) {
            for (const c of pref) {
              if (!r.na[c] && num(r.price[c]) == null) continue;
              const col = catCols(c);
              line[col.price] = r.na[c] ? null : num(r.price[c]);
              line[col.available] = !r.na[c];
            }
          }
        }
        out.push(line);
      }
    }
    // Sublet / consumable / discount lines this form doesn't show — sent back as they are.
    for (const x of extras) {
      out.push({
        ...carry(x), id: x.id, line_type: x.line_type, job_name: x.job_name || null, description: x.description,
        part_number: x.part_number || undefined, quantity: Number(x.quantity) || 1,
        unit_cost: Number(x.unit_cost) || 0, unit_price: Number(x.unit_price) || 0, urgency: x.urgency || 'now',
      });
    }
    // New estimate on an insurance / fleet account: the claim, policy or LPO
    // reference goes with each line (printed on the estimate and invoice).
    if (!isEdit && claimRef.trim()) for (const l of out) l.insurance_ref = claimRef.trim().slice(0, 200);
    return out;
  }

  function validate() {
    if (!locked && !customer?.id) return t('estimates.err_choose_customer', 'Choose a customer.');
    if (!isEdit && !manager && effectiveType === 'internal_fleet' && klass?.cls !== 'internal') {
      return t('estimates.err_internal_manager', 'This customer is External: only a manager can raise the estimate as Internal.');
    }
    if (!allLabour.length && !allParts.length) return t('estimates.err_no_lines', 'Add at least one labour or part line with a description.');
    if (!pref.length) return t('estimates.err_pref', 'Choose the customer’s parts preference — at least one of Genuine, After-Market or Used.');
    for (const r of [...allLabour, ...allParts]) {
      if (!(Number(r.quantity) > 0)) return t('estimates.err_qty', '"{{d}}" needs a quantity above zero.', { d: r.description.trim() });
    }
    for (const r of allLabour) {
      if (r.unit_price !== '' && !(Number(r.unit_price) >= 0)) return t('estimates.err_price', '"{{d}}" needs a valid price.', { d: r.description.trim() });
    }
    if (canParts) {
      for (const r of allParts) {
        if (pref.some(c => !r.na[c] && r.price[c] !== '' && !(Number(r.price[c]) >= 0))) {
          return t('estimates.err_price', '"{{d}}" needs a valid price.', { d: r.description.trim() });
        }
      }
    }
    return '';
  }

  async function submit(kind) {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setSubmitting(kind); setError('');
    try {
      if (isEdit) {
        const res = await api.put(`/estimates/${editE.id}`, { lines: buildLines(), parts_preference: pref });
        if (!res.success) { setError(res.message || t('estimates.err_save', 'Could not save the estimate.')); return; }
        onSaved?.({ estimateId: editE.id, estimate_number: editE.estimate_number, edited: true });
        onClose?.();
        return;
      }
      const body = {
        vat_rate: 5,
        parts_preference: pref,
        lines: buildLines(),
      };
      if (intakeWorkOrder) {
        body.intake_work_order_id = Number(intakeWorkOrder.id);
        if (intakeWorkOrder.customer_id) body.customer_id = Number(intakeWorkOrder.customer_id);
        if (intakeWorkOrder.vehicle_id) body.vehicle_id = Number(intakeWorkOrder.vehicle_id);
        // "From the job card": the type that follows from its classification
        // (Retail, Credit for a fleet, Insurance, Internal). Unknown → the server decides.
        if (typeTouched) body.customer_type = customerType;
        else if (klass) body.customer_type = fromClass;
      } else {
        body.customer_id = Number(customer.id);
        body.vehicle_id = vehicleId ? Number(vehicleId) : null;
        body.customer_type = customerType;
        if (enquiry?.id) body.enquiry_id = Number(enquiry.id);
      }
      const res = await api.post('/estimates', body);
      if (!res.success) { setError(res.message || t('estimates.err_save', 'Could not save the estimate.')); return; }
      const base = { estimateId: res.estimateId, estimate_number: res.estimate_number, parts_to_price: Number(res.parts_to_price) || 0, pref: res.parts_preference || pref };
      onSaved?.(base);
      // From here on the estimate exists: never show an error that invites a
      // retry from this form, which would create a second copy.
      if (kind === 'send' && !base.parts_to_price) {
        const d = await api.get(`/estimates/${res.estimateId}`).catch(() => null);
        if (d?.success) { setSendData(d); setResult({ ...base, kind: 'send' }); return; }
      }
      setResult({ ...base, kind: base.parts_to_price ? 'store' : (labourUnpriced ? 'labour' : 'draft') });
    } catch (e) {
      setError(e?.message || t('estimates.err_save', 'Could not save the estimate.'));
    } finally {
      setSubmitting(null);
    }
  }

  const lockedName = isEdit ? (editE.customer_full_name || editE.customer_name) : intakeWorkOrder?.customer_name;
  const lockedPlate = isEdit
    ? [editE.plate_number || editE.vehicle_plate, [editE.make, editE.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    : intakeWorkOrder?.plate_number;
  const woNumber = intakeWorkOrder?.work_order_number || (isEdit && editE.intake_work_order_id ? `#${editE.intake_work_order_id}` : '');

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.header}>
          <div style={{ minWidth: 0 }}>
            <h2 style={st.title}>
              {isEdit ? t('estimates.edit_title', 'Edit estimate {{n}}', { n: editE.estimate_number }) : t('estimates.new_title', 'New Estimate')}
            </h2>
            {woNumber ? (
              <p style={st.woChip}>{t('estimates.for_job_card', 'For work order {{wo}}', { wo: woNumber })}</p>
            ) : enquiry?.enquiry_number ? (
              <p style={st.woChip}>{t('estimates.for_enquiry', 'For enquiry {{n}}', { n: enquiry.enquiry_number })}</p>
            ) : (
              <p style={st.subtitle}>
                {t('estimates.new_sub_pref', 'Group the work into jobs — labour and parts for each. The Store prices the parts in the customer’s parts preference, then it goes to the customer for approval line by line.')}
              </p>
            )}
          </div>
          <button style={st.closeBtn} onClick={onClose} aria-label={t('estimates.close', 'Close')}><Xmark width={18} height={18} /></button>
        </div>

        <div style={st.body}>
          {error && <div style={st.error}>{error}</div>}

          {result ? (
            <ResultView
              t={t} result={result} sendData={sendData} onClose={onClose}
              onSendDone={res => {
                if (res.held) { setResult(r => ({ ...r, kind: 'held', heldMsg: res.message })); return; }
                setResult(r => ({ ...r, kind: 'sent', sentTo: res.message, approval_url: res.approval_url, whatsapp_url: res.whatsapp_url, channel: res.channel }));
                onSent?.({ estimateId: result.estimateId, estimate_number: result.estimate_number });
              }}
              onSendCancel={() => setResult(r => ({ ...r, kind: 'draft' }))}
            />
          ) : (
            <>
              {isEdit && editE.status === 'sent_to_customer' && (
                <div style={st.warn}>
                  <WarningCircle width={16} height={16} style={{ flexShrink: 0 }} />
                  <span>{t('estimates.edit_sent_warn', 'This estimate is with the customer. Saving changes takes it back to draft (and clears any manager approval) — send it again afterwards.')}</span>
                </div>
              )}

              {locked ? (
                <div style={st.lockedBox}>
                  <div style={{ minWidth: 0 }}>
                    <div style={st.fieldLabel}>{t('estimates.customer', 'Customer')}</div>
                    <div style={st.lockedVal}>{lockedName || '—'}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={st.fieldLabel}>{t('estimates.vehicle', 'Vehicle')}</div>
                    <div style={st.lockedVal}>{lockedPlate || t('estimates.no_vehicle', 'No vehicle')}</div>
                  </div>
                  {!isEdit && (
                    <Field label={t('estimates.account_type', 'Account type')}>
                      <select style={st.input} value={typeTouched ? customerType : ''} onChange={e => { setCustomerType(e.target.value); setTypeTouched(!!e.target.value); }}>
                        <option value="">{t('estimates.account_from_job', 'From the job card')}{klass ? ` (${typeLabel(fromClass)})` : ''}</option>
                        {typeOptions.map(o => <option key={o.value} value={o.value}>{typeLabel(o.value)}</option>)}
                      </select>
                    </Field>
                  )}
                  {!isEdit && ['insurance', 'credit'].includes(effectiveType) && (
                    <Field label={effectiveType === 'insurance' ? t('estimates.claim_ref', 'Claim / policy no. (optional)') : t('estimates.lpo_ref', 'LPO / PO no. (optional)')}>
                      <input style={st.input} value={claimRef} maxLength={200} onChange={e => setClaimRef(e.target.value)} />
                    </Field>
                  )}
                </div>
              ) : (
                <div style={st.grid2}>
                  <Field label={t('estimates.customer_req', 'Customer *')}>
                    <CustomerPicker value={customer} onChange={setCustomer} />
                  </Field>
                  <Field label={t('estimates.vehicle', 'Vehicle')}>
                    <select style={st.input} value={vehicleId} onChange={e => setVehicleId(e.target.value)} disabled={!customer?.id}>
                      <option value="">{customer?.id ? t('estimates.select_vehicle', 'Select vehicle…') : t('estimates.choose_customer_first', 'Choose a customer first')}</option>
                      {vehicles.map(v => (
                        <option key={v.id} value={v.id}>{v.make} {v.model}{v.plate_number ? ` — ${v.plate_number}` : ''}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('estimates.account_type', 'Account type')}>
                    <select style={st.input} value={customerType} onChange={e => { setCustomerType(e.target.value); setTypeTouched(true); }}>
                      {typeOptions.map(o => <option key={o.value} value={o.value}>{typeLabel(o.value)}</option>)}
                    </select>
                  </Field>
                  {['insurance', 'credit'].includes(effectiveType) && (
                    <Field label={effectiveType === 'insurance' ? t('estimates.claim_ref', 'Claim / policy no. (optional)') : t('estimates.lpo_ref', 'LPO / PO no. (optional)')}>
                      <input style={st.input} value={claimRef} maxLength={200} onChange={e => setClaimRef(e.target.value)} />
                    </Field>
                  )}
                </div>
              )}

              <div style={st.prefBox}>
                <div style={st.prefHead}>
                  <span style={st.fieldLabel} id="est-pref-label">{t('estimates.pref_label', 'Customer’s parts preference')}</span>
                  <span style={st.prefHint}>{t('estimates.pref_hint', 'The Store prices these for every part; the customer chooses between them. Pick at least one.')}</span>
                </div>
                <div style={st.prefChips} role="group" aria-labelledby="est-pref-label">
                  {PART_CATEGORIES.map(c => {
                    const on = pref.includes(c);
                    return (
                      <button key={c} type="button" aria-pressed={on} style={{ ...st.prefChip, ...(on ? st.prefChipOn : null) }}
                        title={on && pref.length === 1 ? t('estimates.pref_keep_one', 'At least one category is needed') : undefined}
                        onClick={() => togglePref(c)}>
                        {on ? <Check width={14} height={14} /> : <Plus width={14} height={14} />} {categoryLabel(t, c)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {jobs.map((j, ji) => (
                <JobBlock
                  key={j.key} t={t} job={j} index={ji} canRemove={jobs.length > 1} pref={pref}
                  canParts={canParts} canLabour={canLabour}
                  onName={v => setJobName(j.key, v)}
                  onRemove={() => removeJob(j.key)}
                  onLine={(kind, rowKey, f, v) => updateLine(j.key, kind, rowKey, f, v)}
                  onAdd={kind => addLine(j.key, kind)}
                  onDel={(kind, rowKey) => removeLine(j.key, kind, rowKey)}
                />
              ))}
              <button style={st.addJobBtn} onClick={addJob}><Plus width={15} height={15} /> {t('estimates.add_job', 'Add job')}</button>

              {extras.length > 0 && (
                <p style={st.note}>
                  {t('estimates.extras_kept', '{{n}} other line(s) (sublet, consumables, discount) are kept as they are.', { n: extras.length })}
                </p>
              )}

              <div style={st.totalsBox}>
                <Row label={t('estimates.labour', 'Labour')} value={money(labourTotal)} />
                {allParts.length > 0 && (partsWaiting === allParts.length ? (
                  <Row label={t('estimates.parts', 'Parts')} value={t('estimates.priced_by_store', 'Priced by the Store')} muted />
                ) : pref.map(c => (
                  <Row key={c} label={t('estimates.parts_cat', 'Parts — {{cat}}', { cat: categoryLabel(t, c) })} value={money(catParts(c))} />
                )))}
                <div style={st.totalDivider} />
                {allParts.length > 0 && partsWaiting < allParts.length ? pref.map(c => (
                  <Row key={c} label={t('estimates.total_cat_vat', 'Total with {{cat}} parts (incl. {{v}}% VAT)', { cat: categoryLabel(t, c), v: vatRate })}
                    value={money(withVat(labourTotal + catParts(c)))} strong />
                )) : (
                  <Row label={allParts.length ? t('estimates.labour_vat', 'Labour (incl. {{v}}% VAT)', { v: vatRate }) : t('estimates.total_vat', 'Estimate total (incl. {{v}}% VAT)', { v: vatRate })}
                    value={money(withVat(labourTotal))} strong />
                )}
                {partsWaiting > 0 && (
                  <p style={st.waitNote}>
                    <Label width={14} height={14} style={{ flexShrink: 0 }} />
                    {canParts
                      ? t('estimates.parts_unpriced_self_cat', '{{n}} part line(s) have no price yet — enter {{cats}} or mark it not available.', { n: partsWaiting, cats: categoryWords(t, pref) })
                      : t('estimates.parts_to_store_cat', '{{n}} part line(s) will go to the Store for pricing ({{cats}}) when you save.', { n: partsWaiting, cats: categoryWords(t, pref) })}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {!result && (
          <div style={st.footer}>
            <button style={st.ghostBtn} onClick={onClose}>{t('estimates.cancel', 'Cancel')}</button>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {isEdit ? (
                <button style={{ ...st.primaryBtn, opacity: submitting ? 0.7 : 1 }} disabled={!!submitting} onClick={() => submit('save')}>
                  <FloppyDisk width={15} height={15} /> {submitting ? t('estimates.saving', 'Saving…') : t('estimates.save_changes', 'Save changes')}
                </button>
              ) : partsWaiting > 0 ? (
                <button style={{ ...st.primaryBtn, opacity: submitting ? 0.7 : 1 }} disabled={!!submitting} onClick={() => submit('store')}>
                  <Label width={15} height={15} /> {submitting ? t('estimates.saving', 'Saving…') : t('estimates.send_to_store', 'Save & send to the Store for pricing')}
                </button>
              ) : labourUnpriced > 0 ? (
                <button style={{ ...st.primaryBtn, opacity: submitting ? 0.7 : 1 }} disabled={!!submitting} onClick={() => submit('draft')}>
                  <FloppyDisk width={15} height={15} /> {submitting ? t('estimates.saving', 'Saving…') : t('estimates.save_estimate', 'Save estimate')}
                </button>
              ) : (
                <>
                  <button style={{ ...st.ghostBtn, opacity: submitting ? 0.6 : 1 }} disabled={!!submitting} onClick={() => submit('draft')}>
                    <FloppyDisk width={15} height={15} /> {submitting === 'draft' ? t('estimates.saving', 'Saving…') : t('estimates.save_draft', 'Save as draft')}
                  </button>
                  <button style={{ ...st.primaryBtn, opacity: submitting ? 0.7 : 1 }} disabled={!!submitting} onClick={() => submit('send')}>
                    <SendMail width={15} height={15} /> {submitting === 'send' ? t('estimates.saving', 'Saving…') : t('estimates.save_and_send', 'Save & send…')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── One job: name + labour lines + part lines ─────────────────────────── */
function JobBlock({ t, job, index, canRemove, pref, canParts, canLabour, onName, onRemove, onLine, onAdd, onDel }) {
  const lab = job.labour.filter(r => r.description.trim());
  const par = job.parts.filter(r => r.description.trim());
  const labour = lab.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_price) || 0), 0);
  const sum = summarisePricing(par.map(r => ({ ...rowAsPart(r, pref, canParts), quantity: Number(r.quantity) || 0, job_name: 'job' })), pref);
  const waiting = sum.unpricedParts;
  const parts = c => sum.jobs[0]?.parts[c] || 0;
  return (
    <div style={st.jobCard}>
      <div style={st.jobHead}>
        <span style={st.jobNo}>{t('estimates.job_n', 'Job {{n}}', { n: index + 1 })}</span>
        <input style={{ ...st.input, flex: 1, minWidth: 160, fontWeight: 700 }} value={job.name}
          placeholder={t('estimates.job_name_ph', 'Job name, e.g. AC compressor')}
          onChange={e => onName(e.target.value)} />
        {canRemove && (
          <button style={st.lineDel} onClick={onRemove} title={t('estimates.remove_job', 'Remove job')} aria-label={t('estimates.remove_job', 'Remove job')}>
            <Trash width={15} height={15} />
          </button>
        )}
      </div>

      <div style={st.sectionLabel}><Wrench width={13} height={13} /> {t('estimates.labour', 'Labour')}</div>
      {job.labour.map(r => (
        <div key={r.key} style={st.lineRow}>
          <input style={{ ...st.input, flex: '2 1 180px' }} placeholder={t('estimates.labour_desc_ph', 'Labour description')}
            value={r.description} onChange={e => onLine('labour', r.key, 'description', e.target.value)} />
          <input style={{ ...st.input, width: 70 }} type="number" min="0" step="0.25" placeholder={t('estimates.hours', 'Hrs')}
            title={t('estimates.qty_hours', 'Quantity / hours')}
            value={r.quantity} onChange={e => onLine('labour', r.key, 'quantity', e.target.value)} />
          {canLabour ? (
            <input style={{ ...st.input, width: 100 }} type="number" min="0" step="0.01" placeholder={t('estimates.price', 'Price')}
              value={r.unit_price} onChange={e => onLine('labour', r.key, 'unit_price', e.target.value)} />
          ) : (
            <span style={st.hintChip} title={t('estimates.labour_hint_tip', 'Labour is priced by the Service Advisor')}>
              {Number(r.unit_price) > 0 ? money(r.unit_price) : t('estimates.priced_by_sa', 'Priced by the Service Advisor')}
            </span>
          )}
          <UrgencySelect t={t} value={r.urgency} onChange={v => onLine('labour', r.key, 'urgency', v)} />
          <button style={st.lineDel} onClick={() => onDel('labour', r.key)} aria-label={t('estimates.remove_line', 'Remove line')}><Trash width={15} height={15} /></button>
        </div>
      ))}
      <button style={st.addLineBtn} onClick={() => onAdd('labour')}><Plus width={14} height={14} /> {t('estimates.add_labour', 'Labour line')}</button>

      <div style={{ ...st.sectionLabel, marginTop: 12 }}>
        <Cube width={13} height={13} /> {t('estimates.parts', 'Parts')}
        {!canParts && <span style={st.storeTag}><Label width={12} height={12} /> {t('estimates.priced_by_store', 'Priced by the Store')}</span>}
      </div>
      {job.parts.map(r => (
        <div key={r.key} style={st.partBlock}>
          <div style={{ ...st.lineRow, marginBottom: 0 }}>
            <input style={{ ...st.input, flex: '2 1 180px' }} placeholder={t('estimates.part_desc_ph', 'Part description')}
              value={r.description} onChange={e => onLine('parts', r.key, 'description', e.target.value)} />
            <input style={{ ...st.input, flex: '1 1 90px', minWidth: 80 }} placeholder={t('estimates.part_no', 'Part no.')}
              value={r.part_number} onChange={e => onLine('parts', r.key, 'part_number', e.target.value)} />
            <input style={{ ...st.input, width: 62 }} type="number" min="0" step="1" placeholder={t('estimates.qty', 'Qty')}
              value={r.quantity} onChange={e => onLine('parts', r.key, 'quantity', e.target.value)} />
            <UrgencySelect t={t} value={r.urgency} onChange={v => onLine('parts', r.key, 'urgency', v)} />
            <button style={st.lineDel} onClick={() => onDel('parts', r.key)} aria-label={t('estimates.remove_line', 'Remove line')}><Trash width={15} height={15} /></button>
          </div>
          {canParts ? (
            <div style={st.priceRow}>
              {pref.map(c => (
                <PriceInput key={c} t={t} label={categoryLabel(t, c)} value={r.price[c]} na={r.na[c]}
                  onValue={v => onLine('parts', r.key, 'price', { ...r.price, [c]: v })}
                  onNA={v => onLine('parts', r.key, 'na', { ...r.na, [c]: v })} />
              ))}
            </div>
          ) : r.orig ? (
            <div style={st.priceReadonly}><StorePrices t={t} line={r.orig} pref={pref} /></div>
          ) : null}
        </div>
      ))}
      <button style={st.addLineBtn} onClick={() => onAdd('parts')}><Plus width={14} height={14} /> {t('estimates.add_part', 'Part line')}</button>

      {(lab.length > 0 || par.length > 0) && (
        <div style={st.jobFoot}>
          <span>{t('estimates.labour', 'Labour')} <b>{money(labour)}</b></span>
          {par.length > 0 && (waiting === par.length
            ? <span>{t('estimates.parts', 'Parts')} <b style={{ color: '#b45309' }}>{t('estimates.waiting_store', 'Waiting for the Store')}</b></span>
            : pref.map(c => (
              <span key={c}>{t('estimates.total_cat', 'Total {{cat}}', { cat: categoryLabel(t, c) })} <b>{money(labour + parts(c))}</b></span>
            )))}
        </div>
      )}
    </div>
  );
}

function PriceInput({ t, label, value, na, onValue, onNA }) {
  return (
    <div style={st.priceCell}>
      <span style={st.priceLbl}>{label}</span>
      <input style={{ ...st.input, width: 104, background: na ? '#f1f5f9' : '#fff' }} type="number" min="0" step="0.01"
        placeholder={na ? t('estimates.not_available_short', 'Not available') : 'AED'} disabled={na} aria-label={label}
        value={na ? '' : value} onChange={e => onValue(e.target.value)} />
      <label style={st.naToggle}>
        <input type="checkbox" checked={na} onChange={e => onNA(e.target.checked)} /> {t('estimates.not_available_short', 'Not available')}
      </label>
    </div>
  );
}

/** Read-only Store prices of an existing part line, per category of the preference, and its alternative. */
function StorePrices({ t, line, pref }) {
  if (partUnpriced(line, pref)) return <span style={{ color: '#b45309', fontWeight: 600 }}>{t('estimates.waiting_store', 'Waiting for the Store')}</span>;
  if (!hasCategoryPricing(line)) return <span>{money(line.unit_price)}</span>;
  const { requested, alternative } = partOptions(line, pref);
  return (
    <span>
      {requested.map((o, i) => (
        <span key={o.option}>{i > 0 ? ' · ' : ''}{categoryLabel(t, o.option)} <b>{o.usable ? money(o.price) : t('estimates.not_available_short', 'Not available')}</b></span>
      ))}
      {alternative && (
        <span> · {t('estimates.alt_short', 'Alternative')}: {categoryLabel(t, alternative.option)} <b>{money(alternative.price)}</b></span>
      )}
    </span>
  );
}

function UrgencySelect({ t, value, onChange }) {
  return (
    <select style={{ ...st.input, width: 98 }} value={value} onChange={e => onChange(e.target.value)} title={t('estimates.urgency', 'Urgency')}>
      {URGENCY.map(u => <option key={u.value} value={u.value}>{t(`estimates.urgency_${u.value}`, u.label)}</option>)}
    </select>
  );
}

/* ── After saving ──────────────────────────────────────────────────────── */
function ResultView({ t, result, sendData, onClose, onSendDone, onSendCancel }) {
  if (result.kind === 'send' && sendData) {
    return (
      <div>
        <div style={st.savedStrip}><Check width={16} height={16} /> {t('estimates.saved_choose_send', 'Estimate {{n}} saved — choose how to send it.', { n: result.estimate_number })}</div>
        <SendEstimatePanel data={sendData} onDone={onSendDone} onCancel={onSendCancel} cancelLabel={t('estimates.not_now', 'Not now')} />
      </div>
    );
  }
  return (
    <div style={result.kind === 'held' ? { ...st.resultBox, background: '#fdf4e5', borderColor: '#f3d9a8' } : st.resultBox}>
      <div style={{ ...st.resultTitle, color: result.kind === 'held' ? '#b45309' : '#15803d' }}>✓ {t('estimates.estimate_n', 'Estimate {{n}}', { n: result.estimate_number })}</div>
      {result.kind === 'sent' ? (
        <>
          <p>{result.channel === 'whatsapp'
            ? t('estimates.sent_whatsapp', 'WhatsApp has opened with the message — press Send there. The customer can approve or reject each line from their phone.')
            : t('estimates.sent_email', '{{to}}. The customer can approve or reject each line from their phone.', { to: result.sentTo })}</p>
          {result.whatsapp_url && (
            <p><a href={result.whatsapp_url} target="_blank" rel="noreferrer" style={st.waLink}><Whatsapp width={15} height={15} /> {t('estimates.open_whatsapp', 'Open WhatsApp again')}</a></p>
          )}
          {result.approval_url && (
            <p style={st.approvalLink}>{t('estimates.link_manual', 'Approval link:')} <a href={result.approval_url} target="_blank" rel="noreferrer">{result.approval_url}</a></p>
          )}
        </>
      ) : result.kind === 'held' ? (
        <p>{result.heldMsg || t('estimates.held_msg', 'Saved. A supervisor or workshop manager has to approve it before it goes to the customer — they have been notified.')} {t('estimates.held_where', 'It is waiting under Estimates → Needs approval.')}</p>
      ) : result.kind === 'store' ? (
        <p>{t('estimates.saved_store_cat', 'Saved. {{n}} part line(s) are with the Store for pricing ({{cats}}) — the Storekeeper has been notified. You will be notified when they are priced; then send it to the customer from Estimates.', { n: result.parts_to_price, cats: categoryWords(t, result.pref) })}</p>
      ) : result.kind === 'labour' ? (
        <p>{t('estimates.saved_labour', 'Saved. The labour still needs a price from the Service Advisor before it can be sent to the customer.')}</p>
      ) : (
        <p>{t('estimates.saved_draft', 'Saved as a draft. Open it from the Estimates screen to send it when ready.')}</p>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        {result.estimateId && (
          <Link to={`/estimates?id=${result.estimateId}`} style={{ ...st.ghostBtn, textDecoration: 'none' }} onClick={onClose}>
            {t('estimates.open_in_estimates', 'Open in Estimates')}
          </Link>
        )}
        <button style={st.primaryBtn} onClick={onClose}>{t('estimates.done', 'Done')}</button>
      </div>
    </div>
  );
}

/* ── Send: the parts preference with its totals + channel ─────────────── */

/** Plain-words explanation of a failed POST /estimates/:id/send. */
export function sendErrorText(t, res) {
  switch (res?.code) {
    case 'PARTS_NOT_PRICED':
      return {
        title: t('estimates.err_parts_title', 'The Store has not priced every part yet'),
        body: `${res.message || ''} ${t('estimates.err_parts_body_cat', 'Each part needs a price, or “not available”, in every category the customer asked for before they can see it.')}`.trim(),
      };
    case 'LABOUR_NOT_PRICED':
      return {
        title: t('estimates.err_labour_title', 'Labour has no price yet'),
        body: t('estimates.err_labour_body', 'The Service Advisor has to enter the labour price before this can go to the customer. Use Edit to add it.'),
      };
    case 'EMAIL_FAILED':
      // The estimate is marked sent and its link is live; only the e-mail failed.
      return {
        title: t('estimates.err_email_failed_title', 'The e-mail was not sent'),
        body: res.message,
        noEmail: true,
        link: res.approval_url,
      };
    case 'MANAGER_APPROVAL_REQUIRED':
      return {
        title: t('estimates.err_signoff_title', 'Waiting for a manager’s approval'),
        body: res.message || t('estimates.held_msg', 'Saved. A supervisor or workshop manager has to approve it before it goes to the customer — they have been notified.'),
        held: true,
      };
    default:
      if (res?.status === 400 && /email/i.test(res?.message || '')) {
        return {
          title: t('estimates.err_no_email_title', 'No email address for this customer'),
          body: t('estimates.err_no_email_body', 'Type an email address, or send it by WhatsApp instead.'),
          noEmail: true,
        };
      }
      return { title: t('estimates.err_send_title', 'It was not sent'), body: res?.message || t('estimates.err_try_again', 'Please try again.') };
  }
}

/**
 * The send form. `data` is the GET /estimates/:id payload. Calls
 * onDone({ ...serverResponse, channel }) on success, or onDone({ held: true,
 * message }) when the estimate is waiting for a manager's sign-off.
 */
export function SendEstimatePanel({ data, onDone, onCancel, cancelLabel }) {
  const { t } = useTranslation();
  const e = data.estimate;
  const lines = useMemo(() => data.lines || [], [data.lines]);
  const pref = useMemo(() => preferenceOf(e), [e]);
  const summary = useMemo(() => summarisePricing(lines, pref), [lines, pref]);
  const parts = lines.filter(l => l.line_type === 'parts');
  const vat = Number(e.vat_rate ?? 5);

  const [channel, setChannel] = useState(() => (!e.customer_email && e.customer_phone ? 'whatsapp' : 'email'));
  const [email, setEmail] = useState(e.customer_email || '');
  const [phone, setPhone] = useState(e.customer_phone || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const needsSignOff = !!e.needs_internal_approval && !data.can_approve;
  const blocked = summary.unpricedParts > 0 || summary.unpricedLabour > 0;
  // Parts with nothing on offer in the preference and no alternative: the customer can only reject them.
  const unavailable = parts.filter(l => hasCategoryPricing(l) && !partUnpriced(l, pref)
    && !partOptions(l, pref).requested.some(o => o.usable) && !partOptions(l, pref).alternative).length;

  async function send() {
    setBusy(true); setErr(null);
    // Opened inside the click so a popup blocker lets it through; pointed at
    // WhatsApp once the server has built the message.
    let win = null;
    if (channel === 'whatsapp' && !needsSignOff) { try { win = window.open('', '_blank'); } catch { win = null; } }
    try {
      // The estimate goes out in its parts preference (set when it was raised; Edit changes it).
      const res = await api.post(`/estimates/${e.id}/send`, {
        channel,
        email: channel === 'email' ? (email.trim() || undefined) : undefined,
        phone: channel === 'whatsapp' ? (phone.trim() || undefined) : undefined,
      });
      if (res.success) {
        if (res.whatsapp_url) {
          if (win && !win.closed) { try { win.opener = null; } catch { /* ignore */ } win.location.href = res.whatsapp_url; }
          else window.open(res.whatsapp_url, '_blank', 'noopener');
        } else if (win) win.close();
        onDone?.({ ...res, channel });
        return;
      }
      if (win) win.close();
      const info = sendErrorText(t, res);
      if (info.held) { onDone?.({ held: true, message: info.body }); return; }
      setErr(info);
    } catch {
      if (win) win.close();
      setErr({ title: t('estimates.err_send_title', 'It was not sent'), body: t('estimates.err_network', 'Network error — please try again.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={sp.wrap}>
      {needsSignOff && (
        <div style={{ ...sp.note, ...sp.noteHold }}>
          <WarningCircle width={16} height={16} style={{ flexShrink: 0 }} />
          <span>{t('estimates.send_needs_signoff', 'This is an external customer, so a supervisor or workshop manager must approve it first. Sending now asks them to approve — it will not reach the customer yet.')}</span>
        </div>
      )}
      {summary.unpricedParts > 0 && (
        <div style={{ ...sp.note, ...sp.noteBad }}>
          <Label width={16} height={16} style={{ flexShrink: 0 }} />
          <span>{t('estimates.send_parts_waiting_cat', '{{n}} part line(s) are still waiting for the Store’s price ({{cats}}).', { n: summary.unpricedParts, cats: categoryWords(t, pref) })}</span>
        </div>
      )}
      {summary.unpricedLabour > 0 && (
        <div style={{ ...sp.note, ...sp.noteBad }}>
          <Wrench width={16} height={16} style={{ flexShrink: 0 }} />
          <span>{t('estimates.send_labour_waiting', 'Labour has no price yet — the Service Advisor prices it with Edit.')}</span>
        </div>
      )}

      {parts.length > 0 && (
        <>
          <div style={sp.h}>{t('estimates.send_pref', 'Customer’s parts preference')}</div>
          <div style={sp.formats}>
            {pref.map(c => (
              <div key={c} style={sp.fmt}>
                <span style={sp.fmtLabel}>{categoryLabel(t, c)}</span>
                <span style={sp.fmtSub}>{pref.length > 1 ? t('estimates.send_cat_sub_choose', 'The customer chooses per part') : t('estimates.send_cat_sub_only', 'Every part in this category')}</span>
                <span style={sp.fmtAmt}>{money(summary.totals[c])}</span>
              </div>
            ))}
          </div>
          {summary.alternatives.length > 0 && (
            <p style={sp.altNote}>
              {t('estimates.send_alternatives', '{{n}} part(s) not available as asked: the Store offered an alternative. The customer sees it as “Alternative — needs your approval”; it is in no total until they choose it.', { n: summary.alternatives.length })}
            </p>
          )}
          {unavailable > 0 && (
            <p style={sp.altNote}>{t('estimates.send_unavailable', '{{n}} part(s) are not available in any category asked for — the customer can only reject them.', { n: unavailable })}</p>
          )}
          <p style={sp.vatNote}>{t('estimates.excl_vat_note_cat', 'Amounts before {{v}}% VAT. A part not available in a category is left out of that total — it is never swapped for another type.', { v: vat })} {t('estimates.send_pref_edit', 'To change the preference, use Edit.')}</p>
        </>
      )}

      <div style={sp.h}>{t('estimates.send_by', 'Send by')}</div>
      <div style={sp.channels}>
        <button type="button" style={{ ...sp.chan, ...(channel === 'email' ? sp.chanOn : null) }} onClick={() => { setChannel('email'); setErr(null); }}>
          <Mail width={16} height={16} /> {t('estimates.email', 'Email')}
        </button>
        <button type="button" style={{ ...sp.chan, ...(channel === 'whatsapp' ? sp.chanWa : null) }} onClick={() => { setChannel('whatsapp'); setErr(null); }}>
          <Whatsapp width={16} height={16} /> {t('estimates.whatsapp', 'WhatsApp')}
        </button>
      </div>
      {channel === 'email' ? (
        <input style={st.input} type="email" value={email} onChange={ev => setEmail(ev.target.value)}
          placeholder={t('estimates.email_ph', 'Customer email (blank = the one on file)')} />
      ) : (
        <input style={st.input} type="tel" value={phone} onChange={ev => setPhone(ev.target.value)}
          placeholder={t('estimates.phone_ph', 'Customer mobile (blank = the one on file)')} />
      )}

      {err && (
        <div style={{ ...sp.note, ...sp.noteBad, marginTop: 12 }}>
          <WarningCircle width={16} height={16} style={{ flexShrink: 0 }} />
          <span>
            <b>{err.title}.</b> {err.body}
            {err.noEmail && (
              <button type="button" style={sp.inlineBtn} onClick={() => { setChannel('whatsapp'); setErr(null); }}>
                {t('estimates.use_whatsapp', 'Send by WhatsApp instead')}
              </button>
            )}
            {err.link && <CopyButton text={err.link} label={t('estimates.copy_link', 'Copy link')} style={sp.inlineBtn} />}
          </span>
        </div>
      )}

      <div style={sp.actions}>
        {onCancel && <button type="button" style={st.ghostBtn} onClick={onCancel}>{cancelLabel || t('estimates.cancel', 'Cancel')}</button>}
        <button type="button" style={{ ...st.primaryBtn, opacity: busy || blocked ? 0.6 : 1, cursor: busy || blocked ? 'not-allowed' : 'pointer', ...(channel === 'whatsapp' && !needsSignOff ? sp.waBtn : null) }}
          disabled={busy || blocked} onClick={send}>
          {channel === 'whatsapp' ? <Whatsapp width={15} height={15} /> : <SendMail width={15} height={15} />}
          {busy ? t('estimates.sending', 'Sending…')
            : needsSignOff ? t('estimates.ask_approval', 'Ask for approval')
            : e.needs_internal_approval ? t('estimates.approve_and_send', 'Approve & send')
            : channel === 'whatsapp' ? t('estimates.send_whatsapp', 'Open in WhatsApp')
            : t('estimates.send_email', 'Send email')}
        </button>
      </div>
    </div>
  );
}

/** Small copy-to-clipboard button, shared with the Estimates page. */
export function CopyButton({ text, label, style, className }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" style={style} className={className} onClick={() => {
      navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }).catch(() => {});
    }}>
      {done ? <Check width={14} height={14} /> : <Copy width={14} height={14} />} {label}
    </button>
  );
}

function Field({ label, children }) {
  return <label style={st.field}><span style={st.fieldLabel}>{label}</span>{children}</label>;
}
function Row({ label, value, strong, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 13.5, fontWeight: strong ? 800 : 500, color: strong ? NAVY : muted ? '#94a3b8' : '#475569' }}>
      <span>{label}</span><span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

const st = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16 },
  modal: { background: '#fff', borderRadius: 18, width: '100%', maxWidth: 820, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '20px 24px 16px', borderBottom: '1px solid #eef1f5' },
  title: { margin: 0, fontSize: 20, fontWeight: 800, color: NAVY },
  subtitle: { margin: '4px 0 0', fontSize: 13, color: '#64748b', maxWidth: 560, lineHeight: 1.45 },
  woChip: { display: 'inline-block', margin: '6px 0 0', fontSize: 12.5, fontWeight: 700, color: '#9a3412', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 999, padding: '3px 10px' },
  closeBtn: { background: '#f1f5f9', border: 'none', borderRadius: 10, width: 32, height: 32, cursor: 'pointer', color: '#475569', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  body: { padding: '18px 24px', overflowY: 'auto', flex: 1 },
  error: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14, fontWeight: 500 },
  warn: { display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fdf4e5', border: '1px solid #f3d9a8', color: '#92400e', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14, lineHeight: 1.45 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 16 },
  lockedBox: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, alignItems: 'end', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', marginBottom: 16 },
  lockedVal: { fontSize: 14.5, fontWeight: 700, color: '#1e293b', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  fieldLabel: { fontSize: 12, fontWeight: 700, color: '#475569' },
  input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, outline: 'none', color: '#1e293b', background: '#fff', fontFamily: 'inherit', minWidth: 0, boxSizing: 'border-box' },
  prefBox: { border: '1.5px solid #fed7aa', background: '#fffaf5', borderRadius: 14, padding: '12px 14px', marginBottom: 14 },
  prefHead: { display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 },
  prefHint: { fontSize: 12, color: '#64748b', lineHeight: 1.4 },
  prefChips: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  prefChip: { display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '6px 14px', borderRadius: 999, borderWidth: 1.5, borderStyle: 'solid', borderColor: '#e2e8f0', background: '#fff', color: '#475569', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  prefChipOn: { borderColor: ORANGE, background: '#fff7ed', color: '#c2410c' },
  jobCard: { border: '1.5px solid #e2e8f0', borderRadius: 14, padding: '12px 14px 14px', marginBottom: 12, background: '#fff' },
  jobHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  jobNo: { fontSize: 11, fontWeight: 800, color: '#fff', background: NAVY, borderRadius: 999, padding: '3px 10px', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 },
  sectionLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: NAVY, fontWeight: 800, marginBottom: 8, flexWrap: 'wrap' },
  storeTag: { display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'none', letterSpacing: 0, fontSize: 11.5, fontWeight: 700, color: '#b45309', background: '#fdf4e5', borderRadius: 999, padding: '2px 9px' },
  hintChip: { fontSize: 12, fontWeight: 600, color: '#64748b', background: '#f1f5f9', borderRadius: 8, padding: '8px 10px', whiteSpace: 'nowrap' },
  lineRow: { display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' },
  partBlock: { marginBottom: 8, padding: '8px', background: '#fafbfc', border: '1px solid #eef1f5', borderRadius: 10 },
  priceRow: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e2e8f0' },
  priceReadonly: { marginTop: 6, fontSize: 12.5, color: '#475569' },
  priceCell: { display: 'flex', alignItems: 'center', gap: 8 },
  priceLbl: { fontSize: 12, fontWeight: 700, color: '#475569', minWidth: 78 },
  naToggle: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: '#64748b', cursor: 'pointer' },
  lineDel: { width: 32, height: 32, borderRadius: 8, border: 'none', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  addLineBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, border: '1.5px dashed #cbd5e1', background: '#f8fafc', color: NAVY, borderRadius: 10, padding: '7px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 },
  addJobBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', border: `1.5px dashed ${ORANGE}`, background: '#fff7ed', color: '#c2410c', borderRadius: 12, padding: '11px 12px', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, marginBottom: 14 },
  jobFoot: { display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 10, paddingTop: 8, borderTop: '1px solid #f1f5f9', fontSize: 12.5, color: '#64748b' },
  note: { fontSize: 12.5, color: '#64748b', margin: '0 0 12px' },
  waitNote: { display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 0', fontSize: 12.5, color: '#b45309', fontWeight: 600 },
  totalsBox: { background: '#f8fafc', borderRadius: 12, padding: '14px 16px', marginTop: 4 },
  totalDivider: { height: 1, background: '#e2e8f0', margin: '6px 0' },
  footer: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '14px 24px', borderTop: '1px solid #eef1f5' },
  ghostBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit' },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 20px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${ORANGE},#ea580c)`, color: '#fff', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, boxShadow: '0 4px 14px rgba(249,115,22,0.3)', fontFamily: 'inherit' },
  resultBox: { background: '#ecfdf3', border: '1px solid #bbf7d0', borderRadius: 12, padding: '20px 22px', textAlign: 'center', fontSize: 14, color: '#334155', lineHeight: 1.5 },
  resultTitle: { fontSize: 16, fontWeight: 800, color: '#15803d', marginBottom: 8 },
  approvalLink: { fontSize: 12, color: '#64748b', wordBreak: 'break-all', marginTop: 8 },
  waLink: { display: 'inline-flex', alignItems: 'center', gap: 6, color: '#128c4b', fontWeight: 700 },
  savedStrip: { display: 'flex', alignItems: 'center', gap: 8, background: '#ecfdf3', border: '1px solid #bbf7d0', color: '#15803d', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, fontWeight: 700, marginBottom: 14 },
};

// SendEstimatePanel
const sp = {
  wrap: { display: 'flex', flexDirection: 'column' },
  h: { fontSize: 11.5, fontWeight: 800, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '6px 0 8px' },
  formats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 },
  fmt: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'start', padding: '11px 12px', borderRadius: 12, border: `1.5px solid ${ORANGE}`, background: '#fff7ed' },
  fmtLabel: { fontSize: 14.5, fontWeight: 800, color: '#1e293b' },
  fmtSub: { fontSize: 12, color: '#64748b', lineHeight: 1.35 },
  fmtAmt: { fontSize: 12.5, fontWeight: 700, color: NAVY, marginTop: 4, fontVariantNumeric: 'tabular-nums' },
  altNote: { fontSize: 12.5, color: '#92400e', background: '#fdf4e5', border: '1px solid #f3d9a8', borderRadius: 10, padding: '8px 10px', margin: '8px 0 0', lineHeight: 1.45 },
  vatNote: { fontSize: 11.5, color: '#94a3b8', margin: '6px 0 8px' },
  channels: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 },
  chan: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#334155', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  chanOn: { borderColor: ORANGE, background: '#fff7ed', color: '#c2410c' },
  chanWa: { borderColor: '#25d366', background: '#ecfdf3', color: '#128c4b' },
  note: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.45, marginBottom: 10, border: '1px solid' },
  noteHold: { background: '#fdf4e5', borderColor: '#f3d9a8', color: '#92400e' },
  noteBad: { background: '#fdecec', borderColor: '#f4c4c4', color: '#b2242b' },
  inlineBtn: { marginLeft: 6, border: 'none', background: 'none', padding: 0, color: '#128c4b', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 16 },
  waBtn: { background: 'linear-gradient(135deg,#25d366,#128c4b)', boxShadow: '0 4px 14px rgba(18,140,75,0.25)' },
};
