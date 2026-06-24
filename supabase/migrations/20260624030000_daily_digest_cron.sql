-- Daily digest scheduled job (Phase 4). Enables pg_cron + pg_net.
-- The cron schedule itself embeds the internal secret to call the daily-digest
-- function, so it is created OUT-OF-BAND (Supabase SQL editor / MCP), never in git:
--
--   select cron.schedule('isheeka-daily-digest', '30 1 * * *', $$
--     select net.http_post(
--       url     := 'https://<project-ref>.supabase.co/functions/v1/daily-digest',
--       headers := jsonb_build_object('Content-Type','application/json','x-internal-secret','<PUSH_INTERNAL_SECRET>'),
--       body    := '{}'::jsonb
--     ) $$);
--   -- 01:30 UTC = 07:00 IST
--
-- To change/stop: select cron.unschedule('isheeka-daily-digest');
create extension if not exists pg_cron;
create extension if not exists pg_net;
