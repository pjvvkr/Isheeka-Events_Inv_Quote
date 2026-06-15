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

### F.6 Decisions — RESOLVED (15 Jun 2026)

1. **Email provider:** ✅ **Resend**, shared sender (`onboarding@resend.dev`) for now; switch to a branded/own-domain address before go-live. Wrapped in a swappable email adapter so changing provider later is trivial.
2. **Access is dual-mode:** ✅ **`pin` (staff-shared) is the default**, **`email_otp` optional** when the client has/prefers email. Email is therefore never required to use an RFQ.
3. **Posture:** ✅ holding to **token-hash + Edge-Function-only (service_role)**; RFQ tables stay authenticated-only with no anon access.
4. **Windows (defaults, change anytime):** link validity **21 days**; OTP lifetime **10 min**; PIN valid for the link's life; **lock after 5** failed attempts on either.
