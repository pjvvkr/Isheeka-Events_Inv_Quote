// Inactivity warning toast with a live countdown (ported verbatim).
import { useState, useEffect } from 'react';

export function SessionWarning({ onStay, onLogout }) {
  const [seconds, setSeconds] = useState(300);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => { if (s <= 1) { onLogout(); return 0; } return s - 1; }), 1000);
    return () => clearInterval(t);
  }, []);
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return (
    <div className="session-warning">
      <h4>⚠️ Session expiring soon</h4>
      <p>You'll be logged out in {m}:{s.toString().padStart(2, '0')} due to inactivity.</p>
      <div className="session-warning-btns">
        <button className="btn primary" onClick={onStay}>Stay logged in</button>
        <button className="btn" onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}
