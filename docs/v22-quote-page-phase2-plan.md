# v22 — Quote-page IA, Phase 2 — Implementation Plan

**Status:** Awaiting approval. No code written yet.
**Goal:** Complete the information architecture. The **lead** becomes pre-quote only (capture, qualify, mark contacted, mark lost, edit, generate the *first* quote). Once a quote exists, the **quote page** owns the entire lifecycle — revise, edit, send, confirm — and **confirming a lead-origin quote creates the event from it**. Retire the dead modal. No database migration.

---

## A. Shared conversion refactor (foundation — do first)

Today `handleConvert()` lives inside `LeadDetail` and `ConvertLeadModal` collects the event name/date. `handleConvert` does a lot: resolve/create the client → create the **event** (ref, name, type, main_date from the lead's tentative date, etc.) → mirror the approved quote's sub-events/items into the event → stamp `quotations.event_id`, `events.lead_id`, `leads.converted_at` / `event_id` / stage → create the **draft invoice** (`createInvoiceFromQuote`) → show the welcome message.

**Refactor (no behavior change in this step):** extract the DB side into a module-level async helper `createEventFromQuote(quot, lead, eventDetails)` that returns `{eventId}`. `LeadDetail` keeps working by calling it; the quote page will call the same helper. `ConvertLeadModal` stays a shared modal for collecting/confirming event details, rendered by whoever launches the convert.

This is the riskiest piece — it's the core funnel — so it ships as its own step and is regression-tested before anything else changes.

---

## B. Quote page — `Confirm` branches by origin

Replace `QuotationDetail.doConfirmQuote` with origin-aware logic:

- **Event-origin** (`quot.event_id` set): unchanged — mark `approved` + `createInvoiceFromQuote` → go to event. Button: **"Confirm & create invoice"**.
- **Lead-origin** (`quot.lead_id`, no `event_id`): mark `approved` (if not already) → open `ConvertLeadModal` (prefill event name from `quot.event_name`, date from the lead's `tentative_date`) → on confirm run `createEventFromQuote` → navigate to the new event. Button: **"Confirm & create event"**.
- **Idempotent:** a quote already `approved` but with no event still offers Confirm → create event (covers leads confirmed under the old flow).

Gating unchanged: Confirm hidden for `rejected/expired/superseded/converted` and once an invoice is issued.

---

## C. Slim the Lead detail

- **Remove** the quote-stage buttons: Continue quote, Revision requested, Generate revised quote, Quote confirmed, Convert to event.
- **Keep:** Mark contacted (`new`→`contacted`), **Generate first quote** (shown only when no quote exists yet — still uses the lead's in-place wizard to create the first quote), Lost, Edit, and the stage chip (read-only progress).
- **When a quote exists:** show **"Open active quote →"** (navigates to the quote page) in place of the removed buttons; the Quotations list rows already navigate there (Phase 1).
- Remove the `ConvertLeadModal` mount from the lead (conversion now launches from the quote page).
- Remove the now-unused `viewQuotId` state (modal mount already gone in Phase 1).

The lead keeps the in-place `QuoteGenerationWizard` **only** for first-quote generation; revise/continue are handled on the quote page.

---

## D. Event detail (consistency)

The event's quote rows already navigate to the quote page (Phase 1). Change the event's active-quote **"✏️ Revise"** button to **"Open quote →"** (navigate) so revise lives only on the quote page — no second in-place wizard. (The event keeps "+ Generate invoice" and its own event-level actions.)

---

## E. Retire the dead modal

Delete the now-unused `QuotationDetailModal` component (no mounts since Phase 1).

---

## Dependencies / side effects

- **Conversion relocation is the main risk** — `createEventFromQuote` must preserve every step (client, event, item mirroring, invoice, links, lead-stage write-back). Refactor, don't duplicate; test the full path.
- **In-flight leads** at `quote_confirmed` (old flow, not yet converted): the idempotent quote-page Confirm handles them.
- **`quote_revision_pending` stage** becomes unused (no button sets it) — harmless; existing rows stay valid; revise happens directly on the quote page.
- **Landing/back-nav:** confirming a lead-origin quote lands on the new event (as today). Welcome message can stay (shown after convert) or be dropped — decide during build.
- **Direct event creation** (Events module "New event") is independent and unaffected.
- **No DB migration.**

---

## Build order

1. Extract `createEventFromQuote` helper from `handleConvert`; lead calls it (no behavior change). Verify lead→event still works.
2. Quote page: lead-origin `Confirm → ConvertLeadModal → createEventFromQuote`; event-origin unchanged. Idempotent for already-approved.
3. Slim the lead: remove quote-stage buttons, add "Open active quote →", keep first-quote generation + lost + contacted + edit; remove the lead's ConvertLeadModal mount + dead state.
4. Event: Revise button → "Open quote →".
5. Delete `QuotationDetailModal`.
6. Transpile-verify + test matrix + changelog.

## Test matrix (before sign-off)

- Lead, no quote: Generate first quote · Mark contacted · Lost · Edit all work.
- Lead with a draft quote: lead shows "Open active quote →"; quote page Edit continues the draft in place.
- Lead-origin sent quote: quote-page Revise → new revision supersedes; lead stage → revised_quote_sent.
- **Lead-origin Confirm on the quote page → ConvertLeadModal → event + draft invoice created + lead converted → lands on the event.**
- In-flight lead already `quote_confirmed`: quote-page Confirm converts it.
- Event-origin quote Confirm → invoice only, no new event.
- Event quote row + Revise → open the quote page.
- End-to-end: Lead → Quote → Revise → Confirm → Event → Invoice.
