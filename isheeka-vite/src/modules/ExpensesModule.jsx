// Expenses module — list, filters, KPI cards, create/edit modal (ported verbatim).
import React from 'react';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { _currentUid } from '../lib/session.js';
import { todayLocalStr, fmtDate, EXPENSE_CAT_LABEL } from '../lib/format.js';
import { EXPENSE_CATS } from '../lib/constants.js';
import { waLink } from '../lib/share.js';
import { getNextExpenseRef } from '../lib/refs.js';
import { loadOwners } from '../lib/ownerAccount.js';
import { filesToPayloads, extractExpense, notifyOwnerExpense, extractErrMsg } from '../lib/staffExtract.js';
import { openStoredFile } from '../lib/storage.js';
import { ownerAdminIds, createNotifications } from '../lib/notifications.js';
import { sendPush } from '../lib/push.js';

export function ExpensesModule({ onNavigate }) {
  const [rows, setRows] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [catFilter, setCatFilter] = React.useState('');
  const [evtFilter, setEvtFilter] = React.useState('');
  const [range, setRange] = React.useState('month');
  const [showForm, setShowForm] = React.useState(false);
  const [editRow, setEditRow] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [file, setFile] = React.useState(null);
  const [owners, setOwners] = React.useState([]);
  const [reimbMap, setReimbMap] = React.useState({});   // expense_id → total reimbursed
  const [cap, setCap] = React.useState({ busy: false, paste: false, text: '' });
  const emptyForm = { description: '', amount: '', date: todayLocalStr(), category: 'miscellaneous', sub_category: '', event_id: '', payment_mode: 'upi', reference_number: '', is_recurring: false, recurring_frequency: 'monthly', notes: '', paid_by: '', notify_wa: true, notify_email: true };
  const [form, setForm] = React.useState(emptyForm);
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  React.useEffect(() => { loadOwners().then((o) => setOwners(o || [])).catch(() => {}); }, []);
  const ownerMap = {}; owners.forEach((o) => { ownerMap[o.user_id] = o; });

  const load = React.useCallback(async () => {
    setLoading(true);
    const [{ data: ex }, { data: ev }, { data: rb }] = await Promise.all([
      supabase.from('expenses').select('*').eq('is_deleted', false).order('date', { ascending: false }),
      supabase.from('events').select('event_id,ref_number,name,main_date,client_name').eq('is_deleted', false).order('main_date', { ascending: false }),
      supabase.from('owner_ledger').select('expense_id,amount').eq('entry_type', 'reimbursement').eq('is_deleted', false),
    ]);
    const rm = {}; (rb || []).forEach((x) => { if (x.expense_id) rm[x.expense_id] = (rm[x.expense_id] || 0) + (parseFloat(x.amount) || 0); });
    setReimbMap(rm); setRows(ex || []); setEvents(ev || []); setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const evMap = {}; events.forEach((e) => { evMap[e.event_id] = e; });
  const yr = String(new Date().getFullYear()); const mo = todayLocalStr().slice(0, 7);
  const inRange = (d) => range === 'all' ? true : range === 'year' ? (String(d || '').slice(0, 4) === yr) : (String(d || '').slice(0, 7) === mo);
  const sumIf = (f) => rows.filter(f).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const mMonth = sumIf((r) => String(r.date || '').slice(0, 7) === mo);
  const mYear = sumIf((r) => String(r.date || '').slice(0, 4) === yr);
  const mEvent = sumIf((r) => String(r.date || '').slice(0, 4) === yr && r.event_id);
  const mGeneral = sumIf((r) => String(r.date || '').slice(0, 4) === yr && !r.event_id);
  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    const ms = !q || `${r.description || ''} ${r.reference_number || ''} ${r.sub_category || ''}`.toLowerCase().includes(q);
    const mc = !catFilter || r.category === catFilter;
    const me = !evtFilter || (evtFilter === 'general' ? !r.event_id : r.event_id === evtFilter);
    return ms && mc && me && inRange(r.date);
  });

  const openNew = () => { setEditRow(null); setForm({ ...emptyForm }); setFile(null); setShowForm(true); };
  const openEdit = (r) => {
    if (r.paid_by) { const amtT = parseFloat(r.amount) || 0; const got = reimbMap[r.expense_id] || 0; if (amtT > 0 && got >= amtT && !window.confirm((r.expense_no || 'This expense') + ' is fully reimbursed (settled). Editing it can change the owner reconciliation. Edit anyway?')) return; }
    setEditRow(r); setForm({ description: r.description || '', amount: r.amount || '', date: r.date || emptyForm.date, category: r.category || 'miscellaneous', sub_category: r.sub_category || '', event_id: r.event_id || '', payment_mode: r.payment_mode || 'upi', reference_number: r.reference_number || '', is_recurring: !!r.is_recurring, recurring_frequency: r.recurring_frequency || 'monthly', notes: r.notes || '', paid_by: r.paid_by || '', notify_wa: false, notify_email: false }); setFile(null); setCap({ busy: false, paste: false, text: '' }); setShowForm(true); };

  // Smart capture: receipt photo / file / pasted note → AI fills the form.
  const runCapture = async (input) => {
    setCap((c) => ({ ...c, busy: true }));
    let r;
    try {
      if (typeof input === 'string') r = await extractExpense({ text: input });
      else { const payloads = await filesToPayloads(input); r = await extractExpense({ files: payloads }); }
    } catch (e) { r = { ok: false, error: 'extract_failed' }; }
    setCap({ busy: false, paste: false, text: '' });
    if (!r || !r.ok || !r.expense) { notify(extractErrMsg(r || {}), 'error'); return; }
    const ex = r.expense;
    setForm((f) => ({ ...f, description: ex.description || ex.merchant || f.description, amount: ex.amount != null ? String(ex.amount) : f.amount, date: ex.date || f.date, category: ex.category || f.category }));
    notify('Read the receipt — please review the details.', 'success');
  };
  const save = async () => {
    if (!form.description.trim()) { notify('Description is required.', 'error'); return; }
    const amt = parseFloat(form.amount) || 0; if (amt <= 0) { notify('Enter a valid amount.', 'error'); return; }
    if (!form.date) { notify('Date is required.', 'error'); return; }
    setSaving(true);
    let receiptUrl = editRow ? editRow.receipt_url : null;
    if (file) { try { const ext = ((file.name || '').split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'png'; const path = 'receipts/expenses/exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.' + ext; const { error: ue } = await supabase.storage.from('quotations').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: true }); if (!ue) { receiptUrl = path; } else notify("Couldn't upload the receipt — saving without it.", 'error'); } catch (e) { notify('Receipt upload failed — saving without it.', 'error'); } }
    const payload = { description: form.description.trim(), amount: amt, date: form.date, category: form.category, sub_category: form.sub_category || null, event_id: form.event_id || null, payment_mode: form.payment_mode || null, reference_number: form.reference_number || null, is_recurring: !!form.is_recurring, recurring_frequency: form.is_recurring ? form.recurring_frequency : null, notes: form.notes || null, paid_by: form.paid_by || null, receipt_url: receiptUrl, updated_at: new Date().toISOString() };
    let err;
    if (editRow) { const { error } = await runDb(supabase.from('expenses').update(payload).eq('expense_id', editRow.expense_id), 'update expense'); err = error; }
    else { payload.created_at = new Date().toISOString(); payload.is_deleted = false; payload.created_by = await _currentUid(); try { payload.expense_no = await getNextExpenseRef(); } catch (e) { /* non-fatal */ } const { error } = await runDb(supabase.from('expenses').insert(payload), 'record expense'); err = error; }
    setSaving(false); if (err) return;
    // Owner-funded expense → alert the owners (new entries only).
    if (!editRow && form.paid_by && ownerMap[form.paid_by]) {
      const payer = ownerMap[form.paid_by];
      const summary = { amount: amt, description: form.description.trim(), category: EXPENSE_CAT_LABEL(form.category), date: form.date, paid_by_name: payer.name };
      if (form.notify_email) { const emails = owners.map((o) => o.email).filter(Boolean); notifyOwnerExpense(emails, summary).then((r) => { if (r && r.ok && r.sent) notify('Owners emailed about this expense.', 'success'); }).catch(() => {}); }
      if (form.notify_wa) { const other = owners.find((o) => o.user_id !== form.paid_by) || payer; const msg = payer.name + ' paid ' + inr(amt) + ' for ' + summary.description + ' (' + summary.category + ') on ' + fmtDate(form.date, { day: 'numeric', month: 'short', year: 'numeric' }) + '. Reimbursement requested.'; try { window.open(waLink(other.phone, msg), '_blank'); } catch (e) { /* noop */ } }
      ownerAdminIds().then((ids) => { createNotifications(ids, { type: 'owner_expense', title: 'Expense recorded', body: payer.name + ' paid ' + inr(amt) + ' for ' + summary.description, doc_ref: payload.expense_no || '', link_page: 'owner-account' }); sendPush(ids, { title: 'Expense recorded — ' + (payload.expense_no || ''), body: payer.name + ' paid ' + inr(amt) + ' for ' + summary.description, url: window.location.origin + '/?go=owner', tag: payload.expense_no || 'expense' }); }).catch(() => {});
    }
    notify(editRow ? 'Expense updated.' : 'Expense recorded.', 'success'); setShowForm(false); load();
  };
  const del = async (r) => { if (!window.confirm('Delete this expense?')) return; const { error } = await runDb(supabase.from('expenses').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('expense_id', r.expense_id), 'delete expense'); if (!error) { notify('Expense deleted.', 'success'); load(); } };

  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const reimbStatus = (r) => {
    if (!r.paid_by) return null;
    const amt = parseFloat(r.amount) || 0; const got = reimbMap[r.expense_id] || 0;
    if (amt > 0 && got >= amt) return { l: 'Reimbursed', bg: 'var(--green-light)', c: 'var(--green)' };
    if (got > 0) return { l: 'Partly', bg: 'var(--blue-light)', c: 'var(--blue)' };
    return { l: 'Pending', bg: 'var(--orange-light)', c: '#854F0B' };
  };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>Expenses</div>
        <button className="btn primary" onClick={openNew}>+ Record expense</button>
      </div>
      <div className="metrics-grid" style={{ marginBottom: 18 }}>
        <div className="metric-card pink"><div className="metric-icon">💸</div><div className="metric-value">{inr(mMonth)}</div><div className="metric-label">This month</div></div>
        <div className="metric-card blue"><div className="metric-icon">📅</div><div className="metric-value">{inr(mYear)}</div><div className="metric-label">This year</div></div>
        <div className="metric-card green"><div className="metric-icon">🎪</div><div className="metric-value">{inr(mEvent)}</div><div className="metric-label">Event-linked (yr)</div></div>
        <div className="metric-card orange"><div className="metric-icon">🏢</div><div className="metric-value">{inr(mGeneral)}</div><div className="metric-label">General (yr)</div></div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--grey-400)', pointerEvents: 'none' }}>🔍</span>
          <input className="field-input" style={{ paddingLeft: 36 }} placeholder="Search description / reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="field-input" style={{ width: 160 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}><option value="">All categories</option>{EXPENSE_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="field-input" style={{ width: 180 }} value={evtFilter} onChange={(e) => setEvtFilter(e.target.value)}><option value="">All events</option><option value="general">General (no event)</option>{events.map((e) => <option key={e.event_id} value={e.event_id}>{e.ref_number} · {e.name}{e.client_name ? (' · ' + e.client_name) : ''}{e.main_date ? (' · ' + fmtDate(e.main_date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}</option>)}</select>
        <select className="field-input" style={{ width: 130 }} value={range} onChange={(e) => setRange(e.target.value)}><option value="month">This month</option><option value="year">This year</option><option value="all">All time</option></select>
      </div>
      {loading ? <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        : filtered.length === 0 ? <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: 50, textAlign: 'center', border: '1px solid var(--grey-100)', color: 'var(--grey-400)' }}>No expenses for this view. <button className="btn sm" onClick={openNew}>+ Record one</button></div>
          : <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 150px 130px 96px 64px', gap: 10, padding: '9px 16px', background: 'var(--grey-50)', fontSize: 11, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <div>Date</div><div>Description</div><div>Event</div><div>Category</div><div style={{ textAlign: 'right' }}>Amount</div><div></div>
            </div>
            {filtered.map((r) => { const ev = r.event_id ? evMap[r.event_id] : null; return (
              <div key={r.expense_id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 150px 130px 96px 64px', gap: 10, padding: '11px 16px', borderTop: '1px solid var(--grey-100)', alignItems: 'center', fontSize: 13 }}>
                <div style={{ color: 'var(--grey-500)' }}>{fmtDate(r.date, { day: 'numeric', month: 'short' })}</div>
                <div style={{ color: 'var(--grey-800)' }}>{r.expense_no && <span style={{ fontFamily: 'monospace', fontSize: 10.5, color: 'var(--grey-400)', marginRight: 6 }}>{r.expense_no}</span>}{r.description}{r.receipt_url && <a href="#" onClick={(e) => { e.preventDefault(); openStoredFile(r.receipt_url); }} style={{ color: 'var(--pink)', marginLeft: 6 }}>📎</a>}{r.paid_by && ownerMap[r.paid_by] && <span style={{ marginLeft: 6, fontSize: 10.5, padding: '1px 6px', borderRadius: 10, background: 'var(--pink-light)', color: 'var(--pink-dark)' }}>by {ownerMap[r.paid_by].name}</span>}{(() => { const s = reimbStatus(r); return s ? <span style={{ marginLeft: 6, fontSize: 10.5, padding: '1px 6px', borderRadius: 10, background: s.bg, color: s.c }}>{s.l}</span> : null; })()}</div>
                <div>{ev ? <a onClick={() => onNavigate && onNavigate('events', { eventId: ev.event_id, label: ev.name || ev.ref_number || 'Event' })} style={{ color: 'var(--pink)', cursor: 'pointer', fontWeight: 500 }}>{ev.ref_number}</a> : <span style={{ color: 'var(--grey-400)' }}>General</span>}</div>
                <div><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'var(--blue-light)', color: 'var(--blue)' }}>{EXPENSE_CAT_LABEL(r.category)}</span></div>
                <div style={{ textAlign: 'right', fontWeight: 500 }}>{inr(r.amount)}</div>
                <div style={{ textAlign: 'right' }}><button className="btn sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => openEdit(r)}>✏️</button> <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--grey-300)' }} onClick={() => del(r)}>🗑</button></div>
              </div>
            ); })}
          </div>}

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 540 }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>{editRow ? 'Edit expense' : 'Record expense'}</div>
              <button className="btn sm" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1', border: '1px dashed var(--pink-mid)', borderRadius: 'var(--radius-md)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label className="btn sm" style={{ cursor: 'pointer' }}>📷 Photo<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { if (e.target.files && e.target.files.length) runCapture(e.target.files); e.target.value = ''; }} /></label>
                <label className="btn sm" style={{ cursor: 'pointer' }}>📎 File<input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => { if (e.target.files && e.target.files.length) runCapture(e.target.files); e.target.value = ''; }} /></label>
                <button className="btn sm" type="button" onClick={() => setCap((c) => ({ ...c, paste: !c.paste }))}>📋 Paste</button>
                <span style={{ fontSize: 11.5, color: 'var(--grey-400)' }}>{cap.busy ? '⏳ Reading the receipt…' : '✨ AI fills amount, date & category — just review'}</span>
                {cap.paste && <div style={{ width: '100%', display: 'flex', gap: 8, marginTop: 6 }}>
                  <textarea className="field-textarea" rows={3} style={{ flex: 1, fontSize: 12 }} value={cap.text} onChange={(e) => setCap((c) => ({ ...c, text: e.target.value }))} placeholder="Paste the bill / payment message…" />
                  <button className="btn sm primary" type="button" disabled={cap.busy || !cap.text.trim()} onClick={() => runCapture(cap.text)}>Read</button>
                </div>}
              </div>
              <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Description <span style={{ color: 'var(--pink)' }}>*</span></label><input className="field-input" value={form.description} onChange={(e) => setF('description', e.target.value)} placeholder="e.g. Mandap florals" /></div>
              <div><label className="field-label">Amount (₹) <span style={{ color: 'var(--pink)' }}>*</span></label><input type="number" className="field-input" value={form.amount} onChange={(e) => setF('amount', e.target.value)} placeholder="0" /></div>
              <div><label className="field-label">Date <span style={{ color: 'var(--pink)' }}>*</span></label><input type="date" className="field-input" value={form.date} onChange={(e) => setF('date', e.target.value)} /></div>
              <div><label className="field-label">Category</label><select className="field-input" value={form.category} onChange={(e) => setF('category', e.target.value)}>{EXPENSE_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div><label className="field-label">Paid by</label><select className="field-input" value={form.paid_by} onChange={(e) => setF('paid_by', e.target.value)}><option value="">Business funds</option>{owners.map((o) => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}</select></div>
              <div><label className="field-label">Sub-category</label><input className="field-input" value={form.sub_category} onChange={(e) => setF('sub_category', e.target.value)} placeholder="optional" /></div>
              <div><label className="field-label">Link to event</label><select className="field-input" value={form.event_id} onChange={(e) => setF('event_id', e.target.value)}><option value="">General (no event)</option>{events.map((e) => <option key={e.event_id} value={e.event_id}>{e.ref_number} · {e.name}{e.client_name ? (' · ' + e.client_name) : ''}{e.main_date ? (' · ' + fmtDate(e.main_date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}</option>)}</select></div>
              <div><label className="field-label">Payment mode</label><select className="field-input" value={form.payment_mode} onChange={(e) => setF('payment_mode', e.target.value)}>{[['upi', 'UPI'], ['neft', 'Bank / NEFT'], ['cash', 'Cash'], ['cheque', 'Cheque']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div><label className="field-label">Reference no.</label><input className="field-input" value={form.reference_number} onChange={(e) => setF('reference_number', e.target.value)} placeholder="optional" /></div>
              <div><label className="field-label">Receipt</label><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files && e.target.files[0])} style={{ fontSize: 12 }} /></div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={form.is_recurring} onChange={(e) => setF('is_recurring', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--pink)' }} /><span style={{ fontSize: 13 }}>Recurring</span>{form.is_recurring && <select className="field-input" style={{ width: 140 }} value={form.recurring_frequency} onChange={(e) => setF('recurring_frequency', e.target.value)}>{[['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</div>
              {form.paid_by && !editRow && <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'var(--pink-light)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}>
                <span style={{ fontSize: 12.5, color: 'var(--pink-dark)', fontWeight: 500 }}>Owner-funded — alert the owners:</span>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={form.notify_wa} onChange={(e) => setF('notify_wa', e.target.checked)} /> 💬 WhatsApp</label>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={form.notify_email} onChange={(e) => setF('notify_email', e.target.checked)} /> ✉️ Email both</label>
              </div>}
              <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Notes</label><textarea className="field-textarea" rows={2} value={form.notes} onChange={(e) => setF('notes', e.target.value)} placeholder="optional" /></div>
            </div>
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : (editRow ? 'Save changes' : 'Record expense')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
