// Staff-side extraction: photo/PDF/pasted text → item list, via the authenticated
// `extract` edge function. Used inside the ERP (e.g. the quote wizard). The user's
// Supabase JWT is attached automatically by supabase.functions.invoke.
import { supabase } from './supabase';

// One image File → { media_type, data(base64) }; PDFs pass through. Images are
// downscaled to keep the payload (and AI cost) small.
function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') {
      const fr = new FileReader();
      fr.onload = () => { try { resolve({ media_type: 'application/pdf', data: String(fr.result).split(',')[1] }); } catch (e) { reject(e); } };
      fr.onerror = reject; fr.readAsDataURL(file); return;
    }
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1280; let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (Math.max(w, h) > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      try { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); resolve({ media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] }); }
      catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable_image')); };
    img.src = url;
  });
}

export async function filesToPayloads(fileList) {
  const arr = Array.from(fileList || []).slice(0, 6); const out = [];
  for (const f of arr) { try { out.push(await fileToPayload(f)); } catch (e) { /* skip unreadable */ } }
  return out;
}

// One extract call (one chunk).
async function extractOne(body) {
  try {
    const { data, error } = await supabase.functions.invoke('extract', { body });
    if (error) {
      let code = '';
      try { const c = await error.context?.json?.(); code = c?.error || ''; } catch (e) { /* noop */ }
      return { ok: false, error: code || error.message || 'extract_failed' };
    }
    return data || { ok: false, error: 'no_response' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'extract_failed' }; }
}

const CHUNK_LINES = 80; // split big pastes so no single call hits the output-token ceiling
function chunkText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= CHUNK_LINES) return [String(text)];
  const out = []; for (let i = 0; i < lines.length; i += CHUNK_LINES) out.push(lines.slice(i, i + CHUNK_LINES).join('\n'));
  return out;
}

// Chunks large inputs (text by lines, files one-per-call), extracts in parallel, merges + de-dupes.
// opts: { files?: [...], file?, text?: string }
export async function extractItems(opts) {
  opts = opts || {};
  const calls = [];
  if (opts.text && String(opts.text).trim()) chunkText(opts.text).forEach((c) => calls.push({ text: c }));
  const files = opts.files || (opts.file ? [opts.file] : []);
  (files || []).forEach((f) => calls.push({ files: [f] }));
  if (!calls.length) return { ok: false, error: 'no_input' };
  if (calls.length === 1) return await extractOne(calls[0]);

  const results = await Promise.all(calls.map(extractOne));
  const ok = results.filter((r) => r && r.ok);
  if (!ok.length) return results.find((r) => r && r.error) || { ok: false, error: 'extract_failed' };
  const items = ok.flatMap((r) => r.items || []);   // keep every item (no de-dup) — review handles duplicates
  return { ok: true, items, partial: ok.length < results.length };
}

// Owner-expense smart capture: one receipt/bill/note (photo, PDF, or pasted text) → one
// expense object {amount, date, category, merchant, description}. Single call (one receipt).
export async function extractExpense(opts) {
  opts = opts || {};
  const files = opts.files || (opts.file ? [opts.file] : []);
  const body = { action: 'expense' };
  if (opts.text && String(opts.text).trim()) body.text = String(opts.text);
  if (files.length) body.files = files;
  if (!body.text && !body.files) return { ok: false, error: 'no_input' };
  return await extractOne(body);
}

// Email the owners that an owner-funded expense was recorded (server builds the message).
// expense = { amount, description, category, date, paid_by_name }
export async function notifyOwnerExpense(recipients, expense) {
  const to = (recipients || []).filter((e) => e && /\S+@\S+\.\S+/.test(String(e)));
  if (!to.length) return { ok: false, error: 'no_recipients' };
  try {
    const { data, error } = await supabase.functions.invoke('extract', { body: { action: 'notify', to, expense } });
    if (error) return { ok: false, error: error.message || 'notify_failed' };
    return data || { ok: false, error: 'no_response' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'notify_failed' }; }
}

export function extractErrMsg(r) {
  const e = r && r.error;
  if (e === 'extract_unavailable') return 'Extraction isn’t enabled yet (no AI key).';
  if (e === 'too_large') return 'That file is too large — try a smaller photo.';
  if (e === 'bad_type') return 'Unsupported file — use a photo (JPG/PNG) or a PDF.';
  if (e === 'extract_unreadable') return 'Couldn’t read a clear list — try a sharper photo or paste the text.';
  if (e === 'unauthorized') return 'Session expired — please sign in again.';
  return 'Couldn’t read that — try again, or add items manually.';
}
