-- Step 0 — verify live schema for Expenses / Vendors / Vendor payments before building.
-- Run in Supabase SQL editor and paste the output back.

-- 1) Columns + nullability + defaults
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('expenses','vendors','event_vendors','vendor_payments','vendor_installments')
ORDER BY table_name, ordinal_position;

-- 2) CHECK constraints (enums) on those tables
SELECT tc.table_name, cc.constraint_name, cc.check_clause
FROM information_schema.check_constraints cc
JOIN information_schema.constraint_table_usage tc ON tc.constraint_name=cc.constraint_name
WHERE tc.table_schema='public'
  AND tc.table_name IN ('expenses','vendors','event_vendors','vendor_payments','vendor_installments')
ORDER BY tc.table_name;

-- 3) Foreign keys (esp. vendor_payments.installment_id → vendor_installments?)
SELECT tc.table_name, kcu.column_name, ccu.table_name AS references_table, ccu.column_name AS references_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
  AND tc.table_name IN ('expenses','vendors','event_vendors','vendor_payments','vendor_installments')
ORDER BY tc.table_name, kcu.column_name;
