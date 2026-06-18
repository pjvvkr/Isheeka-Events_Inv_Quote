# Deploying the Vite ERP to Netlify

Side-by-side deploy: the new ERP goes to Netlify; the legacy HTML app + the public
`rfq.html` portal **stay on GitHub Pages** (unchanged), so nothing currently in use breaks.

## What's already wired (in code)

- `netlify.toml` (repo root) — build settings (base `isheeka-vite`, `npm run build`, publish `dist`, Node 20, SPA fallback).
- `.env.production` — `VITE_RFQ_BASE_URL` points client RFQ links at the Pages `rfq.html`, so they resolve no matter where the ERP is hosted.
- `rfqLink()` resolves against that base.

## Step 0 — Commit & push these changes first

```powershell
cd C:\Users\vamsh\GitHub
git add -A
git commit -m "Prep Netlify deploy: rfqLink base URL, netlify.toml, deploy doc"
git push
```

## Step 1 — Create the Netlify site

1. Sign up at netlify.com **using a company/owner email** (not a personal Gmail) — the business should own its hosting.
2. **Add new site → Import an existing project → GitHub** → authorize → pick `pjvvkr/Isheeka-Events_Inv_Quote`.
3. Netlify reads `netlify.toml` automatically, so build settings should pre-fill (base `isheeka-vite`, command `npm run build`, publish `dist`). Leave them.
4. **Deploy.** First build takes ~1–2 min. You'll get a URL like `https://<random-name>.netlify.app`. (Rename it under Site configuration → Site details if you want something tidier.)

> Env vars: the build reads `.env.production` from the repo, so `VITE_*` values are picked up automatically — nothing to set in Netlify's UI.

## Step 2 — Tell Supabase about the new origin (REQUIRED)

Dashboard → your **prod** project → **Authentication → URL Configuration**:

- **Site URL:** you can leave as-is, or set to the Netlify URL once you cut over.
- **Redirect URLs:** **add** `https://<your-site>.netlify.app/**` (and your custom domain later).

Without this, password-reset and email-confirmation links break.

## Step 3 — Check the RFQ gateway's allowed origin

The `rfq-gateway` function uses `ALLOWED_ORIGIN` (defaults to `*`). If you ever set it to a
specific origin, add the Netlify origin too:

```powershell
supabase secrets list --project-ref jlcssesetnxulnkbrmyp
# if ALLOWED_ORIGIN is pinned, update it; if it's unset (defaults to *), nothing to do
```

(`rfq.html` itself stays on Pages and calls the gateway directly, so this is just belt-and-suspenders.)

## Step 4 — Validate on the Netlify URL (before telling staff)

- [ ] Log in (a real staff account).
- [ ] Open Leads, Quotations, Events, Invoices — all render.
- [ ] Create a lead; generate a quote; hit Share — confirm the link is a short
      `…/functions/v1/s/<code>` link and it opens the PDF.
- [ ] Send an RFQ — confirm the generated link points at
      `pjvvkr.github.io/Isheeka-Events_Inv_Quote/rfq.html?t=…` and opens the portal.
- [ ] Trigger a password reset — confirm the email link lands back on the app.

## Step 5 — Cut over

- Share the Netlify URL with staff as the new ERP address.
- Optional: add a custom domain (e.g. `app.isheekaevents.in`) under Netlify → Domain
  management → free HTTPS via Let's Encrypt → update DNS. Then add it to Supabase
  Redirect URLs (Step 2) too.
- **Leave GitHub Pages on** — it keeps serving `rfq.html` and the legacy app. Existing
  client RFQ links keep working.

## Rollback

If anything's wrong, just keep using the old app — GitHub Pages is untouched and still
serves `isheeka-erp-v22.html`. No data migration is involved (same prod database), so
there's nothing to undo on the backend.

## Notes / gotchas

- **Service worker (PWA):** staff who used the old URL may keep seeing a cached version
  until they load the Netlify URL. A hard refresh (Ctrl+F5) clears it.
- **Repo stays public** (GitHub Pages free requires it). As established, this is not a
  database risk — the anon key is public by design and RLS is the real boundary.
- **Every new DB table** must get RLS + an authenticated policy before it ships.
