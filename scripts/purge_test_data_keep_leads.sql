-- ============================================================================
-- ONE-TIME test-data purge (SOFT delete) — keep ONLY the real leads + their chains.
-- Real leads to KEEP:  L-26-1129 , L-26-1139
--
-- HOW TO RUN (Supabase Dashboard → SQL editor, against PROD):
--   0) TAKE A FULL BACKUP FIRST (Database → Backups). Do not skip.
--   1) Run PART 0 — confirm BOTH keep-leads appear (1 row each). If not, STOP.
--   2) Run PART 1 — preview: see how many rows each table WILL archive. It rolls
--      back, so nothing changes. Sanity-check the numbers.
--   3) Run PART 2 — the actual soft-delete, in a transaction that COMMITs.
-- Everything is is_deleted=true (reversible by flipping back / restoring backup).
-- Config preserved (untouched): settings, users, event_types, event_type_subevents,
-- counters, auth logins.
-- ============================================================================


-- ===== PART 0 — safety check: both real leads must exist (run alone) =========
select ref_number, lead_id, client_id, is_deleted
from public.leads
where ref_number in ('L-26-1129','L-26-1139');
-- Expect exactly 2 rows, is_deleted = false. If you see 0 or 1, STOP and tell Claude.


-- ===== PART 1 — PREVIEW (run alone; makes NO changes — ends in ROLLBACK) =====
begin;
create temp table keep_leads    on commit drop as select lead_id, client_id from public.leads where ref_number in ('L-26-1129','L-26-1139');
create temp table keep_events   on commit drop as select event_id, client_id from public.events where lead_id in (select lead_id from keep_leads);
create temp table keep_quotes   on commit drop as select quotation_id, client_id from public.quotations where lead_id in (select lead_id from keep_leads) or event_id in (select event_id from keep_events);
create temp table keep_rfqs     on commit drop as select rfq_id from public.rfqs where party_type='client' and (lead_id in (select lead_id from keep_leads) or event_id in (select event_id from keep_events) or quotation_id in (select quotation_id from keep_quotes));
insert into keep_rfqs select rfq_id from public.rfqs where party_type='vendor' and parent_rfq_id in (select rfq_id from keep_rfqs);
create temp table keep_invoices on commit drop as select invoice_id from public.invoices where event_id in (select event_id from keep_events) or quotation_id in (select quotation_id from keep_quotes);
create temp table keep_clients  on commit drop as
  select distinct client_id from (
    select client_id from keep_leads  where client_id is not null
    union select client_id from keep_events where client_id is not null
    union select client_id from keep_quotes where client_id is not null
    union select client_id from public.invoices where invoice_id in (select invoice_id from keep_invoices) and client_id is not null
  ) k;
create temp table keep_vendors  on commit drop as select distinct vendor_id from public.event_vendors where event_id in (select event_id from keep_events) and vendor_id is not null;

select 'KEEP set' as info,
  (select count(*) from keep_leads) leads,(select count(*) from keep_clients) clients,
  (select count(*) from keep_rfqs) rfqs,(select count(*) from keep_quotes) quotes,
  (select count(*) from keep_events) events,(select count(*) from keep_invoices) invoices,
  (select count(*) from keep_vendors) vendors;

select 'leads'                tbl, count(*) will_archive from public.leads                where is_deleted=false and lead_id      not in (select lead_id from keep_leads)
union all select 'clients',            count(*) from public.clients              where is_deleted=false and client_id    not in (select client_id from keep_clients)
union all select 'rfqs',               count(*) from public.rfqs                 where is_deleted=false and rfq_id        not in (select rfq_id from keep_rfqs)
union all select 'rfq_items',          count(*) from public.rfq_items            where is_deleted=false and rfq_id        not in (select rfq_id from keep_rfqs)
union all select 'quotations',         count(*) from public.quotations           where is_deleted=false and quotation_id  not in (select quotation_id from keep_quotes)
union all select 'quotation_line_items',count(*) from public.quotation_line_items where is_deleted=false and quotation_id  not in (select quotation_id from keep_quotes)
union all select 'events',             count(*) from public.events               where is_deleted=false and event_id      not in (select event_id from keep_events)
union all select 'sub_events',         count(*) from public.sub_events           where is_deleted=false and event_id      not in (select event_id from keep_events)
union all select 'sub_event_items',    count(*) from public.sub_event_items      where is_deleted=false and event_id      not in (select event_id from keep_events)
union all select 'event_vendors',      count(*) from public.event_vendors        where is_deleted=false and event_id      not in (select event_id from keep_events)
union all select 'expenses',           count(*) from public.expenses             where is_deleted=false and event_id      not in (select event_id from keep_events)
union all select 'vendor_payments',    count(*) from public.vendor_payments      where is_deleted=false and event_id      not in (select event_id from keep_events)
union all select 'invoices',           count(*) from public.invoices             where is_deleted=false and invoice_id    not in (select invoice_id from keep_invoices)
union all select 'invoice_line_items', count(*) from public.invoice_line_items   where is_deleted=false and invoice_id    not in (select invoice_id from keep_invoices)
union all select 'invoice_installments',count(*) from public.invoice_installments where is_deleted=false and invoice_id    not in (select invoice_id from keep_invoices)
union all select 'invoice_payments',   count(*) from public.invoice_payments     where is_deleted=false and invoice_id    not in (select invoice_id from keep_invoices)
union all select 'costing_summaries',  count(*) from public.costing_summaries    where is_deleted=false and not (client_rfq_id in (select rfq_id from keep_rfqs) or quotation_id in (select quotation_id from keep_quotes) or event_id in (select event_id from keep_events))
union all select 'alternative_contacts',count(*) from public.alternative_contacts where is_deleted=false and client_id    not in (select client_id from keep_clients)
union all select 'vendors',            count(*) from public.vendors              where is_deleted=false and vendor_id     not in (select vendor_id from keep_vendors);
rollback;


