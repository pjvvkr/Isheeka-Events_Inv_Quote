# Isheeka ERP — Graduation to a Vite build

Behaviour-preserving port of `isheeka-erp-v22.html` (single-file, in-browser Babel)
into a proper Vite + React + TypeScript-ready project. **Same app, same Supabase,
same features** — just packaged for speed, modularity, tests, and safe iteration.

## Status
- ✅ Scaffold: Vite + React + TS-ready (`allowJs`), CI deploy workflow, supabase client. Builds clean.
- ⏳ Port: app being moved here module-by-module from the single file.
- ⛔ Switch-over: only after the new build matches the live app screen-for-screen and you've verified it.

## Port ledger (what's moved so far)
Each checkpoint ends green: `npm run typecheck` clean **and** `vite build` succeeds.

| # | Checkpoint | Files | Verified |
|---|---|---|---|
| P1 | **Foundation — constants, pure formatters, global CSS** | `src/lib/constants.js` (all status/color/label maps, NAV, budget ranges, vendor/expense cats), `src/lib/format.js` (fmtDate, eventTypeLabel + label registry, status predicates, eventFunnel, urgency, budget match), `src/styles.css` (the whole `<style>` block), fonts in `index.html` | tsc clean + vite build ✅ |
| P2 | **Toast/runDb + reference-data loaders** | `src/lib/toast.jsx` (`notify`, `runDb`, `ToastHost`), `src/lib/data.js` (`fetchLeadSources`, `fetchEventTypes` → `registerEventTypeLabels`, `useEventTypes` hook) | tsc clean + vite build ✅ |
| P3a | **Session/activity + ref counters + RFQ helpers** | `src/lib/session.js` (`_currentUid`, `logQuoteSend`, `logInvoiceActivity`), `src/lib/refs.js` (`getNext{Quot,Lead,Client,Event,Invoice,Rfq}Ref`), `src/lib/rfq.js` (`sha256Hex`, `genRfqToken`, `genRfqPin`, `rfqLink`, `createRfq`, `findClientMatch`, `ensureClientForRfq`, `approveRfqToQuote`). Temp `src/lib/_portcheck.ts` forces the bundler to include not-yet-rendered modules. | tsc clean + vite build ✅ |
| P3b | **Money helpers** (highest-risk, byte-for-byte) | `src/lib/money.js`: `closeQuoteNotProceeding`, vendor `_ensureVendorInstallment`/`addEventVendor`/`recordVendorPayment`/`recordVendorRefund`, `reconcileInvoiceInstallments`, `recordClientRefund`, `createEventFromQuote`, `createInvoiceFromQuote`. **This completes the entire business-logic (non-component) layer.** | tsc clean + vite build ✅ |
| P4 | **Share + PDF engine** | `src/pdf/assets.js` (base64 LOGO + Great Vibes font, shell-extracted), `src/pdf/quotationPdf.js` (`buildQuotationPDF` — only change is `window.jspdf` → npm `jsPDF` + side-effect `jspdf-autotable`), `src/lib/share.js` (`waNormalize`, `waLink`, `openWhatsApp`, `openEmail`, `validClientPhone`, `uploadQuotePdf`, `uploadInvoicePdf`, `buildQuoteShareMsg`, `buildInvoiceShareMsg`). Added `jspdf`/`jspdf-autotable` deps. **This completes ALL non-component logic.** | tsc clean + vite build ✅ |
| P5a | **App shell (boots + renders)** | `src/Shell.jsx` (auth gate, session-timeout, nav stack/router, sidebar), `src/components/{LoginScreen,SessionWarning,NavBar,ComingSoon}.jsx`, `src/modules/Dashboard.jsx` (live data). `App.tsx` now mounts `<Shell/>`. Every non-dashboard page renders `<ComingSoon/>` until its module is ported. **The Vite app now logs in + navigates for real.** | tsc clean + vite build ✅ |
| P5b | **Shared form components** | `src/components/fields.jsx` (`InputField`, `SelectField`, `AutocompleteInput` + `fetchSuggestions` + cache), `src/components/links.jsx` (`ClientLink`, `VendorLink`). Reused by most modules' forms. | tsc clean + vite build ✅ |
| P5c | **Expenses module** (first real feature module) | `src/modules/ExpensesModule.jsx` — list, filters, KPI cards, create/edit modal, receipt upload, soft-delete. Wired into `Shell.jsx` (replaces the `expenses` stub). | tsc clean + vite build ✅ |
| P5d | **Vendor Payments module** | `src/modules/VendorPaymentsModule.jsx` (payments ledger, dues-by-vendor rollup with **Excel export**, voided-payment audit, record-payment modal) + `src/components/EventQuickView.jsx`. Resolved the **xlsx decision**: pinned `xlsx@0.18.5` (npm-published SheetJS; stable `json_to_sheet`/`writeFile` API). Wired into `Shell.jsx`. | tsc clean + vite build ✅ |
| P5e | **Vendors module** | `src/modules/VendorsModule.jsx` — list + KPI cards + filters, detail page (contact / tax-payment / engagements rollup), create/edit form with phone+name dup-check, status toggle, archive-with-guard. Wired into `Shell.jsx`. | tsc clean + vite build ✅ |
| P5f | **Reports module** | `src/modules/ReportsModule.jsx` — KPI cards, last-12-month bar/group charts, pipeline-by-stage, per-event P&L table, **Excel + PDF exports** (PDF now via npm `jsPDF` + autotable, not `window.jspdf`). Wired into `Shell.jsx`. | tsc clean + vite build ✅ |
| P5g | **RFQ module (staff side)** | `src/modules/RFQsModule.jsx` — list + status filter, New-RFQ form (with open-RFQ warning), share card (link/PIN + WhatsApp), and `RFQDetail` (approve→draft-quote with client-dedupe modal, request-changes, stale-quote-pointer self-heal, revisions list/view/compare, grouped activity timeline). Wired into `Shell.jsx`. | tsc clean + vite build ✅ |
| P5h | **Clients module** | `src/modules/ClientsModule.jsx` — list + KPI cards + filters; `ClientForm` (validation + autocomplete city/state); `ClientDetail` with the **Client 360** (lifetime KPIs, per-event cards with RFQ→Quote→Invoice→Payments→Vendors chain, open opportunities), alternative contacts CRUD, status toggle, archive-with-guard; and `MassClientUpload` (Excel template + validate + import). Wired into `Shell.jsx`. | tsc clean + vite build ✅ |
| P5i | **Invoices module** | `src/modules/InvoicesModule.jsx` — list + KPI cards, and the full `InvoiceDetail`: GST toggle, revise (items + discount/total-override), record payment (spill-over allocation + self-heal), client refund (reopen installments), **discount/write-off**, WhatsApp/email share, PDF preview/print/download, source RFQ→Lead→Quote→Event chain, client-edit-with-cascade, activity log. `ClientForm` is now `export`ed from `ClientsModule` and reused for the edit-client modal. Wired into `Shell.jsx`. | tsc clean + vite build ✅ |
| P5j | **Settings module** | `src/modules/SettingsModule.jsx` — Company / Bank / Documents / Terms forms (validation + save), the **Templates** tab + `TemplateEditor` (sub-events, items, Excel bulk-paste), **Lead Sources** + **Event Types** admin (reorder/activate, per-type Functions via `SubEventEditor`). Added `clearLeadSourcesCache`/`clearEventTypesCache` to `data.js`. Wired into `Shell.jsx`. | tsc clean + vite build ✅ |
| P5k | **Quote wizard + shared item-entry** | `src/components/ItemEntry.jsx` (shared `FastEntryTable` + its `FastItemDesc`/`FastItemQty`/`FastItemPrice` + `sanitizeNum`/`MAX_QTY`/`MAX_PRICE`; plus `SubEventItemsTable`, `ItemDescInput`, `ItemNumInput`, `SubEventTplBtn` for the Events editors) and `src/components/QuoteWizard.jsx` (`QuoteGenerationWizard` + `QWSubEventNameInput`/`QWTemplateSelect`). 4-step modal (client → line items → quote details → share); handles new / revision / continuation / event-origin, payment-schedule auto-fill + %-calc, manual-total override, draft-invoice auto-sync on revision, and WhatsApp/email/PDF share. Verbatim port; only globals → imports (`supabase`, `notify`/`runDb`, `defaultEventName`/`eventTypeLabel`, ref counters, share/session/pdf/money helpers, `XLSX`). Added to `_portcheck.ts` (no UI renders it until Leads/Quotations/Events land). | tsc clean + vite build ✅ |
| P5l | **Leads module** | `src/modules/LeadsModule.jsx` — list (metrics, search + stage/type/source/follow-up filters), `LeadDetail` (stage actions, RFQ link, quotations panel with revisions, convert→event link, loss flow with active-quote rejection, edit-with-client/quote cascade), `LeadForm` (new / edit / from-reference, lock-event-fields when quoted), and the Loss / Lost-lead-edit / Reference modals. `WelcomeMessageModal` exported for QuotationDetail reuse. Renders `QuoteGenerationWizard` for generate/continue/revise. Wired into `Shell.jsx` (`leads` branch). | tsc clean + vite build ✅ |
| P5m | **Quotations module** | `src/modules/QuotationsModule.jsx` — list + KPI cards + status filter, and `QuotationDetail`: share/export (WhatsApp/Gmail/Email + hosted PDF, display-option toggles, revision-history toggle), confirm→event/invoice across event/lead/client origins (`ConvertLeadModal` + `WelcomeMessageModal`), revise/continue via `QuoteGenerationWizard` (reconstructs lead-vs-event origin), close-as-not-proceeding (`REJECT_REASONS`), source RFQ→Lead→Quote→Event chain, and activity log. Reuses `WelcomeMessageModal` from `LeadsModule`. Wired into `Shell.jsx` (`quotations` branch). | tsc clean + vite build ✅ |
| P5n | **Events module + EventDetail + NewEventWizard** | `src/modules/EventsModule.jsx` — list (metrics, status/type/staff/budget filters, live funnel badges from batched aggregates, from-reference picker), `EventDetail` (~1050 lines: view/edit, sub-events & items, checklist, Lead→Quote→Event→Invoice workflow chain, payment summary, vendors & installments with pay/refund/edit/void-remove + reopen rebuild, cancel-event reconciliation wizard, change-client, event-originated `QuoteGenerationWizard`), `NewEventWizard` (4-step: details → client+contacts → sub-events/items with templates + Excel import → review), plus `ChangeClientModal`, `EventFunnelBadge`, `NewTaskInput`, and the `SubEvent*`/`Evt*` stable inputs. Reuses `FastEntryTable`/`SubEventTplBtn` (ItemEntry), `ClientForm` (ClientsModule), `QuoteGenerationWizard`. Wired into `Shell.jsx` (`events` branch). | tsc clean + vite build ✅ |

