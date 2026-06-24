-- ============================================================================
-- Second notification email on the company profile. Submission alerts (client RFQ
-- submitted / vendor bid submitted) go to settings.email AND settings.notify_email_2
-- (if set). Additive & idempotent; prod-safe.
-- ============================================================================

alter table public.settings add column if not exists notify_email_2 text;
