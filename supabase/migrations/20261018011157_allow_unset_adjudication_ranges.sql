-- A Committee category may wait for a two-point range. Once supplied, both
-- endpoints must be present and the range must remain exactly two points.

alter table public.adjudication_category_proposals
  drop constraint if exists adjudication_category_proposals_range_check;

alter table public.adjudication_category_proposals
  add constraint adjudication_category_proposals_range_check check (
    (
      range_min is null
      and range_max is null
    )
    or
    (
      range_min is not null
      and range_max is not null
      and range_min >= 1
      and range_max <= 10
      and range_max - range_min = 2.00
    )
  ) not valid;

alter table public.adjudication_category_proposals
  validate constraint adjudication_category_proposals_range_check;
