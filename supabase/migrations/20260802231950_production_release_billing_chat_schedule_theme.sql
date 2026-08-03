-- Production release: billing, chat collaboration, schedule participation,
-- persistent themes, and larger Owner reference documents.

-- Theme preferences ---------------------------------------------------------

alter table public.profiles
  add column if not exists theme_preference text not null default 'system';

alter table public.profiles drop constraint if exists profiles_theme_preference_check;
alter table public.profiles add constraint profiles_theme_preference_check
  check (theme_preference in ('system', 'light', 'dark'));

create or replace function public.set_my_theme_preference(p_preference text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if p_preference not in ('system', 'light', 'dark') then
    raise exception 'Choose System, Light, or Dark.';
  end if;
  update public.profiles
  set theme_preference = p_preference, updated_at = now()
  where id = auth.uid();
  return p_preference;
end;
$$;

revoke all on function public.set_my_theme_preference(text) from public, anon;
grant execute on function public.set_my_theme_preference(text) to authenticated;

-- Cycle pricing and school invoices ----------------------------------------

create table if not exists public.cycle_invoice_options (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.award_cycles(id) on delete cascade,
  option_key text not null,
  label text not null,
  amount_cents integer not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, option_key),
  constraint cycle_invoice_options_key_check check (
    option_key in (
      'competition_full', 'competition_title_1',
      'competition_scholarship', 'mentorship'
    )
  ),
  constraint cycle_invoice_options_amount_check check (
    amount_cents between 0 and 10000000
  ),
  constraint cycle_invoice_options_label_check check (
    char_length(trim(label)) between 1 and 160
  )
);

create index if not exists cycle_invoice_options_cycle_idx
  on public.cycle_invoice_options(cycle_id, sort_order);

drop trigger if exists cycle_invoice_options_set_updated_at
on public.cycle_invoice_options;
create trigger cycle_invoice_options_set_updated_at
before update on public.cycle_invoice_options
for each row execute function public.set_updated_at();

create or replace function public.seed_cycle_invoice_options()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cycle_invoice_options (
    cycle_id, option_key, label, amount_cents, sort_order
  ) values
    (new.id, 'competition_full', 'Competition Track — Full Payment', 60000, 10),
    (new.id, 'competition_title_1', 'Competition Track — Title I School', 25000, 20),
    (new.id, 'competition_scholarship', 'Competition Track — Scholarship', 0, 30),
    (new.id, 'mentorship', 'Mentorship Track', 15000, 40)
  on conflict (cycle_id, option_key) do nothing;
  return new;
end;
$$;

drop trigger if exists award_cycles_seed_invoice_options on public.award_cycles;
create trigger award_cycles_seed_invoice_options
after insert on public.award_cycles
for each row execute function public.seed_cycle_invoice_options();

revoke all on function public.seed_cycle_invoice_options()
from public, anon, authenticated;

insert into public.cycle_invoice_options (
  cycle_id, option_key, label, amount_cents, sort_order
)
select
  cycle.id, defaults.option_key, defaults.label,
  defaults.amount_cents, defaults.sort_order
from public.award_cycles cycle
cross join (
  values
    ('competition_full', 'Competition Track — Full Payment', 60000, 10),
    ('competition_title_1', 'Competition Track — Title I School', 25000, 20),
    ('competition_scholarship', 'Competition Track — Scholarship', 0, 30),
    ('mentorship', 'Mentorship Track', 15000, 40)
) as defaults(option_key, label, amount_cents, sort_order)
on conflict (cycle_id, option_key) do nothing;

create sequence if not exists public.school_invoice_number_seq start 100;

create table if not exists public.school_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  cycle_id uuid not null references public.award_cycles(id) on delete restrict,
  application_id uuid not null references public.applications(id) on delete restrict,
  option_key text not null,
  description_snapshot text not null,
  amount_cents integer not null,
  currency text not null default 'usd',
  document_kind text not null default 'invoice',
  payment_url text,
  recipient_email text not null,
  billing_name text not null,
  billing_address text,
  status text not null default 'draft',
  issued_at timestamptz,
  due_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  next_reminder_at timestamptz,
  last_reminder_at timestamptz,
  reminder_count integer not null default 0,
  created_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_invoices_option_key_check check (
    option_key in (
      'competition_full', 'competition_title_1',
      'competition_scholarship', 'mentorship'
    )
  ),
  constraint school_invoices_amount_check check (amount_cents >= 0),
  constraint school_invoices_currency_check check (currency = 'usd'),
  constraint school_invoices_document_kind_check check (
    document_kind in ('invoice', 'scholarship_confirmation')
  ),
  constraint school_invoices_status_check check (
    status in ('draft', 'sent', 'paid', 'void')
  ),
  constraint school_invoices_payment_link_check check (
    amount_cents = 0 or status = 'draft' or payment_url ~ '^https://'
  ),
  constraint school_invoices_zero_document_check check (
    document_kind <> 'scholarship_confirmation' or amount_cents = 0
  )
);

