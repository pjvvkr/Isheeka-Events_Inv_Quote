# Isheeka Events ERP — Complete Application Handoff
## All Context · Business Logic · Screens · Database · Fixes · Design Thinking

**File:** `isheeka-erp-v22.html`  
**Live URL:** https://pjvvkr.github.io/Isheeka-Events_Inv_Quote/isheeka-erp-v22.html  
**Supabase project:** `https://jlcssesetnxulnkbrmyp.supabase.co`  
**Login:** `vamshi.555@gmail.com` / `Isheeka@2026`

---

## 1. Who Is Swathi & What Is Isheeka Events

**Swathi N** is the Founder & CEO of Isheeka Events, a boutique event management company based in **Hyderabad, India**, established 2010. The company specialises in high-touch, curated events — primarily **weddings** (which are multi-function affairs: Mehendi, Sangeet, Reception) but also corporate events, birthdays, and anniversaries.

**Business character:**
- Small team (Swathi + a few staff/managers), not a large agency
- "White glove" positioning — personalised, premium, not volume-driven
- Clients are families and corporates in Hyderabad; communication happens heavily over WhatsApp
- Quotations are a core sales artifact — they are *sent to clients*, so they must look beautiful and on-brand
- The company did not have a proper ERP. They were likely managing on spreadsheets/WhatsApp

**Why this ERP is being built:**
Vamsi (the person building this) is creating the system on behalf of Swathi. He is not the business owner — he is building it for her. So every design decision has to account for what a non-technical user (Swathi/her staff) will find intuitive and practical.

**Brand identity:**
- Primary colour: **Pink `#e8185a`** (strong, warm pink — not soft/pastel)
- Tagline: *"Making Every Event Memorable"*
- Logo: Isheeka Events branded PNG (base64-embedded in the app)
- Tone: professional but warm

---

## 2. Architecture Overview

| Aspect | Detail |
|---|---|
| **Stack** | React 18 (CDN), Babel standalone, no build step |
| **Backend** | Supabase (PostgreSQL + Auth + Storage) |
| **Hosting** | GitHub Pages (static file, push to deploy) |
| **PDF engine** | jsPDF + jsPDF-AutoTable (CDN) |
| **File structure** | **Single HTML file** — all React components, all CSS, all JS, all PDF logic in one `isheeka-erp-v22.html` |
| **Auth** | Supabase Auth (email/password). Session timeout: 30 min, warning at 25 min |
| **Ref numbers** | `counters` table — year-scoped, auto-incremented. Format: `Q-26-XXXX` (quotation), `IE-LD-XXXX` (lead), `IE-CL-XXXX` (client), `INV-26-XXXX` (invoice) |
| **Roles** | admin, manager, staff — controls nav visibility and feature access |

---

## 3. Business Flow (the core of the app)

This is the canonical flow that drives all design decisions:

```
LEAD  →  QUOTATION  →  EVENT  →  INVOICE
```

**This was debated and locked in v20.** The original (wrong) assumption was Lead → Event → Quotation. The correct flow:
1. A **Lead** comes in (someone enquires about an event)
2. A **Quotation** is prepared and sent to the lead
3. If the client approves the quote, it **Converts to an Event**
4. The event is executed, then an **Invoice** is raised

This matters because:
- You cannot create an event without a confirmed quotation
- A lead can have *multiple* quotations (revisions, superseded versions)
- Only one quotation can be `approved` / `converted` per lead at a time
- The event gets its data (client, event type, date, budget) from the approved quotation, not entered fresh

---

## 4. Navigation Structure

The sidebar has 6 sections:

| Section | Items | Roles |
|---|---|---|
| (top) | Dashboard | all |
| SALES | Leads, Clients | all |
| OPERATIONS | Events, Quotations, Invoices | all |
| VENDORS | Vendors, Vendor Payments | admin, manager |
| FINANCE | Expenses, Reports | admin, manager |
| ADMIN | Users, Settings, Owner Account | admin only |

