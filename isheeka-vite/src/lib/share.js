// Share helpers — WhatsApp/email deep links + hosted-PDF upload + message builders.
// Ported verbatim from isheeka-erp-v22.html.
import { supabase } from './supabase';
import { fmtDate } from './format.js';
import { buildQuotationPDF } from '../pdf/quotationPdf.js';
import { fetchAsBase64 } from './storage.js';

export function waNormalize(phone) {
  const num = (phone || '').replace(/\D/g, '');
  if (!num) return '';
  return num.length === 10 ? ('91' + num) : num;
}

export function waLink(phone, text) { const d = (phone || '').replace(/\D/g, ''); const n = d.length >= 10 ? (d.length === 10 ? '91' + d : d) : ''; return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text); }

// Try the whatsapp:// app protocol first, fall back to wa.me web.
export function openWhatsApp(phone, msg) {
  const full = waNormalize(phone);
  const text = encodeURIComponent(msg || '');
  const webUrl = 'https://wa.me/' + full + '?text=' + text;
  const appUrl = 'whatsapp://send?' + (full ? ('phone=' + full + '&') : '') + 'text=' + text;
  let opened = false;
  const cancel = () => { opened = true; };
  window.addEventListener('blur', cancel, { once: true });
  const t = setTimeout(() => {
    window.removeEventListener('blur', cancel);
    if (!opened) window.open(webUrl, '_blank');
  }, 1200);
  try { window.location.href = appUrl; }
  catch (e) { clearTimeout(t); window.removeEventListener('blur', cancel); window.open(webUrl, '_blank'); }
}

// Open Gmail web compose or the default mail app.
export function openEmail(provider, to, subject, body) {
  const sub = encodeURIComponent(subject || '');
  const bd = encodeURIComponent(body || '');
  if (provider === 'gmail') {
    window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to || '') + '&su=' + sub + '&body=' + bd, '_blank');
  } else {
    window.open('mailto:' + (to || '') + '?subject=' + sub + '&body=' + bd);
  }
}

export function validClientPhone(p) { const n = (p || '').replace(/\D/g, ''); return n.length === 10 || (n.length === 12 && n.slice(0, 2) === '91'); }

// #1: turn a stored PDF into a SHORT branded link. We store the bucket+path (not a signed
// URL) in `short_links`; the public `s` edge function looks the code up and 302-redirects to a
// freshly-minted signed URL on each click (so links never expire). Returns null if the
// short-link infra isn't present yet — callers fall back to a plain signed URL.
async function makeShortLink(bucket, path, kind, ref) {
  try {
    const base = (import.meta.env && import.meta.env.VITE_SUPABASE_URL) || '';
    if (!base) return null;
    const code = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 7)
      : Math.random().toString(36).slice(2, 9);
    const { error } = await supabase.from('short_links').insert({ code, bucket, path, kind: kind || null, ref: ref || null });
    if (error) return null;
    return base.replace(/\/$/, '') + '/functions/v1/s/' + code;
  } catch (e) { return null; }
}

export async function uploadQuotePdf(quot, items, displayOpts, settings, extra) {
  try {
    const qrBase64 = (displayOpts && displayOpts.bankDetails && settings && settings.payment_qr_path) ? await fetchAsBase64(settings.payment_qr_path) : null;
    const blob = buildQuotationPDF(quot, items, { action: 'blob', displayOpts, settings, qrBase64, ...(extra || {}) });
    if (!blob || !blob.size) return null;
    const _ref = String(quot.ref_number || 'draft').replace(/[^A-Za-z0-9_-]/g, '');
    const _rev = (quot.revision_number && quot.revision_number > 0) ? ('-r' + quot.revision_number) : '';
    const _d = new Date(), _p = (n) => String(n).padStart(2, '0');
    const _stamp = '' + _d.getFullYear() + _p(_d.getMonth() + 1) + _p(_d.getDate()) + '-' + _p(_d.getHours()) + _p(_d.getMinutes());
    const _code = Math.random().toString(36).slice(2, 6);
    const path = 'quotes/Quotation_' + _ref + _rev + '_' + _stamp + '_' + _code + '.pdf';
    const { error: upErr } = await supabase.storage.from('quotations').upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (upErr) { console.error('[Isheeka ERP] PDF upload failed:', upErr); return null; }
    // Prefer a short branded link; fall back to a 30-day signed URL if the short-link infra
    // isn't deployed yet (so sharing keeps working either way).
    const short = await makeShortLink('quotations', path, 'quote', quot.ref_number);
    if (short) return short;
    const { data, error: sErr } = await supabase.storage.from('quotations').createSignedUrl(path, 60 * 60 * 24 * 30);
    if (sErr) { console.error('[Isheeka ERP] signed URL failed:', sErr); return null; }
    return (data && data.signedUrl) || null;
  } catch (err) { console.error('[Isheeka ERP] uploadQuotePdf error:', err); return null; }
}

