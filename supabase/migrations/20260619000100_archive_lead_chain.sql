-- ============================================================================
-- Reusable cascade SOFT-DELETE (and restore) of a lead and everything attached.
--   archive_lead_chain(lead_ref)   → hides the lead + its RFQs (client+vendor),
--     quotes, events, invoices, costing, expenses, line items, installments and
--     payments by setting is_deleted=true. Safe & reversible.
--   unarchive_lead_chain(lead_ref) → flips the same chain back.
-- Guards: the CLIENT is archived only if no other still-active lead/event/quote/
-- invoice references it; the VENDOR master is never touched (only the event's
-- vendor engagements/payments). Audit tables without is_deleted are left alone —
-- they are only ever reached through a parent that is now hidden.
-- Returns a jsonb summary of the chain size.
-- ============================================================================

create or replace function public.archive_lead_chain(p_lead_ref text)
returns jsonb language plpgsql as $$
declare
  v_lead uuid; v_client uuid;
  v_events uuid[]; v_quotes uuid[]; v_rfqs uuid[]; v_invoices uuid[];
  v_client_archived boolean := false;
begin
  select lead_id, client_id into v_lead, v_client
    from public.leads where ref_number = p_lead_ref and is_deleted = false
    order by created_at limit 1;
  if v_lead is null then
    return jsonb_build_object('ok', false, 'error', 'lead_not_found_or_already_archived', 'ref', p_lead_ref);
  end if;

  select coalesce(array_agg(event_id), '{}') into v_events from public.events where lead_id = v_lead and is_deleted = false;
  select coalesce(array_agg(quotation_id), '{}') into v_quotes from public.quotations
    where is_deleted = false and (lead_id = v_lead or event_id = any(v_events));
  select coalesce(array_agg(rfq_id), '{}') into v_rfqs from public.rfqs
    where is_deleted = false and party_type = 'client'
      and (lead_id = v_lead or event_id = any(v_events) or quotation_id = any(v_quotes));
  v_rfqs := v_rfqs || coalesce((select array_agg(rfq_id) from public.rfqs
    where is_deleted = false and party_type = 'vendor' and parent_rfq_id = any(v_rfqs)), '{}');
  select coalesce(array_agg(invoice_id), '{}') into v_invoices from public.invoices
    where is_deleted = false and (event_id = any(v_events) or quotation_id = any(v_quotes));

  -- soft-delete (UPDATE order is irrelevant — no FK violations on a flag flip)
  update public.sub_event_items     set is_deleted=true where event_id   = any(v_events)   and is_deleted=false;
  update public.sub_events           set is_deleted=true where event_id   = any(v_events)   and is_deleted=false;
  update public.event_vendors        set is_deleted=true where event_id   = any(v_events)   and is_deleted=false;
  update public.expenses             set is_deleted=true where event_id   = any(v_events)   and is_deleted=false;
  update public.vendor_payments      set is_deleted=true where event_id   = any(v_events)   and is_deleted=false;
  update public.quotation_line_items set is_deleted=true where quotation_id = any(v_quotes) and is_deleted=false;
  update public.invoice_line_items   set is_deleted=true where invoice_id  = any(v_invoices) and is_deleted=false;
  update public.invoice_installments set is_deleted=true where invoice_id  = any(v_invoices) and is_deleted=false;
  update public.invoice_payments     set is_deleted=true where invoice_id  = any(v_invoices) and is_deleted=false;
  update public.rfq_items            set is_deleted=true where rfq_id      = any(v_rfqs)    and is_deleted=false;
  update public.costing_summaries    set is_deleted=true
     where is_deleted=false and (client_rfq_id = any(v_rfqs) or quotation_id = any(v_quotes) or event_id = any(v_events));
  update public.rfqs                 set is_deleted=true where rfq_id      = any(v_rfqs)    and is_deleted=false;
  update public.quotations           set is_deleted=true where quotation_id = any(v_quotes) and is_deleted=false;
  update public.invoices             set is_deleted=true where invoice_id  = any(v_invoices) and is_deleted=false;
  update public.events               set is_deleted=true where event_id    = any(v_events)  and is_deleted=false;
  update public.leads                set is_deleted=true where lead_id      = v_lead;

  -- client: archive only if nothing else still-active references it
  if v_client is not null
     and not exists (select 1 from public.leads      where client_id=v_client and is_deleted=false)
     and not exists (select 1 from public.events     where client_id=v_client and is_deleted=false)
     and not exists (select 1 from public.quotations where client_id=v_client and is_deleted=false)
     and not exists (select 1 from public.invoices   where client_id=v_client and is_deleted=false) then
     update public.clients              set is_deleted=true where client_id=v_client;
     update public.alternative_contacts set is_deleted=true where client_id=v_client and is_deleted=false;
     v_client_archived := true;
  end if;

  return jsonb_build_object('ok', true, 'lead_ref', p_lead_ref,
    'events', coalesce(array_length(v_events,1),0), 'quotations', coalesce(array_length(v_quotes,1),0),
    'rfqs', coalesce(array_length(v_rfqs,1),0), 'invoices', coalesce(array_length(v_invoices,1),0),
    'client_archived', v_client_archived);
