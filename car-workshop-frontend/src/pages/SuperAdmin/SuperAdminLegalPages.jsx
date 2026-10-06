import { useState, useEffect } from 'react';
import {
  Page, EditPencil, Eye, EyeClosed, CheckCircle, WarningTriangle,
  RefreshDouble, Globe
} from 'iconoir-react';
import './SuperAdmin.css';
import HtmlPreview from '../../components/HtmlPreview';

const API = import.meta.env.VITE_API_URL || '/api';
const hdrs = () => ({
  Authorization: `Bearer ${localStorage.getItem('superAdminToken')}`,
  'Content-Type': 'application/json',
});

const SLUG_LABELS = {
  'privacy-policy': { en: 'Privacy Policy', ar: 'سياسة الخصوصية', icon: '🔒' },
  'terms-and-conditions': { en: 'Terms & Conditions', ar: 'الشروط والأحكام', icon: '📜' },
};

const SuperAdminLegalPages = () => {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingSlug, setEditingSlug] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('en'); // 'en' | 'ar'
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => { fetchPages(); }, []);

  const fetchPages = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/super-admin/legal-pages`, { headers: hdrs() });
      if (r.ok) {
        const d = await r.json();
        setPages(d.pages || []);
      }
    } catch (_) {}
    setLoading(false);
  };

  const openEditor = (page) => {
    setEditingSlug(page.slug);
    setForm({
      title_en: page.title_en || '',
      title_ar: page.title_ar || '',
      content_en: page.content_en || '',
      content_ar: page.content_ar || '',
      is_published: !!page.is_published,
    });
    setPreview(false);
    setTab('en');
  };

  const savePage = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API}/super-admin/legal-pages/${editingSlug}`, {
        method: 'PUT',
        headers: hdrs(),
        body: JSON.stringify(form),
      });
      if (r.ok) {
        showToast('Legal page updated successfully!', 'success');
        setEditingSlug(null);
        fetchPages();
      } else {
        const d = await r.json();
        showToast(d.error || 'Failed to save', 'error');
      }
    } catch (_) {
      showToast('Network error — please try again.', 'error');
    }
    setSaving(false);
  };

  const togglePublish = async (slug, currentState) => {
    try {
      const page = pages.find(p => p.slug === slug);
      if (!page) return;
      const r = await fetch(`${API}/super-admin/legal-pages/${slug}`, {
        method: 'PUT',
        headers: hdrs(),
        body: JSON.stringify({
          title_en: page.title_en,
          title_ar: page.title_ar,
          content_en: page.content_en,
          content_ar: page.content_ar,
          is_published: !currentState,
        }),
      });
      if (r.ok) {
        showToast(`Page ${!currentState ? 'published' : 'unpublished'} successfully!`, 'success');
        fetchPages();
      }
    } catch (_) {
      showToast('Failed to toggle publish status.', 'error');
    }
  };

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';

  // ─── Editor view ───
  if (editingSlug) {
    const slugCfg = SLUG_LABELS[editingSlug] || { en: editingSlug, icon: '📄' };
    return (
      <div className="sa-page">
        {toast && (
          <div className={`sa-toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={16} /> : <WarningTriangle size={16} />}
            {toast.message}
          </div>
        )}

        <div className="sa-page-header" style={{ marginBottom: 24 }}>
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>{slugCfg.icon}</span>
              Edit: {slugCfg.en}
            </h1>
            <p style={{ color: '#64748b', marginTop: 4 }}>
              Edit the content for both English and Arabic. Toggle publish when ready.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              className="sa-btn secondary"
              onClick={() => setEditingSlug(null)}
            >
              ← Back
            </button>
            <button
              className="sa-btn primary"
              onClick={savePage}
              disabled={saving}
            >
              {saving ? 'Saving…' : '💾 Save Changes'}
            </button>
          </div>
        </div>

        {/* Language tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e2e8f0' }}>
          {[
            { key: 'en', label: '🇺🇸 English' },
            { key: 'ar', label: '🇸🇦 Arabic' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setPreview(false); }}
              style={{
                padding: '10px 24px',
                border: 'none',
                background: tab === t.key ? '#fff' : 'transparent',
                borderBottom: tab === t.key ? '2px solid #3b82f6' : '2px solid transparent',
                marginBottom: -2,
                fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? '#3b82f6' : '#64748b',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setPreview(!preview)}
            style={{
              padding: '8px 16px',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              background: preview ? '#3b82f6' : '#fff',
              color: preview ? '#fff' : '#334155',
              cursor: 'pointer',
              fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 6,
              marginBottom: 4,
            }}
          >
            <Eye size={14} /> {preview ? 'Edit' : 'Preview'}
          </button>
        </div>

        {/* Publish toggle */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
          padding: '12px 16px', background: form.is_published ? '#ecfdf5' : '#fef3c7',
          borderRadius: 8, border: `1px solid ${form.is_published ? '#bbf7d0' : '#fde68a'}`,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={e => setForm({ ...form, is_published: e.target.checked })}
              style={{ width: 18, height: 18 }}
            />
            <span style={{ fontWeight: 600, color: form.is_published ? '#16a34a' : '#d97706' }}>
              {form.is_published ? '✅ Published — visible to mobile app users' : '⚠️ Draft — not visible to mobile app users'}
            </span>
          </label>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, color: '#334155', fontSize: 13 }}>
            Title ({tab === 'ar' ? 'Arabic' : 'English'})
          </label>
          <input
            type="text"
            value={tab === 'ar' ? form.title_ar : form.title_en}
            onChange={e => setForm({ ...form, [tab === 'ar' ? 'title_ar' : 'title_en']: e.target.value })}
            dir={tab === 'ar' ? 'rtl' : 'ltr'}
            style={{
              width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0',
              borderRadius: 8, fontSize: 15, boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Content */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, color: '#334155', fontSize: 13 }}>
            Content ({tab === 'ar' ? 'Arabic' : 'English'}) — HTML supported
          </label>
          {preview ? (
            <div
              style={{
                border: '1px solid #e2e8f0', borderRadius: 8, padding: 24,
                minHeight: 400, background: '#fff',
              }}
            >
              <HtmlPreview
                html={tab === 'ar' ? form.content_ar : form.content_en}
                dir={tab === 'ar' ? 'rtl' : 'ltr'}
                minHeight={360}
              />
            </div>
          ) : (
            <textarea
              value={tab === 'ar' ? form.content_ar : form.content_en}
              onChange={e => setForm({ ...form, [tab === 'ar' ? 'content_ar' : 'content_en']: e.target.value })}
              dir={tab === 'ar' ? 'rtl' : 'ltr'}
              rows={20}
              style={{
                width: '100%', padding: '14px', border: '1px solid #e2e8f0',
                borderRadius: 8, fontSize: 14, fontFamily: 'monospace',
                resize: 'vertical', boxSizing: 'border-box',
                lineHeight: 1.6,
              }}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 12 }}>
          <button className="sa-btn secondary" onClick={() => setEditingSlug(null)}>Cancel</button>
          <button className="sa-btn primary" onClick={savePage} disabled={saving}>
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    );
  }

  // ─── List view ───
  return (
    <div className="sa-page">
      {toast && (
        <div className={`sa-toast ${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <WarningTriangle size={16} />}
          {toast.message}
        </div>
      )}

      <div className="sa-page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Page size={28} /> Legal Pages
          </h1>
          <p style={{ color: '#64748b', marginTop: 4 }}>
            Manage Privacy Policy and Terms &amp; Conditions displayed in the mobile app.
          </p>
        </div>
        <button className="sa-btn secondary" onClick={fetchPages} disabled={loading}>
          <RefreshDouble size={16} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{
          background: '#fff', borderRadius: 12, padding: '20px 24px',
          border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Page size={22} color="#3b82f6" />
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#1e293b' }}>{pages.length}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Total Pages</div>
          </div>
        </div>
        <div style={{
          background: '#fff', borderRadius: 12, padding: '20px 24px',
          border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Eye size={22} color="#16a34a" />
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#1e293b' }}>
              {pages.filter(p => p.is_published).length}
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Published</div>
          </div>
        </div>
        <div style={{
          background: '#fff', borderRadius: 12, padding: '20px 24px',
          border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EyeClosed size={22} color="#d97706" />
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#1e293b' }}>
              {pages.filter(p => !p.is_published).length}
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Drafts</div>
          </div>
        </div>
      </div>

      {/* Mobile API info banner */}
      <div style={{
        background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10,
        padding: '14px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Globe size={20} color="#0284c7" />
        <div style={{ fontSize: 13, color: '#0369a1' }}>
          <strong>Mobile App API:</strong>{' '}
          <code style={{ background: '#e0f2fe', padding: '2px 8px', borderRadius: 4 }}>
            GET /api/public/legal/privacy-policy?lang=en
          </code>{' '}
          and{' '}
          <code style={{ background: '#e0f2fe', padding: '2px 8px', borderRadius: 4 }}>
            GET /api/public/legal/terms-and-conditions?lang=ar
          </code>
        </div>
      </div>

      {/* Page cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 16px' }}></div>
          Loading legal pages…
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {pages.map(page => {
            const cfg = SLUG_LABELS[page.slug] || { en: page.slug, ar: page.slug, icon: '📄' };
            return (
              <div key={page.slug} style={{
                background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
                padding: '24px', display: 'flex', alignItems: 'center', gap: 20,
                transition: 'box-shadow 0.15s',
              }}>
                <div style={{
                  width: 54, height: 54, borderRadius: 12,
                  background: page.is_published ? '#ecfdf5' : '#fef3c7',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, flexShrink: 0,
                }}>
                  {cfg.icon}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b', marginBottom: 4 }}>
                    {cfg.en}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 2 }}>
                    {cfg.ar}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    Last updated: {fmtDate(page.updated_at)}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    background: page.is_published ? '#ecfdf5' : '#fef3c7',
                    color: page.is_published ? '#16a34a' : '#d97706',
                    border: `1px solid ${page.is_published ? '#bbf7d0' : '#fde68a'}`,
                  }}>
                    {page.is_published ? 'Published' : 'Draft'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => togglePublish(page.slug, page.is_published)}
                    title={page.is_published ? 'Unpublish' : 'Publish'}
                    style={{
                      padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
                      background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 13,
                    }}
                  >
                    {page.is_published ? <EyeClosed size={16} /> : <Eye size={16} />}
                    {page.is_published ? 'Unpublish' : 'Publish'}
                  </button>
                  <button
                    onClick={() => openEditor(page)}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none',
                      background: '#3b82f6', color: '#fff', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    <EditPencil size={16} /> Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SuperAdminLegalPages;
