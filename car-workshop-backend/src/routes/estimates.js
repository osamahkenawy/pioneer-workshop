/**
 * ═══════════════════════════════════════════════════════════════
 *  Service Estimates — SOW Section B3
 *  Covers: req 69 (estimate creation with line-level payer),
 *          req 70 (operations master defaults),
 *          req 71 (mixed-payer job support),
 *          req 72 (pre-approved bundles → direct conversion)
 *
 *  Client decisions (3 Nov 2026):
 *   - An estimate is raised for a work order once its technical
 *     inspection is completed (409 TECHNICAL_INSPECTION_REQUIRED) — a
 *     quote from an enquiry or for a customer alone has none, so it is
 *     refused too.
 *   - Main (EST-…) and supplementary (SEST-…) estimates: extra work found
 *     later on the same job goes on a supplementary estimate, linked to the
 *     decided main one, at a fixed cost and approved with the customer's
 *     consent (estimate_consents); its approved lines join the same job card.
 *   - The customer decides several lines at once (POST /:token/decide-bulk).
 * ═══════════════════════════════════════════════════════════════
 */
import express from 'express';
import crypto from 'crypto';
import pool, { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { recalcWorkOrder } from '../lib/job-card-billing.js';
import { recordCustomerApproval, canApproveEstimates, isExternalEstimate, estimateApprovers, ESTIMATE_APPROVAL_REQUIRED } from '../lib/job-card-approval.js';
import { serviceStatusToken } from '../lib/tokens.js';
import { logAudit } from '../lib/audit.js';
import { customerAppBase } from '../lib/customer-link.js';
import { sendNotificationEmail } from '../lib/email.js';
import { createInAppNotification } from '../lib/notify.js';
import { estimateApprovalLimiter } from '../lib/rate-limits.js';
import {
  notifyGroups, onWorkApproved, summariseEstimatePricing, PART_CATEGORIES, PART_CATEGORY_LABEL, categoryColumns,
  partsPreference, formatOfPreference, partOptions, effectivePartOption, partLineUnpriced, hasCategoryPricing, UNPRICED_PART_SQL,
} from '../lib/workflow.js';
import { jobCardGate, openJobCardIfReady } from '../lib/physical-inspection.js';
import { can, requireCapability, isManagerRole } from '../lib/roles.js';
import { applyStatusChange } from './work-orders.js';
import { createTask, closeTasks, markEnquiryQuoted, markEnquiryConverted, snapshotIntakeClass, closeEnquiryWorkOrder } from '../lib/crm-cycle.js';
import { stripMarkup } from '../lib/sanitize.js';

const router = express.Router();
router.use(authMiddleware);

// Anonymous, unauthenticated — reachable by anyone with the emailed link.
const publicRouter = express.Router();

/** EST-20261112-4821 for a main estimate, SEST-20261112-4821 for a supplementary one. */
function genEstimateNumber(kind = 'main') {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `${kind === 'supplementary' ? 'SEST' : 'EST'}-${stamp}-${rand}`;
}

// ─── Compute financial totals from lines ──────────────────────
function computeTotals(lines, vatRate = 5) {
  let subtotal_labour = 0, subtotal_parts = 0, subtotal_sublet = 0;
  for (const l of lines) {
    const lineTotal = parseFloat(l.quantity || 1) * parseFloat(l.unit_price || 0) * (1 - parseFloat(l.discount_pct || 0) / 100);
    if (l.line_type === 'labour') subtotal_labour += lineTotal;
    else if (l.line_type === 'parts' || l.line_type === 'consumable') subtotal_parts += lineTotal;
    else if (l.line_type === 'sublet') subtotal_sublet += lineTotal;
  }
  const subtotal = subtotal_labour + subtotal_parts + subtotal_sublet;
  const vat_amount = parseFloat((subtotal * vatRate / 100).toFixed(2));
  const total_amount = parseFloat((subtotal + vat_amount).toFixed(2));
  return {
    subtotal_labour: parseFloat(subtotal_labour.toFixed(2)),
    subtotal_parts:  parseFloat(subtotal_parts.toFixed(2)),
    subtotal_sublet: parseFloat(subtotal_sublet.toFixed(2)),
    discount_amount: 0,
    vat_rate:        vatRate,
    vat_amount,
    total_amount,
  };
}

// ─── Step 5: part pricing per category (Genuine / After-Market / Used) ──
// The Storekeeper prices each parts line in every category of the
// customer's parts preference — available or not, price, expected delivery
// — and may offer an alternative category when a requested one is not
// available (lib/workflow.js has the rules); the Service Advisor prices
// labour. unit_price stays the price the line currently counts at, so
// totals, the job card and the invoice keep reading one number: the
// customer's choice (part_option) if made, else the first priced, available
// category of the preference. Nothing falls back to a category the customer
// did not ask for: such a line counts at 0 until they approve the
// alternative.
const numOrNull = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
const flagOrNull = v => (v === null || v === undefined || v === '' ? null : (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0);
const dateOrNull = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10)) && !Number.isNaN(Date.parse(v.slice(0, 10))) ? v.slice(0, 10) : null);
// Format 1 = Genuine, 2 = After-Market, 3 = both — the preference before it
// had Used; still accepted by POST /:id/send and kept on the estimate.
const FORMAT_PREFERENCE = { genuine: ['genuine'], after_market: ['after_market'], both: ['genuine', 'after_market'] };
const DEFAULT_PREFERENCE = ['genuine', 'after_market'];
// Every per-category column of an estimate line, plus the alternative.
const CATEGORY_FIELDS = PART_CATEGORIES.flatMap(c => Object.values(categoryColumns(c)));
const ALTERNATIVE_FIELDS = ['alternative_option', 'alternative_for', 'alternative_approved'];
/** A part number as sent: trimmed, at most 100 characters; blank = none. */
const partNoOrNull = v => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, 100));

/** A parts preference from a request body (array or 'genuine,used'): the
 *  ordered list, null when not sent, [] when empty or not a category. */
function preferenceFromBody(v) {
  if (v === undefined || v === null || v === '') return null;
  const list = (Array.isArray(v) ? v : String(v).split(',')).map(s => String(s).trim()).filter(Boolean);
  if (!list.length || list.some(c => !PART_CATEGORIES.includes(c))) return [];
  return PART_CATEGORIES.filter(c => list.includes(c));
}
const PREFERENCE_REQUIRED = 'Choose the customer’s parts preference: Genuine, After-Market and/or Used (at least one).';

/** "Genuine and Used" */
function categoryWords(pref) {
  const names = pref.map(c => PART_CATEGORY_LABEL[c]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '';
}

/**
 * An alternative stands only while a requested category is not available
 * and the offered category is outside the preference. Otherwise its flags
 * are cleared (and, when the category is not asked for, its prices).
 */
function tidyAlternative(row, pref) {
  const alt = row.alternative_option;
  if (!alt) return row;
  const anyUnavailable = pref.some(c => Number(row[categoryColumns(c).available]) === 0 && row[categoryColumns(c).available] !== null);
  if (pref.includes(alt) || !anyUnavailable || !PART_CATEGORIES.includes(alt)) {
    if (!pref.includes(alt) && PART_CATEGORIES.includes(alt)) for (const f of Object.values(categoryColumns(alt))) row[f] = null;
    for (const f of ALTERNATIVE_FIELDS) row[f] = null;
  } else if (!pref.includes(row.alternative_for) || Number(row[categoryColumns(row.alternative_for).available]) !== 0) {
    row.alternative_for = pref.find(c => Number(row[categoryColumns(c).available]) === 0 && row[categoryColumns(c).available] !== null);
  }
  return row;
}

/** What a part line counts at now: the effective option's price, 0 when it has category prices but nothing on offer, else (a single-price line) `fallback`. */
function countedPartPrice(row, pref, fallback) {
  const eff = effectivePartOption(row, pref);
  if (eff) return eff.price;
  return hasCategoryPricing(row) ? 0 : fallback;
}

/**
 * Insert estimate lines. Only the Storekeeper (or a manager) may set part
 * prices and only the Service Advisor (or a manager) labour prices — anyone
 * else's values are replaced by what was already on the line (matched by
 * id), or left unpriced for a new line. Part prices sent here are taken for
 * the categories of the preference only; an alternative is offered through
 * PATCH /:id/lines/:lineId/pricing and carried over on an edit.
 */
async function insertEstimateLines(estimateId, workshopId, lines, { user, pref = DEFAULT_PREFERENCE, existingById = new Map() }) {
  const mayPriceParts = can(user, 'estimate.price_parts');
  const mayPriceLabour = can(user, 'estimate.raise');
  const emptyPricing = () => Object.fromEntries([...CATEGORY_FIELDS, ...ALTERNATIVE_FIELDS, 'priced_by', 'priced_at'].map(f => [f, null]));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const old = l.id ? existingById.get(Number(l.id)) : null;
    const type = ['labour', 'parts', 'sublet', 'consumable', 'discount'].includes(l.line_type) ? l.line_type : 'labour';
    let unitPrice = Number(l.unit_price) || 0;
    let pricing = emptyPricing();
    let partOption = PART_CATEGORIES.includes(l.part_option) ? l.part_option : (old?.part_option || null);
    if (type === 'parts') {
      if (old) {
        for (const f of Object.keys(pricing)) pricing[f] = old[f] ?? null;
        if (!mayPriceParts) unitPrice = Number(old.unit_price) || 0;
      } else if (!mayPriceParts) {
        unitPrice = 0; // waits for the Storekeeper
      }
      if (mayPriceParts && CATEGORY_FIELDS.some(f => l[f] !== undefined)) {
        // Per category sent; a category (or a delivery date) not sent keeps its value.
        for (const c of pref) {
          const col = categoryColumns(c);
          if (l[col.price] === undefined && l[col.available] === undefined) continue;
          const price = numOrNull(l[col.price]);
          const available = flagOrNull(l[col.available]) ?? (price != null ? 1 : null);
          pricing[col.price] = available === 0 ? null : price;
          pricing[col.available] = available;
          pricing[col.expected] = available === 0 ? null : (l[col.expected] !== undefined ? dateOrNull(l[col.expected]) : pricing[col.expected]);
          pricing[col.partNumber] = available === 0 ? null : (l[col.partNumber] !== undefined ? partNoOrNull(l[col.partNumber]) : pricing[col.partNumber]);
        }
        pricing.priced_by = user?.id || null; pricing.priced_at = new Date();
      }
      tidyAlternative(pricing, pref);
      unitPrice = countedPartPrice({ ...pricing, part_option: partOption }, pref, unitPrice);
    } else if (type === 'labour' && !mayPriceLabour) {
      // Labour is priced by the Service Advisor (Step 5).
      unitPrice = old ? (Number(old.unit_price) || 0) : 0;
    }
    if (type !== 'parts') partOption = null;
    await execute(
      `INSERT INTO estimate_lines
         (estimate_id, workshop_id, line_type, operation_id, description, job_name,
          part_number, quantity, unit_cost, unit_price,
          genuine_price, genuine_available, genuine_expected_date,
          aftermarket_price, aftermarket_available, aftermarket_expected_date,
          used_price, used_available, used_expected_date,
          genuine_part_number, aftermarket_part_number, used_part_number,
          part_option, alternative_option, alternative_for, alternative_approved, priced_by, priced_at, discount_pct,
          payer_direction, insurance_ref, warranty_ref, urgency, customer_status, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [estimateId, workshopId, type, l.operation_id || null,
       l.description, (l.job_name ? String(l.job_name).trim().slice(0, 200) : null) || null,
       l.part_number || null, parseFloat(l.quantity || 1),
       parseFloat(l.unit_cost || 0), unitPrice,
       pricing.genuine_price, pricing.genuine_available, pricing.genuine_expected_date,
       pricing.aftermarket_price, pricing.aftermarket_available, pricing.aftermarket_expected_date,
       pricing.used_price, pricing.used_available, pricing.used_expected_date,
       pricing.genuine_part_number, pricing.aftermarket_part_number, pricing.used_part_number,
       partOption, pricing.alternative_option, pricing.alternative_for, pricing.alternative_approved,
       pricing.priced_by, pricing.priced_at,
       parseFloat(l.discount_pct || 0), l.payer_direction || 'customer',
       l.insurance_ref || null, l.warranty_ref || null,
       // urgency was never in this column list, so every line silently took
       // the table's DEFAULT 'now' regardless of what was actually passed.
       ['now', 'soon', 'can_wait'].includes(l.urgency) ? l.urgency : 'now',
       l.customer_status || old?.customer_status || 'pending', i]
    );
  }
}

/** Recompute an estimate's stored totals from its lines' current unit prices. */
async function recalcEstimateTotals(estimateId) {
  const [est] = await query('SELECT vat_rate FROM service_estimates WHERE id = ?', [estimateId]);
  const lines = await query('SELECT line_type, quantity, unit_price, discount_pct FROM estimate_lines WHERE estimate_id = ?', [estimateId]);
  const t = computeTotals(lines, parseFloat(est?.vat_rate ?? 5));
  await execute(
    `UPDATE service_estimates SET subtotal_labour = ?, subtotal_parts = ?, subtotal_sublet = ?, vat_amount = ?, total_amount = ? WHERE id = ?`,
    [t.subtotal_labour, t.subtotal_parts, t.subtotal_sublet, t.vat_amount, t.total_amount, estimateId]
  );
  return t;
}

/** Re-price every parts line for the preference (and the customer's choices). */
async function applyPreferencePrices(estimateId, pref) {
  const lines = await query("SELECT * FROM estimate_lines WHERE estimate_id = ? AND line_type = 'parts'", [estimateId]);
  for (const l of lines) {
    if (!hasCategoryPricing(l)) continue; // a single-price line keeps its price
    tidyAlternative(l, pref);
    await execute(
      'UPDATE estimate_lines SET unit_price = ?, alternative_option = ?, alternative_for = ?, alternative_approved = ? WHERE id = ?',
      [countedPartPrice(l, pref, 0), l.alternative_option, l.alternative_for, l.alternative_approved, l.id]);
  }
  return recalcEstimateTotals(estimateId);
}

/** The estimate's lines as GET /:id and the public page send them: each part line with its `options`. */
function withPartOptions(lines, pref) {
  return lines.map(l => {
    if (l.line_type !== 'parts' || !hasCategoryPricing(l)) return l;
    const { requested, alternative } = partOptions(l, pref);
    const eff = effectivePartOption(l, pref);
    return { ...l, options: { requested, alternative, counted: eff ? eff.option : null } };
  });
}

// customer_type (retail_cash/credit/insurance/internal_fleet, on the
// estimate) and payer_type (self_pay/insurance/corporate/fleet, on the work
// order) are two enums for the same underlying idea, named differently on
// each table because they were built at different times. Without this map
// every job card created from an estimate would silently default to
// self_pay regardless of who is actually paying.
const CUSTOMER_TYPE_TO_PAYER_TYPE = {
  retail_cash: 'self_pay',
  // A credit account is an outside fleet billed on account — the same payer
  // the intake gives an External · Fleet job (C5).
  credit: 'fleet',
  insurance: 'insurance',
  internal_fleet: 'fleet',
};

const CUSTOMER_TYPES = Object.keys(CUSTOMER_TYPE_TO_PAYER_TYPE);
// 'internal_fleet' is the only internal value the column has; it stands for
// every internal account (Fleet, Insurance, Asset), so it reads 'Internal'.
const CUSTOMER_TYPE_LABEL = {
  retail_cash: 'Retail / cash', credit: 'Credit account', insurance: 'Insurance', internal_fleet: 'Internal',
};

/**
 * The account type an estimate gets "from the job card": the job's Step 1
 * classification — internal (any subcategory) → internal_fleet, an outside
 * fleet → credit, an outside insurer → insurance, a walk-in → retail_cash.
 */
function accountTypeForClass(customerClass, subcategory) {
  if (customerClass === 'internal') return 'internal_fleet';
  if (subcategory === 'fleet') return 'credit';
  if (subcategory === 'insurance') return 'insurance';
  return 'retail_cash';
}

// ─── Main and supplementary estimates (client decisions, 3 Nov 2026) ──
// The estimate stage follows the technical inspection: an estimate is
// raised for a work order once its technical inspection (Step 4,
// routes/technical-inspections.js) is completed. The work order's estimate
// is its MAIN estimate (EST-…). Extra work found later on the same job goes
// on a SUPPLEMENTARY estimate (SEST-…), raised once the customer has decided
// the main one and linked to it (parent_estimate_id). It carries a FIXED
// COST: its parts are priced by the Store in one part type only, so every
// line has one firm price — no choice between types, no alternative, nothing
// "not available" when it goes out — and the customer approves it with their
// consent (estimate_consents: the statement, the cost, their name, when, the
// IP). Its approved lines join the same job card, like the main estimate's.
const TECHNICAL_INSPECTION_REQUIRED = 'TECHNICAL_INSPECTION_REQUIRED';
const DECIDED_STATUSES = ['approved', 'partially_approved', 'converted'];
const OPEN_STATUSES = ['draft', 'sent_to_customer'];
const KIND_LABEL = { main: 'Main estimate', supplementary: 'Supplementary estimate' };
const isSupplementary = est => est?.kind === 'supplementary';
const r2 = n => Math.round(Number(n || 0) * 100) / 100;

/** The work order's technical inspection: { id, status, completed_at } or null. */
async function technicalInspectionOf(workOrderId, workshopId) {
  const [ti] = await query(
    'SELECT id, status, completed_at FROM technical_inspections WHERE work_order_id = ? AND workshop_id = ?',
    [workOrderId, workshopId]);
  return ti || null;
}

/**
 * A work order's estimates: its main estimate (the latest not rejected or
 * expired — an estimate converted before 'kind' existed counts as main),
 * its supplementary ones (newest first) and the one still open, if any.
 */
async function jobEstimates(workOrderId, workshopId) {
  const rows = await query(
    `SELECT id, estimate_number, kind, status, parent_estimate_id, parts_preference, estimate_format, customer_type,
            total_amount, intake_work_order_id, work_order_id
       FROM service_estimates
      WHERE workshop_id = ? AND (intake_work_order_id = ? OR work_order_id = ?)
      ORDER BY id DESC`, [workshopId, workOrderId, workOrderId]);
  const main = rows.find(r => !isSupplementary(r) && !['rejected', 'expired'].includes(r.status)) || null;
  const supplementaries = rows.filter(isSupplementary);
  return { main, supplementaries, openSupplementary: supplementaries.find(r => OPEN_STATUSES.includes(r.status)) || null };
}

/** The refusal for an estimate with no work order: a quote from an enquiry, or for a customer alone. */
function noWorkOrderRefusal(fromEnquiry) {
  return {
    status: 409, code: TECHNICAL_INSPECTION_REQUIRED,
    message: fromEnquiry
      ? 'A quote is no longer raised from an enquiry: the estimate follows the technical inspection. Open the work order for this car, do the physical and technical inspections, then raise the estimate from it.'
      : 'An estimate is raised for a work order once its technical inspection is completed. Choose the work order, then raise the estimate from it.',
  };
}

/**
 * Whether an estimate can be raised for the work order `wo` now, and of
 * which kind (`wanted`: 'main' or 'supplementary'; null: whichever comes
 * next). { ok: true, kind, main, technical } or { ok: false, status, code,
 * message, … } — the same answer for POST / and GET /raise-check, so the
 * form can say it up front.
 */
async function raiseCheck(wo, workshopId, wanted = null) {
  if (['completed', 'cancelled'].includes(wo.status)) {
    return { ok: false, status: 409, code: 'JOB_CLOSED', message: `That job is ${wo.status}.` };
  }
  // D2: the physical inspection comes first for an external customer — the
  // main job card opens when they acknowledge it. Internal customers' job
  // cards open with the job.
  const gate = await jobCardGate({ workOrderId: wo.id, workshopId });
  if (!gate.internal && !gate.jobCardOpen) {
    return { ok: false, status: 409, code: 'PHYSICAL_INSPECTION_REQUIRED',
      message: 'Do the physical inspection with the customer first — the job card opens when they acknowledge it.' };
  }
  // The estimate follows the completed technical inspection.
  const technical = await technicalInspectionOf(wo.id, workshopId);
  if (technical?.status !== 'completed') {
    return { ok: false, status: 409, code: TECHNICAL_INSPECTION_REQUIRED, technical_inspection: technical,
      message: technical
        ? `The technical inspection of ${wo.work_order_number || 'this work order'} is not completed yet — the estimate is raised once the Supervisor / Workshop Foreman completes it.`
        : `The technical inspection of ${wo.work_order_number || 'this work order'} has not been done — the Supervisor / Workshop Foreman inspects the car and completes the technical report first; the estimate is raised from it.` };
  }
  const { main, openSupplementary } = await jobEstimates(wo.id, workshopId);
  const mainDecided = !!main && DECIDED_STATUSES.includes(main.status);
  const kind = wanted || (mainDecided ? 'supplementary' : 'main');
  const base = { main, technical, kind };
  if (kind === 'main') {
    if (main && mainDecided) {
      return { ...base, ok: false, status: 409, code: 'MAIN_ESTIMATE_DECIDED',
        message: `${main.estimate_number} is this job's main estimate and the customer has decided it. Extra work goes on a supplementary estimate, at a fixed cost.` };
    }
    if (main) return { ...base, ok: false, status: 409, code: 'ESTIMATE_OPEN', message: `Estimate ${main.estimate_number} is already open for this job — edit that one.` };
    return { ...base, ok: true };
  }
  if (!main) {
    return { ...base, ok: false, status: 409, code: 'MAIN_ESTIMATE_REQUIRED',
      message: 'A supplementary estimate follows the main estimate — raise the main estimate for this job first.' };
  }
  if (!mainDecided) {
    return { ...base, ok: false, status: 409, code: 'MAIN_ESTIMATE_NOT_DECIDED',
      message: `A supplementary estimate is raised once the customer has decided the main estimate ${main.estimate_number} (it is ${String(main.status).replace(/_/g, ' ')}).` };
  }
  if (openSupplementary) {
    return { ...base, ok: false, status: 409, code: 'SUPPLEMENTARY_OPEN', supplementary: openSupplementary,
      message: `Supplementary estimate ${openSupplementary.estimate_number} is still open for this job — edit that one, or wait for the customer's decision.` };
  }
  return { ...base, ok: true };
}

