/* ══════════════════════════════════════════════════════════════
 * CustomerVerifyEmail.jsx — Email Verification Landing Page
 * ══════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, WarningTriangle, Mail } from 'iconoir-react';
import './CustomerAuth.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function CustomerVerifyEmail() {
  const [params] = useSearchParams();
  const navigate  = useNavigate();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setStatus('error'); setMessage('Missing verification token.'); return; }

    (async () => {
      try {
        const res = await fetch(`${API_URL}/customer-auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (data.success) { setStatus('success'); setMessage('Your email has been verified!'); }
        else { setStatus('error'); setMessage(data.message || 'Verification failed'); }
      } catch { setStatus('error'); setMessage('Verification request failed'); }
    })();
  }, [params]);

  return (
    <div className="ca-page">
      <div className="ca-panel-form" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: '100%' }}>
        <div className="ca-form-container" style={{ textAlign: 'center' }}>
          {status === 'loading' && (
            <>
              <div className="ca-spinner-wrap"><div className="ca-spinner" /></div>
              <h2>Verifying your email…</h2>
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle width={56} height={56} style={{ color: '#22c55e', margin: '0 auto 16px' }} />
              <h2 style={{ color: '#0f172a' }}>Email Verified!</h2>
              <p className="ca-subtitle">{message}</p>
              <button className="ca-btn" onClick={() => navigate('/merchant/login')} style={{ marginTop: 24 }}>
                <Mail width={18} height={18} /> Go to Login
              </button>
            </>
          )}
          {status === 'error' && (
            <>
              <WarningTriangle width={56} height={56} style={{ color: '#ef4444', margin: '0 auto 16px' }} />
              <h2 style={{ color: '#0f172a' }}>Verification Failed</h2>
              <p className="ca-subtitle">{message}</p>
              <button className="ca-btn" onClick={() => navigate('/merchant/login')} style={{ marginTop: 24 }}>
                Back to Login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
