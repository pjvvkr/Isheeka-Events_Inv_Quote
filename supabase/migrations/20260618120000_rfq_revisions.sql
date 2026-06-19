-- ============================================================================
-- Isheeka ERP — rfq_revisions (revision snapshots)
-- Additive & idempotent. The table already exists in PROD (created via the M3
-- batch run in the SQL editor); this migration brings the LOCAL schema in line so
-- the revisions history + diff on the RFQ detail works in dev too. Safe to run
-- against prod — every statement is "if not exists" / "drop policy if exists".
--
-- The rfq-gateway (service_role) writes one row per client/vendor submission;
-- the app reads them (authenticated) to show the version history and the diff.
-- ============================================================================

create table if not exists public.rfq_revisions (
  revision_id      uuid primary key default gen_random_uuid(),
  rfq_id           uuid not null references public.rfqs(rfq_id) on delete cascade,
  revision_number  int  not null,
  snapshot         jsonb not null,          -- { details:{...}, sub_events:[...], items:[...] }
  submitted_by     text default 'client',
  submitted_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists idx_rfq_revisions_rfq on public.rfq_revisions(rfq_id);

alter table public.rfq_revisions enable row level security;
drop policy if exists rfq_revisions_auth_all on public.rfq_revisions;
create policy rfq_revisions_auth_all on public.rfq_revisions for all to authenticated using (true) with check (true);