create index if not exists school_invoices_cycle_status_idx
  on public.school_invoices(cycle_id, status, created_at desc);
create index if not exists school_invoices_application_idx
  on public.school_invoices(application_id, created_at desc);
create index if not exists school_invoices_reminder_idx
  on public.school_invoices(next_reminder_at)
  where status = 'sent' and amount_cents > 0;

drop trigger if exists school_invoices_set_updated_at on public.school_invoices;
create trigger school_invoices_set_updated_at
before update on public.school_invoices
for each row execute function public.set_updated_at();

create or replace function public.assign_school_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  season_value text;
  season_digits text;
  season_suffix text;
begin
  if coalesce(trim(new.invoice_number), '') <> '' then return new; end if;
  select season_year into season_value
  from public.award_cycles where id = new.cycle_id;
  season_digits := regexp_replace(
    coalesce(season_value, to_char(now(), 'YYYY')), '[^0-9]', '', 'g'
  );
  season_suffix := right(season_digits, 2);
  new.invoice_number := season_suffix || 'GHSMTA'
    || lpad(nextval('public.school_invoice_number_seq')::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists school_invoices_assign_number on public.school_invoices;
create trigger school_invoices_assign_number
before insert on public.school_invoices
for each row execute function public.assign_school_invoice_number();

revoke all on function public.assign_school_invoice_number()
from public, anon, authenticated;

create table if not exists public.invoice_delivery_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null
    references public.school_invoices(id) on delete cascade,
  delivery_type text not null,
  email_status text,
  chat_status text,
  detail text,
  delivered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invoice_delivery_log_type_check check (
    delivery_type in (
      'invoice', 'reminder', 'receipt', 'scholarship_confirmation'
    )
  )
);

create index if not exists invoice_delivery_log_invoice_idx
  on public.invoice_delivery_log(invoice_id, created_at desc);

alter table public.cycle_invoice_options enable row level security;
alter table public.school_invoices enable row level security;
alter table public.invoice_delivery_log enable row level security;

create policy "owners manage cycle invoice options"
on public.cycle_invoice_options for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "owners manage school invoices"
on public.school_invoices for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "school teams read delivered invoices"
on public.school_invoices for select to authenticated
using (
  status in ('sent', 'paid')
  and public.is_application_member(application_id, auth.uid())
);

create policy "owners read invoice delivery logs"
on public.invoice_delivery_log for select to authenticated
using (public.current_user_role() = 'owner');

grant select, insert, update, delete
  on public.cycle_invoice_options to authenticated;
grant select, insert, update, delete
  on public.school_invoices to authenticated;
grant select on public.invoice_delivery_log to authenticated;
grant usage, select on sequence public.school_invoice_number_seq to authenticated;
grant all on public.cycle_invoice_options, public.school_invoices,
  public.invoice_delivery_log to service_role;
grant usage, select on sequence public.school_invoice_number_seq to service_role;

-- Chat reactions and private attachments -----------------------------------

create table if not exists public.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  message_kind text not null,
  message_id uuid not null,
  user_id uuid not null default auth.uid()
    references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_kind, message_id, user_id, emoji),
  constraint chat_reactions_kind_check
    check (message_kind in ('post', 'reply')),
  constraint chat_reactions_emoji_check check (
    emoji in (
      '👍','❤️','🎉','✅','👀','👏','😂','😮','😢',
      '🙏','💡','⭐','🚀','🙌','💯','🤔','🔥','🎭'
    )
  )
);

create index if not exists chat_reactions_channel_idx
  on public.chat_reactions(channel_id, created_at);
create index if not exists chat_reactions_message_idx
  on public.chat_reactions(message_kind, message_id);

create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  message_kind text not null,
  message_id uuid not null,
  original_name text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint not null,
  uploaded_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint chat_attachments_kind_check
    check (message_kind in ('post', 'reply')),
  constraint chat_attachments_name_check
    check (char_length(trim(original_name)) between 1 and 240),
  constraint chat_attachments_size_check
    check (file_size between 1 and 26214400)
);

