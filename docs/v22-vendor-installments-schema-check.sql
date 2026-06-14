-- Vendor installments / overdue feature — schema check (run in Supabase SQL editor, paste output back).
-- Goal: confirm vendor_installments can carry a due date + label + percentage like invoice_installments.

-- 1) Columns + nullability + defaults on vendor_installments
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='vendor_installments'
ORDER BY ordinal_position;

-- 2) For comparison: invoice_installments columns (the schedule shape we want to mirror)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='invoice_installments'
ORDER BY ordinal_position;

-- 3) status CHECK enum on vendor_installments (confirm 'overdue' is allowed)
SELECT cc.constraint_name, cc.check_clause
FROM information_schema.check_constraints cc
JOIN information_schema.constraint_table_usage tc ON tc.constraint_name=cc.constraint_name
WHERE tc.table_schema='public' AND tc.table_name='vendor_installments';

-- If the output of (1) is MISSING due_date / label / percentage / when_text, this small
-- non-breaking migration adds them (all nullable, no data change):
--
--   ALTER TABLE public.vendor_installments
--     ADD COLUMN IF NOT EXISTS due_date date,
--     ADD COLUMN IF NOT EXISTS label text,
--     ADD COLUMN IF NOT EXISTS when_text text,
--     ADD COLUMN IF NOT EXISTS percentage numeric;
--
-- (Do NOT run the ALTER yet — paste the SELECT output first so we add only what's missing.)
