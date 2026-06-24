// Pure compute for the finance reports (no React, no IO). Inputs are already-loaded
// rows; outputs are report-ready structures the Reports module renders + exports.
import { todayLocalStr } from './format.js';

const num = (n) => parseFloat(n) || 0;
const dstr = (d) => String(d || '').slice(0, 10);
function daysBetween(fromYMD, toYMD) {   // toYMD − fromYMD in whole days
  if (!fromYMD || !toYMD) return 0;
  const a = new Date(fromYMD + 'T00:00:00'), b = new Date(toYMD + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
export function inRangeYMD(d, from, to) { const s = dstr(d); if (from && s < from) return false; if (to && s > to) return false; return true; }

// ── Accounts receivable: open invoice balances aged by due date (as of a date) ──
export function buildAR(invoices, opts = {}) {
  const asOf = opts.asOf || todayLocalStr();
  let rows = (invoices || []).filter((i) => (i.status || '') !== 'cancelled').map((i) => {
    const invoiced = num(i.grand_total), received = num(i.total_received);
    const balance = (i.total_outstanding != null) ? num(i.total_outstanding) : Math.max(0, invoiced - received);
    const due = i.due_date || i.doc_date || null;
    const daysOverdue = balance > 0 && due ? daysBetween(due, asOf) : 0;
    const bucket = balance <= 0 ? 'paid' : daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? 'd30' : daysOverdue <= 60 ? 'd60' : 'd60p';
    return { ...i, invoiced, received, balance, due, daysOverdue, bucket };
  });
  if (opts.outstandingOnly !== false) rows = rows.filter((r) => r.balance > 0);
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  const aging = { current: 0, d30: 0, d60: 0, d60p: 0 };
  rows.forEach((r) => { if (r.bucket === 'current') aging.current += r.balance; else if (r.bucket === 'd30') aging.d30 += r.balance; else if (r.bucket === 'd60') aging.d60 += r.balance; else if (r.bucket === 'd60p') aging.d60p += r.balance; });
  const totals = { invoiced: rows.reduce((s, r) => s + r.invoiced, 0), received: rows.reduce((s, r) => s + r.received, 0), balance: rows.reduce((s, r) => s + r.balance, 0) };
  return { rows, aging, totals, totalReceivable: totals.balance, overdue: aging.d30 + aging.d60 + aging.d60p, asOf };
}

// ── Accounts payable: vendor commitments minus payments (from event_vendors) ──
export function buildAP(eventVendors, eventMap = {}, opts = {}) {
  let rows = (eventVendors || []).map((ev) => {
    const committed = num(ev.agreed_amount), paid = num(ev.total_paid);
    const balance = (ev.outstanding != null) ? num(ev.outstanding) : Math.max(0, committed - paid);
    const e = eventMap[ev.event_id] || {};
    return { ...ev, committed, paid, balance, event_ref: e.ref_number || '', event_name: e.name || '', client_name: e.client_name || '' };
  });
  if (opts.outstandingOnly !== false) rows = rows.filter((r) => r.balance > 0);
  rows.sort((a, b) => b.balance - a.balance);
  const byVendor = {};
  rows.forEach((r) => { const k = r.vendor_name || r.vendor_id || '—'; byVendor[k] = (byVendor[k] || 0) + r.balance; });
  const totals = { committed: rows.reduce((s, r) => s + r.committed, 0), paid: rows.reduce((s, r) => s + r.paid, 0), balance: rows.reduce((s, r) => s + r.balance, 0) };
  return { rows, byVendor, totals, totalPayable: totals.balance };
}

// ── Owner settlement: who owes whom over a date range, with the underlying txns ──
export function buildOwnerSettlement(owners, expenses, ledger, opts = {}) {
  const { from, to } = opts;
  const exp = (expenses || []).filter((e) => e.paid_by && inRangeYMD(e.date, from, to));
  const led = (ledger || []).filter((l) => inRangeYMD(l.entry_date, from, to));

  const txByOwner = {}; (owners || []).forEach((o) => { txByOwner[o.user_id] = []; });
  exp.forEach((e) => { if (txByOwner[e.paid_by]) txByOwner[e.paid_by].push({ id: e.expense_no || '', date: e.date, type: 'Expense', detail: e.description || '', amount: num(e.amount), sign: 1 }); });
  led.forEach((l) => {
    if (l.entry_type === 'funding' && txByOwner[l.from_user]) txByOwner[l.from_user].push({ id: l.entry_no || '', date: l.entry_date, type: 'Funding', detail: l.notes || '', amount: num(l.amount), sign: 1 });
    if (l.entry_type === 'reimbursement' && txByOwner[l.to_user]) txByOwner[l.to_user].push({ id: l.entry_no || '', date: l.entry_date, type: 'Reimbursement', detail: l.notes || '', amount: num(l.amount), sign: -1 });
  });
  (owners || []).forEach((o) => { txByOwner[o.user_id].sort((a, b) => String(a.date).localeCompare(String(b.date))); });
  const owed = {}; (owners || []).forEach((o) => { owed[o.user_id] = txByOwner[o.user_id].reduce((s, t) => s + t.sign * t.amount, 0); });

  const settlements = led.filter((l) => l.entry_type === 'settlement').map((l) => ({ id: l.entry_no || '', date: l.entry_date, from: l.from_user, to: l.to_user, amount: num(l.amount), notes: l.notes || '' }));

  let net = null;
  if ((owners || []).length >= 2) {
    const a = owners[0], b = owners[1];
    let v = (owed[a.user_id] || 0) - (owed[b.user_id] || 0);   // + → b owes a
    settlements.forEach((s) => { if (s.from === a.user_id && s.to === b.user_id) v += s.amount; if (s.from === b.user_id && s.to === a.user_id) v -= s.amount; });
    net = Math.round(v) === 0 ? { settled: true } : (v > 0 ? { ower: b, owed: a, amount: Math.abs(v) } : { ower: a, owed: b, amount: Math.abs(v) });
  }
  const expenseTotal = exp.reduce((s, e) => s + num(e.amount), 0);
  return { owed, txByOwner, settlements, net, expenseTotal, from, to };
}