Notes / decisions deferred:
- **xlsx**: the live app uses SheetJS **0.20.1 from the SheetJS CDN**; the public npm registry only publishes ≤0.18.5. Decide at the export-port checkpoint whether to pin `xlsx@0.18.5` (npm) or install the 0.20.x tgz from `cdn.sheetjs.com`. Not needed until the Reports/export code is ported.
- **jspdf / jspdf-autotable**: added only when the PDF engine (`buildQuotationPDF`) is ported.
- Two latent scaffold bugs fixed while verifying: `tsconfig.node.json` had `composite`+`noEmit` (illegal for a referenced project); missing `src/vite-env.d.ts` (`import.meta.env` typing).

### Next checkpoints (planned order)
- **Done so far (P5a→P5n):** shell + Dashboard, Expenses, Vendor Payments, Vendors, Reports, RFQ, Clients, Invoices, Settings, Quote wizard + shared item-entry, Leads, Quotations, Events. **Every module is now ported and wired into `Shell.jsx`** — the new build renders every page for real.
- **Remaining:** none in the module port. Follow-ups: trim/delete `src/lib/_portcheck.ts` (now that every module is wired, nothing relies on it for bundling — still imported by `App.tsx`); then the screen-for-screen verification pass against the live app, and switch-over.
- Switch over only after the new build matches the live app screen-for-screen.