**Currently fully built:** Dashboard (stub), Leads, Clients, Events, Quotations (modal only, no standalone list yet), Settings  
**Stubs / Coming Soon:** Invoices, Vendors, Vendor Payments, Expenses, Reports, Users, Owner Account

---

## 5. Screen-by-Screen Breakdown

---

### 5.1 LOGIN SCREEN
- Supabase email/password auth
- On success → App loads, session timers start
- Session warning modal at 25 min idle, auto-logout at 30 min

---

### 5.2 DASHBOARD
- Currently a stub with summary cards (placeholder)
- Intended to show: today's follow-ups, active leads count, upcoming events, revenue this month

---

### 5.3 LEADS MODULE

The most complex module. Entry point for all new business.

**List view (`LeadsModule`):**
- Table of all leads, ordered by created_at desc
- Columns: Ref number, Name, Event type, Stage badge, Budget, Tentative date, Assigned to, Created
- **Filters:** Stage (pill tabs), Event type dropdown, Budget range dropdown, Assigned to dropdown
- **Search:** Real-time name/phone search
- **"New Lead" button** → opens LeadForm in create mode

**Lead stages (pipeline):**
```
new → contacted → quote_generation_in_progress → quote_sent
    → quote_revision_pending → revised_quote_sent
    → quote_confirmed → event_triggered
```
Each stage has a distinct colour badge. `event_triggered` is the terminal success state (lead converted to event).

**Lead form fields:**
- First name*, Last name*, Phone 1*, Phone 2 (optional)
- Email, Source* (dropdown from `lead_sources` table — configurable in Settings)
- Referred by (text, shown only if source = referral)
- Event type* (Wedding / Corporate / Birthday / Anniversary / Other)
- Tentative date, Location (venue / city)
- Budget (₹), Guest count
- Venue preference (notes)
- Stage, Assigned to (staff dropdown)
- Notes, Follow-up date

*required fields

**Lead detail view (`LeadDetail`):**
- Header: name, ref number, stage badge, action buttons
- View/Edit mode toggle
- **Action buttons change based on stage:**
  - `new` / `contacted` → "Generate Quote" button
  - `quote_generation_in_progress` → "Continue Quote" button (re-opens existing draft)
  - `quote_sent`+ → "New Revision" button
  - Any active stage → "Mark Lost" button
  - `quote_confirmed` → "Convert to Event" button (opens ConvertLeadModal)
- **Quotations panel** — lists all quotations linked to this lead: ref number, status badge, grand total, valid until, revision number. Click to open QuotationDetailModal.
- **Loss flow:** Mark Lost → LossReasonModal (reason dropdown + notes) → lead moves to `lost` stage

**Key business logic on leads:**
- When contact details (phone, email) are edited on a lead, the app asks: "Cascade changes to linked quotations and client record?" with a confirmation
- Ref number assigned at creation: `IE-LD-XXXX`
- When a lead is converted, `stage = 'event_triggered'`, new event is created, quotation status → `converted`

---

### 5.4 CLIENTS MODULE

**List view (`ClientsModule`):**
- Table: Ref number, Name, Phone, Email, City, Source, Status
- Filter by status (active/inactive), search by name/phone
- "New Client" button, "Bulk Upload" button

**Client form fields (`ClientForm`):**
- First name*, Last name*, Phone 1*, Phone 2, Phone 3
- Email 1, Email 2, Email 3
- Street address, City, State, Pincode
- Source, Status (active/inactive)
- Preferred contact method
- GST number, Notes

**Client detail (`ClientDetail`):**
- View/edit client details
- Alternative contacts section (spouse, PA, relative — any secondary contact for the same client)
- Alternative contact fields: First name, Last name, Relationship, Phone, Email, Notes

**Client deduplication (`ClientMatchModal`):**
When creating a client from a lead, the app checks for existing clients with the same normalised phone number (`normPhone()` strips formatting). If a match is found, shows a modal: "We found an existing client — link to them or create new?" This prevents duplicate client records.

**Bulk upload (`MassClientUpload`):**
CSV upload for importing multiple clients at once. Maps CSV columns to client fields.

