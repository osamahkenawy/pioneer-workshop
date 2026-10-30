import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import {
  Xmark, User, UserPlus, Car, Wrench, Plus, Trash, Search, Calendar,
  NavArrowLeft, NavArrowRight, Check, Building, Truck, ShieldCheck, Box, Barcode,
  Phone, Mail, MapPin, DashboardSpeed, WarningCircle, Coins, PageSearch, Lock,
  InfoCircle, Antenna, Notes, Refresh, Cash,
} from 'iconoir-react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { canDo } from '../lib/permissions';
import { CAR_CATALOG, CAR_MAKES } from '../lib/carCatalog';
import './NewWorkOrderModal.css';

/**
 * NewWorkOrderModal — the "New Job Card" intake, process Steps 1–3
 * (classify the customer → collect the vehicle and the reported issue →
 * open the job card).
 *
 * Pages: Customer → Vehicle → Reported issue → Pricing → Review & open.
 * Posts to POST /work-orders (edit: PUT /work-orders/:id and, when the lines
 * changed, PUT /work-orders/:id/items). It never assigns a technician: that
 * is the Team Leader's, in process Step 6.
 */

const WORK_ORDER_TYPES = [
  { value: 'standard',  label: 'Standard' },
  { value: 'express',   label: 'Express' },
  { value: 'same_day',  label: 'Same day' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'warranty',  label: 'Warranty' },
];

const SERVICE_CATEGORIES = [
  { value: 'general_maintenance', label: 'General maintenance' },
  { value: 'oil_change',          label: 'Oil change' },
  { value: 'brake_repair',        label: 'Brake repair' },
  { value: 'diagnostic',          label: 'Diagnostic' },
  { value: 'bodywork',            label: 'Bodywork' },
  { value: 'tire_service',        label: 'Tire service' },
  { value: 'engine_repair',       label: 'Engine repair' },
  { value: 'transmission',        label: 'Transmission' },
  { value: 'electrical',          label: 'Electrical' },
  { value: 'other',               label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: 'cash',    label: 'Cash' },
  { value: 'prepaid', label: 'Prepaid' },
  { value: 'credit',  label: 'On account' },
  { value: 'wallet',  label: 'Wallet' },
];

/* Must match the vehicles.fuel_type enum. 'lpg' used to be offered here and
 * could never be saved: MySQL refused it and the advisor got a 500 "Failed to
 * create vehicle". LPG and CNG cars go under Other. */
const FUEL_TYPES = [
  { value: 'petrol',   label: 'Petrol' },
  { value: 'diesel',   label: 'Diesel' },
  { value: 'hybrid',   label: 'Hybrid' },
  { value: 'electric', label: 'Electric' },
  { value: 'other',    label: 'Other (LPG, CNG…)' },
];

/* How the request reached the workshop — the document's Step 2 collection
 * channels. 'fleet_link' and 'api' are set only by those routes (the
 * coordinator link and the integration API), so they are not offered here. */
const INTAKE_CHANNELS = [
  { value: 'advisor',  label: 'Walk-in / phone (Service Advisor)' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website',  label: 'Website' },
  { value: 'social',   label: 'Social media' },
];
const CHANNEL_LABELS = {
  advisor: 'Walk-in / phone (Service Advisor)', whatsapp: 'WhatsApp', website: 'Website',
  social: 'Social media', fleet_link: 'Fleet coordinator link', api: 'API / integration',
};

/* What a counter line is — labour is invoiced as service, parts as parts
 * (lib/job-card-billing.js). Without it every line, labour included, was
 * billed as "parts". */
const LINE_TYPES = [
  { value: 'labour',     label: 'Labour' },
  { value: 'parts',      label: 'Parts' },
  { value: 'sublet',     label: 'Sublet' },
  { value: 'consumable', label: 'Consumable' },
];

/* Short enough to fit a 390px phone without the select clipping them. */
const APPROVAL_OPTIONS = [
  { value: '',          label: 'Not yet — record it later on the job card' },
  { value: 'in_person', label: 'Approved in person' },
  { value: 'phone',     label: 'Approved by phone' },
  { value: 'written',   label: 'Approved in writing' },
];

/* The pages of the intake (process steps 1-3: classification, vehicle
 * information and reported issue, job card). Pricing is process step 4 —
 * the Storekeeper and the Service Advisor price the estimate after the
 * technical inspection — so a NEW job card has no pricing page; it appears
 * only when editing an older job card that was priced at the counter.
 * They are called pages, not steps: "Step 4" means the
 * technical inspection and estimate to everyone trained on the process
 * document, and the workflow panel on the job card uses those numbers. Each
 * page says which process step it belongs to instead. */
const STEPS = [
  { n: 1, title: 'Customer',       process: 'Process step 1 · Classification',      icon: User },
  { n: 2, title: 'Vehicle',        process: 'Process step 2 · Vehicle information', icon: Car },
  { n: 3, title: 'Reported issue', process: 'Process step 2 · Reported issue',      icon: Wrench },
  { n: 4, title: 'Pricing',        process: 'Counter pricing on this job card',     icon: Coins },
  { n: 5, title: 'Review & open',  process: 'Process step 3 · Job card',            icon: PageSearch },
];

const ORANGE = '#f97316';
const NAVY = '#1e3a6b';

const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];

const EMPTY_VEHICLE = {
  make: '', model: '', year: '', plate_number: '', plate_code: '', plate_emirate: '',
  vin: '', engine_no: '', fleet_code: '', color: '',
  fuel_type: 'petrol', transmission: 'automatic',
};

let itemSeq = 0;
const newItem = (over = {}) => ({ key: `i${++itemSeq}`, name: '', item_type: '', quantity: '1', unit_price: '', notes: '', ...over });

/* How many vehicle cards to fetch at a time. A fleet account holds up to
 * 1,758 cars; the rest are reached by searching the server, not by scrolling. */
const VEHICLE_PAGE = 24;

/* Title-case a subcategory for display — the enum is lower-case in the
 * database and "fleet" in a summary panel reads like a typo. */
const cap = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : '');
/* The enum value is 'walkin'; everywhere a person reads it, it is "Walk-in". */
const subLabel = (v) => (v === 'walkin' ? 'Walk-in' : cap(v));
const classLabel = (cls, sub) => [cls === 'internal' ? 'Internal' : 'External', sub ? subLabel(sub) : ''].filter(Boolean).join(' · ');

/* Several imported fleet accounts carry "-" or "N/A" in place of a phone
 * number. Rendered literally that reads as a broken field ("FLT-001 · -"),
 * so a value that is only punctuation is treated as absent. */
const real = (v) => {
  const s = String(v ?? '').trim();
  return s && !/^[-–—.\s]*$/.test(s) && s.toUpperCase() !== 'N/A' ? s : '';
};

/* ── Input normalising ──
 * Arabic-Indic digits (٠-٩, and the Persian ۰-۹) are converted, because a
 * UAE keyboard in Arabic types them. Nothing else is rewritten: the old
 * odometer box silently stripped every non-digit, so "12.5" became 125 and
 * "-500" became 500. A stray character now stays visible and is refused. */
const toLatinDigits = (s) => String(s ?? '')
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0))
  .replace(/٫/g, '.');
/* Thousands separators and spaces are the only things dropped: "45,320" is
 * forty-five thousand, never forty-five. */
const normOdo = (s) => toLatinDigits(s).replace(/[\s,٬]/g, '');
const normNum = (s) => toLatinDigits(s).replace(/\s/g, '');
/* A VIN never contains a space or a dash; storing one with them is how the
 * same chassis got past the duplicate check as two vehicles. */
const normVin = (s) => toLatinDigits(s).toUpperCase().replace(/[\s-]/g, '');

const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const QTY_RE = /^\d+(\.\d{1,3})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/* The server's own phone rule (routes/customers.js), checked here so a typo
 * is caught on page 1 rather than on page 5. */
const phoneOk = (p) => /^\+?\d{7,20}$/.test(toLatinDigits(p).replace(/[\s\-()]/g, ''));
/* "" is a blank money box (= 0); anything else must be a plain number. */
const moneyVal = (s) => { const v = normNum(s); return v === '' ? 0 : MONEY_RE.test(v) ? Number(v) : NaN; };
const qtyVal = (s) => { const v = normNum(s); return QTY_RE.test(v) ? Number(v) : NaN; };
/* Decimal columns come back as "2.000" / "150.00". */
const trimDecimal = (v) => (v == null || v === '' ? '' : String(Number(v)));

/* A VIN (ISO 3779) is 17 letters and digits and never contains I, O or Q —
 * the same rule routes/vehicles.js applies, checked here so "123" or a
 * mistyped O for 0 is caught on page 2 rather than at Create. */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const vinBad = (v) => !VIN_RE.test(normVin(v));
const VIN_MSG = 'The VIN / chassis number must be 17 letters and digits, never I, O or Q (those read as 1 and 0). Check it against the chassis plate.';
/* Live hint under a VIN box while it is being typed. */
const vinHint = (v) => {
  const s = normVin(v);
  if (!s) return undefined;
  if (/[IOQ]/.test(s)) return 'A VIN never contains I, O or Q — read them as 1 and 0.';
  if (s.length !== 17) return `${s.length} of 17 characters.`;
  return undefined;
};

const THIS_YEAR = new Date().getFullYear();

const MANAGER_ROLES = ['admin', 'super_admin', 'general_manager', 'workshop_manager'];
/* Mirrors lib/roles.js isManagerRole — creating an internal account (which
 * takes that customer's estimates out of the Supervisor/WM approval) is the
 * Workshop Manager's call, not the front desk's. */
const isManagerUser = (u) => !!u && (u.is_owner === true || Number(u.is_owner) === 1
  || MANAGER_ROLES.includes(u.role) || MANAGER_ROLES.includes(u.role_slug));

const fmtKm = (n) => `${Number(n).toLocaleString('en-US')} km`;
const plateText = (v) => [v?.plate_number, v?.plate_code].filter(Boolean).join(' ');

/* Keyboard for a role="radiogroup", as a screen-reader user expects it: Tab
 * enters and leaves the group at the chosen option, the arrow keys move the
 * choice (left/right follow the reading direction). */
function radioKeys(e) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  const group = e.currentTarget;
  const radios = [...group.querySelectorAll('[role="radio"]:not([disabled])')]
    .filter(r => r.closest('[role="radiogroup"]') === group);
  const i = radios.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const rtl = getComputedStyle(group).direction === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft');
  const to = radios[(i + (rtl ? -step : step) + radios.length) % radios.length];
  to.focus(); to.click();
}
/* Only one option of a group is a Tab stop: the chosen one, or the first
 * while nothing is chosen. */
const tabStop = (on, noneOn, first) => (on || (noneOn && first) ? 0 : -1);

/* The big selectable card used for Internal/External and Existing/New.
 * A radio: one of a pair, announced as such. */
function ChoiceCard({ icon: Icon, title, desc, selected, onClick, field }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick} data-field={field}
      tabIndex={selected ? 0 : -1}
      style={{ ...st.choiceCard, ...(selected ? st.choiceCardOn : {}) }}>
      <div style={{ ...st.choiceIcon, ...(selected ? st.choiceIconOn : {}) }}>
        <Icon width={21} height={21} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...st.choiceTitle, color: selected ? ORANGE : NAVY }}>{title}</div>
        <div style={st.choiceDesc}>{desc}</div>
      </div>
      <div style={{ ...st.radio, ...(selected ? st.radioOn : {}) }} aria-hidden="true">
        {selected && <Check width={13} height={13} strokeWidth={3} />}
      </div>
    </button>
  );
}

/* A single-choice row of pills (subcategories, the new customer's type). */
function PillGroup({ label, options, value, onChange, field, invalid }) {
  return (
    <div className={`nwo-pillrow${invalid ? ' nwo-invalid-group' : ''}`} role="radiogroup" aria-label={label} onKeyDown={radioKeys}>
      {options.map(({ v, label: l, Icon }, i) => (
        <button key={v || 'all'} type="button" role="radio" aria-checked={value === v}
          tabIndex={tabStop(value === v, !options.some(o => o.v === value), i === 0)}
          data-field={i === 0 ? field : undefined}
          style={{ ...st.pill, ...(value === v ? st.pillOn : {}) }}
          onClick={() => { if (value !== v) onChange(v); }}>
          <Icon width={17} height={17} /> {l}
        </button>
      ))}
    </div>
  );
}

/* One line of the summary panel. Renders an em dash rather than collapsing
 * when the value is empty: a missing email should read as "no email on
 * file", not silently shorten the card so the layout jumps as fields fill.
 * `ltr` keeps phone numbers, plates, VINs and km figures in reading order
 * inside the Arabic layout; `wrap` lets a VIN show in full. */
function SummaryRow({ icon: Icon, label, value, ltr, wrap }) {
  const shown = value || '—';
  return (
    <div style={st.sumRow}>
      <Icon width={15} height={15} style={{ color: '#94a3b8', flexShrink: 0 }} />
      <span style={st.sumLabel}>{label}</span>
      <span title={value ? String(value) : undefined}
        style={{ ...st.sumValue, ...(wrap ? st.sumValueWrap : {}), color: value ? NAVY : '#cbd5e1' }}>
        {ltr && value ? <bdi dir="ltr">{shown}</bdi> : shown}
      </span>
    </div>
  );
}

