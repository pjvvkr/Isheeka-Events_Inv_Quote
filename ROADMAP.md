# Isheeka Events ERP - Improvement Roadmap

> Living plan for UI/UX, the document-flow feature, and infra/ownership hardening.
> Companion to ARCHITECTURE.md. Written 2026-06-29. Phases ship in small, approved,
> tested slices (analysis -> approval -> build -> `npm test -- --run` -> one commit).

## Context: current security / RLS status (verified against the live DB 2026-06-29)

The RLS lockdown is **done**, not pending:
- Tier 1 applied: `anon` table/function access revoked (portals go through the
  service-role gateway), `rfq_otp` locked to the gateway, `search_path` pinned on functions.
- Tier 2 applied: every table's read policy is **module-gated** via `app_can('<module>')`
  (e.g. `invoices_read -> app_can('invoices')`). "Can't open the module => can't read its
  rows" is now true at the database level. Only intentional lookup tables (event_types,
  lead_sources, templates, users) remain world-readable to authenticated users.

Remaining security items are **minor hardening**, folded into Phase 0 (not a lockdown):
free Supabase dashboard toggles (leaked-password protection, MFA for owner/admin, confirm
backups/PITR), `pg_net` in public schema, a permissive `short_links` INSERT check, the
`app_*` SECURITY DEFINER helpers callable via RPC, and `npm audit fix` (non-force).

---

## Phases at a glance

| Phase | Theme | Effort | Impact | Risk | Depends on |
|-------|-------|--------|--------|------|-----------|
| 0 | Infra & ownership | Small | High | Low | - |
| 1 | Design-system foundation | Large | High | Medium | - |
| 2 | Document-flow component | Medium | High | Low | light Phase 1 |
| 3 | Responsive / mobile (deferred) | Med-Large | High (eventual) | Medium | Phase 1 |
| 4 | Interaction polish + a11y | Medium | Med-High | Low | Phase 1 |
| 5 | Data-scale UX | Medium | Medium (grows) | Low-Med | Phase 1 |

Recommended order: 0 -> 1, then interleave 2 and 4. 3 is deferred until mobile use is real.
5 is on-demand as data volume grows.

---

## Phase 0 - Infra hardening & ownership (do first)

Quick, high-value, no dependency on UI work. Outcome: you own and control the code, the
portals, and the security posture.

- Move the three static portals (`rfq.html`, `approval.html`, `vendor-onboarding.html` + icons)
  onto the existing Netlify site (build-copy into the publish dir). Serve at
  `app.isheekaevents.com/rfq.html` etc. Free plan is ample.
- Update the link-base config (`VITE_RFQ_BASE_URL` + approval/onboarding link builders) to the
  new Netlify URLs; add redirects for any old GitHub Pages links already shared.
- Verify all three portals work on Netlify, THEN flip the GitHub repo to **private**.
- Minor security cleanup: Supabase dashboard toggles (leaked-password protection, MFA for
  owner/admin, confirm backups/PITR); `npm audit fix` (non-force only - `--force` breaks
  exceljs/Excel exports); optionally move `pg_net` out of public schema and tighten the
  `short_links` INSERT check.
- Add a Netlify build-ignore script in `netlify.toml` (`[build] ignore = "..."` returning
  exit 0 when only non-app files changed) so doc-only commits (`*.md`, notes) don't trigger
  a deploy build - saves build credits. Pairs with the push-bundling discipline below.

## Push / build-cost discipline

Every push to GitHub triggers a Netlify build (burns credits). To minimize cost:
- Doc-only changes (`*.md`) are committed locally and held; they ride along free with the
  next deploy-worthy code push.
- Code changes are bundled into fewer, logical pushes - not one push per tweak.
- After the Phase 0 build-ignore script lands, non-app commits can be pushed without a build.

Risk: Low. Only sequencing rule: verify portals on Netlify before going private.

## Phase 1 - Design-system foundation (the unlock)

Highest-leverage block; makes every later phase cheaper and kills most consistency drift.
No behavior change - pure systematization, migrated primitive-by-primitive with tests after each.

- Tokenize typography + spacing (color/radius/shadow tokens already exist in styles.css).
- Extract shared primitives: `Button`, `Field` (Input/Select/Textarea), `Modal`
  (focus-trap + ESC + body-scroll-lock + role=dialog), `Card`, `StatusBadge` (unify every
  status chip across leads/quotes/invoices/rfqs/events), `Icon` (DECIDED: Phosphor, regular
  weight, via `@phosphor-icons/react` - retiring the emoji icons), and consolidate the
  duplicated autocomplete dropdown (currently re-implemented 6+ times).
- Consolidate money/date formatting into single shared helpers.
- Build primitives mobile-aware so Phase 3 is cheap later.

