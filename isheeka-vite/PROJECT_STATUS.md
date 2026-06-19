# Isheeka ERP — Vite port: state of things

_Last updated: 2026-06-18_

## Where we are

The Vite port (`isheeka-vite/`) of the Isheeka ERP is **LIVE in production on Netlify**
at **https://isheeka-events-erp.netlify.app** (auto-deploys on every push to `main`).
Login, quote-share short links, RFQ links, and password reset all validated against prod.

The legacy `isheeka-erp-v22.html` + the public `rfq.html` portal stay on GitHub Pages
(unchanged), so existing client RFQ links keep working. Everything is committed and
pushed to `origin/main` (`github.com/pjvvkr/Isheeka-Events_Inv_Quote`).

## What's done

### Module port
Leads, Quotations, Events (+ EventDetail, NewEventWizard), the Quote wizard, and the
shared item-entry components are ported into `isheeka-vite/src`. Build verified with
`tsc --noEmit` + `vite build`.

### Fix list (all applied)
- **#1** Short-link service — see below.
- **#2** Convert-lead "Linked to existing client" now shows the real client name.
- **#3** "Done — go to event" blank-screen crash (editEngage TDZ) fixed.
- **#4** Revision-aware quote status labels ("Rev 4 · Sent") — display-only.
- **#5** Duplicate `color` key in the Leads pipeline hint removed.
- **#6** Dead `rfq_revisions` query (404) removed.

### Test suite (all green)
- `npm run test` — 13 Vitest logic tests (the money matrix: quote→invoice, quote→event,
  payment reconcile/overpay, invoice variations, convert entrypoints, vendor money,
  rfq→quote). Run against the **local** throwaway Supabase.
- `npm run test:e2e` — Playwright smoke (every page renders) + lead happy-path
  (create → list → detail → mark contacted).
- `e2e/global-setup.ts` auto-creates the local login before tests, so a `supabase db
  reset` never breaks them. Needs `$env:E2E_EMAIL` / `$env:E2E_PASSWORD` set in the shell.
- No secrets in the repo (local anon key only; email confirmations disabled locally via
  `supabase/config.toml [auth.email] enable_confirmations = false`).

### Short-link service (#1) — DEPLOYED TO PROD
- `supabase/migrations/20260617000000_short_links.sql` — `short_links` table (table also
  created in prod via the Dashboard SQL editor).
- `supabase/functions/s/index.ts` — public `s` edge function: resolves a code → fresh
  signed URL → 302 redirect. Deployed to prod project `jlcssesetnxulnkbrmyp`.
- `src/lib/share.js` — `makeShortLink()` wired into both PDF uploaders, with a
  signed-URL fallback if the infra is missing.
- Short links look like `https://jlcssesetnxulnkbrmyp.supabase.co/functions/v1/s/<code>`.

## Local dev quickstart (tomorrow)

```powershell
cd C:\Users\vamsh\GitHub\isheeka-vite
# 1. Supabase local stack (Docker must be running)
supabase start                 # or: supabase stop; supabase start  (after config changes)
# 2. App
npm run dev                    # http://localhost:5173
# 3. Tests
$env:E2E_EMAIL="vamshi.555@gmail.com"; $env:E2E_PASSWORD="<local password>"
npm run test                   # logic tests
npm run test:e2e               # smoke + lead happy-path
```

Studio: http://127.0.0.1:54323 · Local API: http://127.0.0.1:54321

## Deployment — DONE (2026-06-18)

- Hosted on **Netlify** (`isheeka-events-erp.netlify.app`), auto-deploy from `main`.
- `netlify.toml` (base `isheeka-vite`, `npm run build`, publish `dist`, Node 20).
- Supabase Auth: Site URL + Redirect URLs include the Netlify origin.
- `VITE_RFQ_BASE_URL` points client RFQ links at the Pages `rfq.html`.
- GitHub Pages left ON for `rfq.html` + legacy app.

## Milestone S — Vendor RFQ + costing ✅ DONE (live in prod, 2026-06-18)

Spec: `docs/milestone-s-vendor-rfq-spec.md`. Built end-to-end, automated-tested, and
**activated in production** (feature flag `VITE_ENABLE_VENDOR_RFQ=true`).

