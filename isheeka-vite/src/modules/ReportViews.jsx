// Finance report tabs rendered inside the Reports module: Receivables (AR),
// Payables (AP), and Owner settlement. Each loads its own data, renders an
// on-screen view, and exports an Isheeka-branded .xlsx + WhatsApp/email summary.
import React from 'react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/toast.jsx';
import { fmtDate, todayLocalStr } from '../lib/format.js';
import { buildAR, buildAP, buildOwnerSettlement } from '../lib/financeReports.js';
import { downloadBrandedWorkbook } from '../lib/brandedXlsx.js';
import { loadOwnerData } from '../lib/ownerAccount.js';

const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const useCompany = () => { const [co, setCo] = React.useState('Isheeka Events'); React.useEffect(() => { supabase.from('settings').select('company_name').limit(1).maybeSingle().then(({ data }) => { if (data && data.company_name) setCo(data.company_name); }); }, []); return co; };

function Sharer({ text }) {
  const wa = 'https://wa.me/?text=' + encodeURIComponent(text);
  const mail = 'mailto:?subject=' + encodeURIComponent('Isheeka — report summary') + '&body=' + encodeURIComponent(text);
  return (
    <>
      <a className="btn sm" style={{ textDecoration: 'none' }} href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>
      <a className="btn sm" style={{ textDecoration: 'none' }} href={mail}>✉️ Email</a>
    </>
  );
}

