-- Web Push subscriptions (Phase 2). One row per device/browser per user.
create table if not exists public.push_subscriptions (
  subscription_id uuid primary key default extensions.uuid_generate_v4(),
  user_id         uuid references public.users(user_id),
  endpoint        text not null,
  subscription    jsonb not null,
  user_agent      text,
  created_at      timestamptz default now(),
  is_deleted      boolean default false
);
create unique index if not exists push_subscriptions_endpoint_key on public.push_subscriptions (endpoint);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_policy" on public.push_subscriptions;
create policy "push_subscriptions_policy" on public.push_subscriptions
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
