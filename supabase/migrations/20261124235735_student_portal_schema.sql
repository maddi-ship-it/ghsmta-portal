-- GHSMTA student, guardian, and alumni portal foundation.

create table public.student_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  legal_name text,
  preferred_name text,
  pronouns text,
  school_id uuid references public.schools(id) on delete set null,
  school_name_snapshot text,
  graduation_year integer check (graduation_year between 2020 and 2100),
  emergency_contact_name text,
  emergency_contact_relationship text,
  emergency_contact_phone text,
  performer_credits text,
  production_credits text,
  accessibility_accommodations text,
  tshirt_size text,
  dietary_needs text,
  status text not null default 'pending_school' check (
    status in ('pending_school', 'active', 'alumni', 'archived')
  ),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_school_requests (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references public.student_profiles(user_id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete restrict,
  source text not null default 'self_registration' check (
    source in ('self_registration', 'school_invite', 'owner_invite', 'owner_import', 'transfer')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'denied', 'cancelled')
  ),
  requested_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index student_school_requests_one_pending_idx
  on public.student_school_requests(student_user_id)
  where status = 'pending';

create table public.student_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  school_id uuid references public.schools(id) on delete set null,
  graduation_year integer check (graduation_year is null or graduation_year between 2020 and 2100),
  source text not null check (source in ('school', 'owner', 'import')),
  invited_by uuid references public.profiles(id) on delete set null,
  auth_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'sent' check (status in ('sent', 'accepted', 'cancelled', 'expired')),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index student_invitations_email_idx
  on public.student_invitations(lower(email), status, created_at desc);

create table public.guardian_student_links (
  id uuid primary key default gen_random_uuid(),
  guardian_user_id uuid not null references public.profiles(id) on delete cascade,
  student_user_id uuid not null references public.student_profiles(user_id) on delete cascade,
  guardian_email text not null,
  guardian_name text,
  relationship text,
  status text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guardian_user_id, student_user_id)
);

create index guardian_student_links_student_idx
  on public.guardian_student_links(student_user_id, status);
create index guardian_student_links_guardian_idx
  on public.guardian_student_links(guardian_user_id, status);

create table public.student_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  availability text not null default 'assigned' check (availability in ('open', 'assigned')),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'archived')),
  opens_at timestamptz,
  closes_at timestamptz,
  requires_guardian_signature boolean not null default true,
  instructions text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at is null or opens_at is null or closes_at >= opens_at)
);

create table public.student_program_fields (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.student_programs(id) on delete cascade,
  field_key text not null,
  label text not null,
  description text,
  field_type text not null check (
    field_type in (
      'short_text', 'long_text', 'email', 'phone', 'number', 'date',
      'select', 'multi_select', 'yes_no', 'checkbox', 'file', 'content'
    )
  ),
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, field_key)
);

create table public.student_program_assignments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.student_programs(id) on delete cascade,
  student_user_id uuid not null references public.student_profiles(user_id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  is_nominee boolean not null default false,
  internal_label text,
  internal_notes text,
  created_at timestamptz not null default now(),
  unique (program_id, student_user_id)
);

create table public.student_submissions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.student_programs(id) on delete restrict,
  student_user_id uuid not null references public.student_profiles(user_id) on delete cascade,
  assignment_id uuid references public.student_program_assignments(id) on delete set null,
  status text not null default 'draft' check (
    status in ('draft', 'submitted', 'returned', 'complete', 'archived')
  ),
  responses jsonb not null default '{}'::jsonb check (jsonb_typeof(responses) = 'object'),
  owner_notes text,
  submitted_at timestamptz,
  returned_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, student_user_id)
);

create table public.student_guardian_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.student_submissions(id) on delete cascade,
  guardian_user_id uuid not null references public.profiles(id) on delete restrict,
  typed_name text not null,
  relationship text,
  acknowledgement_text text not null,
  signed_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (submission_id)
);

