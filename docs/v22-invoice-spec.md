# Isheeka ERP — Invoice Module Spec & Build Plan

**Created:** 12 Jun 2026 · Draft for approval before build.
Based on confirmed decisions: installment billing, flexible per-invoice GST (rate set in Settings), draft auto-created at quote-confirmation + generate-from-event, and manual payment capture (UPI/Bank/Cash/Cheque) with auto-balance.

---

## 1. Confirmed behaviour

- **Billing = installments**, mirroring the quote's payment schedule (e.g. advance / pre-event / balance), each with its own due date and balance.
- **GST = flexible per invoice.** A "GST applicable?" toggle on the invoice. When ON, apply the **GST %** configured in Settings → Financial. When OFF, no tax.
- **Creation:** a **draft** invoice is auto-created when a quotation is confirmed and the lead converts to an event (seeded from the approved quote). Also a **"Generate invoice"** action on the Event → Invoices tab (covers existing events + regeneration). Swathi reviews, sets GST, marks Sent.
- **Payments:** manual capture (amount, date, mode = UPI/Bank-NEFT/Cash/Cheque, reference, notes), linked to invoice + installment + event; auto-updates installment balance and invoice outstanding + status.

---

## 2. Data model (existing tables + needed migration)

Existing tables are good. **Gap:** `invoices` lacks tax/discount/due-date fields, and `settings` lacks a GST rate.

