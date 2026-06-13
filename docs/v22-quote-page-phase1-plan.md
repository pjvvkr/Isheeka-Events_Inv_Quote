# v22 — Quotation Detail Page (Option B, hybrid) — Phase 1 Implementation Plan

**Status:** Awaiting approval. No code written yet.
**Goal:** Make the Quotations module a first-class **page** that is the home for the full quote lifecycle, so clicking a quote anywhere lands you where you can act on it. Keep the lead/event funnel shortcuts (hybrid). No database migration.

---

## Scope split

- **Phase 1 (this plan):** Build the `QuotationDetail` page with *all* current modal functionality **plus** Revise / Edit. Repoint every quote click to the page. Retire `QuotationDetailModal`. Leave the lead/event stage buttons working as they are (they keep launching their own wizard — the hybrid shortcuts).
- **Phase 2 (later):** Slim the lead/event so their quote buttons deep-link into the page (single mount point), back-navigation polish, and any final IA cleanup. Not in this plan.

---

## 1. New component — `QuotationDetail({quotationId, onBack, onNavigate})`

Mirrors `InvoiceDetail` in structure. Lives in the Quotations module (list → page), same pattern as Invoices module → InvoiceDetail.

**State:** `quot, items, settings, activity, userMap, srcLead, srcEvent, displayOpts, sharing, confirming, loading` + wizard mount state (`showWizard, wizardMode, wizardCtx`).

**loadAll (Promise.all):**
- `quotations` (by id), `quotation_line_items` (is_deleted=false, sort_order), `settings` (full set incl. `upi_id, phone_1, email, website, company_name, cover_intro, bank_*`), `quotation_activity_log`, `users`.
- Source links: `leads` by `quot.lead_id` (→ `srcLead`) and `events` by `quot.event_id` (→ `srcEvent`).
- Enrich `quot` with client contact (client → lead fallback), same as the modal does today, so the PDF client box isn't blank.

**Layout (functionality, not exact format):**
- **Header card:** ref · Rev N · status pill; subtitle client · event_name · doc_date · valid_until; **source chain** 🎯 Lead → 📄 Quote → 🎪 Event (clickable via `onNavigate`).
- **Action bar:** Revise · Edit items & schedule · Confirm & create invoice · Go to event. (Gating below.)
- **"What the client sees" card:** presets (Full detail / Items only / Summary only) + the six toggles (Prices, Quantities, Sub-event grouping, Payment schedule, Discount, Cover page, Bank details) → drive `displayOpts`.
- **Share / export row:** WhatsApp · Gmail · Email · Print · Download PDF — all reuse `uploadQuotePdf` + `buildQuoteShareMsg` + `logQuoteSend` + `buildQuotationPDF`, using `displayOpts` + full `settings`.
- **Line items** grouped by sub-event + Subtotal / Discount / Grand total.
- **Payment schedule** (amount-based display) + Payment terms + Additional T&C.
- **Activity & change log** (collapsible; sent-count summary), same as modal.
- **Status banners** (converted / approved / event-exists), same as modal.

**Reused as-is (no new logic):** `uploadQuotePdf`, `buildQuoteShareMsg`, `buildQuotationPDF`, `logQuoteSend`, `createInvoiceFromQuote`, `fmtDate`, `eventTypeLabel`, `defaultEventName`, `QUOT_STATUS_LABELS/COLORS`, `validClientPhone`, `openWhatsApp`, `openEmail`.

---

## 2. Revise / Edit from the page (context reconstruction)

The page renders `QuoteGenerationWizard` itself. The wizard needs `lead`, `leadSubEvents`, `originEvent`, `isRevision|isContinuation`, `existingQuotationId`. Reconstruct from the quote:

