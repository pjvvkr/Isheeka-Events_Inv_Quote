-- ROLLBACK for #74 (20260625000000_rls_module_lockdown.sql).
-- Emergency revert: restores the original permissive "any authenticated" policy on every
-- table the lockdown changed, and drops the helper functions. Run via SQL editor / MCP.
-- NOTE: kept OUTSIDE supabase/migrations/ so it is never auto-applied by a db push.

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
  t text;
begin
  -- drop the lockdown policies
  for r in select tablename, policyname from pg_policies where schemaname='public' and tablename = any(tbls) loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
  -- restore the original permissive policy
  foreach t in array tbls loop
    execute format($f$create policy %I on public.%I for all to public
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated')$f$, t||'_policy', t);
  end loop;
end $$;

drop function if exists public.app_can(text);
drop function if exists public.app_is_admin();
drop function if exists public.app_is_owner();
drop function if exists public.app_full();
