export function isStudentSchoolOption(name: string, allowTestSchools = false) {
  if (allowTestSchools) return true;
  const normalized = name.trim().toLowerCase();
  return !(
    normalized.startsWith("demo school") ||
    normalized.startsWith("group shadow") ||
    normalized.includes("(test)")
  );
}
