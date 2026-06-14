-- One-off backfill: mark quotes Rejected where their event was cancelled BEFORE the
-- event-cancel→quote-reject cascade existed. New cancellations handle this automatically.

-- STEP 1 — preview what will change
SELECT q.quotation_id, q.ref_number AS quote_ref, q.status AS quote_status,
       e.ref_number AS event_ref, e.status AS event_status
FROM public.quotations q
JOIN public.events e ON e.event_id = q.event_id
WHERE e.status = 'cancelled' AND e.is_deleted = false
  AND q.is_deleted = false
  AND q.status NOT IN ('rejected','superseded','expired')
ORDER BY q.ref_number;

-- STEP 2 — apply (sets those quotes to rejected)
-- UPDATE public.quotations q
-- SET status = 'rejected', updated_at = now()
-- WHERE q.is_deleted = false
--   AND q.status NOT IN ('rejected','superseded','expired')
--   AND q.event_id IN (
--     SELECT event_id FROM public.events
--     WHERE status = 'cancelled' AND is_deleted = false
--   );

-- Notes:
--  * Skips quotes already terminal (rejected/superseded/expired).
--  * Historical PDFs stay printable; only the status (and the misleading "Sent" chip) is corrected.
--  * Optional: log an audit entry per quote (run after the UPDATE if you want the trail):
--    INSERT INTO public.quotation_activity_log (quotation_id, action, notes)
--    SELECT q.quotation_id, 'rejected', 'Backfill: source event cancelled'
--    FROM public.quotations q JOIN public.events e ON e.event_id=q.event_id
--    WHERE e.status='cancelled' AND e.is_deleted=false AND q.is_deleted=false AND q.status='rejected';
