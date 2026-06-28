-- Add sub_items JSONB to sub_event_items (mirrors quotation/invoice line items)
ALTER TABLE public.sub_event_items
  ADD COLUMN IF NOT EXISTS sub_items jsonb DEFAULT '[]'::jsonb;

-- Backfill from quotation_line_items for existing events
UPDATE public.sub_event_items sei
SET sub_items = qli.sub_items
FROM public.quotation_line_items qli
JOIN public.quotations q ON q.quotation_id = qli.quotation_id AND q.is_deleted = false
WHERE q.event_id = sei.event_id
  AND qli.is_deleted = false
  AND qli.description = sei.description
  AND qli.sub_items IS NOT NULL
  AND jsonb_array_length(qli.sub_items) > 0
  AND (sei.sub_items IS NULL OR sei.sub_items = '[]'::jsonb);

-- Backfill invoices.additional_notes from linked quotations
UPDATE public.invoices i
SET additional_notes = q.additional_notes,
    updated_at = NOW()
FROM public.quotations q
WHERE i.quotation_id = q.quotation_id
  AND i.additional_notes IS NULL
  AND q.additional_notes IS NOT NULL
  AND q.additional_notes != '';
