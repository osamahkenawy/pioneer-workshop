import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search, Plus, Xmark, WarningTriangle, CheckCircle, Phone, Clock,
  StatsUpSquare, Group, ArrowRight, EditPencil, Trash, Calendar,
} from 'iconoir-react';
import api from '../lib/api';

/**
 * Enquiries — journey stages 01-02.
 *
 * The CX journey map flags the enquiry log as a gap handled manually today.
 * Every enquiry records the channel it arrived through, so conversion can be
 * measured by source; ones that don't convert record a reason and an optional
 * re-offer date, which is the nurture loop drawn back to stage 01.
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
const CONTACT_METHODS = { phone: 'Phone', whatsapp: 'WhatsApp', website_form: 'Website form', walk_in: 'Walk-in', partner_handoff: 'Partner hand-off', email: 'Email' };
const ENQUIRY_TYPES = { service: 'Service', repair: 'Repair', diagnostic: 'Diagnostic', bodywork: 'Bodywork', accident: 'Accident', other: 'Other' };
const LOST_REASONS = { price: 'Price', timing: 'Timing / lead time', location: 'Location', went_elsewhere: 'Went elsewhere', no_response: 'No response', not_needed: 'No longer needed', other: 'Other' };

const fmt = (n, cur = 'AED') => `${cur} ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(String(d).replace(' ', 'T')).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

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

export default function Enquiries() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [dueOnly, setDueOnly] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [lostFor, setLostFor] = useState(null);
  const [convertFor, setConvertFor] = useState(null);

  const fetchRows = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (statusFilter) p.set('status', statusFilter);
      if (channelFilter) p.set('source_channel', channelFilter);
      if (search.trim()) p.set('search', search.trim());
      if (dueOnly) p.set('due', 'true');
      const qs = p.toString();
      const res = await api.get(`/enquiries${qs ? `?${qs}` : ''}`);
      if (res.success) setRows(res.data || []);
      else setError(res.message || 'Failed to load enquiries');
    } catch { setError('Network error loading enquiries'); }
  }, [statusFilter, channelFilter, search, dueOnly]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/enquiries/stats');
      if (res.success) setStats(res.data);
    } catch { /* stats are non-critical */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    await Promise.all([fetchRows(), fetchStats()]);
    setLoading(false);
  }, [fetchRows, fetchStats]);

  useEffect(() => { refresh(); }, [refresh]);

  const t = stats?.totals || {};
  const pending = (Number(t.new_count) || 0) + (Number(t.quoted) || 0);
  const conversionRate = useMemo(() => {
    const total = Number(t.total) || 0;
    const conv = Number(t.converted) || 0;
    return total > 0 ? Math.round((conv / total) * 100) : 0;
  }, [t]);

  const remove = async (row) => {
    if (!window.confirm(`Delete enquiry ${row.enquiry_number}?`)) return;
    try {
      const res = await api.delete(`/enquiries/${row.id}`);
      if (res.success) refresh();
      else setError(res.message || 'Could not delete enquiry');
    } catch { setError('Network error deleting enquiry'); }
  };

  return (
    <div style={{ padding: '0 0 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0 }}>Enquiries</h1>
          <p style={{ fontSize: 13.5, color: '#64748b', margin: '4px 0 0' }}>
            Every enquiry and where it came from — so conversion can be measured by channel
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} style={st.primaryBtn}>
          <Plus width={16} height={16} /> New Enquiry
        </button>
      </div>

      {error && (
        <div style={st.errorBar}>
          <WarningTriangle width={16} height={16} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>
            <Xmark width={14} height={14} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
        <KPICard icon={Group} label="Total enquiries" value={t.total ?? 0} color={NAVY} />
        <KPICard icon={Phone} label="Pending" value={pending} sub="New + Quoted" color="#B77900" />
        <KPICard icon={CheckCircle} label="Converted" value={t.converted ?? 0} sub={`${conversionRate}% conversion`} color="#16a34a" />
        <KPICard icon={Clock} label="In nurture" value={t.nurture ?? 0} sub="Re-offer scheduled" color="#7c3aed" />
      </div>

      {/* Conversion by channel — the reason source is captured at all */}
      {stats?.by_channel?.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: '16px 18px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
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
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Why enquiries didn't convert
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {stats.lost_reasons.map(r => (
                  <span key={r.lost_reason} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 20, padding: '5px 12px', fontSize: 12.5, color: '#475569' }}>
                    {LOST_REASONS[r.lost_reason] || r.lost_reason}
                    <strong style={{ marginLeft: 6, color: '#1e293b' }}>{r.count}</strong>
                    {Number(r.in_nurture) > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#7c3aed' }}>({r.in_nurture} in nurture)</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={st.searchWrap}>
          <Search width={16} height={16} style={{ color: '#94a3b8' }} />
          <input style={st.searchInput} placeholder="Search name, phone, enquiry no…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={st.filterSelect}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)} style={st.filterSelect}>
          <option value="">All channels</option>
          {Object.entries(CHANNELS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <button onClick={() => setDueOnly(v => !v)}
          style={{ ...st.filterSelect, cursor: 'pointer', fontWeight: 700,
            background: dueOnly ? '#fff7ed' : '#fff', color: dueOnly ? ORANGE : '#334155',
            borderColor: dueOnly ? ORANGE : '#e2e8f0' }}>
          Follow-ups due
        </button>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eef2f7' }}>
                {['Enquiry', 'Contact', 'Channel', 'Tier / payer', 'Quoted', 'Status', 'Follow-up', ''].map(h => (
                  <th key={h} style={st.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={st.emptyCell}>Loading enquiries…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} style={st.emptyCell}>
                  <Phone width={32} height={32} style={{ color: '#cbd5e1', marginBottom: 8 }} />
                  <div>No enquiries yet. Log one to start measuring conversion by channel.</div>
                </td></tr>
              )}
              {!loading && rows.map(r => {
                const ch = CHANNELS[r.source_channel] || { label: r.source_channel, color: '#64748b', bg: '#f1f5f9' };
                const sm = STATUS_META[r.status] || STATUS_META.new;
                const overdue = r.follow_up_at && new Date(String(r.follow_up_at).replace(' ', 'T')) <= new Date()
                  && ['new', 'quoted', 'nurture'].includes(r.status);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={st.td}>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{r.enquiry_number}</div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                        {ENQUIRY_TYPES[r.enquiry_type] || r.enquiry_type} · {CONTACT_METHODS[r.contact_method] || r.contact_method}
                      </div>
                    </td>
                    <td style={st.td}>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{r.contact_name}</div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{r.contact_phone}</div>
                    </td>
                    <td style={st.td}>
                      <span style={{ ...st.pill, background: ch.bg, color: ch.color }}>{ch.label}</span>
                      {r.source_detail && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{r.source_detail}</div>}
                    </td>
                    <td style={st.td}>
                      <div style={{ fontSize: 12.5 }}>{r.service_tier ? TIERS[r.service_tier] : '—'}</div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{PAYERS[r.payer_type] || r.payer_type}</div>
                    </td>
                    <td style={{ ...st.td, fontWeight: 700 }}>{r.quoted_amount != null ? fmt(r.quoted_amount) : '—'}</td>
                    <td style={st.td}>
                      <span style={{ ...st.pill, background: sm.bg, color: sm.color }}>{sm.label}</span>
                      {r.work_order_number && (
                        <div style={{ fontSize: 11, color: '#16a34a', marginTop: 3 }}>{r.work_order_number}</div>
                      )}
                      {r.lost_reason && r.status !== 'converted' && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{LOST_REASONS[r.lost_reason] || r.lost_reason}</div>
                      )}
                    </td>
                    <td style={st.td}>
                      {r.follow_up_at ? (
                        <span style={{ fontSize: 12.5, fontWeight: overdue ? 700 : 500, color: overdue ? '#dc2626' : '#475569' }}>
                          {fmtDate(r.follow_up_at)}{overdue ? ' · due' : ''}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={st.td}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {r.status !== 'converted' && (
                          <>
                            <button onClick={() => setConvertFor(r)} style={{ ...st.smallBtn, background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0' }} title="Convert to work order">
                              <ArrowRight width={13} height={13} /> Convert
                            </button>
                            <button onClick={() => setLostFor(r)} style={{ ...st.smallBtn }} title="Record why it didn't convert">
                              Not converted
                            </button>
                          </>
                        )}
                        <button onClick={() => { setEditing(r); setShowForm(true); }} style={st.iconBtn} title="Edit">
                          <EditPencil width={14} height={14} />
                        </button>
                        <button onClick={() => remove(r)}
                          style={{ ...st.iconBtn, color: r.converted_work_order_id ? '#cbd5e1' : '#dc2626', cursor: r.converted_work_order_id ? 'not-allowed' : 'pointer' }}
                          title={r.converted_work_order_id ? 'Converted enquiries cannot be deleted' : 'Delete'}>
                          <Trash width={14} height={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <EnquiryModal
          enquiry={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}
      {lostFor && (
        <NotConvertedModal enquiry={lostFor} onClose={() => setLostFor(null)} onSaved={() => { setLostFor(null); refresh(); }} />
      )}
      {convertFor && (
        <ConvertModal enquiry={convertFor} onClose={() => setConvertFor(null)} onSaved={() => { setConvertFor(null); refresh(); }} />
      )}
    </div>
  );
}

/* ── Create / edit enquiry ── */
function EnquiryModal({ enquiry, onClose, onSaved }) {
  const isEdit = !!enquiry;
  const [f, setF] = useState({
    contact_name: enquiry?.contact_name || '',
    contact_phone: enquiry?.contact_phone || '',
    contact_email: enquiry?.contact_email || '',
    vehicle_description: enquiry?.vehicle_description || '',
    enquiry_type: enquiry?.enquiry_type || 'service',
    service_tier: enquiry?.service_tier || '',
    description: enquiry?.description || '',
    quoted_amount: enquiry?.quoted_amount ?? '',
    source_channel: enquiry?.source_channel || '',
    source_detail: enquiry?.source_detail || '',
    referred_by: enquiry?.referred_by || '',
    contact_method: enquiry?.contact_method || 'phone',
    payer_type: enquiry?.payer_type || 'self_pay',
    status: enquiry?.status || 'new',
    follow_up_at: enquiry?.follow_up_at ? String(enquiry.follow_up_at).replace(' ', 'T').slice(0, 16) : '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!f.contact_name.trim()) { setErr('Contact name is required.'); return; }
    if (!f.contact_phone.trim()) { setErr('Contact phone is required.'); return; }
    if (!f.source_channel) { setErr('Select how this enquiry reached you — it is what makes conversion measurable.'); return; }
    setSaving(true); setErr('');
    try {
      const payload = {
        ...f,
        quoted_amount: f.quoted_amount === '' ? null : Number(f.quoted_amount),
        service_tier: f.service_tier || null,
        follow_up_at: f.follow_up_at ? f.follow_up_at.replace('T', ' ') + ':00' : null,
      };
      const res = isEdit ? await api.put(`/enquiries/${enquiry.id}`, payload) : await api.post('/enquiries', payload);
      if (res.success) onSaved();
      else setErr(res.message || 'Could not save enquiry.');
    } catch { setErr('Network error saving enquiry.'); }
    finally { setSaving(false); }
  };

  const details = SOURCE_DETAILS[f.source_channel] || [];

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>{isEdit ? 'Edit Enquiry' : 'New Enquiry'}</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <div style={st.errorBar}>{err}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Contact name *"><input style={st.input} value={f.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="Full name" /></Field>
            <Field label="Phone *"><input style={st.input} value={f.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="+971 50 000 0000" /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Email"><input style={st.input} value={f.contact_email} onChange={e => set('contact_email', e.target.value)} placeholder="Optional" /></Field>
            <Field label="Vehicle"><input style={st.input} value={f.vehicle_description} onChange={e => set('vehicle_description', e.target.value)} placeholder="e.g. Toyota Camry 2021, A 12345" /></Field>
          </div>

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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Enquiry type">
              <select style={st.input} value={f.enquiry_type} onChange={e => set('enquiry_type', e.target.value)}>
                {Object.entries(ENQUIRY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
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

          <Field label="What they asked for"><input style={st.input} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Reported symptom or requested service" /></Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Quoted amount"><input style={st.input} type="number" min="0" step="0.01" value={f.quoted_amount} onChange={e => set('quoted_amount', e.target.value)} placeholder="0.00" /></Field>
            <Field label="Follow-up date"><input style={st.input} type="datetime-local" value={f.follow_up_at} onChange={e => set('follow_up_at', e.target.value)} /></Field>
          </div>

          {isEdit && (
            <Field label="Status">
              <select style={st.input} value={f.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k} disabled={k === 'converted'}>{m.label}</option>)}
              </select>
            </Field>
          )}
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Log Enquiry'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Not converted — reason + optional re-offer ── */
function NotConvertedModal({ enquiry, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!reason) { setErr('Select a reason — this is what makes lost demand analysable.'); return; }
    setSaving(true); setErr('');
    try {
      const res = await api.post(`/enquiries/${enquiry.id}/lost`, {
        lost_reason: reason, lost_notes: notes || null,
        follow_up_at: followUp ? followUp.replace('T', ' ') + ':00' : null,
      });
      if (res.success) onSaved();
      else setErr(res.message || 'Could not save.');
    } catch { setErr('Network error.'); }
    finally { setSaving(false); }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={{ ...st.modal, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY }}>Not converted</h2>
          <button onClick={onClose} style={st.closeBtn}><Xmark width={18} height={18} /></button>
        </div>
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <div style={st.errorBar}>{err}</div>}
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {enquiry.enquiry_number} · {enquiry.contact_name}
          </div>
          <Field label="Reason *">
            <select style={st.input} value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Select a reason…</option>
              {Object.entries(LOST_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Notes"><input style={st.input} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional detail" /></Field>
          <Field label="Schedule a re-offer" hint="Set a date to keep this in nurture rather than closing it as lost">
            <input style={st.input} type="datetime-local" value={followUp} onChange={e => setFollowUp(e.target.value)} />
          </Field>
          <div style={st.infoBox}>
            {followUp
              ? 'This enquiry will be kept in nurture and resurfaced on the follow-up date.'
              : 'Without a re-offer date this enquiry will be closed as lost.'}
          </div>
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Record outcome'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Convert to work order ── */
function ConvertModal({ enquiry, onClose, onSaved }) {
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
            The work order inherits this enquiry's service tier, payer route and source channel,
            so conversion stays attributable to the channel it came from.
          </div>
        </div>
        <div style={st.footer}>
          <button onClick={onClose} style={st.ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...st.primaryBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Converting…' : 'Create work order'}
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
  // z-index must clear the sidebar (1065) and topbar (1060) in Layout.css.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 },
  modal: { background: '#fff', borderRadius: 20, width: '100%', maxWidth: 620, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,0.28)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 14px' },
  closeBtn: { background: '#f1f5f9', border: 'none', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569' },
  input: { border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none', color: '#1e293b', background: '#fff', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #f1f5f9' },
};
