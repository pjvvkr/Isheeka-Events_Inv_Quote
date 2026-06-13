# Isheeka ERP v22 — Static QA pass (overnight, 13 Jun 2026)

Static code review of the invoice / quote / dashboard / 3b work. **No code changed** — this is a findings list for us to triage tomorrow. Ranked by severity. Nothing here blocks what's already shipped; most are edge cases that surface once payments (Phase 4) exist.

Verification done: each new/edited component transpiles clean in isolation; schema cross-checked against `v22-db-schema.md`; scanned for stale column names (none), bad enum literals (none).

---

## A. Correctness — worth fixing soon

**A1 · Installment `due_date` is never populated → "overdue" can never trigger.**
Installments are created with `due_date = null` (only `when_text` like "On confirmation" is stored). Nothing converts `when_text` + the event date into an actual `due_date`. Consequence: the `overdue` status and the dashboard/receivables "overdue" counts can never compute. *Fix (with Phase 4): derive installment `due_date`s — e.g. advance = doc date, balance = event date, others from `settings.default_invoice_due_days` — and add an overdue check (due_date < today & balance > 0).*

**A2 · Revise / GST-toggle don't recompute installment or invoice status.**
`handleRevise` and `toggleGst` rescale each installment's `amount_due`/`balance` but leave its `status` (and the invoice `status`) untouched. Today this is harmless because `amount_paid` is always 0 (payments = Phase 4), so balance always = amount_due and "pending" is correct. **But once payments exist:** revising could leave a `paid` installment with a positive balance, or an invoice marked `partially_paid` whose totals changed, without the status catching up. *Fix (with Phase 4): after any total change, recompute each installment status (paid/partially_paid/pending) and the invoice status from amount_paid vs amount_due.*

**A3 · Revising below amount already received isn't guarded.**
In `handleRevise`, `total_outstanding = max(0, newGrand − received)`. If a revision drops the grand total below what's been received, outstanding clamps to 0 but the invoice isn't flagged as over-paid and status isn't revisited. Moot until payments; flag for Phase 4.

---

## B. Robustness — multi-table writes not atomic

**B1 · `handleRevise` is a 4-step non-transactional write.**
It (1) soft-deletes line items, (2) inserts new ones, (3) updates the invoice header, (4) rescales installments. Each step is guarded with its own error toast, but a failure mid-sequence (e.g. after soft-deleting items but before inserting) could leave the invoice in a partial state. Same known limitation as event-save / conversion / `createInvoiceFromQuote`. *Fix: fold into the planned post-baseline RPC pass (wrap these flows in Postgres functions so they're all-or-nothing).* Low probability on a single-user app; logged for completeness.

**B2 · `createInvoiceFromQuote` rollback is best-effort.**
On a child-insert failure it deletes the partial invoice — good — but those deletes themselves aren't error-checked. Acceptable; same RPC pass will supersede it.

---

## C. Minor / cosmetic

**C1 · "Sent" logs an attempt, not confirmed delivery.** WhatsApp/Email just open a URL/app; we log `action='sent'` optimistically. Can't truly confirm the client received it. Acceptable, but the label implies certainty.
**C2 · Dashboard "Quoted this month" can include rejected/expired quotes.** It sums all non-superseded quotes dated this month. Defensible (it's "quoting activity"), but if you want *only live* quotes, exclude rejected/expired.
**C3 · Date timezone edge.** Dashboard month/`doc_date` comparisons use `new Date('YYYY-MM-DD')` (parsed as UTC) vs a local month start — a quote dated the 1st could land in the wrong month near midnight. Negligible for this use; note for reports.
**C4 · `_currentUid` runs an extra `users` lookup per log write.** Fine at this volume; could cache the resolved id at app level later.
**C5 · Revise modal lets you set a negative discount or discount > subtotal.** `taxable` clamps at 0, so no crash, but no validation message. Add a guard when convenient.

---

## D. Verified GOOD (no action)

- No stale column names (`amount_received` etc.) anywhere — all invoice writes use the real schema columns.
- All status/enum writes use values allowed by the DB CHECK constraints (invoice status, quote status, channel).
- The `*_by` FK bug is fixed — `_currentUid` resolves to a real `users.user_id` or null.
- Cancelled invoices are correctly excluded from dedupe, the event "Generate invoice" button, and payment-summary totals.
- Name-change cascade is correctly scoped to active (unsent) documents.
- Each new component (Dashboard, Quotations module, Invoices module, InvoiceDetail, QuotationDetailModal, PDF builder) transpiles clean.

---

## E. Pending build items (not bugs — planned)

1. **Draft auto-refresh** (3b-ii decision #12) — refresh an unsent draft invoice when a newer quote is confirmed. Isolated follow-up (touches `createInvoiceFromQuote` money-path).
2. **Phase 4 — record payments** + auto balance/status. Unblocks A1/A2/A3, the "overdue" logic, and dashboard "Collected this month".
3. Post-baseline: wrap multi-table flows (event-save, conversion, createInvoiceFromQuote, handleRevise) in Postgres RPCs for atomicity (B1/B2).

---

## F. Suggested test plan for when you're back (live, together)

Lead→Quote→Event→Invoice happy path: create lead → quote → confirm → convert → verify auto-invoice → revise invoice (reason + change-log entry) → mark sent → share (WhatsApp/Email → activity logs) → preview/download PDF (GST line, installments, balance) → edit client (contact cascades; name cascades to active docs only) → dashboard reflects counts. Plus the cancel→regenerate path and the superseded-revision collapse.