const card = { background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', padding: '16px 18px' };
const dateInput = (v, on) => <input type="date" className="field-input" style={{ width: 150 }} value={v} onChange={(e) => on(e.target.value)} />;

// ─────────────────────────────── Receivables ───────────────────────────────
export function ReceivablesReport() {
  const co = useCompany();
  const [invoices, setInvoices] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [asOf, setAsOf] = React.useState(todayLocalStr());
  const [openOnly, setOpenOnly] = React.useState(true);
  React.useEffect(() => { (async () => {
    setLoading(true);
    const [{ data: inv }, { data: ev }] = await Promise.all([
      supabase.from('invoices').select('invoice_id,ref_number,status,client_name,event_id,event_name,doc_date,due_date,grand_total,total_received,total_outstanding').eq('is_deleted', false),
      supabase.from('events').select('event_id,ref_number,name').eq('is_deleted', false),
    ]);
    setInvoices(inv || []); setEvents(ev || []); setLoading(false);
  })(); }, []);
  const evMap = {}; events.forEach((e) => { evMap[e.event_id] = e; });
  const ar = buildAR(invoices, { asOf, outstandingOnly: openOnly });
  const evRef = (id) => (evMap[id] || {}).ref_number || '—';

  const exportXlsx = () => {
    const rows = ar.rows.map((r) => [evRef(r.event_id), r.client_name || '', r.ref_number || '', r.invoiced, r.received, r.balance, r.due || '', r.balance > 0 && r.daysOverdue > 0 ? r.daysOverdue + 'd overdue' : 'Current']);
    downloadBrandedWorkbook('Isheeka_Receivables_' + asOf + '.xlsx', co, [{
      name: 'Receivables', title: 'Accounts receivable', subtitle: 'As of ' + asOf,
      columns: [{ label: 'Event', width: 12 }, { label: 'Client', width: 20 }, { label: 'Invoice', width: 14 }, { label: 'Invoiced', width: 14, align: 'right', fmt: 'money' }, { label: 'Received', width: 14, align: 'right', fmt: 'money' }, { label: 'Balance', width: 14, align: 'right', fmt: 'money' }, { label: 'Due', width: 12 }, { label: 'Status', width: 14 }],
      rows, totals: ['Total', '', '', ar.totals.invoiced, ar.totals.received, ar.totals.balance, '', ''],
      notes: ['Aging — Current ' + inr(ar.aging.current) + ' · 1–30d ' + inr(ar.aging.d30) + ' · 31–60d ' + inr(ar.aging.d60) + ' · 60+d ' + inr(ar.aging.d60p)],
    }]);
  };
  const shareText = co + ' — Accounts receivable (as of ' + asOf + ')\nTotal due: ' + inr(ar.totalReceivable) + ' · Overdue: ' + inr(ar.overdue) + '\nCurrent ' + inr(ar.aging.current) + ' / 1–30 ' + inr(ar.aging.d30) + ' / 31–60 ' + inr(ar.aging.d60) + ' / 60+ ' + inr(ar.aging.d60p);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  return (
    <div>
      <div style={{ ...card, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div><div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 4 }}>As of</div>{dateInput(asOf, setAsOf)}</div>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Outstanding only</label>
        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={exportXlsx}>⬇ Excel</button>
        <Sharer text={shareText} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 }}>
        {[['Total receivable', ar.totalReceivable, 'var(--blue)'], ['Current', ar.aging.current, 'var(--green)'], ['1–30 d', ar.aging.d30, 'var(--orange)'], ['31–60 d', ar.aging.d60, 'var(--orange)'], ['60+ d', ar.aging.d60p, 'var(--red)']].map(([l, v, c]) => (
          <div key={l} style={{ ...card, padding: '12px 14px' }}><div style={{ fontSize: 18, fontWeight: 700, color: c }}>{inr(v)}</div><div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 2 }}>{l}</div></div>
        ))}
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1.4fr 110px 100px 100px 100px 90px', gap: 6, padding: '9px 16px', background: 'var(--grey-50)', fontSize: 10, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <div>Event</div><div>Client · Invoice</div><div style={{ textAlign: 'right' }}>Invoiced</div><div style={{ textAlign: 'right' }}>Received</div><div style={{ textAlign: 'right' }}>Balance</div><div style={{ textAlign: 'right' }}>Due</div><div style={{ textAlign: 'right' }}>Status</div>
        </div>
        {ar.rows.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--grey-400)', fontSize: 13 }}>No receivables for this view.</div>
          : ar.rows.map((r) => (
            <div key={r.invoice_id} style={{ display: 'grid', gridTemplateColumns: '90px 1.4fr 110px 100px 100px 100px 90px', gap: 6, padding: '10px 16px', borderTop: '1px solid var(--grey-100)', fontSize: 12.5, alignItems: 'center' }}>
              <div style={{ fontFamily: 'monospace', color: 'var(--grey-500)', fontSize: 11 }}>{evRef(r.event_id)}</div>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.client_name || '—'} · <span style={{ color: 'var(--pink)' }}>{r.ref_number}</span></div>
              <div style={{ textAlign: 'right' }}>{inr(r.invoiced)}</div>
              <div style={{ textAlign: 'right' }}>{inr(r.received)}</div>
              <div style={{ textAlign: 'right', fontWeight: 600 }}>{inr(r.balance)}</div>
              <div style={{ textAlign: 'right', color: 'var(--grey-400)' }}>{r.due ? fmtDate(r.due, { day: 'numeric', month: 'short' }) : '—'}</div>
              <div style={{ textAlign: 'right', color: r.daysOverdue > 60 ? 'var(--red)' : r.daysOverdue > 0 ? 'var(--orange)' : 'var(--green)' }}>{r.daysOverdue > 0 ? r.daysOverdue + 'd' : 'Current'}</div>
            </div>
          ))}
        {ar.rows.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: '90px 1.4fr 110px 100px 100px 100px 90px', gap: 6, padding: '10px 16px', borderTop: '2px solid var(--grey-200)', fontSize: 12.5, fontWeight: 600, background: 'var(--grey-50)' }}>
          <div>Total</div><div /><div style={{ textAlign: 'right' }}>{inr(ar.totals.invoiced)}</div><div style={{ textAlign: 'right' }}>{inr(ar.totals.received)}</div><div style={{ textAlign: 'right' }}>{inr(ar.totals.balance)}</div><div /><div />
        </div>}
      </div>
    </div>
  );
}