export default function NewWorkOrderModal({ open, presetCustomerId = null, presetVehicleId = null, onClose, onCreated, onUpdated, editOrder = null, currency = 'AED' }) {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext) || {};
  const mayOpen = canDo(user, 'job.open');
  const mayRecordApproval = canDo(user, 'customer.approval');
  const manager = isManagerUser(user);

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState('');
  // Field keys the current message is about — outlined red, first one focused.
  const [invalid, setInvalid] = useState([]);
  // An action offered with the message: { kind: 'dup', existing } after a
  // 409 on the phone, { kind: 'stale' } when someone else saved first.
  const [notice, setNotice] = useState(null);
  // True from the moment the wizard opens until its data is in place; the
  // "unsaved changes" baseline is taken when it turns false.
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  const modalRef = useRef(null);
  const bodyRef = useRef(null);
  const headRef = useRef(null);
  // The form as it was when it finished loading; "unsaved changes" = differs.
  const baselineRef = useRef(null);

  // reference data
  const [serviceBays, setServiceBays] = useState([]);
  // VAT the job card will add (lib/job-card-billing.js resolveVatRate): the
  // workshop's setting if it has one, else the platform's 5%.
  const [vatRate, setVatRate] = useState(5);

  // ── Page 1: who the customer is ──
  //   Internal  →  Fleet | Insurance | Asset  → pick from the account list
  //   External  →  Existing | New             → pick, or key in on the spot
  // Defaults to external/existing: 3,465 of the 3,472 accounts on file are
  // external, so that is the path the front desk is on nearly all day.
  const [customerClass, setCustomerClass] = useState('external');
  const [internalSub, setInternalSub] = useState('');
  const [externalOpt, setExternalOpt] = useState('existing'); // 'existing' | 'new'
  // A search FILTER on the existing list ('' = every external account) — not
  // a classification. Most external customers on file have no subcategory,
  // and filtering on one would hide them.
  const [externalSub, setExternalSub] = useState('');
  // The classification of a NEW external customer (Walk-in, or an outside
  // fleet / insurer registered at the counter).
  const [newExternalSub, setNewExternalSub] = useState('walkin');
  // An existing external customer with no subcategory gets one here; the
  // document's Step 1 is main category AND subcategory, and without it the
  // job card sits at Step 1 forever. Saved onto the customer on submit.
  const [classifySub, setClassifySub] = useState('');

  const [customerId, setCustomerId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const [customersTotal, setCustomersTotal] = useState(0);
  const [customersLoading, setCustomersLoading] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [dupMatches, setDupMatches] = useState([]);
  const [dupNonce, setDupNonce] = useState(0);
  // A contact for THIS job when the account has none on file — the internal
  // accounts hold "-" for a phone, and the estimate (Steps 4–5) and the
  // collection call (Step 7) need someone to reach. Kept on the job card only.
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  // "Add internal account" (managers only, D7)
  const [internalForm, setInternalForm] = useState(null); // null = closed
  const [savingInternal, setSavingInternal] = useState(false);

  const editMode = !!editOrder;
  // A job card from before every intake created a customer row: its name and
  // phone live on the job card only.
  const legacyNoCustomer = editMode && !editOrder.customer_id;
  const customerMode = legacyNoCustomer ? 'legacy'
    : (customerClass === 'external' && externalOpt === 'new') ? 'new' : 'existing';

  // ── Page 2: which car, and what the odometer reads ──
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesTotal, setVehiclesTotal] = useState(0);   // matching the search
  const [vehiclesOnFile, setVehiclesOnFile] = useState(0); // all of this customer's
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclePage, setVehiclePage] = useState(1);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleQuery, setVehicleQuery] = useState('');     // debounced
  // The chosen vehicle is kept as an object, not looked up in `vehicles`:
  // that list is one page of a server search, and the car picked from an
  // earlier search must not vanish because the search box changed.
  const [pickedVehicle, setPickedVehicle] = useState(null);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ ...EMPTY_VEHICLE });
  // A VIN typed for an existing vehicle that has none on file. 96% of
  // vehicles are in that state, so blocking them outright would make the
  // mandatory VIN unusable — instead the wizard asks, and saves it back onto
  // the vehicle on submit, one car at a time as each one comes in.
  const [vinFix, setVinFix] = useState('');
  // Mileage at THIS visit — not the vehicle's stored mileage, which is only
  // "last known reading". Mandatory, never pre-filled.
  const [odometerIn, setOdometerIn] = useState('');
  const [odoLowAck, setOdoLowAck] = useState(false);
  const [openJobs, setOpenJobs] = useState([]);
  // "It is a different car" — the answer to a duplicate-plate question,
  // valid only for the plate it was given for.
  const plateConfirmedRef = useRef(false);

  // ── Page 3: what is wrong with it ──
  const [intakeChannel, setIntakeChannel] = useState('advisor');
  const [workOrderType, setWorkOrderType] = useState('standard');
  const [serviceCategory, setServiceCategory] = useState('general_maintenance');
  const [description, setDescription] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  // ── Page 4: counter pricing (internal accounts) ──
  const [items, setItems] = useState(() => [newItem()]);
  const [serviceFee, setServiceFee] = useState('');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  // '' = not yet. Never pre-selected, reset every time the wizard opens.
  const [approvalChannel, setApprovalChannel] = useState('');

  // ── Page 5 ──
  const [serviceBayId, setServiceBayId] = useState('');

  // Edit mode: what was loaded, and what may still change.
  // { id, number, updatedAt, status, closed, locked, lockReason,
  //   origCustomer, origVehicle, itemsSig, hadCounter, approvedTotal, raw }
  const [editInfo, setEditInfo] = useState(null);

  const resetVehicleState = useCallback(() => {
    setPickedVehicle(null); setAddingVehicle(false); setNewVehicle({ ...EMPTY_VEHICLE });
    setVehicleSearch(''); setVehicleQuery(''); setVinFix('');
    setOdometerIn(''); setOdoLowAck(false); setOpenJobs([]);
  }, []);

  const resetAll = useCallback(() => {
    setStep(1); setSubmitting(false); submittingRef.current = false;
    setError(''); setInvalid([]); setNotice(null);
    setCustomerClass('external'); setInternalSub(''); setExternalOpt('existing'); setExternalSub('');
    setNewExternalSub('walkin'); setClassifySub('');
    setCustomerId(''); setSelectedCustomer(null); setCustomerSearch('');
    setCustomers([]); setCustomersTotal(0); setDupMatches([]);
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
    setContactPhone(''); setContactEmail('');
    setInternalForm(null); setSavingInternal(false);
    setVehicles([]); setVehiclesTotal(0); setVehiclesOnFile(0); setVehiclePage(1);
    setPickedVehicle(null); setAddingVehicle(false); setNewVehicle({ ...EMPTY_VEHICLE });
    setVehicleSearch(''); setVehicleQuery(''); setVinFix('');
    setOdometerIn(''); setOdoLowAck(false); setOpenJobs([]); plateConfirmedRef.current = false;
    setIntakeChannel('advisor'); setWorkOrderType('standard'); setServiceCategory('general_maintenance');
    setDescription(''); setSpecialInstructions(''); setScheduledAt('');
    setItems([newItem()]); setServiceFee(''); setDiscount(''); setPaymentMethod('cash');
    // The approval choice used to survive between job cards: the next
    // customer's job card was saved as "approved in person" by nobody.
    setApprovalChannel('');
    setServiceBayId('');
    setEditInfo(null);
  }, []);

  /* Land the classification pickers on whatever this customer actually is,
   * so a preset or reopened internal fleet account is not shown under
   * "External Customer". */
  const applyClassification = useCallback((c) => {
    if (c?.customer_class === 'internal') {
      setCustomerClass('internal');
      setInternalSub(c.customer_subcategory || '');
    } else {
      setCustomerClass('external');
      setExternalOpt('existing');
      setExternalSub(['fleet', 'insurance'].includes(c?.customer_subcategory) ? c.customer_subcategory : '');
    }
  }, []);

  // ── Open / load ──
  const loadIdRef = useRef(0);
  useEffect(() => {
    if (!open) return undefined;
    const myId = ++loadIdRef.current;
    const stale = () => myId !== loadIdRef.current;
    resetAll();
    baselineRef.current = null;
    setLoading(true);

    // Reference data — not part of what the advisor enters, so it does not
    // hold up the form.
    api.get('/service-bays').then(r => { if (!stale() && r.success) setServiceBays(r.data || []); }).catch(() => {});
    api.get('/settings').then(r => {
      if (stale() || !r.success) return;
      const s = r.data?.settings || {};
      const off = s.vat_enabled === false || s.vat_enabled === 'false';
      setVatRate(off ? 0 : (Number(s.vat_rate ?? 5) || 0));
    }).catch(() => {});

    if (!editOrder && !presetCustomerId) { setLoading(false); return undefined; }

    (async () => {
      try {
        if (editOrder) {
          const [woRes, wfRes] = await Promise.all([
            api.get(`/work-orders/${editOrder.id}`).catch(() => null),
            api.get(`/workflow/work-orders/${editOrder.id}`).catch(() => null),
          ]);
          if (stale()) return;
          // The list row can be minutes old; edit what is on the server now.
          const wo = woRes?.success ? woRes.data : editOrder;
          const [cRes, vRes] = await Promise.all([
            wo.customer_id ? api.get(`/customers/${wo.customer_id}`).catch(() => null) : null,
            wo.vehicle_id ? api.get(`/vehicles/${wo.vehicle_id}`).catch(() => null) : null,
          ]);
          if (stale()) return;
          const cust = cRes?.success ? cRes.data : null;
          const veh = vRes?.success ? vRes.data : null;

          if (cust) {
            applyClassification(cust);
            setCustomerId(String(cust.id)); setSelectedCustomer(cust);
            setCustomers([cust]); setCustomersTotal(1); setCustomerSearch(cust.full_name || '');
          } else if (wo.customer_id) {
            setCustomerId(String(wo.customer_id));
          } else {
            setCustomerName(wo.customer_name || '');
            setCustomerPhone(wo.customer_phone || '');
            setCustomerEmail(wo.customer_email || '');
          }
          setPickedVehicle(veh);
          setOdometerIn(wo.odometer_in != null ? String(wo.odometer_in) : '');
          setIntakeChannel(wo.intake_channel || 'advisor');
          setWorkOrderType(wo.work_order_type || 'standard');
          setServiceCategory(wo.service_category || 'general_maintenance');
          setDescription(wo.description || '');
          setSpecialInstructions(wo.special_instructions || '');
          setScheduledAt(wo.scheduled_at ? String(wo.scheduled_at).slice(0, 16) : '');
          setServiceFee(Number(wo.service_fee) ? trimDecimal(wo.service_fee) : '');
          setDiscount(Number(wo.discount) ? trimDecimal(wo.discount) : '');
          setPaymentMethod(wo.payment_method || 'cash');
          setServiceBayId(wo.service_bay_id ? String(wo.service_bay_id) : '');

          // Lines keep their id (and so their sub-job card, type and estimate
          // link on the server) — the save sends them back by id.
          const loaded = (Array.isArray(wo.items) ? wo.items : []).map(it => newItem({
            id: it.id, name: it.name || '', item_type: it.item_type || '', quantity: trimDecimal(it.quantity ?? 1) || '1',
            unit_price: trimDecimal(it.unit_price), notes: it.notes || '',
          }));
          setItems(loaded.length ? loaded : [newItem()]);

          // Customer and vehicle are fixed once the inspection is completed or
          // signed, an estimate exists or work has started (D9). The server
          // refuses the change either way; this only stops the advisor from
          // making it in the first place.
          const estimates = (wfRes?.success && Array.isArray(wfRes.data?.estimates)) ? wfRes.data.estimates : [];
          const inspected = wfRes?.success ? wfRes.data?.physical_inspection : null;
          const liveEstimate = estimates.find(e => !['rejected', 'expired'].includes(e.status));
          const closed = ['completed', 'cancelled'].includes(wo.status);
          const started = !['pending', 'confirmed', 'estimate_approved'].includes(wo.status);
          const lockReason = closed ? `This work order is ${wo.status}.`
            : liveEstimate ? `Estimate ${liveEstimate.estimate_number} has been raised for this car.`
            : wo.customer_approved_at ? 'The customer has already approved this work order.'
            : inspected?.signed ? 'The customer has signed the vehicle inspection for this car.'
            : inspected?.status === 'completed' ? 'The vehicle inspection for this car has been completed.'
            : started ? 'Work on this work order has started.'
            : '';
          setEditInfo({
            id: wo.id, number: wo.work_order_number, updatedAt: wo.updated_at ?? null, status: wo.status,
            closed, locked: !!lockReason, lockReason,
            origCustomer: cust, origVehicle: veh,
            itemsSig: linesSig(loaded),
            hadCounter: loaded.length > 0 || Number(wo.service_fee) > 0 || Number(wo.discount) > 0,
            approvedAt: wo.customer_approved_at || null,
            approvedTotal: wo.customer_approved_total != null ? Number(wo.customer_approved_total) : null,
            raw: wo,
          });
        } else if (presetCustomerId) {
          // Opened from a customer's (or a vehicle's) drawer: that customer,
          // and that car when it is theirs.
          const [r, vr] = await Promise.all([
            api.get(`/customers/${presetCustomerId}`).catch(() => null),
            presetVehicleId ? api.get(`/vehicles/${presetVehicleId}`).catch(() => null) : null,
          ]);
          if (stale()) return;
          if (r?.success && r.data) {
            const c = r.data;
            applyClassification(c);
            if (c.is_active === 0 || c.is_active === false) {
              setError(`${c.full_name} is a deactivated account. Ask a manager to reactivate it on the Customers page before opening a job card.`);
            } else {
              setCustomerId(String(c.id)); setSelectedCustomer(c);
              setCustomers([c]); setCustomersTotal(1); setCustomerSearch(c.full_name || '');
              if (vr?.success && vr.data && String(vr.data.customer_id) === String(c.id)) setPickedVehicle(vr.data);
            }
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!stale()) setLoading(false);
      }
    })();
    return () => { loadIdRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetCustomerId, presetVehicleId, editOrder, reloadNonce]);

  // Back to "loading" whenever the wizard closes, so the next open does not
  // take its unsaved-changes baseline from the previous job card's values.
  useEffect(() => { if (!open) setLoading(true); }, [open]);

  // ── Dialog behaviour: page behind locked, focus in and kept in, Escape ──
  const requestCloseRef = useRef(() => {});
  useEffect(() => {
    if (!open) return undefined;
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); requestCloseRef.current(); return; }
      if (e.key !== 'Tab' || !modalRef.current) return;
      const els = [...modalRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter(el => el.offsetParent !== null && el.getAttribute('tabindex') !== '-1');
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      const inside = modalRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) prevFocus.focus();
    };
  }, [open]);

  // Every page opens at its top, with focus on its heading so a screen
  // reader announces where the user now is.
  const stepChangedAt = useRef(0);
  useEffect(() => {
    if (!open) return;
    stepChangedAt.current = Date.now();
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    headRef.current?.focus({ preventScroll: true });
  }, [step, open]);

  // ── Customer search (server-side, every customer, plus plate/VIN) ──
  useEffect(() => {
    if (!open || customerMode !== 'existing' || step !== 1) return undefined;
    // Internal accounts are listed only once a subcategory is chosen —
    // "every internal account" is three different ledgers mixed together.
    if (customerClass === 'internal' && !internalSub) { setCustomers([]); setCustomersTotal(0); return undefined; }
    let cancelled = false;
    setCustomersLoading(true);
    const id = setTimeout(() => {
      const q = customerSearch.trim();
      const params = new URLSearchParams({ limit: '50', active_only: '1', customer_class: customerClass });
      if (customerClass === 'internal') params.set('customer_subcategory', internalSub);
      else if (externalSub) params.set('customer_subcategory', externalSub);
      if (q) params.set('search', q);
      api.get(`/customers?${params.toString()}`)
        .then(res => {
          if (cancelled || !res.success) return;
          setCustomers(res.data || []);
          setCustomersTotal(Number(res.total ?? res.pagination?.total ?? (res.data || []).length));
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setCustomersLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [open, step, customerMode, customerSearch, customerClass, internalSub, externalSub]);

  // "New customer" duplicate check, keyed on the phone being typed. Re-run
  // every time page 1 is shown (and after a 409), not only when the phone
  // changes — another advisor may have saved the same person meanwhile.
  // Deactivated matches are included so the advisor knows the number is on
  // an old record, but they cannot be picked.
  useEffect(() => {
    if (!open || customerMode !== 'new' || step !== 1) { setDupMatches([]); return undefined; }
    const q = customerPhone.trim();
    if (toLatinDigits(q).replace(/\D/g, '').length < 7) { setDupMatches([]); return undefined; }
    let cancelled = false;
    const id = setTimeout(() => {
      api.get(`/customers?limit=5&include_inactive=1&search=${encodeURIComponent(q)}`)
        .then(res => { if (!cancelled && res.success) setDupMatches(res.data || []); })
        .catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(id); };
  }, [open, step, customerMode, customerPhone, dupNonce]);

  // ── Vehicles of the selected customer: server search, a page at a time ──
  useEffect(() => {
    const id = setTimeout(() => setVehicleQuery(vehicleSearch.trim()), 300);
    return () => clearTimeout(id);
  }, [vehicleSearch]);

  // A different customer: their list replaces the previous one's at once, so
  // the previous customer's cars are never on screen while theirs load.
  useEffect(() => { setVehicles([]); setVehiclesTotal(0); setVehiclesOnFile(0); setVehiclePage(1); }, [customerId]);

  useEffect(() => {
    if (!open || !customerId) { setVehicles([]); setVehiclesTotal(0); setVehiclesOnFile(0); return undefined; }
    let cancelled = false;
    setVehiclesLoading(true);
    const params = new URLSearchParams({ customer_id: customerId, limit: String(VEHICLE_PAGE), page: '1' });
    if (vehicleQuery) params.set('search', vehicleQuery);
    api.get(`/vehicles?${params.toString()}`)
      .then(res => {
        if (cancelled || !res.success) return;
        const total = Number(res.total ?? res.pagination?.total ?? (res.data || []).length);
        setVehicles(res.data || []); setVehiclesTotal(total); setVehiclePage(1);
        if (!vehicleQuery) setVehiclesOnFile(total);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setVehiclesLoading(false); });
    return () => { cancelled = true; };
  }, [open, customerId, vehicleQuery]);

  const loadMoreVehicles = async () => {
    const nextPage = vehiclePage + 1;
    const params = new URLSearchParams({ customer_id: customerId, limit: String(VEHICLE_PAGE), page: String(nextPage) });
    if (vehicleQuery) params.set('search', vehicleQuery);
    setVehiclesLoading(true);
    try {
      const res = await api.get(`/vehicles?${params.toString()}`);
      if (res.success) {
        setVehicles(prev => [...prev, ...(res.data || []).filter(v => !prev.some(p => p.id === v.id))]);
        setVehiclePage(nextPage);
      }
    } catch { /* the button stays; the advisor can try again */ }
    setVehiclesLoading(false);
  };

  useEffect(() => { plateConfirmedRef.current = false; }, [newVehicle.plate_number, newVehicle.plate_code, newVehicle.plate_emirate]);

  const vehicleId = pickedVehicle ? String(pickedVehicle.id) : '';
  const vehicleChanged = editMode && String(editInfo?.origVehicle?.id || '') !== vehicleId;
  const enteringVehicle = customerMode === 'new' || (customerMode === 'existing' && addingVehicle);
  const pickedNeedsVin = !enteringVehicle && !!pickedVehicle && !real(pickedVehicle.vin);
  const lastKm = (!enteringVehicle && pickedVehicle?.mileage != null && pickedVehicle.mileage !== '') ? Number(pickedVehicle.mileage) : null;
  const odoNorm = normOdo(odometerIn);
  // In Edit the vehicle's stored mileage may already be this visit's (or a
  // later one's) reading, so only a reading the advisor has just changed is
  // compared against it.
  const odoChanged = !editMode || vehicleChanged || odoNorm !== String(editInfo?.raw?.odometer_in ?? '');
  const odoLow = odoChanged && lastKm != null && /^\d+$/.test(odoNorm) && Number(odoNorm) < lastKm;

  // A car already in the workshop: warn (not block) before a second job card
  // is opened for the same visit.
  useEffect(() => {
    setOpenJobs([]);
    if (!open || !pickedVehicle) return undefined;
    const q = real(pickedVehicle.plate_number) || real(pickedVehicle.vin);
    if (!q) return undefined;
    let cancelled = false;
    api.get(`/work-orders?limit=20&search=${encodeURIComponent(q)}`)
      .then(res => {
        if (cancelled || !res.success) return;
        setOpenJobs((res.data || []).filter(w => String(w.vehicle_id) === String(pickedVehicle.id)
          && !['completed', 'cancelled'].includes(w.status) && String(w.id) !== String(editOrder?.id || '')));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, pickedVehicle, editOrder]);

  /* Pick a customer from a list. A different customer means a different
   * set of cars: the car, VIN and odometer chosen for the previous one are
   * dropped, or the job card is saved against someone else's vehicle. */
  const selectCustomer = (c) => {
    if (String(c.id) !== String(customerId)) { resetVehicleState(); setClassifySub(''); setContactPhone(''); setContactEmail(''); }
    setCustomerId(String(c.id)); setSelectedCustomer(c);
  };
  const clearCustomer = () => {
    setCustomerId(''); setSelectedCustomer(null); setClassifySub('');
    setContactPhone(''); setContactEmail('');
    resetVehicleState();
  };

  /* Switch to a customer already on file — from the duplicate warning, or
   * from the 409 at Create. `keepVehicle` (the 409 path) keeps the car,
   * odometer and complaint already typed: the car becomes a new vehicle on
   * that customer. */
  async function adoptExistingCustomer(c, { keepVehicle = false } = {}) {
    let full = c;
    try { const r = await api.get(`/customers/${c.id}`); if (r.success && r.data) full = r.data; } catch { /* use what we have */ }
    if (full.is_active === 0 || full.is_active === false) {
      showError(`${full.full_name} is a deactivated account. Ask a manager to reactivate it on the Customers page.`);
      return;
    }
    applyClassification(full);
    setClassifySub('');
    if (keepVehicle) {
      setCustomerId(String(full.id)); setSelectedCustomer(full);
      setPickedVehicle(null); setAddingVehicle(true); setVehicleSearch('');
    } else {
      selectCustomer(full);
    }
    setCustomers([full]); setCustomersTotal(1);
    setCustomerSearch(real(full.phone) || full.full_name || '');
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
    setDupMatches([]); setNotice(null); setError(''); setInvalid([]);
  }

  /* ── Lines ── */
  const updateItem = (key, field, value) => setItems(prev => prev.map(it => it.key === key ? { ...it, [field]: value } : it));
  const addItem = () => setItems(prev => [...prev, newItem()]);
  const removeItem = (key) => setItems(prev => prev.length === 1 ? [newItem()] : prev.filter(it => it.key !== key));

  // Counter pricing is for internal accounts (routine fleet jobs). An
  // external customer's job is priced on the estimate after the inspection —
  // Storekeeper parts, Service Advisor labour, Supervisor/WM approval
  // (process Steps 4–5) — so a NEW external job card offers no lines, fee or
  // discount. Editing an older job card that was priced at the counter keeps
  // its lines.
  const jobClass = customerMode === 'existing' ? (selectedCustomer?.customer_class || customerClass)
    : customerMode === 'new' ? 'external' : (editInfo?.raw?.intake_customer_class || 'external');
  const jobSub = customerMode === 'existing' ? (selectedCustomer?.customer_subcategory || classifySub || '')
    : customerMode === 'new' ? newExternalSub : (editInfo?.raw?.intake_customer_subcategory || '');
  // Counter pricing only on an older job card that already has it (see STEPS).
  const counterAllowed = editMode && !!editInfo?.hadCounter;
  const pages = counterAllowed ? STEPS : STEPS.filter(p => p.n !== 4);
  const pageIdx = Math.max(0, pages.findIndex(p => p.n === step));
  const lastPage = pages[pages.length - 1].n;
  // An account with no phone on file (the internal accounts hold "-") gets an
  // optional contact for this job; the server stores it on the job card.
  const needsContact = !editMode && customerMode === 'existing' && !!selectedCustomer && !real(selectedCustomer.phone);
  // The fleet coordinator link and the API set their own channel; any other
  // can be corrected in Edit.
  const channelEditable = !editMode || !['fleet_link', 'api'].includes(editInfo?.raw?.intake_channel);

  // One set of rules for what is shown, what is validated and what is sent:
  // the total on screen is the total the job card saves.
  const lines = useMemo(() => items.map(it => {
    const named = !!it.name.trim();
    const q = qtyVal(it.quantity);
    const p = moneyVal(it.unit_price);
    const touched = named || normNum(it.unit_price) !== '' || (normNum(it.quantity) !== '' && normNum(it.quantity) !== '1') || !!it.notes.trim();
    const ok = named && Number.isFinite(q) && q > 0 && Number.isFinite(p);
    return { ...it, named, q, p, touched, ok, amount: ok ? round2(q * p) : null };
  }), [items]);
  const pricedLines = useMemo(() => (counterAllowed ? lines.filter(l => l.ok) : []), [lines, counterAllowed]);
  const hasCounterLines = pricedLines.length > 0;

  const totals = useMemo(() => {
    const itemsTotal = round2(pricedLines.reduce((s, l) => s + l.amount, 0));
    const fee = counterAllowed && Number.isFinite(moneyVal(serviceFee)) ? moneyVal(serviceFee) : 0;
    const disc = counterAllowed && Number.isFinite(moneyVal(discount)) ? moneyVal(discount) : 0;
    const subtotal = round2(itemsTotal + fee);
    const taxable = round2(Math.max(0, subtotal - disc));
    const exempt = Number(selectedCustomer?.tax_exempt) === 1;
    const rate = exempt ? 0 : vatRate;
    const vat = round2(taxable * rate / 100);
    return { itemsTotal, fee, disc, subtotal, taxable, rate, vat, grand: round2(taxable + vat) };
  }, [pricedLines, serviceFee, discount, counterAllowed, selectedCustomer, vatRate]);

  const fmt = (n) => `${currency} ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // The customer's approval at intake is of these counter prices — so it is
  // offered only when there are some, and only to someone who may record it
  // (Service Advisor, managers).
  const approvalOffered = !editMode && counterAllowed && hasCounterLines && mayRecordApproval;
  useEffect(() => { if (!approvalOffered && approvalChannel) setApprovalChannel(''); }, [approvalOffered, approvalChannel]);

  // ── Unsaved changes ──
  const dataSig = useMemo(() => JSON.stringify([
    customerClass, internalSub, externalOpt, newExternalSub, classifySub, customerId,
    customerName, customerPhone, customerEmail, contactPhone, contactEmail,
    vehicleId, addingVehicle, newVehicle, vinFix, odometerIn, odoLowAck,
    intakeChannel, workOrderType, serviceCategory, description, specialInstructions,
    items.map(i => [i.name, i.item_type, i.quantity, i.unit_price, i.notes]), serviceFee, discount, paymentMethod,
    approvalChannel, serviceBayId,
  ]), [customerClass, internalSub, externalOpt, newExternalSub, classifySub, customerId,
    customerName, customerPhone, customerEmail, contactPhone, contactEmail, vehicleId, addingVehicle, newVehicle, vinFix,
    odometerIn, odoLowAck, intakeChannel, workOrderType, serviceCategory, description,
    specialInstructions, items, serviceFee, discount, paymentMethod, approvalChannel, serviceBayId]);
  useEffect(() => {
    if (open && !loading && baselineRef.current === null) baselineRef.current = dataSig;
  }, [open, loading, dataSig]);
  const dirty = open && !loading && baselineRef.current !== null && dataSig !== baselineRef.current;

  /* Closing with entered data asks first — X, Cancel, Escape and the
   * backdrop alike. One stray click used to throw away five pages. */
  const requestClose = () => {
    if (submittingRef.current) return;
    if (dirty && !window.confirm(editMode
      ? 'Discard your changes to this job card?'
      : 'Discard this job card? What you entered will be lost.')) return;
    onClose?.();
  };
  requestCloseRef.current = requestClose;
  const downOnOverlay = useRef(false);

  // ── Messages ──
  // A message stays until the advisor changes something (then it no longer
  // describes the form) or moves page. The form signature at the moment the
  // message was shown is remembered, so state changed together with the
  // message (e.g. a duplicate VIN that selects the car on file) does not
  // clear it straight away.
  const errorSigRef = useRef(null);
  const pendingErrorSig = useRef(false);
  const showError = (msg, fields = []) => {
    setError(msg); setInvalid(fields); pendingErrorSig.current = true;
  };
  useEffect(() => {
    if (pendingErrorSig.current) { errorSigRef.current = dataSig; pendingErrorSig.current = false; }
  }, [error, invalid, dataSig]);
  useEffect(() => {
    if ((error || invalid.length) && errorSigRef.current !== null && dataSig !== errorSigRef.current && !pendingErrorSig.current) {
      setError(''); setInvalid([]); setNotice(n => (n?.kind === 'stale' ? n : null)); errorSigRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSig]);
  // Bring the first field the message is about into view (the message
  // itself is sticky at the top of the page, so it stays visible).
  useEffect(() => {
    if (!invalid.length || !modalRef.current) return;
    const el = modalRef.current.querySelector(`[data-field="${invalid[0]}"]`);
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }, [invalid, step]);
  const bad = (k) => invalid.includes(k);
  const badCls = (k) => (bad(k) ? 'nwo-invalid' : undefined);

  /* ── validation ── returns { msg, fields } or null */
  const validateStep = (s) => {
    /* ── 1. Who the customer is ── */
    if (s === 1) {
      if (customerMode === 'legacy') {
        const f = [];
        if (!customerName.trim()) f.push('customerName');
        if (!phoneOk(customerPhone)) f.push('customerPhone');
        if (f.length) return { msg: 'Enter the customer name and a valid mobile number.', fields: f };
        return null;
      }
      if (customerMode === 'new') {
        const f = []; const what = [];
        const name = customerName.trim();
        if (!name) { f.push('customerName'); what.push('the customer name'); }
        else if (/[<>]/.test(name)) return { msg: 'The name cannot contain < or >.', fields: ['customerName'] };
        if (!customerPhone.trim()) { f.push('customerPhone'); what.push('the mobile number'); }
        else if (!phoneOk(customerPhone)) return { msg: 'Enter a valid mobile number — digits only, e.g. +971 50 123 4567 or 050 123 4567.', fields: ['customerPhone', ...f] };
        if (customerEmail.trim() && !EMAIL_RE.test(customerEmail.trim())) return { msg: 'Enter a valid e-mail address, or leave it empty.', fields: ['customerEmail', ...f] };
        if (f.length) return { msg: `Enter ${what.join(' and ')}.`, fields: f };
        return null;
      }
      if (customerClass === 'internal' && !internalSub) {
        return { msg: 'Choose the internal subcategory — Fleet, Insurance or Asset.', fields: ['internalSub'] };
      }
      if (!customerId) {
        if (customerClass === 'internal') {
          const none = !customersLoading && customers.length === 0 && !customerSearch.trim();
          return {
            msg: none
              ? `No internal ${subLabel(internalSub).toLowerCase()} accounts are set up yet. ${manager ? 'Add one below.' : 'Ask the Workshop Manager to add one.'}`
              : `Select an internal ${subLabel(internalSub).toLowerCase()} account from the list.`,
            fields: ['customer'],
          };
        }
        return { msg: 'Select a customer from the list, or choose "New customer" to add one.', fields: ['customer'] };
      }
      if (selectedCustomer && (selectedCustomer.is_active === 0 || selectedCustomer.is_active === false)) {
        return { msg: 'This customer account is deactivated. Ask a manager to reactivate it on the Customers page.', fields: ['customer'] };
      }
      if (selectedCustomer && selectedCustomer.customer_class !== 'internal' && !selectedCustomer.customer_subcategory && !classifySub) {
        return { msg: 'Classify this customer — Fleet, Insurance or Walk-in.', fields: ['classifySub'] };
      }
      if (needsContact && contactPhone.trim() && !phoneOk(contactPhone)) {
        return { msg: 'Enter a valid contact number for this job — digits only, e.g. +971 50 123 4567 — or leave it empty.', fields: ['contactPhone'] };
      }
      if (needsContact && contactEmail.trim() && !EMAIL_RE.test(contactEmail.trim())) {
        return { msg: 'Enter a valid contact e-mail for this job, or leave it empty.', fields: ['contactEmail'] };
      }
      return null;
    }

    /* ── 2. Which car, and what the odometer reads ── */
    if (s === 2) {
      const f = []; const missing = [];
      if (enteringVehicle) {
        const v = newVehicle;
        if (!v.make.trim()) { f.push('make'); missing.push('Make'); }
        if (!v.model.trim()) { f.push('model'); missing.push('Model'); }
        if (!v.plate_number.trim()) { f.push('plate'); missing.push('Plate number'); }
        if (!normVin(v.vin)) { f.push('vin'); missing.push('VIN / chassis number'); }
        if (missing.length) return { msg: `Missing: ${missing.join(', ')}.`, fields: f };
        if (v.make.trim().toLowerCase() === 'other') return { msg: 'Type the actual make (e.g. JAC or Exeed) rather than "Other".', fields: ['make'] };
        if (vinBad(v.vin)) return { msg: VIN_MSG, fields: ['vin'] };
        if (v.year && (!/^\d{4}$/.test(v.year) || Number(v.year) < 1950 || Number(v.year) > THIS_YEAR + 1)) {
          return { msg: `Year must be between 1950 and ${THIS_YEAR + 1}, or left empty.`, fields: ['year'] };
        }
      } else if (customerMode === 'existing') {
        if (!pickedVehicle) return { msg: 'Select the vehicle, or add a new one.', fields: ['vehicle'] };
        // The car must be one of THIS customer's — a car picked for a
        // previous customer, or a stale selection, is never carried over.
        // (Edit: a legacy job whose car is on file under another account
        // can still be saved as long as the car is not changed.)
        const owned = String(pickedVehicle.customer_id) === String(customerId);
        if (!owned && (!editMode || vehicleChanged)) {
          return { msg: 'That vehicle is not on file for this customer. Select one of their vehicles, or add a new one.', fields: ['vehicle'] };
        }
        if (pickedNeedsVin) {
          if (!normVin(vinFix)) { f.push('vinFix'); missing.push('VIN / chassis number'); }
          else if (vinBad(vinFix)) return { msg: VIN_MSG, fields: ['vinFix'] };
        }
      }
      if (missing.length) return { msg: `Missing: ${missing.join(', ')}.`, fields: f };
      // The odometer reading is optional; when typed it must make sense.
      const odo = normOdo(odometerIn);
      if (!odo) return null;
      if (!/^\d+$/.test(odo)) return { msg: 'The odometer reading must be a whole number of kilometres — digits only, no decimals or signs.', fields: ['odometer'] };
      if (Number(odo) > 9999999) return { msg: 'That odometer reading looks wrong — check the dashboard.', fields: ['odometer'] };
      if (odoLow && !odoLowAck) {
        return { msg: `The reading is lower than the last one on file (${fmtKm(lastKm)}). Check the dashboard; if it is right, tick the box to confirm.`, fields: ['odoAck'] };
      }
      return null;
    }

    /* ── 3. What is wrong with it ── */
    if (s === 3) {
      if (!description.trim()) return { msg: 'Describe the customer complaint or the work requested.', fields: ['description'] };
      if (description.length > 5000) return { msg: 'The complaint is longer than 5,000 characters — shorten it.', fields: ['description'] };
      if (specialInstructions.length > 5000) return { msg: 'The notes are longer than 5,000 characters — shorten them.', fields: ['notes'] };
      if (channelEditable && !INTAKE_CHANNELS.some(c => c.value === intakeChannel)) return { msg: 'Choose how the request was received.', fields: ['channel'] };
      return null;
    }

    /* ── 4. Money ── */
    if (s === 4) {
      if (!counterAllowed) return null;
      for (const l of lines) {
        if (!l.touched) continue;
        const k = `item-${l.key}`;
        if (!l.named) return { msg: 'Give each priced line a description, or remove it.', fields: [`${k}-name`] };
        if (l.name.trim().length > 255) return { msg: 'A line description can be at most 255 characters.', fields: [`${k}-name`] };
        // Older lines may have no type; a new one says what it is.
        if (!l.id && !l.item_type) return { msg: 'Choose what each line is — Labour, Parts, Sublet or Consumable.', fields: [`${k}-type`] };
        if (!Number.isFinite(l.q) || l.q <= 0 || l.q > 9999999) return { msg: 'Quantity must be a number above 0 (up to 3 decimals).', fields: [`${k}-qty`] };
        if (!Number.isFinite(l.p)) return { msg: 'Prices must be plain numbers with up to 2 decimals — no commas, no minus sign.', fields: [`${k}-price`] };
      }
      const fee = moneyVal(serviceFee); const disc = moneyVal(discount);
      if (!Number.isFinite(fee)) return { msg: 'The service fee must be a plain number (0 or more, up to 2 decimals).', fields: ['serviceFee'] };
      if (!Number.isFinite(disc)) return { msg: 'The discount must be a plain number (0 or more, up to 2 decimals).', fields: ['discount'] };
      if (disc > round2(totals.itemsTotal + fee)) return { msg: `The discount cannot be more than the subtotal (${fmt(totals.itemsTotal + fee)}).`, fields: ['discount'] };
      if (totals.grand > 99999999) return { msg: 'That total is too large — check the quantities and prices.', fields: [] };
      return null;
    }
    return null;
  };

  const next = () => {
    // A double-click on Next must not skip the page it lands on.
    if (Date.now() - stepChangedAt.current < 400) return;
    const v = validateStep(step);
    if (v) { showError(v.msg, v.fields); return; }
    setError(''); setInvalid([]); setNotice(null);
    setStep(pages[Math.min(pageIdx + 1, pages.length - 1)].n);
  };
  const back = () => {
    if (Date.now() - stepChangedAt.current < 400) return;
    setError(''); setInvalid([]); setNotice(n => (n?.kind === 'stale' ? n : null));
    setStep(pages[Math.max(pageIdx - 1, 0)].n);
  };

  /* ── Add internal account (managers) ── */
  const saveInternalAccount = async () => {
    const f = internalForm || {};
    if (!String(f.full_name || '').trim() || /[<>]/.test(f.full_name)) { showError('Enter the account name (no < or >).', ['intName']); return; }
    if (!phoneOk(f.phone || '')) { showError('Enter a valid contact number for the account, e.g. +971 4 123 4567.', ['intPhone']); return; }
    if (f.email && !EMAIL_RE.test(f.email.trim())) { showError('Enter a valid e-mail address, or leave it empty.', ['intEmail']); return; }
    setSavingInternal(true);
    try {
      const res = await api.post('/customers', {
        full_name: f.full_name.trim(), phone: f.phone.trim(), email: f.email?.trim() || undefined,
        code: f.code?.trim() || undefined, customer_class: 'internal', customer_subcategory: internalSub,
      });
      if (!res.success) {
        showError(res.code === 'DUPLICATE_PHONE' && res.existing
          ? `That number is already on file for ${res.existing.full_name} (${classLabel(res.existing.customer_class, res.existing.customer_subcategory)}).`
          : (res.message || 'Could not add the account.'), ['intPhone']);
        return;
      }
      setInternalForm(null);
      setCustomers([res.data]); setCustomersTotal(1);
      selectCustomer(res.data);
    } catch {
      showError('Network error — please try again.');
    } finally {
      setSavingInternal(false);
    }
  };

  /* ── submit ── */
  const submit = async () => {
    if (submittingRef.current) return;
    if (editInfo?.closed) return;
    // Every page except the review, which has nothing of its own to check.
    // Jumps back to whichever page actually failed.
    for (const { n: s } of pages.slice(0, -1)) {
      const v = validateStep(s);
      if (v) { setStep(s); showError(v.msg, v.fields); return; }
    }
    submittingRef.current = true; setSubmitting(true);
    setError(''); setInvalid([]); setNotice(null);
    const stop = (msg, { toStep, fields = [], notice: n = null } = {}) => {
      if (toStep) setStep(toStep);
      showError(msg, fields);
      if (n) setNotice(n);
      submittingRef.current = false; setSubmitting(false);
    };
    try {
      let cust = customerMode === 'existing' ? selectedCustomer : null;
      let custId = customerMode === 'existing' ? Number(customerId) : null;

      // 1. A new customer is created once per wizard session. On success the
      // wizard switches to that record (Existing customer, selected), so a
      // later failure — the vehicle, the job card number — is retried
      // against it instead of POSTing the same person again and dead-ending
      // on "A customer with this phone number already exists".
      if (customerMode === 'new') {
        const res = await api.post('/customers', {
          full_name: customerName.trim(), phone: customerPhone.trim(),
          email: customerEmail.trim() || undefined,
          customer_class: 'external', customer_subcategory: newExternalSub,
          ...(newExternalSub !== 'walkin' ? { type: 'business', company_name: customerName.trim() } : {}),
        });
        if (!res.success) {
          if (res.status === 409) {
            if (res.existing) {
              return stop(`${real(res.existing.phone) || 'This number'} is already on file for ${res.existing.full_name}. Use that customer — the vehicle and complaint you entered are kept.`,
                { notice: { kind: 'dup', existing: res.existing } });
            }
            setDupNonce(n => n + 1);
            return stop('A customer with this mobile number is already on file — pick them from the list below.', { toStep: 1, fields: ['customerPhone'] });
          }
          return stop(res.message || 'Could not create the customer.', { toStep: 1, fields: ['customerName', 'customerPhone'] });
        }
        cust = res.data; custId = cust.id;
        setExternalOpt('existing'); setExternalSub('');
        setCustomerId(String(cust.id)); setSelectedCustomer(cust);
        setCustomers([cust]); setCustomersTotal(1); setCustomerSearch(real(cust.phone) || cust.full_name || '');
        setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
        // The car typed for them becomes "add a new vehicle" on that record.
        setAddingVehicle(true);
      }

      // 2. A missing external subcategory goes onto the customer (C1).
      if (cust && cust.customer_class !== 'internal' && !cust.customer_subcategory && classifySub) {
        const res = await api.put(`/customers/${custId}`, { customer_subcategory: classifySub });
        if (!res.success) return stop(res.message || 'Could not save the customer\'s subcategory.', { toStep: 1, fields: ['classifySub'] });
        cust = res.data || { ...cust, customer_subcategory: classifySub };
        setSelectedCustomer(cust); setClassifySub('');
      }

      // 3. A new vehicle, also created once: on success it becomes the
      // selected car.
      let vId = pickedVehicle ? pickedVehicle.id : null;
      if (enteringVehicle && custId) {
        const v = newVehicle;
        const res = await api.post('/vehicles', {
          customer_id: custId,
          make: v.make.trim(), model: v.model.trim(),
          year: v.year ? Number(v.year) : null,
          plate_number: v.plate_number.trim().replace(/\s+/g, ' ').toUpperCase(),
          plate_code: v.plate_code.trim().toUpperCase() || null,
          plate_emirate: v.plate_emirate || null,
          vin: normVin(v.vin),
          engine_no: v.engine_no.trim() || null, fleet_code: v.fleet_code.trim() || null, color: v.color.trim() || null,
          fuel_type: v.fuel_type, transmission: v.transmission,
          // The first thing we know about the car is also the last thing
          // we know about it.
          mileage: normOdo(odometerIn) ? Number(normOdo(odometerIn)) : null,
          // Set once the advisor has said "it is a different car" to the
          // duplicate-plate question below.
          ...(plateConfirmedRef.current ? { confirm_duplicate_plate: true } : {}),
        });
        if (!res.success) {
          const dupCust = res.data?.customer_id ?? res.existing?.customer_id;
          if (res.code === 'VIN_DUPLICATE') {
            if (String(dupCust) === String(custId) && res.data?.vehicle_id) {
              // Already this customer's car: select it rather than add a twin.
              const d = await api.get(`/vehicles/${res.data.vehicle_id}`).catch(() => null);
              if (d?.success && d.data) {
                setAddingVehicle(false); setNewVehicle({ ...EMPTY_VEHICLE }); setPickedVehicle(d.data);
                return stop(`This VIN is already on file for this customer (${plateText(d.data) || 'no plate'} · ${[d.data.make, d.data.model].filter(Boolean).join(' ')}). That vehicle is now selected — check it and press Create again.`, { toStep: 2, fields: ['vehicle'] });
              }
            }
            return stop(`${res.message} That vehicle is on file under another customer, so it cannot be added here. Check the chassis number, or go back and check that you picked the right customer.`, { toStep: 2, fields: ['vin'] });
          }
          if (res.code === 'PLATE_DUPLICATE') {
            // A plate, unlike a VIN, can legitimately move to another car —
            // so this is a question, not a block.
            return stop(res.message || 'This plate is already on file.', { notice: { kind: 'plate', existing: res.existing || res.data || {}, sameCustomer: String(dupCust) === String(custId) } });
          }
          const field = { VIN_INVALID: 'vin', VIN_REQUIRED: 'vin', YEAR_INVALID: 'year', MILEAGE_INVALID: 'odometer' }[res.code];
          return stop(res.message || 'Could not save the vehicle.', { toStep: 2, fields: field ? [field] : [] });
        }
        const created = res.data;
        vId = created.id;
        setAddingVehicle(false); setNewVehicle({ ...EMPTY_VEHICLE });
        setPickedVehicle(created);
        setVehicles(prev => [created, ...prev.filter(p => p.id !== created.id)]);
      }

      // 4. Backfill a VIN onto an existing vehicle that had none. Before the
      // job card, because the create refuses a vehicle with no VIN.
      if (vId && pickedNeedsVin && normVin(vinFix)) {
        const vin = normVin(vinFix);
        const res = await api.put(`/vehicles/${vId}`, { vin });
        if (!res.success) {
          return stop(res.code === 'VIN_DUPLICATE'
            ? `${res.message} Check the chassis plate — this VIN belongs to another vehicle on file.`
            : (res.message || 'Could not save the VIN onto the vehicle.'), { toStep: 2, fields: ['vinFix'] });
        }
        setPickedVehicle(pv => (pv && String(pv.id) === String(vId) ? { ...pv, vin } : pv));
        setVinFix('');
      }

      const odometer = normOdo(odometerIn) ? Number(normOdo(odometerIn)) : null; // optional
      const counterPayload = counterAllowed ? {
        service_fee: totals.fee,
        discount: totals.disc,
        // Informational: the server prices the job card from the lines.
        cash_amount: totals.itemsTotal,
        items: pricedLines.map(l => ({
          ...(l.id ? { id: l.id } : {}),
          name: l.name.trim(), quantity: l.q, unit_price: l.p, notes: l.notes.trim() || null,
          ...(l.item_type ? { item_type: l.item_type } : {}),
        })),
      } : {};

      if (editMode) {
        // ── EDIT ──
        // Only what this wizard edits is sent; the server keeps everything
        // else as it is (notes, drop-off, fleet-link details, the schedule).
        // expected_updated_at makes a save from an out-of-date copy fail
        // instead of overwriting what someone else saved in between.
        const body = {
          expected_updated_at: editInfo?.updatedAt ?? undefined,
          ...(customerMode === 'legacy'
            ? { customer_name: customerName.trim(), customer_phone: customerPhone.trim(), customer_email: customerEmail.trim() }
            : { customer_id: Number(custId), vehicle_id: vId || null }),
          service_bay_id: serviceBayId ? Number(serviceBayId) : null,
          work_order_type: workOrderType,
          service_category: serviceCategory,
          description: description.trim(),
          special_instructions: specialInstructions.trim() || null,
          odometer_in: odometer,
          payment_method: paymentMethod,
          ...(channelEditable ? { intake_channel: intakeChannel } : {}),
          ...(counterAllowed ? { service_fee: totals.fee, discount: totals.disc, cash_amount: totals.itemsTotal } : {}),
          // Lines go in the same request (one transaction), and only when
          // they changed. Each keeps its id, so its sub-job card, type and
          // estimate link survive — rebuilding them used to detach them all.
          ...(counterAllowed && linesSig(pricedLines) !== editInfo?.itemsSig ? { items: counterPayload.items } : {}),
        };
        const res = await api.put(`/work-orders/${editInfo?.id || editOrder.id}`, body);
        if (!res.success) return handleEditFailure(res, stop);
        submittingRef.current = false; setSubmitting(false);
        onUpdated?.(res.data);
        return undefined;
      }

      // ── CREATE ──
      const payload = {
        customer_id: custId,
        vehicle_id: vId,
        service_bay_id: serviceBayId ? Number(serviceBayId) : null,
        work_order_type: workOrderType,
        service_category: serviceCategory,
        // The server takes the snapshot from the customer record; sent for
        // older servers only, without the "-" placeholder some accounts hold.
        customer_name: cust?.full_name || '',
        customer_phone: real(cust?.phone) || (needsContact ? contactPhone.trim() : ''),
        customer_email: real(cust?.email) || (needsContact ? contactEmail.trim() : ''),
        description: description.trim(),
        special_instructions: specialInstructions.trim() || null,
        scheduled_at: scheduledAt || null,
        odometer_in: odometer,
        intake_channel: intakeChannel,
        payment_method: paymentMethod,
        ...(approvalOffered && approvalChannel ? { customer_approval_channel: approvalChannel } : {}),
        ...counterPayload,
      };
      const res = await api.post('/work-orders', payload);
      if (!res.success) {
        if (res.upgrade_required) return stop(res.message || 'Work order limit reached — upgrade your plan.');
        if (res.code === 'VEHICLE_NOT_CUSTOMERS') { setPickedVehicle(null); return stop(res.message || 'That vehicle is not on file for this customer — select one of theirs.', { toStep: 2, fields: ['vehicle'] }); }
        if (res.code === 'PRICE_ON_ESTIMATE') return stop(res.message || 'This customer\'s job is priced on the estimate after the inspection.', { toStep: 4 });
        if (res.code === 'VIN_REQUIRED') return stop(res.message || 'The vehicle needs a VIN.', { toStep: 2, fields: pickedNeedsVin ? ['vinFix'] : [] });
        // Anything else: the customer and vehicle (if new) are already saved
        // and selected, so pressing Create again does not duplicate them.
        return stop(res.message || 'Could not create the job card. Press Create to try again.');
      }
      submittingRef.current = false; setSubmitting(false);
      onCreated?.(res.data);
      return undefined;
    } catch (e) {
      console.error(e);
      return stop('Network error — please try again.');
    }
  };

  function handleEditFailure(res, stop) {
    if (res.status === 409 && (res.code === 'STALE_EDIT' || res.code === 'LINE_NOT_FOUND')) {
      return stop('Someone else changed this job card since you opened it. Reload it to see their changes, then make yours again.', { notice: { kind: 'stale' } });
    }
    if (res.status === 409 && res.code === 'LOCKED_AFTER_ESTIMATE') {
      // Put the original customer and car back, and lock them.
      const o = editInfo || {};
      if (o.origCustomer) { applyClassification(o.origCustomer); setCustomerId(String(o.origCustomer.id)); setSelectedCustomer(o.origCustomer); }
      setPickedVehicle(o.origVehicle || null); setAddingVehicle(false);
      setEditInfo(e => (e ? { ...e, locked: true, lockReason: res.message || e.lockReason } : e));
      return stop(`${res.message || 'The customer and vehicle can no longer be changed.'} The original customer and vehicle have been put back.`, { toStep: 1 });
    }
    // Completed or cancelled while this wizard was open.
    if (res.status === 409 && (/CLOSED/.test(res.code || '') || /completed|cancelled/.test(String(res.message || '')))) {
      setEditInfo(e => (e ? { ...e, closed: true, lockReason: res.message || e.lockReason } : e));
    }
    return stop(res.message || 'Could not update the job card.');
  }

  if (!open) return null;

  /* ── Roles that cannot open job cards never get the form ── */
  if (!mayOpen) {
    return (
      <div className="nwo-overlay" onMouseDown={e => { downOnOverlay.current = e.target === e.currentTarget; }}
        onClick={e => { if (downOnOverlay.current && e.target === e.currentTarget) onClose?.(); }}>
        <div className="nwo-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="nwo-title" style={{ height: 'auto', maxWidth: 520 }}>
          <div className="nwo-header">
            <h2 id="nwo-title" className="nwo-title">{editMode ? 'Edit Work Order' : 'New Work Order'}</h2>
            <button type="button" className="nwo-close" onClick={onClose} aria-label="Close"><Xmark width={20} height={20} /></button>
          </div>
          <div className="nwo-body" style={{ paddingBottom: 22 }}>
            <p style={{ margin: 0, color: '#475569', fontSize: 14, lineHeight: 1.5 }} ref={headRef} tabIndex={-1}>
              Only a Service Advisor, Supervisor or manager can open or edit job cards. Ask one of them to record this request.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const cur = pages[pageIdx];
  const locked = !!editInfo?.locked;
  const closedJob = !!editInfo?.closed;
  const internalEmpty = customerClass === 'internal' && internalSub && !customersLoading && customers.length === 0 && !customerSearch.trim();
  const needsClassify = customerMode === 'existing' && selectedCustomer && selectedCustomer.customer_class !== 'internal' && !selectedCustomer.customer_subcategory;
  const custPhoneShown = customerMode === 'existing'
    ? (real(selectedCustomer?.phone) || (needsContact ? contactPhone.trim() : '')) : customerPhone.trim();
  const custNameShown = customerMode === 'existing' ? (selectedCustomer?.full_name || '') : customerName.trim();
  const reviewVehicle = enteringVehicle ? { ...newVehicle, vin: normVin(newVehicle.vin), isNew: true } : pickedVehicle
    ? { ...pickedVehicle, vin: normVin(vinFix) || pickedVehicle.vin } : null;
  const grownPastApproval = editMode && editInfo?.approvedAt && editInfo.approvedTotal != null && totals.grand > editInfo.approvedTotal + 0.004;

  return (
    <div className="nwo-overlay"
      onMouseDown={e => { downOnOverlay.current = e.target === e.currentTarget; }}
      onClick={e => { if (downOnOverlay.current && e.target === e.currentTarget) requestClose(); }}>
      <div className="nwo-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="nwo-title" aria-describedby="nwo-subtitle">
        {/* Header */}
        <div className="nwo-header">
          <div style={{ minWidth: 0 }}>
            <h2 id="nwo-title" className="nwo-title">{editMode ? 'Edit Work Order' : 'New Work Order'}</h2>
            <p id="nwo-subtitle" className="nwo-subtitle" ref={headRef} tabIndex={-1}>
              {editMode && (editInfo?.number || editOrder.work_order_number) ? `${editInfo?.number || editOrder.work_order_number} — ` : ''}
              Page {pageIdx + 1} of {pages.length} — {cur.title}
              <span className="nwo-process"> · {cur.process}</span>
            </p>
          </div>
          <button type="button" className="nwo-close" onClick={requestClose} aria-label="Close"><Xmark width={20} height={20} /></button>
        </div>

        {/* Stepper */}
        <ol className="nwo-stepper" aria-label="Pages" style={{ listStyle: 'none', margin: 0 }}>
          {pages.map((s, i) => {
            const Icon = s.icon;
            const active = step === s.n;
            const done = step > s.n;
            return (
              <li key={s.n} style={{ display: 'contents' }}>
                <div className={`nwo-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`} aria-current={active ? 'step' : undefined}>
                  <div className="nwo-step-bubble" aria-hidden="true">
                    {done ? <Check width={16} height={16} /> : <Icon width={16} height={16} />}
                  </div>
                  <span className="nwo-step-label">{s.title}</span>
                </div>
                {i < pages.length - 1 && <div className={`nwo-step-line${done ? ' is-done' : ''}`} aria-hidden="true" />}
              </li>
            );
          })}
        </ol>

        {/* Body */}
        <div className="nwo-body" ref={bodyRef}>
          {error && (
            <div className="nwo-alert" role="alert">
              <WarningCircle width={17} height={17} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ minWidth: 0 }}>
                <div>{error}</div>
                {notice?.kind === 'dup' && notice.existing && (
                  <div className="nwo-alert-actions">
                    <button type="button" className="nwo-alert-btn" onClick={() => adoptExistingCustomer(notice.existing, { keepVehicle: true })}>
                      <User width={14} height={14} /> Use this customer — {notice.existing.full_name}
                    </button>
                  </div>
                )}
                {notice?.kind === 'plate' && (
                  <div className="nwo-alert-actions">
                    {notice.sameCustomer && notice.existing?.vehicle_id && (
                      <button type="button" className="nwo-alert-btn" onClick={async () => {
                        const d = await api.get(`/vehicles/${notice.existing.vehicle_id}`).catch(() => null);
                        if (!d?.success || !d.data) { showError('Could not load that vehicle — choose it from the list on page 2.'); return; }
                        setAddingVehicle(false); setNewVehicle({ ...EMPTY_VEHICLE }); setPickedVehicle(d.data);
                        setNotice(null); setError(''); setInvalid([]);
                      }}>
                        <Car width={14} height={14} /> Use the vehicle on file
                      </button>
                    )}
                    <button type="button" className="nwo-alert-btn" onClick={() => {
                      plateConfirmedRef.current = true; setNotice(null); setError('');
                      submit();
                    }}>
                      <Check width={14} height={14} /> It is a different car — save it
                    </button>
                  </div>
                )}
                {notice?.kind === 'stale' && (
                  <div className="nwo-alert-actions">
                    <button type="button" className="nwo-alert-btn" onClick={() => {
                      if (!window.confirm('Reload the job card? The changes you made here will be lost.')) return;
                      setReloadNonce(n => n + 1);
                    }}>
                      <Refresh width={14} height={14} /> Reload the latest version
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {loading && (editMode || presetCustomerId) && <div style={st.emptyHint}>Loading…</div>}

          {closedJob && (
            <div style={st.lockNote}>
              <Lock width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{editInfo.lockReason} A {editInfo.status} work order can no longer be edited.</span>
            </div>
          )}

          {/* ══ PAGE 1 — who the customer is ══ */}
          {step === 1 && !(loading && (editMode || presetCustomerId)) && (
            <div className="nwo-page">
              <div style={st.pageMain}>
                {customerMode === 'legacy' ? (
                  <>
                    <div style={st.blockLabel}>Customer on this job card</div>
                    <div style={st.blockHint}>
                      This job card was opened before customers were recorded separately. The name and
                      phone are stored on the job card only.
                    </div>
                    <div className="nwo-grid2">
                      <Field label="Customer name" required>
                        <input style={st.input} className={badCls('customerName')} data-field="customerName" maxLength={255}
                          aria-invalid={bad('customerName') || undefined}
                          value={customerName} onChange={e => setCustomerName(e.target.value)} />
                      </Field>
                      <Field label="Mobile number" required>
                        <input style={st.input} className={badCls('customerPhone')} data-field="customerPhone" maxLength={25}
                          dir="ltr" type="tel" inputMode="tel" aria-invalid={bad('customerPhone') || undefined}
                          value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
                      </Field>
                    </div>
                  </>
                ) : locked ? (
                  <>
                    <div style={st.blockLabel}>Customer</div>
                    <div style={st.lockNote}>
                      <Lock width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{editInfo.lockReason} The customer can no longer be changed on this work order.</span>
                    </div>
                    {needsClassify && (
                      <ClassifyBlock value={classifySub} onChange={setClassifySub} invalid={bad('classifySub')} t={t} />
                    )}
                  </>
                ) : (
                  <>
                    <div style={st.blockLabel}>Select customer type</div>
                    <div style={st.blockHint}>Internal accounts are the company&apos;s own fleet, insurers and assets; everyone else is external.</div>
                    <div className="nwo-cardrow" role="radiogroup" aria-label="Customer type" onKeyDown={radioKeys}>
                      <ChoiceCard
                        icon={Building} title="Internal Customer"
                        desc="Company fleet, assets and inter-functional entities"
                        selected={customerClass === 'internal'}
                        onClick={() => {
                          if (customerClass === 'internal') return;
                          setCustomerClass('internal'); setExternalOpt('existing'); setExternalSub('');
                          clearCustomer(); setCustomerSearch(''); setInternalForm(null);
                        }}
                      />
                      <ChoiceCard
                        icon={User} title="External Customer"
                        desc={t('orders.form.external_desc', 'Outside fleets, insurers and walk-in customers')}
                        selected={customerClass === 'external'}
                        onClick={() => {
                          if (customerClass === 'external') return;
                          setCustomerClass('external'); setInternalSub(''); setExternalSub('');
                          clearCustomer(); setCustomerSearch(''); setInternalForm(null);
                        }}
                      />
                    </div>

                    {customerClass === 'internal' && (
                      <>
                        <div style={st.blockLabel}>Internal subcategory <span style={st.req}>*</span></div>
                        <div style={st.blockHint}>Choose the internal category to list its accounts.</div>
                        <PillGroup label="Internal subcategory" field="internalSub" invalid={bad('internalSub')}
                          value={internalSub}
                          onChange={(v) => { setInternalSub(v); clearCustomer(); setCustomerSearch(''); setInternalForm(null); }}
                          options={[
                            { v: 'fleet', label: t('orders.form.sub_fleet', 'Fleet'), Icon: Truck },
                            { v: 'insurance', label: t('orders.form.sub_insurance', 'Insurance'), Icon: ShieldCheck },
                            { v: 'asset', label: 'Asset', Icon: Box },
                          ]} />
                      </>
                    )}

                    {customerClass === 'external' && (
                      <>
                        <div style={st.blockLabel}>Existing or new customer</div>
                        <div style={st.blockHint}>Search the customers on file first — most people have been here before.</div>
                        <div className="nwo-cardrow" role="radiogroup" aria-label="Existing or new customer" onKeyDown={radioKeys}>
                          <ChoiceCard
                            icon={Search} title="Existing Customer"
                            desc="Search and select from existing customer records"
                            selected={externalOpt === 'existing'}
                            onClick={() => { if (externalOpt === 'existing') return; setExternalOpt('existing'); clearCustomer(); }}
                          />
                          <ChoiceCard
                            icon={UserPlus} title="New Customer"
                            desc="Not in the system yet — a walk-in, or an outside fleet or insurer"
                            selected={externalOpt === 'new'}
                            onClick={() => { if (externalOpt === 'new') return; setExternalOpt('new'); clearCustomer(); }}
                          />
                        </div>

                        {externalOpt === 'existing' && (
                          <>
                            <div style={st.blockLabel}>Filter the list</div>
                            <div style={st.blockHint}>
                              Narrow the search to outside fleets, insurers or walk-in customers — or keep All. This only filters; it does not classify anyone.
                            </div>
                            <PillGroup label="Filter the customer list" value={externalSub}
                              onChange={(v) => {
                                setExternalSub(v);
                                // Keep a customer who still fits the new filter.
                                if (v && selectedCustomer && selectedCustomer.customer_subcategory !== v) clearCustomer();
                              }}
                              options={[
                                { v: '', label: t('orders.form.external_sub_all', 'All'), Icon: User },
                                { v: 'fleet', label: t('orders.form.sub_fleet', 'Fleet'), Icon: Truck },
                                { v: 'insurance', label: t('orders.form.sub_insurance', 'Insurance'), Icon: ShieldCheck },
                                { v: 'walkin', label: t('orders.form.sub_walkin', 'Walk-in'), Icon: UserPlus },
                              ]} />
                          </>
                        )}
                      </>
                    )}

                    {customerMode === 'existing' ? (
                      <>
                        <div style={st.blockLabel}>Select customer <span style={st.req}>*</span></div>
                        <div style={st.blockHint}>Search by name, code, phone, plate or VIN.</div>
                        {customerClass === 'internal' && !internalSub ? (
                          <div style={st.emptyHint}>Pick a subcategory above to see its accounts.</div>
                        ) : (
                          <>
                            <div className="nwo-search" style={st.searchWrap}>
                              <Search width={16} height={16} style={{ color: '#94a3b8', flexShrink: 0 }} aria-hidden="true" />
                              <input style={st.searchInput} aria-label="Search customers"
                                placeholder="Search customer name, code, phone, plate or VIN…"
                                value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                            </div>
                            <div style={st.custListTall} className={bad('customer') ? 'nwo-invalid-group' : undefined}
                              role="listbox" aria-label="Customers" tabIndex={-1} data-field="customer">
                              {customersLoading && <div style={st.emptyHint}>Searching…</div>}
                              {!customersLoading && customers.length === 0 && (
                                <div style={st.emptyHint}>
                                  {customerSearch.trim()
                                    ? 'No customers match.'
                                    : customerClass === 'internal'
                                      ? `No internal ${subLabel(internalSub).toLowerCase()} accounts are set up yet.${manager ? '' : ' Ask the Workshop Manager to add one.'}`
                                      : externalSub
                                        ? t('orders.form.external_sub_empty', {
                                            sub: subLabel(externalSub),
                                            defaultValue: 'No external {{sub}} accounts are set up yet. Classify them from the Customers page, or choose All.',
                                          })
                                        : 'Type a name, code, phone, plate or VIN to search.'}
                                </div>
                              )}
                              {customers.map(c => {
                                const on = String(c.id) === String(customerId);
                                return (
                                  <button key={c.id} type="button" role="option" aria-selected={on}
                                    style={{ ...st.custItem, ...(on ? st.custItemOn : {}) }}
                                    onClick={() => selectCustomer(c)}>
                                    <div style={st.custName}>{c.full_name}</div>
                                    <div style={st.custMeta}>
                                      {[real(c.code), real(c.phone) ? <bdi key="p" dir="ltr">{real(c.phone)}</bdi> : null,
                                        // Under "All" external, say which accounts are an outside fleet or insurer.
                                        customerClass === 'external' && !externalSub && c.customer_subcategory ? subLabel(c.customer_subcategory) : '',
                                      ].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}
                                      {!real(c.code) && !real(c.phone) && 'No code or phone on file'}
                                    </div>
                                  </button>
                                );
                              })}
                              {!customersLoading && customersTotal > customers.length && (
                                <div style={st.moreHint}>
                                  Showing {customers.length} of {customersTotal.toLocaleString('en-US')} — type more of the name, phone or plate to narrow it down.
                                </div>
                              )}
                            </div>

                            {/* D7: an internal account takes its customer's estimates
                                out of the Supervisor/WM approval, so only a manager
                                creates one. */}
                            {internalEmpty && manager && !internalForm && (
                              <button type="button" style={st.addVehicleBtn} onClick={() => setInternalForm({ full_name: '', phone: '', email: '', code: '' })}>
                                <Plus width={16} height={16} /> Add internal account
                              </button>
                            )}
                            {internalForm && (
                              <div style={st.inlineForm}>
                                <div style={st.blockLabel}>New internal {subLabel(internalSub).toLowerCase()} account</div>
                                <div style={st.blockHint}>Internal accounts skip the Supervisor / Workshop Manager estimate approval.</div>
                                <div className="nwo-grid2">
                                  <Field label="Account name" required>
                                    <input style={st.input} className={badCls('intName')} data-field="intName" maxLength={255}
                                      value={internalForm.full_name} onChange={e => setInternalForm(f => ({ ...f, full_name: e.target.value }))} />
                                  </Field>
                                  <Field label="Contact number" required>
                                    <input style={st.input} className={badCls('intPhone')} data-field="intPhone" maxLength={25}
                                      dir="ltr" type="tel" inputMode="tel"
                                      value={internalForm.phone} onChange={e => setInternalForm(f => ({ ...f, phone: e.target.value }))} />
                                  </Field>
                                  <Field label="E-mail">
                                    <input style={st.input} className={badCls('intEmail')} data-field="intEmail" maxLength={255}
                                      dir="ltr" type="email" inputMode="email"
                                      value={internalForm.email} onChange={e => setInternalForm(f => ({ ...f, email: e.target.value }))} />
                                  </Field>
                                  <Field label="Account code">
                                    <input style={st.input} maxLength={50} placeholder="FLT-006"
                                      value={internalForm.code} onChange={e => setInternalForm(f => ({ ...f, code: e.target.value }))} />
                                  </Field>
                                </div>
                                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                                  <button type="button" style={st.primaryBtnSm} disabled={savingInternal} onClick={saveInternalAccount}>
                                    {savingInternal ? 'Saving…' : 'Add account'}
                                  </button>
                                  <button type="button" style={st.ghostBtnSm} onClick={() => setInternalForm(null)}>Cancel</button>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {needsClassify && (
                          <ClassifyBlock value={classifySub} onChange={setClassifySub} invalid={bad('classifySub')} t={t} />
                        )}

                        {needsContact && (
                          <div style={st.inlineForm}>
                            <div style={st.blockLabel}>Contact for this job <span style={st.optional}>(optional)</span></div>
                            <div style={st.blockHint}>
                              {selectedCustomer.full_name} has no phone number on file. Enter the fleet coordinator&apos;s or
                              driver&apos;s number so the estimate and the collection call reach someone. It is kept on this job card only.
                            </div>
                            <div className="nwo-grid2">
                              <Field label="Contact number">
                                <input style={st.input} className={badCls('contactPhone')} data-field="contactPhone" maxLength={25}
                                  dir="ltr" type="tel" inputMode="tel" autoComplete="off" aria-invalid={bad('contactPhone') || undefined}
                                  value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+971 50 123 4567" />
                              </Field>
                              {!real(selectedCustomer.email) && (
                                <Field label="Contact e-mail">
                                  <input style={st.input} className={badCls('contactEmail')} data-field="contactEmail" maxLength={255}
                                    dir="ltr" type="email" inputMode="email" autoComplete="off" aria-invalid={bad('contactEmail') || undefined}
                                    value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="name@example.com" />
                                </Field>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div style={st.blockLabel}>Customer type <span style={st.req}>*</span></div>
                        <div style={st.blockHint}>How this new external customer is classified (process step 1).</div>
                        <PillGroup label="New customer type" value={newExternalSub} onChange={setNewExternalSub}
                          options={[
                            { v: 'walkin', label: t('orders.form.sub_walkin', 'Walk-in'), Icon: UserPlus },
                            { v: 'fleet', label: 'Fleet (company)', Icon: Truck },
                            { v: 'insurance', label: 'Insurance (company)', Icon: ShieldCheck },
                          ]} />
                        <div style={st.blockLabel}>Customer information</div>
                        <div style={st.blockHint}>This creates a new customer record you will find under Customers.</div>
                        <div className="nwo-grid2">
                          <Field label={newExternalSub === 'walkin' ? 'Customer name' : 'Company name'} required>
                            <input style={st.input} className={badCls('customerName')} data-field="customerName" maxLength={255}
                              aria-invalid={bad('customerName') || undefined} autoComplete="off"
                              value={customerName} onChange={e => setCustomerName(e.target.value)}
                              placeholder={newExternalSub === 'walkin' ? 'Ahmed Al Mansoori' : 'Company LLC'} />
                          </Field>
                          <Field label="Mobile number" required>
                            <input style={st.input} className={badCls('customerPhone')} data-field="customerPhone" maxLength={25}
                              dir="ltr" type="tel" inputMode="tel" autoComplete="off" aria-invalid={bad('customerPhone') || undefined}
                              value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="+971 50 123 4567" />
                          </Field>
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <Field label="E-mail">
                            <input style={st.input} className={badCls('customerEmail')} data-field="customerEmail" maxLength={255}
                              dir="ltr" type="email" inputMode="email" autoComplete="off" aria-invalid={bad('customerEmail') || undefined}
                              value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="name@example.com" />
                          </Field>
                        </div>
                        {dupMatches.length > 0 && (
                          <div style={{ ...st.dupWarning, marginTop: 14 }}>
                            <div style={st.dupWarningTitle}>
                              {dupMatches.length === 1 ? 'Found a matching customer already on file:' : `Found ${dupMatches.length} matching customers already on file:`}
                            </div>
                            {dupMatches.map(c => {
                              const inactive = c.is_active === 0 || c.is_active === false;
                              return inactive ? (
                                <div key={c.id} style={{ ...st.dupMatchBtn, cursor: 'default', background: '#f8fafc' }}>
                                  <span>{c.full_name} · <bdi dir="ltr">{real(c.phone) || '—'}</bdi></span>
                                  <span style={st.inactiveBadge}>Deactivated — ask a manager to reactivate it</span>
                                </div>
                              ) : (
                                <button key={c.id} type="button" style={st.dupMatchBtn} onClick={() => adoptExistingCustomer(c)}>
                                  <span>{c.full_name} · <bdi dir="ltr">{real(c.phone) || '—'}</bdi>{c.customer_class ? ` · ${classLabel(c.customer_class, c.customer_subcategory)}` : ''}</span>
                                  <span style={st.dupMatchUse}>Use this customer</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>

              <div className="nwo-summary">
                <div style={st.blockLabel}>
                  {customerMode === 'existing' ? 'Selected customer' : 'Customer summary'}
                </div>
                {customerMode === 'existing' && !selectedCustomer && (
                  <div style={st.emptyHint}>No customer selected yet.</div>
                )}
                {customerMode === 'existing' && selectedCustomer && (
                  <div style={st.summaryCard}>
                    <div style={st.avatarRow}>
                      <div style={st.avatar}>{(selectedCustomer.full_name || '?').charAt(0).toUpperCase()}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={st.summaryName}>{selectedCustomer.full_name}</div>
                        <div style={st.summarySub}>{real(selectedCustomer.code) || (real(selectedCustomer.phone) ? <bdi dir="ltr">{real(selectedCustomer.phone)}</bdi> : '—')}</div>
                      </div>
                    </div>
                    <SummaryRow icon={Building} label="Type" value={selectedCustomer.customer_class === 'internal' ? 'Internal' : 'External'} />
                    <SummaryRow icon={Truck} label="Subcategory"
                      value={selectedCustomer.customer_subcategory ? subLabel(selectedCustomer.customer_subcategory) : classifySub ? `${subLabel(classifySub)} (saved with the job card)` : ''} />
                    <SummaryRow icon={Barcode} label="Code" value={real(selectedCustomer.code)} />
                    <SummaryRow icon={Phone} label="Phone" value={real(selectedCustomer.phone) || (needsContact && contactPhone.trim() ? `${contactPhone.trim()} (this job)` : '')} ltr />
                    <SummaryRow icon={Mail} label="E-mail" value={real(selectedCustomer.email)} ltr />
                    <SummaryRow icon={MapPin} label="Address" value={[selectedCustomer.city, selectedCustomer.emirate].filter(Boolean).join(', ')} />
                  </div>
                )}
                {customerMode !== 'existing' && (
                  <div style={st.summaryCard}>
                    <div style={st.avatarRow}>
                      <div style={{ ...st.avatar, background: '#2563eb' }}><User width={20} height={20} /></div>
                      <div style={{ minWidth: 0 }}>
                        <div style={st.summaryName}>{customerName.trim() || (customerMode === 'new' ? 'New customer' : 'Customer')}</div>
                        <div style={st.summarySub}>{customerMode === 'new' ? 'Not in the system yet' : 'On this job card only'}</div>
                      </div>
                    </div>
                    <SummaryRow icon={Building} label="Type" value="External" />
                    {customerMode === 'new' && <SummaryRow icon={UserPlus} label="Subcategory" value={subLabel(newExternalSub)} />}
                    <SummaryRow icon={Phone} label="Mobile" value={customerPhone.trim()} ltr />
                    <SummaryRow icon={Mail} label="E-mail" value={customerEmail.trim()} ltr />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ PAGE 2 — which car, and what the odometer reads ══ */}
          {step === 2 && (
            <div className="nwo-page">
              <div style={st.pageMain}>
                {customerMode === 'legacy' ? (
                  <>
                    <div style={st.blockLabel}>Vehicle</div>
                    <div style={st.blockHint}>
                      {pickedVehicle ? 'The vehicle on this job card.' : 'No vehicle is recorded on this job card.'}
                    </div>
                    {pickedVehicle && <VehicleCard v={pickedVehicle} on readOnly />}
                  </>
                ) : locked ? (
                  <>
                    <div style={st.blockLabel}>Vehicle</div>
                    <div style={st.lockNote}>
                      <Lock width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{editInfo.lockReason} The vehicle can no longer be changed on this work order.</span>
                    </div>
                    {pickedVehicle ? <VehicleCard v={pickedVehicle} on readOnly /> : <div style={st.emptyHint}>No vehicle on this job card.</div>}
                  </>
                ) : enteringVehicle ? (
                  <>
                    <div style={st.blockLabel}>{customerMode === 'new' ? 'Vehicle information' : 'New vehicle'}</div>
                    <div style={st.blockHint}>
                      {customerMode === 'new'
                        ? `The car ${customerName.trim() || 'the customer'} has arrived in. It is saved against them, so next time it is one click.`
                        : `Adding a vehicle for ${selectedCustomer?.full_name || 'this account'}.`}
                    </div>
                    <VehicleFormFields newVehicle={newVehicle} setNewVehicle={setNewVehicle} badCls={badCls} bad={bad} />
                    {customerMode === 'existing' && (
                      <button type="button" style={st.linkBtn} onClick={() => { setAddingVehicle(false); setNewVehicle({ ...EMPTY_VEHICLE }); setOdometerIn(''); setOdoLowAck(false); }}>
                        <NavArrowLeft width={15} height={15} className="nwo-flip" /> Choose an existing vehicle instead
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div style={st.blockLabel}>Select vehicle <span style={st.req}>*</span></div>
                    <div style={st.blockHint}>
                      {vehiclesOnFile > 0
                        ? `${vehiclesOnFile.toLocaleString('en-US')} vehicle${vehiclesOnFile === 1 ? '' : 's'} on file for ${selectedCustomer?.full_name || 'this account'}.`
                        : vehiclesLoading ? '' : 'Nothing on file for this account yet.'}
                    </div>
                    {(vehiclesOnFile > 4 || vehicleSearch) && (
                      <div className="nwo-search" style={st.searchWrap}>
                        <Search width={16} height={16} style={{ color: '#94a3b8', flexShrink: 0 }} aria-hidden="true" />
                        <input style={st.searchInput} aria-label="Search this customer's vehicles"
                          placeholder="Search plate, VIN, unit code, make or model…"
                          value={vehicleSearch} onChange={e => setVehicleSearch(e.target.value)} />
                      </div>
                    )}
                    {vehiclesLoading && vehicles.length === 0 && <div style={st.emptyHint}>Loading vehicles…</div>}
                    {!vehiclesLoading && vehiclesOnFile === 0 && !vehicleQuery && (
                      <div style={st.emptyHint}>No vehicles on file. Add the one in front of you below.</div>
                    )}
                    <div className={`nwo-vehgrid${bad('vehicle') ? ' nwo-invalid-group' : ''}`} role="radiogroup" aria-label="Vehicles on file" data-field="vehicle" tabIndex={-1} onKeyDown={radioKeys}>
                      {vehicleQuery && !vehiclesLoading && vehicles.length === 0 && (
                        <div style={st.emptyHint}>No vehicle matches &quot;{vehicleQuery}&quot;.</div>
                      )}
                      {vehicles.map((v, i) => (
                        <VehicleCard key={v.id} v={v} on={String(v.id) === vehicleId}
                          tabIndex={tabStop(String(v.id) === vehicleId, !vehicles.some(x => String(x.id) === vehicleId), i === 0)}
                          onPick={() => {
                            if (String(v.id) === vehicleId) return;
                            // Another car: its own VIN and its own reading.
                            setPickedVehicle(v); setVinFix(''); setOdometerIn(''); setOdoLowAck(false);
                          }} />
                      ))}
                    </div>
                    {vehiclesTotal > vehicles.length && (
                      <div style={st.moreRow}>
                        <span style={st.moreHint}>
                          Showing {vehicles.length} of {vehiclesTotal.toLocaleString('en-US')}{vehicleQuery ? ' matches' : ''} — search by plate, VIN or unit code to find one quickly.
                        </span>
                        <button type="button" style={st.ghostBtnSm} disabled={vehiclesLoading} onClick={loadMoreVehicles}>
                          {vehiclesLoading ? 'Loading…' : 'Show more'}
                        </button>
                      </div>
                    )}
                    {/* The picked car stays picked even when a new search hides it. */}
                    {pickedVehicle && !vehicles.some(v => String(v.id) === vehicleId) && (
                      <div style={st.pickedHidden}>
                        Selected: <strong><bdi dir="ltr">{plateText(pickedVehicle) || 'No plate'}</bdi></strong> · {[pickedVehicle.make, pickedVehicle.model].filter(Boolean).join(' ')}
                      </div>
                    )}
                    <button type="button" style={st.addVehicleBtn}
                      onClick={() => { setPickedVehicle(null); setVinFix(''); setOdometerIn(''); setOdoLowAck(false); setAddingVehicle(true); }}>
                      <Plus width={16} height={16} /> Add a new vehicle
                    </button>

                    {pickedNeedsVin && (
                      <div style={st.vinPrompt}>
                        <div style={st.vinPromptTitle}>
                          <WarningCircle width={15} height={15} style={{ verticalAlign: -2, marginInlineEnd: 6 }} />
                          This vehicle has no VIN / chassis number on file <span style={st.req}>*</span>
                        </div>
                        <div style={st.vinPromptBody}>
                          Read it off the chassis plate or the registration card. It is saved
                          onto the vehicle, so it is only ever asked for once.
                        </div>
                        <input style={{ ...st.input, marginTop: 8, textTransform: 'uppercase' }} dir="ltr"
                          className={badCls('vinFix')} data-field="vinFix" aria-label="VIN / chassis number" maxLength={25}
                          aria-invalid={bad('vinFix') || undefined}
                          value={vinFix} onChange={e => setVinFix(normVin(e.target.value))}
                          placeholder="JTNB11HK7N3024321" />
                        {vinHint(vinFix) && <div style={st.softWarn}>{vinHint(vinFix)}</div>}
                      </div>
                    )}
                  </>
                )}

                {openJobs.length > 0 && (
                  <div style={st.openJobNote}>
                    <InfoCircle width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      This car already has an open job card: {openJobs.slice(0, 3).map(w => `${w.work_order_number} (${String(w.status).replace(/_/g, ' ')})`).join(', ')}.
                      Open another one only if this is a separate visit.
                    </span>
                  </div>
                )}

                <div style={{ ...st.blockLabel, marginTop: 22 }}>
                  <label htmlFor="nwo-odometer">Odometer reading <span style={st.optional}>(optional)</span></label>
                </div>
                <div style={st.blockHint}>
                  What the dashboard reads today.
                  {lastKm != null && <> Last recorded for this car: <bdi dir="ltr">{fmtKm(lastKm)}</bdi>.</>}
                </div>
                <div style={st.mileageRow}>
                  <input id="nwo-odometer" style={st.mileageInput} className={badCls('odometer')} data-field="odometer"
                    value={odometerIn} inputMode="numeric" dir="ltr" maxLength={12} autoComplete="off"
                    aria-invalid={bad('odometer') || undefined}
                    onChange={e => { setOdometerIn(normOdo(e.target.value)); setOdoLowAck(false); }}
                    placeholder={lastKm != null ? `Last: ${lastKm}` : 'e.g. 45320'} />
                  <span style={st.mileageUnit}>KM</span>
                </div>
                {odoLow && (
                  <label style={{ ...st.odoWarn, ...(bad('odoAck') ? { borderColor: '#ef4444' } : {}) }}>
                    <input type="checkbox" checked={odoLowAck} data-field="odoAck" onChange={e => setOdoLowAck(e.target.checked)} style={{ marginTop: 2 }} />
                    <span>
                      This is lower than the last recorded reading (<bdi dir="ltr">{fmtKm(lastKm)}</bdi>). I have checked the dashboard — the reading is right.
                    </span>
                  </label>
                )}
              </div>

              <div className="nwo-summary">
                <div style={st.blockLabel}>Vehicle details</div>
                <div style={st.summaryCard}>
                  {enteringVehicle && !locked ? (
                    <>
                      <SummaryRow icon={Barcode} label="Plate number" value={newVehicle.plate_number.toUpperCase()} ltr />
                      <SummaryRow icon={Barcode} label="Plate code" value={newVehicle.plate_code.toUpperCase()} ltr />
                      <SummaryRow icon={MapPin} label="Emirate" value={newVehicle.plate_emirate} />
                      <SummaryRow icon={Car} label="Vehicle" value={[newVehicle.year, newVehicle.make, newVehicle.model].filter(Boolean).join(' ')} />
                      <SummaryRow icon={Car} label="Colour" value={newVehicle.color} />
                      <SummaryRow icon={DashboardSpeed} label="Odometer" value={/^\d+$/.test(odoNorm) ? fmtKm(odoNorm) : ''} ltr />
                      <SummaryRow icon={Barcode} label="VIN" value={normVin(newVehicle.vin)} ltr wrap />
                      <SummaryRow icon={Barcode} label="Engine no" value={newVehicle.engine_no} ltr />
                      <SummaryRow icon={Barcode} label="Unit code" value={newVehicle.fleet_code} ltr />
                    </>
                  ) : pickedVehicle ? (
                    <>
                      <SummaryRow icon={Barcode} label="Plate number" value={pickedVehicle.plate_number} ltr />
                      <SummaryRow icon={Barcode} label="Plate code" value={pickedVehicle.plate_code} ltr />
                      <SummaryRow icon={MapPin} label="Emirate" value={pickedVehicle.plate_emirate} />
                      <SummaryRow icon={Car} label="Vehicle" value={[pickedVehicle.year, pickedVehicle.make, pickedVehicle.model].filter(Boolean).join(' ')} />
                      <SummaryRow icon={Car} label="Colour" value={pickedVehicle.color} />
                      <SummaryRow icon={DashboardSpeed} label="Odometer" value={/^\d+$/.test(odoNorm) ? fmtKm(odoNorm) : ''} ltr />
                      <SummaryRow icon={DashboardSpeed} label="Last reading" value={lastKm != null ? fmtKm(lastKm) : ''} ltr />
                      <SummaryRow icon={Barcode} label="VIN" value={normVin(vinFix) || real(pickedVehicle.vin)} ltr wrap />
                      <SummaryRow icon={Barcode} label="Engine no" value={pickedVehicle.engine_no} ltr />
                      <SummaryRow icon={Barcode} label="Unit code" value={pickedVehicle.fleet_code} ltr />
                    </>
                  ) : (
                    <div style={st.emptyHint}>No vehicle selected yet.</div>
                  )}
                </div>

                {/* Who this car is being booked in for, so the context from
                    page 1 does not vanish the moment you leave it. */}
                <div style={{ ...st.blockLabel, marginTop: 18 }}>Customer</div>
                <div style={st.summaryCardQuiet}>
                  <div style={st.summaryName}>{custNameShown || '—'}</div>
                  <div style={st.summarySub}>
                    {[customerMode === 'existing' ? real(selectedCustomer?.code) : '', custPhoneShown ? <bdi key="p" dir="ltr">{custPhoneShown}</bdi> : '']
                      .filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}
                    {!custPhoneShown && !(customerMode === 'existing' && real(selectedCustomer?.code)) && (customerMode === 'new' ? 'New customer' : '—')}
                  </div>
                  <div style={{ ...st.summarySub, marginTop: 2 }}>{classLabel(jobClass, jobSub)}</div>
                </div>
              </div>
            </div>
          )}

          {/* ══ PAGE 3 — what is wrong with it ══ */}
          {step === 3 && (
            <div className="nwo-stack">
              <div className="nwo-grid2">
                <Field label="Request received via" required>
                  {!channelEditable ? (
                    // Set by the coordinator link / the API, not by a person.
                    <input style={{ ...st.input, background: '#f8fafc', color: '#64748b' }} readOnly
                      value={CHANNEL_LABELS[intakeChannel] || intakeChannel} />
                  ) : (
                    <select style={st.input} className={badCls('channel')} data-field="channel"
                      value={intakeChannel} onChange={e => setIntakeChannel(e.target.value)}>
                      {INTAKE_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Service category">
                  <select style={st.input} value={serviceCategory} onChange={e => setServiceCategory(e.target.value)}>
                    {SERVICE_CATEGORIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>
              <div className="nwo-grid2">
                <Field label="Job type">
                  <select style={st.input} value={workOrderType} onChange={e => setWorkOrderType(e.target.value)}>
                    {WORK_ORDER_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Customer complaint / work requested" required
                hint={`${description.length.toLocaleString('en-US')} / 5,000`}>
                <textarea style={{ ...st.input, minHeight: 96, resize: 'vertical' }} className={badCls('description')} data-field="description"
                  maxLength={5000} aria-invalid={bad('description') || undefined}
                  value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Car pulls to the left when braking; grinding noise from the front wheels." />
              </Field>
              <Field label="Notes for the technician" hint={`${specialInstructions.length.toLocaleString('en-US')} / 5,000`}>
                <textarea style={{ ...st.input, minHeight: 64, resize: 'vertical' }} className={badCls('notes')} data-field="notes"
                  maxLength={5000} value={specialInstructions} onChange={e => setSpecialInstructions(e.target.value)}
                  placeholder="Internal notes, parts to check, warranty details…" />
              </Field>
              {/*
               * Scheduled drop-off is not set from this flow — a job card is
               * created once the vehicle is at the workshop (bookings are the
               * Enquiries/appointments flow). scheduledAt is still loaded and
               * saved so a job card converted from a booking keeps its slot.
               */}
            </div>
          )}

          {/* ══ PAGE 4 — counter pricing ══ */}
          {step === 4 && (
            <div>
              {!counterAllowed ? (
                <div style={st.estimateNote}>
                  <InfoCircle width={18} height={18} style={{ color: '#2563eb', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontWeight: 800, color: NAVY, marginBottom: 4 }}>Priced on the estimate after inspection</div>
                    <div>
                      This is an external customer, so nothing is priced at the counter. After the technical
                      inspection the Storekeeper prices the parts (Genuine / After-Market) and the Service Advisor
                      prices the labour on the estimate (process step 4); a Supervisor or Workshop Manager approves
                      it before it goes to the customer (step 5).
                    </div>
                    {lines.some(l => l.touched) && (
                      <div style={{ marginTop: 6, color: '#b45309' }}>Lines entered earlier for an internal account are not used.</div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div style={st.sectionLabel}>Counter pricing <span style={st.optional}>(optional)</span></div>
                  <div style={st.blockHint}>
                    Routine internal jobs can be priced here. Leave it empty to raise the estimate after the technical
                    inspection instead (process step 4).
                  </div>
                  <div className="nwo-items-head" aria-hidden="true">
                    <span>Description</span>
                    <span>Type</span>
                    <span style={{ textAlign: 'center' }}>Qty</span>
                    <span className="nwo-num">Unit price ({currency})</span>
                    <span className="nwo-num">Amount</span>
                    <span />
                  </div>
                  {lines.map((l) => {
                    const k = `item-${l.key}`;
                    return (
                      <div key={l.key} className="nwo-item">
                        <div className="nwo-item-name">
                          <div className="nwo-item-cap">Description</div>
                          <input style={st.input} className={badCls(`${k}-name`)} data-field={`${k}-name`} maxLength={255}
                            aria-label="Line description" placeholder="Oil change · brake pads · labour…"
                            value={l.name} onChange={e => updateItem(l.key, 'name', e.target.value)} />
                        </div>
                        <div className="nwo-item-type">
                          <div className="nwo-item-cap">Type</div>
                          <select style={st.input} className={badCls(`${k}-type`)} data-field={`${k}-type`} aria-label="Line type"
                            value={l.item_type} onChange={e => updateItem(l.key, 'item_type', e.target.value)}>
                            <option value="">{l.id ? 'Not set' : 'Choose…'}</option>
                            {LINE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className="nwo-item-cap">Qty</div>
                          <input style={{ ...st.input, textAlign: 'center' }} className={badCls(`${k}-qty`)} data-field={`${k}-qty`}
                            aria-label="Quantity" inputMode="decimal" dir="ltr" maxLength={12}
                            value={l.quantity} onChange={e => updateItem(l.key, 'quantity', normNum(e.target.value))} />
                        </div>
                        <div>
                          <div className="nwo-item-cap">Unit price ({currency})</div>
                          <input style={{ ...st.input, textAlign: 'end' }} className={badCls(`${k}-price`)} data-field={`${k}-price`}
                            aria-label={`Unit price (${currency})`} inputMode="decimal" dir="ltr" maxLength={14} placeholder="0.00"
                            value={l.unit_price} onChange={e => updateItem(l.key, 'unit_price', normNum(e.target.value))} />
                        </div>
                        <div>
                          <div className="nwo-item-cap">Amount</div>
                          <div style={st.itemAmount}><bdi dir="ltr">{l.amount != null ? fmt(l.amount) : '—'}</bdi></div>
                        </div>
                        <button type="button" style={st.itemDel} onClick={() => removeItem(l.key)} aria-label="Remove line"><Trash width={15} height={15} /></button>
                      </div>
                    );
                  })}
                  <button type="button" style={st.linkBtn} onClick={addItem}><Plus width={15} height={15} /> Add line</button>

                  <div className="nwo-charges">
                    <Field label={`Extra labour / service fee (${currency})`}>
                      <input style={st.input} className={badCls('serviceFee')} data-field="serviceFee" inputMode="decimal" dir="ltr" maxLength={14}
                        placeholder="0.00" value={serviceFee} onChange={e => setServiceFee(normNum(e.target.value))} />
                    </Field>
                    <Field label={`Discount (${currency})`}>
                      <input style={st.input} className={badCls('discount')} data-field="discount" inputMode="decimal" dir="ltr" maxLength={14}
                        placeholder="0.00" value={discount} onChange={e => setDiscount(normNum(e.target.value))} />
                    </Field>
                    <Field label="Payment method">
                      <select style={st.input} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                        {PAYMENT_METHODS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                  </div>

                  <TotalsBox totals={totals} fmt={fmt} />
                  {grownPastApproval && (
                    <div style={{ ...st.openJobNote, marginTop: 12 }}>
                      <WarningCircle width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>The customer approved {fmt(editInfo.approvedTotal)}. The new total is higher — record the customer&apos;s approval of the extra work on the job card before it is done.</span>
                    </div>
                  )}
                </>
              )}
              {!counterAllowed && (
                <div style={{ maxWidth: 320, marginTop: 18 }}>
                  <Field label="Payment method">
                    <select style={st.input} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                      {PAYMENT_METHODS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>
          )}

          {/* ══ LAST PAGE — review, then open the job card ══ */}
          {step === 5 && (
            <div className="nwo-stack">
              {/* Assigning a technician is the Team Leader's, in process step 6,
                  after the inspection, the estimate and the customer's decision. */}
              <div style={{ maxWidth: 420 }}>
                <Field label="Service bay">
                  <select style={st.input} value={serviceBayId} onChange={e => setServiceBayId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {serviceBays.map(b => <option key={b.id} value={b.id}>{b.name || b.bay_name || `Bay ${b.id}`}</option>)}
                  </select>
                </Field>
              </div>

              <div style={st.reviewCard}>
                <ReviewRow icon={Building} label="Classification" value={classLabel(jobClass, jobSub) || '—'} />
                <ReviewRow icon={User} label="Customer"
                  value={<>{custNameShown || '—'}{custPhoneShown && <> · <bdi dir="ltr">{custPhoneShown}</bdi></>}{customerMode === 'new' && ' (new customer)'}</>} />
                <ReviewRow icon={Car} label="Vehicle" value={reviewVehicle ? <VehicleLine v={reviewVehicle} /> : '—'} />
                <ReviewRow icon={DashboardSpeed} label="Odometer" value={/^\d+$/.test(odoNorm) ? <bdi dir="ltr">{fmtKm(odoNorm)}</bdi> : '—'} />
                <ReviewRow icon={Antenna} label="Received via" value={CHANNEL_LABELS[intakeChannel] || intakeChannel} />
                <ReviewRow icon={Wrench} label="Service"
                  value={`${SERVICE_CATEGORIES.find(s => s.value === serviceCategory)?.label || serviceCategory} · ${WORK_ORDER_TYPES.find(w => w.value === workOrderType)?.label || workOrderType}`} />
                <ReviewRow icon={Notes} label="Reported issue" value={description.trim() || '—'} pre />
                {specialInstructions.trim() && <ReviewRow icon={Notes} label="Notes for the technician" value={specialInstructions.trim()} pre />}
                {scheduledAt && <ReviewRow icon={Calendar} label="Scheduled" value={new Date(scheduledAt).toLocaleString()} />}
                <ReviewRow icon={Coins} label="Pricing" value={counterAllowed
                  ? (hasCounterLines || totals.fee > 0
                    ? <div>
                        {pricedLines.map(l => (
                          <div key={l.key} style={st.reviewLine}>
                            <span>{l.name.trim()} <span style={{ color: '#94a3b8' }}>× <bdi dir="ltr">{l.q}</bdi>{l.item_type ? ` · ${LINE_TYPES.find(x => x.value === l.item_type)?.label}` : ''}</span></span>
                            <bdi dir="ltr">{fmt(l.amount)}</bdi>
                          </div>
                        ))}
                        <div style={{ marginTop: 6 }}><TotalsBox totals={totals} fmt={fmt} compact /></div>
                      </div>
                    : 'No counter pricing — the estimate is raised after the inspection.')
                  : 'Priced on the estimate after the technical inspection (process steps 4–5).'} />
                {counterAllowed && <ReviewRow icon={Cash} label="Payment method" value={PAYMENT_METHODS.find(p => p.value === paymentMethod)?.label || paymentMethod} />}
              </div>

              {approvalOffered && (
                <div style={{ maxWidth: 520 }}>
                  <Field label="Customer approval of these counter prices">
                    <select style={st.input} value={approvalChannel} onChange={e => setApprovalChannel(e.target.value)}>
                      {APPROVAL_OPTIONS.map(o => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                  <div style={st.fieldHint}>Work cannot start until the customer&apos;s approval is recorded.</div>
                </div>
              )}
              {grownPastApproval && (
                <div style={st.openJobNote}>
                  <WarningCircle width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>The total is now above the {fmt(editInfo.approvedTotal)} the customer approved — record their approval of the extra work on the job card.</span>
                </div>
              )}
              {!editMode && (
                <div style={st.processNote}>
                  {jobClass === 'internal'
                    ? t('orders.form.note_internal', 'Creating the job card notifies the Supervisor, Foreman and Team Leader; the technical inspection is next.')
                    : t('orders.form.note_external', 'Creating the work order records Steps 1–2. Next is the physical inspection with the customer: the main job card opens once they have acknowledged it (signed at the car, from the link or in the portal), and the Supervisor, Foreman and Team Leader are told then.')}
                  {' '}{t('orders.form.note_assign', 'The Team Leader assigns a technician later (process step 6).')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="nwo-footer">
          {step > 1
            ? <button type="button" style={st.ghostBtn} onClick={back}><NavArrowLeft width={16} height={16} className="nwo-flip" /> Back</button>
            : <button type="button" style={st.ghostBtn} onClick={requestClose}>Cancel</button>}
          <div className="nwo-footer-end">
            {step !== lastPage
              ? <button type="button" style={{ ...st.primaryBtn, opacity: loading && (editMode || presetCustomerId) ? 0.6 : 1 }}
                  disabled={loading && !!(editMode || presetCustomerId)} onClick={next}>
                  Next <NavArrowRight width={16} height={16} className="nwo-flip" />
                </button>
              : !closedJob && (
                <button type="button" style={{ ...st.primaryBtn, opacity: submitting ? 0.7 : 1 }} disabled={submitting} onClick={submit}>
                  {submitting ? (editMode ? 'Saving…' : 'Creating…') : (editMode ? 'Save changes' : jobClass === 'internal' ? 'Create job card' : 'Create work order')}
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* What identifies a set of lines for "did they change?": the server id and
 * the values the advisor can edit. */
function linesSig(list) {
  return JSON.stringify(list.filter(l => String(l.name || '').trim()).map(l => [
    l.id || null, String(l.name).trim(), l.item_type || '', Number(qtyVal(l.quantity)), Number(moneyVal(l.unit_price)), String(l.notes || '').trim(),
  ]));
}

/* The required subcategory for an existing external customer who has none. */
function ClassifyBlock({ value, onChange, invalid, t }) {
  return (
    <div style={st.classifyBox}>
      <div style={st.blockLabel}>Classify this customer <span style={st.req}>*</span></div>
      <div style={st.blockHint}>
        This customer has no subcategory yet. Choose one — it is saved onto the customer and recorded on this job card.
      </div>
      <PillGroup label="Customer subcategory" field="classifySub" invalid={invalid} value={value} onChange={onChange}
        options={[
          { v: 'fleet', label: t('orders.form.sub_fleet', 'Fleet'), Icon: Truck },
          { v: 'insurance', label: t('orders.form.sub_insurance', 'Insurance'), Icon: ShieldCheck },
          { v: 'walkin', label: t('orders.form.sub_walkin', 'Walk-in'), Icon: UserPlus },
        ]} />
    </div>
  );
}

/* Vehicles as cards rather than list rows: a plate, a model and a unit code
 * are three separate facts, and a single line of text makes the advisor read
 * all three to find the one they are scanning for. */
function VehicleCard({ v, on, onPick, readOnly, tabIndex }) {
  const noVin = !real(v.vin);
  return (
    <button type="button" role={readOnly ? undefined : 'radio'} aria-checked={readOnly ? undefined : !!on} disabled={readOnly} tabIndex={tabIndex}
      style={{ ...st.vehicleCard, ...(on ? st.vehicleCardOn : {}), ...(readOnly ? { cursor: 'default', maxWidth: 360 } : {}) }}
      onClick={onPick}>
      <div style={st.vehCardTop}>
        <Car width={16} height={16} style={{ color: on ? ORANGE : '#94a3b8', flexShrink: 0 }} />
        <span style={st.vehPlate}><bdi dir="ltr">{plateText(v) || 'No plate'}</bdi></span>
        {noVin && <span style={st.noVinBadge}>No VIN</span>}
      </div>
      <div style={st.vehName}>{[v.make, v.model].filter(Boolean).join(' ')}{v.year ? ` (${v.year})` : ''}</div>
      <div style={st.vehMeta}>
        {[v.fleet_code && `Unit ${v.fleet_code}`, v.color,
          v.mileage != null && v.mileage !== '' ? <bdi key="km" dir="ltr">{fmtKm(v.mileage)}</bdi> : null]
          .filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}
        {!v.fleet_code && !v.color && (v.mileage == null || v.mileage === '') && '—'}
      </div>
    </button>
  );
}

/* One line for the review: plate · code · emirate — year make model — VIN. */
function VehicleLine({ v }) {
  const plate = [plateText(v).toUpperCase(), v.plate_emirate].filter(Boolean).join(' · ');
  return (
    <span>
      {plate ? <bdi dir="ltr">{plate}</bdi> : 'No plate'}
      {' — '}{[v.year, v.make, v.model].filter(Boolean).join(' ') || '—'}
      {real(v.vin) && <> — VIN <bdi dir="ltr" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{real(v.vin)}</bdi></>}
      {v.isNew && <span style={{ color: '#2563eb', fontWeight: 700 }}> (new vehicle)</span>}
    </span>
  );
}

function TotalsBox({ totals, fmt, compact }) {
  return (
    <div style={compact ? st.totalsCompact : st.totalsBox}>
      <Row label="Parts & services" value={fmt(totals.itemsTotal)} />
      <Row label="Labour / service fee" value={fmt(totals.fee)} />
      <Row label="Discount" value={`- ${fmt(totals.disc)}`} />
      <Row label="Total excl. VAT" value={fmt(totals.taxable)} />
      <Row label={`VAT (${totals.rate}%)`} value={fmt(totals.vat)} />
      <div style={st.totalDivider} />
      <Row label="Total incl. VAT" value={fmt(totals.grand)} strong />
    </div>
  );
}

/**
 * The vehicle intake fields. Make and model are free text with the catalog
 * as suggestions: the workshop's own top fleet models (Hybrid Camry,
 * Attrage, JAC, Rosa, Canter…) were not in the dropdowns, and the only way
 * round it stored make = "Other". Make, model, plate and VIN are required —
 * VIN because a chassis number is captured while the car is in front of
 * someone.
 */
function VehicleFormFields({ newVehicle, setNewVehicle, badCls, bad }) {
  const set = (k, v) => setNewVehicle(prev => ({ ...prev, [k]: v }));
  const catalogMake = CAR_MAKES.find(m => m.toLowerCase() === newVehicle.make.trim().toLowerCase());
  const models = catalogMake ? CAR_CATALOG[catalogMake] || [] : [];
  return (
    <div className="nwo-stack">
      <div className="nwo-grid2">
        <Field label="Make" required>
          <input style={st.input} className={badCls('make')} data-field="make" list="nwo-makes" maxLength={100}
            autoComplete="off" aria-invalid={bad('make') || undefined} placeholder="Toyota, JAC, Exeed…"
            value={newVehicle.make} onChange={e => set('make', e.target.value)} />
          <datalist id="nwo-makes">
            {CAR_MAKES.filter(m => m !== 'Other').map(m => <option key={m} value={m} />)}
          </datalist>
        </Field>
        <Field label="Model" required>
          <input style={st.input} className={badCls('model')} data-field="model" list="nwo-models" maxLength={100}
            autoComplete="off" aria-invalid={bad('model') || undefined} placeholder="Hybrid Camry, Attrage…"
            value={newVehicle.model} onChange={e => set('model', e.target.value)} />
          <datalist id="nwo-models">
            {models.map(m => <option key={m} value={m} />)}
          </datalist>
        </Field>
      </div>
      <div className="nwo-grid2">
        <Field label="Plate number" required>
          <input style={{ ...st.input, textTransform: 'uppercase' }} className={badCls('plate')} data-field="plate" maxLength={50}
            dir="ltr" autoComplete="off" aria-invalid={bad('plate') || undefined}
            value={newVehicle.plate_number} onChange={e => set('plate_number', e.target.value)} placeholder="87345" />
        </Field>
        {/* Plate code and emirate are separate fields, not part of the
            number. "87345 / A / Abu Dhabi" is one plate, and squashing it
            into a single string is what makes plate search unreliable. */}
        <Field label="Plate code">
          <input style={{ ...st.input, textTransform: 'uppercase' }} maxLength={10} dir="ltr" autoComplete="off"
            value={newVehicle.plate_code} onChange={e => set('plate_code', e.target.value)} placeholder="A" />
        </Field>
      </div>
      <div className="nwo-grid2">
        <Field label="Emirate">
          <select style={st.input} value={newVehicle.plate_emirate} onChange={e => set('plate_emirate', e.target.value)}>
            <option value="">Select emirate…</option>
            {EMIRATES.map(em => <option key={em} value={em}>{em}</option>)}
          </select>
        </Field>
        <Field label="Year">
          <input style={st.input} className={badCls('year')} data-field="year" inputMode="numeric" dir="ltr" maxLength={4}
            value={newVehicle.year} onChange={e => set('year', toLatinDigits(e.target.value).replace(/\s/g, ''))} placeholder="2022" />
        </Field>
      </div>
      <div className="nwo-grid2">
        <Field label="VIN / chassis number" required
          hint={vinHint(newVehicle.vin)}>
          <input style={{ ...st.input, textTransform: 'uppercase' }} className={badCls('vin')} data-field="vin" maxLength={25}
            dir="ltr" autoComplete="off" aria-invalid={bad('vin') || undefined}
            value={newVehicle.vin} onChange={e => set('vin', normVin(e.target.value))} placeholder="JTNB11HK7N3024321" />
        </Field>
        <Field label="Engine number">
          <input style={st.input} maxLength={50} dir="ltr" autoComplete="off"
            value={newVehicle.engine_no} onChange={e => set('engine_no', e.target.value)} placeholder="A0C01177" />
        </Field>
      </div>
      {/* The fleet's own unit code — taxi code 5946 on the Aman sheet. It is
          what the fleet quotes down the phone, so it is worth storing even
          though it means nothing to us. */}
      <div className="nwo-grid2">
        <Field label="Fleet / unit code">
          <input style={st.input} maxLength={50} dir="ltr" autoComplete="off"
            value={newVehicle.fleet_code} onChange={e => set('fleet_code', e.target.value)} placeholder="5946" />
        </Field>
        <Field label="Colour">
          <input style={st.input} maxLength={50} value={newVehicle.color} onChange={e => set('color', e.target.value)} placeholder="White" />
        </Field>
      </div>
      <div className="nwo-grid2">
        <Field label="Fuel">
          <select style={st.input} value={newVehicle.fuel_type} onChange={e => set('fuel_type', e.target.value)}>
            {FUEL_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Transmission">
          <select style={st.input} value={newVehicle.transmission} onChange={e => set('transmission', e.target.value)}>
            <option value="automatic">Automatic</option>
            <option value="manual">Manual</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <label style={st.field}>
      <span style={st.fieldLabel}>{label}{required && <span style={st.req} aria-hidden="true"> *</span>}</span>
      {children}
      {hint && <span style={st.fieldHint}>{hint}</span>}
    </label>
  );
}
function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 13.5, fontWeight: strong ? 800 : 500, color: strong ? NAVY : '#475569' }}>
      <span>{label}</span><bdi dir="ltr">{value}</bdi>
    </div>
  );
}
function ReviewRow({ icon: Icon, label, value, strong, pre }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
      <Icon width={18} height={18} style={{ color: ORANGE, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 14, color: strong ? NAVY : '#1e293b', fontWeight: strong ? 800 : 500, overflowWrap: 'anywhere', ...(pre ? { whiteSpace: 'pre-wrap' } : {}) }}>{value}</div>
      </div>
    </div>
  );
}

const st = {
  pageMain: { minWidth: 0 },

  /* Taller than the old list now that the customer step has a page of its
   * own — the search box and eight results fit without scrolling. */
  custListTall: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain', padding: 2 },

  vehicleCard: {
    textAlign: 'start', padding: '12px 14px', borderRadius: 12,
    borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0',
    background: '#fff', cursor: 'pointer', minWidth: 0, color: 'inherit', fontFamily: 'inherit',
  },
  vehicleCardOn: { borderColor: ORANGE, background: '#fff7ed', borderWidth: 2, padding: '11px 13px' },
  vehCardTop: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, minWidth: 0 },
  vehPlate: {
    fontSize: 15, fontWeight: 800, color: NAVY, letterSpacing: '-.01em',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  vehName: { fontSize: 13, fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  vehMeta: { fontSize: 11.5, color: '#94a3b8', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  /* The odometer is one number and the single most mistyped field on the
   * form, so it gets a large input rather than a normal-sized one in a
   * two-column row. */
  mileageRow: { display: 'flex', alignItems: 'center', gap: 10, maxWidth: 280 },
  mileageInput: {
    borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 10,
    padding: '12px 14px', fontSize: 19, fontWeight: 700, letterSpacing: '.02em',
    color: NAVY, background: '#fff', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  },
  mileageUnit: { fontSize: 14, fontWeight: 700, color: '#94a3b8', flexShrink: 0 },
  odoWarn: {
    display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 10, maxWidth: 560, cursor: 'pointer',
    padding: '10px 12px', borderRadius: 10, background: '#fffbeb', border: '1.5px solid #fcd34d',
    color: '#92400e', fontSize: 12.5, lineHeight: 1.45, fontWeight: 500,
  },

  summaryCardQuiet: {
    borderStyle: 'solid', borderWidth: 1, borderColor: '#e8eef5', borderRadius: 12,
    padding: '12px 15px', background: '#fff',
  },

  blockLabel: { fontSize: 14.5, fontWeight: 800, color: NAVY, marginBottom: 2, marginTop: 4 },
  blockHint: { fontSize: 12.5, color: '#64748b', marginBottom: 10, lineHeight: 1.45 },
  req: { color: '#dc2626', fontWeight: 800 },
  optional: { color: '#94a3b8', fontWeight: 600, textTransform: 'none', letterSpacing: 0 },

  choiceCard: {
    display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'start',
    padding: '14px 15px', borderRadius: 12,
    borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0',
    background: '#fff', cursor: 'pointer', width: '100%', minWidth: 0, fontFamily: 'inherit',
  },
  choiceCardOn: { borderColor: ORANGE, background: '#fff7ed', borderWidth: 2, padding: '13px 14px' },
  choiceIcon: {
    width: 38, height: 38, borderRadius: 10, background: '#f1f5f9', color: '#64748b',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  choiceIconOn: { background: '#ffedd5', color: ORANGE },
  choiceTitle: { fontSize: 14.5, fontWeight: 700, marginBottom: 3 },
  choiceDesc: { fontSize: 12, color: '#64748b', lineHeight: 1.4 },
  radio: {
    width: 20, height: 20, borderRadius: '50%',
    borderStyle: 'solid', borderWidth: 1.5, borderColor: '#cbd5e1',
    flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', marginTop: 2,
  },
  radioOn: { background: ORANGE, borderColor: ORANGE },

  pill: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px',
    borderRadius: 11, borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0',
    background: '#fff', color: NAVY, cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
    flex: '1 1 0', minWidth: 104, justifyContent: 'center', fontFamily: 'inherit',
  },
  pillOn: { borderColor: ORANGE, background: '#fff7ed', color: ORANGE, borderWidth: 2, padding: '10px 15px' },

  classifyBox: { marginTop: 16, padding: '12px 14px 2px', borderRadius: 12, background: '#fffbeb', border: '1.5px solid #fde68a' },
  inlineForm: { marginTop: 12, padding: '12px 14px 14px', borderRadius: 12, background: '#f8fafc', border: '1.5px solid #e2e8f0' },

  summaryCard: {
    borderStyle: 'solid', borderWidth: 1, borderColor: '#e8eef5',
    borderRadius: 12, padding: '14px 15px', background: '#fbfdff',
  },
  avatarRow: { display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 12, marginBottom: 10, borderBottom: '1px solid #e8eef5' },
  avatar: {
    width: 42, height: 42, borderRadius: '50%', background: ORANGE, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18, fontWeight: 800, flexShrink: 0,
  },
  summaryName: { fontSize: 14, fontWeight: 700, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  summarySub: { fontSize: 12, color: '#94a3b8' },
  sumRow: { display: 'flex', alignItems: 'flex-start', gap: 9, padding: '5px 0', fontSize: 12.5, minWidth: 0 },
  sumLabel: { color: '#94a3b8', width: 92, flexShrink: 0, whiteSpace: 'nowrap' },
  sumValue: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  sumValueWrap: { whiteSpace: 'normal', overflowWrap: 'anywhere', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },

  noVinBadge: {
    marginInlineStart: 8, fontSize: 9.5, fontWeight: 800, letterSpacing: '.04em',
    color: '#b45309', background: '#fdf4e5', border: '1px solid #f3d9a8',
    borderRadius: 999, padding: '2px 7px', verticalAlign: 1, whiteSpace: 'nowrap',
  },
  inactiveBadge: { color: '#991b1b', fontWeight: 700, fontSize: 11.5 },
  vinPrompt: {
    marginTop: 12, padding: '12px 14px', borderRadius: 11,
    background: '#fdf4e5', borderStyle: 'solid', borderWidth: 1.5, borderColor: '#f3d9a8',
  },
  vinPromptTitle: { fontSize: 13, fontWeight: 700, color: '#92400e' },
  vinPromptBody: { fontSize: 12, color: '#a16207', marginTop: 4, lineHeight: 1.45 },
  softWarn: { fontSize: 12, color: '#b45309', marginTop: 6 },
  lockNote: {
    display: 'flex', gap: 8, alignItems: 'flex-start', margin: '4px 0 12px', padding: '10px 12px',
    borderRadius: 10, background: '#f1f5f9', color: '#334155', fontSize: 13, lineHeight: 1.45,
  },
  openJobNote: {
    display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, padding: '10px 12px',
    borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12.5, lineHeight: 1.45,
  },
  estimateNote: {
    display: 'flex', gap: 10, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 12,
    background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', fontSize: 13, lineHeight: 1.55,
  },
  processNote: { fontSize: 12.5, color: '#64748b', lineHeight: 1.5 },
  sectionLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: NAVY, fontWeight: 800, marginBottom: 4 },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '0 12px', marginBottom: 10, background: '#fff' },
  searchInput: { border: 'none', padding: '10px 0', fontSize: 14, width: '100%', background: 'transparent', minWidth: 0, fontFamily: 'inherit', color: '#1e293b' },
  custItem: { textAlign: 'start', borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 10, padding: '9px 12px', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' },
  custItemOn: { borderColor: ORANGE, background: '#fff7ed' },
  custName: { fontSize: 14, fontWeight: 700, color: '#1e293b' },
  custMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  emptyHint: { fontSize: 13, color: '#94a3b8', padding: '12px 0', lineHeight: 1.5 },
  moreHint: { fontSize: 12, color: '#64748b', padding: '6px 2px', lineHeight: 1.45 },
  moreRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 8 },
  pickedHidden: { marginTop: 8, fontSize: 12.5, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '7px 10px' },
  dupWarning: { background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  dupWarningTitle: { fontSize: 12.5, fontWeight: 700, color: '#9a3412' },
  dupMatchBtn: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', textAlign: 'start', border: '1px solid #fed7aa', borderRadius: 8, padding: '7px 10px', background: '#fff', cursor: 'pointer', fontSize: 12.5, color: '#1e293b', fontFamily: 'inherit' },
  dupMatchUse: { color: ORANGE, fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap' },
  addVehicleBtn: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, border: '1.5px dashed #cbd5e1', background: '#f8fafc', color: NAVY, borderRadius: 10, padding: '9px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, width: '100%', justifyContent: 'center' },
  field: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
  fieldLabel: { fontSize: 12, fontWeight: 700, color: '#475569' },
  fieldHint: { fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 },
  input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#1e293b', background: '#fff', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', minWidth: 0 },
  linkBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: ORANGE, cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '8px 0', marginTop: 4 },
  itemAmount: { textAlign: 'end', fontSize: 13.5, fontWeight: 700, color: '#1e293b', padding: '10px 0', whiteSpace: 'nowrap' },
  itemDel: { width: 34, height: 34, borderRadius: 8, border: 'none', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'center' },
  totalsBox: { marginTop: 18, background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 12, padding: '12px 16px', maxWidth: 460, marginInlineStart: 'auto' },
  totalsCompact: { background: '#f8fafc', borderRadius: 10, padding: '6px 12px' },
  totalDivider: { height: 1, background: '#e2e8f0', margin: '6px 0' },
  reviewCard: { border: '1px solid #eef2f7', borderRadius: 12, padding: '4px 16px', background: '#fff' },
  reviewLine: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, padding: '2px 0' },
  ghostBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  ghostBtnSm: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 22px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${ORANGE},#ea580c)`, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700, boxShadow: '0 4px 14px rgba(249,115,22,0.3)' },
  primaryBtnSm: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, border: 'none', background: ORANGE, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 },
};
