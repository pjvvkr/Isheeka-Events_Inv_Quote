# Isheeka ERP v22 — Database Schema (ground truth)

**Authoritative reference.** Built from a live `information_schema` / `pg_policies` dump on **13 Jun 2026** — not from app code or older handoffs. When code and this doc disagree, re-dump and update this doc. Phase 3+ is built only against this.

Conventions: every table has a `<name>_id uuid PK` defaulting to `uuid_generate_v4()`. Most have `created_at`/`updated_at` (timestamp **without** time zone, default `now()`), `created_by`/`updated_by` (uuid), and a soft-delete `is_deleted boolean default false`. "NN" = NOT NULL.

> Sections 2 (constraints/FKs), 3 (RLS policies), 4 (functions) are **pending** the remaining three query outputs and will be filled in next.

---

## 1. Tables & columns (24 tables)

### Core sales pipeline

**leads** — sales pipeline records.
`lead_id` PK · `first_name`(NN) · `last_name`(NN) · `phone` · `phone_2` · `email` · `source` · `event_type` · `tentative_date` · `location` · `venue_preference` · `budget` · `guest_count` · `stage`(NN, def `'new'`) · `lost_reason` · `lost_notes` · `lost_at` · `follow_up_date` · `client_id` · `originated_by` · `assigned_to` · `referred_by` · `active_quotation_id` · `converted_at` · `converted_by` · `event_id` · `notes` · `ref_number` · audit/soft-delete cols.

**lead_sub_events** — sub-events captured at lead stage.
`lead_sub_event_id` PK · `lead_id`(NN) · `name`(NN) · `date` · `location` · `sort_order` · `created_at` · `is_deleted`.

**lead_sources** — configurable lead-source list (source of truth; the static CHECK was dropped).
`source_id` PK · `label`(NN) · `value`(NN) · `sort_order` · `is_active` · `created_at`.

**clients** — converted/known customers.
`client_id` PK · `first_name`(NN) · `last_name`(NN) · `phone_1..3` · `email_1..3` · `street_address` · `city` · `state` · `pincode` · `gst_number` · `source` · `status`(NN, def `'active'`) · `preferred_contact` · `client_since`(def CURRENT_DATE) · `total_business_value` · `lead_id` · `notes` · `ref_number` · audit/soft-delete cols.

**alternative_contacts** — extra contacts per client.
`contact_id` PK · `client_id`(NN) · `first_name`(NN) · `last_name`(NN) · `relationship` · `phone` · `email` · `notes` · `is_client` · `linked_client_id` · audit/soft-delete.

### Quotations

**quotations** — quotes; revisable (`parent_quotation_id` self-ref + `revision_number`).
`quotation_id` PK · `ref_number`(NN) · `status`(NN, def `'draft'`) · `client_id` · `client_name` · `event_id` · `event_name` · `lead_id` · `doc_date`(def CURRENT_DATE) · `valid_until` · `subtotal` · `discount_pct` · `discount_amount` · `grand_total` · `payment_terms` · `payment_schedule`(**jsonb** — `[{pct,label,when}]`) · `additional_notes` · `additional_terms` · `display_options`(**text**, JSON-encoded) · `approval_token` · `approval_url` · `approved_at` · `approved_via` · `client_response_notes` · `parent_quotation_id` · `revision_number`(def 0) · audit/soft-delete.

**quotation_line_items**
`line_item_id` PK · `quotation_id`(NN) · `sub_event_id` · `sub_event_name` · `description`(NN) · `quantity`(def 1) · `unit_price`(def 0) · `amount`(def 0) · `sort_order` · `created_at` · `is_deleted`.

**quotation_activity_log** — quote action trail (model for the invoice log to come).
`log_id` PK · `quotation_id`(NN) · `action`(NN) · `channel` · `notes` · `logged_at` · `logged_by`.

### Events

**events**
`event_id` PK · `name`(NN) · `type` · `status`(NN, def `'planning'`) · `main_date` · `location` · `guest_count` · `budget` · `client_id` · `client_name` · `primary_contact_id`/`_name` · `secondary_contact_id`/`_name` · `assigned_staff_id`/`_name` · `lead_id` · `internal_notes` · `ref_number` · audit/soft-delete.

**sub_events**
`sub_event_id` PK · `event_id`(NN) · `name`(NN) · `date` · `location` · `sort_order` · audit/soft-delete.

