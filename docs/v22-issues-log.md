# Isheeka ERP v22 — Issues Log

Running log of issues found during testing. Status: **OPEN** (awaiting fix approval) / **FIXED** / **WONTFIX**.
No fix is applied without explicit approval.

---

## P1-8 · RLS / security assessment
**Status:** ASSESSED + main hole CLOSED — 12 Jun 2026.
**Findings:**
- RLS is **enabled on all 28 tables**. Anon key alone cannot access data.
- Every table policy = `ALL` for `{public}` with `qual: auth.role() = 'authenticated'` → only logged-in users can read/write. (Anonymous sign-ins also OFF, email confirm ON.)
- **Exposure found:** "Allow new users to sign up" was **ON** → any stranger could self-register and, because the policy trusts *any* authenticated user, gain full data access.
**Fix applied:** disabled "Allow new users to sign up" in Supabase → Authentication → Sign In / Providers → User Signups (saved 12 Jun 2026). New staff accounts now created via Supabase dashboard (Authentication → Users → Add user).
**Verdict:** baseline security solid for a single/trusted-user setup.
**Remaining (future, tied to P0-3):** policies trust *any* authenticated user, so every logged-in user can read all tables incl. sensitive owner financials (`owner_expenses`, `owner_reimbursements`, `expenses`, `vendor_payments`). When staff accounts are added, replace blanket policies with **role-aware RLS** so staff can't see owner financials. Pairs with P0-3 (role resolution).

---

## ISSUE-001 · Template save shows no success confirmation
**Status:** OPEN — minor (missing functionality)
**Found:** 12 Jun 2026, manual testing
**Symptom:** Editing a template and clicking save returns to the templates list with **no success message** — unclear whether it saved.
**Root cause:** `TemplateEditor.handleSave` calls `onSave()` (which navigates back to the list) but never shows a success toast/message. Save itself works.
**Proposed fix (small, code-only):** add `notify('Template saved!', 'success');` just before `onSave()` in `handleSave`. Uses the toast system already added in P0-2. Optionally do the same for other save flows that lack confirmation (lead source add already shows one).
**Impact:** UX only; no data risk.

---

## ISSUE-002 · Custom lead sources rejected by DB check constraint
**Status:** FIXED — 12 Jun 2026. Ran `ALTER TABLE leads DROP CONSTRAINT leads_source_check;` in Supabase (success). Diagnostic confirmed no equivalent constraint on `clients`. Optional FK (leads.source → lead_sources.value) left as a possible future hardening step. **Verified 12 Jun 2026:** new lead with custom source ("Google Ads") creates + saves; edit-and-save also works. CLOSED.
**Found:** 12 Jun 2026 — surfaced by the new P0-2 error handling (previously failed silently).
**Symptom:** Creating a lead (incl. "new lead from reference") with a **user-added** lead source such as "Google Ads" fails with:
`new row for relation "leads" violates check constraint "leads_source_check"`
**Root cause — design conflict (two sources of truth):**
- Lead sources are **configurable** via the Settings → Lead Sources UI, which writes to the `lead_sources` table. A new source "Google Ads" gets a `value` like `google_ads`.
- But the `leads.source` column has a **hardcoded `CHECK` constraint** (`leads_source_check`) that only allows a fixed seeded list (phone, whatsapp, referral, website, manual, instagram, facebook, google, walk_in, phone_call).
- `google_ads` (and any future custom source) is not in that list → the database rejects the insert.
- Net: **any lead source added through the UI will break lead creation.** The configurable table and the static constraint are in conflict.

**Proposed fix (DB schema change in Supabase — needs approval):**
The `lead_sources` table should be the single source of truth. Recommended:
```sql
-- 1) Remove the static allow-list constraint
ALTER TABLE leads DROP CONSTRAINT leads_source_check;
-- 2) (Optional, more robust) enforce referential integrity instead:
--    requires lead_sources.value to be UNIQUE
-- ALTER TABLE lead_sources ADD CONSTRAINT lead_sources_value_unique UNIQUE (value);
-- ALTER TABLE leads ADD CONSTRAINT leads_source_fk
--   FOREIGN KEY (source) REFERENCES lead_sources(value);
```
**Also check for the same pattern elsewhere** before fixing, so we catch all of them in one go:
```sql
select conname, conrelid::regclass as table, pg_get_constraintdef(oid)
from pg_constraint
where contype='c' and pg_get_constraintdef(oid) ilike '%source%';
```
(Likely candidates: a similar `*_source_check` on `clients`.)

**Trade-off:** dropping the CHECK removes DB-level validation of the source value; validation then relies on the app's dropdown (populated from `lead_sources`), which is the intended design. The optional FK restores DB-level integrity if `lead_sources.value` is made unique.
**Impact if unfixed:** users cannot use any lead source they create themselves — only the original seeded ones work.
