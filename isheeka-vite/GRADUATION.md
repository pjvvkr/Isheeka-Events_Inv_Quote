# Isheeka ERP — Graduation to a Vite build

Behaviour-preserving port of `isheeka-erp-v22.html` (single-file, in-browser Babel)
into a proper Vite + React + TypeScript-ready project. **Same app, same Supabase,
same features** — just packaged for speed, modularity, tests, and safe iteration.

## Status
- ✅ Scaffold: Vite + React + TS-ready (`allowJs`), CI deploy workflow, supabase client. Builds clean.
- ⏳ Port: app being moved here module-by-module from the single file.
- ⛔ Switch-over: only after the new build matches the live app screen-for-screen and you've verified it.

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
