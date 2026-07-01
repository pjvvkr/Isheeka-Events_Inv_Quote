-- General ("against outstanding") payments have no installment, and the app code already
-- falls back to installment_id = null (InvoicesModule recordPayment). The NOT NULL constraint
-- was rejecting those, breaking payment recording on invoices with no installment schedule.
alter table public.invoice_payments alter column installment_id drop not null;
