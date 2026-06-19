-- ============================================================================
-- Add is_deleted to the two payment tables that lacked it.
-- These are queried DIRECTLY by the Reports + Vendor-Payments screens (not only
-- via a parent), so without a flag, soft-deleting a lead/event/invoice would still
-- leak its test payments into those aggregates. Additive & idempotent; prod-safe.
-- ============================================================================

alter table public.vendor_payments  add column if not exists is_deleted boolean not null default false;
alter table public.invoice_payments add column if not exists is_deleted boolean not null default false;

create index if not exists idx_vendor_payments_isdel  on public.vendor_payments(is_deleted);
create index if not exists idx_invoice_payments_isdel on public.invoice_payments(is_deleted);
