begin;

alter table public.community_donor_letter_requests
  drop constraint if exists community_donor_letter_requests_recipient_title_check;

alter table public.community_donor_letter_requests
  add constraint community_donor_letter_requests_recipient_title_check
  check (char_length(btrim(recipient_title)) between 1 and 120);

commit;
