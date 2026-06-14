-- Diagnose the 400 when recording a vendor refund. Two likely causes — this checks both.

-- A) Is the is_refund column present? (If the refunds migration wasn't run, the insert with
--    is_refund:true fails → 400.)  Expect a row for each table.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema='public' AND column_name='is_refund'
  AND table_name IN ('vendor_payments','invoice_payments');

-- B) Does vendor_payments.amount (or invoice_payments.amount) have a CHECK that forbids negatives?
--    Refunds are stored as a NEGATIVE amount row; a "amount > 0" check would reject them → 400.
SELECT tc.table_name, cc.constraint_name, cc.check_clause
FROM information_schema.check_constraints cc
JOIN information_schema.constraint_table_usage tc ON tc.constraint_name = cc.constraint_name
WHERE tc.table_schema='public'
  AND tc.table_name IN ('vendor_payments','invoice_payments')
ORDER BY tc.table_name;

-- If (A) returns NO rows for vendor_payments → run docs/v22-refunds-migration.sql (it adds is_refund).
-- If (B) shows a check like (amount > 0) → that's the cause; paste it back and I'll switch the refund
--    storage to a positive amount + is_refund flag (and subtract it in the rollups) instead of a negative row.
