-- #74 DB-side RLS lockdown — two-tier, aligned to users.module_access.
-- Sensitive tables gate READ+WRITE; operational tables keep READ open + gate WRITES.
-- Edge functions use the service role and bypass RLS entirely, so they're unaffected.
-- Rollback: supabase/rollback_rls_lockdown.sql (run via SQL editor / MCP if needed).

-- ── Helper functions (SECURITY DEFINER: read the caller's profile past their own RLS) ──
create or replace function public.app_full() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (u.role = 'admin' or u.is_owner) from public.users u where u.user_id = auth.uid()),
    true)            -- no profile row → full access (never lock anyone out)
$$;

create or replace function public.app_is_owner() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select u.is_owner from public.users u where u.user_id = auth.uid()), false)
$$;

create or replace function public.app_is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select (u.role = 'admin') from public.users u where u.user_id = auth.uid()), false)
$$;

-- Module check. Fail-open while module_access is unset → gradual rollout: enforcement
-- only bites users who have an explicit map assigned via Settings → Access control.
create or replace function public.app_can(mod text) returns boolean
  language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then false
    else coalesce((
      select (u.role = 'admin' or u.is_owner
              or u.module_access is null
              or coalesce((u.module_access ->> mod)::boolean, false))
      from public.users u where u.user_id = auth.uid()), true)
  end
$$;

revoke all on function public.app_full(), public.app_is_owner(), public.app_is_admin(), public.app_can(text) from public;
grant execute on function public.app_full(), public.app_is_owner(), public.app_is_admin(), public.app_can(text) to authenticated;

-- ── Drop the existing permissive policies on every table we redefine ──
do $$
declare r record;
  tbls text[] := array[
    'clients','alternative_contacts','leads','lead_sources','lead_sub_events',
    'events','sub_events','sub_event_items','event_vendors','event_checklists','event_templates',
    'event_template_items','event_types','event_type_subevents',
    'quotations','quotation_line_items','quotation_activity_log',
    'invoices','invoice_line_items','invoice_installments','invoice_payments','invoice_activity_log',
    'vendors','vendor_payments','vendor_installments',
    'rfqs','rfq_items','rfq_activity','costing_summaries',
    'expenses','owner_ledger','owner_expenses','owner_reimbursements',
    'settings','users','notifications','push_subscriptions'];
begin
  for r in select tablename, policyname from pg_policies where schemaname='public' and tablename = any(tbls) loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ── Tier B — operational: READ open to staff, WRITE gated per module ──
do $$
declare t text;
  -- table : module
  pairs jsonb := '{
    "clients":"clients","alternative_contacts":"clients",
    "leads":"leads","lead_sources":"leads","lead_sub_events":"leads",
    "events":"events","sub_events":"events","sub_event_items":"events","event_vendors":"events",
    "event_checklists":"events","event_templates":"events","event_template_items":"events",
    "event_types":"events","event_type_subevents":"events",
    "quotations":"quotations","quotation_line_items":"quotations","quotation_activity_log":"quotations",
    "invoices":"invoices","invoice_line_items":"invoices","invoice_installments":"invoices",
    "invoice_payments":"invoices","invoice_activity_log":"invoices",
    "vendors":"vendors","vendor_payments":"vendor-payments","vendor_installments":"vendor-payments"
  }'::jsonb;
  k text;
begin
  for k in select jsonb_object_keys(pairs) loop
    t := k;
    execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.app_can(%L)) with check (public.app_can(%L))',
                   t||'_write', t, pairs->>k, pairs->>k);
  end loop;
end $$;

-- RFQ family backs BOTH the client-RFQ and vendor-RFQ modules → allow either.
do $$
declare t text;
begin
  foreach t in array array['rfqs','rfq_items','rfq_activity','costing_summaries'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_read', t);
    execute format($f$create policy %I on public.%I for all to authenticated
      using (public.app_can('rfqs') or public.app_can('vendor-rfqs'))
      with check (public.app_can('rfqs') or public.app_can('vendor-rfqs'))$f$, t||'_write', t);
  end loop;
end $$;

-- ── Tier A — sensitive: READ + WRITE gated ──
-- Expenses → expenses module (read + write).
create policy expenses_all on public.expenses for all to authenticated
  using (public.app_can('expenses')) with check (public.app_can('expenses'));

-- Owner finances → owners only.
create policy owner_ledger_all on public.owner_ledger for all to authenticated
  using (public.app_is_owner()) with check (public.app_is_owner());
create policy owner_expenses_all on public.owner_expenses for all to authenticated
  using (public.app_is_owner()) with check (public.app_is_owner());
create policy owner_reimbursements_all on public.owner_reimbursements for all to authenticated
  using (public.app_is_owner()) with check (public.app_is_owner());

-- Company/bank/settings → admins only.
create policy settings_all on public.settings for all to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());

-- Users → directory readable (names, assignees, notification audience); writes by
-- admins/owners, or a user editing their own row (e.g. their own notify prefs).
create policy users_read on public.users for select to authenticated using (true);
create policy users_write on public.users for all to authenticated
  using (public.app_full() or user_id = auth.uid())
  with check (public.app_full() or user_id = auth.uid());

-- ── Per-user tables: each user sees only their own rows ──
create policy notifications_self on public.notifications for all to authenticated
  using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());
create policy push_subscriptions_self on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Untouched (intentionally): counters, payment_notifications, rfq_otp, short_links
-- (infra / portal tables; keep their existing policies).
