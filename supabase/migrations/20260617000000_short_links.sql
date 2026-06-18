-- #1 Short-link service ───────────────────────────────────────────────────────
-- Maps a tiny code (e.g. "a3f9b2c") → a Storage object (bucket + path). The public
-- `s` edge function looks the code up with the service-role key and 302-redirects to
-- a FRESHLY-minted signed URL on every click, so the shared link is short, branded,
-- and never expires — while the underlying bucket stays private.
--
-- We store the PATH, not a signed URL, on purpose: the function re-signs on demand.
create table if not exists public.short_links (
  code        text primary key,
  bucket      text not null,
  path        text not null,
  kind        text,                          -- 'quote' | 'invoice' (informational)
  ref         text,                          -- e.g. 'Q-26-1185' (informational)
  created_at  timestamptz not null default now()
);

alter table public.short_links enable row level security;

-- The signed-in app creates short links; nobody needs row-level reads from the client
-- (the edge function reads via the service role, which bypasses RLS).
drop policy if exists "authenticated create short links" on public.short_links;
create policy "authenticated create short links"
  on public.short_links for insert to authenticated with check (true);

drop policy if exists "authenticated read short links" on public.short_links;
create policy "authenticated read short links"
  on public.short_links for select to authenticated using (true);
