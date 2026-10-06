/* ══════════════════════════════════════════════════════════════
 * CustomerCreateOrder.jsx — Book a new work order for one of the
 * customer's own vehicles. Replaces the old sender/recipient/parcel
 * delivery form — a workshop job is: my vehicle + what's wrong +
 * when I can bring it in.
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { CustomerAuthContext } from '../../context/CustomerAuthContext';
import { Plus, ArrowLeft, Car, Wrench, CreditCard, CheckCircle } from 'iconoir-react';
import api from '../../lib/customerApi';
import './CustomerPages.css';

const SERVICE_CATEGORIES = [
  { value: 'general_maintenance', label: 'General maintenance' },
  { value: 'oil_change', label: 'Oil change' },
  { value: 'brake_repair', label: 'Brake repair' },
  { value: 'diagnostic', label: 'Diagnostic' },
  { value: 'bodywork', label: 'Bodywork' },
  { value: 'tire_service', label: 'Tire service' },
  { value: 'engine_repair', label: 'Engine repair' },
  { value: 'transmission', label: 'Transmission' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'other', label: 'Other' },
];

export default function CustomerCreateOrder() {
  const { workshop } = useContext(CustomerAuthContext);
  const cur = workshop?.currency || 'AED';
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  const [vehicles, setVehicles] = useState([]);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ make: '', model: '', year: '', plate_number: '', vin: '', color: '' });

  const [form, setForm] = useState({
    vehicle_id: '',
    work_order_type: 'standard',
    service_category: 'general_maintenance',
    payment_method: 'cash', cash_amount: '', service_fee: '',
    description: '', special_instructions: '', notes: '',
    scheduled_at: '', dropoff_address: '',
  });

  // Load this customer's vehicles
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/customer-portal/vehicles');
        if (res.success) setVehicles(res.data || []);
      } catch { /* */ }
    })();
  }, []);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addVehicle = async () => {
    if (!newVehicle.make.trim() || !newVehicle.model.trim()) { setError('Vehicle make and model are required.'); return; }
    try {
      const res = await api.post('/customer-portal/vehicles', newVehicle);
      if (res.success) {
        setVehicles(v => [res.data, ...v]);
        setForm(f => ({ ...f, vehicle_id: String(res.data.id) }));
        setAddingVehicle(false);
        setNewVehicle({ make: '', model: '', year: '', plate_number: '', vin: '', color: '' });
      } else {
        setError(res.message || 'Could not add vehicle.');
      }
    } catch { setError('Network error adding vehicle.'); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.vehicle_id) { setError('Select a vehicle for this work order.'); return; }
    if (!form.description.trim()) { setError('Describe the issue or service requested.'); return; }
    setLoading(true);
    try {
      const body = {
        ...form,
        vehicle_id: parseInt(form.vehicle_id),
        cash_amount: parseFloat(form.cash_amount) || 0,
        service_fee: parseFloat(form.service_fee) || 0,
        scheduled_at: form.scheduled_at || null,
      };

      const res = await api.post('/customer-portal/work-orders', body);
      if (res.success) {
        setSuccess(res.data);
      } else {
        setError(res.message || 'Failed to create work order');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="cp-page">
        <div className="cp-success-page">
          <div className="cp-success-icon-lg"><CheckCircle width={44} height={44} /></div>
          <h2>Work Order Created Successfully!</h2>
          <p className="cp-detail-sub">Work Order Number: <strong>{success.work_order_number}</strong></p>
          <p className="cp-detail-sub">Tracking: <strong>{success.service_status_token}</strong></p>
          <div style={{ display: 'flex', gap: 14, marginTop: 24, justifyContent: 'center' }}>
            <button className="cp-btn cp-btn-primary" onClick={() => navigate(`/merchant/work-orders/${success.id}`)}>View Work Order</button>
            <button className="cp-btn cp-btn-outline" onClick={() => { setSuccess(null); setForm(f => ({ ...f, description: '', special_instructions: '', notes: '', cash_amount: '' })); }}>Create Another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cp-page">
      <div className="cp-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="cp-back-btn" onClick={() => navigate('/merchant/work-orders')}><ArrowLeft width={18} height={18} /></button>
          <div>
            <h1 className="cp-page-title" style={{ margin: 0, fontSize: 24 }}>
              <Wrench width={24} height={24} style={{ color: '#f97316' }} /> Book a Service
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, color: '#64748b', fontWeight: 500 }}>Tell us about your vehicle and what needs attention</p>
          </div>
        </div>
      </div>

      {error && <div className="ca-alert ca-alert-error" style={{ marginBottom: 20, borderRadius: 14, padding: '12px 18px' }}>{error}</div>}

      <form className="cp-create-form" onSubmit={handleSubmit}>
        {/* Vehicle Section */}
        <div className="cp-form-section">
          <h3 className="cp-form-section-title"><Car width={20} height={20} /> Vehicle</h3>
          {!addingVehicle ? (
            <>
              {vehicles.length > 0 ? (
                <div style={{ marginBottom: 12 }}>
                  <label className="cp-form-label">Select a vehicle *</label>
                  <select className="cp-form-input" value={form.vehicle_id} onChange={e => update('vehicle_id', e.target.value)} required>
                    <option value="">-- Select vehicle --</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>{v.make} {v.model} {v.year ? `(${v.year})` : ''} {v.plate_number ? `— ${v.plate_number}` : ''}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="cp-detail-sub" style={{ marginBottom: 12 }}>You haven't added any vehicles yet.</p>
              )}
              <button type="button" className="cp-btn cp-btn-outline" onClick={() => setAddingVehicle(true)}>
                <Plus width={16} height={16} /> Add a vehicle
              </button>
            </>
          ) : (
            <>
              <div className="cp-form-grid-3">
                <div>
                  <label className="cp-form-label">Make *</label>
                  <input className="cp-form-input" value={newVehicle.make} onChange={e => setNewVehicle(v => ({ ...v, make: e.target.value }))} placeholder="Toyota" />
                </div>
                <div>
                  <label className="cp-form-label">Model *</label>
                  <input className="cp-form-input" value={newVehicle.model} onChange={e => setNewVehicle(v => ({ ...v, model: e.target.value }))} placeholder="Corolla" />
                </div>
                <div>
                  <label className="cp-form-label">Year</label>
                  <input className="cp-form-input" value={newVehicle.year} onChange={e => setNewVehicle(v => ({ ...v, year: e.target.value }))} placeholder="2021" />
                </div>
                <div>
                  <label className="cp-form-label">Plate number</label>
                  <input className="cp-form-input" value={newVehicle.plate_number} onChange={e => setNewVehicle(v => ({ ...v, plate_number: e.target.value }))} placeholder="A 12345" />
                </div>
                <div>
                  <label className="cp-form-label">Color</label>
                  <input className="cp-form-input" value={newVehicle.color} onChange={e => setNewVehicle(v => ({ ...v, color: e.target.value }))} placeholder="Black" />
                </div>
                <div>
                  <label className="cp-form-label">VIN</label>
                  <input className="cp-form-input" value={newVehicle.vin} onChange={e => setNewVehicle(v => ({ ...v, vin: e.target.value }))} placeholder="Optional" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button type="button" className="cp-btn cp-btn-primary" onClick={addVehicle}>Save Vehicle</button>
                <button type="button" className="cp-btn cp-btn-outline" onClick={() => setAddingVehicle(false)}>Cancel</button>
              </div>
            </>
          )}
        </div>

        {/* Service Details */}
        <div className="cp-form-section">
          <h3 className="cp-form-section-title"><Wrench width={20} height={20} /> Service Details</h3>
          <div className="cp-form-grid-3">
            <div>
              <label className="cp-form-label">Job type</label>
              <select className="cp-form-input" value={form.work_order_type} onChange={e => update('work_order_type', e.target.value)}>
                <option value="standard">Standard</option>
                <option value="express">Express</option>
                <option value="same_day">Same Day</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>
            <div>
              <label className="cp-form-label">Service category</label>
              <select className="cp-form-input" value={form.service_category} onChange={e => update('service_category', e.target.value)}>
                {SERVICE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="cp-form-label">Preferred drop-off time</label>
              <input className="cp-form-input" type="datetime-local" value={form.scheduled_at} onChange={e => update('scheduled_at', e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <label className="cp-form-label">What's wrong / what do you need? *</label>
            <input className="cp-form-input" value={form.description} onChange={e => update('description', e.target.value)} required
              placeholder="e.g. Grinding noise from front brakes" style={{ width: '100%' }} />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label className="cp-form-label">Drop-off address (if not at the workshop)</label>
            <input className="cp-form-input" value={form.dropoff_address} onChange={e => update('dropoff_address', e.target.value)} placeholder="Optional" style={{ width: '100%' }} />
          </div>
          <div>
            <label className="cp-form-label">Special instructions</label>
            <textarea className="cp-form-input cp-textarea" value={form.special_instructions} onChange={e => update('special_instructions', e.target.value)} placeholder="Anything else the mechanic should know..." style={{ width: '100%' }} />
          </div>
        </div>

        {/* Payment */}
        <div className="cp-form-section">
          <h3 className="cp-form-section-title"><CreditCard width={20} height={20} /> Payment</h3>
          <div className="cp-form-grid-3">
            <div>
              <label className="cp-form-label">Payment method</label>
              <select className="cp-form-input" value={form.payment_method} onChange={e => update('payment_method', e.target.value)}>
                <option value="cash">Cash</option>
                <option value="prepaid">Prepaid</option>
                <option value="credit">Credit</option>
              </select>
            </div>
            {form.payment_method === 'cash' && (
              <div>
                <label className="cp-form-label">Estimated amount ({cur})</label>
                <input className="cp-form-input" type="number" step="0.01" value={form.cash_amount} onChange={e => update('cash_amount', e.target.value)} placeholder="0.00" />
              </div>
            )}
            <div>
              <label className="cp-form-label">Service fee ({cur})</label>
              <input className="cp-form-input" type="number" step="0.01" value={form.service_fee} onChange={e => update('service_fee', e.target.value)} placeholder="0.00" />
            </div>
          </div>
        </div>

        <div className="cp-form-actions">
          <button type="button" className="cp-btn cp-btn-outline" onClick={() => navigate('/merchant/work-orders')}>Cancel</button>
          <button type="submit" className="cp-btn cp-btn-primary" disabled={loading}>
            {loading ? <span className="cp-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : <><Plus width={18} height={18} /> Create Work Order</>}
          </button>
        </div>
      </form>
    </div>
  );
}
