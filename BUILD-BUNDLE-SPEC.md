# Isheeka ERP — Build bundle spec (for approval)
_Prepared 2026-06-27. One end-to-end build, single deploy at the end. No code until approved._

## Decisions captured
- Sub-items: **JSONB on the item**, fields = **name + qty + optional note**, **AI auto-detect** in import.
- Quote approval: **link + PIN + typed-name signature**, full audit trail, **auto-email to client cc isheekaevents** (Resend — already wired in app).
- Vendor onboarding: self-service form, all fields mandatory **except GSTIN & PAN**, category mirrors app list, **fuzzy dedupe** before create.
- RFQ editing: **staff can edit submitted RFQ**; edits create a revision and a **one-tap WhatsApp + email confirmation** to client; **Approve gated until client confirms, with one-click verbal override**.
- Reorder: **drag-and-drop, across functions**, items + sub-items, in client portal + app RFQ edit + quote editor.
- Messaging: WhatsApp one-tap + email, templates, **logged to history**, from Clients + Vendors.
- Payment QR: uploaded in Settings, printed on quote/invoice **only with the (separate) bank-details toggle**.
- Selective sourcing: pick items per vendor (**Select all / Deselect all** + per-function + per-item); costing vendor columns are **dynamic per sourced vendor**, showing **bid / Awaiting / Not requested**.
- Sequencing: **one big deploy** at the end.

## Single DB migration (all schema in one file)
- `sub_items jsonb default '[]'` on `rfq_items`, `quotation_line_items`, `invoice_line_items`, `sub_event_items`.
- `source_item_id` on vendor-side `rfq_items` (stable link client-item → vendor-bid, powers "Not requested").
- `rfqs`: client-confirmation columns (`confirmation_status`, `confirmation_requested_at`, `client_confirmed_at`, `client_confirm_note`).
- New `quote_approvals` (quotation_id, action requested/opened/signed/declined, signer_name, ip, created_at) + `quotations` approval columns (`approval_status`, `approval_token_hash`, `approval_pin_hash`, `client_approved_at`, `approver_name`).
- New `vendor_onboarding` (token/pin, submitted fields jsonb, status, vendor_id once approved, timestamps).
- New `message_log` (party_type client/vendor, party_id, channel whatsapp/email, template, body, sent_by, created_at).
- `settings`: `payment_qr_path` (storage path).
- RLS on all new tables: authenticated reads gated like the rest; **public writes only via the gateway (service_role)** — anon keeps zero table access (consistent with the June hardening).

## Items → what changes
**1. RFQ auto-populate from lead** — `LeadsModule` Send-RFQ prefill passes date/budget/guests + venue↔city mapping; `lib/rfq.js createRfq` persists `event_date,guest_count,budget,budget_range,location,city`; `NewRFQForm` shows them. (Columns already exist.)

**2. Event-type dropdown** — `NewRFQForm` free-text → dropdown from `event_types` (value/label, A–Z).

**3. Sub-items** — item editor (QuoteWizard + RFQ edit + portal) gains nested name+qty+note rows; gateway returns/persists `sub_items`; quote/invoice PDF renders indented `• name × qty (note)`; costing shows sub-items read-only; AI extract prompt nests sub-items. Files: `QuoteWizard.jsx`, `RFQsModule.jsx`, `QuotationsModule.jsx`, `InvoicesModule.jsx`, `CostingScreen.jsx`, `pdf/quotationPdf.js`, `lib/costingSheet.js`, `rfq.html`, gateway.

**4. Client quote approval** — `QuotationsModule` "Request approval" + audit panel; new public approval page (PIN + typed name); gateway actions (view-by-token, submit-approval); Resend confirmation email cc isheekaevents.

**5. Vendor onboarding** — `VendorsModule` Invite + Onboarding-requests queue + review/approve (fuzzy dedupe → create vendor); new public vendor form; gateway actions; Resend invite/notify.

**6. RFQ edit + client re-confirmation** — `RFQsModule` edit mode (items + schedule) → revision + "Request confirmation" (WhatsApp + email) → client confirm page → Approve gating + override. Gateway + portal confirm view.

**7. Drag-to-reorder (across functions)** — items + sub-items in `rfq.html`, `RFQsModule` edit, `QuoteWizard`; persists `sort_order` + function reassignment.

**8. Messaging & reminders** — composer (templates + WhatsApp one-tap + Resend email + `message_log`) in `ClientsModule` + `VendorsModule`; new `lib/messaging.js`.

**9. Payment QR** — `SettingsModule` upload (storage); `pdf/quotationPdf.js` renders QR inside the bank-details block only (separate from payment schedule).

**10. Selective sourcing + costing states** — Sourcing item selector (select all/none/per-function/per-item) → scoped vendor RFQ; costing dynamic vendor columns with bid / Awaiting / Not requested via `source_item_id`. Files: `RFQsModule` sourcing panel, `CostingScreen.jsx`, gateway.

## Deploy surfaces (one coordinated release)
1. Apply the migration (Supabase). 2. Deploy gateway + email function (Supabase). 3. Deploy portal pages (`rfq.html` + new approval/vendor pages) to GitHub Pages. 4. `npm run build` + commit + push app (Netlify). 5. Upload payment QR in Settings; confirm Resend from-address. 6. End-to-end smoke test.
_Order matters: DB + gateway before app/portal that depend on them._

## Test plan
- Per feature happy-path (see each item) + regression: existing quote/invoice/costing/RFQ still generate correctly; PDFs unchanged when new toggles are off.
- `npm run build` green; Supabase security advisor clean (new tables have RLS); restricted-staff login still gated.
- Backups: a snapshot before deploy (you have nightly + local).

## Open items
None — all design questions answered.
