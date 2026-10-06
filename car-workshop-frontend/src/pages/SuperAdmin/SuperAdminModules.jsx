import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Package, Building, CheckCircle, Xmark, Search,
  User, Mail, Phone, Suitcase, Calendar, EditPencil, Settings,
  Home, Truck, Map, Globe, CreditCard, StatsReport, Bell,
  Box, Archive, RefreshDouble, BinHalf, Wallet, Journal,
  NavArrowRight, ReportColumns, FloppyDisk, Key,
  GridPlus, GridMinus
} from 'iconoir-react';
import './SuperAdmin.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/* ── per-module icon + accent colour ── */
const MODULE_META = {
  dashboard:          { icon: Home,           color: '#6366f1' },
  orders:             { icon: Box,            color: '#f97316' },
  'job-assignment':   { icon: Truck,          color: '#0ea5e9' },
  mechanics:            { icon: User,           color: '#10b981' },
  customers:            { icon: Building,       color: '#8b5cf6' },
  'live-map':         { icon: Map,            color: '#3bb4e8' },
  'service-tracking':{ icon: Search,         color: '#14b8a6' },
  'bulk-import':      { icon: Archive,        color: '#64748b' },
  returns:            { icon: RefreshDouble,   color: '#ef4444' },
  wallet:             { icon: Wallet,         color: '#eab308' },
  invoices:           { icon: Journal,        color: '#06b6d4' },
  cod:                { icon: CreditCard,     color: '#f59e0b' },
  reports:            { icon: StatsReport,    color: '#3b82f6' },
  performance:        { icon: ReportColumns,  color: '#a855f7' },
  service_bays:              { icon: Map,            color: '#22c55e' },
  pricing:            { icon: CreditCard,     color: '#f43f5e' },
  notifications:      { icon: Bell,           color: '#f97316' },
  settings:           { icon: Settings,       color: '#6b7280' },
  integrations:       { icon: Key,            color: '#0d9488' },
};

const CATEGORY_META = {
  Core:          { icon: Home,       color: '#6366f1', bg: '#eef2ff' },
  Operations:    { icon: Truck,      color: '#f97316', bg: '#fff7ed' },
  Finance:       { icon: Wallet,     color: '#eab308', bg: '#fefce8' },
  Analytics:     { icon: StatsReport,color: '#3b82f6', bg: '#eff6ff' },
  Configuration: { icon: Settings,   color: '#6b7280', bg: '#f9fafb' },
  Communication: { icon: Bell,       color: '#3bb4e8', bg: '#fdf2f8' },
};

