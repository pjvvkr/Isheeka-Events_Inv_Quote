-- In-app notification center (Phase 1). One row per recipient (fan-out). The app
-- reads the signed-in user's rows; triggers (gateway submit_rfq, owner expense) insert.
create table if not exists public.notifications (
  notification_id   uuid primary key default extensions.uuid_generate_v4(),
  recipient_user_id uuid references public.users(user_id),
  type              text not null,            -- rfq_submitted | vendor_bid | owner_expense | payment_received | ...
  title             text not null,
  body              text,
  doc_ref           text,                     -- e.g. RFQ-26-1131 / Ex-26-1116
  link_page         text,                     -- nav page id (rfqs, owner-account, invoices, …)
  link_opts         jsonb,                    -- nav opts, e.g. {"rfqId": "…"}
  is_read           boolean default false,
  created_at        timestamptz default now(),
  is_deleted        boolean default false
);

alter table public.notifications enable row level security;
drop policy if exists "notifications_policy" on public.notifications;
create policy "notifications_policy" on public.notifications
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists notifications_recipient_idx on public.notifications (recipient_user_id, is_read, created_at desc);
