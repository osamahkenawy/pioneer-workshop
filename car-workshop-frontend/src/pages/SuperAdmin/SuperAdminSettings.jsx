import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings, FloppyDisk, Refresh, Mail, Globe,
  ShieldCheck, Building, Calendar, Lock, Check
} from 'iconoir-react';
import './SuperAdmin.css';
import { CardListSkeleton } from '../../components/Loader';
import { useSAToast } from './SAToastContext';
const API = import.meta.env.VITE_API_URL || '/api';

const SuperAdminSettings = () => {
  const { t } = useTranslation();
  const showToast = useSAToast();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('superAdminToken');
      const res = await fetch(`${API}/super-admin/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSettings(await res.json());
      else showToast('Failed to load settings', 'error');
    } catch (e) {
      console.error('Failed to fetch settings:', e);
      showToast('Connection error loading settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const token = localStorage.getItem('superAdminToken');
      const res = await fetch(`${API}/super-admin/settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setSaved(true);
        showToast('Settings saved successfully');
        setTimeout(() => setSaved(false), 3000);
      } else {
        showToast('Failed to save settings', 'error');
      }
    } catch (e) {
      console.error('Failed to save settings:', e);
      showToast('Connection error saving settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const update = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Building },
    { id: 'email', label: 'Email / SMTP', icon: Mail },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'localization', label: 'Localization', icon: Globe },
  ];

  if (loading) {
    return (
      <div className="sa-settings">
        <CardListSkeleton count={6} />
      </div>
    );
  }

  return (
    <div className="sa-page">
      <div className="sa-page-header">
        <div>
          <h1>Platform Settings</h1>
          <p>Configure global platform settings</p>
        </div>
        <div className="sa-header-actions">
          {saved && (
            <span className="sa-saved-notice"><Check size={16} /> Saved</span>
          )}
          <button className="sa-primary-btn" onClick={handleSave} disabled={saving}>
            <FloppyDisk size={18} />
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      <div className="sa-settings-layout">
        {/* Tabs */}
        <div className="sa-settings-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`sa-settings-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={18} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="sa-settings-content">

          {activeTab === 'general' && (
            <div className="sa-card">
              <div className="sa-card-header"><h2>General Settings</h2></div>
              <div className="sa-form-grid">
                <div className="sa-form-group">
                  <label>Platform Name</label>
                  <input type="text" value={settings.platform_name || ''} onChange={e => update('platform_name', e.target.value)} />
                </div>
                <div className="sa-form-group">
                  <label>Platform Email</label>
                  <input type="email" value={settings.platform_email || ''} onChange={e => update('platform_email', e.target.value)} />
                </div>
                <div className="sa-form-group">
                  <label>Support Email</label>
                  <input type="email" value={settings.support_email || ''} onChange={e => update('support_email', e.target.value)} />
                </div>
                <div className="sa-form-group">
                  <label>Max Workshops</label>
                  <input type="number" value={settings.max_workshops || ''} onChange={e => update('max_workshops', e.target.value)} />
                </div>
                <div className="sa-form-group">
                  <label>Trial Period (days)</label>
                  <input type="number" value={settings.trial_days || ''} onChange={e => update('trial_days', e.target.value)} />
                </div>
                <div className="sa-form-group">
                  <label>Default Currency</label>
                  <select value={settings.default_currency || 'AED'} onChange={e => update('default_currency', e.target.value)}>
                    <option value="AED">AED - UAE Dirham</option>
                    <option value="USD">USD - US Dollar</option>
                    <option value="EUR">EUR - Euro</option>
                    <option value="GBP">GBP - British Pound</option>
                    <option value="SAR">SAR - Saudi Riyal</option>
                    <option value="QAR">QAR - Qatari Riyal</option>
                  </select>
                </div>
              </div>

              <div className="sa-form-group sa-form-toggle-group">
                <div className="sa-toggle-row">
                  <div>
                    <strong>Maintenance Mode</strong>
                    <p>When enabled, only super admins can access the platform</p>
                  </div>
                  <label className="sa-toggle">
                    <input type="checkbox" checked={settings.maintenance_mode === 'true'} onChange={e => update('maintenance_mode', String(e.target.checked))} />
                    <span className="sa-toggle-slider" />
                  </label>
                </div>
                <div className="sa-toggle-row">
                  <div>
                    <strong>Allow Registration</strong>
                    <p>Allow new workshops to self-register on the platform</p>
                  </div>
                  <label className="sa-toggle">
                    <input type="checkbox" checked={settings.allow_registration === 'true'} onChange={e => update('allow_registration', String(e.target.checked))} />
                    <span className="sa-toggle-slider" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'email' && (
            <div className="sa-card">
              <div className="sa-card-header"><h2>Email / SMTP Configuration</h2></div>
              <div className="sa-form-grid">
                <div className="sa-form-group">
                  <label>SMTP Host</label>
                  <input type="text" value={settings.smtp_host || ''} onChange={e => update('smtp_host', e.target.value)} placeholder="smtp.gmail.com" />
                </div>
                <div className="sa-form-group">
                  <label>SMTP Port</label>
                  <input type="number" value={settings.smtp_port || ''} onChange={e => update('smtp_port', e.target.value)} placeholder="587" />
                </div>
                <div className="sa-form-group">
                  <label>SMTP Username</label>
                  <input type="text" value={settings.smtp_user || ''} onChange={e => update('smtp_user', e.target.value)} placeholder="user@example.com" />
                </div>
                <div className="sa-form-group">
                  <label>From Address</label>
                  <input type="email" value={settings.smtp_from || ''} onChange={e => update('smtp_from', e.target.value)} placeholder="noreply@pioneercarservice.com" />
                </div>
              </div>
              <div className="sa-info-box">
                <ShieldCheck size={18} />
                <span>SMTP passwords are managed through environment variables for security.</span>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="sa-card">
              <div className="sa-card-header"><h2>Security Settings</h2></div>
              <div className="sa-form-group sa-form-toggle-group">
                <div className="sa-toggle-row">
                  <div>
                    <strong>Two-Factor Authentication</strong>
                    <p>Require 2FA for all super admin accounts</p>
                  </div>
                  <label className="sa-toggle">
                    <input type="checkbox" checked={settings.require_2fa === 'true'} onChange={e => update('require_2fa', String(e.target.checked))} />
                    <span className="sa-toggle-slider" />
                  </label>
                </div>
                <div className="sa-toggle-row">
                  <div>
                    <strong>Force Password Reset</strong>
                    <p>Force all workshop admins to reset passwords on next login</p>
                  </div>
                  <label className="sa-toggle">
                    <input type="checkbox" checked={settings.force_password_reset === 'true'} onChange={e => update('force_password_reset', String(e.target.checked))} />
                    <span className="sa-toggle-slider" />
                  </label>
                </div>
                <div className="sa-toggle-row">
                  <div>
                    <strong>IP Whitelisting</strong>
                    <p>Restrict super admin access to specific IP addresses</p>
                  </div>
                  <label className="sa-toggle">
                    <input type="checkbox" checked={settings.ip_whitelist_enabled === 'true'} onChange={e => update('ip_whitelist_enabled', String(e.target.checked))} />
                    <span className="sa-toggle-slider" />
                  </label>
                </div>
              </div>
              <div className="sa-form-grid">
                <div className="sa-form-group sa-full-width">
                  <label>Session Timeout (minutes)</label>
                  <input type="number" value={settings.session_timeout || '1440'} onChange={e => update('session_timeout', e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'localization' && (
            <div className="sa-card">
              <div className="sa-card-header"><h2>Localization</h2></div>
              <div className="sa-form-grid">
                <div className="sa-form-group">
                  <label>Default Language</label>
                  <select value={settings.default_language || 'en'} onChange={e => update('default_language', e.target.value)}>
                    <option value="en">English</option>
                    <option value="ar">العربية (Arabic)</option>
                    <option value="es">Español (Spanish)</option>
                    <option value="pt">Português (Portuguese)</option>
                    <option value="hi">हिन्दी (Hindi)</option>
                    <option value="tl">Tagalog</option>
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Timezone</label>
                  <select value={settings.timezone || 'Asia/Dubai'} onChange={e => update('timezone', e.target.value)}>
                    <option value="Asia/Dubai">Asia/Dubai (GST +4)</option>
                    <option value="Asia/Riyadh">Asia/Riyadh (AST +3)</option>
                    <option value="Europe/London">Europe/London (GMT)</option>
                    <option value="America/New_York">America/New_York (EST -5)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PST -8)</option>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
                  </select>
                </div>
                <div className="sa-form-group">
                  <label>Date Format</label>
                  <select value={settings.date_format || 'DD/MM/YYYY'} onChange={e => update('date_format', e.target.value)}>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SuperAdminSettings;
