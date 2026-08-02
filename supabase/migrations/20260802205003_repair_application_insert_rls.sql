-- Repair applicant application creation after the application-members rollout.
--
-- Keep the RPC as SECURITY INVOKER: the caller must still satisfy RLS. This
-- policy intentionally resolves the caller from the active profile row instead
-- of depending on the legacy current_user_role() helper inside WITH CHECK.

begin;

alter table public.applications enable row level security;

grant insert on table public.applications to authenticated;

drop policy if exists "applicant or owner application insert"
on public.applications;

create policy "applicant or owner application insert"
on public.applications
as permissive
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.active = true
      and (
        (
          profile.role = 'applicant'::public.app_role
          and applications.applicant_user_id = profile.id
          and coalesce(applications.is_archived, false) = false
        )
        or profile.role = 'owner'::public.app_role
      )
  )
);

comment on policy "applicant or owner application insert"
on public.applications is
  'Active applicants may create only live applications owned by their auth user; owners may create applications on behalf of users.';

commit;