**Ref number:** `IE-CL-XXXXXX` (6-digit, seeded at 111112 so next is 111113)

---

### 5.5 EVENTS MODULE

**List view (`EventsModule`):**
- Table: Event name, Client, Event type, Status badge, Date, Assigned to
- Filter by status, event type, search by name
- "New Event" button (opens NewEventWizard)

**Event statuses:** In Progress → Confirmed → Planning → Completed → Cancelled

**Event detail (`EventDetail`):**
The richest screen in the app. Has tabbed sections:

1. **Overview tab** — Main event fields: event name, client (changeable via ChangeClientModal), event type, status, dates, venue/location, budget, guest count, contact person (self or alt contact), assigned to, notes
2. **Sub-events tab** — Individual functions within the event (e.g. Mehendi on Date A at Venue X, Sangeet on Date B, Reception on Date C). Each sub-event has: name, date, location, is_main flag
3. **Line items tab** — Services/items for the event. Each item: description, sub_event_name (which function it belongs to), quantity, unit price, amount. FastEntryTable for quick bulk entry.
4. **Checklist tab** — Task checklist for the event. Each task: description, due date, assigned to, completed bool. "Add task" inline.
5. **Quotations tab** — Linked quotations (read-only list, click to view)
6. **Invoices tab** — Linked invoices (stub)

**"Use as Reference" flow:**
From event detail, you can say "create a new lead from this event as a reference" — carries over event type, approximate budget etc. into a new lead form. Useful for repeat clients or similar events.

**NewEventWizard:**
Used when creating events NOT from a lead (direct event entry). Multi-step wizard:
- Step 1: Client (search existing or create new)
- Step 2: Event details (name, type, dates, venue)
- Step 3: Sub-events
- Step 4: Line items (with template support)
- Step 5: Review & Save

---

### 5.6 QUOTATIONS (QuotationDetailModal)

There is no standalone Quotations list view yet — quotations are accessed through:
- The Lead detail's quotations panel
- The Event detail's quotations tab

**QuotationDetailModal** is a full-screen modal that shows:
- Header: ref number, client name · event name, status badge, revision number
- Quote summary: doc date, valid until, grand total
- Line items table (grouped by sub-event if applicable)
- Payment schedule
- Additional terms/notes
- **Display options panel** (controls what appears in the PDF):
  - Presets: Full / Items only / Summary
  - Toggles: Cover page, Show prices, Show qty, Group by sub-event, Show payment schedule, Show discount, Include bank details
- **Action buttons:** Print PDF, Download PDF
- **Status actions:** Mark as Sent, Mark as Approved (when in draft/sent), Request Revision

**Quotation statuses:**
`draft → sent → approved → converted`
Side paths: `revision_requested`, `revised`, `superseded`, `rejected`, `expired`

---

### 5.7 QUOTE GENERATION WIZARD (QuoteGenerationWizard)

Triggered from a lead (not standalone). A 4-step modal wizard:

**Step 1 — Client**
- Search existing clients by name/phone
- Or create a new client inline
- ClientMatchModal fires if phone matches existing client
- Selected client shown with green checkmark

**Step 2 — Line Items**
- Template selector: dropdown of `event_templates` filtered to the lead's event type
- Templates have sub-event tagged items (e.g. Mehendi items, Sangeet items, Reception items)
- Items loaded from template into an editable table
- Can add/remove/edit items: description, sub_event_name, qty (with MAX_QTY validation), unit price, amount
- Subtotal calculated live

**Step 3 — Quote Details**
- Doc date (defaults today)
- Valid until (defaults today + `default_validity_days` from settings)
- Discount % (optional)
- Payment schedule: 3 tranches with pct/label/when — defaults to 50/40/10 split (Advance / Pre-event / Balance). Editable. `payment_terms_touched` flag prevents auto-regeneration after manual edits.
- Additional notes (for internal use)
- Additional terms (shown on PDF)
- Display options (same as in QuotationDetailModal)

