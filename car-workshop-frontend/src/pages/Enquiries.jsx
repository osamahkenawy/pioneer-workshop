import { useState, useEffect, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Xmark, CheckCircle, Phone, Clock, StatsUpSquare, Group, ArrowRight,
} from 'iconoir-react';
import api from '../lib/api';
import { PART_CATEGORIES, prefList } from '../lib/intakeOptions';
import { MakeSelect, ModelSelect } from '../components/MakeModelSelect';

/**
 * Enquiries — journey stages 01-02.
 *
 * The CX journey map flags the enquiry log as a gap handled manually today.
 * Every enquiry records the channel it arrived through, so conversion can be
 * measured by source; ones that don't convert record a reason and an optional
 * re-offer date, which is the nurture loop drawn back to stage 01.
 *
 * Each enquiry has its work order (the visit) from the moment it is saved:
 * Convert confirms the customer goes ahead on that work order. The estimate
 * is raised there, after its technical inspection — not from the enquiry.
 *
 * Client meeting (3 Nov 2026): "Not converted" is no longer offered here
 * (enquiries already lost or in nurture still show as such); every enquiry
 * records the emirate the customer is in, so it reaches that emirate's team;
 * and the car is asked as make, model and year only — the work order's
 * "Add a new vehicle" starts from them. Older enquiries keep showing the
 * free-text vehicle and plate they were logged with.
 */

const NAVY = '#1e3a6b';
const ORANGE = '#f97316';

const CHANNELS = {
  owned_repeat:     { label: 'Owned & repeat',   color: '#1C6B52', bg: '#E7F0EB', desc: 'Reminder, returning customer, referral' },
  search_discovery: { label: 'Search & discovery', color: '#B77900', bg: '#FDF2D6', desc: 'Google, reviews, website' },
  passing_local:    { label: 'Passing & local',  color: '#4C5C64', bg: '#EDEEEA', desc: 'Drive-past, signage, neighbours' },
  partner_referred: { label: 'Partner & referred', color: '#2E5E7E', bg: '#E6EEF4', desc: 'Insurer panel, fleet, recovery' },
};

const SOURCE_DETAILS = {
  owned_repeat:     ['Service reminder', 'Returning customer', 'Customer referral'],
  search_discovery: ['Google Business Profile', 'Ratings & reviews', 'Website / price menu'],
  passing_local:    ['Drive-past / walk-in', 'Site signage', 'Neighbouring business'],
  partner_referred: ['Insurer approved-repairer panel', 'Corporate / fleet account', 'Recovery / roadside', 'Dealer overflow'],
};

const STATUS_META = {
  new:       { label: 'New',       color: '#2563eb', bg: '#eff6ff' },
  quoted:    { label: 'Quoted',    color: '#B77900', bg: '#FDF2D6' },
  converted: { label: 'Converted', color: '#16a34a', bg: '#f0fdf4' },
  nurture:   { label: 'Nurture',   color: '#7c3aed', bg: '#ede9fe' },
  lost:      { label: 'Lost',      color: '#dc2626', bg: '#fef2f2' },
};

const TIERS = {
  tier1_routine:    'Tier 1 · Routine service',
  tier2_diagnostic: 'Tier 2 · Diagnostic / repair',
  tier3_major:      'Tier 3 · Major / accident',
};

const PAYERS = { self_pay: 'Self-pay', insurance: 'Insurance', corporate: 'Corporate', fleet: 'Fleet' };
const CONTACT_METHODS = { phone: 'Phone', whatsapp: 'WhatsApp', website_form: 'Website form', walk_in: 'Walk-in', partner_handoff: 'Partner hand-off', email: 'Email', reminder: 'Reply to a service reminder', referral: 'Referral' };
const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
// Still shown on enquiries recorded as not converted (and in the stats).
const LOST_REASONS = { price: 'Price', timing: 'Timing / lead time', location: 'Location', went_elsewhere: 'Went elsewhere', no_response: 'No response', not_needed: 'No longer needed', other: 'Other' };

const COMPLAINT_MAX = 5000;
// The car's model year: 4 digits, 1950 to next year (as the server checks).
const YEAR_MIN = 1950;
const yearMax = () => new Date().getFullYear() + 1;
// Arabic-Indic digits from an Arabic keyboard, as ASCII; nothing but digits kept.
const yearDigits = v => String(v).replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0)).replace(/\D/g, '').slice(0, 4);

