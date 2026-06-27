# Isheeka ERP — Backup setup (Option A cloud + Option B local)

You'll do this once. ~15 minutes. Free.

---

## First: get your database connection string (used by both A and B)

1. Supabase dashboard → your project → **Project Settings → Database**.
2. Under **Connection string**, choose the **Session pooler** tab → copy the **URI**.
   It looks like:
   `postgresql://postgres.jlcssesetnxulnkbrmyp:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
   - ⚠ Use the **Session pooler** one (port 5432). The "direct" host is IPv6-only and won't work from GitHub.
   - It contains your DB password — treat it like a password.

---

## Option A — Cloud nightly backup (GitHub Actions)

1. On GitHub, click **New repository** → name it `isheeka-backups` → set **Private** → Create.
2. Add the workflow file: in the new repo click **Add file → Upload files**, and upload the
   `.github/workflows/backup.yml` from this `backup-setup` folder (keep the folder path
   `.github/workflows/`). Commit to `main`.
3. In the `isheeka-backups` repo → **Settings → Secrets and variables → Actions → New repository secret**, add two:
   - `SUPABASE_DB_URL` → paste the Session-pooler URI from above.
   - `BACKUP_PASSPHRASE` → invent a strong passphrase (e.g. 5–6 random words).
     **Save this passphrase in your password manager.** If you lose it, the backups cannot be decrypted.
4. Go to the **Actions** tab → if prompted, enable workflows → open **Nightly DB backup** → **Run workflow** to test it now.
5. After ~1 minute, check the repo: a file should appear at `backups/daily/isheeka-YYYY-MM-DD.dump.gpg`. ✅

That's it — it now runs every night at 02:00 IST, keeping ~90 daily + 12 monthly snapshots.

---

## Option B — Local backup on your PC (Windows Task Scheduler)

1. **Install the Postgres tools** (gives you `pg_dump` / `pg_restore`):
   download "PostgreSQL 17" from postgresql.org → during install you only need
   **Command Line Tools** → finish. Then add its `bin` folder (e.g.
   `C:\Program Files\PostgreSQL\17\bin`) to your PATH.
2. **Set the connection string** as an environment variable: Start → "Edit the system
   environment variables" → Environment Variables → New (User variable):
   name `SUPABASE_DB_URL`, value = the Session-pooler URI.
3. Put `local-backup.ps1` (from this folder) somewhere permanent, e.g. `C:\Users\vamsh\IsheekaBackups\`.
4. **Test it:** open PowerShell and run
   `powershell -ExecutionPolicy Bypass -File "C:\Users\vamsh\IsheekaBackups\local-backup.ps1"`
   → a `.dump` file should appear in `C:\Users\vamsh\IsheekaBackups`. ✅
5. **Schedule it:** open **Task Scheduler → Create Basic Task** → name "Isheeka DB backup"
   → Daily → pick a time your PC is usually on (e.g. 9:00 PM) → Action **Start a program**:
   - Program: `powershell.exe`
   - Arguments: `-ExecutionPolicy Bypass -File "C:\Users\vamsh\IsheekaBackups\local-backup.ps1"`
   → Finish. (Tick "Run whether user is logged on or not" if you want.)

Optional: to also keep a copy in OneDrive/Google Drive, uncomment the `$cloud` lines in `local-backup.ps1`.

---

## What's backed up (and what isn't)
- ✅ **Everything in the `public` schema** — clients, leads, RFQs, quotations, invoices, payments, owner ledger, vendors, settings, plus all RLS policies and functions. This is your business data.
- ⚠ **Staff logins** live in Supabase Auth (separate). Your staff *directory & permissions* are in `public.users` (backed up); only the actual login accounts would be re-created during a full rebuild — just a few accounts.
- ⚠ **Uploaded files** (PDF proofs/attachments in Storage) are not in the database, so not in this dump. Most are regenerated from data anyway; tell me if you want those backed up too.

## Test your backups occasionally
A backup you've never restored isn't a backup. Every few months, do a trial restore into a throwaway Supabase project (see `RESTORE.md`). I'm happy to walk through it with you.
