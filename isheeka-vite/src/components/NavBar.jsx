// Breadcrumb / back bar driven by the navigation stack (ported verbatim).
import React from 'react';

export function NavBar({ stack, onBack, onJump }) {
  if (!stack || stack.length <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 16, background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
      <button className="btn sm" onClick={onBack} title="Back one step" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>← Back</button>
      <div style={{ width: 1, height: 18, background: 'var(--grey-200)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', fontSize: 13 }}>
        {stack.map((n, i) => {
          const last = i === stack.length - 1;
          return (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: 'var(--grey-300)', margin: '0 2px' }}>›</span>}
              {last
                ? <span style={{ fontWeight: 500, color: 'var(--pink)', background: 'var(--pink-light)', padding: '3px 8px', borderRadius: 'var(--radius-sm)' }}>{n.label}</span>
                : <button onClick={() => onJump(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--grey-400)', fontSize: 13, padding: '3px 6px', fontFamily: 'Inter,sans-serif' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--pink)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--grey-400)'}>{n.label}</button>}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
