-- Local test seed — runs on `supabase start` / `supabase db reset`.
-- THROWAWAY local DB only; never touches production.
-- Kept deliberately minimal + all-nullable so `supabase start` can't fail on it.
-- (The flow tests create their own leads/quotes/invoices; the login user is created
--  in Studio. We'll add storage buckets + sample data here as the tests need them.)

insert into public.settings (company_name, phone_1, email, website)
values ('Isheeka Events (LOCAL)', '+91 78423 95867', 'isheekaevents@gmail.com', 'www.isheekaevents.com');

-- Private 'quotations' bucket so the share flow (PDF upload + short link) works LOCALLY.
-- Prod already has this bucket; this only seeds the throwaway local DB.
insert into storage.buckets (id, name, public)
values ('quotations', 'quotations', false)
on conflict (id) do nothing;

-- Local-only: let the signed-in app read/write the quotations bucket.
drop policy if exists "local quotations rw" on storage.objects;
create policy "local quotations rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'quotations') with check (bucket_id = 'quotations');