**sub_event_items**
`item_id` PK · `sub_event_id`(nullable — main-event items allowed) · `event_id`(NN) · `description`(NN) · `quantity`(def 1) · `unit_price`(def 0) · `amount` · `sort_order` · audit/soft-delete.

**event_checklists**
`checklist_id` PK · `event_id`(NN) · `task`(NN) · `is_done` · `done_at` · `done_by` · `sort_order` · `created_at` · `created_by`.

**event_templates** / **event_template_items** — reusable event scaffolds.
templates: `template_id` PK · `name`(NN) · `event_type` · `is_active` · `sort_order` · audit · `is_deleted`.
items: `item_id` PK · `template_id`(NN) · `sub_event_name`(NN) · `description`(NN) · `default_quantity`(def 1) · `sort_order` · `created_at`.

### Invoices (Phase 2 live; Phase 3+ builds on these)

**invoices**
`invoice_id` PK · `ref_number`(NN) · `status`(NN, def `'draft'`) · `client_id` · `client_name` · `event_id` · `event_name` · `quotation_id` · `doc_date`(def CURRENT_DATE) · `subtotal`(def 0) · `discount_amount`(def 0) · `tax_amount`(def 0) · `gst_applicable`(def false) · `gst_pct`(def 0) · `grand_total`(def 0) · `total_received`(def 0) · `total_outstanding`(def 0) · `due_date` · `additional_notes` · `payment_terms` · `revision_number`(def 0) · `source_quote_total`(def 0) · audit/soft-delete.
_Note: invoices use the **invoice_installments** table, not a JSON schedule._

**invoice_line_items**
`line_item_id` PK · `invoice_id`(NN) · `sub_event_id` · `sub_event_name` · `description`(NN) · `quantity`(def 1) · `unit_price`(def 0) · `amount`(def 0) · `sort_order` · `created_at` · `is_deleted`.

**invoice_installments**
`installment_id` PK · `invoice_id`(NN) · `installment_number`(NN, int) · `percentage` · `amount_due`(def 0) · `amount_paid`(def 0) · `balance`(def 0) · `due_date` · `status`(NN, def `'pending'`) · `label` · `when_text` · `created_at` · `updated_at` · `is_deleted`.

**invoice_payments**
`payment_id` PK · `invoice_id`(NN) · `installment_id`(**NN** — every payment ties to an installment) · `amount`(NN) · `payment_date`(NN) · `payment_mode` · `reference_number` · `notes` · `recorded_at` · `recorded_by`.

**payment_notifications** — reminder log (later phase).
`notification_id` PK · `invoice_id`(NN) · `installment_id` · `type` · `channel` · `sent_at` · `sent_by`.

> **Gap for Phase 3:** there is **no `invoice_activity_log`** table yet — needed for the revise/change-log/mismatch trail. Mirror `quotation_activity_log` + add `revision_number, field, old_value, new_value, reason`.

### Vendors & finance

**vendors**
`vendor_id` PK · `name`(NN) · `category` · `contact_person` · `phone_1..3` · `email_1..3` · `street_address` · `city` · `state` · `gst_number` · `pan_number` · `bank_name` · `account_number` · `ifsc_code` · `upi_id` · `payment_terms` · `rating` · `is_preferred` · `status`(NN, def `'active'`) · `notes` · audit/soft-delete.

**event_vendors** — vendor assigned to an event.
`event_vendor_id` PK · `event_id`(NN) · `vendor_id`(NN) · `vendor_name` · `service_description` · `agreed_amount` · `total_paid` · `outstanding` · `status`(NN, def `'pending'`) · `rating` · `notes` · audit/soft-delete.

**vendor_installments**
`installment_id` PK · `event_vendor_id`(NN) · `installment_number`(NN) · `percentage` · `amount_due` · `amount_paid` · `balance` · `due_date` · `status`(NN, def `'pending'`) · `created_at` · `updated_at`.

**vendor_payments**
`payment_id` PK · `event_vendor_id`(NN) · `installment_id`(NN) · `vendor_id`(NN) · `event_id`(NN) · `amount`(NN) · `payment_date`(NN) · `payment_mode` · `reference_number` · `notes` · `recorded_at` · `recorded_by`.

