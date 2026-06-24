// Web Push (Phase 2) — client side. The public VAPID key is safe to ship; the private
// key + internal secret are server secrets. Subscriptions are stored per device.
import { supabase } from './supabase';

export const VAPID_PUBLIC = 'BEHtMTvSYCBhCzk13f2KvIYkulLxF-a7vv7Eq810wYZPfm9Dle6lkGJJ86DOzEU9ex7QpmmKtvB33B-WH-quW08';

export function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
}
export function pushPermission() { return (typeof Notification !== 'undefined') ? Notification.permission : 'denied'; }

function urlB64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Ask permission, subscribe through the service worker, and store the subscription.
export async function enablePush(userId) {
  if (!pushSupported()) return { ok: false, error: 'unsupported' };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'denied' };
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC) });
    const j = sub.toJSON();
    const { error } = await supabase.from('push_subscriptions').upsert({ user_id: userId || null, endpoint: j.endpoint, subscription: j, user_agent: navigator.userAgent, is_deleted: false }, { onConflict: 'endpoint' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'failed' }; }
}

// Fire a push to a set of users via the push-send function (app-side triggers, e.g. owner expense).
export async function sendPush(userIds, payload) {
  try {
    const { data, error } = await supabase.functions.invoke('push-send', { body: { user_ids: userIds, payload } });
    if (error) return { ok: false };
    return data || { ok: false };
  } catch (e) { return { ok: false }; }
}

export async function sendTestPush(userId) {
  return await sendPush([userId], { title: 'Isheeka — test alert', body: 'Push notifications are working 🎉', url: '/' });
}
