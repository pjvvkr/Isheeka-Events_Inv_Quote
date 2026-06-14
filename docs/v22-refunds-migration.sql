-- Refunds & reversals — add is_refund to both payment ledgers (run before using refunds).
-- A refund is stored as a negative-amount row tagged is_refund=true, so sum(amount) nets it
-- automatically (collected / cost). Originals stay intact for audit.

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS is_refund boolean DEFAULT false;

ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS is_refund boolean DEFAULT false;

UPDATE public.invoice_payments SET is_refund = false WHERE is_refund IS NULL;
UPDATE public.vendor_payments  SET is_refund = false WHERE is_refund IS NULL;
