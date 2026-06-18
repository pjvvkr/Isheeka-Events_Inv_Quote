# Milestone S — Sourcing & Markup (Vendor RFQ)

_Status: SPEC LOCKED · not yet built. Authored 2026-06-18 with the owner._
_Companion to `rfq-portal-spec.md` §J (original proposal)._

## 1. Purpose & business context

Isheeka subcontracts items to vendors and earns the **markup** (client price − vendor cost).
On an event, some items are vendor-supplied and some are managed in-house. So between
**client RFQ approved** and **quote sent** there is a **sourcing + pricing** stage. Milestone S
adds that stage: send the approved item list to vendors, collect their costs, compare, apply
markup, and generate a priced quote — plus a saved costing summary for the audit trail.

This slots *between* two things that already work (client RFQ approval upstream; the
quote→invoice→event flow downstream), so nothing existing is rebuilt.

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| a | Multiple vendor RFQs per client RFQ? | **Yes** — compare bids side-by-side; choose cheapest per item or split across vendors. |
| b | Markup model | **Global default + per-item override.** |
| c | Per-item "manage in-house" toggle? | **Yes** — in-house items are priced directly and excluded from vendor RFQs. |
| d | When a vendor marks "can't supply"? | **Flag it; fall back** to another vendor's bid or the in-house cost. No auto-assignment. |
| e | Vendor reminders | **Manual now** (per-vendor + "remind all pending"). Scheduled auto-reminders deferred. |
| f | Vendor privacy | Vendor sees **event basics + the item list only** — not the client's name, not the markup, not other vendors' bids. |

## 3. Data model (one engine, two audiences)

Generalize the existing RFQ tables rather than building a parallel system:

- **`rfqs`** — add:
  - `party_type text` — `'client'` (default, existing rows) | `'vendor'`.
  - `parent_rfq_id uuid` — for a vendor RFQ, the client RFQ it sources (null for client RFQs).
  - `vendor_id uuid` — for a vendor RFQ, the vendor (FK → `vendors`).
  - `reminder_count int default 0`, `last_reminded_at timestamptz` — reminder tracking.
- **`rfq_items`** — add:
  - `unit_cost numeric` — the vendor's per-unit cost (null until entered).
  - `can_supply boolean default true` — vendor marks false for "can't supply".
  - `item_note text` — vendor's per-item note (surfaces on the costing screen).
- **`settings`** — add `default_markup_pct numeric default 30` (the global markup default).
- **`costing_summaries`** (new) — the audit artifact. One row per generated costing:
  `costing_summary_id`, `client_rfq_id`, `event_id` (once converted), `generated_by`,
  `generated_at`, `default_markup_pct`, `total_cost`, `total_client`, `total_margin`,
  `internal_notes text`, and a `lines jsonb` snapshot (per item: every vendor's cost,
  can_supply, chosen source, chosen cost, markup applied, override reason, client price).
- **Gateway** (`rfq-gateway` edge function) — add a **vendor mode**: items pre-populated,
  vendor edits `unit_cost` / `can_supply` / `item_note`; same token + PIN/OTP auth, autosave,
  revisions, sign-off reused from the client RFQ machinery.

RLS: vendor RFQ rows follow the same authenticated-staff policy internally; the vendor's
public access stays gated through the edge function (service_role), scoped to one rfq_id.

## 4. Screens & UX

### 4.1 Sourcing panel (client RFQ detail, RFQs module)
Appears once the client RFQ is **approved**. Shows the frozen item count + default markup.
- **"+ Send vendor RFQ"** → modal: pick one or more vendors from the directory, confirm the
  frozen sourceable item list (in-house items excluded), generate per-vendor links (token+PIN),
  share via WhatsApp/copy.
- **Vendor RFQ list** — one row per vendor: live status (Sent → Opened → Submitted), per-vendor
  detail (e.g. "3 priced · 1 can't supply"), share controls (copy link, PIN, **Remind**), and
  **View bid**.
- **Remind** (manual): re-sends the existing link with a reminder message to any not-yet-submitted
  vendor; row shows "reminded N× · last Xd ago"; logged to activity. **"Remind all pending"** nudges
  everyone outstanding at once.
- **"Open costing & markup"** — activates once ≥1 bid is in.

### 4.2 Vendor portal (vendor mode of `rfq.html`)
Vendor opens link → PIN/OTP gate → sees Isheeka branding, a reference, event basics, and the
**sourceable item list** (in-house items not shown). Per item: enter **unit cost**, or tick
**"can't supply"** (disables that item's cost), plus an optional **per-item note**. Running total +
an overall note. **Save draft** (autosave, resume via same link) or **Submit bid**; can **revise**
after submitting until pricing is finalized.

### 4.3 Costing & markup screen (staff)
Every client item as a row; columns = each vendor's cost (side-by-side), in-house cost,
markup % (default + per-item override), computed client price. The cheapest available source is
**auto-selected** (highlighted); "can't supply" cells are flagged and fall back to another bid or
in-house. Additions:
- **Vendor notes** — per-item indicator to read any note the vendor attached.
- **Internal notes** — a staff notes box for the whole exercise.
- **Two outputs:** **Generate quote** (priced draft, item-for-item → existing quote flow) and
  **Generate costing summary** (saved, timestamped audit snapshot — every vendor bid, what was
  chosen and why, markup, internal notes — cross-referable later against the RFQ/event).

### 4.4 End-to-end flow
Client submits RFQ → staff approve (freeze items) → send vendor RFQs → vendors bid / in-house
priced → costing & markup (compare, choose, mark up, note) → generate quote + summary → existing
quote → approve → invoice → event.

## 5. Validations before "Generate quote"

**Hard blocks (must pass):**
1. **Full coverage** — every client RFQ item resolves to a price (chosen vendor with a cost, or
   an in-house cost). Names the gaps; also catches "all vendors can't supply this item".
2. **In-house cost present** — any in-house-toggled item has a cost entered.
3. **Valid quantities** — every item qty > 0 (carried from the RFQ).
4. **Source RFQ valid** — the client RFQ is approved and not cancelled.

**Soft warnings (confirm to proceed):**
5. **Margin protection** — flag any item with client price ≤ cost; warn if **total margin** is below
   a **configurable floor** (Settings, default 15%).
6. **Zero-cost item** — likely a missed entry.
7. **Markup typo guard** — implausibly high override (e.g. >200%).
8. **Unresponded vendors** — "N of M haven't submitted — generate anyway or wait?"
9. **Stale bid** — a vendor revised after the selection was last reviewed → refresh first.
10. **Override-without-reason nudge** — picking a costlier source over the cheapest prompts for a
    one-line reason, auto-captured into the costing summary.
11. **Regenerate guard** — if a draft quote already exists from this RFQ, replace vs keep both.

## 6. Phase plan (each phase shippable)

- **S1 — Foundation:** schema migration (rfqs/rfq_items/settings/costing_summaries) + gateway
  vendor mode. Backend only; nothing user-visible.
- **S2 — Send & track vendor RFQs:** Sourcing panel (send modal, status list, manual reminders) +
  the vendor portal (vendor mode of rfq.html).
- **S3 — Costing & markup screen:** compare/choose/markup/notes + validations + Generate quote +
  Generate costing summary.
- **S4 — Later (M4):** rich revision/compare UX for both client & vendor RFQs.

## 7. Deferred / later
- Scheduled auto-reminders to vendors.
- Read-only "sourcing history" on each Vendor's profile.
- Splitting a single item across multiple vendors at quote time (the data supports it; the UX is M4).
- Role-aware access (Owner/admin-only visibility of costs/margin) — pairs with the global
  role-based-access work.