**expenses** — business expenses.
`expense_id` PK · `category`(NN) · `sub_category` · `description`(NN) · `amount`(NN) · `date`(NN) · `payment_mode` · `reference_number` · `event_id` · `receipt_url` · `is_recurring` · `recurring_frequency` · `notes` · audit/soft-delete.

**owner_expenses** — owner's personal/business spend.
`owner_expense_id` PK · `spent_by`(NN) · `category`(NN) · `sub_category` · `description`(NN) · `amount`(NN) · `date`(NN) · `payment_mode` · `reference_number` · `receipt_url` · `is_historical` · `notes` · audit · `is_deleted`.

**owner_reimbursements**
`reimbursement_id` PK · `amount`(NN) · `date`(NN) · `payment_mode` · `reference_number` · `notes` · `recorded_at` · `recorded_by`.

### System

**users** — staff/auth profiles.
`user_id` PK · `first_name`(NN) · `last_name`(NN) · `email`(NN) · `phone` · `role`(**NN**) · `status`(NN, def `'active'`) · `profile_photo` · `date_joined` · `last_login` · audit · `is_deleted`.

**settings** — singleton company/config row.
`setting_id` PK · `company_name`(def 'Isheeka Events') · `logo_url` · address cols · `phone_1`/`phone_2` · `email` · `website` · `gst_number` · `pan_number` · `bank_name` · `account_number` · `ifsc_code` · `upi_id` · `default_validity_days`(def 7) · `default_invoice_due_days`(def 14) · `default_payment_schedule`(**jsonb**) · `default_terms` · `cover_intro` · `gst_pct`(def 18) · `signature_url` · `updated_at` · `updated_by`.

**counters** — atomic ref-number counters (via `next_counter` RPC).
`counter_id` PK · `type`(NN) · `year`(NN) · `current_value`(def 1110) · `updated_at`. Types seen: `quotation`, `lead`, `client`, `event`, `invoice`.

---

## 2. Constraints, PKs, FKs, CHECKs

Every table PK = its `<name>_id`. All `created_by`/`updated_by`/`*_by` → `users.user_id`. Below are the constraints that actually govern what the app may write (the CHECK **enums** — get these wrong and inserts are rejected, exactly the Phase 2 lesson).

### Status / enum CHECKs (allowed values — use these EXACT strings)
- **invoices.status**: `draft, sent, partially_paid, paid, overdue, cancelled`. (`ref_number` is UNIQUE.)
- **invoice_installments.status**: `pending, partially_paid, paid, overdue`.
- **invoice_payments.payment_mode**: `cash, neft, upi, cheque` ← lowercase. _(Spec mockup said "UPI / Bank-NEFT / Cash / Cheque" — the DB wants `upi/neft/cash/cheque`. Phase 4 must map to these.)_
- **quotations.status**: `draft, sent, approved, revision_requested, revised, superseded, rejected, expired, converted`. `approved_via`: `link, manual`. (`ref_number`, `approval_token` UNIQUE.)
- **leads.stage**: `new, contacted, quote_generation_in_progress, quote_sent, quote_revision_pending, revised_quote_sent, quote_confirmed, event_triggered, lost`.
- **events.status**: `planning, confirmed, in_progress, completed, cancelled`. **events.type**: `wedding, corporate, birthday, anniversary, other`.
- **users.role**: `admin, manager, staff`. **users.status**: `active, inactive`. (`email` UNIQUE.) ← role gate for paid-invoice revision resolves against this.
- **clients.status**: `active, inactive, vip`. **clients.preferred_contact**: `whatsapp, phone, email`.
- **alternative_contacts.relationship**: `spouse, parent, sibling, friend, other`.
- **event_vendors.status**: `pending, partially_paid, paid` (rating 1–5). **vendor_installments.status**: `pending, partially_paid, paid, overdue`.
- **vendors.category**: `caterer, decorator, photographer, sound_lighting, venue, transport, makeup, entertainment, other`. **vendors.status**: `active, inactive`.
- **expenses.category**: `marketing, operations, travel, staff, event_incidentals, professional, banking, miscellaneous`. **expenses.payment_mode** / **owner_expenses/owner_reimbursements.payment_mode**: `cash, neft, upi, cheque`. **expenses.recurring_frequency**: `monthly, quarterly, yearly`.
- **payment_notifications.type**: `confirmation, reminder`. **channel**: `whatsapp, email, both`.
- **quotation_activity_log.channel**: `whatsapp, email, phone, in_person, link`.
- **counters.type**: `quotation, invoice, lead, client, event`. UNIQUE `(type, year)` → underpins the atomic `next_counter`.

