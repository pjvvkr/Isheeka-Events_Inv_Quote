-- Per-user module access for Settings → Access control. A jsonb map of
-- { "<module_id>": true|false } for the grantable modules. NULL = use role defaults.
-- This is the single source of truth: the app reads it now (UI gating), and a future
-- RLS lockdown will read the same map so DB access matches the Settings grants.
alter table public.users add column if not exists module_access jsonb;
