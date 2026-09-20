-- Allow owners and advisory members to remove an existing slot participant
-- even when that person's current portal role no longer permits new assignments.
create or replace function public.manage_schedule_staff(
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

  if p_action not in ('add', 'remove') then
    raise exception 'Unsupported schedule action.';
  end if;

  select title into slot_title
  from public.schedule_slots where id = p_slot_id;
  if slot_title is null then raise exception 'Schedule slot not found.'; end if;

  select coalesce(full_name, email, 'Portal user') into actor_name
  from public.profiles where id = auth.uid();
  select application_id into booked_application_id
  from public.schedule_school_bookings where slot_id = p_slot_id;

  if p_action = 'add' then
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
  else
    if actor_role = 'advisory_member'
      and coalesce(trim(p_reason), '') = ''
    then
      raise exception 'Enter a reason when removing a participant.';
    end if;

    select id, joined_as, participation_mode
    into enrollment_id, selected_role, p_participation_mode
    from public.schedule_slot_staff
    where slot_id = p_slot_id and user_id = p_user_id;

    if enrollment_id is null then
      raise exception 'Schedule participant not found.';
    end if;

    select coalesce(full_name, email, 'Portal user') into selected_name
    from public.profiles where id = p_user_id;
    selected_name := coalesce(selected_name, 'Portal user');

    delete from public.schedule_slot_staff
    where id = enrollment_id;
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
