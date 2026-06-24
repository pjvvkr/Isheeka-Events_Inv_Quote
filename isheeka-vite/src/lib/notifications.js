// In-app notifications (Phase 1). One row per recipient. Default audience = owners/admins
// (per-user preferences arrive in Phase 3).
import { supabase } from './supabase';

// Owner/admin recipient ids — the default audience for alerts.
export async function ownerAdminIds() {
  const { data } = await supabase.from('users').select('user_id,role,is_owner').eq('is_deleted', false);
  return (data || []).filter((u) => u.is_owner || u.role === 'admin').map((u) => u.user_id);
}

// Fan-out one notification to many recipients. n = { type, title, body?, doc_ref?, link_page?, link_opts? }
export async function createNotifications(recipientIds, n) {
  const ids = [...new Set((recipientIds || []).filter(Boolean))];
  if (!ids.length || !n) return;
  const rows = ids.map((uid) => ({
    recipient_user_id: uid, type: n.type, title: n.title, body: n.body || null,
    doc_ref: n.doc_ref || null, link_page: n.link_page || null, link_opts: n.link_opts || null,
  }));
  try { await supabase.from('notifications').insert(rows); } catch (e) { /* non-fatal */ }
}

export async function loadNotifications(userId, limit = 30) {
  if (!userId) return [];
  const { data } = await supabase.from('notifications').select('*')
    .eq('recipient_user_id', userId).eq('is_deleted', false)
    .order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

export async function markRead(id) { try { await supabase.from('notifications').update({ is_read: true }).eq('notification_id', id); } catch (e) { /* noop */ } }
export async function markAllRead(userId) { if (!userId) return; try { await supabase.from('notifications').update({ is_read: true }).eq('recipient_user_id', userId).eq('is_read', false); } catch (e) { /* noop */ } }
