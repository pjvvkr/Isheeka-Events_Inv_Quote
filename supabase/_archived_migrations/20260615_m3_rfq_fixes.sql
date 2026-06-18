-- ============================================================================
-- Isheeka ERP — M3 CP3 fixes
-- (1) Allow 'rfq' as a counters type so RFQ ref numbers can be generated.
-- (2) Add first/last name to rfqs (for clean client creation on approval).
-- Additive & safe. Run once in the Supabase SQL Editor.
-- ============================================================================

-- (1) extend the counters type check to include 'rfq'
ALTER TABLE counters DROP CONSTRAINT IF EXISTS counters_type_check;
ALTER TABLE counters ADD CONSTRAINT counters_type_check
  CHECK (type = ANY (ARRAY['quotation','invoice','lead','client','event','rfq']));

-- (2) client first/last name on the RFQ
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS contact_first_name text,
  ADD COLUMN IF NOT EXISTS contact_last_name  text;
