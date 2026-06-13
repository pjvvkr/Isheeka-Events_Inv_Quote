# Isheeka ERP v22 — Running Changelog & Decision Log

**Purpose:** the single durable record of every change shipped, every database migration run, and every open item — so nothing is lost between sessions. **This is the list we review together before baselining the app.** Claude maintains this; it does not rely on conversation memory.

_Last updated: 12 Jun 2026._

---

## A. Code changes deployed (live on `main` / GitHub Pages)

| # | Change | Notes |
|---|---|---|
| 35 | **PDF redesign v2 — logo + dedup + Total + multipage + spacing** | Replaced the embedded logo with the new **icon-only** mark (transparent PSD → flattened to white → PNG, 8.8 KB; aspect-preserved, ~46 pt header / ~120 pt cover). Branding **de-duplicated** (logo no longer carries text, so the script "Isheeka Events" + tagline + "Since 2010" beside it is the only brand text). **"Since 2010"** shrunk (header 11 pt, cover 15 pt). Grand total now labeled **"Total"** for quotes (stays "Grand total" for invoices) and **always renders** even when prices toggle is off. **Fixed the broken multi-page continuation header** (full header now repeats cleanly on every page via a consistent top margin — no more page-3 overlap). Added **breathing room**: bigger gaps after cards + table, payment details pushed down, summary/schedule/balance spaced. Quote price/qty toggles unchanged. File ~40 KB smaller (new logo vs old JPEG). |
| 33 | **PDF redesign (quote + invoice) — branded layout + script font** | Rewrote `buildQuotationPDF`: header band (script "Isheeka Events" wordmark + tagline + script "Since 2010", ref/date/due-or-valid + status), **Client** + **Event** cards, pink-header line-items table grouped by sub-event (respects prices/qty toggles), **Summary** box with pink grand-total bar + GST line (invoices) + Received/Balance, payment schedule, payment details, terms, footer with page numbers. **Cover page** (only when the toggle is ticked): centered logo, script wordmark/Since-2010, doc pill, "PREPARED FOR", and an **editable personalized intro** from `settings.cover_intro` with `{client}`/`{event}` placeholders, script greeting, and **"Swathi"** sign-off. **Great Vibes** font embedded as base64 (`addFileToVFS`/`addFont`) for all script text; falls back to Times-italic if it fails. Multi-page handled by autotable (header/footer repeat). Shared engine via `docType`. ⚠️ Drawn blind (no jsPDF preview in dev) — expect a look-and-tune cycle on real output. |
| 34 | **G1/G2/G3 (test-found)** | G1: quote-detail Activity section collapsible (collapses when >1 entry). G2: list/search now sorts active/relevant first, dead (superseded/rejected/expired/cancelled/lost) last, newest within each — Leads, Quotations, Invoices (Events already status-ordered). G3: invoice detail shows a clickable **Source quotation** (ref · status · total). |
| 32 | **QA fixes C3 + C5** | C3: Dashboard "this month"/"upcoming" date checks now use local `YYYY-MM`/`YYYY-MM-DD` string compares (no UTC `new Date()` drift near month boundaries). C5: Revise modal validates the discount (0 ≤ discount ≤ subtotal) before saving. A1/A2/A3 deferred into Phase 4 (payment-status logic — untestable until payments exist); B1/B2 into the post-baseline RPC pass; C1 is an inherent caveat (can't confirm delivery). Code only. |
| 31 | **Phase 3b-ii — revise invoice + change log** | Invoice detail gains **✏️ Revise** (any non-cancelled invoice): a modal to edit line items + invoice-level discount, with a **mandatory reason**. On save it recomputes subtotal/GST/grand, rescales installments, replaces line items, and writes an `invoice_activity_log` "revised" entry (old→new grand total + reason) that appears in the Activity & change-log timeline. `revision_number` bumps **only if the invoice has been issued** (Sent+); drafts update in place. **Paid-in-full** invoices can be revised behind a stronger confirm (admin action; the role gate binds once real roles land per P0-3). Code only — no migration. **Remaining 3b-ii sub-item: draft auto-refresh** (decision #12) — isolated follow-up as it touches the `createInvoiceFromQuote` money-path. |
| 30 | **Dashboard — live data + operational widgets** | Was a static placeholder (hardcoded 0s + first-run onboarding). Now the 4 metric cards read live: **Active leads** (open pipeline), **Upcoming events** (future, not completed/cancelled), **Quoted this month** (Σ this-month quotes, excl. superseded), **Collected this month** (Σ `invoice_payments` this month — ₹0 until Phase 4, then auto-populates). Cards click through to their modules. Onboarding panel replaced with **Upcoming events** + **Outstanding invoices** lists (clickable to the record). Code only — no migration. |
| 29 | **Standalone Quotations module** | Sidebar **Quotations** is now a real module (was a stub): searchable/filterable list of all quotes with metrics (total / awaiting response / confirmed / draft), status filter, rows open the existing quotation detail modal. Mirrors the Invoices module. Wired `navigate` to carry `quotId`. Superseded rows dimmed. Code only — no migration. |
| 28 | **Phase 3b-i — send/audit trail (activity timelines)** | Every client-facing send now logs an entry: quote sends → existing `quotation_activity_log`; invoice sends → new `invoice_activity_log` (`action='sent'`, `channel`, timestamp, `*_by`). Wired into all three share paths (quote-detail modal, quote wizard share step, invoice detail). **Displays:** invoice detail gains a collapsible **Activity & change log** with a "Sent N× · last sent …" summary; quote-detail modal gains an **Activity** section with the same. Sender resolved to a name via the `users` table. **Requires the `invoice_activity_log` migration (Section B-11).** Quote logging works without migration (table already existed). **Fix:** `*_by` is now resolved to the app `users.user_id` (matched by the logged-in email), not the raw Supabase auth id — the auth id isn't a `users` row and was failing `quotation_activity_log.logged_by`'s FK, silently dropping every quote-send log. Also: quote modal + invoice detail now refresh their Activity list immediately after a send. |
| 27 | **Invoice preview + client details + edit-with-cascade** | Invoice detail gains a **👁 Preview** button (opens the rendered invoice PDF in a new tab; new `action:'preview'` in the PDF engine). New **Client details** card (name, phone(s), email(s), address, GST no.) read live from the `clients` master. **✏️ Edit client** opens the shared `ClientForm` in a modal → updates the `clients` master (contact fields cascade automatically since docs read them live); a **name change is cascaded** to `client_name` on the client's **active** documents only — draft `quotations` / draft `invoices` / non-completed-non-cancelled `events`. Already-sent/finalised documents keep their original name as a snapshot. Code only — no migration. |
| 26 | **Invoice Phase 5 — invoice PDF + share** | Extended `buildQuotationPDF` with `docType='invoice'`: title/pill say "Invoice", header shows **Due date** (not Valid until), totals add a **GST line** (when applicable) + **Received / Balance due**, filename `Invoice_<ref>…`. Invoice detail now has working **⬇ PDF (download)** and **Print** (any status), plus **WhatsApp** and **Email** (only when status is Sent or later). New helpers `uploadInvoicePdf` (Storage → `invoices/…`) + `buildInvoiceShareMsg`; client phone/email enriched from the linked client. Installment schedule rendered in the PDF with amounts + due dates. Added `.gitattributes` (eol=lf) to stop CRLF diff churn. Code only — no migration. |
| 1 | **P0-1 — App error boundary** | Render crashes show a branded "your data is safe" screen instead of a white page. |
| 2 | **P0-2 Phase 1 — toast system + `runDb` + replaced 11 `alert()`s** | Non-blocking branded toasts; central DB-error helper. |
| 3 | **P0-2 Phase 2 — error handling on money-path writes** | Quote wizard + lead→event conversion now surface failures (no silent data loss). |
| 4 | **P0-2 Phase 3 — error handling on remaining writes** | Events detail, templates, lead sources, clients, alt-contacts, checklist; optimistic reverts. |
| 5 | **P1-5 — client contact on re-downloaded PDFs** | QuotationDetailModal enriches client phone/email/city from client→lead. |
| 6 | **Issue #1 — template "saved" toast** | Success confirmation on template save. |
| 7 | **P2-10 — pinned CDN dependency versions** | react 18.3.1, react-dom 18.3.1, @babel/standalone 7.29.7, supabase-js 2.106.2. |
| 8 | **P0-4 — atomic ref-number counters** | `getNext…Ref()` use the `next_counter` Postgres RPC; no duplicate refs. |
| 9 | **Event refs (`E-YY-####`)** | Generated on event creation (wizard + conversion); shown in Events list + detail. |
| 10 | **GST % field in Settings → Bank details** | Configurable rate for invoices. |
| 11 | **#3 — quote↔event link on conversion** | Conversion stamps `quotations.event_id` (+ stores `events.lead_id`). |
| 12 | **Lead → event navigation** | "Converted to event" card on the lead with a "View event →" button. |
| 13 | **Event → lead navigation** | "← Lead" button on the event detail; app navigation extended for `leadId`. |
| 14 | **Context-aware quotation detail** | Status banners (confirmed / event-exists), "Go to event"; quote rows clickable from the event. |
| 15 | **Share: WhatsApp / Gmail / native email + hosted PDF link** | Professional message (matches welcome-message tone); PDF uploaded to Storage; phone validation. |
| 16 | **Readable PDF filename** | `Quotation_<ref>[-rN]_<YYYYMMDD-HHMM>_<code>.pdf`. |
| 17 | **Ref search in lists** | Leads / Events / Clients search now matches their ref numbers; placeholders updated. |
| 18 | **#2 (2a/2b) — quote-from-event** | Wizard `originEvent` adapter; "+ Create" on an event launches it (client pre-filled, links to event, no lead). |
| 19 | **2c — Revise from event** | "+ Create" flips to "Revise" once an active quote exists; revision preloaded + supersedes; lead-wording hidden for event-origin. |
| 20 | **Item carry + sync (quote = master, event mirrors)** | Pre-fills quote from event items; on save rebuilds event sub-events/items to mirror the quote (full mirror). Verified — event total reconciles to active quote. |
| 21 | **Event "Total items value" row** | Total of all line items shown at the bottom of the event's Sub-events & items box. |
| 22 | **Create-new-client in New Event wizard** | Step 2 (Client & contact) now has a "+ New client" button + an empty-state "Create new client" prompt; opens the existing ClientForm in a modal, creates the client (same logic as the Clients module), and auto-selects it. |
| 23 | **Collapse superseded quote revisions** | Event detail (Documents → Quotations) and lead detail (Quotations panel) now show only non-superseded quotes by default; superseded revisions hide behind a "▸ Show N earlier revisions" toggle (expand/collapse in place). Presentational only — no query/data/active-quote logic changed. Rev number now shown on event-side rows too. _Tested OK by user._ |
| 25 | **Invoice Phase 3a — Invoices module + detail screen** | Sidebar **Invoices** is now a real module (was a stub): list with metrics (count / outstanding / received / overdue), search (ref/client/event) + status filter, rows → detail. **Invoice detail**: header (ref, status, client·event, "Go to event", quote-variance banner), **GST toggle** (pulls `settings.gst_pct`, recomputes tax+grand live, rescales installments, persists), line items grouped by sub-event, totals, installment schedule, received/outstanding, **Mark sent** (+auto due-date from `settings.default_invoice_due_days`) and **Cancel** actions (PDF stubbed for Phase 5). Wired nav: `navigate` carries `invoiceId`; event invoice rows now open the detail. No migration — code only. Built against `v22-db-schema.md` enums. **Refinements from testing:** (a) quote-vs-invoice variance now compares **pre-GST** (toggling GST no longer shows a false "difference"); (b) **Cancel** now frees the event — dedupe + event "Generate invoice" + payment-summary all ignore cancelled invoices, so a new invoice can be regenerated; (c) cancelled-invoice screen shows a hint on how to raise a new one. |
| 24 | **Invoice Phase 2 — auto-create from confirmed quote** | New `createInvoiceFromQuote()` helper + `getNextInvoiceRef()` (`I-YY-####`). A **draft** invoice is auto-created when a quote is confirmed: Path A (lead→event conversion) creates it at the end of conversion; Path B adds a **"✅ Confirm & create invoice"** action on the QuotationDetailModal for event-origin quotes (sets quote→approved, creates invoice, jumps to event). Event's Invoices box gains a **"+ Generate invoice" safety-net** (when a confirmed quote exists but no invoice) + shows received/rev; Payment summary now shows real Received/Outstanding. Fully-relational schema (line items, installments, payments). Guarded multi-table write (rolls back partial invoice on failure). **Requires the Phase 2 SQL migration (Section B-10).** |

---

## B. Database migrations run in Supabase (not in the HTML — separate from code deploys)

1. **`next_counter(p_type,p_year,p_seed)`** — atomic increment function (P0-4).
2. **`invoices`** — added `gst_applicable, gst_pct, tax_amount, discount_amount, due_date`.
3. **`settings`** — added `gst_pct` (default 18).
4. **`events`** — added `ref_number`; **`counters_type_check`** extended to include `'event'`; backfilled existing event refs; seeded event counter.
5. Renamed existing event refs `EV-` → `E-`; reset event counter so next = `E-26-1111`.
6. **Dropped `leads_source_check`** — custom lead sources were rejected (configurable `lead_sources` is now the source of truth).
7. **Storage**: created public bucket **`quotations`** + policy `quotations_all` (authenticated upload) — for hosted quote PDFs.
8. **`sub_event_items.sub_event_id`** — dropped NOT NULL (allows "main event" items not under a sub-event). _ISSUE-003._
9. Backfills: `quotations.event_id` from the lead's event (converted quotes); `events.lead_id` from `leads.event_id`.
10. **Invoice Phase 2 — RUN ✅ (13 Jun).** The `invoice_*` tables already existed (original schema) with their own column names — verified via `information_schema`. Revised migration ADDED: `invoices.revision_number`, `invoices.source_quote_total`; `invoice_line_items.is_deleted`; `invoice_installments.label / when_text / is_deleted`; + RLS policies + indexes. Confirmed present in the live schema dump. Code aligned to existing names (`total_received`/`total_outstanding`, `installment_number`/`percentage`, `client_name`/`event_name`). Script: `docs/v22-invoice-phase2-migration.sql`. Note: the 3 redundant `*_all` RLS policies my script added are duplicates of the pre-existing `*_policy` ones — optional cleanup SQL is in `v22-db-schema.md` §3.

> **Reminder:** the database and the code must stay in lock-step. If the app is ever restored from an older state, these migrations must already be present (they are, since they're applied to the live Supabase project).

11. **`invoice_activity_log` (Phase 3b) — PENDING USER RUN.** New table for the invoice audit/change-log timeline (sends now in 3b-i; revisions in 3b-ii): `log_id, invoice_id, revision_number, action, channel, field, old_value, new_value, reason, changed_by, changed_at` + RLS authenticated policy + index. Run before the 3b-i deploy or invoice send-logging silently no-ops (it's wrapped in try/catch). Quote logging uses the pre-existing `quotation_activity_log` (no migration).

**⚠️ Large-file hazard (learned 14 Jun):** the sandbox/bash mount **truncates reads of large files** (the HTML is now ~600 KB after embedding the logo + Great Vibes font). A bash/python "read file → modify → write back" on the mount can read a *truncated* copy and write back a **truncated, corrupted file** (this happened once during the PDF splice and was caught + recovered). **Safe practice:** build any whole-file transform in `/tmp` sourced from `git show origin/main:...` (git reads are NOT truncated), transpile-verify the `/tmp` copy, then write it to the mount; never trust a bash read of the full file for length/markers. Per-region `Edit`-tool changes remain fine.

**Repo relocation (13 Jun 2026):** the working repo was moved **out of OneDrive** (`…\OneDrive\Documents\GitHub\…`) to **`C:\Users\vamsh\GitHub`** after OneDrive repeatedly corrupted the local `.git` (corrupt index, locked loose objects, failed pushes) and gave stale/truncated reads. A fresh clone was made and working files copied in; the post-fix Phase 3a edits were re-applied here (they'd been lost in the corrupt copy). **Do not move the repo back under OneDrive/any sync tool.** Files are now CRLF (a `.gitattributes` normalization is a small pending cleanup to stop whole-file diff churn).

---

## C. Open / pending items (to resolve before or as part of baselining)

**Functional gaps (from the spec):**
- Invoice module — Phases done: 2 (auto-create ✅), 3a (module + detail ✅). **Remaining, in order:** **Phase 5** (invoice PDF + Email/WhatsApp/Print/Download — building next) → **⏳ Phase 3b (DEFERRED, MUST RETURN): revise invoice + change log + mismatch reasons + draft auto-refresh, needs new `invoice_activity_log` table)** → **Phase 4** (record payments + auto balance/status). Spec: `v22-invoice-spec.md`.
  - **Reminder for Claude:** after Phase 5 ships and is tested, proactively raise Phase 3b before anything else. It is the revise/audit work the user explicitly asked to be reminded about (decisions #7–#12 in the invoice spec).
- ~~Standalone **Quotations** module list~~ ✅ DONE (changelog #29).
- **Dashboard** real widgets (currently placeholder).
- **Users**, **Reports**, **Vendors**, **Vendor Payments**, **Expenses**, **Owner Account** (stubs).
- Template sub-event tagging (data task) for PDF grouping.

**Refinements raised during testing:**
- **Payment summary "Quoted (items)"** should reflect the **active quotation**, not the event's loose items (decide during Invoice build).
- **"Revise" button inside the quotation-detail modal** (deferred — only the event button was built).
- **"Go to event" hidden when already on that event** (small UX tweak, discussed, not built).
- ~~Long revision chains: optional "group/hide superseded" toggle in the quote lists.~~ ✅ DONE (changelog #23).

**Architecture / hardening (post-baseline):**
- **Transaction-wrap multi-table flows** (event save, lead→event conversion, quote-from-event + mirror) in Postgres RPCs so a mid-way failure can't leave partial/out-of-sync records.
- **P0-3 — real role resolution + role-aware RLS** (when staff accounts are added; today every authenticated user sees everything, incl. owner financials).
- **P2 performance/scale**: list pagination; precompile Babel + modularize (remove in-browser transpile); memoization; dedupe redundant queries.
- **Mobile (iOS/Android)**: PWA or Capacitor wrap — *after* the build-step graduation above.

**Security status:** RLS enabled on all tables; only authenticated users; **public sign-ups disabled** (verified). Solid baseline for a single/trusted-user setup.

**Test data cleanup:** delete throwaway test leads/events/quotes (e.g. "New Flow 2" partials, "Popup Test", "Test_Ref" events) before go-live.

---

## D. Companion documents in `/docs`
- `v22-functional-spec.md` — full functional spec + built/partial/pending status.
- `v22-invoice-spec.md` — Invoice module spec + phased plan.
- `v22-health-assessment.md` — code health assessment (P0–P3 findings).
- `v22-issues-log.md` — issues found in testing + their resolution.
- `isheeka-erp-complete-handoff.md`, `isheeka-v22-cowork-handoff.md` — original context handoffs.

---

## E. Pre-baseline review checklist (to do together before declaring v22 the baseline)
1. Walk this changelog end-to-end; confirm each shipped item still behaves.
2. Confirm all Section B migrations are present in the live Supabase project.
3. Resolve the "Open/pending" items we agree are baseline-blocking (vs. post-baseline).
4. Clean up test data.
5. Full regression smoke test of the core flow: Lead → Quote → (revise) → Convert → Event → Quote-from-event → Invoice (once built) → share/PDF.
6. Tag/snapshot the baseline (e.g. a dated commit / `v22-baseline`).
