# Isheeka ERP — Security hardening: status & next steps
_Audit + Tier 1 done 2026-06-26._

## ✅ Done
- **App-side (push to deploy):** added `isheeka-vite/public/_headers` (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy); removed legacy `isheeka-erp-v21_2.html` / `isheeka-erp-v22.html`.
- **DB Tier 1 (applied to prod):** revoked all `anon` table/function access (portal uses the service-role gateway, so safe); locked the OTP table to the gateway; pinned `search_path` on 4 functions. No staff-facing change. Recorded in `supabase/migrations/20260626090000_security_hardening_tier1.sql`.

## 🔜 DB Tier 2 — read-gating (file ready, NOT applied)
File: `supabase/migrations/20260626093000_security_hardening_tier2_reads.sql`.
Makes "can't open the module ⇒ can't read its rows" true at the database level (today it's only enforced in the UI). **Only affects staff whose `module_access` has modules turned OFF;** admins, the owner, and full-access staff see no change.

**Before applying — 5-min test:** apply it, then log in as each *restricted* staff member and click through their screens. Watch for blank/missing data where one screen reads another module's table (e.g. costing↔vendors, event↔invoices). If something blanks out, either give that person the module in **Settings → Access**, or relax that one table's policy in the file. Rollback = re-create the `*_read` policy as `USING (true)`.

Say the word and I'll apply it.

## �p Supabase dashboard toggles (do these in the browser — 5 min, free)
1. **Leaked-password protection** → Authentication → Policies (Password) → enable "Check against HaveIBeenPwned".
2. **MFA for owner/admin** → Authentication → enable MFA (TOTP), then enrol the owner login from the app/account settings.
3. **Backups / Point-in-Time Recovery** → Database → Backups. For client + financial data this is worth the paid tier; at minimum confirm daily backups are on.

## 💤 Optional / later
- **Make the GitHub repo private.** Low security value (the app + anon key are public by nature) but protects history/notes. Catch: GitHub Pages from a private repo needs a paid plan, so first move `rfq.html` off Pages → Netlify, update `VITE_RFQ_BASE_URL`, add a redirect for old client links, then flip private.
- **Dependencies:** `npm audit` shows jspdf/uuid issues. Safe to run `npm audit fix` (non-breaking). **Do NOT run `npm audit fix --force`** — it downgrades exceljs and breaks Excel exports.
- **`app_can` fallback:** returns `true` for a logged-in email not found in `users`. Harmless while signup is disabled, but worth changing the fallback to `false` if you ever open signup.
- **CSP header:** template is in `_headers`; enable after testing login/PDF/upload/push.
