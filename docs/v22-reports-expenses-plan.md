# v22 — Expenses, Vendor Payments & Reports — Implementation Plan

**Status:** Awaiting approval. No code written yet. Mockups approved.
**Goal:** Add expense tracking, event-tied vendor-payment recording, and a Reports dashboard (on-screen + PDF/Excel export) with profitability on the locked model.

---

## Profitability model (locked)

- **Per-event profit** = event fee − event-specific expenses − event-specific vendor payments.
  - **event fee** = grand total billed on the event's non-cancelled invoice(s).
  - **event expenses** = Σ `expenses.amount` where `event_id` = event.
  - **event vendor payments** = Σ `vendor_payments.amount` where `event_id` = event.
- **Period profit (month / quarter / year)** = Σ(per-event profit for events whose **`main_date`** falls in the period) − Σ(general/overhead **expenses dated** in the period, i.e. `event_id` is null).
- Headline income basis = **billed (fee)**; collected vs outstanding shown alongside for cash visibility.

---

## Step 0 — DB schema check (before any code)

Confirm live columns/enums (like the invoice Phase-2 lesson) for: `expenses`, `vendors`, `event_vendors`, `vendor_payments`, `vendor_installments`. Per `v22-db-schema.md` they exist:
- `expenses`: category(NN), sub_category, description(NN), amount(NN), date(NN), payment_mode, reference_number, event_id, receipt_url, is_recurring, recurring_frequency, notes, audit/soft-delete. Enums: category ∈ {marketing, operations, travel, staff, event_incidentals, professional, banking, miscellaneous}; payment_mode ∈ {cash, neft, upi, cheque}; recurring_frequency ∈ {monthly, quarterly, yearly}.
- `vendors`: category ∈ {caterer, decorator, photographer, sound_lighting, venue, transport, makeup, entertainment, other}; status ∈ {active, inactive}; name; UNIQUE? (verify).
- `event_vendors`: event_id(NN), vendor_id(NN), vendor_name, service_description, agreed_amount, total_paid, outstanding, status ∈ {pending, partially_paid, paid}, rating, notes, audit/soft-delete.
- `vendor_payments`: event_vendor_id(NN), installment_id(NN), vendor_id(NN), event_id(NN), amount(NN), payment_date(NN), payment_mode, reference_number, notes, recorded_at, recorded_by.
- `vendor_installments`: status ∈ {pending, partially_paid, paid, overdue}.

⚠ `vendor_payments.installment_id` is **NOT NULL** in the doc — confirm. If NN with an FK to `vendor_installments`, the minimal flow must create a vendor_installment per payment (or relax the column). **This is the one schema risk to resolve in Step 0** (mirrors the invoice_payments.installment_id constraint we already handle). Migration only if needed.

No migration expected otherwise — all tables exist.

---

## Phase 1 — Expenses module

- `ExpensesModule`: metrics (this month / year / event-linked / overhead), search (description/reference), filters (category, event/general, date range), list, **+ Record expense**.
- `ExpenseForm`: description, amount, date, category + sub-category, **link-to-event (optional → general if blank)**, payment mode, reference, recurring toggle (+ frequency), receipt attachment (storage `quotations` bucket, `receipts/expenses/` path), notes.
- Writes `expenses`; `recorded_by` resolved via `_currentUid()`. Soft-delete.
- Sidebar **Expenses** stub → real module.

## Phase 2 — Vendor payments (event-tied)

- **Per-event "Vendors & payments" section** on Event detail: list event_vendors (vendor, service, agreed, paid, balance, status); **+ Add vendor** (pick existing vendor or create one in `vendors`; service; agreed amount → `event_vendors`); **+ Pay** per vendor (amount, date, mode, reference, receipt → `vendor_payments`; recompute `event_vendors.total_paid/outstanding/status`). Section shows "Vendor cost: paid / outstanding / agreed".
- **`VendorPaymentsModule`** (sidebar stub → real): searchable list across events — columns Date, Vendor/service, **Event (ref E-26-#### clickable → opens an event quick-view popup)**, mode, amount; metrics (paid this month/year, outstanding to vendors); filters (event, vendor, date); **+ Record payment** (Event required searchable select → vendor pick/create → amount/date/mode/ref/receipt). Same `vendor_payments` writes as the event section (in sync).
- **Event quick-view popup**: a light modal showing event ref/name/date/client/status + a financial mini-summary + "Open full event →"; opened from the event-ref link (no full navigation away).

## Phase 3 — Reports dashboard

- `ReportsModule` (sidebar stub → real), date-range selector. Reads: `invoice_payments`, `invoices`, `leads`, `quotations`, `events`, `expenses`, `vendor_payments`.
- Widgets: KPIs (revenue collected, outstanding, expenses, net profit + margin); revenue-collected-over-time; income vs expenses (monthly); pipeline by stage (count + value); upcoming events (+ optional month grid); **profitability** — per-event P&L table + period roll-up per the locked model.
- Helpers: `eventFee(eventId)`, `eventCost(eventId)` (= expenses + vendor_payments), `eventProfit`, `periodProfit(range)`; all computed client-side.
- Drill-down: clicking a figure opens the underlying records (events list / invoices / expenses), event refs via the quick-view popup.

## Phase 4 — Exports

- **PDF**: branded report via jsPDF (reuse the PDF helpers) — KPIs + tables.
- **Excel**: add **SheetJS** (xlsx) from the approved CDN; export the per-event P&L + expense/vendor ledgers as sheets.

---

## Dependencies / risks

- **`vendor_payments.installment_id` NOT NULL** (Step 0) — the minimal vendor flow may need to auto-create a `vendor_installment`, or a tiny migration to relax it. Resolve before Phase 2.
- Profitability accuracy depends on disciplined expense + vendor-payment entry (now both have UIs).
- Excel export needs the SheetJS CDN (pin a version).
- All amounts client-side aggregation — fine at this scale.

## Build order

Step 0 (schema check) → Phase 1 (Expenses) → Phase 2 (vendor payments: event section + module + event popup) → Phase 3 (Reports) → Phase 4 (exports). Each pushed/tested before the next.

## Test matrix (high level)

- Record a general expense and an event-tagged expense → both appear, metrics split correctly.
- Add a vendor to an event + record a partial payment → event section + Vendor Payments module both reflect it; event_vendors balance/status update.
- Vendor Payments module: search by vendor/event ref; click event ref → quick-view popup opens.
- Reports: per-event profit = fee − event expenses − event vendor payments; period profit rolls up event profits − overhead; KPIs reconcile.
- Export PDF + Excel reproduce the on-screen numbers.
