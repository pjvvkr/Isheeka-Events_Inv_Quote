-- Proof attachment (screenshot / file URL) on owner-ledger entries. Additive.
alter table public.owner_ledger add column if not exists attachment_url text;