export function buildQuoteShareMsg(quot, settings, url) {
  const evt = quot.event_name || 'your upcoming event';
  const phone = (settings && settings.phone_1) || '+91 78423 95867';
  const email = (settings && settings.email) || 'isheekaevents@gmail.com';
  const web = (settings && settings.website) || 'www.isheekaevents.com';
  return 'Dear ' + (quot.client_name || '') + ',\n\n' +
    'Thank you for considering Isheeka Events. We are delighted to share your personalised quotation for ' + evt + '.\n\n' +
    'Quotation: ' + quot.ref_number + '\n' +
    'Grand Total: Rs.' + (parseFloat(quot.grand_total) || 0).toLocaleString('en-IN') + '\n' +
    (quot.valid_until ? ('Valid until: ' + fmtDate(quot.valid_until, { day: 'numeric', month: 'short', year: 'numeric' }) + '\n') : '') +
    (url ? ('\nView your quotation here:\n' + url + '\n') : '') +
    '\nWe would be glad to walk you through the details or tailor anything to your vision.\n\n' +
    'For any queries, please reach out to us at:\n' +
    '📞 ' + phone + '\n' +
    '📧 ' + email + '\n' +
    '🌐 ' + web + '\n\n' +
    'Warm regards,\nTeam Isheeka Events 💕';
}

// Upload an invoice PDF to Storage and return a signed URL (mirrors uploadQuotePdf).
export async function uploadInvoicePdf(inv, items, settings, displayOpts, extra) {
  try {
    const _dispOpts = { ...(displayOpts || { prices: true, qty: true, schedule: true, discount: true, coverPage: false, bankDetails: true }), grouping: true };
    const qrBase64 = (_dispOpts.bankDetails && settings && settings.payment_qr_path) ? await fetchAsBase64(settings.payment_qr_path) : null;
    const blob = buildQuotationPDF(inv, items, { action: 'blob', docType: 'invoice', displayOpts: _dispOpts, settings, qrBase64, ...(extra || {}) });
    if (!blob || !blob.size) return null;
    const _ref = String(inv.ref_number || 'draft').replace(/[^A-Za-z0-9_-]/g, '');
    const _rev = (inv.revision_number && inv.revision_number > 0) ? ('-r' + inv.revision_number) : '';
    const _d = new Date(), _p = (n) => String(n).padStart(2, '0');
    const _stamp = '' + _d.getFullYear() + _p(_d.getMonth() + 1) + _p(_d.getDate()) + '-' + _p(_d.getHours()) + _p(_d.getMinutes());
    const _code = Math.random().toString(36).slice(2, 6);
    const path = 'invoices/Invoice_' + _ref + _rev + '_' + _stamp + '_' + _code + '.pdf';
    const { error: upErr } = await supabase.storage.from('quotations').upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (upErr) { console.error('[Isheeka ERP] invoice PDF upload failed:', upErr); return null; }
    const short = await makeShortLink('quotations', path, 'invoice', inv.ref_number);
    if (short) return short;
    const { data, error: sErr } = await supabase.storage.from('quotations').createSignedUrl(path, 60 * 60 * 24 * 30);
    if (sErr) { console.error('[Isheeka ERP] signed URL failed:', sErr); return null; }
    return (data && data.signedUrl) || null;
  } catch (err) { console.error('[Isheeka ERP] uploadInvoicePdf error:', err); return null; }
}

export function buildInvoiceShareMsg(inv, settings, url) {
  const evt = inv.event_name || 'your event';
  const phone = (settings && settings.phone_1) || '+91 78423 95867';
  const email = (settings && settings.email) || 'isheekaevents@gmail.com';
  const web = (settings && settings.website) || 'www.isheekaevents.com';
  const bal = parseFloat(inv.total_outstanding != null ? inv.total_outstanding : inv.grand_total) || 0;
  return 'Dear ' + (inv.client_name || '') + ',\n\n' +
    'Thank you for choosing Isheeka Events for ' + evt + '. Please find your invoice below.\n\n' +
    'Invoice: ' + inv.ref_number + '\n' +
    'Grand Total: Rs.' + (parseFloat(inv.grand_total) || 0).toLocaleString('en-IN') + '\n' +
    'Balance Due: Rs.' + bal.toLocaleString('en-IN') + '\n' +
    (inv.due_date ? ('Due by: ' + fmtDate(inv.due_date, { day: 'numeric', month: 'short', year: 'numeric' }) + '\n') : '') +
    (url ? ('\nView / download your invoice here:\n' + url + '\n') : '') +
    '\nFor any queries, please reach out to us at:\n' +
    '📞 ' + phone + '\n' +
    '📧 ' + email + '\n' +
    '🌐 ' + web + '\n\n' +
    'Warm regards,\nTeam Isheeka Events 💕';
}
