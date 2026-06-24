// Owner Account — the relationship layer over the Expenses module. Business expenses
// live in `expenses` (recorded there, with "Paid by"); this screen reads the owner-funded
// ones and adds the owner money-movements (funding / reimbursement / settlement) to
// reconcile "who owes who", plus a downloadable statement. Admin-only.
import React from 'react';
import { notify } from '../lib/toast.jsx';
import { fmtDate, todayLocalStr, EXPENSE_CAT_LABEL } from '../lib/format.js';
import { waLink } from '../lib/share.js';
import { openStoredFile } from '../lib/storage.js';
import { loadOwnerData, reconcile, expenseReimbursements, addLedgerEntry, updateLedgerEntry, deleteLedgerEntry, uploadOwnerProof, buildStatementCsv } from '../lib/ownerAccount.js';

const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const MODES = [['', '—'], ['upi', 'UPI'], ['neft', 'Bank / NEFT'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['card', 'Card'], ['other', 'Other']];
const TYPE_META = {
  expense: { l: 'Expense', bg: 'var(--blue-light)', c: 'var(--blue)' },
  funding: { l: 'Funding', bg: 'var(--pink-light)', c: 'var(--pink-dark)' },
  reimbursement: { l: 'Reimbursement', bg: 'var(--green-light)', c: 'var(--green)' },
  settlement: { l: 'Settlement', bg: 'var(--grey-100)', c: 'var(--grey-500)' },
};

export function OwnerAccountModule({ onNavigate }) {
  const [data, setData] = React.useState({ owners: [], expenses: [], ledger: [] });
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState(null);   // null = closed; else the add/edit entry form
  const [saving, setSaving] = React.useState(false);

  const load = async () => { setLoading(true); const d = await loadOwnerData(); setData(d); setLoading(false); };
  React.useEffect(() => { load(); }, []);

  const { owners, expenses, ledger } = data;
  const nameOf = (id) => (owners.find((o) => o.user_id === id) || {}).name || '—';
  const rec = reconcile(owners, expenses, ledger);

  // per-owner paid / reimbursed breakdown for the cards
  const breakdown = {};
  owners.forEach((o) => { breakdown[o.user_id] = { paid: 0, reimb: 0 }; });
  expenses.forEach((e) => { if (e.paid_by && breakdown[e.paid_by]) breakdown[e.paid_by].paid += parseFloat(e.amount) || 0; });
  ledger.forEach((l) => {
    if (l.entry_type === 'funding' && l.from_user && breakdown[l.from_user]) breakdown[l.from_user].paid += parseFloat(l.amount) || 0;
    if (l.entry_type === 'reimbursement' && l.to_user && breakdown[l.to_user]) breakdown[l.to_user].reimb += parseFloat(l.amount) || 0;
  });

  // per-expense reimbursement status + a ref-number lookup
  const reimb = expenseReimbursements(expenses, ledger);
  const expNoMap = {}; expenses.forEach((e) => { expNoMap[e.expense_id] = e.expense_no; });

  // combined chronological feed: owner-funded expenses + ledger entries
  const feed = [
    ...expenses.filter((e) => e.paid_by).map((e) => ({ kind: 'expense', id: 'e' + e.expense_id, refNo: e.expense_no, date: e.date, amount: parseFloat(e.amount) || 0, label: e.description || '—', sub: EXPENSE_CAT_LABEL(e.category) + ' · by ' + nameOf(e.paid_by), exp: e, st: reimb[e.expense_id] })),
    ...ledger.map((l) => ({ kind: l.entry_type, id: 'l' + l.ledger_id, refNo: l.entry_no, date: l.entry_date, amount: parseFloat(l.amount) || 0, label: feedLabel(l, nameOf, expNoMap), sub: l.notes || '', entry: l })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const reimburseExpense = (e, st) => openType('reimbursement', { to_user: e.paid_by, amount: String(Math.round((st && st.remaining) || (parseFloat(e.amount) || 0))), expense_id: e.expense_id, _forExpenseNo: e.expense_no, _forExpenseDesc: e.description, _forRemaining: (st && st.remaining != null) ? st.remaining : (parseFloat(e.amount) || 0), notes: 'Reimbursement for ' + (e.expense_no || 'expense') });

  const openType = (type, preset) => setForm({ entry_type: type, entry_date: todayLocalStr(), amount: '', from_user: '', to_user: '', expense_id: '', attachment_url: '', _proofFile: null, _proofName: '', notify_wa: true, payment_mode: '', reference_number: '', notes: '', ...(preset || {}) });
  const openEdit = (l) => setForm({ ledger_id: l.ledger_id, entry_no: l.entry_no || '', entry_type: l.entry_type, entry_date: l.entry_date, amount: String(l.amount || ''), from_user: l.from_user || '', to_user: l.to_user || '', expense_id: l.expense_id || '', attachment_url: l.attachment_url || '', _proofFile: null, _proofName: '', notify_wa: false, payment_mode: l.payment_mode || '', reference_number: l.reference_number || '', notes: l.notes || '' });
  const setFf = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const saveEntry = async () => {
    const amt = parseFloat(form.amount) || 0;
    if (amt <= 0) { notify('Enter a valid amount.', 'error'); return; }
    if (form.entry_type === 'funding' && !form.from_user) { notify('Pick who put the money in.', 'error'); return; }
    if (form.entry_type === 'reimbursement' && !form.to_user) { notify('Pick which owner was repaid.', 'error'); return; }
    if (form.entry_type === 'settlement' && (!form.from_user || !form.to_user)) { notify('Pick both owners.', 'error'); return; }
    if (form.entry_type === 'settlement' && form.from_user === form.to_user) { notify('From and To must differ.', 'error'); return; }
    setSaving(true);
    let entry = form;
    if (form._proofFile) { const url = await uploadOwnerProof(form._proofFile); if (url) entry = { ...form, attachment_url: url }; else notify("Couldn't upload the proof — saving without it.", 'error'); }
    const res = form.ledger_id ? await updateLedgerEntry(form.ledger_id, entry) : await addLedgerEntry(entry);
    setSaving(false); if (res && res.error) return;
    const entryNo = (res && res.entry_no) || form.entry_no || '';
    if (form.notify_wa) {
      let recip = owners.find((o) => o.user_id === form.to_user);
      if (!recip && form.entry_type === 'funding') recip = owners.find((o) => o.user_id !== form.from_user);
      if (recip) {
        const amtStr = inr(amt);
        let msg;
        if (form.entry_type === 'reimbursement') {
          const who = nameOf(form.to_user);
          if (form.expense_id && form._forExpenseNo) {
            const rem = parseFloat(form._forRemaining) || 0;
            const full = amt >= rem - 0.5;
            const afterRem = Math.max(0, Math.round(rem - amt));
            msg = who + ' has been reimbursed ' + amtStr + ' (' + (full ? 'full' : 'partial') + ') for "' + (form._forExpenseDesc || 'expense') + '" — ' + form._forExpenseNo + '.' + (full ? '' : ' ' + inr(afterRem) + ' still pending.');
          } else {
            msg = who + ' has been reimbursed ' + amtStr + ' by the business' + (entryNo ? ' — ' + entryNo : '') + '.';
          }
        } else if (form.entry_type === 'funding') {
          msg = nameOf(form.from_user) + ' added ' + amtStr + ' funding to the business' + (entryNo ? ' — ' + entryNo : '') + '.' + (form.notes ? ' (For: ' + form.notes + ')' : '');
        } else {
          msg = nameOf(form.from_user) + ' paid ' + nameOf(form.to_user) + ' ' + amtStr + (entryNo ? ' — ' + entryNo : '') + '.' + (form.notes ? ' (For: ' + form.notes + ')' : '');
        }
        try { window.open(waLink(recip.phone, msg), '_blank'); } catch (e) { /* noop */ }
      }
    }
    notify(form.ledger_id ? 'Entry updated.' : 'Entry recorded.', 'success'); setForm(null); load();
  };
  const removeEntry = async (l) => { if (!window.confirm('Delete this ' + (TYPE_META[l.entry_type] || {}).l + ' entry?')) return; const { error } = await deleteLedgerEntry(l.ledger_id); if (!error) { notify('Deleted.', 'success'); load(); } };

  const downloadStatement = () => {
    const csv = buildStatementCsv(owners, expenses, ledger);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'owner-account-statement-' + todayLocalStr() + '.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>Owner account</div>
          <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>Who fronted what · who owes whom · admin only</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={downloadStatement}>📄 Statement</button>
          <button className="btn sm" onClick={() => onNavigate && onNavigate('expenses')}>＋ Record expense</button>
          <button className="btn primary" onClick={() => openType('funding')}>＋ Add entry</button>
        </div>
      </div>

      {owners.length < 2 && <div style={{ background: 'var(--orange-light)', color: '#854F0B', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 12.5, marginBottom: 14 }}>⚠ Fewer than two owners are flagged. Mark the owners in Users (or the database) so reconciliation works fully.</div>}

      {/* Headline numbers */}
      <div className="metrics-grid" style={{ marginBottom: 16 }}>
        <div className="metric-card blue"><div className="metric-icon">💼</div><div className="metric-value">{inr(rec.expenseTotal)}</div><div className="metric-label">Business expenses · total</div></div>
        <div className="metric-card pink"><div className="metric-icon">🤝</div><div className="metric-value">{inr(rec.ownerFunded)}</div><div className="metric-label">Owner-funded</div></div>
        {owners.map((o) => (
          <div key={o.user_id} className="metric-card green"><div className="metric-icon">👤</div><div className="metric-value">{inr(rec.owed[o.user_id] || 0)}</div><div className="metric-label">Business owes {o.name.split(' ')[0]}</div></div>
        ))}
      </div>

      {/* Per-owner detail + reimburse shortcut */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12, marginBottom: 16 }}>
        {owners.map((o) => { const b = breakdown[o.user_id] || { paid: 0, reimb: 0 }; const owed = rec.owed[o.user_id] || 0; return (
          <div key={o.user_id} style={{ background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: 'var(--grey-800)' }}>{o.name}</span>
              {owed > 0 && <button className="btn sm" onClick={() => openType('reimbursement', { to_user: o.user_id, amount: String(Math.round(owed)) })}>Reimburse</button>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--grey-500)', padding: '2px 0' }}><span>Put in (expenses + funding)</span><span>{inr(b.paid)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--grey-500)', padding: '2px 0' }}><span>Reimbursed</span><span>{inr(b.reimb)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, padding: '6px 0 0', marginTop: 6, borderTop: '1px solid var(--grey-100)' }}><span>Owed back</span><span style={{ color: owed >= 0 ? 'var(--green)' : 'var(--red)' }}>{inr(owed)}</span></div>
          </div>
        ); })}
      </div>

      {/* Personal settle line */}
      {rec.personal && <div style={{ background: 'var(--blue-light)', borderRadius: 'var(--radius-lg)', padding: '12px 18px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--blue)' }}>Personal balance (owner ↔ owner)</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--blue)' }}>{rec.personal.ower.name} owes {rec.personal.owed.name} {inr(rec.personal.amount)}</div>
        </div>
        <button className="btn sm" onClick={() => openType('settlement', { from_user: rec.personal.ower.user_id, to_user: rec.personal.owed.user_id, amount: String(Math.round(rec.personal.amount)) })}>Settle up</button>
      </div>}

      {/* Combined ledger */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--grey-100)', fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>Ledger</div>
        {feed.length === 0 ? <div style={{ padding: 36, textAlign: 'center', color: 'var(--grey-400)', fontSize: 13 }}>Nothing yet. Record an owner-funded expense, or add a funding / reimbursement entry.</div>
          : feed.map((f) => { const m = TYPE_META[f.kind] || TYPE_META.settlement; return (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: '1px solid var(--grey-100)' }}>
              <span style={{ fontSize: 12, color: 'var(--grey-400)', width: 56, flexShrink: 0 }}>{fmtDate(f.date, { day: 'numeric', month: 'short' })}</span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: m.bg, color: m.c, flexShrink: 0 }}>{m.l}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--grey-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.refNo && <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--grey-400)', marginRight: 6 }}>{f.refNo}</span>}{f.label}{f.entry && f.entry.attachment_url && <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openStoredFile(f.entry.attachment_url); }} style={{ marginLeft: 6, color: 'var(--pink)' }}>📎</a>}</div>
                {f.sub && <div style={{ fontSize: 11.5, color: 'var(--grey-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.sub}</div>}
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{inr(f.amount)}</span>
              {f.kind === 'expense' && f.st && f.st.applicable && (f.st.status === 'reimbursed'
                ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'var(--green-light)', color: 'var(--green)', flexShrink: 0 }}>✓ Reimbursed</span>
                : <button className="btn sm" style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }} onClick={() => reimburseExpense(f.exp, f.st)}>{f.st.status === 'partial' ? 'Reimburse rest' : 'Reimburse'}</button>)}
              <div style={{ width: 56, textAlign: 'right', flexShrink: 0 }}>
                {f.kind === 'expense'
                  ? <button className="btn sm" style={{ fontSize: 11, padding: '2px 6px' }} title="Open in Expenses" onClick={() => onNavigate && onNavigate('expenses')}>↗</button>
                  : <><button className="btn sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => openEdit(f.entry)}>✏️</button> <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--grey-300)' }} onClick={() => removeEntry(f.entry)}>🗑</button></>}
              </div>
            </div>
          ); })}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--grey-400)', marginTop: 10 }}>💡 Business expenses are recorded in the Expenses module (set “Paid by” to an owner there to make them owner-funded). This screen adds funding, reimbursements and owner-to-owner settlements.</div>

      {form && <EntryModal form={form} owners={owners} setFf={setFf} saving={saving} onSave={saveEntry} onClose={() => setForm(null)} />}
    </div>
  );
}

