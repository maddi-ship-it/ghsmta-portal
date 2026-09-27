alter table public.ai_prompt_templates
  alter column model set default 'gpt-6-sol';

update public.ai_prompt_templates
set
  model = 'gpt-6-sol',
  updated_at = timezone('utc', now())
where template_key = 'panel_category_comment'
  and active = true;