// ──────────────────────────────── Payables ────────────────────────────────
export function PayablesReport() {
  const co = useCompany();
  const [evs, setEvs] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [openOnly, setOpenOnly] = React.useState(true);
  React.useEffect(() => { (async () => {
    setLoading(true);
    const [{ data: ev }, { data: events2 }] = await Promise.all([
      supabase.from('event_vendors').select('event_vendor_id,event_id,vendor_id,vendor_name,service_description,agreed_amount,total_paid,outstanding,status').eq('is_deleted', false),
      supabase.from('events').select('event_id,ref_number,name,client_name').eq('is_deleted', false),
    ]);
    setEvs(ev || []); setEvents(events2 || []); setLoading(false);
  })(); }, []);
  const evMap = {}; events.forEach((e) => { evMap[e.event_id] = e; });
  const ap = buildAP(evs, evMap, { outstandingOnly: openOnly });

  const exportXlsx = () => {
    const rows = ap.rows.map((r) => [r.event_ref || '—', r.vendor_name || '', r.service_description || '', r.committed, r.paid, r.balance]);
    downloadBrandedWorkbook('Isheeka_Payables_' + todayLocalStr() + '.xlsx', co, [{
      name: 'Payables', title: 'Accounts payable', subtitle: 'As of ' + todayLocalStr(),
      columns: [{ label: 'Event', width: 12 }, { label: 'Vendor', width: 20 }, { label: 'Service', width: 24 }, { label: 'Committed', width: 14, align: 'right', fmt: 'money' }, { label: 'Paid', width: 14, align: 'right', fmt: 'money' }, { label: 'Balance', width: 14, align: 'right', fmt: 'money' }],
      rows, totals: ['Total', '', '', ap.totals.committed, ap.totals.paid, ap.totals.balance],
    }]);
  };
  const shareText = co + ' — Accounts payable (as of ' + todayLocalStr() + ')\nTotal payable: ' + inr(ap.totalPayable) + '\nCommitted ' + inr(ap.totals.committed) + ' · Paid ' + inr(ap.totals.paid);
  const vendorRoll = Object.entries(ap.byVendor).sort((a, b) => b[1] - a[1]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  return (
    <div>
      <div style={{ ...card, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--grey-600)' }}>As of <b>{fmtDate(todayLocalStr(), { day: 'numeric', month: 'short', year: 'numeric' })}</b></div>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Outstanding only</label>
        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={exportXlsx}>⬇ Excel</button>
        <Sharer text={shareText} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12, marginBottom: 14 }}>
        <div style={{ ...card }}><div style={{ fontSize: 20, fontWeight: 700, color: 'var(--orange)' }}>{inr(ap.totalPayable)}</div><div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 2 }}>Total payable · {ap.rows.length} line{ap.rows.length === 1 ? '' : 's'}</div></div>
        <div style={{ ...card }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-600)', marginBottom: 6 }}>By vendor</div>
          {vendorRoll.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--grey-400)' }}>None outstanding.</div> : vendorRoll.slice(0, 6).map(([v, amt]) => (
            <div key={v} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0', color: 'var(--grey-600)' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span><span>{inr(amt)}</span></div>
          ))}
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1.3fr 110px 110px 110px', gap: 6, padding: '9px 16px', background: 'var(--grey-50)', fontSize: 10, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <div>Event</div><div>Vendor</div><div style={{ textAlign: 'right' }}>Committed</div><div style={{ textAlign: 'right' }}>Paid</div><div style={{ textAlign: 'right' }}>Balance</div>
        </div>
        {ap.rows.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--grey-400)', fontSize: 13 }}>No payables for this view.</div>
          : ap.rows.map((r) => (
            <div key={r.event_vendor_id} style={{ display: 'grid', gridTemplateColumns: '90px 1.3fr 110px 110px 110px', gap: 6, padding: '10px 16px', borderTop: '1px solid var(--grey-100)', fontSize: 12.5, alignItems: 'center' }}>
              <div style={{ fontFamily: 'monospace', color: 'var(--grey-500)', fontSize: 11 }}>{r.event_ref || '—'}</div>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.vendor_name || '—'}</div>
              <div style={{ textAlign: 'right' }}>{inr(r.committed)}</div>
              <div style={{ textAlign: 'right' }}>{inr(r.paid)}</div>
              <div style={{ textAlign: 'right', fontWeight: 600 }}>{inr(r.balance)}</div>
            </div>
          ))}
        {ap.rows.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: '90px 1.3fr 110px 110px 110px', gap: 6, padding: '10px 16px', borderTop: '2px solid var(--grey-200)', fontSize: 12.5, fontWeight: 600, background: 'var(--grey-50)' }}>
          <div>Total</div><div /><div style={{ textAlign: 'right' }}>{inr(ap.totals.committed)}</div><div style={{ textAlign: 'right' }}>{inr(ap.totals.paid)}</div><div style={{ textAlign: 'right' }}>{inr(ap.totals.balance)}</div>
        </div>}
      </div>
    </div>
  );
}

