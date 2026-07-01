-- ROADMAP Phase 2c v2 — stable per-line lineage id for sourcing-drift detection.
-- Nullable, so existing rows are unaffected; costed/revised/wizard-added lines populate it.
-- For costed lines this carries the client rfq_items.rfq_item_id; for wizard-added lines,
-- a generated uuid. It persists across quote revisions so drift detection can distinguish a
-- renamed item (same id, changed text) from a genuinely new one.
alter table public.quotation_line_items
  add column if not exists source_item_id uuid;

comment on column public.quotation_line_items.source_item_id is
  'Stable line lineage id: costed lines = client rfq_items.rfq_item_id; wizard-added lines = generated uuid. Persists across quote revisions for drift detection.';

create index if not exists idx_qli_source_item_id
  on public.quotation_line_items (source_item_id)
  where source_item_id is not null;