function KPICard({ icon: Icon, label, value, sub, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '16px 18px', flex: 1, minWidth: 150,
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: `3px solid ${color}` }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: color + '18',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <Icon width={18} height={18} color={color} strokeWidth={1.8} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, color: '#1e293b', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 500 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: '#94a3b8' }}>{hint}</span>}
    </label>
  );
}

/**
 * /enquiries — old address. Enquiries and customers are one module (client
 * feedback 18 Nov 2026, point 2): the Customers page lists everyone with
 * their enquiry. Links from Bookings, Tasks and notifications land there,
 * filtered to open enquiries; ?id=<enquiry> opens that enquiry.
 */
export default function Enquiries() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const qs = new URLSearchParams({ stage: params.get('due') === 'true' ? 'due' : 'enquiry' });
  if (id) qs.set('enquiry', id);
  return <Navigate to={`/customers?${qs.toString()}`} replace />;
}

/**
 * The enquiry numbers, on the Customers page (collapsed by default): totals,
 * the funnel from enquiry to completed job, conversion by channel and why
 * enquiries did not convert. GET /enquiries/stats.
 */
export function EnquiryInsights() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/enquiries/stats').then(r => { if (live && r?.success) setStats(r.data); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const t = stats?.totals || {};
  const pending = (Number(t.new_count) || 0) + (Number(t.quoted) || 0);
  const total = Number(t.total) || 0;
  const conversionRate = total > 0 ? Math.round(((Number(t.converted) || 0) / total) * 100) : 0;
  if (!stats) return <div style={{ color: '#94a3b8', fontSize: 13, padding: '8px 0' }}>Loading…</div>;
  const f = stats.funnel?.total;
  const steps = f ? [['Enquiries', f.enquiries], ['Quoted', f.quoted], ['Booked', f.booked], ['Job opened', f.jobs], ['Completed', f.completed]] : [];
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <KPICard icon={Group} label="Total enquiries" value={t.total ?? 0} color={NAVY} />
        <KPICard icon={Phone} label="Pending" value={pending} sub="New + Quoted" color="#B77900" />
        <KPICard icon={CheckCircle} label="Converted" value={t.converted ?? 0} sub={`${conversionRate}% conversion`} color="#16a34a" />
        <KPICard icon={Clock} label="In nurture" value={t.nurture ?? 0} sub="Re-offer scheduled" color="#7c3aed" />
      </div>
      {f?.enquiries > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #f1f5f9', padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ArrowRight width={18} height={18} color={ORANGE} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#1e293b' }}>From enquiry to completed job</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
            {steps.map(([label, n], i) => (
              <div key={label} style={{ background: i === 0 ? '#eef2f9' : '#f8fafc', borderRadius: 12, padding: '10px 12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b' }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: NAVY }}>{Number(n) || 0}</div>
                {i > 0 && <div style={{ fontSize: 11, color: '#94a3b8' }}>{f.enquiries ? Math.round(100 * (Number(n) || 0) / f.enquiries) : 0}% of enquiries</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {stats.by_channel?.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #f1f5f9', padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <StatsUpSquare width={18} height={18} color={ORANGE} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#1e293b' }}>Conversion by channel</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            {stats.by_channel.map(c => {
              const m = CHANNELS[c.source_channel] || { label: c.source_channel, color: '#64748b', bg: '#f1f5f9' };
              const rate = Number(c.conversion_rate) || 0;
              return (
                <div key={c.source_channel} style={{ background: m.bg, borderRadius: 12, padding: '12px 14px', border: `1px solid ${m.color}25` }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: m.color, marginBottom: 6 }}>{m.label}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 22, fontWeight: 900, color: '#1e293b' }}>{rate}%</span>
                    <span style={{ fontSize: 11.5, color: '#64748b' }}>{c.converted} of {c.total}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 99, background: '#fff', marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, rate)}%`, height: '100%', background: m.color, borderRadius: 99 }} />
                  </div>
                </div>
              );
            })}
          </div>
          {stats.lost_reasons?.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Why enquiries didn't convert</span>
              {stats.lost_reasons.map(r => (
                <span key={r.lost_reason} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 20, padding: '5px 12px', fontSize: 12.5, color: '#475569' }}>
                  {LOST_REASONS[r.lost_reason] || r.lost_reason}<strong style={{ marginLeft: 6, color: '#1e293b' }}>{r.count}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** An enquiry's status as a pill (the Customers list and drawer). */
export function EnquiryStatusPill({ status }) {
  const sm = STATUS_META[status] || STATUS_META.new;
  return <span style={{ ...st.pill, background: sm.bg, color: sm.color }}>{sm.label}</span>;
}
export const enquiryChannelLabel = k => CHANNELS[k]?.label || k || '';

/* ── Create / edit enquiry ── */
// The enquiry type is no longer asked: the column keeps its value ('service'
// on a new enquiry), and the job types are ticked later on the work order.
// The car is make, model and year only (3 Nov 2026): the free-text vehicle
// and plate are not sent, so an older enquiry keeps them (shown read-only).
/** An enquiry's form values: the one being edited, or a new one (with the customer's contact details). */
export function enquiryForm(enquiry, customer = null) {
  return {
    contact_name: enquiry?.contact_name || customer?.full_name || '',
    contact_phone: enquiry?.contact_phone || customer?.phone || '',
    contact_email: enquiry?.contact_email || customer?.email || '',
    emirate: enquiry?.emirate || customer?.emirate || '',
    vehicle_make: enquiry?.vehicle_make || '',
    vehicle_model: enquiry?.vehicle_model || '',
    vehicle_year: enquiry?.vehicle_year ? String(enquiry.vehicle_year) : '',
    service_tier: enquiry?.service_tier || '',
    description: enquiry?.description || '',
    // The parts the customer accepts — any of Genuine / After-Market / Used,
    // at least one. Nothing is ticked for them: the advisor asks.
    parts_preference: prefList(enquiry?.parts_preference),
    quoted_amount: enquiry?.quoted_amount ?? '',
    source_channel: enquiry?.source_channel || '',
    source_detail: enquiry?.source_detail || '',
    referred_by: enquiry?.referred_by || '',
    contact_method: enquiry?.contact_method || 'phone',
    payer_type: enquiry?.payer_type || 'self_pay',
    status: enquiry?.status || 'new',
    follow_up_at: enquiry?.follow_up_at ? String(enquiry.follow_up_at).replace(' ', 'T').slice(0, 16) : '',
  };
}

/** What is wrong with the enquiry's own details (not the contact), or ''. */
export function enquiryProblem(f, t) {
  if (f.vehicle_year && (!/^\d{4}$/.test(f.vehicle_year) || Number(f.vehicle_year) < YEAR_MIN || Number(f.vehicle_year) > yearMax())) {
    return t('enquiries.year_invalid', 'The vehicle year must be 4 digits, {{min}} to {{max}}.', { min: YEAR_MIN, max: yearMax() });
  }
  if (!f.source_channel) return 'Select how this enquiry reached you — it is what makes conversion measurable.';
  if (f.description.trim().length > COMPLAINT_MAX) return t('enquiries.complaint_too_long', 'The customer complaint is longer than 5,000 characters — shorten it.');
  if (!f.parts_preference.length) return t('enquiries.parts_required', 'Tick at least one — ask the customer which parts they accept.');
  return '';
}

/** The body POST / PUT /enquiries takes. */
export function enquiryPayload(f) {
  return {
    ...f,
    quoted_amount: f.quoted_amount === '' ? null : Number(f.quoted_amount),
    service_tier: f.service_tier || null,
    vehicle_make: f.vehicle_make.trim() || null,
    vehicle_model: f.vehicle_model.trim() || null,
    vehicle_year: f.vehicle_year ? Number(f.vehicle_year) : null,
    follow_up_at: f.follow_up_at ? f.follow_up_at.replace('T', ' ') + ':00' : null,
  };
}

/**
 * The enquiry's own fields — the car (make, model, year), how it reached us,
 * tier and payer, the complaint, the parts accepted, quote and follow-up.
 * Used by the enquiry dialog and by the New Customer form's Enquiry step, so
 * one form captures a customer and their enquiry (18 Nov, point 2).
 */
export function EnquiryDetails({ f, setF, prefError = false, onPart, prefRef = null, isEdit = false, enquiry = null }) {
  const { t } = useTranslation();
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const togglePart = c => {
    onPart?.();
    setF(p => ({ ...p, parts_preference: prefList(p.parts_preference.includes(c) ? p.parts_preference.filter(x => x !== c) : [...p.parts_preference, c]) }));
  };
  const loggedCar = enquiry && !enquiry.vehicle_make && !enquiry.vehicle_model && !enquiry.vehicle_year
    ? String(enquiry.vehicle_description || '').trim() : '';
  const loggedPlate = String(enquiry?.vehicle_plate || '').trim();
  const details = SOURCE_DETAILS[f.source_channel] || [];
  return (
    <>
          {/* The car: make, model and year only — the rest is taken when it comes in. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px', gap: 12 }}>
            <Field label={t('vehicles.make', 'Make')}>
              <MakeSelect value={f.vehicle_make} style={st.input}
                onChange={(make, picked) => setF(p => ({ ...p, vehicle_make: make, ...(picked ? { vehicle_model: '' } : {}) }))} />
            </Field>
            <Field label={t('vehicles.model', 'Model')}>
              <ModelSelect make={f.vehicle_make} value={f.vehicle_model} style={st.input} onChange={model => set('vehicle_model', model)} />
            </Field>
            <Field label={t('vehicles.year', 'Year')}>
              <input style={st.input} inputMode="numeric" maxLength={4} value={f.vehicle_year}
                onChange={e => set('vehicle_year', yearDigits(e.target.value))} placeholder="2022" />
            </Field>
          </div>
          {(loggedCar || loggedPlate) && (
            <div style={st.infoBox}>
              {t('enquiries.logged_vehicle', 'Logged with this enquiry')}:{' '}
              {[loggedCar, loggedPlate && `${t('enquiries.plate', 'Plate')} ${loggedPlate}`].filter(Boolean).join(' · ')}
            </div>
          )}

          <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="How did they reach us? *" hint="Captured at the point of enquiry">
              <select style={st.input} value={f.source_channel} onChange={e => { set('source_channel', e.target.value); set('source_detail', ''); }}>
                <option value="">Select channel…</option>
                {Object.entries(CHANNELS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Source detail">
              <select style={st.input} value={f.source_detail} onChange={e => set('source_detail', e.target.value)} disabled={!f.source_channel}>
                <option value="">{f.source_channel ? 'Select…' : 'Select a channel first'}</option>
                {details.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Contact method">
              <select style={st.input} value={f.contact_method} onChange={e => set('contact_method', e.target.value)}>
                {Object.entries(CONTACT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Referred by"><input style={st.input} value={f.referred_by} onChange={e => set('referred_by', e.target.value)} placeholder="Name of referrer / partner" /></Field>
          </div>

          <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Service tier" hint="Decides which stages apply">
              <select style={st.input} value={f.service_tier} onChange={e => set('service_tier', e.target.value)}>
                <option value="">Not yet triaged</option>
                {Object.entries(TIERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Payer route">
              <select style={st.input} value={f.payer_type} onChange={e => set('payer_type', e.target.value)}>
                {Object.entries(PAYERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>

          {/* Becomes the work order's complaint. */}
          <Field label={t('enquiries.complaint_label', 'Customer complaint')}
            hint={`${f.description.length.toLocaleString('en-US')} / 5,000`}>
            <textarea style={{ ...st.input, minHeight: 96, resize: 'vertical' }} maxLength={COMPLAINT_MAX}
              value={f.description} onChange={e => set('description', e.target.value)}
              placeholder={t('enquiries.complaint_placeholder', 'What the customer reports — any detail, in their words')} />
          </Field>

          <div ref={prefRef} role="group" aria-labelledby="enq-parts-label" aria-describedby="enq-parts-note"
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span id="enq-parts-label" style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
              {t('enquiries.parts_label', 'Parts the customer accepts')} *
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PART_CATEGORIES.map(c => {
                const on = f.parts_preference.includes(c.value);
                return (
                  <label key={c.value} style={{ ...st.checkChip, ...(on ? st.checkChipOn : null), ...(prefError ? { borderColor: '#fca5a5' } : null) }}>
                    <input type="checkbox" checked={on} onChange={() => togglePart(c.value)} aria-invalid={prefError || undefined}
                      style={{ margin: 0, accentColor: ORANGE }} />
                    {t(`estimates.cat_${c.value}`, c.label)}
                  </label>
                );
              })}
            </div>
            {prefError
              ? <span id="enq-parts-note" role="alert" style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c' }}>
                  {t('enquiries.parts_required', 'Tick at least one — ask the customer which parts they accept.')}
                </span>
              : <span id="enq-parts-note" style={{ fontSize: 11, color: '#94a3b8' }}>
                  {t('enquiries.parts_hint', 'Any combination. Goes on the work order; the estimate starts from it.')}
                </span>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Quoted amount"><input style={st.input} type="number" min="0" step="0.01" value={f.quoted_amount} onChange={e => set('quoted_amount', e.target.value)} placeholder="0.00" /></Field>
            <Field label="Follow-up date"><input style={st.input} type="datetime-local" value={f.follow_up_at} onChange={e => set('follow_up_at', e.target.value)} /></Field>
          </div>

          {isEdit && (
            <Field label="Status">
              <select style={st.input} value={f.status} onChange={e => set('status', e.target.value)}>
                {/* "Lost" is not offered any more; an enquiry already lost still shows it. */}
                {Object.entries(STATUS_META).filter(([k]) => k !== 'lost' || enquiry?.status === 'lost')
                  .map(([k, m]) => <option key={k} value={k} disabled={k === 'converted' || k === 'lost'}>{m.label}</option>)}
              </select>
            </Field>
          )}

    </>
  );
}

export function EnquiryModal({ enquiry, customer = null, onClose, onSaved }) {
  const { t } = useTranslation();
  const isEdit = !!enquiry;
  const [f, setF] = useState(() => enquiryForm(enquiry, customer));
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // "Tick at least one" shows once a save was tried or the last box unticked.
  const [prefTouched, setPrefTouched] = useState(false);
  const prefRef = useRef(null);
  const prefError = prefTouched && f.parts_preference.length === 0;


  const submit = async () => {
    setPrefTouched(true);
    if (!f.contact_name.trim()) { setErr('Contact name is required.'); return; }
    if (!String(f.contact_phone || '').trim() && !String(f.contact_email || '').trim()) { setErr('A phone number or an e-mail is required.'); return; }
    if (!f.emirate) { setErr(t('enquiries.emirate_required', 'Select the emirate the customer is in — it decides which team the enquiry goes to.')); return; }
    const problem = enquiryProblem(f, t);
    if (problem) {
      if (!f.parts_preference.length) {
        // The error is under the boxes; bring them into view.
        setErr('');
        prefRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        prefRef.current?.querySelector('input')?.focus({ preventScroll: true });
      } else setErr(problem);
      return;
    }
    setSaving(true); setErr('');
    try {
      // Logged from a customer's record: it is that customer's enquiry.
      const payload = { ...enquiryPayload(f), ...(customer?.id && !isEdit ? { customer_id: customer.id } : {}) };
      const res = isEdit ? await api.put(`/enquiries/${enquiry.id}`, payload) : await api.post('/enquiries', payload);
      if (res.success) onSaved();
      else setErr(res.message || 'Could not save enquiry.');
    } catch { setErr('Network error saving enquiry.'); }
    finally { setSaving(false); }
  };


  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>{isEdit ? `Enquiry ${enquiry.enquiry_number || ''}` : customer ? `New enquiry · ${customer.full_name}` : 'New Enquiry'}</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <div style={st.errorBar}>{err}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Contact name *"><input style={st.input} value={f.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="Full name" /></Field>
            <Field label="Phone"><input style={st.input} value={f.contact_phone || ''} onChange={e => set('contact_phone', e.target.value)} placeholder="+971 50 000 0000" /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Email"><input style={st.input} value={f.contact_email} onChange={e => set('contact_email', e.target.value)} placeholder="Optional" /></Field>
            <Field label={`${t('enquiries.emirate_label', 'Emirate')} *`} hint={t('enquiries.emirate_hint', 'Where the customer is — the enquiry goes to that team')}>
              <select style={st.input} value={f.emirate} onChange={e => set('emirate', e.target.value)}>
                <option value="">{t('enquiries.select_emirate', 'Select emirate…')}</option>
                {EMIRATES.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </Field>
          </div>
          <EnquiryDetails f={f} setF={setF} prefError={prefError} onPart={() => setPrefTouched(true)} prefRef={prefRef} isEdit={isEdit} enquiry={enquiry} />
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Submit Work Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Convert to work order ── */
export function ConvertModal({ enquiry, onClose, onSaved }) {
  const { t } = useTranslation();
  // The work order opened with the enquiry, while it is open.
  const ownWo = enquiry.work_order_number && enquiry.work_order_status && !['cancelled', 'completed'].includes(enquiry.work_order_status)
    ? enquiry.work_order_number : null;
  const [createCustomer, setCreateCustomer] = useState(!enquiry.customer_id);
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setSaving(true); setErr('');
    try {
      const res = await api.post(`/enquiries/${enquiry.id}/convert`, {
        create_customer: createCustomer,
        scheduled_at: scheduledAt ? scheduledAt.replace('T', ' ') + ':00' : null,
      });
      if (res.success) onSaved();
      else setErr(res.message || 'Could not convert enquiry.');
    } catch { setErr('Network error converting enquiry.'); }
    finally { setSaving(false); }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={{ ...st.modal, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>Convert to work order</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <div style={st.errorBar}>{err}</div>}
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {enquiry.enquiry_number} · {enquiry.contact_name} · {enquiry.contact_phone}
          </div>
          {!enquiry.customer_id && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: '#334155', cursor: 'pointer' }}>
              <input type="checkbox" checked={createCustomer} onChange={e => setCreateCustomer(e.target.checked)} />
              Create a customer record from these contact details
            </label>
          )}
          <Field label="Scheduled drop-off"><input style={st.input} type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} /></Field>
          <div style={st.infoBox}>
            {ownWo
              ? t('enquiries.convert_own_wo', 'The customer goes ahead on this enquiry\'s work order {{wo}}: it keeps its service tier, payer route and source channel. An external customer\'s job card opens after the physical inspection.', { wo: ownWo })
              : 'The work order inherits this enquiry\'s service tier, payer route and source channel, so conversion stays attributable to the channel it came from.'}
          </div>
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Converting…' : ownWo ? t('enquiries.convert_confirm', 'Convert on {{wo}}', { wo: ownWo }) : 'Create work order'}
          </button>
        </div>
      </div>
    </div>
  );
}

const st = {
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: 'none',
    background: `linear-gradient(135deg,${ORANGE},#ea580c)`, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700,
    boxShadow: '0 4px 14px rgba(249,115,22,0.3)' },
  ghostBtn: { padding: '10px 18px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  smallBtn: { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
    background: '#fff', color: '#475569', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' },
  errorBar: { display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
    padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 6, fontWeight: 500 },
  infoBox: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#64748b', lineHeight: 1.5 },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '0 12px', background: '#fff', flex: 1, minWidth: 240 },
  searchInput: { border: 'none', outline: 'none', padding: '10px 0', fontSize: 14, width: '100%', background: 'transparent' },
  filterSelect: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, background: '#fff', color: '#334155', cursor: 'pointer' },
  th: { textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  td: { padding: '12px 16px', fontSize: 13.5, color: '#334155', verticalAlign: 'middle' },
  emptyCell: { textAlign: 'center', padding: '48px 16px', color: '#94a3b8', fontSize: 13.5 },
  pill: { display: 'inline-flex', alignItems: 'center', padding: '4px 11px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' },
  iconBtn: { width: 30, height: 30, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569', flexShrink: 0 },
  // Border in parts, not the shorthand: the ticked / error states swap borderColor alone.
  checkChip: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10,
    borderWidth: 1.5, borderStyle: 'solid', borderColor: '#e2e8f0',
    background: '#fff', color: '#334155', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, userSelect: 'none' },
  checkChipOn: { borderColor: ORANGE, background: '#fff7ed', color: '#c2410c' },
  // z-index must clear the sidebar (1065) and topbar (1060) in Layout.css.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 },
  modal: { background: '#fff', borderRadius: 20, width: '100%', maxWidth: 620, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,0.28)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 14px' },
  closeBtn: { background: '#f1f5f9', border: 'none', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569' },
  input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none', color: '#1e293b', background: '#fff', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #f1f5f9' },
};
