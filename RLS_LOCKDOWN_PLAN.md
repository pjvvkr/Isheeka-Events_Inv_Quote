# DB-side RLS Lockdown — Plan (#74)

**Status:** draft for review. **No changes applied.** Nothing here touches prod until you approve.

## 1. Goal & current state

**Goal:** make the database enforce the same `users.module_access` map that the app's
Settings → Access control tab sets — so access is real, not just a hidden sidebar item.

**Today:** every table has a single permissive policy:

```
cmd = ALL,  qual = (auth.role() = 'authenticated')
```

Meaning **any logged-in staff user can read and write every table through the API**,
no matter what their module access says. The UI hides modules; the database does not.
That's the gap this closes.

**Important — what already bypasses RLS (so it won't break):** the edge functions
(`rfq-gateway`, `extract`, `push-send`, `daily-digest`) all use the **service-role key**,
which ignores RLS entirely. The public client/vendor portal talks only to `rfq-gateway`,
never to the database directly. So tightening RLS affects **only logged-in staff using the
app** — not the portal, not notifications, not the digest.

## 2. The model — two tiers (recommended)

A strict "lock every table's reads to its module" approach is tempting but **risky**: the
app constantly reads across modules (Events shows client names, Invoices read events,
Reports aggregate invoices + expenses + owner ledger, the Dashboard counts everything,
notifications read the users list). Locking *reads* per-module would break those views for
restricted users — the classic way an RLS rollout causes a lockout.

So the recommendation splits tables into two tiers:

**Tier A — Sensitive (gate both READ and WRITE).** The genuinely confidential data:
| Data | Tables | Who can read/write |
|---|---|---|
| Owner finances | `owner_ledger`, `owner_expenses`, `owner_reimbursements` | Owners only |
| Business expenses | `expenses` | Users with `expenses` module |
| Company/bank/settings | `settings` | Admins only |
| Staff directory writes | `users` (write) | Admins only (read stays open — needed for names) |

This is the real win: a staffer without finance access **cannot pull owner financials or
the company's bank details via the API**, even with a script.

**Tier B — Operational (READ stays open to staff, gate WRITES per module).**
`clients`, `leads`, `events` (+ sub-events/items/checklists/templates/types),
`quotations` (+ line items/log), `invoices` (+ installments/payments/line items/log),
`vendors`, `vendor_payments` (+ installments), `rfqs` (+ items/activity/costing).

A staffer without `invoices` can't create or edit invoices through the API, but can still
*read* them (they see them in-app anyway, and Reports/Dashboard need them). This enforces
**write authority** without breaking cross-module views.

**Infra tables — left open** (any authenticated staff): `counters` (ref-number generation,
needed by every "create"), `notifications` + `push_subscriptions` (tightened to *own rows*
— a user only sees their own), `short_links`, `rfq_otp`, `payment_notifications`.

> If you'd rather go **fully strict** (gate reads per-module on Tier B too), we can — but
> I'd want to first add explicit cross-read grants for Reports/Dashboard and test hard.
> See the open decision at the end.

## 3. Helper functions (SECURITY DEFINER)

Three small functions read the caller's profile once. `security definer` lets them read
`public.users` even when the caller's own RLS would not.

```sql
-- Full access: admins, owners, and (fail-open) anyone with no profile row — matches app.
create or replace function public.app_full() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (u.role = 'admin' or u.is_owner) from public.users u where u.user_id = auth.uid()),
    true)  -- no profile → full, so we never accidentally lock someone out
$$;

-- Owner-only (sensitive finance).
create or replace function public.app_is_owner() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select u.is_owner from public.users u where u.user_id = auth.uid()), false)
$$;

-- Admin-only (settings, user management).
create or replace function public.app_is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select (u.role = 'admin') from public.users u where u.user_id = auth.uid()), false)
$$;

-- Module check. Fail-open while module_access is unset, so the rollout is gradual:
-- enforcement kicks in only for users who have an explicit map (set via the Access tab).
create or replace function public.app_can(mod text) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false                 -- anon never reaches here (portal uses service role)
    else coalesce((
      select (u.role = 'admin' or u.is_owner
              or u.module_access is null               -- unconfigured → allow (gradual rollout)
              or coalesce((u.module_access ->> mod)::boolean, false))
      from public.users u where u.user_id = auth.uid()
    ), true)                                           -- no profile → allow
  end
$$;
```

Note the deliberate **fail-open** choices (no profile, or `module_access` not yet set →
allowed). This means flipping RLS on changes nothing until you actually assign module maps
in the Access tab — so we can deploy the policies safely, then tighten per user.

## 4. Policy pattern

For each table, replace the single `auth.role()='authenticated'` policy with explicit ones.

**Tier A example — owner ledger (owners only):**
```sql
drop policy if exists owner_ledger_policy on public.owner_ledger;
create policy owner_ledger_all on public.owner_ledger
  for all to authenticated using (public.app_is_owner()) with check (public.app_is_owner());
```

**Tier A example — settings (admins only):**
```sql
drop policy if exists settings_policy on public.settings;
create policy settings_all on public.settings
  for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());
```

**Tier B example — invoices (read open, write gated):**
```sql
drop policy if exists invoices_policy on public.invoices;
create policy invoices_read on public.invoices
  for select to authenticated using (true);
create policy invoices_write on public.invoices
  for all to authenticated
  using (public.app_can('invoices')) with check (public.app_can('invoices'));
```
(`for all` write + `for select` read = reads always allowed, writes gated. The `rfqs`
family is gated on `app_can('rfqs') or app_can('vendor-rfqs')` since that table backs both
modules; `vendor_payments` on `vendor-payments`; `expenses` is Tier A on `app_can('expenses')`
for both read and write.)

**Own-rows example — notifications:**
```sql
drop policy if exists notifications_policy on public.notifications;
create policy notifications_self on public.notifications
  for all to authenticated
  using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());
```

## 5. Rollout & testing (safe sequence)

1. **Branch first.** Apply everything on a Supabase **preview branch** (not prod), so we can
   test against a copy. (Or, if you prefer, apply to prod with the rollback script ready.)
2. **Apply** helpers → Tier A → Tier B → infra, as one reviewed migration.
3. **Test matrix** with a throwaway staff user given a *limited* module map:
   - App still loads; Dashboard + Reports render (cross-reads OK).
   - Denied module (e.g. no `invoices`): can read, **cannot** create/edit via API.
   - Sensitive: a non-owner **cannot** read `owner_ledger`; a non-admin **cannot** read `settings`.
   - Owner + admin: unaffected, full access everywhere.
   - Notifications/push: user sees only their own.
4. **Verify edge paths** unchanged: submit a client RFQ (gateway), record a payment
   (triggers), run the digest — all use service role, should be unaffected.
5. **Merge** the branch (or keep prod if applied there).

**Rollback** is one migration — drop the new policies, restore the original
`for all using (auth.role()='authenticated')` on each table. I'll write it alongside so
revert is instant if anything misbehaves.

## 6. What I need from you (decisions)

1. **Lockdown depth** — go with the recommended **two-tier** (sensitive = read+write gated,
   operational = write-only gated), or the **fully strict** variant (reads gated per-module
   everywhere, with extra cross-read grants for Reports/Dashboard + more testing)?
2. **Where to test** — apply on a **Supabase preview branch** first (safest, slight extra
   setup), or apply to **prod** directly with the rollback script staged?
3. **Confirm** you're OK with me running the Supabase migration when we get there (per your
   standing rule, I'll get explicit go before applying).

Once you pick, I'll write the exact migration (every table) + the rollback, and we run the
test matrix before it's considered done.
