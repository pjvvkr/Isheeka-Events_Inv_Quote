-- One-off backfill: set the source lead's stage for events that were cancelled
-- BEFORE the cancel flow offered a lead choice. Targets leads still sitting at
-- 'event_triggered' (the post-conversion stage) whose linked event is cancelled.
--
-- Run STEP 1 first to preview. Then run EITHER Step 2A (mark Lost) OR Step 2B (reopen),
-- not both. Adjust the stage filter if your leads are in a different stage.

-- ── STEP 1 — preview what will be affected ───────────────────────────────────
SELECT l.lead_id, l.ref_number AS lead_ref, l.first_name, l.last_name, l.stage,
       e.ref_number AS event_ref, e.name AS event_name, e.status AS event_status
FROM public.leads l
JOIN public.events e ON e.lead_id = l.lead_id
WHERE e.status = 'cancelled' AND e.is_deleted = false
  AND l.is_deleted = false
  AND l.stage = 'event_triggered'
ORDER BY l.ref_number;

-- ── STEP 2A — mark those leads LOST (use if the cancellations are dead deals) ─
-- UPDATE public.leads l
-- SET stage = 'lost',
--     lost_reason = 'event_cancelled',
--     lost_notes  = COALESCE(lost_notes, '') ||
--                   '[Backfill: event cancelled]',
--     updated_at  = now()
-- WHERE l.is_deleted = false
--   AND l.stage = 'event_triggered'
--   AND l.lead_id IN (
--     SELECT lead_id FROM public.events
--     WHERE status = 'cancelled' AND is_deleted = false AND lead_id IS NOT NULL
--   );

-- ── STEP 2B — reopen those leads to CONTACTED (use if they may rebook) ────────
-- UPDATE public.leads l
-- SET stage = 'contacted',
--     updated_at = now()
-- WHERE l.is_deleted = false
--   AND l.stage = 'event_triggered'
--   AND l.lead_id IN (
--     SELECT lead_id FROM public.events
--     WHERE status = 'cancelled' AND is_deleted = false AND lead_id IS NOT NULL
--   );

-- Notes:
--  * Only leads currently at 'event_triggered' are touched (won't clobber leads already
--    Lost, or ones with a different active event). If a lead has BOTH a cancelled and a
--    live event, it likely isn't at 'event_triggered' anymore — verify in Step 1.
--  * 'event_cancelled' is a valid lost_reason in the app's loss-reason list.
--  * lost_reason / lost_notes columns: confirm they exist on your leads table (they do per
--    the loss flow). If your leads table lacks lost_notes, drop that line from 2A.
