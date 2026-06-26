// Internal costing sheet — PDF + Excel. Shows vendor bids, in-house, chosen cost,
// markup % and ₹, and per-line / overall totals, grouped by function (date · venue).
// INTERNAL ONLY: it contains vendor costs and our margins — never share with clients.
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { downloadBrandedWorkbook } from './brandedXlsx.js';
import { LOGO } from '../pdf/assets.js';
import { fmtDate } from './format.js';

const inr0 = (n) => (n == null ? '' : 'Rs.' + Math.round(Number(n) || 0).toLocaleString('en-IN'));
const fd = (d) => (d ? fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// payload = { rfq, columns:[{vendor_id,name}], schedule:[{name,planned_date,venue}],
//             rows:[{sub_event_name,description,quantity,bids:[num|null],inhouse,chosen,
//                    markupPct,markupRs,clientUnit,lineTotal,chosenVendor}],
//             totals:{cost,client,margin}, settings }
function clientLine(rfq) {
  const nm = [rfq && rfq.contact_first_name, rfq && rfq.contact_last_name].filter(Boolean).join(' ').trim() || (rfq && rfq.contact_name) || '—';
  const ph = (rfq && rfq.contact_phone) ? (' · ' + rfq.contact_phone) : '';
  return nm + ph;
}
function groupByFunction(rows, schedule) {
  const sched = {}; (schedule || []).forEach((s) => { sched[String(s.name || '').toLowerCase().trim()] = s; });
  const order = []; const groups = {};
  (rows || []).forEach((r) => {
    const k = r.sub_event_name || 'General';
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(r);
  });
  return order.map((k) => {
    const s = sched[k.toLowerCase().trim()] || {};
    return { name: k, date: s.planned_date || null, venue: s.venue || '', rows: groups[k] };
  });
}

export function buildCostingPdf(payload, opts = {}) {
  const { rfq, columns = [], schedule = [], rows = [], totals = {} } = payload;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const PINK = [232, 24, 90], ROSE = [160, 16, 68], GOLD = [184, 137, 58], PSOFT = [252, 234, 241], INK = [42, 39, 35], MUTED = [107, 102, 96], LINE = [229, 221, 210], REDBG = [252, 235, 235], RED = [163, 45, 45];
  const W = doc.internal.pageSize.getWidth(), M = 32;
  let y = 36;
  try { doc.addImage(LOGO, 'PNG', M, y - 6, 30, 38); } catch (e) { /* logo optional */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...PINK); doc.text('Isheeka Events', M + 38, y + 12);
  doc.setFontSize(10); doc.setTextColor(...ROSE); doc.text('INTERNAL COSTING SHEET', W - M, y + 4, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK); doc.text(String(rfq && rfq.ref_number || ''), W - M, y + 20, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text('Client: ' + clientLine(rfq), M + 38, y + 26);
  doc.text('Generated ' + fd(new Date().toISOString().slice(0, 10)), W - M, y + 31, { align: 'right' });
  y += 44;
  // internal banner
  doc.setFillColor(...REDBG); doc.roundedRect(M, y, W - 2 * M, 18, 3, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...RED);
  doc.text('INTERNAL — NOT FOR CLIENT DISTRIBUTION  ·  contains vendor costs & our margins', W / 2, y + 12, { align: 'center' });
  y += 28;

  const head = ['Item', 'Qty', ...columns.map((c) => c.name), 'In-house', 'Chosen', 'MU %', 'MU Rs.', 'Client/u', 'Line Rs.'];
  const groups = groupByFunction(rows, schedule);
  const body = []; const grpRows = [];
  groups.forEach((g) => {
    grpRows.push(body.length);
    body.push([{ content: g.name + '  ·  ' + fd(g.date) + (g.venue ? ('  ·  ' + g.venue) : ''), colSpan: head.length }]);
    g.rows.forEach((r) => {
      body.push([
        String(r.description || ''), String(r.quantity || ''),
        ...r.bids.map((b) => (b == null ? '—' : Math.round(b).toLocaleString('en-IN'))),
        r.inhouse == null ? '—' : Math.round(r.inhouse).toLocaleString('en-IN'),
        r.chosen == null ? '—' : Math.round(r.chosen).toLocaleString('en-IN'),
        String(r.markupPct || 0), r.markupRs == null ? '—' : Math.round(r.markupRs).toLocaleString('en-IN'),
        r.clientUnit == null ? '—' : Math.round(r.clientUnit).toLocaleString('en-IN'),
        r.lineTotal == null ? '—' : Math.round(r.lineTotal).toLocaleString('en-IN'),
      ]);
    });
  });
  doc.autoTable({
    head: [head], body, startY: y, margin: { left: M, right: M },
    theme: 'grid', styles: { fontSize: 7.5, cellPadding: 3, lineColor: LINE, lineWidth: 0.3, textColor: INK, halign: 'right' },
    headStyles: { fillColor: PINK, textColor: [255, 255, 255], fontSize: 7.5, halign: 'right' },
    columnStyles: { 0: { halign: 'left', cellWidth: 150 } },
    didParseCell: (dd) => { if (dd.section === 'body' && grpRows.includes(dd.row.index)) { dd.cell.styles.fillColor = PSOFT; dd.cell.styles.textColor = ROSE; dd.cell.styles.fontStyle = 'bold'; dd.cell.styles.halign = 'left'; dd.cell.styles.fontSize = 7.5; } if (dd.column.index === 0 && dd.section === 'head') dd.cell.styles.halign = 'left'; },
  });
  let ey = doc.lastAutoTable.finalY + 14;
  doc.setDrawColor(...PINK); doc.setLineWidth(1); doc.line(W - M - 360, ey - 8, W - M, ey - 8);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.setTextColor(...MUTED); doc.text('Total cost ' + inr0(totals.cost), W - M - 360, ey, { align: 'left' });
  doc.setTextColor(...[29, 158, 117]); doc.text('Margin ' + inr0(totals.margin) + (totals.cost > 0 ? (' (' + Math.round(totals.margin / totals.cost * 100) + '%)') : ''), W - M - 200, ey, { align: 'left' });
  doc.setTextColor(...ROSE); doc.text('Client ' + inr0(totals.client), W - M, ey, { align: 'right' });

  const fname = 'Isheeka_Costing_' + (rfq && rfq.ref_number || 'sheet') + '.pdf';
  if (opts.output === 'blob') return doc.output('blob');
  if (opts.action === 'print') { doc.autoPrint(); doc.output('dataurlnewwindow'); return null; }
  doc.save(fname); return null;
}

export async function buildCostingXlsx(payload) {
  const { rfq, columns = [], schedule = [], rows = [], totals = {} } = payload;
  const sched = {}; (schedule || []).forEach((s) => { sched[String(s.name || '').toLowerCase().trim()] = s; });
  const cols = [
    { label: 'Function', width: 18 }, { label: 'Date', width: 13 }, { label: 'Venue', width: 20 },
    { label: 'Item', width: 30 }, { label: 'Qty', width: 7, align: 'right' },
    ...columns.map((c) => ({ label: c.name, width: 12, align: 'right', fmt: 'money' })),
    { label: 'In-house', width: 11, align: 'right', fmt: 'money' }, { label: 'Chosen', width: 11, align: 'right', fmt: 'money' },
    { label: 'MU %', width: 7, align: 'right' }, { label: 'MU Rs.', width: 12, align: 'right', fmt: 'money' },
    { label: 'Client/u', width: 12, align: 'right', fmt: 'money' }, { label: 'Line Rs.', width: 13, align: 'right', fmt: 'money' },
  ];
  const dataRows = (rows || []).map((r) => {
    const s = sched[String(r.sub_event_name || '').toLowerCase().trim()] || {};
    return [
      r.sub_event_name || 'General', s.planned_date ? fd(s.planned_date) : '', s.venue || '',
      r.description || '', Number(r.quantity) || 0,
      ...r.bids.map((b) => (b == null ? '' : Math.round(b))),
      r.inhouse == null ? '' : Math.round(r.inhouse), r.chosen == null ? '' : Math.round(r.chosen),
      Number(r.markupPct) || 0, r.markupRs == null ? '' : Math.round(r.markupRs),
      r.clientUnit == null ? '' : Math.round(r.clientUnit), r.lineTotal == null ? '' : Math.round(r.lineTotal),
    ];
  });
  const totalsRow = ['TOTALS', '', '', '', '', ...columns.map(() => ''), '', Math.round(totals.cost || 0), '', Math.round(totals.margin || 0), '', Math.round(totals.client || 0)];
  await downloadBrandedWorkbook('Isheeka_Costing_' + (rfq && rfq.ref_number || 'sheet') + '.xlsx', 'Isheeka Events', [{
    name: 'Internal Costing',
    title: 'Internal costing — ' + (rfq && rfq.ref_number || ''),
    subtitle: 'INTERNAL — NOT FOR CLIENT · Client: ' + clientLine(rfq),
    columns: cols, rows: dataRows, totals: totalsRow,
    notes: ['Contains vendor costs and our margins — do not share with clients.'],
  }]);
}