To wire a newly-ported module into the shell: add `import { XModule } from './modules/XModule.jsx'` to `Shell.jsx` and replace the relevant `ComingSoon` branch with `<XModule .../>`. As real modules consume lib exports, trim `src/lib/_portcheck.ts` accordingly; delete it once nothing relies on it.

Open follow-ups (not blockers):
- **xlsx**: ✅ resolved at P5d — pinned `xlsx@0.18.5` (npm). Used by Vendor Payments dues export; Reports exports + bulk client upload + template paste will reuse the same dep.
- **Bundle size**: jsPDF makes the main chunk ~758 KB. Optional later optimization: `import()`-split the PDF engine so it loads on demand. Advisory only; the live app loads the same lib via CDN today.
- P4 — share/email/whatsapp + `buildQuotationPDF` (+ embedded fonts) as `src/pdf/`.
- P5+ — shared UI components, then modules (dashboard → clients → leads → rfq → quotes → invoices → events → vendors → reports → settings), then `App` shell + nav stack. Switch over last.

## Ground rules during the port
- The **live single-file app keeps running** and is your tool for testing the whole time.
- **Bug fixes** still go into the live app immediately; the same fix is carried here.
- **New features are frozen** on the live app until switch-over (so we don't port a moving target).

## Architecture (target)
```
src/
  lib/        supabase client, helpers (fmt, status maps, ref counters), runDb
  components/ shared UI (NavBar, fields, modal, links)
  modules/    dashboard, clients, leads, rfq, quotes, invoices, events, vendors, settings, reports
  pdf/        jsPDF quote/invoice engine
  App.tsx     shell + nav stack/router
```
TypeScript is adopted **incrementally** (allowJs): port files as `.jsx` first (working),
convert to `.tsx` + add types module-by-module, money paths first. Supabase DB types
generated from the schema later for end-to-end typing.

## One-time setup (when the first modules are viewable — not yet)
1. Publish `isheeka-vite/` as a **new GitHub repo** (keeps the current app untouched; its
   GitHub Pages URL becomes the **staging** site, later the production site).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Repo → Settings → Secrets and variables → Actions → **Variables**: add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (anon key is public by design).
4. Push → the Action builds and deploys automatically (your "just push" workflow is preserved).

## Local dev (optional)
```
cd isheeka-vite
npm install
cp .env.example .env   # fill VITE_SUPABASE_ANON_KEY
npm run dev            # http://localhost:5173
```

## After the switch (safety follow-ups)
- Wrap money-path multi-table writes (quote→invoice, approve→client+quote) in atomic Postgres functions.
- Turn on backups / PITR.
- Seed a small integration test suite on the money paths.
