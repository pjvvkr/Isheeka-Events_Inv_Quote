// Per-user notification preferences (Phase 3). The single source of truth for which
// channels each owner/admin gets per event. The gateway mirrors DEFAULTS in TS for
// server-side submission alerts.
import { supabase } from './supabase';

export const NOTIF_EVENTS = [
  { key: 'rfq_submitted', label: 'Client RFQ submitted' },
  { key: 'vendor_bid', label: 'Vendor bid received' },
  { key: 'owner_expense', label: 'Owner expense recorded' },
  { key: 'payment_received', label: 'Payment received' },
  { key: 'overdue_followup', label: 'Invoice overdue · follow-up due' },
  { key: 'digest', label: 'Daily morning digest' },
];
export const NOTIF_CHANNELS = [['inapp', 'In-app'], ['push', 'Push'], ['email', 'Email']];

// Default channel matrix (used when a user has no saved pref for an event/channel).
export const DEFAULTS = {
  rfq_submitted: { inapp: true, push: true, email: true },
  vendor_bid: { inapp: true, push: true, email: true },
  owner_expense: { inapp: true, push: true, email: true },
  payment_received: { inapp: true, push: true, email: false },
  overdue_followup: { inapp: true, push: true, email: false },
  digest: { inapp: false, push: true, email: true },
};

export function prefOn(prefs, eventKey, channel) {
  const p = prefs && prefs[eventKey];
  if (p && typeof p[channel] === 'boolean') return p[channel];
  return (DEFAULTS[eventKey] && typeof DEFAULTS[eventKey][channel] === 'boolean') ? DEFAULTS[eventKey][channel] : true;
}

// Full {event:{inapp,push,email}} map for a user, defaults applied — for the prefs UI.
export function resolvedPrefs(prefs) {
  const out = {};
  NOTIF_EVENTS.forEach((e) => { out[e.key] = {}; NOTIF_CHANNELS.forEach(([c]) => { out[e.key][c] = prefOn(prefs, e.key, c); }); });
  return out;
}

// Audience (owners/admins) partitioned by channel for an event → who gets in-app / push / email.
export async function resolveAudience(eventKey) {
  const { data } = await supabase.from('users').select('user_id,email,role,is_owner,notify_prefs').eq('is_deleted', false);
  const aud = (data || []).filter((u) => u.is_owner || u.role === 'admin');
  return {
    inappIds: aud.filter((u) => prefOn(u.notify_prefs, eventKey, 'inapp')).map((u) => u.user_id),
    pushIds: aud.filter((u) => prefOn(u.notify_prefs, eventKey, 'push')).map((u) => u.user_id),
    emailAddrs: aud.filter((u) => prefOn(u.notify_prefs, eventKey, 'email')).map((u) => u.email).filter(Boolean),
  };
}
