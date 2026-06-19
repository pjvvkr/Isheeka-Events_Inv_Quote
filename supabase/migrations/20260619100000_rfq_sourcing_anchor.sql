-- ============================================================================
-- is_sourcing_anchor: marks an internal "sourcing anchor" RFQ — one auto-created
-- from a quote (via the universal "Source vendors" bridge) purely to hang vendor
-- RFQs + costing off, when the quote wasn't born from a client RFQ. These are
-- party_type='client' so the Sourcing panel + costing screen read them unchanged,
-- but the Client RFQ list filters them out (they were never sent to a client).
-- Additive & idempotent; prod-safe.
-- ============================================================================

alter table public.rfqs add column if not exists is_sourcing_anchor boolean not null default false;
create index if not exists idx_rfqs_sourcing_anchor on public.rfqs(is_sourcing_anchor);
