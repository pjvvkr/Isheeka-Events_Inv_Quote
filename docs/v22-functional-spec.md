# Isheeka Events ERP — Functional Specification & Build Status

**File:** `isheeka-erp-v22.html`
**Last updated:** 12 Jun 2026
**Purpose of this doc:** the single source of truth for *what the app does* (and is meant to do), with an honest **Built / Partial / Pending** status for every module — grounded in the actual code, not just prior handoffs.

**Status legend:**
- ✅ **Built** — implemented and working in the live app.
- 🟡 **Partial** — partly implemented, or works via a workaround, or stubbed UI with a real backing table.
- ⬜ **Pending** — not built; "Coming Soon" stub. A backing database table usually exists.

---

## 1. Purpose, Users & Roles

**Purpose.** A single-tenant ERP for **Isheeka Events** (boutique event management, Hyderabad) to run the full commercial workflow: capture enquiries, quote them, win the work, execute the event, bill the client, and track money in/out — replacing spreadsheets + WhatsApp.

**Users.** Swathi (Founder/CEO) and a small staff team. Non-technical; the UI must stay simple and forgiving.

**Roles (intended).** `admin`, `manager`, `staff` — meant to gate navigation and sensitive data.
- **Current reality:** role is **hardcoded to `admin`** in the client (every user sees everything). Database RLS currently allows *any authenticated user* full access. Public sign-up is now disabled, so only accounts created in Supabase can log in. **True role-based access is Pending** (see §13, P0-3).

---

## 2. Core Business Flow (the backbone)

```
LEAD  →  QUOTATION  →  EVENT  →  INVOICE  →  PAYMENTS
                                   ↘ VENDORS / EXPENSES (cost side)
```

1. **Lead** — an enquiry comes in.
2. **Quotation** — one or more quotes are prepared and sent; client may request revisions.
3. **Event** — when a quote is confirmed, the lead converts to an event (carrying client + quote data).
4. **Invoice** — the event is billed; payments are tracked against the invoice.
5. **Vendors & Expenses** — the cost side: vendor bookings/payments and business expenses, feeding profitability.

**Locked rule:** an event cannot exist without a confirmed quotation; a lead can hold multiple quotes but only one approved/converted at a time.

---

## 3. Cross-Cutting Systems

| System | Status | Notes |
|---|---|---|
| **Auth & session** | ✅ | Supabase email/password; 25-min idle warning, 30-min auto-logout; public signup disabled. |
| **Error boundary** | ✅ | App-wide; render crashes show a branded recovery screen, not a white page. |
| **Error handling** | ✅ | All DB writes surface failures via branded toasts + console logging (`runDb` / try-catch); no silent data loss. |
| **Toasts/notifications** | ✅ | Non-blocking branded toasts (`notify`) replaced all blocking `alert()`s. |
| **PDF engine** | ✅ | jsPDF + AutoTable; 3-page branded quotation PDF (cover, body, terms). Invoice PDF path stubbed in code (`docType='invoice'`) but no UI. |
| **Ref numbers** | ✅ | Atomic Postgres `next_counter()`: `Q-YY-####`, `L-YY-####`, `CL-######`, `INV-YY-####` (invoice format reserved). |
| **Security / RLS** | 🟡 | RLS on all tables; only authenticated users; signup disabled. **Not yet role-aware** — every user sees all data incl. owner financials. |
| **Dependencies** | ✅ | All CDN libraries pinned to exact versions. |
| **Performance/scale** | 🟡 | In-browser Babel transpile; list views fetch all rows (no pagination). Fine now; revisit at scale. |

---

## 4. Dashboard 🟡 Partial

**Intended:** at-a-glance home — today's follow-ups, active leads, upcoming events, revenue this month, outstanding invoices.
**Current:** placeholder/summary stub. **Pending:** real widgets wired to live data.

---

## 5. Leads ✅ Built

**Purpose:** entry point for all new business; full sales pipeline.

**List view:** table of leads (ref, name, event type, stage badge, budget, tentative date, assigned-to, created); filters by stage, event type, budget range, assigned-to; live name/phone search; "New Lead".

**Pipeline stages:** `new → contacted → quote_generation_in_progress → quote_sent → quote_revision_pending → revised_quote_sent → quote_confirmed → event_triggered`; plus `lost`.

**Lead form fields:** first/last name*, phone 1*, phone 2, email, source* (from configurable `lead_sources`), referred-by (if source=referral), event type*, tentative date, location/city, budget, guest count, venue preference, stage, assigned-to, notes, follow-up date. (* required)

