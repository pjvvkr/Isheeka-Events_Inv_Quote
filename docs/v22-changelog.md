# Isheeka ERP v22 — Running Changelog & Decision Log

**Purpose:** the single durable record of every change shipped, every database migration run, and every open item — so nothing is lost between sessions. **This is the list we review together before baselining the app.** Claude maintains this; it does not rely on conversation memory.

_Last updated: 12 Jun 2026._

---

## A. Code changes deployed (live on `main` / GitHub Pages)

| # | Change | Notes |
|---|---|---|
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
| 23 | **Collapse superseded quote revisions** | Event detail (Documents → Quotations) and lead detail (Quotations panel) now show only non-superseded quotes by default; superseded revisions hide behind a "▸ Show N earlier revisions" toggle (expand/collapse in place). Presentational only — no query/data/active-quote logic changed. Rev number now shown on event-side rows too. |

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

> **Reminder:** the database and the code must stay in lock-step. If the app is ever restored from an older state, these migrations must already be present (they are, since they're applied to the live Supabase project).

---

## C. Open / pending items (to resolve before or as part of baselining)

**Functional gaps (from the spec):**
- Invoice module — Phases 2–6 (creation → list/detail → payments → PDF → revision/audit). Spec: `v22-invoice-spec.md`.
- Standalone **Quotations** module list (mockup approved; not built).
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
