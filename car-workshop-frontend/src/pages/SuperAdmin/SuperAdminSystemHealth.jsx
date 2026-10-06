import { useState, useEffect } from 'react';
import {
  Activity, Server, Database, Cpu, HardDrive,
  Refresh, Clock, CheckCircle, WarningTriangle, CloudSync
} from 'iconoir-react';
import './SuperAdmin.css';

const API = import.meta.env.VITE_API_URL || '/api';
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('superAdminToken')}` });

const SuperAdminSystemHealth = () => {
  const [health, setHealth] = useState(null);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => { fetchHealth(); }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const fetchHealth = async () => {
    try {
      const [healthRes, tablesRes] = await Promise.all([
        fetch(`${API}/super-admin/system-health`, { headers: headers() }),
        fetch(`${API}/super-admin/system-health/tables`, { headers: headers() })
      ]);
      if (healthRes.ok) setHealth(await healthRes.json());
      if (tablesRes.ok) setTables(await tablesRes.json());
    } catch (e) {
      console.error('Health fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  const getHealthStatus = () => {
    if (!health) return { label: 'Unknown', color: '#6b7280', icon: <Clock size={20} /> };
    const memPct = parseFloat(health.memory?.usage_percent || 0);
    const load = parseFloat(health.server?.load_average?.[0] || 0);
    if (memPct > 90 || load > health.server?.cpu_count) return { label: 'Critical', color: '#ef4444', icon: <WarningTriangle size={20} /> };
    if (memPct > 70 || load > health.server?.cpu_count * 0.7) return { label: 'Warning', color: '#f59e0b', icon: <WarningTriangle size={20} /> };
    return { label: 'Healthy', color: '#10b981', icon: <CheckCircle size={20} /> };
  };

  const status = getHealthStatus();

  if (loading) return <div className="sa-loading-page"><div className="loading-spinner"></div><p>Checking system health...</p></div>;

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>System Health</h1>
          <p>Monitor server performance, database, and platform health</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (15s)
          </label>
          <button className="sa-primary-btn" onClick={fetchHealth}>
            <Refresh size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Overall Status Banner */}
      <div className="sa-health-banner" style={{ background: `${status.color}10`, borderColor: status.color, borderWidth: 2, borderStyle: 'solid', borderRadius: 16, padding: 20, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: `${status.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: status.color }}>
          {status.icon}
        </div>
        <div>
          <h2 style={{ margin: 0, color: status.color }}>{status.label}</h2>
          <p style={{ margin: 0, color: '#6b7280' }}>Last checked: {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : '—'}</p>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{health?.server?.hostname}</p>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>{health?.server?.platform} / {health?.server?.arch} / Node {health?.server?.node_version}</p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="sa-stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="sa-stat-card">
          <div className="sa-stat-icon primary"><Clock size={22} /></div>
          <div className="sa-stat-content">
            <h3>{health?.server?.uptime_formatted || '—'}</h3>
            <p>Uptime</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon warning"><Cpu size={22} /></div>
          <div className="sa-stat-content">
            <h3>{health?.server?.load_average?.[0] || '—'}</h3>
            <p>Load Average (1m)</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon" style={{ background: parseFloat(health?.memory?.usage_percent || 0) > 80 ? '#fee2e2' : '#dcfce7', color: parseFloat(health?.memory?.usage_percent || 0) > 80 ? '#ef4444' : '#16a34a' }}>
            <HardDrive size={22} />
          </div>
          <div className="sa-stat-content">
            <h3>{health?.memory?.usage_percent || 0}%</h3>
            <p>Memory Usage</p>
          </div>
        </div>
        <div className="sa-stat-card">
          <div className="sa-stat-icon info"><Database size={22} /></div>
          <div className="sa-stat-content">
            <h3>{health?.database?.size_mb || 0} MB</h3>
            <p>Database Size</p>
          </div>
        </div>
      </div>

      {/* Detailed Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Server */}
        <div className="sa-card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}><Server size={20} /> Server</h3>
          <div className="sa-detail-grid">
            <div className="sa-detail-row"><label>Platform</label><span>{health?.server?.platform} / {health?.server?.arch}</span></div>
            <div className="sa-detail-row"><label>CPU</label><span>{health?.server?.cpu_count} × {health?.server?.cpu_model}</span></div>
            <div className="sa-detail-row"><label>Node.js</label><span>{health?.server?.node_version}</span></div>
            <div className="sa-detail-row"><label>Load (1/5/15m)</label><span>{health?.server?.load_average?.join(' / ')}</span></div>
            <div className="sa-detail-row"><label>Uptime</label><span>{health?.server?.uptime_formatted}</span></div>
          </div>
        </div>

        {/* Memory */}
        <div className="sa-card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}><HardDrive size={20} /> Memory</h3>
          <div className="sa-detail-grid">
            <div className="sa-detail-row"><label>Total</label><span>{(health?.memory?.total_mb / 1024).toFixed(1)} GB</span></div>
            <div className="sa-detail-row"><label>Used</label><span>{(health?.memory?.used_mb / 1024).toFixed(1)} GB ({health?.memory?.usage_percent}%)</span></div>
            <div className="sa-detail-row"><label>Free</label><span>{(health?.memory?.free_mb / 1024).toFixed(1)} GB</span></div>
            <div className="sa-detail-row"><label>Process RSS</label><span>{health?.memory?.process_rss_mb} MB</span></div>
            <div className="sa-detail-row"><label>Process Heap</label><span>{health?.memory?.process_heap_mb} / {health?.memory?.process_heap_total_mb} MB</span></div>
          </div>
          {/* Memory bar */}
          <div style={{ background: '#f1f5f9', borderRadius: 8, height: 12, marginTop: 12, overflow: 'hidden' }}>
            <div style={{ background: parseFloat(health?.memory?.usage_percent || 0) > 80 ? '#ef4444' : '#10b981', width: `${health?.memory?.usage_percent || 0}%`, height: '100%', borderRadius: 8, transition: 'width 0.5s' }} />
          </div>
        </div>

        {/* Database */}
        <div className="sa-card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}><Database size={20} /> Database</h3>
          <div className="sa-detail-grid">
            <div className="sa-detail-row"><label>Size</label><span>{health?.database?.size_mb} MB</span></div>
            <div className="sa-detail-row"><label>Tables</label><span>{health?.database?.table_count}</span></div>
            <div className="sa-detail-row"><label>Total Rows</label><span>{Number(health?.database?.total_rows || 0).toLocaleString()}</span></div>
            <div className="sa-detail-row"><label>Active Connections</label><span>{health?.database?.active_connections}</span></div>
          </div>
        </div>

        {/* Activity */}
        <div className="sa-card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}><Activity size={20} /> Activity</h3>
          <div className="sa-detail-grid">
            <div className="sa-detail-row"><label>Active Workshops (24h)</label><span>{health?.activity?.active_workshops_today}</span></div>
            <div className="sa-detail-row"><label>Errors (24h)</label><span style={{ color: (health?.activity?.recent_errors || 0) > 0 ? '#ef4444' : '#10b981' }}>{health?.activity?.recent_errors}</span></div>
          </div>
        </div>
      </div>

      {/* Database Tables */}
      <div className="sa-card" style={{ padding: 24 }}>
        <h3 style={{ margin: '0 0 16px' }}>Database Tables ({tables.length})</h3>
        <div className="sa-table-container" style={{ maxHeight: 400, overflow: 'auto' }}>
          <table className="sa-table">
            <thead>
              <tr>
                <th>Table</th>
                <th style={{ textAlign: 'right' }}>Rows</th>
                <th style={{ textAlign: 'right' }}>Data (MB)</th>
                <th style={{ textAlign: 'right' }}>Index (MB)</th>
                <th style={{ textAlign: 'right' }}>Total (MB)</th>
                <th style={{ width: 150 }}>Size</th>
              </tr>
            </thead>
            <tbody>
              {tables.map(t => {
                const maxSize = Math.max(...tables.map(x => parseFloat(x.total_mb) || 0), 0.01);
                const pct = ((parseFloat(t.total_mb) || 0) / maxSize * 100);
                return (
                  <tr key={t.name}>
                    <td><code style={{ fontSize: 13 }}>{t.name}</code></td>
                    <td style={{ textAlign: 'right' }}>{Number(t.rows || 0).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{t.data_mb}</td>
                    <td style={{ textAlign: 'right' }}>{t.index_mb}</td>
                    <td style={{ textAlign: 'right' }}><strong>{t.total_mb}</strong></td>
                    <td>
                      <div style={{ background: '#f1f5f9', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{ background: '#3b82f6', width: `${pct}%`, height: '100%', borderRadius: 4 }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminSystemHealth;