**Step 4 — Share**
- Shows generated quotation ref number
- "Download PDF" button
- "Print PDF" button
- "Share via WhatsApp" — opens `whatsapp://send?text=...` with pre-formatted message; 1.2-second blur fallback to `wa.me` URL
- "Send via Email" button (stub)
- "Close" to finish — lead stage auto-advances to `quote_sent`

**Revision flow:**
If a lead already has a quotation, "New Revision" opens the wizard pre-loaded with prior quote's items and details. On save: old quotation status → `superseded`, new quotation created with `revision_number` incremented, `parent_quotation_id` set.

**Continue Quote:**
If lead is `quote_generation_in_progress`, "Continue Quote" re-opens the wizard with the existing `draft` quotation pre-loaded instead of starting fresh.

---

### 5.8 SETTINGS MODULE

**Company details tab:**
- Company name, Email, Phone 1, Phone 2, Website
- Street address, City, State, Pincode
- GST number, PAN number

**Financial tab:**
- Bank name, Account number, IFSC code, UPI ID
- Default quotation validity (days)
- Default invoice due date (days)

**PDF & Branding tab:**
- Cover page intro paragraph (`cover_intro`) — editable textarea, shown on PDF cover page

**Templates tab (`TemplatesTab`):**
- List of `event_templates` (e.g. "Wedding Package — Full Day")
- Each template: name, description, event type (Wedding/Corporate/etc.)
- Template items: description, sub_event_name (tag), qty, unit price
- Used to pre-populate line items in the quote wizard

**Lead Sources tab (`LeadSourcesTab`):**
- Configurable list of lead sources (e.g. Instagram, Referral, Walk-in, Google)
- Seeded values: phone, whatsapp, referral, website, manual, instagram, facebook, google, walk_in, phone_call

---

## 6. Database Schema

All tables in Supabase (PostgreSQL). RLS is managed by Supabase Auth.

### `settings`
Singleton table (one row per company).
```
company_name, email, phone_1, phone_2, website,
street_address, city, state, pincode,
gst_number, pan_number,
bank_name, account_number, ifsc_code, upi_id,
default_validity_days, default_invoice_due_days,
cover_intro                         ← added in v22 session
```

### `users`
```
user_id, first_name, last_name, email, phone,
role (admin/manager/staff), status (active/inactive),
created_at, updated_at
```

### `lead_sources`
Configurable reference table.
```
source_id, name, is_active, sort_order, created_at
```

### `leads`
```
lead_id, ref_number,                ← ref_number added v22
first_name, last_name, phone, phone_2, email,
source, referred_by,
event_type, tentative_date, location, budget, guest_count,
venue_preference,
stage,                              ← pipeline stage
assigned_to (→ users.user_id),
notes, follow_up_date,
is_deleted, created_at, updated_at
```

### `lead_sub_events`
(Deprecated in design — tentative sub-events removed from lead form in v21. Kept for backward compat.)
```
lead_sub_event_id, lead_id, name, tentative_date,
location, sort_order, is_deleted, created_at
```

### `clients`
```
client_id, ref_number,              ← ref_number added v22
first_name, last_name,
phone_1, phone_2, phone_3,
email_1, email_2, email_3,
street_address, city, state, pincode,
source, status (active/inactive),
preferred_contact, gst_number, notes,
is_deleted, created_at, updated_at
```

### `alternative_contacts`
```
contact_id, client_id,
first_name, last_name, relationship,
phone, email, notes,
is_deleted, created_at, updated_at
```

### `events`
```
event_id, event_name,
client_id (→ clients), lead_id (→ leads),
event_type, status,
start_date, end_date,
venue, city, state,
budget, guest_count,
contact_person_id (→ alternative_contacts, nullable),
assigned_to (→ users),
notes,
is_deleted, created_at, updated_at
```

### `sub_events`
Individual functions within an event (Mehendi / Sangeet / Reception etc.)
```
sub_event_id, event_id,
name, date, location, is_main,
sort_order, is_deleted, created_at
```

### `sub_event_items`
Line items for an event (services/costs).
```
item_id, event_id, sub_event_name,
description, quantity, unit_price, amount,
sort_order, is_deleted, created_at
```

