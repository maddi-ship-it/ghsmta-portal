export function normalizePhoneE164(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("+")) {
    const international = `+${trimmed.slice(1).replace(/\D/g, "")}`;
    return /^\+[1-9]\d{7,14}$/.test(international) ? international : "";
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  return "";
}

export function formatPhoneForDisplay(value: string | null | undefined) {
  if (!value) return "Not added";
  if (/^\+1\d{10}$/.test(value)) {
    return `+1 (${value.slice(2, 5)}) ${value.slice(5, 8)}-${value.slice(8)}`;
  }
  return value;
}