// ─────────────────────────── Owner settlement ───────────────────────────
export function OwnerSettlementReport() {
  const co = useCompany();
  const [data, setData] = React.useState({ owners: [], expenses: [], ledger: [] });
  const [loading, setLoading] = React.useState(true);
  const yr = new Date().getFullYear();
  const [from, setFrom] = React.useState(yr + '-01-01');
  const [to, setTo] = React.useState(todayLocalStr());
  React.useEffect(() => { (async () => { setLoading(true); const d = await loadOwnerData(); setData(d); setLoading(false); })(); }, []);
  const { owners, expenses, ledger } = data;
  const nameOf = (id) => (owners.find((o) => o.user_id === id) || {}).name || '—';
  const rep = buildOwnerSettlement(owners, expenses, ledger, { from, to });
  const netText = rep.net ? (rep.net.settled ? 'All square between the owners' : (rep.net.ower.name + ' owes ' + rep.net.owed.name + ' ' + inr(rep.net.amount))) : '—';

  const allTx = () => {
    const out = [];
    owners.forEach((o) => rep.txByOwner[o.user_id].forEach((t) => out.push([t.id, t.date, o.name, t.type, t.detail, (t.sign < 0 ? -t.amount : t.amount)])));
    rep.settlements.forEach((s) => out.push([s.id, s.date, nameOf(s.from) + ' → ' + nameOf(s.to), 'Settlement', s.notes, s.amount]));
    return out.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  };
  const exportXlsx = () => {
    const summaryRows = owners.map((o) => [o.name, rep.owed[o.user_id] || 0]);
    downloadBrandedWorkbook('Isheeka_OwnerSettlement_' + to + '.xlsx', co, [
      { name: 'Summary', title: 'Owner settlement', subtitle: from + ' to ' + to, columns: [{ label: 'Owner', width: 24 }, { label: 'Net owed by business', width: 22, align: 'right', fmt: 'money' }], rows: summaryRows, totals: ['Net: ' + netText, ''], notes: ['Owner-funded expenses in range: ' + inr(rep.expenseTotal)] },
      { name: 'Transactions', title: 'Transactions', subtitle: from + ' to ' + to, columns: [{ label: 'ID', width: 14 }, { label: 'Date', width: 12 }, { label: 'Owner / parties', width: 24 }, { label: 'Type', width: 14 }, { label: 'Detail', width: 30 }, { label: 'Amount', width: 14, align: 'right', fmt: 'money' }], rows: allTx() },
    ]);
  };

  const exportPdf = () => {
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const PINK = [232, 24, 90], INK = [40, 40, 40], MUTED = [140, 140, 140];
      const W = doc.internal.pageSize.getWidth(), M = 42;
      doc.setFillColor(PINK[0], PINK[1], PINK[2]); doc.rect(0, 0, W, 70, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(co, M, 38);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text('Owner settlement report', M, 56);
      doc.setFontSize(10); doc.text(from + '  to  ' + to, W - M, 56, { align: 'right' });
      doc.setTextColor(INK[0], INK[1], INK[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(netText, M, 100);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text('Owner-funded expenses in range: ' + inr(rep.expenseTotal), M, 116);
      const body = allTx().map((r) => [r[0], r[1], r[2], r[3], '₹' + Math.round(r[5]).toLocaleString('en-IN')]);
      doc.autoTable({ startY: 132, head: [['ID', 'Date', 'Owner / parties', 'Type', 'Amount']], body, styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: PINK, textColor: 255 }, columnStyles: { 4: { halign: 'right' } }, theme: 'grid', tableLineColor: PINK, tableLineWidth: 0.3, margin: { left: M, right: M } });
      doc.save('Isheeka_OwnerSettlement_' + to + '.pdf');
      notify('PDF downloaded.', 'success');
    } catch (e) { notify('Could not export PDF.', 'error'); }
  };
  const shareText = co + ' — Owner settlement (' + from + ' to ' + to + ')\n' + netText + '\nOwner-funded expenses in range: ' + inr(rep.expenseTotal);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  return (
    <div>
      <div style={{ ...card, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div><div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 4 }}>From</div>{dateInput(from, setFrom)}</div>
        <div><div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 4 }}>To</div>{dateInput(to, setTo)}</div>
        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={exportPdf}>⬇ PDF</button>
        <button className="btn sm" onClick={exportXlsx}>⬇ Excel</button>
        <Sharer text={shareText} />
      </div>

      <div style={{ ...card, background: 'var(--blue-light)', border: 'none', marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--blue)' }}>Net · {from} to {to}</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--blue)' }}>{netText}</div>
      </div>

      {owners.map((o) => { const tx = rep.txByOwner[o.user_id] || []; return (
        <div key={o.user_id} style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: tx.length ? '1px solid var(--grey-100)' : 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>{o.name}</div>
            <div style={{ fontSize: 13 }}>Net owed by business: <b style={{ color: (rep.owed[o.user_id] || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{inr(rep.owed[o.user_id] || 0)}</b></div>
          </div>
          {tx.length === 0 ? <div style={{ padding: '10px 16px', fontSize: 12.5, color: 'var(--grey-400)' }}>No transactions in range.</div>
            : tx.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 64px 1fr 110px', gap: 8, padding: '8px 16px', borderTop: i ? '1px solid var(--grey-50)' : 'none', fontSize: 12.5, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--grey-500)', fontSize: 11 }}>{t.id || '—'}</span>
                <span style={{ color: 'var(--grey-400)' }}>{t.date ? fmtDate(t.date, { day: 'numeric', month: 'short' }) : '—'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.type}{t.detail ? (' · ' + t.detail) : ''}</span>
                <span style={{ textAlign: 'right', color: t.sign < 0 ? 'var(--red)' : 'var(--grey-800)' }}>{t.sign < 0 ? '− ' : ''}{inr(t.amount)}</span>
              </div>
            ))}
        </div>
      ); })}

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>Owner ↔ owner settlements</div>
        {rep.settlements.length === 0 ? <div style={{ padding: '0 16px 14px', fontSize: 12.5, color: 'var(--grey-400)' }}>None in range.</div>
          : rep.settlements.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 64px 1fr 110px', gap: 8, padding: '8px 16px', borderTop: '1px solid var(--grey-50)', fontSize: 12.5, alignItems: 'center' }}>
              <span style={{ fontFamily: 'monospace', color: 'var(--grey-500)', fontSize: 11 }}>{s.id || '—'}</span>
              <span style={{ color: 'var(--grey-400)' }}>{fmtDate(s.date, { day: 'numeric', month: 'short' })}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(s.from)} → {nameOf(s.to)}{s.notes ? (' · ' + s.notes) : ''}</span>
              <span style={{ textAlign: 'right' }}>{inr(s.amount)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
