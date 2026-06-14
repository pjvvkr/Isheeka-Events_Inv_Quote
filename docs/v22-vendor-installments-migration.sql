-- Vendor installments — add label + when_text (parity with invoice_installments).
-- vendor_installments already has: percentage, amount_due, amount_paid, balance, due_date, status.
-- Missing only the descriptive columns. Both nullable → non-breaking, no data change.

ALTER TABLE public.vendor_installments
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS when_text text;

-- Overdue is computed in the app (due_date < today AND balance > 0 AND not paid),
-- mirroring how invoice overdue works — so no change to the status CHECK enum is needed.
