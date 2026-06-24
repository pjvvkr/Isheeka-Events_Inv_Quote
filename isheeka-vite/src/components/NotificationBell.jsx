// Header notification bell + dropdown panel (Phase 1, in-app center). Polls the
// signed-in user's notifications, shows an unread badge, and deep-links on click.
import React from 'react';
import { loadNotifications, markRead, markAllRead } from '../lib/notifications.js';
import { pushSupported, pushPermission, enablePush, sendTestPush } from '../lib/push.js';
import { notify } from '../lib/toast.jsx';
import { fmtDate } from '../lib/format.js';

const ago = (d) => {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const days = Math.floor(h / 24); if (days < 7) return days + 'd ago';
  return fmtDate(d, { day: 'numeric', month: 'short' });
};
const ICON = { rfq_submitted: '📝', vendor_bid: '📨', owner_expense: '💼', payment_received: '💰', invoice_overdue: '⏳', followup_due: '🔔', digest: '📊' };

export function NotificationBell({ userId, onNavigate }) {
  const [list, setList] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const load = React.useCallback(async () => { if (userId) setList(await loadNotifications(userId)); }, [userId]);
  React.useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);
  React.useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const unread = list.filter((n) => !n.is_read).length;
  const click = (n) => {
    setOpen(false);
    if (!n.is_read) { markRead(n.notification_id); setList((l) => l.map((x) => x.notification_id === n.notification_id ? { ...x, is_read: true } : x)); }
    if (n.link_page && onNavigate) onNavigate(n.link_page, n.link_opts || {});
  };
  const allRead = async () => { await markAllRead(userId); setList((l) => l.map((x) => ({ ...x, is_read: true }))); };

  const [perm, setPerm] = React.useState(pushPermission());
  const onEnable = async () => {
    const r = await enablePush(userId);
    if (r.ok) { setPerm('granted'); notify('Phone alerts enabled on this device.', 'success'); }
    else notify(r.error === 'denied' ? 'Permission blocked — turn on notifications in your browser settings.' : r.error === 'unsupported' ? 'Push not supported here. On iPhone, install the app to Home Screen first.' : "Couldn't enable alerts.", 'error');
  };
  const onTest = async () => { const r = await sendTestPush(userId); notify(r && r.ok ? 'Test push sent — check your device.' : "Couldn't send the test.", r && r.ok ? 'success' : 'error'); };

  if (!userId) return null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} title="Notifications" style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4, color: 'var(--grey-600)' }}>🔔
        {unread > 0 && <span style={{ position: 'absolute', top: -2, right: -2, background: 'var(--pink)', color: 'white', fontSize: 10, fontWeight: 600, borderRadius: 20, minWidth: 16, height: 16, lineHeight: '16px', textAlign: 'center', padding: '0 4px' }}>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 34, width: 340, maxHeight: 440, overflowY: 'auto', background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', zIndex: 1200 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--grey-100)', position: 'sticky', top: 0, background: 'white' }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--grey-800)' }}>Notifications</span>
            {unread > 0 && <span onClick={allRead} style={{ fontSize: 12, color: 'var(--pink)', cursor: 'pointer' }}>Mark all read</span>}
          </div>
          {list.length === 0 ? <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--grey-400)', fontSize: 13 }}>No notifications yet.</div>
            : list.map((n) => (
              <div key={n.notification_id} onClick={() => click(n)} style={{ display: 'flex', gap: 10, padding: '10px 14px', borderTop: '1px solid var(--grey-50)', cursor: 'pointer', background: n.is_read ? 'white' : 'var(--blue-light)' }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{ICON[n.type] || '🔔'}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--grey-800)' }}>{n.title}{n.doc_ref ? <span style={{ fontFamily: 'monospace', color: 'var(--grey-500)' }}> · {n.doc_ref}</span> : ''}</div>
                  {n.body && <div style={{ fontSize: 11.5, color: 'var(--grey-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                  <div style={{ fontSize: 11, color: 'var(--grey-300)', marginTop: 2 }}>{ago(n.created_at)}</div>
                </div>
              </div>
            ))}
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--grey-100)', position: 'sticky', bottom: 0, background: 'white' }}>
            {pushSupported()
              ? (perm === 'granted'
                ? <button className="btn sm" style={{ width: '100%' }} onClick={onTest}>🔔 Send a test push</button>
                : <button className="btn sm primary" style={{ width: '100%' }} onClick={onEnable}>🔔 Enable phone alerts</button>)
              : <div style={{ fontSize: 11.5, color: 'var(--grey-400)', textAlign: 'center' }}>Phone push isn’t supported on this browser. On iPhone, install the app to your Home Screen first.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