-- ===== PART 2 — PURGE (run after PART 1 looks right; COMMITs the changes) =====
begin;
create temp table keep_leads    on commit drop as select lead_id, client_id from public.leads where ref_number in ('L-26-1129','L-26-1139');
create temp table keep_events   on commit drop as select event_id, client_id from public.events where lead_id in (select lead_id from keep_leads);
create temp table keep_quotes   on commit drop as select quotation_id, client_id from public.quotations where lead_id in (select lead_id from keep_leads) or event_id in (select event_id from keep_events);
create temp table keep_rfqs     on commit drop as select rfq_id from public.rfqs where party_type='client' and (lead_id in (select lead_id from keep_leads) or event_id in (select event_id from keep_events) or quotation_id in (select quotation_id from keep_quotes));
insert into keep_rfqs select rfq_id from public.rfqs where party_type='vendor' and parent_rfq_id in (select rfq_id from keep_rfqs);
create temp table keep_invoices on commit drop as select invoice_id from public.invoices where event_id in (select event_id from keep_events) or quotation_id in (select quotation_id from keep_quotes);
create temp table keep_clients  on commit drop as
  select distinct client_id from (
    select client_id from keep_leads  where client_id is not null
    union select client_id from keep_events where client_id is not null
    union select client_id from keep_quotes where client_id is not null
    union select client_id from public.invoices where invoice_id in (select invoice_id from keep_invoices) and client_id is not null
  ) k;
create temp table keep_vendors  on commit drop as select distinct vendor_id from public.event_vendors where event_id in (select event_id from keep_events) and vendor_id is not null;

-- abort if the keep-leads weren't found (prevents wiping everything by mistake)
do $$ begin if (select count(*) from keep_leads) <> 2 then raise exception 'Expected 2 keep-leads, found %, aborting.', (select count(*) from keep_leads); end if; end $$;

update public.sub_event_items      set is_deleted=true where is_deleted=false and event_id      not in (select event_id from keep_events);
update public.sub_events            set is_deleted=true where is_deleted=false and event_id      not in (select event_id from keep_events);
update public.event_vendors         set is_deleted=true where is_deleted=false and event_id      not in (select event_id from keep_events);
update public.expenses              set is_deleted=true where is_deleted=false and event_id      not in (select event_id from keep_events);
update public.vendor_payments       set is_deleted=true where is_deleted=false and event_id      not in (select event_id from keep_events);
update public.quotation_line_items  set is_deleted=true where is_deleted=false and quotation_id  not in (select quotation_id from keep_quotes);
update public.invoice_line_items    set is_deleted=true where is_deleted=false and invoice_id    not in (select invoice_id from keep_invoices);
update public.invoice_installments  set is_deleted=true where is_deleted=false and invoice_id    not in (select invoice_id from keep_invoices);
update public.invoice_payments      set is_deleted=true where is_deleted=false and invoice_id    not in (select invoice_id from keep_invoices);
update public.rfq_items             set is_deleted=true where is_deleted=false and rfq_id        not in (select rfq_id from keep_rfqs);
update public.costing_summaries     set is_deleted=true where is_deleted=false and not (client_rfq_id in (select rfq_id from keep_rfqs) or quotation_id in (select quotation_id from keep_quotes) or event_id in (select event_id from keep_events));
update public.rfqs                  set is_deleted=true where is_deleted=false and rfq_id        not in (select rfq_id from keep_rfqs);
update public.quotations            set is_deleted=true where is_deleted=false and quotation_id  not in (select quotation_id from keep_quotes);
update public.invoices              set is_deleted=true where is_deleted=false and invoice_id    not in (select invoice_id from keep_invoices);
update public.events                set is_deleted=true where is_deleted=false and event_id      not in (select event_id from keep_events);
update public.alternative_contacts  set is_deleted=true where is_deleted=false and client_id     not in (select client_id from keep_clients);
update public.clients               set is_deleted=true where is_deleted=false and client_id     not in (select client_id from keep_clients);
update public.vendors               set is_deleted=true where is_deleted=false and vendor_id     not in (select vendor_id from keep_vendors);
update public.leads                 set is_deleted=true where is_deleted=false and lead_id       not in (select lead_id from keep_leads);
commit;
