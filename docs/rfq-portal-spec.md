# Isheeka ERP — Client Portal (RFQ) + Client 360 — Living Spec

The working spec for the next initiative. We detail each component here **before** building; build only after Vamsi approves each milestone's spec + mockup.

_Started: 14 Jun 2026._

---

## A. Vision

Replace the WhatsApp-screenshot intake with a **branded, client-facing RFQ portal** that captures client + event + item requirements, runs a **dual sign-off** (client + Swathi), and **auto-feeds the ERP** (creates the client master + a draft quote with the exact approved items). Plus a **Client 360** view so any client's full history is visible at a glance.

## B. Locked decisions

1. **Terminology:** internal module = "RFQ"; client-facing heading = "Your Event Requirements".
2. **OTP channel = email** (free) for v1; WhatsApp/SMS is a later upgrade.
3. **Approval = round-trip dual sign-off:** client finalizes → Swathi reviews → she can **request a revision** (client edits) or **approve**. On final approval the **item list locks** and becomes the basis of the quote → invoice **item-for-item** (no later drift). Swathi adds prices; changing *items* requires sending it back as a revision.
4. **Security:** public form is a standalone page reaching the DB **only** through a **Supabase Edge Function** gateway, scoped by a per-RFQ token. No ERP access, no anonymous DB access. (Architecture diagram shared in chat.)
5. **Recurring clients:** a client engages for **many events over time** — every client-facing and 360 view must be event-grouped, not single-event.

## C. Architecture (one loop, two sides)

- **Staff side:** existing ERP app (authenticated, RLS) — adds an "RFQs" module.
- **Client side:** standalone branded public page (`rfq.html` on GitHub Pages) — OTP-gated, token-scoped, no ERP.
- **Gateway:** Supabase **Edge Function** validates token + OTP, reads/writes RFQ tables with the server key. Tables stay fully locked (no anon access).
- **Email OTP:** Edge Function generates/verifies a 6-digit code, sent via a free transactional-email service.

## D. Roadmap (approved order — Client 360 first)

- **M0 — this spec doc.** ✅ started.
- **M1 — Client 360 (ERP).** Event-grouped relationship view on the client detail page. *Independent of RFQ infra — built first.* RFQ row added to it later.
- **M2 — Foundations.** RFQ tables + Edge Function gateway + email OTP. (Backbone; mostly invisible.)
- **M3 — End-to-end MVP.** Minimal ERP "RFQs" module (create, link, review, approve, convert) + branded client form (OTP → details/event/items/review → autosave/resume → submit) + auto-create client + draft quote on approval.
- **M4 — Revisions + dual sign-off.** Client revision list/load/finalize/lock + change-log + compare; Swathi "request changes" loop; both e-signs logged; approved items lock to the quote/invoice.
- **M5 — Phase-3 polish.** WhatsApp/SMS OTP, richer diff, client notifications.

Rhythm per milestone: spec here → mockup → Vamsi approves → build → checkpoint test → changelog.

---

## E. Milestone 1 — Client 360 (in detail)

**Where:** the existing client detail page (`ClientDetail`) gets a "360 / relationship" view. Reached from the Clients list (and from any client link via the breadcrumb nav).

**Recurring-aware structure (top → bottom):**

