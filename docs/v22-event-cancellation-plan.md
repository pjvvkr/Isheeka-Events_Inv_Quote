# v22 — Event Cancellation — Proposal & Implementation Plan

**Status:** Proposal for review. No code written yet.
**Goal:** A proper, dependency-aware "Cancel event" flow that captures a reason, shows the full upstream/downstream impact before confirming, and cleans up linked records consistently — instead of the current raw status flip that ignores invoices, vendors, money, and the lead.

---

## Today (the gap)
`cancelled` is already in the event status enum and the status dropdown can select it, but doing so only writes `events.status='cancelled'`. Nothing downstream is reconciled: issued invoices stay open, vendor installments keep showing as overdue, collected money isn't flagged for refund, and the source lead is untouched. There is no reason captured and no impact warning.

---

## Dependency map (what a cancellation touches)

**Upstream (led to the event)**
- **Lead** (`events.lead_id`) — usually at stage `event_triggered`/`completed`. Left as-is; a note is added; optional "reopen lead" later (out of scope v1).
- **Quotation(s)** (`event.quotation_id`, `quotations.event_id`) — kept as historical record (status unchanged). They're no longer actionable once the event is cancelled.

**Downstream (created from the event)**
- **Invoices** (`invoices.event_id`) — the main concern (see matrix).
- **Invoice payments** (`invoice_payments`) — collected money → potential refund (handled offline; app only flags the amount).
- **Vendor engagements** (`event_vendors`) → **vendor_installments** (schedule/overdue) + **vendor_payments** (money out).
- **Expenses** (`expenses.event_id`) — already incurred → sunk costs, kept for P&L.
- **Sub-events** — child rows, kept with the cancelled event.

---

## Handling matrix (proposed)

| Linked record | State | On cancel |
|---|---|---|
| Invoice | draft / issued, unpaid | Void → `status='cancelled'` (auto) |
| Invoice | partially or fully paid | **Keep** as record + mark `cancelled`; surface **refund due = ₹ collected** (no auto-refund) |
| Vendor installments | unpaid | Cancel (clear due dates / remove) so they stop showing overdue |
| Vendor payments | already paid | Keep (sunk cost), surfaced in the summary |
| Expenses | any | Keep (sunk cost), surfaced in the summary |
| Sub-events | — | Kept (children of the cancelled event) |
| Source lead | any | Unchanged + note "Event E-… cancelled (reason)"; no auto-reopen v1 |
| Quotation(s) | converted/approved | Unchanged (historical) |

---

## DB changes (one small migration)
`events` gains: `cancellation_reason text`, `cancelled_at timestamp`, `cancelled_by uuid` (all nullable, non-breaking).
- `events.status` already supports `cancelled` (no change).
- `invoices.status` already supports `cancelled` (used in Reports + an existing invoice-cancel path).
- `vendor_installments`: unpaid ones are deleted on cancel (no status-enum dependency); paid-linked ones stay.
No other schema changes expected (will confirm with a schema check before building).

---

## UI / flow
1. **"⛔ Cancel event" action** on the event detail (next to "Mark completed"), visible unless already `cancelled`.
2. Opens a **Cancel event modal** that, before anything happens, shows a live **impact summary**: invoices (count + statuses + ₹ billed + ₹ collected), vendor commitments (₹ agreed / ₹ paid + # installments to cancel), expenses (₹), sub-events count, and the source lead.
3. **Reason is required** (free text), captured to `cancellation_reason` + `cancelled_at` + `cancelled_by`.
4. **Explicit checklist of what will happen** (auto-void unpaid invoices; cancel unpaid vendor installments; keep paid invoices/vendor payments/expenses as records; flag refund-due if money was collected).
5. On confirm: set event cancelled + audit fields → cascade per the matrix → toast summary.
6. **Reopen event** action on a cancelled event restores `status='planning'` (status-only; it does **not** auto-un-void invoices or recreate installments — those are flagged as manual). Reason/audit retained.

**Edge cases handled**
- Fully-paid invoice → allowed with a prominent "₹X collected — arrange refund offline" warning (configurable: could hard-block instead — your call).
- Already `completed` event → cancellation allowed with an extra confirmation (covers post-delivery cancellations/chargebacks).
- Event with nothing linked → simple one-click confirm.
- Re-cancelling / double-submit guarded.

---

## Reports impact (decision needed)
A cancelled event with voided invoices has **fee = 0** (Reports already excludes `cancelled` invoices) but its **expenses + vendor payments remain** → it shows as a **net loss** (sunk costs). Two options:
- **(A, recommended)** Keep cancelled events in profitability, clearly flagged, so real sunk-cost losses are captured.
- **(B)** Exclude cancelled events from Reports entirely (cleaner headline, hides the loss).

---

## Locked decisions (confirmed)
1. **Paid-invoice cancel:** ALLOW — keep the paid invoice as a record, mark event cancelled, surface "refund ₹X — arrange offline". App never moves money.
2. **Reports:** INCLUDE cancelled events as sunk-cost losses, clearly flagged (fee 0 from voided invoices; expenses + vendor payments remain → shows the real loss).
3. **Reopen:** STATUS-ONLY + GUIDED REBUILD — reopen sets status→planning; a detect-driven banner offers one-click "Regenerate invoice from quote" (when no active invoice + a source quote exists) and "Re-add vendor schedule" (per vendor with an agreed amount but no installments). No auto un-void; money records untouched.
4. **Permission:** ADMIN & MANAGER only — staff cannot cancel or reopen.

## Build order (after approval)
Schema check → migration (3 columns) → Cancel modal + impact summary + reason → cascade logic (invoices/installments) → reopen → Reports treatment → vendor-installment overdue suppression for cancelled events → transpile/verify → changelog.
