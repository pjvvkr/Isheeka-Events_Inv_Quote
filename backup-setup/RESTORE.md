# Isheeka ERP — How to restore from a backup

Use this if data is lost/corrupted, a bad bulk edit happened, or you need to move to a
new Supabase project. **When this day comes, ping me and I'll do it with you** — but here's
the full procedure so you're never dependent on anyone.

You need: `pg_restore` (comes with the PostgreSQL tools), the backup file, and — for cloud
backups — your `BACKUP_PASSPHRASE`.

---

## Step 1 — Pick the target database
- **Recovering the same project?** Use its Session-pooler URI as the target (`TARGET_DB_URL`).
- **Project was deleted / starting fresh?** Create a NEW Supabase project, then use its
  Session-pooler URI. (Update the app's `VITE_SUPABASE_URL` / anon key afterwards.)

## Step 2 — Get a plain `.dump` file
- **From a LOCAL backup (Option B):** the file is already a `.dump` — skip to Step 3.
- **From a CLOUD backup (Option A):** download the `.dump.gpg` from the `isheeka-backups`
  repo (`backups/daily/` or `backups/monthly/`), then decrypt:
  ```
  gpg --output restore.dump --decrypt isheeka-YYYY-MM-DD.dump.gpg
  ```
  (it will prompt for your BACKUP_PASSPHRASE)

## Step 3 — Restore
```
pg_restore --no-owner --no-privileges --clean --if-exists --schema=public \
  -d "<TARGET_DB_URL>" restore.dump
```
- Restoring into a **fresh** project? Drop `--clean --if-exists` (nothing to clean yet).
- Restoring over the **existing** project? Keep `--clean --if-exists` so it replaces objects.
- A few harmless "already exists" / extension notices are normal.

## Step 4 — Re-create staff logins (only on a brand-new project)
Your staff directory & permissions come back from `public.users`, but the actual Supabase
Auth login accounts are separate. In the new project → Authentication → add each staff
user with their email (keep signup disabled). They're matched to permissions by email.

## Step 5 — Sanity check
Log in, open Clients / Invoices / Owner Account, confirm recent records are present.

---
### Tip: test a restore before you ever need one
Spin up a free throwaway Supabase project, run Steps 2–3 against it, confirm the data loads,
then delete the throwaway project. Do this once now so you trust the system.
