// Pure formatters, status predicates, and small derivations ported from
// isheeka-erp-v22.html. Dependencies: constants only (no React, no supabase).
import {
  LEAD_STAGE_LABELS, EVENT_TYPES_DEFAULT, EXPENSE_CATS, EVENT_STAGE_COLORS, QUOT_STATUS_LABELS,
} from './constants.js';

// #4: revision-aware quote status label. On a revision (revision_number > 0) the badge
// reads e.g. "Rev 4 · Approved" / "Rev 4 · Sent" instead of a bare "Approved". Display-only —
// the underlying `status` value is untouched, so no business logic is affected.
export function quoteStatusLabel(q) {
  const base = (q && QUOT_STATUS_LABELS[q.status]) || (q && q.status) || '';
  return (q && q.revision_number > 0) ? ('Rev ' + q.revision_number + ' · ' + base) : base;
}

// ── Lost-reason mapping ───────────────────────────────────────────────────────
export function mapLostReason(outcome, reason) {
  if (outcome === 'us') { return reason === 'out_of_service_area' ? 'out_of_service_area' : 'other'; }
  const ok = ['price_too_high', 'went_with_competitor', 'event_postponed', 'no_response', 'other'];
  return ok.includes(reason) ? reason : 'other';
}

// ── Event-type label map ──────────────────────────────────────────────────────
// Seeded with the defaults so built-ins render before the configurable table loads.
// The data loader (ported later) calls registerEventTypeLabels() to add custom ones.
const _eventTypeLabelMap = Object.fromEntries(EVENT_TYPES_DEFAULT.map((t) => [t.value, t.label]));
export function registerEventTypeLabels(rows) {
  (rows || []).forEach((t) => { if (t && t.value != null) _eventTypeLabelMap[t.value] = t.label; });
}
export function prettyTypeValue(v) { return String(v || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
export function eventTypeLabel(v) { if (!v) return ''; return _eventTypeLabelMap[v] || prettyTypeValue(v); }
export function defaultEventName(typeValue) { const l = eventTypeLabel(typeValue); return l ? (l + ' Event') : 'Event'; }

// ── Dates ─────────────────────────────────────────────────────────────────────
// Today as a local YYYY-MM-DD string (date-only comparisons, no UTC drift).
export function todayLocalStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// Timezone-safe date formatter. A bare 'YYYY-MM-DD' is built from its parts as a
// LOCAL date (avoids new Date('YYYY-MM-DD') being parsed as UTC and shifting a day).
export function fmtDate(d, opts) {
  if (!d) return '—';
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', opts || { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Status predicates ─────────────────────────────────────────────────────────
// Effective (display) event status: an event past its main date that isn't completed/cancelled reads as "in_progress".
export function effectiveEventStatus(e) { if (!e) return ''; const s = (e.status || '').toLowerCase(); if (['completed', 'cancelled'].includes(s)) return s; if (e.main_date && e.main_date <= todayLocalStr() && ['planning', 'confirmed'].includes(s)) return 'in_progress'; return s; }
// Quote past its validity — DISPLAY flag only.
export function isQuoteExpired(q) { return !!(q && q.status === 'sent' && q.valid_until && q.valid_until < todayLocalStr()); }
// Invoice past its due date and not fully paid — drives the 'overdue' status.
export function isInvoiceOverdue(i) { return !!(i && ['sent', 'partially_paid'].includes((i.status || '').toLowerCase()) && i.due_date && i.due_date < todayLocalStr()); }

export function vendorInstBalance(inst) { return Math.max(0, (parseFloat(inst && inst.amount_due) || 0) - (parseFloat(inst && inst.amount_paid) || 0)); }
export function isVendorInstOverdue(inst) { return !!(inst && inst.due_date && inst.due_date < todayLocalStr() && vendorInstBalance(inst) > 0.5); }
export function isVendorInstDueSoon(inst, days) { if (!inst || !inst.due_date || vendorInstBalance(inst) <= 0.5) return false; const t = todayLocalStr(); if (inst.due_date < t) return false; const d = new Date(); d.setDate(d.getDate() + (days || 5)); const soon = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); return inst.due_date <= soon; }

// Collapsed lead-stage label for the chip (the quote owns its own sub-states now).
export function leadStageDisplay(stage) { if (['quote_generation_in_progress', 'quote_sent', 'quote_revision_pending', 'revised_quote_sent', 'quote_confirmed'].includes(stage)) return 'Quoting'; return (LEAD_STAGE_LABELS[stage] || stage); }

// ── Lead follow-up urgency ────────────────────────────────────────────────────
export function getFollowUpUrgency(date) {
  if (!date) return 'none';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const diff = Math.floor((d - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'week';
  return 'future';
}

// ── Budget filter ─────────────────────────────────────────────────────────────
export function matchesBudget(budget, range) {
  if (!range) return true;
  const [min, max] = range.split('-').map(Number);
  const b = parseFloat(budget) || 0;
  return b >= min && b <= max;
}

// ── Expense label ─────────────────────────────────────────────────────────────
export const EXPENSE_CAT_LABEL = (c) => { const f = EXPENSE_CATS.find((x) => x[0] === c); return f ? f[1] : c; };

// ── Derived event funnel (client ladder + vendor balance) ─────────────────────
// Computed LIVE from invoices + installments + vendor dues. Nothing is stored, so
// it can never drift. Drives the progress sub-badge AND the Mark-completed gate.
export function eventFunnel({ invoices, installments, vendorOutstanding, hasApprovedQuote } = {}) {
  const active = (invoices || []).filter((i) => (i.status || '').toLowerCase() !== 'cancelled');
  const issued = active.filter((i) => ['sent', 'partially_paid', 'paid', 'overdue'].includes((i.status || '').toLowerCase()));
  const grand = active.reduce((s, i) => s + (parseFloat(i.grand_total) || 0), 0);
  const received = active.reduce((s, i) => s + (parseFloat(i.total_received) || 0), 0);
  const outstanding = active.reduce((s, i) => s + ((parseFloat(i.total_outstanding != null ? i.total_outstanding : ((parseFloat(i.grand_total) || 0) - (parseFloat(i.total_received) || 0))) || 0)), 0);
  const vBal = Math.max(0, parseFloat(vendorOutstanding) || 0);
  const insts = (installments || []).filter((x) => !x.is_deleted);
  let stage = 'pre', label = null, clientPaid = false;
  if (issued.length === 0) {
    if (hasApprovedQuote) { stage = 'quote_approved'; label = 'Quote approved'; }
  } else if (received <= 0.5) {
    stage = 'invoice_issued'; label = 'Invoice issued';
  } else if (outstanding > 0.5) {
    stage = 'partly_paid';
    const paidN = insts.filter((x) => (parseFloat(x.balance) || 0) <= 0.5).length;
    label = (insts.length > 0)
      ? paidN + ' of ' + insts.length + ' installment' + (insts.length > 1 ? 's' : '') + ' received'
      : 'Part-paid · ₹' + Math.round(received).toLocaleString('en-IN') + ' of ₹' + Math.round(grand).toLocaleString('en-IN');
  } else {
    stage = 'paid'; label = 'Invoice fully paid'; clientPaid = true;
  }
  let blocker = null;
  if (!clientPaid) {
    if (issued.length === 0) blocker = hasApprovedQuote ? 'Issue an invoice and collect payment before completing.' : 'Approve a quote and issue an invoice before completing.';
    else if (received <= 0.5) blocker = 'Invoice issued, but no client payment received yet.';
    else blocker = '₹' + Math.round(outstanding).toLocaleString('en-IN') + ' still outstanding from the client.';
  }
  return { stage, label, vendorBalance: vBal, clientPaid, canComplete: clientPaid, blocker, received, grand, outstanding };
}

// Re-export so consumers can grab the funnel chip colors from one place.
export { EVENT_STAGE_COLORS };