1. **Client header** — name, status chip, contact (phone/email/city), "client since".
2. **Lifetime summary (KPIs across ALL their events):**
   - Events (count, e.g. "3 events · 1 upcoming")
   - Total invoiced · Total received · **Outstanding (receivable)**
   - **Vendor payables** across their events (what Isheeka still owes vendors for this client's events)
   - (Optional later: rough margin = invoiced − vendor cost − expenses.)
3. **Per-event cards (newest first) — the recurring core.** Each event is its own card showing:
   - Event name · ref · type · date · status chip + funnel badge.
   - The **chain** for that event: [RFQ →] Quote(s) → Invoice(s) → Payments → Vendor payments — each a click-through link.
   - Money line for that event: invoiced / received / outstanding / vendor balance.
   - Expand/collapse for the detail; collapsed by default beyond the most recent.
4. **Open opportunities (not yet an event):** any leads/quotes for this client not tied to an event (live pipeline) shown separately so nothing's hidden.

**Data sources (all already exist):** `events` (by client_id), `quotations` (by client_id/event_id), `invoices` (by client_id/event_id), `invoice_payments` (by invoice), `event_vendors`/`vendor_payments` (by event_id), `leads` (source). Cancelled records de-emphasised/excluded from money totals (consistent with existing metric rules).

**Build notes:** read-only aggregation view; one batched load of the client's events + linked records; reuses existing status/funnel badges and the nav cross-links (with labels). No schema change, no migration.

**Open question for mockup approval:** event-card layout — expandable cards (recommended) vs a single chronological timeline. Mockup will show the event-grouped cards.

**STATUS: ✅ BUILT & VERIFIED LIVE (15 Jun 2026, changelog #104).** Event-grouped, recurring-aware, click-through chain, read-only, no migration. Tested on real data (a 5-event repeat client + single-event clients).

---

## F. Milestone 2 — Foundations (in detail) — *spec for approval, not yet built*

**Goal:** lay the secure backbone so a client can later open a private link, prove they're the intended recipient (email OTP), and fill an RFQ — **without ever touching the ERP or the database directly.** M2 is mostly invisible: no staff UI, no polished client form yet (those are M3). M2 ends when we can prove, end-to-end, that the OTP + gateway plumbing works.

### F.1 Trust boundary (the whole security model in one breath)

Three zones, one gate between the public and the data:

- **Public zone** — `rfq.html` on GitHub Pages. Holds **no keys**. Talks **only** to the Edge Function. Never imports the Supabase client.
- **The gate** — a Supabase **Edge Function** (`rfq-gateway`). It is the *only* thing that reads/writes the RFQ tables on the public path. It validates a per-RFQ **link token** + an **email OTP**, issues a short-lived **session**, and uses the server-only **service_role** key to touch the database — scoped to exactly one `rfq_id`.
- **Staff zone** — the existing ERP (authenticated, RLS). Reads/writes the RFQ tables through normal `authenticated` policies, exactly like every other table today.

**RLS posture for the new tables:** RLS ON; `authenticated`-only policies for staff (same model as the rest of the app); **no `anon`/`public` policies at all.** The public page can't reach these tables even with the anon key — only the Edge Function (service_role) can, and it's gated. This keeps us consistent with the security-checklist rule "every policy scoped to authenticated."

### F.2 Data model (new tables — draft DDL for review)

All keyed off `rfq_id` (uuid). Follows existing conventions: `ref_number` via the atomic `next_counter` function, soft-delete via `is_deleted`, timestamps.

```sql
-- 1) The request itself
create table public.rfqs (
  rfq_id          uuid primary key default gen_random_uuid(),
  ref_number      text unique,                         -- RFQ-YY-#### via next_counter
  status          text not null default 'draft',       -- draft|sent|in_progress|submitted|changes_requested|approved|converted|expired|withdrawn
  -- linkage (all nullable; filled as the funnel progresses)
  client_id       uuid references public.clients(client_id),     -- set for recurring clients, or created on approval
  lead_id         uuid references public.leads(lead_id),         -- if it originated from a lead
  event_id        uuid references public.events(event_id),       -- set when converted (M3)
  quotation_id    uuid references public.quotations(quotation_id),-- the draft quote created on approval (M3)
  -- what we capture
  contact_name    text,
  contact_email   text,                                -- optional; required only for email-OTP mode
  contact_phone   text,
  access_mode     text not null default 'pin',         -- 'email_otp' | 'pin' (how the client unlocks the link)
  access_pin_hash text,                                 -- SHA-256 of the staff-shared PIN (when access_mode='pin')
  event_type      text,
  event_date      date,
  location        text,
  guest_count     int,
  budget          numeric,
  notes           text,
  -- access control
  token_hash      text not null,                       -- SHA-256 of the link token (raw token lives only in the URL)
  token_expires_at timestamptz,                        -- link validity window (default +21 days)
  revision_number int not null default 0,              -- bumped on each staff "request changes" round (M4)
  -- sign-off audit
  client_submitted_at timestamptz,
  staff_approved_at   timestamptz,
  approved_by         uuid,                            -- staff auth uid
  created_by      uuid,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  is_deleted      boolean default false
);

-- 2) The line items the client requests (no prices — Swathi prices them in the quote)
create table public.rfq_items (
  rfq_item_id     uuid primary key default gen_random_uuid(),
  rfq_id          uuid not null references public.rfqs(rfq_id) on delete cascade,
  sub_event_name  text,                                -- mirrors quote/sub-event grouping
  description     text not null,
  quantity        numeric default 1,
  unit            text,
  source          text default 'custom',               -- catalog|custom
  sort_order      int default 0,
  is_deleted      boolean default false,
  created_at      timestamptz default now()
);

-- 3) Email OTP codes (hashed, short-lived, attempt-limited)
create table public.rfq_otp (
  otp_id          uuid primary key default gen_random_uuid(),
  rfq_id          uuid not null references public.rfqs(rfq_id) on delete cascade,
  email           text not null,
  code_hash       text not null,                       -- SHA-256 of the 6-digit code
  expires_at      timestamptz not null,                -- +10 min
  attempts        int default 0,                       -- lock after 5
  consumed_at     timestamptz,
  created_at      timestamptz default now()
);

-- 4) Activity / dual sign-off audit (who did what, when)
create table public.rfq_activity (
  activity_id     uuid primary key default gen_random_uuid(),
  rfq_id          uuid not null references public.rfqs(rfq_id) on delete cascade,
  actor           text not null,                       -- 'client' | staff auth uid
  action          text not null,                       -- created|sent|otp_sent|otp_verified|saved|submitted|changes_requested|approved|converted
  notes           text,
  created_at      timestamptz default now()
);

alter table public.rfqs       enable row level security;
alter table public.rfq_items  enable row level security;
alter table public.rfq_otp    enable row level security;
alter table public.rfq_activity enable row level security;
-- authenticated-only policies (staff). NO anon/public policies. Edge Function uses service_role.
-- (policy DDL delivered with the migration on approval.)
```

### F.3 Edge Function `rfq-gateway` (the only public door)

One function, action-routed (`POST { action, ... }`). Uses `service_role` (a function secret, never shipped to the browser). Every action is scoped to a single RFQ.

| Action | Input | What it does | Guard |
|---|---|---|---|
| `request_otp` | `token`, `email` | Look up RFQ by `token_hash`; **only if `email` matches the RFQ's `contact_email`**, generate a 6-digit code, store its hash (`+10 min`), email it. | rate-limited (e.g. ≤3/15 min per RFQ); link not expired |
| `verify_otp` | `token`, `email`, `code` | Check hash + not expired + `attempts<5`; on success mint a short-lived **session** (HMAC-signed, ~2 h, carries `rfq_id`+exp). | increments `attempts`; locks after 5 |
| `verify_pin` | `token`, `pin` | (mode=`pin`) Check `access_pin_hash` + `attempts<5`; on success mint the same session. **No email needed.** | attempt-limited; link not expired |
| `get_rfq` | `session` | Return that RFQ + its items + the **catalog** (event-type templates) for selection. | valid session only |
| `save_rfq` | `session`, fields + items | Autosave / resume — writes **only** to that `rfq_id` (details + items). | valid session; RFQ still editable by client |
| `submit_rfq` | `session` | Mark `submitted`, log client sign-off in `rfq_activity`, freeze client editing pending staff review. | valid session; status in (sent,in_progress) |

**Token:** raw random token lives only in the link (`rfq.html?t=…`); DB stores `token_hash`. **Session:** signed, expiring, never grants DB access by itself — it only authorizes further gateway calls.

**Two access modes (email is optional):** every RFQ is unlocked one of two ways, both ending in the same verified session:
- **`email_otp`** — `request_otp` → code emailed (Resend) → `verify_otp`. Self-serve; needs a `contact_email`.
- **`pin`** — staff generates a short PIN when creating the RFQ (shown in the ERP, stored as `access_pin_hash`); staff shares **link + PIN** over WhatsApp/SMS/in person/tablet. Client enters the PIN via a `verify_pin` action → session. **No email required.** This is the default, and the natural fit for the in-person tablet hand-over.

Security note: a shared PIN lives as long as the link (vs. a 10-min OTP), so it's marginally weaker if *both* link and PIN are intercepted — defended by: needing the unguessable token **and** the PIN, attempt limits (lock after 5), the link-expiry window, and a staff "regenerate PIN / revoke link" action. Acceptable for staff-initiated sends to a known client; email OTP remains available when a client prefers it / has email.

**Email/OTP delivery:** via a free transactional-email provider; its API key is a **function secret**. Provider choice + sending domain is the one external dependency that needs your input (below).

### F.4 What M2 delivers vs. defers

- **Delivers:** the 4 tables + migration (RLS + authenticated policies), the `rfq-gateway` Edge Function with all 5 actions, working **email OTP end-to-end**, and a throwaway test page to prove the loop (request code → receive email → verify → fetch a seeded RFQ). A tiny staff helper to **mint an RFQ + link** (so we have something to test against) — minimal, not the real M3 module.
- **Defers to M3:** the branded client form UI, the real ERP "RFQs" module (create/review/approve/convert), auto-create client + draft quote on approval.
- **Defers to M4:** revisions, the request-changes round-trip, item-lock to quote/invoice, compare/diff.

### F.5 Ops note (new deploy step — important)

The static app deploys via GitHub Desktop as today. **Edge Functions deploy separately** (`supabase functions deploy rfq-gateway`, or paste into the Supabase dashboard's Functions editor). Secrets (`service_role`, email API key, session-signing secret) are set with `supabase secrets set` / in the dashboard — **never** in the repo. I'll provide exact commands; you run them once.

**STATUS: ✅ DEPLOYED & VERIFIED LIVE (15 Jun 2026).** Migration run; `rfq-gateway` deployed via CLI (`--no-verify-jwt`) to project `jlcssesetnxulnkbrmyp`; secrets `SESSION_SECRET` + `ALLOWED_ORIGIN=*` set (Resend not yet configured → stub mode). Full loop tested with a seeded RFQ (token `isheeka-test-token-001`, PIN `4321`): ping → verify_pin → get_rfq → save_rfq → submit_rfq all succeeded; `rfq_activity` logged pin_verified/saved/submitted; items persisted. **Before go-live:** (1) add Resend key + `EMAIL_FROM` to enable real email OTP, (2) lock `ALLOWED_ORIGIN` to the GitHub Pages origin, (3) delete the test RFQ. Redeploy command: `supabase functions deploy rfq-gateway --no-verify-jwt --project-ref jlcssesetnxulnkbrmyp`.

### F.6 Decisions — RESOLVED (15 Jun 2026)

1. **Email provider:** ✅ **Resend**, shared sender (`onboarding@resend.dev`) for now; switch to a branded/own-domain address before go-live. Wrapped in a swappable email adapter so changing provider later is trivial.
2. **Access is dual-mode:** ✅ **`pin` (staff-shared) is the default**, **`email_otp` optional** when the client has/prefers email. Email is therefore never required to use an RFQ.
3. **Posture:** ✅ holding to **token-hash + Edge-Function-only (service_role)**; RFQ tables stay authenticated-only with no anon access.
4. **Windows (defaults, change anytime):** link validity **21 days**; OTP lifetime **10 min**; PIN valid for the link's life; **lock after 5** failed attempts on either.

---

## G. Milestone 3 — End-to-end MVP — *spec for approval, not yet built*

**Goal:** the portal becomes real. A client opens their link, fills **"Your Event Requirements,"** and submits; staff review it in a new **RFQs** module and, on approval, the system **auto-creates the client (if new) + a draft quote with the exact items** — which then flows into the existing Quote → Event → Invoice pipeline. This is the largest milestone.

### G.1 Two new surfaces

1. **`rfq.html`** — a NEW standalone branded page on GitHub Pages (sibling to the app), the client-facing form. Holds no keys; talks only to `rfq-gateway`. Warm rose/champagne identity, mobile-first (works on the tablet hand-over and on a phone via the shared link).
2. **RFQs module** — a new section inside the ERP (`isheeka-erp-v22.html`), under **Sales** near Leads. Staff create/track/review/approve RFQs here. Uses the normal authenticated Supabase client (RLS) like every other module.

### G.2 Client flow (`rfq.html`)

- **Branding (req 1):** the masthead mirrors the **full PDF cover header** — **"Isheeka Events" in Great Vibes** (script, rose), **"Making Every Event Memorable" in Cormorant Garamond italic** (rose), and **"Since 2017" in Great Vibes** (champagne gold) — all from Google Fonts so the page matches the PDF identity exactly. Warm rose/champagne palette throughout. (Optionally the "ie" logo mark above, as on the PDF/PWA.)
- **Unlock screen:** branded header → "Enter your PIN" (default) or "Email me a code" (if `access_mode=email_otp`). Calls `verify_pin` / `request_otp`+`verify_otp` → session.
- **Stepper (4 steps), autosaving each step via `save_rfq`:**
  1. **Your details** — name, phone, email (pre-filled; editable) **+ a secondary contact (name + phone)** for the event (req 2). The secondary contact flows into the ERP so it can populate the lead/quote's alternative contact.
  2. **Event details** — **main event** (type, e.g. Wedding) with its **Planned date**; **which sub-events apply** (Mehendi · Haldi · Sangeeth · Reception suggested as tappable chips from your templates, plus "+ add your own") — **and each selected sub-event gets its own Planned date** (req: per-function dates); **venue and city as separate fields** (req 3); guest count; **approximate budget as a dropdown of ranges** (req 4, see below); notes. The date fields are labelled **"Planned date"** (req). The chosen main + sub-events with their dates (ordered) are saved and drive Step 3 + the eventual quote/event structure.
  3. **Your requirements (items)** — **one section per sub-event the client picked**; within each, the **catalog** (items from `event_templates` whose sub-event matches, else all items for the type) appears as add-able lines; client adjusts quantity, **adds custom lines**, removes. **No prices shown.** Items carry `sub_event_name` so the structure maps 1:1 into the quote.
  4. **Review & submit** — full summary → **Submit** (`submit_rfq`) → branded thank-you ("Swathi will review and send your quote").
- **Navigation, draft & resume (req 5):** the client can move **Back/Next freely** between steps; every step **autosaves** (status `in_progress`); they can **close and resume** from the same link + PIN/OTP, landing where they left off; they can **edit anything before Submit**. After Submit the form is **read-only** until staff approve or request changes.
- **Approx-budget ranges (req 4):** Under ₹1 Lakh · ₹1–3 Lakh · ₹3–5 Lakh · ₹5–10 Lakh · ₹10–20 Lakh · ₹20–30 Lakh · Above ₹30 Lakh · "Not sure yet". Stored as `budget_range` (text); we can also keep a numeric lower-bound in `budget` for sorting/reports.
- **Post-submit revision management** (client edits a *submitted* RFQ, list/compare/load-any-revision-as-final, dual e-sign log, item-lock to quote/invoice) — these are the richer features you called out earlier; they belong to **M4**. M3 delivers the back/forth + draft/resume + a basic staff "request changes" round-trip.

### G.3 Staff RFQs module (in the ERP)

- **List:** ref, client/contact, event type, date, **status chip** (draft/sent/in_progress/submitted/changes_requested/approved/converted), newest first; filter by status. A **"⏳ Needs review"** emphasis on `submitted`.
- **+ New RFQ:** pick an **existing client** (recurring) or enter a new contact; event basics; choose access mode → **PIN auto-generated** (or email OTP). On save it mints the token and shows a **shareable link + PIN** with **Copy** and **WhatsApp** buttons. (Link = `rfq.html?t=<token>`.)
- **RFQ detail / review:** shows submitted details + items (read-only once `submitted`); the chain back to client/lead/event if linked. Staff actions:
  - **Request changes** → status `changes_requested`, `revision_number+1`; client can edit & resubmit. (Full diff/compare is M4; M3 just round-trips.)
  - **Approve & create quote** → see G.4.

### G.4 Approve → auto-create (the payoff)

On **Approve**:
1. **Client:** if `rfq.client_id` is null, **create a `clients` record** from the contact details (via `getNextClientRef`). **Dedupe:** if phone/email matches an existing client, surface a "use existing vs create new" choice to staff (no silent merge).
2. **Draft quote:** create a **draft `quotations`** for that client with the RFQ items mapped **item-for-item** (description, qty, sub_event_name; **price blank** for staff to fill) — the "no drift" guarantee.
3. Set `rfq.status='converted'`, `rfq.client_id`, `rfq.quotation_id`, `staff_approved_at`, `approved_by`; log `approved`/`converted` in `rfq_activity`.
4. Staff lands on the familiar **quote editor** to price & send. **Event** is still created later at quote-confirm (existing flow) — M3 does not create the event, keeping the pipeline unchanged.

### G.5 Build pieces

- **`rfq.html`** (new file): unlock + 4-step form, all via `fetch` to the gateway; warm theme; mobile-first; autosave/resume.
- **Gateway:** wire `get_rfq`'s catalog to `event_templates` filtered by event type (small change to the existing function).
- **ERP (app HTML):** new `RFQsModule` (list + new + detail/review) and the **approve→create-client+draft-quote** helper, reusing `getNextClientRef`, the quote-creation path, and existing status/nav patterns. Nav entry under Sales.
- **Migration addendum (one `alter table`, delivered with M3):** add to `rfqs` — `sub_events jsonb` (ordered list of `{name, planned_date}` for each sub-event), `event_date` already exists = the main event's Planned date, `secondary_contact_name text`, `secondary_contact_phone text`, `city text` (venue stays in `location`), `budget_range text`. Otherwise M2's tables are enough; `revision_number` already present for the M4 round-trip.

### G.7 Decisions — RESOLVED (15 Jun 2026)

1. **On approve:** ✅ create **client + draft quote only**; event created later at quote-confirm (existing flow unchanged).
2. **Dedupe:** ✅ **prompt staff** to reuse the matching client or create new — no silent merge.
3. **Catalog:** ✅ from **event templates** for the chosen type (grouped by sub-event), plus custom lines.
4. **Form scope v1:** ✅ the **4 steps** only. **Added requirement:** Step 2 lets the client pick the **main event + sub-events** (e.g. Wedding → Mehendi/Haldi/Sangeeth/Reception), which structure Step 3 and the resulting quote.

### G.8 Suggested build order (each with a checkpoint)

1. ✅ **CP1** — migration + `rfq.html` unlock + Steps 1–2 + autosave (DONE & verified).
2. ✅ **CP2** — Step 3 items + catalog + Step 4 submit (DONE & verified).
3. **CP3** — ERP RFQs **list + New RFQ** (mint link/PIN + share) + entry points (§I).
4. **CP4** — ERP RFQ **detail/review + Request changes**.
5. **CP5** — **Approve → create/confirm client + freeze items**, then route to **either** "Price it myself" (manual draft quote) **or** "Source from vendors" (→ Milestone S). Dedupe prompt.
6. Polish + end-to-end test + changelog.

---

## I. Staff entry points (make starting an RFQ frictionless)

An RFQ can be started from **multiple places** — same New-RFQ flow underneath, pre-filled by context:

1. **Client 360 / client detail** — "＋ New RFQ" in the header → pre-fills the client (the recurring-client path).
2. **Lead detail** — "Send requirements link" → the modern replacement for WhatsApp-screenshot intake; turns a raw enquiry into a structured RFQ, then Approve creates the client.
3. **RFQs module** (under Sales) — "＋ New RFQ" with an existing-client/lead picker **or** a brand-new contact.
4. **Dashboard** — a "Needs review" count (submitted RFQs) + a quick "New RFQ" action.
5. **Tablet / kiosk mode** — "Hand to client" opens the form locally for in-person fill (PIN-gated, no ERP access).
6. (Optional later) **Events** — "Request more items" against an existing event.

All routes converge on one `createRfq()` helper + the share panel (link + PIN, Copy / WhatsApp).

---

## J. Milestone S — Sourcing & Markup (Vendor RFQ)  — *NEW, proposed*

**Business context:** Isheeka subcontracts items to vendors and profits on the **markup** (client price − vendor cost). On an event, **some items are vendor-supplied, some managed in-house.** So between *RFQ approved* and *quote sent* sits a sourcing + pricing step.

**Flow (proposed):**
1. Client RFQ approved (client + Swathi) → the **approved item list is frozen** as the sourcing basis.
2. Swathi triggers one or more **Vendor RFQs** — each is the same engine as the client RFQ but **vendor-facing**: the vendor opens a link (token + PIN/OTP), sees the item list, and for each item enters a **unit cost** or marks **"can't supply."** Autosave, **revise**, **multiple revisions**, and **dual sign-off (vendor + Swathi)** — all reused from the client RFQ machinery.
3. Swathi is notified when a vendor submits.
4. **Costing & markup screen** (staff): every client item in rows; columns show **vendor cost(s)** (supports comparing multiple vendors per item), an **in-house cost** field (for items Swathi manages or vendors can't supply), a **markup %** (global default + per-item override), and the **computed client price** (`cost × (1+markup)`, with rounding). One click → **Generate quote** with these client prices, **item-for-item**.

**Scalable architecture — one RFQ engine, two audiences:** generalize `rfqs` with `party_type ('client'|'vendor')`, `parent_rfq_id` (vendor RFQ → its client RFQ), and `vendor_id`; add `rfq_items.unit_cost` + `can_supply`. The gateway gains a vendor mode (items pre-populated, vendor edits costs). Costing screen joins client items ↔ vendor bids. This avoids a parallel system and inherits revisions/sign-off for free.

**My suggested refinements (for your input):** (a) allow **multiple vendor RFQs per client RFQ** so Swathi can compare/split items across vendors; (b) **markup = global default with per-item override**; (c) per-item **"manage in-house"** toggle; (d) vendor "can't supply" auto-routes the item to in-house or another vendor on the costing screen.

**Revised roadmap:** M3 (client RFQ + staff module + approve) → **Milestone S (Sourcing & Vendor RFQ + costing/markup → quote)** → M4 (rich revision/compare UX for both client & vendor RFQs). Milestone S is sizeable and is specced/mocked on its own before any build.

**Open decisions — see chat (AskUserQuestion).**
