alter table public.adjudication_panel_feedback
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

create index if not exists adjudication_panel_feedback_assigned_to_idx
  on public.adjudication_panel_feedback(assigned_to)
  where assigned_to is not null;
