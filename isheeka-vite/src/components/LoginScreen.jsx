// Email/password sign-in + forgot-password (ported verbatim from isheeka-erp-v22.html).
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      onLogin(data.user);
    } catch { setError('Invalid email or password. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleForgot = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail);
      if (error) throw error;
      setForgotSuccess(true);
    } catch { setError('Could not send reset email. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div style={{ fontSize: 48, marginBottom: 8 }}>🌸</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#e8185a', letterSpacing: '.02em' }}>ISHEEKA EVENTS</div>
          <div className="tagline">Making Every Event Memorable</div>
        </div>
        {mode === 'login' ? (
          <>
            <div className="login-title">Welcome back</div>
            <div className="login-sub">Sign in to your account</div>
            {error && <div className="error-msg">{error}</div>}
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@isheeka.com" required />
              </div>
              <div className="form-group password-wrap">
                <label>Password</label>
                <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required />
                <button type="button" className="eye-btn" onClick={() => setShowPass(!showPass)}>{showPass ? '🙈' : '👁'}</button>
              </div>
              <button type="submit" className="login-btn" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
            </form>
            <div className="forgot-link"><a href="#" onClick={(e) => { e.preventDefault(); setMode('forgot'); setError(''); }}>Forgot password?</a></div>
          </>
        ) : (
          <>
            <div className="login-title">Reset password</div>
            <div className="login-sub">We'll send a reset link to your email</div>
            {error && <div className="error-msg">{error}</div>}
            {forgotSuccess ? <div className="success-msg">✅ Reset link sent! Check your email inbox.</div> : (
              <form onSubmit={handleForgot}>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@isheeka.com" required />
                </div>
                <button type="submit" className="login-btn" disabled={loading}>{loading ? 'Sending...' : 'Send reset link'}</button>
              </form>
            )}
            <div className="forgot-link"><a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError(''); setForgotSuccess(false); }}>← Back to sign in</a></div>
          </>
        )}
      </div>
    </div>
  );
}
