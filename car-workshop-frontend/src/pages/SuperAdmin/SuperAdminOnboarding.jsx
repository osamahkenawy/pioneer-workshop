import { useState, useEffect } from 'react';
import {
  Building, User, CheckCircle, ArrowRight, ArrowLeft,
  Palette, Box, CreditCard, Mail, WarningTriangle, Check, Rocket,
} from 'iconoir-react';
import './SuperAdmin.css';
import './SuperAdminModern.css';

const API = import.meta.env.VITE_API_URL || '/api';
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('superAdminToken')}`, 'Content-Type': 'application/json' });

const STEPS = [
  { key: 'company', label: 'Company Info', icon: Building },
  { key: 'plan', label: 'Plan & Billing', icon: CreditCard },
  { key: 'modules', label: 'Modules', icon: Box },
  { key: 'admin', label: 'Admin Account', icon: User },
  { key: 'branding', label: 'Branding', icon: Palette },
  { key: 'review', label: 'Review & Create', icon: CheckCircle },
];

const FONT_OPTIONS = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Poppins', 'Nunito', 'Montserrat'];

const SuperAdminOnboarding = () => {
  const [step, setStep] = useState(0);
  const [plans, setPlans] = useState([]);
  const [availableModules, setAvailableModules] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const [form, setForm] = useState({
    // Company
    name: '', domain: '', email: '', phone: '',
    // Plan
    plan_id: '', billing_cycle: 'monthly', max_users: 10,
    // Modules
    modules: [],
    // Admin
    admin_name: '', admin_email: '', admin_password: '', send_welcome_email: true,
    // Branding
    primary_color: '#f97316', secondary_color: '#1e293b', accent_color: '#3b82f6',
    sidebar_color: '#1e293b', font_family: 'Inter', logo_url: '', favicon_url: ''
  });

  useEffect(() => {
    // Fetch plans — endpoint returns plain array
    fetch(`${API}/super-admin/plans`, { headers: headers() })
      .then(r => r.json())
      .then(d => setPlans(Array.isArray(d) ? d : (d.plans || [])))
      .catch(() => {});
    // Fetch available modules — endpoint returns plain array, not { modules: [...] }
    fetch(`${API}/super-admin/modules`, { headers: headers() })
      .then(r => r.json())
      .then(d => {
        const mods = Array.isArray(d) ? d : (d.modules || d.availableModules || []);
        setAvailableModules(mods);
      })
      .catch(() => {});
  }, []);

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const toggleModule = (mod) => {
    setForm(f => ({
      ...f,
      modules: f.modules.includes(mod) ? f.modules.filter(m => m !== mod) : [...f.modules, mod]
    }));
  };

  const canNext = () => {
    if (step === 0) return form.name && form.email;
    if (step === 3) return form.admin_name && form.admin_email && form.admin_password;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body = {
        company: { name: form.name, domain: form.domain, email: form.email, phone: form.phone },
        plan: { plan_id: form.plan_id || undefined, billing_cycle: form.billing_cycle, max_users: form.max_users },
        modules: form.modules,
        admin: { name: form.admin_name, email: form.admin_email, password: form.admin_password, send_welcome_email: form.send_welcome_email },
        branding: {
          primary_color: form.primary_color, secondary_color: form.secondary_color,
          accent_color: form.accent_color, sidebar_color: form.sidebar_color,
          font_family: form.font_family, logo_url: form.logo_url, favicon_url: form.favicon_url
        }
      };
      const res = await fetch(`${API}/super-admin/onboard-workshop`, {
        method: 'POST', headers: headers(), body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, data });
      } else {
        setResult({ success: false, message: data.error || 'Failed to onboard workshop' });
      }
    } catch (e) {
      setResult({ success: false, message: e.message });
    }
    setSubmitting(false);
  };

  if (result) {
    return (
      <div className="sa-page">
        <div className="sa-page-header"><div><h1>Workshop Onboarding</h1></div></div>
        <div className="sa-card" style={{ padding: 48, textAlign: 'center' }}>
          {result.success ? (
            <>
              <CheckCircle size={64} style={{ color: '#22c55e', marginBottom: 16 }} />
              <h2 style={{ color: '#22c55e', margin: '0 0 8px' }}>Workshop Created Successfully!</h2>
              <p style={{ color: '#6b7280', marginBottom: 24 }}>
                <strong>{form.name}</strong> has been onboarded with admin <strong>{form.admin_email}</strong>
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="sa-primary-btn" onClick={() => { setResult(null); setStep(0); setForm({ name: '', domain: '', email: '', phone: '', plan_id: '', billing_cycle: 'monthly', max_users: 10, modules: [], admin_name: '', admin_email: '', admin_password: '', send_welcome_email: true, primary_color: '#f97316', secondary_color: '#1e293b', accent_color: '#3b82f6', sidebar_color: '#1e293b', font_family: 'Inter', logo_url: '', favicon_url: '' }); }}>
                  Onboard Another
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 64, marginBottom: 16 }}><WarningTriangle width={64} height={64} style={{ color: '#ef4444' }} /></div>
              <h2 style={{ color: '#ef4444', margin: '0 0 8px' }}>Onboarding Failed</h2>
              <p style={{ color: '#6b7280', marginBottom: 24 }}>{result.message}</p>
              <button className="sa-secondary-btn" onClick={() => setResult(null)}>Try Again</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>Workshop Onboarding Wizard</h1>
          <p>Set up a new workshop with everything they need in one go</p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="sa-card" style={{ padding: '16px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <div
                  onClick={() => i < step && setStep(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, cursor: done ? 'pointer' : 'default',
                    opacity: active ? 1 : done ? 0.8 : 0.4
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: done ? '#22c55e' : active ? '#f97316' : '#e5e7eb',
                    color: done || active ? '#fff' : '#9ca3af'
                  }}>
                    {done ? <CheckCircle size={18} /> : <Icon size={18} />}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: done ? '#22c55e' : '#e5e7eb', margin: '0 8px' }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="sa-card" style={{ padding: 24, minHeight: 360 }}>
        {step === 0 && (
          <>
            <h3 style={{ margin: '0 0 20px' }}>Company Information</h3>
            <div className="sa-form-grid">
              <div className="sa-form-group">
                <label>Company Name *</label>
                <input value={form.name} onChange={e => update('name', e.target.value)} placeholder="Acme Corp" />
              </div>
              <div className="sa-form-group">
                <label>Domain / Subdomain</label>
                <input value={form.domain} onChange={e => update('domain', e.target.value)} placeholder="acme.pioneercarservice.com" />
              </div>
              <div className="sa-form-group">
                <label>Contact Email *</label>
                <input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="info@acme.com" />
              </div>
              <div className="sa-form-group">
                <label>Phone</label>
                <input value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="+1 (555) 000-0000" />
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h3 style={{ margin: '0 0 20px' }}>Plan & Billing</h3>
            {plans.length > 0 ? (
              <div className="sa-plans-grid">
                {plans.map(p => (
                  <div key={p.id} className={`sa-plan-card ${form.plan_id == p.id ? 'selected' : ''}`}
                    onClick={() => update('plan_id', p.id)} style={{ cursor: 'pointer', border: form.plan_id == p.id ? '2px solid #f97316' : '2px solid transparent' }}>
                    <div className="sa-plan-header"><h4 style={{ margin: 0 }}>{p.name}</h4></div>
                    <div className="sa-plan-price">${p.price_monthly}<span style={{ fontSize: 14, color: '#6b7280' }}>/mo</span></div>
                    <div className="sa-plan-limits">
                      <span>Max Users: {p.max_users || '∞'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#6b7280' }}>No plans found. The workshop will use default settings.</p>
            )}
            <div className="sa-form-grid" style={{ marginTop: 20 }}>
              <div className="sa-form-group">
                <label>Billing Cycle</label>
                <select value={form.billing_cycle} onChange={e => update('billing_cycle', e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div className="sa-form-group">
                <label>Max Users</label>
                <input type="number" value={form.max_users} onChange={e => update('max_users', parseInt(e.target.value) || 1)} min={1} />
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h3 style={{ margin: '0 0 4px' }}>Select Modules</h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>Choose which modules this workshop can access</p>
            {availableModules.length > 0 ? (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button className="sa-secondary-btn" style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={() => setForm(f => ({ ...f, modules: availableModules.map(m => m.id || m) }))}>
                    Select All
                  </button>
                  <button className="sa-secondary-btn" style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={() => setForm(f => ({ ...f, modules: [] }))}>
                    Clear All
                  </button>
                </div>
                {/* Group by category */}
                {Object.entries(
                  availableModules.reduce((acc, m) => {
                    const cat = m.category || 'Other';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(m);
                    return acc;
                  }, {})
                ).map(([category, mods]) => (
                  <div key={category} style={{ marginBottom: 16 }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>{category}</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {mods.map(m => {
                        const moduleId = m.id || (typeof m === 'string' ? m : m.key || m.name);
                        const moduleName = m.name || moduleId;
                        const selected = form.modules.includes(moduleId);
                        return (
                          <button key={moduleId} onClick={() => toggleModule(moduleId)} style={{
                            padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                            border: selected ? '2px solid #f97316' : '2px solid #e5e7eb',
                            background: selected ? '#fff7ed' : '#fff', color: selected ? '#f97316' : '#374151',
                            fontWeight: selected ? 600 : 400, transition: 'all 0.15s'
                          }}>
                            {selected ? <><Check width={13} height={13} /> </> : ''}{moduleName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="sa-empty-state">
                <p>No modules available. Check that the backend is running.</p>
              </div>
            )}
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 12 }}>
              <strong>{form.modules.length}</strong> of {availableModules.length} module(s) selected
            </p>
          </>
        )}

        {step === 3 && (
          <>
            <h3 style={{ margin: '0 0 20px' }}>Admin Account</h3>
            <div className="sa-form-grid">
              <div className="sa-form-group">
                <label>Admin Name *</label>
                <input value={form.admin_name} onChange={e => update('admin_name', e.target.value)} placeholder="John Doe" />
              </div>
              <div className="sa-form-group">
                <label>Admin Email *</label>
                <input type="email" value={form.admin_email} onChange={e => update('admin_email', e.target.value)} placeholder="admin@acme.com" />
              </div>
              <div className="sa-form-group">
                <label>Password *</label>
                <input type="password" value={form.admin_password} onChange={e => update('admin_password', e.target.value)} placeholder="Min 8 characters" />
              </div>
              <div className="sa-form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 28 }}>
                <input type="checkbox" checked={form.send_welcome_email} onChange={e => update('send_welcome_email', e.target.checked)} id="send_welcome" />
                <label htmlFor="send_welcome" style={{ cursor: 'pointer', margin: 0 }}>
                  <Mail size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Send welcome email
                </label>
              </div>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h3 style={{ margin: '0 0 20px' }}>Branding (Optional)</h3>
            <div style={{
              background: `linear-gradient(135deg, ${form.primary_color} 0%, ${form.secondary_color} 100%)`,
              borderRadius: 12, padding: 20, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <span style={{ color: '#fff', fontWeight: 700, fontFamily: form.font_family }}>{form.name || 'Preview'}</span>
              <div style={{ background: form.accent_color, color: '#fff', padding: '6px 14px', borderRadius: 8, fontSize: 13 }}>Button</div>
            </div>
            <div className="sa-form-grid">
              {['primary_color', 'secondary_color', 'accent_color', 'sidebar_color'].map(key => (
                <div className="sa-form-group" key={key}>
                  <label>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={form[key]} onChange={e => update(key, e.target.value)} style={{ width: 40, height: 36, padding: 2, cursor: 'pointer' }} />
                    <input value={form[key]} onChange={e => update(key, e.target.value)} style={{ flex: 1 }} />
                  </div>
                </div>
              ))}
              <div className="sa-form-group">
                <label>Font Family</label>
                <select value={form.font_family} onChange={e => update('font_family', e.target.value)}>
                  {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="sa-form-group">
                <label>Logo URL</label>
                <input value={form.logo_url} onChange={e => update('logo_url', e.target.value)} placeholder="https://..." />
              </div>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h3 style={{ margin: '0 0 20px' }}>Review & Confirm</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="sa-card" style={{ padding: 16 }}>
                <h4 style={{ margin: '0 0 8px', color: '#f97316' }}><Building size={16} style={{ verticalAlign: 'middle' }} /> Company</h4>
                <p style={{ margin: '4px 0', fontSize: 14 }}><strong>{form.name}</strong></p>
                <p style={{ margin: '4px 0', fontSize: 13, color: '#6b7280' }}>{form.email}</p>
                {form.domain && <p style={{ margin: '4px 0', fontSize: 13, color: '#6b7280' }}>{form.domain}</p>}
              </div>
              <div className="sa-card" style={{ padding: 16 }}>
                <h4 style={{ margin: '0 0 8px', color: '#f97316' }}><CreditCard size={16} style={{ verticalAlign: 'middle' }} /> Plan</h4>
                <p style={{ margin: '4px 0', fontSize: 14 }}><strong>{(Array.isArray(plans) ? plans : []).find(p => p.id == form.plan_id)?.name || 'Default'}</strong></p>
                <p style={{ margin: '4px 0', fontSize: 13, color: '#6b7280' }}>{form.billing_cycle} · {form.max_users} users</p>
              </div>
              <div className="sa-card" style={{ padding: 16 }}>
                <h4 style={{ margin: '0 0 8px', color: '#f97316' }}><Box size={16} style={{ verticalAlign: 'middle' }} /> Modules ({form.modules.length})</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {form.modules.map(m => {
                    const mod = availableModules.find(am => am.id === m);
                    return (
                      <span key={m} style={{ background: '#fff7ed', color: '#f97316', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                        {mod?.name || m.replace(/_/g, ' ')}
                      </span>
                    );
                  })}
                  {form.modules.length === 0 && <span style={{ color: '#6b7280', fontSize: 13 }}>None selected</span>}
                </div>
              </div>
              <div className="sa-card" style={{ padding: 16 }}>
                <h4 style={{ margin: '0 0 8px', color: '#f97316' }}><User size={16} style={{ verticalAlign: 'middle' }} /> Admin</h4>
                <p style={{ margin: '4px 0', fontSize: 14 }}><strong>{form.admin_name}</strong></p>
                <p style={{ margin: '4px 0', fontSize: 13, color: '#6b7280' }}>{form.admin_email}</p>
                {form.send_welcome_email && <p style={{ margin: '4px 0', fontSize: 12, color: '#22c55e' }}><Mail width={12} height={12} /> Welcome email will be sent</p>}
              </div>
            </div>
            {(form.primary_color !== '#f97316' || form.logo_url) && (
              <div className="sa-card" style={{ padding: 16, marginTop: 16 }}>
                <h4 style={{ margin: '0 0 8px', color: '#f97316' }}><Palette size={16} style={{ verticalAlign: 'middle' }} /> Branding</h4>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {[form.primary_color, form.secondary_color, form.accent_color].map((c, i) => (
                    <div key={i} style={{ width: 24, height: 24, borderRadius: 6, background: c, border: '2px solid #e5e7eb' }} />
                  ))}
                  <span style={{ fontSize: 13, color: '#6b7280', marginLeft: 8 }}>{form.font_family}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <button className="sa-secondary-btn" onClick={() => setStep(s => s - 1)} disabled={step === 0} style={{ opacity: step === 0 ? 0.4 : 1 }}>
          <ArrowLeft size={16} /> Previous
        </button>
        {step < STEPS.length - 1 ? (
          <button className="sa-primary-btn" onClick={() => setStep(s => s + 1)} disabled={!canNext()}>
            Next <ArrowRight size={16} />
          </button>
        ) : (
          <button className="sa-primary-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating...' : <><Rocket width={16} height={16} /> Create Workshop</>}
          </button>
        )}
      </div>
    </div>
  );
};

export default SuperAdminOnboarding;
