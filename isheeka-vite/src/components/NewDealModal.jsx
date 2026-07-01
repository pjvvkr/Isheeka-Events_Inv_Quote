// Phase 2b — the single "front door" for starting a deal. Thin chooser over startDeal:
// both paths create the canonical Lead → client RFQ spine; Send hands off to the RFQ link,
// Quick lands staff on the RFQ to fill items + approve. No manual (quote-less) events.
// Client can be searched (link to existing, no duplicate) or entered new (saved at approval).
import React from 'react';
import { supabase } from '../lib/supabase';
import { startDeal } from '../lib/deal.js';
import { notify } from '../lib/toast.jsx';
import { useEventTypes } from '../lib/data.js';

export function NewDealModal({ onClose, onNavigate, seed }) {
  const items = (seed && seed.items) || [];
  const referenceName = seed && seed.referenceName;
  const [f, setF] = React.useState({ first_name: '', last_name: '', phone: '', email: '', event_type: '' });
  const [busy, setBusy] = React.useState('');
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [searching, setSearching] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const eventTypes = useEventTypes();
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const busyAny = !!busy;

  React.useEffect(() => {
    if (selected) { setResults([]); return; }
    const term = q.trim().replace(/[%,]/g, '');
    if (term.length < 2) { setResults([]); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const like = '%' + term + '%';
        const { data } = await supabase.from('clients')
          .select('client_id,first_name,last_name,phone_1,email_1')
          .eq('is_deleted', false)
          .or(`first_name.ilike.${like},last_name.ilike.${like},phone_1.ilike.${like}`)
          .limit(8);
        if (live) setResults(data || []);
      } catch (e) { if (live) setResults([]); }
      if (live) setSearching(false);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, selected]);

  const pick = (c) => {
    setSelected(c);
    setF((s) => ({ ...s, first_name: c.first_name || '', last_name: c.last_name || '', phone: c.phone_1 || '', email: c.email_1 || '' }));
    setResults([]); setQ('');
  };
  const clearSelected = () => { setSelected(null); setF({ first_name: '', last_name: '', phone: '', email: '', event_type: f.event_type }); };

  const go = async (mode) => {
    const miss = [];
    if (!selected) {
      if (!f.first_name.trim()) miss.push('first name');
      if (!f.last_name.trim()) miss.push('last name');
      if (!f.phone.trim()) miss.push('phone');
    }
    if (!f.event_type.trim()) miss.push('event type');
    if (miss.length) { notify('Please fill: ' + miss.join(', ') + '.', 'error'); return; }
    setBusy(mode);
    try {
      const client = selected ? { client_id: selected.client_id, first_name: f.first_name.trim(), last_name: f.last_name.trim(), phone: f.phone.trim(), email: f.email.trim() } : {};
      const res = await startDeal({ mode, items, client, prefill: {
        first_name: f.first_name.trim(), last_name: f.last_name.trim(),
        phone: f.phone.trim(), email: f.email.trim(),
        event_type: f.event_type.trim() || null,
      } });
      onClose && onClose();
      if (res.quotation_id) onNavigate && onNavigate('quotations', { quotId: res.quotation_id, label: res.quote_ref || 'Quote' });
      else if (res.token) onNavigate && onNavigate('rfqs', { rfqId: res.rfq_id, label: res.ref_number || 'RFQ', share: { ref_number: res.ref_number, token: res.token, pin: res.pin, contact: { name: ((f.first_name + ' ' + f.last_name).trim()), phone: f.phone.trim() } } });
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

        {selected ? (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--green-light)', border: '1px solid rgba(15,110,86,0.2)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Existing client <strong>{((selected.first_name || '') + ' ' + (selected.last_name || '')).trim()}</strong>{selected.phone_1 ? (' · ' + selected.phone_1) : ''}</div>
            <button className="btn sm" onClick={clearSelected} disabled={busyAny}>Change</button>
          </div>
        ) : (
          <div style={{ marginBottom: 12, position: 'relative' }}>
            <label className="field-label">Find existing client</label>
            <input className="field-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" />
            {(results.length > 0 || (searching && q.trim().length >= 2)) && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 5, maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                {searching && !results.length ? <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--grey-400)' }}>Searching…</div> :
                  results.map((c) => (
                    <div key={c.client_id} onClick={() => pick(c)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderTop: '1px solid var(--grey-50)' }}
                      onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--grey-50)'; }} onMouseLeave={(ev) => { ev.currentTarget.style.background = '#fff'; }}>
                      <div style={{ color: 'var(--grey-800)', fontWeight: 500 }}>{((c.first_name || '') + ' ' + (c.last_name || '')).trim() || '—'}</div>
                      <div style={{ color: 'var(--grey-400)', fontSize: 11 }}>{c.phone_1 || ''}{c.email_1 ? (' · ' + c.email_1) : ''}</div>
                    </div>
                  ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 4 }}>…or enter a new client below — it'll be saved to your Clients list.</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div><label className="field-label">First name <span style={{ color: 'var(--red)' }}>*</span></label><input className="field-input" value={f.first_name} onChange={(e) => set('first_name', e.target.value)} placeholder="Kiran" disabled={!!selected} /></div>
          <div><label className="field-label">Last name <span style={{ color: 'var(--red)' }}>*</span></label><input className="field-input" value={f.last_name} onChange={(e) => set('last_name', e.target.value)} placeholder="Rao" disabled={!!selected} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div><label className="field-label">Phone <span style={{ color: 'var(--red)' }}>*</span></label><input className="field-input" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91…" disabled={!!selected} /></div>
          <div><label className="field-label">Email</label><input className="field-input" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="optional" disabled={!!selected} /></div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Event type <span style={{ color: 'var(--red)' }}>*</span></label>
          <select className="field-input" value={f.event_type} onChange={(e) => set('event_type', e.target.value)}>
            <option value="">Select…</option>
            {(eventTypes || []).slice().sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''))).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

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
