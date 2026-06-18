// Toast notifications + DB helper (ported from isheeka-erp-v22.html, P0-2).
// notify(): non-blocking branded toast, callable from anywhere (incl. non-component fns).
// runDb(): wraps a Supabase query, surfaces + logs errors instead of failing silently.
import { useState, useEffect } from 'react';

let _toastApi = null;

export function notify(message, type = 'error', ttl = 5000) {
  if (_toastApi) _toastApi.push({ message, type, ttl });
  else console.error('[Isheeka ERP]', type, message);
}

export function ToastHost() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _toastApi = {
      push: (t) => {
        const id = Date.now() + Math.random();
        setToasts((ts) => [...ts, { ...t, id }]);
        setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.ttl || 5000);
      },
    };
    return () => { _toastApi = null; };
  }, []);
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.type} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>{t.message}</div>
      ))}
    </div>
  );
}

export async function runDb(query, action) {
  try {
    const { data, error } = await query;
    if (error) {
      console.error('[Isheeka ERP] DB error (' + action + '):', error);
      notify("Couldn't " + action + '. ' + (error.message || 'Please try again.'), 'error');
    }
    return { data, error };
  } catch (err) {
    console.error('[Isheeka ERP] DB exception (' + action + '):', err);
    notify("Couldn't " + action + '. Please try again.', 'error');
    return { data: null, error: err };
  }
}
