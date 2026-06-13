-- =====================================================================
-- v22 — Configurable Event Types
-- Mirrors the lead_sources pattern: a table is the source of truth and
-- the static CHECK on events.type is dropped (custom types are allowed).
-- Run in Supabase SQL editor.
-- =====================================================================

-- 1) Table (mirror of lead_sources)
CREATE TABLE IF NOT EXISTS public.event_types (
  event_type_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label      text NOT NULL,
  value      text NOT NULL UNIQUE,
  sort_order int  NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Seed with the current five (idempotent on value)
INSERT INTO public.event_types (label, value, sort_order, is_active) VALUES
  ('Wedding',     'wedding',     1, true),
  ('Corporate',   'corporate',   2, true),
  ('Birthday',    'birthday',    3, true),
  ('Anniversary', 'anniversary', 4, true),
  ('Other',       'other',       5, true)
ON CONFLICT (value) DO NOTHING;

-- 3) Drop the static CHECK so custom event types can be stored
--    (same approach used when leads_source_check was dropped).
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_type_check;

-- 4) RLS — authenticated read/write (matches lead_sources)
ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_types_all ON public.event_types;
CREATE POLICY event_types_all ON public.event_types
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5) Index for the ordered active lookup
CREATE INDEX IF NOT EXISTS idx_event_types_active ON public.event_types (is_active, sort_order);

-- =====================================================================
-- Note: every event.type write in the app is lowercased, so existing
-- rows (wedding/corporate/birthday/anniversary/other) already match the
-- seeded values. Custom types added via Settings are stored as their
-- auto-generated value (e.g. "Baby Shower" -> baby_shower).
-- =====================================================================