create table public.student_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'students_and_guardians' check (
    audience in ('students', 'guardians', 'students_and_guardians', 'alumni', 'all_student_portal')
  ),
  delivery_email boolean not null default true,
  delivery_sms boolean not null default true,
  delivery_in_app boolean not null default true,
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_portal_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  student_user_id uuid references public.student_profiles(user_id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_record jsonb,
  new_record jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index student_profiles_school_idx on public.student_profiles(school_id, status);
create index student_programs_status_idx on public.student_programs(status, availability, opens_at, closes_at);
create index student_program_fields_program_idx on public.student_program_fields(program_id, sort_order);
create index student_assignments_student_idx on public.student_program_assignments(student_user_id, created_at desc);
create index student_submissions_student_idx on public.student_submissions(student_user_id, updated_at desc);
create index student_announcements_published_idx on public.student_announcements(published_at desc);
create index student_portal_audit_student_idx on public.student_portal_audit_log(student_user_id, created_at desc);

create or replace view public.guardian_student_summaries
with (security_barrier = true)
as
select
  student.user_id,
  student.legal_name,
  student.preferred_name,
  student.graduation_year,
  student.status,
  student.school_name_snapshot
from public.student_profiles student
join public.guardian_student_links link
  on link.student_user_id = student.user_id
where link.guardian_user_id = auth.uid()
  and link.status in ('invited', 'active');

revoke all on public.guardian_student_summaries from public, anon;
grant select on public.guardian_student_summaries to authenticated;

create trigger student_profiles_set_updated_at before update on public.student_profiles
for each row execute function public.set_updated_at();
create trigger student_school_requests_set_updated_at before update on public.student_school_requests
for each row execute function public.set_updated_at();
create trigger student_invitations_set_updated_at before update on public.student_invitations
for each row execute function public.set_updated_at();
create trigger guardian_student_links_set_updated_at before update on public.guardian_student_links
for each row execute function public.set_updated_at();
create trigger student_programs_set_updated_at before update on public.student_programs
for each row execute function public.set_updated_at();
create trigger student_program_fields_set_updated_at before update on public.student_program_fields
for each row execute function public.set_updated_at();
create trigger student_submissions_set_updated_at before update on public.student_submissions
for each row execute function public.set_updated_at();
create trigger student_announcements_set_updated_at before update on public.student_announcements
for each row execute function public.set_updated_at();

create or replace function public.can_access_student(
  p_student_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.profiles own_profile
      where own_profile.id = auth.uid()
        and own_profile.id = p_student_user_id
        and own_profile.active = true
        and own_profile.role in ('student', 'alumni')
    )
    or exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.active = true and profile.role = 'owner'
    )
    or exists (
      select 1 from public.guardian_student_links link
      where link.guardian_user_id = auth.uid()
        and link.student_user_id = p_student_user_id
        and link.status in ('invited', 'active')
    );
$$;

revoke all on function public.can_access_student(uuid) from public, anon;
grant execute on function public.can_access_student(uuid) to authenticated;

create or replace function public.can_access_assigned_student_program(
  p_program_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.student_program_assignments assignment
    where assignment.program_id = p_program_id
      and public.can_access_student(assignment.student_user_id)
  );
$$;

revoke all on function public.can_access_assigned_student_program(uuid) from public, anon;
grant execute on function public.can_access_assigned_student_program(uuid) to authenticated;

create or replace function public.log_student_submission_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.student_portal_audit_log (
    actor_user_id,
    student_user_id,
    action,
    entity_type,
    entity_id,
    old_record,
    new_record
  ) values (
    auth.uid(),
    coalesce(new.student_user_id, old.student_user_id),
    tg_op,
    'student_submission',
    coalesce(new.id, old.id),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger student_submissions_audit
after insert or update or delete on public.student_submissions
for each row execute function public.log_student_submission_change();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  supplied_phone text;
  requested_role_text text;
  selected_role public.app_role;
  requested_school_id uuid;
  requested_graduation_year integer;
begin
  supplied_phone := nullif(trim(new.raw_user_meta_data ->> 'phone_e164'), '');
  requested_role_text := lower(coalesce(new.raw_user_meta_data ->> 'portal_role', 'applicant'));
  selected_role := case
    when requested_role_text in ('student', 'guardian')
      then requested_role_text::public.app_role
    else 'applicant'::public.app_role
  end;

  insert into public.profiles (
    id,
    email,
    full_name,
    preferred_name,
    phone_e164,
    phone_required_at,
    pronouns,
    role
  ) values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'preferred_name', ''),
    supplied_phone,
    case
      when coalesce((new.raw_user_meta_data ->> 'require_phone_verification')::boolean, false)
        then now()
      else null
    end,
    nullif(new.raw_user_meta_data ->> 'pronouns', ''),
    selected_role
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    preferred_name = coalesce(excluded.preferred_name, public.profiles.preferred_name),
    phone_e164 = coalesce(excluded.phone_e164, public.profiles.phone_e164),
    phone_required_at = coalesce(excluded.phone_required_at, public.profiles.phone_required_at),
    pronouns = coalesce(excluded.pronouns, public.profiles.pronouns),
    role = case
      when public.profiles.role = 'applicant' and selected_role in ('student', 'guardian')
        then selected_role
      else public.profiles.role
    end;

  if selected_role = 'student' then
    if coalesce(new.raw_user_meta_data ->> 'graduation_year', '') ~ '^[0-9]{4}$' then
      requested_graduation_year := (new.raw_user_meta_data ->> 'graduation_year')::integer;
    else
      requested_graduation_year := null;
    end if;
    insert into public.student_profiles (
      user_id,
      legal_name,
      preferred_name,
      pronouns,
      graduation_year,
      status
    ) values (
      new.id,
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'preferred_name', ''),
      nullif(new.raw_user_meta_data ->> 'pronouns', ''),
      requested_graduation_year,
      'pending_school'
    ) on conflict (user_id) do nothing;

    if coalesce(new.raw_user_meta_data ->> 'school_id', '') ~* '^[0-9a-f-]{36}$' then
      requested_school_id := (new.raw_user_meta_data ->> 'school_id')::uuid;
      insert into public.student_school_requests (
        student_user_id,
        school_id,
        source,
        requested_by
      ) values (
        new.id,
        requested_school_id,
        'self_registration',
        new.id
      ) on conflict do nothing;
    end if;
  end if;

  return new;
