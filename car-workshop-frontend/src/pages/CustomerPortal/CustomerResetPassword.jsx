/* ══════════════════════════════════════════════════════════════
 * CustomerResetPassword.jsx — Password Reset Landing Page
 * ══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, CheckCircle, WarningTriangle, EyeClosed, Eye } from 'iconoir-react';
import './CustomerAuth.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function CustomerResetPassword() {
  const [params] = useSearchParams();
  const navigate  = useNavigate();
  const token     = params.get('token') || '';

  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [status, setStatus]       = useState('form'); // form | success | error
  const [message, setMessage]     = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setMessage('Passwords do not match'); return; }
    if (password.length < 6) { setMessage('Password must be at least 6 characters'); return; }
    setLoading(true); setMessage('');

    try {
      const res = await fetch(`${API_URL}/customer-auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json();
      if (data.success) setStatus('success');
      else { setStatus('error'); setMessage(data.message || 'Reset failed'); }
    } catch { setStatus('error'); setMessage('Request failed'); }
    setLoading(false);
  };

  return (
    <div className="ca-page">
      <div className="ca-panel-form" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: '100%' }}>
        <div className="ca-form-container">
          {!token && (
            <div style={{ textAlign: 'center' }}>
              <WarningTriangle width={56} height={56} style={{ color: '#ef4444', margin: '0 auto 16px' }} />
              <h2>Missing Token</h2>
              <p className="ca-subtitle">This reset link is invalid or expired.</p>
              <button className="ca-btn" onClick={() => navigate('/merchant/login')} style={{ marginTop: 24 }}>Back to Login</button>
            </div>
          )}

          {token && status === 'form' && (
            <>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <Lock width={40} height={40} style={{ color: '#f97316', margin: '0 auto 12px' }} />
                <h2 style={{ color: '#0f172a', margin: 0 }}>Reset Password</h2>
                <p className="ca-subtitle">Enter your new password below</p>
              </div>

              {message && <div className="ca-alert ca-alert-error"><WarningTriangle width={16} height={16} />{message}</div>}

              <form onSubmit={handleSubmit}>
                <div className="ca-field">
                  <label className="ca-label">New Password</label>
                  <div className="ca-input-wrap">
                    <Lock width={18} height={18} />
                    <input type={showPw ? 'text' : 'password'} className="ca-input" placeholder="••••••••"
                      value={password} onChange={e => setPassword(e.target.value)} required />
                    <button type="button" className="ca-eye-btn" onClick={() => setShowPw(!showPw)}>
                      {showPw ? <EyeClosed width={18} height={18} /> : <Eye width={18} height={18} />}
                    </button>
                  </div>
                </div>
                <div className="ca-field">
                  <label className="ca-label">Confirm Password</label>
                  <div className="ca-input-wrap">
                    <Lock width={18} height={18} />
                    <input type="password" className="ca-input" placeholder="••••••••"
                      value={confirm} onChange={e => setConfirm(e.target.value)} required />
                  </div>
                </div>
                <button type="submit" className="ca-btn" disabled={loading}>
                  {loading ? <span className="ca-spinner" style={{ width: 20, height: 20 }} /> : 'Reset Password'}
                </button>
              </form>
            </>
          )}

          {status === 'success' && (
            <div style={{ textAlign: 'center' }}>
              <CheckCircle width={56} height={56} style={{ color: '#22c55e', margin: '0 auto 16px' }} />
              <h2 style={{ color: '#0f172a' }}>Password Reset!</h2>
              <p className="ca-subtitle">Your password has been updated. You can now log in.</p>
              <button className="ca-btn" onClick={() => navigate('/merchant/login')} style={{ marginTop: 24 }}>Go to Login</button>
            </div>
          )}

          {status === 'error' && (
            <div style={{ textAlign: 'center' }}>
              <WarningTriangle width={56} height={56} style={{ color: '#ef4444', margin: '0 auto 16px' }} />
              <h2 style={{ color: '#0f172a' }}>Reset Failed</h2>
              <p className="ca-subtitle">{message}</p>
              <button className="ca-btn" onClick={() => navigate('/merchant/login')} style={{ marginTop: 24 }}>Back to Login</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