**Detail view:** header (name, ref, stage badge); view/edit toggle; **stage-aware action buttons** (Generate Quote / Continue Quote / New Revision / Mark Lost / Convert to Event); quotations panel (all quotes for the lead); loss flow (reason + notes → `lost`).

**Key rules:**
- Ref `L-YY-####` (atomic) at creation.
- Editing contact details cascades (with confirm) to linked client + active quotations.
- "Continue Quote" reopens the in-progress draft instead of starting fresh.
- Convert: creates event, sets quote `converted`, lead `event_triggered`.
- Custom lead sources fully supported (DB constraint removed).

**Status:** ✅ Built (full CRUD, pipeline, quote trigger, conversion, error handling).

---

## 6. Clients ✅ Built

**List:** ref, name, phone, email, city, source, status; status filter + search; New Client; **Bulk Upload** (Excel/CSV, per-row success/fail counts).

**Client form:** first/last name*, phone 1–3, email 1–3, address (street/city/state/pincode), source, status (active/inactive), preferred contact, GST number, notes.

**Detail:** view/edit; **alternative contacts** (spouse/PA/relative: name, relationship, phone, email, notes) — add/edit/remove.

**Dedup:** when creating a client from a lead, normalized-phone match check → "link existing or create new" modal.

**Rules:** ref `CL-######` (atomic). **Status:** ✅ Built.

---

## 7. Events ✅ Built

**List:** event name, client, type, status badge, date, assigned-to; filters + search; "New Event" (wizard).

**Statuses:** In Progress → Confirmed → Planning → Completed → Cancelled.

**Detail (tabbed):**
1. **Overview** — name, client (changeable), type, status, dates, venue, budget, guest count, contact person, assigned-to, notes.
2. **Sub-events** — functions within the event (Mehendi/Sangeet/Reception): name, date, location, is-main.
3. **Line items** — services per sub-event (desc, sub-event tag, qty, unit price, amount); fast bulk entry.
4. **Checklist** — tasks (desc, due date, assigned-to, done) with optimistic toggle + revert on failure.
5. **Quotations** — linked quotes (read-only).
6. **Invoices** — linked invoices (🟡 placeholder; depends on Invoices module).

**Flows:** "Use as Reference" (spawn a new lead from an event); **New Event Wizard** (direct creation: client → details → sub-events → line items → review).

**Status:** ✅ Built (Invoices tab depends on §9).

---

## 8. Quotations 🟡 Partial

**What exists (✅):**
- **Quote Generation Wizard** (from a lead): client select/create (+dedup), template-driven line items (filtered to event type), quote details (dates, discount %, payment schedule 50/40/10, additional notes/terms, display options), and share step (PDF download/print, WhatsApp, mark sent).
- **Quotation Detail Modal:** summary, grouped line items, payment schedule, terms; PDF display-option toggles (cover page, prices, qty, grouping, schedule, discount, bank details) with presets; Print/Download PDF; status actions.
- **Revisions/supersession:** new revision supersedes prior; `revision_number`, `parent_quotation_id`.
- **Statuses:** `draft → sent → approved → converted` (+ revision_requested, revised, superseded, rejected, expired).
- Ref `Q-YY-####` (atomic). Client contact now enriched onto the PDF (P1-5 fixed).

**What's missing (⬜):**
- **No standalone Quotations module/list** — quotes are only reachable via a lead or event. The `quotations` nav item shows "Coming Soon". A searchable list (all quotes by ref/client/status/date) is Pending.
- `quotation_activity_log` table exists but no activity-log UI.

**Status:** 🟡 Partial — quoting works end-to-end; the standalone list view is Pending.

---

## 9. Invoices ⬜ Pending

**Backing tables exist:** `invoices`, `invoice_line_items`, `invoice_payments`, `invoice_installments`, `payment_notifications`. PDF code already accepts `docType='invoice'`.

**Proposed spec (for confirmation):**
- Create an invoice from a confirmed event/quotation (carry client, line items, totals).
- Invoice fields: ref `INV-YY-####`, status (draft/sent/partially-paid/paid/overdue), issue date, due date, subtotal, tax, grand total.
- **Installments** (e.g. advance / pre-event / balance) mirroring the quote's payment schedule.
- **Payments** recording: amount, date, mode (cash/UPI/bank/cheque), reference; auto-update status + balance.
- **Payment notifications/reminders** (table exists) — e.g. due/overdue reminders, possibly WhatsApp.
- **Invoice PDF** — reuse the branded engine with `docType='invoice'`.
- Wire the Events detail "Invoices" tab to list/create.

