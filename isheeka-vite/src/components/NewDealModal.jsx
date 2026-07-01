// Phase 2b — the single "front door" for starting a deal. Thin chooser over startDeal:
// both paths create the canonical Lead → client RFQ spine; Send hands off to the RFQ link,
// Quick lands staff on the RFQ to fill items + approve. No manual (quote-less) events.
import React from 'react';
import { startDeal } from '../lib/deal.js';
import { notify } from '../lib/toast.jsx';

export function NewDealModal({ onClose, onNavigate, seed }) {
  const items = (seed && seed.items) || [];
  const referenceName = seed && seed.referenceName;
  const [f, setF] = React.useState({ first_name: '', last_name: '', phone: '', email: '', event_type: '' });
  const [busy, setBusy] = React.useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const busyAny = !!busy;

  const go = async (mode) => {
    if (!f.first_name.trim() && !f.phone.trim()) { notify('Add at least a name or a phone number.', 'error'); return; }
    setBusy(mode);
    try {
      const res = await startDeal({ mode, items, prefill: {
        first_name: f.first_name.trim(), last_name: f.last_name.trim(),
        phone: f.phone.trim(), email: f.email.trim(),
        event_type: f.event_type.trim() || null,
      } });
      onClose && onClose();
      if (res.quotation_id) onNavigate && onNavigate('quotations', { quotId: res.quotation_id, label: res.quote_ref || 'Quote' });
      else onNavigate && onNavigate('rfqs', { rfqId: res.rfq_id, label: res.ref_number || 'RFQ' });
    } catch (e) {
      notify('Could not start the deal: ' + ((e && e.message) || 'Please try again.'), 'error');
      setBusy('');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={() => !busyAny && onClose && onClose()}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 460, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--grey-800)' }}>Start a new deal</div>
          <button className="btn sm" onClick={() => onClose && onClose()} disabled={busyAny}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 14 }}>Both paths create Lead → RFQ → Quote for you. Pick how the requirements get captured.</div>
        {referenceName && <div style={{ fontSize: 12, color: 'var(--blue)', background: 'var(--blue-light)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: 14 }}>📋 Copying {items.length} item{items.length === 1 ? '' : 's'} from <strong>{referenceName}</strong> — prices reset. Quick deal is usually the fit here.</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div><label className="field-label">First name</label><input className="field-input" value={f.first_name} onChange={(e) => set('first_name', e.target.value)} placeholder="Kiran" /></div>
          <div><label className="field-label">Last name</label><input className="field-input" value={f.last_name} onChange={(e) => set('last_name', e.target.value)} placeholder="Rao" /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div><label className="field-label">Phone</label><input className="field-input" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91…" /></div>
          <div><label className="field-label">Email</label><input className="field-input" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="optional" /></div>
        </div>
        <div style={{ marginBottom: 16 }}><label className="field-label">Event type</label><input className="field-input" value={f.event_type} onChange={(e) => set('event_type', e.target.value)} placeholder="Wedding, Sangeet…" /></div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button className="btn primary" disabled={busyAny} onClick={() => go('send')} style={{ height: 'auto', padding: '10px 12px', textAlign: 'left', display: 'block' }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{busy === 'send' ? 'Starting…' : '📝 Send RFQ to client'}</div>
            <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 400, marginTop: 2 }}>Client fills a link with their requirements.</div>
          </button>
          <button className="btn" disabled={busyAny} onClick={() => go('quick')} style={{ height: 'auto', padding: '10px 12px', textAlign: 'left', display: 'block' }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{busy === 'quick' ? 'Starting…' : '⚡ Quick deal'}</div>
            <div style={{ fontSize: 11, color: 'var(--grey-500)', fontWeight: 400, marginTop: 2 }}>Walk-in — you have the details, price it now.</div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewDealModal;
