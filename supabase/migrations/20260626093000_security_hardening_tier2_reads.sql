-- Tier 2 security hardening — READ gating.  *** NOT YET APPLIED — TEST FIRST ***
--
-- WHAT IT DOES: today every logged-in user can READ every business table (all
-- *_read policies are USING(true)). Your WRITE policies are already role-aware via
-- app_can()/app_is_owner(). This aligns READS with the same module_access model, so
-- a staffer who can't open a module also can't read its rows via the API/dev-tools.
--
-- WHO IS AFFECTED: only users with a NON-null module_access that has a module turned
-- OFF. (app_can() returns true when module_access is null, and admins/owners always
-- pass.) So full-access staff, admins and the owner see no change.
--
-- ⚠ CROSS-MODULE CAUTION: some screens read a second module's tables (e.g. the costing
-- screen reads vendors; an event screen may read invoices). After applying, log in as
-- each RESTRICTED staff member and click through their screens. If something shows
-- blank, either grant that module in Settings → Access, or relax that table below.
--
-- Apply with: Supabase → SQL editor (paste), or ask Claude to run it.
-- Rollback: re-create any *_read policy as  USING (true).

-- ── Margins / costing (crown jewels) ─────────────────────────────────────────
drop policy if exists costing_summaries_read on public.costing_summaries;
create policy costing_summaries_read on public.costing_summaries for select to authenticated
  using (app_can('rfqs') or app_can('vendor-rfqs'));

-- ── Vendor costs & payments ──────────────────────────────────────────────────
drop policy if exists vendor_payments_read on public.vendor_payments;
create policy vendor_payments_read on public.vendor_payments for select to authenticated
  using (app_can('vendor-payments'));
drop policy if exists vendor_installments_read on public.vendor_installments;
create policy vendor_installments_read on public.vendor_installments for select to authenticated
  using (app_can('vendor-payments'));
drop policy if exists vendors_read on public.vendors;
create policy vendors_read on public.vendors for select to authenticated
  using (app_can('vendors') or app_can('vendor-rfqs') or app_can('vendor-payments'));

-- ── Client money: invoices & payments ────────────────────────────────────────
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated using (app_can('invoices'));
drop policy if exists invoice_line_items_read on public.invoice_line_items;
create policy invoice_line_items_read on public.invoice_line_items for select to authenticated using (app_can('invoices'));
drop policy if exists invoice_payments_read on public.invoice_payments;
create policy invoice_payments_read on public.invoice_payments for select to authenticated using (app_can('invoices'));
drop policy if exists invoice_installments_read on public.invoice_installments;
create policy invoice_installments_read on public.invoice_installments for select to authenticated using (app_can('invoices'));
drop policy if exists invoice_activity_log_read on public.invoice_activity_log;
create policy invoice_activity_log_read on public.invoice_activity_log for select to authenticated using (app_can('invoices'));

-- ── Client PII ───────────────────────────────────────────────────────────────
drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated using (app_can('clients'));
drop policy if exists alternative_contacts_read on public.alternative_contacts;
create policy alternative_contacts_read on public.alternative_contacts for select to authenticated using (app_can('clients'));

-- ── Leads ────────────────────────────────────────────────────────────────────
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select to authenticated using (app_can('leads'));
drop policy if exists lead_sub_events_read on public.lead_sub_events;
create policy lead_sub_events_read on public.lead_sub_events for select to authenticated using (app_can('leads'));

-- ── Quotations ───────────────────────────────────────────────────────────────
drop policy if exists quotations_read on public.quotations;
create policy quotations_read on public.quotations for select to authenticated using (app_can('quotations'));
drop policy if exists quotation_line_items_read on public.quotation_line_items;
create policy quotation_line_items_read on public.quotation_line_items for select to authenticated using (app_can('quotations'));
drop policy if exists quotation_activity_log_read on public.quotation_activity_log;
create policy quotation_activity_log_read on public.quotation_activity_log for select to authenticated using (app_can('quotations'));

-- ── RFQs ─────────────────────────────────────────────────────────────────────
drop policy if exists rfqs_read on public.rfqs;
create policy rfqs_read on public.rfqs for select to authenticated using (app_can('rfqs') or app_can('vendor-rfqs'));
drop policy if exists rfq_items_read on public.rfq_items;
create policy rfq_items_read on public.rfq_items for select to authenticated using (app_can('rfqs') or app_can('vendor-rfqs'));
drop policy if exists rfq_activity_read on public.rfq_activity;
create policy rfq_activity_read on public.rfq_activity for select to authenticated using (app_can('rfqs') or app_can('vendor-rfqs'));

-- ── Events ───────────────────────────────────────────────────────────────────
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated using (app_can('events'));
drop policy if exists sub_events_read on public.sub_events;
create policy sub_events_read on public.sub_events for select to authenticated using (app_can('events'));
drop policy if exists sub_event_items_read on public.sub_event_items;
create policy sub_event_items_read on public.sub_event_items for select to authenticated using (app_can('events'));
drop policy if exists event_vendors_read on public.event_vendors;
create policy event_vendors_read on public.event_vendors for select to authenticated using (app_can('events'));
drop policy if exists event_checklists_read on public.event_checklists;
create policy event_checklists_read on public.event_checklists for select to authenticated using (app_can('events'));

-- ── Expenses ─────────────────────────────────────────────────────────────────
drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses for select to authenticated using (app_can('expenses'));

-- NOTE: users/settings/reference tables (event_types, lead_sources, templates) are
-- intentionally left readable — staff dropdowns and quote/invoice PDFs need them.
