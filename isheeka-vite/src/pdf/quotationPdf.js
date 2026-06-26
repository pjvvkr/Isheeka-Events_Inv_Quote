// Quotation / invoice PDF engine (ported verbatim from isheeka-erp-v22.html).
// Only change vs. the single-file app: jsPDF + autotable come from npm imports
// instead of the `window.jspdf` UMD global.
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { notify } from '../lib/toast.jsx';
import { fmtDate } from '../lib/format.js';
import { LOGO, GV_FONT } from './assets.js';

// Cormorant Garamond (bold-italic) for the PDF cover — fetched once from CDN, base64
// cached for jsPDF. Falls back to Times-italic below if it hasn't loaded (e.g. offline).
let _CG_B64 = null;
(function () { try { fetch('https://cdn.jsdelivr.net/gh/google/fonts/ofl/cormorantgaramond/CormorantGaramond-BoldItalic.ttf').then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => { if (!buf) return; const bytes = new Uint8Array(buf); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); _CG_B64 = btoa(bin); }).catch(() => {}); } catch (e) { /* offline → Times fallback */ } })();

export function buildQuotationPDF(quot, lineItems, opts = {}) {
  const jsPDFctor = jsPDF;
  if (!jsPDFctor) { notify('PDF library not loaded. Please refresh.', 'error'); return false; }
  const doc = new jsPDFctor({ unit: 'pt', format: 'a4' });
  const dOpts = Object.assign({ prices: false, qty: true, grouping: true, schedule: true, discount: false, coverPage: false, bankDetails: false }, opts.displayOpts || {});
  const settings = opts.settings || {};
  const isInv = opts.docType === 'invoice';
  const PINK = [232, 24, 90], ROSE_DK = [160, 16, 68], GOLD = [184, 137, 58], PSOFT = [252, 234, 241], INK = [42, 39, 35], MUTED = [107, 102, 96], LINE = [229, 221, 210];
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 42;
  const LAR = 0.781; // logo width/height
  let SCRIPT_OK = false;
  try { doc.addFileToVFS('GreatVibes.ttf', GV_FONT); doc.addFont('GreatVibes.ttf', 'GreatVibes', 'normal'); SCRIPT_OK = true; } catch (e) { SCRIPT_OK = false; }
  let CG_OK = false;
  try { if (_CG_B64) { doc.addFileToVFS('Cormorant.ttf', _CG_B64); doc.addFont('Cormorant.ttf', 'Cormorant', 'italic'); CG_OK = true; } } catch (e) { CG_OK = false; }
  const fmt = (d) => (d ? fmtDate(d) : '--');
  const money = (n) => 'Rs.' + parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sans = (style, sz) => { doc.setFont('helvetica', style); doc.setFontSize(sz); };
  const script = (sz) => { doc.setFont(SCRIPT_OK ? 'GreatVibes' : 'times', SCRIPT_OK ? 'normal' : 'italic'); doc.setFontSize(sz); };
  const cormorant = (sz) => { doc.setFont(CG_OK ? 'Cormorant' : 'times', 'italic'); doc.setFontSize(sz); };
  const setFill = (c) => doc.setFillColor(c[0], c[1], c[2]);
  const setText = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const setDraw = (c) => doc.setDrawColor(c[0], c[1], c[2]);
  const label = isInv ? 'INVOICE' : 'QUOTATION';

  const drawFrame = () => { doc.saveGraphicsState(); setDraw(PINK); doc.setLineWidth(2); doc.rect(12, 12, W - 24, H - 24, 'S'); doc.restoreGraphicsState(); };

  const HDR_BOTTOM = 108;
  const _evDate = quot.event_date || quot.main_date || quot.tentative_date || null;
  const drawHeaderBand = () => {
    const top = 28; const lh = 46, lw = lh * LAR;
    try { doc.addImage(LOGO, 'PNG', M, top, lw, lh); } catch (e) { /* logo optional */ }
    const tx = M + lw + 12;
    script(26); setText(PINK); doc.text('Isheeka Events', tx, top + 20);
    sans('italic', 8.5); setText(GOLD); doc.text('Making Every Event Memorable', tx, top + 33);
    script(11); setText(GOLD); doc.text('Since 2017', tx, top + 45);
    // right doc box
    sans('bold', 11); setText(ROSE_DK); doc.text(label, W - M, top + 12, { align: 'right' });
    sans('bold', 15); setText(INK); doc.text(String(quot.ref_number || ''), W - M, top + 28, { align: 'right' });
    sans('normal', 8); setText(MUTED);
    doc.text('Date: ' + fmt(quot.doc_date), W - M, top + 40, { align: 'right' });
    { if (isInv && quot.due_date) doc.text('Due date: ' + fmt(quot.due_date), W - M, top + 51, { align: 'right' }); }
    { if (_evDate) { const evY = (isInv && quot.due_date) ? (top + 62) : (top + 51); setText(PINK); doc.text('Event date: ' + fmt(_evDate), W - M, evY, { align: 'right' }); setText(MUTED); } }
    // two-tone hairline: rose for the first ~70%, champagne gold for the remainder
    const _hx = M + (W - 2 * M) * 0.7; setDraw(PINK); doc.setLineWidth(1.4); doc.line(M, HDR_BOTTOM - 12, _hx, HDR_BOTTOM - 12); setDraw(GOLD); doc.line(_hx, HDR_BOTTOM - 12, W - M, HDR_BOTTOM - 12);
  };

  const drawFooter = (pageNo, pageCount) => {
    const fy = H - 34;
    setDraw(GOLD); doc.setLineWidth(0.5); doc.line(M, fy, W - M, fy);
    sans('normal', 8); setText(MUTED);
    const phone = (settings.phone_1) || '+91 78423 95867', email = (settings.email) || 'isheekaevents@gmail.com', web = (settings.website) || 'www.isheekaevents.com';
    doc.text(phone + '   ' + email, M, fy + 12);
    doc.text(web + '   ·   Page ' + pageNo + ' of ' + pageCount, W - M, fy + 12, { align: 'right' });
  };

  // ---- COVER PAGE (optional) ----
  if (dOpts.coverPage) {
    drawFrame();
    const clh = 104, clw = clh * LAR; try { doc.addImage(LOGO, 'PNG', (W - clw) / 2, 66, clw, clh); } catch (e) { /* logo optional */ }
    let y = 206;
    script(46); setText(PINK); doc.text('Isheeka Events', W / 2, y, { align: 'center' }); y += 22;
    cormorant(14); setText(ROSE_DK); doc.text('Making Every Event Memorable', W / 2, y, { align: 'center' }); y += 27;
    script(15); setText(GOLD); doc.text('Since 2017', W / 2, y, { align: 'center' }); y += 28;
    setDraw(GOLD); doc.setLineWidth(1.4); doc.line(W / 2 - 45, y, W / 2 + 45, y); y += 36;
    sans('bold', 11); setText(ROSE_DK);
    const pillTxt = label + '  ·  ' + (quot.ref_number || ''); const pw = doc.getTextWidth(pillTxt) + 36;
    setDraw(PINK); doc.setLineWidth(1.2); doc.roundedRect((W - pw) / 2, y, pw, 24, 12, 12, 'S');
    doc.text(pillTxt, W / 2, y + 16, { align: 'center' }); y += 58;
    sans('bold', 9); setText(GOLD); doc.text('PREPARED FOR', W / 2, y, { align: 'center' }); y += 25;
    sans('bold', 16); setText(ROSE_DK); doc.text(String(quot.event_name || ''), W / 2, y, { align: 'center' }); y += 16;
    cormorant(13); setText(GOLD);
    doc.text(_evDate ? fmt(_evDate) : fmt(quot.doc_date), W / 2, y, { align: 'center' }); y += 36;
    const introTpl = settings.cover_intro || 'Thank you for choosing Isheeka Events to be part of your celebration. Every occasion tells a story, and it is our privilege to help bring yours to life with care, creativity, and attention to the smallest detail.\n\nThe pages that follow set out the details, prepared thoughtfully for {event}. Should you wish to adjust anything, we would be delighted to tailor it to your vision.';
    const introBody = introTpl.replace(/\{client\}/g, quot.client_name || '').replace(/\{event\}/g, quot.event_name || 'your event');
    const bx = M + 60, bw = W - 2 * (M + 60);
    cormorant(20); setText(ROSE_DK); doc.text('Dear ' + (quot.client_name || '') + ',', bx, y); y += 26;
    cormorant(15); setText(INK);
    introBody.split('\n').forEach((par) => { if (!par.trim()) { y += 8; return; } const lines = doc.splitTextToSize(par.trim(), bw); doc.text(lines, bx, y); y += lines.length * 16 + 10; });
    y += 10; cormorant(14); setText(ROSE_DK); doc.text('With warm regards,', bx, y); y += 26;
    script(26); setText(PINK); doc.text(settings.founder_name || 'Swathi', bx, y); y += 16;
    sans('bold', 9); setText(GOLD); doc.text('Founder & CEO', bx, y);
    doc.addPage();
  }

  // ---- MAIN DOCUMENT ----
  drawFrame();
  drawHeaderBand();

  // Client + Event cards
  let y = HDR_BOTTOM + 8;
  const gap = 14, cardW = (W - 2 * M - gap) / 2, cardH = 76;
  const card = (x, lbl, name, lines) => {
    setDraw(PINK); doc.setLineWidth(0.8); doc.roundedRect(x, y, cardW, cardH, 6, 6, 'S');
    sans('bold', 8); setText(PINK); doc.text(lbl, x + 12, y + 16);
    sans('bold', 12); setText(INK); doc.text(doc.splitTextToSize(String(name || '--'), cardW - 24)[0], x + 12, y + 32);
    sans('normal', 9); setText(MUTED);
    let ly = y + 45; lines.filter(Boolean).slice(0, 3).forEach((l) => { doc.text(doc.splitTextToSize(String(l), cardW - 24)[0], x + 12, ly); ly += 11; });
  };
  const addr = [quot.client_city, quot.client_state].filter(Boolean).join(', ');
  card(M, 'CLIENT', quot.client_name, [[quot.client_phone, quot.client_email].filter(Boolean).join('   |   '), addr]);
  card(M + cardW + gap, 'EVENT', quot.event_name, [quot.event_ref ? ('Ref: ' + quot.event_ref) : null, quot.event_city || null, (isInv && quot.quotation_ref) ? ('From quote: ' + quot.quotation_ref) : null].filter(Boolean));
  y += cardH + 22;

  // Event schedule (functions · dates · venues) — only when present; matches the items-table style.
  let _sched = quot.event_schedule; if (typeof _sched === 'string') { try { _sched = JSON.parse(_sched || '[]'); } catch (e) { _sched = []; } } _sched = Array.isArray(_sched) ? _sched : [];
  if (dOpts.eventSchedule !== false && _sched.length) {
    sans('bold', 8); setText(ROSE_DK); doc.text('SCHEDULE', M, y); y += 6;
    doc.autoTable({
      head: [['Function', 'Date', 'Venue']],
      body: _sched.map((s) => [String(s.name || ''), s.date ? fmt(s.date) : '--', s.venue || '']),
      startY: y, margin: { left: M, right: M },
      theme: 'grid', tableLineColor: PINK, tableLineWidth: 0.8,
      styles: { fontSize: 9, cellPadding: 7, lineColor: LINE, lineWidth: 0.4, textColor: INK },
      headStyles: { fillColor: PINK, textColor: [255, 255, 255], fontSize: 9, halign: 'left' },
      alternateRowStyles: { fillColor: [252, 252, 252] },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 90 }, 2: { cellWidth: 170 } },
      didDrawPage: () => { drawFrame(); },
    });
    y = doc.lastAutoTable.finalY + 18;
  }

  // Line items table
  const showPrices = !!dOpts.prices, showQty = !!dOpts.qty;
  const head = ['Description']; if (showQty) head.push('Qty'); if (showPrices) { head.push('Unit price', 'Amount'); }
  const groups = {}; const order = []; (lineItems || []).forEach((li) => { const k = li.sub_event_name || 'General'; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(li); });
  const body = []; const grpRows = [];
  order.forEach((k) => {
    if (dOpts.grouping && order.length > 1) { grpRows.push(body.length); body.push([{ content: k, colSpan: head.length }]); }
    groups[k].forEach((li) => {
      const row = [String(li.description || '')];
      if (showQty) row.push(String(parseFloat(li.quantity || 0)));
      if (showPrices) { row.push(money(li.unit_price)); row.push(money(li.amount)); }
      body.push(row);
    });
  });
  const colStyles = { 0: { cellWidth: 'auto' } };
  let ci = 1; if (showQty) { colStyles[ci] = { halign: 'right', cellWidth: 55 }; ci++; }
  if (showPrices) { colStyles[ci] = { halign: 'right', cellWidth: 95 }; ci++; colStyles[ci] = { halign: 'right', cellWidth: 95 }; }
  const sub = parseFloat(quot.subtotal) || 0, disc = parseFloat(quot.discount_amount) || 0;
  const grand = parseFloat(quot.grand_total) || (sub - disc);
  let ps = quot.payment_schedule; if (typeof ps === 'string') { try { ps = JSON.parse(ps || '[]'); } catch (e) { ps = []; } } ps = Array.isArray(ps) ? ps : [];
  // Reserve room at the page bottom so the pricing summary + schedule never land alone atop a fresh page.
  const schedH = (dOpts.schedule && ps.length) ? (16 + 26 * ps.length) : 0;
  let sumH = 16 + 40; if (showPrices) { sumH += 15 + ((dOpts.discount && Math.abs(disc) > 0.5) ? 15 : 0) + ((isInv && quot.gst_applicable) ? 15 : 0) + 2; } if (isInv) { sumH += 32; }
  const blockH = Math.max(schedH, sumH) + 26;
  doc.autoTable({
    head: [head], body, startY: y, margin: { left: M, right: M, top: HDR_BOTTOM - 2, bottom: 58 + blockH + 24 },
    theme: 'grid', tableLineColor: PINK, tableLineWidth: 0.8,
    styles: { fontSize: 9, cellPadding: 7, lineColor: LINE, lineWidth: 0.4, textColor: INK },
    headStyles: { fillColor: PINK, textColor: [255, 255, 255], fontSize: 9, halign: 'left' },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: colStyles,
    didParseCell: (d) => { if (d.section === 'body' && grpRows.includes(d.row.index)) { d.cell.styles.fillColor = PSOFT; d.cell.styles.textColor = PINK; d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 8; } },
    didDrawPage: (d) => { drawFrame(); if (d.pageNumber > 1) { drawHeaderBand(); } },
  });
  y = doc.lastAutoTable.finalY + 24;

  // Totals + schedule
  if (H - 58 - y < blockH) { doc.addPage(); drawFrame(); drawHeaderBand(); y = HDR_BOTTOM + 8; }
  const colY = y, leftX = M, rightX = W / 2 + 14, rr = W - M;
  // schedule (left)
  let sy = colY;
  if (dOpts.schedule && ps.length) {
    sans('bold', 8.5); setText(GOLD); doc.text('PAYMENT SCHEDULE', leftX, sy); sy += 16;
    ps.forEach((p, i) => { const pamt = (parseFloat(p.amount) > 0) ? parseFloat(p.amount) : (grand * (parseFloat(p.pct) || 0) / 100); sans('normal', 9.5); setText(INK); doc.text(String.fromCharCode(97 + i) + ') ' + money(pamt) + ' ' + (p.label ? ('(' + p.label + ')') : ''), leftX, sy); sans('normal', 8); setText(MUTED); doc.text(String(p.when || ''), leftX + 14, sy + 11); sy += 26; });
  }
  // summary (right) — Total always shown
  let ty = colY;
  sans('bold', 8.5); setText(GOLD); doc.text('SUMMARY', rightX, ty); ty += 16;
  if (showPrices) {
    sans('normal', 10); setText([85, 85, 85]);
    doc.text('Subtotal', rightX, ty); doc.text(money(sub), rr, ty, { align: 'right' }); ty += 15;
    if (dOpts.discount && Math.abs(disc) > 0.5) { doc.text('Adjustment', rightX, ty); doc.text((disc > 0 ? '- ' : '+ ') + money(Math.abs(disc)), rr, ty, { align: 'right' }); ty += 15; }
    if (isInv && quot.gst_applicable) { doc.text('GST' + (quot.gst_pct ? (' (' + parseFloat(quot.gst_pct) + '%)') : ''), rightX, ty); doc.text(money(quot.tax_amount), rr, ty, { align: 'right' }); ty += 15; }
    ty += 2;
  }
  setFill(PINK); doc.roundedRect(rightX, ty, rr - rightX, 28, 5, 5, 'F');
  sans('bold', 13); setText([255, 255, 255]); doc.text(isInv ? 'Grand total' : 'Total', rightX + 12, ty + 18); doc.text(money(grand), rr - 12, ty + 18, { align: 'right' }); ty += 40;
  if (isInv) {
    const rec = parseFloat(quot.total_received) || 0, bal = parseFloat(quot.total_outstanding != null ? quot.total_outstanding : (grand - rec)) || 0;
    sans('normal', 10); setText([85, 85, 85]); doc.text('Received', rightX, ty); doc.text(money(rec), rr, ty, { align: 'right' }); ty += 16;
    sans('bold', 11); setText(PINK); doc.text('Balance due', rightX, ty); doc.text(money(bal), rr, ty, { align: 'right' }); ty += 16;
  }
  y = Math.max(sy, ty) + 26;

  // Payment details
  const hasBank = dOpts.bankDetails && (settings.bank_name || settings.account_number || settings.upi_id);
  if (hasBank) {
    if (H - 58 - y < 46) { doc.addPage(); drawFrame(); drawHeaderBand(); y = HDR_BOTTOM + 8; }
    setFill([250, 247, 248]); doc.roundedRect(M, y, W - 2 * M, 34, 5, 5, 'F');
    sans('bold', 8); setText(INK); doc.text('Payment details', M + 12, y + 14);
    sans('normal', 9); setText([85, 85, 85]);
    const bl = [settings.bank_name && ('Bank: ' + settings.bank_name), settings.account_number && ('A/c: ' + settings.account_number), settings.ifsc_code && ('IFSC: ' + settings.ifsc_code), settings.upi_id && ('UPI: ' + settings.upi_id)].filter(Boolean).join('    |    ');
    doc.text(doc.splitTextToSize(bl, W - 2 * M - 24), M + 12, y + 26); y += 48;
  }

  // Terms
  if (quot.additional_terms) {
    if (H - 58 - y < 40) { doc.addPage(); drawFrame(); drawHeaderBand(); y = HDR_BOTTOM + 8; }
    sans('bold', 8.5); setText(GOLD); doc.text('TERMS & CONDITIONS', M, y); y += 14;
    sans('normal', 9); setText(MUTED);
    quot.additional_terms.split('\n').filter((l) => l.trim()).forEach((l) => { const wl = doc.splitTextToSize('- ' + l.trim(), W - 2 * M); doc.text(wl, M, y); y += wl.length * 12 + 2; });
  }

  // Revision history (only on revised docs, when the sender opts to include it)
  if (opts.showRevisionHistory && Array.isArray(opts.revisionHistory) && opts.revisionHistory.length) {
    if (H - 58 - y < 60) { doc.addPage(); drawFrame(); drawHeaderBand(); y = HDR_BOTTOM + 8; } else { y += 12; }
    sans('bold', 8.5); setText(GOLD); doc.text('REVISION HISTORY', M, y); y += 6;
    setDraw(PINK); doc.setLineWidth(1); doc.line(M, y, W - M, y); y += 14;
    sans('normal', 9);
    opts.revisionHistory.forEach((r) => {
      const line = [r.label, r.date, r.change].filter(Boolean).join('   ·   ') + (r.reason ? ('   —   ' + r.reason) : '');
      const wl = doc.splitTextToSize(line, W - 2 * M);
      if (H - 58 - y < wl.length * 12 + 4) { doc.addPage(); drawFrame(); drawHeaderBand(); y = HDR_BOTTOM + 8; }
      setText(INK); doc.text(wl, M, y); y += wl.length * 12 + 5;
    });
  }

  // Footer + page numbers
  const pc = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pc; i++) { doc.setPage(i); if (!(dOpts.coverPage && i === 1)) drawFooter(i, pc); }

  const fname = (isInv ? 'Invoice_' : 'Quotation_') + String(quot.ref_number || 'draft').replace(/[^A-Za-z0-9_-]/g, '_') + '.pdf';
  if (opts.action === 'blob') { return doc.output('blob'); }
  if (opts.action === 'preview') { window.open(doc.output('bloburl'), '_blank'); return true; }
  if (opts.action === 'print') { try { doc.autoPrint(); } catch (e) { /* ignore */ } window.open(doc.output('bloburl'), '_blank'); }
  else { doc.save(fname); }
  return true;
}