create index if not exists chat_attachments_channel_idx
  on public.chat_attachments(channel_id, created_at);
create index if not exists chat_attachments_message_idx
  on public.chat_attachments(message_kind, message_id);

create or replace function public.validate_chat_message_reference()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.message_kind = 'post' then
    if not exists (
      select 1 from public.chat_posts
      where id = new.message_id and channel_id = new.channel_id
    ) then
      raise exception 'Chat post not found in this channel.';
    end if;
  elsif not exists (
    select 1 from public.chat_replies
    where id = new.message_id and channel_id = new.channel_id
  ) then
    raise exception 'Chat reply not found in this channel.';
  end if;
  return new;
end;
$$;

drop trigger if exists chat_reactions_validate_message on public.chat_reactions;
create trigger chat_reactions_validate_message
before insert or update on public.chat_reactions
for each row execute function public.validate_chat_message_reference();

drop trigger if exists chat_attachments_validate_message
on public.chat_attachments;
create trigger chat_attachments_validate_message
before insert or update on public.chat_attachments
for each row execute function public.validate_chat_message_reference();

create or replace function public.notify_chat_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  message_author uuid;
  reactor_name text;
begin
  if new.message_kind = 'post' then
    select author_id into message_author
    from public.chat_posts where id = new.message_id;
  else
    select author_id into message_author
    from public.chat_replies where id = new.message_id;
  end if;

  if message_author is null or message_author = new.user_id then
    return new;
  end if;

  select coalesce(full_name, email, 'Someone') into reactor_name
  from public.profiles where id = new.user_id;

  insert into public.user_notifications (
    user_id, notification_type, title, body, href
  ) values (
    message_author,
    'chat_reaction',
    reactor_name || ' reacted ' || new.emoji,
    'Open Chat to view the reaction.',
    '/portal/chat?channel=' || new.channel_id::text
  );
  return new;
end;
$$;

drop trigger if exists chat_reactions_notify_author on public.chat_reactions;
create trigger chat_reactions_notify_author
after insert on public.chat_reactions
for each row execute function public.notify_chat_reaction();

revoke all on function public.notify_chat_reaction()
from public, anon, authenticated;

alter table public.chat_reactions enable row level security;
alter table public.chat_attachments enable row level security;

create policy "channel members read reactions"
on public.chat_reactions for select to authenticated
using (public.can_access_chat_channel(channel_id, auth.uid()));

create policy "channel members add reactions"
on public.chat_reactions for insert to authenticated
with check (
  user_id = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
);

create policy "users remove own reactions"
on public.chat_reactions for delete to authenticated
using (user_id = auth.uid());

create policy "channel members read attachments"
on public.chat_attachments for select to authenticated
using (public.can_access_chat_channel(channel_id, auth.uid()));

create policy "channel members add attachments"
on public.chat_attachments for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
);

create policy "uploaders and owners remove attachments"
on public.chat_attachments for delete to authenticated
using (
  uploaded_by = auth.uid() or public.current_user_role() = 'owner'
);

grant select, insert, delete on public.chat_reactions to authenticated;
grant select, insert, delete on public.chat_attachments to authenticated;
grant all on public.chat_reactions, public.chat_attachments to service_role;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'chat-files', 'chat-files', false, 26214400, null
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "channel members read chat file objects"
on storage.objects;
create policy "channel members read chat file objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-files'
  and public.can_access_chat_channel(
    ((storage.foldername(name))[2])::uuid, auth.uid()
  )
);

drop policy if exists "channel members upload chat file objects"
on storage.objects;
create policy "channel members upload chat file objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.can_access_chat_channel(
    ((storage.foldername(name))[2])::uuid, auth.uid()
  )
);

drop policy if exists "uploaders and owners delete chat file objects"
on storage.objects;
create policy "uploaders and owners delete chat file objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_role() = 'owner'
  )
  and public.can_access_chat_channel(
    ((storage.foldername(name))[2])::uuid, auth.uid()
  )
);

-- Schedule participation modes and Advisory scoring ------------------------

alter table public.schedule_slot_staff
  add column if not exists participation_mode text not null default 'panel';
alter table public.schedule_slot_staff
  drop constraint if exists schedule_slot_staff_participation_mode_check;
