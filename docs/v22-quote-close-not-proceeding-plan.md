# v22 — "Close — not proceeding" (declined / withdrawn) — Plan

**Status:** Approved in principle; awaiting final go-ahead. No migration.
**Goal:** Cleanly close a quote (and its lead) that won't proceed — two scenarios: (1) **client declines** a sent quote, (2) **we withdraw** an approved quote we can't fulfil. Works for both entry paths (lead-origin and direct-from-Quotations), with consistent status + display and no side effects.

## Locked decisions
1. **Two outcomes:** *Client declined* vs *We withdrew / can't fulfil*, each with its own reason list (client: price/competitor/postponed/no-response/other; us: scheduling conflict/capacity/out-of-area/other) + notes.
2. **Bidirectional sync:** closing the quote marks the lead Lost; marking the lead Lost rejects its active quote.
3. **Terminal:** rejected is final; to pursue again, revise/generate a new quote (lead can be edited out of Lost as today). No explicit reopen.
4. **Storage:** quote → `status='rejected'`; outcome + reason + notes recorded in `quotation_activity_log` (`action='rejected'`, `notes='<outcome> — <reason>: <free text>'`). No schema change.

## Behaviour
- **Action:** "✕ Close — not proceeding" on the **quote page** (QuotationDetail), shown when the quote is `draft/sent/approved` and **not converted to an event** and not already `rejected/expired/superseded`. (If converted → directed to **Cancel event**, which already handles the lead.)
- **Modal:** Outcome (Client declined / We withdrew) → reason (list adapts) → notes → confirm.
- **Cascade:**
  - Quote → `rejected` + activity-log entry (audit + display source).
  - **Lead-origin** → lead → `lost`, `lost_reason` mapped from the chosen reason (client reasons map to existing values; "we withdrew" reasons map to `out_of_service_area`/`other` with specifics in `lost_notes`), `lost_notes` = outcome + notes.
  - **Direct quote (no lead)** → quote only.
  - Sibling revisions already `superseded`; the active revision is the one rejected.
  - No invoice exists pre-conversion → nothing downstream to unwind.
- **Lead-side sync:** the lead's existing **Mark Lost** flow, when an active (non-superseded/expired/converted) quote exists, also sets that quote to `rejected` with a matching log entry — so the two never diverge.

## Display
- **Quote page + Quotations list:** red **Rejected** chip (already styled); page shows the reason/outcome from the latest `rejected` log entry; Close action hidden once rejected.
- **Lead:** **Lost** badge + reason (already styled); the lost banner shows notes.
- **Reports/pipeline:** rejected quotes + lost leads are already excluded from active pipeline; "we withdrew" reasons are distinguishable in the lead loss reason for honest win/loss reporting.

## Entry paths
- **Lead → quote:** close from the quote page (syncs lead) or mark the lead Lost (syncs quote).
- **Direct quote (Quotations module):** close from the quote page; no lead to touch.

## Side-effect guards
- Action gated to non-converted, non-terminal quotes (converted → Cancel event).
- Bidirectional sync only touches the *active* quote (skips superseded/expired/converted).
- Activity-log insert wrapped in try/catch (non-blocking, like existing send logging).
- `LEAD_LOSS_REASONS` gains the "we" reasons (frontend const; `lost_reason` is free text → no migration). Confirm `quotation_activity_log.action` accepts `'rejected'` (free-text per schema doc).

## Build order
Add reason lists → `closeQuoteNotProceeding(quot,{outcome,reason,notes})` helper (status + log + lead sync) → quote-page Close action + modal (gated) → lead Mark-Lost also rejects active quote → display reason on quote page → verify + changelog.