### Migration (Phase 0 — you run in Supabase)
Includes the **Event reference** enhancement (EV-26-####), since invoices display it.
```sql
-- A) Invoice GST / discount / due date
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS gst_applicable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS gst_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date date;

-- B) Configurable GST rate in Settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gst_pct numeric DEFAULT 18;

-- C) Event reference number
ALTER TABLE events ADD COLUMN IF NOT EXISTS ref_number text;

-- D) Allow 'event' in the counters type check
ALTER TABLE counters DROP CONSTRAINT IF EXISTS counters_type_check;
ALTER TABLE counters ADD CONSTRAINT counters_type_check
  CHECK (type = ANY (ARRAY['quotation','invoice','lead','client','event']));

-- E) Backfill existing events with EV-26-#### (creation order)
WITH numbered AS (
  SELECT event_id, row_number() OVER (ORDER BY created_at) AS rn
  FROM events WHERE COALESCE(is_deleted,false) = false
)
UPDATE events e SET ref_number = 'EV-26-' || lpad(numbered.rn::text, 4, '0')
FROM numbered WHERE e.event_id = numbered.event_id
  AND (e.ref_number IS NULL OR e.ref_number = '');

-- F) Seed the event counter so new events continue the sequence
INSERT INTO counters (type, year, current_value, updated_at)
VALUES ('event','26',(SELECT count(*) FROM events WHERE COALESCE(is_deleted,false)=false), now())
ON CONFLICT (type, year) DO UPDATE SET current_value = EXCLUDED.current_value, updated_at = now();
```
**Expected:** A–D and F → `Success. No rows returned`; E (backfill) affects N rows. Verify with `select ref_number, event_name from events order by ref_number;` — existing events should now show `EV-26-0001`, `EV-26-0002`, …

### Totals logic
```
subtotal        = Σ line item amounts
discount_amount = optional
taxable         = subtotal − discount_amount
tax_amount      = gst_applicable ? round(taxable × gst_pct/100) : 0
grand_total     = taxable + tax_amount
total_received  = Σ invoice_payments.amount
total_outstanding = grand_total − total_received
```
Installment `amount_due` = percentage × grand_total; `balance` = amount_due − amount_paid.

---

## 3. Invoice lifecycle (status)

`draft → sent → partially_paid → paid` · plus `overdue` (a due date passed with balance) and `cancelled`.
- **draft:** created, editable, not yet shown to client.
- **sent:** issued to client.
- **partially_paid / paid:** derived automatically from payments vs grand_total.
- **overdue:** any unpaid installment past its due date (computed/badged).
- **cancelled:** voided (soft).

Ref number: **`I-YY-####`** via the atomic `next_counter` (invoice counter already exists at 1110 → first new = 1111). *(Prefixes standardized to single letter for consistency: `Q-` quote, `E-` event, `I-` invoice.)*

---

## 4. Screens

### 4a. Invoices module (new — nav "Invoices")
- **List:** ref, client, event, status badge, grand total, **received**, **outstanding**, doc date; filters (status), search (ref/client). 
- Row click → Invoice detail.

### 4b. Invoice detail
- Header: ref, client · event, status badge.
- **GST control:** "GST applicable" toggle + shows the rate from Settings; recalculates tax + grand total live.
- Line items (from the quote/event), subtotal, discount, tax, grand total.
- **Installments** table: #, %, amount due, paid, balance, due date, status.
- **Payments** section: list of payments + **"Record payment"** button.
- Totals: received / outstanding (auto).
- Actions: Mark Sent · Download PDF · (Cancel).

### 4c. Record-payment modal
- Fields: amount*, date*, mode* (UPI/Bank-NEFT/Cash/Cheque), apply-to-installment (optional dropdown), reference number, notes.
- On save: insert `invoice_payments`; update the installment's `amount_paid`/`balance`/`status`; recompute invoice `total_received`/`total_outstanding`/`status`. All via the atomic/`runDb` pattern.

### 4d. Event → Invoices tab
- Lists invoices for the event; **"Generate invoice"** if none; click → invoice detail.

### 4e. Settings → Financial
- New **"GST %"** field (default 18) — used when an invoice has GST applicable.

---

## 5. Invoice PDF
Reuse the branded `buildQuotationPDF` engine with `docType='invoice'`: header says "Invoice: INV-YY-####", shows line items, **GST line when applicable**, grand total, **installment schedule with due dates**, and **amount received / balance**. Same look as the quotation PDF.

---

## 6. Phased build plan (each phase = reviewable, deployable)

| Phase | Scope | Type |
|---|---|---|
| **0** | DB migration: invoice GST/discount/due cols, settings.gst_pct, event ref infra + backfill | SQL (you run) |
| **1** | Foundations: generate + display **event refs** (Events list/detail, on creation via wizard + conversion); add **GST %** field to Settings | Code |
| **2** | Invoice creation: draft-from-quote at conversion + "Generate invoice" on event; seed line items + installments; `INV-YY-####` ref | Code |
| **3** | Invoices module (standalone list + filters) + Invoice detail (GST toggle, totals, installments, status, mark sent); wire nav | Code |
| **4** | Record-payment modal + auto balance/status; payments list | Code |
| **5** | Invoice PDF (GST line, installments, received/balance) | Code |
| **6** | **Invoice revision + variance/audit** (see §8) | SQL + Code |
| *(later)* | Payment reminders via `payment_notifications` (e.g. WhatsApp) | Code |

**Sequencing: strict phase-by-phase** (0→1→2→3→4→5), each deployed + smoke-tested before the next.

---

## 7. Resolved decisions (12 Jun 2026)
1. **Standalone Invoices module** in the sidebar (list all invoices, filter by status — best for chasing receivables) **+** shown on each event's Invoices tab. ✅
2. **Status set:** draft / sent / partially_paid / paid / overdue / cancelled. ✅
3. **Discount on invoices:** allowed (optional invoice-level discount, separate from the quote). ✅
4. **Phasing:** strict phase-by-phase. ✅
5. **Revision + audit:** built as the **final phase** (Phase 5), after the core invoice works. ✅

### 7b. Decisions — session 2 (12 Jun 2026)
6. **No manual invoice creation.** Invoices are created only by automation. The single trigger is **a quotation being confirmed/approved** (unifies both flows):
   - *Path A (Lead → Quote → Event):* lead "Quote confirmed" sets the active quote → `approved` (already at line 3266); the auto-create hooks here. (Conversion then also stamps `event_id`.)
   - *Path B (Event → Quote-from-event):* event-origin quotes currently have no confirm action — **Phase 2 adds a "Confirm quote" action** (QuotationDetailModal / EventDetail) that sets the quote → `approved`, which fires the same auto-create.
   - The event's Invoices tab keeps a **"Generate invoice" safety-net** button only (re-create if the auto-step failed) — never a from-scratch manual builder.
7. **In-creation / last-minute edits → mandatory reason + mismatch warning + change log.** Editing an invoice linked to a source quote: (a) warns the invoice will differ from the quote, (b) **requires a reason**, (c) bumps `revision_number`, (d) writes a change-log row (field, old→new, reason, **changed_by = logged-in user**, **timestamp**). Change log is **collapsible**, newest-first, with a running "differs from quote: ±₹X" badge for reconciliation/audit.
8. **Revisions allowed while not paid in full.** Once status = `paid`, Revise is normally locked.
9. **Exception — revising a fully-paid invoice:** **allowed**, behind a **stronger confirmation**, **mandatory reason**, and full change-log documentation. **Restricted to admin (Swathi)** — gated on the app's resolved role. (Role is hardcoded `admin` today per P0-3; gate becomes enforceable once role resolution + role-aware RLS land. `changed_by` still records the real signed-in user.)
10. **"Who" on every change** = the logged-in Supabase auth user, independent of the (currently hardcoded) role.
11. **UI consistency:** the Invoices list/detail reuse the **existing app components and CSS variables** (same list-row pattern, status pills, card styling, fonts/colours) as Leads/Events/Quotations — the chat-rendered mockup was a structural wireframe only, not the in-app styling.

---

## 8. Phase 5 — Invoice revision + variance/audit (spec)

**Need:** last-minute changes to delivered items or ad-hoc discounts mean the billed amount can deviate from the approved quote. Swathi needs to revise an invoice *and* have the system document the deviation for audit.

**Design:**
- **"Revise invoice" action** — edits line items / discount / amounts **in place** on the same invoice row (so recorded payments stay attached and balances stay correct), bumps a `revision_number`, and writes each change to an **audit log** (field, old → new, by whom, when).
- **Variance view** — auto-compares the **current invoice** against the **event's approved/active quotation**: total delta (higher/lower), which line items changed/added/removed, discounts applied. Gives a clear, documented trail of why billing differs from the quote.
- **Migration (Phase 5):**
  ```sql
  ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS revision_number integer DEFAULT 0;
  CREATE TABLE IF NOT EXISTS invoice_activity_log (
    log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid REFERENCES invoices(invoice_id),
    revision_number integer,
    field text, old_value text, new_value text,
    note text, changed_by uuid, changed_at timestamptz DEFAULT now()
  );
  -- (enable RLS + authenticated policy to match other tables)
  ```
- Re-payment integrity: payments remain linked to the invoice; after a revision, installment amounts recompute from the new grand total, and outstanding/status refresh.