Risk: Medium (touches many files) - mitigated by incremental, no-behavior-change migration.

## Phase 2 - Document-flow lifecycle rail (DECIDED with owner)

One shared lifecycle rail pinned to the TOP of every detail screen (under breadcrumb, above
content). Agreed 9-node model:

`Lead -> Client RFQ -> [Vendor RFQ -> Costing] -> Quote -> Event -> Invoice -> Receivable (AR) -> Payable (AP)`

- Vendor RFQ + Costing render as a RECESSED "sourcing" sub-segment between Client RFQ and Quote.
- "Client RFQ" = the real client-facing RFQ only (party_type='client', exclude is_sourcing_anchor);
  vendor RFQs are the sourcing sub-steps, not the client RFQ node.
- Node states: done (filled, clickable), in progress, not created / not reached, and "in-house /
  not used" for the sourcing sub-steps when a deal is priced in-house. Receivable/Payable: settled
  (green) / in progress (amber) / not triggered (grey).
- Multiples (several quotes/invoices) -> show the active one + "N more".
- Read-only: a `lib/docChain.js` resolver walks existing FK links (reuses the logic in the 3
  current "Source:" rows) + reads vendor RFQ status and costing_summaries + invoice AR + event_vendors AP.
- REPLACES the three hand-rolled "Source:" rows (Quotations/Invoices/Events) -> net less duplication;
  adds the rail to Lead + RFQ screens too. No writes, no money/logic touched.
- Build order: resolver + `DocFlow.jsx`, proof on the Event screen first, then roll to the other
  four and delete the old Source rows.

### Phase 2b - Entry-point enforcement (SEPARATE, audit-first - higher risk)
Goal: make every deal start at Lead -> Client RFQ (one canonical path), by disabling (a) creating a
quote directly from a lead (QuoteGenerationWizard direct path) and (b) the no-lead creation paths.
CAUTION: the no-lead path is a deliberate, TESTED feature (`convert-entrypoints.test.ts`), and the
sourcing-anchor hack exists because quotes can lack a client RFQ. Requires a thorough audit of every
quote/event/RFQ creation path + downstream assumptions + test updates BEFORE any code. Do AFTER the
rail (which will show how often each skip-path is actually used). Enforcing this could later let us
delete the sourcing-anchor mechanism.

#### Folded into 2b — RFQ-as-sourcing-workbench (was "Option 3", 2026-07-01)
UX for the canonical flow, deferred here on purpose. Today Approve -> creates an unpriced ₹0 draft
quote and navigates straight to it; sourcing is a somewhat hidden "Source vendors ->" button on the
quote. The idea is to make the **converted RFQ** the sourcing workbench: after Approve, land there
with a prominent guided path (Send vendor RFQ -> bids -> Costing & markup -> generate priced quote)
AND an equally prominent "Price in-house" choice, plus a clear "Draft quote Q-xxx created ->" link.
Structural constraint (verified): sourcing CANNOT precede the quote — `generateQuoteFromCosting`
writes prices into an existing draft quote, and the sourcing panel only renders once the RFQ is
`status='converted'`. So the sequence stays Approve -> draft quote -> source -> cost -> price; the
workbench only makes that sequence clearer, it does not reorder it.
Why here and not standalone: building it now would apply only to RFQ-origin deals (lead/event-origin
quotes still price on the quote screen) and sits behind `VITE_ENABLE_VENDOR_RFQ`, creating a
temporary split-UX + likely rework once 2b forces every deal through Lead->RFQ. Once 2b lands, the
workbench is the UNIVERSAL pricing model and worth building once, well.
Risks to bake in when built: keep the Quote as the canonical deal hub (avoid "two homes"); make
Price-in-house first-class on the RFQ (most simple deals aren't sourced); always surface the hidden
₹0 draft quote; honor the vendor-RFQ flag. Shipped as an interim clarity nudge (was "Option 1",
2026-07-01): pricing helper + primary "Source vendors" on unpriced draft quotes.

Risk: Low.

## Phase 2c - Sourcing revision loop (accept / lock / re-source on scope drift)

DESIGNED with owner (2026-06-30). Unifies two scenarios that are really one primitive:
(a) a vendor revises a bid after it was accepted (offline conversation), and (b) the quote
is edited after acceptance — items or sub-items added/changed/removed — which should flow
back into the vendor RFQs. Both need a per-line **lock state** (accepted/locked vs open) plus
a **re-source** action that reopens specific lines and bumps the vendor RFQ revision.

### The gap
Sourcing is anchored to the **client RFQ's `rfq_items`** (vendor RFQs hang off `parent_rfq_id`;
vendor lines carry `source_item_id` back to the client rfq_item; costing matches by
`source_item_id` + `costKey = sub_event_name||description`). At accept, `generateQuoteFromCosting`
rewrites the quote line items from the costing rows and snapshots everything into an append-only
`costing_summaries` row. But the quote-edit path (wizard revision) writes **only** to
`quotation_line_items` — never back to `rfq_items`. So the two item sets silently diverge: a new
quote item has no vendor RFQ/bid; a changed item breaks the source link. Nothing detects it.

