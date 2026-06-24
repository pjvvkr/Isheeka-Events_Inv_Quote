-- ============================================================================
-- Reference IDs for expenses + owner-ledger entries, and per-expense reimbursement.
--   expenses.expense_no       Ex-YY-####   (backfilled in creation order)
--   owner_ledger.entry_no     Fn/Rb/St-YY-####
--   owner_ledger.expense_id   links a reimbursement to the expense it covers
-- Counters reuse the atomic next_counter() RPC (seed 1111), so app-issued IDs
-- continue right after the backfill. Additive & idempotent.
-- ============================================================================

-- 1) Allow the new counter types.
alter table public.counters drop constraint if exists counters_type_check;
alter table public.counters add constraint counters_type_check
  check (type = any (array['quotation', 'invoice', 'lead', 'client', 'event', 'rfq',
                           'expense', 'owner_funding', 'owner_reimbursement', 'owner_settlement']));

-- 2) New columns.
alter table public.expenses add column if not exists expense_no text;
alter table public.owner_ledger add column if not exists entry_no text;
alter table public.owner_ledger add column if not exists expense_id uuid references public.expenses(expense_id);
create index if not exists owner_ledger_expense_id_idx on public.owner_ledger (expense_id);

-- 3) Backfill expense_no per creation-year, oldest first.
with ranked as (
  select expense_id,
         to_char(coalesce(created_at, date::timestamp), 'YY') as yy,
         row_number() over (partition by to_char(coalesce(created_at, date::timestamp), 'YY')
                            order by coalesce(created_at, date::timestamp), expense_id) as rn
  from public.expenses where expense_no is null
)
update public.expenses e set expense_no = 'Ex-' || r.yy || '-' || (1110 + r.rn)::text
from ranked r where e.expense_id = r.expense_id;

insert into public.counters (type, year, current_value, updated_at)
select 'expense', yy, 1110 + cnt, now()
from (select to_char(coalesce(created_at, date::timestamp), 'YY') as yy, count(*) cnt from public.expenses group by 1) s
on conflict (type, year) do update set current_value = greatest(counters.current_value, excluded.current_value), updated_at = now();

-- 4) Backfill owner_ledger entry_no per type per year.
with ranked as (
  select ledger_id, entry_type,
         to_char(coalesce(created_at, entry_date::timestamp), 'YY') as yy,
         row_number() over (partition by entry_type, to_char(coalesce(created_at, entry_date::timestamp), 'YY')
                            order by coalesce(created_at, entry_date::timestamp), ledger_id) as rn
  from public.owner_ledger where entry_no is null
)
update public.owner_ledger l set entry_no =
  (case r.entry_type when 'funding' then 'Fn-' when 'reimbursement' then 'Rb-' when 'settlement' then 'St-' else 'Ol-' end)
  || r.yy || '-' || (1110 + r.rn)::text
from ranked r where l.ledger_id = r.ledger_id;

insert into public.counters (type, year, current_value, updated_at)
select 'owner_' || entry_type, yy, 1110 + cnt, now()
from (select entry_type, to_char(coalesce(created_at, entry_date::timestamp), 'YY') as yy, count(*) cnt
      from public.owner_ledger group by 1, 2) s
on conflict (type, year) do update set current_value = greatest(counters.current_value, excluded.current_value), updated_at = now();

-- 5) Uniqueness.
create unique index if not exists expenses_expense_no_key on public.expenses (expense_no) where expense_no is not null;
create unique index if not exists owner_ledger_entry_no_key on public.owner_ledger (entry_no) where entry_no is not null;
