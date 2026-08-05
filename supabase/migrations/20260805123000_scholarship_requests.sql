-- School scholarship request workflow. Applicants can submit requests tied to
-- their application; Owners are the only staff notified and the only reviewers.

begin;

alter table public.portal_files
  drop constraint if exists portal_files_context_type_check;

alter table public.portal_files
  add constraint portal_files_context_type_check
  check (context_type in (
    'appeal',
    'bug_report',
    'feature_request',
    'application',
    'scholarship_request'
  ));

drop policy if exists "users register own portal files"
on public.portal_files;

create policy "users register own portal files"
on public.portal_files for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (
    context_type not in ('application', 'scholarship_request')
    or (
      context_type = 'application'
      and application_id is not null
      and public.can_manage_application_documents(application_id, (select auth.uid()))
    )
    or (
      context_type = 'scholarship_request'
      and application_id is not null
      and public.is_application_member(application_id, (select auth.uid()))
    )
  )
);

create table public.scholarship_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  request_type text not null default 'program_fee' check (
    request_type in ('program_fee', 'travel', 'accessibility', 'other')
  ),
  amount_requested_cents integer check (amount_requested_cents is null or amount_requested_cents >= 0),
  explanation text not null check (char_length(explanation) between 10 and 10000),
  financial_context text,
  status text not null default 'submitted' check (
    status in ('submitted', 'owner_review', 'approved', 'denied', 'withdrawn')
  ),
  owner_notes text,
  resolution text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  school_contact_name text,
  school_contact_email text,
  school_contact_phone text,
  certification_accepted boolean not null default false,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scholarship_requests_application_idx
  on public.scholarship_requests(application_id, submitted_at desc);

create index scholarship_requests_status_idx
  on public.scholarship_requests(status, submitted_at desc);

drop trigger if exists scholarship_requests_set_updated_at
on public.scholarship_requests;

create trigger scholarship_requests_set_updated_at
before update on public.scholarship_requests
for each row execute function public.set_updated_at();

alter table public.scholarship_requests enable row level security;

grant select, insert, update on public.scholarship_requests to authenticated;

create policy "applicants create own scholarship requests"
on public.scholarship_requests for insert to authenticated
with check (
  submitted_by = (select auth.uid())
  and public.is_application_member(application_id, (select auth.uid()))
);

create policy "scholarship request participants read"
on public.scholarship_requests for select to authenticated
using (
  (select public.current_user_role()) = 'owner'
  or public.is_application_member(application_id, (select auth.uid()))
);

create policy "owners review scholarship requests"
on public.scholarship_requests for update to authenticated
using ((select public.current_user_role()) = 'owner')
with check ((select public.current_user_role()) = 'owner');

create or replace function public.submit_scholarship_request(
  p_application_id uuid,
  p_request_type text,
  p_amount_requested_cents integer,
  p_explanation text,
  p_financial_context text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_certification_accepted boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
begin
  if not public.is_application_member(p_application_id, auth.uid()) then
    raise exception 'You do not have access to this application.';
  end if;

  if p_request_type not in ('program_fee', 'travel', 'accessibility', 'other') then
    raise exception 'Choose a valid scholarship request type.';
  end if;

  if p_amount_requested_cents is not null and p_amount_requested_cents < 0 then
    raise exception 'Requested amount cannot be negative.';
  end if;

  if char_length(trim(coalesce(p_explanation, ''))) < 10 then
    raise exception 'Enter a complete scholarship request explanation.';
  end if;

  if not p_certification_accepted then
    raise exception 'The school certification must be accepted.';
  end if;

  insert into public.scholarship_requests (
    application_id,
    submitted_by,
    request_type,
    amount_requested_cents,
    explanation,
    financial_context,
    status,
    school_contact_name,
    school_contact_email,
    school_contact_phone,
    certification_accepted
  ) values (
    p_application_id,
    auth.uid(),
    p_request_type,
    p_amount_requested_cents,
    trim(p_explanation),
    nullif(trim(coalesce(p_financial_context, '')), ''),
    'submitted',
    nullif(trim(coalesce(p_contact_name, '')), ''),
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_contact_phone, '')), ''),
    true
  )
  returning id into result_id;

  return result_id;
end;
$$;

revoke all on function public.submit_scholarship_request(uuid, text, integer, text, text, text, text, text, boolean)
from public, anon;

grant execute on function public.submit_scholarship_request(uuid, text, integer, text, text, text, text, text, boolean)
to authenticated;

create or replace function public.review_scholarship_request(
  p_request_id uuid,
  p_status text,
  p_owner_notes text,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Owner access required.';
  end if;

  if p_status not in ('submitted', 'owner_review', 'approved', 'denied', 'withdrawn') then
    raise exception 'Choose a valid scholarship request status.';
  end if;

  update public.scholarship_requests
  set
    status = p_status,
    owner_notes = nullif(trim(coalesce(p_owner_notes, '')), ''),
    resolution = nullif(trim(coalesce(p_resolution, '')), ''),
    reviewed_by = case
      when p_status in ('approved', 'denied') then auth.uid()
      else reviewed_by
    end,
    reviewed_at = case
      when p_status in ('approved', 'denied') then now()
      else reviewed_at
    end
  where id = p_request_id;

  if not found then
    raise exception 'Scholarship request not found.';
  end if;
end;
$$;

revoke all on function public.review_scholarship_request(uuid, text, text, text)
from public, anon;

grant execute on function public.review_scholarship_request(uuid, text, text, text)
to authenticated;

create or replace function public.notify_scholarship_request_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  school_name_value text;
  production_title_value text;
begin
  select
    application.school_name,
    application.production_title
  into school_name_value, production_title_value
  from public.applications application
  where application.id = new.application_id;

  insert into public.user_notifications (
    user_id,
    notification_type,
    title,
    body,
    href,
    related_application_id
  )
  select
    profile.id,
    'scholarship_request_submitted',
    'New scholarship request',
    school_name_value || ' — ' || coalesce(production_title_value, 'Untitled production'),
    '/portal/appeals',
    new.application_id
  from public.profiles profile
  where profile.active = true
    and profile.role = 'owner';

  insert into public.owner_activity_log (
    activity_type,
    title,
    detail,
    actor_id,
    application_id,
    metadata
  ) values (
    'scholarship_request_submitted',
    'New scholarship request from ' || school_name_value,
    coalesce(production_title_value, 'Untitled production'),
    new.submitted_by,
    new.application_id,
    jsonb_build_object('scholarship_request_id', new.id)
  );

  return new;
end;
$$;

revoke all on function public.notify_scholarship_request_submitted()
from public, anon, authenticated;

drop trigger if exists scholarship_requests_notify_submission
on public.scholarship_requests;

create trigger scholarship_requests_notify_submission
after insert on public.scholarship_requests
for each row
when (new.status = 'submitted')
execute function public.notify_scholarship_request_submitted();

commit;
