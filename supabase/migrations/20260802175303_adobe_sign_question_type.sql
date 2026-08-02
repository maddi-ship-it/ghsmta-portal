-- Add an owner-configurable Adobe Acrobat Sign Web Form block to application forms.
-- The iframe HTML itself is never stored; the application normalizes it to a
-- validated Adobe URL inside application_questions.settings.

alter type public.application_question_type
  add value if not exists 'adobe_sign' after 'signature_acknowledgement';
