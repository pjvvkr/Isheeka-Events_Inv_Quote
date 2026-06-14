# v22 — Refunds & reversals (client + vendor) — Plan

**Status:** Approved in principle; awaiting final go-ahead to build. Bundled with event cancellation.

## Concept (symmetric two-sided money handling)
- **Client payments (money in)** on a cancelled/affected event: **Refunded** (given back → reverse, reduces collected) or **Retained** (non-refundable advance / cancellation fee kept). Partial supported (refund some, retain the rest).
- **Vendor payments (money out)**: **Recovered** (vendor refunds you → reverse, reduces cost) or **Lost** (write-off, stays a cost). Partial supported.

## Storage
- A refund is a **negative `is_refund` row** in the same ledger: `invoice_payments` (client) / `vendor_payments` (vendor). Any `sum(amount)` nets it automatically (collected, cost). Originals stay intact for audit.
- **Migration:** add `is_refund boolean default false` to **both** `invoice_payments` and `vendor_payments`. (`vendor_payments` already has void columns from #66; this is additive.)

## Helpers
- `recordClientRefund(invoice, amount, reason, date)` → insert negative `invoice_payments` row; roll back `invoices.total_received`/`total_outstanding`/status.
- `recordVendorRefund(eventVendor, amount, reason, date)` → insert negative `vendor_payments` row; roll back `event_vendors.total_paid`/`outstanding`/status + installment.
- Guards: refund ≤ net collected/paid; amount > 0.

## Cancel modal (forced choice — both sections)
When the event has client payments and/or vendor payments, the cancel modal shows two sections:
- **Client money** — per invoice with collected > 0: Refunded / Retained, with a refund-amount field (default full) for partial.
- **Vendor money** — per vendor with paid > 0: Recovered / Lost, with a recovery-amount field (default full) for partial.
- **Cancel is blocked until every line is marked** (force a choice). On confirm: post refunds for Refunded/Recovered amounts; Retained/Lost stay as-is.

## Standalone (post-cancel / any-time) actions
- **Invoice detail → "Record client refund"** (money returned to a client; also for non-cancellation refunds).
- **Vendor Payments (+ event vendor row) → "Record refund / reverse payment"** (vendor returned money).
- These are the correction path when refunds settle after the cancellation or circumstances change.

## Reports / books treatment
- **Collected** nets refunds automatically (negative rows). Dashboard already excludes cancelled-invoice payments (#73); will keep consistent.
- **Profit for cancelled events** uses **net retained client money as revenue** (decision): `profit = net collected (retained) − event expenses − net vendor cost`, instead of the fee-based 0. Non-cancelled events stay fee-based. Implemented via an `eventRevenue(id)` that switches on event status.
- Refund rows shown with a "Refund" tag (negative) in the Vendor Payments / invoice payment lists.

## Build order
Schema check → migration (is_refund ×2) → `recordClientRefund` + `recordVendorRefund` → cancel-modal two-section forced-choice handling → standalone refund actions (invoice detail + vendor payments) → Reports `eventRevenue` switch + refund display → transpile/verify → changelog.

## Notes
- App never moves money; it records the refund — actual transfer happens offline (same as collected payments).
- Permission: admin/manager intent (role is a placeholder today → effectively all-admin).