end; $$;

create or replace function public.unarchive_lead_chain(p_lead_ref text)
returns jsonb language plpgsql as $$
declare
  v_lead uuid; v_client uuid;
  v_events uuid[]; v_quotes uuid[]; v_rfqs uuid[]; v_invoices uuid[];
begin
  select lead_id, client_id into v_lead, v_client
    from public.leads where ref_number = p_lead_ref order by created_at limit 1;
  if v_lead is null then return jsonb_build_object('ok', false, 'error', 'lead_not_found', 'ref', p_lead_ref); end if;

  select coalesce(array_agg(event_id), '{}') into v_events from public.events where lead_id = v_lead;
  select coalesce(array_agg(quotation_id), '{}') into v_quotes from public.quotations
    where lead_id = v_lead or event_id = any(v_events);
  select coalesce(array_agg(rfq_id), '{}') into v_rfqs from public.rfqs
    where party_type = 'client' and (lead_id = v_lead or event_id = any(v_events) or quotation_id = any(v_quotes));
  v_rfqs := v_rfqs || coalesce((select array_agg(rfq_id) from public.rfqs
    where party_type = 'vendor' and parent_rfq_id = any(v_rfqs)), '{}');
  select coalesce(array_agg(invoice_id), '{}') into v_invoices from public.invoices
    where event_id = any(v_events) or quotation_id = any(v_quotes);

  update public.sub_event_items     set is_deleted=false where event_id   = any(v_events);
  update public.sub_events           set is_deleted=false where event_id   = any(v_events);
  update public.event_vendors        set is_deleted=false where event_id   = any(v_events);
  update public.expenses             set is_deleted=false where event_id   = any(v_events);
  update public.vendor_payments      set is_deleted=false where event_id   = any(v_events);
  update public.quotation_line_items set is_deleted=false where quotation_id = any(v_quotes);
  update public.invoice_line_items   set is_deleted=false where invoice_id  = any(v_invoices);
  update public.invoice_installments set is_deleted=false where invoice_id  = any(v_invoices);
  update public.invoice_payments     set is_deleted=false where invoice_id  = any(v_invoices);
  update public.rfq_items            set is_deleted=false where rfq_id      = any(v_rfqs);
  update public.costing_summaries    set is_deleted=false
     where client_rfq_id = any(v_rfqs) or quotation_id = any(v_quotes) or event_id = any(v_events);
  update public.rfqs                 set is_deleted=false where rfq_id      = any(v_rfqs);
  update public.quotations           set is_deleted=false where quotation_id = any(v_quotes);
  update public.invoices             set is_deleted=false where invoice_id  = any(v_invoices);
  update public.events               set is_deleted=false where event_id    = any(v_events);
  update public.leads                set is_deleted=false where lead_id      = v_lead;
  if v_client is not null then
     update public.clients              set is_deleted=false where client_id=v_client;
     update public.alternative_contacts set is_deleted=false where client_id=v_client;
  end if;

  return jsonb_build_object('ok', true, 'lead_ref', p_lead_ref, 'restored', true);
end; $$;

grant execute on function public.archive_lead_chain(text)   to authenticated;
grant execute on function public.unarchive_lead_chain(text) to authenticated;
