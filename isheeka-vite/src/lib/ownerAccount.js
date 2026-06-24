// Owner Account data layer. Business expenses live in the `expenses` table (single
// source of truth); this module adds the owner money-movements (`owner_ledger`:
// funding / reimbursement / settlement) and the reconciliation that joins the two.
//
//   business owes(owner) = Σ(expenses.paid_by = owner)
//                        + Σ(funding.from_user = owner)
//                        − Σ(reimbursement.to_user = owner)
//
// The "personal" line nets owner ↔ owner settlements (loans / paybacks).
import { supabase } from './supabase';
import { runDb } from './toast.jsx';
import { _currentUid } from './session.js';

const ownerName = (u) => (((u.first_name || '') + ' ' + (u.last_name || '')).trim()) || u.email || 'Owner';

// Owners = users flagged is_owner; fall back to admins so the module is never empty.
export async function loadOwners() {
  let { data } = await supabase.from('users').select('user_id,first_name,last_name,email,phone,role,is_owner').eq('is_deleted', false).eq('is_owner', true).order('first_name');
  if (!data || !data.length) { const r = await supabase.from('users').select('user_id,first_name,last_name,email,phone,role,is_owner').eq('is_deleted', false).eq('role', 'admin').order('first_name'); data = r.data || []; }
  return (data || []).map((u) => ({ ...u, name: ownerName(u) }));
}

// All the data the module needs in one shot.
export async function loadOwnerData() {
  const [owners, expRes, ledRes] = await Promise.all([
    loadOwners(),
    supabase.from('expenses').select('expense_id,amount,date,description,category,paid_by,payment_mode,event_id,receipt_url').eq('is_deleted', false).order('date', { ascending: false }),
    supabase.from('owner_ledger').select('*').eq('is_deleted', false).order('entry_date', { ascending: false }),
  ]);
  return { owners, expenses: expRes.data || [], ledger: ledRes.data || [] };
}

// Pure reconciliation. Returns totals, per-owner owed balances, and the personal line.
export function reconcile(owners, expenses, ledger) {
  const num = (n) => parseFloat(n) || 0;
  const expenseTotal = (expenses || []).reduce((s, e) => s + num(e.amount), 0);
  const ownerFunded = (expenses || []).filter((e) => e.paid_by).reduce((s, e) => s + num(e.amount), 0);

  const owed = {};
  (owners || []).forEach((o) => { owed[o.user_id] = 0; });
  (expenses || []).forEach((e) => { if (e.paid_by && owed[e.paid_by] != null) owed[e.paid_by] += num(e.amount); });
  (ledger || []).forEach((l) => {
    if (l.entry_type === 'funding' && l.from_user && owed[l.from_user] != null) owed[l.from_user] += num(l.amount);
    if (l.entry_type === 'reimbursement' && l.to_user && owed[l.to_user] != null) owed[l.to_user] -= num(l.amount);
  });

  // Personal settle line between the first two owners (the supported case).
  let personal = null;
  if ((owners || []).length >= 2) {
    const a = owners[0], b = owners[1];
    let aToB = 0, bToA = 0;
    (ledger || []).forEach((l) => {
      if (l.entry_type !== 'settlement') return;
      if (l.from_user === a.user_id && l.to_user === b.user_id) aToB += num(l.amount);
      if (l.from_user === b.user_id && l.to_user === a.user_id) bToA += num(l.amount);
    });
    const net = aToB - bToA;   // a paid b net → b owes a
    if (Math.round(net) !== 0) {
      personal = net > 0 ? { ower: b, owed: a, amount: Math.abs(net) } : { ower: a, owed: b, amount: Math.abs(net) };
    }
  }
  return { expenseTotal, ownerFunded, owed, personal };
}

export async function addLedgerEntry(entry) {
  const uid = await _currentUid();
  const row = {
    entry_type: entry.entry_type,
    entry_date: entry.entry_date,
    amount: Math.max(0, Math.round(parseFloat(entry.amount) || 0)),
    from_user: entry.from_user || null,
    to_user: entry.to_user || null,
    payment_mode: entry.payment_mode || null,
    reference_number: entry.reference_number || null,
    notes: entry.notes || null,
    created_by: uid || null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_deleted: false,
  };
  return await runDb(supabase.from('owner_ledger').insert(row), 'record entry');
}

export async function updateLedgerEntry(id, entry) {
  const row = {
    entry_type: entry.entry_type, entry_date: entry.entry_date,
    amount: Math.max(0, Math.round(parseFloat(entry.amount) || 0)),
    from_user: entry.from_user || null, to_user: entry.to_user || null,
    payment_mode: entry.payment_mode || null, reference_number: entry.reference_number || null,
    notes: entry.notes || null, updated_at: new Date().toISOString(),
  };
  return await runDb(supabase.from('owner_ledger').update(row).eq('ledger_id', id), 'update entry');
}

export async function deleteLedgerEntry(id) {
  return await runDb(supabase.from('owner_ledger').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('ledger_id', id), 'delete entry');
}

// CSV statement: every owner-funded expense + every ledger entry, chronological.
export function buildStatementCsv(owners, expenses, ledger) {
  const nm = {}; (owners || []).forEach((o) => { nm[o.user_id] = o.name; });
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Date', 'Type', 'From', 'To / Paid by', 'Category', 'Description', 'Amount']];
  (expenses || []).filter((e) => e.paid_by).forEach((e) => {
    rows.push([e.date, 'Expense', nm[e.paid_by] || '—', 'Business', e.category || '', e.description || '', Math.round(parseFloat(e.amount) || 0)]);
  });
  (ledger || []).forEach((l) => {
    rows.push([l.entry_date, l.entry_type.charAt(0).toUpperCase() + l.entry_type.slice(1), nm[l.from_user] || (l.entry_type === 'reimbursement' ? 'Business' : '—'), nm[l.to_user] || '—', '', l.notes || '', Math.round(parseFloat(l.amount) || 0)]);
  });
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