alter table public.schedule_slot_staff
  add constraint schedule_slot_staff_participation_mode_check
  check (participation_mode in ('panel', 'understudy', 'shadow'));

create index if not exists schedule_slot_staff_mode_idx
  on public.schedule_slot_staff(slot_id, participation_mode, joined_at);

create or replace function public.can_advisory_review_application(
  p_application_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'owner'
    or (
      public.current_user_role() = 'advisory_member'
      and (
        exists (
          select 1
          from public.adjudicator_assignments assignment
          where assignment.application_id = p_application_id
            and assignment.adjudicator_user_id = p_user_id
            and assignment.can_score = true
            and assignment.removed_at is null
            and coalesce(
              assignment.participant_role,
              'advisory_member'::public.app_role
            ) = 'advisory_member'::public.app_role
        )
        or exists (
          select 1
          from public.schedule_school_bookings booking
          join public.schedule_slot_staff staff
            on staff.slot_id = booking.slot_id
          where booking.application_id = p_application_id
            and staff.user_id = p_user_id
            and staff.joined_as = 'advisory_member'::public.app_role
            and staff.participation_mode = 'panel'
        )
      )
    );
$$;

revoke all on function public.can_advisory_review_application(uuid, uuid)
from public, anon;
grant execute on function public.can_advisory_review_application(uuid, uuid)
to authenticated;

create or replace function public.upsert_schedule_adjudicator_assignment(
  p_slot_id uuid,
  p_application_id uuid,
  p_adjudicator_user_id uuid,
  p_assigned_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_role public.app_role;
begin
  select role into selected_role
  from public.profiles
  where id = p_adjudicator_user_id and active = true;

  if selected_role not in ('adjudicator', 'advisory_member') then
    raise exception
      'Scoring assignments require an adjudicator or advisory member.';
  end if;

  insert into public.adjudicator_assignments (
    application_id, adjudicator_user_id, assigned_by, status,
    schedule_slot_id, internal_notes, participant_role,
    can_score, can_comment, removed_at
  ) values (
    p_application_id, p_adjudicator_user_id, p_assigned_by, 'assigned',
    p_slot_id, 'Automatically assigned as a schedule panelist.',
    selected_role, true, true, null
  )
  on conflict (application_id, adjudicator_user_id) do update set
    schedule_slot_id = excluded.schedule_slot_id,
    assigned_by = coalesce(
      public.adjudicator_assignments.assigned_by, excluded.assigned_by
    ),
    participant_role = excluded.participant_role,
    can_score = true,
    can_comment = true,
    removed_at = null,
    internal_notes = coalesce(
      public.adjudicator_assignments.internal_notes, excluded.internal_notes
    );
end;
$$;

revoke all on function public.upsert_schedule_adjudicator_assignment(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;

create or replace function public.detach_schedule_staff_assignment(
  p_slot_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_assignment_id uuid;
begin
  select assignment.id into selected_assignment_id
  from public.adjudicator_assignments assignment
  where assignment.adjudicator_user_id = p_user_id
    and assignment.schedule_slot_id = p_slot_id;

  if selected_assignment_id is null then return; end if;

  if exists (
    select 1 from public.adjudication_scorecards
    where assignment_id = selected_assignment_id
  ) then
    update public.adjudicator_assignments
    set
      schedule_slot_id = null,
      can_score = false,
      can_comment = false,
      removed_at = now()
    where id = selected_assignment_id;
  else
    delete from public.adjudicator_assignments
    where id = selected_assignment_id;
  end if;
end;
$$;

revoke all on function public.detach_schedule_staff_assignment(uuid, uuid)
from public, anon, authenticated;

create or replace function public.schedule_booking_assign_adjudicators()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_member record;
begin
  for staff_member in
    select user_id
    from public.schedule_slot_staff
    where slot_id = new.slot_id
      and participation_mode = 'panel'
      and joined_as in ('adjudicator', 'advisory_member')
  loop
    perform public.upsert_schedule_adjudicator_assignment(
      new.slot_id, new.application_id, staff_member.user_id, new.booked_by
    );
  end loop;
  return new;
end;
$$;

create or replace function public.schedule_staff_assign_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  booked_application_id uuid;
begin
  if tg_op = 'UPDATE'
    and old.participation_mode = 'panel'
    and (
      new.participation_mode <> 'panel'
      or old.slot_id is distinct from new.slot_id
      or old.user_id is distinct from new.user_id
    )
  then
    perform public.detach_schedule_staff_assignment(old.slot_id, old.user_id);
  end if;

  if new.participation_mode <> 'panel'
    or new.joined_as not in ('adjudicator', 'advisory_member')
  then
    return new;
  end if;

  select application_id into booked_application_id
  from public.schedule_school_bookings
  where slot_id = new.slot_id;

  if booked_application_id is not null then
    perform public.upsert_schedule_adjudicator_assignment(
      new.slot_id, booked_application_id, new.user_id, new.joined_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_staff_assign_application
on public.schedule_slot_staff;
create trigger schedule_staff_assign_application
after insert or update of joined_as, participation_mode, slot_id, user_id
on public.schedule_slot_staff
for each row execute function public.schedule_staff_assign_application();

create or replace function public.schedule_staff_remove_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.participation_mode = 'panel' then
    perform public.detach_schedule_staff_assignment(old.slot_id, old.user_id);
  end if;
  return old;
end;
$$;

drop trigger if exists schedule_staff_remove_assignment
on public.schedule_slot_staff;
create trigger schedule_staff_remove_assignment
after delete on public.schedule_slot_staff
for each row execute function public.schedule_staff_remove_assignment();

create or replace function public.schedule_booking_remove_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_assignment record;
begin
  for selected_assignment in
    select id
    from public.adjudicator_assignments
    where application_id = old.application_id
      and schedule_slot_id = old.slot_id
  loop
    if exists (
      select 1 from public.adjudication_scorecards
      where assignment_id = selected_assignment.id
    ) then
      update public.adjudicator_assignments
      set
        schedule_slot_id = null,
        can_score = false,
        can_comment = false,
        removed_at = now()
      where id = selected_assignment.id;
    else
      delete from public.adjudicator_assignments
      where id = selected_assignment.id;
    end if;
  end loop;
  return old;
end;
$$;

drop function if exists public.join_schedule_slot(uuid);
create function public.join_schedule_slot(
  p_slot_id uuid,
  p_participation_mode text default 'panel'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_role public.app_role;
  selected_slot public.schedule_slots%rowtype;
  enrollment_id uuid;
begin
  selected_role := public.current_user_role();
  if selected_role not in ('adjudicator', 'advisory_member') then
    raise exception
      'Only adjudicators and advisory members can join schedule slots.';
  end if;
  if p_participation_mode not in ('panel', 'understudy', 'shadow') then
    raise exception 'Choose panel, understudy, or shadow.';
  end if;

  select * into selected_slot
  from public.schedule_slots where id = p_slot_id;
  if selected_slot.id is null then
    raise exception 'Schedule slot not found.';
  end if;
  if selected_slot.status <> 'open' or selected_slot.starts_at <= now() then
    raise exception 'This schedule slot is no longer open.';
  end if;

  insert into public.schedule_slot_staff (
    slot_id, user_id, joined_as, joined_by, participation_mode
  ) values (
    p_slot_id, auth.uid(), selected_role, auth.uid(), p_participation_mode
  )
  on conflict (slot_id, user_id) do update set
    joined_as = excluded.joined_as,
    participation_mode = excluded.participation_mode,
    joined_by = auth.uid()
  returning id into enrollment_id;
  return enrollment_id;
end;
$$;

revoke all on function public.join_schedule_slot(uuid, text)
from public, anon;
grant execute on function public.join_schedule_slot(uuid, text)
to authenticated;

drop function if exists public.get_schedule_staff_directory();
create function public.get_schedule_staff_directory()
returns table (
  enrollment_id uuid,
  slot_id uuid,
  user_id uuid,
  full_name text,
  email text,
  role public.app_role,
  participation_mode text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in (
    'adjudicator', 'advisory_member', 'owner'
  ) then
    raise exception 'Staff access required.';
  end if;

  return query
  select
    enrollment.id, enrollment.slot_id, profile.id, profile.full_name,
    profile.email, enrollment.joined_as, enrollment.participation_mode,
    enrollment.joined_at
  from public.schedule_slot_staff enrollment
  join public.profiles profile on profile.id = enrollment.user_id
  where profile.active = true;
end;
$$;

revoke all on function public.get_schedule_staff_directory()
from public, anon;
grant execute on function public.get_schedule_staff_directory()
to authenticated;

drop function if exists public.manage_schedule_staff(uuid, uuid, text, text);
create function public.manage_schedule_staff(
  p_slot_id uuid,
  p_user_id uuid,
  p_action text,
  p_reason text default null,
  p_participation_mode text default 'panel'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.app_role;
  selected_role public.app_role;
  enrollment_id uuid;
  actor_name text;
  selected_name text;
  slot_title text;
  booked_application_id uuid;
begin
  actor_role := public.current_user_role();
  if actor_role not in ('advisory_member', 'owner') then
    raise exception
      'Only owners and advisory committee members can manage slot participants.';
  end if;
  if p_participation_mode not in ('panel', 'understudy', 'shadow') then
    raise exception 'Choose panel, understudy, or shadow.';
  end if;

  select role, coalesce(full_name, email, 'Portal user')
  into selected_role, selected_name
  from public.profiles
  where id = p_user_id and active = true;

  if selected_role not in ('adjudicator', 'advisory_member') then
    raise exception
      'Choose an active adjudicator or advisory committee member.';
  end if;

  select title into slot_title
  from public.schedule_slots where id = p_slot_id;
  if slot_title is null then raise exception 'Schedule slot not found.'; end if;

  select coalesce(full_name, email, 'Portal user') into actor_name
  from public.profiles where id = auth.uid();
  select application_id into booked_application_id
  from public.schedule_school_bookings where slot_id = p_slot_id;

  if p_action = 'add' then
    insert into public.schedule_slot_staff (
      slot_id, user_id, joined_as, joined_by, participation_mode
    ) values (
      p_slot_id, p_user_id, selected_role, auth.uid(), p_participation_mode
    )
    on conflict (slot_id, user_id) do update set
      joined_as = excluded.joined_as,
      joined_by = auth.uid(),
      participation_mode = excluded.participation_mode
    returning id into enrollment_id;
  elsif p_action = 'remove' then
    if actor_role = 'advisory_member'
      and coalesce(trim(p_reason), '') = ''
    then
      raise exception 'Enter a reason when removing a participant.';
    end if;
    select id into enrollment_id
    from public.schedule_slot_staff
    where slot_id = p_slot_id and user_id = p_user_id;
    delete from public.schedule_slot_staff
    where slot_id = p_slot_id and user_id = p_user_id;
  else
    raise exception 'Unsupported schedule action.';
  end if;

  insert into public.owner_activity_log (
    activity_type, title, detail, actor_id,
    application_id, slot_id, metadata
  ) values (
    'schedule_participant_' || p_action,
    actor_name || ' '
      || case when p_action = 'add' then 'added ' else 'removed ' end
      || selected_name,
    coalesce(nullif(trim(p_reason), ''), slot_title),
    auth.uid(), booked_application_id, p_slot_id,
    jsonb_build_object(
      'participant_id', p_user_id,
      'participant_role', selected_role,
      'participation_mode', p_participation_mode,
      'reason', p_reason
    )
  );
  return enrollment_id;
end;
$$;

revoke all on function public.manage_schedule_staff(
  uuid, uuid, text, text, text
) from public, anon;
grant execute on function public.manage_schedule_staff(
  uuid, uuid, text, text, text
) to authenticated;

-- Backfill panel scoring assignments for both adjudicators and Advisory members.
do $$
declare
  enrollment record;
  booked_application_id uuid;
begin
  for enrollment in
    select slot_id, user_id, joined_by
    from public.schedule_slot_staff
    where participation_mode = 'panel'
      and joined_as in ('adjudicator', 'advisory_member')
  loop
    select application_id into booked_application_id
    from public.schedule_school_bookings
    where slot_id = enrollment.slot_id;
    if booked_application_id is not null then
      perform public.upsert_schedule_adjudicator_assignment(
        enrollment.slot_id, booked_application_id,
        enrollment.user_id, enrollment.joined_by
      );
    end if;
  end loop;
end;
$$;

-- Owner reference documents: 200 MB per file -------------------------------

alter table public.reference_documents
  drop constraint if exists reference_documents_file_size_check;
alter table public.reference_documents
  add constraint reference_documents_file_size_check check (
    file_size is null or (file_size > 0 and file_size <= 209715200)
  );

update storage.buckets
set file_size_limit = 209715200
where id = 'reference-documents';

-- Explicit Data API and realtime exposure for new authenticated tables.
grant usage on schema public to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_reactions'
  ) then
    alter publication supabase_realtime add table public.chat_reactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_attachments'
  ) then
    alter publication supabase_realtime add table public.chat_attachments;
  end if;
end;
$$;
