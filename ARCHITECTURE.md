# Isheeka Events ERP - Architecture & Business Flows

> Single source of truth for how this app is built and how every business flow works.
> Written 2026-06-28 from a full read of the live `src/`, `supabase/`, and the public portals.
> When code and this doc disagree, trust the code and update this doc.

---

## 1. System topology

| Piece | What it is | Where it runs |
|-------|-----------|---------------|
| **ERP app** | Vite + React SPA (the staff-facing ERP) | Netlify -> `app.isheekaevents.com`. Builds fresh from `isheeka-vite/src/` (`netlify.toml` runs `npm run build`). |
| **Client RFQ portal** | `rfq.html` (standalone, no framework) | GitHub Pages. Clients fill requirements; vendors price bids (same file, vendor mode). |
| **Quote approval portal** | `approval.html` (standalone) | GitHub Pages. Clients sign/decline a quote with a PIN. |
| **Vendor onboarding portal** | `vendor-onboarding.html` (standalone) | GitHub Pages. Vendors self-register. |
| **Backend** | Supabase (Postgres + Auth + Storage + Edge Functions) | Project `jlcssesetnxulnkbrmyp`. |
| **Public edge gateway** | `supabase/functions/rfq-gateway/index.ts` | The ONLY public door to the RFQ tables (`verify_jwt: false`); holds the service-role key, does its own token+PIN/OTP auth. |

Other edge functions: `extract` (authenticated AI item/receipt extraction for staff), `s` (short-link 302 redirector for hosted PDFs), `push-send` (web push), `daily-digest` (cron).

### Build / deploy notes (from BUILD-BUNDLE-SPEC.md and the handoff)
- Netlify builds from `src/`; `dist/` is gitignored. `dist_old/` is a local EPERM workaround only, NOT served by Netlify.
- All git commands are run by the owner in PowerShell (VS Code holds `.git/index.lock`).
- `npm test -- --run` must pass before every push.

---

## 2. App shell, auth & access control

`App.tsx` -> `Shell.jsx`. The Shell is the whole app: auth gate, 30-min session timeout (warning at 25 min), and a **navigation stack** (`navStack`) persisted to `sessionStorage` so refresh/PWA-update keeps your place. `navigate(page, opts)` pushes; `goBack`/`jumpTo`/`resetTo` manage the stack. Deep links: `?rfq=<id>`, `?inv=<id>`, `?go=owner`.

**Auth link:** Supabase Auth user is matched to a `users` row by **email**. That row (`role`, `is_owner`, `module_access`) is the profile that drives access.

**Access model (`lib/access.js`):**
- Admins and owners always get full access (cannot be locked out).
- A user with no profile row defaults to full access (avoids accidental lockout).
- Managers/staff get a role preset (`ROLE_DEFAULTS`) overridable by their `users.module_access` map.
- `dashboard` always allowed; `users`/`settings` admin-only; `owner-account` owners-only.
- **IMPORTANT:** This is enforced in the UI only. DB RLS today still grants any authenticated user full read/write (the role-aware RLS lockdown is in-progress - see `RLS_LOCKDOWN_PLAN.md` and the `2026062*` security migrations).

Modules (sidebar groups): SALES (Leads, Client RFQ, Clients) - OPERATIONS (Events, Quotations, Invoices) - VENDORS (Vendors, Vendor RFQ, Vendor Payments) - FINANCE (Expenses, Reports) - ADMIN (Users, Settings, Owner Account).

---

## 3. Data model (Supabase, 36 tables)

Conventions: every table has `<name>_id uuid` PK, most have `created_at/updated_at`, `created_by/updated_by`, and a soft-delete `is_deleted`. All ref numbers come from one atomic RPC `next_counter(type, year, seed)` (`lib/refs.js`): `Q-`, `L-`, `CL-`, `E-`, `I-`, `RFQ-`, `Ex-`, owner `Fn/Rb/St-`.

### Sales pipeline
- **leads** - pipeline records; `stage`, `active_quotation_id`, `client_id`, `event_id`, `lost_reason`.
- **lead_sub_events** - sub-events captured at lead stage.
- **clients** - customers; `phone_1..3`, `email_1..3`, address, `gst_number`, `status`.
- **alternative_contacts** - extra contacts per client.

### Quotations
- **quotations** - `status`, `revision_number`, `parent_quotation_id` (self-ref), `payment_schedule` (jsonb), `display_options` (JSON text), `approval_token_hash`/`approval_pin_hash`/`approval_status`.
- **quotation_line_items** - `description`, `quantity`, `unit_price`, `amount`, `sub_event_name`, `sub_items` (jsonb).
- **quotation_activity_log** - quote action trail.
- **quote_approvals** - client approval audit (opened/signed/declined/pin_failed, IP).

