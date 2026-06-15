# M2 — Deploy & Test Guide (RFQ gateway)

Everything you run **once** to put the M2 foundations live, then prove the loop works. ~15 minutes. Nothing here touches the live app build — this is all Supabase-side.

> Files involved: `supabase/migrations/20260615_rfq_foundations.sql`, `supabase/functions/rfq-gateway/{index.ts,email.ts}`, `supabase/config.toml`, `tools/rfq-test.html`.

---

## Step 1 — Run the migration (creates the 4 tables)

Supabase dashboard → **Database → SQL Editor → New query** → paste the whole of
`supabase/migrations/20260615_rfq_foundations.sql` → **Run**.

Then confirm (paste & run):

```sql
select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'rfq%';
select tablename, policyname, roles, cmd from pg_policies where schemaname='public' and tablename like 'rfq%' order by tablename;
```
Expect: `rowsecurity = true` for `rfqs`, `rfq_items`, `rfq_otp`, `rfq_activity`; every policy role = `{authenticated}`.

---

## Step 2 — Install the Supabase CLI (one time)

The app deploys via GitHub Desktop as usual; **Edge Functions deploy separately** with the CLI.

- **Windows (PowerShell):** `npm install -g supabase` (or `scoop install supabase`).
- Verify: `supabase --version`.

```powershell
supabase login                       # opens a browser to authorize
supabase link --project-ref <REF>    # <REF> = the string in your project URL: https://<REF>.supabase.co
```

---

## Step 3 — Set the secrets

`SESSION_SECRET` is required. The email keys are optional — **without them the gateway runs in STUB mode and logs the OTP code instead of emailing it**, so you can test the full loop today and add Resend before go-live.

```powershell
# required — any long random string (keep it secret; this signs client sessions)
supabase secrets set SESSION_SECRET="paste-a-long-random-string-here"

# optional now (email OTP). Get the key from resend.com → API Keys.
supabase secrets set RESEND_API_KEY="re_xxxxxxxx"
supabase secrets set EMAIL_FROM="Isheeka Events <onboarding@resend.dev>"

# optional tuning (defaults shown)
supabase secrets set LINK_TTL_DAYS=21 OTP_TTL_MIN=10 MAX_ATTEMPTS=5
# CORS: lock to your app origin before go-live, e.g. https://<user>.github.io
supabase secrets set ALLOWED_ORIGIN="*"
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do **not** set them and never put the service_role key anywhere public.

---

## Step 4 — Deploy the function (PUBLIC)

```powershell
supabase functions deploy rfq-gateway --no-verify-jwt
```
`--no-verify-jwt` makes it reachable without a Supabase login (clients have none) — the function does its own token + PIN/OTP auth. `config.toml` already sets this too.

Your function URL will be:
`https://<REF>.supabase.co/functions/v1/rfq-gateway`

**Dashboard alternative (no CLI):** Edge Functions → Create function `rfq-gateway` → paste `index.ts` (and add `email.ts`) → set **Verify JWT = OFF** → add the secrets under Settings → Deploy.

---

## Step 5 — Seed a test RFQ

Run in the SQL Editor. This creates one RFQ with a **known token + PIN** so you can test without building the staff UI yet. (Uses pgcrypto's `digest` to store the SHA-256 hashes the gateway expects.)

```sql
create extension if not exists pgcrypto with schema extensions;

insert into public.rfqs (ref_number, status, access_mode,
  contact_name, contact_email, event_type, location,
  access_pin_hash, token_hash, token_expires_at)
values (
  'RFQ-TEST-001', 'sent', 'pin',
  'Test Client', 'youraddress@example.com', 'Wedding', 'Hyderabad',
  encode(extensions.digest('4321', 'sha256'), 'hex'),            -- PIN = 4321
  encode(extensions.digest('isheeka-test-token-001','sha256'),'hex'), -- token = isheeka-test-token-001
  now() + interval '21 days'
)
returning rfq_id, ref_number;
```
So: **token** = `isheeka-test-token-001`, **PIN** = `4321`. (For email-OTP testing, set `contact_email` above to a real inbox and use the email actions.)

---

## Step 6 — Run the loop with the test page

Open `tools/rfq-test.html` (double-click, or serve it). Enter:
- **Function URL:** `https://<REF>.supabase.co/functions/v1/rfq-gateway`
- **Token:** `isheeka-test-token-001`

Then click through: **Ping** → **Verify PIN** (`4321`) → **Get RFQ** → **Save** (sends sample details + items) → **Submit**. Each response prints below.
For email: **Request OTP** (to the seeded `contact_email`) → check inbox (or, in stub mode, the function logs: dashboard → Edge Functions → rfq-gateway → Logs) → **Verify OTP**.

Success = a PIN/OTP mints a session, Get/Save/Submit work, and `rfq_activity` fills with `pin_verified` / `saved` / `submitted` rows.

---

## What this proves (and what's next)

✅ Tables + RLS, the gateway, PIN **and** email-OTP access, session, autosave/submit — the secure backbone. **No client UI or ERP module yet** — that's **M3**, which adds the branded client form and the staff "RFQs" module (create/link/review/approve → auto-create client + draft quote).

### Troubleshooting
- `server_misconfigured` → `SESSION_SECRET` not set (Step 3), redeploy.
- `invalid_link` → token doesn't match the seeded `token_hash`.
- CORS error in the browser console → set `ALLOWED_ORIGIN` to your page's origin (or `*` while testing) and redeploy.
- OTP never arrives → you're in stub mode (no `RESEND_API_KEY`); read the code from the function Logs, or add the Resend key.
