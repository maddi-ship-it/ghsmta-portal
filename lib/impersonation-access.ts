import type { AppRole } from "@/lib/types";

export const IMPERSONATABLE_ROLES: AppRole[] = [
  "applicant",
  "adjudicator",
  "advisory_member",
];

export function canOwnerImpersonateProfile(
  profile: {
    id: string;
    email: string | null;
    role: AppRole;
    active: boolean;
    force_password_reset?: boolean;
  },
  ownerId: string,
) {
  return (
    profile.id !== ownerId &&
    profile.active &&
    Boolean(profile.email) &&
    !profile.force_password_reset &&
    IMPERSONATABLE_ROLES.includes(profile.role)
  );
}

export function impersonationRoleName(role: AppRole) {
  if (role === "advisory_member") return "Advisory Committee member";
  if (role === "adjudicator") return "adjudicator";
  return "applicant";
}

export function isActiveOwnerImpersonation(
  impersonation: { targetId: string } | null,
  profileId: string,
) {
  return impersonation?.targetId === profileId;
}
