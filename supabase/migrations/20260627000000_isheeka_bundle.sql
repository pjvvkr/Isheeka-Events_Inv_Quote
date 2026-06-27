-- ============================================================================
-- Isheeka ERP — Bundle migration (2026-06-27)
--
-- Single file for all schema changes in the full feature bundle.
-- Applied FIRST (before gateway deploy, before app deploy).
-- Fully additive + idempotent: safe to re-run.
-- ============================================================================

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. sub_items JSONB on line-item tables
--    Each element: { "name": text, "qty": number, "note": text|null }
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
alter table public.rfq_items            add column if not exists sub_items jsonb not null default '[]';
alter table public.quotation_line_items add column if not exists sub_items jsonb not null default '[]';
alter table public.invoice_line_items   add column if not exists sub_items jsonb not null default '[]';
alter table public.sub_event_items      add column if not exists sub_items jsonb not null default '[]';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. source_item_id on rfq_items
--    Stable back-link from a vendor-side rfq_item to the originating
--    client-side rfq_item. Powers "Not requested" state in costing.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
alter table public.rfq_items
  add column if not exists source_item_id uuid
    references public.rfq_items(rfq_item_id) on delete set null;

create index if not exists idx_rfq_items_source_item
  on public.rfq_items(source_item_id)
  where source_item_id is not null;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. RFQ client-confirmation columns
--    After staff edits an RFQ, they can request client re-confirmation.
--    confirmation_status: pending | confirmed | declined
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
alter table public.rfqs
  add column if not exists confirmation_status       text,
  add column if not exists confirmation_requested_at timestamptz,
  add column if not exists client_confirmed_at       timestamptz,
  add column if not exists client_confirm_note       text;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. Quotation approval columns
--    New PIN-based approval flow (separate from the old approval_token text col).
--    approval_status: pending | approved | declined
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
alter table public.quotations
  add column if not exists approval_status     text,
  add column if not exists approval_token_hash text,    -- sha256 of the token in the link
  add column if not exists approval_pin_hash   text,    -- sha256 of the 4-6 digit PIN
  add column if not exists client_approved_at  timestamptz,
  add column if not exists approver_name       text;    -- typed name at signing

create index if not exists idx_quotations_approval_token_hash
  on public.quotations(approval_token_hash)
  where approval_token_hash is not null;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. quote_approvals — full audit trail of approval-page events
--    action: requested | opened | signed | declined
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
create table if not exists public.quote_approvals (
  approval_id   uuid        primary key default gen_random_uuid(),
  quotation_id  uuid        not null references public.quotations(quotation_id) on delete cascade,
  action        text        not null,    -- requested | opened | signed | declined
  signer_name   text,                   -- set on signed / declined
  ip            text,                   -- client IP (best-effort from headers)
  created_at    timestamptz not null default now()
);

create index if not exists idx_quote_approvals_quotation
  on public.quote_approvals(quotation_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. vendor_onboarding — self-service vendor registration via invite link
--    status: pending | submitted | approved | rejected
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
create table if not exists public.vendor_onboarding (
  onboarding_id    uuid        primary key default gen_random_uuid(),
  token_hash       text        not null unique,   -- sha256 of the invite token in the link
  pin_hash         text,                          -- sha256 of PIN sent in invite (optional)
  submitted_fields jsonb,                         -- all form fields as submitted
  status           text        not null default 'pending',
  vendor_id        uuid        references public.vendors(vendor_id),    -- set on approval
  invited_by       uuid        references public.users(user_id),
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  reviewed_by      uuid        references public.users(user_id)
);

create index if not exists idx_vendor_onboarding_status
  on public.vendor_onboarding(status);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 7. message_log — history of WhatsApp taps + emails from Clients / Vendors
--    party_type: client | vendor
--    channel:    whatsapp | email
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
create table if not exists public.message_log (
  log_id      uuid        primary key default gen_random_uuid(),
  party_type  text        not null,
  party_id    uuid        not null,
  channel     text        not null,
  template    text,
  body        text,
  sent_by     uuid        references public.users(user_id),
  created_at  timestamptz not null default now()
);

create index if not exists idx_message_log_party
  on public.message_log(party_type, party_id);
create index if not exists idx_message_log_created
  on public.message_log(created_at desc);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 8. settings: payment QR storage path
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
alter table public.settings
  add column if not exists payment_qr_path text;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 9. RLS — enable + policies on all new tables
--
--    Consistent with the June hardening:
--    • anon has ZERO table access (revoked in tier1; gateway uses service_role)
--    • authenticated reads gated by module via app_can()
--    • public writes (approval page, vendor form) go only via rfq-gateway
--      which runs as service_role and bypasses RLS — no anon DML policies needed
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- quote_approvals ────────────────────────────────────────────────────────────
alter table public.quote_approvals enable row level security;

drop policy if exists quote_approvals_read  on public.quote_approvals;
create policy quote_approvals_read on public.quote_approvals
  for select to authenticated
  using (app_can('quotations'));

drop policy if exists quote_approvals_write on public.quote_approvals;
create policy quote_approvals_write on public.quote_approvals
  for insert to authenticated
  with check (app_can('quotations'));

-- vendor_onboarding ──────────────────────────────────────────────────────────
alter table public.vendor_onboarding enable row level security;

drop policy if exists vendor_onboarding_read  on public.vendor_onboarding;
create policy vendor_onboarding_read on public.vendor_onboarding
  for select to authenticated
  using (app_can('vendors'));

drop policy if exists vendor_onboarding_write on public.vendor_onboarding;
create policy vendor_onboarding_write on public.vendor_onboarding
  for all to authenticated
  using (app_can('vendors'))
  with check (app_can('vendors'));

-- message_log ────────────────────────────────────────────────────────────────
alter table public.message_log enable row level security;

drop policy if exists message_log_read on public.message_log;
create policy message_log_read on public.message_log
  for select to authenticated
  using (app_can('clients') or app_can('vendors'));

drop policy if exists message_log_write on public.message_log;
create policy message_log_write on public.message_log
  for insert to authenticated
  with check (app_can('clients') or app_can('vendors'));
