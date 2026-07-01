// Branded, promise-based confirm dialog for the app — a drop-in replacement for window.confirm().
// Usage:
//   if (!(await confirmDialog('Delete this?\n\nThis cannot be undone.'))) return;   // string: split on \n\n
//   if (!(await confirmDialog({ title, body, confirmLabel, cancelLabel }))) return; // explicit
// The enclosing function must be async.
import React from 'react';
import { createRoot } from 'react-dom/client';

function ConfirmModal({ title, body, confirmLabel, cancelLabel, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(74,17,40,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 20 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(false); }}>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 400, padding: '20px 22px 18px', boxShadow: '0 12px 44px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--grey-800)', marginBottom: body ? 8 : 16 }}>{title}</div>
        {body ? <div style={{ fontSize: 13.5, color: 'var(--grey-500)', lineHeight: 1.55, marginBottom: 18, whiteSpace: 'pre-line' }}>{body}</div> : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => onClose(false)}>{cancelLabel || 'Cancel'}</button>
          <button className="btn primary" onClick={() => onClose(true)}>{confirmLabel || 'Continue'}</button>
        </div>
      </div>
    </div>
  );
}

export function confirmDialog(opts) {
  if (typeof opts === 'string') opts = { message: opts };
  opts = opts || {};
  let title = opts.title, body = opts.body;
  if (opts.message != null && title == null && body == null) {
    const parts = String(opts.message).split('\n\n');
    title = parts[0];
    body = parts.slice(1).join('\n\n');
  }
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (v) => { try { root.unmount(); } catch (e) { /* noop */ } host.remove(); resolve(v); };
    root.render(<ConfirmModal title={title || 'Are you sure?'} body={body || ''} confirmLabel={opts.confirmLabel} cancelLabel={opts.cancelLabel} onClose={close} />);
  });
}

export default confirmDialog;