### `event_checklists`
```
checklist_id, event_id,
description, due_date, assigned_to,
is_completed, sort_order, created_at
```

### `quotations`
```
quotation_id, ref_number,
lead_id (→ leads), event_id (→ events, nullable),
client_id (→ clients), client_name,
event_name,                         ← formatted "Firstname's EventType" at creation
status,                             ← draft/sent/approved/superseded/etc.
doc_date, valid_until,
subtotal, discount_pct, discount_amount, grand_total,
payment_terms (text),
payment_schedule (jsonb),           ← [{pct, label, when}, ...]
additional_notes,
additional_terms,                   ← added v22 — shown on PDF
display_options (jsonb),            ← added v22 — PDF display toggles
revision_number (int),
parent_quotation_id (→ quotations, self-ref),
is_deleted, created_at, updated_at
```

### `quotation_line_items`
```
line_item_id, quotation_id,
description, sub_event_name,
quantity, unit_price, amount,
sort_order, is_deleted, created_at
```

### `event_templates`
```
template_id, name, description,
event_type (Wedding/Corporate/etc.),
is_active, created_at, updated_at
```

### `event_template_items`
```
template_item_id, template_id,
sub_event_name,                     ← tags item to a function (Mehendi/Sangeet/Reception)
description, quantity, unit_price,
sort_order, is_deleted, created_at
```

### `invoices`
Currently a stub — table exists, referenced in EventDetail but no invoice UI built.
```
invoice_id, event_id, quotation_id,
ref_number, status,
subtotal, tax_amount, grand_total,
due_date, paid_date,
is_deleted, created_at, updated_at
```

### `counters`
Auto-increment counters, year-scoped.
```
counter_id, type, year, current_value, updated_at
```
Types: `quotation`, `lead`, `client`, `invoice`  
Seeded values (as of v22): lead → 1112, client → 111112, quotation → (starts at 1110+n)

---

## 7. Version History & What Was Fixed

### Before v18 (prior build)
- Settings, Clients, Events modules existed
- Basic Quotations module (no wizard, no PDF)
- No Leads module at all

### v18 → v19 (abandoned)
- Attempted to add ConvertLeadModal with wrong assumptions
- Reverted to v18 as clean base

### v18 → v20 (major architecture session)
**Critical architecture correction:** Lead → Quotation → Event (not Lead → Event → Quotation)

Changes:
- Added Leads module from scratch
- Added `quote_generation_in_progress` stage to lead pipeline
- Built 4-step QuoteGenerationWizard modal
- Added quotations panel to LeadDetail
- Implemented quote revision / supersession logic (old quote → `superseded`, new quote with incremented `revision_number`)
- Fixed `getNextQuotRef()` — was using wrong column names (`key`/`value` instead of `type`/`year`/`current_value`)
- Fixed Supabase password (ran `update auth.users set encrypted_password = extensions.crypt('Isheeka@2026', extensions.gen_salt('bf')) where email = 'vamshi.555@gmail.com' returning id, email` — the `extensions.` prefix is required since pgcrypto functions live there)

### v20 → v21 (16-item fix list)

After live testing v20, 16 bugs/issues found and fixed:

