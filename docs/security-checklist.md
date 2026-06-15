# Isheeka ERP — Go-Live Security Checklist

A practical, prioritised checklist to do **before putting real client + financial data into the app.**
Most of this is configuration in the **Supabase dashboard** (no code). Items that need a code change are tagged **[code]** — ask Claude to implement those.

How to read it: 🔴 = do before go-live (non-negotiable), 🟠 = do soon, 🟡 = good hygiene.

---

## Why this matters (30-second version)

The app runs entirely in the browser and talks straight to Supabase. The Supabase URL and "anon key" are visible to anyone who opens the page — **that is normal and expected.** Your data is protected by **Row-Level Security (RLS)** in the database, *not* by hiding the key. So the whole game is: (1) RLS is on and correct everywhere, and (2) only your people can get a logged-in session.

---

## 🔴 CRITICAL — before any real data

### 1. RLS is ENABLED on every table
A table with RLS *disabled* is fully readable/writable by anyone with the anon key (i.e. anyone on the internet). Run this in the Supabase **SQL Editor** and confirm **every** app table shows `rowsecurity = true`:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by rowsecurity, tablename;
```
- [ ] Every table in `public` has `rowsecurity = true`.
- For any that show `false`, enable it: `alter table public.<name> enable row level security;` — **then make sure a policy exists** (a table with RLS on but no policy blocks everyone, including your app).

### 2. Every table actually HAS policies
RLS on + no policy = nobody can read it (the app breaks). RLS on + a too-loose policy = everyone can read it. List policies and review them:

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
```
- [ ] Each table has policies for the operations the app uses (select/insert/update/delete).
- [ ] `roles` is `{authenticated}` — **not** `{anon}` or `{public}`. (Anon/public = no login required = open to the world.)
- [ ] No policy has `qual = true` for the `anon`/`public` role. (`true` means "always allow".)

> Note: today the policies are "any logged-in user can do everything." That's acceptable **only** because account creation is locked down (next item). It is the right model for a small trusted team; it is **not** safe if strangers can sign up.

### 3. Disable public sign-ups
This is the most important single setting. If signups are open, a stranger can register, get a valid session, and — because policies allow "any authenticated user" — read every lead, client, quote and amount.
- In Supabase: **Authentication → Sign In / Providers** (or **Auth → Settings**) → turn **OFF** "Allow new users to sign up" (Disable email signup / Disable public signups).
- [ ] Public sign-up is **disabled**.
- [ ] You create staff accounts yourself (Authentication → Users → Add user), or via invite only.

### 4. Account inventory
- In **Authentication → Users**, confirm the only accounts are people you trust.
- [ ] No unknown/leftover/test accounts with real access. Delete any.

---

## 🟠 HIGH — do soon after go-live

### 5. Make the PDF storage bucket private + use signed URLs  **[code]**
The `quotations` bucket is **public** — anyone with a PDF link can open it (and those PDFs contain client names + amounts). Protection is only "the URL is hard to guess."
- Better: set the bucket to **private** and generate **time-limited signed URLs** when sharing.
- [ ] Decide: keep public (simple, slight exposure) or go private + signed URLs.
- This needs a small code change to the upload/share logic — **ask Claude to implement signed URLs** if you want it.

### 6. Strong passwords + MFA
- [ ] Every account uses a strong, unique password (use a password manager).
- [ ] Enable **MFA** in Supabase Auth if available on your plan, at least for the owner account.
- [ ] In **Auth → Settings**, set a sensible minimum password length / strength.

### 7. Backups
This is about not *losing* data (a different risk from a breach).
- [ ] Confirm your Supabase plan includes **daily backups** (and ideally **Point-in-Time Recovery**). The free tier's backups are limited — for a real business, the Pro plan's PITR is worth it.
- [ ] As a belt-and-suspenders, take a periodic manual export (Database → Backups, or `pg_dump`) and keep a copy off-platform.

### 8. Who can access the Supabase *project*
The dashboard is more powerful than any app login — it can bypass RLS entirely.
- [ ] Only you (and anyone who truly needs it) are **members/owners** of the Supabase organisation/project (Organization → Team).
- [ ] The **service_role key** (the secret admin key) is **never** put in the app, a screenshot, or a public repo. If it ever leaks, rotate it immediately.

---

## 🟡 HYGIENE — good to have

### 9. GitHub repository
- [ ] If the repo is **public**, that's OK (the anon key is meant to be public) — but anyone can read your code. Consider making it **private** if you'd rather not expose the structure. (GitHub Pages can still serve a private repo's site on paid plans; verify your setup if you switch.)
- [ ] The repo contains **no** service_role key, DB password, or other secret. Search the history to be sure.

### 10. Monitoring
- [ ] Glance at **Auth → Logs** occasionally for unexpected sign-ins.
- [ ] Watch the **Database → Logs / API** usage for anomalies (sudden spikes can indicate scraping).

### 11. Data-protection basics (India DPDP / general good practice)
- [ ] Only collect client data you actually need.
- [ ] Have a way to delete a client's data on request (the app's soft-delete + a hard delete in the DB when truly needed).
- [ ] Don't email/share spreadsheets of client PII casually.

### 12. Session & device hygiene
- [ ] Session auto-timeout is already built into the app (good) — keep it.
- [ ] Staff log out / lock devices, especially on shared computers.

---

## Quick "am I safe?" gut-check
If you can answer **yes** to these four, you've covered the breach-critical basics:
1. Does **every** table show `rowsecurity = true`? 
2. Are all policies scoped to `authenticated` (no `anon`/`public` open access)?
3. Are **public sign-ups disabled**?
4. Are the only user accounts people you trust?

The rest (private bucket, MFA, backups, repo) raises the bar from "safe for a trusted team" to "properly hardened."

---

## What Claude can do for you here
- **Audit your RLS** — paste the output of the two SQL queries above and Claude will flag anything risky.
- **Implement private bucket + signed URLs** (the one item that needs code).
- Add an **owner-only** vs **staff** permission split later, if you want roles beyond "everyone can do everything."

_Last updated: 14 Jun 2026._
