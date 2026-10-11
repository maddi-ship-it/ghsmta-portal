export function categoryBelongsToApplicationRubric({
  applicationFormRubricId,
  categoryRubricId,
}: {
  applicationFormRubricId: string | null | undefined;
  categoryRubricId: string | null | undefined;
}) {
  return Boolean(
    applicationFormRubricId &&
      categoryRubricId &&
      applicationFormRubricId === categoryRubricId,
  );
}
