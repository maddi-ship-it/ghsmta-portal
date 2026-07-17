import type { AppRole, ApplicationStatus } from "@/lib/types";

export function roleLabel(role: AppRole): string {
  const labels: Record<AppRole, string> = {
    applicant: "Applicant",
    adjudicator: "Adjudicator",
    advisory_member: "Advisory Member",
    owner: "Owner",
  };
  return labels[role];
}

export function statusLabel(status: ApplicationStatus): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