- **S1 ✅ (local):** migration `20260618000000_milestone_s_vendor_rfq.sql` (vendor fields on
  `rfqs`/`rfq_items`, `settings.default_markup_pct`, `costing_summaries`) + `rfq-gateway`
  vendor mode. Applied locally via `supabase migration up`. **NOT yet deployed to prod.**
- **S2a/S2b ✅ (local):** `src/lib/vendorRfq.js` + the **Sourcing panel** in `RFQsModule`
  (send vendor RFQs, status list, manual reminders, View bid, Open-costing placeholder).
  Behind flag `VITE_ENABLE_VENDOR_RFQ` — set `=true` in `.env` (local only; gitignored), so
  the prod build (no flag) renders nothing.
- **S2c ✅ (local + pushed):** vendor cost-entry portal — `rfq.html` vendor mode (unit cost /
  can't-supply / per-item note / overall note / save / submit). Dormant for clients (renders
  only when `get_rfq` returns `party_type='vendor'`); `rfq.html` auto-detects localhost to hit
  the local gateway. Lives on GitHub Pages.
- **S3 ✅ (local):** costing & markup screen — `src/modules/CostingScreen.jsx` + `src/lib/costing.js`.
  Bid comparison grid (click to choose, cheapest auto-picked, can't-supply `✕`, vendor-note `📝`),
  per-item in-house toggle + cost, markup (default + override), live totals, internal notes,
  hard/soft validations, **Generate quote** (prices the existing draft quote) + **Save costing
  summary** (`costing_summaries` audit row). Reached from the Sourcing panel; flag-gated.

**Tests (all green):** `tests/flows/vendor-rfq-loop.test.ts` (logic: create vendor RFQ → bid →
costing → priced quote → costing summary) + `e2e/vendor-rfq-flow.spec.ts` (UI: sourcing panel,
costing math, hard-block validation, in-house resolve, generate quote, send modal). The UI test
caught a real bug — `costingRfqId` was missing from the Shell `navigate()` allow-list (the costing
screen silently showed the RFQ list); now fixed.

**Prod activation DONE (2026-06-18):** migration applied via Dashboard SQL · `rfq-gateway` deployed
(`supabase functions deploy rfq-gateway --no-verify-jwt`) · `VITE_ENABLE_VENDOR_RFQ=true` in
`.env.production` · pushed (Netlify rebuilt with the feature ON).

**Not covered by automated tests:** the vendor PORTAL (`rfq.html`) HTTP path needs the gateway's
`SESSION_SECRET` + static serving — validated by the logic test's data path + a manual prod check.

**Still deferred (post-baseline):** scheduled auto-reminders to vendors; read-only sourcing history
on the Vendor profile; per-item split across vendors at quote time; role-aware access to costs/margin.

## Manual-test fixes (2026-06-18, batch 2)

- **Event items bug** — `convertLeadToEvent` (money.js) created sub-event *headers* from the
  quote's line items but never copied the line items into `sub_event_items`, so events from
  the RFQ→costing→auto-quote path showed empty sub-events (₹0). Now copies the items,
  mapping `sub_event_name` → the new `sub_event_id`. (Existing events need a one-time backfill;
  new conversions are fixed.)
- **Revision visibility** (client/vendor can revise until approved — capability already existed):
  - **#1** "🔄 Rev N" badge on the RFQ list rows + detail header (driven by `revision_number`);
    the list's awaiting-review line now also flags how many are revisions.
  - **#2** Count badge on the **Client RFQ** sidebar item (refreshes on nav) + the dashboard
    "awaiting review" tile aligned to `party_type='client'` only.
  - **#3** Restored the **Revision history + diff** panel on the RFQ detail (view any snapshot,
    compare two versions). New migration `20260618120000_rfq_revisions.sql` recreates the
    `rfq_revisions` table locally (already present in prod from the M3 batch) so dev matches prod.
- **Email notification on revision** — deferred (phase 2), per decision.

## Manual-test fixes (2026-06-18, batch 3) — event screen

- **Record payment from the event** — added a "＋ Record payment →" button on the event's
  Payment summary that jumps to the active invoice's record flow (one source of truth; client
  payments still live on the invoice/installments). Disabled with a hint if no invoice exists yet.