end;
$$;

alter table public.portal_files
  drop constraint if exists portal_files_context_type_check;
alter table public.portal_files
  add constraint portal_files_context_type_check check (
    context_type in (
      'appeal', 'bug_report', 'feature_request', 'application',
      'scholarship_request', 'student_profile', 'student_submission'
    )
  );

alter table public.student_profiles enable row level security;
alter table public.student_school_requests enable row level security;
alter table public.student_invitations enable row level security;
alter table public.guardian_student_links enable row level security;
alter table public.student_programs enable row level security;
alter table public.student_program_fields enable row level security;
alter table public.student_program_assignments enable row level security;
alter table public.student_submissions enable row level security;
alter table public.student_guardian_acknowledgements enable row level security;
alter table public.student_announcements enable row level security;
alter table public.student_portal_audit_log enable row level security;

grant all on public.student_profiles to service_role;
grant all on public.student_school_requests to service_role;
grant all on public.student_invitations to service_role;
grant all on public.guardian_student_links to service_role;
grant all on public.student_programs to service_role;
grant all on public.student_program_fields to service_role;
grant all on public.student_program_assignments to service_role;
grant all on public.student_submissions to service_role;
grant all on public.student_guardian_acknowledgements to service_role;
grant all on public.student_announcements to service_role;
grant all on public.student_portal_audit_log to service_role;

grant select on public.student_profiles to authenticated;
grant select on public.student_school_requests to authenticated;
grant select on public.student_invitations to authenticated;
grant select (
  id,
  guardian_user_id,
  student_user_id,
  guardian_name,
  relationship,
  status,
  invited_by,
  invited_at,
  accepted_at,
  removed_at,
  created_at,
  updated_at
) on public.guardian_student_links to authenticated;
grant select on public.student_programs to authenticated;
grant select on public.student_program_fields to authenticated;
-- Assignment records include private nominee labels and owner notes. They are
-- managed through Owner-only server actions and are not exposed through the
-- authenticated API. Student program visibility is derived by the program RLS
-- policy without revealing the assignment record itself.
revoke all on public.student_program_assignments from authenticated;
grant select on public.student_submissions to authenticated;
grant insert (program_id, student_user_id, assignment_id, status, responses)
  on public.student_submissions to authenticated;
grant update (responses, status, submitted_at)
  on public.student_submissions to authenticated;
grant select on public.student_guardian_acknowledgements to authenticated;
grant select on public.student_announcements to authenticated;
grant select on public.student_portal_audit_log to authenticated;

create policy "student profiles visible to linked users and owners"
on public.student_profiles for select to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    user_id = auth.uid()
    and public.current_user_role() in ('student', 'alumni')
  )
);

create policy "school requests visible to student and owners"
on public.student_school_requests for select to authenticated
using (student_user_id = auth.uid() or public.current_user_role() = 'owner');
create policy "owners decide school requests"
on public.student_school_requests for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "owners read student invitations"
on public.student_invitations for select to authenticated
using (public.current_user_role() = 'owner' or auth_user_id = auth.uid());

create policy "linked users read guardian relationships"
on public.guardian_student_links for select to authenticated
using (
  guardian_user_id = auth.uid()
  or student_user_id = auth.uid()
  or public.current_user_role() = 'owner'
);

