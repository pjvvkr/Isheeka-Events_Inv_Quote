-- =====================================================================
-- v22 — Paid-cascade + event-completion enum additions
-- Run in Supabase SQL editor. Idempotent-safe to re-run.
-- Values below are the EXACT current CHECK lists from v22-db-schema.md,
-- with one new value appended to each.
-- (events.status already includes 'completed' — no change needed there.)
-- =====================================================================

-- 1) quotations.status — append 'invoiced'
--    Set automatically when an invoice tied to the quote is fully paid.
ALTER TABLE public.quotations DROP CONSTRAINT IF EXISTS quotations_status_check;
ALTER TABLE public.quotations ADD CONSTRAINT quotations_status_check
  CHECK (status IN (
    'draft','sent','approved','revision_requested','revised',
    'superseded','rejected','expired','converted','invoiced'
  ));

-- 2) leads.stage — append 'completed'
--    Set when the source event is manually marked completed (delivered).
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_stage_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_stage_check
  CHECK (stage IN (
    'new','contacted','quote_generation_in_progress','quote_sent',
    'quote_revision_pending','revised_quote_sent','quote_confirmed',
    'event_triggered','lost','completed'
  ));

-- =====================================================================
-- If either ADD CONSTRAINT fails with a check violation, some existing
-- row holds a value not in the list. Discover and add it:
--   SELECT DISTINCT status FROM public.quotations;   -- for #1
--   SELECT DISTINCT stage  FROM public.leads;        -- for #2
-- =====================================================================
