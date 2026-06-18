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

## Open / next up

- **Custom domain** — e.g. `app.isheekaevents.com` (free on Netlify; needs a DNS record +
  add to Supabase Redirect URLs).
- **Pending functionality** — see the prioritized list maintained with the user (feature
  gaps / module work beyond the now-complete fix list #1–#6).
- **More UI happy-paths** — quote wizard, event creation/cancellation, RFQ → quote.
- **Smoke flake** — `smoke.spec.ts` failed once at the page-walk loop then passed; if it
  recurs, harden that wait.
- **Staging environment** — a separate Supabase project between local and prod.
