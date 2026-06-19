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

// Call the authenticated extract function. opts: { files?: [...], text?: string }
export async function extractItems(opts) {
  try {
    const { data, error } = await supabase.functions.invoke('extract', { body: opts });
    if (error) {
      // functions.invoke surfaces non-2xx as an error; try to read the JSON body for our code
      let code = '';
      try { const c = await error.context?.json?.(); code = c?.error || ''; } catch (e) { /* noop */ }
      return { ok: false, error: code || error.message || 'extract_failed' };
    }
    return data || { ok: false, error: 'no_response' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'extract_failed' }; }
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
