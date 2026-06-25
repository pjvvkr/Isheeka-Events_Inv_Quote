-- Clients master data: staff/managers may VIEW + ADD, but only admins/owners may
-- EDIT or DELETE existing client records (and their alternative contacts).
-- Replaces the single clients_write / alternative_contacts_write policy with a split:
-- INSERT gated by the clients module; UPDATE/DELETE gated to admins/owners (app_full()).
-- (SELECT stays open via the existing *_read policies. Soft-delete is an UPDATE of
-- is_deleted, so it's covered by the UPDATE gate.)

drop policy if exists clients_write on public.clients;
drop policy if exists alternative_contacts_write on public.alternative_contacts;

create policy clients_insert on public.clients for insert to authenticated
  with check (public.app_can('clients'));
create policy clients_update on public.clients for update to authenticated
  using (public.app_full()) with check (public.app_full());
create policy clients_delete on public.clients for delete to authenticated
  using (public.app_full());

create policy alternative_contacts_insert on public.alternative_contacts for insert to authenticated
  with check (public.app_can('clients'));
create policy alternative_contacts_update on public.alternative_contacts for update to authenticated
  using (public.app_full()) with check (public.app_full());
create policy alternative_contacts_delete on public.alternative_contacts for delete to authenticated
  using (public.app_full());