const SuperAdminModules = () => {
  const { t } = useTranslation();
  const [modules, setModules] = useState([]);
  const [workshops, setWorkshops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkshop, setSelectedWorkshop] = useState(null);
  const [selectedModules, setSelectedModules] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('superAdminToken');
      const [modulesRes, workshopsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/super-admin/modules`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/super-admin/workshops`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (modulesRes.ok) setModules(await modulesRes.json());
      if (workshopsRes.ok) { const d = await workshopsRes.json(); setWorkshops(d.workshops || []); }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const openModuleConfig = (workshop) => {
    setSelectedWorkshop(workshop);
    const currentModules = workshop.allowed_modules
      ? (typeof workshop.allowed_modules === 'string'
          ? JSON.parse(workshop.allowed_modules)
          : workshop.allowed_modules)
      : modules.map(m => m.id);
    setSelectedModules(currentModules);
    setShowModal(true);
  };

  const toggleModule = (moduleId) => {
    setSelectedModules(prev =>
      prev.includes(moduleId) ? prev.filter(id => id !== moduleId) : [...prev, moduleId]
    );
  };

  const toggleCategory = (categoryModules) => {
    const allSelected = categoryModules.every(m => selectedModules.includes(m.id));
    if (allSelected) {
      setSelectedModules(prev => prev.filter(id => !categoryModules.find(m => m.id === id)));
    } else {
      const newIds = categoryModules.map(m => m.id).filter(id => !selectedModules.includes(id));
      setSelectedModules(prev => [...prev, ...newIds]);
    }
  };

  const saveModules = async () => {
    try {
      setSaving(true);
      const token = localStorage.getItem('superAdminToken');
      await fetch(`${API_BASE_URL}/super-admin/workshops/${selectedWorkshop.id}/modules`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: selectedModules }),
      });
      setShowModal(false);
      fetchData();
    } catch (error) {
      console.error('Failed to save modules:', error);
    } finally {
      setSaving(false);
    }
  };

  const selectAll = () => setSelectedModules(modules.map(m => m.id));
  const deselectAll = () => setSelectedModules([]);

  const groupedModules = modules.reduce((acc, module) => {
    if (!acc[module.category]) acc[module.category] = [];
    acc[module.category].push(module);
    return acc;
  }, {});

  const getModuleMeta = (id) => MODULE_META[id] || { icon: Package, color: '#94a3b8' };
  const getCatMeta = (cat) => CATEGORY_META[cat] || { icon: Package, color: '#94a3b8', bg: '#f9fafb' };

  if (loading) {
    return (
      <div className="sa-page" style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <div className="loading-spinner large" />
      </div>
    );
  }

  return (
    <div className="sa-page">
      {/* Page header */}
      <div className="sa-page-header">
        <div>
          <h1>Module Management</h1>
          <p>Configure which modules each workshop can access</p>
        </div>
        <div className="sam-header-stat">
          <Package size={20} />
          <span><strong>{modules.length}</strong> modules available</span>
        </div>
      </div>

      {/* ── Category cards grid ── */}
      <div className="sam-categories-grid">
        {Object.entries(groupedModules).map(([category, catModules]) => {
          const cat = getCatMeta(category);
          const CatIcon = cat.icon;
          return (
            <div key={category} className="sam-category-card">
              <div className="sam-cat-header">
                <div className="sam-cat-icon" style={{ background: cat.bg, color: cat.color }}>
                  <CatIcon size={22} />
                </div>
                <div className="sam-cat-title">
                  <h3>{category}</h3>
                  <span className="sam-cat-count">{catModules.length} module{catModules.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <div className="sam-cat-modules">
                {catModules.map(mod => {
                  const meta = getModuleMeta(mod.id);
                  const ModIcon = meta.icon;
                  return (
                    <div key={mod.id} className="sam-module-pill">
                      <span className="sam-pill-dot" style={{ background: meta.color }} />
                      <ModIcon size={15} style={{ color: meta.color, flexShrink: 0 }} />
                      <span className="sam-pill-name">{mod.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Workshop access table ── */}
      <div className="sa-card" style={{ marginTop: 28 }}>
        <div className="sa-card-header">
          <h2>Workshop Module Access</h2>
        </div>
        <div className="sa-table-wrapper">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Workshop</th>
                <th>Industry</th>
                <th>Enabled Modules</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workshops.length === 0 ? (
                <tr><td colSpan="5" className="sa-empty-row">No workshops found</td></tr>
              ) : (
                workshops.map(workshop => {
                  const enabledModules = workshop.allowed_modules
                    ? (typeof workshop.allowed_modules === 'string' ? JSON.parse(workshop.allowed_modules) : workshop.allowed_modules)
                    : modules.map(m => m.id);
                  const pct = modules.length ? Math.round((enabledModules.length / modules.length) * 100) : 0;

                  return (
                    <tr key={workshop.id}>
                      <td>
                        <div className="sa-workshop-name">
                          <div className="sa-workshop-avatar">{workshop.name?.charAt(0)}</div>
                          <span>{workshop.name}</span>
                        </div>
                      </td>
                      <td><span style={{ textTransform: 'capitalize' }}>{workshop.industry || '-'}</span></td>
                      <td>
                        <div className="sam-module-bar-cell">
                          <div className="sam-progress-wrap">
                            <div className="sam-progress-bar" style={{ width: `${pct}%`, background: pct === 100 ? '#10b981' : '#f97316' }} />
                          </div>
                          <span className="sam-bar-label">{enabledModules.length}/{modules.length}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`sa-status-badge ${workshop.status === 'active' ? 'success' : 'warning'}`}>
                          {workshop.status}
                        </span>
                      </td>
                      <td>
                        <button className="sa-btn primary small" onClick={() => openModuleConfig(workshop)} title="Configure Modules">
                          <EditPencil size={15} />
                          <span>Configure</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Configuration Modal ── */}
      {showModal && selectedWorkshop && (
        <div className="sa-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="sa-modal large" onClick={(e) => e.stopPropagation()}>
            <div className="sa-modal-header">
              <div>
                <h3>Configure Modules</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{selectedWorkshop.name}</p>
              </div>
              <button className="sa-modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            <div className="sa-modal-body" style={{ padding: 0 }}>
              {/* Toolbar */}
              <div className="sam-modal-toolbar">
                <button className="sa-btn secondary small" onClick={selectAll}>
                  <GridPlus size={15} /> Select All
                </button>
                <button className="sa-btn secondary small" onClick={deselectAll}>
                  <GridMinus size={15} /> Deselect All
                </button>
                <span className="sam-selected-tag">
                  <CheckCircle size={14} />
                  {selectedModules.length} / {modules.length}
                </span>
              </div>

              {/* Category sections */}
              <div className="sam-modal-categories">
                {Object.entries(groupedModules).map(([category, catModules]) => {
                  const cat = getCatMeta(category);
                  const CatIcon = cat.icon;
                  const allSelected = catModules.every(m => selectedModules.includes(m.id));
                  const someSelected = catModules.some(m => selectedModules.includes(m.id));

                  return (
                    <div key={category} className="sam-cfg-category">
                      <div className="sam-cfg-cat-header">
                        <div className="sam-cfg-cat-left">
                          <div className="sam-cat-icon small" style={{ background: cat.bg, color: cat.color }}>
                            <CatIcon size={16} />
                          </div>
                          <span className="sam-cfg-cat-name">{category}</span>
                          <span className="sam-cfg-cat-count">
                            {catModules.filter(m => selectedModules.includes(m.id)).length}/{catModules.length}
                          </span>
                        </div>
                        <button
                          className={`sam-toggle-cat ${allSelected ? 'active' : someSelected ? 'partial' : ''}`}
                          onClick={() => toggleCategory(catModules)}
                        >
                          {allSelected ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>

                      <div className="sam-cfg-modules-grid">
                        {catModules.map(mod => {
                          const meta = getModuleMeta(mod.id);
                          const ModIcon = meta.icon;
                          const checked = selectedModules.includes(mod.id);
                          return (
                            <label
                              key={mod.id}
                              className={`sam-cfg-module ${checked ? 'checked' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleModule(mod.id)}
                              />
                              <div className="sam-cfg-mod-icon" style={{
                                background: checked ? meta.color + '18' : '#f1f5f9',
                                color: checked ? meta.color : '#94a3b8',
                              }}>
                                <ModIcon size={18} />
                              </div>
                              <div className="sam-cfg-mod-text">
                                <span className="sam-cfg-mod-name">{mod.name}</span>
                                <span className="sam-cfg-mod-ar">{mod.nameAr}</span>
                              </div>
                              <div className={`sam-cfg-check ${checked ? 'on' : ''}`}>
                                {checked ? <CheckCircle size={18} /> : <div className="sam-cfg-check-empty" />}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="sa-modal-footer">
              <button className="sa-btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="sa-btn primary" onClick={saveModules} disabled={saving}>
                <FloppyDisk size={16} />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminModules;


