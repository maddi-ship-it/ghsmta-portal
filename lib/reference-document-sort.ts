const REFERENCE_NAME_COLLATOR = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
});

export function compareReferenceNames(left: string, right: string) {
  return REFERENCE_NAME_COLLATOR.compare(left, right);
}
