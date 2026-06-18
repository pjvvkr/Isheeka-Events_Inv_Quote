-- ============================================================================
-- Isheeka ERP — RFQ Portal · Milestone 3 (column addendum)
-- Adds the fields the client form captures. ADDITIVE & SAFE: new nullable
-- columns on the existing rfqs table only — no data touched, no downtime,
-- nothing else in the schema changes. Run once in the Supabase SQL Editor.
-- ============================================================================

alter table public.rfqs
  add column if not exists sub_events             jsonb,   -- [{name, planned_date}] ordered
  add column if not exists secondary_contact_name  text,
  add column if not exists secondary_contact_phone text,
  add column if not exists city                     text,  -- venue stays in `location`
  add column if not exists budget_range             text;  -- e.g. "₹20–30 Lakh"

-- (event_date already exists = the main event's Planned date.)

-- Verify (optional):
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='rfqs'
--   and column_name in ('sub_events','secondary_contact_name','secondary_contact_phone','city','budget_range');