### Events
- **events** - `status`, `main_date`, contacts, `assigned_staff_id`, `lead_id`, `client_id`.
- **sub_events** - functions within an event (`date`, `location`).
- **sub_event_items** - `sub_event_id` (nullable = main-event item), `description`, `quantity`, `unit_price`, `sub_items` (jsonb).
- **event_checklists**, **event_templates**, **event_template_items**, **event_types**, **event_type_subevents**.

### Invoices
- **invoices** - `status`, `grand_total`, `total_received`, `total_outstanding`, `gst_applicable/gst_pct`, `revision_number`, `source_quote_total`.
- **invoice_line_items** - mirrors quote items incl. `sub_items`.
- **invoice_installments** - `installment_number`, `percentage`, `amount_due`, `amount_paid`, `balance`, `status`, `label`, `when_text`.
- **invoice_payments** - every payment ties to an `installment_id`; negative `amount` + `is_refund` for refunds.
- **invoice_activity_log**, **payment_notifications**.

### RFQ engine (one engine, two audiences)
- **rfqs** - `party_type` `'client'`|`'vendor'`; for vendor rows `parent_rfq_id` + `vendor_id`; `token_hash`, `access_pin_hash`, `access_mode`, `status`, `revision_number`, `confirmation_status`, `quotation_id`, `is_sourcing_anchor`, `sub_events` (jsonb), reminder fields.
- **rfq_items** - `description`, `quantity`, `unit`, `sub_event_name`, `sort_order`, `sub_items` (jsonb), `source`; vendor-side: `unit_cost`, `can_supply`, `item_note`, **`source_item_id`** (back-link to the client rfq_item this was copied from).
- **rfq_activity** - action trail (created/sent/otp/pin/saved/submitted/approved/reminded...).
- **rfq_otp** - emailed OTP codes (hashed).
- **rfq_revisions** - per-submission snapshot (details + items).
- **costing_summaries** - audit snapshot of a costing exercise: `client_rfq_id`, `quotation_id`, `event_id`, markup, totals, `lines` (jsonb per-item).

### Vendors & finance
- **vendors**, **vendor_onboarding**, **vendor_categories**.
- **event_vendors** - a vendor engaged on an event; `agreed_amount`, `total_paid`, `outstanding`, `status`.
- **vendor_installments**, **vendor_payments** (negative + `is_refund`/`is_voided` for refunds/voids).
- **expenses** (`paid_by` owner tag, `receipt_url`, recurring), **owner_ledger** (funding/reimbursement/settlement), **owner_expenses**, **owner_reimbursements**.

### System
- **users** (`role` admin/manager/staff, `is_owner`, `module_access` jsonb, `notify_prefs`), **settings** (singleton: company, bank, `default_markup_pct`, `gst_pct`, notify emails), **counters**, **short_links**, **notifications**, **push_subscriptions**.

### Status enums (use these EXACT strings)
- leads.stage: `new, contacted, quote_generation_in_progress, quote_sent, quote_revision_pending, revised_quote_sent, quote_confirmed, event_triggered, lost`
- quotations.status: `draft, sent, approved, revision_requested, revised, superseded, rejected, expired, converted`
- events.status: `planning, confirmed, in_progress, completed, cancelled`
- invoices.status: `draft, sent, partially_paid, paid, overdue, cancelled`
- invoice/vendor_installments.status: `pending, partially_paid, paid, overdue`
- payment_mode: `cash, neft, upi, cheque` (lowercase)
- rfqs.status: `draft, sent, in_progress, submitted, changes_requested, approved, converted, withdrawn, expired`
- event_vendors.status: `pending, partially_paid, paid`

---

## 4. Business flows

