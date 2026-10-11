type StoredReportFilters = Record<string, unknown> | null;

export function storedReportHref(
  reportKey: string,
  filters: StoredReportFilters,
  fallbackVariant = "internal",
) {
  const next = new URLSearchParams({ report: reportKey });
  const value = (camelKey: string, snakeKey: string) =>
    filters?.[camelKey] ?? filters?.[snakeKey];
  const textMappings = [
    ["cycle_id", "cycleId", "cycle_id"],
    ["date_from", "dateFrom", "date_from"],
    ["date_to", "dateTo", "date_to"],
    ["school", "school", "school"],
    ["status", "status", "status"],
    ["sort", "sort", "sort"],
    ["direction", "direction", "direction"],
  ] as const;
  const booleanMappings = [
    ["include_archived", "includeArchived", "include_archived"],
    ["include_internal_notes", "includeInternalNotes", "include_internal_notes"],
    ["include_contact_info", "includeContactInfo", "include_contact_info"],
    [
      "include_adjudicator_identities",
      "includeAdjudicatorIdentities",
      "include_adjudicator_identities",
    ],
    ["include_protected_scores", "includeProtectedScores", "include_protected_scores"],
  ] as const;

  textMappings.forEach(([queryKey, camelKey, snakeKey]) => {
    const storedValue = value(camelKey, snakeKey);
    if (typeof storedValue === "string" && storedValue) {
      next.set(queryKey, storedValue);
    }
  });
  booleanMappings.forEach(([queryKey, camelKey, snakeKey]) => {
    const storedValue = value(camelKey, snakeKey);
    if (storedValue === true) next.set(queryKey, "on");
    if (storedValue === false) next.set(queryKey, "0");
  });
  const variant = value("variant", "variant");
  next.set("variant", typeof variant === "string" ? variant : fallbackVariant);
  return `/portal/admin/reports?${next.toString()}`;
}
