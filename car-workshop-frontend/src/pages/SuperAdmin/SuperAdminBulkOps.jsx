import { useState, useEffect } from 'react';
import {
  Building, CheckCircle, WarningTriangle, Refresh,
  Package, CreditCard, Trash, Play, Pause, Check,
} from 'iconoir-react';
import './SuperAdmin.css';

import { useConfirm } from './components';
const API = import.meta.env.VITE_API_URL || '/api';
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('superAdminToken')}`, 'Content-Type': 'application/json' });

const SuperAdminBulkOps = () => {
  const askConfirm = useConfirm();
  const [workshops, setWorkshops] = useState([]);
  const [selected, setSelected] = useState([]);
  const [operation, setOperation] = useState('');
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [modules, setModules] = useState([]);
  const [plans, setPlans] = useState([]);
  // Operation params
  const [bulkStatus, setBulkStatus] = useState('active');
  const [bulkModules, setBulkModules] = useState([]);
  const [moduleMode, setModuleMode] = useState('set');
  const [bulkPlanId, setBulkPlanId] = useState('');

  useEffect(() => {
    Promise.all([
      fetch(`${API}/super-admin/workshops`, { headers: headers() }).then(r => r.json()),
      fetch(`${API}/super-admin/modules`, { headers: headers() }).then(r => r.json()),
      fetch(`${API}/super-admin/plans`, { headers: headers() }).then(r => r.json()).catch(() => ({ plans: [] }))
    ]).then(([tData, mData, pData]) => {
      setWorkshops(tData.workshops || []);
      const mods = Array.isArray(mData) ? mData : (mData.modules || mData.availableModules || []);
      setModules(mods.map(m => typeof m === 'string' ? m : m.id || m.key || m.name));
      setPlans(Array.isArray(pData) ? pData : (pData.plans || []));
      setLoading(false);
    });
  }, []);

  const toggleSelect = (id) => {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };
  const selectAll = () => {
    setSelected(selected.length === workshops.length ? [] : workshops.map(t => t.id));
  };

  const execute = async () => {
    if (!selected.length || !operation) return;
    setExecuting(true);
    setResult(null);
    try {
      let url, body;
      if (operation === 'toggle-status') {
        url = `${API}/super-admin/bulk/toggle-status`;
        body = { workshop_ids: selected, status: bulkStatus };
      } else if (operation === 'assign-modules') {
        url = `${API}/super-admin/bulk/assign-modules`;
        body = { workshop_ids: selected, modules: bulkModules, mode: moduleMode };
      } else if (operation === 'assign-plan') {
        url = `${API}/super-admin/bulk/assign-plan`;
        body = { workshop_ids: selected, plan_id: parseInt(bulkPlanId) };
      } else if (operation === 'delete') {
        if (!(await askConfirm({ title: `Delete ${selected.length} workshop(s)?`, message: 'This is irreversible. All workshop data will be removed.', danger: true, confirmLabel: `Delete ${selected.length}` }))) {
          setExecuting(false);
          return;
        }
        url = `${API}/super-admin/bulk/delete`;
        body = { workshop_ids: selected };
      }
      const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      const data = await res.json();
      setResult({ success: res.ok, message: data.message || (res.ok ? 'Operation completed' : data.error || 'Failed'), data });
      if (res.ok) {
        // Refresh workshops
        const tData = await fetch(`${API}/super-admin/workshops`, { headers: headers() }).then(r => r.json());
        setWorkshops(tData.workshops || []);
        setSelected([]);
      }
    } catch (e) {
      setResult({ success: false, message: e.message });
    }
    setExecuting(false);
  };

  const OPS = [
    { key: 'toggle-status', label: 'Change Status', icon: Play, color: '#3b82f6', desc: 'Activate or suspend selected workshops' },
    { key: 'assign-modules', label: 'Assign Modules', icon: Package, color: '#8b5cf6', desc: 'Set, add, or remove modules for workshops' },
    { key: 'assign-plan', label: 'Assign Plan', icon: CreditCard, color: '#f97316', desc: 'Assign a subscription plan to workshops' },
    { key: 'delete', label: 'Delete Workshops', icon: Trash, color: '#dc2626', desc: 'Permanently delete selected workshops' },
  ];

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>Bulk Operations</h1>
          <p>Perform actions across multiple workshops at once</p>
        </div>
      </div>

      {loading ? (
        <div className="sa-loading-page"><div className="loading-spinner"></div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Left: Select Workshops */}
          <div className="sa-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Select Workshops</h3>
              <button className="sa-secondary-btn" style={{ padding: '6px 12px', fontSize: 13 }} onClick={selectAll}>
                {selected.length === workshops.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px' }}>
              {selected.length} of {workshops.length} selected
            </p>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {workshops.map(t => (
                <label key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8,
                  cursor: 'pointer', background: selected.includes(t.id) ? '#fff7ed' : 'transparent',
                  border: `1px solid ${selected.includes(t.id) ? '#f97316' : 'transparent'}`,
                  marginBottom: 4, transition: 'all 0.15s'
                }}>
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggleSelect(t.id)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{t.email || t.domain || `ID: ${t.id}`}</div>
                  </div>
                  <span className={`sa-status-badge ${t.status}`}>{t.status}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Right: Choose Operation */}
          <div>
            <div className="sa-card" style={{ padding: 20, marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 16px' }}>Choose Operation</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {OPS.map(op => {
                  const Icon = op.icon;
                  const active = operation === op.key;
                  return (
                    <div key={op.key} onClick={() => setOperation(op.key)} style={{
                      padding: 16, borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                      border: `2px solid ${active ? op.color : '#e5e7eb'}`,
                      background: active ? `${op.color}10` : '#fff',
                      transition: 'all 0.2s'
                    }}>
                      <Icon size={24} style={{ color: op.color, marginBottom: 8 }} />
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{op.label}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{op.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Operation Parameters */}
            {operation && (
              <div className="sa-card" style={{ padding: 20, marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 16px' }}>Parameters</h3>

                {operation === 'toggle-status' && (
                  <div className="sa-form-group">
                    <label>New Status</label>
                    <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                )}

                {operation === 'assign-modules' && (
                  <>
                    <div className="sa-form-group" style={{ marginBottom: 12 }}>
                      <label>Mode</label>
                      <select value={moduleMode} onChange={e => setModuleMode(e.target.value)}>
                        <option value="set">Set (replace all)</option>
                        <option value="add">Add (merge)</option>
                        <option value="remove">Remove</option>
                      </select>
                    </div>
                    <div className="sa-form-group">
                      <label>Modules</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                        {modules.map(m => {
                          const on = bulkModules.includes(m);
                          return (
                            <button key={m} onClick={() => setBulkModules(on ? bulkModules.filter(x => x !== m) : [...bulkModules, m])} style={{
                              padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                              border: on ? '2px solid #8b5cf6' : '1px solid #e5e7eb',
                              background: on ? '#ede9fe' : '#fff', color: on ? '#7c3aed' : '#374151',
                              fontWeight: on ? 600 : 400
                            }}>
                              {on ? <><Check width={13} height={13} /> </> : ''}{m.replace(/_/g, ' ')}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {operation === 'assign-plan' && (
                  <div className="sa-form-group">
                    <label>Plan</label>
                    <select value={bulkPlanId} onChange={e => setBulkPlanId(e.target.value)}>
                      <option value="">Select a plan...</option>
                      {plans.map(p => <option key={p.id} value={p.id}>{p.name} (${p.price_monthly}/mo)</option>)}
                    </select>
                  </div>
                )}

                {operation === 'delete' && (
                  <div style={{ padding: 16, background: '#fee2e2', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
                    <WarningTriangle size={24} style={{ color: '#dc2626' }} />
                    <div>
                      <strong style={{ color: '#dc2626' }}>Danger ServiceBay</strong>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#991b1b' }}>
                        This will permanently delete {selected.length} workshop(s) and all their data. This cannot be undone.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Execute */}
            <button
              className="sa-primary-btn"
              onClick={execute}
              disabled={!selected.length || !operation || executing}
              style={{
                width: '100%', padding: '14px', fontSize: 15, justifyContent: 'center',
                opacity: (!selected.length || !operation) ? 0.5 : 1,
                background: operation === 'delete' ? '#dc2626' : undefined
              }}
            >
              {executing ? 'Executing...' : `Execute on ${selected.length} Workshop(s)`}
            </button>

            {/* Result */}
            {result && (
              <div style={{
                marginTop: 12, padding: 16, borderRadius: 8,
                background: result.success ? '#dcfce7' : '#fee2e2',
                color: result.success ? '#166534' : '#dc2626',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                {result.success ? <CheckCircle size={20} /> : <WarningTriangle size={20} />}
                {result.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminBulkOps;