/** The part type a supplementary estimate is priced in unless the advisor picks another: the one the customer approved most on the main estimate, else the first of its preference. */
async function defaultFixedType(main) {
  const [top] = await query(
    `SELECT part_option, COUNT(*) AS n FROM estimate_lines
      WHERE estimate_id = ? AND line_type = 'parts' AND customer_status = 'approved' AND part_option IS NOT NULL
      GROUP BY part_option ORDER BY n DESC LIMIT 1`, [main.id]);
  return top?.part_option || partsPreference(main)[0] || 'genuine';
}

/** estimate_consents.line_ids (JSON) as a list of ids. */
function parseIds(v) {
  try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a.map(Number) : []; } catch { return []; }
}

/** 1234.5 → "1,234.50": the amount as the consent statement gives it (the customer's page formats it the same way). */
const consentAmountText = n => r2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** The consent statement for approving `amount` (incl. VAT) of a supplementary estimate. */
const consentStatement = (amount, estimateNumber) =>
  `I agree to the additional work at the fixed cost of AED ${consentAmountText(amount)} (incl. VAT) — supplementary estimate ${estimateNumber}.`;

/**
 * What approving these lines costs, incl. VAT: each line at the price it is
 * approved at (a part in its category), to the fils as estimate_lines.
 * line_total stores it, plus VAT. `items`: [{ line, check }].
 */
function fixedCostOf(items, vatRate) {
  const sub = items.filter(({ line }) => line.line_type !== 'discount').reduce((s, { line, check }) => {
    const price = check?.chosen ? check.chosen.price : Number(line.unit_price || 0);
    return s + r2((Number(line.quantity) || 1) * price * (1 - Number(line.discount_pct || 0) / 100));
  }, 0);
  return r2(sub * (1 + Number(vatRate ?? 5) / 100));
}

/**
 * The consent approving supplementary-estimate lines needs — the statement
 * ticked (`agreed: true`), the customer's name typed, and the fixed cost the
 * page showed (`amount`), which has to be what those lines cost now. The
 * statement stored is the one the page showed (`text`) when it gives that
 * cost, else the standard wording. { ok, name, text, amount } or a refusal.
 */
function checkConsent(consent, { amount, estimateNumber, inPerson = false }) {
  const c = consent && typeof consent === 'object' ? consent : {};
  const name = typeof c.name === 'string' ? (stripMarkup(c.name, 200) || '').replace(/\s+/g, ' ').trim() : '';
  if (c.agreed !== true || name.length < 2) {
    return { ok: false, status: 400, code: 'CONSENT_REQUIRED', amount,
      message: inPerson
        ? `Record the customer's consent to the additional work (fixed cost AED ${consentAmountText(amount)} incl. VAT): tick the statement and type their name.`
        : `Approving additional work needs your consent: tick the statement (fixed cost AED ${consentAmountText(amount)} incl. VAT) and type your full name.` };
  }
  if (!Number.isFinite(Number(c.amount)) || c.amount === null || c.amount === '' || Math.abs(Number(c.amount) - amount) > 0.005) {
    return { ok: false, status: 409, code: 'CONSENT_AMOUNT_CHANGED', amount,
      message: `The fixed cost of what is being approved is AED ${consentAmountText(amount)} incl. VAT — check it and tick the statement again.` };
  }
  const shown = typeof c.text === 'string' ? (stripMarkup(c.text, 1000) || '').trim() : '';
  return { ok: true, name, amount, text: shown && shown.includes(consentAmountText(amount)) ? shown : consentStatement(amount, estimateNumber) };
}

