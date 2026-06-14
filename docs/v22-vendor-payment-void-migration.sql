-- Vendor payment void + audit trail (run in Supabase SQL editor before using "remove paid vendor").
-- Soft-void: voided rows stay in vendor_payments as the audit record; live sums filter is_voided=false.

ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS is_voided  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_at  timestamp without time zone,
  ADD COLUMN IF NOT EXISTS voided_by  uuid;

-- Backfill existing rows to non-voided (DEFAULT handles new rows; this is belt-and-suspenders).
UPDATE public.vendor_payments SET is_voided = false WHERE is_voided IS NULL;
