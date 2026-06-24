// Plain (unbranded) Excel read/write via exceljs — replaces SheetJS for the
// template/dues exports and the client/items uploads. (Branded reports use
// brandedXlsx.js.) Note: exceljs reads .xlsx only, not legacy binary .xls.
import ExcelJS from 'exceljs';

function cellVal(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if (v.text !== undefined) return v.text;                 // hyperlink / shared string
    if (v.result !== undefined) return v.result;             // formula
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    return '';
  }
  return v;
}

function sheetToAoa(ws) {
  const aoa = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals = row.values || [];                           // 1-indexed; [0] is empty
    const arr = [];
    for (let i = 1; i < vals.length; i++) arr[i - 1] = cellVal(vals[i]);
    for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
    aoa.push(arr);
  });
  return aoa;
}

// All worksheets → [{ name, aoa }]. aoa mirrors SheetJS sheet_to_json(header:1, defval:'').
export async function readWorkbook(arrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  return wb.worksheets.map((ws) => ({ name: ws.name, aoa: sheetToAoa(ws) }));
}

// First worksheet as an array-of-arrays.
export async function readAoa(arrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.worksheets[0];
  return ws ? sheetToAoa(ws) : [];
}

// Write a plain workbook (header row bolded) and trigger a browser download.
export async function downloadAoa(filename, sheetName, aoa, widths) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(String(sheetName || 'Sheet1').slice(0, 31));
  (aoa || []).forEach((row) => ws.addRow(row));
  if (widths) widths.forEach((w, i) => { ws.getColumn(i + 1).width = w || 16; });
  if ((aoa || []).length) ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