### 4.1 Core money path (lead -> cash) - mostly in `lib/money.js`
1. **Lead** created/captured -> staff works the stages.
2. **Quotation** built via the wizard (`draft`). Shared as a hosted PDF (short link) over WhatsApp/Gmail; logged to `quotation_activity_log`. Client can sign via `approval.html` (PIN-gated, handled by the gateway). Quotes are revisable (`revision_number`, `parent_quotation_id`; old revs -> `superseded`).
3. **Confirm quote** -> `createEventFromQuote`: resolve/create **client** -> create **event** -> seed `sub_events` + `sub_event_items` (copying planned dates/venues from the linked RFQ's `sub_events`) -> mark quote `converted` -> auto-draft **invoice** via `createInvoiceFromQuote` -> link the lead (`event_triggered`).
4. **Event** runs (`planning -> confirmed -> in_progress -> completed/cancelled`; auto-advances by date / issued invoice). "Mark completed" is gated by `eventFunnel` (client invoice must be fully paid). Cancellation forces refund/retain choices per invoice and per vendor.
5. **Invoice** issued and collected. Installment ledger: payments allocate across installments in number order; `reconcileInvoiceInstallments` keeps header `total_received` and the installment rows in sync; refunds/discounts reverse correctly; paid invoices lock except a logged admin revision (`invoice_activity_log`).

### 4.2 Sourcing & markup (the vendor RFQ + costing engine)
This sits BETWEEN "client RFQ approved" and "quote sent". See `docs/milestone-s-vendor-rfq-spec.md`. Key code: `lib/rfq.js`, `lib/vendorRfq.js`, `lib/costing.js`, `modules/RFQsModule.jsx`, `modules/CostingScreen.jsx`, `modules/VendorRFQsModule.jsx`, and the gateway's vendor mode.

1. **Client RFQ** captured through `rfq.html` (token + PIN/OTP; AI item extraction via the gateway `extract_items`; autosave; submit snapshots a revision). Statuses: `sent -> in_progress -> submitted -> (changes_requested) -> approved -> converted`.
2. **Approve RFQ -> draft quote** (`approveRfqToQuote`): ensure/dedupe client, create a `draft` quotation with the RFQ items item-for-item (price blank), mark RFQ `approved` + link `quotation_id`.
3. **Send vendor RFQs** (`createVendorRfqs`): one `rfqs` row per vendor (`party_type='vendor'`, `parent_rfq_id`, `vendor_id`), freezing the client RFQ's item list (or a chosen subset) into that vendor's `rfq_items`, with **`source_item_id`** back-linking each copy to the client item. Vendors open the SAME portal in vendor mode and enter `unit_cost` / `can_supply` / `item_note`.
4. **Costing & markup** (`CostingScreen` + `loadCostingData`): client items as rows, each submitted vendor's bid as a column, joined by `costKey = sub_event_name||description` and by `source_item_id`. Cheapest available source auto-selected; per-item or global markup; in-house option. Validations before "Generate quote": full coverage, in-house cost present, valid qty, margin floor (~15%). Outputs: a priced quote (`generateQuoteFromCosting`) + a saved `costing_summaries` audit row.
5. **Sourcing anchor** (`ensureSourcingAnchor`): any quote without a client RFQ gets a hidden client RFQ (`is_sourcing_anchor=true`, status `converted`) seeded from its line items, so the Sourcing panel + costing work off any quote.

### 4.3 Public gateway actions (`rfq-gateway`)
`ping`, `request_otp`, `verify_otp`, `verify_pin`, `get_rfq` (also returns template catalog, sub-event suggestions, vendor schedule), `save_rfq` (client replaces items; **vendor mode updates costs only, never replaces the frozen item list**), `submit_rfq` (snapshots a revision + notifies owners via email/in-app/push), `extract_items`, `extract_costs` (vendor price list -> match to fixed items), `view_quote_by_token`, `submit_quote_approval`, `get_vendor_onboarding`, `submit_vendor_onboarding`, `confirm_rfq_changes`, `send_client_rfq_email`.

### 4.4 Finance & admin
- **Expenses** (AI receipt capture; `paid_by` owner tag) -> **Owner Account** ledger (funding/reimbursement/settlement) + reconciliation (`lib/ownerAccount.js`).
- **Reports** (`lib/financeReports.js`): per-event P&L, AR aging, AP by vendor, owner settlement; branded Excel/PDF.
- **Settings**: company/bank config, templates, lead sources, event types + sub-events, default markup, access control. **Users**: staff directory, roles, module access (login created separately in Supabase Auth with matching email).

---

## 5. Key shared libraries

| File | Responsibility |
|------|----------------|
| `lib/money.js` | HIGHEST RISK. Quote->event->invoice conversion, installment reconciliation, client/vendor refunds, quote close-out. |
| `lib/refs.js` | Atomic ref numbers via `next_counter`. |
| `lib/rfq.js` | Client RFQ crypto (token/PIN/OTP hashing), create, client dedupe, approve->draft quote. |
| `lib/vendorRfq.js` | Vendor RFQ creation (with optional item subset), load, reminders, link regen, sourcing anchor. |
| `lib/costing.js` | Join client items x vendor bids, generate priced quote, save costing summary, vendor suggestion for events. |
| `lib/share.js` | WhatsApp/email links, hosted-PDF upload + short links, message builders. |
| `lib/format.js` | Formatters, status predicates, `eventFunnel`, date helpers. |
| `lib/ownerAccount.js`, `lib/financeReports.js` | Owner reconciliation + report compute. |
| `lib/supabase.ts`, `lib/session.js`, `lib/access.js`, `lib/constants.js` | Client, current-user/activity logging, access model, constants/enums. |

---

## 6. Gotchas / conventions
- Use exact enum strings (section 3) - DB CHECK constraints reject anything else.
- `payment_mode` and many enums are lowercase.
- Soft-delete is `is_deleted=true`, not row deletion (except a few child-table hard deletes).
- Sub-items are a jsonb array on the item row (`[{name, qty, note}]`), NOT a separate table.
- Vendor RFQ items carry `source_item_id` -> the client `rfq_item_id` they were copied from; the costing join relies on this.
- The gateway is the only public path to RFQ data; the portals hold no keys.
- Ref numbers, hosted PDFs (short links), and approval/RFQ tokens are all hashed/atomic by design - don't bypass the helpers.
