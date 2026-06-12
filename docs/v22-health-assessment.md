# Isheeka Events ERP — Code Health Assessment (read-only)

**File assessed:** `isheeka-erp-v22.html` (6,021 lines, 409 KB, single file)
**Date:** 11 Jun 2026
**Scope:** Read-only review against four goals — (1) saleable, (2) performance-optimised, (3) robust exception handling, (4) data integrity / business logic.
**No code was changed.** This report is for prioritisation and approval.

---

## How to read this

Findings are ranked **P0 (critical) → P3 (polish)**. Each has: what it is, the evidence (line refs), the business impact, and a recommendation. Nothing here is fixed yet — you approve items individually.

A quick profile of the codebase:

| Metric | Value | Note |
|---|---|---|
| Components | 56 | All in one file |
| `useState` hooks | 203 | High render surface |
| `useMemo` / `useCallback` | 0 / 4 | Almost no memoisation |
| Supabase calls | 119 | `select` 71, `insert` 25, `update` 33, `delete` 3 |
| DB results ignoring `error` | ~39 of 54 (~72%) | Silent-failure risk |
| `try/catch` blocks | 26 / 22 | Concentrated in a few places |
| `alert()` / `confirm()` | 11 / 4 | Blocking, unbranded UX |
| `console.*` statements | 1 | Effectively no logging |
| Error boundaries | 0 | One render error = white screen |
| Pagination (`.limit`/`.range`) | 2 / 0 | Lists are unbounded |

---

## P0 — Critical (fix before this is "production-grade for a live ERP")

### P0-1 · No React error boundary → whole-app white screen
**Evidence:** 0 occurrences of `ErrorBoundary` / `componentDidCatch`; single mount at line 6019 (`ReactDOM.render(<App/>…)`).
**Impact:** Any uncaught render error (a malformed quotation row, an unexpected null) blanks the *entire* app. If Swathi is mid-quote, that work is lost. For a critical ERP this is the highest-leverage resilience gap.
**Recommendation:** Add a top-level error boundary that catches render errors, shows a branded "something went wrong — your data is safe" panel with a reload, and (P1-7) logs the error. Small, isolated, high value.

### P0-2 · ~72% of database calls ignore the `error` result
**Evidence:** 39 of 54 result-destructures capture only `{data}` and discard `{error}` (e.g. lines 333, 424, 1262, 2192, 3077). Inserts/updates that ignore errors include line 1262 (alt-contact insert), 2137/2192 (sub-events, checklist), and the counter updates (§P0-4).
**Impact:** When a write fails (RLS denial, network blip, constraint violation), the UI proceeds as if it succeeded. The user believes a quotation/client/line-item was saved when it wasn't → **silent data loss** and inconsistent records. This is the single biggest robustness issue by volume.
**Recommendation:** Standardise on a small `db()` helper that checks `error`, surfaces a branded toast, and logs. Roll it through the write paths first (insert/update/delete), then reads. This is a medium-sized, mechanical change — I'd propose it in batches by module so each is reviewable.

### P0-3 · User role is hardcoded to `admin`
**Evidence:** Line 4255 — `const role = 'admin';`. The `users` table is queried only for staff-assignment dropdowns (lines 2081, 2721, 3029, 3935), never to resolve the *logged-in* user's role.
**Impact:** RBAC described in the handoff (admin/manager/staff gating Settings, Users, Owner Account, Finance) is **not enforced** — every authenticated user is admin. One user today, so low real-world impact now, but a blocker for a saleable multi-tenant/multi-user product and a confidentiality risk once staff accounts exist.
**Recommendation:** Resolve role from the `users` row matching the auth user on login, store it in app state, and drive nav + route guards from it. Must be paired with server-side RLS (§P1-8) — client-side role is cosmetic on its own.

### P0-4 · Ref-number counters have a race condition (non-atomic) and unchecked writes
**Evidence:** `getNextQuotRef` / `getNextLeadRef` / `getNextClientRef` (lines 5056–5092) read `current_value`, add 1 in JS, then `update` — a classic read-modify-write with no atomicity and no `error` check.
**Impact:** Two quotes generated at nearly the same moment can read the same counter and produce **duplicate** `Q-26-XXXX` / lead / client ref numbers. Low probability with a tiny team, but these numbers are on client-facing documents, so a collision is embarrassing and corrupts uniqueness assumptions.
**Recommendation:** Move the increment into an atomic Postgres RPC (`update … set current_value = current_value + 1 … returning`) or a DB sequence, and check the result. This is a small DB-side function + a one-line client change.

---

## P1 — High (correctness & saleable UX)

### P1-5 · Client phone/email/city blank on the QuotationDetailModal PDF (known bug #2)
**Evidence:** `buildQuotationPDF` reads `quot.client_phone/email/city` (lines 5262–5264). The wizard enriches these from the lead (`enrichedQuot`, line 5757). The modal passes the raw `quotations` row (lines 2885, 2992–2993) which doesn't carry those fields → Page 2 client box renders blank when a PDF is re-downloaded from a lead/event.
**Impact:** Client-facing document looks incomplete on the most common re-download path. Directly contradicts the "PDF must be beautiful" principle.
**Recommendation:** Enrich `quot` in the modal (fetch the linked lead/client contact fields) before calling the PDF builder — mirroring the wizard path. Small, isolated.

