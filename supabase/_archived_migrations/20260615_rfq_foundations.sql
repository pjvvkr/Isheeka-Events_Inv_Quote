-- ============================================================================
-- Isheeka ERP — RFQ Portal · Milestone 2 (Foundations)
-- Migration: RFQ tables + RLS + authenticated-only policies
-- Run this ONCE in the Supabase SQL Editor (Database → SQL Editor → New query).
-- Safe to re-run: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- Security model (see docs/rfq-portal-spec.md §F):
--   • RLS ON for every table here.
--   • Policies are AUTHENTICATED-ONLY (staff ERP). There are NO anon/public
--     policies — the public RFQ page can NOT read/write these tables directly.
--   • The public path goes only through the `rfq-gateway` Edge Function, which
--     uses the service_role key (bypasses RLS) and is itself gated by the link
--     token + PIN/OTP. service_role must never ship to the browser.
-- ============================================================================

-- 1) The request itself ------------------------------------------------------
create table if not exists public.rfqs (
  rfq_id            uuid primary key default gen_random_uuid(),
  ref_number        text unique,                         -- RFQ-YY-#### (via next_counter)
  status            text not null default 'draft',       -- draft|sent|in_progress|submitted|changes_requested|approved|converted|expired|withdrawn
  -- linkage (nullable; filled as the funnel progresses)
  client_id         uuid references public.clients(client_id),
  lead_id           uuid references public.leads(lead_id),
  event_id          uuid references public.events(event_id),
  quotation_id      uuid references public.quotations(quotation_id),
  -- captured details
  contact_name      text,
  contact_email     text,                                -- optional; required only for email-OTP mode
  contact_phone     text,
  event_type        text,
  event_date        date,
  location          text,
  guest_count       int,
  budget            numeric,
  notes             text,
  -- access control
  access_mode       text not null default 'pin',         -- 'pin' | 'email_otp'
  access_pin_hash   text,                                 -- SHA-256(pin) when access_mode='pin'
  token_hash        text not null,                        -- SHA-256(link token); raw token lives only in the URL
  token_expires_at  timestamptz,                          -- link validity window (default +21 days)
  revision_number   int not null default 0,               -- bumped on each staff "request changes" round (M4)
  -- sign-off audit
  client_submitted_at timestamptz,
  staff_approved_at   timestamptz,
  approved_by         uuid,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  is_deleted        boolean not null default false
);

-- 2) Line items the client requests (no prices — Swathi prices them on the quote)
create table if not exists public.rfq_items (
  rfq_item_id       uuid primary key default gen_random_uuid(),
  rfq_id            uuid not null references public.rfqs(rfq_id) on delete cascade,
  sub_event_name    text,
  description       text not null,
  quantity          numeric default 1,
  unit              text,
  source            text default 'custom',                -- 'catalog' | 'custom'
  sort_order        int default 0,
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now()
);

-- 3) Email OTP codes (hashed, short-lived, attempt-limited)
create table if not exists public.rfq_otp (
  otp_id            uuid primary key default gen_random_uuid(),
  rfq_id            uuid not null references public.rfqs(rfq_id) on delete cascade,
  email             text not null,
  code_hash         text not null,                        -- SHA-256(6-digit code)
  expires_at        timestamptz not null,                 -- +10 min
  attempts          int not null default 0,               -- lock after 5
  consumed_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- 4) Activity / dual sign-off audit
create table if not exists public.rfq_activity (
  activity_id       uuid primary key default gen_random_uuid(),
  rfq_id            uuid not null references public.rfqs(rfq_id) on delete cascade,
  actor             text not null,                        -- 'client' | staff auth uid
  action            text not null,                        -- created|sent|otp_sent|otp_verified|pin_verified|saved|submitted|changes_requested|approved|converted|...
  notes             text,
  created_at        timestamptz not null default now()
);

-- Indexes -------------------------------------------------------------------
create index if not exists idx_rfqs_token_hash   on public.rfqs(token_hash);
create index if not exists idx_rfqs_client_id    on public.rfqs(client_id);
create index if not exists idx_rfqs_lead_id      on public.rfqs(lead_id);
create index if not exists idx_rfqs_event_id     on public.rfqs(event_id);
create index if not exists idx_rfqs_status       on public.rfqs(status);
create index if not exists idx_rfq_items_rfq_id  on public.rfq_items(rfq_id);
create index if not exists idx_rfq_otp_rfq_id    on public.rfq_otp(rfq_id);
create index if not exists idx_rfq_activity_rfq_id on public.rfq_activity(rfq_id);

-- updated_at touch trigger for rfqs -----------------------------------------
create or replace function public.touch_rfqs_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_rfqs_touch on public.rfqs;
create trigger trg_rfqs_touch before update on public.rfqs
  for each row execute function public.touch_rfqs_updated_at();

-- RLS -----------------------------------------------------------------------
alter table public.rfqs         enable row level security;
alter table public.rfq_items    enable row level security;
alter table public.rfq_otp      enable row level security;
alter table public.rfq_activity enable row level security;

-- Authenticated-only policies (staff ERP). No anon/public access.
-- (service_role used by the Edge Function bypasses RLS and needs no policy.)
drop policy if exists rfqs_auth_all          on public.rfqs;
drop policy if exists rfq_items_auth_all     on public.rfq_items;
drop policy if exists rfq_otp_auth_all       on public.rfq_otp;
drop policy if exists rfq_activity_auth_all  on public.rfq_activity;

create policy rfqs_auth_all         on public.rfqs         for all to authenticated using (true) with check (true);
create policy rfq_items_auth_all    on public.rfq_items    for all to authenticated using (true) with check (true);
create policy rfq_otp_auth_all      on public.rfq_otp      for all to authenticated using (true) with check (true);
create policy rfq_activity_auth_all on public.rfq_activity for all to authenticated using (true) with check (true);

-- Seed the RFQ ref counter so RFQ numbers start at a friendly base (RFQ-YY-1111).
-- next_counter does find-or-create+increment atomically; this just sets the seed
-- the same way quotations/leads do. Harmless if it already exists.
-- (No action needed here — the Edge Function calls
--  next_counter(p_type=>'rfq', p_year=>'<YY>', p_seed=>1111) on first use.)

-- ============================================================================
-- Verify (optional): run after the above to confirm RLS + policies are correct.
-- select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename like 'rfq%';
-- select tablename, policyname, roles, cmd from pg_policies
--   where schemaname='public' and tablename like 'rfq%' order by tablename;
-- Expect: rowsecurity = true for all four; roles = {authenticated} only.
-- ============================================================================
