// Compact reverse-chronological timeline of a deal's sourcing & pricing decision points.
// Pure presentation over the array from lib/dealHistory.js.
import React from 'react';

const fmt = (t) => { try { return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
const COLOR = { quote: 'var(--pink)', costing: 'var(--gold)', vendor: 'var(--grey-600)' };

export function DealHistory({ items }) {
  if (!items || !items.length) return <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>No sourcing or pricing history yet.</div>;
  return (
    <div>
      {items.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: i ? '1px solid var(--grey-50)' : 'none' }}>
          <div style={{ fontSize: 15, width: 22, textAlign: 'center', flexShrink: 0, lineHeight: '18px' }}>{e.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: COLOR[e.kind] || 'var(--grey-800)' }}>{e.title}</div>
            {e.detail ? <div style={{ fontSize: 12, color: 'var(--grey-600)', marginTop: 1, wordBreak: 'break-word' }}>{e.detail}</div> : null}
          </div>
          <div style={{ fontSize: 11, color: 'var(--grey-400)', textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <div>{fmt(e.ts)}</div>
            {e.actor ? <div style={{ marginTop: 1 }}>{e.actor}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default DealHistory;
