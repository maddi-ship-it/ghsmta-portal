-- Acceptd synchronization is pull-only. Remove webhook delivery storage if the
-- earlier integration migration was already applied; all program mappings,
-- application snapshots, answers, and sync-run history remain intact.
drop table if exists public.acceptd_webhook_deliveries cascade;
