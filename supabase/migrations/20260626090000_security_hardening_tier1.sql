-- Tier 1 security hardening — APPLIED to prod 2026-06-26 via MCP apply_migration.
-- Pure hardening: no change to how staff read/write data in the app.
-- The public RFQ portal talks ONLY to the rfq-gateway edge function (service_role),
-- never to tables directly as anon, so removing anon's table/function access is safe.

-- 1) Remove anon's broad table/sequence/function access (latent leak path; unused).
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
grant execute on function public.app_can(text), public.app_full(), public.app_is_admin(),
  public.app_is_owner(), public.app_uid() to authenticated;

-- 2) OTP table is gateway-internal (service_role bypasses RLS). Drop the
--    "any authenticated user, always true" policy so staff tokens can't touch OTPs.
drop policy if exists rfq_otp_auth_all on public.rfq_otp;

-- 3) Pin search_path on the flagged functions (prevents search_path hijacking).
alter function public.next_counter(text, text, integer)   set search_path = public, pg_temp;
alter function public.touch_rfqs_updated_at()             set search_path = public, pg_temp;
alter function public.archive_lead_chain(text)            set search_path = public, pg_temp;
alter function public.unarchive_lead_chain(text)          set search_path = public, pg_temp;