create policy "student programs visible to eligible users"
on public.student_programs for select to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    status in ('open', 'closed')
    and (
      availability = 'open'
      or public.can_access_assigned_student_program(student_programs.id)
      or exists (
        select 1 from public.student_submissions submission
        where submission.program_id = student_programs.id
          and public.can_access_student(submission.student_user_id)
      )
    )
  )
);

create policy "student program fields follow program access"
on public.student_program_fields for select to authenticated
using (
  exists (
    select 1 from public.student_programs program
    where program.id = student_program_fields.program_id
  )
);

create policy "submissions visible to linked users"
on public.student_submissions for select to authenticated
using (public.can_access_student(student_user_id));

create policy "students create eligible submissions"
on public.student_submissions for insert to authenticated
with check (
  student_user_id = auth.uid()
  and status = 'draft'
  and public.current_user_role() = 'student'
  and exists (
    select 1 from public.student_profiles student
    where student.user_id = auth.uid()
      and student.status = 'active'
  )
  and exists (
    select 1 from public.student_programs program
    where program.id = student_submissions.program_id
      and program.status = 'open'
      and (program.opens_at is null or program.opens_at <= now())
      and (program.closes_at is null or program.closes_at >= now())
      and (
        program.availability = 'open'
        or public.can_access_assigned_student_program(program.id)
      )
  )
);

create policy "students edit own active submissions owners edit all"
on public.student_submissions for update to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'student'
    and student_user_id = auth.uid()
    and status in ('draft', 'returned')
  )
)
with check (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'student'
    and student_user_id = auth.uid()
    and status in ('draft', 'returned', 'submitted')
  )
);

create policy "guardian acknowledgements visible to linked users"
on public.student_guardian_acknowledgements for select to authenticated
using (
  public.current_user_role() = 'owner'
  or guardian_user_id = auth.uid()
  or exists (
    select 1 from public.student_submissions submission
    where submission.id = student_guardian_acknowledgements.submission_id
      and submission.student_user_id = auth.uid()
  )
);

create policy "published student announcements visible by audience"
on public.student_announcements for select to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    published_at is not null
    and published_at <= now()
    and (expires_at is null or expires_at > now())
    and (
      audience = 'all_student_portal'
      or (audience in ('students', 'students_and_guardians') and public.current_user_role() = 'student')
      or (audience in ('guardians', 'students_and_guardians') and public.current_user_role() = 'guardian')
      or (audience = 'alumni' and public.current_user_role() = 'alumni')
    )
  )
);

create policy "student audit visible to linked users"
on public.student_portal_audit_log for select to authenticated
using (public.current_user_role() = 'owner' or student_user_id = auth.uid());

drop policy if exists "student portal linked profile reads" on public.profiles;
-- Linked student and guardian pages read the narrow relationship/profile
-- tables above. They intentionally do not receive access to the other
-- person's general profile row, phone number, or contact directory details.

drop policy if exists "profiles read own or elevated" on public.profiles;
create policy "profiles read own or elevated"
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'advisory_member'
    and role not in ('student', 'guardian', 'alumni')
  )
);

drop policy if exists "student portal participants read files" on public.portal_files;
create policy "student portal participants read files"
on public.portal_files for select to authenticated
using (
  (
    context_type = 'student_profile'
    and public.can_access_student(context_id)
  )
  or (
    context_type = 'student_submission'
    and exists (
      select 1 from public.student_submissions submission
      where submission.id = context_id
        and public.can_access_student(submission.student_user_id)
    )
  )
);

drop policy if exists "users register own portal files" on public.portal_files;
create policy "users register own portal files"
on public.portal_files for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and (
    context_type not in (
      'application', 'scholarship_request', 'student_profile', 'student_submission'
    )
    or (
      context_type = 'application'
      and application_id is not null
      and public.can_manage_application_documents(application_id, auth.uid())
    )
    or (
      context_type = 'scholarship_request'
      and application_id is not null
      and public.is_application_member(application_id, auth.uid())
    )
    or (
      context_type = 'student_profile'
      and context_id = auth.uid()
      and public.current_user_role() = 'student'
    )
    or (
      context_type = 'student_submission'
      and public.current_user_role() = 'student'
      and exists (
        select 1 from public.student_submissions submission
        where submission.id = context_id
          and submission.student_user_id = auth.uid()
          and submission.status in ('draft', 'returned')
      )
    )
  )
);

-- Owners manage the student portal through server actions using the service
-- role. RLS deliberately keeps student and guardian access narrow.
