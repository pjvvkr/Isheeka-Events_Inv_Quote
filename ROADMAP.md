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

Risk: Low.

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
