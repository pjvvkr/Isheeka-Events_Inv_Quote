// Event quick-view popup (used from Vendor Payments). Ported verbatim.
import React from 'react';
import { supabase } from '../lib/supabase';
import { eventTypeLabel, fmtDate } from '../lib/format.js';

export function EventQuickView({ eventId, onClose, onNavigate }) {
  const [ev, setEv] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => { let a = true; (async () => { const { data } = await supabase.from('events').select('event_id,ref_number,name,type,status,main_date,location,client_name').eq('event_id', eventId).single(); if (a) { setEv(data || null); setLoading(false); } })(); return () => { a = false; }; }, [eventId]);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 440 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>{loading ? 'Loading…' : (ev ? ev.name : 'Event not found')}</div>
          <button className="btn sm" onClick={onClose}>✕</button>
        </div>
        {ev && <div style={{ padding: 20, fontSize: 13 }}>
          <div style={{ color: 'var(--grey-400)', marginBottom: 10 }}>{ev.ref_number} · {ev.type ? eventTypeLabel(ev.type) : ''} · <span style={{ textTransform: 'capitalize' }}>{(ev.status || '').replace('_', ' ')}</span></div>
          {[['Client', ev.client_name], ['Main date', ev.main_date ? fmtDate(ev.main_date, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'], ['Location', ev.location || '—']].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--grey-50)' }}><span style={{ color: 'var(--grey-400)' }}>{l}</span><span style={{ fontWeight: 500 }}>{v}</span></div>
          ))}
          <button className="btn primary" style={{ marginTop: 14, width: '100%' }} onClick={() => { onClose(); onNavigate && onNavigate('events', { eventId: ev.event_id, label: ev.name || ev.ref_number || 'Event' }); }}>Open full event →</button>
        </div>}
      </div>
    </div>
  );
}
