// Unified status pill — one shape, one source of truth. Reads color + label from the
// existing constant maps by `kind`, or takes explicit bg/color/label for derived states.
// Visual change is intentional and cosmetic only (consistent padding/radius/type tokens);
// no status values, transitions, or business logic live here.
import React from 'react';
import {
  INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS,
  QUOT_STATUS_COLORS, QUOT_STATUS_LABELS,
  LEAD_STAGE_COLORS, LEAD_STAGE_LABELS,
  EVENT_STATUS_COLORS, EVENT_STATUS_LABELS,
  RFQ_STATUS,
} from '../../lib/constants.js';

const REG = {
  invoice: (s) => { const c = INVOICE_STATUS_COLORS[s] || {}; return { bg: c.bg, color: c.color, label: INVOICE_STATUS_LABELS[s] }; },
  quote:   (s) => { const c = QUOT_STATUS_COLORS[s] || {};    return { bg: c.bg, color: c.color, label: QUOT_STATUS_LABELS[s] }; },
  lead:    (s) => { const c = LEAD_STAGE_COLORS[s] || {};     return { bg: c.bg, color: c.color, label: LEAD_STAGE_LABELS[s] }; },
  event:   (s) => { const c = EVENT_STATUS_COLORS[s] || {};   return { bg: c.bg, color: c.color, label: EVENT_STATUS_LABELS[s] }; },
  rfq:     (s) => { const c = RFQ_STATUS[s] || {};            return { bg: c.bg, color: c.c, label: c.l }; },
};

export function StatusBadge({ kind, status, label, bg, color, style }) {
  let _bg = bg, _color = color, _label = label;
  if (kind && REG[kind] && status != null) {
    const r = REG[kind](status);
    if (_bg == null) _bg = r.bg;
    if (_color == null) _color = r.color;
    if (_label == null) _label = r.label;
  }
  _bg = _bg || 'var(--grey-100)';
  _color = _color || 'var(--grey-400)';
  _label = (_label != null && _label !== '') ? _label : (status || '');
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-medium)', lineHeight: 1.5, background: _bg, color: _color, whiteSpace: 'nowrap', ...(style || {}) }}>{_label}</span>
  );
}

export default StatusBadge;
