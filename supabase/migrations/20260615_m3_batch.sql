-- ============================================================================
-- Isheeka ERP — M3 batch (revisions + sub-events config)
-- Additive & safe. Run once in the Supabase SQL Editor.
--   (1) rfq_revisions       — point-in-time snapshot of each client submission
--   (2) event_type_subevents — managed functions (sub-events) per event type
-- ============================================================================

-- (1) Revision snapshots -----------------------------------------------------
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

-- (2) Sub-events (functions) per event type ----------------------------------
create table if not exists public.event_type_subevents (
  subevent_id      uuid primary key default gen_random_uuid(),
  event_type_id    bigint not null references public.event_types(event_type_id) on delete cascade,
  name             text not null,
  sort_order       int  not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists idx_ets_event_type on public.event_type_subevents(event_type_id);

-- RLS: authenticated staff full access; no anon. (Gateway uses service_role.)
alter table public.rfq_revisions        enable row level security;
alter table public.event_type_subevents enable row level security;

drop policy if exists rfq_revisions_auth_all on public.rfq_revisions;
drop policy if exists ets_auth_all           on public.event_type_subevents;
create policy rfq_revisions_auth_all on public.rfq_revisions        for all to authenticated using (true) with check (true);
create policy ets_auth_all           on public.event_type_subevents for all to authenticated using (true) with check (true);

-- Optional starter data: seed common functions for a "Wedding" type if present.
-- (Safe no-op if you have no event type whose label ILIKE 'wedding'.)
insert into public.event_type_subevents (event_type_id, name, sort_order)
select et.event_type_id, v.name, v.ord
from public.event_types et
cross join (values ('Mehendi',0),('Haldi',1),('Sangeeth',2),('Reception',3)) as v(name,ord)
where et.label ilike 'wedding'
  and not exists (select 1 from public.event_type_subevents x where x.event_type_id = et.event_type_id);
