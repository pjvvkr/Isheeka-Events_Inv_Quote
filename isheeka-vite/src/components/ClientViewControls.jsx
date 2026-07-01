// Presentation-only "What the client sees" panel (Option A). ALL state + handlers come from
// props — this component holds no business logic, so behaviour is identical to the inline
// versions it replaces. Reused by the Quote screen, the Quote wizard, and the Invoice screen.
import React from 'react';
import { IconWhatsApp, IconMail, IconPrinter, IconDownload } from './icons.jsx';

const ICON = { whatsapp: <IconWhatsApp />, mail: <IconMail />, printer: <IconPrinter />, download: <IconDownload /> };

export function ClientViewControls({ title = 'What the client sees', subtitle, modes, activeMode, onMode, toggles = [], share = [], notice }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: toggles.length ? 12 : 0 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--grey-800)' }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 11.5, color: 'var(--grey-400)' }}>{subtitle}</div> : null}
        </div>
        {modes && modes.length ? (
          <div style={{ display: 'inline-flex', background: 'var(--grey-50)', borderRadius: 9, padding: 3 }}>
            {modes.map((m) => {
              const on = activeMode === m.key;
              return <button key={m.key} onClick={() => onMode && onMode(m.key)} style={{ fontSize: 12, border: 'none', padding: '5px 13px', borderRadius: 7, cursor: 'pointer', background: on ? 'var(--pink)' : 'transparent', color: on ? '#fff' : 'var(--grey-600)', fontWeight: on ? 500 : 400 }}>{m.label}</button>;
            })}
          </div>
        ) : null}
      </div>

      {toggles.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {toggles.map((t) => {
            const on = !!t.checked;
            return <button key={t.key} onClick={() => t.onChange && t.onChange(!on)} style={{ fontSize: 11.5, padding: '4px 11px', borderRadius: 20, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--pink-light)' : 'var(--grey-200)'), background: on ? 'var(--pink-light)' : 'var(--grey-50)', color: on ? 'var(--pink)' : 'var(--grey-400)', fontWeight: on ? 500 : 400 }}>{t.label}{on ? ' ✓' : ''}</button>;
          })}
        </div>
      ) : null}

      {(share.length || notice) ? (
        <div style={{ borderTop: toggles.length ? '1px solid var(--grey-100)' : 'none', marginTop: toggles.length ? 12 : 0, paddingTop: toggles.length ? 12 : 0, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {notice ? <span style={{ fontSize: 11.5, color: notice.tone === 'warn' ? 'var(--red)' : 'var(--grey-400)', marginRight: 'auto' }}>{notice.text}</span> : <span style={{ marginRight: 'auto' }} />}
          {share.map((s) => (
            <button key={s.key} className={'btn sm' + (s.primary ? ' primary' : '')} disabled={!!s.disabled} title={s.title || ''} onClick={s.onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {s.icon && ICON[s.icon]}{s.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ClientViewControls;