**Status:** ⬜ Pending. *Highest-value functional gap (core to getting paid).*

---

## 10. Vendors & Vendor Payments ⬜ Pending

**Backing tables:** `vendors`, `vendor_payments`, `vendor_installments`, `event_vendors`.

**Proposed spec:**
- **Vendors:** directory (name, category — catering/decor/AV/etc., contact, GST, notes).
- **event_vendors:** assign vendors to an event with agreed cost.
- **Vendor payments + installments:** schedule and record payouts; track outstanding per vendor/event.

**Status:** ⬜ Pending (admin/manager roles).

---

## 11. Expenses & Owner Account ⬜ Pending

**Backing tables:** `expenses`, `owner_expenses`, `owner_reimbursements`.

**Proposed spec:**
- **Expenses:** business expenses (category, amount, date, event-linked or overhead, notes, receipt).
- **Owner Account:** owner-paid expenses + reimbursements tracking (sensitive — should be admin-only once role-based RLS exists).

**Status:** ⬜ Pending.

---

## 12. Reports ⬜ Pending · Users ⬜ Pending

- **Reports:** revenue by month, leads by source, conversion rate, event profitability (revenue − vendor cost − expenses), outstanding receivables. ⬜ Pending.
- **Users:** admin creates/deactivates staff accounts, assigns roles. Currently users are added via the Supabase dashboard. ⬜ Pending (pairs with P0-3 role-based access).

---

## 13. Settings ✅ Built

- **Company:** name, email, phones, website, address, GST, PAN.
- **Financial:** bank name, account no., IFSC, UPI; default validity days; default invoice due days.
- **PDF & Branding:** cover intro paragraph (used on quote PDF cover).
- **Templates:** event-type templates with sub-event-tagged items (Swathi's pricing knowledge) — drives the quote wizard; now shows a "saved" confirmation.
- **Lead Sources:** configurable source list (add/toggle/reorder).

**Status:** ✅ Built. *(Data note: existing templates may need sub-event tags (Mehendi/Sangeet/Reception) for PDF grouping — a data task, not code.)*

---

## 14. Data Model → Module Map (28 tables)

| Module | Tables |
|---|---|
| Leads | `leads`, `lead_sources`, `lead_sub_events` |
| Clients | `clients`, `alternative_contacts` |
| Events | `events`, `sub_events`, `sub_event_items`, `event_checklists` |
| Quotations | `quotations`, `quotation_line_items`, `quotation_activity_log` |
| Templates | `event_templates`, `event_template_items` |
| Invoices ⬜ | `invoices`, `invoice_line_items`, `invoice_payments`, `invoice_installments`, `payment_notifications` |
| Vendors ⬜ | `vendors`, `vendor_payments`, `vendor_installments`, `event_vendors` |
| Expenses ⬜ | `expenses`, `owner_expenses`, `owner_reimbursements` |
| System | `users`, `settings`, `counters` |

---

## 15. Build-Status Summary

| Area | Status |
|---|---|
| Auth, session, error handling, toasts, PDF engine, atomic refs, pinned deps | ✅ Built |
| Leads, Clients, Events (+ wizard), Settings (company/financial/branding/templates/sources) | ✅ Built |
| Quotation wizard, detail modal, revisions, PDF | ✅ Built |
| Dashboard | 🟡 Partial (placeholder) |
| Quotations standalone list | ⬜ Pending |
| Invoices (+ payments/installments/reminders) | ⬜ Pending |
| Vendors & vendor payments | ⬜ Pending |
| Expenses & owner account | ⬜ Pending |
| Reports | ⬜ Pending |
| Users management | ⬜ Pending |
| Role-based access (RBAC + role-aware RLS) | ⬜ Pending |

---

## 16. Recommended Build Order (for the pending work)

1. **Invoices + payments** — closes the core money loop (quote → event → invoice → paid). Highest business value; PDF engine already supports it.
2. **Dashboard** — once invoices exist, the dashboard has real numbers to show (receivables, revenue, follow-ups).
3. **Vendors + vendor payments**, then **Expenses/Owner account** — the cost side, enabling **event profitability**.
4. **Reports** — sits on top of the above.
5. **Users + role-based access (P0-3 + role-aware RLS)** — when staff accounts are added, so staff can't see owner financials.
6. **Quotations standalone list** — quality-of-life; can slot in anytime.

> This spec is a draft for refinement — the pending-module specs (Invoices, Vendors, Expenses, Reports) reflect the database schema and event-management norms, but Swathi's actual process should shape the final details before we build each one.
