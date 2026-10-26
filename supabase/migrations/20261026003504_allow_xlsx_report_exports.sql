alter table public.report_presets
  drop constraint if exists report_presets_format_check;

alter table public.report_presets
  add constraint report_presets_format_check
  check (format in ('pdf', 'csv', 'xlsx', 'zip'));

alter table public.report_runs
  drop constraint if exists report_runs_requested_format_check;

alter table public.report_runs
  add constraint report_runs_requested_format_check
  check (requested_format in ('pdf', 'csv', 'xlsx', 'zip'));

alter table public.report_schedules
  drop constraint if exists report_schedules_format_check;

alter table public.report_schedules
  add constraint report_schedules_format_check
  check (format in ('pdf', 'csv', 'xlsx', 'zip'));
