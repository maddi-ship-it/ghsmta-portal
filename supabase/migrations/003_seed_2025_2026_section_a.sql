-- Seed the six question definitions available in the Acceptd ApplicationQuestion export.
-- This creates a historical 2025-2026 draft form. It does not activate the cycle
-- or publish the form automatically.

do $$
declare
  cycle_uuid uuid;
  form_uuid uuid;
  section_uuid uuid;
begin
  insert into public.award_cycles (name, season_year, is_active)
  values ('2025–2026 Awards Cycle', '2025-2026', false)
  on conflict (season_year)
  do update set name = excluded.name
  returning id into cycle_uuid;

  select id into form_uuid
  from public.application_form_versions
  where cycle_id = cycle_uuid and version_number = 1;

  if form_uuid is null then
    insert into public.application_form_versions (
      cycle_id,
      version_number,
      name,
      status
    ) values (
      cycle_uuid,
      1,
      '2025–2026 Director Application Import',
      'draft'
    ) returning id into form_uuid;
  end if;

  select id into section_uuid
  from public.application_sections
  where form_version_id = form_uuid
    and title = 'Section A: I.D.E.A. Initiative and Directors Agreement';

  if section_uuid is null then
    insert into public.application_sections (
      form_version_id,
      title,
      description,
      sort_order
    ) values (
      form_uuid,
      'Section A: I.D.E.A. Initiative and Directors Agreement',
      'Imported from the 2025–2026 Acceptd application question export.',
      10
    ) returning id into section_uuid;
  end if;

  insert into public.application_questions (
    form_version_id,
    section_id,
    question_key,
    label,
    description,
    question_type,
    required,
    options,
    settings,
    sort_order
  ) values
  (
    form_uuid,
    section_uuid,
    'broadway_league_equity_inclusion_acknowledgement',
    'Broadway League Statement on Equity and Inclusion',
    'The Broadway League promotes an equitable and inclusive theatre community and commits to anti-racist policies, inclusive cultures, and expanded opportunities for BIPOC artists and professionals.',
    'signature_acknowledgement',
    true,
    '[]'::jsonb,
    '{"acknowledgement_label":"I have read and acknowledge this statement."}'::jsonb,
    10
  ),
  (
    form_uuid,
    section_uuid,
    'ghsmta_objectives_acknowledgement',
    'The Objectives of the Georgia High School Musical Theatre Awards',
    'Recognize and celebrate Georgia high school musical theatre; increase support for arts education; cultivate positive relationships; provide student opportunities; and embed inclusion, diversity, equity, and access throughout the program.',
    'signature_acknowledgement',
    true,
    '[]'::jsonb,
    '{"acknowledgement_label":"I have read and acknowledge these objectives."}'::jsonb,
    20
  ),
  (
    form_uuid,
    section_uuid,
    'director_agreement_signing_instructions',
    'Instructions for signing',
    'Each document link opens in a new tab. Complete the signature, return to this application, then confirm completion below.',
    'content',
    false,
    '[]'::jsonb,
    '{}'::jsonb,
    30
  ),
  (
    form_uuid,
    section_uuid,
    'idea_policy_signature_confirmation',
    'Director I.D.E.A. Policy',
    'Open and sign the Director I.D.E.A. Policy, then confirm completion.',
    'signature_acknowledgement',
    true,
    '[]'::jsonb,
    '{"external_url":"https://2024ghsmta.na4.documents.adobe.com/public/esignWidget?wid=CBFCIBAA3AAABLblqZhASqrC0_CD8qMKiYO7cMmLIGh9_iKbAgzzFuIqoXxO7bzaHE6MTMRPBp_9FNW4wcN8*","external_label":"Open Director I.D.E.A. Policy","acknowledgement_label":"I completed the Director I.D.E.A. Policy."}'::jsonb,
    40
  ),
  (
    form_uuid,
    section_uuid,
    'mandated_reporter_policy_signature_confirmation',
    'Mandated Reporter Policy',
    'Open and sign the Mandated Reporter Policy, then confirm completion.',
    'signature_acknowledgement',
    true,
    '[]'::jsonb,
    '{"external_url":"https://2024ghsmta.na4.documents.adobe.com/public/esignWidget?wid=CBFCIBAA3AAABLblqZhABnRMrqPQ4zo_wDmoYXyF_i9ufbZq8xJZdREa5Ol4ZFrY9hBKoKpRv95pJH5e4SBA*","external_label":"Open Mandated Reporter Policy","acknowledgement_label":"I completed the Mandated Reporter Policy."}'::jsonb,
    50
  ),
  (
    form_uuid,
    section_uuid,
    'director_agreement_signature_confirmation',
    'Director Agreement',
    'Open and sign the Director Agreement, then confirm completion.',
    'signature_acknowledgement',
    true,
    '[]'::jsonb,
    '{"external_url":"https://2024ghsmta.na4.documents.adobe.com/public/esignWidget?wid=CBFCIBAA3AAABLblqZhDngvWA7KhaHE_nKIref_uS7GNILbP17aDfXp7EhssW3PO8scSrgVkbF3FBwT9yNak*","external_label":"Open Director Agreement","acknowledgement_label":"I completed the Director Agreement."}'::jsonb,
    60
  )
  on conflict (form_version_id, question_key)
  do update set
    label = excluded.label,
    description = excluded.description,
    question_type = excluded.question_type,
    required = excluded.required,
    options = excluded.options,
    settings = excluded.settings,
    sort_order = excluded.sort_order;
end;
$$;