### Detection (fingerprint, sub-item aware)
`costKey` is main-item-level and **blind to sub-items**, so a sub-item revamp under an unchanged
main would be missed. Detection must fingerprint each main line as a normalized hash of
`sub_event + description + quantity + sub_items` (names/qtys), diffed against the baseline =
the latest `costing_summaries.lines` snapshot (which already stores sub_items — no schema change
needed for the baseline). Classify each line: unchanged / new / rescoped (main OR sub-item change)
/ removed. Markup/client-price tweaks do NOT trigger re-source. Pricing stays main-item-level;
sub-items only affect whether a main line's bid is still valid.

### Two modes (few changes vs. major revamp)
- **Surgical delta** (a handful of changes): reopen only affected vendor RFQ lines, keep every
  other accepted bid locked. Regenerated vendor lines already carry updated `sub_items` (plumbing
  exists in `createVendorRfqs`/`rescopeVendorRfq`), so the vendor re-bids on the main with the new
  breakdown. Lock is keyed to the `(main + sub-item fingerprint)` tuple.
- **Full re-source round** (major revamp, above a drift threshold e.g. >50% of priced lines
  changed/new): stop offering a per-line delta; the new item set becomes the sourcing basis, all
  lines open, history preserved (append-only costing snapshots, vendor RFQ revision bumps,
  accumulating links). Functionally "source from scratch" with the audit trail intact.

### Hard prerequisite: stable item id
Quote line items carry **no durable link** back to the rfq_item today (the costing->quote insert
writes description/sub_items/sort_order only). Without a stable `source_item_id` on
`quotation_line_items`, a rename-heavy revamp is indistinguishable from "deleted all, added all",
so the classifier over-reports drift and can't tell surgical from full-round. Add this before the
guided re-source; it's what makes the major-vs-minor distinction reliable.

### Upstream / downstream impact
- Upstream: the wizard revision computes the diff on save and derives a `sourcing_stale` signal;
  baseline is the existing costing snapshot; `ensureSourcingAnchor` covers quotes without a real
  client RFQ.
- Downstream, pre-event: clean — quote-total change already auto-refreshes the draft invoice
  (`money.js`), and an issued invoice already locks quote edits, so re-sourcing is gated by the
  same lock.
- Downstream, post-event: messy — `event_vendors` may be assigned/partially paid, so rescoping
  changes booked costs and needs AP reconciliation. v1 rule: allow scope re-sourcing only while
  the quote is pre-event (draft/sent); once an event exists, route through a separate cost-change
  path.
- Rail: the DocFlow Costing/Vendor-RFQ nodes gain an amber "out of date / re-source" state
  (resolver compares quote `updated_at` vs latest costing `generated_at`).

### Phasing
1. **Detect + warn** (low risk, read-only): diff quote vs latest costing snapshot (sub-item-aware
   fingerprint), show a non-blocking "Sourcing out of date — N changed (new/rescoped/removed)"
   banner + amber rail node, gated to pre-event quotes. Kills silent divergence and *measures* how
   often it happens before building the machinery.
2. **Stable `source_item_id`** on `quotation_line_items` (small data-flow fix; unblocks accurate
   change detection and the revamp case).
3. **Guided re-source**, unified with accept/lock/revise: delta -> `rfq_items` ->
   `rescopeVendorRfq`/`createVendorRfqs`, locked bids preserved; surgical vs. full-round by drift
   ratio; every round writes a fresh costing snapshot.
4. **Post-event cost-change path** with AP reconciliation — deferred, rare, highest risk.

Design decision (owner): quote scope edits stay **free with drift-detection** (preserves the
in-house fast path) rather than funneling every scope-changing edit through the costing screen.

Risk: v1 Low (read-only), v3 Medium (writes to sourcing), v4 High (touches booked AP).

### Phase 2c — shipped so far (2026-07-01)
- v1 detect+warn: quote drift banner + amber "Re-source" rail node. Baseline is the **client
  RFQ items** (not the costing snapshot — snapshots predating v2 lack sub_items and missed
  sub-item edits). Revision-lineage aware.
- v2: stable `source_item_id` on `quotation_line_items` (rename-safe matching).
- v3a guided re-source: `Re-source →` on the quote syncs the client RFQ items to the quote
  (insert/update/soft-delete, keeping matched rfq_item_ids so bids stay linked), logs to
  `rfq_activity`, opens the sourcing screen. Quote/invoice out-of-date sync banners.