### P1-6 · Crude, blocking, unbranded dialogs (`alert`/`confirm`)
**Evidence:** 11 `alert(`, 4 `confirm(` — including destructive/cascade confirmations.
**Impact:** Native dialogs freeze the UI thread, look unbranded (off for a premium product), and `confirm()` is awkward on mobile/WhatsApp-driven workflows. Not saleable-grade.
**Recommendation:** Replace with the app's existing modal/toast styling (a reusable `confirmModal` + `toast`). Can be phased; pairs naturally with the P0-2 error-handling helper.

### P1-7 · Almost no logging/telemetry
**Evidence:** 1 `console.*` statement in 6,021 lines.
**Impact:** When something fails in the field, there's no trail to diagnose it. Combined with P0-2, failures are both silent *and* untraceable.
**Recommendation:** Lightweight error logging (console + optionally a Supabase `error_log` table) wired into the error boundary and the `db()` helper.

### P1-8 · Security rests entirely on Supabase RLS — needs verification
**Evidence:** Anon key embedded client-side (line 152, normal for Supabase) + role hardcoded client-side (P0-3). The handoff says "RLS managed by Supabase Auth" (vague).
**Impact:** With client-side role cosmetic, **all** real access control depends on Row-Level Security policies in Supabase. If RLS is missing or permissive on any table, the anon key allows direct read/write to that table from anywhere.
**Recommendation:** Audit RLS on every table (I can't see this from the client file — needs a Supabase check). This is verification, not a code change, but it's a P1 for "saleable."

---

## P2 — Medium (performance & scale)

### P2-9 · In-browser Babel transpilation on every load
**Evidence:** `@babel/standalone` (line 11) transpiles all 6,000 lines client-side at startup.
**Impact:** Multi-second cold start and CPU spike on low-end office devices; Babel-standalone is explicitly "not for production." Affects perceived quality.
**Recommendation:** Add a minimal precompile step (Babel CLI → one bundled `<script>`) that still outputs a single deployable file. Removes Babel from the client and cuts startup dramatically. Trade-off: introduces a tiny build step vs. today's zero-build edit-and-push. Worth discussing.

### P2-10 · Unpinned CDN dependencies
**Evidence:** `@babel/standalone` (no version), `@supabase/supabase-js@2` (floats on minor/patch). jsPDF, autotable, SheetJS are pinned (good).
**Impact:** An upstream release can change behaviour or break the live app overnight with zero code change on your side.
**Recommendation:** Pin exact versions for all CDN deps. Tiny, safe change.

### P2-11 · No pagination on list views
**Evidence:** Leads (3650), Clients (1676), Events (3920) etc. do `select('*').eq('is_deleted',false)` with no `.limit`/`.range` (only 2 `.limit` in the whole app).
**Impact:** Every list fetches *all* rows. Fine now; degrades steadily as leads/clients/events accumulate over years.
**Recommendation:** Add pagination or a sensible cap + "load more" to list queries. Medium effort.

### P2-12 · Redundant queries & no memoisation
**Evidence:** Settings fetched twice per modal (lines 2992 & 2993, once per button); active-staff list fetched independently in 4 places (2081, 2721, 3029, 3935); 37 `select('*')` full-row fetches; 0 `useMemo` across 203 `useState`.
**Impact:** Extra round-trips and re-render churn. Individually minor; collectively they add latency and jank.
**Recommendation:** Cache settings/staff once at app level; select only needed columns; memoise expensive derived lists. Incremental.

---

## P3 — Lower (polish & known backlog)

- **P3-13 · React 18 legacy mount** — `ReactDOM.render` (line 6019) instead of `createRoot`; deprecation warning, works fine.
- **P3-14 · Single 6,000-line file** — maintainability ceiling for a saleable product; modularisation is a bigger architectural decision (trade-off vs. current simplicity).
- **P3-15 · Known feature backlog (from handoff):** Invoice creation + PDF flow, template sub-event tagging, standalone Quotations list, Users module, Reports, and the end-to-end PDF visual test against the sample.

---

## What's already good (worth keeping)

- **Auth flow** has proper `try/catch` with friendly, non-leaky error messages (lines 4072–4090).
- **No XSS vectors** — zero `dangerouslySetInnerHTML`, zero `eval`.
- **No secrets in browser storage** — no `localStorage`/`sessionStorage` misuse; session held in memory.
- **Session timeout** (25 min warning / 30 min logout) is implemented — good for a shared office device.
- **Consistent design system** via CSS variables; clean, on-brand styling.

---

## Suggested sequencing (for discussion — nothing actioned yet)

1. **P0-1 error boundary** — small, isolates the worst failure mode. *(Recommended first.)*
2. **P0-2 error-handling helper** — biggest robustness win; roll out in reviewable batches.
3. **P0-4 atomic counters** — small DB-side fix, removes a data-integrity risk.
4. **P0-3 role resolution + P1-8 RLS audit** — do together; security pair.
5. **P1-5 client-enrichment bug** — quick correctness win on the client-facing PDF.
6. **P1-6 branded dialogs / P1-7 logging** — UX + diagnosability, pair with P0-2.
7. **P2 perf items** (pin deps → precompile Babel → pagination → caching).
8. **P3 backlog** — features and visual test.

Each approved item will come with a detailed change proposal (what changes, impact, pros/cons, expected output, and any better alternative) **before** any edit is made.
