-- Fix: saving a template with a custom event type fails because event_templates.event_type
-- still has an old CHECK constraint limiting it to wedding/corporate/birthday/anniversary/other.
-- (We dropped the equivalent constraint on the events table earlier; templates have their own.)

-- 1) Inspect what's on the column (run first if you want to see it):
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.event_templates'::regclass AND contype = 'c';

SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='event_templates' AND column_name='event_type';

-- 2) Drop ANY check constraint on event_templates that references event_type (safe, targeted).
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname='public' AND rel.relname='event_templates' AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%event_type%'
  LOOP
    EXECUTE 'ALTER TABLE public.event_templates DROP CONSTRAINT ' || quote_ident(c);
    RAISE NOTICE 'Dropped constraint %', c;
  END LOOP;
END $$;

-- After this, event_type is governed by the configurable event_types table (app-side),
-- like leads/events/quotations already are. If step (1) showed data_type = USER-DEFINED
-- (a Postgres ENUM) instead of a check, DON'T run step 2 — paste the output back and
-- I'll give the ALTER TYPE ... ADD VALUE version instead.
