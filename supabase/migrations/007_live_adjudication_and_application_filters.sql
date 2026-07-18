-- GHSMTA Portal: enable owner live review of adjudication draft activity.
-- Run after migrations 001-006.

-- Supabase Postgres Changes requires each subscribed table to be included in
-- the supabase_realtime publication. RLS continues to control which rows each
-- signed-in user can receive.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'adjudication_scorecards'
  ) then
    alter publication supabase_realtime
      add table public.adjudication_scorecards;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'adjudication_scores'
  ) then
    alter publication supabase_realtime
      add table public.adjudication_scores;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'adjudication_category_comments'
  ) then
    alter publication supabase_realtime
      add table public.adjudication_category_comments;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'adjudication_panel_feedback'
  ) then
    alter publication supabase_realtime
      add table public.adjudication_panel_feedback;
  end if;
end
$$;
