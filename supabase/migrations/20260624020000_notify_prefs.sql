-- Per-user notification preferences (Phase 3). jsonb: { "<event>": {inapp,push,email} }.
-- NULL = use defaults (see lib/notifyPrefs.js / gateway defaultPref).
alter table public.users add column if not exists notify_prefs jsonb;
