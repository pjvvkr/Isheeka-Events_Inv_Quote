-- Milestone S · S1 — Vendor RFQ + costing foundation.
-- Generalizes the RFQ engine for a vendor audience and adds costing storage.
-- ADDITIVE ONLY: existing client RFQs are unaffected (party_type defaults to 'client',
-- can_supply defaults to true, new columns are nullable). See docs/milestone-s-vendor-rfq-spec.md §3.

-- ── rfqs: vendor-audience fields + reminder tracking ─────────────────────────
alter table public.rfqs add column if not exists party_type      text not null default 'client';
alter table public.rfqs add column if not exists parent_rfq_id   uuid references public.rfqs(rfq_id);
alter table public.rfqs add column if not exists vendor_id       uuid references public.vendors(vendor_id);
alter table public.rfqs add column if not exists reminder_count  integer not null default 0;
alter table public.rfqs add column if not exists last_reminded_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rfqs_party_type_check') then
    alter table public.rfqs add constraint rfqs_party_type_check check (party_type in ('client','vendor'));
  end if;
end $$;

create index if not exists idx_rfqs_parent on public.rfqs (parent_rfq_id) where parent_rfq_id is not null;
create index if not exists idx_rfqs_vendor on public.rfqs (vendor_id) where vendor_id is not null;

-- ── rfq_items: vendor cost fields ────────────────────────────────────────────
alter table public.rfq_items add column if not exists unit_cost  numeric;
alter table public.rfq_items add column if not exists can_supply boolean not null default true;
alter table public.rfq_items add column if not exists item_note  text;

-- ── settings: global default markup % ────────────────────────────────────────
alter table public.settings add column if not exists default_markup_pct numeric default 30;

-- ── costing_summaries: saved audit snapshot per costing exercise ─────────────
create table if not exists public.costing_summaries (
  costing_summary_id  uuid primary key default gen_random_uuid(),
  client_rfq_id       uuid not null references public.rfqs(rfq_id),
  event_id            uuid references public.events(event_id),
  quotation_id        uuid references public.quotations(quotation_id),
  generated_by        uuid references public.users(user_id),
  generated_at        timestamptz not null default now(),
  default_markup_pct  numeric,
  total_cost          numeric,
  total_client        numeric,
  total_margin        numeric,
  internal_notes      text,
  lines               jsonb,           -- per-item snapshot: all vendor bids, chosen source, markup, override reason, client price
  is_deleted          boolean not null default false
);

alter table public.costing_summaries enable row level security;
drop policy if exists "authenticated manage costing summaries" on public.costing_summaries;
create policy "authenticated manage costing summaries"
  on public.costing_summaries for all to authenticated
  using (true) with check (true);

create index if not exists idx_costing_summaries_rfq on public.costing_summaries (client_rfq_id);
