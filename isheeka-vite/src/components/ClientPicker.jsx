// Reusable searchable client picker (server-side typeahead). Emits onPick(client) when one is
// chosen. Extracted from NewDealModal so the same search UX can be reused elsewhere.
// Self-contained: owns its query/results state and renders the input + results dropdown.
import React from 'react';
import { supabase } from '../lib/supabase';

export function ClientPicker({ onPick, excludeId = null, placeholder = 'Search by name or phone…', autoFocus = false }) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
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
        if (live) setResults((data || []).filter((c) => !excludeId || c.client_id !== excludeId));
      } catch (e) { if (live) setResults([]); }
      if (live) setSearching(false);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, excludeId]);

  const choose = (c) => { onPick && onPick(c); setQ(''); setResults([]); };

  return (
    <div style={{ position: 'relative' }}>
      <input className="field-input" value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {(results.length > 0 || (searching && q.trim().length >= 2)) && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 5, maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
          {searching && !results.length ? <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--grey-400)' }}>Searching…</div> :
            results.map((c) => (
              <div key={c.client_id} onClick={() => choose(c)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderTop: '1px solid var(--grey-50)' }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--grey-50)'; }} onMouseLeave={(ev) => { ev.currentTarget.style.background = '#fff'; }}>
                <div style={{ color: 'var(--grey-800)', fontWeight: 500 }}>{((c.first_name || '') + ' ' + (c.last_name || '')).trim() || '—'}</div>
                <div style={{ color: 'var(--grey-400)', fontSize: 11 }}>{c.phone_1 || ''}{c.email_1 ? (' · ' + c.email_1) : ''}</div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default ClientPicker;
