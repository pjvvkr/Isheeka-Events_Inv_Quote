// Session + activity-log helpers (ported from isheeka-erp-v22.html).
import { supabase } from './supabase';

// Resolve the logged-in auth user to their app `users.user_id` (FK target for *_by columns).
// The auth user's id is NOT a users row, so we match on email; null if no staff row (FK allows null).
export async function _currentUid() {
  try {
    const { data } = await supabase.auth.getUser();
    const email = data && data.user && data.user.email;
    if (!email) return null;
    const { data: u } = await supabase.from('users').select('user_id').eq('email', email).maybeSingle();
    return (u && u.user_id) || null;
  } catch (e) { return null; }
}

export async function logQuoteSend(quotationId, channel) {
  try { await supabase.from('quotation_activity_log').insert({ quotation_id: quotationId, action: 'sent', channel, logged_by: await _currentUid() }); }
  catch (e) { console.error('[Isheeka ERP] quote send-log failed:', e); }
}

export async function logInvoiceActivity(invoiceId, row) {
  try { await supabase.from('invoice_activity_log').insert({ invoice_id: invoiceId, changed_by: await _currentUid(), ...row }); }
  catch (e) { console.error('[Isheeka ERP] invoice activity-log failed:', e); }
}
