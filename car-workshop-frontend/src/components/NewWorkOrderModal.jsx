import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Xmark, User, UserPlus, Car, Wrench, ClipboardCheck, Plus, Trash, Search,
  Calendar, Timer, NavArrowLeft, NavArrowRight, Check,
  Building, Truck, ShieldCheck, Box, Barcode, Phone, Mail, MapPin,
  DashboardSpeed, WarningCircle,
} from 'iconoir-react';
import api from '../lib/api';
import { CAR_CATALOG, CAR_MAKES } from '../lib/carCatalog';

/**
 * NewWorkOrderModal — car-workshop "job card" creation flow.
 *
 * Replaces the old delivery wizard (sender/recipient/packages/stops).
 * Steps: Customer & Vehicle → Complaint & Services → Estimate items & charges
 *        → Assign technician/bay & review.  Posts to POST /work-orders and,
 * if a technician is chosen, POST /work-orders/:id/assign.
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
  { value: 'credit',  label: 'Credit' },
  { value: 'wallet',  label: 'Wallet' },
];

const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'lpg'];

/* Five steps, not four.
 *
 * Customer and Vehicle used to share step 1, which meant two columns of
 * fields plus a summary rail in an 860px modal — every control squeezed to
 * about 180px wide, and the plate/VIN section scrolled out of sight while
 * you were still typing the customer's name. They are two distinct pieces
 * of work and each now gets the width of the page.
 *
 * The complaint went back to step 3 where it belongs, rather than being
 * shown on step 1 and step 3 bound to the same value. */
const STEPS = [
  { n: 1, title: 'Customer', icon: User },
  { n: 2, title: 'Vehicle', icon: Car },
  { n: 3, title: 'Complaint & Service', icon: Wrench },
  { n: 4, title: 'Estimate & Charges', icon: ClipboardCheck },
  { n: 5, title: 'Assign & Review', icon: Check },
];

const ORANGE = '#f97316';
const NAVY = '#1e3a6b';

const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];

const EMPTY_VEHICLE = {
  make: '', model: '', year: '', plate_number: '', plate_code: '', plate_emirate: '',
  vin: '', engine_no: '', fleet_code: '', color: '', mileage: '',
  fuel_type: 'petrol', transmission: 'automatic',
};

/* Title-case a subcategory for display — the enum is lower-case in the
 * database and "fleet" in a summary panel reads like a typo. */
const cap = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : '');

/* Several imported fleet accounts carry "-" or "N/A" in place of a phone
 * number. Rendered literally that reads as a broken field ("FLT-001 · -"),
 * so a value that is only punctuation is treated as absent. */
const real = (v) => {
  const s = String(v ?? '').trim();
  return s && !/^[-–—.\s]*$/.test(s) && s.toUpperCase() !== 'N/A' ? s : '';
};

/* The big selectable card used for Internal/External and Existing/Walk-in. */
function ChoiceCard({ icon: Icon, title, desc, selected, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ ...st.choiceCard, ...(selected ? st.choiceCardOn : {}) }}>
      <div style={{ ...st.choiceIcon, ...(selected ? st.choiceIconOn : {}) }}>
        <Icon width={21} height={21} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...st.choiceTitle, color: selected ? ORANGE : NAVY }}>{title}</div>
        <div style={st.choiceDesc}>{desc}</div>
      </div>
      <div style={{ ...st.radio, ...(selected ? st.radioOn : {}) }}>
        {selected && <Check width={13} height={13} strokeWidth={3} />}
      </div>
    </button>
  );
}

/* One line of the summary panel. Renders an em dash rather than collapsing
 * when the value is empty: a missing email should read as "no email on
 * file", not silently shorten the card so the layout jumps as fields fill. */
function SummaryRow({ icon: Icon, label, value }) {
  return (
    <div style={st.sumRow}>
      <Icon width={15} height={15} style={{ color: '#94a3b8', flexShrink: 0 }} />
      <span style={st.sumLabel}>{label}</span>
      <span style={{ ...st.sumValue, color: value ? NAVY : '#cbd5e1' }}>{value || '—'}</span>
    </div>
  );
}
const EMPTY_ITEM = { name: '', quantity: 1, unit_price: '', notes: '' };

