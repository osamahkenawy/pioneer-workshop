import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'iconoir-react';

const API = import.meta.env.VITE_API_URL || '/api';

export default function SuperAdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/super-admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('superAdminToken', data.token);
        navigate('/super-admin/dashboard');
      } else {
        setError(data.error || data.message || 'Invalid credentials');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #020617 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: '1rem',
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64,
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
            borderRadius: 16, marginBottom: '1rem',
            boxShadow: '0 8px 24px rgba(99,102,241,0.45)',
          }}>
            <span style={{ fontSize: 28 }}><ShieldCheck width={28} height={28} style={{ color: '#fff' }} /></span>
          </div>
          <h1 style={{ color: '#fff', fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>
            Pioneer Car Service Center
          </h1>
          <p style={{ color: '#94a3b8', marginTop: 6, fontSize: '0.95rem' }}>
            Delivery Platform Administration
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 20, padding: '2rem',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }}>
          <h2 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 600, marginTop: 0, marginBottom: 4 }}>
            Super Admin Access
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.75rem' }}>
            Restricted to platform administrators only
          </p>

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.4)',
              color: '#fca5a5', borderRadius: 10,
              padding: '0.75rem 1rem', marginBottom: '1.25rem',
              fontSize: '0.875rem',
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 500, display: 'block', marginBottom: 6 }}>
                USERNAME
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter admin username"
                required
                style={{
                  width: '100%', padding: '0.75rem 1rem',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, color: '#fff', fontSize: '0.95rem',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '1.75rem' }}>
              <label style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 500, display: 'block', marginBottom: 6 }}>
                PASSWORD
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  required
                  style={{
                    width: '100%', padding: '0.75rem 3rem 0.75rem 1rem',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, color: '#fff', fontSize: '0.95rem',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 16, color: '#64748b',
                  }}
                >
                  {showPass ? '\u{1F648}' : '\u{1F441}\uFE0F'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '0.875rem',
                background: loading
                  ? 'rgba(99,102,241,0.5)'
                  : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                color: '#fff', border: 'none', borderRadius: 10,
                fontSize: '1rem', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 4px 16px rgba(99,102,241,0.45)',
              }}
            >
              {loading ? 'Authenticating...' : 'Access Admin Panel'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', color: '#475569', fontSize: '0.85rem' }}>
          Back to{' '}
          <a
            href="/login"
            style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}
          >
            Delivery Login &rarr;
          </a>
        </p>
      </div>
    </div>
  );
}