1. **Tentative sub-events removed from lead form** — they don't belong there; sub-events are defined in the quote wizard or on the event itself
2. **Template filter in wizard** — dropdown only shows templates matching the lead's event type (not all templates)
3. **"Continue Quote" fix** — on a `quote_generation_in_progress` lead, the button re-opens the existing `draft` quotation instead of starting a fresh wizard
4. **Client deduplication** — `ClientMatchModal` added; `normPhone()` normalises phone for comparison; prompts "link existing client or create new" on match
5. **`getNextLeadRef()`** — wired to `counters` table correctly (`type='lead'`)
6. **`getNextClientRef()`** — wired to `counters` table correctly (`type='client'`)
7. **Contact cascade** — editing phone/email on a lead prompts to cascade changes to linked quotations + client record
8. **`payment_terms_touched` guard** — if user manually edits payment terms text, auto-regeneration from schedule is suppressed
9. **`additional_terms` field** — textarea in Step 3 of wizard; stored on quotation; rendered on PDF
10. **`display_options` persisted** — PDF display toggles saved to `quotations.display_options` (jsonb); restored when re-opening a quotation
11. **`MAX_QTY` validation** — quantity input in line items step capped at reasonable max
12. **WhatsApp share** — `whatsapp://send?text=...` protocol with 1.2s blur-listener fallback to `wa.me` URL (for when WhatsApp app isn't installed)
13. **PDF CDN** — jsPDF `umd.min.js` + autotable added to `<head>`
14. **PDF generation (initial)** — `buildQuotationPDF()` function built (basic version)
15. **Lead ref number** — assigned at creation, displayed in list and detail
16. **Quotation ref number format** — `Q-26-XXXX` (year-prefixed)

DB changes in this session:
- `counters` type check updated to include `lead` and `client`
- `leads_source_check` updated to include all source values
- `clients.ref_number` column added
- `leads.ref_number` column added
- `quotations.display_options` column added
- `quotations.additional_terms` column added
- `settings.cover_intro` column added
- Lead counter seeded at 1112, client counter at 111112

### v21 → v22 (PDF redesign + 3 remaining fixes)

1. **PDF complete redesign** — 3-page branded layout (see PDF Redesign doc for full detail)
   - Cover page: logo, pill badge, PREPARED FOR, event name, date, three dots, intro para, sign-off
   - Page 2: header with logo+ref, client details box, events & venues table, line items autotable, totals, signature
   - Page 3 (conditional): bank details, payment schedule, additional terms
   - Logo embedded as base64
   - Simple pink border all pages
   - Page numbers
2. **Cover page vertical centering** — `bodyH` + `availH` calculated at runtime; body block positioned with 40/60 top-bias
3. **Page 2 header logo** — enlarged from 80×55 to 100×70
4. **Page 2 signature** — "Founder & CEO" changed from `times italic` to `times bolditalic` (matches cover)
5. **Event name on PDF** — auto-formatted `"Firstname Lastname's EventType"` at quotation creation (not stored as raw event type)
6. **`cover_intro` textarea** — editable in Settings UI, used on PDF cover page
7. **Bank details toggle** — `displayOpts.bankDetails` checkbox; Swathi can choose whether to show bank details on a given quote

---

## 8. Vamsi's Design Philosophy & Decisions

These are the key thinking principles that drove all decisions:

### "Quotation before Event"
The single most important architectural decision. In event management, you don't have a confirmed event until the client says yes to a quote. Therefore: generate a quote first, convert to event only after approval. This avoids the trap of creating phantom events for every enquiry.

### Lead stages reflect real sales behaviour
The pipeline was designed to mirror what actually happens in Swathi's business:
- Someone calls → `new`
- She calls them back → `contacted`
- She starts preparing a quote → `quote_generation_in_progress`
- She sends the quote → `quote_sent`
- Client wants changes → `quote_revision_pending`
- etc.

The stage `quote_generation_in_progress` was specifically added because Swathi might start building a quote, close the laptop, and come back tomorrow. The system needs to reflect "WIP" state so staff know what's happening.

### Templates = Swathi's institutional knowledge
The template system exists because Swathi has learned over 14 years what a typical Wedding package costs and what's included. Templates let her codify that knowledge so staff can generate quotes without starting from scratch each time. Sub-event tagging on template items (Mehendi / Sangeet / Reception) means the quote can be broken down by function automatically.

### PDF is a client-facing document — it must be beautiful
This is not an internal report. This PDF is sent to wealthy families who are planning one of the most important events of their lives. It must feel premium. Hence:
- The 3-page layout with a cover page
- The intro paragraph that sets an emotional tone ("Every great event is a unique story...")
- The Swathi N sign-off in italic — personal, warm, not corporate
- The toggles let Swathi choose: some clients get the full breakdown with prices and bank details; some just get a service overview

### WhatsApp-first communication
In Hyderabad, business runs on WhatsApp. The PDF download + WhatsApp share button is not optional — it's the primary delivery mechanism. Email is secondary.

### Deduplication matters
When a client calls multiple times over months (or years), you don't want 3 "Ramesh Reddy" records. The `normPhone()` + `ClientMatchModal` flow prevents this. Similarly, quotation supersession prevents confusion about which version of a quote is current.

### Don't let Swathi lose work
The `payment_terms_touched` guard exists because: the wizard auto-generates payment terms text from the schedule. But if Swathi manually types something like "50% advance, rest on day" in her own words, pressing any button shouldn't overwrite it. Once touched, it's hers.

### Session timeout
30 minutes. This is a business app used on a shared office device or laptop. If Swathi steps away, no one should find the app open with client data visible.

---

## 9. What's Fully Built vs. Stubs

### Fully Built & Working
- Auth (login, session management, logout)
- Leads module (full CRUD, pipeline, all stages, quote wizard trigger)
- Quote Generation Wizard (all 4 steps, client linking, template loading, line items, quote details, PDF, WhatsApp)
- Quotation detail modal (view, display options, PDF generation, status actions)
- Quotation revision / supersession flow
- Clients module (full CRUD, alternative contacts, deduplication, bulk upload)
- Events module (list, full event detail with all tabs, sub-events, checklist, line items, change client)
- New Event Wizard
- Settings (company details, financial, PDF branding, templates, lead sources)
- PDF generation (full 3-page branded layout)

### Stubs (nav items exist, pages show "Coming Soon")
- Invoices (table exists, EventDetail shows linked invoices, but no Invoice UI / creation flow)
- Vendors
- Vendor Payments
- Expenses
- Reports
- Users management
- Owner Account

---

## 10. Outstanding Work (prioritised)

1. **End-to-end PDF visual test** — generate a real quotation, download PDF, compare to sample design. Fix any spacing/layout issues.
2. **`client_phone` / `client_email` / `client_city` on QuotationDetailModal PDF** — the wizard path enriches `quot` from the lead object; the modal path fetches only from `quotations.*`. Need to join or store these on the quotation row.
3. **Template sub-event tagging** — existing Wedding template is a flat 21-item list with no `sub_event_name` tags. Need to add tags (Mehendi / Sangeet / Reception) so the PDF grouping feature works. This is a data task in the Template Editor (or via SQL).
4. **Invoice PDF & creation flow** — wire up Invoice module: create invoice from event, download invoice PDF (same layout as quotation PDF, `docType='invoice'`).
5. **Quotations standalone list** — currently no list view for quotations; only accessible via lead or event. A standalone Quotations module list would help staff find any quote quickly.
6. **Users module** — admin can create/deactivate staff accounts.
7. **Reports module** — revenue by month, leads by source, conversion rate.

---

## 11. Key Code Locations (search terms for the single HTML file)

| What | Search for |
|---|---|
| Lead stages & labels | `const LEAD_STAGES` |
| Quotation status colours | `const QUOT_STATUS_COLORS` |
| Event types | `const EVENT_TYPES` |
| Navigation structure | `const NAV` |
| Settings module | `function SettingsModule(` |
| Templates tab | `function TemplatesTab(` |
| Lead sources tab | `function LeadSourcesTab(` |
| Clients module list | `function ClientsModule(` |
| Client detail | `function ClientDetail(` |
| Client dedup modal | `function ClientMatchModal(` |
| Events module list | `function EventsModule(` |
| Event detail | `function EventDetail(` |
| New Event Wizard | `function NewEventWizard(` |
| Lead list | `function LeadsModule(` |
| Lead detail | `function LeadDetail(` |
| Lead form | `function LeadForm(` |
| Quote Generation Wizard | `function QuoteGenerationWizard(` |
| Quotation Detail Modal | `function QuotationDetailModal(` |
| Convert Lead Modal | `function ConvertLeadModal(` |
| PDF function | `function buildQuotationPDF` |
| Ref number generators | `async function getNextQuotRef` |
| Phone normalisation | `function normPhone` |
| Supabase init | `const supabase = createClient` |
| Session constants | `const SESSION_TIMEOUT` |
| App root + nav render | `function App()` |