- **Lead-origin** (`quot.lead_id` set): fetch the lead → pass as `lead`; fetch `lead_sub_events` → `leadSubEvents`; `originEvent = null`.
- **Event-origin** (`quot.event_id` set, lead converted/absent): build the lead-shaped adapter from the **event + client** (exactly as `EventDetail` does today), `originEvent = {eventId, eventName: event.name}`; sub-events from the event (or the quote's line-item sub_event names).
- **Mode:** `isContinuation` when status is a draft-in-progress; `isRevision` when the quote has been issued (sent/approved/revised). `existingQuotationId = quotationId`.

The wizard already handles supersede + new-revision + lead-stage write-back. **Verify during build:** that it also updates `leads.active_quotation_id` on the new revision (and add it if missing).

---

## 3. Gating (carry the rules forward)

- **Revise / Edit hidden** when the quote's status is non-editable (`converted`, `rejected`, `expired`, `superseded`) **or** an invoice has been *issued* for the quote's event (mirror the invoice-issued lock we added on the event side: a non-cancelled invoice in `sent/partially_paid/paid/overdue`). Show a muted "Invoice issued — revise the invoice" hint instead.
- **Confirm & create invoice** shown only for event-origin quotes not already approved/converted (same condition as the modal today).
- **Go to event** shown when `quot.event_id` exists.

---

## 4. Routing & retiring the modal

- **Quotations module:** list → on row click, render `QuotationDetail` (selected id) instead of opening the modal — same as `InvoicesModule`/`InvoiceDetail`. `initialQuotId` (deep-link from `onNavigate('quotations',{quotId})`) opens the page directly.
- **Repoint quote-row clicks to the page** (navigate, not modal): Lead detail Quotations list, Event detail Quotations list, Invoice source-quote link (already navigates), Dashboard if applicable.
- **Retire `QuotationDetailModal`:** remove its four mount points; its logic (share / confirm / displayOpts / activity) now lives in the page. Delete the component once all callers are migrated.
- **Back navigation:** `onBack` returns to the Quotations list; deep-links from a lead/event return to the list (Phase 2 can make it return to origin).

---

## 5. Lead / Event in Phase 1 (unchanged behavior)

- Quote **rows** in the lead and event now navigate to the page (view + act there).
- The lead/event **stage buttons** (Generate / Continue / Revise / Confirm) stay as they are for now — they keep launching their own in-place wizard (same component, just a different mount point — no logic divergence). Phase 2 converts these to deep-links.

---

## 6. Dependencies / risks

- **Context reconstruction** (lead vs event origin) is the fiddliest part — verify both paths explicitly (pre-conversion lead quote, post-conversion event quote).
- **Lead-stage + `active_quotation_id` write-back** must still fire from the page's wizard.
- **Invoice-issued lock** must be replicated on the page's Revise/Edit.
- **Modal retirement** touches 4 call sites — confirm none are missed (search `QuotationDetailModal` / `setViewQuotId`).
- **No DB migration.** Pure UI + routing + reuse of existing helpers.

---

## 7. Build order

1. Scaffold `QuotationDetail` (loadAll, header, source chain, status banners, line items, totals, schedule, terms, activity) — read-only parity with the modal's *display*.
2. Add the "What the client sees" toggles + presets + share/export row (reuse helpers).
3. Add Confirm & create invoice + Go to event.
4. Add Revise / Edit (wizard mount + context reconstruction + gating).
5. Wire the Quotations module list → page; repoint lead/event/invoice quote clicks; retire the modal.
6. Transpile-verify; manual test matrix below; changelog.

## 8. Test matrix (before sign-off)

- Open a quote from: Quotations list, lead, event, invoice source-link → all land on the page.
- Lead-origin quote: Revise → wizard pre-fills → save → supersedes + lead stage/active pointer update.
- Event-origin quote: Revise → wizard pre-fills from event adapter → save.
- Share WhatsApp / Email → message includes hosted PDF link; send logged in activity.
- PDF toggles + presets affect Download/Print/Share output.
- Confirm & create invoice (event-origin) → draft invoice created → Go to event.
- Quote with an issued invoice → Revise/Edit hidden + hint shown.
- Draft-in-progress → Edit continues in place (no rev bump); issued quote → Revise bumps revision.
