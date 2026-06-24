// Private-bucket file access. Files live in the (private) `quotations` bucket; we
// store the in-bucket PATH and mint a short-lived signed URL on demand to view them.
// Handles legacy values too — older rows stored a full public URL, from which we
// recover the path. openStoredFile() opens the blank tab synchronously (in the click
// gesture) and redirects after signing, so popup blockers don't trip.
import { supabase } from './supabase';

const BUCKET = 'quotations';

// Stored value → in-bucket path (accepts a bare path or a legacy public/sign URL).
function toPath(stored) {
  if (!stored) return null;
  const s = String(stored);
  const m = s.match(/\/quotations\/([^?]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
  return s.replace(/^\/+/, '');
}

// Upload under a prefix; returns the in-bucket PATH (view via openStoredFile).
export async function uploadToQuotations(file, prefix) {
  if (!file) return null;
  try {
    const ext = ((file.name || 'img').split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'png';
    const path = (prefix || 'misc') + '/f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.' + ext;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: true });
    if (error) return null;
    return path;
  } catch (e) { return null; }
}

export async function signedUrl(stored, expirySec = 3600) {
  const path = toPath(stored);
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expirySec);
    if (error) return null;
    return (data && data.signedUrl) || null;
  } catch (e) { return null; }
}

// Open a stored file in a new tab via a fresh signed URL (popup-blocker safe).
export async function openStoredFile(stored) {
  const w = window.open('', '_blank');
  const url = await signedUrl(stored);
  if (url) { if (w) w.location = url; else window.open(url, '_blank'); }
  else if (w) { w.close(); }
  return url;
}
