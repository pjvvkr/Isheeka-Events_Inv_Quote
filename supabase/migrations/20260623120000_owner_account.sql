-- ============================================================================
-- Owner Account — integrates with the existing Expenses module (single source of
-- truth for business expenses) rather than duplicating it.
--
--   1. users.is_owner        — flags the owners (Vamsi + Swathi).
--   2. expenses.paid_by      — which owner fronted an expense (NULL = business funds).
--   3. owner_ledger          — the owner money-movements that are NOT business costs:
--                              funding (owner → business), reimbursements, and
--                              owner ↔ owner settlements.
--
-- Reconciliation joins the two:
--   business owes(owner) = Σ(expenses.paid_by = owner) + Σ(funding.from = owner)
--                          − Σ(reimbursement.to = owner)
--
-- Additive & idempotent; legacy owner_expenses / owner_reimbursements untouched.
-- ============================================================================

-- 1) Flag the owners. Identified by email; safe no-op if a row doesn't exist yet.
alter table public.users add column if not exists is_owner boolean default false;
update public.users set is_owner = true
  where lower(email) in ('vamshi.555@gmail.com', 'isheekaevents@gmail.com');

-- 2) Who fronted the expense. NULL = paid from business funds (default; no owner owed).
alter table public.expenses add column if not exists paid_by uuid references public.users(user_id);
create index if not exists expenses_paid_by_idx on public.expenses (paid_by);

-- 3) Owner money-movements that are not business costs.
create table if not exists public.owner_ledger (
  ledger_id        uuid primary key default extensions.uuid_generate_v4(),
  entry_type       text not null check (entry_type in ('funding', 'reimbursement', 'settlement')),
  entry_date       date not null default current_date,
  amount           numeric not null check (amount >= 0),
  from_user        uuid references public.users(user_id),   -- payer  (funding: owner; reimbursement: null=business; settlement: owner)
  to_user          uuid references public.users(user_id),   -- receiver (reimbursement: owner; settlement: owner)
  payment_mode     text check (payment_mode is null or payment_mode in ('cash', 'neft', 'upi', 'cheque', 'card', 'other')),
  reference_number text,
  notes            text,
  created_by       uuid references public.users(user_id),
  created_at       timestamp without time zone default now(),
  updated_at       timestamp without time zone default now(),
  is_deleted       boolean default false
);

alter table public.owner_ledger enable row level security;
drop policy if exists "owner_ledger_policy" on public.owner_ledger;
create policy "owner_ledger_policy" on public.owner_ledger
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists owner_ledger_date_idx on public.owner_ledger (entry_date);