export default function NewWorkOrderModal({ open, presetCustomerId = null, onClose, onCreated, onUpdated, editOrder = null, currency = 'AED' }) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // The page layout is a 1fr + 290px grid, which stops making sense once the
  // modal itself is under about 900px — the fields column ends up narrower
  // than the summary beside it. Inline styles cannot carry a media query, so
  // the breakpoint is measured instead. Below it the summary drops under the
  // fields rather than fighting them for width.
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 900);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const pageWrap = narrow ? st.pageWrapStacked : st.pageWrap;

  // reference data
  const [customers, setCustomers] = useState([]);
  const [serviceBays, setServiceBays] = useState([]);
  const [mechanics, setMechanics] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);

  // step 1 — customer & vehicle
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');

  // ── Step 1 classification (process change, 15 Sep 2026) ──
  // The job card now starts by saying what kind of customer this is, before
  // a single name is shown:
  //
  //   Internal  →  Fleet | Insurance | Asset  → pick from the account list
  //   External  →  Existing | Walk-in         → pick, or key in on the spot
  //
  // Defaults to external/existing because 3,465 of the 3,472 accounts on
  // file are external, so that is the path the front desk is on nearly all
  // day — and it is also the behaviour this screen had before, so nobody
  // has to relearn the common case.
  const [customerClass, setCustomerClass] = useState('external');
  const [internalSub, setInternalSub] = useState('');
  const [externalOpt, setExternalOpt] = useState('existing');

  // Derived, not stored. The old code kept `customerMode` as its own state,
  // which would now be a second source of truth for something the two
  // pickers above already decide — and the two would drift the first time
  // one was set without the other.
  const customerMode = (customerClass === 'external' && externalOpt === 'walkin') ? 'new' : 'existing';

  // Mileage at THIS visit, which is not the same as the vehicle's stored
  // mileage: that one is only ever "last known reading". Mandatory.
  const [odometerIn, setOdometerIn] = useState('');

  // A VIN typed in for an existing vehicle that has none on file. 96% of
  // vehicles are in that state, so blocking them outright would make the
  // new rule unusable — instead the wizard asks, and saves it back onto the
  // vehicle record on submit. That is how the gap actually gets closed:
  // one car at a time, as each one comes in.
  const [vinFix, setVinFix] = useState('');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ ...EMPTY_VEHICLE });
  // Plate/VIN search over the customer's own vehicle list — most customers
  // only have one or two on file, but a fleet account can have dozens, and
  // scrolling to find one by eye is exactly the kind of thing a search box
  // exists to avoid.
  const [vehicleSearch, setVehicleSearch] = useState('');

  // step 2 — complaint & service
  const [workOrderType, setWorkOrderType] = useState('standard');
  const [serviceCategory, setServiceCategory] = useState('general_maintenance');
  const [description, setDescription] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  // step 3 — estimate items & charges
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [serviceFee, setServiceFee] = useState('');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');

  // step 4 — assignment
  const [serviceBayId, setServiceBayId] = useState('');
  const [mechanicId, setMechanicId] = useState('');

  const resetAll = useCallback(() => {
    setStep(1); setSubmitting(false); setError('');
    setCustomerId(''); setCustomerSearch('');
    setCustomerClass('external'); setInternalSub(''); setExternalOpt('existing');
    setOdometerIn(''); setVinFix('');
    setSelectedCustomer(null); setCustomers([]); setDupMatches([]);
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
    setVehicleId(''); setAddingVehicle(false); setNewVehicle({ ...EMPTY_VEHICLE }); setVehicleSearch('');
    setWorkOrderType('standard'); setServiceCategory('general_maintenance');
    setDescription(''); setSpecialInstructions(''); setScheduledAt('');
    setItems([{ ...EMPTY_ITEM }]); setServiceFee(''); setDiscount(''); setPaymentMethod('cash');
    setServiceBayId(''); setMechanicId('');
  }, []);

  // Load reference data when the modal opens
  useEffect(() => {
    if (!open) return;
    resetAll();
    (async () => {
      try {
        // Customers are no longer bulk-loaded (that capped the list at 500
        // and made anyone past that alphabetically unreachable — see
        // filteredCustomers' old client-side .slice(0,50)). The "Existing
        // customer" panel now searches the server directly, the same way
        // CustomerPicker.jsx does, and that search reaches every customer
        // plus their vehicles' plate/VIN (routes/customers.js).
        const [bRes, mRes] = await Promise.all([
          api.get('/service-bays'),
          api.get('/mechanics?limit=500'),
        ]);
        if (bRes.success) setServiceBays(bRes.data || []);
        if (mRes.success) setMechanics(mRes.data || []);

        if (editOrder) {
          // Edit mode — populate all fields from the existing work order.
          // A pre-existing order with no customer_id (created back when
          // Walk-in was its own mode) still needs somewhere to land — 'new'
          // is the closest fit (same free-text fields), but submit() below
          // must not re-create a customer just because such an order was
          // opened and saved again; see the `!editOrder` guard there.
          const noCustomerOnFile = !editOrder.customer_id;
          setCustomerClass('external');
          setExternalOpt(noCustomerOnFile ? 'walkin' : 'existing');
          setOdometerIn(editOrder.odometer_in != null ? String(editOrder.odometer_in) : '');
          if (!noCustomerOnFile) {
            setCustomerId(String(editOrder.customer_id));
            api.get(`/customers/${editOrder.customer_id}`)
              .then(r => {
                if (!r.success) return;
                setSelectedCustomer(r.data);
                // Land the classification pickers on whatever this customer
                // actually is, so reopening an internal fleet job card does
                // not silently present it as an external walk-in.
                if (r.data?.customer_class === 'internal') {
                  setCustomerClass('internal');
                  setInternalSub(r.data.customer_subcategory || '');
                }
              })
              .catch(() => {});
          } else {
            setCustomerName(editOrder.customer_name || '');
            setCustomerPhone(editOrder.customer_phone || '');
            setCustomerEmail(editOrder.customer_email || '');
          }
          setVehicleId(editOrder.vehicle_id ? String(editOrder.vehicle_id) : '');
          setWorkOrderType(editOrder.work_order_type || 'standard');
          setServiceCategory(editOrder.service_category || 'general_maintenance');
          setDescription(editOrder.description || '');
          setSpecialInstructions(editOrder.special_instructions || '');
          setScheduledAt(editOrder.scheduled_at ? editOrder.scheduled_at.slice(0, 16) : '');
          setServiceFee(editOrder.service_fee != null && editOrder.service_fee !== '' ? String(editOrder.service_fee) : '');
          setDiscount(editOrder.discount != null && editOrder.discount !== '' ? String(editOrder.discount) : '');
          setPaymentMethod(editOrder.payment_method || 'cash');
          setServiceBayId(editOrder.service_bay_id ? String(editOrder.service_bay_id) : '');
          setMechanicId(editOrder.mechanic_id ? String(editOrder.mechanic_id) : '');
          // Fetch existing line items
          try {
            const iRes = await api.get(`/work-orders/${editOrder.id}/items`);
            if (iRes.success && iRes.data?.length > 0) {
              setItems(iRes.data.map(it => ({
                name: it.name || '',
                quantity: String(it.quantity ?? 1),
                unit_price: it.unit_price != null ? String(it.unit_price) : '',
                notes: it.notes || '',
              })));
            }
          } catch {}
        } else if (presetCustomerId) {
          setCustomerId(String(presetCustomerId));
          api.get(`/customers/${presetCustomerId}`)
            .then(r => { if (r.success) setSelectedCustomer(r.data); })
            .catch(() => {});
        }
      } catch (e) { console.error(e); }
    })();
  }, [open, presetCustomerId, editOrder, resetAll]);

  // Load vehicles whenever a real customer is selected
  useEffect(() => {
    if (!customerId) { setVehicles([]); setVehicleId(''); return; }
    let cancelled = false;
    setVehiclesLoading(true);
    api.get(`/vehicles?customer_id=${customerId}&limit=100`)
      .then(res => { if (!cancelled && res.success) setVehicles(res.data || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setVehiclesLoading(false); });
    return () => { cancelled = true; };
  }, [customerId]);

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customersLoading, setCustomersLoading] = useState(false);

  // Server-side search for the "Existing customer" panel — reaches every
  // customer (not capped at 500) and, since routes/customers.js also checks
  // each customer's vehicles, matches by plate number or VIN too: the front
  // desk often has the car in front of them before they have a name.
  useEffect(() => {
    if (!open || customerMode !== 'existing') return;
    // Internal accounts are only listed once a subcategory is chosen. The
    // list is otherwise meaningless — "every internal account" is three
    // different ledgers mixed together — and an empty panel with a prompt
    // is clearer than the wrong names.
    if (customerClass === 'internal' && !internalSub) { setCustomers([]); return; }

    let cancelled = false;
    setCustomersLoading(true);
    const id = setTimeout(() => {
      const q = customerSearch.trim();
      const params = new URLSearchParams({ limit: '50', active_only: '1', customer_class: customerClass });
      // External deliberately does NOT constrain the subcategory. Most
      // external accounts have none set, and filtering on one would hide
      // nearly every customer the front desk needs.
      if (customerClass === 'internal') params.set('customer_subcategory', internalSub);
      if (q) params.set('search', q);
      api.get(`/customers?${params.toString()}`)
        .then(res => { if (!cancelled && res.success) setCustomers(res.data || []); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setCustomersLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [open, customerMode, customerSearch, customerClass, internalSub]);

  // "New customer" duplicate check — the same search, keyed on the phone
  // being typed. Every job through this mode creates a real customer
  // record, so before doing that it is worth one lookup to check the
  // person isn't already on file under a slightly different name.
  const [dupMatches, setDupMatches] = useState([]);
  useEffect(() => {
    if (!open || customerMode !== 'new') { setDupMatches([]); return; }
    const q = customerPhone.trim();
    if (q.length < 6) { setDupMatches([]); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      api.get(`/customers?limit=3&search=${encodeURIComponent(q)}`)
        .then(res => { if (!cancelled && res.success) setDupMatches(res.data || []); })
        .catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(id); };
  }, [open, customerMode, customerPhone]);

  function useExistingInstead(c) {
    // Follow the matched customer's own classification rather than assuming
    // external: the duplicate found could well be a fleet account someone
    // started keying in by hand.
    if (c.customer_class === 'internal') {
      setCustomerClass('internal');
      setInternalSub(c.customer_subcategory || '');
    } else {
      setCustomerClass('external');
      setExternalOpt('existing');
    }
    setCustomerId(String(c.id));
    setSelectedCustomer(c);
    // Re-point the Existing-customer search at this same match, so the list
    // that renders right after switching tabs shows the picked customer
    // highlighted rather than whatever unrelated search was last typed
    // there (or an empty box before anyone had searched at all).
    setCustomerSearch(c.phone || c.full_name || '');
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
    setDupMatches([]);
  }

  // Plate numbers get typed with and without the space ("A 12345" vs
  // "A12345"), so match against both the raw and the alphanumeric-only form
  // rather than making the user guess which one the record has.
  const filteredVehicles = useMemo(() => {
    const raw = vehicleSearch.trim().toLowerCase();
    if (!raw) return vehicles;
    const stripped = raw.replace(/[^a-z0-9]/g, '');
    return vehicles.filter(v => {
      const plate = (v.plate_number || '').toLowerCase();
      const vin = (v.vin || '').toLowerCase();
      return plate.includes(raw) || vin.includes(raw)
        || (stripped && (plate.replace(/[^a-z0-9]/g, '').includes(stripped)
                      || vin.replace(/[^a-z0-9]/g, '').includes(stripped)));
    });
  }, [vehicles, vehicleSearch]);

  const selectedVehicle = useMemo(
    () => vehicles.find(v => String(v.id) === String(vehicleId)) || null,
    [vehicles, vehicleId]
  );
  const selectedVehicleNeedsVin = !!selectedVehicle && !String(selectedVehicle.vin || '').trim();

  // Prefill the mileage box with the vehicle's last known reading. It is
  // still the advisor's job to correct it to what the odometer actually
  // says — but starting from 69,300 and changing three digits beats
  // typing it from nothing, and a blank box is what makes people guess.
  useEffect(() => {
    if (selectedVehicle && !odometerIn && selectedVehicle.mileage != null) {
      setOdometerIn(String(selectedVehicle.mileage));
    }
  }, [selectedVehicle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear a VIN typed for one vehicle when a different one is picked, or it
  // would be saved onto the wrong car.
  useEffect(() => { setVinFix(''); }, [vehicleId]);

  // Drop a validation message as soon as the thing it complained about is
  // touched. Without this the banner survives until the next Next click, so
  // a corrected mileage still reads "Mileage looks wrong" — the screen
  // contradicting itself, which is worse than no message at all.
  useEffect(() => {
    if (error) setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerClass, internalSub, externalOpt, customerId, vehicleId,
      customerName, customerPhone, odometerIn, description, vinFix,
      newVehicle.make, newVehicle.model, newVehicle.plate_number, newVehicle.vin]);

  const totals = useMemo(() => {
    const itemsTotal = items.reduce((sum, it) => sum + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0);
    const fee = parseFloat(serviceFee) || 0;
    const disc = parseFloat(discount) || 0;
    const grand = Math.max(0, itemsTotal + fee - disc);
    return { itemsTotal, fee, disc, grand };
  }, [items, serviceFee, discount]);

  const fmt = (n) => `${currency} ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  /* ── item helpers ── */
  const updateItem = (idx, field, value) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));

  /* ── validation ── */
  const validateStep = (s) => {
    /* ── 1. Who the customer is ── */
    if (s === 1) {
      if (customerClass === 'internal' && !internalSub) {
        return 'Choose the internal subcategory — Fleet, Insurance or Asset.';
      }
      if (customerMode !== 'existing') {
        if (!customerName.trim()) return 'Enter the customer name.';
        if (!customerPhone.trim()) return 'Enter the customer phone.';
      } else {
        if (!customerId) return 'Select a customer, or add a new one.';
      }
    }

    /* ── 2. Which car, and what the odometer reads ── */
    if (s === 2) {
      // Walk-in requires a vehicle outright, which it did not before. A
      // person standing at the counter has arrived in a car, and the whole
      // point of the mandatory VIN is that it is captured while that car is
      // in front of someone.
      const enteringVehicle = addingVehicle || customerMode === 'new';
      if (enteringVehicle) {
        if (!newVehicle.make.trim() || !newVehicle.model.trim()) return 'Vehicle make and model are required.';
        if (!newVehicle.plate_number.trim()) return 'Plate number is required.';
        if (!newVehicle.vin.trim()) return 'VIN / chassis number is required.';
      } else if (customerId) {
        if (!vehicleId) return 'Select the vehicle, or add a new one.';
        // An existing vehicle with no VIN on file: the wizard asks for it
        // here rather than refusing the job card, and writes it back onto
        // the vehicle at submit.
        if (selectedVehicleNeedsVin && !vinFix.trim()) {
          return 'This vehicle has no VIN on file. Enter it to continue.';
        }
      }

      const odo = odometerIn.trim();
      if (!odo) return 'Mileage (odometer reading) is required.';
      if (!/^\d+$/.test(odo)) return 'Mileage must be a whole number of kilometres.';
      if (Number(odo) > 9999999) return 'Mileage looks wrong — check the reading.';
    }

    /* ── 3. What is wrong with it ── */
    if (s === 3) {
      if (!description.trim()) return 'Describe the customer complaint or the work requested.';
    }

    /* ── 4. Money ── */
    if (s === 4) {
      const bad = items.some(it => it.name.trim() && (parseFloat(it.unit_price) < 0 || parseFloat(it.quantity) < 0));
      if (bad) return 'Item quantity and price cannot be negative.';
    }
    return '';
  };

  const next = () => {
    const msg = validateStep(step);
    if (msg) { setError(msg); return; }
    setError('');
    setStep(s => Math.min(s + 1, STEPS.length));
  };
  const back = () => { setError(''); setStep(s => Math.max(s - 1, 1)); };

  /* ── submit ── */
  const submit = async () => {
    // Every step except the last, which is review-only and has nothing of
    // its own to check. Jumps back to whichever step actually failed.
    for (let s = 1; s < STEPS.length; s++) { const m = validateStep(s); if (m) { setError(m); setStep(s); return; } }
    setSubmitting(true); setError('');
    try {
      let vId = vehicleId || null;
      let finalCustomerId = customerMode === 'existing' ? (customerId ? Number(customerId) : null) : null;
      const finalCustomerName = customerMode === 'existing' ? (selectedCustomer?.full_name || '') : customerName.trim();
      const finalCustomerPhone = customerMode === 'existing' ? (selectedCustomer?.phone || '') : customerPhone.trim();
      const finalCustomerEmail = customerMode === 'existing' ? (selectedCustomer?.email || '') : customerEmail.trim();

      // "New customer" creates a customers row so they show up in the
      // Customers list afterward. Only on actual creation, never on an
      // edit-save — an old order with no customer on file lands in this
      // mode too (see the load effect above), and re-saving it must not
      // spawn a fresh duplicate customer every time someone opens and
      // saves the same job card.
      if (customerMode === 'new' && !editOrder) {
        const custRes = await api.post('/customers', {
          full_name: finalCustomerName, phone: finalCustomerPhone, email: finalCustomerEmail || undefined,
          // Reaching this branch means External → Walk-in was chosen, which
          // is exactly what 'walkin' records. Sent explicitly rather than
          // left to the server default, so the intent is in the request
          // rather than inferred from its absence.
          customer_class: 'external',
          customer_subcategory: 'walkin',
        });
        if (!custRes.success) { setError(custRes.message || 'Could not create the customer.'); setSubmitting(false); return; }
        finalCustomerId = custRes.data?.id || null;
      }

      // Create a new vehicle if the user filled one in — for an existing
      // customer picking "Add a new vehicle", or for a brand-new customer
      // (their vehicle form has no separate toggle: everything they enter
      // there is necessarily new). Both need a real customer_id, which a
      // brand-new customer only has after the block just above.
      const wantsVehicle = customerMode === 'existing'
        ? (addingVehicle && customerId)
        : (customerMode === 'new' && !editOrder && newVehicle.make.trim() && newVehicle.model.trim());
      if (wantsVehicle) {
        const vRes = await api.post('/vehicles', {
          customer_id: Number(customerMode === 'existing' ? customerId : finalCustomerId),
          ...newVehicle, year: newVehicle.year || null,
          // The vehicle's stored mileage is the visit reading — this is the
          // first thing we know about the car, so it is also the last thing
          // we know about it.
          mileage: odometerIn.trim() || newVehicle.mileage || null,
        });
        if (!vRes.success) {
          // A duplicate VIN is the one failure worth pointing somewhere
          // useful: the car is already on file, so the fix is to pick it
          // rather than to edit what was typed.
          setError(vRes.code === 'VIN_DUPLICATE'
            ? `${vRes.message} Go back and choose that vehicle instead of adding a second record.`
            : (vRes.message || 'Could not save the vehicle.'));
          setSubmitting(false); setStep(1); return;
        }
        vId = vRes.data?.id || null;
      }

      // Backfill a VIN onto an existing vehicle that had none. Done before
      // the job card is created, because the create endpoint refuses a
      // vehicle with no VIN — so this has to succeed first or the whole
      // thing fails with a confusing message about a field the advisor has
      // just filled in.
      if (vId && selectedVehicleNeedsVin && vinFix.trim()) {
        const fixRes = await api.put(`/vehicles/${vId}`, { vin: vinFix.trim() });
        if (!fixRes.success) {
          setError(fixRes.code === 'VIN_DUPLICATE'
            ? `${fixRes.message} Check the chassis plate — this VIN belongs to another vehicle on file.`
            : (fixRes.message || 'Could not save the VIN onto the vehicle.'));
          setSubmitting(false); setStep(1); return;
        }
      }

      const payload = {
        customer_id: finalCustomerId,
        vehicle_id: vId,
        service_bay_id: serviceBayId ? Number(serviceBayId) : null,
        work_order_type: workOrderType,
        service_category: serviceCategory,
        customer_name: finalCustomerName,
        customer_phone: finalCustomerPhone,
        customer_email: finalCustomerEmail,
        description: description.trim(),
        special_instructions: specialInstructions.trim() || null,
        scheduled_at: scheduledAt || null,
        odometer_in: odometerIn.trim() ? Number(odometerIn.trim()) : null,
        intake_channel: 'advisor',
        payment_method: paymentMethod,
        // Backend total_amount = cash_amount + service_fee - discount (line items are
        // stored but not summed server-side), so send the parts/services subtotal as
        // cash_amount to make the estimate total come out correct.
        cash_amount: totals.itemsTotal,
        service_fee: parseFloat(serviceFee) || 0,
        discount: parseFloat(discount) || 0,
        items: items
          .filter(it => it.name.trim())
          .map(it => ({ name: it.name.trim(), quantity: parseFloat(it.quantity) || 1, unit_price: parseFloat(it.unit_price) || 0, notes: it.notes.trim() || null })),
      };

      if (editOrder) {
        // ── EDIT MODE ──
        const res = await api.put(`/work-orders/${editOrder.id}`, payload);
        if (!res.success) { setError(res.message || 'Could not update the work order.'); setSubmitting(false); return; }
        // Refresh line items: delete old, create new
        try {
          const existingRes = await api.get(`/work-orders/${editOrder.id}/items`);
          for (const it of (existingRes.data || [])) {
            await api.delete(`/work-orders/${editOrder.id}/items/${it.id}`);
          }
          for (const it of payload.items) {
            await api.post(`/work-orders/${editOrder.id}/items`, it);
          }
        } catch { /* non-fatal: items will be stale but the core update succeeded */ }
        // Re-assign mechanic if changed
        if (mechanicId && String(mechanicId) !== String(editOrder.mechanic_id)) {
          try { await api.patch(`/work-orders/${editOrder.id}/assign-mechanic`, { mechanic_id: Number(mechanicId) }); } catch {}
        }
        setSubmitting(false);
        onUpdated?.(res.data);
      } else {
        // ── CREATE MODE ──
        const res = await api.post('/work-orders', payload);
        if (!res.success) {
          if (res.upgrade_required) setError(res.message || 'Work order limit reached — upgrade your plan.');
          else setError(res.message || 'Could not create the work order.');
          setSubmitting(false);
          return;
        }
        const created = res.data;
        if (mechanicId && created?.id) {
          try { await api.patch(`/work-orders/${created.id}/assign-mechanic`, { mechanic_id: Number(mechanicId) }); } catch { /* non-fatal */ }
        }
        setSubmitting(false);
        onCreated?.(created);
      }
    } catch (e) {
      console.error(e);
      setError('Network error — please try again.');
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={st.header}>
          <div>
            <h2 style={st.title}>{editOrder ? 'Edit Job Card' : 'New Job Card'}</h2>
            <p style={st.subtitle}>{editOrder ? `${editOrder.work_order_number} — ` : ''}Step {step} of {STEPS.length} — {STEPS[step - 1].title}</p>
          </div>
          <button style={st.closeBtn} onClick={onClose} aria-label="Close"><Xmark width={20} height={20} /></button>
        </div>

        {/* Stepper */}
        <div style={st.stepper}>
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = step === s.n;
            const done = step > s.n;
            return (
              <div key={s.n} style={st.stepWrap}>
                <div style={{ ...st.stepBubble, ...(active ? st.stepActive : done ? st.stepDone : {}) }}>
                  {done ? <Check width={16} height={16} /> : <Icon width={16} height={16} />}
                </div>
                <span style={{ ...st.stepLabel, color: active ? NAVY : '#94a3b8', fontWeight: active ? 700 : 500 }}>{s.title}</span>
                {i < STEPS.length - 1 && <div style={{ ...st.stepLine, background: done ? ORANGE : '#e2e8f0' }} />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div style={st.body}>
          {error && <div style={st.error}>{error}</div>}

          {/* ══ STEP 1 — who the customer is ══ */}
          {step === 1 && (
            <div style={pageWrap}>
              <div style={st.pageMain}>

                <div style={st.blockLabel}>Select Customer Type</div>
                <div style={st.blockHint}>Choose whether the customer is internal or external.</div>
                <div style={st.cardRow}>
                  <ChoiceCard
                    icon={Building} title="Internal Customer"
                    desc="Company fleet, assets and inter-functional entities"
                    selected={customerClass === 'internal'}
                    onClick={() => {
                      setCustomerClass('internal');
                      setCustomerId(''); setSelectedCustomer(null); setVehicleId('');
                      setAddingVehicle(false); setCustomerSearch('');
                    }}
                  />
                  <ChoiceCard
                    icon={User} title="External Customer"
                    desc="Walk-in customers, third parties and external clients"
                    selected={customerClass === 'external'}
                    onClick={() => {
                      setCustomerClass('external'); setInternalSub('');
                      setCustomerId(''); setSelectedCustomer(null); setVehicleId('');
                      setAddingVehicle(false); setCustomerSearch('');
                    }}
                  />
                </div>

                {customerClass === 'internal' && (
                  <>
                    <div style={st.blockLabel}>Select Internal Subcategory</div>
                    <div style={st.blockHint}>Choose the internal category to filter customers.</div>
                    <div style={st.pillRow}>
                      {[
                        { v: 'fleet', label: 'Fleet', Icon: Truck },
                        { v: 'insurance', label: 'Insurance', Icon: ShieldCheck },
                        { v: 'asset', label: 'Asset', Icon: Box },
                      ].map(({ v, label, Icon }) => (
                        <button key={v} type="button"
                          style={{ ...st.pill, ...(internalSub === v ? st.pillOn : {}) }}
                          onClick={() => {
                            setInternalSub(v);
                            setCustomerId(''); setSelectedCustomer(null); setVehicleId('');
                            setCustomerSearch('');
                          }}>
                          <Icon width={17} height={17} /> {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {customerClass === 'external' && (
                  <>
                    <div style={st.blockLabel}>Select External Customer Option</div>
                    <div style={st.blockHint}>Choose how to proceed for external customers.</div>
                    <div style={st.cardRow}>
                      <ChoiceCard
                        icon={Search} title="Existing Customer"
                        desc="Search and select from existing customer records"
                        selected={externalOpt === 'existing'}
                        onClick={() => { setExternalOpt('existing'); setAddingVehicle(false); }}
                      />
                      <ChoiceCard
                        icon={UserPlus} title="Walk-in Customer"
                        desc="New customer (not in system)"
                        selected={externalOpt === 'walkin'}
                        onClick={() => {
                          setExternalOpt('walkin');
                          setCustomerId(''); setSelectedCustomer(null); setVehicleId('');
                          setAddingVehicle(false);
                        }}
                      />
                    </div>
                  </>
                )}

                {customerMode === 'existing' ? (
                  <>
                    <div style={st.blockLabel}>Select Customer</div>
                    <div style={st.blockHint}>
                      {customerClass === 'internal'
                        ? 'Choose a customer from the list.'
                        : 'Search by name, code, phone, plate or VIN.'}
                    </div>
                    {customerClass === 'internal' && !internalSub ? (
                      <div style={st.emptyHint}>Pick a subcategory above to see its accounts.</div>
                    ) : (
                      <>
                        <div style={st.searchWrap}>
                          <Search width={16} height={16} style={{ color: '#94a3b8' }} />
                          <input style={st.searchInput}
                            placeholder="Search customer name, code or phone…"
                            value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                        </div>
                        <div style={st.custListTall}>
                          {customersLoading && <div style={st.emptyHint}>Searching…</div>}
                          {!customersLoading && customers.length === 0 && (
                            <div style={st.emptyHint}>
                              {customerSearch.trim()
                                ? 'No customers match.'
                                : customerClass === 'internal'
                                  ? `No ${internalSub} accounts are set up yet. Classify them from the Customers page.`
                                  : 'Type a name, code, phone, plate or VIN to search.'}
                            </div>
                          )}
                          {customers.map(c => (
                            <button key={c.id} type="button"
                              style={{ ...st.custItem, ...(String(c.id) === String(customerId) ? st.custItemOn : {}) }}
                              onClick={() => { setCustomerId(String(c.id)); setSelectedCustomer(c); }}>
                              <div style={st.custName}>{c.full_name}</div>
                              <div style={st.custMeta}>
                                {[real(c.code), real(c.phone)].filter(Boolean).join(' · ') || 'No code or phone on file'}
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div style={st.blockLabel}>Customer Information</div>
                    <div style={st.blockHint}>This creates a new customer record you will find under Customers.</div>
                    {/* Two columns, not one: three short fields stacked down a
                        700px page is a lot of white space and a lot of scroll. */}
                    <div style={st.grid2Tight}>
                      <Field label="Customer Name *">
                        <input style={st.input} value={customerName}
                          onChange={e => setCustomerName(e.target.value)} placeholder="Ahmed Al Mansoori" />
                      </Field>
                      <Field label="Mobile Number *">
                        <input style={st.input} value={customerPhone}
                          onChange={e => setCustomerPhone(e.target.value)} placeholder="+971 50 123 4567" />
                      </Field>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <Field label="Email">
                        <input style={st.input} value={customerEmail}
                          onChange={e => setCustomerEmail(e.target.value)} placeholder="name@example.com" />
                      </Field>
                    </div>
                    {dupMatches.length > 0 && (
                      <div style={{ ...st.dupWarning, marginTop: 14 }}>
                        <div style={st.dupWarningTitle}>
                          {dupMatches.length === 1 ? 'Found a matching customer already on file:' : `Found ${dupMatches.length} matching customers already on file:`}
                        </div>
                        {dupMatches.map(c => (
                          <button key={c.id} type="button" style={st.dupMatchBtn} onClick={() => useExistingInstead(c)}>
                            <span>{c.full_name} · {c.phone}</span>
                            <span style={st.dupMatchUse}>Use this customer</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={narrow ? st.summaryColStacked : st.summaryCol}>
                <div style={st.blockLabel}>
                  {customerMode === 'existing' ? 'Selected Customer' : 'Customer Summary'}
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
                        <div style={st.summarySub}>{real(selectedCustomer.code) || real(selectedCustomer.phone) || '—'}</div>
                      </div>
                    </div>
                    <SummaryRow icon={Building} label="Type" value={selectedCustomer.customer_class === 'internal' ? 'Internal' : 'External'} />
                    <SummaryRow icon={Truck} label="Subcategory" value={cap(selectedCustomer.customer_subcategory)} />
                    <SummaryRow icon={Barcode} label="Code" value={real(selectedCustomer.code)} />
                    <SummaryRow icon={Phone} label="Phone" value={real(selectedCustomer.phone)} />
                    <SummaryRow icon={Mail} label="Email" value={real(selectedCustomer.email)} />
                    <SummaryRow icon={MapPin} label="Address" value={[selectedCustomer.city, selectedCustomer.emirate].filter(Boolean).join(', ')} />
                  </div>
                )}
                {customerMode === 'new' && (
                  <div style={st.summaryCard}>
                    <div style={st.avatarRow}>
                      <div style={{ ...st.avatar, background: '#2563eb' }}><User width={20} height={20} /></div>
                      <div style={{ minWidth: 0 }}>
                        <div style={st.summaryName}>Walk-in Customer</div>
                        <div style={st.summarySub}>Not in system</div>
                      </div>
                    </div>
                    <SummaryRow icon={Building} label="Type" value="External" />
                    <SummaryRow icon={UserPlus} label="Mode" value="Walk-in" />
                    <SummaryRow icon={User} label="Customer Name" value={customerName} />
                    <SummaryRow icon={Phone} label="Mobile" value={customerPhone} />
                    <SummaryRow icon={Mail} label="Email" value={customerEmail} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ STEP 2 — which car, and what the odometer reads ══ */}
          {step === 2 && (
            <div style={pageWrap}>
              <div style={st.pageMain}>

                {customerMode === 'new' ? (
                  <>
                    <div style={st.blockLabel}>Vehicle Information</div>
                    <div style={st.blockHint}>
                      The car {customerName.trim() || 'the customer'} has arrived in. It is saved
                      against them, so next time it is one click.
                    </div>
                    <VehicleFormFields newVehicle={newVehicle} setNewVehicle={setNewVehicle} />
                  </>
                ) : addingVehicle ? (
                  <>
                    <div style={st.blockLabel}>New Vehicle</div>
                    <div style={st.blockHint}>Adding a vehicle for {selectedCustomer?.full_name || 'this account'}.</div>
                    <VehicleFormFields newVehicle={newVehicle} setNewVehicle={setNewVehicle} />
                    <button type="button" style={st.linkBtn} onClick={() => setAddingVehicle(false)}>
                      ← Choose an existing vehicle instead
                    </button>
                  </>
                ) : (
                  <>
                    <div style={st.blockLabel}>Select Vehicle</div>
                    <div style={st.blockHint}>
                      {vehicles.length > 0
                        ? `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} on file for ${selectedCustomer?.full_name || 'this account'}.`
                        : 'Nothing on file for this account yet.'}
                    </div>
                    {vehiclesLoading && <div style={st.emptyHint}>Loading vehicles…</div>}
                    {!vehiclesLoading && vehicles.length === 0 && (
                      <div style={st.emptyHint}>No vehicles on file. Add the one in front of you below.</div>
                    )}
                    {!vehiclesLoading && vehicles.length > 4 && (
                      <div style={st.searchWrap}>
                        <Search width={16} height={16} style={{ color: '#94a3b8' }} />
                        <input style={st.searchInput} placeholder="Search plate or VIN…"
                          value={vehicleSearch} onChange={e => setVehicleSearch(e.target.value)} />
                      </div>
                    )}
                    {vehicles.length > 0 && (
                      <div style={st.vehicleGrid}>
                        {filteredVehicles.length === 0 && (
                          <div style={st.emptyHint}>No vehicle matches &quot;{vehicleSearch}&quot;.</div>
                        )}
                        {filteredVehicles.map(v => {
                          const noVin = !String(v.vin || '').trim();
                          const on = String(v.id) === String(vehicleId);
                          return (
                            <button key={v.id} type="button"
                              style={{ ...st.vehicleCard, ...(on ? st.vehicleCardOn : {}) }}
                              onClick={() => setVehicleId(String(v.id))}>
                              <div style={st.vehCardTop}>
                                <Car width={16} height={16} style={{ color: on ? ORANGE : '#94a3b8', flexShrink: 0 }} />
                                <span style={st.vehPlate}>
                                  {v.plate_number || 'No plate'}{v.plate_code ? ` ${v.plate_code}` : ''}
                                </span>
                                {noVin && <span style={st.noVinBadge}>No VIN</span>}
                              </div>
                              <div style={st.vehName}>{v.make} {v.model}{v.year ? ` (${v.year})` : ''}</div>
                              <div style={st.vehMeta}>
                                {[v.fleet_code && `Unit ${v.fleet_code}`, v.color,
                                  v.mileage != null ? `${Number(v.mileage).toLocaleString()} km` : null]
                                  .filter(Boolean).join(' · ') || '—'}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button type="button" style={st.addVehicleBtn} onClick={() => { setVehicleId(''); setAddingVehicle(true); }}>
                      <Plus width={16} height={16} /> Add a new vehicle
                    </button>

                    {selectedVehicleNeedsVin && (
                      <div style={st.vinPrompt}>
                        <div style={st.vinPromptTitle}>
                          <WarningCircle width={15} height={15} style={{ verticalAlign: -2, marginRight: 6 }} />
                          This vehicle has no VIN / chassis number on file
                        </div>
                        <div style={st.vinPromptBody}>
                          Read it off the chassis plate or the registration card. It is saved
                          onto the vehicle, so it is only ever asked for once.
                        </div>
                        <input style={{ ...st.input, marginTop: 8, textTransform: 'uppercase' }}
                          value={vinFix} onChange={e => setVinFix(e.target.value)}
                          placeholder="JTNB11HK7N3024321" />
                      </div>
                    )}
                  </>
                )}

                <div style={{ ...st.blockLabel, marginTop: 22 }}>Odometer Reading</div>
                <div style={st.blockHint}>
                  What the dashboard reads today — not the last figure we recorded.
                </div>
                <div style={st.mileageRow}>
                  <input style={st.mileageInput}
                    value={odometerIn} inputMode="numeric"
                    onChange={e => setOdometerIn(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="45320" />
                  <span style={st.mileageUnit}>KM</span>
                </div>
              </div>

              <div style={narrow ? st.summaryColStacked : st.summaryCol}>
                <div style={st.blockLabel}>Vehicle Details</div>
                <div style={st.summaryCard}>
                  {(customerMode === 'new' || addingVehicle) ? (
                    <>
                      <SummaryRow icon={Barcode} label="Plate Number" value={newVehicle.plate_number} />
                      <SummaryRow icon={Barcode} label="Plate Code" value={newVehicle.plate_code} />
                      <SummaryRow icon={MapPin} label="Emirate" value={newVehicle.plate_emirate} />
                      <SummaryRow icon={Car} label="Vehicle" value={[newVehicle.year, newVehicle.make, newVehicle.model].filter(Boolean).join(' ')} />
                      <SummaryRow icon={Car} label="Color" value={newVehicle.color} />
                      <SummaryRow icon={DashboardSpeed} label="Mileage" value={odometerIn ? `${Number(odometerIn).toLocaleString()} KM` : ''} />
                      <SummaryRow icon={Barcode} label="VIN" value={newVehicle.vin} />
                      <SummaryRow icon={Barcode} label="Engine no" value={newVehicle.engine_no} />
                      <SummaryRow icon={Barcode} label="Unit code" value={newVehicle.fleet_code} />
                    </>
                  ) : selectedVehicle ? (
                    <>
                      <SummaryRow icon={Barcode} label="Plate Number" value={selectedVehicle.plate_number} />
                      <SummaryRow icon={Barcode} label="Plate Code" value={selectedVehicle.plate_code} />
                      <SummaryRow icon={MapPin} label="Emirate" value={selectedVehicle.plate_emirate} />
                      <SummaryRow icon={Car} label="Vehicle" value={[selectedVehicle.year, selectedVehicle.make, selectedVehicle.model].filter(Boolean).join(' ')} />
                      <SummaryRow icon={Car} label="Color" value={selectedVehicle.color} />
                      <SummaryRow icon={DashboardSpeed} label="Mileage" value={odometerIn ? `${Number(odometerIn).toLocaleString()} KM` : ''} />
                      <SummaryRow icon={Barcode} label="VIN" value={vinFix.trim().toUpperCase() || selectedVehicle.vin} />
                      <SummaryRow icon={Barcode} label="Engine no" value={selectedVehicle.engine_no} />
                      <SummaryRow icon={Barcode} label="Unit code" value={selectedVehicle.fleet_code} />
                    </>
                  ) : (
                    <div style={st.emptyHint}>No vehicle selected yet.</div>
                  )}
                </div>

                {/* Who this car is being booked in for, so the context from
                    step 1 does not vanish the moment you leave it. */}
                <div style={{ ...st.blockLabel, marginTop: 18 }}>Customer</div>
                <div style={st.summaryCardQuiet}>
                  <div style={st.summaryName}>
                    {customerMode === 'existing'
                      ? (selectedCustomer?.full_name || '—')
                      : (customerName.trim() || 'Walk-in customer')}
                  </div>
                  <div style={st.summarySub}>
                    {customerMode === 'existing'
                      ? ([real(selectedCustomer?.code), real(selectedCustomer?.phone)].filter(Boolean).join(' · ') || '—')
                      : (customerPhone.trim() || 'Not in system')}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={st.fieldStack}>
              <div style={st.grid2Tight}>
                <Field label="Job type">
                  <select style={st.input} value={workOrderType} onChange={e => setWorkOrderType(e.target.value)}>
                    {WORK_ORDER_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Service category">
                  <select style={st.input} value={serviceCategory} onChange={e => setServiceCategory(e.target.value)}>
                    {SERVICE_CATEGORIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Customer complaint / work requested *">
                <textarea style={{ ...st.input, minHeight: 90, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Car pulls to the left when braking; grinding noise from the front wheels." />
              </Field>
              <Field label="Notes for the technician">
                <textarea style={{ ...st.input, minHeight: 64, resize: 'vertical' }} value={specialInstructions} onChange={e => setSpecialInstructions(e.target.value)}
                  placeholder="Internal notes, parts to check, warranty details…" />
              </Field>
              {/*
               * Scheduled drop-off removed from this flow — a job card is
               * created once the vehicle is actually at the workshop, not
               * booked in advance from here (that's the Enquiries/
               * appointments flow). scheduledAt itself is left wired end to
               * end (loaded from editOrder.scheduled_at, submitted, shown on
               * the review step) so a job card that already carries a slot
               * from being converted elsewhere still displays and saves it
               * correctly — only the picker that lets someone set or change
               * it here is gone.
               */}
            </div>
          )}

          {step === 4 && (
            <div>
              <div style={st.sectionLabel}>Estimate line items (services & parts)</div>
              <div style={st.itemsHead}>
                <span style={{ flex: 1 }}>Description</span>
                <span style={{ width: 64, textAlign: 'center' }}>Qty</span>
                <span style={{ width: 110, textAlign: 'right' }}>Unit price</span>
                <span style={{ width: 110, textAlign: 'right' }}>Amount</span>
                <span style={{ width: 32 }} />
              </div>
              {items.map((it, idx) => (
                <div key={idx} style={st.itemRow}>
                  <input style={{ ...st.input, flex: 1 }} placeholder="Oil change · brake pads · labor…" value={it.name} onChange={e => updateItem(idx, 'name', e.target.value)} />
                  <input style={{ ...st.input, width: 64, textAlign: 'center' }} value={it.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} />
                  <input style={{ ...st.input, width: 110, textAlign: 'right' }} placeholder="0.00" value={it.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} />
                  <div style={st.itemAmount}>{fmt((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0))}</div>
                  <button style={st.itemDel} onClick={() => removeItem(idx)} aria-label="Remove item"><Trash width={15} height={15} /></button>
                </div>
              ))}
              <button style={st.linkBtn} onClick={addItem}><Plus width={15} height={15} /> Add line item</button>

              <div style={st.chargeGrid}>
                <Field label="Extra labor / service fee"><input style={st.input} placeholder="0.00" value={serviceFee} onChange={e => setServiceFee(e.target.value)} /></Field>
                <Field label="Discount"><input style={st.input} placeholder="0.00" value={discount} onChange={e => setDiscount(e.target.value)} /></Field>
                <Field label="Payment method">
                  <select style={st.input} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                    {PAYMENT_METHODS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>

              <div style={st.totalsBox}>
                <Row label="Parts & services" value={fmt(totals.itemsTotal)} />
                <Row label="Labor / service fee" value={fmt(totals.fee)} />
                <Row label="Discount" value={`- ${fmt(totals.disc)}`} />
                <div style={st.totalDivider} />
                <Row label="Estimate total" value={fmt(totals.grand)} strong />
              </div>
            </div>
          )}

          {step === 5 && (
            <div style={st.fieldStack}>
              <div style={st.grid2Tight}>
                <Field label="Service bay">
                  <select style={st.input} value={serviceBayId} onChange={e => setServiceBayId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {serviceBays.map(b => <option key={b.id} value={b.id}>{b.name || b.bay_name || `Bay ${b.id}`}</option>)}
                  </select>
                </Field>
                <Field label="Assign technician">
                  <select style={st.input} value={mechanicId} onChange={e => setMechanicId(e.target.value)}>
                    <option value="">Assign later</option>
                    {mechanics.map(m => <option key={m.id} value={m.id}>{m.full_name}{m.status ? ` · ${m.status}` : ''}</option>)}
                  </select>
                </Field>
              </div>

              <div style={st.reviewCard}>
                <ReviewRow icon={User} label="Customer"
                  value={customerMode === 'existing'
                    ? (selectedCustomer ? `${selectedCustomer.full_name} · ${selectedCustomer.phone || ''}` : '—')
                    : `${customerName || '—'} · ${customerPhone || ''} (new customer)`} />
                <ReviewRow icon={Car} label="Vehicle"
                  value={addingVehicle ? `${newVehicle.make} ${newVehicle.model} ${newVehicle.year || ''} (new)`.trim()
                    : (vehicles.find(v => String(v.id) === String(vehicleId)) ? `${vehicles.find(v => String(v.id) === String(vehicleId)).make} ${vehicles.find(v => String(v.id) === String(vehicleId)).model}` : '—')} />
                <ReviewRow icon={Wrench} label="Service"
                  value={`${SERVICE_CATEGORIES.find(s => s.value === serviceCategory)?.label} · ${WORK_ORDER_TYPES.find(w => w.value === workOrderType)?.label}`} />
                <ReviewRow icon={Timer} label="Complaint" value={description || '—'} />
                {scheduledAt && <ReviewRow icon={Calendar} label="Scheduled" value={new Date(scheduledAt).toLocaleString()} />}
                <ReviewRow icon={ClipboardCheck} label="Estimate total" value={fmt(totals.grand)} strong />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={st.footer}>
          {step > 1
            ? <button style={st.ghostBtn} onClick={back}><NavArrowLeft width={16} height={16} /> Back</button>
            : <button style={st.ghostBtn} onClick={onClose}>Cancel</button>}
          {step < STEPS.length
            ? <button style={st.primaryBtn} onClick={next}>Next <NavArrowRight width={16} height={16} /></button>
            : <button style={{ ...st.primaryBtn, opacity: submitting ? 0.7 : 1 }} disabled={submitting} onClick={submit}>{submitting ? (editOrder ? 'Saving…' : 'Creating…') : (editOrder ? 'Save changes' : 'Create job card')}</button>}
        </div>
      </div>
    </div>
  );
}

/**
 * The vehicle intake fields — make/model/year/plate/odometer/VIN/fuel/
 * transmission/color. Shared by "existing customer → add a new vehicle" and
 * "new customer" (whose vehicle, if they give one, is necessarily new too),
 * so the two paths can never drift on which fields exist or which are
 * required — only make and model are, matching the Vehicles page itself.
 */
function VehicleFormFields({ newVehicle, setNewVehicle }) {
  return (
    <>
      <div style={st.grid2Tight}>
        <Field label="Make *">
          <select style={st.input} value={newVehicle.make}
            onChange={e => setNewVehicle(v => ({ ...v, make: e.target.value, model: '' }))}>
            <option value="">Select make…</option>
            {CAR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Model *">
          {newVehicle.make && CAR_CATALOG[newVehicle.make] && CAR_CATALOG[newVehicle.make].length > 0 ? (
            <select style={st.input} value={newVehicle.model}
              onChange={e => setNewVehicle(v => ({ ...v, model: e.target.value }))}>
              <option value="">Select model…</option>
              {CAR_CATALOG[newVehicle.make].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input style={st.input} value={newVehicle.model}
              onChange={e => setNewVehicle(v => ({ ...v, model: e.target.value }))}
              placeholder={newVehicle.make ? 'Enter model' : 'Select make first'}
              disabled={!newVehicle.make} />
          )}
        </Field>
      </div>
      <div style={st.grid2Tight}>
        <Field label="Plate Number *">
          <input style={st.input} value={newVehicle.plate_number}
            onChange={e => setNewVehicle(v => ({ ...v, plate_number: e.target.value }))} placeholder="87345" />
        </Field>
        {/* Plate code and emirate are separate fields, not part of the
            number. "87345 / A / Abu Dhabi" is one plate, and squashing it
            into a single string is what makes plate search unreliable. */}
        <Field label="Plate Code">
          <input style={st.input} value={newVehicle.plate_code}
            onChange={e => setNewVehicle(v => ({ ...v, plate_code: e.target.value.slice(0, 10) }))} placeholder="A" />
        </Field>
      </div>
      <div style={st.grid2Tight}>
        <Field label="Emirate">
          <select style={st.input} value={newVehicle.plate_emirate}
            onChange={e => setNewVehicle(v => ({ ...v, plate_emirate: e.target.value }))}>
            <option value="">Select emirate…</option>
            {EMIRATES.map(em => <option key={em} value={em}>{em}</option>)}
          </select>
        </Field>
        <Field label="Year">
          <input style={st.input} value={newVehicle.year}
            onChange={e => setNewVehicle(v => ({ ...v, year: e.target.value.replace(/[^\d]/g, '').slice(0, 4) }))} placeholder="2022" />
        </Field>
      </div>
      <div style={st.grid2Tight}>
        <Field label="VIN / Chassis Number *">
          <input style={{ ...st.input, textTransform: 'uppercase' }} value={newVehicle.vin}
            onChange={e => setNewVehicle(v => ({ ...v, vin: e.target.value }))} placeholder="JTNB11HK7N3024321" />
        </Field>
        <Field label="Engine Number">
          <input style={st.input} value={newVehicle.engine_no}
            onChange={e => setNewVehicle(v => ({ ...v, engine_no: e.target.value }))} placeholder="A0C01177" />
        </Field>
      </div>
      {/* The fleet's own unit code — taxi code 5946 on the Aman sheet. It is
          what the fleet quotes down the phone, so it is worth storing even
          though it means nothing to us. */}
      <div style={st.grid2Tight}>
        <Field label="Fleet / Unit Code">
          <input style={st.input} value={newVehicle.fleet_code}
            onChange={e => setNewVehicle(v => ({ ...v, fleet_code: e.target.value }))} placeholder="5946" />
        </Field>
        <Field label="Color">
          <input style={st.input} value={newVehicle.color}
            onChange={e => setNewVehicle(v => ({ ...v, color: e.target.value }))} placeholder="White" />
        </Field>
      </div>
      {/* Fuel and transmission stay optional. Make, model, plate and VIN are
          the four that are now required — VIN because the whole point of
          the process change is that a chassis number is captured while the
          car is in front of someone. */}
      <div style={st.grid2Tight}>
        <Field label="Fuel">
          <select style={st.input} value={newVehicle.fuel_type} onChange={e => setNewVehicle(v => ({ ...v, fuel_type: e.target.value }))}>
            {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Transmission">
          <select style={st.input} value={newVehicle.transmission} onChange={e => setNewVehicle(v => ({ ...v, transmission: e.target.value }))}>
            <option value="automatic">Automatic</option>
            <option value="manual">Manual</option>
          </select>
        </Field>
      </div>
    </>
  );
}

function Field({ label, children }) {
  return (
    <label style={st.field}>
      <span style={st.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13.5, fontWeight: strong ? 800 : 500, color: strong ? NAVY : '#475569' }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
function ReviewRow({ icon: Icon, label, value, strong }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
      <Icon width={18} height={18} style={{ color: ORANGE, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 14, color: strong ? NAVY : '#1e293b', fontWeight: strong ? 800 : 500 }}>{value}</div>
      </div>
    </div>
  );
}

const st = {
  // z-index must clear the sidebar (1065) and topbar (1060) in Layout.css —
  // at 1000 the sidebar painted over the modal's left edge, clipping it.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16, backdropFilter: 'blur(2px)' },
  modal: { background: '#fff', borderRadius: 20, width: '100%', maxWidth: 1020, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(0,0,0,0.28)', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '22px 26px 16px' },
  title: { margin: 0, fontSize: 21, fontWeight: 800, color: NAVY, letterSpacing: '-0.3px' },
  subtitle: { margin: '4px 0 0', fontSize: 13, color: '#64748b' },
  closeBtn: { background: '#f1f5f9', border: 'none', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569' },
  stepper: { display: 'flex', alignItems: 'center', padding: '0 26px 18px', gap: 0 },
  stepWrap: { display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 },
  stepBubble: { width: 34, height: 34, borderRadius: '50%', background: '#f1f5f9', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderStyle: 'solid', borderWidth: 2, borderColor: 'transparent', transition: 'all .2s' },
  stepActive: { background: '#fff7ed', color: ORANGE, borderColor: ORANGE },
  stepDone: { background: ORANGE, color: '#fff' },
  stepLabel: { fontSize: 12.5, marginLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  stepLine: { flex: 1, height: 2, margin: '0 10px', borderRadius: 2, minWidth: 12 },
  body: { padding: '4px 26px 8px', overflowY: 'auto', flex: 1 },
  error: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14, fontWeight: 500 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 },
  grid2Tight: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },

  /* ── Page layout: the work on the left, a live summary on the right ──
   * Used by steps 1 and 2. The summary column is fixed at 290px rather
   * than a fraction, so widening the modal gives the extra space to the
   * fields, which is where it is needed. */
  pageWrap: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 290px', gap: 30, alignItems: 'start' },
  pageWrapStacked: { display: 'flex', flexDirection: 'column', gap: 22 },
  pageMain: { minWidth: 0 },
  summaryCol: { minWidth: 0, position: 'sticky', top: 0 },
  summaryColStacked: { minWidth: 0 },

  /* Taller than the old list now that the customer step has a page of its
   * own — the search box and eight results fit without scrolling. */
  custListTall: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' },

  /* Vehicles as cards rather than list rows: a plate, a model and a unit
   * code are three separate facts, and a single line of text makes the
   * advisor read all three to find the one they are scanning for. */
  vehicleGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: 10 },
  vehicleCard: {
    textAlign: 'left', padding: '12px 14px', borderRadius: 12,
    borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0',
    background: '#fff', cursor: 'pointer', minWidth: 0,
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
    outline: 'none', color: NAVY, background: '#fff', width: '100%',
    boxSizing: 'border-box', fontFamily: 'inherit',
  },
  mileageUnit: { fontSize: 14, fontWeight: 700, color: '#94a3b8', flexShrink: 0 },

  summaryCardQuiet: {
    borderStyle: 'solid', borderWidth: 1, borderColor: '#e8eef5', borderRadius: 12,
    padding: '12px 15px', background: '#fff',
  },

  blockLabel: { fontSize: 14.5, fontWeight: 800, color: NAVY, marginBottom: 2, marginTop: 4 },
  blockHint: { fontSize: 12.5, color: '#94a3b8', marginBottom: 10 },

  cardRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 },
  choiceCard: {
    display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'left',
    padding: '14px 15px', borderRadius: 12,
    borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0',
    background: '#fff', cursor: 'pointer', width: '100%',
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

  pillRow: { display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' },
  pill: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px',
    borderRadius: 11, borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0',
    background: '#fff',
    color: NAVY, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, flex: '1 1 0', minWidth: 120,
    justifyContent: 'center',
  },
  pillOn: { borderColor: ORANGE, background: '#fff7ed', color: ORANGE, borderWidth: 2, padding: '11px 19px' },

  summaryCard: {
    borderStyle: 'solid', borderWidth: 1, borderColor: '#e8eef5',
    borderRadius: 12, padding: '14px 15px',
    background: '#fbfdff',
  },
  avatarRow: { display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 12, marginBottom: 10, borderBottom: '1px solid #e8eef5' },
  avatar: {
    width: 42, height: 42, borderRadius: '50%', background: ORANGE, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18, fontWeight: 800, flexShrink: 0,
  },
  summaryName: { fontSize: 14, fontWeight: 700, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  summarySub: { fontSize: 12, color: '#94a3b8' },
  sumRow: { display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', fontSize: 12.5, minWidth: 0 },
  sumLabel: { color: '#94a3b8', width: 86, flexShrink: 0 },
  sumValue: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },

  noVinBadge: {
    marginLeft: 8, fontSize: 9.5, fontWeight: 800, letterSpacing: '.04em',
    color: '#b45309', background: '#fdf4e5', border: '1px solid #f3d9a8',
    borderRadius: 999, padding: '2px 7px', verticalAlign: 1,
  },
  vinPrompt: {
    marginTop: 12, padding: '12px 14px', borderRadius: 11,
    background: '#fdf4e5', borderStyle: 'solid', borderWidth: 1.5, borderColor: '#f3d9a8',
  },
  vinPromptTitle: { fontSize: 13, fontWeight: 700, color: '#92400e' },
  vinPromptBody: { fontSize: 12, color: '#a16207', marginTop: 4, lineHeight: 1.45 },
  charCount: { fontSize: 11, color: '#cbd5e1', textAlign: 'right', marginTop: 3 },
  sectionLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: NAVY, fontWeight: 800, marginBottom: 10 },
  toggleRow: { display: 'flex', gap: 8, marginBottom: 12 },
  toggle: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 10px', borderRadius: 10, borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  toggleOn: { borderColor: ORANGE, background: '#fff7ed', color: ORANGE },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '0 12px', marginBottom: 10 },
  searchInput: { border: 'none', outline: 'none', padding: '10px 0', fontSize: 14, width: '100%', background: 'transparent' },
  custList: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 230, overflowY: 'auto' },
  custItem: { textAlign: 'left', borderStyle: 'solid', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 10, padding: '9px 12px', background: '#fff', cursor: 'pointer' },
  custItemOn: { borderColor: ORANGE, background: '#fff7ed' },
  custName: { fontSize: 14, fontWeight: 700, color: '#1e293b' },
  custMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  emptyHint: { fontSize: 13, color: '#94a3b8', padding: '12px 0', lineHeight: 1.5 },
  dupWarning: { background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  dupWarningTitle: { fontSize: 12.5, fontWeight: 700, color: '#9a3412' },
  dupMatchBtn: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, textAlign: 'left', border: '1px solid #fed7aa', borderRadius: 8, padding: '7px 10px', background: '#fff', cursor: 'pointer', fontSize: 12.5, color: '#1e293b' },
  dupMatchUse: { color: ORANGE, fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap' },
  addVehicleBtn: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, border: '1.5px dashed #cbd5e1', background: '#f8fafc', color: NAVY, borderRadius: 10, padding: '9px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, width: '100%', justifyContent: 'center' },
  fieldStack: { display: 'flex', flexDirection: 'column', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  fieldLabel: { fontSize: 12, fontWeight: 700, color: '#475569' },
  input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none', color: '#1e293b', background: '#fff', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  linkBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: ORANGE, cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '8px 0', marginTop: 4 },
  itemsHead: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 2px 6px' },
  itemRow: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  itemAmount: { width: 110, textAlign: 'right', fontSize: 13.5, fontWeight: 700, color: '#1e293b' },
  itemDel: { width: 32, height: 32, borderRadius: 8, border: 'none', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chargeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 18 },
  totalsBox: { marginTop: 18, background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 12, padding: '12px 16px' },
  totalDivider: { height: 1, background: '#e2e8f0', margin: '6px 0' },
  reviewCard: { border: '1px solid #eef2f7', borderRadius: 12, padding: '4px 16px', background: '#fff' },
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 26px', borderTop: '1px solid #f1f5f9', gap: 12 },
  ghostBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 22px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${ORANGE},#ea580c)`, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700, boxShadow: '0 4px 14px rgba(249,115,22,0.3)' },
};
