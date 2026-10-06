import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, EditPencil, Trash, Xmark, Calculator, Notes, Sparks, Flash, Copy, StatsReport,
         NavArrowDown, NavArrowUp, CheckCircle, WarningTriangle, Clock, Filter } from 'iconoir-react';
import api from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import './ServicePricing.css';

/* ═══════════════════════════════════════════════════════════
   PRICING — Comprehensive delivery pricing management
   ═══════════════════════════════════════════════════════════ */

const ORDER_TYPES  = ['standard', 'express', 'same_day', 'scheduled', 'return'];
const CUSTOMER_TYPES = ['all', 'individual', 'business', 'vip', 'ecommerce', 'restaurant', 'corporate'];
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const EMPTY_RULE = {
  name: '', service_bay_id: '', customer_type: 'all',
  base_price: '', price_per_km: '', price_per_kg: '',
  min_price: '', max_price: '', cod_fee_pct: '',
  express_surcharge: '', is_active: true, priority: '0', description: '',
};

const EMPTY_SURGE = {
  name: '', day_of_week: '', start_hour: '0', end_hour: '23',
  multiplier: '1.5', service_bay_id: '', is_active: true,
};

const stripLeadingPlus = (label) => String(label || '').replace(/^\s*\+\s*/, '');

export default function ServicePricing() {
  const { t, i18n } = useTranslation();
  const { workshop } = useContext(AuthContext) || {};
  const cur = workshop?.currency || 'AED';
  const isRTL = i18n.language === 'ar';

  /* ── State ── */
  const [rules, setRules]         = useState([]);
  const [service_bays, setServiceBays]         = useState([]);
  const [surgeRules, setSurge]    = useState([]);
  const [stats, setStats]         = useState(null);
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(true);

  // Active tab: rules | calculator | surge | history
  const [activeTab, setActiveTab] = useState('rules');

  // Rule form
  const [showForm, setShowForm]   = useState(false);
  const [selected, setSelected]   = useState(null);
  const [form, setForm]           = useState({ ...EMPTY_RULE });
  const [error, setError]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Surge form
  const [showSurge, setShowSurge]     = useState(false);
  const [surgeEdit, setSurgeEdit]     = useState(null);
  const [surgeForm, setSurgeForm]     = useState({ ...EMPTY_SURGE });
  const [surgeErr, setSurgeErr]       = useState('');
  const [surgeSaving, setSurgeSaving] = useState(false);

  // Calculator
  const [calcForm, setCalcForm]     = useState({ service_bay_id: '', weight_kg: '', work_order_type: 'standard', is_cod: false, cash_amount: '', customer_type: 'all', distance_km: '', order_subtotal: '' });
  const [calcResult, setCalcResult] = useState(null);
  const [calcLoading, setCalcLoading] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Filter
  const [filterZone, setFilterZone]       = useState('');
  const [filterCustomer, setFilterCustomer]   = useState('');
  const [filterActive, setFilterActive]   = useState('');

  /* ── Fetch ── */
  const fetchAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/service-pricing').then(r => r.success && setRules(r.data || [])),
      api.get('/service-bays').then(r => r.success && setServiceBays(r.data || [])),
      api.get('/service-pricing/surge').then(r => r.success && setSurge(r.data || [])).catch(() => {}),
      api.get('/service-pricing/stats').then(r => r.success && setStats(r.data)).catch(() => {}),
      api.get('/service-pricing/history').then(r => r.success && setHistory(r.data || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);
  useEffect(fetchAll, [fetchAll]);

  const zoneName = (id) => service_bays.find(z => z.id === id)?.name || (id ? 'ServiceBay ' + id : '\u2014');

  /* ── Filtered rules ── */
  const filteredRules = useMemo(() => {
    return rules.filter(r => {
      if (filterZone && String(r.service_bay_id) !== filterZone) return false;
      if (filterCustomer && r.customer_type !== filterCustomer) return false;
      if (filterActive === '1' && !r.is_active) return false;
      if (filterActive === '0' && r.is_active) return false;
      return true;
    });
  }, [rules, filterZone, filterCustomer, filterActive]);

  /* ── Rule CRUD ── */
  const openNew = () => { setSelected(null); setForm({ ...EMPTY_RULE }); setError(''); setFormErrors({}); setShowForm(true); };
  const openEdit = (r) => {
    setSelected(r);
    setForm({
      name: r.name || '',
      service_bay_id: r.service_bay_id || '',
      customer_type: r.customer_type || 'all',
      base_price: r.base_price ?? '',
      price_per_km: r.price_per_km ?? '',
      price_per_kg: r.price_per_kg ?? '',
      min_price: r.min_price ?? '',
      max_price: r.max_price ?? '',
      cod_fee_pct: r.cod_fee_pct ?? '',
      express_surcharge: r.express_surcharge ?? '',
      is_active: r.is_active ?? true,
      priority: r.priority ?? '0',
      description: r.description ?? '',
    });
    setError(''); setFormErrors({}); setShowForm(true);
  };

  const validateForm = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = t('pricing.validation.name_required', { defaultValue: 'Name is required' });
    const minP = parseFloat(form.min_price) || 0;
    const maxP = parseFloat(form.max_price) || 500;
    if (minP > maxP) errs.min_price = t('pricing.validation.min_exceeds_max', { defaultValue: 'Min cannot exceed max' });
    const codPct = parseFloat(form.cod_fee_pct) || 0;
    if (codPct < 0 || codPct > 100) errs.cod_fee_pct = t('pricing.validation.cod_range', { defaultValue: 'Must be 0-100%' });
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setSaving(true); setError('');
    const payload = { ...form };
    ['base_price','price_per_km','price_per_kg','min_price','max_price','cod_fee_pct','express_surcharge'].forEach(k => {
      if (payload[k] === '' || payload[k] == null) payload[k] = 0;
      else payload[k] = parseFloat(payload[k]) || 0;
    });
    payload.priority = parseInt(payload.priority) || 0;
    const res = selected
      ? await api.put('/service-pricing/' + selected.id, payload)
      : await api.post('/service-pricing', payload);
    if (res.success) { setShowForm(false); fetchAll(); }
    else setError(res.message || t('pricing.save_failed'));
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm(t('pricing.delete_confirm'))) return;
    await api.delete('/service-pricing/' + id);
    setSelectedIds(prev => prev.filter(x => x !== id));
    fetchAll();
  };

  const handleDuplicate = async (id) => {
    const res = await api.post('/service-pricing/duplicate/' + id);
    if (res.success) fetchAll();
  };

  /* ── Bulk actions ── */
  const toggleSelectAll = () => {
    if (selectedIds.length === filteredRules.length) setSelectedIds([]);
    else setSelectedIds(filteredRules.map(r => r.id));
  };
  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const handleBulkToggle = async (activate) => {
    if (!selectedIds.length) return;
    setBulkLoading(true);
    const res = await api.post('/service-pricing/bulk-toggle', { ids: selectedIds, is_active: activate });
    if (res.success) { setSelectedIds([]); fetchAll(); }
    setBulkLoading(false);
  };

  /* ── Surge CRUD ── */
  const openNewSurge = () => { setSurgeEdit(null); setSurgeForm({ ...EMPTY_SURGE }); setSurgeErr(''); setShowSurge(true); };
  const openEditSurge = (s) => {
    setSurgeEdit(s);
    setSurgeForm({
      name: s.name || '', day_of_week: s.day_of_week ?? '',
      start_hour: s.start_hour ?? '0', end_hour: s.end_hour ?? '23',
      multiplier: s.multiplier ?? '1.5', service_bay_id: s.service_bay_id || '', is_active: s.is_active ?? true,
    });
    setSurgeErr(''); setShowSurge(true);
  };
  const handleSurgeSubmit = async (e) => {
    e.preventDefault();
    setSurgeSaving(true); setSurgeErr('');
    const payload = { ...surgeForm };
    payload.day_of_week = payload.day_of_week === '' ? null : parseInt(payload.day_of_week);
    payload.start_hour  = parseInt(payload.start_hour) || 0;
    payload.end_hour    = parseInt(payload.end_hour)   || 23;
    payload.multiplier  = parseFloat(payload.multiplier) || 1.5;
    const res = surgeEdit
      ? await api.put('/service-pricing/surge/' + surgeEdit.id, payload)
      : await api.post('/service-pricing/surge', payload);
    if (res.success) { setShowSurge(false); fetchAll(); }
    else setSurgeErr(res.message || 'Failed to save');
    setSurgeSaving(false);
  };
  const handleSurgeDelete = async (id) => {
    if (!confirm(t('pricing.delete_confirm'))) return;
    await api.delete('/service-pricing/surge/' + id);
    fetchAll();
  };

  /* ── Calculator ── */
  const handleCalculate = async (e) => {
    e.preventDefault();
    setCalcLoading(true); setCalcResult(null);
    const payload = {
      service_bay_id: calcForm.service_bay_id || null,
      work_order_type: calcForm.work_order_type,
      weight_kg: parseFloat(calcForm.weight_kg) || 0,
      cash_amount: calcForm.is_cod ? (parseFloat(calcForm.cash_amount) || 0) : 0,
      customer_type: calcForm.customer_type,
      distance_km: parseFloat(calcForm.distance_km) || 0,
      order_subtotal: parseFloat(calcForm.order_subtotal) || 0,
    };
    const res = await api.post('/service-pricing/calculate', payload);
    if (res.success) setCalcResult(res.data);
    setCalcLoading(false);
  };

  /* ── Live preview in form ── */
  const livePreview = useMemo(() => {
    const bp = parseFloat(form.base_price) || 0;
    const ppkm = parseFloat(form.price_per_km) || 0;
    const ppkg = parseFloat(form.price_per_kg) || 0;
    const cod = parseFloat(form.cod_fee_pct) || 0;
    const expr = parseFloat(form.express_surcharge) || 0;
    // Example: 5km, 3kg, express, 100 AED COD
    const exampleFee = bp + (ppkm * 5) + (ppkg * 3) + expr + (100 * cod / 100);
    return Math.round(exampleFee * 100) / 100;
  }, [form.base_price, form.price_per_km, form.price_per_kg, form.cod_fee_pct, form.express_surcharge]);

  const formatHistoryDetails = (entry) => {
    const raw = entry?.new_value ?? entry?.old_value;
    if (raw == null || raw === '') return '\u2014';

    let parsed = raw;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); }
      catch {
        return parsed.length > 140 ? parsed.slice(0, 140) + '…' : parsed;
      }
    }

    if (typeof parsed !== 'object') return String(parsed);

    const action = entry?.action ? entry.action.split('.')[1] : '';
    const activeLabel = parsed.is_active === true
      ? t('pricing.active_label', { defaultValue: 'Active' })
      : parsed.is_active === false
        ? t('pricing.off_label', { defaultValue: 'Inactive' })
        : null;

    if (action === 'bulk-toggle' || action === 'bulk_toggle') {
      const count = Array.isArray(parsed.ids) ? parsed.ids.length : null;
      if (count != null && activeLabel) return `${count} ${t('pricing.selected', { defaultValue: 'selected' })} • ${activeLabel}`;
      if (count != null) return `${count} ${t('pricing.selected', { defaultValue: 'selected' })}`;
      if (activeLabel) return activeLabel;
    }

    if (parsed.name && activeLabel) return `${parsed.name} • ${activeLabel}`;
    if (parsed.name) return parsed.name;
    if (activeLabel) return activeLabel;
    if (parsed.id) return `#${parsed.id}`;

    const compact = JSON.stringify(parsed);
    return compact.length > 140 ? compact.slice(0, 140) + '…' : compact;
  };

  /* ── Render ── */
  return (
    <div className="prc-page page-container">
      {/* Stats Cards */}
      {stats && (
        <div className="prc-stats-row">
          <div className="prc-stat-card">
            <div className="prc-stat-icon prc-stat-blue"><Notes width={18} height={18} /></div>
            <div>
              <div className="prc-stat-value">{stats.total_rules || 0}</div>
              <div className="prc-stat-label">{t('pricing.stats_total_rules', { defaultValue: 'Total Rules' })}</div>
            </div>
          </div>
          <div className="prc-stat-card">
            <div className="prc-stat-icon prc-stat-green"><CheckCircle width={18} height={18} /></div>
            <div>
              <div className="prc-stat-value">{stats.active_rules || 0}</div>
              <div className="prc-stat-label">{t('pricing.stats_active', { defaultValue: 'Active Rules' })}</div>
            </div>
          </div>
          <div className="prc-stat-card">
            <div className="prc-stat-icon prc-stat-orange"><Flash width={18} height={18} /></div>
            <div>
              <div className="prc-stat-value">{stats.total_surge || 0}</div>
              <div className="prc-stat-label">{t('pricing.stats_surge', { defaultValue: 'Surge Rules' })}</div>
            </div>
          </div>
          <div className="prc-stat-card">
            <div className="prc-stat-icon prc-stat-purple"><StatsReport width={18} height={18} /></div>
            <div>
              <div className="prc-stat-value">{stats.orders_30d || 0}</div>
              <div className="prc-stat-label">{t('pricing.stats_orders', { defaultValue: 'WorkOrders (30d)' })}</div>
            </div>
          </div>
          <div className="prc-stat-card">
            <div className="prc-stat-icon prc-stat-emerald"><Calculator width={18} height={18} /></div>
            <div>
              <div className="prc-stat-value">{cur} {parseFloat(stats.revenue_30d || 0).toFixed(0)}</div>
              <div className="prc-stat-label">{t('pricing.stats_revenue', { defaultValue: 'Revenue (30d)' })}</div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="prc-header">
        <div className="prc-header-left">
          <h2>{t('pricing.title')}</h2>
          <p>{t('pricing.rules_configured', { count: rules.length })}</p>
        </div>
        <div className="prc-header-actions">
          <button className="prc-add-btn" onClick={openNew}>
            <Plus width={16} height={16} />
            {stripLeadingPlus(t('pricing.add_rule'))}
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="prc-tabs">
        {[
          { key: 'rules', label: t('pricing.tab_rules', { defaultValue: 'ServicePricing Rules' }), icon: <Notes width={14} height={14} /> },
          { key: 'calculator', label: t('pricing.tab_calculator', { defaultValue: 'Calculator' }), icon: <Calculator width={14} height={14} /> },
          { key: 'surge', label: t('pricing.tab_surge', { defaultValue: 'Surge ServicePricing' }), icon: <Flash width={14} height={14} /> },
          { key: 'history', label: t('pricing.tab_history', { defaultValue: 'History' }), icon: <Clock width={14} height={14} /> },
        ].map(tab => (
          <button key={tab.key}
            className={'prc-tab ' + (activeTab === tab.key ? 'prc-tab-active' : '')}
            onClick={() => setActiveTab(tab.key)}>
            {tab.icon} {tab.label}
            {tab.key === 'surge' && surgeRules.length > 0 && <span className="prc-tab-badge">{surgeRules.length}</span>}
          </button>
        ))}
      </div>

      {/* Rules Tab */}
      {activeTab === 'rules' && (
        <div className="prc-rules-section">
          {/* Filters + Bulk actions */}
          <div className="prc-toolbar">
            <div className="prc-filters">
              <div className="prc-filter-item">
                <Filter width={13} height={13} />
                <select value={filterZone} onChange={e => setFilterZone(e.target.value)}>
                  <option value="">{t('pricing.filter_all_zones', { defaultValue: 'All ServiceBays' })}</option>
                  {service_bays.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
              <div className="prc-filter-item">
                <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
                  <option value="">{t('pricing.filter_all_customers', { defaultValue: 'All Customer Types' })}</option>
                  {CUSTOMER_TYPES.map(ct => <option key={ct} value={ct}>{t('pricing.customer_types.' + ct, { defaultValue: ct })}</option>)}
                </select>
              </div>
              <div className="prc-filter-item">
                <select value={filterActive} onChange={e => setFilterActive(e.target.value)}>
                  <option value="">{t('pricing.filter_all_status', { defaultValue: 'All Status' })}</option>
                  <option value="1">{t('pricing.active_label', { defaultValue: 'Active' })}</option>
                  <option value="0">{t('pricing.off_label', { defaultValue: 'Inactive' })}</option>
                </select>
              </div>
            </div>
            {selectedIds.length > 0 && (
              <div className="prc-bulk-actions">
                <span className="prc-bulk-count">{selectedIds.length} {t('pricing.selected', { defaultValue: 'selected' })}</span>
                <button className="prc-bulk-btn prc-bulk-activate" onClick={() => handleBulkToggle(true)} disabled={bulkLoading}>
                  <CheckCircle width={13} height={13} /> {t('pricing.activate', { defaultValue: 'Activate' })}
                </button>
                <button className="prc-bulk-btn prc-bulk-deactivate" onClick={() => handleBulkToggle(false)} disabled={bulkLoading}>
                  <Xmark width={13} height={13} /> {t('pricing.deactivate', { defaultValue: 'Deactivate' })}
                </button>
              </div>
            )}
          </div>

          <div className="prc-rules-card">
            {loading ? (
              <div className="prc-loading"><span className="prc-spinner" /> {t('common.loading')}</div>
            ) : filteredRules.length === 0 ? (
              <div className="prc-empty">
                <div className="prc-empty-icon"><Notes width={32} height={32} /></div>
                <h4>{t('pricing.no_rules')}</h4>
                <p>{t('pricing.no_rules_sub')}</p>
                <button className="prc-add-btn" onClick={openNew} style={{ marginTop: 16 }}>
                  <Plus width={16} height={16} /> {stripLeadingPlus(t('pricing.add_rule'))}
                </button>
              </div>
            ) : (
              <table className="prc-table">
                <thead>
                  <tr style={{ textAlign: isRTL ? 'right' : 'left' }}>
                    <th style={{ width: 36 }}>
                      <input type="checkbox"
                        checked={selectedIds.length === filteredRules.length && filteredRules.length > 0}
                        onChange={toggleSelectAll}
                        className="prc-checkbox" />
                    </th>
                    <th>{t('pricing.header_name')}</th>
                    <th>{t('pricing.header_customer')}</th>
                    <th>{t('pricing.header_base')}</th>
                    <th>{t('pricing.header_per_km')}</th>
                    <th>{t('pricing.header_per_kg')}</th>
                    <th>{t('pricing.header_cod_pct')}</th>
                    <th>{t('pricing.header_express')}</th>
                    <th>{t('pricing.header_limits')}</th>
                    <th>{t('pricing.header_priority', { defaultValue: 'Priority' })}</th>
                    <th>{t('pricing.header_status')}</th>
                    <th>{t('pricing.header_actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRules.map(rule => (
                    <tr key={rule.id} className={selectedIds.includes(rule.id) ? 'prc-row-selected' : ''}>
                      <td>
                        <input type="checkbox"
                          checked={selectedIds.includes(rule.id)}
                          onChange={() => toggleSelect(rule.id)}
                          className="prc-checkbox" />
                      </td>
                      <td>
                        <div className="prc-rule-name">{rule.name}</div>
                        <div className="prc-rule-bay">{rule.zone_name || zoneName(rule.service_bay_id)}</div>
                        {rule.description && <div className="prc-rule-desc">{rule.description}</div>}
                      </td>
                      <td>
                        <span className="prc-customer-badge">
                          {t('pricing.customer_types.' + (rule.customer_type || 'all'), { defaultValue: rule.customer_type || 'all' })}
                        </span>
                      </td>
                      <td className="prc-fee">{cur} {parseFloat(rule.base_price || 0).toFixed(2)}</td>
                      <td className="prc-fee-secondary">{rule.price_per_km > 0 ? `${cur} ${parseFloat(rule.price_per_km).toFixed(2)}` : '\u2014'}</td>
                      <td className="prc-fee-secondary">{rule.price_per_kg > 0 ? `${cur} ${parseFloat(rule.price_per_kg).toFixed(2)}` : '\u2014'}</td>
                      <td className="prc-fee-secondary">{rule.cod_fee_pct > 0 ? rule.cod_fee_pct + '%' : '\u2014'}</td>
                      <td className="prc-fee-secondary">{rule.express_surcharge > 0 ? `${cur} ${parseFloat(rule.express_surcharge).toFixed(2)}` : '\u2014'}</td>
                      <td className="prc-fee-secondary">
                        {cur} {parseFloat(rule.min_price || 0).toFixed(0)} &ndash; {cur} {parseFloat(rule.max_price || 500).toFixed(0)}
                      </td>
                      <td>
                        <span className="prc-priority-badge">{rule.priority || 0}</span>
                      </td>
                      <td>
                        <span className={'prc-badge ' + (rule.is_active ? 'prc-badge-active' : 'prc-badge-inactive')}>
                          {rule.is_active ? t('pricing.active_label') : t('pricing.off_label')}
                        </span>
                      </td>
                      <td>
                        <div className="prc-actions">
                          <button className="prc-act-btn" onClick={() => openEdit(rule)} title={t('common.edit', { defaultValue: 'Edit' })}>
                            <EditPencil width={13} height={13} />
                          </button>
                          <button className="prc-act-btn" onClick={() => handleDuplicate(rule.id)} title={t('pricing.duplicate', { defaultValue: 'Duplicate' })}>
                            <Copy width={13} height={13} />
                          </button>
                          <button className="prc-act-btn delete" onClick={() => handleDelete(rule.id)} title={t('common.delete', { defaultValue: 'Delete' })}>
                            <Trash width={13} height={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Calculator Tab */}
      {activeTab === 'calculator' && (
        <div className="prc-calc-full">
          <div className="prc-calc-grid">
            <div className="prc-calc-card prc-calc-main">
              <div className="prc-calc-header">
                <div className="prc-calc-icon"><Calculator width={20} height={20} /></div>
                <h3>{t('pricing.price_calculator')}</h3>
              </div>
              <div className="prc-calc-body">
                <form onSubmit={handleCalculate}>
                  <div className="prc-calc-field">
                    <label>{t('pricing.zone_label')} <span style={{ color: '#ef4444' }}>*</span></label>
                    <select required value={calcForm.service_bay_id} onChange={e => setCalcForm(f => ({ ...f, service_bay_id: e.target.value }))}>
                      <option value="">{t('pricing.select_zone')}</option>
                      {service_bays.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>

                  <div className="prc-calc-row">
                    <div className="prc-calc-field">
                      <label>{t('pricing.work_order_type')}</label>
                      <select value={calcForm.work_order_type} onChange={e => setCalcForm(f => ({ ...f, work_order_type: e.target.value }))}>
                        {ORDER_TYPES.map(ot => <option key={ot} value={ot}>{t('pricing.types.' + ot, { defaultValue: ot })}</option>)}
                      </select>
                    </div>
                    <div className="prc-calc-field">
                      <label>{t('pricing.customer_type_label')}</label>
                      <select value={calcForm.customer_type} onChange={e => setCalcForm(f => ({ ...f, customer_type: e.target.value }))}>
                        {CUSTOMER_TYPES.map(ct => <option key={ct} value={ct}>{t('pricing.customer_types.' + ct, { defaultValue: ct })}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="prc-calc-row">
                    <div className="prc-calc-field">
                      <label>{t('pricing.weight_kg')} <span style={{ color: '#ef4444' }}>*</span></label>
                      <input required type="number" step="0.1" min="0" value={calcForm.weight_kg}
                        onChange={e => setCalcForm(f => ({ ...f, weight_kg: e.target.value }))}
                        placeholder="0.0" />
                    </div>
                    <div className="prc-calc-field">
                      <label>{t('pricing.distance_km')}</label>
                      <input type="number" step="0.1" min="0" value={calcForm.distance_km}
                        onChange={e => setCalcForm(f => ({ ...f, distance_km: e.target.value }))}
                        placeholder="0.0" />
                    </div>
                  </div>

                  <div className="prc-calc-field">
                    <label>{t('pricing.order_subtotal', { defaultValue: 'WorkOrder Subtotal (for free delivery check)' })}</label>
                    <input type="number" step="0.01" min="0" value={calcForm.order_subtotal}
                      onChange={e => setCalcForm(f => ({ ...f, order_subtotal: e.target.value }))}
                      placeholder="0.00" />
                  </div>

                  <label className="prc-cod-check">
                    <input type="checkbox" checked={calcForm.is_cod}
                      onChange={e => setCalcForm(f => ({ ...f, is_cod: e.target.checked }))} />
                    <span>{t('pricing.cash_on_delivery')}</span>
                  </label>

                  {calcForm.is_cod && (
                    <div className="prc-calc-field">
                      <label>{t('pricing.cash_amount_label', { defaultValue: `COD Amount (${cur})` })}</label>
                      <input type="number" min="0" step="0.01" value={calcForm.cash_amount}
                        onChange={e => setCalcForm(f => ({ ...f, cash_amount: e.target.value }))}
                        placeholder="0.00" />
                    </div>
                  )}

                  <button type="submit" className="prc-calc-btn" disabled={calcLoading}>
                    {calcLoading ? t('pricing.calculating') : t('pricing.calculate_price')}
                  </button>
                </form>
              </div>
            </div>

            <div className="prc-calc-result-panel">
              {calcResult ? (
                <div className="prc-calc-result">
                  <div className="prc-calc-result-top">
                    <div className="prc-calc-result-label">{t('pricing.estimated_price')}</div>
                    {calcResult.free_delivery ? (
                      <div className="prc-calc-result-free">{t('pricing.free_delivery', { defaultValue: 'FREE DELIVERY' })} <Sparks width={16} height={16} /></div>
                    ) : (
                      <div className="prc-calc-result-value">
                        {cur} {parseFloat(calcResult.estimated_fee || 0).toFixed(2)}
                      </div>
                    )}
                    {calcResult.rule_name && (
                      <div className="prc-calc-rule-used">
                        {t('pricing.rule_used', { defaultValue: 'Rule applied: ' })}<strong>{calcResult.rule_name}</strong>
                      </div>
                    )}
                  </div>
                  {calcResult.breakdown && (
                    <div className="prc-calc-breakdown">
                      <div className="prc-calc-breakdown-divider" />
                      <div className="prc-calc-breakdown-title">{t('pricing.breakdown_title', { defaultValue: 'Price Breakdown' })}</div>
                      {Object.entries(calcResult.breakdown)
                        .filter(([k, v]) => typeof v === 'number' && v > 0 && !k.endsWith('_km') && !k.endsWith('_kg'))
                        .map(([k, v]) => (
                        <div key={k} className="prc-calc-breakdown-row">
                          <span>{t('pricing.breakdown.' + k, { defaultValue: k.replace(/_/g, ' ') })}</span>
                          <span>{k === 'surge_multiplier' ? '\u00d7' + v : `${cur} ${v.toFixed(2)}`}</span>
                        </div>
                      ))}
                      {calcResult.breakdown.min_applied && (
                        <div className="prc-calc-breakdown-note">
                          <WarningTriangle width={12} height={12} /> {t('pricing.min_applied', { defaultValue: 'Minimum price applied' })}
                        </div>
                      )}
                      {calcResult.breakdown.max_applied && (
                        <div className="prc-calc-breakdown-note">
                          <WarningTriangle width={12} height={12} /> {t('pricing.max_applied', { defaultValue: 'Maximum price cap applied' })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="prc-calc-placeholder">
                  <Calculator width={40} height={40} />
                  <p>{t('pricing.calc_placeholder', { defaultValue: 'Fill in the form and click Calculate to see the estimated delivery price' })}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Surge Tab */}
      {activeTab === 'surge' && (
        <div className="prc-surge-section">
          <div className="prc-surge-header">
            <h3><Flash width={16} height={16} /> {t('pricing.surge_title')}</h3>
            <button className="prc-add-btn" onClick={openNewSurge} style={{ fontSize: '0.8rem', padding: '8px 16px' }}>
              <Plus width={14} height={14} />
              {stripLeadingPlus(t('pricing.add_surge'))}
            </button>
          </div>
          <div className="prc-surge-card">
            {surgeRules.length === 0 ? (
              <div className="prc-empty" style={{ padding: '56px 20px' }}>
                <div className="prc-empty-icon"><Flash width={32} height={32} /></div>
                <h4>{t('pricing.no_surge')}</h4>
                <p>{t('pricing.no_surge_sub', { defaultValue: 'Create surge rules to automatically increase prices during peak hours' })}</p>
                <button className="prc-add-btn" onClick={openNewSurge} style={{ marginTop: 16 }}>
                  <Plus width={16} height={16} /> {stripLeadingPlus(t('pricing.add_surge'))}
                </button>
              </div>
            ) : (
              <div className="prc-surge-grid">
                {surgeRules.map(s => (
                  <div className={'prc-surge-item ' + (!s.is_active ? 'prc-surge-inactive' : '')} key={s.id}>
                    <div className="prc-surge-actions">
                      <button className="prc-act-btn" onClick={() => openEditSurge(s)}><EditPencil width={12} height={12} /></button>
                      <button className="prc-act-btn delete" onClick={() => handleSurgeDelete(s.id)}><Trash width={12} height={12} /></button>
                    </div>
                    <div className="prc-surge-item-name">{s.name}</div>
                    <div className="prc-surge-item-detail">
                      {s.day_of_week != null ? DAYS_OF_WEEK[s.day_of_week] : t('pricing.every_day')} &middot; {String(s.start_hour).padStart(2,'0')}:00 &ndash; {String(s.end_hour).padStart(2,'0')}:00
                    </div>
                    <div className="prc-surge-item-detail">{s.zone_name || (s.service_bay_id ? zoneName(s.service_bay_id) : t('pricing.all_zones'))}</div>
                    <div className="prc-surge-bottom">
                      <div className="prc-surge-multiplier">{'\u00d7'}{parseFloat(s.multiplier).toFixed(1)}</div>
                      {!s.is_active && <span className="prc-badge prc-badge-inactive">{t('pricing.off_label')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="prc-history-section">
          <div className="prc-history-card">
            {history.length === 0 ? (
              <div className="prc-empty" style={{ padding: '56px 20px' }}>
                <div className="prc-empty-icon"><Clock width={32} height={32} /></div>
                <h4>{t('pricing.no_history', { defaultValue: 'No pricing changes yet' })}</h4>
                <p>{t('pricing.no_history_sub', { defaultValue: 'All pricing rule changes will be recorded here for audit purposes' })}</p>
              </div>
            ) : (
              <table className="prc-table prc-history-table">
                <thead>
                  <tr style={{ textAlign: isRTL ? 'right' : 'left' }}>
                    <th>{t('pricing.history_date', { defaultValue: 'Date' })}</th>
                    <th>{t('pricing.history_user', { defaultValue: 'User' })}</th>
                    <th>{t('pricing.history_action', { defaultValue: 'Action' })}</th>
                    <th>{t('pricing.history_entity', { defaultValue: 'Entity' })}</th>
                    <th>{t('pricing.history_details', { defaultValue: 'Details' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id}>
                      <td className="prc-fee-secondary">{new Date(h.created_at).toLocaleString()}</td>
                      <td>{h.user_name || 'System'}</td>
                      <td>
                        <span className={'prc-action-badge prc-action-' + (h.action ? h.action.split('.')[1] : 'other')}>
                          {h.action ? h.action.replace('.', ' \u2192 ') : '\u2014'}
                        </span>
                      </td>
                      <td className="prc-fee-secondary">{h.entity_type} #{h.entity_id}</td>
                      <td className="prc-fee-secondary prc-history-details-cell">
                        {formatHistoryDetails(h)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Rule Form Modal */}
      {showForm && (
        <div className="prc-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowForm(false)}>
          <div className="prc-modal">
            <div className="prc-modal-header">
              <h3>{selected ? t('pricing.edit_rule') : t('pricing.add_pricing_rule')}</h3>
              <button className="prc-modal-close" onClick={() => setShowForm(false)}><Xmark width={16} height={16} /></button>
            </div>
            <div className="prc-modal-body">
              {error && <div className="prc-modal-error">{error}</div>}

              {/* Live Preview */}
              <div className="prc-form-preview">
                <div className="prc-form-preview-label">{t('pricing.live_preview', { defaultValue: `Live Preview (5km, 3kg, express, 100 ${cur} COD)` })}</div>
                <div className="prc-form-preview-value">{cur} {livePreview.toFixed(2)}</div>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="prc-form-grid">
                  <div className="prc-form-field">
                    <label>{t('pricing.rule_name')} <span className="req">*</span></label>
                    <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder={t('pricing.rule_name_placeholder')} className={formErrors.name ? 'prc-input-error' : ''} />
                    {formErrors.name && <span className="prc-field-error">{formErrors.name}</span>}
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.zone_label')}</label>
                    <select value={form.service_bay_id} onChange={e => setForm(f => ({ ...f, service_bay_id: e.target.value }))}>
                      <option value="">{t('pricing.all_zones')}</option>
                      {service_bays.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>

                  <div className="prc-form-field">
                    <label>{t('pricing.customer_type_label')}</label>
                    <select value={form.customer_type} onChange={e => setForm(f => ({ ...f, customer_type: e.target.value }))}>
                      {CUSTOMER_TYPES.map(ct => <option key={ct} value={ct}>{t('pricing.customer_types.' + ct, { defaultValue: ct })}</option>)}
                    </select>
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.base_price')} <span className="req">*</span></label>
                    <input required type="number" step="0.01" min="0" value={form.base_price}
                      onChange={e => setForm(f => ({ ...f, base_price: e.target.value }))} placeholder="15.00" />
                  </div>

                  <div className="prc-form-section">{t('pricing.section_per_unit', { defaultValue: 'Per Unit Charges' })}</div>

                  <div className="prc-form-field">
                    <label>{t('pricing.price_per_km')}</label>
                    <input type="number" step="0.01" min="0" value={form.price_per_km}
                      onChange={e => setForm(f => ({ ...f, price_per_km: e.target.value }))} placeholder="0.00" />
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.price_per_kg')}</label>
                    <input type="number" step="0.01" min="0" value={form.price_per_kg}
                      onChange={e => setForm(f => ({ ...f, price_per_kg: e.target.value }))} placeholder="0.00" />
                  </div>

                  <div className="prc-form-section">{t('pricing.section_surcharges', { defaultValue: 'Surcharges' })}</div>

                  <div className="prc-form-field">
                    <label>{t('pricing.cod_fee_pct_label')}</label>
                    <input type="number" step="0.1" min="0" max="100" value={form.cod_fee_pct}
                      onChange={e => setForm(f => ({ ...f, cod_fee_pct: e.target.value }))} placeholder="0"
                      className={formErrors.cod_fee_pct ? 'prc-input-error' : ''} />
                    {formErrors.cod_fee_pct && <span className="prc-field-error">{formErrors.cod_fee_pct}</span>}
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.express_surcharge')}</label>
                    <input type="number" step="0.01" min="0" value={form.express_surcharge}
                      onChange={e => setForm(f => ({ ...f, express_surcharge: e.target.value }))} placeholder="10.00" />
                  </div>

                  <div className="prc-form-section">{t('pricing.section_limits', { defaultValue: 'Price Limits' })}</div>

                  <div className="prc-form-field">
                    <label>{t('pricing.min_price')}</label>
                    <input type="number" step="0.01" min="0" value={form.min_price}
                      onChange={e => setForm(f => ({ ...f, min_price: e.target.value }))} placeholder="10.00"
                      className={formErrors.min_price ? 'prc-input-error' : ''} />
                    {formErrors.min_price && <span className="prc-field-error">{formErrors.min_price}</span>}
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.max_price')}</label>
                    <input type="number" step="0.01" min="0" value={form.max_price}
                      onChange={e => setForm(f => ({ ...f, max_price: e.target.value }))} placeholder="500.00" />
                  </div>

                  <div className="prc-form-section">{t('pricing.section_advanced', { defaultValue: 'Advanced' })}</div>

                  <div className="prc-form-field">
                    <label>{t('pricing.priority_label', { defaultValue: 'Priority (higher = preferred)' })}</label>
                    <input type="number" step="1" min="0" max="100" value={form.priority}
                      onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.description', { defaultValue: 'Description' })}</label>
                    <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder={t('pricing.description_placeholder', { defaultValue: 'Optional notes about this rule' })} />
                  </div>

                  <div className="prc-form-toggle full-width">
                    <input type="checkbox" id="prc-active" checked={form.is_active}
                      onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                    <label htmlFor="prc-active">{t('pricing.rule_active')}</label>
                  </div>
                </div>

                <div className="prc-form-footer">
                  <button type="button" className="prc-form-cancel" onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
                  <button type="submit" className="prc-form-submit" disabled={saving}>
                    {saving ? t('pricing.saving') : selected ? t('common.update') : t('common.create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Surge Form Modal */}
      {showSurge && (
        <div className="prc-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowSurge(false)}>
          <div className="prc-modal" style={{ maxWidth: 480 }}>
            <div className="prc-modal-header">
              <h3>{surgeEdit ? t('pricing.edit_surge') : t('pricing.add_surge_rule')}</h3>
              <button className="prc-modal-close" onClick={() => setShowSurge(false)}><Xmark width={16} height={16} /></button>
            </div>
            <div className="prc-modal-body">
              {surgeErr && <div className="prc-modal-error">{surgeErr}</div>}
              <form onSubmit={handleSurgeSubmit}>
                <div className="prc-form-grid">
                  <div className="prc-form-field full-width">
                    <label>{t('pricing.rule_name')} <span className="req">*</span></label>
                    <input required value={surgeForm.name} onChange={e => setSurgeForm(f => ({ ...f, name: e.target.value }))}
                      placeholder={t('pricing.surge_name_placeholder')} />
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.day_of_week')}</label>
                    <select value={surgeForm.day_of_week} onChange={e => setSurgeForm(f => ({ ...f, day_of_week: e.target.value }))}>
                      <option value="">{t('pricing.every_day')}</option>
                      {DAYS_OF_WEEK.map((d, i) => <option key={i} value={i}>{t('pricing.days.' + d.toLowerCase(), { defaultValue: d })}</option>)}
                    </select>
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.zone_label')}</label>
                    <select value={surgeForm.service_bay_id} onChange={e => setSurgeForm(f => ({ ...f, service_bay_id: e.target.value }))}>
                      <option value="">{t('pricing.all_zones')}</option>
                      {service_bays.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.start_hour')}</label>
                    <input type="number" min="0" max="23" value={surgeForm.start_hour}
                      onChange={e => setSurgeForm(f => ({ ...f, start_hour: e.target.value }))} />
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.end_hour')}</label>
                    <input type="number" min="0" max="23" value={surgeForm.end_hour}
                      onChange={e => setSurgeForm(f => ({ ...f, end_hour: e.target.value }))} />
                  </div>
                  <div className="prc-form-field">
                    <label>{t('pricing.multiplier')} <span className="req">*</span></label>
                    <input required type="number" step="0.1" min="1" max="5" value={surgeForm.multiplier}
                      onChange={e => setSurgeForm(f => ({ ...f, multiplier: e.target.value }))} placeholder="1.5" />
                  </div>
                  <div className="prc-form-toggle">
                    <input type="checkbox" id="prc-surge-active" checked={surgeForm.is_active}
                      onChange={e => setSurgeForm(f => ({ ...f, is_active: e.target.checked }))} />
                    <label htmlFor="prc-surge-active">{t('pricing.rule_active')}</label>
                  </div>
                </div>
                <div className="prc-form-footer">
                  <button type="button" className="prc-form-cancel" onClick={() => setShowSurge(false)}>{t('common.cancel')}</button>
                  <button type="submit" className="prc-form-submit" disabled={surgeSaving}>
                    {surgeSaving ? t('pricing.saving') : surgeEdit ? t('common.update') : t('common.create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
