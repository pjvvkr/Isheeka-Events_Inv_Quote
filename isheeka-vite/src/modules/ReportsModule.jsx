// Reports module — KPI dashboard, 12-month charts, pipeline, per-event P&L,
// Excel + PDF exports. Ported verbatim except jsPDF comes from npm (not window.jspdf).
import React from 'react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/toast.jsx';
import { todayLocalStr, fmtDate, leadStageDisplay } from '../lib/format.js';
import { EventQuickView } from '../components/EventQuickView.jsx';
import { ReceivablesReport, PayablesReport, OwnerSettlementReport } from './ReportViews.jsx';
import { downloadBrandedWorkbook } from '../lib/brandedXlsx.js';

export function ReportsModule({ onNavigate }) {
  const [loading, setLoading] = React.useState(true);
  const [range, setRange] = React.useState('year'); // month | quarter | year | all
  const [invoices, setInvoices] = React.useState([]);
  const [pays, setPays] = React.useState([]);
  const [expenses, setExpenses] = React.useState([]);
  const [vpays, setVpays] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [leads, setLeads] = React.useState([]);
  const [popupEvent, setPopupEvent] = React.useState(null);
  const [tab, setTab] = React.useState('overview');   // overview | receivables | payables | settlement
  const [cFrom, setCFrom] = React.useState(new Date().getFullYear() + '-01-01');
  const [cTo, setCTo] = React.useState(todayLocalStr());

  const load = React.useCallback(async () => {
    setLoading(true);
    const [{ data: inv }, { data: ip }, { data: ex }, { data: vp }, { data: ev }, { data: ld }] = await Promise.all([
      supabase.from('invoices').select('invoice_id,ref_number,status,grand_total,total_received,total_outstanding,event_id,doc_date').eq('is_deleted', false),
      supabase.from('invoice_payments').select('amount,payment_date,invoice_id').eq('is_deleted', false),
      supabase.from('expenses').select('amount,date,event_id,category').eq('is_deleted', false),
      supabase.from('vendor_payments').select('amount,payment_date,event_id,is_voided').eq('is_deleted', false),
      supabase.from('events').select('event_id,ref_number,name,main_date,status,client_name').eq('is_deleted', false),
      supabase.from('leads').select('lead_id,stage,budget').eq('is_deleted', false),
    ]);
    setInvoices(inv || []); setPays(ip || []); setExpenses(ex || []); setVpays(vp || []); setEvents(ev || []); setLeads(ld || []); setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const inrK = (n) => { n = n || 0; const a = Math.abs(n); if (a >= 1e7) return '₹' + (n / 1e7).toFixed(2) + 'Cr'; if (a >= 1e5) return '₹' + (n / 1e5).toFixed(2) + 'L'; if (a >= 1e3) return '₹' + Math.round(n / 1e3) + 'k'; return '₹' + Math.round(n); };
  const today = todayLocalStr(); const now = new Date(); const yr = now.getFullYear();
  const rangeBounds = () => {
    if (range === 'all') return [null, null];
    if (range === 'custom') { let e = null; if (cTo) { const d = new Date(cTo + 'T00:00:00'); d.setDate(d.getDate() + 1); e = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); } return [cFrom || null, e]; }
    if (range === 'year') return [yr + '-01-01', (yr + 1) + '-01-01'];
    if (range === 'month') { const m = String(now.getMonth() + 1).padStart(2, '0'); const nm = now.getMonth() === 11 ? (yr + 1) + '-01-01' : yr + '-' + String(now.getMonth() + 2).padStart(2, '0') + '-01'; return [yr + '-' + m + '-01', nm]; }
    const q = Math.floor(now.getMonth() / 3); const sm = q * 3; const start = yr + '-' + String(sm + 1).padStart(2, '0') + '-01';
    const end = sm + 3 >= 12 ? (yr + 1) + '-01-01' : yr + '-' + String(sm + 4).padStart(2, '0') + '-01'; return [start, end];
  };
  const [rStart, rEnd] = rangeBounds();
  const inRange = (d) => { if (!d) return false; const s = String(d).slice(0, 10); if (rStart && s < rStart) return false; if (rEnd && s >= rEnd) return false; return true; };
  const rangeLabel = range === 'custom' ? (cFrom + ' to ' + cTo) : { month: 'This month', quarter: 'This quarter', year: 'This year', all: 'All time' }[range];

  // ---- locked profitability helpers ----
  const invEvent = {}; invoices.forEach((i) => { invEvent[i.invoice_id] = i.event_id; });
  const netCollectedByEvent = {}; pays.forEach((p) => { const eid = invEvent[p.invoice_id]; if (eid) netCollectedByEvent[eid] = (netCollectedByEvent[eid] || 0) + (parseFloat(p.amount) || 0); });
  const eventStatusMap = {}; events.forEach((e) => { eventStatusMap[e.event_id] = (e.status || '').toLowerCase(); });
  const eventFee = (id) => invoices.filter((i) => i.event_id === id && i.status !== 'cancelled').reduce((s, i) => s + (parseFloat(i.grand_total) || 0), 0);
  const eventRevenue = (id) => eventStatusMap[id] === 'cancelled' ? Math.max(0, netCollectedByEvent[id] || 0) : eventFee(id);
  const eventExp = (id) => expenses.filter((x) => x.event_id === id).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  const eventVend = (id) => vpays.filter((x) => x.event_id === id && !x.is_voided).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);

  const rangeEvents = events.filter((e) => range === 'all' ? true : inRange(e.main_date));
  const perEvent = rangeEvents.map((e) => { const fee = eventRevenue(e.event_id), ex = eventExp(e.event_id), vn = eventVend(e.event_id); const pr = fee - ex - vn; return { ...e, fee, ex, vn, profit: pr, margin: fee > 0 ? pr / fee * 100 : 0 }; })
    .sort((a, b) => (b.main_date || '').localeCompare(a.main_date || ''));
  const genExpRange = expenses.filter((x) => !x.event_id && inRange(x.date)).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  const sumEventProfit = perEvent.reduce((s, e) => s + e.profit, 0);
  const periodProfit = sumEventProfit - genExpRange;

  // KPIs (cash view, range-filtered)
  const billed = invoices.filter((i) => i.status !== 'cancelled' && (range === 'all' || inRange(i.doc_date))).reduce((s, i) => s + (parseFloat(i.grand_total) || 0), 0);
  const collected = pays.filter((p) => range === 'all' || inRange(p.payment_date)).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const outstanding = invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + (parseFloat(i.total_outstanding != null ? i.total_outstanding : ((parseFloat(i.grand_total) || 0) - (parseFloat(i.total_received) || 0))) || 0), 0);
  const totExp = expenses.filter((x) => range === 'all' || inRange(x.date)).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  const totVend = vpays.filter((x) => !x.is_voided && (range === 'all' || inRange(x.payment_date))).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  const voidedVend = vpays.filter((x) => x.is_voided && (range === 'all' || inRange(x.payment_date))).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);

  // last 12 months series
  const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(yr, now.getMonth() - i, 1); months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: d.toLocaleString('en-US', { month: 'short' }) }); }
  const mSum = (arr, dateKey) => months.map((m) => arr.filter((r) => String(r[dateKey] || '').slice(0, 7) === m.key).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0));
  const collSeries = mSum(pays, 'payment_date');
  const billSeries = months.map((m) => invoices.filter((i) => i.status !== 'cancelled' && String(i.doc_date || '').slice(0, 7) === m.key).reduce((s, i) => s + (parseFloat(i.grand_total) || 0), 0));
  const expSeries = months.map((m) => { const e = expenses.filter((x) => String(x.date || '').slice(0, 7) === m.key).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0); const v = vpays.filter((x) => !x.is_voided && String(x.payment_date || '').slice(0, 7) === m.key).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0); return e + v; });

  // pipeline by stage (active leads, collapsed display stage)
  const pipeStages = [['new', 'New'], ['contacted', 'Contacted'], ['Quoting', 'Quoting']];
  const activeLeads = leads.filter((l) => !['lost', 'event_triggered', 'completed'].includes(l.stage));
  const pipe = pipeStages.map(([k, lab]) => { const ls = activeLeads.filter((l) => k === 'Quoting' ? leadStageDisplay(l.stage) === 'Quoting' : l.stage === k); return { label: lab, count: ls.length, value: ls.reduce((s, l) => s + (parseFloat(l.budget) || 0), 0) }; });
  const pipeTotal = pipe.reduce((s, p) => s + p.value, 0);

  const upcoming = events.filter((e) => e.main_date && e.main_date >= today && !['cancelled', 'completed'].includes((e.status || '').toLowerCase())).sort((a, b) => (a.main_date || '').localeCompare(b.main_date || '')).slice(0, 8);

  // chart primitives
  const BarChart = ({ series, labels, color, height = 120 }) => { const max = Math.max(1, ...series); return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, height, padding: '0 2px' }}>
      {series.map((v, i) => <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={labels[i] + ': ' + inr(v)}>
        <div style={{ fontSize: 9, color: 'var(--grey-400)', marginBottom: 2, whiteSpace: 'nowrap' }}>{v > 0 ? inrK(v) : ''}</div>
        <div style={{ width: '70%', background: color, borderRadius: '3px 3px 0 0', height: Math.max(v > 0 ? 2 : 0, v / max * (height - 22)) + 'px', transition: 'height .3s' }} />
        <div style={{ fontSize: 9, color: 'var(--grey-400)', marginTop: 3 }}>{labels[i]}</div>
      </div>)}
    </div>
  ); };
  const GroupBars = ({ a, b, labels, ca, cb, height = 140 }) => { const max = Math.max(1, ...a, ...b); return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, height, padding: '0 2px' }}>
      {labels.map((lab, i) => <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={lab + ' — income ' + inr(a[i]) + ' / cost ' + inr(b[i])}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: height - 16, width: '100%', justifyContent: 'center' }}>
          <div style={{ width: '34%', background: ca, borderRadius: '2px 2px 0 0', height: Math.max(a[i] > 0 ? 2 : 0, a[i] / max * (height - 18)) + 'px' }} />
          <div style={{ width: '34%', background: cb, borderRadius: '2px 2px 0 0', height: Math.max(b[i] > 0 ? 2 : 0, b[i] / max * (height - 18)) + 'px' }} />
        </div>
        <div style={{ fontSize: 9, color: 'var(--grey-400)', marginTop: 3 }}>{lab}</div>
      </div>)}
    </div>
  ); };
  const card = { background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', padding: '16px 18px' };
  const cardTitle = { fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 12 };

  // ---- exports ----
  const [exporting, setExporting] = React.useState(false);
  const evRefMap = {}; events.forEach((e) => { evRefMap[e.event_id] = (e.ref_number || '') + (e.name ? (' · ' + e.name) : ''); });
  const rangeExpenses = expenses.filter((x) => range === 'all' || inRange(x.date));
  const rangeVpays = vpays.filter((x) => !x.is_voided && (range === 'all' || inRange(x.payment_date)));
  const stamp = todayLocalStr();
  const safeRange = ({ month: 'Month', quarter: 'Quarter', year: 'Year', all: 'AllTime', custom: 'Custom' }[range]);

  const doExportExcel = async () => {
    setExporting(true);
    try {
      const { data: s } = await supabase.from('settings').select('company_name').maybeSingle();
      const co = (s && s.company_name) || 'Isheeka Events';
      const sumRows = [
        ['Billed (fee)', Math.round(billed)], ['Collected', Math.round(collected)], ['Outstanding (current, all open)', Math.round(outstanding)],
        ['Expenses', Math.round(totExp)], ['Vendor payments', Math.round(totVend)], ['Event profit (sum)', Math.round(sumEventProfit)],
        ['General/overhead expenses', Math.round(genExpRange)], ['Net profit (period)', Math.round(periodProfit)],
      ];
      const pnlRows = perEvent.map((e) => [e.ref_number || '', e.name || '', e.main_date || '', e.client_name || '', Math.round(e.fee), Math.round(e.ex), Math.round(e.vn), Math.round(e.profit), e.fee > 0 ? Math.round(e.margin) : '']);
      const expRows = rangeExpenses.slice().sort((a, b) => String(b.date || '').localeCompare(a.date || '')).map((x) => [x.date || '', x.category || '', x.event_id ? (evRefMap[x.event_id] || x.event_id) : 'General', Math.round(parseFloat(x.amount) || 0)]);
      const vpRows = rangeVpays.slice().sort((a, b) => String(b.payment_date || '').localeCompare(a.payment_date || '')).map((x) => [x.payment_date || '', x.event_id ? (evRefMap[x.event_id] || x.event_id) : '—', Math.round(parseFloat(x.amount) || 0)]);
      await downloadBrandedWorkbook('Isheeka_Report_' + safeRange + '_' + stamp + '.xlsx', co, [
        { name: 'Summary', title: 'Performance report', subtitle: rangeLabel + ' · generated ' + stamp, columns: [{ label: 'KPI', width: 32 }, { label: 'Amount', width: 18, align: 'right', fmt: 'money' }], rows: sumRows },
        { name: 'Per-Event P&L', title: 'Per-event P&L', subtitle: rangeLabel, columns: [{ label: 'Ref', width: 12 }, { label: 'Event', width: 22 }, { label: 'Date', width: 12 }, { label: 'Client', width: 18 }, { label: 'Fee', width: 13, align: 'right', fmt: 'money' }, { label: 'Expenses', width: 13, align: 'right', fmt: 'money' }, { label: 'Vendors', width: 13, align: 'right', fmt: 'money' }, { label: 'Profit', width: 13, align: 'right', fmt: 'money' }, { label: 'Margin %', width: 10, align: 'right' }], rows: pnlRows, totals: ['', 'TOTAL (' + perEvent.length + ')', '', '', Math.round(perEvent.reduce((a, e) => a + e.fee, 0)), Math.round(perEvent.reduce((a, e) => a + e.ex, 0)), Math.round(perEvent.reduce((a, e) => a + e.vn, 0)), Math.round(sumEventProfit), ''] },
        { name: 'Expenses', title: 'Expenses', subtitle: rangeLabel, columns: [{ label: 'Date', width: 12 }, { label: 'Category', width: 18 }, { label: 'Event', width: 26 }, { label: 'Amount', width: 14, align: 'right', fmt: 'money' }], rows: expRows },
        { name: 'Vendor Payments', title: 'Vendor payments', subtitle: rangeLabel, columns: [{ label: 'Date', width: 12 }, { label: 'Event', width: 26 }, { label: 'Amount', width: 14, align: 'right', fmt: 'money' }], rows: vpRows },
      ]);
      notify('Excel report downloaded.', 'success');
    } catch (err) { console.error('[Isheeka ERP] excel export failed:', err); notify('Could not export Excel: ' + (err && err.message ? err.message : 'try again'), 'error'); }
    setExporting(false);
  };

  const doExportPDF = async () => {
    const jsPDFctor = jsPDF;
    if (!jsPDFctor) { notify('PDF library not loaded. Please refresh.', 'error'); return; }
    setExporting(true);
    try {
      const { data: s } = await supabase.from('settings').select('company_name,phone_1,email,website').single();
      const co = (s && s.company_name) || 'Isheeka Events';
      const doc = new jsPDFctor({ unit: 'pt', format: 'a4' });
      const PINK = [232, 24, 90], INK = [40, 40, 40], MUTED = [140, 140, 140];
      const W = doc.internal.pageSize.getWidth(), M = 42; let y = 0;
      doc.setFillColor(PINK[0], PINK[1], PINK[2]); doc.rect(0, 0, W, 70, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(co, M, 38);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text('Performance Report', M, 56);
      doc.setFontSize(10); doc.text(rangeLabel + '   ·   generated ' + stamp, W - M, 56, { align: 'right' });
      y = 98;
      doc.setTextColor(INK[0], INK[1], INK[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Summary', M, y); y += 8;
      const kpis = [['Billed (fee)', billed], ['Collected', collected], ['Outstanding', outstanding], ['Expenses', totExp], ['Vendor payments', totVend], ['Net profit (period)', periodProfit]];
      const colW = (W - 2 * M) / 3; const ky = y + 18;
      kpis.forEach((k, i) => { const cx = M + (i % 3) * colW, cy = ky + Math.floor(i / 3) * 46;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]); doc.text(k[0], cx, cy);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(INK[0], INK[1], INK[2]); doc.text('₹' + Math.round(k[1] || 0).toLocaleString('en-IN'), cx, cy + 16);
      });
      y = ky + 2 * 46 + 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text('Net profit = event fees − event expenses − vendor payments (events by event date) − general overhead (₹' + Math.round(genExpRange).toLocaleString('en-IN') + '). Outstanding is current across all open invoices.', M, y, { maxWidth: W - 2 * M }); y += 18;
      const body = perEvent.map((e) => [e.ref_number || '', e.name || '', e.main_date || '', '₹' + Math.round(e.fee).toLocaleString('en-IN'), '₹' + Math.round(e.ex).toLocaleString('en-IN'), '₹' + Math.round(e.vn).toLocaleString('en-IN'), '₹' + Math.round(e.profit).toLocaleString('en-IN'), e.fee > 0 ? Math.round(e.margin) + '%' : '—']);
      body.push(['', 'TOTAL (' + perEvent.length + ')', '', '₹' + Math.round(perEvent.reduce((a, e) => a + e.fee, 0)).toLocaleString('en-IN'), '₹' + Math.round(perEvent.reduce((a, e) => a + e.ex, 0)).toLocaleString('en-IN'), '₹' + Math.round(perEvent.reduce((a, e) => a + e.vn, 0)).toLocaleString('en-IN'), '₹' + Math.round(sumEventProfit).toLocaleString('en-IN'), '']);
      doc.autoTable({
        startY: y, head: [['Ref', 'Event', 'Date', 'Fee', 'Expenses', 'Vendors', 'Profit', 'Margin']], body,
        styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: PINK, textColor: 255, fontStyle: 'bold' },
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
        theme: 'grid', tableLineColor: PINK, tableLineWidth: 0.4, margin: { left: M, right: M },
        didParseCell: (d) => { if (d.row.index === body.length - 1) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [251, 234, 240]; } },
      });
      doc.save('Isheeka_Report_' + safeRange + '_' + stamp + '.pdf');
      notify('PDF report downloaded.', 'success');
    } catch (err) { console.error('[Isheeka ERP] pdf export failed:', err); notify('Could not export PDF: ' + (err && err.message ? err.message : 'try again'), 'error'); }
    setExporting(false);
  };

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  return (
    <div>
      {popupEvent && <EventQuickView eventId={popupEvent} onClose={() => setPopupEvent(null)} onNavigate={onNavigate} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>Reports</div>
        {tab === 'overview' && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {range === 'custom' && <><input type="date" className="field-input" style={{ width: 140, fontSize: 12 }} value={cFrom} onChange={(e) => setCFrom(e.target.value)} /><span style={{ color: 'var(--grey-400)' }}>→</span><input type="date" className="field-input" style={{ width: 140, fontSize: 12 }} value={cTo} onChange={(e) => setCTo(e.target.value)} /></>}
          <div style={{ display: 'flex', gap: 4, background: 'var(--grey-100)', padding: 3, borderRadius: 'var(--radius-md)' }}>
            {[['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['all', 'All'], ['custom', 'Custom']].map(([k, l]) => <button key={k} onClick={() => setRange(k)} style={{ border: 'none', cursor: 'pointer', fontSize: 12, padding: '5px 12px', borderRadius: 'var(--radius-sm)', background: range === k ? 'white' : 'transparent', color: range === k ? 'var(--pink)' : 'var(--grey-400)', fontWeight: range === k ? 600 : 400, boxShadow: range === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}>{l}</button>)}
          </div>
          <button className="btn sm" disabled={exporting} onClick={doExportExcel} title="Export to Excel">{exporting ? '…' : '⬇ Excel'}</button>
          <button className="btn sm" disabled={exporting} onClick={doExportPDF} title="Export to PDF">{exporting ? '…' : '⬇ PDF'}</button>
        </div>}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--grey-100)', flexWrap: 'wrap' }}>
        {[['overview', 'Overview'], ['receivables', 'Receivables'], ['payables', 'Payables'], ['settlement', 'Owner settlement']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: '8px 12px', color: tab === k ? 'var(--pink)' : 'var(--grey-500)', fontWeight: tab === k ? 600 : 400, borderBottom: tab === k ? '2px solid var(--pink)' : '2px solid transparent', marginBottom: -1 }}>{l}</button>
        ))}
      </div>
      {tab === 'receivables' ? <ReceivablesReport /> : tab === 'payables' ? <PayablesReport /> : tab === 'settlement' ? <OwnerSettlementReport /> : (<>
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        {[['Billed (fee)', billed, 'var(--blue)', '📄'], ['Collected', collected, 'var(--green)', '💰'], ['Outstanding', outstanding, 'var(--red)', '⏳'], ['Expenses + vendors', totExp + totVend, 'var(--orange)', '🧾'], ['Net profit', periodProfit, periodProfit >= 0 ? 'var(--green)' : 'var(--red)', '📈']].map(([l, v, c, ic]) => (
          <div key={l} style={{ ...card, padding: '14px 16px' }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{ic}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c }}>{inr(v)}</div>
            <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--grey-400)', marginBottom: 16, marginTop: -6 }}>{rangeLabel} · Net profit = event fees − event expenses − vendor payments (events by event date) − general overhead. Outstanding is current across all open invoices. Margin {billed > 0 ? (Math.round(periodProfit / (perEvent.reduce((s, e) => s + e.fee, 0) || 1) * 100) + '%') : '—'} on event fees.{voidedVend > 0 ? (' ₹' + Math.round(voidedVend).toLocaleString('en-IN') + ' in voided vendor payments excluded.') : ''}</div>

      {/* charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={card}>
          <div style={cardTitle}>Revenue collected — last 12 months</div>
          <BarChart series={collSeries} labels={months.map((m) => m.label)} color="var(--green)" />
        </div>
        <div style={card}>
          <div style={cardTitle}>Income vs cost — last 12 months <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--grey-400)' }}>(<span style={{ color: 'var(--blue)' }}>■</span> billed &nbsp;<span style={{ color: 'var(--orange)' }}>■</span> expenses+vendors)</span></div>
          <GroupBars a={billSeries} b={expSeries} labels={months.map((m) => m.label)} ca="var(--blue)" cb="var(--orange)" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* pipeline */}
        <div style={card}>
          <div style={cardTitle}>Pipeline by stage <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--grey-400)' }}>· {inr(pipeTotal)} potential</span></div>
          {pipe.every((p) => p.count === 0) ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No active leads.</div> :
            pipe.map((p) => { const max = Math.max(1, ...pipe.map((x) => x.value)); return (
              <div key={p.label} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}><span>{p.label} <span style={{ color: 'var(--grey-400)' }}>({p.count})</span></span><span style={{ color: 'var(--grey-400)' }}>{inr(p.value)}</span></div>
                <div style={{ height: 8, background: 'var(--grey-100)', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: Math.max(p.value > 0 ? 4 : 0, p.value / max * 100) + '%', background: 'var(--pink)', borderRadius: 4 }} /></div>
              </div>
            ); })}
        </div>
        {/* upcoming events */}
        <div style={card}>
          <div style={cardTitle}>Upcoming events</div>
          {upcoming.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No upcoming events.</div> :
            upcoming.map((e) => <div key={e.event_id} onClick={() => setPopupEvent(e.event_id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--grey-100)', cursor: 'pointer', fontSize: 13 }}>
              <div><span style={{ color: 'var(--pink)', fontWeight: 500 }}>{e.ref_number}</span> · {e.name}{e.client_name ? (' · ' + e.client_name) : ''}</div>
              <div style={{ color: 'var(--grey-400)', whiteSpace: 'nowrap', marginLeft: 8 }}>{fmtDate(e.main_date, { day: 'numeric', month: 'short' })}</div>
            </div>)}
        </div>
      </div>

      {/* profitability table */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>Profitability by event <span style={{ fontWeight: 400, color: 'var(--grey-400)' }}>· {rangeLabel}</span></div>
          <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>Period net (incl. ₹{Math.round(genExpRange).toLocaleString('en-IN')} overhead): <b style={{ color: periodProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{inr(periodProfit)}</b></div>
        </div>
        {perEvent.length === 0 ? <div style={{ padding: '0 18px 16px', fontSize: 13, color: 'var(--grey-400)' }}>No events in this period.</div> : <>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 90px 90px 90px 70px', gap: 6, padding: '8px 18px', background: 'var(--grey-50)', fontSize: 10, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            <div>Event</div><div style={{ textAlign: 'right' }}>Fee</div><div style={{ textAlign: 'right' }}>Expenses</div><div style={{ textAlign: 'right' }}>Vendors</div><div style={{ textAlign: 'right' }}>Profit</div><div style={{ textAlign: 'right' }}>Margin</div>
          </div>
          {perEvent.map((e) => <div key={e.event_id} onClick={() => setPopupEvent(e.event_id)} style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 90px 90px 90px 70px', gap: 6, padding: '10px 18px', borderTop: '1px solid var(--grey-100)', fontSize: 12.5, cursor: 'pointer' }}>
            <div><span style={{ color: 'var(--pink)', fontWeight: 500 }}>{e.ref_number}</span> · {e.name}{(e.status || '').toLowerCase() === 'cancelled' && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'var(--red-light)', color: 'var(--red)' }}>CANCELLED</span>}<div style={{ fontSize: 11, color: 'var(--grey-400)' }}>{e.main_date ? fmtDate(e.main_date, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}{e.client_name ? (' · ' + e.client_name) : ''}</div></div>
            <div style={{ textAlign: 'right' }}>{inr(e.fee)}</div>
            <div style={{ textAlign: 'right' }}>{inr(e.ex)}</div>
            <div style={{ textAlign: 'right' }}>{inr(e.vn)}</div>
            <div style={{ textAlign: 'right', fontWeight: 600, color: e.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{inr(e.profit)}</div>
            <div style={{ textAlign: 'right', color: 'var(--grey-400)' }}>{e.fee > 0 ? Math.round(e.margin) + '%' : '—'}</div>
          </div>)}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 90px 90px 90px 70px', gap: 6, padding: '10px 18px', borderTop: '2px solid var(--grey-200)', fontSize: 12.5, fontWeight: 600, background: 'var(--grey-50)' }}>
            <div>Total ({perEvent.length} events)</div>
            <div style={{ textAlign: 'right' }}>{inr(perEvent.reduce((s, e) => s + e.fee, 0))}</div>
            <div style={{ textAlign: 'right' }}>{inr(perEvent.reduce((s, e) => s + e.ex, 0))}</div>
            <div style={{ textAlign: 'right' }}>{inr(perEvent.reduce((s, e) => s + e.vn, 0))}</div>
            <div style={{ textAlign: 'right', color: sumEventProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{inr(sumEventProfit)}</div>
            <div style={{ textAlign: 'right' }}></div>
          </div>
        </>}
      </div>
      </>)}
    </div>
  );
}