function feedLabel(l, nameOf, expNoMap) {
  if (l.entry_type === 'funding') return nameOf(l.from_user) + ' funded ' + (l.to_user ? nameOf(l.to_user) : 'the business');
  if (l.entry_type === 'reimbursement') { const ref = (l.expense_id && expNoMap && expNoMap[l.expense_id]) ? (' for ' + expNoMap[l.expense_id]) : ''; return (l.from_user ? nameOf(l.from_user) : 'Business') + ' reimbursed ' + nameOf(l.to_user) + ref; }
  if (l.entry_type === 'settlement') return nameOf(l.from_user) + ' → ' + nameOf(l.to_user);
  return '—';
}

function EntryModal({ form, owners, setFf, saving, onSave, onClose }) {
  const t = form.entry_type;
  const ownerOpts = owners.map((o) => <option key={o.user_id} value={o.user_id}>{o.name}</option>);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 480 }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>{form.ledger_id ? 'Edit entry' : 'Add entry'}</div>
          <button className="btn sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 22 }} onPaste={(e) => { const items = (e.clipboardData || {}).items || []; for (const it of items) { if (it.type && it.type.indexOf('image') === 0) { const f = it.getAsFile(); if (f) { setFf('_proofFile', f); setFf('_proofName', f.name || 'pasted-image.png'); } e.preventDefault(); break; } } }}>
          {!form.ledger_id && !form.expense_id && <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {['funding', 'reimbursement', 'settlement'].map((k) => (
              <button key={k} className={'btn sm' + (t === k ? ' primary' : '')} onClick={() => setFf('entry_type', k)}>{TYPE_META[k].l}</button>
            ))}
          </div>}
          {form.expense_id && form._forExpenseNo && <div style={{ marginBottom: 14, fontSize: 12.5, color: 'var(--green)', background: 'var(--green-light)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>↩ Reimbursing <b>{form._forExpenseNo}</b> — saving marks that expense reimbursed.</div>}
          <div style={{ fontSize: 12, color: 'var(--grey-500)', marginBottom: 14, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
            {t === 'funding' && 'An owner puts personal money into the business (or hands it to the other owner for business use). The funder is owed it back.'}
            {t === 'reimbursement' && 'The business pays an owner back — reduces what the business owes them. Not a business expense.'}
            {t === 'settlement' && 'A personal payment between the owners (e.g. a loan or its payback). Adjusts the personal balance only.'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {t === 'funding' && <div><label className="field-label">From (put money in) <span style={{ color: 'var(--pink)' }}>*</span></label><select className="field-input" value={form.from_user} onChange={(e) => setFf('from_user', e.target.value)}><option value="">Select owner…</option>{ownerOpts}</select></div>}
            {t === 'funding' && <div><label className="field-label">To (optional)</label><select className="field-input" value={form.to_user} onChange={(e) => setFf('to_user', e.target.value)}><option value="">Business</option>{ownerOpts}</select></div>}
            {t === 'reimbursement' && <div><label className="field-label">From</label><select className="field-input" value={form.from_user} onChange={(e) => setFf('from_user', e.target.value)}><option value="">Business</option>{ownerOpts}</select></div>}
            {t === 'reimbursement' && <div><label className="field-label">To (owner repaid) <span style={{ color: 'var(--pink)' }}>*</span></label><select className="field-input" value={form.to_user} onChange={(e) => setFf('to_user', e.target.value)}><option value="">Select owner…</option>{ownerOpts}</select></div>}
            {t === 'settlement' && <div><label className="field-label">From (paid) <span style={{ color: 'var(--pink)' }}>*</span></label><select className="field-input" value={form.from_user} onChange={(e) => setFf('from_user', e.target.value)}><option value="">Select…</option>{ownerOpts}</select></div>}
            {t === 'settlement' && <div><label className="field-label">To (received) <span style={{ color: 'var(--pink)' }}>*</span></label><select className="field-input" value={form.to_user} onChange={(e) => setFf('to_user', e.target.value)}><option value="">Select…</option>{ownerOpts}</select></div>}
            <div><label className="field-label">Amount (₹) <span style={{ color: 'var(--pink)' }}>*</span></label><input type="number" className="field-input" value={form.amount} onChange={(e) => setFf('amount', e.target.value)} placeholder="0" /></div>
            <div><label className="field-label">Date</label><input type="date" className="field-input" value={form.entry_date} onChange={(e) => setFf('entry_date', e.target.value)} /></div>
            <div><label className="field-label">Payment mode</label><select className="field-input" value={form.payment_mode} onChange={(e) => setFf('payment_mode', e.target.value)}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="field-label">Reference no.</label><input className="field-input" value={form.reference_number} onChange={(e) => setFf('reference_number', e.target.value)} placeholder="optional" /></div>
            <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Notes</label><textarea className="field-textarea" rows={2} value={form.notes} onChange={(e) => setFf('notes', e.target.value)} placeholder="optional" /></div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="field-label">Proof (optional)</label>
              <div style={{ border: '1px dashed var(--grey-200)', borderRadius: 'var(--radius-md)', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label className="btn sm" style={{ cursor: 'pointer' }}>📷 Photo<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { setFf('_proofFile', f); setFf('_proofName', f.name); } e.target.value = ''; }} /></label>
                <label className="btn sm" style={{ cursor: 'pointer' }}>📎 File<input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { setFf('_proofFile', f); setFf('_proofName', f.name); } e.target.value = ''; }} /></label>
                <span style={{ fontSize: 11.5, color: 'var(--grey-400)' }}>or paste a screenshot (Ctrl/Cmd-V)</span>
                {(form._proofName || form.attachment_url) && <span style={{ fontSize: 11.5, color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>🖼 {form._proofName || 'attached'} <span style={{ cursor: 'pointer', color: 'var(--grey-400)' }} onClick={() => { setFf('_proofFile', null); setFf('_proofName', ''); setFf('attachment_url', ''); }}>✕</span></span>}
              </div>
            </div>
            <label style={{ gridColumn: '1 / -1', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--green-light)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}>
              <input type="checkbox" checked={!!form.notify_wa} onChange={(e) => setFf('notify_wa', e.target.checked)} /> 💬 Notify the other owner on WhatsApp (opens pre-filled on save)
            </label>
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : (form.ledger_id ? 'Save changes' : 'Record entry')}</button>
        </div>
      </div>
    </div>
  );
}
