// Isheeka-branded .xlsx builder (exceljs). Each "sheet" = one styled table:
//   { name, title, subtitle, columns:[{label,width,align,fmt}], rows:[[...]], totals?:[...], notes?:[...] }
// fmt 'money' → ₹ thousands format, right aligned. Brand: maroon header band, pink
// column heads, light-rose totals. Use downloadBrandedWorkbook(filename, company, sheets).
import ExcelJS from 'exceljs';

const MAROON = 'FFA0123A', PINK = 'FFE8185A', LIGHT = 'FFFCEAF1', WHITE = 'FFFFFFFF', INK = 'FF2A2723', GREY = 'FF6B6660', LINE = 'FFE6DFD6';
const thin = () => { const s = { style: 'thin', color: { argb: LINE } }; return { top: s, left: s, bottom: s, right: s }; };
const MONEY = '"₹"#,##0';

function buildSheet(wb, company, sh) {
  const ws = wb.addWorksheet((sh.name || 'Report').slice(0, 31), { views: [{ showGridLines: false }] });
  const cols = sh.columns || [];
  const n = Math.max(1, cols.length);
  ws.columns = cols.map((c) => ({ width: c.width || 16 }));
  let r = 1;

  ws.mergeCells(r, 1, r, n);
  const tc = ws.getCell(r, 1);
  tc.value = (company || 'Isheeka Events').toUpperCase();
  tc.font = { bold: true, size: 15, color: { argb: WHITE } };
  tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MAROON } };
  tc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 26; r++;

  if (sh.title) { ws.mergeCells(r, 1, r, n); const c = ws.getCell(r, 1); c.value = sh.title; c.font = { bold: true, size: 12, color: { argb: MAROON } }; c.alignment = { indent: 1 }; r++; }
  if (sh.subtitle) { ws.mergeCells(r, 1, r, n); const c = ws.getCell(r, 1); c.value = sh.subtitle; c.font = { size: 10, color: { argb: GREY } }; c.alignment = { indent: 1 }; r++; }
  r++;

  cols.forEach((c, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } };
    cell.alignment = { horizontal: c.align || 'left', vertical: 'middle' };
    cell.border = thin();
  });
  ws.getRow(r).height = 18; r++;

  (sh.rows || []).forEach((row) => {
    cols.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = (row[i] === undefined || row[i] === null) ? '' : row[i];
      cell.alignment = { horizontal: c.align || 'left' };
      cell.font = { size: 10, color: { argb: INK } };
      cell.border = thin();
      if (c.fmt === 'money' && typeof row[i] === 'number') cell.numFmt = MONEY;
    });
    r++;
  });

  if (sh.totals) {
    cols.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = (sh.totals[i] === undefined || sh.totals[i] === null) ? '' : sh.totals[i];
      cell.alignment = { horizontal: c.align || 'left' };
      cell.font = { bold: true, color: { argb: MAROON }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      cell.border = thin();
      if (c.fmt === 'money' && typeof sh.totals[i] === 'number') cell.numFmt = MONEY;
    });
    r++;
  }

  (sh.notes || []).forEach((note) => { ws.mergeCells(r, 1, r, n); const c = ws.getCell(r, 1); c.value = note; c.font = { size: 9, italic: true, color: { argb: GREY } }; r++; });
}

export async function downloadBrandedWorkbook(filename, company, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = company || 'Isheeka Events';
  wb.created = new Date();
  (sheets || []).forEach((sh) => buildSheet(wb, company, sh));
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
