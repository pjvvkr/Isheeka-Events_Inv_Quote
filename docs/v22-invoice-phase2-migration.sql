-- Isheeka ERP v22 — Invoice Phase 2 migration (REVISED to match existing tables)
-- The invoice_* tables already existed in the original schema with different column
-- names than first assumed (verified 13 Jun 2026 via information_schema). This script
-- only ADDS the missing columns + policies + indexes. Idempotent (safe to re-run).
--
-- Existing structure (for reference):
--   invoices            : has client_id, client_name, event_name, total_received,
--                         total_outstanding, gst_*, discount_amount, tax_amount, due_date.
--   invoice_line_items  : line_item_id, invoice_id, sub_event_id, sub_event_name,
--                         description(NOT NULL), quantity, unit_price, amount, sort_order.
--   invoice_installments: installment_id, invoice_id, installment_number, percentage,
--                         amount_due, amount_paid, balance, due_date, status.
--   invoice_payments    : payment_id, invoice_id, installment_id(NOT NULL), amount,
--                         payment_date, payment_mode, reference_number, notes, recorded_by.

-- A) invoices: add the two columns the new flow needs (others already exist)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS revision_number    integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_quote_total numeric DEFAULT 0;

-- B) invoice_line_items: add soft-delete flag
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;

-- C) invoice_installments: carry the quote's schedule labels + soft-delete
ALTER TABLE invoice_installments
  ADD COLUMN IF NOT EXISTS label      text,
  ADD COLUMN IF NOT EXISTS when_text  text,
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;

-- D) RLS — ensure an authenticated policy exists (idempotent; matches the rest of the app)
ALTER TABLE invoice_line_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_line_items_all   ON invoice_line_items;
DROP POLICY IF EXISTS invoice_installments_all ON invoice_installments;
DROP POLICY IF EXISTS invoice_payments_all     ON invoice_payments;

CREATE POLICY invoice_line_items_all   ON invoice_line_items   FOR ALL TO public USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY invoice_installments_all ON invoice_installments FOR ALL TO public USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY invoice_payments_all     ON invoice_payments     FOR ALL TO public USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- E) Indexes
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice   ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_installments_invoice ON invoice_installments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_installments_due     ON invoice_installments(due_date);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice     ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_event               ON invoices(event_id);

-- Verify:
--   select column_name from information_schema.columns where table_name='invoices' order by 1;
--   (should now include revision_number, source_quote_total)
