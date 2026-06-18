// Shared form inputs (ported verbatim from isheeka-erp-v22.html).
// Used by virtually every module's create/edit forms.
import React from 'react';
import { supabase } from '../lib/supabase';

export function InputField({ label, required, type = 'text', value, onChange, placeholder = '', hint = '', error = '', readOnly = false, disabled = false }) {
  const dStyle = disabled ? { background: 'var(--grey-50)', color: 'var(--grey-400)', cursor: 'not-allowed' } : {};
  return (
    <div>
      <label className="field-label">{label}{required && <span style={{ color: 'var(--pink)' }}> *</span>}</label>
      {type === 'textarea' ? (
        <textarea className="field-textarea" rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} disabled={disabled} style={error ? { borderColor: 'var(--red)', ...dStyle } : dStyle} />
      ) : type === 'select' ? null : (
        <input className="field-input" type={type} value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} readOnly={readOnly} disabled={disabled} style={error ? { borderColor: 'var(--red)', ...dStyle } : dStyle} />
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠ {error}</div>}
      {hint && !error && <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function SelectField({ label, required, value, onChange, options, error = '', placeholder = 'Select...', disabled = false }) {
  const dStyle = disabled ? { background: 'var(--grey-50)', color: 'var(--grey-400)', cursor: 'not-allowed' } : {};
  return (
    <div>
      <label className="field-label">{label}{required && <span style={{ color: 'var(--pink)' }}> *</span>}</label>
      <select className="field-input" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        style={error ? { borderColor: 'var(--red)', ...dStyle } : dStyle}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠ {error}</div>}
    </div>
  );
}

// ── AutocompleteInput ─────────────────────────────────────────────────────────
// Cache: shared across all instances, keyed by "table:column".
const _acCache = {};
const _acCacheTime = {};
const AC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchSuggestions(table, column) {
  const key = table + ':' + column;
  const now = Date.now();
  if (_acCache[key] && (now - _acCacheTime[key]) < AC_CACHE_TTL) {
    return _acCache[key];
  }
  try {
    const { data } = await supabase
      .rpc('get_distinct_values', { p_table: table, p_column: column })
      .limit(20);
    // Fallback if RPC not available - use direct query
    if (!data) {
      const res = await supabase.from(table).select(column).not(column, 'is', null).limit(200);
      if (res.data) {
        const unique = [...new Set(res.data.map((r) => r[column]).filter((v) => v && String(v).trim()))].slice(0, 20);
        _acCache[key] = unique;
        _acCacheTime[key] = now;
        return unique;
      }
    }
    const vals = (data || []).map((r) => r.value).filter(Boolean);
    _acCache[key] = vals;
    _acCacheTime[key] = now;
    return vals;
  } catch (e) {
    return [];
  }
}

export function AutocompleteInput({
  label, required, value, onChange, placeholder = '', hint = '', error = '',
  table, column, // Supabase table + column to fetch suggestions from
  staticSuggestions = [], // optional hardcoded suggestions (used when table/column not provided)
  type = 'text', readOnly = false, disabled = false,
}) {
  const [suggestions, setSuggestions] = React.useState([]);
  const [filtered, setFiltered] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const wrapRef = React.useRef();

  const handleFocus = async () => {
    if (disabled) return;
    setFocused(true);
    let suggs = [];
    if (table && column) {
      suggs = await fetchSuggestions(table, column);
    } else if (staticSuggestions.length > 0) {
      suggs = staticSuggestions;
    }
    setSuggestions(suggs);
    const q = (value || '').toLowerCase();
    const f = q ? suggs.filter((s) => s.toLowerCase().includes(q)) : suggs;
    setFiltered(f);
    if (f.length > 0) setOpen(true);
  };

  const handleChange = (val) => {
    onChange(val);
    const q = val.toLowerCase();
    const f = q
      ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      : suggestions;
    setFiltered(f);
    setOpen(f.length > 0);
  };

  const handleSelect = (val) => {
    onChange(val);
    setOpen(false);
  };

  const handleBlur = () => {
    // Delay to allow mousedown on suggestion to fire first
    setTimeout(() => { setOpen(false); setFocused(false); }, 150);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <label className="field-label">
        {label}{required && <span style={{ color: 'var(--pink)' }}> *</span>}
      </label>
      <input
        className="field-input"
        type={type}
        value={value || ''}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        style={disabled ? { background: 'var(--grey-50)', color: 'var(--grey-400)', cursor: 'not-allowed' } : error ? { borderColor: 'var(--red)' } : focused && open ? { borderColor: 'var(--pink)', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : {}}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 500,
          background: 'white', border: '1.5px solid var(--pink)',
          borderTop: 'none', borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          boxShadow: 'var(--shadow-md)', maxHeight: 200, overflowY: 'auto',
        }}>
          {filtered.map((s, i) => (
            <div key={i}
              onMouseDown={() => handleSelect(s)}
              style={{
                padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                color: 'var(--grey-800)', borderBottom: '1px solid var(--grey-100)',
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'background .1s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--pink-light)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>
              <span style={{ color: 'var(--grey-400)', fontSize: 11 }}>↩</span>
              {s}
            </div>
          ))}
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠ {error}</div>}
      {hint && !error && <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