- **Items vs quote total reconciliation** — under "Total items value" the event now shows the
  quote-level **Adjustment** (signed `discount_amount`) and the **Quote total**, so the items
  sum ties out to what's billed (e.g. ₹2,32,700 + ₹2,300 = ₹2,35,000).
- **Vendor populate from costing** (suggest-and-confirm) — `loadCostingVendorSuggestion()`
  reads the saved costing summary for the event's quote, groups the chosen (non-in-house)
  vendors and sums each one's winning cost. The Vendors & payments section shows a banner to
  add them as editable engagements (`agreed_amount` = winning cost, service = "Sourced via
  vendor RFQ"). Only suggests vendors not already on the event; manual ＋ Add vendor unchanged.

## Status cascade + screen gating (2026-06-18, batch 4)

When an event ends, the RFQ chain and the screens that key off it now behave correctly:

- **Cascade** (`closeEventRfqs` in EventsModule): **cancel** → source client RFQ + its vendor RFQs
  → `withdrawn` (with `rfq_activity` notes), mirroring how cancel already rejects the quote;
  **complete** → open vendor RFQs → `withdrawn` (client RFQ stays `converted` = fulfilled).
- **`dealClosed`** (linked event completed/cancelled) is now derived on the RFQ detail and in the
  costing loader (rfq → quote → event.status):
  - RFQ detail Sourcing panel: hides **Send vendor RFQ**, relabels **Open costing → View costing
    (read-only)**, shows a lock note, and hides **Regenerate link** when closed/terminal.
  - **Costing screen**: full **view-only** mode — vendor pick / in-house / markup / notes disabled,
    Generate-quote + Save-summary hidden, banner shown.
  - Quote **Source vendors →** hidden when its event is completed/cancelled.
  - Lead **Send RFQ** hidden when the lead is completed (was: only lost).
  - Event costing-vendor suggestion banner hidden on a closed event.
- Quotes/invoices/events already gated correctly on their own statuses (audited): quote `editable`/
  `histClosed`, invoice `locked`/`canRecordPay`, event Edit→Reopen — left as-is.

## Attachment → items extraction · Phase 1 (client) — built 2026-06-18

Lets a client attach a photo/PDF of their list instead of keying items by hand.

- **Gateway:** new session-gated `extract_items` action in `rfq-gateway` — takes a base64
  image/PDF, calls **Claude Haiku 4.5 vision** (`claude-haiku-4-5-20251001`), returns a clean
  `[{description, quantity, sub_event}]` JSON for REVIEW (never auto-submits). Guards: session
  required, type allow-list (jpg/png/webp/pdf), ~6 MB cap. Needs secret **ANTHROPIC_API_KEY**.
- **Client portal (`rfq.html`):** "📎 Attach a list / 📷 Take a photo / 📋 Paste a message" on the
  requirements step. `extract_items` also accepts pasted **text** (WhatsApp message / typed list) —
  text-only call, even cheaper. A WhatsApp *screenshot* already works via the photo path. Images are
  downscaled to 1280px JPEG client-side. Extracted items merge into the form (mapping/creating
  sub-events), then the client edits + submits as normal.
- **Vendor portal (`rfq.html`):** same 📎/📷/📋 controls on the cost form. New gateway action
  **`extract_costs`** sends the vendor's photo/PDF/text **plus the fixed item list** to Haiku and
  gets back per-item `{rfq_item_id, unit_cost, can_supply}` — it *matches prices to existing items*
  (doesn't create items), pre-fills the cost fields for review, leaves unmatched items blank.
- **Cost:** ~½¢ per upload on Haiku (text-only paste is cheaper still).

### Phase 2 polish (built same pass)
- **Multi-image:** both actions accept `files[]` (up to 6) — combined into one Claude call; the
  "Attach" picker is `multiple` (handwritten lists / price sheets that span pages).
- **Vendor match confidence:** `extract_costs` returns `confidence: high|low` per item. Low-confidence
  matches render a red **"⚡ imported · check carefully"** badge + pink-tinted field; high-confidence
  get the amber **"⚡ imported · review"**. Badge clears once the vendor edits/leaves the field.
- **Client symmetry:** imported client items get a small **⚡ imported** tag so they stand out from
  manually-added ones.
- **To go live:** set `ANTHROPIC_API_KEY` secret + `supabase functions deploy rfq-gateway
  --no-verify-jwt` + push `rfq.html` (Pages). Until the key+deploy land, the button degrades
  gracefully ("photo reading isn't enabled yet — add items manually").

## Extraction · Batch A polish (built 2026-06-18)

- **Preview-before-merge** (both portals): extraction now stages results in a review card
  (`pendingItems` / `pendingCosts`) with per-row ✕ and Add/Cancel — nothing merges until confirmed.
- **Undo import**: client "↩ Undo import (remove N imported)"; vendor "↩ Clear imported prices".
- **Prompt tuning**: extract prompts now handle Telugu/Hindi/Hinglish + handwriting and parse
  counts like "2 tubs" / "200 chairs" / "8x12 backdrop" (number vs spec).
- **Matched source line** (vendor): `extract_costs` returns `source` (the vendor's own line); shown
  as "matched from: …" on each imported row + in the preview.

Deploy: `git push` (rfq.html → Pages) + `supabase functions deploy rfq-gateway --no-verify-jwt`
(prompt + source changes). No app/Netlify change, no migration, key already set.

Phase-2 extras roadmap (remaining): **B** staff-side import · **C** catalog auto-map + needs-review
flag + manual re-map · **D** governance (rate-limit, store upload, usage log) · **E** voice-note,
email import, multi-vendor split.

## PWA — installable Android app (built 2026-06-18)

The ERP is now an installable PWA (step 1 of the Android packaging path; works for TWA/Capacitor later).
- `vite-plugin-pwa@^0.20.5` (devDep) — `registerType: autoUpdate`, Workbox SW precaches the app shell.
- Manifest: name "Isheeka Events ERP", short_name "Isheeka", `display: standalone`, maroon
  theme/background `#A0123A`, start_url/scope `/`, icons 192/512 + 512 maskable.
- Icons in `public/icons/` (maroon flower mark). `index.html` theme-color → maroon + apple-mobile meta.
- `base` left as `./` (asset loading unchanged); manifest uses absolute `/` paths (Netlify root).
- **To ship:** `npm install` (new dep) → `npm run build` → tests → push. Netlify build covers it
  (vite.config/package.json/index.html/public are in the build-trigger watch list).
- **Verify on Android:** open the Netlify URL in Chrome → ⋮ → "Install app" → confirms the maroon
  flower icon + fullscreen standalone launch.

## Test-data purge + reusable lead-archive (built 2026-06-18)

Soft-delete approach (reversible). Keeps real leads **L-26-1129 + L-26-1139** and their full chains.
- `supabase/migrations/20260619000000_payment_soft_delete_flags.sql` — adds `is_deleted` to
  `vendor_payments` + `invoice_payments` (were the only view-queried tables without it).
- `supabase/migrations/20260619000100_archive_lead_chain.sql` — `archive_lead_chain(lead_ref)` /
  `unarchive_lead_chain(lead_ref)` plpgsql: cascade soft-delete/restore a lead's whole graph
  (RFQs incl. vendor, quotes, events, invoices, costing, expenses, line items, installments,
  payments). Shared-client guard; vendor MASTER never touched. Returns jsonb counts.
- `scripts/purge_test_data_keep_leads.sql` — one-time: PART 0 safety check, PART 1 preview (rolls
  back), PART 2 transactional purge keeping the two real leads.
- App: `is_deleted` filters added to Reports + Vendor-Payments queries; **"🗄 Archive + data"**
  admin button on the Lead detail (confirm + reversible) calling `archive_lead_chain`.

**Deploy order (matters!):** backup prod → apply BOTH migrations to prod (columns must exist before
the app filters / purge run) → deploy app → run purge script (PART 0→1→2) → verify → 2nd backup.

## Open / next up

- **Custom domain** — e.g. `app.isheekaevents.com` (free on Netlify; needs a DNS record +
  add to Supabase Redirect URLs).
- **Pending functionality** — see the prioritized list maintained with the user (feature
  gaps / module work beyond the now-complete fix list #1–#6).
- **More UI happy-paths** — quote wizard, event creation/cancellation, RFQ → quote.
- **Smoke flake** — `smoke.spec.ts` failed once at the page-walk loop then passed; if it
  recurs, harden that wait.
- **Staging environment** — a separate Supabase project between local and prod.
