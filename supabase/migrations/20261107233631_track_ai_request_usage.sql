create table public.ai_request_usage (
  id uuid primary key default gen_random_uuid(),
  feature text not null,
  provider text not null default 'openai',
  response_id text,
  application_id uuid references public.applications(id) on delete set null,
  portal_file_id uuid references public.portal_files(id) on delete set null,
  requested_by uuid references public.profiles(id) on delete set null,
  model text not null,
  service_tier text,
  usage_type text not null default 'tokens' check (usage_type in ('tokens', 'duration')),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  audio_input_tokens bigint not null default 0 check (audio_input_tokens >= 0),
  text_input_tokens bigint not null default 0 check (text_input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint check (total_tokens is null or total_tokens >= 0),
  audio_seconds numeric check (audio_seconds is null or audio_seconds >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  constraint ai_request_usage_measurement_check check (
    (usage_type = 'tokens' and input_tokens is not null and output_tokens is not null and total_tokens is not null)
    or
    (usage_type = 'duration' and audio_seconds is not null)
  ),
  created_at timestamptz not null default now()
);

create unique index ai_request_usage_response_idx
  on public.ai_request_usage(provider, response_id)
  where response_id is not null;

create index ai_request_usage_feature_created_idx
  on public.ai_request_usage(feature, created_at desc);

create index ai_request_usage_application_created_idx
  on public.ai_request_usage(application_id, created_at desc)
  where application_id is not null;

alter table public.ai_request_usage enable row level security;

-- Usage records are written and reviewed by trusted server-side code only.
-- No browser client should be able to inspect or alter organization-wide costs.
revoke all on table public.ai_request_usage
from public, anon, authenticated;

grant select, insert on table public.ai_request_usage
to service_role;
