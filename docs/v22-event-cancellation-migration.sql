-- Event cancellation — audit columns (run before using Cancel event).
-- events.status already supports 'cancelled'; this just adds the audit trail.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid;

-- Cancellation cascade is handled app-side:
--   * unpaid invoices for the event -> status='cancelled'
--   * paid/partly-paid invoices -> status='cancelled' but kept; collected amount flagged for refund
--   * unpaid vendor installments -> deleted; partly-paid kept with due_date cleared (no overdue noise)
--   * vendor payments + expenses -> kept (sunk cost, shown in Reports)
-- No other schema changes needed (invoices.status already allows 'cancelled').
