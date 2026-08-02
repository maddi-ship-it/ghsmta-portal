do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumtypid = 'public.application_question_type'::regtype
      and enumlabel = 'adobe_sign'
  ) then
    raise exception 'application_question_type is missing adobe_sign';
  end if;
end
$$;

select enumlabel
from pg_enum
where enumtypid = 'public.application_question_type'::regtype
order by enumsortorder;