### Foreign-key web (the important ones)
- **invoices** → events, clients, quotations (+ created/updated_by → users). `ref_number` UNIQUE.
- **invoice_line_items** → invoices, sub_events(`sub_event_id`).
- **invoice_installments** → invoices.
- **invoice_payments** → invoices, invoice_installments(`installment_id` NN), users(`recorded_by`).
- **payment_notifications** → invoices, invoice_installments.
- **quotations** → clients, events, leads, quotations(`parent_quotation_id` self-ref).
- **quotation_line_items** → quotations, sub_events.
- **leads** → quotations(`active_quotation_id`), events, users. **clients** → leads. **events** → clients, leads, alternative_contacts(primary/secondary), users(staff).
- **sub_events** → events. **sub_event_items** → sub_events, events.
- **event_vendors** → events, vendors. **vendor_installments** → event_vendors. **vendor_payments** → event_vendors, vendor_installments, vendors, events.

> **Anomaly to verify (not Phase-3-blocking):** the constraint dump shows `users_pkey` covering **both `user_id` and `id`**, but query 1 listed no `id` column on `users`. Likely a Supabase auth-link artifact; worth a quick look later, doesn't affect invoice work.

## 3. RLS policies

**Uniform model:** every table has an `ALL` policy to `{public}` with `USING (auth.role() = 'authenticated')` — i.e. any logged-in user can read/write everything. No row-level/role-level restriction yet (this is the P0-3 / role-aware-RLS item; pairs with `users.role`).

**`users`** carries two named policies ("Admins can manage users" ALL, "Users can view all users" SELECT) but both still only check `authenticated` — so they're **not actually role-gated** today.

**Cleanup needed (from my Phase 2 migration):** the three invoice child tables now have **duplicate** policies — the original `*_policy` AND the `*_all` ones my migration added (`invoice_line_items_all`, `invoice_installments_all`, `invoice_payments_all`). They're identical in effect (harmless, permissive OR), but redundant. Recommend dropping mine to keep it clean:
```sql
DROP POLICY IF EXISTS invoice_line_items_all   ON invoice_line_items;
DROP POLICY IF EXISTS invoice_installments_all ON invoice_installments;
DROP POLICY IF EXISTS invoice_payments_all     ON invoice_payments;
```
(The pre-existing `*_policy` policies already grant authenticated access, so invoice creation keeps working after this.)

## 4. Functions / RPCs

Only **one** custom function exists:
- **`next_counter(p_type, p_year, p_seed)` → integer** — atomic find-or-create + increment on `counters` (relies on the UNIQUE `(type, year)`). The single source of all ref numbers (`Q-/L-/CL-/E-/I-`). Any multi-table flow we later want transactional (invoice creation, event save, conversion) would be **new** RPCs — none exist today, so those flows are currently app-side sequences guarded with rollback.

---

## 5. Implications for Phase 3 (build against these facts)

- **Invoice change-log:** no `invoice_activity_log` table exists → Phase 3 migration creates one (model it on `quotation_activity_log`: `log_id, invoice_id, action, channel, logged_at, logged_by` **plus** `revision_number, field, old_value, new_value, reason`). RLS policy to match (`authenticated`).
- **Status writes** must use the exact enum strings in §2 (e.g. invoice `partially_paid`, not `partial`).
- **Payments (Phase 4)** must store `payment_mode` ∈ {cash,neft,upi,cheque} and always set `installment_id` (NOT NULL).
- **Role gate** (revise a paid invoice) resolves `users.role` ∈ {admin,manager,staff}; today RLS still trusts any authenticated user (P0-3), so the gate is client-side until role-aware RLS lands.
- **Totals on invoices** live in `total_received` / `total_outstanding` (keep them updated on payment/revision); installments hold their own `amount_paid`/`balance`/`status`.
- **Due dates:** `settings.default_invoice_due_days` (14) for defaulting installment/invoice due dates.
- **Cleanup:** drop the 3 redundant `*_all` invoice policies (§3).

_Schema doc complete — sections 1–4 from live dump 13 Jun 2026._
