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