- Vendor-side staleness: sourcing screen flags vendors whose frozen items no longer match the
  re-sourced client items (badge + banner); rail Costing node reflects it.
- "Sourcing & pricing history" timeline on quote + event.

### Phase 2c — known refinements (from live testing, DO LATER)
These are the rough edges left by the incremental v3a approach; all resolve cleanly under the
accept/lock/revise sourcing-decision lifecycle:
- **Surgical per-line re-bid.** Today "Edit items" (`rescopeVendorRfq`) re-issues the WHOLE
  vendor RFQ — it wipes the item list, clears the vendor's bid, and they re-price everything.
  You cannot re-open just the one changed line while keeping the other bids locked (and
  un-checking unchanged items *removes* them from scope, not preserves them). Needs a per-line
  bid/lock state so only drifted lines reopen.
- **Post-rescope "sourcing settled" state.** Right after a re-send the vendor items match the
  client items again, so the rail node can read "Priced" while the vendor's re-bid is still
  pending and the costing snapshot references the now-cleared bid. The node should stay in a
  "re-pricing in progress" state until all chosen vendors have re-submitted AND costing has been
  regenerated. Requires comparing costing snapshot's chosen vendors vs current vendor statuses.
- **Edit-items modal** shows only the sub-item COUNT ("· 1 detail"), not the names. Sub-items
  do flow to the vendor on save (verified); consider expanding them read-only for clarity.
- **Surgical AP awareness.** Post-event re-source (v4) still deferred — highest risk.

## Phase 3 - Responsive / mobile (deferred until mobile use is real)

Not urgent today (primarily desktop use), but planned. Sidebar -> collapsible drawer,
responsive grids, tables reflowing to stacked cards on small screens, real breakpoints.
Built cheaply on top of the Phase 1 primitives. Priority rises when staff/clients start using
it on phones.

Risk: Medium.

## Phase 4 - Interaction polish + accessibility

The "feels premium + is accessible" layer:
- Replace `window.confirm()` with a themed confirm dialog; add undo where safe.
- Skeleton loaders (replace bare spinners), visible focus rings, aria labels, swap
  `div onClick` for real buttons, fix low-contrast helper text (grey-400 fails AA).

Risk: Low.

## Phase 5 - Data-scale UX (on demand as volume grows)

Pagination/virtualization for long lists, sortable column headers, server-side filtering.
Lists currently load and filter entirely in memory. Fine now; revisit as leads/invoices/events
accumulate.

Risk: Low-Medium.

---

## Deferred cleanup (Phase 0 cutover - DO LATER)

The portals were COPIED (not moved) into `isheeka-vite/public/`; the repo-root copies are a
temporary GitHub Pages backup so already-shared `github.io` links keep resolving during cutover.
Once the Netlify portals are verified end-to-end and old links have lapsed (tokens expire in 21 days):
- Delete the root portal copies: `rfq.html`, `approval.html`, `vendor-onboarding.html`.
- Update/remove the stale `netlify.toml` comment that says portals "stay on GitHub Pages".
- Disable GitHub Pages, then flip the repo to **private**.
- Housekeeping: remove the `dist_old/` and `dist_old2/` local EPERM-workaround dirs if unused.

### Pro-plan upgrade items (Free tier cannot enable these)
- Leaked-password protection (HaveIBeenPwned) - Auth > Providers > Email; Pro-only.
- Point-in-time recovery (PITR) backups - worth it for client + financial data; Pro-only.
- MFA (TOTP): the capability can be enabled in the dashboard, but using it needs a small
  in-app enrolment screen (separate build).
- Free-tier hardening already applied instead: minimum password length raised to 8, password
  complexity requirements enabled, require-current-password-on-change.

### Dependency vulnerabilities (deferred - do NOT `--force`)
- `npm audit` shows 11 (esbuild/vite/vitest chain + uuid-via-exceljs). All remaining fixes need
  `npm audit fix --force`, which is unsafe here: it downgrades exceljs (breaks Excel exports) and
  forces a Vite 8 major upgrade. The esbuild advisory is dev-server-only (no production impact);
  uuid is a narrow transitive edge case. Clear these later as a deliberate Vite-8 upgrade slice
  with full testing - not via `--force`.

## Open decisions / levers
- Mobile (Phase 3) timing: deferred per current desktop-first usage; revisit when mobile use grows.
- Phase 1 migration style: one-time foundation refactor (recommended) vs. user-visible slices.
- Future: selling to clients = multi-tenant SaaS (tenant isolation via RLS, tenant-aware auth,
  billing) - a separate, larger initiative built on the now-complete RLS foundation.