/** Store a consent checked by checkConsent(); its id goes on the lines approved under it. */
async function recordConsent({ est, consent, lineIds, channel, recordedBy = null, ip = null, userAgent = null }) {
  const r = await execute(
    `INSERT INTO estimate_consents (workshop_id, estimate_id, line_ids, amount, consent_text, consent_name, channel, recorded_by, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [est.workshop_id, est.id, JSON.stringify(lineIds), consent.amount, consent.text, consent.name, channel, recordedBy,
     ip ? String(ip).slice(0, 64) : null, userAgent ? String(userAgent).slice(0, 300) : null]);
  return r.insertId;
}

/**
 * Create the job card an approved (or, via the manual staff route,
 * partially-approved) estimate becomes, and mark the estimate converted.
 *
 * Shared by the manual POST /:id/convert-to-work-order (staff decides when)
 * and the automatic path in applyLineDecision (fires the moment every line
 * on the estimate is approved) — one code path, so the two cannot drift.
 *
 * The APPROVED lines are copied onto the job card as work_order_items. The
 * job card is the record of what the customer accepted, and it is what the
 * technician and the store work from; it used to arrive empty, carrying only
 * a lump sum in service_fee. Billing is 'itemised' (lib/job-card-billing.js):
 * the invoice is the sum of those items plus VAT, so a rejected line can
 * never be billed and an approved one can never be dropped.
 *
 * Runs in a transaction with the estimate row locked, so two approvals
 * landing at once (customer link + staff in person) cannot open two job
 * cards for one estimate. Returns null if the estimate was already converted.
 */
async function convertEstimateToWorkOrder(estimate, workshopId) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  let wo_number = null;
  let payerType = CUSTOMER_TYPE_TO_PAYER_TYPE[estimate.customer_type] || 'self_pay';
  // An internal insurance account is billed as insurance, not as fleet.
  if (estimate.customer_type === 'internal_fleet' && estimate.customer_id) {
    const [c] = await query('SELECT customer_subcategory FROM customers WHERE id = ?', [estimate.customer_id]);
    if (c?.customer_subcategory === 'insurance') payerType = 'insurance';
  }

  const conn = await pool.getConnection();
  // addedToJob: the work went onto the visit already on the floor (its intake
  // work order and job card), so no new job card was created.
  let workOrderId, approvedLines, addedToJob = false;
  try {
    await conn.beginTransaction();

    const [[locked]] = await conn.query(
      'SELECT id, work_order_id FROM service_estimates WHERE id = ? AND workshop_id = ? FOR UPDATE',
      [estimate.id, workshopId]
    );
    if (!locked || locked.work_order_id) { await conn.rollback(); return null; }

    // Discount lines are left out because computeTotals() never counted them
    // either — the customer approved the total they were shown.
    [approvedLines] = await conn.query(
      `SELECT * FROM estimate_lines
        WHERE estimate_id = ? AND customer_status = 'approved' AND line_type <> 'discount'
        ORDER BY sort_order, id`,
      [estimate.id]
    );

    const description = `From estimate ${estimate.estimate_number}: ` +
      approvedLines.map(l => l.job_name || l.description).filter((v, i, a) => v && a.indexOf(v) === i).join('; ');

    let intake = null;
    if (estimate.intake_work_order_id) {
      [[intake]] = await conn.query(
        "SELECT id, work_order_number, status FROM work_orders WHERE id = ? AND workshop_id = ? FOR UPDATE",
        [estimate.intake_work_order_id, workshopId]);
      if (intake && ['completed', 'cancelled'].includes(intake.status)) intake = null;
    } else if (estimate.enquiry_id) {
      // A quote raised from an enquiry: the enquiry already has its work
      // order (the visit, opened when the enquiry came in) — the approved
      // work goes onto it rather than onto a second one.
      [[intake]] = await conn.query(
        `SELECT wo.id, wo.work_order_number, wo.status FROM work_orders wo
          WHERE wo.workshop_id = ? AND wo.status NOT IN ('completed','cancelled')
            AND (wo.enquiry_id = ? OR wo.id = (SELECT e.converted_work_order_id FROM enquiries e WHERE e.id = ? AND e.workshop_id = ?))
          ORDER BY wo.id LIMIT 1 FOR UPDATE`,
        [workshopId, estimate.enquiry_id, estimate.enquiry_id, workshopId]);
    }
    // A supplementary estimate's work joins its own job — never a new one.
    if (isSupplementary(estimate) && !intake) { await conn.rollback(); return null; }

    if (intake) {
      // Step 6: the approved work goes onto the visit's own job card. An
      // estimate raised as Insurance or Credit account says who pays for
      // that work, and the job's payer follows it (Step 7's payment rule
      // reads payer_type); retail / internal leave the intake's payer alone.
      workOrderId = intake.id;
      wo_number = intake.work_order_number;
      addedToJob = true;
      const payerFromEstimate = ['insurance', 'credit'].includes(estimate.customer_type) ? payerType : null;
      await conn.query(
        `UPDATE work_orders SET billing_basis = 'itemised', estimate_approved_at = COALESCE(estimate_approved_at, NOW()),
                description = CASE WHEN description IS NULL OR description = '' THEN ? ELSE description END,
                payer_type = COALESCE(?, payer_type)
          WHERE id = ?`, [description.slice(0, 2000), payerFromEstimate, workOrderId]);
    } else {
      // The customer's phone/e-mail go on the job card too — the survey,
      // the "ready" message and the pickup call read them from there.
      const [[cust]] = estimate.customer_id
        ? await conn.query('SELECT phone, email FROM customers WHERE id = ?', [estimate.customer_id]) : [[null]];
      // Numbers are a random draw per day; a collision draws again.
      for (let attempt = 0; attempt < 6 && !workOrderId; attempt++) {
        const number = `WO-${stamp}-${Math.floor(Math.random() * 9000) + 1000}`;
        try {
          const [ins] = await conn.query(
            `INSERT INTO work_orders
               (workshop_id, work_order_number, customer_id, vehicle_id, customer_name, customer_phone, customer_email,
                description, service_fee, billing_basis, payer_type, status, service_status_token, enquiry_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'itemised', ?, 'estimate_approved', ?, ?)`,
            [workshopId, number, estimate.customer_id, estimate.vehicle_id, estimate.customer_name,
             cust?.phone || null, cust?.email || null,
             description.slice(0, 2000), payerType, serviceStatusToken(), estimate.enquiry_id || null]
          );
          workOrderId = ins.insertId; wo_number = number;
        } catch (e) {
          if (e.code !== 'ER_DUP_ENTRY' || !/work_order_number/.test(e.message)) throw e;
        }
      }
      if (!workOrderId) throw new Error('Could not allocate a work order number');
      await snapshotIntakeClass(workOrderId, { conn });
    }

    const pref = partsPreference(estimate);
    for (const l of approvedLines) {
      // The line's own discount is folded into the unit price, so the job
      // card line totals what the customer saw on the estimate line. A part
      // carries the category it was approved in — an approved alternative
      // says what it stands in for.
      const eff = l.line_type === 'parts' ? effectivePartOption(l, pref) : null;
      const unitPrice = Math.round(Number(eff ? eff.price : l.unit_price || 0) * (1 - Number(l.discount_pct || 0) / 100) * 100) / 100;
      const partNo = eff ? (eff.part_number || l.part_number || null) : null;
      const name = (l.description || l.line_type) + (eff
        ? ` (${PART_CATEGORY_LABEL[eff.option]}${partNo ? ` · P/N ${partNo}` : ''}${eff.alternative ? ` — alternative to ${PART_CATEGORY_LABEL[eff.for] || 'the requested type'}` : ''})` : '');
      await conn.query(
        `INSERT INTO work_order_items (work_order_id, name, item_type, estimate_line_id, quantity, unit_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [workOrderId, name.slice(0, 255), l.line_type, l.id, Number(l.quantity) || 1, unitPrice]
      );
    }

    await conn.query(
      'UPDATE service_estimates SET status = ?, work_order_id = ? WHERE id = ?',
      ['converted', workOrderId, estimate.id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  const billing = await recalcWorkOrder(workOrderId, workshopId);
  // The customer's line decisions are the agreement; record it so work can
  // start. A supplementary estimate's is the agreement to the extra work —
  // the job's approved total grows with it.
  await recordCustomerApproval({
    workOrderId, workshopId, channel: 'estimate',
    note: `${isSupplementary(estimate) ? 'Supplementary estimate' : 'Estimate'} ${estimate.estimate_number}`,
  });
  // Step 3/6: the main job card — open already for a visit on the floor
  // (the estimate needed it), opened now for an internal customer, and for
  // an external one only once the physical inspection is acknowledged. With
  // a job card the floor is told the approved work is ready to assign;
  // without one there is nothing to assign yet.
  const { jobCard: mainCard } = await openJobCardIfReady({ workOrderId, workshopId, notify: false });
  if (mainCard) await onWorkApproved({ workOrderId, workshopId, how: `${isSupplementary(estimate) ? 'supplementary estimate' : 'estimate'} ${estimate.estimate_number}` });
  // CRM: the quote is decided; the enquiry it came from is now a job.
  await closeTasks({ workshopId, relatedType: 'quote', relatedId: estimate.id, outcome: 'Approved' });
  if (estimate.enquiry_id) {
    await markEnquiryConverted({ workshopId, enquiryId: estimate.enquiry_id, workOrderId, customerId: estimate.customer_id });
  }

  return {
    workOrderId,
    wo_number,
    added_to_job: addedToJob,
    job_card_number: mainCard?.job_card_number || null,
    // Returned so a caller can tell the user the job card is worth less than
    // the estimate, rather than leaving them to notice.
    priced_from_lines: approvedLines.length,
    subtotal: billing?.totals.subtotal ?? null,
    total_amount: billing?.totals.total ?? null,
    quoted_total: Number(estimate.total_amount) || 0,
  };
}

/**
 * The estimate a customer decision is for, or why none can be taken: once
 * the job card exists the decisions are history. A change of mind after that
 * used to flip the estimate back to partially_approved while the job card
 * kept billing the line the customer had just rejected. A supplementary
 * estimate's work joins its job, so a job closed meanwhile closes it too.
 * { est } or { refusal: { status, code, message } }.
 */
async function decisionTarget(estimateId, workshopId) {
  const [est] = await query('SELECT * FROM service_estimates WHERE id = ? AND workshop_id = ?', [estimateId, workshopId]);
  if (!est) return { refusal: { status: 404, message: 'Estimate not found' } };
  if (est.work_order_id || ['converted', 'expired'].includes(est.status)) {
    return { refusal: {
      status: 409,
      message: 'This estimate has already been turned into a job card, so it can no longer be changed here. Please contact the workshop.',
    } };
  }
  if (isSupplementary(est)) {
    const [wo] = est.intake_work_order_id
      ? await query('SELECT status FROM work_orders WHERE id = ? AND workshop_id = ?', [est.intake_work_order_id, workshopId]) : [];
    if (!wo || ['completed', 'cancelled'].includes(wo.status)) {
      return { refusal: { status: 409, code: 'JOB_CLOSED',
        message: 'This job is closed, so the additional work can no longer be approved here. Please contact the workshop.' } };
    }
  }
  return { est };
}

/**
 * Whether one line can take this decision — the same rules whether the
 * customer decides one line or several at once. A part is approved in one
 * of the categories on offer: a requested one that is priced and available
 * (the one it counts at unless the customer picks another), or the
 * alternative — only when picked explicitly. { ok: true, chosen } (chosen:
 * the option an approved part takes, else null) or { ok: false, status,
 * code, message }.
 */
function lineDecisionCheck(line, decision, partOption, pref) {
  if (line.line_type !== 'parts' || !hasCategoryPricing(line)) return { ok: true, chosen: null };
  const { requested, alternative } = partOptions(line, pref);
  const usable = requested.filter(o => o.usable);
  if (decision !== 'approved') return { ok: true, chosen: null, usable, alternative };
  let chosen = null;
  if (partOption) {
    chosen = usable.find(o => o.option === partOption) || (alternative?.option === partOption ? alternative : null);
    if (!chosen) {
      return { ok: false, status: 400, code: 'PART_OPTION_NOT_OFFERED',
        message: `${PART_CATEGORY_LABEL[partOption] || 'That type'} is not on offer for “${line.description}”. Choose one of the priced options.` };
    }
  } else {
    chosen = usable.find(o => o.option === line.part_option) || usable[0] || null;
    if (!chosen) {
      return { ok: false, status: 409, code: alternative ? 'ALTERNATIVE_NEEDS_CHOICE' : 'PART_NOT_AVAILABLE',
        message: alternative
          ? `“${line.description}” is not available as requested. Choose the alternative (${PART_CATEGORY_LABEL[alternative.option]}) to approve it, or reject it.`
          : `“${line.description}” is not available in ${categoryWords(pref)}, so it can only be rejected.` };
    }
  }
  return { ok: true, chosen, usable, alternative };
}

/** Record one line's decision checked by lineDecisionCheck() — an approved part in its category. */
async function writeLineDecision({ line, decision, check, responder, consentId = null }) {
  if (line.line_type === 'parts' && hasCategoryPricing(line)) {
    if (decision === 'approved') {
      await execute('UPDATE estimate_lines SET part_option = ?, unit_price = ?, alternative_approved = ? WHERE id = ?',
        [check.chosen.option, check.chosen.price, check.alternative ? (check.chosen.alternative ? 1 : 0) : null, line.id]);
    } else {
      // Declined: an alternative on this line was not taken, and the line
      // counts at what the customer would have had by default.
      await execute('UPDATE estimate_lines SET part_option = NULL, unit_price = ?, alternative_approved = ? WHERE id = ?',
        [check.usable?.[0]?.price ?? 0, check.alternative ? 0 : null, line.id]);
    }
  }
  await execute(
    `UPDATE estimate_lines
        SET customer_status = ?, customer_responded_at = NOW(),
            customer_responded_by = ?, response_channel = ?, consent_id = ?
      WHERE id = ?`,
    [decision, responder?.name || null, responder?.channel || 'in_person', decision === 'approved' ? consentId : null, line.id]
  );
}

/** The customer's reason for saying no (process step 6) — kept on the estimate, prefixed with the line(s) so several reasons stay readable. */
async function noteRejectionReason(estimateId, lines, reason) {
  if (!reason || !String(reason).trim()) return;
  const what = lines.map(l => l.description || `line ${l.id}`).join('; ');
  await execute(
    `UPDATE service_estimates SET customer_notes = CONCAT_WS('\\n', NULLIF(customer_notes, ''), ?) WHERE id = ?`,
    [`[${what.slice(0, 300)}] ${String(reason).trim().slice(0, 500)}`, estimateId]
  );
}

/**
 * Apply one customer decision to one line, roll the estimate's overall
 * status up from its lines, and — the point of the whole exercise — create
 * the job card the moment every line is decided and at least one is
 * approved. Shared by the staff-authenticated PATCH route and the public,
 * token-authenticated one, so "what happens when a line is approved" is
 * answered in exactly one place regardless of who clicked it.
 *
 * responder describes who/how, for the audit trail and for
 * estimate_lines.response_channel: staff acting in person pass
 * { channel: 'in_person' }; the public route passes
 * { channel: 'email', name: <whatever the customer typed, if anything> }.
 *
 * Approving a supplementary estimate's line needs the customer's `consent`
 * (checkConsent); staff in person record it for them (actingUserId).
 */
async function applyLineDecision({ estimateId, lineId, workshopId, decision, responder, actingUserId = null, reason = null, partOption = null, consent = null, ip = null, userAgent = null }) {
  return applyDecisions({ estimateId, workshopId, decision, lineIds: [lineId], partOptions: partOption ? { [lineId]: partOption } : {},
    responder, actingUserId, reason, consent, ip, userAgent, single: true });
}

/**
 * Apply one decision to several lines at once (the customer's "Approve all",
 * "Reject all" or the jobs they selected) — one request, the same rules as
 * one line. Every line is checked first: one that cannot take the decision
 * (a part with no type on offer, an alternative not chosen) stops them all,
 * and the answer lists each (`problems`). A supplementary estimate's
 * approval is one consent for all of them, at their fixed cost together.
 * `lineIds` null: every line still pending. `partOptions`: { lineId: category }.
 */
async function applyDecisions({ estimateId, workshopId, decision, lineIds = null, partOptions = {}, responder, actingUserId = null, reason = null, consent = null, ip = null, userAgent = null, single = false }) {
  const target = await decisionTarget(estimateId, workshopId);
  if (target.refusal) return { ok: false, ...target.refusal };
  const est = target.est;
  const pref = partsPreference(est);

  const all = await query('SELECT * FROM estimate_lines WHERE estimate_id = ? AND workshop_id = ? ORDER BY sort_order, id', [est.id, workshopId]);
  let lines;
  if (lineIds == null) {
    lines = all.filter(l => l.customer_status === 'pending');
  } else {
    const ids = [...new Set(lineIds.map(Number))];
    lines = all.filter(l => ids.includes(l.id));
    if (lines.length !== ids.length) return { ok: false, status: 404, message: 'Line not found' };
  }
  if (!lines.length) return { ok: false, status: 400, code: 'NOTHING_TO_DECIDE', message: 'There is nothing left to decide on this estimate.' };

  const items = lines.map(line => ({ line, check: lineDecisionCheck(line, decision, partOptions?.[line.id] || null, pref) }));
  const problems = items.filter(i => !i.check.ok);
  if (problems.length) {
    if (single) return problems[0].check;
    return {
      ok: false, status: 409, code: 'BULK_DECISION_REFUSED',
      message: problems.length === 1 ? problems[0].check.message
        : `${problems.length} items cannot be ${decision} as they stand — nothing was recorded: ${problems.map(p => `“${p.line.description}”`).join(', ')}.`,
      problems: problems.map(p => ({ line_id: p.line.id, description: p.line.description, code: p.check.code, message: p.check.message })),
    };
  }

  // A supplementary estimate's approval is the customer's consent to its fixed cost.
  let consentId = null;
  if (decision === 'approved' && isSupplementary(est)) {
    const inPerson = responder?.channel === 'in_person';
    const checked = checkConsent(consent, { amount: fixedCostOf(items, est.vat_rate), estimateNumber: est.estimate_number, inPerson });
    if (!checked.ok) return checked;
    consentId = await recordConsent({ est, consent: checked, lineIds: lines.map(l => l.id), channel: inPerson ? 'in_person' : 'link',
      recordedBy: inPerson ? actingUserId : null, ip: inPerson ? null : ip, userAgent: inPerson ? null : userAgent });
    // The name the customer typed is who decided.
    responder = { ...responder, name: checked.name };
  }

  for (const { line, check } of items) {
    await writeLineDecision({ line, decision, check, responder, consentId });
  }
  if (items.some(({ line }) => line.line_type === 'parts' && hasCategoryPricing(line))) await recalcEstimateTotals(est.id);
  if (decision === 'rejected') await noteRejectionReason(est.id, lines, reason);

  const result = await settleEstimate({ estimateId: est.id, workshopId, actingUserId });

  await logAudit({
    workshopId, userId: actingUserId, action: single ? 'LINE_DECISION' : 'BULK_LINE_DECISION',
    entityType: single ? 'estimate_lines' : 'service_estimates', entityId: single ? lines[0].id : est.id,
    oldValue: single ? lines[0].customer_status : lines.map(l => ({ id: l.id, status: l.customer_status })),
    newValue: { decision, estimate_status: result.estimate_status, responder, ...(single ? {} : { lines: lines.map(l => l.id) }), ...(consentId ? { consent_id: consentId } : {}) },
  });

  return { ...result, decided: lines.length, consent_id: consentId };
}

/**
 * Roll the estimate's status up from its lines and act on it. Fully
 * approved, with no staff step in between — the estimate said "job card
 * will create" and this is where that actually happens. A partial approval
 * deliberately does NOT auto-convert: deciding which approved lines still
 * make a coherent job on their own needs a person, so partially_approved
 * sits and waits for the manual POST /:id/convert-to-work-order, which
 * already supports it. Every line rejected: Step 6 "Reject all" closes the
 * job — but a rejected supplementary estimate only drops the extra work;
 * the job and its main estimate go on.
 */
async function settleEstimate({ estimateId, workshopId, actingUserId = null }) {
  const allLines = await query('SELECT customer_status FROM estimate_lines WHERE estimate_id = ?', [estimateId]);
  const anyApproved = allLines.some(l => l.customer_status === 'approved');
  const anyPending = allLines.some(l => l.customer_status === 'pending');
  const allApproved = allLines.every(l => l.customer_status === 'approved');
  const allRejected = allLines.every(l => l.customer_status === 'rejected');

  let newStatus;
  if (anyPending) newStatus = 'sent_to_customer';
  else if (allApproved) newStatus = 'approved';
  else if (allRejected) newStatus = 'rejected';
  else if (anyApproved) newStatus = 'partially_approved';
  else newStatus = 'rejected'; // every remaining line is 'deferred', nothing approved

  await execute('UPDATE service_estimates SET status = ? WHERE id = ?', [newStatus, estimateId]);
  const [estimate] = await query('SELECT * FROM service_estimates WHERE id = ?', [estimateId]);
  const supplementary = isSupplementary(estimate);

  const result = { ok: true, status: 200, estimate_status: newStatus };

  if (!anyPending && allApproved) {
    if (estimate && !estimate.work_order_id) {
      const converted = await convertEstimateToWorkOrder(estimate, workshopId);
      if (converted) {
        result.work_order_id = converted.workOrderId;
        result.work_order_number = converted.wo_number;
        result.added_to_job = converted.added_to_job;
        result.job_card_number = converted.job_card_number;
        await notifyEstimateOutcome({
          estimateId, workshopId, outcome: 'approved', workOrderId: converted.workOrderId, wo_number: converted.wo_number,
          addedToJob: converted.added_to_job, jobCardNumber: converted.job_card_number,
        });
      }
    }
  } else if (!anyPending && allRejected && supplementary) {
    // The extra work is not done; the job carries on with what was approved.
    await notifyEstimateOutcome({ estimateId, workshopId, outcome: 'rejected' });
    await closeTasks({ workshopId, relatedType: 'quote', relatedId: estimateId, outcome: 'Rejected' });
  } else if (!anyPending && allRejected) {
    await notifyEstimateOutcome({ estimateId, workshopId, outcome: 'rejected' });
    await closeTasks({ workshopId, relatedType: 'quote', relatedId: estimateId, outcome: 'Rejected' });
    let enquiryLost = false;
    if (estimate?.enquiry_id) {
      const lost = await execute(
        `UPDATE enquiries SET status = 'lost', lost_reason = COALESCE(lost_reason, 'price'),
                lost_notes = COALESCE(lost_notes, ?) WHERE id = ? AND workshop_id = ? AND converted_work_order_id IS NULL`,
        [`Customer rejected estimate ${estimate.estimate_number}`, estimate.enquiry_id, workshopId]);
      enquiryLost = lost.affectedRows > 0;
    }
    // Step 6 "Reject all": close the job — no work carried out.
    if (estimate?.intake_work_order_id) {
      const r = await applyStatusChange({
        workOrderId: estimate.intake_work_order_id, workshopId, userId: actingUserId, status: 'cancelled', skipGates: true,
        note: `Customer rejected estimate ${estimate.estimate_number} — no work carried out${estimate.customer_notes ? `. Reason: ${String(estimate.customer_notes).slice(0, 300)}` : ''}`,
      });
      if (r.ok) {
        await execute("UPDATE work_orders SET cancellation_reason = ? WHERE id = ? AND workshop_id = ?",
          [`Customer rejected estimate ${estimate.estimate_number}`, estimate.intake_work_order_id, workshopId]);
        await execute("UPDATE job_cards SET status = 'cancelled' WHERE work_order_id = ? AND workshop_id = ? AND status = 'open'",
          [estimate.intake_work_order_id, workshopId]);
        result.work_order_closed = estimate.intake_work_order_id;
      }
    }
    // The lead is lost: its work order (opened with the enquiry, D1) is
    // cancelled when nothing has happened on it yet — "Enquiry closed: …".
    if (enquiryLost) {
      await closeEnquiryWorkOrder({
        workshopId, enquiryId: estimate.enquiry_id, userId: actingUserId,
        reason: `customer rejected estimate ${estimate.estimate_number}`,
      }).catch(err => console.error('[estimates] enquiry work order on rejection:', err.message));
    }
  } else if (!anyPending && newStatus === 'partially_approved') {
    // Deliberately not auto-converted (see above) — which is exactly why
    // someone has to be told, or it sits unseen.
    await notifyEstimateOutcome({ estimateId, workshopId, outcome: 'partial' });
  }

  return result;
}

/** Tell the advisor (and the workshop manager, if different) what the
 *  customer decided — this happens with no staff member present to see it
 *  land, so it has to reach someone through the in-app notification feed. */
async function notifyEstimateOutcome({ estimateId, workshopId, outcome, workOrderId, wo_number, addedToJob = false, jobCardNumber = null }) {
  const [estimate] = await query(
    `SELECT e.estimate_number, e.kind, e.customer_name, e.advisor_id, e.created_by, e.vehicle_plate, e.intake_work_order_id,
            c.email AS customer_email, iwo.work_order_number AS intake_number
       FROM service_estimates e LEFT JOIN customers c ON c.id = e.customer_id
       LEFT JOIN work_orders iwo ON iwo.id = e.intake_work_order_id
      WHERE e.id = ?`,
    [estimateId]
  );
  if (!estimate) return;

  const who = estimate.customer_name || 'The customer';
  // A supplementary estimate is extra work on a job already under way: it
  // never opens a job card of its own, and a rejection only drops the extra
  // work — no regret e-mail, the job goes on.
  if (isSupplementary(estimate)) {
    const n = estimate.estimate_number;
    const job = estimate.intake_number || wo_number || 'the job';
    const sm = {
      approved: {
        title: `Supplementary estimate ${n} approved — extra work added to ${jobCardNumber ? `job card ${jobCardNumber} (${wo_number})` : `work order ${wo_number}`}`,
        body: `${who} approved the additional work at its fixed cost and gave their consent. It was added to ${jobCardNumber ? `job card ${jobCardNumber}` : `work order ${wo_number}`} and is ready for the Team Leader to assign.`,
        type: 'success', icon: '✅',
      },
      partial: {
        title: `Supplementary estimate ${n} partially approved — add the approved lines to the job card`,
        body: `${who} approved some of the additional work (with their consent) and rejected the rest. Open it and add the approved lines to ${job}'s job card.`,
        type: 'warning', icon: '🟡',
      },
      rejected: {
        title: `Supplementary estimate ${n} rejected — the extra work will not be done`,
        body: `${who} rejected the additional work. The approved work on ${job} carries on as before.`,
        type: 'warning', icon: '⚠️',
      },
    }[outcome];
    for (const userId of new Set([estimate.advisor_id, estimate.created_by].filter(Boolean))) {
      await createInAppNotification({
        workshopId, userId, title: sm.title, body: sm.body, type: sm.type, icon: sm.icon,
        link: outcome === 'approved' && workOrderId ? `/work-orders/${workOrderId}` : `/estimates?id=${estimateId}`,
        orderId: workOrderId || estimate.intake_work_order_id || null,
      });
    }
    return;
  }
  // Approved on a visit already on the floor: the work joins its job card
  // (no new one); otherwise a new work order and job card were opened.
  const jc = jobCardNumber || wo_number;
  const msg = {
    // The work order has no job card yet: an external customer's opens when
    // they acknowledge the physical inspection.
    approved: addedToJob && !jobCardNumber ? {
      title: `Estimate ${estimate.estimate_number} approved — work added to work order ${wo_number}`,
      body: `${who} approved every line. The work was added to work order ${wo_number}; its job card opens when the customer acknowledges the physical inspection.`,
      type: 'success', icon: '✅',
    } : addedToJob ? {
      title: `Estimate ${estimate.estimate_number} approved — work added to job card ${jc} (${wo_number})`,
      body: `${who} approved every line. The work was added to job card ${jc} (${wo_number}) and is ready for the Team Leader to assign.`,
      type: 'success', icon: '✅',
    } : {
      title: `Estimate ${estimate.estimate_number} approved — job card ${wo_number} created`,
      body: `${who} approved every line. Job card ${wo_number} has been created automatically.`,
      type: 'success', icon: '✅',
    },
    partial: {
      title: `Estimate ${estimate.estimate_number} partially approved — convert it to a job card`,
      body: `${who} approved some lines and rejected others. Review it and convert the approved lines into a job card.`,
      type: 'warning', icon: '🟡',
    },
    rejected: {
      title: `Estimate ${estimate.estimate_number} rejected by the customer`,
      body: `${who} rejected the estimate. No job card was created.`,
      type: 'warning', icon: '⚠️',
    },
  }[outcome];

  const recipients = new Set([estimate.advisor_id, estimate.created_by].filter(Boolean));
  for (const userId of recipients) {
    await createInAppNotification({
      workshopId, userId, title: msg.title, body: msg.body, type: msg.type, icon: msg.icon,
      link: outcome === 'approved' && workOrderId ? `/work-orders/${workOrderId}` : `/estimates?id=${estimateId}`,
      orderId: workOrderId || null,
    });
  }

  // Process step 6, "Reject all": tell the customer we regret it and ask why.
  if (outcome === 'rejected' && estimate.customer_email) {
    await sendNotificationEmail({
      to: estimate.customer_email,
      tenantId: workshopId,
      subject: `Estimate ${estimate.estimate_number} — we're sorry we couldn't help this time`,
      title: 'We\'re sorry this estimate wasn\'t right for you',
      body: `You declined our estimate ${estimate.estimate_number}` +
        `${estimate.vehicle_plate ? ` for your vehicle (${estimate.vehicle_plate})` : ''}, so no work will be carried out. ` +
        'We\'d really value knowing why — simply reply to this email and tell us what we could have done better.',
    }).catch(err => console.error('[Estimates] regret email failed:', err.message));
  }
}

/** The customer's approval page; the same base as the status and inspection links. */
function estimateApprovalUrl(token) {
  return `${customerAppBase()}/estimate-approval/${token}`;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const aed = n => `AED ${Number(n || 0).toFixed(2)}`;
const shortDate = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * What the customer is sent (POST /:id/send): the e-mail's table and the
 * WhatsApp sentence, both in the categories of the parts preference. One
 * category: one price per part and the total. Several: each part's price in
 * each category and a total per category (labour included). A part not
 * available as asked says so, with its alternative marked as needing their
 * approval — it is in no total.
 */
function estimateMessage(est, lines, pref) {
  const vat = 1 + Number(est.vat_rate ?? 5) / 100;
  const shown = lines.filter(l => l.line_type !== 'discount');
  const pricing = summariseEstimatePricing(shown, pref);
  const categoryParts = shown.some(l => l.line_type === 'parts' && hasCategoryPricing(l));
  const several = categoryParts && pref.length > 1;
  const optionText = (o, qty) => `${PART_CATEGORY_LABEL[o.option]} ${aed(o.price * qty)}${o.expected_date ? ` (expected ${shortDate(o.expected_date)})` : ''}`;

  const td = 'padding:6px 0;vertical-align:top;';
  const rows = shown.map(l => {
    const qty = Number(l.quantity) || 1;
    const name = `${esc(l.description)}${qty !== 1 ? ` × ${qty}` : ''}`;
    if (l.line_type !== 'parts' || !hasCategoryPricing(l)) {
      return `<tr><td style="${td}">${name}</td><td style="${td}text-align:right;white-space:nowrap;">${aed(l.line_total ?? qty * Number(l.unit_price || 0))}</td></tr>`;
    }
    const { requested, alternative } = partOptions(l, pref);
    const notes = [];
    if (several) notes.push(requested.map(o => (o.usable ? optionText(o, qty) : `${PART_CATEGORY_LABEL[o.option]}: not available`)).join(' · '));
    else if (!requested[0]?.usable) notes.push(`${PART_CATEGORY_LABEL[pref[0]]}: not available`);
    else if (requested[0].expected_date) notes.push(`Expected ${shortDate(requested[0].expected_date)}`);
    if (alternative) notes.push(`Alternative offered — ${optionText(alternative, qty)}, needs your approval`);
    const amount = several ? '' : requested[0]?.usable ? aed(requested[0].price * qty) : '—';
    return `<tr><td style="${td}">${name}${notes.map(n => `<div style="font-size:12.5px;color:#64748b;">${esc(n)}</div>`).join('')}</td>` +
      `<td style="${td}text-align:right;white-space:nowrap;">${amount}</td></tr>`;
  }).join('');
  const strong = 'padding-top:10px;font-weight:700;';
  const totals = several
    ? pref.map(c => `<tr><td style="${strong}">Total with ${PART_CATEGORY_LABEL[c]} parts (incl. VAT)</td><td style="${strong}text-align:right;">${aed(pricing.totals[c] * vat)}</td></tr>`).join('')
    : `<tr><td style="${strong}">Total (incl. VAT)</td><td style="${strong}text-align:right;">${aed(est.total_amount)}</td></tr>`;
  const alts = pricing.alternatives.length;
  const notesAfter = [
    categoryParts ? `Parts priced in ${categoryWords(pref)}${several ? ' — choose for each part on the next page' : ''}.` : null,
    alts ? `${alts} part${alts > 1 ? 's are' : ' is'} not available as you asked; an alternative is offered for your approval.` : null,
  ].filter(Boolean).map(n => `<p style="margin:12px 0 0;color:#64748b;font-size:13px;">${esc(n)}</p>`).join('');
  const html = `<table style="width:100%;margin-top:14px;border-collapse:collapse;font-size:14px;">${rows}${totals}</table>${notesAfter}`;

  const totalText = several
    ? `parts priced in ${categoryWords(pref)}: ${pref.map(c => `${PART_CATEGORY_LABEL[c]} ${aed(pricing.totals[c] * vat)}`).join(' / ')} incl. VAT`
    : `${aed(est.total_amount)} incl. VAT${categoryParts ? `, ${categoryWords(pref)} parts` : ''}`;
  // A supplementary estimate: extra work at a fixed cost, approved with the customer's consent.
  const text = isSupplementary(est)
    ? `Additional work${est.vehicle_plate ? ` on ${est.vehicle_plate}` : ''}: supplementary estimate ${est.estimate_number}` +
      `${est.parent_estimate_number ? ` (to estimate ${est.parent_estimate_number})` : ''} at a fixed cost of ${aed(est.total_amount)} incl. VAT. ` +
      'Approve each item with your consent, or reject it.'
    : `Your service estimate ${est.estimate_number}${est.vehicle_plate ? ` for ${est.vehicle_plate}` : ''} is ready (${totalText}).` +
      `${alts ? ` ${alts} part${alts > 1 ? 's are' : ' is'} offered as an alternative for your approval.` : ''}`;
  return { html, text };
}

// ══════════════════════════════════════════════════════════════
// GET /api/estimates — list estimates
// ══════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const { status, view, customer_id, search, kind, page = 1, limit = 30 } = req.query;
    const lim = Math.min(Math.max(parseInt(limit) || 30, 1), 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

    // needs_internal_approval: an external customer's estimate that has not
    // been signed off and has not gone out yet (process step 5).
    const NEEDS_APPROVAL = !ESTIMATE_APPROVAL_REQUIRED ? '(1 = 0)' : `(e.internal_approved_at IS NULL AND e.status = 'draft'
      AND COALESCE(e.customer_type, '') <> 'internal_fleet' AND COALESCE(c.customer_class, 'external') <> 'internal')`;
    // The staff screen's tabs. 'parts_to_price' (the Store), 'needs_approval'
    // and 'to_convert' are the queues somebody has to act on.
    const UNPRICED_LINES = `(SELECT COUNT(*) FROM estimate_lines l WHERE l.estimate_id = e.id AND ${UNPRICED_PART_SQL})`;
    const VIEWS = {
      parts_to_price: `e.status = 'draft' AND ${UNPRICED_LINES} > 0`,
      needs_approval: NEEDS_APPROVAL,
      with_customer:  "e.status = 'sent_to_customer'",
      to_convert:     "e.status IN ('approved','partially_approved') AND e.work_order_id IS NULL",
      converted:      "e.status = 'converted'",
      rejected:       "e.status IN ('rejected','expired')",
      drafts:         `e.status = 'draft' AND NOT ${NEEDS_APPROVAL}`,
    };

    let where = ' WHERE e.workshop_id = ?';
    const params = [req.workshopId];
    if (view && VIEWS[view]) where += ` AND ${VIEWS[view]}`;
    if (status) { where += ' AND e.status = ?'; params.push(status); }
    if (customer_id) { where += ' AND e.customer_id = ?'; params.push(customer_id); }
    if (kind === 'main' || kind === 'supplementary') { where += ' AND e.kind = ?'; params.push(kind); }
    if (search) {
      // A main estimate's number also finds its supplementary ones.
      where += ' AND (e.estimate_number LIKE ? OR e.customer_name LIKE ? OR e.vehicle_plate LIKE ? OR pe.estimate_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const FROM = `
      FROM service_estimates e
      LEFT JOIN customers c ON e.customer_id = c.id
      LEFT JOIN vehicles v  ON e.vehicle_id  = v.id
      LEFT JOIN service_estimates pe ON pe.id = e.parent_estimate_id`;

    const rows = await query(
      `SELECT e.*, c.full_name AS customer_full_name, c.customer_class, v.plate_number, v.make, v.model,
              pe.estimate_number AS parent_estimate_number, pe.status AS parent_status,
              (SELECT COUNT(*) FROM service_estimates s WHERE s.parent_estimate_id = e.id) AS supplementary_count,
              ${NEEDS_APPROVAL} AS needs_internal_approval,
              (SELECT COUNT(*) FROM estimate_lines l WHERE l.estimate_id = e.id) AS line_count,
              (SELECT COUNT(*) FROM estimate_lines l WHERE l.estimate_id = e.id AND l.customer_status = 'approved') AS approved_count,
              ${UNPRICED_LINES} AS unpriced_parts
       ${FROM}${where}
       ORDER BY e.created_at ${view === 'parts_to_price' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`,
      [...params, lim, offset]
    );
    // Was a bare COUNT(*) of every estimate, whatever the filter.
    const [{ total }] = await query(`SELECT COUNT(*) AS total ${FROM}${where}`, params);

    const counts = {};
    const [countRow] = await query(
      `SELECT ${Object.entries(VIEWS).map(([k, cond]) => `SUM(${cond}) AS ${k}`).join(', ')}
       ${FROM} WHERE e.workshop_id = ?`,
      [req.workshopId]
    );
    for (const k of Object.keys(VIEWS)) counts[k] = Number(countRow?.[k]) || 0;

    res.json({ success: true, estimates: rows.map(r => ({ ...r, kind: r.kind || 'main', kind_label: KIND_LABEL[r.kind] || KIND_LABEL.main,
      customer_type_label: CUSTOMER_TYPE_LABEL[r.customer_type] || r.customer_type, preference: partsPreference(r) })),
      total, counts, approval_required: ESTIMATE_APPROVAL_REQUIRED, page: parseInt(page) || 1, limit: lim });
  } catch (err) {
    console.error('GET /estimates error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch estimates' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/estimates/raise-check?work_order_id=&kind= — can an estimate be
// raised for this work order now, and which kind: { ok, kind, code, message,
// main, technical_inspection, fixed_type }. The New Estimate form asks first,
// so it says up front what POST / would refuse (raiseCheck).
// ══════════════════════════════════════════════════════════════
router.get('/raise-check', async (req, res) => {
  try {
    const woId = Number(req.query.work_order_id);
    if (!Number.isInteger(woId) || woId <= 0) return res.status(400).json({ success: false, message: 'work_order_id is required' });
    const wanted = ['main', 'supplementary'].includes(req.query.kind) ? req.query.kind : null;
    const [wo] = await query('SELECT id, work_order_number, status FROM work_orders WHERE id = ? AND workshop_id = ?', [woId, req.workshopId]);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    const r = await raiseCheck(wo, req.workshopId, wanted);
    const kind = r.kind || wanted || 'main';
    res.json({
      success: true,
      data: {
        ok: !!r.ok, kind, code: r.code || null, message: r.message || null,
        work_order: { id: wo.id, work_order_number: wo.work_order_number, status: wo.status },
        technical_inspection: r.technical || r.technical_inspection || null,
        main: r.main ? { id: r.main.id, estimate_number: r.main.estimate_number, status: r.main.status, preference: partsPreference(r.main) } : null,
        open_supplementary: r.supplementary ? { id: r.supplementary.id, estimate_number: r.supplementary.estimate_number, status: r.supplementary.status } : null,
        // The type a supplementary estimate is priced in unless the advisor picks another.
        fixed_type: kind === 'supplementary' && r.main ? await defaultFixedType(r.main) : null,
      },
    });
  } catch (err) {
    console.error('GET /estimates/raise-check error:', err);
    res.status(500).json({ success: false, message: 'Failed to check the work order' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/estimates/ready-jobs — the open work orders an estimate can be
// raised for now (their technical inspection completed): a main estimate
// when they have none, a supplementary one when the customer has decided
// the main estimate and no supplementary one is open. For the New Estimate
// form opened without a work order.
// ══════════════════════════════════════════════════════════════
router.get('/ready-jobs', requireCapability('estimate.raise'), async (req, res) => {
  try {
    const MAIN = `FROM service_estimates e WHERE e.workshop_id = wo.workshop_id AND (e.intake_work_order_id = wo.id OR e.work_order_id = wo.id)
                    AND e.kind = 'main' AND e.status NOT IN ('rejected','expired') ORDER BY e.id DESC LIMIT 1`;
    const rows = await query(
      `SELECT wo.id, wo.work_order_number, wo.status, wo.customer_id, COALESCE(c.full_name, wo.customer_name) AS customer_name,
              wo.vehicle_id, v.plate_number, v.make, v.model, ti.completed_at AS technical_completed_at,
              (SELECT e.id ${MAIN}) AS main_id, (SELECT e.estimate_number ${MAIN}) AS main_number, (SELECT e.status ${MAIN}) AS main_status,
              (SELECT COUNT(*) FROM service_estimates s WHERE s.workshop_id = wo.workshop_id AND s.intake_work_order_id = wo.id
                  AND s.kind = 'supplementary' AND s.status IN ('draft','sent_to_customer')) AS open_supplementary
         FROM work_orders wo
         JOIN technical_inspections ti ON ti.work_order_id = wo.id AND ti.workshop_id = wo.workshop_id AND ti.status = 'completed'
         LEFT JOIN customers c ON c.id = wo.customer_id
         LEFT JOIN vehicles v ON v.id = wo.vehicle_id
        WHERE wo.workshop_id = ? AND wo.status NOT IN ('completed','cancelled')
        ORDER BY ti.completed_at DESC LIMIT 200`, [req.workshopId]);
    const jobs = [];
    for (const r of rows) {
      const kind = !r.main_id ? 'main' : DECIDED_STATUSES.includes(r.main_status) && !Number(r.open_supplementary) ? 'supplementary' : null;
      if (!kind) continue;
      jobs.push({
        id: r.id, work_order_number: r.work_order_number, status: r.status, customer_id: r.customer_id, customer_name: r.customer_name,
        vehicle_id: r.vehicle_id, plate_number: r.plate_number, make: r.make, model: r.model,
        technical_completed_at: r.technical_completed_at, kind,
        main: r.main_id ? { id: r.main_id, estimate_number: r.main_number, status: r.main_status } : null,
      });
    }
    res.json({ success: true, data: jobs });
  } catch (err) {
    console.error('GET /estimates/ready-jobs error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the work orders' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/estimates/:id — estimate detail with lines; for a supplementary
// estimate its main one and the customer's consents, for a main one its
// supplementary ones and whether another can be raised now.
// ══════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const rows = await query(
      `SELECT e.*, c.full_name AS customer_full_name, c.email AS customer_email, c.phone AS customer_phone, c.customer_class,
              v.plate_number, v.make, v.model, v.year,
              ua.full_name AS internal_approved_by_name, wo.work_order_number,
              iwo.work_order_number AS intake_work_order_number, iwo.status AS intake_work_order_status
       FROM service_estimates e
       LEFT JOIN customers c ON e.customer_id = c.id
       LEFT JOIN vehicles  v ON e.vehicle_id  = v.id
       LEFT JOIN users ua ON ua.id = e.internal_approved_by
       LEFT JOIN work_orders wo ON wo.id = e.work_order_id
       LEFT JOIN work_orders iwo ON iwo.id = e.intake_work_order_id
       WHERE e.id = ? AND e.workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Estimate not found' });

    const lines = await query(
      `SELECT el.*, om.code AS operation_code
       FROM estimate_lines el
       LEFT JOIN operations_master om ON el.operation_id = om.id
       WHERE el.estimate_id = ?
       ORDER BY el.sort_order, el.id`,
      [req.params.id]
    );

    const external = await isExternalEstimate(rows[0]);
    const pref = partsPreference(rows[0]);
    const e = rows[0];
    const supplementary = isSupplementary(e);
    const [parent] = supplementary && e.parent_estimate_id
      ? await query('SELECT id, estimate_number, status FROM service_estimates WHERE id = ? AND workshop_id = ?', [e.parent_estimate_id, req.workshopId]) : [];
    const supplementaries = supplementary ? [] : await query(
      `SELECT id, estimate_number, status, total_amount, created_at FROM service_estimates
        WHERE parent_estimate_id = ? AND workshop_id = ? ORDER BY id`, [e.id, req.workshopId]);
    const consents = supplementary ? await query(
      `SELECT ec.id, ec.line_ids, ec.amount, ec.consent_text, ec.consent_name, ec.channel, ec.ip_address, ec.created_at,
              u.full_name AS recorded_by_name
         FROM estimate_consents ec LEFT JOIN users u ON u.id = ec.recorded_by
        WHERE ec.estimate_id = ? ORDER BY ec.id`, [e.id]) : [];
    // A main estimate the customer has decided: can its supplementary one be raised now?
    let raiseSupplementary = null;
    const jobId = e.intake_work_order_id || e.work_order_id;
    if (!supplementary && jobId && DECIDED_STATUSES.includes(e.status)) {
      const [job] = await query('SELECT id, work_order_number, status FROM work_orders WHERE id = ? AND workshop_id = ?', [jobId, req.workshopId]);
      if (job) {
        const r = await raiseCheck(job, req.workshopId, 'supplementary');
        raiseSupplementary = { ok: !!r.ok && r.main?.id === e.id, code: r.code || null, message: r.message || null, work_order_id: job.id };
      }
    }
    res.json({
      success: true,
      estimate: {
        ...e,
        kind: e.kind || 'main',
        kind_label: KIND_LABEL[e.kind] || KIND_LABEL.main,
        fixed_cost: supplementary,
        parent_estimate: parent || null,
        customer_type_label: CUSTOMER_TYPE_LABEL[e.customer_type] || e.customer_type,
        is_external: external,
        needs_internal_approval: ESTIMATE_APPROVAL_REQUIRED && external && !e.internal_approved_at && e.status === 'draft',
        preference: pref,
      },
      lines: withPartOptions(lines, pref),
      // Per job and per category of the preference, alternatives apart (lib/workflow.js).
      pricing: summariseEstimatePricing(lines.filter(l => l.line_type !== 'discount'), pref),
      can_approve: canApproveEstimates(req.user),
      supplementaries,
      consents: consents.map(c => ({ ...c, line_ids: parseIds(c.line_ids) })),
      raise_supplementary: raiseSupplementary,
    });
  } catch (err) {
    console.error('GET /estimates/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch estimate' });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/estimates — create new estimate
// Body: { intake_work_order_id, kind: 'main' (default) | 'supplementary',
//         customer_type, receiving_form_id, advisor_id, valid_until,
//         vat_rate, lines: [{...}], enquiry_id,
//         parts_preference: ['genuine','after_market','used'] (any, ≥ 1;
//         default Genuine + After-Market; a supplementary estimate: one) }
// An estimate is for a work order (intake_work_order_id) — raised once its
// main job card is open (an external customer's acknowledgement of the
// physical inspection, 409 PHYSICAL_INSPECTION_REQUIRED) and its technical
// inspection is completed (409 TECHNICAL_INSPECTION_REQUIRED, client
// decision 3 Nov 2026). A quote from an enquiry or for a customer alone has
// no technical inspection, so it is refused the same way. One main estimate
// per job; once the customer has decided it, extra work is a supplementary
// estimate (raiseCheck: MAIN_ESTIMATE_DECIDED, MAIN_ESTIMATE_NOT_DECIDED,
// SUPPLEMENTARY_OPEN …), linked to it, its parts in one type: a fixed cost.
// ══════════════════════════════════════════════════════════════
router.post('/', requireCapability('estimate.raise'), async (req, res) => {
  try {
    let {
      customer_id, vehicle_id, customer_type,
      receiving_form_id, advisor_id, valid_until, vat_rate = 5,
      lines = [], intake_work_order_id, enquiry_id,
    } = req.body;
    if (customer_type && !CUSTOMER_TYPES.includes(customer_type)) {
      return res.status(400).json({ success: false, message: `Account type must be one of: ${CUSTOMER_TYPES.join(', ')}` });
    }
    const kind = [undefined, null, ''].includes(req.body.kind) ? 'main' : req.body.kind;
    if (!['main', 'supplementary'].includes(kind)) {
      return res.status(400).json({ success: false, message: 'kind must be main or supplementary' });
    }
    // The customer's parts preference: as sent, else as they asked at the
    // enquiry / work order (client review, 2 Nov 2026), else the default.
    let pref = preferenceFromBody(req.body.parts_preference);
    if (pref && !pref.length) return res.status(400).json({ success: false, code: 'PARTS_PREFERENCE_REQUIRED', message: PREFERENCE_REQUIRED });

    // Quote stage of the CRM cycle: an estimate raised from an enquiry.
    let enquiry = null;
    if (enquiry_id) {
      [enquiry] = await query('SELECT id, customer_id, vehicle_id, converted_work_order_id, parts_preference FROM enquiries WHERE id = ? AND workshop_id = ?',
        [enquiry_id, req.workshopId]);
      if (!enquiry) return res.status(404).json({ success: false, message: 'Enquiry not found' });
      customer_id = customer_id || enquiry.customer_id;
      vehicle_id = vehicle_id || enquiry.vehicle_id;
    }

    // Step 4: the estimate is for a visit already on the floor. Its customer
    // and vehicle come from the work order, and approval adds the approved
    // lines to that work order's job card instead of opening a second one.
    // It follows the completed technical inspection — with no work order
    // there is none (a quote from an enquiry, a customer alone): refused.
    if (!intake_work_order_id) {
      const r = noWorkOrderRefusal(!!enquiry);
      return res.status(r.status).json({ success: false, code: r.code, message: r.message });
    }
    // wo.* so the job's Step 1 snapshot (intake_customer_class /
    // _subcategory) is read when the work order has one.
    const [intakeWo] = await query(
      `SELECT wo.*, c.customer_class AS c_class, c.customer_subcategory AS c_subcategory
         FROM work_orders wo LEFT JOIN customers c ON c.id = wo.customer_id
        WHERE wo.id = ? AND wo.workshop_id = ?`, [intake_work_order_id, req.workshopId]);
    if (!intakeWo) return res.status(404).json({ success: false, message: 'Work order not found' });
    const check = await raiseCheck(intakeWo, req.workshopId, kind);
    if (!check.ok) {
      return res.status(check.status).json({
        success: false, code: check.code, message: check.message,
        ...(check.technical_inspection !== undefined ? { technical_inspection: check.technical_inspection } : {}),
        ...(check.main ? { main_estimate: { id: check.main.id, estimate_number: check.main.estimate_number, status: check.main.status } } : {}),
      });
    }
    const main = kind === 'supplementary' ? check.main : null;
    customer_id = customer_id || intakeWo.customer_id;
    vehicle_id = vehicle_id || intakeWo.vehicle_id;
    if (!customer_id && intakeWo.customer_name) req.body.customer_name = intakeWo.customer_name;

    // A supplementary estimate's fixed cost: its parts are priced in one type
    // — as sent, else the type the customer took on the main estimate — and
    // it is on the main estimate's account.
    if (main) {
      if (pref && pref.length !== 1) {
        return res.status(400).json({ success: false, code: 'FIXED_COST_ONE_TYPE',
          message: 'A supplementary estimate has a fixed cost: choose one part type (Genuine, After-Market or Used) for its parts.' });
      }
      if (!pref) pref = [await defaultFixedType(main)];
      customer_type = main.customer_type || customer_type;
    }

    if (!customer_id && !req.body.customer_name) {
      return res.status(400).json({ success: false, message: 'customer_id or customer_name required' });
    }
    if (!pref) pref = preferenceFromBody(intakeWo?.parts_preference || enquiry?.parts_preference) || DEFAULT_PREFERENCE;
    if (!pref.length) pref = DEFAULT_PREFERENCE;

    // Step 1 classification: the job's snapshot when it has one, else the
    // customer's record. "From the job card" (no account type sent) maps it
    // onto the estimate's account type. Internal is the one account type
    // that changes the process — it skips the Supervisor / Workshop Manager
    // approval of Step 5 — so raising an EXTERNAL job's estimate as internal
    // is a manager's decision, not an advisor's dropdown choice.
    let cls = intakeWo ? (intakeWo.intake_customer_class || intakeWo.c_class || null) : null;
    let sub = intakeWo ? (intakeWo.intake_customer_class ? intakeWo.intake_customer_subcategory : intakeWo.c_subcategory) || null : null;
    if (!cls && customer_id) {
      const [c] = await query('SELECT customer_class, customer_subcategory FROM customers WHERE id = ? AND workshop_id = ?', [customer_id, req.workshopId]);
      cls = c?.customer_class || null; sub = c?.customer_subcategory || null;
    }
    if (!customer_type) customer_type = accountTypeForClass(cls, sub);
    if (!main && customer_type === 'internal_fleet' && cls !== 'internal' && !isManagerRole(req.user)) {
      return res.status(403).json({
        success: false, code: 'ROLE_NOT_ALLOWED',
        message: 'This is an external customer: its estimate needs Supervisor / Workshop Manager approval, so it cannot be raised as Internal. Only a manager can do that.',
      });
    }

    // Resolve customer/vehicle snapshots
    let customerName = req.body.customer_name || '';
    let vehiclePlate = req.body.vehicle_plate || '';
    let vehicleVin   = req.body.vehicle_vin || '';

    if (customer_id) {
      // Was `SELECT name, phone` — customers has no `name` column (it's
      // `full_name`), so this threw ER_BAD_FIELD_ERROR and POST /estimates
      // 500'd on every call that passed a real customer_id rather than a
      // bare customer_name. Nothing in the frontend called this route yet,
      // which is the only reason it went unnoticed.
      const [cust] = await query('SELECT full_name, phone FROM customers WHERE id = ? AND workshop_id = ?', [customer_id, req.workshopId]);
      if (cust) customerName = cust.full_name;
    }
    if (vehicle_id) {
      const [veh] = await query('SELECT plate_number, vin FROM vehicles WHERE id = ? AND workshop_id = ?', [vehicle_id, req.workshopId]);
      if (veh) { vehiclePlate = veh.plate_number; vehicleVin = veh.vin || ''; }
    }

    // Estimate numbers are a random draw per day; a collision draws again.
    let estimate_number = null; let result = null;
    for (let attempt = 0; attempt < 6 && !result; attempt++) {
      estimate_number = genEstimateNumber(kind);
      try {
        result = await execute(
          `INSERT INTO service_estimates
             (workshop_id, estimate_number, kind, parent_estimate_id, receiving_form_id, customer_id, vehicle_id,
              customer_name, customer_type, vehicle_plate, vehicle_vin, advisor_id,
              valid_until, vat_rate, intake_work_order_id, enquiry_id, parts_preference, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [req.workshopId, estimate_number, kind, main?.id || null, receiving_form_id || null, customer_id || null,
           vehicle_id || null, customerName, customer_type, vehiclePlate, vehicleVin,
           advisor_id || req.user?.id, valid_until || null, parseFloat(vat_rate),
           intakeWo.id, main ? null : (enquiry?.id || null), pref.join(','), req.user?.id]
        );
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY' || !/estimate_number/.test(e.message)) throw e;
      }
    }
    if (!result) throw new Error('Could not allocate an estimate number');

    // Raising the estimate does not open the job card (D2): an external
    // job's is open already (checked above), an internal job's opened with it.
    const estimateId = result.insertId;
    await insertEstimateLines(estimateId, req.workshopId, lines, { user: req.user, pref });
    const totals = await recalcEstimateTotals(estimateId);
    if (enquiry && !main) await markEnquiryQuoted({ workshopId: req.workshopId, enquiryId: enquiry.id, amount: totals.total_amount, userId: req.user?.id });

    // Step 5: the Storekeeper prices the parts.
    const savedLines = await query('SELECT * FROM estimate_lines WHERE estimate_id = ?', [estimateId]);
    const unpriced = savedLines.filter(l => partLineUnpriced(l, pref)).length;
    if (unpriced) {
      await notifyStoreToPrice({ workshopId: req.workshopId, estimateId, estimateNumber: estimate_number, count: unpriced, pref,
        customerName, plate: vehiclePlate, orderId: intakeWo.id, exceptUserId: req.user?.id, kind });
    }

    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id, action: 'CREATE', entityType: 'service_estimates',
      entityId: estimateId, newValue: { estimate_number, kind, parent_estimate_id: main?.id || null, total_amount: totals.total_amount, parts_preference: pref },
    });

    res.status(201).json({ success: true, estimateId, estimate_number, kind, parts_to_price: unpriced, parts_preference: pref,
      parent_estimate: main ? { id: main.id, estimate_number: main.estimate_number } : null,
      customer_type, customer_type_label: CUSTOMER_TYPE_LABEL[customer_type] });
  } catch (err) {
    console.error('POST /estimates error:', err);
    res.status(500).json({ success: false, message: 'Failed to create estimate' });
  }
});

// ══════════════════════════════════════════════════════════════
// PUT /api/estimates/:id — update (creates new version if approved)
// ══════════════════════════════════════════════════════════════
router.put('/:id', requireCapability('estimate.raise'), async (req, res) => {
  try {
    const [est] = await query(
      'SELECT * FROM service_estimates WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!est) return res.status(404).json({ success: false, message: 'Estimate not found' });
    if (['converted', 'expired'].includes(est.status)) {
      return res.status(400).json({ success: false, message: `Cannot edit estimate in status: ${est.status}` });
    }

    const { lines = [], valid_until, advisor_id, notes } = req.body;
    const vat_rate = parseFloat(req.body.vat_rate || est.vat_rate || 5);
    // The customer's parts preference may change with the edit; a category
    // added to it goes back to the Store.
    const sentPref = preferenceFromBody(req.body.parts_preference);
    if (sentPref && !sentPref.length) return res.status(400).json({ success: false, code: 'PARTS_PREFERENCE_REQUIRED', message: PREFERENCE_REQUIRED });
    const oldPref = partsPreference(est);
    const pref = sentPref || oldPref;
    if (isSupplementary(est)) {
      // Its fixed cost is what the customer consents to: once they have
      // started deciding it, it stays as it is — further work is another
      // supplementary estimate.
      const [decided] = await query("SELECT COUNT(*) AS n FROM estimate_lines WHERE estimate_id = ? AND customer_status <> 'pending'", [est.id]);
      if (Number(decided?.n) > 0) {
        return res.status(409).json({ success: false, code: 'SUPPLEMENTARY_DECIDED',
          message: 'The customer has started deciding this supplementary estimate at its fixed cost, so it can no longer be changed. Raise another supplementary estimate for further work.' });
      }
      if (pref.length !== 1) {
        return res.status(400).json({ success: false, code: 'FIXED_COST_ONE_TYPE',
          message: 'A supplementary estimate has a fixed cost: choose one part type (Genuine, After-Market or Used) for its parts.' });
      }
    }

    await execute(
      `UPDATE service_estimates SET
         valid_until = ?, advisor_id = ?, vat_rate = ?, parts_preference = ?,
         status = CASE WHEN status = 'sent_to_customer' THEN 'draft' ELSE status END,
         -- the sign-off was for the old prices
         internal_approved_by = NULL, internal_approved_at = NULL,
         version = version + 1
       WHERE id = ? AND workshop_id = ?`,
      [valid_until || est.valid_until, advisor_id || est.advisor_id, vat_rate, pref.join(','), req.params.id, req.workshopId]
    );
    const existingRows = await query('SELECT * FROM estimate_lines WHERE estimate_id = ?', [req.params.id]);
    const existingById = new Map(existingRows.map(r => [r.id, r]));
    const unpricedBefore = existingRows.filter(l => partLineUnpriced(l, oldPref)).length;

    // Replace lines (prices the editor may not set are carried over by id)
    await execute('DELETE FROM estimate_lines WHERE estimate_id = ?', [req.params.id]);
    await insertEstimateLines(req.params.id, req.workshopId, lines, { user: req.user, pref, existingById });
    await recalcEstimateTotals(req.params.id);

    // New part lines, or a category the Store has not priced yet: tell the Store.
    const saved = await query('SELECT * FROM estimate_lines WHERE estimate_id = ?', [req.params.id]);
    const unpriced = saved.filter(l => partLineUnpriced(l, pref)).length;
    if (unpriced > unpricedBefore) {
      await notifyStoreToPrice({ workshopId: req.workshopId, estimateId: est.id, estimateNumber: est.estimate_number, count: unpriced, pref,
        customerName: est.customer_name, plate: est.vehicle_plate, orderId: est.intake_work_order_id || null, exceptUserId: req.user?.id, version: Number(est.version) + 1,
        kind: est.kind || 'main' });
    }

    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id, action: 'UPDATE', entityType: 'service_estimates',
      entityId: req.params.id, newValue: { action: 'edit_estimate', parts_preference: pref },
    });
    res.json({ success: true, message: 'Estimate updated', parts_to_price: unpriced, parts_preference: pref });
  } catch (err) {
    console.error('PUT /estimates/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to update estimate' });
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/estimates/:id/status — change estimate status
// body: { status: 'sent_to_customer'|'approved'|'rejected'|... }
// ══════════════════════════════════════════════════════════════
router.patch('/:id/status', requireCapability('estimate.raise'), async (req, res) => {
  try {
    const { status, customer_notes } = req.body;
    // 'approved' / 'partially_approved' are not settable here: they are only
    // ever the roll-up of the customer's line decisions (applyLineDecision).
    // Setting them by hand let staff approve on the customer's behalf and
    // convert an estimate nobody had agreed to — a job card worth 0. A
    // customer who agrees in person is recorded line by line through
    // PATCH /:id/lines/:lineId/approve, which stamps the channel.
    if (['approved', 'partially_approved'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Approval comes from the customer\'s decision on each line, not from a status change. Record an in-person decision on each line instead.',
      });
    }
    const VALID = ['draft','sent_to_customer','rejected','expired'];
    if (!VALID.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const [est] = await query(
      'SELECT * FROM service_estimates WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!est) return res.status(404).json({ success: false, message: 'Estimate not found' });
    if (est.work_order_id || est.status === 'converted') {
      return res.status(400).json({ success: false, message: 'This estimate is already a job card.' });
    }

    await execute(
      `UPDATE service_estimates SET status = ?, customer_notes = COALESCE(?, customer_notes),
       customer_approved_at = CASE WHEN ? IN ('approved','partially_approved') THEN NOW() ELSE customer_approved_at END
       WHERE id = ? AND workshop_id = ?`,
      [status, customer_notes || null, status, req.params.id, req.workshopId]
    );

    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id, action: 'STATUS_CHANGE', entityType: 'service_estimates',
      entityId: req.params.id, oldValue: est.status, newValue: { new_status: status },
    });
    res.json({ success: true, message: `Estimate ${status}` });
  } catch (err) {
    console.error('PATCH /estimates/:id/status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update estimate status' });
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/estimates/:id/lines/:lineId/approve
// Customer approves/rejects individual lines (req 69), in person. A
// supplementary estimate's approval records their consent: body.consent =
// { agreed: true, name: <the customer's name>, amount: <the fixed cost shown> }.
// ══════════════════════════════════════════════════════════════
router.patch('/:id/lines/:lineId/approve', requireCapability('customer.approval'), async (req, res) => {
  try {
    const { customer_status, reason, part_option, consent } = req.body; // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(customer_status)) {
      return res.status(400).json({ success: false, message: 'customer_status must be approved or rejected' });
    }

    const result = await applyLineDecision({
      estimateId: req.params.id, lineId: req.params.lineId, workshopId: req.workshopId,
      decision: customer_status, responder: { channel: 'in_person' }, actingUserId: req.user?.id, reason, partOption: part_option, consent,
    });
    if (!result.ok) return res.status(result.status).json({ success: false, code: result.code, message: result.message, ...(result.amount !== undefined ? { amount: result.amount } : {}) });

    res.json({
      success: true, message: `Line ${customer_status}`, estimate_status: result.estimate_status,
      work_order_id: result.work_order_id, work_order_number: result.work_order_number,
      added_to_job: !!result.added_to_job,
    });
  } catch (err) {
    console.error('PATCH /estimates/:id/lines/:lineId/approve error:', err);
    res.status(500).json({ success: false, message: 'Failed to update line approval' });
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/estimates/:id/lines/:lineId/pricing — Storekeeper (Step 5)
// Body, for each category of the customer's parts preference (fields not
// sent keep their value):
//   genuine_price, genuine_available, genuine_expected_date
//   aftermarket_price, aftermarket_available, aftermarket_expected_date
//   used_price, used_available, used_expected_date
// *_available: false = not available (no price); *_expected_date
// 'YYYY-MM-DD' = expected delivery, null = in stock. Optional: quantity
// (the confirmed quantity, for every category), part_number, and
//   alternative: { option, for, price, expected_date } — a category the
//   customer did not ask for, offered because `for` (a requested category)
//   is not available; null withdraws it. It is shown to the customer as an
//   alternative needing their approval and never counts by itself.
// ══════════════════════════════════════════════════════════════
router.patch('/:id/lines/:lineId/pricing', async (req, res) => {
  try {
    if (!can(req.user, 'estimate.price_parts')) {
      return res.status(403).json({ success: false, message: 'Parts are priced by the Storekeeper.' });
    }
    const [est] = await query('SELECT * FROM service_estimates WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!est) return res.status(404).json({ success: false, message: 'Estimate not found' });
    if (est.work_order_id || ['converted', 'expired', 'rejected'].includes(est.status)) {
      return res.status(409).json({ success: false, message: `This estimate is ${est.status} — it can no longer be priced.` });
    }
    // A supplementary estimate goes out at a fixed cost: priced before it is
    // sent, in its one part type, with no alternative for the customer to weigh.
    if (isSupplementary(est) && est.status !== 'draft') {
      return res.status(409).json({ success: false, code: 'FIXED_COST_SENT',
        message: 'This supplementary estimate has gone to the customer at a fixed cost — its prices can no longer change.' });
    }
    if (isSupplementary(est) && req.body?.alternative) {
      return res.status(400).json({ success: false, code: 'FIXED_COST_NO_ALTERNATIVE',
        message: 'A supplementary estimate has a fixed cost in one part type — no alternative is offered. Mark the part not available and the Service Advisor will change the line.' });
    }
    const [line] = await query('SELECT * FROM estimate_lines WHERE id = ? AND estimate_id = ?', [req.params.lineId, est.id]);
    if (!line) return res.status(404).json({ success: false, message: 'Line not found' });
    if (line.line_type !== 'parts') return res.status(400).json({ success: false, message: 'Only parts lines are priced by the Store; labour is priced by the Service Advisor.' });

    const pref = partsPreference(est);
    const b = req.body || {};
    const bad = message => res.status(400).json({ success: false, message });
    const row = { ...line };

    // The categories the customer asked for.
    for (const c of PART_CATEGORIES) {
      const col = categoryColumns(c);
      const sent = [col.price, col.available, col.expected, col.partNumber].some(f => b[f] !== undefined);
      if (!sent) continue;
      if (!pref.includes(c)) {
        return bad(`The customer did not ask for ${PART_CATEGORY_LABEL[c]} parts — offer it as an alternative when a requested type is not available.`);
      }
      if (b[col.price] !== undefined && b[col.price] !== null && b[col.price] !== '' && numOrNull(b[col.price]) == null) {
        return bad(`The ${PART_CATEGORY_LABEL[c]} price must be a number, zero or more.`);
      }
      if (b[col.expected] && !dateOrNull(b[col.expected])) return bad(`The ${PART_CATEGORY_LABEL[c]} delivery date must be a date (YYYY-MM-DD).`);
      const available = flagOrNull(b[col.available]) ?? (numOrNull(b[col.price]) != null ? 1 : row[col.available]);
      row[col.available] = available;
      row[col.price] = available === 0 ? null : (b[col.price] !== undefined ? numOrNull(b[col.price]) : row[col.price]);
      row[col.expected] = available === 0 ? null : (b[col.expected] !== undefined ? dateOrNull(b[col.expected]) : row[col.expected]);
      // Each type has its own part number (client review, 2 Nov 2026).
      row[col.partNumber] = available === 0 ? null : (b[col.partNumber] !== undefined ? partNoOrNull(b[col.partNumber]) : row[col.partNumber]);
    }
    if (!pref.some(c => partOptions(row, [c]).requested[0].decided)) {
      return bad(`Enter the ${categoryWords(pref)} price, or mark it not available.`);
    }

    // The alternative, when a requested category is not available.
    if (b.alternative === null) {
      if (row.alternative_option && !pref.includes(row.alternative_option)) for (const f of Object.values(categoryColumns(row.alternative_option))) row[f] = null;
      for (const f of ALTERNATIVE_FIELDS) row[f] = null;
    } else if (b.alternative !== undefined) {
      const alt = b.alternative || {};
      const unavailable = pref.filter(c => partOptions(row, [c]).requested[0].available === false);
      if (!PART_CATEGORIES.includes(alt.option) || pref.includes(alt.option)) {
        return bad(`An alternative has to be a type the customer did not ask for (${PART_CATEGORIES.filter(c => !pref.includes(c)).map(c => PART_CATEGORY_LABEL[c]).join(' or ') || 'none left'}).`);
      }
      if (!unavailable.length) return bad('An alternative is offered only when a requested type is not available — mark it not available first.');
      if (alt.for !== undefined && alt.for !== null && !unavailable.includes(alt.for)) {
        return bad(`${PART_CATEGORY_LABEL[alt.for] || 'That type'} is not a requested type marked not available.`);
      }
      if (numOrNull(alt.price) == null) return bad(`Enter the price of the ${PART_CATEGORY_LABEL[alt.option]} alternative.`);
      if (alt.expected_date && !dateOrNull(alt.expected_date)) return bad('The alternative’s delivery date must be a date (YYYY-MM-DD).');
      if (row.alternative_option && row.alternative_option !== alt.option && !pref.includes(row.alternative_option)) {
        for (const f of Object.values(categoryColumns(row.alternative_option))) row[f] = null;
      }
      const col = categoryColumns(alt.option);
      row[col.price] = numOrNull(alt.price); row[col.available] = 1; row[col.expected] = dateOrNull(alt.expected_date);
      row[col.partNumber] = partNoOrNull(alt.part_number);
      row.alternative_option = alt.option; row.alternative_for = alt.for || unavailable[0]; row.alternative_approved = null;
    }
    tidyAlternative(row, pref);

    if (b.quantity !== undefined && b.quantity !== null && b.quantity !== '') {
      if (!(Number(b.quantity) > 0)) return bad('The quantity must be more than zero.');
      row.quantity = Number(b.quantity);
    }
    const unitPrice = countedPartPrice(row, pref, 0);
    await execute(
      `UPDATE estimate_lines
          SET genuine_price = ?, genuine_available = ?, genuine_expected_date = ?,
              aftermarket_price = ?, aftermarket_available = ?, aftermarket_expected_date = ?,
              used_price = ?, used_available = ?, used_expected_date = ?,
              genuine_part_number = ?, aftermarket_part_number = ?, used_part_number = ?,
              alternative_option = ?, alternative_for = ?, alternative_approved = ?,
              quantity = ?, unit_price = ?, part_number = COALESCE(?, part_number), priced_by = ?, priced_at = NOW()
        WHERE id = ?`,
      [row.genuine_price, row.genuine_available, row.genuine_expected_date,
       row.aftermarket_price, row.aftermarket_available, row.aftermarket_expected_date,
       row.used_price, row.used_available, row.used_expected_date,
       row.genuine_part_number ?? null, row.aftermarket_part_number ?? null, row.used_part_number ?? null,
       row.alternative_option, row.alternative_for, row.alternative_approved,
       row.quantity, unitPrice, b.part_number ? String(b.part_number).slice(0, 100) : null, req.user.id, line.id]
    );
    // Prices changed: a sign-off given on the old ones no longer stands.
    await execute('UPDATE service_estimates SET internal_approved_by = NULL, internal_approved_at = NULL WHERE id = ? AND status = \'draft\'', [est.id]);
    const totals = await recalcEstimateTotals(est.id);

    const lines = await query('SELECT * FROM estimate_lines WHERE estimate_id = ?', [est.id]);
    const remaining = lines.filter(l => partLineUnpriced(l, pref)).length;
    if (!remaining) {
      // Pricing done — the advisor who raised it is next.
      const alternatives = lines.filter(l => l.line_type === 'parts' && partOptions(l, pref).alternative).length;
      const to = [...new Set([est.advisor_id, est.created_by].filter(Boolean))].filter(id => id !== req.user.id);
      for (const userId of to) {
        await createInAppNotification({
          workshopId: req.workshopId, userId, title: `Parts priced: estimate ${est.estimate_number}`,
          body: `The Store has priced every part (${categoryWords(pref)})` +
            `${alternatives ? ` and offered ${alternatives} alternative${alternatives > 1 ? 's' : ''} for the customer's approval` : ''}. Check the labour and send it to the customer.`,
          type: 'workflow_parts_priced', icon: '🏷️', link: `/estimates?id=${est.id}`, orderId: est.intake_work_order_id || null,
        });
      }
    }
    const pick = r => Object.fromEntries([...CATEGORY_FIELDS, ...ALTERNATIVE_FIELDS, 'quantity'].map(f => [f, r[f] ?? null]));
    await logAudit({ workshopId: req.workshopId, userId: req.user.id, action: 'PRICE_PARTS', entityType: 'estimate_lines', entityId: line.id,
      oldValue: pick(line), newValue: pick(row) });
    const [saved] = withPartOptions(lines.filter(l => l.id === line.id), pref);
    res.json({ success: true, unit_price: unitPrice, parts_left_to_price: remaining, total_amount: totals.total_amount, line: saved || null });
  } catch (err) {
    console.error('PATCH /estimates/:id/lines/:lineId/pricing error:', err);
    res.status(500).json({ success: false, message: 'Failed to price the part' });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/estimates/:id/send — email the customer an approval link
// ══════════════════════════════════════════════════════════════
router.post('/:id/send', requireCapability('estimate.raise'), async (req, res) => {
  try {
    const [est] = await query(
      'SELECT * FROM service_estimates WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!est) return res.status(404).json({ success: false, message: 'Estimate not found' });
    if (est.work_order_id) {
      return res.status(400).json({ success: false, message: 'Already converted to a job card' });
    }

    // The estimate goes out in the customer's parts preference, as raised.
    // The old Format 1/2/3 (body `format`) still narrows it to Genuine and/or
    // After-Market when those were asked for; otherwise it is ignored.
    let pref = partsPreference(est);
    const narrowed = FORMAT_PREFERENCE[req.body.format];
    if (narrowed && narrowed.every(c => pref.includes(c))) pref = narrowed;

    // Step 5 order: parts priced by the Store, labour by the advisor, then send.
    const priceCheck = await query('SELECT * FROM estimate_lines WHERE estimate_id = ?', [est.id]);
    const unpricedParts = priceCheck.filter(l => partLineUnpriced(l, pref)).length;
    if (unpricedParts) {
      return res.status(409).json({ success: false, code: 'PARTS_NOT_PRICED',
        message: `${unpricedParts} part line${unpricedParts > 1 ? 's are' : ' is'} waiting for the Storekeeper's price (${categoryWords(pref)}).` });
    }
    if (priceCheck.some(l => l.line_type === 'labour' && !(Number(l.unit_price) > 0))) {
      return res.status(409).json({ success: false, code: 'LABOUR_NOT_PRICED', message: 'Price the labour before sending.' });
    }
    if (isSupplementary(est)) {
      // A fixed cost: every line goes out with its firm price — a part not
      // available in the estimate's type has to be changed or removed first.
      const notOffered = priceCheck.filter(l => l.line_type === 'parts' && hasCategoryPricing(l) && !partOptions(l, pref).requested.some(o => o.usable));
      if (notOffered.length) {
        return res.status(409).json({ success: false, code: 'FIXED_COST_INCOMPLETE',
          message: `${notOffered.map(l => `“${l.description}”`).join(', ')} ${notOffered.length > 1 ? 'are' : 'is'} not available as ${categoryWords(pref)}. ` +
            'A supplementary estimate goes out at a fixed cost — change or remove it (Edit) before sending.' });
      }
      const [job] = est.intake_work_order_id ? await query('SELECT status FROM work_orders WHERE id = ? AND workshop_id = ?', [est.intake_work_order_id, req.workshopId]) : [];
      if (!job || ['completed', 'cancelled'].includes(job.status)) {
        return res.status(409).json({ success: false, code: 'JOB_CLOSED', message: 'The job is closed — a supplementary estimate can no longer go out for it.' });
      }
      const [parent] = est.parent_estimate_id ? await query('SELECT estimate_number FROM service_estimates WHERE id = ?', [est.parent_estimate_id]) : [];
      est.parent_estimate_number = parent?.estimate_number || null;
    }
    // Kept for the screens that still read the format: genuine / after_market
    // / both, or null for a preference with Used.
    const format = formatOfPreference(pref);
    const channel = req.body.channel === 'whatsapp' ? 'whatsapp' : 'email';

    // Process step 5: an external customer's estimate is signed off by a
    // supervisor or workshop manager before it goes out. A manager sending
    // it themselves signs it off in the same step.
    if (ESTIMATE_APPROVAL_REQUIRED && !est.internal_approved_at && await isExternalEstimate(est)) {
      if (!canApproveEstimates(req.user)) {
        await notifyApprovers(est, req.workshopId);
        return res.status(409).json({
          success: false, code: 'MANAGER_APPROVAL_REQUIRED',
          message: 'Saved. A supervisor or workshop manager has to approve this estimate before it goes to the customer — they have been notified.',
        });
      }
      await execute('UPDATE service_estimates SET internal_approved_by = ?, internal_approved_at = NOW() WHERE id = ?', [req.user.id, est.id]);
    }

    let customerEmail = req.body.email || '';
    if (!customerEmail && est.customer_id) {
      const [cust] = await query('SELECT email FROM customers WHERE id = ?', [est.customer_id]);
      customerEmail = cust?.email || '';
    }
    if (channel === 'email' && !customerEmail) {
      return res.status(400).json({ success: false, message: 'No email on file for this customer — send it by WhatsApp, or pass an email.' });
    }

    await execute('UPDATE service_estimates SET parts_preference = ?, estimate_format = ? WHERE id = ?', [pref.join(','), format, est.id]);
    const sentTotals = await applyPreferencePrices(est.id, pref);
    est.total_amount = sentTotals.total_amount;

    const lines = await query('SELECT * FROM estimate_lines WHERE estimate_id = ? ORDER BY sort_order, id', [req.params.id]);
    const message = estimateMessage(est, lines, pref);

    // Re-issuing keeps the same token unless the previous one already
    // expired or was consumed by a decision (status moved past
    // sent_to_customer) — no reason to invalidate a link that is still live
    // just because someone clicked "resend".
    let token = est.approval_token;
    const expired = !est.approval_token_expires_at || new Date(est.approval_token_expires_at) < new Date();
    if (!token || expired || est.status !== 'draft' && est.status !== 'sent_to_customer') {
      token = crypto.randomBytes(24).toString('hex');
    }
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days

    await execute(
      `UPDATE service_estimates
          SET approval_token = ?, approval_token_expires_at = ?, sent_to_customer_at = NOW(),
              status = IF(status = 'draft', 'sent_to_customer', status)
        WHERE id = ?`,
      [token, expiresAt, req.params.id]
    );
    // Follow up: chase the decision if the customer hasn't answered in 48 hours.
    await createTask({
      workshopId: req.workshopId, title: `Chase decision on ${est.estimate_number}${est.customer_name ? ` — ${est.customer_name}` : ''}`,
      details: `Sent ${channel === 'whatsapp' ? 'by WhatsApp' : 'by e-mail'}; follow up if the customer has not approved or rejected it.`,
      taskType: 'quote_chase', customerId: est.customer_id || null, vehicleId: est.vehicle_id || null,
      relatedType: 'quote', relatedId: est.id, assignedTo: est.advisor_id || req.user?.id || null,
      dueAt: new Date(Date.now() + 48 * 3600 * 1000), createdBy: req.user?.id || null,
    });

    const approvalUrl = estimateApprovalUrl(token);
    if (channel === 'whatsapp') {
      const [cust] = est.customer_id ? await query('SELECT phone FROM customers WHERE id = ?', [est.customer_id]) : [];
      const phone = String(req.body.phone || cust?.phone || '').replace(/[^\d]/g, '');
      const text = `${message.text} Please review and approve each item here: ${approvalUrl}`;
      await logAudit({
        workshopId: req.workshopId, userId: req.user?.id, action: 'SEND', entityType: 'service_estimates',
        entityId: req.params.id, oldValue: est.status, newValue: { channel: 'whatsapp', parts_preference: pref },
      });
      return res.json({
        success: true, message: 'Ready to send on WhatsApp', approval_url: approvalUrl, format, parts_preference: pref,
        whatsapp_url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
      });
    }

    const sent = await sendNotificationEmail({
      to: customerEmail,
      tenantId: req.workshopId,
      ...(isSupplementary(est) ? {
        subject: `Supplementary estimate ${est.estimate_number} — additional work, your consent needed`,
        title: 'Additional work on your vehicle',
        body: `While working on ${est.vehicle_plate ? `your vehicle (${esc(est.vehicle_plate)})` : 'your vehicle'} we found additional work` +
          `${est.parent_estimate_number ? `, beyond estimate ${esc(est.parent_estimate_number)}` : ''}. It is offered at a fixed cost: ` +
          `please review each item and approve it with your consent, or reject it. No additional work is carried out without your approval.${message.html}`,
      } : {
        subject: `Estimate ${est.estimate_number} — approval needed`,
        title: 'Your service estimate is ready',
        body: `We've prepared an estimate for ${est.vehicle_plate ? `your vehicle (${esc(est.vehicle_plate)})` : 'your vehicle'}. ` +
          `Please review each item and approve or reject it before we begin any work.${message.html}`,
      }),
      ctaText: 'Review and approve',
      ctaUrl: approvalUrl,
      expiryNote: 'This link expires in 7 days.',
    });
    // No SMTP, or the server refused it: say so. The link above stays live,
    // so the advisor can send it by WhatsApp or copy it instead.
    if (!sent?.success) {
      return res.status(502).json({
        success: false, code: 'EMAIL_FAILED',
        message: 'The e-mail could not be sent — send it by WhatsApp, or copy the link.',
        approval_url: approvalUrl, format, parts_preference: pref,
      });
    }

    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id, action: 'SEND', entityType: 'service_estimates',
      entityId: req.params.id, oldValue: est.status, newValue: { sent_to: customerEmail, parts_preference: pref },
    });

    res.json({ success: true, message: `Sent to ${customerEmail}`, approval_url: approvalUrl, format, parts_preference: pref });
  } catch (err) {
    console.error('POST /estimates/:id/send error:', err);
    res.status(500).json({ success: false, message: 'Failed to send the estimate' });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/estimates/:id/internal-approve — supervisor / manager sign-off
// for an external customer's estimate (process step 5). Does not send it.
// ══════════════════════════════════════════════════════════════
router.post('/:id/internal-approve', async (req, res) => {
  try {
    if (!canApproveEstimates(req.user)) {
      return res.status(403).json({ success: false, message: 'Only a supervisor or workshop manager can approve estimates.' });
    }
    const [est] = await query('SELECT * FROM service_estimates WHERE id = ? AND workshop_id = ?', [req.params.id, req.workshopId]);
    if (!est) return res.status(404).json({ success: false, message: 'Estimate not found' });
    if (est.status !== 'draft') {
      return res.status(400).json({ success: false, message: `This estimate is already ${est.status.replace(/_/g, ' ')}.` });
    }
    await execute('UPDATE service_estimates SET internal_approved_by = ?, internal_approved_at = NOW() WHERE id = ?', [req.user.id, est.id]);
    await logAudit({
      workshopId: req.workshopId, userId: req.user.id, action: 'INTERNAL_APPROVE', entityType: 'service_estimates',
      entityId: est.id, newValue: { estimate_number: est.estimate_number, total_amount: est.total_amount },
    });
    // Tell whoever raised it that it can go out now.
    const recipients = new Set([est.advisor_id, est.created_by].filter(id => id && id !== req.user.id));
    for (const userId of recipients) {
      await createInAppNotification({
        workshopId: req.workshopId, userId,
        title: `Estimate ${est.estimate_number} approved — ready to send`,
        body: `${req.user.full_name || 'A manager'} approved it. Send it to the customer from the Estimates screen.`,
        type: 'success', icon: '✅', link: `/estimates?id=${est.id}`,
      });
    }
    res.json({ success: true, message: 'Estimate approved — it can be sent to the customer now.' });
  } catch (err) {
    console.error('POST /estimates/:id/internal-approve error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve the estimate' });
  }
});

/** Step 5: the Store is told which part lines to price, in the categories the customer asked for. */
async function notifyStoreToPrice({ workshopId, estimateId, estimateNumber, count, pref, customerName, plate, orderId = null, exceptUserId = null, version = 1, kind = 'main' }) {
  await notifyGroups(workshopId, ['storekeeper'], {
    title: `Price parts: ${kind === 'supplementary' ? 'supplementary estimate' : 'estimate'} ${estimateNumber}`,
    body: `${count} part line${count > 1 ? 's' : ''} for ${customerName || 'a customer'}${plate ? ` (${plate})` : ''} — ` +
      (kind === 'supplementary'
        ? `a fixed-cost supplementary estimate, priced in ${categoryWords(pref)} only: the price and delivery for each.`
        : `the customer asked for ${categoryWords(pref)}: availability, price and delivery for each, or mark it not available.`),
    // An edit (a new version) is its own notice — the type is the hour's dedup key.
    link: `/estimates?id=${estimateId}`, orderId, icon: '🏷️', type: `workflow_price_parts_${estimateId}${version > 1 ? `_v${version}` : ''}`, exceptUserId,
  });
}

async function notifyApprovers(est, workshopId) {
  try {
    for (const u of await estimateApprovers(workshopId)) {
      await createInAppNotification({
        workshopId, userId: u.id,
        title: `Estimate ${est.estimate_number} needs your approval`,
        body: `${est.customer_name || 'An external customer'} — AED ${Number(est.total_amount).toFixed(2)}. Approve it before it is sent.`,
        type: 'warning', icon: '📝', link: `/estimates?id=${est.id}`,
      });
    }
  } catch (err) {
    console.error('[Estimates] approver notification failed:', err.message);
  }
}

// ══════════════════════════════════════════════════════════════
// POST /api/estimates/:id/convert-to-work-order
// Creates a work order from an approved estimate (req 69)
// ══════════════════════════════════════════════════════════════
router.post('/:id/convert-to-work-order', requireCapability('customer.approval'), async (req, res) => {
  try {
    const [est] = await query(
      'SELECT * FROM service_estimates WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]
    );
    if (!est) return res.status(404).json({ success: false, message: 'Estimate not found' });
    if (!['approved','partially_approved'].includes(est.status)) {
      return res.status(400).json({ success: false, message: 'Estimate must be approved before converting' });
    }
    if (est.work_order_id) {
      return res.status(400).json({ success: false, message: 'Already converted to work order ' + est.work_order_id });
    }

    const converted = await convertEstimateToWorkOrder(est, req.workshopId);
    if (!converted) {
      // A supplementary estimate's work joins its own job, which may have closed meanwhile.
      const [locked] = await query('SELECT work_order_id FROM service_estimates WHERE id = ?', [est.id]);
      if (isSupplementary(est) && !locked?.work_order_id) {
        return res.status(409).json({ success: false, code: 'JOB_CLOSED', message: 'The job this supplementary estimate belongs to is closed — its work cannot be added any more.' });
      }
      return res.status(409).json({ success: false, message: 'This estimate was converted a moment ago by someone else.' });
    }
    const { workOrderId, wo_number } = converted;

    await logAudit({
      workshopId: req.workshopId, userId: req.user?.id, action: 'CONVERT', entityType: 'service_estimates',
      entityId: req.params.id, newValue: { work_order_id: workOrderId, wo_number },
    });

    res.json({ success: true, workOrderId, work_order_number: wo_number });
  } catch (err) {
    console.error('POST /estimates/:id/convert-to-work-order error:', err);
    res.status(500).json({ success: false, message: 'Failed to convert estimate' });
  }
});

// ══════════════════════════════════════════════════════════════
// Operations Master CRUD (req 70) — sub-resource
// GET  /api/estimates/operations-master
// POST /api/estimates/operations-master
// GET  /api/estimates/operations-master/:id
// PUT  /api/estimates/operations-master/:id
// ══════════════════════════════════════════════════════════════

router.get('/operations-master/list', async (req, res) => {
  try {
    const { make, model, category, search } = req.query;
    let sql = `SELECT * FROM operations_master WHERE workshop_id = ? AND is_active = 1`;
    const params = [req.workshopId];
    if (make) { sql += ' AND (vehicle_make IS NULL OR vehicle_make = ?)'; params.push(make); }
    if (model) { sql += ' AND (vehicle_model IS NULL OR vehicle_model = ?)'; params.push(model); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (search) { sql += ' AND (name LIKE ? OR code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY name ASC';
    const rows = await query(sql, params);
    res.json({ success: true, operations: rows });
  } catch (err) {
    console.error('GET /operations-master error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch operations' });
  }
});

router.post('/operations-master', async (req, res) => {
  try {
    const {
      code, name, description, vehicle_make, vehicle_model,
      service_interval, category, standard_hours, labour_rate_override, parts_json
    } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'code and name are required' });
    }
    const result = await execute(
      `INSERT INTO operations_master
         (workshop_id, code, name, description, vehicle_make, vehicle_model,
          service_interval, category, standard_hours, labour_rate_override, parts_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [req.workshopId, code, name, description || null, vehicle_make || null,
       vehicle_model || null, service_interval || null, category || null,
       standard_hours || null, labour_rate_override || null,
       parts_json ? JSON.stringify(parts_json) : null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Operation code already exists' });
    }
    console.error('POST /operations-master error:', err);
    res.status(500).json({ success: false, message: 'Failed to create operation' });
  }
});

router.put('/operations-master/:opId', async (req, res) => {
  try {
    const {
      name, description, vehicle_make, vehicle_model, service_interval,
      category, standard_hours, labour_rate_override, parts_json, is_active
    } = req.body;
    await execute(
      `UPDATE operations_master SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         vehicle_make = ?,
         vehicle_model = ?,
         service_interval = COALESCE(?, service_interval),
         category = COALESCE(?, category),
         standard_hours = COALESCE(?, standard_hours),
         labour_rate_override = ?,
         parts_json = COALESCE(?, parts_json),
         is_active = COALESCE(?, is_active)
       WHERE id = ? AND workshop_id = ?`,
      [name || null, description || null, vehicle_make || null, vehicle_model || null,
       service_interval || null, category || null, standard_hours || null,
       labour_rate_override !== undefined ? labour_rate_override : null,
       parts_json ? JSON.stringify(parts_json) : null,
       is_active !== undefined ? is_active : null,
       req.params.opId, req.workshopId]
    );
    res.json({ success: true, message: 'Operation updated' });
  } catch (err) {
    console.error('PUT /operations-master/:opId error:', err);
    res.status(500).json({ success: false, message: 'Failed to update operation' });
  }
});

// ══════════════════════════════════════════════════════════════
// PUBLIC — no auth. Reached only via the token emailed in POST /:id/send.
// Rate-limited by estimateApprovalLimiter (lib/rate-limits.js): roomy enough
// for a customer to decide every line of a long estimate, tight enough to cap
// a runaway client. The 192-bit token is what stops guessing.
// ══════════════════════════════════════════════════════════════

async function loadByToken(token, res) {
  const [est] = await query('SELECT * FROM service_estimates WHERE approval_token = ?', [token]);
  if (!est) { res.status(404).json({ success: false, message: 'This link is not valid.' }); return null; }
  if (est.approval_token_expires_at && new Date(est.approval_token_expires_at) < new Date()) {
    res.status(410).json({ success: false, message: 'This link has expired. Ask the workshop to resend it.' });
    return null;
  }
  return est;
}

// GET /api/public/estimates/:token — read-only view for the customer.
// unit_cost never leaves this file: it is the workshop's own cost on the
// part or job, and exposing it alongside unit_price would hand the customer
// the margin on every line.
publicRouter.get('/:token', estimateApprovalLimiter, async (req, res) => {
  try {
    const est = await loadByToken(req.params.token, res);
    if (!est) return;

    // The per-category prices are what the customer is choosing between —
    // selling prices, not the workshop's cost. Each part line carries its
    // `options`: the requested categories and the alternative (if any).
    const pref = partsPreference(est);
    const lines = await query(
      `SELECT id, line_type, description, job_name, part_number, quantity, unit_price,
              discount_pct, line_total, customer_status, urgency,
              genuine_price, genuine_available, genuine_expected_date,
              aftermarket_price, aftermarket_available, aftermarket_expected_date,
              used_price, used_available, used_expected_date,
              part_option, alternative_option, alternative_for, alternative_approved
         FROM estimate_lines WHERE estimate_id = ? ORDER BY sort_order, id`,
      [est.id]
    );
    const pricing = summariseEstimatePricing(lines.filter(l => l.line_type !== 'discount'), pref);

    // A supplementary estimate: the main estimate it adds to, and the
    // consents the customer has given (when, what cost, the name typed).
    const supplementary = isSupplementary(est);
    const [parent] = supplementary && est.parent_estimate_id
      ? await query('SELECT estimate_number FROM service_estimates WHERE id = ?', [est.parent_estimate_id]) : [];
    const consents = supplementary
      ? await query('SELECT amount, consent_name, created_at FROM estimate_consents WHERE estimate_id = ? ORDER BY id', [est.id]) : [];

    res.json({
      success: true,
      estimate: {
        estimate_number: est.estimate_number,
        kind: est.kind || 'main',
        parent_estimate_number: parent?.estimate_number || null,
        // One firm price per line; approving needs the customer's consent.
        fixed_cost: supplementary,
        consent_required: supplementary,
        customer_name: est.customer_name,
        vehicle_plate: est.vehicle_plate,
        subtotal_labour: est.subtotal_labour,
        subtotal_parts: est.subtotal_parts,
        subtotal_sublet: est.subtotal_sublet,
        vat_rate: est.vat_rate,
        vat_amount: est.vat_amount,
        total_amount: est.total_amount,
        status: est.status,
        valid_until: est.valid_until,
        work_order_id: est.work_order_id,
        estimate_format: est.estimate_format || formatOfPreference(pref),
        parts_preference: pref,
      },
      lines: withPartOptions(lines, pref),
      jobs: pricing.jobs,
      // Before VAT, per category of the preference; alternatives apart.
      totals_by_type: pricing.totals,
      alternatives: pricing.alternatives,
      consents: consents.map(c => ({ amount: c.amount, name: c.consent_name, at: c.created_at })),
    });
  } catch (err) {
    console.error('GET /public/estimates/:token error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the estimate' });
  }
});

// POST /api/public/estimates/:token/lines/:lineId/decide — the customer
// approves or rejects one line. Same rollup and same auto-conversion as the
// staff PATCH route, via applyLineDecision — a customer-driven approval must
// create the job card exactly as reliably as a staff-driven one.
publicRouter.post('/:token/lines/:lineId/decide', estimateApprovalLimiter, async (req, res) => {
  try {
    const est = await loadByToken(req.params.token, res);
    if (!est) return;

    const { decision, name, reason, part_option, consent } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });
    }

    const result = await applyLineDecision({
      estimateId: est.id, lineId: req.params.lineId, workshopId: est.workshop_id,
      decision, responder: { channel: 'email', name: publicName(name) }, reason, partOption: part_option,
      consent, ip: req.ip, userAgent: req.get('user-agent'),
    });
    if (!result.ok) return res.status(result.status).json(publicRefusal(result));
    res.json(publicDecided(result));
  } catch (err) {
    console.error('POST /public/estimates/:token/lines/:lineId/decide error:', err);
    res.status(500).json({ success: false, message: 'Failed to record the decision' });
  }
});

// POST /api/public/estimates/:token/decide-bulk — the customer decides
// several lines at once: "Approve all", "Reject all", or the jobs they ticked.
// Body: { decision: 'approved' | 'rejected', line_ids: [ids] (left out: every
// line still pending), part_options: { lineId: 'genuine' | … }, name, reason,
// consent (a supplementary estimate's approval: { agreed, name, amount, text },
// amount = the fixed cost of those lines together, incl. VAT) }. One request,
// the same rules as one line; nothing is recorded if any line cannot take it.
publicRouter.post('/:token/decide-bulk', estimateApprovalLimiter, async (req, res) => {
  try {
    const est = await loadByToken(req.params.token, res);
    if (!est) return;

    const { decision, line_ids, part_options, name, reason, consent } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });
    }
    if (line_ids !== undefined && line_ids !== null && line_ids !== 'all'
        && (!Array.isArray(line_ids) || !line_ids.length || line_ids.length > 500 || line_ids.some(id => !Number.isInteger(Number(id)) || Number(id) <= 0))) {
      return res.status(400).json({ success: false, message: 'line_ids must be a list of line ids, or left out for every line still to decide' });
    }
    const options = {};
    if (part_options && typeof part_options === 'object' && !Array.isArray(part_options)) {
      for (const [k, v] of Object.entries(part_options)) if (PART_CATEGORIES.includes(v)) options[Number(k)] = v;
    }

    const result = await applyDecisions({
      estimateId: est.id, workshopId: est.workshop_id, decision,
      lineIds: Array.isArray(line_ids) ? line_ids : null, partOptions: options,
      responder: { channel: 'email', name: publicName(name) }, reason, consent, ip: req.ip, userAgent: req.get('user-agent'),
    });
    if (!result.ok) return res.status(result.status).json(publicRefusal(result));
    res.json({ ...publicDecided(result), decided: result.decided });
  } catch (err) {
    console.error('POST /public/estimates/:token/decide-bulk error:', err);
    res.status(500).json({ success: false, message: 'Failed to record the decisions' });
  }
});

/** The name a customer typed on the public page, tidied (null when blank). */
const publicName = v => (typeof v === 'string' ? (stripMarkup(v, 200) || '').replace(/\s+/g, ' ').trim() || null : null);
/** A refused decision as the public page reads it: why, and for a refused bulk decision each line's reason. */
const publicRefusal = r => ({ success: false, code: r.code, message: r.message,
  ...(r.problems ? { problems: r.problems } : {}), ...(r.amount !== undefined ? { amount: r.amount } : {}) });
/** A recorded decision as the public page reads it. */
const publicDecided = r => ({
  success: true, estimate_status: r.estimate_status,
  // added_to_job: the work joined the job card of the visit already in
  // the workshop; work_order_created: a new job card was opened.
  work_order_created: !!r.work_order_id && !r.added_to_job, work_order_number: r.work_order_number,
  added_to_job: !!r.added_to_job,
});

export { router as default, publicRouter as publicEstimateRouter };
